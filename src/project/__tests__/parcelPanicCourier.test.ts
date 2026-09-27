import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { initRapier } from '../../runtime/physicsWorld';
import { readTransform } from '../../runtime/transformBuffer';
import { scanBlueprintGraphProblems } from '../../store/editor/graphDiagnostics';
import { selectActiveObjects, useEditorStore } from '../../store/editorStore';
import { isInstanceable } from '../../three/modelInstancing';
import type { GraphValue, GraphValueType, SceneObject } from '../../types';
import { addParcelPanicCourier } from '../parcelPanicCourier';
import { blankProject } from '../serialize';

const state = () => useEditorStore.getState();
const objects = () => selectActiveObjects(state());
const object = (name: string) => objects().find((candidate) => candidate.name === name)!;
const frames = (count = 1) => {
  for (let index = 0; index < count; index += 1) state().tickRuntime(1 / 60);
};
const runtimeState = (playerId: string) => state().runtimeObjectVariables[playerId]?.ppc_anim_state;

const descendants = (rootId: string): SceneObject[] => {
  const all = objects();
  const ids = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of all) {
      if (candidate.parentId && ids.has(candidate.parentId) && !ids.has(candidate.id)) {
        ids.add(candidate.id);
        changed = true;
      }
    }
  }
  return all.filter((candidate) => ids.has(candidate.id));
};

