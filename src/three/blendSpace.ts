/**
 * Blend-space weighting — the engine-level maths behind Animator blend-space states.
 *
 * A blend space places animation clips ("samples") at coordinates on one or two axes and blends
 * between them continuously as a driving parameter moves. This module owns only the weighting maths
 * so it stays pure and unit-testable; `SkinnedModel` applies the resulting weights to the mixer.
 *
 * ## Contract
 * Both functions return **one entry per input sample, in input order** — samples outside the active
 * blend region get weight 0 rather than being omitted. That keeps the set of playing clips constant
 * for the lifetime of the state, so `SkinnedModel` never has to restart an action when the parameter
 * crosses a sample boundary (restarting is what makes locomotion visibly stutter). Weights sum to 1.
 *
 * Callers may place the same `animationId` at several coordinates; each sample is weighted
 * independently and `SkinnedModel` sums the weights per action before touching the mixer.
 */

/** One sample of a blend space: a clip pinned at `value` on the X axis (and `y` on the Y axis for 2D). */
export interface BlendSpaceSample {
  animationId: string;
  value: number;
  y?: number;
}

/** A clip and the weight it should contribute to the final pose this frame. */
export interface BlendSpaceWeight {
  animationId: string;
  weight: number;
}

/** Below this, two sample coordinates are treated as the same point. */
const POSITION_EPSILON = 1e-6;
/** Barycentric slack, so a point exactly on a shared triangle edge lands in one of them. */
const BARYCENTRIC_EPSILON = 1e-9;

/**
 * Weights for a 1D blend space at parameter value `v`.
 *
 * Interpolates linearly between the two samples bracketing `v`, and clamps to the end sample outside
 * the authored range. Weights are tracked per sample *index* (not per `animationId`) so reusing one
 * clip at two positions cannot double-count it.
 */
export function blend1D(samples: BlendSpaceSample[], v: number): BlendSpaceWeight[] {
  const weights = new Array<number>(samples.length).fill(0);
  if (!samples.length) return [];

  // Sort indices, not samples — the result must stay in input order.
  const order = samples.map((_, i) => i).sort((a, b) => samples[a].value - samples[b].value);
  const first = order[0];
  const last = order[order.length - 1];

  if (v <= samples[first].value) {
    weights[first] = 1;
  } else if (v >= samples[last].value) {
    weights[last] = 1;
  } else {
    for (let i = 0; i < order.length - 1; i++) {
      const a = order[i];
      const b = order[i + 1];
      const lo = samples[a].value;
      const hi = samples[b].value;
      if (v >= lo && v <= hi) {
        const span = hi - lo;
        // Coincident samples: split evenly rather than dividing by zero.
        const t = span > POSITION_EPSILON ? (v - lo) / span : 0.5;
        weights[a] += 1 - t;
        weights[b] += t;
        break;
      }
    }
  }

  return samples.map((sample, i) => ({ animationId: sample.animationId, weight: weights[i] }));
}

interface Point {
  x: number;
  y: number;
}

interface Triangle {
  a: number;
  b: number;
  c: number;
}

/**
 * A triangulated blend space: the unique sample positions, which input samples sit on each position,
 * and the Delaunay triangles over them. Built once per sample set and cached.
 */
interface BlendSpaceMesh {
  points: Point[];
  /** Input sample indices sharing each point (co-located samples split that point's weight evenly). */
  members: number[][];
  triangles: Triangle[];
}

/**
 * Triangulation is pure derived data, so cache it against the samples array itself. The array comes
 * straight from the animator controller in the store, so its identity is stable until the blend space
 * is edited — at which point a new array arrives and the stale mesh is collected with it.
 */
const meshCache = new WeakMap<BlendSpaceSample[], BlendSpaceMesh>();

/** True when `p` lies inside the circumcircle of `tri` — the Delaunay condition. */
function inCircumcircle(points: Point[], tri: Triangle, p: Point): boolean {
  const a = points[tri.a];
  const b = points[tri.b];
  const c = points[tri.c];
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  // Collinear triangle: no meaningful circumcircle.
  if (Math.abs(d) < 1e-12) return false;
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  const ux = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const uy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  const r2 = (a.x - ux) * (a.x - ux) + (a.y - uy) * (a.y - uy);
  const dist2 = (p.x - ux) * (p.x - ux) + (p.y - uy) * (p.y - uy);
  // Generous epsilon keeps co-circular points (a square grid of samples!) from dropping triangles.
  return dist2 <= r2 * (1 + 1e-9);
}

