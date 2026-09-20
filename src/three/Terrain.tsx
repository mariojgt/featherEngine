import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { useEditorStore, selectActiveObjects, selectActiveSceneEnvironment } from '../store/editorStore';
import { useStableActiveObjects } from '../store/stableSelectors';
import { useAssetUrl } from './ModelAsset';
import { DRACO_DECODER_PATH, extendGLTFLoader } from './gltfDecoders';
import {
  BLADE_GEOMETRY,
  GRASS_CROSS_GEOMETRY,
  TREE_BILLBOARD_GEOMETRY,
  WindFoliage,
  WindFoliageImage,
} from './foliageWind';
import { StylizedGrass } from './stylizedGrass';
import { ScatteredTrees } from './TreeMesh';
import type { SceneObject, TerrainComponent, Vector3Tuple } from '../types';
import {
  defaultStylizedGrass,
  sampleFoliageMask,
  sampleTerrainLocalHeight,
  sampleTerrainMaterialLayer,
  sampleTerrainNormal,
  terrainChunkBounds,
  terrainChunkKeysAroundLocal,
  terrainHash01,
  withTerrainDefaults,
  type TerrainChunkKey,
} from '../terrain/terrain';

const colorA = new THREE.Color();
const colorB = new THREE.Color();
const colorOut = new THREE.Color();
const dummyObject = new THREE.Object3D();

function terrainVertexColor(terrain: TerrainComponent, localX: number, localZ: number, height: number, normalY: number) {
  const layer = sampleTerrainMaterialLayer(terrain, localX, localZ, height, normalY);
  colorOut.set(layer.color);
  if (normalY < 0.62) {
    colorA.copy(colorOut);
    colorB.set(terrain.materialLayers[2]?.color ?? terrain.highColor);
    return colorOut.copy(colorA).lerp(colorB, 0.22);
  }
  return colorOut;
}

