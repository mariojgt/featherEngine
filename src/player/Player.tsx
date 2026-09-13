import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../store/editorStore';
import { GAME_BUNDLE_FILE, readGameBundle } from '../project/exportGame';
import { useRuntimeAudio } from '../runtime/useRuntimeAudio';
import { useGameRuntime } from '../runtime/useGameRuntime';
import { RuntimeOverlays } from '../runtime/RuntimeOverlays';
import { GameView } from './GameView';
import { PlayerErrorBoundary } from './PlayerDiagnostics';

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

export function Player() {
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string>('');
  const loadProject = useEditorStore((state) => state.loadProject);
  const setPlaying = useEditorStore((state) => state.setPlaying);
  const startedRef = useRef(false);

  const start = (raw: unknown) => {
    try {
      const { project, startSceneId, buildProfile } = readGameBundle(raw);
      document.title = buildProfile.window.title || buildProfile.application.productName;
      // A bundle's launch scene is an export setting and may intentionally differ from the scene that
      // happened to be active when the project snapshot was saved.
      loadProject(project.activeSceneId === startSceneId ? project : { ...project, activeSceneId: startSceneId });
      setPlaying(true);
      setStatus('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  };

  // On launch, resolve the game bundle in priority order:
  //   1. a baked-in global (window.__NODEFORGE_GAME__) written by `game-bundle.js` —
  //      this is what a production export injects, so hosted web builds and the native
  //      Tauri shell start without fetching a separate game.json.
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

  useGameRuntime(status === 'ready');
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
        <RuntimeOverlays />
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
