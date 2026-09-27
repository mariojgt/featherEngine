/** Shared, deterministic landscape. Rendering and authoritative movement use these exact samples. */
export const VALLEY_ID = 'sunlit-valley';
export const VALLEY_SIZE = 192;
export const GRID_SPACING = 4;
const rawHeight = (x, z) => {
  // A level cross-section under the north road keeps paving from cutting into the hillside.
  const hillsideX = Math.sign(x) * Math.max(0, Math.abs(x) - 4);
  const ridge = Math.sin(hillsideX / 24) * Math.cos(z / 31) * 2.4 + Math.sin(z / 22) * 1.5;
  // The village and ruined keep have level foundations, with gentle slopes between them.
  const village = Math.max(0, Math.min(1, (Math.hypot(x, z - 60) - 22) / 16));
  const keep = Math.max(0, Math.min(1, (Math.hypot(x, z + 65) - 17) / 15));
  return ridge * village * keep;
};
export const VALLEY_HEIGHTS = Object.freeze(Object.fromEntries(Array.from({ length: 51 }, (_, ix) =>
  Array.from({ length: 51 }, (_, iz) => [`${ix - 25}:${iz - 25}`, rawHeight((ix - 25) * GRID_SPACING, (iz - 25) * GRID_SPACING)])).flat()));
export function groundHeight(zone, x, z) {
  if (zone !== VALLEY_ID) return 0;
  const ix = Math.floor(x / GRID_SPACING), iz = Math.floor(z / GRID_SPACING);
  const smooth = t => t * t * (3 - 2 * t);
  const tx = smooth(x / GRID_SPACING - ix), tz = smooth(z / GRID_SPACING - iz);
  const h = (dx, dz) => VALLEY_HEIGHTS[`${ix + dx}:${iz + dz}`] ?? rawHeight((ix + dx) * GRID_SPACING, (iz + dz) * GRID_SPACING);
  return (h(0, 0) * (1 - tx) + h(1, 0) * tx) * (1 - tz) + (h(0, 1) * (1 - tx) + h(1, 1) * tx) * tz;
}
// Every solid prop is authored here so visible scenery and server collision cannot drift apart.
export const VALLEY_SOLIDS = Object.freeze([
  ...[-1, 1].map(side => ({ id: `beacon-${side}`, kind: 'pillar', x: side * 5, z: 46, width: .9, depth: .9, height: 6 })),
  ...[[-14, 62], [14, 62], [-14, 49], [14, 49]].map(([x, z], i) => ({ id: `cottage-${i}`, kind: 'cottage', x, z, width: 7, depth: 7, height: 4 })),
  ...[[-12, -65], [12, -65], [-12, -77], [12, -77]].map(([x, z], i) => ({ id: `ruin-${i}`, kind: 'ruin', x, z, width: 3, depth: 3, height: 7 })),
  ...Array.from({ length: 64 }, (_, i) => ({ id: `tree-${i}`, kind: 'tree', x: (i % 2 ? -1 : 1) * (22 + (i * 17 % 60)), z: 80 - (i * 29 % 166), width: 1.2, depth: 1.2, height: 8 })),
  ...[[-40, 38], [38, 35], [-52, -28], [48, -40], [-28, -78], [33, -76]].map(([x, z], i) => ({ id: `rock-${i}`, kind: 'rock', x, z, width: 5, depth: 4, height: 3 })),
]);
export function walkable(zone, x, z, radius = .38) {
  return zone !== VALLEY_ID || VALLEY_SOLIDS.every(s => Math.abs(x - s.x) >= s.width / 2 + radius || Math.abs(z - s.z) >= s.depth / 2 + radius);
}
/** Small axis-separated steps slide along walls and prevent tunnelling, including during a dash. */
export function moveOnGround(actor, dx, dz, bounds) {
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / .18));
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  for (let i = 0; i < steps; i++) {
    const x = clamp(actor.x + dx / steps, bounds.minX, bounds.maxX);
    if (walkable(actor.zone, x, actor.z)) actor.x = x;
    const z = clamp(actor.z + dz / steps, bounds.minZ, bounds.maxZ);
    if (walkable(actor.zone, actor.x, z)) actor.z = z;
  }
}
export function clearSight(zone, a, b) {
  const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / .3);
  for (let i = 1; i < steps; i++) if (!walkable(zone, a.x + (b.x - a.x) * i / steps, a.z + (b.z - a.z) * i / steps, 0)) return false;
  return true;
}
