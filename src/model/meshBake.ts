import { BufferAttribute, BufferGeometry, Vector3 } from 'three';
import { MeshBVH, type HitPointInfo } from 'three-mesh-bvh';
import type { ModelPart, ModelPartMesh } from '../types';
import { evaluateModifiers } from './meshModifiers';
import { buildRenderArrays } from './meshRenderArrays';
import { chartsOverlap, unwrapMesh } from './meshUV';
import { ensurePolyMesh, meshFaces, type Vec3 } from './polyMesh';

/**
 * Texture baking for Model Forge mesh parts: ambient occlusion, tangent-space normal map and base
 * color, written into plain RGBA pixel buffers (row 0 = TOP of the image = v 1, the three.js
 * flipY texture convention). Pure computation — no DOM — so it runs in workers and under vitest.
 *
 * LOW mesh = the part's polygon cage with its (non-overlapping) faceUVs; HIGH mesh = the cage after
 * the modifier stack (subdivision etc.) which supplies the detail. Everything happens in part-local
 * WORLD-SCALED space (unit vertex × part.scale) so distances and normals survive non-uniform scale.
 */

export type BakeMap = 'ao' | 'normal' | 'color';

export interface BakeOptions {
  /** Texture size in pixels (square). Default 512, clamped 64..2048. */
  size?: number;
  /** AO rays per texel. Default 16, clamped 4..128. */
  samples?: number;
  /** Max occluder distance in world units. Default 0.3 × the high mesh bbox diagonal. */
  aoDistance?: number;
  /** 0..1 darkening strength. Default 1. */
  aoStrength?: number;
  /** Edge dilation in pixels. Default 4. */
  padding?: number;
  /** Palette (hex strings) for the base color bake. */
  palette?: readonly string[];
  /** Extra occluding geometry (other parts), already in this part's local world-scaled space. */
  occluders?: Array<{ positions: Float32Array; indices: Uint32Array }>;
  /** Auto-smooth angle for the low/high shading normals. Default part.smoothAngle ?? 40. */
  smoothAngle?: number;
  /** Cage offset for the low→high projection, world units. Default 2% of the bbox diagonal. */
  cageDistance?: number;
  /** Multiply the baked base color by AO when both are requested. Default true. */
  multiplyAO?: boolean;
}

export interface BakeResult {
  width: number;
  height: number;
  ao?: Uint8ClampedArray;
  normal?: Uint8ClampedArray;
  color?: Uint8ClampedArray;
  /** Fraction of texels covered by UV triangles (before padding). */
  coverage: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function hasValidUVs(mesh: ModelPartMesh): boolean {
  const faces = meshFaces(mesh);
  return (
    !!mesh.faceUVs &&
    mesh.faceUVs.length === faces.length &&
    mesh.faceUVs.every((uvs, f) => uvs?.length === faces[f].length && uvs.every((uv) => finite(uv?.[0]) && finite(uv?.[1])))
  );
}

function uvsInUnitSquare(mesh: ModelPartMesh): boolean {
  const eps = 1e-6;
  return (mesh.faceUVs ?? []).every((uvs) => uvs.every(([u, v]) => u >= -eps && u <= 1 + eps && v >= -eps && v <= 1 + eps));
}

/**
 * The part, guaranteed bake-ready: when the cage has no UVs, UVs outside 0..1 (tiled box/planar
 * projections) or overlapping charts, a Smart UV unwrap replaces them. Otherwise returns `part`.
 */
export function ensureBakeUVs(part: ModelPart): ModelPart {
  if (!part.mesh) throw new Error('Only mesh parts can be baked — convert the part to a mesh first');
  const mesh = ensurePolyMesh(part.mesh);
  if (hasValidUVs(mesh) && uvsInUnitSquare(mesh) && !chartsOverlap(mesh)) return mesh === part.mesh ? part : { ...part, mesh };
  return { ...part, mesh: unwrapMesh(mesh, 'smart', { partScale: part.scale }) };
}

function parseHex(hex: string | undefined, fallback: [number, number, number]): [number, number, number] {
  if (typeof hex !== 'string') return fallback;
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split('').map((c) => c + c).join('');
  if (h.length === 8) h = h.slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return fallback;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function partScale(part: ModelPart): Vec3 {
  const s = part.scale ?? [1, 1, 1];
  return [0, 1, 2].map((i) => (finite(s[i]) && s[i] !== 0 ? s[i] : 1)) as Vec3;
}

function scalePositions(src: Float32Array, s: Vec3): Float32Array {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    out[i] = src[i] * s[0];
    out[i + 1] = src[i + 1] * s[1];
    out[i + 2] = src[i + 2] * s[2];
  }
  return out;
}

/** Normals under scale: inverse-transpose = divide by scale, then renormalize. */
function scaleNormals(src: Float32Array, s: Vec3): Float32Array {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    const x = src[i] / s[0];
    const y = src[i + 1] / s[1];
    const z = src[i + 2] / s[2];
    const l = Math.hypot(x, y, z) || 1;
    out[i] = x / l;
    out[i + 1] = y / l;
    out[i + 2] = z / l;
  }
  return out;
}

function makeBVH(positions: Float32Array, indices: Uint32Array): { bvh: MeshBVH; index: Uint32Array } {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  // MeshBVH reorders the index buffer in place — always hand it a private copy.
  const index = new Uint32Array(indices);
  geometry.setIndex(new BufferAttribute(index, 1));
  const bvh = new MeshBVH(geometry, { maxLeafTris: 8 });
  return { bvh, index: geometry.index!.array as Uint32Array };
}

