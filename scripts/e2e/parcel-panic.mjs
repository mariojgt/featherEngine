/** Regenerates the real starter package, then verifies keyboard play, replay and package import.
 * E2E_BASE_URL=http://127.0.0.1:17420 node scripts/e2e/parcel-panic.mjs
 * macOS hardware rendering: FEATHER_E2E_ANGLE=metal
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { openEditor } from './harness.mjs';
import { delay } from './cdp.mjs';
import { verifyCourierMotion } from './parcel-panic-motion.mjs';

const out = process.env.PARCEL_PANIC_REVIEW_DIR ?? '/tmp/feather-parcel-panic';
await mkdir(out, { recursive: true });
const app = await openEditor({ baseUrl: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:17420', query: '?exportTemplate=parcel-panic', width: 1440, height: 900 });
const errors = [];
app.page.socket.on('message', raw => { const m = JSON.parse(raw); if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text); });
const value = name => app.evaluate(`__featherStore.runtimeVariableValues[__featherStore.variables.find(v=>v.name===${JSON.stringify(name)}).id]`);
const frames = count => app.evaluate(`(()=>{for(let i=0;i<${count};i++) __featherStore.tickRuntime(1/60)})()`);
const key = async (code, key) => {
  await app.page.call('Input.dispatchKeyEvent', { type: 'keyDown', code, key });
  await frames(4);
  await app.page.call('Input.dispatchKeyEvent', { type: 'keyUp', code, key });
  await frames(4);
};
// Test setup only: recreate the character body at a destination so a teleport does not sweep through scenery.
const placePlayer = position => app.evaluate(`(()=>{const s=__featherStore;s.updateCharacterController(ppPlayer,{enabled:false});s.tickRuntime(1/60);s.updateTransform(ppPlayer,'position',${JSON.stringify(position)});s.updateTransform(ppPlayer,'rotation',[0,0,0]);s.updateCharacterController(ppPlayer,{enabled:true});for(let i=0;i<4;i++)s.tickRuntime(1/60)})()`);
const village = () => app.evaluate(`__featherStore.activeScene().objects.filter(o=>/ · (Coral|Bluebell|Honey) House$/.test(o.name)).map(o=>o.transform.position)`);
const screenshot = async name => { await delay(300); await writeFile(`${out}/${name}.png`, Buffer.from((await app.page.call('Page.captureScreenshot', { format: 'png' })).data, 'base64')); };
try {
  await app.page.call('Runtime.enable');
  await app.waitFor('document.body.dataset.templateExport || document.body.dataset.templateExportError');
  assert.equal(await app.evaluate('document.body.dataset.templateExportError'), undefined);
  console.log('Package:', await app.evaluate('document.body.dataset.templateExport'));
  await app.realClick('[data-testid="toolbar-play-button"]');
  await app.waitFor('__featherStore.runtimeCinematic?.time > 0');
  await frames(75);
  await screenshot('opening');
  const clip = await app.evaluate(`(()=>{const c=[...document.querySelectorAll('canvas')].sort((a,b)=>b.clientWidth*b.clientHeight-a.clientWidth*a.clientHeight)[0];const r=c.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1};})()`);
  await writeFile(`${out}/preview.png`, Buffer.from((await app.page.call('Page.captureScreenshot', { format: 'png', clip })).data, 'base64'));
  await frames(550);
  assert.equal(await value('PPPlaying'), true);
  assert.equal(await app.evaluate('Boolean(__featherStore.runtimeCinematic)'), false);
  await screenshot('gameplay');
  await verifyCourierMotion(app, out);
  // Position the courier near the first parcel; pickup/throw/recall use real browser keyboard input.
  await app.evaluate(`window.ppPlayer = __featherStore.activeScene().objects.find(o=>o.creatorRoleId==='player').id; __featherStore.updateTransform(ppPlayer,'position',[-5.5,.1,-3])`);
  await frames(4); await key('KeyE', 'e');
  assert.equal(await value('PPCarry'), 'Coral 01');
  const basket = await app.evaluate(`__featherStore.activeScene().objects.find(o=>o.name==='01 · Coral Delivery Basket').transform.position`);
  await placePlayer([basket[0], .1, basket[2] - 5]);
  await frames(4); await key('KeyQ', 'q'); await frames(90);
  assert.equal(await value('PPScore'), 150);
  assert.equal(await value('PPDelivered'), 1);
  await key('KeyR', 'r'); assert.equal(await value('PPScore'), 150);
  await key('KeyP', 'p');
  assert.equal(await value('PPPaused'), true);
  const seconds = await value('PPSeconds'); await frames(90);
  assert.equal(await value('PPSeconds'), seconds);
  await screenshot('pause');
  await app.realClick('.pp-modal .pp-button');
  assert.equal(await value('PPPaused'), false);
  // Feed the remaining parcels into their real delivery rules to exercise completion and results UI.
  await app.evaluate(`(()=>{const s=__featherStore; for(const p of s.activeScene().objects.filter(o=>/^Parcel [1-5] ·/.test(o.name))){if(s.runtimeObjectVariables[p.id].delivered)continue; const basket=s.activeScene().objects.find(o=>o.id===p.variables.destination);s.updateTransform(p.id,'position',basket.transform.position);for(let i=0;i<8;i++)s.tickRuntime(1/60);}})()`);
  assert.equal(await value('PPDone'), true);
  assert.equal(await value('PPDelivered'), 5);
  await screenshot('results');
  const oldSeed = await value('PPSeed'); const oldVillage = await village();
  await app.realClick('.pp-results .pp-secondary:last-of-type'); await frames(3);
  assert.equal(await value('PPSeed'), oldSeed);
  assert.deepEqual(await village(), oldVillage);
  assert.equal(await value('PPTimed'), true);
  assert.equal(await value('PPDelivered'), 0);
  await app.evaluate('__featherStore.setRuntimeVariableByName("PPSeconds",90)'); await frames(4);
  assert.equal(await value('PPDone'), true);
  await app.realClick('.pp-results .pp-button'); await frames(3);
  assert.equal(await value('PPTimed'), true); // A new village preserves the selected mode.
  assert.equal(await value('PPDone'), false);
  assert.notEqual(await value('PPSeed'), oldSeed);
  assert.notDeepEqual(await village(), oldVillage);
  assert.equal(await value('PPVillage'), 2);
  await screenshot('new-village');
  await app.evaluate('__featherStore.setPlaying(false); __featherStore.setPlaying(true)'); await frames(4);
  await key('Enter', 'Enter'); await frames(60);
  assert.equal(await value('PPPlaying'), true);
  assert.equal(await app.evaluate('Boolean(__featherStore.runtimeCinematic)'), false);
  await app.evaluate('__featherStore.setPlaying(false)');
  // Install the actual archive into a new project; then save/reopen and play the remapped graphs.
  assert.equal(await app.evaluate(`__featherProject.newProjectFromPackageUrl('/store/packages/projects/template-parcel-panic.nfpack','Parcel Panic package check')`), true);
  await app.evaluate('__featherStore.loadProject(JSON.parse(JSON.stringify(__featherStore.exportProject())))');
  await app.evaluate('__featherStore.setPlaying(true)'); await frames(4); await key('Enter', 'Enter'); await frames(60);
  assert.equal(await value('PPPlaying'), true);
  assert.equal(await app.evaluate('__featherStore.assets.filter(a=>a.type==="audio").length'), 5);
  await screenshot('installed-package');
  await app.evaluate('__featherStore.setPlaying(false)');
  const bundle = await app.evaluate(`(async()=>{const {buildGameBundle,embedAssets}=await import('/src/project/exportGame.ts');const p=__featherStore.exportProject();p.assets=await embedAssets(__featherStore.assets);return buildGameBundle(p)})()`);
  await writeFile(`${out}/game.json`, JSON.stringify(bundle));
  assert.deepEqual(errors, []);
  console.log('PASS: opening, keyboard pickup/throw/recall, scoring, pause, results, timed mode, same-seed retry, new village, skip, package install and save/reopen.');
  console.log(`Screenshots and portable player bundle: ${out}`);
} catch(error) { await screenshot('failure').catch(()=>{}); throw error; }
finally { await app.dispose(); }
