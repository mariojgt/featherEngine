/** Verify the clean production game from a root URL and from a nested hosting path. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { openEditor } from './harness.mjs';
import { delay } from './cdp.mjs';

const out = resolve(process.env.CUBE_RPG_E2E_DIR ?? 'exports/cube-rpg-acceptance');
await mkdir(out, { recursive: true });
const bundle = resolve(out, 'cube-rpg.json');
execFileSync(process.execPath, ['scripts/export-production.mjs', '--bundle', bundle, '--out', out, '--name', 'cube-rpg', '--targets', 'web', '--skip-build'], { stdio: 'inherit' });
const gameDir = resolve(out, 'cube-rpg-web');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (path.startsWith('/games/cube-rpg/')) path = path.slice('/games/cube-rpg'.length);
    const file = resolve(gameDir, '.' + (path.endsWith('/') ? path + 'index.html' : path));
    if (!file.startsWith(gameDir + sep)) { res.writeHead(403).end(); return; }
    const bytes = await readFile(file);
    res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream'); res.end(bytes);
  } catch { res.writeHead(404).end(); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
try {
  for (const [label, query] of [['root', ''], ['subpath', 'games/cube-rpg/']]) {
    const app = await openEditor({ baseUrl, query, readySelector: '.rpg-menu', width: 1280, height: 800, timeoutMs: 120_000 });
    const errors = [];
    const listener = (raw) => {
      const e = JSON.parse(raw.toString());
      if (e.method === 'Runtime.exceptionThrown') errors.push(e.params.exceptionDetails.text);
    };
    app.page.socket.on('message', listener);
    const shot = async (name) => {
      const result = await app.page.call('Page.captureScreenshot', { format: 'png' });
      await writeFile(resolve(out, `player-${name}-${label}.png`), Buffer.from(result.data, 'base64'));
    };
    const clickText = (text) => app.evaluate(`(() => { const b = [...document.querySelectorAll('.rpg-button')].find(b => b.textContent === ${JSON.stringify(text)} && b.offsetHeight > 0); if (!b) throw new Error('Missing button'); b.click(); })()`);
    const key = async (code, value) => {
      await app.page.call('Input.dispatchKeyEvent', { type: 'keyDown', code, key: value });
      await delay(80);
      await app.page.call('Input.dispatchKeyEvent', { type: 'keyUp', code, key: value });
    };
    try {
      await app.waitFor(`document.body.innerText.includes('Begin adventure')`);
      await clickText('Begin adventure →');
      await app.waitFor(`document.querySelector('.rpg-actions')?.offsetHeight > 0`);
      await key('Digit1', '1');
      await app.waitFor(`document.body.innerText.includes('Equip sword · 1')`, { label: 'Exported equipment Blueprint' });
      await key('Digit1', '1');
      await app.waitFor(`document.body.innerText.includes('⚔ Sword · 1')`);
      await key('KeyP', 'p');
      await app.waitFor(`document.body.innerText.includes('Take a breather.')`, { label: 'Exported pause' });
      await shot('pause');
      await clickText('Restart from arena 1');
      await app.waitFor(`!document.body.innerText.includes('Take a breather.') && document.body.innerText.includes('♥ 100 / 100') && document.body.innerText.includes('3 potions')`);
      await key('KeyP', 'p');
      await app.waitFor(`document.body.innerText.includes('Take a breather.')`);
      await clickText('Resume adventure →');
      await app.waitFor(`document.querySelector('.rpg-actions')?.offsetHeight > 0`);
      if (label === 'root') {
        await app.page.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
        await app.page.call('Emulation.setTouchEmulationEnabled', { enabled: true });
        await delay(400);
        const layout = await app.evaluate(`(() => {
          const buttons = [...document.querySelectorAll('.rpg-ability')].filter(b => b.offsetHeight > 0);
          return { count: buttons.length, fits: buttons.every(b => { const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; }),
            overflow: document.documentElement.scrollWidth > innerWidth };
        })()`);
        assert.deepEqual(layout, { count: 5, fits: true, overflow: false }, 'Phone ability controls fit the screen');
        await app.realClick('.rpg-ability:nth-child(4)');
        await app.waitFor(`document.body.innerText.includes('◈ Blocking')`, { label: 'Phone block ability' });
        await shot('phone');
        await app.page.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
        await app.page.call('Emulation.setTouchEmulationEnabled', { enabled: false });
        await delay(400);
      }
      // Hide HUD panels so the image check measures the world itself.
      await app.evaluate(`document.querySelectorAll('.rpg-top,.rpg-actions,.rpg-hints,.rpg-button').forEach(el => el.style.visibility = 'hidden')`);
      const deadline = Date.now() + 120_000;
      let pixels;
      do { pixels = await app.pixelStats('canvas'); if (pixels.meanLuminance > 35) break; await delay(500); } while (Date.now() < deadline);
      assert.ok(pixels.meanLuminance > 35, `Exported 3D world renders: ${JSON.stringify(pixels)}`);
      await shot('world');
      assert.equal(await app.evaluate(`document.body.innerText.includes('Failed to start the game') || document.body.innerText.includes('The game hit an error')`), false);
      assert.deepEqual(errors, [], 'No uncaught runtime errors');
      console.log(`✓ Cube RPG production player passed at ${label}: start, equipment, pause, restart, resume, rendered world${label === 'root' ? ' and phone controls' : ''}`);
    } finally { app.page.socket.off('message', listener); await app.dispose(); }
  }
} finally { await new Promise((done) => server.close(done)); }
