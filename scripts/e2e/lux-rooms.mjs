import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launch, delay } from './cdp.mjs';
const baseUrl=process.env.E2E_BASE_URL??'http://127.0.0.1:17420';
const out=resolve('exports/lux-acceptance');await mkdir(out,{recursive:true});
const {page,dispose}=await launch({width:960,height:640});
const evaluate=async(expression)=>{const r=await page.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
const wait=async(expression)=>{const end=Date.now()+90000;while(Date.now()<end){if(await evaluate(expression).catch(()=>false))return;await delay(200);}throw new Error(`Timed out: ${expression}; ${JSON.stringify(await evaluate('({status:window.luxRoomsQA?.status(),errors:window.luxRoomsQA?.errors})'))}`);};
try {
  await page.call('Page.navigate',{url:`${baseUrl}/scripts/fixtures/lux-rooms.html`});await wait('window.luxRoomsQA');await delay(500);
  const baseline=await evaluate('luxRoomsQA.pixels()');await evaluate('luxRoomsQA.start()');await wait('luxRoomsQA.status().state === "ready"');await delay(900);
  assert.deepEqual(await evaluate('luxRoomsQA.errors'),[],'Room shaders compile');
  const rooms=await evaluate('luxRoomsQA.pixels()');
  assert.ok(rooms.left[0]>rooms.left[2]+8,`Left room receives red bounce: ${JSON.stringify(rooms)}`);
  assert.ok(rooms.right[2]>rooms.right[0]+8,`Right room receives blue bounce: ${JSON.stringify(rooms)}`);
  assert.deepEqual(rooms.outside,baseline.outside,'Room lighting is clipped outside its bounds');
  assert.equal(await evaluate('luxRoomsQA.status().maxFaces'),1,'All rooms and depth share one scene face per frame');
  const shot=await page.call('Page.captureScreenshot',{format:'png'});await writeFile(resolve(out,'04-rooms.png'),Buffer.from(shot.data,'base64'));
  await evaluate('luxRoomsQA.wallTest()');await wait('luxRoomsQA.status().state === "ready"');await delay(900);
  const occluded=await evaluate('luxRoomsQA.pixels()');await evaluate('luxRoomsQA.occlusion(false)');await delay(500);const unoccluded=await evaluate('luxRoomsQA.pixels()');
  assert.ok(unoccluded.right[0]>occluded.right[0]+8,`Captured depth rejects light behind the interior wall: ${JSON.stringify({occluded,unoccluded})}`);
  await evaluate('luxRoomsQA.stop()');await delay(500);const idle=await evaluate('luxRoomsQA.resources()');
  for(let i=0;i<3;i++){await evaluate('luxRoomsQA.start()');await wait('luxRoomsQA.status().state === "ready"');await evaluate('luxRoomsQA.stop()');await delay(300);}
  const final=await evaluate('luxRoomsQA.resources()');assert.ok(final.textures<=idle.textures+1,'Room capture and depth textures are released');
  assert.deepEqual(await evaluate('luxRoomsQA.errors'),[]);
  await writeFile(resolve(out,'rooms.json'),JSON.stringify({baseline,rooms,occluded,unoccluded,idle,final},null,2));
  console.log('✓ Lux rooms: independent colour bounce, bounded coverage, wall occlusion, shared frame budget and GPU cleanup.');
}finally{await dispose();}
