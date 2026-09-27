import { describe, it, expect } from 'vitest';
import { blankProject } from '../../project/serialize';
import { detectRuntimeFeatures } from '../../project/runtimeCompatibility';
import { isTitanScene, readTitanSettings, titanZoneScenes } from '../settings';
import { emberMeadowContent } from '../starter';
import { sunlitReachContent } from '../sunlitReach';

describe('legacy Titan starter content compatibility', () => {
  it('keeps Ember Meadow runtime settings loadable for existing projects', () => {
    const content = emberMeadowContent();
    expect(content.scenes).toHaveLength(1);
    expect(isTitanScene(content.scenes[0].objects)).toBe(true);
    expect(readTitanSettings(content.variables)).toMatchObject({ realmUrl: 'http://127.0.0.1:8787', gameKey: '' });
    const project = { ...blankProject('Ember Meadow'), ...content, scenes: content.scenes };
    expect(detectRuntimeFeatures(project)).toContain('titan-realm');
  });

  it('authors a deterministic scene using existing editable pixel tree recipes', () => {
    expect(emberMeadowContent()).toEqual(emberMeadowContent());
    const content = emberMeadowContent();
    expect(content.scenes[0].objects.filter(o => o.tree?.enabled).length).toBeGreaterThan(20);
    expect(new Set(content.scenes[0].objects.map(o => o.id)).size).toBe(content.scenes[0].objects.length);
  });
  it('keeps Sunlit Reach scenes and cinematics loadable for existing projects', () => {
    const content = sunlitReachContent();
    const scenes = content.scenes;
    expect(scenes).toHaveLength(1);
    expect(scenes.every(scene => isTitanScene(scene.objects))).toBe(true);
    expect(Object.keys(titanZoneScenes(scenes)).sort()).toEqual(['sunlit-valley']);
    expect(Object.values(titanZoneScenes(scenes))).toEqual(expect.arrayContaining(scenes.map(scene => scene.id)));
    for (const scene of scenes) {
      expect(scene.cinematics).toHaveLength(1);
      const [cinematic] = scene.cinematics!;
      expect(cinematic.autoplay).toBe(true);
      expect(cinematic.actions.some(action => action.type === 'camera' && (action.keyframes?.length ?? 0) >= 3)).toBe(true);
    }
    expect(readTitanSettings(content.variables)).toMatchObject({ realmUrl: 'http://127.0.0.1:8787', baseUrl: '', gameKey: '', publishMode: 'practice', gameOrigin: '' });
    const project = { ...blankProject('Sunlit Reach'), ...content, scenes };
    expect(detectRuntimeFeatures(project)).toEqual(expect.arrayContaining(['titan-realm']));
  });
});
