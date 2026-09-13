import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { artifactInventory, sha256 } from './lib/release-evidence.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const run = (file, args, env = {}) => execFileSync(file, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
if (!process.argv.includes('--skip-editor')) {
  // Windows .cmd launchers require cmd.exe; the command is fixed, with no interpolated input.
  if (process.platform === 'win32') run('cmd.exe', ['/d', '/s', '/c', 'npm.cmd run build']);
  else run('npm', ['run', 'build']);
}
if (process.argv.includes('--skip-editor')) run(process.execPath, ['scripts/build-player.mjs', '--verify-only']);
const targetIndex = process.argv.indexOf('--target');
const rustTarget = targetIndex >= 0 ? process.argv[targetIndex + 1] : process.env.FEATHER_RUNNER_TARGET || process.env.TAURI_ENV_TARGET_TRIPLE;
const target = rustTarget?.includes('windows') ? 'windows' : rustTarget?.includes('apple') ? 'macos' : rustTarget?.includes('linux') ? 'linux' : ({ darwin: 'macos', win32: 'windows', linux: 'linux' })[process.platform];
const architecture = rustTarget?.startsWith('aarch64') ? 'aarch64' : rustTarget?.startsWith('x86_64') ? 'x86_64' : process.arch === 'arm64' ? 'aarch64' : 'x86_64';
if (!target) throw new Error('Unsupported desktop runner host.');
const args = ['build', '--manifest-path', 'src-tauri/runner/Cargo.toml', '--release', '--features', 'custom-protocol'];
if (rustTarget) args.push('--target', rustTarget);
run('cargo', args);
const runtime = resolve(root, 'src-tauri/export-runtime');
const player = resolve(root, 'dist-player');
if (!existsSync(resolve(player, 'index.html'))) throw new Error('Build the player runtime first.');
rmSync(resolve(runtime, 'player'), { recursive: true, force: true });
cpSync(player, resolve(runtime, 'player'), { recursive: true });
const runnerName = target === 'windows' ? 'feather-game.exe' : 'feather-game';
const relativeRunner = `runners/${target}-${architecture}/${runnerName}`;
mkdirSync(dirname(resolve(runtime, relativeRunner)), { recursive: true });
cpSync(resolve(root, 'src-tauri/runner/target', ...(rustTarget ? [rustTarget] : []), 'release', runnerName), resolve(runtime, relativeRunner));
const server = await createServer({ root, configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const { SUPPORTED_RUNTIME_FEATURES } = await server.ssrLoadModule('/src/project/runtimeCompatibility.ts');
  const cache = JSON.parse(readFileSync(resolve(player, '.player-cache.json'), 'utf8'));
  writeFileSync(resolve(runtime, 'manifest.json'), JSON.stringify({ version: 1, sourceHash: cache.sourceHash, features: SUPPORTED_RUNTIME_FEATURES, files: artifactInventory(resolve(runtime, 'player')), runners: [{ target, architecture, path: relativeRunner, sha256: sha256(readFileSync(resolve(runtime, relativeRunner))) }] }, null, 2));
  // The directory can be distributed as an optional runner pack for this OS/architecture.
  writeFileSync(resolve(runtime, `runners/${target}-${architecture}/runner.json`), JSON.stringify({ version: 1, target, architecture, executable: runnerName, sha256: sha256(readFileSync(resolve(runtime, relativeRunner))) }, null, 2));
} finally { await server.close(); }
console.log(`Prepared installed-editor exports: Web + ${target} (${architecture}).`);
