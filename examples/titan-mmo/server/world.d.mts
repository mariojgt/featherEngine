export type ClassId = 'warrior' | 'ranger' | 'mage';
export type ZoneId = 'ember-meadow' | 'thornwood' | 'cinder-keep';
export type ItemId = 'training-blade' | 'warden-blade' | 'ashen-greatblade' | 'thornwood-cloak' | 'crown-of-embers' | 'sun-shard' | 'moonpetal' | 'ember-core' | 'potion';
export type SlotId = 'weapon' | 'armor' | 'trinket';
export type EnemyKind = 'wisp' | 'briar-wisp' | 'boar' | 'cinder-wisp' | 'boss';
export type QuestId = 'light-in-the-meadow' | 'briar-and-bone' | 'ashes-of-the-keep';
export type EffectKind = 'strike' | 'bolt' | 'ability' | 'burst' | 'enemyhit' | 'heal' | 'levelup' | 'quest' | 'gather' | 'defeat' | 'bossdown' | 'death';

export interface ClassDef { name: string; icon: string; health: number; damage: number; range: number; speed: number; basic: { name: string; cooldown: number }; ability: { name: string; cooldown: number; damage: number; radius: number; shape: 'self' | 'target' }; description: string }
export interface ItemDef { name: string; icon: string; rarity: string; description: string; slot?: SlotId; damage?: number; armor?: number; power?: number; price?: number; heal?: number }
export interface EnemyDef { name: string; health: number; damage: number; speed: number; aggro: number; attackRange: number; attackCooldown: number; respawn: number; gold: number; xp: number; boss?: boolean; burst?: { cooldown: number; telegraph: number; radius: number; damage: number }; drops?: Partial<Record<ItemId, number>> }
export interface NpcDef { id: string; name: string; role: 'quest' | 'vendor'; x: number; z: number; title: string; quest?: QuestId; sells?: ItemId[] }
export interface GatherableDef { id: string; item: ItemId; x: number; z: number }
export interface SpawnDef { id: string; kind: EnemyKind; x: number; z: number }
export interface PortalDef { id: string; to: ZoneId; name: string; x: number; z: number }
export interface ZoneDef { name: string; subtitle: string; chapter: number; level: number; bounds: { minX: number; maxX: number; minZ: number; maxZ: number }; spawn: { x: number; z: number; yaw: number }; sanctuary: { x: number; z: number; radius: number }; npcs: NpcDef[]; gatherables: GatherableDef[]; spawns: SpawnDef[]; portals: PortalDef[] }
export interface QuestObjective { type: 'gather' | 'kill'; item?: ItemId; kind?: EnemyKind; count: number; label: string }
export interface QuestDef { name: string; zone: ZoneId; giver: string; level: number; brief: string; accept: string; remind: string; complete: string; after: string; objectives: QuestObjective[]; reward: { gold: number; xp: number; items: Partial<Record<ItemId, number>> } }
export interface QuestProgress { state: 'active' | 'complete'; progress: number[] }

export interface Hero {
  id: string; name: string; class: ClassId; zone: ZoneId; x: number; z: number; yaw: number;
  level: number; xp: number; health: number; maxHealth: number; gold: number;
  inventory: Partial<Record<ItemId, number>>; equipped: { weapon: ItemId; armor: ItemId | null; trinket: ItemId | null };
  quests: Partial<Record<QuestId, QuestProgress>>; gathered: string[]; deaths: number;
  attackAt: number; abilityAt: number; hurtAt: number; vendor: string | null; arrivedAt: number; message: string;
}
export interface Enemy { id: string; zone: ZoneId; kind: EnemyKind; name: string; boss: boolean; x: number; z: number; yaw: number; health: number; maxHealth: number; respawnAt: number; hitAt: number; attackAt: number; burstAt: number; nextBurstAt: number; engaged: number }
export interface Effect { id: number; kind: EffectKind; at: number; x: number; z: number; tx?: number; tz?: number; radius?: number; class?: ClassId }
export interface RealmSnapshot { version: number; time: number; selfId: string; zone: ZoneId; online: number; players: Hero[]; enemies: Enemy[]; effects: Effect[] }
export type RealmCommand =
  | { type: 'move'; x: number; z: number }
  | { type: 'attack' | 'ability' | 'interact' | 'potion' | 'save' }
  | { type: 'equip'; item: ItemId }
  | { type: 'unequip'; slot: SlotId }
  | { type: 'buy'; item: ItemId }
  | { type: 'say'; text: string };
export interface ChatMessage { type: 'chat'; id: number; from: string; text: string; at: number; zone: ZoneId; self?: boolean }
export interface JoinOptions { class?: ClassId; zones?: string[] }

export const REALM_VERSION: number;
export const HOME_ZONE: ZoneId;
export const LEVEL_XP: readonly number[];
export const MAX_LEVEL: number;
export function levelForXp(xp: number): number;
export function xpToNextLevel(level: number): number;
export const CLASSES: Record<ClassId, ClassDef>;
export const ITEMS: Record<ItemId, ItemDef>;
export const SLOTS: readonly SlotId[];
export const ENEMIES: Record<EnemyKind, EnemyDef>;
export const ZONES: Record<ZoneId, ZoneDef>;
export const ZONE_IDS: readonly ZoneId[];
export const QUESTS: Record<QuestId, QuestDef>;
export const WARDEN: NpcDef;
export const SHARDS: GatherableDef[];
export const SPAWNS: SpawnDef[];
export function migrateSave(saved: unknown): Record<string, unknown>;
export function newHero(id: string, name: string, saved?: unknown, options?: JoinOptions): Hero;
export function maxHealthFor(cls: ClassId, level: number): number;
export function heroDamage(hero: Hero): number;
export function heroArmor(hero: Hero): number;
export function saveHero(hero: Hero): unknown;
export function questObjectives(hero: Hero, questId: QuestId): (QuestObjective & { current: number; done: boolean })[];
export class RealmWorld {
  time: number;
  players: Map<string, Hero>;
  enemies: Enemy[];
  effects: Effect[];
  join(id: string, name: string, saved?: unknown, options?: JoinOptions): Hero;
  leave(id: string): void;
  command(id: string, command: unknown): void;
  tick(delta: number): void;
  snapshot(id: string): RealmSnapshot;
}
