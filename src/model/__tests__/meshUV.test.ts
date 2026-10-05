import { describe, expect, it } from 'vitest';
import { UNIT_CUBE_POLY, makePolyMesh, polygonNormal, type Vec3 } from '../polyMesh';
import { chartsOverlap, normalizeUVs, unwrapMesh, uvBounds, type UV } from '../meshUV';
import type { ModelPartMesh } from '../../types';

const signedArea = (uvs: readonly UV[]): number => {
  let area = 0;
  for (let i = 0; i < uvs.length; i += 1) {
    const a = uvs[i];
    const b = uvs[(i + 1) % uvs.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area / 2;
};

const span = (values: number[]) => Math.max(...values) - Math.min(...values);

/** Open-ended capped cylinder: `segments` side quads + two n-gon caps, CCW outward. */
function cylinderMesh(segments: number): ModelPartMesh {
  const vertices: Vec3[] = [];
  for (let i = 0; i < segments; i += 1) {
    const angle = ((i + 0.5) / segments) * Math.PI * 2; // the U seam (-Z) falls inside a face
    vertices.push([Math.sin(angle) * 0.5, -0.5, Math.cos(angle) * 0.5]);
    vertices.push([Math.sin(angle) * 0.5, 0.5, Math.cos(angle) * 0.5]);
  }
  const faces: number[][] = [];
  for (let i = 0; i < segments; i += 1) {
    const j = (i + 1) % segments;
    faces.push([i * 2, j * 2, j * 2 + 1, i * 2 + 1]);
  }
  faces.push(Array.from({ length: segments }, (_, i) => (segments - 1 - i) * 2)); // bottom, faces -Y
  faces.push(Array.from({ length: segments }, (_, i) => i * 2 + 1)); // top, faces +Y
  return makePolyMesh(vertices, faces);
}

/** UV sphere with pole vertices (triangle fans at the poles, quads elsewhere). */
function sphereMesh(rings: number, segments: number): ModelPartMesh {
  const vertices: Vec3[] = [[0, -0.5, 0]];
  for (let r = 1; r < rings; r += 1) {
    const phi = -Math.PI / 2 + (r / rings) * Math.PI;
    for (let s = 0; s < segments; s += 1) {
      const theta = (s / segments) * Math.PI * 2;
      vertices.push([Math.cos(phi) * Math.sin(theta) * 0.5, Math.sin(phi) * 0.5, Math.cos(phi) * Math.cos(theta) * 0.5]);
    }
  }
  const top = vertices.length;
  vertices.push([0, 0.5, 0]);
  const ring = (r: number, s: number) => 1 + (r - 1) * segments + (s % segments);
  const faces: number[][] = [];
  for (let s = 0; s < segments; s += 1) faces.push([0, ring(1, s + 1), ring(1, s)]);
  for (let r = 1; r < rings - 1; r += 1) {
    for (let s = 0; s < segments; s += 1) faces.push([ring(r, s), ring(r, s + 1), ring(r + 1, s + 1), ring(r + 1, s)]);
  }
  for (let s = 0; s < segments; s += 1) faces.push([ring(rings - 1, s), ring(rings - 1, s + 1), top]);
  return makePolyMesh(vertices, faces);
}

const expectOutward = (mesh: ModelPartMesh) => {
  // Sanity: the hand-built test meshes are CCW outward.
  mesh.faces!.forEach((loop) => {
    const n = polygonNormal(mesh.vertices, loop);
    const c = loop.reduce<Vec3>((sum, i) => [sum[0] + mesh.vertices[i][0], sum[1] + mesh.vertices[i][1], sum[2] + mesh.vertices[i][2]], [0, 0, 0]);
    expect(n[0] * c[0] + n[1] * c[1] + n[2] * c[2]).toBeGreaterThan(0);
  });
};

describe('unwrapMesh box', () => {
  it('gives every cube face 4 UVs, never mirrored, upright on the sides', () => {
    const mesh = unwrapMesh(UNIT_CUBE_POLY, 'box');
    expect(mesh.faceUVs).toHaveLength(6);
    mesh.faceUVs!.forEach((uvs, face) => {
      expect(uvs).toHaveLength(4);
      expect(signedArea(uvs)).toBeCloseTo(1, 6); // CCW (not mirrored), 1×1 world unit
      const n = polygonNormal(mesh.vertices, mesh.faces![face]);
      if (Math.abs(n[1]) < 0.5) {
        // Side faces: V follows world Y.
        mesh.faces![face].forEach((vertex, corner) => expect(uvs[corner][1]).toBeCloseTo(mesh.vertices[vertex][1], 6));
      }
    });
    expect(mesh.vertices).toEqual(UNIT_CUBE_POLY.vertices);
    expect(mesh.faces).toEqual(UNIT_CUBE_POLY.faces);
  });

  it('opposite faces read the same way round (a texture is not mirrored on the back)', () => {
    const mesh = unwrapMesh(UNIT_CUBE_POLY, 'box');
    // +Z (face 1) and -Z (face 0): moving towards +X on +Z must increase U, on -Z decrease it.
    const uOf = (face: number, vertex: number) => mesh.faceUVs![face][mesh.faces![face].indexOf(vertex)][0];
    expect(uOf(1, 5) - uOf(1, 4)).toBeGreaterThan(0); // +Z: x from -0.5 → 0.5
    expect(uOf(0, 1) - uOf(0, 0)).toBeLessThan(0); // -Z: x from -0.5 → 0.5
  });

  it('is scale-aware and honours tiling', () => {
    const base = unwrapMesh(UNIT_CUBE_POLY, 'box');
    const long = unwrapMesh(UNIT_CUBE_POLY, 'box', { partScale: [2, 1, 1] });
    const tiled = unwrapMesh(UNIT_CUBE_POLY, 'box', { tiling: 3 });
    // +Z face: U spans the X size.
    expect(span(base.faceUVs![1].map((uv) => uv[0]))).toBeCloseTo(1, 6);
    expect(span(long.faceUVs![1].map((uv) => uv[0]))).toBeCloseTo(2, 6);
    expect(span(long.faceUVs![1].map((uv) => uv[1]))).toBeCloseTo(1, 6);
    expect(span(tiled.faceUVs![1].map((uv) => uv[0]))).toBeCloseTo(3, 6);
  });
});

describe('unwrapMesh planar', () => {
  it('projects along the axis and fits 0..1', () => {
    const mesh = unwrapMesh(UNIT_CUBE_POLY, 'planar', { axis: 'z' });
    const box = uvBounds(mesh)!;
    expect(box.min[0]).toBeCloseTo(0);
    expect(box.max[0]).toBeCloseTo(1);
    expect(box.max[1]).toBeCloseTo(1);
    mesh.faces!.forEach((loop, face) =>
      loop.forEach((vertex, corner) => {
        expect(mesh.faceUVs![face][corner][0]).toBeCloseTo(mesh.vertices[vertex][0] + 0.5);
        expect(mesh.faceUVs![face][corner][1]).toBeCloseTo(mesh.vertices[vertex][1] + 0.5);
      }),
    );
  });
});

describe('unwrapMesh cylinder', () => {
  it('keeps U continuous across the seam', () => {
    const segments = 16;
    const source = cylinderMesh(segments);
    expectOutward(source);
    const mesh = unwrapMesh(source, 'cylinder');
    for (let f = 0; f < segments; f += 1) {
      const us = mesh.faceUVs![f].map((uv) => uv[0]);
      expect(span(us)).toBeCloseTo(1 / segments, 6);
      expect(signedArea(mesh.faceUVs![f])).toBeGreaterThan(0);
      const vs = mesh.faceUVs![f].map((uv) => uv[1]);
      expect(Math.min(...vs)).toBeCloseTo(0);
      expect(Math.max(...vs)).toBeCloseTo(1);
    }
    // The seam face carries U values beyond 1 instead of stretching back over the texture.
    expect(mesh.faceUVs!.slice(0, segments).some((uvs) => uvs.some((uv) => uv[0] > 1))).toBe(true);
    // Caps map as discs.
    for (const cap of [segments, segments + 1]) {
      expect(signedArea(mesh.faceUVs![cap])).toBeGreaterThan(0);
      mesh.faceUVs![cap].forEach(([u, v]) => {
        expect(u).toBeGreaterThanOrEqual(-1e-9);
        expect(u).toBeLessThanOrEqual(1 + 1e-9);
        expect(v).toBeGreaterThanOrEqual(-1e-9);
        expect(v).toBeLessThanOrEqual(1 + 1e-9);
      });
    }
  });
});

describe('unwrapMesh sphere', () => {
  it('maps latitude to V, fixes the seam, and handles poles', () => {
    const segments = 12;
    const source = sphereMesh(8, segments);
    expectOutward(source);
    const mesh = unwrapMesh(source, 'sphere');
    mesh.faceUVs!.forEach((uvs, face) => {
      expect(uvs).toHaveLength(mesh.faces![face].length);
      expect(span(uvs.map((uv) => uv[0]))).toBeLessThanOrEqual(1 / segments + 1e-6);
      expect(signedArea(uvs)).toBeGreaterThan(0);
      mesh.faces![face].forEach((vertex, corner) => {
        const expectedV = 0.5 + Math.asin(mesh.vertices[vertex][1] / 0.5) / Math.PI;
        expect(uvs[corner][1]).toBeCloseTo(expectedV, 6);
      });
    });
  });
});

describe('unwrapMesh smart', () => {
  it('cube: 6 charts, inside 0..1, no overlaps, geometry untouched', () => {
    const mesh = unwrapMesh(UNIT_CUBE_POLY, 'smart', { partScale: [2, 1, 0.5] });
    expect(mesh.vertices).toEqual(UNIT_CUBE_POLY.vertices);
    expect(mesh.faces).toEqual(UNIT_CUBE_POLY.faces);
    expect(mesh.indices).toEqual(UNIT_CUBE_POLY.indices);
    const box = uvBounds(mesh)!;
    expect(box.min[0]).toBeGreaterThanOrEqual(0.01 - 1e-9);
    expect(box.min[1]).toBeGreaterThanOrEqual(0.01 - 1e-9);
    expect(box.max[0]).toBeLessThanOrEqual(0.99 + 1e-9);
    expect(box.max[1]).toBeLessThanOrEqual(0.99 + 1e-9);
    expect(chartsOverlap(mesh)).toBe(false);
    // 90° between neighbours > 66°: every face is its own chart, so no two faces share a UV corner.
    const keys = mesh.faceUVs!.map((uvs) => new Set(uvs.map(([u, v]) => `${u.toFixed(6)},${v.toFixed(6)}`)));
    for (let a = 0; a < keys.length; a += 1) {
      for (let b = a + 1; b < keys.length; b += 1) {
        expect([...keys[a]].some((key) => keys[b].has(key))).toBe(false);
      }
    }
    // Uniform scale: chart areas keep the world-area ratios (2×1 : 2×0.5 : 1×0.5).
    const areas = mesh.faceUVs!.map((uvs) => Math.abs(signedArea(uvs)));
    expect(areas[1] / areas[2]).toBeCloseTo(2 / 0.5, 4); // +Z (2×1) vs +X (0.5×1)
    expect(areas[4] / areas[2]).toBeCloseTo(1 / 0.5, 4); // +Y (2×0.5) vs +X (0.5×1)
    mesh.faceUVs!.forEach((uvs) => expect(signedArea(uvs)).toBeGreaterThan(0));
  });

  it('cylinder and sphere: charts packed without overlap, unfolded', () => {
    for (const source of [cylinderMesh(24), sphereMesh(10, 16)]) {
      const mesh = unwrapMesh(source, 'smart');
      expect(mesh.faces).toEqual(source.faces);
      expect(mesh.vertices).toEqual(source.vertices);
      const box = uvBounds(mesh)!;
      expect(box.min[0]).toBeGreaterThanOrEqual(0);
      expect(box.min[1]).toBeGreaterThanOrEqual(0);
      expect(box.max[0]).toBeLessThanOrEqual(1);
      expect(box.max[1]).toBeLessThanOrEqual(1);
      expect(chartsOverlap(mesh)).toBe(false);
      mesh.faceUVs!.forEach((uvs) => expect(signedArea(uvs)).toBeGreaterThan(0));
      // Charts actually grew across the curved surface (far fewer charts than faces) and use the space.
      expect((box.max[0] - box.min[0]) * (box.max[1] - box.min[1])).toBeGreaterThan(0.3);
    }
  });

  it('chartsOverlap detects overlapping UVs', () => {
    const boxed = unwrapMesh(UNIT_CUBE_POLY, 'planar', { axis: 'y' });
    expect(chartsOverlap(boxed)).toBe(true); // top and bottom project onto each other
  });
});

describe('normalizeUVs', () => {
  it('fits UVs into 0..1 uniformly', () => {
    const mesh = normalizeUVs(unwrapMesh(UNIT_CUBE_POLY, 'box', { partScale: [4, 2, 1] }));
    const box = uvBounds(mesh)!;
    expect(box.min[0]).toBeCloseTo(0);
    expect(box.min[1]).toBeCloseTo(0);
    expect(Math.max(box.max[0], box.max[1])).toBeCloseTo(1);
  });
});
