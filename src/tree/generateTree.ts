import * as THREE from 'three';
import type { TreeSpec } from '../types';
import { pixelCanopyUvRect } from './pixelCanopy';
import { treeRng } from './treeSpec';

/**
 * Parametric tree geometry: spec + seed → BufferGeometry.
 *
 * Pipeline: buildSkeleton → sweepBark → emitFoliage. Bark and foliage stay SEPARATE geometries
 * (opaque bark vs alpha-cut / translucent canopy).
 *
 * Placement follows an Unreal/SpeedTree stylized model: paint a crown ellipsoid, then hang
 * clusters off branch tips — not tip-only confetti. Bark gets deterministic gnarl so trunks
 * read as wood, not extruded pipes.
 *
 * Custom vertex channels (material + chop system):
 *   aWind    sway weight from root distance, shaped by stiffness
 *   aTrunkT  trunk height fraction this limb is rooted at (felling partition)
 *   color    baked ramp + canopy AO
 */

const UP = new THREE.Vector3(0, 1, 0);

export interface TreeBranch {
  path: THREE.CatmullRomCurve3;
  length: number;
  radius: number;
  level: number;
  /** Arc length from the root along the parent chain — drives aWind. */
  distFromRoot: number;
  /** Height fraction along the TRUNK where this branch's chain attaches. Trunk itself spans 0..1. */
  trunkT: number;
  parent?: TreeBranch;
  children: TreeBranch[];
}

export interface GeneratedTree {
  bark: THREE.BufferGeometry;
  foliage: THREE.BufferGeometry | null;
  /** Bounding box in local space (base of trunk at origin). */
  bounds: THREE.Box3;
  triangles: number;
  /** Trunk height in world units — break-point fractions multiply this. */
  trunkHeight: number;
}

// --- mesh accumulator ---------------------------------------------------------------------------------

class MeshBuilder {
  positions: number[] = [];
  normals: number[] = [];
  uvs: number[] = [];
  colors: number[] = [];
  wind: number[] = [];
  trunkT: number[] = [];
  /** Centre-minus-authored-corner; zero for geometry that is not a camera-facing card. */
  cardDelta: number[] = [];
  /** Card-space half-offset; zero for geometry that should keep its authored orientation. */
  cardOffset: number[] = [];
  indices: number[] = [];

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  vertex(
    p: THREE.Vector3,
    n: THREE.Vector3,
    u: number,
    v: number,
    c: THREE.Color,
    w: number,
    t: number,
    billboard?: { delta: THREE.Vector3; offsetX: number; offsetY: number },
  ): number {
    const index = this.vertexCount;
    this.positions.push(p.x, p.y, p.z);
    this.normals.push(n.x, n.y, n.z);
    this.uvs.push(u, v);
    this.colors.push(c.r, c.g, c.b);
    this.wind.push(w);
    this.trunkT.push(t);
    this.cardDelta.push(billboard?.delta.x ?? 0, billboard?.delta.y ?? 0, billboard?.delta.z ?? 0);
    this.cardOffset.push(billboard?.offsetX ?? 0, billboard?.offsetY ?? 0);
    return index;
  }

  tri(a: number, b: number, c: number): void {
    this.indices.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.indices.push(a, b, c, a, c, d);
  }

  /**
   * Bake an existing geometry under a transform.
   *
   * `shading` replaces the source normals, which is what makes a canopy read as leaves instead of
   * polygons:
   *   - a Vector3 gives every vertex ONE shared direction (leaf cards — independent face normals
   *     shade each quad separately and the canopy reads as confetti);
   *   - `{ radialCenter }` points normals away from a cluster's centre so the lobe lights as one
   *     soft ball, and the optional `canopyCenter` blend tilts them toward the whole-crown normal
   *     so neighbouring lobes merge into one painted volume instead of a bag of spheres.
   */
  addGeometry(
    geo: THREE.BufferGeometry,
    matrix: THREE.Matrix4,
    color: THREE.Color,
    wind: number,
    trunkT: number,
    shading?: THREE.Vector3 | { radialCenter: THREE.Vector3; canopyCenter?: THREE.Vector3; canopyBlend?: number },
    card?: {
      /** Atlas rectangle applied to the source geometry's ordinary 0..1 UVs. */
      uvRect?: readonly [number, number, number, number];
      /** Rebuild this plane around its centre in the camera plane at render time. */
      billboard?: { center: THREE.Vector3; size: number };
    },
  ): void {
    const pos = geo.getAttribute('position');
    const nor = geo.getAttribute('normal');
    const uv = geo.getAttribute('uv');
    const base = this.vertexCount;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    const toward = new THREE.Vector3();
    const billboardDelta = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += 1) {
      p.fromBufferAttribute(pos, i).applyMatrix4(matrix);
      if (shading instanceof THREE.Vector3) {
        n.copy(shading);
      } else if (shading) {
        n.copy(p).sub(shading.radialCenter).normalize();
        if (!Number.isFinite(n.x) || n.lengthSq() < 1e-6) n.copy(UP);
        if (shading.canopyCenter) {
          toward.copy(p).sub(shading.canopyCenter).normalize();
          if (Number.isFinite(toward.x)) n.lerp(toward, shading.canopyBlend ?? 0.35).normalize();
        }
      } else {
        n.fromBufferAttribute(nor, i).applyMatrix3(normalMatrix).normalize();
      }
      const sourceU = uv ? uv.getX(i) : 0;
      const sourceV = uv ? uv.getY(i) : 0;
      const [u, v] = card?.uvRect
        ? [
            THREE.MathUtils.lerp(card.uvRect[0], card.uvRect[2], sourceU),
            THREE.MathUtils.lerp(card.uvRect[1], card.uvRect[3], sourceV),
          ]
        : [sourceU, sourceV];
      const billboard = card?.billboard
        ? {
            delta: billboardDelta.copy(card.billboard.center).sub(p),
            offsetX: (sourceU - 0.5) * card.billboard.size,
            offsetY: (sourceV - 0.5) * card.billboard.size,
          }
        : undefined;
      this.vertex(p, n, u, v, color, wind, trunkT, billboard);
    }
    const idx = geo.getIndex();
    if (idx) {
      for (let i = 0; i < idx.count; i += 1) this.indices.push(base + idx.getX(i));
    } else {
      for (let i = 0; i < pos.count; i += 1) this.indices.push(base + i);
    }
  }

  toGeometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    g.setAttribute('aWind', new THREE.Float32BufferAttribute(this.wind, 1));
    g.setAttribute('aTrunkT', new THREE.Float32BufferAttribute(this.trunkT, 1));
    g.setAttribute('aCardDelta', new THREE.Float32BufferAttribute(this.cardDelta, 3));
    g.setAttribute('aCardOffset', new THREE.Float32BufferAttribute(this.cardOffset, 2));
    g.setIndex(this.indices);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

