import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sha256 } from './release-evidence.mjs';
export function writeTitanServer(runtimeRoot, destination, bundle) {
  if (!bundle.realmServer) return;
  const source = resolve(runtimeRoot, 'titan-server');
  const manifest = JSON.parse(readFileSync(resolve(source, 'manifest.json'), 'utf8'));
  if (manifest.version !== 1 || !Array.isArray(manifest.files) || !manifest.files.some(file => file.path === 'realm.cjs')) throw new Error('Invalid Titan server runtime.');
  const output = resolve(destination, 'realm-server'); mkdirSync(output, { recursive: true });
  const listed = new Set();
  for (const file of manifest.files) {
    if (typeof file.path !== 'string' || !/^[\w.-]+$/.test(file.path) || ['.', '..', 'manifest.json', 'realm-config.json'].includes(file.path) || listed.has(file.path)) throw new Error('Invalid Titan runtime path.');
    listed.add(file.path);
    const bytes = readFileSync(resolve(source, file.path));
    if (sha256(bytes) !== file.sha256) throw new Error(`Titan runtime checksum mismatch: ${file.path}`);
    writeFileSync(resolve(output, file.path), bytes);
  }
  writeFileSync(resolve(output, 'realm-config.json'), JSON.stringify(bundle.realmServer, null, 2));
}
