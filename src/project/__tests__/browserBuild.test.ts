// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { buildWebArchive } from '../browserBuild';
import { blankProject } from '../serialize';
import { buildGameBundle, readGameBundle } from '../exportGame';
import { sha256Hex } from '../../utils/contentHash';

afterEach(() => vi.unstubAllGlobals());
async function runtime(extra = false) {
  const html = strToU8('<html><script src="./player.js"></script></html>'), js = strToU8('window.player = true');
  const manifest = { version: 1, files: [{ path: 'index.html', sha256: await sha256Hex(html) }, { path: 'player.js', sha256: await sha256Hex(js) }] };
  const files: Record<string, Uint8Array> = { 'index.html': html, 'player.js': js, 'runtime-manifest.json': strToU8(JSON.stringify(manifest)) };
  if (extra) files['unlisted.js'] = strToU8('unexpected');
  const bytes = zipSync(files); vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => bytes.slice().buffer })));
}
it('produces a complete web zip with file assets and the selected launch scene', async () => {
  await runtime(); const project = blankProject('Web game');
  project.assets = [{ id: 'badge', name: 'badge.svg', type: 'image', size: 6, createdAt: 1, data: 'data:image/svg+xml;base64,PHN2Zy8+' }];
  const source = buildGameBundle(project), files = unzipSync(await buildWebArchive(source, () => {}));
  expect(files['index.html']).toBeDefined(); expect(files['player.js']).toBeDefined();
  const bundle = readGameBundle(JSON.parse(new TextDecoder().decode(files['game.json'])));
  const delivered = bundle.project.assets[0].delivery!;
  expect(new TextDecoder().decode(files[delivered.path])).toBe('<svg/>');
  expect(bundle.startSceneId).toBe(source.startSceneId); expect(files['build-report.json']).toBeDefined();
  expect(source.project.assets[0].data).toBeDefined();
});
it('rejects unlisted files in the packaged runtime', async () => {
  await runtime(true); await expect(buildWebArchive(buildGameBundle(blankProject('Web game')), () => {})).rejects.toThrow('inventory');
});
