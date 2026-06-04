import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Editor viewport preferences that should survive a reload / project re-open: snap on-off, the
 * snap step, and the gizmo coordinate space. Kept in localStorage (browser-only editor state),
 * separate from the per-project editor store so it isn't tied to any one project.
 */
interface ViewportPrefsState {
  snapEnabled: boolean;
  snapStep: number;
  transformSpace: 'world' | 'local';
  setSnapEnabled: (value: boolean) => void;
  setSnapStep: (value: number) => void;
  setTransformSpace: (value: 'world' | 'local') => void;
}

export const useViewportPrefs = create<ViewportPrefsState>()(
  persist(
    (set) => ({
      snapEnabled: false,
      snapStep: 0.5,
      transformSpace: 'world',
      setSnapEnabled: (value) => set({ snapEnabled: value }),
      setSnapStep: (value) => set({ snapStep: value }),
      setTransformSpace: (value) => set({ transformSpace: value }),
    }),
    { name: 'nodeforge.viewport' },
  ),
);
