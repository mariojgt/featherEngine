import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { blankProject } from '../../project/serialize';
import { useEditorStore } from '../../store/editorStore';
import type { CinematicSequence, SceneObject, Vector3Tuple } from '../../types';
import { buildSceneSnapshot, COMPACT_ENGINE_GUIDE } from '../systemPrompt';
import { engineTools } from '../tools';

const transform = (
  position: Vector3Tuple = [0, 0, 0],
  rotation: Vector3Tuple = [0, 0, 0],
) => ({ position, rotation, scale: [1, 1, 1] as Vector3Tuple });

const runTool = async (name: keyof typeof engineTools, input: unknown): Promise<string> => {
  const execute = (engineTools[name] as { execute?: (value: unknown, options: unknown) => Promise<unknown> }).execute;
  if (!execute) throw new Error(`Tool ${String(name)} is not executable`);
  return String(await execute(input, {}));
};

function loadProject() {
  const project = blankProject('AI cinematic awareness');
  const objects: SceneObject[] = [
    { id: 'rig', name: 'Hero Rig', kind: 'empty', transform: transform() },
    { id: 'hero', name: 'Hero', kind: 'cube', parentId: 'rig', transform: transform([1, 2, 3], [0, 0.25, 0]) },
    { id: 'prop', name: 'Prop', kind: 'sphere', parentId: 'rig', transform: transform([0, 1, 0]) },
    { id: 'camera', name: 'Main Camera', kind: 'camera', transform: transform([0, 3, 8]) },
  ];
  const cinematic: CinematicSequence = {
    id: 'cinematic-main',
    name: 'Complex Opening',
    duration: 3,
    frameRate: 24,
    actions: [
      {
        id: 'camera-track',
        type: 'camera',
        time: 0,
        duration: 2,
        interpolation: 'linear',
        keyframes: [
          { time: 0, position: [0, 3, 8], lookAt: [0, 1, 0], fov: 50 },
          { time: 2, position: [3, 4, 5], lookAt: [1, 1, 0], fov: 40 },
        ],
      },
      {
        id: 'hero-track',
        type: 'transform',
        objectId: 'hero',
        time: 0,
        duration: 2,
        interpolation: 'linear',
        transformKeyframes: [
          { time: 0, position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] },
          { time: 2, position: [3, 2, 3], rotation: [0, 2, 0], scale: [2, 2, 2] },
        ],
      },
      {
        id: 'prop-legacy',
        type: 'transform',
        objectId: 'prop',
        time: 0.5,
        duration: 1,
        fromPosition: [0, 1, 0],
        toPosition: [0, 3, 0],
      },
      {
        id: 'missing-track',
        type: 'transform',
        objectId: 'deleted-object',
        time: 0,
        duration: 1,
        transformKeyframes: [{ time: 0, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }],
      },
      { id: 'reveal-event', type: 'event', time: 2.5, eventName: 'reveal' },
    ],
    markers: [{ id: 'marker-reveal', time: 2.5, label: 'Reveal' }],
    createdAt: 1,
  };
  project.scenes[0].objects = objects;
  project.scenes[0].cinematics = [cinematic];
  useEditorStore.getState().loadProject(project);
  useEditorStore.getState().setActiveCinematic('cinematic-main');
  useEditorStore.getState().selectObject('hero');
}