function createChunkGeometry(terrain: TerrainComponent, chunk: TerrainChunkKey) {
  const segments = terrain.resolution;
  const verticesPerSide = segments + 1;
  const vertexCount = verticesPerSide * verticesPerSide;
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const indices: number[] = [];
  const bounds = terrainChunkBounds(terrain, chunk.x, chunk.z);

  let p = 0;
  let c = 0;
  for (let z = 0; z <= segments; z += 1) {
    const localZ = bounds.minZ + (z / segments) * terrain.chunkSize;
    for (let x = 0; x <= segments; x += 1) {
      const localX = bounds.minX + (x / segments) * terrain.chunkSize;
      const height = sampleTerrainLocalHeight(terrain, localX, localZ);
      const normal = sampleTerrainNormal(terrain, localX, localZ);
      const color = terrainVertexColor(terrain, localX, localZ, height, normal[1]);
      positions[p++] = localX;
      positions[p++] = height;
      positions[p++] = localZ;
      colors[c++] = color.r;
      colors[c++] = color.g;
      colors[c++] = color.b;
    }
  }

  for (let z = 0; z < segments; z += 1) {
    for (let x = 0; x < segments; x += 1) {
      const a = z * verticesPerSide + x;
      const b = a + 1;
      const d = (z + 1) * verticesPerSide + x;
      const e = d + 1;
      indices.push(a, d, b, b, d, e);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// Per-chunk content signatures. `applyTerrainBrush` returns a brand-new terrain object on every
// pointer-move during a sculpt/paint drag; keying chunk geometry on the terrain ref therefore
// rebuilt EVERY visible chunk (up to streamRadius² of them) on every move event. Instead we bucket
// each override key into the chunk(s) it can affect and build a per-chunk signature, so only the
// chunks the brush actually touched get a new signature — the rest reuse their cached geometry.
const terrainChunkSigCache = new WeakMap<TerrainComponent, { base: string; chunks: Map<string, string> }>();

function terrainChunkSignatures(terrain: TerrainComponent): { base: string; chunks: Map<string, string> } {
  const cached = terrainChunkSigCache.get(terrain);
  if (cached) return cached;
  const cs = terrain.chunkSize;
  const margin = terrain.editSpacing * 2; // bilinear + normal sampling read a cell or two past a vertex
  const parts = new Map<string, string[]>();
  const bucket = (ix: number, iz: number, entry: string) => {
    const px = ix * terrain.editSpacing;
    const pz = iz * terrain.editSpacing;
    const cxs = new Set([Math.floor((px - margin) / cs), Math.floor((px + margin) / cs)]);
    const czs = new Set([Math.floor((pz - margin) / cs), Math.floor((pz + margin) / cs)]);
    for (const cx of cxs)
      for (const cz of czs) {
        const k = `${cx}:${cz}`;
        const list = parts.get(k);
        if (list) list.push(entry);
        else parts.set(k, [entry]);
      }
  };
  for (const key in terrain.heightOverrides) {
    const sep = key.indexOf(':');
    bucket(Number(key.slice(0, sep)), Number(key.slice(sep + 1)), `${key}=${terrain.heightOverrides[key]}`);
  }
  for (const key in terrain.paintOverrides) {
    const sep = key.indexOf(':');
    bucket(Number(key.slice(0, sep)), Number(key.slice(sep + 1)), `${key}#${terrain.paintOverrides[key]}`);
  }
  const chunks = new Map<string, string>();
  for (const [k, list] of parts) chunks.set(k, list.join(';'));
  // Everything that affects geometry but isn't a per-cell override (noise params, size, material
  // layer colors, …) goes in the base signature — a change there rebuilds every chunk, which is fine
  // because those are rare inspector edits, not per-stroke changes.
  const { heightOverrides: _h, paintOverrides: _p, ...rest } = terrain;
  const result = { base: JSON.stringify(rest), chunks };
  terrainChunkSigCache.set(terrain, result);
  return result;
}

// Shared, render-free brush-cursor target: TerrainChunk writes the hovered world point here on every
// pointer move while a terrain tool is active, and TerrainBrushCursor reads it imperatively in useFrame
// (no React re-render per mouse move). `stamp` lets the cursor auto-hide when the pointer leaves the
// terrain (no onPointerMove → goes stale).
export const terrainBrushCursor = { point: new THREE.Vector3(), stamp: 0, objectId: '' };
const noRaycast = () => null;
const SCULPT_CURSOR_COLOR: Record<string, string> = {
  raise: '#5BE27A',
  lower: '#FF6B6B',
  flatten: '#4DA6FF',
  smooth: '#FFD166',
};

function TerrainChunk({
  object,
  terrain,
  chunk,
  baseSig,
  chunkSig,
}: {
  object: SceneObject;
  terrain: TerrainComponent;
  chunk: TerrainChunkKey;
  baseSig: string;
  chunkSig: string;
}) {
  // Intentionally keyed on the content signatures, NOT the `terrain` ref: when this chunk's content
  // is unchanged the memo returns the existing geometry even though `terrain` is a new object.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const geometry = useMemo(() => createChunkGeometry(terrain, chunk), [baseSig, chunkSig, chunk.id]);
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const terrainBrush = useEditorStore((state) => state.terrainBrush);
  const selectObject = useEditorStore((state) => state.selectObject);
  const applyTerrainBrush = useEditorStore((state) => state.applyTerrainBrush);
  const brushActive = !isPlaying && terrainBrush.enabled && (!terrainBrush.objectId || terrainBrush.objectId === object.id);

  const applyBrushAt = (event: { stopPropagation: () => void; point: THREE.Vector3; nativeEvent: PointerEvent }, drag = false) => {
    if (!brushActive || event.nativeEvent.altKey) return;
    if (!drag && event.nativeEvent.button !== 0) return;
    if (drag && (event.nativeEvent.buttons & 1) === 0) return;
    event.stopPropagation();
    selectObject(object.id);
    applyTerrainBrush(object.id, [event.point.x, event.point.y, event.point.z]);
  };

  useLayoutEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh
      geometry={geometry}
      receiveShadow
      userData={{ nfGround: true }} // tag as ground so the follow-camera spring-arm ignores it (no pull-in on the floor)
      onPointerDown={applyBrushAt}
      onPointerMove={(event) => {
        // Track the hovered point for the brush-cursor ring (even when not dragging), so the user sees
        // exactly where/how big the stroke will land before pressing — like Unreal's landscape brush.
        if (brushActive) {
          terrainBrushCursor.point.set(event.point.x, event.point.y, event.point.z);
          terrainBrushCursor.stamp = performance.now();
          terrainBrushCursor.objectId = object.id;
        }
        applyBrushAt(event, true);
      }}
    >
      <meshStandardMaterial vertexColors roughness={0.92} metalness={0.02} />
    </mesh>
  );
}

function chunkCenterFromCamera(object: SceneObject, terrain: TerrainComponent, cameraPosition: THREE.Vector3) {
  const sx = object.transform.scale[0] || 1;
  const sz = object.transform.scale[2] || 1;
  const localX = (cameraPosition.x - object.transform.position[0]) / sx;
  const localZ = (cameraPosition.z - object.transform.position[2]) / sz;
  return {
    localX,
    localZ,
    chunkX: Math.floor(localX / terrain.chunkSize),
    chunkZ: Math.floor(localZ / terrain.chunkSize),
  };
}

function useVisibleTerrainChunks(object: SceneObject, terrain: TerrainComponent) {
  const camera = useThree((state) => state.camera);
  const initial = chunkCenterFromCamera(object, terrain, camera.position);
  const [center, setCenter] = useState(() => ({ x: initial.chunkX, z: initial.chunkZ }));

  useFrame(() => {
    const next = chunkCenterFromCamera(object, terrain, camera.position);
    if (next.chunkX !== center.x || next.chunkZ !== center.z) setCenter({ x: next.chunkX, z: next.chunkZ });
  });

  return useMemo(() => {
    const keys = terrainChunkKeysAroundLocal(terrain, center.x * terrain.chunkSize, center.z * terrain.chunkSize, terrain.streamRadius);
    // Sort NEAREST-FIRST around the camera chunk. generateFoliage fills grass in this order and stops at
    // the instance cap, so the (bounded) blade budget concentrates AROUND the player — a thick field where
    // you are, fading to none far away — instead of being spread thin across the whole streamed area. This
    // is what lets density go very high while staying cheap. (Order doesn't affect chunk rendering.)
    return keys
      .map((key) => ({ key, d: (key.x - center.x) ** 2 + (key.z - center.z) ** 2 }))
      .sort((a, b) => a.d - b.d)
      .map((entry) => entry.key);
  }, [terrain, center.x, center.z]);
}

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

function generateFoliage(terrain: TerrainComponent, chunks: TerrainChunkKey[]) {
  const foliage = terrain.foliage;
  const grass: THREE.Matrix4[] = [];
  const grassColors: THREE.Color[] = [];
  const flowers: THREE.Matrix4[] = [];
  const flowerColors: THREE.Color[] = [];
  const trunks: THREE.Matrix4[] = [];
  const crowns: THREE.Matrix4[] = [];
  const treeModels: THREE.Matrix4[] = [];
  if (!foliage.enabled) return { grass, grassColors, flowers, flowerColors, trunks, crowns, treeModels };

  const wantsGrass = foliage.mode === 'grass' || foliage.mode === 'mixed';
  const wantsTrees = foliage.mode === 'trees' || foliage.mode === 'mixed';
  const flowerDensity = wantsGrass ? Math.max(0, Math.min(1, foliage.flowerDensity ?? 0)) : 0;
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
  const maxGrass = 60000;
  const maxTrees = 2000;
  const maxFlowers = 16000;

  // Reusable color scratch for the ground-borrowed grass tints (avoids allocating per tuft).
  const grassTargetColor = new THREE.Color(foliage.grassColor);
  const grassGround = new THREE.Color();
  const grassBase = new THREE.Color();

  for (const chunk of chunks) {
    const bounds = terrainChunkBounds(terrain, chunk.x, chunk.z);
    // --- MyAge-style meadow grass. Three things make it read as a real lush field instead of a green fuzz
    //     layer: (1) PATCHY density noise carves lush clumps + near-bare pockets; (2) each TUFT shares one
    //     lean angle + height (a tidy pom, not a fist of blades pointing everywhere); (3) blades BORROW the
    //     ground color, nudged only ~40% toward the grass green and a touch darker, so they melt into the
    //     turf — plus a gentle per-tuft painterly warm/cool + value shift so it reads hand-painted. ---
    const grassTarget = grassTargetColor;
    const GRASS_TUFT = isClumpGrass ? 1 : 5;
    const grassClusters = Math.ceil(grassPerChunk / GRASS_TUFT);
    for (let c = 0; c < grassClusters && grass.length < maxGrass; c += 1) {
      const crx = terrainHash01(terrain.seed + 5001, chunk.x, chunk.z, c * 2);
      const crz = terrainHash01(terrain.seed + 5002, chunk.x, chunk.z, c * 2 + 1);
      const cX = bounds.minX + crx * terrain.chunkSize;
      const cZ = bounds.minZ + crz * terrain.chunkSize;
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
        const h = sampleTerrainLocalHeight(terrain, localX, localZ);
        const s = THREE.MathUtils.lerp(foliage.minScale, foliage.maxScale, terrainHash01(terrain.seed + 5003, chunk.x, chunk.z, sk)) * tuftH;
        // Whole tuft leans one way, ±small per-blade variance → a tidy pom, not a chaotic fist of blades.
        const yaw = tuftAngle + (terrainHash01(terrain.seed + 5004, chunk.x, chunk.z, sk) - 0.5) * 0.5;
        grass.push(composeMatrix([localX, h, localZ], yaw, [0.7 * s, s, 0.7 * s]));
        const jitter = 0.95 + terrainHash01(terrain.seed + 5008, chunk.x, chunk.z, sk) * 0.1;
        grassColors.push(new THREE.Color(grassBase.r * jitter, grassBase.g * jitter, grassBase.b * jitter));
      }
    }
    for (let i = 0; i < flowersPerChunk && flowers.length < maxFlowers; i += 1) {
      const rx = terrainHash01(terrain.seed + 6001, chunk.x, chunk.z, i * 2);
      const rz = terrainHash01(terrain.seed + 6002, chunk.x, chunk.z, i * 2 + 1);
      const localX = bounds.minX + rx * terrain.chunkSize;
      const localZ = bounds.minZ + rz * terrain.chunkSize;
      const normal = sampleTerrainNormal(terrain, localX, localZ);
      if (normal[1] < foliage.slopeLimit) continue;
      if (useMask) {
        const mask = sampleFoliageMask(terrain, localX, localZ);
        if (mask <= 0 || terrainHash01(terrain.seed + 6005, chunk.x, chunk.z, i) > mask) continue;
      }
      const h = sampleTerrainLocalHeight(terrain, localX, localZ);
      // Flowers are SMALL dabs of color nestled in the grass — kept little so they read as blooms, not
      // big flat cards. They stand just proud of the blades.
      const s = THREE.MathUtils.lerp(0.5, 0.85, terrainHash01(terrain.seed + 6003, chunk.x, chunk.z, i));
      const yaw = terrainHash01(terrain.seed + 6004, chunk.x, chunk.z, i) * Math.PI * 2;
      flowers.push(composeMatrix([localX, h, localZ], yaw, [0.26 * s, 0.5 * s, 0.26 * s]));
      const colorIndex = Math.floor(terrainHash01(terrain.seed + 6006, chunk.x, chunk.z, i) * FLOWER_PALETTE.length) % FLOWER_PALETTE.length;
      flowerColors.push(FLOWER_PALETTE[colorIndex]);
    }
    for (let i = 0; i < treesPerChunk && trunks.length < maxTrees; i += 1) {
      const rx = terrainHash01(terrain.seed + 7001, chunk.x, chunk.z, i * 2);
      const rz = terrainHash01(terrain.seed + 7002, chunk.x, chunk.z, i * 2 + 1);
      const localX = bounds.minX + rx * terrain.chunkSize;
      const localZ = bounds.minZ + rz * terrain.chunkSize;
      const normal = sampleTerrainNormal(terrain, localX, localZ);
      if (normal[1] < Math.max(foliage.slopeLimit, 0.74)) continue;
      if (useMask) {
        const mask = sampleFoliageMask(terrain, localX, localZ);
        if (mask <= 0 || terrainHash01(terrain.seed + 7005, chunk.x, chunk.z, i) > mask) continue;
      }
      const h = sampleTerrainLocalHeight(terrain, localX, localZ);
      // The 1.9 boost exists because the built-in cone/sphere crowns are only ~1 unit tall. A parametric
      // tree asset already specifies its real height (a pine is 12 units), so boosting it too gives a
      // 30-unit monster — scale those by the authored range alone.
      const treeScaleBoost = foliage.treeSpecId ? 0.75 : 1.9;
      const s = THREE.MathUtils.lerp(foliage.minScale, foliage.maxScale, terrainHash01(terrain.seed + 7003, chunk.x, chunk.z, i)) * treeScaleBoost;
      const yaw = terrainHash01(terrain.seed + 7004, chunk.x, chunk.z, i) * Math.PI * 2;
      treeModels.push(composeMatrix([localX, h, localZ], yaw, [s, s, s]));
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
  return { grass, grassColors, flowers, flowerColors, trunks, crowns, treeModels };
}

function InstancedMatrices({
  matrices,
  children,
}: {
  matrices: THREE.Matrix4[];
  children: ReactNode;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [matrices]);

  if (matrices.length === 0) return null;
  // Bounding sphere is computed above, so the instanced foliage can frustum-cull when off-screen
  // instead of submitting all (up to thousands of) instances to the vertex shader every frame.
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, matrices.length]} castShadow receiveShadow raycast={noRaycast} userData={{ nfGround: true }}>
      {children}
    </instancedMesh>
  );
}

