import { useEffect, useState } from 'react';
import { Boxes, Circle, Gauge, MousePointer2, Save } from 'lucide-react';
import { useEditorStore, selectActiveObjects, effectiveSelection } from '../store/editorStore';
import { getPerfSnapshot } from '../runtime/perfStats';

/**
 * Persistent bottom status bar — the anchor chrome every pro editor (Unity/Unreal/VS Code) has.
 * Left: live selection + transform readout. Right: scene object count, Play FPS, and save state.
 * Reads cheap, rarely-changing state reactively from the store; polls FPS (1s) only while playing
 * so it never adds to the per-frame render cost it reports.
 */
function fmt(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

export function StatusBar() {
  const objectCount = useEditorStore((s) => selectActiveObjects(s).length);
  const selectionCount = useEditorStore((s) => effectiveSelection(s).length);
  const active = useEditorStore((s) => s.selectedObject());
  const sceneName = useEditorStore((s) => s.activeScene()?.name);
  const isDirty = useEditorStore((s) => s.isDirty);
  const isPlaying = useEditorStore((s) => s.isPlaying);

  const [fps, setFps] = useState(0);
  useEffect(() => {
    if (!isPlaying) return;
    const id = window.setInterval(() => setFps(getPerfSnapshot().fps), 1000);
    return () => window.clearInterval(id);
  }, [isPlaying]);

  const pos = active?.transform?.position;
  const fpsTone = fps >= 55 ? 'ok' : fps >= 30 ? 'warn' : 'bad';

  return (
    <footer className="status-bar" role="status" aria-live="polite">
      <div className="status-bar__group">
        <span className="status-bar__item" title="Current selection">
          <MousePointer2 size={14} aria-hidden />
          {selectionCount > 1
            ? `${selectionCount} selected`
            : active
              ? active.name
              : 'No selection'}
        </span>
        {active && pos && selectionCount <= 1 && (
          <span className="status-bar__item status-bar__mono" title="World position (X, Y, Z)">
            X {fmt(pos[0])}  Y {fmt(pos[1])}  Z {fmt(pos[2])}
          </span>
        )}
      </div>

      <div className="status-bar__group status-bar__group--right">
        {sceneName && <span className="status-bar__item">{sceneName}</span>}
        <span className="status-bar__item" title="Objects in the active scene">
          <Boxes size={14} aria-hidden />
          {objectCount}
        </span>
        {isPlaying && (
          <span className={`status-bar__item status-bar__fps status-bar__fps--${fpsTone}`} title="Frames per second">
            <Gauge size={14} aria-hidden />
            {Math.round(fps)} FPS
          </span>
        )}
        <span
          className={`status-bar__item status-bar__save ${isDirty ? 'is-dirty' : 'is-saved'}`}
          title={isDirty ? 'Unsaved changes' : 'All changes saved'}
        >
          {isDirty ? <Circle size={9} aria-hidden /> : <Save size={14} aria-hidden />}
          {isDirty ? 'Unsaved' : 'Saved'}
        </span>
      </div>
    </footer>
  );
}
