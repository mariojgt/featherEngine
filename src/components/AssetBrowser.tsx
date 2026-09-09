import { packGltfFile } from '../three/modelDocument';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Bone,
  Box,
  Boxes,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Film,
  Folder,
  GitBranch,
  Image,
  LayoutDashboard,
  LayoutGrid,
  List,
  FileArchive,
  Music,
  MoreHorizontal,
  PanelLeft,
  Palette,
  PackagePlus,
  PersonStanding,
  Plus,
  Search,
  Sparkles,
  Table2,
  Upload,
  Workflow,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import { useEditorStore } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import { confirmAction } from '../store/confirmStore';
import { askPackageDetails } from '../store/packageDetailsStore';
import { useModelThumbnails } from '../store/modelThumbnailStore';
import { getPlatform } from '../platform';
import { fbxToGlb } from '../three/convertModel';
import { compressGlbTextures } from '../three/compressTextures';
import { inspectModel, type ModelInspection } from '../three/inspectModel';
import { ContextMenu, type ContextMenuEntry, type ContextMenuState } from './ContextMenu';
import { SkeletonEditorModal } from './SkeletonEditorModal';
import { ASSET_DRAG_TYPE, PREFAB_DRAG_TYPE, MATERIAL_DRAG_TYPE, assetDrag, hasDragType, materialDrag, prefabDrag } from './dragShared';
import { focusWorkspacePanel } from './workspacePanels';
import type { AssetItem, AssetType, ProjectFolder } from '../types';
import './AssetBrowser.css';

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

const itemKey = (kind: EntryKind, id: string) => `${kind}:${id}`;
const parseItemKey = (key: string): { kind: DragKind; id: string } => {
  const idx = key.indexOf(':');
  return { kind: key.slice(0, idx) as DragKind, id: key.slice(idx + 1) };
};

// Kinds shown in the content view. Most are draggable; a few (derived from imports) are read-only.
type EntryKind = DragKind | 'skeleton' | 'skeletalMesh' | 'animation' | 'controller';
type RenameKind = 'blueprint' | 'asset' | 'dataAsset' | 'material' | 'particleSystem' | 'uiDocument' | 'prefab';
type TypeFilter = Exclude<EntryKind, 'asset'> | AssetType;

const TYPE_LABELS: Record<TypeFilter, string> = {
  model: 'Model', image: 'Image', audio: 'Audio', unknown: 'Other file',
  prefab: 'Prefab', blueprint: 'Blueprint', dataAsset: 'Data asset', material: 'Material',
  particleSystem: 'Particle system', uiDocument: 'UI document', skeleton: 'Skeleton',
  skeletalMesh: 'Skeletal mesh', animation: 'Animation', controller: 'Animator controller',
};
const entryType = (entry: AssetEntry): TypeFilter => entry.kind === 'asset' ? entry.assetType ?? 'unknown' : entry.kind;
const entryTypeLabel = (entry: AssetEntry) => TYPE_LABELS[entryType(entry)];

/** A normalised content-browser item — both the tile grid and the list render from this. */
interface AssetEntry {
  kind: EntryKind;
  assetType?: AssetType;
  id: string;
  label: string;
  folderId?: string;
  Icon: typeof Box;
  accent?: string;
  thumbnail?: string;
  prefabThumb?: boolean;
  modelThumb?: boolean;
  subtitle?: string;
  title?: string;
  active?: boolean;
  unresolved?: boolean;
  dragKind?: DragKind; // present → draggable into folders/viewport
  renameKind?: RenameKind; // present → supports inline rename
  onOpen?: () => void; // double-click or the explicit Open action
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
  // GLB/model preview thumbnails (rendered offscreen by ModelThumbnailHost).
  const modelThumbnails = useModelThumbnails((state) => state.thumbnails);
  const requestModelThumbnail = useModelThumbnails((state) => state.request);
  // Ask for a preview of every resolvable model asset that doesn't have one yet.
  useEffect(() => {
    for (const asset of assets) {
      if (asset.type === 'model' && !asset.unresolved && !(asset.id in modelThumbnails)) {
        requestModelThumbnail(asset.id);
      }
    }
  }, [assets, modelThumbnails, requestModelThumbnail]);
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
  const importPackage = async () => {
    const ok = await confirmAction({
      title: 'Import package',
      message:
        'Import a package into this project? It adds new prefabs, blueprints and assets (it never overwrites existing ones), but you should back up your project first if it matters.',
      confirmLabel: 'Import',
    });
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
  const [tileSize, setTileSize] = useState(112);
  const [typeFilter, setTypeFilter] = useState<TypeFilter | 'all'>('all');
  const [popover, setPopover] = useState<{ kind: 'create' | 'options'; left: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const popoverTriggerRef = useRef<HTMLButtonElement | null>(null);
  // Whether the left folder column is shown (hide it to give the tile grid full width).
  const [showFolders, setShowFolders] = useState(true);
  // Highlight when an OS file / dragged item hovers the content pane background.
  const [contentDrop, setContentDrop] = useState(false);
  // Rubber-band (marquee) box-selection in the content view, kept in client coords.
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const marqueeBaseRef = useRef<Set<string>>(new Set());
  const marqueeMovedRef = useRef(false);

  const togglePopover = (event: React.MouseEvent<HTMLButtonElement>, kind: 'create' | 'options') => {
    if (popover?.kind === kind) { setPopover(null); return; }
    const rect = event.currentTarget.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    popoverTriggerRef.current = event.currentTarget;
    setPopover({
      kind,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 288)),
      ...(below >= Math.min(360, above) ? { top: rect.bottom + 4 } : { bottom: window.innerHeight - rect.top + 4 }),
      maxHeight: Math.max(80, Math.min(360, Math.max(below, above))),
    });
  };

