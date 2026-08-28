import type { StoreApi } from 'zustand';
import type { EditorState } from '../editorStore';
import type {
  CinematicAction,
  CinematicCameraKeyframe,
  CinematicLook,
  CinematicMarker,
  CinematicSequence,
  CinematicTransformKeyframe,
  RuntimeCinematicCamera,
  TransformComponent,
  Vector3Tuple,
} from '../../types';
import {
  cinematicCameraAt,
  cinematicFadeAt,
  cinematicHiddenAt,
  cinematicMaterialsAt,
  cinematicTextAt,
  cinematicTransformsAt,
  initialCinematicCamera,
  initialCinematicFade,
} from './cinematics';
import { makeId, stripUndefined } from './ids';
import { selectActiveObjects } from './storeHelpers';
import { worldToLocalUnderParent, worldTransformOf } from '../../utils/transformHierarchy';

type SetState = StoreApi<EditorState>['setState'];
type GetState = StoreApi<EditorState>['getState'];

/** Apply an editor patch while treating an explicitly-present `undefined` as "remove this field". */
const applyCinematicActionPatch = (
  action: CinematicAction,
  patch: Partial<Omit<CinematicAction, 'id'>>,
): CinematicAction => {
  const next = { ...action } as CinematicAction & Record<string, unknown>;
  Object.entries(patch).forEach(([key, value]) => {
    if (value === undefined) delete next[key];
    else next[key] = value;
  });
  next.id = action.id;
  next.time = Math.max(0, typeof patch.time === 'number' ? patch.time : action.time);
  return next;
};

/** Furthest authored time reached by a beat, including absolute key times beyond its clip span. */
const cinematicActionEndTime = (action: CinematicAction): number => Math.max(
  action.time + (action.duration ?? 0.1),
  ...(action.keyframes?.map((frame) => frame.time) ?? []),
  ...(action.transformKeyframes?.map((frame) => frame.time) ?? []),
  ...(action.materialKeyframes?.map((frame) => frame.time) ?? []),
);

export const applyCreateCinematic = (set: SetState, name = 'New Cinematic', duration = 8): string => {
  const id = makeId('cinematic');
  const sequence: CinematicSequence = {
    id,
    name,
    duration: Math.max(0.5, duration),
    frameRate: 24,
    skippable: true,
    actions: [],
    markers: [],
    createdAt: Date.now(),
  };
  set((state) => ({
    scenes: state.scenes.map((scene) =>
      scene.id === state.activeSceneId ? { ...scene, cinematics: [...(scene.cinematics ?? []), sequence] } : scene,
    ),
    activeCinematicId: id,
    isDirty: true,
  }));
  return id;
};

export const applyUpdateCinematic = (
  set: SetState,
  id: string,
  patch: Partial<Omit<CinematicSequence, 'id' | 'actions' | 'createdAt'>>,
): void => {
  set((state) => ({
    scenes: state.scenes.map((scene) => ({
      ...scene,
      cinematics: (scene.cinematics ?? []).map((cinematic) =>
        cinematic.id === id ? { ...cinematic, ...stripUndefined(patch), duration: Math.max(0.5, patch.duration ?? cinematic.duration) } : cinematic,
      ),
    })),
    isDirty: true,
  }));
};