/**
 * Delaunay triangulation by Bowyer–Watson. Blend spaces hold a handful of samples, so the simple
 * O(n²) form is far cheaper than the cost of a dependency — and it runs once per edit, not per frame.
 * Returns an empty list when the points are degenerate (fewer than three, or all collinear).
 */
function triangulate(points: Point[]): Triangle[] {
  if (points.length < 3) return [];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  // All points on a vertical or horizontal line — nothing to triangulate.
  if (spanX < POSITION_EPSILON || spanY < POSITION_EPSILON) return [];

  // Super-triangle large enough to contain every point; its vertices are appended and stripped later.
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  const span = Math.max(spanX, spanY) * 100;
  const work = [...points, { x: midX - span, y: midY - span }, { x: midX + span, y: midY - span }, { x: midX, y: midY + span }];
  const superA = points.length;
  const superB = points.length + 1;
  const superC = points.length + 2;

  let triangles: Triangle[] = [{ a: superA, b: superB, c: superC }];

  for (let i = 0; i < points.length; i++) {
    const p = work[i];
    const bad: Triangle[] = [];
    const good: Triangle[] = [];
    for (const tri of triangles) {
      if (inCircumcircle(work, tri, p)) bad.push(tri);
      else good.push(tri);
    }

    // The hole left by the bad triangles is bounded by their non-shared edges.
    const edges: [number, number][] = [];
    for (const tri of bad) {
      edges.push([tri.a, tri.b], [tri.b, tri.c], [tri.c, tri.a]);
    }
    const boundary = edges.filter(([e0, e1], index) =>
      !edges.some(([f0, f1], other) => other !== index && ((e0 === f0 && e1 === f1) || (e0 === f1 && e1 === f0))),
    );

    triangles = good;
    for (const [e0, e1] of boundary) triangles.push({ a: e0, b: e1, c: i });
  }

  // Drop anything still touching the super-triangle, and any zero-area slivers.
  return triangles.filter((tri) => {
    if (tri.a >= superA || tri.b >= superA || tri.c >= superA) return false;
    const a = work[tri.a];
    const b = work[tri.b];
    const c = work[tri.c];
    const area2 = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y));
    return area2 > 1e-12;
  });
}

/** Collapses co-located samples to unique points, remembering which samples share each one. */
function buildMesh(samples: BlendSpaceSample[]): BlendSpaceMesh {
  const points: Point[] = [];
  const members: number[][] = [];

  samples.forEach((sample, index) => {
    const x = sample.value;
    const y = sample.y ?? 0;
    const existing = points.findIndex((p) => Math.abs(p.x - x) < POSITION_EPSILON && Math.abs(p.y - y) < POSITION_EPSILON);
    if (existing >= 0) {
      members[existing].push(index);
    } else {
      points.push({ x, y });
      members.push([index]);
    }
  });

  return { points, members, triangles: triangulate(points) };
}

/** Barycentric coordinates of `p` in triangle (a,b,c), or null for a degenerate triangle. */
function barycentric(p: Point, a: Point, b: Point, c: Point): [number, number, number] | null {
  const denom = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  if (Math.abs(denom) < 1e-12) return null;
  const wa = ((b.y - c.y) * (p.x - c.x) + (c.x - b.x) * (p.y - c.y)) / denom;
  const wb = ((c.y - a.y) * (p.x - c.x) + (a.x - c.x) * (p.y - c.y)) / denom;
  return [wa, wb, 1 - wa - wb];
}

/** Closest point on segment ab to p, as the parameter t in [0,1]. */
function closestOnSegment(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  if (len2 < 1e-12) return 0;
  const t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2;
  return Math.min(1, Math.max(0, t));
}

