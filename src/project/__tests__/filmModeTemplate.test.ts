import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { blankProject } from '../serialize';
import { createFilmModeTemplate } from '../filmModeTemplate';
import { selectActiveObjects, useEditorStore } from '../../store/editorStore';
import { scanBlueprintGraphProblems } from '../../store/editor/graphDiagnostics';
import { initRapier, getActivePhysics } from '../../runtime/physicsWorld';
import { buildPackage, remapPackageForImport } from '../package';

const state = () => useEditorStore.getState();
const objects = () => selectActiveObjects(state());
const advance = (seconds: number) => { for (let i = 0; i < Math.ceil(seconds * 60); i++) state().tickRuntime(1 / 60); };
beforeAll(async () => { await initRapier(); });
beforeEach(() => {
  state().setPlaying(false);
  state().loadProject(blankProject('Resonance Test'));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
});
afterEach(() => { state().setPlaying(false); vi.unstubAllGlobals(); });

describe('Resonance cinematic showcase', () => {
  it('builds an editable, bounded installation with complete shots and valid physics/replay graphs even without optional audio', async () => {
    const id = await createFilmModeTemplate();
    const sequence = state().activeScene()!.cinematics!.find(c => c.id === id)!;
    expect(sequence.name).toBe('Resonance');
    expect(sequence.autoplay).toBe(true);
    expect(sequence.duration).toBe(32);
    const shots = sequence.actions.filter(a => a.type === 'camera');
    expect(shots).toHaveLength(8);
    expect(shots[0].time).toBe(0);
    shots.forEach((shot, i) => expect(shot.time + shot.duration!).toBe(shots[i + 1]?.time ?? 32));
    expect(objects().filter(o => o.physics?.bodyType === 'dynamic')).toHaveLength(13);
    expect(objects().filter(o => o.cloth?.enabled)).toHaveLength(4);
    expect(objects().length).toBeLessThan(320);
    expect(state().activeScene()!.environment?.lux?.enabled).toBe(true);
    for (const action of sequence.actions.filter(a => a.type === 'transform')) {
      expect(objects().find(o => o.id === action.objectId)?.physics?.enabled).not.toBe(true);
    }
    for (const blueprint of state().blueprints) {
      const graph = state().graphs.find(g => g.id === blueprint.graphId)!;
      expect(scanBlueprintGraphProblems(blueprint, graph, state().variables)).toEqual([]);
    }
    const collected = state().buildProjectPackage();
    const pkg = buildPackage('project', collected.content, [], { id: 'resonance-test', name: 'Resonance', version: '1.0.0' });
    const { content } = remapPackageForImport(JSON.parse(JSON.stringify(pkg)), [], []);
    const ids = new Set(content.scenes!.flatMap(s => s.objects.map(o => o.id)));
    for (const graph of content.graphs) for (const node of graph.nodes) {
      if (node.data.targetObjectId) expect(ids.has(node.data.targetObjectId)).toBe(true);
      if (node.data.documentId) expect(content.uiDocuments!.some(d => d.id === node.data.documentId)).toBe(true);
    }
  });

  it('runs actual domino collisions and fracture, holds the closing frame, replays, and restores authored bodies on Stop', async () => {
    await createFilmModeTemplate();
    const authored = objects();
    const ball = authored.find(o => o.name.startsWith('Impulse ball'))!;
    const dominoes = authored.filter(o => o.name.startsWith('Domino'));
    const core = authored.find(o => o.name.startsWith('Reactor shell'))!;
    const replay = state().uiDocuments.find(d => d.name === 'Resonance · Replay')!;
    useEditorStore.setState({ isDirty: false });
    state().setPlaying(true);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(getActivePhysics()).toBeTruthy();
    advance(8);
    expect(objects().find(o => o.id === ball.id)!.transform.position[0]).toBeCloseTo(ball.transform.position[0], 1);
    expect(objects().filter(o => dominoes.some(d => d.id === o.id) && Math.abs(o.transform.rotation[2]) > 0.4)).toHaveLength(0);
    advance(6);
    const fallen = objects().filter(o => dominoes.some(d => d.id === o.id) && o.transform.position[1] < 0.9);
    expect(fallen.length).toBeGreaterThanOrEqual(10);
    expect(objects().some(o => o.id === core.id)).toBe(true);
    advance(10.5);
    const shards = objects().filter(o => o.name.startsWith('Reactor shell') && o.id !== core.id);
    expect(objects().some(o => o.id === core.id)).toBe(false);
    expect(shards).toHaveLength(32);
    expect(shards.every(o => o.physics?.bodyType === 'dynamic')).toBe(true);
    expect(state().runtimeTimeScale).toBe(0.25);
    expect(shards.some(o => (state().runtimeVelocities[o.id] ?? []).some(v => Math.abs(v) > 0.5))).toBe(true);
    advance(3.5);
    // 28 seconds of wall-clock simulation must still be 28 seconds of the edit/music,
    // including the quarter-speed physics interval. Time dilation persists unless reset.
    expect(state().runtimeCinematic!.time).toBeCloseTo(28, 0);
    expect(state().runtimeTimeScale).toBe(1);
    advance(4);
    expect(state().runtimeTimeScale).toBe(0);
    expect(state().runtimeVisibleUI[replay.id]).toBe(true);
    expect(state().runtimeCinematic!.time).toBeGreaterThan(31.6);
    expect(state().runtimeCinematic!.time).toBeLessThan(32);
    expect(objects().every(o => [...o.transform.position, ...o.transform.rotation].every(Number.isFinite))).toBe(true);
    expect(state().isDirty).toBe(false);
    state().setRuntimeKey('KeyR', true); state().tickRuntime(1 / 60); state().setRuntimeKey('KeyR', false);
    advance(0.1);
    expect(state().runtimeTimeScale).toBe(1);
    expect(state().runtimeVisibleUI[replay.id]).not.toBe(true);
    expect(state().runtimeCinematic!.time).toBeLessThan(1);
    expect(objects().some(o => o.id === core.id)).toBe(true);
    expect(objects().find(o => o.id === ball.id)!.transform.position[0]).toBeCloseTo(ball.transform.position[0], 1);
    state().setPlaying(false);
    expect(objects()).toEqual(authored);
    expect(state().isDirty).toBe(false);
  }, 60_000);
});