export const applyDuplicateCinematicTake = (set: SetState, get: GetState, id: string): string | undefined => {
  const source = get().activeScene()?.cinematics?.find((cinematic) => cinematic.id === id);
  if (!source) return undefined;
  const takeNumber =
    Math.max(0, ...(get().activeScene()?.cinematics ?? []).filter((cinematic) => (cinematic.takeOf ?? cinematic.id) === (source.takeOf ?? source.id)).map((cinematic) => cinematic.takeNumber ?? 0)) + 1;
  const nextId = makeId('cinematic');
  const next: CinematicSequence = {
    ...source,
    id: nextId,
    name: `${source.name} Take ${takeNumber}`,
    takeOf: source.takeOf ?? source.id,
    takeNumber,
    actions: source.actions.map((action) => ({ ...action, id: makeId('caction') })),
    markers: (source.markers ?? []).map((marker) => ({ ...marker, id: makeId('cmark') })),
    createdAt: Date.now(),
  };
  set((state) => ({
    scenes: state.scenes.map((scene) =>
      scene.id === state.activeSceneId ? { ...scene, cinematics: [...(scene.cinematics ?? []), next] } : scene,
    ),
    activeCinematicId: nextId,
    isDirty: true,
  }));
  return nextId;
};

export const applyAddCinematicMarker = (
  set: SetState,
  get: GetState,
  cinematicId: string,
  marker: { time: number; label?: string; color?: string; determinismFence?: boolean },
): string | undefined => {
  const id = makeId('cmark');
  set((state) => ({
    scenes: state.scenes.map((scene) => ({
      ...scene,
      cinematics: (scene.cinematics ?? []).map((cinematic) =>
        cinematic.id === cinematicId
          ? {
              ...cinematic,
              markers: [
                ...(cinematic.markers ?? []),
                { id, time: Math.max(0, marker.time), label: marker.label?.trim() || `Marker ${(cinematic.markers?.length ?? 0) + 1}`, color: marker.color, determinismFence: marker.determinismFence },
              ].sort((a, b) => a.time - b.time),
            }
          : cinematic,
      ),
    })),
    isDirty: true,
  }));
  return get().activeScene()?.cinematics?.some((cinematic) => cinematic.id === cinematicId) ? id : undefined;
};

export const applyUpdateCinematicMarker = (
  set: SetState,
  cinematicId: string,
  markerId: string,
  patch: Partial<Omit<CinematicMarker, 'id'>>,
): void => {
  set((state) => ({
    scenes: state.scenes.map((scene) => ({
      ...scene,
      cinematics: (scene.cinematics ?? []).map((cinematic) =>
        cinematic.id === cinematicId
          ? {
              ...cinematic,
              markers: (cinematic.markers ?? [])
                .map((marker) => (marker.id === markerId ? { ...marker, ...stripUndefined(patch), time: Math.max(0, patch.time ?? marker.time) } : marker))
                .sort((a, b) => a.time - b.time),
            }
          : cinematic,
      ),
    })),
    isDirty: true,
  }));
};

export const applyRemoveCinematicMarker = (set: SetState, cinematicId: string, markerId: string): void => {
  set((state) => ({
    scenes: state.scenes.map((scene) => ({
      ...scene,
      cinematics: (scene.cinematics ?? []).map((cinematic) =>
        cinematic.id === cinematicId ? { ...cinematic, markers: (cinematic.markers ?? []).filter((marker) => marker.id !== markerId) } : cinematic,
      ),
    })),
    isDirty: true,
  }));
};

export const applySetCinematicLook = (set: SetState, id: string, patch: Partial<CinematicLook>): void => {
  set((state) => {
    let nextLook: CinematicLook | undefined;
    const scenes = state.scenes.map((scene) => ({
      ...scene,
      cinematics: (scene.cinematics ?? []).map((cinematic) => {
        if (cinematic.id !== id) return cinematic;
        const merged = stripUndefined({ ...(cinematic.look ?? {}), ...patch }) as CinematicLook;
        nextLook = merged;
        return { ...cinematic, look: merged };
      }),
    }));
    return {
      scenes,
      // Live-update the active runtime/preview look so the overlay reflects edits immediately.
      runtimeCinematicLook: state.runtimeCinematic?.sequenceId === id ? nextLook : state.runtimeCinematicLook,
      editorCinematicPreviewLook: state.editorCinematicPreview?.sequenceId === id ? nextLook : state.editorCinematicPreviewLook,
      isDirty: true,
    };
  });
};

