import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import { isRagdoll } from '../runtime/ragdollState';
import { accumulateRootMotion, isPlausibleRootStep } from '../runtime/rootMotion';
import type { RootMotionMode } from '../types';

/**
 * Root motion extraction.
 *
 * A clip authored WITH root motion translates the root bone, so the character walks forward inside
 * the animation. Played as-is on an engine-driven character that is also being moved by code, the
 * mesh drifts away from its own object origin and the two motions fight.
 *
 * This runs after the mixer has posed the skeleton (same placement as foot IK), measures how far the
 * root travelled since the previous frame, and pins the root back to its rest position so the mesh
 * stays centred on its object. The measured distance is published for the runtime tick to consume.
 *
 * Deliberately conservative, like the IK passes: it does nothing at all unless the animator opts in,
 * nothing while ragdolling (physics owns the bones then), and nothing if the rig has no bone to
 * measure. Vertical displacement is left alone — gravity and jumping own the Y axis, and a clip
 * fighting them is how root motion destabilises a character.
 */

/** Scratch, reused every frame so extraction allocates nothing on the hot path. */
const restLocal = new THREE.Vector3();

interface RootTracking {
  bone: THREE.Bone;
  /** The bone's authored rest position, restored every frame after measuring. */
  rest: THREE.Vector3;
  /** Previous frame's raw animated position, to difference against. */
  previous: THREE.Vector3;
  /** False until the first frame has established a baseline to difference from. */
  primed: boolean;
}

/**
 * The skeleton's root bone: the topmost bone in the hierarchy.
 *
 * Root motion is authored on whichever bone the exporter made the skeleton root (Hips, root, Armature
 * depending on the rig), so this takes the first bone found in a breadth-first walk rather than
 * matching names — name matching is what makes rig support brittle.
 */
export function findRootBone(model: THREE.Object3D): THREE.Bone | null {
  const queue: THREE.Object3D[] = [model];
  while (queue.length) {
    const node = queue.shift()!;
    const bone = node as THREE.Bone;
    if (bone.isBone) return bone;
    queue.push(...node.children);
  }
  return null;
}

/**
 * Horizontal distance between two root positions.
 *
 * Measured in the root bone's own local space, which conveniently sidesteps the object's world
 * transform: the number wanted is how far the animation says the character travelled along its own
 * facing, and the controller supplies the direction separately.
 */
export function horizontalRootDistance(previous: THREE.Vector3, current: THREE.Vector3): number {
  const dx = current.x - previous.x;
  const dz = current.z - previous.z;
  return Math.hypot(dx, dz);
}

/**
 * Extracts root motion for one skinned model, publishing it for the runtime tick.
 *
 * `mode` comes from the object's animator: `disabled` (the default) is a complete no-op, so a project
 * that has never heard of root motion is untouched.
 */
export function useRootMotion(model: THREE.Object3D, registerId?: string): void {
  const mode = useEditorStore((state) => {
    if (!registerId) return 'disabled' as RootMotionMode;
    for (const object of selectActiveObjects(state)) {
      if (object.id === registerId) return object.animator?.rootMotion ?? ('disabled' as RootMotionMode);
    }
    return 'disabled' as RootMotionMode;
  });

  const tracking = useRef<RootTracking | null>(null);

  useFrame((_, delta) => {
    if (mode === 'disabled' || !registerId) {
      // Drop any baseline so re-enabling starts fresh instead of differencing against a stale pose.
      tracking.current = null;
      return;
    }
    // Physics owns the bones while ragdolling; measuring them would publish nonsense.
    if (isRagdoll(registerId)) {
      tracking.current = null;
      return;
    }

    let track = tracking.current;
    if (!track || !track.bone.parent) {
      const bone = findRootBone(model);
      if (!bone) return;
      // The rest position is whatever the bone sits at the moment tracking starts. Taken once, so
      // pinning is stable even though the mixer overwrites the bone every frame.
      track = { bone, rest: bone.position.clone(), previous: bone.position.clone(), primed: false };
      tracking.current = track;
    }

    const current = track.bone.position;
    if (track.primed) {
      const distance = horizontalRootDistance(track.previous, current);
      // A looping clip wraps the root from the end of the cycle back to the start; that frame is a
      // discontinuity, not travel, and publishing it would teleport the character.
      if (isPlausibleRootStep(distance, delta)) accumulateRootMotion(registerId, distance, delta);
    }
    track.previous.copy(current);
    track.primed = true;

    // Pin the root back horizontally so the mesh stays on its object origin, leaving Y to the clip
    // (crouches and jump arcs are authored there and the controller does not drive them).
    restLocal.copy(track.rest);
    track.bone.position.set(restLocal.x, current.y, restLocal.z);
  });
}
