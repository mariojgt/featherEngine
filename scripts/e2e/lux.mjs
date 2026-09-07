import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launch, delay } from './cdp.mjs';
import { openEditor } from './harness.mjs';

const baseUrl=process.env.E2E_BASE_URL??'http://127.0.0.1:17420';
const out=resolve('exports/lux-acceptance');await mkdir(out,{recursive:true});
const {page,dispose}=await launch({width:960,height:640});
const evaluate=async(expression)=>{const r=await page.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
const wait=async(expression)=>{const end=Date.now()+90000;while(Date.now()<end){if(await evaluate(expression).catch(()=>false))return;await delay(200);}throw new Error(`Timed out: ${expression}; ${JSON.stringify(await evaluate('window.luxQA?.status()'))}`);};
const shot=async(name)=>{const r=await page.call('Page.captureScreenshot',{format:'png'});await writeFile(resolve(out,`${name}.png`),Buffer.from(r.data,'base64'));};
if (!process.argv.includes('--editor-only')) try {
  await page.call('Page.navigate',{url:`${baseUrl}/scripts/fixtures/lux-lighting.html`});
  await wait('window.luxQA');await delay(1000);
  const baseline=await evaluate('luxQA.pixels()');await shot('01-authored');
  await evaluate('luxQA.start()');await wait('luxQA.status().captures >= 2');await delay(700);
  await writeFile(resolve(out,'shaders.json'),JSON.stringify(await evaluate('luxQA.sources')));
  assert.deepEqual(await evaluate('luxQA.errors'),[],'Lux shaders compile on real WebGL');
  const red=await evaluate('luxQA.pixels()');await shot('02-red-bounce');
  assert.ok(red.diffuse[0]>baseline.diffuse[0]+8,`Indirect light reaches a white receiver: ${JSON.stringify({baseline,red})}`);
  assert.ok(red.diffuse[0]-red.diffuse[2]>8,'Emissive red surface produces colored bounce');
  await evaluate("luxQA.color('#0840ff')");
  const count=await evaluate('luxQA.status().captures');await wait(`luxQA.status().captures >= ${count+2}`);await delay(700);
  const blue=await evaluate('luxQA.pixels()');await shot('03-blue-bounce');
  assert.ok(blue.diffuse[2]>red.diffuse[2]+8,`Moving/changing radiance updates the cache: ${JSON.stringify({red,blue})}`);
  assert.ok(blue.diffuse[0]<red.diffuse[0]-8,'Old red radiance decays');
  assert.notDeepEqual(blue.metal,red.metal,'Captured surroundings affect rough metal reflections');
  await evaluate('luxQA.reflections(false)');await delay(700);
  assert.deepEqual((await evaluate('luxQA.pixels()')).metal,baseline.metal,'Disabling local reflections retains authored reflection lighting');
  const reflectionCount=await evaluate('luxQA.status().captures');await evaluate('luxQA.reflections(true)');await wait(`luxQA.status().captures >= ${reflectionCount+2}`);await delay(300);
  assert.ok((await evaluate('luxQA.pixels()')).metal[2]>baseline.metal[2]+20,'Local reflections resume after rebuilding their filtered cache');
  assert.equal(await evaluate('luxQA.status().maxFaces'),1,'At most one capture face per frame');
  const stats=await evaluate('luxQA.status()');
  await evaluate('luxQA.stop()');await delay(500);
  assert.ok(!(await evaluate('luxQA.hooks()')).includes('lux-1.0'),'Disabling restores authored material hooks');
  const restored=await evaluate('luxQA.pixels()');
  assert.deepEqual(restored.diffuse,baseline.diffuse,'Disabling restores original direct/ambient light exactly');
  const idle=await evaluate('luxQA.resources()');
  for(let i=0;i<3;i++){await evaluate('luxQA.start()');await wait('luxQA.status().captures >= 1');await delay(500);assert.ok((await evaluate('luxQA.pixels()')).diffuse[2]>baseline.diffuse[2]+8,'Indirect lighting returns after every re-enable');await evaluate('luxQA.stop()');await delay(500);}
  const final=await evaluate('luxQA.resources()');assert.ok(final.textures<=idle.textures+1,`No accumulated GPU textures: ${JSON.stringify({idle,final})}`);
  await evaluate('luxQA.start(true)');await wait('luxQA.status().captures >= 1');await delay(500);
  assert.equal(await evaluate('luxQA.status().hdr'),false,'LDR diffuse fallback does not need HDR render targets');
  const ldr=await evaluate('luxQA.pixels()');assert.ok(ldr.diffuse[2]>baseline.diffuse[2]+1 && ldr.diffuse[2]>ldr.diffuse[0],`LDR diffuse fallback still receives blue bounce: ${JSON.stringify({baseline,ldr})}`);
  await evaluate('luxQA.stop()');await delay(300);
  assert.deepEqual(await evaluate('luxQA.errors'),[]);
  await writeFile(resolve(out,'rendering.json'),JSON.stringify({baseline,red,blue,restored,ldr,stats,idle,final},null,2));
  console.log('✓ Lux GPU: colored indirect light, dynamic radiance, reflections, face budget, disable restoration and GPU cleanup.');
} finally {await dispose();}
else await dispose();

const app=await openEditor({baseUrl,query:'?demo=store'});
try {
  await app.evaluate('window.__featherStore.selectObject("")');
  await app.waitFor('document.querySelector(".lux-settings")');
  await app.evaluate('document.querySelector(".lux-settings input[type=checkbox]").click()');
  await app.waitFor('document.querySelector("[data-lux-status=ready]")',{timeout:90000});
  const settings=await app.evaluate('window.__featherStore.scenes.find(s=>s.id===window.__featherStore.activeSceneId).environment.lux');
  assert.equal(settings.enabled,true);
  await app.evaluate('window.__featherStore.updateRenderSettings({quality:"Low",autoQuality:false})');
  await app.waitFor('document.querySelector("[data-lux-status=suspended]")');
  await app.evaluate('window.__featherStore.updateRenderSettings({quality:"High"})');
  await app.waitFor('document.querySelector("[data-lux-status=ready]")',{timeout:90000});
  console.log('✓ Lux editor: actual settings controls enable the cache; Low suspends it and High restores it.');
} catch (error) {
  console.error('Lux editor status:', await app.evaluate('document.querySelector(".lux-settings")?.textContent'));
  const r=await app.page.call('Page.captureScreenshot',{format:'png'});await writeFile(resolve(out,'editor-failure.png'),Buffer.from(r.data,'base64'));
  throw error;
} finally {await app.dispose();}
