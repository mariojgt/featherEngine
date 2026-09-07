import { beforeAll, afterEach, describe, expect, it } from 'vitest';
import { selectActiveObjects, useEditorStore } from '../editorStore';
import { initRapier, getActivePhysics } from '../../runtime/physicsWorld';
import { CHARACTER_MOVEMENT_PRESETS, characterGroundSettings } from '../../runtime/characterPresets';

const state = () => useEditorStore.getState();
const object = (id: string) => selectActiveObjects(state()).find((item) => item.id === id)!;
describe('beginner movement with real Rapier', () => {
  beforeAll(async () => { await initRapier(); });
  afterEach(() => { state().setPlaying(false); });

  it.each(CHARACTER_MOVEMENT_PRESETS)('$name retains built-in input with rules and stable travel/jumps at 30–144 Hz', async (preset) => {
    const runs: { distance: number; apex: number }[] = [];
    for (const hz of [30, 60, 120, 144]) {
      state().setPlaying(false);
      const sceneId = state().createScene(`${preset.id} ${hz}Hz`);
      state().setActiveScene(sceneId);
      const groundId = state().createObjectWithProps('cube', { name: 'Ground', position: [0, -0.5, 0], physics: { enabled: true, bodyType: 'fixed' } });
      state().updateTransform(groundId, 'scale', [100, 1, 100]);
      const id = state().createObjectWithProps('capsule', { name: 'Player', position: [0, 1.1, 0] });
      state().toggleCharacterController(id);
      state().updateCharacterController(id, { ...preset.patch, cameraFollow: false, groundLevel: -20 });
      expect(state().addSimpleInteraction(id, { trigger: { type: 'start' }, action: { type: 'event', eventName: 'Ready' } }).ok).toBe(true);
      expect(object(id).character?.autoInputWithScript).toBe(true);
      state().setPlaying(true);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(getActivePhysics()).toBeTruthy();
      for (let i = 0; i < hz; i++) state().tickRuntime(1 / hz);
      const initial = [...object(id).transform.position];
      state().setRuntimeKey('KeyW', true);
      for (let i = 0; i < hz * 2; i++) state().tickRuntime(1 / hz);
      state().setRuntimeKey('KeyW', false);
      const moved = object(id).transform.position;
      const distance = Math.hypot(moved[0] - initial[0], moved[2] - initial[2]);
      expect(distance).toBeGreaterThan(preset.patch.moveSpeed * 1.8);
      const floorY = moved[1];
      state().setRuntimeKey('Space', true);
      let apex = 0;
      for (let i = 0; i < hz * 2; i++) { if (i === Math.round(hz * (preset.patch.jumpStrength / preset.patch.gravity + 0.1))) state().setRuntimeKey('Space', false); state().tickRuntime(1 / hz); apex = Math.max(apex, object(id).transform.position[1] - floorY); }
      state().setRuntimeKey('Space', false);
      expect(apex).toBeGreaterThan(0.5);
      expect(Math.abs(object(id).transform.position[1] - floorY), JSON.stringify({ hz, floorY, end: object(id).transform.position, velocity: state().runtimeVelocities[id] })).toBeLessThan(0.1);
      // Pausing cannot advance the body; resuming must not replay elapsed wall time.
      state().setPlayPaused(true);
      const paused = [...object(id).transform.position];
      state().tickRuntime(1);
      expect(object(id).transform.position).toEqual(paused);
      state().setPlayPaused(false);
      state().tickRuntime(1 / hz);
      expect(Math.abs(object(id).transform.position[1] - paused[1])).toBeLessThan(0.1);
      runs.push({ distance, apex });
    }
    for (const metric of ['distance', 'apex'] as const) {
      const values = runs.map((run) => run[metric]);
      expect((Math.max(...values) - Math.min(...values)) / values[1], `${metric}: ${JSON.stringify(runs)}`).toBeLessThan(0.05);
    }
  });

  it('preserves legacy ground defaults and bounds invalid imported settings', () => {
    expect(characterGroundSettings()).toEqual({ stepHeight: 0.4, stepMinWidth: 0.2, groundSnap: 0.4, maxSlopeDegrees: undefined, slideSlopeDegrees: undefined });
    expect(characterGroundSettings({ stepHeight: -1, stepMinWidth: NaN, groundSnap: 999, maxSlopeDegrees: Infinity, slideSlopeDegrees: -10 })).toEqual({ stepHeight: 0, stepMinWidth: 0.2, groundSnap: 2, maxSlopeDegrees: 45, slideSlopeDegrees: 0 });
  });

  it('climbs a 50 cm stair only when the selected step height permits it', async () => {
    const distances: number[] = [];
    for (const stepHeight of [0, 0.6]) {
      state().setPlaying(false);
      state().setActiveScene(state().createScene(`Stair ${stepHeight}`));
      const floor = state().createObjectWithProps('cube', { position: [0, -0.5, 0], physics: { enabled: true, bodyType: 'fixed' } });
      state().updateTransform(floor, 'scale', [30, 1, 30]);
      const stair = state().createObjectWithProps('cube', { position: [0, 0.25, 6], physics: { enabled: true, bodyType: 'fixed' } });
      state().updateTransform(stair, 'scale', [4, 0.5, 8]);
      const player = state().createObjectWithProps('capsule', { position: [0, 0.1, 0] });
      state().toggleCharacterController(player);
      state().updateCharacterController(player, { ...CHARACTER_MOVEMENT_PRESETS[0].patch, stepHeight, cameraFollow: false, groundLevel: -20 });
      state().setPlaying(true);
      await new Promise((resolve) => setTimeout(resolve, 0));
      for (let i = 0; i < 30; i++) state().tickRuntime(1 / 60);
      state().setRuntimeKey('KeyW', true);
      for (let i = 0; i < 60; i++) state().tickRuntime(1 / 60);
      state().setRuntimeKey('KeyW', false);
      distances.push(object(player).transform.position[2]);
    }
    expect(distances[0]).toBeLessThan(2);
    expect(distances[1]).toBeGreaterThan(4);
  });
});
