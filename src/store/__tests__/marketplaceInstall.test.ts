import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readPackageFile } from '../../project/packageArchive';
import type { SceneObject, UIElement } from '../../types';
import { useEditorStore } from '../editorStore';
import { useProjectStore } from '../projectStore';
import { useMarketplaceStore } from '../marketplaceStore';

/**
 * End-to-end coverage for the bundled store: load the REAL catalog and install the REAL `.nfpack`
 * files from `public/store/`, through the real install pipeline.
 *
 * This is deliberately not a mock of the seed content — it is the seed content. If
 * `scripts/build-store-catalog.mjs` ever emits something the engine can't import, this fails.
 */

const PUBLIC_STORE = join(process.cwd(), 'public', 'store');

const flattenUI = (root: UIElement): UIElement[] => [root, ...root.children.flatMap(flattenUI)];

/**
 * Serve `public/store/**` off disk, routed by URL path, so no network is involved. Exposes both
 * `json()` and `arrayBuffer()` because the catalog is JSON while packages are binary archives.
 */
function serveBundledStore() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      const path = new URL(String(input), document.baseURI).pathname;
      const relative = path.slice(path.indexOf('/store/') + '/store/'.length);
      try {
        const body = await readFile(join(PUBLIC_STORE, relative));
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => JSON.parse(body.toString('utf8')),
          arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
        };
      } catch {
        return {
          ok: false,
          status: 404,
          statusText: 'Not Found',
          json: async () => ({}),
          arrayBuffer: async () => new ArrayBuffer(0),
        };
      }
    }),
  );
}

const resetMarketplace = () =>
  useMarketplaceStore.setState({
    status: 'idle',
    error: null,
    packages: [],
    query: '',
    tag: null,
    installingId: null,
    installedIds: [],
  });

