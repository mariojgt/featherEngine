import { useEffect } from 'react';
import { AIChatWidget } from './components/AIChatWidget';
import { Launcher } from './components/Launcher';
import { useProjectStore } from './store/projectStore';
import { Toolbar } from './components/Toolbar';
import { Workspace } from './components/Workspace';
import { RuntimeConsole } from './components/RuntimeConsole';
import { PrefabThumbnailHost } from './components/PrefabThumbnailer';
import { CinematicOverlay } from './components/CinematicOverlay';
import { useEditorStore } from './store/editorStore';
import { useEditorPrefs } from './store/editorPrefsStore';
import { useRuntimeAudio } from './runtime/useRuntimeAudio';
import { recordFrame } from './runtime/perfStats';
import { PerfOverlay } from './components/PerfOverlay';

/**
 * Mirror the user's appearance preferences onto <html> so the global CSS variables
 * (defined in styles.css under [data-theme="..."] / [data-density="..."]) can react
 * without touching individual components.
 */
function AppearanceSync() {
  const themeMode = useEditorPrefs((s) => s.themeMode);
  const accent = useEditorPrefs((s) => s.accent);
  const density = useEditorPrefs((s) => s.density);
  const fontScale = useEditorPrefs((s) => s.fontScale);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = themeMode;
    root.dataset.density = density;
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--font-scale', String(fontScale));
  }, [themeMode, accent, density, fontScale]);

  return null;
}

function RuntimePreviewLoop() {
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const tickRuntime = useEditorStore((state) => state.tickRuntime);
  const setRuntimeKey = useEditorStore((state) => state.setRuntimeKey);
  useRuntimeAudio();

  useEffect(() => {
    if (!isPlaying) return;

    let frame = 0;
    let lastTime = performance.now();

    const loop = (time: number) => {
      const frameMs = time - lastTime;
      const delta = Math.min(frameMs / 1000, 0.05);
      lastTime = time;
      const tickStart = performance.now();
      tickRuntime(delta);
      recordFrame(frameMs, performance.now() - tickStart);
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
    // Mouse buttons are exposed as runtime "keys" too: Mouse0 (left), Mouse1 (middle), Mouse2 (right).
    const handleMouseDown = (event: MouseEvent) => setRuntimeKey(`Mouse${event.button}`, true);
    const handleMouseUp = (event: MouseEvent) => setRuntimeKey(`Mouse${event.button}`, false);

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isPlaying, setRuntimeKey]);

  return null;
}

export default function App() {
  const hasProject = useProjectStore((state) => state.hasProject);

  if (!hasProject) {
    return (
      <>
        <AppearanceSync />
        <Launcher />
      </>
    );
  }

  return (
    <div className="editor-shell">
      <AppearanceSync />
      <RuntimePreviewLoop />
      <Toolbar />
      <Workspace />
      <RuntimeConsole />
      <CinematicOverlay />
      <AIChatWidget />
      <PrefabThumbnailHost />
      <PerfOverlay />
    </div>
  );
}
