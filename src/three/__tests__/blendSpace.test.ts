import { describe, expect, it } from 'vitest';
import {
  blend1D,
  blend2D,
  phaseSyncTimeScale,
  PHASE_SYNC_MAX_SCALE,
  PHASE_SYNC_MIN_SCALE,
  sumBlendWeights,
  type BlendSpaceSample,
} from '../blendSpace';

const sum = (weights: { weight: number }[]) => weights.reduce((acc, w) => acc + w.weight, 0);
const weightOf = (weights: { animationId: string; weight: number }[], id: string) =>
  weights.filter((w) => w.animationId === id).reduce((acc, w) => acc + w.weight, 0);

/** Unreal-style locomotion set: idle at the origin, walk at ±1, run at ±2 on both axes. */
const DIRECTIONAL: BlendSpaceSample[] = [
  { animationId: 'idle', value: 0, y: 0 },
  { animationId: 'walkF', value: 0, y: 1 },
  { animationId: 'walkB', value: 0, y: -1 },
  { animationId: 'walkL', value: -1, y: 0 },
  { animationId: 'walkR', value: 1, y: 0 },
  { animationId: 'runF', value: 0, y: 2 },
  { animationId: 'runB', value: 0, y: -2 },
  { animationId: 'runL', value: -2, y: 0 },
  { animationId: 'runR', value: 2, y: 0 },
];

const LOCOMOTION_1D: BlendSpaceSample[] = [
  { animationId: 'idle', value: 0 },
  { animationId: 'walk', value: 2 },
  { animationId: 'jog', value: 5 },
  { animationId: 'run', value: 8 },
];

describe('blend1D', () => {
  it('returns one entry per sample, in input order', () => {
    const result = blend1D(LOCOMOTION_1D, 3);
    expect(result.map((r) => r.animationId)).toEqual(['idle', 'walk', 'jog', 'run']);
  });

  it('clamps to the end samples outside the authored range', () => {
    expect(weightOf(blend1D(LOCOMOTION_1D, -5), 'idle')).toBe(1);
    expect(weightOf(blend1D(LOCOMOTION_1D, 999), 'run')).toBe(1);
  });

  it('interpolates linearly between the bracketing samples only', () => {
    const result = blend1D(LOCOMOTION_1D, 3.5); // halfway between walk (2) and jog (5)
    expect(weightOf(result, 'walk')).toBeCloseTo(0.5);
    expect(weightOf(result, 'jog')).toBeCloseTo(0.5);
    expect(weightOf(result, 'idle')).toBe(0);
    expect(weightOf(result, 'run')).toBe(0);
  });

  it('always produces normalized weights', () => {
    for (const v of [-1, 0, 0.7, 2, 4.2, 5, 7.9, 8, 20]) {
      expect(sum(blend1D(LOCOMOTION_1D, v))).toBeCloseTo(1);
    }
  });

  // Regression: weights used to be accumulated per animationId and then read back once per sample,
  // so one clip reused at two positions was emitted at its full summed weight twice — a 2x
  // over-weight that made the reused clip dominate the pose.
  it('does not double-count a clip reused at several positions', () => {
    const reused: BlendSpaceSample[] = [
      { animationId: 'idle', value: 0 },
      { animationId: 'idle', value: 4 },
    ];
    expect(sum(blend1D(reused, 2))).toBeCloseTo(1);
  });

  it('splits evenly between coincident samples instead of dividing by zero', () => {
    const coincident: BlendSpaceSample[] = [
      { animationId: 'a', value: 1 },
      { animationId: 'b', value: 1 },
    ];
    const result = blend1D(coincident, 1);
    expect(sum(result)).toBeCloseTo(1);
    expect(result.every((r) => Number.isFinite(r.weight))).toBe(true);
  });

  it('handles an empty sample set', () => {
    expect(blend1D([], 1)).toEqual([]);
  });
});

