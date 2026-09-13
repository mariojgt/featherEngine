import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { selectActiveObjects, useEditorStore } from '../editorStore';
import { defaultFracture, makeFractureChunks } from '../editor/objectFactory';
import { clearFractureDebris, MAX_FRACTURE_DEBRIS, updateFractureDebris } from '../../runtime/fractureDebris';
import { getModelGeometry } from '../../runtime/meshGeometryCache';
import { getActivePhysics, initRapier } from '../../runtime/physicsWorld';
import type { SceneObject } from '../../types';

const source = (): SceneObject => ({
  id: 'source', name: 'Moving crate', kind: 'cube',
  transform: { position: [2, 5, 3], rotation: [0, Math.PI / 2, 0], scale: [4, 2, 1] },
  fracture: { ...defaultFracture(), pattern: 'uniform', pieces: 2, strength: 0, debrisLifetime: 1 },
});
beforeAll(async () => { await initRapier(); });
beforeEach(() => { useEditorStore.getState().setPlaying(false); clearFractureDebris(); });
afterEach(() => { useEditorStore.getState().setPlaying(false); clearFractureDebris(); });

describe('fracture placement and debris ownership', () => {
  it('preserves rotated grid placement and gives every piece the source velocity', () => {
    const object = source();
    const chunks = makeFractureChunks(object, undefined, [8, 2, -3]);
    expect(chunks).toHaveLength(8);
    const inverse = new THREE.Quaternion().setFromEuler(new THREE.Euler(...object.transform.rotation)).invert();
    for (const chunk of chunks) {
      expect(chunk.transform.rotation).toEqual(object.transform.rotation);
      const local = new THREE.Vector3(...chunk.transform.position).sub(new THREE.Vector3(...object.transform.position)).applyQuaternion(inverse);
      expect(Math.abs(local.x)).toBeCloseTo(1);
      expect(Math.abs(local.y)).toBeCloseTo(0.5);
      expect(Math.abs(local.z)).toBeCloseTo(0.25);
      expect(chunk.variables?.__initialVelocity).toEqual([8, 2, -3]);
    }
    object.fracture!.inheritVelocity = false;
    expect(makeFractureChunks(object, undefined, [8, 0, 0])[0].variables?.__initialVelocity).toBeUndefined();
  });

  it('centres Voronoi bodies on their own geometry and releases meshes at expiry', () => {
    const object = source();
    object.fracture!.pattern = 'chunks';
    const chunks = makeFractureChunks(object);
    expect(chunks.length).toBeGreaterThan(1);
    const keys = chunks.map((chunk) => chunk.renderer!.fragmentKey!);
    for (const key of keys) {
      const vertices = getModelGeometry(key)!.vertices;
      for (let axis = 0; axis < 3; axis++) {
        let sum = 0;
        for (let i = axis; i < vertices.length; i += 3) sum += vertices[i];
        expect(sum / (vertices.length / 3)).toBeCloseTo(0, 5);
      }
    }
    expect(updateFractureDebris(chunks, 0.5)).toHaveLength(chunks.length);
    expect(updateFractureDebris(chunks, 0.6)).toEqual([]);
    for (const key of keys) expect(getModelGeometry(key)).toBeUndefined();
  });

  it('recycles the oldest generated pieces while preserving authored props', () => {
    const object = source();
    const chunks = Array.from({ length: 34 }, () => makeFractureChunks(object)).flat();
    const survivors = updateFractureDebris([object, ...chunks], 0);
    expect(survivors).toHaveLength(MAX_FRACTURE_DEBRIS + 1);
    expect(survivors[0]).toBe(object);
    expect(survivors.slice(1)).toEqual(chunks.slice(-MAX_FRACTURE_DEBRIS));
    expect(updateFractureDebris(survivors, 2)).toEqual([object]);
  });

  it('releases raw meshes when debris is deleted or Play is stopped', () => {
    const object = source(); object.fracture!.pattern = 'chunks';
    const chunks = makeFractureChunks(object);
    const key = chunks[0].renderer!.fragmentKey!;
    updateFractureDebris(chunks.slice(1), 0);
    expect(getModelGeometry(key)).toBeUndefined();
    clearFractureDebris();
    for (const chunk of chunks) expect(getModelGeometry(chunk.renderer!.fragmentKey!)).toBeUndefined();
  });
});

describe('live fracture runtime', () => {
  it('hands motion to real Rapier pieces once, expires them, and restores the source on Stop', async () => {
    const store = useEditorStore.getState();
    for (const object of selectActiveObjects(store)) store.deleteObject(object.id);
    store.updateSceneEnvironment(store.activeSceneId, { gravity: [0, 0, 0] });
    const id = store.createObjectWithProps('cube', { name: 'Flying crate', position: [0, 10, 0], physics: { enabled: true, bodyType: 'dynamic', collider: 'box', linearDamping: 0 } });
    store.setObjectFracture(id, { pattern: 'uniform', pieces: 2, strength: 2, debrisLifetime: 0.5 });
    const { blueprintId } = store.createBlueprintNamed('Break on key', 'Test');
    store.attachScript(id, blueprintId);
    const event = store.addGraphNodeToBlueprint(blueprintId, 'Key Down', 'Events', { keyCode: 'KeyF' });
    const fracture = store.addGraphNodeToBlueprint(blueprintId, 'Fracture', 'Physics');
    store.connectGraphNodes(blueprintId, event, fracture, 'exec-out', 'exec-in');
    store.setPlaying(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getActivePhysics()).toBeTruthy();
    store.tickRuntime(1 / 60);
    getActivePhysics()!.applyImpulse(id, [8, 0, 0]);
    store.tickRuntime(1 / 60);
    const speed = useEditorStore.getState().runtimeVelocities[id][0];
    store.setRuntimeKey('KeyF', true);
    store.tickRuntime(1 / 60);
    store.setRuntimeKey('KeyF', false);
    const chunks = selectActiveObjects(useEditorStore.getState());
    expect(chunks).toHaveLength(8);
    store.tickRuntime(1 / 60);
    const velocities = chunks.map((chunk) => useEditorStore.getState().runtimeVelocities[chunk.id]);
    // The outward kick must survive the hand-off; a late hard velocity set erases this spread.
    expect(Math.max(...velocities.map((v) => v[0])) - Math.min(...velocities.map((v) => v[0]))).toBeGreaterThan(1);
    expect(velocities.reduce((sum, v) => sum + v[0], 0) / chunks.length).toBeGreaterThan(speed * 0.9);
    for (const chunk of chunks) {
      expect(useEditorStore.getState().runtimeVelocities[chunk.id][0]).toBeGreaterThan(speed * 0.7);
      expect(selectActiveObjects(useEditorStore.getState()).find((o) => o.id === chunk.id)?.variables?.__initialVelocity).toBeUndefined();
    }
    for (let i = 0; i < 40; i++) store.tickRuntime(1 / 60);
    expect(selectActiveObjects(useEditorStore.getState())).toEqual([]);
    expect(getActivePhysics()!.getStats().bodies).toBe(0);
    store.setPlaying(false);
    expect(selectActiveObjects(useEditorStore.getState()).map((o) => o.id)).toEqual([id]);
  });
});
