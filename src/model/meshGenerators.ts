import type { ModelPartMesh } from '../types';
import { add3, cross3, dot3, edgeKey, length3, makePolyMesh, normalize3, scale3, sub3, type Vec3 } from './polyMesh';

/**
 * Clean quad-topology shape builders for Model Forge (unit space). Every builder returns a poly mesh
 * with outward CCW winding, shared vertices (no duplicate seams), per-corner UVs and hard rims
 * marked in `sharpEdges` so subdivision and auto-smooth keep them crisp.
 */

type UV = [number, number];

const EPS = 1e-9;
const TAU = Math.PI * 2;
const clampInt = (value: number, min: number, max: number, fallback: number) =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback;

/** Builder accumulating faces + attributes with consecutive-duplicate cleanup (pole collapse). */
class MeshBuilder {
  vertices: Vec3[] = [];
  faces: number[][] = [];
  faceUVs: UV[][] = [];
  sharpEdges: Array<[number, number]> = [];
  private sharpSeen = new Set<number>();

  vertex(p: Vec3): number {
    this.vertices.push(p);
    return this.vertices.length - 1;
  }

  face(loop: number[], uvs: UV[]): void {
    const kept: number[] = [];
    const keptUVs: UV[] = [];
    loop.forEach((index, corner) => {
      if (kept.length && kept[kept.length - 1] === index) return;
      kept.push(index);
      keptUVs.push(uvs[corner]);
    });
    while (kept.length > 1 && kept[0] === kept[kept.length - 1]) {
      kept.pop();
      keptUVs.pop();
    }
    if (kept.length < 3 || new Set(kept).size !== kept.length) return;
    this.faces.push(kept);
    this.faceUVs.push(keptUVs);
  }

  sharp(a: number, b: number): void {
    if (a === b || this.sharpSeen.has(edgeKey(a, b))) return;
    this.sharpSeen.add(edgeKey(a, b));
    this.sharpEdges.push([a, b]);
  }

  build(): ModelPartMesh {
    return makePolyMesh(this.vertices, this.faces, {
      faceUVs: this.faceUVs,
      sharpEdges: this.sharpEdges,
    });
  }
}

// ------------------------------------------------------------------------------------------------
// Cube + plane
// ------------------------------------------------------------------------------------------------

/** Unit cube (±0.5) with each side split into a `segments`² quad grid; edge vertices are shared. */
export function polyCube(segments = 1): ModelPartMesh {
  const s = clampInt(segments, 1, 32, 1);
  const builder = new MeshBuilder();
  const ids = new Map<number, number>();
  const at = (i: number, j: number, k: number) => {
    const key = (i * (s + 1) + j) * (s + 1) + k;
    let id = ids.get(key);
    if (id === undefined) {
      id = builder.vertex([i / s - 0.5, j / s - 0.5, k / s - 0.5]);
      ids.set(key, id);
    }
    return id;
  };
  // Each side: fixed axis + value, and (u, v) axes with u × v = outward normal.
  const sides: Array<{ axis: number; value: number; u: number; v: number }> = [
    { axis: 0, value: s, u: 1, v: 2 }, // +X: Y × Z
    { axis: 0, value: 0, u: 2, v: 1 }, // -X: Z × Y
    { axis: 1, value: s, u: 2, v: 0 }, // +Y: Z × X
    { axis: 1, value: 0, u: 0, v: 2 }, // -Y: X × Z
    { axis: 2, value: s, u: 0, v: 1 }, // +Z: X × Y
    { axis: 2, value: 0, u: 1, v: 0 }, // -Z: Y × X
  ];
  for (const side of sides) {
    const grid = (a: number, b: number) => {
      const c = [0, 0, 0];
      c[side.axis] = side.value;
      c[side.u] = a;
      c[side.v] = b;
      return at(c[0], c[1], c[2]);
    };
    for (let a = 0; a < s; a += 1) {
      for (let b = 0; b < s; b += 1) {
        builder.face(
          [grid(a, b), grid(a + 1, b), grid(a + 1, b + 1), grid(a, b + 1)],
          [
            [a / s, b / s],
            [(a + 1) / s, b / s],
            [(a + 1) / s, (b + 1) / s],
            [a / s, (b + 1) / s],
          ],
        );
      }
    }
  }
  return builder.build();
}

