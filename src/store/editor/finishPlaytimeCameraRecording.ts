import type { StoreApi } from 'zustand';
import type { EditorState } from '../editorStore';
import type { CinematicAction, CinematicSequence, Vector3Tuple } from '../../types';
import { makeId } from './ids';

/** Commit a live playtime camera recording as a new cinematic take, then exit Play. */
export const applyFinishPlaytimeCameraRecording = (
  set: StoreApi<EditorState>['setState'],
  get: StoreApi<EditorState>['getState'],
): void => {

    const current = get();
    if (!current.playtimeCameraSession) return;
    // Restore the pristine Play snapshot first. The take is committed in the next microtask so it is
    // a normal undoable editor edit, never mixed into transient gameplay state.
    if (current.isPlaying) {
      current.setPlaying(false);
      queueMicrotask(() => get().finishPlaytimeCameraRecording());
      return;
    }

    set((state) => {
      const session = state.playtimeCameraSession;
      if (!session) return state;
      const scene = state.scenes.find((item) => item.id === state.activeSceneId);
      const source = scene?.cinematics?.find((item) => item.id === session.sequenceId);
      if (!scene || !source || session.samples.length === 0) {
        return { playtimeCameraSession: undefined, playtimeCameraRecording: false };
      }

      const samples = session.samples
        .filter((sample) => Number.isFinite(sample.time))
        .sort((a, b) => a.time - b.time)
        .filter((sample, index, all) => index === 0 || sample.time - all[index - 1].time >= 0.02)
        .map((sample) => ({
          ...sample,
          position: [...sample.position] as Vector3Tuple,
          lookAt: [...sample.lookAt] as Vector3Tuple,
        }));
      if (!samples.length) return { playtimeCameraSession: undefined, playtimeCameraRecording: false };
      samples[0] = { ...samples[0], time: 0 };
      if (samples.length === 1) {
        samples.push({ ...samples[0], time: Math.min(source.duration, 1 / Math.max(1, source.frameRate ?? 24)) });
      }

      const familyId = source.takeOf ?? source.id;
      const takeNumber =
        Math.max(
          0,
          ...(scene.cinematics ?? [])
            .filter((cinematic) => (cinematic.takeOf ?? cinematic.id) === familyId)
            .map((cinematic) => cinematic.takeNumber ?? 0),
        ) + 1;
      const familyName = (scene.cinematics ?? []).find((cinematic) => cinematic.id === familyId)?.name ?? source.name;
      const nextId = makeId('cinematic');
      const cameraTrack: CinematicAction = {
        id: makeId('caction'),
        type: 'camera',
        time: 0,
        duration: Math.max(0.5, source.duration),
        label: 'Playtime Camera',
        ease: 'smooth',
        interpolation: 'smooth',
        keyframes: samples,
      };
      const next: CinematicSequence = {
        ...source,
        id: nextId,
        name: `${familyName} Take ${takeNumber} — Live Camera`,
        takeOf: familyId,
        takeNumber,
        actions: [
          ...source.actions
            .filter((action) => action.type !== 'camera')
            .map((action) => ({ ...action, id: makeId('caction') })),
          cameraTrack,
        ].sort((a, b) => a.time - b.time),
        markers: (source.markers ?? []).map((marker) => ({ ...marker, id: makeId('cmark') })),
        createdAt: Date.now(),
      };

      return {
        scenes: state.scenes.map((item) =>
          item.id === scene.id ? { ...item, cinematics: [...(item.cinematics ?? []), next] } : item,
        ),
        activeCinematicId: nextId,
        playtimeCameraSession: undefined,
        playtimeCameraRecording: false,
        selectedCinematicKeyframe: undefined,
        editorCinematicPreview: undefined,
        editorCinematicPreviewCamera: undefined,
        editorCinematicPreviewFade: undefined,
        editorCinematicPreviewLook: undefined,
        editorCinematicPreviewText: undefined,
        editorCinematicPreviewTransforms: {},
        editorCinematicPreviewHidden: [],
        editorCinematicPreviewMaterials: {},
        isDirty: true,
      };
    });
};