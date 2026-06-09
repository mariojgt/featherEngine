import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import type { CinematicGrade, CinematicLook, RuntimeCinematicCamera, SceneObject, Vector3Tuple } from '../types';

export const STORYBOARD_PRESETS = ['three-shot-intro', 'orbit-reveal', 'gameplay-handoff', 'dramatic-reveal', 'product-turntable'] as const;
export type StoryboardPreset = (typeof STORYBOARD_PRESETS)[number];

export interface StoryboardCinematicOptions {
  name?: string;
  preset?: StoryboardPreset;
  subjectObjectId?: string;
  focusPoint?: Vector3Tuple;
  duration?: number;
  autoplay?: boolean;
  includeFades?: boolean;
  endEventName?: string;
  look?: Partial<CinematicLook>;
}

export interface StoryboardCinematicResult {
  cinematicId: string;
  preset: StoryboardPreset;
  subjectName?: string;
  focus: Vector3Tuple;
  actionCount: number;
}

const DEFAULT_LOOK: CinematicLook = {
  letterbox: 2.39,
  grade: 'warm',
  grain: 0.1,
  vignette: 0.25,
};

const PRESET_NAMES: Record<StoryboardPreset, string> = {
  'three-shot-intro': 'Three-Shot Intro',
  'orbit-reveal': 'Orbit Reveal',
  'gameplay-handoff': 'Gameplay Handoff',
  'dramatic-reveal': 'Dramatic Reveal',
  'product-turntable': 'Product Turntable',
};

const vec = (x: number, y: number, z: number): Vector3Tuple => [x, y, z];
const add = (a: Vector3Tuple, b: Vector3Tuple): Vector3Tuple => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vector3Tuple, b: Vector3Tuple): Vector3Tuple => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const length = (v: Vector3Tuple) => Math.hypot(v[0], v[1], v[2]);
const roundVec = (v: Vector3Tuple): Vector3Tuple => v.map((n) => Number(n.toFixed(3))) as Vector3Tuple;
const stripUndefined = <T extends object>(value: T): Partial<T> =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;

function isRenderableSubject(object: SceneObject) {
  return object.kind !== 'camera' && object.kind !== 'light' && object.kind !== 'empty' && object.kind !== 'terrain';
}

export function focusFromScene(objects: SceneObject[], subjectObjectId?: string, focusPoint?: Vector3Tuple) {
  const subject = subjectObjectId ? objects.find((object) => object.id === subjectObjectId) : undefined;
  if (focusPoint) return { focus: focusPoint, radius: 3, subject };
  if (subject) {
    const scale = subject.transform.scale;
    const radius = Math.max(1.5, Math.max(scale[0], scale[1], scale[2]) * 1.8);
    return {
      focus: add(subject.transform.position, vec(0, Math.max(0.5, scale[1] * 0.35), 0)),
      radius,
      subject,
    };
  }

  const renderables = objects.filter(isRenderableSubject);
  if (!renderables.length) return { focus: vec(0, 1, 0), radius: 4, subject: undefined };

  const min = vec(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
  const max = vec(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
  renderables.forEach((object) => {
    const p = object.transform.position;
    const s = object.transform.scale;
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], p[i] - s[i] * 0.5);
      max[i] = Math.max(max[i], p[i] + s[i] * 0.5);
    }
  });
  const focus = vec((min[0] + max[0]) * 0.5, Math.max(0.8, (min[1] + max[1]) * 0.5), (min[2] + max[2]) * 0.5);
  const radius = Math.max(3, Math.min(16, Math.hypot(max[0] - min[0], max[2] - min[2]) * 0.35));
  return { focus, radius, subject: undefined };
}

export function focusDistance(position: Vector3Tuple, focus: Vector3Tuple) {
  return Number(Math.max(0, length(sub(position, focus))).toFixed(2));
}

export { vec as storyboardVec, add as storyboardAdd, roundVec as storyboardRoundVec };

function addFadeBookends(cinematicId: string, duration: number) {
  const store = useEditorStore.getState();
  store.addCinematicAction(cinematicId, {
    type: 'fade',
    time: 0,
    duration: 1,
    label: 'Fade in',
    fadeFrom: 1,
    fadeTo: 0,
    fadeColor: '#05070B',
  });
  store.addCinematicAction(cinematicId, {
    type: 'fade',
    time: Math.max(0, duration - 1.15),
    duration: 1.15,
    label: 'Fade out',
    fadeFrom: 0,
    fadeTo: 1,
    fadeColor: '#05070B',
  });
}

function addEndEvent(cinematicId: string, duration: number, eventName?: string) {
  if (!eventName) return;
  useEditorStore.getState().addCinematicAction(cinematicId, {
    type: 'event',
    time: Math.max(0, duration - 0.25),
    label: `Fire ${eventName}`,
    eventName,
  });
}