/** Per-vertex tangents (xyz + handedness w) from UVs: per-triangle accumulate, Gram-Schmidt. */
function computeTangents(positions: Float32Array, normals: Float32Array, uvs: Float32Array, indices: Uint32Array): Float32Array {
  const count = positions.length / 3;
  const tan = new Float64Array(count * 3);
  const bit = new Float64Array(count * 3);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t];
    const b = indices[t + 1];
    const c = indices[t + 2];
    const e1x = positions[b * 3] - positions[a * 3];
    const e1y = positions[b * 3 + 1] - positions[a * 3 + 1];
    const e1z = positions[b * 3 + 2] - positions[a * 3 + 2];
    const e2x = positions[c * 3] - positions[a * 3];
    const e2y = positions[c * 3 + 1] - positions[a * 3 + 1];
    const e2z = positions[c * 3 + 2] - positions[a * 3 + 2];
    const du1 = uvs[b * 2] - uvs[a * 2];
    const dv1 = uvs[b * 2 + 1] - uvs[a * 2 + 1];
    const du2 = uvs[c * 2] - uvs[a * 2];
    const dv2 = uvs[c * 2 + 1] - uvs[a * 2 + 1];
    const det = du1 * dv2 - du2 * dv1;
    if (Math.abs(det) < 1e-14) continue;
    // Area-weighted (no division by |det| magnitude beyond sign keeps big triangles dominant).
    const r = 1 / det;
    const tx = (e1x * dv2 - e2x * dv1) * r;
    const ty = (e1y * dv2 - e2y * dv1) * r;
    const tz = (e1z * dv2 - e2z * dv1) * r;
    const bx = (e2x * du1 - e1x * du2) * r;
    const by = (e2y * du1 - e1y * du2) * r;
    const bz = (e2z * du1 - e1z * du2) * r;
    for (const v of [a, b, c]) {
      tan[v * 3] += tx;
      tan[v * 3 + 1] += ty;
      tan[v * 3 + 2] += tz;
      bit[v * 3] += bx;
      bit[v * 3 + 1] += by;
      bit[v * 3 + 2] += bz;
    }
  }
  const out = new Float32Array(count * 4);
  for (let v = 0; v < count; v += 1) {
    const nx = normals[v * 3];
    const ny = normals[v * 3 + 1];
    const nz = normals[v * 3 + 2];
    let tx = tan[v * 3];
    let ty = tan[v * 3 + 1];
    let tz = tan[v * 3 + 2];
    const d = tx * nx + ty * ny + tz * nz;
    tx -= nx * d;
    ty -= ny * d;
    tz -= nz * d;
    let l = Math.hypot(tx, ty, tz);
    if (l < 1e-12) {
      // Any perpendicular — degenerate UVs carry no tangent frame.
      if (Math.abs(nx) < 0.9) [tx, ty, tz] = [0, -nz, ny];
      else [tx, ty, tz] = [nz, 0, -nx];
      l = Math.hypot(tx, ty, tz) || 1;
    }
    tx /= l;
    ty /= l;
    tz /= l;
    // handedness: sign of (N × T) · B
    const cx = ny * tz - nz * ty;
    const cy = nz * tx - nx * tz;
    const cz = nx * ty - ny * tx;
    const w = cx * bit[v * 3] + cy * bit[v * 3 + 1] + cz * bit[v * 3 + 2] < 0 ? -1 : 1;
    out[v * 4] = tx;
    out[v * 4 + 1] = ty;
    out[v * 4 + 2] = tz;
    out[v * 4 + 3] = w;
  }
  return out;
}

/**
 * Compact allocation-free BVH (binned SAH) for the AO hot loop: millions of short rays, nearest-hit
 * distance only. Several times faster than MeshBVH.raycastFirst, which builds Vector3s for every
 * triangle it tests and clones the result on every hit.
 */
class TraceBVH {
  private tris: Float32Array; // per triangle: v0 (3), e1 (3), e2 (3)
  private bounds: Float32Array; // per node: minX minY minZ maxX maxY maxZ
  private meta: Int32Array; // per node: [leftChild | firstTri, count (0 = interior)]
  private right: Int32Array; // per interior node: right child
  private order: Uint32Array; // leaf slot → source triangle index
  private stack = new Int32Array(128);
  /** Source triangle index of the last `nearest` hit. */
  hitTriangle = -1;
  private nodeCount = 0;

