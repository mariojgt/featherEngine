import * as THREE from 'three';
import { useEditorStore } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import type { MeshRendererComponent } from '../types';
import { resolveMaterial } from './materialResolve';
import { resolveAssetItemUrl } from './ModelAsset';
import type { BakeMaterialResolver } from '../model/exportModelGlb';

/**
 * Bake-time resolver for Model Forge parts that use project materials: the same resolved PBR values
 * the viewport renders, with texture maps loaded fresh (not from the shared render cache, since the
 * exporter reads image pixels and the result is disposed after the bake).
 */
export const projectBakeMaterialResolver: BakeMaterialResolver = async (materialId) => {
  const state = useEditorStore.getState();
  if (!state.materials.some((material) => material.id === materialId)) return undefined;
  const resolved = resolveMaterial({ materialId } as MeshRendererComponent, state.materials, state.graphs);
  const projectDir = useProjectStore.getState().projectDir;
  const load = async (assetId?: string, color = false) => {
    const url = assetId ? resolveAssetItemUrl(state.assets.find((asset) => asset.id === assetId), projectDir) : undefined;
    if (!url) return null;
    const texture = await new THREE.TextureLoader().loadAsync(url).catch(() => null);
    if (texture) {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      if (color) texture.colorSpace = THREE.SRGBColorSpace;
    }
    return texture;
  };
  return new THREE.MeshStandardMaterial({
    name: state.materials.find((material) => material.id === materialId)?.name,
    color: resolved.color,
    metalness: resolved.metalness,
    roughness: resolved.roughness,
    emissive: resolved.emissiveColor,
    emissiveIntensity: resolved.emissiveIntensity,
    map: await load(resolved.baseColorAssetId, true),
    normalMap: await load(resolved.normalAssetId),
    transparent: resolved.opacity < 1,
    opacity: resolved.opacity,
  });
};
