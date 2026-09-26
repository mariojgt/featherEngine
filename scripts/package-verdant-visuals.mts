import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { zipSync } from 'fflate';
import { readPackageArchive, verifyPackageIntegrity, writePackageArchive } from '../src/project/packageArchive';

// Publishable visual starter: the full local project keeps its score; this separate archive
// deliberately carries no generated audio or audio source URLs. Users add their own soundtrack.
const output = resolve(process.argv[2] ?? 'exports/cinematics/verdant');
const source = readPackageArchive(new Uint8Array(await readFile(resolve(output, 'verdant.nfpack'))));
await verifyPackageIntegrity(source);
const pkg = structuredClone(source.pkg);
const audioIds = new Set(pkg.assets.filter(asset => asset.type === 'audio').map(asset => asset.id));
assert.equal(audioIds.size, 3, 'Expected the mix and two editable stems');
pkg.assets = pkg.assets.filter(asset => !audioIds.has(asset.id)).map(({ source: _source, ...asset }) => asset);
pkg.meta.id = 'pkg-template-verdant-visuals';
pkg.meta.name = 'Verdant — Woodland Visual Template';
pkg.meta.description = 'Six editable landscape camera shots with embedded CC0 woodland art. No generated audio is included; add your own soundtrack. Code and scene logic follow the accompanying MIT license.';
for (const scene of pkg.content.scenes ?? []) {
  scene.cinematics = (scene.cinematics ?? []).filter(sequence => sequence.actions.some(action => action.type === 'camera')).map(sequence => ({
    ...sequence, actions: sequence.actions.filter(action => action.type !== 'sound'),
  }));
  scene.ambientSoundId = undefined;
  scene.musicSoundId = undefined;
}
const visualIds = source.pkg.assets.filter(asset => !audioIds.has(asset.id)).map(asset => asset.id).sort();
assert.deepEqual(pkg.assets.map(asset => asset.id).sort(), visualIds, 'Every source visual asset must remain');
assert.ok(!pkg.assets.some(asset => asset.type === 'audio'));
assert.ok([...audioIds].every(id => !JSON.stringify(pkg.content).includes(id)), 'No audio references may remain');
const bytes = new Map([...source.bytes].filter(([id]) => !audioIds.has(id)));
assert.equal(bytes.size, visualIds.length, 'Every visual asset must have embedded bytes');
assert.ok(visualIds.every(id => bytes.has(id)), 'Visual asset bytes must match the retained IDs');
const archive = writePackageArchive(pkg, bytes);
await verifyPackageIntegrity(readPackageArchive(archive));
await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'verdant-visuals.nfpack'), archive);
const guide = `# Verdant — Woodland Visual Template

Import verdant-visuals.nfpack as a project package in Feather Engine.
Play watches the 48-second film. R restarts it. Stop returns to editing.
Open Cinematic and select Verdant · A Woodland Study to edit six camera shots.
Select 01 · Woodland to change terrain and foliage; scene settings control light and wind.
Epic quality enables the shadow-aware volumetric canopy light and ground mist.
The five feature lower-thirds and final title are editable Text actions in Cinematic.
Add your own soundtrack as a Sound action at time 0.

This archive includes all ${visualIds.length} visual assets and no generated audio.
Scene code/logic: MIT (see LICENSE). Landscape scans/models: CC0 (see CREDITS.md).
All asset bytes are embedded; importing needs no external asset service.
Use the current engine version that includes the authored woodland renderer.
`;
const encoder = new TextEncoder();
await writeFile(resolve(output, 'VISUAL-TEMPLATE-README.md'), guide);
await writeFile(resolve(output, 'verdant-template.zip'), zipSync({
  'verdant-visuals.nfpack': [archive, { level: 0 }],
  'README.md': encoder.encode(guide),
  'LICENSE': new Uint8Array(await readFile('LICENSE')),
  'CREDITS.md': encoder.encode(`${await readFile('src/terrain/models/README.md', 'utf8')}\n${await readFile('src/terrain/models/verdant-credits.md', 'utf8')}\n${await readFile('src/terrain/surfaces/README.md', 'utf8')}`),
}));
console.log(JSON.stringify({ output, package: 'verdant-visuals.nfpack', share: 'verdant-template.zip', assets: pkg.assets.length, audioAssets: 0, embeddedAssets: bytes.size }));
