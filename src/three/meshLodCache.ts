import * as THREE from 'three';
import { MeshoptSimplifier } from 'meshoptimizer';

/**
 * Auto-generated mesh LOD geometry, shared by the {@link MeshLOD} distance traversal.
 *
 * For an imported model with no authored LODs, we derive cheaper copies at runtime with meshoptimizer.
 * `simplify` returns only a NEW INDEX BUFFER over the SAME vertices, so an LOD geometry reuses the
 * original's vertex attributes (no extra GPU vertex upload — just a smaller index) and simply draws
 * fewer triangles. Each unique source geometry is simplified once and cached by its uuid.
 *
 * Simplification runs on the main thread but is cheap per call; the traversal generates at most a
 * couple of geometries per throttled tick so a dense scene spreads the cost over a few seconds instead
 * of hitching on the first frame at distance. Until an LOD exists, the mesh keeps full detail (no pop).
 */

/** Triangle-reduction targets per LOD level (fraction of the original index count). Level 0 = original. */
const LOD_RATIOS = [1, 0.4, 0.15];
/** Generous error budget — these only show at distance, so favour a real triangle cut over fidelity. */
const LOD_TARGET_ERROR = 0.12;
/** Below this many indices a mesh isn't worth simplifying (the draw is already tiny). */
export const MIN_LOD_INDEX_COUNT = 1500;

let simplifierReady = false;
void MeshoptSimplifier.ready.then(() => {
  simplifierReady = true;
});

/** True once the WASM simplifier has initialised and the platform supports it. */
export function meshLodReady(): boolean {
  return simplifierReady && MeshoptSimplifier.supported;
}

/** uuid → [unused level0, lod1 | null, lod2 | null]. `null` = generation tried and failed (don't retry). */
const lodCache = new Map<string, (THREE.BufferGeometry | null)[]>();

/** How many NEW geometries may be simplified before the budget is refilled — caps per-tick cost so a
 *  dense scene spreads generation over several throttled ticks instead of hitching on one frame. */
let genBudget = 0;
export function setLodGenBudget(n: number): void {
  genBudget = n;
}

/**
 * Is this geometry a candidate for LOD? Indexed, single-material, non-interleaved positions, and big
 * enough to be worth it. (Skinned/instanced/sky meshes are filtered by the traversal before this.)
 */
export function isLodCandidate(geometry: THREE.BufferGeometry): boolean {
  const index = geometry.getIndex();
  if (!index || index.count < MIN_LOD_INDEX_COUNT) return false;
  if (geometry.groups.length > 1) return false; // multi-material: reindexing would break the group ranges
  const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!position || (position as unknown as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute) {
    return false;
  }
  return true;
}

/** Build an LOD geometry that SHARES the source's vertex attributes and only carries a smaller index. */
function makeLodGeometry(source: THREE.BufferGeometry, newIndex: Uint32Array): THREE.BufferGeometry {
  const lod = new THREE.BufferGeometry();
  for (const name of Object.keys(source.attributes)) lod.setAttribute(name, source.attributes[name]);
  lod.setIndex(new THREE.BufferAttribute(newIndex, 1));
  // Reuse the source bounds — same vertices, so culling/raycast bounds are identical.
  if (source.boundingSphere) lod.boundingSphere = source.boundingSphere.clone();
  if (source.boundingBox) lod.boundingBox = source.boundingBox.clone();
  return lod;
}

/**
 * Get the simplified geometry for `level` (1 or 2), generating + caching it on first request. Returns
 * the original when `level` is 0, the best available cached level when a higher one isn't ready yet, or
 * `null` when nothing is ready and the caller should keep the current geometry this frame. Generation
 * only happens when `meshLodReady()` — call it before relying on a non-null result.
 */
export function getLodGeometry(source: THREE.BufferGeometry, level: number): THREE.BufferGeometry | null {
  if (level <= 0) return source;
  let entry = lodCache.get(source.uuid);
  if (!entry) {
    entry = [source, undefined as unknown as null, undefined as unknown as null];
    lodCache.set(source.uuid, entry);
  }
  // Generate this level if we haven't tried yet and the per-tick budget allows it.
  if (entry[level] === undefined && genBudget > 0 && meshLodReady()) {
    genBudget -= 1;
    entry[level] = buildLevel(source, level);
  }
  // Walk down to the best ready level at or below the request (level 2 falls back to level 1).
  for (let l = level; l >= 1; l -= 1) {
    if (entry[l]) return entry[l] as THREE.BufferGeometry;
  }
  return level >= 1 && entry[level] === null ? source : null;
}

function buildLevel(source: THREE.BufferGeometry, level: number): THREE.BufferGeometry | null {
  try {
    const index = source.getIndex();
    const position = source.getAttribute('position') as THREE.BufferAttribute;
    if (!index) return null;
    const indices = index.array instanceof Uint32Array ? index.array : new Uint32Array(index.array);
    const positions = position.array instanceof Float32Array ? position.array : new Float32Array(position.array);
    const target = Math.max(3, Math.floor(indices.length * LOD_RATIOS[level]));
    const [newIndex, error] = MeshoptSimplifier.simplify(indices, positions, 3, target, LOD_TARGET_ERROR, ['LockBorder']);
    // No meaningful reduction (already minimal, or couldn't collapse without exceeding the error)? Skip.
    if (newIndex.length >= indices.length * 0.95) return null;
    void error;
    return makeLodGeometry(source, newIndex);
  } catch {
    return null;
  }
}
