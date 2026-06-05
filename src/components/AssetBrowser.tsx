import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bone,
  Box,
  Boxes,
  ChevronDown,
  ChevronRight,
  Film,
  Folder,
  GitBranch,
  Image,
  LayoutDashboard,
  LayoutGrid,
  List,
  FileArchive,
  Music,
  PanelLeft,
  Palette,
  PackagePlus,
  PersonStanding,
  Search,
  Sparkles,
  Table2,
  Upload,
  Workflow,
} from 'lucide-react';
import clsx from 'clsx';
import { useEditorStore } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import { getPlatform } from '../platform';
import { fbxToGlb } from '../three/convertModel';
import { compressGlbTextures } from '../three/compressTextures';
import { inspectModel, type ModelInspection } from '../three/inspectModel';
import { ContextMenu, type ContextMenuEntry, type ContextMenuState } from './ContextMenu';
import { SkeletonEditorModal } from './SkeletonEditorModal';
import { ASSET_DRAG_TYPE, PREFAB_DRAG_TYPE, assetDrag, hasDragType, prefabDrag } from './dragShared';
import { focusWorkspacePanel } from './workspacePanels';
import type { AnimationAsset, AnimatorController, AssetItem, AssetType, DataAsset, MaterialDefinition, ParticleSystemDefinition, Prefab, ProjectFolder, ScriptBlueprint, SkeletalMeshAsset, SkeletonAsset, UIDocument } from '../types';

const formatBytes = (bytes: number) => {
  if (!bytes) return '0 KB';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
};

const detectType = (name: string): AssetType => {
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'glb' || ext === 'gltf') return 'model';
  if (['png', 'jpg', 'jpeg', 'webp'].includes(ext ?? '')) return 'image';
  if (['mp3', 'wav'].includes(ext ?? '')) return 'audio';
  return 'unknown';
};

/** Extensions the browser accepts — keep in sync with the file picker's `accept` attribute. */
const ACCEPTED_EXT = new Set(['glb', 'gltf', 'fbx', 'png', 'jpg', 'jpeg', 'webp', 'mp3', 'wav']);
const isAccepted = (name: string) => ACCEPTED_EXT.has(name.split('.').pop()?.toLowerCase() ?? '');

const assetGlyph = (type: AssetType) => (type === 'audio' ? Music : type === 'image' ? Image : Box);

type DragKind = 'asset' | 'blueprint' | 'dataAsset' | 'material' | 'particleSystem' | 'uiDocument' | 'prefab';
type DragRef = { items: Array<{ kind: DragKind; id: string }> } | null;

const itemKey = (kind: DragKind, id: string) => `${kind}:${id}`;
const parseItemKey = (key: string): { kind: DragKind; id: string } => {
  const idx = key.indexOf(':');
  return { kind: key.slice(0, idx) as DragKind, id: key.slice(idx + 1) };
};

// Kinds shown in the content view. Most are draggable; a few (derived from imports) are read-only.
type EntryKind = DragKind | 'skeleton' | 'skeletalMesh' | 'animation' | 'controller';
type RenameKind = 'blueprint' | 'asset' | 'dataAsset' | 'material' | 'particleSystem' | 'uiDocument' | 'prefab';

/** A normalised content-browser item — both the tile grid and the list render from this. */
interface AssetEntry {
  kind: EntryKind;
  id: string;
  label: string;
  folderId?: string;
  Icon: typeof Box;
  accent?: string;
  thumbnail?: string;
  prefabThumb?: boolean;
  subtitle?: string;
  title?: string;
  active?: boolean;
  unresolved?: boolean;
  dragKind?: DragKind; // present → selectable + draggable into folders/viewport
  renameKind?: RenameKind; // present → supports inline rename
  onOpen?: () => void; // double-click (or single-click for non-draggable read-only items)
  menu?: ContextMenuEntry[];
}

