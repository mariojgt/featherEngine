import type { TreeArchetype, TreePixelLeafArt, TreeSpec } from '../../types';
import {
  mergeTreeSpec,
  normalizeTreeSpec,
  treeSpecFromArchetype,
  type TreeSpecPatch,
} from '../../tree/treeSpec';

export type PixelTreeHabit = 'young' | 'spread' | 'candelabra' | 'leaning' | 'ancient';

export interface PixelTreeSpecies {
  id: string;
  name: string;
  tagline: string;
  archetype: TreeArchetype;
  leafArt: TreePixelLeafArt;
  bark: readonly [string, string];
  leaves: readonly [string, string];
  patch: TreeSpecPatch;
}

export interface PixelTreeHabitDefinition {
  id: PixelTreeHabit;
  name: string;
  description: string;
  height: number;
  radius: number;
  branchCount: number;
  crownRadius: number;
  density: number;
  lean: number;
}

export interface PixelTreeRecipe {
  speciesId: string;
  habit: PixelTreeHabit;
  scale: number;
  leafDensity: number;
  leafInner?: string;
  leafOuter?: string;
}

export const PIXEL_TREE_SPECIES: readonly PixelTreeSpecies[] = [
  {
    id: 'oak',
    name: 'Oak',
    tagline: 'Heavy rounded clumps and deep old branches.',
    archetype: 'broadleaf',
    leafArt: 'broad',
    bark: ['#493522', '#7d5a35'],
    leaves: ['#294d28', '#79a84a'],
    patch: {
      trunk: { height: 7.4, baseRadius: 0.5, flare: 0.55, gnarl: 0.38 },
      branches: { levels: 3, countPerLevel: [6, 3, 2], angle: 43, gravity: 0.18, lengthRatio: 0.64 },
      foliage: { crownRadius: 0.62, crownLift: 0.7, crownFill: 0.8, droop: 0.2 },
    },
  },
  {
    id: 'maple',
    name: 'Maple',
    tagline: 'Five-pointed leaf bites with a bright layered crown.',
    archetype: 'broadleaf',
    leafArt: 'star',
    bark: ['#59412c', '#896844'],
    leaves: ['#7d2e20', '#e18a35'],
    patch: {
      trunk: { height: 7, baseRadius: 0.4, flare: 0.38, gnarl: 0.25 },
      branches: { levels: 2, countPerLevel: [7, 4], angle: 48, gravity: 0.12, lengthRatio: 0.61 },
      foliage: { crownRadius: 0.59, crownLift: 0.72, crownFill: 0.74, droop: 0.12 },
    },
  },
  {
    id: 'birch',
    name: 'Birch',
    tagline: 'An airy fine-leaf canopy with visible sky holes.',
    archetype: 'birch',
    leafArt: 'fine',
    bark: ['#b8b1a2', '#f0e9d9'],
    leaves: ['#48712d', '#a7c958'],
    patch: {
      trunk: { height: 10.5, baseRadius: 0.17, radialSegments: 5, gnarl: 0.08 },
      branches: { levels: 2, countPerLevel: [6, 3], startHeight: 0.48, angle: 56, gravity: -0.08, lengthRatio: 0.48 },
      foliage: { crownRadius: 0.4, crownLift: 0.78, crownFill: 0.56, size: 0.72, droop: 0.22 },
    },
  },
  {
    id: 'cherry',
    name: 'Cherry Blossom',
    tagline: 'Pale petal masses with bright blossom specks.',
    archetype: 'broadleaf',
    leafArt: 'blossom',
    bark: ['#513841', '#8d6268'],
    leaves: ['#b95882', '#ffd0df'],
    patch: {
      trunk: { height: 6.2, baseRadius: 0.35, curl: 0.32, flare: 0.42, gnarl: 0.24 },
      branches: { levels: 3, countPerLevel: [5, 3, 2], angle: 52, angleVariance: 20, gravity: 0.08, lengthRatio: 0.6 },
      foliage: { crownRadius: 0.64, crownLift: 0.68, crownFill: 0.78, size: 0.9, droop: 0.24 },
    },
  },
  {
    id: 'jungle',
    name: 'Jungle Giant',
    tagline: 'Broad ribbed leaves around a muscular rainforest frame.',
    archetype: 'broadleaf',
    leafArt: 'jungle',
    bark: ['#3e3420', '#74623a'],
    leaves: ['#174c2f', '#39a95d'],
    patch: {
      trunk: { height: 9.5, baseRadius: 0.78, flare: 0.9, gnarl: 0.48 },
      branches: { levels: 2, countPerLevel: [7, 4], startHeight: 0.5, angle: 44, gravity: 0.22, lengthRatio: 0.68 },
      foliage: { crownRadius: 0.7, crownLift: 0.74, crownFill: 0.82, size: 1.05, droop: 0.25 },
    },
  },
  {
    id: 'willow',
    name: 'Willow',
    tagline: 'Open hanging ribbons that sway like a leaf curtain.',
    archetype: 'willow',
    leafArt: 'ribbon',
    bark: ['#4d412d', '#82704b'],
    leaves: ['#476537', '#a3b96a'],
    patch: {
      trunk: { height: 6, baseRadius: 0.55, curl: 0.48, flare: 0.58, gnarl: 0.3 },
      branches: { levels: 2, countPerLevel: [7, 4], startHeight: 0.3, angle: 38, gravity: -0.18, lengthRatio: 0.72 },
      foliage: { crownRadius: 0.72, crownLift: 0.64, crownFill: 0.5, size: 0.88, droop: 0.82 },
    },
  },
  {
    id: 'pine',
    name: 'Pine',
    tagline: 'Toothed needle sprays build a clean conifer silhouette.',
    archetype: 'conifer',
    leafArt: 'needle',
    bark: ['#4b3525', '#765339'],
    leaves: ['#17392b', '#44795a'],
    patch: {
      trunk: { height: 11.5, baseRadius: 0.34, taper: 0.9, radialSegments: 6, gnarl: 0.18 },
      branches: { levels: 2, countPerLevel: [12, 2], startHeight: 0.18, endHeight: 0.94, angle: 72, gravity: -0.38, lengthRatio: 0.38 },
      foliage: { crownRadius: 0.3, crownLift: 0.58, crownFill: 0.56, size: 0.72, droop: 0.45 },
    },
  },
  {
    id: 'lanternwood',
    name: 'Lanternwood',
    tagline: 'Fantasy seed pods with pale cores and dark rims.',
    archetype: 'broadleaf',
    leafArt: 'pod',
    bark: ['#332b45', '#69547d'],
    leaves: ['#6f5b24', '#ffe47b'],
    patch: {
      trunk: { height: 7.8, baseRadius: 0.42, lean: 4, curl: 0.38, flare: 0.36, gnarl: 0.34 },
      branches: { levels: 2, countPerLevel: [6, 4], startHeight: 0.44, angle: 42, gravity: 0.18, lengthRatio: 0.62 },
      foliage: { crownRadius: 0.58, crownLift: 0.72, crownFill: 0.7, size: 0.9, droop: 0.32 },
    },
  },
  {
    id: 'spiralwood',
    name: 'Spiralwood',
    tagline: 'Open quill fans give this fantasy tree a unique read.',
    archetype: 'broadleaf',
    leafArt: 'quill',
    bark: ['#253f46', '#4f7c79'],
    leaves: ['#366a75', '#83d6c7'],
    patch: {
      trunk: { height: 8.5, baseRadius: 0.44, lean: 8, curl: 0.62, flare: 0.3, gnarl: 0.22 },
      branches: { levels: 2, countPerLevel: [5, 3], startHeight: 0.5, angle: 36, gravity: 0.38, twist: 112, lengthRatio: 0.58 },
      foliage: { crownRadius: 0.52, crownLift: 0.78, crownFill: 0.62, size: 0.9, droop: 0.1 },
    },
  },
] as const;

