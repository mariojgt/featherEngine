#!/usr/bin/env node
import assert from 'node:assert/strict';
import { sha256 } from './lib/release-evidence.mjs';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distPlayer = resolve(root, 'dist-player');
const scratch = mkdtempSync(resolve(tmpdir(), 'feather-export-smoke-'));
const outputRoot = resolve(scratch, 'exports');
const fixturePath = resolve(root, 'scripts/fixtures/production-smoke-game.json');
const bundle = JSON.parse(readFileSync(fixturePath, 'utf8'));
const gameName = bundle.project.name;
const webOutput = resolve(outputRoot, 'portable-export-smoke-web');
const legacyName = 'Portable Export Legacy Smoke';
const legacyWebOutput = resolve(outputRoot, 'portable-export-legacy-smoke-web');
const browserEnabled = process.argv.includes('--browser');
const hostDesktopTarget = { darwin: 'macos', linux: 'linux', win32: 'windows' }[process.platform];
const stagedDesktopTarget = ['windows', 'macos', 'linux'].find(
  (target) => target !== hostDesktopTarget,
);

function walkFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const path = resolve(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) files.push(...walkFiles(path));
    else files.push(path);
  }
  return files;
}

function exportBundle(payload, name, fileName) {
  const bundlePath = resolve(scratch, fileName);
  writeFileSync(bundlePath, JSON.stringify(payload));
  execFileSync(
    process.execPath,
    [
      resolve(root, 'scripts/export-production.mjs'),
      '--bundle',
      bundlePath,
      '--out',
      outputRoot,
      '--name',
      name,
      '--skip-build',
    ],
    { cwd: root, stdio: 'inherit' },
  );
}

