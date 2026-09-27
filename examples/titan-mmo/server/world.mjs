import { VALLEY_ID, groundHeight, moveOnGround, clearSight } from './valley.mjs';
import { normalizeAppearance } from './appearance.mjs';
/**
 * The Sunlit Reach — authoritative game rules shared by solo practice and the realm server.
 *
 * Everything a client can do is an intention (move, attack, ability, interact, equip, potion, buy).
 * Positions, damage, gold, XP, loot and quest state are only ever computed here. Zones are
 * independent coordinate spaces; each maps to one editable Feather scene in the template.
 */
export const REALM_VERSION = 2;
export const HOME_ZONE = 'ember-meadow';
export const LEVEL_XP = Object.freeze([0, 100, 260, 480, 780, 1160, 1640, 2240]);
export const MAX_LEVEL = LEVEL_XP.length;
export const levelForXp = xp => { let level = 1; while (level < MAX_LEVEL && xp >= LEVEL_XP[level]) level++; return level; };
export const xpToNextLevel = level => (level < MAX_LEVEL ? LEVEL_XP[level] : LEVEL_XP[MAX_LEVEL - 1]);

export const CLASSES = Object.freeze({
  warrior: { name: 'Warrior', icon: '⚔', health: 120, damage: 1, range: 2.4, speed: 5, basic: { name: 'Strike', cooldown: .55 },
    ability: { name: 'Cleave', cooldown: 6, damage: 1.4, radius: 3.5, shape: 'self' },
    description: 'Steel and stubbornness. The most health, close-range strikes and a sweeping Cleave.' },
  ranger: { name: 'Ranger', icon: '➶', health: 100, damage: .9, range: 9, speed: 5.3, basic: { name: 'Quick shot', cooldown: .7 },
    ability: { name: 'Volley', cooldown: 7, damage: 1.2, radius: 3, shape: 'target' },
    description: 'Keeps a distance. Fast shots from range and a Volley that rains on a group.' },
  mage: { name: 'Mage', icon: '✦', health: 85, damage: 1.15, range: 9, speed: 5, basic: { name: 'Ember bolt', cooldown: .8 },
    ability: { name: 'Flame ring', cooldown: 8, damage: 1.5, radius: 4.2, shape: 'self' },
    description: 'Fragile but fierce. Ember bolts from range and a Flame ring that scorches everything nearby.' },
});

export const ITEMS = Object.freeze({
  'training-blade': { name: 'Training blade', icon: '⚔', slot: 'weapon', damage: 16, rarity: 'Common', description: 'A dependable first blade. +16 attack.' },
  'warden-blade': { name: 'Warden’s blade', icon: '⚔', slot: 'weapon', damage: 28, rarity: 'Rare', description: 'Earned by protecting the meadow. +28 attack.' },
  'ashen-greatblade': { name: 'Ashen greatblade', icon: '⚔', slot: 'weapon', damage: 42, rarity: 'Epic', description: 'Forged in the fall of Cinder Keep. +42 attack.' },
  'thornwood-cloak': { name: 'Thornwood cloak', icon: '⛨', slot: 'armor', armor: 4, rarity: 'Uncommon', description: 'Woven from briar silk. Absorbs 4 damage from every hit.' },
  'crown-of-embers': { name: 'Crown of Embers', icon: '♛', slot: 'trinket', power: .15, rarity: 'Epic', description: 'The old crown still burns. +15% damage.' },
  'sun-shard': { name: 'Sun shard', icon: '◆', rarity: 'Uncommon', description: 'A warm fragment of the old beacon.' },
  moonpetal: { name: 'Moonpetal', icon: '❀', rarity: 'Uncommon', description: 'A pale flower that only opens under the Thornwood canopy.' },
  'ember-core': { name: 'Ember core', icon: '●', rarity: 'Rare', description: 'The still-glowing heart of an ashen construct.' },
  potion: { name: 'Meadow tonic', icon: '✚', rarity: 'Common', price: 12, heal: 45, description: 'Restores 45 health. Consumed when used.' },
});
export const SLOTS = Object.freeze(['weapon', 'armor', 'trinket']);

export const ENEMIES = Object.freeze({
  wisp: { name: 'Wild wisp', health: 48, damage: 9, speed: 1.6, aggro: 6, attackRange: 2, attackCooldown: 1.4, respawn: 18, gold: 8, xp: 25 },
  'briar-wisp': { name: 'Briar wisp', health: 70, damage: 12, speed: 1.9, aggro: 7, attackRange: 2, attackCooldown: 1.3, respawn: 22, gold: 11, xp: 40 },
  boar: { name: 'Thornback boar', health: 120, damage: 16, speed: 2.6, aggro: 7, attackRange: 1.8, attackCooldown: 1.6, respawn: 26, gold: 15, xp: 60 },
  'cinder-wisp': { name: 'Cinder wisp', health: 110, damage: 15, speed: 2, aggro: 8, attackRange: 2.2, attackCooldown: 1.2, respawn: 30, gold: 18, xp: 70 },
  boss: { name: 'The Ashen Warden', health: 700, damage: 24, speed: 1.5, aggro: 11, attackRange: 2.8, attackCooldown: 2.2, respawn: 75, gold: 60, xp: 250, boss: true,
    burst: { cooldown: 11, telegraph: 1.6, radius: 5, damage: 45 }, drops: { 'ember-core': 1 } },
});

