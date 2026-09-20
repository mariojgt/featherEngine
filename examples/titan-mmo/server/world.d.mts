export type ItemId = 'training-blade' | 'warden-blade' | 'sun-shard' | 'potion';
export interface Hero { id: string; name: string; x: number; z: number; yaw: number; health: number; gold: number; xp: number; inventory: Record<ItemId, number>; gathered: string[]; quest: 'available' | 'active' | 'complete'; kills: number; equipped: 'training-blade' | 'warden-blade'; attackAt: number; hurtAt: number; message: string }
export interface Enemy { id: string; x: number; z: number; health: number; respawnAt: number; hitAt: number; attackAt: number }
export interface RealmSnapshot { version: number; time: number; selfId: string; players: Hero[]; enemies: Enemy[] }
export type RealmCommand = { type: 'move'; x: number; z: number } | { type: 'attack' | 'interact' | 'potion' | 'save' } | { type: 'equip'; item: ItemId };
export const REALM_VERSION: number;
export const ITEMS: Record<ItemId, { name: string; icon: string; rarity: string; description: string; damage?: number }>;
export const WARDEN: { x: number; z: number; name: string };
export const SHARDS: { id: string; x: number; z: number }[];
export const SPAWNS: { id: string; x: number; z: number }[];
export function newHero(id: string, name: string, saved?: unknown): Hero;
export function saveHero(hero: Hero): unknown;
export class RealmWorld {
  time: number;
  players: Map<string, Hero>;
  enemies: Enemy[];
  join(id: string, name: string, saved?: unknown): Hero;
  leave(id: string): void;
  command(id: string, command: unknown): void;
  tick(delta: number): void;
  snapshot(id: string): RealmSnapshot;
}
