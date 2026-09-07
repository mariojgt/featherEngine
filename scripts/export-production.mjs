#!/usr/bin/env node
// Production export assembler for Feather Engine games.
//
// A build profile is embedded in game.json and can optionally be supplied with --profile. The
// selected targets are exact OS/store targets rather than an ambiguous "desktop" switch:
// web, windows, macos, linux, android, ios.
//
// Usage:
//   node scripts/export-production.mjs [--bundle <game.json>] [--profile <profile.json>]
//     [--targets web,macos,android] [--out <dir>] [--fast] [--skip-build] [--zip] [--open]
//
// Legacy flags remain supported: --native, --android, --ios, --no-web.
import { execFileSync } from 'node:child_process';
import { artifactInventory, engineEvidence, sha256 } from './lib/release-evidence.mjs';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  diagnosePlatforms,
  findAndroidSdk,
  findAndroidNdk,
  findMacCodeSigningIdentity,
  hasAppleCodeSigningIdentity,
} from './platform-doctor.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET_IDS = new Set(['web', 'windows', 'macos', 'linux', 'android', 'ios']);
const DESKTOP_TARGETS = new Set(['windows', 'macos', 'linux']);
const HOST_DESKTOP_TARGET =
  process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux';

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

function fail(message) {
  console.error(`\nERROR: ${message}\n`);
  process.exit(1);
}

