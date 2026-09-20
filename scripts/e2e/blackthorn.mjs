/** Install the actual bundled film through its Asset Store card, then exercise the imported world. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { openEditor } from './harness.mjs';

process.env.FEATHER_CHROME_ANGLE ??= process.platform === 'darwin' ? 'metal' : 'default';
process.env.FEATHER_CDP_TIMEOUT_MS ??= '180000';
const output = 'exports/cinematics/blackthorn-store-review';
const app = await openEditor({ baseUrl: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:17421', query: '?demo=store', width: 1600, height: 1000, timeoutMs: 180_000 });
const errors = [];
app.page.socket.on('message', raw => {
  const event = JSON.parse(raw.toString());
  if (event.method === 'Runtime.exceptionThrown') errors.push(event.params.exceptionDetails.exception?.description ?? event.params.exceptionDetails.text);
});
try {
  await app.evaluate(`(async () => {
    const panels = await import('/src/components/workspacePanels.ts');
    panels.openWorkspacePanel({id:'store',title:'Asset Store',placement:{referencePanel:'project',direction:'within'}});
    panels.toggleWorkspacePanelMaximized('store');
    const {useMarketplaceStore}=await import('/src/store/marketplaceStore.ts');
    await useMarketplaceStore.getState().load(true);
    useMarketplaceStore.getState().setQuery('Blackthorn');
  })()`);
  await app.waitFor(`document.querySelectorAll('.store-card').length === 1 && document.querySelector('.store-card h3')?.textContent.includes('Blackthorn')`);
  await app.waitFor(`document.querySelector('.store-card img')?.naturalWidth > 0`);
  await app.evaluate(`document.querySelector('.store-install-button').scrollIntoView({block:'center'})`);
  assert.ok(await app.evaluate(`document.querySelector('.store-card img').getBoundingClientRect().width >= document.querySelector('.store-card-art').getBoundingClientRect().width * .95`), 'Film preview fills the store card');
  await mkdir(output, {recursive:true});
  const storeShot = await app.page.call('Page.captureScreenshot', {format:'png'});
  await writeFile(`${output}/asset-store.png`, Buffer.from(storeShot.data, 'base64'));
  await app.realClick('.store-install-button');
  await app.waitFor(`document.querySelector('.confirm-dialog__confirm')`);
  await app.realClick('.confirm-dialog__confirm');
  await app.waitFor(`window.__featherStore.activeScene()?.cinematics?.some(c=>c.name.includes('Blackthorn'))`, {timeout:180_000});
  const imported = await app.evaluate(`(async () => {
    const s=window.__featherStore, scene=s.activeScene(), seq=scene.cinematics.find(c=>c.autoplay);
    const ids=new Set(scene.objects.map(o=>o.id));
    const {sha256Hex}=await import('/src/utils/contentHash.ts');
    const assets=await Promise.all(s.assets.map(async a=>{const response=await fetch(a.url);const bytes=new Uint8Array(await response.arrayBuffer());return {name:a.name,bytes:bytes.length,valid:response.ok&&bytes.length>0&&(!a.hash||await sha256Hex(bytes)===a.hash)};}));
    return {name:scene.name,duration:seq.duration,shots:seq.actions.filter(a=>a.type==='camera').length,assets,
      cloth:scene.objects.filter(o=>o.cloth?.enabled).length,terrains:scene.objects.filter(o=>o.terrain).length,areaLights:scene.objects.filter(o=>o.light?.type==='rect').length,
      validCameraReferences:seq.actions.every(a=>!a.objectId||ids.has(a.objectId)),environment:scene.environment};
  })()`);
  assert.equal(imported.duration,70); assert.equal(imported.shots,10);
  assert.equal(imported.assets.length,12); assert.ok(imported.assets.every(a=>a.valid));
  assert.equal(imported.cloth,4); assert.equal(imported.terrains,2); assert.ok(imported.validCameraReferences);
  assert.equal(imported.areaLights,2);assert.equal(imported.environment.skyLighting,'sky');assert.equal(imported.environment.wetnessFromRain,true);
  // Run the real imported Blueprint references through the thunder/destruction cue. The film
  // renderer independently checks visual output; this assertion catches package-remapping bugs.
  const runtime = await app.evaluate(`(async () => {
    const s=window.__featherStore;
    const {initRapier}=await import('/src/runtime/physicsWorld.ts');await initRapier();
    s.setPlaying(true);s.setPlayPaused(true);await new Promise(r=>setTimeout(r,0));
    s.setPlayPaused(false);
    for(let i=0;i<Math.round(42.2*120);i++)s.tickRuntime(1/120);
    s.setPlayPaused(true);
    const result={shards:s.activeScene().objects.filter(o=>o.name.endsWith(' Chunk')).length,rain:s.activeScene().environment.rainIntensity,physicsScale:s.runtimeTimeScale};
    s.setPlaying(false);result.restoredRain=s.activeScene().environment.rainIntensity;
    return result;
  })()`);
  assert.equal(runtime.shards,32);assert.equal(runtime.rain,.82);assert.equal(runtime.physicsScale,.25);
  assert.equal(runtime.restoredRain,imported.environment.rainIntensity);
  assert.deepEqual(errors,[]);
  await writeFile(`${output}/report.json`,JSON.stringify({imported,runtime,errors},null,2));
  console.log(JSON.stringify({status:'passed',assets:12,shots:10,...runtime}));
} finally { await app.dispose(); }
