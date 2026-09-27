import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, CircleHelp, Coins, FastForward, Flag, Heart, Leaf, Maximize2, Pause, Play, RotateCcw, Shield, Sparkles, Volume2, VolumeX, X } from 'lucide-react';
import { TOWER_DEFS, towerStats, type TowerKind } from './game';
import { useTowerDefenseActive } from './settings';
import { gardenSound, improveDefender, openGarden, selectDefender, sellDefender, sendWave, toggleGardenPause, useGarden } from './session';
import './towerDefense.css';

const KINDS: TowerKind[] = ['seed', 'frost', 'cannon'];
const LABELS: Record<TowerKind, string> = { seed: 'Quick little sharpshooter', frost: 'Chills the incoming crowd', cannon: 'A big splash of trouble' };

export function DefenderIcon({ kind }: { kind: TowerKind }) {
  const color = kind === 'seed' ? '#96c676' : kind === 'frost' ? '#8bd4df' : '#ecb174';
  return <svg viewBox="0 0 80 80" aria-hidden="true" className="sw-defender-icon">
    <ellipse cx="40" cy="72" rx="25" ry="5" fill="#244f4220" />
    <path d="M40 64V38M39 62C22 63 18 51 19 50c13-2 20 6 20 12m2-5c5-12 17-13 20-10-2 10-13 14-20 10" fill="#79a879" stroke="#53775b" strokeWidth="3" strokeLinecap="round" />
    {kind === 'frost' && <path d="M40 5l8 11 14-4-2 15 13 9-13 8 2 14-14-3-8 12-8-12-14 3 2-14-13-8 13-9-2-15 14 4z" fill="#d7f0ec" stroke="#6fbbc7" strokeWidth="2" />}
    <ellipse cx="40" cy="35" rx="24" ry="23" fill={color} stroke={kind === 'cannon' ? '#bc8255' : '#669b71'} strokeWidth="2.5" />
    {kind === 'cannon' && <><path d="M40 12C29 19 29 48 40 58M40 12c11 7 11 36 0 46" fill="none" stroke="#cf9259" strokeWidth="2" /><path d="M40 12L44 4" stroke="#6c8d60" strokeWidth="5" strokeLinecap="round" /></>}
    {kind === 'seed' && <path d="M39 12C23 12 22 1 26 2c11 0 17 5 13 10" fill="#79a879" />}
    <ellipse cx="32" cy="32" rx="3" ry="4" fill="#30483e" /><ellipse cx="49" cy="32" rx="3" ry="4" fill="#30483e" />
    <circle cx="26" cy="40" r="4" fill="#edb1a4" opacity=".7" /><circle cx="56" cy="40" r="4" fill="#edb1a4" opacity=".7" />
    {kind === 'frost' ? <path d="M36 42q5 5 10 0" fill="none" stroke="#30483e" strokeWidth="2" strokeLinecap="round" /> : <><ellipse cx="41" cy="44" rx="10" ry="9" fill={color} stroke="#6b8257" strokeWidth="2" /><ellipse cx="43" cy="44" rx="5" ry="5" fill="#526342" /></>}
  </svg>;
}

export function TowerDefenseHUD() {
  const active = useTowerDefenseActive();
  return active ? <GardenHUD /> : null;
}

