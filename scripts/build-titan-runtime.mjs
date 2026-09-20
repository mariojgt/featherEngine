/** Build the deployable server once, alongside the editor's verified player runtime. */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import { sha256 } from './lib/release-evidence.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtime = resolve(root, 'src-tauri/export-runtime');
const output = resolve(runtime, 'titan-server'); mkdirSync(output, { recursive: true });
const entry = resolve(root, 'examples/titan-mmo/server/launch.mjs');
await build({ entryPoints: [entry], outfile: resolve(output, 'realm.cjs'), bundle: true, platform: 'node', target: 'node22', format: 'cjs', logLevel: 'warning' });
writeFileSync(resolve(output, 'Dockerfile'), 'FROM node:22-alpine\nWORKDIR /app\nCOPY realm.cjs realm-config.json ./\nENV HOST=0.0.0.0 PORT=8787 REALM_DATA=/data/players.json\nVOLUME ["/data"]\nEXPOSE 8787\nCMD ["node", "realm.cjs"]\n');
writeFileSync(resolve(output, '.dockerignore'), '*\n!realm.cjs\n!realm-config.json\n!Dockerfile\n');
writeFileSync(resolve(output, 'README.txt'), 'Feather Titan realm\n\nThis server is configured automatically from the Titan plugin when you export an online game.\nDeploy this folder to a Docker-compatible server host. Expose port 8787 through HTTPS with WebSocket support, and attach a persistent volume at /data. Use the same realm address and game website origin saved in the plugin.\n\nNo npm installation, .env editing, or player keys are required. The game connects to its saved realm address.\n\nFor a Node.js 22+ host, launch realm.cjs from this folder. Saves default to ~/.feather-realms/<game-id>/players.json; REALM_DATA can override the location. Run one process per save file.\n');
writeFileSync(resolve(output, 'LICENSE'), readFileSync(resolve(root, 'examples/titan-mmo/LICENSE')));
const names = ['realm.cjs', 'Dockerfile', '.dockerignore', 'README.txt', 'LICENSE'];
const files = Object.fromEntries(names.map(name => [name, new Uint8Array(readFileSync(resolve(output, name)))]));
files['manifest.json'] = new TextEncoder().encode(JSON.stringify({ version: 1, files: names.map(path => ({ path, sha256: sha256(files[path]) })) }));
writeFileSync(resolve(output, 'manifest.json'), files['manifest.json']);
writeFileSync(resolve(runtime, 'titan-server.zip'), zipSync(files));
if (process.argv.includes('--native')) {
  const native = resolve(runtime, 'titan-local'); mkdirSync(native, { recursive: true });
  const triple = process.env.TAURI_ENV_TARGET_TRIPLE ?? '';
  const os = triple.includes('windows') ? 'windows' : triple.includes('apple') ? 'darwin' : triple.includes('linux') ? 'linux' : ({ darwin: 'darwin', win32: 'windows', linux: 'linux' })[process.platform];
  const arch = triple.startsWith('aarch64') ? 'arm64' : triple.startsWith('x86_64') ? 'x64' : process.arch;
  const target = `bun-${os}-${arch}${os === 'linux' && arch === 'x64' ? '-baseline' : ''}`;
  const executable = os === 'windows' ? 'feather-realm.exe' : 'feather-realm';
  const signature = sha256(readFileSync(resolve(output, 'realm.cjs'))) + target;
  const metadata = resolve(native, 'manifest.json');
  let previous; try { previous = JSON.parse(readFileSync(metadata, 'utf8')); } catch {}
  if (previous?.signature !== signature || !existsSync(resolve(native, executable)) || previous.sha256 !== sha256(readFileSync(resolve(native, executable)))) {
    const before = new Set(readdirSync(native));
    try { execFileSync('bun', ['build', '--compile', `--target=${target}`, entry, '--outfile', resolve(native, executable)], { cwd: native, stdio: 'inherit' }); }
    finally { for (const file of readdirSync(native)) if (!before.has(file) && /^\.[a-f\d]+-\d+\.bun-build$/.test(file)) rmSync(resolve(native, file)); }
    writeFileSync(metadata, JSON.stringify({ version: 1, executable, signature, sha256: sha256(readFileSync(resolve(native, executable))) }));
  }
}
console.log('Prepared Titan server package' + (process.argv.includes('--native') ? ' and standalone local realm.' : '.'));
