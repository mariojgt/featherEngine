import { useEffect, useRef } from 'react';
import { useEditorStore } from '../store/editorStore';

/**
 * Plays audio queued by action.playSound (and the auto character sounds) during runtime, then clears the
 * queue. Also loops the active scene's ambient bed + background music while Play is active, fading them out
 * on Stop. Shared by the editor's preview loop and the standalone player so audio behaves identically.
 */
export function useRuntimeAudio() {
  const queue = useEditorStore((state) => state.runtimeSoundQueue);
  const clearRuntimeSounds = useEditorStore((state) => state.clearRuntimeSounds);
  const isPlaying = useEditorStore((state) => state.isPlaying);

  // One-shot SFX: drain the queue and fire each as a transient Audio element.
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

  // Looping ambient + music beds: start when Play begins, stop/cleanup when it ends.
  const loops = useRef<HTMLAudioElement[]>([]);
  useEffect(() => {
    if (!isPlaying) return;
    const state = useEditorStore.getState();
    const scene = state.scenes.find((item) => item.id === state.activeSceneId);
    const urlFor = (id?: string) => (id ? state.assets.find((asset) => asset.id === id)?.url : undefined);
    const start = (id: string | undefined, volume: number) => {
      const url = urlFor(id);
      if (!url) return;
      const audio = new Audio(url);
      audio.loop = true;
      audio.volume = volume;
      void audio.play().catch(() => {});
      loops.current.push(audio);
    };
    start(scene?.ambientSoundId, 0.35);
    start(scene?.musicSoundId, 0.45);
    return () => {
      loops.current.forEach((audio) => {
        audio.pause();
        audio.src = '';
      });
      loops.current = [];
    };
  }, [isPlaying]);
}