/** Zones are separate coordinate spaces. `level` gates travel; `sanctuary` heals and repels enemies. */
export const ZONES = Object.freeze({
  'sunlit-valley': { name: 'Sunlit Vale', subtitle: 'One world · Three adventures', chapter: 1, level: 1,
    bounds: { minX: -94, maxX: 94, minZ: -94, maxZ: 94 }, spawn: { x: 0, z: 62, yaw: Math.PI }, sanctuary: { x: 0, z: 62, radius: 18 },
    npcs: [
      { id: 'elara', name: 'Warden Elara', role: 'quest', quest: 'light-in-the-meadow', x: 0, z: 54, title: 'Keeper of the beacon' },
      { id: 'bram', name: 'Quartermaster Bram', role: 'vendor', sells: ['potion'], x: -6, z: 61, title: 'Supplies for the road' },
      { id: 'wren', name: 'Hermit Wren', role: 'quest', quest: 'briar-and-bone', x: 4, z: -4, title: 'Guardian of the woodland' },
      { id: 'idris', name: 'Captain Idris', role: 'quest', quest: 'ashes-of-the-keep', x: -4, z: -48, title: 'Last of the keep guard' },
    ],
    gatherables: [{ id: 'vale-shard-1', item: 'sun-shard', x: -6, z: 40 }, { id: 'vale-shard-2', item: 'sun-shard', x: 8, z: 32 }, { id: 'vale-shard-3', item: 'sun-shard', x: -3, z: 23 },
      ...[[-9, -12], [12, -19], [-13, -26], [8, -33]].map(([x,z], i) => ({ id: `vale-petal-${i}`, item: 'moonpetal', x, z }))],
    spawns: [{ id: 'vale-wisp-1', kind: 'wisp', x: -8, z: 30 }, { id: 'vale-wisp-2', kind: 'wisp', x: 10, z: 22 }, { id: 'vale-wisp-3', kind: 'wisp', x: -8, z: 16 },
      ...[[-10,-17],[13,-25],[-8,-34]].map(([x,z],i)=>({id:`vale-boar-${i}`,kind:'boar',x,z})),
      { id: 'vale-briar', kind: 'briar-wisp', x: 15, z: -10 },
      { id: 'vale-cinder-1', kind: 'cinder-wisp', x: -7, z: -57 }, { id: 'vale-cinder-2', kind: 'cinder-wisp', x: 7, z: -57 },
      { id: 'vale-warden', kind: 'boss', x: 0, z: -71 }], portals: [] },
  'ember-meadow': { name: 'Ember Meadow', subtitle: 'The Sunlit Reach · Chapter 01', chapter: 1, level: 1,
    bounds: { minX: -23, maxX: 23, minZ: -24, maxZ: 11 }, spawn: { x: 0, z: 3, yaw: Math.PI }, sanctuary: { x: 0, z: 3, radius: 9 },
    npcs: [
      { id: 'elara', name: 'Warden Elara', role: 'quest', quest: 'light-in-the-meadow', x: 0, z: -3, title: 'Keeper of the beacon' },
      { id: 'bram', name: 'Quartermaster Bram', role: 'vendor', sells: ['potion'], x: -4.5, z: 2.5, title: 'Supplies for the road' },
    ],
    gatherables: [{ id: 'shard-1', item: 'sun-shard', x: -6, z: -8 }, { id: 'shard-2', item: 'sun-shard', x: 6, z: -11 }, { id: 'shard-3', item: 'sun-shard', x: 2, z: -17 }],
    spawns: [{ id: 'wisp-1', kind: 'wisp', x: -4, z: -11 }, { id: 'wisp-2', kind: 'wisp', x: 5, z: -16 }, { id: 'wisp-3', kind: 'wisp', x: -7, z: -19 }],
    portals: [{ id: 'meadow-to-thornwood', to: 'thornwood', name: 'Thornwood waystone', x: 0, z: -22.5 }] },
  thornwood: { name: 'Thornwood', subtitle: 'The whispering wood · Chapter 02', chapter: 2, level: 2,
    bounds: { minX: -26, maxX: 26, minZ: -30, maxZ: 12 }, spawn: { x: 0, z: 8, yaw: Math.PI }, sanctuary: { x: 0, z: 8, radius: 6 },
    npcs: [{ id: 'wren', name: 'Hermit Wren', role: 'quest', quest: 'briar-and-bone', x: 3.5, z: 5, title: 'Listens to the trees' }],
    gatherables: [{ id: 'petal-1', item: 'moonpetal', x: -9, z: -6 }, { id: 'petal-2', item: 'moonpetal', x: 11, z: -10 }, { id: 'petal-3', item: 'moonpetal', x: -14, z: -17 }, { id: 'petal-4', item: 'moonpetal', x: 8, z: -22 }],
    spawns: [{ id: 'briar-1', kind: 'briar-wisp', x: -6, z: -9 }, { id: 'briar-2', kind: 'briar-wisp', x: 13, z: -16 }, { id: 'briar-3', kind: 'briar-wisp', x: -4, z: -24 },
      { id: 'boar-1', kind: 'boar', x: 6, z: -13 }, { id: 'boar-2', kind: 'boar', x: -15, z: -12 }, { id: 'boar-3', kind: 'boar', x: 2, z: -20 }],
    portals: [{ id: 'thornwood-to-meadow', to: 'ember-meadow', name: 'Meadow waystone', x: 0, z: 10.5 }, { id: 'thornwood-to-keep', to: 'cinder-keep', name: 'Cinder Keep waystone', x: 0, z: -28.5 }] },
  'cinder-keep': { name: 'Cinder Keep', subtitle: 'Ashes of the old crown · Chapter 03', chapter: 3, level: 4,
    bounds: { minX: -20, maxX: 20, minZ: -30, maxZ: 10 }, spawn: { x: 0, z: 7, yaw: Math.PI }, sanctuary: { x: 0, z: 7, radius: 5 },
    npcs: [{ id: 'idris', name: 'Captain Idris', role: 'quest', quest: 'ashes-of-the-keep', x: -3, z: 3, title: 'Last of the keep guard' }],
    gatherables: [],
    spawns: [{ id: 'cinder-1', kind: 'cinder-wisp', x: -6, z: -8 }, { id: 'cinder-2', kind: 'cinder-wisp', x: 6, z: -8 }, { id: 'ashen-warden', kind: 'boss', x: 0, z: -19 }],
    portals: [{ id: 'keep-to-thornwood', to: 'thornwood', name: 'Thornwood waystone', x: 0, z: 9 }] },
});
export const ZONE_IDS = Object.freeze(Object.keys(ZONES));

