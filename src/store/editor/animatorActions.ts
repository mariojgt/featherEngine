import type { StoreApi } from 'zustand';
import type { EditorState } from '../editorStore';
import type {
  AnimatorComponent,
  AnimatorCondition,
  AnimatorController,
  AnimatorLayer,
  AnimatorParameter,
  AnimatorState,
  AnimatorTransition,
  CharacterControllerComponent,
  SceneObject,
} from '../../types';
import { mapActiveSceneObjects } from './storeHelpers';
import { defaultAnimator, defaultCharacter } from './defaults';
import { makeId } from './ids';

type SetState = StoreApi<EditorState>['setState'];
type GetState = StoreApi<EditorState>['getState'];

const DEFAULT_ANIMATOR = { enabled: false, speed: 1, loop: true };
const DEFAULT_CHARACTER = { enabled: false };

export const applyToggleAnimator = (set: SetState, id: string): void => {
  set((state) =>
    mapActiveSceneObjects(state, (objects) =>
      objects.map((object) => {
        if (object.id !== id) return object;
        const current = object.animator ?? DEFAULT_ANIMATOR;
        return { ...object, animator: { ...current, enabled: !current.enabled } };
      }),
    ),
  );
};

export const applyUpdateAnimator = (set: SetState, id: string, patch: Partial<AnimatorComponent>): void => {
  set((state) =>
    mapActiveSceneObjects(state, (objects) =>
      objects.map((object) =>
        object.id === id && object.animator ? { ...object, animator: { ...object.animator, ...patch } } : object,
      ),
    ),
  );
};

export const applySetRuntimeAnimatorParam = (
  set: SetState,
  objectId: string,
  paramId: string,
  value: number | boolean,
): void => {
  set((state) => {
    const live = state.runtimeAnimators[objectId];
    if (!live) {
      const object = state.scenes
        .find((scene) => scene.id === state.activeSceneId)
        ?.objects.find((item) => item.id === objectId);
      const controller = state.animatorControllers.find((item) => item.id === object?.animator?.controllerId);
      const stateId = controller?.defaultStateId ?? controller?.states[0]?.id;
      if (!controller || !stateId) return state;
      const params = Object.fromEntries(controller.parameters.map((param) => [param.id, param.defaultValue])) as Record<
        string,
        number | boolean
      >;
      if (!(paramId in params)) return state;
      return {
        runtimeAnimators: {
          ...state.runtimeAnimators,
          [objectId]: { stateId, params: { ...params, [paramId]: value }, fade: 0, time: 0 },
        },
      };
    }
    return { runtimeAnimators: { ...state.runtimeAnimators, [objectId]: { ...live, params: { ...live.params, [paramId]: value } } } };
  });
};

export const applyCreateAnimatorController = (
  set: SetState,
  name: string | undefined,
  skeletonId: string | undefined,
  folderId: string | undefined,
): string => {
  const id = makeId('animctl');
  set((state) => ({
    animatorControllers: [
      ...state.animatorControllers,
      {
        id,
        name: name ?? `Animator ${state.animatorControllers.length + 1}`,
        skeletonId,
        parameters: [],
        states: [],
        defaultStateId: undefined,
        transitions: [],
        folderId,
        createdAt: Date.now(),
      },
    ],
    activeAnimatorControllerId: id,
    isDirty: true,
  }));
  return id;
};

export const applyUpdateAnimatorController = (
  set: SetState,
  id: string,
  patch: Partial<Pick<AnimatorController, 'name' | 'defaultStateId' | 'skeletonId'>>,
): void => {
  set((state) => ({
    animatorControllers: state.animatorControllers.map((controller) =>
      controller.id === id ? { ...controller, ...patch } : controller,
    ),
    isDirty: true,
  }));
};

export const applyDeleteAnimatorController = (set: SetState, id: string): void => {
  set((state) => ({
    animatorControllers: state.animatorControllers.filter((controller) => controller.id !== id),
    activeAnimatorControllerId:
      state.activeAnimatorControllerId === id
        ? state.animatorControllers.find((controller) => controller.id !== id)?.id ?? ''
        : state.activeAnimatorControllerId,
    isDirty: true,
  }));
};

export const applySetActiveAnimatorController = (set: SetState, id: string): void => {
  set({ activeAnimatorControllerId: id });
};

export const applySetObjectAnimatorController = (set: SetState, objectId: string, controllerId?: string): void => {
  set((state) =>
    mapActiveSceneObjects(state, (objects) =>
      objects.map((object) => {
        if (object.id !== objectId) return object;
        const animator = object.animator ?? defaultAnimator();
        return { ...object, animator: { ...animator, enabled: true, controllerId: controllerId || undefined } };
      }),
    ),
  );
};

