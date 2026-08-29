import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three-stdlib';
import { DEFAULT_MESH } from './modelMesh';
import type { ModelPart, ModelPartMesh, ModelPartShape, ModelSpec, ModelStyle } from '../types';

/**
 * Geometry + material layer for prototype models.
 *
 * Every part renders a SHARED unit geometry scaled by the part's transform, so a scene full of
 * kit-bashed props costs five geometries total. Materials are flat-shaded MeshStandardMaterials
 * shared per palette color — the "flat stylized" look is per-face normals + solid colors, no maps.
 */

/**
 * A right-triangle prism ramp in the unit cube: bottom at y=-0.5, vertical back wall at z=-0.5,
 * slope from the front-bottom edge up to the back-top edge. Non-indexed with per-face normals so it
 * shades faceted like the rest of the kit. Material groups: 0 slope, 1 bottom, 2 back, 3 left, 4 right.
 */
function buildWedgeGeometry(): THREE.BufferGeometry {
  const h = 0.5;
  // Corner shorthand: F/B front/back (+z/-z), L/R left/right (-x/+x), D/U down/up (-y/+y).
  const FLD = [-h, -h, h], FRD = [h, -h, h], BLD = [-h, -h, -h], BRD = [h, -h, -h];
  const BLU = [-h, h, -h], BRU = [h, h, -h];
  const slopeNormal = new THREE.Vector3(0, 1, 1).normalize();
  const faces: Array<{ tris: number[][][]; normal: [number, number, number] }> = [
    { tris: [[FLD, FRD, BRU], [FLD, BRU, BLU]], normal: [0, slopeNormal.y, slopeNormal.z] }, // 0 slope
    { tris: [[FLD, BLD, BRD], [FLD, BRD, FRD]], normal: [0, -1, 0] }, // 1 bottom
    { tris: [[BRD, BLD, BLU], [BRD, BLU, BRU]], normal: [0, 0, -1] }, // 2 back
    { tris: [[FLD, BLU, BLD]], normal: [-1, 0, 0] }, // 3 left
    { tris: [[FRD, BRD, BRU]], normal: [1, 0, 0] }, // 4 right
  ];
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const geometry = new THREE.BufferGeometry();
  let cursor = 0;
  faces.forEach((face, materialIndex) => {
    const start = cursor;
    for (const tri of face.tris) {
      for (const [x, y, z] of tri) {
        positions.push(x, y, z);
        normals.push(...face.normal);
        // Planar-ish projection; prototype parts are solid colors, so uv only needs to exist.
        uvs.push(x + h, (y + z) * 0.5 + h);
        cursor += 1;
      }
    }
    geometry.addGroup(start, cursor - start, materialIndex);
  });
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return geometry;
}

const unitGeometries = new Map<ModelPartShape, THREE.BufferGeometry>();

const meshGeometryCache = new Map<string, THREE.BufferGeometry>();

/**
 * The exact geometry for a Mesh part: unit-space vertices + triangle indices, indexed and with
 * smooth vertex normals. Cached per content, never disposed (shared like the unit geometries).
 */
export function buildModelPartMeshGeometry(mesh: ModelPartMesh): THREE.BufferGeometry {
  const key = `${mesh.vertices.length}|${mesh.indices.length}|${mesh.vertices.flat().join(',')}|${mesh.indices.join(',')}`;
  let geometry = meshGeometryCache.get(key);
  if (!geometry) {
    geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.vertices.flat(), 3));
    geometry.setIndex([...mesh.indices]);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    meshGeometryCache.set(key, geometry);
  }
  return geometry;
}

/** Shared unit geometry for a shape. Never dispose these — every model part in the app uses them. */
export function getModelPartGeometry(shape: ModelPartShape): THREE.BufferGeometry {
  let geometry = unitGeometries.get(shape);
  if (!geometry) {
    switch (shape) {
      case 'cylinder': geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 20); break;
      case 'sphere': geometry = new THREE.SphereGeometry(0.5, 24, 16); break;
      case 'cone': geometry = new THREE.ConeGeometry(0.5, 1, 20); break;
      case 'wedge': geometry = buildWedgeGeometry(); break;
      case 'torus': geometry = new THREE.TorusGeometry(0.35, 0.15, 12, 28); break;
      case 'pyramid': geometry = new THREE.ConeGeometry(0.5, 1, 4); break;
      case 'hexprism': geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 6); break;
      case 'capsule': geometry = new THREE.CapsuleGeometry(0.25, 0.5, 8, 16); break;
      default: geometry = new THREE.BoxGeometry(1, 1, 1);
    }
    unitGeometries.set(shape, geometry);
  }
  return geometry;
}

const quantize = (value: number, step: number): number => Math.round(value / step) * step;

