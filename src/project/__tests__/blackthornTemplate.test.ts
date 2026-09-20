import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createBlackthornTemplate } from '../blackthornTemplate';
import { blankProject } from '../serialize';
import { buildPackage, remapPackageForImport } from '../package';
import { selectActiveObjects, useEditorStore } from '../../store/editorStore';
import { scanBlueprintGraphProblems } from '../../store/editor/graphDiagnostics';
import { initRapier } from '../../runtime/physicsWorld';

const state = () => useEditorStore.getState();
const objects = () => selectActiveObjects(state());
beforeAll(async () => { await initRapier(); });
beforeEach(() => {
  state().setPlaying(false); state().loadProject(blankProject('Blackthorn test'));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['test asset']) }));
  vi.stubGlobal('URL', class extends URL { static createObjectURL() { return 'blob:test-asset'; } static revokeObjectURL() {} });
});
afterEach(() => { state().setPlaying(false); vi.unstubAllGlobals(); });

it('packages the complete castle film and remaps every cinematic and physics reference', async () => {
  const id = await createBlackthornTemplate();
  const scene = state().activeScene()!, seq = scene.cinematics!.find(c => c.id === id)!;
  expect(seq.duration).toBe(70); expect(seq.autoplay).toBe(true);
  const shots = seq.actions.filter(a => a.type === 'camera'); expect(shots).toHaveLength(10);
  shots.forEach((a, i) => expect(a.time + a.duration!).toBe(shots[i + 1]?.time ?? 70));
  expect(state().assets).toHaveLength(12);
  expect(scene.environment).toMatchObject({skyLighting:'sky',surfaceWetness:.3,wetnessFromRain:true});
  expect(objects().filter(o=>o.light?.type==='rect')).toHaveLength(2);
  expect(objects().filter(o => o.cloth?.enabled)).toHaveLength(4);
  expect(objects().filter(o => o.renderer?.modelAssetId).length).toBeGreaterThan(80);
  expect(objects().filter(o => o.terrain).length).toBe(2);
  for (const blueprint of state().blueprints) expect(scanBlueprintGraphProblems(blueprint, state().graphs.find(g => g.id === blueprint.graphId)!, state().variables)).toEqual([]);
  const collected = state().buildProjectPackage();
  expect(new Set(collected.assetIds).size).toBe(12);
  const pkg = buildPackage('project', collected.content, state().assets, { id: 'blackthorn-test', name: 'Blackthorn', version: '1.0.0' });
  const { content } = remapPackageForImport(JSON.parse(JSON.stringify(pkg)), [], []);
  const ids = new Set(content.scenes!.flatMap(s => s.objects.map(o => o.id)));
  for (const scene of content.scenes!) for (const c of scene.cinematics ?? []) for (const a of c.actions) if (a.objectId) expect(ids.has(a.objectId)).toBe(true);
  for (const graph of content.graphs) for (const node of graph.nodes) if (node.data.targetObjectId) expect(ids.has(node.data.targetObjectId)).toBe(true);
});

it('builds the storm, flashes actual scene lighting, fractures the ward and restores the authored world on Stop', async () => {
  await createBlackthornTemplate();
  const ward = objects().find(o => o.name.startsWith('04 ·'))!, authoredEnvironment = state().activeScene()!.environment;
  state().setPlaying(true); await new Promise(r => setTimeout(r, 0));
  const advance = (seconds: number) => { for (let i = 0; i < Math.round(seconds * 120); i++) state().tickRuntime(1 / 120); };
  advance(26.25);
  expect(state().activeScene()!.environment?.rainIntensity).toBeGreaterThan(0.4);
  expect(state().activeScene()!.environment?.lightningFlash).toBe(1);
  advance(0.4); expect(state().activeScene()!.environment?.lightningFlash).toBe(0);
  advance(15.5);
  const shards = objects().filter(o => o.name === `${ward.name} Chunk`);
  expect(shards).toHaveLength(32); expect(state().runtimeTimeScale).toBe(0.25);
  expect(shards.some(o => Math.hypot(...(state().runtimeAngularVelocities[o.id] ?? [0, 0, 0])) > 0.1)).toBe(true);
  advance(6); expect(state().runtimeTimeScale).toBe(1);
  // The same guarantee must hold for the film's R replay, before stopping back to the editor.
  state().setRuntimeKey('KeyR', true); advance(0.02);
  expect(state().activeScene()!.environment).toEqual(authoredEnvironment);
  expect(objects().some(o => o.id === ward.id)).toBe(true);
  state().setPlaying(false);
  expect(state().activeScene()!.environment).toEqual(authoredEnvironment);
  expect(objects().some(o => o.id === ward.id)).toBe(true);
}, 60_000);
