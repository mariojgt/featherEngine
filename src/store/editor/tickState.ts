import type {
  GraphValueType,
  SceneObject,
  ScriptBlueprint,
  TransformComponent,
  Vector3Tuple,
} from '../../types';

/**
 * Module-level runtime state shared across `tickRuntime` and `setPlaying`. All of it is per-Play-session
 * scratch — pooled Maps refilled each frame, dedup sets, and crash-part bookkeeping — kept at module
 * scope so the per-frame hot path never allocates or touches store identities. ⚠️ None of this is store
 * state; it must never be retained across Play sessions (the relevant pieces are cleared on Play start).
 */

/**
 * Per-Play-session dedup of script runtime errors. A blueprint node that throws during a tick (null
 * ref, bad cast, etc.) would otherwise re-throw 60×/s and flood the runtime console; we report each
 * unique `objectId:message` once per session and swallow the rest. The set is cleared whenever Play
 * toggles (see setPlaying), so a fixed script reports fresh on the next run. The throw itself is
 * caught at the per-object dispatch in tickRuntime so one bad script can't kill the whole frame loop.
 */
export const reportedScriptErrors = new Set<string>();
export const resetReportedScriptErrors = () => reportedScriptErrors.clear();

/**
 * Pooled entries for tickRuntime's start-of-tick transform snapshot (`prevTransforms`). The Map handed
 * to the tick/physics is rebuilt each frame (consumers may hold it only within the tick), but the
 * per-object `{ position, rotation }` wrapper objects are reused across frames — that's N fewer
 * allocations per frame, every frame. Entries are mutated in place at the top of each tick, so they
 * must never be retained across ticks (physicsWorld only reads them synchronously). Cleared on Play start.
 */
export const prevTransformEntryPool = new Map<string, { position: Vector3Tuple; rotation: Vector3Tuple }>();

/**
 * Per-tick object-index Maps, POOLED at module level and refilled with clear() + set() each frame.
 * The tick used to mint ~5 of these (one per pass, N entries each) every frame — at 60fps in a
 * ~250-object scene that's tens of thousands of Map-entry allocations per second, and the live
 * profiler attributed the user-visible periodic ~60ms stalls to exactly this kind of GC pressure
 * (stalls with tick≈3ms, render≈2ms, other≈55ms). clear() keeps the backing storage, so steady-state
 * frames allocate nothing here. ⚠️ STRICTLY tick-local: each pool is valid only between its fill and
 * the end of that tick — never retain one across ticks (closures created inside the tick are fine).
 */
export const fillObjectIdMap = (
  pool: Map<string, SceneObject>,
  objects: readonly SceneObject[],
): Map<string, SceneObject> => {
  pool.clear();
  for (const object of objects) pool.set(object.id, object);
  return pool;
};
export const tickMappedById = new Map<string, SceneObject>();
export const tickResolvedById = new Map<string, SceneObject>();
export const tickVehicleById = new Map<string, SceneObject>();
export const tickRemainingById = new Map<string, SceneObject>();
export const tickPrevTransforms = new Map<string, { position: Vector3Tuple; rotation: Vector3Tuple }>();

/** Reused exclusion set for the AI driver's obstacle feeler rays (single-threaded tick). */
export const aiFeelerExclude = new Set<string>();

/**
 * Blueprint → declared-variable types. Keyed on blueprint object identity, which is stable during Play
 * (editing a blueprint mints a new object), so the type Maps survive across ticks instead of being
 * rebuilt per frame.
 */
export const blueprintVarTypeCache = new WeakMap<ScriptBlueprint, Map<string, GraphValueType>>();

/**
 * LOOSE car parts (vehicle.loosePartIds): bookkeeping for parts torn off by crashes, all module-level
 * so per-frame bookkeeping never touches store identities.
 * - detachedParts: part id → its original attachment (parent + LOCAL transform), so R-repair can bolt
 *   it back on exactly where it was.
 * - pendingPartKicks: momentum/tumble queued at detach time, handed to the physics world on the NEXT
 *   tick (the part's dynamic body is created during that frame's sync).
 * - pendingPartRestores: parts queued for re-attachment by a respawn/repair this frame.
 */
export const detachedParts = new Map<string, { parentId: string; transform: TransformComponent }>();
export const pendingPartKicks = new Map<string, { vel: Vector3Tuple; spin: Vector3Tuple }>();
export const pendingPartRestores = new Map<string, { parentId: string; transform: TransformComponent }>();
