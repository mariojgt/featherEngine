import { describe, it, expect } from 'vitest';
import { collectPackage, collectProjectPackage, remapPackageForImport, buildPackage } from '../package';
import type { PackageSource } from '../package';
import type { AssetItem, Scene, SceneObject } from '../../types';
import { treeSpecFromArchetype } from '../../tree/treeSpec';
import { blankProject } from '../serialize';
import { validateRuntimeReferences } from '../runtimeCompatibility';

/**
 * "Does a downloaded package contain everything it needs?"
 *
 * These lock down the dependency closure: every image, model, sound and material an exported thing
 * references must be IN the package, and must still resolve after import re-ids everything. A miss
 * here is invisible at export time and shows up as an untextured model in someone else's project.
 */

const asset = (id: string, name: string, type: AssetItem['type'] = 'image'): AssetItem => ({
  id,
  name,
  type,
  size: 1,
  hash: `hash-${id}`,
  createdAt: 0,
});

const object = (id: string, patch: Partial<SceneObject> = {}): SceneObject => ({
  id,
  name: id,
  kind: 'cube',
  transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
  ...patch,
});

/** A project source with one of every asset-bearing reference we support. */
function source(): PackageSource & { scenes: Scene[] } {
  const assets = [
    asset('a-basecolor', 'brick.png'),
    asset('a-normal', 'brick-n.png'),
    asset('a-model', 'prop.glb', 'model'),
    asset('a-objtex', 'decal.png'),
    asset('a-particle', 'spark.png'),
    asset('a-grass-img', 'grass-billboard.png'),
    asset('a-tree-img', 'tree-billboard.png'),
    asset('a-grass-model', 'grass.glb', 'model'),
    asset('a-terrain-layer', 'rock.png'),
    asset('a-terrain-layer-n', 'rock-n.png'),
    asset('a-sky', 'sky.hdr'),
    asset('a-envmap', 'env.hdr'),
    asset('a-ambient', 'wind.mp3', 'audio'),
    asset('a-music', 'theme.mp3', 'audio'),
    asset('a-footstep', 'step.mp3', 'audio'),
    asset('a-unused', 'not-referenced.png'),
  ];

  const scene: Scene = {
    id: 'scene-1',
    name: 'World',
    environment: { skyTextureAssetId: 'a-sky', environmentMapAssetId: 'a-envmap' } as Scene['environment'],
    ambientSoundId: 'a-ambient',
    musicSoundId: 'a-music',
    objects: [
      object('o-model', {
        renderer: {
          enabled: true,
          mesh: 'cube',
          color: '#fff',
          metalness: 0,
          roughness: 1,
          modelAssetId: 'a-model',
          textureAssetId: 'a-objtex',
          materialId: 'mat-1',
        },
      }),
      object('o-particles', { particles: { systemId: 'ps-1', textureAssetId: 'a-particle' } as SceneObject['particles'] }),
      object('o-character', { character: { footstepSoundId: 'a-footstep' } as SceneObject['character'] }),
      object('o-terrain', {
        terrain: {
          materialLayers: [{ textureAssetId: 'a-terrain-layer', normalMapAssetId: 'a-terrain-layer-n' }],
          foliage: {
            grassModelAssetId: 'a-grass-model',
            grassImageAssetId: 'a-grass-img',
            treeImageAssetId: 'a-tree-img',
            treeSpecId: 'tree-oak',
          },
        } as SceneObject['terrain'],
      }),
    ],
  };

  return {
    scenes: [scene],
    prefabs: [],
    blueprints: [],
    graphs: [],
    materials: [
      {
        id: 'mat-1',
        name: 'Brick',
        description: '',
        color: '#fff',
        metalness: 0,
        roughness: 1,
        emissiveColor: '#000',
        emissiveIntensity: 0,
        textureAssetId: 'a-basecolor',
        normalMapAssetId: 'a-normal',
        createdAt: 0,
      },
    ],
    particleSystems: [{ id: 'ps-1', name: 'Sparks' } as PackageSource['particleSystems'][number]],
    skeletons: [],
    skeletalMeshes: [],
    animations: [],
    animatorControllers: [],
    dataAssets: [],
    uiDocuments: [],
    variables: [],
    treeSpecs: [treeSpecFromArchetype('broadleaf', 'tree-oak', 'Oak')],
    assets,
  };
}

