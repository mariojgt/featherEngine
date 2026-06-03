// Memoized array→Map indexers.
//
// Several per-frame passes (notably `tickRuntime`) need id/name lookup Maps over
// project-level arrays (variables, prefabs, animations, …). Those arrays are
// replaced immutably only when the user edits them, so during Play they keep the
// same identity frame after frame. Rebuilding `new Map(arr.map(...))` every frame
// was pure allocation churn; instead we cache the Map keyed on the array reference
// via a WeakMap, so a tick that sees the same array gets the same Map for free.
// When the array is replaced (an edit), the WeakMap misses and the Map is rebuilt
// once. Old arrays are garbage-collected automatically.

export const createArrayIndexer = <T, K>(keyFn: (item: T) => K): ((arr: readonly T[]) => Map<K, T>) => {
  const cache = new WeakMap<readonly T[], Map<K, T>>();
  return (arr) => {
    const hit = cache.get(arr);
    if (hit) return hit;
    const map = new Map<K, T>();
    for (const item of arr) map.set(keyFn(item), item);
    cache.set(arr, map);
    return map;
  };
};
