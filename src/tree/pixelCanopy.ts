import * as THREE from 'three';
import type { TreePixelLeafArt } from '../types';
import { treeRng } from './treeSpec';

/**
 * Runtime-painted neutral canopy atlas, adapted from RPG Mania's pixelCanopy painter.
 *
 * The atlas contains no imported art. Every 32×32 cutout is generated deterministically from a
 * leaf-language recipe, then multiplied by the tree card's vertex colour. Keeping hue in the tree
 * spec means one tiny atlas can render every palette and collaborators only need spec + seed.
 */

export const PIXEL_CANOPY_CELL = 32;
export const PIXEL_CANOPY_COLUMNS = 16;
export const PIXEL_CANOPY_ROWS = 2;
export const PIXEL_CANOPY_WIDTH = PIXEL_CANOPY_CELL * PIXEL_CANOPY_COLUMNS;
export const PIXEL_CANOPY_HEIGHT = PIXEL_CANOPY_CELL * PIXEL_CANOPY_ROWS;

const SOLID_COLUMNS = 2;
const USABLE_COLUMNS = PIXEL_CANOPY_COLUMNS - SOLID_COLUMNS;
const TAU = Math.PI * 2;
const RAMP = [0.42, 0.58, 0.74, 0.89, 1] as const;

export const PIXEL_LEAF_ARTS: readonly TreePixelLeafArt[] = [
  'broad',
  'star',
  'fine',
  'blossom',
  'jungle',
  'ribbon',
  'needle',
  'pod',
  'quill',
];

const VARIANTS = 3;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
type PixelWriter = (x: number, y: number, value: number) => void;

interface ClusterRecipe {
  /** Mass ellipses: centre x/y and radius x/y, in cell pixels. */
  lobes: readonly (readonly [number, number, number, number])[];
  /** Frequency/amplitude pairs that bite a recognisable rhythm into the silhouette. */
  bite: readonly (readonly [number, number])[];
  ribs?: number;
  holes?: number;
  lift?: number;
  specks?: number;
  cleft?: number;
}

function atlasCell(leafArt: TreePixelLeafArt, variant: number): { column: number; row: number } {
  const index = PIXEL_LEAF_ARTS.indexOf(leafArt) * VARIANTS + Math.abs(Math.trunc(variant)) % VARIANTS;
  return {
    column: SOLID_COLUMNS + (index % USABLE_COLUMNS),
    row: Math.floor(index / USABLE_COLUMNS),
  };
}

/** Half-texel-inset UV rectangle. v0/v1 are reversed because DataTexture rows start at the bottom. */
export function pixelCanopyUvRect(
  leafArt: TreePixelLeafArt,
  variant: number,
): readonly [number, number, number, number] {
  const { column, row } = atlasCell(leafArt, variant);
  const u0 = (column * PIXEL_CANOPY_CELL + 0.5) / PIXEL_CANOPY_WIDTH;
  const u1 = ((column + 1) * PIXEL_CANOPY_CELL - 0.5) / PIXEL_CANOPY_WIDTH;
  const v0 = ((row + 1) * PIXEL_CANOPY_CELL - 0.5) / PIXEL_CANOPY_HEIGHT;
  const v1 = (row * PIXEL_CANOPY_CELL + 0.5) / PIXEL_CANOPY_HEIGHT;
  return [u0, v0, u1, v1];
}

function ring(
  count: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  lobeRadius: number,
  seed: number,
): (readonly [number, number, number, number])[] {
  const random = treeRng(seed);
  const lobes: (readonly [number, number, number, number])[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * TAU + random() * 0.4;
    const distance = index === 0 ? 0 : 0.62 + random() * 0.38;
    lobes.push([
      cx + Math.cos(angle) * rx * distance,
      cy + Math.sin(angle) * ry * distance,
      lobeRadius * (0.7 + random() * 0.5),
      lobeRadius * (0.62 + random() * 0.45),
    ]);
  }
  return lobes;
}

