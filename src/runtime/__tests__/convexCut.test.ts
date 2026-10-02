import { describe, expect, it } from 'vitest';
import { BoxGeometry, Plane, Vector3 } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { clipConvexMesh, geometryData, meshMassProperties } from '../convexCut';
import type { ModelGeometry } from '../meshGeometryCache';

// Weld positions for an independent topology check; render vertices intentionally duplicate at sharp normals.
function expectClosed(mesh: ModelGeometry) {
  const edges = new Map<string, number>();
  const point = (i: number) => [...mesh.vertices.slice(i * 3, i * 3 + 3)].map(v => Math.round(v * 1e5)).join(',');
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const ids = [0, 1, 2].map(j => point(mesh.indices[i + j]));
    for (let j = 0; j < 3; j++) {
      const key = [ids[j], ids[(j + 1) % 3]].sort().join('|');
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  expect([...edges.values()].every(n => n === 2)).toBe(true);
}

describe('convex runtime cutting', () => {
  it('conserves volume, places mass centers correctly and closes both cut faces', () => {
    const mesh = geometryData(new BoxGeometry(4, 2, 2));
    const plane = new Plane(new Vector3(1, 0, 0), 0.5);
    const left = clipConvexMesh(mesh, plane)!;
    const right = clipConvexMesh(mesh, plane.clone().negate())!;
    expectClosed(left); expectClosed(right);
    expect(meshMassProperties(left).volume).toBeCloseTo(6, 6);
    expect(meshMassProperties(right).volume).toBeCloseTo(10, 6);
    expect(meshMassProperties(left).center.x).toBeCloseTo(-1.25, 6);
    expect(meshMassProperties(right).center.x).toBeCloseTo(0.75, 6);
  });

  it('cuts rounded geometry at arbitrary angles and can cut the resulting solid again', () => {
    const mesh = geometryData(new RoundedBoxGeometry(4, 2, 2, 3, 0.15));
    const plane = new Plane(new Vector3(1, 0.17, -0.21).normalize(), 0.2);
    const a = clipConvexMesh(mesh, plane)!;
    const b = clipConvexMesh(mesh, plane.clone().negate())!;
    expectClosed(a); expectClosed(b);
    expect(meshMassProperties(a).volume + meshMassProperties(b).volume).toBeCloseTo(meshMassProperties(mesh).volume, 4);
    const c = clipConvexMesh(b, new Plane(new Vector3(-1, 0, 0), 0.9))!;
    expectClosed(c);
    expect(meshMassProperties(c).volume).toBeLessThan(meshMassProperties(b).volume);
    expect(clipConvexMesh(mesh, new Plane(new Vector3(1, 0, 0), 10))).toBeUndefined();
  });
});
