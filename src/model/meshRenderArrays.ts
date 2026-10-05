import type { ModelPartMesh } from '../types';
import { buildTopology, dot3, edgeKey, length3, meshFaces, normalize3, polygonNormal, sub3, triangulateLoop, type Vec3 } from './polyMesh';

/**
 * Poly mesh → GPU-ready arrays (no three.js): auto-smoothed per-corner normals, per-corner UVs,
 * render vertices split only where normal/UV differ, triangles grouped by palette slot (three.js
 * `addGroup` semantics) and a triangle → source polygon map for raycast face picking.
 */

export interface RenderArraysOptions {
  /** Degrees. Edges whose faces meet at a sharper angle shade hard; 0 = flat, 180 = smooth. */
  smoothAngle?: number;
  /** Palette slot for faces whose `faceSlots` entry is missing or -1. */
  defaultSlot?: number;
}

export interface RenderArrays {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array | null;
  indices: Uint32Array;
  /** One group per palette slot; `start`/`count` are in index elements. */
  groups: Array<{ start: number; count: number; slot: number }>;
  /** Source polygon index of each output triangle (same order as `indices`). */
  triangleFaces: Uint32Array;
}

const cache = new WeakMap<ModelPartMesh, Map<string, RenderArrays>>();
const MAX_CACHE_PER_MESH = 4;

const quant = (value: number) => Math.round(value * 1e5);

function cornerAngle(vertices: readonly Vec3[], loop: readonly number[], i: number): number {
  const n = loop.length;
  const p = vertices[loop[i]];
  const a = sub3(vertices[loop[(i + n - 1) % n]], p);
  const b = sub3(vertices[loop[(i + 1) % n]], p);
  const la = length3(a);
  const lb = length3(b);
  if (la < 1e-12 || lb < 1e-12) return 0;
  return Math.acos(Math.max(-1, Math.min(1, dot3(a, b) / (la * lb))));
}

