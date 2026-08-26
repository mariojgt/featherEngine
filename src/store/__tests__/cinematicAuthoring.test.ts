import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { blankProject } from '../../project/serialize';
import { validateRuntimeReferences } from '../../project/runtimeCompatibility';
import { computeInstanceBatches, isInstanceable } from '../../three/modelInstancing';
import type { CinematicCameraKeyframe, CinematicSequence, CinematicTransformKeyframe, SceneObject, Vector3Tuple } from '../../types';
import { sampleCameraKeyframes, sampleTransformKeyframes } from '../editor/cinematics';
import { useEditorStore } from '../editorStore';

const transform = (
  position: Vector3Tuple = [0, 0, 0],
  rotation: Vector3Tuple = [0, 0, 0],
) => ({ position, rotation, scale: [1, 1, 1] as Vector3Tuple });

const cameraSequence = (): CinematicSequence => ({
  id: 'cinematic-main',
  name: 'Opening',
  duration: 4,
  frameRate: 24,
  actions: [
    {
      id: 'shot-camera',
      type: 'camera',
      time: 0,
      duration: 4,
      objectId: 'camera-main',
      lookAtObjectId: 'subject',
      focusObjectId: 'subject',
      aperture: 3,
    },
    {
      id: 'move-camera',
      type: 'transform',
      time: 1,
      duration: 1,
      objectId: 'camera-main',
      toPosition: [9, 9, 9],
    },
    { id: 'event-main', type: 'event', time: 2, eventName: 'reveal' },
  ],
  markers: [],
  createdAt: 1,
});

function loadCinematicProject() {
  const project = blankProject('Cinematic authoring');
  const camera: SceneObject = {
    id: 'camera-main',
    name: 'Main Camera',
    kind: 'camera',
    transform: transform([4, 3, 2], [0.1, 0.5, 0]),
  };
  const subject: SceneObject = {
    id: 'subject',
    name: 'Subject',
    kind: 'cube',
    transform: transform([1, 2, -3]),
  };
  project.scenes[0].objects = [camera, subject];
  project.scenes[0].cinematics = [cameraSequence()];
  useEditorStore.getState().loadProject(project);
}

