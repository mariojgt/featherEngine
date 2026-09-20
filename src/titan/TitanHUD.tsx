import { useEffect, useState } from 'react';
import { useEditorStore, selectActiveObjects } from '../store/editorStore';
import { ITEMS, type ItemId } from '../../examples/titan-mmo/server/world.mjs';
import { connectRealm, disconnectRealm, realmCommand, startSolo, useRealm } from './session';
import { isTitanScene, readTitanSettings } from './settings';
import './titan.css';
import { useTitanPreview } from './preview';
import { activeExportProfile } from '../project/exportProfiles';

export function useTitanActive() { return useEditorStore(s => s.isPlaying && isTitanScene(selectActiveObjects(s))); }
export function TitanHUD() {
  const active = useTitanActive();
  return active ? <RealmHUD /> : null;
}
function RealmHUD() {
  const { snapshot, status, mode, message } = useRealm();
  const [name, setName] = useState('Wayfarer');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authMode, setAuthMode] = useState<'guest' | 'login' | 'register'>('guest');
  const [bag, setBag] = useState(false);
  const variables = useEditorStore(s => s.variables);
  const settings = readTitanSettings(variables);
  const preview = useTitanPreview();
  const editor = import.meta.env.FEATHER_PLAYER !== true;
  const gameId = activeExportProfile(useEditorStore.getState().exportSettings).application.identifier;
  const local = editor && preview.running && preview.gameId === gameId;
  const online = local || settings.publishMode === 'online';
  const realmUrl = local ? preview.url! : settings.realmUrl;
  const titanAccounts = local ? preview.authMode === 'titan' : Boolean(settings.baseUrl);
  const solo = editor || settings.publishMode === 'practice';
  const hero = snapshot?.players.find(p => p.id === snapshot.selfId);
  const playing = status === 'playing' && hero;
  useEffect(() => () => disconnectRealm(), []);
  useEffect(() => {
    if (!playing) return;
    const keys = new Set<string>();
    const typing = (event: KeyboardEvent) => event.target instanceof HTMLElement && event.target.matches('input,textarea,select,[contenteditable="true"]');
    const down = (event: KeyboardEvent) => {
      if (typing(event)) return;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'Space', 'KeyE', 'KeyI', 'Digit1', 'Digit2'].includes(event.code)) { event.preventDefault(); event.stopPropagation(); }
      keys.add(event.code);
      if (event.repeat) return;
      if (event.code === 'KeyE') realmCommand({ type: 'interact' });
      if (event.code === 'Space' || event.code === 'Digit1') realmCommand({ type: 'attack' });
      if (event.code === 'Digit2') realmCommand({ type: 'potion' });
      if (event.code === 'KeyI') setBag(v => !v);
    };
    const up = (e: KeyboardEvent) => keys.delete(e.code);
    const clear = () => { keys.clear(); realmCommand({ type: 'move', x: 0, z: 0 }); };
    const visibility = () => { if (document.hidden) clear(); };
    window.addEventListener('keydown', down, true); window.addEventListener('keyup', up); window.addEventListener('blur', clear); document.addEventListener('visibilitychange', visibility);
    const tick = setInterval(() => realmCommand({ type: 'move',
      x: Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft')),
      z: Number(keys.has('KeyS') || keys.has('ArrowDown')) - Number(keys.has('KeyW') || keys.has('ArrowUp')) }), 100);
    return () => { clearInterval(tick); clear(); window.removeEventListener('keydown', down, true); window.removeEventListener('keyup', up); window.removeEventListener('blur', clear); document.removeEventListener('visibilitychange', visibility); };
  }, [Boolean(playing)]);
  const join = () => { const secret = password; setPassword(''); void connectRealm(realmUrl, { name, email, password: secret, mode: titanAccounts ? authMode : 'guest' }, local ? preview.storageId : undefined); };
  return <div className="titan-hud" data-testid="titan-hud">
    {!playing ? <div className="titan-login">
      <div className="titan-title"><span className="titan-eyebrow">{editor ? 'FEATHER × TITAN · GAME PREVIEW' : 'THE SUNLIT REACH'}</span><span className="titan-crest" aria-hidden>✧</span><h1>Ember<br /><em>Meadow</em></h1><p>A small world. The start of your adventure.</p><div className="titan-features"><span>Explore together</span><span>Earn your equipment</span><span>Keep your progress</span></div></div>
      <form className="titan-card titan-login-card" onSubmit={e => { e.preventDefault(); if (online) join(); else startSolo(name, gameId); }}>
        <span className="titan-eyebrow">YOUR ADVENTURE BEGINS HERE</span><h2>Enter the meadow</h2>
        <label>Character name<input value={name} onChange={e => setName(e.target.value)} maxLength={24} required autoComplete="nickname" /></label>
        {solo && <><button className="titan-primary" type="button" disabled={status === 'connecting' || !name.trim()} onClick={() => startSolo(name, gameId)}>{editor ? 'Play solo practice' : 'Begin adventure'} <span>→</span></button>
        <small>Progress is saved on this device.</small></>}
        {solo && online && <div className="titan-divider">OR JOIN YOUR REALM</div>}
        {online && <>
          {editor && <p className="titan-realm-ready">● {local ? 'Local realm ready' : 'Hosted realm configured'}</p>}
          {titanAccounts && <><label>Account<select value={authMode} onChange={e => setAuthMode(e.target.value as typeof authMode)}><option value="guest">Play as a guest</option><option value="login">Sign in</option><option value="register">Create an account</option></select></label>
          {authMode !== 'guest' && <><label>Email<input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></label><label>Password<input type="password" autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} minLength={6} maxLength={128} required value={password} onChange={e => setPassword(e.target.value)} /></label></>}</>}
          <button className="titan-secondary" disabled={status === 'connecting'}>{status === 'connecting' ? 'Connecting…' : editor ? 'Join realm' : authMode === 'register' && titanAccounts ? 'Create account & play' : 'Enter the meadow'} <span>↗</span></button>
          {status === 'connecting' && <button type="button" onClick={disconnectRealm}>Cancel connection</button>}
        </>}
        {editor && <button className="titan-developer-setup" type="button" onClick={() => window.dispatchEvent(new Event('feather:titan-setup'))}>Game setup · connection & publishing</button>}
        {message && <p role="alert" className="titan-error">{message}</p>}
      </form>
      <div className="titan-login-footer">EMBER MEADOW / CHAPTER 01 <span>The Sunlit Reach</span></div>
    </div> : <>
      <header className="titan-top"><div className="titan-card titan-player"><div className="titan-avatar">{hero.name.slice(0, 1).toUpperCase()}</div><div><strong>{hero.name}</strong><small>Level {1 + Math.floor(hero.xp / 100)} · Meadow Warden</small><div className="titan-health" role="meter" aria-label="Health" aria-valuenow={Math.round(hero.health)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${hero.health}%` }} /></div><small>{Math.round(hero.health)} / 100 HP · {hero.xp} XP</small></div></div><div className="titan-location"><span className="titan-eyebrow">THE SUNLIT REACH</span><strong>Ember Meadow</strong><small><i className="titan-online" /> {mode === 'solo' ? 'Solo practice' : `Realm online · ${snapshot!.players.length} adventurer${snapshot!.players.length === 1 ? '' : 's'}`}</small></div><button className="titan-menu" onClick={() => { disconnectRealm(); setBag(false); }}>Leave realm</button></header>
      <aside className="titan-card titan-quest"><span className="titan-eyebrow">{hero.quest === 'complete' ? 'CHAPTER COMPLETE' : 'STORY QUEST · LEVEL 1'}</span><h2>A light in the meadow</h2>{hero.quest === 'available' ? <p>Find Warden Elara beside the village beacon.<br /><strong>Approach and press E to talk.</strong></p> : <><p>Restore the beacon. Bring warmth back to the wilds.</p><div className={hero.gathered.length === 3 ? 'titan-done' : ''}>◆ Gather sun shards <b>{hero.gathered.length}/3</b></div><div className={hero.kills >= 2 ? 'titan-done' : ''}>⚔ Defeat wild wisps <b>{hero.kills}/2</b></div><div className={hero.quest === 'complete' ? 'titan-done' : ''}>✧ Return to Warden Elara</div></>}<footer>REWARD <span>50 gold · Warden’s blade</span></footer></aside>
      {bag && <section className="titan-card titan-bag" aria-label="Inventory"><div className="titan-bag-heading"><div><span className="titan-eyebrow">YOUR EQUIPMENT</span><h2>Wayfarer’s satchel</h2></div><button aria-label="Close inventory" onClick={() => setBag(false)}>×</button></div><p className="titan-gold">◈ {hero.gold} gold</p><div className="titan-items">{(Object.keys(ITEMS) as ItemId[]).filter(id => hero.inventory[id] > 0).map(id => <article key={id}><span className={`titan-item-icon ${ITEMS[id].rarity.toLowerCase()}`}>{ITEMS[id].icon}</span><div><strong>{ITEMS[id].name} <small>×{hero.inventory[id]}</small></strong><small>{ITEMS[id].description}</small></div>{ITEMS[id].damage ? <button disabled={hero.equipped === id} onClick={() => realmCommand({ type: 'equip', item: id })}>{hero.equipped === id ? 'Equipped' : 'Equip'}</button> : id === 'potion' ? <button onClick={() => realmCommand({ type: 'potion' })}>Use</button> : null}</article>)}</div><p className="titan-bag-note">{mode === 'solo' ? 'Practice inventory is saved on this device.' : 'Items and rewards are validated by the realm server.'}</p></section>}
      <div className="titan-bottom"><p className="titan-notice" role="status">{message || hero.message}</p><nav className="titan-actions" aria-label="Game actions"><button onClick={() => realmCommand({ type: 'attack' })}><kbd>1 / SPACE</kbd><span>⚔</span>Attack</button><button onClick={() => realmCommand({ type: 'interact' })}><kbd>E</kbd><span>✧</span>Interact</button><button onClick={() => realmCommand({ type: 'potion' })}><kbd>2</kbd><span>✚ <small>{hero.inventory.potion}</small></span>Tonic</button><button aria-pressed={bag} onClick={() => setBag(v => !v)}><kbd>I</kbd><span>▣</span>Inventory</button><button onClick={() => realmCommand({ type: 'save' })}><kbd>CHECKPOINT</kbd><span>↥</span>Save progress</button></nav><small className="titan-controls">WASD / ARROWS TO MOVE <span>·</span> E TO TALK & GATHER <span>·</span> SPACE TO ATTACK</small></div>
    </>}
  </div>;
}
