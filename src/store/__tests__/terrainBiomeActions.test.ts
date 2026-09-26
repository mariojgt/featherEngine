import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEditorStore, selectActiveObjects } from '../editorStore';
import { clearHistory, initHistory, redo, undo } from '../history';
import { withTerrainDefaults } from '../../terrain/terrain';
import { biomeSurfaceAssets } from '../../terrain/biomeSurfaces';
import { biomeTreeAssets } from '../../terrain/biomeTrees';
import { terrainBiomePatch } from '../../terrain/biomes';
import { blankProject, splitProject, joinProject } from '../../project/serialize';
import { collectProjectPackage, buildPackage, remapPackageForImport } from '../../project/package';

vi.mock('../../terrain/biomeSurfaces', () => ({ biomeSurfaceAssets: vi.fn(async () =>
  ['grass', 'soil', 'rock'].flatMap((kind) => ['', '-normal'].map((suffix) => ({
    id: `feather-natural-${kind}${suffix}-v3`, name: `${kind}${suffix}.webp`, type: 'image', size: 1,
    data: 'data:image/webp;base64,dGVzdA==', createdAt: 0,
  })))) }));

vi.mock('../../terrain/biomeTrees', () => ({ biomeTreeAssets: vi.fn(async (biome: string) => biome === 'alpine' ? [] : ['feather-woodland-trees-v3', ...(biome === 'woodland' ? ['feather-woodland-ground-cover-v4'] : [])].map(id => ({ id, name: id + '.glb', type: 'model', size: 4, data: 'data:model/gltf-binary;base64,Z2xURg==', createdAt: 0 }))) }));

const original = useEditorStore.getState();
afterEach(() => { useEditorStore.setState(original); clearHistory(); });

describe('landscape presets', () => {
  it('preserves source bytes of embedded surfaces through desktop project manifests', () => {
    const project = blankProject('Embedded surfaces');
    const data = 'data:image/png;base64,original-generated-texture';
    project.assets = [
      { id: 'generated', name: 'Ground.png', type: 'image', size: 1, data, createdAt: 0 },
      { id: 'imported', name: 'Rock.png', type: 'image', size: 1, path: 'assets/rock.png', data, url: 'blob:temporary', createdAt: 0 },
    ];
    const split = splitProject(project);
    const loaded = joinProject(JSON.parse(JSON.stringify(split.manifest)), split.sceneFiles.map((file) => file.scene));
    expect(loaded.assets[0].data).toBe(data);
    expect(loaded.assets[1].path).toBe('assets/rock.png');
    expect(loaded.assets[1].data).toBeUndefined();
    expect(loaded.assets[1].url).toBeUndefined();
  });

  it('preserves sculpt, layer identities, paint and exclusion masks while changing surfaces', () => {
    const terrain = withTerrainDefaults({ heightOverrides: { '0:0': 12 }, paintOverrides: { '0:0': 'grass' }, foliageOverrides: { '0:0': 0 } });
    const next = terrainBiomePatch(terrain, 'woodland');
    expect(next.heightOverrides).toEqual(terrain.heightOverrides);
    expect(next.paintOverrides).toEqual(terrain.paintOverrides);
    expect(next.foliageOverrides).toEqual(terrain.foliageOverrides);
    expect(next.materialLayers.map((layer) => layer.id)).toEqual(terrain.materialLayers.map((layer) => layer.id));
    expect(next.foliage.treeSource).toBe('model');
    expect(next.foliage.treeModelAssetId).toBe('feather-woodland-trees-v3');
    expect(next.materialLayers[0].textureAssetId).toBe('feather-natural-grass-v3');
  });

  it('atomically adds species, supports undo/redo, and packages every member of the mix', async () => {
    const project = blankProject('Woodland');
    const terrain = withTerrainDefaults({ heightOverrides: { '0:0': 12 } });
    project.scenes[0].objects = [{ id: 'terrain', name: 'Woodland', kind: 'terrain', terrain,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } }];
    useEditorStore.setState({ ...project, isPlaying: false });
    initHistory(); clearHistory();
    expect(await useEditorStore.getState().applyTerrainBiome('missing', 'alpine')).toBe(false);
    expect(await useEditorStore.getState().applyTerrainBiome('terrain', 'alpine')).toBe(true);
    const after = useEditorStore.getState();
    const species = selectActiveObjects(after)[0].terrain!.foliage.treeSpecies!;
    expect(species.every((entry) => after.treeSpecs.some((spec) => spec.id === entry.specId))).toBe(true);
    undo();
    expect(selectActiveObjects(useEditorStore.getState())[0].terrain).toBe(terrain);
    expect(useEditorStore.getState().treeSpecs).toEqual(project.treeSpecs);
    redo();
    const state = useEditorStore.getState();
    const collected = collectProjectPackage(state);
    expect(collected.content.treeSpecs?.map((spec) => spec.id).sort()).toEqual(species.map((entry) => entry.specId).sort());
    const pkg = buildPackage('project', collected.content, state.assets, { id: 'alpine', name: 'Woodland', version: '1.0.0' });
    const imported = remapPackageForImport(JSON.parse(JSON.stringify(pkg)), [], []);
    const importedMix = imported.content.scenes![0].objects[0].terrain!.foliage.treeSpecies!;
    expect(importedMix).toHaveLength(species.length);
    expect(imported.assets).toHaveLength(6);
    expect(imported.assets.every((asset) => asset.data?.startsWith('data:image/webp;'))).toBe(true);
    expect(importedMix.every((entry) => imported.content.treeSpecs?.some((spec) => spec.id === entry.specId))).toBe(true);
    expect(importedMix.every((entry) => !species.some((before) => before.specId === entry.specId))).toBe(true);
    // Reapplying reuses the assets and keeps user edits to shared tree specs.
    state.updateTreeSpec(species[0].specId, { name: 'My Oak' });
    const count = useEditorStore.getState().treeSpecs.length;
    await state.applyTerrainBiome('terrain', 'alpine');
    expect(useEditorStore.getState().treeSpecs).toHaveLength(count);
    expect(useEditorStore.getState().treeSpecs.find((spec) => spec.id === species[0].specId)?.name).toBe('My Oak');
  });
});

