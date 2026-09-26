import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { openEditor } from './harness.mjs';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:17430';
// Action bar order: Attack, Ability, Interact, Tonic, Inventory, Save progress.
const INTERACT = '.titan-actions button:nth-child(3)';
const INVENTORY = '.titan-actions button:nth-child(5)';
const SAVE = '.titan-actions button:nth-child(6)';
const heroState = `(async () => {
  const {useRealm} = await import('/src/titan/session.ts');
  const s = useRealm.getState().snapshot; return s.players.find(p => p.id === s.selfId);
})()`;
const app = await openEditor({ baseUrl, query: '?demo=store', width: 1440, height: 960, timeoutMs: 90000 });
try {
  await app.evaluate(`window.__titanErrors = []; window.addEventListener('error', event => window.__titanErrors.push(event.message));`);
  await app.evaluate(`(async () => {
    const {useEditorStore} = await import('/src/store/editorStore.ts');
    const {useMarketplaceStore} = await import('/src/store/marketplaceStore.ts');
    const {extensionRegistry} = await import('/src/extensions/host.ts');
    useEditorStore.setState({isDirty: false});
    const store = useMarketplaceStore.getState(); await store.load();
    const plugin = useMarketplaceStore.getState().packages.find(p => p.pluginId === 'feather.titan');
    if (!plugin) throw new Error('Titan plugin listing missing'); await store.install(plugin);
    if (!extensionRegistry.hasPlugin('feather.titan')) throw new Error('Titan did not activate');
    const pack = useMarketplaceStore.getState().packages.find(p => p.slug === 'ember-meadow');
    await store.install(pack);
    if (!useEditorStore.getState().scenes.some(s => s.name === 'Ember Meadow')) throw new Error('Starter failed to install');
    useEditorStore.getState().setPlaying(true);
  })()`);
  await app.waitFor(`document.querySelector('.titan-login-card')`, { label: 'Ember Meadow login' });
  await mkdir('artifacts/titan', { recursive: true });
  await writeFile('artifacts/titan/login.png', Buffer.from((await app.page.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  assert.equal(await app.count('.titan-class-option'), 3, 'the login screen offers all three classes');
  assert.equal(await app.count('.titan-class-option[aria-pressed="true"]'), 1, 'exactly one class is selected by default');
  await app.realClick('.titan-primary');
  await app.waitFor(`document.querySelector('.titan-player')`, { label: 'solo gameplay HUD' });
  const before = await app.evaluate(`(async () => { const {useRealm} = await import('/src/titan/session.ts'); return useRealm.getState().snapshot.players[0].z; })()`);
  await app.page.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 });
  await app.waitFor(`document.querySelector('.titan-player') && performance.now() > 0`);
  await new Promise(resolve => setTimeout(resolve, 900));
  await app.page.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 });
  const after = await app.evaluate(`(async () => { const {useRealm} = await import('/src/titan/session.ts'); return useRealm.getState().snapshot.players[0].z; })()`);
  assert.ok(after < before - 2, 'real keyboard moves the server-simulated hero');
  await app.realClick(INTERACT);
  await app.waitFor(`document.querySelector('.titan-quest').textContent.includes('Gather sun shards')`, { label: 'quest accepted' });
  // Follow the quest through the actual HUD keyboard handlers. Never set coordinates or inventory.
  await app.evaluate(`window.__titanWalk = async (x, z) => {
    const {useRealm} = await import('/src/titan/session.ts');
    const pressed = new Set(); const deadline = performance.now() + 16000; let attack = 0;
    const key = (code, down) => document.body.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', {code, bubbles:true}));
    try { while (performance.now() < deadline) {
      const s = useRealm.getState().snapshot; const p = s.players.find(p => p.id === s.selfId);
      const dx=x-p.x, dz=z-p.z; if (Math.hypot(dx,dz)<.7) return;
      const needed=new Set([...(Math.abs(dx)>.35?[dx>0?'KeyD':'KeyA']:[]),...(Math.abs(dz)>.35?[dz>0?'KeyS':'KeyW']:[])]);
      for(const code of pressed) if(!needed.has(code)){key(code,false);pressed.delete(code);}
      for(const code of needed) if(!pressed.has(code)){key(code,true);pressed.add(code);}
      if(performance.now()-attack>650){key('Space',true);key('Space',false);attack=performance.now();if(p.health<55){key('Digit3',true);key('Digit3',false);}}
      await new Promise(r=>setTimeout(r,100));
    } throw new Error('Could not walk to '+x+','+z+' from '+JSON.stringify(useRealm.getState().snapshot.players[0])); }
    finally {for(const code of pressed) key(code,false);}
  }`);
  for (const [x, z] of [[-6, -8], [6, -11], [2, -17]]) {
    await app.evaluate(`window.__titanWalk(${x},${z})`);
    await app.realClick(INTERACT);
  }
  await app.evaluate(`(async () => {
    const {useRealm,realmCommand} = await import('/src/titan/session.ts');
    const start=performance.now();
    while(performance.now()-start<20000){
      const s=useRealm.getState().snapshot;const p=s.players.find(p=>p.id===s.selfId);
      if(p.quests['light-in-the-meadow']?.progress[1]>=2)return;
      const e=s.enemies.filter(e=>e.health>0).sort((a,b)=>Math.hypot(a.x-p.x,a.z-p.z)-Math.hypot(b.x-p.x,b.z-p.z))[0];
      if(Math.hypot(e.x-p.x,e.z-p.z)>2.5)await window.__titanWalk(e.x,e.z);
      realmCommand({type:'attack'});if(p.health<55)realmCommand({type:'potion'});
      await new Promise(r=>setTimeout(r,650));
    }throw new Error('Wisps were not defeated');
  })()`);
  await app.evaluate('window.__titanWalk(0,-3)');
  await app.realClick(INTERACT);
  await app.waitFor(`document.querySelector('.titan-quest').textContent.includes('CHAPTER COMPLETE')`, { label: 'quest reward earned' });
  await app.realClick(INVENTORY);
  await app.waitFor(`document.querySelector('.titan-bag')`, { label: 'inventory' });
  assert.match(await app.text('.titan-bag'), /Training blade/);
  // The satchel scrolls once equipment slots and quest items fill it; aim at the earned blade's row.
  await app.evaluate(`document.querySelector('.titan-items article:nth-child(2)').scrollIntoView({block:'center'})`);
  await app.realClick('.titan-items article:nth-child(2) button');
  await app.waitFor(`document.querySelector('.titan-items article:nth-child(2)').textContent.includes('Equipped')`, { label: 'earned blade equipped' });
  assert.equal((await app.evaluate(heroState)).equipped.weapon, 'warden-blade', 'the realm recorded the new weapon in its slot');
  await app.realClick(SAVE);
  await app.waitFor(`document.querySelector('.titan-notice').textContent.includes('saved')`, { label: 'practice saved' });
  const pixels = await app.pixelStats('canvas');
  console.log('Gameplay render:', pixels, await app.evaluate(`(async () => { const {useEditorStore} = await import('/src/store/editorStore.ts'); return useEditorStore.getState().renderSettings.quality; })()`));
  assert.ok(pixels.meanLuminance > 30, `The meadow must remain visible during gameplay: ${JSON.stringify(pixels)}`);
  await writeFile('artifacts/titan/gameplay.png', Buffer.from((await app.page.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await app.realClick('.titan-menu'); await app.realClick('.titan-primary');
  await app.waitFor(`document.querySelector('.titan-quest').textContent.includes('CHAPTER COMPLETE')`, { label: 'quest restored after reconnect' });
  await app.realClick('.titan-menu');
  assert.equal(await app.count('.titan-login-card input[type="url"]'), 0, 'Players never configure the realm address');
  await app.realClick('.titan-developer-setup');
  await app.waitFor(`document.querySelector('.titan-wizard')`, { label: 'in-engine connection wizard' });
  await writeFile('artifacts/titan/setup-connect.png', Buffer.from((await app.page.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await app.evaluate(`document.querySelector('.titan-wizard-primary').scrollIntoView({block:'center'})`);
  await app.realClick('.titan-wizard-primary');
  await app.waitFor(`document.querySelector('.titan-realm-card')`, { label: 'Test step' });
  await app.evaluate(`document.querySelector('.titan-wizard-primary').scrollIntoView({block:'center'})`);
  await app.realClick('.titan-wizard-primary');
  await app.waitFor(`document.querySelector('.titan-realm-card').textContent.includes('Local realm is running') && !document.querySelector('.titan-wizard-primary').disabled`, { label: 'realm started by setup UI' });
  await writeFile('artifacts/titan/setup-test.png', Buffer.from((await app.page.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await app.evaluate(`document.querySelector('.titan-wizard-play').scrollIntoView({block:'center'})`);
  await app.realClick('.titan-wizard-play');
  await app.waitFor(`document.querySelector('.titan-secondary')`, { label: 'configured realm login' });
  await app.realClick('.titan-secondary');
  await app.waitFor(`document.querySelector('.titan-location').textContent.includes('Realm online')`, { label: 'HTTP/WebSocket realm joined from login form' });
  await app.realClick(SAVE);
  await app.waitFor(`document.querySelector('.titan-notice').textContent.includes('saved to the realm')`, { label: 'online save' });
  assert.deepEqual(await app.evaluate('window.__titanErrors'), []);
  console.log('PASS: store install, full quest, equipment, save/return, guided setup, managed realm startup, login and server save. Screenshots: artifacts/titan/');
} finally {
  await app.evaluate(`fetch('/__feather/titan-realm', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'stop'})})`).catch(() => {});
  await app.dispose();
}
