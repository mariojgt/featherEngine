/**
 * Module-level mutable performance metrics.
 *
 * Intentionally NOT stored in the Zustand store: writing perf samples 60×/s through
 * immutable state would re-trigger the exact Play-mode re-render storm we're trying to
 * measure (see the play-mode-rerender-perf notes). Producers mutate these ring buffers in
 * place (zero allocation, zero React work); the overlay polls `getPerfSnapshot()` on its own
 * low-frequency timer. This is the same "simulation writes to a buffer, UI reads it" pattern
 * the runtime transform decoupling will use.
 */

const SAMPLE_CAP = 120; // ~2s of history at 60fps

/** Fixed-size circular buffer of f64 samples with cheap avg/max/p95 reads. */
class Ring {
  private buf = new Float64Array(SAMPLE_CAP);
  private head = 0;
  private len = 0;

  push(value: number) {
    this.buf[this.head] = value;
    this.head = (this.head + 1) % SAMPLE_CAP;
    if (this.len < SAMPLE_CAP) this.len += 1;
  }

  get last(): number {
    if (this.len === 0) return 0;
    return this.buf[(this.head - 1 + SAMPLE_CAP) % SAMPLE_CAP];
  }

  avg(): number {
    if (this.len === 0) return 0;
    let sum = 0;
    for (let i = 0; i < this.len; i += 1) sum += this.buf[i];
    return sum / this.len;
  }

  max(): number {
    let m = 0;
    for (let i = 0; i < this.len; i += 1) if (this.buf[i] > m) m = this.buf[i];
    return m;
  }

  /** p95 via a one-off sorted copy — only paid when a snapshot is requested (~4Hz). */
  p95(): number {
    if (this.len === 0) return 0;
    const copy = Array.from(this.buf.subarray(0, this.len)).sort((a, b) => a - b);
    return copy[Math.min(copy.length - 1, Math.floor(copy.length * 0.95))];
  }
}

export interface RenderStats {
  calls: number;
  triangles: number;
  programs: number;
  geometries: number;
  textures: number;
}

export interface SampleStats {
  avg: number;
  p95: number;
  max: number;
  last: number;
}

export interface PerfSnapshot {
  fps: number;
  frameMs: SampleStats;
  tickMs: SampleStats;
  sections: Record<RuntimeSection, SampleStats>;
  render: RenderStats;
}

export type RuntimeSection = 'scripts' | 'physics' | 'combat' | 'animator';

const frameRing = new Ring();
const tickRing = new Ring();
const sectionRings: Record<RuntimeSection, Ring> = {
  scripts: new Ring(),
  physics: new Ring(),
  combat: new Ring(),
  animator: new Ring(),
};
const render: RenderStats = { calls: 0, triangles: 0, programs: 0, geometries: 0, textures: 0 };

/** Called once per rAF from the runtime loop. `frameMs` is wall-clock between frames; `tickMs` is the cost of `tickRuntime`. */
export const recordFrame = (frameMs: number, tickMs: number) => {
  frameRing.push(frameMs);
  tickRing.push(tickMs);
};

export const recordRuntimeSection = (section: RuntimeSection, ms: number) => {
  sectionRings[section].push(ms);
};

/** Called from inside the Canvas (after a render) with `gl.info` counters. */
export const recordRender = (stats: RenderStats) => {
  render.calls = stats.calls;
  render.triangles = stats.triangles;
  render.programs = stats.programs;
  render.geometries = stats.geometries;
  render.textures = stats.textures;
};

const sample = (ring: Ring): SampleStats => ({
  avg: ring.avg(),
  p95: ring.p95(),
  max: ring.max(),
  last: ring.last,
});

export const getPerfSnapshot = (): PerfSnapshot => {
  const frameMs = sample(frameRing);
  return {
    fps: frameMs.avg > 0 ? 1000 / frameMs.avg : 0,
    frameMs,
    tickMs: sample(tickRing),
    sections: {
      scripts: sample(sectionRings.scripts),
      physics: sample(sectionRings.physics),
      combat: sample(sectionRings.combat),
      animator: sample(sectionRings.animator),
    },
    render: { ...render },
  };
};
