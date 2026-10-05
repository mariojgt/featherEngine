import type { ModelModifier, ModelPartMesh } from '../types';
import { buildTopology, compactMesh, edgeKey, ensurePolyMesh, makePolyMesh, meshFaces, type Vec3 } from './polyMesh';

/**
 * Non-destructive modifier stack for Model Forge mesh parts: Catmull-Clark subdivision (with
 * boundary + sharp-edge crease rules), mirror and array. Pure data, never mutates its inputs.
 * `evaluateModifiers` is memoized per mesh object + modifier JSON because it runs every render.
 */

/** Hard cap on faces a modifier stack may emit (subdivision levels / array counts back off). */
export const MAX_RENDER_FACES = 120000;
const MAX_MODIFIERS = 8;
const MAX_ARRAY_COUNT = 64;
const MAX_SUBDIVISION_LEVELS = 4;

type UV = [number, number];

const avgUV = (uvs: readonly UV[]): UV => {
  let u = 0;
  let v = 0;
  for (const uv of uvs) {
    u += uv[0];
    v += uv[1];
  }
  const n = Math.max(1, uvs.length);
  return [u / n, v / n];
};

// ------------------------------------------------------------------------------------------------
// Catmull-Clark
// ------------------------------------------------------------------------------------------------

function catmullClarkOnce(mesh: ModelPartMesh): ModelPartMesh {
  const faces = meshFaces(mesh);
  const V = mesh.vertices;
  const topo = buildTopology({ vertices: V, faces });
  const nV = V.length;
  const nE = topo.edges.length;

  const sharpKeys = new Set<number>();
  for (const [a, b] of mesh.sharpEdges ?? []) {
    if (topo.edgeIndex.has(edgeKey(a, b))) sharpKeys.add(edgeKey(a, b));
  }
  // An edge is a crease when marked sharp, on the boundary, or non-manifold.
  const edgeCrease = topo.edges.map(
    ([a, b], e) => sharpKeys.has(edgeKey(a, b)) || topo.edgeFaces[e].length !== 2,
  );

  const facePoints: Vec3[] = faces.map((loop) => {
    const p: Vec3 = [0, 0, 0];
    for (const i of loop) {
      p[0] += V[i][0];
      p[1] += V[i][1];
      p[2] += V[i][2];
    }
    const n = Math.max(1, loop.length);
    return [p[0] / n, p[1] / n, p[2] / n];
  });

  const edgePoints: Vec3[] = topo.edges.map(([a, b], e) => {
    const pa = V[a];
    const pb = V[b];
    if (edgeCrease[e]) return [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2];
    const [f0, f1] = topo.edgeFaces[e];
    const q0 = facePoints[f0];
    const q1 = facePoints[f1];
    return [
      (pa[0] + pb[0] + q0[0] + q1[0]) / 4,
      (pa[1] + pb[1] + q0[1] + q1[1]) / 4,
      (pa[2] + pb[2] + q0[2] + q1[2]) / 4,
    ];
  });

  const vertexPoints: Vec3[] = V.map((p, v) => {
    const vEdges = topo.vertexEdges[v] ?? [];
    const vFaces = Array.from(new Set(topo.vertexFaces[v] ?? []));
    if (!vFaces.length || !vEdges.length) return [p[0], p[1], p[2]];
    const creases = vEdges.filter((e) => edgeCrease[e]);
    const onBoundary = vEdges.some((e) => topo.edgeFaces[e].length === 1);
    // Corners: three or more creases, or an open-mesh corner touched by a single face.
    if (creases.length >= 3 || (onBoundary && vFaces.length === 1)) return [p[0], p[1], p[2]];
    if (creases.length === 2) {
      const [ea, eb] = creases.map((e) => topo.edges[e]);
      const a = V[ea[0] === v ? ea[1] : ea[0]];
      const b = V[eb[0] === v ? eb[1] : eb[0]];
      return [(6 * p[0] + a[0] + b[0]) / 8, (6 * p[1] + a[1] + b[1]) / 8, (6 * p[2] + a[2] + b[2]) / 8];
    }
    // Smooth (or dart, one crease) rule: (F + 2R + (n - 3)P) / n.
    const n = vEdges.length;
    const F: Vec3 = [0, 0, 0];
    for (const f of vFaces) {
      F[0] += facePoints[f][0];
      F[1] += facePoints[f][1];
      F[2] += facePoints[f][2];
    }
    const R: Vec3 = [0, 0, 0];
    for (const e of vEdges) {
      const [a, b] = topo.edges[e];
      R[0] += (V[a][0] + V[b][0]) / 2;
      R[1] += (V[a][1] + V[b][1]) / 2;
      R[2] += (V[a][2] + V[b][2]) / 2;
    }
    const fc = vFaces.length;
    return [0, 1, 2].map((k) => (F[k] / fc + (2 * R[k]) / n + (n - 3) * p[k]) / n) as Vec3;
  });

  const vertices: Vec3[] = [...vertexPoints, ...edgePoints, ...facePoints];
  const edgeVertex = (e: number) => nV + e;
  const faceVertex = (f: number) => nV + nE + f;

  const nextFaces: number[][] = [];
  const faceSlots: number[] = [];
  const hasUVs = !!mesh.faceUVs && mesh.faceUVs.length === faces.length;
  const faceUVs: UV[][] = [];
  faces.forEach((loop, f) => {
    const around = topo.faceEdges[f];
    const n = loop.length;
    const slot = mesh.faceSlots?.[f] ?? -1;
    const uvs = hasUVs ? mesh.faceUVs![f] : null;
    const centerUV = uvs ? avgUV(uvs) : null;
    for (let i = 0; i < n; i += 1) {
      const prev = (i + n - 1) % n;
      nextFaces.push([loop[i], edgeVertex(around[i]), faceVertex(f), edgeVertex(around[prev])]);
      faceSlots.push(slot);
      if (uvs && centerUV) {
        const next = (i + 1) % n;
        faceUVs.push([
          [uvs[i][0], uvs[i][1]],
          avgUV([uvs[i], uvs[next]]),
          centerUV,
          avgUV([uvs[prev], uvs[i]]),
        ]);
      }
    }
  });

  const sharpEdges: Array<[number, number]> = [];
  topo.edges.forEach(([a, b], e) => {
    if (!sharpKeys.has(edgeKey(a, b))) return;
    sharpEdges.push([a, edgeVertex(e)], [edgeVertex(e), b]);
  });

  return makePolyMesh(vertices, nextFaces, {
    faceSlots,
    faceUVs: hasUVs ? faceUVs : undefined,
    sharpEdges,
  });
}

