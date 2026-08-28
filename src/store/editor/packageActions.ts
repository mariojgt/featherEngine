import type { StoreApi } from 'zustand';
import type { EditorState } from '../editorStore';
import type { AssetItem, NodeForgeProject } from '../../types';
import { PREFAB_EDIT_SCENE_ID, PROJECT_VERSION } from '../../types';
import {
  collectPackage,
  collectPrefabPackage,
  collectProjectPackage,
  type PackageContent,
  type PackageSeeds,
  type PackageSource,
} from '../../project/package';
import { invalidateFeatherSourceForGraphs } from '../editorStore';
import { makeId } from './ids';
import { getAssetType } from './objectFactory';

type SetState = StoreApi<EditorState>['setState'];
type GetState = StoreApi<EditorState>['getState'];

export const applyAddAssets = (set: SetState, files: FileList | File[]): void => {
  set((state) => ({
    assets: [
      ...state.assets,
      ...Array.from(files).map((file) => ({
        id: makeId('asset'),
        name: file.name,
        type: getAssetType(file.name),
        size: file.size,
        url: URL.createObjectURL(file),
        createdAt: Date.now(),
      })),
    ],
    isDirty: true,
  }));
};

export const applyAddAssetItems = (set: SetState, items: AssetItem[]): void => {
  set((state) => ({ assets: [...state.assets, ...items], isDirty: true }));
};

export const applySetAssetSearch = (set: SetState, assetSearch: string): void => {
  set({ assetSearch });
};

export const applyRemoveAsset = (set: SetState, id: string): void => {
  set((state) => {
    const asset = state.assets.find((item) => item.id === id);
    const affectedGraphIds = new Set(
      state.graphs
        .filter((graph) => graph.nodes.some((node) => node.data.assetId === id))
        .map((graph) => graph.id),
    );
    // Only blob: URLs need revoking; data:/asset:/empty are no-ops but harmless.
    if (asset?.url?.startsWith('blob:')) URL.revokeObjectURL(asset.url);
    return {
      blueprints: invalidateFeatherSourceForGraphs(state.blueprints, affectedGraphIds),
      assets: state.assets.filter((item) => item.id !== id),
      // Clear any dangling references so the engine never points at a removed asset.
      scenes: state.scenes.map((scene) => ({
        ...scene,
        objects: scene.objects.map((object) => {
          const renderer = object.renderer;
          if (!renderer || (renderer.modelAssetId !== id && renderer.textureAssetId !== id)) return object;
          return {
            ...object,
            renderer: {
              ...renderer,
              modelAssetId: renderer.modelAssetId === id ? undefined : renderer.modelAssetId,
              textureAssetId: renderer.textureAssetId === id ? undefined : renderer.textureAssetId,
            },
          };
        }),
      })),
      // Materials may reference this asset as a base-color or normal map.
      materials: state.materials.map((material) =>
        material.textureAssetId === id || material.normalMapAssetId === id
          ? {
              ...material,
              textureAssetId: material.textureAssetId === id ? undefined : material.textureAssetId,
              normalMapAssetId: material.normalMapAssetId === id ? undefined : material.normalMapAssetId,
            }
          : material,
      ),
      graphs: state.graphs.map((graph) => ({
        ...graph,
        nodes: graph.nodes.map((node) =>
          node.data.assetId === id ? { ...node, data: { ...node.data, assetId: undefined } } : node,
        ),
      })),
      isDirty: true,
    };
  });
};

