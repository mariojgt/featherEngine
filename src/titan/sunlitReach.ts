import type { CinematicSequence, Scene, SceneEnvironmentSettings, SceneObject, TreeSpec, Vector3Tuple } from '../types';
import { defaultSceneEnvironment } from '../three/environmentSettings';
import { pixelTreeSpec } from '../extensions/pixelArtTrees/presets';
import { TITAN_ZONE_MARKER, TITAN_SCENE_MARKER } from './settings';
import { emberMeadowEnvironment, emberMeadowScenery, starterScenery, titanSettingsVariables, type StarterProp } from './starter';
import { ZONES, type ZoneDef } from '../../examples/titan-mmo/server/world.mjs';

/**
 * The Sunlit Reach — the three-zone MMO template's authored CONTENT.
 *
 * Each zone in the authoritative rules (examples/titan-mmo/server/world.mjs) is its own coordinate
 * space, so each becomes one Feather scene carrying two named empties: the runtime marker and
 * `Realm zone · <id>`. Everything else here is ordinary editable scenery placed RELATIVE to the
 * rules' own constants — NPCs, gatherables, enemy spawns and waystones are drawn by the runtime
 * from those same numbers, so scenery must never be copied from a second, drifting source.
 *
 * There are no mesh collisions, so "blocking" is purely a matter of sight lines: props keep
 * `CLEARANCE` metres away from every anchor the rules place an actor on, stay out of the sanctuary,
 * and leave the straight waystone→spawn corridor (every waystone and spawn sits on x = 0) open.
 *
 * Deterministic by construction: fixed ids, fixed timestamps and seeded formulas only.
 */

/** Metres of empty ground kept around every NPC, gatherable, enemy spawn and waystone. */
const CLEARANCE = 3;
/** Half-width of the open corridor along x = 0 between each waystone and its zone spawn. */
const CORRIDOR = 4;
const CREATED_AT = 1767225600000;

type Point = { x: number; z: number };

/** Every point the authoritative rules stand an actor, node or rune ring on. */
const zoneAnchors = (zone: ZoneDef): Point[] => [zone.spawn, ...zone.npcs, ...zone.gatherables, ...zone.spawns, ...zone.portals];

const away = (zone: ZoneDef, x: number, z: number, pad = CLEARANCE) =>
  zoneAnchors(zone).every((anchor) => Math.hypot(anchor.x - x, anchor.z - z) >= pad);

/** Scatter test: clear of every anchor, outside the sanctuary, and off the travel corridor. */
const scatterable = (zone: ZoneDef, x: number, z: number, pad = CLEARANCE + 1) =>
  away(zone, x, z, pad)
  && Math.hypot(zone.sanctuary.x - x, zone.sanctuary.z - z) >= zone.sanctuary.radius + 1
  && Math.abs(x) >= CORRIDOR;

/** A ground slab that covers a zone's whole playable bounds with a generous margin. */
const groundFor = (zone: ZoneDef, prop: StarterProp, name: string, color: string) => {
  const { minX, maxX, minZ, maxZ } = zone.bounds;
  prop(name, 'cube', [(minX + maxX) / 2, -.5, (minZ + maxZ) / 2], [maxX - minX + 6, 1, maxZ - minZ + 6], color);
};

/** Emissive glow on a built-in mesh, the same way a runtime Set Material node would write it. */
const glow = (object: SceneObject, emissiveColor: string, emissiveIntensity: number) => {
  if (object.renderer) object.renderer.materialOverrides = { emissiveColor, emissiveIntensity };
  return object;
};

const pointLight = (prop: StarterProp, name: string, position: Vector3Tuple, color: string, intensity: number, distance: number) => {
  const object = prop(name, 'light', position, [1, 1, 1], color);
  object.light = { type: 'point', color, intensity, distance, angle: .6, castShadow: false, decay: 2 };
  return object;
};

/**
 * A waystone plinth around a portal: flat steps the runtime's rune ring sits on, two standing
 * monoliths and two lanterns — all pushed off the portal itself and off the travel corridor.
 */
