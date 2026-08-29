import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { selectActiveObjects, useEditorStore } from '../editorStore';
import { getActivePhysics, initRapier } from '../../runtime/physicsWorld';
import { defaultPhysics } from '../editor/defaults';
import type { GraphNodeCategory, Vector3Tuple } from '../../types';

/**
 * Behavioural tests for the rigid-body features that `tsc` can't say anything about: axis locks, the
 * Collision/Trigger Stay events, angular-velocity set/read-back, and scene gravity. Each one drives the
 * REAL Rapier world through `tickRuntime` and asserts on the simulated result, because every one of
 * these can compile perfectly while doing nothing at all (a lock never applied, a Stay event never
 * replayed, a gravity vector never pushed across the WASM boundary).
 */

const tick = (frames: number, dt = 1 / 60) => {
  for (let i = 0; i < frames; i += 1) useEditorStore.getState().tickRuntime(dt);
};

/**
 * Enter Play and wait for the physics world to come up — `startPhysics` activates in a microtask, so
 * ticking straight after `setPlaying` runs against a null world where every body silently stays put.
 */
const startPlay = async () => {
  useEditorStore.getState().setPlaying(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(getActivePhysics()).toBeTruthy();
};

const objectById = (id: string) => selectActiveObjects(useEditorStore.getState()).find((o) => o.id === id);
const positionOf = (id: string) => objectById(id)!.transform.position;
const rotationOf = (id: string) => objectById(id)!.transform.rotation;

/** Wipe the starter scene so stray default objects can't collide with the fixtures under test. */
const clearScene = () => {
  const store = useEditorStore.getState();
  for (const object of selectActiveObjects(useEditorStore.getState())) store.deleteObject(object.id);
};

/**
 * Remove the scene's authored gravity. `updateSceneEnvironment` runs its patch through `stripUndefined`,
 * so gravity can only be OVERWRITTEN through it, never cleared — without this, one test's sideways
 * gravity silently leaks into the next and bodies drift out of the fixtures under test. Clearing the key
 * outright is also what lets the test below exercise the real "no gravity authored" fallback.
 */
const clearAuthoredGravity = () => {
  useEditorStore.setState((state) => ({
    scenes: state.scenes.map((scene) => {
      if (scene.id !== state.activeSceneId || !scene.environment) return scene;
      const { gravity: _gravity, ...rest } = scene.environment;
      return { ...scene, environment: rest as typeof scene.environment };
    }),
  }));
};

/** A floor wide enough that nothing under test can walk off it. */
const addFloor = () => {
  const store = useEditorStore.getState();
  const id = store.createObjectWithProps('cube', {
    name: 'Floor',
    position: [0, -0.5, 0],
    physics: { enabled: true, bodyType: 'fixed', collider: 'box' },
  });
  store.updateTransform(id, 'scale', [60, 1, 60]);
  return id;
};

beforeAll(async () => {
  // The world is null until the WASM lands, and a null world silently no-ops every assertion below.
  await initRapier();
});

beforeEach(() => {
  useEditorStore.getState().setPlaying(false);
  clearScene();
  clearAuthoredGravity();
});

afterEach(() => {
  useEditorStore.getState().setPlaying(false);
});

describe('scene gravity', () => {
  it('falls along a custom gravity vector instead of the hardcoded -Y', async () => {
    const store = useEditorStore.getState();
    // Gravity pointing along -Z: a free body should travel in Z, which the old hardcoded world could not do.
    store.updateSceneEnvironment(store.activeSceneId, { gravity: [0, 0, -20] });
    const ball = store.createObjectWithProps('sphere', {
      name: 'Ball',
      position: [0, 20, 0],
      physics: { enabled: true, bodyType: 'dynamic', collider: 'sphere', mass: 1 },
    });

    await startPlay();
    tick(60);

    const [, y, z] = positionOf(ball);
    expect(z).toBeLessThan(-1);
    // And it should NOT have fallen: all of gravity is on Z now.
    expect(Math.abs(y - 20)).toBeLessThan(0.5);
  });

  it('defaults to Earth gravity when the scene authors none', async () => {
    // beforeEach removed the gravity key entirely, so this exercises the `?? EARTH_GRAVITY` fallback.
    const store = useEditorStore.getState();
    const ball = store.createObjectWithProps('sphere', {
      name: 'Ball',
      position: [0, 20, 0],
      physics: { enabled: true, bodyType: 'dynamic', collider: 'sphere', mass: 1 },
    });

    await startPlay();
    tick(60); // one simulated second

    // ½·9.81·1² ≈ 4.9m. Asserting the DISTANCE (not just "it moved") pins the magnitude to real Earth
    // gravity — a fallback of, say, -1 would still move the ball but fail here.
    const dropped = 20 - positionOf(ball)[1];
    expect(dropped).toBeGreaterThan(4.0);
    expect(dropped).toBeLessThan(6.0);
  });
});

describe('axis locks', () => {
  it('freezes translation on locked axes only', async () => {
    const store = useEditorStore.getState();
    store.updateSceneEnvironment(store.activeSceneId, { gravity: [0, 0, -20] });

    const locked = store.createObjectWithProps('cube', {
      name: 'Locked',
      position: [-4, 5, 0],
      physics: {
        enabled: true,
        bodyType: 'dynamic',
        collider: 'box',
        mass: 1,
        lockedTranslation: [false, false, true],
      },
    });
    const free = store.createObjectWithProps('cube', {
      name: 'Free',
      position: [4, 5, 0],
      physics: { enabled: true, bodyType: 'dynamic', collider: 'box', mass: 1 },
    });

    await startPlay();
    tick(60);

    // The free twin is dragged along -Z; the locked one cannot move on Z at all.
    expect(positionOf(free)[2]).toBeLessThan(-1);
    expect(Math.abs(positionOf(locked)[2])).toBeLessThan(0.01);
  });

  it('freezes rotation on locked axes so an upright body cannot tip', async () => {
    const store = useEditorStore.getState();
    addFloor();
    // Sideways gravity while resting on the floor is what topples a tall body.
    store.updateSceneEnvironment(store.activeSceneId, { gravity: [12, -9.81, 0] });

    const upright = store.createObjectWithProps('capsule', {
      name: 'Upright',
      position: [-6, 1.5, 0],
      physics: {
        enabled: true,
        bodyType: 'dynamic',
        collider: 'capsule',
        mass: 3,
        friction: 1,
        lockedRotation: [true, false, true],
      },
    });
    const tippy = store.createObjectWithProps('capsule', {
      name: 'Tippy',
      position: [6, 1.5, 0],
      physics: { enabled: true, bodyType: 'dynamic', collider: 'capsule', mass: 3, friction: 1 },
    });

    await startPlay();
    tick(150);

    const [ux, , uz] = rotationOf(upright);
    const tippyTilt = Math.abs(rotationOf(tippy)[2]);
    // The locked body holds its X/Z orientation exactly; the free one visibly rolls over.
    expect(Math.abs(ux)).toBeLessThan(0.01);
    expect(Math.abs(uz)).toBeLessThan(0.01);
    expect(tippyTilt).toBeGreaterThan(0.2);
  });
});

/** Wire a blueprint onto `objectId` and return helpers for adding/connecting its nodes. */
const scriptOn = (objectId: string, name: string) => {
  const store = useEditorStore.getState();
  const { blueprintId } = store.createBlueprintNamed(name, name);
  store.attachScript(objectId, blueprintId);
  return {
    add: (label: string, category: GraphNodeCategory, data?: Record<string, unknown>) =>
      useEditorStore.getState().addGraphNodeToBlueprint(blueprintId, label, category, data),
    ex: (a: string, b: string) => useEditorStore.getState().connectGraphNodes(blueprintId, a, b, 'exec-out', 'exec-in'),
    vl: (a: string, b: string, handle: string) =>
      useEditorStore.getState().connectGraphNodes(blueprintId, a, b, 'value-out', handle),
  };
};

/** Build "<event> → counter = counter + 1" on `objectId`, returning the project variable's id. */
const countEventFires = (objectId: string, eventLabel: string, varName: string) => {
  const store = useEditorStore.getState();
  const varId = store.createVariable(varName, 'number', false);
  const { add, ex, vl } = scriptOn(objectId, `${varName} Counter`);
  const onEvent = add(eventLabel, 'Events');
  const read = add('Get Variable', 'Variables', { variableId: varId });
  const one = add('Number', 'Values', { numberValue: 1 });
  const sum = add('Add', 'Math');
  const write = add('Set Variable', 'Variables', { variableId: varId });
  ex(onEvent, write);
  vl(read, sum, 'a');
  vl(one, sum, 'b');
  vl(sum, write, 'value');
  return varId;
};

const varValue = (varId: string) => Number(useEditorStore.getState().runtimeVariableValues[varId] ?? 0);

describe('stay events', () => {
  it('fires Collision Stay every frame a body rests on another, not just once', async () => {
    const store = useEditorStore.getState();
    const plate = store.createObjectWithProps('cube', {
      name: 'Plate',
      position: [0, 0, 0],
      physics: { enabled: true, bodyType: 'fixed', collider: 'box' },
    });
    store.updateTransform(plate, 'scale', [4, 0.5, 4]);
    store.createObjectWithProps('cube', {
      name: 'Weight',
      position: [0, 1.2, 0],
      physics: { enabled: true, bodyType: 'dynamic', collider: 'box', mass: 5 },
    });
    const staysVar = countEventFires(plate, 'Collision Stay', 'Stays');

    await startPlay();
    tick(120);

    // Collision ENTER would leave this at 1. Resting contact must keep firing.
    expect(varValue(staysVar)).toBeGreaterThan(30);
  });

  it('fires Trigger Stay while overlapping and stops once the overlap ends', async () => {
    const store = useEditorStore.getState();
    addFloor();
    const zone = store.createObjectWithProps('cube', {
      name: 'Zone',
      position: [0, 3, 0],
      physics: { enabled: true, bodyType: 'fixed', collider: 'box', isTrigger: true },
    });
    store.updateTransform(zone, 'scale', [3, 3, 3]);
    // Dropped from above: it falls THROUGH the sensor, so the overlap starts and then genuinely ends.
    store.createObjectWithProps('sphere', {
      name: 'Faller',
      position: [0, 9, 0],
      physics: { enabled: true, bodyType: 'dynamic', collider: 'sphere', mass: 1 },
    });
    const staysVar = countEventFires(zone, 'Trigger Stay', 'ZoneStays');

    await startPlay();
    tick(90);
    const whileInside = varValue(staysVar);
    expect(whileInside).toBeGreaterThan(1);

    // Long past the fall-through, the counter must be frozen — Stay is not allowed to latch on.
    tick(120);
    expect(varValue(staysVar)).toBe(whileInside);
  });

  it('costs nothing when no graph listens for Stay', async () => {
    const store = useEditorStore.getState();
    const plate = store.createObjectWithProps('cube', {
      name: 'Plate',
      position: [0, 0, 0],
      physics: { enabled: true, bodyType: 'fixed', collider: 'box' },
    });
    store.updateTransform(plate, 'scale', [4, 0.5, 4]);
    store.createObjectWithProps('cube', {
      name: 'Weight',
      position: [0, 1.2, 0],
      physics: { enabled: true, bodyType: 'dynamic', collider: 'box', mass: 5 },
    });

    await startPlay();
    tick(60);

    // No Stay root anywhere, so physics must not have replayed a single resting contact.
    expect(useEditorStore.getState().runtimeCollisionsStay).toEqual([]);
  });
});

describe('angular velocity', () => {
  it('holds a commanded spin rate and reads it back through Get Angular Velocity', async () => {
    const store = useEditorStore.getState();
    const disc = store.createObjectWithProps('cube', {
      name: 'Turntable',
      position: [0, 2, 0],
      physics: {
        enabled: true,
        bodyType: 'dynamic',
        collider: 'box',
        mass: 20,
        // Locks act as the bearing: it can only spin about Y, and can't drift or fall.
        lockedTranslation: [true, true, true],
        lockedRotation: [true, false, true],
      },
    });
    store.updateTransform(disc, 'scale', [4, 0.4, 4]);

    const spinVar = store.createVariable('Spin', 'number', false);
    const { add, ex, vl } = scriptOn(disc, 'Turntable');
    const onUpdate = add('Update', 'Events');
    const setSpin = add('Set Angular Velocity', 'Physics', { axis: 'y', amount: 2.5 });
    const getSpin = add('Get Angular Velocity', 'Physics');
    const length = add('Vector Length', 'Math');
    const write = add('Set Variable', 'Variables', { variableId: spinVar });
    ex(onUpdate, setSpin);
    ex(setSpin, write);
    vl(getSpin, length, 'vector');
    vl(length, write, 'value');

    await startPlay();
    tick(60);

    // The body is actually turning about Y...
    expect(Math.abs(rotationOf(disc)[1])).toBeGreaterThan(0.5);
    // ...at the rate we asked for, read back out of the solver rather than echoed from the node.
    expect(varValue(spinVar)).toBeGreaterThan(2.0);
    expect(varValue(spinVar)).toBeLessThan(3.0);
    // And the locks held. Asserted on the angular VELOCITY, not Euler angles: once the Y rotation passes
    // 90° the XYZ decomposition legitimately flips X and Z to ±π on a body that never left its plane.
    const [avx, avy, avz] = useEditorStore.getState().runtimeAngularVelocities[disc]!;
    expect(Math.abs(avx)).toBeLessThan(0.01);
    expect(Math.abs(avz)).toBeLessThan(0.01);
    expect(Math.abs(avy)).toBeGreaterThan(2.0);
  });
});

describe('apply force at point and speed', () => {
  it('an off-center point impulse spins a body, while a center impulse does not', async () => {
    const store = useEditorStore.getState();
    // Both boxes hang free on locked translation so they can only rotate — a pure center impulse
    // shoves but never tumbles, so any spin is unambiguous proof the point offset made it to Rapier.
    const makeKicker = (name: string, label: string, data: Record<string, unknown>, x: number) => {
      const cube = store.createObjectWithProps('cube', {
        name,
        position: [x, 2, 0],
        physics: {
          enabled: true,
          bodyType: 'dynamic',
          collider: 'box',
          mass: 1,
          lockedTranslation: [true, true, true],
          lockedRotation: [false, false, false],
        },
      });
      const { add, ex } = scriptOn(cube, name);
      ex(add('Start', 'Events'), add(label, 'Physics', data));
      return cube;
    };
    // (0,1,0) impulse applied at local point [1,0,0]: lever arm r×F = [1,0,0]×[0,1,0] = +Z torque.
    const spinner = makeKicker('Spinner', 'Apply Force at Point', { axis: 'y', amount: 2, localPoint: [1, 0, 0] }, 0);
    // Same (0,1,0) impulse but AT the center of mass — zero torque, no spin.
    const pusher = makeKicker('Pusher', 'Apply Impulse', { axis: 'y', amount: 2 }, 4);

    await startPlay();
    tick(10);

    expect(rotationOf(spinner)[2]).toBeGreaterThan(0.2);
    expect(Math.abs(rotationOf(pusher)[2])).toBeLessThan(0.01);
  });

  it('Get Speed returns the linear speed magnitude from the physics solver', async () => {
    const store = useEditorStore.getState();
    const ball = store.createObjectWithProps('sphere', {
      name: 'Speedster',
      position: [0, 10, 0], // high enough that the short test never bounces off the floor
      physics: { enabled: true, bodyType: 'dynamic', collider: 'sphere', mass: 1 },
    });
    const speedVar = store.createVariable('Speed', 'number', false);
    const { add, ex, vl } = scriptOn(ball, 'Speedster');
    const onStart = add('Start', 'Events');
    const kick = add('Apply Impulse', 'Physics', { axis: 'x', amount: 8 });
    const read = add('Update', 'Events');
    const getSpeed = add('Get Speed', 'Physics');
    const write = add('Set Variable', 'Variables', { variableId: speedVar });
    ex(onStart, kick);
    ex(read, write);
    vl(getSpeed, write, 'value');

    await startPlay();
    tick(5);

    // v = impulse / mass = 8 (the solver wrote the velocity, Get Speed reads it back).
    expect(varValue(speedVar)).toBeGreaterThan(7.5);
    expect(varValue(speedVar)).toBeLessThan(8.5);
  });
});

describe('physics lab template', () => {
  it('builds and survives a Play session', async () => {
    const { createPhysicsLabTemplate } = await import('../../project/physicsLabTemplate');
    const pawnId = await createPhysicsLabTemplate();
    expect(pawnId).toBeTruthy();

    const store = useEditorStore.getState();
    await startPlay();
    expect(() => tick(180)).not.toThrow();
    expect(useEditorStore.getState().isPlaying).toBe(true);

    // The turntable station publishes a live spin rate — proof the graph wiring actually ran.
    const spinVar = useEditorStore.getState().variables.find((v) => v.name === 'TurntableSpin');
    expect(spinVar).toBeTruthy();
    expect(varValue(spinVar!.id)).toBeGreaterThan(2.0);
  });
});

describe('one-click physics quick presets', () => {
  it('applies a known preset and enables physics', async () => {
    const { applyPhysicsQuickPreset } = await import('../../runtime/physicsMaterials');
    const result = applyPhysicsQuickPreset(defaultPhysics(), 'pushable-crate');
    expect(result).toBeTruthy();
    expect(result!.physics.enabled).toBe(true);
    expect(result!.physics.bodyType).toBe('dynamic');
    expect(result!.physics.materialPreset).toBe('wood');
    // Wood preset carries friction/bounce, and the preset overrides them after the material applies.
    expect(result!.physics.restitution).toBe(0.08);
    // Crates are axis-locked so they don't tip over from bumps.
    expect(result!.physics.lockedRotation).toEqual([true, true, true]);
  });

  it('returns null for an unknown preset id', async () => {
    const { applyPhysicsQuickPreset } = await import('../../runtime/physicsMaterials');
    expect(applyPhysicsQuickPreset(defaultPhysics(), 'nope')).toBeNull();
  });
});

describe('Model Forge mesh-accurate colliders', () => {
  it('resolves a forge prop to the model collider kind (not a plain box)', async () => {
    const { colliderKindFor } = await import('../../runtime/colliderShape');
    const store = useEditorStore.getState();
    const specId = store.createModelSpec('blank', 'Shelf') as string;
    const shelfId = store.createModelFromSpec(specId, { name: 'Shelf' });
    expect(shelfId).toBeTruthy();
    store.togglePhysics(shelfId!);
    store.updatePhysics(shelfId!, { bodyType: 'fixed', collider: 'box' });
    const object = objectById(shelfId!);
    expect(object?.model?.enabled).toBe(true);
    expect(colliderKindFor(object!)).toBe('model');
    // And an explicit primitive choice still wins over model resolution.
    store.updatePhysics(shelfId!, { collider: 'sphere' });
    expect(colliderKindFor(objectById(shelfId!)!)).toBe('sphere');
  });

  it('lets a falling body rest on a forge prop\'s real part surface (off-origin trimesh)', async () => {
    const store = useEditorStore.getState();
    // A horizontal plank suspended OFF the origin: its top surface sits at y = 1 + 0.25 = 1.25 in the
    // model's local space (part position [0,1,0], part half-height 0.25). A plain box-fallback collider
    // would sit at the object's AUTHORED transform (y≈0), so a crate would land around y=0.75. With the
    // true trimesh the crate must rest on the plank at ≈ y = 1.25 + 0.25 = 1.5.
    const specId = store.createModelSpec('blank', 'Shelf') as string;
    expect(specId).toBeTruthy();
    for (const part of useEditorStore.getState().modelSpecs.find((s) => s.id === specId)!.parts) {
      store.removeModelPart(specId, part.id);
    }
    const plankPartId = store.addModelPart(specId, 'box', { position: [0, 1, 0], scale: [2, 0.5, 1] });
    expect(plankPartId).toBeTruthy();

    const shelfId = store.createModelFromSpec(specId, { name: 'Shelf', position: [0, 0, 0] }) as string;
    store.togglePhysics(shelfId);
    store.updatePhysics(shelfId, { bodyType: 'fixed' }); // default collider => 'model' kind

    const crateId = store.createObjectWithProps('cube', {
      name: 'Crate',
      position: [0, 3, 0],
      physics: { enabled: true, bodyType: 'dynamic', collider: 'box', mass: 1, friction: 0.8 },
    });
    store.updateTransform(crateId, 'scale', [0.5, 0.5, 0.5]);

    await startPlay();
    tick(240); // long enough for the crate to fully settle

    const [, shelfY] = positionOf(shelfId);
    expect(Math.abs(shelfY)).toBeLessThan(0.01); // fixed body keeps its authored pose
    const [, crateY] = positionOf(crateId);
    // Resting on the plank top (1.5), not the origin box (0.75). Generous band around 1.5.
    expect(crateY).toBeGreaterThan(1.3);
    expect(crateY).toBeLessThan(1.7);
  });

  it('per-part "none" collider lets a body fall through that part onto the real surface', async () => {
    const store = useEditorStore.getState();
    // A solid plank (top surface at y = 1 + 0.2 = 1.2) with a tall decorative SPIRE directly above it —
    // marked collider:'none', so a crate must pass through the spire and land on the plank, not hang on
    // the spire's tip.
    const specId = store.createModelSpec('blank', 'Cantilever') as string;
    for (const part of useEditorStore.getState().modelSpecs.find((s) => s.id === specId)!.parts) {
      store.removeModelPart(specId, part.id);
    }
    store.addModelPart(specId, 'box', { position: [0, 1, 0], scale: [2, 0.4, 1] });
    const spireId = store.addModelPart(specId, 'cylinder', {
      position: [0, 2.4, 0],
      scale: [0.4, 1.6, 0.4],
      collider: 'none',
    });
    expect(spireId).toBeTruthy();
    // The override round-trips through the store (normalization keeps it).
    expect(useEditorStore.getState().modelSpecs.find((s) => s.id === specId)!.parts.find((p) => p.id === spireId)!.collider).toBe('none');

    const propId = store.createModelFromSpec(specId, { name: 'Cantilever', position: [0, 0, 0] }) as string;
    store.togglePhysics(propId);
    store.updatePhysics(propId, { bodyType: 'fixed' });

    const crateId = store.createObjectWithProps('cube', {
      name: 'Crate',
      position: [0, 5, 0],
      physics: { enabled: true, bodyType: 'dynamic', collider: 'box', mass: 1, friction: 0.8 },
    });
    store.updateTransform(crateId, 'scale', [0.5, 0.5, 0.5]);

    await startPlay();
    tick(240);

    const [, crateY] = positionOf(crateId);
    // Resting on the PLANK (y ≈ 1.2 + 0.25 = 1.45), not stuck on the spire (whose top would be ≈ 4).
    expect(crateY).toBeGreaterThan(1.2);
    expect(crateY).toBeLessThan(1.7);
  });

  it('new shapes: hexprism auto-collides as a block and a torus "none" stays pass-through', async () => {
    const store = useEditorStore.getState();
    // A fixed hex prism base (auto → cuboid; top surface at y=0.5) with a decorative torus ring above it
    // marked collider:'none'. A crate must fall through the ring and rest on the prism.
    const specId = store.createModelSpec('blank', 'Spool') as string;
    for (const part of useEditorStore.getState().modelSpecs.find((s) => s.id === specId)!.parts) {
      store.removeModelPart(specId, part.id);
    }
    store.addModelPart(specId, 'hexprism', { position: [0, 0.25, 0], scale: [1, 0.5, 1] });
    const ringId = store.addModelPart(specId, 'torus', { position: [0, 1.05, 0], scale: [1, 1, 1], collider: 'none' });
    expect(ringId).toBeTruthy();

    const propId = store.createModelFromSpec(specId, { name: 'Spool', position: [0, 0, 0] }) as string;
    store.togglePhysics(propId);
    store.updatePhysics(propId, { bodyType: 'fixed' });

    const crateId = store.createObjectWithProps('cube', {
      name: 'Crate',
      position: [0, 5, 0],
      physics: { enabled: true, bodyType: 'dynamic', collider: 'box', mass: 1, friction: 0.8 },
    });
    store.updateTransform(crateId, 'scale', [0.5, 0.5, 0.5]);

    await startPlay();
    tick(240);

    const [, crateY] = positionOf(crateId);
    // Resting on the PRISM (y ≈ 0.5 + 0.25 = 0.75). If the torus were solid, it'd be ≈ 1.55.
    expect(crateY).toBeGreaterThan(0.6);
    expect(crateY).toBeLessThan(0.9);
  });

  it('a converted mesh part collides from its real baked surface', async () => {
    const store = useEditorStore.getState();
    // A plank converted to a mesh part (its actual triangular surface) suspended at y=1. A crate must
    // rest on the mesh part's top surface ~ y=1.25, not on the object origin (which the model trimesh
    // path would ignore, and a dumb origin box would place at 0.75).
    const specId = store.createModelSpec('blank', 'MeshShelf') as string;
    for (const part of useEditorStore.getState().modelSpecs.find((s) => s.id === specId)!.parts) {
      store.removeModelPart(specId, part.id);
    }
    const plankId = store.addModelPart(specId, 'box', { position: [0, 1, 0], scale: [2, 0.5, 1] });
    expect(plankId).toBeTruthy();
    expect(store.convertModelPartToMesh(specId, plankId!)).toBe(true);
    const part = useEditorStore.getState().modelSpecs.find((s) => s.id === specId)!.parts.find((p) => p.id === plankId)!;
    expect(part.shape).toBe('mesh');
    expect(part.collider ?? 'auto').toBe('auto'); // auto → the mesh tri/conv hull branch

    const propId = store.createModelFromSpec(specId, { name: 'MeshShelf', position: [0, 0, 0] }) as string;
    store.togglePhysics(propId);
    store.updatePhysics(propId, { bodyType: 'fixed' });

    const crateId = store.createObjectWithProps('cube', {
      name: 'Crate',
      position: [0, 4, 0],
      physics: { enabled: true, bodyType: 'dynamic', collider: 'box', mass: 1, friction: 0.8 },
    });
    store.updateTransform(crateId, 'scale', [0.5, 0.5, 0.5]);

    await startPlay();
    tick(240);

    const [, crateY] = positionOf(crateId);
    // Resting on the MESH plank top (1 + 0.25 + crate half height ~ 1.5).
    expect(crateY).toBeGreaterThan(1.3);
    expect(crateY).toBeLessThan(1.7);
    store.deleteObject(propId);
  });
});

