import { blend1D, blend2D } from '../../three/blendSpace';
import { resolveLayerWeight } from './animatorRuntime';
import type { AnimationAsset, AnimatorController, AnimatorParamType, AnimatorState } from '../../types';
import type { RuntimeAnimator } from './defaults';

/**
 * Derives a human-readable picture of what an Animator is doing right now: the active state, every
 * parameter's live value, and which clips are in the pose at what weight.
 *
 * This is pure derived data — it reads the controller definition plus the runtime record the Play
 * loop already maintains, so the debugger needs nothing plumbed out of the renderer. Crucially it
 * computes blend weights with the same `blend1D`/`blend2D` the renderer feeds the mixer, so the
 * numbers on screen are the numbers actually posing the skeleton rather than a re-implementation
 * that could drift.
 */

/** One parameter and its current value. */
export interface AnimatorDebugParameter {
  id: string;
  name: string;
  type: AnimatorParamType;
  value: number | boolean;
  /** True when the value came from the live Play runtime rather than the authored default. */
  live: boolean;
}

/** One clip contributing to the current pose. */
export interface AnimatorDebugClip {
  animationId: string;
  /** Animation asset name, falling back to the raw clip name inside the GLB. */
  label: string;
  weight: number;
}

export interface AnimatorDebugSnapshot {
  stateId?: string;
  stateName: string;
  /** Seconds elapsed in the active state (0 outside Play). */
  timeInState: number;
  /** Present when the active state is a blend space — the driving axes and their live values. */
  blend?: { xName: string; x: number; yName?: string; y?: number };
  parameters: AnimatorDebugParameter[];
  /** Clips in the pose, heaviest first. Zero-weight samples are omitted. */
  clips: AnimatorDebugClip[];
  /** Present while a one-shot montage is overriding the state machine. */
  montage?: { label: string; remaining: number };
  /** True when these values are coming from a running Play session. */
  live: boolean;
  /** Animation layers and what each is contributing, in controller order. */
  layers: AnimatorDebugLayer[];
}

/** One animation layer's live state. */
export interface AnimatorDebugLayer {
  id: string;
  name: string;
  stateName: string;
  /** Blend weight of the whole layer, 0..1. */
  weight: number;
  /** Bones the layer drives (root bones; each brings its subtree). Empty means the whole skeleton. */
  maskRootBones: string[];
  /** Clips in this layer's pose, heaviest first. Weights are within the layer, before its weight. */
  clips: AnimatorDebugClip[];
}

/** Weights below this are noise and would only clutter the readout. */
const WEIGHT_EPSILON = 5e-4;

const asNumber = (value: number | boolean | undefined): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return 0;
};

export function buildAnimatorDebugSnapshot(
  controller: AnimatorController,
  runtime: RuntimeAnimator | undefined,
  animations: AnimationAsset[],
): AnimatorDebugSnapshot {
  const live = Boolean(runtime);
  // Outside Play, preview the entry state so the readout is meaningful before pressing Play.
  const stateId = runtime?.stateId ?? controller.defaultStateId ?? controller.states[0]?.id;
  const state = controller.states.find((item) => item.id === stateId);

  const labelOf = (animationId: string): string => {
    const asset = animations.find((item) => item.id === animationId);
    // Truthiness, not ??: an asset renamed to an empty string would otherwise render a blank row.
    return asset?.name || asset?.clipName || animationId;
  };

  const parameters: AnimatorDebugParameter[] = controller.parameters.map((parameter) => {
    const runtimeValue = runtime?.params?.[parameter.id];
    return {
      id: parameter.id,
      name: parameter.name,
      type: parameter.type,
      value: runtimeValue ?? parameter.defaultValue,
      live: live && runtimeValue !== undefined,
    };
  });

  const paramValues: Record<string, number | boolean> = {};
  for (const parameter of parameters) paramValues[parameter.id] = parameter.value;

  const valueOf = (parameterId?: string): number => {
    if (!parameterId) return 0;
    const parameter = controller.parameters.find((item) => item.id === parameterId);
    const raw = runtime?.params?.[parameterId] ?? parameter?.defaultValue;
    return asNumber(raw);
  };
  const nameOf = (parameterId?: string): string =>
    controller.parameters.find((item) => item.id === parameterId)?.name ?? '—';

  const weightsOfState = (target?: AnimatorState): AnimatorDebugClip[] => {
    if (target?.blendSamples?.length && target.blendParameterId) {
      const x = valueOf(target.blendParameterId);
      const weights = target.blendParameterIdY
        ? blend2D(target.blendSamples, x, valueOf(target.blendParameterIdY))
        : blend1D(target.blendSamples, x);
      return weights
        .filter((weight) => weight.weight > WEIGHT_EPSILON)
        .map((weight) => ({ animationId: weight.animationId, label: labelOf(weight.animationId), weight: weight.weight }))
        .sort((a, b) => b.weight - a.weight);
    }
    if (target?.animationId) {
      return [{ animationId: target.animationId, label: labelOf(target.animationId), weight: 1 }];
    }
    return [];
  };

  // Layers, so a masked pose that is not showing up can be diagnosed here rather than guessed at:
  // a zero weight, an unmatched mask bone and a stuck layer state all look different in this readout.
  const layers: AnimatorDebugLayer[] = [];
  for (const layer of controller.layers ?? []) {
    const liveLayer = runtime?.layers?.[layer.id];
    const layerStateId = liveLayer?.stateId || layer.defaultStateId || layer.states[0]?.id;
    const layerState = layer.states.find((item) => item.id === layerStateId);
    layers.push({
      id: layer.id,
      name: layer.name,
      stateName: layerState?.name ?? '—',
      weight: liveLayer ? liveLayer.weight : resolveLayerWeight(layer, paramValues),
      maskRootBones: layer.maskRootBones,
      clips: weightsOfState(layerState),
    });
  }

  const base: AnimatorDebugSnapshot = {
    stateId,
    stateName: state?.name ?? '—',
    timeInState: runtime?.time ?? 0,
    parameters,
    clips: [],
    live,
    layers,
  };

  // A montage (Play Animation node) replaces the state machine's output entirely until it ends.
  const montage = runtime?.montage && runtime.montage.remaining > 0 ? runtime.montage : undefined;
  if (montage) {
    return {
      ...base,
      clips: [{ animationId: montage.animationId, label: labelOf(montage.animationId), weight: 1 }],
      montage: { label: labelOf(montage.animationId), remaining: montage.remaining },
    };
  }

  if (state?.blendSamples?.length && state.blendParameterId) {
    return {
      ...base,
      blend: {
        xName: nameOf(state.blendParameterId),
        x: valueOf(state.blendParameterId),
        yName: state.blendParameterIdY ? nameOf(state.blendParameterIdY) : undefined,
        y: state.blendParameterIdY ? valueOf(state.blendParameterIdY) : undefined,
      },
      clips: weightsOfState(state),
    };
  }

  return { ...base, clips: weightsOfState(state) };
}
