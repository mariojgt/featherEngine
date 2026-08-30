import { useEffect, useMemo, useRef, useState } from 'react';
import { Aperture, Box, Boxes, Camera, ChevronDown, ChevronRight, Circle, FilePlus2, LampDesk, Mountain, Search, Square, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { useEditorStore } from '../store/editorStore';
import { useThrottledActiveObjects } from '../store/stableSelectors';
import { useProjectStore } from '../store/projectStore';
import { focusWorkspacePanel } from './workspacePanels';
import { ContextMenu, type ContextMenuEntry, type ContextMenuState } from './ContextMenu';
import type { SceneObject, SceneObjectKind } from '../types';
import { useCollaborationStore, type CollaborationParticipant } from '../store/collaborationStore';
import { collaboratorsOnObject } from '../collaboration/presence';
import { CollaboratorAvatars } from './CollaboratorAvatars';
import { findCreatorRole } from '../creator/roles';
import { isPrefabInstanceRoot } from '../store/editor/prefabMerge';

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
  renaming,
  renameDraft,
  onRenameDraftChange,
  onCommitRename,
  onCancelRename,
  onStartRename,
  collaborators,
}: {
  object: SceneObject;
  depth: number;
  childCount: number;
  collapsed: boolean;
  onToggleCollapse: (id: string) => void;
  onContextMenu: (event: React.MouseEvent, object: SceneObject) => void;
  renaming: boolean;
  renameDraft: string;
  onRenameDraftChange: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onStartRename: (object: SceneObject) => void;
  collaborators: readonly CollaborationParticipant[];
}) {
  const selectedObjectId = useEditorStore((state) => state.selectedObjectId);
  const selectedObjectIds = useEditorStore((state) => state.selectedObjectIds);
  const selectObject = useEditorStore((state) => state.selectObject);
  const toggleSelectObject = useEditorStore((state) => state.toggleSelectObject);
  const openObjectScript = useEditorStore((state) => state.openObjectScript);
  const setObjectParent = useEditorStore((state) => state.setObjectParent);
  const Icon = object.reflectionProbe?.enabled ? Aperture : objectIcon[object.kind];
  const creatorRole = object.creatorRoleId ? findCreatorRole(object.creatorRoleId) : undefined;
  const hasChildren = childCount > 0;
  const isInstance = Boolean(object.prefabSourceId);
  // Highlight the whole multi-selection when it's active, otherwise just the single selected object.
  const isMulti = selectedObjectIds.includes(selectedObjectId);
  const isSelected = isMulti ? selectedObjectIds.includes(object.id) : selectedObjectId === object.id;
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) renameRef.current?.focus();
  }, [renaming]);

  return (
    <button
      className={clsx('hierarchy-row', isSelected && 'selected', collaborators.length > 0 && 'has-collaborator')}
      style={{
        paddingLeft: 8 + depth * 14,
        '--collaborator-color': collaborators[0]?.color,
      } as React.CSSProperties}
      onClick={(event) => {
        if (renaming) return;
        // Shift/Ctrl/Cmd-click extends the selection; a plain click replaces it.
        if (event.shiftKey || event.metaKey || event.ctrlKey) toggleSelectObject(object.id);
        else selectObject(object.id);
      }}
      onDoubleClick={() => {
        if (renaming) return;
        // Open the object's blueprint (creating + attaching one if it has none)
        // and reveal the Scripting panel.
        openObjectScript(object.id);
        focusWorkspacePanel('scripting');
      }}
      onContextMenu={(event) => onContextMenu(event, object)}
      // Drag a row onto another to nest it under that object (set parent). Drop on the panel
      // background (handled by the list) to detach to the scene root.
      draggable={!renaming}
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
      title={`${object.name}${creatorRole ? ` · ${creatorRole.name}` : ''}${hasChildren ? ` · ${childCount} child${childCount > 1 ? 'ren' : ''}` : ''}${isInstance ? ' · prefab instance' : ''} — F2 to rename, double-click to edit its script, right-click for options`}
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
          {collapsed ? <ChevronRight size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
        </span>
      ) : (
        <span className="hierarchy-twisty placeholder" aria-hidden />
      )}
      {isInstance && <Boxes size={14} className="hierarchy-instance-glyph" aria-hidden />}
      {creatorRole ? (
        <span className="hierarchy-role-icon" title={creatorRole.name} aria-hidden>{creatorRole.icon}</span>
      ) : !isInstance ? (
        <Icon size={14} aria-hidden />
      ) : null}
      {renaming ? (
        <input
          ref={renameRef}
          className="hierarchy-rename-input"
          value={renameDraft}
          spellCheck={false}
          onChange={(event) => onRenameDraftChange(event.target.value)}
          onBlur={onCommitRename}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onCommitRename();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              onCancelRename();
            }
          }}
        />
      ) : (
        <span
          className="hierarchy-label"
          onDoubleClick={(event) => {
            // Slow path: Alt+double-click renames; plain double-click still opens scripts above.
            if (!event.altKey) return;
            event.preventDefault();
            event.stopPropagation();
            onStartRename(object);
          }}
        >
          {object.name}
        </span>
      )}
      {creatorRole && <small className="hierarchy-role-badge">{creatorRole.name}</small>}
      {hasChildren && collapsed && <small className="hierarchy-count">{childCount}</small>}
      <CollaboratorAvatars participants={collaborators} compact label={`is editing ${object.name}`} />
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
  // Throttled (~4Hz in Play): gameplay VFX spawns are real objects, so every drift puff/explosion was
  // a structural change re-rendering all rows — the hierarchy is display-only, 250ms latency is fine.
  const sceneObjects = useThrottledActiveObjects();
  const activeSceneName = useEditorStore((state) => state.activeScene()?.name ?? 'Scene');
  const activeSceneId = useEditorStore((state) => state.activeSceneId);
  const editingPrefabId = useEditorStore((state) => state.editingPrefabId);
  const selectedObjectId = useEditorStore((state) => state.selectedObjectId);
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
  const renameObject = useEditorStore((state) => state.renameObject);
  const prefabs = useEditorStore((state) => state.prefabs);
  const collaborationParticipants = useCollaborationStore((state) => state.participants);
  const collaboratorsByObject = useMemo(() => {
    const result = new Map<string, CollaborationParticipant[]>();
    for (const object of sceneObjects) {
      const collaborators = collaboratorsOnObject(collaborationParticipants, activeSceneId, object.id);
      if (collaborators.length > 0) result.set(object.id, collaborators);
    }
    return result;
  }, [activeSceneId, collaborationParticipants, sceneObjects]);

  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  // When filtering, we show a FLAT list of name matches (nesting is irrelevant when hunting for an
  // object by name) — much clearer than trying to preserve the tree around scattered matches.
  const filterText = query.trim().toLowerCase();
  const filteredObjects = useMemo(
    () => (filterText ? sceneObjects.filter((object) => object.name.toLowerCase().includes(filterText)) : []),
    [filterText, sceneObjects],
  );

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

  // Depth-first visible row order (respects collapse / filter) for keyboard navigation.
  const visibleRows = useMemo(() => {
    if (filterText) return filteredObjects;
    const rows: SceneObject[] = [];
    const walk = (parentId: string | undefined) => {
      (childrenByParent.get(parentId) ?? []).forEach((object) => {
        rows.push(object);
        if (!collapsed.has(object.id)) walk(object.id);
      });
    };
    walk(undefined);
    return rows;
  }, [filterText, filteredObjects, childrenByParent, collapsed]);

  const startRename = (object: SceneObject) => {
    setRenamingId(object.id);
    setRenameDraft(object.name);
  };

  const commitRename = () => {
    if (!renamingId) return;
    const next = renameDraft.trim();
    if (next) renameObject(renamingId, next);
    setRenamingId(null);
  };

  const cancelRename = () => setRenamingId(null);

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
    // Only an instance root gets Apply/Revert. Running either operation on a tagged limb used to
    // replace that limb as though it were the entire character and sever the hierarchy's live link.
    const sourcePrefab = isPrefabInstanceRoot(sceneObjects, object)
      ? prefabs.find((prefab) => prefab.id === object.prefabSourceId)
      : undefined;
    const instanceEntries: ContextMenuEntry[] = sourcePrefab
      ? [
          {
            label: `Apply changes to "${sourcePrefab.name}"`,
            onClick: () => {
              const id = applyInstanceToPrefab(object.id);
              useProjectStore.setState({
                toast: id
                  ? { kind: 'success', message: `Updated prefab "${sourcePrefab.name}" — linked instances received the change.` }
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
      { label: 'Rename', onClick: () => startRename(object) },
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

  // F2 rename when hierarchy (or the app) has focus and we're not typing elsewhere.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'F2') return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      const selected = useEditorStore.getState().selectedObject();
      if (!selected) return;
      event.preventDefault();
      startRename(selected);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const onListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (renamingId) return;
    if (!visibleRows.length) return;
    const index = Math.max(
      0,
      visibleRows.findIndex((object) => object.id === selectedObjectId),
    );
    const current = visibleRows[index];

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = visibleRows[Math.min(index + 1, visibleRows.length - 1)];
      if (next) selectObject(next.id);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const prev = visibleRows[Math.max(index - 1, 0)];
      if (prev) selectObject(prev.id);
      return;
    }
    if (event.key === 'ArrowLeft' && current) {
      event.preventDefault();
      const kids = childrenByParent.get(current.id) ?? [];
      if (kids.length && !collapsed.has(current.id) && !filterText) {
        toggleCollapse(current.id);
      } else if (current.parentId) {
        selectObject(current.parentId);
      }
      return;
    }
    if (event.key === 'ArrowRight' && current) {
      event.preventDefault();
      const kids = childrenByParent.get(current.id) ?? [];
      if (kids.length && collapsed.has(current.id) && !filterText) {
        toggleCollapse(current.id);
      } else if (kids.length && !filterText) {
        selectObject(kids[0].id);
      }
      return;
    }
    if ((event.key === 'Enter' || event.key.toLowerCase() === 'f') && current) {
      event.preventDefault();
      window.dispatchEvent(new CustomEvent('nf:focus-selection'));
    }
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
            renaming={renamingId === object.id}
            renameDraft={renameDraft}
            onRenameDraftChange={setRenameDraft}
            onCommitRename={commitRename}
            onCancelRename={cancelRename}
            onStartRename={startRename}
            collaborators={collaboratorsByObject.get(object.id) ?? []}
          />
          {kids.length > 0 && !isCollapsed && renderRows(object.id, depth + 1)}
        </div>
      );
    });

  return (
    <aside className="panel hierarchy-panel">
      {/* No title here: the dock tab says "Objects" and the scene-root row below already names the
          scene (or the prefab being edited, with its own icon). The row is just the actions. */}
      <div className="panel-header panel-header-actions-only">
        <div className="panel-actions">
          <button className="icon-button compact" title="Create empty object" onClick={() => createObject('empty')}>
            <FilePlus2 size={14} aria-hidden />
          </button>
          <button className="icon-button compact danger" title="Delete selected object" onClick={deleteSelectedObject}>
            <Trash2 size={14} aria-hidden />
          </button>
        </div>
      </div>

      <label className="search-field hierarchy-search">
        <Search size={14} aria-hidden />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search objects…" spellCheck={false} />
      </label>

      <div className="scene-root">
        <span className="root-dot" />
        {editingPrefabId ? <Boxes size={14} aria-hidden /> : null}
        <strong>{activeSceneName}</strong>
        <small>{filterText ? `${filteredObjects.length} of ${sceneObjects.length}` : `${sceneObjects.length} objects`}</small>
      </div>

      {/* Dropping a dragged row onto the empty list area detaches it to the scene root. */}
      <div
        ref={listRef}
        className="hierarchy-list"
        tabIndex={0}
        onKeyDown={onListKeyDown}
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
        {filterText ? (
          filteredObjects.length > 0 ? (
            filteredObjects.map((object) => (
              <HierarchyRow
                key={object.id}
                object={object}
                depth={0}
                childCount={0}
                collapsed={false}
                onToggleCollapse={toggleCollapse}
                onContextMenu={openRowMenu}
                renaming={renamingId === object.id}
                renameDraft={renameDraft}
                onRenameDraftChange={setRenameDraft}
                onCommitRename={commitRename}
                onCancelRename={cancelRename}
                onStartRename={startRename}
                collaborators={collaboratorsByObject.get(object.id) ?? []}
              />
            ))
          ) : (
            <div className="empty-state compact">No objects match “{query}”</div>
          )
        ) : (
          renderRows(undefined, 0)
        )}
      </div>

      <ContextMenu state={menu} onClose={() => setMenu(null)} />
    </aside>
  );
}
