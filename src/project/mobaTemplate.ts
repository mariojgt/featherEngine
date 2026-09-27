import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import type { GraphValue, Vector3Tuple } from '../types';
import { addMobaUI } from '../creator/mobaUI';
import {
  MOBA_HERO_SOURCE,
  MOBA_MATCH_SOURCE,
  MOBA_UNIT_SOURCE,
} from './mobaLogic';
import {
  artPart as p,
  buildRiftMap,
  laneRoutes,
  makeArt,
  towerPositions,
} from './mobaArt';
import { createHeroRig, MOBA_HEROES } from './mobaHeroes';
import { MOBA_ECONOMY_GLOBALS } from './mobaEconomy';

/** An editable three-lane battlefield. The same scene, models and graphs run in exported games. */
export async function createMobaTemplate(): Promise<string> {
  const s = useEditorStore.getState();
  for (const id of [
    'obj-player',
    'obj-ground',
    'obj-enemy',
    'obj-light',
    'obj-camera',
  ])
    if (selectActiveObjects(useEditorStore.getState()).some((o) => o.id === id))
      s.deleteObject(id);
  s.renameScene(s.activeSceneId, 'Lumen Lane · The Astral Rift');
  s.applyRenderPreset(s.activeSceneId, 'vibrant-arcade');
  s.updateSceneEnvironment(s.activeSceneId, {
    skyMode: 'procedural',
    backgroundColor: '#223a42',
    skyTopColor: '#1c334b',
    skyHorizonColor: '#9bb2ac',
    skyGroundColor: '#233a36',
    ambientMode: 'hemisphere',
    ambientIntensity: 0.85,
    environmentIntensity: 0.6,
    sunColor: '#fff0d2',
    sunIntensity: 2.3,
    sunAzimuth: 215,
    sunElevation: 55,
    fogEnabled: true,
    fogColor: '#536d69',
    fogNear: 58,
    fogFar: 145,
    toneMapping: 'agx',
    toneMappingExposure: 1.15,
    contactShadows: false,
  });
  s.updateRenderSettings({
    quality: 'High',
    autoQuality: true,
    bloomEnabled: true,
    bloomIntensity: 0.3,
    bloomThreshold: 1,
    vignetteEnabled: true,
  });
  const logic = s.createFolder('Lumen Lane · Gameplay'),
    prefabs = s.createFolder('Lumen Lane · Reusable units');
  const root = (
    name: string,
    pos: Vector3Tuple = [0, 0, 0],
    parentId?: string,
  ) => s.createObjectWithProps('empty', { name, position: pos, parentId });
  const vars = (id: string, values: Record<string, GraphValue>) => {
    for (const [key, value] of Object.entries(values))
      s.setObjectVariable(id, key, value);
  };
  const compile = (name: string, source: string) => {
    const { blueprintId } = s.createBlueprintNamed(
      name,
      'Editable Astral Rift gameplay.',
      logic,
    );
    const result = s.applyBlueprintFeatherSource(blueprintId, source.trim());
    if (!result.ok || result.diagnostics.length)
      throw Error(
        `${name}: ${result.diagnostics.map((d) => d.message).join('; ')}`,
      );
    return blueprintId;
  };
  const globals: Record<string, number | boolean | string> = {
    LLIntro: true,
    LLPlaying: false,
    LLPaused: false,
    LLDone: false,
    LLWon: false,
    LLSeconds: 0,
    LLWaveIn: 3,
    LLWaveBank: 1,
    LLWaves: 0,
    LLHealth: 520,
    LLMaxHealth: 520,
    LLRespawn: 0,
    LLAttack: 0,
    LLPulse: 0,
    LLDash: 0,
    LLUltimate: 0,
    LLRecall: 0,
    LLHeroChoice: 1,
    LLHeroName: 'Aegis',
    LLHeroRole: 'TANK',
    LLQName: 'Bulwark',
    LLRName: 'Unbroken',
    LLMintTower: 3,
    LLCoralTower: 3,
    LLMintCore: 1200,
    LLCoralCore: 1200,
    LLKills: 0,
    ...MOBA_ECONOMY_GLOBALS,
    LLAtBase: true,
  };
  for (const [name, value] of Object.entries(globals)) {
    const id = s.createVariable(
      name,
      typeof value === 'boolean'
        ? 'boolean'
        : typeof value === 'string'
          ? 'string'
          : 'number',
      false,
    );
    s.updateVariable(id, { defaultValue: value });
  }
  const unitBP = compile(
      'Rift units · Lanes, combat and animation',
      MOBA_UNIT_SOURCE,
    ),
    heroBP = compile(
      'Chosen hero · Commands and abilities',
      MOBA_UNIT_SOURCE + MOBA_HERO_SOURCE,
    ),
    matchBP = compile('Rift match · Waves and victory', MOBA_MATCH_SOURCE);
  const world = root('Lumen Lane · Match');
  buildRiftMap(world);
  const colors = {
    mint: '#62dcdb',
    coral: '#f37f89',
    dark: '#14262d',
    gold: '#edd58e',
    light: '#d1ffff',
  };
  const material = (name: string, color: string, glow = 0) => {
    const id = s.createMaterial(name, 'Rift combat material.');
    s.updateMaterial(id, {
      color,
      roughness: 0.5,
      emissiveColor: color,
      emissiveIntensity: glow,
    });
    return id;
  };
  const mats = {
    mint: material('Azure energy', colors.mint, 0.7),
    coral: material('Crimson energy', colors.coral, 0.7),
    dark: material('Obsidian', colors.dark),
    gold: material('Selection gold', colors.gold, 0.3),
    flash: material('Spell light', colors.light, 1.5),
  };
  const mesh = (
    name: string,
    pos: Vector3Tuple,
    scale: Vector3Tuple,
    mat: string,
    parent?: string,
  ) => {
    const id = s.createObjectWithProps('sphere', {
      name,
      position: pos,
      parentId: parent,
    });
    s.updateTransform(id, 'scale', scale);
    s.setObjectMaterial(id, mat);
    return id;
  };
  const actor = (
    name: string,
    team: number,
    kind: number,
    home: Vector3Tuple,
    lane = 1,
    controlled = false,
  ) => {
    const palette = [
      '#273842',
      '#53636a',
      '#bac4b8',
      team === 1 ? '#43afbf' : '#bb566f',
      '#b69a62',
      '#e6ddac',
      '#182831',
    ];
    const id = controlled
      ? s.createRoleObject('player', { kind: 'empty', name, position: home })
          .objectId!
      : root(name, home, world);
    if (controlled) {
      s.updateCharacterController(id, {
        autoInputWithScript: false,
        cameraFollow: true,
        mouseLook: false,
        cameraRelativeMovement: false,
        gravity: 0,
        groundLevel: 0,
        turnInPlace: false,
        moveSpeed: 7,
        cameraOffset: [0, 2, -26],
        cameraPitch: 0.98,
        cameraMinPitch: 0.98,
        cameraMaxPitch: 0.98,
        keyAttack: 'Unbound',
        keyJump: 'Unbound',
        keyRoll: 'Unbound',
        keySprint: 'Unbound',
        keyCrouch: 'Unbound',
        keyCrawl: 'Unbound',
        keyEmote: 'Unbound',
        keySwapShoulder: 'Unbound',
      });
      s.updatePhysics(id, { enabled: false });
    }
    let rig = root(`${name} · Rig`, [0, 0, 0], id),
      arm = rig,
      leg = rig,
      leg2 = rig,
      offarm = rig;
    if (kind === 1) {
      const options = controlled
        ? MOBA_HEROES
        : [MOBA_HEROES[lane === 0 ? 0 : lane === 2 ? 3 : 2]];
      for (const hero of options) {
        const visual = createHeroRig(id, hero, team === -1);
        vars(
          id,
          Object.fromEntries(
            Object.entries(visual).map(([key, val]) => [
              `hero${hero.id}_${key}`,
              val,
            ]),
          ),
        );
        if (controlled && hero.id !== 1)
          s.updateTransform(visual.rig, 'scale', [0, 0, 0]);
        if (!controlled || hero.id === 1)
          ({ rig, arm, leg, leg2, offarm } = visual);
      }
    } else if (kind === 0) {
      makeArt(
        `${name} · Armored minion`,
        [
          p('hexprism', [0, 0.67, 0], [0.72, 0.75, 0.55], 3),
          p('hexprism', [0, 1.22, 0], [0.71, 0.49, 0.61], 1),
          p('box', [0, 1.24, 0.33], [0.42, 0.08, 0.04], 5),
          p('cone', [0, 1.62, 0], [0.3, 0.36, 0.3], 3),
          p('box', [-0.47, 0.7, 0.05], [0.14, 0.76, 0.61], 3),
        ],
        palette,
        rig,
      );
      arm = root(`${name} · Weapon`, [0.43, 0.83, 0], rig);
      makeArt(
        `${name} · Spear`,
        [
          p('cylinder', [0, 0, 0.35], [0.09, 1.1, 0.09], 4, [
            Math.PI / 2,
            0,
            0,
          ]),
          p('cone', [0, 0, 0.98], [0.24, 0.5, 0.24], 5, [Math.PI / 2, 0, 0]),
        ],
        palette,
        arm,
      );
      leg = root(`${name} · Left stride`, [-0.2, 0.35, 0], rig);
      leg2 = root(`${name} · Right stride`, [0.2, 0.35, 0], rig);
      for (const l of [leg, leg2])
        makeArt(
          `${name} · Boot`,
          [p('box', [0, -0.14, 0.09], [0.28, 0.42, 0.43], 6)],
          palette,
          l,
        );
    } else if (kind === 4) {
      makeArt(
        `${name} · Moss sentinel`,
        [
          p('hexprism', [0, 1, 0], [2.2, 1.8, 1.6], 1),
          p('hexprism', [0, 2.15, 0], [1.4, 1.1, 1.3], 0),
          p('box', [0, 2.3, 0.68], [0.75, 0.15, 0.1], 3),
          p('hexprism', [-1.25, 1.3, 0], [0.8, 1.8, 0.9], 1, [0, 0, -0.2]),
          p('hexprism', [1.25, 1.3, 0], [0.8, 1.8, 0.9], 1, [0, 0, 0.2]),
          p('cone', [-0.4, 2.9, 0], [0.5, 0.8, 0.5], 3),
          p('cone', [0.4, 2.9, 0], [0.5, 0.8, 0.5], 3),
        ],
        palette,
        rig,
      );
    } else {
      const pieces = [
        p('cylinder', [0, 0.25, 0], [4, 0.5, 4], 0),
        p('hexprism', [0, 0.65, 0], [3.2, 0.45, 3.2], 1),
        p('torus', [0, 0.93, 0], [2.6, 2.6, 0.15], 4, [Math.PI / 2, 0, 0]),
      ];
      if (kind === 2) {
        pieces.push(
          p('hexprism', [0, 1.8, 0], [1.4, 2.1, 1.4], 1),
          p('hexprism', [0, 2.7, 0], [2.1, 0.35, 2.1], 4),
          p('pyramid', [0, 3.52, 0], [1.3, 1.5, 1.3], 3),
          p('pyramid', [0, 4.38, 0], [1.3, 0.6, 1.3], 3, [Math.PI, 0, 0]),
        );
        for (let i = 0; i < 4; i++) {
          const a = (i * Math.PI) / 2;
          pieces.push(
            p(
              'hexprism',
              [Math.cos(a) * 1.05, 1.45, Math.sin(a) * 1.05],
              [0.45, 1.6, 0.45],
              0,
            ),
          );
        }
      } else {
        pieces.push(
          p('pyramid', [0, 2, 0], [2.8, 3, 2.8], 3),
          p('pyramid', [0, 3.8, 0], [2.8, 1.4, 2.8], 3, [Math.PI, 0, 0]),
          p('torus', [0, 1.7, 0], [4.6, 4.6, 0.2], 4, [Math.PI / 2, 0, 0]),
        );
        for (let i = 0; i < 4; i++) {
          const a = (i * Math.PI) / 2;
          pieces.push(
            p(
              'pyramid',
              [Math.cos(a) * 2.1, 1.5, Math.sin(a) * 2.1],
              [0.7, 1.8, 0.7],
              5,
            ),
          );
        }
      }
      makeArt(`${name} · Runic stonework`, pieces, palette, rig);
      mesh(
        `${name} · Energy`,
        [0, kind === 2 ? 3.6 : 2.9, 0],
        [0.62, 1, 0.62],
        team === 1 ? mats.mint : mats.coral,
        rig,
      );
    }
    const h = kind === 0 ? 1.95 : kind === 1 ? 3.05 : 5;
    const backing = root(`${name} · Health backing`, [0, h, 0], id);
    makeArt(
      `${name} · Bar backing`,
      [p('box', [0, 0, 0], [kind < 2 ? 1.8 : 3, 0.13, 0.17], 0)],
      ['#0b171c'],
      backing,
    );
    const bar = root(`${name} · Health fill pivot`, [0, h + 0.035, -0.03], id);
    makeArt(
      `${name} · Health fill`,
      [p('box', [0, 0, 0], [kind < 2 ? 1.7 : 2.9, 0.1, 0.21], 0)],
      [team === 1 ? '#65d3ac' : '#e96972'],
      bar,
    );
    const effect = root(`${name} · Attack flash`, [0, 1, 0.8], rig);
    mesh(`${name} · Strike`, [0, 0, 0], [1.3, 0.16, 1.3], mats.flash, effect);
    s.updateTransform(effect, 'scale', [0, 0, 0]);
    const bolt = mesh(
      `${name} · Arc projectile`,
      home,
      [0, 0, 0],
      team === 1 ? mats.mint : mats.coral,
      world,
    );
    const hp =
      kind === 0
        ? 120
        : kind === 1
          ? controlled
            ? 520
            : 360
          : kind === 2
            ? 1000
            : kind === 4
              ? 420
              : 1200;
    const route =
      team === 1 ? laneRoutes[lane] : [...laneRoutes[lane]].reverse();
    s.attachScript(id, controlled ? heroBP : unitBP);
    vars(id, {
      tags: 'lumen-unit',
      team,
      kind,
      lane,
      controlled,
      home,
      rig,
      arm,
      offarm,
      leg,
      leg2,
      bar,
      backing,
      effect,
      bolt,
      max_hp: hp,
      hp: kind === 0 ? 0 : hp,
      damage: kind === 0 ? 18 : kind === 1 ? (controlled ? 32 : 30) : 55,
      reach:
        kind === 2
          ? 8
          : kind === 4
            ? 3
            : kind === 1
              ? controlled
                ? 2.8
                : 6
              : 2,
      cadence: kind === 2 ? 1.2 : kind === 1 ? 0.7 : 1,
      pace: kind === 1 ? 6 : 4.5,
      ...Object.fromEntries(route.map((v, i) => [`nav${i}`, v])),
    });
    return id;
  };
  const towers = new Map<number, string[]>();
  const cores = new Map<number, string>();
  for (const team of [1, -1]) {
    const title = team === 1 ? 'Mint' : 'Coral',
      ids = towerPositions.map((pos, lane) =>
        actor(
          lane === 1
            ? `${title} · Garden tower`
            : `${title} · ${lane === 0 ? 'Top' : 'Bottom'} tower`,
          team,
          2,
          [pos[0] * team, 0, pos[2] * team],
          lane,
        ),
      );
    towers.set(team, ids);
    const core = actor(`${title} · Lumen core`, team, 3, [
      team * 30,
      0,
      team * 30,
    ]);
    vars(core, {
      guardian: ids[1],
      guardian_top: ids[0],
      guardian_bot: ids[2],
    });
    cores.set(team, core);
  }
  const hero = actor('Lumen · Mint hero', 1, 1, [26, 0, 25], 1, true);
  const rival = actor('Ember · Coral rival', -1, 1, [-25, 0, -26]);
  for (const team of [1, -1])
    for (const lane of [0, 2])
      actor(
        `${team === 1 ? 'Mint' : 'Coral'} · ${lane === 0 ? 'Top guardian' : 'Bottom ranger'}`,
        team,
        1,
        [team * (lane === 0 ? 30 : 24), 0, team * (lane === 0 ? 24 : 30)],
        lane,
      );
  let firstMinion = '';
  for (const team of [1, -1])
    for (let lane = 0; lane < 3; lane++)
      for (let slot = 0; slot < 4; slot++) {
        const n = lane * 4 + slot + 1,
          id = actor(
            `${team === 1 ? 'Mint' : 'Coral'} · Sprout ${n}`,
            team,
            0,
            [team * (27 + (slot % 2) * 1.1), 0, team * (27 - (slot % 2) * 1.1)],
            lane,
          );
        vars(id, { slot: Math.floor(slot / 2) });
        if (!firstMinion) firstMinion = id;
      }
  actor('Jungle · North sentinel', 0, 4, [18, 0, -18]);
  actor('Jungle · South sentinel', 0, 4, [-18, 0, 18]);
  const marker = makeArt(
    'Lumen · Command marker',
    [
      p('torus', [0, 0.45, 0], [1.7, 1.7, 0.12], 0, [Math.PI / 2, 0, 0]),
      p('cone', [0, 0.8, 0], [0.35, 0.45, 0.35], 0, [Math.PI, 0, 0]),
    ],
    ['#b8f3b6'],
    world,
  );
  s.updateTransform(marker, 'scale', [0, 0, 0]);
  const pulseFx = makeArt(
    'Lumen · Spell sigil',
    [
      p('torus', [0, 0.5, 0], [2, 2, 0.07], 0, [Math.PI / 2, 0, 0]),
      p('torus', [0, 0.6, 0], [1.4, 1.4, 0.06], 1, [Math.PI / 2, 0, 0]),
    ],
    ['#81deed', '#fff0ba'],
    world,
  );
  s.updateTransform(pulseFx, 'scale', [0, 0, 0]);
  vars(hero, {
    marker,
    pulse_fx: pulseFx,
    pointerMoveEvent: 'LLMove',
    pointerAimVariable: 'aim_point',
    pointerAttackEvent: 'LLTarget',
    pointerTargetTag: 'lumen-unit',
    pointerPlayingVariable: 'LLPlaying',
    pointerPausedVariable: 'LLPaused',
    pointerBlockedVariable: 'LLShopOpen',
    pointerCaptureEscape: true,
    pointerBounds: 35,
    pointerMapSpan: 84,
    pointerMapPaths: JSON.stringify(laneRoutes),
  });
  s.attachScript(world, matchBP);
  vars(world, {
    mint_tower: towers.get(1)![1],
    coral_tower: towers.get(-1)![1],
    mint_core: cores.get(1)!,
    coral_core: cores.get(-1)!,
  });
  s.createPrefabFromObject(hero, 'Lumen · Five playable champions', prefabs);
  s.createPrefabFromObject(rival, 'Ember · Rival guardian', prefabs);
  s.createPrefabFromObject(
    firstMinion,
    'Sprout · Reusable lane minion',
    prefabs,
  );
  s.createPrefabFromObject(
    towers.get(1)![1],
    'Beacon · Defensive tower',
    prefabs,
  );
  addMobaUI(world);
  s.selectObject(hero);
  return hero;
}
