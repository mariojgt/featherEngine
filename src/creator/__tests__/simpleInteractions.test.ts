import { beforeEach, describe, expect, it } from 'vitest';
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

  it('configures trigger colliders and refuses to silently disable an auto-input Player', () => {
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
    })).toMatchObject({ ok: false, error: 'character-auto-runtime' });
    expect(activeObject(player.objectId!).script).toBeUndefined();
  });
});