  constructor(positions: Float32Array, indices: Uint32Array) {
    const triCount = Math.floor(indices.length / 3);
    const cMin = new Float32Array(triCount * 3);
    const cMax = new Float32Array(triCount * 3);
    const centroid = new Float32Array(triCount * 3);
    for (let t = 0; t < triCount; t += 1) {
      for (let k = 0; k < 3; k += 1) {
        const a = positions[indices[t * 3] * 3 + k];
        const b = positions[indices[t * 3 + 1] * 3 + k];
        const c = positions[indices[t * 3 + 2] * 3 + k];
        cMin[t * 3 + k] = Math.min(a, b, c);
        cMax[t * 3 + k] = Math.max(a, b, c);
        centroid[t * 3 + k] = (a + b + c) / 3;
      }
    }
    const order = new Uint32Array(triCount);
    for (let t = 0; t < triCount; t += 1) order[t] = t;
    const maxNodes = Math.max(1, triCount * 2);
    this.bounds = new Float32Array(maxNodes * 6);
    this.meta = new Int32Array(maxNodes * 2);
    this.right = new Int32Array(maxNodes);
    const BINS = 12;
    const binCount = new Int32Array(BINS);
    const binBox = new Float32Array(BINS * 6);
    const area = (b: Float32Array, o: number) => {
      const x = b[o + 3] - b[o], y = b[o + 4] - b[o + 1], z = b[o + 5] - b[o + 2];
      return x < 0 ? 0 : x * y + y * z + z * x;
    };
    const build = (start: number, count: number): number => {
      const node = this.nodeCount++;
      const nb = node * 6;
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      let q0 = Infinity, r0 = Infinity, s0 = Infinity, q1 = -Infinity, r1 = -Infinity, s1 = -Infinity;
      for (let i = start; i < start + count; i += 1) {
        const t = order[i] * 3;
        x0 = Math.min(x0, cMin[t]); y0 = Math.min(y0, cMin[t + 1]); z0 = Math.min(z0, cMin[t + 2]);
        x1 = Math.max(x1, cMax[t]); y1 = Math.max(y1, cMax[t + 1]); z1 = Math.max(z1, cMax[t + 2]);
        q0 = Math.min(q0, centroid[t]); r0 = Math.min(r0, centroid[t + 1]); s0 = Math.min(s0, centroid[t + 2]);
        q1 = Math.max(q1, centroid[t]); r1 = Math.max(r1, centroid[t + 1]); s1 = Math.max(s1, centroid[t + 2]);
      }
      this.bounds[nb] = x0; this.bounds[nb + 1] = y0; this.bounds[nb + 2] = z0;
      this.bounds[nb + 3] = x1; this.bounds[nb + 4] = y1; this.bounds[nb + 5] = z1;
      const leaf = () => {
        this.meta[node * 2] = start;
        this.meta[node * 2 + 1] = count;
        return node;
      };
      if (count <= 4) return leaf();
      const ext = [q1 - q0, r1 - r0, s1 - s0];
      const axis = ext[0] >= ext[1] && ext[0] >= ext[2] ? 0 : ext[1] >= ext[2] ? 1 : 2;
      const lo = [q0, r0, s0][axis];
      const span = ext[axis];
      if (span < 1e-12) return leaf();
      binCount.fill(0);
      for (let b = 0; b < BINS; b += 1) binBox.set([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], b * 6);
      const binOf = (t: number) => Math.min(BINS - 1, Math.floor(((centroid[t * 3 + axis] - lo) / span) * BINS));
      for (let i = start; i < start + count; i += 1) {
        const t = order[i];
        const b = binOf(t);
        binCount[b] += 1;
        const o = b * 6;
        for (let k = 0; k < 3; k += 1) {
          binBox[o + k] = Math.min(binBox[o + k], cMin[t * 3 + k]);
          binBox[o + 3 + k] = Math.max(binBox[o + 3 + k], cMax[t * 3 + k]);
        }
      }
      // Sweep for the cheapest split plane.
      const leftArea = new Float64Array(BINS);
      const leftN = new Int32Array(BINS);
      const acc = new Float32Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
      let n = 0;
      for (let b = 0; b < BINS; b += 1) {
        for (let k = 0; k < 3; k += 1) {
          acc[k] = Math.min(acc[k], binBox[b * 6 + k]);
          acc[3 + k] = Math.max(acc[3 + k], binBox[b * 6 + 3 + k]);
        }
        n += binCount[b];
        leftArea[b] = area(acc, 0);
        leftN[b] = n;
      }
      acc.set([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
      let best = -1;
      let bestCost = Infinity;
      n = 0;
      for (let b = BINS - 1; b > 0; b -= 1) {
        for (let k = 0; k < 3; k += 1) {
          acc[k] = Math.min(acc[k], binBox[b * 6 + k]);
          acc[3 + k] = Math.max(acc[3 + k], binBox[b * 6 + 3 + k]);
        }
        n += binCount[b];
        const cost = leftArea[b - 1] * leftN[b - 1] + area(acc, 0) * n;
        if (leftN[b - 1] > 0 && n > 0 && cost < bestCost) {
          bestCost = cost;
          best = b;
        }
      }
      let mid: number;
      if (best < 0) {
        mid = start + (count >> 1);
      } else {
        let i = start;
        let j = start + count - 1;
        while (i <= j) {
          if (binOf(order[i]) < best) i += 1;
          else {
            const tmp = order[i]; order[i] = order[j]; order[j] = tmp;
            j -= 1;
          }
        }
        mid = i;
        if (mid === start || mid === start + count) mid = start + (count >> 1);
      }
      const left = build(start, mid - start);
      const right = build(mid, start + count - mid);
      this.meta[node * 2] = left;
      this.meta[node * 2 + 1] = 0;
      this.right[node] = right;
      return node;
    };
    if (triCount) build(0, triCount);
    this.order = order;
    this.tris = new Float32Array(triCount * 9);
    for (let i = 0; i < triCount; i += 1) {
      const t = order[i];
      const a = indices[t * 3] * 3, b = indices[t * 3 + 1] * 3, c = indices[t * 3 + 2] * 3;
      const o = i * 9;
      this.tris[o] = positions[a]; this.tris[o + 1] = positions[a + 1]; this.tris[o + 2] = positions[a + 2];
      this.tris[o + 3] = positions[b] - positions[a]; this.tris[o + 4] = positions[b + 1] - positions[a + 1]; this.tris[o + 5] = positions[b + 2] - positions[a + 2];
      this.tris[o + 6] = positions[c] - positions[a]; this.tris[o + 7] = positions[c + 1] - positions[a + 1]; this.tris[o + 8] = positions[c + 2] - positions[a + 2];
    }
  }

  /** Nearest double-sided hit distance in (tMin, tMax], or -1. */
  nearest(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, tMax: number, tMin = 1e-7): number {
    if (!this.nodeCount) return -1;
    const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
    const bounds = this.bounds, meta = this.meta, tris = this.tris, stack = this.stack;
    let best = tMax;
    let found = false;
    let hitSlot = -1;
    let sp = 0;
    stack[sp++] = 0;
    while (sp > 0) {
      const node = stack[--sp];
      const b = node * 6;
      let t0 = (bounds[b] - ox) * ix, t1 = (bounds[b + 3] - ox) * ix;
      let lo = t0 < t1 ? t0 : t1, hi = t0 < t1 ? t1 : t0;
      t0 = (bounds[b + 1] - oy) * iy; t1 = (bounds[b + 4] - oy) * iy;
      lo = Math.max(lo, t0 < t1 ? t0 : t1); hi = Math.min(hi, t0 < t1 ? t1 : t0);
      t0 = (bounds[b + 2] - oz) * iz; t1 = (bounds[b + 5] - oz) * iz;
      lo = Math.max(lo, t0 < t1 ? t0 : t1); hi = Math.min(hi, t0 < t1 ? t1 : t0);
      if (hi < lo || hi < 0 || lo > best) continue;
      const count = meta[node * 2 + 1];
      if (count === 0) {
        if (sp + 2 > stack.length) continue;
        stack[sp++] = this.right[node];
        stack[sp++] = meta[node * 2];
        continue;
      }
      const first = meta[node * 2];
      for (let i = first; i < first + count; i += 1) {
        const o = i * 9;
        const e1x = tris[o + 3], e1y = tris[o + 4], e1z = tris[o + 5];
        const e2x = tris[o + 6], e2y = tris[o + 7], e2z = tris[o + 8];
        const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (det > -1e-14 && det < 1e-14) continue;
        const inv = 1 / det;
        const sx = ox - tris[o], sy = oy - tris[o + 1], sz = oz - tris[o + 2];
        const u = (sx * px + sy * py + sz * pz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
        const v = (dx * qx + dy * qy + dz * qz) * inv;
        if (v < 0 || u + v > 1) continue;
        const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (t > tMin && t <= best) {
          best = t;
          found = true;
          hitSlot = i;
        }
      }
    }
    this.hitTriangle = found ? this.order[hitSlot] : -1;
    return found ? best : -1;
  }
}

/** Radical inverse base 2 (Van der Corput) for the Hammersley set. */
function radicalInverse(bits: number): number {
  bits = ((bits << 16) | (bits >>> 16)) >>> 0;
  bits = (((bits & 0x55555555) << 1) | ((bits & 0xaaaaaaaa) >>> 1)) >>> 0;
  bits = (((bits & 0x33333333) << 2) | ((bits & 0xcccccccc) >>> 2)) >>> 0;
  bits = (((bits & 0x0f0f0f0f) << 4) | ((bits & 0xf0f0f0f0) >>> 4)) >>> 0;
  bits = (((bits & 0x00ff00ff) << 8) | ((bits & 0xff00ff00) >>> 8)) >>> 0;
  return bits / 4294967296;
}

/** Deterministic integer hash → [0, 1). */
function hash01(n: number): number {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/**
 * Bake the requested maps for one mesh part. The cage must carry faceUVs (run `ensureBakeUVs`
 * first); overlapping charts bake but the overlap regions are last-writer-wins.
 */
export function bakePartTextures(part: ModelPart, maps: Array<BakeMap>, options: BakeOptions = {}): BakeResult {
  if (!part.mesh) throw new Error('Only mesh parts can be baked — convert the part to a mesh first');
  const cage = ensurePolyMesh(part.mesh);
  if (!hasValidUVs(cage)) throw new Error('Unwrap the part (Smart UV) before baking');

  const want = new Set(maps);
  const size = Math.round(clamp(finite(options.size) ? options.size : 512, 64, 2048));
  const W = size;
  const H = size;
  const samples = Math.round(clamp(finite(options.samples) ? options.samples : 16, 4, 128));
  const aoStrength = clamp(finite(options.aoStrength) ? options.aoStrength : 1, 0, 1);
  const padding = Math.round(clamp(finite(options.padding) ? options.padding : 4, 0, 64));
  const smoothAngle = finite(options.smoothAngle) ? options.smoothAngle : finite(part.smoothAngle) ? part.smoothAngle : 40;
  const colorSlot = Number.isInteger(part.colorSlot) ? part.colorSlot : 0;
  const s = partScale(part);

  // ---- LOW (cage) arrays ------------------------------------------------------------------------
  const lowArrays = buildRenderArrays(cage, { smoothAngle, defaultSlot: colorSlot });
  const lowPos = scalePositions(lowArrays.positions, s);
  const lowNrm = scaleNormals(lowArrays.normals, s);
  const lowUV = lowArrays.uvs!;
  const lowIdx = lowArrays.indices;
  const lowTriSlot = new Int32Array(lowIdx.length / 3);
  for (const group of lowArrays.groups) lowTriSlot.fill(group.slot, group.start / 3, (group.start + group.count) / 3);
  const lowTan = want.has('normal') ? computeTangents(lowPos, lowNrm, lowUV, lowIdx) : null;

  // ---- HIGH (modifier-evaluated) arrays + BVHs --------------------------------------------------
  const high = evaluateModifiers(cage, part.modifiers);
  const highArrays = high === cage ? lowArrays : buildRenderArrays(high, { smoothAngle, defaultSlot: colorSlot });
  const highPos = high === cage ? lowPos : scalePositions(highArrays.positions, s);
  const highNrm = high === cage ? lowNrm : scaleNormals(highArrays.normals, s);
  const highIdx = highArrays.indices;
  // Built lazily: only the rare texels whose cage rays miss need a closest-point query.
  let highBVH: { bvh: MeshBVH; index: Uint32Array } | null = null;
  const highTracer = high === cage && !want.has('ao') ? null : new TraceBVH(highPos, highIdx);

  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < highPos.length; i += 3) {
    minX = Math.min(minX, highPos[i]); maxX = Math.max(maxX, highPos[i]);
    minY = Math.min(minY, highPos[i + 1]); maxY = Math.max(maxY, highPos[i + 1]);
    minZ = Math.min(minZ, highPos[i + 2]); maxZ = Math.max(maxZ, highPos[i + 2]);
  }
  for (let i = 0; i < lowPos.length; i += 3) {
    minX = Math.min(minX, lowPos[i]); maxX = Math.max(maxX, lowPos[i]);
    minY = Math.min(minY, lowPos[i + 1]); maxY = Math.max(maxY, lowPos[i + 1]);
    minZ = Math.min(minZ, lowPos[i + 2]); maxZ = Math.max(maxZ, lowPos[i + 2]);
  }
  const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  const cageDistance = finite(options.cageDistance) && options.cageDistance > 0 ? options.cageDistance : diag * 0.02;
  const searchDepth = cageDistance + diag * 0.25;
  const aoDistance = finite(options.aoDistance) && options.aoDistance > 0 ? options.aoDistance : diag * 0.3;
  const eps = diag * 1e-4;

  let aoTracer: TraceBVH | null = highTracer;
  const occluders = (options.occluders ?? []).filter((o) => o?.positions?.length >= 9 && o.indices?.length >= 3);
  if (want.has('ao') && occluders.length) {
    const vertexTotal = highPos.length + occluders.reduce((n, o) => n + o.positions.length, 0);
    const indexTotal = highIdx.length + occluders.reduce((n, o) => n + o.indices.length, 0);
    const pos = new Float32Array(vertexTotal);
    const idx = new Uint32Array(indexTotal);
    pos.set(highPos, 0);
    idx.set(highIdx, 0);
    let pCursor = highPos.length;
    let iCursor = highIdx.length;
    for (const o of occluders) {
      const base = pCursor / 3;
      const vCount = o.positions.length / 3;
      pos.set(o.positions.subarray(0, vCount * 3), pCursor);
      for (let i = 0; i < o.indices.length; i += 1) idx[iCursor + i] = o.indices[i] < vCount ? o.indices[i] + base : base;
      pCursor += vCount * 3;
      iCursor += o.indices.length;
    }
    aoTracer = new TraceBVH(pos, idx);
  }

  // ---- Buffers ----------------------------------------------------------------------------------
  const texels = W * H;
  const covered = new Uint8Array(texels);
  const ao = want.has('ao') ? new Uint8ClampedArray(texels * 4) : undefined;
  const normal = want.has('normal') ? new Uint8ClampedArray(texels * 4) : undefined;
  const color = want.has('color') ? new Uint8ClampedArray(texels * 4) : undefined;
  const multiplyAO = options.multiplyAO !== false;
  const partColor = parseHex(options.palette?.[colorSlot], [204, 204, 204]);
  const slotColors = new Map<number, [number, number, number]>();
  const slotColor = (slot: number) => {
    let c = slotColors.get(slot);
    if (!c) {
      c = parseHex(options.palette?.[slot], partColor);
      slotColors.set(slot, c);
    }
    return c;
  };

  // Hammersley points (shared), rotated per texel (Cranley-Patterson) for reproducible noise.
  const hamU = new Float64Array(samples);
  const hamV = new Float64Array(samples);
  for (let i = 0; i < samples; i += 1) {
    hamU[i] = (i + 0.5) / samples;
    hamV[i] = radicalInverse(i);
  }

  const point = new Vector3();
  const closest: HitPointInfo = { point: new Vector3(), distance: 0, faceIndex: 0 };

  // Scratch for the high-surface lookup.
  const hp = [0, 0, 0];
  const hn = [0, 0, 0];
  const gn = [0, 0, 0];

  /** Fill hp/hn/gn from a hit triangle (vertex ids a,b,c) at point p. */
  const shadeHit = (a: number, b: number, c: number, px: number, py: number, pz: number) => {
    const ax = highPos[a * 3], ay = highPos[a * 3 + 1], az = highPos[a * 3 + 2];
    const e1x = highPos[b * 3] - ax, e1y = highPos[b * 3 + 1] - ay, e1z = highPos[b * 3 + 2] - az;
    const e2x = highPos[c * 3] - ax, e2y = highPos[c * 3 + 1] - ay, e2z = highPos[c * 3 + 2] - az;
    const qx = px - ax, qy = py - ay, qz = pz - az;
    const d00 = e1x * e1x + e1y * e1y + e1z * e1z;
    const d01 = e1x * e2x + e1y * e2y + e1z * e2z;
    const d11 = e2x * e2x + e2y * e2y + e2z * e2z;
    const d20 = qx * e1x + qy * e1y + qz * e1z;
    const d21 = qx * e2x + qy * e2y + qz * e2z;
    const den = d00 * d11 - d01 * d01;
    let v = 0, w = 0;
    if (Math.abs(den) > 1e-20) {
      v = clamp((d11 * d20 - d01 * d21) / den, 0, 1);
      w = clamp((d00 * d21 - d01 * d20) / den, 0, 1 - v);
    }
    const u = 1 - v - w;
    let nx = highNrm[a * 3] * u + highNrm[b * 3] * v + highNrm[c * 3] * w;
    let ny = highNrm[a * 3 + 1] * u + highNrm[b * 3 + 1] * v + highNrm[c * 3 + 1] * w;
    let nz = highNrm[a * 3 + 2] * u + highNrm[b * 3 + 2] * v + highNrm[c * 3 + 2] * w;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    let gx = e1y * e2z - e1z * e2y;
    let gy = e1z * e2x - e1x * e2z;
    let gz = e1x * e2y - e1y * e2x;
    const gl = Math.hypot(gx, gy, gz) || 1;
    gx /= gl; gy /= gl; gz /= gl;
    // Mirrored (negative-determinant) scale flips winding; keep the geometric normal with the shading one.
    if (gx * nx + gy * ny + gz * nz < 0) { gx = -gx; gy = -gy; gz = -gz; }
    hp[0] = px; hp[1] = py; hp[2] = pz;
    hn[0] = nx; hn[1] = ny; hn[2] = nz;
    gn[0] = gx; gn[1] = gy; gn[2] = gz;
  };

  const castHigh = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, far: number): boolean => {
    const t = highTracer!.nearest(ox, oy, oz, dx, dy, dz, far, 0);
    if (t < 0) return false;
    const f = highTracer!.hitTriangle * 3;
    shadeHit(highIdx[f], highIdx[f + 1], highIdx[f + 2], ox + dx * t, oy + dy * t, oz + dz * t);
    return true;
  };

  const lookupHigh = (px: number, py: number, pz: number, nx: number, ny: number, nz: number, fnx: number, fny: number, fnz: number) => {
    if (high === cage) {
      hp[0] = px; hp[1] = py; hp[2] = pz;
      hn[0] = nx; hn[1] = ny; hn[2] = nz;
      gn[0] = fnx; gn[1] = fny; gn[2] = fnz;
      return;
    }
    if (castHigh(px + nx * cageDistance, py + ny * cageDistance, pz + nz * cageDistance, -nx, -ny, -nz, searchDepth)) return;
    if (castHigh(px, py, pz, nx, ny, nz, searchDepth)) return;
    point.set(px, py, pz);
    highBVH ??= makeBVH(highPos, highIdx);
    const target = highBVH.bvh.closestPointToPoint(point, closest, 0, searchDepth);
    if (target && Number.isInteger(target.faceIndex)) {
      const f = target.faceIndex * 3;
      const index = highBVH.index;
      shadeHit(index[f], index[f + 1], index[f + 2], target.point.x, target.point.y, target.point.z);
      return;
    }
    hp[0] = px; hp[1] = py; hp[2] = pz;
    hn[0] = nx; hn[1] = ny; hn[2] = nz;
    gn[0] = fnx; gn[1] = fny; gn[2] = fnz;
  };

  const computeAO = (texel: number): number => {
    const nx = hn[0], ny = hn[1], nz = hn[2];
    // Orthonormal basis around the shading normal (Frisvad / Duff et al.).
    const sign = nz >= 0 ? 1 : -1;
    const a = -1 / (sign + nz);
    const b = nx * ny * a;
    const t1x = 1 + sign * nx * nx * a, t1y = sign * b, t1z = -sign * nx;
    const t2x = b, t2y = sign + ny * ny * a, t2z = -ny;
    const ox = hp[0] + gn[0] * eps, oy = hp[1] + gn[1] * eps, oz = hp[2] + gn[2] * eps;
    const shiftU = hash01(texel * 2 + 1);
    const shiftV = hash01(texel * 2 + 7919);
    let occlusion = 0;
    for (let i = 0; i < samples; i += 1) {
      let su = hamU[i] + shiftU; if (su >= 1) su -= 1;
      let sv = hamV[i] + shiftV; if (sv >= 1) sv -= 1;
      const r = Math.sqrt(su);
      const phi = 2 * Math.PI * sv;
      const lx = r * Math.cos(phi);
      const ly = r * Math.sin(phi);
      const lz = Math.sqrt(Math.max(0, 1 - su));
      let dx = t1x * lx + t2x * ly + nx * lz;
      let dy = t1y * lx + t2y * ly + ny * lz;
      let dz = t1z * lx + t2z * ly + nz * lz;
      // Never shoot below the true (geometric) surface: reflect such rays back above it.
      const below = dx * gn[0] + dy * gn[1] + dz * gn[2];
      if (below < 1e-4) {
        const k = below - 1e-3;
        dx -= 2 * k * gn[0]; dy -= 2 * k * gn[1]; dz -= 2 * k * gn[2];
        const l = Math.hypot(dx, dy, dz) || 1;
        dx /= l; dy /= l; dz /= l;
      }
      const distance = aoTracer!.nearest(ox, oy, oz, dx, dy, dz, aoDistance);
      if (distance >= 0) {
        const t = distance / aoDistance;
        occlusion += 1 - t * t;
      }
    }
    return clamp(1 - aoStrength * (occlusion / samples), 0, 1);
  };

  // ---- Rasterize every LOW triangle in UV space -------------------------------------------------
  let coveredCount = 0;
  for (let t = 0; t < lowIdx.length; t += 3) {
    const ia = lowIdx[t], ib = lowIdx[t + 1], ic = lowIdx[t + 2];
    // Pixel-space coords: texel (i, j) center sits at (i, j). Row 0 = v 1.
    const ax = lowUV[ia * 2] * W - 0.5, ay = (1 - lowUV[ia * 2 + 1]) * H - 0.5;
    const bx = lowUV[ib * 2] * W - 0.5, by = (1 - lowUV[ib * 2 + 1]) * H - 0.5;
    const cx = lowUV[ic * 2] * W - 0.5, cy = (1 - lowUV[ic * 2 + 1]) * H - 0.5;
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-12) continue;
    const inv = 1 / area;
    const x0 = Math.max(0, Math.ceil(Math.min(ax, bx, cx) - 1e-6));
    const x1 = Math.min(W - 1, Math.floor(Math.max(ax, bx, cx) + 1e-6));
    const y0 = Math.max(0, Math.ceil(Math.min(ay, by, cy) - 1e-6));
    const y1 = Math.min(H - 1, Math.floor(Math.max(ay, by, cy) + 1e-6));
    if (x0 > x1 || y0 > y1) continue;

    // Flat face normal of this low triangle (for offsets when no high data).
    const e1x = lowPos[ib * 3] - lowPos[ia * 3], e1y = lowPos[ib * 3 + 1] - lowPos[ia * 3 + 1], e1z = lowPos[ib * 3 + 2] - lowPos[ia * 3 + 2];
    const e2x = lowPos[ic * 3] - lowPos[ia * 3], e2y = lowPos[ic * 3 + 1] - lowPos[ia * 3 + 1], e2z = lowPos[ic * 3 + 2] - lowPos[ia * 3 + 2];
    let fnx = e1y * e2z - e1z * e2y, fny = e1z * e2x - e1x * e2z, fnz = e1x * e2y - e1y * e2x;
    const fl = Math.hypot(fnx, fny, fnz) || 1;
    fnx /= fl; fny /= fl; fnz /= fl;
    const avgNx = lowNrm[ia * 3] + lowNrm[ib * 3] + lowNrm[ic * 3];
    const avgNy = lowNrm[ia * 3 + 1] + lowNrm[ib * 3 + 1] + lowNrm[ic * 3 + 1];
    const avgNz = lowNrm[ia * 3 + 2] + lowNrm[ib * 3 + 2] + lowNrm[ic * 3 + 2];
    if (fnx * avgNx + fny * avgNy + fnz * avgNz < 0) { fnx = -fnx; fny = -fny; fnz = -fnz; }
    const faceColor = color ? slotColor(lowTriSlot[t / 3]) : null;
    const tol = -1e-7;

    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const w0 = ((bx - x) * (cy - y) - (by - y) * (cx - x)) * inv;
        const w1 = ((cx - x) * (ay - y) - (cy - y) * (ax - x)) * inv;
        const w2 = 1 - w0 - w1;
        if (w0 < tol || w1 < tol || w2 < tol) continue;
        const texel = y * W + x;
        if (!covered[texel]) coveredCount += 1;
        covered[texel] = 1;

        const px = lowPos[ia * 3] * w0 + lowPos[ib * 3] * w1 + lowPos[ic * 3] * w2;
        const py = lowPos[ia * 3 + 1] * w0 + lowPos[ib * 3 + 1] * w1 + lowPos[ic * 3 + 1] * w2;
        const pz = lowPos[ia * 3 + 2] * w0 + lowPos[ib * 3 + 2] * w1 + lowPos[ic * 3 + 2] * w2;
        let nx = lowNrm[ia * 3] * w0 + lowNrm[ib * 3] * w1 + lowNrm[ic * 3] * w2;
        let ny = lowNrm[ia * 3 + 1] * w0 + lowNrm[ib * 3 + 1] * w1 + lowNrm[ic * 3 + 1] * w2;
        let nz = lowNrm[ia * 3 + 2] * w0 + lowNrm[ib * 3 + 2] * w1 + lowNrm[ic * 3 + 2] * w2;
        const nl = Math.hypot(nx, ny, nz);
        if (nl > 1e-12) { nx /= nl; ny /= nl; nz /= nl; } else { nx = fnx; ny = fny; nz = fnz; }

        const needHigh = !!ao || !!normal;
        if (needHigh) lookupHigh(px, py, pz, nx, ny, nz, fnx, fny, fnz);
        const o = texel * 4;
        let aoValue = 1;
        if (ao) {
          aoValue = computeAO(texel);
          const g = Math.round(aoValue * 255);
          ao[o] = g; ao[o + 1] = g; ao[o + 2] = g; ao[o + 3] = 255;
        }
        if (normal && lowTan) {
          let tx = lowTan[ia * 4] * w0 + lowTan[ib * 4] * w1 + lowTan[ic * 4] * w2;
          let ty = lowTan[ia * 4 + 1] * w0 + lowTan[ib * 4 + 1] * w1 + lowTan[ic * 4 + 1] * w2;
          let tz = lowTan[ia * 4 + 2] * w0 + lowTan[ib * 4 + 2] * w1 + lowTan[ic * 4 + 2] * w2;
          const handed = lowTan[ia * 4 + 3] * w0 + lowTan[ib * 4 + 3] * w1 + lowTan[ic * 4 + 3] * w2 < 0 ? -1 : 1;
          const d = tx * nx + ty * ny + tz * nz;
          tx -= nx * d; ty -= ny * d; tz -= nz * d;
          const tl = Math.hypot(tx, ty, tz) || 1;
          tx /= tl; ty /= tl; tz /= tl;
          const bxv = (ny * tz - nz * ty) * handed;
          const byv = (nz * tx - nx * tz) * handed;
          const bzv = (nx * ty - ny * tx) * handed;
          let r = hn[0] * tx + hn[1] * ty + hn[2] * tz;
          let g = hn[0] * bxv + hn[1] * byv + hn[2] * bzv;
          let b = hn[0] * nx + hn[1] * ny + hn[2] * nz;
          if (b < 0) b = 0; // never encode a normal facing into the surface
          const len = Math.hypot(r, g, b) || 1;
          r /= len; g /= len; b /= len;
          normal[o] = Math.round((r * 0.5 + 0.5) * 255);
          normal[o + 1] = Math.round((g * 0.5 + 0.5) * 255);
          normal[o + 2] = Math.round((b * 0.5 + 0.5) * 255);
          normal[o + 3] = 255;
        }
        if (color && faceColor) {
          const k = ao && multiplyAO ? aoValue : 1;
          color[o] = Math.round(faceColor[0] * k);
          color[o + 1] = Math.round(faceColor[1] * k);
          color[o + 2] = Math.round(faceColor[2] * k);
          color[o + 3] = 255;
        }
      }
    }
  }

  // ---- Dilation: grow chart edges outward so mip levels never sample background ------------------
  const buffers = [ao, normal, color].filter((b): b is Uint8ClampedArray => !!b);
  if (padding > 0 && buffers.length) {
    let mask = covered;
    for (let pass = 0; pass < padding; pass += 1) {
      const next = new Uint8Array(mask);
      let grew = false;
      for (let y = 0; y < H; y += 1) {
        for (let x = 0; x < W; x += 1) {
          const texel = y * W + x;
          if (mask[texel]) continue;
          let n = 0;
          const sums = buffers.map(() => [0, 0, 0, 0]);
          for (let dy = -1; dy <= 1; dy += 1) {
            const yy = y + dy;
            if (yy < 0 || yy >= H) continue;
            for (let dx = -1; dx <= 1; dx += 1) {
              const xx = x + dx;
              if ((dx === 0 && dy === 0) || xx < 0 || xx >= W) continue;
              const nb = yy * W + xx;
              if (!mask[nb]) continue;
              n += 1;
              for (let k = 0; k < buffers.length; k += 1) {
                const buf = buffers[k];
                const sum = sums[k];
                sum[0] += buf[nb * 4]; sum[1] += buf[nb * 4 + 1]; sum[2] += buf[nb * 4 + 2]; sum[3] += buf[nb * 4 + 3];
              }
            }
          }
          if (!n) continue;
          for (let k = 0; k < buffers.length; k += 1) {
            const buf = buffers[k];
            const sum = sums[k];
            buf[texel * 4] = Math.round(sum[0] / n);
            buf[texel * 4 + 1] = Math.round(sum[1] / n);
            buf[texel * 4 + 2] = Math.round(sum[2] / n);
            buf[texel * 4 + 3] = 255;
          }
          next[texel] = 1;
          grew = true;
        }
      }
      mask = next;
      if (!grew) break;
    }
    covered.set(mask);
  }

  // ---- Background ------------------------------------------------------------------------------
  for (let texel = 0; texel < texels; texel += 1) {
    if (covered[texel]) continue;
    const o = texel * 4;
    if (ao) { ao[o] = 255; ao[o + 1] = 255; ao[o + 2] = 255; ao[o + 3] = 255; }
    if (normal) { normal[o] = 128; normal[o + 1] = 128; normal[o + 2] = 255; normal[o + 3] = 255; }
    if (color) { color[o] = partColor[0]; color[o + 1] = partColor[1]; color[o + 2] = partColor[2]; color[o + 3] = 255; }
  }

  return { width: W, height: H, ao, normal, color, coverage: coveredCount / texels };
}

