import { describe, expect, it } from 'vitest';
import {
  clientToData,
  domainOf,
  PAD,
  PLOT_H,
  PLOT_W,
  snap,
  SNAP,
  toScreenX,
  toScreenY,
  VIEW_H,
  VIEW_W,
} from '../blendSpaceLayout';

describe('domainOf', () => {
  it('pads the range so samples never sit on the frame', () => {
    const domain = domainOf([0, 10]);
    expect(domain.min).toBeLessThan(0);
    expect(domain.max).toBeGreaterThan(10);
  });

  // A 1D blend space has every y at 0, and a 2D space can legitimately have all samples on one
  // column. Without a floor on the span the projection divides by zero and every dot becomes NaN.
  it('never collapses to zero width for identical values', () => {
    const domain = domainOf([3, 3, 3]);
    expect(domain.max - domain.min).toBeGreaterThan(0);
    expect(toScreenX(3, domain)).toBeGreaterThan(0);
    expect(Number.isFinite(toScreenX(3, domain))).toBe(true);
  });

  it('handles a single value and an empty set', () => {
    expect(domainOf([5]).max - domainOf([5]).min).toBeGreaterThan(0);
    expect(domainOf([])).toEqual({ min: -1, max: 1 });
  });

  it('ignores non-finite values rather than poisoning the domain', () => {
    const domain = domainOf([0, 4, NaN, Infinity]);
    expect(Number.isFinite(domain.min)).toBe(true);
    expect(Number.isFinite(domain.max)).toBe(true);
    expect(domainOf([NaN, Infinity])).toEqual({ min: -1, max: 1 });
  });
});

describe('snap', () => {
  it('rounds to the snap increment', () => {
    expect(snap(3.7000000000000002)).toBeCloseTo(3.7);
    expect(snap(0.02)).toBeCloseTo(0);
    expect(snap(0.03)).toBeCloseTo(SNAP);
  });

  it('keeps negatives symmetric', () => {
    expect(snap(-1.23)).toBeCloseTo(-1.25);
  });
});

describe('projection', () => {
  const domain = { min: 0, max: 10 };

  it('maps the domain across the plot width', () => {
    expect(toScreenX(0, domain)).toBeCloseTo(PAD.left);
    expect(toScreenX(10, domain)).toBeCloseTo(PAD.left + PLOT_W);
    expect(toScreenX(5, domain)).toBeCloseTo(PAD.left + PLOT_W / 2);
  });

  it('inverts Y, because SVG grows downward', () => {
    expect(toScreenY(10, domain, true)).toBeCloseTo(PAD.top);
    expect(toScreenY(0, domain, true)).toBeCloseTo(PAD.top + PLOT_H);
  });

  it('centres the row for a 1D blend space', () => {
    expect(toScreenY(0, domain, false)).toBeCloseTo(PAD.top + PLOT_H / 2);
    // Y is meaningless in 1D, so any value lands on the same row.
    expect(toScreenY(999, domain, false)).toBeCloseTo(PAD.top + PLOT_H / 2);
  });
});

describe('clientToData', () => {
  const xDomain = { min: 0, max: 10 };
  const yDomain = { min: -2, max: 2 };
  // A rect twice the viewBox size, to prove the mapping scales rather than assuming 1:1 pixels.
  const W = VIEW_W * 2;
  const H = VIEW_H * 2;

  it('round-trips a projected point back to its data coordinates', () => {
    const sx = toScreenX(4, xDomain);
    const sy = toScreenY(1, yDomain, true);
    const data = clientToData((sx / VIEW_W) * W, (sy / VIEW_H) * H, W, H, xDomain, yDomain);
    expect(data?.x).toBeCloseTo(4, 4);
    expect(data?.y).toBeCloseTo(1, 4);
  });

  it('clamps a drag that leaves the plot area to the domain edges', () => {
    const past = clientToData(W * 5, H * 5, W, H, xDomain, yDomain);
    expect(past?.x).toBeCloseTo(10);
    expect(past?.y).toBeCloseTo(-2);
    const before = clientToData(-W, -H, W, H, xDomain, yDomain);
    expect(before?.x).toBeCloseTo(0);
    expect(before?.y).toBeCloseTo(2);
  });

  // Happens on the first pointer event if the panel is laid out but not yet measured.
  it('returns null for an unmeasured element instead of NaN coordinates', () => {
    expect(clientToData(10, 10, 0, 0, xDomain, yDomain)).toBeNull();
  });
});
