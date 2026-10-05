/** Capture actual package content through Feather's renderer, then record byte-bound image provenance. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { openEditor } from '../e2e/harness.mjs';
import { delay } from '../e2e/cdp.mjs';
import { cacheDir, fixturesDir, packagePath, sha256 } from './files.mjs';

process.env.FEATHER_CDP_TIMEOUT_MS ??= '180000';

const args = process.argv.slice(2), slugArg = args.indexOf('--slug');
const only = slugArg < 0 ? null : args[slugArg + 1];
if (slugArg >= 0 && (!only || !/^[a-z0-9-]+$/.test(only))) throw new Error('Usage: npm run store:capture -- --slug <package-slug>');
const baseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:17427';
const catalog = JSON.parse(await readFile(resolve(cacheDir, 'catalog.json'), 'utf8'));
const config = JSON.parse(await readFile(new URL('../../store.config.json', import.meta.url), 'utf8'));
const entries = catalog.packages.filter(entry => only ? entry.slug === only : args.includes('--all') || config.websiteSlugs.includes(entry.slug));
if (!entries.length) throw new Error('That package is not in the staged catalog. Run npm run build:store.');
const directory = resolve(cacheDir, 'previews'); await mkdir(directory, { recursive: true });
const manifestPath = resolve(directory, 'captures.json');
const captures = JSON.parse(await readFile(manifestPath, 'utf8').catch(() => '{}'));
const resume = args.includes('--resume');

// Authored framing, never invented artwork. Coordinates are editable here for new template layouts.
const views = {
  'template-physics-lab': [[10, 8, -12], [0, 1, 0]],
  'template-spline-studio': [[7, 5, 10], [0, 1, 0]],
  'template-timeline-mechanics': [[13, 9, -17], [0, 1, 10]],
  'template-platformer': [[13, 8, -16], [0, 1, 5]],
  'template-parcel-panic': [[20, 15, -22], [0, 0.8, 5]],
  'template-third-person': [[10, 7, -12], [0, 1, 7]],
  'template-driving': [[9, 4, -9], [0, 0.8, 6]],
  'template-sim-racing': [[9, 4, -9], [0, 0.8, 6]],
  'template-moba': [[22, 24, -23], [0, 0, 0]],
  'template-tower-defense': [[11, 16, -11], [0, 0, 0]],
};

for (const entry of entries) {
  const bytes = await readFile(resolve(cacheDir, packagePath(entry))).catch(() => readFile(resolve(fixturesDir, packagePath(entry))));
  if (resume && captures[entry.slug]?.packageSha256 === sha256(bytes) && captures[entry.slug]?.images?.length) { console.log(`Reusing verified capture: ${entry.slug}.`); continue; }
  const app = await openEditor({ baseUrl, query: `store-capture.html?slug=${encodeURIComponent(entry.slug)}&kind=${entry.kind}`, readySelector: '[data-store-capture]', width: 1280, height: 800, timeoutMs: 120000 });
  const errors = [];
  app.page.socket.on('message', raw => { const event = JSON.parse(raw.toString()); if (event.method === 'Runtime.exceptionThrown') errors.push(event.params.exceptionDetails.exception?.description ?? event.params.exceptionDetails.text); });
  const images = [];
  const advance = async count => {
    for (let done = 0; done < count; done += 30) await app.evaluate(`(()=>{for(let i=0;i<${Math.min(30, count - done)};i++)__featherStore.tickRuntime(1/60)})()`);
    await app.evaluate('__storeCapture.render()');
  };
  const photo = async (alt) => {
    if (entry.kind !== 'plugin') {
      for (let i = 0; i < 3; i++) await app.evaluate('__storeCapture.render()');
      await app.waitFor('!window.__featherCaptureMetrics?.assetsLoading', { timeout: 120000 });
      await app.evaluate('__storeCapture.render()');
    }
    await app.evaluate('document.fonts.ready'); await delay(250);
    const data = Buffer.from((await app.page.call('Page.captureScreenshot', { format: 'png' })).data, 'base64');
    const file = `${entry.slug}-${String(images.length + 1).padStart(2, '0')}.webp`;
    await sharp(data).webp({ quality: 88 }).toFile(resolve(directory, file));
    const stats = await sharp(data).stats();
    if (stats.channels.slice(0, 3).every(channel => channel.mean < 2)) throw new Error(`${entry.slug}: preview is blank.`);
    images.push({ file, alt, width: 1280, height: 800 });
  };
  try {
    await app.waitFor('document.body.dataset.storeCapture || document.body.dataset.storeCaptureError', { timeout: 120000 });
    {
      const error = await app.evaluate('document.body.dataset.storeCaptureError');
      if (error) throw new Error(`${entry.slug}: ${error}`);
    }
    await app.evaluate('__storeCapture.freeze(true)');
    if (entry.kind === 'plugin') {
      await app.waitFor('document.querySelector("canvas")', { timeout: 120000 }); await delay(1500);
      await photo(entry.slug === 'model-forge' ? 'Model Forge editing the original Cinderfall survey rifle. The plugin activates the editor tool; this example model is shown for demonstration.' : 'Arbor Forge preset gallery, stylized tree preview, and planting controls in Feather Engine.');
    } else if (entry.kind === 'asset') {
      await app.evaluate('__storeCapture.render()');
      const documents = await app.evaluate('__featherStore.uiDocuments.filter(document=>!document.isComponent && document.surface==="screen").map(document=>({id:document.id,name:document.name}))');
      if (!documents.length) {
        await app.evaluate('__storeCapture.prepareAssetDisplay();__storeCapture.frame([6,4,10],[0,0.7,0])');
        await photo(`${entry.title}: included props, models, or materials on a neutral preview stage.`);
      } else for (const document of documents.slice(0, 3)) { await app.evaluate(`__storeCapture.showDocument(${JSON.stringify(document.id)})`); await photo(`${entry.title}: ${document.name}, rendered by Feather's actual runtime UI renderer.`); }
    } else {
      await advance(180);
      if (entry.slug === 'template-cinderfall') {
        await photo('Cinderfall expedition briefing, original cave art, and editable survey rifle in the actual Feather player.');
        await app.realClick('.cf-brief .cf-button');
        await app.evaluate('(async()=>{for(let i=0;i<25;i++)__featherStore.tickRuntime(1/60);await __storeCapture.render();})()');
        await photo('Cinderfall gameplay: live cargo and suit-integrity HUD, VX-24 magazine, aetherite veins, survey lights, and cavewardens.');
        await app.evaluate('__storeCapture.hideDocuments();__storeCapture.frame([6,2.6,-9],[-4,1,3])');
        await photo('Cinderfall cave overview: original faceted basalt, mineral seams, and industrial survey equipment.');
      } else {
        if (views[entry.slug]) { await app.evaluate(`__storeCapture.hideDocuments();__storeCapture.frame(${JSON.stringify(views[entry.slug][0])},${JSON.stringify(views[entry.slug][1])})`); }
        await photo(`${entry.title}: actual scene rendered from the downloadable package.`);
        const cinematic = await app.evaluate('__featherStore.runtimeCinematic ? { time:__featherStore.runtimeCinematic.time, duration:__featherStore.activeScene().cinematics?.find(c=>c.id===__featherStore.runtimeCinematic.sequenceId)?.duration } : null');
        if (cinematic && !views[entry.slug]) {
          await advance(240);
          await photo(`${entry.title}: another frame from the actual editable cinematic.`);
        }
      }
    }
    if (errors.length) throw new Error(`${entry.slug}: browser exceptions: ${errors.join('; ')}`);
    const latest = await readFile(resolve(cacheDir, packagePath(entry))).catch(() => readFile(resolve(fixturesDir, packagePath(entry))));
    if (sha256(latest) !== sha256(bytes)) throw new Error(`${entry.slug}: archive changed during capture. Run capture again after the final export.`);
    captures[entry.slug] = { packageSha256: sha256(bytes), capturedAt: new Date().toISOString(), method: 'Feather package renderer / Chrome screenshot', images };
    await writeFile(manifestPath, `${JSON.stringify(captures, null, 2)}\n`);
    console.log(`Captured ${entry.slug}: ${images.length} real preview${images.length === 1 ? '' : 's'}.`);
  } finally { await app.dispose(); }
}
console.log('Capture manifest saved. Review the images, run build:store again, then publish.');
