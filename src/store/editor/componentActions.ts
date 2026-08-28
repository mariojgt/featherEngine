import type { StoreApi } from 'zustand';
import type { EditorState } from '../editorStore';
import type {
  RagdollBodyDef,
  RagdollSettings,
  RenderSettings,
  SceneStreamingSettings,
  SkeletonSocket,
  VehicleComponent,
} from '../../types';
import { defaultRagdollSettings, defaultVehicle } from './defaults';
import { makeId, stripUndefined } from './ids';
import { mapActiveSceneObjects, selectActiveObjects } from './storeHelpers';
import { findBehaviorPreset } from '../../project/behaviors';
import {
  applyRegisterImportedModel as applyRegisterImportedModelCore,
  type RegisterImportedModelInput,
} from './registerImportedModel';
import {
  createCollectibleCounterFor,
  type CreateCollectibleCounterOptions,
  type CreateCollectibleCounterResult,
} from './createCollectibleCounter';

type SetState = StoreApi<EditorState>['setState'];
type GetState = StoreApi<EditorState>['getState'];

export const applyRegisterImportedModel = (
  set: SetState,
  get: GetState,
  input: RegisterImportedModelInput,
): { skeletalMeshId?: string; materialsAdded: number; animationsAdded: number } => {
  const result = applyRegisterImportedModelCore(get(), input);
  set(result.next);
  return { skeletalMeshId: result.skeletalMeshId, materialsAdded: result.materialsAdded, animationsAdded: result.animationsAdded };
};

export const applySetVehicleEnabled = (set: SetState, id: string, enabled?: boolean): void => {
  set((state) =>
    mapActiveSceneObjects(state, (objects) =>
      objects.map((object) => {
        if (object.id !== id) return object;
        const current = object.vehicle ?? defaultVehicle();
        return { ...object, vehicle: { ...current, enabled: enabled ?? !current.enabled } };
      }),
    ),
  );
};

export const applyUpdateVehicle = (set: SetState, id: string, patch: Partial<VehicleComponent>): void => {
  set((state) =>
    mapActiveSceneObjects(state, (objects) =>
      objects.map((object) =>
        object.id === id ? { ...object, vehicle: { ...defaultVehicle(), ...object.vehicle, ...patch } } : object,
      ),
    ),
  );
};

export const applyUpdateRenderSettings = (set: SetState, patch: Partial<RenderSettings>): void => {
  set((state) => ({ renderSettings: { ...state.renderSettings, ...stripUndefined(patch) }, isDirty: true }));
};

export const applyAddSkeletonSocket = (set: SetState, get: GetState, skeletonId: string, socket: { name?: string; boneName: string }): string | undefined => {
  const skeleton = get().skeletons.find((item) => item.id === skeletonId);
  if (!skeleton) return undefined;
  const id = makeId('socket');
  set((state) => ({
    skeletons: state.skeletons.map((item) =>
      item.id === skeletonId
        ? {
            ...item,
            sockets: [
              ...(item.sockets ?? []),
              { id, name: socket.name ?? `Socket ${(item.sockets?.length ?? 0) + 1}`, boneName: socket.boneName, position: [0, 0, 0], rotation: [0, 0, 0] },
            ],
          }
        : item,
    ),
    isDirty: true,
  }));
  return id;
};

export const applyUpdateSkeletonSocket = (set: SetState, skeletonId: string, socketId: string, patch: Partial<Omit<SkeletonSocket, 'id'>>): void => {
  set((state) => ({
    skeletons: state.skeletons.map((item) =>
      item.id === skeletonId
        ? { ...item, sockets: (item.sockets ?? []).map((s) => (s.id === socketId ? { ...s, ...patch } : s)) }
        : item,
    ),
    isDirty: true,
  }));
};

export const applyRemoveSkeletonSocket = (set: SetState, skeletonId: string, socketId: string): void => {
  set((state) => ({
    skeletons: state.skeletons.map((item) =>
      item.id === skeletonId ? { ...item, sockets: (item.sockets ?? []).filter((s) => s.id !== socketId) } : item,
    ),
    isDirty: true,
  }));
};

export const applyUpdateSkeletonRagdoll = (set: SetState, skeletonId: string, patch: Partial<RagdollSettings>): void => {
  set((state) => ({
    skeletons: state.skeletons.map((item) =>
      item.id === skeletonId ? { ...item, ragdoll: { ...defaultRagdollSettings(), ...item.ragdoll, ...patch } } : item,
    ),
    isDirty: true,
  }));
};

