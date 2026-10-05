import { describe, expect, it } from 'vitest';
import type { ModelPart, ModelPartMesh } from '../../types';
import { bakePartTextures, ensureBakeUVs, type BakeResult } from '../meshBake';
import { makePolyMesh, polygonNormal, UNIT_CUBE_POLY, type Vec3 } from '../polyMesh';

const PALETTE = ['#3366ff', '#ff2200', '#22cc44', '#ffffff'];

function meshPart(mesh: ModelPartMesh, extra: Partial<ModelPart> = {}): ModelPart {
  return {
    id: 'p',
    name: 'Part',
    shape: 'mesh',
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    colorSlot: 0,
    mesh,
    smoothAngle: 40,
    ...extra,
  };
}

/** Smart-unwrapped part (ensureBakeUVs does the unwrap). */
const unwrapped = (mesh: ModelPartMesh, extra: Partial<ModelPart> = {}) => ensureBakeUVs(meshPart(mesh, extra));

/** Pixel index of a face's UV centroid (row 0 = v 1). */
function faceCenterTexel(part: ModelPart, face: number, size: number): number {
  const uvs = part.mesh!.faceUVs![face];
  const u = uvs.reduce((s, uv) => s + uv[0], 0) / uvs.length;
  const v = uvs.reduce((s, uv) => s + uv[1], 0) / uvs.length;
  const x = Math.min(size - 1, Math.floor(u * size));
  const y = Math.min(size - 1, Math.floor((1 - v) * size));
  return y * size + x;
}

/** Covered-texel mask: bake color with padding 0, faces slot 1 vs background slot 0. */
function coverageMask(part: ModelPart, size: number): Uint8Array {
  const faces = part.mesh!.faces!.length;
  const marked = { ...part, colorSlot: 0, mesh: { ...part.mesh!, faceSlots: new Array(faces).fill(1) } };
  const result = bakePartTextures(marked, ['color'], { size, padding: 0, palette: PALETTE });
  const mask = new Uint8Array(size * size);
  for (let i = 0; i < mask.length; i += 1) mask[i] = result.color![i * 4] === 255 ? 1 : 0;
  return mask;
}

/** Builds a closed cube with a square pit sunk into its top face. Winding fixed by expected normals. */
function pitCube(): ModelPartMesh {
  const h = 0.5;
  const r = 0.2;
  const floor = 0.0;
  const vertices: Vec3[] = [
    [-h, -h, -h], [h, -h, -h], [h, -h, h], [-h, -h, h], // 0-3 bottom
    [-h, h, -h], [h, h, -h], [h, h, h], [-h, h, h], // 4-7 top outer
    [-r, h, -r], [r, h, -r], [r, h, r], [-r, h, r], // 8-11 top inner
    [-r, floor, -r], [r, floor, -r], [r, floor, r], [-r, floor, r], // 12-15 pit floor
  ];
  const spec: Array<[number[], Vec3]> = [
    [[0, 1, 2, 3], [0, -1, 0]],
    [[0, 4, 5, 1], [0, 0, -1]],
    [[1, 5, 6, 2], [1, 0, 0]],
    [[2, 6, 7, 3], [0, 0, 1]],
    [[3, 7, 4, 0], [-1, 0, 0]],
    // top ring
    [[4, 8, 9, 5], [0, 1, 0]],
    [[5, 9, 10, 6], [0, 1, 0]],
    [[6, 10, 11, 7], [0, 1, 0]],
    [[7, 11, 8, 4], [0, 1, 0]],
    // pit walls (face inward to the pit centre)
    [[8, 12, 13, 9], [0, 0, 1]],
    [[9, 13, 14, 10], [-1, 0, 0]],
    [[10, 14, 15, 11], [0, 0, -1]],
    [[11, 15, 12, 8], [1, 0, 0]],
    // pit floor
    [[12, 15, 14, 13], [0, 1, 0]],
  ];
  const faces = spec.map(([loop, expected]) => {
    const n = polygonNormal(vertices, loop);
    return n[0] * expected[0] + n[1] * expected[1] + n[2] * expected[2] < 0 ? [...loop].reverse() : loop;
  });
  return makePolyMesh(vertices, faces);
}

