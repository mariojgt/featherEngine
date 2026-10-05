import type { ModelPartMesh } from '../types';
import {
  buildTopology,
  cross3,
  dot3,
  makePolyMesh,
  meshFaces,
  normalize3,
  polygonArea,
  polygonNormal,
  type Vec3,
} from './polyMesh';

/**
 * UV unwrapping for Model Forge mesh parts. Pure data, no three.js.
 *
 * Every method writes `faceUVs` (one [u, v] per face corner, parallel to `faces`) and leaves the
 * vertices, faces, slots and sharp edges alone. UVs follow the three.js primitive convention: V points
 * up on side faces and each face's UV loop keeps the CCW winding of its 3D loop, so textures are never
 * mirrored. Projections run on WORLD-scaled positions (unit-space vertex × `partScale`) so a 2 m part
 * tiles twice as often as a 1 m one, the texel density the rest of the scene uses.
 */

export type UnwrapMethod = 'box' | 'planar' | 'cylinder' | 'sphere' | 'smart';
export type UVAxis = 'x' | 'y' | 'z';
export type UV = [number, number];

export interface UnwrapOptions {
  /** The part's `scale` (unit-space vertex × scale = world position). Default [1, 1, 1]. */
  partScale?: Vec3;
  /** Texture repeats multiplier. Default 1. */
  tiling?: number;
  /** 'planar' projection axis. Default 'y'. */
  axis?: UVAxis;
  /** 'smart' chart angle limit in degrees. Default 66. */
  angleLimit?: number;
  /** 'smart' gap between packed charts, in 0..1 UV units. Default 0.01. */
  margin?: number;
}

export interface UVBounds {
  min: UV;
  max: UV;
}

const TAU = Math.PI * 2;

// ------------------------------------------------------------------------------------------------
// Shared helpers
// ------------------------------------------------------------------------------------------------

function scaledVertices(mesh: ModelPartMesh, partScale: Vec3 | undefined): Vec3[] {
  const s = partScale ?? [1, 1, 1];
  const sx = Number.isFinite(s[0]) && s[0] !== 0 ? s[0] : 1;
  const sy = Number.isFinite(s[1]) && s[1] !== 0 ? s[1] : 1;
  const sz = Number.isFinite(s[2]) && s[2] !== 0 ? s[2] : 1;
  return mesh.vertices.map((v) => [v[0] * sx, v[1] * sy, v[2] * sz]);
}

function withUVs(mesh: ModelPartMesh, faces: number[][], faceUVs: UV[][]): ModelPartMesh {
  return makePolyMesh(mesh.vertices, faces, {
    faceSlots: mesh.faceSlots,
    faceUVs,
    sharpEdges: mesh.sharpEdges,
  });
}

function bounds3(points: readonly Vec3[]): { min: Vec3; max: Vec3; center: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let k = 0; k < 3; k += 1) {
      if (p[k] < min[k]) min[k] = p[k];
      if (p[k] > max[k]) max[k] = p[k];
    }
  }
  if (!points.length) return { min: [0, 0, 0], max: [0, 0, 0], center: [0, 0, 0] };
  return { min, max, center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2] };
}

/**
 * The (u, v) projection of a point seen from outside a face whose normal points along ±axis. Right ×
 * up = normal for every one of the six directions, so UV winding matches the 3D winding (no mirrors).
 *  +X: u=-z v=y   -X: u=z v=y   +Z: u=x v=y   -Z: u=-x v=y   +Y: u=x v=-z   -Y: u=x v=z
 */
function axisProject(p: readonly number[], axis: 0 | 1 | 2, positive: boolean): UV {
  if (axis === 0) return positive ? [-p[2], p[1]] : [p[2], p[1]];
  if (axis === 2) return positive ? [p[0], p[1]] : [-p[0], p[1]];
  return positive ? [p[0], -p[2]] : [p[0], p[2]];
}

