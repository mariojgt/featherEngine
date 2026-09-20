import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {openEditor} from './harness.mjs';

process.env.FEATHER_CHROME_ANGLE ??= process.platform==='darwin'?'metal':'default';
const baseUrl=process.env.E2E_BASE_URL??'http://127.0.0.1:17421';
const output='exports/cinematics/rendering-upgrade';await mkdir(output,{recursive:true});
const app=await openEditor({baseUrl,query:'scripts/fixtures/cinematic-lighting.html',readySelector:'canvas',width:960,height:640});
const difference=(a,b)=>a.reduce((sum,v,i)=>sum+Math.abs(v-b[i]),0)/a.length;
async function shot(name){const image=await app.page.call('Page.captureScreenshot',{format:'png'});await writeFile(`${output}/${name}.png`,Buffer.from(image.data,'base64'));}
try{
  await app.waitFor('window.renderQA');
  const baseline=await app.evaluate('renderQA.pixels()');await shot('01-dry');
  await app.evaluate('renderQA.set({wet:0})');
  const shaderErrors=await app.evaluate('renderQA.errors');
  await writeFile(`${output}/shader-errors.json`,JSON.stringify(shaderErrors,null,2));
  assert.equal(shaderErrors.length,0,shaderErrors[0]?.slice(0,1800));
  assert.equal(difference(await app.evaluate('renderQA.pixels()'),baseline),0,'Dry shader leaves original pixels unchanged');
  await app.evaluate('renderQA.set({wet:1,puddles:.85,rain:0})');
  const wet=await app.evaluate('renderQA.pixels()');await shot('02-wet');
  assert.ok(difference(baseline,wet)>2,'Wet surfaces visibly change the actual PBR result');
  await app.evaluate('renderQA.set({rain:1,time:2})');const rain=await app.evaluate('renderQA.pixels()');await shot('03-rain-ripples');
  await app.evaluate('renderQA.set({time:2.4})');const moving=await app.evaluate('renderQA.pixels()');
  assert.ok(difference(rain,moving)>.05,'Rain ripples animate in the surface normals');
  await app.evaluate('renderQA.set({wet:0,rain:0,time:3,environment:{skyTopColor:"#ff3419",skyHorizonColor:"#ff6540",cloudCoverage:0}})');const red=await app.evaluate('renderQA.samples()');
  await app.evaluate('renderQA.set({time:4,environment:{skyTopColor:"#184dff",skyHorizonColor:"#407cff"}})');const blue=await app.evaluate('renderQA.samples()');await shot('04-blue-sky-reflections');
  assert.ok(blue.metal[2]>red.metal[2]+10,'Sky radiance supplies blue reflections on metal');
  assert.ok(red.metal[0]>blue.metal[0]+10,'Old sky radiance is replaced');
  const lit=await app.evaluate('renderQA.pixels()');await app.evaluate('renderQA.set({lamp:0})');const unlit=await app.evaluate('renderQA.pixels()');
  assert.ok(difference(lit,unlit)>1,'Rectangular light contributes to actual GPU shading');
  const resources=await app.evaluate('renderQA.status()');const after=await app.evaluate('renderQA.repeat(20)');
  assert.ok(after.textures<=resources.textures+1,'Repeated sky filtering reuses GPU targets');
  await app.evaluate('renderQA.stopWeather()');assert.deepEqual(await app.evaluate('renderQA.errors'),[],'All shaders compile');
  const report={status:'passed',wetDifference:difference(baseline,wet),rippleDifference:difference(rain,moving),areaLightDifference:difference(lit,unlit),red,blue,resources,after,errors:[]};
  await writeFile(`${output}/gpu-report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await app.dispose();}
