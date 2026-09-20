import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { openEditor } from './harness.mjs';
process.env.FEATHER_CHROME_ANGLE ??= process.platform==='darwin'?'metal':'default';
const output='exports/cinematics/neon-lighting-validation';await mkdir(output,{recursive:true});
const app=await openEditor({baseUrl:process.env.E2E_BASE_URL??'http://127.0.0.1:17421',query:'scripts/fixtures/local-fog.html',readySelector:'canvas',width:640,height:420});
const shot=async name=>{const result=await app.page.call('Page.captureScreenshot',{format:'png'});await writeFile(`${output}/${name}.png`,Buffer.from(result.data,'base64'));};
try{
 await app.waitFor('window.fogQA');const baseline=await app.evaluate('fogQA.pixelGrid()');await shot('fog-local-off');
 const lit=await app.evaluate('fogQA.setStrength(2.4)');await shot('fog-local-on');
 assert.ok(lit.left[0]>lit.left[2]+15,'Red light colors the left-hand mist');assert.ok(lit.right[2]>lit.right[0]+15,'Blue light colors the right-hand mist');
 const moved=await app.evaluate('fogQA.move()');assert.ok(moved.left[2]>moved.left[0]+15,'Fog follows moving blue light');assert.ok(moved.right[0]>moved.right[2]+15,'Fog follows moving red light');
 await app.evaluate('fogQA.setStrength(0)');assert.deepEqual(await app.evaluate('fogQA.pixelGrid()'),baseline,'Disabling local scattering restores the exact baseline');
 const errors=await app.evaluate('fogQA.errors');assert.deepEqual(errors,[],'Local volumetric lighting compiles without GPU errors');
 const report={status:'passed',lit,moved,errors};await writeFile(`${output}/gpu-report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await app.dispose();}
