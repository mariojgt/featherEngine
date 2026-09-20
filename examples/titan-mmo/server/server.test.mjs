import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { RealmWorld, SHARDS, saveHero } from './world.mjs';
import { startRealm } from './server.mjs';

test('realm owns movement speed, stale inputs, finite values and attack cooldown', () => {
  const world = new RealmWorld(); const hero = world.join('a', 'Hero');
  world.command('a', { type: 'move', x: 9999, z: -9999 });
  for (let i = 0; i < 4; i++) world.tick(.1);
  assert.ok(Math.hypot(hero.x, hero.z - 3) <= 2.001);
  const x = hero.x; for (let i = 0; i < 10; i++) world.tick(.1); assert.equal(hero.x, x);
  world.command('a', { type: 'move', x: Infinity, z: NaN }); world.tick(.1); assert.ok(Number.isFinite(hero.x));
  const enemy = world.enemies[0]; hero.x = enemy.x; hero.z = enemy.z;
  world.command('a', { type: 'attack' }); world.command('a', { type: 'attack' }); assert.equal(enemy.health, 32);
  world.command('a', { type: 'grant', item: 'warden-blade', amount: 999 });
  world.command('a', { type: 'equip', item: 'warden-blade' }); assert.equal(hero.equipped, 'training-blade');
});

test('quest requires proximity, rewards once, equipment ownership, and serializable progress', () => {
  const world = new RealmWorld(); const hero = world.join('a', 'Hero');
  world.command('a', { type: 'interact' }); assert.equal(hero.quest, 'available');
  hero.z = -3; world.command('a', { type: 'interact' }); assert.equal(hero.quest, 'active');
  for (const shard of SHARDS) { hero.x = shard.x; hero.z = shard.z; world.command('a', { type: 'interact' }); world.command('a', { type: 'interact' }); }
  assert.equal(hero.inventory['sun-shard'], 3);
  for (const enemy of world.enemies.slice(0, 2)) {
    hero.x = enemy.x; hero.z = enemy.z;
    for (let i = 0; i < 3; i++) { world.command('a', { type: 'attack' }); for (let j = 0; j < 6; j++) world.tick(.1); }
  }
  hero.x = 0; hero.z = -3; world.command('a', { type: 'interact' });
  assert.equal(hero.quest, 'complete'); assert.equal(hero.gold, 66);
  world.command('a', { type: 'interact' }); assert.equal(hero.gold, 66);
  world.command('a', { type: 'equip', item: 'warden-blade' }); assert.equal(hero.equipped, 'warden-blade');
  const saved = saveHero(hero); world.leave('a');
  assert.equal(world.join('a', 'Hero', saved).equipped, 'warden-blade');
});

const socketJoin = async (base, ticket) => {
  const socket = new WebSocket(`${base.replace('http', 'ws')}/realm`);
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.terminate(); reject(new Error('Timed out waiting for realm')); }, 3000);
    socket.once('error', reject); socket.on('message', bytes => { const data = JSON.parse(bytes); if (data.type === 'snapshot') { clearTimeout(timer); resolve(data.data); } });
  });
  socket.on('open', () => socket.send(JSON.stringify({ type: 'join', ticket })));
  return { socket, snapshot: await ready };
};
test('real HTTP and WebSocket: two players, origin checks, one-use tickets, disk restore', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ember-realm-')); const dataFile = join(dir, 'players.json');
  let realm = await startRealm({ port: 0, dataFile }); let a, b;
  try {
    let base = `http://127.0.0.1:${realm.port}`;
    assert.equal((await (await fetch(`${base}/health`)).json()).authMode, 'local');
    assert.equal((await fetch(`${base}/auth`, { method: 'POST', headers: { Origin: 'https://untrusted.example' }, body: '{}' })).status, 403);
    const login = async (name, resume) => (await fetch(`${base}/auth`, { method: 'POST', body: JSON.stringify({ mode: 'guest', name, resume }) })).json();
    const auth = await login('Aster'); const authB = await login('Rowan');
    a = await socketJoin(base, auth.ticket); b = await socketJoin(base, authB.ticket);
    assert.equal(b.snapshot.players.length, 2); assert.equal(new Set(b.snapshot.players.map(p => p.id)).size, 2);
    const replay = new WebSocket(`${base.replace('http', 'ws')}/realm`);
    const closed = new Promise(resolve => replay.once('close', code => resolve(code)));
    replay.on('open', () => replay.send(JSON.stringify({ type: 'join', ticket: auth.ticket })));
    assert.equal(await closed, 1008);
    const hero = realm.world.players.get(a.snapshot.selfId); hero.gold = 42;
    a.socket.send(JSON.stringify({ type: 'move', x: 0, z: -1 }));
    await new Promise(resolve => setTimeout(resolve, 160)); assert.ok(hero.z < 3);
    await realm.close(); realm = await startRealm({ port: 0, dataFile }); base = `http://127.0.0.1:${realm.port}`;
    const returned = await login('Aster', auth.resume); a = await socketJoin(base, returned.ticket);
    assert.equal(a.snapshot.players[0].gold, 42);
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
    assert.equal(calls[1].body.data.equipped, 'training-blade');
  } finally {
    player?.socket.terminate(); await realm.close();
    await new Promise(resolve => backend.close(resolve)); await rm(dir, { recursive: true, force: true });
  }
});
