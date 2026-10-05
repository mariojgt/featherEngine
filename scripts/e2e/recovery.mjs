/** Real IndexedDB → reload → Restore acceptance, including a copy above the old size limit. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { openEditor } from './harness.mjs';
import { delay } from './cdp.mjs';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:17420';
const out = resolve(process.env.RECOVERY_E2E_DIR ?? 'exports/recovery-acceptance');
await mkdir(out, { recursive: true });
const app = await openEditor({ baseUrl, readySelector: '.launcher', width: 1280, height: 720 });
let closePrompts = 0;
// A real Restore click grants browser user activation, so later reloads show the editor's
// unsaved-work guard. Accept that expected dialog to model choosing to leave the page.
const onDialog = (raw) => {
  const event = JSON.parse(raw.toString());
  if (event.method === 'Page.javascriptDialogOpening' && event.params.type === 'beforeunload') {
    closePrompts += 1;
    void app.page.call('Page.handleJavaScriptDialog', { accept: true });
  }
};
app.page.socket.on('message', onDialog);
const loadStores = () => app.evaluate(`(async () => {
  // These proxies refer to the stores actually mounted by the app, including after dev HMR.
  window.safetyEditor = { getState: () => window.__featherStore };
  window.safetyProjects = { getState: () => window.__featherProject };
  window.safetyStorage = await import('/src/store/recoveryStorage.ts');
})()`);
const reload = async () => {
  await app.evaluate('window.beforeSafetyReload = true');
  await app.page.call('Page.reload', { ignoreCache: true });
  await app.waitFor(`!window.beforeSafetyReload && document.querySelector('.launcher')`);
  await loadStores();
};
const shot = async (name) => {
  const result = await app.page.call('Page.captureScreenshot', { format: 'png' });
  await writeFile(resolve(out, `${name}.png`), Buffer.from(result.data, 'base64'));
};

try {
  await loadStores();
  await app.evaluate(`(async () => {
    await window.safetyProjects.getState().newProject('Recovery acceptance');
    const s = window.safetyEditor.getState();
    s.createObjectWithProps('cube', { name: 'Authored before interruption' });
    const variable = s.createVariable('Large authoring value', 'string');
    s.updateVariable(variable, { defaultValue: 'x'.repeat(4_100_000) });
    const file = new File(['asset bytes survive the document'], 'recovery.txt', { type: 'text/plain' });
    s.addAssetItems([{ id: 'recovery-asset', name: file.name, type: 'unknown', size: file.size,
      createdAt: 0, url: URL.createObjectURL(file) }]);
  })()`);
  await app.waitFor(`document.querySelector('.status-bar__recovery--saved')`, { label: 'committed recovery status' });
  const committed = await app.evaluate(`(async () => {
    const copy = await window.safetyStorage.readStoredRecovery();
    return { size: JSON.stringify(copy).length, asset: copy.project.assets[0].data,
      variables: copy.project.variables[0].defaultValue.length, savedAt: copy.savedAt };
  })()`);
  assert.ok(committed.size > 4_000_000, 'Recovery exceeds the previous silent cutoff');
  assert.equal(committed.variables, 4_100_000);
  assert.ok(committed.asset.startsWith('data:text/plain;base64,'), 'Blob asset bytes are embedded');
  await shot('recovery-saved-1280');
  console.log('Large recovery committed with imported bytes');

  // Runtime changes must not replace the authored recovery, even after the debounce interval.
  await app.evaluate(`window.safetyEditor.getState().setPlaying(true);
    window.safetyEditor.getState().createObjectWithProps('cube', { name: 'Runtime only' })`);
  await delay(4500);
  assert.equal(await app.evaluate(`(async () => {
    const copy = await window.safetyStorage.readStoredRecovery();
    return copy.project.scenes.some(scene => scene.objects.some(object => object.name === 'Runtime only'));
  })()`), false, 'Play state cannot enter recovery');
  // Reload while playing also skips a pagehide write of simulated state.
  await reload();
  await app.waitFor(`document.querySelector('.launcher-recovery-restore')`);
  await shot('restore-offer-1280');
  await app.realClick('.launcher-recovery-restore');
  await app.waitFor(`document.querySelector('.toolbar') && window.safetyEditor.getState().isDirty`);
  const restored = await app.evaluate(`(async () => {
    const s = window.safetyEditor.getState();
    return { names: s.scenes.flatMap(scene => scene.objects.map(object => object.name)),
      variableSize: s.variables[0].defaultValue.length, assetText: await (await fetch(s.assets[0].url)).text(),
      durableCopyStillPresent: Boolean(await window.safetyStorage.readStoredRecovery()) };
  })()`);
  assert.ok(restored.names.includes('Authored before interruption'));
  assert.ok(!restored.names.includes('Runtime only'));
  assert.equal(restored.variableSize, 4_100_000);
  assert.equal(restored.assetText, 'asset bytes survive the document');
  assert.equal(restored.durableCopyStillPresent, true);
  console.log('Restore retained authored edits and assets; recovery remains durable');

  // A second interrupted session still offers the restored work; explicit discard removes it.
  await reload();
  await app.waitFor(`document.querySelector('.launcher-recovery-restore')`);
  assert.ok(closePrompts > 0, 'Leaving restored dirty work shows the unsaved-work guard');
  await app.realClick('.launcher-recovery-dismiss');
  await app.waitFor(`!document.querySelector('.launcher-recovery')`);
  assert.equal(await app.evaluate(`window.safetyStorage.readStoredRecovery().then(copy => copy == null)`), true);
  await reload();
  assert.equal(await app.count('.launcher-recovery'), 0);
  console.log('Explicit discard removed the durable copy across reload');

  // Deterministic storage failure in this isolated browser profile; the user sees the failure.
  await app.page.call('Page.addScriptToEvaluateOnNewDocument', { source: `
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: {
      open() { throw new DOMException('Storage quota is full', 'QuotaExceededError'); }
    }});
  ` });
  await reload();
  await app.waitFor(`document.querySelector('.hub-error[role="alert"]')?.textContent.includes('Recovery unavailable')`);
  await app.evaluate(`(async () => {
    await window.safetyProjects.getState().newProject('Storage unavailable');
    window.safetyEditor.getState().createObjectWithProps('cube', { name: 'Needs manual save' });
  })()`);
  await app.waitFor(`document.querySelector('.status-bar__recovery--unavailable')`);
  assert.equal(await app.evaluate(`window.safetyEditor.getState().isDirty`), true);
  assert.ok((await app.text('.status-bar__recovery--unavailable')).includes('Storage quota is full'));
  await shot('storage-unavailable-1280');
  console.log('Storage failures remain visible and leave edits dirty');
} catch (error) {
  try {
    await shot('failure');
    console.error(await app.evaluate(`JSON.stringify({
      hasProject: window.safetyProjects?.getState().hasProject,
      dirty: window.safetyEditor?.getState().isDirty,
      status: document.querySelector('.status-bar__recovery')?.textContent,
      error: document.querySelector('.hub-error')?.textContent
    })`));
  } catch { /* retain the original failure if the browser also disconnected */ }
  throw error;
} finally {
  app.page.socket.off('message', onDialog);
  await app.dispose();
}