export const applyDeleteCinematic = (set: SetState, id: string): void => {
  set((state) => ({
    scenes: state.scenes.map((scene) => ({
      ...scene,
      cinematics: (scene.cinematics ?? []).filter((cinematic) => cinematic.id !== id),
    })),
    activeCinematicId: state.activeCinematicId === id ? '' : state.activeCinematicId,
    runtimeCinematic: state.runtimeCinematic?.sequenceId === id ? undefined : state.runtimeCinematic,
    runtimeCinematicCamera: state.runtimeCinematic?.sequenceId === id ? undefined : state.runtimeCinematicCamera,
    runtimeCinematicFade: state.runtimeCinematic?.sequenceId === id ? undefined : state.runtimeCinematicFade,
    runtimeCinematicLook: state.runtimeCinematic?.sequenceId === id ? undefined : state.runtimeCinematicLook,
    editorCinematicPreview: state.editorCinematicPreview?.sequenceId === id ? undefined : state.editorCinematicPreview,
    editorCinematicPreviewCamera: state.editorCinematicPreview?.sequenceId === id ? undefined : state.editorCinematicPreviewCamera,
    editorCinematicPreviewFade: state.editorCinematicPreview?.sequenceId === id ? undefined : state.editorCinematicPreviewFade,
    editorCinematicPreviewLook: state.editorCinematicPreview?.sequenceId === id ? undefined : state.editorCinematicPreviewLook,
    editorCinematicPreviewTransforms: state.editorCinematicPreview?.sequenceId === id ? {} : state.editorCinematicPreviewTransforms,
    editorCinematicPreviewHidden: state.editorCinematicPreview?.sequenceId === id ? [] : state.editorCinematicPreviewHidden,
    editorCinematicPreviewMaterials: state.editorCinematicPreview?.sequenceId === id ? {} : state.editorCinematicPreviewMaterials,
    isDirty: true,
  }));
};

export const applySetActiveCinematic = (set: SetState, id: string): void => {
  set((state) =>
    state.editorCinematicPreview && state.editorCinematicPreview.sequenceId !== id
        ? {
          activeCinematicId: id,
          selectedCinematicKeyframe: undefined,
          cinematicViewportMode: 'edit' as const,
          editorCinematicPreview: undefined,
          editorCinematicPreviewCamera: undefined,
          editorCinematicPreviewFade: undefined,
          editorCinematicPreviewTransforms: {},
          editorCinematicPreviewHidden: [],
          editorCinematicPreviewMaterials: {},
        }
        : { activeCinematicId: id, selectedCinematicKeyframe: undefined, cinematicViewportMode: 'edit' as const },
  );
};

export const applyAddCinematicAction = (
  set: SetState,
  get: GetState,
  cinematicId: string,
  action: Omit<CinematicAction, 'id'>,
): string | undefined => {
  const actionId = makeId('caction');
  set((state) => {
    let found = false;
    const scenes = state.scenes.map((scene) => ({
      ...scene,
      cinematics: (scene.cinematics ?? []).map((cinematic) => {
        if (cinematic.id !== cinematicId) return cinematic;
        found = true;
        const nextAction: CinematicAction = { ...action, id: actionId, time: Math.max(0, action.time) };
        const actions = [...cinematic.actions, nextAction].sort((a, b) => a.time - b.time);
        const duration = Math.max(cinematic.duration, cinematicActionEndTime(nextAction));
        return { ...cinematic, actions, duration };
      }),
    }));
    return found ? { scenes, isDirty: true } : state;
  });
  return get().activeScene()?.cinematics?.some((cinematic) => cinematic.id === cinematicId) ? actionId : undefined;
};