  useEffect(() => {
    if (!popover) return;
    popoverRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const dismiss = (event: Event) => {
      if (!popoverRef.current?.contains(event.target as Node) && !popoverTriggerRef.current?.contains(event.target as Node)) setPopover(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setPopover(null);
      popoverTriggerRef.current?.focus();
    };
    const close = () => setPopover(null);
    window.addEventListener('pointerdown', dismiss);
    window.addEventListener('focusin', dismiss);
    window.addEventListener('keydown', escape);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('focusin', dismiss);
      window.removeEventListener('keydown', escape);
      window.removeEventListener('resize', close);
    };
  }, [popover]);

  // Selection always describes the visible results; hidden items must not join a later drag.
  useEffect(() => {
    setSelected(new Set());
    anchorRef.current = null;
  }, [assetSearch, selectedFolderId, typeFilter]);

  const navigateFolder = (folderId?: string) => {
    setSelectedFolderId(folderId);
    setAssetSearch('');
  };

  const revealCreatedItem = (folderId?: string) => {
    navigateFolder(folderId);
    setTypeFilter('all');
    setPopover(null);
  };

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

  const [importReport, setImportReport] = useState<Array<{ name: string; messages: string[]; error?: string }>>([]);
  const importing = useRef(false);
  const [isImporting, setIsImporting] = useState(false);

