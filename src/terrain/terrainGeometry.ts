import type { TerrainComponent } from '../types';
import {
  sampleTerrainLayerWeights,
  sampleTerrainLocalHeight,
  sampleTerrainNormal,
  terrainChunkBounds,
  withTerrainDefaults,
} from './terrain';

export interface TerrainChunkGeometryData {
  positions: Float32Array;
  normals: Float32Array;
  weightsA: Float32Array;
  weightsB: Float32Array;
  indices: Uint32Array;
  surfaceVertexCount: number;
  segments: number;
  skirtDepth: number;
}

/**
 * Deterministically build render data in terrain-local space. Normals are sampled from the continuous
 * height function, so the same border coordinate gets the same normal in neighboring chunks and at all
 * LOD levels. Coarse chunks keep the full-resolution border polyline and stitch it to their interiors.
 * Full-detail chunks also retain a modest skirt; the full-resolution physics mesh stays unchanged.
 */
export function buildTerrainChunkGeometryData(
  input: TerrainComponent,
  chunkX: number,
  chunkZ: number,
  requestedSegments = input.resolution,
): TerrainChunkGeometryData {
  const terrain = withTerrainDefaults(input);
  const segments = Math.max(1, Math.trunc(requestedSegments));
  if (segments < terrain.resolution) return buildStitchedChunk(terrain, chunkX, chunkZ, segments);
  const perSide = segments + 1;
  const surfaceVertexCount = perSide * perSide;
  const skirtVertexCount = 4 * perSide * 2;
  const vertexCount = surfaceVertexCount + skirtVertexCount;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const weightsA = new Float32Array(vertexCount * 4);
  const weightsB = new Float32Array(vertexCount * 4);
  const indices = new Uint32Array(segments * segments * 6 + 4 * segments * 6);
  const bounds = terrainChunkBounds(terrain, chunkX, chunkZ);
  const skirtDepth = Math.max(1, terrain.heightScale * 0.08);

  const setVertex = (index: number, x: number, y: number, z: number, normal: readonly number[], weights: readonly number[]) => {
    const p = index * 3;
    positions[p] = x;
    positions[p + 1] = y;
    positions[p + 2] = z;
    normals[p] = normal[0];
    normals[p + 1] = normal[1];
    normals[p + 2] = normal[2];
    const w = index * 4;
    for (let layer = 0; layer < 4; layer += 1) {
      weightsA[w + layer] = weights[layer] ?? 0;
      weightsB[w + layer] = weights[layer + 4] ?? 0;
    }
  };

  for (let z = 0; z <= segments; z += 1) {
    const localZ = bounds.minZ + (z / segments) * terrain.chunkSize;
    for (let x = 0; x <= segments; x += 1) {
      const localX = bounds.minX + (x / segments) * terrain.chunkSize;
      const height = sampleTerrainLocalHeight(terrain, localX, localZ);
      const normal = sampleTerrainNormal(terrain, localX, localZ);
      const weights = sampleTerrainLayerWeights(terrain, localX, localZ, height, normal[1]);
      setVertex(z * perSide + x, localX, height, localZ, normal, weights);
    }
  }

  let triangle = 0;
  for (let z = 0; z < segments; z += 1) {
    for (let x = 0; x < segments; x += 1) {
      const a = z * perSide + x;
      const b = a + 1;
      const d = (z + 1) * perSide + x;
      const e = d + 1;
      indices[triangle++] = a; indices[triangle++] = d; indices[triangle++] = b;
      indices[triangle++] = b; indices[triangle++] = d; indices[triangle++] = e;
    }
  }

  const edges = [
    { vertices: Array.from({ length: perSide }, (_, i) => i), normal: [0, 0, -1] },
    { vertices: Array.from({ length: perSide }, (_, i) => i * perSide + segments), normal: [1, 0, 0] },
    { vertices: Array.from({ length: perSide }, (_, i) => segments * perSide + (segments - i)), normal: [0, 0, 1] },
    { vertices: Array.from({ length: perSide }, (_, i) => (segments - i) * perSide), normal: [-1, 0, 0] },
  ];
  let nextVertex = surfaceVertexCount;
  for (const edge of edges) {
    const edgeStart = nextVertex;
    for (const source of edge.vertices) {
      const sp = source * 3;
      const sw = source * 4;
      const layerWeights = [
        weightsA[sw], weightsA[sw + 1], weightsA[sw + 2], weightsA[sw + 3],
        weightsB[sw], weightsB[sw + 1], weightsB[sw + 2], weightsB[sw + 3],
      ];
      setVertex(nextVertex++, positions[sp], positions[sp + 1], positions[sp + 2], edge.normal, layerWeights);
      setVertex(nextVertex++, positions[sp], positions[sp + 1] - skirtDepth, positions[sp + 2], edge.normal, layerWeights);
    }
    for (let i = 0; i < segments; i += 1) {
      const top = edgeStart + i * 2;
      const bottom = top + 1;
      const nextTop = top + 2;
      const nextBottom = top + 3;
      indices[triangle++] = top; indices[triangle++] = nextTop; indices[triangle++] = bottom;
      indices[triangle++] = nextTop; indices[triangle++] = nextBottom; indices[triangle++] = bottom;
    }
  }

  return { positions, normals, weightsA, weightsB, indices, surfaceVertexCount, segments, skirtDepth };
}