export const applySetRagdollBody = (set: SetState, skeletonId: string, boneName: string, patch: Partial<Omit<RagdollBodyDef, 'boneName'>>): void => {
  set((state) => ({
    skeletons: state.skeletons.map((item) => {
      if (item.id !== skeletonId) return item;
      if (!item.boneNames.includes(boneName)) return item;
      const base = { ...defaultRagdollSettings(), ...item.ragdoll };
      const bodies = base.bodies ?? [];
      const existing = bodies.find((b) => b.boneName === boneName);
      const nextBodies = existing
        ? bodies.map((b) => (b.boneName === boneName ? { ...b, ...patch } : b))
        : [...bodies, { boneName, ...patch }];
      return { ...item, ragdoll: { ...base, bodies: nextBodies } };
    }),
    isDirty: true,
  }));
};

export const applyRemoveRagdollBody = (set: SetState, skeletonId: string, boneName: string): void => {
  set((state) => ({
    skeletons: state.skeletons.map((item) => {
      if (item.id !== skeletonId || !item.ragdoll) return item;
      return { ...item, ragdoll: { ...item.ragdoll, bodies: (item.ragdoll.bodies ?? []).filter((b) => b.boneName !== boneName) } };
    }),
    isDirty: true,
  }));
};

export const applyGenerateRagdollBodies = (set: SetState, skeletonId: string): void => {
  set((state) => ({
    skeletons: state.skeletons.map((item) => {
      if (item.id !== skeletonId) return item;
      const base = { ...defaultRagdollSettings(), ...item.ragdoll };
      let exclude: RegExp;
      try {
        exclude = new RegExp(base.excludePattern, 'i');
      } catch {
        exclude = new RegExp(defaultRagdollSettings().excludePattern, 'i');
      }
      // One default capsule body per non-excluded bone — a starting point the user/AI can tweak.
      const bodies = item.boneNames
        .filter((name) => !exclude.test(name))
        .map((boneName) => ({ boneName, enabled: true, shape: 'capsule' as const }));
      return { ...item, ragdoll: { ...base, bodies } };
    }),
    isDirty: true,
  }));
};

export const applyCreateCollectibleCounter = (set: SetState, get: GetState, options: CreateCollectibleCounterOptions = {}): CreateCollectibleCounterResult => {
  return createCollectibleCounterFor(get, options);
};

export const applyUpdateSceneStreaming = (set: SetState, patch: Partial<SceneStreamingSettings>): void => {
  set((state) => ({
    scenes: state.scenes.map((scene) =>
      scene.id === state.activeSceneId
        ? { ...scene, streaming: { enabled: false, radius: 120, ...scene.streaming, ...patch } }
        : scene,
    ),
    isDirty: true,
  }));
};

export const applyAttachBehaviorPreset = (set: SetState, get: GetState, objectId: string, presetId: string): string | undefined => {
  const preset = findBehaviorPreset(presetId);
  if (!preset) return undefined;
  const state = get();
  const object = selectActiveObjects(state).find((item) => item.id === objectId);
  if (!object) return undefined;

  for (const wanted of preset.ensureProjectVariables ?? []) {
    if (!state.variables.some((variable) => variable.name === wanted.name)) {
      const variableId = get().createVariable(wanted.name, wanted.type, true);
      if (wanted.defaultValue !== undefined) get().updateVariable(variableId, { defaultValue: wanted.defaultValue });
    }
  }

  // Behaviors are shared classes: reuse the blueprint if this preset was attached before, so all
  // instances run ONE editable blueprint while `var` state stays per-object.
  const displayName = preset.script.match(/^blueprint\s+(\S+)/)?.[1].replace(/_/g, ' ') ?? preset.name;
  let blueprintId = get().blueprints.find((blueprint) => blueprint.name === displayName)?.id;
  if (!blueprintId) {
    blueprintId = get().createBlueprintNamed(displayName, preset.description).blueprintId;
    const compiled = get().applyBlueprintFeatherSource(blueprintId, preset.script);
    if (!compiled.ok) {
      get().deleteBlueprint(blueprintId);
      return undefined;
    }
  }

  if (preset.physics) {
    if (!object.physics) get().togglePhysics(objectId); // seeds a default enabled component
    get().updatePhysics(objectId, { enabled: true, bodyType: 'fixed', isTrigger: preset.physics === 'trigger' });
  }
  get().attachScript(objectId, blueprintId);
  return blueprintId;
};