import { Profiler, useEffect, type ReactNode } from 'react';
import { useEditorStore } from '../store/editorStore';
import { profileRender, resetReactProfile } from '../runtime/reactProfile';
import { FirstGameGuide } from '../creator/components/FirstGameGuide';
import { Toolbar } from './Toolbar';
import { Workspace } from './Workspace';
import { StatusBar } from './StatusBar';
import { ToastHost } from './ToastHost';
import { ConfirmDialog } from './ConfirmDialog';
import { PackageDetailsDialog } from './PackageDetailsDialog';
import { RuntimeConsole } from './RuntimeConsole';
import { VariableWatch } from './VariableWatch';
import { PrefabThumbnailHost } from './PrefabThumbnailer';
import { ModelThumbnailHost } from './ModelThumbnailHost';
import { useRuntimeAudio } from '../runtime/useRuntimeAudio';
import { recordFrame, resetHitches } from '../runtime/perfStats';
import { useGameRuntime, type RuntimeLoopInstrumentation } from '../runtime/useGameRuntime';
import { PerfOverlay } from './PerfOverlay';
import { ShortcutsOverlay } from './ShortcutsOverlay';
import { CommandPalette } from './CommandPalette';

const EDITOR_RUNTIME_INSTRUMENTATION: RuntimeLoopInstrumentation = {
  onSessionStart: () => {
    resetHitches();
    resetReactProfile();
  },
  onFrame: recordFrame,
};

function RuntimePreviewLoop() {
  const isPlaying = useEditorStore((state) => state.isPlaying);
  useRuntimeAudio();
  useGameRuntime(isPlaying, EDITOR_RUNTIME_INSTRUMENTATION);
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

export default function EditorShell() {
  // Top-level chrome regions get the same render-attribution wrapper as the dock panels, so a
  // widget re-rendering 60×/s during Play is identifiable in the perf overlay (dev builds).
  const profiled = (id: string, node: ReactNode) => (
    <Profiler id={id} onRender={profileRender}>
      {node}
    </Profiler>
  );

  return (
    <div className="editor-shell">
      <RuntimePreviewLoop />
      <PrefabEditGuard />
      {profiled('toolbar', <Toolbar />)}
      <div className="first-game-slot"><FirstGameGuide /></div>
      <Workspace />
      <StatusBar />
      {profiled('console', <RuntimeConsole />)}
      {profiled('varwatch', <VariableWatch />)}
      <PrefabThumbnailHost />
      <ModelThumbnailHost />
      <PerfOverlay />
      <ToastHost />
      <ConfirmDialog />
      <PackageDetailsDialog />
      <ShortcutsOverlay />
      <CommandPalette />
    </div>
  );
}