export const applyUpdateCinematicAction = (
  set: SetState,
  cinematicId: string,
  actionId: string,
  patch: Partial<Omit<CinematicAction, 'id'>>,
): void => {
  set((state) => ({
    scenes: state.scenes.map((scene) => ({
      ...scene,
      cinematics: (scene.cinematics ?? []).map((cinematic) => {
        if (cinematic.id !== cinematicId) return cinematic;
        const actions = cinematic.actions
          .map((action) => (action.id === actionId ? applyCinematicActionPatch(action, patch) : action))
          .sort((a, b) => a.time - b.time);
        return {
          ...cinematic,
          actions,
          duration: Math.max(cinematic.duration, ...actions.map(cinematicActionEndTime)),
        };
      }),
    })),
    isDirty: true,
  }));
};

export const applyRemoveCinematicAction = (set: SetState, cinematicId: string, actionId: string): void => {
  set((state) => ({
    scenes: state.scenes.map((scene) => ({
      ...scene,
      cinematics: (scene.cinematics ?? []).map((cinematic) =>
        cinematic.id === cinematicId ? { ...cinematic, actions: cinematic.actions.filter((action) => action.id !== actionId) } : cinematic,
      ),
    })),
    isDirty: true,
  }));
};

export const applyAddCinematicShot = (
  set: SetState,
  get: GetState,
  cinematicId: string,
  shot: { time: number; label?: string; duration?: number; position: Vector3Tuple; lookAt: Vector3Tuple; fov?: number; blend?: number; focusDistance?: number; aperture?: number },
): string | undefined => {
  const cinematic = get().activeScene()?.cinematics?.find((item) => item.id === cinematicId);
  if (!cinematic) return undefined;
  const shotCount = cinematic.actions.filter((action) => action.type === 'camera').length;
  const time = Number(Math.max(0, shot.time).toFixed(3));
  return get().addCinematicAction(cinematicId, {
    type: 'camera',
    time,
    duration: Math.max(0.5, shot.duration ?? Math.max(1.5, cinematic.duration - time)),
    label: shot.label ?? `Shot ${shotCount + 1}`,
    ease: 'smooth',
    position: [...shot.position],
    lookAt: [...shot.lookAt],
    fov: shot.fov ?? 50,
    // Shot-list editing defaults to hard cuts. Set blend > 0 for a deliberate smooth camera blend.
    blend: shot.blend ?? 0,
    focusDistance: shot.focusDistance,
    aperture: shot.aperture,
  });
};

export const applyAddCinematicTransition = (
  set: SetState,
  get: GetState,
  cinematicId: string,
  opts: { time?: number; duration?: number; style: 'cut' | 'crossfade' | 'fade' | 'flash' | 'wipe'; color?: string; direction?: 'left' | 'right' | 'up' | 'down' },
): string | undefined => {
  const cinematic = get().activeScene()?.cinematics?.find((item) => item.id === cinematicId);
  if (!cinematic) return undefined;
  const time = Math.max(0, opts.time ?? 0);
  const duration = Math.max(0.05, opts.duration ?? 0.6);
  // cut / crossfade are camera-blend operations on the INCOMING shot (the one at/after the playhead).
  if (opts.style === 'cut' || opts.style === 'crossfade') {
    const cams = cinematic.actions.filter((action) => action.type === 'camera').sort((a, b) => a.time - b.time);
    if (!cams.length) return undefined;
    const incoming = cams.find((cam) => cam.time >= time - 0.001) ?? cams[cams.length - 1];
    get().updateCinematicAction(cinematicId, incoming.id, { blend: opts.style === 'crossfade' ? duration : 0 });
    return incoming.id;
  }
  // fade / flash / wipe are full-frame dip overlays centered on the cut point.
  const color = opts.style === 'flash' ? '#ffffff' : opts.color ?? '#000000';
  const label = opts.style === 'wipe' ? 'Wipe' : opts.style === 'flash' ? 'Flash' : 'Fade transition';
  return get().addCinematicAction(cinematicId, {
    type: 'fade',
    time: Math.max(0, time - duration / 2),
    duration,
    label,
    fadeFrom: 0,
    fadeTo: 1,
    fadeColor: color,
    fadeDip: true,
    fadeWipe: opts.style === 'wipe' ? opts.direction ?? 'right' : undefined,
    ease: 'smooth',
  });
};