  const importFiles = async (files: FileList | File[], folderId?: string) => {
    if (importing.current) return;
    importing.current = true;
    setIsImporting(true);
    const report: Array<{ name: string; messages: string[]; error?: string }> = [];
    setImportReport([]);
    try {
    const dropped = Array.from(files);
    const all = dropped.filter((file) => isAccepted(file.name));
    const platform = await getPlatform();
    const dir = projectDir ?? 'web';
    const items: AssetItem[] = [];
    // Model imports are parsed once here so we can split them into visible Project Browser assets:
    // imported materials for every model, plus skeleton/mesh/animation assets for rigged models.
    const modelImports: { assetId: string; assetName: string; inspection: ModelInspection }[] = [];
    let strippedTextures = false;
    let riggedCount = 0;
    // Transcode imported model textures to GPU-compressed KTX2 (on by default; see RenderSettings).
    const compressEnabled = useEditorStore.getState().renderSettings?.compressTextures !== false;
    let compressedCount = 0;
    let savedBytes = 0;
    // Drag-and-drop bypasses the picker's `accept`, so filter to supported types here.
    for (const original of all.filter((file) => isAccepted(file.name))) {
      const receipt: { name: string; messages: string[]; error?: string } = { name: original.name, messages: [] };
      report.push(receipt);
      try {
        // FBX is converted to GLB on import so storage/rendering/export only deal with glTF.
        // The whole selection is passed along so the FBX's sibling texture images resolve.
        let file = /\.gltf$/i.test(original.name) ? await packGltfFile(original, dropped) : original;
        let originalAssetId: string | undefined;
        if (/\.fbx$/i.test(original.name)) {
          // Sidecar images may be TGA/BMP (Unreal-style) and are not imported as their own assets.
          const converted = await fbxToGlb(original, dropped);
          file = converted.file;
          if (converted.droppedTextures > 0) { strippedTextures = true; receipt.messages.push('Some FBX textures are missing. Re-import the FBX together with its texture images.'); }
        }
        // GPU-compress embedded textures to KTX2 (cuts VRAM ~6–8× and shrinks the exported game).
        // On ANY failure we keep the original bytes, so a bad encode never blocks the import.
        if (compressEnabled && /\.glb$/i.test(file.name)) {
          try {
            useProjectStore.setState({ toast: { kind: 'success', message: `Compressing textures in "${file.name}"…` } });
            const result = await compressGlbTextures(await file.arrayBuffer());
            if (result.compressed) {
              const sourceFile = new File([await file.arrayBuffer()], file.name.replace(/\.glb$/i, '.original.glb'), { type: file.type });
              const source = await platform.importAsset(dir, sourceFile);
              originalAssetId = `asset-${crypto.randomUUID()}`;
              items.push({ id: originalAssetId, name: sourceFile.name, type: 'model', size: sourceFile.size, path: source.path, url: source.url, folderId, createdAt: Date.now() });
              receipt.messages.push('Original model kept in Assets; this copy uses compressed textures.');
              file = new File([result.data], file.name, { type: 'model/gltf-binary' });
              savedBytes += Math.max(0, result.beforeBytes - result.afterBytes);
              compressedCount += 1;
            }
          } catch (compressError) {
            receipt.messages.push('Texture optimization failed; the original quality was preserved.');
            console.warn(`Texture compression failed for "${file.name}", importing uncompressed:`, compressError);
          }
        }
        const { path, url } = await platform.importAsset(dir, file);
        const assetId = `asset-${crypto.randomUUID()}`;
        items.push({
          id: assetId,
          originalAssetId,
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
            items.find((item) => item.id === assetId)!.modelInspection = inspection;
            receipt.messages.push(`${inspection.stats?.triangles.toLocaleString() ?? '?'} triangles · ${inspection.materials.length} materials · ${inspection.clips.length} animations`);
            receipt.messages.push(...(inspection.warnings ?? []));
            modelImports.push({ assetId, assetName: file.name, inspection });
            if (inspection.skeleton) {
              riggedCount += 1;
            }
          } catch (inspectError) {
            receipt.messages.push(`Model imported; metadata could not be inspected: ${inspectError instanceof Error ? inspectError.message : String(inspectError)}`);
            console.error(`Couldn't inspect model "${file.name}" for animations:`, inspectError);
          }
        }
      } catch (error) {
        // Don't fail the whole batch — log and surface this one file, keep importing the rest.
        console.error(`Import failed for "${original.name}":`, error);
        const reason = error instanceof Error ? error.message : 'unknown error';
        receipt.error = reason;
        useProjectStore.setState({
          toast: { kind: 'error', message: `Couldn't import "${original.name}": ${reason}` },
        });
      }
    }
    if (items.length) addAssetItems(items);
    // Split imported models into reusable Material/Skeleton/Skeletal Mesh/Animation assets.
    let newClips = 0;
    let newMaterials = 0;
    let staticClipModels = 0;
    for (const model of modelImports) {
      const result = registerImportedModel({ assetId: model.assetId, assetName: model.assetName, folderId, inspection: model.inspection });
      newClips += result.animationsAdded;
      newMaterials += result.materialsAdded;
      if (!model.inspection.skeleton && model.inspection.clips.length > 0) staticClipModels += 1;
    }
    if (riggedCount > 0 || newMaterials > 0) {
      useProjectStore.setState({
        toast: {
          kind: 'success',
          message: `Imported model content${newMaterials ? `: ${newMaterials} material${newMaterials > 1 ? 's' : ''}` : ''}${newClips ? `${newMaterials ? ', ' : ': '}${newClips} animation${newClips > 1 ? 's' : ''}` : ''}${riggedCount ? `${newMaterials || newClips ? ', ' : ': '}${riggedCount} rigged mesh${riggedCount > 1 ? 'es' : ''}` : ''}.`,
        },
      });
    }
    if (staticClipModels > 0) {
      useProjectStore.setState({
        toast: {
          kind: 'success',
          message: 'Some imported clips are static/node animations. They are available on the object Animation clip dropdown after assigning the model; reusable animation assets require a skeleton.',
        },
      });
    }
    if (strippedTextures) {
      useProjectStore.setState({
        toast: {
          kind: 'success',
          message: 'FBX imported, but some material textures were missing. Re-import the .fbx together with its texture images (select them all at once) to keep the full material look.',
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
    setImportReport(report);
    } catch (error) {
      setImportReport([{ name: 'Import', messages: [], error: error instanceof Error ? error.message : String(error) }]);
    } finally { importing.current = false; setIsImporting(false); }
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
    revealCreatedItem(parentId);
    const id = createFolder('New Folder', parentId);
    if (parentId) setCollapsed((prev) => new Set([...prev].filter((value) => value !== parentId)));
    startRename('folder', id, 'New Folder');
  };

  const newBlueprint = (folderId?: string) => {
    revealCreatedItem(folderId);
    const { blueprintId } = createBlueprintNamed(undefined, undefined, folderId);
    if (folderId) setCollapsed((prev) => new Set([...prev].filter((value) => value !== folderId)));
    startRename('blueprint', blueprintId, blueprints.length ? `Blueprint ${blueprints.length + 1}` : 'Blueprint 1');
  };

  const newDataAsset = (folderId?: string) => {
    revealCreatedItem(folderId);
    const id = createDataAsset(undefined, folderId);
    if (folderId) setCollapsed((prev) => new Set([...prev].filter((value) => value !== folderId)));
    startRename('dataAsset', id, dataAssets.length ? `Data Asset ${dataAssets.length + 1}` : 'Data Asset 1');
  };

  const newMaterial = (folderId?: string) => {
    revealCreatedItem(folderId);
    const id = createMaterial(undefined, undefined, folderId);
    if (folderId) setCollapsed((prev) => new Set([...prev].filter((value) => value !== folderId)));
    startRename('material', id, materials.length ? `Material ${materials.length + 1}` : 'Material 1');
  };

  const openMaterial = (id: string) => {
    setActiveMaterial(id);
    focusWorkspacePanel('materials');
  };

  const newParticleSystem = (folderId?: string) => {
    revealCreatedItem(folderId);
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
    revealCreatedItem(folderId);
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
    event.stopPropagation();
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
  const buildOrderedKeys = (): string[] => visibleEntries.map((entry) => itemKey(entry.kind, entry.id));

  // Click selection: plain = select; Ctrl/Cmd = toggle; Shift = range.
  const handleItemClick = (event: React.MouseEvent, kind: EntryKind, id: string) => {
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
  };

  const handleItemDragStart = (event: React.DragEvent, kind: DragKind, id: string, label: string) => {
    const key = itemKey(kind, id);
    // Drag the whole multi-selection if this item is part of it; otherwise drag just this one.
    const draggableKeys = new Set(visibleEntries.filter((entry) => entry.dragKind).map((entry) => itemKey(entry.kind, entry.id)));
    const items = selected.has(key) && selected.size > 1
      ? [...selected].filter((selectedKey) => draggableKeys.has(selectedKey)).map(parseItemKey)
      : [{ kind, id }];
    if (!(selected.has(key) && selected.size > 1)) setSelected(new Set([key]));
    dragRef.current = { items };
    assetDrag.id = null;
    prefabDrag.id = null;
    materialDrag.id = null;
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

    // Dragging a single material into the viewport applies it to the current selection.
    const materialItems = items.filter((item) => item.kind === 'material');
    if (materialItems.length === 1) {
      materialDrag.id = materialItems[0].id;
      try {
        event.dataTransfer.setData(MATERIAL_DRAG_TYPE, materialItems[0].id);
      } catch {
        /* some webviews block setData during dragstart — the shared holder covers it */
      }
    }
    // Particle systems also drop into the viewport. Reuse the asset holder because the viewport
    // resolves particle systems before imported assets, and both are project-level items.
    const particleItems = items.filter((item) => item.kind === 'particleSystem');
    if (particleItems.length === 1) {
      assetDrag.id = particleItems[0].id;
      try {
        event.dataTransfer.setData(ASSET_DRAG_TYPE, particleItems[0].id);
      } catch {
        /* some webviews block setData during dragstart — the shared holder covers it */
      }
    }
    const viewportPlaceable = items.length === 1 && ['asset', 'prefab', 'particleSystem', 'material'].includes(items[0].kind);
    event.dataTransfer.effectAllowed = viewportPlaceable ? 'copyMove' : 'move';
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
    materialDrag.id = null;
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

  const renderRenameInput = () => (
    <input
      className="tree-rename"
      aria-label="Rename item"
      value={draft}
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commitRename}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') { event.preventDefault(); commitRename(); }
        if (event.key === 'Escape') { event.preventDefault(); setRenaming(null); }
      }}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
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
        accent: 'var(--warning)',
        thumbnail: prefab.thumbnail,
        prefabThumb: true,
        subtitle: `${prefab.objects.length} objects`,
        active: editingPrefabId === prefab.id,
        dragKind: 'prefab',
        renameKind: 'prefab',
        title: `prefab · ${prefab.objects.length} object${prefab.objects.length > 1 ? 's' : ''} — double-click to edit, drag into the viewport to place`,
        onOpen: () => openPrefabEditor(prefab.id),
        menu: [
          { label: 'Add to Scene', onClick: () => instantiatePrefab(prefab.id) },
          { label: 'Open in Prefab Editor', onClick: () => openPrefabEditor(prefab.id) },
          { label: 'Rename', onClick: () => startRename('prefab', prefab.id, prefab.name) },
          {
            label: 'Export as Package…',
            onClick: () =>
              void (async () => {
                const meta = await askPackageDetails({
                  title: 'Export package',
                  summary: `"${prefab.name}" plus every blueprint, material and asset it references.`,
                  defaults: { name: prefab.name, version: '1.0.0', thumbnail: prefab.thumbnail },
                });
                if (meta) await exportPrefabPackage(prefab.id, meta);
              })(),
          },
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
        accent: 'var(--warning)',
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
        accent: 'var(--accent)',
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
        accent: 'var(--accent)',
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
        accent: 'var(--accent)',
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
        accent: 'var(--accent)',
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
        accent: 'var(--success)',
        subtitle: `${anim.duration.toFixed(1)}s${anim.loop ? ' · loop' : ''}`,
        title: `animation · ${anim.duration.toFixed(2)}s${anim.loop ? ' · loops' : ''}`,
      }),
    );
    assets.forEach((asset) =>
      out.push({
        kind: 'asset',
        assetType: asset.type,
        id: asset.id,
        label: asset.name,
        folderId: asset.folderId,
        Icon: assetGlyph(asset.type),
        thumbnail:
          asset.type === 'image' && !asset.unresolved
            ? asset.url
            : asset.type === 'model'
              ? modelThumbnails[asset.id] || undefined // '' (failed) → fall back to the icon
              : undefined,
        // Model previews render asynchronously — flag so the tile shows a shimmer while it generates.
        modelThumb: asset.type === 'model' && !asset.unresolved && !(asset.id in modelThumbnails),
        subtitle: formatBytes(asset.size),
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
    {
      label: 'Export Folder as Package…',
      onClick: () =>
        void (async () => {
          const meta = await askPackageDetails({
            title: 'Export folder as package',
            summary: `Everything in "${folder.name}" and its subfolders, plus dependencies.`,
            defaults: { name: folder.name, version: '1.0.0' },
          });
          if (meta) await exportFolderPackage(folder.id, meta);
        })(),
    },
    { label: 'Rename', onClick: () => { revealCreatedItem(folder.parentId); startRename('folder', folder.id, folder.name); } },
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
    if ((event.target as HTMLElement).closest('.asset-tile, .tree-row, button, input')) return;
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

  // Selection is consistent for every kind; opening and scene placement are deliberate actions.
  const entryHandlers = (entry: AssetEntry) => ({
    ...(entry.dragKind ? rowDnd(entry.dragKind, entry.id, entry.folderId, entry.label) : {}),
    onClick: (event: React.MouseEvent) => handleItemClick(event, entry.kind, entry.id),
    onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.currentTarget.click();
      }
      if (event.key === 'F2' && entry.renameKind) startRename(entry.renameKind, entry.id, entry.label);
      if ((event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) && entry.menu) {
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        setMenu({ x: rect.left, y: rect.bottom, items: entry.menu });
      }
    },
    onDoubleClick: () => entry.onOpen?.(),
    onContextMenu: (event: React.MouseEvent) => entry.menu && openMenu(event, entry.menu),
  });

  // ---- Tile + list renderers ------------------------------------------------
  const renderTile = (entry: AssetEntry) => {
    const sel = selected.has(itemKey(entry.kind, entry.id));
    return (
      <div
        role="button"
        tabIndex={0}
        aria-pressed={sel}
        aria-label={`${entry.label}, ${entryTypeLabel(entry)}${entry.unresolved ? ', missing file' : ''}`}
        key={`${entry.kind}:${entry.id}`}
        data-key={itemKey(entry.kind, entry.id)}
        className={clsx('asset-tile', sel && 'selected', entry.active && 'active', dropItemId === entry.id && 'drop-into')}
        style={{ width: tileSize }}
        title={`${entry.label} · ${entry.title ?? entryTypeLabel(entry)}`}
        {...entryHandlers(entry)}
      >
        <span className="asset-tile-thumb" style={{ height: tileSize - 18 }}>
          {entry.thumbnail ? (
            <img className={clsx('asset-tile-img', entry.prefabThumb && 'prefab')} src={entry.thumbnail} alt="" />
          ) : entry.prefabThumb || entry.modelThumb ? (
            // Prefab/model tile whose preview is still rendering — show a shimmer rather than a flashing icon.
            <span className="skeleton" style={{ width: '100%', height: '100%' }} aria-label="Generating preview" />
          ) : (
            <entry.Icon size={Math.round(tileSize * 0.4)} style={{ color: entry.accent }} className={clsx(entry.unresolved && 'tree-unresolved')} aria-hidden />
          )}
        </span>
        <span className="asset-tile-name">
          {isRenaming(entry) ? renderRenameInput() : <span className="tree-label">{entry.label}</span>}
        </span>
        <span className="asset-entry-type">{entryTypeLabel(entry)}{entry.unresolved && ' · Missing'}</span>
        {searching && <span className="asset-entry-location" title={folderPath(entry.folderId)}>{folderPath(entry.folderId)}</span>}
      </div>
    );
  };

  const renderRow = (entry: AssetEntry) => {
    const sel = selected.has(itemKey(entry.kind, entry.id));
    return (
      <div
        role="button"
        tabIndex={0}
        aria-pressed={sel}
        aria-label={`${entry.label}, ${entryTypeLabel(entry)}${entry.unresolved ? ', missing file' : ''}`}
        key={`${entry.kind}:${entry.id}`}
        data-key={itemKey(entry.kind, entry.id)}
        className={clsx('tree-row', sel && 'selected', entry.active && 'active', dropItemId === entry.id && 'drop-into')}
        style={{ paddingLeft: 8 }}
        title={`${entry.label} · ${entry.title ?? entryTypeLabel(entry)}`}
        {...entryHandlers(entry)}
      >
        {entry.thumbnail ? (
          <img className={clsx('tree-thumb', entry.prefabThumb && 'prefab-thumb')} src={entry.thumbnail} alt="" />
        ) : (
          <entry.Icon size={14} style={{ color: entry.accent }} className={clsx(entry.unresolved && 'tree-unresolved')} aria-hidden />
        )}
        {isRenaming(entry) ? (
          renderRenameInput()
        ) : (
          <>
            <span className="asset-row-copy"><span className="tree-label">{entry.label}</span>{searching && <span className="asset-entry-location" title={folderPath(entry.folderId)}>{folderPath(entry.folderId)}</span>}</span>
            <span className="tree-sub">{entryTypeLabel(entry)}{entry.unresolved ? ' · Missing' : entry.subtitle ? ` · ${entry.subtitle}` : ''}</span>
          </>
        )}
      </div>
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
          role="button"
          tabIndex={0}
          aria-label={`Open folder ${folder.name}`}
          aria-current={selectedFolderId === folder.id ? 'location' : undefined}
          className={clsx('tree-row folder-row', selectedFolderId === folder.id && 'selected', dropTarget === folder.id && 'drop')}
          style={{ paddingLeft: 4 + depth * 12 }}
          title={folder.name}
          onClick={() => navigateFolder(folder.id)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); navigateFolder(folder.id); }
          }}
          {...folderDropProps(folder.id)}
          onContextMenu={(event) => openMenu(event, folderMenu(folder))}
        >
          {kids.length > 0 ? (
            <button
              className="tree-twist"
              aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${folder.name}`}
              aria-expanded={!isCollapsed}
              onKeyDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                toggleCollapse(folder.id);
              }}
            >
              {isCollapsed ? <ChevronRight size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
            </button>
          ) : (
            <span className="tree-twist" />
          )}
          <Folder size={14} aria-hidden />
          <span className="tree-label">{folder.name}</span>
        </div>
        {!isCollapsed && kids.map((child) => renderTreeFolder(child, depth + 1))}
      </div>
    );
  };

  // A subfolder shown inside the content grid (click to enter).
  const renderFolderTile = (folder: ProjectFolder) => (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Open folder ${folder.name}`}
      key={`folder:${folder.id}`}
      className={clsx('asset-tile folder-tile', dropTarget === folder.id && 'drop')}
      style={{ width: tileSize }}
      title={`${folder.name} · Folder · Click to open`}
      onClick={() => navigateFolder(folder.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); navigateFolder(folder.id); }
      }}
      {...folderDropProps(folder.id)}
      onContextMenu={(event) => openMenu(event, folderMenu(folder))}
    >
      <span className="asset-tile-thumb" style={{ height: tileSize - 18 }}>
        <Folder size={Math.round(tileSize * 0.46)} aria-hidden />
      </span>
      <span className="asset-tile-name">
        {renaming?.kind === 'folder' && renaming.id === folder.id ? (
          renderRenameInput()
        ) : (
          <span className="tree-label">{folder.name}</span>
        )}
      </span>
      <span className="asset-entry-type">Folder</span>
    </div>
  );

