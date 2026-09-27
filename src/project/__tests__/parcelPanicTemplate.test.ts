import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createParcelPanicTemplate, PARCEL_PANIC_INTRO_SECONDS } from '../parcelPanicTemplate';
import { villageHouse, villagePoint, villagePropZone } from '../parcelPanicVillage';
import { blankProject } from '../serialize';
import { buildPackage, remapPackageForImport } from '../package';
import { validateRuntimeReferences } from '../runtimeCompatibility';
import { selectActiveObjects, useEditorStore } from '../../store/editorStore';
import { scanBlueprintGraphProblems } from '../../store/editor/graphDiagnostics';
import { initRapier } from '../../runtime/physicsWorld';
import { evalExpression } from '../../ui/expression';
import type { UIElement, Vector3Tuple } from '../../types';

const state = () => useEditorStore.getState();
const objects = () => selectActiveObjects(state());
const obj = (id: string) => objects().find(o => o.id === id)!;
const value = (name: string) => state().runtimeVariableValues[state().variables.find(v => v.name === name)!.id];
const frames = (count = 1) => { for (let i = 0; i < count; i++) state().tickRuntime(1 / 60); };
const key = (code: string) => { state().setRuntimeKey(code, true); frames(3); state().setRuntimeKey(code, false); frames(3); };
const event = (name: string) => { state().fireCustomEvent(name); frames(3); };
const flatten = (root: UIElement): UIElement[] => [root, ...root.children.flatMap(flatten)];
async function start(skip = true) {
  const player = await createParcelPanicTemplate({ seed: 12345 });
  state().setPlaying(true);
  await new Promise(resolve => setTimeout(resolve, 0));
  frames(3);
  if (skip) event('PPSkip');
  return player;
}
function teleport(id: string, position: Vector3Tuple) { state().updateTransform(id, 'position', position); frames(3); }

beforeAll(async () => { await initRapier(); });
beforeEach(() => {
  state().setPlaying(false);
  state().loadProject(blankProject('Parcel Panic test'));
  vi.stubGlobal('fetch', vi.fn(async (path: string) => ({
    ok: true,
    blob: async () => new Blob([readFileSync(`public/${path}`)], { type: 'audio/wav' }),
  })));
});
afterEach(() => { state().setPlaying(false); vi.unstubAllGlobals(); });

