import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as compiler from '../../scripting/featherCompiler';
import { initHistory, clearHistory, undo } from '../../store/history';
import { blankProject, migrateLoaded } from '../../project/serialize';
import { graphToFeatherScript } from '../../scripting/featherScript';
import { selectActiveObjects, useEditorStore } from '../../store/editorStore';
import { appendSimpleInteractionToFeatherSource, compileSimpleInteractionBlock, type SimpleInteraction } from '../simpleInteractions';

const interaction = (patch: Partial<SimpleInteraction> = {}): SimpleInteraction => ({
  id: 'interaction-test',
  trigger: { type: 'interact' },
  action: { type: 'rotate', vector: [0, 90, 0] },
  duration: 0.8,
  ...patch,
});
const activeObject = (id: string) =>
  selectActiveObjects(useEditorStore.getState()).find((object) => object.id === id)!;

describe('simple Creator interactions', () => {
  beforeEach(() => useEditorStore.getState().loadProject(blankProject('Interactions Test')));

  it('compiles readable FeatherScript for the initial trigger/action surface', () => {
    expect(compileSimpleInteractionBlock(interaction())).toContain('on interact(player):\n    tween(self, property: "rotation"');
    expect(compileSimpleInteractionBlock(interaction({ trigger: { type: 'timer', seconds: 2 }, action: { type: 'event', eventName: 'Pulse' } })))
      .toBe('on timer(2):\n    fire_event("Pulse")');
    expect(compileSimpleInteractionBlock(interaction({ trigger: { type: 'trigger-enter' }, action: { type: 'score', value: 10 }, then: [{ type: 'destroy' }] })))
      .toContain('Game.Score = (Game.Score + 10)\n    destroy(self)');
  });

  it('inserts handlers before detached timelines and preserves the existing behavior source', () => {
    const source = ['blueprint Door', '', 'on interact(player):', '    print("open")', '', 'detached:', '    timeline(self, property: "rotation", to: vec3(0, 90, 0), duration: 1)'].join('\n');
    const next = appendSimpleInteractionToFeatherSource(source, interaction({ trigger: { type: 'start' }, action: { type: 'event', eventName: 'Ready' } }), 'Exit Door Creator Logic');
    expect(next).toContain('blueprint Exit_Door_Creator_Logic');
    expect(next.indexOf('on start:')).toBeLessThan(next.indexOf('detached:'));
    expect(next).toContain('print("open")');
  });

  it('forks a shared role blueprint, compiles the rule, configures interaction data, and serializes normally', () => {
    const first = useEditorStore.getState().createRoleObject('door');
    const second = useEditorStore.getState().createRoleObject('door');
    expect(first.blueprintId).toBe(second.blueprintId);

    const added = useEditorStore.getState().addSimpleInteraction(first.objectId!, {
      trigger: { type: 'timer', seconds: 2 },
      action: { type: 'score', value: 5 },
      then: [{ type: 'event', eventName: 'DoorBonus' }],
    });
    expect(added).toMatchObject({ ok: true, objectId: first.objectId });
    expect(added.blueprintId).not.toBe(first.blueprintId);
    expect(activeObject(second.objectId!).script?.blueprintId).toBe(second.blueprintId);
    expect(activeObject(first.objectId!).creatorInteractions).toHaveLength(1);
    expect(useEditorStore.getState().variables.some((variable) => variable.name === 'Score')).toBe(true);

    const blueprint = useEditorStore.getState().blueprints.find((item) => item.id === added.blueprintId)!;
    const graph = useEditorStore.getState().graphs.find((item) => item.id === blueprint.graphId)!;
    const source = graphToFeatherScript({
      blueprint,
      graph,
      variables: useEditorStore.getState().variables,
      blueprints: useEditorStore.getState().blueprints,
    });
    expect(source).toContain('on interact(player):');
    expect(source).toContain('on timer(2):');
    expect(source).toContain('Game.Score = (Game.Score + 5)');
    expect(source).toContain('fire_event("DoorBonus")');

    const migrated = migrateLoaded(JSON.parse(JSON.stringify(useEditorStore.getState().exportProject())));
    const saved = migrated.scenes.flatMap((scene) => scene.objects).find((object) => object.id === first.objectId)!;
    expect(saved.creatorInteractions).toHaveLength(1);
    expect(migrated.blueprints.some((item) => item.id === saved.script?.blueprintId)).toBe(true);
  });

  it('configures trigger colliders and retains an auto-input Player when adding a rule', () => {
    const cubeId = useEditorStore.getState().createObjectWithProps('cube', { name: 'Zone' });
    expect(useEditorStore.getState().addSimpleInteraction(cubeId, {
      trigger: { type: 'trigger-enter' },
      action: { type: 'damage', value: 20 },
    }).ok).toBe(true);
    expect(activeObject(cubeId).physics).toMatchObject({ enabled: true, bodyType: 'fixed', isTrigger: true });

    const player = useEditorStore.getState().createRoleObject('player');
    expect(useEditorStore.getState().addSimpleInteraction(player.objectId!, {
      trigger: { type: 'start' },
      action: { type: 'event', eventName: 'Ready' },
    })).toMatchObject({ ok: true });
    expect(activeObject(player.objectId!).script?.enabled).toBe(true);
    expect(activeObject(player.objectId!).character?.autoInputWithScript).toBe(true);
  });
});