describe('bundled asset store — catalog to installed content', () => {
  beforeEach(() => {
    useProjectStore.getState().useDemo();
    useProjectStore.setState({ toast: null, error: null });
    resetMarketplace();
    serveBundledStore();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('loads the shipped catalog', async () => {
    await useMarketplaceStore.getState().load();
    const state = useMarketplaceStore.getState();
    expect(state.status).toBe('ready');
    expect(state.packages.length).toBeGreaterThan(0);
    // Every listing must be installable: a resolvable URL and something actually in it.
    for (const listing of state.packages) {
      expect(listing.downloadUrl).toMatch(/^https?:/);
      expect(listing.title.length).toBeGreaterThan(0);
      // A plugin installs editor behaviour, not project content — its listing must instead name
      // the compiled-in module it activates.
      if (listing.kind === 'plugin') {
        expect(listing.pluginId, `${listing.slug} names no plugin module`).toBeTruthy();
        continue;
      }
      // Something must actually arrive on install. A template's content lives in its scenes, a
      // module's in prefabs/materials — so count them all rather than assuming a shape.
      const { scenes, prefabs, materials, blueprints, uiDocuments = 0 } = listing.contents;
      expect(
        scenes + prefabs + materials + blueprints + uiDocuments,
        `${listing.slug} installs nothing`,
      ).toBeGreaterThan(0);
    }
  });

  it('installs every shipped module package into a real project', async () => {
    await useMarketplaceStore.getState().load();
    // Templates are excluded on purpose: a kind:project package REPLACES the world, so mixing it in
    // here would wipe the very prefabs this test is counting.
    const listings = useMarketplaceStore.getState().packages.filter((entry) => entry.kind === 'asset');
    expect(listings.length).toBeGreaterThan(0);

    const prefabsBefore = useEditorStore.getState().prefabs.length;
    const materialsBefore = useEditorStore.getState().materials.length;
    let expectedPrefabs = 0;
    let expectedMaterials = 0;

    for (const listing of listings) {
      await useMarketplaceStore.getState().install(listing);
      expectedPrefabs += listing.contents.prefabs;
      expectedMaterials += listing.contents.materials;
    }

    const editor = useEditorStore.getState();
    // The catalog's advertised counts must match what actually landed, or the store lies to users.
    expect(editor.prefabs).toHaveLength(prefabsBefore + expectedPrefabs);
    expect(editor.materials).toHaveLength(materialsBefore + expectedMaterials);
    expect(useMarketplaceStore.getState().installedIds).toEqual(listings.map((entry) => entry.id));
    expect(useMarketplaceStore.getState().installingId).toBeNull();
  });

  it('creates a new project with its own world from a shipped template', async () => {
    await useMarketplaceStore.getState().load();
    const template = useMarketplaceStore.getState().packages.find((entry) => entry.kind === 'project');
    expect(template).toBeDefined();

    await useMarketplaceStore.getState().install(template!);

    const editor = useEditorStore.getState();
    expect(useProjectStore.getState().projectName).toBe(template!.title);
    // The template's scenes ARE the project now, not extras appended to a blank one.
    expect(editor.scenes).toHaveLength(template!.contents.scenes);
    expect(editor.activeSceneId).toBe(editor.scenes[0].id);
    expect(editor.scenes[0].objects.length).toBeGreaterThan(0);
    // Materials the scene objects reference came along and resolve.
    const materialIds = new Set(editor.materials.map((material) => material.id));
    const referenced = editor.scenes[0].objects
      .map((object) => object.renderer?.materialId)
      .filter((id): id is string => !!id);
    expect(referenced.length).toBeGreaterThan(0);
    for (const id of referenced) expect(materialIds.has(id)).toBe(true);
  });

  it('installs the shipped Timeline Mechanics world with a resolvable Vault Door prefab', async () => {
    await useMarketplaceStore.getState().load();
    const template = useMarketplaceStore
      .getState()
      .packages.find((entry) => entry.slug === 'template-timeline-mechanics');
    expect(template).toBeDefined();
    expect(template!.kind).toBe('project');
    expect(template!.contents).toMatchObject({ scenes: 1, prefabs: 1, blueprints: 6 });

    await useMarketplaceStore.getState().install(template!);

    const editor = useEditorStore.getState();
    expect(editor.activeScene()?.name).toBe('Timeline Mechanics');
    const prefab = editor.prefabs.find((item) => item.name === 'Interactive Vault Door');
    expect(prefab).toBeDefined();
    const root = prefab!.objects.find((object) => object.id === prefab!.rootId)!;
    const placed = editor.activeScene()!.objects.find(
      (object) => object.prefabSourceId === prefab!.id && object.prefabObjectId === prefab!.rootId,
    );
    expect(placed).toBeDefined();
    expect(placed!.script?.blueprintId).toBe(root.script?.blueprintId);

    const blueprint = editor.blueprints.find((item) => item.id === root.script?.blueprintId)!;
    const graph = editor.graphs.find((item) => item.id === blueprint.graphId)!;
    const definition = graph.nodes.find((node) => node.data.timelineId === 'vault-door-swing');
    expect(definition).toBeDefined();
    expect(
      graph.nodes
        .filter((node) => node.data.nodeKind === 'action.timelineControl')
        .every((node) => node.data.timelineRefId === definition!.data.timelineId),
    ).toBe(true);
  });

  it('installs Cloudstep Garden as a complete playable primitive platformer', async () => {
    await useMarketplaceStore.getState().load();
    const template = useMarketplaceStore
      .getState()
      .packages.find((entry) => entry.slug === 'template-platformer');
    expect(template).toBeDefined();
    expect(template).toMatchObject({
      title: 'Cloudstep Garden',
      kind: 'project',
      contents: { scenes: 1, prefabs: 1, materials: 9, blueprints: 15, assets: 0, uiDocuments: 1 },
    });

    await useMarketplaceStore.getState().install(template!);

    const editor = useEditorStore.getState();
    const objects = editor.activeScene()!.objects;
    expect(editor.activeScene()?.name).toBe('Cloudstep Garden');
    expect(objects.filter((object) => object.creatorRoleId === 'player')).toHaveLength(1);
    expect(objects.filter((object) => object.creatorRoleId === 'collectible')).toHaveLength(10);
    expect(objects.filter((object) => object.creatorRoleId === 'moving-platform')).toHaveLength(1);
    expect(objects.filter((object) => object.creatorRoleId === 'enemy')).toHaveLength(2);
    expect(objects.some((object) => !['empty', 'cube', 'sphere', 'capsule', 'camera', 'light'].includes(object.kind))).toBe(false);

    const player = objects.find((object) => object.creatorRoleId === 'player')!;
    const pipPrefab = editor.prefabs.find((prefab) => prefab.name === 'Pip — Playable Character');
    expect(pipPrefab).toBeDefined();
    expect(player).toMatchObject({
      prefabSourceId: pipPrefab!.id,
      prefabObjectId: pipPrefab!.rootId,
    });
    expect(player.character).toMatchObject({
      enabled: true,
      autoInputWithScript: true,
      coyoteTime: 0.16,
      jumpBufferTime: 0.18,
    });
    expect(objects.filter((object) => object.particles)).toHaveLength(22);
    const hud = editor.uiDocuments.find((document) => document.name === 'Cloudstep HUD');
    expect(hud).toBeDefined();
    expect(flattenUI(hud!.root).some((element) => element.bindings.some((binding) => binding.expression === 'LevelComplete'))).toBe(true);
    expect(flattenUI(hud!.root).some((element) => element.bindings.some((binding) => binding.expression === 'FallOut'))).toBe(true);
    expect(editor.variables.map((variable) => variable.name)).toEqual(
      expect.arrayContaining(['Score', 'Checkpoint', 'LevelComplete', 'PipHearts', 'FallOut', 'PipBoost']),
    );
  });

  it('keeps every material reference inside an installed prefab resolvable', async () => {
    await useMarketplaceStore.getState().load();
    const listing = useMarketplaceStore.getState().packages.find((entry) => entry.contents.prefabs > 0);
    expect(listing, 'catalog has no package containing prefabs to check').toBeTruthy();
    await useMarketplaceStore.getState().install(listing!);

    const editor = useEditorStore.getState();
    const materialIds = new Set(editor.materials.map((material) => material.id));
    const installedPrefabs = editor.prefabs.slice(-listing!.contents.prefabs);
    expect(installedPrefabs.length).toBe(listing!.contents.prefabs);

    // A dangling materialId after re-id'ing would render the prefab untextured — check every one.
    const referenced = installedPrefabs
      .flatMap((prefab) => prefab.objects)
      .map((object) => object.renderer?.materialId)
      .filter((id): id is string => !!id);
    expect(referenced.length).toBeGreaterThan(0);
    for (const id of referenced) expect(materialIds.has(id)).toBe(true);
  });

  it('installs a second, independent copy when the same package is installed twice', async () => {
    await useMarketplaceStore.getState().load();
    const [listing] = useMarketplaceStore.getState().packages;

    await useMarketplaceStore.getState().install(listing);
    const afterFirst = useEditorStore.getState().prefabs.map((prefab) => prefab.id);
    await useMarketplaceStore.getState().install(listing);
    const afterSecond = useEditorStore.getState().prefabs.map((prefab) => prefab.id);

    expect(afterSecond).toHaveLength(afterFirst.length + listing.contents.prefabs);
    // No id is reused, so editing one copy can never mutate the other.
    expect(new Set(afterSecond).size).toBe(afterSecond.length);
  });

  it('refuses to install with no project open, and says why', async () => {
    await useMarketplaceStore.getState().load();
    const [listing] = useMarketplaceStore.getState().packages;
    useProjectStore.getState().closeProject();

    await useMarketplaceStore.getState().install(listing);

    expect(useProjectStore.getState().toast?.kind).toBe('error');
    expect(useProjectStore.getState().toast?.message).toContain('project');
    expect(useMarketplaceStore.getState().installedIds).toEqual([]);
  });

  it('surfaces a missing package file without marking it installed', async () => {
    await useMarketplaceStore.getState().load();
    const listing = useMarketplaceStore.getState().packages[0];

    await useMarketplaceStore
      .getState()
      .install({ ...listing, downloadUrl: new URL('store/packages/nope.nfpack', document.baseURI).toString() });

    expect(useProjectStore.getState().toast?.kind).toBe('error');
    expect(useMarketplaceStore.getState().installedIds).toEqual([]);
    expect(useMarketplaceStore.getState().installingId).toBeNull();
  });
});

/** Every shipped `.nfpack`, as `<kindFolder>/<file>` relative to packages/. */
async function shippedPackages(): Promise<string[]> {
  const dir = join(PUBLIC_STORE, 'packages');
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const file of await readdir(join(dir, entry.name))) {
      if (file.endsWith('.nfpack')) found.push(`${entry.name}/${file}`);
    }
  }
  return found;
}

