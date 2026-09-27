/** Pure item data shared by the editable shop and the match runtime. */
export interface MobaItem {
  id: 1 | 2 | 3 | 4 | 5 | 6;
  label: string;
  description: string;
  cost: number;
  /** Original SVG, encoded as a self-contained image URL. */
  icon: string;
  colors: { accent: string; background: string };
  bonuses: {
    damage?: number;
    spell_power?: number;
    max_hp?: number;
    /** Flat basic-attack damage reduction, not a percentage. */
    armor?: number;
    pace?: number;
    /** Additive attack-rate bonus: .25 means 25% faster attacks. */
    attack_speed?: number;
  };
}

export const MOBA_INVENTORY_CAPACITY = 4;
export const MOBA_ITEM_STACK_LIMIT = 1;
export const MOBA_STARTING_GOLD = 500;
export const MOBA_SELL_RATIO = 0.7;
export const mobaItemSellValue = (cost: number): number =>
  Math.floor(cost * (MOBA_SELL_RATIO * 100) / 100);

function icon(accent: string, drawing: string): string {
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect x="1" y="1" width="62" height="62" rx="10" fill="#10252c"/><circle cx="32" cy="32" r="25" fill="${accent}" opacity=".1"/><g stroke-linecap="round" stroke-linejoin="round">${drawing}</g></svg>`)}`;
}

export const MOBA_ITEMS: readonly MobaItem[] = [
  {
    id: 1,
    label: 'Ironfang Blade',
    description: '+16 attack damage',
    cost: 300,
    colors: { accent: '#e0ae81', background: '#302921' },
    bonuses: { damage: 16 },
    icon: icon('#e0ae81', '<path d="m23 38 5-13L51 11l-9 25-14 7z" fill="#dde8dc" stroke="#e0ae81" stroke-width="2"/><path d="m28 38 17-20" stroke="#7a999b" stroke-width="2"/><path d="m18 34 14 14M24 42l-9 10" stroke="#d6b571" stroke-width="5"/><path d="m11 49 6 6" stroke="#e0ae81" stroke-width="4"/>'),
  },
  {
    id: 2,
    label: 'Starglass Tome',
    description: '+35 spell power',
    cost: 300,
    colors: { accent: '#c4adf2', background: '#29253d' },
    bonuses: { spell_power: 35 },
    icon: icon('#c4adf2', '<path d="M17 15h30v36H20q-6 0-6-6V21q0-6 6-6" fill="#53496e" stroke="#c4adf2" stroke-width="2"/><path d="M21 15v29m-6 2h32" stroke="#ddcea4" stroke-width="2"/><path d="m34 21 3 8 8 3-8 3-3 8-3-8-8-3 8-3z" fill="#d9d0ff"/><path d="m50 9 1 4 4 1-4 1-1 4-1-4-4-1 4-1z" fill="#c4adf2"/>'),
  },
  {
    id: 3,
    label: 'Warden Mail',
    description: '+180 max health · +6 armor\nBlocks 6 damage from each basic attack.',
    cost: 350,
    colors: { accent: '#91c4d5', background: '#20343d' },
    bonuses: { max_hp: 180, armor: 6 },
    icon: icon('#91c4d5', '<path d="m23 13-12 9 5 12 6-3-3 21h26l-3-21 6 3 5-12-12-9q-9 10-18 0z" fill="#4a6976" stroke="#91c4d5" stroke-width="2"/><path d="m22 24 10 6 10-6-3 19-7 6-7-6z" fill="#203943" stroke="#d5c28b" stroke-width="2"/><path d="M32 30v14m-7-8h14" stroke="#91c4d5" stroke-width="2"/>'),
  },
  {
    id: 4,
    label: 'Windrunner Boots',
    description: '+1.2 movement speed',
    cost: 250,
    colors: { accent: '#9ed4b0', background: '#20382d' },
    bonuses: { pace: 1.2 },
    icon: icon('#9ed4b0', '<path d="m29 13 16 3-6 23 12 7v6H22v-9l5-13z" fill="#4d7865" stroke="#9ed4b0" stroke-width="2"/><path d="m27 22 15 3m-17 6 14 3M22 48h29" stroke="#dfcc92" stroke-width="3"/><path d="M10 21h10M7 29h11m-6 8h6" stroke="#9ed4b0" stroke-width="2"/>'),
  },
  {
    id: 5,
    label: 'Quicksteel Bow',
    description: '+25% attack speed\nBasic attacks fire 25% faster.',
    cost: 400,
    colors: { accent: '#e4c67f', background: '#373021' },
    bonuses: { attack_speed: 0.25 },
    icon: icon('#e4c67f', '<path d="M20 10q44 22 0 44" fill="none" stroke="#e4c67f" stroke-width="4"/><path d="m20 10 8 22-8 22" fill="none" stroke="#d5e4df" stroke-width="1.5"/><path d="M12 32h40m-8-6 8 6-8 6" fill="none" stroke="#d5e4df" stroke-width="2"/><path d="m12 27 6 5-6 5" fill="none" stroke="#e4c67f" stroke-width="2"/>'),
  },
  {
    id: 6,
    label: 'Dawnstone Charm',
    description: '+80 max health · +20 spell power',
    cost: 350,
    colors: { accent: '#7cddd1', background: '#203b38' },
    bonuses: { max_hp: 80, spell_power: 20 },
    icon: icon('#7cddd1', '<path d="M21 11q0 17 11 18 11-1 11-18" fill="none" stroke="#d8bd78" stroke-width="3"/><circle cx="32" cy="37" r="16" fill="#2b625d" stroke="#d8bd78" stroke-width="2"/><path d="m32 24 9 13-9 14-9-14z" fill="#7cddd1"/><path d="m32 24 2 13-2 14-3-14z" fill="#d8fff0"/><path d="M12 38H8m48 0h-4M32 58v-3" stroke="#d8bd78" stroke-width="2"/>'),
  },
];
