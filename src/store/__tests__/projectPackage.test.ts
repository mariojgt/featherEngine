import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useEditorStore } from '../editorStore';
import { useProjectStore } from '../projectStore';
import { buildPackage, parsePackage, remapPackageForImport } from '../../project/package';
import { blankProject } from '../../project/serialize';
import { writePackageArchive } from '../../project/packageArchive';
import { PREFAB_EDIT_SCENE_ID, type NodeForgeNode } from '../../types';

/**
 * Coverage for `kind: 'project'` packages — whole worlds rather than single components. This is what
 * lets a template ship through the store, so the properties that matter are: every scene travels,
 * scene-level references survive re-id'ing, and installing REPLACES the world instead of appending
 * to it.
 */

/** A minimal Load Scene node, so we can prove `targetSceneId` is rewired to the imported scene. */
const loadSceneNode = (targetSceneId: string): NodeForgeNode => ({
  id: 'node-load-scene',
  type: 'nodeforge',
  position: { x: 0, y: 0 },
  data: {
    label: 'Load Scene',
    nodeKind: 'action.loadScene',
    category: 'Logic',
    description: '',
    tone: 'logic',
    targetSceneId,
  },
});

/** Author a two-scene project: a scripted object in scene one that loads scene two. */
function authorProject() {
  const editor = () => useEditorStore.getState();
  const firstSceneId = editor().activeSceneId;
  editor().renameScene(firstSceneId, 'Overworld');

  const objectId = editor().createObjectWithProps('cube', { name: 'Portal' });
  const { blueprintId } = editor().createBlueprintNamed('Portal Logic', 'project package test');
  editor().attachScript(objectId, blueprintId);

  const secondSceneId = editor().createScene('Dungeon');

  // Point the blueprint's graph at the second scene — the reference that must survive the round trip.
  const blueprint = editor().blueprints.find((entry) => entry.id === blueprintId)!;
  useEditorStore.setState((state) => ({
    graphs: state.graphs.map((graph) =>
      graph.id === blueprint.graphId ? { ...graph, nodes: [...graph.nodes, loadSceneNode(secondSceneId)] } : graph,
    ),
  }));

  return { firstSceneId, secondSceneId, objectId, blueprintId };
}

