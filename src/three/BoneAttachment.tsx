import { useEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { getBone } from './boneRegistry';
import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import type { SceneObject } from '../types';

/**
 * Renders an object attached to a bone "socket" of an animated character. Each frame it copies the
 * target bone's world matrix and applies this object's transform as a local offset, so the item
 * (sword, torch, spawned actor…) rides the bone through the animation. The parent scene group is at
 * the world origin, so writing the bone's world matrix straight onto our group places it correctly.
 */
export function BoneAttachment({
  object,
  onSelect,
  children,
}: {
  object: SceneObject;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const attachment = object.attachment!;
  const skeletons = useEditorStore((state) => state.skeletons);
  const skeletalMeshes = useEditorStore((state) => state.skeletalMeshes);
  const objects = useEditorStore(selectActiveObjects);

  // Resolve a named socket (if any) on the target's skeleton → its bone + reusable offset.
  const socket = useMemo(() => {
    if (!attachment.socketName) return undefined;
    const targetModel = objects.find((o) => o.id === attachment.targetObjectId)?.renderer?.modelAssetId;
    const meshAsset = skeletalMeshes.find((m) => m.sourceAssetId === targetModel);
    return skeletons.find((s) => s.id === meshAsset?.skeletonId)?.sockets?.find((s) => s.name === attachment.socketName);
  }, [attachment.socketName, attachment.targetObjectId, objects, skeletalMeshes, skeletons]);

  const boneName = socket?.boneName ?? attachment.boneName;
  const [px, py, pz] = object.transform.position;
  const [rx, ry, rz] = object.transform.rotation;
  const [sx, sy, sz] = object.transform.scale;

  // Effective offset = the skeleton socket's offset (reusable) × this object's own fine-tune transform.
  const offset = useMemo(() => {
    const own = new THREE.Matrix4().compose(
      new THREE.Vector3(px, py, pz),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'XYZ')),
      new THREE.Vector3(sx, sy, sz),
    );
    if (!socket) return own;
    const socketM = new THREE.Matrix4().compose(
      new THREE.Vector3(...socket.position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(socket.rotation[0], socket.rotation[1], socket.rotation[2], 'XYZ')),
      new THREE.Vector3(1, 1, 1),
    );
    return socketM.multiply(own);
  }, [px, py, pz, rx, ry, rz, sx, sy, sz, socket]);

  useEffect(() => {
    if (groupRef.current) groupRef.current.matrixAutoUpdate = false;
  }, []);

  useFrame(() => {
    const group = groupRef.current;
    const bone = getBone(attachment.targetObjectId, boneName);
    if (!group) return;
    if (!bone) {
      group.visible = false; // target not loaded yet
      return;
    }
    group.visible = true;
    bone.updateWorldMatrix(true, false);
    group.matrix.copy(bone.matrixWorld).multiply(offset);
    group.matrixWorldNeedsUpdate = true;
  });

  return (
    <group
      ref={groupRef}
      onPointerDown={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      {children}
    </group>
  );
}
