import * as THREE from 'three';
import type { SceneObject, TreeChopState, TreeSpec, Vector3Tuple } from '../types';
import { generateTree } from '../tree/generateTree';
import { normalizeTreeSpec, resolveTreeSpec } from '../tree/treeSpec';
import { registerRawGeometry } from './meshGeometryCache';
import { defaultPhysics } from '../store/editor/defaults';

/**
 * Zelda-style tree felling.
 *
 * Chopping a tree does NOT cut geometry. Every vertex already carries `aTrunkT` — the trunk height its
 * limb is rooted at — so severing at height h is a pure partition: everything below h stays as the stump,
 * everything above falls as a log. Because a branch inherits its trunk attach height, a whole limb travels
 * with the log instead of being sliced through the middle, and the split costs one number.
 *
 * Progress lives HERE rather than in the editor store on purpose: a tree takes several hits, and routing
 * each one through the store would re-render every panel subscribed to the scene. Play/Stop wipes it, and
 * the store's own Play snapshot restores the objects, so a felled forest is whole again on Stop.
 */

const chopStates = new Map<string, TreeChopState>();
let version = 0;

/** Bumped on every chop so renderers can cheaply notice without subscribing to the store. */
export function treeChopVersion(): number {
  return version;
}

export function getTreeChopState(objectId: string): TreeChopState | undefined {
  return chopStates.get(objectId);
}

/** Stop clears felling progress — otherwise a tree chopped last session starts the next one already down. */
export function clearTreeChops(): void {
  chopStates.clear();
  version += 1;
}

export interface ChopResult {
  /** True when this hit severed the trunk (as opposed to just landing a hit). */
  severed: boolean;
  /** Index into spec.chop.breakPoints. */
  breakPointIndex: number;
  hitsLeft: number;
  /** World-space height the cut happened at, for VFX. */
  cutWorldY: number;
  /**
   * The felled pieces, ready to append to the tick's `spawned` list. Only set when `severed`.
   * Index 0 is the bark body (the physics body); a canopy piece, if any, follows parented to it.
   */
  logs?: SceneObject[];
}

/**
 * Resolve which break point a hit at `worldPoint` belongs to.
 *
 * Picks the nearest INTACT break point within tolerance. Nearest-not-lowest matters: bucking a felled
 * trunk means hitting the upper cut specifically, and snapping to the lowest would make that impossible.
 */
function objectLocalMatrix(object: SceneObject): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...object.transform.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...object.transform.rotation)),
    new THREE.Vector3(...object.transform.scale),
  );
}

