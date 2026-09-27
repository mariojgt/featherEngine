/** Real store import, character creation, two independent players, chat, combat and reconnect. */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openEditor } from './harness.mjs';
import { startRealm } from '../../examples/titan-mmo/server/server.mjs';
const baseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:17439';
const artifacts = 'artifacts/sunlit-reach';
await mkdir(artifacts, { recursive: true });
const temp = await mkdtemp(join(tmpdir(), 'sunlit-browser-'));
const realm = await startRealm({ port: 0, dataFile: join(temp, 'players.json'), origins: new URL(baseUrl).origin });
const apps = [];
const realmUrl = `http://127.0.0.1:${realm.port}`;
const shot = async (app, name) => writeFile(`${artifacts}/${name}.png`, Buffer.from((await app.page.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
const self = `(() => { const s = window.__feather.realm.getState().snapshot; return s?.players.find(p => p.id === s.selfId); })()`;
const fill = async (app, selector, text) => {
  await app.realClick(selector);
  await app.evaluate(`document.querySelector(${JSON.stringify(selector)}).select()`);
  await app.page.call('Input.insertText', { text });
};
async function open(name, armor, headpiece) {
  console.log(`Opening ${name}'s editor`);
  const app = await openEditor({ baseUrl, query: '?demo=store', width: 1440, height: 1000, timeoutMs: 90000 }); apps.push(app);
  await app.evaluate(`window.__sunlitErrors = []; window.addEventListener('error', e => window.__sunlitErrors.push(e.message));`);
  await app.evaluate(`(async () => {
    const {useEditorStore} = await import('/src/store/editorStore.ts');
    const {useMarketplaceStore} = await import('/src/store/marketplaceStore.ts');
    window.__feather = {editor: useEditorStore, realm: (await import('/src/titan/session.ts')).useRealm};
    useEditorStore.setState({isDirty:false});
    const store = useMarketplaceStore.getState(); await store.load();
    const plugin = useMarketplaceStore.getState().packages.find(p => p.pluginId === 'feather.titan'); await store.install(plugin);
    const pack = useMarketplaceStore.getState().packages.find(p => p.slug === 'sunlit-reach'); await store.install(pack);
    useEditorStore.setState(s => ({variables:s.variables.map(v=>({...v,defaultValue:v.name==='TitanRealmURL'?${JSON.stringify(realmUrl)}:v.name==='TitanPublishMode'?'online':v.defaultValue}))}));
    useEditorStore.getState().setPlaying(true);
  })()`);
  console.log(`${name}'s package installed`);
  await app.waitFor(`document.querySelector('.titan-login-card')`, { label: 'character creator' });
  assert.deepEqual(await app.evaluate('window.__feather.editor.getState().scenes.map(s=>s.name)'), ['Sunlit Vale']);
  await fill(app, '.titan-login-card input[autocomplete="nickname"]', name);
  await app.realClick('.titan-class-option:nth-child(3)');
  await app.realClick(`[aria-label="${armor} armor"]`);
  await app.realClick(`[aria-label="${headpiece} headpiece"]`);
  await shot(app, `${name}-creator`);
  await app.evaluate(`document.querySelector('.titan-login-card').scrollTop = document.querySelector('.titan-login-card').scrollHeight`);
  await app.realClick('.titan-secondary');
  await app.waitFor(`document.querySelector('.titan-player')`, { label: 'online player' });
  const hero = await app.evaluate(self);
  assert.equal(hero.class, 'mage'); assert.equal(hero.appearance.armor, armor); assert.equal(hero.appearance.headpiece, headpiece);
  assert.equal(hero.zone, 'sunlit-valley');
  return app;
}
try {
  const a = await open('Aster', 'ember', 'crest');
  console.log('Aster joined with selected appearance');
  const b = await open('Rowan', 'moss', 'crown');
  console.log('Rowan joined with selected appearance');
  await a.waitFor('window.__feather.realm.getState().snapshot.players.length === 2', { label: 'second player visible' });
  assert.equal((await a.evaluate('window.__feather.realm.getState().snapshot.players.find(p=>p.name==="Rowan")')).appearance.armor, 'moss');
  // Separate the two newly spawned players so both appearances are visible.
  await b.evaluate('document.activeElement?.blur()');
  await b.page.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'd', code: 'KeyD', windowsVirtualKeyCode: 68 });
  await b.waitFor(`${self}.x > 2`, { label: 'second player moves aside', timeout: 10000 });
  await b.page.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'd', code: 'KeyD', windowsVirtualKeyCode: 68 });
  await shot(a, 'two-players');
  const chatSelector = '.titan-chat input';
  await fill(a, chatSelector, 'Meet me at the beacon.');
  await a.page.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await a.page.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await b.waitFor('window.__feather.realm.getState().chat.some(m=>m.text==="Meet me at the beacon.")', { label: 'realm chat received' });
  console.log('Two players exchanged chat');
  // Walk through gameplay intentions; the server computes every position, hit and reward.
  await a.evaluate('document.activeElement?.blur()');
  // The held-key controller sends neutral input when no keys are down. Use actual keys for the road.
  await a.page.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 });
  await a.waitFor(`${self}.z < 55.6`, { label: 'walk to Elara', timeout: 30000 });
  await a.page.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 });
  await a.realClick('.titan-actions button:nth-child(3)');
  await a.waitFor(`${self}.quests['light-in-the-meadow']?.state === 'active'`, { label: 'quest accepted' });
  console.log('Quest accepted through keyboard movement and interaction');
  // Move out of the village to the nearest wisp; keyboard keeps the normal controller active.
  await a.page.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 });
  await a.waitFor(`${self}.z < 29`, { label: 'reach combat clearing', timeout: 30000 });
  await a.page.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 });
  const before = await a.evaluate('window.__feather.realm.getState().snapshot.enemies.reduce((n,e)=>n+e.health,0)');
  await a.realClick('.titan-actions button:nth-child(1)');
  await a.waitFor(`window.__feather.realm.getState().snapshot.enemies.reduce((n,e)=>n+e.health,0)<${before}`, { label: 'server-authoritative attack' });
  await a.waitFor(`window.__feather.realm.getState().snapshot.enemies.some(e=>e.health>0 && Math.hypot(e.x-${self}.x,e.z-${self}.z)<4)`, { label: 'enemy approaches within skill range', timeout: 15000 });
  await a.realClick('.titan-actions button:nth-child(2)');
  await a.waitFor(`${self}.abilityAt > 0`, { label: 'class skill fired' });
  await shot(a, 'combat');
  console.log('Basic attack and class ability verified');
  await a.realClick('.titan-actions button:nth-child(6)');
  await a.waitFor('document.querySelector(".titan-notice").textContent.includes("saved")', { label: 'progress saved' });
  const savedHero = await a.evaluate(self);
  await a.realClick('.titan-menu');
  await a.waitFor('document.querySelector(".titan-login-card")', { label: 'return to character screen' });
  await a.realClick('[aria-label="gold armor"]');
  await a.evaluate(`document.querySelector('.titan-login-card').scrollTop = document.querySelector('.titan-login-card').scrollHeight`);
  await a.realClick('.titan-secondary');
  await a.waitFor('document.querySelector(".titan-player")', { label: 'reconnect' });
  const restored = await a.evaluate(self);
  assert.deepEqual(restored.appearance, savedHero.appearance); assert.deepEqual(restored.quests, savedHero.quests);
  assert.deepEqual(await a.evaluate('window.__sunlitErrors'), []); assert.deepEqual(await b.evaluate('window.__sunlitErrors'), []);
  await shot(a, 'reconnected');
  await writeFile(`${artifacts}/report.json`, JSON.stringify({ status: 'passed', features: ['store import', 'character creator', 'two players', 'chat', 'movement', 'quest', 'combat', 'class skill', 'save/reconnect'], errors: [] }, null, 2));
  console.log('PASS: character creation, two players, chat, terrain movement, quest, attack, skill and save/reconnect.');
} catch (error) {
  for (let i=0;i<apps.length;i++) await shot(apps[i], `failure-${i}`).catch(()=>{});
  throw error;
} finally { for (const app of apps) await app.dispose(); await realm.close(); await rm(temp,{recursive:true,force:true}); }
