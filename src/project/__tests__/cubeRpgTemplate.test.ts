import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { subscribeParticles, type ParticleCommand } from '../../runtime/particleBus';
import { scanBlueprintGraphProblems } from '../../store/editor/graphDiagnostics';
import { selectActiveObjects, useEditorStore } from '../../store/editorStore';
import { createCubeRpgTemplate } from '../cubeRpgTemplate';
import { blankProject } from '../serialize';
import { buildPackage, remapPackageForImport } from '../package';

const state = () => useEditorStore.getState();
const objects = () => selectActiveObjects(state());
const object = (id: string) => objects().find((o) => o.id === id)!;
const instance = (id: string) => ({ ...object(id).variables, ...state().runtimeObjectVariables[id] });
const value = (name: string) => {
  const variable = state().variables.find((v) => v.name === name)!;
  return state().runtimeVariableValues[variable.id] ?? variable.defaultValue;
};
const step = (frames = 1, dt = 1 / 60) => {
  for (let i = 0; i < frames; i++) state().tickRuntime(dt);
};
const setRuntimeVar = (id: string, key: string, v: number) => useEditorStore.setState((s) => ({
  runtimeObjectVariables: { ...s.runtimeObjectVariables, [id]: { ...s.runtimeObjectVariables[id], [key]: v } },
}));
const event = (name: string) => { state().fireCustomEvent(name); step(2); };
const damage = (id: string, amount: number) => {
  useEditorStore.setState({ runtimeDamageEvents: { [id]: amount } });
  step(2);
};
const start = async () => {
  const hero = await createCubeRpgTemplate();
  state().setPlaying(true);
  await new Promise((resolve) => setTimeout(resolve, 100));
  step();
  event('CubeResume');
  return hero;
};

