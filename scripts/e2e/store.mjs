/** Real hosted downloads and a downloaded project opened through the launcher file picker. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { openEditor } from './harness.mjs';

const config = JSON.parse(await readFile(new URL('../../store.config.json', import.meta.url), 'utf8'));
const published = JSON.parse(await readFile(new URL('../../public/store/catalog.json', import.meta.url), 'utf8'));

const app = await openEditor({ baseUrl: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:17427', readySelector: '.launcher' });
const chooser = () => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => { app.page.socket.off('message', listener); reject(new Error('File chooser did not open')); }, 30000);
  const listener = (raw) => {
    const event = JSON.parse(raw.toString());
    if (event.method !== 'Page.fileChooserOpened') return;
    clearTimeout(timeout); app.page.socket.off('message', listener); resolve(event.params.backendNodeId);
  };
  app.page.socket.on('message', listener);
});
try {
  await app.evaluate(`(async () => { window.__storeSmokeMarketplace = (await import('/src/store/marketplaceStore.ts')).useMarketplaceStore; })()`);
  await app.waitFor('window.__storeSmokeMarketplace.getState().status === "ready" || window.__storeSmokeMarketplace.getState().status === "error"');
  assert.equal(await app.evaluate('window.__storeSmokeMarketplace.getState().error'), null, 'Hosted catalog loads successfully');
  const listings = await app.evaluate(`(async () => (await import('/src/store/marketplaceStore.ts')).useMarketplaceStore.getState().packages)()`);
  assert.deepEqual(listings.map(entry => entry.id).sort(), published.packages.map(entry => entry.id).sort(), 'All published listings are available');
  assert.ok(listings.every(entry => entry.downloadUrl.startsWith(config.publicBaseUrl)), 'Downloads use the configured store project');
  await app.page.call('Page.setInterceptFileChooserDialog', { enabled: true });
  let selected = chooser();
  await app.realClick('[data-open-template-file]');
  const cancelledNode = await selected;
  const { object } = await app.page.call('DOM.resolveNode', { backendNodeId: cancelledNode });
  await app.page.call('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: 'function() { this.dispatchEvent(new Event("cancel")); }' });
  await app.waitFor('!document.querySelector("[data-open-template-file]").disabled');
  assert.equal(await app.count('.launcher'), 1, 'Cancel leaves the launcher available');
  selected = chooser();
  await app.realClick('[data-open-template-file]');
  await app.page.call('DOM.setFileInputFiles', { backendNodeId: await selected, files: [resolve('.feather-cache/store-fixtures/packages/projects/template-physics-lab.nfpack')] });
  await app.waitFor('document.querySelector(".toolbar")');
  const loaded = await app.evaluate(`({ project: window.__featherProject.projectName, scenes: window.__featherStore.scenes.length, objects: window.__featherStore.activeScene().objects.map(object => object.name) })`);
  assert.equal(loaded.project, 'My Game'); assert.equal(loaded.scenes, 1); assert.ok(loaded.objects.length > 3);
  const installed = await app.evaluate(`(async () => {
    const { useMarketplaceStore } = await import('/src/store/marketplaceStore.ts');
    const marketplace = useMarketplaceStore.getState();
    const template = marketplace.packages.find(entry => entry.slug === 'template-cinderfall');
    const { useProjectStore } = await import('/src/store/projectStore.ts');
    const before = window.__featherStore.prefabs.length;
    const imported = await useProjectStore.getState().importPackageFromUrl(template.downloadUrl);
    return imported && window.__featherStore.prefabs.length > before;
  })()`);
  assert.ok(installed, 'Reusable content from a real hosted template imports additively into the opened project');
  const pluginActive = await app.evaluate(`(async () => {
    const { useMarketplaceStore } = await import('/src/store/marketplaceStore.ts');
    const marketplace = useMarketplaceStore.getState();
    const plugin = marketplace.packages.find(entry => entry.slug === 'arbor-forge');
    await marketplace.install(plugin);
    const { extensionRegistry } = await import('/src/extensions/host.ts');
    return extensionRegistry.hasPlugin(plugin.pluginId);
  })()`);
  assert.ok(pluginActive, 'A real hosted plugin downloads and activates');
  const hostedProject = await app.evaluate(`(async () => {
    const { useMarketplaceStore } = await import('/src/store/marketplaceStore.ts');
    const marketplace = useMarketplaceStore.getState();
    const template = marketplace.packages.find(entry => entry.slug === 'template-physics-lab');
    await marketplace.install(template);
    return { installed: useMarketplaceStore.getState().installedIds.includes(template.id), objects: window.__featherStore.activeScene().objects.length };
  })()`);
  assert.ok(hostedProject.installed && hostedProject.objects > 3, 'A real hosted project downloads and opens');
  console.log('Hosted store passed: configured live catalog, template picker/cancel, hosted content import, plugin activation, and project download/open.');
} finally { await app.dispose(); }
