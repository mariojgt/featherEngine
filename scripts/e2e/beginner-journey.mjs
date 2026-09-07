/** Complete offline starter → edit → save/reopen → export journey. Uses the real editor and player. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { openEditor } from './harness.mjs';
import { delay, launch } from './cdp.mjs';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:17420';
const out = resolve(process.env.BEGINNER_E2E_DIR ?? 'exports/beginner-acceptance');
await mkdir(out, { recursive: true });
const shot = async (page, name) => { const result = await page.call('Page.captureScreenshot', { format: 'png' }); await writeFile(resolve(out, `${name}.png`), Buffer.from(result.data, 'base64')); };
if (!process.argv.includes('--player-only')) {
const app = await openEditor({ baseUrl, readySelector: '.launcher', width: 1440, height: 987 });
let bundle, cleanBundle;
const downloadDir = await mkdtemp(resolve(out, 'downloads-')); 
try {
  await app.page.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await app.page.call('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir });
  await app.page.call('Network.enable');
  await app.page.call('Network.setBlockedURLs', { urls: ['*/store/catalog.json'] });
  await app.page.call('Page.reload', { ignoreCache: true });
  await app.waitFor(`document.querySelector('[data-quick-start="platformer"]')`);
  await shot(app.page, 'launcher-1280');
  await app.evaluate(`document.querySelector('[data-quick-start="platformer"]').scrollIntoView({ block: 'center' })`);
  await app.realClick('[data-quick-start="platformer"]');
  await app.waitFor(`window.__featherStore?.scenes.some((scene) => scene.name === 'Cloudstep Garden') && document.querySelector('.first-game-guide')`);
  await app.waitFor(`window.__featherStore.modelSpecs.filter((spec) => spec.name.startsWith('Workshop')).length >= 3`);
  console.log('Starter created offline');
  const bounds = await app.evaluate(`(() => { const r = document.querySelector('.nf-dockview-host').getBoundingClientRect(); return { width: r.width, height: r.height, bottom: r.bottom }; })()`);
  assert.ok(bounds.height > 450 && bounds.bottom <= 720, `Usable workspace: ${JSON.stringify(bounds)}`);
  assert.ok(await app.evaluate(`document.querySelector('.creator-toolbar-authoring').getBoundingClientRect().right <= document.querySelector('.creator-mode-switch').getBoundingClientRect().left`), 'History and mode controls do not overlap at 1280px');
  await app.evaluate(`(() => {
    const s = window.__featherStore;
    const object = s.scenes.flatMap((scene) => scene.objects).find((item) => item.renderer && item.name.includes('Sun Seed'));
    if (!object) throw new Error('No seed appearance to edit');
    s.selectObject(object.id);
  })()`);
  await app.waitFor(`document.querySelector('.creator-appearance-section')`);
  await app.evaluate(`(() => { const button = document.querySelector('.creator-color-swatches button'); if (!button) throw new Error('Color swatches missing'); button.click(); })()`);
  await app.waitFor(`document.querySelector('.first-game-toggle')?.textContent.includes('1/5')`);
  console.log('Appearance edited');
  // Import a real GLB made by the built-in modeler; inspect its metadata and retain the gameplay root.
  await app.evaluate(`(async () => {
    const s = window.__featherStore;
    const { modelSpecToGlbFile } = await import('/src/model/exportModelGlb.ts');
    const { inspectModel } = await import('/src/three/inspectModel.ts');
    const file = await modelSpecToGlbFile(s.modelSpecs.find((spec) => spec.name.includes('Gift Crate')));
    const inspection = await inspectModel(file);
    if (!inspection.stats.triangles) throw new Error('Baked model has no inspected geometry');
    s.addAssetItems([{ id: 'journey-model', name: file.name, size: file.size, type: 'model', url: URL.createObjectURL(file), createdAt: 0, modelInspection: inspection }]);
    const prop = s.createObjectWithProps('cube', { name: 'My Garden Prop', position: [3, 0.7, 3], physics: { enabled: true, bodyType: 'fixed' } });
    const result = s.replaceObjectAppearance(prop, 'journey-model');
    if (!result.ok) throw new Error(result.error);
    window.journeyProp = prop;
    s.selectObject(prop);
  })()`);
  console.log('GLB baked, inspected, and attached');
  await app.evaluate(`document.querySelector('.creator-interaction-builder summary').click()`);
  await app.evaluate(`(() => {
    const select = [...document.querySelectorAll('.creator-interaction-form label')].find((label) => label.querySelector('span')?.textContent === 'When').querySelector('select');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'start');
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await app.evaluate(`document.querySelector('.creator-interaction-add').click()`);
  await app.waitFor(`window.__featherStore.scenes.flatMap((scene) => scene.objects).find((o) => o.id === window.journeyProp)?.creatorInteractions?.length === 1`);
  await app.evaluate(`document.querySelector('.creator-rule-actions button').click()`);
  await app.waitFor(`document.querySelector('.creator-interaction-add')?.textContent === 'Save rule'`);
  await app.evaluate(`document.querySelector('.creator-interaction-add').click()`);
  await shot(app.page, 'editing-1280');
  // Save through the real browser download, then reopen those exact bytes (including the imported GLB).
  await app.evaluate('window.__featherProject.save()');
  let saved;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { saved = JSON.parse(await readFile(resolve(downloadDir, 'My Game.nforge'), 'utf8')); break; } catch { await delay(250); }
  }
  assert.ok(saved, 'Browser save produced a project file');
  assert.ok(saved.assets.find((asset) => asset.id === 'journey-model')?.data?.startsWith('data:model/gltf-binary;base64,'), 'Saved GLB bytes');
  await app.evaluate(`window.__featherStore.loadProject(${JSON.stringify(saved)})`);
  cleanBundle = await app.evaluate(`(async () => {
    const s = window.__featherStore;
    const prop = s.scenes.flatMap((scene) => scene.objects).find((o) => o.name === 'My Garden Prop');
    const rule = prop.creatorInteractions[0];
    if (!s.updateSimpleInteraction(prop.id, rule.id, rule).ok) throw new Error('Reopened rule is not editable');
    if (prop.renderer.enabled !== false) throw new Error('Original mesh was not kept hidden');
    const { buildGameBundle } = await import('/src/project/exportGame.ts');
    const project = s.exportProject(); project.name = 'Cloudstep Garden';
    return buildGameBundle(project);
  })()`);
  console.log('Downloaded project reopened with its GLB and editable rule');
  await app.page.call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await app.evaluate(`window.__featherProject.exportProduction()`);
  await app.waitFor(`document.querySelector('[aria-label="Build report"]')`, { label: 'Build report: ' + await app.evaluate('window.__featherProject.error') });
  await shot(app.page, 'export-platforms-1440');
  await app.realClick('.report-footer .prefs-primary-button');
  await app.waitFor(`document.querySelector('.report-body')?.textContent.includes('Project checks passed')`);
  await shot(app.page, 'export-checks-1440');
  await app.realClick('.report-footer .prefs-primary-button');
  await app.waitFor(`document.querySelector('[aria-label="Build package ready"]')`);
  console.log('Build package downloaded through the guided export dialog');
  await shot(app.page, 'build-next-steps');
  await app.realClick('.build-overlay-close');
  // These ordinary Blueprint/UI probes are in the acceptance fixture only, separate from the clean game.
  bundle = await app.evaluate(`(async () => {
    const s = window.__featherStore;
    const player = s.scenes.flatMap((scene) => scene.objects).find((o) => o.creatorRoleId === 'player');
    s.updateRenderSettings({ quality: 'Low', autoQuality: false, bloomEnabled: false, vignetteEnabled: false });
    const probe = s.createObjectWithProps('empty', { name: 'Acceptance readout' });
    const id = s.createVariable('JourneyPosition', 'vector3', false); s.updateVariable(id, { defaultValue: [0,0,0] });
    const { blueprintId } = s.createBlueprintNamed('Acceptance Readout');
    const result = s.applyBlueprintFeatherSource(blueprintId, ['blueprint Acceptance_Readout', '', 'on update(dt):', '    Game.JourneyPosition = position("' + player.id + '")', '', 'on key_pressed("KeyV"):', '    Game.LevelComplete = true'].join('\\n'));
    if (!result.ok) throw new Error(JSON.stringify(result));
    s.attachScript(probe, blueprintId);
    const hud = window.__featherStore.uiDocuments[0];
    const text = s.addUIElement(hud.id, hud.root.id, 'text');
    s.updateUIElement(hud.id, text, { name: 'Acceptance position', className: 'journey-player-position', style: { opacity: 0, pointerEvents: 'none' } });
    s.setUIBinding(hud.id, text, 'text', 'JourneyPosition');
    const { embedAssets, buildGameBundle } = await import('/src/project/exportGame.ts');
    const project = window.__featherStore.exportProject(); project.name = 'Cloudstep Acceptance'; project.assets = await embedAssets(window.__featherStore.assets);
    return buildGameBundle(project);
  })()`);
} catch (error) { console.error('Editor journey failed:', error); await shot(app.page, 'editor-failure').catch(() => {}); throw error; }
finally { await app.dispose(); }

for (const [name, payload] of [['cloudstep-garden', cleanBundle], ['cloudstep-acceptance', bundle]]) {
  const path = resolve(out, `${name}.json`); await writeFile(path, JSON.stringify(payload));
  execFileSync(process.execPath, ['scripts/export-production.mjs', '--bundle', path, '--out', out, '--name', name, '--targets', 'web', '--skip-build'], { stdio: 'inherit' });
}
}
const gameDir = resolve(out, 'cloudstep-acceptance-web');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (path.startsWith('/games/cloudstep/')) path = path.slice('/games/cloudstep'.length);
    const file = resolve(gameDir, '.' + (path.endsWith('/') ? path + 'index.html' : path));
    if (!file.startsWith(gameDir + sep)) { res.writeHead(403).end(); return; }
    const bytes = await readFile(file); res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream'); res.end(bytes);
  } catch { res.writeHead(404).end(); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const browser = await launch({ width: 1280, height: 807 });
const evaluate = async (expression) => { const result = await browser.page.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description); return result.result.value; };
const until = async (expression, label, timeout = 120_000) => { const deadline = Date.now() + timeout; while (Date.now() < deadline) { if (await evaluate(expression).catch((error) => { if (error.message.includes('SyntaxError')) throw error; return false; })) return; await delay(250); } throw new Error(`Timed out: ${label}`); };
const press = async (code, key, type = 'keyDown') => browser.page.call('Input.dispatchKeyEvent', { type, code, key });
try {
  for (const [label, path] of [['root', '/'], ['subpath', '/games/cloudstep/']]) {
    await browser.page.call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}${path}` });
    await until(`document.querySelector('.cloudstep-game-menu')?.textContent.includes('Let’s play')`, 'Start menu');
    await shot(browser.page, `player-start-${label}`);
    await evaluate(`[...document.querySelectorAll('.cloudstep-menu-button')].find((b) => b.textContent === 'Let’s play').click()`);
    await until(`!document.querySelector('.cloudstep-game-menu') || document.querySelector('.cloudstep-game-menu').offsetHeight === 0`, 'Game started');
    await until(`document.querySelector('.journey-player-position')?.textContent.split(',').length === 3`, 'Position probe');
    const position = () => evaluate(`document.querySelector('.journey-player-position').textContent.split(',').map(Number)`);
    await until(`(() => { const p = document.querySelector('.journey-player-position')?.textContent.split(',').map(Number); return p?.length === 3 && p.every(Number.isFinite) && Math.abs(p[2]) > 1; })()`, 'Initial player position');
    const before = await position(); console.log('Player starts at', label, before);
    await press('KeyW', 'w');
    await until(`(() => { const p = document.querySelector('.journey-player-position').textContent.split(',').map(Number); return Math.hypot(p[0]-(${before[0]}),p[2]-(${before[2]})) > 1; })()`, 'Exported player movement');
    await press('KeyW', 'w', 'keyUp'); console.log('Player moved to', await position());
    await press('KeyP', 'p'); await press('KeyP', 'p', 'keyUp');
    await until(`document.querySelector('.cloudstep-game-menu')?.textContent.includes('Take a breather')`, 'Pause menu');
    const paused = await position(); await delay(600); assert.deepEqual(await position(), paused, 'Paused physics stays still');
    await shot(browser.page, `player-pause-${label}`);
    await evaluate(`[...document.querySelectorAll('.cloudstep-menu-button')].find((b) => b.textContent === 'Restart course').click()`);
    await until(`!document.querySelector('.cloudstep-game-menu') || document.querySelector('.cloudstep-game-menu').offsetHeight === 0`, 'Restart');
    await until(`document.querySelector('.seed-pill')?.textContent.includes('0 / 10')`, 'Restart resets score');
    await press('KeyV', 'v'); await press('KeyV', 'v', 'keyUp');
    await until(`document.querySelector('.clear-card')?.offsetHeight > 0`, 'Win screen');
    await shot(browser.page, `player-win-${label}`);
    await evaluate(`[...document.querySelectorAll('.cloudstep-menu-button')].find((b) => b.textContent === 'Play again').click()`);
    await until(`!document.querySelector('.clear-card') || document.querySelector('.clear-card').offsetHeight === 0`, 'Play again');
    assert.equal(await evaluate(`document.body.innerText.includes('Failed to start the game') || document.body.innerText.includes('The game hit an error')`), false);
  }
  console.log(`✓ Beginner journey passed: offline starter, appearance, editable rules, GLB, save/reopen, guided build, root/subpath player, movement, pause, restart, win UI. Artifacts: ${out}`);
} catch (error) { console.error('Player journey failed:', error, await evaluate(`({ position: document.querySelector('.journey-player-position')?.textContent, body: document.body.innerText.slice(-300) })`).catch(() => null)); await shot(browser.page, 'player-failure').catch(() => {}); throw error; }
finally { await browser.dispose(); await new Promise((done) => server.close(done)); }
