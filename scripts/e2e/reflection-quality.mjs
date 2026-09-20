import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { openEditor } from './harness.mjs';
process.env.FEATHER_CHROME_ANGLE ??= process.platform==='darwin'?'metal':'default';
const output='exports/cinematics/neon-reflection-validation';
const app=await openEditor({baseUrl:process.env.E2E_BASE_URL??'http://127.0.0.1:17421',query:'scripts/fixtures/reflection-quality.html',readySelector:'canvas',width:640,height:420});
try{
 await app.waitFor('window.reflectionQA');
 const settings=await app.evaluate('reflectionQA.settings()');
 assert.equal(settings.missedRays,false);assert.equal(settings.stretchDefine,false);assert.equal(settings.steps,80);assert.equal(settings.depth,.12);assert.equal(settings.depthNearest,true);
 assert.ok(settings.peak>.01,`A real neon reflection must survive hit rejection: ${JSON.stringify(settings)}`);
 await mkdir(output,{recursive:true});const screenshot=await app.page.call('Page.captureScreenshot',{format:'png'});await writeFile(`${output}/valid-reflection.png`,Buffer.from(screenshot.data,'base64'));
 const lighting=await app.evaluate('reflectionQA.lighting()');assert.ok(lighting.green>lighting.red*5,'Reflections must follow changed lights with a stationary camera');
 const cut=await app.evaluate('reflectionQA.cut()');assert.equal(cut.history,0);assert.equal(cut.finite,true);assert.ok(cut.difference<.001,`Cut must use this frame without old reflections: ${cut.difference}`);
 assert.equal(await app.evaluate('reflectionQA.dolly()'),1);
 const errors=await app.evaluate('reflectionQA.errors');assert.deepEqual(errors,[]);
 const report={status:'passed',settings,lighting,cut,errors};await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await app.dispose();}
