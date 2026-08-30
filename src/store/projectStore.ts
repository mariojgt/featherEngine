import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getPlatform, isDesktop } from '../platform';
import type { ExportPlatformsReport } from '../platform/types';
import { blankProject } from '../project/serialize';
import { buildGameBundle, embedAssets, mimeForAsset, stripUnusedAssets, type GameBundle } from '../project/exportGame';
import { verifyGameBundle, type BundleReport } from '../project/verifyBundle';
import {
  buildPackage,
  remapPackageForImport,
  type NodeForgePackage,
  type PackageContent,
  type PackageMeta,
} from '../project/package';
import {
  readPackageFile,
  writePackageArchive,
  type PackageArchive,
} from '../project/packageArchive';
import type { AssetItem, ExportProfile } from '../types';
import { activeExportProfile } from '../project/exportProfiles';
import { contentAddressedName, dataUrlToBytes, sha256Hex } from '../utils/contentHash';
import { useEditorStore } from './editorStore';
import { clearHistory } from './history';
import { clearRecovery, type RecoverySnapshot } from './autosave';
import { canUseHostOnlyFeatures, collaborationAccess } from '../collaboration/access';

/** Caller-supplied package metadata; the rest (id, createdAt, engineVersion) is filled in. */
export type PackageMetaInput = Partial<Omit<PackageMeta, 'engineVersion' | 'createdAt'>>;

const mimeFromDataUrl = (dataUrl: string) =>
  /data:([^;,]+)/.exec(dataUrl.slice(0, dataUrl.indexOf(',')))?.[1] ?? 'application/octet-stream';

/** Refuse absurd downloads outright rather than trying to buffer them. */
const MAX_ASSET_BYTES = 512 * 1024 * 1024;

/**
 * Obtain an asset's bytes, either from the package's inlined data URL or by fetching its external
 * `source`. External bytes are hash-verified: a mismatch means the file was swapped or truncated in
 * transit, and installing it anyway would silently corrupt the project.
 */
