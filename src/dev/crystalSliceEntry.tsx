import { createRoot } from 'react-dom/client';
import { useEditorStore } from '../store/editorStore';
import { blankProject } from '../project/serialize';
import { createCrystalSliceTemplate } from '../project/crystalSliceTemplate';
import { GameView } from '../player/GameView';
import { CinematicOverlay } from '../components/CinematicOverlay';
import { useGameRuntime } from '../runtime/useGameRuntime';
import { getActivePhysics } from '../runtime/physicsWorld';
import '../styles.css';

// Isolated live preview: uses the real player and cinematic clock without modifying a saved project.
if (!import.meta.env.DEV) throw new Error('Crystal Slice preview requires the development server.');
(window as unknown as { __featherStore: unknown }).__featherStore = new Proxy({}, {
  get: (_, key: string) => useEditorStore.getState()[key as keyof ReturnType<typeof useEditorStore.getState>],
});
useEditorStore.getState().loadProject(blankProject('Crystal Slice'));
await createCrystalSliceTemplate();
useEditorStore.getState().setPlaying(true);

function CrystalPreview() {
  useGameRuntime(true);
  const paused = useEditorStore(s => s.isPlayPaused);
  const button = { border: '1px solid #ffffff26', background: '#09191caa', color: '#e1ece7',
    padding: '9px 16px', borderRadius: 100, cursor: 'pointer', font: 'inherit' };
  return <main style={{ position: 'fixed', inset: 0, fontFamily: 'Inter, sans-serif', color: '#deebe5' }}>
    <GameView /><CinematicOverlay />
    <div style={{ position: 'absolute', top: 32, left: 36, zIndex: 30, pointerEvents: 'none' }}>
      <div style={{ fontSize: 10, letterSpacing: '0.26em', opacity: 0.6 }}>FEATHER / MATERIAL STUDY 01</div>
      <h1 style={{ margin: '12px 0', fontSize: 26, fontWeight: 400, letterSpacing: '-0.035em' }}>Crystal Slice</h1>
    </div>
    <div style={{ position: 'absolute', bottom: 28, left: 36, zIndex: 30, pointerEvents: 'none', fontSize: 10, letterSpacing: '0.2em', opacity: 0.6 }}>
      CUT · FALL · SPLASH / TAP A SLICE TO PUSH IT
    </div>
    <div style={{ position: 'absolute', bottom: 24, right: 36, zIndex: 30, display: 'flex', gap: 10, fontSize: 12 }}>
      <button data-testid="crystal-nudge" style={button} disabled={paused} onClick={() => {
        if (!paused) getActivePhysics()?.applyRadialImpulse([0, -0.65, 0.8], 5, 7);
      }}>Nudge pieces</button>
      <button data-testid="crystal-pause" style={button} onClick={() => useEditorStore.getState().setPlayPaused(!paused)}>{paused ? 'Play' : 'Pause'}</button>
      <button data-testid="crystal-restart" style={button} onClick={() => {
        const s = useEditorStore.getState();
        s.setPlaying(false); s.setPlaying(true);
      }}>Restart</button>
    </div>
  </main>;
}
createRoot(document.getElementById('crystal-root')!).render(<CrystalPreview />);