function GardenHUD() {
  const s = useGarden();
  const { game, started, paused, selectedPlot, selectedKind } = s;
  const [help, setHelp] = useState(false);
  const priorPause = useRef(false);
  const selected = game.towers.find(t => t.plotId === selectedPlot);
  const terminal = game.phase === 'won' || game.phase === 'lost';
  const building = game.phase === 'build';
  const waveSize = 6 + game.wave * 2;
  const remaining = game.enemies.length + game.spawnRemaining;
  const begin = () => { useGarden.setState({ started: true, paused: false }); gardenSound('build'); };
  const restart = () => { openGarden(game.map.seed, true); setHelp(false); gardenSound('build'); };
  const showHelp = () => { priorPause.current = useGarden.getState().paused; useGarden.setState({ paused: true }); setHelp(true); };
  const closeHelp = () => { setHelp(false); useGarden.setState({ paused: priorPause.current }); };
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || (event.target instanceof HTMLElement && (event.target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)))) return;
      if (!useGarden.getState().started || help) return;
      if (['Digit1', 'Digit2', 'Digit3'].includes(event.code)) selectDefender(KINDS[Number(event.code.slice(-1)) - 1]);
      // Preserve native keyboard activation for focused Resume/Replay and other UI controls.
      if (event.code === 'Space' && !(event.target instanceof Element && event.target.closest('button, a, [role="button"]'))) { event.preventDefault(); sendWave(); }
      if (event.code === 'KeyP') { event.preventDefault(); toggleGardenPause(); }
    };
    const blur = () => { if (useGarden.getState().started && useGarden.getState().game.phase === 'wave') useGarden.setState({ paused: true }); };
    const visibility = () => { if (document.hidden) blur(); };
    window.addEventListener('keydown', handle);
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', visibility);
    return () => { window.removeEventListener('keydown', handle); window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', visibility); };
  }, [help]);

  return <div className="sproutwatch-hud" data-phase={game.phase} data-enemies={game.enemies.length} data-elapsed={game.elapsed.toFixed(3)} data-paused={paused}>
    <header className="sw-topbar">
      <div className="sw-brand"><span className="sw-brand-mark"><Leaf size={23} strokeWidth={2.3} /></span><div><strong>sproutwatch<span>TD</span></strong><small>A LITTLE GARDEN. A BIG LAST STAND.</small></div></div>
      {started && <div className="sw-stats"><div className="sw-stat sw-money"><Coins size={20} /><strong data-testid="garden-coins">{game.coins}</strong><span>sun coins</span></div><div className="sw-stat sw-lives"><Heart size={19} fill="currentColor" /><strong data-testid="garden-lives">{game.lives}</strong><span>garden health</span></div></div>}
      <div className="sw-tools">
        <button title="How to play" aria-label="How to play" onClick={showHelp}><CircleHelp size={19} /></button>
        <button title={s.muted ? 'Enable sound' : 'Mute sound'} aria-label={s.muted ? 'Enable sound' : 'Mute sound'} onClick={() => { useGarden.setState({ muted: !s.muted }); if (s.muted) gardenSound('build'); }}>{s.muted ? <VolumeX size={19} /> : <Volume2 size={19} />}</button>
        <button className="sw-fullscreen" title="Fullscreen" aria-label="Fullscreen" onClick={event => { const host = event.currentTarget.closest('.sproutwatch-hud')?.parentElement; if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}); else if (host?.requestFullscreen) void host.requestFullscreen().catch(() => {}); }}><Maximize2 size={18} /></button>
        {started && <button title="Pause (P)" aria-label={paused ? 'Resume game' : 'Pause game'} disabled={terminal} onClick={toggleGardenPause}>{paused ? <Play size={18} /> : <Pause size={18} />}</button>}
      </div>
    </header>

    {started && <section className="sw-wave-track" aria-label="Wave progress"><span><Flag size={13} /> WAVE {String(Math.max(1, game.wave)).padStart(2, '0')} <em>/ 10</em></span><div className="sw-wave-dots">{Array.from({ length: 10 }, (_, i) => <i key={i} className={i < game.wave - (building || game.phase === 'won' ? 0 : 1) ? 'cleared' : i === game.wave - 1 ? 'current' : ''} />)}</div><small>{building ? game.wave === 0 ? 'Make yourself at home' : 'A little room to grow' : terminal ? 'Garden report' : `${remaining} zombies remaining`}</small></section>}

    {!started && !help && <div className="sw-intro-wrap"><section className="sw-intro sw-panel">
      <div className="sw-eyebrow"><span /> COZY STRATEGY. NOT-SO-COZY NEIGHBORS.</div>
      <div className="sw-intro-icons"><DefenderIcon kind="seed" /><DefenderIcon kind="frost" /><DefenderIcon kind="cannon" /></div>
      <h1>Small sprouts.<br /><span>Big defenders.</span></h1>
      <p>The sleepy zombies next door are after your garden. Plant a little courage and keep your mushroom home safe.</p>
      <div className="sw-intro-features"><span><Shield size={15} /> 3 mighty defenders</span><span><Flag size={15} /> 10 lively waves</span></div>
      <button className="sw-primary" onClick={begin}>Let’s grow! <ArrowRight size={19} /></button>
      <small className="sw-intro-hint">Pick a defender. Plant it on a pad. Protect the garden.</small>
    </section><div className="sw-postcard"><Leaf size={15} /><span>GARDEN OUTPOST<small>Hand-grown from seed {game.map.seed}</small></span></div></div>}

    {started && !terminal && <>
      {selected && !paused && <aside className="sw-upgrade sw-panel" aria-label="Selected defender"><button className="sw-dismiss" aria-label="Close defender details" onClick={() => useGarden.setState({ selectedPlot: null })}><X size={15} /></button><div className="sw-upgrade-title"><DefenderIcon kind={selected.kind} /><div><small>PAD {selected.plotId} · LEVEL {selected.level}</small><h3>{TOWER_DEFS[selected.kind].name}</h3><span>{selected.level === 3 ? 'Fully grown!' : 'A little more growing room.'}</span></div></div><div className="sw-tower-stats"><span><b>{Math.round(towerStats(selected.kind, selected.level).damage)}</b> damage</span><span><b>{towerStats(selected.kind, selected.level).range.toFixed(1)}</b> range</span></div><button className="sw-primary" disabled={!building || selected.level >= 3 || game.coins < TOWER_DEFS[selected.kind].upgradeCosts[selected.level - 1]} onClick={improveDefender}>{selected.level === 3 ? <><Check size={16} /> Fully upgraded</> : <><Sparkles size={16} /> Upgrade <span>☀ {TOWER_DEFS[selected.kind].upgradeCosts[selected.level - 1]}</span></>}</button><button className="sw-sell" disabled={!building} onClick={sellDefender}>Sell for {Math.floor(selected.invested * 0.7)} coins</button></aside>}
      <div className="sw-bottom">
        <div className="sw-notice" role="status" aria-live="polite"><Leaf size={14} />{s.notice}</div>
        <div className="sw-build-bar sw-panel"><div className="sw-defenders">{KINDS.map((kind, i) => <button key={kind} className={`sw-defender-card ${selectedKind === kind ? 'selected' : ''}`} aria-label={`Select ${TOWER_DEFS[kind].name}`} aria-pressed={selectedKind === kind} disabled={!building || paused} onClick={() => selectDefender(kind)}><span className="sw-key">{i + 1}</span><DefenderIcon kind={kind} /><span className="sw-defender-info"><strong>{TOWER_DEFS[kind].name}</strong><small>{LABELS[kind]}</small><b className={game.coins < TOWER_DEFS[kind].cost ? 'sw-unaffordable' : ''}><Coins size={12} /> {TOWER_DEFS[kind].cost}</b></span></button>)}</div><div className="sw-wave-actions"><div className="sw-wave-caption"><span>{building ? 'READY WHEN YOU ARE' : 'THE GARDEN IS COUNTING ON YOU'}</span><button aria-label={`Game speed ${s.speed}x`} title="Toggle game speed" onClick={() => useGarden.setState({ speed: s.speed === 1 ? 2 : 1 })}><FastForward size={13} />{s.speed}×</button></div><button className="sw-primary sw-send" disabled={!building || paused} onClick={sendWave}>{building ? <>Send wave {game.wave + 1}<ArrowRight size={17} /></> : <><Shield size={17} /> Defending…</>}</button><small>{building ? 'SPACE TO SEND · P TO PAUSE' : 'BUILD & UPGRADE BETWEEN WAVES'}</small>{!building && <div className="sw-wave-progress"><i style={{ width: `${100 * (1 - remaining / waveSize)}%` }} /></div>}</div></div>
      </div>
    </>}

    {(help || (paused && started) || terminal) && <div className="sw-modal-shade"><section className="sw-modal sw-panel" role="dialog" aria-modal="true" aria-labelledby="sw-modal-title">
      {help ? <><span className="sw-modal-symbol"><Leaf size={30} /></span><div className="sw-eyebrow">A FIELD GUIDE FOR LITTLE HEROES</div><h2 id="sw-modal-title">Let it grow.</h2><ol className="sw-instructions"><li><b>Pick your plants.</b> Pea Sprouts fire quickly, Snowdrops slow zombies, and Pumpkin Mortars hit a whole crowd.</li><li><b>Find a good spot.</b> Choose a defender below, then click a numbered pad near the path. You start with 260 coins.</li><li><b>Hold your ground.</b> Send a wave and earn coins for every zombie you stop. Build and upgrade between waves.</li><li><b>Keep growing.</b> Click a planted defender to upgrade or sell it. Survive all 10 waves with garden health remaining.</li></ol><div className="sw-help-keys">1 / 2 / 3 select · Space sends a wave · P pauses</div><button className="sw-primary" autoFocus onClick={closeHelp}>Got it. Let’s grow! <Check size={17} /></button></> : terminal ? <><span className={`sw-modal-symbol ${game.phase === 'lost' ? 'sw-sad' : ''}`}>{game.phase === 'won' ? <Sparkles size={32} /> : <Leaf size={32} />}</span><div className="sw-eyebrow">{game.phase === 'won' ? 'A LITTLE COURAGE GOES A LONG WAY' : 'EVERY GARDENER STARTS SOMEWHERE'}</div><h2 id="sw-modal-title">{game.phase === 'won' ? 'Garden saved!' : 'Oh, compost.'}</h2><p>{game.phase === 'won' ? 'Ten waves, three little plants, and one very happy garden. You did it.' : 'The neighbors got a little too comfortable. Try mixing Snowdrops with your damage dealers.'}</p><div className="sw-results"><span><b>{game.wave}/10</b> waves</span><span><b>{game.kills}</b> zombies stopped</span><span><b>{game.lives}</b> health left</span></div><button className="sw-primary" autoFocus onClick={restart}><RotateCcw size={17} /> Grow again</button></> : <><span className="sw-modal-symbol"><Pause size={30} /></span><div className="sw-eyebrow">EVEN HEROES NEED A TEA BREAK</div><h2 id="sw-modal-title">Take a breather.</h2><p>Your sprouts are right where you left them.</p><button className="sw-primary" autoFocus onClick={toggleGardenPause}><Play size={17} /> Back to the garden</button><button className="sw-secondary" onClick={restart}><RotateCcw size={15} /> Restart this garden</button></>}
    </section></div>}
    {!started && <span className="sw-edition">SPROUTWATCH · GARDEN DEFENSE · 01</span>}
  </div>;
}
