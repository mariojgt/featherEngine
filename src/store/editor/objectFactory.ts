import type {
  AssetType,
  ColliderType,
  CompareOperator,
  FractureComponent,
  GraphValue,
  GraphValueType,
  NodeForgeNodeData,
  ProjectileComponent,
  ProjectVariable,
  SceneObject,
  SceneObjectKind,
  ScriptBlueprint,
  Vector3Tuple,
} from '../../types';

import * as THREE from 'three';
import { Brush, Evaluator, INTERSECTION } from 'three-bvh-csg';
import { withParticleDefaults } from '../../runtime/particlePresets';
import { registerRawGeometry, getModelGeometry } from '../../runtime/meshGeometryCache';
import { defaultTerrain } from '../../terrain/terrain';
import { cloneGraphValue } from './graph';
import { makeId } from './ids';
import { defaultPhysics, defaultRenderer, defaultTransform, titleCase } from './defaults';

export const getAssetType = (fileName: string): AssetType => {
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (ext === 'glb' || ext === 'gltf') return 'model';
  if (['png', 'jpg', 'jpeg', 'webp'].includes(ext ?? '')) return 'image';
  if (['mp3', 'wav'].includes(ext ?? '')) return 'audio';
  return 'unknown';
};

export const objectDefaults: Record<SceneObjectKind, Partial<SceneObject>> = {
  empty: { kind: 'empty' },
  cube: { kind: 'cube', renderer: defaultRenderer('cube') },
  sphere: { kind: 'sphere', renderer: defaultRenderer('sphere', '#3DDC97') },
  capsule: { kind: 'capsule', renderer: defaultRenderer('capsule', '#F7B955') },
  plane: { kind: 'plane', renderer: defaultRenderer('plane', '#2B3345'), physics: defaultPhysics('fixed', 'box') },
  terrain: { kind: 'terrain', terrain: defaultTerrain(), physics: { ...defaultPhysics('fixed', 'mesh'), enabled: true } },
  light: { kind: 'light' },
  camera: { kind: 'camera' },
};

export const makeRuntimeVelocityMap = (objects: SceneObject[]) =>
  Object.fromEntries(
    objects
      .filter((object) => object.physics?.enabled && object.physics.bodyType === 'dynamic')
      .map((object) => [object.id, [0, 0, 0] as Vector3Tuple]),
  );

export const makeRuntimeVariableMap = (variables: ProjectVariable[]) =>
  Object.fromEntries(variables.map((variable) => [variable.id, cloneGraphValue(variable.defaultValue)])) as Record<
    string,
    GraphValue
  >;

/**
 * Merge a blueprint's DECLARED instance-variable defaults under an object's existing instance variables, so
 * each object running the blueprint gets its own typed copy (keyed by variable name) without clobbering any
 * value already authored on the object. Used when attaching a script and when seeding runtime values on Play.
 */
export const seedBlueprintInstanceVars = (
  existing: Record<string, GraphValue> | undefined,
  blueprint: ScriptBlueprint | undefined,
): Record<string, GraphValue> => {
  const seeded: Record<string, GraphValue> = {};
  for (const variable of blueprint?.variables ?? []) seeded[variable.name] = cloneGraphValue(variable.defaultValue);
  return { ...seeded, ...(existing ?? {}) };
};

/** Look up the declared TYPE of an instance variable (by name) on the object's attached blueprint, if any. */
export const declaredInstanceVarType = (
  object: SceneObject | undefined,
  blueprints: ScriptBlueprint[],
  key: string,
): GraphValueType | undefined => {
  const bp = object?.script?.blueprintId ? blueprints.find((b) => b.id === object.script!.blueprintId) : undefined;
  return bp?.variables?.find((v) => v.name === key)?.type;
};

/** Best-effort GraphValueType from a runtime value, used to coerce instance-var writes when no declaration exists. */
export const inferGraphType = (value: GraphValue | undefined): GraphValueType => {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string') return 'string';
  if (Array.isArray(value)) return 'vector3';
  return 'number';
};

// --- Game save slots --------------------------------------------------------------------------
// Slots are NAMESPACED PER GAME (set from the project name on new/open and in the exported player),
// so two games on the same browser origin can't read or clobber each other's saves. Values are
// keyed by VARIABLE NAME (stable across template re-imports and project copies — variable ids are
// random per project); readers fall back to the legacy un-namespaced, id-keyed format.
let saveNamespace = 'project';

