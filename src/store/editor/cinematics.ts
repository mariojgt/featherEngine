import type {
  CinematicAction,
  CinematicCameraKeyframe,
  CinematicEase,
  CinematicInterpolation,
  CinematicMaterialKeyframe,
  CinematicSequence,
  CinematicTransformKeyframe,
  MaterialOverrides,
  RuntimeCinematicCamera,
  RuntimeCinematicFade,
  RuntimeCinematicText,
  SceneObject,
  TransformComponent,
  Vector3Tuple,
} from '../../types';

export const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const mix = (from: number, to: number, t: number) => from + (to - from) * t;
export const mixVec3 = (from: Vector3Tuple, to: Vector3Tuple, t: number): Vector3Tuple => [
  mix(from[0], to[0], t),
  mix(from[1], to[1], t),
  mix(from[2], to[2], t),
];

const lookAtFromRotation = (position: Vector3Tuple, rotation: Vector3Tuple): Vector3Tuple => {
  const pitch = rotation[0];
  const yaw = rotation[1];
  return [
    position[0] + Math.sin(yaw) * Math.cos(pitch),
    position[1] + Math.sin(pitch),
    position[2] + Math.cos(yaw) * Math.cos(pitch),
  ];
};

/** Map a linear 0..1 progress through an easing curve (smooth = ease-in-out, the cinematic default). */
const applyCinematicEase = (t: number, ease: CinematicEase = 'smooth'): number => {
  const x = clamp01(t);
  switch (ease) {
    case 'linear':
      return x;
    case 'in':
      return x * x;
    case 'out':
      return 1 - (1 - x) * (1 - x);
    case 'smooth':
    default:
      return x * x * (3 - 2 * x);
  }
};

/** Eased local progress (0..1) of a beat at `time`, using the beat's `ease` (default smooth). */
const cinematicActionLocalTime = (action: CinematicAction, time: number) =>
  applyCinematicEase(clamp01((time - action.time) / Math.max(action.duration ?? 0, 0.001)), action.ease);

const isCinematicActionActive = (action: CinematicAction, time: number) => {
  const duration = Math.max(action.duration ?? 0, 0.001);
  return time >= action.time && time <= action.time + duration;
};

const shiftedCinematicAction = (action: CinematicAction, offset: number, parentId: string): CinematicAction => ({
  ...action,
  id: `${parentId}:${action.id}`,
  time: action.time + offset,
  keyframes: action.keyframes?.map((frame) => ({ ...frame, time: frame.time + offset })),
  transformKeyframes: action.transformKeyframes?.map((frame) => ({ ...frame, time: frame.time + offset })),
  materialKeyframes: action.materialKeyframes?.map((frame) => ({ ...frame, time: frame.time + offset })),
});

export const cinematicActionsAt = (
  sequence: CinematicSequence | undefined,
  sequences: CinematicSequence[] = sequence ? [sequence] : [],
  time = 0,
  depth = 0,
  visited = new Set<string>(),
): CinematicAction[] => {
  if (!sequence || depth > 4 || visited.has(sequence.id)) return [];
  const nextVisited = new Set(visited);
  nextVisited.add(sequence.id);
  const actions: CinematicAction[] = [];
  for (const action of sequence.actions) {
    if (action.type === 'subsequence' && action.cinematicId) {
      const child = sequences.find((item) => item.id === action.cinematicId);
      const duration = Math.max(action.duration ?? child?.duration ?? 0, 0.001);
      if (child && time >= action.time && time <= action.time + duration) {
        actions.push(
          ...cinematicActionsAt(child, sequences, time - action.time, depth + 1, nextVisited)
            .map((childAction) => shiftedCinematicAction(childAction, action.time, action.id)),
        );
      }
    } else {
      actions.push(action);
    }
  }
  return actions;
};

/** Linearly blend two camera poses (position/lookAt/fov). */
const mixCinematicCamera = (
  from: RuntimeCinematicCamera,
  to: RuntimeCinematicCamera,
  t: number,
): RuntimeCinematicCamera => {
  const fromFocus = from.focusDistance ?? to.focusDistance;
  const toFocus = to.focusDistance ?? from.focusDistance;
  const fromAperture = from.aperture ?? to.aperture;
  const toAperture = to.aperture ?? from.aperture;
  return {
    position: mixVec3(from.position, to.position, t),
    lookAt: mixVec3(from.lookAt, to.lookAt, t),
    fov: mix(from.fov, to.fov, t),
    focusDistance: fromFocus !== undefined && toFocus !== undefined ? mix(fromFocus, toFocus, t) : undefined,
    aperture: fromAperture !== undefined && toAperture !== undefined ? mix(fromAperture, toAperture, t) : undefined,
  };
};

