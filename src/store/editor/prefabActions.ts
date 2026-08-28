import type { StoreApi } from 'zustand';
import type { EditorState } from '../editorStore';
import type { Scene, SceneObject, Vector3Tuple } from '../../types';
import { PREFAB_EDIT_SCENE_ID } from '../../types';
import { makeId } from './ids';
import {
  cloneObjectTree,
  collectSubtree,
  deleteWithChildren,
  mapActiveSceneObjects,
  selectActiveObjects,
} from './storeHelpers';
import { mergePrefabInstances, prefabWouldCycle } from './prefabMerge';

type SetState = StoreApi<EditorState>['setState'];
type GetState = StoreApi<EditorState>['getState'];

export const applyCreatePrefabFromObject = (set: SetState, get: GetState, objectId: string, name?: string, folderId?: string): string | undefined => {
  const objects = selectActiveObjects(get());
  const root = objects.find((object) => object.id === objectId);
  if (!root) return undefined;
  const subtree = collectSubtree(objects, objectId);
  const { objects: captured, rootId } = cloneObjectTree(subtree, objectId);
  const normalized = captured.map((object) => {
    const { prefabSourceId: _drop, ...rest } = object;
    return object.id === rootId ? { ...rest, parentId: undefined } : rest;
  });
  const id = makeId('prefab');
  set((state) => ({
    prefabs: [
      ...state.prefabs,
      { id, name: name ?? `${root.name} Prefab`, folderId, objects: normalized, rootId, createdAt: Date.now() },
    ],
    prefabThumbnailQueue: [...state.prefabThumbnailQueue, id],
    isDirty: true,
  }));
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
  const { objects: clones, rootId } = cloneObjectTree(prefab.objects, prefab.rootId);
  clones.forEach((clone, i) => {
    clone.prefabObjectId = prefab.objects[i].id;
    clone.prefabSourceId = prefabId;
  });
  const capturedRoot = prefab.objects.find((object) => object.id === prefab.rootId);
  const existing = selectActiveObjects(state).filter((object) => object.prefabSourceId === prefabId).length;
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

    let prefabs = state.prefabs;
    const openEditScene = state.scenes.find((scene) => scene.id === PREFAB_EDIT_SCENE_ID);
    if (state.editingPrefabId && openEditScene) {
      prefabs = prefabs.map((item) => {
        if (item.id !== state.editingPrefabId) return item;
        const objects = structuredClone(openEditScene.objects);
        const root = objects.find((o) => o.id === item.rootId) ?? objects.find((o) => !o.parentId);
        return { ...item, objects, rootId: root?.id ?? item.rootId };
      });
    }
    const savedPrefab = prefabs.find((item) => item.id === prefabId)!;

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
  if (!instance?.prefabSourceId) return undefined;
  const prefabId = instance.prefabSourceId;
  const oldPrefab = get().prefabs.find((prefab) => prefab.id === prefabId);
  if (!oldPrefab) return undefined;
  const subtree = collectSubtree(objects, objectId);
  const idMap = new Map<string, string>();
  for (const o of subtree) idMap.set(o.id, o.prefabObjectId ?? makeId('pfb'));
  const rootId = idMap.get(objectId)!;
  const oldRootTransform = oldPrefab.objects.find((o) => o.id === oldPrefab.rootId)?.transform;
  const normalized = subtree.map((object) => {
    const { prefabSourceId: _s, prefabObjectId: _p, ...rest } = object;
    const isRoot = object.id === objectId;
    return {
      ...rest,
      id: idMap.get(object.id)!,
      parentId: isRoot ? undefined : object.parentId ? idMap.get(object.parentId) : undefined,
      transform: isRoot && oldRootTransform ? structuredClone(oldRootTransform) : object.transform,
    } as SceneObject;
  });
  const newPrefab = { objects: normalized, rootId };
  set((state) => ({
    prefabs: state.prefabs.map((prefab) => (prefab.id === prefabId ? { ...prefab, ...newPrefab } : prefab)),
    scenes: state.scenes.map((scene) => ({
      ...scene,
      objects: mergePrefabInstances(scene.objects, prefabId, oldPrefab, newPrefab, objectId),
    })),
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
  if (!instance?.prefabSourceId) return undefined;
  const prefab = state.prefabs.find((item) => item.id === instance.prefabSourceId);
  if (!prefab || !prefab.objects.length) return undefined;
  const remaining = deleteWithChildren(objects, objectId);
  const { objects: clones, rootId } = cloneObjectTree(prefab.objects, prefab.rootId);
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