// --- skeleton -----------------------------------------------------------------------------------------

/** Rotate `dir` away from its axis by `pitch`, then spin that offset around `dir` by `yaw`. */
function offsetDirection(dir: THREE.Vector3, pitch: number, yaw: number): THREE.Vector3 {
  const reference = Math.abs(dir.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : UP;
  const side = new THREE.Vector3().crossVectors(dir, reference).normalize();
  return dir.clone().applyAxisAngle(side, pitch).applyAxisAngle(dir, yaw).normalize();
}

/**
 * Curved branch path. Curl bends it into an S; gravity sags (or lifts) the tip.
 * Every consumer samples THIS curve — sampling a straight line for children while sweeping a curved
 * bark is what makes branches visibly detach from the trunk.
 */
function branchPath(
  start: THREE.Vector3,
  dir: THREE.Vector3,
  length: number,
  curl: number,
  gravity: number,
  rand: () => number,
): THREE.CatmullRomCurve3 {
  const points: THREE.Vector3[] = [];
  const segments = 4;
  const side = offsetDirection(dir, Math.PI / 2, rand() * Math.PI * 2);
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    const p = start.clone().addScaledVector(dir, length * t);
    p.addScaledVector(side, Math.sin(t * Math.PI) * curl * length * 0.28);
    p.y += -gravity * length * 0.3 * t * t;
    points.push(p);
  }
  return new THREE.CatmullRomCurve3(points);
}

export function buildSkeleton(spec: TreeSpec, rand: () => number): TreeBranch[] {
  const out: TreeBranch[] = [];
  const lean = THREE.MathUtils.degToRad(spec.trunk.lean);
  const dir = new THREE.Vector3(Math.sin(lean), Math.cos(lean), 0)
    .applyAxisAngle(UP, rand() * Math.PI * 2)
    .normalize();
  const trunk: TreeBranch = {
    path: branchPath(new THREE.Vector3(), dir, spec.trunk.height, spec.trunk.curl, 0, rand),
    length: spec.trunk.height,
    radius: spec.trunk.baseRadius,
    level: 0,
    distFromRoot: 0,
    trunkT: 0,
    children: [],
  };
  grow(trunk, spec, rand, out);
  return out;
}

function grow(branch: TreeBranch, spec: TreeSpec, rand: () => number, out: TreeBranch[]): void {
  out.push(branch);
  const b = spec.branches;
  if (branch.level >= b.levels) return;
  const count = b.countPerLevel[branch.level] ?? 0;

  for (let i = 0; i < count; i += 1) {
    const t = count === 1 ? (b.startHeight + b.endHeight) / 2 : THREE.MathUtils.lerp(b.startHeight, b.endHeight, i / (count - 1));
    const start = branch.path.getPoint(t);
    const parentDir = branch.path.getTangent(t).normalize();

    const yaw = THREE.MathUtils.degToRad(b.twist * i + branch.level * 53 + rand() * 12);
    const pitch = THREE.MathUtils.degToRad(b.angle + (rand() - 0.5) * b.angleVariance * 2);
    const dir = offsetDirection(parentDir, pitch, yaw);
    // Lower branches droop harder — that gradient is most of what reads as a real canopy.
    dir.y += b.gravity * 0.45 * (1 - t);
    dir.normalize();

    // Height falloff: upper limbs are shorter so the silhouette tapers like a SpeedTree crown.
    const heightFalloff = branch.level === 0 ? THREE.MathUtils.lerp(1.05, 0.55, t) : 1;
    const length = branch.length * b.lengthRatio * heightFalloff * (0.78 + rand() * 0.44);
    const child: TreeBranch = {
      path: branchPath(start, dir, length, branch.level === 0 ? spec.trunk.curl * b.curlPerLevel : b.curlPerLevel * 0.5, b.gravity, rand),
      length,
      radius: branch.radius * b.radiusRatio,
      level: branch.level + 1,
      distFromRoot: branch.distFromRoot + branch.length * t,
      // Level-1 branches record where they meet the trunk; deeper levels inherit it so a whole limb
      // shares one trunk height and falls (or stays) as one piece when felled.
      trunkT: branch.level === 0 ? t : branch.trunkT,
      parent: branch,
      children: [],
    };
    branch.children.push(child);
    grow(child, spec, rand, out);
  }
}

