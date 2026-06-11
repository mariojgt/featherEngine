import { Vector3, type Camera } from 'three';
import type { Vector3Tuple } from '../types';

/**
 * Spatial audio engine. Owns a single WebAudio `AudioContext` + `AudioListener` and routes positioned
 * sounds through `PannerNode`s so the player HEARS where things are (an explosion to the left, footsteps
 * behind them). Non-positional sounds (UI chimes, ambient/music beds) skip the panner and go straight to
 * the master gain. The listener is driven from the active camera every frame by <AudioListenerSync/> inside
 * the r3f Canvas.
 *
 * Decoded `AudioBuffer`s are cached by asset id, so a sound only pays the fetch+decode cost once. If WebAudio
 * is unavailable or a buffer fails to decode we fall back to a plain HTMLAudioElement (non-spatial) so audio
 * never regresses to silence.
 */

type LoopHandle = {
  source: AudioBufferSourceNode | null;
  gain: GainNode;
  panner: PannerNode | null;
  /** Fallback path when WebAudio decode failed for this asset. */
  element: HTMLAudioElement | null;
  /** Set by stopLoop so an in-flight decode won't start a source after teardown. */
  stopped: boolean;
  assetId: string;
};

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private supported = typeof window !== 'undefined' && (typeof AudioContext !== 'undefined' || 'webkitAudioContext' in window);
  /** Decoded buffers keyed by asset id (shared across one-shots + loops). */
  private buffers = new Map<string, AudioBuffer>();
  /** In-flight decodes so concurrent requests for the same asset share one fetch. */
  private pending = new Map<string, Promise<AudioBuffer | null>>();
  // Scratch vectors reused every frame to avoid per-frame allocation in updateListener.
  private vPos = new Vector3();
  private vFwd = new Vector3();
  private vUp = new Vector3();

  private ensureContext(): AudioContext | null {
    if (!this.supported) return null;
    if (!this.ctx) {
      const Ctor: typeof AudioContext = (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ?? AudioContext;
      try {
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = 1;
        this.master.connect(this.ctx.destination);
      } catch {
        this.supported = false;
        this.ctx = null;
      }
    }
    return this.ctx;
  }

  /** Call from a user-gesture handler — browsers start the context suspended until the user interacts. */
  resume(): void {
    const ctx = this.ensureContext();
    if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => {});
  }

  /** Update the listener (ears) from the active camera. Cheap — just sets 9 floats; safe to call every frame. */
  updateListener(camera: Camera): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    camera.getWorldPosition(this.vPos);
    camera.getWorldDirection(this.vFwd); // unit vector the camera looks along
    this.vUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
    // Modern AudioParam API where available, falling back to the deprecated setPosition/setOrientation (Safari).
    if (l.positionX) {
      const t = ctx.currentTime;
      l.positionX.setValueAtTime(this.vPos.x, t);
      l.positionY.setValueAtTime(this.vPos.y, t);
      l.positionZ.setValueAtTime(this.vPos.z, t);
      l.forwardX.setValueAtTime(this.vFwd.x, t);
      l.forwardY.setValueAtTime(this.vFwd.y, t);
      l.forwardZ.setValueAtTime(this.vFwd.z, t);
      l.upX.setValueAtTime(this.vUp.x, t);
      l.upY.setValueAtTime(this.vUp.y, t);
      l.upZ.setValueAtTime(this.vUp.z, t);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      l.setPosition?.(this.vPos.x, this.vPos.y, this.vPos.z);
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      l.setOrientation?.(this.vFwd.x, this.vFwd.y, this.vFwd.z, this.vUp.x, this.vUp.y, this.vUp.z);
    }
  }

  private async getBuffer(assetId: string, url: string): Promise<AudioBuffer | null> {
    const ctx = this.ensureContext();
    if (!ctx) return null;
    const cached = this.buffers.get(assetId);
    if (cached) return cached;
    const inflight = this.pending.get(assetId);
    if (inflight) return inflight;
    const job = (async () => {
      try {
        const res = await fetch(url);
        const data = await res.arrayBuffer();
        const buffer = await ctx.decodeAudioData(data);
        this.buffers.set(assetId, buffer);
        return buffer;
      } catch {
        return null; // signals the caller to use the HTMLAudio fallback
      } finally {
        this.pending.delete(assetId);
      }
    })();
    this.pending.set(assetId, job);
    return job;
  }

  private makePanner(ctx: AudioContext, position: Vector3Tuple): PannerNode {
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 4;
    panner.maxDistance = 120;
    panner.rolloffFactor = 1;
    if (panner.positionX) {
      panner.positionX.value = position[0];
      panner.positionY.value = position[1];
      panner.positionZ.value = position[2];
    } else {
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      panner.setPosition?.(position[0], position[1], position[2]);
    }
    return panner;
  }

  /** Cached noise buffer for the synthesized exhaust pop (built once, ~0.25s of white noise). */
  private noiseBuffer: AudioBuffer | null = null;

  /**
   * Synthesized exhaust BACKFIRE pop — no asset needed, so every car's gearbox crackles out of the box.
   * A short band-passed noise burst (the "crack") over a fast-decaying low sine (the "thump"), with a touch
   * of random pitch so consecutive shifts don't sound machine-identical.
   */
  playBackfirePop(volume = 0.8): void {
    const ctx = this.ensureContext();
    if (!ctx || ctx.state === 'suspended' || !this.master) return;
    if (!this.noiseBuffer) {
      const len = Math.floor(ctx.sampleRate * 0.25);
      this.noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    const t = ctx.currentTime;
    const jitter = 0.85 + Math.random() * 0.3;
    // Crack: noise → bandpass → fast exponential decay.
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 420 * jitter;
    band.Q.value = 0.9;
    const crackGain = ctx.createGain();
    crackGain.gain.setValueAtTime(volume, t);
    crackGain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    noise.connect(band).connect(crackGain).connect(this.master);
    noise.start(t);
    noise.stop(t + 0.2);
    // Thump: a low sine dropping 90→45Hz under the crack.
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(90 * jitter, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const thumpGain = ctx.createGain();
    thumpGain.gain.setValueAtTime(volume * 0.7, t);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    osc.connect(thumpGain).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.16);
  }

  /**
   * Synthesized KILL-CONFIRM tick (no asset needed) — two quick descending triangle blips, the classic
   * arena-shooter "target down" cue. Played 2D (it's HUD feedback, not a world sound).
   */
  playKillConfirm(volume = 0.5): void {
    const ctx = this.ensureContext();
    if (!ctx || ctx.state === 'suspended' || !this.master) return;
    const t = ctx.currentTime;
    ([[1320, 0], [880, 0.07]] as Array<[number, number]>).forEach(([freq, at]) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t + at);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t + at);
      gain.gain.exponentialRampToValueAtTime(volume, t + at + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.001, t + at + 0.09);
      osc.connect(gain).connect(this.master!);
      osc.start(t + at);
      osc.stop(t + at + 0.1);
    });
  }

  /**
   * Fire a transient sound. With `position` it plays through a PannerNode (spatial); without, it plays at the
   * master gain (2D — UI/menu sounds). Falls back to a plain HTMLAudioElement if the buffer can't be decoded.
   */
  playOneShot(assetId: string, url: string, position?: Vector3Tuple, volume = 1): void {
    const ctx = this.ensureContext();
    if (!ctx) {
      this.playFallback(url, volume);
      return;
    }
    void this.getBuffer(assetId, url).then((buffer) => {
      if (!buffer) {
        this.playFallback(url, volume);
        return;
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const gain = ctx.createGain();
      gain.gain.value = volume;
      if (position) {
        const panner = this.makePanner(ctx, position);
        source.connect(panner).connect(gain).connect(this.master!);
      } else {
        source.connect(gain).connect(this.master!);
      }
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
      };
      source.start();
    });
  }

  private playFallback(url: string, volume: number): void {
    try {
      const audio = new Audio(url);
      audio.volume = Math.max(0, Math.min(1, volume));
      void audio.play().catch(() => {});
    } catch {
      /* ignore */
    }
  }

  /**
   * Start a looping bed (ambient/music/vehicle). Returns a handle for live updates + teardown. Positional when
   * `position` is given. Decodes async; the loop begins once the buffer is ready (or falls back to HTMLAudio).
   */
  startLoop(assetId: string, url: string, opts: { volume?: number; position?: Vector3Tuple; playbackRate?: number } = {}): LoopHandle {
    const ctx = this.ensureContext();
    if (!ctx) {
      const element = this.startFallbackLoop(url, opts.volume ?? 1);
      return { source: null, gain: {} as GainNode, panner: null, element, stopped: false, assetId };
    }
    const gain = ctx.createGain();
    gain.gain.value = opts.volume ?? 1;
    const panner = opts.position ? this.makePanner(ctx, opts.position) : null;
    if (panner) panner.connect(gain).connect(this.master!);
    else gain.connect(this.master!);
    const handle: LoopHandle = { source: null, gain, panner, element: null, stopped: false, assetId };
    void this.getBuffer(assetId, url).then((buffer) => {
      if (handle.stopped) return; // stopped before the buffer arrived
      if (!buffer) {
        // Decode failed → swap to an HTMLAudio loop, keeping the same handle so updates/teardown still work.
        handle.element = this.startFallbackLoop(url, opts.volume ?? 1);
        return;
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      if (opts.playbackRate) source.playbackRate.value = opts.playbackRate;
      source.connect(panner ?? gain);
      source.start();
      handle.source = source;
    });
    return handle;
  }

  private startFallbackLoop(url: string, volume: number): HTMLAudioElement | null {
    try {
      const audio = new Audio(url);
      audio.loop = true;
      audio.volume = Math.max(0, Math.min(1, volume));
      void audio.play().catch(() => {});
      return audio;
    } catch {
      return null;
    }
  }

  updateLoop(handle: LoopHandle | null, opts: { volume?: number; playbackRate?: number; position?: Vector3Tuple }): void {
    if (!handle) return;
    if (handle.element) {
      if (opts.volume !== undefined) handle.element.volume = Math.max(0, Math.min(1, opts.volume));
      if (opts.playbackRate !== undefined) handle.element.playbackRate = opts.playbackRate;
      return;
    }
    const ctx = this.ctx;
    if (!ctx) return;
    if (opts.volume !== undefined) handle.gain.gain.value = opts.volume;
    if (opts.playbackRate !== undefined && handle.source) handle.source.playbackRate.value = opts.playbackRate;
    if (opts.position && handle.panner) {
      const p = handle.panner;
      if (p.positionX) {
        const t = ctx.currentTime;
        p.positionX.setValueAtTime(opts.position[0], t);
        p.positionY.setValueAtTime(opts.position[1], t);
        p.positionZ.setValueAtTime(opts.position[2], t);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        p.setPosition?.(opts.position[0], opts.position[1], opts.position[2]);
      }
    }
  }

  stopLoop(handle: LoopHandle | null): void {
    if (!handle) return;
    handle.stopped = true;
    if (handle.element) {
      handle.element.pause();
      handle.element.src = '';
      handle.element = null;
    }
    if (handle.source) {
      try {
        handle.source.stop();
      } catch {
        /* already stopped */
      }
      handle.source.disconnect();
      handle.source = null;
    }
    try {
      handle.panner?.disconnect();
      handle.gain.disconnect?.();
    } catch {
      /* ignore */
    }
  }
}

export const audioEngine = new AudioEngine();
export type { LoopHandle };