/** Catmull-Rom interpolation of one scalar through four control points (p1→p2 over t∈[0,1]). */
const catmullRom = (p0: number, p1: number, p2: number, p3: number, t: number): number => {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
};

const catmullRomVec3 = (p0: Vector3Tuple, p1: Vector3Tuple, p2: Vector3Tuple, p3: Vector3Tuple, t: number): Vector3Tuple => [
  catmullRom(p0[0], p1[0], p2[0], p3[0], t),
  catmullRom(p0[1], p1[1], p2[1], p3[1], t),
  catmullRom(p0[2], p1[2], p2[2], p3[2], t),
];

const mixHexColor = (from: string | undefined, to: string | undefined, t: number): string | undefined => {
  if (!from && !to) return undefined;
  if (!from || !to) return to ?? from;
  const a = from.replace('#', '');
  const b = to.replace('#', '');
  if (a.length !== 6 || b.length !== 6) return t < 0.5 ? from : to;
  const parts = [0, 2, 4].map((i) => Math.round(mix(parseInt(a.slice(i, i + 2), 16), parseInt(b.slice(i, i + 2), 16), t)));
  return `#${parts.map((n) => n.toString(16).padStart(2, '0')).join('')}`;
};

const mixMaterialOverrides = (from: MaterialOverrides, to: MaterialOverrides, t: number): MaterialOverrides => ({
  color: mixHexColor(from.color, to.color, t),
  metalness: from.metalness !== undefined || to.metalness !== undefined ? mix(from.metalness ?? to.metalness ?? 0, to.metalness ?? from.metalness ?? 0, t) : undefined,
  roughness: from.roughness !== undefined || to.roughness !== undefined ? mix(from.roughness ?? to.roughness ?? 0, to.roughness ?? from.roughness ?? 0, t) : undefined,
  emissiveColor: mixHexColor(from.emissiveColor, to.emissiveColor, t),
  emissiveIntensity:
    from.emissiveIntensity !== undefined || to.emissiveIntensity !== undefined
      ? mix(from.emissiveIntensity ?? to.emissiveIntensity ?? 0, to.emissiveIntensity ?? from.emissiveIntensity ?? 0, t)
      : undefined,
});

const stripMaterialUndefined = (material: MaterialOverrides): MaterialOverrides =>
  Object.fromEntries(Object.entries(material).filter(([, value]) => value !== undefined)) as MaterialOverrides;

/**
 * Sample an animated camera track: fly smoothly through the keyframes via a Catmull-Rom spline
 * (positions + look-ats + fov). Times are absolute seconds; outside the range the camera holds on
 * the first/last keyframe. A single keyframe is a static framing.
 */
const sampleCameraKeyframes = (keyframes: CinematicCameraKeyframe[], time: number, interpolation: CinematicInterpolation = 'smooth'): RuntimeCinematicCamera | undefined => {
  const frames = keyframes.filter((frame) => Number.isFinite(frame.time)).sort((a, b) => a.time - b.time);
  if (!frames.length) return undefined;
  if (frames.length === 1 || time <= frames[0].time) {
    const first = frames[0];
    return { position: first.position, lookAt: first.lookAt, fov: first.fov, focusDistance: first.focusDistance, aperture: first.aperture };
  }
  const last = frames[frames.length - 1];
  if (time >= last.time) return { position: last.position, lookAt: last.lookAt, fov: last.fov, focusDistance: last.focusDistance, aperture: last.aperture };

  let i = 0;
  while (i < frames.length - 1 && frames[i + 1].time <= time) i += 1;
  const k1 = frames[i];
  const k2 = frames[i + 1];
  const k0 = frames[i - 1] ?? k1;
  const k3 = frames[i + 2] ?? k2;
  const span = Math.max(k2.time - k1.time, 0.001);
  const t = clamp01((time - k1.time) / span);
  if (interpolation === 'hold') return { position: k1.position, lookAt: k1.lookAt, fov: k1.fov, focusDistance: k1.focusDistance, aperture: k1.aperture };
  if (interpolation === 'linear') return mixCinematicCamera(
    { position: k1.position, lookAt: k1.lookAt, fov: k1.fov, focusDistance: k1.focusDistance, aperture: k1.aperture },
    { position: k2.position, lookAt: k2.lookAt, fov: k2.fov, focusDistance: k2.focusDistance, aperture: k2.aperture },
    t,
  );
  // Focus pulls: spline the focus distance/aperture across keyframes when any frame defines them,
  // falling back to the nearer keyframe's value where a frame leaves them unset.
  const focus = (pick: (frame: CinematicCameraKeyframe) => number | undefined): number | undefined => {
    if ([k0, k1, k2, k3].every((frame) => pick(frame) === undefined)) return undefined;
    const f1 = pick(k1) ?? pick(k2) ?? 0;
    const f2 = pick(k2) ?? f1;
    return catmullRom(pick(k0) ?? f1, f1, f2, pick(k3) ?? f2, t);
  };
  return {
    position: catmullRomVec3(k0.position, k1.position, k2.position, k3.position, t),
    lookAt: catmullRomVec3(k0.lookAt, k1.lookAt, k2.lookAt, k3.lookAt, t),
    fov: catmullRom(k0.fov, k1.fov, k2.fov, k3.fov, t),
    focusDistance: focus((frame) => frame.focusDistance),
    aperture: focus((frame) => frame.aperture),
  };
};

