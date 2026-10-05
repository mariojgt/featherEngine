/** Build a portable, secret-free game bundle from the exact store archive. */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { readPackageFile } from '../src/project/packageArchive';
import { blankProject } from '../src/project/serialize';
import { buildGameBundle } from '../src/project/exportGame';
import { verifyGameBundle } from '../src/project/verifyBundle';
const archive = readPackageFile(new Uint8Array(await readFile('.feather-cache/store/packages/projects/ember-meadow.nfpack')));
const project = { ...blankProject('Ember Meadow'), ...archive.pkg.content,
  activeSceneId: archive.pkg.content.scenes![0].id, scenes: archive.pkg.content.scenes!,
  assets: archive.pkg.assets.map(asset => ({ ...asset, source: undefined, data: `data:model/gltf-binary;base64,${Buffer.from(archive.bytes.get(asset.id)!).toString('base64')}` })),
};
project.exportSettings.profiles.forEach(profile => { profile.startSceneId = project.activeSceneId; profile.includeDebugOverlay = false; });
const bundle = buildGameBundle(project);
const report = await verifyGameBundle(bundle);
if (!report.ok) throw new Error(report.errors.join('\n'));
await mkdir('exports/titan', { recursive: true });
await writeFile('exports/titan/game.json', JSON.stringify(bundle));
console.log(`Built exports/titan/game.json: ${report.assets.length} embedded assets, runtime ${report.runtimeFeatures.join(', ')}`);