/** Coarse interiors retain the exact full-resolution boundary polyline, including non-divisor LODs. */
function buildStitchedChunk(terrain: TerrainComponent, cx: number, cz: number, segments: number): TerrainChunkGeometryData {
  const bounds = terrainChunkBounds(terrain, cx, cz);
  const positions: number[] = [], normals: number[] = [], weightsA: number[] = [], weightsB: number[] = [], indices: number[] = [];
  const vertices = new Map<string, number>();
  const height = (u: number, v: number) => sampleTerrainLocalHeight(terrain, bounds.minX + u * terrain.chunkSize, bounds.minZ + v * terrain.chunkSize);
  const vertex = (u: number, v: number) => {
    const key = `${Math.round(u * 1e9)}:${Math.round(v * 1e9)}`;
    const cached = vertices.get(key);
    if (cached !== undefined) return cached;
    const x = bounds.minX + u * terrain.chunkSize, z = bounds.minZ + v * terrain.chunkSize;
    let y = height(u, v);
    let normal: readonly number[] = sampleTerrainNormal(terrain, x, z);
    let weights: readonly number[] = sampleTerrainLayerWeights(terrain, x, z, y, normal[1]);
    if (u === 0 || u === 1 || v === 0 || v === 1) {
      const vertical = u === 0 || u === 1;
      const step = (vertical ? v : u) * terrain.resolution;
      const low = Math.floor(step), high = Math.min(terrain.resolution, low + 1), fraction = step - low;
      const endpoint = (i: number) => {
        const px = bounds.minX + (vertical ? u : i / terrain.resolution) * terrain.chunkSize;
        const pz = bounds.minZ + (vertical ? i / terrain.resolution : v) * terrain.chunkSize;
        const py = sampleTerrainLocalHeight(terrain, px, pz);
        const n = sampleTerrainNormal(terrain, px, pz);
        return { y: py, normal: n, weights: sampleTerrainLayerWeights(terrain, px, pz, py, n[1]) };
      };
      const a = endpoint(low), b = endpoint(high);
      y = a.y + (b.y - a.y) * fraction;
      // Match the fine mesh's *interpolated* attributes at non-divisor edge vertices. Normalizing
      // here would change that interpolation; the fragment shader normalizes the final result.
      normal = a.normal.map((value, i) => value + (b.normal[i] - value) * fraction);
      weights = a.weights.map((value, i) => value + (b.weights[i] - value) * fraction);
    }
    const index = positions.length / 3;
    positions.push(x, y, z); normals.push(...normal);
    weightsA.push(...Array.from({ length: 4 }, (_, i) => weights[i] ?? 0));
    weightsB.push(...Array.from({ length: 4 }, (_, i) => weights[i + 4] ?? 0));
    vertices.set(key, index);
    return index;
  };
  for (let z = 0; z <= segments; z++) for (let x = 0; x <= segments; x++) vertex(x / segments, z / segments);
  const intermediate = (start: number, end: number, fixed: number, vertical: boolean) => {
    const result: number[] = [];
    for (let i = Math.floor(Math.min(start, end) * terrain.resolution) + 1; i < Math.max(start, end) * terrain.resolution - 1e-8; i++) {
      const t = i / terrain.resolution;
      result.push(vertical ? vertex(fixed, t) : vertex(t, fixed));
    }
    return end < start ? result.reverse() : result;
  };
  const width = segments + 1;
  for (let z = 0; z < segments; z++) for (let x = 0; x < segments; x++) {
    const a = z * width + x, b = a + 1, d = a + width, e = d + 1;
    if (x > 0 && x < segments - 1 && z > 0 && z < segments - 1) {
      indices.push(a, d, b, b, d, e);
      continue;
    }
    const polygon = [a,
      ...(x === 0 ? intermediate(z / segments, (z + 1) / segments, 0, true) : []), d,
      ...(z === segments - 1 ? intermediate(x / segments, (x + 1) / segments, 1, false) : []), e,
      ...(x === segments - 1 ? intermediate((z + 1) / segments, z / segments, 1, true) : []), b,
      ...(z === 0 ? intermediate((x + 1) / segments, x / segments, 0, false) : []),
    ];
    const center = vertex((x + 0.5) / segments, (z + 0.5) / segments);
    for (let i = 0; i < polygon.length; i++) indices.push(center, polygon[i], polygon[(i + 1) % polygon.length]);
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), weightsA: new Float32Array(weightsA), weightsB: new Float32Array(weightsB),
    indices: new Uint32Array(indices), surfaceVertexCount: positions.length / 3, segments, skirtDepth: 0 };
}
