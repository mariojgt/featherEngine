import type { StoreApi } from 'zustand';
import type { EditorState } from '../editorStore';
import type { ProjectGraph, Scene, SceneObject, ScriptBlueprint, Vector3Tuple } from '../../types';
import { PREFAB_EDIT_SCENE_ID } from '../../types';
import { makeId } from './ids';
import {
  cloneObjectTree,
  cloneObjectTreeWithIdMap,
  collectSubtree,
  deleteWithChildren,
  instantiatePrefabTree,
  mapActiveSceneObjects,
  selectActiveObjects,
} from './storeHelpers';
import { isPrefabInstanceRoot, mergePrefabInstances, prefabWouldCycle } from './prefabMerge';

type SetState = StoreApi<EditorState>['setState'];
type GetState = StoreApi<EditorState>['getState'];

const PREFAB_GRAPH_OBJECT_FIELDS = ['targetObjectId', 'otherObjectId', 'projectileTemplateId'] as const;

const blueprintNeedsObjectRemap = (
  blueprint: ScriptBlueprint,
  graph: ProjectGraph | undefined,
  internalIds: ReadonlySet<string>,
): boolean =>
  Boolean(
    blueprint.variables?.some(
      (variable) => typeof variable.defaultValue === 'string' && internalIds.has(variable.defaultValue),
    ) ||
      graph?.nodes.some((node) =>
        PREFAB_GRAPH_OBJECT_FIELDS.some((field) => {
          const value = node.data[field];
          return typeof value === 'string' && internalIds.has(value);
        }) || (typeof node.data.stringValue === 'string' && internalIds.has(node.data.stringValue)),
      ),
  );

const rewriteBlueprintForPrefab = (
  blueprint: ScriptBlueprint,
  graph: ProjectGraph,
  objectIdMap: ReadonlyMap<string, string>,
  blueprintIdMap: ReadonlyMap<string, string>,
  nextBlueprintId: string,
  nextGraphId: string,
): { blueprint: ScriptBlueprint; graph: ProjectGraph } => {
  const freshGraph = nextGraphId !== graph.id;
  const nodeIdMap = new Map<string, string>();
  if (freshGraph) graph.nodes.forEach((node) => nodeIdMap.set(node.id, makeId('node')));
  const remapObject = (value: string | undefined) =>
    value && objectIdMap.has(value) ? objectIdMap.get(value)! : value;

  const nextGraph: ProjectGraph = {
    ...structuredClone(graph),
    id: nextGraphId,
    nodes: graph.nodes.map((node) => {
      const data = structuredClone(node.data);
      for (const field of PREFAB_GRAPH_OBJECT_FIELDS) {
        const value = data[field];
        if (typeof value === 'string') data[field] = remapObject(value);
      }
      if (typeof data.stringValue === 'string') data.stringValue = remapObject(data.stringValue);
      if (typeof data.castBlueprintId === 'string') {
        data.castBlueprintId = blueprintIdMap.get(data.castBlueprintId) ?? data.castBlueprintId;
      }
      return {
        ...structuredClone(node),
        id: freshGraph ? nodeIdMap.get(node.id)! : node.id,
        data,
      };
    }),
    edges: graph.edges.map((edge) => ({
      ...structuredClone(edge),
      id: freshGraph ? makeId('edge') : edge.id,
      source: freshGraph ? nodeIdMap.get(edge.source) ?? edge.source : edge.source,
      target: freshGraph ? nodeIdMap.get(edge.target) ?? edge.target : edge.target,
    })),
  };

  const nextBlueprint: ScriptBlueprint = {
    ...structuredClone(blueprint),
    id: nextBlueprintId,
    graphId: nextGraphId,
    variables: blueprint.variables?.map((variable) => ({
      ...structuredClone(variable),
      defaultValue:
        typeof variable.defaultValue === 'string'
          ? remapObject(variable.defaultValue) ?? variable.defaultValue
          : variable.defaultValue,
    })),
    // The visual graph is now authoritative. Keeping synchronized source text with old scene ids would
    // let a later recompile resurrect dangling references; external file links must not be duplicated.
    featherSource: undefined,
    featherSourceLastSynced: undefined,
    featherSourcePath: undefined,
    featherSourceLastSyncedHash: undefined,
    featherSourceLastSyncedVisualHash: undefined,
  };
  return { blueprint: nextBlueprint, graph: nextGraph };
};

