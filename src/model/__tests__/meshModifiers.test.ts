import { describe, expect, it } from 'vitest';
import type { ModelModifier, ModelPartMesh } from '../../types';
import { UNIT_CUBE_POLY, buildTopology, dot3, makePolyMesh, meshFaces, type Vec3 } from '../polyMesh';
import {
  MAX_RENDER_FACES,
  applyArrayModifier,
  applyMirrorModifier,
  catmullClark,
  evaluateModifiers,
  normalizeModifiers,
} from '../meshModifiers';
import { polyCube, polyPlane } from '../meshGenerators';

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

function expectClosedOriented(mesh: ModelPartMesh): void {
  const half = new Map<string, number>();
  for (const loop of meshFaces(mesh)) {
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
  expect(signedVolume(mesh)).toBeGreaterThan(0);
}

const cubeEdges = (): Array<[number, number]> => buildTopology(UNIT_CUBE_POLY).edges.map(([a, b]) => [a, b]);

describe('catmull-clark', () => {
  it('level 1 on a cube → 24 quads / 26 verts; level 2 → 96 faces; shrinks but stays closed', () => {
    const l1 = catmullClark(UNIT_CUBE_POLY, 1);
    expect(meshFaces(l1)).toHaveLength(24);
    expect(l1.vertices).toHaveLength(26);
    expect(meshFaces(l1).every((loop) => loop.length === 4)).toBe(true);
    expectClosedOriented(l1);
    const l2 = catmullClark(UNIT_CUBE_POLY, 2);
    expect(meshFaces(l2)).toHaveLength(96);
    expectClosedOriented(l2);
    const v0 = signedVolume(UNIT_CUBE_POLY);
    const v1 = signedVolume(l1);
    const v2 = signedVolume(l2);
    expect(v1).toBeLessThan(v0);
    expect(v2).toBeLessThan(v1);
    expect(v2).toBeGreaterThan(0.3);
    // Original corner (−0.5,−0.5,−0.5) moves to the known CC position (−5/18 each axis).
    expect(l1.vertices[0][0]).toBeCloseTo(-5 / 18);
  });

  it('turns triangles and n-gons into quads', () => {
    const mesh = makePolyMesh(
      [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0.5, 1.5, 0], [0, 1, 0]],
      [[0, 1, 2, 3, 4]],
    );
    const out = catmullClark(mesh, 1);
    expect(meshFaces(out)).toHaveLength(5);
    expect(meshFaces(out).every((loop) => loop.length === 4)).toBe(true);
  });

  it('a fully sharp cube keeps its silhouette and sharp edges compound', () => {
    const sharp = { ...UNIT_CUBE_POLY, sharpEdges: cubeEdges() };
    const l2 = catmullClark(sharp, 2);
    for (const corner of UNIT_CUBE_POLY.vertices) {
      expect(l2.vertices.some((p) => p.every((c, k) => Math.abs(c - corner[k]) < 1e-9))).toBe(true);
    }
    for (const p of l2.vertices) {
      expect(Math.max(...p.map(Math.abs))).toBeCloseTo(0.5);
    }
    expect(l2.sharpEdges).toHaveLength(12 * 4);
    expect(signedVolume(l2)).toBeCloseTo(1);
  });

  it('boundary rules: plane corners stay put and boundary stays straight', () => {
    const plane = polyPlane(2, 2);
    const out = catmullClark(plane, 2);
    for (const corner of [[-0.5, 0, -0.5], [0.5, 0, -0.5], [0.5, 0, 0.5], [-0.5, 0, 0.5]]) {
      expect(out.vertices.some((p) => p.every((c, k) => Math.abs(c - corner[k]) < 1e-9))).toBe(true);
    }
    const topo = buildTopology(out);
    topo.edges.forEach(([a, b], e) => {
      if (topo.edgeFaces[e].length !== 1) return;
      for (const v of [a, b]) {
        const p = out.vertices[v];
        expect(Math.abs(Math.abs(p[0]) - 0.5) < 1e-9 || Math.abs(Math.abs(p[2]) - 0.5) < 1e-9).toBe(true);
      }
    });
  });

  it('inherits face slots and subdivides UVs', () => {
    const cube = polyCube(1);
    const painted = { ...cube, faceSlots: [0, 1, 2, 3, 4, 5] };
    const out = catmullClark(painted, 1);
    expect(out.faceSlots).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5]);
    expect(out.faceUVs).toHaveLength(24);
    expect(out.faceUVs![0][2]).toEqual([0.5, 0.5]);
  });

  it('caps the output face count', () => {
    const dense = polyCube(32); // 6144 quads → level 2 would be 98k, level 3 393k
    const out = catmullClark(dense, 4);
    expect(meshFaces(out).length).toBeLessThanOrEqual(MAX_RENDER_FACES);
    expect(meshFaces(out).length).toBe(6144 * 16);
  });
});

