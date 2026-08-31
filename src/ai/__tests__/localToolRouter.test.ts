import { asSchema } from 'ai';
import { beforeEach, describe, expect, it } from 'vitest';
import { blankProject } from '../../project/serialize';
import { selectActiveObjects, useEditorStore } from '../../store/editorStore';
import { engineTools } from '../tools';
import {
  chooseLocalEngineTools,
  isLocalActionRequest,
  LOCAL_ENGINE_GATEWAY_TOOLS,
  LOCAL_TOOL_GROUPS,
  rankLocalEngineTools,
} from '../local/localToolRouter';

describe('Local Feather tool routing', () => {
  beforeEach(() => useEditorStore.getState().loadProject(blankProject('Local gateway test')));

  it('assigns every engine tool to exactly one reachable capability group', () => {
    const grouped = Object.values(LOCAL_TOOL_GROUPS).flat();
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...new Set(grouped)].sort()).toEqual(Object.keys(engineTools).sort());
  });

  it('routes UI/gameplay intent through a constant two-schema local gateway', () => {
    const selection = chooseLocalEngineTools(
      'Create a playable pickup with create_collectible_counter and create_ui_document',
    );
    expect(selection.groups).toEqual(expect.arrayContaining(['core', 'gameplay', 'ui']));
    expect(selection.suggestedTools).toEqual(
      expect.arrayContaining(['create_collectible_counter', 'create_ui_document']),
    );
    expect(selection.tools).toBe(LOCAL_ENGINE_GATEWAY_TOOLS);
    expect(Object.keys(selection.tools)).toEqual(['search_engine_tools', 'run_engine_tool']);
  });

  it('suggests inspection actions while keeping their large schemas behind discovery', () => {
    const selection = chooseLocalEngineTools('What objects are in my scene?');
    expect(selection.groups).toEqual(['core', 'scene']);
    expect(selection.suggestedTools).toEqual(expect.arrayContaining(['list_scene', 'inspect_object']));
    expect(selection.tools.search_engine_tools).toBeDefined();
    expect(selection.tools.run_engine_tool).toBeDefined();
  });

  it('ranks the reported local edit requests ahead of unrelated lexical matches', () => {
    expect(rankLocalEngineTools('add a cube to the screen')[0]).toBe('create_object');
    expect(rankLocalEngineTools('Create a cube at 0, 2, 0')[0]).toBe('create_object');
    expect(rankLocalEngineTools('build me a castle wall')[0]).toBe('create_block_wall');
    expect(rankLocalEngineTools('make this cube spin')[0]).toBe('attach_behavior');
    expect(rankLocalEngineTools('set a script on this cube')[0]).toBe('set_object_script');
    expect(rankLocalEngineTools('What objects are in my scene?')[0]).toBe('list_scene');
  });

  it('only treats clear editor imperatives as action requests', () => {
    expect(isLocalActionRequest('add a cube to the scene')).toBe(true);
    expect(isLocalActionRequest('build me a castle wall')).toBe(true);
    expect(isLocalActionRequest('set a script on the selected cube')).toBe(true);
    expect(isLocalActionRequest('how do I create a cube?')).toBe(false);
    expect(isLocalActionRequest('what objects are in my scene?')).toBe(false);
  });

  it('keeps every engine action directly discoverable by exact name', () => {
    for (const name of Object.keys(engineTools)) {
      expect(chooseLocalEngineTools(`Use ${name} for this edit`).suggestedTools[0]).toBe(name);
    }
  });

  it('keeps the complete serialized local gateway below its regression budget', async () => {
    const serialized = await Promise.all(
      Object.entries(LOCAL_ENGINE_GATEWAY_TOOLS).map(async ([name, definition]) => ({
        name,
        description: definition.description,
        inputSchema: await asSchema(definition.inputSchema as never).jsonSchema,
      })),
    );
    expect(JSON.stringify(serialized).length).toBeLessThan(1500);
  });

  it('validates and dispatches gateway calls through the original engine tool', async () => {
    const runner = LOCAL_ENGINE_GATEWAY_TOOLS.run_engine_tool as unknown as {
      execute(input: unknown, options: unknown): Promise<string>;
    };
    const result = await runner.execute(
      { name: 'list_scene', input: { detail: 'tiny', limit: 1 } },
      { toolCallId: 'test', messages: [], abortSignal: new AbortController().signal },
    );
    expect(JSON.parse(result)).toMatchObject({ ok: true, name: 'list_scene' });
    expect(JSON.parse(result).result).toContain('activeSceneId');

    const invalid = await runner.execute(
      { name: 'list_scene', input: { limit: 0 } },
      { toolCallId: 'test', messages: [], abortSignal: new AbortController().signal },
    );
    expect(JSON.parse(invalid)).toMatchObject({
      ok: false,
      name: 'list_scene',
      error: 'invalid_input',
      retry: 'search_then_run',
    });

    const unknown = await runner.execute(
      { name: 'not_a_real_tool', input: {} },
      { toolCallId: 'test', messages: [], abortSignal: new AbortController().signal },
    );
    expect(JSON.parse(unknown)).toMatchObject({ ok: false, error: 'unknown_action', retry: 'search' });
  });

  it('returns structured, bounded discovery results instead of model-facing chatter', async () => {
    const searcher = LOCAL_ENGINE_GATEWAY_TOOLS.search_engine_tools as unknown as {
      execute(input: unknown, options: unknown): Promise<string>;
    };
    const result = await searcher.execute(
      { query: 'create a polished health HUD and pickup', limit: 2 },
      { toolCallId: 'test', messages: [], abortSignal: new AbortController().signal },
    );
    expect(result.length).toBeLessThanOrEqual(1200);
    expect(JSON.parse(result)).toMatchObject({ ok: true, matches: expect.any(Array) });
  });

  it('preserves the required create-object kind enum in bounded discovery', async () => {
    const searcher = LOCAL_ENGINE_GATEWAY_TOOLS.search_engine_tools as unknown as {
      execute(input: unknown, options: unknown): Promise<string>;
    };
    const result = await searcher.execute(
      { query: 'create_object', limit: 1 },
      { toolCallId: 'test', messages: [], abortSignal: new AbortController().signal },
    );
    const parsed = JSON.parse(result) as {
      matches: Array<{ name: string; input: { properties?: { kind?: { enum?: string[] } } } }>;
    };
    expect(result.length).toBeLessThanOrEqual(1200);
    expect(parsed.matches[0].name).toBe('create_object');
    expect(parsed.matches[0].input.properties?.kind?.enum).toContain('cube');
  });

  it('applies cube, vertical wall, and object-script edits through the two-tool gateway', async () => {
    const runner = LOCAL_ENGINE_GATEWAY_TOOLS.run_engine_tool as unknown as {
      execute(input: unknown, options: unknown): Promise<string>;
    };
    const options = { toolCallId: 'test', messages: [], abortSignal: new AbortController().signal };

    expect(JSON.parse(await runner.execute({
      name: 'create_object',
      input: { kind: 'cube', name: 'Local Cube', position: [0, 2, 0] },
    }, options))).toMatchObject({ ok: true, name: 'create_object' });
    const cube = selectActiveObjects(useEditorStore.getState()).find((object) => object.name === 'Local Cube')!;
    expect(cube).toMatchObject({ kind: 'cube', transform: { position: [0, 2, 0] } });

    expect(JSON.parse(await runner.execute({
      name: 'create_block_wall',
      input: { name: 'Local Castle Wall', length: 6, height: 3, battlements: true, towers: true },
    }, options))).toMatchObject({ ok: true, name: 'create_block_wall' });
    const wallObjects = selectActiveObjects(useEditorStore.getState());
    const wallRoot = wallObjects.find((object) => object.name === 'Local Castle Wall')!;
    const blocks = wallObjects.filter((object) => object.parentId === wallRoot.id);
    expect(blocks.length).toBeGreaterThan(18);
    expect(new Set(blocks.map((object) => object.transform.position[1])).size).toBeGreaterThan(1);
    expect(blocks.every((object) => object.physics?.bodyType === 'fixed')).toBe(true);

    const scriptResult = JSON.parse(await runner.execute({
      name: 'set_object_script',
      input: {
        objectId: cube.id,
        source: 'blueprint Spinner\n\non update(dt):\n    self.rotate(axis: "y", amount: 90)',
      },
    }, options));
    expect(scriptResult).toMatchObject({ ok: true, name: 'set_object_script' });
    const scriptedCube = selectActiveObjects(useEditorStore.getState()).find((object) => object.id === cube.id)!;
    const blueprint = useEditorStore.getState().blueprints.find((item) => item.id === scriptedCube.script?.blueprintId)!;
    const graph = useEditorStore.getState().graphs.find((item) => item.id === blueprint.graphId)!;
    expect(graph.nodes.some((node) => node.data.nodeKind === 'event.update')).toBe(true);
    expect(graph.nodes.some((node) => node.data.nodeKind === 'action.rotate')).toBe(true);
  });

  it('does not report domain rejections as successful gateway edits', async () => {
    const runner = LOCAL_ENGINE_GATEWAY_TOOLS.run_engine_tool as unknown as {
      execute(input: unknown, options: unknown): Promise<string>;
    };
    const result = await runner.execute(
      { name: 'open_object_script', input: { objectId: 'missing-object' } },
      { toolCallId: 'test', messages: [], abortSignal: new AbortController().signal },
    );
    expect(JSON.parse(result)).toMatchObject({
      ok: false,
      name: 'open_object_script',
      error: 'engine_rejected',
    });
  });
});
