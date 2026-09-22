import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { RealmWorld, ZONES, QUESTS, ITEMS, ENEMIES, CLASSES, saveHero, newHero, heroDamage, levelForXp, LEVEL_XP } from './world.mjs';
import { startRealm } from './server.mjs';

const meadow = ZONES['ember-meadow'];
const at = (hero, point) => { hero.x = point.x; hero.z = point.z; };
const settle = (world, seconds) => { for (let i = 0; i < seconds * 10; i++) world.tick(.1); };
/** Defeat one enemy through real commands (no health edits). */
const slay = (world, id, enemy) => {
  const hero = world.players.get(id); at(hero, enemy);
  for (let i = 0; i < 40 && enemy.health > 0; i++) { at(hero, enemy); world.command(id, { type: 'attack' }); settle(world, .6); }
  assert.equal(enemy.health, 0, `${enemy.id} should fall`);
};

test('realm owns movement speed, zone bounds, stale inputs, finite values and attack cooldown', () => {
  const world = new RealmWorld(); const hero = world.join('a', 'Hero');
  assert.equal(hero.class, 'warrior'); assert.equal(hero.zone, 'ember-meadow');
  world.command('a', { type: 'move', x: 9999, z: -9999 });
  for (let i = 0; i < 4; i++) world.tick(.1);
  assert.ok(Math.hypot(hero.x, hero.z - 3) <= 2.001);
  const x = hero.x; for (let i = 0; i < 10; i++) world.tick(.1); assert.equal(hero.x, x);
  world.command('a', { type: 'move', x: Infinity, z: NaN }); world.tick(.1); assert.ok(Number.isFinite(hero.x));
  for (let i = 0; i < 300; i++) { world.command('a', { type: 'move', x: 0, z: -1 }); world.tick(.1); }
  assert.equal(hero.z, meadow.bounds.minZ, 'movement clamps to the zone bounds');
  const enemy = world.enemies.find(e => e.id === 'wisp-1'); at(hero, enemy);
  world.command('a', { type: 'attack' }); world.command('a', { type: 'attack' }); assert.equal(enemy.health, ENEMIES.wisp.health - heroDamage(hero));
  world.command('a', { type: 'grant', item: 'warden-blade', amount: 999 });
  world.command('a', { type: 'equip', item: 'warden-blade' }); assert.equal(hero.equipped.weapon, 'training-blade');
});

test('classes differ in reach, health and abilities; abilities respect cooldown and need targets', () => {
  const world = new RealmWorld();
  const mage = world.join('m', 'Mage', undefined, { class: 'mage' }); const warrior = world.join('w', 'Warrior', undefined, { class: 'warrior' });
  assert.equal(mage.maxHealth, CLASSES.mage.health); assert.equal(warrior.maxHealth, CLASSES.warrior.health);
  const enemy = world.enemies.find(e => e.id === 'wisp-2');
  at(mage, { x: enemy.x, z: enemy.z + 8 }); at(warrior, { x: enemy.x, z: enemy.z + 8 });
  world.command('w', { type: 'attack' }); assert.equal(enemy.health, ENEMIES.wisp.health); assert.match(warrior.message, /reach/);
  world.command('m', { type: 'attack' }); assert.equal(enemy.health, ENEMIES.wisp.health - heroDamage(mage));
  assert.equal(world.effects.filter(e => e.kind === 'bolt').length, 1);
  world.command('m', { type: 'ability' }); assert.match(mage.message, /No enemies close enough/); assert.equal(mage.abilityAt, -100);
  at(mage, enemy); world.command('m', { type: 'ability' });
  const expected = ENEMIES.wisp.health - heroDamage(mage) - Math.round(heroDamage(mage) * CLASSES.mage.ability.damage);
  assert.equal(enemy.health, Math.max(0, expected));
  world.command('m', { type: 'ability' }); assert.match(mage.message, /recharging/);
  const saved = saveHero(mage); world.leave('m');
  assert.equal(world.join('m', 'Mage', saved, { class: 'warrior' }).class, 'mage', 'a saved class wins over the login choice');
});

