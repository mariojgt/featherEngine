import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { WebSocket } from 'ws';
import { Agent, createServer, request } from 'node:http';
import { writeTitanServer } from '../lib/titan-package.mjs';

const runtime = resolve('src-tauri/export-runtime');
const config = { version: 1, gameId: 'test.feather.realm', host: '127.0.0.1', port: 0, titanUrl: '', gameKey: '', origins: 'https://play.example.test' };
async function start(executable, args, cwd) {
  // Deliberately remove PATH for the desktop executable: it must not discover Node or npm.
  const child = spawn(executable, args, { cwd, env: { ...process.env, PATH: '', PORT: '0', REALM_DATA: join(cwd, 'players.json') }, stdio: ['pipe', 'pipe', 'pipe'] });
  let errors = ''; child.stderr.on('data', bytes => { errors += bytes; });
  const ready = await new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Realm readiness timed out')); }, 10000);
    let output = '';
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Realm exited ${code}: ${errors}`)); });
    child.stdout.on('data', bytes => {
      output += bytes;
      if (!output.includes('\n')) return;
      try { const value = JSON.parse(output.split('\n')[0]); assert.equal(value.type, 'ready'); clearTimeout(timer); resolveReady(value); }
      catch (error) { clearTimeout(timer); child.kill(); reject(error); }
    });
  });
  return { ...ready, async stop() { const ended = once(child, 'exit'); child.stdin.end(); const [code] = await ended; assert.equal(code, 0, errors); }, child };
}
async function joinRealm(url, resume) {
  const auth = await (await fetch(`${url}/auth`, { method: 'POST', headers: { Origin: config.origins }, body: JSON.stringify({ mode: 'guest', name: 'Aster', resume }) })).json();
  const socket = new WebSocket(`${url.replace('http', 'ws')}/realm`, { origin: config.origins });
  let state;
  await new Promise((done, reject) => {
    const timer = setTimeout(() => { socket.terminate(); reject(new Error('Join timed out')); }, 5000);
    socket.on('error', error => { clearTimeout(timer); reject(error); });
    socket.on('open', () => socket.send(JSON.stringify({ type: 'join', ticket: auth.ticket })));
    socket.on('message', bytes => { const message = JSON.parse(bytes); if (message.type === 'snapshot') { state = message.data; clearTimeout(timer); done(); } });
  });
  return { socket, auth, state: () => state };
}
test('standalone desktop realm needs no Node, stops with editor, and restores character progress', { timeout: 20000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'titan-native-'));
  const manifest = JSON.parse(await readFile(join(runtime, 'titan-local/manifest.json'), 'utf8'));
  const configPath = join(dir, 'realm-config.json');
  await writeFile(configPath, JSON.stringify({ ...config, dataFile: join(dir, 'players.json') }));
  let realm, player;
  try {
    const run = () => start(join(runtime, 'titan-local', manifest.executable), ['--local', '--config', configPath], dir);
    realm = await run(); assert.equal(realm.gameId, config.gameId);
    const agent = new Agent({ keepAlive: true });
    try {
      const read = (method, path) => new Promise((done, reject) => {
        const req = request(`${realm.url}${path}`, { method, agent, headers: { Origin: config.origins, 'Access-Control-Request-Method': 'POST' } }, response => {
          const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('error', reject);
          response.on('end', () => done({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() }));
        }); req.on('error', reject); req.end();
      });
      for (let attempt = 0; attempt < 2; attempt++) {
        const preflight = await read('OPTIONS', '/auth');
        assert.equal(preflight.status, 204); assert.equal(preflight.headers['content-length'] ?? '0', '0'); assert.equal(preflight.body, '');
        assert.equal(JSON.parse((await read('GET', '/health')).body).gameId, config.gameId);
      }
    } finally { agent.destroy(); }
    const health = await (await fetch(`${realm.url}/health`, { headers: { Origin: 'https://editor.example.test' } })).json();
    assert.equal(health.gameId, config.gameId);
    assert.equal((await fetch(`${realm.url}/auth`, { method: 'POST', headers: { Origin: 'https://untrusted.example.test' }, body: '{}' })).status, 403);
    player = await joinRealm(realm.url);
    // Reach Elara through real movement commands and accept the quest.
    const walk = setInterval(() => player.socket.send(JSON.stringify({ type: 'move', x: 0, z: -1 })), 100);
    await new Promise(done => setTimeout(done, 900)); clearInterval(walk);
    player.socket.send(JSON.stringify({ type: 'move', x: 0, z: 0 }));
    player.socket.send(JSON.stringify({ type: 'interact' }));
    await new Promise(done => setTimeout(done, 100));
    assert.equal(player.state().players[0].quests['light-in-the-meadow'].state, 'active');
    const identity = player.state().selfId, resume = player.auth.resume;
    await realm.stop(); realm = undefined; player.socket.terminate();
    realm = await run(); player = await joinRealm(realm.url, resume);
    assert.equal(player.state().selfId, identity); assert.equal(player.state().players[0].quests['light-in-the-meadow'].state, 'active');
    await realm.stop(); realm = undefined;
  } finally { player?.socket.terminate(); realm?.child.kill(); await rm(dir, { recursive: true, force: true }); }
});
test('production server folder runs directly with generated config and no npm installation', { timeout: 15000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'titan-deploy-')); let realm;
  try {
    writeTitanServer(runtime, dir, { realmServer: config });
    const folder = join(dir, 'realm-server');
    assert.deepEqual(JSON.parse(await readFile(join(folder, 'realm-config.json'), 'utf8')), config);
    realm = await start(process.execPath, ['realm.cjs'], folder);
    const player = await joinRealm(realm.url); assert.equal(player.state().players[0].name, 'Aster'); player.socket.terminate();
    const ended = once(realm.child, 'exit'); realm.child.kill('SIGTERM'); const [code] = await ended; assert.equal(code, 0); realm = undefined;
  } finally { realm?.child.kill(); await rm(dir, { recursive: true, force: true }); }
});

test('standalone realm shuts down after Titan authentication and cloud fetches', { timeout: 15000 }, async () => {
  const paths = [];
  const backend = createServer((req, res) => {
    req.resume(); paths.push(req.url);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.url.endsWith('/anonymous') ? { token: 'native-test-player', player: { display_name: 'Native Titan' } } : { success: true }));
  });
  await new Promise(done => backend.listen(0, '127.0.0.1', done));
  const dir = await mkdtemp(join(tmpdir(), 'titan-native-cloud-'));
  const manifest = JSON.parse(await readFile(join(runtime, 'titan-local/manifest.json'), 'utf8'));
  const configPath = join(dir, 'realm-config.json');
  await writeFile(configPath, JSON.stringify({ ...config, titanUrl: `http://127.0.0.1:${backend.address().port}`, gameKey: 'native-test-game', dataFile: join(dir, 'players.json') }));
  let realm, player, timeout;
  try {
    realm = await start(join(runtime, 'titan-local', manifest.executable), ['--local', '--config', configPath], dir);
    player = await joinRealm(realm.url);
    const saved = new Promise((done, reject) => {
      timeout = setTimeout(() => reject(new Error('Cloud save timed out')), 5000);
      player.socket.on('message', bytes => { const message = JSON.parse(bytes); if (message.type === 'notice' && message.message.includes('Titan cloud')) done(); });
    });
    player.socket.send(JSON.stringify({ type: 'save' })); await saved; clearTimeout(timeout);
    player.socket.terminate();
    await Promise.race([realm.stop(), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Native shutdown hung after Titan fetches')), 5000); })]);
    clearTimeout(timeout); realm = undefined;
    assert.deepEqual(paths, ['/functions/v1/game-auth/anonymous', '/functions/v1/game-saves/ember-meadow']);
  } finally {
    clearTimeout(timeout); player?.socket.terminate(); realm?.child.kill('SIGKILL');
    backend.closeAllConnections(); await new Promise(done => backend.close(done)); await rm(dir, { recursive: true, force: true });
  }
});