export const applyAddAnimatorParameter = (
  set: SetState,
  get: GetState,
  controllerId: string,
  param: { name: string; type: AnimatorParameter['type']; source?: AnimatorParameter['source']; variableId?: string; defaultValue?: number | boolean },
): string | undefined => {
  const controller = get().animatorControllers.find((item) => item.id === controllerId);
  if (!controller) return undefined;
  const id = makeId('param');
  const defaultValue = param.defaultValue ?? (param.type === 'float' ? 0 : false);
  set((state) => ({
    animatorControllers: state.animatorControllers.map((item) =>
      item.id === controllerId
        ? {
            ...item,
            parameters: [
              ...item.parameters,
              { id, name: param.name, type: param.type, source: param.source ?? 'manual', variableId: param.variableId, defaultValue },
            ],
          }
        : item,
    ),
    isDirty: true,
  }));
  return id;
};

export const applyUpdateAnimatorParameter = (
  set: SetState,
  controllerId: string,
  paramId: string,
  patch: Partial<Omit<AnimatorParameter, 'id'>>,
): void => {
  set((state) => ({
    animatorControllers: state.animatorControllers.map((item) =>
      item.id === controllerId
        ? { ...item, parameters: item.parameters.map((p) => (p.id === paramId ? { ...p, ...patch } : p)) }
        : item,
    ),
    isDirty: true,
  }));
};

export const applyRemoveAnimatorParameter = (set: SetState, controllerId: string, paramId: string): void => {
  set((state) => ({
    animatorControllers: state.animatorControllers.map((item) =>
      item.id === controllerId
        ? {
            ...item,
            parameters: item.parameters.filter((p) => p.id !== paramId),
            transitions: item.transitions.map((t) => ({ ...t, conditions: t.conditions.filter((c) => c.parameterId !== paramId) })),
          }
        : item,
    ),
    isDirty: true,
  }));
};

/**
 * The base machine and every animation layer expose the same three fields, so one mutator can target
 * either: pass a `layerId` to edit that layer's machine, or omit it for the controller's own.
 *
 * Without this, adding layers would have meant a second copy of all six state/transition mutators,
 * which is exactly how the two paths drift apart.
 */
type StateMachineOwner = {
  states: AnimatorState[];
  defaultStateId?: string;
  transitions: AnimatorTransition[];
};

const mapMachine = (
  controller: AnimatorController,
  layerId: string | undefined,
  transform: (owner: StateMachineOwner) => Partial<StateMachineOwner>,
): AnimatorController => {
  if (!layerId) return { ...controller, ...transform(controller) };
  return {
    ...controller,
    layers: (controller.layers ?? []).map((layer) =>
      layer.id === layerId ? { ...layer, ...transform(layer) } : layer,
    ),
  };
};

/** The machine a mutator is about to edit, for the reads that happen before the set(). */
const machineOf = (controller: AnimatorController, layerId?: string): StateMachineOwner | undefined =>
  layerId ? controller.layers?.find((layer) => layer.id === layerId) : controller;

export const applyAddAnimatorState = (
  set: SetState,
  get: GetState,
  controllerId: string,
  stateInput: { name?: string; animationId?: string; speed?: number; loop?: boolean; position?: { x: number; y: number } } | undefined,
  layerId?: string,
): string | undefined => {
  const controller = get().animatorControllers.find((item) => item.id === controllerId);
  if (!controller) return undefined;
  if (layerId && !machineOf(controller, layerId)) return undefined;
  const id = makeId('state');
  set((state) => ({
    animatorControllers: state.animatorControllers.map((item) =>
      item.id === controllerId
        ? mapMachine(item, layerId, (machine) => ({
            states: [
              ...machine.states,
              {
                id,
                name: stateInput?.name ?? `State ${machine.states.length + 1}`,
                animationId: stateInput?.animationId,
                speed: stateInput?.speed ?? 1,
                loop: stateInput?.loop ?? true,
                position: stateInput?.position ?? { x: 80, y: 40 + machine.states.length * 90 },
              },
            ],
            defaultStateId: machine.defaultStateId ?? id,
          }))
        : item,
    ),
    isDirty: true,
  }));
  return id;
};

export const applyUpdateAnimatorState = (
  set: SetState,
  controllerId: string,
  stateId: string,
  patch: Partial<Omit<AnimatorState, 'id'>>,
  layerId?: string,
): void => {
  set((state) => ({
    animatorControllers: state.animatorControllers.map((item) =>
      item.id === controllerId
        ? mapMachine(item, layerId, (machine) => ({
            states: machine.states.map((s) => (s.id === stateId ? { ...s, ...patch } : s)),
          }))
        : item,
    ),
    isDirty: true,
  }));
};

export const applyRemoveAnimatorState = (
  set: SetState,
  controllerId: string,
  stateId: string,
  layerId?: string,
): void => {
  set((state) => ({
    animatorControllers: state.animatorControllers.map((item) =>
      item.id === controllerId
        ? mapMachine(item, layerId, (machine) => ({
            states: machine.states.filter((s) => s.id !== stateId),
            defaultStateId:
              machine.defaultStateId === stateId
                ? machine.states.find((s) => s.id !== stateId)?.id
                : machine.defaultStateId,
            transitions: machine.transitions.filter((t) => t.from !== stateId && t.to !== stateId),
          }))
        : item,
    ),
    isDirty: true,
  }));
};