function addThreeShotIntro(cinematicId: string, focus: Vector3Tuple, radius: number, duration: number) {
  const store = useEditorStore.getState();
  const r = Math.max(2.5, radius);
  const shots = [
    {
      time: 0,
      label: 'Shot 1 · Establishing',
      position: add(focus, vec(r * 2.8, r * 1.0, r * 2.6)),
      lookAt: focus,
      fov: 42,
      blend: 0,
      aperture: 0,
      duration: duration * 0.36,
    },
    {
      time: duration * 0.36,
      label: 'Shot 2 · Push in',
      position: add(focus, vec(r * 1.25, r * 0.45, r * 1.35)),
      lookAt: focus,
      fov: 36,
      blend: 0.8,
      aperture: 4.5,
      duration: duration * 0.32,
    },
    {
      time: duration * 0.68,
      label: 'Shot 3 · Reveal',
      position: add(focus, vec(-r * 0.95, r * 0.38, r * 1.15)),
      lookAt: add(focus, vec(0, r * 0.08, 0)),
      fov: 45,
      blend: 1.2,
      aperture: 3.5,
      duration: duration * 0.32,
    },
  ];

  shots.forEach((shot) => {
    store.addCinematicShot(cinematicId, {
      ...shot,
      time: Number(shot.time.toFixed(3)),
      duration: Number(Math.max(0.5, shot.duration).toFixed(3)),
      position: roundVec(shot.position),
      lookAt: roundVec(shot.lookAt),
      focusDistance: shot.aperture ? focusDistance(shot.position, shot.lookAt) : undefined,
    });
  });
}

function addOrbitReveal(cinematicId: string, focus: Vector3Tuple, radius: number, duration: number) {
  const store = useEditorStore.getState();
  const r = Math.max(3, radius * 1.6);
  const height = Math.max(1.8, radius * 0.65);
  const frames: RuntimeCinematicCamera[] = [
    { position: add(focus, vec(r, height, r)), lookAt: focus, fov: 44 },
    { position: add(focus, vec(-r * 0.7, height * 1.1, r * 1.05)), lookAt: focus, fov: 40 },
    { position: add(focus, vec(-r * 1.05, height * 0.82, -r * 0.55)), lookAt: focus, fov: 38 },
    { position: add(focus, vec(r * 0.35, height * 0.72, -r * 1.15)), lookAt: focus, fov: 42 },
  ].map((frame) => ({
    ...frame,
    position: roundVec(frame.position),
    lookAt: roundVec(frame.lookAt),
    focusDistance: focusDistance(frame.position, frame.lookAt),
    aperture: 4,
  }));
  store.addCinematicAction(cinematicId, {
    type: 'camera',
    time: 0,
    duration,
    label: 'Orbit reveal camera path',
    ease: 'smooth',
    keyframes: frames.map((frame, index) => ({
      ...frame,
      time: Number(((duration * index) / (frames.length - 1)).toFixed(3)),
    })),
  });
}

function addGameplayHandoff(cinematicId: string, focus: Vector3Tuple, radius: number, duration: number) {
  const store = useEditorStore.getState();
  const r = Math.max(2.5, radius);
  const shots = [
    {
      time: 0,
      label: 'Shot 1 · World setup',
      position: add(focus, vec(-r * 2.2, r * 0.9, r * 2.0)),
      lookAt: focus,
      fov: 46,
      blend: 0,
      aperture: 0,
      duration: duration * 0.34,
    },
    {
      time: duration * 0.34,
      label: 'Shot 2 · Objective',
      position: add(focus, vec(r * 0.8, r * 0.55, r * 1.25)),
      lookAt: add(focus, vec(0, r * 0.05, 0)),
      fov: 38,
      blend: 0.7,
      aperture: 4,
      duration: duration * 0.32,
    },
    {
      time: duration * 0.66,
      label: 'Shot 3 · Return to play',
      position: add(focus, vec(0, Math.max(1.8, r * 0.7), -Math.max(4.5, r * 2.1))),
      lookAt: add(focus, vec(0, r * 0.15, 0)),
      fov: 52,
      blend: 1.4,
      aperture: 1.5,
      duration: duration * 0.34,
    },
  ];

  shots.forEach((shot) => {
    store.addCinematicShot(cinematicId, {
      ...shot,
      time: Number(shot.time.toFixed(3)),
      duration: Number(Math.max(0.5, shot.duration).toFixed(3)),
      position: roundVec(shot.position),
      lookAt: roundVec(shot.lookAt),
      focusDistance: shot.aperture ? focusDistance(shot.position, shot.lookAt) : undefined,
    });
  });
}