/**
 * Weights for a 2D blend space at point (x, y), using Unreal-style triangulated interpolation.
 *
 * The samples are Delaunay-triangulated once, then each frame the triangle containing (x, y) supplies
 * barycentric weights — so **at most three clips ever contribute**, and a sample stops contributing
 * entirely once the parameter leaves its neighbourhood. That locality is the whole point: the previous
 * inverse-distance approach gave every sample a non-zero weight forever, so a character sprinting
 * forward still had "walk backward" and both strafes bleeding into the pose, which reads as mushy
 * blending and sliding feet.
 *
 * Outside the sample hull the point is projected onto the nearest triangle edge and blended between
 * that edge's two samples, which keeps the result continuous as the parameter crosses the boundary.
 * Degenerate sample sets (fewer than three samples, or all collinear) fall back to 1D interpolation
 * along their dominant axis.
 */
export function blend2D(samples: BlendSpaceSample[], x: number, y: number): BlendSpaceWeight[] {
  if (!samples.length) return [];
  if (samples.length === 1) return [{ animationId: samples[0].animationId, weight: 1 }];

  let mesh = meshCache.get(samples);
  if (!mesh) {
    mesh = buildMesh(samples);
    meshCache.set(samples, mesh);
  }
  const { points, members, triangles } = mesh;

  // Every sample sits on one spot, or they all sit on a line: interpolate along the dominant axis.
  if (!triangles.length) return blendDegenerate(samples, points, members, x, y);

  const p: Point = { x, y };
  const pointWeights = new Array<number>(points.length).fill(0);

  const containing = triangles.find((tri) => {
    const bc = barycentric(p, points[tri.a], points[tri.b], points[tri.c]);
    return bc !== null && bc[0] >= -BARYCENTRIC_EPSILON && bc[1] >= -BARYCENTRIC_EPSILON && bc[2] >= -BARYCENTRIC_EPSILON;
  });

  if (containing) {
    const bc = barycentric(p, points[containing.a], points[containing.b], points[containing.c]) as [number, number, number];
    // Clamp the epsilon slack away so weights never go slightly negative.
    pointWeights[containing.a] = Math.max(0, bc[0]);
    pointWeights[containing.b] = Math.max(0, bc[1]);
    pointWeights[containing.c] = Math.max(0, bc[2]);
  } else {
    // Outside the hull — blend along the nearest edge. The nearest edge to an exterior point is
    // always a hull edge, so scanning every triangle edge finds it without building the hull.
    let bestDist = Infinity;
    let bestA = 0;
    let bestB = 0;
    let bestT = 0;
    for (const tri of triangles) {
      for (const [i0, i1] of [
        [tri.a, tri.b],
        [tri.b, tri.c],
        [tri.c, tri.a],
      ] as [number, number][]) {
        const t = closestOnSegment(p, points[i0], points[i1]);
        const cx = points[i0].x + (points[i1].x - points[i0].x) * t;
        const cy = points[i0].y + (points[i1].y - points[i0].y) * t;
        const dist = (p.x - cx) * (p.x - cx) + (p.y - cy) * (p.y - cy);
        if (dist < bestDist) {
          bestDist = dist;
          bestA = i0;
          bestB = i1;
          bestT = t;
        }
      }
    }
    pointWeights[bestA] += 1 - bestT;
    pointWeights[bestB] += bestT;
  }

  return distribute(samples, members, pointWeights);
}

/** 1D interpolation along whichever axis the samples actually vary on. */
function blendDegenerate(
  samples: BlendSpaceSample[],
  points: Point[],
  members: number[][],
  x: number,
  y: number,
): BlendSpaceWeight[] {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const useY = maxY - minY > maxX - minX;
  // Reuse the 1D bracket logic by describing each unique point as a 1D sample.
  const projected = points.map((p, i) => ({ animationId: String(i), value: useY ? p.y : p.x }));
  const lineWeights = blend1D(projected, useY ? y : x);

  const pointWeights = new Array<number>(points.length).fill(0);
  lineWeights.forEach((w, i) => {
    pointWeights[i] = w.weight;
  });
  return distribute(samples, members, pointWeights);
}

/** Spreads each unique point's weight across the samples sharing that point, in input order. */
function distribute(samples: BlendSpaceSample[], members: number[][], pointWeights: number[]): BlendSpaceWeight[] {
  const out = samples.map((sample) => ({ animationId: sample.animationId, weight: 0 }));
  members.forEach((sampleIndices, pointIndex) => {
    const share = pointWeights[pointIndex] / sampleIndices.length;
    for (const sampleIndex of sampleIndices) out[sampleIndex].weight = share;
  });
  return out;
}
