import { describe, it, expect } from 'vitest';
import { isTitanScene, titanZoneScenes, zoneOfScene, TITAN_SCENE_MARKER, TITAN_ZONE_MARKER } from '../settings';
import { sunlitReachContent } from '../sunlitReach';
import { ZONES } from '../../../examples/titan-mmo/server/world.mjs';
import type { SceneObject } from '../../types';

const content = sunlitReachContent();
const zoneOf = (objects: readonly SceneObject[]) => ZONES[zoneOfScene(objects) as keyof typeof ZONES];
const anchorsOf = (zone: (typeof ZONES)[keyof typeof ZONES]) => [...zone.npcs, ...zone.gatherables, ...zone.spawns, ...zone.portals, zone.spawn];

/**
 * A prop only gets in a player's way if it stands IN the walkable band: taller than knee height and
 * starting below head height. Ground slabs, paving, mossy patches and the overhead pieces of an arch
 * are deliberately allowed to sit on top of an actor's spot — they are floor and ceiling, not props.
 */
const blocksWalking = (object: SceneObject) => {
  if (!object.renderer) return false;
  const y = object.transform.position[1]; const height = object.transform.scale[1];
  return y + height / 2 > 0.9 && y - height / 2 < 2;
};

describe('Sunlit Reach template content', () => {
  it('is deterministic', () => {
    expect(sunlitReachContent()).toEqual(sunlitReachContent());
  });

  it('is three Titan scenes, one per authoritative zone', () => {
    expect(content.scenes).toHaveLength(3);
    for (const scene of content.scenes) {
      expect(isTitanScene(scene.objects)).toBe(true);
      expect(scene.objects.filter(o => o.name === TITAN_SCENE_MARKER)).toHaveLength(1);
      expect(scene.objects.filter(o => o.name.startsWith(TITAN_ZONE_MARKER))).toHaveLength(1);
      // Reasonable to hand-edit: a zone is set dressing, not a mesh dump.
      expect(scene.objects.length).toBeLessThanOrEqual(450);
    }
    expect(Object.keys(titanZoneScenes(content.scenes)).sort()).toEqual(['cinder-keep', 'ember-meadow', 'thornwood']);
  });

  it('gives every object a unique id across all three scenes', () => {
    const ids = content.scenes.flatMap(scene => scene.objects.map(object => object.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every scene one editable autoplay cinematic', () => {
    for (const scene of content.scenes) {
      expect(scene.cinematics).toHaveLength(1);
      const [cinematic] = scene.cinematics!;
      expect(cinematic.autoplay).toBe(true);
      expect(cinematic.skippable).toBe(true);
      expect(cinematic.duration).toBeGreaterThan(0);
      const ids = cinematic.actions.map(action => action.id);
      expect(new Set(ids).size).toBe(ids.length);
      const keyframes = cinematic.actions.flatMap(action => action.keyframes ?? []);
      expect(keyframes.length).toBeGreaterThanOrEqual(3);
      for (const key of keyframes) {
        expect(key.time).toBeGreaterThanOrEqual(0);
        expect(key.time).toBeLessThanOrEqual(cinematic.duration);
      }
    }
  });

  it('floors every zone over its authoritative bounds', () => {
    for (const scene of content.scenes) {
      const { bounds } = zoneOf(scene.objects);
      const ground = scene.objects.filter(o => o.renderer)
        .sort((a, b) => b.transform.scale[0] * b.transform.scale[2] - a.transform.scale[0] * a.transform.scale[2])[0];
      const [x, , z] = ground.transform.position; const [width, , depth] = ground.transform.scale;
      expect(x - width / 2).toBeLessThanOrEqual(bounds.minX);
      expect(x + width / 2).toBeGreaterThanOrEqual(bounds.maxX);
      expect(z - depth / 2).toBeLessThanOrEqual(bounds.minZ);
      expect(z + depth / 2).toBeGreaterThanOrEqual(bounds.maxZ);
    }
  });

  it('keeps scenery off every NPC, gatherable, enemy spawn and waystone', () => {
    for (const scene of content.scenes) {
      const zone = zoneOf(scene.objects);
      const crowding = scene.objects.filter(blocksWalking).flatMap((object) => {
        const [x, , z] = object.transform.position;
        return anchorsOf(zone).filter(anchor => Math.hypot(anchor.x - x, anchor.z - z) < 2.5)
          .map(anchor => `${object.name} at ${x},${z} crowds ${anchor.x},${anchor.z}`);
      });
      expect(crowding).toEqual([]);
    }
  });

  it('ships one tree spec per woodland and the five Titan settings variables', () => {
    expect(new Set(content.treeSpecs.map(spec => spec.id)).size).toBe(content.treeSpecs.length);
    expect(content.variables.map(variable => variable.id)).toEqual(
      ['sunlit-realmUrl', 'sunlit-baseUrl', 'sunlit-gameKey', 'sunlit-publishMode', 'sunlit-gameOrigin']);
    const used = new Set(content.scenes.flatMap(scene => scene.objects.flatMap(o => o.tree ? [o.tree.spec.id] : [])));
    expect([...used].every(id => content.treeSpecs.some(spec => spec.id === id))).toBe(true);
  });
});
