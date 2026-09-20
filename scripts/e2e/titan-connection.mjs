/** Exercise Test & save with native browser fetch and a local HTTP backend. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createVite } from 'vite';
import react from '@vitejs/plugin-react';
import { openEditor } from './harness.mjs';

const requests = [];
const backend = createServer((request, response) => {
  response.setHeader('Access-Control-Allow-Origin', request.headers.origin ?? '*');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Game-Key');
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (request.method === 'OPTIONS') { response.writeHead(204).end(); return; }
  requests.push({ path: request.url, key: request.headers['x-game-key'], origin: request.headers.origin });
  response.setHeader('Content-Type', 'application/json');
  // Match the real backend: ping is public, configuration validates the key.
  const ping = request.url === '/functions/v1/game-server/ping';
  const valid = ping || request.headers['x-game-key'] === 'example-browser-game-key';
  response.writeHead(valid ? 200 : 401).end(JSON.stringify(valid ? (ping ? { status: 'ok' } : { configs: [] }) : { message: 'Invalid test game key', error: 'invalid_key' }));
});
await new Promise(done => backend.listen(0, '127.0.0.1', done));
const cacheDir = await mkdtemp(join(tmpdir(), 'feather-titan-connection-'));
let vite, app;
try {
  vite = await createVite({ configFile: false, plugins: [react()], cacheDir, appType: 'custom', logLevel: 'error',
    optimizeDeps: { entries: [], include: ['react', 'react-dom/client', 'lucide-react', 'zod'] },
    server: { host: '127.0.0.1', port: 0, hmr: false } });
  const html = `<!doctype html><html><body style="margin:0;background:#132c2a"><div id="root"></div><script type="module">
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { TitanPanel } from '/src/extensions/titan/index.tsx';
    import { defaultTitanSettings } from '/src/titan/settings.ts';
    let settings = {...defaultTitanSettings, baseUrl:'http://127.0.0.1:${backend.address().port}'};
    window.titanSaved = [];
    const api = {project:{read:()=>({activeSceneId:'test'})}, events:{on:()=>()=>{}}, titan:{settings:()=>settings,realmStatus:async()=>({running:false}),configure:value=>{settings=value;window.titanSaved.push(value);}}};
    createRoot(document.getElementById('root')).render(React.createElement(TitanPanel,{api}));
  </script></body></html>`;
  vite.middlewares.use(async (request, response, next) => {
    if (request.url !== '/') return next();
    response.setHeader('Content-Type', 'text/html'); response.end(await vite.transformIndexHtml('/', html));
  });
  await vite.listen();
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  app = await openEditor({ baseUrl: origin, readySelector: '.titan-connection-fields', width: 1024, height: 1200 });
  const fillKey = value => app.evaluate(`(() => { const input=document.querySelector('.titan-key-field input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await fillKey('example-browser-game-key');
  await app.realClick('.titan-wizard-primary');
  await app.waitFor(`document.querySelector('.titan-wizard-notice').textContent.includes('Titan connected.')`, { label: 'Test & save with native browser fetch' });
  assert.deepEqual(requests, [{ path: '/functions/v1/game-config', key: 'example-browser-game-key', origin }]);
  assert.equal(await app.evaluate('window.titanSaved.length'), 1);
  assert.equal(await app.evaluate('window.titanSaved[0].gameKey'), 'example-browser-game-key');
  assert.match(await app.text('.titan-setup-steps [aria-current="step"]'), /Test/);
  await app.realClick('.titan-setup-steps button:first-child');
  await fillKey('invalid-example-key');
  await app.realClick('.titan-wizard-primary');
  await app.waitFor(`document.querySelector('.titan-wizard-notice.error')?.textContent.includes('Invalid test game key')`);
  assert.equal(await app.evaluate('window.titanSaved.length'), 1, 'A failed connection must not replace saved settings');
  console.log('PASS: native browser fetch reaches authenticated Titan config; Test & save stores a valid connection, advances the wizard and preserves saved settings after a rejected key.');
} finally {
  await app?.dispose(); await vite?.close();
  await new Promise(done => backend.close(done)); await rm(cacheDir, { recursive: true, force: true });
}
