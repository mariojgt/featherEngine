import { useEffect, useMemo, useRef, useState } from 'react';
import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { convertFileSrc } from '@tauri-apps/api/core';
import * as THREE from 'three';
import { useEditorStore } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import { isDesktop } from '../platform';
import type { AssetItem } from '../types';
import { registerModelGeometry } from '../runtime/meshGeometryCache';
import { getVehicleDents } from '../runtime/vehicleDamageBus';
import { qualityProfile } from './quality';
import { applyAnisotropy } from './textureQuality';
import { DRACO_DECODER_PATH, extendGLTFLoader } from './gltfDecoders';

/** Anisotropy for the current quality preset, read non-reactively (textures persist across changes). */
const currentAnisotropy = (): number =>
  qualityProfile(useEditorStore.getState().renderSettings?.quality).maxAnisotropy;

/** Resolve any asset id to its runtime URL (blob:/asset:// in the editor, data: in an export). */
export function useAssetUrl(assetId?: string): string | undefined {
  const assets = useEditorStore((state) => state.assets);
  const projectDir = useProjectStore((state) => state.projectDir);
  if (!assetId) return undefined;
  return resolveAssetItemUrl(assets.find((item) => item.id === assetId), projectDir);
}

/** Back-compat alias for the model-specific resolver. */
export const useModelUrl = useAssetUrl;

