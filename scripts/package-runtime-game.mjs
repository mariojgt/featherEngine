/** Package and launch-test one host-native game for Build Centre. No editor source ships. */
import { cpSync, mkdirSync, readFileSync, writeFileSync, chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'vite';
import { cookBuildVariants } from './lib/cook-build.mjs';
import { artifactInventory, sha256 } from './lib/release-evidence.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argument = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const target = ({ darwin: 'macos', win32: 'windows', linux: 'linux' })[process.platform];
const architecture = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
const input = resolve(argument('--bundle', 'exports/staging/game.json'));
const output = resolve(argument('--out', `exports/cloud-${target}`));
const runtime = resolve(root, 'src-tauri/export-runtime');
const exec = promisify(execFile);
const tar = process.platform === 'win32' ? resolve(process.env.SystemRoot ?? 'C:\\Windows', 'System32/tar.exe') : 'tar';
const xml = value => String(value).replace(/[<>&"']/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[ch]);
const safe = value => value.replace(/[^A-Za-z0-9_.-]/g, '-').replace(/^[.-]+/, '').slice(0, 80) || 'Game';
const manifest = JSON.parse(readFileSync(resolve(runtime, 'manifest.json'), 'utf8'));
const runner = manifest.runners.find(r => r.target === target && r.architecture === architecture);
if (!runner) throw new Error(`No ${target}/${architecture} runner. Run scripts/prepare-editor-runtime.mjs first.`);
function runtimePath(path) {
  if (typeof path !== 'string' || path.includes('\\') || path.split('/').some(p => !p || p === '.' || p === '..') || path.includes(':')) throw new Error('Invalid runtime file path.');
  return resolve(runtime, path);
}
if (sha256(readFileSync(runtimePath(runner.path))) !== runner.sha256) throw new Error('Runner checksum mismatch.');
for (const file of manifest.files) if (sha256(readFileSync(runtimePath(`player/${file.path}`))) !== file.sha256) throw new Error(`Player checksum mismatch: ${file.path}`);
const server = await createServer({ root, configFile: false, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
let bundle;
try {
  const { readGameBundle, buildGameBundle } = await server.ssrLoadModule('/src/project/exportGame.ts');
  const { verifyGameBundle } = await server.ssrLoadModule('/src/project/verifyBundle.ts');
  const loaded = readGameBundle(JSON.parse(readFileSync(input, 'utf8')));
  bundle = buildGameBundle(loaded.project, loaded.buildProfile);
  const audit = verifyGameBundle(bundle);
  if (audit.errors.length) throw new Error(audit.errors.join('\n'));
  for (const feature of bundle.runtimeContract.requiredFeatures) if (!manifest.features.includes(feature)) throw new Error(`Runner cannot execute ${feature}.`);
} finally { await server.close(); }
const variants = await cookBuildVariants(root, bundle, target === 'linux' ? [target, 'web'] : [target]);
const staging = mkdtempSync(resolve(tmpdir(), 'feather-portable-'));
mkdirSync(output, { recursive: true });
const report = { formatVersion: 1, target, architecture, profile: bundle.buildProfile, inputSha256: sha256(readFileSync(input)), engineSourceHash: manifest.sourceHash, signing: target === 'macos' ? 'ad-hoc (not notarized)' : 'unsigned', launchTest: 'not-run', files: [], assets: variants.get(target).report };
try {
  const product = safe(bundle.buildProfile.application.productName);
  const depot = resolve(staging, product); mkdirSync(depot, { recursive: true });
  const app = resolve(depot, `${product}.app`);
  const executable = target === 'macos' ? resolve(app, 'Contents/MacOS/feather-game') : resolve(depot, target === 'windows' ? 'feather-game.exe' : 'feather-game');
  const game = target === 'macos' ? resolve(app, 'Contents/Resources/game') : resolve(depot, 'game');
  mkdirSync(dirname(executable), { recursive: true }); mkdirSync(game, { recursive: true });
  cpSync(runtimePath(runner.path), executable); chmodSync(executable, 0o755);
  const writeGame = (directory, variant) => {
    // Copy the inventoried player files only; exclude stale/untracked runtime files.
    for (const file of manifest.files) { const destination = resolve(directory, file.path); mkdirSync(dirname(destination), { recursive: true }); cpSync(runtimePath(`player/${file.path}`), destination); }
    writeFileSync(resolve(directory, 'game.json'), JSON.stringify(variant.bundle));
    for (const [path, bytes] of variant.files) { if (!/^game-assets\/[a-f0-9]+\.[a-z0-9]+$/.test(path)) throw new Error(`Unsafe prepared asset: ${path}`); const dest = resolve(directory, path); mkdirSync(dirname(dest), { recursive: true }); writeFileSync(dest, bytes); }
  };
  writeGame(game, variants.get(target));
  if (target === 'macos') {
    const identity = bundle.buildProfile.application;
    writeFileSync(resolve(app, 'Contents/Info.plist'), `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>feather-game</string><key>CFBundleIdentifier</key><string>${xml(identity.identifier)}</string><key>CFBundleName</key><string>${xml(identity.productName)}</string><key>CFBundleShortVersionString</key><string>${xml(identity.version)}</string><key>CFBundleVersion</key><string>${identity.buildNumber}</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`);
    await exec('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app]);
  }
  try {
    const launched = await exec(executable, ['--smoke-test'], { timeout: 75000, maxBuffer: 4 * 1024 * 1024 });
    if (!launched.stdout.includes('Player loaded and rendered the launch scene.')) throw new Error(`Player exited without confirming a rendered launch scene.${launched.stderr.trim() ? `\n${launched.stderr.trim()}` : ''}`);
    report.launchTest = 'passed';
  } catch (error) { report.launchTest = 'failed'; report.error = String(error); throw error; }
  report.files = artifactInventory(depot);
  const archive = `${product}-${target}-${architecture}.tar.gz`;
  await exec(tar, ['-czf', resolve(output, archive), '-C', staging, product], { timeout: 120000 });
  report.archive = { path: archive, sha256: sha256(readFileSync(resolve(output, archive))) };
  if (variants.has('web')) {
    const web = resolve(staging, 'web'); mkdirSync(web);
    writeGame(web, variants.get('web'));
    await exec(tar, ['-czf', resolve(output, `${product}-web.tar.gz`), '-C', staging, 'web'], { timeout: 120000 });
    report.web = { archive: `${product}-web.tar.gz`, sha256: sha256(readFileSync(resolve(output, `${product}-web.tar.gz`))), files: artifactInventory(web), launchTest: 'not-run', assets: variants.get('web').report };
  }
  console.log(`Launch game: passed (${target}/${architecture}). ${archive}`);
} finally {
  writeFileSync(resolve(output, 'launch-test.json'), JSON.stringify(report, null, 2));
  rmSync(staging, { recursive: true, force: true });
}
