#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

if (!args.has('--skip-typecheck')) {
  runNode(tscBin, ['-b']);
} else {
  console.log('Skipping TypeScript check for faster player rebuild.');
}

runNode(viteBin, ['build'], { BUILD_TARGET: 'player' });
