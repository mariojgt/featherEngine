// @vitest-environment node
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { modelFixture } from './modelFixture';
import { GLTFLoader } from 'three-stdlib';
import { prepareGlbGeometry } from '../prepareGeometry';
import { preparedLodPlugin } from '../preparedLodLoader';
import { isLodCandidate, preparedLodErrors, getLodGeometry, setLodGenBudget } from '../meshLodCache';
import { selectPreparedLod } from '../lodSelection';
import { splitInstanceCells } from '../modelInstancing';
import type { SceneObject } from '../../types';


describe('prepared geometry', () => {
  it('loads prepared GLB levels through the real runtime loader, retaining full geometry and transforms', async () => {
    const input = await modelFixture(), prepared = await prepareGlbGeometry(input, 'web');
    expect(prepared.meshes).toBe(1); expect(prepared.trianglesLod1).toBeLessThan(prepared.trianglesBefore);
    const loader = new GLTFLoader().register(preparedLodPlugin);
    const model = await loader.parseAsync(prepared.bytes.slice().buffer, '');
    const mesh = model.scene.children[0] as THREE.Mesh;
    expect(mesh.position.toArray()).toEqual([2, 3, 4]); expect(model.asset.copyright).toBe('Fixture author');
    expect(preparedLodErrors(mesh.geometry)).toHaveLength(2);
    setLodGenBudget(0);
    expect(getLodGeometry(mesh.geometry, 1)!.index!.count / 3).toBe(prepared.trianglesLod1);
    expect(getLodGeometry(mesh.geometry, 2)!.index!.count / 3).toBe(prepared.trianglesLod2);
    expect(mesh.geometry.index!.count / 3).toBe(prepared.trianglesBefore);
    mesh.geometry.dispose(); expect(preparedLodErrors(mesh.geometry)).toBeUndefined();
  });
  it('reuses identical preparation and creates a different target variant while retaining rigged geometry', async () => {
    const input = await modelFixture(), desktop = await prepareGlbGeometry(input, 'desktop');
    expect((await prepareGlbGeometry(desktop.bytes, 'desktop')).bytes).toEqual(desktop.bytes);
    const mobile = await prepareGlbGeometry(input, 'mobile');
    expect(mobile.trianglesLod2).toBeLessThanOrEqual(desktop.trianglesLod2);
    const skin = await modelFixture(true); expect((await prepareGlbGeometry(skin, 'web')).bytes).toEqual(skin);
  });
  it('keeps morph geometry out of runtime simplification', () => {
    const geometry = new THREE.SphereGeometry(1, 48, 32);
    expect(isLodCandidate(geometry)).toBe(true);
    geometry.morphAttributes.position = [geometry.attributes.position.clone()];
    expect(isLodCandidate(geometry)).toBe(false); geometry.dispose();
  });
  it('selects detail by projected error with hysteresis', () => {
    expect(selectPreparedLod([0.01, 0.03], 1000, 'High')).toBe(0);
    expect(selectPreparedLod([0.01, 0.03], 50, 'High')).toBe(1);
    expect(selectPreparedLod([0.01, 0.03], 10, 'High')).toBe(2);
    expect(selectPreparedLod([0.01, 0.03], 100, 'High', 1)).toBe(1);
    expect(selectPreparedLod([0.01, 0.03], 100, 'High', 0)).toBe(0);
  });
  it('keeps distant instance cells independently cullable', () => {
    const objects = [[0, 0, 0], [1, 0, 0], [1000, 0, 0], [-1, 0, 0]].map((position, i) => ({ id: String(i), transform: { position } } as SceneObject));
    const cells = splitInstanceCells(objects);
    expect(cells.size).toBe(3); expect(cells.get('0,0,0')?.map((object) => object.id)).toEqual(['0', '1']);
  });
});