function dominantAxis(n: readonly number[]): { axis: 0 | 1 | 2; positive: boolean } {
  const ax = Math.abs(n[0]);
  const ay = Math.abs(n[1]);
  const az = Math.abs(n[2]);
  // Ties favour the side axes so a 45° bevel gets an upright V.
  if (ax >= ay && ax >= az) return { axis: 0, positive: n[0] >= 0 };
  if (az >= ay) return { axis: 2, positive: n[2] >= 0 };
  return { axis: 1, positive: n[1] >= 0 };
}

/** Orthonormal (u, v) basis on the plane of `normal` with u × v = normal (no mirroring). */
function planeBasis(normal: Vec3): { u: Vec3; v: Vec3 } {
  const up: Vec3 = Math.abs(normal[1]) < 0.99 ? [0, 1, 0] : normal[1] > 0 ? [0, 0, -1] : [0, 0, 1];
  const u = normalize3(cross3(up, normal));
  const v = cross3(normal, u);
  return { u, v };
}

/** Signed area of a 2D polygon (positive = CCW). */
function signedArea2(points: readonly UV[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area / 2;
}

/**
 * Faces straddling the U wrap (one corner near 0.98, the next near 0.02) must not stretch back across
 * the whole texture: lift the small values by 1 so the face stays a narrow continuous strip.
 */
function fixSeam(us: number[]): number[] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const u of us) {
    if (u < lo) lo = u;
    if (u > hi) hi = u;
  }
  if (hi - lo <= 0.5) return us;
  return us.map((u) => (u < 0.5 ? u + 1 : u));
}

/** Angle around +Y measured from +Z towards +X, as 0..1. */
const wrapU = (x: number, z: number): number => {
  const u = Math.atan2(x, z) / TAU + 0.5;
  return u >= 1 ? u - 1 : u;
};

/**
 * U for one face's corners around the Y axis. Corners ON the axis (cone tips, sphere poles) have no
 * meaningful angle, so they take the mean U of the face's other corners after the seam fix.
 */
function radialUs(points: readonly Vec3[], center: Vec3, epsilon: number): number[] {
  const onAxis = points.map((p) => Math.hypot(p[0] - center[0], p[2] - center[2]) < epsilon);
  const raw = points.map((p) => wrapU(p[0] - center[0], p[2] - center[2]));
  const valid = raw.filter((_, i) => !onAxis[i]);
  if (!valid.length) return raw.map(() => 0.5);
  const fixedValid = fixSeam(valid);
  const mean = fixedValid.reduce((sum, u) => sum + u, 0) / fixedValid.length;
  let cursor = 0;
  return raw.map((_, i) => (onAxis[i] ? mean : fixedValid[cursor++]));
}

// ------------------------------------------------------------------------------------------------
// Projections
// ------------------------------------------------------------------------------------------------

function boxUVs(points: Vec3[], faces: number[][], tiling: number): UV[][] {
  return faces.map((loop) => {
    const { axis, positive } = dominantAxis(polygonNormal(points, loop));
    return loop.map((index) => {
      const [u, v] = axisProject(points[index], axis, positive);
      return [u * tiling, v * tiling] as UV;
    });
  });
}

function planarUVs(points: Vec3[], faces: number[][], axisName: UVAxis, tiling: number): UV[][] {
  const axis = axisName === 'x' ? 0 : axisName === 'z' ? 2 : 1;
  const projected = points.map((p) => axisProject(p, axis, true));
  // Fit the projected footprint into 0..1 (uniformly, so the image keeps its aspect), then tile.
  let minU = Infinity;
  let minV = Infinity;
  let maxU = -Infinity;
  let maxV = -Infinity;
  for (const loop of faces) {
    for (const index of loop) {
      const [u, v] = projected[index];
      minU = Math.min(minU, u);
      minV = Math.min(minV, v);
      maxU = Math.max(maxU, u);
      maxV = Math.max(maxV, v);
    }
  }
  const span = Math.max(maxU - minU, maxV - minV, 1e-9);
  return faces.map((loop) =>
    loop.map((index) => {
      const [u, v] = projected[index];
      return [((u - minU) / span) * tiling, ((v - minV) / span) * tiling] as UV;
    }),
  );
}