// Rounded boxes are built per (dims, radius) so the corner radius is TRUE under non-uniform part
// scale, then normalized back to unit space so the mesh keeps using part.scale like every other
// shape (which is what keeps the scale gizmo and the GLB bake contract unchanged). Quantized keys
// keep the cache bounded; entries are shared by every instance with the same dimensions.
const roundedBoxCache = new Map<string, THREE.BufferGeometry>();

function getRoundedUnitBox(scale: readonly number[], bevel: number): THREE.BufferGeometry {
  const w = Math.max(0.02, quantize(Math.abs(scale[0]), 0.01));
  const h = Math.max(0.02, quantize(Math.abs(scale[1]), 0.01));
  const d = Math.max(0.02, quantize(Math.abs(scale[2]), 0.01));
  const radius = Math.min(quantize(bevel, 0.005), Math.min(w, h, d) / 2 - 1e-3);
  if (radius <= 0) return getModelPartGeometry('box');
  const key = `${w}|${h}|${d}|${radius}`;
  let geometry = roundedBoxCache.get(key);
  if (!geometry) {
    geometry = new RoundedBoxGeometry(w, h, d, 3, radius);
    // Bake the inverse dimensions into positions (unit space) and forward dimensions into normals:
    // the render-time normal matrix of the part's scale then restores the true world normals.
    const positions = geometry.attributes.position as THREE.BufferAttribute;
    const normals = geometry.attributes.normal as THREE.BufferAttribute;
    const n = new THREE.Vector3();
    for (let i = 0; i < positions.count; i += 1) {
      positions.setXYZ(i, positions.getX(i) / w, positions.getY(i) / h, positions.getZ(i) / d);
      n.set(normals.getX(i) * w, normals.getY(i) * h, normals.getZ(i) * d).normalize();
      normals.setXYZ(i, n.x, n.y, n.z);
    }
    roundedBoxCache.set(key, geometry);
  }
  return geometry;
}

// ------------------------------------------------------------------------------------------------
// Vertex editing: a box hull (crisp or beveled) deformed trilinearly through its 8 corner offsets.
// Positions get the interpolated displacement; normals are transformed by the inverse-transpose of
// the displacement field's Jacobian, so a deformed SMOOTH bevel stays smooth instead of refacetting.

const deformedCache = new Map<string, THREE.BufferGeometry>();

const serializeCorners = (corners: Record<number, readonly number[]>): string =>
  Object.keys(corners)
    .map(Number)
    .sort((a, b) => a - b)
    .map((index) => `${index}:${corners[index].map((component) => Math.round(component * 1000) / 1000).join(',')}`)
    .join(';');

function deformBoxByCorners(base: THREE.BufferGeometry, corners: Record<number, readonly number[]>): THREE.BufferGeometry {
  const geometry = base.clone();
  const positions = geometry.attributes.position as THREE.BufferAttribute;
  const normals = geometry.attributes.normal as THREE.BufferAttribute;
  const entries = Object.entries(corners).map(([key, offset]) => ({ bits: Number(key), offset }));
  const jacobian = new THREE.Matrix3();
  const normalMatrix = new THREE.Matrix3();
  const n = new THREE.Vector3();
  const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const z = positions.getZ(i);
    // Trilinear parameters over the unit hull (bevel insets stay inside [0,1]).
    const u = clamp01(x + 0.5);
    const v = clamp01(y + 0.5);
    const w = clamp01(z + 0.5);
    let dx = 0, dy = 0, dz = 0;
    // Jacobian of position' = position + displacement(position); starts as identity.
    let j00 = 1, j01 = 0, j02 = 0, j10 = 0, j11 = 1, j12 = 0, j20 = 0, j21 = 0, j22 = 1;
    for (const { bits, offset } of entries) {
      const wx = bits & 1 ? u : 1 - u;
      const wy = bits & 2 ? v : 1 - v;
      const wz = bits & 4 ? w : 1 - w;
      const weight = wx * wy * wz;
      dx += offset[0] * weight;
      dy += offset[1] * weight;
      dz += offset[2] * weight;
      const gx = (bits & 1 ? 1 : -1) * wy * wz;
      const gy = (bits & 2 ? 1 : -1) * wx * wz;
      const gz = (bits & 4 ? 1 : -1) * wx * wy;
      j00 += offset[0] * gx; j01 += offset[0] * gy; j02 += offset[0] * gz;
      j10 += offset[1] * gx; j11 += offset[1] * gy; j12 += offset[1] * gz;
      j20 += offset[2] * gx; j21 += offset[2] * gy; j22 += offset[2] * gz;
    }
    positions.setXYZ(i, x + dx, y + dy, z + dz);
    jacobian.set(j00, j01, j02, j10, j11, j12, j20, j21, j22);
    if (Math.abs(jacobian.determinant()) > 1e-6) {
      n.set(normals.getX(i), normals.getY(i), normals.getZ(i));
      n.applyMatrix3(normalMatrix.copy(jacobian).invert().transpose()).normalize();
      normals.setXYZ(i, n.x, n.y, n.z);
    }
  }
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

