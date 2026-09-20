/** Opt-in real Titan test. Credentials and guest tokens stay in a private file outside the repo.
 * TITAN_E2E_CREDENTIALS=/private/path.json FEATHER_E2E_ANGLE=metal node scripts/e2e/titan-live.mjs
 * JSON: { baseUrl, gameKey }. Creates/reuses two anonymous test players in that project.
 */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import WebSocket from 'ws';
import { openEditor } from './harness.mjs';

const credentialsPath = process.env.TITAN_E2E_CREDENTIALS;
assert.ok(credentialsPath, 'Set TITAN_E2E_CREDENTIALS to a private JSON file containing baseUrl and gameKey.');
const credentials = JSON.parse(await readFile(credentialsPath, 'utf8'));
assert.ok(credentials.baseUrl && credentials.gameKey, 'The private credentials file needs baseUrl and gameKey.');
const sessionsPath = `${credentialsPath}.sessions`;
let sessions = {}; try { sessions = JSON.parse(await readFile(sessionsPath, 'utf8')); } catch {}
const keepSessions = () => writeFile(sessionsPath, JSON.stringify(sessions), { mode: 0o600 });
const baseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:17430';
const app = await openEditor({ baseUrl, query: '?demo=store', width: 1440, height: 1100, timeoutMs: 90000 });
let peer;
const checks = [];
const pass = text => { checks.push(text); console.log(`PASS: ${text}`); };
const fill = (selector, value) => app.evaluate(`(() => {const input=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
const click = async selector => { if (!await app.boxOf(selector)) await app.evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'nearest'})`); await app.realClick(selector); };
const hero = () => app.evaluate(`(async()=>{const {useRealm}=await import('/src/titan/session.ts');const s=useRealm.getState().snapshot;return s?.players.find(p=>p.id===s.selfId);})()`);
const bridge = async action => app.evaluate(`(async()=>{const r=await fetch('/__feather/titan-realm',${action ? `{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:${JSON.stringify(action)}})}` : '{}'});return r.json();})()`);
const waitAsync = async (expression, label) => {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) { if (await app.evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 250)); }
  throw new Error(`Timed out: ${label}`);
};
try {
  await mkdir('artifacts/titan', { recursive: true });
  await app.evaluate(`window.__titanErrors=[];window.addEventListener('error',event=>window.__titanErrors.push(event.message));`);
  // Open the store, then install both packages through their visible buttons.
  await app.evaluate(`(async()=>{const {focusWorkspacePanel}=await import('/src/components/workspacePanels.ts');focusWorkspacePanel('store');})()`);
  await app.waitFor(`document.querySelector('input[aria-label="Search the asset store"]')`);
  await fill('input[aria-label="Search the asset store"]', 'Ember Meadow');
  await app.waitFor(`document.querySelector('.store-install-button[title^="Create a new project from Ember Meadow"]')`);
  await click('.store-install-button[title^="Create a new project from Ember Meadow"]');
  await app.waitFor(`document.querySelector('.confirm-dialog__confirm')`);
  await click('.confirm-dialog__confirm');
  await waitAsync(`(async()=>{const {useEditorStore}=await import('/src/store/editorStore.ts');const {useMarketplaceStore}=await import('/src/store/marketplaceStore.ts');return !useMarketplaceStore.getState().installingId&&useEditorStore.getState().scenes.some(s=>s.name==='Ember Meadow');})()`, 'starter installed');
  await app.evaluate(`(async()=>{const {focusWorkspacePanel}=await import('/src/components/workspacePanels.ts');focusWorkspacePanel('store');})()`);
  await fill('input[aria-label="Search the asset store"]', 'Titan');
  await app.waitFor(`document.querySelector('.store-install-button[title^="Install Titan"]')`);
  await click('.store-install-button[title^="Install Titan"]');
  await app.waitFor(`document.querySelector('.titan-wizard')`, { label: 'setup opened automatically after plugin installation' });
  pass('Store installation opens the in-engine Titan setup automatically');
  await click('.titan-account-options button:nth-child(2)');
  await fill('.titan-connection-fields input[type="url"]', credentials.baseUrl);
  await fill('.titan-key-field input', 'invalid-e2e-key');
  await click('.titan-wizard-primary');
  await app.waitFor(`document.querySelector('.titan-wizard-notice.error') && !document.querySelector('.titan-wizard-primary').disabled`, { label: 'real Titan rejects invalid key' });
  assert.equal(await app.evaluate(`(async()=>{const {useEditorStore}=await import('/src/store/editorStore.ts');const {readTitanSettings}=await import('/src/titan/settings.ts');return readTitanSettings(useEditorStore.getState().variables).gameKey;})()`), '');
  await fill('.titan-key-field input', credentials.gameKey);
  await click('.titan-wizard-primary');
  await app.waitFor(`document.querySelector('.titan-wizard-notice').textContent.includes('Titan connected.')`, { label: 'real Titan accepts supplied connection' });
  pass('Test & save rejects an invalid key and accepts the supplied live connection');
  await click('.titan-wizard-play');
  await app.waitFor(`document.querySelector('.titan-secondary')`, { label: 'Play starts realm and opens login' });
  const realm = await bridge();
  assert.equal(realm.authMode, 'titan'); assert.ok(realm.running);
  pass('Play starts the configured realm automatically without a manual server step');
  const sessionKey = `feather.titan.realm.local.${realm.storageId}`;
  if (sessions.player) await app.evaluate(`localStorage.setItem(${JSON.stringify(sessionKey)},${JSON.stringify(sessions.player)})`);
  await fill('.titan-login-card input[autocomplete="nickname"]', 'Feather E2E Hero');
  await click('.titan-secondary');
  await app.waitFor(`document.querySelector('.titan-location')?.textContent.includes('Realm online')`, { label: 'live guest authentication and WebSocket join' });
  sessions.player = await app.evaluate(`localStorage.getItem(${JSON.stringify(sessionKey)})`); await keepSessions();
  const firstId = (await hero()).id;
  pass('Real Titan guest authentication joins the authoritative realm');
  const authResponse = await fetch(`${realm.url}/auth`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: baseUrl }, body: JSON.stringify({ mode: 'guest', name: 'Feather E2E Peer', resume: sessions.peer }) });
  assert.equal(authResponse.status, 200, 'Second test guest authentication succeeds');
  const auth = await authResponse.json(); sessions.peer = auth.resume; await keepSessions();
  peer = new WebSocket(`${realm.url.replace('http:', 'ws:')}/realm`, { headers: { Origin: baseUrl } });
  let peerSnapshot;
  peer.on('message', bytes => { const message = JSON.parse(bytes.toString()); if (message.type === 'snapshot') peerSnapshot = message.data; });
  await new Promise((resolve, reject) => { peer.once('open', resolve); peer.once('error', reject); });
  peer.send(JSON.stringify({ type: 'join', ticket: auth.ticket }));
  await app.waitFor(`document.querySelector('.titan-location')?.textContent.includes('2 adventurers')`);
  assert.equal(peerSnapshot.players.length, 2);
  const peerId = peerSnapshot.selfId;
  const peerBefore = peerSnapshot.players.find(p => p.id === peerId).x;
  peer.send(JSON.stringify({ type: 'move', x: 1, z: 0 }));
  await waitAsync(`(async()=>{const {useRealm}=await import('/src/titan/session.ts');return useRealm.getState().snapshot.players.find(p=>p.id===${JSON.stringify(peerId)}).x>${peerBefore + 1};})()`, 'second player movement reaches first player');
  peer.send(JSON.stringify({ type: 'move', x: 0, z: 0 }));
  pass('Two independent Titan players share positions in the same realm');
  await app.evaluate(`window.__titanWalk=async(x,z)=>{
    const {useRealm}=await import('/src/titan/session.ts');const pressed=new Set();const deadline=performance.now()+20000;let attack=0;
    const key=(code,down)=>document.body.dispatchEvent(new KeyboardEvent(down?'keydown':'keyup',{code,bubbles:true}));
    try{while(performance.now()<deadline){const s=useRealm.getState().snapshot;const p=s.players.find(p=>p.id===s.selfId);const dx=x-p.x,dz=z-p.z;if(Math.hypot(dx,dz)<.7)return;
      const needed=new Set([...(Math.abs(dx)>.35?[dx>0?'KeyD':'KeyA']:[]),...(Math.abs(dz)>.35?[dz>0?'KeyS':'KeyW']:[])]);
      for(const c of pressed)if(!needed.has(c)){key(c,false);pressed.delete(c);}for(const c of needed)if(!pressed.has(c)){key(c,true);pressed.add(c);}
      if(performance.now()-attack>650){key('Space',true);key('Space',false);attack=performance.now();if(p.health<55){key('Digit2',true);key('Digit2',false);}}
      await new Promise(r=>setTimeout(r,100));}throw new Error('Walking timed out');}finally{for(const c of pressed)key(c,false);}
  }`);
  if ((await hero()).quest !== 'complete') {
    await app.evaluate('window.__titanWalk(0,-3)'); await click('.titan-actions button:nth-child(2)');
    await app.waitFor(`document.querySelector('.titan-quest')?.textContent.includes('Gather sun shards')`);
    for (const [x, z] of [[-6, -8], [6, -11], [2, -17]]) { await app.evaluate(`window.__titanWalk(${x},${z})`); await click('.titan-actions button:nth-child(2)'); }
    await app.evaluate(`(async()=>{const {useRealm,realmCommand}=await import('/src/titan/session.ts');const start=performance.now();while(performance.now()-start<25000){
      const s=useRealm.getState().snapshot,p=s.players.find(p=>p.id===s.selfId);if(p.kills>=2)return;
      const e=s.enemies.filter(e=>e.health>0).sort((a,b)=>Math.hypot(a.x-p.x,a.z-p.z)-Math.hypot(b.x-p.x,b.z-p.z))[0];
      if(e&&Math.hypot(e.x-p.x,e.z-p.z)>2.5)await window.__titanWalk(e.x,e.z);realmCommand({type:'attack'});if(p.health<55)realmCommand({type:'potion'});await new Promise(r=>setTimeout(r,650));}throw new Error('Combat timed out');})()`);
    await app.evaluate('window.__titanWalk(0,-3)'); await click('.titan-actions button:nth-child(2)');
  }
  await app.waitFor(`document.querySelector('.titan-quest').textContent.includes('CHAPTER COMPLETE')`);
  await click('.titan-actions button:nth-child(4)');
  await app.waitFor(`document.querySelector('.titan-bag')`);
  if ((await hero()).equipped !== 'warden-blade') await click('.titan-items article:nth-child(2) button');
  await app.waitFor(`document.querySelector('.titan-items article:nth-child(2)').textContent.includes('Equipped')`);
  pass('Quest gathering, combat, rewards and equipping earned equipment work online');
  await click('.titan-actions button:nth-child(5)');
  await app.waitFor(`document.querySelector('.titan-notice').textContent.includes('Titan cloud')`, { label: 'live cloud save' });
  const cloudResponse = await fetch(`${credentials.baseUrl.replace(/\/+$/, '').replace(/\/functions\/v1$/, '')}/functions/v1/game-saves/ember-meadow`, { headers: { 'X-Game-Key': credentials.gameKey, 'X-Player-Token': sessions.player, Authorization: `Bearer ${sessions.player}` } });
  assert.equal(cloudResponse.status, 200);
  const cloudBody = await cloudResponse.json(); const saved = typeof cloudBody.data === 'string' ? JSON.parse(cloudBody.data) : cloudBody.data;
  const completed = await hero();
  assert.equal(saved.quest, 'complete'); assert.equal(saved.equipped, completed.equipped); assert.equal(saved.gold, completed.gold); assert.ok(saved.kills >= 2);
  pass('Saved quest, gold and equipment read back from the real Titan cloud API');
  await click('.titan-menu'); await click('.titan-secondary');
  await app.waitFor(`document.querySelector('.titan-quest')?.textContent.includes('CHAPTER COMPLETE')`);
  assert.equal((await hero()).id, firstId);
  pass('Leaving and rejoining restores the same completed character');
  // Returning to setup and pressing Play must reuse the running realm, preserving peers.
  await click('.titan-menu'); await click('.titan-developer-setup');
  await click('.titan-setup-steps button:nth-child(2)'); await click('.titan-wizard-play');
  await app.waitFor(`document.querySelector('.titan-secondary')`);
  assert.equal((await bridge()).url, realm.url); assert.equal(peer.readyState, WebSocket.OPEN);
  await click('.titan-secondary'); await app.waitFor(`document.querySelector('.titan-location')?.textContent.includes('2 adventurers')`);
  pass('Reconnect and repeated Play preserve the character and other connected players');
  await new Promise(resolve => { peer.once('close', resolve); peer.close(); }); peer = undefined;
  await click('.titan-menu'); await click('.titan-developer-setup');
  await bridge('stop'); await click('.titan-setup-steps button:nth-child(2)'); await click('.titan-wizard-play');
  await app.waitFor(`document.querySelector('.titan-secondary')`);
  assert.equal((await bridge()).storageId, realm.storageId);
  await click('.titan-secondary'); await app.waitFor(`document.querySelector('.titan-quest')?.textContent.includes('CHAPTER COMPLETE')`);
  const restored = await hero(); assert.equal(restored.id, firstId); assert.equal(restored.equipped, completed.equipped); assert.equal(restored.gold, completed.gold);
  pass('Server restart restores the same Titan character, quest, gold and equipment');
  assert.deepEqual(await app.evaluate('window.__titanErrors'), []);
  await writeFile('artifacts/titan/live-report.json', JSON.stringify({ passed: true, checks, anonymousTestPlayers: 2, checkedAt: new Date().toISOString() }, null, 2));
} catch (error) {
  console.error('Live test failed:', error.message);
  try { await writeFile('artifacts/titan/live-failure.png', Buffer.from((await app.page.call('Page.captureScreenshot', { format: 'png' })).data, 'base64')); } catch {}
  throw error;
} finally {
  peer?.close(); await bridge('stop').catch(() => {}); await app.dispose();
}