/** Resolve an asset's live URL, rebuilding desktop URLs from persisted project paths when needed. */
export function resolveAssetItemUrl(asset: AssetItem | undefined, projectDir: string | null): string | undefined {
  if (!asset) return undefined;
  if (asset.url) return asset.url;
  if (asset.data) return asset.data;
  if (!asset.path || !projectDir || projectDir === 'web' || !isDesktop) return undefined;

  const cleanDir = projectDir.replace(/[\\/]+$/, '');
  const cleanPath = asset.path.replace(/^[\\/]+/, '');
  const separator = cleanDir.includes('\\') || /^[A-Za-z]:/.test(cleanDir) ? '\\' : '/';
  const absolutePath = `${cleanDir}${separator}${cleanPath.replace(/[\\/]+/g, separator)}`;
  return convertFileSrc(absolutePath);
}

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
  objectUrl?: string;
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
  const applyTextureSettings = (loaded: THREE.Texture) => {
    loaded.colorSpace = THREE.SRGBColorSpace;
    loaded.flipY = flipY;
    loaded.anisotropy = anisotropy;
    loaded.needsUpdate = true;
  };
  const loader = new THREE.TextureLoader();
  const texture = loader.load(url, applyTextureSettings, undefined, async (error) => {
    // Tauri's asset protocol can occasionally fail as an <img> source even though fetch can read it.
    // Re-load through a blob URL so desktop project paths with spaces/parentheses still work.
    if (!isDesktop || url.startsWith('blob:') || url.startsWith('data:')) {
      console.warn('Texture load failed:', url, error);
      return;
    }
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const objectUrl = URL.createObjectURL(await response.blob());
      loader.load(objectUrl, (loaded) => {
        texture.image = loaded.image;
        applyTextureSettings(texture);
        loaded.dispose();
        const entry = textureCache.get(key);
        if (entry) entry.objectUrl = objectUrl;
      });
    } catch (fallbackError) {
      console.warn('Texture load fallback failed:', url, fallbackError);
    }
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
    if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
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
  /** Advanced physical layers — only take effect on slots whose baked material is a MeshPhysicalMaterial. */
  clearcoat?: number;
  clearcoatRoughness?: number;
  sheen?: number;
  sheenColor?: string;
  transmission?: number;
  ior?: number;
  thickness?: number;
  iridescence?: number;
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
export function ModelAsset({
  url,
  material,
  slotMaterials,
  geometryKey,
  deformObjectId,
}: {
  url: string;
  /** Whole-model override; the fallback for any slot without a per-slot material. */
  material?: ModelMaterial;
  /** Per-material-slot overrides, indexed by the model's slot order (see useResolvedMaterialSlots). */
  slotMaterials?: (ModelMaterial | undefined)[];
  geometryKey?: string;
  /** When set, this model is a DEFORMABLE vehicle body: its geometry is cloned and plastically crumpled from
   *  the dents recorded for this object id (vehicleDamageBus). Soft-body crash damage. */
  deformObjectId?: string;
}) {
  const { scene } = useGLTF(url, DRACO_DECODER_PATH, true, extendGLTFLoader);

  const clone = useMemo(() => {
    const anisotropy = currentAnisotropy();
    const root = scene.clone(true);
    // Assign each distinct source material a slot index in first-appearance traversal order — the SAME
    // order inspectModel reports — so slot i here is the i-th imported material. `scene.clone(true)`
    // shares material objects with the source, so this Map keys correctly across submeshes.
    const slotByMaterial = new Map<THREE.Material, number>();
    root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      const cloneMat = (mat: THREE.Material) => {
        let slot = slotByMaterial.get(mat);
        if (slot === undefined) {
          slot = slotByMaterial.size;
          slotByMaterial.set(mat, slot);
        }
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
        next.userData.__slotIndex = slot;
        return next;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(cloneMat) : cloneMat(mesh.material);
    });

    const normalized = normalizeModelScale(root);
    // A static model's INTERIOR nodes never move relative to each other — but three.js recomposes
    // every auto-update node's local matrix on every frame's updateMatrixWorld walk, so a city of
    // multi-hundred-node GLBs burns CPU re-deriving matrices that never change. Bake them once and
    // freeze. The root stays auto-updating (the scene-object group above carries the live transform,
    // and a moving parent still propagates matrixWorld through frozen children — only the LOCAL
    // recompose is skipped). Dents/damage deform vertex buffers, not node transforms, so they're safe.
    normalized.updateMatrixWorld(true);
    normalized.traverse((node) => {
      if (node !== normalized) node.matrixAutoUpdate = false;
    });
    return normalized;
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

  // Base-color/normal maps for the whole-model material AND every per-slot material are loaded here
  // imperatively through the shared refcounted cache, keyed by URL. `useAssetTexture` is a hook, so it
  // can't scale to an unknown number of slots; driving acquire/release directly does. The acquired
  // Texture is returned synchronously (its image fills in async and uploads itself), so we can assign it
  // to the material right away. The set of live URLs is reconciled each run; leftovers free on unmount.
  const textureMapRef = useRef(new Map<string, THREE.Texture>());
  useEffect(() => {
    const textures = textureMapRef.current;
    const needed = new Set<string>();
    const consider = (m?: ModelMaterial) => {
      if (m?.baseColorUrl) needed.add(m.baseColorUrl);
      if (m?.normalUrl) needed.add(m.normalUrl);
    };
    consider(material);
    slotMaterials?.forEach(consider);
    for (const u of needed) if (!textures.has(u)) textures.set(u, acquireTexture(u, false));
    for (const u of [...textures.keys()])
      if (!needed.has(u)) {
        releaseTexture(u, false);
        textures.delete(u);
      }
    const tex = (u?: string) => (u ? textures.get(u) : undefined);

    clone.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      const meshMaterials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshStandardMaterial[];
      for (const mat of meshMaterials) {
        const original = mat.userData.__original as OriginalMaterial | undefined;
        if (!original) continue;
        // Per-slot binding wins; otherwise the whole-model material applies (or neither → baked).
        const slot = mat.userData.__slotIndex as number | undefined;
        const chosen = (slot !== undefined ? slotMaterials?.[slot] : undefined) ?? material;

        // Texture maps: a chosen map overrides the imported one; clearing it restores the original.
        mat.map = chosen?.baseColorUrl ? tex(chosen.baseColorUrl) ?? original.map : original.map;
        mat.normalMap = chosen?.normalUrl ? tex(chosen.normalUrl) ?? original.normalMap : original.normalMap;

        // Material props: applied as a full override, or reverted to the imported values.
        if (chosen?.override) {
          mat.color?.set(chosen.color);
          if (typeof mat.metalness === 'number') mat.metalness = chosen.metalness;
          if (typeof mat.roughness === 'number') mat.roughness = chosen.roughness;
          mat.emissive?.set(chosen.emissiveColor);
          if (typeof mat.emissiveIntensity === 'number') mat.emissiveIntensity = chosen.emissiveIntensity;
          // Advanced physical layers — only on physical slots, and only when a layer is engaged, so
          // recoloring a baked-glass model doesn't silently zero out its imported transmission/coat.
          const phys = mat as THREE.MeshPhysicalMaterial;
          const physEngaged =
            (chosen.clearcoat ?? 0) > 0 || (chosen.sheen ?? 0) > 0 || (chosen.transmission ?? 0) > 0 || (chosen.iridescence ?? 0) > 0;
          if (phys.isMeshPhysicalMaterial && physEngaged) {
            phys.clearcoat = chosen.clearcoat ?? 0;
            phys.clearcoatRoughness = chosen.clearcoatRoughness ?? 0;
            phys.sheen = chosen.sheen ?? 0;
            if (chosen.sheenColor) phys.sheenColor.set(chosen.sheenColor);
            phys.transmission = chosen.transmission ?? 0;
            phys.ior = chosen.ior ?? 1.5;
            phys.thickness = chosen.thickness ?? 0;
            phys.iridescence = chosen.iridescence ?? 0;
          }
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
  }, [clone, material, slotMaterials]);

  // Release every texture this instance still holds when it unmounts (the reconcile above balances
  // acquire/release during life; this frees whatever remains).
  useEffect(() => {
    const textures = textureMapRef.current;
    return () => {
      for (const u of textures.keys()) releaseTexture(u, false);
      textures.clear();
    };
  }, []);

  // --- Soft-body crash damage -------------------------------------------------------------------------------
  // For a deformable vehicle body, clone each mesh's geometry (so we never mutate the shared cache), keep a
  // pristine copy of its vertices, and precompute the quaternion that maps a CAR-LOCAL impact direction into
  // each mesh's own local space. The actual crumple is applied in useFrame whenever the dent set changes.
  const deformMeshes = useMemo(() => {
    if (!deformObjectId) return null;
    clone.updateWorldMatrix(true, true);
    const rootQuat = new THREE.Quaternion();
    clone.getWorldQuaternion(rootQuat);
    const out: { geom: THREE.BufferGeometry; orig: Float32Array; center: THREE.Vector3; toMesh: THREE.Quaternion }[] = [];
    clone.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      const geom = (mesh.geometry as THREE.BufferGeometry).clone();
      mesh.geometry = geom;
      const pos = geom.getAttribute('position') as THREE.BufferAttribute;
      const orig = new Float32Array(pos.array as Float32Array);
      geom.computeBoundingBox();
      const center = geom.boundingBox!.getCenter(new THREE.Vector3());
      const meshQuat = new THREE.Quaternion();
      mesh.getWorldQuaternion(meshQuat);
      // car-local dir → mesh-local dir  =  meshWorldQuat⁻¹ · rootWorldQuat
      const toMesh = meshQuat.clone().invert().multiply(rootQuat);
      out.push({ geom, orig, center, toMesh });
    });
    return out;
  }, [clone, deformObjectId]);

  const lastDentVersion = useRef(-1);
  // A new clone (garage body swap) starts pristine — force one re-deform so existing dents re-apply to it.
  useEffect(() => {
    lastDentVersion.current = -1;
  }, [deformMeshes]);
  useFrame(() => {
    if (!deformObjectId || !deformMeshes) return;
    const state = getVehicleDents(deformObjectId);
    const version = state?.version ?? 0;
    const dents = state?.dents ?? [];
    // Recompute ONLY when the damage changes. Re-applying every frame while dented (the old behavior)
    // walked every vertex + recomputed normals on the whole body 60×/s after the FIRST crash — a permanent
    // frame-rate tax for the rest of the run.
    if (version === lastDentVersion.current) return;
    lastDentVersion.current = version;
    const v = new THREE.Vector3();
    for (const m of deformMeshes) {
      const pos = m.geom.getAttribute('position') as THREE.BufferAttribute | undefined;
      if (!pos) continue;
      const arr = pos.array as Float32Array;
      arr.set(m.orig); // always crumple from the PRISTINE shape (no float drift across hits)
      if (dents.length) {
        const local = dents.map((d) => ({
          dir: new THREE.Vector3(d.dir[0], d.dir[1], d.dir[2]).applyQuaternion(m.toMesh).normalize(),
          depth: d.depth,
        }));
        for (let i = 0; i < arr.length; i += 3) {
          v.set(arr[i] - m.center.x, arr[i + 1] - m.center.y, arr[i + 2] - m.center.z);
          const r = v.length() || 1e-4;
          const nx = v.x / r, ny = v.y / r, nz = v.z / r;
          for (const d of local) {
            const dot = nx * d.dir.x + ny * d.dir.y + nz * d.dir.z;
            if (dot > 0.1) {
              // Push the impacted face inward; outer panels (bigger r) crush more for a crumpled look.
              const push = d.depth * Math.pow((dot - 0.1) / 0.9, 1.3) * (0.7 + 0.6 * Math.min(1.4, r));
              arr[i] -= d.dir.x * push;
              arr[i + 1] -= d.dir.y * push;
              arr[i + 2] -= d.dir.z * push;
            }
          }
        }
      }
      pos.needsUpdate = true;
      m.geom.computeVertexNormals();
      m.geom.computeBoundingSphere();
    }
  });

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