/** The geometry a part actually renders with under a style. Always pairs with mesh scale = part.scale. */
export function getPartRenderGeometry(part: ModelPart, style?: ModelStyle): THREE.BufferGeometry {
  if (part.shape === 'mesh') return buildModelPartMeshGeometry(part.mesh ?? DEFAULT_MESH);
  if (part.shape !== 'box') return getModelPartGeometry(part.shape);
  const beveled = style?.finish === 'smooth' && style.bevel > 0.0025;
  const base = beveled ? getRoundedUnitBox(part.scale, style.bevel) : getModelPartGeometry('box');
  const corners = part.corners;
  if (!corners || !Object.keys(corners).length) return base;
  const key = `${beveled ? `r|${part.scale.map((component) => Math.round(component * 100) / 100).join(',')}|${style.bevel}` : 'box'}#${serializeCorners(corners)}`;
  let geometry = deformedCache.get(key);
  if (!geometry) {
    geometry = deformBoxByCorners(base, corners);
    deformedCache.set(key, geometry);
  }
  return geometry;
}

const renderEdgesCache = new Map<THREE.BufferGeometry, THREE.EdgesGeometry>();

/** Edge outline matching what the part ACTUALLY renders (deformation + bevel aware). */
export function getPartRenderEdges(part: ModelPart, style?: ModelStyle): THREE.EdgesGeometry {
  const geometry = getPartRenderGeometry(part, style);
  let edges = renderEdgesCache.get(geometry);
  if (!edges) {
    edges = new THREE.EdgesGeometry(geometry, 20);
    renderEdgesCache.set(geometry, edges);
  }
  return edges;
}

/** Which material group a raycast triangle belongs to — this is what face painting clicks resolve.
 *  Works for indexed and non-indexed geometry: group start/count are in index/vertex elements and
 *  triangles are sequential either way. */
export function faceGroupForFaceIndex(geometry: THREE.BufferGeometry, faceIndex: number): number {
  const groups = geometry.groups;
  if (!groups.length) return 0;
  const element = faceIndex * 3;
  for (const group of groups) {
    if (element >= group.start && element < group.start + group.count) return group.materialIndex ?? 0;
  }
  return 0;
}

const unitEdges = new Map<ModelPartShape, THREE.EdgesGeometry>();

/**
 * Shared unit edge geometry per shape — the hover/selection outlines in the Model Forge preview.
 * 20° threshold keeps boxes/wedges/cylinder rims crisp; a smooth sphere yields (correctly) almost
 * nothing, so spheres signal hover via the cursor instead.
 */
export function getModelPartEdges(shape: ModelPartShape): THREE.EdgesGeometry {
  let edges = unitEdges.get(shape);
  if (!edges) {
    edges = new THREE.EdgesGeometry(getModelPartGeometry(shape), 20);
    unitEdges.set(shape, edges);
  }
  return edges;
}

// Palette materials are shared per (color, finish, roughness) across every part and never disposed:
// the cache is bounded by the colors users actually paint with, so the whole prop system stays at a
// handful of materials regardless of scene size.
const paletteMaterials = new Map<string, THREE.Material>();

export function getStyledMaterial(color: string, style?: ModelStyle): THREE.Material {
  const finish = style?.finish ?? 'flat';
  const roughness = quantize(style?.roughness ?? (finish === 'smooth' ? 0.55 : 0.85), 0.05);
  const key = `${color}|${finish}|${roughness}`;
  let material = paletteMaterials.get(key);
  if (!material) {
    material =
      finish === 'smooth'
        ? // The Spline soft-plastic read: smooth shading plus a faint clearcoat over the flat color.
          new THREE.MeshPhysicalMaterial({ color, roughness, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.6 })
        : new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, flatShading: true });
    paletteMaterials.set(key, material);
  }
  return material;
}

const FALLBACK_COLOR = '#888888';

const slotColor = (palette: readonly string[], slot: number | undefined, fallback: number): string =>
  palette[slot ?? fallback] ?? palette[fallback] ?? FALLBACK_COLOR;

/**
 * The material (or per-group material array) for one part. Geometries with groups get one material
 * per `materialIndex`; holes in the index range (a cone has no top cap, index 1) are padded with the
 * part's base material so three.js never sees an undefined slot.
 */