describe('AI cinematic awareness', () => {
  beforeEach(loadProject);

  afterEach(() => {
    if (useEditorStore.getState().isPlaying) useEditorStore.getState().setPlaying(false);
    useEditorStore.getState().loadProject(blankProject('AI cinematic cleanup'));
  });

  it('puts object tracks, hierarchy bindings, markers, action ids, and Film Mode state in the snapshot', () => {
    const snapshot = buildSceneSnapshot({ detail: 'tiny', limit: 12 });
    const sequence = snapshot.scenes[0].cinematics[0];
    expect(sequence.frameRate).toBe(24);
    expect(sequence.actionTypeCounts).toMatchObject({ camera: 1, transform: 3, event: 1 });
    expect(sequence.markers).toEqual([{ id: 'marker-reveal', time: 2.5, label: 'Reveal', determinismFence: false }]);

    const hero = sequence.objectTracks.find((track) => 'id' in track && track.id === 'hero-track');
    expect(hero).toMatchObject({
      id: 'hero-track',
      mode: 'keyframed',
      keyframes: 2,
      keyframeTimes: [0, 2],
      binding: { id: 'hero', name: 'Hero', path: 'Hero Rig / Hero', status: 'ok' },
    });
    const missing = sequence.objectTracks.find((track) => 'id' in track && track.id === 'missing-track');
    expect(missing).toMatchObject({ binding: { id: 'deleted-object', name: null, path: null, status: 'missing' } });
    expect(sequence.otherActions).toContainEqual(expect.objectContaining({ id: 'reveal-event', type: 'event' }));
    expect(snapshot.filmMode).toMatchObject({ activeCinematicId: 'cinematic-main', selectedObjectIds: ['hero'] });
  });

  it('inspects summaries and a focused full action with paginated keys', async () => {
    const summary = JSON.parse(await runTool('inspect_cinematic', { cinematicId: 'cinematic-main' }));
    expect(summary.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'camera-track', type: 'camera', keys: expect.objectContaining({ count: 2, times: [0, 2] }) }),
      expect.objectContaining({ id: 'hero-track', type: 'transform', binding: expect.objectContaining({ path: 'Hero Rig / Hero' }) }),
      expect.objectContaining({ id: 'missing-track', binding: expect.objectContaining({ status: 'missing' }) }),
    ]));

    const focused = JSON.parse(await runTool('inspect_cinematic', {
      cinematicId: 'cinematic-main',
      actionId: 'hero-track',
      detail: 'full',
      keyLimit: 1,
    }));
    expect(focused.actions[0]).toMatchObject({
      id: 'hero-track',
      binding: { id: 'hero', path: 'Hero Rig / Hero', status: 'ok' },
      keyPage: { offset: 0, returned: 1, total: 2 },
    });
    expect(focused.actions[0].transformKeyframes).toHaveLength(1);
  });

  it('safely upserts partial object keys, reuses one track, and grows sequence duration', async () => {
    await runTool('set_cinematic_keyframe', {
      trackType: 'object', cinematicId: 'cinematic-main', objectId: 'hero', time: 1, position: [9, 8, 7],
    });
    await runTool('set_cinematic_keyframe', {
      trackType: 'object', cinematicId: 'cinematic-main', objectId: 'hero', time: 1, position: [6, 5, 4],
    });
    await runTool('set_cinematic_keyframe', {
      trackType: 'object', cinematicId: 'cinematic-main', objectId: 'hero', time: 6, scale: [3, 3, 3],
    });

    const sequence = useEditorStore.getState().activeScene()!.cinematics![0];
    const tracks = sequence.actions.filter((action) => action.type === 'transform' && action.objectId === 'hero');
    expect(tracks).toHaveLength(1);
    expect(tracks[0].transformKeyframes).toHaveLength(4);
    const middle = tracks[0].transformKeyframes!.find((frame) => Math.round(frame.time * 24) === 24)!;
    expect(middle.position).toEqual([6, 5, 4]);
    expect(middle.rotation).toEqual([0, 1, 0]);
    expect(middle.scale).toEqual([1.5, 1.5, 1.5]);
    expect(sequence.duration).toBeGreaterThanOrEqual(6);

    const count = tracks[0].transformKeyframes!.length;
    expect(await runTool('set_cinematic_keyframe', {
      trackType: 'object', cinematicId: 'cinematic-main', objectId: 'deleted-object', time: 1,
    })).toContain('No object');
    expect(await runTool('set_cinematic_keyframe', {
      trackType: 'object', cinematicId: 'cinematic-main', objectId: 'hero', actionId: 'camera-track', time: 1,
    })).toContain('not a Transform track');
    expect(tracks[0].transformKeyframes).toHaveLength(count);
  });

  it('reuses legacy bindings for simple AI animation and deletes individual keys safely', async () => {
    const result = await runTool('animate_on_timeline', {
      objectId: 'prop', cinematicId: 'cinematic-main', startTime: 1, duration: 2, toPosition: [4, 5, 6],
    });
    expect(result).toContain('prop-legacy');
    let sequence = useEditorStore.getState().activeScene()!.cinematics![0];
    expect(sequence.actions.filter((action) => action.type === 'transform' && action.objectId === 'prop')).toHaveLength(1);
    expect(sequence.actions.find((action) => action.id === 'prop-legacy')?.transformKeyframes).toHaveLength(2);

    await runTool('delete_cinematic_keyframe', { cinematicId: 'cinematic-main', actionId: 'prop-legacy', time: 1 });
    sequence = useEditorStore.getState().activeScene()!.cinematics![0];
    expect(sequence.actions.find((action) => action.id === 'prop-legacy')?.transformKeyframes).toHaveLength(1);
    await runTool('delete_cinematic_keyframe', { cinematicId: 'cinematic-main', actionId: 'prop-legacy', time: 3 });
    sequence = useEditorStore.getState().activeScene()!.cinematics![0];
    expect(sequence.actions.some((action) => action.id === 'prop-legacy')).toBe(false);
    expect(sequence.actions.some((action) => action.id === 'hero-track')).toBe(true);
    expect(sequence.actions.some((action) => action.id === 'camera-track')).toBe(true);
    expect(sequence.actions.some((action) => action.objectId === 'prop')).toBe(false);
    expect(sequence.actions.some((action) => action.id === 'reveal-event')).toBe(true);
    expect(useEditorStore.getState().activeScene()!.objects.some((object) => object.id === 'prop')).toBe(true);
  });

  it('upserts and deletes camera keys without accepting a Transform action id', async () => {
    expect(await runTool('set_cinematic_keyframe', {
      trackType: 'camera',
      cinematicId: 'cinematic-main',
      actionId: 'hero-track',
      time: 4,
      position: [8, 7, 6],
      lookAt: [0, 1, 0],
      fov: 35,
    })).toContain('not a Camera track');

    expect(await runTool('set_cinematic_keyframe', {
      trackType: 'camera',
      cinematicId: 'cinematic-main',
      actionId: 'camera-track',
      time: 4,
      position: [8, 7, 6],
      lookAt: [0, 1, 0],
      fov: 35,
    })).toContain('camera-track');
    let sequence = useEditorStore.getState().activeScene()!.cinematics![0];
    expect(sequence.actions.find((action) => action.id === 'camera-track')?.keyframes).toHaveLength(3);
    expect(sequence.duration).toBeGreaterThanOrEqual(4);

    await runTool('delete_cinematic_keyframe', { cinematicId: 'cinematic-main', actionId: 'camera-track', time: 4 });
    await runTool('delete_cinematic_keyframe', { cinematicId: 'cinematic-main', actionId: 'camera-track', time: 0 });
    await runTool('delete_cinematic_keyframe', { cinematicId: 'cinematic-main', actionId: 'camera-track', time: 2 });
    sequence = useEditorStore.getState().activeScene()!.cinematics![0];
    const staticShot = sequence.actions.find((action) => action.id === 'camera-track');
    expect(staticShot).toMatchObject({ type: 'camera', time: 2, position: [3, 4, 5], lookAt: [1, 1, 0], fov: 40 });
    expect(staticShot?.keyframes).toBeUndefined();
  });

  it('rejects dangling bindings through generic cinematic actions too', async () => {
    const before = useEditorStore.getState().activeScene()!.cinematics![0].actions.length;
    expect(await runTool('add_cinematic_action', {
      cinematicId: 'cinematic-main',
      action: { type: 'transform', objectId: 'not-in-scene', time: 1, duration: 1, toPosition: [1, 2, 3] },
    })).toContain('dangling');
    expect(useEditorStore.getState().activeScene()!.cinematics![0].actions).toHaveLength(before);
  });

  it('teaches the assistant the new Film Mode object workflow and safe authoring tools', () => {
    expect(COMPACT_ENGINE_GUIDE).toContain('Add Object Track');
    expect(COMPACT_ENGINE_GUIDE).toContain('inspect_cinematic');
    expect(COMPACT_ENGINE_GUIDE).toContain('set_cinematic_keyframe');
    expect(COMPACT_ENGINE_GUIDE).toContain('LOCAL (parent-relative)');
  });
});
