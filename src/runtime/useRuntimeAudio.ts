import { useEffect, useRef } from 'react';
import { useEditorStore } from '../store/editorStore';
import { audioEngine, type LoopHandle } from './audioEngine';

/**
 * Plays audio queued during runtime (via action.playSound + the auto character/vehicle/projectile sounds),
 * then clears the queue. Positioned events go through the spatial audioEngine (PannerNodes) so the player
 * hears WHERE things happen; the scene's ambient bed + background music + the driven car's engine/skid loops
 * play non-spatial. Shared by the editor's preview loop and the standalone player so audio behaves identically.
 *
 * The listener (ears) is driven from the active camera by <AudioListenerSync/> inside the r3f Canvas.
 */
export function useRuntimeAudio() {
  const queue = useEditorStore((state) => state.runtimeSoundQueue);
  const clearRuntimeSounds = useEditorStore((state) => state.clearRuntimeSounds);
  const isPlaying = useEditorStore((state) => state.isPlaying);

  // One-shot SFX: drain the queue and fire each through the spatial audio engine.
  useEffect(() => {
    if (queue.length === 0) return;
    const { assets } = useEditorStore.getState();
    queue.forEach((event) => {
      const url = assets.find((asset) => asset.id === event.assetId)?.url;
      if (!url) return;
      audioEngine.playOneShot(event.assetId, url, event.position, event.volume ?? 1);
    });
    clearRuntimeSounds();
  }, [queue, clearRuntimeSounds]);

  // Looping ambient + music beds (non-spatial): start when Play begins, stop/cleanup when it ends.
  const loops = useRef<LoopHandle[]>([]);
  useEffect(() => {
    if (!isPlaying) return;
    const state = useEditorStore.getState();
    const scene = state.scenes.find((item) => item.id === state.activeSceneId);
    const urlFor = (id?: string) => (id ? state.assets.find((asset) => asset.id === id)?.url : undefined);
    const start = (id: string | undefined, volume: number) => {
      const url = urlFor(id);
      if (!url || !id) return;
      loops.current.push(audioEngine.startLoop(id, url, { volume }));
    };
    start(scene?.ambientSoundId, 0.35);
    start(scene?.musicSoundId, 0.45);
    return () => {
      loops.current.forEach((handle) => audioEngine.stopLoop(handle));
      loops.current = [];
    };
  }, [isPlaying]);

  // Driven-vehicle audio: a looping engine whose playback rate rises with rpm + a looping tire-skid bed whose
  // volume tracks slip. Updated imperatively from runtimeVehicleSound (set every tick) via a store subscription
  // so it never triggers a React re-render. Created lazily once a car starts driving; torn down on Stop.
  useEffect(() => {
    if (!isPlaying) return;
    let engine: LoopHandle | null = null;
    let skid: LoopHandle | null = null;
    let engineId: string | undefined;
    let skidId: string | undefined;
    let engineRate = 0.85;
    let engineVol = 0.3;
    let skidVol = 0;
    const teardown = (handle: LoopHandle | null) => {
      if (handle) audioEngine.stopLoop(handle);
    };
    const apply = (vs: { engineId?: string; skidId?: string; rpm: number; slip: number } | null) => {
      const assets = useEditorStore.getState().assets;
      const urlFor = (id?: string) => (id ? assets.find((asset) => asset.id === id)?.url : undefined);
      // Engine loop.
      const engineUrl = urlFor(vs?.engineId);
      if (vs && engineUrl && vs.engineId) {
        if (!engine || engineId !== vs.engineId) {
          teardown(engine);
          engineRate = 0.85;
          engineVol = 0.3;
          engine = audioEngine.startLoop(vs.engineId, engineUrl, { volume: engineVol, playbackRate: engineRate });
          engineId = vs.engineId;
        }
        const targetRate = 0.82 + vs.rpm * 1.05;
        engineRate += (targetRate - engineRate) * 0.2;
        engineVol = 0.28 + vs.rpm * 0.32;
        audioEngine.updateLoop(engine, { playbackRate: engineRate, volume: engineVol });
      } else if (engine) {
        teardown(engine);
        engine = null;
        engineId = undefined;
      }
      // Tire-skid loop (volume ∝ slip; kept playing at low volume so it fades in smoothly).
      const skidUrl = urlFor(vs?.skidId);
      if (vs && skidUrl && vs.skidId) {
        if (!skid || skidId !== vs.skidId) {
          teardown(skid);
          skidVol = 0;
          skid = audioEngine.startLoop(vs.skidId, skidUrl, { volume: skidVol });
          skidId = vs.skidId;
        }
        const target = Math.min(0.7, vs.slip * 0.7);
        skidVol += (target - skidVol) * 0.3;
        audioEngine.updateLoop(skid, { volume: skidVol });
      } else if (skid) {
        teardown(skid);
        skid = null;
        skidId = undefined;
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
