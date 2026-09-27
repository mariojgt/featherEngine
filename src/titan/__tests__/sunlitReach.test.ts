import { describe, it, expect } from 'vitest';
import { isTitanScene, titanZoneScenes } from '../settings';
import { sunlitReachContent } from '../sunlitReach';
import { sampleTerrainLocalHeight } from '../../terrain/terrain';
import { groundHeight, VALLEY_ID, VALLEY_SOLIDS } from '../../../examples/titan-mmo/server/valley.mjs';
const content = sunlitReachContent();
describe('Sunlit Reach continuous valley', () => {
  it('packages one deterministic Titan scene with unique objects and an editable arrival cinematic', () => {
    expect(sunlitReachContent()).toEqual(content);
    expect(content.scenes).toHaveLength(1);
    const scene = content.scenes[0];
    expect(isTitanScene(scene.objects)).toBe(true);
    expect(Object.keys(titanZoneScenes(content.scenes))).toEqual([VALLEY_ID]);
    expect(new Set(scene.objects.map(o => o.id)).size).toBe(scene.objects.length);
    expect(scene.cinematics?.[0]).toMatchObject({ autoplay: true, skippable: true });
  });
  it('matches the engine terrain height to the authoritative server across slopes and chunk edges', () => {
    const terrain = content.scenes[0].objects.find(o => o.terrain)?.terrain;
    expect(terrain).toBeDefined();
    for (let x = -94; x <= 94; x += 7.37) for (let z = -94; z <= 94; z += 5.23) {
      expect(sampleTerrainLocalHeight(terrain!, x, z)).toBeCloseTo(groundHeight(VALLEY_ID, x, z), 9);
    }
  });
  it('authors visible props at the server collision locations and keeps terrain large enough', () => {
    const objects = content.scenes[0].objects;
    expect(objects.find(o => o.terrain)?.terrain?.size).toBe(192);
    for (const solid of VALLEY_SOLIDS) {
      const object = objects.find(o => o.name === `Realm solid · ${solid.id}`)!;
      expect(object).toBeDefined();
      expect(object.transform.position[0]).toBe(solid.x);
      expect(object.transform.position[2]).toBe(solid.z);
      if (solid.kind !== 'tree') expect(object.transform.scale).toEqual([solid.width, solid.height, solid.depth]);
    }
  });
  it('ships embedded tree recipes and no connection credentials', () => {
    const ids = new Set(content.treeSpecs.map(spec => spec.id));
    expect(content.scenes[0].objects.filter(o => o.tree).every(o => ids.has(o.tree!.spec.id))).toBe(true);
    expect(content.variables.find(v => v.name === 'TitanGameKey')?.defaultValue).toBe('');
  });
});