describe('simple cinematic authoring', () => {
  beforeEach(loadCinematicProject);

  afterEach(() => {
    if (useEditorStore.getState().isPlaying) useEditorStore.getState().setPlaying(false);
    useEditorStore.getState().loadProject(blankProject('Cinematic authoring cleanup'));
  });

  it('freezes linked shot framing and removes dead actions when a camera is deleted', () => {
    useEditorStore.getState().deleteObject('camera-main');
    const scene = useEditorStore.getState().activeScene()!;
    expect(scene.objects.some((object) => object.id === 'camera-main')).toBe(false);

    const cinematic = scene.cinematics![0];
    const shot = cinematic.actions.find((action) => action.id === 'shot-camera')!;
    expect(shot.objectId).toBeUndefined();
    expect(shot.position).toEqual([4, 3, 2]);
    expect(shot.lookAt).toBeDefined();
    expect(cinematic.actions.some((action) => action.id === 'move-camera')).toBe(false);

    const report = validateRuntimeReferences(
      useEditorStore.getState().exportProject(),
      useEditorStore.getState().activeSceneId,
    );
    expect(report.errors.filter((error) => error.includes('camera-main'))).toEqual([]);
  });

  it('bakes look-at and focus constraints when their subject is deleted', () => {
    useEditorStore.getState().deleteObject('subject');
    const shot = useEditorStore.getState().activeScene()!.cinematics![0].actions.find((action) => action.id === 'shot-camera')!;
    expect(shot.lookAtObjectId).toBeUndefined();
    expect(shot.focusObjectId).toBeUndefined();
    expect(shot.lookAt).toEqual([1, 2, -3]);
    expect(shot.focusDistance).toBeCloseTo(Math.hypot(3, 1, 5));
  });

  it('supports explicit detach/clear patches for optional shot fields', () => {
    useEditorStore.getState().updateCinematicAction('cinematic-main', 'shot-camera', {
      objectId: undefined,
      lookAtObjectId: undefined,
      focusObjectId: undefined,
      shake: undefined,
    });
    const shot = useEditorStore.getState().activeScene()!.cinematics![0].actions.find((action) => action.id === 'shot-camera')!;
    expect('objectId' in shot).toBe(false);
    expect('lookAtObjectId' in shot).toBe(false);
    expect('focusObjectId' in shot).toBe(false);
    expect('shake' in shot).toBe(false);
  });

  it('commits live camera samples as a new take without changing the source', async () => {
    const state = useEditorStore.getState();
    state.setPlaytimeCameraRecording(true);
    state.playCinematic('cinematic-main');
    expect(useEditorStore.getState().playtimeCameraSession?.sequenceId).toBe('cinematic-main');

    useEditorStore.getState().recordPlaytimeCameraSample({ time: 0, position: [0, 2, 6], lookAt: [0, 2, 0], fov: 50 });
    useEditorStore.getState().recordPlaytimeCameraSample({ time: 1, position: [2, 3, 4], lookAt: [0, 1, 0], fov: 45 });
    useEditorStore.getState().finishPlaytimeCameraRecording();
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    const cinematics = useEditorStore.getState().activeScene()!.cinematics!;
    expect(useEditorStore.getState().isPlaying).toBe(false);
    expect(cinematics).toHaveLength(2);
    const source = cinematics.find((cinematic) => cinematic.id === 'cinematic-main')!;
    const take = cinematics.find((cinematic) => cinematic.id !== 'cinematic-main')!;
    expect(source.actions.find((action) => action.id === 'shot-camera')?.objectId).toBe('camera-main');
    expect(take.takeOf).toBe('cinematic-main');
    expect(take.name).toContain('Live Camera');
    expect(take.actions.filter((action) => action.type === 'camera')).toHaveLength(1);
    expect(take.actions.find((action) => action.type === 'camera')?.keyframes).toHaveLength(2);
    expect(take.actions.find((action) => action.type === 'event')?.eventName).toBe('reveal');
    expect(take.actions.some((action) => action.id === 'event-main')).toBe(false);
  });

  it('keeps adjacent-frame keys and only replaces a key on the same sequence frame', () => {
    const store = useEditorStore.getState();
    const first = store.addCinematicCameraKeyframe('cinematic-main', 1, {
      position: [0, 2, 6],
      lookAt: [0, 1, 0],
      fov: 50,
    });
    expect(first).toBeTruthy();
    store.addCinematicCameraKeyframe('cinematic-main', 1 + 1 / 24, {
      position: [2, 3, 5],
      lookAt: [0, 1, 0],
      fov: 48,
    }, first);

    let action = useEditorStore.getState().activeScene()!.cinematics![0].actions.find((item) => item.id === first)!;
    expect(action.keyframes).toHaveLength(2);

    store.addCinematicCameraKeyframe('cinematic-main', 1.01, {
      position: [9, 8, 7],
      lookAt: [0, 0, 0],
      fov: 40,
    }, first);
    action = useEditorStore.getState().activeScene()!.cinematics![0].actions.find((item) => item.id === first)!;
    expect(action.keyframes).toHaveLength(2);
    expect(action.keyframes?.find((key) => Math.round(key.time * 24) === 24)?.position).toEqual([9, 8, 7]);
  });

  it('adds an unbound scene object as one full Transform track and rejects dangling bindings', () => {
    const store = useEditorStore.getState();
    const actionId = store.addCinematicTransformKeyframe('cinematic-main', 'subject', 1.25);
    expect(actionId).toBeTruthy();

    let sequence = useEditorStore.getState().activeScene()!.cinematics![0];
    let tracks = sequence.actions.filter((action) => action.type === 'transform' && action.objectId === 'subject');
    expect(tracks).toHaveLength(1);
    expect(tracks[0].transformKeyframes).toEqual([{
      time: 1.25,
      position: [1, 2, -3],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    }]);

    store.addCinematicTransformKeyframe('cinematic-main', 'subject', 1.5, transform([7, 8, 9]), actionId);
    sequence = useEditorStore.getState().activeScene()!.cinematics![0];
    tracks = sequence.actions.filter((action) => action.type === 'transform' && action.objectId === 'subject');
    expect(tracks).toHaveLength(1);
    expect(tracks[0].transformKeyframes).toHaveLength(2);

    // The camera already owns a legacy from→to transform action. First-key authoring upgrades it
    // instead of creating a duplicate binding/row.
    expect(store.addCinematicTransformKeyframe('cinematic-main', 'camera-main', 0.5)).toBe('move-camera');
    expect(useEditorStore.getState().activeScene()!.cinematics![0].actions.filter(
      (action) => action.type === 'transform' && action.objectId === 'camera-main',
    )).toHaveLength(1);

    const actionCount = useEditorStore.getState().activeScene()!.cinematics![0].actions.length;
    expect(store.addCinematicTransformKeyframe('cinematic-main', 'deleted-object', 1, transform([9, 9, 9]))).toBeUndefined();
    expect(useEditorStore.getState().activeScene()!.cinematics![0].actions).toHaveLength(actionCount);
  });

  it('converts a dragged parented-object path key from world back to local space', () => {
    const project = blankProject('Parented path key');
    project.scenes[0].objects = [
      { id: 'parent', name: 'Parent', kind: 'empty', transform: transform([10, 0, 0]) },
      { id: 'child', name: 'Child', kind: 'cube', parentId: 'parent', transform: transform([1, 0, 0]) },
    ];
    project.scenes[0].cinematics = [{
      id: 'parented-sequence',
      name: 'Parented movement',
      duration: 2,
      frameRate: 24,
      actions: [{
        id: 'child-track',
        type: 'transform',
        objectId: 'child',
        time: 0,
        duration: 1,
        transformKeyframes: [{ time: 0, position: [1, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }],
      }],
      markers: [],
      createdAt: 1,
    }];
    useEditorStore.getState().loadProject(project);

    useEditorStore.getState().moveCinematicKeyframe('child-track', 0, [14, 0, 0]);
    const key = useEditorStore.getState().activeScene()!.cinematics![0].actions[0].transformKeyframes![0];
    expect(key.position).toEqual([4, 0, 0]);
  });

  it('keeps path editing and playtime recording modes unambiguous', () => {
    const store = useEditorStore.getState();
    store.setPlaytimeCameraRecording(true);
    expect(useEditorStore.getState().playtimeCameraRecording).toBe(true);

    store.setCinematicRecording(true);
    expect(useEditorStore.getState().cinematicRecording).toBe(true);
    expect(useEditorStore.getState().playtimeCameraRecording).toBe(false);
    expect(useEditorStore.getState().cinematicViewportMode).toBe('edit');

    store.setCinematicViewportMode('camera');
    store.previewCinematic('cinematic-main', 1);
    store.clearCinematicPreview();
    expect(useEditorStore.getState().cinematicViewportMode).toBe('edit');
  });
});

describe('cinematic path sampling', () => {
  const cameraKeys: CinematicCameraKeyframe[] = [
    { time: 0, position: [0, 0, 0], lookAt: [0, 0, -1], fov: 60 },
    { time: 1, position: [10, 4, 2], lookAt: [2, 0, -1], fov: 40 },
  ];
  const transformKeys: CinematicTransformKeyframe[] = [
    { time: 0, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    { time: 1, position: [8, 2, 4], rotation: [0, 2, 0], scale: [3, 3, 3] },
  ];

  it('uses the runtime interpolation for linear and hold motion trails', () => {
    expect(sampleCameraKeyframes(cameraKeys, 0.5, 'linear')?.position).toEqual([5, 2, 1]);
    expect(sampleCameraKeyframes(cameraKeys, 0.5, 'hold')?.position).toEqual([0, 0, 0]);
    expect(sampleTransformKeyframes(transformKeys, 0.5, 'linear')?.position).toEqual([4, 1, 2]);
    expect(sampleTransformKeyframes(transformKeys, 0.5, 'hold')?.position).toEqual([0, 0, 0]);
  });
});

describe('rendering authoring shortcuts', () => {
  beforeEach(() => useEditorStore.getState().loadProject(blankProject('Rendering authoring')));

  afterEach(() => useEditorStore.getState().loadProject(blankProject('Rendering authoring cleanup')));

  it('creates a dedicated Reflection Probe entity with working defaults', () => {
    const id = useEditorStore.getState().createReflectionProbe([3, 4, 5]);
    const object = useEditorStore.getState().activeScene()!.objects.find((item) => item.id === id)!;
    expect(object.kind).toBe('empty');
    expect(object.name).toBe('Reflection Probe');
    expect(object.transform.position).toEqual([3, 4, 5]);
    expect(object.reflectionProbe?.enabled).toBe(true);
    expect(useEditorStore.getState().selectedObjectId).toBe(id);
  });

  it('creates an editable grid that the existing runtime batches as GPU instances', () => {
    const project = blankProject('Instanced grid');
    const source: SceneObject = {
      id: 'model-source',
      name: 'Street Lamp',
      kind: 'cube',
      transform: transform([10, 0, -4]),
      renderer: {
        enabled: true,
        mesh: 'cube',
        color: '#ffffff',
        metalness: 0,
        roughness: 0.6,
        modelAssetId: 'model-lamp',
      },
    };
    project.scenes[0].objects = [source];
    useEditorStore.getState().loadProject(project);

    const ids = useEditorStore.getState().createInstancedGrid(source.id, {
      rows: 3,
      columns: 4,
      spacingX: 2,
      spacingZ: 3,
    });
    const objects = useEditorStore.getState().activeScene()!.objects;
    expect(ids).toHaveLength(12);
    expect(new Set(ids).size).toBe(12);
    expect(objects).toHaveLength(12);
    expect(objects.every((object) => !object.parentId && isInstanceable(object))).toBe(true);
    expect(objects.find((object) => object.transform.position[0] === 16 && object.transform.position[2] === 2)).toBeDefined();
    expect(computeInstanceBatches(objects).get('model-lamp')).toHaveLength(12);
  });

  it('refuses unsafe or undersized instanced grids without changing the scene', () => {
    const id = useEditorStore.getState().createObjectWithProps('cube', { name: 'Not imported' });
    expect(useEditorStore.getState().createInstancedGrid(id, { rows: 2, columns: 2 })).toEqual([]);
    expect(useEditorStore.getState().createInstancedGrid(id, { rows: 1, columns: 3 })).toEqual([]);
    expect(useEditorStore.getState().activeScene()!.objects).toHaveLength(1);
  });
});