  const renderFolderListRow = (folder: ProjectFolder) => (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Open folder ${folder.name}`}
      key={`folder:${folder.id}`}
      className={clsx('tree-row folder-row', dropTarget === folder.id && 'drop')}
      style={{ paddingLeft: 8 }}
      title={`${folder.name} · Folder · Click to open`}
      onClick={() => navigateFolder(folder.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); navigateFolder(folder.id); }
      }}
      {...folderDropProps(folder.id)}
      onContextMenu={(event) => openMenu(event, folderMenu(folder))}
    >
      <Folder size={14} aria-hidden />
      {renaming?.kind === 'folder' && renaming.id === folder.id ? (
        renderRenameInput()
      ) : (
        <span className="tree-label">{folder.name}</span>
      )}
      <span className="tree-sub">Folder</span>
    </div>
  );

  // ---- Derived view data ----------------------------------------------------
  const search = assetSearch.trim().toLowerCase();
  const searching = search.length > 0;
  const allEntries = buildEntries();
  // Searching flattens across every folder; otherwise we show only the active folder's contents.
  const visibleEntries = allEntries.filter((entry) =>
    (searching ? entry.label.toLowerCase().includes(search) : entry.folderId === selectedFolderId)
    && (typeFilter === 'all' || entryType(entry) === typeFilter),
  );
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
  const folderPath = (folderId?: string) => {
    const parts: string[] = [];
    const seen = new Set<string>();
    while (folderId && !seen.has(folderId)) {
      seen.add(folderId);
      const folder = folders.find((item) => item.id === folderId);
      if (!folder) break;
      parts.unshift(folder.name);
      folderId = folder.parentId;
    }
    return ['Project', ...parts].join(' / ');
  };
  const selectedEntries = visibleEntries.filter((entry) => selected.has(itemKey(entry.kind, entry.id)));
  const selectedEntry = selectedEntries.length === 1 ? selectedEntries[0] : undefined;
  const selectionHint = selectedEntry?.unresolved ? 'Missing file. Re-import the source asset.'
    : selectedEntry?.kind === 'material' ? 'Drag into the viewport to apply to selected objects.'
    : selectedEntry && (selectedEntry.assetType === 'model' || selectedEntry.kind === 'prefab' || selectedEntry.kind === 'particleSystem') ? 'Drag into the viewport to place in the scene.'
    : selectedEntry?.onOpen ? 'Open to edit this reusable resource.'
    : selectedEntry?.dragKind ? 'Drag into a folder to organize this resource.'
    : selectedEntry ? 'Derived from an imported model.'
    : `${selectedEntries.length} selected`;
  const creationActions = [
    { label: 'Folder', description: 'Organize project assets', Icon: Folder, run: newFolder },
    { label: 'Blueprint', description: 'Reusable gameplay logic', Icon: GitBranch, run: newBlueprint },
    { label: 'Material', description: 'Shared surface appearance', Icon: Palette, run: newMaterial },
    { label: 'Particle system', description: 'Reusable visual effect', Icon: Sparkles, run: newParticleSystem },
    { label: 'UI document', description: 'Screen or world interface', Icon: LayoutDashboard, run: newUIDocument },
    { label: 'Data asset', description: 'Reusable table of values', Icon: Table2, run: newDataAsset },
  ];

  return (
    <section className="panel asset-panel asset-browser" aria-label="Asset browser" data-testid="asset-browser">
      <div className="asset-browser-toolbar">
      <div className="asset-browser-actions">
        <button className="asset-browser-button primary" title={`Import assets into ${folderPath(selectedFolderId)}`} disabled={isImporting} onClick={() => triggerImport(selectedFolderId)}>
          <Upload size={14} aria-hidden />
          {isImporting ? 'Importing…' : 'Import assets'}
        </button>
        <button
          className="asset-browser-button"
          aria-label="Create resource"
          title="Create resource"
          aria-expanded={popover?.kind === 'create'}
          aria-haspopup="dialog"
          onClick={(event) => togglePopover(event, 'create')}
        >
          <Plus size={14} aria-hidden /><span>Create resource</span><ChevronDown size={12} aria-hidden />
        </button>
        <button className="icon-button compact asset-browser-more" title="Asset browser options" aria-label="Asset browser options" aria-haspopup="dialog" aria-expanded={popover?.kind === 'options'} onClick={(event) => togglePopover(event, 'options')}>
          <MoreHorizontal size={16} aria-hidden />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          aria-label="Choose assets to import"
          hidden
          multiple
          accept=".glb,.gltf,.fbx,.bin,.ktx2,.tga,.bmp,.png,.jpg,.jpeg,.webp,.mp3,.wav"
          onChange={(event) => {
            if (event.target.files) void importFiles(event.target.files, importTargetRef.current);
            event.target.value = '';
          }}
        />
      </div>

      {importReport.length > 0 && <details className="model-import-report">
        <summary>Last import · {importReport.filter((item) => !item.error).length} completed · {importReport.filter((item) => item.error).length} failed</summary>
        <div role="status">{importReport.map((item, index) => <article key={index}><strong>{item.name}</strong>{item.error && <p className="ai-error">{item.error}</p>}{item.messages.map((message, i) => <p key={i}>{message}</p>)}</article>)}</div>
      </details>}
      <div className="asset-browser-filters">
        <div className="search-field">
          <Search size={14} aria-hidden />
          <input aria-label="Search all assets" value={assetSearch} onChange={(event) => setAssetSearch(event.target.value)} placeholder="Search all assets" onKeyDown={(event) => { if (event.key === 'Escape') setAssetSearch(''); }} />
          {assetSearch && <button className="icon-button compact" aria-label="Clear asset search" title="Clear search" onClick={() => setAssetSearch('')}><X size={12} aria-hidden /></button>}
        </div>
        <select className={clsx('asset-type-filter', typeFilter !== 'all' && 'active')} aria-label="Filter assets by type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as TypeFilter | 'all')}>
          <option value="all">All types</option>
          {Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>

      </div>
      <div className={clsx('asset-body', !showFolders && 'no-folders')}>
        {showFolders && (
          <div className="asset-folders" aria-label="Project folders">
            <div
              role="button"
              tabIndex={0}
              aria-label="Open project folder"
              aria-current={selectedFolderId === undefined ? 'location' : undefined}
              className={clsx('tree-row folder-row root', selectedFolderId === undefined && 'selected', dropTarget === 'root' && 'drop')}
              onClick={() => navigateFolder(undefined)}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); navigateFolder(undefined); } }}
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
            <button className={clsx('icon-button compact', showFolders && 'active')} title="Toggle folders panel" aria-label="Toggle folders panel" aria-pressed={showFolders} onClick={() => setShowFolders((value) => !value)}><PanelLeft size={14} aria-hidden /></button>
            <div className="breadcrumb" aria-label={searching ? 'Searching all project folders' : 'Current folder'}>
              {searching ? <span className="asset-search-scope">All folders</span> : <>
              <button className="crumb" onClick={() => navigateFolder(undefined)}>
                Project
              </button>
              {breadcrumb.map((folder) => (
                <span key={folder.id} className="crumb-part">
                  <ChevronRight size={12} aria-hidden />
                  <button className="crumb" title={folder.name} onClick={() => navigateFolder(folder.id)}>
                    {folder.name}
                  </button>
                </span>
              ))}
              </>}
            </div>
            <span className="asset-result-count" role="status">{visibleEntries.length} {visibleEntries.length === 1 ? 'asset' : 'assets'}</span>
            {viewMode === 'grid' && (
              <input
                className="tile-size"
                type="range"
                min={96}
                max={160}
                step={4}
                value={tileSize}
                title="Thumbnail size"
                aria-label="Thumbnail size"
                onChange={(event) => setTileSize(Number(event.target.value))}
              />
            )}
            <button className="icon-button compact" title={viewMode === 'grid' ? 'Switch to list view' : 'Switch to grid view'} aria-label={viewMode === 'grid' ? 'Switch to list view' : 'Switch to grid view'} onClick={() => setViewMode((mode) => mode === 'grid' ? 'list' : 'grid')}>
              {viewMode === 'grid' ? <List size={14} aria-hidden /> : <LayoutGrid size={14} aria-hidden />}
            </button>
          </div>

          <div
            ref={viewRef}
            aria-label="Assets"
            aria-busy={isImporting}
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
                <strong>{searching || typeFilter !== 'all' ? 'No matching assets' : 'This folder is empty'}</strong>
                <span>{searching ? 'Try another name or asset type.' : typeFilter !== 'all' ? 'Choose another type or clear the filter.' : 'Drop models, images or audio here to import.'}</span>
                {searching || typeFilter !== 'all' ? <button className="asset-browser-button" onClick={() => { setAssetSearch(''); setTypeFilter('all'); }}>Clear search and filters</button> : <button className="asset-browser-button" disabled={isImporting} onClick={() => triggerImport(selectedFolderId)}><Upload size={14} aria-hidden /> Import assets</button>}
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

      {selectedEntries.length > 0 && <div className="asset-selection-bar" aria-label="Asset selection">
        <div className="asset-selection-copy">
          {selectedEntry && <strong title={selectedEntry.label}>{selectedEntry.label}<span>{entryTypeLabel(selectedEntry)}{selectedEntry.subtitle ? ` · ${selectedEntry.subtitle}` : ''}</span></strong>}
          <span>{selectionHint}</span>
        </div>
        {selectedEntry?.onOpen && <button className="icon-button compact" title={selectedEntry.kind === 'prefab' ? 'Open prefab' : 'Open editor'} aria-label={selectedEntry.kind === 'prefab' ? 'Open prefab' : 'Open editor'} onClick={selectedEntry.onOpen}><ExternalLink size={15} aria-hidden /></button>}
        {selectedEntry?.kind === 'prefab' && <button className="asset-browser-button" onClick={() => instantiatePrefab(selectedEntry.id)}><Plus size={13} aria-hidden /> Add to Scene</button>}
        {selectedEntry?.menu && <button className="icon-button compact" aria-label={`Actions for ${selectedEntry.label}`} title="Asset actions" onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setMenu({ x: Math.max(8, rect.right - 200), y: Math.max(8, rect.top - selectedEntry.menu!.length * 32), items: selectedEntry.menu! });
        }}><MoreHorizontal size={15} aria-hidden /></button>}
      </div>}

      {popover && createPortal(
        <div ref={popoverRef} className="asset-browser-popover" role="dialog" aria-label={popover.kind === 'create' ? 'Create resource' : 'Asset browser options'} style={{ left: popover.left, top: popover.top, bottom: popover.bottom, maxHeight: popover.maxHeight }}>
          <div className="asset-popover-heading">{popover.kind === 'create' ? 'Create resource' : 'Import options'}<button className="icon-button compact" aria-label="Close asset browser menu" onClick={() => { setPopover(null); popoverTriggerRef.current?.focus(); }}><X size={14} aria-hidden /></button></div>
          <p className="asset-popover-context" title={folderPath(selectedFolderId)}>{popover.kind === 'create' ? `Create in ${folderPath(selectedFolderId)}` : 'Applies to future imports'}</p>
          {popover.kind === 'create' ? creationActions.map(({ label, description, Icon, run }) => <button key={label} className="asset-popover-action" title={description} onClick={() => run(selectedFolderId)}><Icon size={17} aria-hidden /><span><strong>{label}</strong></span></button>) : <>
            <button className="asset-popover-action" aria-pressed={compressTextures} onClick={() => updateRenderSettings({ compressTextures: !compressTextures })}><FileArchive size={17} aria-hidden /><span><strong>Compress model textures: {compressTextures ? 'On' : 'Off'}</strong><small>{compressTextures ? 'Smaller GPU memory use and downloads' : 'Keep imported textures lossless'}</small></span></button>
            <button className="asset-popover-action" title="Import package (.nfpack)" onClick={() => { setPopover(null); void importPackage(); }}><PackagePlus size={17} aria-hidden /><span><strong>Import package…</strong><small>Prefabs and resources from a .nfpack file</small></span></button>
          </>}
        </div>, document.body,
      )}
      <ContextMenu state={menu} onClose={() => setMenu(null)} />
      {editSkeletonId && <SkeletonEditorModal skeletonId={editSkeletonId} onClose={() => setEditSkeletonId(undefined)} />}
    </section>
  );
}
