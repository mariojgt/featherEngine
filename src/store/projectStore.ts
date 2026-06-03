import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getPlatform, isDesktop } from '../platform';
import { blankProject } from '../project/serialize';
import { buildGameBundle, embedAssets } from '../project/exportGame';
import { verifyGameBundle } from '../project/verifyBundle';
import { useEditorStore } from './editorStore';

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

        // Continue with the built-in starter scene without a saved project (Save acts as Save As).
        useDemo: () => set({ hasProject: true, projectDir: isDesktop ? null : 'web', projectName: 'Demo (unsaved)' }),

        closeProject: () => set({ hasProject: false, projectDir: null, projectName: 'Untitled Project' }),
        clearError: () => set({ error: null }),
      };
    },
    { name: 'nodeforge.projects', partialize: (state) => ({ recentProjects: state.recentProjects }) },
  ),
);