export const applyExportProject = (set: SetState, get: GetState): NodeForgeProject => {
  const state = get();
  return {
    version: PROJECT_VERSION,
    name: 'Untitled Project',
    savedAt: new Date().toISOString(),
    // Exclude the transient prefab-editing scene; fall back active id to a real scene if needed.
    activeSceneId:
      state.activeSceneId === PREFAB_EDIT_SCENE_ID
        ? state.prefabReturnSceneId ??
          state.scenes.find((scene) => scene.id !== PREFAB_EDIT_SCENE_ID)?.id ??
          state.activeSceneId
        : state.activeSceneId,
    exportSettings: state.exportSettings,
    scenes: state.scenes.filter((scene) => scene.id !== PREFAB_EDIT_SCENE_ID),
    assets: state.assets.map(({ url: _url, ...asset }) => asset),
    folders: state.folders,
    variables: state.variables,
    dataAssets: state.dataAssets,
    materials: state.materials ?? [],
    skeletons: state.skeletons ?? [],
    skeletalMeshes: state.skeletalMeshes ?? [],
    animations: state.animations ?? [],
    animatorControllers: state.animatorControllers ?? [],
    uiDocuments: state.uiDocuments ?? [],
    particleSystems: state.particleSystems ?? [],
    blueprints: state.blueprints,
    // React Flow's selection/drag markers are editor-session state, not project content. Leaving
    // them in a save made projects reopen with arbitrary cards/wires highlighted.
    graphs: state.graphs.map((graph) => ({
      ...graph,
      nodes: graph.nodes.map((node) => {
        const clean = { ...node };
        delete clean.selected;
        delete clean.dragging;
        return clean;
      }),
      edges: graph.edges.map((edge) => {
        const clean = { ...edge };
        delete clean.selected;
        return clean;
      }),
    })),
    prefabs: state.prefabs ?? [],
    treeSpecs: state.treeSpecs ?? [],
    modelSpecs: state.modelSpecs ?? [],
    renderSettings: state.renderSettings,
  };
};

export const applyMarkClean = (set: SetState): void => {
  set({ isDirty: false });
};

export const applyBuildPrefabPackage = (set: SetState, get: GetState, prefabId: string): { content: PackageContent; assetIds: string[] } | null => {
  const state = get();
  const src: PackageSource = {
    prefabs: state.prefabs,
    blueprints: state.blueprints,
    graphs: state.graphs,
    materials: state.materials,
    particleSystems: state.particleSystems,
    skeletons: state.skeletons,
    skeletalMeshes: state.skeletalMeshes,
    animations: state.animations,
    animatorControllers: state.animatorControllers,
    dataAssets: state.dataAssets,
    uiDocuments: state.uiDocuments,
    variables: state.variables,
    folders: state.folders,
    assets: state.assets,
  };
  return collectPrefabPackage(src, prefabId);
};

export const applyBuildFolderPackage = (set: SetState, get: GetState, folderId: string): { content: PackageContent; assetIds: string[]; name: string } | null => {
  const state = get();
  const folder = state.folders.find((f) => f.id === folderId);
  if (!folder) return null;
  // The folder + every folder nested under it (an asset's folderId points at exactly one of these).
  const folderIds = new Set<string>([folderId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of state.folders) {
      if (f.parentId && folderIds.has(f.parentId) && !folderIds.has(f.id)) {
        folderIds.add(f.id);
        grew = true;
      }
    }
  }
  const inFolder = <T extends { id: string; folderId?: string }>(arr: T[]) =>
    arr.filter((item) => item.folderId && folderIds.has(item.folderId)).map((item) => item.id);
  const seeds: PackageSeeds = {
    prefabs: inFolder(state.prefabs),
    blueprints: inFolder(state.blueprints),
    materials: inFolder(state.materials),
    particleSystems: inFolder(state.particleSystems),
    animatorControllers: inFolder(state.animatorControllers),
    dataAssets: inFolder(state.dataAssets),
    uiDocuments: inFolder(state.uiDocuments),
    assets: inFolder(state.assets),
  };
  if (!Object.values(seeds).some((list) => list && list.length)) return null;
  const src: PackageSource = {
    prefabs: state.prefabs,
    blueprints: state.blueprints,
    graphs: state.graphs,
    materials: state.materials,
    particleSystems: state.particleSystems,
    skeletons: state.skeletons,
    skeletalMeshes: state.skeletalMeshes,
    animations: state.animations,
    animatorControllers: state.animatorControllers,
    dataAssets: state.dataAssets,
    uiDocuments: state.uiDocuments,
    variables: state.variables,
    folders: state.folders,
    assets: state.assets,
  };
  return { ...collectPackage(src, seeds), name: folder.name };
};