export function getPartMaterials(part: ModelPart, palette: readonly string[], style?: ModelStyle): THREE.Material | THREE.Material[] {
  const base = getStyledMaterial(slotColor(palette, part.colorSlot, 0), style);
  const groups = getPartRenderGeometry(part, style).groups;
  if (!groups.length) return base;
  const materials: THREE.Material[] = [];
  const maxIndex = Math.max(...groups.map((group) => group.materialIndex ?? 0));
  for (let index = 0; index <= maxIndex; index += 1) materials.push(base);
  for (const group of groups) {
    const slot = part.faceColors?.[group.materialIndex ?? 0];
    if (slot !== undefined) materials[group.materialIndex ?? 0] = getStyledMaterial(slotColor(palette, slot, part.colorSlot), style);
  }
  return materials;
}

/**
 * Build a plain THREE.Group of the whole model — the imperative path used by GLB baking and
 * thumbnails. Fresh materials ARE shared (palette cache), geometries are the shared units; callers
 * must not dispose either.
 */
export function buildModelGroup(spec: ModelSpec): THREE.Group {
  const group = new THREE.Group();
  group.name = spec.name;
  for (const part of spec.parts) {
    const mesh = new THREE.Mesh(getPartRenderGeometry(part, spec.style), getPartMaterials(part, spec.palette, spec.style));
    mesh.name = part.name;
    mesh.position.fromArray(part.position);
    mesh.rotation.set(part.rotation[0], part.rotation[1], part.rotation[2]);
    mesh.scale.fromArray(part.scale);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

/** World-space bounds of a spec — used to frame previews and drop the model on the ground. */
export function modelSpecBounds(spec: ModelSpec): THREE.Box3 {
  const group = buildModelGroup(spec);
  return new THREE.Box3().setFromObject(group);
}

/**
 * Bake the ENTIRE model (every part, transformed by its local position/rotation/scale) into a single
 * merged triangle soup, returned in the MODEL's local space (i.e. the object's local frame before the
 * object's transform). This is the geometry a physics collider should hug: each part's true silhouette
 * — boxes, cylinders, cones, wedges and trilinearly-deformed "cornered" boxes — exactly as it renders,
 * instead of one loose bounding box around the whole prop. A hammer's head+handle, a barrel's curved
 * sides, a ramp's slope: all preserved.
 *
 * Input geometry is the shared unit shape (or the per-part deformed box), so it's transformed the same
 * way `buildModelGroup` transforms a part (translate → rotate → scale). Indices are offset so the soup
 * is a single valid mesh. Callers scale the result by the object's transform for world space, and may
 * skip the part's color — only positions matter here.
 */
export type ForgeMeshGeometry = { vertices: Float32Array; indices: Uint32Array };

export function forgeModelGeometryForSpec(spec: ModelSpec): ForgeMeshGeometry {
  const partArrays: Pick<ForgeMeshGeometry, 'vertices' | 'indices'>[] = [];
  let vertexCount = 0;
  for (const part of spec.parts) {
    const geometry = getPartRenderGeometry(part, spec.style).clone();
    geometry.rotateX(part.rotation[0]);
    geometry.rotateY(part.rotation[1]);
    geometry.rotateZ(part.rotation[2]);
    geometry.scale(Math.abs(part.scale[0]), Math.abs(part.scale[1]), Math.abs(part.scale[2]));
    geometry.translate(part.position[0], part.position[1], part.position[2]);
    const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
    const vertices = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i += 1) {
      vertices[i * 3] = pos.getX(i);
      vertices[i * 3 + 1] = pos.getY(i);
      vertices[i * 3 + 2] = pos.getZ(i);
    }
    const index = geometry.getIndex();
    let indices: Uint32Array;
    if (index) {
      indices = new Uint32Array(index.count);
      for (let i = 0; i < index.count; i += 1) indices[i] = index.getX(i) + vertexCount;
    } else {
      // Non-indexed (wedge is built non-indexed): triangles are sequential vertices.
      indices = new Uint32Array(pos.count);
      for (let i = 0; i < pos.count; i += 1) indices[i] = i + vertexCount;
    }
    partArrays.push({ vertices, indices });
    vertexCount += pos.count;
    geometry.dispose();
  }
  const totalVerts = partArrays.reduce((sum, part) => sum + part.vertices.length, 0);
  const totalIndices = partArrays.reduce((sum, part) => sum + part.indices.length, 0);
  const vertices = new Float32Array(totalVerts);
  const indices = new Uint32Array(totalIndices);
  let vCursor = 0;
  let iCursor = 0;
  for (const part of partArrays) {
    vertices.set(part.vertices, vCursor);
    vCursor += part.vertices.length;
    indices.set(part.indices, iCursor);
    iCursor += part.indices.length;
  }
  return { vertices, indices };
}
