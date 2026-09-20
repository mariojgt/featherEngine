import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { openEditor } from './harness.mjs';

process.env.FEATHER_CHROME_ANGLE ??= process.platform === 'darwin' ? 'metal' : 'default';
process.env.FEATHER_CDP_TIMEOUT_MS ??= '180000';
const path = process.argv[2] ?? 'exports/cinematics/blackthorn/game.json';
const bundle = JSON.parse(await readFile(path, 'utf8'));
const output = 'exports/cinematics/rendering-upgrade';
const app = await openEditor({ baseUrl: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:17421', query: 'cinematic-capture.html', readySelector: '[data-cinematic-capture]', width: 960, height: 540 });
const errors = [];
app.page.socket.on('message', raw => {
  const m = JSON.parse(raw.toString());
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    const text = m.params.args.map(a => a.value ?? a.description ?? '').join(' ');
    if (/THREE.WebGLProgram|Shader Error|VALIDATE_STATUS/.test(text)) errors.push(text);
  }
});
try {
  await app.waitFor('window.__featherStore');
  await app.evaluate(`(async () => {
    const {readGameBundle}=await import('/src/project/exportGame.ts');
    const loaded=readGameBundle(${JSON.stringify(bundle)});
    window.__featherStore.loadProject(loaded.project);
    const s=window.__featherStore;
    s.updateRenderSettings({quality:'High',autoQuality:false});
    s.setPlaying(true);s.setPlayPaused(true);
    window.frame=(await import('/src/runtime/cinematicCapture.ts')).renderCinematicCaptureFrame;
  })()`);
  await app.waitFor('document.querySelector("canvas")');
  await app.evaluate('new Promise(r=>setTimeout(r,2500))');
  await app.evaluate(`(() => {const s=window.__featherStore;s.setPlayPaused(false);for(let i=0;i<120;i++)s.tickRuntime(1/120);s.setPlayPaused(true);})()`);
  const samples = [];
  for (const quality of ['High','Epic','High','Epic','High','Epic','High']) {
    await app.evaluate(`window.__featherStore.updateRenderSettings({quality:${JSON.stringify(quality)}})`);
    await app.evaluate('new Promise(r=>setTimeout(r,500))');
    for (let i=0;i<8;i++) await app.evaluate('window.frame()');
    samples.push({ quality, ...await app.evaluate('window.__featherCaptureMetrics') });
  }
  await mkdir(output,{recursive:true});
  const waterCuts = [];
  if (bundle.project.scenes.some(scene => scene.objects.some(object => object.water?.enabled))) {
    for (const quality of ['High', 'Epic']) {
      await app.evaluate(`window.__featherStore.updateRenderSettings({quality:${JSON.stringify(quality)}})`);
      await app.evaluate('window.frame()');
      const result = await app.evaluate(`(async () => {
        const {waterCapture:c,waterMeshRegistry:meshes}=await import('/src/three/waterShared.ts');
        const {useEditorStore}=await import('/src/store/editorStore.ts');
        const previous=c.reflectionMatrix.elements.slice(),y=c.planeY;
        const position=[${quality === 'High' ? 3 : -6},y+4,${quality === 'High' ? 12 : 22}];
        useEditorStore.setState({runtimeCinematicCamera:{position,lookAt:[0,y+1,-20],fov:55}});
        await window.frame();
        const surfaces=[...meshes].filter(mesh=>mesh.material?.uniforms?.uReflectionMatrix);
        return {quality:${JSON.stringify(quality)},changed:c.reflectionMatrix.elements.some((v,i)=>Math.abs(v-previous[i])>1e-6),
          hdr:c.reflection.type===1016,scale:c.reflection.image.width/c.resolution.x,
          synchronized:surfaces.length>0&&surfaces.every(mesh=>mesh.material.uniforms.uReflectionMatrix.value.equals(c.reflectionMatrix)
            && mesh.material.uniforms.uCamPos.value.toArray().every((v,i)=>Math.abs(v-position[i])<1e-6)),surfaces:surfaces.length};
      })()`);
      assert.ok(result.changed && result.hdr && result.synchronized, JSON.stringify(result));
      assert.equal(result.scale, quality === 'Epic' ? 1 : .5);
      waterCuts.push(result);
    }
  }
  const report = { samples, waterCuts, errors };
  await writeFile(`${output}/reflection-lifecycle.json`,JSON.stringify(report,null,2));
  assert.deepEqual(errors,[],'Reflection shaders and quality changes must render without errors');
  const high = samples.filter(s=>s.quality==='High');
  // Ignore first-use texture uploads, then require repeated changes to return to the same budget.
  assert.ok(high.at(-1).textures <= high[1].textures+1, JSON.stringify(samples));
  console.log(JSON.stringify({status:'passed',...report}));
} finally { await app.dispose(); }
