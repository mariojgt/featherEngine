import { create } from 'zustand';

/**
 * Transient cache of GLB/model-asset preview thumbnails (assetId → PNG data URL) for the Project browser.
 * Generated on demand by ModelThumbnailHost (an offscreen render of the model), drained one at a time via
 * the queue so we never spin up many WebGL contexts at once. Not persisted — regenerated per session,
 * which keeps it out of the project file and always matches the current asset.
 */
interface ModelThumbnailState {
  /** assetId → data URL. '' means a capture was attempted but failed (don't retry). */
  thumbnails: Record<string, string>;
  queue: string[];
  /** Enqueue an asset for thumbnailing unless it's already cached or queued. */
  request: (assetId: string) => void;
  /** Store the captured thumbnail and pop it from the queue. */
  set: (assetId: string, url: string) => void;
}

export const useModelThumbnails = create<ModelThumbnailState>((set, get) => ({
  thumbnails: {},
  queue: [],
  request: (assetId) => {
    const state = get();
    if (assetId in state.thumbnails || state.queue.includes(assetId)) return;
    set({ queue: [...state.queue, assetId] });
  },
  set: (assetId, url) =>
    set((state) => ({
      thumbnails: { ...state.thumbnails, [assetId]: url },
      queue: state.queue.filter((id) => id !== assetId),
    })),
}));
