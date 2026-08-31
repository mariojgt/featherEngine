/**
 * Fast rendered smoke test for Local AI settings. This deliberately does not download any model;
 * real inference remains a manual GPU-capable Chromium/Tauri release check.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { openEditor } from './harness.mjs';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:17420';
const SHOT_DIR = process.env.LOCAL_AI_E2E_SHOT_DIR;

async function screenshot(page, name) {
  if (!SHOT_DIR) return;
  await mkdir(SHOT_DIR, { recursive: true });
  const shot = await page.call('Page.captureScreenshot', { format: 'png' });
  await writeFile(`${SHOT_DIR}/${name}.png`, Buffer.from(shot.data, 'base64'));
}

const app = await openEditor({ baseUrl: BASE_URL, query: '?demo=store', width: 1600, height: 1000 });
try {
  await app.evaluate(`localStorage.removeItem('nodeforge.ai'); location.reload()`);
  await app.waitFor(`document.querySelector('.agent-panel')`, { label: 'Agent panel rendered' });
  await app.evaluate(`(() => {
    window.__localAiSmokeErrors = [];
    window.addEventListener('error', (event) => window.__localAiSmokeErrors.push(event.message));
    window.addEventListener('unhandledrejection', (event) => window.__localAiSmokeErrors.push(String(event.reason)));
    window.dispatchEvent(new CustomEvent('nf:ask-ai', { detail: { prompt: 'Local AI rendered smoke test' } }));
  })()`);
  await app.waitFor(`document.querySelector('.agent-panel')?.getBoundingClientRect().width > 0`, {
    label: 'Agent panel visible',
  });
  await app.waitFor(`document.querySelector('.ai-settings')`, { label: 'Agent settings opened' });

  // Give capability detection a deterministic compatible adapter without initializing a model.
  await app.evaluate(`Object.defineProperty(navigator, 'gpu', {
    configurable: true,
    value: { requestAdapter: async () => ({ features: new Set(['shader-f16']) }) },
  })`);
  await app.evaluate(`(() => {
    const select = document.querySelector('.ai-settings label:first-of-type select');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(select, 'local');
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);

  await app.waitFor(`document.querySelector('.local-ai-settings')?.textContent.includes('Compatible GPU adapter ready')`, {
    label: 'compatible Local AI state',
  });
  assert.equal(
    await app.evaluate(`import('/src/ai/local/localProviderRuntime.ts').then((module) => typeof module.transformersJS === 'function')`),
    true,
    'the lazy Local AI provider chunk is fetchable before any model download',
  );
  assert.equal(await app.count('.local-ai-settings input[type="password"]'), 0, 'Local mode never renders an API-key field');
  assert.equal(await app.count('.local-ai-model-card'), 1, 'curated model card rendered');
  assert.equal(await app.count('[data-testid="local-model-select"] option'), 4, 'all curated local models rendered');
  assert.deepEqual(
    await app.evaluate(`[...document.querySelectorAll('[data-testid="local-model-select"] option')].map((option) => option.textContent)`),
    [
      'Qwen3 0.6B — Recommended · 580 MB',
      'LFM2.5 1.2B — balanced · 765 MB',
      'FunctionGemma 270M — Experimental · 450 MB',
      'Qwen3 4B — Experimental · 2.9 GB',
    ],
  );
  assert.ok((await app.text('.ai-title-copy'))?.includes('Local · Qwen3 0.6B · WebGPU'));
  assert.ok((await app.text('.local-ai-settings'))?.includes('never falls back to a cloud provider'));
  assert.ok((await app.text('.local-ai-settings'))?.includes('Qwen3 1.7B is temporarily unavailable'));
  assert.equal(await app.evaluate(`document.querySelector('.ai-send')?.disabled`), true, 'send stays gated before download consent');

  await app.evaluate(`(() => {
    [...document.querySelectorAll('.local-ai-model-card button')]
      .find((button) => button.textContent.trim() === 'Download & load')?.click();
  })()`);
  await app.waitFor(`document.querySelector('.local-ai-confirm')`, { label: 'large download confirmation' });
  assert.ok((await app.text('.local-ai-confirm'))?.includes('stored in this browser/app cache'));
  assert.equal(await app.count('.local-ai-progress'), 0, 'confirmation does not begin a download');
  assert.deepEqual(
    await app.overlaps('.local-ai-settings', ':scope > *'),
    [],
    'Local AI settings have no sibling layout collisions',
  );

  // Large and model-specific choices update the consent card without loading a runtime.
  await app.evaluate(`(() => {
    const select = document.querySelector('[data-testid="local-model-select"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(select, 'onnx-community/Qwen3-4B-ONNX');
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await app.waitFor(`document.querySelector('.local-ai-model-card')?.dataset.modelId === 'onnx-community/Qwen3-4B-ONNX'`, {
    label: 'Qwen3 4B choice rendered',
  });
  assert.ok((await app.text('.local-ai-model-card'))?.includes('approximately 2.9 GB'));
  assert.ok((await app.text('.local-ai-model-card'))?.includes('8 GB free memory recommended'));

  await app.evaluate(`(() => {
    const select = document.querySelector('[data-testid="local-model-select"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(select, 'onnx-community/functiongemma-270m-it-ONNX');
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await app.waitFor(`document.querySelector('.local-ai-model-card')?.dataset.modelId === 'onnx-community/functiongemma-270m-it-ONNX'`, {
    label: 'FunctionGemma choice rendered',
  });
  assert.ok((await app.text('.local-ai-model-card'))?.includes('Tiny Gemma tool specialist'));
  assert.ok((await app.text('.ai-title-copy'))?.includes('Local · FunctionGemma 270M · WebGPU'));
  await screenshot(app.page, 'local-ai-settings');

  // Cloud settings remain unchanged when switching back.
  await app.evaluate(`(() => {
    const select = document.querySelector('.ai-settings label:first-of-type select');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(select, 'openai');
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await app.waitFor(`document.querySelector('.ai-settings input[type="password"]')`, { label: 'cloud API-key field restored' });
  assert.ok((await app.text('.ai-settings'))?.includes('Smart routing'));
  assert.deepEqual(await app.evaluate(`window.__localAiSmokeErrors`), []);
  console.log('✓ Local AI settings rendered, confirmed download consent, and preserved cloud settings');
} finally {
  await app.dispose();
}