test('quest requires proximity and level, rewards once, equipment ownership, XP levels and serializable progress', () => {
  const world = new RealmWorld(); const hero = world.join('a', 'Hero');
  world.command('a', { type: 'interact' }); assert.equal(hero.quests['light-in-the-meadow'], undefined);
  at(hero, meadow.npcs[0]); world.command('a', { type: 'interact' }); assert.equal(hero.quests['light-in-the-meadow'].state, 'active');
  for (const shard of meadow.gatherables) { at(hero, shard); world.command('a', { type: 'interact' }); world.command('a', { type: 'interact' }); }
  assert.equal(hero.inventory['sun-shard'], 3);
  for (const enemy of world.enemies.filter(e => e.zone === 'ember-meadow').slice(0, 2)) slay(world, 'a', enemy);
  const goldBefore = hero.gold; const xpBefore = hero.xp;
  at(hero, meadow.npcs[0]); world.command('a', { type: 'interact' });
  assert.equal(hero.quests['light-in-the-meadow'].state, 'complete');
  assert.equal(hero.gold, goldBefore + QUESTS['light-in-the-meadow'].reward.gold);
  assert.equal(hero.xp, xpBefore + QUESTS['light-in-the-meadow'].reward.xp);
  assert.equal(hero.level, levelForXp(hero.xp)); assert.ok(hero.level >= 2, 'the first quest reaches level 2');
  assert.equal(hero.maxHealth, CLASSES.warrior.health + (hero.level - 1) * 10);
  world.command('a', { type: 'interact' }); assert.equal(hero.gold, goldBefore + 50);
  world.command('a', { type: 'equip', item: 'warden-blade' }); assert.equal(hero.equipped.weapon, 'warden-blade');
  world.command('a', { type: 'unequip', slot: 'weapon' }); assert.equal(hero.equipped.weapon, 'warden-blade');
  const saved = saveHero(hero); assert.equal(saved.version, 2); world.leave('a');
  const restored = world.join('a', 'Hero', JSON.parse(JSON.stringify(saved)));
  assert.equal(restored.equipped.weapon, 'warden-blade'); assert.equal(restored.quests['light-in-the-meadow'].state, 'complete'); assert.equal(restored.level, hero.level);
});

test('version 1 Ember Meadow saves migrate into the new shape', () => {
  const legacy = { version: 1, gold: 66, xp: 130, inventory: { 'training-blade': 1, 'warden-blade': 1, potion: 2, 'sun-shard': 3 }, gathered: ['shard-1', 'shard-2', 'shard-3'], quest: 'complete', kills: 2, equipped: 'warden-blade' };
  const hero = newHero('a', 'Aster', legacy, { class: 'ranger' });
  assert.equal(hero.class, 'ranger'); assert.equal(hero.gold, 66); assert.equal(hero.level, 2);
  assert.equal(hero.equipped.weapon, 'warden-blade'); assert.equal(hero.inventory.potion, 2);
  assert.deepEqual(hero.quests['light-in-the-meadow'], { state: 'complete', progress: [3, 2] });
  assert.deepEqual(newHero('b', 'Fresh', { version: 99, gold: 5 }).quests, {});
});

test('vendors sell for gold, sanctuaries heal, death returns the hero with items', () => {
  const world = new RealmWorld(); const hero = world.join('a', 'Hero');
  hero.gold = 20; hero.inventory.potion = 0;
  world.command('a', { type: 'buy', item: 'potion' }); assert.match(hero.message, /closer to a vendor/);
  at(hero, meadow.npcs[1]); world.command('a', { type: 'interact' }); assert.equal(hero.vendor, 'bram');
  world.command('a', { type: 'buy', item: 'potion' }); assert.equal(hero.inventory.potion, 1); assert.equal(hero.gold, 20 - ITEMS.potion.price);
  world.command('a', { type: 'buy', item: 'potion' }); assert.equal(hero.inventory.potion, 1); assert.match(hero.message, /need/);
  world.command('a', { type: 'buy', item: 'warden-blade' }); assert.match(hero.message, /Not for sale/);
  const enemy = world.enemies.find(e => e.id === 'wisp-3'); at(hero, { x: enemy.x, z: enemy.z + 1 });
  settle(world, 40);
  assert.ok(hero.deaths >= 1, 'an idle hero beside a wisp is eventually struck down');
  assert.deepEqual([hero.x, hero.z], [meadow.spawn.x, meadow.spawn.z]); assert.equal(hero.health, hero.maxHealth); assert.equal(hero.inventory.potion, 1);
  hero.health = 30; settle(world, 5); assert.ok(hero.health > 60, 'the village sanctuary heals');
});