describe('shipped package integrity', () => {
  /**
   * A package's folder must match what it declares itself to be. The layout is how a human (or a
   * bucket listing) tells a complete project from an asset pack from a plugin, so a file in the
   * wrong folder is a lie even though everything still installs.
   */
  it('files live in the folder matching their declared kind', async () => {
    const dir = join(PUBLIC_STORE, 'packages');
    const expected: Record<string, string> = { project: 'projects', asset: 'assets', plugin: 'plugins' };
    const files = await shippedPackages();
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const { pkg } = readPackageFile(new Uint8Array(await readFile(join(dir, file))));
      expect(file.split('/')[0], `${file} declares kind "${pkg.kind}"`).toBe(expected[pkg.kind]);
    }
  });

  /**
   * Every asset a package's content points at must actually be in the package. A dangling id means
   * an untextured model or a silent missing sound in someone's project — and the starter templates
   * are exported from the running editor, so nothing else catches it.
   */
  it('has no dangling asset references and no asset without bytes or a source', async () => {
    const dir = join(PUBLIC_STORE, 'packages');
    const files = await shippedPackages();
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const { pkg } = readPackageFile(new Uint8Array(await readFile(join(dir, file))));
      const available = new Set(pkg.assets.map((asset) => asset.id));
      const referenced = new Set<string>();
      const add = (id?: string) => {
        if (id) referenced.add(id);
      };
      const scanObject = (object: SceneObject) => {
        add(object.renderer?.modelAssetId);
        add(object.renderer?.textureAssetId);
        add(object.particles?.textureAssetId);
        const character = object.character;
        if (character) {
          [
            character.footstepSoundId,
            character.jumpSoundId,
            character.landSoundId,
            character.swimSoundId,
            character.attackSoundId,
            character.hurtSoundId,
          ].forEach(add);
        }
      };

      for (const scene of pkg.content.scenes ?? []) {
        scene.objects.forEach(scanObject);
        add(scene.ambientSoundId);
        add(scene.musicSoundId);
      }
      for (const prefab of pkg.content.prefabs) prefab.objects.forEach(scanObject);
      for (const material of pkg.content.materials) {
        add(material.textureAssetId);
        add(material.normalMapAssetId);
      }
      for (const animation of pkg.content.animations) add(animation.sourceAssetId);
      for (const skeleton of pkg.content.skeletons) add(skeleton.sourceAssetId);

      const missing = [...referenced].filter((id) => !available.has(id));
      expect(missing, `${file} references assets it does not ship`).toEqual([]);

      const bodiless = pkg.assets.filter((asset) => !asset.data && !asset.source);
      expect(bodiless.map((asset) => asset.name), `${file} has assets with no bytes`).toEqual([]);
    }
  });

  /**
   * Catches a package built from a doubled project.
   *
   * The template packages are produced by running a builder in a browser, and a re-entrant run
   * (React StrictMode double-invoking the export effect) once merged two builds into one package:
   * every object appeared twice at an identical transform and every model was imported twice. It
   * installed fine and looked plausible, so nothing flagged it. These two signatures do.
   *
   * Identical name + parent + FULL transform is the fingerprint — templates legitimately reuse a
   * name at one position (e.g. two pedestal rings crossed at 90°, distinguished by scale), so the
   * whole transform has to be part of the key or this false-positives.
   */
  it('contains no duplicated objects or duplicated asset bytes', async () => {
    const dir = join(PUBLIC_STORE, 'packages');
    for (const file of await shippedPackages()) {
      const { pkg } = readPackageFile(new Uint8Array(await readFile(join(dir, file))));

      for (const scene of pkg.content.scenes ?? []) {
        const seen = new Map<string, number>();
        for (const object of scene.objects) {
          const key = `${object.name}|${object.parentId ?? '-'}|${JSON.stringify(object.transform)}`;
          seen.set(key, (seen.get(key) ?? 0) + 1);
        }
        const duplicated = [...seen.entries()].filter(([, count]) => count > 1).map(([key]) => key.split('|')[0]);
        expect(duplicated, `${file} scene "${scene.name}" looks doubled`).toEqual([]);
      }

      const byHash = new Map<string, number>();
      for (const asset of pkg.assets) {
        if (asset.hash) byHash.set(asset.hash, (byHash.get(asset.hash) ?? 0) + 1);
      }
      const repeated = [...byHash.entries()].filter(([, count]) => count > 1).length;
      expect(repeated, `${file} ships the same bytes under multiple asset ids`).toBe(0);
    }
  });
});

describe('catalog filters', () => {
  beforeEach(async () => {
    resetMarketplace();
    serveBundledStore();
    await useMarketplaceStore.getState().load();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('filters the shipped catalog by tag and search', () => {
    const store = useMarketplaceStore.getState();
    const tags = store.availableTags();
    expect(tags).toContain('physics');

    store.setTag('physics');
    const tagged = useMarketplaceStore.getState().visiblePackages();
    expect(tagged.length).toBeGreaterThan(0);
    expect(tagged.every((listing) => listing.tags.includes('physics'))).toBe(true);

    useMarketplaceStore.getState().setTag(null);
    useMarketplaceStore.getState().setQuery('zzz-no-such-package');
    expect(useMarketplaceStore.getState().visiblePackages()).toEqual([]);
  });
});
