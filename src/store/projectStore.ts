import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getPlatform, isDesktop } from '../platform';
import { blankProject } from '../project/serialize';
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
  newProject: (name: string) => Promise<void>;
  openProject: () => Promise<void>;
  openRecent: (dir: string) => Promise<void>;
  save: () => Promise<void>;
  saveAs: (name: string) => Promise<void>;
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
          } catch (error) {
            set({ error: errorMessage(error) });
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
          } catch (error) {
            set({ error: errorMessage(error) });
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
