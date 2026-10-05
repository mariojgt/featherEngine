import { describe, expect, it } from 'vitest';
import { UNIT_CUBE_POLY, buildTopology, meshFaces } from '../polyMesh';
import { buildRenderArrays } from '../meshRenderArrays';
import { polyCube, polyCylinder, polySphere } from '../meshGenerators';

describe('render arrays', () => {
  it('cube at 30° → 24 split vertices with flat normals', () => {
    const arrays = buildRenderArrays(UNIT_CUBE_POLY, { smoothAngle: 30, defaultSlot: 0 });
    expect(arrays.positions.length / 3).toBe(24);
    expect(arrays.indices.length).toBe(36);
    for (let i = 0; i < arrays.normals.length; i += 3) {
      const n = [arrays.normals[i], arrays.normals[i + 1], arrays.normals[i + 2]];
      expect(n.filter((c) => Math.abs(Math.abs(c) - 1) < 1e-6)).toHaveLength(1);
    }
    expect(arrays.uvs).toBeNull();
  });

  it('cube at 180° without sharp edges → 8 shared smooth vertices', () => {
    const arrays = buildRenderArrays(UNIT_CUBE_POLY, { smoothAngle: 180, defaultSlot: 0 });
    expect(arrays.positions.length / 3).toBe(8);
    const n = Array.from(arrays.normals.slice(0, 3));
    expect(Math.abs(n[0])).toBeCloseTo(1 / Math.sqrt(3));
  });

  it('sharp edges split smooth fans', () => {
    const edges = buildTopology(UNIT_CUBE_POLY).edges.map(([a, b]) => [a, b] as [number, number]);
    const arrays = buildRenderArrays({ ...UNIT_CUBE_POLY, sharpEdges: edges }, { smoothAngle: 180 });
    expect(arrays.positions.length / 3).toBe(24);
  });

  it('smoothAngle 0 is fully faceted; a smooth cylinder keeps hard cap rims', () => {
    const sphere = polySphere(12, 6);
    const flat = buildRenderArrays(sphere, { smoothAngle: 0 });
    const smooth = buildRenderArrays(sphere, { smoothAngle: 180 });
    expect(smooth.positions.length).toBeLessThan(flat.positions.length);
    const cyl = polyCylinder(16);
    const arrays = buildRenderArrays(cyl, { smoothAngle: 180 });
    // UV seam (u=0 vs u=1) duplicates one column; caps get their own vertices due to the sharp rims.
    const vertexCount = arrays.positions.length / 3;
    expect(vertexCount).toBe(2 * 17 + 2 * 16);
    for (let i = 0; i < vertexCount; i += 1) {
      const ny = arrays.normals[i * 3 + 1];
      expect(Math.abs(ny) < 1e-6 || Math.abs(Math.abs(ny) - 1) < 1e-6).toBe(true);
    }
    expect(arrays.uvs).not.toBeNull();
    expect(arrays.uvs!.length / 2).toBe(vertexCount);
  });

  it('groups by slot cover every index and triangleFaces maps back to polygons', () => {
    const cube = polyCube(2);
    const faceSlots = meshFaces(cube).map((_, f) => (f % 3 === 0 ? -1 : f % 3));
    const arrays = buildRenderArrays({ ...cube, faceSlots }, { smoothAngle: 30, defaultSlot: 7 });
    expect(arrays.groups.map((g) => g.slot)).toEqual([1, 2, 7]);
    expect(arrays.groups.reduce((sum, g) => sum + g.count, 0)).toBe(arrays.indices.length);
    let cursor = 0;
    for (const group of arrays.groups) {
      expect(group.start).toBe(cursor);
      cursor += group.count;
      for (let t = group.start / 3; t < (group.start + group.count) / 3; t += 1) {
        const face = arrays.triangleFaces[t];
        const slot = faceSlots[face] >= 0 ? faceSlots[face] : 7;
        expect(slot).toBe(group.slot);
      }
    }
    expect(arrays.triangleFaces.length).toBe(arrays.indices.length / 3);
    expect(arrays.triangleFaces.length).toBe(48);
  });

  it('memoizes per mesh + options', () => {
    const a = buildRenderArrays(UNIT_CUBE_POLY, { smoothAngle: 30 });
    expect(buildRenderArrays(UNIT_CUBE_POLY, { smoothAngle: 30 })).toBe(a);
    expect(buildRenderArrays(UNIT_CUBE_POLY, { smoothAngle: 31 })).not.toBe(a);
  });
});
