import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
// Tileable mathematical stone/albedo and tangent-space normal maps for the editable set.
const size = 512, heights = new Float32Array(size * size);
const hash = (x, y, period) => {
  const ix = ((x % period) + period) % period, iy = ((y % period) + period) % period;
  let h = Math.imul(ix + 71, 374761393) + Math.imul(iy + 29, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};
const noise = (x, y, period) => {
  const ix = Math.floor(x), iy = Math.floor(y), tx = x - ix, ty = y - iy;
  const u = tx * tx * (3 - 2 * tx), v = ty * ty * (3 - 2 * ty);
  const a = hash(ix, iy, period), b = hash(ix + 1, iy, period), c = hash(ix, iy + 1, period), d = hash(ix + 1, iy + 1, period);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  let value = 0, amp = 0.5;
  for (let octave = 0; octave < 6; octave++) { const p = 4 * 2 ** octave; value += noise(x / size * p, y / size * p, p) * amp; amp *= 0.5; }
  heights[y * size + x] = value;
}
const albedo = Buffer.alloc(size * size * 3), normal = Buffer.alloc(albedo.length);
const get = (x, y) => heights[((y + size) % size) * size + (x + size) % size];
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const i = (y * size + x) * 3, h = get(x, y), grain = hash(x, y, size);
  const fissure = Math.max(0, 1 - Math.abs(h - 0.48) * 95);
  const color = Math.max(50, Math.min(255, 110 + h * 160 + grain * 18 - fissure * 45));
  albedo[i] = color; albedo[i + 1] = color; albedo[i + 2] = color * 0.97;
  const dx = (get(x - 1, y) - get(x + 1, y)) * 3, dy = (get(x, y - 1) - get(x, y + 1)) * 3;
  const len = Math.hypot(dx, dy, 1);
  normal[i] = (dx / len * 0.5 + 0.5) * 255; normal[i + 1] = (dy / len * 0.5 + 0.5) * 255; normal[i + 2] = (1 / len * 0.5 + 0.5) * 255;
}
mkdirSync('public/templates/last-light', { recursive: true });
for (const [name, pixels] of [['stone-albedo', albedo], ['stone-normal', normal]]) {
  await sharp(pixels, { raw: { width: size, height: size, channels: 3 } }).png().toFile(`public/templates/last-light/${name}.png`);
}
console.log('Generated tileable stone albedo and normal maps.');