export const PIXEL_TREE_HABITS: readonly PixelTreeHabitDefinition[] = [
  { id: 'young', name: 'Young', description: 'Compact and light.', height: 0.66, radius: 0.7, branchCount: 0.72, crownRadius: 0.82, density: 0.8, lean: 0 },
  { id: 'spread', name: 'Spread', description: 'Low, wide canopy.', height: 0.9, radius: 1.08, branchCount: 1.12, crownRadius: 1.2, density: 1.08, lean: 0 },
  { id: 'candelabra', name: 'Candelabra', description: 'Strong upward limbs.', height: 1.08, radius: 1.05, branchCount: 0.92, crownRadius: 0.92, density: 1, lean: 0 },
  { id: 'leaning', name: 'Leaning', description: 'A windswept directional silhouette.', height: 1, radius: 1, branchCount: 1, crownRadius: 1, density: 1, lean: 18 },
  { id: 'ancient', name: 'Ancient', description: 'Massive trunk and layered crown.', height: 1.32, radius: 1.55, branchCount: 1.24, crownRadius: 1.2, density: 1.28, lean: 3 },
] as const;

export const DEFAULT_PIXEL_TREE_RECIPE: PixelTreeRecipe = {
  speciesId: 'oak',
  habit: 'spread',
  scale: 1,
  leafDensity: 1,
};

