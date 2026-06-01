import { useEffect, useRef, useState } from 'react';
import {
  Box,
  Camera,
  Circle,
  Copy,
  FilePlus2,
  FolderOpen,
  Gamepad2,
  LampDesk,
  Layers,
  Pause,
  Play,
  Plus,
  Save,
  Square,
  Trash2,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useEditorStore } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import type { SceneObjectKind } from '../types';

const creationTools: Array<{ kind: SceneObjectKind; label: string; icon: typeof Box }> = [
  { kind: 'empty', label: 'Empty', icon: Square },
  { kind: 'cube', label: 'Cube', icon: Box },
  { kind: 'sphere', label: 'Sphere', icon: Circle },
  { kind: 'plane', label: 'Plane', icon: Square },
  { kind: 'light', label: 'Light', icon: LampDesk },
  { kind: 'camera', label: 'Camera', icon: Camera },
];

function FileMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const newProject = useProjectStore((state) => state.newProject);
  const openProject = useProjectStore((state) => state.openProject);
  const save = useProjectStore((state) => state.save);
  const saveAs = useProjectStore((state) => state.saveAs);
  const closeProject = useProjectStore((state) => state.closeProject);
  const projectName = useProjectStore((state) => state.projectName);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, []);

  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <div className="file-menu" ref={ref}>
      <button className="file-menu-trigger" onClick={() => setOpen((value) => !value)}>
        File
      </button>
      {open && (
        <div className="file-menu-popover">
          <button onClick={run(() => void newProject(`Game ${new Date().getFullYear()}`))}>New project…</button>
          <button onClick={run(() => void openProject())}>Open project…</button>
          <button onClick={run(() => void save())}>Save</button>
          <button onClick={run(() => void saveAs(`${projectName} Copy`))}>Save as…</button>
          <hr />
          <button onClick={run(closeProject)}>Close project</button>
        </div>
      )}
    </div>
  );
}

function SceneSwitcher() {
  const scenes = useEditorStore((state) => state.scenes);
  const activeSceneId = useEditorStore((state) => state.activeSceneId);
  const setActiveScene = useEditorStore((state) => state.setActiveScene);
  const createScene = useEditorStore((state) => state.createScene);
  const isPlaying = useEditorStore((state) => state.isPlaying);

  return (
    <div className="scene-switcher" title={isPlaying ? 'Stop play to switch scenes' : 'Active scene'}>
      <Layers size={15} aria-hidden />
      <select
        value={activeSceneId}
        disabled={isPlaying}
        onChange={(event) => setActiveScene(event.target.value)}
      >
        {scenes.map((scene) => (
          <option key={scene.id} value={scene.id}>
            {scene.name}
          </option>
        ))}
      </select>
      <button
        className="icon-button compact"
        title="Add scene"
        disabled={isPlaying}
        onClick={() => {
          const id = createScene();
          setActiveScene(id);
        }}
      >
        <Plus size={14} aria-hidden />
      </button>
    </div>
  );
}

export function Toolbar() {
  const createObject = useEditorStore((state) => state.createObject);
  const duplicateSelectedObject = useEditorStore((state) => state.duplicateSelectedObject);
  const deleteSelectedObject = useEditorStore((state) => state.deleteSelectedObject);
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const setPlaying = useEditorStore((state) => state.setPlaying);
  const selectedObject = useEditorStore((state) => state.selectedObject());
  const isDirty = useEditorStore((state) => state.isDirty);
  const projectName = useProjectStore((state) => state.projectName);
  const save = useProjectStore((state) => state.save);
  const busy = useProjectStore((state) => state.busy);

  // ⌘S / Ctrl+S to save.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [save]);

  return (
    <header className="toolbar">
      <div className="brand">
        <Gamepad2 size={18} aria-hidden />
        <div>
          <strong>NodeForge</strong>
          <span>Engine</span>
        </div>
      </div>

      <FileMenu />
      <SceneSwitcher />

      <div className="tool-group" aria-label="Create scene object">
        {creationTools.map(({ kind, label, icon: Icon }) => (
          <button key={kind} className="icon-button" title={`Create ${label}`} onClick={() => createObject(kind)}>
            <Icon size={17} aria-hidden />
          </button>
        ))}
        <button className="icon-button" title="Create empty object" onClick={() => createObject('empty')}>
          <FilePlus2 size={17} aria-hidden />
        </button>
      </div>

      <div className="tool-group" aria-label="Object actions">
        <button className="icon-button" title="Duplicate selected object" onClick={duplicateSelectedObject}>
          <Copy size={17} aria-hidden />
        </button>
        <button className="icon-button danger" title="Delete selected object" onClick={deleteSelectedObject}>
          <Trash2 size={17} aria-hidden />
        </button>
      </div>

      <div className="toolbar-spacer" />

      <div className="project-pill" title={projectName}>
        <span>{projectName}</span>
        {isDirty && <span className="dirty-dot" title="Unsaved changes" />}
      </div>

      <AnimatePresence mode="popLayout">
        {selectedObject && (
          <motion.div
            key={selectedObject.id}
            className="selection-pill"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
          >
            <span>{selectedObject.name}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="tool-group" aria-label="Runtime controls">
        <button
          className={isPlaying ? 'run-button active' : 'run-button'}
          title={isPlaying ? 'Stop preview' : 'Play preview'}
          onClick={() => setPlaying(!isPlaying)}
        >
          {isPlaying ? <Pause size={16} aria-hidden /> : <Play size={16} aria-hidden />}
          <span>{isPlaying ? 'Running' : 'Play'}</span>
        </button>
        <button className="export-button" title="Save project (⌘S)" onClick={() => void save()} disabled={busy}>
          <Save size={16} aria-hidden />
          <span>Save</span>
        </button>
      </div>
    </header>
  );
}
