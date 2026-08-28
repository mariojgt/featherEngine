import type {
  AnimationAsset,
  AnimatorController,
  AssetItem,
  DataAsset,
  DataAssetColumn,
  DataAssetRow,
  Prefab,
  ProjectVariable,
  Scene,
  SceneEnvironmentSettings,
  SceneObject,
  ScriptBlueprint,
  Vector3Tuple,
} from '../../types';
import { createArrayIndexer } from './arrayIndex';
import { makeId } from './ids';
import { buildNavGrid, type NavGrid, type NavObstacle } from '../../runtime/navGrid';

/** Minimal structural slice of the store that the pure selectors in this module read. */
export interface EditorStateLike {
  scenes: Scene[];
  activeSceneId: string;
  selectedObjectId: string;
  selectedObjectIds: string[];
}

// Per-frame lookup Maps over project-level arrays. The arrays are replaced
// immutably only on edit, so these WeakMap-cached indexers return the same Map
// across Play frames instead of rebuilding it 60×/s (see tickRuntime).
export const indexVariablesById = createArrayIndexer((v: ProjectVariable) => v.id);
export const indexVariablesByName = createArrayIndexer((v: ProjectVariable) => v.name);
export const indexDataAssetsById = createArrayIndexer((a: DataAsset) => a.id);
export const indexPrefabsById = createArrayIndexer((p: Prefab) => p.id);
export const indexControllersById = createArrayIndexer((c: AnimatorController) => c.id);
export const indexAnimationsById = createArrayIndexer((a: AnimationAsset) => a.id);
export const indexAssetsByName = createArrayIndexer((a: AssetItem) => a.name);
export const indexBlueprintsById = createArrayIndexer((b: ScriptBlueprint) => b.id);
export const indexSceneObjectsById = createArrayIndexer((o: SceneObject) => o.id);
// Data-table lookups, cached by the columns/rows array identity (those arrays are replaced only when
// the table is edited). A `data.tableGet` node inside an Update loop previously re-scanned the whole
// table every frame with two `.find()`s.
export const indexTableColumnsById = createArrayIndexer((c: DataAssetColumn) => c.id);
export const indexTableRowsByKey = createArrayIndexer((r: DataAssetRow) => r.key);

/** Collect `rootId` plus every descendant (following parentId), preserving document order. */
export const collectSubtree = (objects: SceneObject[], rootId: string): SceneObject[] => {
  const ids = new Set<string>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    objects.forEach((object) => {
      if (object.parentId && ids.has(object.parentId) && !ids.has(object.id)) {
        ids.add(object.id);
        changed = true;
      }
    });
  }
  return objects.filter((object) => ids.has(object.id));
};

/**
 * Deep-clone a self-contained object tree with fresh ids, remapping every INTERNAL reference
 * (parentId + the cross-object id fields attachment/viewModel hold) from old → new. References that
 * point outside the tree are left untouched. Returns the cloned objects and the new root id.
 */
