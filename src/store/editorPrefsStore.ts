import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeMode = 'dark' | 'light' | 'midnight' | 'high-contrast';
export type Density = 'comfortable' | 'compact';
export type FontScale = 0.9 | 1.0 | 1.1;

export interface SavedLayout {
  name: string;
  json: unknown;
  savedAt: number;
}

interface EditorPrefsState {
  themeMode: ThemeMode;
  accent: string;
  density: Density;
  fontScale: FontScale;
  customLayouts: Record<string, SavedLayout>;
  setThemeMode: (value: ThemeMode) => void;
  setAccent: (value: string) => void;
  setDensity: (value: Density) => void;
  setFontScale: (value: FontScale) => void;
  saveCustomLayout: (name: string, json: unknown) => void;
  deleteCustomLayout: (name: string) => void;
  resetAppearance: () => void;
}

const DEFAULTS = {
  themeMode: 'dark' as ThemeMode,
  accent: '#5b8cff',
  density: 'comfortable' as Density,
  fontScale: 1.0 as FontScale,
};

export const useEditorPrefs = create<EditorPrefsState>()(
  persist(
    (set, get) => ({
      ...DEFAULTS,
      customLayouts: {},
      setThemeMode: (value) => set({ themeMode: value }),
      setAccent: (value) => set({ accent: value }),
      setDensity: (value) => set({ density: value }),
      setFontScale: (value) => set({ fontScale: value }),
      saveCustomLayout: (name, json) => {
        const key = name.trim();
        if (!key) return;
        set({
          customLayouts: {
            ...get().customLayouts,
            [key]: { name: key, json, savedAt: Date.now() },
          },
        });
      },
      deleteCustomLayout: (name) => {
        const next = { ...get().customLayouts };
        delete next[name];
        set({ customLayouts: next });
      },
      resetAppearance: () => set({ ...DEFAULTS }),
    }),
    { name: 'nodeforge.editorPrefs' },
  ),
);
