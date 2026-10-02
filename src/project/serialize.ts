import {
  PREFAB_EDIT_SCENE_ID,
  PROJECT_VERSION,
  type NodeForgeProject,
  type ProjectManifest,
  type Scene,
} from '../types';
import { defaultSceneEnvironment } from '../three/environmentSettings';
import { defaultRenderSettings } from '../store/editor/defaults';
import { DEFAULT_RENDER_PRESET, renderPresetEnvironmentPatch, renderPresetRenderPatch } from '../three/presets';
import { defaultTreeLibrary } from '../tree/treeSpec';
import { defaultModelLibrary } from '../model/modelSpec';
import { createDefaultExportSettings, parseExportSettings } from './exportProfiles';
import { assertProjectContainers, assertSupportedProjectVersion } from './projectValidation';

export const SCENES_DIR = 'scenes';
export const ASSETS_DIR = 'assets';

export const sceneFile = (sceneId: string) => `${SCENES_DIR}/${sceneId}.scene.json`;

/** Split a full project into the manifest (project.json) + one file per scene. */
export function splitProject(project: NodeForgeProject): {
  manifest: ProjectManifest;
  sceneFiles: { path: string; scene: Scene }[];
} {
  assertSupportedProjectVersion(project);
  assertProjectContainers(project as unknown as Record<string, unknown>);
  // The prefab-editing scene is transient — never persist it. If it happens to be active (the user
  // saved mid-edit), fall back the active id to the first real scene so reloads stay valid.
  const realScenes = project.scenes.filter((scene) => scene.id !== PREFAB_EDIT_SCENE_ID);
  const activeSceneId = realScenes.some((scene) => scene.id === project.activeSceneId)
    ? project.activeSceneId
    : realScenes[0]?.id ?? project.activeSceneId;
  const manifest: ProjectManifest = {
    version: PROJECT_VERSION,
    name: project.name,
    savedAt: new Date().toISOString(),
    activeSceneId,
    exportSettings: parseExportSettings(
      project.exportSettings,
      project.name,
      realScenes.map((scene) => scene.id),
      project.activeSceneId,
    ),
    scenes: realScenes.map((scene) => ({ id: scene.id, name: scene.name, file: sceneFile(scene.id) })),
    // Never persist runtime-only / bundle-only fields (url, unresolved, embedded data).
    // Imported disk assets keep their external path. Authored procedural assets have no backing
    // file, so their embedded bytes are the source of truth and must survive a desktop save.
    assets: project.assets.map(({ url: _url, unresolved: _unresolved, data, ...asset }) =>
      !asset.path && data ? { ...asset, data } : asset),
    folders: project.folders,
    variables: project.variables,
    dataAssets: project.dataAssets,
    materials: project.materials,
    particleSystems: project.particleSystems,
    skeletons: project.skeletons,
    skeletalMeshes: project.skeletalMeshes,
    animations: project.animations,
    animatorControllers: project.animatorControllers,
    uiDocuments: project.uiDocuments,
    blueprints: project.blueprints,
    graphs: project.graphs,
    prefabs: project.prefabs,
    treeSpecs: project.treeSpecs,
    modelSpecs: project.modelSpecs ?? [],
    renderSettings: project.renderSettings,
  };
  const sceneFiles = realScenes.map((scene) => ({ path: sceneFile(scene.id), scene }));
  return { manifest, sceneFiles };
}

/** Reassemble a full project from a manifest + the loaded scene files. */
export function joinProject(manifest: ProjectManifest, scenes: Scene[]): NodeForgeProject {
  assertSupportedProjectVersion(manifest);
  assertProjectContainers({ ...manifest, scenes });
  return {
    version: manifest.version,
    name: manifest.name,
    savedAt: manifest.savedAt,
    activeSceneId: manifest.activeSceneId,
    exportSettings: parseExportSettings(
      manifest.exportSettings,
      manifest.name,
      scenes.map((scene) => scene.id),
      manifest.activeSceneId,
    ),
    scenes,
    assets: manifest.assets,
    folders: manifest.folders ?? [],
    variables: manifest.variables ?? [],
    dataAssets: manifest.dataAssets ?? ((manifest as unknown as { dataTables?: NodeForgeProject['dataAssets'] }).dataTables ?? []),
    materials: manifest.materials ?? [],
    particleSystems: manifest.particleSystems ?? [],
    skeletons: manifest.skeletons ?? [],
    skeletalMeshes: manifest.skeletalMeshes ?? [],
    animations: manifest.animations ?? [],
    animatorControllers: manifest.animatorControllers ?? [],
    uiDocuments: manifest.uiDocuments ?? [],
    blueprints: manifest.blueprints,
    graphs: manifest.graphs,
    prefabs: manifest.prefabs ?? [],
    treeSpecs: manifest.treeSpecs ?? [],
    modelSpecs: manifest.modelSpecs ?? [],
    renderSettings: manifest.renderSettings,
  };
}

