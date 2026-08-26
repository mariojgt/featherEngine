import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Command as CommandIcon, CornerDownLeft, Search } from 'lucide-react';
import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import { useEditorPrefs, type ThemeMode } from '../store/editorPrefsStore';
import { undo, redo } from '../store/history';
import { applyWorkspaceLayout, type WorkspaceLayoutId } from './Workspace';
import { focusWorkspacePanel, openWorkspacePanel } from './workspacePanels';
import { OPEN_SHORTCUTS_EVENT } from './ShortcutsOverlay';
import { captureViewportScreenshot } from '../runtime/viewportCaptureBridge';
import { editorCameraPose } from '../three/EditorCamera';
import type { SceneObjectKind } from '../types';
import { useExtensionSnapshot } from '../extensions/react';

/** Custom event anything (e.g. the View menu) can dispatch to open the palette. */
export const OPEN_COMMANDS_EVENT = 'nf:open-command-palette';

type Command = { id: string; label: string; group: string; keywords?: string; run: () => void | Promise<void> };

function isTypingTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return Boolean(el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)));
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const extensionSnapshot = useExtensionSnapshot();
  // Rebuild object jump commands when the active scene's object names/ids change.
  const objectListSig = useEditorStore((state) =>
    selectActiveObjects(state)
      .filter((object) => !object.viewModel)
      .map((object) => `${object.id}:${object.name}:${object.kind}`)
      .join('|'),
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // ⌘K / Ctrl+K toggles from anywhere (the modifier means it's never plain text entry).
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
      } else if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener(OPEN_COMMANDS_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener(OPEN_COMMANDS_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const store = () => useEditorStore.getState();
    const cmds: Command[] = [];

    cmds.push({ id: 'play', label: isPlaying ? 'Stop preview' : 'Play preview', group: 'Runtime', keywords: 'run test game', run: () => store().setPlaying(!isPlaying) });
    cmds.push({
      id: 'pause',
      label: store().isPlayPaused ? 'Resume preview' : 'Pause preview',
      group: 'Runtime',
      keywords: 'freeze step f6',
      run: () => {
        const s = store();
        if (!s.isPlaying) return;
        s.setPlayPaused(!s.isPlayPaused);
      },
    });
    cmds.push({
      id: 'step',
      label: 'Step frame',
      group: 'Runtime',
      keywords: 'frame advance f7',
      run: () => store().stepPlayFrame(),
    });
    cmds.push({
      id: 'screenshot',
      label: 'Capture viewport screenshot',
      group: 'Runtime',
      keywords: 'png capture f12 photo',
      run: () => {
        void captureViewportScreenshot();
      },
    });
    cmds.push({ id: 'save', label: 'Save project', group: 'Project', keywords: 'write disk download', run: () => void useProjectStore.getState().save() });
    cmds.push({ id: 'undo', label: 'Undo', group: 'Edit', run: undo });
    cmds.push({ id: 'redo', label: 'Redo', group: 'Edit', run: redo });
    cmds.push({ id: 'duplicate', label: 'Duplicate selected object', group: 'Edit', keywords: 'copy clone', run: () => store().duplicateSelectedObject() });
    cmds.push({ id: 'delete', label: 'Delete selected object', group: 'Edit', keywords: 'remove', run: () => store().deleteSelectedObject() });
    cmds.push({ id: 'add-scene', label: 'Add scene', group: 'Scene', keywords: 'new level', run: () => store().setActiveScene(store().createScene()) });

    const objectKinds: Array<[SceneObjectKind, string]> = [
      ['empty', 'Empty'], ['cube', 'Cube'], ['sphere', 'Sphere'], ['plane', 'Plane'], ['capsule', 'Capsule'], ['terrain', 'Terrain'], ['light', 'Light'], ['camera', 'Camera'],
    ];
    for (const [kind, label] of objectKinds) {
      cmds.push({ id: `create-${kind}`, label: `Create ${label}`, group: 'Create', keywords: 'add object new', run: () => store().createObject(kind) });
    }
    cmds.push({
      id: 'create-reflection-probe',
      label: 'Create Reflection Probe',
      group: 'Create',
      keywords: 'render unreal sphere capture reflections cubemap',
      run: () => {
        store().createReflectionProbe();
        focusWorkspacePanel('inspector');
      },
    });
    cmds.push({
      id: 'create-instanced-grid',
      label: 'Create 3×3 GPU-Instanced Model Grid',
      group: 'Create',
      keywords: 'instance instanced mesh repeated model performance unreal',
      run: () => {
        const ids = store().createInstancedGrid(store().selectedObjectId, { rows: 3, columns: 3 });
        if (!ids.length) throw new Error('Select a root-level static imported model with baked materials first.');
        focusWorkspacePanel('inspector');
      },
    });
    cmds.push({
      id: 'cinematic-new',
      label: 'Film Mode: New Cinematic',
      group: 'Film Mode',
      keywords: 'sequence cutscene movie simple',
      run: () => {
        store().createCinematic('New Cinematic', 8);
        focusWorkspacePanel('cinematic');
      },
    });
    cmds.push({
      id: 'cinematic-add-view-shot',
      label: 'Film Mode: Add Shot from Current View',
      group: 'Film Mode',
      keywords: 'camera cut capture viewport simple',
      run: () => {
        if (!editorCameraPose.valid) return;
        const state = store();
        const cinematicId = state.activeCinematicId || state.activeScene()?.cinematics?.[0]?.id || state.createCinematic('New Cinematic', 8);
        const cinematic = store().activeScene()?.cinematics?.find((item) => item.id === cinematicId);
        const time = state.editorCinematicPreview?.sequenceId === cinematicId ? state.editorCinematicPreview.time : 0;
        store().addCinematicShot(cinematicId, {
          time,
          position: [...editorCameraPose.position],
          lookAt: [...editorCameraPose.lookAt],
          fov: editorCameraPose.fov,
          label: `Shot ${(cinematic?.actions.filter((action) => action.type === 'camera').length ?? 0) + 1}`,
        });
        focusWorkspacePanel('cinematic');
      },
    });
    cmds.push({
      id: 'cinematic-live-record',
      label: 'Film Mode: Toggle Playtime Camera Record',
      group: 'Film Mode',
      keywords: 'playtime possess camera record take wasd',
      run: () => store().setPlaytimeCameraRecording(!store().playtimeCameraRecording),
    });
    cmds.push({
      id: 'cinematic-play-active',
      label: 'Film Mode: Play Active Cinematic',
      group: 'Film Mode',
      keywords: 'sequence cutscene movie preview record take run',
      run: () => {
        const state = store();
        const cinematicId = state.activeCinematicId || state.activeScene()?.cinematics?.[0]?.id;
        if (!cinematicId) throw new Error('Create a cinematic first.');

        const sequence = state.activeScene()?.cinematics?.find((item) => item.id === cinematicId);
        const hasCameraShot = sequence?.actions.some((action) => action.type === 'camera') ?? false;
        if (state.playtimeCameraRecording && !hasCameraShot) {
          if (!editorCameraPose.valid) throw new Error('Move the editor viewport once so its camera can be captured.');
          state.addCinematicShot(cinematicId, {
            time: 0,
            position: [...editorCameraPose.position],
            lookAt: [...editorCameraPose.lookAt],
            fov: editorCameraPose.fov,
            label: 'Shot 1',
          });
        }

        store().playCinematic(cinematicId);
        focusWorkspacePanel('cinematic');
      },
    });

    // Jump-to-object: select + focus Inspector + frame in viewport (cap keeps palette snappy).
    const sceneObjects = selectActiveObjects(store())
      .filter((object) => !object.viewModel)
      .slice(0, 200);
    for (const object of sceneObjects) {
      cmds.push({
        id: `select-${object.id}`,
        label: `Select: ${object.name}`,
        group: 'Objects',
        keywords: `${object.kind} find jump focus frame`,
        run: () => {
          store().selectObject(object.id);
          focusWorkspacePanel('inspector');
          window.dispatchEvent(new CustomEvent('nf:focus-selection'));
        },
      });
    }

    const panels: Array<[string, string]> = [
      ['hierarchy', 'Hierarchy'], ['inspector', 'Inspector'], ['scripting', 'Scripting'], ['project', 'Project'], ['materials', 'Material'], ['animator', 'Animator'], ['ui', 'UI'], ['terrain', 'Terrain'], ['particles', 'Particle System'], ['scene', 'Scene'], ['cinematic', 'Film Mode'],
    ];
    for (const [id, label] of panels) {
      cmds.push({ id: `panel-${id}`, label: `Go to ${label}`, group: 'Panels', keywords: 'open focus show view', run: () => focusWorkspacePanel(id) });
    }
    // Opens rather than focuses, so it still works for anyone whose saved layout predates the panel.
    cmds.push({
      id: 'panel-store',
      label: 'Go to Asset Store',
      group: 'Panels',
      keywords: 'store marketplace assets packages browse download install free',
      run: () => {
        openWorkspacePanel({
          id: 'store',
          title: 'Asset Store',
          placement: { referencePanel: 'project', direction: 'within' },
        });
      },
    });

    const layouts: Array<[WorkspaceLayoutId, string]> = [
      ['default', 'Default'], ['modeling', 'Modeling'], ['scripting', 'Scripting'], ['animation', 'Animation'], ['cinematic', 'Cinematic'],
    ];
    for (const [id, label] of layouts) {
      cmds.push({ id: `layout-${id}`, label: `Layout: ${label}`, group: 'Workspace', keywords: 'arrange dock window', run: () => applyWorkspaceLayout(id) });
    }

    const themes: Array<[ThemeMode, string]> = [
      ['nova', 'Nova'],
      ['forge', 'Forge'],
      ['candy', 'Candy'],
      ['unreal', 'Unreal'],
      ['dark', 'Dark'],
      ['midnight', 'Midnight'],
      ['light', 'Light'],
      ['high-contrast', 'High contrast'],
    ];
    for (const [id, label] of themes) {
      cmds.push({
        id: `theme-${id}`,
        label: `Theme: ${label}`,
        group: 'Appearance',
        keywords: 'color skin appearance candy grape',
        run: () => {
          const prefs = useEditorPrefs.getState();
          prefs.setThemeMode(id);
          if (id === 'candy') prefs.setAccent('#3fe2ff');
        },
      });
    }

    cmds.push({
      id: 'shortcuts',
      label: 'Keyboard shortcuts',
      group: 'Help',
      keywords: 'keys cheatsheet help',
      run: () => {
        window.dispatchEvent(new CustomEvent(OPEN_SHORTCUTS_EVENT));
      },
    });
    for (const command of extensionSnapshot.commands) {
      cmds.push({
        id: `extension:${command.id}`,
        label: command.title,
        group: command.group ?? 'Extensions',
        keywords: command.keywords,
        run: command.run,
      });
    }
    return cmds;
  }, [isPlaying, objectListSig, extensionSnapshot]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    const tokens = q.split(/\s+/);
    return commands.filter((command) => {
      const hay = `${command.label} ${command.group} ${command.keywords ?? ''}`.toLowerCase();
      return tokens.every((token) => hay.includes(token));
    });
  }, [commands, query]);

  // Keep the active index in range as the filtered list shrinks.
  const clampedActive = Math.min(active, Math.max(0, filtered.length - 1));

  const runCommand = (command: Command) => {
    setOpen(false);
    try {
      void Promise.resolve(command.run()).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        useProjectStore.setState({ toast: { kind: 'error', message: `Command failed: ${message}` } });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      useProjectStore.setState({ toast: { kind: 'error', message: `Command failed: ${message}` } });
    }
  };

  const onInputKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const command = filtered[clampedActive];
      if (command) runCommand(command);
    }
  };

  // Scroll the active row into view as you arrow through.
  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${clampedActive}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [clampedActive, filtered.length]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="cmdk-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <motion.div
            className="cmdk-card"
            initial={{ opacity: 0, scale: 0.97, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -6 }}
            transition={{ duration: 0.14 }}
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
          >
            <div className="cmdk-input">
              <Search size={16} aria-hidden />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
                onKeyDown={onInputKeyDown}
                placeholder="Type a command — create, play, go to, layout, theme…"
                spellCheck={false}
                aria-label="Search commands"
              />
              <kbd>esc</kbd>
            </div>
            <div className="cmdk-list" ref={listRef}>
              {filtered.length === 0 ? (
                <div className="cmdk-empty">No matching commands</div>
              ) : (
                filtered.map((command, index) => (
                  <button
                    key={command.id}
                    data-index={index}
                    className={index === clampedActive ? 'cmdk-row active' : 'cmdk-row'}
                    onMouseMove={() => setActive(index)}
                    onClick={() => runCommand(command)}
                  >
                    <span className="cmdk-row-label">{command.label}</span>
                    <span className="cmdk-row-group">{command.group}</span>
                    {index === clampedActive && <CornerDownLeft size={14} className="cmdk-row-enter" aria-hidden />}
                  </button>
                ))
              )}
            </div>
            <div className="cmdk-footer">
              <CommandIcon size={12} aria-hidden />
              <span>{filtered.length} command{filtered.length === 1 ? '' : 's'}</span>
              <span className="cmdk-footer-hint">↑↓ navigate · ↵ run · esc close</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
