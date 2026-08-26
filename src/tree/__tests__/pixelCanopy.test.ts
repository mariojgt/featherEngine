import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  PIXEL_CANOPY_HEIGHT,
  PIXEL_CANOPY_WIDTH,
  PIXEL_LEAF_ARTS,
  buildPixelCanopyAtlasData,
  pixelCanopyTexture,
  pixelCanopyUvRect,
} from '../pixelCanopy';

describe('procedural pixel canopy atlas', () => {
  it('is byte-for-byte deterministic and contains transparent cutouts', () => {
    const first = buildPixelCanopyAtlasData();
    const second = buildPixelCanopyAtlasData();
    expect(first.width).toBe(PIXEL_CANOPY_WIDTH);
    expect(first.height).toBe(PIXEL_CANOPY_HEIGHT);
    expect(first.data).toEqual(second.data);

    let opaque = 0;
    let transparent = 0;
    for (let offset = 3; offset < first.data.length; offset += 4) {
      if (first.data[offset] === 0) transparent += 1;
      else opaque += 1;
    }
    expect(opaque).toBeGreaterThan(PIXEL_CANOPY_WIDTH * PIXEL_CANOPY_HEIGHT * 0.2);
    expect(transparent).toBeGreaterThan(PIXEL_CANOPY_WIDTH * PIXEL_CANOPY_HEIGHT * 0.2);
  });

  it('gives every leaf language three populated, non-overlapping atlas cells', () => {
    const { data, width, height } = buildPixelCanopyAtlasData();
    const rects = new Set<string>();
    for (const leafArt of PIXEL_LEAF_ARTS) {
      for (let variant = 0; variant < 3; variant += 1) {
        const rect = pixelCanopyUvRect(leafArt, variant);
        expect(rect.every((value) => value > 0 && value < 1)).toBe(true);
        rects.add(rect.join(':'));
        const minX = Math.floor(Math.min(rect[0], rect[2]) * width);
        const maxX = Math.ceil(Math.max(rect[0], rect[2]) * width);
        const minY = Math.floor(Math.min(rect[1], rect[3]) * height);
        const maxY = Math.ceil(Math.max(rect[1], rect[3]) * height);
        let painted = 0;
        for (let y = minY; y < maxY; y += 1) {
          for (let x = minX; x < maxX; x += 1) {
            if (data[(y * width + x) * 4 + 3] > 0) painted += 1;
          }
        }
        expect(painted, `${leafArt}:${variant}`).toBeGreaterThan(12);
      }
    }
    expect(rects.size).toBe(PIXEL_LEAF_ARTS.length * 3);
  });

  it('uses one nearest-filtered shared GPU texture', () => {
    const first = pixelCanopyTexture();
    expect(pixelCanopyTexture()).toBe(first);
    expect(first).toBeInstanceOf(THREE.DataTexture);
    expect(first.magFilter).toBe(THREE.NearestFilter);
    expect(first.generateMipmaps).toBe(true);
  });
});
