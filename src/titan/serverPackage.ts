import { unzipSync, strToU8, zipSync } from 'fflate';
import { sha256Hex } from '../utils/contentHash';
import type { TitanRealmConfig } from './settings';

/** The source, browser and desktop exporters use the same prepared, dependency-free server. */
export async function configuredServerFiles(config: TitanRealmConfig): Promise<Record<string, Uint8Array>> {
  const response = await fetch(`${import.meta.env.BASE_URL}export-runtime/titan-server.zip`);
  if (!response.ok) throw new Error('This editor is missing the Titan server runtime. Install the current Feather build.');
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']));
  if (manifest.version !== 1 || !Array.isArray(manifest.files) || !files['realm.cjs']) throw new Error('Invalid Titan server runtime.');
  const listed = new Set<string>();
  for (const entry of manifest.files) {
    if (typeof entry.path !== 'string' || !/^[\w.-]+$/.test(entry.path) || ['.', '..', 'manifest.json', 'realm-config.json'].includes(entry.path) || listed.has(entry.path)) throw new Error('Invalid Titan server file inventory.');
    listed.add(entry.path);
    if (!files[entry.path] || await sha256Hex(files[entry.path]) !== entry.sha256) throw new Error(`Titan runtime failed verification: ${entry.path}`);
  }
  if (Object.keys(files).some(path => path !== 'manifest.json' && !listed.has(path))) throw new Error('Unexpected file in Titan runtime.');
  delete files['manifest.json'];
  files['realm-config.json'] = strToU8(JSON.stringify(config, null, 2));
  return files;
}
export async function configuredServerArchive(config: TitanRealmConfig) { return zipSync(await configuredServerFiles(config)); }
