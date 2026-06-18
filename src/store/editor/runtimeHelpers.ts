import type {
  GraphValue,
  GraphValueType,
  NodeForgeNodeData,
  SceneObject,
  Vector3Tuple,
} from '../../types';
import { makeSpawnedObject } from './objectFactory';
import { defaultRenderer } from './defaults';

// Monotonic id for water surface-impact ripple events (transient FX; the WaterSurface shader dedupes by it).
let waterImpactSeq = 0;
export const nextWaterImpactId = () => (waterImpactSeq = (waterImpactSeq + 1) % 1_000_000);

// Kick-up puff colour per `surface` tag (matches the SURFACE_GRIP keys the wheel raycast reads) — so a
// wheel on grass throws green-flecked sod, sand a bright tan rooster, snow a white plume, and so on.
export const SURFACE_DUST: Record<string, string> = {
  dirt: '#9a7b58',
  curb: '#b9a37e',
  grass: '#7a8f5a',
  gravel: '#8d8d93',
  sand: '#e2cb95',
  mud: '#6b5236',
  snow: '#eef3f8',
  ice: '#cfe6f5',
};

/**
 * Surface displacement of a water volume at world (px,pz) and time t — the SAME 4-octave swell the
 * WaterSurface shader renders (plus directional flow), so buoyant bodies ride the VISIBLE crest. Keep
 * this in sync with `waterHeight` in src/three/WaterSurface.tsx.
 */
export function waterSurfaceHeight(
  water: { waveAmplitude: number; waveFrequency: number; waveSpeed: number; flowStrength?: number; flowAngle?: number },
  px: number,
  pz: number,
  t: number,
): number {
  const a = water.waveAmplitude;
  const f = water.waveFrequency;
  const s = water.waveSpeed;
  let h = 0;
  h += Math.sin((px * 1 + pz * 0) * f + t * s) * a * 0.5;
  h += Math.sin((px * 0.7071 + pz * 0.7071) * f * 1.7 - t * s * 1.3) * a * 0.28;
  h += Math.sin((px * -0.6 + pz * 0.8) * f * 2.6 + t * s * 1.7) * a * 0.16;
  h += Math.sin((px * 0.2 + pz * -0.98) * f * 3.7 - t * s * 2.1) * a * 0.09;
  const flow = water.flowStrength ?? 0;
  if (flow > 0) {
    const ang = ((water.flowAngle ?? 0) * Math.PI) / 180;
    const dx = Math.cos(ang);
    const dz = Math.sin(ang);
    h += Math.sin((px * dx + pz * dz) * f * 1.2 - t * s * (1 + flow)) * a * 0.2;
  }
  return h;
}

// Pure literal coercion used by the script evaluator. Hoisted to module scope so it isn't
// re-created for every scripted object on every frame (it captures no per-object state).
export function literalValueForType(data: NodeForgeNodeData, type: GraphValueType): GraphValue {
  if (type === 'number') return Number(data.numberValue ?? data.amount ?? 0);
  if (type === 'string') return data.stringValue ?? data.message ?? '';
  if (type === 'boolean') return Boolean(data.booleanValue);
  return data.vectorValue ?? [0, 0, 0];
}

export const rotateLocalVector = (vector: Vector3Tuple, rotation: Vector3Tuple): Vector3Tuple => {
  let [x, y, z] = vector;
  const [rx, ry, rz] = rotation;
  let cos = Math.cos(rx);
  let sin = Math.sin(rx);
  [y, z] = [y * cos - z * sin, y * sin + z * cos];
  cos = Math.cos(ry);
  sin = Math.sin(ry);
  [x, z] = [x * cos + z * sin, -x * sin + z * cos];
  cos = Math.cos(rz);
  sin = Math.sin(rz);
  [x, y] = [x * cos - y * sin, x * sin + y * cos];
  return [x, y, z];
};

