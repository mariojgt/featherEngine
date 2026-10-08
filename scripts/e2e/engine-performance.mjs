/** Repeatable cold launcher/startup check and real-scene profiler capture. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { openEditor } from './harness.mjs';

const { values } = parseArgs({ options: {
  mode: { type: 'string', default: 'startup' },
  url: { type: 'string', default: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:17420' },
  out: { type: 'string', default: 'exports/engine-performance/report.json' },
  runs: { type: 'string', default: '3' },
} });
assert.ok(['startup', 'scene'].includes(values.mode), 'Use --mode startup or --mode scene');
const runs = Number(values.runs);
assert.ok(Number.isInteger(runs) && runs > 0 && runs <= 10, '--runs must be 1–10');
const results = [];

for (let run = 0; run < (values.mode === 'startup' ? runs : 1); run++) {
  const app = await openEditor({
    baseUrl: values.url,
    query: values.mode === 'scene' ? '?demo=store&perf=1' : '',
    readySelector: values.mode === 'scene' ? '.toolbar' : '.launcher',
    width: 1280, height: 800,
  });
  try {
    if (values.mode === 'startup') {
      results.push(await app.evaluate(`(async () => {
        await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
        const navigation = performance.getEntriesByType('navigation')[0];
        const resources = performance.getEntriesByType('resource').filter(r => /\\.js(\\?|$)/.test(r.name));
        return {
          domContentLoadedMs: navigation.domContentLoadedEventEnd,
          loadMs: navigation.loadEventEnd,
          paint: performance.getEntriesByType('paint').map(p => ({ name: p.name, ms: p.startTime })),
          jsBytes: resources.reduce((sum, r) => sum + r.encodedBodySize, 0),
          jsFiles: resources.map(r => ({ url: r.name, bytes: r.encodedBodySize })),
        };
      })()`));
    } else {
      assert.equal(await app.evaluate('!!window.__featherStore'), true, 'Scene profiling needs npm run dev');
      await app.evaluate(`(async () => {
        await (await import('/src/project/platformerTemplate.ts')).createPlatformerTemplate();
        const editor = window.__featherStore;
        editor.updateRenderSettings({ quality: 'Low', autoQuality: false });
        const { usePerformanceAssistantStore } = await import('/src/store/performanceAssistantStore.ts');
        window.__featherMeasurement = usePerformanceAssistantStore;
        window.__featherPerfSnapshot = (await import('/src/runtime/perfStats.ts')).getPerfSnapshot;
        editor.setPlaying(true);
      })()`);
      // The lazy viewport and scene shaders can take longer than the capture's two-second warmup.
      // Wait for actual rendering before starting the timed measurement.
      await app.waitFor('window.__featherPerfSnapshot().render.calls > 0', { timeout: 90000, label: 'scene rendered before capture' });
      await app.evaluate(`window.__featherStore.setPlaying(false); window.__featherMeasurement.getState().measure(60)`);
      await app.waitFor('!window.__featherMeasurement.getState().recording', { timeout: 45000, label: 'scene measurement' });
      const result = await app.evaluate(`(() => {
        const { report, error } = window.__featherMeasurement.getState();
        const gl = document.querySelector('canvas')?.getContext('webgl2');
        const debug = gl?.getExtension('WEBGL_debug_renderer_info');
        return { report, error, renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null };
      })()`);
      assert.ok(result.report && !result.error, result.error ?? 'No scene report');
      assert.ok(result.report.peakDrawCalls > 0, 'No rendered frames captured');
      results.push(result);
    }
  } finally {
    await app.dispose();
  }
  console.log(`Measured ${values.mode} run ${run + 1}.`);
}

const output = resolve(values.out);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify({
  mode: values.mode, url: values.url, viewport: { width: 1280, height: 800 },
  note: 'Headless Chrome uses SwiftShader by default. Scene timings are automation diagnostics, not hardware FPS evidence. Startup bytes reflect the server encoding; compare the same server mode.',
  results,
}, null, 2));
console.log(`Saved ${output}`);
