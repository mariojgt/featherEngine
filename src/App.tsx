import { Profiler, useEffect, type ReactNode } from 'react';
import { profileRender, resetReactProfile } from './runtime/reactProfile';
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
import { ShortcutsOverlay } from './components/ShortcutsOverlay';
import { CommandPalette } from './components/CommandPalette';
import { initHistory } from './store/history';
import { initAutosave } from './store/autosave';

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
    resetReactProfile(); // ...and so does the per-region React render attribution
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
 * Warn before closing/reloading the tab when work would be lost: either the PREFAB EDITOR is open
 * (its transient edit scene is never persisted — serialize strips it) or the project has unsaved
 * changes (`isDirty`). Autosave recovery is a safety net, but a standard confirm dialog is what
 * users expect. Play mode never sets `isDirty`, so previewing a game won't trigger the prompt.
 */
function PrefabEditGuard() {
  const editing = useEditorStore((state) => Boolean(state.editingPrefabId) || state.isDirty);
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

  // Attach the undo/redo capture + autosave-recovery subscriptions once, for the lifetime of the editor.
  useEffect(() => {
    initHistory();
    initAutosave();
  }, []);

  if (!hasProject) {
    return (
      <>
        <AppearanceSync />
        <Launcher />
      </>
    );
  }

  // Top-level chrome regions get the same render-attribution wrapper as the dock panels, so a
  // widget re-rendering 60×/s during Play is identifiable in the perf overlay (dev builds).
  const profiled = (id: string, node: ReactNode) => (
    <Profiler id={id} onRender={profileRender}>
      {node}
    </Profiler>
  );

  return (
    <div className="editor-shell">
      <AppearanceSync />
      <RuntimePreviewLoop />
      <PrefabEditGuard />
      {profiled('toolbar', <Toolbar />)}
      <Workspace />
      {profiled('console', <RuntimeConsole />)}
      {profiled('varwatch', <VariableWatch />)}
      {profiled('cine-overlay', <CinematicOverlay />)}
      {profiled('ai-chat', <AIChatWidget />)}
      <PrefabThumbnailHost />
      <PerfOverlay />
      <ShortcutsOverlay />
      <CommandPalette />
    </div>
  );
}
