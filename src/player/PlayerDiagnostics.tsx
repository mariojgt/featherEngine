import { Component, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import { useFollowTarget } from '../three/FollowCamera';

// The exported player doesn't ship the editor stylesheet, so everything here is inline-styled.
const errorPanel: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 100000,
  background: '#140b0b',
  color: '#ffd9d9',
  font: '13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace',
  padding: 24,
  overflow: 'auto',
};
const stackStyle: CSSProperties = {
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  background: 'rgba(0,0,0,0.4)',
  padding: 12,
  borderRadius: 8,
  maxHeight: '50vh',
  overflow: 'auto',
  color: '#ff9d9d',
};
const hintStyle: CSSProperties = {
  position: 'fixed',
  left: 8,
  bottom: 8,
  zIndex: 99999,
  font: '11px ui-monospace, monospace',
  color: 'rgba(255,255,255,0.35)',
  pointerEvents: 'none',
  userSelect: 'none',
};
const panelStyle: CSSProperties = {
  position: 'fixed',
  left: 8,
  bottom: 8,
  zIndex: 99999,
  width: 320,
  maxWidth: '80vw',
  background: 'rgba(8,10,16,0.86)',
  color: '#cdd6ea',
  font: '12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace',
  border: '1px solid rgba(255,255,255,0.14)',
  borderRadius: 10,
  padding: '10px 12px',
};

/**
 * Catches any error thrown in the game tree (e.g. inside the R3F canvas) and shows it on
 * screen instead of a silent black screen — the exported player has no editor/console to
 * fall back on. Without this, a throw after the first frame just unmounts the canvas.
 */
export class PlayerErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    const err = this.state.error;
    return (
      <div style={errorPanel}>
        <h2 style={{ marginTop: 0 }}>The game hit an error</h2>
        <p style={{ fontWeight: 600 }}>{err.message}</p>
        <pre style={stackStyle}>{err.stack}</pre>
        <button onClick={() => window.location.reload()} style={{ marginTop: 12, padding: '6px 14px' }}>
          Reload
        </button>
      </div>
    );
  }
}

/** Live runtime readout, toggled with the backtick (`) key — so a black/blank screen can be diagnosed. */
export function DebugOverlay() {
  const [open, setOpen] = useState(false);
  const [fps, setFps] = useState(0);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === 'Backquote') setOpen((value) => !value);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Sample FPS only while the panel is open, so it never costs anything during normal play.
  useEffect(() => {
    if (!open) return;
    let raf = 0;
    let frames = 0;
    let last = performance.now();
    const loop = () => {
      frames += 1;
      const now = performance.now();
      if (now - last >= 500) {
        setFps(Math.round((frames * 1000) / (now - last)));
        frames = 0;
        last = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [open]);

  const isPlaying = useEditorStore((state) => state.isPlaying);
  const allObjects = useEditorStore(selectActiveObjects);
  const runtimeHidden = useEditorStore((state) => state.runtimeHidden);
  const cinematicCamera = useEditorStore((state) => state.runtimeCinematicCamera);
  const fade = useEditorStore((state) => state.runtimeCinematicFade);
  const cinematic = useEditorStore((state) => state.runtimeCinematic);
  const log = useEditorStore((state) => state.runtimeLog);
  const followTarget = useFollowTarget();

  if (!open) return <div style={hintStyle}>press ` for debug</div>;

  const visible = allObjects.filter((object) => !object.viewModel && !runtimeHidden.includes(object.id));
  const cameraObject = visible.find((object) => object.kind === 'camera');
  const cameraMode = cinematicCamera
    ? 'cinematic'
    : followTarget
      ? `follow → ${followTarget.name}`
      : cameraObject
        ? `camera @ ${cameraObject.transform.position.map((n) => n.toFixed(1)).join(', ')}`
        : 'orbit (default)';

  return (
    <div style={panelStyle}>
      <strong>Debug ( ` to close )</strong>
      <div style={fps && fps < 45 ? { color: '#ffb347' } : undefined}>
        fps: {fps || '…'}
        {fps && fps < 30 ? '  ⚠ low' : ''}
      </div>
      <div>playing: {String(isPlaying)}</div>
      <div>
        objects: {visible.length} visible / {allObjects.length} total
      </div>
      <div>camera: {cameraMode}</div>
      <div style={fade && fade.opacity > 0.9 ? { color: '#ffb347' } : undefined}>
        fade: {fade ? `${fade.color} @ ${fade.opacity.toFixed(2)}` : 'none'}
        {fade && fade.opacity > 0.9 ? '  ⚠ screen covered' : ''}
      </div>
      <div>cinematic: {cinematic ? `${cinematic.sequenceId} t=${cinematic.time.toFixed(2)}` : 'none'}</div>
      {visible.length === 0 && <div style={{ color: '#ff8a8a' }}>⚠ no objects visible</div>}
      <div style={{ marginTop: 6, opacity: 0.6 }}>log (last 6):</div>
      <pre style={{ whiteSpace: 'pre-wrap', margin: 0, maxHeight: 140, overflow: 'auto' }}>
        {log.slice(-6).join('\n') || '(empty)'}
      </pre>
    </div>
  );
}
