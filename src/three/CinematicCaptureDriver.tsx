import type { InstancedMesh, Object3D } from 'three';
import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useProgress } from '@react-three/drei';
import { registerCinematicCaptureRenderer } from '../runtime/cinematicCapture';

/** Request a single composed frame; the second RAF is a fence after the WebGL draw and React commit. */
export function CinematicCaptureDriver() {
  const invalidate = useThree(state => state.invalidate);
  const gl = useThree(state => state.gl);
  const scene = useThree(state => state.scene);
  const camera = useThree(state => state.camera);
  useEffect(() => registerCinematicCaptureRenderer(async () => {
    invalidate();
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const authoredTreeParts: { variant: number; lod: number; count: number }[] = [];
    const groundCoverParts: { kind: string; variant: number; lod: number; count: number }[] = [];
    scene.traverse(node => {
      if (!node.userData.nfAuthoredTree || !(node as InstancedMesh).count) return;
      let owner: Object3D | null = node;
      while (owner && !owner.userData.nfGroundCover) owner = owner.parent;
      const part = { ...node.userData.nfAuthoredTree, count: (node as InstancedMesh).count };
      if (owner) groundCoverParts.push({ ...part, kind: owner.userData.nfGroundCover });
      else authoredTreeParts.push(part);
    });
    Object.assign(window, { __featherCaptureScene: scene, __featherCaptureRenderer: gl, __featherCaptureMetrics: { authoredTreeParts, groundCoverParts, textures:gl.info.memory.textures, geometries:gl.info.memory.geometries, programs:gl.info.programs?.length ?? 0, assetsLoading:useProgress.getState().active, cameraPosition:camera.position.toArray() } });
  }), [invalidate, gl, camera, scene]);
  return null;
}
