import assert from 'node:assert/strict';
import { cpSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'vite';
import { cookBuildVariants } from './lib/cook-build.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = ({ darwin: 'macos', win32: 'windows', linux: 'linux' })[process.platform];
const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
const out = resolve(root, 'exports/runtime-acceptance'); mkdirSync(out, { recursive: true });
const server = await createServer({ root, configFile: false, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
let bundle;
try {
  const { readGameBundle, buildGameBundle } = await server.ssrLoadModule('/src/project/exportGame.ts');
  const loaded = readGameBundle(JSON.parse(readFileSync(resolve(root, 'scripts/fixtures/production-smoke-game.json'), 'utf8')));
  loaded.buildProfile.targets = [target];
  bundle = buildGameBundle(loaded.project, loaded.buildProfile);
} finally { await server.close(); }
const variants = await cookBuildVariants(root, bundle, [target]);
const variant = variants.get(target);
const native = target === 'macos' ? resolve(out, 'Feather Smoke.app/Contents/MacOS/feather-game') : resolve(out, target === 'windows' ? 'feather-game.exe' : 'feather-game');
const game = target === 'macos' ? resolve(out, 'Feather Smoke.app/Contents/Resources/game') : resolve(out, 'game');
mkdirSync(dirname(native), { recursive: true }); mkdirSync(game, { recursive: true });
cpSync(resolve(root, `src-tauri/export-runtime/runners/${target}-${arch}/${target === 'windows' ? 'feather-game.exe' : 'feather-game'}`), native); chmodSync(native, 0o755);
cpSync(resolve(root, 'dist-player'), game, { recursive: true });
writeFileSync(resolve(game, 'game.json'), JSON.stringify(variant.bundle));
for (const [path, bytes] of variant.files) { mkdirSync(dirname(resolve(game, path)), { recursive: true }); writeFileSync(resolve(game, path), bytes); }
if (target === 'macos') {
  writeFileSync(resolve(out, 'Feather Smoke.app/Contents/Info.plist'), '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>feather-game</string><key>CFBundleIdentifier</key><string>com.thedevrealm.smoketest</string><key>CFBundleName</key><string>Feather Smoke</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>');
  await promisify(execFile)('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', resolve(out, 'Feather Smoke.app')]);
}
const result = await promisify(execFile)(native, ['--smoke-test'], { timeout: 75000 });
writeFileSync(resolve(out, 'launch-test.json'), JSON.stringify({ target, architecture: arch, stdout: result.stdout, stderr: result.stderr }, null, 2));
assert.match(result.stdout, /Player loaded and rendered the launch scene/);
console.log(`✓ Prebuilt ${target} runner loaded the game, streamed assets and rendered the launch scene.`);