function cylinderUVs(points: Vec3[], faces: number[][], tiling: number): UV[][] {
  const { min, max, center } = bounds3(points);
  const height = Math.max(max[1] - min[1], 1e-9);
  let radius = 1e-9;
  for (const p of points) radius = Math.max(radius, Math.hypot(p[0] - center[0], p[2] - center[2]));
  const epsilon = radius * 1e-4;
  return faces.map((loop) => {
    const corners = loop.map((index) => points[index]);
    const normal = polygonNormal(points, loop);
    if (Math.abs(normal[1]) > 0.9) {
      // Caps have no meaningful angle span: map them as a disc (planar, seen from outside).
      const positive = normal[1] >= 0;
      return corners.map((p) => {
        const [u, v] = axisProject([p[0] - center[0], 0, p[2] - center[2]], 1, positive);
        return [(u / (2 * radius) + 0.5) * tiling, (v / (2 * radius) + 0.5) * tiling] as UV;
      });
    }
    const us = radialUs(corners, center, epsilon);
    return corners.map((p, i) => [us[i] * tiling, ((p[1] - min[1]) / height) * tiling] as UV);
  });
}

function sphereUVs(points: Vec3[], faces: number[][], tiling: number): UV[][] {
  const { center } = bounds3(points);
  let radius = 1e-9;
  for (const p of points) radius = Math.max(radius, Math.hypot(p[0] - center[0], p[1] - center[1], p[2] - center[2]));
  const epsilon = radius * 1e-4;
  return faces.map((loop) => {
    const corners = loop.map((index) => points[index]);
    const us = radialUs(corners, center, epsilon);
    return corners.map((p, i) => {
      const r = Math.max(Math.hypot(p[0] - center[0], p[1] - center[1], p[2] - center[2]), 1e-12);
      const v = 0.5 + Math.asin(Math.max(-1, Math.min(1, (p[1] - center[1]) / r))) / Math.PI;
      return [us[i] * tiling, v * tiling] as UV;
    });
  });
}

// ------------------------------------------------------------------------------------------------
// Smart UV project
// ------------------------------------------------------------------------------------------------

interface Chart {
  faces: number[];
  /** Per chart face, per corner, the chart-local UV (pre-packing, world units). */
  uvs: UV[][];
  width: number;
  height: number;
}