/** Resolve the authored hierarchy without relying on a mounted Three scene graph. */
export function treeWorldMatrix(tree: SceneObject, objects: SceneObject[] = [tree]): THREE.Matrix4 {
  const byId = new Map(objects.map((object) => [object.id, object]));
  const chain: SceneObject[] = [];
  const seen = new Set<string>();
  let current: SceneObject | undefined = tree;
  while (current && !seen.has(current.id)) {
    chain.push(current);
    seen.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  const world = new THREE.Matrix4().identity();
  for (let index = chain.length - 1; index >= 0; index -= 1) world.multiply(objectLocalMatrix(chain[index]));
  return world;
}

function resolveBreakPoint(spec: TreeSpec, localPoint: THREE.Vector3, state: TreeChopState): number {
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < spec.chop.breakPoints.length; i += 1) {
    if (state.severedAt !== undefined && i >= state.severedAt) continue; // already gone with the log
    const pointY = spec.chop.breakPoints[i].height * spec.trunk.height;
    const dist = Math.abs(localPoint.y - pointY);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return bestDist <= spec.chop.tolerance ? best : -1;
}

export interface ChopTreeOptions {
  /** Shared project library. Used when the caller has not already resolved the component. */
  treeSpecs?: TreeSpec[];
  /** Scene objects used to resolve parent/group transforms. */
  objects?: SceneObject[];
  /** Optional pre-resolved spec for hot call sites. */
  resolvedSpec?: TreeSpec;
}

/**
 * Land one axe hit on a tree. Returns null when the hit misses every break point (or the tree is not
 * choppable), so the caller can fall back to a generic "thunk" response.
 */
export function chopTree(
  tree: SceneObject,
  worldPoint: Vector3Tuple,
  hitDirection: Vector3Tuple,
  options: ChopTreeOptions = {},
): ChopResult | null {
  const component = tree.tree;
  if (!component?.enabled || component.choppable === false) return null;
  const spec = normalizeTreeSpec(options.resolvedSpec ?? resolveTreeSpec(component, options.treeSpecs ?? []));
  if (!spec.chop.enabled || spec.chop.breakPoints.length === 0) return null;

  const worldMatrix = treeWorldMatrix(tree, options.objects ?? [tree]);
  const localPoint = new THREE.Vector3(...worldPoint).applyMatrix4(worldMatrix.clone().invert());
  const state = chopStates.get(tree.id) ?? { hitsLeft: {} };
  const index = resolveBreakPoint(spec, localPoint, state);
  if (index < 0) return null;

  const breakPoint = spec.chop.breakPoints[index];
  const remaining = (state.hitsLeft[index] ?? breakPoint.hits) - 1;
  state.hitsLeft = { ...state.hitsLeft, [index]: Math.max(0, remaining) };

  const cutWorldY = new THREE.Vector3(0, breakPoint.height * spec.trunk.height, 0)
    .applyMatrix4(worldMatrix).y;

  if (remaining > 0) {
    chopStates.set(tree.id, state);
    version += 1;
    return { severed: false, breakPointIndex: index, hitsLeft: remaining, cutWorldY };
  }

  state.severedAt = index;
  chopStates.set(tree.id, state);
  version += 1;
  return {
    severed: true,
    breakPointIndex: index,
    hitsLeft: 0,
    cutWorldY,
    logs: makeFelledLog(tree, spec, index, hitDirection, worldMatrix),
  };
}

/**
 * Build the falling half as a real dynamic SceneObject.
 *
 * The geometry is baked once into the raw-geometry cache, which the renderer reads through
 * `renderer.fragmentKey` and the physics layer reads through `renderer.modelAssetId` to build a convex
 * hull — so the log you see and the log you collide with are literally the same vertices.
 */
function makeFelledLog(
  tree: SceneObject,
  spec: TreeSpec,
  breakIndex: number,
  hitDirection: Vector3Tuple,
  worldMatrix: THREE.Matrix4,
): SceneObject[] {
  const cutHeight = spec.chop.breakPoints[breakIndex].height;
  const generated = generateTree(spec, tree.tree?.seed ?? 1);
  // Bark and canopy are sliced SEPARATELY and spawned as two objects. The raw-geometry cache stores only
  // positions and indices (it exists for fracture shards), so a single merged log would have to pick one
  // flat colour for the whole thing — and a felled tree with brown leaves is the first thing you notice.
  // The canopy rides along as a physics-less child of the bark body.
  const barkSlice = sliceAboveTrunkT(generated.bark, null, cutHeight);
  const foliageSlice = generated.foliage ? sliceAboveTrunkT(generated.foliage, null, cutHeight) : null;
  generated.bark.dispose();
  generated.foliage?.dispose();

  const key = `treelog_${tree.id}_${breakIndex}_${version}`;
  const worldPosition = new THREE.Vector3().setFromMatrixPosition(worldMatrix);
  const linear = worldMatrix.clone().setPosition(0, 0, 0);
  const point = new THREE.Vector3();
  for (const slice of [barkSlice, foliageSlice]) {
    if (!slice) continue;
    for (let i = 0; i < slice.vertices.length; i += 3) {
      point.fromArray(slice.vertices, i).applyMatrix4(linear).toArray(slice.vertices, i);
    }
    // Mirrored transforms reverse winding; keep the root mesh front faces outward.
    if (linear.determinant() < 0) for (let i = 0; i < slice.indices.length; i += 3) {
      [slice.indices[i + 1], slice.indices[i + 2]] = [slice.indices[i + 2], slice.indices[i + 1]];
    }
  }
  registerRawGeometry(key, barkSlice.vertices, barkSlice.indices);

  // Topple AWAY from the swing, with a shove proportional to how much tree is above the cut — felling a
  // tall pine at the base should go over hard, snapping a sapling should barely move.
  const above = Math.max(0.15, 1 - cutHeight);
  const push = spec.chop.topplePush * above;
  const dir = new THREE.Vector3(hitDirection[0], 0, hitDirection[2]);
  if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0);
  dir.normalize();

  const logId = `${tree.id}__log_${breakIndex}`;
  const bark: SceneObject = {
    id: logId,
    name: `${tree.name} Log`,
    kind: 'empty',
    parentId: undefined,
    transform: {
      // The full linear world transform is baked into vertices, including hierarchical shear.
      position: [worldPosition.x, worldPosition.y, worldPosition.z],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
    renderer: {
      enabled: true,
      mesh: 'cube',
      color: spec.look.barkRamp[0] ?? '#6b4a2f',
      metalness: 0,
      roughness: 0.9,
      modelAssetId: key,
      fragmentKey: key,
    },
    physics: {
      ...defaultPhysics('dynamic', 'convex'),
      enabled: true,
      mass: Math.max(1, spec.trunk.baseRadius * spec.trunk.height * 12),
      friction: 0.9,
      restitution: 0.05,
      linearDamping: 0.15,
      angularDamping: 0.35,
    },
    // Picked up the frame the body first exists (editorStore drains __impulse into physicsImpulses).
    variables: {
      __impulse: [dir.x * push, push * 0.25, dir.z * push] as Vector3Tuple,
      // Keeps the felled piece self-describing, so bucking it later can find its parent tree.
      __cutFromTree: tree.id,
    },
  };

  const out: SceneObject[] = [bark];
  if (foliageSlice && foliageSlice.indices.length > 0) {
    const leafKey = `${key}_leaf`;
    registerRawGeometry(leafKey, foliageSlice.vertices, foliageSlice.indices);
    out.push({
      id: `${logId}__canopy`,
      name: `${tree.name} Canopy`,
      kind: 'empty',
      // Parented to the bark body, with an identity local transform: the canopy was sliced in the same
      // local space, so it stays welded to the trunk as the log tumbles, with no second body to sync.
      parentId: logId,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      renderer: {
        enabled: true,
        mesh: 'cube',
        color: spec.look.foliageRamp[spec.look.foliageRamp.length - 1] ?? '#4f8544',
        metalness: 0,
        roughness: 0.95,
        modelAssetId: leafKey,
        fragmentKey: leafKey,
      },
    });
  }
  return out;
}

/**
 * Extract everything above `cutHeight` from the generated geometry into one flat vertex/index pair.
 *
 * Triangles are kept whole — a triangle counts as "above" when its centroid's aTrunkT is above the cut.
 * Splitting triangles exactly on the plane would leave a cleaner cut face, but a stylized tree hides the
 * seam behind its own bark silhouette and this keeps the operation allocation-cheap.
 */
function sliceAboveTrunkT(
  bark: THREE.BufferGeometry,
  foliage: THREE.BufferGeometry | null,
  cutHeight: number,
): { vertices: Float32Array; indices: Uint32Array } {
  const vertices: number[] = [];
  const indices: number[] = [];

  for (const geo of [bark, foliage]) {
    if (!geo) continue;
    const pos = geo.getAttribute('position');
    const trunkT = geo.getAttribute('aTrunkT');
    const idx = geo.getIndex();
    if (!pos || !trunkT || !idx) continue;
    const remap = new Map<number, number>();
    const take = (i: number) => {
      const existing = remap.get(i);
      if (existing !== undefined) return existing;
      const next = vertices.length / 3;
      vertices.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      remap.set(i, next);
      return next;
    };
    for (let t = 0; t < idx.count; t += 3) {
      const a = idx.getX(t);
      const b = idx.getX(t + 1);
      const c = idx.getX(t + 2);
      const centroid = (trunkT.getX(a) + trunkT.getX(b) + trunkT.getX(c)) / 3;
      if (centroid < cutHeight) continue;
      indices.push(take(a), take(b), take(c));
    }
  }

  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) };
}