function waystonePlinth(prop: StarterProp, zone: ZoneDef, label: string, at: Point, stone: string, trim: string, flame: string) {
  [7, 5.2, 3.6].forEach((size, i) => prop(`${label} · step`, 'cube', [at.x, .06 + i * .09, at.z], [size, .12 + i * .06, size], i % 2 ? trim : stone, [0, i * .26, 0]));
  // Lanterns take the first offset pair that keeps both posts off every anchor of this zone.
  const [dx, dz] = ([[4, 2.2], [4, -2.2], [5.9, 0]] as const)
    .find(([x, z]) => [-1, 1].every((side) => away(zone, at.x + side * x, at.z + z))) ?? [5.9, 0];
  for (const side of [-1, 1]) {
    prop(`${label} · monolith`, 'cube', [at.x + side * 4.2, 2.2, at.z], [1.1, 4.4, .9], stone, [0, side * .18, side * .03]);
    prop(`${label} · monolith cap`, 'cube', [at.x + side * 4.2, 4.5, at.z], [1.4, .3, 1.2], trim, [0, side * .18, 0]);
    prop(`${label} · lantern post`, 'cube', [at.x + side * dx, 1.1, at.z + dz], [.16, 2.2, .16], trim);
    glow(prop(`${label} · lantern`, 'sphere', [at.x + side * dx, 2.45, at.z + dz], [.42, .5, .42], flame), flame, 2.4);
    pointLight(prop, `${label} · lantern light`, [at.x + side * dx, 2.5, at.z + dz], flame, 9, 16);
  }
}

/** The two named empties every zone scene needs: runtime marker first, then its zone id. */
function zoneMarkers(prop: StarterProp, zoneId: string) {
  prop(TITAN_SCENE_MARKER, 'empty', [0, 0, 0], [1, 1, 1], '#fff');
  prop(`${TITAN_ZONE_MARKER}${zoneId}`, 'empty', [0, 0, 0], [1, 1, 1], '#fff');
}

// ------------------------------------------------------------------------------------------------
// Zone 1 — Ember Meadow (the hub): the one-zone starter's village, plus what the realm gained.
// ------------------------------------------------------------------------------------------------

function emberMeadowZone(): { objects: SceneObject[]; tree: TreeSpec } {
  const zone = ZONES['ember-meadow'];
  const { objects, prop, tree } = emberMeadowScenery({ prefix: 'sunlit-ember-meadow-', zoneId: 'ember-meadow', treeId: 'sunlit-tree-meadow' });
  const bram = zone.npcs.find((npc) => npc.role === 'vendor') ?? { x: -4.5, z: 2.5 };
  const gate = zone.portals[0];

  // Quartermaster Bram's market stall — beside his pitch, never on it.
  const stall: Point = { x: bram.x - .3, z: bram.z + 3.5 };
  prop('Market stall · counter', 'cube', [stall.x, .55, stall.z], [3.6, 1.1, 1.1], '#8a6a44');
  prop('Market stall · counter top', 'cube', [stall.x, 1.17, stall.z], [4, .14, 1.5], '#a9835a');
  for (const side of [-1, 1]) prop('Market stall · awning post', 'cube', [stall.x + side * 1.7, 1.4, stall.z - .7], [.16, 2.8, .16], '#6b4f33');
  prop('Market stall · awning', 'cube', [stall.x, 2.86, stall.z - .35], [4.3, .14, 2.4], '#b6674c', [.22, 0, 0]);
  prop('Market stall · crate', 'cube', [stall.x - 2.2, .45, stall.z + .6], [.9, .9, .9], '#7d6140', [0, .3, 0]);
  prop('Market stall · crate', 'cube', [stall.x - 2.1, 1.28, stall.z + .7], [.75, .75, .75], '#8b6c48', [0, -.2, 0]);
  prop('Market stall · barrel', 'capsule', [stall.x + 2.2, .55, stall.z + .8], [.5, .55, .5], '#6f5334');

  // A paved road from the village out to the Thornwood waystone. Flat, so it never blocks a path.
  for (let i = 0; i < 14; i++) {
    const z = -6 - i * 1.15;
    prop('Waystone road', 'cube', [Math.sin(i * .8) * .9, .05 + (i % 3) * .002, z], [3.4, .1, 1.3], i % 2 ? '#9d9878' : '#a8a184', [0, Math.sin(i * .55) * .1, 0]);
  }
  waystonePlinth(prop, zone, 'Thornwood waystone', gate, '#8e9a8c', '#c3c4a6', '#f0b163');

  // Two village lanterns beside the gateway — the beacon itself is already part of the starter.
  for (const side of [-1, 1]) {
    prop('Village lantern post', 'cube', [side * 6.9, 1.3, -1.2], [.18, 2.6, .18], '#6f6a4e');
    glow(prop('Village lantern', 'sphere', [side * 6.9, 2.8, -1.2], [.44, .5, .44], '#ffd489'), '#ffd489', 2.2);
    pointLight(prop, 'Village lantern light', [side * 6.9, 2.85, -1.2], '#ffd489', 8, 15);
  }
  return { objects, tree };
}