export const QUESTS = Object.freeze({
  'light-in-the-meadow': { name: 'A light in the meadow', zone: 'ember-meadow', giver: 'elara', level: 1,
    brief: 'Restore the beacon. Bring warmth back to the wilds.',
    accept: 'A light in the meadow: gather 3 sun shards and defeat 2 wild wisps.',
    remind: 'Find the golden shards and defeat 2 wisps, then return to me.',
    complete: 'Quest complete! +50 gold, +100 XP, and Warden’s blade. Open your bag to equip it.',
    after: 'The meadow remembers your kindness, Warden. Hermit Wren awaits you in the woodland.',
    objectives: [{ type: 'gather', item: 'sun-shard', count: 3, label: 'Gather sun shards' }, { type: 'kill', kind: 'wisp', count: 2, label: 'Defeat wild wisps' }],
    reward: { gold: 50, xp: 100, items: { 'warden-blade': 1 } } },
  'briar-and-bone': { name: 'Briar and bone', zone: 'thornwood', giver: 'wren', level: 2,
    brief: 'Something feeds the briars. Cull the boars and bring Wren four moonpetals.',
    accept: 'Briar and bone: gather 4 moonpetals and defeat 3 thornback boars.',
    remind: 'The petals open in the dark under the canopy. The boars will find you first.',
    complete: 'Quest complete! +90 gold, +220 XP, a Thornwood cloak and two tonics.',
    after: 'The wood breathes easier. Seek Captain Idris near the ruined keep when you are strong enough.',
    objectives: [{ type: 'gather', item: 'moonpetal', count: 4, label: 'Gather moonpetals' }, { type: 'kill', kind: 'boar', count: 3, label: 'Defeat thornback boars' }],
    reward: { gold: 90, xp: 220, items: { 'thornwood-cloak': 1, potion: 2 } } },
  'ashes-of-the-keep': { name: 'Ashes of the keep', zone: 'cinder-keep', giver: 'idris', level: 4,
    brief: 'The Ashen Warden guards a crown that should have stayed buried. End it.',
    accept: 'Ashes of the keep: defeat the Ashen Warden in the inner courtyard. Bring friends.',
    remind: 'The Warden telegraphs its ember burst. Step out of the ring when the ground glows.',
    complete: 'Quest complete! +150 gold, +400 XP, the Ashen greatblade and the Crown of Embers.',
    after: 'The keep is quiet. Wear the crown well, champion of the Sunlit Reach.',
    objectives: [{ type: 'kill', kind: 'boss', count: 1, label: 'Defeat the Ashen Warden' }],
    reward: { gold: 150, xp: 400, items: { 'ashen-greatblade': 1, 'crown-of-embers': 1 } } },
});

