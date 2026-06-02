import { useEditorStore } from '../store/editorStore';

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

  const lightId = store.createObjectWithProps('light', {
    name: 'Key Light',
    position: [-3.8, 4.5, 3.2],
  });
  store.setObjectLight(lightId, { type: 'spot', color: '#FFE6B0', intensity: 3.2, distance: 14, angle: Math.PI / 5, castShadow: true });

  const cinematicId = store.createCinematic('Film Mode Tutorial', 9);
  store.updateCinematic(cinematicId, { autoplay: true, skippable: true });
  store.addCinematicAction(cinematicId, {
    type: 'fade',
    time: 0,
    duration: 1.2,
    label: 'Fade in',
    fadeFrom: 1,
    fadeTo: 0,
    fadeColor: '#05070B',
  });
  // A single animated camera track that flies smoothly through four keyframes (wide → push-in →
  // sweep → high reveal). This is the "keyframe the camera" workflow: each keyframe is just a
  // framing at a time, and the camera glides through them on a spline. Recreate it yourself by
  // scrubbing the playhead, framing the viewport, and clicking "Add camera keyframe".
  store.addCinematicAction(cinematicId, {
    type: 'camera',
    time: 0,
    duration: 9,
    label: 'Camera track',
    ease: 'smooth',
    keyframes: [
      { time: 0, position: [7, 3.4, 7], lookAt: [0, 0.9, 0], fov: 42 },
      { time: 3.2, position: [3.2, 1.2, 3.4], lookAt: [1.5, 0.9, 0], fov: 38 },
      { time: 6, position: [-1.5, 1.6, 5], lookAt: [0.5, 0.9, 0], fov: 44 },
      { time: 9, position: [-4.6, 2.3, 4.6], lookAt: [0.5, 0.9, 0], fov: 50 },
    ],
  });
  store.addCinematicAction(cinematicId, {
    type: 'transform',
    time: 0.8,
    duration: 5.4,
    label: 'Hero walks in',
    objectId: heroId,
    fromPosition: [-3, 0.7, 0],
    toPosition: [1.5, 0.7, 0],
    fromRotation: [0, 0, 0],
    toRotation: [0, Math.PI * 1.5, 0],
    fromScale: [0.9, 1.4, 0.9],
    toScale: [1.1, 1.1, 1.1],
    ease: 'smooth',
  });
  store.addCinematicAction(cinematicId, {
    type: 'spawn',
    time: 3.2,
    label: 'Spawn temporary cinematic object',
    spawnKind: 'sphere',
    name: 'Cinematic-only Spark',
    position: [0, 1.7, 0],
    scale: [0.32, 0.32, 0.32],
  });
  store.addCinematicAction(cinematicId, {
    type: 'visibility',
    time: 5.7,
    label: 'Hide Prop B',
    objectId: propId,
    visible: false,
  });
  store.addCinematicAction(cinematicId, {
    type: 'event',
    time: 6.2,
    label: 'Fire cinematic_finished',
    eventName: 'cinematic_finished',
  });
  store.addCinematicAction(cinematicId, {
    type: 'fade',
    time: 7.7,
    duration: 1.3,
    label: 'Fade out',
    fadeFrom: 0,
    fadeTo: 1,
    fadeColor: '#05070B',
  });

  store.setActiveCinematic(cinematicId);
  store.selectObject(heroId);
  return cinematicId;
}
