import { Color, type AnimationClip, type Material, type Mesh, type Object3D, type SkinnedMesh } from 'three';
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
  materials: {
    name: string;
    color: string;
    metalness: number;
    roughness: number;
    emissiveColor: string;
    emissiveIntensity: number;
    hasBaseColorMap: boolean;
    hasNormalMap: boolean;
  }[];
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

const colorToHex = (color: Color | undefined, fallback: string) => `#${(color ?? new Color(fallback)).getHexString()}`;

function materialInspection(material: Material, index: number): ModelInspection['materials'][number] {
  const mat = material as Material & {
    color?: Color;
    metalness?: number;
    roughness?: number;
    emissive?: Color;
    emissiveIntensity?: number;
    map?: unknown;
    normalMap?: unknown;
  };
  return {
    name: material.name || `Imported Material ${index + 1}`,
    color: colorToHex(mat.color, '#ffffff'),
    metalness: typeof mat.metalness === 'number' ? mat.metalness : 0,
    roughness: typeof mat.roughness === 'number' ? mat.roughness : 0.65,
    emissiveColor: colorToHex(mat.emissive, '#000000'),
    emissiveIntensity: typeof mat.emissiveIntensity === 'number' ? mat.emissiveIntensity : 0,
    hasBaseColorMap: Boolean(mat.map),
    hasNormalMap: Boolean(mat.normalMap),
  };
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
  const seenMaterials = new Set<string>();
  const materials: ModelInspection['materials'] = [];
  gltf.scene.traverse((node) => {
    const skinned = node as SkinnedMesh;
    if (!skeleton && skinned.isSkinnedMesh && skinned.skeleton) {
      const boneNames = skinned.skeleton.bones.map((bone) => bone.name);
      if (boneNames.length) skeleton = { boneNames, rootBone: boneNames[0], signature: signatureOf(boneNames) };
    }

    const mesh = node as Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of meshMaterials) {
      const key = material.uuid;
      if (seenMaterials.has(key)) continue;
      seenMaterials.add(key);
      materials.push(materialInspection(material, materials.length));
    }
  });

  const clips = (gltf.animations ?? []).map((clip) => ({ name: clip.name, duration: clip.duration }));
  return { skeleton, clips, materials };
}
