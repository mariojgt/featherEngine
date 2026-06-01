import { useEditorStore } from '../store/editorStore';
import type { MeshRendererComponent } from '../types';
import { resolveMaterial, type ResolvedMaterial } from './materialResolve';

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
  const resolved = resolveMaterial(renderer, materials, graphs);
  const urlFor = (id?: string) => (id ? assets.find((asset) => asset.id === id)?.url : undefined);
  return { ...resolved, baseColorUrl: urlFor(resolved.baseColorAssetId), normalUrl: urlFor(resolved.normalAssetId) };
}
