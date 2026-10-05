/** Verify the actual authored package, physical projectile combat, mining, reload, pause and replay. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { openEditor } from './harness.mjs';
import { delay } from './cdp.mjs';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:17427';
const out = '.feather-cache/cinderfall-review';
await mkdir(out, { recursive: true });
let app = await openEditor({ baseUrl, query: '?exportTemplate=cinderfall', width: 1280, height: 800 });
try {
  await app.waitFor('document.body.dataset.templateExport || document.body.dataset.templateExportError');
  assert.equal(await app.evaluate('document.body.dataset.templateExportError'), undefined);
  console.log('Exported:', await app.evaluate('document.body.dataset.templateExport'));
} finally { await app.dispose(); }
app = await openEditor({ baseUrl, query: 'store-capture.html?slug=template-cinderfall&kind=project', readySelector: '[data-store-capture]', width: 1280, height: 800 });
const errors = [];
app.page.socket.on('message', raw => { const message = JSON.parse(raw.toString()); if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text); });
const frames = count => app.evaluate(`(async () => { for(let i=0;i<${count};i++) __featherStore.tickRuntime(1/60); await __storeCapture.render(); })()`);
const value = name => app.evaluate(`__featherStore.runtimeVariableValues[__featherStore.variables.find(variable => variable.name === ${JSON.stringify(name)}).id]`);
const key = async (code, key, count = 3) => {
  await app.page.call('Input.dispatchKeyEvent', { type: 'keyDown', code, key }); await frames(count);
  await app.page.call('Input.dispatchKeyEvent', { type: 'keyUp', code, key }); await frames(2);
};
const screenshot = async name => { await app.evaluate('__storeCapture.render()'); await writeFile(`${out}/${name}.png`, Buffer.from((await app.page.call('Page.captureScreenshot', { format: 'png' })).data, 'base64')); };
const place = async position => {
  await app.evaluate(`(() => { const s=__featherStore; s.updateCharacterController(cfPlayer,{enabled:false});s.tickRuntime(1/60);s.updateTransform(cfPlayer,'position',${JSON.stringify(position)});s.updateCharacterController(cfPlayer,{enabled:true});for(let i=0;i<5;i++)s.tickRuntime(1/60); })()`);
  await app.evaluate('__storeCapture.render()');
};
try {
  await app.waitFor('document.body.dataset.storeCapture || document.body.dataset.storeCaptureError');
  assert.equal(await app.evaluate('document.body.dataset.storeCaptureError'), undefined);
  await app.waitFor('document.querySelector(".cf-title")');
  await app.evaluate('__storeCapture.freeze(true)'); await delay(800); await frames(3);
  await app.evaluate('window.cfPlayer = __featherStore.activeScene().objects.find(object => object.character?.cameraFollow).id');
  assert.equal(await value('CFStage'), 0); await screenshot('brief');
  await app.realClick('.cf-brief .cf-button'); await frames(4); assert.equal(await value('CFStage'), 1);
  const before = await app.evaluate('__featherStore.activeScene().objects.find(object=>object.id===cfPlayer).transform.position[2]');
  await key('KeyW', 'w', 30);
  assert.ok(await app.evaluate('__featherStore.activeScene().objects.find(object=>object.id===cfPlayer).transform.position[2]') > before + 1, 'W moves the real character body');
  await screenshot('gameplay');
  const originalSeconds = await value('CFSeconds'); await key('KeyP', 'p');
  assert.equal(await value('CFPaused'), true); assert.equal(await app.evaluate('__featherStore.runtimeTimeScale'), 0);
  const pausedSeconds = await value('CFSeconds'); await frames(120); assert.equal(await value('CFSeconds'), pausedSeconds);
  await screenshot('pause'); await app.realClick('.cf-overlay .cf-button'); await frames(4); assert.equal(await value('CFPaused'), false);
  await key('KeyF', 'f'); assert.equal(await value('CFHeadlamp'), false); await key('KeyF', 'f'); assert.equal(await value('CFHeadlamp'), true);
  // Combat uses real projectiles. Positioning/aim are test setup; damage is never assigned by the test.
  const creatures = await app.evaluate('__featherStore.activeScene().objects.filter(object=>object.variables?.tags==="cf-creature").map(object=>object.id)');
  for (const id of creatures) {
    const target = await app.evaluate(`__featherStore.activeScene().objects.find(object=>object.id===${JSON.stringify(id)}).transform.position`);
    await place([target[0], 0.06, target[2] - 6]);
    await app.evaluate(`__storeCapture.aim(0, Math.atan2(${target[1]} + 0.85 - 1.74, 6))`);
    if (await value('CFAmmo') < 5) { await key('KeyR', 'r'); await frames(82); }
    await app.page.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: 640, y: 400, button: 'left', clickCount: 1 }); await frames(40);
    await app.page.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 640, y: 400, button: 'left', clickCount: 1 }); await frames(8);
    assert.equal(await app.evaluate(`__featherStore.runtimeObjectVariables[${JSON.stringify(id)}].health`), 0, 'Rifle projectiles kill a cavewarden');
  }
  assert.equal(await value('CFKills'), 8); await screenshot('combat');
  // Empty-magazine and delayed refill rules stay meaningful independently of shooting geometry.
  await app.page.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: 640, y: 400, button: 'left', clickCount: 1 }); await frames(230);
  await app.page.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 640, y: 400, button: 'left', clickCount: 1 }); await frames(2);
  assert.equal(await value('CFAmmo'), 0); await key('KeyR', 'r'); assert.ok(await value('CFReload') > 1);
  await frames(30); assert.equal(await value('CFAmmo'), 0, 'Reload does not refill instantly'); await frames(55); assert.equal(await value('CFAmmo'), 24);
  const veins = await app.evaluate('__featherStore.activeScene().objects.filter(object=>object.variables?.tags==="cf-vein").map(object=>object.transform.position)');
  for (const vein of veins.slice(0, 4)) { await place([vein[0], 0.06, vein[2] - 1.5]); await key('KeyE', 'e', 100); }
  assert.equal(await value('CFOre'), 16); assert.equal(await value('CFStage'), 2); assert.ok(await value('CFTimeLeft') > 0);
  await screenshot('quota'); await place([0, 0.06, -15]); await key('KeyE', 'e'); assert.equal(await value('CFStage'), 3);
  await screenshot('success'); assert.ok(await value('CFSeconds') > originalSeconds);
  await app.realClick('.cf-overlay .cf-button'); await frames(6);
  assert.equal(await value('CFStage'), 1); assert.equal(await value('CFOre'), 0); assert.equal(await value('CFAmmo'), 24); assert.equal(await value('Health'), 100);
  assert.equal(await app.evaluate('__featherStore.activeScene().objects.filter(object=>object.variables?.tags==="cf-creature" && __featherStore.runtimeObjectVariables[object.id].health===84).length'), 8, 'Replay restores all creatures');
  // Mission clock failure and recovery use the actual director; shortening its timer is test setup.
  await app.evaluate('__featherStore.setRuntimeVariableByName("CFOre",16)'); await frames(2);
  await app.evaluate('__featherStore.setRuntimeVariableByName("CFTimeLeft",1)'); await frames(70);
  assert.equal(await value('CFStage'), 4); assert.match(await value('CFHint'), /departed/); await screenshot('failure');
  await key('Enter', 'Enter'); await frames(4); assert.equal(await value('CFStage'), 1); assert.equal(await value('CFOre'), 0);
  await app.evaluate('__featherStore.setPlaying(false)');
  const bundle = await app.evaluate(`(async()=>{const {buildGameBundle}=await import('/src/project/exportGame.ts'); const {verifyGameBundle}=await import('/src/project/verifyBundle.ts'); const bundle=await buildGameBundle(__featherStore.exportProject()); const report=verifyGameBundle(bundle);if(report.errors.length)throw new Error(report.errors.join('; ')); return bundle;})()`);
  await writeFile(`${out}/game.json`, JSON.stringify(bundle));
  assert.deepEqual(errors, [], 'No runtime exceptions');
  console.log('Cinderfall passed: movement, pause, headlamp, physical projectile combat, finite ammo/timed reload, all mining, extraction, failure, replay and verified export.');
} finally { await app.dispose(); }
