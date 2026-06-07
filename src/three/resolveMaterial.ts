import { useMemo } from 'react';
import { useEditorStore } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import type { MeshRendererComponent } from '../types';
import { resolveMaterial, type ResolvedMaterial } from './materialResolve';
import { resolveAssetItemUrl } from './ModelAsset';

// Re-export the pure resolver + types so existing imports from this module keep working.
export { resolveMaterial, evaluateMaterialGraph } from './materialResolve';
export type { ResolvedMaterial, MaterialGraphOutput } from './materialResolve';

/** Resolved material plus the runtime URLs for its texture maps. */
export interface ResolvedMaterialUrls extends ResolvedMaterial {
  baseColorUrl?: string;
  normalUrl?: string;
}

/** Hook form: resolves the material from the store and turns texture asset ids into runtime URLs. */
export function useResolvedMaterial(renderer: MeshRendererComponent | undefined): ResolvedMaterialUrls {
  const materials = useEditorStore((state) => state.materials);
  const graphs = useEditorStore((state) => state.graphs);
  const assets = useEditorStore((state) => state.assets);
  const projectDir = useProjectStore((state) => state.projectDir);
  // Only recompute when the inputs actually change identity. During Play the material/graph/asset
  // arrays are stable and a static object's `renderer` keeps its reference, so this holds across
  // frames instead of re-walking the material graph + scanning assets on every render.
  return useMemo(() => {
    const resolved = resolveMaterial(renderer, materials, graphs);
    const urlFor = (id?: string) => (id ? resolveAssetItemUrl(assets.find((asset) => asset.id === id), projectDir) : undefined);
    return { ...resolved, baseColorUrl: urlFor(resolved.baseColorAssetId), normalUrl: urlFor(resolved.normalAssetId) };
  }, [renderer, materials, graphs, assets, projectDir]);
}

/**
 * Per-slot resolved materials for an imported model, indexed by the model's material-slot order.
 *
 * Each slot defaults to the imported material created for it on import (matched by `sourceAssetId`),
 * so editing that material shows on the model with no per-object wiring; `renderer.materialSlots[i]`
 * overrides a slot for this specific object. Returns `undefined` when the model has no imported
 * materials and no overrides — the caller then falls back to the single whole-model material.
 */
export function useResolvedMaterialSlots(
  renderer: MeshRendererComponent | undefined,
): (ResolvedMaterialUrls | undefined)[] | undefined {
  const materials = useEditorStore((state) => state.materials);
  const graphs = useEditorStore((state) => state.graphs);
  const assets = useEditorStore((state) => state.assets);
  const projectDir = useProjectStore((state) => state.projectDir);
  return useMemo(() => {
    if (!renderer?.modelAssetId) return undefined;
    // Imported materials for this model, in creation (= slot) order — the per-slot defaults.
    const defaults = materials.filter((material) => material.sourceAssetId === renderer.modelAssetId);
    const overrides = renderer.materialSlots ?? [];
    const slotCount = Math.max(defaults.length, overrides.length);
    if (slotCount === 0) return undefined;
    const urlFor = (id?: string) => (id ? resolveAssetItemUrl(assets.find((asset) => asset.id === id), projectDir) : undefined);
    const result: (ResolvedMaterialUrls | undefined)[] = [];
    for (let i = 0; i < slotCount; i += 1) {
      const materialId = overrides[i] ?? defaults[i]?.id;
      if (!materialId) {
        result.push(undefined); // explicit "None" — keep this slot's baked material
        continue;
      }
      const slotRenderer = { materialId, opacity: renderer.opacity } as MeshRendererComponent;
      const resolved = resolveMaterial(slotRenderer, materials, graphs);
      result.push({ ...resolved, baseColorUrl: urlFor(resolved.baseColorAssetId), normalUrl: urlFor(resolved.normalAssetId) });
    }
    return result;
  }, [renderer, materials, graphs, assets, projectDir]);
}