// ------------------------------------------------------------------------------------------------
// Browser helpers (PNG encoding). Not exercised under jsdom.
// ------------------------------------------------------------------------------------------------

/** Encode an RGBA buffer (row 0 = top) to a PNG blob via OffscreenCanvas or a DOM canvas. */
export async function encodePng(width: number, height: number, rgba: Uint8ClampedArray): Promise<Blob> {
  const pixels = new Uint8ClampedArray(width * height * 4);
  pixels.set(rgba.subarray(0, pixels.length));
  const image = new ImageData(pixels, width, height);
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (context) {
      context.putImageData(image, 0, 0);
      return canvas.convertToBlob({ type: 'image/png' });
    }
  }
  if (typeof document === 'undefined') throw new Error('PNG encoding needs a canvas (browser only)');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('PNG encoding needs a 2D canvas context');
  context.putImageData(image, 0, 0);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Canvas PNG encoding failed'))), 'image/png'),
  );
}

/** Every baked map as a PNG File: `${baseName}-ao.png`, `-normal.png`, `-basecolor.png`. */
export async function bakeResultToFiles(result: BakeResult, baseName: string): Promise<File[]> {
  const entries: Array<[Uint8ClampedArray | undefined, string]> = [
    [result.ao, 'ao'],
    [result.normal, 'normal'],
    [result.color, 'basecolor'],
  ];
  const files: File[] = [];
  for (const [buffer, suffix] of entries) {
    if (!buffer) continue;
    const blob = await encodePng(result.width, result.height, buffer);
    files.push(new File([blob], `${baseName}-${suffix}.png`, { type: 'image/png' }));
  }
  return files;
}
