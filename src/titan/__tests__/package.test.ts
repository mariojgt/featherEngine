import { readFile } from 'node:fs/promises';
import { describe, it, expect } from 'vitest';
import { readPackageFile } from '../../project/packageArchive';
import { remapPackageForImport } from '../../project/package';
import { blankProject } from '../../project/serialize';
import { detectRuntimeFeatures } from '../../project/runtimeCompatibility';
import { collectReferencedAssetIds } from '../../project/verifyBundle';
import { isTitanScene, readTitanSettings, titanZoneScenes } from '../settings';
import { emberMeadowContent } from '../starter';

describe('Ember Meadow starter', () => {
  it('survives the actual archive and import ID remapping with embedded assets and runtime settings', async () => {
    const bytes = await readFile('public/store/packages/projects/ember-meadow.nfpack');
    const archive = await readPackageFile(new Uint8Array(bytes));
    const remapped = remapPackageForImport(archive.pkg);
    expect(remapped.content.scenes).toHaveLength(1);
    expect(isTitanScene(remapped.content.scenes![0].objects)).toBe(true);
    expect(readTitanSettings(remapped.content.variables)).toMatchObject({ realmUrl: 'http://127.0.0.1:8787', gameKey: '' });
    expect(archive.bytes.size).toBe(2);
    expect(remapped.assets.map(a => a.name)).toEqual(expect.arrayContaining(['UAL1.glb', 'Sword.glb']));
    const project = { ...blankProject('Ember Meadow'), ...remapped.content, assets: remapped.assets, scenes: remapped.content.scenes! };
    expect(detectRuntimeFeatures(project)).toContain('titan-realm');
    expect(collectReferencedAssetIds(project).referenced.size).toBe(2);
  });
  it('authors a deterministic scene using existing editable pixel tree recipes', () => {
    expect(emberMeadowContent()).toEqual(emberMeadowContent());
    const content = emberMeadowContent();
    expect(content.scenes[0].objects.filter(o => o.tree?.enabled).length).toBeGreaterThan(20);
    expect(new Set(content.scenes[0].objects.map(o => o.id)).size).toBe(content.scenes[0].objects.length);
  });
});

describe('Sunlit Reach starter', () => {
  it('survives the archive with three zone scenes, their cinematics and the shared assets', async () => {
    const bytes = await readFile('public/store/packages/projects/sunlit-reach.nfpack');
    const archive = await readPackageFile(new Uint8Array(bytes));
    const remapped = remapPackageForImport(archive.pkg);
    const scenes = remapped.content.scenes!;
    expect(scenes).toHaveLength(3);
    expect(scenes.every(scene => isTitanScene(scene.objects))).toBe(true);
    // The `Realm zone · <id>` markers are plain object names, so import remapping cannot lose them.
    expect(Object.keys(titanZoneScenes(scenes)).sort()).toEqual(['cinder-keep', 'ember-meadow', 'thornwood']);
    expect(Object.values(titanZoneScenes(scenes))).toEqual(expect.arrayContaining(scenes.map(scene => scene.id)));
    for (const scene of scenes) {
      expect(scene.cinematics).toHaveLength(1);
      const [cinematic] = scene.cinematics!;
      expect(cinematic.autoplay).toBe(true);
      // Ids are remapped on import, so the authored ones must NOT survive verbatim.
      expect(cinematic.id.startsWith('sunlit-cine-')).toBe(false);
      expect(cinematic.actions.some(action => action.type === 'camera' && (action.keyframes?.length ?? 0) >= 3)).toBe(true);
    }
    expect(readTitanSettings(remapped.content.variables)).toMatchObject({ realmUrl: 'http://127.0.0.1:8787', baseUrl: '', gameKey: '', publishMode: 'practice', gameOrigin: '' });
    expect(archive.bytes.size).toBe(2);
    expect(remapped.assets.map(a => a.name)).toEqual(expect.arrayContaining(['UAL1.glb', 'Sword.glb']));
    const project = { ...blankProject('Sunlit Reach'), ...remapped.content, assets: remapped.assets, scenes };
    expect(detectRuntimeFeatures(project)).toEqual(expect.arrayContaining(['titan-realm', 'multi-scene']));
    expect(collectReferencedAssetIds(project).referenced.size).toBe(2);
  });
});
