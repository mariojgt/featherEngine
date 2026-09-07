import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Fingerprint tracked and new engine sources, including uncommitted work used by local exports. */
export function engineEvidence(root) {
  try {
    const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const files = [...new Set(git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0'))]
      .filter((path) => /^(src\/|scripts\/|src-tauri\/src\/|package(?:-lock)?\.json$|vite.*\.ts$)/.test(path)).sort();
    const hash = createHash('sha256');
    for (const path of files) {
      hash.update(path).update('\0');
      try { hash.update(readFileSync(resolve(root, path))); } catch { hash.update('<deleted>'); }
      hash.update('\0');
    }
    return { revision: git(['rev-parse', 'HEAD']).trim(), dirty: Boolean(git(['status', '--porcelain']).trim()), sourceSha256: hash.digest('hex') };
  } catch { return { revision: null, dirty: null, sourceSha256: null }; }
}

/** Excludes the report itself to avoid a circular digest. Paths are portable and relative. */
export function artifactInventory(directory) {
  const inventory = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && path !== resolve(directory, 'build-report.json')) {
        const bytes = readFileSync(path);
        inventory.push({ path: relative(directory, path).split('\\').join('/'), bytes: bytes.length, sha256: sha256(bytes) });
      }
    }
  };
  walk(directory);
  return inventory.sort((a, b) => a.path.localeCompare(b.path));
}