// --- wind weight --------------------------------------------------------------------------------------

function windWeight(spec: TreeSpec, level: number, distFromRoot: number, maxDist: number): number {
  const t = maxDist > 0 ? THREE.MathUtils.clamp(distFromRoot / maxDist, 0, 1) : 0;
  const shaped = Math.pow(t, spec.wind.stiffnessCurve);
  const levelMul = spec.wind.levelMultiplier[Math.min(level, spec.wind.levelMultiplier.length - 1)] ?? 1;
  const stiffness = level === 0 ? 1 - spec.wind.trunkStiffness : 1;
  return shaped * levelMul * stiffness;
}

// --- bark ---------------------------------------------------------------------------------------------

function rampColor(ramp: string[], t: number, target: THREE.Color): THREE.Color {
  if (ramp.length === 1) return target.set(ramp[0]);
  const scaled = THREE.MathUtils.clamp(t, 0, 1) * (ramp.length - 1);
  const i = Math.min(Math.floor(scaled), ramp.length - 2);
  return target.set(ramp[i]).lerp(new THREE.Color(ramp[i + 1]), scaled - i);
}

/** Cheap deterministic radial noise — stable across rebuilds because it never touches Math.random. */
function gnarlOffset(rand: () => number, amount: number): number {
  if (amount <= 0) return 1;
  // Two octaves so bark reads as irregular wood rather than a single sine corrugation.
  return 1 + (rand() - 0.5) * 2 * amount * 0.55 + (rand() - 0.5) * 2 * amount * 0.2;
}

function sweepBark(branches: TreeBranch[], spec: TreeSpec, maxDist: number, rand: () => number, builder: MeshBuilder): void {
  const color = new THREE.Color();
  const p = new THREE.Vector3();
  const normal = new THREE.Vector3();

  for (const branch of branches) {
    const radial = Math.max(3, Math.round(spec.trunk.radialSegments / (branch.level + 1)));
    const rings = branch.level === 0 ? spec.trunk.heightSegments : Math.max(3, Math.round(spec.trunk.heightSegments / 2));
    const frames = branch.path.computeFrenetFrames(rings, false);
    const ringStart: number[] = [];
    const gnarlAmount = branch.level === 0 ? spec.trunk.gnarl : spec.trunk.gnarl * 0.45;

    for (let r = 0; r <= rings; r += 1) {
      const t = r / rings;
      const center = branch.path.getPoint(t);
      const N = frames.normals[r];
      const B = frames.binormals[r];
      let radius = branch.radius * (1 - spec.trunk.taper * t);
      if (branch.level === 0) radius *= 1 + spec.trunk.flare * Math.pow(1 - t, 3);

      const dist = branch.distFromRoot + branch.length * t;
      const wind = windWeight(spec, branch.level, dist, maxDist);
      const trunkT = branch.level === 0 ? t : branch.trunkT;
      rampColor(spec.look.barkRamp, t * 0.6 + branch.level * 0.2, color);
      if (branch.level === 0) color.multiplyScalar(THREE.MathUtils.lerp(1 - spec.look.aoStrength * 0.5, 1, Math.min(1, t * 4)));

      const first = builder.vertexCount;
      for (let s = 0; s < radial; s += 1) {
        const a = (s / radial) * Math.PI * 2;
        const localRadius = radius * gnarlOffset(rand, gnarlAmount);
        normal.copy(N).multiplyScalar(Math.cos(a)).addScaledVector(B, Math.sin(a)).normalize();
        p.copy(center).addScaledVector(normal, localRadius);
        builder.vertex(p, normal, s / radial, t, color, wind, trunkT);
      }
      ringStart.push(first);

      if (r > 0) {
        const prev = ringStart[r - 1];
        for (let s = 0; s < radial; s += 1) {
          const next = (s + 1) % radial;
          builder.quad(prev + s, prev + next, first + next, first + s);
        }
      }
    }

    // Cap the tip so grazing light doesn't reveal a hollow tube.
    const tipT = 1;
    const tip = branch.path.getPoint(tipT);
    const tipDir = branch.path.getTangent(tipT).normalize();
    const tipDist = branch.distFromRoot + branch.length;
    const tipWind = windWeight(spec, branch.level, tipDist, maxDist);
    const tipTrunkT = branch.level === 0 ? 1 : branch.trunkT;
    rampColor(spec.look.barkRamp, 0.6 + branch.level * 0.2, color);
    const apex = builder.vertex(tip, tipDir, 0.5, 1, color, tipWind, tipTrunkT);
    const last = ringStart[rings];
    for (let s = 0; s < radial; s += 1) builder.tri(last + s, last + ((s + 1) % radial), apex);
  }
}

