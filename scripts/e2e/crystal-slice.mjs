import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { openEditor } from './harness.mjs';

// Exercise the actual live shell: still capture alone cannot catch a missing simulation driver.
process.env.FEATHER_CHROME_ANGLE ??= process.platform === 'darwin' ? 'metal' : 'swiftshader';
const app = await openEditor({ baseUrl: process.env.FEATHER_E2E_URL ?? 'http://127.0.0.1:17421',
  query: 'crystal-slice.html', readySelector: '[data-testid="crystal-pause"]', width: 1280, height: 720 });
const errors = [];
app.page.socket.on('message', raw => {
  const message = JSON.parse(raw.toString());
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
});
const sample = () => app.evaluate(`(() => {
  const s = window.__featherStore;
  return { time: s.runtimeCinematic?.time, runtimeTime: s.runtimeTime,
    paused: s.isPlayPaused, playing: s.isPlaying, camera: s.runtimeCinematicCamera, quality: s.renderSettings.quality,
    pieces: s.scenes.find(scene => scene.id === s.activeSceneId).objects.filter(o => o.variables?.__cutStock)
      .map(o => ({ id: o.id, position: o.transform.position, released: o.variables.__cutReleased,
        body: o.physics.bodyType, velocity: s.runtimeVelocities[o.id] })),
    wet: s.runtimeInWater, impacts: s.runtimeWaterImpacts.length };
})()`);
try {
  await app.waitFor('window.__FEATHER_PLAYER_READY__ && window.__featherStore.runtimeTime > 0.2');
  await app.realClick('[data-testid="crystal-pause"]');
  await app.waitFor('window.__featherStore.isPlayPaused');
  const paused = await sample();
  await app.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  assert.equal((await sample()).time, paused.time, 'Pause must freeze cinematic time');
  assert.equal(await app.text('[data-testid="crystal-pause"]'), 'Play');

  await app.realClick('[data-testid="crystal-restart"]');
  await app.waitFor('window.__featherStore.isPlaying && !window.__featherStore.isPlayPaused && window.__featherStore.runtimeCinematic.time < 0.5');
  const restarted = await sample();
  await app.waitFor('window.__featherStore.runtimeTime > 9.2', { timeout: 30_000 });
  const cut = await sample();
  assert.equal(cut.pieces.length, 8, 'Blade must generate eight new pieces from a single block');
  assert.ok(cut.pieces.every(p => p.released && p.body === 'dynamic'));
  assert.ok(cut.pieces.filter(p => p.position[1] < 0.7).length >= 4, 'Gravity must drop the released pieces');
  assert.ok(cut.wet.length > 0 && cut.impacts > 0, 'Falling bodies must affect the water');
  const point = await app.evaluate(`(() => {
    const s = window.__featherStore, cam = s.runtimeCinematicCamera;
    const pieces = s.scenes.find(scene => scene.id === s.activeSceneId).objects.filter(o => o.variables?.__cutReleased);
    const position = pieces[3].transform.position;
    const sub = (a,b) => a.map((v,i) => v-b[i]);
    const dot = (a,b) => a.reduce((sum,v,i) => sum+v*b[i],0);
    const norm = a => a.map(v => v/Math.hypot(...a));
    const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
    const f = norm(sub(cam.lookAt,cam.position)), r = norm(cross(f,[0,1,0])), u = cross(r,f);
    const p = sub(position,cam.position), depth = dot(p,f), tan = Math.tan(cam.fov*Math.PI/360);
    const rect = document.querySelector('canvas').getBoundingClientRect();
    return { x: rect.left+(dot(p,r)/(depth*tan*rect.width/rect.height)+1)*rect.width/2,
      y: rect.top+(1-dot(p,u)/(depth*tan))*rect.height/2 };
  })()`);
  await app.page.call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1, ...point });
  await app.page.call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1, ...point });
  await app.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const tapped = await sample();
  assert.ok(tapped.pieces.some(p => {
    const before = cut.pieces.find(q => q.id === p.id);
    return before && Math.hypot(...before.velocity) < 0.15
      && Math.hypot(...p.velocity.map((v, i) => v - before.velocity[i])) > 0.8;
  }), 'Tapping a slice must push a physical body');
  const cutShot = await app.page.call('Page.captureScreenshot', { format: 'png' });
  mkdirSync('exports/cinematics/crystal-slice', { recursive: true });
  writeFileSync('exports/cinematics/crystal-slice/live-cutting.png', Buffer.from(cutShot.data, 'base64'));
  await app.realClick('[data-testid="crystal-nudge"]');
  await app.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const nudged = await sample();
  assert.ok(nudged.pieces.some(p => {
    const before = tapped.pieces.find(q => q.id === p.id);
    return before && Math.hypot(...p.velocity.map((v, i) => v - before.velocity[i])) > 0.8;
  }), 'Nudge must change physical velocity');
  await app.waitFor('window.__featherStore.runtimeTime > 12.15 && window.__featherStore.runtimeCinematic?.time < 1', { timeout: 30_000 });
  const looped = await sample();
  assert.ok(looped.camera, 'Looping must retain the cinematic camera');
  assert.equal(looped.quality, 'Epic');
  assert.ok(Math.abs(looped.time - looped.runtimeTime % 12) < 1e-8, 'Live playback must wrap at twelve seconds');
  assert.deepEqual(errors, []);

  const out = 'exports/cinematics/crystal-slice';
  mkdirSync(out, { recursive: true });
  const report = { paused: paused.paused, restarted: restarted.time, looped: looped.time, pieces: cut.pieces, wet: cut.wet.length, impacts: cut.impacts, tap: true, nudge: true, errors };
  writeFileSync(`${out}/live-report.json`, JSON.stringify(report, null, 2));
  const screenshot = await app.page.call('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${out}/live-preview.png`, Buffer.from(screenshot.data, 'base64'));
  console.log(JSON.stringify(report));
} finally {
  await app.dispose();
}
