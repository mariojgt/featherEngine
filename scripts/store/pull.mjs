/** Restore verified development/test fixtures. Archives are never shipped with the editor. */
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fixturesDir, packagePath, sha256, storeRoot, validateCatalog } from './files.mjs';

const catalog = validateCatalog(JSON.parse(await readFile(resolve(storeRoot, 'public/store/catalog.json'), 'utf8')));
for (const entry of catalog.packages) {
  const file = resolve(fixturesDir, packagePath(entry));
  if (!/^[a-f0-9]{64}$/.test(entry.sha256 ?? '')) throw new Error(`Missing checksum for ${entry.slug}. Publish the store first.`);
  const cached = await readFile(file).catch(() => null);
  if (cached && cached.length === entry.sizeBytes && sha256(cached) === entry.sha256) continue;
  const url = new URL(entry.downloadUrl);
  if (url.protocol !== 'https:') throw new Error('Store fixtures require HTTPS.');
  console.log(`Restoring ${entry.slug}…`);
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Could not download ${entry.slug} (HTTP ${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== entry.sizeBytes || sha256(bytes) !== entry.sha256) throw new Error(`Checksum mismatch for ${entry.slug}.`);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, bytes);
  await rename(`${file}.tmp`, file);
}
console.log(`Store cache ready: ${catalog.packages.length} verified packages.`);