export const crashDebrisObject = (position: Vector3Tuple, impulse: Vector3Tuple, index: number): SceneObject => {
  const debris = makeSpawnedObject('cube', position);
  return {
    ...debris,
    name: `Crash Debris ${index + 1}`,
    transform: {
      ...debris.transform,
      rotation: [Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI],
      scale: [0.18 + Math.random() * 0.22, 0.08 + Math.random() * 0.12, 0.18 + Math.random() * 0.28],
    },
    renderer: {
      ...(debris.renderer ?? defaultRenderer('cube', '#2b2b2b')),
      color: index % 2 ? '#171717' : '#34302c',
      metalness: 0.55,
      roughness: 0.6,
    },
    physics: debris.physics ? { ...debris.physics, mass: 0.18, friction: 0.7, angularDamping: 0.15 } : debris.physics,
    variables: { ...(debris.variables ?? {}), __impulse: impulse },
  };
};

/**
 * Continuous heading (rotation about +Y; atan2 of the rotated forward vector) from an XYZ euler.
 * `rotation[1]` alone is WRONG for half of all headings: euler decomposition confines Y to ±90° and
 * represents flipped headings as (π, π−θ, π), so anything steering off the raw Y (the AI driver) drove
 * the wrong way whenever the car faced -Z. fwd = Rx·Ry·Rz·(0,0,1) = (sinY, −cosY·sinX, cosY·cosX).
 */
export const headingFromEuler = (rotation: Vector3Tuple): number =>
  Math.atan2(Math.sin(rotation[1]), Math.cos(rotation[1]) * Math.cos(rotation[0]));

/**
 * Comma-separated tag value → trimmed tokens, so per-actor tag queries don't split/trim/allocate on
 * every evaluation. Tag vars are authored strings (a small, stable set); the size cap guards against
 * a script writing ever-changing strings into a tag variable.
 */
const tagTokenCache = new Map<string, readonly string[]>();
export const tagTokens = (value: string): readonly string[] => {
  let tokens = tagTokenCache.get(value);
  if (!tokens) {
    if (tagTokenCache.size > 512) tagTokenCache.clear();
    tokens = value.split(',').map((token) => token.trim());
    tagTokenCache.set(value, tokens);
  }
  return tokens;
};

/**
 * "Checkpoint <n>" name → gate index (-1 = not a checkpoint), memoized by the (static) name string so
 * the per-tick race-support scan does a Map lookup per object instead of a regex exec. Bounded by the
 * number of distinct object names ever seen, so it never needs clearing.
 */
const checkpointIdxByName = new Map<string, number>();
export const checkpointIndexForName = (name: string): number => {
  let idx = checkpointIdxByName.get(name);
  if (idx === undefined) {
    const m = /^Checkpoint\s*(\d+)/i.exec(name);
    idx = m ? Number(m[1]) : -1;
    checkpointIdxByName.set(name, idx);
  }
  return idx;
};

/**
 * Identity-preserving guards for the per-tick state patch. tickRuntime builds fresh records/arrays
 * every frame by construction; when the CONTENTS turn out unchanged, these return the PREVIOUS
 * reference so Zustand subscribers (HUD layers, panels, render memos) don't re-render at 60fps for
 * data that didn't actually change. The shallow compare is O(entries) — far cheaper than the React
 * work a false-positive identity change triggers downstream.
 */
export const keepRecord = <T,>(prev: Record<string, T>, next: Record<string, T>): Record<string, T> => {
  if (prev === next) return next;
  const keys = Object.keys(next);
  if (keys.length !== Object.keys(prev).length) return next;
  for (const key of keys) if (!Object.is(prev[key], next[key])) return next;
  return prev;
};

export const keepArray = <T,>(prev: T[], next: T[]): T[] => {
  if (prev === next) return next;
  if (prev.length !== next.length) return next;
  for (let i = 0; i < next.length; i++) if (!Object.is(prev[i], next[i])) return next;
  return prev;
};
