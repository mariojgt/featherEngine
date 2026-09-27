import { useEditorStore } from '../store/editorStore';
import { artPart as p, makeArt } from './mobaArt';
import type { ModelPart, Vector3Tuple } from '../types';
export const MOBA_HEROES = [
  {
    id: 1,
    name: 'Aegis',
    role: 'TANK',
    title: 'The oathkeeper',
    color: '#6eabc1',
    hp: 520,
    damage: 32,
    reach: 2.8,
    pace: 6,
    cadence: 0.65,
    q: 'Bulwark',
    qDescription: 'Slam nearby enemies and restore your health.',
    r: 'Unbroken',
    description: 'Heavy armor · close combat · self healing',
    weapon: 'hammer',
  },
  {
    id: 2,
    name: 'Briar',
    role: 'JUNGLER',
    title: 'The wild blade',
    color: '#86b66b',
    hp: 340,
    damage: 46,
    reach: 2.7,
    pace: 7.8,
    cadence: 0.48,
    q: 'Fang rush',
    qDescription: 'A quick cleave for heavy damage around you.',
    r: 'Wild hunt',
    description: 'Fast movement · burst damage · short cooldowns',
    weapon: 'blades',
  },
  {
    id: 3,
    name: 'Lyra',
    role: 'MID / MAGE',
    title: 'The starweaver',
    color: '#a391d1',
    hp: 290,
    damage: 29,
    reach: 8,
    pace: 6.4,
    cadence: 0.85,
    q: 'Astral bloom',
    qDescription: 'Blast the area around your cursor, within 12 metres.',
    r: 'Supernova',
    description: 'Ranged magic · area control · fragile',
    weapon: 'staff',
  },
  {
    id: 4,
    name: 'Kestrel',
    role: 'RANGED CARRY',
    title: 'The dusk ranger',
    color: '#cfab67',
    hp: 310,
    damage: 42,
    reach: 8.5,
    pace: 6.8,
    cadence: 0.6,
    q: 'Piercing volley',
    qDescription: 'Strike all enemies around your attack target.',
    r: 'Arrow storm',
    description: 'Long range · steady damage · evasive dash',
    weapon: 'bow',
  },
  {
    id: 5,
    name: 'Sera',
    role: 'SUPPORT',
    title: 'The dawn herald',
    color: '#6ccbbb',
    hp: 360,
    damage: 23,
    reach: 6.5,
    pace: 6.5,
    cadence: 0.8,
    q: 'Daybreak',
    qDescription: 'Heal nearby allies while damaging enemies.',
    r: 'Sanctuary',
    description: 'Team healing · ranged attacks · group protection',
    weapon: 'lantern',
  },
] as const;
export function createHeroRig(
  parent: string,
  hero: (typeof MOBA_HEROES)[number],
  enemy = false,
) {
  const s = useEditorStore.getState();
  const palette = [
    '#15252c',
    '#3d5460',
    hero.color,
    '#d4bc80',
    '#eee4cc',
    '#66d8e3',
    enemy ? '#d76875' : hero.color,
    '#172931',
  ];
  const group = (name: string, pos: Vector3Tuple, par: string) =>
    s.createObjectWithProps('empty', {
      name: `${hero.name} · ${name}`,
      position: pos,
      parentId: par,
    });
  const rig = group('Animated rig', [0, 0.38, 0], parent),
    armor = hero.id === 1 ? 1.22 : hero.id === 2 ? 0.91 : 1;
  const body: ModelPart[] = [
    p('hexprism', [0, 1.2, 0], [0.9 * armor, 0.87, 0.62], 6),
    p('hexprism', [0, 1.02, 0.19], [0.65 * armor, 0.62, 0.32], 1),
    p('box', [0, 0.79, 0], [0.83 * armor, 0.15, 0.65], 3),
    p('pyramid', [0, 1.46, 0.4], [0.27, 0.32, 0.12], 3, [Math.PI, 0, 0]),
    p('capsule', [0, 1.98, 0], [0.57, 0.53, 0.54], 4),
  ];
  if (hero.id === 1 || hero.id === 4) {
    body.push(
      p('hexprism', [0, 2.06, 0], [0.7, 0.63, 0.67], 1),
      p('box', [0, 2.06, 0.36], [0.51, 0.09, 0.04], 5),
      p('wedge', [0, 2.49, 0], [0.18, 0.5, 0.7], 3),
    );
  } else if (hero.id === 2) {
    body.push(
      p('cone', [0, 2.13, -0.03], [0.79, 0.8, 0.77], 6),
      p('box', [0, 1.97, 0.29], [0.44, 0.12, 0.08], 0),
      p('cone', [-0.29, 2.36, -0.05], [0.22, 0.55, 0.24], 4, [0, 0, 0.3]),
      p('cone', [0.29, 2.36, -0.05], [0.22, 0.55, 0.24], 4, [0, 0, -0.3]),
    );
  } else {
    body.push(
      p('cone', [0, 2.2, 0], [0.77, 0.6, 0.75], 6),
      p('torus', [0, 2.2, 0], [0.8, 0.8, 0.07], 3, [Math.PI / 2, 0, 0]),
      p('box', [0, 1.91, 0.3], [0.29, 0.07, 0.03], 0),
    );
  }
  body.push(
    p('wedge', [0, 1.03, -0.46], [0.95, 1.25, 0.22], 6, [0.15, Math.PI, 0]),
  );
  for (const side of [-1, 1])
    body.push(
      p(
        'hexprism',
        [side * 0.61 * armor, 1.59, 0],
        [0.56 * armor, 0.4, 0.66],
        hero.id === 1 ? 3 : 6,
        [0, 0, side * 0.22],
      ),
    );
  makeArt(`${hero.name} · Armor and mantle`, body, palette, rig);
  const arm = group('Weapon shoulder', [0.58 * armor, 1.5, 0], rig),
    offarm = group('Guard shoulder', [-0.58 * armor, 1.5, 0], rig);
  const arms = [
    p('capsule', [0, -0.26, 0], [0.29, 0.66, 0.3], 1),
    p('hexprism', [0, -0.55, 0.08], [0.33, 0.3, 0.35], 3),
  ];
  const weapon: ModelPart[] = [...arms];
  if (hero.weapon === 'hammer')
    weapon.push(
      p('cylinder', [0, -0.38, 0.56], [0.12, 1.2, 0.12], 7, [
        Math.PI / 2,
        0,
        0,
      ]),
      p('hexprism', [0, -0.37, 1.1], [0.78, 0.55, 0.6], 1),
      p('box', [0, -0.37, 1.42], [0.51, 0.3, 0.06], 5),
    );
  if (hero.weapon === 'blades')
    weapon.push(
      p('wedge', [0, -0.46, 0.8], [0.14, 0.36, 1.3], 4, [0, 0, Math.PI]),
      p('box', [0, -0.44, 0.36], [0.53, 0.08, 0.1], 3),
    );
  if (hero.weapon === 'staff' || hero.weapon === 'lantern')
    weapon.push(
      p('cylinder', [0, -0.1, 0.4], [0.1, 2.4, 0.1], 3),
      p('torus', [0, 1.15, 0.4], [0.7, 0.85, 0.09], 3),
      p('pyramid', [0, 1.18, 0.4], [0.33, 0.65, 0.33], 5),
      p('pyramid', [0, 1.57, 0.4], [0.33, 0.25, 0.33], 5, [Math.PI, 0, 0]),
    );
  if (hero.weapon === 'bow')
    weapon.push(
      p('box', [0, -0.3, 0.8], [0.12, 1.5, 0.13], 3, [0.3, 0, 0]),
      p('box', [0, -0.3, 1.05], [0.025, 1.4, 0.025], 4),
      p('cone', [0, -0.3, 1.25], [0.1, 0.75, 0.1], 5, [Math.PI / 2, 0, 0]),
    );
  makeArt(`${hero.name} · ${hero.weapon}`, weapon, palette, arm);
  const guard = [...arms];
  if (hero.id === 1)
    guard.push(
      p('hexprism', [-0.13, -0.29, 0.28], [0.25, 1.2, 0.95], 6, [0, 0, 0.15]),
      p('hexprism', [-0.27, -0.28, 0.28], [0.06, 0.8, 0.65], 3),
    );
  if (hero.id === 2)
    guard.push(p('wedge', [0, -0.45, 0.65], [0.14, 0.32, 1], 4));
  makeArt(`${hero.name} · Off hand`, guard, palette, offarm);
  const legs = [-1, 1].map((side) => {
    const leg = group(
      side === -1 ? 'Left hip' : 'Right hip',
      [side * 0.24, 0.7, 0],
      rig,
    );
    makeArt(
      `${hero.name} · Greave`,
      [
        p('capsule', [0, -0.22, 0], [0.31, 0.55, 0.35], 1),
        p('box', [0, -0.52, 0.16], [0.37, 0.25, 0.59], 0),
        p('hexprism', [0, -0.34, 0.1], [0.34, 0.29, 0.37], 3),
      ],
      palette,
      leg,
    );
    return leg;
  });
  return { rig, arm, offarm, leg: legs[0], leg2: legs[1] };
}