/** Scope all save slots to one game. Call when a project is created/opened/renamed and in the player. */
export const setSaveNamespace = (name: string) => {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  saveNamespace = slug || 'project';
};

const saveKeyForSlot = (slot: string) => `nodeforge.save.${saveNamespace}.${slot.trim() || 'slot1'}`;
/** Pre-namespace key — old saves live here; read-only fallback so they keep loading. */
const legacySaveKeyForSlot = (slot: string) => `nodeforge.save.${slot.trim() || 'slot1'}`;

export const readSaveSlot = (slot: string): Record<string, GraphValue> | null => {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(saveKeyForSlot(slot)) ?? localStorage.getItem(legacySaveKeyForSlot(slot));
    return raw ? (JSON.parse(raw) as Record<string, GraphValue>) : null;
  } catch {
    return null;
  }
};

export const writeSaveSlot = (slot: string, values: Record<string, GraphValue>) => {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(saveKeyForSlot(slot), JSON.stringify(values));
};

export const clearSaveSlot = (slot: string) => {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(saveKeyForSlot(slot));
  localStorage.removeItem(legacySaveKeyForSlot(slot));
};

export const hasSaveSlot = (slot: string): boolean => readSaveSlot(slot) !== null;

export const toNumber = (value: GraphValue | undefined): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string') return Number(value) || 0;
  return Array.isArray(value) ? value[0] : 0;
};

export const toBoolean = (value: GraphValue | undefined): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value.trim().length > 0 && value.trim().toLowerCase() !== 'false';
  return Array.isArray(value) ? value.some((item) => item !== 0) : false;
};

export const toVector3 = (value: GraphValue | undefined): Vector3Tuple =>
  Array.isArray(value) ? ([value[0], value[1], value[2]] as Vector3Tuple) : [toNumber(value), 0, 0];

export const graphValueToString = (value: GraphValue | undefined): string => {
  if (value === undefined) return '';
  if (Array.isArray(value)) return `[${value.join(', ')}]`;
  return String(value);
};

export const compareValues = (left: GraphValue | undefined, right: GraphValue | undefined, op: CompareOperator): boolean => {
  if (op === '==') return graphValueToString(left) === graphValueToString(right);
  if (op === '!=') return graphValueToString(left) !== graphValueToString(right);
  const a = toNumber(left);
  const b = toNumber(right);
  if (op === '>') return a > b;
  if (op === '>=') return a >= b;
  if (op === '<') return a < b;
  return a <= b;
};

export const axisIndex = (axis: NodeForgeNodeData['axis']) => {
  if (axis === 'x') return 0;
  if (axis === 'y') return 1;
  return 2;
};

/** Tunable setup for a spawned projectile (read from the Spawn Projectile node). */
export interface ProjectileSetup {
  size?: number;
  color?: string;
  life?: number;
  gravity?: number;
  /** Knockback multiplier for shoving a struck dynamic prop (0 = none, default ~1). */
  knockback?: number;
  /** Detonate on impact / lifetime expiry (grenades, rockets) — blast + area damage. */
  explosive?: boolean;
  blastRadius?: number;
  blastDamage?: number;
  blastSound?: string;
  debug?: boolean;
  /** Optional scene object to clone the look from (mesh/model/scale/material). */
  template?: SceneObject;
}

/**
 * Build a runtime projectile: by default a small fast sphere that flies straight (no gravity) and
 * damages on hit. `setup` overrides its size/color/lifetime/gravity; a `template` object clones its
 * mesh/model/scale/material so users can design a custom bullet (rocket, arrow, orb) in the scene.
 */
