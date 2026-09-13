import { Suspense, useLayoutEffect, useMemo, useRef } from 'react';
import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { SceneObject } from '../types';
import { useEditorStore } from '../store/editorStore';
import { useAssetUrl, extractInstanceSubmeshes, type InstanceSubmesh } from './ModelAsset';
import { qualityProfile } from './quality';
import { DRACO_DECODER_PATH, extendGLTFLoader } from './gltfDecoders';
import { splitInstanceCells } from './modelInstancing';
import { getLodGeometry, preparedLodErrors } from './meshLodCache';
import { selectPreparedLod } from './lodSelection';

/**
 * Renders the instanced batches computed by {@link computeInstanceBatches}: one InstancedMesh per
 * submesh of each batched model, with one instance per object. See modelInstancing.ts for scope/safety.
 * Mounted only while Play is active and the toggle is on; the matching objects' per-object Primitive
 * returns null (so they aren't double-drawn) via the InstancedIdsContext.
 */
export function ModelInstances({ batches }: { batches: Map<string, SceneObject[]> }) {
  if (batches.size === 0) return null;
  return (
    <Suspense fallback={null}>
      {[...batches].map(([modelAssetId, objects]) => (
        <ModelBatch key={modelAssetId} modelAssetId={modelAssetId} objects={objects} />
      ))}
    </Suspense>
  );
}

function ModelBatch({ modelAssetId, objects }: { modelAssetId: string; objects: SceneObject[] }) {
  const url = useAssetUrl(modelAssetId);
  if (!url) return null;
  return <ModelBatchInner url={url} objects={objects} />;
}

function ModelBatchInner({ url, objects }: { url: string; objects: SceneObject[] }) {
  const { scene } = useGLTF(url, DRACO_DECODER_PATH, true, extendGLTFLoader);
  const anisotropy = qualityProfile(useEditorStore.getState().renderSettings?.quality).maxAnisotropy;
  // Submeshes share geometry + materials from the loaded glTF (one upload), with the same scale
  // normalization ModelAsset applies — so an instance is sized identically to its non-instanced twin.
  const submeshes = useMemo(() => extractInstanceSubmeshes(scene, anisotropy), [scene, anisotropy]);
  const cells = useMemo(() => splitInstanceCells(objects), [objects]);
  return (
    <>
      {[...cells].flatMap(([cell, members]) => submeshes.map((submesh, i) => (
        <SubmeshInstances key={`${cell}/${i}`} submesh={submesh} objects={members} />
      )))}
    </>
  );
}

function SubmeshInstances({ submesh, objects }: { submesh: InstanceSubmesh; objects: SceneObject[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const tick = useRef(0), level = useRef(0), radius = useRef(0);
  // Eligible objects are static (no script/physics/animator), so their transforms are constant during
  // Play — set the instance matrices once per membership change, no per-frame work. Each instance's
  // matrix is the object's world transform composed with the submesh's local-within-the-model matrix.
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const objectMatrix = new THREE.Matrix4();
    const instanceMatrix = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const scale = new THREE.Vector3();
    radius.current = 0;
    if (!submesh.geometry.boundingSphere) submesh.geometry.computeBoundingSphere();
    for (let i = 0; i < objects.length; i += 1) {
      const t = objects[i].transform;
      euler.set(t.rotation[0], t.rotation[1], t.rotation[2], 'XYZ');
      objectMatrix.compose(
        pos.set(t.position[0], t.position[1], t.position[2]),
        quat.setFromEuler(euler),
        scale.set(t.scale[0], t.scale[1], t.scale[2]),
      );
      mesh.setMatrixAt(i, instanceMatrix.multiplyMatrices(objectMatrix, submesh.localMatrix));
      radius.current = Math.max(radius.current, (submesh.geometry.boundingSphere?.radius ?? 0) * instanceMatrix.getMaxScaleOnAxis());
    }
    mesh.count = objects.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [submesh, objects]);

  useFrame(({ camera, gl }) => {
    if (++tick.current % 8) return;
    const mesh = ref.current, errors = preparedLodErrors(submesh.geometry);
    if (!mesh?.boundingSphere || !errors) return;
    const distance = Math.max(camera.near, camera.position.distanceTo(mesh.boundingSphere.center) - mesh.boundingSphere.radius);
    const pixels = radius.current * gl.domElement.height * Math.abs(camera.projectionMatrix.elements[5]) /
      ((camera as THREE.PerspectiveCamera).isPerspectiveCamera ? distance : 1);
    level.current = selectPreparedLod(errors, pixels, useEditorStore.getState().renderSettings.quality, level.current);
    const geometry = getLodGeometry(submesh.geometry, level.current);
    if (geometry) mesh.geometry = geometry;
  });

  return (
    <instancedMesh
      ref={ref}
      args={[submesh.geometry, submesh.material, objects.length]}
      frustumCulled
      castShadow
      receiveShadow
    />
  );
}