export const applyCreatePrefabFromObject = (set: SetState, get: GetState, objectId: string, name?: string, folderId?: string): string | undefined => {
  const state = get();
  const objects = selectActiveObjects(state);
  const root = objects.find((object) => object.id === objectId);
  if (!root) return undefined;
  const subtree = collectSubtree(objects, objectId);
  const internalIds = new Set(subtree.map((object) => object.id));
  const { objects: captured, rootId, idMap: objectIdMap } = cloneObjectTree(subtree, objectId);
  const id = makeId('prefab');

  // Cross-object graph ids must become definition-local ids. Mutate a Blueprint in place when this
  // hierarchy is its only runner; clone it when the behavior is also used elsewhere so those users keep
  // their original scene references. Cast dependencies are pulled in when a cloned class id changes.
  const blueprintById = new Map(state.blueprints.map((blueprint) => [blueprint.id, blueprint]));
  const graphById = new Map(state.graphs.map((graph) => [graph.id, graph]));
  const attachedBlueprintIds = new Set(
    subtree.map((object) => object.script?.blueprintId).filter((value): value is string => Boolean(value)),
  );
  const remappedBlueprintIds = new Set<string>();
  for (const blueprintId of attachedBlueprintIds) {
    const blueprint = blueprintById.get(blueprintId);
    if (blueprint && blueprintNeedsObjectRemap(blueprint, graphById.get(blueprint.graphId), internalIds)) {
      remappedBlueprintIds.add(blueprintId);
    }
  }

  const usedOutsideCapture = (blueprintId: string): boolean =>
    state.scenes.some((scene) =>
      scene.objects.some(
        (object) => object.script?.blueprintId === blueprintId && !internalIds.has(object.id),
      ),
    ) ||
    state.prefabs.some((prefab) =>
      prefab.objects.some((object) => object.script?.blueprintId === blueprintId),
    ) ||
    state.uiDocuments.some((document) => document.logicBlueprintId === blueprintId);

  const blueprintIdMap = new Map<string, string>();
  const graphIdMap = new Map<string, string>();
  const allocateBlueprintRemap = (blueprintId: string) => {
    if (blueprintIdMap.has(blueprintId)) return;
    const blueprint = blueprintById.get(blueprintId);
    if (!blueprint) return;
    const cloneForIsolation = usedOutsideCapture(blueprintId);
    blueprintIdMap.set(blueprintId, cloneForIsolation ? makeId('blueprint') : blueprintId);
    graphIdMap.set(blueprint.graphId, cloneForIsolation ? makeId('graph') : blueprint.graphId);
  };
  remappedBlueprintIds.forEach(allocateBlueprintRemap);

  let dependencyAdded = true;
  while (dependencyAdded) {
    dependencyAdded = false;
    for (const blueprintId of attachedBlueprintIds) {
      if (remappedBlueprintIds.has(blueprintId)) continue;
      const blueprint = blueprintById.get(blueprintId);
      const graph = blueprint ? graphById.get(blueprint.graphId) : undefined;
      const needsCastRewrite = graph?.nodes.some((node) => {
        const castId = node.data.castBlueprintId;
        return typeof castId === 'string' && blueprintIdMap.get(castId) !== undefined && blueprintIdMap.get(castId) !== castId;
      });
      if (!needsCastRewrite) continue;
      remappedBlueprintIds.add(blueprintId);
      allocateBlueprintRemap(blueprintId);
      dependencyAdded = true;
    }
  }

  const rewrittenBlueprints = new Map<string, ScriptBlueprint>();
  const rewrittenGraphs = new Map<string, ProjectGraph>();
  for (const blueprintId of remappedBlueprintIds) {
    const blueprint = blueprintById.get(blueprintId);
    const graph = blueprint ? graphById.get(blueprint.graphId) : undefined;
    if (!blueprint || !graph) continue;
    const rewritten = rewriteBlueprintForPrefab(
      blueprint,
      graph,
      objectIdMap,
      blueprintIdMap,
      blueprintIdMap.get(blueprintId) ?? blueprintId,
      graphIdMap.get(graph.id) ?? graph.id,
    );
    rewrittenBlueprints.set(blueprintId, rewritten.blueprint);
    rewrittenGraphs.set(graph.id, rewritten.graph);
  }

  const remapObjectScript = (object: SceneObject): SceneObject => {
    if (!object.script || !blueprintIdMap.has(object.script.blueprintId)) return object;
    return {
      ...object,
      script: {
        ...object.script,
        blueprintId: blueprintIdMap.get(object.script.blueprintId)!,
        graphId: graphIdMap.get(object.script.graphId) ?? object.script.graphId,
      },
    };
  };
  const normalized = captured.map((capturedObject) => {
    const remapped = remapObjectScript(capturedObject);
    const { prefabSourceId: _source, prefabObjectId: _object, ...rest } = remapped;
    return capturedObject.id === rootId ? { ...rest, parentId: undefined } : rest;
  });

  const sourceToPrefabObjectId = objectIdMap;
  const linkedSource = new Map(
    subtree.map((sourceObject) => {
      const remapped = remapObjectScript(sourceObject);
      return [
        sourceObject.id,
        {
          ...remapped,
          prefabSourceId: id,
          prefabObjectId: sourceToPrefabObjectId.get(sourceObject.id),
        } as SceneObject,
      ];
    }),
  );

  set((current) => {
    const blueprints = current.blueprints.map((blueprint) => rewrittenBlueprints.get(blueprint.id) ?? blueprint);
    const graphs = current.graphs.map((graph) => rewrittenGraphs.get(graph.id) ?? graph);
    for (const [oldId, rewritten] of rewrittenBlueprints) {
      if (rewritten.id !== oldId) blueprints.push(rewritten);
    }
    for (const [oldId, rewritten] of rewrittenGraphs) {
      if (rewritten.id !== oldId) graphs.push(rewritten);
    }
    return {
      ...mapActiveSceneObjects(current, (active) =>
        active.map((object) => linkedSource.get(object.id) ?? object),
      ),
      blueprints,
      graphs,
      prefabs: [
        ...current.prefabs,
        { id, name: name ?? `${root.name} Prefab`, folderId, objects: normalized, rootId, createdAt: Date.now() },
      ],
      activeBlueprintId: current.activeBlueprintId
        ? blueprintIdMap.get(current.activeBlueprintId) ?? current.activeBlueprintId
        : current.activeBlueprintId,
      selectedGraphNodeId:
        current.activeBlueprintId && blueprintIdMap.get(current.activeBlueprintId) !== current.activeBlueprintId
          ? undefined
          : current.selectedGraphNodeId,
      prefabThumbnailQueue: [...current.prefabThumbnailQueue, id],
      isDirty: true,
    };
  });
  return id;
};

