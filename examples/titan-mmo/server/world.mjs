/** The same deterministic rules run in solo practice and on the authoritative realm server. */
export const REALM_VERSION = 1;
export const ITEMS = Object.freeze({
  'training-blade': { name: 'Training blade', icon: '⚔', damage: 16, rarity: 'Common', description: 'A dependable first blade. +16 attack.' },
  'warden-blade': { name: 'Warden’s blade', icon: '⚔', damage: 28, rarity: 'Rare', description: 'Earned by protecting the meadow. +28 attack.' },
  'sun-shard': { name: 'Sun shard', icon: '◆', rarity: 'Uncommon', description: 'A warm fragment of the old beacon.' },
  potion: { name: 'Meadow tonic', icon: '✚', rarity: 'Common', description: 'Restores 45 health. Consumed when used.' },
});
export const WARDEN = { x: 0, z: -3, name: 'Warden Elara' };
export const SHARDS = [{ id: 'shard-1', x: -6, z: -8 }, { id: 'shard-2', x: 6, z: -11 }, { id: 'shard-3', x: 2, z: -17 }];
export const SPAWNS = [{ id: 'wisp-1', x: -4, z: -11 }, { id: 'wisp-2', x: 5, z: -16 }, { id: 'wisp-3', x: -7, z: -19 }];
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const number = (n, fallback, max) => typeof n === 'number' && Number.isFinite(n) ? clamp(Math.floor(n), 0, max) : fallback;
export function newHero(id, name, saved) {
  const data = saved?.version === REALM_VERSION ? saved : {};
  const inventory = { 'training-blade': 1, potion: 3 };
  if (data.inventory && typeof data.inventory === 'object') {
    for (const item of Object.keys(ITEMS)) inventory[item] = number(data.inventory[item], inventory[item] ?? 0, 999);
  }
  const gathered = Array.isArray(data.gathered) ? [...new Set(data.gathered.filter(id => SHARDS.some(s => s.id === id)))] : [];
  return { id, name: String(name || 'Wayfarer').trim().slice(0, 24), x: 0, z: 3, yaw: Math.PI, health: 100,
    gold: number(data.gold, 0, 99999), xp: number(data.xp, 0, 99999), inventory, gathered,
    quest: ['active', 'complete'].includes(data.quest) ? data.quest : 'available', kills: number(data.kills, 0, 2),
    equipped: data.equipped === 'warden-blade' && inventory['warden-blade'] > 0 ? 'warden-blade' : 'training-blade',
    attackAt: -100, hurtAt: -100, input: { x: 0, z: 0 }, inputAt: 0, message: 'Welcome to Ember Meadow. Speak to Warden Elara.' };
}
export function saveHero(hero) {
  const { gold, xp, inventory, gathered, quest, kills, equipped } = hero;
  return structuredClone({ version: REALM_VERSION, gold, xp, inventory, gathered, quest, kills, equipped });
}
export class RealmWorld {
  time = 0;
  players = new Map();
  enemies = SPAWNS.map(s => ({ ...s, health: 48, respawnAt: 0, hitAt: -100, attackAt: -100 }));
  join(id, name, saved) {
    if (this.players.has(id)) throw new Error('This character is already in the realm.');
    const hero = newHero(id, name, saved); this.players.set(id, hero); return hero;
  }
  leave(id) { this.players.delete(id); }
  command(id, command) {
    const hero = this.players.get(id);
    if (!hero || !command || typeof command !== 'object') return;
    if (command.type === 'move') {
      const x = Number.isFinite(command.x) ? clamp(command.x, -1, 1) : 0;
      const z = Number.isFinite(command.z) ? clamp(command.z, -1, 1) : 0;
      const length = Math.max(1, Math.hypot(x, z));
      hero.input = { x: x / length, z: z / length }; hero.inputAt = this.time; return;
    }
    if (command.type === 'equip' && ['training-blade', 'warden-blade'].includes(command.item) && hero.inventory[command.item] > 0) {
      hero.equipped = command.item; hero.message = `${ITEMS[command.item].name} equipped.`;
    }
    if (command.type === 'potion') {
      if (!hero.inventory.potion) { hero.message = 'No meadow tonics left.'; return; }
      if (hero.health === 100) { hero.message = 'You are already at full health.'; return; }
      hero.inventory.potion--; hero.health = Math.min(100, hero.health + 45); hero.message = 'Meadow tonic restored 45 health.';
    }
    if (command.type === 'interact') {
      if (distance(hero, WARDEN) < 3) {
        if (hero.quest === 'available') { hero.quest = 'active'; hero.message = 'A light in the meadow: gather 3 sun shards and defeat 2 wild wisps.'; }
        else if (hero.quest === 'active' && hero.gathered.length === 3 && hero.kills >= 2) {
          hero.quest = 'complete'; hero.gold += 50; hero.xp += 100; hero.inventory['warden-blade'] = 1;
          hero.message = 'Quest complete! +50 gold, +100 XP, and Warden’s blade. Open your bag to equip it.';
        } else hero.message = hero.quest === 'complete' ? 'The meadow remembers your kindness, Warden.' : 'Find the golden shards and defeat 2 wisps, then return to me.';
        return;
      }
      const shard = SHARDS.find(s => distance(hero, s) < 2.7 && !hero.gathered.includes(s.id));
      if (shard && hero.quest === 'active') {
        hero.gathered.push(shard.id); hero.inventory['sun-shard'] = (hero.inventory['sun-shard'] ?? 0) + 1;
        hero.xp += 10; hero.message = `Sun shard gathered · ${hero.gathered.length}/3`; return;
      }
      hero.message = hero.quest === 'available' ? 'Speak to Warden Elara at the village beacon first.' : 'Move closer to a golden shard or Warden Elara.';
    }
    if (command.type === 'attack' && this.time - hero.attackAt >= 0.55) {
      hero.attackAt = this.time;
      const target = this.enemies.filter(e => e.health > 0 && distance(hero, e) < 3.2).sort((a, b) => distance(hero, a) - distance(hero, b))[0];
      if (!target) { hero.message = 'Move within sword range of a wild wisp.'; return; }
      target.health = Math.max(0, target.health - ITEMS[hero.equipped].damage); target.hitAt = this.time;
      if (target.health === 0) {
        target.respawnAt = this.time + 18; hero.gold += 8; hero.xp += 25;
        if (hero.quest === 'active') hero.kills = Math.min(2, hero.kills + 1);
        hero.message = 'Wild wisp defeated · +8 gold · +25 XP';
      } else hero.message = `Hit wild wisp for ${ITEMS[hero.equipped].damage}.`;
    }
  }
  tick(delta) {
    const dt = clamp(Number.isFinite(delta) ? delta : 0, 0, 0.1); this.time += dt;
    for (const hero of this.players.values()) {
      if (this.time - hero.inputAt > 0.4) hero.input = { x: 0, z: 0 };
      hero.x = clamp(hero.x + hero.input.x * dt * 5, -23, 23);
      hero.z = clamp(hero.z + hero.input.z * dt * 5, -24, 11);
      if (hero.input.x || hero.input.z) hero.yaw = Math.atan2(hero.input.x, hero.input.z);
      if (hero.z > -5) hero.health = Math.min(100, hero.health + dt * 7);
    }
    for (const enemy of this.enemies) {
      if (enemy.health <= 0) {
        if (this.time >= enemy.respawnAt) Object.assign(enemy, SPAWNS.find(s => s.id === enemy.id), { health: 48 });
        continue;
      }
      const target = [...this.players.values()].filter(p => p.z < -5 && distance(p, enemy) < 6).sort((a, b) => distance(a, enemy) - distance(b, enemy))[0];
      if (!target) continue;
      const d = distance(target, enemy);
      if (d > 1.5) { enemy.x += (target.x - enemy.x) / d * dt * 1.6; enemy.z += (target.z - enemy.z) / d * dt * 1.6; }
      if (d < 2 && this.time - enemy.attackAt > 1.4) {
        enemy.attackAt = this.time; target.health = Math.max(0, target.health - 9); target.hurtAt = this.time;
        if (target.health === 0) { target.x = 0; target.z = 3; target.health = 100; target.input = { x: 0, z: 0 }; target.message = 'Elara brought you back to the village. Your items are safe.'; }
      }
    }
  }
  snapshot(id) {
    return { version: REALM_VERSION, time: this.time, selfId: id,
      players: [...this.players.values()].map(({ input, inputAt, ...p }) => structuredClone(p)),
      enemies: structuredClone(this.enemies) };
  }
}
