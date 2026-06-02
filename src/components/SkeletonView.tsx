import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import type { RagdollBodyDef } from '../types';

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

/** Live wireframe preview of the ragdoll collision shapes (capsule/box/sphere) at each configured bone. */
function RagdollBodyShapes({ bones, bodies, selected }: { bones: THREE.Object3D[]; bodies: RagdollBodyDef[]; selected?: string }) {
  const refs = useRef<(THREE.Group | null)[]>([]);
  const tmpScale = useMemo(() => new THREE.Vector3(), []);
  const tmpPos = useMemo(() => new THREE.Vector3(), []);

  // Resolve each enabled body to its bone + geometry args, auto-sizing capsule length from the child bone.
  const items = useMemo(() => {
    const defByName = new Map(bodies.map((b) => [b.boneName, b]));
    return bones
      .map((bone) => {
        const def = defByName.get(bone.name);
        if (!def || def.enabled === false) return null;
        const radius = def.radius ?? 0.06;
        const childBone = bones.find((b) => b.parent === bone);
        let half = Math.max(radius * 0.6, 0.02);
        if (def.length && def.length > 0) {
          half = def.length;
        } else if (childBone) {
          const a = new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld);
          const b = new THREE.Vector3().setFromMatrixPosition(childBone.matrixWorld);
          half = Math.max(b.distanceTo(a) / 2 - radius, 0.02);
        }
        return { bone, def, radius, half };
      })
      .filter((x): x is { bone: THREE.Object3D; def: RagdollBodyDef; radius: number; half: number } => x !== null);
  }, [bones, bodies]);

  useFrame(() => {
    items.forEach((item, index) => {
      const group = refs.current[index];
      if (!group) return;
      item.bone.matrixWorld.decompose(tmpPos, group.quaternion, tmpScale);
      group.position.copy(tmpPos);
    });
  });

  return (
    <>
      {items.map((item, index) => {
        const on = item.bone.name === selected;
        const color = on ? '#3DDC97' : '#5B8DEF';
        return (
          <group key={item.bone.uuid} ref={(el) => (refs.current[index] = el)}>
            {item.def.shape === 'sphere' ? (
              <mesh>
                <sphereGeometry args={[item.radius, 12, 12]} />
                <meshBasicMaterial color={color} wireframe transparent opacity={0.6} />
              </mesh>
            ) : item.def.shape === 'box' ? (
              <mesh>
                <boxGeometry
                  args={
                    item.def.halfExtents
                      ? [item.def.halfExtents[0] * 2, item.def.halfExtents[1] * 2, item.def.halfExtents[2] * 2]
                      : [item.radius * 2, (item.half + item.radius) * 2, item.radius * 2]
                  }
                />
                <meshBasicMaterial color={color} wireframe transparent opacity={0.6} />
              </mesh>
            ) : (
              <mesh>
                <capsuleGeometry args={[item.radius, item.half * 2, 4, 12]} />
                <meshBasicMaterial color={color} wireframe transparent opacity={0.6} />
              </mesh>
            )}
          </group>
        );
      })}
    </>
  );
}

/** The shared 3D skeleton view: the bind-pose mesh + bone lines + clickable bone markers (+ optional ragdoll bodies). */
export function SkeletonBones({
  url,
  selected,
  onSelect,
  bodies,
}: {
  url: string;
  selected?: string;
  onSelect: (name: string) => void;
  /** When provided, overlays the ragdoll collision shapes for these per-bone bodies. */
  bodies?: RagdollBodyDef[];
}) {
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
      {bodies && bodies.length > 0 && <RagdollBodyShapes bones={bones} bodies={bodies} selected={selected} />}
      <BoneMarkers bones={bones} selected={selected} onSelect={onSelect} />
    </group>
  );
}