// --- foliage ------------------------------------------------------------------------------------------

const BLOB_GEO = new THREE.IcosahedronGeometry(1, 1);
const CLUSTER_GEO = new THREE.IcosahedronGeometry(1, 0); // chunkier, reads more stylized at distance
const CARD_GEO = new THREE.PlaneGeometry(1, 1);

/**
 * Radially lump a unit-sphere geometry so no two lobes share the same perfect-ball silhouette.
 * Icosahedra are NON-indexed (co-located vertices duplicated per face), so the displacement is
 * keyed off a quantized position hash — co-located verts move identically and the surface never
 * tears. Deterministic: driven only by the tree's own rng.
 */
function lumpGeometry(source: THREE.BufferGeometry, rand: () => number, amount: number): THREE.BufferGeometry {
  const geo = source.clone();
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const ox = rand() * 97;
  const oy = rand() * 61;
  const oz = rand() * 43;
  for (let i = 0; i < pos.count; i += 1) {
    v.fromBufferAttribute(pos, i);
    const h =
      Math.sin((Math.round(v.x * 37) + ox) * 12.9898 + (Math.round(v.y * 37) + oy) * 78.233 + (Math.round(v.z * 37) + oz) * 37.719) *
      43758.5453;
    const k = 1 + (h - Math.floor(h) - 0.5) * 2 * amount;
    pos.setXYZ(i, v.x * k, v.y * k, v.z * k);
  }
  return geo;
}

/** Small deterministic hue/value wobble so a canopy is a family of greens, not one flat paint. */
function jitterColor(color: THREE.Color, rand: () => number): THREE.Color {
  return color.offsetHSL((rand() - 0.5) * 0.045, (rand() - 0.5) * 0.1, (rand() - 0.5) * 0.09);
}

/**
 * A 3-level tree has dozens of tips; per-anchor cluster counts then explode the canopy into a
 * shapeless pile (and the triangle budget with it). Stride-sample the anchors instead — even
 * coverage over the crown, no rng consumed, so the same seed keeps the same tree.
 */
function capAnchors(anchors: TreeBranch[], cap: number): TreeBranch[] {
  if (anchors.length <= cap) return anchors;
  const stride = anchors.length / cap;
  const out: TreeBranch[] = [];
  for (let i = 0; i < cap; i += 1) out.push(anchors[Math.floor(i * stride)]);
  return out;
}

/**
 * Lowest y foliage may occupy. Canopies previously sagged below the ground plane (an 11-unit oak's
 * crown reached y = −2) and swallowed the trunk; a tree reads as a tree because bark shows beneath
 * the crown. Derived from where branches START, so bushes (startHeight 0) stay ground-hugging.
 */
function canopyFloor(spec: TreeSpec): number {
  return Math.max(0.12, spec.trunk.height * Math.max(0.06, spec.branches.startHeight * 0.7));
}

/** Tips plus near-tips (parents of tips) so the canopy fills instead of floating above bare limbs. */
function foliageAnchors(branches: TreeBranch[]): TreeBranch[] {
  const tips = branches.filter((b) => b.children.length === 0);
  if (!tips.length) return branches;
  const near = new Set<TreeBranch>(tips);
  for (const tip of tips) {
    if (tip.parent && tip.parent.level > 0) near.add(tip.parent);
  }
  return [...near];
}

interface CrownVolume {
  center: THREE.Vector3;
  radiusX: number;
  radiusY: number;
  radiusZ: number;
}

function crownVolume(trunk: TreeBranch, spec: TreeSpec): CrownVolume {
  const lift = spec.foliage.crownLift;
  const center = trunk.path.getPoint(lift);
  const r = Math.max(0.15, spec.trunk.height * spec.foliage.crownRadius);
  // Slightly flatter than a sphere — broadleaf canopies read wider than tall.
  return { center, radiusX: r, radiusY: r * 0.72, radiusZ: r };
}

/** Sample a point inside the crown ellipsoid (rejection-ish via cubed radius for denser core). */
function sampleCrown(volume: CrownVolume, rand: () => number, out: THREE.Vector3): THREE.Vector3 {
  const u = rand();
  const v = rand();
  const w = rand();
  const theta = u * Math.PI * 2;
  const phi = Math.acos(2 * v - 1);
  const rho = Math.cbrt(w); // denser near centre = softer silhouette core
  const sinPhi = Math.sin(phi);
  out.set(
    volume.center.x + rho * volume.radiusX * sinPhi * Math.cos(theta),
    volume.center.y + rho * volume.radiusY * Math.cos(phi) - volume.radiusY * 0.15 * (1 - rho), // slight droop bias
    volume.center.z + rho * volume.radiusZ * sinPhi * Math.sin(theta),
  );
  return out;
}

