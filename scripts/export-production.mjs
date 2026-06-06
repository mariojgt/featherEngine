#!/usr/bin/env node
// Production export assembler for NodeForge / Feather Engine games.
//
// Turns a self-contained game bundle (game.json, produced by the editor's
// "Export to Production" button) into shippable artifacts:
//
//   • a PORTABLE WEB FOLDER  — copy of the player build with the game baked in;
//                              runs by opening index.html in any browser.
//   • a NATIVE APP (--native) — wraps that folder in the Tauri "player" target,
//                              producing a real .app/.dmg (mac), .msi/.exe
//                              (windows) or .AppImage/.deb (linux) for the
//                              CURRENT operating system.
//
// Usage:
//   node scripts/export-production.mjs [--bundle <game.json>] [--name "<Game>"]
//                                      [--out <dir>] [--native] [--skip-build] [--zip]
//
// Defaults: --bundle exports/staging/game.json, --out exports/
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Minimal `--flag value` / `--flag` parser. */
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
    execFileSync('cmd.exe', ['/d', '/c', [cmd, ...args].map(quote).join(' ')], { cwd: root, stdio: 'inherit' });
    return;
  }
  execFileSync(cmd, args, { cwd: root, stdio: 'inherit' });
}

/** Find shippable installers/apps under a Tauri bundle dir (one level deep: macos/, dmg/, nsis/, …). */
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

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const opts = parseArgs(process.argv.slice(2));
const bundlePath = resolve(root, opts.bundle || 'exports/staging/game.json');
const outRoot = resolve(root, opts.out || 'exports');
const distPlayer = resolve(root, 'dist-player');

if (!existsSync(bundlePath)) {
  console.error(
    `\n✗ No game bundle found at ${bundlePath}\n` +
      `  Export one from the editor (Export to Production), or pass --bundle <game.json>.\n`,
  );
  process.exit(1);
}

const bundleRaw = readFileSync(bundlePath, 'utf8');
let bundle;
try {
  bundle = JSON.parse(bundleRaw);
} catch (err) {
  console.error(`\n✗ ${bundlePath} is not valid JSON: ${err.message}\n`);
  process.exit(1);
}

const gameName = opts.name || bundle?.project?.name || 'Game';
const slug = slugify(gameName);

// Inventory + resource check so CLI exports also flag anything missing.
{
  const p = bundle.project ?? {};
  const objectCount = (p.scenes ?? []).reduce((n, s) => n + (s.objects?.length ?? 0), 0);
  const assets = p.assets ?? [];
  const notEmbedded = assets.filter((a) => !a.data || a.unresolved);
  console.log(
    `\nContents: ${(p.scenes ?? []).length} scenes / ${objectCount} objects · ` +
      `${(p.blueprints ?? []).length} blueprints · ${(p.materials ?? []).length} materials · ` +
      `${(p.particleSystems ?? []).length} particles · ${(p.prefabs ?? []).length} prefabs · ` +
      `${assets.length} resources`,
  );
  if (notEmbedded.length) {
    console.warn(`⚠ ${notEmbedded.length} resource(s) NOT embedded:`);
    for (const a of notEmbedded) console.warn(`   - ${a.name ?? a.id} (${a.path ?? a.id})`);
  } else if (assets.length) {
    console.log('✓ All resources embedded.');
  }
}

// 1. Build the player runtime (dist-player/) unless told to reuse the existing build.
if (!opts['skip-build']) {
  run(npmCmd, ['run', 'build:player']);
} else if (!existsSync(distPlayer)) {
  console.error('\n✗ --skip-build was set but dist-player/ does not exist. Build it first.\n');
  process.exit(1);
}

// 2. Write the baked-in bundle as a global so the player boots from file:// with no fetch.
//    (See window.__NODEFORGE_GAME__ in src/player/Player.tsx.)
const bundleJs = `window.__NODEFORGE_GAME__ = ${JSON.stringify(bundle)};\n`;

/** Inject <script src="./game-bundle.js"> ahead of the player module script in an index.html. */
function injectBundleScript(html, title) {
  let out = html.replace(
    /<title>[^<]*<\/title>/i,
    `<title>${title.replace(/[<>&]/g, '')}</title>`,
  );
  if (!out.includes('game-bundle.js')) {
    out = out.replace(
      /(<script\b[^>]*\bsrc=)/i,
      '<script src="./game-bundle.js"></script>\n    $1',
    );
  }
  return out;
}

// 3. Assemble the portable web folder.
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
    `Portable web build. Open index.html in a browser to play — no install required.\n` +
    `To host it, serve this folder from any static web server.\n\n` +
    `Built with Feather Engine. Re-export from the editor to update.\n`,
);
console.log(`\n✓ Portable web build → ${webOut}`);

// 4. Optionally build a native app for the CURRENT OS via the Tauri player target.
if (opts.native) {
  // Bake the bundle into dist-player too so the packaged app runs offline.
  writeFileSync(resolve(distPlayer, 'game-bundle.js'), bundleJs);
  const distIndex = resolve(distPlayer, 'index.html');
  writeFileSync(distIndex, injectBundleScript(readFileSync(distIndex, 'utf8'), gameName));

  run(npmCmd, [
    'run',
    'tauri',
    '--',
    'build',
    '--config',
    'src-tauri/tauri.player.conf.json',
  ]);

  const bundleDir = resolve(root, 'src-tauri/target/release/bundle');
  console.log(`\n✓ Native build complete. Installers are in:\n  ${bundleDir}/`);

  // Copy the produced installers/apps into the chosen output folder so everything
  // ships from one place.
  const nativeOut = resolve(outRoot, `${slug}-native`);
  const collected = collectInstallers(bundleDir);
  if (collected.length) {
    rmSync(nativeOut, { recursive: true, force: true });
    mkdirSync(nativeOut, { recursive: true });
    for (const src of collected) {
      cpSync(src, resolve(nativeOut, basename(src)), { recursive: true });
    }
    console.log(`✓ Native app copied → ${nativeOut}`);
  }
}

// 5. Optional zip of the web folder (handy for sharing).
if (opts.zip) {
  const zipPath = `${webOut}.zip`;
  rmSync(zipPath, { force: true });
  if (process.platform === 'win32') {
    run('powershell', [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path '${webOut}/*' -DestinationPath '${zipPath}'`,
    ]);
  } else {
    execFileSync('zip', ['-r', '-q', zipPath, '.'], { cwd: webOut, stdio: 'inherit' });
  }
  console.log(`\n✓ Zipped → ${zipPath}`);
}

console.log('\nDone.\n');