async function loadPackageAssetBytes(
  asset: AssetItem,
  carried?: Uint8Array,
): Promise<{ bytes: Uint8Array; mime: string; hash: string }> {
  // Bytes shipped inside the package archive — the common case now, and no network at all.
  if (carried) {
    const hash = await sha256Hex(carried);
    if (asset.hash && hash !== asset.hash) {
      throw new Error(`"${asset.name}" failed its integrity check — the archive's bytes don't match its manifest.`);
    }
    // Archive entries carry no MIME, so derive it from the name — an image labelled
    // application/octet-stream won't render once it becomes a data URL on the web path.
    return { bytes: carried, mime: mimeForAsset(asset) ?? 'application/octet-stream', hash };
  }
  if (asset.data) {
    const bytes = dataUrlToBytes(asset.data);
    return { bytes, mime: mimeFromDataUrl(asset.data), hash: asset.hash ?? (await sha256Hex(bytes)) };
  }
  const source = asset.source;
  if (!source?.url) throw new Error(`Asset "${asset.name}" has no bytes and no source URL.`);
  if (source.bytes && source.bytes > MAX_ASSET_BYTES) {
    throw new Error(`Asset "${asset.name}" is ${(source.bytes / 1048576).toFixed(0)} MB — refusing to download.`);
  }

  // Relative source URLs resolve against the app, which is what bundled packages want. A hosted
  // store publishes absolute URLs, so both work without the package knowing where it was served from.
  const url = new URL(source.url, document.baseURI).toString();
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download "${asset.name}" (HTTP ${response.status}).`);
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_ASSET_BYTES) throw new Error(`Asset "${asset.name}" is too large to install.`);

  const hash = await sha256Hex(buffer);
  if (source.sha256 && hash !== source.sha256) {
    throw new Error(`"${asset.name}" failed its integrity check — the downloaded file is not what the package declared.`);
  }
  return {
    bytes: new Uint8Array(buffer),
    mime: response.headers?.get?.('content-type') || 'application/octet-stream',
    hash,
  };
}

/**
 * Turn a package's assets into project assets with a runtime url. Bytes come from the inlined data
 * URL or from an external `source`. On a saved desktop project we write them to disk under a
 * content-addressed name (persistent `path`); otherwise we keep a data URL as the url so the asset
 * still renders and survives a web download.
 *
 * Assets whose bytes are already on disk (same hash) reuse the existing file instead of writing a
 * second copy — which is also what stops two different files that share a name from clobbering
 * each other, since the name now includes the hash.
 */
async function resolvePackageAssets(
  assets: AssetItem[],
  projectDir: string | null,
  platform: Awaited<ReturnType<typeof getPlatform>>,
  existingAssets: AssetItem[] = [],
  carried: Map<string, Uint8Array> = new Map(),
): Promise<AssetItem[]> {
  const onDisk = platform.isDesktop && !!projectDir && projectDir !== 'web';
  const written = new Map<string, { path?: string; url?: string }>(
    existingAssets.filter((a) => a.hash && a.path).map((a) => [a.hash as string, { path: a.path, url: a.url }]),
  );

  const resolved: AssetItem[] = [];
  for (const asset of assets) {
    let loaded: { bytes: Uint8Array; mime: string; hash: string };
    try {
      loaded = await loadPackageAssetBytes(asset, carried.get(asset.id));
    } catch {
      resolved.push({ ...asset, unresolved: true });
      continue;
    }
    const { bytes, mime, hash } = loaded;

    const reuse = written.get(hash);
    if (reuse) {
      resolved.push({ ...asset, hash, path: reuse.path, url: reuse.url, data: undefined });
      continue;
    }

    if (onDisk) {
      try {
        const name = contentAddressedName(asset.name || asset.id, hash);
        const file = new File([bytes], name, { type: mime });
        const { path, url } = await platform.importAsset(projectDir as string, file);
        written.set(hash, { path, url });
        resolved.push({ ...asset, hash, path, url, data: undefined });
        continue;
      } catch {
        // Fall through to keeping the bytes in memory rather than losing the asset entirely.
      }
    }

    const dataUrl = asset.data ?? `data:${mime};base64,${bytesToBase64(bytes)}`;
    resolved.push({ ...asset, hash, data: dataUrl, url: dataUrl });
  }
  return resolved;
}

/** Base64-encode in chunks — a single spread over a multi-MB array blows the call stack. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** What an install actually brought in, for the confirmation toast. */
interface InstallSummary {
  name: string;
  prefabs: number;
  assets: number;
}

/**
 * Download a `.nfpack` over HTTP — the asset store's transport. Deliberately separate from the
 * install so a network failure reads differently from a corrupt package, and so the only difference
 * between "opened a file" and "installed from the store" is where the bytes came from.
 */
async function fetchPackage(url: string, signal?: AbortSignal): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new Error(`Could not reach ${url}. Check your connection.`);
  }
  if (!response.ok) throw new Error(`Download failed (HTTP ${response.status} ${response.statusText}).`);
  return new Uint8Array(await response.arrayBuffer());
}

/** Pack a built package into its `.nfpack` container, moving asset bytes out of base64 and into
 *  archive entries. This is what gets written to disk or uploaded — one file, compressed. */
function serializePackage(pkg: NodeForgePackage): Uint8Array {
  const bytes = new Map<string, Uint8Array>();
  for (const asset of pkg.assets) {
    if (asset.data) bytes.set(asset.id, dataUrlToBytes(asset.data));
  }
  return writePackageArchive(pkg, bytes);
}

/**
 * The shared tail of every install: re-id everything so the merge is purely additive, materialise
 * asset bytes, then hand the content to `merge` (append for a module, replace-world for a project).
 */
async function applyPackage(
  { pkg, bytes }: PackageArchive,
  projectDir: string | null,
  platform: Awaited<ReturnType<typeof getPlatform>>,
  merge: (content: PackageContent, assets: AssetItem[]) => void,
): Promise<InstallSummary> {
  // Plugins install through the Asset Store (src/store/pluginStore.ts), which activates the
  // compiled-in module the manifest names — not through the project merge below, which would
  // merge empty content and report success.
  if (pkg.kind === 'plugin') {
    throw new Error(
      `"${pkg.meta?.name ?? 'This package'}" is an editor plugin — install it from the Asset Store panel, not as project content.`,
    );
  }
  const editor = useEditorStore.getState();
  const { content, assets } = remapPackageForImport(pkg, editor.skeletons, editor.assets);
  // The archive keys bytes by the package's ORIGINAL asset ids while remap hands back new ones, so
  // rekey by content hash — otherwise every carried asset looks absent and falls back to the network.
  const carried = new Map<string, Uint8Array>();
  for (const original of pkg.assets) {
    const data = bytes.get(original.id);
    if (!data || !original.hash) continue;
    const match = assets.find((entry) => entry.hash === original.hash);
    if (match) carried.set(match.id, data);
  }
  const resolved = await resolvePackageAssets(assets, projectDir, platform, editor.assets, carried);
  merge(content, resolved);
  return { name: pkg.meta?.name ?? 'package', prefabs: content.prefabs.length, assets: resolved.length };
}

/** Install from raw `.nfpack` bytes — either container: a zip archive or a legacy plain-JSON file. */
async function installParsedPackage(
  input: Uint8Array,
  projectDir: string | null,
  platform: Awaited<ReturnType<typeof getPlatform>>,
): Promise<InstallSummary> {
  const editor = useEditorStore.getState();
  return applyPackage(readPackageFile(input), projectDir, platform, editor.mergePackage);
}

const installedMessage = ({ name, prefabs, assets }: InstallSummary) =>
  `Imported "${name}" (${prefabs} prefab${prefabs === 1 ? '' : 's'}` +
  `${assets ? `, ${assets} asset${assets === 1 ? '' : 's'}` : ''}).`;

interface RecentProject {
  dir: string;
  name: string;
}

interface ProjectState {
  hasProject: boolean;
  projectDir: string | null;
  projectName: string;
  recentProjects: RecentProject[];
  busy: boolean;
  error: string | null;
  toast: { kind: 'success' | 'error'; message: string } | null;
  /** Live progress while a production build runs (desktop). Null when idle. */
  buildProgress: { running: boolean; lines: string[] } | null;
  /** Most recent successful production artifact root in this project session. */
  lastProductionOutput: string | null;
  /** A built+verified bundle waiting for the user's go-ahead in the Build Report dialog. */
  pendingExport: { mode: 'game' | 'production'; bundle: GameBundle; report: BundleReport } | null;
  /** Platform-doctor report for the export dialog's platform picker (desktop only). */
  exportPlatforms: ExportPlatformsReport | null;
  /** A failed platform-doctor invocation; shown with an explicit retry in the export dialog. */
  exportPlatformsError: string | null;
  clearToast: () => void;
  clearBuildProgress: () => void;
  /** Refresh `exportPlatforms` from the platform doctor (no-op on web). */
  loadExportPlatforms: () => Promise<void>;
  /** Close the Build Report dialog without exporting. */
  cancelPendingExport: () => void;
  /** Confirm the Build Report dialog with an immutable profile snapshot. */
  confirmPendingExport: (stripUnused: boolean, profile?: ExportProfile) => Promise<void>;
  newProject: (name: string) => Promise<void>;
  openProject: () => Promise<void>;
  openRecent: (dir: string) => Promise<void>;
  /** Drop a recent project from the launcher list (does not delete files on disk). */
  removeRecent: (dir: string) => void;
  save: () => Promise<void>;
  saveAs: (name: string) => Promise<void>;
  exportGame: () => Promise<void>;
  exportProduction: () => Promise<void>;
  /** Export a prefab + its dependency closure as a portable `.nfpack` package file. */
  exportPrefabPackage: (prefabId: string, meta?: PackageMetaInput) => Promise<void>;
  /** Export everything in a folder (and its subfolders) + dependencies as one `.nfpack`, like Unreal's Migrate. */
  exportFolderPackage: (folderId: string, meta?: PackageMetaInput) => Promise<void>;
  /** Export the whole project (every scene + dependencies) as a `kind: 'project'` `.nfpack` —
   *  a shareable template/world rather than a single reusable component. */
  exportProjectPackage: (meta?: PackageMetaInput) => Promise<void>;
  /** Pick a `.nfpack` file and additively import its content into the current project. */
  importPackageFromFile: () => Promise<void>;
  /**
   * Create a new project from a `kind: 'project'` package at `url` — the store's "use this template"
   * path. Unlike installing a module, this REPLACES the world, so it always starts from a new
   * project rather than merging into whatever the user has open.
   */
  newProjectFromPackageUrl: (url: string, name: string) => Promise<boolean>;
  /**
   * Download a `.nfpack` from a URL and additively import it — the asset store's install path.
   * Same trust model as importPackageFromFile: the caller is responsible for vouching for the URL.
   * Resolves true when the package landed in the project, so a caller can update its own UI.
   */
  importPackageFromUrl: (url: string) => Promise<boolean>;
  useDemo: () => void;
  closeProject: () => void;
  /** Load an autosaved recovery snapshot back into the editor (from the Launcher's restore prompt). */
  restoreRecovery: (snapshot: RecoverySnapshot) => void;
  clearError: () => void;
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => {
      const blockProjectLifecycleDuringCollaboration = () => {
        if (!collaborationAccess().active) return false;
        set({
          toast: {
            kind: 'error',
            message: 'Leave or stop collaboration before opening, creating, or closing a project.',
          },
        });
        return true;
      };

      const blockGuestPackageMutation = () => {
        if (canUseHostOnlyFeatures()) return false;
        set({
          toast: {
            kind: 'error',
            message: 'Only the collaboration host can import packages into the shared project.',
          },
        });
        return true;
      };

      const addRecent = (dir: string, name: string) => {
        if (dir === 'web') return;
        set((state) => ({
          recentProjects: [{ dir, name }, ...state.recentProjects.filter((item) => item.dir !== dir)].slice(0, 8),
        }));
      };

      // Shared first half of both export flows: build the self-contained bundle, audit it, and
      // open the Build Report dialog. Nothing is written until the user confirms there.
      const prepareExport = async (mode: 'game' | 'production') => {
        const { projectName, hasProject } = get();
        if (!hasProject) return;
        set({ busy: true, error: null });
        try {
          const editor = useEditorStore.getState();
          if (editor.isPlaying) {
            set({ toast: { kind: 'error', message: 'Stop Play before exporting so runtime-spawned or moved objects cannot enter the build.' } });
            return;
          }
          const project = { ...editor.exportProject(), name: projectName };
          // Inline asset bytes (from the live, url-carrying assets) so the bundle is self-contained.
          project.assets = await embedAssets(editor.assets);
          const bundle = buildGameBundle(project, activeExportProfile(project.exportSettings));
          const report = verifyGameBundle(bundle);
          set({ pendingExport: { mode, bundle, report } });
        } catch (error) {
          const message = errorMessage(error);
          set({ error: message, toast: { kind: 'error', message: `Export failed: ${message}` } });
        } finally {
          set({ busy: false });
        }
      };

      // Second half of the plain "Export game.json" flow, after the Build Report is confirmed.
      const runGameExport = async (bundle: GameBundle) => {
        const platform = await getPlatform();
        const destination = await platform.exportGame(get().projectName, bundle);
        if (destination) {
          set({ toast: { kind: 'success', message: `Game exported: ${destination}` } });
        }
      };

      // Second half of the Production flow, after the Build Report is confirmed.
      const runProductionExport = async (bundle: GameBundle, report: BundleReport, profile: ExportProfile) => {
        const { projectName } = get();
        const platform = await getPlatform();
        const reportLines = [
          '— Export contents —',
          ...report.summary,
          ...(report.errors.length || report.warnings.length
            ? ['', `⚠ ${report.errors.length + report.warnings.length} issue(s):`, ...report.errors, ...report.warnings]
            : ['✓ Everything resolved — nothing lost.']),
          '',
        ];

        // Desktop: run the full build right here, streaming progress to the overlay.
        if (platform.isDesktop && platform.buildProduction) {
          // Let the user choose where the finished game is written.
          const destination = platform.pickDirectory
            ? await platform.pickDirectory('Choose where to save your game')
            : undefined;
          // A picker that returns null means the user cancelled — don't build.
          if (destination === null) return;
          set({ buildProgress: { running: true, lines: [...reportLines, 'Preparing build…'] } });
          try {
            const outDir = await platform.buildProduction(
              {
                bundleJson: JSON.stringify(bundle),
                profile,
                targets: profile.targets,
                outDir: destination ?? undefined,
              },
              (line) => {
                set((state) => ({
                  buildProgress: {
                    running: true,
                    lines: [...(state.buildProgress?.lines ?? []), line].slice(-300),
                  },
                }));
              },
            );
            set({
              buildProgress: null,
              lastProductionOutput: outDir,
              toast: { kind: 'success', message: `Production export finished → ${outDir}` },
            });
          } catch (err) {
            const message = errorMessage(err);
            set({
              buildProgress: null,
              error: message,
              toast: { kind: 'error', message: `Build failed: ${message}` },
            });
          }
          return;
        }

        // Web fallback: stage the bundle and tell the user the CLI command.
        const path = await platform.stageProduction(projectName, bundle);
        if (path) {
          set({
            toast: {
              kind: 'success',
              message:
                `Staged for production. From the engine folder, run:  ` +
                `npm run export:production -- --bundle "${path}"`,
            },
          });
        } else {
          set({
            toast: {
              kind: 'success',
              message:
                `game.json downloaded. From the engine source folder, place it at ` +
                `exports/staging/game.json and run:  npm run export:production`,
            },
          });
        }
      };

      return {
        hasProject: false,
        projectDir: null,
        projectName: 'Untitled Project',
        recentProjects: [],
        busy: false,
        error: null,
        toast: null,
        buildProgress: null,
        lastProductionOutput: null,
        pendingExport: null,
        exportPlatforms: null,
        exportPlatformsError: null,
        clearToast: () => set({ toast: null }),
        clearBuildProgress: () => set({ buildProgress: null }),

        loadExportPlatforms: async () => {
          set({ exportPlatforms: null, exportPlatformsError: null });
          try {
            const platform = await getPlatform();
            if (!platform.checkExportPlatforms) return;
            set({ exportPlatforms: await platform.checkExportPlatforms() });
          } catch (error) {
            console.warn('Platform doctor failed:', error);
            set({ exportPlatformsError: errorMessage(error) });
          }
        },

        newProject: async (name) => {
          if (blockProjectLifecycleDuringCollaboration()) return;
          set({ busy: true, error: null });
          try {
            const platform = await getPlatform();
            const opened = await platform.createProject(name, blankProject(name));
            if (!opened) return;
            useEditorStore.getState().loadProject(opened.project);
            clearHistory(); // a fresh project starts with an empty undo history
            clearRecovery(); // starting fresh discards any prior session's unsaved recovery
            set({ hasProject: true, projectDir: opened.dir, projectName: opened.name, lastProductionOutput: null });
            addRecent(opened.dir, opened.name);
          } catch (error) {
            set({ error: errorMessage(error) });
          } finally {
            set({ busy: false });
          }
        },

        openProject: async () => {
          if (blockProjectLifecycleDuringCollaboration()) return;
          set({ busy: true, error: null });
          try {
            const platform = await getPlatform();
            const opened = await platform.openProject();
            if (!opened) return;
            useEditorStore.getState().loadProject(opened.project);
            clearHistory(); // a fresh project starts with an empty undo history
            clearRecovery(); // opening a project discards any prior session's unsaved recovery
            set({ hasProject: true, projectDir: opened.dir, projectName: opened.name, lastProductionOutput: null });
            addRecent(opened.dir, opened.name);
          } catch (error) {
            set({ error: errorMessage(error) });
          } finally {
            set({ busy: false });
          }
        },

        openRecent: async (dir) => {
          if (blockProjectLifecycleDuringCollaboration()) return;
          set({ busy: true, error: null });
          try {
            const platform = await getPlatform();
            const opened = await platform.openProjectAt(dir);
            if (!opened) return;
            useEditorStore.getState().loadProject(opened.project);
            clearHistory(); // a fresh project starts with an empty undo history
            clearRecovery(); // opening a project discards any prior session's unsaved recovery
            set({ hasProject: true, projectDir: opened.dir, projectName: opened.name, lastProductionOutput: null });
            addRecent(opened.dir, opened.name);
          } catch (error) {
            set((state) => ({
              error: errorMessage(error),
              recentProjects: state.recentProjects.filter((item) => item.dir !== dir),
            }));
          } finally {
            set({ busy: false });
          }
        },

        removeRecent: (dir) => {
          set((state) => ({
            recentProjects: state.recentProjects.filter((item) => item.dir !== dir),
          }));
        },

        save: async () => {
          const { projectDir, projectName, hasProject } = get();
          if (!hasProject) return;
          if (!canUseHostOnlyFeatures()) {
            set({ toast: { kind: 'error', message: 'Only the collaboration host can save the shared project.' } });
            return;
          }
          if (!projectDir) return get().saveAs(projectName);
          set({ busy: true, error: null });
          try {
            const platform = await getPlatform();
            const project = { ...useEditorStore.getState().exportProject(), name: projectName };
            await platform.saveProject(projectDir, project);
            useEditorStore.getState().markClean();
            set({ toast: { kind: 'success', message: projectDir === 'web' ? 'Project downloaded' : 'Project saved' } });
          } catch (error) {
            const message = errorMessage(error);
            set({ error: message, toast: { kind: 'error', message: `Save failed: ${message}` } });
          } finally {
            set({ busy: false });
          }
        },

        saveAs: async (name) => {
          if (!canUseHostOnlyFeatures()) {
            set({ toast: { kind: 'error', message: 'Only the collaboration host can save the shared project.' } });
            return;
          }
          set({ busy: true, error: null });
          try {
            const platform = await getPlatform();
            const project = { ...useEditorStore.getState().exportProject(), name };
            const opened = await platform.createProject(name, project);
            if (!opened) return;
            set({ hasProject: true, projectDir: opened.dir, projectName: opened.name, lastProductionOutput: null });
            addRecent(opened.dir, opened.name);
            useEditorStore.getState().markClean();
            set({ toast: { kind: 'success', message: opened.dir === 'web' ? 'Project downloaded' : 'Project saved' } });
          } catch (error) {
            const message = errorMessage(error);
            set({ error: message, toast: { kind: 'error', message: `Save failed: ${message}` } });
          } finally {
            set({ busy: false });
          }
        },

        // Both export buttons first build+verify the bundle and open the Build Report dialog;
        // the actual write/build happens in confirmPendingExport.
        exportGame: () => prepareExport('game'),
        exportProduction: () => prepareExport('production'),

        cancelPendingExport: () => set({ pendingExport: null }),

        confirmPendingExport: async (stripUnused, profile) => {
          const pending = get().pendingExport;
          if (!pending) return;
          const mode = pending.mode;
          const selectedProfile = profile ?? pending.bundle.buildProfile;
          const exportSettings = {
            ...pending.bundle.project.exportSettings,
            activeProfileId: selectedProfile.id,
            profiles: pending.bundle.project.exportSettings.profiles.some(
              (candidate) => candidate.id === selectedProfile.id,
            )
              ? pending.bundle.project.exportSettings.profiles.map((candidate) =>
                  candidate.id === selectedProfile.id ? selectedProfile : candidate,
                )
              : [...pending.bundle.project.exportSettings.profiles, selectedProfile],
          };
          const profiledBundle: GameBundle = {
            ...pending.bundle,
            startSceneId: selectedProfile.startSceneId,
            buildProfile: selectedProfile,
            project: { ...pending.bundle.project, exportSettings },
          };
          const report = verifyGameBundle(profiledBundle);
          // Errors mean a referenced resource would 404 at runtime — the dialog disables Export,
          // but guard here too in case it's called directly.
          if (report.errors.length) {
            set({ pendingExport: { ...pending, bundle: profiledBundle, report } });
            return;
          }
          if (mode === 'production') useEditorStore.getState().updateExportProfile(selectedProfile);
          // Never strip when the reference scan failed — fail open and ship everything.
          const bundle =
            stripUnused && !report.scanFailed
              ? stripUnusedAssets(profiledBundle, report.referencedAssetIds)
              : profiledBundle;
          set({ pendingExport: null, busy: true, error: null });
          try {
            if (report.warnings.length) console.warn('Export issues:', report.warnings);
            console.info('Export contents:', report.summary);
            if (mode === 'game') await runGameExport(bundle);
            else await runProductionExport(bundle, report, selectedProfile);
          } catch (error) {
            const message = errorMessage(error);
            set({ error: message, toast: { kind: 'error', message: `Export failed: ${message}` } });
          } finally {
            set({ busy: false });
          }
        },

        exportPrefabPackage: async (prefabId, meta) => {
          if (!get().hasProject) return;
          set({ busy: true, error: null });
          try {
            const editor = useEditorStore.getState();
            const collected = editor.buildPrefabPackage(prefabId);
            if (!collected) {
              set({ toast: { kind: 'error', message: 'Could not find that prefab to export.' } });
              return;
            }
            const prefab = editor.prefabs.find((p) => p.id === prefabId);
            const name = meta?.name ?? prefab?.name ?? 'Module';
            // Inline only the assets this prefab actually references (from the live, url-carrying assets).
            const live = editor.assets.filter((asset) => collected.assetIds.includes(asset.id));
            const embedded = await embedAssets(live);
            const pkg = buildPackage('asset', collected.content, embedded, {
              id: crypto.randomUUID(),
              name,
              version: '1.0.0',
              thumbnail: prefab?.thumbnail,
              ...meta,
            });
            const platform = await getPlatform();
            const destination = await platform.exportPackage(name, serializePackage(pkg));
            if (destination) {
              set({ toast: { kind: 'success', message: `Package exported: ${destination}` } });
            }
          } catch (error) {
            const message = errorMessage(error);
            set({ error: message, toast: { kind: 'error', message: `Package export failed: ${message}` } });
          } finally {
            set({ busy: false });
          }
        },

        exportFolderPackage: async (folderId, meta) => {
          if (!get().hasProject) return;
          set({ busy: true, error: null });
          try {
            const editor = useEditorStore.getState();
            const collected = editor.buildFolderPackage(folderId);
            if (!collected) {
              set({ toast: { kind: 'error', message: 'That folder is empty — nothing to export.' } });
              return;
            }
            const name = meta?.name ?? collected.name;
            const live = editor.assets.filter((asset) => collected.assetIds.includes(asset.id));
            const embedded = await embedAssets(live);
            const pkg = buildPackage('asset', collected.content, embedded, {
              id: crypto.randomUUID(),
              name,
              version: '1.0.0',
              ...meta,
            });
            const platform = await getPlatform();
            const destination = await platform.exportPackage(name, serializePackage(pkg));
            if (destination) {
              const c = collected.content;
              set({
                toast: {
                  kind: 'success',
                  message: `Package "${name}" exported (${c.prefabs.length} prefab(s), ${c.blueprints.length} blueprint(s), ${embedded.length} asset(s)): ${destination}`,
                },
              });
            }
          } catch (error) {
            const message = errorMessage(error);
            set({ error: message, toast: { kind: 'error', message: `Package export failed: ${message}` } });
          } finally {
            set({ busy: false });
          }
        },

        exportProjectPackage: async (meta) => {
          if (!get().hasProject) return;
          set({ busy: true, error: null });
          try {
            const editor = useEditorStore.getState();
            const collected = editor.buildProjectPackage();
            const name = meta?.name ?? get().projectName ?? 'Project';
            const live = editor.assets.filter((asset) => collected.assetIds.includes(asset.id));
            const embedded = await embedAssets(live);
            const pkg = buildPackage('project', collected.content, embedded, {
              id: crypto.randomUUID(),
              name,
              version: '1.0.0',
              ...meta,
            });
            const platform = await getPlatform();
            const destination = await platform.exportPackage(name, serializePackage(pkg));
            if (destination) {
              const scenes = collected.content.scenes?.length ?? 0;
              set({
                toast: {
                  kind: 'success',
                  message: `Project package "${name}" exported (${scenes} scene(s), ${embedded.length} asset(s)): ${destination}`,
                },
              });
            }
          } catch (error) {
            const message = errorMessage(error);
            set({ error: message, toast: { kind: 'error', message: `Package export failed: ${message}` } });
          } finally {
            set({ busy: false });
          }
        },

        newProjectFromPackageUrl: async (url, name) => {
          if (blockProjectLifecycleDuringCollaboration()) return false;
          set({ busy: true, error: null });
          try {
            const archive = readPackageFile(await fetchPackage(url));
            if (archive.pkg.kind !== 'project' || !archive.pkg.content.scenes?.length) {
              throw new Error('That package is a module, not a project template. Install it into an open project instead.');
            }
            // Only create the project once we know the package is usable — otherwise a bad download
            // would leave the user staring at an empty project they didn't ask for.
            await get().newProject(name);
            if (!get().hasProject) return false;

            const platform = await getPlatform();
            const summary = await applyPackage(
              archive,
              get().projectDir,
              platform,
              useEditorStore.getState().mergeProjectPackage,
            );
            const scenes = useEditorStore.getState().scenes.length;
            set({
              toast: {
                kind: 'success',
                message: `Created "${name}" from "${summary.name}" (${scenes} scene(s)).`,
              },
            });
            return true;
          } catch (error) {
            const message = errorMessage(error);
            set({ error: message, toast: { kind: 'error', message: `Could not use that template: ${message}` } });
            return false;
          } finally {
            set({ busy: false });
          }
        },

        importPackageFromFile: async () => {
          if (!get().hasProject) return;
          if (blockGuestPackageMutation()) return;
          set({ busy: true, error: null });
          try {
            const platform = await getPlatform();
            const raw = await platform.openPackage();
            if (!raw) return;
            const summary = await installParsedPackage(raw, get().projectDir, platform);
            set({
              toast: {
                kind: 'success',
                message: `${installedMessage(summary)} Tip: back up your project before importing packages you don't trust.`,
              },
            });
          } catch (error) {
            const message = errorMessage(error);
            set({ error: message, toast: { kind: 'error', message: `Import failed: ${message}` } });
          } finally {
            set({ busy: false });
          }
        },

        importPackageFromUrl: async (url) => {
          if (!get().hasProject) return false;
          if (blockGuestPackageMutation()) return false;
          set({ busy: true, error: null });
          try {
            const platform = await getPlatform();
            const raw = await fetchPackage(url);
            const summary = await installParsedPackage(raw, get().projectDir, platform);
            set({ toast: { kind: 'success', message: installedMessage(summary) } });
            return true;
          } catch (error) {
            const message = errorMessage(error);
            set({ error: message, toast: { kind: 'error', message: `Install failed: ${message}` } });
            return false;
          } finally {
            set({ busy: false });
          }
        },

        // Continue with the built-in starter scene without a saved project (Save acts as Save As).
        useDemo: () => {
          if (blockProjectLifecycleDuringCollaboration()) return;
          clearRecovery();
          set({ hasProject: true, projectDir: isDesktop ? null : 'web', projectName: 'Demo (unsaved)', lastProductionOutput: null });
        },

        restoreRecovery: (snapshot) => {
          if (blockProjectLifecycleDuringCollaboration()) return;
          useEditorStore.getState().loadProject(snapshot.project);
          clearHistory();
          // The restored state is exactly the unsaved work, so flag it dirty (and clear the snapshot
          // now that it's live) — the user still needs to Save it to disk/download.
          useEditorStore.setState({ isDirty: true });
          clearRecovery();
          set({ hasProject: true, projectDir: snapshot.dir, projectName: snapshot.name, lastProductionOutput: null });
        },

        closeProject: () => {
          if (blockProjectLifecycleDuringCollaboration()) return;
          clearRecovery();
          set({ hasProject: false, projectDir: null, projectName: 'Untitled Project', lastProductionOutput: null });
        },
        clearError: () => set({ error: null }),
      };
    },
    { name: 'nodeforge.projects', partialize: (state) => ({ recentProjects: state.recentProjects }) },
  ),
);
