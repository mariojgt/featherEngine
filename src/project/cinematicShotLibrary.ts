import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import type { RuntimeCinematicCamera, Vector3Tuple } from '../types';
import { focusFromScene, focusDistance, storyboardVec as vec, storyboardAdd as add, storyboardRoundVec as roundVec } from './cinematicStoryboard';

/**
 * Drag-in prebuilt camera shots — the fast way to assemble a sequence without hand-keying. Each entry adds
 * one shot (a static framing or a short keyframed move) to an EXISTING cinematic, automatically framed on the
 * selected object (or the scene's overall bounds), at a given time. Mirrors the storyboard helper's geometry
 * (focus point + radius from the subject's scale) so library shots and storyboard presets look consistent.
 */
export const SHOT_LIBRARY = [
  { id: 'wide', label: 'Wide', description: 'Static establishing shot, pulled back to frame the whole subject.' },
  { id: 'closeup', label: 'Close-up', description: 'Tight static shot with shallow depth of field on the subject.' },
  { id: 'dolly-in', label: 'Dolly in', description: 'Smooth push from medium distance into a close framing.' },
  { id: 'orbit', label: 'Orbit', description: 'A 3/4 arc gliding around the subject.' },
  { id: 'crane-up', label: 'Crane up', description: 'Rises from low to high while holding on the subject.' },
  { id: 'whip-pan', label: 'Whip pan', description: 'A fast lateral swing that blurs past the subject (pairs with motion blur).' },
  { id: 'low-angle', label: 'Low hero', description: 'Static low-angle shot looking up at the subject for a heroic feel.' },
] as const;

export type ShotLibraryType = (typeof SHOT_LIBRARY)[number]['id'];

export interface AddLibraryShotOptions {
  cinematicId: string;
  shotType: ShotLibraryType;
  subjectObjectId?: string;
  focusPoint?: Vector3Tuple;
  time?: number;
  duration?: number;
}

/** Build keyframes (absolute sequence times) from poses spread evenly across [time, time+duration]. */
const keyframeTrack = (poses: RuntimeCinematicCamera[], time: number, duration: number) =>
  poses.map((pose, index) => ({
    ...pose,
    position: roundVec(pose.position),
    lookAt: roundVec(pose.lookAt),
    focusDistance: pose.focusDistance ?? focusDistance(pose.position, pose.lookAt),
    time: Number((time + (duration * index) / Math.max(1, poses.length - 1)).toFixed(3)),
  }));

/** Add one prebuilt shot to a cinematic, framed on the subject/scene. Returns the new action id. */
export function addLibraryShot(options: AddLibraryShotOptions): string | undefined {
  const store = useEditorStore.getState();
  const cinematic = store.activeScene()?.cinematics?.find((item) => item.id === options.cinematicId);
  if (!cinematic) return undefined;
  const objects = selectActiveObjects(store);
  const { focus, radius: r0 } = focusFromScene(objects, options.subjectObjectId, options.focusPoint);
  const r = Math.max(2.5, r0);
  const time = Number(Math.max(0, options.time ?? 0).toFixed(3));

  const staticShot = (label: string, position: Vector3Tuple, lookAt: Vector3Tuple, fov: number, aperture: number, duration: number) =>
    store.addCinematicShot(options.cinematicId, {
      time,
      duration: Number(Math.max(0.5, duration).toFixed(3)),
      label,
      position: roundVec(position),
      lookAt: roundVec(lookAt),
      fov,
      blend: 0,
      aperture: aperture || undefined,
      focusDistance: aperture ? focusDistance(position, lookAt) : undefined,
    });

  const moveShot = (label: string, poses: RuntimeCinematicCamera[], duration: number, ease: 'smooth' | 'linear' = 'smooth') =>
    store.addCinematicAction(options.cinematicId, {
      type: 'camera',
      time,
      duration: Number(Math.max(0.3, duration).toFixed(3)),
      label,
      ease,
      interpolation: ease === 'linear' ? 'linear' : 'smooth',
      keyframes: keyframeTrack(poses, time, duration),
    });

  const dur = options.duration;
  switch (options.shotType) {
    case 'wide':
      return staticShot('Wide', add(focus, vec(r * 2.6, r * 1.1, r * 2.6)), focus, 44, 0, dur ?? 4);
    case 'closeup':
      return staticShot('Close-up', add(focus, vec(r * 0.9, r * 0.25, r * 1.0)), add(focus, vec(0, r * 0.05, 0)), 34, 4.5, dur ?? 3);
    case 'low-angle':
      return staticShot('Low hero', add(focus, vec(r * 0.6, -r * 0.15, r * 1.2)), add(focus, vec(0, r * 0.5, 0)), 38, 2.5, dur ?? 3);
    case 'dolly-in':
      return moveShot('Dolly in', [
        { position: add(focus, vec(r * 1.6, r * 0.5, r * 2.0)), lookAt: focus, fov: 40, aperture: 3 },
        { position: add(focus, vec(r * 0.7, r * 0.28, r * 0.95)), lookAt: focus, fov: 40, aperture: 4.5 },
      ], dur ?? 4);
    case 'crane-up':
      return moveShot('Crane up', [
        { position: add(focus, vec(r * 0.3, r * 0.15, r * 1.8)), lookAt: focus, fov: 42, aperture: 2 },
        { position: add(focus, vec(r * 0.3, r * 1.9, r * 1.6)), lookAt: add(focus, vec(0, r * 0.1, 0)), fov: 46, aperture: 2 },
      ], dur ?? 5);
    case 'whip-pan':
      return moveShot('Whip pan', [
        { position: add(focus, vec(-r * 1.4, r * 0.5, r * 1.6)), lookAt: add(focus, vec(-r * 1.5, r * 0.4, 0)), fov: 50 },
        { position: add(focus, vec(r * 1.4, r * 0.5, r * 1.6)), lookAt: add(focus, vec(r * 1.5, r * 0.4, 0)), fov: 50 },
      ], dur ?? 0.7, 'linear');
    case 'orbit':
    default:
      return moveShot('Orbit', [
        { position: add(focus, vec(r * 1.7, r * 0.7, r * 1.7)), lookAt: focus, fov: 42, aperture: 3.5 },
        { position: add(focus, vec(-r * 1.2, r * 0.85, r * 1.4)), lookAt: focus, fov: 40, aperture: 3.5 },
        { position: add(focus, vec(-r * 1.8, r * 0.7, -r * 0.6)), lookAt: focus, fov: 40, aperture: 3.5 },
      ], dur ?? 6);
  }
}