export function findPixelTreeSpecies(speciesId: string): PixelTreeSpecies {
  return PIXEL_TREE_SPECIES.find((entry) => entry.id === speciesId) ?? PIXEL_TREE_SPECIES[0];
}

export function findPixelTreeHabit(habitId: PixelTreeHabit): PixelTreeHabitDefinition {
  return PIXEL_TREE_HABITS.find((entry) => entry.id === habitId) ?? PIXEL_TREE_HABITS[0];
}

const roundedCount = (value: number) => Math.max(1, Math.round(value));

/** Materialize one compact recipe into Feather's ordinary deterministic TreeSpec. */
export function pixelTreeSpec(recipe: PixelTreeRecipe, id: string, name?: string): TreeSpec {
  const species = findPixelTreeSpecies(recipe.speciesId);
  const habit = findPixelTreeHabit(recipe.habit);
  const scale = clamp(recipe.scale, 0.55, 1.8);
  const leafDensity = clamp(recipe.leafDensity, 0.5, 1.8);

  let spec = mergeTreeSpec(treeSpecFromArchetype(species.archetype, id, name ?? `Pixel ${species.name} — ${habit.name}`), species.patch);
  const branchCounts = spec.branches.countPerLevel.map((count) => roundedCount(count * habit.branchCount));
  const ancient = habit.id === 'ancient';
  const candelabra = habit.id === 'candelabra';
  spec = mergeTreeSpec(spec, {
    trunk: {
      height: spec.trunk.height * habit.height * scale,
      baseRadius: spec.trunk.baseRadius * habit.radius * Math.sqrt(scale),
      lean: spec.trunk.lean + habit.lean,
      curl: clamp(spec.trunk.curl * (habit.id === 'leaning' ? 1.35 : 1), 0, 1),
      radialSegments: Math.min(spec.trunk.radialSegments, 6),
      heightSegments: Math.min(spec.trunk.heightSegments, 8),
      gnarl: clamp(spec.trunk.gnarl + (ancient ? 0.18 : 0), 0, 1),
      flare: clamp(spec.trunk.flare + (ancient ? 0.18 : 0), 0, 1),
    },
    branches: {
      levels: ancient ? Math.max(2, spec.branches.levels) : spec.branches.levels,
      countPerLevel: branchCounts,
      angle: clamp(spec.branches.angle + (habit.id === 'spread' ? 10 : candelabra ? -13 : 0), 5, 110),
      gravity: candelabra ? 0.58 : spec.branches.gravity,
      lengthRatio: clamp(spec.branches.lengthRatio * (habit.id === 'spread' ? 1.12 : 1), 0.1, 0.92),
    },
    foliage: {
      strategy: 'cards',
      density: clamp(spec.foliage.density * habit.density * leafDensity, 1, 8),
      size: clamp(spec.foliage.size * Math.sqrt(scale), 0.45, 1.5),
      sizeVariance: 0.22,
      crownRadius: clamp(spec.foliage.crownRadius * habit.crownRadius, 0.12, 1.4),
      crownFill: clamp(spec.foliage.crownFill + (ancient ? 0.1 : 0), 0, 1),
      cardsPerCluster: clamp(Math.round((spec.foliage.cardsPerCluster ?? 5) * Math.sqrt(leafDensity)), 2, 8),
    },
    look: {
      barkRamp: [...species.bark],
      foliageRamp: [recipe.leafInner ?? species.leaves[0], recipe.leafOuter ?? species.leaves[1]],
      aoStrength: species.leafArt === 'blossom' ? 0.28 : 0.46,
      translucency: {
        color: recipe.leafOuter ?? species.leaves[1],
        scale: 0.12,
        power: 2.4,
      },
      pixelArt: {
        enabled: true,
        leafArt: species.leafArt,
        alphaCutoff: 0.42,
        billboard: true,
      },
    },
  });
  return normalizeTreeSpec({ ...spec, id, name: name ?? `Pixel ${species.name} — ${habit.name}` });
}

/** Stable equality for reuse in the project library; ids and display names are intentionally ignored. */
export function pixelTreeSignature(spec: Readonly<TreeSpec>): string {
  const { id: _id, name: _name, ...recipe } = spec;
  return JSON.stringify(recipe);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}
