import * as THREE from 'three';
import type { StoreApi } from 'zustand';
import type { EditorState } from '../editorStore';
import type { ModelPart } from '../../types';
import { getPartRenderGeometry } from '../../model/modelGeometry';
import { makePolyMesh, meshFaces } from '../../model/polyMesh';

type SetState = StoreApi<EditorState>['setState'];
type GetState = StoreApi<EditorState>['getState'];

export interface BakeModelTexturesOptions {
  /** Extra maps on top of the always-baked base color: ambient occlusion (multiplied into the color) and a tangent-space normal map. */
  ao?: boolean;
  normal?: boolean;
  size?: number;
  samples?: number;
}

export interface BakeModelTexturesResult {
  ok: boolean;
  message: string;
  materialId?: string;
  assetIds?: string[];
}

const partMatrix = (part: Pick<ModelPart, 'position' | 'rotation'>, scale: THREE.Vector3) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(...part.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...part.rotation)),
    scale,
  );

/**
 * Bake a mesh part's look into real textures — base color (palette paint × soft ambient occlusion)
 * and a normal map carrying the subdivided detail — then wire them up as a project material on the
 * part. The result is a game-ready low-poly asset: the subdivision modifier is switched OFF (kept in
 * the stack, re-enable any time) because its detail now lives in the normal map, and the textures
 * travel with Bake to GLB and every engine export.
 *
 * Other parts of the model act as occluders, so a handle darkens the mug body it touches.
 */
export async function applyBakeModelPartTextures(
  set: SetState,
  get: GetState,
  specId: string,
  partId: string,
  options: BakeModelTexturesOptions = {},
): Promise<BakeModelTexturesResult> {
  const findPart = () => get().modelSpecs.find((entry) => entry.id === specId)?.parts.find((part) => part.id === partId);
  if (!findPart()) return { ok: false, message: 'Unknown model or part.' };
  if (findPart()!.shape !== 'mesh' && !get().convertModelPartToMesh(specId, partId)) {
    return { ok: false, message: 'Could not convert this part to a mesh for baking.' };
  }
  const { bakePartTextures, bakeResultToFiles, ensureBakeUVs } = await import('../../model/meshBake');

  // 1. Non-overlapping UVs (Smart UV) — required so every texel belongs to exactly one face.
  const unwrapped = ensureBakeUVs(findPart()!);
  if (unwrapped !== findPart()) get().updateModelPart(specId, partId, { mesh: unwrapped.mesh });
  const part = findPart()!;
  const spec = get().modelSpecs.find((entry) => entry.id === specId)!;

  // 2. Occluders: every other part, expressed in this part's local frame with world scale kept
  //    (the baker works in part-local space × part.scale).
  const toBakeSpace = partMatrix(part, new THREE.Vector3(1, 1, 1)).invert();
  const occluders = spec.parts
    .filter((other) => other.id !== partId)
    .map((other) => {
      const geometry = getPartRenderGeometry(other, spec.style).clone();
      geometry.applyMatrix4(partMatrix(other, new THREE.Vector3(...other.scale).set(
        Math.abs(other.scale[0]), Math.abs(other.scale[1]), Math.abs(other.scale[2]),
      )));
      geometry.applyMatrix4(toBakeSpace);
      const position = geometry.getAttribute('position') as THREE.BufferAttribute;
      const index = geometry.getIndex();
      const indices = index
        ? Uint32Array.from({ length: index.count }, (_, i) => index.getX(i))
        : Uint32Array.from({ length: position.count }, (_, i) => i);
      const positions = Float32Array.from(position.array as ArrayLike<number>);
      geometry.dispose();
      return { positions, indices };
    });

  // 3. Bake (CPU; a 512² bake is ~1-2 s).
  const maps: Array<'color' | 'ao' | 'normal'> = ['color'];
  if (options.ao !== false) maps.push('ao');
  if (options.normal) maps.push('normal');
  let result;
  try {
    result = bakePartTextures(part, maps, {
      palette: spec.palette,
      occluders,
      size: options.size,
      samples: options.samples,
    });
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }

  // 4. Image assets → project material → part.
  const baseName = `${spec.name}-${part.name}`.trim().replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'baked';
  const files = await bakeResultToFiles(result, baseName);
  get().addAssets(files);
  const added = get().assets.slice(-files.length);
  const assetFor = (suffix: string) => added.find((asset) => asset.name.endsWith(suffix))?.id;
  const materialId = get().createMaterial(`${part.name} (baked)`, `Baked by Model Forge from "${spec.name}"`);
  get().updateMaterial(materialId, {
    color: '#ffffff',
    metalness: 0,
    roughness: spec.style?.roughness ?? 0.6,
    textureAssetId: assetFor('-basecolor.png'),
    normalMapAssetId: assetFor('-normal.png'),
  });

  // The paint is in the texture now: clear per-face slots so the baked material covers every face.
  const mesh = part.mesh!;
  const flattened = makePolyMesh(mesh.vertices, meshFaces(mesh), { faceUVs: mesh.faceUVs, sharpEdges: mesh.sharpEdges });
  const modifiers = options.normal
    ? part.modifiers?.map((modifier) => (modifier.type === 'subdivision' ? { ...modifier, enabled: false } : modifier))
    : part.modifiers;
  get().updateModelPart(specId, partId, { mesh: flattened, materialId, modifiers });

  const coverage = Math.round(result.coverage * 100);
  return {
    ok: true,
    materialId,
    assetIds: added.map((asset) => asset.id),
    message: `Baked ${maps.join(' + ')} at ${result.width}px (${coverage}% UV coverage) into material "${part.name} (baked)".${
      options.normal && part.modifiers?.some((modifier) => modifier.type === 'subdivision')
        ? ' Subdivision is now off — its detail lives in the normal map (game-ready low poly).'
        : ''
    }`,
  };
}
