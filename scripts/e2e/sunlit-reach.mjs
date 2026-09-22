/**
 * Sunlit Reach — Mini MMO template browser test.
 *
 * Installs the real store packages, opens the three-zone template, checks the login vista
 * cinematic, picks a class, finishes Elara's quest through the actual HUD controls, then walks
 * to the north waystone and travels into Thornwood: the client must switch scenes, the zone's
 * entry sweep must autoplay, and the HUD must announce the new zone.
 *
 * Run against a dev server:  E2E_BASE_URL=http://127.0.0.1:17430 node scripts/e2e/sunlit-reach.mjs
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { openEditor } from './harness.mjs';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:17430';
const app = await openEditor({ baseUrl, query: '?demo=store', width: 1440, height: 960, timeoutMs: 90000 });
const shot = async (name) => writeFile(`artifacts/sunlit-reach/${name}.png`, Buffer.from((await app.page.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
const hero = () => app.evaluate(`(async () => { const {useRealm} = await import('/src/titan/session.ts'); const s = useRealm.getState().snapshot; return s.players.find(p => p.id === s.selfId); })()`);
const editor = (expr) => app.evaluate(`(async () => { const {useEditorStore} = await import('/src/store/editorStore.ts'); const s = useEditorStore.getState(); return (${expr}); })()`);
try {
  await mkdir('artifacts/sunlit-reach', { recursive: true });
  await app.evaluate(`window.__sunlitErrors = []; window.addEventListener('error', event => window.__sunlitErrors.push(event.message));`);
  await app.evaluate(`(async () => { window.__feather = { editor: (await import('/src/store/editorStore.ts')).useEditorStore, realm: (await import('/src/titan/session.ts')).useRealm }; })()`);
  // waitFor evaluates a synchronous expression; these helpers read live store state without promises.
  const sceneName = `window.__feather.editor.getState().scenes.find(sc => sc.id === window.__feather.editor.getState().activeSceneId).name`;
  const cinematicOn = `Boolean(window.__feather.editor.getState().runtimeCinematic)`;
  const heroZone = `(() => { const s = window.__feather.realm.getState().snapshot; return s && s.players.find(p => p.id === s.selfId)?.zone; })()`;
  await app.evaluate(`(async () => {
    const {useEditorStore} = await import('/src/store/editorStore.ts');
    const {useMarketplaceStore} = await import('/src/store/marketplaceStore.ts');
    useEditorStore.setState({isDirty: false});
    const store = useMarketplaceStore.getState(); await store.load();
    const plugin = useMarketplaceStore.getState().packages.find(p => p.pluginId === 'feather.titan');
    if (!plugin) throw new Error('Titan plugin listing missing'); await store.install(plugin);
    const pack = useMarketplaceStore.getState().packages.find(p => p.slug === 'sunlit-reach');
    if (!pack) throw new Error('Sunlit Reach listing missing'); await store.install(pack);
  })()`);
  const scenes = await editor(`s.scenes.map(scene => scene.name)`);
  assert.deepEqual([...scenes].sort(), ['Cinder Keep', 'Ember Meadow', 'Thornwood'], 'the template installs one scene per zone');
  const zones = await app.evaluate(`(async () => { const {titanZoneScenes} = await import('/src/titan/settings.ts'); const {useEditorStore} = await import('/src/store/editorStore.ts'); return Object.keys(titanZoneScenes(useEditorStore.getState().scenes)).sort(); })()`);
  assert.deepEqual(zones, ['cinder-keep', 'ember-meadow', 'thornwood'], 'every scene carries its zone marker');
  assert.equal(await editor(`s.scenes.find(scene => scene.id === s.activeSceneId).name`), 'Ember Meadow', 'the hub opens first');

  // Play: the login vista autoplays behind the login card with its title cards.
  await app.evaluate(`(async () => { const {useEditorStore} = await import('/src/store/editorStore.ts'); useEditorStore.getState().setPlaying(true); })()`);
  await app.waitFor(`document.querySelector('.titan-login-card')`, { label: 'Sunlit Reach login' });
  assert.ok(await editor(`Boolean(s.runtimeCinematic)`), 'the login vista cinematic autoplays');
  assert.ok((await editor(`s.scenes.find(scene => scene.id === s.activeSceneId).cinematics.find(c => c.autoplay).duration`)) > 8, 'the hub vista is a long sequence');
  const vista = await editor(`s.scenes.find(scene => scene.id === s.activeSceneId).cinematics.find(c => c.autoplay)`);
  assert.ok(vista.actions.some(a => a.type === 'text' && a.text === 'THE SUNLIT REACH' && a.textStyle === 'title'), 'the vista carries the title card');
  assert.ok(vista.actions.some(a => a.type === 'camera' && (a.keyframes?.length ?? 0) >= 6), 'the vista flies a multi-keyframe camera path');
  // Headless software rendering ticks the runtime far below real time, so wait for the vista to be driving
  // the camera and advancing, not for a specific title-card window.
  await app.waitFor(`Boolean(window.__feather.editor.getState().runtimeCinematicCamera) && (window.__feather.editor.getState().runtimeCinematic?.time ?? 0) > 0.2`, { label: 'the vista drives the camera and advances', timeout: 90000 });
  const card = await editor(`(s.runtimeCinematicText ?? []).map(t => t.text).join(' | ')`);
  console.log('Vista card on screen:', card || '(between beats)', 'at t =', await editor(`Math.round((s.runtimeCinematic?.time ?? 0) * 10) / 10`));
  await shot('login-vista');
  assert.equal(await app.count('.titan-class-option'), 3, 'three classes are offered');
  await app.realClick('.titan-class-option:nth-child(3)'); // Mage: ranged, so the quest fight is quick
  await app.realClick('.titan-primary');
  await app.waitFor(`document.querySelector('.titan-player')`, { label: 'solo gameplay HUD' });
  assert.equal(await editor(`Boolean(s.runtimeCinematic)`), false, 'entering the game ends the vista');
  assert.equal((await hero()).class, 'mage');
  assert.match(await app.text('.titan-location'), /Ember Meadow/);

  // Real keyboard walking helper (same approach as titan.mjs): intentions only, never coordinates.
  await app.evaluate(`window.__walk = async (x, z) => {
    const {useRealm, realmCommand} = await import('/src/titan/session.ts');
    const deadline = performance.now() + 20000;
    while (performance.now() < deadline) {
      const s = useRealm.getState().snapshot; const p = s.players.find(p => p.id === s.selfId);
      const dx = x - p.x, dz = z - p.z; if (Math.hypot(dx, dz) < .8) { realmCommand({type:'move', x:0, z:0}); return; }
      const len = Math.hypot(dx, dz); realmCommand({type:'move', x: dx/len, z: dz/len});
      await new Promise(r => setTimeout(r, 80));
    }
    throw new Error('Could not walk to ' + x + ',' + z);
  }`);
  const INTERACT = '.titan-actions button:nth-child(3)';
  await app.evaluate('window.__walk(0,-3)'); await app.realClick(INTERACT);
  await app.waitFor(`document.querySelector('.titan-quest').textContent.includes('Gather sun shards')`, { label: 'quest accepted' });
  for (const [x, z] of [[-6, -8], [6, -11], [2, -17]]) { await app.evaluate(`window.__walk(${x},${z})`); await app.realClick(INTERACT); }
  await app.evaluate(`(async () => {
    const {useRealm, realmCommand} = await import('/src/titan/session.ts');
    const start = performance.now();
    while (performance.now() - start < 30000) {
      const s = useRealm.getState().snapshot, p = s.players.find(p => p.id === s.selfId);
      if ((p.quests['light-in-the-meadow']?.progress?.[1] ?? 0) >= 2) return;
      const e = s.enemies.filter(e => e.health > 0).sort((a, b) => Math.hypot(a.x-p.x, a.z-p.z) - Math.hypot(b.x-p.x, b.z-p.z))[0];
      if (e && Math.hypot(e.x-p.x, e.z-p.z) > 7) await window.__walk(e.x, e.z + 6);
      realmCommand({type:'attack'}); realmCommand({type:'ability'}); if (p.health < 40) realmCommand({type:'potion'});
      await new Promise(r => setTimeout(r, 400));
    }
    throw new Error('Wisps were not defeated');
  })()`);
  await app.evaluate('window.__walk(0,-3)'); await app.realClick(INTERACT);
  await app.waitFor(`document.querySelector('.titan-quest').textContent.includes('CHAPTER COMPLETE')`, { label: 'chapter 1 complete' });
  const leveled = await hero();
  assert.ok(leveled.level >= 2, `the first chapter reaches level 2 (level ${leveled.level})`);
  await shot('chapter-complete');

  // Waystone travel: the server moves the hero; the client must switch to the Thornwood scene. Interact with a
  // real keypress, and never assume real-time pacing: headless software rendering can tick the runtime at
  // well under one frame per second, so the switch and its 5.5 s entry sweep are awaited by state, not by clock.
  const hubScene = await editor(`s.activeSceneId`);
  const key = async (code, k, vk) => { await app.page.call('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk }); await app.page.call('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }); };
  await app.evaluate('window.__walk(0,-22.5)');
  await key('KeyE', 'e', 69);
  await app.waitFor(`${heroZone} === 'thornwood'`, { label: 'server moved the hero to Thornwood', timeout: 15000 });
  await app.waitFor(`${sceneName} === 'Thornwood' && ${cinematicOn}`, { label: 'client switched to the Thornwood scene and its entry sweep autoplays', timeout: 60000 });
  assert.notEqual(await editor(`s.activeSceneId`), hubScene);
  assert.equal(await app.count('.titan-skip'), 1, 'gameplay panels yield to the sweep and offer Skip');
  assert.equal(await app.count('.titan-location'), 0, 'gameplay frames stay hidden while the sweep plays');
  await shot('thornwood-entry');
  await key('Escape', 'Escape', 27);
  await app.waitFor(`!${cinematicOn}`, { label: 'Esc skips the entry sweep', timeout: 15000 });
  await app.waitFor(`document.querySelectorAll('.titan-actions button').length >= 6`, { label: 'gameplay HUD is back after the sweep' });
  assert.match(await app.text('.titan-location'), /Thornwood/, 'the HUD names the new zone');
  await shot('thornwood-gameplay');
  await app.realClick('.titan-actions button:nth-child(6)');
  await app.waitFor(`document.querySelector('.titan-notice').textContent.includes('saved')`, { label: 'progress saved in Thornwood' });
  assert.deepEqual(await app.evaluate('window.__sunlitErrors'), []);
  console.log('PASS: Sunlit Reach installs three zone scenes, autoplays the login vista, offers classes, completes chapter 1, travels through the waystone into Thornwood with its entry cinematic (skippable), and saves. Screenshots: artifacts/sunlit-reach/');
} finally {
  await app.dispose();
}
