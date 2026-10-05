import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const kindFolders = { asset: 'assets', project: 'projects', plugin: 'plugins' };
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function packagePath(entry) {
  if (!kindFolders[entry.kind] || !/^[a-z0-9-]+$/.test(entry.slug)) {
    throw new Error('Invalid package kind or slug in catalog.');
  }
  return `packages/${kindFolders[entry.kind]}/${entry.slug}.nfpack`;
}

export function validateCatalog(catalog) {
  if (catalog?.format !== 'feather-store-catalog' || !Array.isArray(catalog.packages) || !catalog.packages.length) {
    throw new Error('Expected a nonempty Feather store catalog.');
  }
  const ids = new Set(), slugs = new Set();
  for (const entry of catalog.packages) {
    packagePath(entry);
    if (!entry.id || ids.has(entry.id) || slugs.has(entry.slug)) throw new Error('Duplicate or missing package identity.');
    ids.add(entry.id); slugs.add(entry.slug);
    if (entry.priceCents !== 0) throw new Error('The public store supports free packages only.');
  }
  return catalog;
}

export const storeRoot = fileURLToPath(new URL('../../', import.meta.url));
export const cacheDir = resolve(storeRoot, '.feather-cache/store');
export const fixturesDir = resolve(storeRoot, '.feather-cache/store-fixtures');