describe('mirror modifier', () => {
  it('mirrors an open half-cube into a closed cube with a welded seam', () => {
    // x ∈ [0, 0.5], no face on the x = 0 plane; seam verts slightly off the plane.
    const half = makePolyMesh(
      [
        [0.0004, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0, 0.5, -0.5],
        [0, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.0002, 0.5, 0.5],
      ],
      [
        [1, 0, 3, 2],
        [4, 5, 6, 7],
        [1, 2, 6, 5],
        [3, 7, 6, 2],
        [0, 1, 5, 4],
      ],
      { sharpEdges: [[1, 2]] },
    );
    const out = applyMirrorModifier(half, ['x']);
    // 4 seam verts shared + 4 originals + 4 mirrored copies.
    expect(out.vertices).toHaveLength(12);
    expect(out.vertices.filter((p) => p[0] === 0)).toHaveLength(4);
    expect(meshFaces(out)).toHaveLength(10);
    expectClosedOriented(out);
    expect(signedVolume(out)).toBeCloseTo(1, 3);
    expect(out.sharpEdges).toHaveLength(2);
    expect(half.vertices[0][0]).toBe(0.0004); // input untouched
  });

  it('mirrors across several axes', () => {
    const quarter = makePolyMesh([[0.2, 0.2, 0], [0.4, 0.2, 0], [0.4, 0.4, 0]], [[0, 1, 2]]);
    expect(meshFaces(applyMirrorModifier(quarter, ['x', 'y']))).toHaveLength(4);
  });
});

describe('array modifier', () => {
  it('linear copies step by offset', () => {
    const out = applyArrayModifier(UNIT_CUBE_POLY, { count: 3, mode: 'linear', offset: [1.5, 0, 0] });
    expect(meshFaces(out)).toHaveLength(18);
    expect(out.vertices).toHaveLength(24);
    expect(Math.max(...out.vertices.map((p) => p[0]))).toBeCloseTo(3.5);
  });

  it('radial copies rotate evenly (full ring) or end on the angle (partial)', () => {
    const blade = makePolyMesh([[0.3, 0, -0.05], [0.5, 0, -0.05], [0.5, 0, 0.05], [0.3, 0, 0.05]], [[0, 1, 2, 3]]);
    const ring = applyArrayModifier(blade, { count: 4, mode: 'radial', axis: 'y', angle: 360 });
    expect(meshFaces(ring)).toHaveLength(4);
    // Copy 1 rotated 90° about Y: (0.5,0,-0.05) → (-0.05, 0, -0.5)
    const p: Vec3 = ring.vertices[5];
    expect(p[0]).toBeCloseTo(-0.05);
    expect(p[2]).toBeCloseTo(-0.5);
    const fan = applyArrayModifier(blade, { count: 3, mode: 'radial', axis: 'y', angle: 90 });
    const last = fan.vertices[9];
    expect(last[0]).toBeCloseTo(-0.05);
    expect(last[2]).toBeCloseTo(-0.5);
  });

  it('clamps count to 1..64', () => {
    expect(meshFaces(applyArrayModifier(UNIT_CUBE_POLY, { count: 500, mode: 'linear' }))).toHaveLength(6 * 64);
    expect(applyArrayModifier(UNIT_CUBE_POLY, { count: 0, mode: 'linear' })).toBe(UNIT_CUBE_POLY);
  });
});

