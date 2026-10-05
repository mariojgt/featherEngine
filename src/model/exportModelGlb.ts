import type * as THREE from 'three';
import type { ModelSpec } from '../types';
import { buildModelGroup } from './modelGeometry';

/** Resolves a part's project material (part.materialId) to a ready three.js material for the bake. */
export type BakeMaterialResolver = (materialId: string) => Promise<THREE.Material | undefined>;

/**
 * Bake a prototype model into a real `.glb` File, ready for the ordinary asset import pipeline
 * (`addAssets`) — the same trick fbxToGlb uses. From there it is a first-class model asset:
 * thumbnailed, placeable, exportable in .nfpack packages, and openable in Blender. Parts with a
 * project material bake with it (PBR values + texture maps through the part UVs) when a resolver is
 * given; otherwise they bake their palette color.
 */
export async function modelSpecToGlbFile(spec: ModelSpec, resolveMaterial?: BakeMaterialResolver): Promise<File> {
  const { GLTFExporter } = await import('three-stdlib');
  const overrides = new Map<string, THREE.Material>();
  if (resolveMaterial) {
    for (const materialId of new Set(spec.parts.map((part) => part.materialId).filter((id): id is string => !!id))) {
      const material = await resolveMaterial(materialId).catch(() => undefined);
      if (material) overrides.set(materialId, material);
    }
  }
  const glb = (await new GLTFExporter().parseAsync(buildModelGroup(spec, overrides), { binary: true })) as ArrayBuffer;
  overrides.forEach((material) => material.dispose());
  const stem = spec.name.trim().replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'model';
  return new File([glb], `${stem}.glb`, { type: 'model/gltf-binary' });
}
