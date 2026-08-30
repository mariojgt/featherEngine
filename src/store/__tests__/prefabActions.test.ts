import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildPackage, remapPackageForImport } from '../../project/package';
import { blankProject } from '../../project/serialize';
import type { SceneObject } from '../../types';
import { selectActiveObjects, useEditorStore } from '../editorStore';

const editor = () => useEditorStore.getState();

const subtreeOf = (objects: SceneObject[], rootId: string): SceneObject[] => {
  const ids = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const object of objects) {
      if (object.parentId && ids.has(object.parentId) && !ids.has(object.id)) {
        ids.add(object.id);
        changed = true;
      }
    }
  }
  return objects.filter((object) => ids.has(object.id));
};

const makeAnimatedRig = () => {
  const rootId = editor().createObjectWithProps('empty', {
    name: 'Reusable Hero',
    position: [1, 0, 2],
  });
  const childId = editor().createObjectWithProps('cube', {
    name: 'Hero Arm',
    position: [0.5, 1, 0],
    parentId: rootId,
  });
  const { blueprintId } = editor().createBlueprintNamed('Reusable Hero Motion', 'Prefab target test');
  const compiled = editor().applyBlueprintFeatherSource(
    blueprintId,
    [
      'blueprint Reusable_Hero_Motion',
      '',
      'on start:',
      `    set_rotation("${childId}", vec3(0, 0, 35))`,
    ].join('\n'),
  );
  expect(compiled.ok).toBe(true);
  editor().attachScript(rootId, blueprintId);
  const prefabId = editor().createPrefabFromObject(rootId, 'Reusable Hero');
  expect(prefabId).toBeTruthy();
  return { rootId, childId, prefabId: prefabId!, blueprintId };
};