/**
 * Catmull-Clark subdivision on arbitrary polygon meshes. Boundary edges use the cubic B-spline curve
 * rules (open-mesh corners stay put); `sharpEdges` are creases whose child edges stay sharp so
 * levels compound. Levels back off when the next one would exceed `MAX_RENDER_FACES`.
 */
export function catmullClark(mesh: ModelPartMesh, levels = 1): ModelPartMesh {
  let current = ensurePolyMesh(mesh);
  const target = Math.max(0, Math.min(MAX_SUBDIVISION_LEVELS, Math.floor(Number.isFinite(levels) ? levels : 0)));
  for (let level = 0; level < target; level += 1) {
    const faces = meshFaces(current);
    let nextCount = 0;
    for (const loop of faces) nextCount += loop.length;
    if (!faces.length || nextCount > MAX_RENDER_FACES) break;
    current = catmullClarkOnce(current);
  }
  return current;
}

// ------------------------------------------------------------------------------------------------
// Mirror
// ------------------------------------------------------------------------------------------------

const AXIS_INDEX = { x: 0, y: 1, z: 2 } as const;
type Axis = keyof typeof AXIS_INDEX;

function mirrorOnce(mesh: ModelPartMesh, axis: Axis, mergeDistance: number): ModelPartMesh {
  const k = AXIS_INDEX[axis];
  const faces = meshFaces(mesh);
  const merge = Math.max(0, mergeDistance);
  const vertices: Vec3[] = mesh.vertices.map((p) => {
    const q: Vec3 = [p[0], p[1], p[2]];
    if (Math.abs(q[k]) <= merge) q[k] = 0;
    return q;
  });
  const nV = vertices.length;
  const mapped = new Array<number>(nV);
  for (let i = 0; i < nV; i += 1) {
    if (vertices[i][k] === 0) {
      mapped[i] = i; // seam vertex: shared by both halves
    } else {
      const q: Vec3 = [vertices[i][0], vertices[i][1], vertices[i][2]];
      q[k] = -q[k];
      mapped[i] = vertices.length;
      vertices.push(q);
    }
  }

  const hasUVs = !!mesh.faceUVs && mesh.faceUVs.length === faces.length;
  const outFaces: number[][] = [];
  const outSlots: number[] = [];
  const outUVs: UV[][] = [];
  const pushFace = (loop: number[], slot: number, uvs: UV[] | null) => {
    const kept: number[] = [];
    const keptUVs: UV[] = [];
    loop.forEach((index, corner) => {
      if (kept.length && kept[kept.length - 1] === index) return;
      kept.push(index);
      if (uvs) keptUVs.push([uvs[corner][0], uvs[corner][1]]);
    });
    if (kept.length > 1 && kept[0] === kept[kept.length - 1]) {
      kept.pop();
      keptUVs.pop();
    }
    if (kept.length < 3 || new Set(kept).size !== kept.length) return;
    outFaces.push(kept);
    outSlots.push(slot);
    if (uvs) outUVs.push(keptUVs);
  };

  faces.forEach((loop, f) => pushFace(loop, mesh.faceSlots?.[f] ?? -1, hasUVs ? mesh.faceUVs![f] : null));
  faces.forEach((loop, f) => {
    // A face lying entirely on the plane mirrors onto itself; skip the coincident copy.
    if (loop.every((i) => mapped[i] === i)) return;
    const reversed = [...loop].reverse().map((i) => mapped[i]);
    const uvs = hasUVs ? [...mesh.faceUVs![f]].reverse() : null;
    pushFace(reversed, mesh.faceSlots?.[f] ?? -1, uvs);
  });

  const sharp = mesh.sharpEdges ?? [];
  const sharpEdges: Array<[number, number]> = [];
  const seen = new Set<number>();
  for (const [a, b] of [...sharp, ...sharp.map(([a, b]) => [mapped[a] ?? a, mapped[b] ?? b] as [number, number])]) {
    if (a === b || a === undefined || b === undefined) continue;
    const key = edgeKey(a, b);
    if (seen.has(key)) continue;
    seen.add(key);
    sharpEdges.push([a, b]);
  }

  return compactMesh(
    makePolyMesh(vertices, outFaces, {
      faceSlots: outSlots,
      faceUVs: hasUVs && outUVs.length === outFaces.length ? outUVs : undefined,
      sharpEdges,
    }),
  );
}