// ------------------------------------------------------------------------------------------------
// Zone 2 — Thornwood: dense, dim woodland under a closed canopy.
// ------------------------------------------------------------------------------------------------

function thornwoodZone(): { objects: SceneObject[]; trees: TreeSpec[] } {
  const zone = ZONES.thornwood;
  const { objects, prop } = starterScenery('sunlit-thornwood-');
  zoneMarkers(prop, 'thornwood');
  groundFor(zone, prop, 'Thornwood floor · editable ground', '#2c4230');

  // Moss and leaf litter: flat, so they read as ground cover rather than obstacles.
  for (let i = 0; i < 26; i++) {
    const x = Math.sin(i * 5.17) * 22; const z = -9 + Math.cos(i * 2.71) * 18;
    prop('Mossy ground', 'sphere', [x, .06, z], [4 + (i % 4), .12, 3.4 + (i % 3)], i % 3 === 0 ? '#38583a' : i % 3 === 1 ? '#2f4c33' : '#3f5f36', [0, i * .4, 0]);
  }
  // The winding dirt path between the two waystones, through the spawn.
  for (let i = 0; i < 30; i++) {
    const z = zone.portals[0].z - i * 1.35;
    prop('Thornwood path', 'cube', [Math.sin(i * .52) * 1.7, .12 + (i % 3) * .002, z], [3, .1, 1.5], i % 2 ? '#5a4a33' : '#63513a', [0, Math.cos(i * .52) * .2, 0]);
  }

  // Two bands of dark conifer and willow, left and right of the path.
  const spruce = pixelTreeSpec({ speciesId: 'pine', habit: 'candelabra', scale: 1.15, leafDensity: 1.15, leafInner: '#122b1e', leafOuter: '#2c5539' }, 'sunlit-tree-spruce', 'Thornwood spruce');
  const briar = pixelTreeSpec({ speciesId: 'willow', habit: 'ancient', scale: .95, leafDensity: .95, leafInner: '#23381f', leafOuter: '#4a6330' }, 'sunlit-tree-briar', 'Thornwood briar willow');
  for (let i = 0; i < 96; i++) {
    const side = i % 2 ? -1 : 1;
    const row = Math.floor(i / 2);
    const x = side * (5.5 + ((i * 13) % 19) * 1.05);
    const z = 11 - row * .96;
    if (!scatterable(zone, x, z, CLEARANCE + .5)) continue;
    const entry = prop('Thornwood canopy · Pixel Art Trees', 'empty', [x, 0, z], [1, 1, 1], '#fff');
    entry.tree = { enabled: true, spec: i % 3 === 2 ? briar : spruce, seed: 101 + i * 13, tintJitter: .35 };
  }

  // Fallen logs: the engine has no cylinder, so a long flattened cube plays the part.
  for (const [x, z, yaw] of [[-8.5, 1.5, .5], [9.5, -3.5, -.8], [-17, -8, 1.2], [13.5, -21, .3], [-11, -27, -.4], [6.5, 6.5, 1.5]] as const) {
    prop('Fallen log', 'cube', [x, .45, z], [.9, .9, 5.6], '#4a3826', [.06, yaw, 0]);
    const stump = { x: x + Math.sin(yaw) * 3.1, z: z + Math.cos(yaw) * 3.1 };
    if (away(zone, stump.x, stump.z)) prop('Fallen log · stump', 'cube', [stump.x, .5, stump.z], [1.2, 1, 1.2], '#3f3122', [0, yaw, 0]);
  }
  // Thorn thickets ringing the boar wallows, held a clear stride back from the spawn point.
  for (const spawn of zone.spawns.filter((entry) => entry.kind === 'boar')) {
    for (let i = 0; i < 5; i++) {
      const angle = i * 1.2566 + spawn.x * .1;
      const x = spawn.x + Math.cos(angle) * 3.8; const z = spawn.z + Math.sin(angle) * 3.8;
      if (!away(zone, x, z) || !away(zone, x + .5, z - .4)) continue;
      prop('Thorn thicket', 'sphere', [x, .55, z], [1.7 + (i % 2) * .4, 1.2, 1.6], i % 2 ? '#22351f' : '#2b3d22', [0, angle, 0]);
      prop('Thorn thicket · briar', 'sphere', [x + .5, 1.15, z - .4], [.9, .8, .9], '#1c2b1a');
    }
  }
  // Glowing mushrooms mark the moonpetal nodes without standing on them.
  for (const [index, node] of zone.gatherables.entries()) {
    for (let i = 0; i < 4; i++) {
      const angle = i * 1.5708 + index * .6;
      const x = node.x + Math.cos(angle) * 3.1; const z = node.z + Math.sin(angle) * 3.1;
      if (!away(zone, x, z)) continue;
      prop('Glowing mushroom · stalk', 'capsule', [x, .22, z], [.16, .3, .16], '#cfc6a6');
      glow(prop('Glowing mushroom · cap', 'sphere', [x, .48, z], [.62, .38, .62], '#9fe6d2'), '#79e0c4', 2.6);
      if (i === 0) pointLight(prop, 'Moonpetal glow', [x, 1, z], '#8fe4cd', 4.5, 11);
    }
  }
  // Hermit Wren's hut, set back from where she stands.
  const wren = zone.npcs[0];
  const hut: Point = { x: wren.x + 5, z: wren.z - 2 };
  prop('Wren’s hut · walls', 'cube', [hut.x, 1.35, hut.z], [4.2, 2.7, 3.8], '#4b3d2c');
  prop('Wren’s hut · roof west', 'cube', [hut.x - 1.1, 3.1, hut.z], [2.9, .3, 4.5], '#33452f', [0, 0, .62]);
  prop('Wren’s hut · roof east', 'cube', [hut.x + 1.1, 3.1, hut.z], [2.9, .3, 4.5], '#2c3b28', [0, 0, -.62]);
  prop('Wren’s hut · door', 'cube', [hut.x - 2.12, .95, hut.z], [.12, 1.9, 1], '#2f2a1e');
  glow(prop('Wren’s hut · window', 'cube', [hut.x, 1.7, hut.z + 1.92], [.6, .6, .1], '#ffcd7d'), '#ffb95f', 1.8);
  prop('Wren’s hut · chimney', 'cube', [hut.x + 1.5, 3.6, hut.z - 1], [.55, 1.7, .55], '#55503f');
  prop('Wren’s drying rack', 'cube', [hut.x - .4, .8, hut.z + 3], [2.6, .12, .12], '#5b4a33', [0, .2, 0]);

  waystonePlinth(prop, zone, 'Meadow waystone', zone.portals[0], '#6f7c6d', '#a8b291', '#f0b163');
  waystonePlinth(prop, zone, 'Cinder Keep waystone', zone.portals[1], '#6a6459', '#a09479', '#ff8a4b');

  // A few standing rocks so the canopy is not the only vertical mass.
  for (let i = 0; i < 14; i++) {
    const x = Math.cos(i * 2.39) * (10 + (i % 5) * 2.6); const z = -9 + Math.sin(i * 1.77) * 17;
    if (!scatterable(zone, x, z)) continue;
    prop('Mossy boulder', 'sphere', [x, .7, z], [2.2 + (i % 3) * .5, 1.5, 2], i % 2 ? '#47523f' : '#3d4738', [0, i, 0]);
  }
  return { objects, trees: [spruce, briar] };
}