describe('live-linked prefab instances', () => {
  beforeEach(() => {
    editor().setPlaying(false);
    editor().loadProject(blankProject('Prefab Test'));
  });

  afterEach(() => {
    editor().setPlaying(false);
    editor().loadProject(blankProject('Prefab Cleanup'));
  });

  it('links the authored hierarchy and resolves definition targets inside each instance', () => {
    const { rootId, childId, prefabId, blueprintId } = makeAnimatedRig();
    const authored = editor();
    const prefab = authored.prefabs.find((item) => item.id === prefabId)!;
    const definitionChild = prefab.objects.find((object) => object.name === 'Hero Arm')!;
    const sourceRoot = selectActiveObjects(authored).find((object) => object.id === rootId)!;
    const sourceChild = selectActiveObjects(authored).find((object) => object.id === childId)!;

    expect(sourceRoot).toMatchObject({ prefabSourceId: prefabId, prefabObjectId: prefab.rootId });
    expect(sourceChild).toMatchObject({ prefabSourceId: prefabId, prefabObjectId: definitionChild.id });
    const blueprint = authored.blueprints.find((item) => item.id === blueprintId)!;
    const graph = authored.graphs.find((item) => item.id === blueprint.graphId)!;
    expect(graph.nodes.some((node) => node.data.targetObjectId === definitionChild.id)).toBe(true);
    expect(graph.nodes.some((node) => node.data.targetObjectId === childId)).toBe(false);
    expect(blueprint.featherSource).toBeUndefined();

    const secondRootId = authored.instantiatePrefab(prefabId, { position: [8, 0, 2] })!;
    const secondChild = subtreeOf(selectActiveObjects(editor()), secondRootId).find(
      (object) => object.prefabObjectId === definitionChild.id,
    )!;

    editor().setPlaying(true);
    editor().tickRuntime(0);
    const liveObjects = selectActiveObjects(editor());
    expect(Math.abs(liveObjects.find((object) => object.id === childId)!.transform.rotation[2])).toBeGreaterThan(0.1);
    expect(Math.abs(liveObjects.find((object) => object.id === secondChild.id)!.transform.rotation[2])).toBeGreaterThan(0.1);
    expect(liveObjects.some((object) => object.id === definitionChild.id)).toBe(false);
  });

  it('propagates prefab edits deeply, preserves overrides/placement, and fully retags revert', () => {
    const rootId = editor().createObjectWithProps('empty', { name: 'Robot', position: [2, 0, 0] });
    const childId = editor().createObjectWithProps('cube', {
      name: 'Robot Body',
      position: [0, 1, 0],
      parentId: rootId,
    });
    const prefabId = editor().createPrefabFromObject(rootId, 'Robot')!;
    const prefab = editor().prefabs.find((item) => item.id === prefabId)!;
    const definitionChild = prefab.objects.find((object) => object.name === 'Robot Body')!;
    const secondRootId = editor().instantiatePrefab(prefabId, { position: [10, 0, 0] })!;
    const secondChildId = subtreeOf(selectActiveObjects(editor()), secondRootId).find(
      (object) => object.prefabObjectId === definitionChild.id,
    )!.id;

    editor().updateRenderer(childId, { color: '#112233' });
    editor().openPrefabEditor(prefabId);
    editor().updateRenderer(definitionChild.id, { color: '#abcdef', roughness: 0.27 });
    editor().updateTransform(definitionChild.id, 'scale', [1.5, 2, 0.75]);
    editor().updateTransform(prefab.rootId, 'rotation', [0, 0.4, 0]);
    const antennaDefinitionId = editor().createObjectWithProps('sphere', {
      name: 'Robot Antenna',
      position: [0, 2, 0],
      parentId: prefab.rootId,
    });
    editor().closePrefabEditor(true);

    const merged = selectActiveObjects(editor());
    expect(merged.find((object) => object.id === childId)?.renderer).toMatchObject({
      color: '#112233',
      roughness: 0.27,
    });
    expect(merged.find((object) => object.id === secondChildId)?.renderer).toMatchObject({
      color: '#abcdef',
      roughness: 0.27,
    });
    expect(merged.find((object) => object.id === childId)?.transform.scale).toEqual([1.5, 2, 0.75]);
    expect(merged.find((object) => object.id === secondChildId)?.transform.scale).toEqual([1.5, 2, 0.75]);
    expect(merged.find((object) => object.id === rootId)?.transform.position).toEqual([2, 0, 0]);
    expect(merged.find((object) => object.id === secondRootId)?.transform.position).toEqual([10, 0, 0]);
    expect(merged.find((object) => object.id === rootId)?.transform.rotation).toEqual([0, 0.4, 0]);
    expect(merged.find((object) => object.id === secondRootId)?.transform.rotation).toEqual([0, 0.4, 0]);
    expect(
      subtreeOf(merged, rootId).some(
        (object) => object.name === 'Robot Antenna' && object.prefabObjectId === antennaDefinitionId,
      ),
    ).toBe(true);
    expect(
      subtreeOf(merged, secondRootId).some(
        (object) => object.name === 'Robot Antenna' && object.prefabObjectId === antennaDefinitionId,
      ),
    ).toBe(true);

    // Children carry provenance for targeting/merge, but only the instance root may Apply/Revert.
    expect(editor().applyInstanceToPrefab(secondChildId)).toBeUndefined();
    expect(editor().revertInstanceToPrefab(secondChildId)).toBeUndefined();

    editor().updateTransform(secondChildId, 'scale', [9, 9, 9]);
    const revertedRootId = editor().revertInstanceToPrefab(secondRootId)!;
    const reverted = subtreeOf(selectActiveObjects(editor()), revertedRootId);
    expect(reverted.every((object) => object.prefabSourceId === prefabId && object.prefabObjectId)).toBe(true);
    expect(reverted.find((object) => object.name === 'Robot Body')?.transform.scale).toEqual([1.5, 2, 0.75]);
    expect(reverted.find((object) => object.id === revertedRootId)?.transform.position).toEqual([10, 0, 0]);

    editor().openPrefabEditor(prefabId);
    editor().updateTransform(antennaDefinitionId, 'scale', [0.4, 1.2, 0.4]);
    editor().closePrefabEditor(true);
    expect(
      subtreeOf(selectActiveObjects(editor()), revertedRootId).find((object) => object.name === 'Robot Antenna')
        ?.transform.scale,
    ).toEqual([0.4, 1.2, 0.4]);
  });

  it('adopts instance-local children on Apply and keeps them linked without duplication', () => {
    const rootId = editor().createObjectWithProps('empty', { name: 'Drone', position: [0, 0, 0] });
    editor().createObjectWithProps('cube', { name: 'Drone Core', position: [0, 1, 0], parentId: rootId });
    const prefabId = editor().createPrefabFromObject(rootId, 'Drone')!;
    const secondRootId = editor().instantiatePrefab(prefabId, { position: [6, 0, 0] })!;
    const localWingId = editor().createObjectWithProps('cube', {
      name: 'Drone Wing',
      position: [1, 1, 0],
      parentId: rootId,
    });

    expect(editor().applyInstanceToPrefab(rootId)).toBe(prefabId);
    const appliedPrefab = editor().prefabs.find((item) => item.id === prefabId)!;
    const wingDefinition = appliedPrefab.objects.find((object) => object.name === 'Drone Wing')!;
    expect(wingDefinition).toBeDefined();
    expect(selectActiveObjects(editor()).find((object) => object.id === localWingId)).toMatchObject({
      prefabSourceId: prefabId,
      prefabObjectId: wingDefinition.id,
    });
    expect(subtreeOf(selectActiveObjects(editor()), secondRootId).filter((object) => object.name === 'Drone Wing')).toHaveLength(1);

    editor().openPrefabEditor(prefabId);
    editor().updateTransform(wingDefinition.id, 'scale', [2, 0.3, 0.8]);
    editor().closePrefabEditor(true);
    for (const instanceRootId of [rootId, secondRootId]) {
      const wings = subtreeOf(selectActiveObjects(editor()), instanceRootId).filter(
        (object) => object.name === 'Drone Wing',
      );
      expect(wings).toHaveLength(1);
      expect(wings[0].transform.scale).toEqual([2, 0.3, 0.8]);
    }
  });

  it('stamps runtime-spawned trees and keeps prefab-local graph targets valid after package remapping', () => {
    const { rootId, prefabId } = makeAnimatedRig();
    const spawnerId = editor().createObjectWithProps('empty', { name: 'Hero Spawner', position: [12, 0, 0] });
    const { blueprintId: spawnerBlueprintId } = editor().createBlueprintNamed('Hero Spawner', 'Runtime prefab test');
    const compiled = editor().applyBlueprintFeatherSource(
      spawnerBlueprintId,
      [
        'blueprint Hero_Spawner',
        '',
        'on start:',
        `    spawn_prefab("${prefabId}", location: self.position)`,
      ].join('\n'),
    );
    expect(compiled.ok).toBe(true);
    editor().attachScript(spawnerId, spawnerBlueprintId);

    editor().setPlaying(true);
    editor().tickRuntime(0);
    const afterSpawn = selectActiveObjects(editor());
    const spawnedRoot = afterSpawn.find(
      (object) => object.id !== rootId && object.prefabSourceId === prefabId && object.prefabObjectId === editor().prefabs[0].rootId,
    )!;
    expect(spawnedRoot).toBeDefined();
    expect(
      subtreeOf(afterSpawn, spawnedRoot.id).every(
        (object) => object.prefabSourceId === prefabId && Boolean(object.prefabObjectId),
      ),
    ).toBe(true);
    editor().tickRuntime(0);
    const spawnedChild = subtreeOf(selectActiveObjects(editor()), spawnedRoot.id).find((object) => object.name === 'Hero Arm')!;
    expect(Math.abs(spawnedChild.transform.rotation[2])).toBeGreaterThan(0.1);

    editor().setPlaying(false);
    const collected = editor().buildProjectPackage();
    const pkg = buildPackage('project', collected.content, [], {
      id: 'prefab-round-trip',
      name: 'Prefab Round Trip',
      version: '1.0.0',
    });
    const imported = remapPackageForImport(pkg).content;
    const importedPrefab = imported.prefabs.find((item) => item.name === 'Reusable Hero')!;
    const importedChild = importedPrefab.objects.find((object) => object.name === 'Hero Arm')!;
    const importedRoot = importedPrefab.objects.find((object) => object.id === importedPrefab.rootId)!;
    const importedBlueprint = imported.blueprints.find((item) => item.id === importedRoot.script?.blueprintId)!;
    const importedGraph = imported.graphs.find((item) => item.id === importedBlueprint.graphId)!;
    expect(importedGraph.nodes.some((node) => node.data.targetObjectId === importedChild.id)).toBe(true);
    expect(
      imported.scenes?.[0].objects.some(
        (object) =>
          object.prefabSourceId === importedPrefab.id && object.prefabObjectId === importedPrefab.rootId,
      ),
    ).toBe(true);
  });
});