describe('editable rule ownership and atomic changes', () => {
  beforeEach(() => { useEditorStore.getState().loadProject(blankProject('Rule transactions')); initHistory(); clearHistory(); });
  const add = () => {
    const id = useEditorStore.getState().createObjectWithProps('cube', { name: 'Bonus' });
    const result = useEditorStore.getState().addSimpleInteraction(id, { trigger: { type: 'timer', seconds: 1 }, action: { type: 'score', value: 5 } });
    expect(result.ok).toBe(true);
    return { id, ruleId: result.interaction!.id };
  };
  const source = (id: string) => {
    const state = useEditorStore.getState();
    const blueprint = state.blueprints.find((b) => b.id === activeObject(id).script?.blueprintId)!;
    const graph = state.graphs.find((g) => g.id === blueprint.graphId)!;
    return graphToFeatherScript({ blueprint, graph, variables: state.variables, blueprints: state.blueprints });
  };
  it('leaves all project data unchanged when compilation fails', () => {
    const id = useEditorStore.getState().createObjectWithProps('cube');
    const before = useEditorStore.getState();
    const fail = vi.spyOn(compiler, 'compileFeatherScriptToGraph').mockReturnValueOnce({ ok: false, diagnostics: [{ severity: 'error', message: 'Invalid rule', line: 1, column: 1, length: 1 }] });
    try {
      expect(before.addSimpleInteraction(id, { trigger: { type: 'trigger-enter' }, action: { type: 'score', value: 2 } })).toMatchObject({ ok: false, error: 'compile-failed' });
      const after = useEditorStore.getState();
      for (const key of ['scenes', 'graphs', 'blueprints', 'variables', 'isDirty', 'undoDepth'] as const) expect(after[key]).toBe(before[key]);
    } finally { fail.mockRestore(); }
  });
  it('undo restores the graph, object, and newly created score variable together', () => {
    const id = useEditorStore.getState().createObjectWithProps('cube');
    clearHistory();
    const before = useEditorStore.getState();
    expect(before.addSimpleInteraction(id, { trigger: { type: 'timer', seconds: 1 }, action: { type: 'score', value: 2 } }).ok).toBe(true);
    undo();
    const after = useEditorStore.getState();
    expect(after.scenes).toBe(before.scenes);
    expect(after.graphs).toBe(before.graphs);
    expect(after.variables).toBe(before.variables);
  });
  it('edits, disables, enables and deletes only the managed rule', () => {
    const { id, ruleId } = add();
    const rule = activeObject(id).creatorInteractions![0];
    expect(useEditorStore.getState().updateSimpleInteraction(id, ruleId, { ...rule, action: { type: 'score', value: 17 } }).ok).toBe(true);
    expect(source(id)).toContain('Game.Score + 17');
    expect(source(id)).not.toContain('Game.Score + 5');
    expect(useEditorStore.getState().updateSimpleInteraction(id, ruleId, { ...rule, enabled: false }).ok).toBe(true);
    expect(source(id)).not.toContain('on timer');
    expect(useEditorStore.getState().updateSimpleInteraction(id, ruleId, { ...rule, enabled: true }).ok).toBe(true);
    expect(source(id)).toContain('Game.Score + 5');
    expect(useEditorStore.getState().updateSimpleInteraction(id, ruleId, null).ok).toBe(true);
    expect(activeObject(id).creatorInteractions).toEqual([]);
    expect(source(id)).not.toContain('on timer');
  });
  it('refuses to overwrite custom graph edits, but can append another managed rule', () => {
    const { id, ruleId } = add();
    const blueprintId = activeObject(id).script!.blueprintId;
    useEditorStore.getState().applyBlueprintFeatherSource(blueprintId, source(id).replace('Game.Score + 5', 'Game.Score + 90'));
    expect(useEditorStore.getState().updateSimpleInteraction(id, ruleId, null)).toMatchObject({ ok: false, error: 'custom-logic' });
    expect(source(id)).toContain('Game.Score + 90');
    expect(useEditorStore.getState().addSimpleInteraction(id, { trigger: { type: 'start' }, action: { type: 'event', eventName: 'Ready' } }).ok).toBe(true);
    expect(source(id)).toContain('Game.Score + 90');
    expect(activeObject(id).creatorInteractions![0].managed).toBe(false);
    expect(source(id)).toContain('fire_event("Ready")');
  });
  it('keeps rule ownership editable after save/reopen', () => {
    const { id, ruleId } = add();
    const saved = JSON.parse(JSON.stringify(useEditorStore.getState().exportProject()));
    useEditorStore.getState().loadProject(migrateLoaded(saved));
    expect(useEditorStore.getState().updateSimpleInteraction(id, ruleId, null).ok).toBe(true);
  });
  it('rejects missing assets and nonfinite values without mutating the scene', () => {
    const id = useEditorStore.getState().createObjectWithProps('cube');
    const before = useEditorStore.getState();
    expect(before.addSimpleInteraction(id, { trigger: { type: 'start' }, action: { type: 'play-sound', assetId: 'missing' } }).error).toBe('invalid-rule');
    expect(before.addSimpleInteraction(id, { trigger: { type: 'timer', seconds: NaN }, action: { type: 'score', value: 1 } }).error).toBe('invalid-rule');
    expect(useEditorStore.getState().scenes).toBe(before.scenes);
  });
});