function convexHull(points: UV[]): UV[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length < 3) return sorted;
  const cross = (o: UV, a: UV, b: UV) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: UV[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: UV[] = [];
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Rotate a chart to its minimum-area bounding rectangle (landscape), then move it to the origin. */
function orientChart(uvs: UV[][]): { uvs: UV[][]; width: number; height: number } {
  const all = uvs.flat();
  const hull = convexHull(all);
  let bestAngle = 0;
  let bestArea = Infinity;
  const candidates = hull.length >= 2 ? hull.map((p, i) => {
    const q = hull[(i + 1) % hull.length];
    return Math.atan2(q[1] - p[1], q[0] - p[0]);
  }) : [0];
  candidates.push(0);
  for (const angle of candidates) {
    const c = Math.cos(-angle);
    const s = Math.sin(-angle);
    let minU = Infinity;
    let minV = Infinity;
    let maxU = -Infinity;
    let maxV = -Infinity;
    for (const [u, v] of hull.length ? hull : all) {
      const ru = u * c - v * s;
      const rv = u * s + v * c;
      minU = Math.min(minU, ru);
      maxU = Math.max(maxU, ru);
      minV = Math.min(minV, rv);
      maxV = Math.max(maxV, rv);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < bestArea - 1e-12) {
      bestArea = area;
      bestAngle = angle;
    }
  }
  const rotate = (angle: number, list: UV[][]): UV[][] => {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return list.map((face) => face.map(([u, v]) => [u * c - v * s, u * s + v * c] as UV));
  };
  let rotated = rotate(-bestAngle, uvs);
  let box = uvBoundsOf(rotated.flat());
  if (box.max[1] - box.min[1] > box.max[0] - box.min[0]) {
    rotated = rotate(Math.PI / 2, rotated); // landscape packs tighter on shelves
    box = uvBoundsOf(rotated.flat());
  }
  const moved = rotated.map((face) => face.map(([u, v]) => [u - box.min[0], v - box.min[1]] as UV));
  return { uvs: moved, width: box.max[0] - box.min[0], height: box.max[1] - box.min[1] };
}

function uvBoundsOf(points: readonly UV[]): UVBounds {
  const min: UV = [Infinity, Infinity];
  const max: UV = [-Infinity, -Infinity];
  for (const [u, v] of points) {
    if (u < min[0]) min[0] = u;
    if (v < min[1]) min[1] = v;
    if (u > max[0]) max[0] = u;
    if (v > max[1]) max[1] = v;
  }
  if (!points.length) return { min: [0, 0], max: [0, 0] };
  return { min, max };
}

function buildCharts(points: Vec3[], faces: number[][], angleLimitDeg: number): Chart[] {
  const topology = buildTopology({ vertices: points, faces });
  const normals = faces.map((loop) => polygonNormal(points, loop));
  const areas = faces.map((loop) => polygonArea(points, loop));
  const cosLimit = Math.cos((Math.max(1, Math.min(89, angleLimitDeg)) * Math.PI) / 180);
  const assigned = new Array<boolean>(faces.length).fill(false);
  // Seed from the largest faces first: big flat regions become clean, dominant charts.
  const order = faces.map((_, i) => i).sort((a, b) => areas[b] - areas[a]);
  const charts: Chart[] = [];
  for (const seed of order) {
    if (assigned[seed]) continue;
    const seedNormal = normals[seed];
    const members: number[] = [];
    const queue = [seed];
    assigned[seed] = true;
    while (queue.length) {
      const face = queue.pop()!;
      members.push(face);
      for (const edge of topology.faceEdges[face]) {
        for (const neighbour of topology.edgeFaces[edge]) {
          if (assigned[neighbour]) continue;
          if (dot3(normals[neighbour], seedNormal) < cosLimit) continue;
          if (areas[neighbour] < 1e-14 && dot3(normals[neighbour], seedNormal) <= 0) continue;
          assigned[neighbour] = true;
          queue.push(neighbour);
        }
      }
    }
    // Project on the area-weighted average normal; fall back to the seed normal if that would fold a
    // face over (every member is within the angle limit of the seed, so the seed plane never folds).
    const sum: Vec3 = [0, 0, 0];
    for (const face of members) {
      sum[0] += normals[face][0] * areas[face];
      sum[1] += normals[face][1] * areas[face];
      sum[2] += normals[face][2] * areas[face];
    }
    let normal = normalize3(sum);
    if (normal[0] === 0 && normal[1] === 0 && normal[2] === 0) normal = seedNormal;
    const project = (n: Vec3): UV[][] => {
      const { u, v } = planeBasis(n);
      return members.map((face) => faces[face].map((index) => [dot3(points[index], u), dot3(points[index], v)] as UV));
    };
    let uvs = project(normal);
    const folds = uvs.some((faceUVs, i) => areas[members[i]] > 1e-12 && signedArea2(faceUVs) <= 0);
    if (folds && (seedNormal[0] || seedNormal[1] || seedNormal[2])) uvs = project(seedNormal);
    const oriented = orientChart(uvs);
    charts.push({ faces: members, uvs: oriented.uvs, width: oriented.width, height: oriented.height });
  }
  return charts;
}

interface Placement {
  x: number;
  y: number;
}

/** Shelf-pack scaled rects into the unit square. Returns null when they do not fit. */
function shelfPack(charts: Chart[], order: number[], scale: number, margin: number): Placement[] | null {
  const placements: Placement[] = new Array(charts.length);
  let x = margin;
  let y = margin;
  let shelfHeight = 0;
  for (const index of order) {
    const w = charts[index].width * scale;
    const h = charts[index].height * scale;
    if (w + 2 * margin > 1 + 1e-12 || h + 2 * margin > 1 + 1e-12) return null;
    if (x + w + margin > 1 + 1e-12) {
      y += shelfHeight + margin;
      x = margin;
      shelfHeight = 0;
    }
    if (y + h + margin > 1 + 1e-12) return null;
    placements[index] = { x, y };
    x += w + margin;
    shelfHeight = Math.max(shelfHeight, h);
  }
  return placements;
}

function smartUVs(points: Vec3[], faces: number[][], angleLimit: number, marginOption: number): UV[][] {
  const charts = buildCharts(points, faces, angleLimit);
  const margin = Math.max(0, Math.min(0.2, marginOption));
  const order = charts.map((_, i) => i).sort((a, b) => charts[b].height - charts[a].height || charts[b].width - charts[a].width);
  const result: UV[][] = faces.map((loop) => loop.map(() => [0, 0] as UV));
  const maxSide = charts.reduce((m, c) => Math.max(m, c.width, c.height), 0);
  if (maxSide < 1e-12) return result;
  const totalArea = charts.reduce((sum, c) => sum + c.width * c.height, 0);
  // Binary-search the largest uniform scale whose shelf packing fits. The lower bound always fits
  // only when each chart can sit on its own row, so verify and shrink it until it does.
  let lo = Math.min((1 - 2 * margin) / maxSide, Math.sqrt(1 / Math.max(totalArea, 1e-18))) * 0.25;
  let best = shelfPack(charts, order, lo, margin);
  let guard = 0;
  while (!best && guard < 60) {
    lo *= 0.5;
    best = shelfPack(charts, order, lo, margin);
    guard += 1;
  }
  if (!best) {
    // Margin too large for this many charts: shrink the gap rather than overlapping.
    return margin > 0 ? smartUVs(points, faces, angleLimit, margin / 4 < 1e-5 ? 0 : margin / 4) : result;
  }
  let hi = Math.max(lo * 2, (1 - 2 * margin) / maxSide);
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    const placed = shelfPack(charts, order, mid, margin);
    if (placed) {
      lo = mid;
      best = placed;
    } else {
      hi = mid;
    }
  }
  const scale = lo;
  charts.forEach((chart, c) => {
    const { x, y } = best![c];
    chart.faces.forEach((face, i) => {
      result[face] = chart.uvs[i].map(([u, v]) => [x + u * scale, y + v * scale] as UV);
    });
  });
  return result;
}