export const makeProjectileObject = (
  position: Vector3Tuple,
  velocity: Vector3Tuple,
  ownerId: string,
  damage: number,
  setup: ProjectileSetup = {},
): SceneObject => {
  const life = typeof setup.life === 'number' && setup.life > 0 ? setup.life : 3;
  const gravityScale = typeof setup.gravity === 'number' ? setup.gravity : 0;
  const projectile: ProjectileComponent = {
    ownerId,
    damage,
    life,
    velocity: [...velocity] as Vector3Tuple,
    knockback: typeof setup.knockback === 'number' ? setup.knockback : undefined,
    explosive: setup.explosive || undefined,
    blastRadius: typeof setup.blastRadius === 'number' ? setup.blastRadius : undefined,
    blastDamage: typeof setup.blastDamage === 'number' ? setup.blastDamage : undefined,
    blastSound: setup.blastSound || undefined,
    debug: setup.debug || undefined,
  };

  // Clone the look from a chosen template object (keep its mesh/model/material/scale), but force
  // projectile physics + behaviour so it always flies + reports hits regardless of the template's setup.
  if (setup.template) {
    const t = setup.template;
    const collider: ColliderType = t.kind === 'sphere' ? 'sphere' : t.kind === 'capsule' ? 'capsule' : 'box';
    return {
      id: makeId('proj'),
      name: `${t.name} (projectile)`,
      kind: t.kind === 'empty' || t.kind === 'light' || t.kind === 'camera' ? 'sphere' : t.kind,
      transform: { position: [...position] as Vector3Tuple, rotation: [...t.transform.rotation] as Vector3Tuple, scale: [...t.transform.scale] as Vector3Tuple },
      renderer: t.renderer ? { ...t.renderer } : { ...defaultRenderer('sphere'), color: setup.color ?? '#ffd166' },
      physics: { ...defaultPhysics('dynamic', collider), enabled: true, gravityScale },
      projectile,
    };
  }

  const size = typeof setup.size === 'number' && setup.size > 0 ? setup.size : 0.18;
  return {
    id: makeId('proj'),
    name: 'Projectile',
    kind: 'sphere',
    transform: { position: [...position] as Vector3Tuple, rotation: [0, 0, 0], scale: [size, size, size] },
    renderer: { ...defaultRenderer('sphere'), color: setup.color ?? '#ffd166', metalness: 0.1, roughness: 0.4 },
    // Dynamic + zero gravity (by default) so it flies straight AND generates contact events (kinematic
    // bodies don't report contacts against static/dynamic targets in Rapier). The runtime drives its velocity.
    physics: { ...defaultPhysics('dynamic', 'sphere'), enabled: true, gravityScale },
    projectile,
  };
};

/** A short-lived particle burst (THREE.Points) at a bullet-impact point. No physics; despawns itself. */
export const makeImpactObject = (position: Vector3Tuple, color = '#ffd27f'): SceneObject => ({
  id: makeId('fx'),
  name: 'Impact',
  kind: 'empty',
  transform: { position: [...position] as Vector3Tuple, rotation: [0, 0, 0], scale: [1, 1, 1] },
  effect: { kind: 'impact', life: 0.45, maxLife: 0.45, color, count: 24 },
});

/** A big fiery burst for explosions (barrels, grenades): far more particles, longer-lived, hot-orange. */
export const makeExplosion = (position: Vector3Tuple, color = '#ff7a1a'): SceneObject => ({
  id: makeId('fx'),
  name: 'Explosion',
  kind: 'empty',
  transform: { position: [...position] as Vector3Tuple, rotation: [0, 0, 0], scale: [1, 1, 1] },
  effect: { kind: 'impact', life: 0.7, maxLife: 0.7, color, count: 70 },
});

/** A floating combat damage number that rises + fades above a hit. */
export const makeDamageNumber = (position: Vector3Tuple, value: number, color = '#ffe08a'): SceneObject => ({
  id: makeId('fx'),
  name: 'Damage',
  kind: 'empty',
  transform: { position: [position[0], position[1] + 0.6, position[2]] as Vector3Tuple, rotation: [0, 0, 0], scale: [1, 1, 1] },
  effect: { kind: 'damage', life: 0.9, maxLife: 0.9, color, count: 1, value },
});

/** A soft dust/smoke puff (tire smoke, offroad dust, landings): slow billows that grow, rise and fade. */
export const makeDustPuff = (position: Vector3Tuple, color = '#b9a37e', count = 14, life = 0.9): SceneObject => ({
  id: makeId('fx'),
  name: 'Dust',
  kind: 'empty',
  transform: { position: [...position] as Vector3Tuple, rotation: [0, 0, 0], scale: [1, 1, 1] },
  effect: { kind: 'dust', life, maxLife: life, color, count },
});

/** A water-entry splash: a crown of droplets that fountain up and arc back down. */
export const makeSplashObject = (position: Vector3Tuple, color = '#9fd8ff'): SceneObject => ({
  id: makeId('fx'),
  name: 'Splash',
  kind: 'empty',
  transform: { position: [...position] as Vector3Tuple, rotation: [0, 0, 0], scale: [1, 1, 1] },
  effect: { kind: 'splash', life: 0.7, maxLife: 0.7, color, count: 40 },
});

