import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { defaultTitanSettings, titanReleaseConfig } from '../settings';
import { configuredServerFiles } from '../serverPackage';
import { TITAN_SETTINGS } from '../settings';
import { emberMeadowContent } from '../starter';
import { blankProject } from '../../project/serialize';
import { buildGameBundle, readGameBundle } from '../../project/exportGame';
import { buildWebArchive } from '../../project/browserBuild';
import { verifyGameBundle } from '../../project/verifyBundle';
import { sha256Hex } from '../../utils/contentHash';

const online = { ...defaultTitanSettings, publishMode: 'online' as const, realmUrl: 'https://realm.example.test', gameOrigin: 'https://play.example.test', baseUrl: 'https://api.example.test', gameKey: 'example-game-key' };
afterEach(() => vi.unstubAllGlobals());
beforeAll(() => execFileSync(process.execPath, ['scripts/build-titan-runtime.mjs']));
describe('Titan production configuration', () => {
  it('requires hosted connections and an exact web origin, while solo needs no server', () => {
    expect(titanReleaseConfig(defaultTitanSettings, 'com.example.game', true)).toBeUndefined();
    expect(() => titanReleaseConfig({ ...online, realmUrl: 'http://127.0.0.1:8787' }, 'com.example.game', true)).toThrow('hosted HTTPS realm');
    expect(() => titanReleaseConfig({ ...online, baseUrl: 'http://localhost:54321' }, 'com.example.game', true)).toThrow('hosted HTTPS Titan');
    expect(() => titanReleaseConfig({ ...online, gameOrigin: '' }, 'com.example.game', true)).toThrow('website origin');
    expect(() => titanReleaseConfig({ ...online, gameOrigin: 'https://play.example.test/game' }, 'com.example.game', true)).toThrow('must be an origin');
    const desktop = titanReleaseConfig({ ...online, gameOrigin: '' }, 'com.example.game', false)!;
    expect(desktop.origins.split(',')).toContain('feather://localhost');
  });
  it('packages the actual prepared server with the project identity and connection', async () => {
    const bytes = readFileSync('src-tauri/export-runtime/titan-server.zip');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(bytes)));
    const config = titanReleaseConfig(online, 'com.example.game', true)!;
    const files = await configuredServerFiles(config);
    expect(JSON.parse(new TextDecoder().decode(files['realm-config.json']))).toEqual(config);
    expect(files['realm.cjs'].length).toBeGreaterThan(1000);
    expect(new TextDecoder().decode(files.Dockerfile)).toContain('/data/players.json');
    expect(files['manifest.json']).toBeUndefined();
    expect(config.origins.split(',')).toContain('https://play.example.test');
  });
  it('rejects a modified runtime instead of distributing it', async () => {
    const files = unzipSync(readFileSync('src-tauri/export-runtime/titan-server.zip'));
    files['realm.cjs'] = strToU8('modified');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(zipSync(files))));
    await expect(configuredServerFiles(titanReleaseConfig(online, 'com.example.game', true)!)).rejects.toThrow('failed verification');
  });
  it('carries the saved connection through bundle reload and the complete browser export', async () => {
    const project = blankProject('Online meadow');
    project.scenes[0].objects = emberMeadowContent().scenes[0].objects.filter(object => object.name === 'Ember Meadow · Realm runtime');
    project.variables = Object.entries(online).map(([key, value]) => ({ id: key, name: TITAN_SETTINGS[key as keyof typeof TITAN_SETTINGS], type: 'string' as const, defaultValue: value, persistent: false, createdAt: 1 }));
    const bundle = buildGameBundle(project);
    const reloaded = buildGameBundle(readGameBundle(JSON.parse(JSON.stringify(bundle))).project);
    expect(reloaded.realmServer).toEqual(bundle.realmServer);
    expect((await verifyGameBundle(bundle)).ok).toBe(true);
    const html = strToU8('<html>player</html>');
    const player = zipSync({ 'index.html': html, 'runtime-manifest.json': strToU8(JSON.stringify({ version: 1, files: [{ path: 'index.html', sha256: await sha256Hex(html) }] })) });
    const server = readFileSync('src-tauri/export-runtime/titan-server.zip');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(url.endsWith('titan-server.zip') ? server : player)));
    const files = unzipSync(await buildWebArchive(bundle, () => {}));
    expect(JSON.parse(new TextDecoder().decode(files['realm-server/realm-config.json']))).toEqual(bundle.realmServer);
    expect(files['realm-server/realm.cjs'].length).toBeGreaterThan(1000);
    expect(readGameBundle(JSON.parse(new TextDecoder().decode(files['game.json']))).project.variables).toEqual(project.variables);
    const inconsistent = { ...bundle, realmServer: { ...bundle.realmServer!, gameKey: 'wrong-game' } };
    expect((await verifyGameBundle(inconsistent)).ok).toBe(false);
  });
});
