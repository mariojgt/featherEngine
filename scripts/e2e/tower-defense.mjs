/** Sproutwatch real-input smoke: explicit starter builder, Asset Store install, combat and standalone/mobile HUD. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { openEditor } from './harness.mjs';
import { delay, launch } from './cdp.mjs';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:17420';
const shotDir = process.env.SPROUTWATCH_SHOT_DIR;
const saveShot = async (page, name) => {
  if (!shotDir) return;
  await mkdir(shotDir, { recursive: true });
  const shot = await page.call('Page.captureScreenshot', { format: 'png' });
  await writeFile(`${shotDir}/${name}.png`, Buffer.from(shot.data, 'base64'));
};

const app = await openEditor({ baseUrl, readySelector: '.launcher', width: 1440, height: 1000 });
let bundle;
try {
  assert.equal(await app.count('[data-quick-start="tower-defense"]'), 0);
  await app.evaluate(`(async () => {
    const { useProjectStore } = await import('/src/store/projectStore.ts');
    const created = await useProjectStore.getState().newProjectFromStarter('Sproutwatch QA', 'tower-defense');
    if (!created) throw new Error('Could not open the preserved Sproutwatch starter builder');
  })()`);
  await app.waitFor('document.querySelector(".toolbar") && window.__featherStore?.scenes.some(s => s.name.includes("Sproutwatch"))', { label: 'starter project' });
  await app.evaluate(`(async () => {
    const panels = await import('/src/components/workspacePanels.ts');
    panels.openWorkspacePanel({id:'store',title:'Asset Store',placement:{referencePanel:'project',direction:'within'}});
    panels.toggleWorkspacePanelMaximized('store');
  })()`);
  await app.realClick('[aria-label="Search the asset store"]');
  await app.page.call('Input.insertText', { text: 'Sproutwatch' });
  await app.waitFor(`document.querySelectorAll('.store-card').length === 1 && document.querySelector('.store-card h3')?.textContent.includes('Sproutwatch')`, { label: 'searchable store listing' });
  await app.waitFor(`document.querySelector('.store-card img')?.naturalWidth > 0`, { label: 'store preview loaded' });
  await saveShot(app.page, '00-asset-store');
  await app.evaluate(`document.querySelector('.store-install-button').scrollIntoView({block:'center'})`);
  await app.realClick('.store-install-button');
  await app.waitFor('document.querySelector(".confirm-dialog__confirm")', { label: 'new project confirmation' });
  await app.realClick('.confirm-dialog__confirm');
  await app.waitFor(`window.__featherStore.activeScene()?.objects.some(o => o.variables?.gameTemplate === 'sproutwatch-v1' && o.variables.seed === 2718)`, { label: 'installed store garden' });
  await app.evaluate(`(async () => {
    const panels = await import('/src/components/workspacePanels.ts');
    if (panels.isWorkspacePanelMaximized('store')) panels.toggleWorkspacePanelMaximized('store');
  })()`);
  console.log('PASS: Asset Store search, preview and Use template install.');
  await app.evaluate(`document.querySelector('[data-creator-mode="play"]').scrollIntoView({block:'nearest'})`);
  await app.realClick('[data-creator-mode="play"]');
  await app.waitFor('document.querySelector(".sw-intro")', { label: 'title screen' });
  await delay(800);
  await saveShot(app.page, '01-title');
  console.log('Title rendered; starting play.');
  await app.realClick('.sw-intro .sw-primary');
  await app.waitFor('document.querySelectorAll(".sw-pad").length >= 10', { label: 'build pads' });
  await app.realClick('.sw-pad');
  await app.waitFor('document.querySelector("[data-testid=garden-coins]").textContent === "180"', { label: 'purchase charged' });
  await app.realClick('.sw-upgrade .sw-primary');
  await app.waitFor('document.querySelector("[data-testid=garden-coins]").textContent === "115"', { label: 'upgrade charged' });
  console.log('Purchased and upgraded; selling.');
  await app.realClick('.sw-sell');
  await app.waitFor('document.querySelector("[data-testid=garden-coins]").textContent === "216"', { label: 'sale refunded' });
  await app.realClick('.sw-pad');
  await app.waitFor('document.querySelector(".sw-dismiss")', { label: 'new tower panel' });
  await app.realClick('.sw-dismiss');
  console.log('Rebuilt defender; starting wave.');
  await app.realClick('.sw-send');
  await app.waitFor('document.querySelector(".sproutwatch-hud").dataset.phase === "wave"', { label: 'live wave' });
  await app.waitFor('Number(document.querySelector(".sproutwatch-hud").dataset.enemies) > 0', { label: 'spawned zombies' });
  await app.realClick('[aria-label="Pause game"]');
  await app.waitFor('document.querySelector(".sproutwatch-hud").dataset.paused === "true"', { label: 'paused' });
  const pausedAt = await app.evaluate('Number(document.querySelector(".sproutwatch-hud").dataset.elapsed)');
  await delay(250);
  assert.equal(await app.evaluate('Number(document.querySelector(".sproutwatch-hud").dataset.elapsed)'), pausedAt);
  await app.page.call('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await app.page.call('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await app.waitFor(`Number(document.querySelector(".sproutwatch-hud").dataset.elapsed) > ${pausedAt}`, { label: 'resumed simulation' });
  await app.realClick('[aria-label="Game speed 1x"]');
  await app.waitFor(`document.querySelector('[aria-label="Game speed 2x"]')`, { label: 'double speed' });
  await delay(1500);
  await saveShot(app.page, '02-combat');
  await app.realClick('[aria-label="Pause game"]');
  await app.realClick('.sw-secondary');
  await app.waitFor('document.querySelector("[data-testid=garden-coins]").textContent === "260"', { label: 'replay reset coins' });
  assert.equal(await app.text('[data-testid="garden-lives"]'), '20');
  assert.equal(await app.count('.sw-pad-built'), 0);
  await app.realClick('[aria-label="How to play"]');
  assert.match(await app.text('.sw-modal'), /Build and upgrade between waves/);
  await app.realClick('.sw-modal .sw-primary');
  await app.evaluate('window.__featherStore.setPlaying(false)');
  bundle = await app.evaluate(`(async()=>{const {buildGameBundle}=await import('/src/project/exportGame.ts');return buildGameBundle(window.__featherStore.exportProject());})()`);
  assert.ok(bundle.runtimeContract.requiredFeatures.includes('sproutwatch-tower-defense'));
  console.log('PASS: explicit starter builder, purchases, upgrades, refunds, wave spawning, pause/resume, speed, help, replay, export.');
} catch (error) {
  console.log(await app.evaluate('({hud:document.querySelector(".sproutwatch-hud")?.textContent,state:document.querySelector(".sproutwatch-hud")?.dataset})').catch(()=>null));
  await saveShot(app.page, 'failure').catch(()=>{});
  throw error;
} finally { await app.dispose(); }

// Production assets are served by the dev server from dist-player. No editor-only module or test hook
// is used in this half: the actual built Player consumes the exported bundle before startup.
const browser = await launch({ width: 1280, height: 850 });
const { page } = browser;
const evaluate = async expression => {
  const result = await page.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result?.value;
};
const waitFor = async expression => {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) { if (await evaluate(`Boolean(${expression})`).catch(() => false)) return; await delay(200); }
  throw new Error(`Timed out: ${expression}`);
};
const click = async selector => {
  const point = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await page.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
  await page.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
};
const errors = [];
page.socket.on('message', raw => { const m = JSON.parse(raw); if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text); });
try {
  await page.call('Page.addScriptToEvaluateOnNewDocument', { source: `window.__NODEFORGE_GAME__=${JSON.stringify(bundle)};` });
  await page.call('Page.navigate', { url: `${baseUrl}/dist-player/index.html` });
  await waitFor('document.querySelector(".sw-intro")');
  await delay(1000);
  await saveShot(page, '03-production-title');
  await click('.sw-intro .sw-primary');
  await waitFor('document.querySelectorAll(".sw-pad").length >= 10');
  await click('.sw-pad');
  await waitFor('document.querySelector("[data-testid=garden-coins]").textContent === "180"');
  await click('.sw-dismiss');
  await saveShot(page, '04-production-build');
  await page.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await delay(600);
  assert.equal(await evaluate('document.querySelectorAll(".sw-defender-card").length'), 3);
  assert.ok(await evaluate(`(()=>{const r=document.querySelector('.sw-build-bar').getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && r.bottom<=innerHeight;})()`));
  assert.ok(await evaluate(`(()=>{const r=document.querySelector('.sw-tools').getBoundingClientRect(),b=document.querySelector('.sw-stats').getBoundingClientRect();return b.right<=r.left && r.right<=innerWidth;})()`));
  await saveShot(page, '05-mobile');
  await page.call('Emulation.setDeviceMetricsOverride', { width: 320, height: 740, deviceScaleFactor: 1, mobile: true });
  await delay(300);
  assert.ok(await evaluate(`(()=>{const t=document.querySelector('.sw-tools').getBoundingClientRect(),s=document.querySelector('.sw-stats').getBoundingClientRect();return s.right<=t.left && t.right<=innerWidth;})()`));
  await saveShot(page, '06-small-mobile');
  await click('.sw-send');
  await waitFor('document.querySelector(".sproutwatch-hud").dataset.phase === "wave"');
  assert.deepEqual(errors, []);
  console.log('PASS: production player startup, purchases, responsive mobile controls, wave start; no runtime exceptions.');
} finally { await browser.dispose(); }