export const applyAddCinematicCameraKeyframe = (
  set: SetState,
  get: GetState,
  cinematicId: string,
  time: number,
  pose: RuntimeCinematicCamera,
  targetActionId?: string,
): string | undefined => {
  const cinematic = get().activeScene()?.cinematics?.find((item) => item.id === cinematicId);
  if (!cinematic) return undefined;
  const frame: CinematicCameraKeyframe = {
    time: Number(Math.max(0, time).toFixed(3)),
    position: [...pose.position],
    lookAt: [...pose.lookAt],
    fov: Math.round(pose.fov),
    focusDistance: pose.focusDistance,
    aperture: pose.aperture,
  };
  const requestedTrack = targetActionId ? cinematic.actions.find((action) => action.id === targetActionId && action.type === 'camera') : undefined;
  if (targetActionId && !requestedTrack) return undefined;
  const track = requestedTrack ?? cinematic.actions.find((action) => action.type === 'camera' && action.keyframes?.length);
  let actionId = track?.id;
  if (!track) {
    actionId = get().addCinematicAction(cinematicId, { type: 'camera', time: frame.time, duration: 0.5, label: 'Camera track', ease: 'smooth', keyframes: [frame] });
  }
  if (!actionId) return undefined;
  const existing = track?.keyframes ?? [frame];
  const frameRate = Math.max(1, cinematic.frameRate ?? 24);
  const merged = [...existing.filter((keyframe) => Math.round(keyframe.time * frameRate) !== Math.round(frame.time * frameRate)), frame].sort((a, b) => a.time - b.time);
  const minTime = Math.min(0, ...merged.map((keyframe) => keyframe.time));
  const maxTime = Math.max(0.5, ...merged.map((keyframe) => keyframe.time));
  get().updateCinematicAction(cinematicId, actionId, { keyframes: merged, time: minTime, duration: Math.max(0.5, maxTime - minTime) });
  const preview = get().editorCinematicPreview;
  if (preview?.sequenceId === cinematicId) get().previewCinematic(cinematicId, preview.time);
  return actionId;
};

export const applyAddCinematicTransformKeyframe = (
  set: SetState,
  get: GetState,
  cinematicId: string,
  objectId: string,
  time: number,
  transform?: TransformComponent,
  targetActionId?: string,
): string | undefined => {
  const cinematic = get().activeScene()?.cinematics?.find((item) => item.id === cinematicId);
  if (!cinematic) return undefined;
  const object = selectActiveObjects(get()).find((item) => item.id === objectId);
  // Never create a dangling timeline binding, even when a caller supplies an explicit pose.
  // Object-track pickers and scripting integrations can therefore treat an undefined result as a
  // clean rejected add rather than leaving a permanently broken "Missing Object" row.
  if (!object) return undefined;
  const pose = transform ?? object?.transform;
  if (!pose) return undefined;
  const frame: CinematicTransformKeyframe = {
    time: Number(Math.max(0, time).toFixed(3)),
    position: [...pose.position],
    rotation: [...pose.rotation],
    scale: [...pose.scale],
  };
  const requestedTrack = targetActionId
    ? cinematic.actions.find((action) => action.id === targetActionId && action.type === 'transform' && action.objectId === objectId)
    : undefined;
  if (targetActionId && !requestedTrack) return undefined;
  const track =
    requestedTrack ??
    cinematic.actions.find((action) => action.type === 'transform' && action.objectId === objectId && action.transformKeyframes?.length) ??
    // A legacy from→to transform beat is already this object's binding. Reuse and upgrade it
    // instead of silently creating a second Object row/action when the first key is added.
    cinematic.actions.find((action) => action.type === 'transform' && action.objectId === objectId);
  let actionId = track?.id;
  if (!track) {
    actionId = get().addCinematicAction(cinematicId, {
      type: 'transform',
      objectId,
      time: frame.time,
      duration: 0.5,
      label: `Animate ${object?.name ?? 'object'}`,
      ease: 'smooth',
      transformKeyframes: [frame],
    });
  }
  if (!actionId) return undefined;
  const existing = track?.transformKeyframes ?? [frame];
  const frameRate = Math.max(1, cinematic.frameRate ?? 24);
  const merged = [...existing.filter((keyframe) => Math.round(keyframe.time * frameRate) !== Math.round(frame.time * frameRate)), frame].sort((a, b) => a.time - b.time);
  const minTime = Math.min(0, ...merged.map((keyframe) => keyframe.time));
  const maxTime = Math.max(0.5, ...merged.map((keyframe) => keyframe.time));
  get().updateCinematicAction(cinematicId, actionId, { transformKeyframes: merged, time: minTime, duration: Math.max(0.5, maxTime - minTime) });
  const preview = get().editorCinematicPreview;
  if (preview?.sequenceId === cinematicId) get().previewCinematic(cinematicId, preview.time);
  return actionId;
};