export const applyAddAnimatorTransition = (
  set: SetState,
  get: GetState,
  controllerId: string,
  transition: { from: string; to: string; conditions?: AnimatorCondition[]; duration?: number; hasExitTime?: boolean; exitTime?: number },
  layerId?: string,
): string | undefined => {
  const controller = get().animatorControllers.find((item) => item.id === controllerId);
  if (!controller) return undefined;
  if (layerId && !machineOf(controller, layerId)) return undefined;
  const id = makeId('xition');
  set((state) => ({
    animatorControllers: state.animatorControllers.map((item) =>
      item.id === controllerId
        ? mapMachine(item, layerId, (machine) => ({
            transitions: [
              ...machine.transitions,
              { id, from: transition.from, to: transition.to, conditions: transition.conditions ?? [], duration: transition.duration ?? 0.2, hasExitTime: transition.hasExitTime, exitTime: transition.exitTime },
            ],
          }))
        : item,
    ),
    isDirty: true,
  }));
  return id;
};

export const applyUpdateAnimatorTransition = (
  set: SetState,
  controllerId: string,
  transitionId: string,
  patch: Partial<Omit<AnimatorTransition, 'id'>>,
  layerId?: string,
): void => {
  set((state) => ({
    animatorControllers: state.animatorControllers.map((item) =>
      item.id === controllerId
        ? mapMachine(item, layerId, (machine) => ({
            transitions: machine.transitions.map((t) => (t.id === transitionId ? { ...t, ...patch } : t)),
          }))
        : item,
    ),
    isDirty: true,
  }));
};

export const applyRemoveAnimatorTransition = (
  set: SetState,
  controllerId: string,
  transitionId: string,
  layerId?: string,
): void => {
  set((state) => ({
    animatorControllers: state.animatorControllers.map((item) =>
      item.id === controllerId
        ? mapMachine(item, layerId, (machine) => ({
            transitions: machine.transitions.filter((t) => t.id !== transitionId),
          }))
        : item,
    ),
    isDirty: true,
  }));
};

// --- Animation layers ---------------------------------------------------------------------------

/** Adds an empty animation layer. Its states are then authored with the layerId-aware mutators above. */
export const applyAddAnimatorLayer = (
  set: SetState,
  get: GetState,
  controllerId: string,
  input: { name?: string; maskRootBones?: string[]; weight?: number } | undefined,
): string | undefined => {
  const controller = get().animatorControllers.find((item) => item.id === controllerId);
  if (!controller) return undefined;
  const id = makeId('layer');
  set((state) => ({
    animatorControllers: state.animatorControllers.map((item) =>
      item.id === controllerId
        ? {
            ...item,
            layers: [
              ...(item.layers ?? []),
              {
                id,
                name: input?.name ?? `Layer ${(item.layers?.length ?? 0) + 1}`,
                maskRootBones: input?.maskRootBones ?? [],
                weight: input?.weight ?? 1,
                states: [],
                transitions: [],
              },
            ],
          }
        : item,
    ),
    isDirty: true,
  }));
  return id;
};

export const applyUpdateAnimatorLayer = (
  set: SetState,
  controllerId: string,
  layerId: string,
  patch: Partial<Omit<AnimatorLayer, 'id'>>,
): void => {
  set((state) => ({
    animatorControllers: state.animatorControllers.map((item) =>
      item.id === controllerId
        ? { ...item, layers: (item.layers ?? []).map((layer) => (layer.id === layerId ? { ...layer, ...patch } : layer)) }
        : item,
    ),
    isDirty: true,
  }));
};

export const applyRemoveAnimatorLayer = (set: SetState, controllerId: string, layerId: string): void => {
  set((state) => ({
    animatorControllers: state.animatorControllers.map((item) =>
      item.id === controllerId
        ? { ...item, layers: (item.layers ?? []).filter((layer) => layer.id !== layerId) }
        : item,
    ),
    isDirty: true,
  }));
};

export const applyToggleCharacterController = (set: SetState, id: string): void => {
  set((state) =>
    mapActiveSceneObjects(state, (objects) =>
      objects.map((object) => {
        if (object.id !== id) return object;
        const current = object.character ?? defaultCharacter();
        return { ...object, character: { ...current, enabled: !current.enabled } };
      }),
    ),
  );
};

export const applyUpdateCharacterController = (set: SetState, id: string, patch: Partial<CharacterControllerComponent>): void => {
  set((state) =>
    mapActiveSceneObjects(state, (objects) =>
      objects.map((object) =>
        object.id === id && object.character ? { ...object, character: { ...object.character, ...patch } } : object,
      ),
    ),
  );
};
