import type { TreeSpec } from '../types';
import { mergeTreeSpec, normalizeTreeSpec, treeSpecFromArchetype, type TreeSpecPatch } from './treeSpec';

export type NaturalTreeKind = 'broadleaf' | 'birch' | 'shrub' | 'conifer';

const NATURAL_TREE_PATCHES: Record<NaturalTreeKind, TreeSpecPatch> = {
  broadleaf: {
    trunk: { height: 8.5, baseRadius: 0.38, taper: 0.82, curl: 0.12, heightSegments: 12, radialSegments: 12, flare: 0.38, gnarl: 0.16 },
    branches: {
      levels: 3,
      countPerLevel: [9, 7, 5],
      startHeight: 0.36,
      endHeight: 0.9,
      angle: 43,
      angleVariance: 12,
      lengthRatio: 0.4,
      radiusRatio: 0.36,
      gravity: 0.12,
      twist: 137.5,
      curlPerLevel: 0.42,
    },
    foliage: { strategy: 'leaves', density: 10, size: 0.17, sizeVariance: 0.24, droop: 0.16, crownRadius: 0.47, crownLift: 0.7, crownFill: 0 },
    look: {
      barkRamp: ['#6a5b4b', '#8d7b65', '#aa947a'],
      foliageRamp: ['#285c2b', '#4f8a36', '#78ad45'],
      translucency: { color: '#a7d86d', scale: 0.34, power: 2.8 },
      aoStrength: 0.3,
      surface: { style: 'natural', barkRoughness: 0.96, foliageRoughness: 0.88, alphaCutoff: 0.42 },
    },
    wind: { stiffnessCurve: 2.15, trunkStiffness: 0.94, levelMultiplier: [0.12, 0.28, 0.5, 0.72] },
    lod: { levels: 3, distances: [28, 64], billboardDistance: 0 },
  },
  birch: {
    trunk: { height: 10.5, baseRadius: 0.2, taper: 0.9, lean: 2.5, curl: 0.18, heightSegments: 10, radialSegments: 7, flare: 0.18, gnarl: 0.06 },
    branches: {
      levels: 3,
      countPerLevel: [9, 6, 5],
      startHeight: 0.43,
      endHeight: 0.94,
      angle: 50,
      angleVariance: 12,
      lengthRatio: 0.39,
      radiusRatio: 0.34,
      gravity: 0.18,
      twist: 137.5,
      curlPerLevel: 0.48,
    },
    foliage: { strategy: 'leaves', density: 10, size: 0.105, sizeVariance: 0.22, droop: 0.22, crownRadius: 0.33, crownLift: 0.76, crownFill: 0 },
    look: {
      barkRamp: ['#b9b5aa', '#e3dfd2', '#f0eee5'],
      foliageRamp: ['#397331', '#65a33e', '#91bf4b'],
      translucency: { color: '#b7df72', scale: 0.38, power: 2.7 },
      aoStrength: 0.26,
      surface: { style: 'natural', barkRoughness: 0.9, foliageRoughness: 0.86, alphaCutoff: 0.4 },
    },
    wind: { stiffnessCurve: 2.25, trunkStiffness: 0.94, levelMultiplier: [0.1, 0.25, 0.48, 0.7] },
    lod: { levels: 3, distances: [30, 70], billboardDistance: 0 },
  },
  shrub: {
    trunk: { height: 1.35, baseRadius: 0.09, taper: 0.84, curl: 0.14, heightSegments: 6, radialSegments: 6, flare: 0.15, gnarl: 0.12 },
    branches: {
      levels: 3,
      countPerLevel: [9, 6, 5],
      startHeight: 0.04,
      endHeight: 0.96,
      angle: 56,
      angleVariance: 16,
      lengthRatio: 0.68,
      radiusRatio: 0.36,
      gravity: 0.08,
      twist: 137.5,
      curlPerLevel: 0.38,
    },
    foliage: { strategy: 'leaves', density: 8, size: 0.085, sizeVariance: 0.25, droop: 0.12, crownRadius: 0.72, crownLift: 0.56, crownFill: 0 },
    look: {
      barkRamp: ['#49372c', '#73543b'],
      foliageRamp: ['#245a2a', '#4d8a35', '#79ad43'],
      translucency: { color: '#9bd266', scale: 0.32, power: 2.8 },
      aoStrength: 0.28,
      surface: { style: 'natural', barkRoughness: 0.97, foliageRoughness: 0.9, alphaCutoff: 0.42 },
    },
    wind: { stiffnessCurve: 2.3, trunkStiffness: 0.96, levelMultiplier: [0.08, 0.22, 0.44, 0.66] },
    lod: { levels: 3, distances: [16, 34], billboardDistance: 0 },
  },
  conifer: {
    trunk: { height: 11.5, baseRadius: 0.3, taper: 0.9, curl: 0.035, heightSegments: 10, radialSegments: 7, flare: 0.3, gnarl: 0.1 },
    branches: {
      levels: 2,
      countPerLevel: [18, 12],
      startHeight: 0.14,
      endHeight: 0.94,
      angle: 68,
      angleVariance: 8,
      lengthRatio: 0.34,
      radiusRatio: 0.32,
      gravity: 0.42,
      twist: 137.5,
      curlPerLevel: 0.22,
    },
    foliage: { strategy: 'leaves', density: 8, size: 0.14, sizeVariance: 0.2, droop: 0.28, crownRadius: 0.28, crownLift: 0.56, crownFill: 0 },
    look: {
      barkRamp: ['#49372c', '#70533d', '#806247'],
      foliageRamp: ['#163f2b', '#28623a', '#417c43'],
      translucency: { color: '#75b35f', scale: 0.24, power: 3.1 },
      aoStrength: 0.34,
      surface: { style: 'natural', barkRoughness: 0.98, foliageRoughness: 0.92, alphaCutoff: 0.38 },
    },
    wind: { stiffnessCurve: 2.4, trunkStiffness: 0.97, levelMultiplier: [0.08, 0.2, 0.42, 0.6] },
    lod: { levels: 3, distances: [34, 78], billboardDistance: 0 },
  },
};

const DEFAULT_NAMES: Record<NaturalTreeKind, string> = {
  broadleaf: 'Natural Broadleaf',
  birch: 'Natural Birch',
  shrub: 'Natural Shrub',
  conifer: 'Natural Conifer',
};

/**
 * Builds an explicitly natural tree without changing any legacy archetype/default geometry.
 * Broadleaf leaf lengths are species-dependent (roughly 6–21 cm); conifers use similarly bounded needle sprays.
 */
export function naturalTreeSpec(kind: NaturalTreeKind, id = `natural-${kind}`, name = DEFAULT_NAMES[kind]): TreeSpec {
  const base = treeSpecFromArchetype(kind, id, name);
  return normalizeTreeSpec(mergeTreeSpec(base, NATURAL_TREE_PATCHES[kind]));
}