function build(mesh: ModelPartMesh, smoothAngle: number, defaultSlot: number): RenderArrays {
  const vertices = mesh.vertices;
  const faces = meshFaces(mesh);
  const topo = buildTopology({ vertices, faces });
  const faceNormals = faces.map((loop) => polygonNormal(vertices, loop));
  const cosLimit = Math.cos((Math.min(180, Math.max(0, smoothAngle)) * Math.PI) / 180);
  const sharpKeys = new Set<number>((mesh.sharpEdges ?? []).map(([a, b]) => edgeKey(a, b)));

  // Smooth edges join the shading fans of their two faces; sharp, boundary, non-manifold and
  // too-steep edges break them.
  const smoothEdge = topo.edges.map(([a, b], e) => {
    const adjacent = topo.edgeFaces[e];
    if (adjacent.length !== 2 || sharpKeys.has(edgeKey(a, b))) return false;
    if (smoothAngle >= 180) return true;
    return dot3(faceNormals[adjacent[0]], faceNormals[adjacent[1]]) >= cosLimit - 1e-6;
  });

  // Per vertex: union faces across smooth edges, then one angle-weighted normal per fan group.
  const cornerNormals: Vec3[][] = faces.map((loop) => loop.map(() => [0, 0, 0] as Vec3));
  const cornerAngles: number[][] = faces.map((loop) => loop.map((_, i) => cornerAngle(vertices, loop, i)));
  const vertexCorners: Array<Array<[number, number]>> = vertices.map(() => []);
  faces.forEach((loop, f) => loop.forEach((v, i) => vertexCorners[v]?.push([f, i])));
  vertexCorners.forEach((corners, v) => {
    if (!corners.length) return;
    const parent = new Map<number, number>();
    const find = (f: number): number => {
      let root = f;
      while (parent.get(root) !== root) root = parent.get(root)!;
      let node = f;
      while (parent.get(node) !== root) {
        const next = parent.get(node)!;
        parent.set(node, root);
        node = next;
      }
      return root;
    };
    for (const [f] of corners) parent.set(f, f);
    for (const e of topo.vertexEdges[v] ?? []) {
      if (!smoothEdge[e]) continue;
      const [f0, f1] = topo.edgeFaces[e];
      const r0 = find(f0);
      const r1 = find(f1);
      if (r0 !== r1) parent.set(r0, r1);
    }
    const sums = new Map<number, Vec3>();
    for (const [f, i] of corners) {
      const root = find(f);
      const sum = sums.get(root) ?? [0, 0, 0];
      const w = cornerAngles[f][i] || 1e-6;
      const n = faceNormals[f];
      sum[0] += n[0] * w;
      sum[1] += n[1] * w;
      sum[2] += n[2] * w;
      sums.set(root, sum);
    }
    for (const [f, i] of corners) {
      const normal = normalize3(sums.get(find(f))!);
      cornerNormals[f][i] = length3(normal) > 0 ? normal : faceNormals[f];
    }
  });

  const hasUVs = !!mesh.faceUVs && mesh.faceUVs.length === faces.length && mesh.faceUVs.every((uv, f) => uv?.length === faces[f].length);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const renderIndex = new Map<string, number>();
  const cornerRender: number[][] = faces.map((loop, f) =>
    loop.map((v, i) => {
      const n = cornerNormals[f][i];
      const uv = hasUVs ? mesh.faceUVs![f][i] : null;
      const key = `${v}|${quant(n[0])},${quant(n[1])},${quant(n[2])}${uv ? `|${quant(uv[0])},${quant(uv[1])}` : ''}`;
      let index = renderIndex.get(key);
      if (index === undefined) {
        index = positions.length / 3;
        renderIndex.set(key, index);
        const p = vertices[v];
        positions.push(p[0], p[1], p[2]);
        normals.push(n[0], n[1], n[2]);
        if (uv) uvs.push(uv[0], uv[1]);
      }
      return index;
    }),
  );

  const buckets = new Map<number, { indices: number[]; faces: number[] }>();
  faces.forEach((loop, f) => {
    const raw = mesh.faceSlots?.[f];
    const slot = raw !== undefined && raw >= 0 ? raw : defaultSlot;
    let bucket = buckets.get(slot);
    if (!bucket) {
      bucket = { indices: [], faces: [] };
      buckets.set(slot, bucket);
    }
    const local = triangulateLoop(vertices, loop);
    for (let t = 0; t < local.length; t += 3) {
      bucket.indices.push(cornerRender[f][local[t]], cornerRender[f][local[t + 1]], cornerRender[f][local[t + 2]]);
      bucket.faces.push(f);
    }
  });
  const slots = [...buckets.keys()].sort((a, b) => a - b);
  const indexTotal = slots.reduce((sum, slot) => sum + buckets.get(slot)!.indices.length, 0);
  const indices = new Uint32Array(indexTotal);
  const triangleFaces = new Uint32Array(indexTotal / 3);
  const groups: RenderArrays['groups'] = [];
  let cursor = 0;
  for (const slot of slots) {
    const bucket = buckets.get(slot)!;
    if (!bucket.indices.length) continue;
    indices.set(bucket.indices, cursor);
    triangleFaces.set(bucket.faces, cursor / 3);
    groups.push({ start: cursor, count: bucket.indices.length, slot });
    cursor += bucket.indices.length;
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: hasUVs ? new Float32Array(uvs) : null,
    indices,
    groups,
    triangleFaces,
  };
}

/** Memoized per mesh object + options. Treat the returned arrays as read-only. */
export function buildRenderArrays(mesh: ModelPartMesh, options: RenderArraysOptions = {}): RenderArrays {
  const smoothAngle = Number.isFinite(options.smoothAngle) ? Math.min(180, Math.max(0, options.smoothAngle as number)) : 30;
  const defaultSlot = Number.isInteger(options.defaultSlot) ? (options.defaultSlot as number) : 0;
  const key = `${smoothAngle}|${defaultSlot}`;
  let inner = cache.get(mesh);
  const hit = inner?.get(key);
  if (hit) return hit;
  const result = build(mesh, smoothAngle, defaultSlot);
  if (!inner) {
    inner = new Map();
    cache.set(mesh, inner);
  }
  if (inner.size >= MAX_CACHE_PER_MESH) inner.delete(inner.keys().next().value as string);
  inner.set(key, result);
  return result;
}