function processIsRunning(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

/** Serialize all exporters because dist-player and Tauri's generated mobile folders are shared. */
function acquireBuildLock() {
  const lock = resolve(root, 'src-tauri/target/nodeforge-export.lock');
  mkdirSync(dirname(lock), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      mkdirSync(lock);
      writeFileSync(
        resolve(lock, 'owner.json'),
        `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }, null, 2)}\n`,
      );
      let released = false;
      return () => {
        if (released) return;
        released = true;
        rmSync(lock, { recursive: true, force: true });
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      let owner = null;
      try {
        owner = JSON.parse(readFileSync(resolve(lock, 'owner.json'), 'utf8'));
      } catch {
        fail(
          'Another production export is acquiring the build lock. Wait a moment and retry. ' +
            'If no build is running, remove src-tauri/target/nodeforge-export.lock.',
        );
      }
      if (processIsRunning(Number(owner?.pid))) {
        fail(
          `Another production export is already running (process ${owner.pid}). ` +
            'Wait for it to finish before starting another build.',
        );
      }
      rmSync(lock, { recursive: true, force: true });
    }
  }
  fail('Could not acquire the production export lock. Remove src-tauri/target/nodeforge-export.lock if no build is running.');
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

function run(cmd, args, env) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  const options = { cwd: root, stdio: 'inherit', env: env ? { ...process.env, ...env } : process.env };
  if (process.platform === 'win32') {
    const quote = (part) => {
      const text = String(part);
      return /[\s&()^%!<>|"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    execFileSync('cmd.exe', ['/d', '/c', [cmd, ...args].map(quote).join(' ')], options);
    return;
  }
  execFileSync(cmd, args, options);
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

/** Recursively find matching build outputs. Native `.app` bundles are directories and stay intact. */
function findArtifacts(dir, pattern, depth = 8) {
  if (depth < 0 || !existsSync(dir)) return [];
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (pattern.test(entry)) found.push(full);
    else if (stat.isDirectory()) found.push(...findArtifacts(full, pattern, depth - 1));
  }
  return found;
}

/** Copy build artifacts into a fresh `<out>/<slug>-<target>/` folder. */
function copyArtifacts(files, outRoot, slug, target) {
  if (!files.length) return null;
  const destination = resolve(outRoot, `${slug}-${target}`);
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  for (const source of files) cpSync(source, resolve(destination, basename(source)), { recursive: true });
  return destination;
}

function verifyMacAppSignatures(files) {
  const applications = files.filter((file) => /\.app$/i.test(file));
  if (!applications.length) throw new Error('The macOS build did not produce an application bundle to verify.');
  for (const application of applications) {
    try {
      execFileSync('codesign', ['--verify', '--deep', '--strict', application], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      const detail = String(error?.stderr ?? error?.message ?? error).trim();
      throw new Error(`macOS code-signature verification failed for ${basename(application)}: ${detail}`);
    }
  }
}

function injectBundleScript(html, title) {
  let output = html.replace(/<title>[^<]*<\/title>/i, `<title>${title.replace(/[<>&]/g, '')}</title>`);
  if (!output.includes('game-bundle.js')) {
    output = output.replace(/(<script\b[^>]*\bsrc=)/i, '<script src="./game-bundle.js"></script>\n    $1');
  }
  return output;
}

function zipFolder(folder) {
  const zipPath = `${folder}.zip`;
  rmSync(zipPath, { force: true });
  if (process.platform === 'win32') {
    const stage = mkdtempSync(join(tmpdir(), 'feather-export-'));
    try {
      const stagedFolder = resolve(stage, basename(folder));
      cpSync(folder, stagedFolder, { recursive: true });
      run('powershell', [
        '-NoProfile',
        '-Command',
        `Compress-Archive -Path '${stagedFolder}' -DestinationPath '${zipPath}'`,
      ]);
    } finally {
      rmSync(stage, { recursive: true, force: true });
    }
  } else {
    execFileSync('zip', ['-r', '-q', zipPath, '.'], { cwd: folder, stdio: 'inherit' });
  }
  console.log(`\nOK: Zipped -> ${zipPath}`);
}

function readProfile(pathOption) {
  if (!pathOption) return null;
  if (pathOption === true) fail('--profile requires a JSON file path.');
  const profilePath = resolve(root, pathOption);
  if (!existsSync(profilePath)) fail(`Build profile not found: ${profilePath}`);
  try {
    return JSON.parse(readFileSync(profilePath, 'utf8'));
  } catch (error) {
    fail(`Build profile is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function selectedTargets(opts, profile) {
  let requested;
  if (typeof opts.targets === 'string') {
    requested = opts.targets.split(',').map((target) => target.trim()).filter(Boolean);
  } else if (opts.targets === true) {
    fail('--targets requires a comma-separated list.');
  } else if (opts.native || opts.android || opts.ios || opts['no-web']) {
    requested = opts['no-web'] ? [] : ['web'];
    if (opts.native) requested.push(HOST_DESKTOP_TARGET);
    if (opts.android) requested.push('android');
    if (opts.ios) requested.push('ios');
  } else {
    requested = [...profile.targets];
  }

  const unique = [...new Set(requested)];
  if (unique.length !== requested.length) fail('Export targets must not contain duplicates.');
  if (!unique.length) fail('Select at least one export target.');
  for (const target of unique) {
    if (!TARGET_IDS.has(target)) fail(`Unknown export target: ${target}`);
  }
  return unique;
}

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const opts = parseArgs(process.argv.slice(2));
const bundlePath = resolve(root, typeof opts.bundle === 'string' ? opts.bundle : 'exports/staging/game.json');
const outRoot = resolve(root, typeof opts.out === 'string' ? opts.out : 'exports');
const distPlayer = resolve(root, 'dist-player');

/** Reuse the editor/player's real loader, migrations, profile validation and runtime parity audit. */
async function validateAndAuditBundle(raw, profileOverride, nameOverride) {
  const { createServer } = await import('vite');
  const vite = await createServer({
    root,
    configFile: false,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true },
  });
  try {
    const [bundleModule, auditModule] = await Promise.all([
      vite.ssrLoadModule('/src/project/exportGame.ts'),
      vite.ssrLoadModule('/src/project/verifyBundle.ts'),
    ]);
    const loaded = bundleModule.readGameBundle(raw);
    let profile = structuredClone(profileOverride ?? loaded.buildProfile);
    if (nameOverride) {
      profile = {
        ...profile,
        application: { ...profile.application, productName: nameOverride },
        window: { ...profile.window, title: nameOverride },
      };
    }
    const settings = loaded.project.exportSettings;
    const hasProfile = settings.profiles.some((candidate) => candidate.id === profile.id);
    const project = {
      ...loaded.project,
      exportSettings: {
        ...settings,
        activeProfileId: profile.id,
        profiles: hasProfile
          ? settings.profiles.map((candidate) => (candidate.id === profile.id ? profile : candidate))
          : [...settings.profiles, profile],
      },
    };
    const canonicalBundle = bundleModule.buildGameBundle(project, profile);
    return {
      bundle: canonicalBundle,
      loaded: { ...loaded, project, buildProfile: profile, runtimeContract: canonicalBundle.runtimeContract },
      report: auditModule.verifyGameBundle(canonicalBundle),
    };
  } finally {
    await vite.close();
  }
}

if (!existsSync(bundlePath)) {
  fail(
    `No game bundle found at ${bundlePath}\n` +
      '  Export one from the editor Production button, or pass --bundle <game.json>.',
  );
}

let rawBundle;
try {
  rawBundle = JSON.parse(readFileSync(bundlePath, 'utf8'));
} catch (error) {
  fail(`${bundlePath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
}

let preflight;
try {
  preflight = await validateAndAuditBundle(rawBundle, readProfile(opts.profile), typeof opts.name === 'string' ? opts.name : null);
} catch (error) {
  fail(
    `${bundlePath} cannot be loaded by this Feather Engine player:\n` +
      `  ${error instanceof Error ? error.message : String(error)}\n` +
      '  Open and re-export the project with this engine version, then try again.',
  );
}

const bundle = preflight.bundle;
const profile = bundle.buildProfile;
const targets = selectedTargets(opts, profile);
const gameName = profile.application.productName;
const slug = slugify(gameName);
const hasInjectedAppleCertificate = Boolean(process.env.APPLE_CERTIFICATE?.trim());
const macSigningIdentity =
  targets.includes('macos') && process.platform === 'darwin'
    ? findMacCodeSigningIdentity() ?? (hasInjectedAppleCertificate ? null : '-')
    : null;
const targetsToStage = targets.filter(
  (target) =>
    (DESKTOP_TARGETS.has(target) && target !== HOST_DESKTOP_TARGET) ||
    (target === 'ios' && process.platform !== 'darwin'),
);

{
  const project = bundle.project;
  const objectCount = project.scenes.reduce((count, scene) => count + (scene.objects?.length ?? 0), 0);
  console.log(
    `\nProfile: ${profile.name} | ${profile.configuration} | ${targets.join(', ')}\n` +
      `Contents: ${project.scenes.length} scenes / ${objectCount} objects | ` +
      `${project.blueprints.length} blueprints | ${project.materials.length} materials | ` +
      `${project.particleSystems.length} particles | ${project.prefabs.length} prefabs | ` +
      `${project.assets.length} resources`,
  );
  console.log(
    `Runtime parity contract: ${bundle.runtimeContract.version} (` +
      `${preflight.report.runtimeFeatures.length ? preflight.report.runtimeFeatures.join(', ') : 'core scene runtime'})`,
  );
  for (const warning of preflight.report.warnings) console.warn(`WARNING: ${warning}`);
  if (preflight.report.errors.length) {
    console.error(`\nERROR: Production preflight found ${preflight.report.errors.length} blocking issue(s):`);
    for (const error of preflight.report.errors) console.error(`   - ${error}`);
    fail('Fix these runtime/resource references in the editor and export a new game.json. No artifacts were written.');
  }
}

const releaseBuildLock = acquireBuildLock();
process.once('exit', releaseBuildLock);
mkdirSync(outRoot, { recursive: true });
for (const target of targets) {
  rmSync(resolve(outRoot, `${slug}-${target}`), { recursive: true, force: true });
  rmSync(resolve(outRoot, `${slug}-${target}-staging`), { recursive: true, force: true });
}
rmSync(resolve(outRoot, `${slug}-build-report.json`), { force: true });
if (targets.includes('web')) rmSync(resolve(outRoot, `${slug}-web.zip`), { force: true });

const needsLocalPlayer = targets.some((target) => !targetsToStage.includes(target));
if (needsLocalPlayer) {
  if (!opts['skip-build']) {
    run(npmCmd, ['run', opts.fast ? 'build:player:fast' : 'build:player']);
  } else if (!existsSync(distPlayer)) {
    fail('--skip-build was set but dist-player/ does not exist. Build it first.');
  } else {
    console.log('\nReusing existing dist-player/ (--skip-build).');
  }
} else {
  console.log('\nNo local player build is needed; every selected target is being staged for another runner.');
}

const bundleJs = `window.__NODEFORGE_GAME__ = ${JSON.stringify(bundle)};\n`;
const builtTargets = [];
const stagedTargets = [];
const outputDirectories = [];
const buildFailures = new Map();
const packagingWarnings = [...preflight.report.warnings];
if (targets.includes('macos')) {
  packagingWarnings.push(
    targetsToStage.includes('macos')
      ? 'The macOS runner must verify Developer ID signing and Apple notarization before public distribution.'
      : macSigningIdentity === '-'
      ? 'macOS artifacts are ad-hoc signed and verified for local testing; configure a Developer ID Application identity and Apple notarization for public distribution.'
      : 'macOS code signing is verified, but Apple notarization is not verified by this exporter.',
  );
}
if (targets.includes('windows')) {
  packagingWarnings.push('Windows artifact generation does not verify Authenticode signing.');
}
if (targets.includes('android') && profile.configuration === 'release') {
  packagingWarnings.push('Android AAB generation does not verify your Play Store release keystore configuration.');
}
const buildReport = {
  formatVersion: '1.2.0',
  engine: engineEvidence(root),
  bundleSha256: sha256(JSON.stringify(bundle)),
  contentInventory: { scenes: bundle.project.scenes.map((scene) => ({ id: scene.id, name: scene.name, objects: scene.objects.length })), assets: bundle.project.assets.map((asset) => ({ id: asset.id, name: asset.name, type: asset.type, bytes: asset.size, copyright: asset.modelInspection?.stats?.copyright ?? null })) },
  builtAt: new Date().toISOString(),
  bundleVersion: bundle.bundleVersion,
  projectVersion: bundle.project.version,
  runtimeContract: bundle.runtimeContract,
  profile,
  targets,
  builtTargets,
  stagedTargets,
  contents: preflight.report.summary,
  warnings: packagingWarnings,
};

function writeBuildReport(directory) {
  const credits = bundle.project.assets.filter((asset) => asset.modelInspection?.stats?.copyright).map((asset) => `${asset.name}: ${asset.modelInspection.stats.copyright}`);
  writeFileSync(resolve(directory, 'ASSET-CREDITS.txt'), ['Asset attribution supplied by imported models', '', ...(credits.length ? credits : ['No embedded model copyright metadata was supplied.']), '', 'Review your asset licenses before distributing this game.'].join('\n'));
  const report = { ...buildReport, artifacts: artifactInventory(directory) };
  writeFileSync(resolve(directory, 'build-report.json'), `${JSON.stringify(report, null, 2)}\n`);
}

let webOut = null;
if (targets.includes('web')) {
  webOut = resolve(outRoot, `${slug}-web`);
  rmSync(webOut, { recursive: true, force: true });
  mkdirSync(webOut, { recursive: true });
  cpSync(distPlayer, webOut, { recursive: true });
  writeFileSync(resolve(webOut, 'game-bundle.js'), bundleJs);
  const webIndex = resolve(webOut, 'index.html');
  writeFileSync(webIndex, injectBundleScript(readFileSync(webIndex, 'utf8'), gameName));
  writeFileSync(
    resolve(webOut, 'README.txt'),
    `${gameName}\n${'='.repeat(gameName.length)}\n\n` +
      `Version ${profile.application.version} (build ${profile.application.buildNumber})\n` +
      `Launch scene: ${profile.startSceneId}\n\n` +
      'Upload/serve this entire folder from any static web server. Do not open index.html with\n' +
      'file:// because browsers block module/resource loading there.\n\n' +
      'Built with Feather Engine from the same runtime used by editor Play.\n',
  );
  builtTargets.push('web');
  outputDirectories.push(webOut);
  console.log(`\nOK: Hosted web build -> ${webOut}`);
}

for (const target of targetsToStage) {
  const stagedOut = resolve(outRoot, `${slug}-${target}-staging`);
  mkdirSync(stagedOut, { recursive: true });
  writeFileSync(resolve(stagedOut, 'game.json'), `${JSON.stringify(bundle, null, 2)}\n`);
  writeFileSync(resolve(stagedOut, 'export-profile.json'), `${JSON.stringify(profile, null, 2)}\n`);
  writeFileSync(
    resolve(stagedOut, 'README.txt'),
    `${gameName} — ${target} build staging\n\n` +
      `This target requires a ${target} build runner. Copy game.json to the Feather Engine source tree and run:\n\n` +
      `  npm run export:build -- --bundle "<path>/game.json" --profile "<path>/export-profile.json" --targets ${target}\n\n` +
      'For Windows/macOS/Linux you can also use .github/workflows/export-desktop.yml.\n',
  );
  stagedTargets.push(target);
  outputDirectories.push(stagedOut);
  console.log(`\nSTAGED: ${target} -> ${stagedOut} (package it on a ${target} runner)`);
}

/** Temporarily bake this exact canonical bundle into the reusable player build. */
function withBakedBundle(fn) {
  const distIndex = resolve(distPlayer, 'index.html');
  const distBundle = resolve(distPlayer, 'game-bundle.js');
  const indexBefore = readFileSync(distIndex, 'utf8');
  const hadBundle = existsSync(distBundle);
  const bundleBefore = hadBundle ? readFileSync(distBundle, 'utf8') : null;
  try {
    writeFileSync(distBundle, bundleJs);
    writeFileSync(distIndex, injectBundleScript(indexBefore, gameName));
    return fn();
  } finally {
    writeFileSync(distIndex, indexBefore);
    if (hadBundle) writeFileSync(distBundle, bundleBefore);
    else rmSync(distBundle, { force: true });
  }
}

/** Generate per-game Tauri metadata without mutating the engine/player base configuration. */
function createPlayerConfig() {
  const base = JSON.parse(readFileSync(resolve(root, 'src-tauri/tauri.player.conf.json'), 'utf8'));
  const baseWindow = base.app?.windows?.[0] ?? {};
  const config = {
    ...base,
    productName: profile.application.productName,
    version: profile.application.version,
    identifier: profile.application.identifier,
    build: { ...base.build, frontendDist: distPlayer, beforeBuildCommand: '' },
    app: {
      ...base.app,
      windows: [
        {
          ...baseWindow,
          title: profile.window.title,
          width: profile.window.width,
          height: profile.window.height,
          minWidth: profile.window.minWidth,
          minHeight: profile.window.minHeight,
          resizable: profile.window.resizable,
          fullscreen: profile.window.fullscreen,
        },
      ],
    },
    bundle: {
      ...base.bundle,
      macOS: {
        ...(base.bundle?.macOS ?? {}),
        bundleVersion: String(profile.application.buildNumber),
        ...(macSigningIdentity ? { signingIdentity: macSigningIdentity } : {}),
      },
      iOS: { ...(base.bundle?.iOS ?? {}), bundleVersion: String(profile.application.buildNumber) },
      android: { ...(base.bundle?.android ?? {}), versionCode: profile.application.buildNumber },
    },
  };
  delete config.$schema;
  const directory = mkdtempSync(join(tmpdir(), 'feather-player-config-'));
  const path = resolve(directory, 'tauri.player.generated.json');
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
  return { path, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

/**
 * Tauri mobile projects are generated around an application id. Keep one ignored cache per game,
 * swapping it into src-tauri/gen only for the build, so exporting one project can never stamp its
 * package id over another project (or over the engine's checked-in iOS scaffold).
 */
function withMobileProject(platform, fn) {
  const generated = resolve(root, 'src-tauri/gen', platform);
  const cache = resolve(
    root,
    'src-tauri/target/nodeforge-mobile',
    profile.application.identifier,
    platform,
  );
  const backup = resolve(root, 'src-tauri/target/nodeforge-mobile', `.restore-${platform}`);
  mkdirSync(dirname(cache), { recursive: true });
  // Recover the engine's original scaffold after an interrupted earlier export. The generated
  // project may be partial, so the preserved backup always wins.
  if (existsSync(backup)) {
    rmSync(generated, { recursive: true, force: true });
    renameSync(backup, generated);
  }
  if (existsSync(generated)) renameSync(generated, backup);
  const hadCache = existsSync(cache);
  if (hadCache) renameSync(cache, generated);
  let keepGenerated = hadCache;
  try {
    return fn({
      needsInit: !existsSync(generated),
      markInitialized: () => {
        keepGenerated = true;
      },
    });
  } finally {
    if (existsSync(generated)) {
      if (keepGenerated) renameSync(generated, cache);
      else rmSync(generated, { recursive: true, force: true });
    }
    if (existsSync(backup)) renameSync(backup, generated);
  }
}

const nativeTarget = targets.find((target) => target === HOST_DESKTOP_TARGET);
const buildIosHere = targets.includes('ios') && process.platform === 'darwin';
const needsTauri = Boolean(nativeTarget || targets.includes('android') || buildIosHere);
const playerConfig = needsTauri ? createPlayerConfig() : null;
const buildMode = profile.configuration === 'debug' ? 'debug' : 'release';
const platformReport = needsTauri ? diagnosePlatforms() : null;
const platformReadiness = (target) => platformReport?.platforms.find((entry) => entry.id === target);
const unmetRequirements = (target) =>
  platformReadiness(target)?.requirements.filter((requirement) => !requirement.ok).map((requirement) => requirement.label) ?? [];
const recordFailure = (target, error) => {
  const message = error instanceof Error ? error.message : String(error);
  buildFailures.set(target, message);
  console.error(`\nFAILED: ${target} — ${message}`);
};

try {
  if (nativeTarget && playerConfig) {
    try {
      const readiness = platformReadiness(nativeTarget);
      if (readiness && readiness.status !== 'ready') {
        throw new Error(
          `${nativeTarget} toolchain is not ready: ${unmetRequirements(nativeTarget).join(', ') || readiness.notes}. ` +
            'Run `npm run doctor` for setup instructions.',
        );
      }
      const args = ['run', 'tauri', '--', 'build', '--config', playerConfig.path];
      if (profile.configuration === 'debug') args.push('--debug');
      const nativeTargetDir = resolve(
        root,
        'src-tauri/target/nodeforge-exports',
        profile.application.identifier,
      );
      const nativeBundleDir = resolve(nativeTargetDir, buildMode, 'bundle');
      // Keep Cargo's compiled dependency cache, but remove old installers so a rename/version build can
      // never copy a stale artifact that happens to share this application's stable id.
      rmSync(nativeBundleDir, { recursive: true, force: true });
      withBakedBundle(() => run(npmCmd, args, { CARGO_TARGET_DIR: nativeTargetDir }));

      const installers = findArtifacts(nativeBundleDir, /\.(dmg|app|msi|exe|AppImage|deb|rpm)$/i);
      if (nativeTarget === 'macos') verifyMacAppSignatures(installers);
      const nativeOut = copyArtifacts(installers, outRoot, slug, nativeTarget);
      if (!nativeOut) throw new Error(`No ${nativeTarget} installer was found under ${nativeBundleDir}.`);
      builtTargets.push(nativeTarget);
      outputDirectories.push(nativeOut);
      console.log(`\nOK: ${nativeTarget} app -> ${nativeOut}`);
    } catch (error) {
      recordFailure(nativeTarget, error);
    }
  }

  if (targets.includes('android') && playerConfig) {
    try {
      const readiness = platformReadiness('android');
      if (readiness && readiness.status !== 'ready') {
        throw new Error(
          `Android toolchain is not ready: ${unmetRequirements('android').join(', ') || readiness.notes}. ` +
            'Run `npm run doctor` for setup instructions.',
        );
      }
      const sdk = findAndroidSdk();
      const ndk = findAndroidNdk(sdk);
      if (!sdk || !ndk) throw new Error('Android SDK/NDK not found. Run `npm run doctor` for setup instructions.');
      const androidEnv = {
        ANDROID_HOME: process.env.ANDROID_HOME || sdk,
        NDK_HOME: process.env.NDK_HOME || ndk,
      };
      withMobileProject('android', ({ needsInit, markInitialized }) => {
        if (needsInit) {
          console.log('\nInitializing the Android project for this application id…');
          run(npmCmd, ['run', 'tauri', '--', 'android', 'init', '--ci', '--config', playerConfig.path], androidEnv);
          markInitialized();
        }
        const outputs = resolve(root, 'src-tauri/gen/android/app/build/outputs');
        rmSync(outputs, { recursive: true, force: true });
        const args = ['run', 'tauri', '--', 'android', 'build'];
        if (profile.configuration === 'debug') args.push('--debug', '--apk');
        else args.push('--aab');
        args.push('--config', playerConfig.path);
        withBakedBundle(() => run(npmCmd, args, androidEnv));

        const packages = findArtifacts(outputs, /\.(apk|aab)$/i);
        const androidOut = copyArtifacts(packages, outRoot, slug, 'android');
        if (!androidOut) throw new Error(`No Android package was found under ${outputs}.`);
        builtTargets.push('android');
        outputDirectories.push(androidOut);
        console.log(`\nOK: Android ${profile.configuration === 'debug' ? 'APK' : 'AAB'} -> ${androidOut}`);
      });
    } catch (error) {
      recordFailure('android', error);
    }
  }

  if (buildIosHere && playerConfig) {
    try {
      withMobileProject('apple', ({ needsInit, markInitialized }) => {
        if (needsInit) {
          console.log('\nInitializing the iOS project for this application id…');
          run(npmCmd, ['run', 'tauri', '--', 'ios', 'init', '--ci', '--config', playerConfig.path]);
          markInitialized();
        }
        const readiness = platformReadiness('ios');
        if (readiness && readiness.status !== 'ready') {
          throw new Error(
            `iOS toolchain is not ready: ${unmetRequirements('ios').join(', ') || readiness.notes}. ` +
              'Run `npm run doctor`, then configure the cached Xcode project signing.',
          );
        }
        if (profile.configuration === 'release' && !hasAppleCodeSigningIdentity('release')) {
          throw new Error(
            'iOS Release requires an Apple Distribution signing identity and provisioning team. ' +
              'Install it in Xcode or use a Development profile for device testing.',
          );
        }
        const exportMethod = profile.configuration === 'debug' ? 'debugging' : 'app-store-connect';
        for (const stalePackage of findArtifacts(resolve(root, 'src-tauri/gen/apple'), /\.ipa$/i)) {
          rmSync(stalePackage, { force: true });
        }
        const args = [
          'run',
          'tauri',
          '--',
          'ios',
          'build',
          '--build-number',
          String(profile.application.buildNumber),
          '--export-method',
          exportMethod,
          '--config',
          playerConfig.path,
        ];
        if (profile.configuration === 'debug') args.push('--debug');
        withBakedBundle(() => run(npmCmd, args));

        const packages = findArtifacts(resolve(root, 'src-tauri/gen/apple'), /\.ipa$/i);
        const iosOut = copyArtifacts(packages, outRoot, slug, 'ios');
        if (!iosOut) throw new Error('The iOS build completed without producing an IPA.');
        builtTargets.push('ios');
        outputDirectories.push(iosOut);
        console.log(`\nOK: iOS IPA -> ${iosOut}`);
      });
    } catch (error) {
      recordFailure('ios', error);
      console.warn(
        `  Per-game Xcode sources are cached under src-tauri/target/nodeforge-mobile/${profile.application.identifier}/apple.\n` +
          '  Configure Signing & Capabilities there, then export again.',
      );
    }
  }
} finally {
  playerConfig?.cleanup();
}

const failedTargets = targets.filter(
  (target) => !builtTargets.includes(target) && !stagedTargets.includes(target),
);
buildReport.status = failedTargets.length ? 'incomplete' : stagedTargets.length ? 'staged' : 'complete';
buildReport.failedTargets = failedTargets;
buildReport.errors = [...buildFailures.entries()].map(([target, message]) => `${target}: ${message}`);
writeFileSync(resolve(outRoot, `${slug}-build-report.json`), `${JSON.stringify(buildReport, null, 2)}\n`);
for (const directory of outputDirectories) writeBuildReport(directory);
if (opts.zip) {
  if (webOut) zipFolder(webOut);
  else console.warn('\nWARNING: --zip was ignored because Web is not selected.');
}
if (opts.open) openPath(webOut ?? outRoot);

if (failedTargets.length) {
  console.error(
    `\nIncomplete export. Built: ${builtTargets.join(', ') || 'none'}. ` +
      `Failed: ${failedTargets.join(', ')}. Runtime contract ${bundle.runtimeContract.version} verified.\n`,
  );
  process.exitCode = 1;
} else if (stagedTargets.length) {
  console.log(
    `\nDone. Built: ${builtTargets.join(', ') || 'none'}. ` +
      `Staged for target runners: ${stagedTargets.join(', ')}. ` +
      `Runtime contract ${bundle.runtimeContract.version} verified.\n`,
  );
} else {
  console.log(`\nDone. Built: ${builtTargets.join(', ')}. Runtime contract ${bundle.runtimeContract.version} verified.\n`);
}

process.removeListener('exit', releaseBuildLock);
releaseBuildLock();
