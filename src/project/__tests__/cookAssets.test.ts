// @vitest-environment node
import { expect, it } from 'vitest';
import { blankProject } from '../serialize';
import { buildGameBundle, readGameBundle } from '../exportGame';
import { cookGameAssets, externalizeGameAssets, bytesDataUrl, type CookAssetResult } from '../cookAssets';
import { modelFixture } from '../../three/__tests__/modelFixture';

it('reuses exact asset variants, invalidates changed bytes and targets, and loads the exported file manifest', async () => {
  const project = blankProject('Cook test');
  project.assets = [{ id: 'prop', name: 'prop.glb', type: 'model', size: 0, createdAt: 1, data: bytesDataUrl(await modelFixture(), 'model/gltf-binary') }];
  const original = buildGameBundle(project), cache = new Map<string, CookAssetResult>();
  const services = { cache: { get: async (key: string) => cache.get(key) ?? null, put: async (key: string, value: CookAssetResult) => { cache.set(key, value); } } };
  const first = await cookGameAssets(original, 'web', services);
  expect(first.report.prepared).toBe(1);
  expect((await cookGameAssets(original, 'web', services)).report.cacheHits).toBe(1);
  expect((await cookGameAssets(original, 'windows', services)).report.cacheHits).toBe(0);
  const changed = structuredClone(original); changed.project.assets[0].data = bytesDataUrl(await modelFixture(true), 'model/gltf-binary');
  expect((await cookGameAssets(changed, 'web', services)).report.cacheHits).toBe(0);
  const delivered = externalizeGameAssets(first.bundle);
  expect(delivered.files.size).toBe(1); expect(delivered.bundle.project.assets[0].data).toBeUndefined();
  const loaded = readGameBundle(delivered.bundle);
  expect(loaded.project.assets[0].url).toMatch(/^\.\/game-assets\/[a-f0-9]{64}\.glb$/);
  expect(loaded.runtimeContract.requiredFeatures).toContain('streamed-assets');
  expect(original.project.assets[0].data).toBe(project.assets[0].data);
  const tampered = structuredClone(delivered.bundle); tampered.project.assets[0].delivery!.path = '../outside.glb';
  expect(() => readGameBundle(tampered)).toThrow('Invalid exported asset path');
});

it('rebuilds corrupt cache bytes rather than shipping them', async () => {
  const project = blankProject('Cache test'); project.assets = [{ id: 'model', name: 'test.glb', type: 'model', size: 3, createdAt: 1, data: bytesDataUrl(await modelFixture(), 'model/gltf-binary') }];
  const bundle = buildGameBundle(project), entries = new Map<string, CookAssetResult>();
  const services = { cache: { get: async (key: string) => entries.get(key) ?? null, put: async (key: string, value: CookAssetResult) => { entries.set(key, value); } } };
  await cookGameAssets(bundle, 'web', services); entries.values().next().value!.bytes = new Uint8Array([0, 1, 2]);
  const cooked = await cookGameAssets(bundle, 'web', services); expect(cooked.report.cacheHits).toBe(0); expect(cooked.report.prepared).toBe(1);
});

it('rebuilds prepared detail after texture processing renumbers model accessors', async () => {
  const { prepareGlbGeometry } = await import('../../three/prepareGeometry');
  const { WebIO } = await import('@gltf-transform/core');
  const prepared = await prepareGlbGeometry(await modelFixture(), 'desktop');
  const project = blankProject('Reprocess'); project.assets = [{ id: 'model', name: 'test.glb', type: 'model', size: prepared.bytes.length, createdAt: 1, data: bytesDataUrl(prepared.bytes, 'model/gltf-binary') }];
  const bundle = buildGameBundle(project); bundle.buildProfile.optimization = { geometry: true, textures: true, streamAssets: true };
  let processed = false;
  const result = await cookGameAssets(bundle, 'web', { textures: async (bytes) => {
    const io = new WebIO(), doc = await io.readBinary(bytes); processed = true;
    return io.writeBinary(doc);
  } });
  expect(processed).toBe(true); expect(result.report.prepared).toBe(1);
  expect(result.report.assets[0].trianglesLod2).toBeLessThan(result.report.assets[0].trianglesBefore);
  expect(result.report.assets[0].warnings).toEqual([]);
});
