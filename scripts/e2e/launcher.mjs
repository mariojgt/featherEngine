/** Focused project-hub acceptance. No build, external AI request, or native filesystem writes.
 * E2E_BASE_URL=http://127.0.0.1:17443 node scripts/e2e/launcher.mjs
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { openEditor } from './harness.mjs';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:17443';
const output = process.env.LAUNCHER_REVIEW_DIR ?? '/tmp/feather-launcher-review';
await mkdir(output, { recursive: true });
const results = [];
const app = await openEditor({ baseUrl, readySelector: '.launcher', width: 1440, height: 900 });
const check = (message) => {
  results.push(message);
  console.log(`✓ ${message}`);
};
const loadStores = () =>
  app.evaluate(`(async () => {
  window.projects = (await import('/src/store/projectStore.ts')).useProjectStore;
  window.market = (await import('/src/store/marketplaceStore.ts')).useMarketplaceStore;
  window.editor = (await import('/src/store/editorStore.ts')).useEditorStore;
})()`);
const fill = (selector, value) =>
  app.evaluate(`(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  const prototype = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value').set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
const screenshot = async (name) => {
  await app.evaluate(`document.fonts.ready`);
  await app.evaluate(
    `Promise.all([...document.querySelectorAll('.launcher img')].map(img => img.decode().catch(() => {})))`,
  );
  const shot = await app.page.call('Page.captureScreenshot', { format: 'png' });
  await writeFile(`${output}/${name}.png`, Buffer.from(shot.data, 'base64'));
};
const back = async () => {
  await app.evaluate(`projects.getState().closeProject()`);
  await app.waitFor(`document.querySelector('.launcher')`);
};
const reveal = (selector) =>
  app.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: 'center' })`);
try {
  await loadStores();
  await app.waitFor(`market.getState().status === 'ready'`, { label: 'catalog' });
  for (const [width, height] of [
    [1440, 900],
    [1280, 800],
    [390, 844],
  ]) {
    await app.page.call('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await app.evaluate(`document.querySelector('.launcher').scrollTop = 0`);
    await screenshot(`launcher-${width}x${height}`);
    assert.equal(
      await app.evaluate(`document.querySelector('.launcher').scrollWidth <= innerWidth`),
      true,
      'no horizontal overflow',
    );
    assert.equal(await app.evaluate(`document.querySelector('.hub-ai').open`), false);
    if (width === 390) {
      await reveal('.hub-library');
      await screenshot('launcher-390x844-library');
    }
    check(`${width}×${height}: renders without horizontal overflow; AI collapsed`);
  }
  await app.page.call('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await app.evaluate(`document.querySelector('.launcher').scrollTop = 0`);
  assert.equal(await app.count('.hub-world--featured'), 1);
  assert.equal(
    await app.count('.hub-world[data-template-slug="template-platformer"]'),
    0,
    'Platformer has one offline entry',
  );
  assert.equal(await app.count('[data-quick-start="parcel-panic"]'), 1, 'Parcel Panic has one offline entry');
  assert.equal(await app.count('.hub-world[data-template-slug="template-parcel-panic"]'), 0);
  assert.ok(!(await app.text('[data-quick-start="parcel-panic"]')).includes('Cloudstep'));
  assert.equal(await app.count('.hub-world'), 4);
  await reveal('.hub-library-toggle');
  await app.realClick('.hub-library-toggle');
  assert.equal(
    await app.count('.hub-world'),
    await app.evaluate(
      `market.getState().packages.filter(p => p.kind === 'project' && !['template-platformer', 'template-parcel-panic', 'template-moba'].includes(p.slug)).length`,
    ),
  );
  assert.equal(await app.count('[data-quick-start]'), 6, 'every quick start has a single route');
  assert.equal(
    await app.evaluate(
      `[...document.querySelectorAll('.hub-world-image img')].every(img => img.complete && img.naturalWidth > 0)`,
    ),
    true,
  );
  await fill('.hub-search input', 'VeRdAnT');
  await app.waitFor(`document.querySelector('.hub-world')?.dataset.templateSlug === 'template-verdant'`);
  await fill('.hub-search input', 'no-such-world-xyz');
  await app.waitFor(
    `document.querySelector('.hub-catalog-message')?.textContent.includes('No worlds match')`,
  );
  assert.equal(await app.count('.hub-world'), 0);
  await app.realClick('.hub-search button');
  check(
    'All catalog starters accessible once; case-insensitive search, empty results and clear search',
  );

  // Quick-start cards retain their existing package route and the shared project name.
  await fill('#launcher-project-name', 'Library handoff');
  await app.evaluate(
    `window.packageAction = projects.getState().newProjectFromPackageUrl; projects.setState({ newProjectFromPackageUrl: async (url, name) => { window.packageHandoff = { url, name }; return true; } });`,
  );
  await reveal('[data-quick-start="third-person"]');
  await app.realClick('[data-quick-start="third-person"]');
  assert.equal(await app.evaluate(`packageHandoff.name`), 'Library handoff');
  assert.ok(await app.evaluate(`packageHandoff.url.includes('third-person')`));
  await app.evaluate(`projects.setState({ newProjectFromPackageUrl: window.packageAction });`);
  check('Catalog quick-start uses original package action and shared project name');

  // Exercise the real fetch failure/retry path and prove creation remains independent of the catalog.
  await app.page.call('Network.enable');
  await app.page.call('Network.setBlockedURLs', { urls: ['*/store/catalog.json*'] });
  await app.evaluate(`market.getState().load(true)`);
  await app.waitFor(`document.querySelector('.hub-catalog-error')`);
  assert.equal(
    await app.evaluate(
      `['blank', 'platformer', 'parcel-panic', 'moba'].some(id => document.querySelector('[data-quick-start="' + id + '"]').disabled)`,
    ),
    false,
  );
  await app.evaluate(`document.querySelector('.launcher').scrollTop = 0`);
  await screenshot('launcher-catalog-error');
  await fill('#launcher-project-name', 'Offline Deliveries');
  await app.evaluate(
    `window.starterAction = projects.getState().newProjectFromStarter; projects.setState({ newProjectFromStarter: async (name, template) => { window.starterHandoff = { name, template }; return true; } });`,
  );
  await reveal('[data-quick-start="parcel-panic"]');
  await app.realClick('[data-quick-start="parcel-panic"]');
  assert.equal(await app.evaluate(`starterHandoff.name`), 'Offline Deliveries');
  assert.equal(await app.evaluate(`starterHandoff.template`), 'parcel-panic');
  await app.evaluate(`projects.setState({ newProjectFromStarter: window.starterAction });`);
  check('Parcel Panic routes to its built-in starter with catalog fetch blocked');
  await fill('#launcher-project-name', 'Offline MOBA');
  await reveal('[data-quick-start="moba"]');
  await app.realClick('[data-quick-start="moba"]');
  await app.waitFor(
    `projects.getState().hasProject && !projects.getState().busy && editor.getState().scenes.some(s => s.name.includes('Lumen'))`,
    { label: 'offline MOBA created', timeout: 90_000 },
  );
  assert.equal(await app.evaluate(`projects.getState().projectName`), 'Offline MOBA');
  check('Lumen Lane creates its actual scene with catalog fetch blocked');
  await back();
  await fill('#launcher-project-name', 'Offline Platformer');
  await app.realClick('[data-quick-start="platformer"]');
  await app.waitFor(
    `projects.getState().hasProject && !projects.getState().busy && editor.getState().scenes.some(s => s.name.includes('Cloudstep'))`,
    { label: 'offline Platformer created', timeout: 90_000 },
  );
  assert.equal(await app.evaluate(`projects.getState().projectName`), 'Offline Platformer');
  check('Platformer creates actual Cloudstep scene with catalog fetch blocked');
  await back();
  await app.page.call('Network.setBlockedURLs', { urls: [] });
  await reveal('.hub-catalog-error button');
  await app.realClick('.hub-catalog-error button');
  await app.waitFor(`market.getState().status === 'ready' && document.querySelector('.hub-world')`);
  check('Retry restores catalog after network failure');

  await fill('#launcher-project-name', '  Fresh Canvas  ');
  await reveal('[data-quick-start="blank"]');
  await app.realClick('[data-quick-start="blank"]');
  await app.waitFor(`projects.getState().hasProject && !projects.getState().busy`);
  assert.equal(await app.evaluate(`projects.getState().projectName`), 'Fresh Canvas');
  assert.equal(await app.evaluate(`editor.getState().scenes.some(s => s.name.includes('Cloudstep'))`), false);
  check('Blank creates a fresh project with trimmed name');
  await back();

  await app.realClick('.hub-ai > summary');
  assert.equal(await app.evaluate(`document.querySelector('.launcher-primary').disabled`), true);
  await fill('#launcher-project-name', 'AI Adventure');
  await fill('#launcher-game-description', '  A garden adventure with three coins.  ');
  // Capture before the Agent; prevent any configured provider from making a request in this test.
  await app.evaluate(
    `window.aiHandoff = null; window.addEventListener('nf:ask-ai', event => { window.aiHandoff = { prompt: event.detail.prompt, name: projects.getState().projectName, hasProject: projects.getState().hasProject }; event.stopImmediatePropagation(); }, { capture: true, once: true });`,
  );
  await app.realClick('.launcher-primary');
  await app.waitFor(`window.aiHandoff`);
  assert.deepEqual(await app.evaluate(`window.aiHandoff`), {
    prompt: 'A garden adventure with three coins.',
    name: 'AI Adventure',
    hasProject: true,
  });
  check('AI creates named project then hands trimmed prompt to nf:ask-ai; empty prompt disabled');
  await back();

  // Delay a real action at the platform boundary to inspect the busy state deterministically.
  await app.evaluate(
    `(async () => { window.platform = await (await import('/src/platform/index.ts')).getPlatform(); window.originalCreate = platform.createProject; platform.createProject = () => new Promise(resolve => window.finishCreate = resolve); })()`,
  );
  await app.realClick('[data-quick-start="blank"]');
  await app.waitFor(`document.querySelector('.hub-busy')`);
  assert.equal(
    await app.evaluate(
      `[...document.querySelectorAll('.hub-basic, .hub-world, .hub-open, .hub-demo, .launcher-primary')].every(b => b.disabled)`,
    ),
    true,
  );
  assert.equal(await app.evaluate(`document.querySelector('main').getAttribute('aria-busy')`), 'true');
  await screenshot('launcher-busy');
  await app.evaluate(`window.finishCreate(null)`);
  await app.waitFor(`!projects.getState().busy`);
  await app.evaluate(
    `platform.createProject = async () => { throw new Error('Could not create this project. Please try again.'); }`,
  );
  await app.realClick('[data-quick-start="blank"]');
  await app.waitFor(`document.querySelector('.hub-error')`);
  assert.ok((await app.text('.hub-error')).includes('Please try again'));
  await screenshot('launcher-project-error');
  await app.evaluate(
    `platform.createProject = window.originalCreate; projects.getState().clearError(); market.setState({ status: 'loading', packages: [] });`,
  );
  await app.waitFor(`document.querySelector('.hub-catalog-message')?.textContent.includes('Loading')`);
  await screenshot('launcher-loading');
  assert.equal(
    await app.evaluate(`document.querySelector('[data-quick-start="platformer"]').disabled`),
    false,
  );
  await app.evaluate(`market.setState({ status: 'idle' }); market.getState().load(true)`);
  check(
    'Busy actions disabled; canceled create recovers; creation error visible; loading leaves offline choices enabled',
  );

  // Real open handler with an in-memory file returned by the platform picker boundary.
  await app.evaluate(
    `window.originalOpen = platform.openProject; platform.openProject = async () => ({ project: editor.getState().exportProject(), name: 'Opened file', dir: 'web' })`,
  );
  await app.realClick('.hub-open');
  await app.waitFor(`projects.getState().hasProject`);
  assert.equal(await app.evaluate(`projects.getState().projectName`), 'Opened file');
  await app.evaluate(`platform.openProject = window.originalOpen`);
  await back();
  check('Open project file delegates to platform picker and loads returned project');

  // Recovery must be present before Launcher mounts; use a valid exported project snapshot.
  await app.evaluate(
    `localStorage.setItem('nodeforge.recovery', JSON.stringify({ name: 'Recovered garden', dir: null, savedAt: Date.now(), project: editor.getState().exportProject() })); location.reload()`,
  );
  await app.waitFor(`document.querySelector('.launcher-recovery')`);
  await loadStores();
  await app.realClick('.launcher-recovery-restore');
  await app.waitFor(`projects.getState().hasProject`);
  assert.equal(await app.evaluate(`projects.getState().projectName`), 'Recovered garden');
  assert.equal(await app.evaluate(`editor.getState().isDirty`), true);
  await back();
  await app.evaluate(
    `localStorage.setItem('nodeforge.recovery', JSON.stringify({ name: 'Discard test', dir: null, savedAt: Date.now(), project: editor.getState().exportProject() })); location.reload()`,
  );
  await app.waitFor(`document.querySelector('.launcher-recovery')`);
  await app.realClick('.launcher-recovery-dismiss');
  assert.equal(await app.evaluate(`localStorage.getItem('nodeforge.recovery')`), null);
  check('Recovery restores valid unsaved work; discard clears saved recovery');

  // Desktop presentation and recent routes, with native boundaries stubbed (no disk writes).
  await app.page.call('Page.addScriptToEvaluateOnNewDocument', {
    source: `Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });`,
  });
  await app.evaluate(`location.reload()`);
  await app.waitFor(`document.querySelector('.launcher-platform')?.textContent.includes('Desktop')`);
  await loadStores();
  await app.evaluate(
    `projects.setState({ recentProjects: [{ dir: '/projects/garden', name: 'Garden study', lastOpened: Date.now() }], openRecent: async dir => { window.recentOpened = dir; } });`,
  );
  await app.waitFor(`document.querySelector('.launcher-recent-main')`);
  await screenshot('launcher-desktop-recent');
  await app.realClick('.launcher-recent-main');
  assert.equal(await app.evaluate(`window.recentOpened`), '/projects/garden');
  await app.evaluate(
    `(async () => { const native = await (await import('/src/platform/index.ts')).getPlatform(); native.revealFile = async dir => { window.revealed = dir; }; })()`,
  );
  await app.realClick('.launcher-recent-action[title="Show in folder"]');
  assert.equal(await app.evaluate(`window.revealed`), '/projects/garden');
  await app.realClick('.launcher-recent-action[title="Remove from recent"]');
  await app.waitFor(`document.querySelector('.hub-empty-recent')`);
  check('Desktop Recent, reveal, remove, and empty state retain their routes');

  await app.realClick('.hub-demo');
  await app.waitFor(`projects.getState().hasProject`);
  assert.equal(await app.evaluate(`projects.getState().projectName`), 'Demo (unsaved)');
  check('Explore demo opens the existing demo flow');
} finally {
  await writeFile(
    `${output}/report.json`,
    JSON.stringify(
      {
        baseUrl,
        checks: results,
        limits: [
          'Native dialogs and filesystem simulated at platform boundary; AI handoff intercepted before provider call.',
        ],
      },
      null,
      2,
    ),
  );
  await app.dispose();
}
console.log(`Launcher review: ${output}`);
