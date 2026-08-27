import { makeId } from '../store/editor/ids';
import type { ModelPart, ModelPartShape, ModelSpec, ModelStyle, Vector3Tuple } from '../types';

/**
 * Model Forge data layer: the default palette, per-shape face-group metadata, spec normalization,
 * and the starter gallery. Geometry lives in modelGeometry.ts; this module is pure data so the
 * store and tests can use it without touching three.js.
 */

/** Flat stylized starter palette — warm props read against the engine's outdoor look. */
export const DEFAULT_MODEL_PALETTE: readonly string[] = [
  '#e8dcc5', // 0 cream
  '#c99860', // 1 light wood
  '#8a5c3b', // 2 dark wood
  '#9aa5ad', // 3 stone
  '#5d6d7e', // 4 slate
  '#c34a36', // 5 red
  '#e9b44c', // 6 yellow
  '#6ab04c', // 7 green
  '#4a90d9', // 8 blue
  '#3b3f46', // 9 charcoal
];

export const MODEL_PART_SHAPES: readonly ModelPartShape[] = ['box', 'cylinder', 'sphere', 'cone', 'wedge'];

/** The Spline-soft default: rounded corners, smooth shading, satin sheen. */
export const DEFAULT_MODEL_STYLE: ModelStyle = { finish: 'smooth', bevel: 0.02, roughness: 0.55 };
/** The crisp faceted Meshy alternative. */
export const FLAT_MODEL_STYLE: ModelStyle = { finish: 'flat', bevel: 0, roughness: 0.85 };

const clampNumber = (value: unknown, lo: number, hi: number, fallback: number): number =>
  Number.isFinite(value) ? Math.min(Math.max(value as number, lo), hi) : fallback;

export function normalizeModelStyle(style?: Partial<ModelStyle>): ModelStyle {
  const finish = style?.finish === 'flat' ? 'flat' : 'smooth';
  const defaults = finish === 'flat' ? FLAT_MODEL_STYLE : DEFAULT_MODEL_STYLE;
  return {
    finish,
    bevel: clampNumber(style?.bevel, 0, 0.25, defaults.bevel),
    roughness: clampNumber(style?.roughness, 0.05, 1, defaults.roughness),
  };
}

/**
 * Paintable face groups per shape, keyed by the geometry's material-group index. The keys follow
 * three.js primitive conventions (BoxGeometry orders +x,-x,+y,-y,+z,-z; cylinders side/top/bottom —
 * a cone keeps materialIndex 2 for its cap even though it has no top). Spheres have no groups, so
 * they paint as one surface.
 */
export const MODEL_FACE_GROUPS: Record<ModelPartShape, Record<number, string>> = {
  box: { 0: 'Right', 1: 'Left', 2: 'Top', 3: 'Bottom', 4: 'Front', 5: 'Back' },
  cylinder: { 0: 'Side', 1: 'Top', 2: 'Bottom' },
  cone: { 0: 'Side', 2: 'Bottom' },
  sphere: { 0: 'Surface' },
  wedge: { 0: 'Slope', 1: 'Bottom', 2: 'Back', 3: 'Left', 4: 'Right' },
};

/** Human names for the 8 box corners, by index (bit0=+X, bit1=+Y, bit2=+Z). */
export const BOX_CORNER_LABELS: readonly string[] = Array.from({ length: 8 }, (_, index) =>
  `${index & 2 ? 'Top' : 'Bottom'} ${index & 4 ? 'Front' : 'Back'} ${index & 1 ? 'Right' : 'Left'}`,
);

/** Fixed box control-cage topology. Edit mode transforms these logical components while the
 * serialized model remains the same tiny eight-corner hull. Face order deliberately matches
 * `MODEL_FACE_GROUPS.box` / Three.js BoxGeometry material groups. */
export const BOX_EDGE_CORNERS: readonly (readonly [number, number])[] = [
  [0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3], [2, 6], [3, 7], [4, 5], [4, 6], [5, 7], [6, 7],
];

export const BOX_FACE_CORNERS: readonly (readonly [number, number, number, number])[] = [
  [1, 3, 5, 7], // Right (+X)
  [0, 2, 4, 6], // Left (-X)
  [2, 3, 6, 7], // Top (+Y)
  [0, 1, 4, 5], // Bottom (-Y)
  [4, 5, 6, 7], // Front (+Z)
  [0, 1, 2, 3], // Back (-Z)
];

export type BoxComponentMode = 'vertex' | 'edge' | 'face';

export const boxComponentCount = (mode: BoxComponentMode): number =>
  mode === 'vertex' ? 8 : mode === 'edge' ? BOX_EDGE_CORNERS.length : BOX_FACE_CORNERS.length;