const mean = (result: BakeResult, key: 'ao' | 'normal' | 'color', mask: Uint8Array) => {
  const buf = result[key]!;
  const sum = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i]) continue;
    sum[0] += buf[i * 4];
    sum[1] += buf[i * 4 + 1];
    sum[2] += buf[i * 4 + 2];
    n += 1;
  }
  return sum.map((v) => v / n);
};

describe('meshBake', () => {
  it('throws a helpful error without UVs; ensureBakeUVs fixes it', () => {
    const part = meshPart(UNIT_CUBE_POLY);
    expect(() => bakePartTextures(part, ['ao'])).toThrow(/Unwrap the part/);
    const fixed = ensureBakeUVs(part);
    expect(fixed.mesh!.faceUVs).toHaveLength(6);
    expect(() => bakePartTextures(fixed, ['ao'], { size: 64, samples: 4 })).not.toThrow();
    // Already bake-ready parts come back unchanged.
    expect(ensureBakeUVs(fixed)).toBe(fixed);
  });

  it('convex cube: good coverage and no self-occlusion', () => {
    const part = unwrapped(UNIT_CUBE_POLY);
    const size = 128;
    const result = bakePartTextures(part, ['ao'], { size, samples: 16, padding: 0 });
    expect(result.width).toBe(size);
    expect(result.coverage).toBeGreaterThan(0.3);
    const mask = coverageMask(part, size);
    let min = 255;
    for (let i = 0; i < mask.length; i += 1) if (mask[i]) min = Math.min(min, result.ao![i * 4]);
    expect(min).toBeGreaterThanOrEqual(250);
  });

  it('concave pit darkens its floor relative to open faces', () => {
    const part = unwrapped(pitCube());
    const size = 128;
    const result = bakePartTextures(part, ['ao'], { size, samples: 32 });
    const bottom = result.ao![faceCenterTexel(part, 0, size) * 4];
    const pitFloor = result.ao![faceCenterTexel(part, 13, size) * 4];
    expect(bottom).toBeGreaterThan(245);
    expect(pitFloor).toBeLessThan(bottom - 60);
  });

  it('extra occluders shadow the part', () => {
    const part = unwrapped(UNIT_CUBE_POLY);
    const size = 96;
    // A slab hovering 0.1 above the +Y face.
    const slab = makePolyMesh(
      UNIT_CUBE_POLY.vertices.map((v) => [v[0] * 2, v[1] * 0.1 + 0.65, v[2] * 2] as Vec3),
      UNIT_CUBE_POLY.faces!,
    );
    const occluder = { positions: new Float32Array(slab.vertices.flat()), indices: new Uint32Array(slab.indices) };
    const top = 4; // +Y in UNIT_CUBE_POLY
    const bottom = 5;
    const open = bakePartTextures(part, ['ao'], { size, samples: 16 });
    const shadowed = bakePartTextures(part, ['ao'], { size, samples: 16, occluders: [occluder] });
    const topTexel = faceCenterTexel(part, top, size) * 4;
    expect(open.ao![topTexel]).toBeGreaterThan(245);
    expect(shadowed.ao![topTexel]).toBeLessThan(150);
    expect(shadowed.ao![faceCenterTexel(part, bottom, size) * 4]).toBeGreaterThan(245);
  });

  it('normal map without modifiers is flat', () => {
    const part = unwrapped(pitCube());
    const size = 96;
    const result = bakePartTextures(part, ['normal'], { size });
    const m = mean(result, 'normal', coverageMask(part, size));
    expect(Math.abs(m[0] - 128)).toBeLessThan(6);
    expect(Math.abs(m[1] - 128)).toBeLessThan(6);
    expect(Math.abs(m[2] - 255)).toBeLessThan(6);
  });

  it('subdivided cube bends the normal map and keeps unit length', () => {
    const part = unwrapped(UNIT_CUBE_POLY, { modifiers: [{ type: 'subdivision', levels: 2 }] });
    const size = 96;
    const result = bakePartTextures(part, ['normal'], { size });
    const mask = coverageMask(part, size);
    let maxDeviation = 0;
    let worstLength = 0;
    for (let i = 0; i < mask.length; i += 1) {
      if (!mask[i]) continue;
      const x = result.normal![i * 4] / 255 * 2 - 1;
      const y = result.normal![i * 4 + 1] / 255 * 2 - 1;
      const z = result.normal![i * 4 + 2] / 255 * 2 - 1;
      maxDeviation = Math.max(maxDeviation, Math.hypot(x, y));
      worstLength = Math.max(worstLength, Math.abs(Math.hypot(x, y, z) - 1));
    }
    expect(maxDeviation).toBeGreaterThan(0.3);
    expect(worstLength).toBeLessThan(0.03);
    // The face centre stays close to flat.
    const centre = faceCenterTexel(part, 4, size) * 4;
    expect(Math.abs(result.normal![centre] - 128)).toBeLessThan(12);
    expect(Math.abs(result.normal![centre + 1] - 128)).toBeLessThan(12);
  });

  it('color bake reproduces faceSlots (and multiplies AO only when asked)', () => {
    const base = unwrapped(UNIT_CUBE_POLY);
    const part = { ...base, mesh: { ...base.mesh!, faceSlots: [1, 2, -1, 3, 1, 2] } };
    const size = 64;
    const result = bakePartTextures(part, ['color'], { size, palette: PALETTE });
    const at = (face: number) => Array.from(result.color!.slice(faceCenterTexel(part, face, size) * 4, faceCenterTexel(part, face, size) * 4 + 4));
    expect(at(0)).toEqual([255, 34, 0, 255]);
    expect(at(1)).toEqual([34, 204, 68, 255]);
    expect(at(2)).toEqual([51, 102, 255, 255]); // -1 → part colorSlot 0
    expect(at(3)).toEqual([255, 255, 255, 255]);
  });

  it('padding fills texels just outside chart edges', () => {
    const base = unwrapped(UNIT_CUBE_POLY);
    const part = { ...base, mesh: { ...base.mesh!, faceSlots: new Array(6).fill(1) } };
    const size = 64;
    const bare = bakePartTextures(part, ['color'], { size, padding: 0, palette: PALETTE });
    const padded = bakePartTextures(part, ['color'], { size, padding: 4, palette: PALETTE });
    let checked = 0;
    for (let y = 1; y < size - 1; y += 1) {
      for (let x = 1; x < size - 1; x += 1) {
        const i = y * size + x;
        if (bare.color![i * 4] === 255) continue; // covered (red)
        const touchesChart = [i - 1, i + 1, i - size, i + size].some((n) => bare.color![n * 4] === 255);
        if (!touchesChart) continue;
        expect(padded.color![i * 4]).toBe(255);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('is deterministic', () => {
    const part = unwrapped(pitCube(), { modifiers: [{ type: 'subdivision', levels: 1 }] });
    const options = { size: 64, samples: 8, palette: PALETTE };
    const a = bakePartTextures(part, ['ao', 'normal', 'color'], options);
    const b = bakePartTextures(part, ['ao', 'normal', 'color'], options);
    expect(a.ao).toEqual(b.ao);
    expect(a.normal).toEqual(b.normal);
    expect(a.color).toEqual(b.color);
  });

  it('respects non-uniform scale and clamps options', () => {
    const part = unwrapped(UNIT_CUBE_POLY, { scale: [4, 0.5, 1] });
    const result = bakePartTextures(part, ['ao', 'normal'], { size: 10, samples: 1 });
    expect(result.width).toBe(64);
    expect(result.ao!.length).toBe(64 * 64 * 4);
  });

  it('performance smoke: 256² AO, 8 samples, subdivided cube', () => {
    const part = unwrapped(UNIT_CUBE_POLY, { modifiers: [{ type: 'subdivision', levels: 3 }] });
    const start = performance.now();
    const result = bakePartTextures(part, ['ao'], { size: 256, samples: 8 });
    const elapsed = performance.now() - start;
    expect(result.coverage).toBeGreaterThan(0.3);
    expect(elapsed).toBeLessThan(3000);
  });

  // Opt-in benchmark: BAKE_BENCH=1 npx vitest run src/model/__tests__/meshBake.test.ts
  it.skipIf(!process.env.BAKE_BENCH)('benchmark: 512² AO, 16 samples, ~3k-triangle mesh', () => {
    const part = unwrapped(UNIT_CUBE_POLY, { modifiers: [{ type: 'subdivision', levels: 4 }] });
    for (const maps of [['ao'], ['ao', 'normal', 'color']] as const) {
      const start = performance.now();
      const result = bakePartTextures(part, [...maps], { size: 512, samples: 16, palette: PALETTE });
      console.log(`bake ${maps.join('+')} 512² x16: ${(performance.now() - start).toFixed(0)} ms, coverage ${result.coverage.toFixed(3)}`);
    }
  });
});
