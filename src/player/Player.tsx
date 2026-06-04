import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../store/editorStore';
import { GAME_BUNDLE_FILE, readGameBundle } from '../project/exportGame';
import { useRuntimeAudio } from '../runtime/useRuntimeAudio';
import { ScreenUILayer } from '../ui/ScreenUILayer';
import { DynamicCrosshair } from '../ui/DynamicCrosshair';
import { GameHud } from '../ui/GameHud';
import { MiniMap } from '../ui/MiniMap';
import { GameView } from './GameView';
import { CinematicOverlay } from '../components/CinematicOverlay';
import { DebugOverlay, PlayerErrorBoundary } from './PlayerDiagnostics';

type Status = 'loading' | 'ready' | 'needs-file' | 'error';

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 16,
  textAlign: 'center',
  padding: 24,
};

/** Drives the runtime loop and forwards keyboard input — the player's equivalent of the editor's preview loop. */
function useRuntimeLoop(active: boolean) {
  const tickRuntime = useEditorStore((state) => state.tickRuntime);
  const setRuntimeKey = useEditorStore((state) => state.setRuntimeKey);

  useEffect(() => {
    if (!active) return;
    let frame = 0;
    let lastTime = performance.now();
    const loop = (time: number) => {
      const delta = Math.min((time - lastTime) / 1000, 0.05);
      lastTime = time;
      tickRuntime(delta);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [active, tickRuntime]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      setRuntimeKey(event.code, true);
    };
    const onKeyUp = (event: KeyboardEvent) => setRuntimeKey(event.code, false);
    const onMouseDown = (event: MouseEvent) => setRuntimeKey(`Mouse${event.button}`, true);
    const onMouseUp = (event: MouseEvent) => setRuntimeKey(`Mouse${event.button}`, false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [active, setRuntimeKey]);
}

export function Player() {
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string>('');
  const loadProject = useEditorStore((state) => state.loadProject);
  const setPlaying = useEditorStore((state) => state.setPlaying);
  const startedRef = useRef(false);

  const start = (raw: unknown) => {
    try {
      const { project } = readGameBundle(raw);
      loadProject(project);
      setPlaying(true);
      setStatus('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  };

  // On launch, resolve the game bundle in priority order:
  //   1. a baked-in global (window.__NODEFORGE_GAME__) written by `game-bundle.js` —
  //      this is what a production export injects, so the player runs from file:// and
  //      inside the native (Tauri) shell with no fetch.
  //   2. a sibling ./game.json (served builds / dropping a bundle next to the player).
  //   3. a manual file picker (opened directly during testing).
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    let cancelled = false;

    const baked = (window as unknown as { __NODEFORGE_GAME__?: unknown }).__NODEFORGE_GAME__;
    if (baked) {
      start(baked);
      return;
    }

    fetch(`./${GAME_BUNDLE_FILE}`)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((raw) => {
        if (!cancelled) start(raw);
      })
      .catch(() => {
        // No bundled game (e.g. opened directly during testing) — let the user pick one.
        if (!cancelled) setStatus('needs-file');
      });
    return () => {
      cancelled = true;
    };
    // start/loadProject/setPlaying are stable store actions; run this once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useRuntimeLoop(status === 'ready');
  useRuntimeAudio();

  const onPickFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setStatus('loading');
    try {
      start(JSON.parse(await file.text()));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  };

  if (status === 'ready')
    return (
      <PlayerErrorBoundary>
        <GameView />
        <ScreenUILayer />
        <DynamicCrosshair />
        <GameHud />
        <MiniMap />
        <CinematicOverlay />
        <DebugOverlay />
      </PlayerErrorBoundary>
    );

  return (
    <div style={overlayStyle}>
      {status === 'loading' && <p style={{ opacity: 0.7 }}>Loading game…</p>}

      {status === 'needs-file' && (
        <>
          <p style={{ opacity: 0.85, maxWidth: 360 }}>
            No <code>{GAME_BUNDLE_FILE}</code> found next to the player. Choose an exported game file to run it.
          </p>
          <label
            style={{
              cursor: 'pointer',
              padding: '10px 18px',
              borderRadius: 10,
              background: '#5B8CFF',
              color: '#0b0d12',
              fontWeight: 600,
            }}
          >
            Load game file…
            <input
              type="file"
              accept=".json,application/json,.nforge"
              style={{ display: 'none' }}
              onChange={onPickFile}
            />
          </label>
        </>
      )}

      {status === 'error' && (
        <>
          <p style={{ color: '#FF6B6B', fontWeight: 600 }}>Failed to start the game</p>
          <p style={{ opacity: 0.7, maxWidth: 420, fontSize: 13 }}>{error}</p>
        </>
      )}
    </div>
  );
}
