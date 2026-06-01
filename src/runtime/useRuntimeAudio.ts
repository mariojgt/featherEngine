import { useEffect } from 'react';
import { useEditorStore } from '../store/editorStore';

/**
 * Plays audio queued by action.playSound during runtime, then clears the queue.
 * Shared by the editor's preview loop and the standalone player so audio behaves identically.
 */
export function useRuntimeAudio() {
  const queue = useEditorStore((state) => state.runtimeSoundQueue);
  const clearRuntimeSounds = useEditorStore((state) => state.clearRuntimeSounds);

  useEffect(() => {
    if (queue.length === 0) return;
    const { assets } = useEditorStore.getState();
    queue.forEach((assetId) => {
      const url = assets.find((asset) => asset.id === assetId)?.url;
      if (!url) return;
      const audio = new Audio(url);
      // Autoplay can be blocked until the user interacts with the page; ignore that rejection.
      void audio.play().catch(() => {});
    });
    clearRuntimeSounds();
  }, [queue, clearRuntimeSounds]);
}
