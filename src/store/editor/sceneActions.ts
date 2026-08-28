import type { StoreApi } from 'zustand';
import type { EditorState } from '../editorStore';
import type {
  ExportProfile,
  NodeForgeNode,
  ProjectGraph,
  Scene,
  SceneEnvironmentSettings,
  SceneObject,
  ScriptBlueprint,
} from '../../types';
import { defaultSceneEnvironment, withSceneEnvironmentDefaults } from '../../three/environmentSettings';
import { wrapDayCycleTime } from '../../three/dayCycle';
import { retargetDeletedScene } from '../../project/exportProfiles';
import { setSaveNamespace } from './objectFactory';
import { makeId, stripUndefined } from './ids';
import { effectiveSelection, selectActiveObjects } from './storeHelpers';

type SetState = StoreApi<EditorState>['setState'];
type GetState = StoreApi<EditorState>['getState'];

export const applyActiveScene = (get: GetState): Scene | undefined =>
  get().scenes.find((scene) => scene.id === get().activeSceneId);

export const applySelectedObject = (get: GetState): SceneObject | undefined =>
  selectActiveObjects(get()).find((object) => object.id === get().selectedObjectId);

export const applyCreateScene = (set: SetState, name?: string): string => {
  const id = makeId('scene');
  set((state) => ({
    scenes: [
      ...state.scenes,
      { id, name: name ?? `Scene ${state.scenes.length + 1}`, objects: [], cinematics: [], environment: defaultSceneEnvironment() },
    ],
    isDirty: true,
  }));
  return id;
};

export const applyRenameScene = (set: SetState, id: string, name: string): void => {
  set((state) => ({
    scenes: state.scenes.map((scene) => (scene.id === id ? { ...scene, name } : scene)),
    isDirty: true,
  }));
};

export const applySetSceneAudio = (set: SetState, id: string, patch: { ambientSoundId?: string; musicSoundId?: string }): void => {
  set((state) => ({
    scenes: state.scenes.map((scene) => (scene.id === id ? { ...scene, ...patch } : scene)),
    isDirty: true,
  }));
};

export const applyUpdateSceneEnvironment = (set: SetState, id: string, patch: Partial<SceneEnvironmentSettings>): void => {
  set((state) => ({
    scenes: state.scenes.map((scene) =>
      scene.id === id
        ? { ...scene, environment: { ...withSceneEnvironmentDefaults(scene.environment), ...stripUndefined(patch) } }
        : scene,
    ),
    ...(patch.dayCycleTime !== undefined && id === state.activeSceneId
      ? { runtimeDayCycleTime: wrapDayCycleTime(patch.dayCycleTime) }
      : {}),
    isDirty: true,
  }));
};

export const applyDeleteScene = (set: SetState, id: string): void => {
  set((state) => {
    if (state.isPlaying || state.scenes.length <= 1) return state;
    const remaining = state.scenes.filter((scene) => scene.id !== id);
    const activeSceneId = state.activeSceneId === id ? remaining[0].id : state.activeSceneId;
    const selectedObjectId =
      state.activeSceneId === id ? remaining[0].objects[0]?.id ?? '' : state.selectedObjectId;
    return {
      scenes: remaining,
      activeSceneId,
      selectedObjectId,
      exportSettings: retargetDeletedScene(state.exportSettings, id, remaining[0].id),
      isDirty: true,
    };
  });
};

export const applySetActiveScene = (set: SetState, id: string): void => {
  set((state) => {
    if (state.isPlaying || id === state.activeSceneId) return state;
    const scene = state.scenes.find((item) => item.id === id);
    if (!scene) return state;
    return { activeSceneId: id, selectedObjectId: scene.objects[0]?.id ?? '' };
  });
};

export const applyDuplicateScene = (set: SetState, id: string): string => {
  const newId = makeId('scene');
  set((state) => {
    const source = state.scenes.find((scene) => scene.id === id);
    if (!source) return state;
    const copy: Scene = { ...structuredClone(source), id: newId, name: `${source.name} Copy` };
    return { scenes: [...state.scenes, copy], isDirty: true };
  });
  return newId;
};

export const applyUpdateExportProfile = (set: SetState, get: GetState, profile: ExportProfile): void => {
  const settings = get().exportSettings;
  if (settings.activeProfileId === profile.id) {
    const previous = settings.profiles.find((candidate) => candidate.id === profile.id);
    setSaveNamespace(
      profile.application.identifier,
      previous && previous.application.identifier !== profile.application.identifier
        ? [previous.application.identifier]
        : undefined,
      true,
    );
  }
  set((state) => ({
    exportSettings: {
      ...state.exportSettings,
      profiles: state.exportSettings.profiles.map((candidate) =>
        candidate.id === profile.id ? structuredClone(profile) : candidate,
      ),
    },
    isDirty: true,
  }));
};

export const applySetActiveExportProfile = (set: SetState, get: GetState, id: string): void => {
  const profile = get().exportSettings.profiles.find((candidate) => candidate.id === id);
  if (!profile) return;
  setSaveNamespace(profile.application.identifier, []);
  set((state) => ({
    exportSettings: { ...state.exportSettings, activeProfileId: id },
    isDirty: true,
  }));
};

export const applyActiveBlueprint = (get: GetState): ScriptBlueprint | undefined =>
  get().blueprints.find((blueprint) => blueprint.id === get().activeBlueprintId);

export const applyActiveGraph = (get: GetState): ProjectGraph | undefined => {
  const activeBlueprint = applyActiveBlueprint(get);
  return get().graphs.find((graph) => graph.id === activeBlueprint?.graphId);
};

export const applySelectedGraphNode = (get: GetState): NodeForgeNode | undefined =>
  applyActiveGraph(get)?.nodes.find((node) => node.id === get().selectedGraphNodeId);

export const applySelectObject = (set: SetState, id: string): void => {
  set({ selectedObjectId: id, selectedObjectIds: [] });
};

export const applyToggleSelectObject = (set: SetState, id: string): void => {
  set((state) => {
    if (!id) return state;
    const current = effectiveSelection(state);
    const has = current.includes(id);
    const next = has ? current.filter((value) => value !== id) : [...current, id];
    return { selectedObjectIds: next, selectedObjectId: has ? next[next.length - 1] ?? '' : id };
  });
};

export const applySelectObjects = (set: SetState, ids: string[]): void => {
  const unique = [...new Set(ids.filter(Boolean))];
  set({ selectedObjectIds: unique, selectedObjectId: unique[unique.length - 1] ?? '' });
};

export const applySetCameraRigTarget = (set: SetState, id?: string): void => {
  set({ cameraRigTarget: id });
};