const objectPositionById = (objects: SceneObject[], id?: string): Vector3Tuple | undefined =>
  id ? objects.find((object) => object.id === id)?.transform.position : undefined;

const cameraFromCinematicAction = (
  action: CinematicAction,
  objects: SceneObject[],
  time: number,
): RuntimeCinematicCamera | undefined => {
  // An animated keyframe track takes over the whole framing when present.
  if (action.keyframes && action.keyframes.length) {
    const sampled = sampleCameraKeyframes(action.keyframes, time, action.interpolation);
    if (sampled) return sampled;
  }
  const cameraObject = action.objectId ? objects.find((object) => object.id === action.objectId) : undefined;
  // Follow rig: ride the followed object's position plus a world-space offset, so the camera trails a
  // moving subject without hand-keyframing. Overrides the static/from→to position when present.
  const followTarget = objectPositionById(objects, action.followObjectId);
  const followOffset = action.followOffset ?? action.position ?? [0, 0, 0];
  const toPosition = action.toPosition ?? action.position;
  const position = followTarget
    ? ([followTarget[0] + followOffset[0], followTarget[1] + followOffset[1], followTarget[2] + followOffset[2]] as Vector3Tuple)
    : action.fromPosition && toPosition && isCinematicActionActive(action, time)
      ? mixVec3(action.fromPosition, toPosition, cinematicActionLocalTime(action, time))
      : action.position ?? action.toPosition ?? action.fromPosition ?? cameraObject?.transform.position;
  if (!position) return undefined;
  const toRotation = action.toRotation ?? action.rotation;
  const rotation =
    action.fromRotation && toRotation && isCinematicActionActive(action, time)
      ? mixVec3(action.fromRotation, toRotation, cinematicActionLocalTime(action, time))
      : action.rotation ?? action.toRotation ?? action.fromRotation ?? cameraObject?.transform.rotation;
  // Aim constraint: lock the look target onto an object (tracking shot). Precedence: explicit
  // lookAtObjectId → explicit lookAt vector → the followed object → the beat's rotation → default.
  const aimTarget = objectPositionById(objects, action.lookAtObjectId);
  const lookAt = aimTarget ?? action.lookAt ?? followTarget ?? (rotation ? lookAtFromRotation(position, rotation) : [0, 1, 0]);
  // Auto rack-focus: when a focus object is set, the DoF focus distance is the live camera→object
  // distance every frame (a focus pull that tracks the subject), overriding the manual focusDistance.
  const focusTarget = objectPositionById(objects, action.focusObjectId);
  const focusDistance = focusTarget
    ? Math.hypot(focusTarget[0] - position[0], focusTarget[1] - position[1], focusTarget[2] - position[2])
    : action.focusDistance;
  return {
    position,
    lookAt,
    fov: action.fov ?? 50,
    focusDistance,
    aperture: action.aperture,
  };
};

/**
 * Deterministic handheld/shake offset layered on the final framing. Sum-of-sines noise of `time` (no
 * RNG) so a recorded export reproduces the exact same wobble. Nudges both the camera position and its
 * look target, giving a living-camera feel: low frequency = a slow breathing drift, high = nervous jitter.
 */