export const applySetCinematicRecording = (set: SetState, get: GetState, recording: boolean): void => {
  set((state) => {
    if (!recording) return { cinematicRecording: false };
    // Turning Record on implies an active preview so the playhead has a position to key against.
    const cinematicId = state.activeCinematicId || state.scenes.find((scene) => scene.id === state.activeSceneId)?.cinematics?.[0]?.id;
    if (cinematicId && !state.editorCinematicPreview) {
      queueMicrotask(() => get().previewCinematic(cinematicId, 0));
    }
    return { cinematicRecording: true, playtimeCameraRecording: false, cinematicViewportMode: 'edit' as const };
  });
};

export const applySetCinematicViewportMode = (set: SetState, mode: 'edit' | 'camera'): void => {
  set({ cinematicViewportMode: mode });
};

export const applySetCinematicPathMode = (set: SetState, mode: 'all' | 'selected' | 'off'): void => {
  set({ cinematicPathMode: mode });
};

export const applySetPlaytimeCameraRecording = (set: SetState, recording: boolean): void => {
  set((state) =>
    state.playtimeCameraSession
      ? state
      : {
          playtimeCameraRecording: recording,
          // The two recording modes are deliberately exclusive: one keys editor manipulation,
          // the other possesses the runtime camera during Play.
          cinematicRecording: recording ? false : state.cinematicRecording,
        },
  );
};

export const applyRecordPlaytimeCameraSample = (
  set: SetState,
  sample: CinematicCameraKeyframe,
): void => {
  set((state) => {
    const session = state.playtimeCameraSession;
    if (!session || !Number.isFinite(sample.time)) return state;
    const clean: CinematicCameraKeyframe = {
      time: Number(Math.max(0, sample.time).toFixed(3)),
      position: [...sample.position],
      lookAt: [...sample.lookAt],
      fov: Math.min(140, Math.max(10, sample.fov)),
      focusDistance: sample.focusDistance,
      aperture: sample.aperture,
    };
    const last = session.samples[session.samples.length - 1];
    const samples = last && Math.abs(last.time - clean.time) < 0.01
      ? [...session.samples.slice(0, -1), clean]
      : [...session.samples, clean];
    return { playtimeCameraSession: { ...session, samples } };
  });
};

