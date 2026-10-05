import { describe, expect, it } from 'vitest';
import type { ModelPartMesh } from '../../types';
import { buildTopology, dot3, meshFaces, polygonArea, type Vec3 } from '../polyMesh';
import {
  generatePrimitivePolyMesh,
  lathe,
  parallelTransportFrames,
  polyCapsule,
  polyCone,
  polyCube,
  polyCylinder,
  polyPlane,
  polySphere,
  polyTorus,
  tube,
} from '../meshGenerators';

function signedVolume(mesh: ModelPartMesh): number {
  let volume = 0;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = mesh.vertices[mesh.indices[t]];
    const b = mesh.vertices[mesh.indices[t + 1]];
    const c = mesh.vertices[mesh.indices[t + 2]];
    volume += dot3(a, [b[1] * c[2] - b[2] * c[1], b[2] * c[0] - b[0] * c[2], b[0] * c[1] - b[1] * c[0]]) / 6;
  }
  return volume;
}

/** Closed 2-manifold with consistent winding: every directed half-edge appears exactly once and its twin exists. */
function expectClosedOriented(mesh: ModelPartMesh): void {
  const half = new Map<string, number>();
  for (const loop of meshFaces(mesh)) {
    expect(new Set(loop).size).toBe(loop.length);
    for (let i = 0; i < loop.length; i += 1) {
      const key = `${loop[i]}>${loop[(i + 1) % loop.length]}`;
      half.set(key, (half.get(key) ?? 0) + 1);
    }
  }
  for (const [key, count] of half) {
    expect(count, key).toBe(1);
    const [a, b] = key.split('>');
    expect(half.get(`${b}>${a}`), `twin of ${key}`).toBe(1);
  }
  const topo = buildTopology({ vertices: mesh.vertices, faces: meshFaces(mesh) });
  expect(topo.edgeFaces.every((f) => f.length === 2)).toBe(true);
  expect(signedVolume(mesh)).toBeGreaterThan(0);
}

const noDegenerate = (mesh: ModelPartMesh) =>
  meshFaces(mesh).every((loop) => loop.length >= 3 && polygonArea(mesh.vertices, loop) > 1e-9);

const bounds = (mesh: ModelPartMesh) => {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of mesh.vertices) for (let k = 0; k < 3; k += 1) {
    min[k] = Math.min(min[k], p[k]);
    max[k] = Math.max(max[k], p[k]);
  }
  return { min, max };
};

describe('mesh generators', () => {
  const closed: Array<[string, () => ModelPartMesh]> = [
    ['cube', () => polyCube()],
    ['cube 3', () => polyCube(3)],
    ['cylinder', () => polyCylinder()],
    ['cylinder fan 3 seg', () => polyCylinder(12, 3, 'fan')],
    ['cone', () => polyCone()],
    ['sphere', () => polySphere()],
    ['torus', () => polyTorus()],
    ['capsule', () => polyCapsule()],
    ['lathe vase', () => lathe([[0.2, -0.5], [0.4, -0.2], [0.15, 0.3], [0.25, 0.5]], 16)],
    ['lathe reversed profile', () => lathe([[0.25, 0.5], [0.15, 0.3], [0.4, -0.2], [0.2, -0.5]], 16)],
    ['lathe partial 270', () => lathe([[0.2, -0.5], [0.4, 0], [0.2, 0.5]], 12, 270)],
    ['lathe partial with poles', () => lathe([[0, -0.5], [0.4, 0], [0, 0.5]], 12, 90)],
    ['tube open', () => tube([[0, 0, 0], [0.3, 0.1, 0], [0.3, 0.4, 0.2], [0, 0.5, 0.4]], 0.05, 8)],
    ['tube closed', () => tube([[0.3, 0, 0], [0, 0, 0.3], [-0.3, 0, 0], [0, 0.1, -0.3]], 0.05, 8, true)],
  ];
  for (const [name, make] of closed) {
    it(`${name} is a closed outward manifold without degenerate faces`, () => {
      const mesh = make();
      expectClosedOriented(mesh);
      expect(noDegenerate(mesh)).toBe(true);
      expect(mesh.faceUVs?.length).toBe(meshFaces(mesh).length);
    });
  }

  for (const shape of ['box', 'cylinder', 'sphere', 'cone', 'torus', 'pyramid', 'hexprism', 'capsule', 'wedge'] as const) {
    it(`primitive ${shape} is closed, outward and fits the ±0.5 unit box`, () => {
      const mesh = generatePrimitivePolyMesh(shape);
      expectClosedOriented(mesh);
      const { min, max } = bounds(mesh);
      for (let k = 0; k < 3; k += 1) {
        expect(min[k]).toBeGreaterThanOrEqual(-0.5 - 1e-9);
        expect(max[k]).toBeLessThanOrEqual(0.5 + 1e-9);
      }
    });
  }

  it('cube has 6·s² quads and shared vertices', () => {
    const cube = polyCube(2);
    expect(meshFaces(cube)).toHaveLength(24);
    expect(cube.vertices).toHaveLength(26);
    expect(meshFaces(cube).every((loop) => loop.length === 4)).toBe(true);
  });

  it('plane is a single-sided +Y grid', () => {
    const plane = polyPlane(3, 2);
    expect(meshFaces(plane)).toHaveLength(6);
    expect(plane.vertices).toHaveLength(12);
    expect(signedVolume(plane)).toBeCloseTo(0);
    for (let t = 0; t < plane.indices.length; t += 3) {
      const [a, b, c] = [0, 1, 2].map((k) => plane.vertices[plane.indices[t + k]]);
      const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
      expect(ny).toBeGreaterThan(0);
    }
  });

  it('cylinder marks both cap rims sharp and matches primitive dims', () => {
    const cyl = polyCylinder(20);
    expect(cyl.sharpEdges).toHaveLength(40);
    expect(meshFaces(cyl)).toHaveLength(22);
    const fan = polyCylinder(8, 1, 'fan');
    expect(meshFaces(fan).filter((loop) => loop.length === 3)).toHaveLength(16);
  });

  it('sphere uses quads with triangle fans at the poles', () => {
    const sphere = polySphere(24, 12);
    const faces = meshFaces(sphere);
    expect(faces.filter((loop) => loop.length === 3)).toHaveLength(48);
    expect(faces.filter((loop) => loop.length === 4)).toHaveLength(24 * 10);
    expect(sphere.vertices).toHaveLength(24 * 11 + 2);
  });

  it('lathe collapses radius-0 points to a single pole and shares the 360° seam', () => {
    const mesh = lathe([[0, -0.5], [0.3, -0.2], [0.3, 0.2], [0, 0.5]], 10);
    expect(mesh.vertices).toHaveLength(2 + 2 * 10);
    expect(noDegenerate(mesh)).toBe(true);
    const tris = meshFaces(mesh).filter((loop) => loop.length === 3);
    expect(tris).toHaveLength(20);
  });

  it('tube frames never flip along a winding path', () => {
    const path: Vec3[] = [];
    for (let i = 0; i <= 64; i += 1) {
      const t = i / 64;
      path.push([0.3 * Math.cos(t * 12), t - 0.5, 0.3 * Math.sin(t * 12)]);
    }
    const frames = parallelTransportFrames(path);
    for (let i = 1; i < frames.length; i += 1) {
      expect(dot3(frames[i].normal, frames[i - 1].normal)).toBeGreaterThan(0.8);
      expect(Math.abs(dot3(frames[i].normal, frames[i].tangent))).toBeLessThan(1e-6);
    }
    const mesh = tube(path, 0.04, 8);
    expectClosedOriented(mesh);
  });
});
