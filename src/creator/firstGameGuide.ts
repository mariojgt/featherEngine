import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const FIRST_GAME_STEPS = ['appearance', 'interaction', 'play', 'save', 'export'] as const;
export type FirstGameStep = (typeof FIRST_GAME_STEPS)[number];
export interface FirstGameProgress {
  completed: FirstGameStep[];
  appearance: string;
  interactions: number;
  dismissed: boolean;
}

interface GuideState {
  projects: Record<string, FirstGameProgress>;
  start: (key: string, appearance: string, interactions: number) => void;
  complete: (key: string, step: FirstGameStep) => void;
  dismiss: (key: string, dismissed: boolean) => void;
}

/** Learning progress is a local editor preference, never part of the shipped game. */
export const useFirstGameGuide = create<GuideState>()(persist((set) => ({
  projects: {},
  start: (key, appearance, interactions) => set((state) => {
    const progress = state.projects[key];
    if (progress) {
      // A starter can replace the blank scene after the guide first mounts. Start the appearance
      // lesson from the completed scene; also recover when every original object was removed.
      const before = JSON.parse(progress.appearance).objects ?? [];
      const after = JSON.parse(appearance).objects ?? [];
      if (!progress.completed.includes('appearance') && after.length && !before.some(([id]: [string]) => after.some(([other]: [string]) => id === other))) {
        return { projects: { ...state.projects, [key]: { ...progress, appearance, interactions } } };
      }
      return state;
    }
    return { projects: { ...state.projects, [key]: { completed: [], appearance, interactions, dismissed: false } } };
  }),
  complete: (key, step) => set((state) => {
    const progress = state.projects[key];
    if (!progress || progress.completed.includes(step)) return state;
    return { projects: { ...state.projects, [key]: { ...progress, completed: [...progress.completed, step] } } };
  }),
  dismiss: (key, dismissed) => set((state) => {
    const progress = state.projects[key];
    return progress ? { projects: { ...state.projects, [key]: { ...progress, dismissed } } } : state;
  }),
}), { name: 'feather.firstGameGuide.v1' }));

/** Object creation alone is not an appearance edit. Compare only objects/materials present at start. */
export function hasAppearanceChanged(baseline: string, current: string): boolean {
  try {
    const before = JSON.parse(baseline);
    const after = JSON.parse(current);
    return (before.objects ?? []).some(([id, renderer]: [string, unknown]) => {
      const next = (after.objects ?? []).find(([nextId]: [string]) => nextId === id);
      return next && JSON.stringify(next[1]) !== JSON.stringify(renderer);
    }) || (before.materials ?? []).some((material: { id: string }) => {
      const next = (after.materials ?? []).find((item: { id: string }) => item.id === material.id);
      return next && JSON.stringify(next) !== JSON.stringify(material);
    });
  } catch { return false; }
}

export function hasAppearanceBaseline(baseline: string, current: string): boolean {
  try {
    const before = JSON.parse(baseline).objects ?? [];
    const after = JSON.parse(current).objects ?? [];
    return before.some(([id]: [string]) => after.some(([other]: [string]) => id === other));
  } catch { return false; }
}
