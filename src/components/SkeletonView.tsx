import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';

/** Clickable spheres tracking each bone's world position (drawn over the mesh so they're always visible). */
function BoneMarkers({ bones, selected, onSelect }: { bones: THREE.Object3D[]; selected?: string; onSelect: (name: string) => void }) {
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  useFrame(() => {
    bones.forEach((bone, index) => {
      const marker = refs.current[index];
      if (marker) marker.position.setFromMatrixPosition(bone.matrixWorld);
    });
  });
  return (
    <>
      {bones.map((bone, index) => (
        <mesh
          key={bone.uuid}
          ref={(el) => (refs.current[index] = el)}
          onClick={(event) => {
            event.stopPropagation();
            onSelect(bone.name);
          }}
        >
          <sphereGeometry args={[bone.name === selected ? 0.05 : 0.032, 10, 10]} />
          <meshBasicMaterial color={bone.name === selected ? '#3DDC97' : '#F7B955'} depthTest={false} transparent opacity={0.95} />
        </mesh>
      ))}
    </>
  );
}

/** The shared 3D skeleton view: the bind-pose mesh + bone lines + clickable bone markers. */
export function SkeletonBones({ url, selected, onSelect }: { url: string; selected?: string; onSelect: (name: string) => void }) {
  const { scene } = useGLTF(url);
  const clone = useMemo(() => SkeletonUtils.clone(scene), [scene]);
  const bones = useMemo(() => {
    const found: THREE.Object3D[] = [];
    clone.traverse((node) => {
      if ((node as THREE.Bone).isBone) found.push(node);
    });
    return found;
  }, [clone]);

  return (
    <group>
      <primitive object={clone} />
      <skeletonHelper args={[clone]} />
      <BoneMarkers bones={bones} selected={selected} onSelect={onSelect} />
    </group>
  );
}
