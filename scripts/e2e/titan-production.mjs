/** Verify an actual exported online player uses saved settings, with a controlled auth response. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { openEditor } from './harness.mjs';
const directory = resolve(process.argv[2] ?? 'artifacts/titan/online-export/ember-meadow-web');
const source = await readFile(resolve(directory, 'game-bundle.js'), 'utf8');
const bundle = JSON.parse(source.slice(source.indexOf('{')).replace(/;\s*$/, ''));
const realm = bundle.project.variables.find(v => v.name === 'TitanRealmURL').defaultValue;
assert.equal(bundle.project.variables.find(v => v.name === 'TitanPublishMode').defaultValue, 'online');
assert.deepEqual(JSON.parse(await readFile(resolve(directory, 'realm-server/realm-config.json'), 'utf8')), bundle.realmServer);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = createServer(async (request, response) => {
  try {
    const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = resolve(directory, `.${name.endsWith('/') ? `${name}index.html` : name}`);
    if (!file.startsWith(directory + sep)) { response.writeHead(403).end(); return; }
    response.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream'); response.end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let app;
try {
  app = await openEditor({ baseUrl: `http://127.0.0.1:${server.address().port}`, readySelector: '.titan-login-card', width: 1440, height: 960, timeoutMs: 90000 });
  assert.equal(await app.count('.titan-developer-setup'), 0);
  assert.equal(await app.count('.titan-login-card input[type="url"]'), 0);
  assert.equal(await app.count('.titan-primary'), 0, 'Online releases do not silently offer separate solo saves');
  assert.match(await app.text('.titan-login-card select'), /Sign in.*Create an account/);
  await app.evaluate(`(() => { const select=document.querySelector('.titan-login-card select'); select.value='login'; select.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await app.waitFor(`document.querySelector('.titan-login-card input[type="email"]')`);
  await app.evaluate(`(() => { const set=(selector,value)=>{const input=document.querySelector(selector);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));};set('input[type="email"]','hero@example.test');set('input[type="password"]','example-test-password'); })()`);
  let authRequest;
  app.page.socket.on('message', async raw => {
    const message = JSON.parse(raw);
    if (message.method !== 'Fetch.requestPaused') return;
    const preflight = message.params.request.method === 'OPTIONS';
    if (!preflight) authRequest = message.params.request;
    await app.page.call('Fetch.fulfillRequest', { requestId: message.params.requestId, responseCode: preflight ? 204 : 400,
      responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Methods', value: 'POST' }, { name: 'Access-Control-Allow-Headers', value: 'content-type' }],
      body: preflight ? '' : Buffer.from(JSON.stringify({ message: 'Controlled realm reached.' })).toString('base64') });
  });
  await app.page.call('Fetch.enable', { patterns: [{ urlPattern: `${realm}/auth`, requestStage: 'Request' }] });
  await writeFile('artifacts/titan/production-login.png', Buffer.from((await app.page.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await app.realClick('.titan-secondary');
  await app.waitFor(`document.querySelector('.titan-error')?.textContent.includes('Controlled realm reached.')`);
  assert.equal(authRequest.url, `${realm}/auth`);
  assert.equal(JSON.parse(authRequest.postData).mode, 'login');
  assert.equal(await app.evaluate(`document.querySelector('input[type="password"]').value`), '');
  console.log('PASS: exported online package includes its configured server; player login uses the saved address without key/setup fields. Auth response controlled by test.');
} finally { await app?.dispose(); await new Promise(done => server.close(done)); }
