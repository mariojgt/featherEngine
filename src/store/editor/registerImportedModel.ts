import type { EditorState } from '../editorStore';
import type { AnimationAsset, MaterialDefinition, SkeletalMeshAsset } from '../../types';
import type { ModelInspection } from '../../three/inspectModel';
import { makeMaterialGraph } from './graph';
import { makeId } from './ids';

export interface RegisterImportedModelInput {
  assetId: string;
  assetName: string;
  folderId?: string;
  inspection: ModelInspection;
}

export interface RegisterImportedModelResult {
  next: Partial<EditorState> | EditorState;
  skeletalMeshId?: string;
  materialsAdded: number;
  animationsAdded: number;
}

/** Register an imported model asset (materials + optional skeleton/mesh/animations). */
export const applyRegisterImportedModel = (
  state: EditorState,
  input: RegisterImportedModelInput,
): RegisterImportedModelResult => {
  const { assetId, assetName, folderId, inspection } = input;
  const baseName = assetName.replace(/\.(glb|gltf|fbx)$/i, '');
  const now = Date.now();
  let materialsAdded = 0;
  let animationsAdded = 0;
  let skeletalMeshId: string | undefined;

      const importedMaterials: MaterialDefinition[] = inspection.materials.map((material, index) => ({
        id: makeId('material'),
        name: material.name ? `${baseName} / ${material.name}` : `${baseName} Material ${index + 1}`,
        description: [
          `Imported from ${assetName}.`,
          material.hasBaseColorMap || material.hasNormalMap
            ? 'The model keeps its embedded texture maps; this editable asset mirrors the material values available to the engine.'
            : 'Editable material values derived from the imported model.',
        ].join(' '),
        color: material.color,
        metalness: material.metalness,
        roughness: material.roughness,
        emissiveColor: material.emissiveColor,
        emissiveIntensity: material.emissiveIntensity,
        graphId: makeId('graph'),
        sourceAssetId: assetId,
        folderId,
        createdAt: now,
      }));
      materialsAdded = importedMaterials.length;
      const materialGraphs = importedMaterials.map((material) => makeMaterialGraph(material.graphId!, material.name));

      if (!inspection.skeleton) {
        return { next: {
          materials: [...state.materials, ...importedMaterials],
          graphs: [...state.graphs, ...materialGraphs],
          activeMaterialId: importedMaterials.at(-1)?.id ?? state.activeMaterialId,
          isDirty: state.isDirty || importedMaterials.length > 0,
        }, skeletalMeshId, materialsAdded, animationsAdded };
      }

      // Reuse a skeleton with the same signature, else create one. This is what lets a second
      // character on the same rig share all of the first's animations.
      let skeleton = state.skeletons.find((item) => item.signature === inspection.skeleton!.signature);
      const skeletons = [...state.skeletons];
      if (!skeleton) {
        skeleton = {
          id: makeId('skeleton'),
          name: `${baseName} Skeleton`,
          sourceAssetId: assetId,
          boneNames: inspection.skeleton!.boneNames,
          signature: inspection.skeleton!.signature,
          rootBone: inspection.skeleton!.rootBone,
          folderId,
          createdAt: now,
        };
        skeletons.push(skeleton);
      }

      const skeletalMesh: SkeletalMeshAsset = {
        id: makeId('skmesh'),
        name: baseName,
        sourceAssetId: assetId,
        skeletonId: skeleton.id,
        folderId,
        createdAt: now,
      };
      skeletalMeshId = skeletalMesh.id;

      // Add only clips not already present for this skeleton (dedupe by name).
      const existingNames = new Set(
        state.animations.filter((anim) => anim.skeletonId === skeleton!.id).map((anim) => anim.clipName),
      );
      const newAnimations: AnimationAsset[] = inspection.clips
        .filter((clip) => clip.name && !existingNames.has(clip.name))
        .map((clip) => ({
          id: makeId('anim'),
          name: clip.name,
          sourceAssetId: assetId,
          clipName: clip.name,
          skeletonId: skeleton!.id,
          duration: clip.duration,
          loop: /(_loop|idle)$/i.test(clip.name),
          folderId,
          createdAt: now,
        }));
      animationsAdded = newAnimations.length;

      return { next: {
        materials: [...state.materials, ...importedMaterials],
        graphs: [...state.graphs, ...materialGraphs],
        skeletons,
        skeletalMeshes: [...state.skeletalMeshes, skeletalMesh],
        animations: [...state.animations, ...newAnimations],
        activeMaterialId: importedMaterials.at(-1)?.id ?? state.activeMaterialId,
        isDirty: true,
      }, skeletalMeshId, materialsAdded, animationsAdded };
};