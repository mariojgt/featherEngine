import type { AssetItem, TerrainComponent, TreeSpec } from '../types';
import { defaultStylizedGrass, withTerrainDefaults } from './terrain';
import { naturalTreeSpec } from '../tree/naturalTreePresets';
// Preset libraries belong to the editor. Exported games already carry their referenced
// bytes in the project package; a blank player must not bundle every woodland scan.
export async function biomeSurfaceAssets(): Promise<AssetItem[]> {
  if (!import.meta.env.FEATHER_PLAYER) return (await import('./biomeSurfaces')).biomeSurfaceAssets();
  throw new Error('Landscape preset authoring requires the editor.');
}
export async function biomeTreeAssets(biome: TerrainBiomeId): Promise<AssetItem[]> {
  if (!import.meta.env.FEATHER_PLAYER) return (await import('./biomeTrees')).biomeTreeAssets(biome);
  throw new Error('Landscape preset authoring requires the editor.');
}
export const WOODLAND_TREE_ASSET = 'feather-woodland-trees-v3';

export const TERRAIN_BIOMES = { woodland: 'Natural Woodland', meadow: 'Wild Meadow', alpine: 'Alpine Grove' } as const;
export type TerrainBiomeId = keyof typeof TERRAIN_BIOMES;

export function biomeTreeSpecs(biome: TerrainBiomeId): TreeSpec[] {
  if (biome !== 'alpine') return [];
  const kinds = ['conifer', 'birch'] as const;
  return kinds.map((kind) => naturalTreeSpec(kind, `feather-natural-${kind}-v3`, `Natural ${kind[0].toUpperCase() + kind.slice(1)}`));
}

/** Changes vegetation and surface authoring while preserving sculpted height, paint, and foliage masks. */
export function terrainBiomePatch(terrain: TerrainComponent, biome: TerrainBiomeId, withTextures = true): TerrainComponent {
  const trees = biomeTreeSpecs(biome);
  const authored = biome !== 'alpine';
  const colors = ['#637042', '#6f5a40', '#8e8d83'];
  const kinds = ['grass', 'soil', 'rock'];
  const layers = terrain.materialLayers.slice();
  // A terrain may have had its default layers removed. Complete the biome without renaming painted IDs.
  while (layers.length < 3) {
    const kind = kinds[layers.length];
    let id = `feather-natural-layer-${kind}-v3`;
    while (layers.some((layer) => layer.id === id)) id += '-extra';
    layers.push({ id, name: kind[0].toUpperCase() + kind.slice(1), color: colors[layers.length] });
  }
  return withTerrainDefaults({ ...terrain, materialDistribution: 'ground',
    materialLayers: layers.map((layer, i) => i > 2 ? layer : { ...layer, color: withTextures ? ['#d5d9c0', '#c5c3b7', '#d6d4cd'][i] : colors[i], roughness: 0.94,
      textureAssetId: withTextures ? `feather-natural-${kinds[i]}-v3` : undefined,
      normalMapAssetId: withTextures ? `feather-natural-${kinds[i]}-normal-v3` : undefined,
      textureScale: [3, 2.3, 1.8][i], textureVariation: 0.8, normalStrength: i === 2 ? 0.85 : 0.65 }),
    foliage: { ...terrain.foliage, enabled: true, mode: 'mixed', grassSource: 'builtin', treeSource: authored ? 'model' : 'builtin',
      treeModelAssetId: authored ? WOODLAND_TREE_ASSET : undefined,
      distribution: biome === 'woodland' ? 'woodland' : 'uniform',
      understoryAssetId: biome === 'woodland' ? 'feather-woodland-ground-cover-v4' : undefined,
      understoryDensity: biome === 'woodland' ? 0.7 : 0,
      treeSpecId: trees[0]?.id, treeSpecies: trees.map((tree, index) => ({ specId: tree.id, weight: index === 0 ? 3 : 1 })),
      grassMesh: 'natural', density: biome === 'meadow' ? 1 : 0.9, treeDensity: biome === 'meadow' ? 0.12 : 0.7,
      treeSpacing: biome === 'meadow' ? 12 : 8, minScale: 0.75, maxScale: 1.1, windStrength: 0.55, flowerDensity: biome === 'meadow' ? 0.1 : 0.015,
      grassColor: '#a2ae78', treeColor: '#647747', trunkColor: '#796a52',
      stylizedGrass: { ...defaultStylizedGrass(), gradientTop: '#c9cf9a', gradientBottom: '#536346', colorNoiseStrength: 0.18, normalLift: 0.5, perspectiveCorrection: 0.05, fadeStart: 28, fadeEnd: 55 },
    },
  });
}