export const applyRequestPrefabThumbnail = (set: SetState, prefabId: string): void => {
  set((state) =>
    state.prefabThumbnailQueue.includes(prefabId)
      ? state
      : { prefabThumbnailQueue: [...state.prefabThumbnailQueue, prefabId] },
  );
};

export const applySetPrefabThumbnail = (set: SetState, prefabId: string, dataUrl: string): void => {
  set((state) => ({
    prefabs: state.prefabs.map((prefab) => (prefab.id === prefabId ? { ...prefab, thumbnail: dataUrl } : prefab)),
    prefabThumbnailQueue: state.prefabThumbnailQueue.filter((id) => id !== prefabId),
  }));
};

export const applyInstantiatePrefab = (set: SetState, get: GetState, prefabId: string, options: { position?: Vector3Tuple; parentId?: string } = {}): string | undefined => {
  const state = get();
  const prefab = state.prefabs.find((item) => item.id === prefabId);
  if (!prefab || !prefab.objects.length) return undefined;
  if (state.editingPrefabId && prefabWouldCycle(state.prefabs, prefabId, state.editingPrefabId)) {
    console.warn(
      `[Feather] Blocked prefab cycle: "${prefab.name}" contains (or is) the prefab being edited.`,
    );
    return undefined;
  }
  const { objects: clones, rootId } = instantiatePrefabTree(prefab);
  const capturedRoot = prefab.objects.find((object) => object.id === prefab.rootId);
  const activeObjects = selectActiveObjects(state);
  const existing = activeObjects.filter(
    (object) => object.prefabSourceId === prefabId && isPrefabInstanceRoot(activeObjects, object),
  ).length;
  const base = capturedRoot?.transform.position ?? ([0, 0, 0] as Vector3Tuple);
  const spread: Vector3Tuple = [base[0] + existing * 1.2, base[1], base[2] + existing * 1.2];
  const placed = clones.map((object) => {
    if (object.id !== rootId) return object;
    const next: SceneObject = { ...object, parentId: options.parentId, prefabSourceId: prefabId };
    next.transform = { ...object.transform, position: options.position ?? spread };
    return next;
  });
  set((current) => ({
    ...mapActiveSceneObjects(current, (objects) => [...objects, ...placed]),
    selectedObjectId: rootId,
  }));
  return rootId;
};