const applyCinematicShake = (
  pose: RuntimeCinematicCamera,
  amount: number | undefined,
  frequency: number | undefined,
  time: number,
): RuntimeCinematicCamera => {
  if (!amount || amount <= 0.001) return pose;
  const f = Math.max(0.1, frequency ?? 7);
  const noise = (seed: number) =>
    Math.sin(time * f + seed) * 0.6 + Math.sin(time * f * 0.47 + seed * 1.7) * 0.3 + Math.sin(time * f * 1.93 + seed * 0.31) * 0.1;
  const posAmp = amount * 0.12;
  const aimAmp = amount * 0.2;
  return {
    ...pose,
    position: [pose.position[0] + noise(0) * posAmp, pose.position[1] + noise(11.3) * posAmp, pose.position[2] + noise(23.7) * posAmp],
    lookAt: [pose.lookAt[0] + noise(31.1) * aimAmp, pose.lookAt[1] + noise(43.9) * aimAmp, pose.lookAt[2] + noise(57.4) * aimAmp],
  };
};

export const cinematicCameraAt = (
  sequence: CinematicSequence | undefined,
  objects: SceneObject[],
  time: number,
  fallback?: RuntimeCinematicCamera,
  sequences?: CinematicSequence[],
): RuntimeCinematicCamera | undefined => {
  const cameraActions = cinematicActionsAt(sequence, sequences, time).filter((item) => item.type === 'camera').sort((a, b) => a.time - b.time);
  if (!cameraActions.length) return fallback;
  const past = cameraActions.filter((item) => item.time <= time);
  const current = past[past.length - 1] ?? cameraActions[0];
  const currentPose = cameraFromCinematicAction(current, objects, time);
  if (!currentPose) return fallback;

  // Glide from the previous shot's framing into this one over `current.blend` seconds — a smooth
  // dolly instead of a hard cut. `blend` 0 (or no previous shot) keeps the classic instant cut.
  let pose = currentPose;
  const previous = past.length >= 2 ? past[past.length - 2] : undefined;
  const blend = current.blend ?? 0;
  if (previous && blend > 0.001 && time < current.time + blend) {
    const previousPose = cameraFromCinematicAction(previous, objects, current.time);
    if (previousPose) {
      const t = applyCinematicEase((time - current.time) / blend, current.ease);
      pose = mixCinematicCamera(previousPose, currentPose, t);
    }
  }
  // Handheld shake is layered last so it rides on top of any shot-to-shot blend.
  return applyCinematicShake(pose, current.shake, current.shakeFrequency, time);
};

/** Sample an animated object transform track: fly smoothly through the keyframes via Catmull-Rom. */
const sampleTransformKeyframes = (keyframes: CinematicTransformKeyframe[], time: number, interpolation: CinematicInterpolation = 'smooth'): TransformComponent | undefined => {
  const frames = keyframes.filter((frame) => Number.isFinite(frame.time)).sort((a, b) => a.time - b.time);
  if (!frames.length) return undefined;
  const pick = (frame: CinematicTransformKeyframe): TransformComponent => ({ position: frame.position, rotation: frame.rotation, scale: frame.scale });
  if (frames.length === 1 || time <= frames[0].time) return pick(frames[0]);
  const last = frames[frames.length - 1];
  if (time >= last.time) return pick(last);

  let i = 0;
  while (i < frames.length - 1 && frames[i + 1].time <= time) i += 1;
  const k1 = frames[i];
  const k2 = frames[i + 1];
  const k0 = frames[i - 1] ?? k1;
  const k3 = frames[i + 2] ?? k2;
  const t = clamp01((time - k1.time) / Math.max(k2.time - k1.time, 0.001));
  if (interpolation === 'hold') return pick(k1);
  if (interpolation === 'linear') {
    return {
      position: mixVec3(k1.position, k2.position, t),
      rotation: mixVec3(k1.rotation, k2.rotation, t),
      scale: mixVec3(k1.scale, k2.scale, t),
    };
  }
  return {
    position: catmullRomVec3(k0.position, k1.position, k2.position, k3.position, t),
    rotation: catmullRomVec3(k0.rotation, k1.rotation, k2.rotation, k3.rotation, t),
    scale: catmullRomVec3(k0.scale, k1.scale, k2.scale, k3.scale, t),
  };
};