/**
 * Mirror across each listed axis' 0-plane in order. Seam vertices within `mergeDistance` of the
 * plane snap onto it and are shared by both halves; the copy's winding (and UV corners) reverse.
 */
export function applyMirrorModifier(mesh: ModelPartMesh, axes: ReadonlyArray<'x' | 'y' | 'z'>, mergeDistance = 0.001): ModelPartMesh {
  let current = ensurePolyMesh(mesh);
  for (const axis of axes) {
    if (!(axis in AXIS_INDEX)) continue;
    if (meshFaces(current).length * 2 > MAX_RENDER_FACES) break;
    current = mirrorOnce(current, axis, mergeDistance);
  }
  return current;
}

// ------------------------------------------------------------------------------------------------
// Array
// ------------------------------------------------------------------------------------------------

export interface ArrayModifierOptions {
  count: number;
  mode?: 'linear' | 'radial';
  offset?: Vec3;
  axis?: Axis;
  angle?: number;
}

function rotateAround(p: readonly number[], axis: Axis, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  if (axis === 'x') return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c];
  if (axis === 'y') return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c];
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]];
}

/**
 * Repeat the mesh `count` times (1-64, original included). Linear copies step by `offset`; radial
 * copies rotate around `axis` through the origin: `angle / count` per step for a full 360° ring,
 * otherwise `angle / (count - 1)` so the last copy lands on `angle`.
 */
export function applyArrayModifier(mesh: ModelPartMesh, options: ArrayModifierOptions): ModelPartMesh {
  const base = ensurePolyMesh(mesh);
  const faces = meshFaces(base);
  let count = Math.max(1, Math.min(MAX_ARRAY_COUNT, Math.floor(Number.isFinite(options.count) ? options.count : 1)));
  if (faces.length) count = Math.max(1, Math.min(count, Math.floor(MAX_RENDER_FACES / faces.length)));
  if (count <= 1) return base;
  const mode = options.mode === 'radial' ? 'radial' : 'linear';
  const offset: Vec3 = options.offset ?? [1, 0, 0];
  const axis: Axis = options.axis && options.axis in AXIS_INDEX ? options.axis : mode === 'radial' ? 'y' : 'x';
  const angleDeg = Number.isFinite(options.angle) ? (options.angle as number) : 360;
  const stepRad =
    ((Math.abs(angleDeg) >= 360 ? angleDeg / count : angleDeg / (count - 1)) * Math.PI) / 180;

  const nV = base.vertices.length;
  const vertices: Vec3[] = [];
  const outFaces: number[][] = [];
  const outSlots: number[] = [];
  const hasUVs = !!base.faceUVs && base.faceUVs.length === faces.length;
  const outUVs: UV[][] = [];
  const sharpEdges: Array<[number, number]> = [];
  for (let c = 0; c < count; c += 1) {
    for (const p of base.vertices) {
      vertices.push(
        mode === 'linear'
          ? [p[0] + offset[0] * c, p[1] + offset[1] * c, p[2] + offset[2] * c]
          : rotateAround(p, axis, stepRad * c),
      );
    }
    const shift = c * nV;
    faces.forEach((loop, f) => {
      outFaces.push(loop.map((i) => i + shift));
      outSlots.push(base.faceSlots?.[f] ?? -1);
      if (hasUVs) outUVs.push(base.faceUVs![f].map((uv) => [uv[0], uv[1]] as UV));
    });
    for (const [a, b] of base.sharpEdges ?? []) sharpEdges.push([a + shift, b + shift]);
  }
  return makePolyMesh(vertices, outFaces, {
    faceSlots: outSlots,
    faceUVs: hasUVs ? outUVs : undefined,
    sharpEdges,
  });
}