describe('Cube RPG starter', () => {
  beforeEach(() => {
    state().setPlaying(false);
    state().loadProject(blankProject('Cube RPG Test'));
  });
  afterEach(() => {
    state().setPlaying(false);
    state().loadProject(blankProject('Cube RPG Cleanup'));
  });

  it('builds portable editable content, valid Blueprints, a cube prefab and a complete HUD', async () => {
    const hero = await createCubeRpgTemplate();
    expect(state().assets).toHaveLength(0);
    expect(state().renderSettings).toMatchObject({ quality: 'High', bloomEnabled: true, bloomMipmap: false });
    expect(objects().length).toBeLessThan(450);
    expect(objects().filter((o) => o.variables?.enemy)).toHaveLength(7);
    for (const name of ['Cloud Sea · Recovery Trigger', 'Arena 2 · Entry Trigger', 'Arena 3 · Entry Trigger']) {
      expect(objects().find((o) => o.name === name)?.physics).toMatchObject({ enabled: true, isTrigger: true, bodyType: 'fixed' });
    }
    expect(state().prefabs.find((p) => p.name === 'Cubie · Playable Cube Knight')).toBeDefined();
    expect(objects().find((o) => o.id === hero)?.character).toMatchObject({ enabled: true, autoInputWithScript: true, mouseLook: false });
    expect(state().activeScene()?.environment).toMatchObject({ skyMode: 'procedural', contactShadows: true, toneMapping: 'agx' });
    for (const blueprint of state().blueprints) {
      const graph = state().graphs.find((g) => g.id === blueprint.graphId)!;
      expect(scanBlueprintGraphProblems(blueprint, graph, state().variables), blueprint.name).toEqual([]);
    }
    const pkg = state().buildProjectPackage();
    expect(pkg.assetIds).toEqual([]);
    expect(pkg.content.prefabs).toHaveLength(1);
    expect(pkg.content.uiDocuments.find((d) => d.name === 'Cube RPG · Adventure HUD')?.css).toContain('prefers-reduced-motion');
    expect(pkg.content.variables.map((v) => v.name)).toContain('RpgPotions');
  });

  it('starts paused, resumes and restores the authored game after Stop', async () => {
    const hero = await createCubeRpgTemplate();
    const authored = structuredClone(objects());
    state().setPlaying(true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    step();
    expect(value('RpgMenu')).toBe(true);
    expect(state().runtimeTimeScale).toBe(0);
    event('CubeResume');
    expect(value('RpgStarted')).toBe(true);
    damage(hero, 20);
    expect(value('RpgHealth')).toBe(80);
    state().setPlaying(false);
    expect(objects()).toEqual(authored);
    expect(value('RpgHealth')).toBe(100);
  });

  it('reduces shielded damage, heals with a potion, and never wastes one at full health', async () => {
    const hero = await start();
    event('CubePotion');
    expect(value('RpgPotions')).toBe(3);
    state().setRuntimeKey('KeyQ', true);
    step();
    expect(value('RpgBlocking')).toBe(true);
    damage(hero, 40);
    expect(value('RpgHealth')).toBe(90);
    state().setRuntimeKey('KeyQ', false);
    step(40);
    damage(hero, 40);
    expect(value('RpgHealth')).toBe(50);
    event('CubePotion');
    expect(value('RpgHealth')).toBe(95);
    expect(value('RpgPotions')).toBe(2);
    event('CubePotion');
    expect(value('RpgHealth')).toBe(100);
    expect(value('RpgPotions')).toBe(1);
    event('CubePotion');
    expect(value('RpgPotions')).toBe(1);
  });

  it('uses the real sword damage path, respects equipment and releases loot and VFX', async () => {
    const hero = await start();
    const foe = objects().find((o) => o.variables?.enemy && o.variables.arena === 1)!;
    state().updateTransform(hero, 'position', [-4, 0.1, 1]);
    const commands: ParticleCommand[] = [];
    const sparks = objects().find((o) => o.name === 'Cubie · Sword Sparks')!;
    const off = subscribeParticles(sparks.id, (command) => commands.push(command));
    try {
      event('CubeSword');
      event('CubeAttack');
      expect(value('RpgEnemies')).toBe(3);
      event('CubeSword');
      event('CubeAttack');
      step(28);
      event('CubeAttack');
      step(28);
      expect(objects().some((o) => o.id === foe.id)).toBe(false);
      expect(value('RpgEnemies')).toBe(2);
      expect(value('RpgCoins')).toBe(10);
      expect(commands.some((c) => c.type === 'burst')).toBe(true);
    } finally { off(); }
  });

  it('keeps future opponents dormant and prevents advancing through a locked arena', async () => {
    const hero = await start();
    const future = objects().find((o) => o.variables?.enemy && o.variables.arena === 2)!;
    const before = [...future.transform.position];
    step(60);
    expect(objects().find((o) => o.id === future.id)?.transform.position).toEqual(before);
    const entry = objects().find((o) => o.name === 'Arena 2 · Entry Trigger')!;
    useEditorStore.setState({ runtimeTriggers: [{ objectId: entry.id, otherObjectId: hero }] });
    step(2);
    expect(value('RpgArena')).toBe(1);
    expect(objects().find((o) => o.name === 'Arena 1 · Locked Gate')?.physics?.enabled).toBe(true);
  });

  it('recoils, changes the hit face, flashes only that enemy and restores the camera and pose', async () => {
    const hero = await start();
    const [foe, untouched] = objects().filter((o) => o.variables?.enemy && o.variables.arena === 1);
    const rig = object(foe.variables!.rig_anchor as string);
    const mesh = rig.variables!.mesh_anchor as string;
    const otherRig = object(untouched.variables!.rig_anchor as string);
    const otherMesh = otherRig.variables!.mesh_anchor as string;
    const originalMaterial = structuredClone(state().materials.find((m) => m.id === object(mesh).renderer?.materialId));
    const originalDistance = Math.hypot(foe.transform.position[0], foe.transform.position[2] + 7);
    damage(foe.id, 28); step(2);
    expect(instance(foe.id).reacting).toBe(true);
    expect(instance(rig.id).pose).toBe('hurt');
    expect(object(rig.variables!.eye_left as string).transform.scale[1]).toBe(0.22);
    expect(object(rig.variables!.mouth_anchor as string).transform.scale).toEqual([1, 1, 1]);
    expect(object(mesh).renderer?.materialOverrides).toMatchObject({ color: '#FFF4CC', emissiveIntensity: 0.8 });
    expect(object(otherMesh).renderer?.materialOverrides?.color).not.toBe('#FFF4CC');
    expect(state().materials.find((m) => m.id === originalMaterial!.id)).toEqual(originalMaterial);
    expect(Math.hypot(object(foe.id).transform.position[0], object(foe.id).transform.position[2] + 7)).toBeGreaterThan(originalDistance);
    expect(state().runtimeCameraOverrides[hero]).toEqual({ distance: 9.7, height: 4.7 });
    expect(state().runtimeCameraShake).toBeGreaterThan(0.15);
    expect(object(foe.variables!.impact_anchor as string).transform.scale[0]).toBeGreaterThan(0.1);
    step(20);
    expect(instance(foe.id).reacting).toBe(false);
    expect(instance(rig.id).pose).toBe('idle');
    expect(object(rig.variables!.eye_left as string).transform.scale).toEqual([1, 1, 1]);
    expect(object(rig.variables!.mouth_anchor as string).transform.scale[0]).toBe(0.001);
    expect(object(mesh).renderer?.materialOverrides).toMatchObject({ color: '#9A70BB', emissiveIntensity: 0 });
    expect(state().runtimeCameraOverrides[hero]).toEqual({ distance: 11, height: 5 });
    const recovered = [...object(foe.id).transform.position];
    step(5);
    expect(object(foe.id).transform.position).not.toEqual(recovered);
  });

  it('commits a telegraphed attack through light hits, breaks it with a heavy hit and freezes during a pause', async () => {
    const hero = await start();
    const foe = objects().find((o) => o.variables?.enemy && o.variables.arena === 1)!;
    state().updateTransform(hero, 'position', [-4, 0.1, 1]);
    for (let i = 0; i < 180 && state().runtimeHidden.includes(foe.variables!.warning_anchor as string); i++) step();
    expect(instance(foe.id).attacking).toBe(true);
    damage(foe.id, 10);
    expect(instance(foe.id).attacking).toBe(true);
    expect(instance(foe.id).reacting).toBe(false);
    event('CubePause'); step();
    const paused = structuredClone(object(foe.variables!.rig_anchor as string).transform);
    step(30);
    const frozen = object(foe.variables!.rig_anchor as string).transform;
    for (const key of ['position', 'rotation', 'scale'] as const) {
      frozen[key].forEach((n, i) => expect(n).toBeCloseTo(paused[key][i], 3));
    }
    expect(instance(foe.id).attacking).toBe(true);
    expect(value('RpgHealth')).toBe(100);
    event('CubeResume'); step(28);
    // The committed strike lands (other grumbles may add their own separate 16-point hits).
    expect(value('RpgHealth')).toBeLessThanOrEqual(84);
    expect((100 - (value('RpgHealth') as number)) % 16).toBe(0);
    expect(state().runtimeHidden).toContain(foe.variables!.warning_anchor);
    for (let i = 0; i < 240 && state().runtimeHidden.includes(foe.variables!.warning_anchor as string); i++) step();
    expect(instance(foe.id).attacking).toBe(true);
    damage(foe.id, 44);
    expect(instance(foe.id).attacking).toBe(false);
    expect(instance(foe.id).reacting).toBe(true);
    expect(state().runtimeHidden).toContain(foe.variables!.warning_anchor);
  });

  it('chains a buffered three-hit combo into a spinning finisher, then resets the chain', async () => {
    const hero = await start();
    const foe = objects().find((o) => o.variables?.enemy && o.variables.arena === 1)!;
    step(120);
    setRuntimeVar(foe.id, 'hp', 500);
    setRuntimeVar(foe.id, 'max_hp', 500);
    state().updateTransform(hero, 'position', [-4, 0.1, 1]);
    state().updateTransform(foe.id, 'position', [-4, 0.1, 2]);
    step(2);
    const rig = objects().find((o) => o.name === 'Cubie · Body Rig')!;
    const ring = objects().find((o) => o.name === 'Cubie · Slam Shockwave')!;
    const hp = () => instance(foe.id).hp as number;
    event('CubeAttack');
    expect(value('RpgCombo')).toBe(1);
    event('CubeAttack');
    step(8);
    expect(hp()).toBe(474);
    step(12);
    expect(value('RpgCombo')).toBe(2);
    step(10);
    expect(hp()).toBe(444);
    event('CubeAttack');
    step(5);
    expect(value('RpgCombo')).toBe(3);
    expect(instance(rig.id).pose).toBe('finisher');
    step(5);
    expect(hp()).toBe(396);
    step(4);
    expect(object(ring.id).transform.scale[0]).toBeGreaterThan(1);
    step(60);
    expect(value('RpgCombo')).toBe(0);
    expect(instance(rig.id).pose).toBe('idle');
    event('CubeAttack'); step(10);
    expect(hp()).toBe(370);
    step(60);
    expect(value('RpgCombo')).toBe(0);
  });

  it('turns a jump attack into a plunge that slams the ground and lands on the arena', async () => {
    const hero = await start();
    step(120);
    const foe = objects().find((o) => o.variables?.enemy && o.variables.arena === 1)!;
    setRuntimeVar(foe.id, 'hp', 500);
    setRuntimeVar(foe.id, 'max_hp', 500);
    state().updateTransform(hero, 'position', [-4, 0.1, 0.5]);
    step(30);
    state().setRuntimeKey('Space', true); step(12); state().setRuntimeKey('Space', false);
    expect(object(hero).transform.position[1]).toBeGreaterThan(0.6);
    event('CubeAttack');
    expect(instance(hero).plunging === true || instance(hero).air_ready === false).toBe(true);
    let landed = false;
    for (let i = 0; i < 90 && !landed; i++) { step(); landed = (instance(foe.id).hp as number) < 500; }
    expect(landed).toBe(true);
    expect(instance(foe.id).hp).toBe(458);
    expect(instance(foe.id).reacting).toBe(true);
    expect(state().runtimeCameraShake).toBeGreaterThan(0.3);
    step(40);
    expect(object(hero).transform.position[1]).toBeCloseTo(0.12, 1);
    expect(instance(hero).air_ready).toBe(true);
    expect(instance(hero).attack_ready).toBe(true);
  });

  it('surrounding grumbles land separate, staggered hits instead of one synchronized chunk', async () => {
    const hero = await start();
    state().updateTransform(hero, 'position', [0, 0.1, 4]);
    const drops: number[] = [];
    let last = 100;
    for (let i = 0; i < 60 * 5 && value('RpgDefeated') === false; i++) {
      step();
      const health = value('RpgHealth') as number;
      if (health !== last) { drops.push(last - health); last = health; }
    }
    expect(drops.length).toBeGreaterThanOrEqual(4);
    expect(drops.every((d) => d === 16)).toBe(true);
  });

  it('plays a defeat beat before removing the enemy and awards loot exactly once', async () => {
    await start();
    const foe = objects().find((o) => o.variables?.enemy && o.variables.arena === 1)!;
    const rig = foe.variables!.rig_anchor as string;
    damage(foe.id, 1000);
    expect(instance(foe.id).defeated).toBe(true);
    expect(value('RpgEnemies')).toBe(3);
    step(6);
    expect(instance(rig).pose).toBe('defeat');
    expect(object(rig).transform.scale[1]).toBeLessThan(0.7);
    damage(foe.id, 1000); step(20);
    expect(objects().some((o) => o.id === foe.id)).toBe(false);
    expect(value('RpgEnemies')).toBe(2);
    expect(value('RpgCoins')).toBe(10);
    expect(objects().some((o) => o.id === foe.variables!.vfx_anchor)).toBe(true);
  });

  it('runs the stride in seconds, freezes during pause and reserves camera impacts for actual hits', async () => {
    const hero = await start();
    const rig = objects().find((o) => o.name === 'Cubie · Body Rig')!;
    const initialPhase = instance(rig.id).phase as number;
    step(2, 1 / 30); step(2, 1 / 60);
    expect(instance(rig.id).phase).toBeCloseTo(initialPhase + 1.2);
    event('CubeAttack'); step(10);
    expect(state().runtimeCameraShake).toBe(0);
    expect(state().runtimeCameraOverrides[hero]).toBeUndefined();
    step(25);
    const boot = objects().find((o) => o.name === 'Cubie · Boot -1')!;
    state().setRuntimeKey('KeyW', true); step(10);
    const stride = structuredClone(object(boot.id).transform);
    step(8);
    expect(object(boot.id).transform).not.toEqual(stride);
    state().setRuntimeKey('KeyW', false);
    event('CubePause');
    const phase = instance(rig.id).phase;
    step(20, 1 / 30);
    expect(instance(rig.id).phase).toBe(phase);
  });

  it('shows a real attack warning, updates enemy health bars and hides the warning after the hit', async () => {
    const hero = await start();
    const foe = objects().find((o) => o.variables?.enemy && o.variables.arena === 1)!;
    const warning = foe.variables!.warning_anchor as string;
    const bar = foe.variables!.health_anchor as string;
    state().updateTransform(hero, 'position', [-4, 0.1, 1]);
    expect(state().runtimeHidden).toContain(warning);
    expect(state().runtimeHidden).not.toContain(foe.id);
    let showed = false;
    for (let i = 0; i < 120; i++) {
      step();
      if (!state().runtimeHidden.includes(warning)) { showed = true; break; }
    }
    expect(showed).toBe(true);
    step(30);
    expect(state().runtimeHidden).toContain(warning);
    damage(foe.id, 28);
    expect(state().runtimeObjectVariables[foe.id]).toMatchObject({ hp: 28, max_hp: 56 });
    expect(objects().find((o) => o.id === bar)?.transform.scale[0]).toBe(0.5);
  });

  it('settles onto real arena colliders and jumps with normal character input', async () => {
    const hero = await start();
    step(180);
    expect(objects().find((o) => o.id === hero)!.transform.position[1]).toBeLessThan(0.2);
    state().setRuntimeKey('Space', true);
    step(15);
    state().setRuntimeKey('Space', false);
    expect(objects().find((o) => o.id === hero)!.transform.position[1]).toBeGreaterThan(0.5);
  });

  it('keeps combat, effect references, gates and restart working after a package receives fresh IDs', async () => {
    await createCubeRpgTemplate();
    const originalScene = state().activeSceneId;
    const collected = state().buildProjectPackage();
    const pkg = buildPackage('project', collected.content, [], { id: 'cube-rpg-test', name: 'Cube RPG', version: '1.0.0' });
    const { content } = remapPackageForImport(pkg);
    state().loadProject(blankProject('Imported Cube RPG'));
    state().mergeProjectPackage(content, []);
    expect(state().activeSceneId).not.toBe(originalScene);
    const hero = objects().find((o) => o.name === 'Cubie — Player Controller')!;
    for (const foe of objects().filter((o) => o.variables?.enemy)) {
      for (const key of ['vfx_anchor', 'tell_anchor', 'health_anchor', 'warning_anchor', 'rig_anchor', 'impact_anchor', 'mesh_anchor']) {
        expect(objects().some((o) => o.id === foe.variables?.[key]), key).toBe(true);
      }
      const rig = objects().find((o) => o.id === foe.variables!.rig_anchor)!;
      for (const key of ['owner', 'mesh_anchor', 'eye_left', 'eye_right', 'brow_left', 'brow_right', 'foot_left', 'foot_right', 'mouth_anchor']) {
        expect(objects().some((o) => o.id === rig.variables?.[key]), key).toBe(true);
      }
    }
    state().setPlaying(true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    step(); event('CubeResume');
    damage(hero.id, 20);
    event('CubePotion');
    expect(value('RpgHealth')).toBe(100);
    const importedFoe = objects().find((o) => o.variables?.enemy && o.variables.arena === 1)!;
    damage(importedFoe.id, 10); step(2);
    const importedRig = object(importedFoe.variables!.rig_anchor as string);
    expect(object(importedRig.variables!.eye_left as string).transform.scale[1]).toBe(0.22);
    expect(object(importedRig.variables!.mesh_anchor as string).renderer?.materialOverrides?.color).toBe('#FFF4CC');
    step(20);
    for (const foe of objects().filter((o) => o.variables?.enemy && o.variables.arena === 1)) damage(foe.id, 1000);
    step(20);
    expect(objects().find((o) => o.name === 'Arena 1 · Locked Gate')?.physics?.enabled).toBe(false);
    event('CubeRestart'); step(4);
    expect(state().activeSceneId).toBe(content.scenes![0].id);
    expect(objects().filter((o) => o.variables?.enemy)).toHaveLength(7);
    expect(value('RpgPotions')).toBe(3);
  });

  it('unlocks gates, levels up, defeats the final boss and replays a complete fresh run', async () => {
    const hero = await start();
    for (let arena = 1; arena <= 3; arena++) {
      for (const foe of objects().filter((o) => o.variables?.enemy && o.variables.arena === arena)) damage(foe.id, 1000);
      step(20);
      expect(value('RpgEnemies')).toBe(0);
      if (arena < 3) {
        const gate = objects().find((o) => o.name === `Arena ${arena} · Locked Gate`)!;
        expect(gate.physics?.enabled).toBe(false);
        const entry = objects().find((o) => o.name === `Arena ${arena + 1} · Entry Trigger`)!;
        useEditorStore.setState({ runtimeTriggers: [{ objectId: entry.id, otherObjectId: hero }] });
        step(2);
        expect(value('RpgArena')).toBe(arena + 1);
        expect(value('RpgLevel')).toBe(arena + 1);
        const fall = objects().find((o) => o.name === 'Cloud Sea · Recovery Trigger')!;
        state().updateTransform(hero, 'position', [0, -6, arena * 36]);
        useEditorStore.setState({ runtimeTriggers: [{ objectId: fall.id, otherObjectId: hero }] });
        step(4);
        expect(objects().find((o) => o.id === hero)!.transform.position[2]).toBeCloseTo(arena * 36 - 7);
      }
    }
    expect(value('RpgVictory')).toBe(true);
    expect(value('RpgCoins')).toBe(120);
    expect(state().runtimeTimeScale).toBe(0);
    event('CubeRestart');
    step(4);
    expect(value('RpgVictory')).toBe(false);
    expect(value('RpgEnemies')).toBe(3);
    expect(value('RpgLevel')).toBe(1);
    expect(value('RpgPotions')).toBe(3);
    expect(objects().filter((o) => o.variables?.enemy)).toHaveLength(7);
  });

  it('can retry after lethal damage and recover from falling without a soft lock', async () => {
    const hero = await start();
    state().updateTransform(hero, 'position', [0, 0.2, -11.5]);
    state().setRuntimeKey('KeyS', true);
    for (let i = 0; i < 300 && value('RpgHealth') === 100; i++) step();
    state().setRuntimeKey('KeyS', false);
    expect(value('RpgHealth')).toBe(80);
    expect(objects().find((o) => o.id === hero)!.transform.position[1]).toBeGreaterThan(-1);
    step(180);
    expect(objects().find((o) => o.id === hero)!.transform.position[1]).toBeCloseTo(0.12, 1);
    expect(value('RpgHealth')).toBe(80);
    damage(hero, 1000);
    expect(value('RpgDefeated')).toBe(true);
    expect(state().runtimeTimeScale).toBe(0);
    event('CubeResume');
    expect(value('RpgDefeated')).toBe(true);
    event('CubeRestart');
    step(4);
    expect(value('RpgDefeated')).toBe(false);
    expect(value('RpgHealth')).toBe(100);
  });
});
