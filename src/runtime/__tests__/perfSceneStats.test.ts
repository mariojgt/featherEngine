import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { countSceneStats, type CountableNode } from '../perfStats';

/**
 * These are the scene costs renderer.info cannot report. They explain a slow frame when the draw-call
 * count looks reasonable: every shadow-casting light adds a whole extra pass over every shadow caster,
 * so the two numbers multiplied are usually the answer.
 */
describe('countSceneStats', () => {
  it('counts nothing for an empty or missing root', () => {
    expect(countSceneStats(undefined)).toEqual({ lights: 0, shadowLights: 0, shadowCasters: 0, skinned: 0 });
    expect(countSceneStats({ children: [] })).toEqual({ lights: 0, shadowLights: 0, shadowCasters: 0, skinned: 0 });
  });

  it('counts lights and separates the ones that cast shadows', () => {
    const root: CountableNode = {
      children: [
        { isLight: true, castShadow: true },
        { isLight: true, castShadow: false },
        { isLight: true },
      ],
    };
    expect(countSceneStats(root)).toMatchObject({ lights: 3, shadowLights: 1 });
  });

  it('counts shadow-casting meshes and skinned meshes', () => {
    const root: CountableNode = {
      children: [
        { isMesh: true, castShadow: true },
        { isMesh: true, castShadow: true, isSkinnedMesh: true },
        { isMesh: true, castShadow: false, isSkinnedMesh: true },
        { isMesh: true },
      ],
    };
    expect(countSceneStats(root)).toMatchObject({ shadowCasters: 2, skinned: 2 });
  });

  it('descends the whole hierarchy, not just direct children', () => {
    const root: CountableNode = {
      children: [{ children: [{ children: [{ isLight: true, castShadow: true }, { isMesh: true, castShadow: true }] }] }],
    };
    expect(countSceneStats(root)).toMatchObject({ lights: 1, shadowLights: 1, shadowCasters: 1 });
  });

  // three does not render an invisible subtree, so counting it would overstate the cost and send
  // someone optimizing geometry that never reaches the GPU.
  it('skips invisible subtrees', () => {
    const root: CountableNode = {
      children: [
        { visible: false, children: [{ isMesh: true, castShadow: true }, { isLight: true, castShadow: true }] },
        { visible: true, isMesh: true, castShadow: true },
      ],
    };
    expect(countSceneStats(root)).toEqual({ lights: 0, shadowLights: 0, shadowCasters: 1, skinned: 0 });
  });

  it('does not double-count a light as a mesh', () => {
    expect(countSceneStats({ children: [{ isLight: true, castShadow: true, isMesh: true }] })).toMatchObject({
      lights: 1,
      shadowCasters: 0,
    });
  });

  // The shape is duck-typed against three's flags, so pin it against a real scene graph: if three ever
  // renamed isSkinnedMesh or stopped setting isLight, the counters would silently read zero.
  it('reads a real three scene graph', () => {
    const scene = new THREE.Scene();
    const light = new THREE.DirectionalLight();
    light.castShadow = true;
    scene.add(light);
    scene.add(new THREE.AmbientLight());

    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    mesh.castShadow = true;
    scene.add(mesh);

    const skinned = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    skinned.castShadow = true;
    scene.add(skinned);

    const hidden = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    hidden.castShadow = true;
    hidden.visible = false;
    scene.add(hidden);

    expect(countSceneStats(scene as unknown as CountableNode)).toEqual({
      lights: 2,
      shadowLights: 1,
      shadowCasters: 2,
      skinned: 1,
    });
  });
});