// ------------------------------------------------------------------------------------------------
// Zone 3 — Cinder Keep: a burnt-out fortress around the Ashen Warden's courtyard.
// ------------------------------------------------------------------------------------------------

function cinderKeepZone(): SceneObject[] {
  const zone = ZONES['cinder-keep'];
  const boss = zone.spawns.find((spawn) => spawn.kind === 'boss') ?? { x: 0, z: -19 };
  // The courtyard disc matches the boss's ember-burst radius exactly, so the telegraph reads.
  const burst = 5;
  const { objects, prop } = starterScenery('sunlit-cinder-keep-');
  zoneMarkers(prop, 'cinder-keep');
  groundFor(zone, prop, 'Keep ashes · editable ground', '#39352f');

  // Drifted ash and soot, flat against the ground.
  for (let i = 0; i < 20; i++) {
    const x = Math.sin(i * 4.31) * 16; const z = -10 + Math.cos(i * 2.13) * 16;
    prop('Ash drift', 'sphere', [x, .05, z], [3.6 + (i % 3), .1, 3 + (i % 4)], i % 2 ? '#443d36' : '#4d453c', [0, i * .5, 0]);
  }
  // The cracked courtyard floor: three offset squares approximate the burst circle.
  for (let i = 0; i < 3; i++) prop('Cracked courtyard floor', 'cube', [boss.x, .04 + i * .015, boss.z], [burst * 2, .08, burst * 2], i % 2 ? '#4d332e' : '#553a33', [0, i * .524, 0]);
  for (let i = 0; i < 8; i++) {
    const angle = i * .7854;
    prop('Courtyard crack', 'cube', [boss.x + Math.cos(angle) * burst * .55, .09, boss.z + Math.sin(angle) * burst * .55], [.22, .06, burst * 1.05], '#2c1f1c', [0, angle, 0]);
  }
  // The pillar ring: offset so no pillar lands on the line the hero walks in on.
  for (let i = 0; i < 8; i++) {
    const angle = .3927 + i * .7854;
    const x = boss.x + Math.cos(angle) * 8.5; const z = boss.z + Math.sin(angle) * 8.5;
    const broken = i % 3 === 1;
    prop('Courtyard pillar · base', 'cube', [x, .3, z], [2, .6, 2], '#4f463c', [0, angle, 0]);
    prop('Courtyard pillar', 'cube', [x, .6 + (broken ? 1.5 : 2.9), z], [1.3, broken ? 3 : 5.8, 1.3], '#5a5045', [broken ? .07 : 0, angle, broken ? .09 : 0]);
    if (!broken) prop('Courtyard pillar · capital', 'cube', [x, 6.75, z], [1.7, .5, 1.7], '#6a5e50', [0, angle, 0]);
    else {
      const drum = ([[2.4, 1.2], [-2.4, -1.2], [1.2, -2.4], [-1.2, 2.4]] as const)
        .map(([dx, dz]) => ({ x: x + dx, z: z + dz })).find((spot) => away(zone, spot.x, spot.z));
      if (drum) prop('Toppled pillar drum', 'cube', [drum.x, .5, drum.z], [1.2, 1, 2.6], '#544a40', [0, angle + .5, .05]);
    }
  }
  // Braziers lighting the approach from the gate down to the courtyard.
  for (const [x, z] of [[-6.5, 1], [6.5, 1], [-7.2, -4.5], [7.2, -4.5], [-8.6, -12], [8.6, -12]] as const) {
    prop('Brazier column', 'cube', [x, .95, z], [.8, 1.9, .8], '#4a4139');
    prop('Brazier bowl', 'cube', [x, 2.05, z], [1.2, .35, 1.2], '#5c4a3c');
    glow(prop('Brazier flame', 'sphere', [x, 2.45, z], [.7, .8, .7], '#ff9a44'), '#ff7a26', 3.4);
    pointLight(prop, 'Brazier light', [x, 2.7, z], '#ff9a52', 14, 20);
  }
  // Curtain wall: stone blocks with deliberate gaps where the siege went through.
  for (let i = 0; i < 11; i++) {
    const z = 6 - i * 3.3;
    for (const side of [-1, 1]) {
      if ((i + (side > 0 ? 1 : 0)) % 5 === 3) continue;
      prop('Curtain wall block', 'cube', [side * 16.5, 2.1 - (i % 4) * .35, z], [1.6, 4.2 - (i % 4) * .7, 3], i % 2 ? '#514840' : '#5a5147', [0, side * .04, 0]);
    }
  }
  for (let i = 0; i < 9; i++) {
    const x = -14 + i * 3.5;
    if (i === 4) continue;
    prop('Curtain wall block', 'cube', [x, 2 - (i % 3) * .3, -28.5], [3.2, 4 - (i % 3) * .6, 1.6], i % 2 ? '#514840' : '#5a5147');
  }
  // The broken gatehouse the hero arrives through.
  for (const side of [-1, 1]) {
    prop('Gatehouse tower', 'cube', [side * 5.8, 3.2, 5], [3.4, 6.4, 3.4], '#554b41', [0, side * .05, 0]);
    prop('Gatehouse merlon', 'cube', [side * 5.8, 6.7, 5], [3.8, .6, 3.8], '#615647');
    prop('Gatehouse buttress', 'cube', [side * 7.9, 1.5, 5], [1.2, 3, 2.4], '#4c443c', [0, 0, side * .06]);
  }
  prop('Broken gate arch', 'cube', [0, 7.4, 5], [8.2, .9, 1.6], '#5a5045', [0, 0, .03]);
  prop('Fallen arch stone', 'cube', [3.9, .55, 7.4], [2.2, 1.1, 1.4], '#544a40', [.1, .6, .2]);

  // Guard posts watching the cinder wisps, a clear stride back from each spawn.
  for (const spawn of zone.spawns.filter((entry) => entry.kind === 'cinder-wisp')) {
    const side = spawn.x < 0 ? -1 : 1;
    const x = spawn.x + side * 3.6; const z = spawn.z + 1.4;
    prop('Guard post · barricade', 'cube', [x, .7, z], [3.2, 1.4, .7], '#4e453b', [0, side * .25, 0]);
    prop('Guard post · brace', 'cube', [x + side * 1.3, .5, z + .9], [.8, 1, .8], '#453d35', [0, side * .5, 0]);
    prop('Guard post · banner pole', 'cube', [x + side * 1.5, 1.8, z - .8], [.14, 3.6, .14], '#3c352d', [.04, 0, side * .07]);
    prop('Guard post · burnt banner', 'cube', [x + side * 1.5, 2.5, z - .4], [.1, 1.8, 1.1], '#7d3a2c', [0, 0, side * .07]);
  }

  // Captain Idris's camp, pitched beside where he stands.
  const idris = zone.npcs[0];
  const camp: Point = { x: idris.x - 4.4, z: idris.z + 1.2 };
  for (const side of [-1, 1]) prop('Camp tent · panel', 'cube', [camp.x + side * .85, 1, camp.z], [.12, 2.4, 3.4], '#6b5a44', [0, 0, side * .62]);
  prop('Camp tent · ridge', 'cube', [camp.x, 1.95, camp.z], [.18, .18, 3.6], '#4a3f30');
  prop('Camp tent · bedroll', 'cube', [camp.x, .12, camp.z + .4], [1.3, .24, 2], '#7d6b52', [0, .1, 0]);
  prop('Camp crate', 'cube', [camp.x + 2, .4, camp.z + 2], [.8, .8, .8], '#5d4d38', [0, .4, 0]);
  const fire: Point = { x: idris.x - 2.2, z: idris.z + 2.6 };
  for (let i = 0; i < 5; i++) prop('Camp fire · log', 'cube', [fire.x + Math.cos(i * 1.2566) * .5, .12, fire.z + Math.sin(i * 1.2566) * .5], [.22, .22, 1.1], '#3f3327', [0, i * 1.2566, 0]);
  glow(prop('Camp fire', 'sphere', [fire.x, .38, fire.z], [.8, .7, .8], '#ffa04a'), '#ff7a26', 3.2);
  pointLight(prop, 'Camp fire light', [fire.x, .9, fire.z], '#ffa45c', 11, 14);

  // Rubble everywhere except the courtyard itself, which has to read as a clean burst ring.
  for (let i = 0; i < 40; i++) {
    const x = Math.sin(i * 3.71) * 15; const z = -10 + Math.cos(i * 1.93) * 15;
    if (!scatterable(zone, x, z)) continue;
    if (Math.hypot(boss.x - x, boss.z - z) < burst + 2.5) continue;
    prop(i % 3 === 0 ? 'Scorched rubble' : 'Fallen masonry', i % 3 === 0 ? 'sphere' : 'cube', [x, .35 + (i % 3) * .1, z], [1.1 + (i % 4) * .4, .7 + (i % 3) * .3, 1 + (i % 2) * .6], i % 2 ? '#4a423a' : '#544a41', [0, i * .7, (i % 5) * .03]);
  }
  return objects;
}

