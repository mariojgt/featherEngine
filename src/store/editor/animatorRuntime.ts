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

/**
 * Effective clip length of a state, in seconds of runtime — what an exit-time transition measures
 * its progress against.
 *
 * A state's clip is normally `animationId`, but that field is optional and a blend space authored
 * through `set_blendspace` on a fresh state has none: its pose comes from `blendSamples`. Reading only
 * `animationId` returned 0 for those, and since the exit-time gate compares `timeInState < duration *
 * exitTime`, a zero duration made the gate always pass — so one-shot transitions out of a blend space
 * fired on their first frame instead of waiting for the clip.
 *
 * The blend fallback takes the LONGEST sample so a one-shot blend (a directional dodge, say) plays out
 * fully rather than being cut to its shortest variant. Divided by the state's speed because a state
 * playing at 2x reaches its exit point in half the wall-clock time.
 */
export const animatorStateClipDuration = (
  state: AnimatorState | undefined,
  durationOf: (animationId: string) => number | undefined,
): number => {
  if (!state) return 0;
  const direct = state.animationId ? durationOf(state.animationId) : undefined;
  const raw =
    direct ??
    (state.blendSamples ?? []).reduce((longest, sample) => Math.max(longest, durationOf(sample.animationId) ?? 0), 0);
  if (!(raw > 0)) return 0;
  return raw / Math.max(state.speed ?? 1, 0.01);
};
