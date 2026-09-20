import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { openEditor } from './harness.mjs';
process.env.FEATHER_CHROME_ANGLE ??= process.platform==='darwin'?'metal':'default';
const output=process.env.FOG_QA_OUTPUT??'exports/cinematics/neon-fog-validation';await mkdir(output,{recursive:true});
const app=await openEditor({baseUrl:process.env.E2E_BASE_URL??'http://127.0.0.1:17421',query:'scripts/fixtures/fog-beams.html',readySelector:'canvas',width:480,height:320});
try{
 await app.waitFor('window.beamQA');const tiers=[];
 for(const steps of [12,28,40])tiers.push(await app.evaluate(`beamQA.measure(${steps})`));
 const shot=await app.page.call('Page.captureScreenshot',{format:'png'});await writeFile(`${output}/thin-beam.png`,Buffer.from(shot.data,'base64'));
 const moved=[];for(const x of [-.04,0,.04])moved.push(await app.evaluate(`beamQA.move(${x})`));
 const occludedPeak=await app.evaluate('beamQA.occlude()');
 const axial=await app.evaluate('beamQA.align()'),hemisphere=await app.evaluate('beamQA.hemisphere()'),reverse=await app.evaluate('beamQA.reverse()');
 const analytic=await app.evaluate('beamQA.analyticChecks()');
 const errors=await app.evaluate('beamQA.errors');const report={tiers,moved,occludedPeak,axial,hemisphere,reverse,analytic,errors};
 await writeFile(`${output}/beam-report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 if(!process.env.FOG_QA_BASELINE){
  for(const measurement of [...tiers,...moved,axial,hemisphere,reverse]){
   assert.ok(measurement.peak>20&&measurement.pixels>100,'A real beam remains visible');
   assert.ok(measurement.meanAbsoluteError<2.5,'Beam converges to dense integration without missed samples');
   assert.ok(measurement.neighborResidual<1.5,'No high-frequency dither in a smooth light volume');
  }
  for(const check of analytic)assert.ok(check.error<=1,`${check.kind} matches independent reference`);
  assert.equal(occludedPeak,0,'Opaque foreground stops fog integration');assert.deepEqual(errors,[],'No GPU shader errors');
 }
}finally{await app.dispose();}