function clusterRecipe(leafArt: TreePixelLeafArt, variant: number): ClusterRecipe {
  const seed = 0x51a7 + variant * 0x9e37;
  switch (leafArt) {
    case 'broad':
      return { lobes: ring(6 + variant, 16, 16, 11, 10, 8.2, seed), bite: [[3, 0.18], [7, 0.11]], ribs: 1 };
    case 'star':
      return { lobes: ring(4 + (variant % 2), 16, 16, 10, 10, 9.5, seed), bite: [[5, 0.36], [2, 0.12]], ribs: 2 };
    case 'fine':
      return { lobes: ring(9 + variant, 16, 16, 12, 10, 5.6, seed), bite: [[6, 0.22], [11, 0.13]], holes: 0.06 };
    case 'blossom':
      return { lobes: ring(7 + variant, 16, 16, 11, 10, 7.6, seed), bite: [[4, 0.12], [9, 0.07]], lift: 0.14, specks: 30, cleft: 2 };
    case 'jungle':
      return { lobes: ring(4 + (variant % 2), 16, 16, 9, 8, 10, seed), bite: [[2, 0.16], [3, 0.1]], ribs: 2, cleft: 1 };
    case 'needle':
      return { lobes: ring(6 + variant, 16, 18, 13, 5, 6.4, seed), bite: [[15, 0.32], [5, 0.18]], ribs: 5, holes: 0.05, cleft: 1 };
    default:
      return { lobes: [], bite: [] };
  }
}

/** Block the mass, break the edge, carve clefts, then apply a five-step top-left light ramp. */
function paintCluster(write: PixelWriter, seed: number, recipe: ClusterRecipe): void {
  const random = treeRng(seed);
  const size = PIXEL_CANOPY_CELL;
  const phases = recipe.lobes.map(() => recipe.bite.map(() => random() * TAU));
  const jitter = recipe.lobes.map(() => (random() - 0.5) * 0.5);
  const owner = new Int8Array(size * size).fill(-1);

  for (let lobeIndex = 0; lobeIndex < recipe.lobes.length; lobeIndex += 1) {
    const [cx, cy, rx, ry] = recipe.lobes[lobeIndex];
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        const distance = Math.hypot(dx, dy);
        if (distance < 0.02) {
          owner[y * size + x] = lobeIndex;
          continue;
        }
        const angle = Math.atan2(dy, dx);
        let edge = 1;
        for (let biteIndex = 0; biteIndex < recipe.bite.length; biteIndex += 1) {
          const [frequency, amplitude] = recipe.bite[biteIndex];
          edge += Math.sin(angle * frequency + phases[lobeIndex][biteIndex]) * amplitude;
        }
        if (distance <= edge) owner[y * size + x] = lobeIndex;
      }
    }
  }

  if (recipe.holes) {
    for (let index = 0; index < owner.length; index += 1) {
      if (owner[index] >= 0 && random() < recipe.holes) owner[index] = -1;
    }
  }

  // Two-pass Chebyshev distance to the transparent edge.
  const distance = new Int16Array(size * size);
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= size || y >= size ? 0 : distance[y * size + x]);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      distance[y * size + x] = owner[y * size + x] < 0
        ? 0
        : 1 + Math.min(at(x - 1, y), at(x, y - 1), at(x - 1, y - 1), at(x + 1, y - 1));
    }
  }
  for (let y = size - 1; y >= 0; y -= 1) {
    for (let x = size - 1; x >= 0; x -= 1) {
      if (owner[y * size + x] < 0) continue;
      distance[y * size + x] = Math.min(
        distance[y * size + x],
        1 + Math.min(at(x + 1, y), at(x, y + 1), at(x + 1, y + 1), at(x - 1, y + 1)),
      );
    }
  }

  let minX = size;
  let maxX = 0;
  let minY = size;
  let maxY = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (owner[y * size + x] < 0) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const lobeIndex = owner[y * size + x];
      if (lobeIndex < 0) continue;
      const depth = distance[y * size + x];
      let light =
        0.58 * (1 - (y - minY) / height) +
        0.2 * (1 - (x - minX) / width) +
        0.2 * clamp(depth / 4, 0, 1) +
        jitter[lobeIndex] * 0.12 +
        (recipe.lift ?? 0);
      if (depth === 1) {
        const openAbove = y === 0 || owner[(y - 1) * size + x] < 0;
        light += openAbove ? 0.3 : -0.26;
      }
      write(x, y, clamp(Math.round(light * (RAMP.length - 1)), 0, RAMP.length - 1));
    }
  }

  for (let y = 1; y < size; y += 1) {
    for (let x = 1; x < size; x += 1) {
      const current = owner[y * size + x];
      if (current < 0) continue;
      const left = owner[y * size + x - 1];
      const above = owner[(y - 1) * size + x];
      if ((left >= 0 && left !== current) || (above >= 0 && above !== current)) write(x, y, recipe.cleft ?? 0);
    }
  }

  if (recipe.ribs) {
    for (let lobeIndex = 0; lobeIndex < recipe.lobes.length; lobeIndex += 1) {
      const [cx, cy, rx, ry] = recipe.lobes[lobeIndex];
      for (let rib = 0; rib < recipe.ribs; rib += 1) {
        const angle = random() * TAU;
        const length = Math.max(rx, ry) * (0.5 + random() * 0.5);
        for (let step = 0; step < length; step += 0.7) {
          const x = Math.round(cx + Math.cos(angle) * step);
          const y = Math.round(cy + Math.sin(angle) * step);
          if (x < 0 || y < 0 || x >= size || y >= size || owner[y * size + x] < 0) break;
          write(x, y, distance[y * size + x] > 2 ? 1 : 0);
        }
      }
    }
  }

  for (let index = 0; index < (recipe.specks ?? 0); index += 1) {
    const x = Math.floor(random() * size);
    const y = Math.floor(random() * size * 0.62) + 2;
    if (y < size && owner[y * size + x] >= 0) write(x, y, RAMP.length - 1);
  }
}