// ------------------------------------------------------------------------------------------------
// Cinematics — authored as data so they survive package import and stay editable.
// ------------------------------------------------------------------------------------------------

const keyframe = (time: number, position: Vector3Tuple, lookAt: Vector3Tuple, fov: number) => ({ time, position, lookAt, fov });

/** The login vista: one slow pass over the hub before the player picks a class. */
const hubCinematic = (): CinematicSequence => ({
  id: 'sunlit-cine-hub', name: 'The Sunlit Reach · Login vista', duration: 36, frameRate: 24, autoplay: true, skippable: true,
  look: { letterbox: 2.2, grade: 'warm', gradeIntensity: .8, grain: .08, vignette: .25 },
  actions: [
    { id: 'sunlit-cine-hub-fade', type: 'fade', time: 0, duration: 1.4, fadeFrom: 1, fadeTo: 0, fadeColor: '#0b0d10', label: 'Dawn over the meadow' },
    { id: 'sunlit-cine-hub-fly', type: 'camera', time: 0, duration: 36, interpolation: 'smooth', label: 'Village square → gateway → trail → woodland → gate',
      keyframes: [
        keyframe(0, [-15, 9.5, 19], [0, 1.6, 1], 48),
        keyframe(6, [-5.5, 6.8, 12.5], [0, 2, 0], 50),
        keyframe(12, [0, 7.4, 4.5], [0, 4.8, -5], 46),
        keyframe(18, [2.8, 6.2, -8], [0, 1.6, -16], 52),
        keyframe(24, [-9, 11.5, -19.5], [0, 2.2, -22.5], 55),
        keyframe(30, [13.5, 13, -13], [0, 3, -3], 44),
        keyframe(36, [6.5, 9, 10.5], [0, 3.6, -5], 42),
      ] },
    { id: 'sunlit-cine-hub-credit', type: 'text', time: 1.5, duration: 3.5, text: 'A FEATHER × TITAN WORLD', textStyle: 'credit', textColor: '#e7dcc4' },
    { id: 'sunlit-cine-hub-title', type: 'text', time: 5, duration: 4.5, text: 'THE SUNLIT REACH', textStyle: 'title', textColor: '#ffeccb' },
    { id: 'sunlit-cine-hub-chapter', type: 'text', time: 12, duration: 4, text: 'Ember Meadow · Chapter 01', textStyle: 'lowerThird', textColor: '#f2e6cd' },
    { id: 'sunlit-cine-hub-realm', type: 'text', time: 22, duration: 4, text: 'Three zones. One realm. Bring your friends.', textStyle: 'credit', textColor: '#e7dcc4' },
    { id: 'sunlit-cine-hub-enter', type: 'text', time: 30, duration: 5, text: 'Choose your class and enter the meadow', textStyle: 'subtitle', textColor: '#ffeccb' },
  ],
  createdAt: CREATED_AT,
});