function emitFoliage(branches: TreeBranch[], spec: TreeSpec, maxDist: number, rand: () => number, builder: MeshBuilder): void {
  const f = spec.foliage;
  if (f.strategy === 'none' || f.density <= 0) return;

  const trunk = branches[0];
  const anchors = foliageAnchors(branches);
  const volume = crownVolume(trunk, spec);

  const centroid = volume.center.clone();
  let canopyRadius = Math.max(volume.radiusX, volume.radiusY, volume.radiusZ);
  for (const b of anchors) canopyRadius = Math.max(canopyRadius, b.path.getPoint(1).distanceTo(centroid));

  const color = new THREE.Color();
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const scratch = new THREE.Vector3();

  const shade = (position: THREE.Vector3, edgeBias = 0) => {
    const d = position.distanceTo(centroid) / Math.max(0.001, canopyRadius);
    const ao = THREE.MathUtils.lerp(1 - spec.look.aoStrength, 1, THREE.MathUtils.smoothstep(d + edgeBias, 0.15, 0.9));
    rampColor(spec.look.foliageRamp, THREE.MathUtils.clamp(d, 0, 1), color);
    color.multiplyScalar(ao);
    // Sun-from-above: the crown's upper lobes run brighter than its underside. Baked, so it holds
    // in any lighting rig and costs nothing at runtime.
    const lift = THREE.MathUtils.clamp((position.y - centroid.y) / Math.max(0.001, canopyRadius), -1, 1);
    color.multiplyScalar(1 + lift * 0.12);
    return color;
  };

  if (f.strategy === 'skirt') {
    emitSkirt(trunk, spec, maxDist, rand, builder, shade);
    return;
  }
  if (f.strategy === 'fronds') {
    emitFronds(trunk, anchors, spec, maxDist, rand, builder, shade, matrix, quat, scale);
    return;
  }
  if (f.strategy === 'strands') {
    emitStrands(anchors, spec, maxDist, rand, builder, shade);
    return;
  }
  if (f.strategy === 'cards') {
    emitCards(anchors, volume, spec, maxDist, rand, builder, shade, matrix, quat, scale, scratch, centroid);
    return;
  }
  if (f.strategy === 'clusters') {
    emitClusters(anchors, volume, spec, maxDist, rand, builder, shade, matrix, quat, scale, scratch);
    return;
  }
  // default: blob
  emitBlobs(anchors, volume, spec, maxDist, rand, builder, shade, matrix, quat, scale, scratch);
}

type ShadeFn = (position: THREE.Vector3, edgeBias?: number) => THREE.Color;

/** Conifer skirt: overlapping cones with jagged rims — less traffic-cone, more UE pine. */
function emitSkirt(trunk: TreeBranch, spec: TreeSpec, maxDist: number, rand: () => number, builder: MeshBuilder, shade: ShadeFn): void {
  const f = spec.foliage;
  const rings = f.skirtRings ?? 9;
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);

  for (let i = 0; i < rings; i += 1) {
    const t = THREE.MathUtils.lerp(spec.branches.startHeight * 0.85, 0.98, i / Math.max(1, rings - 1));
    const center = trunk.path.getPoint(t);
    const shrink = 1 - i / rings;
    // Overlap consecutive rings so gaps don't read as stacked discs.
    const radius = spec.trunk.height * 0.24 * f.size * (0.32 + shrink * 0.78);
    const height = spec.trunk.height * 0.2 * f.size * (0.48 + shrink * 0.62);
    const sides = Math.max(6, 9 - Math.floor(i / 3));
    const cone = new THREE.ConeGeometry(radius, height, sides, 1, true);
    const pos = cone.getAttribute('position');
    const v = new THREE.Vector3();
    for (let k = 0; k < pos.count; k += 1) {
      v.fromBufferAttribute(pos, k);
      if (v.y < 0) {
        const jag = 1 + (rand() - 0.5) * 2 * (f.skirtJagged ?? 0.4);
        v.x *= jag;
        v.z *= jag;
        v.y -= height * f.droop * 0.55;
      } else {
        // Soften the tip so stacked cones blend into one silhouette.
        v.x *= 0.92;
        v.z *= 0.92;
      }
      pos.setXYZ(k, v.x, v.y, v.z);
    }
    cone.computeVertexNormals();
    // Pull each ring down slightly over the one below for a continuous skirt.
    const nest = height * 0.28;
    const at = center.clone().setY(center.y + height * 0.22 - nest * (1 - shrink));
    matrix.compose(at, quat.setFromAxisAngle(UP, THREE.MathUtils.degToRad(37 * i + rand() * 8)), scale);
    // Radial normals melt the stacked cones into one soft conifer body instead of hard lampshades;
    // the ring's own centre keeps a hint of tier separation.
    builder.addGeometry(cone, matrix, jitterColor(shade(center, 0.35), rand), windWeight(spec, 1, trunk.length * t, maxDist), t, {
      radialCenter: at.clone().setY(at.y - height * 0.25),
      canopyCenter: trunk.path.getPoint(0.55),
      canopyBlend: 0.3,
    });
    cone.dispose();
  }
}