export const applyOpenPrefabEditor = (set: SetState, prefabId: string): void => {
  set((state) => {
    const prefab = state.prefabs.find((item) => item.id === prefabId);
    if (!prefab) return state;
    if (state.isPlaying) return state;
    if (state.editingPrefabId === prefabId) return state;
    // Switching directly used to save the first edit scene into its asset without propagating that save
    // to placed instances. Require an explicit Close so the normal commit + live-merge path always runs.
    if (state.editingPrefabId) return state;

    const prefabs = state.prefabs;
    const savedPrefab = prefab;

    const editScene: Scene = {
      id: PREFAB_EDIT_SCENE_ID,
      name: `Prefab: ${savedPrefab.name}`,
      objects: structuredClone(savedPrefab.objects),
    };
    const scenes = [...state.scenes.filter((scene) => scene.id !== PREFAB_EDIT_SCENE_ID), editScene];
    return {
      prefabs,
      scenes,
      activeSceneId: PREFAB_EDIT_SCENE_ID,
      editingPrefabId: prefabId,
      prefabReturnSceneId:
        state.activeSceneId === PREFAB_EDIT_SCENE_ID ? state.prefabReturnSceneId : state.activeSceneId,
      selectedObjectId: savedPrefab.rootId,
      isDirty: true,
    };
  });
};

export const applyClosePrefabEditor = (set: SetState, save = true): void => {
  set((state) => {
    const editScene = state.scenes.find((scene) => scene.id === PREFAB_EDIT_SCENE_ID);
    const editingPrefabId = state.editingPrefabId;
    const oldPrefab = editingPrefabId ? state.prefabs.find((p) => p.id === editingPrefabId) : undefined;
    let prefabs = state.prefabs;
    if (save && editScene && editingPrefabId) {
      prefabs = state.prefabs.map((prefab) => {
        if (prefab.id !== editingPrefabId) return prefab;
        const objects = structuredClone(editScene.objects);
        const root =
          objects.find((object) => object.id === prefab.rootId) ?? objects.find((object) => !object.parentId);
        return { ...prefab, objects, rootId: root?.id ?? prefab.rootId };
      });
    }
    const updatedPrefab = editingPrefabId ? prefabs.find((p) => p.id === editingPrefabId) : undefined;
    const scenes = state.scenes
      .filter((scene) => scene.id !== PREFAB_EDIT_SCENE_ID)
      .map((scene) =>
        save && editingPrefabId && updatedPrefab && oldPrefab
          ? { ...scene, objects: mergePrefabInstances(scene.objects, editingPrefabId, oldPrefab, updatedPrefab) }
          : scene,
      );
    const activeSceneId =
      state.prefabReturnSceneId && scenes.some((scene) => scene.id === state.prefabReturnSceneId)
        ? state.prefabReturnSceneId
        : scenes[0]?.id ?? '';
    const activeObjects = scenes.find((scene) => scene.id === activeSceneId)?.objects ?? [];
    const prefabThumbnailQueue =
      save && editingPrefabId && !state.prefabThumbnailQueue.includes(editingPrefabId)
        ? [...state.prefabThumbnailQueue, editingPrefabId]
        : state.prefabThumbnailQueue;
    return {
      scenes,
      prefabs,
      activeSceneId,
      editingPrefabId: null,
      prefabReturnSceneId: null,
      selectedObjectId: activeObjects[0]?.id ?? '',
      prefabThumbnailQueue,
      isDirty: true,
    };
  });
};

