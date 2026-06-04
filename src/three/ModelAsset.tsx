import { useEffect, useMemo, useState } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { useEditorStore } from '../store/editorStore';
import { registerModelGeometry } from '../runtime/meshGeometryCache';
import { qualityProfile } from './quality';
import { applyAnisotropy } from './textureQuality';

/** Anisotropy for the current quality preset, read non-reactively (textures persist across changes). */
const currentAnisotropy = (): number =>
  qualityProfile(useEditorStore.getState().renderSettings?.quality).maxAnisotropy;

/** Resolve any asset id to its runtime URL (blob:/asset:// in the editor, data: in an export). */
export function useAssetUrl(assetId?: string): string | undefined {
  const assets = useEditorStore((state) => state.assets);
  if (!assetId) return undefined;
  return assets.find((item) => item.id === assetId)?.url;
}

/** Back-compat alias for the model-specific resolver. */
export const useModelUrl = useAssetUrl;

/**
 * Refcounted, (url+flipY)-keyed texture cache. Without it, every object that references the same
 * image map loaded its OWN THREE.Texture and uploaded it to the GPU separately — 100 crates sharing
 * one texture meant 100 GPU uploads. Now the texture is loaded/uploaded once and shared; it's disposed
 * only when the last consumer unmounts. `TextureLoader.load` returns the Texture synchronously (the
 * image fills in asynchronously and triggers an upload), so acquire can hand it back immediately.
 */
interface TextureCacheEntry {
  texture: THREE.Texture;
  refs: number;
}
const textureCache = new Map<string, TextureCacheEntry>();

function acquireTexture(url: string, flipY: boolean): THREE.Texture {
  const key = `${url}|${flipY ? 1 : 0}`;
  const existing = textureCache.get(key);
  if (existing) {
    existing.refs += 1;
    return existing.texture;
  }
  const anisotropy = currentAnisotropy();
  const texture = new THREE.TextureLoader().load(url, (loaded) => {
    loaded.colorSpace = THREE.SRGBColorSpace;
    loaded.flipY = flipY;
    loaded.anisotropy = anisotropy;
    loaded.needsUpdate = true;
  });
  // Set the UV/color/filtering conventions up front too, so the first GPU upload uses them.
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = flipY;
  texture.anisotropy = anisotropy;
  textureCache.set(key, { texture, refs: 1 });
  return texture;
}

function releaseTexture(url: string, flipY: boolean) {
  const key = `${url}|${flipY ? 1 : 0}`;
  const entry = textureCache.get(key);
  if (!entry) return;
  entry.refs -= 1;
  if (entry.refs <= 0) {
    entry.texture.dispose();
    textureCache.delete(key);
  }
}

/**
 * Load an image URL into a texture usable as a material map. `flipY` follows the geometry's UV
 * convention: glTF/GLB models expect `false`, three.js built-in geometries expect `true`.
 * Backed by the shared refcounted cache above, so identical maps are uploaded once.
 */
export function useAssetTexture(url: string | undefined, flipY = false): THREE.Texture | undefined {
  const [texture, setTexture] = useState<THREE.Texture>();
  useEffect(() => {
    if (!url) {
      setTexture(undefined);
      return;
    }
    setTexture(acquireTexture(url, flipY));
    return () => {
      setTexture(undefined);
      releaseTexture(url, flipY);
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
export function ModelAsset({ url, material, geometryKey }: { url: string; material?: ModelMaterial; geometryKey?: string }) {
  const { scene } = useGLTF(url);
  const baseTexture = useAssetTexture(material?.baseColorUrl, false);
  const normalTexture = useAssetTexture(material?.normalUrl, false);

  const clone = useMemo(() => {
    const anisotropy = currentAnisotropy();
    const root = scene.clone(true);
    root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      const cloneMat = (mat: THREE.Material) => {
        const next = mat.clone();
        const std = next as THREE.MeshStandardMaterial;
        // Anisotropic filtering on every baked map keeps the model's textures crisp at grazing angles.
        for (const map of [std.map, std.normalMap, std.roughnessMap, std.metalnessMap, std.emissiveMap, std.aoMap]) {
          applyAnisotropy(map, anisotropy);
        }
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

    return normalizeModelScale(root);
  }, [scene]);

  // Cache the merged geometry (in the clone's local space, so the normalization
  // wrapper is baked in) for mesh/convex physics colliders and the collider gizmo.
  useEffect(() => {
    registerModelGeometry(geometryKey, clone);
  }, [clone, geometryKey]);

  // The clone above gives every instance its OWN cloned materials (so per-object overrides don't
  // leak into the shared useGLTF cache). Those clones must be disposed when this clone is replaced
  // (model swapped / re-imported) or the component unmounts, or their GPU programs leak for the
  // whole session. `material.dispose()` frees the program only — it does NOT free textures, so the
  // shared GLTF-cache textures and the useAssetTexture-managed maps are left intact.
  useEffect(
    () => () => {
      clone.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh || !mesh.material) return;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of materials) mat.dispose();
      });
    },
    [clone],
  );

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

/**
 * Normalize an EXTREME baked scale (e.g. FBX→glTF exports that bake a 100× node matrix, making a model
 * hundreds of units big). Wraps `root` so its largest dimension ≈ 1 unit, keeping the object's own
 * transform.scale intuitive (scale 1 ≈ 1 unit). Normal-sized models (0.05–20u) are returned unchanged.
 * Shared by ModelAsset and the instancing extractor so an instanced model is sized IDENTICALLY to the
 * per-object one — diverging here would make instanced decor the wrong size.
 */
export function normalizeModelScale(root: THREE.Object3D): THREE.Object3D {
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
}

export interface InstanceSubmesh {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** The submesh's transform relative to the model root (incl. the scale-normalization wrapper). */
  localMatrix: THREE.Matrix4;
}

/**
 * Extract the renderable submeshes of a glTF scene for GPU instancing: each is a (geometry, material,
 * local-matrix-within-the-model) triple. Geometry and material are SHARED from the loaded glTF (one
 * upload, reused across all instances). The local matrix bakes in the same scale-normalization
 * ModelAsset applies, so a per-submesh InstancedMesh placed at an object's world transform matches
 * exactly what the non-instanced ModelAsset would draw. Read-only on the source scene.
 */
export function extractInstanceSubmeshes(scene: THREE.Object3D, anisotropy: number): InstanceSubmesh[] {
  // Clone the graph (shares geometry + materials — one GPU upload, reused) so we never mutate the
  // shared useGLTF-cached scene when normalizeModelScale reparents under a wrapper.
  const root = normalizeModelScale(scene.clone(true));
  root.updateWorldMatrix(true, true);
  const out: InstanceSubmesh[] = [];
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    // A multi-material mesh uses geometry groups; instancing one material per submesh covers the
    // common single-material case. Use the first material for grouped meshes (rare for decor props).
    const material = mats[0];
    if (!material) return;
    const std = material as THREE.MeshStandardMaterial;
    for (const map of [std.map, std.normalMap, std.roughnessMap, std.metalnessMap, std.emissiveMap, std.aoMap]) {
      applyAnisotropy(map, anisotropy);
    }
    out.push({ geometry: mesh.geometry, material, localMatrix: mesh.matrixWorld.clone() });
  });
  return out;
}