function emitFronds(
  trunk: TreeBranch,
  anchors: TreeBranch[],
  spec: TreeSpec,
  maxDist: number,
  rand: () => number,
  builder: MeshBuilder,
  shade: ShadeFn,
  matrix: THREE.Matrix4,
  quat: THREE.Quaternion,
  scale: THREE.Vector3,
): void {
  const f = spec.foliage;
  const branch = anchors[anchors.length - 1] ?? trunk;
  const tipTrunkT = branch.level === 0 ? 1 : branch.trunkT;
  const crown = branch.path.getPoint(1);
  const count = f.frondCount ?? 9;
  for (let i = 0; i < count; i += 1) {
    const yaw = (i / count) * Math.PI * 2 + rand() * 0.25;
    const pitch = THREE.MathUtils.degToRad(8 + rand() * 18);
    const geo = buildFrond(f.size, f.droop, rand);
    quat.setFromEuler(new THREE.Euler(pitch, yaw, (rand() - 0.5) * 0.2));
    matrix.compose(crown, quat, scale.set(1, 1, 1));
    builder.addGeometry(geo, matrix, jitterColor(shade(crown), rand), windWeight(spec, 1, branch.distFromRoot + branch.length, maxDist), tipTrunkT);
    geo.dispose();
  }
}

function emitStrands(anchors: TreeBranch[], spec: TreeSpec, maxDist: number, rand: () => number, builder: MeshBuilder, shade: ShadeFn): void {
  const f = spec.foliage;
  for (const branch of anchors) {
    const tipTrunkT = branch.level === 0 ? 1 : branch.trunkT;
    for (let i = 0; i < Math.round(f.density); i += 1) {
      const t = 0.4 + rand() * 0.6;
      const anchor = branch.path.getPoint(t);
      anchor.x += (rand() - 0.5) * 0.6;
      anchor.z += (rand() - 0.5) * 0.6;
      const dist = branch.distFromRoot + branch.length * t;
      // A strand may sweep low, but never through the ground it stands on.
      const length = Math.min(f.strandLength ?? 3.2, Math.max(0.3, anchor.y - 0.12));
      emitStrand(builder, spec, anchor, length, jitterColor(shade(anchor), rand), windWeight(spec, branch.level + 1, dist, maxDist), tipTrunkT, rand);
    }
  }
}

function placeFromCrownOrTip(
  useCrown: boolean,
  branch: TreeBranch,
  volume: CrownVolume,
  f: TreeSpec['foliage'],
  rand: () => number,
  scratch: THREE.Vector3,
): { center: THREE.Vector3; t: number } {
  if (useCrown) {
    sampleCrown(volume, rand, scratch);
    scratch.y -= f.droop * f.size * 0.2;
    return { center: scratch.clone(), t: f.crownLift };
  }
  const t = 0.55 + rand() * 0.45;
  const center = branch.path.getPoint(t);
  center.x += (rand() - 0.5) * f.size;
  center.z += (rand() - 0.5) * f.size;
  center.y += (rand() - 0.5) * f.size * 0.55 - f.droop * f.size * 0.3;
  return { center, t };
}

function emitBlobs(
  anchors: TreeBranch[],
  volume: CrownVolume,
  spec: TreeSpec,
  maxDist: number,
  rand: () => number,
  builder: MeshBuilder,
  shade: ShadeFn,
  matrix: THREE.Matrix4,
  quat: THREE.Quaternion,
  scale: THREE.Vector3,
  scratch: THREE.Vector3,
): void {
  const f = spec.foliage;
  const fill = f.crownFill;
  const floorY = canopyFloor(spec);
  const centroid = volume.center;
  for (const branch of capAnchors(anchors, 32)) {
    const tipTrunkT = branch.level === 0 ? 1 : branch.trunkT;
    for (let i = 0; i < Math.round(f.density); i += 1) {
      const { center, t } = placeFromCrownOrTip(rand() < fill, branch, volume, f, rand, scratch);
      const s = f.size * (1 + (rand() - 0.5) * 2 * f.sizeVariance);
      center.y = Math.max(center.y, floorY + s * 0.5);
      matrix.compose(center, quat.setFromAxisAngle(UP, rand() * Math.PI * 2), scale.set(s, s * 0.82, s));
      const dist = branch.distFromRoot + branch.length * t;
      const lump = lumpGeometry(BLOB_GEO, rand, 0.16);
      builder.addGeometry(lump, matrix, jitterColor(shade(center), rand), windWeight(spec, branch.level + 1, dist, maxDist), tipTrunkT, {
        radialCenter: center,
        canopyCenter: centroid,
      });
      lump.dispose();
    }
  }
  // Pure crown fill when density is low but fill is high — keeps a solid silhouette.
  const extra = Math.round(f.density * fill * Math.min(anchors.length, 32) * 0.35);
  for (let i = 0; i < extra; i += 1) {
    sampleCrown(volume, rand, scratch);
    scratch.y -= f.droop * f.size * 0.15;
    const s = f.size * (0.85 + rand() * 0.4);
    scratch.y = Math.max(scratch.y, floorY + s * 0.5);
    const at = scratch.clone();
    matrix.compose(at, quat.setFromAxisAngle(UP, rand() * Math.PI * 2), scale.set(s, s * 0.8, s));
    const lump = lumpGeometry(BLOB_GEO, rand, 0.16);
    builder.addGeometry(lump, matrix, jitterColor(shade(at), rand), windWeight(spec, 2, maxDist * 0.7, maxDist), f.crownLift, {
      radialCenter: at,
      canopyCenter: centroid,
    });
    lump.dispose();
  }
}

