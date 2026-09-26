import * as THREE from 'three';

export interface NaturalGrassGeometryOptions {
  /** Number of real ribbon blades in one instanced patch. */
  bladeCount?: number;
  /** Longitudinal sections per blade. Four is enough for a readable curve without excessive vertices. */
  segments?: number;
  /** Diameter of the patch before the placement matrix is applied, in metres. */
  patchWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  minBladeWidth?: number;
  maxBladeWidth?: number;
  seed?: number;
}

export interface NaturalGrassGeometryCost {
  blades: number;
  vertices: number;
  triangles: number;
}

export const NATURAL_GRASS_DEFAULTS = Object.freeze({
  bladeCount: 24,
  segments: 3,
  patchWidth: 0.78,
  minHeight: 0.16,
  maxHeight: 0.48,
  minBladeWidth: 0.014,
  maxBladeWidth: 0.028,
  seed: 0x6d2b79f5,
});

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function finitePositive(name: string, value: number): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be a finite positive number`);
  return value;
}

/**
 * Builds one deterministic 0.6–0.9 m grass patch from individual tapered, curved ribbons.
 *
 * The geometry is intended to be instanced: variation inside a patch is baked once while variation between
 * placements comes from their matrices and world-space shader noise. `bladeRoot` and `bladeRandom` let the
 * renderer bend and shade each blade independently without creating one draw call per blade.
 */
export function createNaturalGrassGeometry(options: NaturalGrassGeometryOptions = {}): THREE.BufferGeometry {
  const bladeCount = Math.trunc(finitePositive('bladeCount', options.bladeCount ?? NATURAL_GRASS_DEFAULTS.bladeCount));
  const segments = Math.trunc(finitePositive('segments', options.segments ?? NATURAL_GRASS_DEFAULTS.segments));
  if (segments < 2) throw new RangeError('segments must be at least 2');
  const patchWidth = finitePositive('patchWidth', options.patchWidth ?? NATURAL_GRASS_DEFAULTS.patchWidth);
  const minHeight = finitePositive('minHeight', options.minHeight ?? NATURAL_GRASS_DEFAULTS.minHeight);
  const maxHeight = finitePositive('maxHeight', options.maxHeight ?? NATURAL_GRASS_DEFAULTS.maxHeight);
  const minBladeWidth = finitePositive('minBladeWidth', options.minBladeWidth ?? NATURAL_GRASS_DEFAULTS.minBladeWidth);
  const maxBladeWidth = finitePositive('maxBladeWidth', options.maxBladeWidth ?? NATURAL_GRASS_DEFAULTS.maxBladeWidth);
  if (maxHeight < minHeight) throw new RangeError('maxHeight must be greater than or equal to minHeight');
  if (maxBladeWidth < minBladeWidth) throw new RangeError('maxBladeWidth must be greater than or equal to minBladeWidth');

  const random = seededRandom(options.seed ?? NATURAL_GRASS_DEFAULTS.seed);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const bladeRoots: number[] = [];
  const bladeRandoms: number[] = [];
  const indices: number[] = [];
  // Leave room for intrinsic curvature at the edge: the completed silhouette stays inside patchWidth.
  const maxCurve = patchWidth * 0.22;
  const rootRadius = Math.max(0, patchWidth * 0.5 - maxCurve - maxBladeWidth * 0.5);

  for (let blade = 0; blade < bladeCount; blade += 1) {
    // A jittered angular stratum prevents a seeded patch from accidentally collapsing into a small knot.
    // Most blades make the irregular 0.6–0.9 m perimeter; every fourth is pulled inward to fill the centre.
    const rootRadiusAtBlade = rootRadius * (blade % 4 === 0 ? 0.15 + random() * 0.4 : 0.86 + random() * 0.13);
    const rootAngle = (blade + (random() - 0.5) * 0.42) / bladeCount * Math.PI * 2;
    const rootX = Math.cos(rootAngle) * rootRadiusAtBlade;
    const rootZ = Math.sin(rootAngle) * rootRadiusAtBlade;
    const yaw = random() * Math.PI * 2;
    const sideX = Math.cos(yaw);
    const sideZ = Math.sin(yaw);
    const forwardX = -sideZ;
    const forwardZ = sideX;
    const height = THREE.MathUtils.lerp(minHeight, maxHeight, 0.18 + random() * 0.82);
    const width = THREE.MathUtils.lerp(minBladeWidth, maxBladeWidth, random());
    const bend = (random() < 0.5 ? -1 : 1) * maxCurve * (0.55 + random() * 0.45);
    const ripple = (random() * 2 - 1) * maxCurve * 0.12;
    const variation = random();
    const firstVertex = positions.length / 3;

    // Paired vertices form the blade body. The final row is a single apex so the tip is truly tapered.
    for (let row = 0; row < segments; row += 1) {
      const t = row / segments;
      const curve = bend * t * t + ripple * Math.sin(Math.PI * t);
      const curveDerivative = bend * 2 * t + ripple * Math.PI * Math.cos(Math.PI * t);
      const halfWidth = width * 0.5 * (1 - 0.72 * t - 0.2 * t * t);
      const centerX = rootX + forwardX * curve;
      const centerZ = rootZ + forwardZ * curve;
      // cross(side, tangent), normalized. The slight vertical component makes intrinsic curvature respond
      // naturally to overhead light before the shader adds its soft skyward normal lift.
      const nx0 = -sideZ * height;
      const ny0 = -curveDerivative;
      const nz0 = sideX * height;
      const normalLength = Math.hypot(nx0, ny0, nz0) || 1;
      const nx = nx0 / normalLength;
      const ny = ny0 / normalLength;
      const nz = nz0 / normalLength;
      positions.push(
        centerX - sideX * halfWidth, height * t, centerZ - sideZ * halfWidth,
        centerX + sideX * halfWidth, height * t, centerZ + sideZ * halfWidth,
      );
      normals.push(nx, ny, nz, nx, ny, nz);
      uvs.push(0, t, 1, t);
      bladeRoots.push(rootX, rootZ, rootX, rootZ);
      bladeRandoms.push(variation, variation);
    }

    const tipCurve = bend;
    positions.push(rootX + forwardX * tipCurve, height, rootZ + forwardZ * tipCurve);
    const tipNormalLength = Math.hypot(-sideZ * height, -bend * 2, sideX * height) || 1;
    normals.push(-sideZ * height / tipNormalLength, -bend * 2 / tipNormalLength, sideX * height / tipNormalLength);
    uvs.push(0.5, 1);
    bladeRoots.push(rootX, rootZ);
    bladeRandoms.push(variation);

    for (let row = 0; row < segments - 1; row += 1) {
      const lower = firstVertex + row * 2;
      indices.push(lower, lower + 1, lower + 3, lower, lower + 3, lower + 2);
    }
    const shoulder = firstVertex + (segments - 1) * 2;
    const apex = firstVertex + segments * 2;
    indices.push(shoulder, shoulder + 1, apex);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('bladeRoot', new THREE.Float32BufferAttribute(bladeRoots, 2));
  geometry.setAttribute('bladeRandom', new THREE.Float32BufferAttribute(bladeRandoms, 1));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const cost: NaturalGrassGeometryCost = {
    blades: bladeCount,
    vertices: bladeCount * (segments * 2 + 1),
    triangles: bladeCount * (segments * 2 - 1),
  };
  geometry.userData.naturalGrass = Object.freeze({
    ...cost,
    patchWidth,
    minHeight,
    maxHeight,
    seed: (options.seed ?? NATURAL_GRASS_DEFAULTS.seed) >>> 0,
  });
  return geometry;
}

/** Shared immutable source geometry: 24 blades, 168 vertices and 120 triangles per placement. */
export const NATURAL_GRASS_GEOMETRY = createNaturalGrassGeometry();
export const NATURAL_GRASS_GEOMETRY_COST = Object.freeze(
  NATURAL_GRASS_GEOMETRY.userData.naturalGrass as NaturalGrassGeometryCost,
);
