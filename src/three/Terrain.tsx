import { useFrame, useThree } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useEditorStore, selectActiveObjects } from '../store/editorStore';
import { useStableActiveObjects } from '../store/stableSelectors';
import { TerrainFoliage } from './TerrainFoliage';
import type { SceneObject, TerrainComponent } from '../types';
import {
  sampleTerrainLocalHeight,
  terrainChunkKeysAroundLocal,
  withTerrainDefaults,
  type TerrainChunkKey,
} from '../terrain/terrain';
import { buildTerrainChunkGeometryData } from '../terrain/terrainGeometry';
import { terrainChunkLodSegments, terrainChunkSignatures } from '../terrain/terrainChunks';
import { useTerrainSurfaceMaterial } from './terrainSurface';

function createChunkGeometry(terrain: TerrainComponent, chunk: TerrainChunkKey, segments: number) {
  const data = buildTerrainChunkGeometryData(terrain, chunk.x, chunk.z, segments);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
  geometry.setAttribute('terrainWeightsA', new THREE.BufferAttribute(data.weightsA, 4));
  geometry.setAttribute('terrainWeightsB', new THREE.BufferAttribute(data.weightsB, 4));
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
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
  signature,
  segments,
  material,
}: {
  object: SceneObject;
  terrain: TerrainComponent;
  chunk: TerrainChunkKey;
  signature: string;
  segments: number;
  material: THREE.MeshStandardMaterial;
}) {
  // Intentionally keyed on the content signatures, NOT the `terrain` ref: when this chunk's content
  // is unchanged the memo returns the existing geometry even though `terrain` is a new object.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const geometry = useMemo(
    () => createChunkGeometry(terrain, chunk, segments),
    // The content signature intentionally stands in for the frequently-changing terrain object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature, chunk.id, segments],
  );
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
      material={material}
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
    />
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

type VisibleTerrainChunk = TerrainChunkKey & { ring: number };

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
    // Sort NEAREST-FIRST around the camera chunk. Vegetation streaming fills grass in this order and stops at
    // the instance cap, so the (bounded) blade budget concentrates AROUND the player — a thick field where
    // you are, fading to none far away — instead of being spread thin across the whole streamed area. This
    // is what lets density go very high while staying cheap. (Order doesn't affect chunk rendering.)
    return keys
      .map((key) => ({ key, d: (key.x - center.x) ** 2 + (key.z - center.z) ** 2, ring: Math.max(Math.abs(key.x - center.x), Math.abs(key.z - center.z)) }))
      .sort((a, b) => a.d - b.d)
      .map((entry): VisibleTerrainChunk => ({ ...entry.key, ring: entry.ring }));
  }, [terrain, center.x, center.z]);
}

export function Terrain({ object }: { object: SceneObject }) {
  const terrain = useMemo(() => withTerrainDefaults(object.terrain), [object.terrain]);
  const chunks = useVisibleTerrainChunks(object, terrain);
  const sigs = useMemo(() => terrainChunkSignatures(terrain), [terrain]);
  const material = useTerrainSurfaceMaterial(terrain);
  const terrainBrush = useEditorStore((state) => state.terrainBrush);
  const isPlaying = useEditorStore((state) => state.isPlaying);
  // Editing keeps every pickable streamed chunk at authored detail. Outside editing, the complete
  // physics radius is full detail and farther rings step down behind crack-hiding skirts.
  const forceFullDetail = !isPlaying && terrainBrush.enabled
    && (!terrainBrush.objectId || terrainBrush.objectId === object.id);
  if (!terrain.enabled) return null;
  return (
    <>
      {chunks.map((chunk) => {
        const chunkKey = `${chunk.x}:${chunk.z}`;
        const segments = terrainChunkLodSegments(terrain, chunk.ring, forceFullDetail);
        const signature = [
          sigs.geometryBase,
          sigs.geometryChunks.get(chunkKey) ?? '',
          sigs.surfaceBase,
          sigs.surfaceChunks.get(chunkKey) ?? '',
        ].join('|');
        return (
          <TerrainChunk
            key={chunk.id}
            object={object}
            terrain={terrain}
            chunk={chunk}
            signature={signature}
            segments={segments}
            material={material}
          />
        );
      })}
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