/**
 * Stylized Unreal/Fortnite canopy: fewer, chunkier icosahedra packed into the crown ellipsoid so the
 * tree reads as one painted volume with soft secondary lobes.
 */
function emitClusters(
  anchors: TreeBranch[],
  volume: CrownVolume,
  spec: TreeSpec,
  maxDist: number,
  rand: () => number,
  builder: MeshBuilder,
  shade: ShadeFn,
  matrix: THREE.Matrix4,
  quat: THREE.Quaternion,
  scale: THREE.Vector3,
  scratch: THREE.Vector3,
): void {
  const f = spec.foliage;
  const floorY = canopyFloor(spec);
  const centroid = volume.center;
  const capped = capAnchors(anchors, 32);
  const tipCount = Math.max(2, Math.round(f.density * capped.length * (1 - f.crownFill * 0.5)));
  const crownCount = Math.max(3, Math.round(4 + f.density * 3 * f.crownFill + capped.length * f.crownFill));

  // Structural lobes near branch tips.
  for (let i = 0; i < tipCount; i += 1) {
    const branch = capped[i % capped.length];
    const tipTrunkT = branch.level === 0 ? 1 : branch.trunkT;
    const { center, t } = placeFromCrownOrTip(false, branch, volume, f, rand, scratch);
    const s = f.size * (1.05 + (rand() - 0.5) * 2 * f.sizeVariance);
    center.y = Math.max(center.y, floorY + s * 0.45);
    matrix.compose(center, quat.setFromAxisAngle(UP, rand() * Math.PI * 2), scale.set(s * 1.05, s * 0.78, s * 1.05));
    const dist = branch.distFromRoot + branch.length * t;
    const lump = lumpGeometry(CLUSTER_GEO, rand, 0.2);
    builder.addGeometry(lump, matrix, jitterColor(shade(center), rand), windWeight(spec, branch.level + 1, dist, maxDist), tipTrunkT, {
      radialCenter: center,
      canopyCenter: centroid,
    });
    lump.dispose();
  }

  // Crown volume fill — the Unreal "paint the canopy" pass.
  for (let i = 0; i < crownCount; i += 1) {
    sampleCrown(volume, rand, scratch);
    scratch.y -= f.droop * f.size * 0.18;
    const s = f.size * (0.9 + rand() * 0.55) * (1 + (rand() - 0.5) * f.sizeVariance);
    // Flatten slightly and vary aspect so lobes don't look like identical balloons.
    const sx = s * (0.95 + rand() * 0.2);
    const sy = s * (0.7 + rand() * 0.25);
    const sz = s * (0.95 + rand() * 0.2);
    scratch.y = Math.max(scratch.y, floorY + sy * 0.6);
    const at = scratch.clone();
    matrix.compose(at, quat.setFromAxisAngle(UP, rand() * Math.PI * 2), scale.set(sx, sy, sz));
    const lump = lumpGeometry(CLUSTER_GEO, rand, 0.2);
    builder.addGeometry(lump, matrix, jitterColor(shade(at), rand), windWeight(spec, 2, maxDist * (0.55 + rand() * 0.35), maxDist), f.crownLift, {
      radialCenter: at,
      canopyCenter: centroid,
    });
    lump.dispose();
  }
}

function emitCards(
  anchors: TreeBranch[],
  volume: CrownVolume,
  spec: TreeSpec,
  maxDist: number,
  rand: () => number,
  builder: MeshBuilder,
  shade: ShadeFn,
  matrix: THREE.Matrix4,
  quat: THREE.Quaternion,
  scale: THREE.Vector3,
  scratch: THREE.Vector3,
  centroid: THREE.Vector3,
): void {
  const f = spec.foliage;
  const fill = f.crownFill;
  const floorY = canopyFloor(spec);
  for (const branch of capAnchors(anchors, 32)) {
    const tipTrunkT = branch.level === 0 ? 1 : branch.trunkT;
    for (let i = 0; i < Math.round(f.density); i += 1) {
      const useCrown = rand() < fill;
      const { center: anchor, t } = placeFromCrownOrTip(useCrown, branch, volume, f, rand, scratch);
      const dist = branch.distFromRoot + branch.length * t;
      const wind = windWeight(spec, branch.level + 1, dist, maxDist);
      for (let c = 0; c < (f.cardsPerCluster ?? 6); c += 1) {
        const center = anchor.clone();
        center.x += (rand() - 0.5) * f.size * 1.4;
        center.z += (rand() - 0.5) * f.size * 1.4;
        center.y += (rand() - 0.5) * f.size - f.droop * f.size * 0.45;
        center.y = Math.max(center.y, floorY);
        const s = f.size * (1 + (rand() - 0.5) * 2 * f.sizeVariance);
        quat.setFromEuler(new THREE.Euler(rand() * Math.PI, rand() * Math.PI * 2, rand() * Math.PI));
        matrix.compose(center, quat, scale.set(s, s, s));
        const outward = center.clone().sub(centroid);
        outward.setLength(1);
        if (!Number.isFinite(outward.x)) outward.copy(UP);
        const pixel = spec.look.pixelArt;
        builder.addGeometry(
          CARD_GEO,
          matrix,
          jitterColor(shade(center), rand),
          wind,
          tipTrunkT,
          outward,
          pixel.enabled
            ? {
                uvRect: pixelCanopyUvRect(pixel.leafArt, Math.floor(rand() * 3)),
                billboard: pixel.billboard ? { center, size: s } : undefined,
              }
            : undefined,
        );
      }
    }
  }
}

