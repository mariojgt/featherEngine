import { asSchema } from 'ai';
import { describe, expect, it } from 'vitest';
import { engineTools } from '../tools';
import {
  chooseLocalEngineTools,
  LOCAL_ENGINE_GATEWAY_TOOLS,
  LOCAL_TOOL_GROUPS,
} from '../local/localToolRouter';

describe('Local Feather tool routing', () => {
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
});
