import { Box3, BufferAttribute, BufferGeometry, Matrix3, Matrix4, Plane, Vector3 } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { SceneObject, Vector3Tuple } from '../types';
import { worldMatrixOf } from '../utils/transformHierarchy';
import { clipConvexMesh, geometryData, meshMassProperties } from './convexCut';
import { getModelGeometry, registerRawGeometry, removeRawGeometry, type ModelGeometry } from './meshGeometryCache';

type PendingCut = { pieceId: string; bladeId: string; bottom: number; up: Vector3; plane: Plane; kerf: number };
type Stock = { original: SceneObject; cycle: number; serial: number; keys: Set<string>; pending?: PendingCut };
const stocks = new Map<string, Stock>();
const previousBlades = new Map<string, Matrix4>();

function releasePart(piece: SceneObject, sourceId: string, velocities: Record<string, Vector3Tuple>, spins: Record<string, Vector3Tuple>): SceneObject {
  return { ...piece, physics: { ...piece.physics!, bodyType: 'dynamic' },
    variables: { ...piece.variables, __cutReleased: true,
      __initialVelocity: velocities[sourceId] ?? [0, 0, 0],
      __initialAngularVelocity: spins[sourceId] ?? [0, 0, 0] } };
}

export function clearMeshCutting(): void {
  for (const stock of stocks.values()) for (const key of stock.keys) removeRawGeometry(key);
  stocks.clear(); previousBlades.clear();
}

function worldMesh(object: SceneObject, matrix: Matrix4): ModelGeometry | undefined {
  const cached = getModelGeometry(object.renderer?.fragmentKey ?? object.renderer?.modelAssetId);
  let data = cached;
  if (!data && object.renderer?.mesh === 'cube') {
    const geometry = new RoundedBoxGeometry(1, 1, 1, 3, 0.08);
    data = geometryData(geometry); geometry.dispose();
  }
  if (!data) return undefined;
  if (!data.normals) {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(data.vertices, 3));
    geometry.setIndex(new BufferAttribute(data.indices, 1));
    data = geometryData(geometry); geometry.dispose();
  }
  const vertices = new Float32Array(data.vertices.length), normals = new Float32Array(data.vertices.length);
  const normalMatrix = new Matrix3().getNormalMatrix(matrix);
  const p = new Vector3(), n = new Vector3();
  for (let i = 0; i < vertices.length; i += 3) {
    p.fromArray(data.vertices, i).applyMatrix4(matrix).toArray(vertices, i);
    n.fromArray(data.normals!, i).applyMatrix3(normalMatrix).normalize().toArray(normals, i);
  }
  return { vertices, normals, indices: data.indices };
}

function makePart(source: SceneObject, mesh: ModelGeometry, id: string, key: string, mass: number): SceneObject {
  const { center } = meshMassProperties(mesh);
  const bounds = new Box3().setFromBufferAttribute(new BufferAttribute(mesh.vertices, 3));
  const size = bounds.getSize(new Vector3()).max(new Vector3(0.001, 0.001, 0.001));
  const vertices = new Float32Array(mesh.vertices.length), normals = new Float32Array(mesh.vertices.length);
  for (let i = 0; i < vertices.length; i += 3) {
    new Vector3().fromArray(mesh.vertices, i).sub(center).divide(size).toArray(vertices, i);
    new Vector3().fromArray(mesh.normals!, i).multiply(size).normalize().toArray(normals, i);
  }
  registerRawGeometry(key, vertices, mesh.indices, normals);
  return { ...source, id, parentId: undefined,
    transform: { position: center.toArray() as Vector3Tuple, rotation: [0, 0, 0], scale: size.toArray() as Vector3Tuple },
    renderer: { ...source.renderer!, fragmentKey: key, modelAssetId: key },
    physics: { ...source.physics!, enabled: true, collider: 'convex', mass: Math.max(0.001, mass), ccd: true } };
}

/** Mechanical blade motion may be authored; piece motion never is. Geometry is split when a
 * descending edge intersects stock, and the resulting solid is released only at full penetration.
 * This is convex rigid-body cutting, not a soft-body/plastic-deformation solver. */
