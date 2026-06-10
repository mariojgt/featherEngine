import { useEffect } from 'react';
import { AIChatWidget } from './components/AIChatWidget';
import { Launcher } from './components/Launcher';
import { useProjectStore } from './store/projectStore';
import { Toolbar } from './components/Toolbar';
import { Workspace } from './components/Workspace';
import { RuntimeConsole } from './components/RuntimeConsole';
import { VariableWatch } from './components/VariableWatch';
import { PrefabThumbnailHost } from './components/PrefabThumbnailer';
import { CinematicOverlay } from './components/CinematicOverlay';
import { useEditorStore } from './store/editorStore';
import { useEditorPrefs } from './store/editorPrefsStore';
import { useRuntimeAudio } from './runtime/useRuntimeAudio';
import { recordFrame, resetHitches } from './runtime/perfStats';
import { resetFrameClock, smoothFrameDelta } from './runtime/frameClock';
import { resetGamepadInput, sampleGamepads } from './runtime/gamepadInput';
import { PerfOverlay } from './components/PerfOverlay';
import { initHistory } from './store/history';

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
    resetHitches(); // the hitch counters describe THIS Play session
    resetFrameClock();

    let frame = 0;
    let lastTime = performance.now();

    const loop = (time: number) => {
      const frameMs = time - lastTime;
      // Smoothed clock: evens out RAF jitter and spreads hitch backlogs over a few gentle steps —
      // without it, a moving car/character visibly freezes then SNAPS forward after every spike.
      const delta = smoothFrameDelta(frameMs / 1000);
      lastTime = time;
      const tickStart = performance.now();
      sampleGamepads(delta, setRuntimeKey);
      tickRuntime(delta);
      recordFrame(frameMs, performance.now() - tickStart);
      frame = requestAnimationFrame(loop);
    };

    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      resetGamepadInput();
    };
  }, [isPlaying, tickRuntime, setRuntimeKey]);

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

/**
 * Closing/reloading the tab while the PREFAB EDITOR is open silently loses those edits — the
 * transient edit scene is never persisted (serialize strips it). Warn before unload in that state.
 */
function PrefabEditGuard() {
  const editing = useEditorStore((state) => Boolean(state.editingPrefabId));
  useEffect(() => {
    if (!editing) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = ''; // required by Chrome to show the confirmation dialog
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [editing]);
  return null;
}

export default function App() {
  const hasProject = useProjectStore((state) => state.hasProject);

  // Attach the undo/redo capture subscription once, for the lifetime of the editor.
  useEffect(() => {
    initHistory();
  }, []);

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
      <PrefabEditGuard />
      <Toolbar />
      <Workspace />
      <RuntimeConsole />
      <VariableWatch />
      <CinematicOverlay />
      <AIChatWidget />
      <PrefabThumbnailHost />
      <PerfOverlay />
    </div>
  );
}
