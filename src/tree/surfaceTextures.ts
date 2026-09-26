import * as THREE from 'three';

let barkTexture: THREE.DataTexture | undefined;
let birchBarkTexture: THREE.DataTexture | undefined;
let foliageTexture: THREE.DataTexture | undefined;
let leafTexture: THREE.DataTexture | undefined;
let needleTexture: THREE.DataTexture | undefined;

const hash = (x: number, y: number) => {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return value - Math.floor(value);
};

function surfaceTexture(data: Uint8Array, size: number, name: string, repeat = true): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  texture.name = name;
  return texture;
}

/** Shared original bark grain. Grayscale preserves the authored vertex-colour ramp. */
export function naturalBarkTexture(): THREE.DataTexture {
  if (barkTexture) return barkTexture;
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size * Math.PI * 2, v = y / size * Math.PI * 2;
    const ridge = Math.abs(Math.sin(u * 13 + Math.sin(v * 2 + u * 3) * 0.8));
    const fine = Math.sin(u * 43 + Math.sin(v * 5) * 0.6) * 0.035;
    const grain = 0.48 + Math.pow(ridge, 0.3) * 0.4 + fine + hash(x, y) * 0.08;
    const value = Math.round(THREE.MathUtils.clamp(grain, 0, 1) * 255);
    const offset = (y * size + x) * 4;
    data[offset] = data[offset + 1] = data[offset + 2] = value;
    data[offset + 3] = 255;
  }
  barkTexture = surfaceTexture(data, size, 'Feather procedural bark');
  barkTexture.repeat.set(3, 2);
  return barkTexture;
}

/** Pale bark with deterministic horizontal lenticels; kept separate so ordinary brown bark is unchanged. */
export function naturalBirchBarkTexture(): THREE.DataTexture {
  if (birchBarkTexture) return birchBarkTexture;
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const broad = 0.9 + Math.sin(x * 0.055 + Math.sin(y * 0.09) * 0.8) * 0.035;
    const bandSeed = hash(Math.floor(x / 19), Math.floor(y / 7));
    const lenticel = bandSeed > 0.78 && (y % 7) < 2
      ? Math.max(0, 0.34 - Math.abs((x % 19) - 9.5) * 0.025)
      : 0;
    const grain = broad - lenticel + (hash(x, y) - 0.5) * 0.035;
    const value = Math.round(THREE.MathUtils.clamp(grain, 0.32, 1) * 255);
    const offset = (y * size + x) * 4;
    data[offset] = data[offset + 1] = data[offset + 2] = value;
    data[offset + 3] = 255;
  }
  birchBarkTexture = surfaceTexture(data, size, 'Feather procedural birch bark');
  birchBarkTexture.repeat.set(2, 5);
  return birchBarkTexture;
}

