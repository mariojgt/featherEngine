import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openEditor } from './e2e/harness.mjs';

// A production capture uses LIVE simulation, never scrub previews. PNG frames carry no wall-clock
// timestamps: ffmpeg assigns exactly i/fps even when a complex frame takes seconds to render.
const arg = (key, fallback) => { const i = process.argv.indexOf(`--${key}`); return i < 0 ? fallback : process.argv[i + 1]; };
const bundlePath = arg('bundle', '');
const template = arg('template', bundlePath ? 'custom-film' : 'last-light');
const fps = Number(arg('fps', '24')), width = Number(arg('width', '1920')), height = Number(arg('height', '1080'));
// Verdant's canopy shafts rely on the full volumetric/shadow budget; other films retain their
// established High default unless the caller explicitly chooses a tier.
const quality = arg('quality', template === 'verdant' ? 'Epic' : 'High');
assert.ok(['Low','Medium','High','Epic'].includes(quality), 'Unknown quality preset');
assert.ok(/^[a-z0-9-]+$/.test(template), 'Invalid template key');
assert.ok([24, 25, 30, 60].includes(fps), 'Use 24, 25, 30 or 60 fps');
assert.ok(Number.isInteger(width) && Number.isInteger(height) && width >= 320 && height >= 180 && width <= 3840 && height <= 2160 && width % 2 === 0 && height % 2 === 0, 'Use even dimensions up to 3840×2160');
const preview = process.argv.includes('--preview');
const out = resolve(arg('output', `exports/cinematics/${template}`));
mkdirSync(out, { recursive: true });
const baseUrl = arg('url', 'http://127.0.0.1:17421');
if (!preview) assert.equal(spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status, 0, 'Install ffmpeg to render MP4');
// macOS Metal provides the same WebGL renderer without the software rasterizer's capture cost.
process.env.FEATHER_CHROME_ANGLE ??= process.platform === 'darwin' ? 'metal' : 'default';
process.env.FEATHER_CDP_TIMEOUT_MS ??= '180000';
const app = await openEditor({ baseUrl, query: `cinematic-capture.html${bundlePath ? '' : `?exportTemplate=${template}`}`, readySelector: '[data-cinematic-capture]', width, height, timeoutMs: 180_000 });
await app.waitFor('window.__featherStore && document.querySelector(".scene-drop-zone")', { timeout: 180_000 });
let encoder;
let encoderDone;
let encoderError = '';
const errors = [];
app.page.socket.on('message', raw => {
  const m = JSON.parse(raw.toString());
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    const message = m.params.args.map(a => a.value ?? a.description ?? '').join(' ');
    if (/THREE.WebGLProgram|Shader Error|VALIDATE_STATUS/.test(message)) errors.push(message);
  }
});
try {
  if (bundlePath) {
    const input = JSON.parse(readFileSync(resolve(bundlePath), 'utf8'));
    const project = input.project ?? input;
    assert.ok(project.scenes?.length, 'Bundle must contain scenes');
    assert.ok((project.assets ?? []).every(a => a.data), 'Use a self-contained game.json with embedded assets for --bundle');
    await app.evaluate(`(async () => {
      const {readGameBundle}=await import('/src/project/exportGame.ts');
      const loaded=readGameBundle(${JSON.stringify(input)});
      loaded.project.activeSceneId=loaded.startSceneId;
      window.__featherStore.loadProject(loaded.project);
    })()`);
  } else {
    await app.waitFor('document.body.dataset.templateExport || document.body.dataset.templateExportError', { timeout: 180_000 });
    assert.equal(await app.evaluate('document.body.dataset.templateExportError'), undefined);
  }
  const info = await app.evaluate(`(() => {
    const s=window.__featherStore, seq=s.activeScene().cinematics.find(c=>c.autoplay);
    if(!seq) throw new Error('Template has no autoplay cinematic');
    return {id:seq.id,name:seq.name,duration:seq.duration,shots:seq.actions.filter(a=>a.type==='camera').map(a=>({time:a.time,label:a.label})),audio:seq.actions.filter(a=>a.type==='sound')};
  })()`);
  console.log(JSON.stringify({ stage: 'built', ...info }));
  // Preserve a portable game bundle before physics alters the authored scene.
  const bundle = await app.evaluate(`(async () => {
    const project=window.__featherStore.exportProject();
    project.name=window.__featherProject?.projectName ?? ${JSON.stringify(info.name)};
    return (await import('/src/project/exportGame.ts')).buildGameBundle(project);
  })()`);
  if (!bundlePath) copyFileSync(resolve(`public/store/packages/projects/template-${template}.nfpack`), resolve(out, `${template}.nfpack`));
  else {
    const archive = await app.evaluate(`(async () => {
      const s=window.__featherStore;
      const {buildPackage}=await import('/src/project/package.ts');
      const {writePackageArchive}=await import('/src/project/packageArchive.ts');
      const {toPackagedAsset}=await import('/src/dev/exportTemplate.ts');
      const collected=s.buildProjectPackage(), bytes=new Map(), assets=[];
      for(const id of collected.assetIds) {
        const a=s.assets.find(a=>a.id===id);
        if(!a) throw new Error('Missing referenced package asset: '+id);
        const entry=await toPackagedAsset(a,new Map());
        assets.push(entry.asset);bytes.set(id,entry.bytes);
      }
      const pkg=buildPackage('project',collected.content,assets,{id:'pkg-cinematic-export',name:${JSON.stringify(info.name)},version:'1.0.0'});
      const blob=new Blob([writePackageArchive(pkg,bytes)]);
      return await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.onerror=reject;r.readAsDataURL(blob)});
    })()`);
    writeFileSync(resolve(out, `${template}.nfpack`), Buffer.from(archive, 'base64'));
  }
  const audioInputs = [];
  for (const asset of bundle.project.assets) {
    asset.data = await app.evaluate(`(async () => {
      const a=window.__featherStore.assets.find(a=>a.id===${JSON.stringify(asset.id)});
      const source=a?.url ?? a?.data;
      if(!source) throw new Error('Missing bundle asset: '+${JSON.stringify(asset.id)});
      const response=await fetch(source);if(!response.ok)throw new Error('Could not load bundle asset: '+a.id+' (HTTP '+response.status+')');
      const blob=await response.blob();
      return await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(blob)});
    })()`);
  }
  for (let i = 0; i < info.audio.length; i++) {
    const cue = info.audio[i];
    const asset = bundle.project.assets.find(a => a.id === cue.soundId);
    assert.ok(asset?.data, 'Missing cinematic sound');
    const data = asset.data.split(',')[1];
    const path = resolve(out, `audio-${i}.wav`);
    writeFileSync(path, Buffer.from(data, 'base64')); audioInputs.push({ path, time: cue.time });
  }
  writeFileSync(resolve(out, 'game.json'), JSON.stringify(bundle));
  console.log('Prepared portable bundle and score; starting the renderer.');
  await app.page.call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await app.evaluate(`(async () => {
    const s=window.__featherStore;
    const capture=await import('/src/runtime/cinematicCapture.ts');
    capture.configureCinematicCapture(true);
    window.__renderCinematicFrame=capture.renderCinematicCaptureFrame;
    const zone=document.querySelector('.scene-drop-zone');
    document.body.appendChild(zone);
    zone.style.cssText='position:fixed;inset:0;width:100vw;height:100vh;z-index:10000;background:#050b10';
    const style=document.createElement('style');style.textContent='.perf-overlay,.runtime-console,.minimap-overlay,[data-capture-ui]{display:none!important}';document.head.appendChild(style);
    s.updateRenderSettings({quality:${JSON.stringify(quality)},autoQuality:false});s.setPlaying(true);s.setPlayPaused(true);
  })()`);
  await app.waitFor('window.__featherStore.isPlaying && document.querySelector(".scene-drop-zone canvas")', { timeout: 90_000 });
  await app.evaluate('new Promise(r=>setTimeout(r,2500))');
  console.log('Renderer mounted; sampling live simulation.');
  // Start the autoplay sequence while paused between every sample; wall time cannot advance it.
  await app.evaluate(`(() => { const s=window.__featherStore; s.setPlayPaused(false); s.tickRuntime(0); s.setPlayPaused(true); })()`);
  // Rendering stays paused: extra draws settle streamed chunks, vegetation LODs and GPU uploads
  // without advancing physics, weather or the score. Require both a minimum run and stable metrics
  // so a brief plateau while a chunk/model is queued cannot look like a fully populated forest.
  async function settleRenderer(reason) {
    let previous = '', stable = 0, metrics;
    for (let i = 0; i < 240; i++) {
      await app.evaluate('window.__renderCinematicFrame()');
      metrics = await app.evaluate('window.__featherCaptureMetrics');
      assert.ok(metrics, 'Capture driver must publish scene metrics');
      const signature = JSON.stringify({
        cameraPosition: metrics.cameraPosition,
        authoredTreeParts: metrics.authoredTreeParts,
        groundCoverParts: metrics.groundCoverParts,
        textures: metrics.textures, geometries: metrics.geometries, programs: metrics.programs,
      });
      stable = !metrics.assetsLoading && signature === previous ? stable + 1 : 0;
      previous = signature;
      if (i >= 23 && stable >= 12) return metrics;
    }
    throw new Error(`Renderer did not settle (${reason}): ${JSON.stringify(metrics)}`);
  }
  await settleRenderer('initial scene');
  const frames = Math.round(info.duration * fps);
  const requestedTimes = arg('times', '');
  assert.ok(!requestedTimes || preview, '--times is for preview stills; movies always render every frame');
  const times = preview ? (requestedTimes ? requestedTimes.split(',').map(Number) : info.shots.map((shot, i) => shot.time + ((info.shots[i + 1]?.time ?? info.duration) - shot.time) * 0.5)) : Array.from({ length: frames }, (_, i) => i / fps);
  assert.ok(times.every((t, i) => Number.isFinite(t) && t >= 0 && t < info.duration && (i === 0 || t > times[i - 1])), 'Preview times must increase and fall within the film');
  if (!preview) {
    const inputs = audioInputs.flatMap(a => ['-i', a.path]);
    const mix = audioInputs.map((a, i) => `[${i + 1}:a]adelay=${Math.round(a.time * 1000)}:all=1[a${i}]`).concat(audioInputs.length ? [`${audioInputs.map((_, i) => `[a${i}]`).join('')}amix=inputs=${audioInputs.length}:normalize=0,alimiter=limit=0.95:latency=1,apad,atrim=duration=${info.duration}[score]`] : []).join(';');
    encoder = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'warning', '-f', 'image2pipe', '-framerate', String(fps), '-vcodec', 'png', '-i', 'pipe:0', ...inputs, ...(mix ? ['-filter_complex', mix, '-map', '0:v:0', '-map', '[score]'] : ['-map', '0:v:0']), '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-c:a', 'aac', '-b:a', '320k', '-t', String(info.duration), '-movflags', '+faststart', resolve(out, `${template}.mp4`)], { stdio: ['pipe', 'ignore', 'pipe'] });
    encoder.stderr.on('data', b => { encoderError += b.toString(); });
    encoder.stdin.on('error', () => {});
    encoderDone = new Promise((resolve, reject) => { encoder.once('error', reject); encoder.once('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg failed: ${encoderError}`))); });
    // Attach a rejection handler while frames are being produced, then await the same promise below.
    encoderDone.catch(() => {});
  }
  let simulationTime = 0, previousCinematicTime = 0;
  const samples = [];
  for (let i = 0; i < times.length; i++) {
    const time = times[i];
    const steps = Math.round((time - simulationTime) * 120);
    const sample = await app.evaluate(`(() => {
      const s=window.__featherStore;s.setPlayPaused(false);
      for(let j=0;j<${steps};j++)s.tickRuntime(1/120);
      s.setPlayPaused(true);
      return {time:s.runtimeCinematic?.time,physicsScale:s.runtimeTimeScale,shards:s.activeScene().objects.filter(o=>o.name.endsWith(' Chunk')&&o.physics?.bodyType==='dynamic').length,weather:{rain:s.activeScene().environment?.rainIntensity??0,clouds:s.activeScene().environment?.cloudCoverage??0,lightning:s.activeScene().environment?.lightningFlash??0},runtimeTime:s.runtimeTime};
    })()`);
    simulationTime += steps / 120;
    const cinematicTime = sample.time ?? simulationTime;
    const crossedShot = info.shots.some(shot => shot.time > previousCinematicTime + 1e-6 && shot.time <= cinematicTime + 1e-6);
    previousCinematicTime = cinematicTime;
    if (preview || crossedShot) {
      sample.gpu = await settleRenderer(preview ? `preview at ${time}` : `camera cut at ${time}`);
    } else {
      // Ordinary continuous motion keeps the normal single-frame cost.
      await app.evaluate('window.__renderCinematicFrame()');
      sample.gpu = await app.evaluate('window.__featherCaptureMetrics');
    }
    const image = await app.page.call('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true, clip: { x: 0, y: 0, width, height, scale: 1 } });
    const bytes = Buffer.from(image.data, 'base64');
    if (preview && template === 'verdant' && i === 0) {
      const previews = resolve('public/store/previews');
      mkdirSync(previews, { recursive: true });
      writeFileSync(resolve(previews, 'verdant.png'), bytes);
    }
    if (preview || i % (fps * 7) === 0) {
      writeFileSync(resolve(out, `frame-${time.toFixed(2).padStart(5, '0')}.png`), bytes);
      samples.push({ frame: i, seconds: time, ...sample });
      console.log(JSON.stringify({ stage: preview ? 'preview' : 'render', frame: i, frames, seconds: time, ...sample }));
    }
    if (encoder) {
      if (encoder.exitCode !== null) throw new Error(`Encoder exited: ${encoderError}`);
      if (!encoder.stdin.write(bytes)) await once(encoder.stdin, 'drain');
    }
    if (!preview && i % (fps * 2) === 0 && i % (fps * 7) !== 0) console.log(`Rendered ${i}/${frames} frames (${Math.round(i / frames * 100)}%)`);
  }
  if (encoder) { encoder.stdin.end(); await encoderDone; }
  assert.deepEqual(errors, [], 'Browser exceptions during rendering');
  const report = { template, quality, width, height, fps, duration: info.duration, frames: preview ? times.length : frames, audioCues: audioInputs.length, samples, errors };
  if (!preview) {
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', resolve(out, `${template}.mp4`)], { encoding: 'utf8' });
    assert.equal(probe.status, 0, 'ffprobe must verify the finished movie');
    report.media = JSON.parse(probe.stdout);
    const video = report.media.streams.find(s => s.codec_type === 'video');
    assert.equal(Number(video.nb_frames), frames); assert.equal(video.width, width); assert.equal(video.height, height);
    assert.ok(Math.abs(Number(report.media.format.duration) - info.duration) < 0.1);
    if (audioInputs.length) assert.ok(report.media.streams.some(s => s.codec_type === 'audio'));
  }
  writeFileSync(resolve(out, preview ? 'preview-report.json' : 'render-report.json'), JSON.stringify(report, null, 2));
  console.log(`Completed: ${out}`);
} finally {
  if (encoder && encoder.exitCode === null) encoder.kill();
  await app.dispose();
}
