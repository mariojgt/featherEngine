import type { Vector3Tuple } from '../types';
import { generateMap } from './game';

export interface GardenPart {
  name: string;
  kind: 'cube' | 'sphere' | 'capsule';
  position: Vector3Tuple;
  scale: Vector3Tuple;
  color: string;
  rotation?: Vector3Tuple;
}

/** Original, asset-free scenery. Each part becomes a normal editable Feather object. */
export function gardenScenery(seed: number): GardenPart[] {
  const map = generateMap(seed);
  const parts: GardenPart[] = [];
  let state = (seed ^ 0x6a09e667) >>> 0;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const part = (name: string, kind: GardenPart['kind'], position: Vector3Tuple, scale: Vector3Tuple, color: string, rotation?: Vector3Tuple) => parts.push({ name, kind, position, scale, color, rotation });
  part('Garden island · earth', 'cube', [0, -1.1, 0], [31, 1.8, 23], '#a47667');
  part('Garden island · mint edge', 'cube', [0, -0.25, 0], [31.3, 0.45, 23.3], '#427e66');
  part('Garden island · soft turf', 'cube', [0, -0.04, 0], [31, 0.2, 23], '#8bbc78');
  part('Ground beyond the garden', 'cube', [0, -2.1, 0], [200, 0.3, 200], '#bad1c6');

  for (let i = 1; i < map.path.length; i++) {
    const a = map.path[i - 1], b = map.path[i];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    part(`Route ${i} · caramel edging`, 'cube', [(a.x + b.x) / 2, 0.09, (a.z + b.z) / 2], [Math.abs(b.x - a.x) + 1.75, 0.15, Math.abs(b.z - a.z) + 1.75], '#b89970');
    part(`Route ${i} · warm sand`, 'cube', [(a.x + b.x) / 2, 0.18, (a.z + b.z) / 2], [Math.abs(b.x - a.x) + 1.42, 0.08, Math.abs(b.z - a.z) + 1.42], '#edd6a1');
    for (let j = 0; j < length; j += 1.4) {
      const t = j / length;
      part(`Route ${i} · stepping stone ${j}`, 'cube', [a.x + (b.x - a.x) * t, 0.23, a.z + (b.z - a.z) * t], [0.55 + random() * 0.3, 0.03, 0.38 + random() * 0.25], '#f6e5be', [0, random() * 0.5, 0]);
    }
  }

  // Keep all decorative props away from the playable route and build pads.
  const routeDistance = (x: number, z: number) => Math.min(...map.path.slice(1).map((b, i) => {
    const a = map.path[i], dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
    return Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
  }));
  const clear = (x: number, z: number, radius: number) => routeDistance(x, z) > radius && map.plots.every(p => Math.hypot(x - p.x, z - p.z) > radius + 0.3);
  for (let i = 0; i < 16; i++) {
    const x = -14 + random() * 28, z = (i < 10 ? -1 : 1) * (9.3 + random() * 0.9);
    if (!clear(x, z, 2.2)) continue;
    const h = 1.7 + random() * 1.1;
    part(`Lollipop tree ${i} · trunk`, 'capsule', [x, h * 0.5, z], [0.28, h * 0.6, 0.28], '#9b7662');
    part(`Lollipop tree ${i} · canopy`, 'sphere', [x, h + 0.45, z], [1.9, 2, 1.7], i % 3 === 0 ? '#c7b3d9' : '#5b9e76');
    part(`Lollipop tree ${i} · sunlit crown`, 'sphere', [x - 0.35, h + 0.95, z - 0.15], [1.45, 1.4, 1.35], i % 3 === 0 ? '#e1c8e7' : '#88c28b');
  }
  for (let i = 0; i < 75; i++) {
    const x = -14.3 + random() * 28.6, z = -10.4 + random() * 20.8;
    if (!clear(x, z, 1.5)) continue;
    const color = ['#e7eed1', '#f6c7af', '#d2b4db', '#fbe4a1'][i % 4];
    if (i % 4 === 0) {
      part(`Wildflower ${i} · stem`, 'capsule', [x, 0.22, z], [0.055, 0.24, 0.055], '#4f8c68');
      part(`Wildflower ${i} · blossom`, 'sphere', [x, 0.5, z], [0.29, 0.16, 0.29], color);
      part(`Wildflower ${i} · heart`, 'sphere', [x, 0.57, z], [0.12, 0.1, 0.12], '#fff0b2');
    } else {
      part(`Garden pebble ${i}`, 'sphere', [x, 0.12, z], [0.25 + random() * 0.25, 0.24, 0.3], i % 3 ? '#a9cc8e' : '#d4dcc1');
    }
  }
  for (let i = 0; i < 13; i++) {
    const x = -13 + i * 2.15;
    part(`Back fence · picket ${i}`, 'cube', [x, 0.6, -10.7], [0.22, 1.2, 0.24], '#f4e6c7', [0, 0, (random() - 0.5) * 0.08]);
  }
  for (const y of [0.35, 0.85]) part('Back fence · rail', 'cube', [0, y, -10.75], [28, 0.14, 0.14], '#e0cfa9');

  const end = map.path[map.path.length - 1];
  const bx = end.x + 0.55, bz = end.z;
  part('Garden HQ · foundation', 'cube', [bx, 0.3, bz], [2.65, 0.5, 2.65], '#e8d6b1');
  part('Garden HQ · cottage', 'cube', [bx, 1.1, bz], [2.1, 1.55, 2.1], '#fff0cd');
  part('Garden HQ · mushroom roof', 'sphere', [bx, 2.05, bz], [3.3, 1.65, 3.3], '#da807c');
  part('Garden HQ · doorway', 'cube', [bx - 1.065, 0.85, bz], [0.08, 1.3, 0.8], '#6d807b');
  part('Garden HQ · window', 'cube', [bx, 1.3, bz + 1.07], [0.72, 0.72, 0.1], '#8dbfc6');
  part('Garden HQ · window cross', 'cube', [bx, 1.3, bz + 1.135], [0.06, 0.78, 0.04], '#fff2d4');
  part('Garden HQ · window bar', 'cube', [bx, 1.3, bz + 1.135], [0.78, 0.06, 0.04], '#fff2d4');
  for (const [x, z, size] of [[-0.75, 0.3, 0.42], [0.5, 0.3, 0.5], [0.25, 1.05, 0.3], [-1.1, 0.7, 0.32]]) {
    const y = 2.05 + 0.9075 * Math.sqrt(1 - (x * x + z * z) / (1.815 * 1.815));
    part('Garden HQ · roof spot', 'sphere', [bx + x, y + 0.04, bz + z], [size, 0.14, size], '#fbe9cf');
  }
  part('Garden HQ · flagpole', 'capsule', [bx, 3.15, bz], [0.06, 0.7, 0.06], '#ffeac8');
  part('Garden HQ · mint flag', 'cube', [bx + 0.36, 3.65, bz], [0.74, 0.43, 0.06], '#76b8a7');

  const start = map.path[0];
  for (const offset of [-1.4, 1.4]) {
    part('Sleepy hollow · gatepost', 'cube', [start.x, 0.85, start.z + offset], [0.65, 1.7, 0.65], '#9293a6');
    part('Sleepy hollow · capstone', 'sphere', [start.x, 1.82, start.z + offset], [0.83, 0.5, 0.83], '#bdb0c7');
  }
  part('Sleepy hollow · arch', 'cube', [start.x, 2, start.z], [0.5, 0.35, 3.4], '#a59aaf');
  for (const z of [-2.5, 2.5]) {
    part('Sleepy hollow · sleepy headstone', 'capsule', [start.x - 0.4, 0.5, start.z + z], [0.55, 0.6, 0.24], '#a6a6b4', [0, 0, z * 0.035]);
  }
  return parts;
}
