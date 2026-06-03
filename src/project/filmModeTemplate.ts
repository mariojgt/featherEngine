import { useEditorStore } from '../store/editorStore';

/**
 * Film Mode starter: a ~12-second mini-short that teaches *film grammar*, not just the timeline API.
 * It cuts between three framings (establishing wide → push-in → low reveal), pulls focus during the
 * final dolly (depth-of-field), and ships with a cinematic look out of the box (2.39 letterbox, a warm
 * grade, a touch of grain + vignette). Recreate any of it by scrubbing the playhead, framing the
 * viewport, and clicking "Add camera shot" / tuning the "Film look" panel.
 */
export function createFilmModeTemplate(): string | undefined {
  const store = useEditorStore.getState();

  const floorId = store.createObjectWithProps('cube', {
    name: 'Film Mode Stage',
    position: [0, -0.08, 0],
    color: '#171C24',
    physics: { enabled: true, bodyType: 'fixed', collider: 'box' },
  });
  store.updateTransform(floorId, 'scale', [14, 0.16, 8]);

  const heroId = store.createObjectWithProps('cube', {
    name: 'Actor Mesh X',
    position: [-3, 0.7, 0],
    color: '#5B8CFF',
  });
  store.updateTransform(heroId, 'scale', [0.9, 1.4, 0.9]);

  const propId = store.createObjectWithProps('sphere', {
    name: 'Prop B',
    position: [2.7, 0.65, -0.8],
    color: '#FFD166',
  });
  store.updateTransform(propId, 'scale', [0.45, 0.45, 0.45]);

  const cameraId = store.createObjectWithProps('camera', {
    name: 'Director Camera',
    position: [5.8, 3.1, 5.2],
  });
  store.updateTransform(cameraId, 'rotation', [-0.42, 0.76, 0]);

  const keyLightId = store.createObjectWithProps('light', {
    name: 'Key Light',
    position: [-3.8, 4.5, 3.2],
  });
  store.setObjectLight(keyLightId, { type: 'spot', color: '#FFE6B0', intensity: 3.2, distance: 14, angle: Math.PI / 5, castShadow: true });

  const rimLightId = store.createObjectWithProps('light', {
    name: 'Rim Light',
    position: [4.2, 3.4, -3.6],
  });
  store.setObjectLight(rimLightId, { type: 'spot', color: '#7FB2FF', intensity: 2.2, distance: 12, angle: Math.PI / 5, castShadow: false });

  const cinematicId = store.createCinematic('Film Mode Tutorial', 12);
  store.updateCinematic(cinematicId, { autoplay: true, skippable: true });
  // The film look: anamorphic-ish scope bars, a warm grade, and a hint of grain + vignette so the very
  // first frame already reads as a movie. Tune all of this live in the panel's "Film look" section.
  store.setCinematicLook(cinematicId, { letterbox: 2.39, grade: 'warm', grain: 0.12, vignette: 0.28 });

  // Open from black.
  store.addCinematicAction(cinematicId, {
    type: 'fade',
    time: 0,
    duration: 1.2,
    label: 'Fade in',
    fadeFrom: 1,
    fadeTo: 0,
    fadeColor: '#05070B',
  });

  // --- The shot list: three cut framings. This is film editing — discrete shots with cuts, not one
  // continuous flythrough. Each addCinematicShot() is a cut; the last shot dollies (blend) so its
  // focus distance interpolates from the previous shot → a rack-focus pull mid-move. ---

  // Shot 1 — establishing wide. Deep focus (aperture 0), everything sharp. Hard cut in (blend 0).
  store.addCinematicShot(cinematicId, {
    time: 0,
    label: 'Shot 1 · Establishing wide',
    position: [7, 3.4, 7],
    lookAt: [0, 0.9, 0],
    fov: 40,
    blend: 0,
    duration: 4,
  });

  // Shot 2 — push-in on the actor. Shallow focus locked to the hero (~3.8 units ahead). Hard cut.
  store.addCinematicShot(cinematicId, {
    time: 4,
    label: 'Shot 2 · Push-in',
    position: [3.0, 1.3, 3.2],
    lookAt: [1.0, 0.9, 0],
    fov: 38,
    blend: 0,
    focusDistance: 3.8,
    aperture: 5,
    duration: 4,
  });

  // Shot 3 — low reveal. Dollies from Shot 2 (blend 1.6s), pulling focus from 3.8 → 5.6 as it moves.
  store.addCinematicShot(cinematicId, {
    time: 8,
    label: 'Shot 3 · Low reveal (rack focus)',
    position: [-1.6, 1.8, 4.6],
    lookAt: [0.5, 0.9, 0],
    fov: 46,
    blend: 1.6,
    focusDistance: 5.6,
    aperture: 4,
    duration: 4,
  });

  // The actor walks into frame across the first two shots and turns to camera.
  store.addCinematicAction(cinematicId, {
    type: 'transform',
    time: 0.8,
    duration: 6,
    label: 'Hero walks in',
    objectId: heroId,
    fromPosition: [-3, 0.7, 0],
    toPosition: [1.0, 0.7, 0],
    fromRotation: [0, 0, 0],
    toRotation: [0, Math.PI * 1.5, 0],
    fromScale: [0.9, 1.4, 0.9],
    toScale: [1.0, 1.3, 1.0],
    ease: 'smooth',
  });

  // A temporary cinematic-only spark, hidden prop, and a story event — all timed to the cuts.
  store.addCinematicAction(cinematicId, {
    type: 'spawn',
    time: 4.1,
    label: 'Spawn temporary cinematic spark',
    spawnKind: 'sphere',
    name: 'Cinematic-only Spark',
    position: [0.6, 1.8, 0],
    scale: [0.3, 0.3, 0.3],
  });
  store.addCinematicAction(cinematicId, {
    type: 'visibility',
    time: 8.2,
    label: 'Hide Prop B',
    objectId: propId,
    visible: false,
  });
  store.addCinematicAction(cinematicId, {
    type: 'event',
    time: 9,
    label: 'Fire cinematic_finished',
    eventName: 'cinematic_finished',
  });

  // Close to black.
  store.addCinematicAction(cinematicId, {
    type: 'fade',
    time: 10.6,
    duration: 1.4,
    label: 'Fade out',
    fadeFrom: 0,
    fadeTo: 1,
    fadeColor: '#05070B',
  });

  store.setActiveCinematic(cinematicId);
  store.selectObject(heroId);
  return cinematicId;
}