function assertAssembledPlayer(output, expectedBundle) {
  for (const required of ['index.html', 'game-bundle.js', 'README.txt', 'build-report.json']) {
    assert.ok(existsSync(resolve(output, required)), `portable export is missing ${required}`);
  }
  assert.ok(!existsSync(resolve(output, 'templates')), 'portable export copied editor-only templates');
  assert.ok(!existsSync(resolve(output, 'store')), 'portable export copied the editor-only marketplace');
  const buildReport = JSON.parse(readFileSync(resolve(output, 'build-report.json'), 'utf8'));
  assert.equal(buildReport.status, 'complete');
  assert.deepEqual(buildReport.targets, ['web']);
  assert.deepEqual(buildReport.builtTargets, ['web']);
  assert.deepEqual(buildReport.stagedTargets, []);
  assert.deepEqual(buildReport.failedTargets, []);
  assert.deepEqual(buildReport.errors, []);
  assert.match(buildReport.bundleSha256, /^[a-f0-9]{64}$/);
  assert.ok(buildReport.contentInventory.scenes.length);
  assert.ok(buildReport.artifacts.some((artifact) => artifact.path === 'game-bundle.js'));
  for (const artifact of buildReport.artifacts) {
    const bytes = readFileSync(resolve(output, artifact.path));
    assert.equal(bytes.length, artifact.bytes);
    assert.equal(sha256(bytes), artifact.sha256, `Checksum mismatch: ${artifact.path}`);
  }

  const files = walkFiles(output);
  const relativeFiles = files.map((file) => relative(output, file).replaceAll('\\', '/'));
  assert.ok(
    relativeFiles.every((file) => !file.startsWith('templates/')),
    'portable export contains files under templates/',
  );
  assert.ok(
    relativeFiles.every((file) => !file.startsWith('store/')),
    'portable export contains files under store/',
  );

  const index = readFileSync(resolve(output, 'index.html'), 'utf8');
  const bundleScriptPosition = index.indexOf('<script src="./game-bundle.js"></script>');
  const playerScriptPosition = index.search(/<script\b[^>]*\btype=["']module["']/i);
  assert.ok(bundleScriptPosition >= 0, 'portable export did not inject game-bundle.js');
  assert.ok(
    playerScriptPosition > bundleScriptPosition,
    'game-bundle.js must load before the player module starts',
  );

  // Every emitted relative script/style/image reference must survive the assembly copy.
  for (const match of index.matchAll(/(?:src|href)=["']\.\/([^"'#?]+)[^"']*["']/gi)) {
    assert.ok(existsSync(resolve(output, match[1])), `index.html references missing file: ${match[1]}`);
  }

  const bundleSource = readFileSync(resolve(output, 'game-bundle.js'), 'utf8');
  const prefix = 'window.__NODEFORGE_GAME__ = ';
  assert.ok(bundleSource.startsWith(prefix), 'game-bundle.js did not define the baked game global');
  const baked = JSON.parse(bundleSource.slice(prefix.length).replace(/;\s*$/, ''));
  if (expectedBundle) {
    assert.deepEqual(baked, expectedBundle, 'assembled player did not bake the requested canonical bundle exactly');
  }

  return { files, relativeFiles, baked };
}

function assertCrossHostStaging() {
  assert.ok(stagedDesktopTarget, `unsupported smoke-test host: ${process.platform}`);
  const bundlePath = resolve(scratch, 'game-cross-host.json');
  writeFileSync(bundlePath, JSON.stringify(bundle));
  execFileSync(
    process.execPath,
    [
      resolve(root, 'scripts/export-production.mjs'),
      '--bundle',
      bundlePath,
      '--out',
      outputRoot,
      '--name',
      gameName,
      '--targets',
      stagedDesktopTarget,
      '--skip-build',
    ],
    { cwd: root, stdio: 'inherit' },
  );

  const stagingOutput = resolve(
    outputRoot,
    `portable-export-smoke-${stagedDesktopTarget}-staging`,
  );
  for (const required of ['game.json', 'export-profile.json', 'README.txt', 'build-report.json']) {
    assert.ok(existsSync(resolve(stagingOutput, required)), `cross-host staging is missing ${required}`);
  }
  const report = JSON.parse(readFileSync(resolve(stagingOutput, 'build-report.json'), 'utf8'));
  assert.equal(report.status, 'staged');
  assert.deepEqual(report.targets, [stagedDesktopTarget]);
  assert.deepEqual(report.builtTargets, []);
  assert.deepEqual(report.stagedTargets, [stagedDesktopTarget]);
  assert.deepEqual(report.failedTargets, []);
}

try {
  assert.ok(existsSync(resolve(distPlayer, 'index.html')), 'dist-player is missing; build the player first');
  assert.ok(
    !existsSync(resolve(distPlayer, 'templates')),
    'dist-player must not contain editor-only starter templates',
  );
  assert.ok(
    !existsSync(resolve(distPlayer, 'store')),
    'dist-player must not contain the editor-only marketplace',
  );

  // Keep this fixture canonical and player-loadable. If the persisted schema grows, this list forces
  // the production fixture to be updated instead of silently exercising an obsolete partial object.
  assert.equal(bundle.bundleVersion, '1.1.0');
  assert.equal(bundle.project.version, '0.8.0');
  assert.equal(bundle.buildProfile.startSceneId, bundle.startSceneId);
  assert.deepEqual(bundle.runtimeContract.requiredFeatures, [
    'multi-scene',
    'blueprints',
    'ui-dom',
    'physics',
    'water',
    'cloth',
    'cables',
    'cinematics',
  ]);
  assert.ok(bundle.project.exportSettings?.profiles?.length, 'canonical fixture is missing export profiles');
  assert.ok(bundle.project.scenes.some((scene) => scene.id === bundle.startSceneId));
  assert.notEqual(
    bundle.project.activeSceneId,
    bundle.startSceneId,
    'canonical fixture must prove the player honors bundle.startSceneId over the editor-active scene',
  );
  for (const collection of [
    'assets',
    'folders',
    'variables',
    'dataAssets',
    'materials',
    'particleSystems',
    'skeletons',
    'skeletalMeshes',
    'animations',
    'animatorControllers',
    'uiDocuments',
    'blueprints',
    'graphs',
    'prefabs',
    'treeSpecs',
  ]) {
    assert.ok(Array.isArray(bundle.project[collection]), `canonical fixture is missing project.${collection}`);
  }
  assert.ok(
    bundle.project.assets.some((asset) => asset.data?.startsWith('data:image/svg+xml')),
    'canonical fixture must exercise an embedded resource',
  );

  exportBundle(bundle, gameName, 'game-current.json');

  // Exercise the player's real migration path, not merely the export assembler. Version 0.2 projects
  // legitimately predate these collections; the v0.7 migration must restore them before validation.
  const legacyBundle = structuredClone(bundle);
  legacyBundle.bundleVersion = '1.0.0';
  delete legacyBundle.buildProfile;
  delete legacyBundle.runtimeContract;
  delete legacyBundle.project.exportSettings;
  legacyBundle.project.version = '0.2.0';
  legacyBundle.project.name = legacyName;
  for (const collection of [
    'folders',
    'dataAssets',
    'materials',
    'particleSystems',
    'skeletons',
    'skeletalMeshes',
    'animations',
    'animatorControllers',
    'prefabs',
    'treeSpecs',
  ]) {
    delete legacyBundle.project[collection];
  }
  const legacyHeading = legacyBundle.project.uiDocuments[0].root.children.find(
    (element) => element.id === 'ui-heading',
  );
  assert.ok(legacyHeading, 'smoke fixture heading is missing');
  legacyHeading.text = 'FEATHER_LEGACY_MIGRATION_OK';
  exportBundle(legacyBundle, legacyName, 'game-legacy.json');

  const currentResult = assertAssembledPlayer(webOutput, bundle);
  const legacyResult = assertAssembledPlayer(legacyWebOutput, null);
  assertCrossHostStaging();
  assert.equal(legacyResult.baked.bundleVersion, '1.1.0');
  assert.equal(legacyResult.baked.project.version, '0.8.0');
  assert.ok(legacyResult.baked.project.exportSettings?.profiles?.length, 'legacy export did not migrate profiles');
  assert.ok(legacyResult.baked.runtimeContract?.requiredFeatures?.length, 'legacy export did not add runtime contract');

  const totalBytes = currentResult.files.reduce((total, file) => total + statSync(file).size, 0);
  const maximumPortableExportBytes = 25 * 1024 * 1024;
  assert.ok(
    totalBytes < maximumPortableExportBytes,
    `portable export is unexpectedly large: ${(totalBytes / 1024 / 1024).toFixed(1)} MB`,
  );

  if (browserEnabled) {
    const browserArgs = [
      resolve(root, 'scripts/player-browser-smoke.mjs'),
      '--dir',
      webOutput,
      '--legacy-dir',
      legacyWebOutput,
    ];
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        execFileSync(process.execPath, browserArgs, { cwd: root, stdio: 'inherit' });
        break;
      } catch (error) {
        if (attempt === 2) throw error;
        console.warn('WARNING: The headless browser process exited; retrying the runtime smoke once.');
      }
    }
  }

  console.log(
    `OK: Portable export smoke passed (${currentResult.relativeFiles.length} files, ${(totalBytes / 1024 / 1024).toFixed(1)} MB${browserEnabled ? ', browser runtime verified' : ''}).`,
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
