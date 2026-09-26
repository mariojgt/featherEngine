import * as THREE from 'three';
import type { TerrainComponent, Vector3Tuple } from '../types';
import { sampleFoliageMask, sampleTerrainLayerWeights, sampleTerrainLocalHeight, sampleTerrainMaterialLayer, sampleTerrainNormal, terrainChunkBounds, terrainHash01, type TerrainChunkKey } from './terrain';

import { chooseTreeSpecies, spacedTreeCandidates, treeCandidateAllowed, vegetationElevationAllowed } from './vegetationRules';
import { emptyGroundCover, woodlandCanopies, canopyCover, generateGroundCover } from './woodland';

const dummyObject = new THREE.Object3D();
function composeMatrix(position: Vector3Tuple, yaw: number, scale: Vector3Tuple) {
  dummyObject.position.set(position[0], position[1], position[2]);
  dummyObject.rotation.set(0, yaw, 0);
  dummyObject.scale.set(scale[0], scale[1], scale[2]);
  dummyObject.updateMatrix();
  return dummyObject.matrix.clone();
}

// Wildflower bloom palette — hand-picked bright meadow colors, sampled per instance by a hash so a field
// reads as scattered varied wildflowers (BOTW). Stored as THREE.Color for direct setColorAt use.
const FLOWER_PALETTE = [
  new THREE.Color('#eef0e6'), // soft white (daisies — repeated so white dominates)
  new THREE.Color('#eef0e6'),
  new THREE.Color('#ecd77a'), // soft yellow
  new THREE.Color('#e58aa8'), // soft pink
  new THREE.Color('#b48fd6'), // soft lavender
  new THREE.Color('#e8975a'), // soft orange
];

export interface VegetationGenerationOptions {
  grass?: boolean;
  trees?: boolean;
  flowers?: boolean;
  groundCover?: boolean;
}