/**
 * An arrival sting: drop in above the waystone the hero just stepped out of, sweep down past the
 * zone's quest giver and settle behind the spawn looking into the zone, where gameplay takes over.
 */
const arrivalCinematic = (zoneId: 'thornwood' | 'cinder-keep', name: string, look: CinematicSequence['look']): CinematicSequence => {
  const zone = ZONES[zoneId];
  const gate = zone.portals[0];
  const npc = zone.npcs[0];
  const behind = zone.spawn.z + 5.5;
  return {
    id: `sunlit-cine-${zoneId}`, name, duration: 5.5, frameRate: 24, autoplay: true, skippable: true, look,
    actions: [
      { id: `sunlit-cine-${zoneId}-fade`, type: 'fade', time: 0, duration: 1, fadeFrom: 1, fadeTo: 0, fadeColor: '#07080b', label: 'Step out of the waystone' },
      { id: `sunlit-cine-${zoneId}-arrive`, type: 'camera', time: 0, duration: 5.5, interpolation: 'smooth', label: 'Waystone → spawn → into the zone',
        keyframes: [
          keyframe(0, [gate.x, 17, gate.z + 11], [gate.x, 1, gate.z], 54),
          keyframe(2, [gate.x, 11, gate.z + 7], [npc.x * .4, 1.2, zone.spawn.z], 50),
          keyframe(4, [npc.x * .5, 7, behind + 1.5], [npc.x, 1.2, npc.z], 46),
          keyframe(5.5, [zone.spawn.x, 5.6, behind], [zone.spawn.x, 1.5, zone.spawn.z - 7], 45),
        ] },
    ],
    createdAt: CREATED_AT,
  };
};

