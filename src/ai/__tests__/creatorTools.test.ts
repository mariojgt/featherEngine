import { beforeEach, describe, expect, it } from 'vitest';
import { blankProject } from '../../project/serialize';
import { selectActiveObjects, useEditorStore } from '../../store/editorStore';
import { engineTools } from '../tools';

const runTool = async (name: keyof typeof engineTools, input: unknown): Promise<string> => {
  const execute = (engineTools[name] as { execute?: (value: unknown, options: unknown) => Promise<unknown> }).execute;
  expect(execute).toBeTypeOf('function');
  return String(await execute!(input, {}));
};

describe('Creator Agent tools', () => {
  beforeEach(() => useEditorStore.getState().loadProject(blankProject('Creator AI Test')));

  it('creates and converts game concepts through the shared Creator actions', async () => {
    const created = await runTool('create_gameplay_object', { role: 'collectible', name: 'AI Coin', position: [1, 2, 3] });
    expect(created).toContain('Created playable Collectible');
    const coin = selectActiveObjects(useEditorStore.getState()).find((object) => object.name === 'AI Coin')!;
    expect(coin).toMatchObject({ creatorRoleId: 'collectible' });
    expect(coin.physics).toMatchObject({ enabled: true, isTrigger: true });

    const cubeId = useEditorStore.getState().createObjectWithProps('cube', { name: 'AI Door' });
    expect(await runTool('make_object_role', { objectId: cubeId, role: 'door' })).toContain('playable Door');
    expect(selectActiveObjects(useEditorStore.getState()).find((object) => object.id === cubeId)?.creatorRoleId).toBe('door');
  });

  it('adds a normal editable interaction blueprint through one tool call', async () => {
    const cubeId = useEditorStore.getState().createObjectWithProps('cube', { name: 'Bonus' });
    const result = await runTool('add_simple_interaction', {
      objectId: cubeId,
      trigger: 'trigger-enter',
      action: 'score',
      value: 25,
      thenDestroy: true,
    });
    expect(result).toContain('Added editable trigger-enter -> score logic');
    const object = selectActiveObjects(useEditorStore.getState()).find((item) => item.id === cubeId)!;
    expect(object.creatorInteractions).toHaveLength(1);
    expect(object.script?.blueprintId).toBeTruthy();
  });

  it('creates a multi-object game kit through the shared kit action', async () => {
    const result = await runTool('create_gameplay_kit', { kit: 'interaction-starter' });
    expect(result).toContain('Added Interaction Starter');
    const objects = selectActiveObjects(useEditorStore.getState());
    expect(objects.some((object) => object.creatorRoleId === 'player')).toBe(true);
    expect(objects.some((object) => object.creatorRoleId === 'door')).toBe(true);
  });
});
