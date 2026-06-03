import { useFrame } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import { isRagdoll } from '../runtime/ragdollState';
import { highestTerrainWorldHeight } from '../terrain/terrain';

/**
 * Terrain foot IK for skinned characters.
 *
 * After the animation mixer poses the skeleton each frame, this nudges each foot down onto the terrain
 * surface beneath it (analytic two-bone IK on the thigh→calf→foot chain) so a character's feet plant on
 * uneven ground instead of floating above a slope or sinking into a rise. It is deliberately conservative
 * and self-disabling — it only runs in Play, only while the character is grounded, only over terrain, and
 * only adjusts feet that are already near the ground (planted), leaving mid-stride lifted feet untouched.
 * If the rig has no detectable foot bones it does nothing, so it can never make a character look worse than
 * the raw animation.
 */

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

interface Leg {
  thigh: THREE.Bone;
  calf: THREE.Bone;
  foot: THREE.Bone;
}

/** Find leg chains by locating foot/ankle bones; the calf is the foot's parent, the thigh its grandparent. */
function findLegs(root: THREE.Object3D): Leg[] {
  const legs: Leg[] = [];
  root.traverse((obj) => {
    const bone = obj as THREE.Bone;
    if (!bone.isBone || !/foot|ankle/i.test(bone.name)) return;
    const calf = bone.parent as THREE.Bone | null;
    const thigh = (calf?.parent ?? null) as THREE.Bone | null;
    if (calf?.isBone && thigh?.isBone) legs.push({ thigh, calf, foot: bone });
  });
  return legs.slice(0, 2); // a biped — guard against picking up extra "foot"-named props
}

// Scratch objects reused every frame (no per-frame allocation).
const pA = new THREE.Vector3();
const pB = new THREE.Vector3();
const pC = new THREE.Vector3();
const pCNow = new THREE.Vector3();
const vab = new THREE.Vector3();
const vac = new THREE.Vector3();
const vcb = new THREE.Vector3();
const vba = new THREE.Vector3();
const vat = new THREE.Vector3();
const vN1 = new THREE.Vector3();
const vN2 = new THREE.Vector3();
const axis = new THREE.Vector3();
const rootWorld = new THREE.Vector3();
const footWorld = new THREE.Vector3();
const target = new THREE.Vector3();
const qParent = new THREE.Quaternion();
const qCur = new THREE.Quaternion();
const qDelta = new THREE.Quaternion();

/** Apply a world-space delta rotation to a bone (premultiply its current world orientation), then refresh. */
function rotateBoneWorld(bone: THREE.Bone, deltaWorld: THREE.Quaternion) {
  bone.getWorldQuaternion(qCur);
  const desiredWorld = qDelta.copy(deltaWorld).multiply(qCur); // newWorld = delta * current
  if (bone.parent) {
    bone.parent.getWorldQuaternion(qParent).invert();
    bone.quaternion.copy(qParent).multiply(desiredWorld);
  } else {
    bone.quaternion.copy(desiredWorld);
  }
  bone.updateMatrixWorld(true);
}

/** Analytic two-bone IK: bend the knee (about the leg's CURRENT bend plane, so it keeps its natural direction)
 *  and swing the limb so the foot bone reaches `targetWorld`. No-ops on a degenerate (perfectly straight) leg. */
function solveLeg(leg: Leg, targetWorld: THREE.Vector3) {
  leg.thigh.getWorldPosition(pA);
  leg.calf.getWorldPosition(pB);
  leg.foot.getWorldPosition(pC);

  const lab = pB.distanceTo(pA);
  const lcb = pC.distanceTo(pB);
  if (lab < 1e-4 || lcb < 1e-4) return;
  const lat = clamp(pA.distanceTo(targetWorld), 1e-3, lab + lcb - 1e-3);

  vab.copy(pB).sub(pA); // A→B (thigh)
  vac.copy(pC).sub(pA); // A→C (hip→ankle)
  vcb.copy(pC).sub(pB); // B→C (knee→ankle) — must be c−b, not b−c, or the knee angle comes out supplementary
  vba.copy(pA).sub(pB); // B→A (knee→hip)
  vat.copy(targetWorld).sub(pA);

  // Bend plane from the current pose → the knee keeps bending the way the animation already bends it.
  axis.copy(vac).cross(vab);
  if (axis.lengthSq() < 1e-7) return; // straight leg — skip rather than pick an arbitrary (wrong) bend
  axis.normalize();

  const ac_ab_0 = Math.acos(clamp(vN1.copy(vac).normalize().dot(vN2.copy(vab).normalize()), -1, 1));
  const ba_bc_0 = Math.acos(clamp(vN1.copy(vba).normalize().dot(vN2.copy(vcb).normalize()), -1, 1));
  const ac_ab_1 = Math.acos(clamp((lcb * lcb - lab * lab - lat * lat) / (-2 * lab * lat), -1, 1));
  const ba_bc_1 = Math.acos(clamp((lat * lat - lab * lab - lcb * lcb) / (-2 * lab * lcb), -1, 1));

  rotateBoneWorld(leg.thigh, qDelta.setFromAxisAngle(axis, ac_ab_1 - ac_ab_0));
  rotateBoneWorld(leg.calf, qDelta.setFromAxisAngle(axis, ba_bc_1 - ba_bc_0));

  // Swing the whole limb so the foot points at the target.
  leg.foot.getWorldPosition(pCNow);
  vac.copy(pCNow).sub(pA);
  vat.copy(targetWorld).sub(pA);
  axis.copy(vac).cross(vat);
  if (axis.lengthSq() > 1e-7) {
    axis.normalize();
    const ang = Math.acos(clamp(vN1.copy(vac).normalize().dot(vN2.copy(vat).normalize()), -1, 1));
    rotateBoneWorld(leg.thigh, qDelta.setFromAxisAngle(axis, ang));
  }
}

/** Hook: drive terrain foot IK for the character rendered by `model` (identified by `registerId`). */
export function useFootIK(model: THREE.Object3D, registerId?: string) {
  const legsRef = useRef<Leg[]>([]);
  useEffect(() => {
    legsRef.current = registerId ? findLegs(model) : [];
  }, [model, registerId]);

  useFrame(() => {
    if (!registerId) return;
    const legs = legsRef.current;
    if (!legs.length) return;
    const state = useEditorStore.getState();
    if (!state.isPlaying || isRagdoll(registerId)) return;
    if (!state.runtimeGrounded.includes(registerId)) return; // airborne → let the jump/fall pose play untouched

    const objects = selectActiveObjects(state);
    model.getWorldPosition(rootWorld);
    const bodyFloor = highestTerrainWorldHeight(objects, rootWorld.x, rootWorld.z);
    if (bodyFloor === undefined) return; // no terrain under this character → leave the animation as-authored

    for (const leg of legs) {
      leg.foot.getWorldPosition(footWorld);
      const groundUnder = highestTerrainWorldHeight(objects, footWorld.x, footWorld.z);
      if (groundUnder === undefined) continue;
      const clearance = footWorld.y - bodyFloor; // how high this foot sits above the body's ground in the pose
      if (clearance > 0.5) continue; // a lifted, mid-stride foot — don't yank it onto the ground
      const targetY = groundUnder + Math.max(0, clearance); // follow the terrain under this foot, keep tiny lift
      const adjust = clamp(targetY - footWorld.y, -0.6, 0.6);
      if (Math.abs(adjust) < 1e-3) continue; // flat ground under the foot — nothing to do
      target.set(footWorld.x, footWorld.y + adjust, footWorld.z);
      solveLeg(leg, target);
    }
  });
}