// ------------------------------------------------------------------------------------------------
// Public API
// ------------------------------------------------------------------------------------------------

/**
 * Generate `faceUVs` for a mesh part. Returns a new mesh; vertices, faces, slots and sharp edges are
 * unchanged.
 *  - 'box': tri-planar — each face projected on its dominant-axis plane in world units × tiling.
 *  - 'planar': everything projected along `axis`, fitted to 0..1 (aspect kept) × tiling.
 *  - 'cylinder': U = angle around Y through the mesh center, V = height 0..1; caps map as discs.
 *  - 'sphere': U = angle around Y, V = latitude 0..1.
 *  - 'smart': angle-limited charts, each projected on its own plane, packed without overlap into 0..1
 *    at one uniform scale (texture-bake / paint ready). `tiling` is ignored here.
 */
export function unwrapMesh(mesh: ModelPartMesh, method: UnwrapMethod, options: UnwrapOptions = {}): ModelPartMesh {
  const faces = meshFaces(mesh);
  const points = scaledVertices(mesh, options.partScale);
  const tiling = Number.isFinite(options.tiling) && options.tiling! > 0 ? options.tiling! : 1;
  let faceUVs: UV[][];
  switch (method) {
    case 'planar':
      faceUVs = planarUVs(points, faces, options.axis ?? 'y', tiling);
      break;
    case 'cylinder':
      faceUVs = cylinderUVs(points, faces, tiling);
      break;
    case 'sphere':
      faceUVs = sphereUVs(points, faces, tiling);
      break;
    case 'smart':
      faceUVs = smartUVs(
        points,
        faces,
        Number.isFinite(options.angleLimit) ? options.angleLimit! : 66,
        Number.isFinite(options.margin) ? options.margin! : 0.01,
      );
      break;
    case 'box':
    default:
      faceUVs = boxUVs(points, faces, tiling);
      break;
  }
  return withUVs(mesh, faces, faceUVs);
}

