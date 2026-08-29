import type { ModelPartMesh, Vector3Tuple } from '../types';

/**
 * Pure, serializable mesh-part operations (Model Forge "Mesh" parts). No three.js here — the data
 * layer (src/model/modelSpec.ts) and the store use these without loading a renderer. Vertices are
 * stored in unit space; a part's `scale` multiplies at render, so these helpers reason about the data
 * directly and are trivially testable. The three.js-touching weld + CSG live in modelMeshCsg.ts.
 */

/** The canonical cube everyone converts from: the eight ±0.5 corners, 12 outward-facing triangles. */
export type MeshBooleanOp = 'union' | 'difference' | 'intersect';

export const DEFAULT_MESH: ModelPartMesh = {
  vertices: [
    [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5],
    [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5],
  ],
  indices: [
    1, 0, 3, 1, 3, 2, // -Z
    4, 5, 6, 4, 6, 7, // +Z
    1, 2, 6, 1, 6, 5, // +X
    0, 4, 7, 0, 7, 3, // -X
    3, 7, 6, 3, 6, 2, // +Y
    0, 1, 5, 0, 5, 4, // -Y
  ],
};

const MAX_VERTICES = 8192;
const MAX_INDICES = 49152;

const finiteVec = (value: readonly number[]): value is Vector3Tuple =>
  value.length === 3 && value.every((component) => Number.isFinite(component));
/** A deep copy so callers never share the canonical DEFAULT_MESH reference. */
export function cloneMesh(mesh: ModelPartMesh): ModelPartMesh {
  return { vertices: mesh.vertices.map((vertex) => [...vertex] as Vector3Tuple), indices: [...mesh.indices] };
}

/**
 * Sanitize arbitrary mesh data (older saves, package payloads, AI output) into a renderable part:
 * finite unit-space vertices, in-range triangle indices, counts clamped to a sane ceiling so one bad
 * part can never stall the editor. Returns `null` when there's nothing usable.
 */
export function normalizeMesh(mesh: unknown): ModelPartMesh | null {
  if (!mesh || typeof mesh !== 'object') return null;
  const { vertices, indices } = mesh as { vertices?: unknown; indices?: unknown };
  if (!Array.isArray(vertices) || !Array.isArray(indices)) return null;
  const cleanVertices: Vector3Tuple[] = [];
  for (const vertex of vertices) {
    if (cleanVertices.length >= MAX_VERTICES) break;
    if (finiteVec(vertex as readonly number[])) {
      const clamped = (vertex as readonly number[]).map((component) => Math.min(4, Math.max(-4, component))) as unknown as Vector3Tuple;
      cleanVertices.push(clamped);
    }
  }
  if (cleanVertices.length < 3) return null;
  const cleanIndices: number[] = [];
  const usable = cleanVertices.length;
  for (const index of indices) {
    if (cleanIndices.length >= MAX_INDICES) break;
    if (Number.isInteger(index) && (index as number) >= 0 && (index as number) < usable) cleanIndices.push(index as number);
  }
  const triangles = Math.floor(cleanIndices.length / 3) * 3;
  return { vertices: cleanVertices, indices: cleanIndices.slice(0, triangles) };
}

export const isMeshShape = (shape: string): boolean => shape === 'mesh';

/** Unique unordered edges as [a, b] (a < b), derived from the triangle list. */
export function meshEdgePairs(mesh: ModelPartMesh): Array<[number, number]> {
  const seen = new Set<number>();
  const edges: Array<[number, number]> = [];
  for (let i = 0; i + 2 < mesh.indices.length; i += 3) {
    const a = mesh.indices[i];
    const b = mesh.indices[i + 1];
    const c = mesh.indices[i + 2];
    const triples: Array<[number, number]> = [[a, b], [b, c], [c, a]];
    for (const [x, y] of triples) {
      const lo = Math.min(x, y);
      const hi = Math.max(x, y);
      const key = lo * MAX_VERTICES + hi;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push([lo, hi]);
      }
    }
  }
  return edges;
}

export const meshFaceCount = (mesh: ModelPartMesh): number => Math.floor(mesh.indices.length / 3);

/** The three vertex indices of one triangle, or [] out of range. */
export function meshFaceVertices(mesh: ModelPartMesh, faceIndex: number): number[] {
  const start = faceIndex * 3;
  return start >= 0 && start + 2 < mesh.indices.length
    ? [mesh.indices[start], mesh.indices[start + 1], mesh.indices[start + 2]]
    : [];
}

const cross = (ax: number, ay: number, az: number, bx: number, by: number, bz: number): [number, number, number] => [
  ay * bz - az * by,
  az * bx - ax * bz,
  ax * by - ay * bx,
];

const normalize3 = (vector: [number, number, number]): [number, number, number] => {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (length < 1e-9) return vector;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
};

