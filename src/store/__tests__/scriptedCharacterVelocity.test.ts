import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { blankProject } from '../../project/serialize';
import { getActivePhysics, initRapier } from '../../runtime/physicsWorld';
import { selectActiveObjects, useEditorStore } from '../editorStore';

const state = () => useEditorStore.getState();
const object = (id: string) => selectActiveObjects(state()).find((item) => item.id === id)!;
const frames = (count: number, delta: number) => {
  for (let frame = 0; frame < count; frame += 1) state().tickRuntime(delta);
};

const attach = (id: string, name: string, source: string) => {
  const { blueprintId } = state().createBlueprintNamed(name);
  expect(state().applyBlueprintFeatherSource(blueprintId, source).ok).toBe(true);
  state().attachScript(id, blueprintId);
};

const addFloor = () => {
  const floor = state().createObjectWithProps('cube', {
    position: [0, -0.5, 0],
    physics: { enabled: true, bodyType: 'fixed', collider: 'box' },
  });
  state().updateTransform(floor, 'scale', [100, 1, 100]);
};

const addCharacter = (position: [number, number, number] = [0, 0.1, 0]) => {
  const id = state().createObjectWithProps('capsule', { position });
  state().toggleCharacterController(id);
  state().updateCharacterController(id, { cameraFollow: false, groundLevel: -20, autoInputWithScript: false });
  return id;
};

const play = async (delta: number) => {
  state().setPlaying(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(getActivePhysics()).toBeTruthy();
  frames(8, delta);
};

describe('script-driven character velocity publication', () => {
  beforeAll(async () => initRapier());
  beforeEach(() => state().loadProject(blankProject('Scripted character velocity')));
  afterEach(() => state().setPlaying(false));

  it.each([30, 60, 120])('publishes accepted self.move speed at %i Hz', async (hz) => {
    addFloor();
    const id = addCharacter();
    attach(id, 'Scripted walker', [
      'blueprint Scripted_Walker',
      'on update(dt):',
      '    self.move(vec3(1, 0, 0), speed: 5.8)',
    ].join('\n'));

    await play(1 / hz);
    frames(hz, 1 / hz);

    const velocity = state().runtimeVelocities[id];
    expect(velocity[0]).toBeCloseTo(5.8, 2);
    expect(Math.abs(velocity[2])).toBeLessThan(0.01);

    state().setPlayPaused(true);
    const pausedPosition = [...object(id).transform.position];
    state().tickRuntime(1);
    expect(object(id).transform.position).toEqual(pausedPosition);
    expect(Math.hypot(state().runtimeVelocities[id][0], state().runtimeVelocities[id][2])).toBeLessThan(0.001);
  });

  it('keeps horizontal speed at zero while gravity supplies vertical velocity', async () => {
    const id = addCharacter([0, 5, 0]);
    attach(id, 'Scripted idle', [
      'blueprint Scripted_Idle',
      'on update(dt):',
      '    self.move(vec3(0, 0, 0), speed: 5.8)',
    ].join('\n'));

    await play(1 / 60);

    const velocity = state().runtimeVelocities[id];
    expect(Math.hypot(velocity[0], velocity[2])).toBeLessThan(0.001);
    expect(velocity[1]).toBeLessThan(-0.1);
  });

  it('publishes collision-blocked displacement instead of requested speed', async () => {
    addFloor();
    const wall = state().createObjectWithProps('cube', {
      position: [1, 2, 0],
      physics: { enabled: true, bodyType: 'fixed', collider: 'box' },
    });
    state().updateTransform(wall, 'scale', [1, 4, 8]);
    const id = addCharacter();
    attach(id, 'Blocked walker', [
      'blueprint Blocked_Walker',
      'on update(dt):',
      '    self.move(vec3(1, 0, 0), speed: 5.8)',
    ].join('\n'));

    await play(1 / 60);
    frames(60, 1 / 60);

    expect(object(id).transform.position[0]).toBeLessThan(0.25);
    expect(Math.abs(state().runtimeVelocities[id][0])).toBeLessThan(0.05);
  });

  it('does not report teleport distance as scripted locomotion speed', async () => {
    addFloor();
    const id = addCharacter();
    attach(id, 'Recall walker', [
      'blueprint Recall_Walker',
      'on update(dt):',
      '    self.move(vec3(1, 0, 0), speed: 5.8)',
      'on event Recall(payload):',
      '    set_position(self, vec3(20, 0.1, 0))',
    ].join('\n'));

    await play(1 / 60);
    expect(state().runtimeVelocities[id][0]).toBeCloseTo(5.8, 2);

    state().fireCustomEvent('Recall');
    frames(1, 1 / 60);

    expect(object(id).transform.position[0]).toBeGreaterThan(19.9);
    expect(Math.hypot(state().runtimeVelocities[id][0], state().runtimeVelocities[id][2])).toBeLessThan(0.01);
  });
});
