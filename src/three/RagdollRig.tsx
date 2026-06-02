import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import RAPIER from '@dimforge/rapier3d-compat';
import type { ColliderDesc, RigidBody, World } from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { initRapier } from '../runtime/physicsWorld';
import { setRagdollRoot } from '../runtime/ragdollState';
import { defaultRagdollSettings } from '../store/editorStore';
import type { RagdollSettings } from '../types';

interface BoneEntry {
  bone: THREE.Bone;
  body: RigidBody;
}

interface Sim {
  world: World;
  entries: BoneEntry[];
  rootBody: RigidBody | null;
  restored: () => void;
}

// Hard cap on body speed (units/sec) — a safety net so a misbehaving joint can never fling the ragdoll
// across the level. Real limp motion stays well under this.
const MAX_LINVEL = 12;
const MAX_ANGVEL = 30;

const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const tmpMat = new THREE.Matrix4();
const ONE = new THREE.Vector3(1, 1, 1);

/**
 * A physics ragdoll for a skinned model: when `active`, builds a dynamic capsule body per major bone
 * (seeded from the current pose), links parent→child with spherical joints, and each frame copies the
 * simulated body transforms back onto the bones so the mesh goes limp. Runs in its own small Rapier
 * world (the headless scene world is separate). The caller (SkinnedModel) pauses the animation mixer
 * while this is active so only the ragdoll drives the bones. Renders nothing.
 *
 * NOTE: collider sizes / joint setup are conservative defaults — expect a tuning pass for a given rig.
 */
