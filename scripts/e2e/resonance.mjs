import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { openEditor } from './harness.mjs';

// Export through the actual template builder: replaces the bundled .nfpack, including its audio.
const app = await openEditor({ baseUrl: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:17420', query: '?exportTemplate=cinematic', width: 1100, height: 760, timeoutMs: 120_000 });
const errors = [];
let hasPreview = false;
let passed = false;
app.page.socket.on('message', data => { const m = JSON.parse(data.toString()); if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text); });
try {
  await app.waitFor('document.body.dataset.templateExport || document.body.dataset.templateExportError', { timeout: 120_000 });
  assert.equal(await app.evaluate('document.body.dataset.templateExportError'), undefined);
  console.log('Packaged template:', await app.evaluate('JSON.parse(document.body.dataset.templateExport)'));
  await app.evaluate(`(() => { const s=window.__featherStore; s.updateRenderSettings({quality:'High',autoQuality:false}); })()`);
  await app.realClick('[data-creator-mode="play"]');
  await app.waitFor('window.__featherStore.isPlaying && window.__featherStore.runtimeCinematic?.time > 0.1');
  // Advance the real simulation in fixed steps, pause for rendering, and inspect each major shot.
  // High stays enabled: the screenshot check includes Lux, atmosphere, shadows and bloom.
  const shotTimes = process.env.RESONANCE_SHOTS ? process.env.RESONANCE_SHOTS.split(',').map(Number) : [2.5, 6, 11, 17, 22, 24.8, 30, 31.8];
  for (const time of shotTimes) {
    const info = await app.evaluate(`(() => {
      const s=window.__featherStore; s.setPlayPaused(false);
      for(let i=0;i<2400 && s.runtimeCinematic && s.runtimeCinematic.time<${time} && s.runtimeTimeScale>0;i++) s.tickRuntime(1/60);
      s.setPlayPaused(true);
      return {time:s.runtimeCinematic?.time, scale:s.runtimeTimeScale, quality:s.renderSettings.quality, shards:s.activeScene().objects.filter(o=>o.name.startsWith('Reactor shell') && o.physics?.bodyType==='dynamic').length};
    })()`);
    // Let the scene and throttled lighting capture settle on the paused frame.
    await app.evaluate('new Promise(resolve => setTimeout(resolve, 1200))');
    const shot = await app.page.call('Page.captureScreenshot', {format:'png'});
    writeFileSync(`/tmp/feather-resonance-${time}.png`, Buffer.from(shot.data,'base64'));
    console.log('Shot', time, info);
    assert.equal(info.quality, 'High');
    if (time === 6) {
      const clip = await app.evaluate(`(() => {
        const canvas=[...document.querySelectorAll('canvas')].sort((a,b)=>b.clientWidth*b.clientHeight-a.clientWidth*a.clientHeight)[0];
        const r=canvas.getBoundingClientRect(), h=Math.min(r.height,r.width/2.39);
        return {x:r.x+3,y:r.y+(r.height-h)/2+3,width:r.width-6,height:h-6,scale:1};
      })()`);
      const preview = await app.page.call('Page.captureScreenshot', {format:'png',clip});
      writeFileSync('/tmp/feather-resonance-preview.png', Buffer.from(preview.data,'base64'));
      hasPreview = true;
    }
  }
  await app.evaluate('window.__featherStore.setPlayPaused(false)');
  await app.realClick('.resonance-replay');
  await app.waitFor('window.__featherStore.runtimeTimeScale === 1 && window.__featherStore.runtimeCinematic?.time < 2');
  console.log('Real Replay film click restored the scene and autoplay');
  await app.realClick('[data-creator-mode="build"]');
  assert.deepEqual(errors, []);
  const bundle = await app.evaluate(`(async () => (await import('/src/project/exportGame.ts')).buildGameBundle(window.__featherStore.exportProject()))()`);
  writeFileSync('/tmp/feather-resonance-game.json', JSON.stringify(bundle));
  passed = true;
  console.log('PASS: High-quality shots, real replay and export bundle');
} catch (error) {
  const shot = await app.page.call('Page.captureScreenshot',{format:'png'});
  writeFileSync('/tmp/feather-resonance-failure.png',Buffer.from(shot.data,'base64'));
  throw error;
} finally {
  await app.dispose();
  // Write public art only after closing the page; Vite reloads open tabs when public files change.
  if (passed && hasPreview) {
    mkdirSync('public/store/previews', {recursive:true});
    copyFileSync('/tmp/feather-resonance-preview.png', 'public/store/previews/resonance.png');
  }
}