describe('kind: project packages', () => {
  beforeEach(() => {
    // Reset to a single blank starter scene — these tests assert exact scene counts, so leftover
    // scenes from a previous test would be collected into the package and skew them.
    useEditorStore.getState().loadProject(blankProject('Package Test'));
    useProjectStore.getState().useDemo();
    useProjectStore.setState({ toast: null, error: null });
  });

  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('leaves the existing world intact when native project creation is cancelled', async () => {
    authorProject();
    const originalScenes = useEditorStore.getState().scenes;
    const pkg = buildPackage('project', useEditorStore.getState().buildProjectPackage().content, [], {
      id: 'pkg-cancel', name: 'Cancelled starter', version: '1.0.0',
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => writePackageArchive(pkg, new Map()).buffer }));
    const createProject = vi.spyOn(useProjectStore.getState(), 'newProject').mockResolvedValue(undefined);
    expect(await useProjectStore.getState().newProjectFromPackageUrl('store/cancel.nfpack', 'Cancelled')).toBe(false);
    expect(createProject).toHaveBeenCalled();
    expect(useEditorStore.getState().scenes).toBe(originalScenes);
    expect(useProjectStore.getState().toast).toBeNull();
  });

  it('collects every scene plus its dependency closure', () => {
    const { secondSceneId } = authorProject();
    const collected = useEditorStore.getState().buildProjectPackage();

    expect(collected.content.scenes?.map((scene) => scene.name)).toEqual(
      expect.arrayContaining(['Overworld', 'Dungeon']),
    );
    // The scripted object dragged its blueprint and graph into the package.
    expect(collected.content.blueprints.length).toBeGreaterThan(0);
    expect(collected.content.graphs.length).toBeGreaterThan(0);
    expect(collected.content.scenes?.some((scene) => scene.id === secondSceneId)).toBe(true);
  });

  it('never ships the transient prefab-editing scene', () => {
    authorProject();
    useEditorStore.setState((state) => ({
      scenes: [...state.scenes, { id: PREFAB_EDIT_SCENE_ID, name: 'Prefab Edit', objects: [] }],
    }));

    const collected = useEditorStore.getState().buildProjectPackage();
    expect(collected.content.scenes?.some((scene) => scene.id === PREFAB_EDIT_SCENE_ID)).toBe(false);
  });

  it('round-trips a world: scenes replace the blank project and cross-scene refs are rewired', async () => {
    const authored = authorProject();
    const collected = useEditorStore.getState().buildProjectPackage();
    const pkg = buildPackage('project', collected.content, [], {
      id: 'pkg-world',
      name: 'Two-Scene World',
      version: '1.0.0',
    });

    // Install into a fresh project, exactly as newProjectFromPackageUrl does.
    await useProjectStore.getState().newProject('Installed World');
    const blankSceneId = useEditorStore.getState().activeSceneId;

    const parsed = parsePackage(JSON.parse(JSON.stringify(pkg)));
    const { content } = remapPackageForImport(parsed, [], []);
    useEditorStore.getState().mergeProjectPackage(content, []);

    const editor = useEditorStore.getState();
    // The template's world REPLACED the blank starter scene rather than sitting beside it.
    expect(editor.scenes).toHaveLength(2);
    expect(editor.scenes.some((scene) => scene.id === blankSceneId)).toBe(false);
    expect(editor.scenes.map((scene) => scene.name)).toEqual(expect.arrayContaining(['Overworld', 'Dungeon']));
    expect(editor.activeSceneId).toBe(editor.scenes[0].id);

    // Everything got fresh ids — nothing points back at the authoring project.
    expect(editor.scenes.some((scene) => scene.id === authored.firstSceneId)).toBe(false);
    expect(editor.scenes.some((scene) => scene.id === authored.secondSceneId)).toBe(false);

    // The scripted object survived and still resolves to a blueprint that exists here.
    const portal = editor.scenes.flatMap((scene) => scene.objects).find((object) => object.name === 'Portal')!;
    expect(portal).toBeDefined();
    expect(portal.id).not.toBe(authored.objectId);
    const blueprintId = portal.script?.blueprintId;
    expect(blueprintId).toBeDefined();
    expect(editor.blueprints.some((entry) => entry.id === blueprintId)).toBe(true);

    // The Load Scene node points at the IMPORTED Dungeon — previously this was blanked out, which
    // silently broke every scene transition in a shared template.
    const blueprint = editor.blueprints.find((entry) => entry.id === blueprintId)!;
    const graph = editor.graphs.find((entry) => entry.id === blueprint.graphId)!;
    const node = graph.nodes.find((entry) => entry.data.nodeKind === 'action.loadScene')!;
    expect(node).toBeDefined();
    const dungeon = editor.scenes.find((scene) => scene.name === 'Dungeon')!;
    expect(node.data.targetSceneId).toBe(dungeon.id);
  });

  it('refuses to build a project from a module package', async () => {
    const modulePkg = buildPackage(
      'asset',
      { ...useEditorStore.getState().buildProjectPackage().content, scenes: undefined },
      [],
      { id: 'pkg-mod', name: 'Just A Module', version: '1.0.0' },
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: async () => writePackageArchive(modulePkg, new Map()).buffer,
      }),
    );

    const created = await useProjectStore.getState().newProjectFromPackageUrl('store/mod.nfpack', 'Nope');

    expect(created).toBe(false);
    expect(useProjectStore.getState().toast?.kind).toBe('error');
    expect(useProjectStore.getState().toast?.message).toContain('module, not a project template');
  });
});