export const applyRenamePrefab = (set: SetState, id: string, name: string): void => {
  set((state) => ({
    prefabs: state.prefabs.map((prefab) => (prefab.id === id ? { ...prefab, name } : prefab)),
    isDirty: true,
  }));
};

export const applyDeletePrefab = (set: SetState, id: string): void => {
  set((state) => ({
    prefabs: state.prefabs.filter((prefab) => prefab.id !== id),
    scenes: state.scenes.map((scene) => ({
      ...scene,
      objects: scene.objects.map((object) =>
        object.prefabSourceId === id ? { ...object, prefabSourceId: undefined, prefabObjectId: undefined } : object,
      ),
    })),
    isDirty: true,
  }));
};

export const applyApplyInstanceToPrefab = (set: SetState, get: GetState, objectId: string): string | undefined => {
  const objects = selectActiveObjects(get());
  const instance = objects.find((object) => object.id === objectId);
  if (!isPrefabInstanceRoot(objects, instance)) return undefined;
  const prefabId = instance.prefabSourceId;
  if (!prefabId) return undefined;
  const oldPrefab = get().prefabs.find((prefab) => prefab.id === prefabId);
  if (!oldPrefab) return undefined;
  const subtree = collectSubtree(objects, objectId);
  const idMap = new Map<string, string>();
  for (const o of subtree) idMap.set(o.id, o.prefabObjectId ?? makeId('pfb'));
  const rootId = idMap.get(objectId)!;
  const oldRootTransform = oldPrefab.objects.find((o) => o.id === oldPrefab.rootId)?.transform;
  const { objects: remappedSubtree, rootId: remappedRootId } = cloneObjectTreeWithIdMap(subtree, objectId, idMap);
  const normalized = remappedSubtree.map((object) => {
    const { prefabSourceId: _s, prefabObjectId: _p, ...rest } = object;
    const isRoot = object.id === remappedRootId;
    return {
      ...rest,
      parentId: isRoot ? undefined : object.parentId,
      transform: isRoot && oldRootTransform ? structuredClone(oldRootTransform) : object.transform,
    } as SceneObject;
  });
  const newPrefab = { objects: normalized, rootId };
  set((state) => ({
    prefabs: state.prefabs.map((prefab) => (prefab.id === prefabId ? { ...prefab, ...newPrefab } : prefab)),
    scenes: state.scenes.map((scene) => {
      // The applying instance is excluded from the merge because it is already the desired shape, but
      // any instance-local additions have just become prefab-owned and must receive provenance now.
      const taggedSource = scene.objects.map((object) =>
        idMap.has(object.id)
          ? { ...object, prefabSourceId: prefabId, prefabObjectId: idMap.get(object.id) }
          : object,
      );
      return {
        ...scene,
        objects: mergePrefabInstances(taggedSource, prefabId, oldPrefab, newPrefab, objectId),
      };
    }),
    prefabThumbnailQueue: state.prefabThumbnailQueue.includes(prefabId)
      ? state.prefabThumbnailQueue
      : [...state.prefabThumbnailQueue, prefabId],
    isDirty: true,
  }));
  return prefabId;
};

export const applyRevertInstanceToPrefab = (set: SetState, get: GetState, objectId: string): string | undefined => {
  const state = get();
  const objects = selectActiveObjects(state);
  const instance = objects.find((object) => object.id === objectId);
  if (!isPrefabInstanceRoot(objects, instance)) return undefined;
  const prefab = state.prefabs.find((item) => item.id === instance.prefabSourceId);
  if (!prefab || !prefab.objects.length) return undefined;
  const remaining = deleteWithChildren(objects, objectId);
  const { objects: clones, rootId } = instantiatePrefabTree(prefab);
  const placed = clones.map((object) =>
    object.id === rootId
      ? {
          ...object,
          parentId: instance.parentId,
          prefabSourceId: prefab.id,
          transform: { ...object.transform, position: instance.transform.position },
        }
      : object,
  );
  set((current) => ({
    ...mapActiveSceneObjects(current, () => [...remaining, ...placed]),
    selectedObjectId: rootId,
  }));
  return rootId;
};
