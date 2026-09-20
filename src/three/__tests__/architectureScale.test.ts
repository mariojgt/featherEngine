import { expect, it } from 'vitest';
import * as THREE from 'three';
import { extractInstanceSubmeshes, normalizeModelScale } from '../ModelAsset';

it('preserves marked architectural metres in ordinary and instanced rendering while retaining legacy repair', () => {
  const root = new THREE.Group(), geometry = new THREE.BoxGeometry(24, 34, 18), material = new THREE.MeshStandardMaterial();
  root.add(new THREE.Mesh(geometry, material));
  const bounds = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());
  expect(bounds(normalizeModelScale(root.clone(true))).y).toBeCloseTo(1);
  root.userData.featherPreserveScale = true;
  expect(normalizeModelScale(root)).toBe(root);
  expect(bounds(root).y).toBe(34);
  const submeshes = extractInstanceSubmeshes(root, 1);
  expect(submeshes).toHaveLength(1);
  const box = new THREE.Box3().setFromBufferAttribute(submeshes[0].geometry.attributes.position as THREE.BufferAttribute).applyMatrix4(submeshes[0].localMatrix);
  expect(box.getSize(new THREE.Vector3()).y).toBe(34);
  geometry.dispose(); material.dispose();
});