describe('blend2D', () => {
  it('returns one entry per sample, in input order', () => {
    const result = blend2D(DIRECTIONAL, 0.3, 0.4);
    expect(result.map((r) => r.animationId)).toEqual(DIRECTIONAL.map((s) => s.animationId));
  });

  it('always produces normalized weights across the whole parameter plane', () => {
    for (let x = -3; x <= 3; x += 0.5) {
      for (let y = -3; y <= 3; y += 0.5) {
        expect(sum(blend2D(DIRECTIONAL, x, y))).toBeCloseTo(1, 5);
      }
    }
  });

  it('never emits a negative weight', () => {
    for (let x = -3; x <= 3; x += 0.25) {
      for (let y = -3; y <= 3; y += 0.25) {
        for (const w of blend2D(DIRECTIONAL, x, y)) expect(w.weight).toBeGreaterThanOrEqual(0);
      }
    }
  });

  // The core reason this module exists. Inverse-distance weighting gave EVERY sample a non-zero
  // weight, so sprinting forward still mixed in "walk backward" and both strafes — mushy blending
  // and sliding feet. Triangulated interpolation must isolate the sample you are standing on.
  it('gives a sample full weight at its own coordinate, and nothing to the others', () => {
    const result = blend2D(DIRECTIONAL, 0, 2); // exactly "run forward"
    expect(weightOf(result, 'runF')).toBeCloseTo(1);
    expect(weightOf(result, 'walkB')).toBeCloseTo(0);
    expect(weightOf(result, 'runB')).toBeCloseTo(0);
    expect(weightOf(result, 'runL')).toBeCloseTo(0);
    expect(weightOf(result, 'runR')).toBeCloseTo(0);
  });

  it('blends at most three clips at once, like a triangulated blend space', () => {
    for (let x = -2.5; x <= 2.5; x += 0.25) {
      for (let y = -2.5; y <= 2.5; y += 0.25) {
        const active = blend2D(DIRECTIONAL, x, y).filter((w) => w.weight > 1e-6);
        expect(active.length).toBeLessThanOrEqual(3);
      }
    }
  });

  it('keeps opposing clips fully out of the pose', () => {
    // Anywhere in the forward half-plane, the backward clips must contribute nothing at all.
    for (let x = -1; x <= 1; x += 0.25) {
      for (let y = 0.25; y <= 2; y += 0.25) {
        const result = blend2D(DIRECTIONAL, x, y);
        expect(weightOf(result, 'runB')).toBeCloseTo(0, 6);
        expect(weightOf(result, 'walkB')).toBeCloseTo(0, 6);
      }
    }
  });

  it('interpolates evenly between two neighbouring samples on an edge', () => {
    // Midway along the idle→walkF edge.
    const result = blend2D(DIRECTIONAL, 0, 0.5);
    expect(weightOf(result, 'idle')).toBeCloseTo(0.5, 5);
    expect(weightOf(result, 'walkF')).toBeCloseTo(0.5, 5);
  });

  it('is continuous — a small parameter step never snaps the pose', () => {
    const step = 0.01;
    let maxDelta = 0;
    for (let x = -2.4; x <= 2.4; x += 0.13) {
      for (let y = -2.4; y <= 2.4; y += 0.13) {
        const a = blend2D(DIRECTIONAL, x, y);
        const b = blend2D(DIRECTIONAL, x + step, y + step);
        for (let i = 0; i < a.length; i++) maxDelta = Math.max(maxDelta, Math.abs(a[i].weight - b[i].weight));
      }
    }
    // A 0.01 step across a set whose samples are 1 apart cannot legitimately move a weight far.
    expect(maxDelta).toBeLessThan(0.1);
  });

  it('clamps to the hull boundary outside the authored range', () => {
    const far = blend2D(DIRECTIONAL, 0, 50);
    expect(sum(far)).toBeCloseTo(1);
    expect(weightOf(far, 'runF')).toBeCloseTo(1, 5);
  });

  it('stays normalized far outside the hull in every direction', () => {
    for (const [x, y] of [
      [50, 50],
      [-50, 50],
      [50, -50],
      [-50, -50],
      [0, -80],
      [80, 0],
    ]) {
      expect(sum(blend2D(DIRECTIONAL, x, y))).toBeCloseTo(1, 5);
    }
  });

  it('falls back to 1D interpolation when every sample is collinear', () => {
    const collinear: BlendSpaceSample[] = [
      { animationId: 'idle', value: 0, y: 0 },
      { animationId: 'walk', value: 2, y: 0 },
      { animationId: 'run', value: 4, y: 0 },
    ];
    const result = blend2D(collinear, 1, 0);
    expect(weightOf(result, 'idle')).toBeCloseTo(0.5);
    expect(weightOf(result, 'walk')).toBeCloseTo(0.5);
    expect(weightOf(result, 'run')).toBe(0);
    expect(sum(result)).toBeCloseTo(1);
  });

  it('handles a square sample grid whose points are co-circular', () => {
    // A 2x2 grid is the classic Delaunay degeneracy — all four corners share a circumcircle.
    const square: BlendSpaceSample[] = [
      { animationId: 'a', value: 0, y: 0 },
      { animationId: 'b', value: 1, y: 0 },
      { animationId: 'c', value: 0, y: 1 },
      { animationId: 'd', value: 1, y: 1 },
    ];
    expect(sum(blend2D(square, 0.5, 0.5))).toBeCloseTo(1);
    expect(weightOf(blend2D(square, 0, 0), 'a')).toBeCloseTo(1);
    expect(weightOf(blend2D(square, 1, 1), 'd')).toBeCloseTo(1);
  });

  it('splits weight between clips stacked on the same coordinate', () => {
    const stacked: BlendSpaceSample[] = [
      { animationId: 'idleA', value: 0, y: 0 },
      { animationId: 'idleB', value: 0, y: 0 },
      { animationId: 'walkF', value: 0, y: 1 },
      { animationId: 'walkR', value: 1, y: 0 },
    ];
    const result = blend2D(stacked, 0, 0);
    expect(sum(result)).toBeCloseTo(1);
    expect(weightOf(result, 'idleA')).toBeCloseTo(0.5);
    expect(weightOf(result, 'idleB')).toBeCloseTo(0.5);
  });

  it('handles single-sample and empty sets', () => {
    expect(blend2D([{ animationId: 'idle', value: 0, y: 0 }], 5, 5)).toEqual([{ animationId: 'idle', weight: 1 }]);
    expect(blend2D([], 0, 0)).toEqual([]);
  });

  it('produces finite weights for extreme parameter values', () => {
    for (const [x, y] of [
      [0, 0],
      [1e6, -1e6],
      [-1e-9, 1e-9],
    ]) {
      for (const w of blend2D(DIRECTIONAL, x, y)) expect(Number.isFinite(w.weight)).toBe(true);
    }
  });
});