const faceNormal = (mesh: ModelPartMesh, faceIndex: number): [number, number, number] => {
  const [a, b, c] = meshFaceVertices(mesh, faceIndex);
  const pa = mesh.vertices[a];
  const pb = mesh.vertices[b];
  const pc = mesh.vertices[c];
  const [abx, aby, abz] = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
  const [acx, acy, acz] = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
  return normalize3(cross(abx, aby, abz, acx, acy, acz));
};

/**
 * Extrude the given triangles outward along their own normals by `delta`. Each selected triangle keeps
 * its base and gains an offset cap plus three side quads — a closed, manifold prism bump, so repeated
 * extrudes stack nicely and physics/GLB stay watertight. Shared vertices between two extruded faces
 * are deduplicated per call so touching caps separate cleanly.
 */
export function extrudeMeshFaces(mesh: ModelPartMesh, faceIndices: number[], delta = 0.25): ModelPartMesh {
  const faces = [...new Set(faceIndices.filter((index) => meshFaceVertices(mesh, index).length === 3))];
  if (!faces.length) return mesh;
  const vertices: Vector3Tuple[] = mesh.vertices.map((vertex) => [...vertex] as Vector3Tuple);
  const indices = [...mesh.indices];
  const offsetCache = new Map<number, number>();
  for (const faceIndex of faces) {
    const [a, b, c] = meshFaceVertices(mesh, faceIndex);
    const [nx, ny, nz] = faceNormal(mesh, faceIndex);
    const newIndex = (original: number): number => {
      let created = offsetCache.get(original);
      if (created === undefined) {
        if (vertices.length + 1 > MAX_VERTICES || indices.length + 7 > MAX_INDICES) return -1;
        const base = mesh.vertices[original];
        created = vertices.length;
        offsetCache.set(original, created);
        vertices.push([base[0] + nx * delta, base[1] + ny * delta, base[2] + nz * delta]);
      }
      return created;
    };
    const ao = newIndex(a);
    const bo = newIndex(b);
    const co = newIndex(c);
    if (ao < 0 || bo < 0 || co < 0) break;
    // Three side quads bridging each edge to its offset twin.
    for (const quad of [[a, b, ao, bo], [b, c, bo, co], [c, a, co, ao]] as Array<[number, number, number, number]>) {
      const [x, y, xo, yo] = quad;
      indices.push(x, xo, yo, x, yo, y);
    }
    // The raised cap (same outward normal as the base).
    indices.push(ao, bo, co);
  }
  return { vertices, indices };
}

/**
 * Midpoint subdivision of the given triangles. Edge midpoints are shared across selected faces that
 * touch, so the result stays crack-free. Each face becomes four triangles via its three edge midpoints.
 */
export function subdivideMeshFaces(mesh: ModelPartMesh, faceIndices: number[]): ModelPartMesh {
  const faces = [...new Set(faceIndices.filter((index) => meshFaceVertices(mesh, index).length === 3))];
  if (!faces.length) return mesh;
  const vertices: Vector3Tuple[] = mesh.vertices.map((vertex) => [...vertex] as Vector3Tuple);
  // Heads-up pass to reserve midpoints; abort cleanly if the ceiling is hit.
  const needed = new Set<number>();
  for (const faceIndex of faces) {
    for (const [a, b] of meshFacePairs(mesh, faceIndex)) needed.add(edgeKey(a, b));
  }
  if (vertices.length + needed.size > MAX_VERTICES) return mesh;
  const midpointCache = new Map<number, number>();
  const midpoint = (a: number, b: number): number => {
    const key = edgeKey(a, b);
    let index = midpointCache.get(key);
    if (index === undefined) {
      const pa = mesh.vertices[a];
      const pb = mesh.vertices[b];
      index = vertices.length;
      midpointCache.set(key, index);
      vertices.push([(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2]);
    }
    return index;
  };
  const indices: number[] = [];
  const faceSet = new Set(faces);
  for (let i = 0; i + 2 < mesh.indices.length; i += 3) {
    const a = mesh.indices[i];
    const b = mesh.indices[i + 1];
    const c = mesh.indices[i + 2];
    if (!faceSet.has(i / 3)) {
      indices.push(a, b, c);
      continue;
    }
    const ab = midpoint(a, b);
    const bc = midpoint(b, c);
    const ca = midpoint(c, a);
    indices.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca);
  }
  return { vertices, indices };
}

const edgeKey = (a: number, b: number): number => {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return lo * MAX_VERTICES + hi;
};

const meshFacePairs = (mesh: ModelPartMesh, faceIndex: number): Array<[number, number]> => {
  const [a, b, c] = meshFaceVertices(mesh, faceIndex);
  return [[a, b], [b, c], [c, a]];
};