function FoliageModelClones({
  assetId,
  matrices,
  limit,
}: {
  assetId?: string;
  matrices: THREE.Matrix4[];
  limit: number;
}) {
  const url = useAssetUrl(assetId);
  if (!url || matrices.length === 0) return null;
  return <LoadedFoliageModel url={url} matrices={matrices} limit={limit} />;
}

// One InstancedMesh per source-mesh of a custom foliage model. The old implementation rendered a
// separate <Clone> (a full scene-graph clone) per placement — up to `limit` clones, each its own
// draw call(s) and cloned materials. Instancing collapses every placement of a given source mesh
// into a single draw call, the same way the built-in foliage path works.
function FoliageInstancedPart({
  geometry,
  material,
  local,
  placements,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  local: THREE.Matrix4;
  placements: THREE.Matrix4[];
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const composed = new THREE.Matrix4();
    placements.forEach((placement, index) => {
      // placement positions/orients the model; `local` is the mesh's transform within the model.
      composed.multiplyMatrices(placement, local);
      mesh.setMatrixAt(index, composed);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere(); // lets the instanced foliage frustum-cull when off-screen
  }, [placements, local]);
  return (
    <instancedMesh
      ref={ref}
      args={[geometry, material, placements.length]}
      castShadow
      receiveShadow
      raycast={noRaycast}
      userData={{ nfGround: true }}
    />
  );
}

function LoadedFoliageModel({
  url,
  matrices,
  limit,
}: {
  url: string;
  matrices: THREE.Matrix4[];
  limit: number;
}) {
  const { scene } = useGLTF(url, DRACO_DECODER_PATH, true, extendGLTFLoader);
  // Flatten the model into (geometry, material, in-model transform) parts to instance.
  const parts = useMemo(() => {
    const collected: { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[]; matrix: THREE.Matrix4 }[] = [];
    scene.updateWorldMatrix(true, true);
    scene.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      collected.push({ geometry: mesh.geometry, material: mesh.material, matrix: mesh.matrixWorld.clone() });
    });
    return collected;
  }, [scene]);
  const placements = useMemo(() => matrices.slice(0, limit), [matrices, limit]);
  if (placements.length === 0 || parts.length === 0) return null;
  return (
    <>
      {parts.map((part, index) => (
        <FoliageInstancedPart key={index} geometry={part.geometry} material={part.material} local={part.matrix} placements={placements} />
      ))}
    </>
  );
}