// A low-angle hero hold that cranes up into a wide reveal — the classic "big moment" intro.
function addDramaticReveal(cinematicId: string, focus: Vector3Tuple, radius: number, duration: number) {
  const store = useEditorStore.getState();
  const r = Math.max(2.5, radius);
  store.addCinematicShot(cinematicId, {
    time: 0,
    duration: Number((duration * 0.42).toFixed(3)),
    label: 'Shot 1 · Low hero',
    position: roundVec(add(focus, vec(r * 0.7, -r * 0.2, r * 1.3))),
    lookAt: roundVec(add(focus, vec(0, r * 0.55, 0))),
    fov: 38,
    blend: 0,
    aperture: 3,
    focusDistance: focusDistance(add(focus, vec(r * 0.7, -r * 0.2, r * 1.3)), add(focus, vec(0, r * 0.55, 0))),
  });
  // Crane up + back into a wide reveal as a smooth keyframed move.
  const poses: RuntimeCinematicCamera[] = [
    { position: add(focus, vec(r * 0.7, r * 0.1, r * 1.4)), lookAt: add(focus, vec(0, r * 0.4, 0)), fov: 40, aperture: 2.5 },
    { position: add(focus, vec(r * 1.4, r * 1.8, r * 2.6)), lookAt: focus, fov: 46, aperture: 1.5 },
  ];
  store.addCinematicAction(cinematicId, {
    type: 'camera',
    time: Number((duration * 0.42).toFixed(3)),
    duration: Number((duration * 0.58).toFixed(3)),
    label: 'Shot 2 · Crane reveal',
    ease: 'smooth',
    blend: 1.2,
    keyframes: poses.map((pose, index) => ({
      position: roundVec(pose.position),
      lookAt: roundVec(pose.lookAt),
      fov: pose.fov,
      aperture: pose.aperture,
      focusDistance: focusDistance(pose.position, pose.lookAt),
      time: Number((duration * 0.42 + (duration * 0.58 * index) / Math.max(1, poses.length - 1)).toFixed(3)),
    })),
  });
}

// A full 360° turntable orbit — product/hero showcase.
function addProductTurntable(cinematicId: string, focus: Vector3Tuple, radius: number, duration: number) {
  const store = useEditorStore.getState();
  const r = Math.max(2.5, radius * 1.5);
  const height = Math.max(1.2, radius * 0.4);
  const count = 9; // 8 segments around the circle + the closing duplicate for a seamless loop
  const poses: RuntimeCinematicCamera[] = Array.from({ length: count }, (_, index) => {
    const angle = (index / (count - 1)) * Math.PI * 2;
    return {
      position: add(focus, vec(Math.sin(angle) * r, height, Math.cos(angle) * r)),
      lookAt: focus,
      fov: 40,
      aperture: 3,
    };
  });
  store.addCinematicAction(cinematicId, {
    type: 'camera',
    time: 0,
    duration,
    label: 'Turntable orbit',
    ease: 'linear',
    interpolation: 'smooth',
    keyframes: poses.map((pose, index) => ({
      position: roundVec(pose.position),
      lookAt: roundVec(pose.lookAt),
      fov: pose.fov,
      aperture: pose.aperture,
      focusDistance: focusDistance(pose.position, pose.lookAt),
      time: Number(((duration * index) / (count - 1)).toFixed(3)),
    })),
  });
}

export function createStoryboardCinematic(options: StoryboardCinematicOptions = {}): StoryboardCinematicResult | undefined {
  const store = useEditorStore.getState();
  const scene = store.activeScene();
  if (!scene) return undefined;

  const preset = options.preset ?? 'three-shot-intro';
  const duration = Math.max(3, options.duration ?? (preset === 'orbit-reveal' ? 8 : 9));
  const objects = selectActiveObjects(store);
  const { focus, radius, subject } = focusFromScene(objects, options.subjectObjectId, options.focusPoint);
  const cinematicId = store.createCinematic(options.name ?? PRESET_NAMES[preset], duration);
  store.updateCinematic(cinematicId, { autoplay: options.autoplay, skippable: true, duration });

  const look: CinematicLook = { ...DEFAULT_LOOK, ...stripUndefined(options.look ?? {}) };
  if (look.grade === undefined) look.grade = DEFAULT_LOOK.grade as CinematicGrade;
  store.setCinematicLook(cinematicId, look);

  if (options.includeFades !== false) addFadeBookends(cinematicId, duration);
  if (preset === 'orbit-reveal') addOrbitReveal(cinematicId, focus, radius, duration);
  else if (preset === 'gameplay-handoff') addGameplayHandoff(cinematicId, focus, radius, duration);
  else if (preset === 'dramatic-reveal') addDramaticReveal(cinematicId, focus, radius, duration);
  else if (preset === 'product-turntable') addProductTurntable(cinematicId, focus, radius, duration);
  else addThreeShotIntro(cinematicId, focus, radius, duration);
  addEndEvent(cinematicId, duration, options.endEventName);

  store.setActiveCinematic(cinematicId);
  if (subject) store.selectObject(subject.id);

  const actionCount = store.activeScene()?.cinematics?.find((cinematic) => cinematic.id === cinematicId)?.actions.length ?? 0;
  return { cinematicId, preset, subjectName: subject?.name, focus: roundVec(focus), actionCount };
}
