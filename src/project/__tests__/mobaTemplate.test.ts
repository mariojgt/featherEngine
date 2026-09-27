import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createMobaTemplate } from '../mobaTemplate';
import { MOBA_HEROES } from '../mobaHeroes';
import { blankProject } from '../serialize';
import { buildPackage, remapPackageForImport } from '../package';
import { validateRuntimeReferences } from '../runtimeCompatibility';
import { selectActiveObjects, useEditorStore } from '../../store/editorStore';
import { scanBlueprintGraphProblems } from '../../store/editor/graphDiagnostics';
import { initRapier } from '../../runtime/physicsWorld';
import { evalExpression } from '../../ui/expression';
import type { GraphValue, UIElement, Vector3Tuple } from '../../types';
const state = () => useEditorStore.getState();
const objects = () => selectActiveObjects(state());
const object = (name: string) => objects().find((o) => o.name === name)!;
const byId = (id: string) => objects().find((o) => o.id === id)!;
const frames = (n = 1, dt = 1 / 60) => {
  for (let i = 0; i < n; i++) state().tickRuntime(dt);
};
const value = (name: string) =>
  state().runtimeVariableValues[
    state().variables.find((v) => v.name === name)!.id
  ];
const rv = (id: string, name: string) =>
  state().runtimeObjectVariables[id]?.[name];
const vars = (id: string, values: Record<string, GraphValue>) =>
  useEditorStore.setState((s) => ({
    runtimeObjectVariables: {
      ...s.runtimeObjectVariables,
      [id]: { ...s.runtimeObjectVariables[id], ...values },
    },
  }));
const event = (name: string, payload?: GraphValue) => {
  if (payload !== undefined)
    useEditorStore.setState((s) => ({
      runtimeEventPayloads: {
        ...s.runtimeEventPayloads,
        [name.toLowerCase()]: payload,
      },
    }));
  state().fireCustomEvent(name);
  frames(4);
};
const teleport = (id: string, pos: Vector3Tuple) =>
  state().updateTransform(id, 'position', pos);
const units = () => objects().filter((o) => o.variables?.tags === 'lumen-unit');
const flatten = (root: UIElement): UIElement[] => [
  root,
  ...root.children.flatMap(flatten),
];
async function setup(heroId = 1) {
  const hero = await createMobaTemplate();
  state().setPlaying(true);
  frames(3);
  event(`LLHero${heroId}`);
  event('LLStart');
  return hero;
}
function isolate() {
  state().setRuntimeVariableByName('LLWaveIn', 999);
  for (const u of units())
    if (!u.variables?.controlled)
      vars(u.id, { pace: 0, damage: 0, cooldown: 100 });
}
beforeAll(async () => {
  await initRapier();
});
beforeEach(() => {
  state().setPlaying(false);
  state().loadProject(blankProject('Rift test'));
});
afterEach(() => state().setPlaying(false));