export function RagdollRig({
  root,
  active,
  settings,
  objectId,
}: {
  root: THREE.Object3D;
  active: boolean;
  /** Per-skeleton tuning; falls back to defaults when omitted. */
  settings?: RagdollSettings;
  /** Object this ragdoll belongs to — its root position is published so the camera can follow. */
  objectId?: string;
}) {
  const sim = useRef<Sim | null>(null);

  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let cleanup = () => {};
    const cfg = { ...defaultRagdollSettings(), ...settings };
    const groundY = cfg.groundY;
    // Bones we DON'T simulate (fingers, hair, etc.) — author-controlled regex on the skeleton.
    let exclude: RegExp;
    try {
      exclude = new RegExp(cfg.excludePattern, 'i');
    } catch {
      exclude = new RegExp(defaultRagdollSettings().excludePattern, 'i');
    }

    // Per-bone overrides (Unreal PhAT-style), keyed by bone name.
    const bodyDefByName = new Map((cfg.bodies ?? []).map((b) => [b.boneName, b]));

    void initRapier().then(() => {
      if (disposed) return;
      try {
        root.updateWorldMatrix(true, true);
        const bones: THREE.Bone[] = [];
        root.traverse((node) => {
          const bone = node as THREE.Bone;
          if (!bone.isBone) return;
          const def = bodyDefByName.get(bone.name);
          // An explicit per-bone override wins over the exclude pattern; `enabled:false` removes a bone.
          if (def) {
            if (def.enabled === false) return;
          } else if (exclude.test(bone.name)) {
            return;
          }
          bones.push(bone);
        });
        if (bones.length < 2) return;

        const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
        world.timestep = 1 / 60;
        // More solver iterations stiffen the spherical-joint chain so limbs don't visibly stretch
        // under gravity (the remaining "rubbery" feel of a soft ragdoll).
        world.integrationParameters.numSolverIterations = 12;
        // Collision groups (u32 = membership<<16 | filter). Bones share one group that does NOT
        // self-collide — adjacent bone capsules overlap heavily at the bind pose, and without this
        // the solver explodes them apart on frame 1 (the mesh stretches like cloth). Bones collide
        // with the ground only; the ground collides with bones only.
        const BONE_GROUPS = (0x0001 << 16) | 0x0002;
        const GROUND_GROUPS = (0x0002 << 16) | 0x0001;
        // Ground so the ragdoll piles up instead of falling forever.
        world.createCollider(
          RAPIER.ColliderDesc.cuboid(50, 0.1, 50).setTranslation(0, groundY - 0.1, 0).setCollisionGroups(GROUND_GROUPS),
        );

        const boneSet = new Set(bones);
        const ragdollChild = (bone: THREE.Bone) => bones.find((b) => b.parent === bone);
        const ragdollParent = (bone: THREE.Bone) => {
          let p: THREE.Object3D | null = bone.parent;
          while (p && !boneSet.has(p as THREE.Bone)) p = p.parent;
          return (p as THREE.Bone) ?? null;
        };

        const bodyByBone = new Map<THREE.Bone, RigidBody>();
        const entries: BoneEntry[] = [];
        for (const bone of bones) {
          const def = bodyDefByName.get(bone.name);
          bone.matrixWorld.decompose(tmpPos, tmpQuat, tmpScale);
          const body = world.createRigidBody(
            RAPIER.RigidBodyDesc.dynamic()
              .setTranslation(tmpPos.x, tmpPos.y, tmpPos.z)
              .setRotation({ x: tmpQuat.x, y: tmpQuat.y, z: tmpQuat.z, w: tmpQuat.w })
              .setLinearDamping(def?.linearDamping ?? cfg.linearDamping)
              .setAngularDamping(def?.angularDamping ?? cfg.angularDamping),
          );
          // Resolve the shape: per-bone override, else a capsule auto-sized to the bone's length.
          const radius = def?.radius ?? cfg.capsuleRadius;
          const density = def?.density ?? cfg.density;
          const child = ragdollChild(bone);
          let half = Math.max(radius * 0.6, 0.02);
          if (def?.length && def.length > 0) {
            half = def.length;
          } else if (child) {
            const childPos = new THREE.Vector3().setFromMatrixPosition(child.matrixWorld);
            half = Math.max(childPos.distanceTo(tmpPos) / 2 - radius, 0.02);
          }
          let colliderDesc: ColliderDesc;
          if (def?.shape === 'sphere') {
            colliderDesc = RAPIER.ColliderDesc.ball(radius);
          } else if (def?.shape === 'box') {
            const [hx, hy, hz] = def.halfExtents ?? [radius, half + radius, radius];
            colliderDesc = RAPIER.ColliderDesc.cuboid(Math.max(hx, 0.02), Math.max(hy, 0.02), Math.max(hz, 0.02));
          } else {
            colliderDesc = RAPIER.ColliderDesc.capsule(half, radius);
          }
          world.createCollider(colliderDesc.setDensity(density).setFriction(0.8).setCollisionGroups(BONE_GROUPS), body);
          bodyByBone.set(bone, body);
          entries.push({ bone, body });
        }

        // Spherical joints anchored at each child bone's origin (relative to both bodies' frames).
        for (const bone of bones) {
          const parent = ragdollParent(bone);
          const parentBody = parent ? bodyByBone.get(parent) : undefined;
          if (!parent || !parentBody) continue;
          const childWorld = new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld);
          const parentWorld = new THREE.Vector3().setFromMatrixPosition(parent.matrixWorld);
          const parentQuat = new THREE.Quaternion().setFromRotationMatrix(parent.matrixWorld);
          const anchorParent = childWorld.clone().sub(parentWorld).applyQuaternion(parentQuat.clone().invert());
          const joint = RAPIER.JointData.spherical({ x: 0, y: 0, z: 0 }, { x: anchorParent.x, y: anchorParent.y, z: anchorParent.z });
          world.createImpulseJoint(joint, parentBody, bodyByBone.get(bone)!, true);
        }

        // Take manual control of the bones' world matrices while ragdolling.
        for (const { bone } of entries) {
          bone.matrixAutoUpdate = false;
          bone.matrixWorldAutoUpdate = false;
        }

        // The root (pelvis) = first simulated bone with no simulated ancestor; the camera follows it.
        const rootEntry = entries.find(({ bone }) => !ragdollParent(bone)) ?? entries[0];

        sim.current = {
          world,
          entries,
          rootBody: rootEntry?.body ?? null,
          restored: () => {
            for (const { bone } of entries) {
              bone.matrixAutoUpdate = true;
              bone.matrixWorldAutoUpdate = true;
            }
          },
        };
        cleanup = () => {
          sim.current?.restored();
          world.free();
          sim.current = null;
        };
      } catch (error) {
        console.error('Ragdoll build failed:', error);
      }
    });

    return () => {
      disposed = true;
      cleanup();
    };
    // Rebuild when tuning changes so edits take effect on the next ragdoll.
  }, [
    active,
    root,
    settings?.capsuleRadius,
    settings?.density,
    settings?.linearDamping,
    settings?.angularDamping,
    settings?.groundY,
    settings?.excludePattern,
    JSON.stringify(settings?.bodies ?? []),
  ]);

  useFrame(() => {
    const s = sim.current;
    if (!s || !active) return;

    // Safety net: clamp velocities BEFORE stepping so an unstable joint can't fling the body away.
    for (const { body } of s.entries) {
      const lv = body.linvel();
      const lvLen = Math.hypot(lv.x, lv.y, lv.z);
      if (lvLen > MAX_LINVEL) {
        const k = MAX_LINVEL / lvLen;
        body.setLinvel({ x: lv.x * k, y: lv.y * k, z: lv.z * k }, true);
      }
      const av = body.angvel();
      const avLen = Math.hypot(av.x, av.y, av.z);
      if (avLen > MAX_ANGVEL) {
        const k = MAX_ANGVEL / avLen;
        body.setAngvel({ x: av.x * k, y: av.y * k, z: av.z * k }, true);
      }
    }

    s.world.step();
    for (const { bone, body } of s.entries) {
      const t = body.translation();
      const r = body.rotation();
      tmpMat.compose(tmpPos.set(t.x, t.y, t.z), tmpQuat.set(r.x, r.y, r.z, r.w), ONE);
      bone.matrixWorld.copy(tmpMat);
    }

    // Publish the pelvis position so the runtime keeps the character + follow camera tracking the body.
    if (objectId && s.rootBody) {
      const p = s.rootBody.translation();
      setRagdollRoot(objectId, [p.x, p.y, p.z]);
    }
  });

  return null;
}
