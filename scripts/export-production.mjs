#!/usr/bin/env node
// Production export assembler for Feather Engine games.
//
// Turns a self-contained game bundle (game.json, produced by the editor's
// Production button) into shippable artifacts:
//
//   - a PORTABLE WEB FOLDER: copy of the player build with the game baked in;
//     runs by opening index.html in any browser.
//   - a NATIVE APP (--native): wraps that folder in the Tauri player target,
//     producing a real .app/.dmg (mac), .msi/.exe (windows), or
//     .AppImage/.deb (linux) for the current operating system.
//
// Usage:
//   node scripts/export-production.mjs [--bundle <game.json>] [--name "<Game>"]
//                                      [--out <dir>] [--native] [--fast]
//                                      [--skip-build] [--zip] [--open]
//
// Defaults: --bundle exports/staging/game.json, --out exports/
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      opts[key] = next;
      i += 1;
    } else {
      opts[key] = true;
    }
  }
  return opts;
}

function slugify(name) {
  return (
    String(name || 'game')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'game'
  );
}

function run(cmd, args) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  if (process.platform === 'win32') {
    const quote = (part) => {
      const text = String(part);
      return /[\s&()^%!<>|"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    execFileSync('cmd.exe', ['/d', '/c', [cmd, ...args].map(quote).join(' ')], {
      cwd: root,
      stdio: 'inherit',
    });
    return;
  }
  execFileSync(cmd, args, { cwd: root, stdio: 'inherit' });
}

function openPath(path) {
  try {
    if (process.platform === 'win32') execFileSync('explorer.exe', [path], { stdio: 'ignore' });
    else if (process.platform === 'darwin') execFileSync('open', [path], { stdio: 'ignore' });
    else execFileSync('xdg-open', [path], { stdio: 'ignore' });
  } catch {
    console.warn(`Could not open ${path}.`);
  }
}

function collectInstallers(bundleDir) {
  if (!existsSync(bundleDir)) return [];
  const wanted = /\.(dmg|app|msi|exe|AppImage|deb|rpm)$/i;
  const found = [];
  for (const sub of readdirSync(bundleDir)) {
    const subDir = resolve(bundleDir, sub);
    if (!statSync(subDir).isDirectory()) continue;
    for (const entry of readdirSync(subDir)) {
      if (wanted.test(entry)) found.push(resolve(subDir, entry));
    }
  }
  return found;
}

function injectBundleScript(html, title) {
  let out = html.replace(/<title>[^<]*<\/title>/i, `<title>${title.replace(/[<>&]/g, '')}</title>`);
  if (!out.includes('game-bundle.js')) {
    out = out.replace(/(<script\b[^>]*\bsrc=)/i, '<script src="./game-bundle.js"></script>\n    $1');
  }
  return out;
}

function zipFolder(webOut) {
  const zipPath = `${webOut}.zip`;
  rmSync(zipPath, { force: true });
  if (process.platform === 'win32') {
    const stage = mkdtempSync(join(tmpdir(), 'feather-export-'));
    try {
      const stagedWeb = resolve(stage, basename(webOut));
      cpSync(webOut, stagedWeb, { recursive: true });
      run('powershell', [
        '-NoProfile',
        '-Command',
        `Compress-Archive -Path '${stagedWeb}' -DestinationPath '${zipPath}'`,
      ]);
    } finally {
      rmSync(stage, { recursive: true, force: true });
    }
  } else {
    execFileSync('zip', ['-r', '-q', zipPath, '.'], { cwd: webOut, stdio: 'inherit' });
  }
  console.log(`\nOK: Zipped -> ${zipPath}`);
}

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const opts = parseArgs(process.argv.slice(2));
const bundlePath = resolve(root, opts.bundle || 'exports/staging/game.json');
const outRoot = resolve(root, opts.out || 'exports');
const distPlayer = resolve(root, 'dist-player');

if (!existsSync(bundlePath)) {
  console.error(
    `\nERROR: No game bundle found at ${bundlePath}\n` +
      '  Export one from the editor Production button, or pass --bundle <game.json>.\n',
  );
  process.exit(1);
}

const bundleRaw = readFileSync(bundlePath, 'utf8');
let bundle;
try {
  bundle = JSON.parse(bundleRaw);
} catch (err) {
  console.error(`\nERROR: ${bundlePath} is not valid JSON: ${err.message}\n`);
  process.exit(1);
}

