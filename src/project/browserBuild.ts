import { unzipSync, zipSync, strToU8 } from 'fflate';
import { cookGameAssets, externalizeGameAssets, type CookServices } from './cookAssets';
import { browserAssetCookCache } from './assetCookCache';
import { prepareGeometryAsync } from '../three/prepareGeometryAsync';
import { compressGlbTextures } from '../three/compressTextures';
import type { GameBundle } from './exportGame';
import { verifyGameBundle } from './verifyBundle';
import { sha256Hex } from '../utils/contentHash';

export const browserCookServices = (onProgress: (line: string) => void): CookServices => ({
  cache: browserAssetCookCache, geometry: prepareGeometryAsync, backend: 'browser-v1', onProgress,
  textures: async (bytes, preset) => (await compressGlbTextures(bytes.slice().buffer, { throwOnFailure: true, maxSize: { desktop: 4096, web: 2048, mobile: 1024 }[preset] })).data,
});

/** Build a complete static-host package with the exact runtime shipped alongside this editor. */
export async function buildWebArchive(bundle: GameBundle, onProgress: (line: string) => void): Promise<Uint8Array> {
  const audit = verifyGameBundle(bundle); if (audit.errors.length) throw new Error(audit.errors.join('\n'));
  onProgress('Loading the packaged game runtime…');
  const response = await fetch(`${import.meta.env.BASE_URL}export-runtime/player.zip`);
  if (!response.ok) throw new Error('The editor installation is missing its game runtime. Reinstall the current editor or run npm run build:player in a development checkout.');
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const manifest = JSON.parse(new TextDecoder().decode(files['runtime-manifest.json'] ?? new Uint8Array())) as { version: number; files: Array<{ path: string; sha256: string }> };
  if (manifest.version !== 1 || !files['index.html']) throw new Error('Invalid packaged player.');
  const paths = new Set(manifest.files.map((file) => file.path));
  if (paths.size !== manifest.files.length || Object.keys(files).some((path) => path !== 'runtime-manifest.json' && (!paths.has(path) || !/^[a-zA-Z0-9_.\-/]+$/.test(path) || path.startsWith('/') || path.split('/').some((part) => !part || part === '..' || part === '.')))) throw new Error('Invalid packaged player file inventory.');
  for (const file of manifest.files) if (!files[file.path] || await sha256Hex(files[file.path]) !== file.sha256) throw new Error(`Packaged player file failed verification: ${file.path}`);
  const cooked = await cookGameAssets(bundle, 'web', browserCookServices(onProgress));
  const streamed = externalizeGameAssets(cooked.bundle);
  files['game.json'] = strToU8(JSON.stringify(streamed.bundle));
  for (const [path, bytes] of streamed.files) files[path] = bytes;
  files['build-report.json'] = strToU8(JSON.stringify({ profile: bundle.buildProfile, builtTargets: ['web'], assetPreparation: cooked.report }, null, 2));
  files['README.txt'] = strToU8(`${bundle.buildProfile.application.productName}\n\nUpload this whole folder to a static web host. To test locally, serve the folder over HTTP.\n`);
  delete files['runtime-manifest.json'];
  onProgress('Packaging your playable web game…');
  return zipSync(files, { level: 6 });
}
