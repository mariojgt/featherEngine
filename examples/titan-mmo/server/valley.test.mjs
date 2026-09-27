import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { RealmWorld, newHero, saveHero, ZONES } from './world.mjs';
import { VALLEY_ID, walkable, groundHeight, moveOnGround, clearSight } from './valley.mjs';
import { DEFAULT_APPEARANCE } from './appearance.mjs';
import { startRealm } from './server.mjs';
const look = { armor: 'ember', trim: 'silver', headpiece: 'crest' };
const options = { zones: [VALLEY_ID], class: 'mage', appearance: look };

test('new characters enter the selected world; validated appearance persists and cannot change combat stats', () => {
  const hero = newHero('a', 'Aster', undefined, options);
  assert.equal(hero.zone, VALLEY_ID); assert.deepEqual(hero.appearance, look);
  const restored = newHero('a', 'Aster', saveHero(hero), { ...options, class: 'warrior', appearance: DEFAULT_APPEARANCE });
  assert.deepEqual(restored.appearance, look); assert.equal(restored.class, 'mage');
  const malicious = newHero('b', 'B', null, { ...options, appearance: { armor: '__proto__', trim: 'red', headpiece: 'script', health: 99999 } });
  assert.deepEqual(malicious.appearance, DEFAULT_APPEARANCE); assert.equal(malicious.health, hero.health);
  const legacy = saveHero(hero); delete legacy.appearance;
  assert.deepEqual(newHero('c', 'C', legacy).appearance, DEFAULT_APPEARANCE);
});

test('movement slides along solids, cannot tunnel, stays inside bounds and follows terrain', () => {
  const world = new RealmWorld(), hero = world.join('a', 'A', null, options);
  for (let i = 0; i < 80; i++) { world.command('a', { type: 'move', x: -1, z: 0 }); world.tick(.05); }
  assert.ok(hero.x > -10.2 && hero.x < -9.8, `stopped at village cottage: ${hero.x}`);
  assert.ok(walkable(hero.zone, hero.x, hero.z));
  const z = hero.z;
  for (let i = 0; i < 20; i++) { world.command('a', { type: 'move', x: -1, z: -.5 }); world.tick(.05); }
  assert.ok(hero.z < z, 'slides along the wall');
  const fast = { zone: VALLEY_ID, x: 0, z: 62 };
  moveOnGround(fast, -80, 0, ZONES[VALLEY_ID].bounds);
  assert.ok(fast.x > -10.2, 'a single large displacement cannot skip a solid');
  assert.equal(clearSight(VALLEY_ID, { x: -9, z: 62 }, { x: -19, z: 62 }), false);
  hero.x = 0; hero.z = 20;
  world.command('a', { type: 'move', x: 0, z: -1 }); world.tick(.1);
  assert.equal(hero.y, groundHeight(VALLEY_ID, hero.x, hero.z));
  assert.notEqual(hero.y, 0);
  hero.x = 94; hero.z = 90;
  world.command('a', { type: 'move', x: 10000, z: 0 }); world.tick(.1); assert.equal(hero.x, 94);
});

test('all quest anchors are reachable and the north road remains open', () => {
  const zone = ZONES[VALLEY_ID];
  for (const p of [zone.spawn, ...zone.npcs, ...zone.gatherables, ...zone.spawns]) assert.ok(walkable(VALLEY_ID, p.x, p.z), JSON.stringify(p));
  for (let z = -90; z <= 90; z++) assert.ok(walkable(VALLEY_ID, 0, z));
});

test('second wind heals on the server, rejects spam and does not consume a full-health cooldown', () => {
  const world = new RealmWorld(), hero = world.join('a', 'A', null, options);
  world.command('a', { type: 'recover' }); assert.equal(hero.recoveryAt, -100);
  hero.health = 20; world.command('a', { type: 'recover', amount: 99999 });
  assert.equal(hero.health, 45.5);
  const health = hero.health; world.command('a', { type: 'recover' }); assert.equal(hero.health, health);
  for (let i = 0; i < 141; i++) world.tick(.1);
  hero.health = 20; world.command('a', { type: 'recover' }); assert.equal(hero.health, 45.5);
});

function waitMessage(socket, predicate) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off('message', receive); reject(new Error('Realm message timed out')); }, 4000);
    function receive(bytes) { const message = JSON.parse(bytes); if (predicate(message)) { clearTimeout(timer); socket.off('message', receive); resolve(message); } }
    socket.on('message', receive);
  });
}
async function player(base, name, resume, appearance = look) {
  const auth = await (await fetch(`${base}/auth`, { method: 'POST', body: JSON.stringify({ name, mode: 'guest', resume }) })).json();
  const socket = new WebSocket(`${base.replace('http', 'ws')}/realm`);
  const ready = waitMessage(socket, m => m.type === 'snapshot');
  socket.on('open', () => socket.send(JSON.stringify({ type: 'join', ticket: auth.ticket, ...options, appearance })));
  return { socket, auth, snapshot: (await ready).data };
}
test('two real clients see customized heroes, exchange chat, save and restore appearance after server restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'feather-valley-'));
  const config = { port: 0, dataFile: join(dir, 'players.json') };
  let realm = await startRealm(config), a, b;
  try {
    const base = `http://127.0.0.1:${realm.port}`;
    a = await player(base, 'Aster'); b = await player(base, 'Rowan', undefined, { armor: 'moss', trim: 'bronze', headpiece: 'crown' });
    assert.equal(b.snapshot.players.length, 2);
    assert.deepEqual(b.snapshot.players.find(p => p.name === 'Aster').appearance, look);
    const chat = waitMessage(b.socket, m => m.type === 'chat');
    a.socket.send(JSON.stringify({ type: 'say', text: 'Meet me by the beacon.' }));
    assert.equal((await chat).text, 'Meet me by the beacon.');
    const movement = waitMessage(b.socket, m => m.type === 'snapshot' && m.data.players.some(p => p.name === 'Aster' && p.z < 61.9));
    a.socket.send(JSON.stringify({ type: 'move', x: 0, z: -1 })); await movement;
    const saved = waitMessage(a.socket, m => m.type === 'notice'); a.socket.send(JSON.stringify({ type: 'save' })); assert.match((await saved).message, /saved/);
    const resume = a.auth.resume;
    a.socket.terminate(); b.socket.terminate(); await realm.close(); realm = await startRealm(config);
    a = await player(`http://127.0.0.1:${realm.port}`, 'Aster', resume, DEFAULT_APPEARANCE);
    assert.deepEqual(a.snapshot.players[0].appearance, look); assert.equal(a.snapshot.players[0].zone, VALLEY_ID);
  } finally { a?.socket.terminate(); b?.socket.terminate(); await realm.close(); await rm(dir, { recursive: true, force: true }); }
});