/** Palm frond: tapered plane bent downward, serrated silhouette in geometry. */
function buildFrond(size: number, droop: number, rand: () => number): THREE.BufferGeometry {
  const segments = 6;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    const x = t * size;
    const y = -droop * size * t * t;
    const halfW = size * 0.16 * (1 - t * 0.8) * (1 + (rand() - 0.5) * 0.3);
    positions.push(x, y, -halfW, x, y, halfW);
    uvs.push(t, 0, t, 1);
    if (i > 0) {
      const a = (i - 1) * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

/** Willow strand: narrow ribbon hanging under gravity, whipping at the free end. */
function emitStrand(
  builder: MeshBuilder,
  spec: TreeSpec,
  anchor: THREE.Vector3,
  length: number,
  color: THREE.Color,
  baseWind: number,
  trunkT: number,
  rand: () => number,
): void {
  const segments = 7;
  const width = 0.09 * spec.foliage.size;
  const drift = new THREE.Vector3(rand() - 0.5, 0, rand() - 0.5).normalize().multiplyScalar(length * 0.3);
  const normal = new THREE.Vector3(0, 0, 1);
  const p = new THREE.Vector3();
  let prev = -1;
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    p.copy(anchor).addScaledVector(drift, t * t).setY(anchor.y - length * t);
    const wind = baseWind + t * t * 2.2;
    const a = builder.vertex(p.clone().setX(p.x - width), normal, 0, t, color, wind, trunkT);
    const b = builder.vertex(p.clone().setX(p.x + width), normal, 1, t, color, wind, trunkT);
    if (prev >= 0) builder.quad(prev, prev + 1, b, a);
    prev = a;
  }
}

// --- entry point --------------------------------------------------------------------------------------

export interface GenerateTreeOptions {
  /** LOD level. 1 and 2 re-run the SAME seed with reduced params so the silhouette stays put. */
  lod?: number;
}

export function generateTree(spec: TreeSpec, seed: number, options: GenerateTreeOptions = {}): GeneratedTree {
  const lod = options.lod ?? 0;
  const effective = lod === 0 ? spec : reduceForLod(spec, lod);
  const rand = treeRng(seed);

  const branches = buildSkeleton(effective, rand);
  let maxDist = 0;
  for (const b of branches) maxDist = Math.max(maxDist, b.distFromRoot + b.length);

  const barkBuilder = new MeshBuilder();
  sweepBark(branches, effective, maxDist, rand, barkBuilder);
  const foliageBuilder = new MeshBuilder();
  emitFoliage(branches, effective, maxDist, rand, foliageBuilder);

  const bark = barkBuilder.toGeometry();
  const foliage = foliageBuilder.vertexCount > 0 ? foliageBuilder.toGeometry() : null;

  const bounds = bark.boundingBox?.clone() ?? new THREE.Box3();
  if (foliage?.boundingBox) bounds.union(foliage.boundingBox);

  return {
    bark,
    foliage,
    bounds,
    triangles: (barkBuilder.indices.length + foliageBuilder.indices.length) / 3,
    trunkHeight: effective.trunk.height,
  };
}

/** LOD re-runs the generator with cheaper params — not a decimator. Same seed keeps the silhouette. */
function reduceForLod(spec: TreeSpec, lod: number): TreeSpec {
  if (lod >= 2) {
    return {
      ...spec,
      trunk: { ...spec.trunk, radialSegments: Math.max(3, Math.round(spec.trunk.radialSegments / 2)), heightSegments: 4, gnarl: 0 },
      branches: { ...spec.branches, levels: 0, countPerLevel: [] },
      foliage: {
        ...spec.foliage,
        // Pixel trees must keep card UVs at distance; mapping the cutout atlas onto a solid LOD
        // cluster would punch arbitrary holes through it. Ordinary trees still collapse to blobs.
        strategy:
          spec.foliage.strategy === 'none'
            ? 'none'
            : spec.look.pixelArt.enabled
              ? 'cards'
              : 'clusters',
        density: 1,
        size: spec.foliage.size * (spec.look.pixelArt.enabled ? 1.25 : 2.4),
        sizeVariance: 0,
        crownFill: 1,
        cardsPerCluster: spec.look.pixelArt.enabled ? 3 : spec.foliage.cardsPerCluster,
      },
    };
  }
  return {
    ...spec,
    trunk: { ...spec.trunk, radialSegments: Math.max(3, Math.round(spec.trunk.radialSegments / 2)), gnarl: spec.trunk.gnarl * 0.5 },
    branches: { ...spec.branches, levels: Math.min(spec.branches.levels, 1), countPerLevel: spec.branches.countPerLevel.slice(0, 1) },
    foliage: { ...spec.foliage, density: Math.max(1, spec.foliage.density * 0.45), crownFill: Math.min(1, spec.foliage.crownFill + 0.15) },
  };
}