const gameName = opts.name || bundle?.project?.name || 'Game';
const slug = slugify(gameName);

{
  const p = bundle.project ?? {};
  const objectCount = (p.scenes ?? []).reduce((n, scene) => n + (scene.objects?.length ?? 0), 0);
  const assets = p.assets ?? [];
  const notEmbedded = assets.filter((asset) => !asset.data || asset.unresolved);
  console.log(
    `\nContents: ${(p.scenes ?? []).length} scenes / ${objectCount} objects | ` +
      `${(p.blueprints ?? []).length} blueprints | ${(p.materials ?? []).length} materials | ` +
      `${(p.particleSystems ?? []).length} particles | ${(p.prefabs ?? []).length} prefabs | ` +
      `${assets.length} resources`,
  );
  if (notEmbedded.length) {
    console.warn(`WARNING: ${notEmbedded.length} resource(s) NOT embedded:`);
    for (const asset of notEmbedded) console.warn(`   - ${asset.name ?? asset.id} (${asset.path ?? asset.id})`);
  } else if (assets.length) {
    console.log('OK: All resources embedded.');
  }
}

if (!opts['skip-build']) {
  run(npmCmd, ['run', opts.fast ? 'build:player:fast' : 'build:player']);
} else if (!existsSync(distPlayer)) {
  console.error('\nERROR: --skip-build was set but dist-player/ does not exist. Build it first.\n');
  process.exit(1);
} else {
  console.log('\nReusing existing dist-player/ (--skip-build).');
}

const bundleJs = `window.__NODEFORGE_GAME__ = ${JSON.stringify(bundle)};\n`;
const webOut = resolve(outRoot, `${slug}-web`);
rmSync(webOut, { recursive: true, force: true });
mkdirSync(webOut, { recursive: true });
cpSync(distPlayer, webOut, { recursive: true });
writeFileSync(resolve(webOut, 'game-bundle.js'), bundleJs);
const webIndex = resolve(webOut, 'index.html');
writeFileSync(webIndex, injectBundleScript(readFileSync(webIndex, 'utf8'), gameName));
writeFileSync(
  resolve(webOut, 'README.txt'),
  `${gameName}\n${'='.repeat(gameName.length)}\n\n` +
    'Portable web build. Open index.html in a browser to play - no install required.\n' +
    'To host it, serve this folder from any static web server.\n\n' +
    'Built with Feather Engine. Re-export from the editor to update.\n',
);
console.log(`\nOK: Portable web build -> ${webOut}`);

if (opts.native) {
  const distIndex = resolve(distPlayer, 'index.html');
  const distBundle = resolve(distPlayer, 'game-bundle.js');
  const indexBefore = readFileSync(distIndex, 'utf8');
  const hadBundle = existsSync(distBundle);
  const bundleBefore = hadBundle ? readFileSync(distBundle, 'utf8') : null;

  try {
    writeFileSync(distBundle, bundleJs);
    writeFileSync(distIndex, injectBundleScript(indexBefore, gameName));
    run(npmCmd, ['run', 'tauri', '--', 'build', '--config', 'src-tauri/tauri.player.conf.json']);
  } finally {
    writeFileSync(distIndex, indexBefore);
    if (hadBundle) writeFileSync(distBundle, bundleBefore);
    else rmSync(distBundle, { force: true });
  }

  const bundleDir = resolve(root, 'src-tauri/target/release/bundle');
  console.log(`\nOK: Native build complete. Installers are in:\n  ${bundleDir}/`);

  const nativeOut = resolve(outRoot, `${slug}-native`);
  const collected = collectInstallers(bundleDir);
  if (collected.length) {
    rmSync(nativeOut, { recursive: true, force: true });
    mkdirSync(nativeOut, { recursive: true });
    for (const src of collected) cpSync(src, resolve(nativeOut, basename(src)), { recursive: true });
    console.log(`OK: Native app copied -> ${nativeOut}`);
  } else {
    console.warn('WARNING: No native installers were found to copy.');
  }
}

if (opts.zip) zipFolder(webOut);
if (opts.open) openPath(webOut);

console.log('\nDone. Share the web folder/zip, or install the native app from the native output folder.\n');
