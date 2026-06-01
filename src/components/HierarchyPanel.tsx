import { Box, Camera, Circle, FilePlus2, LampDesk, Square, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import { focusWorkspacePanel } from './workspacePanels';
import type { SceneObject, SceneObjectKind } from '../types';

const objectIcon: Record<SceneObjectKind, typeof Box> = {
  empty: Square,
  cube: Box,
  sphere: Circle,
  capsule: Box,
  plane: Square,
  light: LampDesk,
  camera: Camera,
};

function HierarchyRow({ object }: { object: SceneObject }) {
  const selectedObjectId = useEditorStore((state) => state.selectedObjectId);
  const selectObject = useEditorStore((state) => state.selectObject);
  const openObjectScript = useEditorStore((state) => state.openObjectScript);
  const Icon = objectIcon[object.kind];

  return (
    <button
      className={clsx('hierarchy-row', selectedObjectId === object.id && 'selected')}
      onClick={() => selectObject(object.id)}
      onDoubleClick={() => {
        // Open the object's blueprint (creating + attaching one if it has none)
        // and reveal the Scripting panel.
        openObjectScript(object.id);
        focusWorkspacePanel('scripting');
      }}
      title={`${object.name} — double-click to edit its script`}
    >
      <Icon size={15} aria-hidden />
      <span>{object.name}</span>
    </button>
  );
}

export function HierarchyPanel() {
  const sceneObjects = useEditorStore(selectActiveObjects);
  const activeSceneName = useEditorStore((state) => state.activeScene()?.name ?? 'Scene');
  const createObject = useEditorStore((state) => state.createObject);
  const deleteSelectedObject = useEditorStore((state) => state.deleteSelectedObject);

  return (
    <aside className="panel hierarchy-panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Scene</span>
          <h2>Hierarchy</h2>
        </div>
        <div className="panel-actions">
          <button className="icon-button compact" title="Create empty object" onClick={() => createObject('empty')}>
            <FilePlus2 size={15} aria-hidden />
          </button>
          <button className="icon-button compact danger" title="Delete selected object" onClick={deleteSelectedObject}>
            <Trash2 size={15} aria-hidden />
          </button>
        </div>
      </div>

      <div className="scene-root">
        <span className="root-dot" />
        <strong>{activeSceneName}</strong>
        <small>{sceneObjects.length} objects</small>
      </div>

      <div className="hierarchy-list">
        {sceneObjects.map((object) => (
          <HierarchyRow key={object.id} object={object} />
        ))}
      </div>
    </aside>
  );
}