export const boxComponentCorners = (mode: BoxComponentMode, index: number): readonly number[] => {
  if (mode === 'vertex') return index >= 0 && index < 8 ? [index] : [];
  return (mode === 'edge' ? BOX_EDGE_CORNERS[index] : BOX_FACE_CORNERS[index]) ?? [];
};

const SHAPE_SET: ReadonlySet<string> = new Set(MODEL_PART_SHAPES);

const vec = (value: unknown, fallback: Vector3Tuple): Vector3Tuple => {
  if (!Array.isArray(value) || value.length !== 3) return [...fallback] as Vector3Tuple;
  return value.every((part) => Number.isFinite(part)) ? ([...value] as Vector3Tuple) : ([...fallback] as Vector3Tuple);
};

export function makeModelPart(shape: ModelPartShape, init: Partial<Omit<ModelPart, 'id' | 'shape'>> = {}): ModelPart {
  return {
    id: makeId('part'),
    name: init.name ?? shape.charAt(0).toUpperCase() + shape.slice(1),
    shape,
    position: vec(init.position, [0, 0.5, 0]),
    rotation: vec(init.rotation, [0, 0, 0]),
    scale: vec(init.scale, [1, 1, 1]),
    colorSlot: init.colorSlot ?? 1,
    ...(init.faceColors ? { faceColors: { ...init.faceColors } } : {}),
    ...(init.corners ? { corners: { ...init.corners } } : {}),
  };
}

const clampSlot = (slot: unknown, paletteSize: number): number => {
  const index = Number.isFinite(slot) ? Math.trunc(slot as number) : 0;
  return Math.min(Math.max(index, 0), Math.max(paletteSize - 1, 0));
};

/** Backfill defaults so specs from older saves, packages, or the AI always render safely. */
export function normalizeModelSpec(spec: ModelSpec): ModelSpec {
  const palette = Array.isArray(spec.palette) && spec.palette.length
    ? spec.palette.map((color) => (typeof color === 'string' && color.trim() ? color : '#888888'))
    : [...DEFAULT_MODEL_PALETTE];
  const parts = (Array.isArray(spec.parts) ? spec.parts : []).map((part, index): ModelPart => {
    const shape = SHAPE_SET.has(part?.shape) ? part.shape : 'box';
    const faceColors = part?.faceColors && typeof part.faceColors === 'object'
      ? Object.fromEntries(
          Object.entries(part.faceColors)
            .filter(([group]) => MODEL_FACE_GROUPS[shape][Number(group)] !== undefined)
            .map(([group, slot]) => [group, clampSlot(slot, palette.length)]),
        )
      : undefined;
    // Corner offsets only mean something on box hulls; reshaping a part sheds them.
    const corners = part?.corners && typeof part.corners === 'object' && shape === 'box'
      ? Object.fromEntries(
          Object.entries(part.corners)
            .filter(([key, offset]) => {
              const index = Number(key);
              return (
                Number.isInteger(index) && index >= 0 && index < 8 &&
                Array.isArray(offset) && offset.length === 3 &&
                offset.every((component) => Number.isFinite(component)) &&
                offset.some((component) => Math.abs(component as number) > 1e-4)
              );
            })
            .map(([key, offset]) => [
              key,
              (offset as number[]).map((component) => Math.min(2, Math.max(-2, component))) as Vector3Tuple,
            ]),
        )
      : undefined;
    return {
      id: part?.id || makeId('part'),
      name: part?.name?.trim() || `Part ${index + 1}`,
      shape,
      position: vec(part?.position, [0, 0.5, 0]),
      rotation: vec(part?.rotation, [0, 0, 0]),
      scale: vec(part?.scale, [1, 1, 1]),
      colorSlot: clampSlot(part?.colorSlot, palette.length),
      ...(faceColors && Object.keys(faceColors).length ? { faceColors } : {}),
      ...(corners && Object.keys(corners).length ? { corners } : {}),
    };
  });
  return { id: spec.id, name: spec.name?.trim() || 'Model', palette, parts, style: normalizeModelStyle(spec.style) };
}

// ------------------------------------------------------------------------------------------------
// Starter gallery — small kit-bashed props that both seed the library and teach the tool. Every
// starter sits ON the ground (origin at the model's base) so placing one never buries it.

export interface ModelStarter {
  id: string;
  name: string;
  tagline: string;
  build: () => ModelPart[];
}

const P = (shape: ModelPartShape, name: string, position: Vector3Tuple, scale: Vector3Tuple, colorSlot: number, rotation: Vector3Tuple = [0, 0, 0]): ModelPart =>
  makeModelPart(shape, { name, position, rotation, scale, colorSlot });

