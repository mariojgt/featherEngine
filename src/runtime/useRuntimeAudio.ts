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

  // Driven-vehicle audio: a looping engine whose playback rate rises with rpm + a looping tire-skid bed whose
  // volume tracks slip. Updated imperatively from runtimeVehicleSound (set every tick) via a store subscription
  // so it never triggers a React re-render. Created lazily once a car starts driving; torn down on Stop.
  useEffect(() => {
    if (!isPlaying) return;
    let engine: HTMLAudioElement | null = null;
    let skid: HTMLAudioElement | null = null;
    let engineId: string | undefined;
    let skidId: string | undefined;
    const teardown = (audio: HTMLAudioElement | null) => {
      if (!audio) return;
      audio.pause();
      audio.src = '';
    };
    const apply = (vs: { engineId?: string; skidId?: string; rpm: number; slip: number } | null) => {
      const assets = useEditorStore.getState().assets;
      const urlFor = (id?: string) => (id ? assets.find((asset) => asset.id === id)?.url : undefined);
      // Engine loop.
      const engineUrl = urlFor(vs?.engineId);
      if (vs && engineUrl) {
        if (!engine || engineId !== vs.engineId) {
          teardown(engine);
          engine = new Audio(engineUrl);
          engine.loop = true;
          engine.volume = 0.3;
          engine.playbackRate = 0.85;
          void engine.play().catch(() => {});
          engineId = vs.engineId;
        }
        const targetRate = 0.82 + vs.rpm * 1.05;
        engine.playbackRate += (targetRate - engine.playbackRate) * 0.2;
        engine.volume = 0.28 + vs.rpm * 0.32;
      } else if (engine && !engine.paused) {
        engine.pause();
      }
      // Tire-skid loop (volume ∝ slip; kept playing at low volume so it fades in smoothly).
      const skidUrl = urlFor(vs?.skidId);
      if (vs && skidUrl) {
        if (!skid || skidId !== vs.skidId) {
          teardown(skid);
          skid = new Audio(skidUrl);
          skid.loop = true;
          skid.volume = 0;
          void skid.play().catch(() => {});
          skidId = vs.skidId;
        }
        const target = Math.min(0.7, vs.slip * 0.7);
        skid.volume += (target - skid.volume) * 0.3;
      } else if (skid && !skid.paused) {
        skid.pause();
      }
    };
    apply(useEditorStore.getState().runtimeVehicleSound);
    const unsubscribe = useEditorStore.subscribe((state) => apply(state.runtimeVehicleSound));
    return () => {
      unsubscribe();
      teardown(engine);
      teardown(skid);
    };
  }, [isPlaying]);
}