export const cinematicFadeAt = (
  sequence: CinematicSequence | undefined,
  time: number,
  fallback?: RuntimeCinematicFade,
  sequences?: CinematicSequence[],
): RuntimeCinematicFade | undefined => {
  const action = cinematicActionsAt(sequence, sequences, time)
    .filter((item) => item.type === 'fade' && item.time <= time)
    .sort((a, b) => b.time - a.time)[0];
  if (!action) return undefined;
  const active = isCinematicActionActive(action, time);
  const from = action.fadeFrom ?? fallback?.opacity ?? 0;
  const to = action.fadeTo ?? 1;
  let opacity: number;
  if (action.fadeDip) {
    // Dip transition: ramp up over the first half, back down over the second — resolves to `from` outside
    // the window, so a dip-to-black between two shots cleanly returns to a clear frame on either side.
    const dur = Math.max(action.duration ?? 0, 0.001);
    const raw = (time - action.time) / dur;
    const tri = !active ? 0 : raw < 0.5 ? applyCinematicEase(raw * 2, action.ease) : applyCinematicEase((1 - raw) * 2, action.ease);
    opacity = mix(from, to, tri);
  } else {
    opacity = active ? mix(from, to, cinematicActionLocalTime(action, time)) : action.fadeTo ?? fallback?.opacity ?? 0;
  }
  return {
    opacity,
    color: action.fadeColor ?? fallback?.color ?? '#000000',
    wipe: action.fadeWipe,
  };
};

export const initialCinematicCamera = (sequence: CinematicSequence | undefined, objects: SceneObject[], sequences?: CinematicSequence[]): RuntimeCinematicCamera | undefined =>
  cinematicCameraAt(sequence, objects, 0, undefined, sequences);

export const initialCinematicFade = (sequence: CinematicSequence | undefined, sequences?: CinematicSequence[]): RuntimeCinematicFade | undefined =>
  cinematicFadeAt(sequence, 0, undefined, sequences);

export const cinematicTransformsAt = (
  sequence: CinematicSequence | undefined,
  objects: SceneObject[],
  time: number,
  sequences?: CinematicSequence[],
): Record<string, TransformComponent> => {
  if (!sequence) return {};
  const byId = new Map(objects.map((object) => [object.id, object]));
  const transforms: Record<string, TransformComponent> = {};

  cinematicActionsAt(sequence, sequences, time)
    .filter((action) => action.type === 'transform' && action.objectId && action.time <= time)
    .sort((a, b) => a.time - b.time)
    .forEach((action) => {
      const objectId = action.objectId;
      if (!objectId) return;
      const current = transforms[objectId] ?? byId.get(objectId)?.transform;
      if (!current) return;
      // An animated keyframe track drives the object's whole transform when present.
      if (action.transformKeyframes && action.transformKeyframes.length) {
        const sampled = sampleTransformKeyframes(action.transformKeyframes, time, action.interpolation);
        if (sampled) transforms[objectId] = sampled;
        return;
      }
      const local = isCinematicActionActive(action, time) ? cinematicActionLocalTime(action, time) : 1;
      const toPosition = action.toPosition ?? action.position ?? current.position;
      const toRotation = action.toRotation ?? action.rotation ?? current.rotation;
      const toScale = action.toScale ?? action.scale ?? current.scale;
      transforms[objectId] = {
        position: action.fromPosition ? mixVec3(action.fromPosition, toPosition, local) : toPosition,
        rotation: action.fromRotation ? mixVec3(action.fromRotation, toRotation, local) : toRotation,
        scale: action.fromScale ? mixVec3(action.fromScale, toScale, local) : toScale,
      };
    });

  return transforms;
};

const sampleMaterialKeyframes = (keyframes: CinematicMaterialKeyframe[], time: number, interpolation: CinematicInterpolation = 'smooth'): MaterialOverrides | undefined => {
  const frames = keyframes.filter((frame) => Number.isFinite(frame.time)).sort((a, b) => a.time - b.time);
  if (!frames.length) return undefined;
  const pick = (frame: CinematicMaterialKeyframe): MaterialOverrides => ({
    color: frame.color,
    metalness: frame.metalness,
    roughness: frame.roughness,
    emissiveColor: frame.emissiveColor,
    emissiveIntensity: frame.emissiveIntensity,
  });
  if (frames.length === 1 || time <= frames[0].time) return stripMaterialUndefined(pick(frames[0]));
  const last = frames[frames.length - 1];
  if (time >= last.time) return stripMaterialUndefined(pick(last));
  let i = 0;
  while (i < frames.length - 1 && frames[i + 1].time <= time) i += 1;
  const k1 = frames[i];
  const k2 = frames[i + 1];
  if (interpolation === 'hold') return stripMaterialUndefined(pick(k1));
  const t = clamp01((time - k1.time) / Math.max(k2.time - k1.time, 0.001));
  return stripMaterialUndefined(mixMaterialOverrides(pick(k1), pick(k2), interpolation === 'linear' ? t : applyCinematicEase(t, 'smooth')));
};

