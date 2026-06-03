import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getPlatform, isDesktop } from '../platform';
import { blankProject } from '../project/serialize';
import { buildGameBundle, embedAssets } from '../project/exportGame';
import { verifyGameBundle } from '../project/verifyBundle';
import {
  buildPackage,
  parsePackage,
  remapPackageForImport,
  type NodeForgePackage,
  type PackageMeta,
} from '../project/package';
import type { AssetItem } from '../types';
import { useEditorStore } from './editorStore';

/** Caller-supplied package metadata; the rest (id, createdAt, engineVersion) is filled in. */
export type PackageMetaInput = Partial<Omit<PackageMeta, 'engineVersion' | 'createdAt'>>;

/** Decode a data URL into a File so it can be re-imported through the platform asset pipeline. */
function dataUrlToFile(dataUrl: string, name: string): File {
  const comma = dataUrl.indexOf(',');
  const header = dataUrl.slice(0, comma);
  const mime = /data:([^;]+)/.exec(header)?.[1] ?? 'application/octet-stream';
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], name, { type: mime });
}

/**
 * Turn a package's embedded assets (data URLs) into project assets with a runtime url. On a saved
 * desktop project we write the bytes to disk (persistent `path`); otherwise we keep the data URL as
 * the url so it still renders and survives a web download (which retains `data`).
 */
