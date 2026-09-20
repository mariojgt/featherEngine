/** Import the actual cyberpunk film through the Asset Store and run the packaged direction cues. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { openEditor } from './harness.mjs';
process.env.FEATHER_CHROME_ANGLE ??= process.platform === 'darwin' ? 'metal' : 'default';
process.env.FEATHER_CDP_TIMEOUT_MS ??= '180000';
const output='exports/cinematics/neon-store-review';
const app=await openEditor({baseUrl:process.env.E2E_BASE_URL??'http://127.0.0.1:17421',query:'?demo=store',width:1600,height:1000,timeoutMs:180_000});
const errors=[];
app.page.socket.on('message',raw=>{const event=JSON.parse(raw.toString());if(event.method==='Runtime.exceptionThrown')errors.push(event.params.exceptionDetails.exception?.description??event.params.exceptionDetails.text);});
try{
 await app.evaluate(`(async()=>{
   const panels=await import('/src/components/workspacePanels.ts');
   panels.openWorkspacePanel({id:'store',title:'Asset Store',placement:{referencePanel:'project',direction:'within'}});panels.toggleWorkspacePanelMaximized('store');
   const {useMarketplaceStore}=await import('/src/store/marketplaceStore.ts');await useMarketplaceStore.getState().load(true);useMarketplaceStore.getState().setQuery('Neon Afterlight');
 })()`);
 await app.waitFor(`document.querySelectorAll('.store-card').length===1 && document.querySelector('.store-card h3')?.textContent.includes('Neon Afterlight')`);
 await app.waitFor(`document.querySelector('.store-card img')?.naturalWidth>0`);
 await app.waitFor(`document.querySelector('.store-card')?.textContent.includes('v1.1.0')`);
 await app.evaluate(`document.querySelector('.store-install-button').scrollIntoView({block:'center'})`);
 await mkdir(output,{recursive:true});const screenshot=await app.page.call('Page.captureScreenshot',{format:'png'});await writeFile(`${output}/asset-store.png`,Buffer.from(screenshot.data,'base64'));
 await app.realClick('.store-install-button');await app.waitFor(`document.querySelector('.confirm-dialog__confirm')`);await app.realClick('.confirm-dialog__confirm');
 await app.waitFor(`window.__featherStore.activeScene()?.cinematics?.some(c=>c.name.includes('Neon Afterlight'))`,{timeout:180_000});
 const imported=await app.evaluate(`(async()=>{
   const s=window.__featherStore,scene=s.activeScene(),seq=scene.cinematics.find(c=>c.autoplay),ids=new Set(scene.objects.map(o=>o.id));
   const {sha256Hex}=await import('/src/utils/contentHash.ts');
   const assets=await Promise.all(s.assets.map(async a=>{const response=await fetch(a.url),bytes=new Uint8Array(await response.arrayBuffer());return {name:a.name,bytes:bytes.length,valid:response.ok&&bytes.length>0&&(!a.hash||await sha256Hex(bytes)===a.hash)};}));
   return {duration:seq.duration,shots:seq.actions.filter(a=>a.type==='camera').length,assets,quality:s.renderSettings.quality,
     areaLights:scene.objects.filter(o=>o.light?.type==='rect').length,water:scene.objects.filter(o=>o.water?.enabled).length,particles:scene.objects.filter(o=>o.particles?.enabled).length,
     coolingLights:scene.objects.filter(o=>o.name.startsWith('Cooling /')&&o.light).map(o=>o.light.intensity).sort((a,b)=>a-b),
     coolingDroplet:scene.objects.find(o=>o.name==='Water / overflowing cooling pipe')?.particles?.startSize,
     references:seq.actions.every(a=>!a.objectId||ids.has(a.objectId))&&scene.objects.every(o=>!o.parentId||ids.has(o.parentId)),environment:scene.environment};
 })()`);
 assert.equal(imported.duration,70);assert.equal(imported.shots,10);assert.equal(imported.assets.length,16);assert.ok(imported.assets.every(a=>a.valid));
 assert.equal(imported.quality,'Epic');assert.equal(imported.areaLights,9);assert.equal(imported.water,3);assert.equal(imported.particles,7);assert.ok(imported.references);
 assert.equal(imported.environment.volumetricLocalStrength,1.4);
 assert.deepEqual(imported.coolingLights,[24,45]);assert.equal(imported.coolingDroplet,.024);
 const runtime=await app.evaluate(`(async()=>{
   const s=window.__featherStore;const drone=s.activeScene().objects.find(o=>o.name.startsWith('08 ·'));
   s.setPlaying(true);s.setPlayPaused(true);await new Promise(r=>setTimeout(r,0));s.setPlayPaused(false);
   for(let i=0;i<40*30;i++)s.tickRuntime(1/30);s.setPlayPaused(true);
   const result={rain:s.activeScene().environment.rainIntensity,droneZ:s.activeScene().objects.find(o=>o.id===drone.id).transform.position[2]};
   s.setPlaying(false);result.restoredRain=s.activeScene().environment.rainIntensity;result.restoredDrone=s.activeScene().objects.find(o=>o.id===drone.id).transform.position;
   return result;
 })()`);
 assert.equal(runtime.rain,.72);assert.ok(runtime.droneZ < -20);assert.equal(runtime.restoredRain,.42);assert.deepEqual(runtime.restoredDrone,[-5,7.8,8]);assert.deepEqual(errors,[]);
 await writeFile(`${output}/report.json`,JSON.stringify({imported,runtime,errors},null,2));console.log(JSON.stringify({status:'passed',assets:16,shots:10,...runtime}));
}finally{await app.dispose();}
