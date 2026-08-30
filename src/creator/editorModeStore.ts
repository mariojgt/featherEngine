import { create } from 'zustand';

/**
 * Creator Mode only needs to remember which authoring surface is active.
 * Play is deliberately not represented here: `editorStore.isPlaying` remains
 * the single source of truth for whether the normal Feather runtime is running.
 */
export type CreatorAuthoringMode = 'build' | 'logic';
export type CreatorEditorMode = CreatorAuthoringMode | 'play';

interface CreatorEditorModeState {
  authoringMode: CreatorAuthoringMode;
  setAuthoringMode: (mode: CreatorAuthoringMode) => void;
}

export const useCreatorEditorModeStore = create<CreatorEditorModeState>((set) => ({
  authoringMode: 'build',
  setAuthoringMode: (authoringMode) => set({ authoringMode }),
}));

/** Resolve the visible three-way mode without duplicating runtime state. */
export function resolveCreatorEditorMode(
  isPlaying: boolean,
  authoringMode: CreatorAuthoringMode,
): CreatorEditorMode {
  return isPlaying ? 'play' : authoringMode;
}
