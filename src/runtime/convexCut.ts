import { BufferAttribute, BufferGeometry, Plane, Vector3 } from 'three';
import type { ModelGeometry } from './meshGeometryCache';

type Vertex = { p: Vector3; n: Vector3 };
const EPS = 1e-6;

/** Clip a closed convex triangle mesh against a plane, interpolating its outer normals and
 * building a new, planar cap. No prefab slices or approximate box replacements are involved. */
export function clipConvexMesh(mesh: ModelGeometry, plane: Plane): ModelGeometry | undefined {
  const positions: number[] = [], normals: number[] = [], rim = new Map<string, Vector3>();
  const vertex = (i: number): Vertex => ({
    p: new Vector3().fromArray(mesh.vertices, i * 3),
    n: mesh.normals ? new Vector3().fromArray(mesh.normals, i * 3) : new Vector3(),
  });
  const triangle = (a: Vertex, b: Vertex, c: Vertex) => {
    const cross = b.p.clone().sub(a.p).cross(c.p.clone().sub(a.p));
    if (cross.lengthSq() < 1e-16) return;
    for (const v of [a, b, c]) {
      positions.push(v.p.x, v.p.y, v.p.z);
      const n = v.n.lengthSq() ? v.n : cross.clone().normalize();
      normals.push(n.x, n.y, n.z);
    }
  };
  let inside = false, outside = false;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const input = [vertex(mesh.indices[i]), vertex(mesh.indices[i + 1]), vertex(mesh.indices[i + 2])];
    const output: Vertex[] = [];
    for (let j = 0; j < 3; j++) {
      const a = input[j], b = input[(j + 1) % 3];
      const da = plane.distanceToPoint(a.p), db = plane.distanceToPoint(b.p);
      inside ||= da < -EPS; outside ||= da > EPS;
      if (da <= EPS) output.push(a);
      if ((da < -EPS && db > EPS) || (da > EPS && db < -EPS)) {
        const t = da / (da - db);
        const p = a.p.clone().lerp(b.p, t);
        output.push({ p, n: a.n.clone().lerp(b.n, t).normalize() });
        rim.set(p.toArray().map(v => Math.round(v / EPS)).join(','), p);
      }
      if (Math.abs(da) <= EPS) rim.set(a.p.toArray().map(v => Math.round(v / EPS)).join(','), a.p);
    }
    for (let j = 1; j < output.length - 1; j++) triangle(output[0], output[j], output[j + 1]);
  }
  if (!inside || !outside || rim.size < 3) return undefined;
  const points = [...rim.values()];
  const center = points.reduce((sum, p) => sum.add(p), new Vector3()).divideScalar(points.length);
  const n = plane.normal.clone().normalize();
  const u = n.clone().cross(Math.abs(n.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0)).normalize();
  const v = n.clone().cross(u);
  points.sort((a, b) => Math.atan2(a.clone().sub(center).dot(v), a.clone().sub(center).dot(u))
    - Math.atan2(b.clone().sub(center).dot(v), b.clone().sub(center).dot(u)));
  for (let i = 0; i < points.length; i++) {
    triangle({ p: center, n }, { p: points[i], n }, { p: points[(i + 1) % points.length], n });
  }
  return { vertices: new Float32Array(positions), normals: new Float32Array(normals),
    indices: Uint32Array.from({ length: positions.length / 3 }, (_, i) => i) };
}

/** Signed tetrahedral integration gives mass and center of mass of the actual cut volume. */
export function meshMassProperties(mesh: ModelGeometry): { volume: number; center: Vector3 } {
  let volume = 0;
  const center = new Vector3();
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = new Vector3().fromArray(mesh.vertices, mesh.indices[i] * 3);
    const b = new Vector3().fromArray(mesh.vertices, mesh.indices[i + 1] * 3);
    const c = new Vector3().fromArray(mesh.vertices, mesh.indices[i + 2] * 3);
    const tetra = a.dot(b.clone().cross(c)) / 6;
    volume += tetra;
    center.add(a.add(b).add(c).multiplyScalar(tetra / 4));
  }
  return { volume: Math.abs(volume), center: Math.abs(volume) > EPS ? center.divideScalar(volume) : center };
}

export function geometryData(geometry: BufferGeometry): ModelGeometry {
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  const p = geometry.getAttribute('position') as BufferAttribute;
  const n = geometry.getAttribute('normal') as BufferAttribute;
  return { vertices: new Float32Array(p.array), normals: new Float32Array(n.array),
    indices: geometry.index ? new Uint32Array(geometry.index.array)
      : Uint32Array.from({ length: p.count }, (_, i) => i) };
}
