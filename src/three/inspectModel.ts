import type { Object3D, SkinnedMesh, AnimationClip } from 'three';
import { GLTFLoader } from 'three-stdlib';

/** What we learn about a model GLB at import time, used to derive Skeleton/Mesh/Animation assets. */
export interface ModelInspection {
  /** Present only for skinned (rigged) models. */
  skeleton?: {
    boneNames: string[];
    rootBone: string;
    /** Stable hash of the bone hierarchy — the compatibility key across rigs. */
    signature: string;
  };
  clips: { name: string; duration: number }[];
}

/** FNV-1a over the joined bone names — small, stable, order-sensitive compatibility key. */
function signatureOf(boneNames: string[]): string {
  const text = boneNames.join('|');
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Parse a glTF/GLB file in the browser and report its skeleton (if any) + animation clips, without
 * adding it to the scene. Used by the asset importer to split a rig into reusable Skeleton, Skeletal
 * Mesh, and Animation assets. Quaternius/Mixamo "standard" GLBs are uncompressed, so the bare
 * `GLTFLoader` (no DRACO/meshopt) is enough.
 */
export async function inspectModel(file: File): Promise<ModelInspection> {
  const buffer = await file.arrayBuffer();
  const loader = new GLTFLoader();
  const gltf = await new Promise<{ scene: Object3D; animations: AnimationClip[] }>((resolve, reject) => {
    loader.parse(buffer, '', resolve as (g: unknown) => void, reject);
  });

  let skeleton: ModelInspection['skeleton'];
  gltf.scene.traverse((node) => {
    const skinned = node as SkinnedMesh;
    if (skeleton || !skinned.isSkinnedMesh || !skinned.skeleton) return;
    const boneNames = skinned.skeleton.bones.map((bone) => bone.name);
    if (!boneNames.length) return;
    skeleton = { boneNames, rootBone: boneNames[0], signature: signatureOf(boneNames) };
  });

  const clips = (gltf.animations ?? []).map((clip) => ({ name: clip.name, duration: clip.duration }));
  return { skeleton, clips };
}