export const cloneObjectTree = (
  tree: SceneObject[],
  rootId: string,
): { objects: SceneObject[]; rootId: string } => {
  const idMap = new Map<string, string>();
  tree.forEach((object) => idMap.set(object.id, makeId('obj')));
  const remap = (id: string | undefined) => (id && idMap.has(id) ? idMap.get(id)! : id);
  const objects = tree.map((object) => {
    const clone = structuredClone(object) as SceneObject;
    clone.id = idMap.get(object.id)!;
    if (clone.parentId) clone.parentId = remap(clone.parentId);
    if (clone.attachment?.targetObjectId) {
      clone.attachment = { ...clone.attachment, targetObjectId: remap(clone.attachment.targetObjectId)! };
    }
    if (clone.viewModel?.ownerObjectId) {
      clone.viewModel = { ...clone.viewModel, ownerObjectId: remap(clone.viewModel.ownerObjectId)! };
    }
    // A joint linking two objects INSIDE this tree (e.g. a wrecking-ball prefab roped to its crane)
    // must point at the clone's new id, not the original — else the instantiated prefab links to the
    // source object (or nothing). A world-anchored joint (empty connectedObjectId) is left as-is.
    if (clone.joint?.connectedObjectId) {
      clone.joint = { ...clone.joint, connectedObjectId: remap(clone.joint.connectedObjectId) };
    }
    // A cable whose far end attaches to another object INSIDE this tree must follow the clone — same
    // reasoning as the joint above. A free-hanging cable (no endObjectId) or one attached OUTSIDE the
    // tree keeps its id (remap() passes through ids it doesn't know).
    if (clone.cable?.endObjectId) {
      clone.cable = { ...clone.cable, endObjectId: remap(clone.cable.endObjectId) };
    }
    // Vehicles reference their rig by OBJECT ID (wheels, anchors, lights, emitters, loose parts) — a
    // cloned car must point at its own cloned parts, or a spawned/duplicated vehicle has a dead rig.
    // (garageBodyIds are ASSET ids — shared, never remapped.)
    if (clone.vehicle) {
      const v = clone.vehicle;
      const remapAll = (ids: string[] | undefined) => ids?.map((id) => remap(id)!) ?? ids;
      clone.vehicle = {
        ...v,
        wheelObjectIds: remapAll(v.wheelObjectIds) ?? [],
        steeredWheelIds: remapAll(v.steeredWheelIds) ?? [],
        wheels: v.wheels?.map((w) => ({ ...w, objectId: remap(w.objectId)! })),
        tireMarkIds: remapAll(v.tireMarkIds) ?? [],
        headlightIds: remapAll(v.headlightIds) ?? [],
        brakeLightIds: remapAll(v.brakeLightIds) ?? [],
        brakeDiscIds: remapAll(v.brakeDiscIds),
        boostFlameIds: remapAll(v.boostFlameIds),
        loosePartIds: remapAll(v.loosePartIds),
      };
    }
    return clone;
  });
  return { objects, rootId: idMap.get(rootId)! };
};

export const deleteWithChildren = (objects: SceneObject[], id: string) => {
  const ids = new Set<string>([id]);
  let changed = true;

  while (changed) {
    changed = false;
    objects.forEach((object) => {
      if (object.parentId && ids.has(object.parentId) && !ids.has(object.id)) {
        ids.add(object.id);
        changed = true;
      }
    });
  }

  return objects.filter((object) => !ids.has(object.id));
};

/** Resolve a deletion selection to every root + descendant id before mutating the scene. */
export const collectDeletedObjectIds = (objects: SceneObject[], rootIds: Iterable<string>): Set<string> => {
  const ids = new Set(rootIds);
  let changed = true;
  while (changed) {
    changed = false;
    objects.forEach((object) => {
      if (object.parentId && ids.has(object.parentId) && !ids.has(object.id)) {
        ids.add(object.id);
        changed = true;
      }
    });
  }
  return ids;
};

/**
 * Remaining lifetime of each spawned VFX burst (impact sparks / dust puffs / explosions), keyed by object
 * id. Kept OUTSIDE the store so ticking a burst's clock never re-mints the object (and with it the whole
 * scene-objects array identity) every frame — the burst component animates itself; the runtime only needs
 * to know when to despawn. Cleared when Play starts.
 */
export const effectLife = new Map<string, number>();

export const EMPTY_EXEC_TARGETS: string[] = [];

/** Gravity a scene runs at until it authors `environment.gravity` (Set Gravity node / Scene Settings). */
export const EARTH_GRAVITY: Vector3Tuple = [0, -9.81, 0];

/** Stable selector for the active scene's objects. Use this in components, not an inline arrow. */
export const selectActiveObjects = (state: EditorStateLike): SceneObject[] =>
  state.scenes.find((scene) => scene.id === state.activeSceneId)?.objects ?? [];

/**
 * Run `fn` over the ACTIVE scene's objects, returning a partial state update that stamps the new
 * array (isDirty included). Pass the result to `set()`. This is the canonical path for object
 * mutators; prefer it over hand-writing `state.scenes.map(...)`.
 */