// ------------------------------------------------------------------------------------------------
// Sanitizing + stack evaluation
// ------------------------------------------------------------------------------------------------

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const isAxis = (value: unknown): value is Axis => value === 'x' || value === 'y' || value === 'z';

function sanitizeModifier(input: unknown): ModelModifier | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const enabled = raw.enabled === false ? { enabled: false as const } : {};
  switch (raw.type) {
    case 'mirror': {
      const source = Array.isArray(raw.axes) ? raw.axes : isAxis(raw.axis) ? [raw.axis] : ['x'];
      const axes = Array.from(new Set(source.map((a) => (typeof a === 'string' ? a.toLowerCase() : a)).filter(isAxis)));
      if (!axes.length) return null;
      const mergeDistance =
        typeof raw.mergeDistance === 'number' && Number.isFinite(raw.mergeDistance) ? clamp(raw.mergeDistance, 0, 0.1) : undefined;
      return { type: 'mirror', ...enabled, axes, ...(mergeDistance !== undefined ? { mergeDistance } : {}) };
    }
    case 'array': {
      const count =
        typeof raw.count === 'number' && Number.isFinite(raw.count) ? clamp(Math.round(raw.count), 1, MAX_ARRAY_COUNT) : 2;
      const mode = raw.mode === 'radial' ? 'radial' : 'linear';
      const result: ModelModifier = { type: 'array', ...enabled, count, mode };
      if (Array.isArray(raw.offset) && raw.offset.length === 3 && raw.offset.every((c) => typeof c === 'number' && Number.isFinite(c))) {
        result.offset = (raw.offset as number[]).map((c) => clamp(c, -8, 8)) as Vec3;
      } else if (mode === 'linear') {
        result.offset = [1, 0, 0];
      }
      if (isAxis(raw.axis)) result.axis = raw.axis;
      else if (mode === 'radial') result.axis = 'y';
      if (typeof raw.angle === 'number' && Number.isFinite(raw.angle)) result.angle = clamp(raw.angle, -360, 360);
      else if (mode === 'radial') result.angle = 360;
      return result;
    }
    case 'subdivision': {
      const levels =
        typeof raw.levels === 'number' && Number.isFinite(raw.levels) ? clamp(Math.round(raw.levels), 0, MAX_SUBDIVISION_LEVELS) : 1;
      return { type: 'subdivision', ...enabled, levels };
    }
    default:
      return null;
  }
}

/** Sanitize saved/AI modifier data: valid types only, numbers clamped, axes deduped, max 8 entries. */
export function normalizeModifiers(input: unknown): ModelModifier[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const result: ModelModifier[] = [];
  for (const entry of input) {
    if (result.length >= MAX_MODIFIERS) break;
    const modifier = sanitizeModifier(entry);
    if (modifier) result.push(modifier);
  }
  return result.length ? result : undefined;
}

function applyModifier(mesh: ModelPartMesh, modifier: ModelModifier): ModelPartMesh {
  switch (modifier.type) {
    case 'mirror':
      return applyMirrorModifier(mesh, modifier.axes, modifier.mergeDistance ?? 0.001);
    case 'array':
      return applyArrayModifier(mesh, modifier);
    case 'subdivision':
      return catmullClark(mesh, modifier.levels);
  }
}

const MAX_CACHE_PER_MESH = 8;
const evaluateCache = new WeakMap<ModelPartMesh, Map<string, ModelPartMesh>>();

/**
 * Run a modifier stack in order (disabled and malformed entries skipped). Memoized by mesh object
 * identity + modifier JSON: the same inputs return the same output object.
 */
export function evaluateModifiers(mesh: ModelPartMesh, modifiers?: readonly ModelModifier[] | null): ModelPartMesh {
  const active: ModelModifier[] = [];
  for (const entry of modifiers ?? []) {
    if (active.length >= MAX_MODIFIERS) break;
    const modifier = sanitizeModifier(entry);
    if (modifier && modifier.enabled !== false) active.push(modifier);
  }
  if (!active.length && mesh.faces) return mesh;
  const key = JSON.stringify(active);
  let inner = evaluateCache.get(mesh);
  const hit = inner?.get(key);
  if (hit) return hit;
  let result = ensurePolyMesh(mesh);
  for (const modifier of active) result = applyModifier(result, modifier);
  if (!inner) {
    inner = new Map();
    evaluateCache.set(mesh, inner);
  }
  if (inner.size >= MAX_CACHE_PER_MESH) inner.delete(inner.keys().next().value as string);
  inner.set(key, result);
  return result;
}
