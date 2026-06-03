import type {
  AssetType,
  ColliderType,
  CompareOperator,
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

import { withParticleDefaults } from '../../runtime/particlePresets';
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

const saveKeyForSlot = (slot: string) => `nodeforge.save.${slot.trim() || 'slot1'}`;

export const readSaveSlot = (slot: string): Record<string, GraphValue> | null => {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(saveKeyForSlot(slot));
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
};

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

/** A runtime-spawned emitter that references a particle-system asset (Spawn Particle System node). */
export const makeSpawnedParticleEmitter = (systemId: string, position: Vector3Tuple): SceneObject => ({
  id: makeId('psfx'),
  name: 'Particle System',
  kind: 'empty',
  transform: defaultTransform([position[0], position[1], position[2]]),
  particles: { ...withParticleDefaults({ enabled: true }), systemId },
});