describe('package dependency closure — everything referenced ships', () => {
  it('validates terrain-only tree library references at runtime', () => {
    const project = blankProject('Terrain Trees');
    project.scenes[0].objects.push(object('terrain-tree', {
      terrain: { enabled: true, foliage: { treeSpecId: 'missing-tree' } } as SceneObject['terrain'],
    }));
    expect(validateRuntimeReferences(project, project.activeSceneId).errors).toContain(
      'Object "terrain-tree" terrain foliage references missing tree spec missing-tree.',
    );
    project.treeSpecs.push(treeSpecFromArchetype('conifer', 'missing-tree'));
    expect(validateRuntimeReferences(project, project.activeSceneId).errors).not.toContain(
      'Object "terrain-tree" terrain foliage references missing tree spec missing-tree.',
    );
  });

  it('collects every image, model and sound a scene reaches, and nothing it does not', () => {
    const collected = collectProjectPackage(source());

    // Every asset reachable from the scene, via any component or scene-level setting.
    expect(new Set(collected.assetIds)).toEqual(
      new Set([
        'a-model',
        'a-objtex',
        'a-basecolor', // through the material
        'a-normal', // through the material
        'a-particle',
        'a-footstep',
        'a-terrain-layer',
        'a-terrain-layer-n',
        'a-grass-model',
        'a-grass-img', // billboard grass texture
        'a-tree-img', // billboard tree texture
        'a-sky', // scene environment
        'a-envmap', // scene environment
        'a-ambient',
        'a-music',
      ]),
    );
    // Unreferenced assets are NOT dragged along — the package stays as small as it can be.
    expect(collected.assetIds).not.toContain('a-unused');
    expect(collected.content.materials.map((m) => m.id)).toEqual(['mat-1']);
    expect(collected.content.treeSpecs?.map((spec) => spec.id)).toEqual(['tree-oak']);
  });

  it('keeps every one of those references resolvable after import re-ids everything', () => {
    const src = source();
    const collected = collectProjectPackage(src);
    const shipped = src.assets.filter((entry: AssetItem) => collected.assetIds.includes(entry.id));
    const pkg = buildPackage('project', collected.content, shipped, {
      id: 'pkg-closure',
      name: 'Closure',
      version: '1.0.0',
    });

    const { content, assets } = remapPackageForImport(JSON.parse(JSON.stringify(pkg)), [], []);
    const available = new Set(assets.map((entry) => entry.id));
    const scene = content.scenes![0];
    // Everything below must resolve INSIDE the import — no reference may still point at a
    // publisher-side id, and no referenced asset may be absent from the package.
    const modelObj = scene.objects[0];
    expect(modelObj.id).not.toBe('o-model');
    expect(available.has(modelObj.renderer!.modelAssetId!)).toBe(true);
    expect(available.has(modelObj.renderer!.textureAssetId!)).toBe(true);
    expect(content.materials.some((m) => m.id === modelObj.renderer!.materialId)).toBe(true);

    const material = content.materials[0];
    expect(available.has(material.textureAssetId!)).toBe(true);
    expect(available.has(material.normalMapAssetId!)).toBe(true);

    expect(available.has(scene.objects[1].particles!.textureAssetId!)).toBe(true);
    expect(available.has(scene.objects[2].character!.footstepSoundId!)).toBe(true);

    const foliage = scene.objects[3].terrain!.foliage!;
    expect(available.has(foliage.grassModelAssetId!)).toBe(true);
    expect(available.has(foliage.grassImageAssetId!)).toBe(true);
    expect(available.has(foliage.treeImageAssetId!)).toBe(true);
    expect(content.treeSpecs?.some((spec) => spec.id === foliage.treeSpecId)).toBe(true);
    expect(foliage.treeSpecId).not.toBe('tree-oak');
    const layer = scene.objects[3].terrain!.materialLayers![0];
    expect(available.has(layer.textureAssetId!)).toBe(true);
    expect(available.has(layer.normalMapAssetId!)).toBe(true);

    expect(available.has(scene.environment!.skyTextureAssetId!)).toBe(true);
    expect(available.has(scene.environment!.environmentMapAssetId!)).toBe(true);
    expect(available.has(scene.ambientSoundId!)).toBe(true);
    expect(available.has(scene.musicSoundId!)).toBe(true);
  });

  it('lands an asset package inside one folder named after it, keeping its internal tree', () => {
    // Installing a pack must not scatter loose prefabs and materials through someone's project
    // root — everything goes under a single folder, exactly like Unreal's content packs.
    const src = source();
    src.folders = [
      { id: 'f-kit', name: 'Brick Kit' },
      { id: 'f-mats', name: 'Materials', parentId: 'f-kit' },
    ];
    src.materials[0].folderId = 'f-mats';

    const collected = collectPackage(src, { materials: ['mat-1'] });
    // The material's folder AND its ancestor travelled.
    expect(collected.content.folders?.map((folder) => folder.name).sort()).toEqual(['Brick Kit', 'Materials']);

    const pkg = buildPackage('asset', collected.content, [], {
      id: 'pkg-folders',
      name: 'Brick Pack',
      version: '1.0.0',
    });
    const { content } = remapPackageForImport(JSON.parse(JSON.stringify(pkg)), [], []);

    const folders = content.folders ?? [];
    // A wrapper folder named after the package, sitting at the root.
    const wrapper = folders.find((folder) => folder.name === 'Brick Pack');
    expect(wrapper).toBeDefined();
    expect(wrapper!.parentId).toBeUndefined();

    // The package's own tree hangs beneath it, structure intact.
    const kit = folders.find((folder) => folder.name === 'Brick Kit')!;
    const mats = folders.find((folder) => folder.name === 'Materials')!;
    expect(kit.parentId).toBe(wrapper!.id);
    expect(mats.parentId).toBe(kit.id);

    // And the content sits in its own folder, not at the root.
    expect(content.materials[0].folderId).toBe(mats.id);
    // Folder ids were regenerated, so they can't collide with the host project's folders.
    expect(folders.some((folder) => folder.id === 'f-kit' || folder.id === 'f-mats')).toBe(false);
  });

  it('puts content with no folder of its own directly in the package folder', () => {
    const collected = collectPackage(source(), { materials: ['mat-1'] });
    const pkg = buildPackage('asset', collected.content, [], { id: 'p', name: 'Loose Pack', version: '1.0.0' });
    const { content } = remapPackageForImport(JSON.parse(JSON.stringify(pkg)), [], []);

    const wrapper = content.folders!.find((folder) => folder.name === 'Loose Pack')!;
    expect(content.folders).toHaveLength(1);
    expect(content.materials[0].folderId).toBe(wrapper.id);
  });

  it('leaves a project package at the root — it IS the project, not a pack inside one', () => {
    const src = source();
    src.folders = [{ id: 'f-world', name: 'World' }];
    src.materials[0].folderId = 'f-world';

    const collected = collectProjectPackage(src);
    const pkg = buildPackage('project', collected.content, [], { id: 'p', name: 'My World', version: '1.0.0' });
    const { content } = remapPackageForImport(JSON.parse(JSON.stringify(pkg)), [], []);

    // No wrapper folder — the template's folders stay where the author put them.
    expect(content.folders?.map((folder) => folder.name)).toEqual(['World']);
    expect(content.folders![0].parentId).toBeUndefined();
    expect(content.materials[0].folderId).toBe(content.folders![0].id);
  });

  it('drags a material and its maps along when only an object is exported', () => {
    // The module case: exporting a single object must still bring its material's textures.
    const src = source();
    const collected = collectPackage(src, { assets: [], materials: ['mat-1'] });
    expect(new Set(collected.assetIds)).toEqual(new Set(['a-basecolor', 'a-normal']));
  });
});
