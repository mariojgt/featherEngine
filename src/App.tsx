import { useEffect } from 'react';
import { AssetBrowser } from './components/AssetBrowser';
import { HierarchyPanel } from './components/HierarchyPanel';
import { InspectorPanel } from './components/InspectorPanel';
import { Toolbar } from './components/Toolbar';
import { ViewportPanel } from './components/Viewport';
import { VisualScriptingPanel } from './components/VisualScriptingPanel';
import { useEditorStore } from './store/editorStore';

function RuntimePreviewLoop() {
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const tickRuntime = useEditorStore((state) => state.tickRuntime);
  const setRuntimeKey = useEditorStore((state) => state.setRuntimeKey);

  useEffect(() => {
    if (!isPlaying) return;

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
  }, [isPlaying, tickRuntime]);

  useEffect(() => {
    if (!isPlaying) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      setRuntimeKey(event.code, true);
    };
    const handleKeyUp = (event: KeyboardEvent) => setRuntimeKey(event.code, false);

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isPlaying, setRuntimeKey]);

  return null;
}

export default function App() {
  return (
    <div className="editor-shell">
      <RuntimePreviewLoop />
      <Toolbar />
      <main className="workspace">
        <HierarchyPanel />
        <ViewportPanel />
        <InspectorPanel />
        <AssetBrowser />
        <VisualScriptingPanel />
      </main>
    </div>
  );
}