const thornwoodEnvironment = (): SceneEnvironmentSettings => ({ ...defaultSceneEnvironment(),
  skyTopColor: '#3d4a3f', skyHorizonColor: '#7c8465', skyGroundColor: '#222c22', sunColor: '#ffb277', sunIntensity: 1.35,
  sunAzimuth: 230, sunElevation: 14, fogColor: '#3f5340', fogNear: 18, fogFar: 60, contactShadows: false,
  ambientMode: 'hemisphere', environmentIntensity: .55 });

const cinderKeepEnvironment = (): SceneEnvironmentSettings => ({ ...defaultSceneEnvironment(),
  skyTopColor: '#2a1d3a', skyHorizonColor: '#b4523a', skyGroundColor: '#1e1714', sunColor: '#ff7a3c', sunIntensity: 1.5,
  sunAzimuth: 300, sunElevation: 8, fogColor: '#5b4a42', fogNear: 14, fogFar: 55, contactShadows: false,
  ambientMode: 'hemisphere', environmentIntensity: .5 });

/**
 * Pure package authoring for the three-zone template: the same shape as `emberMeadowContent()`,
 * with one scene per authoritative zone. Deterministic — two calls are deep-equal.
 */
export function sunlitReachContent(): { scenes: Scene[]; treeSpecs: TreeSpec[]; variables: ReturnType<typeof titanSettingsVariables> } {
  const hub = emberMeadowZone();
  const thornwood = thornwoodZone();
  return {
    scenes: [
      { id: 'scene-sunlit-ember-meadow', name: 'Ember Meadow', objects: hub.objects, environment: emberMeadowEnvironment(), cinematics: [hubCinematic()] },
      { id: 'scene-sunlit-thornwood', name: 'Thornwood', objects: thornwood.objects, environment: thornwoodEnvironment(),
        cinematics: [arrivalCinematic('thornwood', 'Thornwood · Arrival', { grade: 'cool' })] },
      { id: 'scene-sunlit-cinder-keep', name: 'Cinder Keep', objects: cinderKeepZone(), environment: cinderKeepEnvironment(),
        cinematics: [arrivalCinematic('cinder-keep', 'Cinder Keep · Arrival', { grade: 'warm', vignette: .3 })] },
    ],
    treeSpecs: [hub.tree, ...thornwood.trees],
    variables: titanSettingsVariables('sunlit-'),
  };
}