// Legacy names kept for the single-zone Ember Meadow starter.
export const WARDEN = Object.freeze({ ...ZONES['ember-meadow'].npcs[0] });
export const SHARDS = ZONES['ember-meadow'].gatherables;
export const SPAWNS = ZONES['ember-meadow'].spawns;

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const number = (n, fallback, max) => (typeof n === 'number' && Number.isFinite(n) ? clamp(Math.floor(n), 0, max) : fallback);
const allGatherables = () => Object.values(ZONES).flatMap(zone => zone.gatherables);
const EFFECT_LIFETIME = 1.2;

/** Older Ember Meadow saves (version 1) keep their progress in the new shape. */
export function migrateSave(saved) {
  if (!saved || typeof saved !== 'object') return {};
  if (saved.version === REALM_VERSION) return saved;
  if (saved.version === 1) {
    const gathered = Array.isArray(saved.gathered) ? saved.gathered : [];
    const quests = saved.quest === 'active' || saved.quest === 'complete'
      ? { 'light-in-the-meadow': { state: saved.quest, progress: [gathered.length, number(saved.kills, 0, 2)] } } : {};
    return { version: REALM_VERSION, zone: HOME_ZONE, gold: saved.gold, xp: saved.xp, inventory: saved.inventory, gathered,
      equipped: { weapon: saved.equipped }, quests };
  }
  return {};
}

export function newHero(id, name, saved, options = {}) {
  const data = migrateSave(saved);
  const zones = Array.isArray(options.zones) && options.zones.length ? options.zones.filter(zone => Object.hasOwn(ZONES, zone)) : [HOME_ZONE, 'thornwood', 'cinder-keep'];
  const cls = Object.hasOwn(CLASSES, data.class) ? data.class : Object.hasOwn(CLASSES, options.class) ? options.class : 'warrior';
  const zoneId = Object.hasOwn(ZONES, data.zone) && zones.includes(data.zone) ? data.zone : zones[0] ?? HOME_ZONE;
  const inventory = { 'training-blade': 1, potion: 3 };
  if (data.inventory && typeof data.inventory === 'object') {
    for (const item of Object.keys(ITEMS)) if (data.inventory[item] !== undefined) inventory[item] = number(data.inventory[item], inventory[item] ?? 0, 999);
  }
  if (!inventory['training-blade']) inventory['training-blade'] = 1;
  const equipped = { weapon: 'training-blade', armor: null, trinket: null };
  for (const slot of SLOTS) {
    const item = data.equipped?.[slot];
    if (typeof item === 'string' && ITEMS[item]?.slot === slot && inventory[item] > 0) equipped[slot] = item;
  }
  const quests = {};
  for (const [questId, quest] of Object.entries(QUESTS)) {
    const entry = data.quests?.[questId];
    if (!entry || !['active', 'complete'].includes(entry.state)) continue;
    const progress = quest.objectives.map((objective, index) => entry.state === 'complete' ? objective.count : number(entry.progress?.[index], 0, objective.count));
    quests[questId] = { state: entry.state, progress };
  }
  const known = new Set(allGatherables().map(node => node.id));
  const gathered = Array.isArray(data.gathered) ? [...new Set(data.gathered.filter(node => known.has(node)))] : [];
  const xp = number(data.xp, 0, 999999);
  const level = levelForXp(xp);
  const spawn = ZONES[zoneId].spawn;
  return { id, name: String(name || 'Wayfarer').trim().slice(0, 24) || 'Wayfarer', class: cls, appearance: normalizeAppearance(data.appearance ?? options.appearance), zone: zoneId, zones,
    x: spawn.x, y: groundHeight(zoneId, spawn.x, spawn.z), z: spawn.z, yaw: spawn.yaw, level, xp, health: maxHealthFor(cls, level), maxHealth: maxHealthFor(cls, level),
    gold: number(data.gold, 0, 999999), inventory, equipped, quests, gathered, deaths: number(data.deaths, 0, 999999),
    attackAt: -100, abilityAt: -100, recoveryAt: -100, hurtAt: -100, vendor: null, arrivedAt: 0, input: { x: 0, z: 0 }, inputAt: 0,
    message: `Welcome to ${ZONES[zoneId].name}. ${zoneId === HOME_ZONE || zoneId === VALLEY_ID ? 'Speak to Warden Elara beside the beacon.' : 'Your journey continues.'}` };
}
export const maxHealthFor = (cls, level) => (CLASSES[cls]?.health ?? 100) + (level - 1) * 10;
export function heroDamage(hero) {
  const weapon = ITEMS[hero.equipped.weapon]?.damage ?? 10;
  const trinket = ITEMS[hero.equipped.trinket]?.power ?? 0;
  return Math.round(weapon * (CLASSES[hero.class]?.damage ?? 1) * (1 + .06 * (hero.level - 1)) * (1 + trinket));
}
export const heroArmor = hero => ITEMS[hero.equipped.armor]?.armor ?? 0;
export function saveHero(hero) {
  const { gold, xp, inventory, equipped, quests, gathered, deaths } = hero;
  return structuredClone({ version: REALM_VERSION, class: hero.class, appearance: hero.appearance, zone: hero.zone, gold, xp, inventory, equipped, quests, gathered, deaths });
}
/** Objective progress for the HUD: label, current, count. */
export function questObjectives(hero, questId) {
  const quest = QUESTS[questId]; const entry = hero.quests[questId];
  return quest.objectives.map((objective, index) => ({ ...objective, current: entry ? entry.progress[index] : 0, done: Boolean(entry) && entry.progress[index] >= objective.count }));
}
const inSanctuary = (zone, point) => distance(zone.sanctuary, point) < zone.sanctuary.radius;

