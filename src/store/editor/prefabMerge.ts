import type { Prefab, SceneObject } from '../../types';
import { makeId } from './ids';

/**
 * True if stamping prefab `candidateId` inside prefab `hostId` would create a containment cycle —
 * i.e. the candidate's stored objects (transitively, through nested-instance `prefabSourceId` tags)
 * contain an instance of the host. A then contains A, which corrupts every future restamp/merge.
 */
export const prefabWouldCycle = (prefabs: Prefab[], candidateId: string, hostId: string): boolean => {
  const visited = new Set<string>();
  const queue = [candidateId];
  while (queue.length) {
    const id = queue.pop()!;
    if (id === hostId) return true;
    if (visited.has(id)) continue;
    visited.add(id);
    const prefab = prefabs.find((p) => p.id === id);
    for (const object of prefab?.objects ?? []) {
      if (object.prefabSourceId && !visited.has(object.prefabSourceId)) queue.push(object.prefabSourceId);
    }
  }
  return false;
};

/** Structural fields a prefab merge never copies from the prefab — they define identity/hierarchy. */
export const PREFAB_STRUCT_KEYS = new Set(['id', 'parentId', 'prefabSourceId', 'prefabObjectId']);
export const prefabFieldEqual = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Propagate a prefab edit into every placed instance with a Unity-style **3-way merge** that PRESERVES
 * per-instance overrides. For each instance object (matched to its prefab object by `prefabObjectId`):
 * a field that differs from the OLD prefab is an instance override → kept; otherwise it takes the NEW
 * prefab's value (so prefab edits flow through). Objects the prefab edit ADDED appear in instances;
 * objects the instance DELETED stay deleted; objects the user ADDED to an instance (no prefabObjectId)
 * are preserved. The instance root keeps its world placement (parent) automatically (its transform is an
 * override vs the prefab root). `exceptRootId` leaves one instance untouched (the source of an apply).
 */
export const mergePrefabInstances = (
  objects: SceneObject[],
  prefabId: string,
  oldPrefab: { objects: SceneObject[]; rootId: string },
  newPrefab: { objects: SceneObject[]; rootId: string },
  exceptRootId?: string,
): SceneObject[] => {
  const tagged = objects.filter((o) => o.prefabSourceId === prefabId);
  if (tagged.length === 0) return objects;
  const taggedIds = new Set(tagged.map((o) => o.id));
  // Instance roots: a prefab-tagged object whose parent isn't part of the same prefab instance.
  const roots = objects.filter(
    (o) => o.prefabSourceId === prefabId && (!o.parentId || !taggedIds.has(o.parentId)) && o.id !== exceptRootId,
  );
  if (roots.length === 0) return objects;

  const childrenOf = new Map<string, SceneObject[]>();
  for (const o of objects) {
    if (!o.parentId) continue;
    (childrenOf.get(o.parentId) ?? childrenOf.set(o.parentId, []).get(o.parentId)!).push(o);
  }
  const oldById = new Map(oldPrefab.objects.map((o) => [o.id, o]));
  const newByPid = newPrefab.objects;

  const rebuildIds = new Set<string>();
  const out: SceneObject[] = [];

  for (const root of roots) {
    // Full subtree of this instance (includes user-added children that lack a prefab link).
    const subtree: SceneObject[] = [];
    const walk = (o: SceneObject) => {
      subtree.push(o);
      rebuildIds.add(o.id);
      for (const c of childrenOf.get(o.id) ?? []) walk(c);
    };
    walk(root);

    const instByPid = new Map<string, SceneObject>();
    const localAdds: SceneObject[] = [];
    for (const o of subtree) {
      if (o.prefabObjectId) instByPid.set(o.prefabObjectId, o);
      else if (o.id !== root.id) localAdds.push(o); // user-added object inside the instance — keep it
    }

    // Resolve the surviving instance id for every prefab object (existing kept, prefab-added = fresh).
    const pidToId = new Map<string, string>();
    for (const np of newByPid) {
      const existing = instByPid.get(np.id);
      if (existing) pidToId.set(np.id, existing.id);
      else if (!oldById.has(np.id)) pidToId.set(np.id, makeId('obj')); // newly added by the prefab edit
      // else: was in the old prefab but not in this instance → the user deleted it → skip
    }

    for (const np of newByPid) {
      const id = pidToId.get(np.id);
      if (!id) continue;
      const existing = instByPid.get(np.id);
      const oldp = oldById.get(np.id);
      const isRoot = np.id === newPrefab.rootId;
      const merged = structuredClone(np) as unknown as Record<string, unknown>;
      if (existing) {
        const ex = existing as unknown as Record<string, unknown>;
        const oldRec = oldp as unknown as Record<string, unknown> | undefined;
        const keys = new Set([...Object.keys(np), ...Object.keys(existing)]);
        for (const key of keys) {
          if (PREFAB_STRUCT_KEYS.has(key)) continue;
          // Override = the instance value differs from what the prefab used to have → keep the instance's.
          if (!prefabFieldEqual(ex[key], oldRec?.[key])) merged[key] = ex[key];
        }
      }
      merged.id = id;
      merged.prefabObjectId = np.id;
      merged.prefabSourceId = prefabId;
      merged.parentId = isRoot
        ? (existing?.parentId ?? root.parentId) // root keeps its world placement parent
        : np.parentId
          ? pidToId.get(np.parentId) // internal node → its prefab-parent's surviving instance id
          : undefined;
      out.push(merged as unknown as SceneObject);
    }
    out.push(...localAdds); // user additions keep their ids/parents (which still resolve)
  }

  // Everything not part of a rebuilt instance (other objects, skipped instances) passes through unchanged.
  for (const o of objects) if (!rebuildIds.has(o.id)) out.push(o);
  return out;
};
