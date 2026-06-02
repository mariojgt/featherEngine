import { PerspectiveCamera } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import { useEditorStore } from '../store/editorStore';
import type { RuntimeCinematicCamera } from '../types';

export function CinematicCamera({ pose }: { pose?: RuntimeCinematicCamera }) {
  const runtimePose = useEditorStore((state) => state.runtimeCinematicCamera);
  const activePose = pose ?? runtimePose;
  const cameraRef = useRef<THREE.PerspectiveCamera>(null);

  useFrame(() => {
    const camera = cameraRef.current;
    if (!camera || !activePose) return;
    camera.position.set(...activePose.position);
    camera.lookAt(new THREE.Vector3(...activePose.lookAt));
    if (Math.abs(camera.fov - activePose.fov) > 0.01) {
      camera.fov = activePose.fov;
      camera.updateProjectionMatrix();
    }
  });

  if (!activePose) return null;
  return <PerspectiveCamera ref={cameraRef} makeDefault fov={activePose.fov} near={0.02} position={activePose.position} />;
}
