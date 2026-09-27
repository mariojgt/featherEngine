import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initRapier } from '../../runtime/physicsWorld';
import { blankProject } from '../../project/serialize';
import { selectActiveObjects, useEditorStore } from '../editorStore';

const state = () => useEditorStore.getState();
const object = (id: string) => selectActiveObjects(state()).find(o => o.id === id)!;
const frames = (count = 1, dt = 1 / 60) => { for (let i = 0; i < count; i++) state().tickRuntime(dt); };
const attach = (id: string, source: string) => {
  const { blueprintId } = state().createBlueprintNamed('Teleport probe');
  const result = state().applyBlueprintFeatherSource(blueprintId, source);
  expect(result.ok).toBe(true);
  state().attachScript(id, blueprintId);
};
async function play() {
  state().setPlaying(true);
  await new Promise(resolve => setTimeout(resolve, 0));
  frames(4);
}
beforeAll(async () => initRapier());
beforeEach(() => state().loadProject(blankProject('Physics teleport regression')));
afterEach(() => state().setPlaying(false));

describe('explicit FeatherScript physics teleports', () => {
  it.each([1 / 60, 1 / 120])('moves a parented dynamic body and stops its spin on reset at dt=%f', async dt => {
    const parent = state().createObjectWithProps('empty', { position: [3, 0, 0] });
    const id = state().createObjectWithProps('cube', { parentId: parent, position: [0, 3, 0], physics: { enabled: true, bodyType: 'dynamic', collider: 'box', gravityScale: 0 } });
    attach(id, `blueprint Reset_Prop
on event Launch(payload):
    set_velocity(self, vec3(2, 0, 0))
    set_angular_velocity(self, vec3(0, 3, 0))
on event Reset(payload):
    set_position(self, vec3(8, 3, 0))
    set_velocity(self, vec3(0, 0, 0))
    set_angular_velocity(self, vec3(0, 0, 0))`);
    await play();
    state().fireCustomEvent('Launch'); frames(12);
    expect(object(id).transform.position[0]).toBeGreaterThan(0.1);
    expect(Math.abs(state().runtimeAngularVelocities[id][1])).toBeGreaterThan(1);
    state().fireCustomEvent('Reset'); frames(1, dt);
    expect(object(id).transform.position[0]).toBeCloseTo(8, 5);
    frames(12, dt);
    expect(object(id).transform.position[0]).toBeCloseTo(8, 5);
    expect(state().runtimeVelocities[id]).toEqual([0, 0, 0]);
    expect(state().runtimeAngularVelocities[id]).toEqual([0, 0, 0]);
  });

  it('returns a character across a solid wall without sweeping the reset through it', async () => {
    const floor = state().createObjectWithProps('cube', { position: [0, -0.5, 0], physics: { enabled: true, bodyType: 'fixed', collider: 'box' } });
    state().updateTransform(floor, 'scale', [30, 1, 20]);
    const wall = state().createObjectWithProps('cube', { position: [4, 2, 0], physics: { enabled: true, bodyType: 'fixed', collider: 'box' } });
    state().updateTransform(wall, 'scale', [1, 4, 20]);
    const player = state().createRoleObject('player', { kind: 'empty', position: [0, 0.2, 0] }).objectId!;
    attach(player, `blueprint Respawn
on event Reset(payload):
    set_position(self, vec3(8, 0.2, 0))
    set_velocity(self, vec3(0, 0, 0))`);
    await play();
    state().fireCustomEvent('Reset'); frames(4);
    expect(object(player).transform.position[0]).toBeCloseTo(8, 4);
    expect(object(player).transform.position[1]).toBeGreaterThanOrEqual(0);
  });
});
