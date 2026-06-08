import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { useEditorStore, selectActiveObjects, selectActiveSceneEnvironment } from '../store/editorStore';
import { useAssetUrl } from './ModelAsset';
import { DRACO_DECODER_PATH, extendGLTFLoader } from './gltfDecoders';
import {
  BLADE_GEOMETRY,
  GRASS_CROSS_GEOMETRY,
  TREE_BILLBOARD_GEOMETRY,
  WindFoliage,
  WindFoliageImage,
} from './foliageWind';
import type { SceneObject, TerrainComponent, Vector3Tuple } from '../types';
import {
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

function generateFoliage(terrain: TerrainComponent, chunks: TerrainChunkKey[]) {
  const foliage = terrain.foliage;
  const grass: THREE.Matrix4[] = [];
  const trunks: THREE.Matrix4[] = [];
  const crowns: THREE.Matrix4[] = [];
  const treeModels: THREE.Matrix4[] = [];
  if (!foliage.enabled) return { grass, trunks, crowns, treeModels };

  const wantsGrass = foliage.mode === 'grass' || foliage.mode === 'mixed';
  const wantsTrees = foliage.mode === 'trees' || foliage.mode === 'mixed';
  const chunkArea = terrain.chunkSize * terrain.chunkSize;
  // Painted (mask) mode: scatter the FULL candidate pool and let the per-point mask decide where they
  // survive, so grass appears only where you painted. Uniform mode: candidate count scales with density.
  const useMask = Boolean(foliage.usePaintMask);
  // Grass scatter density. The high factor makes each near-camera chunk a THICK lawn (density=1 → ~2000
  // blades per 32² chunk). Combined with nearest-first chunks + the instance cap, the dense grass forms a
  // bounded disc around the player — so it stays one cheap instanced draw call no matter how big the world.
  // Want denser? Raise foliage.density toward 1; want a bigger dense radius? raise the cap (costs more CPU
  // on regen). Lawn-thick everywhere isn't free — concentrate the budget near the camera instead.
  const grassPerChunk = wantsGrass ? Math.floor(chunkArea * (useMask ? 2 : foliage.density * 2)) : 0;
  const treesPerChunk = wantsTrees ? Math.max(0, Math.floor(chunkArea * (useMask ? 0.006 : foliage.treeDensity * 0.006))) : 0;
  const maxGrass = 60000;
  const maxTrees = 2000;

  for (const chunk of chunks) {
    const bounds = terrainChunkBounds(terrain, chunk.x, chunk.z);
    for (let i = 0; i < grassPerChunk && grass.length < maxGrass; i += 1) {
      // Use DISTINCT hash indices for x and z (2i vs 2i+1). Sharing the same index `i` (differing only by a
      // near-identical seed) made rx and rz correlate, so the blades landed on diagonal/straight lines
      // instead of scattering — give each axis its own hash input so the placement is properly random.
      const rx = terrainHash01(terrain.seed + 5001, chunk.x, chunk.z, i * 2);
      const rz = terrainHash01(terrain.seed + 5002, chunk.x, chunk.z, i * 2 + 1);
      const localX = bounds.minX + rx * terrain.chunkSize;
      const localZ = bounds.minZ + rz * terrain.chunkSize;
      const normal = sampleTerrainNormal(terrain, localX, localZ);
      if (normal[1] < foliage.slopeLimit) continue;
      // Painted mode: keep this blade only where the painted mask covers it (probability = painted density).
      if (useMask) {
        const mask = sampleFoliageMask(terrain, localX, localZ);
        if (mask <= 0 || terrainHash01(terrain.seed + 5005, chunk.x, chunk.z, i) > mask) continue;
      }
      const h = sampleTerrainLocalHeight(terrain, localX, localZ);
      const s = THREE.MathUtils.lerp(foliage.minScale, foliage.maxScale, terrainHash01(terrain.seed + 5003, chunk.x, chunk.z, i));
      const yaw = terrainHash01(terrain.seed + 5004, chunk.x, chunk.z, i) * Math.PI * 2;
      // Base-at-ground: blade/cross/model foliage geometry all originate at y=0, so place the instance
      // origin right on the terrain height (the old +0.22s lift was for the centred cone mesh).
      grass.push(composeMatrix([localX, h, localZ], yaw, [0.7 * s, s, 0.7 * s]));
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
      const s = THREE.MathUtils.lerp(foliage.minScale, foliage.maxScale, terrainHash01(terrain.seed + 7003, chunk.x, chunk.z, i)) * 1.9;
      const yaw = terrainHash01(terrain.seed + 7004, chunk.x, chunk.z, i) * Math.PI * 2;
      treeModels.push(composeMatrix([localX, h, localZ], yaw, [s, s, s]));
      trunks.push(composeMatrix([localX, h + 0.48 * s, localZ], yaw, [0.18 * s, 0.95 * s, 0.18 * s]));
      crowns.push(composeMatrix([localX, h + 1.23 * s, localZ], yaw, [0.78 * s, 1.1 * s, 0.78 * s]));
    }
  }
  return { grass, trunks, crowns, treeModels };
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

function TerrainFoliage({ terrain, chunks }: { terrain: TerrainComponent; chunks: TerrainChunkKey[] }) {
  const foliage = terrain.foliage;
  const matrices = useMemo(() => generateFoliage(terrain, chunks), [terrain, chunks]);
  // The global scene wind drives the grass/leaf sway (see foliageWind.tsx) — the same wind that moves
  // cloth and wind-affected bodies. Read it once here and feed every foliage draw call.
  const env = useEditorStore(selectActiveSceneEnvironment);
  const windVec = env?.wind ?? [0, 0, 0];
  const turbulence = env?.windTurbulence ?? 0;
  const windStrength = foliage.windStrength ?? 1;
  const grassSource = foliage.grassSource ?? (foliage.grassModelAssetId ? 'model' : 'builtin');
  const treeSource = foliage.treeSource ?? (foliage.treeModelAssetId ? 'model' : 'builtin');

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
        />
      ) : (
        // Built-in: high-quality wind-animated blades (or a cross billboard for the 'cross' style).
        <WindFoliage
          geometry={foliage.grassMesh === 'cross' ? GRASS_CROSS_GEOMETRY : BLADE_GEOMETRY}
          color={foliage.grassColor}
          matrices={matrices.grass}
          windVec={windVec}
          turbulence={turbulence}
          windStrength={windStrength}
        />
      )}

      {treeSource === 'model' ? (
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
        />
      ) : (
        <>
          <InstancedMatrices matrices={matrices.trunks}>
            <cylinderGeometry args={[0.5, 0.65, 1, 6]} />
            <meshStandardMaterial color={foliage.trunkColor} roughness={0.86} />
          </InstancedMatrices>
          <InstancedMatrices matrices={matrices.crowns}>
            {foliage.treeMesh === 'round' ? <sphereGeometry args={[0.86, 10, 8]} /> : <coneGeometry args={[0.9, 1.45, 7]} />}
            <meshStandardMaterial color={foliage.treeColor} roughness={0.92} />
          </InstancedMatrices>
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
  const objects = useEditorStore(selectActiveObjects);
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