export function updateMeshCutting(objects: SceneObject[], time: number, delta: number,
  velocities: Record<string, Vector3Tuple> = {}, spins: Record<string, Vector3Tuple> = {}): SceneObject[] {
  const enabledStocks = objects.filter(o => o.cutting?.enabled && o.cutting.role === 'stock'
    && o.physics?.enabled && o.physics.bodyType === 'fixed');
  const blades = objects.filter(o => o.cutting?.enabled && o.cutting.role === 'blade' && o.physics?.enabled);
  if (!enabledStocks.length && !stocks.size) return objects;
  let result = objects;
  for (const initial of enabledStocks) {
    let stock = stocks.get(initial.id);
    if (!stock) {
      stock = { original: structuredClone(initial), cycle: 0, serial: 0, keys: new Set() };
      stocks.set(initial.id, stock);
    }
    const repeat = stock.original.cutting?.repeatSeconds ?? 0;
    const cycle = repeat > 0 ? Math.floor((time + 1e-8) / repeat) : 0;
    if (cycle !== stock.cycle) {
      result = result.filter(o => o.variables?.__cutStock !== initial.id)
        .map(o => o.id === initial.id ? structuredClone(stock!.original) : o);
      for (const key of stock.keys) removeRawGeometry(key);
      stock.keys.clear(); stock.pending = undefined; stock.serial = 0; stock.cycle = cycle;
    }
    if (delta <= 0) continue;
    if (stock.pending) {
      const pending = stock.pending;
      const blade = blades.find(o => o.id === pending.bladeId);
      if (blade) {
        const byId = new Map(result.map(o => [o.id, o]));
        const matrix = worldMatrixOf(byId, blade.id);
        const edge = new Vector3(0, -0.5, 0).applyMatrix4(matrix);
        const origin = new Vector3().setFromMatrixPosition(matrix);
        // A withdrawn or laterally displaced blade cannot finish a different cut.
        if (edge.dot(pending.up) <= pending.bottom + 0.002
          && Math.abs(pending.plane.distanceToPoint(origin)) < pending.kerf * 1.5) {
          result = result.map(o => o.id === pending.pieceId ? releasePart(o, initial.id, velocities, spins) : o);
          stock.pending = undefined;
        }
      }
      continue;
    }
    for (const blade of blades) {
      const previous = previousBlades.get(blade.id);
      if (!previous) continue;
      const source = result.find(o => o.id === initial.id)!;
      const byId = new Map(result.map(o => [o.id, o]));
      const matrix = worldMatrixOf(byId, blade.id), sourceMatrix = worldMatrixOf(byId, source.id);
      const up = new Vector3(0, 1, 0).transformDirection(matrix);
      const origin = new Vector3().setFromMatrixPosition(matrix);
      if (origin.clone().sub(new Vector3().setFromMatrixPosition(previous)).dot(up) >= -1e-6) continue;
      const mesh = worldMesh(source, sourceMatrix);
      if (!mesh) continue;
      const inverse = matrix.clone().invert(), prevInverse = previous.clone().invert();
      const bounds = new Box3(), prevBounds = new Box3();
      let bottom = Infinity;
      for (let i = 0; i < mesh.vertices.length; i += 3) {
        const p = new Vector3().fromArray(mesh.vertices, i);
        bottom = Math.min(bottom, p.dot(up));
        bounds.expandByPoint(p.clone().applyMatrix4(inverse));
        prevBounds.expandByPoint(p.applyMatrix4(prevInverse));
      }
      // Swept edge crosses the top; blade must span the depth and actually straddle the solid.
      if (prevBounds.max.y > -0.5 + 1e-5 || bounds.max.y < -0.5
        || bounds.min.x >= -0.51 || bounds.max.x <= 0.51
        || bounds.min.z < -0.51 || bounds.max.z > 0.51) continue;
      const normal = new Vector3(1, 0, 0).transformDirection(matrix);
      const plane = new Plane().setFromNormalAndCoplanarPoint(normal, origin);
      const kerf = Math.max(0.001, blade.cutting?.kerf ?? new Vector3().setFromMatrixColumn(matrix, 0).length());
      const left = clipConvexMesh(mesh, new Plane(normal.clone(), plane.constant + kerf / 2));
      const right = clipConvexMesh(mesh, new Plane(normal.clone().negate(), -plane.constant + kerf / 2));
      if (!left || !right) continue;
      const volume = meshMassProperties(mesh).volume;
      const leftVolume = meshMassProperties(left).volume, rightVolume = meshMassProperties(right).volume;
      if (leftVolume < 0.015 || rightVolume < 0.015) continue;
      const count = ++stock.serial;
      const leftKey = `cut:${source.id}:${stock.cycle}:${count}:left`;
      const rightKey = `cut:${source.id}:${stock.cycle}:${count}:right`;
      const mass = source.physics!.mass;
      let part = makePart(source, left, `${source.id}-slice-${count}`, leftKey, mass * leftVolume / volume);
      part.name = `Cut piece ${String(count).padStart(2, '0')}`;
      part.cutting = undefined;
      part.variables = { ...part.variables, __cutStock: source.id, __cutReleased: false };
      const remainder = makePart(source, right, source.id, rightKey, mass * rightVolume / volume);
      remainder.variables = { ...remainder.variables, cuts: count };
      const oldKey = source.renderer?.fragmentKey;
      if (oldKey && stock.keys.delete(oldKey)) removeRawGeometry(oldKey);
      stock.keys.add(leftKey); stock.keys.add(rightKey);
      // A swept step can cross the entire solid at once; don't require an extra low frame to release.
      if (new Vector3(0, -0.5, 0).applyMatrix4(matrix).dot(up) <= bottom + 0.002) {
        part = releasePart(part, source.id, velocities, spins);
      } else stock.pending = { pieceId: part.id, bladeId: blade.id, bottom, up, plane, kerf };
      result = result.map(o => o.id === source.id ? remainder : o).concat(part);
      break;
    }
  }
  const byId = new Map(result.map(o => [o.id, o]));
  for (const blade of blades) previousBlades.set(blade.id, worldMatrixOf(byId, blade.id));
  return result;
}
