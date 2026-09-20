import { createRoot } from 'react-dom/client';
import { useEditorStore } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import { configureCinematicCapture } from '../runtime/cinematicCapture';
import { RuntimeOverlays } from '../runtime/RuntimeOverlays';
import { GameView } from '../player/GameView';
import { runTemplateExport } from './exportTemplate';
import '../styles.css';

// The offline renderer uses the actual player and runtime overlays without mounting an editor,
// broadcasting project snapshots, or subscribing authoring panels to every physics step.
if (!import.meta.env.DEV) throw new Error('Cinematic capture requires the development server.');
configureCinematicCapture(true);
(window as unknown as { __featherStore: unknown }).__featherStore = new Proxy({}, {
  get: (_, key: string) => useEditorStore.getState()[key as keyof ReturnType<typeof useEditorStore.getState>],
});
(window as unknown as { __featherProject: unknown }).__featherProject = new Proxy({}, {
  get: (_, key: string) => useProjectStore.getState()[key as keyof ReturnType<typeof useProjectStore.getState>],
});
function CaptureStage() {
  const playing = useEditorStore(s => s.isPlaying);
  return <div className="scene-drop-zone" style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', background: '#02060b' }}>
    {playing && <><GameView /><RuntimeOverlays /></>}
  </div>;
}
createRoot(document.getElementById('capture-root')!).render(<CaptureStage />);
const template = new URLSearchParams(location.search).get('exportTemplate');
if (template) runTemplateExport(template);