function paintRibbons(write: PixelWriter, seed: number): void {
  const random = treeRng(seed);
  const size = PIXEL_CANOPY_CELL;
  const strands = 9 + Math.floor(random() * 4);
  for (let strand = 0; strand < strands; strand += 1) {
    let x = 1 + random() * (size - 2);
    const drift = (random() - 0.5) * 0.22;
    const wave = 0.4 + random() * 0.5;
    const phase = random() * TAU;
    const length = size * (0.45 + random() * 0.55);
    const width = random() < 0.45 ? 2 : 1;
    for (let y = 0; y < length; y += 1) {
      x += drift + Math.sin(y * 0.28 + phase) * 0.16 * wave;
      const px = Math.round(x);
      const value = clamp(Math.round((1 - y / size) * 3.2 + (strand % 3) * 0.4), 0, RAMP.length - 1);
      for (let dx = 0; dx < width; dx += 1) write(px + dx, y, value);
      if (y > 2 && random() < 0.3) write(px + (random() < 0.5 ? -1 : width), y, Math.max(0, value - 1));
    }
  }
}

function paintPods(write: PixelWriter, seed: number): void {
  const random = treeRng(seed);
  const pods = 4 + Math.floor(random() * 3);
  for (let pod = 0; pod < pods; pod += 1) {
    const cx = 3 + random() * (PIXEL_CANOPY_CELL - 7);
    const stem = 3 + random() * 9;
    const radius = 3 + random() * 1.6;
    const cy = stem + radius + random() * 6;
    for (let y = 0; y < cy - radius + 1; y += 1) write(Math.round(cx + Math.sin(y * 0.35 + pod) * 0.7), y, 1);
    for (let y = -Math.ceil(radius); y <= Math.ceil(radius); y += 1) {
      for (let x = -Math.ceil(radius); x <= Math.ceil(radius); x += 1) {
        const distance = Math.hypot(x, y * 0.86);
        if (distance > radius) continue;
        const value = distance > radius - 1 ? 0 : distance < radius * 0.42 ? 4 : 2 + (y < 0 ? 1 : 0);
        write(Math.round(cx) + x, Math.round(cy) + y, value);
      }
    }
  }
}