/** Mirrors the renderer's nested group composition, but leaves out the supplied root transform. */
const relativePose = (rootId: string, objectName: string): THREE.Matrix4 => {
  const byId = new Map(objects().map((candidate) => [candidate.id, candidate]));
  const chain: SceneObject[] = [];
  let cursor: SceneObject | undefined = object(objectName);
  while (cursor && cursor.id !== rootId) {
    chain.unshift(cursor);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  if (!cursor) throw new Error(`${objectName} is not a descendant of ${rootId}`);
  const result = new THREE.Matrix4();
  const local = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Euler();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  for (const item of chain) {
    const transform = readTransform(item.id) ?? item.transform;
    local.compose(
      position.fromArray(transform.position),
      quaternion.setFromEuler(rotation.fromArray(transform.rotation)),
      scale.fromArray(transform.scale),
    );
    result.multiply(local);
  }
  return result;
};

const relativePosition = (rootId: string, objectName: string): THREE.Vector3 =>
  new THREE.Vector3().setFromMatrixPosition(relativePose(rootId, objectName));

const addGlobal = (name: string, type: GraphValueType, defaultValue: GraphValue) => {
  const id = state().createVariable(name, type, false);
  state().updateVariable(id, { defaultValue });
};

const arrangeCourier = () => {
  addGlobal('PPIntro', 'boolean', true);
  addGlobal('PPPlaying', 'boolean', false);
  addGlobal('PPPaused', 'boolean', false);
  addGlobal('PPDone', 'boolean', false);
  addGlobal('PPCarry', 'string', '');
  addGlobal('PPDelivered', 'number', 0);
  addGlobal('PPPickupPulse', 'number', 0);
  addGlobal('PPThrowPulse', 'number', 0);

  const materialFolder = state().createFolder('Parcel Panic materials');
  const logicFolder = state().createFolder('Parcel Panic logic');
  const material = (name: string, color: string) => {
    const id = state().createMaterial(name, 'Courier test material', materialFolder);
    state().updateMaterial(id, { color, toon: true, roughness: 0.7 });
    return id;
  };
  const materials = {
    cream: material('Cream', '#fff1cf'),
    mint: material('Mint', '#4ad9be'),
    ink: material('Ink', '#193f4b'),
    gold: material('Gold', '#f7c65a'),
    wood: material('Wood', '#dfae7e'),
    coral: material('Coral', '#f77f7f'),
  };

  const floorId = state().createObjectWithProps('cube', {
    name: 'Courier test floor',
    position: [0, -0.4, 0],
    physics: {
      enabled: true,
      bodyType: 'fixed',
      collider: 'box',
      friction: 0.9,
      restitution: 0,
    },
  });
  state().updateTransform(floorId, 'scale', [48, 0.8, 48]);

  const created = state().createRoleObject('player', {
    kind: 'empty',
    name: 'Pip · Test player',
    position: [0, 0.15, 0],
  });
  if (!created.ok || !created.objectId) throw new Error('Test player could not be created.');
  const playerId = created.objectId;
  state().updateCharacterController(playerId, {
    autoInputWithScript: true,
    cameraFollow: true,
    cameraRelativeMovement: false,
    moveSpeed: 5,
    sprintMultiplier: 1.6,
    jumpStrength: 7,
    gravity: 18,
    stableJumpArc: true,
    groundLevel: -10,
  });

  return { playerId, logicFolder, result: addParcelPanicCourier(playerId, materials, logicFolder) };
};

const play = async () => {
  state().setPlaying(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  frames(8);
};

beforeAll(async () => {
  await initRapier();
});

beforeEach(() => {
  state().setPlaying(false);
  state().loadProject(blankProject('Parcel Panic courier test'));
});

afterEach(() => {
  state().setPlaying(false);
  state().loadProject(blankProject('Parcel Panic courier cleanup'));
});

describe('Parcel Panic procedural courier', () => {
  it('builds the articulated cream/mint toy rig and a diagnostic-free editable graph', () => {
    const { playerId, logicFolder, result } = arrangeCourier();
    const player = objects().find((candidate) => candidate.id === playerId)!;
    const rig = objects().find((candidate) => candidate.id === result.rigId)!;
    const blueprint = state().blueprints.find((candidate) => candidate.id === result.blueprintId)!;
    const graph = state().graphs.find((candidate) => candidate.id === blueprint.graphId)!;

    expect(rig).toMatchObject({ name: 'Pip · Courier animation rig', parentId: playerId });
    expect(player.script?.blueprintId).toBe(result.blueprintId);
    expect(blueprint.folderId).toBe(logicFolder);
    expect(descendants(result.rigId).length).toBeGreaterThanOrEqual(40);
    expect(object('Pip · Left elbow pivot').parentId).toBe(object('Pip · Left shoulder pivot').id);
    expect(object('Pip · Left knee pivot').parentId).toBe(object('Pip · Left hip pivot').id);
    expect(object('Pip · Left mitten').parentId).toBe(object('Pip · Left elbow pivot').id);
    expect(object('Pip · Left little boot').parentId).toBe(object('Pip · Left knee pivot').id);
    expect(object('Pip · Antenna pivot').parentId).toBe(object('Pip · Head pivot').id);
    expect(blueprint.variables?.map((variable) => variable.name)).toEqual(
      expect.arrayContaining([
        'ppc_anim_clock',
        'ppc_anim_state',
        'ppc_anim_seen_pickup',
        'ppc_anim_seen_throw',
        'ppc_anim_gesture_until',
        'ppc_anim_land_until',
        'ppc_anim_airborne',
        'ppc_anim_horizontal_speed',
      ]),
    );
    expect(graph.nodes.some((node) => node.data.nodeKind === 'query.grounded')).toBe(true);
    expect(graph.nodes.some((node) => node.data.nodeKind === 'query.velocity')).toBe(true);
    expect(graph.nodes.some((node) => node.data.nodeKind === 'math.vectorLength')).toBe(true);
    expect(graph.nodes.some((node) => node.data.nodeKind === 'event.update')).toBe(true);
    expect(graph.nodes.some((node) => node.data.nodeKind === 'event.custom' && node.data.eventName === 'PPReset')).toBe(true);
    expect(graph.nodes.some((node) => node.data.nodeKind === 'event.custom' && node.data.eventName === 'PPPause')).toBe(true);
    expect(scanBlueprintGraphProblems(blueprint, graph, state().variables)).toEqual([]);

    // Pip's visible descendants remain individual nested primitives. Static imported-model instancing
    // cannot capture them at their authored pose and bypass their animated parent pivots.
    const visibleParts = descendants(result.rigId).filter((candidate) => candidate.renderer?.enabled);
    expect(visibleParts.length).toBeGreaterThan(30);
    expect(visibleParts.every((candidate) => !candidate.renderer?.modelAssetId && !isInstanceable(candidate))).toBe(true);
  });

  it('publishes readable idle poses that move visible pivot descendants over time', async () => {
    const { playerId, result } = arrangeCourier();
    await play();
    state().setRuntimeVariableByName('PPIntro', false);
    state().setRuntimeVariableByName('PPPlaying', true);
    frames(30);
    expect(runtimeState(playerId)).toBe('idle');

    const visibleParts = descendants(result.rigId).filter((candidate) => candidate.renderer?.enabled);
    expect(visibleParts.every((candidate) => readTransform(candidate.id))).toBe(true);
    const antennaA = relativePosition(playerId, 'Pip · Coral antenna lamp');
    const headA = [...readTransform(object('Pip · Head pivot').id)!.rotation];
    const rigA = [...readTransform(result.rigId)!.position];

    frames(35);
    expect(runtimeState(playerId)).toBe('idle');
    const antennaB = relativePosition(playerId, 'Pip · Coral antenna lamp');
    const headB = readTransform(object('Pip · Head pivot').id)!.rotation;
    const rigB = readTransform(result.rigId)!.position;

    expect(antennaA.distanceTo(antennaB)).toBeGreaterThan(0.025);
    expect(Math.abs(headB[1] - headA[1])).toBeGreaterThan(0.03);
    expect(Math.abs(rigB[1] - rigA[1])).toBeGreaterThan(0.01);
  });

  it('runs intro, idle, pickup, carry, throw, pause, completion and reset states in the real store runtime', async () => {
    const { playerId, result } = arrangeCourier();
    await play();
    expect(runtimeState(playerId)).toBe('gated');

    state().setRuntimeVariableByName('PPIntro', false);
    state().setRuntimeVariableByName('PPPlaying', true);
    frames(24);
    expect(runtimeState(playerId)).toBe('idle');
    expect(objects().find((candidate) => candidate.id === result.rigId)!.transform.position[1]).not.toBe(0);

    state().setRuntimeVariableByName('PPCarry', 'Coral 01');
    state().setRuntimeVariableByName('PPPickupPulse', 1);
    frames(3);
    expect(runtimeState(playerId)).toBe('pickup');
    expect(object('Pip · Left shoulder pivot').transform.rotation[0]).toBeCloseTo((-68 * Math.PI) / 180, 3);
    frames(34);
    expect(runtimeState(playerId)).toBe('carry_idle');
    expect(object('Pip · Left hip pivot').transform.rotation[0]).toBe(0);
    expect(object('Pip · Right hip pivot').transform.rotation[0]).toBe(0);
    expect(object('Pip · Left knee pivot').transform.rotation[0]).toBeCloseTo(
      object('Pip · Right knee pivot').transform.rotation[0],
      8,
    );

    state().setRuntimeVariableByName('PPCarry', '');
    state().setRuntimeVariableByName('PPThrowPulse', 1);
    frames(3);
    expect(runtimeState(playerId)).toBe('throw');
    expect(object('Pip · Right shoulder pivot').transform.rotation[0]).toBeCloseTo((-122 * Math.PI) / 180, 3);

    state().setRuntimeVariableByName('PPPaused', true);
    state().fireCustomEvent('PPPause');
    state().tickRuntime(0);
    expect(runtimeState(playerId)).toBe('gated');
    expect(objects().find((candidate) => candidate.id === result.rigId)!.transform.position).toEqual([0, 0, 0]);
    state().setRuntimeVariableByName('PPPaused', false);

    state().setRuntimeVariableByName('PPPlaying', false);
    state().setRuntimeVariableByName('PPDone', true);
    state().setRuntimeVariableByName('PPDelivered', 5);
    frames(4);
    expect(runtimeState(playerId)).toBe('complete');
    expect(Math.abs(object('Pip · Left shoulder pivot').transform.rotation[2])).toBeGreaterThan(2);

    state().fireCustomEvent('PPReset');
    state().tickRuntime(0);
    expect(runtimeState(playerId)).toBe('reset');
    expect(object('Pip · Right shoulder pivot').transform.rotation[0]).toBe(0);
    expect(objects().find((candidate) => candidate.id === result.rigId)!.transform.scale).toEqual([1, 1, 1]);
  });

  it('derives walk, sprint, jump/fall and landing poses from actual character motion', async () => {
    const { playerId } = arrangeCourier();
    await play();
    state().setRuntimeVariableByName('PPIntro', false);
    state().setRuntimeVariableByName('PPPlaying', true);
    frames(30);
    state().setRuntimeKey('KeyW', true);
    frames(45);
    expect(runtimeState(playerId)).toBe('walk');
    expect(Number(state().runtimeObjectVariables[playerId].ppc_anim_horizontal_speed)).toBeGreaterThan(0.55);
    let leftShoulder = object('Pip · Left shoulder pivot').transform.rotation[0];
    for (let index = 0; index < 12 && Math.abs(leftShoulder) < 0.12; index += 1) {
      frames();
      leftShoulder = object('Pip · Left shoulder pivot').transform.rotation[0];
    }
    const rightShoulder = object('Pip · Right shoulder pivot').transform.rotation[0];
    const leftHip = object('Pip · Left hip pivot').transform.rotation[0];
    const rightHip = object('Pip · Right hip pivot').transform.rotation[0];
    expect(leftShoulder * rightShoulder).toBeLessThan(0);
    expect(leftHip * rightHip).toBeLessThan(0);
    expect(leftShoulder * leftHip).toBeLessThan(0);
    const leftBootA = relativePosition(playerId, 'Pip · Left little boot');
    frames(10);
    expect(relativePosition(playerId, 'Pip · Left little boot').distanceTo(leftBootA)).toBeGreaterThan(0.035);
    state().setRuntimeKey('ShiftLeft', true);
    frames(45);
    expect(runtimeState(playerId)).toBe('sprint');

    state().setRuntimeKey('Space', true);
    frames(5);
    state().setRuntimeKey('Space', false);
    expect(['jump', 'fall']).toContain(runtimeState(playerId));
    state().setRuntimeKey('KeyW', false);
    state().setRuntimeKey('ShiftLeft', false);

    let sawFall = runtimeState(playerId) === 'fall';
    let sawLand = runtimeState(playerId) === 'land';
    for (let index = 0; index < 150 && !sawLand; index += 1) {
      frames();
      sawFall ||= runtimeState(playerId) === 'fall';
      sawLand ||= runtimeState(playerId) === 'land';
    }
    expect(sawFall).toBe(true);
    expect(sawLand).toBe(true);
  });

  it('combines pickup with locomotion, then settles carrying legs when horizontal motion stops', async () => {
    const { playerId } = arrangeCourier();
    await play();
    state().setRuntimeVariableByName('PPIntro', false);
    state().setRuntimeVariableByName('PPPlaying', true);
    state().setRuntimeKey('KeyW', true);
    frames(45);
    expect(runtimeState(playerId)).toBe('walk');

    state().setRuntimeVariableByName('PPCarry', 'Mint parcel');
    state().setRuntimeVariableByName('PPPickupPulse', 1);
    frames(3);
    expect(runtimeState(playerId)).toBe('pickup');
    frames(30);
    expect(runtimeState(playerId)).toBe('carry_walk');
    expect(object('Pip · Left hip pivot').transform.rotation[0] * object('Pip · Right hip pivot').transform.rotation[0]).toBeLessThan(0);

    state().setRuntimeKey('KeyW', false);
    frames(45);
    expect(runtimeState(playerId)).toBe('carry_idle');
    expect(Number(state().runtimeObjectVariables[playerId].ppc_anim_horizontal_speed)).toBeLessThanOrEqual(0.55);
    expect(object('Pip · Left hip pivot').transform.rotation[0]).toBe(0);
    expect(object('Pip · Right hip pivot').transform.rotation[0]).toBe(0);
    expect(object('Pip · Left knee pivot').transform.rotation[0]).toBeCloseTo(
      object('Pip · Right knee pivot').transform.rotation[0],
      8,
    );
  });

  it.each([30, 60, 120])('uses real elapsed time at %i fps and freezes the animation clock while paused', async (fps) => {
    const { playerId } = arrangeCourier();
    await play();
    state().setRuntimeVariableByName('PPIntro', false);
    state().setRuntimeVariableByName('PPPlaying', true);
    const initial = Number(state().runtimeObjectVariables[playerId].ppc_anim_clock);
    for (let index = 0; index < fps; index++) state().tickRuntime(1 / fps);
    expect(Number(state().runtimeObjectVariables[playerId].ppc_anim_clock) - initial).toBeCloseTo(1, 6);
    state().setRuntimeVariableByName('PPPaused', true);
    frames(30);
    expect(Number(state().runtimeObjectVariables[playerId].ppc_anim_clock) - initial).toBeCloseTo(1, 6);
  });

  it('remaps limb targets when the completed player hierarchy becomes a prefab', async () => {
    const { playerId, result } = arrangeCourier();
    const prefabId = state().createPrefabFromObject(playerId, 'Pip · Reusable courier')!;
    const prefab = state().prefabs.find((candidate) => candidate.id === prefabId)!;
    const definitionHead = prefab.objects.find((candidate) => candidate.name === 'Pip · Head pivot')!;
    const blueprint = state().blueprints.find((candidate) => candidate.id === result.blueprintId)!;
    const graph = state().graphs.find((candidate) => candidate.id === blueprint.graphId)!;
    expect(graph.nodes.some((node) => node.data.targetObjectId === definitionHead.id)).toBe(true);
    expect(graph.nodes.some((node) => node.data.targetObjectId === object('Pip · Head pivot').id)).toBe(false);

    const secondPlayer = state().instantiatePrefab(prefabId, { position: [4, 0.15, 0] })!;
    state().updateCharacterController(secondPlayer, { cameraFollow: false });
    await play();
    state().setRuntimeVariableByName('PPIntro', false);
    state().setRuntimeVariableByName('PPPlaying', true);
    frames(24);
    const firstHead = descendants(playerId).find((candidate) => candidate.name === 'Pip · Head pivot')!;
    const secondHead = descendants(secondPlayer).find((candidate) => candidate.name === 'Pip · Head pivot')!;
    expect(Math.abs(firstHead.transform.rotation[2])).toBeGreaterThan(0);
    expect(Math.abs(secondHead.transform.rotation[2])).toBeGreaterThan(0);
    expect(readTransform(firstHead.id)?.rotation).toEqual(firstHead.transform.rotation);
    expect(readTransform(secondHead.id)?.rotation).toEqual(secondHead.transform.rotation);
    expect(objects().some((candidate) => candidate.id === definitionHead.id)).toBe(false);
  });
});
