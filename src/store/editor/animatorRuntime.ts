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

/** Local move direction for directional (2D) blend spaces. */
export interface LocalMoveVector {
  /** Right axis: -1 fully left, +1 fully right. */
  moveX: number;
  /** Forward axis: -1 fully backward, +1 fully forward. */
  moveY: number;
}

/**
 * The object's movement this frame expressed in its own facing frame, scaled by how fast it is going
 * relative to `referenceSpeed` (its walk/jog speed).
 *
 * The scaling is the point. These feed 2D directional blend spaces, which are authored with idle at
 * the origin and the directional clips out at radius 1 — the bundled pawn does exactly that. A pure
 * normalized direction is always length 1 the instant the object moves at all, so the blend point
 * teleported from the origin to the rim and never visited anything in between: idle only ever had
 * weight while completely stopped, and a character easing into motion snapped straight to a full jog
 * while its body was still accelerating, which reads as sliding feet. Scaling by speed makes the point
 * travel out from the origin as the object accelerates, which is the layout the samples describe.
 *
 * Sprinting pushes the magnitude past 1 and therefore outside the sample hull, where the blend clamps
 * to the nearest edge — the full-speed pose, which is what you want.
 *
 * `referenceSpeed` of 0 (an animated object with no character controller) disables the scaling and
 * returns the plain direction, preserving the original behaviour for those.
 */
export const localMoveVector = (
  dx: number,
  dz: number,
  facing: number,
  speed: number,
  referenceSpeed: number,
): LocalMoveVector => {
  const horizontal = Math.hypot(dx, dz);
  // Below this the object is effectively still, and the direction is numerical noise.
  if (!(horizontal > 1e-4)) return { moveX: 0, moveY: 0 };
  const wx = dx / horizontal;
  const wz = dz / horizontal;
  const forward = wx * Math.sin(facing) + wz * Math.cos(facing);
  const right = wx * Math.cos(facing) - wz * Math.sin(facing);
  // A non-finite speed (a bad transform upstream) must not poison the parameter: a NaN here would
  // flow into the blend weights and NaN the whole pose. Fall back to the plain direction instead.
  const ratio = referenceSpeed > 0 ? speed / referenceSpeed : 1;
  const scale = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 1;
  return { moveX: right * scale, moveY: forward * scale };
};