// Built-in 3D tree crown geometries (shared singletons). Matched to the legacy inline-JSX args so
// placement is unchanged; now rendered through the rigid wind-canopy material so they sway with the
// wind and lean away from a passing player (built-in trunks stay planted below them).
const TREE_CROWN_SPHERE = new THREE.SphereGeometry(0.86, 10, 8);
const TREE_CROWN_CONE = new THREE.ConeGeometry(0.9, 1.45, 7);

/**
 * A stylized layered CONIFER / fir crown: stacked cone tiers (widest "skirt" at the base up to a point)
 * merged into ONE geometry, so the whole fir is a single instanced draw. Base at y=0, ~1.12 units tall,
 * ~0.58 base radius. Per-tier uv.y drives the shader's base-dark→tip-bright gradient (each tier's tips
 * catch light like real fir layers), and the rigid wind mode sways the whole crown as one soft mass.
 * This is the tree shape the stylized-nature / BOTW reference look is built around.
 */
function buildFirCrownGeometry(): THREE.BufferGeometry {
  // Five overlapping tiers (widest skirt at the base, narrowing to a point) for a full, soft conifer
  // silhouette. Generous overlap + 12 radial segments keep it round and smooth rather than a facet blob.
  const tiers = [
    { r: 0.62, h: 0.5, y: 0.0 },
    { r: 0.52, h: 0.46, y: 0.22 },
    { r: 0.42, h: 0.44, y: 0.42 },
    { r: 0.3, h: 0.42, y: 0.62 },
    { r: 0.17, h: 0.4, y: 0.82 },
  ];
  const position: number[] = [];
  const normal: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  let offset = 0;
  for (const t of tiers) {
    const cone = new THREE.ConeGeometry(t.r, t.h, 12, 1);
    cone.translate(0, t.y + t.h / 2, 0); // ConeGeometry is centered on its own origin → move base to t.y
    const p = cone.getAttribute('position');
    const n = cone.getAttribute('normal');
    const u = cone.getAttribute('uv');
    const idx = cone.getIndex()!;
    for (let i = 0; i < p.count; i += 1) {
      position.push(p.getX(i), p.getY(i), p.getZ(i));
      normal.push(n.getX(i), n.getY(i), n.getZ(i));
      uv.push(u.getX(i), u.getY(i));
    }
    for (let i = 0; i < idx.count; i += 1) index.push(idx.getX(i) + offset);
    offset += p.count;
    cone.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  return g;
}
const TREE_CROWN_FIR = buildFirCrownGeometry();

const treeCrownGeometry = (style: TerrainComponent['foliage']['treeMesh']) =>
  style === 'fir' ? TREE_CROWN_FIR : style === 'round' ? TREE_CROWN_SPHERE : TREE_CROWN_CONE;

function TerrainFoliage({ terrain, chunks }: { terrain: TerrainComponent; chunks: TerrainChunkKey[] }) {
  const foliage = terrain.foliage;
  const matrices = useMemo(() => generateFoliage(terrain, chunks), [terrain, chunks]);
  // The global scene wind drives the grass/leaf sway (see foliageWind.tsx) — the same wind that moves
  // cloth and wind-affected bodies. Read it once here and feed every foliage draw call.
  const env = useEditorStore(selectActiveSceneEnvironment);
  const windVec = env?.wind ?? [0, 0, 0];
  const turbulence = env?.windTurbulence ?? 0;
  const windStrength = foliage.windStrength ?? 1;
  // BOTW-style player parting (Tier "interactive vegetation") + soft turf/canopy normals (Tier 7.3).
  const interactStrength = foliage.interactStrength ?? 1;
  const grassSource = foliage.grassSource ?? (foliage.grassModelAssetId ? 'model' : 'builtin');
  const treeSource = foliage.treeSource ?? (foliage.treeModelAssetId ? 'model' : 'builtin');
  // Scattered parametric trees resolve their spec from the project library by id, so the forest and the
  // Tree Builder stay in lockstep with no per-chunk copies to invalidate.
  const treeSpecs = useEditorStore((state) => state.treeSpecs);
  const treeSpec = treeSource === 'builtin' && foliage.treeSpecId
    ? treeSpecs.find((entry) => entry.id === foliage.treeSpecId)
    : undefined;

  return (
    <>
      {grassSource === 'model' ? (
        <FoliageModelClones assetId={foliage.grassModelAssetId} matrices={matrices.grass} limit={320} />
      ) : grassSource === 'image' && foliage.grassImageAssetId ? (
        <WindFoliageImage
          assetId={foliage.grassImageAssetId}
          geometry={GRASS_CROSS_GEOMETRY}
          color={foliage.grassColor}
          matrices={matrices.grass}
          windVec={windVec}
          turbulence={turbulence}
          windStrength={windStrength}
          normalLift={0.5}
          interactStrength={interactStrength}
        />
      ) : foliage.grassMesh === 'clump' ? (
        // Built-in default: stylized painted-clump cards (gradient + colour variation + interaction).
        <StylizedGrass
          color={foliage.grassColor}
          settings={foliage.stylizedGrass ?? defaultStylizedGrass()}
          matrices={matrices.grass}
          windVec={windVec}
          turbulence={turbulence}
          windStrength={windStrength}
          interactStrength={interactStrength}
        />
      ) : (
        // Simple shapes: a single wind-animated blade (or a cross billboard for the 'cross' style). Color is
        // WHITE because each blade carries its own ground-borrowed per-instance color (so the field melts
        // into the turf); see generateFoliage.
        <WindFoliage
          geometry={foliage.grassMesh === 'cross' ? GRASS_CROSS_GEOMETRY : BLADE_GEOMETRY}
          color="#ffffff"
          matrices={matrices.grass}
          colors={matrices.grassColors}
          windVec={windVec}
          turbulence={turbulence}
          windStrength={windStrength}
          normalLift={0.88}
          interactStrength={interactStrength}
          shadow={false}
          emit={0.62}
        />
      )}

      {/* Wildflowers: small brightly-colored blooms (per-instance colors) scattered through the grass;
          they wind-sway and part around the player exactly like the blades. */}
      {matrices.flowers.length > 0 && (
        <WindFoliage
          geometry={GRASS_CROSS_GEOMETRY}
          color="#ffffff"
          matrices={matrices.flowers}
          colors={matrices.flowerColors}
          windVec={windVec}
          turbulence={turbulence}
          windStrength={windStrength}
          normalLift={0.35}
          interactStrength={interactStrength}
          shadow={false}
        />
      )}

      {treeSpec ? (
        // A tree ASSET from the project library — editing it in the Tree Builder restyles the whole forest.
        <ScatteredTrees spec={treeSpec} matrices={matrices.treeModels} />
      ) : treeSource === 'model' ? (
        <FoliageModelClones assetId={foliage.treeModelAssetId} matrices={matrices.treeModels} limit={180} />
      ) : treeSource === 'image' && foliage.treeImageAssetId ? (
        // Tree billboards sway gently (mostly the canopy) — softer wind + slower idle flutter than grass.
        <WindFoliageImage
          assetId={foliage.treeImageAssetId}
          geometry={TREE_BILLBOARD_GEOMETRY}
          color={foliage.treeColor}
          matrices={matrices.treeModels}
          windVec={windVec}
          turbulence={turbulence}
          windStrength={windStrength * 0.4}
          swaySpeed={1.1}
          baseSway={0.015}
          normalLift={0.35}
          interactStrength={interactStrength * 0.5}
          interactMode={1}
        />
      ) : (
        <>
          <InstancedMatrices matrices={matrices.trunks}>
            <cylinderGeometry args={[0.5, 0.65, 1, 6]} />
            <meshStandardMaterial color={foliage.trunkColor} roughness={0.86} />
          </InstancedMatrices>
          {/* Rigid wind canopy: the whole crown sways as one soft blob and leans away from the player. */}
          <WindFoliage
            geometry={treeCrownGeometry(foliage.treeMesh)}
            color={foliage.treeColor}
            matrices={matrices.crowns}
            windVec={windVec}
            turbulence={turbulence}
            windStrength={windStrength * 0.5}
            swaySpeed={1.0}
            baseSway={0.01}
            normalLift={0.35}
            interactStrength={interactStrength * 0.5}
            interactMode={1}
            rigid
          />
        </>
      )}
    </>
  );
}

export function Terrain({ object }: { object: SceneObject }) {
  const terrain = useMemo(() => withTerrainDefaults(object.terrain), [object.terrain]);
  const chunks = useVisibleTerrainChunks(object, terrain);
  const sigs = useMemo(() => terrainChunkSignatures(terrain), [terrain]);
  if (!terrain.enabled) return null;
  return (
    <>
      {chunks.map((chunk) => (
        <TerrainChunk
          key={chunk.id}
          object={object}
          terrain={terrain}
          chunk={chunk}
          baseSig={sigs.base}
          chunkSig={sigs.chunks.get(`${chunk.x}:${chunk.z}`) ?? ''}
        />
      ))}
      <TerrainFoliage terrain={terrain} chunks={chunks} />
    </>
  );
}

/**
 * Unreal-style terrain brush preview: a flat ring + soft fill disc that tracks the cursor on the terrain
 * surface while a sculpt/paint tool is active, sized to the brush radius and tinted by the tool (sculpt
 * operation colour, or the paint layer's colour). Rendered at the SCENE ROOT (world space) so the world
 * hover point from TerrainChunk maps directly; it positions itself imperatively in useFrame (no per-move
 * re-render) and auto-hides when the pointer leaves the terrain (stale stamp).
 */
export function TerrainBrushCursor() {
  const brush = useEditorStore((state) => state.terrainBrush);
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const selectedObjectId = useEditorStore((state) => state.selectedObjectId);
  // Structurally-stable: the cursor only needs terrain objects (terrain edits bump the token); the raw
  // array subscription re-rendered this 60×/s during Play when anything moved.
  const objects = useStableActiveObjects();
  const groupRef = useRef<THREE.Group>(null);

  const terrainObject = useMemo(() => {
    const terrains = objects.filter((object) => object.terrain?.enabled);
    if (brush.objectId) return terrains.find((object) => object.id === brush.objectId) ?? terrains[0];
    return terrains.find((object) => object.id === selectedObjectId) ?? terrains[0];
  }, [objects, brush.objectId, selectedObjectId]);

  const color = useMemo(() => {
    if (brush.mode === 'foliage') return brush.foliageErase ? '#FF6B6B' : '#5BE27A';
    if (brush.mode === 'paint') {
      const layers = terrainObject?.terrain?.materialLayers ?? [];
      const layer = layers.find((item) => item.id === brush.targetLayerId) ?? layers[0];
      return layer?.color ?? '#19E3D6';
    }
    return SCULPT_CURSOR_COLOR[brush.operation] ?? '#19E3D6';
  }, [brush.mode, brush.operation, brush.targetLayerId, brush.foliageErase, terrainObject]);

  const worldRadius = brush.radius * (terrainObject?.transform.scale[0] ?? 1);
  const active = !isPlaying && brush.enabled && Boolean(terrainObject);

  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;
    const fresh = performance.now() - terrainBrushCursor.stamp < 140;
    const visible = active && fresh;
    group.visible = visible;
    if (!visible) return;
    group.position.set(terrainBrushCursor.point.x, terrainBrushCursor.point.y + 0.06, terrainBrushCursor.point.z);
    group.scale.setScalar(Math.max(worldRadius, 0.05));
  });

  return (
    <group ref={groupRef} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
      {/* Outer ring outline. */}
      <mesh raycast={noRaycast}>
        <ringGeometry args={[0.9, 1, 64]} />
        <meshBasicMaterial color={color} transparent opacity={0.95} depthTest={false} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      {/* Soft fill so the affected disc reads at a glance. */}
      <mesh raycast={noRaycast} position={[0, 0, 0.001]}>
        <circleGeometry args={[1, 64]} />
        <meshBasicMaterial color={color} transparent opacity={0.12} depthTest={false} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
    </group>
  );
}