it('does not modify terrain when the bundled surface load fails', async () => {
  const project = blankProject('Failure');
  project.scenes[0].objects = [{ id: 'terrain', name: 'Terrain', kind: 'terrain', terrain: withTerrainDefaults({}),
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } }];
  useEditorStore.setState({ ...project, isPlaying: false });
  const before = useEditorStore.getState();
  vi.mocked(biomeSurfaceAssets).mockRejectedValueOnce(new Error('decode failed'));
  await expect(before.applyTerrainBiome('terrain', 'woodland')).rejects.toThrow('decode failed');
  expect(useEditorStore.getState()).toBe(before);
});

it('cancels a pending preset if its terrain is removed', async () => {
  const project = blankProject('Pending');
  project.scenes[0].objects = [{ id: 'terrain', name: 'Terrain', kind: 'terrain', terrain: withTerrainDefaults({}),
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } }];
  useEditorStore.setState({ ...project, isPlaying: false });
  let finish!: (assets: Awaited<ReturnType<typeof biomeSurfaceAssets>>) => void;
  vi.mocked(biomeSurfaceAssets).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const pending = useEditorStore.getState().applyTerrainBiome('terrain', 'woodland');
  useEditorStore.getState().deleteObject('terrain');
  finish([]);
  expect(await pending).toBe(false);
  expect(useEditorStore.getState().treeSpecs).toEqual(project.treeSpecs);
});

it('completes missing biome layers while preserving existing painted IDs', () => {
  const base = withTerrainDefaults({ materialLayers: [{ id: 'my-path', name: 'Path', color: '#786f64' }], paintOverrides: { '0:0': 'my-path' } });
  const applied = terrainBiomePatch(base, 'woodland');
  expect(applied.materialLayers).toHaveLength(3);
  expect(applied.materialLayers[0].id).toBe('my-path');
  expect(applied.paintOverrides).toEqual(base.paintOverrides);
  expect(applied.materialLayers[2].textureAssetId).toBe('feather-natural-rock-v3');
  expect(new Set(applied.materialLayers.map((layer) => layer.id)).size).toBe(3);
  expect(terrainBiomePatch(applied, 'woodland').materialLayers).toEqual(applied.materialLayers);
});

 it('embeds the authored tree library atomically and remaps its model reference on import', async () => {
   const project = blankProject('Authored trees');
   project.scenes[0].objects = [{ id: 'terrain', name: 'Terrain', kind: 'terrain', terrain: withTerrainDefaults({}), transform: { position: [0,0,0], rotation: [0,0,0], scale: [1,1,1] } }];
   useEditorStore.setState({ ...project, isPlaying: false });
   await useEditorStore.getState().applyTerrainBiome('terrain', 'woodland');
   const state = useEditorStore.getState(), collected = collectProjectPackage(state);
   expect(collected.assetIds).toContain('feather-woodland-trees-v3');
   expect(collected.assetIds).toContain('feather-woodland-ground-cover-v4');
   const pkg = buildPackage('project', collected.content, state.assets, { id: 'authored', name: 'Woodland', version: '1.0.0' });
   const imported = remapPackageForImport(JSON.parse(JSON.stringify(pkg)), [], []);
   const model = imported.assets.find(a => a.type === 'model')!;
   expect(model.data).toContain('data:model/gltf-binary;');
   expect(imported.content.scenes![0].objects[0].terrain!.foliage.treeModelAssetId).toBe(model.id);
   expect(model.id).not.toBe('feather-woodland-trees-v3');
   await state.applyTerrainBiome('terrain', 'woodland');
   expect(useEditorStore.getState().assets).toHaveLength(8);
   const understory = imported.content.scenes![0].objects[0].terrain!.foliage.understoryAssetId;
   expect(imported.assets.some(asset => asset.id === understory && asset.type === 'model')).toBe(true);
   expect(understory).not.toBe('feather-woodland-ground-cover-v4');
   const before = useEditorStore.getState();
   vi.mocked(biomeTreeAssets).mockRejectedValueOnce(new Error('model unavailable'));
   await expect(before.applyTerrainBiome('terrain', 'woodland')).rejects.toThrow('model unavailable');
   expect(useEditorStore.getState()).toBe(before);
 });
