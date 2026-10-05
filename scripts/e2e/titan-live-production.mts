/** Real exported player + packaged server + live Titan, served through a local HTTPS proxy.
 * Run after npm run build and npm run build:titan-runtime:
 * TITAN_E2E_CREDENTIALS=/private/credentials.json npx vite-node scripts/e2e/titan-live-production.mts
 * Nothing is deployed. Private exported settings and temporary TLS files are deleted afterward.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, extname, sep } from 'node:path';
import { createServer } from 'node:https';
import { request as proxyRequest } from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import WebSocket, { WebSocketServer } from 'ws';
import { readPackageFile } from '../../src/project/packageArchive';
import { blankProject } from '../../src/project/serialize';
import { buildGameBundle } from '../../src/project/exportGame';
import { verifyGameBundle } from '../../src/project/verifyBundle';
import { TITAN_SETTINGS } from '../../src/titan/settings';
import { openEditor } from './harness.mjs';

const credentialsPath = process.env.TITAN_E2E_CREDENTIALS;
assert.ok(credentialsPath, 'Set TITAN_E2E_CREDENTIALS to a private JSON file.');
const credentials = JSON.parse(await readFile(credentialsPath, 'utf8'));
const sessionsPath = `${credentialsPath}.sessions`;
let sessions = {}; try { sessions = JSON.parse(await readFile(sessionsPath, 'utf8')); } catch {}
const work = await mkdtemp(join(tmpdir(), 'feather-titan-production-'));
let app, realm, web, realmUrl = '', directory = '';
const sockets = new Set(); const upstreams = new Set();
try {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(work, 'key.pem'), '-out', join(work, 'cert.pem'), '-days', '1', '-subj', '/CN=*.example.test'], { stdio: 'ignore' });
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml' };
  web = createServer({ key: await readFile(join(work, 'key.pem')), cert: await readFile(join(work, 'cert.pem')) }, async (request, response) => {
    if (['/auth', '/health'].includes(request.url)) {
      const upstream = proxyRequest(new URL(request.url, realmUrl), { method: request.method, headers: request.headers }, remote => {
        response.writeHead(remote.statusCode, remote.headers); remote.pipe(response);
      });
      upstream.on('error', error => { console.error('HTTPS proxy upstream error:', error.code, error.message); if (!response.headersSent) response.writeHead(502).end(); else response.destroy(); }); request.pipe(upstream); return;
    }
    try {
      const name = decodeURIComponent(new URL(request.url, 'https://play.example.test').pathname);
      const file = resolve(directory, `.${name.endsWith('/') ? `${name}index.html` : name}`);
      if (!file.startsWith(directory + sep)) { response.writeHead(403).end(); return; }
      response.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream'); response.end(await readFile(file));
    } catch { response.writeHead(404).end(); }
  });
  web.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  const wss = new WebSocketServer({ noServer: true });
  web.on('upgrade', (request, socket, head) => {
    if (request.url !== '/realm') { socket.destroy(); return; }
    wss.handleUpgrade(request, socket, head, client => {
      const upstream = new WebSocket(`${realmUrl.replace('http:', 'ws:')}/realm`, { headers: { Origin: request.headers.origin } });
      upstreams.add(upstream); const pending = [];
      client.on('message', bytes => { if (upstream.readyState === WebSocket.OPEN) upstream.send(bytes, { binary: false }); else pending.push(bytes); });
      upstream.on('open', () => { for (const bytes of pending) upstream.send(bytes, { binary: false }); });
      upstream.on('message', bytes => { if (client.readyState === WebSocket.OPEN) client.send(bytes, { binary: false }); });
      upstream.on('close', () => { upstreams.delete(upstream); client.close(); }); upstream.on('error', () => client.close()); client.on('error', () => upstream.close()); client.on('close', () => upstream.close());
    });
  });
  await new Promise(done => web.listen(0, '127.0.0.1', done));
  const port = web.address().port;
  const gameOrigin = `https://play.example.test:${port}`, publicRealm = `https://realm.example.test:${port}`;
  const archive = readPackageFile(new Uint8Array(await readFile('.feather-cache/store/packages/projects/ember-meadow.nfpack')));
  const project = { ...blankProject('Ember Meadow Live Test'), ...archive.pkg.content,
    activeSceneId: archive.pkg.content.scenes[0].id, scenes: archive.pkg.content.scenes,
    assets: archive.pkg.assets.map(asset => ({ ...asset, source: undefined, data: `data:model/gltf-binary;base64,${Buffer.from(archive.bytes.get(asset.id)).toString('base64')}` })),
  };
  const settings = { baseUrl: credentials.baseUrl, gameKey: credentials.gameKey, realmUrl: publicRealm, gameOrigin, publishMode: 'online' };
  project.variables = Object.entries(settings).map(([key, value]) => ({ id: key, name: TITAN_SETTINGS[key], type: 'string', defaultValue: value, persistent: false, createdAt: 1 }));
  project.exportSettings.profiles.forEach(profile => { profile.startSceneId = project.activeSceneId; profile.includeDebugOverlay = false; });
  const bundle = buildGameBundle(project);
  const verification = await verifyGameBundle(bundle); assert.ok(verification.ok, verification.errors.join('\n'));
  const bundlePath = join(work, 'game.json'); await writeFile(bundlePath, JSON.stringify(bundle), { mode: 0o600 });
  execFileSync(process.execPath, ['scripts/export-production.mjs', '--bundle', bundlePath, '--targets', 'web', '--out', join(work, 'export'), '--skip-build'], { stdio: 'pipe', timeout: 180000 });
  const outputName = (await readdir(join(work, 'export'))).find(name => name.endsWith('-web'));
  assert.ok(outputName, 'The production export creates a web game'); directory = join(work, 'export', outputName);
  const configFile = join(directory, 'realm-server', 'realm-config.json');
  const config = JSON.parse(await readFile(configFile, 'utf8'));
  assert.ok(config.gameKey === credentials.gameKey && config.titanUrl === credentials.baseUrl, 'Exported server remembers the supplied connection');
  assert.ok(config.origins.split(',').includes(gameOrigin));
  const nativeManifest = JSON.parse(await readFile('src-tauri/export-runtime/titan-local/manifest.json', 'utf8'));
  const nativeExecutable = resolve('src-tauri/export-runtime/titan-local', nativeManifest.executable);
  const start = (native = false) => new Promise((done, reject) => {
    const executable = native ? nativeExecutable : process.execPath;
    const args = native ? ['--local', '--config', configFile] : [join(directory, 'realm-server', 'realm.cjs'), '--config', configFile];
    const child = spawn(executable, args, { env: { ...process.env, ...(native ? { PATH: '' } : {}), HOST: '127.0.0.1', PORT: '0', REALM_DATA: join(work, 'players.json') }, stdio: ['pipe', 'pipe', 'pipe'] });
    realm = child; let output = ''; const timer = setTimeout(() => reject(new Error('Packaged realm startup timed out')), 15000);
    child.stderr.resume(); child.once('error', reject); child.once('exit', code => { clearTimeout(timer); if (!realmUrl) reject(new Error(`Packaged realm exited (${code})`)); });
    child.stdout.on('data', bytes => { output += bytes; const line = output.split('\n').find(line => line.startsWith('{')); if (!line) return; try { const ready = JSON.parse(line); if (ready.type === 'ready') { clearTimeout(timer); realmUrl = ready.url; done(); } } catch {} });
  });
  const stop = () => new Promise(done => { realm.once('exit', done); realm.kill('SIGTERM'); });
  await start();
  app = await openEditor({ baseUrl: gameOrigin, readySelector: '.titan-login-card', width: 1440, height: 960, timeoutMs: 90000,
    browserOptions: { hostResolverRules: 'MAP *.example.test 127.0.0.1', ignoreCertificateErrors: true } });
  assert.equal(await app.count('.titan-developer-setup, .titan-login-card input[type="url"], .titan-key-field'), 0);
  assert.equal(await app.count('.titan-primary'), 0);
  assert.match(await app.text('.titan-login-card select'), /Sign in.*Create an account/);
  const key = `feather.titan.realm.${publicRealm}`;
  if (sessions.peer) await app.evaluate(`localStorage.setItem(${JSON.stringify(key)},${JSON.stringify(sessions.peer)})`);
  await app.realClick('.titan-secondary');
  await app.waitFor(`document.querySelector('.titan-location')?.textContent.includes('Realm online')`, { label: 'exported game authenticates with live Titan over its configured HTTPS realm' });
  sessions.peer = await app.evaluate(`localStorage.getItem(${JSON.stringify(key)})`); await writeFile(sessionsPath, JSON.stringify(sessions), { mode: 0o600 });
  await app.realClick('.titan-actions button:nth-child(6)');
  await app.waitFor(`document.querySelector('.titan-notice').textContent.includes('Titan cloud')`);
  const cloud = await fetch(`${credentials.baseUrl.replace(/\/+$/, '').replace(/\/functions\/v1$/, '')}/functions/v1/game-saves/ember-meadow`, { headers: { 'X-Game-Key': credentials.gameKey, 'X-Player-Token': sessions.peer, Authorization: `Bearer ${sessions.peer}` } });
  assert.equal(cloud.status, 200); const body = await cloud.json(); const saved = typeof body.data === 'string' ? JSON.parse(body.data) : body.data;
  assert.equal(saved.equipped.weapon, 'training-blade'); assert.equal(saved.quests['light-in-the-meadow'], undefined);
  await app.realClick('.titan-menu'); await stop(); realmUrl = ''; await start();
  await app.realClick('.titan-secondary'); await app.waitFor(`document.querySelector('.titan-location')?.textContent.includes('Realm online')`);
  console.log('PASS: production guest login, HTTPS/WSS, live cloud save/readback and packaged-server restart');
  await app.realClick('.titan-menu');
  if (!sessions.account) {
    sessions.account = { email: `feather-e2e-${randomBytes(6).toString('hex')}@example.invalid`, password: randomBytes(24).toString('base64url'), registered: false };
    await writeFile(sessionsPath, JSON.stringify(sessions), { mode: 0o600 });
  }
  const fill = (selector, value) => app.evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const mode = value => app.evaluate(`(()=>{const select=document.querySelector('.titan-login-card select');select.value=${JSON.stringify(value)};select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await mode(sessions.account.registered ? 'login' : 'register');
  await fill('input[autocomplete="nickname"]', 'Feather E2E Account');
  await fill('input[type="email"]', sessions.account.email); await fill('input[type="password"]', sessions.account.password);
  await app.realClick('.titan-secondary'); await app.waitFor(`document.querySelector('.titan-location')?.textContent.includes('Realm online')`, { label: 'live email account registration/login' });
  sessions.account.registered = true; await writeFile(sessionsPath, JSON.stringify(sessions), { mode: 0o600 });
  assert.match(await app.text('.titan-player'), /Feather E2E Account/);
  await app.realClick('.titan-menu'); await mode('login');
  assert.equal(await app.evaluate(`document.querySelector('input[type="password"]').value`), '');
  await fill('input[type="password"]', 'invalid-test-password'); await app.realClick('.titan-secondary');
  await app.waitFor(`document.querySelector('.titan-error')?.textContent.includes('Invalid credentials')`, { label: 'live login rejects wrong password' });
  await fill('input[type="password"]', sessions.account.password); await app.realClick('.titan-secondary');
  await app.waitFor(`document.querySelector('.titan-location')?.textContent.includes('Realm online')`, { label: 'live email sign-in after leaving' });
  assert.match(await app.text('.titan-player'), /Feather E2E Account/);
  console.log('PASS: production account creation, wrong-password rejection and email sign-in with real Titan. Players see no key/setup fields. HTTPS hosting was simulated locally; nothing was deployed.');
  await app.realClick('.titan-menu'); await stop(); realmUrl = ''; await start(true);
  await fill('input[type="password"]', sessions.account.password); await app.realClick('.titan-secondary');
  await app.waitFor(`document.querySelector('.titan-location')?.textContent.includes('Realm online')`, { label: 'standalone desktop executable authenticates against live Titan' });
  await app.realClick('.titan-actions button:nth-child(6)'); await app.waitFor(`document.querySelector('.titan-notice').textContent.includes('Titan cloud')`);
  console.log('PASS: bundled desktop realm authenticates and saves to live Titan with an empty PATH, without Node or npm.');
  await app.realClick('.titan-menu');
  const shutdown = setTimeout(() => { console.error('Native shutdown timed out'); realm.kill('SIGKILL'); }, 5000);
  await stop(); clearTimeout(shutdown); assert.equal(realm.exitCode, 0, 'Native realm exits cleanly after live Titan requests');
  console.log('PASS: standalone realm shuts down cleanly after live Titan requests.');
  await writeFile('artifacts/titan/live-production-report.json', JSON.stringify({ passed: true, liveTitan: true, packagedServer: true, localHttpsProxy: true, emailRegistration: true, wrongPasswordRejected: true, emailLogin: true, nativeRuntimeWithoutNode: true, nativeShutdown: true, deployed: false, checkedAt: new Date().toISOString() }, null, 2));
} finally {
  await app?.dispose(); for (const upstream of upstreams) upstream.terminate(); for (const socket of sockets) socket.destroy();
  if (web) await new Promise(done => web.close(done));
  if (realm && realm.exitCode === null) await new Promise(done => { realm.once('exit', done); realm.kill('SIGTERM'); });
  await rm(work, { recursive: true, force: true });
}