export const cinematicMaterialsAt = (
  sequence: CinematicSequence | undefined,
  objects: SceneObject[],
  time: number,
  sequences?: CinematicSequence[],
): Record<string, MaterialOverrides> => {
  if (!sequence) return {};
  const byId = new Map(objects.map((object) => [object.id, object]));
  const materials: Record<string, MaterialOverrides> = {};
  cinematicActionsAt(sequence, sequences, time)
    .filter((action) => action.type === 'material' && action.objectId && action.time <= time)
    .sort((a, b) => a.time - b.time)
    .forEach((action) => {
      const objectId = action.objectId;
      if (!objectId) return;
      const base = materials[objectId] ?? byId.get(objectId)?.renderer?.materialOverrides ?? {};
      if (action.materialKeyframes?.length) {
        const sampled = sampleMaterialKeyframes(action.materialKeyframes, time, action.interpolation);
        if (sampled) materials[objectId] = { ...base, ...sampled };
        return;
      }
      const active = isCinematicActionActive(action, time);
      const local = active ? cinematicActionLocalTime(action, time) : 1;
      materials[objectId] = {
        ...base,
        ...stripMaterialUndefined(mixMaterialOverrides(action.fromMaterial ?? base, action.toMaterial ?? action.fromMaterial ?? base, local)),
      };
    });
  return materials;
};

export const cinematicTimeScaleAt = (
  sequence: CinematicSequence | undefined,
  time: number,
  sequences?: CinematicSequence[],
): number => {
  const action = cinematicActionsAt(sequence, sequences, time)
    .filter((item) => item.type === 'timeDilation' && item.time <= time)
    .sort((a, b) => b.time - a.time)[0];
  if (!action) return 1;
  if (isCinematicActionActive(action, time)) {
    const from = action.fromTimeScale ?? action.timeScale ?? 1;
    const to = action.toTimeScale ?? action.timeScale ?? from;
    return Math.max(0.05, mix(from, to, cinematicActionLocalTime(action, time)));
  }
  return Math.max(0.05, action.toTimeScale ?? action.timeScale ?? 1);
};

/**
 * The text overlays (titles / subtitles / lower-thirds / credits) on screen at `time`, each with an
 * eased-in/out opacity. A beat fades up over the first ~0.4s of its `duration` and back out over the
 * last ~0.4s, holding solid in between. Multiple beats can overlap (e.g. a title + a credit line).
 */
export const cinematicTextAt = (
  sequence: CinematicSequence | undefined,
  time: number,
  sequences?: CinematicSequence[],
): RuntimeCinematicText[] =>
  cinematicActionsAt(sequence, sequences, time)
    .filter((action) => action.type === 'text' && action.text && isCinematicActionActive(action, time))
    .map((action) => {
      const duration = Math.max(action.duration ?? 0, 0.001);
      const fade = Math.min(0.4, duration / 2);
      const into = time - action.time;
      const toEnd = action.time + duration - time;
      const opacity = clamp01(Math.min(into / fade, toEnd / fade, 1));
      return {
        id: action.id,
        text: action.text ?? '',
        style: action.textStyle ?? 'subtitle',
        color: action.textColor ?? '#ffffff',
        opacity,
      };
    })
    .filter((entry) => entry.opacity > 0.001);

export const cinematicHiddenAt = (sequence: CinematicSequence | undefined, time: number, sequences?: CinematicSequence[]): string[] => {
  if (!sequence) return [];
  const hidden = new Set<string>();
  cinematicActionsAt(sequence, sequences, time)
    .filter((action) => action.type === 'visibility' && action.objectId && action.time <= time)
    .sort((a, b) => a.time - b.time)
    .forEach((action) => {
      if (!action.objectId) return;
      if (action.visible === false) hidden.add(action.objectId);
      else hidden.delete(action.objectId);
    });
  return [...hidden];
};