/** A brief muzzle flash (bright forward spark + light) at the gun when a shot is fired. */
export const makeMuzzleFlash = (position: Vector3Tuple, color = '#fff1c2'): SceneObject => ({
  id: makeId('fx'),
  name: 'Muzzle Flash',
  kind: 'empty',
  transform: { position: [...position] as Vector3Tuple, rotation: [0, 0, 0], scale: [1, 1, 1] },
  effect: { kind: 'muzzle', life: 0.07, maxLife: 0.07, color, count: 10 },
});

/** Build a runtime-spawned weapon actor attached to an owner's bone/socket (Unreal-style equip). The
 *  grip alignment travels with it via the attachment offset, so it doesn't depend on any map object. */
export const makeAttachedWeapon = (
  ownerId: string,
  assetId: string,
  boneName: string,
  socketName: string | undefined,
  offsetPosition?: Vector3Tuple,
  offsetRotation?: Vector3Tuple,
  offsetScale?: Vector3Tuple,
): SceneObject => ({
  id: makeId('weapon'),
  name: 'Weapon',
  kind: 'cube',
  transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: offsetScale ?? [1, 1, 1] },
  renderer: { ...defaultRenderer('cube'), modelAssetId: assetId },
  attachment: { targetObjectId: ownerId, boneName, socketName, offsetPosition, offsetRotation, offsetScale },
  // Marker so a later equip can find + replace the weapon already on this slot.
  variables: { __attachedWeapon: socketName || boneName || '1' },
});

/** Build a runtime-spawned object (action.spawnObject) at a position, with dynamic physics on. */
export const makeSpawnedObject = (spawnKind: SceneObjectKind, position: Vector3Tuple): SceneObject => {
  const collider: ColliderType = spawnKind === 'sphere' ? 'sphere' : spawnKind === 'capsule' ? 'capsule' : 'box';
  return {
    id: makeId('obj'),
    name: titleCase(spawnKind),
    kind: spawnKind,
    transform: defaultTransform([position[0], position[1], position[2]]),
    ...objectDefaults[spawnKind],
    physics: { ...defaultPhysics('dynamic', collider), enabled: true },
  } as SceneObject;
};

/** Default destructible config, applied when an object is first made fracturable. */
export const defaultFracture = (): FractureComponent => ({
  enabled: true,
  pattern: 'chunks',
  pieces: 3,
  jitter: 0.5,
  seed: 1,
  strength: 3,
  impactThreshold: 0,
  focusImpact: true,
});

/** Deterministic PRNG (mulberry32) so a seed reproduces the same break. */
const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** An axis-aligned cell in the object's normalised local box space [-0.5, 0.5]³. */
interface FractureCell {
  min: number[];
  max: number[];
}

const clampHalf = (v: number) => Math.max(-0.5, Math.min(0.5, v));

/** Even grid of n³ equal cells. */
const gridCells = (n: number): FractureCell[] => {
  const cells: FractureCell[] = [];
  const s = 1 / n;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      for (let k = 0; k < n; k++)
        cells.push({ min: [-0.5 + i * s, -0.5 + j * s, -0.5 + k * s], max: [-0.5 + (i + 1) * s, -0.5 + (j + 1) * s, -0.5 + (k + 1) * s] });
  return cells;
};

// ── Voronoi cell fracture ─────────────────────────────────────────────────────
// Real destruction-style fracture: scatter seed points through the object's volume, then build each
// seed's Voronoi cell — the convex region of space closer to that seed than any other, clipped to the
// object box. Cutting the box by the bisecting plane between each pair of seeds yields irregular convex
// CHUNKS that tile the volume with no gaps or overlap (so no physics interpenetration), each piece a
// proper solid that matches the object's shape — not a generic triangle/cube. This is the Blender
// "Cell Fracture" / Chaos-geometry approach.

