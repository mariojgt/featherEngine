import { useMemo, useState } from 'react';
import { Box, Boxes, Camera, ChevronDown, ChevronRight, Circle, FilePlus2, LampDesk, Mountain, Square, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { useEditorStore } from '../store/editorStore';
import { useStableActiveObjects } from '../store/stableSelectors';
import { useProjectStore } from '../store/projectStore';
import { focusWorkspacePanel } from './workspacePanels';
import { ContextMenu, type ContextMenuEntry, type ContextMenuState } from './ContextMenu';
import type { SceneObject, SceneObjectKind } from '../types';

const objectIcon: Record<SceneObjectKind, typeof Box> = {
  empty: Square,
  cube: Box,
  sphere: Circle,
  capsule: Box,
  plane: Square,
  light: LampDesk,
  camera: Camera,
  terrain: Mountain,
};

// Kinds offered in the "Add child" context-menu submenu (flat — ContextMenu has no nesting).
const childKinds: Array<{ kind: SceneObjectKind; label: string }> = [
  { kind: 'empty', label: 'Empty' },
  { kind: 'cube', label: 'Cube' },
  { kind: 'sphere', label: 'Sphere' },
  { kind: 'capsule', label: 'Capsule' },
  { kind: 'terrain', label: 'Terrain' },
  { kind: 'light', label: 'Light' },
  { kind: 'camera', label: 'Camera' },
];

function HierarchyRow({
  object,
  depth,
  childCount,
  collapsed,
  onToggleCollapse,
  onContextMenu,
}: {
  object: SceneObject;
  depth: number;
  childCount: number;
  collapsed: boolean;
  onToggleCollapse: (id: string) => void;
  onContextMenu: (event: React.MouseEvent, object: SceneObject) => void;
}) {
  const selectedObjectId = useEditorStore((state) => state.selectedObjectId);
  const selectedObjectIds = useEditorStore((state) => state.selectedObjectIds);
  const selectObject = useEditorStore((state) => state.selectObject);
  const toggleSelectObject = useEditorStore((state) => state.toggleSelectObject);
  const openObjectScript = useEditorStore((state) => state.openObjectScript);
  const setObjectParent = useEditorStore((state) => state.setObjectParent);
  const Icon = objectIcon[object.kind];
  const hasChildren = childCount > 0;
  const isInstance = Boolean(object.prefabSourceId);
  // Highlight the whole multi-selection when it's active, otherwise just the single selected object.
  const isMulti = selectedObjectIds.includes(selectedObjectId);
  const isSelected = isMulti ? selectedObjectIds.includes(object.id) : selectedObjectId === object.id;

  return (
    <button
      className={clsx('hierarchy-row', isSelected && 'selected')}
      style={{ paddingLeft: 8 + depth * 14 }}
      onClick={(event) => {
        // Shift/Ctrl/Cmd-click extends the selection; a plain click replaces it.
        if (event.shiftKey || event.metaKey || event.ctrlKey) toggleSelectObject(object.id);
        else selectObject(object.id);
      }}
      onDoubleClick={() => {
        // Open the object's blueprint (creating + attaching one if it has none)
        // and reveal the Scripting panel.
        openObjectScript(object.id);
        focusWorkspacePanel('scripting');
      }}
      onContextMenu={(event) => onContextMenu(event, object)}
      // Drag a row onto another to nest it under that object (set parent). Drop on the panel
      // background (handled by the list) to detach to the scene root.
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData('application/x-nodeforge-object', object.id);
        event.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('application/x-nodeforge-object')) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
        }
      }}
      onDrop={(event) => {
        const draggedId = event.dataTransfer.getData('application/x-nodeforge-object');
        if (draggedId && draggedId !== object.id) {
          event.preventDefault();
          event.stopPropagation();
          setObjectParent(draggedId, object.id);
        }
      }}
      title={`${object.name}${hasChildren ? ` · ${childCount} child${childCount > 1 ? 'ren' : ''}` : ''}${isInstance ? ' · prefab instance' : ''} — double-click to edit its script, right-click for options`}
    >
      {hasChildren ? (
        <span
          className="hierarchy-twisty"
          role="button"
          aria-label={collapsed ? 'Expand' : 'Collapse'}
          onClick={(event) => {
            event.stopPropagation();
            onToggleCollapse(object.id);
          }}
        >
          {collapsed ? <ChevronRight size={13} aria-hidden /> : <ChevronDown size={13} aria-hidden />}
        </span>
      ) : (
        <span className="hierarchy-twisty placeholder" aria-hidden />
      )}
      {isInstance ? <Boxes size={14} className="hierarchy-instance-glyph" aria-hidden /> : <Icon size={15} aria-hidden />}
      <span className="hierarchy-label">{object.name}</span>
      {hasChildren && collapsed && <small className="hierarchy-count">{childCount}</small>}
    </button>
  );
}