export function AssetBrowser() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<DragRef>(null);
  const importTargetRef = useRef<string | undefined>(undefined);
  // Spring-loaded folders: hovering a collapsed folder mid-drag auto-expands it after a beat.
  const springRef = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  // Anchor for shift-range multi-select.
  const anchorRef = useRef<string | null>(null);

  const assets = useEditorStore((state) => state.assets);
  const folders = useEditorStore((state) => state.folders);
  const blueprints = useEditorStore((state) => state.blueprints);
  const dataAssets = useEditorStore((state) => state.dataAssets);
  const activeBlueprintId = useEditorStore((state) => state.activeBlueprintId);
  const assetSearch = useEditorStore((state) => state.assetSearch);
  const setAssetSearch = useEditorStore((state) => state.setAssetSearch);
  const addAssetItems = useEditorStore((state) => state.addAssetItems);
  const registerImportedModel = useEditorStore((state) => state.registerImportedModel);
  const removeAsset = useEditorStore((state) => state.removeAsset);
  const renameAsset = useEditorStore((state) => state.renameAsset);
  const compressTextures = useEditorStore((state) => state.renderSettings?.compressTextures !== false);
  const updateRenderSettings = useEditorStore((state) => state.updateRenderSettings);
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
  const particleSystems = useEditorStore((state) => state.particleSystems);
  const activeParticleSystemId = useEditorStore((state) => state.activeParticleSystemId);
  const createParticleSystem = useEditorStore((state) => state.createParticleSystem);
  const renameParticleSystem = useEditorStore((state) => state.renameParticleSystem);
  const deleteParticleSystem = useEditorStore((state) => state.deleteParticleSystem);
  const setActiveParticleSystem = useEditorStore((state) => state.setActiveParticleSystem);
  const uiDocuments = useEditorStore((state) => state.uiDocuments);
  const activeUIDocumentId = useEditorStore((state) => state.activeUIDocumentId);
  const createUIDocument = useEditorStore((state) => state.createUIDocument);
  const renameUIDocument = useEditorStore((state) => state.renameUIDocument);
  const deleteUIDocument = useEditorStore((state) => state.deleteUIDocument);
  const setActiveUIDocument = useEditorStore((state) => state.setActiveUIDocument);
  const skeletons = useEditorStore((state) => state.skeletons);
  const skeletalMeshes = useEditorStore((state) => state.skeletalMeshes);
  const animationAssets = useEditorStore((state) => state.animations);
  const animatorControllers = useEditorStore((state) => state.animatorControllers);
  const activeAnimatorControllerId = useEditorStore((state) => state.activeAnimatorControllerId);
  const setActiveAnimatorController = useEditorStore((state) => state.setActiveAnimatorController);
  const deleteAnimatorController = useEditorStore((state) => state.deleteAnimatorController);
  const createCharacterPawn = useEditorStore((state) => state.createCharacterPawn);
  const prefabs = useEditorStore((state) => state.prefabs);
  const editingPrefabId = useEditorStore((state) => state.editingPrefabId);
  const openPrefabEditor = useEditorStore((state) => state.openPrefabEditor);
  const instantiatePrefab = useEditorStore((state) => state.instantiatePrefab);
  const renamePrefab = useEditorStore((state) => state.renamePrefab);
  const deletePrefab = useEditorStore((state) => state.deletePrefab);
  const projectDir = useProjectStore((state) => state.projectDir);
  const exportPrefabPackage = useProjectStore((state) => state.exportPrefabPackage);
  const exportFolderPackage = useProjectStore((state) => state.exportFolderPackage);
  const importPackageFromFile = useProjectStore((state) => state.importPackageFromFile);

  // Imports are additive but write into the project — confirm so the user can back up first.
  const importPackage = () => {
    const ok = window.confirm(
      'Import a package into this project?\n\nIt adds new prefabs, blueprints and assets (it never overwrites existing ones), but you should back up your project first if it matters.',
    );
    if (ok) void importPackageFromFile();
  };

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedFolderId, setSelectedFolderId] = useState<string | undefined>(undefined);
  const [renaming, setRenaming] = useState<{ kind: 'folder' | 'blueprint' | 'asset' | 'dataAsset' | 'material' | 'particleSystem' | 'uiDocument' | 'prefab'; id: string } | null>(null);
  const [draft, setDraft] = useState('');
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [dropTarget, setDropTarget] = useState<string | 'root' | null>(null);
  const [editSkeletonId, setEditSkeletonId] = useState<string | undefined>(undefined);
  // Multi-select (composite `${kind}:${id}` keys) and the item currently hovered as a drop target.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dropItemId, setDropItemId] = useState<string | null>(null);
  // Content-browser layout: thumbnail tile grid vs. compact list, and the tile size.
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [tileSize, setTileSize] = useState(84);
  // Whether the left folder column is shown (hide it to give the tile grid full width).
  const [showFolders, setShowFolders] = useState(true);
  // Highlight when an OS file / dragged item hovers the content pane background.
  const [contentDrop, setContentDrop] = useState(false);
  // Rubber-band (marquee) box-selection in the content view, kept in client coords.
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const marqueeBaseRef = useRef<Set<string>>(new Set());
  const marqueeMovedRef = useRef(false);

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
    // Rigged model imports, parsed once here so we can split them into skeleton/mesh/animation
    // assets after the asset items are registered (registerImportedModel needs the asset id).
    const rigImports: { assetId: string; assetName: string; inspection: ModelInspection }[] = [];
    let strippedTextures = false;
    let riggedCount = 0;
    // Transcode imported model textures to GPU-compressed KTX2 (on by default; see RenderSettings).
    const compressEnabled = useEditorStore.getState().renderSettings?.compressTextures !== false;
    let compressedCount = 0;
    let savedBytes = 0;
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
        // GPU-compress embedded textures to KTX2 (cuts VRAM ~6–8× and shrinks the exported game).
        // On ANY failure we keep the original bytes, so a bad encode never blocks the import.
        if (compressEnabled && /\.glb$/i.test(file.name)) {
          try {
            useProjectStore.setState({ toast: { kind: 'success', message: `Compressing textures in "${file.name}"…` } });
            const result = await compressGlbTextures(await file.arrayBuffer());
            if (result.compressed) {
              file = new File([result.data], file.name, { type: 'model/gltf-binary' });
              savedBytes += Math.max(0, result.beforeBytes - result.afterBytes);
              compressedCount += 1;
            }
          } catch (compressError) {
            console.warn(`Texture compression failed for "${file.name}", importing uncompressed:`, compressError);
          }
        }
        const { path, url } = await platform.importAsset(dir, file);
        const assetId = `asset-${crypto.randomUUID()}`;
        items.push({
          id: assetId,
          name: file.name,
          type: detectType(file.name),
          size: file.size,
          path,
          url,
          folderId,
          createdAt: Date.now(),
        });
        // Inspect models for a skeleton + clips. A non-skinned model just yields no skeleton.
        if (detectType(file.name) === 'model') {
          try {
            const inspection = await inspectModel(file);
            if (inspection.skeleton) {
              rigImports.push({ assetId, assetName: file.name, inspection });
              riggedCount += 1;
            }
          } catch (inspectError) {
            console.error(`Couldn't inspect model "${file.name}" for animations:`, inspectError);
          }
        }
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
    // Split rigged models into reusable Skeleton/Skeletal Mesh/Animation assets (skeletons are
    // deduped by signature, so same-rig characters share one skeleton and all its animations).
    let newClips = 0;
    for (const rig of rigImports) {
      const before = useEditorStore.getState().animations.length;
      registerImportedModel({ assetId: rig.assetId, assetName: rig.assetName, folderId, inspection: rig.inspection });
      newClips += useEditorStore.getState().animations.length - before;
    }
    if (riggedCount > 0) {
      useProjectStore.setState({
        toast: {
          kind: 'success',
          message: `Imported ${riggedCount} rigged model${riggedCount > 1 ? 's' : ''}${newClips ? ` with ${newClips} new animation${newClips > 1 ? 's' : ''}` : ' (animations already available)'}.`,
        },
      });
    }
    if (strippedTextures) {
      useProjectStore.setState({
        toast: {
          kind: 'success',
          message: 'Model imported without some textures. Re-import the .fbx together with its texture images (select them all at once) to keep them.',
        },
      });
    }
    if (compressedCount > 0) {
      const savedMb = (savedBytes / (1024 * 1024)).toFixed(1);
      useProjectStore.setState({
        toast: {
          kind: 'success',
          message: `Compressed textures in ${compressedCount} model${compressedCount > 1 ? 's' : ''} to KTX2 (saved ${savedMb} MB).`,
        },
      });
    }
  };

  const startRename = (kind: 'folder' | 'blueprint' | 'asset' | 'dataAsset' | 'material' | 'particleSystem' | 'uiDocument' | 'prefab', id: string, current: string) => {
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
      else if (renaming.kind === 'particleSystem') renameParticleSystem(renaming.id, name);
      else if (renaming.kind === 'uiDocument') renameUIDocument(renaming.id, name);
      else if (renaming.kind === 'prefab') renamePrefab(renaming.id, name);
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

  const newParticleSystem = (folderId?: string) => {
    const id = createParticleSystem(undefined, 'fire', folderId);
    if (folderId) setCollapsed((prev) => new Set([...prev].filter((value) => value !== folderId)));
    startRename('particleSystem', id, particleSystems.length ? `Particle System ${particleSystems.length + 1}` : 'Particle System 1');
    focusWorkspacePanel('particles');
  };

  const openParticleSystem = (id: string) => {
    setActiveParticleSystem(id);
    focusWorkspacePanel('particles');
  };

  const newUIDocument = (folderId?: string) => {
    const id = createUIDocument(undefined, 'screen', folderId);
    if (folderId) setCollapsed((prev) => new Set([...prev].filter((value) => value !== folderId)));
    startRename('uiDocument', id, uiDocuments.length ? `UI ${uiDocuments.length + 1}` : 'UI 1');
  };

  const openUIDocument = (id: string) => {
    setActiveUIDocument(id);
    focusWorkspacePanel('ui');
  };

  const openController = (id: string) => {
    setActiveAnimatorController(id);
    focusWorkspacePanel('animator');
  };

  const openMenu = (event: React.MouseEvent, items: ContextMenuState['items']) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY, items });
  };

  const clearSpring = () => {
    if (springRef.current) {
      clearTimeout(springRef.current.timer);
      springRef.current = null;
    }
  };

  // Hovering a collapsed folder during a drag auto-expands it after a short delay (spring-loading).
  const scheduleSpring = (folderId: string) => {
    if (!collapsed.has(folderId) || springRef.current?.id === folderId) return;
    clearSpring();
    springRef.current = {
      id: folderId,
      timer: setTimeout(() => {
        setCollapsed((prev) => {
          const next = new Set(prev);
          next.delete(folderId);
          return next;
        });
        springRef.current = null;
      }, 600),
    };
  };

  const handleDrop = (event: React.DragEvent, folderId?: string) => {
    setDropTarget(null);
    setDropItemId(null);
    setContentDrop(false);
    clearSpring();
    // External files dropped from the OS (Finder/Explorer) → import into this folder.
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      event.preventDefault();
      void importFiles(files, folderId);
      dragRef.current = null;
      return;
    }
    // Otherwise it's an internal drag, re-homing one or more existing items. Folders are purely
    // organizational, so this only changes membership — every id reference stays intact.
    const dragged = dragRef.current;
    if (dragged?.items.length) {
      event.preventDefault();
      dragged.items.forEach((item) => moveToFolder(item.kind, item.id, folderId));
      const dest = folderId ? folders.find((f) => f.id === folderId)?.name ?? 'folder' : 'project root';
      const count = dragged.items.length;
      useProjectStore.setState({
        toast: { kind: 'success', message: `Moved ${count} item${count > 1 ? 's' : ''} to ${dest}.` },
      });
    }
    dragRef.current = null;
  };

  // Flat list of selectable item keys in on-screen order — used to resolve shift-click ranges.
  const buildOrderedKeys = (): string[] =>
    visibleEntries
      .filter((entry) => entry.dragKind)
      .map((entry) => itemKey(entry.dragKind!, entry.id));

  // Click selection: plain = select + run default (open); Ctrl/Cmd = toggle; Shift = range.
  const handleItemClick = (event: React.MouseEvent, kind: DragKind, id: string, defaultAction?: () => void) => {
    const key = itemKey(kind, id);
    event.stopPropagation();
    if (event.metaKey || event.ctrlKey) {
      setSelected((prev) => {
        const next = new Set(prev);
        next.has(key) ? next.delete(key) : next.add(key);
        return next;
      });
      anchorRef.current = key;
      return;
    }
    if (event.shiftKey && anchorRef.current) {
      const order = buildOrderedKeys();
      const a = order.indexOf(anchorRef.current);
      const b = order.indexOf(key);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setSelected(new Set(order.slice(lo, hi + 1)));
        return;
      }
    }
    setSelected(new Set([key]));
    anchorRef.current = key;
    defaultAction?.();
  };

  const handleItemDragStart = (event: React.DragEvent, kind: DragKind, id: string, label: string) => {
    const key = itemKey(kind, id);
    // Drag the whole multi-selection if this item is part of it; otherwise drag just this one.
    const items =
      selected.has(key) && selected.size > 1 ? [...selected].map(parseItemKey) : [{ kind, id }];
    if (!(selected.has(key) && selected.size > 1)) setSelected(new Set([key]));
    dragRef.current = { items };
    // Viewport drop still expects a single asset id via the shared holder + dataTransfer.
    const assetItems = items.filter((item) => item.kind === 'asset');
    if (assetItems.length === 1) {
      assetDrag.id = assetItems[0].id;
      try {
        event.dataTransfer.setData(ASSET_DRAG_TYPE, assetItems[0].id);
      } catch {
        /* some webviews block setData during dragstart — the shared holder covers it */
      }
    }
    // Dragging a single prefab into the viewport instantiates it at the cursor (same holder trick).
    const prefabItems = items.filter((item) => item.kind === 'prefab');
    if (prefabItems.length === 1) {
      prefabDrag.id = prefabItems[0].id;
      try {
        event.dataTransfer.setData(PREFAB_DRAG_TYPE, prefabItems[0].id);
      } catch {
        /* some webviews block setData during dragstart — the shared holder covers it */
      }
    }
    event.dataTransfer.effectAllowed = 'move';
    // A small labelled chip as the drag image.
    const chip = document.createElement('div');
    chip.className = 'drag-chip';
    chip.textContent = items.length > 1 ? `${items.length} items` : label;
    document.body.appendChild(chip);
    event.dataTransfer.setDragImage(chip, 12, 12);
    setTimeout(() => chip.remove(), 0);
  };

  const handleItemDragEnd = () => {
    assetDrag.id = null;
    prefabDrag.id = null;
    setDropTarget(null);
    setDropItemId(null);
    setContentDrop(false);
    clearSpring();
    dragRef.current = null;
  };

  // Dropping onto ANY item files the dragged items into that item's folder (no need to hit the
  // thin folder header). Highlights both the destination folder and the hovered row.
  const handleItemDragOver = (event: React.DragEvent, folderId: string | undefined, id: string) => {
    if (!dragRef.current) return; // ignore OS file drags here — let the folder/root zones import them
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    setDropTarget(folderId ?? 'root');
    setDropItemId(id);
  };

  /** Shared props that make an item row draggable, selectable, and a drop target. */
  const rowDnd = (kind: DragKind, id: string, folderId: string | undefined, label: string) => ({
    draggable: true as const,
    onDragStart: (event: React.DragEvent) => handleItemDragStart(event, kind, id, label),
    onDragEnd: handleItemDragEnd,
    onDragOver: (event: React.DragEvent) => handleItemDragOver(event, folderId, id),
    onDragLeave: () => setDropItemId((prev) => (prev === id ? null : prev)),
    onDrop: (event: React.DragEvent) => handleDrop(event, folderId),
  });
  // Context-menu entries to move an item between folders. Membership is purely organizational —
  // scene objects/nodes reference the asset by id, so moving it never breaks those references.
  const moveEntries = (
    kind: 'asset' | 'blueprint' | 'dataAsset' | 'material' | 'particleSystem' | 'uiDocument' | 'prefab',
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

  // ---- Content model --------------------------------------------------------
  // Every browsable item is normalised into one descriptor so the tile grid and
  // the list share a single renderer. Folders are handled separately.
  const buildEntries = (): AssetEntry[] => {
    const out: AssetEntry[] = [];
    prefabs.forEach((prefab) =>
      out.push({
        kind: 'prefab',
        id: prefab.id,
        label: prefab.name,
        folderId: prefab.folderId,
        Icon: Boxes,
        accent: '#FBBF77',
        thumbnail: prefab.thumbnail,
        prefabThumb: true,
        subtitle: `${prefab.objects.length} obj`,
        active: editingPrefabId === prefab.id,
        dragKind: 'prefab',
        renameKind: 'prefab',
        title: `prefab · ${prefab.objects.length} object${prefab.objects.length > 1 ? 's' : ''} — double-click to edit, drag into the viewport to place`,
        onOpen: () => openPrefabEditor(prefab.id),
        menu: [
          { label: 'Add to Scene', onClick: () => instantiatePrefab(prefab.id) },
          { label: 'Open in Prefab Editor', onClick: () => openPrefabEditor(prefab.id) },
          { label: 'Rename', onClick: () => startRename('prefab', prefab.id, prefab.name) },
          { label: 'Export as Package…', onClick: () => void exportPrefabPackage(prefab.id) },
          ...moveEntries('prefab', prefab.id, prefab.folderId),
          'separator',
          { label: 'Delete prefab', danger: true, onClick: () => deletePrefab(prefab.id) },
        ],
      }),
    );
    blueprints.forEach((bp) =>
      out.push({
        kind: 'blueprint',
        id: bp.id,
        label: bp.name,
        folderId: bp.folderId,
        Icon: GitBranch,
        accent: bp.color,
        subtitle: 'blueprint',
        active: activeBlueprintId === bp.id,
        dragKind: 'blueprint',
        renameKind: 'blueprint',
        onOpen: () => setActiveBlueprint(bp.id),
        menu: [
          { label: 'Open in Scripting', onClick: () => setActiveBlueprint(bp.id) },
          { label: 'Rename', onClick: () => startRename('blueprint', bp.id, bp.name) },
          ...moveEntries('blueprint', bp.id, bp.folderId),
          'separator',
          { label: 'Delete', danger: true, onClick: () => deleteBlueprint(bp.id) },
        ],
      }),
    );
    dataAssets.forEach((d) =>
      out.push({
        kind: 'dataAsset',
        id: d.id,
        label: d.name,
        folderId: d.folderId,
        Icon: Table2,
        accent: '#F0D46A',
        subtitle: `${d.rows.length} rows`,
        dragKind: 'dataAsset',
        renameKind: 'dataAsset',
        title: `${d.columns.length} columns · ${d.rows.length} rows`,
        menu: [
          { label: 'Rename', onClick: () => startRename('dataAsset', d.id, d.name) },
          ...moveEntries('dataAsset', d.id, d.folderId),
          'separator',
          { label: 'Delete Data Asset', danger: true, onClick: () => deleteDataAsset(d.id) },
        ],
      }),
    );
    materials.forEach((m) =>
      out.push({
        kind: 'material',
        id: m.id,
        label: m.name,
        folderId: m.folderId,
        Icon: Palette,
        accent: m.color,
        subtitle: 'material',
        active: activeMaterialId === m.id,
        dragKind: 'material',
        renameKind: 'material',
        title: `material · ${m.color}`,
        onOpen: () => openMaterial(m.id),
        menu: [
          { label: 'Edit in Material', onClick: () => openMaterial(m.id) },
          { label: 'Rename', onClick: () => startRename('material', m.id, m.name) },
          ...moveEntries('material', m.id, m.folderId),
          'separator',
          { label: 'Delete material', danger: true, onClick: () => deleteMaterial(m.id) },
        ],
      }),
    );
    particleSystems.forEach((system) =>
      out.push({
        kind: 'particleSystem',
        id: system.id,
        label: system.name,
        folderId: system.folderId,
        Icon: Sparkles,
        accent: system.startColor,
        subtitle: system.shape,
        active: activeParticleSystemId === system.id,
        dragKind: 'particleSystem',
        renameKind: 'particleSystem',
        title: `particle system · ${system.shape}`,
        onOpen: () => openParticleSystem(system.id),
        menu: [
          { label: 'Edit Particle System', onClick: () => openParticleSystem(system.id) },
          { label: 'Rename', onClick: () => startRename('particleSystem', system.id, system.name) },
          ...moveEntries('particleSystem', system.id, system.folderId),
          'separator',
          { label: 'Delete particle system', danger: true, onClick: () => deleteParticleSystem(system.id) },
        ],
      }),
    );
    uiDocuments.forEach((doc) =>
      out.push({
        kind: 'uiDocument',
        id: doc.id,
        label: doc.name,
        folderId: doc.folderId,
        Icon: LayoutDashboard,
        accent: '#7DD3FC',
        subtitle: doc.surface === 'screen' ? 'screen HUD' : 'world UI',
        active: activeUIDocumentId === doc.id,
        dragKind: 'uiDocument',
        renameKind: 'uiDocument',
        title: `UI · ${doc.surface === 'screen' ? 'screen HUD' : 'world space'}`,
        onOpen: () => openUIDocument(doc.id),
        menu: [
          { label: 'Edit in UI', onClick: () => openUIDocument(doc.id) },
          { label: 'Rename', onClick: () => startRename('uiDocument', doc.id, doc.name) },
          ...moveEntries('uiDocument', doc.id, doc.folderId),
          'separator',
          { label: 'Delete UI', danger: true, onClick: () => deleteUIDocument(doc.id) },
        ],
      }),
    );
    animatorControllers.forEach((controller) =>
      out.push({
        kind: 'controller',
        id: controller.id,
        label: controller.name,
        folderId: controller.folderId,
        Icon: Workflow,
        accent: '#F0ABFC',
        subtitle: `${controller.states.length} states`,
        active: activeAnimatorControllerId === controller.id,
        title: `animator · ${controller.states.length} states`,
        onOpen: () => openController(controller.id),
        menu: [
          { label: 'Edit in Animator', onClick: () => openController(controller.id) },
          'separator',
          { label: 'Delete controller', danger: true, onClick: () => deleteAnimatorController(controller.id) },
        ],
      }),
    );
    // Skeleton / Skeletal Mesh / Animation are derived on import — read-only (rename/delete via re-import).
    skeletons.forEach((skeleton) =>
      out.push({
        kind: 'skeleton',
        id: skeleton.id,
        label: skeleton.name,
        folderId: skeleton.folderId,
        Icon: Bone,
        accent: '#C4B5FD',
        subtitle: `${skeleton.boneNames.length} bones`,
        title: `skeleton · ${skeleton.boneNames.length} bones · ${skeleton.sockets?.length ?? 0} sockets — open editor`,
        onOpen: () => setEditSkeletonId(skeleton.id),
      }),
    );
    skeletalMeshes.forEach((mesh) =>
      out.push({
        kind: 'skeletalMesh',
        id: mesh.id,
        label: mesh.name,
        folderId: mesh.folderId,
        Icon: PersonStanding,
        accent: '#7DD3FC',
        subtitle: 'skeletal mesh',
        title: 'skeletal mesh',
      }),
    );
    animationAssets.forEach((anim) =>
      out.push({
        kind: 'animation',
        id: anim.id,
        label: anim.name,
        folderId: anim.folderId,
        Icon: Film,
        accent: '#86EFAC',
        subtitle: `${anim.duration.toFixed(1)}s${anim.loop ? ' · loop' : ''}`,
        title: `animation · ${anim.duration.toFixed(2)}s${anim.loop ? ' · loops' : ''}`,
      }),
    );
    assets.forEach((asset) =>
      out.push({
        kind: 'asset',
        id: asset.id,
        label: asset.name,
        folderId: asset.folderId,
        Icon: assetGlyph(asset.type),
        thumbnail: asset.type === 'image' && !asset.unresolved ? asset.url : undefined,
        subtitle: `${asset.type} · ${formatBytes(asset.size)}`,
        unresolved: asset.unresolved,
        dragKind: 'asset',
        renameKind: 'asset',
        title: `${asset.type} · ${formatBytes(asset.size)}${asset.unresolved ? ' · missing file' : ''}`,
        menu: [
          // Rigged models can spawn a ready-to-play third-person pawn in one click.
          ...(skeletalMeshes.some((mesh) => mesh.sourceAssetId === asset.id)
            ? ([{ label: 'Create Character Pawn', onClick: () => createCharacterPawn(asset.id) }, 'separator'] as ContextMenuEntry[])
            : []),
          { label: 'Rename', onClick: () => startRename('asset', asset.id, asset.name) },
          ...moveEntries('asset', asset.id, asset.folderId),
          'separator',
          { label: 'Delete asset', danger: true, onClick: () => removeAsset(asset.id) },
        ],
      }),
    );
    return out;
  };

  const toggleCollapse = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const folderMenu = (folder: ProjectFolder): ContextMenuEntry[] => [
    { label: 'New Folder', onClick: () => newFolder(folder.id) },
    { label: 'Create Blueprint', onClick: () => newBlueprint(folder.id) },
    { label: 'Create Data Asset', onClick: () => newDataAsset(folder.id) },
    { label: 'Create Material', onClick: () => newMaterial(folder.id) },
    { label: 'Create Particle System', onClick: () => newParticleSystem(folder.id) },
    { label: 'Create UI', onClick: () => newUIDocument(folder.id) },
    { label: 'Import Asset…', onClick: () => triggerImport(folder.id) },
    'separator',
    { label: 'Export Folder as Package…', onClick: () => void exportFolderPackage(folder.id) },
    { label: 'Rename', onClick: () => startRename('folder', folder.id, folder.name) },
    { label: 'Delete', danger: true, onClick: () => deleteFolder(folder.id) },
  ];

  const createMenu = (folderId?: string): ContextMenuEntry[] => [
    { label: 'New Folder', onClick: () => newFolder(folderId) },
    { label: 'Create Blueprint', onClick: () => newBlueprint(folderId) },
    { label: 'Create Data Asset', onClick: () => newDataAsset(folderId) },
    { label: 'Create Material', onClick: () => newMaterial(folderId) },
    { label: 'Create Particle System', onClick: () => newParticleSystem(folderId) },
    { label: 'Create UI', onClick: () => newUIDocument(folderId) },
    { label: 'Import Asset…', onClick: () => triggerImport(folderId) },
    'separator',
    { label: 'Import Package…', onClick: importPackage },
  ];

  // Drop props for things that file items into a folder: folder rows/tiles, tree root, grid bg.
  const folderDropProps = (folderId: string | undefined) => ({
    onDragOver: (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setDropTarget(folderId ?? 'root');
      setDropItemId(null);
      if (folderId) scheduleSpring(folderId);
    },
    onDragLeave: () => {
      setDropTarget((prev) => (prev === (folderId ?? 'root') ? null : prev));
      clearSpring();
    },
    onDrop: (event: React.DragEvent) => handleDrop(event, folderId),
  });

  const isRenaming = (entry: AssetEntry) =>
    !!renaming && !!entry.renameKind && renaming.kind === entry.renameKind && renaming.id === entry.id;

  // Rubber-band selection: dragging across empty grid space boxes in every selectable tile/row
  // it touches. Starting on a tile is ignored so that the tile's own HTML5 drag (move) takes over.
  const handleMarqueeDown = (event: React.MouseEvent) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest('.asset-tile, .tree-row')) return;
    const view = viewRef.current;
    if (!view) return;
    const startX = event.clientX;
    const startY = event.clientY;
    marqueeMovedRef.current = false;
    // Hold Ctrl/Cmd while boxing to add to the current selection rather than replace it.
    marqueeBaseRef.current = event.metaKey || event.ctrlKey ? new Set(selected) : new Set();
    setMarquee({ x0: startX, y0: startY, x1: startX, y1: startY });

    const move = (e: MouseEvent) => {
      if (Math.abs(e.clientX - startX) > 3 || Math.abs(e.clientY - startY) > 3) marqueeMovedRef.current = true;
      setMarquee({ x0: startX, y0: startY, x1: e.clientX, y1: e.clientY });
      const left = Math.min(startX, e.clientX);
      const right = Math.max(startX, e.clientX);
      const top = Math.min(startY, e.clientY);
      const bottom = Math.max(startY, e.clientY);
      const next = new Set(marqueeBaseRef.current);
      view.querySelectorAll<HTMLElement>('[data-key]').forEach((node) => {
        const r = node.getBoundingClientRect();
        if (r.right >= left && r.left <= right && r.bottom >= top && r.top <= bottom) next.add(node.dataset.key!);
      });
      setSelected(next);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setMarquee(null);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  // Single-click selects draggable items (open on double-click); read-only items open on click.
  const entryHandlers = (entry: AssetEntry) => ({
    ...(entry.dragKind ? rowDnd(entry.dragKind, entry.id, entry.folderId, entry.label) : {}),
    onClick: (event: React.MouseEvent) => {
      if (entry.dragKind) handleItemClick(event, entry.dragKind, entry.id);
      else {
        event.stopPropagation();
        entry.onOpen?.();
      }
    },
    onDoubleClick: () => entry.onOpen?.(),
    onContextMenu: (event: React.MouseEvent) => entry.menu && openMenu(event, entry.menu),
  });

  // ---- Tile + list renderers ------------------------------------------------
  const renderTile = (entry: AssetEntry) => {
    const sel = !!entry.dragKind && selected.has(itemKey(entry.dragKind, entry.id));
    return (
      <button
        key={`${entry.kind}:${entry.id}`}
        data-key={entry.dragKind ? itemKey(entry.dragKind, entry.id) : undefined}
        className={clsx('asset-tile', sel && 'selected', entry.active && 'active', dropItemId === entry.id && 'drop-into')}
        style={{ width: tileSize }}
        title={entry.title}
        {...entryHandlers(entry)}
      >
        <span className="asset-tile-thumb" style={{ height: tileSize - 18 }}>
          {entry.thumbnail ? (
            <img className={clsx('asset-tile-img', entry.prefabThumb && 'prefab')} src={entry.thumbnail} alt="" />
          ) : (
            <entry.Icon size={Math.round(tileSize * 0.4)} style={{ color: entry.accent }} className={clsx(entry.unresolved && 'tree-unresolved')} aria-hidden />
          )}
        </span>
        <span className="asset-tile-name">
          {isRenaming(entry) ? <RenameInput onCommit={commitRename} /> : <span className="tree-label">{entry.label}</span>}
        </span>
      </button>
    );
  };

  const renderRow = (entry: AssetEntry) => {
    const sel = !!entry.dragKind && selected.has(itemKey(entry.dragKind, entry.id));
    return (
      <button
        key={`${entry.kind}:${entry.id}`}
        data-key={entry.dragKind ? itemKey(entry.dragKind, entry.id) : undefined}
        className={clsx('tree-row', sel && 'selected', entry.active && 'active', dropItemId === entry.id && 'drop-into')}
        style={{ paddingLeft: 8 }}
        title={entry.title}
        {...entryHandlers(entry)}
      >
        {entry.thumbnail ? (
          <img className={clsx('tree-thumb', entry.prefabThumb && 'prefab-thumb')} src={entry.thumbnail} alt="" />
        ) : (
          <entry.Icon size={14} style={{ color: entry.accent }} className={clsx(entry.unresolved && 'tree-unresolved')} aria-hidden />
        )}
        {isRenaming(entry) ? (
          <RenameInput onCommit={commitRename} />
        ) : (
          <>
            <span className="tree-label">{entry.label}</span>
            {entry.subtitle && <span className="tree-sub">{entry.subtitle}</span>}
          </>
        )}
      </button>
    );
  };

  // ---- Folder renderers -----------------------------------------------------
  // Left column: the folder hierarchy (folders only) used to pick the active folder.
  const renderTreeFolder = (folder: ProjectFolder, depth: number) => {
    const kids = childFolders.get(folder.id) ?? [];
    const isCollapsed = collapsed.has(folder.id);
    return (
      <div key={folder.id}>
        <div
          className={clsx('tree-row folder-row', selectedFolderId === folder.id && 'selected', dropTarget === folder.id && 'drop')}
          style={{ paddingLeft: 4 + depth * 12 }}
          onClick={() => setSelectedFolderId(folder.id)}
          {...folderDropProps(folder.id)}
          onContextMenu={(event) => openMenu(event, folderMenu(folder))}
        >
          {kids.length > 0 ? (
            <span
              className="tree-twist"
              onClick={(event) => {
                event.stopPropagation();
                toggleCollapse(folder.id);
              }}
            >
              {isCollapsed ? <ChevronRight size={13} aria-hidden /> : <ChevronDown size={13} aria-hidden />}
            </span>
          ) : (
            <span className="tree-twist" />
          )}
          <Folder size={14} aria-hidden />
          {renaming?.kind === 'folder' && renaming.id === folder.id ? (
            <RenameInput onCommit={commitRename} />
          ) : (
            <span className="tree-label">{folder.name}</span>
          )}
        </div>
        {!isCollapsed && kids.map((child) => renderTreeFolder(child, depth + 1))}
      </div>
    );
  };

  // A subfolder shown inside the content grid (double-click to enter).
  const renderFolderTile = (folder: ProjectFolder) => (
    <button
      key={`folder:${folder.id}`}
      className={clsx('asset-tile folder-tile', dropTarget === folder.id && 'drop')}
      style={{ width: tileSize }}
      title="folder — double-click to open"
      onClick={() => setSelectedFolderId(folder.id)}
      onDoubleClick={() => setSelectedFolderId(folder.id)}
      {...folderDropProps(folder.id)}
      onContextMenu={(event) => openMenu(event, folderMenu(folder))}
    >
      <span className="asset-tile-thumb" style={{ height: tileSize - 18 }}>
        <Folder size={Math.round(tileSize * 0.46)} aria-hidden />
      </span>
      <span className="asset-tile-name">
        {renaming?.kind === 'folder' && renaming.id === folder.id ? (
          <RenameInput onCommit={commitRename} />
        ) : (
          <span className="tree-label">{folder.name}</span>
        )}
      </span>
    </button>
  );

  const renderFolderListRow = (folder: ProjectFolder) => (
    <button
      key={`folder:${folder.id}`}
      className={clsx('tree-row folder-row', dropTarget === folder.id && 'drop')}
      style={{ paddingLeft: 8 }}
      title="folder — double-click to open"
      onClick={() => setSelectedFolderId(folder.id)}
      onDoubleClick={() => setSelectedFolderId(folder.id)}
      {...folderDropProps(folder.id)}
      onContextMenu={(event) => openMenu(event, folderMenu(folder))}
    >
      <Folder size={14} aria-hidden />
      {renaming?.kind === 'folder' && renaming.id === folder.id ? (
        <RenameInput onCommit={commitRename} />
      ) : (
        <span className="tree-label">{folder.name}</span>
      )}
    </button>
  );

  // ---- Derived view data ----------------------------------------------------
  const search = assetSearch.trim().toLowerCase();
  const searching = search.length > 0;
  const allEntries = buildEntries();
  // Searching flattens across every folder; otherwise we show only the active folder's contents.
  const visibleEntries = searching
    ? allEntries.filter((entry) => entry.label.toLowerCase().includes(search))
    : allEntries.filter((entry) => entry.folderId === selectedFolderId);
  const visibleFolders = searching ? [] : childFolders.get(selectedFolderId) ?? [];
  const breadcrumb: ProjectFolder[] = [];
  {
    const byId = new Map(folders.map((folder) => [folder.id, folder] as const));
    let cursor = selectedFolderId;
    while (cursor) {
      const folder = byId.get(cursor);
      if (!folder) break;
      breadcrumb.unshift(folder);
      cursor = folder.parentId;
    }
  }
  const isEmpty = visibleFolders.length === 0 && visibleEntries.length === 0;

  return (
    <section className="panel asset-panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Project</span>
          <h2>Browser</h2>
        </div>
        <button
          className={clsx('icon-button compact', showFolders && 'active')}
          title="Toggle folders panel"
          onClick={() => setShowFolders((value) => !value)}
        >
          <PanelLeft size={15} aria-hidden />
        </button>
        <button
          className="icon-button compact"
          title={viewMode === 'grid' ? 'Switch to list view' : 'Switch to grid view'}
          onClick={() => setViewMode((mode) => (mode === 'grid' ? 'list' : 'grid'))}
        >
          {viewMode === 'grid' ? <List size={15} aria-hidden /> : <LayoutGrid size={15} aria-hidden />}
        </button>
        <button className="icon-button compact" title="New folder" onClick={() => newFolder(selectedFolderId)}>
          <Folder size={15} aria-hidden />
        </button>
        <button className="icon-button compact" title="Import assets" onClick={() => triggerImport(selectedFolderId)}>
          <Upload size={15} aria-hidden />
        </button>
        <button
          className={clsx('icon-button compact', compressTextures && 'active')}
          title={
            compressTextures
              ? 'Texture compression ON — imported model textures become GPU-compressed KTX2 (smaller VRAM + download). Click to keep textures lossless.'
              : 'Texture compression OFF — imported textures stay lossless. Click to compress to KTX2 on import.'
          }
          onClick={() => updateRenderSettings({ compressTextures: !compressTextures })}
        >
          <FileArchive size={15} aria-hidden />
        </button>
        <button className="icon-button compact" title="Import package (.nfpack)" onClick={importPackage}>
          <PackagePlus size={15} aria-hidden />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          hidden
          multiple
          accept=".glb,.gltf,.fbx,.png,.jpg,.jpeg,.webp,.mp3,.wav"
          onChange={(event) => {
            if (event.target.files) void importFiles(event.target.files, importTargetRef.current);
            event.target.value = '';
          }}
        />
      </div>

      <label className="search-field">
        <Search size={15} aria-hidden />
        <input value={assetSearch} onChange={(event) => setAssetSearch(event.target.value)} placeholder="Search assets" />
      </label>

      <div className={clsx('asset-body', !showFolders && 'no-folders')}>
        {showFolders && (
          <div className="asset-folders">
            <div
              className={clsx('tree-row folder-row root', selectedFolderId === undefined && 'selected', dropTarget === 'root' && 'drop')}
              onClick={() => setSelectedFolderId(undefined)}
              {...folderDropProps(undefined)}
              onContextMenu={(event) => openMenu(event, createMenu(undefined))}
            >
              <span className="tree-twist" />
              <Boxes size={14} aria-hidden />
              <span className="tree-label">Project</span>
            </div>
            {(childFolders.get(undefined) ?? []).map((folder) => renderTreeFolder(folder, 0))}
          </div>
        )}

        <div className="asset-content">
          <div className="asset-toolbar">
            <div className="breadcrumb">
              <button className="crumb" onClick={() => setSelectedFolderId(undefined)}>
                Project
              </button>
              {breadcrumb.map((folder) => (
                <span key={folder.id} className="crumb-part">
                  <ChevronRight size={12} aria-hidden />
                  <button className="crumb" onClick={() => setSelectedFolderId(folder.id)}>
                    {folder.name}
                  </button>
                </span>
              ))}
            </div>
            {viewMode === 'grid' && (
              <input
                className="tile-size"
                type="range"
                min={56}
                max={132}
                step={4}
                value={tileSize}
                title="Thumbnail size"
                onChange={(event) => setTileSize(Number(event.target.value))}
              />
            )}
          </div>

          <div
            ref={viewRef}
            className={clsx('asset-view', viewMode === 'grid' ? 'grid' : 'list', contentDrop && 'drop')}
            onMouseDown={handleMarqueeDown}
            onClick={() => {
              // A real marquee drag manages the selection itself — only a plain click clears it.
              if (!marqueeMovedRef.current) setSelected(new Set());
            }}
            onDragOver={(event) => {
              if (dragRef.current || hasDragType(event.dataTransfer, 'Files')) {
                event.preventDefault();
                setContentDrop(true);
                setDropItemId(null);
              }
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node)) setContentDrop(false);
            }}
            onDrop={(event) => {
              setContentDrop(false);
              handleDrop(event, selectedFolderId);
            }}
            onContextMenu={(event) => openMenu(event, createMenu(selectedFolderId))}
          >
            {isEmpty ? (
              <div className="empty-state wide">
                {searching ? <Search size={18} aria-hidden /> : <Upload size={18} aria-hidden />}
                <span>{searching ? 'No matches' : 'Drop assets here or use Import'}</span>
              </div>
            ) : viewMode === 'grid' ? (
              <>
                {visibleFolders.map((folder) => renderFolderTile(folder))}
                {visibleEntries.map((entry) => renderTile(entry))}
              </>
            ) : (
              <>
                {visibleFolders.map((folder) => renderFolderListRow(folder))}
                {visibleEntries.map((entry) => renderRow(entry))}
              </>
            )}
            {marquee &&
              (() => {
                // Convert the client-space rectangle into coords inside the (scrollable) view.
                const view = viewRef.current;
                const rect = view?.getBoundingClientRect();
                const left = Math.min(marquee.x0, marquee.x1) - (rect?.left ?? 0) + (view?.scrollLeft ?? 0);
                const top = Math.min(marquee.y0, marquee.y1) - (rect?.top ?? 0) + (view?.scrollTop ?? 0);
                return (
                  <div
                    className="marquee"
                    style={{ left, top, width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0) }}
                  />
                );
              })()}
          </div>
        </div>
      </div>

      <ContextMenu state={menu} onClose={() => setMenu(null)} />
      {editSkeletonId && <SkeletonEditorModal skeletonId={editSkeletonId} onClose={() => setEditSkeletonId(undefined)} />}
    </section>
  );
}