test('waystones gate travel by level and by the zones the client build contains; enemies leash home', () => {
  const world = new RealmWorld(); const hero = world.join('a', 'Hero');
  const gate = meadow.portals[0]; at(hero, gate);
  world.command('a', { type: 'interact' }); assert.equal(hero.zone, 'ember-meadow'); assert.match(hero.message, /level 2/);
  hero.xp = LEVEL_XP[1]; hero.level = 2; world.command('a', { type: 'interact' });
  assert.equal(hero.zone, 'thornwood'); assert.equal(world.snapshot('a').zone, 'thornwood');
  assert.ok(Math.abs(hero.z - ZONES.thornwood.portals[0].z) < 4, 'arrives beside the return waystone');
  assert.equal(world.snapshot('a').enemies.length, ZONES.thornwood.spawns.length);
  assert.ok(world.snapshot('a').enemies.every(e => e.hurtBy === undefined && e.targetId === undefined && e.kind), 'snapshot hides internal state');
  const limited = world.join('b', 'Solo', undefined, { zones: ['ember-meadow'] }); at(limited, gate); limited.xp = 500; limited.level = 3;
  world.command('b', { type: 'interact' }); assert.equal(limited.zone, 'ember-meadow'); assert.match(limited.message, /does not include/);
  const boar = world.enemies.find(e => e.id === 'boar-1'); at(hero, { x: boar.x, z: boar.z + 1.2 }); settle(world, 1.5);
  assert.ok(Math.hypot(boar.x - boar.spawnX, boar.z - boar.spawnZ) > .05 || hero.health < hero.maxHealth, 'the boar engages a nearby hero');
  at(hero, { x: ZONES.thornwood.bounds.maxX, z: boar.z }); settle(world, 20);
  assert.ok(Math.hypot(boar.x - boar.spawnX, boar.z - boar.spawnZ) < .5, 'the boar walks home when its target is gone');
});

test('the Ashen Warden telegraphs bursts, rewards every participant and drops the ember core once', () => {
  const world = new RealmWorld();
  const a = world.join('a', 'A', { version: 2, xp: 3000, zone: 'cinder-keep', class: 'warrior' }); const b = world.join('b', 'B', { version: 2, xp: 3000, zone: 'cinder-keep', class: 'mage' });
  assert.equal(a.zone, 'cinder-keep'); assert.equal(a.level, 8);
  const boss = world.enemies.find(e => e.kind === 'boss');
  at(a, { x: boss.x, z: boss.z + 1.5 }); at(b, { x: boss.x, z: boss.z + 6 });
  world.command('a', { type: 'attack' }); world.command('b', { type: 'attack' });
  settle(world, ENEMIES.boss.burst.telegraph + .3);
  assert.ok(world.effects.some(e => e.kind === 'burst'), 'burst lands after the telegraph');
  assert.ok(a.health < a.maxHealth, 'the warrior inside the ring is burned');
  assert.equal(b.health, b.maxHealth, 'the mage outside the ring is safe from the burst');
  const goldA = a.gold, goldB = b.gold;
  for (let i = 0; i < 200 && boss.health > 0; i++) { at(a, { x: boss.x, z: boss.z + 1 }); a.health = a.maxHealth; world.command('a', { type: 'attack' }); world.command('a', { type: 'ability' }); settle(world, .6); }
  assert.equal(boss.health, 0);
  assert.equal(a.gold, goldA + ENEMIES.boss.gold); assert.equal(b.gold, goldB + ENEMIES.boss.gold, 'the mage who hit once still shares the kill');
  assert.equal(a.inventory['ember-core'], 1); assert.equal(b.inventory['ember-core'], 1);
  assert.equal(world.snapshot('a').enemies.find(e => e.kind === 'boss').health, 0);
  settle(world, ENEMIES.boss.respawn + 1); assert.equal(boss.health, ENEMIES.boss.health, 'the boss respawns');
});