export const applyBuildProjectPackage = (set: SetState, get: GetState): { content: PackageContent; assetIds: string[] } => {
  const state = get();
  const src: PackageSource = {
    // Never ship the transient prefab-editing scene — it isn't part of the project.
    scenes: state.scenes.filter((scene) => scene.id !== PREFAB_EDIT_SCENE_ID),
    prefabs: state.prefabs,
    blueprints: state.blueprints,
    graphs: state.graphs,
    materials: state.materials,
    particleSystems: state.particleSystems,
    skeletons: state.skeletons,
    skeletalMeshes: state.skeletalMeshes,
    animations: state.animations,
    animatorControllers: state.animatorControllers,
    dataAssets: state.dataAssets,
    uiDocuments: state.uiDocuments,
    variables: state.variables,
    folders: state.folders,
    assets: state.assets,
  };
  return collectProjectPackage(src);
};

export const applyMergeProjectPackage = (set: SetState, content: PackageContent, assets: AssetItem[]): void => {
  set((state) => {
    const scenes = content.scenes ?? [];
    return {
      assets: [...state.assets, ...assets],
      prefabs: [...state.prefabs, ...content.prefabs],
      blueprints: [...state.blueprints, ...content.blueprints],
      graphs: [...state.graphs, ...content.graphs],
      materials: [...state.materials, ...content.materials],
      particleSystems: [...state.particleSystems, ...content.particleSystems],
      skeletons: [...state.skeletons, ...content.skeletons],
      skeletalMeshes: [...state.skeletalMeshes, ...content.skeletalMeshes],
      animations: [...state.animations, ...content.animations],
      animatorControllers: [...state.animatorControllers, ...content.animatorControllers],
      dataAssets: [...state.dataAssets, ...content.dataAssets],
      uiDocuments: [...state.uiDocuments, ...content.uiDocuments],
      variables: [...state.variables, ...content.variables],
      folders: [...state.folders, ...(content.folders ?? [])],
      prefabThumbnailQueue: [...state.prefabThumbnailQueue, ...content.prefabs.map((p) => p.id)],
      // The package's world replaces the blank starter scene rather than sitting beside it.
      ...(scenes.length
        ? {
            scenes,
            activeSceneId: scenes[0].id,
            selectedIds: [],
            exportSettings: {
              ...state.exportSettings,
              profiles: state.exportSettings.profiles.map((profile) => ({
                ...profile,
                startSceneId: scenes[0].id,
              })),
            },
          }
        : {}),
      isDirty: true,
    };
  });
};

export const applyMergePackage = (set: SetState, content: PackageContent, assets: AssetItem[]): void => {
  set((state) => ({
    // Everything was re-id'd on import, so a plain append can't collide with existing content.
    assets: [...state.assets, ...assets],
    prefabs: [...state.prefabs, ...content.prefabs],
    blueprints: [...state.blueprints, ...content.blueprints],
    graphs: [...state.graphs, ...content.graphs],
    materials: [...state.materials, ...content.materials],
    particleSystems: [...state.particleSystems, ...content.particleSystems],
    skeletons: [...state.skeletons, ...content.skeletons],
    skeletalMeshes: [...state.skeletalMeshes, ...content.skeletalMeshes],
    animations: [...state.animations, ...content.animations],
    animatorControllers: [...state.animatorControllers, ...content.animatorControllers],
    dataAssets: [...state.dataAssets, ...content.dataAssets],
    uiDocuments: [...state.uiDocuments, ...content.uiDocuments],
    variables: [...state.variables, ...content.variables],
    // The package's own folder (and its internal tree) so the content lands organised, not loose.
    folders: [...state.folders, ...(content.folders ?? [])],
    prefabThumbnailQueue: [...state.prefabThumbnailQueue, ...content.prefabs.map((p) => p.id)],
    isDirty: true,
  }));
};