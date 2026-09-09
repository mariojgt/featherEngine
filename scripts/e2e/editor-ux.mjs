/** Real browser coverage of the editor's object → hierarchy → inspector workflow. */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { openEditor } from './harness.mjs';
import { delay } from './cdp.mjs';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:17420';
const shotDir = resolve(process.env.EDITOR_UX_SHOT_DIR ?? 'artifacts/editor-ux');
const fixtureDir = await mkdtemp(join(tmpdir(), 'feather-editor-ux-'));
await mkdir(shotDir, { recursive: true });
const app = await openEditor({ baseUrl, query: '?demo=store', width: 1440, height: 987 });
const errors = [];
app.page.socket.on('message', (raw) => {
  const message = JSON.parse(raw.toString());
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
});
const key = async (name, modifiers = 0, code = name) => {
  const vk = ({ Enter: 13, Tab: 9, Escape: 27, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, Home: 36, End: 35 })[name] ?? name.toUpperCase().charCodeAt(0);
  // Chrome only runs a control's default action (Enter activating a focused button, select
  // type-ahead) when the key event carries text, which rawKeyDown deliberately omits.
  const text = modifiers ? undefined : name === 'Enter' ? '\r' : name.length === 1 ? name : undefined;
  await app.page.call('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key: name, code, modifiers, windowsVirtualKeyCode: vk, ...(text ? { text } : {}) });
  await app.page.call('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, modifiers, windowsVirtualKeyCode: vk });
};
const fill = async (selector, value) => {
  await app.realClick(selector);
  // Select the existing text through the DOM: Cmd+A over CDP is handled natively by the browser
  // process on macOS and does not reliably reach the focused field.
  await app.evaluate(`(() => { const el = document.activeElement; try { el.select(); } catch { el.setSelectionRange?.(0, el.value.length); } })()`);
  await app.page.call('Input.insertText', { text: value });
};
const clickText = async (scope, text) => {
  const selector = await app.evaluate(`(() => { const buttons = [...document.querySelectorAll(${JSON.stringify(scope)})]; const index = buttons.findIndex(b => b.textContent.trim() === ${JSON.stringify(text)}); if (index < 0) return null; buttons[index].setAttribute('data-ux-target','true'); return '[data-ux-target="true"]'; })()`);
  assert.ok(selector, `Visible action exists: ${text}`);
  await app.realClick(selector);
  await app.evaluate(`document.querySelector('[data-ux-target]')?.removeAttribute('data-ux-target')`);
};
/** Choose an option in a native <select>. Chrome renders the option list in the browser process,
 *  so CDP key events cannot drive it; this still runs the app's real change handler. */
const choose = async (selector, value) => {
  await app.realClick(selector);
  await app.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
};
const screenshot = async (name) => {
  const shot = await app.page.call('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(shotDir, `${name}.png`), Buffer.from(shot.data, 'base64'));
};
const scene = `window.__featherStore.scenes.find(s => s.id === window.__featherStore.activeSceneId)`;
const selected = `${scene}.objects.find(o => o.id === window.__featherStore.selectedObjectId)`;
/** Click a picker row, scrolling the results list the way keyboard navigation does. */
const pick = async (id) => {
  await app.evaluate(`document.querySelector('[data-action-id=${JSON.stringify(id)}]')?.scrollIntoView({ block: 'center' })`);
  await app.realClick(`[data-action-id="${id}"]`);
};
const add = async (id) => { await app.realClick('.add-trigger'); await pick(id); };
try {
  await app.page.call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await app.waitFor(`document.querySelector('.scene-drop-zone canvas')`);
  assert.equal(await app.text('.add-trigger'), 'Add object');
  assert.equal(await app.count('.dv-tabs-and-actions-container'), 4);
  assert.match(await app.text('.inspector-empty'), /No object selected/);
  await screenshot('empty-editor');

  await app.realClick('.add-trigger');
  assert.equal(await app.evaluate(`document.activeElement.getAttribute('aria-label')`), 'Search objects…');
  assert.equal(await app.count('.editor-picker-result'), 9, 'Basic category is a short supported list');
  await screenshot('add-object');
  await fill('.editor-picker-search input', 'cube');
  await key('ArrowDown');
  assert.equal(await app.evaluate(`document.activeElement.dataset.actionId`), 'cube');
  await key('Enter');
  await app.waitFor(`document.querySelector('.name-input')?.value === 'Cube'`);
  assert.equal(await app.evaluate(`document.querySelector('.hierarchy-row.selected').dataset.objectId === window.__featherStore.selectedObjectId`), true);
  assert.equal(await app.count('.scripting-panel'), 0, 'creation does not open scripting');
  const cubeId = await app.evaluate(`window.__featherStore.selectedObjectId`);
  await fill('[aria-label="Object name"]', 'Signal box');
  await key('Tab');
  await app.waitFor(`document.querySelector('.hierarchy-row.selected').textContent.includes('Signal box')`);
  await fill('[aria-label="Position X"]', '2');
  await key('Tab');
  await app.waitFor(`${selected}.transform.position[0] === 2`);
  assert.equal(await app.evaluate(`document.querySelector('[data-inspector-section="Transform"]').getBoundingClientRect().top < document.querySelector('.creator-appearance-section').getBoundingClientRect().top`), true);

  await app.realClick('.editor-add-component');
  await fill('.editor-picker-search input', 'physics body');
  await key('Enter');
  await app.waitFor(`${selected}.physics?.enabled === true && document.querySelector('[data-inspector-section="Physics"] .field-row')`);
  assert.equal(await app.evaluate(`document.querySelector('[data-inspector-section="Physics"] .editor-disclosure').open`), false);
  await screenshot('configure-component');
  await app.evaluate(`document.querySelector('.inspector-content').scrollTop = 0`);
  await app.realClick('.editor-add-component');
  await fill('.editor-picker-search input', 'animation');
  assert.equal(await app.evaluate(`document.querySelector('[data-action-id="animation"]').disabled`), true);
  assert.match(await app.text('[data-action-id="animation"]'), /Assign an imported model/);
  await key('Escape');
  assert.equal(await app.evaluate(`document.activeElement.classList.contains('editor-add-component')`), true, 'Escape restores the trigger focus');

  // The selected-row action menu is the same searchable object chooser with a parent context.
  await app.realClick('.hierarchy-row.selected .hierarchy-row-menu');
  await clickText('.context-menu button', 'Add child object…');
  await app.waitFor(`document.querySelector('.editor-picker-heading h2')?.textContent === 'Add child object'`);
  await pick('sphere');
  await app.waitFor(`${selected}.parentId === ${JSON.stringify(cubeId)}`);
  assert.equal(await app.evaluate(`document.querySelector('.hierarchy-row.selected').getAttribute('aria-level')`), '2');
  await key('ArrowLeft');
  // Check hierarchy renaming, duplication and undo through discoverable controls.
  await app.realClick(`[data-object-id="${cubeId}"]`);
  // Duplicate copies the selected object itself (existing engine behaviour: children are not cloned).
  await app.realClick('[aria-label="Duplicate selected objects"]');
  await app.waitFor(`${scene}.objects.length === 3`);
  await app.realClick('[aria-label="Undo"]');
  await app.waitFor(`${scene}.objects.length === 2`);
  await app.realClick(`[data-object-id="${cubeId}"]`);
  await app.realClick('.hierarchy-row.selected .hierarchy-row-menu');
  await clickText('.context-menu button', 'Save as prefab…');
  await app.waitFor(`document.querySelector('.asset-tile[data-key^="prefab:"]')`);
  const beforePlace = await app.evaluate(`${scene}.objects.length`);
  await app.realClick('.asset-tile[data-key^="prefab:"]');
  assert.equal(await app.evaluate(`${scene}.objects.length`), beforePlace, 'selecting an asset does not place it');
  await clickText('.asset-selection-bar button', 'Add to Scene');
  await app.waitFor(`${scene}.objects.length === ${beforePlace + 2}`);

  // Import an actual image using the browser's file input, then search and type-filter it.
  const pngPath = join(fixtureDir, 'signal-texture.png');
  await writeFile(pngPath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXn8AAAAASUVORK5CYII=', 'base64'));
  await app.page.call('DOM.enable');
  const doc = await app.page.call('DOM.getDocument');
  const fileNode = await app.page.call('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '[aria-label="Choose assets to import"]' });
  await app.page.call('DOM.setFileInputFiles', { nodeId: fileNode.nodeId, files: [pngPath] });
  await app.waitFor(`window.__featherStore.assets.some(a => a.name === 'signal-texture.png')`);
  await fill('[aria-label="Search all assets"]', 'signal-texture');
  await app.waitFor(`document.querySelectorAll('.asset-view [data-key]').length === 1`);
  await choose('[aria-label="Filter assets by type"]', 'image');
  await app.waitFor(`document.querySelector('[aria-label="Filter assets by type"]').value === 'image'`);
  assert.match(await app.text('.asset-view'), /signal-texture/);
  assert.equal(await app.count('.asset-view [data-key]'), 1, 'Type filter narrows the grid');
  await fill('[aria-label="Search all assets"]', 'missing-file');
  await app.waitFor(`document.querySelector('.asset-view')?.textContent.includes('No matching assets')`);
  await clickText('.asset-view button', 'Clear search and filters');

  // Keyboard access to File → New scene, and the existing scene switcher.
  await clickText('.editor-main-menu .file-menu-trigger', 'File');
  await clickText('.file-menu-popover button', 'New scene');
  await app.waitFor(`${scene}.objects.length === 0`);
  assert.equal(await app.evaluate(`window.__featherStore.scenes.length`), 2);
  await choose('[aria-label="Active scene"]', 'scene-main');
  await app.waitFor(`${scene}.objects.length === 4`);
  await add('ground');
  await app.realClick('.add-trigger'); await fill('.editor-picker-search input', 'player'); await pick('role-player');
  await app.waitFor(`${selected}.creatorRoleId === 'player'`);
  await screenshot('editor-1440');

  // Save to a real .nforge file and reopen it through File → Open project.
  await app.page.call('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: fixtureDir });
  await app.realClick('[data-testid="toolbar-save-button"]');
  await app.waitFor(`window.__featherStore.isDirty === false`);
  let savedFile;
  for (let i = 0; i < 30; i++) { savedFile = (await readdir(fixtureDir)).find(name => name.endsWith('.nforge')); if (savedFile) break; await delay(100); }
  assert.ok(savedFile, 'Save downloads a project');
  const saved = JSON.parse(await readFile(join(fixtureDir, savedFile), 'utf8'));
  assert.equal(saved.scenes.length, 2);
  assert.ok(saved.assets.some(asset => asset.name === 'signal-texture.png'));
  await app.page.call('Page.setInterceptFileChooserDialog', { enabled: true });
  const fileChooser = new Promise(resolveChooser => { const listener = raw => { const message = JSON.parse(raw.toString()); if (message.method === 'Page.fileChooserOpened') { app.page.socket.off('message', listener); resolveChooser(message.params); } }; app.page.socket.on('message', listener); });
  await clickText('.editor-main-menu .file-menu-trigger', 'File');
  await clickText('.file-menu-popover button', 'Open project…');
  const chooser = await Promise.race([fileChooser, delay(10_000).then(() => { throw new Error('File chooser did not open'); })]);
  await app.page.call('DOM.setFileInputFiles', { backendNodeId: chooser.backendNodeId, files: [join(fixtureDir, savedFile)] });
  await app.waitFor(`${scene}.objects.some(object => object.creatorRoleId === 'player')`);

  // What a user sees restored after Play is the on-screen panel geometry; the persisted dock JSON
  // additionally stores the container's pixel height, which legitimately changes while the guide
  // strip is hidden during Play, and its activeGroup, which is keyboard focus rather than layout.
  const panelShape = `JSON.stringify(['hierarchy', 'inspector', 'viewport', 'project'].map(name => { const el = document.querySelector('.' + name + '-panel'); const r = el && el.getBoundingClientRect(); return r ? [name, Math.round(r.width), Math.round(r.height)] : [name, null]; }))`;
  const shapeBefore = await app.evaluate(panelShape);
  const layoutBefore = await app.evaluate(`JSON.parse(localStorage.getItem('nodeforge.layout')).layout`);
  await app.realClick('[data-testid="toolbar-play-button"]');
  await app.waitFor(`window.__featherStore.isPlaying && document.querySelector('.viewport-panel.is-playing')`);
  await app.realClick('[aria-label="Pause preview"]');
  await app.waitFor(`window.__featherStore.isPlayPaused`);
  await app.realClick('[aria-label="Step one frame"]');
  await screenshot('play-preview');
  await key('Escape');
  await app.waitFor(`!window.__featherStore.isPlaying && document.querySelector('.hierarchy-panel').clientWidth > 0`);
  assert.equal(await app.evaluate(`${scene}.objects.find(o => o.id === ${JSON.stringify(cubeId)}).transform.position[0]`), 2, 'Stop restores authored transforms');
  console.log('SHAPE BEFORE', shapeBefore);
  const groups = `JSON.stringify({ host: Math.round(document.querySelector('.nf-dockview-host').getBoundingClientRect().height), slot: Math.round(document.querySelector('.first-game-slot').getBoundingClientRect().height), g: [...document.querySelectorAll('.dv-groupview')].map(el => Math.round(el.getBoundingClientRect().height)) })`;
  for (let i = 0; i < 20; i += 1) { await delay(200); console.log('T+', (i + 1) * 200, await app.evaluate(groups)); }
  console.log('CAP', await app.evaluate(`JSON.stringify(globalThis.__dockCap)`), '\nRESTORE', await app.evaluate(`JSON.stringify(globalThis.__dockRestore)`));
  await app.waitFor(`${panelShape} === ${JSON.stringify(shapeBefore)}`, { label: 'panels return to their pre-Play sizes' });
  const layoutAfter = await app.evaluate(`JSON.parse(localStorage.getItem('nodeforge.layout')).layout`);
  assert.deepEqual(Object.keys(layoutAfter.panels), Object.keys(layoutBefore.panels), 'Play keeps every docked panel');
  assert.deepEqual(layoutAfter.grid.root.data.map((node) => node.size), layoutBefore.grid.root.data.map((node) => node.size), 'Play preserves the saved dock columns');

  // Actual desktop viewport sizes, and a narrower inspector via the existing dock API.
  for (const [width, height] of [[1280, 800], [1920, 1080]]) {
    await app.page.call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await app.waitFor(`innerWidth === ${width} && document.querySelector('.toolbar').getBoundingClientRect().right <= innerWidth`);
    const overlaps = await app.overlaps('.editor-main-tools', '.creator-toolbar-authoring, .creator-mode-switch, [aria-label="Runtime controls"]');
    assert.deepEqual(overlaps, [], `Toolbar does not overlap at ${width}`);
    assert.ok(await app.boxOf('.add-trigger'));
    assert.ok(await app.boxOf('[data-testid="toolbar-save-button"]'));
    await screenshot(`editor-${width}`);
  }
  await app.page.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await app.evaluate(`(async () => { const { getWorkspaceApi } = await import('/src/components/workspacePanels.ts'); getWorkspaceApi().getPanel('inspector').api.setSize({ width: 260 }); })()`);
  await app.realClick(`[data-object-id="${cubeId}"]`);
  await app.waitFor(`document.querySelector('.name-input').value === 'Signal box'`);
  assert.ok(await app.boxOf('[aria-label="Position X"]'));
  assert.deepEqual(await app.overlaps('.inspector-panel', '.axis-input'), []);
  await screenshot('resized-inspector');
  const customLayout = await app.evaluate(`JSON.parse(localStorage.getItem('nodeforge.layout')).layout`);
  await app.page.call('Page.reload');
  await app.waitFor(`document.querySelector('.toolbar') && document.querySelector('.hierarchy-panel')`);
  assert.deepEqual(await app.evaluate(`JSON.parse(localStorage.getItem('nodeforge.layout')).layout.grid`), customLayout.grid, 'Resized layout restores after reload');
  assert.deepEqual(errors, [], 'No uncaught browser exceptions');
  console.log('✓ Editor UX: creation, keyboard picker, hierarchy/selection, property edits, components, prefab placement, image import/filter, scenes, save/open, play/pause/step/stop, desktop sizes, and saved layout verified.');
  console.log(`Screenshots: ${shotDir}`);
} catch (error) {
  await screenshot('failure').catch(() => {});
  console.log(await app.evaluate(`JSON.stringify({focus:document.activeElement?.outerHTML,picker:document.querySelector('.editor-picker')?.innerText,inspector:document.querySelector('.inspector-panel')?.innerText})`).catch(() => 'Browser unavailable'));
  throw error;
} finally { await app.dispose(); }