let shardSeq = 0;
type V3 = readonly [number, number, number];
const v3dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The 6 faces of an axis-aligned box [mn,mx], each an ordered polygon (the starting convex cell). */
const boxFaces = (mn: V3, mx: V3): V3[][] => [
  [[mn[0], mn[1], mx[2]], [mx[0], mn[1], mx[2]], [mx[0], mx[1], mx[2]], [mn[0], mx[1], mx[2]]], // +Z
  [[mx[0], mn[1], mn[2]], [mn[0], mn[1], mn[2]], [mn[0], mx[1], mn[2]], [mx[0], mx[1], mn[2]]], // -Z
  [[mx[0], mn[1], mx[2]], [mx[0], mn[1], mn[2]], [mx[0], mx[1], mn[2]], [mx[0], mx[1], mx[2]]], // +X
  [[mn[0], mn[1], mn[2]], [mn[0], mn[1], mx[2]], [mn[0], mx[1], mx[2]], [mn[0], mx[1], mn[2]]], // -X
  [[mn[0], mx[1], mx[2]], [mx[0], mx[1], mx[2]], [mx[0], mx[1], mn[2]], [mn[0], mx[1], mn[2]]], // +Y
  [[mn[0], mn[1], mn[2]], [mx[0], mn[1], mn[2]], [mx[0], mn[1], mx[2]], [mn[0], mn[1], mx[2]]], // -Y
];

/** Build an indexed BufferGeometry (with normals + dummy uv) from a flat vertex/index pair, for CSG. */
const csgGeometry = (vertices: Float32Array, indices: Uint32Array): THREE.BufferGeometry => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  g.setIndex(new THREE.BufferAttribute(indices, 1));
  g.computeVertexNormals();
  // three-bvh-csg interpolates a fixed attribute set; both brushes must carry the same ones.
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((vertices.length / 3) * 2), 2));
  return g;
};

/**
 * The source mesh to fracture, in the local space where verts × object.scale = world size. Imported
 * models use their real geometry; primitives synthesize a matching unit shape (so a sphere fractures into
 * spherical caps, a box into box bits, etc.). Returns geometry + local bounding box.
 */
const fractureSourceGeometry = (object: SceneObject): { geometry: THREE.BufferGeometry; mn: V3; mx: V3 } => {
  const geo = getModelGeometry(object.renderer?.modelAssetId);
  if (geo && geo.vertices.length >= 12) {
    let lx = Infinity, ly = Infinity, lz = Infinity, hx = -Infinity, hy = -Infinity, hz = -Infinity;
    for (let i = 0; i < geo.vertices.length; i += 3) {
      lx = Math.min(lx, geo.vertices[i]); hx = Math.max(hx, geo.vertices[i]);
      ly = Math.min(ly, geo.vertices[i + 1]); hy = Math.max(hy, geo.vertices[i + 1]);
      lz = Math.min(lz, geo.vertices[i + 2]); hz = Math.max(hz, geo.vertices[i + 2]);
    }
    return { geometry: csgGeometry(geo.vertices.slice(), geo.indices.slice()), mn: [lx, ly, lz], mx: [hx, hy, hz] };
  }
  // Primitive: synthesize a unit shape matching the renderer's SHARED_GEO sizes (already has pos/normal/uv).
  let prim: THREE.BufferGeometry;
  switch (object.kind) {
    case 'sphere': prim = new THREE.SphereGeometry(0.55, 20, 14); break;
    case 'capsule': prim = new THREE.CapsuleGeometry(0.34, 0.82, 6, 14); break;
    case 'plane': prim = new THREE.BoxGeometry(1, 1, 0.05); break;
    default: prim = new THREE.BoxGeometry(1, 1, 1); break;
  }
  prim.computeBoundingBox();
  const bb = prim.boundingBox!;
  return { geometry: prim, mn: [bb.min.x, bb.min.y, bb.min.z], mx: [bb.max.x, bb.max.y, bb.max.z] };
};