export function generateVegetationChunk(terrain: TerrainComponent, chunk: TerrainChunkKey, options: VegetationGenerationOptions = {}) {
  const chunks = [chunk];
  const foliage = terrain.foliage;
  const grass: THREE.Matrix4[] = [];
  const grassColors: THREE.Color[] = [];
  const flowers: THREE.Matrix4[] = [];
  const flowerColors: THREE.Color[] = [];
  const trunks: THREE.Matrix4[] = [];
  const crowns: THREE.Matrix4[] = [];
  const treeModels: THREE.Matrix4[] = [];
  const treeSpecies: string[] = [];
  let groundCover = emptyGroundCover();
  if (!foliage.enabled) return { grass, grassColors, flowers, flowerColors, trunks, crowns, treeModels, treeSpecies, groundCover };

  const wantsGrass = options.grass !== false && (foliage.mode === 'grass' || foliage.mode === 'mixed');
  const wantsTrees = options.trees !== false && (foliage.mode === 'trees' || foliage.mode === 'mixed');
  const wantsFlowers = options.flowers !== false && (foliage.mode === 'grass' || foliage.mode === 'mixed');
  const flowerDensity = wantsFlowers ? Math.max(0, Math.min(1, foliage.flowerDensity ?? 0)) : 0;
  const chunkArea = terrain.chunkSize * terrain.chunkSize;
  // Painted (mask) mode: scatter the FULL candidate pool and let the per-point mask decide where they
  // survive, so grass appears only where you painted. Uniform mode: candidate count scales with density.
  const useMask = Boolean(foliage.usePaintMask);
  // Grass scatter density. The high factor makes each near-camera chunk a THICK lawn (density=1 → ~2000
  // blades per 32² chunk). Combined with nearest-first chunks + the instance cap, the dense grass forms a
  // bounded disc around the player — so it stays one cheap instanced draw call no matter how big the world.
  // Want denser? Raise foliage.density toward 1; want a bigger dense radius? raise the cap (costs more CPU
  // on regen). Lawn-thick everywhere isn't free — concentrate the budget near the camera instead.
  // A `clump` instance is ALREADY a whole tuft (a card of ~28 painted strokes), so it scatters differently
  // from the single-blade styles below: one card per cluster spread evenly, rather than a knot of blades.
  // That means no blades-per-tuft multiplier to amortise, so it needs a higher per-candidate factor to reach
  // the same ground coverage once the patchiness pass below has culled its share.
  const isClumpGrass = foliage.grassMesh === 'clump';
  const grassFactor = isClumpGrass ? 7 : 3.4;
  const grassPerChunk = wantsGrass ? Math.floor(chunkArea * grassFactor * (useMask ? 1 : foliage.density)) : 0;
  const treesPerChunk = wantsTrees ? Math.max(0, Math.floor(chunkArea * (useMask ? 0.006 : foliage.treeDensity * 0.006))) : 0;
  // Flowers are a sparse accent among the grass — far fewer than blades so they read as scattered blooms.
  const flowersPerChunk = flowerDensity > 0 ? Math.floor(chunkArea * flowerDensity * 0.28) : 0;
  const maxGrass = 8192;
  const maxTrees = 256;
  const maxFlowers = 2048;

  // Reusable color scratch for the ground-borrowed grass tints (avoids allocating per tuft).
  const grassTargetColor = new THREE.Color(foliage.grassColor);
  const grassGround = new THREE.Color();
  const grassBase = new THREE.Color();

  for (const chunk of chunks) {
    const bounds = terrainChunkBounds(terrain, chunk.x, chunk.z);
    const canopies = woodlandCanopies(terrain, chunk);
    if (options.groundCover !== false) groundCover = generateGroundCover(terrain, chunk, canopies);
    // --- MyAge-style meadow grass. Three things make it read as a real lush field instead of a green fuzz
    //     layer: (1) PATCHY density noise carves lush clumps + near-bare pockets; (2) each TUFT shares one
    //     lean angle + height (a tidy pom, not a fist of blades pointing everywhere); (3) blades BORROW the
    //     ground color, nudged only ~40% toward the grass green and a touch darker, so they melt into the
    //     turf — plus a gentle per-tuft painterly warm/cool + value shift so it reads hand-painted. ---
    const grassTarget = grassTargetColor;
    const GRASS_TUFT = isClumpGrass ? 1 : 5;
    if (wantsGrass && foliage.grassMesh === 'natural') {
      // One irregular patch per jittered cell. Density thins a fixed grid, so adjacent chunks and
      // density edits share the same candidate positions. A cap bounds very large authored chunks.
      const spacing = Math.max(0.48, terrain.chunkSize / 96);
      const up = new THREE.Vector3(0, 1, 0), normal = new THREE.Vector3();
      const alignment = new THREE.Quaternion(), spin = new THREE.Quaternion();
      for (let iz = Math.floor(bounds.minZ / spacing); iz < Math.ceil(bounds.maxZ / spacing); iz++) {
        for (let ix = Math.floor(bounds.minX / spacing); ix < Math.ceil(bounds.maxX / spacing) && grass.length < maxGrass; ix++) {
          const x = (ix + 0.5 + (terrainHash01(terrain.seed + 9001, ix, iz) - 0.5) * 0.8) * spacing;
          const z = (iz + 0.5 + (terrainHash01(terrain.seed + 9002, ix, iz) - 0.5) * 0.8) * spacing;
          if (x < bounds.minX || x >= bounds.maxX || z < bounds.minZ || z >= bounds.maxZ || Math.abs(x) > terrain.size / 2 || Math.abs(z) > terrain.size / 2) continue;
          let cover = 0.8 + 0.15 * Math.sin(x * 0.13 + Math.sin(z * 0.1)) * Math.cos(z * 0.09);
          // Ground mode leaves exposed soil and painted rock clear; legacy grass scatter stays unchanged.
          if (terrain.materialDistribution === 'ground') cover *= Math.pow(sampleTerrainLayerWeights(terrain, x, z)[0] ?? 0, 1.5);
          const shade = canopyCover(canopies, x, z);
          cover *= 1 - shade * .78;
          const density = useMask ? sampleFoliageMask(terrain, x, z) : foliage.density;
          if (terrainHash01(terrain.seed + 9003, ix, iz) >= density * cover) continue;
          const h = sampleTerrainLocalHeight(terrain, x, z);
          if (!vegetationElevationAllowed(terrain, h)) continue;
          normal.fromArray(sampleTerrainNormal(terrain, x, z));
          if (normal.y < foliage.slopeLimit) continue;
          const scale = THREE.MathUtils.lerp(foliage.minScale, foliage.maxScale, terrainHash01(terrain.seed + 9004, ix, iz));
          alignment.setFromUnitVectors(up, normal);
          spin.setFromAxisAngle(up, terrainHash01(terrain.seed + 9005, ix, iz) * Math.PI * 2);
          dummyObject.position.set(x, h - 0.025, z);
          dummyObject.quaternion.copy(alignment).multiply(spin);
          dummyObject.scale.set(scale, scale * (0.72 + terrainHash01(terrain.seed + 9006, ix, iz) * 0.45) * (1 - shade * .32), scale);
          dummyObject.updateMatrix();
          grass.push(dummyObject.matrix.clone());
          grassColors.push(grassTarget.clone());
        }
      }
    }
    const grassClusters = foliage.grassMesh === 'natural' ? 0 : Math.min(12000, Math.ceil(grassPerChunk / GRASS_TUFT));
    for (let c = 0; c < grassClusters && grass.length < maxGrass; c += 1) {
      const crx = terrainHash01(terrain.seed + 5001, chunk.x, chunk.z, c * 2);
      const crz = terrainHash01(terrain.seed + 5002, chunk.x, chunk.z, c * 2 + 1);
      const cX = bounds.minX + crx * terrain.chunkSize;
      const cZ = bounds.minZ + crz * terrain.chunkSize;
      if (Math.abs(cX) > terrain.size / 2 || Math.abs(cZ) > terrain.size / 2) continue;
      if (!vegetationElevationAllowed(terrain, sampleTerrainLocalHeight(terrain, cX, cZ))) continue;
      const normalY = sampleTerrainNormal(terrain, cX, cZ)[1];
      if (normalY < foliage.slopeLimit) continue;
      // Patchy: low-freq noise = probability this tuft survives → lush pockets + bare gaps.
      const dens = Math.max(0, Math.min(1, 0.44
        + 0.4 * (Math.sin(cX * 0.052 + 1.3) * Math.sin(cZ * 0.047 + 2.7)
          + 0.6 * Math.sin(cX * 0.017 - cZ * 0.023 + 4.1)
          + 0.4 * Math.sin(cX * 0.09 + cZ * 0.075 + 0.6))));
      if (terrainHash01(terrain.seed + 5006, chunk.x, chunk.z, c) > dens) continue;
      if (useMask) {
        const mask = sampleFoliageMask(terrain, cX, cZ);
        if (mask <= 0 || terrainHash01(terrain.seed + 5005, chunk.x, chunk.z, c) > mask) continue;
      }
      // Ground-borrowed blade color for this tuft — halfway to the grass green so blades read a touch
      // fresher/brighter than the turf they stand on (catching light), while still melting into it.
      grassGround.set(sampleTerrainMaterialLayer(terrain, cX, cZ, undefined, normalY).color);
      grassBase.copy(grassGround).lerp(grassTarget, 0.55).multiplyScalar(1.02);
      const warmCool = Math.sin(cX * 0.031 + 1.1) * Math.sin(cZ * 0.036 + 2.3);
      const valueVar = Math.sin(cX * 0.019 - cZ * 0.024 + 5.0);
      grassBase.r *= 1 + warmCool * 0.06 + valueVar * 0.05;
      grassBase.g *= 1 + valueVar * 0.045;
      grassBase.b *= 1 - warmCool * 0.06 + valueVar * 0.04;
      const tuftAngle = terrainHash01(terrain.seed + 5007, chunk.x, chunk.z, c) * Math.PI;
      const tuftH = 0.72 + dens * 0.5;
      // Clump cards stay one-per-cluster: stacking several inside a 0.6-unit jitter knots them into a lump
      // and leaves the ground between clusters bare, instead of reading as continuous turf.
      const tuftBlades = isClumpGrass ? 1 : 2 + Math.floor(dens * 4);
      for (let k = 0; k < tuftBlades && grass.length < maxGrass; k += 1) {
        const sk = c * 16 + k;
        const jx = (terrainHash01(terrain.seed + 5101, chunk.x, chunk.z, sk * 2) - 0.5) * 0.6;
        const jz = (terrainHash01(terrain.seed + 5102, chunk.x, chunk.z, sk * 2 + 1) - 0.5) * 0.6;
        const localX = cX + jx;
        const localZ = cZ + jz;
        if (Math.abs(localX) > terrain.size / 2 || Math.abs(localZ) > terrain.size / 2) continue;
        const h = sampleTerrainLocalHeight(terrain, localX, localZ);
      if (!vegetationElevationAllowed(terrain, h)) continue;
        const s = THREE.MathUtils.lerp(foliage.minScale, foliage.maxScale, terrainHash01(terrain.seed + 5003, chunk.x, chunk.z, sk)) * tuftH;
        // Whole tuft leans one way, ±small per-blade variance → a tidy pom, not a chaotic fist of blades.
        const yaw = tuftAngle + (terrainHash01(terrain.seed + 5004, chunk.x, chunk.z, sk) - 0.5) * 0.5;
        grass.push(composeMatrix([localX, h, localZ], yaw, [0.7 * s, s, 0.7 * s]));
        const jitter = 0.95 + terrainHash01(terrain.seed + 5008, chunk.x, chunk.z, sk) * 0.1;
        grassColors.push(new THREE.Color(grassBase.r * jitter, grassBase.g * jitter, grassBase.b * jitter));
      }
    }
    for (let i = 0; i < Math.min(4096, flowersPerChunk) && flowers.length < maxFlowers; i += 1) {
      const rx = terrainHash01(terrain.seed + 6001, chunk.x, chunk.z, i * 2);
      const rz = terrainHash01(terrain.seed + 6002, chunk.x, chunk.z, i * 2 + 1);
      const localX = bounds.minX + rx * terrain.chunkSize;
      const localZ = bounds.minZ + rz * terrain.chunkSize;
      if (Math.abs(localX) > terrain.size / 2 || Math.abs(localZ) > terrain.size / 2) continue;
      const normal = sampleTerrainNormal(terrain, localX, localZ);
      if (normal[1] < foliage.slopeLimit) continue;
      if (useMask) {
        const mask = sampleFoliageMask(terrain, localX, localZ);
        if (mask <= 0 || terrainHash01(terrain.seed + 6005, chunk.x, chunk.z, i) > mask) continue;
      }
      const h = sampleTerrainLocalHeight(terrain, localX, localZ);
      if (!vegetationElevationAllowed(terrain, h)) continue;
      // Flowers are SMALL dabs of color nestled in the grass — kept little so they read as blooms, not
      // big flat cards. They stand just proud of the blades.
      const s = THREE.MathUtils.lerp(0.5, 0.85, terrainHash01(terrain.seed + 6003, chunk.x, chunk.z, i));
      const yaw = terrainHash01(terrain.seed + 6004, chunk.x, chunk.z, i) * Math.PI * 2;
      flowers.push(composeMatrix([localX, h, localZ], yaw, [0.26 * s, 0.5 * s, 0.26 * s]));
      const colorIndex = Math.floor(terrainHash01(terrain.seed + 6006, chunk.x, chunk.z, i) * FLOWER_PALETTE.length) % FLOWER_PALETTE.length;
      flowerColors.push(FLOWER_PALETTE[colorIndex]);
    }
    const treeCandidates = !wantsTrees ? [] : foliage.treeSpacing
      ? spacedTreeCandidates(terrain, chunk)
      : Array.from({ length: Math.min(1024, treesPerChunk) }, (_, i) => ({
          x: bounds.minX + terrainHash01(terrain.seed + 7001, chunk.x, chunk.z, i * 2) * terrain.chunkSize,
          z: bounds.minZ + terrainHash01(terrain.seed + 7002, chunk.x, chunk.z, i * 2 + 1) * terrain.chunkSize,
          key: i,
        }));
    for (const candidate of treeCandidates) {
      if (trunks.length >= maxTrees) break;
      const { x: localX, z: localZ, key: i } = candidate;
      if (!treeCandidateAllowed(terrain, candidate, chunk)) continue;
      const h = sampleTerrainLocalHeight(terrain, localX, localZ);
      // The 1.9 boost exists because the built-in cone/sphere crowns are only ~1 unit tall. A parametric
      // tree asset already specifies its real height (a pine is 12 units), so boosting it too gives a
      // 30-unit monster — scale those by the authored range alone.
      const specId = foliage.treeSource === 'builtin' ? (chooseTreeSpecies(foliage.treeSpecies, terrainHash01(terrain.seed + 7200, chunk.x, chunk.z, i)) ?? foliage.treeSpecId) : undefined;
      const treeScaleBoost = specId ? 0.75 : 1.9;
      const s = THREE.MathUtils.lerp(foliage.minScale, foliage.maxScale, terrainHash01(terrain.seed + 7003, chunk.x, chunk.z, i)) * treeScaleBoost;
      const yaw = terrainHash01(terrain.seed + 7004, chunk.x, chunk.z, i) * Math.PI * 2;
      treeModels.push(composeMatrix([localX, h, localZ], yaw, [s, s, s]));
      treeSpecies.push(specId ?? '');
      if (foliage.treeMesh === 'fir') {
        // Tall conifer: a short thin trunk with a stacked-tier fir crown draping over it from the base up.
        trunks.push(composeMatrix([localX, h + 0.3 * s, localZ], yaw, [0.12 * s, 0.62 * s, 0.12 * s]));
        crowns.push(composeMatrix([localX, h + 0.14 * s, localZ], yaw, [1.5 * s, 2.5 * s, 1.5 * s]));
      } else {
        trunks.push(composeMatrix([localX, h + 0.48 * s, localZ], yaw, [0.18 * s, 0.95 * s, 0.18 * s]));
        crowns.push(composeMatrix([localX, h + 1.23 * s, localZ], yaw, [0.78 * s, 1.1 * s, 0.78 * s]));
      }
    }
  }
  return { grass, grassColors, flowers, flowerColors, trunks, crowns, treeModels, treeSpecies, groundCover };
}