export const mapActiveSceneObjects = (
  state: EditorStateLike,
  fn: (objects: SceneObject[]) => SceneObject[],
): { scenes: Scene[]; isDirty: true } => ({
  scenes: state.scenes.map((scene) =>
    scene.id === state.activeSceneId ? { ...scene, objects: fn(scene.objects) } : scene,
  ),
  isDirty: true,
});

/** Stable selector for the active scene's environment settings (sky/fog/sun). May be undefined. */
export const selectActiveSceneEnvironment = (
  state: EditorStateLike,
): SceneEnvironmentSettings | undefined =>
  state.scenes.find((scene) => scene.id === state.activeSceneId)?.environment;

/**
 * The effective selection: the multi-select set when it actually contains the active object,
 * otherwise just the active object. This lets every single-select consumer keep reading
 * `selectedObjectId` while multi-select layers on top — any code path that sets only
 * `selectedObjectId` (create, scene switch, etc.) automatically collapses back to single-select.
 */
export const effectiveSelection = (state: EditorStateLike): string[] => {
  const { selectedObjectId, selectedObjectIds } = state;
  if (selectedObjectId && selectedObjectIds.includes(selectedObjectId)) return selectedObjectIds;
  return selectedObjectId ? [selectedObjectId] : [];
};

/**
 * Per-Play navmesh cache (module-level so tickRuntime never stores it in React state). The grid is
 * baked from static fixed colliders the first time a Move To runs, keyed by scene so Load Scene
 * rebuilds it; per-(object:node) paths re-plan when the target moves or goes stale.
 */
let navGridForScene: { sceneId: string; grid: NavGrid | undefined } | null = null;
const navPathsForPlay = new Map<
  string,
  { target: [number, number]; waypoints: Array<[number, number]>; plannedAt: number }
>();

export { navPathsForPlay };

export const resetNavCache = (): void => {
  navGridForScene = null;
  navPathsForPlay.clear();
};

export const ensureNavGrid = (sceneId: string, objects: Iterable<SceneObject>): NavGrid | undefined => {
  if (navGridForScene && navGridForScene.sceneId === sceneId) return navGridForScene.grid;
  const boxes: NavObstacle[] = [];
  for (const object of objects) {
    // Static solid colliders only: walls, crates, pillars. Dynamic/kinematic props move (the
    // steering ray-fan handles them); triggers and pawns don't block walking.
    if (!object.physics?.enabled || object.physics.bodyType !== 'fixed' || object.physics.isTrigger) continue;
    if (object.character?.enabled) continue;
    const [px, py, pz] = object.transform.position;
    const [sx, sy, sz] = object.transform.scale;
    const halfX = Math.abs(sx) / 2;
    const halfY = Math.abs(sy) / 2;
    const halfZ = Math.abs(sz) / 2;
    // Only obstacles intersecting the walking band count — floors below and canopies above don't.
    if (py + halfY < 0.35 || py - halfY > 2.4) continue;
    // Huge slabs (ground platforms) would block everything — they're floor, not walls.
    if (halfX * halfZ * 4 > 1600) continue;
    boxes.push({ minX: px - halfX, maxX: px + halfX, minZ: pz - halfZ, maxZ: pz + halfZ });
  }
  navGridForScene = { sceneId, grid: boxes.length ? buildNavGrid(boxes) : undefined };
  return navGridForScene.grid;
};

/**
 * Activation streaming (world sectors, per-Play): ids currently streamed OUT by distance from the
 * player. They ride the Set Active machinery (no render/scripts/physics/AI) but are undone at the
 * top of every tick and re-derived on an interval, so walking back toward them wakes them up.
 */
export const streamedOutIds = new Set<string>();
let streamEvalAt = -1;
let streamEvalScene = '';

/** Read/write accessors for the primitive streaming bookkeeping (module `let` state, reassigned by tick). */
export const getStreamEvalAt = (): number => streamEvalAt;
export const setStreamEvalAt = (v: number): void => {
  streamEvalAt = v;
};
export const getStreamEvalScene = (): string => streamEvalScene;
export const setStreamEvalScene = (v: string): void => {
  streamEvalScene = v;
};

export const resetStreamingCache = (): void => {
  streamedOutIds.clear();
  streamEvalAt = -1;
  streamEvalScene = '';
};
