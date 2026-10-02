import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initRapier } from '../../runtime/physicsWorld';
import { getModelGeometry } from '../../runtime/meshGeometryCache';
import { waterAnimationTime } from '../../runtime/waterAnimation';
import { selectActiveObjects, useEditorStore } from '../../store/editorStore';
import { waterSurfaceHeight } from '../../store/editor/runtimeHelpers';
import { buildPackage, remapPackageForImport } from '../package';
import { blankProject } from '../serialize';
import { createCrystalSliceTemplate } from '../crystalSliceTemplate';

const state = () => useEditorStore.getState();
const objects = () => selectActiveObjects(state());
const advance = (seconds: number) => {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) state().tickRuntime(1 / 60);
};
beforeAll(async () => { await initRapier(); });
beforeEach(() => {
  state().setPlaying(false);
  state().loadProject(blankProject('Crystal test'));
});
afterEach(() => { state().setPlaying(false); });

describe('Crystal Slice cinematic', () => {
  it('packages an editable loop with valid remapped object and material references', async () => {
    await createCrystalSliceTemplate();
    const collected = state().buildProjectPackage();
    const pkg = buildPackage('project', collected.content, [], { id: 'crystal-test', name: 'Crystal', version: '1.0.0' });
    const { content } = remapPackageForImport(JSON.parse(JSON.stringify(pkg)), [], []);
    const scene = content.scenes![0];
    const ids = new Set(scene.objects.map(o => o.id));
    const materials = new Set(content.materials!.map(m => m.id));
    expect(scene.cinematics![0].loop).toBe(true);
    expect(scene.cinematics![0].duration).toBe(12);
    for (const action of scene.cinematics![0].actions) {
      if (action.objectId) expect(ids.has(action.objectId)).toBe(true);
    }
    for (const object of scene.objects) {
      if (object.parentId) expect(ids.has(object.parentId)).toBe(true);
      if (object.renderer?.materialId) expect(materials.has(object.renderer.materialId)).toBe(true);
    }
    expect(state().assets).toHaveLength(0);
  });

  it('starts solid, cuts new closed meshes, and releases pieces that collide and enter water', async () => {
    await createCrystalSliceTemplate();
    const authored = structuredClone(objects());
    const stock = objects().find(o => o.cutting?.role === 'stock')!;
    expect(objects().filter(o => o.variables?.__cutStock)).toHaveLength(0);
    expect(state().scenes[0].cinematics![0].actions.filter(a => a.type === 'transform')).toHaveLength(1);
    state().setPlaying(true);
    await new Promise(resolve => setTimeout(resolve, 0));
    const collisions = new Set<string>();
    const wet = new Set<string>();
    let hitFloor = false, hitAnotherPiece = false;
    for (let i = 0; i < 600; i++) {
      state().tickRuntime(1 / 60);
      for (const c of state().runtimeCollisions) {
        collisions.add(c.objectId).add(c.otherObjectId);
        const pair = [c.objectId, c.otherObjectId].map(id => objects().find(o => o.id === id));
        if (pair.some(o => o?.variables?.__cutStock) && pair.some(o => o?.name.includes('collision floor'))) hitFloor = true;
        if (pair.every(o => o?.variables?.__cutStock)) hitAnotherPiece = true;
      }
      for (const id of state().runtimeInWater) wet.add(id);
    }
    const pieces = objects().filter(o => o.variables?.__cutStock === stock.id);
    expect(pieces).toHaveLength(8);
    expect(hitFloor).toBe(true);
    expect(hitAnotherPiece).toBe(true);
    expect(pieces.every(o => o.variables?.__cutReleased && o.physics?.bodyType === 'dynamic')).toBe(true);
    expect(pieces.every(o => o.renderer?.materialId === stock.renderer?.materialId)).toBe(true);
    expect(pieces.filter(o => o.transform.position[1] < 0.7).length).toBeGreaterThan(3);
    expect(pieces.filter(o => collisions.has(o.id)).length).toBeGreaterThan(3);
    expect(pieces.filter(o => wet.has(o.id)).length).toBeGreaterThan(3);
    const keys = pieces.map(o => o.renderer!.fragmentKey!);
    for (const o of pieces) {
      const mesh = getModelGeometry(o.renderer!.fragmentKey)!;
      expect(mesh.vertices.length).toBeGreaterThan(30);
      expect(mesh.normals!.length).toBe(mesh.vertices.length);
      expect([...mesh.vertices].every(Number.isFinite)).toBe(true);
    }
    advance(2);
    expect(objects().filter(o => o.variables?.__cutStock)).toHaveLength(0);
    expect(objects().find(o => o.id === stock.id)!.renderer?.fragmentKey).toBeUndefined();
    expect(keys.every(key => !getModelGeometry(key))).toBe(true);
    advance(2);
    expect(objects().filter(o => o.variables?.__cutStock).length).toBeGreaterThan(0);
    state().setPlaying(false);
    expect(objects()).toEqual(authored);
    expect(state().runtimeCinematicCamera).toBeUndefined();
  });

  it('does not cut when the blade misses, even while the same cinematic plays', async () => {
    const id = await createCrystalSliceTemplate();
    const seq = state().scenes[0].cinematics!.find(s => s.id === id)!;
    for (const a of seq.actions.filter(a => a.type === 'transform')) {
      state().updateCinematicAction(id, a.id, { transformKeyframes: a.transformKeyframes!.map(k => ({ ...k,
        position: [k.position![0], k.position![1], k.position![2] + 6] as [number, number, number] })) });
    }
    state().setPlaying(true);
    advance(10);
    expect(objects().filter(o => o.variables?.__cutStock)).toHaveLength(0);
    expect(objects().find(o => o.cutting?.role === 'stock')!.renderer?.fragmentKey).toBeUndefined();
  });

  it('keeps a partial cut clamped until the edge clears the bottom', async () => {
    const id = await createCrystalSliceTemplate();
    const seq = state().scenes[0].cinematics!.find(s => s.id === id)!;
    const blade = objects().find(o => o.cutting?.role === 'blade')!;
    for (const a of seq.actions.filter(a => a.type === 'transform')) state().removeCinematicAction(id, a.id);
    state().setPlaying(true);
    await new Promise(resolve => setTimeout(resolve, 0));
    state().tickRuntime(1 / 60);
    state().updateTransform(blade.id, 'position', [-1.96, 3.0, 0.45]);
    state().tickRuntime(1 / 60);
    const partial = objects().find(o => o.variables?.__cutStock)!;
    expect(partial).toBeDefined();
    expect(partial.physics!.bodyType).toBe('fixed');
    advance(0.5);
    expect(objects().find(o => o.id === partial.id)!.transform.position).toEqual(partial.transform.position);
    state().updateTransform(blade.id, 'position', [-1.96, 1.27, 0.45]);
    state().tickRuntime(1 / 60);
    expect(objects().find(o => o.id === partial.id)!.physics!.bodyType).toBe('dynamic');
    advance(1);
    expect(objects().find(o => o.id === partial.id)!.transform.position[1]).toBeLessThan(partial.transform.position[1] - 0.1);
  });

  it('obeys scene gravity rather than animated piece poses', async () => {
    const id = await createCrystalSliceTemplate();
    state().updateSceneEnvironment(state().activeSceneId, { gravity: [0, 0, 0] });
    state().setPlaying(true);
    await new Promise(resolve => setTimeout(resolve, 0));
    advance(1.4);
    const piece = objects().find(o => o.variables?.__cutReleased)!;
    expect(piece).toBeDefined();
    const seq = state().scenes[0].cinematics!.find(s => s.id === id)!;
    for (const a of seq.actions.filter(a => a.type === 'transform')) state().removeCinematicAction(id, a.id);
    state().updatePhysics(objects().find(o => o.cutting?.role === 'blade')!.id, { enabled: false });
    const startY = piece.transform.position[1];
    advance(1);
    expect(objects().find(o => o.id === piece.id)!.transform.position[1]).toBeCloseTo(startY, 4);
    state().updateSceneEnvironment(state().activeSceneId, { gravity: [0, -9.81, 0] });
    advance(1);
    expect(objects().find(o => o.id === piece.id)!.transform.position[1]).toBeLessThan(startY - 0.1);
  });

  it('preserves overshoot, replays start/end cues once and cleans up cycle-owned spawns', async () => {
    const id = await createCrystalSliceTemplate();
    state().addCinematicAction(id, { type: 'event', time: 0, duration: 0, eventName: 'start' });
    state().addCinematicAction(id, { type: 'event', time: 11.95, duration: 0, eventName: 'end' });
    state().addCinematicAction(id, { type: 'spawn', time: 0, spawnKind: 'sphere', name: 'Cycle prop' });
    state().setPlaying(true);
    state().tickRuntime(0);
    expect(state().runtimeEventQueue).toEqual(['start']);
    useEditorStore.setState({ runtimeCinematic: { ...state().runtimeCinematic!, time: 11.9 } });
    state().tickRuntime(0.2);
    expect(state().runtimeCinematic!.time).toBeCloseTo(0.1, 9);
    expect(state().runtimeEventQueue).toEqual(['end', 'start']);
    expect(objects().filter(o => o.name === 'Cycle prop')).toHaveLength(1);
    state().tickRuntime(0.01);
    expect(state().runtimeEventQueue).toEqual([]);
    useEditorStore.setState({ runtimeCinematic: { ...state().runtimeCinematic!, time: 11.9 } });
    state().tickRuntime(24.2);
    expect(state().runtimeCinematic!.time).toBeCloseTo(0.1, 9);
    expect(state().runtimeEventQueue).toEqual(['end', 'start', 'end', 'start', 'end', 'start']);
    expect(objects().filter(o => o.name === 'Cycle prop')).toHaveLength(1);
  });

  it('keeps ordinary cinematics one-shot', async () => {
    const id = await createCrystalSliceTemplate();
    state().updateCinematic(id, { loop: false });
    state().setPlaying(true);
    useEditorStore.setState({ runtimeCinematic: { ...state().runtimeCinematic!, time: 11.9 } });
    state().tickRuntime(0.2);
    expect(state().runtimeCinematic).toBeUndefined();
    expect(state().runtimeCinematicCamera).toBeUndefined();
  });

  it('repeats water height and velocity continuously while preserving legacy water time', async () => {
    await createCrystalSliceTemplate();
    const water = objects().find(o => o.water?.enabled)!.water!;
    const height = (t: number) => waterSurfaceHeight(water, 1.2, -0.7, t);
    expect(height(0)).toBeCloseTo(height(12), 12);
    expect(height(3.4)).toBeCloseTo(height(15.4), 12);
    const epsilon = 1e-5;
    expect((height(12) - height(12 - epsilon)) / epsilon).toBeCloseTo((height(epsilon) - height(0)) / epsilon, 6);
    expect(waterAnimationTime(11.4)).toBe(11.4);
    expect(waterAnimationTime(11.4, 0)).toBe(11.4);
    expect(waterAnimationTime(11.4, Infinity)).toBe(11.4);
  });
});