/** UV extents over every face corner, or null when the mesh has no UVs. */
export function uvBounds(mesh: ModelPartMesh): UVBounds | null {
  if (!mesh.faceUVs?.length) return null;
  return uvBoundsOf(mesh.faceUVs.flat());
}

/** Uniformly scale + offset the UVs so they fit 0..1 (aspect kept, so texel density stays even). */
export function normalizeUVs(mesh: ModelPartMesh): ModelPartMesh {
  const box = uvBounds(mesh);
  if (!box || !mesh.faceUVs) return mesh;
  const span = Math.max(box.max[0] - box.min[0], box.max[1] - box.min[1], 1e-12);
  const faceUVs = mesh.faceUVs.map((face) =>
    face.map(([u, v]) => [(u - box.min[0]) / span, (v - box.min[1]) / span] as UV),
  );
  return withUVs(mesh, meshFaces(mesh), faceUVs);
}

/**
 * True when any two faces overlap in UV space by more than a sliver (shared edges and corners do not
 * count). Used to verify bake-ready unwraps; O(n log n)-ish via a sort-and-sweep on U.
 */
export function chartsOverlap(mesh: ModelPartMesh, tolerance = 1e-7): boolean {
  if (!mesh.faceUVs?.length) return false;
  const triangles: Array<{ face: number; tri: [UV, UV, UV]; min: UV; max: UV }> = [];
  mesh.faceUVs.forEach((uvs, face) => {
    for (let i = 1; i + 1 < uvs.length; i += 1) {
      const tri: [UV, UV, UV] = [uvs[0], uvs[i], uvs[i + 1]];
      if (Math.abs(signedArea2(tri)) < 1e-14) continue;
      const box = uvBoundsOf(tri);
      triangles.push({ face, tri, min: box.min, max: box.max });
    }
  });
  triangles.sort((a, b) => a.min[0] - b.min[0]);
  for (let i = 0; i < triangles.length; i += 1) {
    const a = triangles[i];
    for (let j = i + 1; j < triangles.length; j += 1) {
      const b = triangles[j];
      if (b.min[0] > a.max[0] - tolerance) break;
      if (a.face === b.face) continue;
      if (b.min[1] > a.max[1] - tolerance || a.min[1] > b.max[1] - tolerance) continue;
      if (trianglesOverlap(a.tri, b.tri, tolerance)) return true;
    }
  }
  return false;
}

/** Separating-axis test on two 2D triangles; touching within `tolerance` counts as separate. */
function trianglesOverlap(a: [UV, UV, UV], b: [UV, UV, UV], tolerance: number): boolean {
  for (const tri of [a, b]) {
    for (let i = 0; i < 3; i += 1) {
      const p = tri[i];
      const q = tri[(i + 1) % 3];
      const length = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (length < 1e-14) continue;
      const nx = -(q[1] - p[1]) / length;
      const ny = (q[0] - p[0]) / length;
      let minA = Infinity;
      let maxA = -Infinity;
      let minB = Infinity;
      let maxB = -Infinity;
      for (const point of a) {
        const d = point[0] * nx + point[1] * ny;
        minA = Math.min(minA, d);
        maxA = Math.max(maxA, d);
      }
      for (const point of b) {
        const d = point[0] * nx + point[1] * ny;
        minB = Math.min(minB, d);
        maxB = Math.max(maxB, d);
      }
      if (maxA <= minB + tolerance || maxB <= minA + tolerance) return false;
    }
  }
  return true;
}
