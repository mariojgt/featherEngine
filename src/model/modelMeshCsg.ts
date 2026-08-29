import * as THREE from 'three';
import { Evaluator, Brush, ADDITION, SUBTRACTION, DIFFERENCE, type CSGOperation } from 'three-bvh-csg';
import type { ModelPartMesh, Vector3Tuple } from '../types';
import type { MeshBooleanOp } from './modelMesh';

/**
 * three.js-touching mesh-part helpers (weld + CSG). Kept apart from the pure data layer so the store
 * and modelSpec can stay renderer-free; this module is imported only when converting parts or running
 * boolean ops.
 */

/**
 * Weld a three.js triangle-soup geometry (indexed or not) into deduplicated ModelPartMesh data.
 * Positions within `epsilon` merge; the first occurrence wins. Triangle order is sequential.
 */
export function dedupeGeometryToMesh(geometry: THREE.BufferGeometry, epsilon = 1e-4): ModelPartMesh {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const count = Math.floor((index ? index.count : position.count) / 3) * 3;
  const positions: number[] = [];
  const lookup = new Map<string, number>();
  const addVertex = (source: number): number => {
    const x = position.getX(source);
    const y = position.getY(source);
    const z = position.getZ(source);
    const key = `${Math.round(x / epsilon)},${Math.round(y / epsilon)},${Math.round(z / epsilon)}`;
    let target = lookup.get(key);
    if (target === undefined) {
      target = positions.length / 3;
      lookup.set(key, target);
      positions.push(x, y, z);
    }
    return target;
  };
  const indices: number[] = [];
  for (let i = 0; i < count; i += 1) {
    indices.push(addVertex(index ? index.getX(i) : i));
  }
  const vertices: Vector3Tuple[] = [];
  for (let i = 0; i < positions.length; i += 3) {
    vertices.push([positions[i], positions[i + 1], positions[i + 2]]);
  }
  return { vertices, indices };
}

const toCSGOperation = (op: MeshBooleanOp): CSGOperation => {
  if (op === 'difference') return SUBTRACTION;
  if (op === 'intersect') return DIFFERENCE;
  return ADDITION;
};

const geometryFromMesh = (mesh: ModelPartMesh): THREE.BufferGeometry => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.vertices.flat(), 3));
  geometry.setIndex(mesh.indices);
  geometry.computeVertexNormals();
  // three-bvh-csg tracks position/uv/normal; a missing uv would crash its attribute prep.
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(mesh.vertices.length * 2), 2));
  return geometry;
};

/**
 * Boolean (CSG) of two mesh parts. The result is expressed in A's unit space: B's local vertices are
 * transformed through B's parent transform then back into A's local frame (including unit-scale), so
 * the surviving geometry keeps part A's position/rotation/scale untouched. Returns null when the CSG
 * produces nothing (an intersect that misses, a full subtract, or a failure).
 */
export function booleanMeshParts(
  a: ModelPartMesh,
  aTransform: { position: Vector3Tuple; rotation: Vector3Tuple; scale: Vector3Tuple },
  b: ModelPartMesh,
  bTransform: { position: Vector3Tuple; rotation: Vector3Tuple; scale: Vector3Tuple },
  op: MeshBooleanOp,
): ModelPartMesh | null {
  try {
    const aMatrix = new THREE.Matrix4().compose(
      new THREE.Vector3(...aTransform.position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...aTransform.rotation)),
      new THREE.Vector3(...aTransform.scale),
    );
    const bToA = new THREE.Matrix4()
      .compose(
        new THREE.Vector3(...bTransform.position),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...bTransform.rotation)),
        new THREE.Vector3(...bTransform.scale),
      )
      .multiply(aMatrix.clone().invert());
    const bUnit = new THREE.BufferGeometry();
    const moved = new Float32Array(b.vertices.length * 3);
    for (let i = 0; i < b.vertices.length; i += 1) {
      const point = new THREE.Vector3(...b.vertices[i]).applyMatrix4(bToA);
      moved.set([point.x, point.y, point.z], i * 3);
    }
    bUnit.setAttribute('position', new THREE.Float32BufferAttribute(moved, 3));
    bUnit.setIndex(b.indices);
    bUnit.computeVertexNormals();
    // Match geometryFromMesh so the evaluator's tracked attributes all resolve.
    bUnit.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(b.vertices.length * 2), 2));

    const evaluator = new Evaluator();
    const brushA = new Brush(geometryFromMesh(a), undefined);
    const brushB = new Brush(bUnit, undefined);
    const result = evaluator.evaluate(brushA, brushB, toCSGOperation(op));
    if (!result || !result.geometry) return null;
    const mesh = dedupeGeometryToMesh(result.geometry);
    if (mesh.indices.length < 3) return null;
    return mesh;
  } catch {
    return null;
  }
}

/** Whether booleanMeshParts can run in this environment. */
export const booleanMeshSupported = (): boolean => {
  try {
    return typeof Evaluator === 'function';
  } catch {
    return false;
  }
};