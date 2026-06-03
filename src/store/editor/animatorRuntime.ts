import type { AnimatorController, AnimatorParameter, AnimatorState, AnimatorTransition } from '../../types';

export interface AnimatorControllerRuntime {
  controller: AnimatorController;
  statesById: Map<string, AnimatorState>;
  paramsById: Map<string, AnimatorParameter>;
  paramsByName: Map<string, AnimatorParameter>;
  transitionCandidatesByState: Map<string, AnimatorTransition[]>;
}

const animatorRuntimeCache = new WeakMap<AnimatorController, AnimatorControllerRuntime>();

export const buildAnimatorControllerRuntime = (controller: AnimatorController): AnimatorControllerRuntime => {
  const statesById = new Map(controller.states.map((state) => [state.id, state]));
  const paramsById = new Map(controller.parameters.map((param) => [param.id, param]));
  const paramsByName = new Map(controller.parameters.map((param) => [param.name, param]));
  const transitionCandidatesByState = new Map<string, AnimatorTransition[]>();

  for (const state of controller.states) {
    transitionCandidatesByState.set(
      state.id,
      controller.transitions.filter((transition) => transition.from === state.id || transition.from === 'any'),
    );
  }

  return { controller, statesById, paramsById, paramsByName, transitionCandidatesByState };
};

export const getAnimatorControllerRuntime = (controller: AnimatorController): AnimatorControllerRuntime => {
  const cached = animatorRuntimeCache.get(controller);
  if (cached) return cached;
  const runtime = buildAnimatorControllerRuntime(controller);
  animatorRuntimeCache.set(controller, runtime);
  return runtime;
};