describe('Parcel Panic playable starter', () => {
  it('packages the editable game, reusable prefabs, intro, UI and all five original sounds without broken references', async () => {
    await createParcelPanicTemplate({ seed: 12345 });
    expect(state().assets).toHaveLength(5);
    expect(state().prefabs).toHaveLength(11);
    expect(objects().length).toBeLessThan(750);
    expect(objects().filter(o => /^Parcel [1-5] ·/.test(o.name))).toHaveLength(5);
    const intro = state().activeScene()!.cinematics!.find(c => c.autoplay)!;
    expect(intro.duration).toBe(PARCEL_PANIC_INTRO_SECONDS);
    expect(intro.actions.filter(a => a.type === 'camera')).toHaveLength(3);
    for (const bp of state().blueprints) expect(scanBlueprintGraphProblems(bp, state().graphs.find(g => g.id === bp.graphId)!, state().variables)).toEqual([]);
    const collected = state().buildProjectPackage();
    expect(collected.assetIds).toHaveLength(5);
    const pkg = buildPackage('project', collected.content, state().assets, { id: 'parcel-panic-test', name: 'Parcel Panic', version: '1.0.0' });
    const mapped = remapPackageForImport(JSON.parse(JSON.stringify(pkg)), [], []);
    const project = { ...state().exportProject(), ...mapped.content, assets: mapped.assets, activeSceneId: mapped.content.scenes![0].id };
    expect(validateRuntimeReferences(project, project.activeSceneId).errors).toEqual([]);
    state().loadProject(project);
    const ids = new Set(objects().map(o => o.id));
    for (const parcel of objects().filter(o => /^Parcel [1-5] ·/.test(o.name))) {
      expect(ids.has(String(parcel.variables?.destination))).toBe(true);
      expect(ids.has(String(parcel.variables?.confetti))).toBe(true);
    }
    const hud = state().uiDocuments.find(d => d.name === 'Parcel Panic · HUD and menus')!;
    const timer = flatten(hud.root).find(e => e.name === 'Round timer')!;
    expect(evalExpression(timer.bindings.find(b => b.target === 'text')!.expression, { vars: { PPTimed: true, PPTimeLeft: 78 } })).toBe('78s remaining');
  });

  it('hands off naturally and after skipping, blocks intro movement, and pauses/resumes without consuming the timer', async () => {
    const player = await start(false);
    const before = [...obj(player).transform.position];
    state().setRuntimeKey('KeyW', true); frames(30); state().setRuntimeKey('KeyW', false);
    expect(obj(player).transform.position[2]).toBeCloseTo(before[2], 2);
    expect(value('PPSeconds')).toBe(0);
    frames(550);
    expect(state().runtimeCinematic).toBeUndefined();
    expect(value('PPPlaying')).toBe(true);
    state().setRuntimeKey('KeyW', true); frames(30); state().setRuntimeKey('KeyW', false);
    expect(obj(player).transform.position[2]).toBeGreaterThan(before[2] + 1);
    key('KeyP');
    const seconds = value('PPSeconds'); frames(60);
    expect(value('PPSeconds')).toBe(seconds);
    expect(state().runtimeTimeScale).toBe(0);
    key('KeyP'); expect(state().runtimeTimeScale).toBe(1);
    state().setPlaying(false);
    state().setPlaying(true); frames(3); key('Enter');
    frames(60);
    expect(state().runtimeCinematic).toBeUndefined();
    expect(value('PPPlaying')).toBe(true);
    expect(value('PPSeconds')).toBeLessThan(2);
  });

  it('picks up exactly one parcel, rejects wrong baskets, awards delivery once and restores the round on replay', async () => {
    const player = await start();
    const parcel = objects().find(o => o.name === 'Parcel 1 · Coral 01')!;
    teleport(player, [-5.5, 0.1, -3]); key('KeyE');
    expect(value('PPCarry')).toBe('Coral 01');
    expect(objects().filter(o => /^Parcel [1-5] ·/.test(o.name) && !o.physics?.enabled)).toHaveLength(1);
    const wrong = objects().find(o => o.name === '02 · Bluebell Delivery Basket')!;
    teleport(player, [wrong.transform.position[0], 0.1, wrong.transform.position[2] - 1]); frames(20);
    expect(value('PPDelivered')).toBe(0);
    const basket = obj(String(parcel.variables?.destination));
    teleport(player, [basket.transform.position[0], 0.1, basket.transform.position[2] - 1]); frames(30);
    expect(value('PPDelivered')).toBe(1);
    expect(value('PPScore')).toBe(100);
    expect(value('PPCarry')).toBe('');
    frames(60); expect(value('PPScore')).toBe(100);
    event('PPRelaxed'); frames(60);
    expect(value('PPScore')).toBe(0);
    expect(value('PPDelivered')).toBe(0);
    expect(state().runtimeObjectVariables[parcel.id].delivered).toBe(false);
    expect(obj(parcel.id).physics?.enabled).toBe(true);
    expect(obj(parcel.id).transform.position[1]).toBeGreaterThan(0.5);
  });

  it('throws a real dynamic parcel into the matching basket for an air-mail bonus and recalls missed parcels', async () => {
    const player = await start();
    const parcel = objects().find(o => o.name === 'Parcel 1 · Coral 01')!;
    teleport(player, [-5.5, 0.1, -3]); key('KeyE');
    const target = obj(String(parcel.variables?.destination)).transform.position;
    teleport(player, [-12, 0.1, -3]);
    teleport(player, [-12, 0.1, target[2] - 5]);
    teleport(player, [target[0], 0.1, target[2] - 5]);
    state().updateTransform(player, 'rotation', [0, 0, 0]); frames(3);
    key('KeyQ');
    expect(obj(parcel.id).physics).toMatchObject({ enabled: true, bodyType: 'dynamic' });
    expect(value('PPCarry')).toBe('');
    expect(Math.hypot(...state().runtimeAngularVelocities[parcel.id])).toBeGreaterThan(0.1);
    frames(90);
    expect(value('PPScore')).toBe(150);
    expect(value('PPDelivered')).toBe(1);
    const loose = objects().find(o => o.name === 'Parcel 2 · Bluebell 02')!;
    teleport(loose.id, [12, -8, -8]); frames(60);
    expect(obj(loose.id).transform.position[1]).toBeGreaterThan(0.5);
    teleport(loose.id, [5, 0.5, 4]); key('KeyR'); frames(30);
    expect(obj(loose.id).transform.position[0]).toBeCloseTo(-4.2, 1);
    expect(value('PPDelivered')).toBe(1);
  });

  it('finishes all five deliveries, supports a timed loss and resets results for a relaxed replay', async () => {
    const player = await start();
    const parcels = objects().filter(o => /^Parcel [1-5] ·/.test(o.name));
    for (const parcel of parcels) {
      teleport(player, [0, 0.1, -5]);
      teleport(parcel.id, obj(String(parcel.variables?.destination)).transform.position);
      frames(12);
    }
    expect(value('PPDelivered')).toBe(5);
    expect(value('PPDone')).toBe(true);
    expect(value('PPPlaying')).toBe(false);
    event('PPTimeTrial');
    expect(value('PPTimed')).toBe(true);
    state().setRuntimeVariableByName('PPSeconds', 90); frames(4);
    expect(value('PPDone')).toBe(true);
    expect(value('PPDelivered')).toBe(0);
    event('PPRelaxed');
    expect(value('PPTimed')).toBe(false);
    expect(value('PPDone')).toBe(false);
    expect(value('PPPlaying')).toBe(true);
  });

  it('bounces the courier on the honey pad and restores rolling props when restarting', async () => {
    const player = await start();
    // Approach from the open side so the character sweep does not intersect the depot.
    teleport(player, [8, 0.1, -5]);
    teleport(player, [8, 0.1, 7]);
    teleport(player, [4.3, 0.1, 7]);
    frames(12);
    expect(obj(player).transform.position[1]).toBeGreaterThan(0.6);
    const drum = objects().find(o => o.name === 'Rolling mail drum 1')!;
    teleport(drum.id, [12, 2, -5]);
    event('PPRelaxed');
    // Dynamic props can separate on contact after reset; require their original area, not an exact frozen pose.
    const [x, , z] = obj(drum.id).transform.position;
    const home = villagePoint(12345, 400, villagePropZone(0));
    expect(Math.hypot(x - home[0], z - home[2])).toBeLessThan(1);
  });

  it('lets a rubber ball fall and bounce against the physical island and restores its home on a new round', async () => {
    await start(); frames(60);
    const ball = objects().find(o => o.name === 'Rubber ball 7')!;
    expect(ball.physics).toMatchObject({ bodyType: 'dynamic', collider: 'sphere', ccd: true });
    state().updatePhysics(ball.id, { enabled: false }); frames();
    state().updateTransform(ball.id, 'position', [12, 3, -5]);
    state().updatePhysics(ball.id, { enabled: true }); frames();
    let fell = false; let rebounded = false;
    for (let index = 0; index < 100; index++) {
      frames();
      const vy = state().runtimeVelocities[ball.id]?.[1] ?? 0;
      fell ||= vy < -1;
      rebounded ||= fell && vy > 1;
    }
    expect(fell).toBe(true);
    expect(rebounded).toBe(true);
    event('PPRelaxed'); frames(6);
    const home = villagePoint(12345, 424, villagePropZone(6));
    const actual = obj(ball.id).transform.position;
    expect(Math.hypot(actual[0] - home[0], actual[2] - home[2])).toBeLessThan(1);
  });

  it('generates different complete villages, retries the same seed, and resets props without growing the scene', async () => {
    await start(); frames(15);
    const count = objects().length;
    const houses = ['01 · Coral House', '02 · Bluebell House', '03 · Honey House'].map(name => objects().find(o => o.name === name)!);
    const verify = (seed: number) => houses.forEach((house, index) => {
      const actual = obj(house.id).transform.position;
      villageHouse(seed, index).forEach((expected, axis) => expect(actual[axis]).toBeCloseTo(expected, 5));
      const basket = obj(String(house.variables?.basket));
      expect(basket.transform.position[0]).toBeCloseTo(actual[0], 5);
      expect(basket.transform.position[2]).toBeCloseTo(actual[2] - 3.6, 5);
    });
    verify(12345);
    const before = houses.map(h => [...obj(h.id).transform.position]);
    event('PPNewVillage'); frames(12);
    const seed = value('PPSeed') as number;
    expect(seed).not.toBe(12345);
    expect(value('PPVillage')).toBe(2);
    verify(seed);
    expect(houses.map(h => obj(h.id).transform.position)).not.toEqual(before);
    event('PPTimeTrial'); frames(12);
    expect(value('PPSeed')).toBe(seed);
    expect(value('PPTimed')).toBe(true);
    verify(seed);
    for (let i = 0; i < 8; i++) { event('PPNewVillage'); frames(5); verify(value('PPSeed') as number); }
    expect(objects()).toHaveLength(count);
    expect(value('PPDelivered')).toBe(0);
    expect(value('PPCarry')).toBe('');
    expect(objects().filter(o => o.physics?.enabled && o.physics.bodyType === 'dynamic')).toHaveLength(13);
  });

  it('keeps movement, carrying and throw animation working in the combined player blueprint', async () => {
    const player = await start(); frames(60);
    expect(state().runtimeObjectVariables[player].ppc_anim_state).toBe('idle');
    teleport(player, [-5.5, 0.1, -3]); key('KeyE'); frames(30);
    expect(value('PPPickupPulse')).toBe(1);
    expect(state().runtimeObjectVariables[player].ppc_anim_state).toBe('carry_idle');
    expect(value('PPCarryWeight')).toBeGreaterThan(0);
    key('KeyQ'); frames(3);
    expect(value('PPThrowPulse')).toBe(1);
    expect(value('PPCarryWeight')).toBe(0);
    expect(state().runtimeObjectVariables[player].ppc_anim_state).toBe('throw');
    event('PPRelaxed'); frames(20);
    expect(state().runtimeObjectVariables[player].ppc_anim_state).toBe('idle');
  });

  it('animates an empty-handed courier using the combined scripted movement path, then settles to idle', async () => {
    const player = await start(); frames(60);
    const shoulder = objects().find(o => o.name === 'Pip · Left shoulder pivot')!;
    const hip = objects().find(o => o.name === 'Pip · Left hip pivot')!;
    const shoulderAngles: number[] = [], hipAngles: number[] = [];
    state().setRuntimeKey('KeyD', true);
    for (let i = 0; i < 24; i++) {
      frames();
      shoulderAngles.push(obj(shoulder.id).transform.rotation[0]);
      hipAngles.push(obj(hip.id).transform.rotation[0]);
    }
    expect(value('PPCarry')).toBe('');
    expect(state().runtimeObjectVariables[player].ppc_anim_state).toBe('walk');
    expect(Math.max(...shoulderAngles) - Math.min(...shoulderAngles)).toBeGreaterThan(0.5);
    expect(Math.max(...hipAngles) - Math.min(...hipAngles)).toBeGreaterThan(0.5);
    state().setRuntimeKey('KeyD', false); frames(30);
    expect(state().runtimeObjectVariables[player].ppc_anim_state).toBe('idle');
  });

  it('keeps authored tree bases and house footprints inside the island collider', async () => {
    await createParcelPanicTemplate({ seed: 12345 });
    const floor = objects().find(o => o.name === 'Island · walkable turf')!.transform;
    for (const actor of objects().filter(o => o.name.startsWith('Coastal Grove · Tree') || / · (Coral|Bluebell|Honey) House$/.test(o.name))) {
      const margin = actor.name.startsWith('Coastal') ? 0.8 : 2.4;
      for (const axis of [0, 2]) expect(Math.abs(actor.transform.position[axis] - floor.position[axis]) + margin).toBeLessThan(floor.scale[axis] / 2);
    }
  });

  it('leaves authored scenes untouched if an audio asset cannot load', async () => {
    const before = state().exportProject();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
    await expect(createParcelPanicTemplate()).rejects.toThrow('could not load');
    expect(state().scenes).toEqual(before.scenes);
    expect(state().assets).toEqual(before.assets);
    expect(state().blueprints).toEqual(before.blueprints);
  });
});
