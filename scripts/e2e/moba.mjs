/** Actual hero selection, pointer orders, camera, combat, menus and portable archive round trip. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { openEditor } from './harness.mjs';
import { delay } from './cdp.mjs';
const out = process.env.MOBA_REVIEW_DIR ?? '/tmp/feather-rift';
await mkdir(out, { recursive: true });
const app = await openEditor({
  baseUrl: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:17423',
  query: '?exportTemplate=moba',
  width: 1600,
  height: 1000,
});
const errors = [];
app.page.socket.on('message', (raw) => {
  const m = JSON.parse(raw);
  if (m.method === 'Runtime.exceptionThrown')
    errors.push(
      m.params.exceptionDetails.exception?.description ??
        m.params.exceptionDetails.text,
    );
});
const value = (name) =>
  app.evaluate(
    `__featherStore.runtimeVariableValues[__featherStore.variables.find(v=>v.name===${JSON.stringify(name)}).id]`,
  );
const frames = (count) =>
  app.evaluate(
    `(()=>{for(let i=0;i<${count};i++)__featherStore.tickRuntime(1/60)})()`,
  );
const key = async (code, key) => {
  await app.page.call('Input.dispatchKeyEvent', { type: 'keyDown', code, key });
  await frames(3);
  await app.page.call('Input.dispatchKeyEvent', { type: 'keyUp', code, key });
  await frames(3);
};
const shot = async (name) => {
  await delay(180);
  await writeFile(
    `${out}/${name}.png`,
    Buffer.from(
      (await app.page.call('Page.captureScreenshot', { format: 'png' })).data,
      'base64',
    ),
  );
};
const worldClick = async (point, button = 'right') => {
  const p = await app.evaluate(
    `(()=>{const root=llRoot.store.getState(),r=root.gl.domElement.getBoundingClientRect(),p=new llThree.Vector3(...${JSON.stringify(point)}).project(root.camera);return {x:r.x+(p.x+1)*r.width/2,y:r.y+(1-p.y)*r.height/2}})()`,
  );
  assert.ok(
    p.x > 0 && p.x < 1600 && p.y > 140 && p.y < 880,
    'world click is visible',
  );
  await app.page.call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...p });
  await app.page.call('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    ...p,
    button,
    buttons: button === 'right' ? 2 : 1,
    clickCount: 1,
  });
  await app.page.call('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...p,
    button,
    buttons: 0,
    clickCount: 1,
  });
  await frames(4);
};
try {
  await app.page.call('Runtime.enable');
  await app.waitFor(
    'document.body.dataset.templateExport || document.body.dataset.templateExportError',
  );
  assert.equal(
    await app.evaluate('document.body.dataset.templateExportError'),
    undefined,
  );
  console.log(
    'Package:',
    await app.evaluate('document.body.dataset.templateExport'),
  );
  await app.realClick('[data-testid="toolbar-play-button"]');
  await app.waitFor('document.querySelector(".ll-start")');
  await shot('hero-selection');
  for (const [i, name] of [
    'Aegis',
    'Briar',
    'Lyra',
    'Kestrel',
    'Sera',
  ].entries()) {
    await app.realClick(`.ll-hero-${i + 1}`);
    assert.equal(await value('LLHeroName'), name);
  }
  await app.realClick('.ll-hero-3');
  await app.realClick('.ll-start');
  await app.waitFor(
    '__featherStore.runtimeVariableValues[__featherStore.variables.find(v=>v.name==="LLPlaying").id]===true',
  );
  await app.evaluate(
    `(async()=>{window.llHero=__featherStore.activeScene().objects.find(o=>o.variables?.controlled).id;window.llThree=await import('/node_modules/.vite/deps/three.js');const {_roots}=await import('/node_modules/.vite/deps/@react-three_fiber.js');window.llRoot=[..._roots.values()].find(r=>r.store.getState().gl.domElement.closest('.game-canvas'));if(!llRoot)throw Error('Game canvas root missing');})()`,
  );
  await delay(500);
  await shot('spawn');
  assert.ok((await value('LLGold')) >= 500, 'starting gold visible in gameplay');
  assert.match(await app.text('.ll-shop-hud .ll-shop-gold'), /gold/);
  await app.realClick('.ll-shop-access');
  assert.equal(await value('LLShopOpen'), true);
  assert.equal(await app.count('.ll-shop-card'), 6);
  await app.realClick('.ll-shop-card:nth-child(2) .ll-shop-buy');
  assert.equal(await value('LLOwned2'), true);
  assert.equal(await value('LLInventoryCount'), 1);
  assert.equal(await value('LLTotalSpellPower'), 35);
  assert.equal(await app.evaluate('document.querySelector(".ll-shop-card:nth-child(2) .ll-shop-buy").disabled'), true);
  await key('KeyQ', 'q');
  assert.equal(await value('LLPulse'), 0, 'shop does not leak ability input');
  await shot('item-shop');
  const beforeSell = await value('LLGold');
  await app.realClick('.ll-shop-card:nth-child(2) .ll-shop-sell');
  assert.ok((await value('LLGold')) >= beforeSell + 210, '70% sale refund');
  assert.equal(await value('LLInventoryCount'), 0);
  assert.equal(await value('LLTotalSpellPower'), 0);
  await app.realClick('.ll-shop-card:nth-child(1) .ll-shop-buy');
  assert.equal(await value('LLOwned1'), true);
  await key('Escape', 'Escape');
  assert.equal(await value('LLShopOpen'), false);
  assert.equal(await value('LLPaused'), false, 'escape closes shop before pausing');
  assert.equal(await app.count('.ll-shop-owned .ll-shop-inventory-item'), 1);
  for (const width of [900, 640]) {
    await app.page.call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await delay(300);
    assert.ok(await app.evaluate(`(()=>{const r=document.querySelector('.ll-tray').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})()`), 'all champion controls remain onscreen');
    assert.ok(await app.boxOf('.ll-shop-access'), `shop access visible at ${width}px`);
    assert.ok(await app.evaluate(`(()=>{const a=document.querySelector('.ll-shop-hud').getBoundingClientRect(),b=document.querySelector('.ll-tray').getBoundingClientRect();return a.right<=b.left||a.left>=b.right||a.bottom<=b.top||a.top>=b.bottom})()`), 'inventory clears ability controls');
    await key('KeyP', 'p');
    assert.equal(await value('LLShopOpen'), true);
    assert.ok(await app.boxOf('.ll-shop-close'), 'narrow shop has accessible close button');
    assert.ok(await app.evaluate(`(()=>{const a=document.querySelector('.ll-shop-modal');return a.scrollWidth<=a.clientWidth+1})()`), 'no horizontal shop overflow');
    await shot(`shop-${width}`);
    await key('Escape', 'Escape');
    await shot(`gold-${width}`);
  }
  await app.page.call('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await delay(300);
  const start = await app.evaluate(
    '({hero:__featherStore.activeScene().objects.find(o=>o.id===llHero).transform.position,camera:llRoot.store.getState().camera.position.toArray()})',
  );
  await worldClick([21, 0, 20]);
  assert.equal(
    await app.evaluate('__featherStore.runtimeObjectVariables[llHero].ordered'),
    true,
  );
  const poses = [];
  for (let i = 0; i < 5; i++) {
    await delay(110);
    poses.push(
      await app.evaluate(
        `(()=>{const vars=__featherStore.runtimeObjectVariables[llHero];let leg,other;llRoot.store.getState().scene.traverse(n=>{if(n.userData.nfObjectId===vars.leg)leg=n.rotation.x;if(n.userData.nfObjectId===vars.leg2)other=n.rotation.x});return {leg,other}})()`,
      ),
    );
  }
  assert.ok(
    poses.some((p) => Math.abs(p.leg) > 0.1),
    'actual rendered walk',
  );
  assert.ok(
    poses.every((p) => Math.abs(p.leg + p.other) < 0.05),
    'alternating legs',
  );
  await delay(800);
  const moved = await app.evaluate(
    '({hero:__featherStore.activeScene().objects.find(o=>o.id===llHero).transform.position,camera:llRoot.store.getState().camera.position.toArray()})',
  );
  assert.ok(
    Math.hypot(moved.hero[0] - start.hero[0], moved.hero[2] - start.hero[2]) >
      3,
    'right-click movement',
  );
  assert.ok(
    Math.hypot(
      moved.camera[0] - start.camera[0],
      moved.camera[2] - start.camera[2],
    ) > 3,
    'camera follows hero',
  );
  await app.realClick('.nf-tactical-map');
  await frames(2);
  const dest = await app.evaluate(
    '__featherStore.runtimeObjectVariables[llHero].destination',
  );
  assert.ok(Math.hypot(dest[0], dest[2]) < 2, 'minimap maps to world centre');
  await key('KeyP', 'p');
  assert.equal(await value('LLAtBase'), false);
  assert.equal(await app.evaluate('document.querySelector(".ll-shop-card:nth-child(2) .ll-shop-buy").disabled'), true);
  await key('Escape', 'Escape');
  await key('KeyS', 's');
  assert.equal(
    await app.evaluate('__featherStore.runtimeObjectVariables[llHero].ordered'),
    false,
  );
  // Keep the combat fixture centred and unobstructed; the command itself is real pointer input.
  await app.evaluate(
    `(()=>{const s=__featherStore;window.llRival=s.activeScene().objects.find(o=>o.name==='Ember · Coral rival').id;for(const o of s.activeScene().objects.filter(o=>o.variables?.tags==='lumen-unit'&&o.id!==llHero)){Object.assign(s.runtimeObjectVariables[o.id],{pace:0,cooldown:100});s.updateTransform(o.id,'position',o.variables.home)}s.updateTransform(llHero,'position',[3,0,3]);s.updateTransform(llRival,'position',[-2,0,0]);})()`,
  );
  await delay(600);
  await worldClick([-2, 1.5, 0]);
  assert.equal(
    await app.evaluate(
      '__featherStore.runtimeObjectVariables[llHero].attack_order',
    ),
    await app.evaluate('llRival'),
  );
  await frames(10);
  assert.ok(
    (await app.evaluate('__featherStore.runtimeObjectVariables[llRival].hp')) <
      360,
    'selected enemy is damaged',
  );
  await key('KeyQ', 'q');
  assert.ok((await value('LLPulse')) > 0);
  await key('KeyR', 'r');
  assert.ok((await value('LLUltimate')) > 0);
  await shot('combat');
  await key('KeyE', 'e');
  assert.ok((await value('LLDash')) > 0);
  await key('Escape', 'Escape');
  assert.equal(await value('LLPaused'), true);
  const time = await value('LLSeconds');
  await frames(90);
  assert.equal(await value('LLSeconds'), time);
  await shot('pause');
  await app.realClick('.ll-modal .ll-button:first-of-type');
  assert.equal(await value('LLPaused'), false);
  await app.evaluate('__featherStore.setPlaying(false)');
  assert.equal(
    await app.evaluate(
      `__featherProject.newProjectFromPackageUrl('/store/packages/projects/template-moba.nfpack','The Astral Rift')`,
    ),
    true,
  );
  await app.evaluate(
    '__featherStore.loadProject(JSON.parse(JSON.stringify(__featherStore.exportProject())));__featherStore.setPlaying(true)',
  );
  await app.waitFor('document.querySelector(".ll-start")');
  await app.realClick('.ll-hero-2');
  await app.realClick('.ll-start');
  await frames(190);
  assert.equal(await value('LLHeroName'), 'Briar');
  assert.ok((await value('LLWaves')) >= 1);
  await shot('installed-package');
  // A clean, representative cover at the river crossing.
  await app.evaluate(
    `(()=>{const s=__featherStore;const hero=s.activeScene().objects.find(o=>o.variables?.controlled);s.updateTransform(hero.id,'position',[3,0,3]);})()`,
  );
  await delay(800);
  const clip = await app.evaluate(
    `(()=>{const c=document.querySelector('.game-canvas canvas');const r=c.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()`,
  );
  await writeFile(
    `${out}/preview.png`,
    Buffer.from(
      (await app.page.call('Page.captureScreenshot', { format: 'png', clip }))
        .data,
      'base64',
    ),
  );
  await app.evaluate('__featherStore.setPlaying(false)');
  const bundle = await app.evaluate(
    `(async()=>{const {buildGameBundle}=await import('/src/project/exportGame.ts');return buildGameBundle(__featherStore.exportProject())})()`,
  );
  await writeFile(`${out}/game.json`, JSON.stringify(bundle));
  assert.deepEqual(errors, []);
  console.log(
    'PASS: five hero choices, actual click movement/target attacks, walking, follow camera, minimap, Q/E/R, gold, item buy/sell, inventory, narrow-screen shop, pause, archive install and save/reopen.',
  );
} catch (error) {
  await shot('failure').catch(() => {});
  throw error;
} finally {
  await app.dispose();
}
