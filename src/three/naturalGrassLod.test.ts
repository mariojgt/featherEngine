import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { NATURAL_GRASS_GEOMETRY } from '../terrain/naturalGrassGeometry';
import {
  createNaturalGrassBladeSubset,
  naturalGrassPlacementKey,
  partitionNaturalGrassPlacements,
  selectNaturalGrassDetail,
} from './naturalGrassLod';

describe('natural grass detail helpers', () => {
  it('uses hysteresis around quality-scaled detail boundaries', () => {
    expect(selectNaturalGrassDetail(5, 'High', 2)).toBe(0);
    expect(selectNaturalGrassDetail(19, 'High', 0)).toBe(0);
    expect(selectNaturalGrassDetail(21, 'High', 0)).toBe(1);
    expect(selectNaturalGrassDetail(40, 'Low', 0)).toBe(2);
  });

  it('keeps surviving blades byte-for-byte identical across detail tiers', () => {
    const medium = createNaturalGrassBladeSubset(NATURAL_GRASS_GEOMETRY, 2);
    const subset = createNaturalGrassBladeSubset(NATURAL_GRASS_GEOMETRY, 4);
    const sourceIndex = NATURAL_GRASS_GEOMETRY.getIndex()!;
    const subsetIndex = subset.getIndex()!;
    const sourceCost = NATURAL_GRASS_GEOMETRY.userData.naturalGrass as { blades: number; triangles: number };
    const indicesPerBlade = sourceCost.triangles / sourceCost.blades * 3;
    const mediumIndices = new Set(Array.from({ length: medium.getIndex()!.count }, (_, index) => medium.getIndex()!.getX(index)));

    expect(subset.getAttribute('position')).toBe(NATURAL_GRASS_GEOMETRY.getAttribute('position'));
    expect(subsetIndex.count).toBe(indicesPerBlade * 6);
    for (let index = 0; index < subsetIndex.count; index += 1) expect(mediumIndices.has(subsetIndex.getX(index))).toBe(true);
    for (let index = 0; index < indicesPerBlade; index += 1) {
      expect(subsetIndex.getX(index)).toBe(sourceIndex.getX(index));
      expect(subsetIndex.getX(indicesPerBlade + index)).toBe(sourceIndex.getX(indicesPerBlade * 4 + index));
    }
  });

  it('partitions by transformed world roots and culls beyond fade padding', () => {
    const near = new THREE.Matrix4().makeTranslation(2, 0, 0);
    const edge = new THREE.Matrix4().makeTranslation(50.5, 0, 0);
    const outside = new THREE.Matrix4().makeTranslation(52, 0, 0);
    const parent = new THREE.Matrix4().makeTranslation(100, 0, 0);
    const result = partitionNaturalGrassPlacements(
      [near, edge, outside],
      new THREE.Vector3(100, 0, 0),
      parent,
      'High',
      new Map(),
      50,
      undefined,
      0.5,
      1,
    );

    expect(result.map((item) => item.matrix)).toEqual([near, edge]);
    expect(result[0].detail).toBe(0);
    expect(result[0].key).toBe(naturalGrassPlacementKey(near));
  });

  it('drops individual patches outside the viewing frustum with radius padding', () => {
    const frustum = new THREE.Frustum(
      new THREE.Plane(new THREE.Vector3(1, 0, 0), 5),
      new THREE.Plane(new THREE.Vector3(-1, 0, 0), 5),
      new THREE.Plane(new THREE.Vector3(0, 1, 0), 5),
      new THREE.Plane(new THREE.Vector3(0, -1, 0), 5),
      new THREE.Plane(new THREE.Vector3(0, 0, 1), 5),
      new THREE.Plane(new THREE.Vector3(0, 0, -1), 5),
    );
    const visible = new THREE.Matrix4().makeTranslation(0, 0, 0);
    const hidden = new THREE.Matrix4().makeTranslation(8, 0, 0);

    expect(partitionNaturalGrassPlacements(
      [visible, hidden],
      new THREE.Vector3(),
      new THREE.Matrix4(),
      'High',
      new Map(),
      undefined,
      frustum,
      0.5,
      0.5,
    ).map((item) => item.matrix)).toEqual([visible]);
  });
});