/** Normalize/migrate any loaded JSON (new single-file export or legacy v0.1.0) to the canonical shape. */
export function migrateLoaded(raw: unknown): NodeForgeProject {
  assertSupportedProjectVersion(raw);
  const data = raw as Record<string, unknown>;
  assertProjectContainers(data);

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
      exportSettings: parseExportSettings(
        data.exportSettings,
        (data.name as string) ?? 'Imported Project',
        scenes.map((scene) => scene.id),
        activeSceneId,
      ),
      scenes: scenes.length ? scenes : [{ id: 'scene-main', name: 'Main', objects: [] }],
      assets: ((data.assets as NodeForgeProject['assets']) ?? []).map((asset) => ({ ...asset, url: undefined })),
      folders: (data.folders as NodeForgeProject['folders']) ?? [],
      variables: (data.variables as NodeForgeProject['variables']) ?? [],
      dataAssets:
        (data.dataAssets as NodeForgeProject['dataAssets']) ??
        ((data.dataTables as NodeForgeProject['dataAssets']) ?? []),
      materials: (data.materials as NodeForgeProject['materials']) ?? [],
      particleSystems: (data.particleSystems as NodeForgeProject['particleSystems']) ?? [],
      skeletons: (data.skeletons as NodeForgeProject['skeletons']) ?? [],
      skeletalMeshes: (data.skeletalMeshes as NodeForgeProject['skeletalMeshes']) ?? [],
      animations: (data.animations as NodeForgeProject['animations']) ?? [],
      animatorControllers: (data.animatorControllers as NodeForgeProject['animatorControllers']) ?? [],
      uiDocuments: (data.uiDocuments as NodeForgeProject['uiDocuments']) ?? [],
      blueprints: (data.blueprints as NodeForgeProject['blueprints']) ?? [],
      graphs: (data.graphs as NodeForgeProject['graphs']) ?? [],
      prefabs: (data.prefabs as NodeForgeProject['prefabs']) ?? [],
      treeSpecs: (data.treeSpecs as NodeForgeProject['treeSpecs']) ?? [],
      modelSpecs: (data.modelSpecs as NodeForgeProject['modelSpecs']) ?? [],
      renderSettings: data.renderSettings as NodeForgeProject['renderSettings'],
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
      exportSettings: parseExportSettings(
        data.exportSettings,
        (data.name as string) ?? 'Imported Project',
        [sceneId],
        sceneId,
      ),
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
      particleSystems: (data.particleSystems as NodeForgeProject['particleSystems']) ?? [],
      skeletons: (data.skeletons as NodeForgeProject['skeletons']) ?? [],
      skeletalMeshes: (data.skeletalMeshes as NodeForgeProject['skeletalMeshes']) ?? [],
      animations: (data.animations as NodeForgeProject['animations']) ?? [],
      animatorControllers: (data.animatorControllers as NodeForgeProject['animatorControllers']) ?? [],
      uiDocuments: (data.uiDocuments as NodeForgeProject['uiDocuments']) ?? [],
      blueprints: (data.blueprints as NodeForgeProject['blueprints']) ?? [],
      graphs: (data.graphs as NodeForgeProject['graphs']) ?? [],
      prefabs: (data.prefabs as NodeForgeProject['prefabs']) ?? [],
      treeSpecs: (data.treeSpecs as NodeForgeProject['treeSpecs']) ?? [],
      modelSpecs: (data.modelSpecs as NodeForgeProject['modelSpecs']) ?? [],
      renderSettings: data.renderSettings as NodeForgeProject['renderSettings'],
    };
  }

  throw new Error('Unrecognized project file format.');
}

/** A fresh, minimal project for "New Project". */
export function blankProject(name: string): NodeForgeProject {
  const sceneId = 'scene-main';
  // New projects open on the signature Spline Studio look (soft, glossy interactive 3D). The look layer is
  // stamped explicitly HERE so it only affects new work — the default*() factories stay ACES/flat so that
  // loading a legacy project (which predates these fields) is never silently re-graded on open.
  // The preset also supplies its curated graphite stage, soft key light and contact grounding. Templates
  // and saved projects carry their own environment and remain untouched.
  const environment = {
    ...defaultSceneEnvironment(),
    ...renderPresetEnvironmentPatch(DEFAULT_RENDER_PRESET),
  };
  const renderSettings = { ...defaultRenderSettings(), ...renderPresetRenderPatch(DEFAULT_RENDER_PRESET) };
  return {
    version: PROJECT_VERSION,
    name,
    activeSceneId: sceneId,
    exportSettings: createDefaultExportSettings(name, sceneId),
    scenes: [{ id: sceneId, name: 'Main', objects: [], environment }],
    renderSettings,
    assets: [],
    folders: [],
    variables: [],
    dataAssets: [],
    materials: [],
    particleSystems: [],
    skeletons: [],
    skeletalMeshes: [],
    animations: [],
    animatorControllers: [],
    uiDocuments: [],
    blueprints: [],
    graphs: [],
    prefabs: [],
    treeSpecs: defaultTreeLibrary(),
    modelSpecs: defaultModelLibrary(),
  };
}