function paintQuills(write: PixelWriter, seed: number): void {
  const random = treeRng(seed);
  const originX = PIXEL_CANOPY_CELL / 2;
  const originY = PIXEL_CANOPY_CELL - 2;
  const blades = 10 + Math.floor(random() * 5);
  for (let blade = 0; blade < blades; blade += 1) {
    const t = blade / Math.max(1, blades - 1);
    const angle = -Math.PI / 2 + (t - 0.5) * 2.5 + (random() - 0.5) * 0.16;
    const length = (16 + random() * 12) * (0.62 + 0.38 * Math.sin(t * Math.PI));
    const curl = (random() - 0.5) * 0.5;
    for (let distance = 0; distance < length; distance += 0.6) {
      const fraction = distance / length;
      const bent = angle + curl * fraction * fraction;
      const x = Math.round(originX + Math.cos(bent) * distance);
      const y = Math.round(originY + Math.sin(bent) * distance);
      const width = fraction < 0.55 ? 2 : 1;
      const value = clamp(Math.round(1 + fraction * 2.6 + (t < 0.5 ? 0.5 : 0)), 0, RAMP.length - 1);
      for (let dx = 0; dx < width; dx += 1) write(x + dx, y, value);
      if (width === 2) write(x, y + 1, 0);
    }
  }
}

export interface PixelCanopyAtlasData {
  data: Uint8Array;
  width: number;
  height: number;
}

/** Build a fresh byte buffer, useful for deterministic tests as well as the runtime texture. */
export function buildPixelCanopyAtlasData(): PixelCanopyAtlasData {
  const data = new Uint8Array(PIXEL_CANOPY_WIDTH * PIXEL_CANOPY_HEIGHT * 4);

  // Opaque white safety block retained from the RPG renderer. It also makes the atlas easy to inspect.
  for (let y = 0; y < PIXEL_CANOPY_HEIGHT; y += 1) {
    for (let x = 0; x < SOLID_COLUMNS * PIXEL_CANOPY_CELL; x += 1) {
      const offset = (y * PIXEL_CANOPY_WIDTH + x) * 4;
      data[offset] = data[offset + 1] = data[offset + 2] = data[offset + 3] = 255;
    }
  }

  for (const leafArt of PIXEL_LEAF_ARTS) {
    for (let variant = 0; variant < VARIANTS; variant += 1) {
      const { column, row } = atlasCell(leafArt, variant);
      const write: PixelWriter = (x, y, value) => {
        if (x < 0 || y < 0 || x >= PIXEL_CANOPY_CELL || y >= PIXEL_CANOPY_CELL) return;
        const grey = Math.round(RAMP[clamp(Math.trunc(value), 0, RAMP.length - 1)] * 255);
        const offset = ((row * PIXEL_CANOPY_CELL + y) * PIXEL_CANOPY_WIDTH + column * PIXEL_CANOPY_CELL + x) * 4;
        data[offset] = data[offset + 1] = data[offset + 2] = grey;
        data[offset + 3] = 255;
      };
      const seed = 0x2f1b ^ (PIXEL_LEAF_ARTS.indexOf(leafArt) * 0x1d3f) ^ (variant * 0x7b1);
      if (leafArt === 'ribbon') paintRibbons(write, seed);
      else if (leafArt === 'pod') paintPods(write, seed);
      else if (leafArt === 'quill') paintQuills(write, seed);
      else paintCluster(write, seed, clusterRecipe(leafArt, variant));
    }
  }
  return { data, width: PIXEL_CANOPY_WIDTH, height: PIXEL_CANOPY_HEIGHT };
}

let sharedTexture: THREE.DataTexture | null = null;

/** Shared GPU texture. Species select different cells through geometry UVs, so one atlas serves all trees. */
export function pixelCanopyTexture(): THREE.DataTexture {
  if (sharedTexture) return sharedTexture;
  const atlas = buildPixelCanopyAtlasData();
  const texture = new THREE.DataTexture(atlas.data, atlas.width, atlas.height, THREE.RGBAFormat);
  texture.name = 'Feather procedural pixel canopy';
  texture.colorSpace = THREE.NoColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  sharedTexture = texture;
  return texture;
}
