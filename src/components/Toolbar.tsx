import {
  Box,
  Camera,
  Circle,
  Copy,
  Download,
  Gamepad2,
  LampDesk,
  Pause,
  Play,
  Square,
  Trash2,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useEditorStore } from '../store/editorStore';
import type { SceneObjectKind } from '../types';

const creationTools: Array<{ kind: SceneObjectKind; label: string; icon: typeof Box }> = [
  { kind: 'empty', label: 'Empty', icon: Square },
  { kind: 'cube', label: 'Cube', icon: Box },
  { kind: 'sphere', label: 'Sphere', icon: Circle },
  { kind: 'plane', label: 'Plane', icon: Square },
  { kind: 'light', label: 'Light', icon: LampDesk },
  { kind: 'camera', label: 'Camera', icon: Camera },
];

const downloadJson = (fileName: string, payload: unknown) => {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
};

export function Toolbar() {
  const createObject = useEditorStore((state) => state.createObject);
  const duplicateSelectedObject = useEditorStore((state) => state.duplicateSelectedObject);
  const deleteSelectedObject = useEditorStore((state) => state.deleteSelectedObject);
  const exportProject = useEditorStore((state) => state.exportProject);
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const setPlaying = useEditorStore((state) => state.setPlaying);
  const selectedObject = useEditorStore((state) => state.selectedObject());

  return (
    <header className="toolbar">
      <div className="brand">
        <Gamepad2 size={18} aria-hidden />
        <div>
          <strong>NodeForge</strong>
          <span>Engine</span>
        </div>
      </div>

      <nav className="tool-group" aria-label="Create scene object">
        {creationTools.map(({ kind, label, icon: Icon }) => (
          <button key={kind} className="icon-button" title={`Create ${label}`} onClick={() => createObject(kind)}>
            <Icon size={17} aria-hidden />
          </button>
        ))}
      </nav>

      <div className="tool-group" aria-label="Object actions">
        <button className="icon-button" title="Duplicate selected object" onClick={duplicateSelectedObject}>
          <Copy size={17} aria-hidden />
        </button>
        <button className="icon-button danger" title="Delete selected object" onClick={deleteSelectedObject}>
          <Trash2 size={17} aria-hidden />
        </button>
      </div>

      <div className="toolbar-spacer" />

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
        <button className="export-button" title="Export project" onClick={() => downloadJson('game.nforge', exportProject())}>
          <Download size={16} aria-hidden />
          <span>Export Game</span>
        </button>
      </div>
    </header>
  );
}