async function resolvePackageAssets(
  assets: AssetItem[],
  projectDir: string | null,
  platform: Awaited<ReturnType<typeof getPlatform>>,
): Promise<AssetItem[]> {
  const onDisk = platform.isDesktop && !!projectDir && projectDir !== 'web';
  return Promise.all(
    assets.map(async (asset) => {
      if (!asset.data) return { ...asset, unresolved: true };
      if (onDisk) {
        try {
          const file = dataUrlToFile(asset.data, asset.name || `${asset.id}`);
          const { path, url } = await platform.importAsset(projectDir as string, file);
          return { ...asset, path, url, data: undefined };
        } catch {
          return { ...asset, url: asset.data };
        }
      }
      return { ...asset, url: asset.data };
    }),
  );
}

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
  clearToast: () => void;
  clearBuildProgress: () => void;
  newProject: (name: string) => Promise<void>;
  openProject: () => Promise<void>;
  openRecent: (dir: string) => Promise<void>;
  save: () => Promise<void>;
  saveAs: (name: string) => Promise<void>;
  exportGame: () => Promise<void>;
  exportProduction: () => Promise<void>;
  /** Export a prefab + its dependency closure as a portable `.nfpack` package file. */
  exportPrefabPackage: (prefabId: string, meta?: PackageMetaInput) => Promise<void>;
  /** Export everything in a folder (and its subfolders) + dependencies as one `.nfpack`, like Unreal's Migrate. */
  exportFolderPackage: (folderId: string, meta?: PackageMetaInput) => Promise<void>;
  /** Pick a `.nfpack` file and additively import its content into the current project. */
  importPackageFromFile: () => Promise<void>;
  useDemo: () => void;
  closeProject: () => void;
  clearError: () => void;
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => {
      const addRecent = (dir: string, name: string) => {
        if (dir === 'web') return;
        set((state) => ({
          recentProjects: [{ dir, name }, ...state.recentProjects.filter((item) => item.dir !== dir)].slice(0, 8),
        }));
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
        clearToast: () => set({ toast: null }),
        clearBuildProgress: () => set({ buildProgress: null }),

        newProject: async (name) => {
          set({ busy: true, error: null });
          try {
            const platform = await getPlatform();
            const opened = await platform.createProject(name, blankProject(name));
            if (!opened) return;
            useEditorStore.getState().loadProject(opened.project);
            set({ hasProject: true, projectDir: opened.dir, projectName: opened.name });
            addRecent(opened.dir, opened.name);
          } catch (error) {
            set({ error: errorMessage(error) });
          } finally {
            set({ busy: false });
          }
        },

        openProject: async () => {
          set({ busy: true, error: null });
          try {
            const platform = await getPlatform();
            const opened = await platform.openProject();
            if (!opened) return;
            useEditorStore.getState().loadProject(opened.project);
            set({ hasProject: true, projectDir: opened.dir, projectName: opened.name });
            addRecent(opened.dir, opened.name);
          } catch (error) {
            set({ error: errorMessage(error) });
          } finally {
            set({ busy: false });
          }
        },

        openRecent: async (dir) => {
          set({ busy: true, error: null });
          try {
            const platform = await getPlatform();
            const opened = await platform.openProjectAt(dir);
            if (!opened) return;
            useEditorStore.getState().loadProject(opened.project);
            set({ hasProject: true, projectDir: opened.dir, projectName: opened.name });
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

        save: async () => {
          const { projectDir, projectName, hasProject } = get();
          if (!hasProject) return;
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
          set({ busy: true, error: null });
          try {
            const platform = await getPlatform();
            const project = { ...useEditorStore.getState().exportProject(), name };
            const opened = await platform.createProject(name, project);
            if (!opened) return;
            set({ hasProject: true, projectDir: opened.dir, projectName: opened.name });
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

        exportGame: async () => {
          const { projectName, hasProject } = get();
          if (!hasProject) return;
          set({ busy: true, error: null });
          try {
            const platform = await getPlatform();
            const editor = useEditorStore.getState();
            const project = { ...editor.exportProject(), name: projectName };
            // Inline asset bytes (from the live, url-carrying assets) so the bundle is self-contained.
            project.assets = await embedAssets(editor.assets);
            const bundle = buildGameBundle(project);
            const destination = await platform.exportGame(projectName, bundle);
            if (destination) {
              set({ toast: { kind: 'success', message: `Game exported: ${destination}` } });
            }
          } catch (error) {
            const message = errorMessage(error);
            set({ error: message, toast: { kind: 'error', message: `Export failed: ${message}` } });
          } finally {
            set({ busy: false });
          }
        },

        exportProduction: async () => {
          const { projectName, hasProject } = get();
          if (!hasProject) return;
          set({ busy: true, error: null });
          try {
            const platform = await getPlatform();
            const editor = useEditorStore.getState();
            const project = { ...editor.exportProject(), name: projectName };
            // Inline asset bytes so the production build is fully self-contained.
            project.assets = await embedAssets(editor.assets);
            const bundle = buildGameBundle(project);

            // Audit the bundle: inventory everything and flag any resource that didn't make it in.
            const report = verifyGameBundle(bundle);
            const reportLines = [
              '— Export contents —',
              ...report.summary,
              ...(report.warnings.length
                ? ['', `⚠ ${report.warnings.length} issue(s):`, ...report.warnings]
                : ['✓ Everything resolved — nothing lost.']),
              '',
            ];
            if (report.warnings.length) {
              set({ toast: { kind: 'error', message: `Export warning: ${report.warnings[0]}` } });
            }

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
                  JSON.stringify(bundle),
                  true,
                  (line) => {
                    set((state) => ({
                      buildProgress: {
                        running: true,
                        lines: [...(state.buildProgress?.lines ?? []), line].slice(-300),
                      },
                    }));
                  },
                  destination ?? undefined,
                );
                set({
                  buildProgress: null,
                  toast: { kind: 'success', message: `Production build complete → ${outDir}` },
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
            const issueSuffix = report.warnings.length
              ? `  (⚠ ${report.warnings.length} resource issue(s) — see console)`
              : '';
            if (report.warnings.length) console.warn('Export issues:', report.warnings);
            console.info('Export contents:', report.summary);
            const path = await platform.stageProduction(projectName, bundle);
            if (path) {
              set({
                toast: {
                  kind: report.warnings.length ? 'error' : 'success',
                  message:
                    `Staged for production. From the engine folder, run:  ` +
                    `npm run export:production -- --bundle "${path}"${issueSuffix}`,
                },
              });
            } else {
              set({
                toast: {
                  kind: report.warnings.length ? 'error' : 'success',
                  message:
                    `game.json downloaded. From the engine source folder, place it at ` +
                    `exports/staging/game.json and run:  npm run export:production${issueSuffix}`,
                },
              });
            }
          } catch (error) {
            const message = errorMessage(error);
            set({ error: message, toast: { kind: 'error', message: `Production export failed: ${message}` } });
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
            const pkg = buildPackage('module', collected.content, embedded, {
              id: crypto.randomUUID(),
              name,
              version: '1.0.0',
              thumbnail: prefab?.thumbnail,
              ...meta,
            });
            const platform = await getPlatform();
            const destination = await platform.exportPackage(name, pkg);
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
            const pkg = buildPackage('module', collected.content, embedded, {
              id: crypto.randomUUID(),
              name,
              version: '1.0.0',
              ...meta,
            });
            const platform = await getPlatform();
            const destination = await platform.exportPackage(name, pkg);
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

        importPackageFromFile: async () => {
          if (!get().hasProject) return;
          set({ busy: true, error: null });
          try {
            const platform = await getPlatform();
            const raw = await platform.openPackage();
            if (!raw) return;
            const pkg = parsePackage(raw) as NodeForgePackage;
            const editor = useEditorStore.getState();
            // Re-id everything so the import is purely additive and can't overwrite existing content.
            const { content, assets } = remapPackageForImport(pkg, editor.skeletons);
            const resolved = await resolvePackageAssets(assets, get().projectDir, platform);
            editor.mergePackage(content, resolved);
            const count = content.prefabs.length;
            set({
              toast: {
                kind: 'success',
                message: `Imported "${pkg.meta?.name ?? 'package'}" (${count} prefab${count === 1 ? '' : 's'}). Tip: back up your project before importing packages you don't trust.`,
              },
            });
          } catch (error) {
            const message = errorMessage(error);
            set({ error: message, toast: { kind: 'error', message: `Import failed: ${message}` } });
          } finally {
            set({ busy: false });
          }
        },

        // Continue with the built-in starter scene without a saved project (Save acts as Save As).
        useDemo: () => set({ hasProject: true, projectDir: isDesktop ? null : 'web', projectName: 'Demo (unsaved)' }),

        closeProject: () => set({ hasProject: false, projectDir: null, projectName: 'Untitled Project' }),
        clearError: () => set({ error: null }),
      };
    },
    { name: 'nodeforge.projects', partialize: (state) => ({ recentProjects: state.recentProjects }) },
  ),
);