/** Single-sided grid plane at y = 0 facing +Y, spanning ±0.5 in X and Z. */
export function polyPlane(segmentsX = 1, segmentsZ = 1): ModelPartMesh {
  const sx = clampInt(segmentsX, 1, 128, 1);
  const sz = clampInt(segmentsZ, 1, 128, 1);
  const builder = new MeshBuilder();
  const id = (i: number, j: number) => i * (sz + 1) + j;
  for (let i = 0; i <= sx; i += 1) {
    for (let j = 0; j <= sz; j += 1) builder.vertex([i / sx - 0.5, 0, j / sz - 0.5]);
  }
  const uv = (i: number, j: number): UV => [i / sx, 1 - j / sz];
  for (let i = 0; i < sx; i += 1) {
    for (let j = 0; j < sz; j += 1) {
      builder.face([id(i, j), id(i, j + 1), id(i + 1, j + 1), id(i + 1, j)], [uv(i, j), uv(i, j + 1), uv(i + 1, j + 1), uv(i + 1, j)]);
    }
  }
  return builder.build();
}

// ------------------------------------------------------------------------------------------------
// Lathe (surfaces of revolution) — cylinder, cone, sphere and capsule are built on it
// ------------------------------------------------------------------------------------------------

interface LatheInternalOptions {
  /** Profile indices whose revolved ring is a hard rim (marked sharp). */
  sharpRings?: number[];
}