/** A leafy twig with tapered, veined silhouettes and space between leaves, authored procedurally. */
export function naturalFoliageTexture(): THREE.DataTexture {
  if (foliageTexture) return foliageTexture;
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  const leaves = Array.from({ length: 10 }, (_, index) => {
    const side = index % 2 ? 1 : -1, row = Math.floor(index / 2);
    const angle = side * (0.75 + row * 0.09);
    return { x: 0.5 + side * (0.14 + row * 0.009), y: 0.18 + row * 0.142 + (side > 0 ? 0.025 : 0),
      sin: Math.sin(angle), cos: Math.cos(angle), length: 0.19 - row * 0.009, width: 0.095 - row * 0.005 };
  });
  leaves.push({ x: 0.5, y: 0.86, sin: 0, cos: 1, length: 0.12, width: 0.065 });
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + 0.5) / size, v = (y + 0.5) / size;
    let coverage = v > 0.035 && v < 0.92 ? THREE.MathUtils.clamp((0.006 - Math.abs(u - 0.5)) * size + 0.5, 0, 1) : 0;
    let shade = 190;
    for (const leaf of leaves) {
      const dx = u - leaf.x, dy = v - leaf.y;
      const along = (dx * leaf.sin + dy * leaf.cos) / leaf.length;
      if (Math.abs(along) >= 1) continue;
      const across = (dx * leaf.cos - dy * leaf.sin) / leaf.width;
      const taper = Math.pow(Math.cos(along * Math.PI / 2), 0.85) * (1 + 0.035 * Math.sin(along * 55));
      const alpha = THREE.MathUtils.clamp((taper - Math.abs(across)) * leaf.width * size + 0.5, 0, 1);
      if (alpha <= coverage) continue;
      coverage = alpha;
      const midrib = Math.exp(-Math.abs(across) * 50);
      const vein = Math.pow(Math.max(0, Math.cos(along * 30 - Math.abs(across) * 9)), 16);
      shade = 222 + midrib * 20 + vein * 11 - Math.abs(across) * 15 + hash(x, y) * 5;
    }
    const offset = (y * size + x) * 4;
    // Keep RGB beyond the cutout bright too: bilinear edges must not acquire a dark fringe.
    data[offset] = data[offset + 1] = data[offset + 2] = coverage > 0 ? Math.round(shade) : 230;
    data[offset + 3] = Math.round(coverage * 255);
  }
  foliageTexture = surfaceTexture(data, size, 'Feather procedural leafy twig');
  return foliageTexture;
}

/** One serrated broadleaf. Geometry controls its real-world 5–15 cm scale. */
export function naturalLeafTexture(): THREE.DataTexture {
  if (leafTexture) return leafTexture;
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + 0.5) / size;
    const v = (y + 0.5) / size;
    const along = (v - 0.08) / 0.84;
    const profile = along >= 0 && along <= 1
      ? Math.pow(Math.sin(along * Math.PI), 0.7) * (0.88 + Math.sin(along * 18 * Math.PI) * 0.045)
      : 0;
    const across = Math.abs((u - 0.5) / 0.43);
    const leaf = THREE.MathUtils.clamp((profile - across) * 24, 0, 1);
    const stem = v < 0.14 ? THREE.MathUtils.clamp((0.022 - Math.abs(u - 0.5)) * size, 0, 1) : 0;
    const coverage = Math.max(leaf, stem);
    const midrib = Math.exp(-Math.abs(u - 0.5) * 95);
    const veins = Math.pow(Math.max(0, Math.cos((v * 16 + Math.abs(u - 0.5) * 22) * Math.PI)), 24);
    const shade = 204 + midrib * 28 + veins * 9 + hash(x, y) * 8;
    const offset = (y * size + x) * 4;
    data[offset] = data[offset + 1] = data[offset + 2] = coverage > 0 ? Math.round(shade) : 224;
    data[offset + 3] = Math.round(coverage * 255);
  }
  leafTexture = surfaceTexture(data, size, 'Feather procedural single leaf', false);
  return leafTexture;
}

/** A compact fan of needles; each card represents a small twig spray rather than one giant leaf. */
export function naturalNeedleTexture(): THREE.DataTexture {
  if (needleTexture) return needleTexture;
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  const needles = [-0.34, -0.17, 0, 0.17, 0.34];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + 0.5) / size;
    const v = (y + 0.5) / size;
    let coverage = 0;
    for (const spread of needles) {
      const targetX = 0.5 + spread * v;
      const halfWidth = 0.012 * (0.5 + Math.sin(v * Math.PI) * 0.5);
      if (v > 0.05 && v < 0.96) {
        coverage = Math.max(coverage, THREE.MathUtils.clamp((halfWidth - Math.abs(u - targetX)) * size, 0, 1));
      }
    }
    const offset = (y * size + x) * 4;
    const shade = 205 + v * 24 + hash(x, y) * 7;
    data[offset] = data[offset + 1] = data[offset + 2] = coverage > 0 ? Math.round(shade) : 220;
    data[offset + 3] = Math.round(coverage * 255);
  }
  needleTexture = surfaceTexture(data, size, 'Feather procedural needle spray', false);
  return needleTexture;
}
