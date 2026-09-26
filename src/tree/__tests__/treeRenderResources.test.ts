import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { treeSpecFromArchetype } from '../treeSpec';
import {
  acquireTreeGeometry,
  selectTreeLod,
  batchTreePlacements,
  clearUnusedTreeGeometryCache,
  releaseTreeGeometry,
  treeGeometryCacheStats,
  treePlacementVariant,
} from '../../three/treeRenderResources';

afterEach(() => clearUnusedTreeGeometryCache());

const matrix = (x: number, z: number, yaw = 0) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(x, 0, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)),
    new THREE.Vector3(1, 1, 1),
  );

describe('tree render resources', () => {
  it('holds detail inside the hysteresis band and accounts for size and quality', () => {
    const spec = treeSpecFromArchetype('broadleaf', 'lod-test');
    spec.lod = { levels: 2, distances: [50, 120], billboardDistance: 0 };
    expect(selectTreeLod(55, spec, 0)).toBe(0);
    expect(selectTreeLod(57, spec, 0)).toBe(1);
    expect(selectTreeLod(45, spec, 1)).toBe(1);
    expect(selectTreeLod(43, spec, 1)).toBe(0);
    expect(selectTreeLod(100, spec, 0, 2)).toBe(0);
    expect(selectTreeLod(100, spec, 0, 1, 0.65)).toBe(2);
  });

  it('assigns stable variants and spatial batches independent of input ordering', () => {
    const placements = [matrix(2, 3), matrix(40, 2, 0.5), matrix(-12, 70, 1.2), matrix(3, 4, 2)];
    const before = new Map(placements.map((placement) => [placement, treePlacementVariant(placement, 4)]));
    const reversed = [...placements].reverse();
    expect(reversed.map((placement) => treePlacementVariant(placement, 4))).toEqual(
      reversed.map((placement) => before.get(placement)),
    );
    expect(batchTreePlacements(placements, 4).map((batch) => batch.key)).toEqual(
      batchTreePlacements(reversed, 4).map((batch) => batch.key),
    );
  });

  it('shares identical geometry leases, expands deformation bounds, and disposes after release', () => {
    const spec = treeSpecFromArchetype('snag', 'cache-test');
    const first = acquireTreeGeometry(spec, 7);
    const second = acquireTreeGeometry(spec, 7);
    expect(second.tree).toBe(first.tree);
    expect(treeGeometryCacheStats().referenced).toBe(1);
    const raw = first.tree.bark.getAttribute('position');
    let rawMaxX = -Infinity;
    for (let index = 0; index < raw.count; index += 1) rawMaxX = Math.max(rawMaxX, raw.getX(index));
    expect(first.tree.bark.boundingBox!.max.x).toBeGreaterThan(rawMaxX);

    const dispose = vi.spyOn(first.tree.bark, 'dispose');
    releaseTreeGeometry(first);
    releaseTreeGeometry(second);
    expect(clearUnusedTreeGeometryCache()).toBe(1);
    expect(dispose).toHaveBeenCalledOnce();
  });
});
