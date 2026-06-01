import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  ChevronDown,
  ChevronRight,
  Folder,
  GitBranch,
  Image,
  Music,
  Palette,
  Search,
  Table2,
  Upload,
} from 'lucide-react';
import clsx from 'clsx';
import { useEditorStore } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import { getPlatform } from '../platform';
import { fbxToGlb } from '../three/convertModel';
import { ContextMenu, type ContextMenuEntry, type ContextMenuState } from './ContextMenu';
import { ASSET_DRAG_TYPE, assetDrag, hasDragType } from './dragShared';
import { focusWorkspacePanel } from './workspacePanels';
import type { AssetItem, AssetType, DataAsset, MaterialDefinition, ProjectFolder, ScriptBlueprint } from '../types';

const formatBytes = (bytes: number) => {
  if (!bytes) return '0 KB';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
};

const detectType = (name: string): AssetType => {
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'glb' || ext === 'gltf') return 'model';
  if (['png', 'jpg', 'jpeg'].includes(ext ?? '')) return 'image';
  if (['mp3', 'wav'].includes(ext ?? '')) return 'audio';
  return 'unknown';
};

/** Extensions the browser accepts — keep in sync with the file picker's `accept` attribute. */
const ACCEPTED_EXT = new Set(['glb', 'gltf', 'fbx', 'png', 'jpg', 'jpeg', 'mp3', 'wav']);
const isAccepted = (name: string) => ACCEPTED_EXT.has(name.split('.').pop()?.toLowerCase() ?? '');

const assetGlyph = (type: AssetType) => (type === 'audio' ? Music : type === 'image' ? Image : Box);

type DragItem = { kind: 'asset' | 'blueprint' | 'dataAsset' | 'material'; id: string } | null;