/** Order a coplanar point set into a polygon ring around its centroid (in the plane of normal `n`). */
const orderRing = (pts: V3[], n: V3): V3[] => {
  const uniq: V3[] = [];
  for (const p of pts) {
    if (!uniq.some((q) => Math.abs(q[0] - p[0]) < 1e-5 && Math.abs(q[1] - p[1]) < 1e-5 && Math.abs(q[2] - p[2]) < 1e-5)) uniq.push(p);
  }
  if (uniq.length < 3) return uniq;
  const c: number[] = [0, 0, 0];
  for (const p of uniq) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
  c[0] /= uniq.length; c[1] /= uniq.length; c[2] /= uniq.length;
  const nl = Math.hypot(n[0], n[1], n[2]) || 1;
  const nn: V3 = [n[0] / nl, n[1] / nl, n[2] / nl];
  let u: V3 = Math.abs(nn[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0];
  const du = v3dot(u, nn);
  u = [u[0] - nn[0] * du, u[1] - nn[1] * du, u[2] - nn[2] * du];
  const ul = Math.hypot(u[0], u[1], u[2]) || 1;
  u = [u[0] / ul, u[1] / ul, u[2] / ul];
  const w: V3 = [nn[1] * u[2] - nn[2] * u[1], nn[2] * u[0] - nn[0] * u[2], nn[0] * u[1] - nn[1] * u[0]];
  const ang = (p: V3) => Math.atan2(v3dot([p[0] - c[0], p[1] - c[1], p[2] - c[2]], w), v3dot([p[0] - c[0], p[1] - c[1], p[2] - c[2]], u));
  return uniq.slice().sort((a, b) => ang(a) - ang(b));
};

/** Clip a convex polyhedron (set of face polygons) by the half-space dot(n,x) <= d; returns the inside part. */
const clipConvex = (faces: V3[][], n: V3, d: number): V3[][] => {
  const EPS = 1e-7;
  const out: V3[][] = [];
  const cap: V3[] = [];
  for (const face of faces) {
    const nf: V3[] = [];
    const m = face.length;
    for (let i = 0; i < m; i++) {
      const a = face[i];
      const b = face[(i + 1) % m];
      const da = v3dot(n, a) - d;
      const db = v3dot(n, b) - d;
      if (da <= EPS) nf.push(a);
      if ((da < -EPS && db > EPS) || (da > EPS && db < -EPS)) {
        const t = da / (da - db);
        const p: V3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
        nf.push(p);
        cap.push(p);
      }
    }
    if (nf.length >= 3) out.push(nf);
  }
  if (cap.length >= 3) out.push(orderRing(cap, n));
  return out;
};

/** Triangulate a convex polyhedron's faces into vertices + indices, and return its centroid. */
const meshFromFaces = (faces: V3[][]): { vertices: Float32Array; indices: Uint32Array; centroid: V3 } => {
  const verts: number[] = [];
  const idx: number[] = [];
  const c: number[] = [0, 0, 0];
  let n = 0;
  for (const face of faces) {
    const base = verts.length / 3;
    for (const p of face) {
      verts.push(p[0], p[1], p[2]);
      c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; n++;
    }
    for (let i = 1; i < face.length - 1; i++) idx.push(base, base + i, base + i + 1);
  }
  if (n > 0) { c[0] /= n; c[1] /= n; c[2] /= n; }
  return { vertices: new Float32Array(verts), indices: new Uint32Array(idx), centroid: [c[0], c[1], c[2]] };
};

/**
 * Build `count` Voronoi cells over the box [mn,mx] from jittered seeds, each cell additionally clipped to
 * `clip` half-spaces (the source mesh's convex hull) so the chunks fill the object's REAL shape, not a box.
 * Returns chunk meshes in the same local space as the input box/hull.
 */
const voronoiChunks = (
  count: number,
  rng: () => number,
  jitter: number,
  mn: V3,
  mx: V3,
  clip: { n: V3; d: number }[],
): { vertices: Float32Array; indices: Uint32Array; centroid: V3 }[] => {
  const cx = (mn[0] + mx[0]) / 2, cy = (mn[1] + mx[1]) / 2, cz = (mn[2] + mx[2]) / 2;
  const ex = (mx[0] - mn[0]) / 2, ey = (mx[1] - mn[1]) / 2, ez = (mx[2] - mn[2]) / 2;
  const spread = 0.45 + 0.55 * Math.max(0, Math.min(jitter, 1));
  const inside = (p: V3) => clip.every((pl) => v3dot(pl.n, p) <= pl.d + 1e-6);
  // Reject-sample seeds INSIDE the hull so cells aren't wasted in the box corners outside the mesh.
  const seeds: V3[] = [];
  let attempts = 0;
  while (seeds.length < count && attempts < count * 30) {
    attempts++;
    const p: V3 = [cx + (rng() - 0.5) * 2 * ex * spread, cy + (rng() - 0.5) * 2 * ey * spread, cz + (rng() - 0.5) * 2 * ez * spread];
    if (clip.length && !inside(p)) continue;
    seeds.push(p);
  }
  const startFaces = boxFaces(mn, mx);
  const chunks: { vertices: Float32Array; indices: Uint32Array; centroid: V3 }[] = [];
  for (let i = 0; i < seeds.length; i++) {
    let faces = startFaces.map((f) => f.slice());
    for (let j = 0; j < seeds.length && faces.length >= 4; j++) {
      if (j === i) continue;
      const n: V3 = [seeds[j][0] - seeds[i][0], seeds[j][1] - seeds[i][1], seeds[j][2] - seeds[i][2]];
      const mid: V3 = [(seeds[i][0] + seeds[j][0]) / 2, (seeds[i][1] + seeds[j][1]) / 2, (seeds[i][2] + seeds[j][2]) / 2];
      faces = clipConvex(faces, n, v3dot(n, mid));
    }
    // Clip to the object's convex hull so the chunk is a piece of the actual shape.
    for (const pl of clip) {
      if (faces.length < 4) break;
      faces = clipConvex(faces, pl.n, pl.d);
    }
    if (faces.length < 4) continue;
    const mesh = meshFromFaces(faces);
    if (mesh.vertices.length >= 12) chunks.push(mesh);
  }
  return chunks;
};

/**
 * Break an object into pieces that are EXACT cuts of its mesh (any shape, concave included): partition
 * the volume into Voronoi cells, then boolean-INTERSECT each cell with the actual mesh (three-bvh-csg).
 * The chunks therefore reassemble into the original object. Each chunk renders its exact cut geometry and
 * gets a convex-hull collider (fine for small debris). Works for imported models AND primitives.
 */
const makeFractureShards = (source: SceneObject, origin: Vector3Tuple | undefined, count: number): SceneObject[] => {
  const cfg = { ...defaultFracture(), ...source.fracture };
  const rng = mulberry32((cfg.seed || 1) >>> 0);
  const jitter = Math.max(0, Math.min(cfg.jitter ?? 0, 1));
  const kick = Math.max(0, cfg.strength ?? 3);
  const [px, py, pz] = source.transform.position;
  const [sx, sy, sz] = source.transform.scale;
  const color = source.renderer?.color ?? '#9aa3b2';

  const src = fractureSourceGeometry(source);
  const focus =
    origin && cfg.focusImpact
      ? ([(origin[0] - px) / (sx || 1), (origin[1] - py) / (sy || 1), (origin[2] - pz) / (sz || 1)] as V3)
      : undefined;
  const quat = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(source.transform.rotation[0], source.transform.rotation[1], source.transform.rotation[2], 'XYZ'),
  );

  const evaluator = new Evaluator();
  evaluator.useGroups = false;
  evaluator.attributes = ['position', 'normal', 'uv'];
  const sourceBrush = new Brush(src.geometry);
  sourceBrush.updateMatrixWorld();

  const cells = voronoiChunks(Math.max(2, Math.min(count, 60)), rng, jitter, src.mn, src.mx, []);
  const out: SceneObject[] = [];
  for (const cell of cells) {
    let resultGeo: THREE.BufferGeometry | null = null;
    try {
      const cellBrush = new Brush(csgGeometry(cell.vertices, cell.indices));
      cellBrush.updateMatrixWorld();
      const result = evaluator.evaluate(sourceBrush, cellBrush, INTERSECTION);
      resultGeo = result.geometry;
    } catch {
      resultGeo = null;
    }
    const pos = resultGeo?.getAttribute('position');
    if (!resultGeo || !pos || pos.count < 3) continue; // cell fell outside the mesh → no piece
    // Chunk geometry (mesh-local) → scale to the object's real size.
    const src3 = pos.array as ArrayLike<number>;
    const vertices = new Float32Array(pos.count * 3);
    let cxx = 0, cyy = 0, czz = 0;
    for (let i = 0; i < pos.count; i++) {
      vertices[i * 3] = src3[i * 3] * sx;
      vertices[i * 3 + 1] = src3[i * 3 + 1] * sy;
      vertices[i * 3 + 2] = src3[i * 3 + 2] * sz;
      cxx += vertices[i * 3]; cyy += vertices[i * 3 + 1]; czz += vertices[i * 3 + 2];
    }
    cxx /= pos.count; cyy /= pos.count; czz /= pos.count;
    const idxAttr = resultGeo.getIndex();
    const indices = idxAttr ? new Uint32Array(idxAttr.array as ArrayLike<number>) : new Uint32Array(pos.count).map((_, i) => i);

    const key = `shard_${source.id}_${shardSeq++}`;
    registerRawGeometry(key, vertices, indices);

    const fx = focus ? focus[0] * sx : 0;
    const fy = focus ? focus[1] * sy : 0;
    const fz = focus ? focus[2] * sz : 0;
    const dir = new THREE.Vector3(focus ? cxx - fx : cxx, focus ? cyy - fy : cyy, focus ? czz - fz : czz).applyQuaternion(quat);
    const len = dir.length() || 1;

    out.push({
      id: makeId('shard'),
      name: `${source.name} Chunk`,
      kind: 'cube',
      transform: { position: [px, py, pz], rotation: [...source.transform.rotation] as Vector3Tuple, scale: [1, 1, 1] },
      renderer: {
        ...defaultRenderer('cube', color),
        metalness: source.renderer?.metalness ?? 0.1,
        roughness: source.renderer?.roughness ?? 0.7,
        modelAssetId: key, // drives the convex-hull collider
        fragmentKey: key, // drives rendering
      },
      physics: { ...defaultPhysics('dynamic', 'convex'), enabled: true },
      variables: { __impulse: [(dir.x / len) * kick, (dir.y / len) * kick + kick * 0.4, (dir.z / len) * kick] },
    } as SceneObject);
  }
  return out;
};

