import { create } from 'zustand';
import { createGame, placeTower, sellTower, startWave, stepGame, upgradeTower, type TowerKind } from './game';
import { DEFAULT_GARDEN_SEED } from './settings';

interface GardenSession {
  game: ReturnType<typeof createGame>;
  revision: number;
  started: boolean;
  paused: boolean;
  speed: 1 | 2;
  muted: boolean;
  selectedKind: TowerKind;
  selectedPlot: number | null;
  notice: string;
}
export const useGarden = create<GardenSession>(() => ({ game: createGame(DEFAULT_GARDEN_SEED), revision: 0, started: false, paused: false, speed: 1, muted: false, selectedKind: 'seed', selectedPlot: null, notice: 'Choose a defender, then click a numbered garden pad.' }));
let uiElapsed = 0;
let audio: AudioContext | undefined;
let lastPop = 0;
export function gardenSound(kind: 'build' | 'wave' | 'pop' | 'win' | 'leak') {
  if (useGarden.getState().muted) return;
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume().catch(() => {});
    if (kind === 'pop' && audio.currentTime - lastPop < 0.085) return;
    lastPop = audio.currentTime;
    const oscillator = audio.createOscillator(), gain = audio.createGain();
    const frequency = { build: 570, wave: 330, pop: 180, win: 880, leak: 100 }[kind];
    oscillator.type = kind === 'pop' ? 'triangle' : 'sine';
    oscillator.frequency.setValueAtTime(frequency, audio.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * (kind === 'leak' ? 0.45 : 1.5), audio.currentTime + 0.13);
    gain.gain.setValueAtTime(kind === 'pop' ? 0.018 : 0.055, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.2);
    oscillator.connect(gain); gain.connect(audio.destination);
    oscillator.start(); oscillator.stop(audio.currentTime + 0.21);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  } catch { /* Sound is optional on browsers without Web Audio. */ }
}
export function closeGardenAudio() { if (audio) void audio.close().catch(() => {}); audio = undefined; lastPop = 0; }
export function openGarden(seed: number, started = false) {
  uiElapsed = 0;
  useGarden.setState({ game: createGame(seed), revision: 0, started, paused: false, speed: 1, selectedKind: 'seed', selectedPlot: null, notice: 'Choose a defender, then click a numbered garden pad.' });
}
export function selectDefender(kind: TowerKind) { useGarden.setState({ selectedKind: kind, selectedPlot: null, notice: 'Click an empty numbered pad to plant your defender.' }); }
export function choosePlot(plotId: number) {
  const s = useGarden.getState();
  if (!s.started || s.paused || s.game.phase === 'won' || s.game.phase === 'lost') return;
  if (s.game.towers.some(t => t.plotId === plotId)) { useGarden.setState({ selectedPlot: plotId, notice: 'Upgrade your defender or sell it to rethink your strategy.' }); return; }
  if (s.game.phase !== 'build') { useGarden.setState({ notice: 'Your defenders are on watch. Build and upgrade between waves.' }); return; }
  const placed = placeTower(s.game, plotId, s.selectedKind);
  useGarden.setState({ selectedPlot: placed ? plotId : null, revision: s.revision + 1, notice: placed ? 'Looking good! Plant more defenders or send the next wave.' : 'You need more sun coins. Defeat zombies to earn them.' });
  if (placed) gardenSound('build');
}
export function improveDefender() {
  const s = useGarden.getState();
  if (s.paused || s.selectedPlot === null) return;
  const improved = upgradeTower(s.game, s.selectedPlot);
  useGarden.setState({ revision: s.revision + 1, notice: improved ? 'A little stronger. A lot more trouble for zombies.' : 'Not enough coins, or this defender is fully grown.' });
  if (improved) gardenSound('build');
}
export function sellDefender() {
  const s = useGarden.getState();
  if (s.paused || s.selectedPlot === null) return;
  if (sellTower(s.game, s.selectedPlot)) useGarden.setState({ revision: s.revision + 1, selectedPlot: null, notice: 'Coins returned. Try a new combination!' });
}
export function sendWave() {
  const s = useGarden.getState();
  if (!s.started || s.paused || s.game.phase !== 'build') return;
  if (s.game.towers.length === 0) { useGarden.setState({ notice: 'Plant at least one defender before inviting the zombies in.' }); return; }
  startWave(s.game);
  useGarden.setState({ revision: s.revision + 1, selectedPlot: null, notice: 'Here they come! Your defenders are on watch. Build again after the wave.' });
  gardenSound('wave');
}
export function toggleGardenPause() { const s = useGarden.getState(); if (s.started && !['won', 'lost'].includes(s.game.phase)) useGarden.setState({ paused: !s.paused }); }
export function tickGarden(dt: number) {
  const s = useGarden.getState();
  if (!s.started || s.paused) return;
  const oldPhase = s.game.phase, oldKills = s.game.kills, oldLives = s.game.lives;
  stepGame(s.game, Math.min(dt, 0.1) * s.speed);
  if (s.game.kills > oldKills) gardenSound('pop');
  if (s.game.lives < oldLives) gardenSound('leak');
  if (s.game.phase !== oldPhase) {
    useGarden.setState({ notice: s.game.phase === 'build' ? 'Wave cleared! Bonus coins earned. Time to grow your defenses.' : s.game.phase === 'won' ? 'Every sprout is safe. You saved the garden!' : 'The zombies made themselves at home. Give it another grow!' });
    gardenSound(s.game.phase === 'won' ? 'win' : 'wave');
  }
  uiElapsed += dt;
  if (uiElapsed >= 1 / 24) { uiElapsed = 0; useGarden.setState({ revision: s.revision + 1 }); }
}