describe('modifier stack', () => {
  const half = makePolyMesh(
    [[0, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0, 0.5, -0.5], [0, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [0, 0.5, 0.5]],
    [[1, 0, 3, 2], [4, 5, 6, 7], [1, 2, 6, 5], [3, 7, 6, 2], [0, 1, 5, 4]],
  );

  it('runs in order and skips disabled entries', () => {
    const mirrorThenSub: ModelModifier[] = [{ type: 'mirror', axes: ['x'] }, { type: 'subdivision', levels: 1 }];
    const subThenMirror: ModelModifier[] = [{ type: 'subdivision', levels: 1 }, { type: 'mirror', axes: ['x'] }];
    const a = evaluateModifiers(half, mirrorThenSub);
    const b = evaluateModifiers(half, subThenMirror);
    expect(meshFaces(a)).toHaveLength(40);
    expectClosedOriented(a);
    expect(meshFaces(b)).toHaveLength(40);
    const minX = (m: ModelPartMesh) => Math.min(...m.vertices.map((p) => p[0]));
    const mirrorThenArray = evaluateModifiers(half, [{ type: 'mirror', axes: ['x'] }, { type: 'array', count: 2, mode: 'linear', offset: [0.5, 0, 0] }]);
    const arrayThenMirror = evaluateModifiers(half, [{ type: 'array', count: 2, mode: 'linear', offset: [0.5, 0, 0] }, { type: 'mirror', axes: ['x'] }]);
    expect(minX(mirrorThenArray)).toBeCloseTo(-0.5);
    expect(minX(arrayThenMirror)).toBeCloseTo(-1);
    const disabled = evaluateModifiers(half, [{ type: 'mirror', axes: ['x'] }, { type: 'subdivision', levels: 2, enabled: false }]);
    expect(meshFaces(disabled)).toHaveLength(10);
    expect(evaluateModifiers(half, [{ type: 'bogus' } as unknown as ModelModifier])).toBe(half);
    expect(evaluateModifiers(half, [])).toBe(half);
  });

  it('memoizes by mesh identity + modifiers', () => {
    const stack: ModelModifier[] = [{ type: 'mirror', axes: ['x'] }, { type: 'subdivision', levels: 2 }];
    const first = evaluateModifiers(half, stack);
    expect(evaluateModifiers(half, JSON.parse(JSON.stringify(stack)))).toBe(first);
    expect(evaluateModifiers(half, [{ type: 'subdivision', levels: 1 }])).not.toBe(first);
    expect(evaluateModifiers({ ...half }, stack)).not.toBe(first);
  });

  it('normalizeModifiers sanitizes saved / AI data', () => {
    expect(normalizeModifiers('nope')).toBeUndefined();
    expect(normalizeModifiers([])).toBeUndefined();
    const out = normalizeModifiers([
      { type: 'mirror', axes: ['x', 'X', 'q', 'z'], mergeDistance: 5 },
      { type: 'array', count: 999, mode: 'radial', angle: 720 },
      { type: 'subdivision', levels: 9, enabled: false },
      { type: 'explode' },
      null,
      ...Array.from({ length: 10 }, () => ({ type: 'subdivision', levels: 1 })),
    ]);
    expect(out).toHaveLength(8);
    expect(out![0]).toEqual({ type: 'mirror', axes: ['x', 'z'], mergeDistance: 0.1 });
    expect(out![1]).toEqual({ type: 'array', count: 64, mode: 'radial', axis: 'y', angle: 360 });
    expect(out![2]).toEqual({ type: 'subdivision', enabled: false, levels: 4 });
  });
});