describe('Astral Rift compiled gameplay', () => {
  it('builds three lane armies, a following camera, five editable heroes and valid UI/graphs', async () => {
    const hero = await createMobaTemplate();
    expect(objects().length).toBeLessThan(750);
    expect(units()).toHaveLength(40);
    expect(units().filter((o) => o.variables?.kind === 1)).toHaveLength(6);
    expect(units().filter((o) => o.variables?.kind === 2)).toHaveLength(6);
    expect(byId(hero).character).toMatchObject({
      cameraFollow: true,
      mouseLook: false,
      autoInputWithScript: false,
    });
    expect(object('Lumen Lane · Match').character?.cameraFollow).not.toBe(true);
    expect(state().prefabs).toHaveLength(4);
    expect(state().modelSpecs.length).toBeGreaterThan(50);
    expect(state().assets).toHaveLength(0);
    for (const bp of state().blueprints)
      expect(
        scanBlueprintGraphProblems(
          bp,
          state().graphs.find((g) => g.id === bp.graphId)!,
          state().variables,
        ),
      ).toEqual([]);
    const context = Object.fromEntries(
      state().variables.map((v) => [v.name, v.defaultValue]),
    );
    for (const el of flatten(state().uiDocuments[0].root))
      for (const b of el.bindings)
        expect(
          evalExpression(b.expression, { vars: context }),
          `${el.name}: ${b.expression}`,
        ).not.toBeUndefined();
    expect(
      flatten(state().uiDocuments[0].root).map((el) => el.onClickEvent),
    ).toEqual(
      expect.arrayContaining([
        'LLHero1',
        'LLHero2',
        'LLHero3',
        'LLHero4',
        'LLHero5',
        'LLStart',
        'LLRecall',
        'LLUltimate',
        'LLShopToggle',
        'LLBuy1',
        'LLSell6',
      ]),
    );
  });
  it.each(MOBA_HEROES)(
    'selects $name with its own model, health, reach and damage; selection is locked in battle',
    async (hero) => {
      const id = await setup(hero.id);
      isolate();
      expect(value('LLHeroName')).toBe(hero.name);
      expect(rv(id, 'max_hp')).toBe(hero.hp);
      expect(rv(id, 'reach')).toBe(hero.reach);
      expect(rv(id, 'damage')).toBe(hero.damage);
      for (const choice of MOBA_HEROES)
        expect(
          byId(String(rv(id, `hero${choice.id}_rig`))).transform.scale,
        ).toEqual(choice.id === hero.id ? [1, 1, 1] : [0, 0, 0]);
      event(`LLHero${hero.id === 5 ? 1 : 5}`);
      expect(value('LLHeroName')).toBe(hero.name);
      event('LLChooseAgain');
      event('LLHero3');
      event('LLStart');
      expect(value('LLHeroName')).toBe('Lyra');
      expect(rv(id, 'max_hp')).toBe(290);
    },
  );
  it('moves from a click command, animates, arrives, stops, clamps the map and freezes while paused', async () => {
    const id = await setup();
    isolate();
    teleport(id, [5, 0, 5]);
    frames(10);
    const rig = String(rv(id, 'rig'));
    expect(Math.abs(byId(rig).transform.position[1])).toBeGreaterThan(0.001);
    event('LLMove', [0, 0, 0]);
    frames(5, 0.1);
    expect(byId(id).transform.position[0]).toBeLessThan(4);
    expect(
      Math.abs(byId(String(rv(id, 'leg'))).transform.rotation[0]),
    ).toBeGreaterThan(0.1);
    frames(15, 0.1);
    expect(
      Math.hypot(
        ...[byId(id).transform.position[0], byId(id).transform.position[2]],
      ),
    ).toBeLessThan(1.5);
    expect(rv(id, 'ordered')).toBe(false);
    event('LLMove', [10, 0, 10]);
    state().setRuntimeKey('KeyS', true);
    frames(2);
    state().setRuntimeKey('KeyS', false);
    const stopped = [...byId(id).transform.position];
    frames(10);
    expect(byId(id).transform.position).toEqual(stopped);
    event('LLPause');
    const seconds = value('LLSeconds');
    event('LLMove', [-10, 0, -10]);
    event('LLPulse');
    frames(20, 0.1);
    expect(byId(id).transform.position).toEqual(stopped);
    expect(value('LLSeconds')).toBe(seconds);
    expect(rv(id, 'pulse')).toBe(0);
    event('LLPause');
    teleport(id, [50, 0, 50]);
    frames(1);
    expect(byId(id).transform.position).toEqual([35, 0, 35]);
  });
  it('chases the selected enemy, auto-attacks within reach and stops chasing a dead target', async () => {
    const id = await setup(4);
    isolate();
    const rival = object('Ember · Coral rival').id;
    teleport(id, [12, 0, 12]);
    teleport(rival, [0, 0, 0]);
    event('LLTarget', rival);
    frames(24, 0.1);
    expect(Number(rv(rival, 'hp'))).toBeLessThan(360);
    expect(
      Math.hypot(
        byId(id).transform.position[0],
        byId(id).transform.position[2],
      ),
    ).toBeLessThan(8.8);
    expect(rv(id, 'attack_order')).toBe(rival);
    vars(rival, { hp: 0 });
    frames(2);
    expect(rv(id, 'attack_order')).toBe('');
    expect(rv(id, 'ordered')).toBe(false);
  });
  it('sends waves along all three routes and reuses a bounded pool', async () => {
    await setup();
    const count = objects().length;
    state().setRuntimeVariableByName('LLWaveIn', 0);
    frames(4);
    expect(
      units().filter(
        (o) => o.variables?.kind === 0 && Number(rv(o.id, 'hp')) > 0,
      ),
    ).toHaveLength(12);
    frames(80, 0.1);
    const top = object('Mint · Sprout 1'),
      mid = object('Mint · Sprout 5'),
      bottom = object('Mint · Sprout 9');
    expect(
      top.transform.position[0] - top.transform.position[2],
    ).toBeGreaterThan(12);
    expect(
      Math.abs(mid.transform.position[0] - mid.transform.position[2]),
    ).toBeLessThan(5);
    expect(
      bottom.transform.position[2] - bottom.transform.position[0],
    ).toBeGreaterThan(12);
    for (let wave = 0; wave < 12; wave++) {
      state().setRuntimeVariableByName('LLWaveIn', 0);
      frames(4);
    }
    expect(units().filter((o) => o.variables?.kind === 0)).toHaveLength(24);
    expect(objects()).toHaveLength(count);
  });
  it('gives the mage a ranged blast, support team healing, tank sustain and ability cooldowns', async () => {
    const id = await setup(3);
    isolate();
    teleport(id, [0, 0, 0]);
    const rival = object('Ember · Coral rival').id;
    teleport(rival, [9, 0, 0]);
    event('LLMove', [9, 0, 0]);
    vars(id, { ordered: false });
    event('LLPulse');
    expect(rv(rival, 'hp')).toBe(260);
    event('LLPulse');
    expect(rv(rival, 'hp')).toBe(260);
    event('LLChooseAgain');
    event('LLHero5');
    event('LLStart');
    isolate();
    teleport(id, [0, 0, 0]);
    const ally = object('Mint · Top guardian').id;
    teleport(ally, [1, 0, 0]);
    vars(ally, { hp: 100 });
    event('LLPulse');
    expect(rv(ally, 'hp')).toBe(195);
    event('LLUltimate');
    expect(rv(ally, 'hp')).toBe(360);
    expect(Number(rv(id, 'ultimate'))).toBeGreaterThan(24);
    event('LLChooseAgain');
    event('LLHero1');
    event('LLStart');
    isolate();
    teleport(id, [0, 0, 0]);
    vars(id, { hp: 200 });
    event('LLPulse');
    expect(rv(id, 'hp')).toBe(270);
    event('LLDash');
    frames(5, 0.1);
    expect(
      Math.hypot(
        byId(id).transform.position[0],
        byId(id).transform.position[2],
      ),
    ).toBeGreaterThan(2);
    expect(Number(rv(id, 'dash'))).toBeGreaterThan(4);
  });
  it('recalls after a channel, cancels on damage or a new order, and returns to base', async () => {
    const id = await setup();
    isolate();
    teleport(id, [0, 0, 0]);
    event('LLRecall');
    frames(10, 0.1);
    expect(Number(rv(id, 'recall'))).toBeGreaterThan(1);
    event('LLMove', [5, 0, 5]);
    expect(rv(id, 'recall')).toBe(0);
    event('LLRecall');
    vars(id, { incoming: 5 });
    frames(2);
    expect(rv(id, 'recall')).toBe(0);
    frames(15);
    event('LLRecall');
    frames(32, 0.1);
    expect(byId(id).transform.position).toEqual([26, 0, 25]);
  });
  it('towers prefer minions and a core becomes vulnerable after any one lane falls', async () => {
    const hero = await setup();
    isolate();
    const tower = object('Coral · Garden tower').id,
      minion = object('Mint · Sprout 5').id,
      core = object('Coral · Lumen core').id;
    teleport(hero, [-12, 0, -12]);
    teleport(minion, [-10, 0, -10]);
    vars(minion, { hp: 120 });
    vars(tower, { cooldown: 0, damage: 55 });
    frames(5, 0.1);
    expect(rv(tower, 'target')).toBe(minion);
    expect(rv(minion, 'hp')).toBe(65);
    vars(core, { incoming: 9000 });
    frames(2);
    expect(rv(core, 'hp')).toBe(1200);
    vars(object('Coral · Top tower').id, { incoming: 9000 });
    frames(3);
    vars(core, { incoming: 9000 });
    frames(4);
    expect(value('LLWon')).toBe(true);
    expect(value('LLDone')).toBe(true);
    event('LLStart');
    expect(value('LLDone')).toBe(false);
    expect(rv(core, 'hp')).toBe(1200);
    expect(rv(tower, 'hp')).toBe(1000);
  });
  it('respawns heroes and jungle camps, awards gold, and restores a defeated match', async () => {
    const id = await setup();
    isolate();
    teleport(id, [0, 0, 0]);
    vars(id, { incoming: 9000 });
    frames(2);
    expect(rv(id, 'hp')).toBe(0);
    event('LLPulse');
    expect(rv(id, 'pulse')).toBe(0);
    frames(82, 0.1);
    expect(rv(id, 'hp')).toBe(520);
    const camp = object('Jungle · North sentinel').id;
    const beforeCamp = Number(value('LLGold'));
    vars(camp, { incoming: 9000, credited: true });
    frames(2);
    expect(rv(camp, 'hp')).toBe(0);
    expect(value('LLGold')).toBe(beforeCamp + 100);
    frames(302, 0.1);
    expect(rv(camp, 'hp')).toBe(420);
    vars(object('Mint · Garden tower').id, { incoming: 9000 });
    frames(3);
    vars(object('Mint · Lumen core').id, { incoming: 9000 });
    frames(4);
    expect(value('LLDone')).toBe(true);
    expect(value('LLWon')).toBe(false);
    event('LLStart');
    expect(value('LLPlaying')).toBe(true);
    expect(value('LLGold')).toBe(500);
  });
  it('starts with gold, buys and sells real stats, blocks duplicates and enforces four slots', async () => {
    const id = await setup();
    isolate();
    expect(value('LLGold')).toBe(500);
    event('LLBuy1');
    expect(value('LLGold')).toBe(200);
    expect(value('LLOwned1')).toBe(true);
    expect(rv(id, 'damage')).toBe(48);
    event('LLBuy1');
    expect(value('LLGold')).toBe(200);
    expect(value('LLInventoryCount')).toBe(1);
    event('LLBuy2');
    expect(value('LLOwned2')).toBe(false);
    expect(String(value('LLShopMessage'))).toContain('Not enough gold');
    state().setRuntimeVariableByName('LLGold', 2000);
    event('LLBuy3');
    event('LLBuy4');
    event('LLBuy5');
    expect(value('LLInventoryCount')).toBe(4);
    expect(rv(id, 'max_hp')).toBe(700);
    expect(rv(id, 'armor')).toBe(6);
    expect(rv(id, 'pace')).toBe(7.2);
    expect(rv(id, 'cadence')).toBeCloseTo(0.52);
    event('LLBuy6');
    expect(value('LLOwned6')).toBe(false);
    expect(String(value('LLShopMessage'))).toContain('Inventory full');
    const gold = Number(value('LLGold'));
    event('LLSell3');
    expect(value('LLGold')).toBe(gold + 245);
    expect(rv(id, 'max_hp')).toBe(520);
    expect(rv(id, 'hp')).toBeLessThanOrEqual(520);
    expect(rv(id, 'armor')).toBe(0);
    event('LLSell3');
    expect(value('LLGold')).toBe(gold + 245);
    expect(value('LLInventoryCount')).toBe(3);
    event('LLBuy6');
    expect(rv(id, 'max_hp')).toBe(600);
    expect(rv(id, 'spell_power')).toBe(20);
  });
  it('allows browsing anywhere, blocks combat orders while shopping and restricts trades to the living at base', async () => {
    const id = await setup();
    isolate();
    teleport(id, [0, 0, 0]);
    event('LLMove', [5, 0, 5]);
    event('LLShopToggle');
    expect(value('LLShopOpen')).toBe(true);
    expect(rv(id, 'ordered')).toBe(false);
    const position = [...byId(id).transform.position];
    event('LLMove', [10, 0, 10]);
    event('LLTarget', object('Ember · Coral rival').id);
    event('LLPulse');
    event('LLDash');
    event('LLRecall');
    expect(rv(id, 'pulse')).toBe(0);
    expect(rv(id, 'dash')).toBe(0);
    expect(rv(id, 'recall')).toBe(0);
    expect(byId(id).transform.position).toEqual(position);
    const seconds = Number(value('LLSeconds'));
    frames(20, 0.1);
    expect(Number(value('LLSeconds'))).toBeGreaterThan(seconds + 1.9);
    event('LLBuy1');
    expect(value('LLInventoryCount')).toBe(0);
    expect(String(value('LLShopMessage'))).toContain('Return to base');
    teleport(id, [26, 0, 25]);
    vars(id, { hp: 0, respawn: 8 });
    event('LLBuy1');
    expect(value('LLInventoryCount')).toBe(0);
    vars(id, { hp: 520 });
    event('LLBuy1');
    expect(value('LLInventoryCount')).toBe(1);
    teleport(id, [0, 0, 0]);
    event('LLSell1');
    expect(value('LLInventoryCount')).toBe(1);
    event('LLPause');
    expect(value('LLShopOpen')).toBe(false);
    teleport(id, [26, 0, 25]);
    event('LLSell1');
    expect(value('LLInventoryCount')).toBe(1);
  });
  it('item armor reduces basic hits and spell power improves ability damage and support healing', async () => {
    const id = await setup(3);
    isolate();
    event('LLBuy2');
    expect(rv(id, 'spell_power')).toBe(35);
    state().setRuntimeVariableByName('LLGold', 350);
    event('LLBuy3');
    teleport(id, [0, 0, 0]);
    const rival = object('Ember · Coral rival').id;
    teleport(rival, [1, 0, 0]);
    vars(rival, { target: id, damage: 30, cooldown: 0 });
    useEditorStore.setState({ runtimeActorEvents: { [rival]: ['llhit'] } });
    frames(3);
    expect(rv(id, 'hp')).toBe(470 - 24);
    event('LLPulse');
    expect(rv(rival, 'hp')).toBe(225);
    event('LLChooseAgain');
    event('LLHero5');
    event('LLStart');
    isolate();
    event('LLBuy2');
    teleport(id, [0, 0, 0]);
    const ally = object('Mint · Top guardian').id;
    teleport(ally, [1, 0, 0]);
    vars(ally, { hp: 100 });
    event('LLPulse');
    expect(rv(ally, 'hp')).toBe(230);
  });
  it('earns passive and combat gold, pauses income, keeps items on death and resets a new match', async () => {
    const id = await setup();
    isolate();
    event('LLBuy1');
    frames(30, 0.1);
    expect(value('LLGold')).toBe(206);
    event('LLPause');
    frames(30, 0.1);
    expect(value('LLGold')).toBe(206);
    event('LLPause');
    teleport(id, [0, 0, 0]);
    vars(id, { incoming: 9000 });
    frames(2);
    frames(82, 0.1);
    expect(rv(id, 'hp')).toBe(520);
    expect(rv(id, 'damage')).toBe(48);
    expect(value('LLOwned1')).toBe(true);
    const rival = object('Ember · Coral rival').id;
    const gold = Number(value('LLGold'));
    vars(rival, { incoming: 9000, credited: true });
    frames(2);
    expect(value('LLGold')).toBe(gold + 150);
    expect(String(value('LLIncomeMessage'))).toContain('150');
    event('LLStart');
    expect(value('LLGold')).toBe(500);
    expect(value('LLInventoryCount')).toBe(0);
    expect(value('LLOwned1')).toBe(false);
    expect(rv(id, 'damage')).toBe(32);
  });
  it('lets enemy AI break an undefended lane and supports a complete ranged-hero victory', async () => {
    const hero = await setup(4);
    for (let i = 0; i < 4000 && !value('LLDone'); i++) state().tickRuntime(0.1);
    expect(Number(value('LLMintTower'))).toBeLessThan(3);
    event('LLStart');
    let retreat = false;
    for (let i = 0; i < 5000 && !value('LLDone'); i++) {
      const hp = Number(rv(hero, 'hp')),
        max = Number(rv(hero, 'max_hp'));
      if (hp < 90) retreat = true;
      if (hp > max * 0.94) retreat = false;
      if (hp > 0 && i % 5 === 0) {
        const pos = byId(hero).transform.position;
        const targets = units().filter(
          (o) =>
            o.variables?.team === -1 &&
            Number(rv(o.id, 'hp')) > 0 &&
            rv(o.id, 'exposed') === true,
        );
        targets.sort(
          (a, b) =>
            Math.hypot(
              a.transform.position[0] - pos[0],
              a.transform.position[2] - pos[2],
            ) -
            Math.hypot(
              b.transform.position[0] - pos[0],
              b.transform.position[2] - pos[2],
            ),
        );
        if (retreat) {
          if (Number(rv(hero, 'recall')) <= 0) event('LLRecall');
        } else if (targets[0]) {
          event('LLTarget', targets[0].id);
          if (
            Math.hypot(
              targets[0].transform.position[0] - pos[0],
              targets[0].transform.position[2] - pos[2],
            ) < 10
          ) {
            if (Number(rv(hero, 'pulse')) <= 0) event('LLPulse');
            if (Number(rv(hero, 'ultimate')) <= 0) event('LLUltimate');
          }
        }
      }
      state().tickRuntime(0.1);
    }
    expect(value('LLDone')).toBe(true);
    expect(value('LLWon')).toBe(true);
  });
  it('preserves models and remaps actor references through a real package round trip', async () => {
    await createMobaTemplate();
    const collected = state().buildProjectPackage();
    const pkg = buildPackage('project', collected.content, state().assets, {
      id: 'rift-test',
      name: 'Astral Rift',
      version: '2.1.0',
    });
    const mapped = remapPackageForImport(
      JSON.parse(JSON.stringify(pkg)),
      [],
      [],
    );
    const project = {
      ...state().exportProject(),
      ...mapped.content,
      assets: mapped.assets,
      activeSceneId: mapped.content.scenes![0].id,
    };
    expect(
      validateRuntimeReferences(project, project.activeSceneId).errors,
    ).toEqual([]);
    state().loadProject(project);
    const ids = new Set(objects().map((o) => o.id));
    for (const u of units())
      for (const key of [
        'rig',
        'arm',
        'leg',
        'leg2',
        'bar',
        'backing',
        'effect',
        'bolt',
      ])
        expect(ids.has(String(u.variables?.[key]))).toBe(true);
    state().setPlaying(true);
    frames(3);
    event('LLHero4');
    event('LLStart');
    const hero = units().find((o) => o.variables?.controlled)!.id;
    expect(value('LLHeroName')).toBe('Kestrel');
    event('LLMove', [20, 0, 20]);
    frames(10, 0.1);
    expect(byId(hero).transform.position[0]).toBeLessThan(25);
  });
});
