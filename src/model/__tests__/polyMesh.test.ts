import { describe, expect, it } from 'vitest';
import {
  UNIT_CUBE_POLY,
  buildTopology,
  compactMesh,
  facesFromTriangles,
  makePolyMesh,
  normalizePolyMesh,
  polygonNormal,
  triangulateLoop,
  weldMesh,
} from '../polyMesh';
import { DEFAULT_MESH } from '../modelMesh';

describe('polygon mesh core', () => {
  it('rebuilds the six quads of a cube from its 12 triangles', () => {
    const faces = facesFromTriangles(DEFAULT_MESH.vertices, DEFAULT_MESH.indices);
    expect(faces).toHaveLength(6);
    expect(faces.every((loop) => loop.length === 4)).toBe(true);
    // Rebuilt quads keep the outward winding of the source triangles.
    for (const loop of faces) {
      const n = polygonNormal(DEFAULT_MESH.vertices, loop);
      const c = loop.reduce((sum, i) => sum.map((v, k) => v + DEFAULT_MESH.vertices[i][k] / 4), [0, 0, 0]);
      expect(n[0] * c[0] + n[1] * c[1] + n[2] * c[2]).toBeGreaterThan(0);
    }
  });

  it('builds closed manifold topology for the unit cube', () => {
    const topo = buildTopology(UNIT_CUBE_POLY);
    expect(topo.edges).toHaveLength(12);
    expect(topo.edgeFaces.every((faces) => faces.length === 2)).toBe(true);
    expect(topo.vertexFaces.every((faces) => faces.length === 3)).toBe(true);
    expect(UNIT_CUBE_POLY.indices).toHaveLength(36);
  });

  it('ear-clips a concave L-shaped n-gon without flipping triangles', () => {
    const vertices: Array<[number, number, number]> = [
      [0, 0, 0], [2, 0, 0], [2, 1, 0], [1, 1, 0], [1, 2, 0], [0, 2, 0],
    ];
    const loop = [0, 1, 2, 3, 4, 5];
    const tris = triangulateLoop(vertices, loop);
    expect(tris).toHaveLength(12);
    for (let i = 0; i < tris.length; i += 3) {
      const [a, b, c] = [vertices[tris[i]], vertices[tris[i + 1]], vertices[tris[i + 2]]];
      const z = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      expect(z).toBeGreaterThan(0);
    }
  });

  it('normalizes legacy triangle payloads into poly meshes', () => {
    const mesh = normalizePolyMesh({ vertices: DEFAULT_MESH.vertices, indices: DEFAULT_MESH.indices })!;
    expect(mesh.faces).toHaveLength(6);
    expect(mesh.indices).toHaveLength(36);
  });

  it('drops broken loops and keeps per-face attributes aligned', () => {
    const mesh = normalizePolyMesh({
      vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [NaN, 0, 0]],
      faces: [[0, 1, 2, 3], [0, 4, 1], [0, 1, 1]],
      faceSlots: [2, 5, 6],
    })!;
    expect(mesh.faces).toEqual([[0, 1, 2, 3]]);
    expect(mesh.faceSlots).toEqual([2]);
  });

  it('welds coincident vertices and removes collapsed faces', () => {
    const mesh = makePolyMesh(
      [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [1, 0, 0], [2, 0, 0], [2, 1, 0], [1, 1, 0]],
      [[0, 1, 2, 3], [4, 5, 6, 7]],
    );
    const welded = weldMesh(mesh, 1e-5);
    expect(welded.vertices).toHaveLength(6);
    expect(buildTopology(welded).edgeFaces.filter((faces) => faces.length === 2)).toHaveLength(1);
  });

  it('compacts unused vertices', () => {
    const mesh = makePolyMesh([[9, 9, 9], [0, 0, 0], [1, 0, 0], [0, 1, 0]], [[1, 2, 3]]);
    const compact = compactMesh(mesh);
    expect(compact.vertices).toHaveLength(3);
    expect(compact.faces).toEqual([[0, 1, 2]]);
  });
});
