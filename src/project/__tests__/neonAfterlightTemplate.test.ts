import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createNeonAfterlightTemplate, NEON_AFTERLIGHT_ASSETS } from '../neonAfterlightTemplate';
import { blankProject } from '../serialize';
import { buildPackage, remapPackageForImport } from '../package';
import { selectActiveObjects, useEditorStore } from '../../store/editorStore';
import { scanBlueprintGraphProblems } from '../../store/editor/graphDiagnostics';

const state = () => useEditorStore.getState();
beforeEach(() => {
  state().setPlaying(false); state().loadProject(blankProject('Afterlight test'));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['test asset']) }));
  vi.stubGlobal('URL', class extends URL { static createObjectURL() { return 'blob:test-asset'; } static revokeObjectURL() {} });
});
afterEach(() => { state().setPlaying(false); vi.unstubAllGlobals(); });

it('packages every city asset, contiguous shot, drone hierarchy and weather cue', async () => {
  const id = await createNeonAfterlightTemplate(), scene = state().activeScene()!, seq = scene.cinematics!.find(c => c.id === id)!;
  const objects = selectActiveObjects(state()), shots = seq.actions.filter(a => a.type === 'camera');
  expect(seq.duration).toBe(70); expect(seq.autoplay).toBe(true); expect(shots).toHaveLength(10);
  shots.forEach((shot, i) => expect(shot.time + shot.duration!).toBe(shots[i + 1]?.time ?? 70));
  expect(state().assets).toHaveLength(NEON_AFTERLIGHT_ASSETS.length);
  expect(objects.filter(o => o.water?.enabled)).toHaveLength(3);
  expect(objects.filter(o => o.particles?.enabled)).toHaveLength(7);
  expect(scene.environment).toMatchObject({ volumetricLocalStrength: 1.4, surfaceWetness: .78, wetnessFromRain: true });
  expect(state().renderSettings.quality).toBe('Epic');
  for (const blueprint of state().blueprints) expect(scanBlueprintGraphProblems(blueprint, state().graphs.find(g => g.id === blueprint.graphId)!, state().variables)).toEqual([]);
  const collected = state().buildProjectPackage(); expect(collected.assetIds).toHaveLength(16);
  const pkg = buildPackage('project', collected.content, state().assets, { id: 'afterlight-test', name: 'Afterlight', version: '1.0.0' });
  const { content } = remapPackageForImport(JSON.parse(JSON.stringify(pkg)), [], []);
  const ids = new Set(content.scenes!.flatMap(scene => scene.objects.map(o => o.id)));
  for (const scene of content.scenes!) {
    for (const object of scene.objects) if (object.parentId) expect(ids.has(object.parentId)).toBe(true);
    for (const c of scene.cinematics ?? []) for (const action of c.actions) if (action.objectId) expect(ids.has(action.objectId)).toBe(true);
  }
});

it('plays the rain, drone and spark cues and restores the authored world on replay', async () => {
  await createNeonAfterlightTemplate();
  const authoredEnvironment = state().activeScene()!.environment;
  const drone = selectActiveObjects(state()).find(o => o.name.startsWith('08 ·'))!;
  state().setPlaying(true); await new Promise(r => setTimeout(r, 0));
  for (let i = 0; i < 40 * 30; i++) state().tickRuntime(1 / 30);
  expect(state().activeScene()!.environment?.rainIntensity).toBe(.72);
  expect(selectActiveObjects(state()).find(o => o.id === drone.id)!.transform.position[2]).toBeLessThan(-20);
  state().setRuntimeKey('KeyR', true); state().tickRuntime(1 / 30);
  expect(state().activeScene()!.environment).toEqual(authoredEnvironment);
  expect(selectActiveObjects(state()).find(o => o.id === drone.id)!.transform.position).toEqual(drone.transform.position);
}, 30_000);