export const applySelectCinematicKeyframe = (
  set: SetState,
  get: GetState,
  actionId: string | null,
  index?: number,
): void => {
  if (!actionId || index == null) {
    set({ selectedCinematicKeyframe: undefined });
    return;
  }
  set({ selectedCinematicKeyframe: { actionId, index }, cinematicViewportMode: 'edit' });
  // Pose the scene at this keyframe's time so editing it shows the right moment.
  const cinematic = get().activeScene()?.cinematics?.find((item) => item.actions.some((action) => action.id === actionId));
  const action = cinematic?.actions.find((item) => item.id === actionId);
  // index -1 = a STATIC camera shot (no keyframes array); pose the scene at the shot's own start time.
  if (cinematic && index === -1 && action) {
    get().previewCinematic(cinematic.id, action.time);
    return;
  }
  const frame = action?.type === 'camera' ? action.keyframes?.[index] : action?.type === 'transform' ? action.transformKeyframes?.[index] : undefined;
  if (cinematic && frame) get().previewCinematic(cinematic.id, frame.time);
};

export const applyMoveCinematicKeyframe = (
  set: SetState,
  get: GetState,
  actionId: string,
  index: number,
  position: Vector3Tuple,
): void => {
  const cinematic = get().activeScene()?.cinematics?.find((item) => item.actions.some((action) => action.id === actionId));
  const action = cinematic?.actions.find((item) => item.id === actionId);
  if (!cinematic || !action) return;
  if (index === -1 && action.type === 'camera') {
    // Static shot: move the shot's own framing position.
    get().updateCinematicAction(cinematic.id, actionId, { position });
  } else if (action.type === 'camera' && action.keyframes?.[index]) {
    const keyframes = action.keyframes.map((keyframe, i) => (i === index ? { ...keyframe, position } : keyframe));
    get().updateCinematicAction(cinematic.id, actionId, { keyframes });
  } else if (action.type === 'transform' && action.transformKeyframes?.[index]) {
    const scene = get().activeScene();
    const object = scene?.objects.find((item) => item.id === action.objectId);
    const frame = action.transformKeyframes[index];
    if (!scene || !object || !frame) return;
    // Track values are local to the object's parent, while viewport handles live at the scene root.
    // Pose the hierarchy at this key's time, move in world space, then convert back under the parent.
    const overrides = cinematicTransformsAt(cinematic, scene.objects, frame.time, scene.cinematics);
    const posedObjects = scene.objects.map((item) => (overrides[item.id] ? { ...item, transform: overrides[item.id] } : item));
    const desiredWorld = { ...worldTransformOf(posedObjects, object.id), position };
    const local = worldToLocalUnderParent(posedObjects, desiredWorld, object.parentId);
    const transformKeyframes = action.transformKeyframes.map((keyframe, i) => (i === index ? { ...keyframe, position: local.position } : keyframe));
    get().updateCinematicAction(cinematic.id, actionId, { transformKeyframes });
  } else {
    return;
  }
  const preview = get().editorCinematicPreview;
  if (preview?.sequenceId === cinematic.id) get().previewCinematic(cinematic.id, preview.time);
};

export const applyAimCinematicKeyframe = (
  set: SetState,
  get: GetState,
  actionId: string,
  index: number,
  lookAt: Vector3Tuple,
): void => {
  const cinematic = get().activeScene()?.cinematics?.find((item) => item.actions.some((action) => action.id === actionId));
  const action = cinematic?.actions.find((item) => item.id === actionId);
  if (!cinematic || action?.type !== 'camera') return;
  if (index === -1) {
    // Static shot: re-aim the shot's own framing.
    get().updateCinematicAction(cinematic.id, actionId, { lookAt });
    const preview = get().editorCinematicPreview;
    if (preview?.sequenceId === cinematic.id) get().previewCinematic(cinematic.id, preview.time);
    return;
  }
  if (!action.keyframes?.[index]) return;
  const keyframes = action.keyframes.map((keyframe, i) => (i === index ? { ...keyframe, lookAt } : keyframe));
  get().updateCinematicAction(cinematic.id, actionId, { keyframes });
  const preview = get().editorCinematicPreview;
  if (preview?.sequenceId === cinematic.id) get().previewCinematic(cinematic.id, preview.time);
};