/**
 * Break an object into dynamic pieces that fly apart. 'uniform' = an even box grid (good for brick
 * walls); 'chunks' / 'shatter' = real cell fracture — Voronoi cells boolean-INTERSECTED with the actual
 * mesh (CSG), so pieces are exact cuts of any shape (concave included); 'shatter' = many more, smaller.
 * Pattern/detail/jitter/seed come from the object's fracture config; `origin` (world-space hit point)
 * makes pieces fly outward from it. Each piece carries a one-shot kick in `variables.__impulse`
 * (applied once by tickRuntime). The caller destroys the original.
 */
export const makeFractureChunks = (source: SceneObject, origin?: Vector3Tuple): SceneObject[] => {
  const cfg = { ...defaultFracture(), ...source.fracture };
  const base = Math.max(2, Math.min(Math.round(cfg.pieces) || 2, 6));

  if (cfg.pattern !== 'uniform') {
    // Voronoi cell count: 'chunks' = a few big pieces, 'shatter' = many small ones. Scales with `pieces`.
    const count = cfg.pattern === 'shatter' ? base * base * 2 : base * 3;
    return makeFractureShards(source, origin, count);
  }

  // 'uniform' → even box grid.
  const kick = Math.max(0, cfg.strength ?? 3);
  const [px, py, pz] = source.transform.position;
  const [sx, sy, sz] = source.transform.scale;
  const color = source.renderer?.color ?? '#9aa3b2';
  const focus =
    origin && cfg.focusImpact
      ? [clampHalf((origin[0] - px) / (sx || 1)), clampHalf((origin[1] - py) / (sy || 1)), clampHalf((origin[2] - pz) / (sz || 1))]
      : undefined;

  return gridCells(base).map((c) => {
    const cx = (c.min[0] + c.max[0]) / 2;
    const cy = (c.min[1] + c.max[1]) / 2;
    const cz = (c.min[2] + c.max[2]) / 2;
    const hx = c.max[0] - c.min[0];
    const hy = c.max[1] - c.min[1];
    const hz = c.max[2] - c.min[2];
    const dirX = focus ? cx - focus[0] : cx;
    const dirY = focus ? cy - focus[1] : cy;
    const dirZ = focus ? cz - focus[2] : cz;
    const len = Math.hypot(dirX, dirY, dirZ) || 1;
    return {
      id: makeId('chunk'),
      name: `${source.name} Chunk`,
      kind: 'cube',
      transform: {
        position: [px + cx * sx, py + cy * sy, pz + cz * sz],
        rotation: [0, 0, 0],
        scale: [Math.max(hx * sx, 0.04), Math.max(hy * sy, 0.04), Math.max(hz * sz, 0.04)],
      },
      renderer: { ...defaultRenderer('cube', color), metalness: source.renderer?.metalness ?? 0.1, roughness: source.renderer?.roughness ?? 0.7 },
      physics: { ...defaultPhysics('dynamic', 'box'), enabled: true },
      variables: { __impulse: [(dirX / len) * kick, (dirY / len) * kick + kick * 0.4, (dirZ / len) * kick] },
    };
  });
};

/** A runtime-spawned emitter that references a particle-system asset (Spawn Particle System node). */
export const makeSpawnedParticleEmitter = (systemId: string, position: Vector3Tuple): SceneObject => ({
  id: makeId('psfx'),
  name: 'Particle System',
  kind: 'empty',
  transform: defaultTransform([position[0], position[1], position[2]]),
  particles: { ...withParticleDefaults({ enabled: true }), systemId },
});
