import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  authoredTreeMetadata,
  authoredTreePlacementHash,
  authoredTreeWindMargin,
  patchThinLeafLightingShader,
  partitionAuthoredTreePlacements,
  selectAuthoredTreeLod,
} from './AuthoredTrees';

describe('authored tree library helpers', () => {
  it('inherits variant, LOD and height extras through loader-created primitive children', () => {
    const root = new THREE.Group();
    root.userData.featherTreeVariant = 1;
    root.userData.featherTreeHeight = 8.5;
    const lod = new THREE.Group();
    lod.userData.featherTreeLod = 2;
    const primitive = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial());
    root.add(lod);
    lod.add(primitive);

    expect(authoredTreeMetadata(primitive)).toEqual({ variant: 1, lod: 2, height: 8.5 });
    lod.userData.featherTreeLod = 3;
    expect(authoredTreeMetadata(primitive)).toBeNull();
    lod.userData.featherTreeLod = 2;
    root.userData.featherTreeVariant = 17;
    expect(authoredTreeMetadata(primitive)?.variant).toBe(17);
    root.userData.featherTreeVariant = -1;
    expect(authoredTreeMetadata(primitive)).toBeNull();
  });

  it('selects scale- and quality-aware LODs with hysteresis', () => {
    expect(selectAuthoredTreeLod(18, 8, 1, 'High', 2)).toBe(0);
    expect(selectAuthoredTreeLod(50, 8, 1, 'High', 0)).toBe(1);
    expect(selectAuthoredTreeLod(110, 8, 1, 'High', 1)).toBe(2);
    // 25 is beyond the nominal 24-unit boundary but remains LOD0 inside its outward dead band.
    expect(selectAuthoredTreeLod(25, 8, 1, 'High', 0)).toBe(0);
    expect(selectAuthoredTreeLod(25, 8, 1, 'High', 1)).toBe(1);
    expect(selectAuthoredTreeLod(50, 8, 2, 'High', 0)).toBe(0);
    expect(selectAuthoredTreeLod(35, 8, 1, 'Low', 0)).toBe(1);
    expect(selectAuthoredTreeLod(19, 100, 1, 'High', 0, [10, 20])).toBe(1);
    expect(selectAuthoredTreeLod(23, 100, 1, 'High', 1, [10, 20])).toBe(2);
  });

  it('keeps variants deterministic while partitioning with parent transforms', () => {
    const a = new THREE.Matrix4().makeTranslation(2, 0, 0);
    const b = new THREE.Matrix4().compose(
      new THREE.Vector3(30, 0, 0),
      new THREE.Quaternion(),
      new THREE.Vector3(2, 2, 2),
    );
    const variants = [0, 1];
    const heights = new Map([[0, 8], [1, 8]]);
    const parent = new THREE.Matrix4().makeTranslation(100, 0, 0);
    const result = partitionAuthoredTreePlacements(
      [a, b], variants, heights, new THREE.Vector3(100, 0, 0), parent, 'High',
    );

    expect(result[0].lod).toBe(0);
    expect(result[1].lod).toBe(0); // its 2x authored scale extends the LOD0 range
    expect(result[0].variant).toBe(variants[authoredTreePlacementHash(a) % variants.length]);
    expect(partitionAuthoredTreePlacements(
      [b, a], variants, heights, new THREE.Vector3(100, 0, 0), parent, 'High',
    ).find((item) => item.matrix === a)?.variant).toBe(result[0].variant);
  });

  it('reserves nonzero bounds headroom for the shader maximum', () => {
    expect(authoredTreeWindMargin(0)).toBe(0);
    expect(authoredTreeWindMargin(10)).toBeGreaterThan(0.7);
  });

  it('culls a world-space fade range after transformed-root wind padding', () => {
    const insidePadding = new THREE.Matrix4().makeTranslation(10.5, 0, 0);
    const outsidePadding = new THREE.Matrix4().makeTranslation(12, 0, 0);
    const parent = new THREE.Matrix4().makeTranslation(100, 0, 0);
    const result = partitionAuthoredTreePlacements(
      [insidePadding, outsidePadding],
      [7],
      new Map([[7, 10]]),
      new THREE.Vector3(100, 0, 0),
      parent,
      'High',
      new Map(),
      undefined,
      [8, 10],
    );

    expect(result.map((item) => item.matrix)).toEqual([insidePadding]);
  });

  it('injects leaf response into shadow-attenuated direct light rather than emission', () => {
    const shader = {
      fragmentShader: '#include <lights_physical_pars_fragment>\n#include <lights_fragment_begin>',
      vertexShader: '',
      uniforms: {},
    } as unknown as Parameters<typeof patchThinLeafLightingShader>[0];
    patchThinLeafLightingShader(shader);

    expect(shader.fragmentShader).toContain('nfThinLeafDirect');
    expect(shader.fragmentShader).toContain('directLight.color');
    expect(shader.fragmentShader).not.toContain('Emissive');
  });
});