function latheInternal(
  inputProfile: ReadonlyArray<readonly [number, number]>,
  segmentsIn: number,
  angleDeg: number,
  capEnds: boolean,
  options: LatheInternalOptions = {},
): ModelPartMesh {
  // Drop invalid + consecutive duplicate points; negative radii fold onto the axis.
  let profile: Array<[number, number]> = [];
  for (const point of inputProfile) {
    if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
    const p: [number, number] = [Math.max(0, point[0]), point[1]];
    const last = profile[profile.length - 1];
    if (last && Math.abs(last[0] - p[0]) < EPS && Math.abs(last[1] - p[1]) < EPS) continue;
    profile.push(p);
  }
  let sharpRings = new Set(options.sharpRings ?? []);
  if (profile.length < 2) return makePolyMesh([], []);

  // Orientation: the profile closed along the axis must run CCW in (r, y) so normals face outward.
  const closedLoop: Array<[number, number]> = [[0, profile[0][1]], ...profile, [0, profile[profile.length - 1][1]]];
  let area = 0;
  for (let i = 0; i < closedLoop.length; i += 1) {
    const a = closedLoop[i];
    const b = closedLoop[(i + 1) % closedLoop.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  if (area < 0) {
    const last = profile.length - 1;
    profile = profile.reverse();
    sharpRings = new Set([...sharpRings].map((index) => last - index));
  }

  const sweep = Number.isFinite(angleDeg) ? Math.max(1, Math.min(360, Math.abs(angleDeg))) : 360;
  const full = sweep >= 360 - 1e-6;
  const segments = clampInt(segmentsIn, 3, 256, 24);
  const columns = full ? segments : segments + 1;
  const sweepRad = (sweep * Math.PI) / 180;

  // Arc-length v coordinate along the profile.
  const lengths = [0];
  for (let k = 1; k < profile.length; k += 1) {
    lengths.push(lengths[k - 1] + Math.hypot(profile[k][0] - profile[k - 1][0], profile[k][1] - profile[k - 1][1]));
  }
  const total = Math.max(EPS, lengths[lengths.length - 1]);

  const builder = new MeshBuilder();
  const rings: number[][] = profile.map(([r, y]) => {
    if (r < EPS) {
      const pole = builder.vertex([0, y, 0]);
      return Array.from({ length: columns }, () => pole);
    }
    return Array.from({ length: columns }, (_, j) => {
      const theta = (sweepRad * j) / segments;
      return builder.vertex([r * Math.sin(theta), y, r * Math.cos(theta)]);
    });
  });
  const isPole = profile.map(([r]) => r < EPS);
  const column = (j: number) => (full ? j % segments : j);

  for (let k = 0; k + 1 < profile.length; k += 1) {
    if (isPole[k] && isPole[k + 1]) continue;
    const v0 = lengths[k] / total;
    const v1 = lengths[k + 1] / total;
    for (let j = 0; j < segments; j += 1) {
      const u0 = j / segments;
      const u1 = (j + 1) / segments;
      const um = (j + 0.5) / segments;
      builder.face(
        [rings[k][column(j)], rings[k][column(j + 1)], rings[k + 1][column(j + 1)], rings[k + 1][column(j)]],
        [
          [isPole[k] ? um : u0, v0],
          [isPole[k] ? um : u1, v0],
          [isPole[k + 1] ? um : u1, v1],
          [isPole[k + 1] ? um : u0, v1],
        ],
      );
    }
  }

  for (const k of sharpRings) {
    if (k < 0 || k >= profile.length || isPole[k]) continue;
    for (let j = 0; j < segments; j += 1) builder.sharp(rings[k][column(j)], rings[k][column(j + 1)]);
  }

  if (capEnds) {
    const first = 0;
    const last = profile.length - 1;
    const planarUV = (index: number): UV => {
      const p = builder.vertices[index];
      const r = Math.max(EPS, Math.max(profile[first][0], profile[last][0], 0.5));
      return [0.5 + (0.5 * p[0]) / r, 0.5 + (0.5 * p[2]) / r];
    };
    if (full) {
      // Ring caps: the first ring always faces -Y, the last +Y (profile is CCW in (r, y)).
      if (!isPole[first]) {
        const loop = [...rings[first]].reverse();
        builder.face(loop, loop.map(planarUV));
        for (let j = 0; j < segments; j += 1) builder.sharp(rings[first][j], rings[first][(j + 1) % segments]);
      }
      if (!isPole[last]) {
        const loop = [...rings[last]];
        builder.face(loop, loop.map(planarUV));
        for (let j = 0; j < segments; j += 1) builder.sharp(rings[last][j], rings[last][(j + 1) % segments]);
      }
    } else {
      // Partial sweep: close both open profile sides (profile + axis) and the end-ring sectors.
      const axisFirst = isPole[first] ? rings[first][0] : builder.vertex([0, profile[first][1], 0]);
      const axisLast = isPole[last] ? rings[last][0] : builder.vertex([0, profile[last][1], 0]);
      const sideLoop = (j: number) => {
        const loop = [axisFirst, ...profile.map((_, k) => rings[k][j]), axisLast];
        return loop.filter((index, i) => i === 0 || index !== loop[i - 1]);
      };
      const sideUV = (loop: number[]): UV[] =>
        loop.map((index) => {
          const p = builder.vertices[index];
          return [Math.hypot(p[0], p[2]), p[1] + 0.5];
        });
      const start = sideLoop(0);
      builder.face(start, sideUV(start));
      const end = sideLoop(segments).reverse();
      builder.face(end, sideUV(end));
      for (const loop of [start, end]) {
        for (let i = 0; i < loop.length; i += 1) builder.sharp(loop[i], loop[(i + 1) % loop.length]);
      }
      if (!isPole[first]) {
        const loop = [axisFirst, ...[...rings[first]].reverse()];
        builder.face(loop, loop.map(planarUV));
        for (let j = 0; j < segments; j += 1) builder.sharp(rings[first][j], rings[first][j + 1]);
      }
      if (!isPole[last]) {
        const loop = [axisLast, ...rings[last]];
        builder.face(loop, loop.map(planarUV));
        for (let j = 0; j < segments; j += 1) builder.sharp(rings[last][j], rings[last][j + 1]);
      }
    }
  }
  return builder.build();
}

/**
 * Revolve a `[radius, y]` profile around +Y (θ = 0 at +Z, like three.js). A full 360° sweep shares
 * its seam vertices; radius-0 points collapse to one pole vertex (triangle fans, no degenerate
 * quads). `capEnds` closes open rings with n-gons and, for partial sweeps, the two open sides.
 * Coordinates stay in the caller's units; winding is fixed up to face away from the axis.
 */
export function lathe(profile: Array<[number, number]>, segments = 24, angleDeg = 360, capEnds = true): ModelPartMesh {
  return latheInternal(profile, segments, angleDeg, capEnds);
}

/** Cylinder r = 0.5, h = 1. `capFill` 'ngon' = one polygon per cap, 'fan' = triangles to a center. */
export function polyCylinder(sides = 16, heightSegments = 1, capFill: 'ngon' | 'fan' = 'ngon'): ModelPartMesh {
  const hs = clampInt(heightSegments, 1, 64, 1);
  const wall: Array<[number, number]> = Array.from({ length: hs + 1 }, (_, k) => [0.5, -0.5 + k / hs]);
  if (capFill === 'fan') {
    return latheInternal([[0, -0.5], ...wall, [0, 0.5]], sides, 360, false, { sharpRings: [1, hs + 1] });
  }
  return latheInternal(wall, sides, 360, true, { sharpRings: [0, hs] });
}

/** Cone r = 0.5, h = 1: n-gon base, triangle sides meeting at the apex. */
export function polyCone(sides = 16): ModelPartMesh {
  return latheInternal([[0.5, -0.5], [0, 0.5]], sides, 360, true, { sharpRings: [0] });
}

/** UV sphere r = 0.5: quad bands with triangle fans at the poles. */
export function polySphere(segments = 24, rings = 12): ModelPartMesh {
  const r = clampInt(rings, 2, 128, 12);
  const profile: Array<[number, number]> = Array.from({ length: r + 1 }, (_, k) => {
    const phi = Math.PI * (1 - k / r); // bottom pole → top pole
    return [k === 0 || k === r ? 0 : 0.5 * Math.sin(phi), 0.5 * Math.cos(phi)];
  });
  return latheInternal(profile, segments, 360, false);
}

/** Capsule: radius 0.25, straight length 0.5 (total height 1). `rings` = bands per hemisphere. */
export function polyCapsule(sides = 16, rings = 6): ModelPartMesh {
  const n = clampInt(rings, 1, 64, 6);
  const radius = 0.25;
  const half = 0.25;
  const profile: Array<[number, number]> = [];
  for (let k = 0; k <= n; k += 1) {
    const a = -Math.PI / 2 + (Math.PI / 2) * (k / n);
    profile.push([k === 0 ? 0 : radius * Math.cos(a), -half + radius * Math.sin(a)]);
  }
  for (let k = 0; k <= n; k += 1) {
    const a = (Math.PI / 2) * (k / n);
    profile.push([k === n ? 0 : radius * Math.cos(a), half + radius * Math.sin(a)]);
  }
  return latheInternal(profile, sides, 360, false);
}

/**
 * Torus in the XY plane around +Z (three.js TorusGeometry orientation). The tube radius is
 * `0.5 * minorRatio` and the ring radius fills the rest so the torus spans ±0.5.
 */
export function polyTorus(majorSegments = 24, minorSegments = 12, minorRatio = 0.3): ModelPartMesh {
  const M = clampInt(majorSegments, 3, 256, 24);
  const m = clampInt(minorSegments, 3, 128, 12);
  const ratio = Number.isFinite(minorRatio) ? Math.min(0.95, Math.max(0.02, minorRatio)) : 0.3;
  const tube = 0.5 * ratio;
  const ring = 0.5 - tube;
  const builder = new MeshBuilder();
  for (let i = 0; i < M; i += 1) {
    const alpha = (TAU * i) / M;
    for (let j = 0; j < m; j += 1) {
      const beta = (TAU * j) / m;
      const d = ring + tube * Math.cos(beta);
      builder.vertex([d * Math.cos(alpha), d * Math.sin(alpha), tube * Math.sin(beta)]);
    }
  }
  const id = (i: number, j: number) => (i % M) * m + (j % m);
  for (let i = 0; i < M; i += 1) {
    for (let j = 0; j < m; j += 1) {
      builder.face(
        [id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)],
        [
          [i / M, j / m],
          [(i + 1) / M, j / m],
          [(i + 1) / M, (j + 1) / m],
          [i / M, (j + 1) / m],
        ],
      );
    }
  }
  return builder.build();
}

// ------------------------------------------------------------------------------------------------
// Tube sweep
// ------------------------------------------------------------------------------------------------

export interface TubeFrame {
  tangent: Vec3;
  normal: Vec3;
  binormal: Vec3;
}

/**
 * Rotation-minimizing (parallel-transport) frames along a polyline via the double-reflection
 * method, so the swept cross-section never flips or twists. Closed paths distribute the leftover
 * holonomy twist evenly so the seam matches.
 */
export function parallelTransportFrames(path: readonly Vec3[], closed = false): TubeFrame[] {
  const n = path.length;
  if (n < 2) return [];
  const tangents: Vec3[] = path.map((_, i) => {
    if (closed) return normalize3(sub3(path[(i + 1) % n], path[(i + n - 1) % n]));
    if (i === 0) return normalize3(sub3(path[1], path[0]));
    if (i === n - 1) return normalize3(sub3(path[n - 1], path[n - 2]));
    const a = normalize3(sub3(path[i], path[i - 1]));
    const b = normalize3(sub3(path[i + 1], path[i]));
    const t = normalize3(add3(a, b));
    return length3(t) > 0 ? t : b;
  });
  const t0 = tangents[0];
  const helper: Vec3 = Math.abs(t0[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let normal = normalize3(cross3(cross3(t0, helper), t0));
  const normals: Vec3[] = [normal];
  const transport = (from: number, to: number, r: Vec3): Vec3 => {
    const v1 = sub3(path[to], path[from]);
    const c1 = dot3(v1, v1);
    if (c1 < EPS * EPS) return r;
    const rL = sub3(r, scale3(v1, (2 / c1) * dot3(v1, r)));
    const tL = sub3(tangents[from], scale3(v1, (2 / c1) * dot3(v1, tangents[from])));
    const v2 = sub3(tangents[to], tL);
    const c2 = dot3(v2, v2);
    const next = c2 < EPS * EPS ? rL : sub3(rL, scale3(v2, (2 / c2) * dot3(v2, rL)));
    // Re-orthogonalize against drift.
    const t = tangents[to];
    return normalize3(sub3(next, scale3(t, dot3(next, t))));
  };
  for (let i = 1; i < n; i += 1) {
    normal = transport(i - 1, i, normal);
    normals.push(normal);
  }
  if (closed) {
    const back = transport(n - 1, 0, normal);
    const binormal0 = cross3(t0, normals[0]);
    const twist = Math.atan2(dot3(back, binormal0), dot3(back, normals[0]));
    for (let i = 1; i < n; i += 1) {
      const angle = (-twist * i) / n;
      const t = tangents[i];
      const b = cross3(t, normals[i]);
      normals[i] = normalize3(add3(scale3(normals[i], Math.cos(angle)), scale3(b, Math.sin(angle))));
    }
  }
  return tangents.map((tangent, i) => ({ tangent, normal: normals[i], binormal: normalize3(cross3(tangent, normals[i])) }));
}

/** Sweep a circle along a polyline (pipes, handles, cables) with parallel-transport frames. */
export function tube(path: Vec3[], radius = 0.05, sides = 8, closed = false, capEnds = true): ModelPartMesh {
  const points: Vec3[] = [];
  for (const p of path ?? []) {
    if (!p || !p.every?.(Number.isFinite)) continue;
    const last = points[points.length - 1];
    if (last && length3(sub3(p, last)) < 1e-7) continue;
    points.push([p[0], p[1], p[2]]);
  }
  if (closed && points.length > 2 && length3(sub3(points[0], points[points.length - 1])) < 1e-7) points.pop();
  const isClosed = closed && points.length >= 3;
  if (points.length < 2) return makePolyMesh([], []);
  const s = clampInt(sides, 3, 128, 8);
  const r = Number.isFinite(radius) && radius > 0 ? radius : 0.05;
  const frames = parallelTransportFrames(points, isClosed);
  const builder = new MeshBuilder();
  const n = points.length;
  const ringIds = points.map((p, i) => {
    const { normal, binormal } = frames[i];
    return Array.from({ length: s }, (_, j) => {
      const phi = (TAU * j) / s;
      return builder.vertex(add3(p, add3(scale3(normal, r * Math.cos(phi)), scale3(binormal, r * Math.sin(phi)))));
    });
  });
  const along = [0];
  for (let i = 1; i <= n; i += 1) {
    if (i === n && !isClosed) break;
    along.push(along[i - 1] + length3(sub3(points[i % n], points[i - 1])));
  }
  const totalLength = Math.max(EPS, along[along.length - 1]);
  const segmentCount = isClosed ? n : n - 1;
  for (let i = 0; i < segmentCount; i += 1) {
    const a = ringIds[i];
    const b = ringIds[(i + 1) % n];
    const v0 = along[i] / totalLength;
    const v1 = along[i + 1] / totalLength;
    for (let j = 0; j < s; j += 1) {
      const jn = (j + 1) % s;
      builder.face(
        [a[j], a[jn], b[jn], b[j]],
        [
          [j / s, v0],
          [(j + 1) / s, v0],
          [(j + 1) / s, v1],
          [j / s, v1],
        ],
      );
    }
  }
  if (!isClosed && capEnds) {
    const capUV = (j: number): UV => [0.5 + 0.5 * Math.cos((TAU * j) / s), 0.5 + 0.5 * Math.sin((TAU * j) / s)];
    const startOrder = Array.from({ length: s }, (_, j) => s - 1 - j);
    builder.face(startOrder.map((j) => ringIds[0][j]), startOrder.map(capUV));
    const endOrder = Array.from({ length: s }, (_, j) => j);
    builder.face(endOrder.map((j) => ringIds[n - 1][j]), endOrder.map(capUV));
    for (const ring of [ringIds[0], ringIds[n - 1]]) {
      for (let j = 0; j < s; j += 1) builder.sharp(ring[j], ring[(j + 1) % s]);
    }
  }
  return builder.build();
}

// ------------------------------------------------------------------------------------------------
// Built-in primitives as clean poly meshes
// ------------------------------------------------------------------------------------------------

function polyWedge(): ModelPartMesh {
  const h = 0.5;
  const vertices: Vec3[] = [
    [-h, -h, h], // 0 FLD
    [h, -h, h], // 1 FRD
    [-h, -h, -h], // 2 BLD
    [h, -h, -h], // 3 BRD
    [-h, h, -h], // 4 BLU
    [h, h, -h], // 5 BRU
  ];
  const faces = [
    [0, 1, 5, 4], // slope
    [0, 2, 3, 1], // bottom
    [3, 2, 4, 5], // back
    [0, 4, 2], // left
    [1, 3, 5], // right
  ];
  const faceUVs = faces.map((loop) => loop.map((index) => {
    const [x, y, z] = vertices[index];
    return [x + h, (y + z) * 0.5 + h] as UV;
  }));
  return makePolyMesh(vertices, faces, { faceUVs });
}

export type PrimitivePolyShape = 'box' | 'cylinder' | 'sphere' | 'cone' | 'torus' | 'pyramid' | 'hexprism' | 'capsule' | 'wedge';

/**
 * Clean quad version of each built-in part shape, matching the unit three.js geometries in
 * `getModelPartGeometry` (dimensions, orientation and segment counts) — used when a primitive is
 * converted to an editable mesh so the user gets real quads instead of triangle soup.
 */
export function generatePrimitivePolyMesh(shape: PrimitivePolyShape): ModelPartMesh {
  switch (shape) {
    case 'cylinder':
      return polyCylinder(20);
    case 'sphere':
      return polySphere(24, 16);
    case 'cone':
      return polyCone(20);
    case 'torus':
      return polyTorus(28, 12, 0.3);
    case 'pyramid':
      return polyCone(4);
    case 'hexprism':
      return polyCylinder(6);
    case 'capsule':
      return polyCapsule(16, 8);
    case 'wedge':
      return polyWedge();
    case 'box':
    default:
      return polyCube(1);
  }
}
