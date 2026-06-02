import { useEffect, useMemo, useState } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { useEditorStore } from '../store/editorStore';

/** Resolve any asset id to its runtime URL (blob:/asset:// in the editor, data: in an export). */
export function useAssetUrl(assetId?: string): string | undefined {
  const assets = useEditorStore((state) => state.assets);
  if (!assetId) return undefined;
  return assets.find((item) => item.id === assetId)?.url;
}

/** Back-compat alias for the model-specific resolver. */
export const useModelUrl = useAssetUrl;

/**
 * Load an image URL into a texture usable as a material map. `flipY` follows the geometry's UV
 * convention: glTF/GLB models expect `false`, three.js built-in geometries expect `true`.
 */
export function useAssetTexture(url: string | undefined, flipY = false): THREE.Texture | undefined {
  const [texture, setTexture] = useState<THREE.Texture>();
  useEffect(() => {
    if (!url) {
      setTexture(undefined);
      return;
    }
    let active = true;
    new THREE.TextureLoader().load(url, (loaded) => {
      loaded.colorSpace = THREE.SRGBColorSpace;
      loaded.flipY = flipY;
      if (active) setTexture(loaded);
      else loaded.dispose();
    });
    return () => {
      active = false;
    };
  }, [url, flipY]);
  return texture;
}

export interface ModelMaterial {
  color: string;
  metalness: number;
  roughness: number;
  emissiveColor: string;
  emissiveIntensity: number;
  /** When true, override the model's baked materials with the props above. */
  override: boolean;
  /** Resolved URL of the base-color map, if any. */
  baseColorUrl?: string;
  /** Resolved URL of the normal map, if any. */
  normalUrl?: string;
}

/** Each cloned material remembers its imported values so overrides can be toggled back off. */
type OriginalMaterial = {
  color?: THREE.Color;
  metalness?: number;
  roughness?: number;
  emissive?: THREE.Color;
  emissiveIntensity?: number;
  map: THREE.Texture | null;
  normalMap: THREE.Texture | null;
};

/**
 * Renders an imported glTF/GLB model from a URL. Each instance gets its own clone — including
 * cloned materials — so per-object material overrides never leak into the `useGLTF` cache shared
 * by every other instance of the same model. Suspends while loading — render inside a <Suspense>.
 */
export function ModelAsset({ url, material }: { url: string; material?: ModelMaterial }) {
  const { scene } = useGLTF(url);
  const baseTexture = useAssetTexture(material?.baseColorUrl, false);
  const normalTexture = useAssetTexture(material?.normalUrl, false);

  const clone = useMemo(() => {
    const root = scene.clone(true);
    root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      const cloneMat = (mat: THREE.Material) => {
        const next = mat.clone();
        const std = next as THREE.MeshStandardMaterial;
        next.userData.__original = {
          color: std.color?.clone(),
          metalness: typeof std.metalness === 'number' ? std.metalness : undefined,
          roughness: typeof std.roughness === 'number' ? std.roughness : undefined,
          emissive: std.emissive?.clone(),
          emissiveIntensity: typeof std.emissiveIntensity === 'number' ? std.emissiveIntensity : undefined,
          map: std.map ?? null,
          normalMap: std.normalMap ?? null,
        } satisfies OriginalMaterial;
        return next;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(cloneMat) : cloneMat(mesh.material);
    });

    // Normalize an EXTREME baked scale (e.g. FBX→glTF exports that bake a 100× node matrix, making a
    // model hundreds of units big). Wrapping it so its largest dimension ≈ 1 unit keeps the object's
    // own transform.scale intuitive (scale 1 ≈ 1 unit). Normal-sized models (0.05–20u) are left as-is.
    root.updateWorldMatrix(true, true);
    const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim > 20 || (maxDim > 1e-6 && maxDim < 0.05)) {
      const wrapper = new THREE.Group();
      wrapper.scale.setScalar(1 / maxDim);
      wrapper.add(root);
      return wrapper;
    }
    return root;
  }, [scene]);

  useEffect(() => {
    clone.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshStandardMaterial[];
      for (const mat of materials) {
        const original = mat.userData.__original as OriginalMaterial | undefined;
        if (!original) continue;

        // Texture maps: a chosen map overrides the imported one; clearing it restores the original.
        mat.map = material?.baseColorUrl ? baseTexture ?? original.map : original.map;
        mat.normalMap = material?.normalUrl ? normalTexture ?? original.normalMap : original.normalMap;

        // Material props: applied as a full override, or reverted to the imported values.
        if (material?.override) {
          mat.color?.set(material.color);
          if (typeof mat.metalness === 'number') mat.metalness = material.metalness;
          if (typeof mat.roughness === 'number') mat.roughness = material.roughness;
          mat.emissive?.set(material.emissiveColor);
          if (typeof mat.emissiveIntensity === 'number') mat.emissiveIntensity = material.emissiveIntensity;
        } else {
          if (original.color && mat.color) mat.color.copy(original.color);
          if (typeof original.metalness === 'number') mat.metalness = original.metalness;
          if (typeof original.roughness === 'number') mat.roughness = original.roughness;
          if (original.emissive && mat.emissive) mat.emissive.copy(original.emissive);
          if (typeof original.emissiveIntensity === 'number') mat.emissiveIntensity = original.emissiveIntensity;
        }
        mat.needsUpdate = true;
      }
    });
  }, [
    clone,
    baseTexture,
    normalTexture,
    material?.baseColorUrl,
    material?.normalUrl,
    material?.override,
    material?.color,
    material?.metalness,
    material?.roughness,
    material?.emissiveColor,
    material?.emissiveIntensity,
  ]);

  return <primitive object={clone} />;
}
