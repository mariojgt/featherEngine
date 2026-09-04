import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { selectActiveObjects, useEditorStore } from '../editorStore';
import { getActivePhysics, initRapier } from '../../runtime/physicsWorld';
import { accumulateRootMotion, clearRootMotion, drainRootMotion } from '../../runtime/rootMotion';

/**
 * Root motion `apply` driven through the real store, the real tickRuntime and the real Rapier world.
 *
 * The design claim under test is that applying root motion changes exactly ONE thing — the character
 * controller's target speed — and leaves everything else alone. So these assert both halves: the
 * animation's travel does determine the distance covered, and grounding, gravity and the no-reading
 * fallback all still behave.
 */

const KEY_FORWARD = 'KeyW';
const DT = 1 / 60;

/**
 * Enter Play and let the world come up. `startPhysics` activates in a microtask, and a character's
 * Rapier body is only created on the first tick that syncs it — until then the controller returns
 * early and the character silently stays put.
 */
const startPlay = async (objectId: string) => {
  useEditorStore.getState().setPlaying(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(getActivePhysics()).toBeTruthy();
  // Let the character fall from its spawn height and settle on the floor, so the assertions below
  // measure walking rather than the tail of that drop.
  for (let frame = 0; frame < 40; frame += 1) useEditorStore.getState().tickRuntime(DT);
  expect(getActivePhysics()?.hasCharacter(objectId)).toBe(true);
  clearRootMotion(); // discard anything the warm-up frames accumulated
};

const clearScene = () => {
  const store = useEditorStore.getState();
  for (const object of selectActiveObjects(useEditorStore.getState())) store.deleteObject(object.id);
};

/** A floor wide enough that nothing under test can walk off it. */
const addFloor = () => {
  const store = useEditorStore.getState();
  const id = store.createObjectWithProps('cube', {
    name: 'Floor',
    position: [0, -0.5, 0],
    physics: { enabled: true, bodyType: 'fixed', collider: 'box' },
  });
  store.updateTransform(id, 'scale', [200, 1, 200]);
  return id;
};

/**
 * A character on the floor. No physics component: syncCharacters builds its own kinematic body and
 * Rapier character controller from `character.enabled` alone, and adding a second rigid body on top
 * makes the two fight.
 */
const setup = (rootMotion?: 'disabled' | 'extract' | 'apply') => {
  const store = useEditorStore.getState();
  addFloor();
  const objectId = store.createObjectWithProps('capsule', { name: 'Hero', position: [0, 1, 0] });
  store.toggleCharacterController(objectId);
  store.updateCharacterController(objectId, {
    moveSpeed: 4,
    // Reach the target speed within a frame, so the assertions read the target rather than the ramp.
    acceleration: 100000,
    deceleration: 100000,
    cameraRelativeMovement: false,
    mouseLook: false,
    turnInPlace: false,
    mantleEnabled: false,
    slideEnabled: false,
  });
  if (rootMotion) {
    store.toggleAnimator(objectId);
    store.updateAnimator(objectId, { rootMotion });
  }
  return objectId;
};

const positionOf = (objectId: string) =>
  selectActiveObjects(useEditorStore.getState()).find((object) => object.id === objectId)!.transform.position;

const horizontalTravel = (from: number[], to: number[]) => Math.hypot(to[0] - from[0], to[2] - from[2]);

/** Runs frames with forward held, publishing `perFrame` units of root travel before each tick. */
const runHoldingForward = (objectId: string, frames: number, perFrame?: number) => {
  for (let frame = 0; frame < frames; frame += 1) {
    if (perFrame !== undefined) accumulateRootMotion(objectId, perFrame, DT);
    useEditorStore.getState().setRuntimeKey(KEY_FORWARD, true);
    useEditorStore.getState().tickRuntime(DT);
  }
};

describe('root motion apply', () => {
  beforeAll(async () => {
    // The world is null until the WASM lands, and a null world no-ops every assertion below.
    await initRapier();
  });

  beforeEach(() => {
    clearScene();
  });

  afterEach(() => {
    useEditorStore.getState().setRuntimeKey(KEY_FORWARD, false);
    useEditorStore.getState().setPlaying(false);
    clearRootMotion();
  });

  it('drains the published sample, so a frame is never counted twice', async () => {
    const objectId = setup('apply');
    await startPlay(objectId);
    accumulateRootMotion(objectId, 0.1, DT);
    runHoldingForward(objectId, 1);
    expect(drainRootMotion(objectId)).toBeUndefined();
  });

  // `extract` publishes for readers (scripts, the debug readout) but must not steer the character.
  it('leaves the accumulator alone when the mode is not apply', async () => {
    const objectId = setup('extract');
    await startPlay(objectId);
    accumulateRootMotion(objectId, 0.1, DT);
    runHoldingForward(objectId, 1);
    expect(drainRootMotion(objectId)).toBeDefined();
  });

  // The whole point: distance comes from the animation, not from moveSpeed.
  it('travels at the animation speed rather than the authored move speed', async () => {
    const objectId = setup('apply');
    await startPlay(objectId);
    const start = [...positionOf(objectId)];
    // 0.02 units per frame at 60fps = 1.2 units/sec, well under the authored moveSpeed of 4.
    runHoldingForward(objectId, 60, 0.02);
    const travelled = horizontalTravel(start, positionOf(objectId));
    expect(travelled).toBeGreaterThan(0.8);
    expect(travelled).toBeLessThan(1.8);
  });

  it('travels at the authored move speed when root motion is off', async () => {
    const objectId = setup();
    await startPlay(objectId);
    const start = [...positionOf(objectId)];
    runHoldingForward(objectId, 60);
    // moveSpeed 4 for ~1 second — clearly faster than the animation-driven 1.2 above.
    expect(horizontalTravel(start, positionOf(objectId))).toBeGreaterThan(3);
  });

  // A tick with no render frame between it and the last has NO reading. That must not read as speed
  // zero, or the character stutters to a halt whenever the two loops interleave unevenly.
  it('keeps the authored speed on a tick with no published sample', async () => {
    const objectId = setup('apply');
    await startPlay(objectId);
    const start = [...positionOf(objectId)];
    runHoldingForward(objectId, 30); // nothing ever published
    expect(horizontalTravel(start, positionOf(objectId))).toBeGreaterThan(0.5);
  });

  it('stands still when the animation is not travelling', async () => {
    const objectId = setup('apply');
    await startPlay(objectId);
    const start = [...positionOf(objectId)];
    runHoldingForward(objectId, 30, 0); // an idle clip: no root travel
    expect(horizontalTravel(start, positionOf(objectId))).toBeLessThan(0.05);
  });

  it('leaves grounding and gravity alone', async () => {
    const objectId = setup('apply');
    await startPlay(objectId);
    const restingY = positionOf(objectId)[1];
    runHoldingForward(objectId, 60, 0.02);
    const end = positionOf(objectId);
    expect(Number.isFinite(end[1])).toBe(true);
    // Still walking along the floor, neither sinking through it nor climbing.
    expect(Math.abs(end[1] - restingY)).toBeLessThan(0.5);
  });

  it('never produces a non-finite transform under hostile input', async () => {
    const objectId = setup('apply');
    await startPlay(objectId);
    for (let frame = 0; frame < 90; frame += 1) {
      // Zeros, ordinary steps and a wrap-sized jump interleaved, with the key flickering.
      accumulateRootMotion(objectId, frame % 3 === 0 ? 0 : 0.03, DT);
      accumulateRootMotion(objectId, NaN, DT);
      useEditorStore.getState().setRuntimeKey(KEY_FORWARD, frame % 7 !== 0);
      useEditorStore.getState().tickRuntime(DT);
    }
    for (const axis of positionOf(objectId)) expect(Number.isFinite(axis)).toBe(true);
  });

  it('ticks many frames with root motion applied without throwing', async () => {
    const objectId = setup('apply');
    await startPlay(objectId);
    expect(() => runHoldingForward(objectId, 180, 0.02)).not.toThrow();
    expect(useEditorStore.getState().isPlaying).toBe(true);
  });
});
