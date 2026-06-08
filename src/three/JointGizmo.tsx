import { useMemo } from 'react';
import { Line } from '@react-three/drei';
import * as THREE from 'three';
import type { SceneObject } from '../types';
import { worldMatrixOf } from '../utils/transformHierarchy';

// Pink, distinct from the collider cyan (#19E3D6) and the gold selection edges (#F7B955) — reads as
// "joint/constraint" and never gets confused with either.
const JOINT_COLOR = '#FF5DA2';
const AXIS_COLOR = '#FFD166';

const ignoreRaycast = () => null;

const tmpQuat = new THREE.Quaternion();

/** World-space position of `object`'s local anchor offset, composing the full parent chain. */
function worldAnchor(byId: Map<string, SceneObject>, object: SceneObject, anchor: [number, number, number]) {
  const m = worldMatrixOf(byId, object.id);
  return new THREE.Vector3(anchor[0], anchor[1], anchor[2]).applyMatrix4(m);
}

/**
 * A preview of the selected object's physics JOINT — a marker at its anchor, a line to the connected
 * body's anchor (or, for a world anchor, a small "pinned" cross), and for hinge/slider the rotation /
 * slide axis drawn through the anchor. Editor-only visual aid; renders nothing into the simulation.
 * Anchors are local offsets, so they track the object as it moves. Mirrors the ColliderGizmo style.
 */
export function JointGizmo({ object, sceneObjects }: { object: SceneObject; sceneObjects: SceneObject[] }) {
  const joint = object.joint;
  const byId = useMemo(() => new Map(sceneObjects.map((o) => [o.id, o])), [sceneObjects]);

  const data = useMemo(() => {
    if (!joint?.enabled) return null;
    const selfAnchor = worldAnchor(byId, object, joint.localAnchor);
    const connectedObject = joint.connectedObjectId ? byId.get(joint.connectedObjectId) : undefined;
    const otherAnchor = connectedObject
      ? worldAnchor(byId, connectedObject, joint.connectedAnchor)
      : null;

    // Axis (hinge/slider): direction in the body's local frame → rotate by the object's world rotation.
    let axisLine: [THREE.Vector3, THREE.Vector3] | null = null;
    if (joint.type === 'hinge' || joint.type === 'slider') {
      worldMatrixOf(byId, object.id).decompose(new THREE.Vector3(), tmpQuat, new THREE.Vector3());
      const dir = new THREE.Vector3(joint.axis[0], joint.axis[1], joint.axis[2]).normalize().applyQuaternion(tmpQuat);
      const len = 0.8;
      axisLine = [selfAnchor.clone().addScaledVector(dir, -len), selfAnchor.clone().addScaledVector(dir, len)];
    }
    return { selfAnchor, otherAnchor, axisLine, hasConnected: Boolean(joint.connectedObjectId) };
  }, [joint, object, byId]);

  if (!data) return null;
  const { selfAnchor, otherAnchor, axisLine, hasConnected } = data;

  return (
    <group renderOrder={1000}>
      {/* Anchor marker on this body. */}
      <mesh position={selfAnchor} raycast={ignoreRaycast}>
        <sphereGeometry args={[0.09, 12, 8]} />
        <meshBasicMaterial color={JOINT_COLOR} toneMapped={false} depthTest={false} transparent opacity={0.95} />
      </mesh>

      {/* Link to the connected body's anchor, or a "pinned to world" cross when world-anchored. */}
      {otherAnchor ? (
        <>
          <Line points={[selfAnchor, otherAnchor]} color={JOINT_COLOR} lineWidth={2} depthTest={false} dashed dashSize={0.12} gapSize={0.08} />
          <mesh position={otherAnchor} raycast={ignoreRaycast}>
            <sphereGeometry args={[0.09, 12, 8]} />
            <meshBasicMaterial color={JOINT_COLOR} toneMapped={false} depthTest={false} transparent opacity={0.95} />
          </mesh>
        </>
      ) : (
        !hasConnected && (
          <Line
            points={[
              selfAnchor.clone().add(new THREE.Vector3(-0.15, 0, 0)),
              selfAnchor.clone().add(new THREE.Vector3(0.15, 0, 0)),
              selfAnchor,
              selfAnchor.clone().add(new THREE.Vector3(0, -0.15, 0)),
              selfAnchor.clone().add(new THREE.Vector3(0, 0.15, 0)),
            ]}
            color={JOINT_COLOR}
            lineWidth={2}
            depthTest={false}
            segments
          />
        )
      )}

      {/* Hinge rotation / slider slide axis. */}
      {axisLine && <Line points={axisLine} color={AXIS_COLOR} lineWidth={2.5} depthTest={false} />}
    </group>
  );
}
