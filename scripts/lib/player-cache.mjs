import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { artifactInventory, sha256 } from './release-evidence.mjs';

export function playerInputHash(root) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name), name = relative(root, path).replaceAll('\\', '/');
      if (/^public\/(store|templates)(\/|$)/.test(name) || /(__tests__|\.test\.)/.test(name)) continue;
      if (entry.isDirectory()) walk(path); else if (entry.isFile()) files.push(path);
    }
  };
  for (const name of ['src', 'public']) walk(resolve(root, name));
  for (const name of ['package.json', 'package-lock.json', 'player.html', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json', 'scripts/build-player.mjs', 'scripts/lib/player-cache.mjs']) if (existsSync(resolve(root, name))) files.push(resolve(root, name));
  const hash = createHash('sha256').update('feather-player-cache-v1\0');
  for (const file of files.sort()) hash.update(relative(root, file).replaceAll('\\', '/')).update('\0').update(readFileSync(file)).update('\0');
  return hash.digest('hex');
}

export function readPlayerCache(root, sourceHash) {
  const dir = resolve(root, 'dist-player');
  try {
    const cache = JSON.parse(readFileSync(resolve(dir, '.player-cache.json'), 'utf8'));
    if (cache.sourceHash !== sourceHash || cache.version !== 1 || !cache.files?.length) return null;
    const inventory = artifactInventory(dir).filter((file) => file.path !== '.player-cache.json');
    if (inventory.length !== cache.files.length || inventory.some((file) => !cache.files.some((entry) => entry.path === file.path && entry.sha256 === file.sha256))) return null;
    for (const file of cache.files) {
      if (!/^[a-zA-Z0-9_.\-/]+$/.test(file.path) || file.path.split('/').some((part) => !part || part === '..') || sha256(readFileSync(resolve(dir, file.path))) !== file.sha256) return null;
    }
    return cache;
  } catch { return null; }
}

export function writePlayerCache(root, sourceHash, checked) {
  const directory = resolve(root, 'dist-player');
  const files = artifactInventory(directory).filter((file) => file.path !== '.player-cache.json');
  const cache = { version: 1, sourceHash, checked, files };
  writeFileSync(resolve(directory, '.player-cache.json'), JSON.stringify(cache));
  return cache;
}