export function AssetBrowser() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<DragItem>(null);
  const importTargetRef = useRef<string | undefined>(undefined);

  const assets = useEditorStore((state) => state.assets);
  const folders = useEditorStore((state) => state.folders);
  const blueprints = useEditorStore((state) => state.blueprints);
  const dataAssets = useEditorStore((state) => state.dataAssets);
  const activeBlueprintId = useEditorStore((state) => state.activeBlueprintId);
  const assetSearch = useEditorStore((state) => state.assetSearch);
  const setAssetSearch = useEditorStore((state) => state.setAssetSearch);
  const addAssetItems = useEditorStore((state) => state.addAssetItems);
  const removeAsset = useEditorStore((state) => state.removeAsset);
  const renameAsset = useEditorStore((state) => state.renameAsset);
  const createFolder = useEditorStore((state) => state.createFolder);
  const renameFolder = useEditorStore((state) => state.renameFolder);
  const deleteFolder = useEditorStore((state) => state.deleteFolder);
  const moveToFolder = useEditorStore((state) => state.moveToFolder);
  const createBlueprintNamed = useEditorStore((state) => state.createBlueprintNamed);
  const setActiveBlueprint = useEditorStore((state) => state.setActiveBlueprint);
  const renameBlueprint = useEditorStore((state) => state.renameBlueprint);
  const deleteBlueprint = useEditorStore((state) => state.deleteBlueprint);
  const createDataAsset = useEditorStore((state) => state.createDataAsset);
  const renameDataAsset = useEditorStore((state) => state.renameDataAsset);
  const deleteDataAsset = useEditorStore((state) => state.deleteDataAsset);
  const materials = useEditorStore((state) => state.materials);
  const activeMaterialId = useEditorStore((state) => state.activeMaterialId);
  const createMaterial = useEditorStore((state) => state.createMaterial);
  const renameMaterial = useEditorStore((state) => state.renameMaterial);
  const deleteMaterial = useEditorStore((state) => state.deleteMaterial);
  const setActiveMaterial = useEditorStore((state) => state.setActiveMaterial);
  const projectDir = useProjectStore((state) => state.projectDir);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedFolderId, setSelectedFolderId] = useState<string | undefined>(undefined);
  const [renaming, setRenaming] = useState<{ kind: 'folder' | 'blueprint' | 'asset' | 'dataAsset' | 'material'; id: string } | null>(null);
  const [draft, setDraft] = useState('');
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [dropTarget, setDropTarget] = useState<string | 'root' | null>(null);

  // Safety net: a file dropped anywhere outside our drop zones would otherwise make the browser
  // navigate to it and discard the project. Swallow those stray drops globally.
  useEffect(() => {
    const prevent = (event: DragEvent) => {
      if (hasDragType(event.dataTransfer, 'Files')) event.preventDefault();
    };
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
    };
  }, []);

  const childFolders = useMemo(() => {
    const map = new Map<string | undefined, ProjectFolder[]>();
    folders.forEach((folder) => {
      const key = folder.parentId;
      map.set(key, [...(map.get(key) ?? []), folder]);
    });
    return map;
  }, [folders]);

  const importFiles = async (files: FileList | File[], folderId?: string) => {
    const all = Array.from(files);
    const platform = await getPlatform();
    const dir = projectDir ?? 'web';
    const items: AssetItem[] = [];
    let strippedTextures = false;
    // Drag-and-drop bypasses the picker's `accept`, so filter to supported types here.
    for (const original of all.filter((file) => isAccepted(file.name))) {
      try {
        // FBX is converted to GLB on import so storage/rendering/export only deal with glTF.
        // The whole selection is passed along so the FBX's sibling texture images resolve.
        let file = original;
        if (/\.fbx$/i.test(original.name)) {
          const converted = await fbxToGlb(original, all);
          file = converted.file;
          if (converted.droppedTextures > 0) strippedTextures = true;
        }
        const { path, url } = await platform.importAsset(dir, file);
        items.push({
          id: `asset-${crypto.randomUUID()}`,
          name: file.name,
          type: detectType(file.name),
          size: file.size,
          path,
          url,
          folderId,
          createdAt: Date.now(),
        });
      } catch (error) {
        // Don't fail the whole batch — log and surface this one file, keep importing the rest.
        console.error(`Import failed for "${original.name}":`, error);
        const reason = error instanceof Error ? error.message : 'unknown error';
        useProjectStore.setState({
          toast: { kind: 'error', message: `Couldn't import "${original.name}": ${reason}` },
        });
      }
    }
    if (items.length) addAssetItems(items);
    if (strippedTextures) {
      useProjectStore.setState({
        toast: {
          kind: 'success',
          message: 'Model imported without some textures. Re-import the .fbx together with its texture images (select them all at once) to keep them.',
        },
      });
    }
  };

  const startRename = (kind: 'folder' | 'blueprint' | 'asset' | 'dataAsset' | 'material', id: string, current: string) => {
    setRenaming({ kind, id });
    setDraft(current);
  };

  const commitRename = () => {
    if (!renaming) return;
    const name = draft.trim();
    if (name) {
      if (renaming.kind === 'folder') renameFolder(renaming.id, name);
      else if (renaming.kind === 'blueprint') renameBlueprint(renaming.id, name);
      else if (renaming.kind === 'dataAsset') renameDataAsset(renaming.id, name);
      else if (renaming.kind === 'material') renameMaterial(renaming.id, name);
      else renameAsset(renaming.id, name);
    }
    setRenaming(null);
  };

  const triggerImport = (folderId?: string) => {
    importTargetRef.current = folderId;
    fileInputRef.current?.click();
  };

  const newFolder = (parentId?: string) => {
    const id = createFolder('New Folder', parentId);
    if (parentId) setCollapsed((prev) => new Set([...prev].filter((value) => value !== parentId)));
    startRename('folder', id, 'New Folder');
  };

  const newBlueprint = (folderId?: string) => {
    const { blueprintId } = createBlueprintNamed(undefined, undefined, folderId);
    if (folderId) setCollapsed((prev) => new Set([...prev].filter((value) => value !== folderId)));
    startRename('blueprint', blueprintId, blueprints.length ? `Blueprint ${blueprints.length + 1}` : 'Blueprint 1');
  };

  const newDataAsset = (folderId?: string) => {
    const id = createDataAsset(undefined, folderId);
    if (folderId) setCollapsed((prev) => new Set([...prev].filter((value) => value !== folderId)));
    startRename('dataAsset', id, dataAssets.length ? `Data Asset ${dataAssets.length + 1}` : 'Data Asset 1');
  };

  const newMaterial = (folderId?: string) => {
    const id = createMaterial(undefined, undefined, folderId);
    if (folderId) setCollapsed((prev) => new Set([...prev].filter((value) => value !== folderId)));
    startRename('material', id, materials.length ? `Material ${materials.length + 1}` : 'Material 1');
  };

  const openMaterial = (id: string) => {
    setActiveMaterial(id);
    focusWorkspacePanel('materials');
  };

  const openMenu = (event: React.MouseEvent, items: ContextMenuState['items']) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY, items });
  };

  const handleDrop = (event: React.DragEvent, folderId?: string) => {
    setDropTarget(null);
    // External files dropped from the OS (Finder/Explorer) → import into this folder.
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      event.preventDefault();
      void importFiles(files, folderId);
      dragRef.current = null;
      return;
    }
    // Otherwise it's an internal drag, re-homing an existing asset/blueprint.
    const dragged = dragRef.current;
    if (dragged) moveToFolder(dragged.kind, dragged.id, folderId);
    dragRef.current = null;
  };

  // Context-menu entries to move an item between folders. Membership is purely organizational —
  // scene objects/nodes reference the asset by id, so moving it never breaks those references.
  const moveEntries = (
    kind: 'asset' | 'blueprint' | 'dataAsset' | 'material',
    id: string,
    currentFolderId?: string,
  ): ContextMenuEntry[] => {
    const entries: ContextMenuEntry[] = [];
    if (currentFolderId) {
      entries.push({ label: 'Remove from folder', onClick: () => moveToFolder(kind, id, undefined) });
    }
    folders
      .filter((folder) => folder.id !== currentFolderId)
      .forEach((folder) =>
        entries.push({ label: `Move to: ${folder.name}`, onClick: () => moveToFolder(kind, id, folder.id) }),
      );
    return entries;
  };

  const RenameInput = ({ onCommit }: { onCommit: () => void }) => (
    <input
      className="tree-rename"
      value={draft}
      autoFocus
      onChange={(event) => setDraft(event.target.value)}
      onBlur={onCommit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onCommit();
        if (event.key === 'Escape') setRenaming(null);
      }}
      onClick={(event) => event.stopPropagation()}
    />
  );

  const renderBlueprint = (blueprint: ScriptBlueprint, depth: number) => (
    <button
      key={blueprint.id}
      className={clsx('tree-row', activeBlueprintId === blueprint.id && 'active')}
      style={{ paddingLeft: 8 + depth * 14 }}
      draggable
      onDragStart={() => (dragRef.current = { kind: 'blueprint', id: blueprint.id })}
      onDoubleClick={() => setActiveBlueprint(blueprint.id)}
      onClick={() => setActiveBlueprint(blueprint.id)}
      onContextMenu={(event) =>
        openMenu(event, [
          { label: 'Open in Scripting', onClick: () => setActiveBlueprint(blueprint.id) },
          { label: 'Rename', onClick: () => startRename('blueprint', blueprint.id, blueprint.name) },
          ...moveEntries('blueprint', blueprint.id, blueprint.folderId),
          'separator',
          { label: 'Delete', danger: true, onClick: () => deleteBlueprint(blueprint.id) },
        ])
      }
    >
      <GitBranch size={14} style={{ color: blueprint.color }} aria-hidden />
      {renaming?.kind === 'blueprint' && renaming.id === blueprint.id ? (
        <RenameInput onCommit={commitRename} />
      ) : (
        <span className="tree-label">{blueprint.name}</span>
      )}
    </button>
  );

  const renderDataAsset = (dataAsset: DataAsset, depth: number) => (
    <button
      key={dataAsset.id}
      className="tree-row"
      style={{ paddingLeft: 8 + depth * 14 }}
      draggable
      onDragStart={() => (dragRef.current = { kind: 'dataAsset', id: dataAsset.id })}
      title={`${dataAsset.columns.length} columns · ${dataAsset.rows.length} rows`}
      onContextMenu={(event) =>
        openMenu(event, [
          { label: 'Rename', onClick: () => startRename('dataAsset', dataAsset.id, dataAsset.name) },
          ...moveEntries('dataAsset', dataAsset.id, dataAsset.folderId),
          'separator',
          { label: 'Delete Data Asset', danger: true, onClick: () => deleteDataAsset(dataAsset.id) },
        ])
      }
    >
      <Table2 size={14} style={{ color: '#F0D46A' }} aria-hidden />
      {renaming?.kind === 'dataAsset' && renaming.id === dataAsset.id ? (
        <RenameInput onCommit={commitRename} />
      ) : (
        <span className="tree-label">{dataAsset.name}</span>
      )}
    </button>
  );

  const renderMaterial = (material: MaterialDefinition, depth: number) => (
    <button
      key={material.id}
      className={clsx('tree-row', activeMaterialId === material.id && 'active')}
      style={{ paddingLeft: 8 + depth * 14 }}
      draggable
      onDragStart={() => (dragRef.current = { kind: 'material', id: material.id })}
      onDoubleClick={() => openMaterial(material.id)}
      onClick={() => openMaterial(material.id)}
      title={`material · ${material.color}`}
      onContextMenu={(event) =>
        openMenu(event, [
          { label: 'Edit in Material', onClick: () => openMaterial(material.id) },
          { label: 'Rename', onClick: () => startRename('material', material.id, material.name) },
          ...moveEntries('material', material.id, material.folderId),
          'separator',
          { label: 'Delete material', danger: true, onClick: () => deleteMaterial(material.id) },
        ])
      }
    >
      <Palette size={14} style={{ color: material.color }} aria-hidden />
      {renaming?.kind === 'material' && renaming.id === material.id ? (
        <RenameInput onCommit={commitRename} />
      ) : (
        <span className="tree-label">{material.name}</span>
      )}
    </button>
  );

  const renderAsset = (asset: AssetItem, depth: number) => {
    const Glyph = assetGlyph(asset.type);
    return (
      <button
        key={asset.id}
        className="tree-row"
        style={{ paddingLeft: 8 + depth * 14 }}
        draggable
        onDragStart={(event) => {
          dragRef.current = { kind: 'asset', id: asset.id };
          // Carry the id both ways: dataTransfer for standards, and the shared holder as a
          // fallback for webviews that strip custom types during dragover (Tauri WKWebView).
          assetDrag.id = asset.id;
          event.dataTransfer.setData(ASSET_DRAG_TYPE, asset.id);
          event.dataTransfer.effectAllowed = 'copyMove';
        }}
        onDragEnd={() => {
          assetDrag.id = null;
        }}
        title={`${asset.type} · ${formatBytes(asset.size)}${asset.unresolved ? ' · missing file' : ''}`}
        onContextMenu={(event) =>
          openMenu(event, [
            { label: 'Rename', onClick: () => startRename('asset', asset.id, asset.name) },
            ...moveEntries('asset', asset.id, asset.folderId),
            'separator',
            { label: 'Delete asset', danger: true, onClick: () => removeAsset(asset.id) },
          ])
        }
      >
        {asset.type === 'image' && asset.url && !asset.unresolved ? (
          <img className="tree-thumb" src={asset.url} alt="" />
        ) : (
          <Glyph size={14} className={clsx(asset.unresolved && 'tree-unresolved')} aria-hidden />
        )}
        {renaming?.kind === 'asset' && renaming.id === asset.id ? (
          <RenameInput onCommit={commitRename} />
        ) : (
          <span className="tree-label">{asset.name}</span>
        )}
      </button>
    );
  };

  const renderFolder = (folder: ProjectFolder, depth: number) => {
    const isCollapsed = collapsed.has(folder.id);
    return (
      <div key={folder.id}>
        <button
          className={clsx('tree-row', selectedFolderId === folder.id && 'selected', dropTarget === folder.id && 'drop')}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => {
            setSelectedFolderId(folder.id);
            setCollapsed((prev) => {
              const next = new Set(prev);
              next.has(folder.id) ? next.delete(folder.id) : next.add(folder.id);
              return next;
            });
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDropTarget(folder.id);
          }}
          onDragLeave={() => setDropTarget((prev) => (prev === folder.id ? null : prev))}
          onDrop={(event) => handleDrop(event, folder.id)}
          onContextMenu={(event) =>
            openMenu(event, [
              { label: 'New Folder', onClick: () => newFolder(folder.id) },
              { label: 'Create Blueprint', onClick: () => newBlueprint(folder.id) },
              { label: 'Create Data Asset', onClick: () => newDataAsset(folder.id) },
              { label: 'Create Material', onClick: () => newMaterial(folder.id) },
              { label: 'Import Asset…', onClick: () => triggerImport(folder.id) },
              'separator',
              { label: 'Rename', onClick: () => startRename('folder', folder.id, folder.name) },
              { label: 'Delete', danger: true, onClick: () => deleteFolder(folder.id) },
            ])
          }
        >
          {isCollapsed ? <ChevronRight size={13} aria-hidden /> : <ChevronDown size={13} aria-hidden />}
          <Folder size={14} aria-hidden />
          {renaming?.kind === 'folder' && renaming.id === folder.id ? (
            <RenameInput onCommit={commitRename} />
          ) : (
            <span className="tree-label">{folder.name}</span>
          )}
        </button>
        {!isCollapsed && <div>{renderChildren(folder.id, depth + 1)}</div>}
      </div>
    );
  };

  const renderChildren = (parentId: string | undefined, depth: number) => (
    <>
      {(childFolders.get(parentId) ?? []).map((folder) => renderFolder(folder, depth))}
      {blueprints.filter((bp) => bp.folderId === parentId).map((bp) => renderBlueprint(bp, depth))}
      {dataAssets.filter((asset) => asset.folderId === parentId).map((asset) => renderDataAsset(asset, depth))}
      {materials.filter((material) => material.folderId === parentId).map((material) => renderMaterial(material, depth))}
      {assets.filter((asset) => asset.folderId === parentId).map((asset) => renderAsset(asset, depth))}
    </>
  );

  const search = assetSearch.trim().toLowerCase();
  const searching = search.length > 0;
  const searchMatches = searching
    ? {
        blueprints: blueprints.filter((bp) => bp.name.toLowerCase().includes(search)),
        dataAssets: dataAssets.filter((asset) => asset.name.toLowerCase().includes(search)),
        materials: materials.filter((material) => material.name.toLowerCase().includes(search)),
        assets: assets.filter((asset) => asset.name.toLowerCase().includes(search)),
      }
    : null;

  return (
    <section className="panel asset-panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Project</span>
          <h2>Browser</h2>
        </div>
        <button className="icon-button compact" title="New folder" onClick={() => newFolder(selectedFolderId)}>
          <Folder size={15} aria-hidden />
        </button>
        <button className="icon-button compact" title="Import assets" onClick={() => triggerImport(selectedFolderId)}>
          <Upload size={15} aria-hidden />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          hidden
          multiple
          accept=".glb,.gltf,.fbx,.png,.jpg,.jpeg,.mp3,.wav"
          onChange={(event) => {
            if (event.target.files) void importFiles(event.target.files, importTargetRef.current);
            event.target.value = '';
          }}
        />
      </div>

      <label className="search-field">
        <Search size={15} aria-hidden />
        <input value={assetSearch} onChange={(event) => setAssetSearch(event.target.value)} placeholder="Search" />
      </label>

      <div
        className={clsx('project-tree', dropTarget === 'root' && 'drop')}
        onClick={() => setSelectedFolderId(undefined)}
        onDragOver={(event) => {
          event.preventDefault();
          setDropTarget('root');
        }}
        onDragLeave={() => setDropTarget((prev) => (prev === 'root' ? null : prev))}
        onDrop={(event) => handleDrop(event, undefined)}
        onContextMenu={(event) =>
          openMenu(event, [
            { label: 'New Folder', onClick: () => newFolder(undefined) },
            { label: 'Create Blueprint', onClick: () => newBlueprint(undefined) },
            { label: 'Create Data Asset', onClick: () => newDataAsset(undefined) },
            { label: 'Create Material', onClick: () => newMaterial(undefined) },
            { label: 'Import Asset…', onClick: () => triggerImport(undefined) },
          ])
        }
      >
        {searching && searchMatches ? (
          <>
            {searchMatches.blueprints.map((bp) => renderBlueprint(bp, 0))}
            {searchMatches.dataAssets.map((asset) => renderDataAsset(asset, 0))}
            {searchMatches.materials.map((material) => renderMaterial(material, 0))}
            {searchMatches.assets.map((asset) => renderAsset(asset, 0))}
            {searchMatches.blueprints.length === 0 &&
              searchMatches.dataAssets.length === 0 &&
              searchMatches.materials.length === 0 &&
              searchMatches.assets.length === 0 && (
              <div className="empty-state wide">
                <Search size={18} aria-hidden />
                <span>No matches</span>
              </div>
            )}
          </>
        ) : (
          renderChildren(undefined, 0)
        )}
      </div>

      <ContextMenu state={menu} onClose={() => setMenu(null)} />
    </section>
  );
}
