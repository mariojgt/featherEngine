#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { zipSync } from 'fflate';
import { playerInputHash, readPlayerCache, writePlayerCache } from './lib/player-cache.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tscBin = resolve(root, 'node_modules/typescript/bin/tsc');
const viteBin = resolve(root, 'node_modules/vite/bin/vite.js');
const args = new Set(process.argv.slice(2));

function runNode(script, scriptArgs, env = {}) {
  execFileSync(process.execPath, [script, ...scriptArgs], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
}

const sourceHash = playerInputHash(root);
const cached = args.has('--force') ? null : readPlayerCache(root, sourceHash);
if (args.has('--verify-only')) {
  if (!cached) throw new Error('The reusable player is missing, changed, or out of date. Run npm run build:player.');
  console.log('Verified reusable player and all runtime files.');
  process.exit(0);
}
if (!args.has('--skip-typecheck') && !cached?.checked) {
  runNode(tscBin, ['-b']);
} else if (args.has('--skip-typecheck')) {
  console.log('Skipping TypeScript check for faster player rebuild.');
}

if (cached) console.log('Reusing verified player: engine sources and runtime files are unchanged.');
else runNode(viteBin, ['build'], { BUILD_TARGET: 'player' });
const manifest = writePlayerCache(root, sourceHash, !args.has('--skip-typecheck') || cached?.checked === true);
// The browser editor uses the same verified runtime to download a complete playable web package.
const files = Object.fromEntries(manifest.files.map((file) => [file.path, new Uint8Array(readFileSync(resolve(root, 'dist-player', file.path)))]));
files['runtime-manifest.json'] = new TextEncoder().encode(JSON.stringify({ version: 1, sourceHash, files: manifest.files }));
const destination = resolve(root, 'src-tauri/export-runtime'); mkdirSync(destination, { recursive: true });
writeFileSync(resolve(destination, 'player.zip'), zipSync(files, { level: 6 }));
