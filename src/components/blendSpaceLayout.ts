/**
 * Plot geometry for the blend-space graph: axis domains, snapping, and the mapping between data
 * coordinates and SVG coordinates.
 *
 * Kept separate from the component so it can be tested without a store or a DOM. The CSS pins the
 * SVG to the same aspect ratio as VIEW_W/VIEW_H, which is what lets `clientToData` treat a pointer
 * position as a plain proportional scale of the element's bounding box.
 */

export const VIEW_W = 240;
export const VIEW_H = 180;
export const PAD = { left: 26, right: 10, top: 10, bottom: 18 } as const;
export const PLOT_W = VIEW_W - PAD.left - PAD.right;
export const PLOT_H = VIEW_H - PAD.top - PAD.bottom;

/** Dragged samples land on multiples of this, so they get tidy values instead of 3.7000000000000002. */
export const SNAP = 0.05;

export const snap = (value: number): number => Math.round(value / SNAP) * SNAP;

export interface Domain {
  min: number;
  max: number;
}

/**
 * Pads a set of values into a plot domain. Never collapses to zero width — a blend space whose
 * samples all share one coordinate (or a 1D space, where every y is 0) would otherwise divide by
 * zero and put every dot at NaN.
 */
export function domainOf(values: number[]): Domain {
  if (!values.length) return { min: -1, max: 1 };
  const finite = values.filter((value) => Number.isFinite(value));
  if (!finite.length) return { min: -1, max: 1 };
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min;
  if (span < 1e-6) return { min: min - 1, max: max + 1 };
  const pad = span * 0.18;
  return { min: min - pad, max: max + pad };
}

/** Data X → SVG X. */
export const toScreenX = (value: number, domain: Domain): number =>
  PAD.left + ((value - domain.min) / (domain.max - domain.min)) * PLOT_W;

/** Data Y → SVG Y (inverted, since SVG grows downward). For 1D the row is centred. */
export const toScreenY = (value: number, domain: Domain, is2D: boolean): number =>
  is2D ? PAD.top + PLOT_H - ((value - domain.min) / (domain.max - domain.min)) * PLOT_H : PAD.top + PLOT_H / 2;

/**
 * Pointer position (relative to the SVG's bounding box) → data coordinates, clamped to the domain so
 * a drag that leaves the plot area parks the sample on the edge rather than flying off.
 */
export function clientToData(
  offsetX: number,
  offsetY: number,
  rectWidth: number,
  rectHeight: number,
  xDomain: Domain,
  yDomain: Domain,
): { x: number; y: number } | null {
  if (!rectWidth || !rectHeight) return null;
  const vx = (offsetX / rectWidth) * VIEW_W;
  const vy = (offsetY / rectHeight) * VIEW_H;
  const tx = Math.min(1, Math.max(0, (vx - PAD.left) / PLOT_W));
  const ty = Math.min(1, Math.max(0, (vy - PAD.top) / PLOT_H));
  return {
    x: xDomain.min + tx * (xDomain.max - xDomain.min),
    y: yDomain.max - ty * (yDomain.max - yDomain.min),
  };
}