describe('sumBlendWeights', () => {
  interface FakeAction {
    id: string;
  }
  const actions: Record<string, FakeAction> = { idle: { id: 'idle' }, walk: { id: 'walk' } };
  const resolve = (name: string) => actions[name];

  // Regression: two samples can point at the same clip, so the same action. Writing one
  // setEffectiveWeight per sample let the last call win — often the ~0 one — and the clip
  // dropped out of the pose entirely.
  it('sums the weights of samples that resolve to the same action', () => {
    const out = new Map<FakeAction, number>();
    sumBlendWeights(
      [
        { name: 'idle', weight: 0.3 },
        { name: 'idle', weight: 0.2 },
        { name: 'walk', weight: 0.5 },
      ],
      resolve,
      out,
    );
    expect(out.get(actions.idle)).toBeCloseTo(0.5);
    expect(out.get(actions.walk)).toBeCloseTo(0.5);
  });

  it('skips samples whose clip is missing from the mixer', () => {
    const out = new Map<FakeAction, number>();
    sumBlendWeights([{ name: 'nope', weight: 1 }, { name: 'idle', weight: 0.4 }], resolve, out);
    expect(out.size).toBe(1);
    expect(out.get(actions.idle)).toBeCloseTo(0.4);
  });

  // The map is a module-level scratch reused every frame, so a stale entry would keep a clip
  // weighted after it left the blend space.
  it('clears prior contents so the caller-owned scratch map cannot leak weights', () => {
    const out = new Map<FakeAction, number>();
    out.set(actions.walk, 99);
    sumBlendWeights([{ name: 'idle', weight: 1 }], resolve, out);
    expect(out.has(actions.walk)).toBe(false);
    expect(out.get(actions.idle)).toBe(1);
  });

  it('preserves the normalization coming out of the blend functions', () => {
    const out = new Map<FakeAction, number>();
    const weights = blend1D(
      [
        { animationId: 'idle', value: 0 },
        { animationId: 'walk', value: 4 },
      ],
      1,
    ).map((w) => ({ name: w.animationId, weight: w.weight }));
    sumBlendWeights(weights, resolve, out);
    expect([...out.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });
});

describe('phaseSyncTimeScale', () => {
  it('leaves a clip alone when it already matches the shared cycle', () => {
    expect(phaseSyncTimeScale(1, 1)).toBe(1);
  });

  // The point of sync: a 1.0s walk and a 0.7s run blended 50/50 share a 0.85s cycle, so both must
  // complete one stride in 0.85s or the feet drift apart and the character skates.
  it('retimes samples onto a shared cycle length', () => {
    const mean = 0.5 * 1.0 + 0.5 * 0.7;
    const walk = phaseSyncTimeScale(1.0, mean);
    const run = phaseSyncTimeScale(0.7, mean);
    expect(1.0 / walk).toBeCloseTo(mean, 6);
    expect(0.7 / run).toBeCloseTo(mean, 6);
    // The longer clip speeds up, the shorter one slows down.
    expect(walk).toBeGreaterThan(1);
    expect(run).toBeLessThan(1);
  });

  it('is continuous as the weights move, so retiming never snaps', () => {
    let previous = phaseSyncTimeScale(1.0, 1.0);
    for (let t = 0; t <= 1; t += 0.01) {
      const mean = (1 - t) * 1.0 + t * 0.7;
      const current = phaseSyncTimeScale(1.0, mean);
      expect(Math.abs(current - previous)).toBeLessThan(0.05);
      previous = current;
    }
  });

  // A blend space holding a long idle next to a stride would otherwise ask for a 0.25x jog while the
  // jog fades in past the idle. Clamping keeps that a mild retime rather than obvious slow motion.
  it('clamps an extreme correction', () => {
    expect(phaseSyncTimeScale(1, 4)).toBe(PHASE_SYNC_MIN_SCALE);
    expect(phaseSyncTimeScale(4, 1)).toBe(PHASE_SYNC_MAX_SCALE);
  });

  it('falls back to the authored rate for a degenerate duration', () => {
    expect(phaseSyncTimeScale(0, 1)).toBe(1);
    expect(phaseSyncTimeScale(1, 0)).toBe(1);
    expect(phaseSyncTimeScale(-1, 1)).toBe(1);
    expect(phaseSyncTimeScale(NaN, 1)).toBe(1);
    expect(phaseSyncTimeScale(1, NaN)).toBe(1);
  });

  it('never returns a non-finite or zero scale, which would freeze or explode playback', () => {
    for (const [duration, mean] of [
      [1, 1],
      [0.7, 1],
      [1e-9, 1e9],
      [1e9, 1e-9],
      [Infinity, 1],
    ]) {
      const scale = phaseSyncTimeScale(duration, mean);
      expect(Number.isFinite(scale)).toBe(true);
      expect(scale).toBeGreaterThan(0);
    }
  });
});
