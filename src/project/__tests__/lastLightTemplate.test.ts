import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createLastLightTemplate } from '../lastLightTemplate';
import { blankProject } from '../serialize';
import { buildPackage, remapPackageForImport } from '../package';
import { selectActiveObjects, useEditorStore } from '../../store/editorStore';
import { scanBlueprintGraphProblems } from '../../store/editor/graphDiagnostics';
import { initRapier } from '../../runtime/physicsWorld';
import { sampleCameraKeyframes } from '../../store/editor/cinematics';

const state = () => useEditorStore.getState();
const objects = () => selectActiveObjects(state());
beforeAll(async () => { await initRapier(); });
beforeEach(() => {
  state().setPlaying(false); state().loadProject(blankProject('Last Light test'));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
});
afterEach(() => { state().setPlaying(false); vi.unstubAllGlobals(); });

it('authors exactly 70 seconds of contiguous shots with valid cues and portable references', async () => {
  const id = await createLastLightTemplate();
  const seq = state().activeScene()!.cinematics!.find(c => c.id === id)!;
  expect(seq.duration).toBe(70); expect(seq.frameRate).toBe(24); expect(seq.autoplay).toBe(true);
  const shots = seq.actions.filter(a => a.type === 'camera');
  expect(shots).toHaveLength(10); expect(shots[0].time).toBe(0);
  shots.forEach((shot, i) => {
    expect(shot.time + shot.duration!).toBe(shots[i + 1]?.time ?? 70);
    for (let t = shot.time; t <= shot.time + shot.duration!; t += 0.25) {
      const pose = sampleCameraKeyframes(shot.keyframes!, t, shot.interpolation)!;
      expect([...pose.position, ...pose.lookAt, pose.fov].every(Number.isFinite)).toBe(true);
      expect(pose.position[1]).toBeGreaterThan(0);
    }
  });
  expect(objects().length).toBeLessThan(300);
  expect(objects().find(o => o.terrain)?.terrain?.ridgeStrength).toBeGreaterThan(0);
  for (const blueprint of state().blueprints) {
    expect(scanBlueprintGraphProblems(blueprint, state().graphs.find(g => g.id === blueprint.graphId)!, state().variables)).toEqual([]);
  }
  const collected = state().buildProjectPackage();
  const pkg = buildPackage('project', collected.content, [], { id: 'last-light-test', name: 'Last Light', version: '1.0.0' });
  const { content } = remapPackageForImport(JSON.parse(JSON.stringify(pkg)), [], []);
  const ids = new Set(content.scenes!.flatMap(s => s.objects.map(o => o.id)));
  for (const scene of content.scenes!) for (const sequence of scene.cinematics ?? []) for (const action of sequence.actions) {
    if (action.objectId) expect(ids.has(action.objectId)).toBe(true);
  }
  for (const graph of content.graphs) for (const node of graph.nodes) if (node.data.targetObjectId) expect(ids.has(node.data.targetObjectId)).toBe(true);
});

it('runs live fracture with seeded tumble, restores normal time, and restores the authored set on Stop', async () => {
  await createLastLightTemplate();
  const seal = objects().find(o => o.name.startsWith('05 ·'))!;
  const count = objects().length;
  state().setPlaying(true); await new Promise(resolve => setTimeout(resolve, 0));
  const advance = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds * 120); i++) {
      state().tickRuntime(1 / 120);
      // An offline renderer pauses between images. Paused display ticks must not consume a new
      // fragment's launch/spin before Rapier has created and stepped its body.
      if (i % 5 === 4) { state().setPlayPaused(true); state().tickRuntime(0); state().setPlayPaused(false); }
    }
  };
  advance(47.9); expect(objects().some(o => o.id === seal.id)).toBe(true);
  advance(0.3);
  const shards = objects().filter(o => o.name === `${seal.name} Chunk`);
  expect(shards.length).toBeGreaterThan(12);
  expect(state().runtimeTimeScale).toBe(0.25);
  expect(shards.some(o => Math.hypot(...(state().runtimeAngularVelocities[o.id] ?? [0, 0, 0])) > 0.1)).toBe(true);
  advance(5.2); expect(state().runtimeTimeScale).toBe(1);
  expect(state().runtimeCinematic!.time).toBeCloseTo(53.4, 0);
  state().setPlaying(false);
  expect(objects().length).toBe(count); expect(objects().some(o => o.id === seal.id)).toBe(true);
}, 30_000);
