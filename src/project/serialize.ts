import {
  PROJECT_VERSION,
  type NodeForgeProject,
  type ProjectManifest,
  type Scene,
} from '../types';

export const SCENES_DIR = 'scenes';
export const ASSETS_DIR = 'assets';

export const sceneFile = (sceneId: string) => `${SCENES_DIR}/${sceneId}.scene.json`;

/** Split a full project into the manifest (project.json) + one file per scene. */
export function splitProject(project: NodeForgeProject): {
  manifest: ProjectManifest;
  sceneFiles: { path: string; scene: Scene }[];
} {
  const manifest: ProjectManifest = {
    version: PROJECT_VERSION,
    name: project.name,
    savedAt: new Date().toISOString(),
    activeSceneId: project.activeSceneId,
    scenes: project.scenes.map((scene) => ({ id: scene.id, name: scene.name, file: sceneFile(scene.id) })),
    // Never persist runtime-only / bundle-only fields (url, unresolved, embedded data).
    assets: project.assets.map(({ url: _url, unresolved: _unresolved, data: _data, ...asset }) => asset),
    folders: project.folders,
    variables: project.variables,
    dataAssets: project.dataAssets,
    materials: project.materials,
    skeletons: project.skeletons,
    skeletalMeshes: project.skeletalMeshes,
    animations: project.animations,
    animatorControllers: project.animatorControllers,
    uiDocuments: project.uiDocuments,
    blueprints: project.blueprints,
    graphs: project.graphs,
  };
  const sceneFiles = project.scenes.map((scene) => ({ path: sceneFile(scene.id), scene }));
  return { manifest, sceneFiles };
}

/** Reassemble a full project from a manifest + the loaded scene files. */
export function joinProject(manifest: ProjectManifest, scenes: Scene[]): NodeForgeProject {
  return {
    version: manifest.version,
    name: manifest.name,
    savedAt: manifest.savedAt,
    activeSceneId: manifest.activeSceneId,
    scenes,
    assets: manifest.assets,
    folders: manifest.folders ?? [],
    variables: manifest.variables ?? [],
    dataAssets: manifest.dataAssets ?? ((manifest as unknown as { dataTables?: NodeForgeProject['dataAssets'] }).dataTables ?? []),
    materials: manifest.materials ?? [],
    skeletons: manifest.skeletons ?? [],
    skeletalMeshes: manifest.skeletalMeshes ?? [],
    animations: manifest.animations ?? [],
    animatorControllers: manifest.animatorControllers ?? [],
    uiDocuments: manifest.uiDocuments ?? [],
    blueprints: manifest.blueprints,
    graphs: manifest.graphs,
  };
}

/** Normalize/migrate any loaded JSON (new single-file export or legacy v0.1.0) to the canonical shape. */
export function migrateLoaded(raw: unknown): NodeForgeProject {
  const data = raw as Record<string, unknown>;

  // Current multi-scene format (single-file web export).
  if (data && Array.isArray(data.scenes)) {
    const scenes = data.scenes as Scene[];
    const activeSceneId =
      typeof data.activeSceneId === 'string' && scenes.some((s) => s.id === data.activeSceneId)
        ? (data.activeSceneId as string)
        : scenes[0]?.id ?? 'scene-main';
    return {
      version: PROJECT_VERSION,
      name: (data.name as string) ?? 'Imported Project',
      savedAt: data.savedAt as string | undefined,
      activeSceneId,
      scenes: scenes.length ? scenes : [{ id: 'scene-main', name: 'Main', objects: [] }],
      assets: ((data.assets as NodeForgeProject['assets']) ?? []).map((asset) => ({ ...asset, url: undefined })),
      folders: (data.folders as NodeForgeProject['folders']) ?? [],
      variables: (data.variables as NodeForgeProject['variables']) ?? [],
      dataAssets:
        (data.dataAssets as NodeForgeProject['dataAssets']) ??
        ((data.dataTables as NodeForgeProject['dataAssets']) ?? []),
      materials: (data.materials as NodeForgeProject['materials']) ?? [],
      skeletons: (data.skeletons as NodeForgeProject['skeletons']) ?? [],
      skeletalMeshes: (data.skeletalMeshes as NodeForgeProject['skeletalMeshes']) ?? [],
      animations: (data.animations as NodeForgeProject['animations']) ?? [],
      animatorControllers: (data.animatorControllers as NodeForgeProject['animatorControllers']) ?? [],
      uiDocuments: (data.uiDocuments as NodeForgeProject['uiDocuments']) ?? [],
      blueprints: (data.blueprints as NodeForgeProject['blueprints']) ?? [],
      graphs: (data.graphs as NodeForgeProject['graphs']) ?? [],
    };
  }

  // Legacy single-scene format: { scene: { objects } }.
  const legacyScene = data?.scene as { objects?: unknown } | undefined;
  if (legacyScene && Array.isArray(legacyScene.objects)) {
    const sceneId = 'scene-main';
    return {
      version: PROJECT_VERSION,
      name: (data.name as string) ?? 'Imported Project',
      activeSceneId: sceneId,
      scenes: [{ id: sceneId, name: 'Main', objects: legacyScene.objects as Scene['objects'] }],
      // Legacy assets had no bytes on disk — flag them unresolved.
      assets: ((data.assets as NodeForgeProject['assets']) ?? []).map((asset) => ({
        ...asset,
        url: undefined,
        unresolved: true,
      })),
      folders: [],
      variables: (data.variables as NodeForgeProject['variables']) ?? [],
      dataAssets:
        (data.dataAssets as NodeForgeProject['dataAssets']) ??
        ((data.dataTables as NodeForgeProject['dataAssets']) ?? []),
      materials: (data.materials as NodeForgeProject['materials']) ?? [],
      skeletons: (data.skeletons as NodeForgeProject['skeletons']) ?? [],
      skeletalMeshes: (data.skeletalMeshes as NodeForgeProject['skeletalMeshes']) ?? [],
      animations: (data.animations as NodeForgeProject['animations']) ?? [],
      animatorControllers: (data.animatorControllers as NodeForgeProject['animatorControllers']) ?? [],
      uiDocuments: (data.uiDocuments as NodeForgeProject['uiDocuments']) ?? [],
      blueprints: (data.blueprints as NodeForgeProject['blueprints']) ?? [],
      graphs: (data.graphs as NodeForgeProject['graphs']) ?? [],
    };
  }

  throw new Error('Unrecognized project file format.');
}

/** A fresh, minimal project for "New Project". */
export function blankProject(name: string): NodeForgeProject {
  const sceneId = 'scene-main';
  return {
    version: PROJECT_VERSION,
    name,
    activeSceneId: sceneId,
    scenes: [{ id: sceneId, name: 'Main', objects: [] }],
    assets: [],
    folders: [],
    variables: [],
    dataAssets: [],
    materials: [],
    skeletons: [],
    skeletalMeshes: [],
    animations: [],
    animatorControllers: [],
    uiDocuments: [],
    blueprints: [],
    graphs: [],
  };
}
