import assert from 'node:assert/strict';
import { openEditor } from './harness.mjs';

// A fresh Vite server avoids mixing manually imported test modules with old HMR module instances.
process.env.FEATHER_CHROME_ANGLE ??= process.platform === 'darwin' ? 'metal' : 'swiftshader';
const app = await openEditor({ baseUrl: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:17422', query: 'cinematic-capture.html', readySelector: '[data-cinematic-capture]', width: 400, height: 300 });
const errors = [];
app.page.socket.on('message', (raw) => {
  const message = JSON.parse(raw.toString());
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' '));
});
try {
  await app.waitFor('window.__featherStore');
  const result = await app.evaluate(`(async () => {
    const surfaceSource = await (await fetch('/src/three/terrainSurface.ts')).text();
    const entrySource = await (await fetch('/src/dev/cinematicCaptureEntry.tsx')).text();
    const moduleUrl = (source, name) => { const line = source.split('\\n').find(line => line.includes('from ') && line.includes(name)); if (!line) throw Error('Missing import: ' + name); return line.split('from ')[1].split('\"')[1]; };
    const THREE = await import(moduleUrl(surfaceSource, 'three'));
    const React = (await import(moduleUrl(surfaceSource, 'react'))).default;
    const rootModule = await import(moduleUrl(entrySource, 'react-dom'));
    const createRoot = rootModule.createRoot ?? rootModule.default.createRoot;
    const { useTerrainSurfaceMaterial } = await import('/src/three/terrainSurface.ts');
    const { withTerrainDefaults } = await import('/src/terrain/terrain.ts');
    const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff', '#ff00ff', '#808080', '#ff8000'];
    const assets = colors.map((color, i) => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 16;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0, 0, 16, 16);
      return { id: 'surface-' + i, name: 'Surface ' + i, type: 'image', size: 1, data: canvas.toDataURL(), createdAt: 0 };
    });
    window.__featherStore.addAssetItems(assets);
    const terrain = withTerrainDefaults({ materialLayers: colors.map((_, i) => ({ id: 'layer-' + i, name: 'Layer ' + i, color: '#ffffff', textureAssetId: 'surface-' + i, textureScale: 3 })) });
    let material;
    function Probe() { material = useTerrainSurfaceMaterial(terrain); return null; }
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host); root.render(React.createElement(Probe));
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const renderer = new THREE.WebGLRenderer({ antialias: false }); renderer.setSize(256, 32); renderer.toneMapping = THREE.NoToneMapping;
    const target = new THREE.WebGLRenderTarget(256, 32), scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, Math.PI));
    const camera = new THREE.OrthographicCamera(-4, 4, 0.5, -0.5, 0.1, 10);
    camera.position.set(0, 2, 0); camera.up.set(0, 0, -1); camera.lookAt(0, 0, 0);
    const geometry = [];
    for (let i = 0; i < 8; i++) {
      const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2);
      const a = new Float32Array(16), b = new Float32Array(16);
      for (let v = 0; v < 4; v++) (i < 4 ? a : b)[v * 4 + i % 4] = 1;
      g.setAttribute('terrainWeightsA', new THREE.BufferAttribute(a, 4)); g.setAttribute('terrainWeightsB', new THREE.BufferAttribute(b, 4));
      const mesh = new THREE.Mesh(g, material); mesh.position.x = i - 3.5; scene.add(mesh); geometry.push(g);
    }
    renderer.setRenderTarget(target); renderer.render(scene, camera);
    const pixels = new Uint8Array(256 * 32 * 4); renderer.readRenderTargetPixels(target, 0, 0, 256, 32, pixels);
    const samples = colors.map((_, i) => Array.from(pixels.slice((16 * 256 + i * 32 + 16) * 4, (16 * 256 + i * 32 + 16) * 4 + 3)));
    root.unmount(); host.remove(); geometry.forEach((g) => g.dispose()); target.dispose(); renderer.dispose();
    return { samples };
  })()`);
  // Values are linear, since the probe reads a render target. Metalness .02 leaves ~98% diffuse.
  const expected = [[250,0,0], [0,250,0], [0,0,250], [250,250,0], [0,250,250], [250,0,250], [54,54,54], [250,54,0]];
  result.samples.forEach((sample, i) => sample.forEach((channel, c) => assert.ok(Math.abs(channel - expected[i][c]) <= 5, `Layer ${i}: ${sample}`)));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'passed', checks: ['eight textured layers', 'isolated texture-array layers', 'shader compilation'], ...result }));
} finally { await app.dispose(); }