export const MODEL_STARTERS: readonly ModelStarter[] = [
  {
    id: 'blank',
    name: 'Blank',
    tagline: 'One box to build from.',
    build: () => [P('box', 'Box', [0, 0.5, 0], [1, 1, 1], 1)],
  },
  {
    id: 'crate',
    name: 'Wooden Crate',
    tagline: 'The classic prop: body, frame rails, and cross braces.',
    build: () => [
      P('box', 'Body', [0, 0.5, 0], [1, 1, 1], 1),
      P('box', 'Top Rail', [0, 0.98, 0], [1.08, 0.1, 1.08], 2),
      P('box', 'Bottom Rail', [0, 0.05, 0], [1.08, 0.1, 1.08], 2),
      P('box', 'Brace A', [0, 0.5, 0.53], [1.3, 0.1, 0.05], 2, [0, 0, 0.785]),
      P('box', 'Brace B', [0, 0.5, 0.53], [1.3, 0.1, 0.05], 2, [0, 0, -0.785]),
    ],
  },
  {
    id: 'fence',
    name: 'Fence Segment',
    tagline: 'Two posts, two rails, capped — tile it along a path.',
    build: () => [
      P('box', 'Post Left', [-0.9, 0.55, 0], [0.14, 1.1, 0.14], 2),
      P('box', 'Post Right', [0.9, 0.55, 0], [0.14, 1.1, 0.14], 2),
      P('box', 'Rail Top', [0, 0.85, 0], [1.95, 0.1, 0.07], 1),
      P('box', 'Rail Bottom', [0, 0.38, 0], [1.95, 0.1, 0.07], 1),
      P('cone', 'Cap Left', [-0.9, 1.17, 0], [0.2, 0.14, 0.2], 2),
      P('cone', 'Cap Right', [0.9, 1.17, 0], [0.2, 0.14, 0.2], 2),
    ],
  },
  {
    id: 'barrel',
    name: 'Barrel',
    tagline: 'Cylinder body with banded hoops and a lid.',
    build: () => [
      P('cylinder', 'Body', [0, 0.55, 0], [0.9, 1.1, 0.9], 1),
      P('cylinder', 'Hoop Low', [0, 0.22, 0], [0.95, 0.08, 0.95], 9),
      P('cylinder', 'Hoop High', [0, 0.88, 0], [0.95, 0.08, 0.95], 9),
      P('cylinder', 'Lid', [0, 1.13, 0], [0.78, 0.07, 0.78], 2),
    ],
  },
  {
    id: 'tile',
    name: 'Floor Tile',
    tagline: 'A 2x2 stone tile with an inset face — snap them into floors.',
    build: () => [
      P('box', 'Base', [0, 0.05, 0], [2, 0.1, 2], 4),
      P('box', 'Inset', [0, 0.11, 0], [1.7, 0.04, 1.7], 3),
    ],
  },
  {
    id: 'arch',
    name: 'Stone Arch',
    tagline: 'Two pillars and a lintel — a doorway or ruin in one drop.',
    build: () => [
      P('box', 'Pillar Left', [-0.8, 1, 0], [0.4, 2, 0.4], 3),
      P('box', 'Pillar Right', [0.8, 1, 0], [0.4, 2, 0.4], 3),
      P('box', 'Lintel', [0, 2.2, 0], [2.4, 0.4, 0.5], 3),
      P('box', 'Cap', [0, 2.46, 0], [2.6, 0.12, 0.6], 4),
    ],
  },
  {
    id: 'table',
    name: 'Work Table',
    tagline: 'A sturdy tabletop, apron, and four legs — a useful interior blockout.',
    build: () => [
      P('box', 'Top', [0, 1.02, 0], [2.2, 0.18, 1.2], 1),
      P('box', 'Apron Front', [0, 0.85, 0.49], [1.9, 0.22, 0.1], 2),
      P('box', 'Apron Back', [0, 0.85, -0.49], [1.9, 0.22, 0.1], 2),
      P('box', 'Leg Front Left', [-0.9, 0.45, 0.42], [0.16, 0.9, 0.16], 2),
      P('box', 'Leg Front Right', [0.9, 0.45, 0.42], [0.16, 0.9, 0.16], 2),
      P('box', 'Leg Back Left', [-0.9, 0.45, -0.42], [0.16, 0.9, 0.16], 2),
      P('box', 'Leg Back Right', [0.9, 0.45, -0.42], [0.16, 0.9, 0.16], 2),
    ],
  },
  {
    id: 'chair',
    name: 'Chair',
    tagline: 'Seat, tapered back, and four legs — ready for a room or café.',
    build: () => [
      P('box', 'Seat', [0, 0.62, 0], [1, 0.16, 1], 1),
      P('box', 'Back', [0, 1.22, -0.43], [0.9, 0.85, 0.14], 1, [-0.08, 0, 0]),
      P('box', 'Leg Front Left', [-0.38, 0.28, 0.36], [0.12, 0.56, 0.12], 2),
      P('box', 'Leg Front Right', [0.38, 0.28, 0.36], [0.12, 0.56, 0.12], 2),
      P('box', 'Leg Back Left', [-0.38, 0.28, -0.36], [0.12, 0.56, 0.12], 2),
      P('box', 'Leg Back Right', [0.38, 0.28, -0.36], [0.12, 0.56, 0.12], 2),
    ],
  },
  {
    id: 'stairs',
    name: 'Stair Flight',
    tagline: 'Five snap-friendly steps for greyboxing routes and entrances.',
    build: () => Array.from({ length: 5 }, (_, index) =>
      P('box', `Step ${index + 1}`, [0, 0.15 * (index + 1), index * 0.34], [1.8, 0.3 * (index + 1), 0.68], index % 2 ? 4 : 3),
    ),
  },
  {
    id: 'lamp',
    name: 'Floor Lamp',
    tagline: 'A compact base, stem, bulb, and bold cone shade.',
    build: () => [
      P('cylinder', 'Base', [0, 0.08, 0], [0.72, 0.16, 0.72], 9),
      P('cylinder', 'Stem', [0, 0.82, 0], [0.12, 1.48, 0.12], 9),
      P('sphere', 'Bulb', [0, 1.55, 0], [0.28, 0.28, 0.28], 0),
      P('cone', 'Shade', [0, 1.68, 0], [0.86, 0.62, 0.86], 6, [0, 0, Math.PI]),
      P('sphere', 'Finial', [0, 2.02, 0], [0.12, 0.12, 0.12], 9),
    ],
  },
  {
    id: 'rock',
    name: 'Low-poly Rock',
    tagline: 'A sculpted eight-point hull that demonstrates Edit mode immediately.',
    build: () => [
      makeModelPart('box', {
        name: 'Rock',
        position: [0, 0.52, 0],
        rotation: [0.06, 0.35, -0.04],
        scale: [1.35, 0.9, 1.05],
        colorSlot: 4,
        corners: {
          0: [0.12, 0.02, 0.08], 1: [-0.08, -0.04, 0.02], 2: [0.2, -0.12, 0.12], 3: [-0.16, 0.08, 0.02],
          4: [-0.05, 0.08, -0.14], 5: [0.1, -0.03, -0.04], 6: [-0.12, -0.08, -0.08], 7: [0.04, 0.12, -0.12],
        },
      }),
    ],
  },
  {
    id: 'robot',
    name: 'Robot Dummy',
    tagline: 'A readable character blockout for scale, cameras, and interaction tests.',
    build: () => [
      P('box', 'Torso', [0, 1.35, 0], [0.8, 0.9, 0.45], 8),
      P('box', 'Pelvis', [0, 0.82, 0], [0.65, 0.28, 0.4], 9),
      P('sphere', 'Head', [0, 2.02, 0], [0.58, 0.58, 0.58], 0),
      P('cylinder', 'Arm Left', [-0.58, 1.35, 0], [0.18, 0.9, 0.18], 8, [0, 0, -0.08]),
      P('cylinder', 'Arm Right', [0.58, 1.35, 0], [0.18, 0.9, 0.18], 8, [0, 0, 0.08]),
      P('cylinder', 'Leg Left', [-0.22, 0.4, 0], [0.22, 0.8, 0.22], 9),
      P('cylinder', 'Leg Right', [0.22, 0.4, 0], [0.22, 0.8, 0.22], 9),
      P('sphere', 'Eye Left', [-0.13, 2.08, 0.27], [0.09, 0.09, 0.06], 6),
      P('sphere', 'Eye Right', [0.13, 2.08, 0.27], [0.09, 0.09, 0.06], 6),
    ],
  },
];

/** Compact subset used by viewport/inspector quick-add surfaces; the full studio shows every kit. */
export const QUICK_MODEL_STARTER_IDS: readonly string[] = ['blank', 'crate', 'chair', 'stairs', 'lamp', 'rock'];

export const getModelStarter = (starterId: string): ModelStarter | undefined =>
  MODEL_STARTERS.find((starter) => starter.id === starterId);

export function modelSpecFromStarter(starterId: string, id: string, name?: string): ModelSpec | null {
  const starter = getModelStarter(starterId);
  if (!starter) return null;
  return { id, name: name ?? starter.name, palette: [...DEFAULT_MODEL_PALETTE], parts: starter.build(), style: { ...DEFAULT_MODEL_STYLE } };
}

/** The one-crate library a fresh project starts with, so the Model Forge never opens empty. */
export function defaultModelLibrary(): ModelSpec[] {
  return [modelSpecFromStarter('crate', 'model-starter-crate')!];
}