export class RealmWorld {
  time = 0;
  players = new Map();
  effects = [];
  effectId = 0;
  enemies = Object.entries(ZONES).flatMap(([zoneId, zone]) => zone.spawns.map(spawn => ({
    id: spawn.id, zone: zoneId, kind: spawn.kind, name: ENEMIES[spawn.kind].name, boss: Boolean(ENEMIES[spawn.kind].boss),
    x: spawn.x, y: groundHeight(zoneId, spawn.x, spawn.z), z: spawn.z, yaw: 0, spawnX: spawn.x, spawnZ: spawn.z, health: ENEMIES[spawn.kind].health, maxHealth: ENEMIES[spawn.kind].health,
    respawnAt: 0, hitAt: -100, attackAt: -100, burstAt: 0, nextBurstAt: 0, targetId: null, hurtBy: new Set(),
  })));
  join(id, name, saved, options) {
    if (this.players.has(id)) throw new Error('This character is already in the realm.');
    const hero = newHero(id, name, saved, options); this.players.set(id, hero); return hero;
  }
  leave(id) { this.players.delete(id); for (const enemy of this.enemies) if (enemy.targetId === id) enemy.targetId = null; }
  effect(zone, kind, extra = {}) { this.effects.push({ id: ++this.effectId, zone, kind, at: this.time, ...extra }); }
  zoneEnemies(zone) { return this.enemies.filter(enemy => enemy.zone === zone && enemy.health > 0); }
  gainXp(hero, amount) {
    hero.xp = Math.min(999999, hero.xp + amount);
    const level = levelForXp(hero.xp);
    if (level > hero.level) {
      hero.level = level; hero.maxHealth = maxHealthFor(hero.class, level); hero.health = hero.maxHealth;
      hero.message = `Level ${level}! Your health and damage grew.`; this.effect(hero.zone, 'levelup', { x: hero.x, z: hero.z });
    }
  }
  advanceQuests(hero, type, key) {
    for (const [questId, entry] of Object.entries(hero.quests)) {
      if (entry.state !== 'active') continue;
      QUESTS[questId].objectives.forEach((objective, index) => {
        if (objective.type === type && (objective.item ?? objective.kind) === key) entry.progress[index] = Math.min(objective.count, entry.progress[index] + 1);
      });
    }
  }
  hurtHero(hero, amount, source) {
    const zone = ZONES[hero.zone];
    if (inSanctuary(zone, hero)) return;
    hero.health = Math.max(0, hero.health - Math.max(1, amount - heroArmor(hero))); hero.hurtAt = this.time;
    if (hero.health > 0) return;
    hero.deaths++; hero.x = zone.spawn.x; hero.z = zone.spawn.z; hero.y = groundHeight(hero.zone, hero.x, hero.z); hero.yaw = zone.spawn.yaw; hero.health = hero.maxHealth; hero.input = { x: 0, z: 0 };
    hero.message = `${source} struck you down. The waystone light carried you back. Your items are safe.`;
    this.effect(hero.zone, 'death', { x: hero.x, z: hero.z });
    for (const enemy of this.enemies) if (enemy.targetId === hero.id) enemy.targetId = null;
  }
  damageEnemy(hero, enemy, amount) {
    enemy.health = Math.max(0, enemy.health - amount); enemy.hitAt = this.time; enemy.hurtBy.add(hero.id);
    if (!enemy.targetId) enemy.targetId = hero.id;
    if (enemy.health > 0) return false;
    const kind = ENEMIES[enemy.kind];
    enemy.respawnAt = this.time + kind.respawn; enemy.targetId = null; enemy.burstAt = 0;
    const participants = [...enemy.hurtBy].map(id => this.players.get(id)).filter(Boolean);
    for (const participant of participants) {
      participant.gold += kind.gold;
      for (const [item, count] of Object.entries(kind.drops ?? {})) participant.inventory[item] = Math.min(999, (participant.inventory[item] ?? 0) + count);
      this.advanceQuests(participant, 'kill', enemy.kind);
      participant.message = kind.boss ? `${kind.name} falls! +${kind.gold} gold · +${kind.xp} XP${kind.drops ? ' · Ember core' : ''}` : `${kind.name} defeated · +${kind.gold} gold · +${kind.xp} XP`;
      this.gainXp(participant, kind.xp);
    }
    enemy.hurtBy.clear();
    this.effect(enemy.zone, kind.boss ? 'bossdown' : 'defeat', { x: enemy.x, z: enemy.z });
    return true;
  }
  command(id, command) {
    const hero = this.players.get(id);
    if (!hero || !command || typeof command !== 'object') return;
    const zone = ZONES[hero.zone]; const cls = CLASSES[hero.class];
    if (command.type === 'move') {
      const x = Number.isFinite(command.x) ? clamp(command.x, -1, 1) : 0;
      const z = Number.isFinite(command.z) ? clamp(command.z, -1, 1) : 0;
      const length = Math.max(1, Math.hypot(x, z));
      hero.input = { x: x / length, z: z / length }; hero.inputAt = this.time; return;
    }
    if (command.type === 'recover') {
      if (this.time - hero.recoveryAt < 14) { hero.message = 'Second wind is recharging.'; return; }
      if (hero.health >= hero.maxHealth) { hero.message = 'You are already at full health.'; return; }
      hero.recoveryAt = this.time; hero.health = Math.min(hero.maxHealth, hero.health + hero.maxHealth * .3);
      this.effect(hero.zone, 'heal', { x: hero.x, z: hero.z }); hero.message = 'Second wind restored 30% health.'; return;
    }
    if (command.type === 'equip') {
      const item = ITEMS[command.item];
      if (!item?.slot || !(hero.inventory[command.item] > 0)) { hero.message = 'You do not own that.'; return; }
      hero.equipped[item.slot] = command.item; hero.message = `${item.name} equipped.`; return;
    }
    if (command.type === 'unequip') {
      if (command.slot === 'weapon' || !SLOTS.includes(command.slot)) { hero.message = 'A weapon must stay equipped.'; return; }
      hero.equipped[command.slot] = null; hero.message = 'Unequipped.'; return;
    }
    if (command.type === 'potion') {
      if (!hero.inventory.potion) { hero.message = 'No meadow tonics left. Quartermaster Bram sells more.'; return; }
      if (hero.health >= hero.maxHealth) { hero.message = 'You are already at full health.'; return; }
      hero.inventory.potion--; hero.health = Math.min(hero.maxHealth, hero.health + ITEMS.potion.heal); hero.message = `Meadow tonic restored ${ITEMS.potion.heal} health.`;
      this.effect(hero.zone, 'heal', { x: hero.x, z: hero.z }); return;
    }
    if (command.type === 'buy') {
      const vendor = zone.npcs.find(npc => npc.id === hero.vendor && npc.role === 'vendor');
      const item = ITEMS[command.item];
      if (!vendor || distance(hero, vendor) > 4) { hero.vendor = null; hero.message = 'Step closer to a vendor and press E first.'; return; }
      if (!vendor.sells.includes(command.item) || !item?.price) { hero.message = 'Not for sale here.'; return; }
      if (hero.gold < item.price) { hero.message = `You need ${item.price} gold for a ${item.name}.`; return; }
      hero.gold -= item.price; hero.inventory[command.item] = Math.min(999, (hero.inventory[command.item] ?? 0) + 1);
      hero.message = `Bought ${item.name} for ${item.price} gold.`; return;
    }
    if (command.type === 'interact') return this.interact(hero, zone);
    if (command.type === 'attack') {
      if (this.time - hero.attackAt < cls.basic.cooldown) return;
      const target = this.zoneEnemies(hero.zone).filter(enemy => clearSight(hero.zone, hero, enemy) && distance(hero, enemy) < cls.range + .6).sort((a, b) => distance(hero, a) - distance(hero, b))[0];
      if (!target) { hero.message = cls.range > 3 ? `No enemy within range of ${cls.basic.name}.` : `Move within reach of an enemy to ${cls.basic.name.toLowerCase()}.`; return; }
      hero.attackAt = this.time; hero.yaw = Math.atan2(target.x - hero.x, target.z - hero.z);
      const damage = heroDamage(hero);
      this.effect(hero.zone, cls.range > 3 ? 'bolt' : 'strike', { x: hero.x, z: hero.z, tx: target.x, tz: target.z, class: hero.class });
      if (!this.damageEnemy(hero, target, damage)) hero.message = `${cls.basic.name} hit ${target.name} for ${damage}.`;
      return;
    }
    if (command.type === 'ability') {
      if (this.time - hero.abilityAt < cls.ability.cooldown) { hero.message = `${cls.ability.name} is recharging.`; return; }
      let center = hero;
      if (cls.ability.shape === 'target') {
        center = this.zoneEnemies(hero.zone).filter(enemy => clearSight(hero.zone, hero, enemy) && distance(hero, enemy) < cls.range + .6).sort((a, b) => distance(hero, a) - distance(hero, b))[0];
        if (!center) { hero.message = `No enemy within range of ${cls.ability.name}.`; return; }
      }
      const targets = this.zoneEnemies(hero.zone).filter(enemy => clearSight(hero.zone, hero, enemy) && distance(center, enemy) < cls.ability.radius);
      if (!targets.length) { hero.message = `No enemies close enough for ${cls.ability.name}.`; return; }
      hero.abilityAt = this.time; hero.attackAt = this.time;
      if (center !== hero) hero.yaw = Math.atan2(center.x - hero.x, center.z - hero.z);
      const damage = Math.round(heroDamage(hero) * cls.ability.damage);
      this.effect(hero.zone, 'ability', { x: center.x, z: center.z, radius: cls.ability.radius, class: hero.class });
      let defeated = 0;
      for (const target of targets) if (this.damageEnemy(hero, target, damage)) defeated++;
      if (!defeated) hero.message = `${cls.ability.name} hit ${targets.length} ${targets.length === 1 ? 'enemy' : 'enemies'} for ${damage}.`;
    }
  }
  interact(hero, zone) {
    const npc = zone.npcs.filter(n => distance(hero, n) < 3).sort((a, b) => distance(hero, a) - distance(hero, b))[0];
    if (npc) {
      hero.yaw = Math.atan2(npc.x - hero.x, npc.z - hero.z);
      if (npc.role === 'vendor') { hero.vendor = npc.id; hero.message = `${npc.name}: “Tonics are ${ITEMS.potion.price} gold. Buy what you need from the shop.”`; return; }
      const quest = QUESTS[npc.quest]; const entry = hero.quests[npc.quest];
      if (!entry) {
        if (hero.level < quest.level) { hero.message = `${npc.name}: “Come back when you are level ${quest.level}. The wilds beyond are not kind.”`; return; }
        hero.quests[npc.quest] = { state: 'active', progress: quest.objectives.map(() => 0) }; hero.message = quest.accept; return;
      }
      if (entry.state === 'complete') { hero.message = quest.after; return; }
      if (quest.objectives.every((objective, index) => entry.progress[index] >= objective.count)) {
        entry.state = 'complete'; hero.gold += quest.reward.gold;
        for (const [item, count] of Object.entries(quest.reward.items)) hero.inventory[item] = Math.min(999, (hero.inventory[item] ?? 0) + count);
        hero.message = quest.complete; this.effect(hero.zone, 'quest', { x: hero.x, z: hero.z }); this.gainXp(hero, quest.reward.xp); return;
      }
      hero.message = quest.remind; return;
    }
    const node = zone.gatherables.find(n => distance(hero, n) < 2.7 && !hero.gathered.includes(n.id));
    if (node) {
      const wanted = Object.entries(hero.quests).some(([questId, entry]) => entry.state === 'active' && QUESTS[questId].objectives.some((objective, index) => objective.type === 'gather' && objective.item === node.item && entry.progress[index] < objective.count));
      if (!wanted) { hero.message = `${ITEMS[node.item].name}. Accept the zone quest before gathering it.`; return; }
      hero.gathered.push(node.id); hero.inventory[node.item] = Math.min(999, (hero.inventory[node.item] ?? 0) + 1);
      this.advanceQuests(hero, 'gather', node.item); this.effect(hero.zone, 'gather', { x: node.x, z: node.z });
      hero.message = `${ITEMS[node.item].name} gathered.`; this.gainXp(hero, 10); return;
    }
    const portal = zone.portals.find(p => distance(hero, p) < 3);
    if (portal) return this.travel(hero, portal);
    hero.message = zone.npcs.some(n => n.role === 'quest' && !hero.quests[n.quest]) ? `Speak to ${zone.npcs.find(n => n.role === 'quest').name} first.` : 'Move closer to someone or something to interact.';
  }
  travel(hero, portal) {
    const target = ZONES[portal.to];
    if (!hero.zones.includes(portal.to)) { hero.message = `${portal.name}: this build does not include ${target.name}.`; return; }
    if (hero.level < target.level) { hero.message = `${portal.name}: reach level ${target.level} before travelling to ${target.name}.`; return; }
    const back = target.portals.find(p => p.to === hero.zone);
    const arrival = back ? { x: back.x, z: back.z + (back.z > target.spawn.z ? -2.5 : 2.5) } : target.spawn;
    hero.zone = portal.to; hero.x = arrival.x; hero.z = arrival.z; hero.y = groundHeight(hero.zone, hero.x, hero.z); hero.yaw = Math.atan2(target.spawn.x - arrival.x, target.spawn.z - arrival.z);
    hero.input = { x: 0, z: 0 }; hero.vendor = null; hero.arrivedAt = this.time; hero.message = `Entering ${target.name}.`;
    for (const enemy of this.enemies) if (enemy.targetId === hero.id) enemy.targetId = null;
  }
  tick(delta) {
    const dt = clamp(Number.isFinite(delta) ? delta : 0, 0, .1); this.time += dt;
    for (const hero of this.players.values()) {
      const zone = ZONES[hero.zone]; const speed = CLASSES[hero.class].speed;
      if (this.time - hero.inputAt > .4) hero.input = { x: 0, z: 0 };
      moveOnGround(hero, hero.input.x * dt * speed, hero.input.z * dt * speed, zone.bounds);
      hero.y = groundHeight(hero.zone, hero.x, hero.z);
      if (hero.input.x || hero.input.z) hero.yaw = Math.atan2(hero.input.x, hero.input.z);
      if (inSanctuary(zone, hero)) hero.health = Math.min(hero.maxHealth, hero.health + dt * 7);
      else if (this.time - hero.hurtAt > 6) hero.health = Math.min(hero.maxHealth, hero.health + dt * 1.5);
      if (hero.vendor && distance(hero, zone.npcs.find(n => n.id === hero.vendor) ?? hero) > 4) hero.vendor = null;
    }
    for (const enemy of this.enemies) {
      const kind = ENEMIES[enemy.kind]; const zone = ZONES[enemy.zone];
      enemy.y = groundHeight(enemy.zone, enemy.x, enemy.z);
      if (enemy.health <= 0) {
        if (this.time >= enemy.respawnAt) Object.assign(enemy, { x: enemy.spawnX, z: enemy.spawnZ, health: kind.health, targetId: null, burstAt: 0, nextBurstAt: 0 });
        continue;
      }
      let target = enemy.targetId ? this.players.get(enemy.targetId) : undefined;
      if (!target || target.zone !== enemy.zone || inSanctuary(zone, target) || distance(target, enemy) > kind.aggro + 6) {
        enemy.targetId = null;
        target = [...this.players.values()].filter(p => p.zone === enemy.zone && !inSanctuary(zone, p) && distance(p, enemy) < kind.aggro).sort((a, b) => distance(a, enemy) - distance(b, enemy))[0];
        if (target) enemy.targetId = target.id;
      }
      const home = { x: enemy.spawnX, z: enemy.spawnZ };
      if (!target || distance(enemy, home) > 18) {
        // Leash: walk home and recover.
        enemy.targetId = null; enemy.burstAt = 0;
        const d = distance(enemy, home);
        if (d > .2) { moveOnGround(enemy, (home.x - enemy.x) / d * dt * kind.speed * 1.5, (home.z - enemy.z) / d * dt * kind.speed * 1.5, zone.bounds); enemy.yaw = Math.atan2(home.x - enemy.x, home.z - enemy.z); }
        else if (enemy.health < enemy.maxHealth) { enemy.health = Math.min(enemy.maxHealth, enemy.health + dt * enemy.maxHealth * .1); if (enemy.health === enemy.maxHealth) enemy.hurtBy.clear(); }
        continue;
      }
      const d = distance(target, enemy);
      enemy.yaw = Math.atan2(target.x - enemy.x, target.z - enemy.z);
      if (d > kind.attackRange * .8) { moveOnGround(enemy, (target.x - enemy.x) / d * dt * kind.speed, (target.z - enemy.z) / d * dt * kind.speed, zone.bounds); }
      if (d < kind.attackRange && clearSight(enemy.zone, enemy, target) && this.time - enemy.attackAt > kind.attackCooldown) {
        enemy.attackAt = this.time; this.effect(enemy.zone, 'enemyhit', { x: target.x, z: target.z });
        this.hurtHero(target, kind.damage, kind.name);
      }
      if (kind.burst) {
        if (!enemy.burstAt && this.time >= enemy.nextBurstAt) enemy.burstAt = this.time + kind.burst.telegraph;
        else if (enemy.burstAt && this.time >= enemy.burstAt) {
          enemy.burstAt = 0; enemy.nextBurstAt = this.time + kind.burst.cooldown;
          this.effect(enemy.zone, 'burst', { x: enemy.x, z: enemy.z, radius: kind.burst.radius });
          for (const hero of this.players.values()) if (hero.zone === enemy.zone && distance(hero, enemy) < kind.burst.radius) this.hurtHero(hero, kind.burst.damage, `${kind.name}’s ember burst`);
        }
      }
    }
    this.effects = this.effects.filter(effect => this.time - effect.at < EFFECT_LIFETIME);
  }
  snapshot(id) {
    const self = this.players.get(id); const zone = self?.zone ?? HOME_ZONE;
    return { version: REALM_VERSION, time: this.time, selfId: id, zone, online: this.players.size,
      players: [...this.players.values()].filter(p => p.zone === zone && (!self || p.id === id || distance(p, self) < 65)).map(({ input, inputAt, zones, ...p }) => structuredClone(p)),
      enemies: this.enemies.filter(e => e.zone === zone && (!self || distance(e, self) < 75)).map(({ hurtBy, targetId, spawnX, spawnZ, ...e }) => ({ ...e, y: groundHeight(e.zone, e.x, e.z), engaged: hurtBy.size })),
      effects: this.effects.filter(e => e.zone === zone && (!self || distance(e, self) < 75)).map(({ zone: _zone, ...e }) => ({ ...e })) };
  }
}
