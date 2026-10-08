/** Production smoke for deferred code, including the launcher → Agent handoff. */
import assert from 'node:assert/strict';
import { openEditor } from './harness.mjs';

const app = await openEditor({
  baseUrl: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:17429',
  readySelector: '.launcher', width: 1280, height: 800,
});
try {
  const initial = await app.evaluate(`performance.getEntriesByType('resource').filter(r => /\\.js$/.test(r.name)).map(r => r.name)`);
  assert.equal(initial.some(url => /AIChatWidget|VisualScriptingPanel|ModelForgePanel|EditorShell|Viewport/.test(url)), false, 'Heavy editor features must be deferred on the launcher');
  await app.realClick('.hub-ai > summary');
  await app.evaluate(`(() => {
    const input = document.querySelector('#launcher-game-description');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'A garden adventure with three coins.');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await app.realClick('.launcher-primary');
  await app.waitFor(`document.querySelector('.agent-panel textarea')?.value === 'A garden adventure with three coins.'`, { label: 'launcher prompt survives Agent lazy loading' });
  await app.waitFor(`document.querySelector('.viewport-panel canvas')`, { label: 'production viewport loads' });
  await app.evaluate(`document.querySelector('[data-menu=view] .file-menu-trigger')?.click()`);
  await app.waitFor(`document.querySelector('[data-menu=view] .file-menu-popover')`);
  await app.evaluate(`([...document.querySelectorAll('[data-menu=view] .file-menu-popover button')].find(button => button.textContent.trim() === 'Scripting'))?.click()`);
  await app.waitFor(`performance.getEntriesByType('resource').some(r => /VisualScriptingPanel/.test(r.name))`, { label: 'Scripting chunk loads on demand' });
  await app.waitFor(`document.querySelector('.scripting-panel')`, { label: 'Scripting renders in production' });
  console.log('Deferred production panels and launcher AI handoff: OK');
} finally {
  await app.dispose();
}
