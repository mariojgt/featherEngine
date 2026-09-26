import { useEffect, useRef, useState } from 'react';
import { useEditorStore, selectActiveObjects } from '../store/editorStore';
import {
  CLASSES, LEVEL_XP, MAX_LEVEL, ZONES, xpToNextLevel,
  type ClassId, type ZoneId,
} from '../../examples/titan-mmo/server/world.mjs';
import { connectRealm, disconnectRealm, realmCommand, startSolo, useRealm } from './session';
import { isTitanScene, readTitanSettings, titanZoneScenes, zoneOfScene, TITAN_HOME_ZONE } from './settings';
import './titan.css';
import { useTitanPreview } from './preview';
import { activeExportProfile } from '../project/exportProfiles';
import { TitanBag, TitanBossFrame, TitanClassPicker, TitanQuestTracker, TitanZoneTitle } from './hudPanels';
import { TitanChat } from './hudChat';
import { worldMoveDirection } from './runtimeCamera';

/** A hub's login vista runs long; a zone-entry sweep is short enough to simply watch. */
const LOGIN_VISTA_SECONDS = 8;
const ZONE_TITLE_MS = 3500;
const BOSS_FRAME_RANGE = 12;

export function useTitanActive() { return useEditorStore(s => s.isPlaying && isTitanScene(selectActiveObjects(s))); }
export function TitanHUD() {
  const active = useTitanActive();
  return active ? <RealmHUD /> : null;
}
function RealmHUD() {
  const { snapshot, status, mode, message } = useRealm();
  const [name, setName] = useState('Wayfarer');
  const [characterClass, setCharacterClass] = useState<ClassId>('warrior');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authMode, setAuthMode] = useState<'guest' | 'login' | 'register'>('guest');
  const [bag, setBag] = useState(false);
  const [questLog, setQuestLog] = useState(false);
  // Mirrored for the long-lived keyboard handler, which only re-binds when play starts or stops.
  const bagOpen = useRef(false); const questLogOpen = useRef(false);
  useEffect(() => { bagOpen.current = bag; questLogOpen.current = questLog; }, [bag, questLog]);
  const [zoneTitle, setZoneTitle] = useState(false);
  const chatInput = useRef<HTMLInputElement>(null);
  const pendingScene = useRef<string | undefined>(undefined);
  const variables = useEditorStore(s => s.variables);
  const activeSceneId = useEditorStore(s => s.activeSceneId);
  const cinematicId = useEditorStore(s => s.runtimeCinematic?.sequenceId);
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
  const zone = (snapshot?.zone ?? TITAN_HOME_ZONE) as ZoneId;
  const cinematic = Boolean(cinematicId);
  useEffect(() => () => disconnectRealm(), []);

  // --- Zone travel -------------------------------------------------------------------------------
  // The server owns which zone the hero stands in; the client answers by loading that zone's scene.
  useEffect(() => {
    if (!playing) { pendingScene.current = undefined; return; }
    const state = useEditorStore.getState();
    if (zoneOfScene(selectActiveObjects(state)) === zone) { pendingScene.current = undefined; return; }
    const sceneId = titanZoneScenes(state.scenes)[zone];
    if (!sceneId || pendingScene.current === sceneId) return;
    pendingScene.current = sceneId;
    state.requestSceneLoad(sceneId);
  }, [zone, activeSceneId, Boolean(playing)]);

  // A scene load restarts that scene's autoplay cinematic. Zone entries get a short sweep worth
  // watching; the hub's long login vista is not, so it is cut the moment the hero arrives.
  const firstScene = useRef(true);
  useEffect(() => {
    if (firstScene.current) { firstScene.current = false; return; }
    if (!playing) return;
    const state = useEditorStore.getState();
    const running = state.runtimeCinematic;
    if (!running) return;
    const sequence = state.scenes.find(scene => scene.id === state.activeSceneId)?.cinematics?.find(c => c.id === running.sequenceId);
    if ((sequence?.duration ?? 0) > LOGIN_VISTA_SECONDS) state.stopCinematic();
  }, [activeSceneId]);

  // Entering the game ends whatever vista was playing behind the login card.
  useEffect(() => { if (playing) useEditorStore.getState().stopCinematic(); }, [Boolean(playing)]);

  // Opening a shop is the vendor's answer to E, so the satchel comes up with it.
  useEffect(() => { if (hero?.vendor) setBag(true); }, [hero?.vendor]);

  // --- Zone banner -------------------------------------------------------------------------------
  useEffect(() => {
    if (!playing) { setZoneTitle(false); return; }
    setZoneTitle(true);
    const timer = setTimeout(() => setZoneTitle(false), ZONE_TITLE_MS);
    return () => clearTimeout(timer);
  }, [zone, Boolean(playing)]);

  // --- Controls ----------------------------------------------------------------------------------
  useEffect(() => {
    if (!playing) return;
    const keys = new Set<string>();
    const typing = (event: KeyboardEvent) => event.target instanceof HTMLElement && event.target.matches('input,textarea,select,[contenteditable="true"]');
    const held = (...codes: string[]) => (codes.some(code => keys.has(code)) ? 1 : 0);
    const down = (event: KeyboardEvent) => {
      if (typing(event)) return;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'Space', 'KeyE', 'KeyI', 'KeyL', 'Digit1', 'Digit2', 'Digit3', 'Enter'].includes(event.code)) { event.preventDefault(); event.stopPropagation(); }
      keys.add(event.code);
      if (event.repeat) return;
      if (event.code === 'Escape') {
        // Consume Esc while the game owns it (skip a sweep, close a panel) so the editor never sees it as
        // "leave Play"; with nothing to close it falls through to whatever the host binds.
        const state = useEditorStore.getState();
        if (state.runtimeCinematic) { event.preventDefault(); event.stopPropagation(); state.stopCinematic(); }
        else if (bagOpen.current || questLogOpen.current) { event.preventDefault(); event.stopPropagation(); setBag(false); setQuestLog(false); }
        return;
      }
      if (event.code === 'Enter') { chatInput.current?.focus(); return; }
      if (useEditorStore.getState().runtimeCinematic) return;
      if (event.code === 'KeyE') realmCommand({ type: 'interact' });
      if (event.code === 'Space' || event.code === 'Digit1') realmCommand({ type: 'attack' });
      if (event.code === 'Digit2') realmCommand({ type: 'ability' });
      if (event.code === 'Digit3') realmCommand({ type: 'potion' });
      if (event.code === 'KeyI') setBag(v => !v);
      if (event.code === 'KeyL') setQuestLog(v => !v);
    };
    const up = (e: KeyboardEvent) => keys.delete(e.code);
    const clear = () => { keys.clear(); realmCommand({ type: 'move', x: 0, z: 0 }); };
    const visibility = () => { if (document.hidden) clear(); };
    window.addEventListener('keydown', down, true); window.addEventListener('keyup', up); window.addEventListener('blur', clear); document.addEventListener('visibilitychange', visibility);
    // WASD is screen-relative: forward always means "away from the camera", so the held keys are
    // rotated into world space by the live orbit yaw before the intention is sent.
    const tick = setInterval(() => {
      if (useEditorStore.getState().runtimeCinematic) { realmCommand({ type: 'move', x: 0, z: 0 }); return; }
      const direction = worldMoveDirection(held('KeyW', 'ArrowUp') - held('KeyS', 'ArrowDown'), held('KeyD', 'ArrowRight') - held('KeyA', 'ArrowLeft'));
      realmCommand({ type: 'move', ...direction });
    }, 100);
    return () => { clearInterval(tick); clear(); window.removeEventListener('keydown', down, true); window.removeEventListener('keyup', up); window.removeEventListener('blur', clear); document.removeEventListener('visibilitychange', visibility); };
  }, [Boolean(playing)]);

  const buildZones = () => Object.keys(titanZoneScenes(useEditorStore.getState().scenes));
  const begin = () => startSolo(name, gameId, { class: characterClass, zones: buildZones() });
  const join = () => {
    const secret = password; setPassword('');
    void connectRealm(realmUrl, { name, email, password: secret, mode: titanAccounts ? authMode : 'guest' },
      local ? preview.storageId : undefined, { class: characterClass, zones: buildZones() });
  };

  if (!playing) return <div className="titan-hud" data-testid="titan-hud">
    <div className="titan-login" data-cinematic={cinematic ? 'true' : undefined}>
      <div className="titan-title"><span className="titan-eyebrow">{editor ? 'FEATHER × TITAN · GAME PREVIEW' : 'THE SUNLIT REACH'}</span><span className="titan-crest" aria-hidden>✧</span><h1>The Sunlit<br /><em>Reach</em></h1><p>Three zones, three classes. The start of your adventure.</p><div className="titan-features"><span>Explore together</span><span>Earn your equipment</span><span>Keep your progress</span></div></div>
      <form className="titan-card titan-login-card" onSubmit={e => { e.preventDefault(); if (online) join(); else begin(); }}>
        <span className="titan-eyebrow">YOUR ADVENTURE BEGINS HERE</span><h2>Enter the Reach</h2>
        <label>Character name<input value={name} onChange={e => setName(e.target.value)} maxLength={24} required autoComplete="nickname" /></label>
        <TitanClassPicker value={characterClass} onChange={setCharacterClass} />
        <small>Your class is saved with your character.</small>
        {solo && <><button className="titan-primary" type="button" disabled={status === 'connecting' || !name.trim()} onClick={begin}>{editor ? 'Play solo practice' : 'Begin adventure'} <span>→</span></button>
        <small>Progress is saved on this device.</small></>}
        {solo && online && <div className="titan-divider">OR JOIN YOUR REALM</div>}
        {online && <>
          {editor && <p className="titan-realm-ready">● {local ? 'Local realm ready' : 'Hosted realm configured'}</p>}
          {titanAccounts && <><label>Account<select value={authMode} onChange={e => setAuthMode(e.target.value as typeof authMode)}><option value="guest">Play as a guest</option><option value="login">Sign in</option><option value="register">Create an account</option></select></label>
          {authMode !== 'guest' && <><label>Email<input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></label><label>Password<input type="password" autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} minLength={6} maxLength={128} required value={password} onChange={e => setPassword(e.target.value)} /></label></>}</>}
          <button className="titan-secondary" disabled={status === 'connecting'}>{status === 'connecting' ? 'Connecting…' : editor ? 'Join realm' : authMode === 'register' && titanAccounts ? 'Create account & play' : 'Enter the Reach'} <span>↗</span></button>
          {status === 'connecting' && <button type="button" onClick={disconnectRealm}>Cancel connection</button>}
        </>}
        {editor && <button className="titan-developer-setup" type="button" onClick={() => window.dispatchEvent(new Event('feather:titan-setup'))}>Game setup · connection & publishing</button>}
        {message && <p role="alert" className="titan-error">{message}</p>}
      </form>
      <div className="titan-login-footer">{ZONES[zone].subtitle.toUpperCase()} <span>The Sunlit Reach</span></div>
    </div>
  </div>;

  if (cinematic) return <div className="titan-hud" data-testid="titan-hud">
    <button className="titan-skip" onClick={() => useEditorStore.getState().stopCinematic()}>Skip ▸ Esc</button>
  </div>;

  const cls = CLASSES[hero.class];
  const floor = LEVEL_XP[hero.level - 1] ?? 0;
  const ceiling = xpToNextLevel(hero.level);
  const maxLevel = hero.level >= MAX_LEVEL;
  const xpPercent = maxLevel ? 100 : Math.max(0, Math.min(100, ((hero.xp - floor) / Math.max(1, ceiling - floor)) * 100));
  const cooling = Math.max(0, cls.ability.cooldown - (snapshot!.time - hero.abilityAt));
  const vendor = hero.vendor ? ZONES[zone].npcs.find(npc => npc.id === hero.vendor) : undefined;
  const boss = snapshot!.enemies.find(enemy => enemy.boss && enemy.health > 0
    && (enemy.engaged > 0 || Math.hypot(enemy.x - hero.x, enemy.z - hero.z) < BOSS_FRAME_RANGE));

  return <div className="titan-hud" data-testid="titan-hud">
    <header className="titan-top">
      <div className="titan-card titan-player">
        <div className="titan-avatar">{cls.icon}</div>
        <div><strong>{hero.name}</strong><small>Level {hero.level} {cls.name}</small>
          <div className="titan-health" role="meter" aria-label="Health" aria-valuenow={Math.round(hero.health)} aria-valuemin={0} aria-valuemax={hero.maxHealth}><i style={{ width: `${(hero.health / hero.maxHealth) * 100}%` }} /></div>
          <div className="titan-xp" role="meter" aria-label="Experience" aria-valuenow={Math.round(xpPercent)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${xpPercent}%` }} /></div>
          <small>{Math.round(hero.health)} / {hero.maxHealth} HP · {maxLevel ? 'MAX' : `${hero.xp - floor} / ${ceiling - floor} XP`} · ◈ {hero.gold}</small>
        </div>
      </div>
      <div className="titan-location">
        <span className="titan-eyebrow">{ZONES[zone].subtitle.toUpperCase()}</span><strong>{ZONES[zone].name}</strong>
        <small><i className="titan-online" /> {mode === 'solo' ? 'Solo practice' : `Realm online · ${snapshot!.players.length} adventurer${snapshot!.players.length === 1 ? '' : 's'} here · ${snapshot!.online} online`}</small>
      </div>
      <button className="titan-menu" onClick={() => { disconnectRealm(); setBag(false); setQuestLog(false); }}>Leave realm</button>
    </header>
    {boss && <TitanBossFrame boss={boss} />}
    <TitanQuestTracker hero={hero} zone={zone} log={questLog} onToggleLog={() => setQuestLog(v => !v)} />
    {bag && <TitanBag hero={hero} solo={mode === 'solo'} vendor={vendor} onClose={() => setBag(false)} />}
    <TitanChat solo={mode === 'solo'} inputRef={chatInput} />
    {zoneTitle && <TitanZoneTitle zone={zone} />}
    <div className="titan-bottom">
      <p className="titan-notice" role="status">{message || hero.message}</p>
      <nav className="titan-actions" aria-label="Game actions">
        <button onClick={() => realmCommand({ type: 'attack' })}><kbd>1 / SPACE</kbd><span>⚔</span>{cls.basic.name}</button>
        <button className="titan-ability" disabled={cooling > 0} onClick={() => realmCommand({ type: 'ability' })}>
          <kbd>2</kbd><span>✸</span>{cls.ability.name}
          {cooling > 0 && <em className="titan-cooldown" style={{ height: `${(cooling / cls.ability.cooldown) * 100}%` }}><b>{cooling.toFixed(1)}s</b></em>}
        </button>
        <button onClick={() => realmCommand({ type: 'interact' })}><kbd>E</kbd><span>✧</span>Interact</button>
        <button onClick={() => realmCommand({ type: 'potion' })}><kbd>3</kbd><span>✚ <small>{hero.inventory.potion ?? 0}</small></span>Tonic</button>
        <button aria-pressed={bag} onClick={() => setBag(v => !v)}><kbd>I</kbd><span>▣</span>Inventory</button>
        <button onClick={() => realmCommand({ type: 'save' })}><kbd>CHECKPOINT</kbd><span>↥</span>Save progress</button>
      </nav>
      <small className="titan-controls">WASD / ARROWS TO MOVE <span>·</span> RIGHT-DRAG TO LOOK <span>·</span> WHEEL TO ZOOM <span>·</span> E TO TALK &amp; GATHER <span>·</span> ENTER TO CHAT</small>
    </div>
  </div>;
}