export const applyPreviewCinematic = (set: SetState, cinematicId: string, time: number): void => {
  set((state) => {
    if (state.isPlaying) return state;
    const scene = state.scenes.find((item) => item.id === state.activeSceneId);
    const sequence = scene?.cinematics?.find((cinematic) => cinematic.id === cinematicId);
    if (!sequence) return state;
    const previewTime = Math.min(Math.max(time, 0), sequence.duration);
    const objects = scene?.objects ?? [];
    const sequences = scene?.cinematics ?? [];
    return {
      editorCinematicPreview: { sequenceId: cinematicId, time: previewTime },
      editorCinematicPreviewCamera: cinematicCameraAt(sequence, objects, previewTime, undefined, sequences),
      editorCinematicPreviewFade: cinematicFadeAt(sequence, previewTime, undefined, sequences),
      editorCinematicPreviewLook: sequence.look,
      editorCinematicPreviewText: cinematicTextAt(sequence, previewTime, sequences),
      editorCinematicPreviewTransforms: cinematicTransformsAt(sequence, objects, previewTime, sequences),
      editorCinematicPreviewHidden: cinematicHiddenAt(sequence, previewTime, sequences),
      editorCinematicPreviewMaterials: cinematicMaterialsAt(sequence, objects, previewTime, sequences),
    };
  });
};

export const applyClearCinematicPreview = (set: SetState): void => {
  set((state) =>
    state.editorCinematicPreview || state.selectedCinematicKeyframe
      ? {
          editorCinematicPreview: undefined,
          editorCinematicPreviewCamera: undefined,
          editorCinematicPreviewFade: undefined,
          editorCinematicPreviewLook: undefined,
          editorCinematicPreviewText: undefined,
          editorCinematicPreviewTransforms: {},
          editorCinematicPreviewHidden: [],
          editorCinematicPreviewMaterials: {},
          selectedCinematicKeyframe: undefined,
          cinematicViewportMode: 'edit' as const,
        }
      : state,
  );
};

export const applyPlayCinematic = (set: SetState, get: GetState, cinematicId: string): void => {
  const current = get();
  if (!current.isPlaying) {
    current.setPlaying(true);
    if (!get().isPlaying) return;
  }

  set((state) => {
    const scene = state.scenes.find((item) => item.id === state.activeSceneId);
    const sequence = scene?.cinematics?.find((cinematic) => cinematic.id === cinematicId);
    if (!sequence) return state;
    const sequences = scene?.cinematics ?? [];
    return {
      runtimeCinematic: { sequenceId: cinematicId, time: 0, firedActionIds: [], spawnedObjectIds: [] },
      runtimeCinematicCamera: initialCinematicCamera(sequence, scene?.objects ?? [], sequences),
      runtimeCinematicFade: initialCinematicFade(sequence, sequences),
      runtimeCinematicLook: sequence.look,
      runtimeCinematicText: cinematicTextAt(sequence, 0, sequences),
      playtimeCameraSession: state.playtimeCameraRecording
        ? { sequenceId: cinematicId, samples: [] }
        : undefined,
      cinematicRecording: state.playtimeCameraRecording ? false : state.cinematicRecording,
    };
  });
};

export const applyStopCinematic = (set: SetState): void => {
  set((state) => {
    const spawnedIds = new Set(state.runtimeCinematic?.spawnedObjectIds ?? []);
    return {
      scenes: spawnedIds.size
        ? state.scenes.map((scene) => (scene.id === state.activeSceneId ? { ...scene, objects: scene.objects.filter((object) => !spawnedIds.has(object.id)) } : scene))
        : state.scenes,
      runtimeCinematic: undefined,
      runtimeCinematicCamera: undefined,
      runtimeCinematicFade: undefined,
      runtimeCinematicLook: undefined,
      runtimeCinematicText: undefined,
    };
  });
};