const socketJoin = async (base, ticket, extra = {}) => {
  const socket = new WebSocket(`${base.replace('http', 'ws')}/realm`);
  const messages = [];
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.terminate(); reject(new Error('Timed out waiting for realm')); }, 3000);
    socket.once('error', reject); socket.on('message', bytes => { const data = JSON.parse(bytes); messages.push(data); if (data.type === 'snapshot') { clearTimeout(timer); resolve(data.data); } });
  });
  socket.on('open', () => socket.send(JSON.stringify({ type: 'join', ticket, ...extra })));
  return { socket, snapshot: await ready, messages };
};
test('real HTTP and WebSocket: two players, origin checks, one-use tickets, zone chat, disk restore', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ember-realm-')); const dataFile = join(dir, 'players.json');
  let realm = await startRealm({ port: 0, dataFile }); let a, b;
  try {
    let base = `http://127.0.0.1:${realm.port}`;
    const health = await (await fetch(`${base}/health`)).json();
    assert.equal(health.authMode, 'local'); assert.equal(health.protocol, 2);
    assert.equal((await fetch(`${base}/auth`, { method: 'POST', headers: { Origin: 'https://untrusted.example' }, body: '{}' })).status, 403);
    const login = async (name, resume) => (await fetch(`${base}/auth`, { method: 'POST', body: JSON.stringify({ mode: 'guest', name, resume }) })).json();
    const auth = await login('Aster'); const authB = await login('Rowan');
    a = await socketJoin(base, auth.ticket, { class: 'mage', zones: ['ember-meadow', 'thornwood'] }); b = await socketJoin(base, authB.ticket);
    assert.equal(b.snapshot.players.length, 2); assert.equal(new Set(b.snapshot.players.map(p => p.id)).size, 2);
    assert.equal(a.snapshot.players.find(p => p.id === a.snapshot.selfId).class, 'mage');
    assert.equal(a.snapshot.version, 2); assert.equal(b.snapshot.online, 2);
    const replay = new WebSocket(`${base.replace('http', 'ws')}/realm`);
    const closed = new Promise(resolve => replay.once('close', code => resolve(code)));
    replay.on('open', () => replay.send(JSON.stringify({ type: 'join', ticket: auth.ticket })));
    assert.equal(await closed, 1008);
    const chat = new Promise(resolve => b.socket.on('message', bytes => { const data = JSON.parse(bytes); if (data.type === 'chat') resolve(data); }));
    a.socket.send(JSON.stringify({ type: 'say', text: '  Hello  meadow!  ' }));
    const received = await chat; assert.equal(received.text, 'Hello  meadow!'); assert.equal(received.from, 'Aster'); assert.equal(received.self, false);
    const hero = realm.world.players.get(a.snapshot.selfId); hero.gold = 42;
    a.socket.send(JSON.stringify({ type: 'move', x: 0, z: -1 }));
    await new Promise(resolve => setTimeout(resolve, 160)); assert.ok(hero.z < 3);
    await realm.close(); realm = await startRealm({ port: 0, dataFile }); base = `http://127.0.0.1:${realm.port}`;
    const returned = await login('Aster', auth.resume); a = await socketJoin(base, returned.ticket, { class: 'warrior' });
    const restored = a.snapshot.players[0];
    assert.equal(restored.gold, 42); assert.equal(restored.class, 'mage', 'the saved class survives a restart');
    assert.ok(!JSON.stringify(a.snapshot).includes(auth.resume));
  } finally { a?.socket.terminate(); b?.socket.terminate(); await realm.close(); await rm(dir, { recursive: true, force: true }); }
});

test('Titan login forwards public credentials and saves a checkpoint with the player token', async () => {
  const calls = [];
  const backend = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    calls.push({ path: req.url, method: req.method, headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString()) });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.url.endsWith('/login') ? { token: 'test-player-uuid', player: { display_name: 'Aster' } } : { ok: true }));
  });
  await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
  const dir = await mkdtemp(join(tmpdir(), 'ember-titan-'));
  const realm = await startRealm({ port: 0, dataFile: join(dir, 'players.json'), titanUrl: `http://127.0.0.1:${backend.address().port}`, gameKey: 'test-game-key' });
  let player;
  try {
    const base = `http://127.0.0.1:${realm.port}`;
    assert.equal((await (await fetch(`${base}/health`)).json()).authMode, 'titan');
    const auth = await (await fetch(`${base}/auth`, { method: 'POST', body: JSON.stringify({ mode: 'login', email: 'test@example.test', password: 'test-password' }) })).json();
    assert.equal(auth.resume, undefined);
    player = await socketJoin(base, auth.ticket);
    assert.equal(player.snapshot.players[0].name, 'Aster');
    assert.ok(!JSON.stringify(player.snapshot).includes('test-player-uuid'));
    const saved = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Cloud save timed out')), 3000);
      player.socket.on('message', bytes => { const message = JSON.parse(bytes); if (message.type === 'notice') { clearTimeout(timer); resolve(message.message); } });
    });
    player.socket.send(JSON.stringify({ type: 'save' }));
    assert.match(await saved, /Titan cloud/);
    assert.equal(calls[0].path, '/functions/v1/game-auth/login');
    assert.equal(calls[0].body.password, 'test-password');
    assert.equal(calls[0].headers['x-game-key'], 'test-game-key');
    assert.equal(calls[1].path, '/functions/v1/game-saves/ember-meadow');
    assert.equal(calls[1].method, 'PUT');
    assert.equal(calls[1].headers['x-player-token'], 'test-player-uuid');
    assert.equal(calls[1].headers.authorization, 'Bearer test-player-uuid');
    assert.equal(calls[1].body.data.version, 2);
    assert.equal(calls[1].body.data.equipped.weapon, 'training-blade');
  } finally {
    player?.socket.terminate(); await realm.close();
    await new Promise(resolve => backend.close(resolve)); await rm(dir, { recursive: true, force: true });
  }
});