export function HierarchyPanel() {
  // The runtime tick (Play) rebuilds the objects array every frame, so subscribing to it directly would
  // re-render this whole tree 60×/sec — a major FPS sink in object-heavy scenes (the hierarchy doesn't even
  // show transforms). Subscribe instead to a STRUCTURAL SIGNATURE (id/name/kind/parent/prefab) that only
  // changes when the tree actually changes; the object list is then a stable ref derived from it.
  // (Shared structurally-stable hook — its token signature is also far cheaper per tick than the
  // per-object string this used to build on every frame.)
  const sceneObjects = useStableActiveObjects();
  const activeSceneName = useEditorStore((state) => state.activeScene()?.name ?? 'Scene');
  const editingPrefabId = useEditorStore((state) => state.editingPrefabId);
  const createObject = useEditorStore((state) => state.createObject);
  const createObjectWithProps = useEditorStore((state) => state.createObjectWithProps);
  const deleteSelectedObject = useEditorStore((state) => state.deleteSelectedObject);
  const deleteObject = useEditorStore((state) => state.deleteObject);
  const selectObject = useEditorStore((state) => state.selectObject);
  const duplicateSelectedObject = useEditorStore((state) => state.duplicateSelectedObject);
  const copySelectedObjects = useEditorStore((state) => state.copySelectedObjects);
  const pasteClipboard = useEditorStore((state) => state.pasteClipboard);
  const groupSelectedObjects = useEditorStore((state) => state.groupSelectedObjects);
  const ungroupObject = useEditorStore((state) => state.ungroupObject);
  const setObjectParent = useEditorStore((state) => state.setObjectParent);
  const createPrefabFromObject = useEditorStore((state) => state.createPrefabFromObject);
  const applyInstanceToPrefab = useEditorStore((state) => state.applyInstanceToPrefab);
  const revertInstanceToPrefab = useEditorStore((state) => state.revertInstanceToPrefab);
  const prefabs = useEditorStore((state) => state.prefabs);

  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggleCollapse = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // Group objects by parent so we can render the parentId hierarchy as an indented tree. Objects
  // whose parent is missing (or undefined) render at the root.
  const childrenByParent = useMemo(() => {
    const ids = new Set(sceneObjects.map((object) => object.id));
    const map = new Map<string | undefined, SceneObject[]>();
    sceneObjects.forEach((object) => {
      const key = object.parentId && ids.has(object.parentId) ? object.parentId : undefined;
      map.set(key, [...(map.get(key) ?? []), object]);
    });
    return map;
  }, [sceneObjects]);

  const makePrefab = (object: SceneObject) => {
    const id = createPrefabFromObject(object.id);
    useProjectStore.setState({
      toast: id
        ? { kind: 'success', message: `Saved "${object.name}" as a prefab — find it in the Project browser.` }
        : { kind: 'error', message: `Couldn't create a prefab from "${object.name}".` },
    });
  };

  const openRowMenu = (event: React.MouseEvent, object: SceneObject) => {
    event.preventDefault();
    event.stopPropagation();
    // Keep an existing multi-selection if you right-click one of its members; otherwise select this row.
    const sel = useEditorStore.getState();
    const inSelection = sel.selectedObjectIds.includes(sel.selectedObjectId)
      ? sel.selectedObjectIds.includes(object.id)
      : sel.selectedObjectId === object.id;
    if (!inSelection) selectObject(object.id);
    const isEmptyGroup = object.kind === 'empty' && (childrenByParent.get(object.id) ?? []).length > 0;
    // Instance roots (carrying a still-existing prefabSourceId) get apply/revert actions.
    const sourcePrefab = object.prefabSourceId ? prefabs.find((prefab) => prefab.id === object.prefabSourceId) : undefined;
    const instanceEntries: ContextMenuEntry[] = sourcePrefab
      ? [
          {
            label: `Apply changes to "${sourcePrefab.name}"`,
            onClick: () => {
              const id = applyInstanceToPrefab(object.id);
              useProjectStore.setState({
                toast: id
                  ? { kind: 'success', message: `Updated prefab "${sourcePrefab.name}" — future instances use these changes.` }
                  : { kind: 'error', message: `Couldn't apply changes to "${sourcePrefab.name}".` },
              });
            },
          },
          {
            label: `Revert to "${sourcePrefab.name}"`,
            onClick: () => {
              revertInstanceToPrefab(object.id);
              useProjectStore.setState({
                toast: { kind: 'success', message: `Reverted instance to prefab "${sourcePrefab.name}".` },
              });
            },
          },
          'separator',
        ]
      : [];
    const items: ContextMenuEntry[] = [
      { label: 'Create Prefab', onClick: () => makePrefab(object) },
      'separator',
      ...instanceEntries,
      ...childKinds.map<ContextMenuEntry>(({ kind, label }) => ({
        label: `Add child: ${label}`,
        onClick: () => createObjectWithProps(kind, { parentId: object.id }),
      })),
      'separator',
      { label: 'Duplicate', onClick: () => duplicateSelectedObject() },
      { label: 'Copy', onClick: () => copySelectedObjects() },
      { label: 'Paste', onClick: () => pasteClipboard() },
      'separator',
      { label: 'Group selection', onClick: () => groupSelectedObjects() },
      ...(isEmptyGroup ? ([{ label: 'Ungroup', onClick: () => ungroupObject(object.id) }] as ContextMenuEntry[]) : []),
      ...(object.parentId
        ? ([{ label: 'Unparent (move to root)', onClick: () => setObjectParent(object.id, undefined) }] as ContextMenuEntry[])
        : []),
      'separator',
      { label: 'Delete', danger: true, onClick: () => deleteObject(object.id) },
    ];
    setMenu({ x: event.clientX, y: event.clientY, items });
  };

  const renderRows = (parentId: string | undefined, depth: number): React.ReactNode =>
    (childrenByParent.get(parentId) ?? []).map((object) => {
      const kids = childrenByParent.get(object.id) ?? [];
      const isCollapsed = collapsed.has(object.id);
      return (
        <div key={object.id}>
          <HierarchyRow
            object={object}
            depth={depth}
            childCount={kids.length}
            collapsed={isCollapsed}
            onToggleCollapse={toggleCollapse}
            onContextMenu={openRowMenu}
          />
          {kids.length > 0 && !isCollapsed && renderRows(object.id, depth + 1)}
        </div>
      );
    });

  return (
    <aside className="panel hierarchy-panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">{editingPrefabId ? 'Prefab' : 'Scene'}</span>
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
        {editingPrefabId ? <Boxes size={14} aria-hidden /> : null}
        <strong>{activeSceneName}</strong>
        <small>{sceneObjects.length} objects</small>
      </div>

      {/* Dropping a dragged row onto the empty list area detaches it to the scene root. */}
      <div
        className="hierarchy-list"
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('application/x-nodeforge-object')) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
          }
        }}
        onDrop={(event) => {
          const draggedId = event.dataTransfer.getData('application/x-nodeforge-object');
          if (draggedId) {
            event.preventDefault();
            setObjectParent(draggedId, undefined);
          }
        }}
      >
        {renderRows(undefined, 0)}
      </div>

      <ContextMenu state={menu} onClose={() => setMenu(null)} />
    </aside>
  );
}
