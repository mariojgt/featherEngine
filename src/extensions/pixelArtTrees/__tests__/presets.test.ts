import { describe, expect, it } from 'vitest';
import { generateTree } from '../../../tree/generateTree';
import {
  PIXEL_TREE_HABITS,
  PIXEL_TREE_SPECIES,
  pixelTreeSignature,
  pixelTreeSpec,
} from '../presets';

describe('Pixel Art Trees recipes', () => {
  it('materializes every species and habit as a normalized painted-card tree', () => {
    for (const species of PIXEL_TREE_SPECIES) {
      for (const habit of PIXEL_TREE_HABITS) {
        const spec = pixelTreeSpec(
          { speciesId: species.id, habit: habit.id, scale: 1, leafDensity: 1 },
          `${species.id}-${habit.id}`,
        );
        expect(spec.look.pixelArt.enabled).toBe(true);
        expect(spec.look.pixelArt.leafArt).toBe(species.leafArt);
        expect(spec.foliage.strategy).toBe('cards');
        expect(spec.trunk.height).toBeGreaterThan(0);
        expect(spec.foliage.density).toBeGreaterThan(0);
      }
    }
  });

  it('generates usable deterministic geometry for all nine leaf languages', () => {
    for (const species of PIXEL_TREE_SPECIES) {
      const spec = pixelTreeSpec({ speciesId: species.id, habit: 'spread', scale: 1, leafDensity: 1 }, species.id);
      const first = generateTree(spec, 731);
      const second = generateTree(spec, 731);
      expect(first.foliage, species.id).toBeTruthy();
      expect(first.triangles, species.id).toBeGreaterThan(80);
      expect(Array.from(first.foliage!.getAttribute('position').array), species.id).toEqual(
        Array.from(second.foliage!.getAttribute('position').array),
      );

      const cardOffset = first.foliage!.getAttribute('aCardOffset');
      expect(cardOffset, species.id).toBeTruthy();
      let billboardVertices = 0;
      for (let index = 0; index < cardOffset.count; index += 1) {
        if (Math.abs(cardOffset.getX(index)) + Math.abs(cardOffset.getY(index)) > 0) billboardVertices += 1;
      }
      expect(billboardVertices, species.id).toBeGreaterThan(0);
    }
  });

  it('keeps identity out of recipe equality and preserves palette edits', () => {
    const recipe = { speciesId: 'cherry', habit: 'ancient' as const, scale: 1.2, leafDensity: 0.9, leafInner: '#112233', leafOuter: '#ddeeff' };
    const first = pixelTreeSpec(recipe, 'one', 'First');
    const second = pixelTreeSpec(recipe, 'two', 'Second');
    expect(pixelTreeSignature(first)).toBe(pixelTreeSignature(second));
    expect(first.look.foliageRamp).toEqual(['#112233', '#ddeeff']);
  });

  it('keeps painted cards in the cheapest LOD instead of mapping cutouts onto solid blobs', () => {
    const spec = pixelTreeSpec({ speciesId: 'pine', habit: 'young', scale: 1, leafDensity: 1 }, 'lod-pine');
    const distant = generateTree(spec, 19, { lod: 2 });
    expect(distant.foliage).toBeTruthy();
    const offsets = distant.foliage!.getAttribute('aCardOffset');
    expect(offsets).toBeTruthy();
    expect(Array.from(offsets.array).some((value) => Math.abs(value) > 0)).toBe(true);
  });
});
