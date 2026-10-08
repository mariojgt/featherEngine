/** Dev-browser regression for shared Play inputs, quality fallbacks and live render diagnostics. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { openEditor } from './harness.mjs';

const output = 'exports/engine-performance/runtime-rendering';
const app = await openEditor({
  baseUrl: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:17428',
  query: '?demo=store', width: 1280, height: 800,
});
try {
  await app.evaluate(`(async () => {
    const { blankProject } = await import('/src/project/serialize.ts');
    const { useEditorStore } = await import('/src/store/editorStore.ts');
    const { _roots } = await import('/node_modules/.vite/deps/@react-three_fiber.js');
    const { getPerfSnapshot } = await import('/src/runtime/perfStats.ts');
    window.renderingErrors = [];
    const originalError = console.error;
    console.error = (...args) => {
      const text = args.map(String).join(' ');
      if (/WebGLProgram|VALIDATE_STATUS|Error compiling/.test(text)) renderingErrors.push(text);
      originalError(...args);
    };
    window.qaStore = useEditorStore;
    window.qaPerf = getPerfSnapshot;
    window.qaCanvas = () => document.querySelector('.game-canvas canvas') ?? document.querySelector('canvas');
    window.qaRoot = () => _roots.get(qaCanvas())?.store.getState();
    const project = blankProject('Runtime rendering regression');
    project.renderSettings = { ...project.renderSettings, quality: 'Low', autoQuality: false,
      ambientOcclusionEnabled: false, bloomEnabled: false, vignetteEnabled: false, colorGrade: undefined };
    Object.assign(project.scenes[0].environment, { skyMode: 'color', fogEnabled: true,
      fogColor: '#244d86', fogNear: 10, fogFar: 100, volumetricFogEnabled: true,
      volumetricFogColor: '#244d86', volumetricFogDensity: .05, contactShadows: false });
    useEditorStore.getState().loadProject(project);
    const editor = useEditorStore.getState();
    editor.createObjectWithProps('cube', { name: 'Near cube', position: [0, 0, 0] });
    window.qaSphereId = editor.createObjectWithProps('sphere', { name: 'Distant sphere', position: [0, 0, -80] });
    editor.createObjectWithProps('camera', { name: 'Test camera', position: [0, 0, 8] });
    window.qaSphere = () => {
      let result;
      qaRoot()?.scene.traverse(node => {
        if (node.userData.nfObjectId === qaSphereId) node.traverse(child => { if (child.isMesh) result = child; });
      });
      return result;
    };
    editor.setPlaying(true);
  })()`);
  await app.waitFor('qaStore.getState().isPlaying && qaSphere() && qaPerf().render.calls > 0', { timeout: 90000 });
  await app.waitFor('qaSphere().geometry.index.count <= 660', { label: 'real distant mesh LOD', timeout: 30000 });
  assert.equal(await app.evaluate('qaRoot().scene.fog?.color.getHexString()'), '244d86', 'Low preserves authored distance fog');
  const low = await app.evaluate('qaPerf()');
  assert.ok(low.render.triangles > 0 && low.renderMs.last >= 0, 'Play reports live render work');

  // Real key input to the AI composer must remain owned by the text control.
  await app.evaluate(`(async () => {
    (await import('/src/components/workspacePanels.ts')).focusWorkspacePanel('agent');
  })()`);
  await app.waitFor('document.querySelector(".ai-composer textarea")');
  await app.realClick('.ai-composer textarea');
  await app.page.call('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', key: 'w', text: 'w', windowsVirtualKeyCode: 87 });
  assert.notEqual(await app.evaluate('qaStore.getState().runtimeKeys.KeyW'), true, 'Typing does not move the player');
  await app.page.call('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 });
  await app.evaluate(`qaCanvas().tabIndex = 0; qaCanvas().focus()`);
  await app.page.call('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 });
  assert.equal(await app.evaluate('qaStore.getState().runtimeKeys.KeyW'), true, 'Canvas input drives gameplay');
  await app.evaluate('window.dispatchEvent(new Event("blur"))');
  assert.equal(await app.evaluate('qaStore.getState().runtimeKeys.KeyW'), false, 'Losing focus releases movement');
  await app.page.call('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 });

  for (let i = 0; i < 3; i++) {
    await app.evaluate('qaStore.getState().updateRenderSettings({ quality: "High" })');
    await app.waitFor('!qaRoot().scene.fog && qaSphere().geometry.index.count === 4416', { label: 'High fog and mesh detail' });
    await app.evaluate('qaStore.getState().updateRenderSettings({ quality: "Low" })');
    await app.waitFor('qaRoot().scene.fog && qaSphere().geometry.index.count <= 660', { label: 'Low fallback and mesh reduction' });
  }
  await app.evaluate('qaStore.getState().updateSceneEnvironment(qaStore.getState().activeSceneId, { volumetricFogDensity: 0 })');
  await app.evaluate('qaStore.getState().updateRenderSettings({ quality: "High" })');
  await app.waitFor('qaRoot().scene.fog?.color.getHexString() === "244d86"', { label: 'zero density fallback' });
  await app.evaluate('qaStore.getState().setPlaying(false)');
  await app.waitFor('!document.querySelector(".game-canvas") && qaPerf().render.calls > 0', { label: 'editor render probe after Stop' });
  await app.evaluate('qaStore.getState().setPlaying(true)');
  await app.waitFor('document.querySelector(".game-canvas") && qaPerf().render.calls > 0', { label: 'player render probe after restart' });
  assert.deepEqual(await app.evaluate('renderingErrors'), [], 'Rendering shaders compile across canvas/quality changes');
  await mkdir(output, { recursive: true });
  const screenshot = await app.page.call('Page.captureScreenshot', { format: 'png' });
  await writeFile(`${output}/play.png`, Buffer.from(screenshot.data, 'base64'));
  const report = { status: 'passed', low, final: await app.evaluate('qaPerf()'), errors: [] };
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await app.dispose();
}
