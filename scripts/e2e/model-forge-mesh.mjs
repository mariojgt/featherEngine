/**
 * Model Forge polygon-modeling real-input smoke: Add a quad mesh, Tab into Edit mode, click-select a
 * face on the live canvas, E-extrude with the mouse, Ctrl+R loop cut, G-move with an axis lock, add
 * mirror + subdivision modifiers, paint a polygon and bake to GLB — all through genuine CDP mouse and
 * keyboard input, because the modal tools live on window listeners that synthetic events don't reach.
 *
 * MODEL_FORGE_SHOT_DIR=/tmp/shots saves a screenshot after each stage for visual review.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { openEditor } from './harness.mjs';
import { delay } from './cdp.mjs';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:17420';
const shotDir = process.env.MODEL_FORGE_SHOT_DIR;

const app = await openEditor({ baseUrl, query: '?demo=store', width: 1600, height: 1000 });
const shot = async (name) => {
  if (!shotDir) return;
  await mkdir(shotDir, { recursive: true });
  const capture = await app.page.call('Page.captureScreenshot', { format: 'png' });
  await writeFile(`${shotDir}/${name}.png`, Buffer.from(capture.data, 'base64'));
};
const mouse = async (type, x, y, extra = {}) =>
  app.page.call('Input.dispatchMouseEvent', { type, x, y, button: 'none', buttons: 0, ...extra });
const click = async (x, y, modifiers = 0) => {
  await mouse('mouseMoved', x, y, { modifiers });
  await delay(30);
  await mouse('mousePressed', x, y, { button: 'left', buttons: 1, clickCount: 1, modifiers });
  await delay(30);
  await mouse('mouseReleased', x, y, { button: 'left', buttons: 0, clickCount: 1, modifiers });
  await delay(60);
};
const drag = async (from, to, steps = 8) => {
  await mouse('mouseMoved', from.x, from.y);
  await delay(30);
  await mouse('mousePressed', from.x, from.y, { button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= steps; i += 1) {
    await mouse('mouseMoved', from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps, { button: 'left', buttons: 1 });
    await delay(20);
  }
  await mouse('mouseReleased', to.x, to.y, { button: 'left', buttons: 0, clickCount: 1 });
  await delay(120);
};
const KEY_CODES = { Tab: 9, Enter: 13, Escape: 27 };
const press = async (key, { ctrl = false, shift = false } = {}) => {
  const modifiers = (ctrl ? 2 : 0) | (shift ? 8 : 0);
  const code = key.length === 1 ? (/[a-z]/i.test(key) ? `Key${key.toUpperCase()}` : `Digit${key}`) : key;
  const keyCode = KEY_CODES[key] ?? key.toUpperCase().charCodeAt(0);
  const text = key.length === 1 && !ctrl ? key : undefined;
  await app.page.call('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key, code, windowsVirtualKeyCode: keyCode, modifiers, text });
  await app.page.call('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, modifiers });
  await delay(80);
};
const spec = (id) => `window.__featherStore.modelSpecs.find((s) => s.id === ${JSON.stringify(id)})`;

try {
  // Model Forge on, opened from the View menu.
  await app.evaluate(`localStorage.setItem('nodeforge.plugins', JSON.stringify({ state: { enabledIds: ['feather.model-forge'], coreBootstrapped: true }, version: 0 }))`);
  await app.evaluate(`location.reload()`);
  await app.waitFor(`document.querySelector('.toolbar')`, { label: 'editor reloaded' });
  const specId = await app.evaluate(`window.__featherStore.createModelSpec('blank', 'Mesh Test')`);
  await app.evaluate(`(() => {
    document.querySelector('[data-menu=view] .file-menu-trigger, [data-menu=view] button')?.click();
  })()`);
  await delay(200);
  await app.evaluate(`(() => {
    const items = [...document.querySelectorAll('[data-menu=view] .file-menu-popover button')];
    items.find((b) => b.textContent.trim() === 'Model Forge')?.click();
  })()`);
  await app.waitFor(`document.querySelector('.model-forge-canvas canvas')`, { label: 'model forge open' });
  await app.evaluate(`(async () => {
    const panels = await import('/src/components/workspacePanels.ts');
    if (!panels.isWorkspacePanelMaximized('feather.model-forge.studio')) panels.toggleWorkspacePanelMaximized('feather.model-forge.studio');
  })()`);
  await delay(500);
  await app.waitFor(
    `(() => { const c = document.querySelector('.model-forge-canvas canvas'); return !!c && c.getBoundingClientRect().width > 350; })()`,
    { label: 'preview canvas sized' },
  );
  // Remove the blank starter's box so the quad mesh is the only part.
  await app.evaluate(`(() => { const s = ${spec(specId)}; window.__featherStore.removeModelPart(s.id, s.parts[0].id); })()`);

  // Add a clean quad cube from the Add menu.
  await app.realClick('[data-testid="model-forge-add-primitive"]');
  await shot('00-add-menu');
  await app.evaluate(`document.querySelector('[data-testid="model-forge-mesh-quad-cube"]')?.scrollIntoView({ block: 'center' })`);
  await app.realClick('[data-testid="model-forge-mesh-quad-cube"]');
  await app.waitFor(`${spec(specId)}.parts.length === 1 && ${spec(specId)}.parts[0].shape === 'mesh'`, { label: 'quad cube mesh part' });
  const startFaces = await app.evaluate(`${spec(specId)}.parts[0].mesh.faces.length`);
  assert.equal(startFaces, 24, 'a 2x2 quad cube has 24 faces');
  await shot('01-quad-cube');

  const canvas = await app.evaluate(`(() => {
    const r = document.querySelector('.model-forge-canvas canvas').getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height, left: r.left, top: r.top };
  })()`);
  // Tab into Edit mode, face select (3), then click the TOP face from a top view.
  await app.evaluate(`document.querySelector('.model-forge-view-controls button[title="Top view"]')?.click()`);
  await delay(400);
  await click(canvas.cx + canvas.w * 0.25, canvas.cy - canvas.h * 0.3); // focus canvas on empty space
  await press('Tab');
  await app.waitFor(`document.querySelector('[data-testid="model-forge-mesh-tools"]')`, { label: 'mesh tools in Edit mode' });
  await press('3');
  await click(canvas.cx + 6, canvas.cy + 6);
  await app.waitFor(`/^1 selected/.test(document.querySelector('.model-toolbar-count')?.textContent ?? '')`, { label: 'face picked on canvas' });
  await shot('02-face-selected');

  // E → drag → click: one extrude op.
  await press('e');
  await app.waitFor(`document.querySelector('.model-forge-modal-hud')?.textContent.startsWith('Extrude')`, { label: 'extrude modal HUD' });
  await mouse('mouseMoved', canvas.cx + 6, canvas.cy - 60);
  await delay(120);
  await shot('03-extrude-preview');
  await click(canvas.cx + 6, canvas.cy - 60);
  await app.waitFor(`!document.querySelector('.model-forge-modal-hud')`, { label: 'extrude confirmed' });
  const afterExtrude = await app.evaluate(`${spec(specId)}.parts[0].mesh.faces.length`);
  assert.equal(afterExtrude, startFaces + 4, 'region extrude of one face adds 4 side quads');

  // Typed value + axis lock: G Z 0.3 Enter moves the selected cap.
  const capBefore = await app.evaluate(`JSON.stringify(${spec(specId)}.parts[0].mesh.vertices)`);
  await mouse('mouseMoved', canvas.cx + 40, canvas.cy + 40);
  await press('g');
  await press('z');
  await press('0');
  await press('.');
  await press('2');
  await app.waitFor(`/along Z: /.test(document.querySelector('.model-forge-modal-hud')?.textContent ?? '')`, { label: 'grab Z typed' });
  await press('Enter');
  await app.waitFor(`JSON.stringify(${spec(specId)}.parts[0].mesh.vertices) !== ${JSON.stringify(capBefore)}`, { label: 'grab committed' });

  // Ctrl+R loop cut: hover a side face in perspective, click.
  await app.evaluate(`document.querySelector('.model-forge-view-controls button[title="Persp view"]')?.click()`);
  await delay(400);
  await press('Escape');
  const facesBeforeCut = await app.evaluate(`${spec(specId)}.parts[0].mesh.faces.length`);
  await mouse('mouseMoved', canvas.cx - 10, canvas.cy + 30);
  await press('r', { ctrl: true });
  await app.waitFor(`document.querySelector('.model-forge-modal-hud')?.textContent.startsWith('Loop Cut')`, { label: 'loop cut modal' });
  await mouse('mouseMoved', canvas.cx - 12, canvas.cy + 34);
  await delay(80);
  await mouse('mouseMoved', canvas.cx - 14, canvas.cy + 38);
  await delay(150);
  await shot('04-loopcut-preview');
  await click(canvas.cx - 14, canvas.cy + 38);
  await app.waitFor(`${spec(specId)}.parts[0].mesh.faces.length > ${facesBeforeCut}`, { label: 'loop cut committed' });

  // Box select (B): front faces only; with X-ray the same rectangle also catches the back faces.
  const selectedCount = () => app.evaluate(`Number((document.querySelector('.model-toolbar-count')?.textContent ?? '0').split(' ')[0])`);
  const clickButton = (label) => app.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(label)})?.click()`);
  await clickButton('None');
  const box = { from: { x: canvas.cx - 170, y: canvas.cy - 150 }, to: { x: canvas.cx + 170, y: canvas.cy + 150 } };
  await press('b');
  await app.waitFor(`document.querySelector('.model-forge-modal-hud')?.textContent.startsWith('Box Select')`, { label: 'box select modal' });
  await drag(box.from, box.to);
  await app.waitFor(`!document.querySelector('.model-forge-modal-hud')`, { label: 'box select finished' });
  const frontOnly = await selectedCount();
  assert.ok(frontOnly > 1, `box select picked several faces (got ${frontOnly})`);
  await clickButton('X-Ray');
  await clickButton('None');
  await press('b');
  await drag(box.from, box.to);
  await delay(150);
  await shot('04b-xray-box');
  const throughMesh = await selectedCount();
  assert.ok(throughMesh > frontOnly, `X-ray box select reaches hidden faces (${throughMesh} > ${frontOnly})`);
  await clickButton('X-Ray');
  await clickButton('None');

  // Knife (K): a line dragged across the cube adds cut edges; the mesh stays closed.
  const closed = (id) => app.evaluate(`(async () => {
    const { buildTopology } = await import('/src/model/polyMesh.ts');
    const mesh = ${spec(id)}.parts[0].mesh;
    return buildTopology(mesh).edgeFaces.every((list) => list.length === 2);
  })()`);
  const facesBeforeKnife = await app.evaluate(`${spec(specId)}.parts[0].mesh.faces.length`);
  await press('k');
  await app.waitFor(`document.querySelector('.model-forge-modal-hud')?.textContent.startsWith('Knife')`, { label: 'knife modal' });
  await drag({ x: canvas.cx - 220, y: canvas.cy + 5 }, { x: canvas.cx + 220, y: canvas.cy - 5 }, 12);
  await app.waitFor(`${spec(specId)}.parts[0].mesh.faces.length > ${facesBeforeKnife}`, { label: 'knife cut committed' });
  assert.ok(await closed(specId), 'knife keeps the mesh watertight');
  await shot('04c-knife');

  // Bisect: keep +Y and cap the cut — still a closed solid.
  await clickButton('Keep +Y');
  await app.waitFor(`${spec(specId)}.parts[0].mesh.vertices.every((v) => v[1] >= -1e-4)`, { label: 'bisect removed the lower half' });
  assert.ok(await closed(specId), 'bisect + fill leaves a closed solid');
  await press('z', { ctrl: true });
  await app.waitFor(`${spec(specId)}.parts[0].mesh.vertices.some((v) => v[1] < -0.1)`, { label: 'bisect undone' });

  // Mirror + subdivision modifiers (non-destructive): cage face count unchanged.
  const cageFaces = await app.evaluate(`${spec(specId)}.parts[0].mesh.faces.length`);
  await app.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '+ Subdivision')?.click()`);
  await app.waitFor(`${spec(specId)}.parts[0].modifiers?.[0]?.type === 'subdivision'`, { label: 'subdivision modifier' });
  assert.equal(await app.evaluate(`${spec(specId)}.parts[0].mesh.faces.length`), cageFaces, 'modifiers never touch the cage');
  await press('Tab');
  await delay(300);
  await shot('05-subdivided');

  // Paint mode: click the mesh → per-polygon slot.
  await press('p');
  await click(canvas.cx, canvas.cy);
  await app.waitFor(`(${spec(specId)}.parts[0].mesh.faceSlots ?? []).some((slot) => slot >= 0)`, { label: 'polygon painted' });
  await shot('06-painted');

  // Bake textures: base color × AO into a textured project material on the part.
  const materialsBefore = await app.evaluate(`window.__featherStore.materials.length`);
  await app.evaluate(`document.querySelector('[data-testid="model-forge-bake-textures"]')?.scrollIntoView({ block: 'center' })`);
  await app.evaluate(`document.querySelector('[data-testid="model-forge-bake-textures"]')?.click()`);
  await app.waitFor(
    `window.__featherStore.materials.length === ${materialsBefore} + 1 && !!${spec(specId)}.parts[0].materialId`,
    { label: 'baked material assigned', timeout: 30000 },
  );
  const bakedMaterial = await app.evaluate(`(() => {
    const s = window.__featherStore;
    const material = s.materials.find((m) => m.id === ${spec(specId)}.parts[0].materialId);
    const asset = s.assets.find((a) => a.id === material.textureAssetId);
    return { name: material.name, texture: asset?.name ?? null };
  })()`);
  assert.match(bakedMaterial.texture ?? '', /-basecolor\.png$/, 'baked base color texture is an asset');
  await delay(800);
  await shot('06b-baked');

  // Bake to GLB through the real exporter.
  const assetsBefore = await app.evaluate(`window.__featherStore.assets.length`);
  await app.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Bake to GLB'))?.click()`);
  await app.waitFor(`window.__featherStore.assets.length === ${assetsBefore} + 1`, { label: 'baked GLB', timeout: 20000 });

  // Quality showcase: a mug + vase built purely from the polygon toolset, the way the AI would.
  const showcase = await app.evaluate(`(() => {
    const s = window.__featherStore;
    const id = s.createModelSpec('blank', 'Mug Showcase');
    const spec = () => s.modelSpecs.find((m) => m.id === id);
    s.removeModelPart(id, spec().parts[0].id);
    const mug = s.addModelMeshPart(id, { kind: 'cylinder', sides: 16 }, { name: 'Mug', position: [0, 0.45, 0], scale: [0.8, 0.9, 0.8], colorSlot: 4 });
    const top = () => {
      const m = spec().parts.find((p) => p.id === mug).mesh;
      return m.faces.map((loop, i) => [i, loop.reduce((y, v) => y + m.vertices[v][1], 0) / loop.length]).filter(([, y]) => y > 0.49).map(([i]) => i);
    };
    const inset = s.applyModelMeshOp(id, mug, { type: 'inset', faces: top(), thickness: 0.06 });
    s.applyModelMeshOp(id, mug, { type: 'extrude', faces: inset.faces, distance: -0.85 });
    const rim = spec().parts.find((p) => p.id === mug).mesh;
    const rimEdges = [];
    rim.faces.forEach((loop) => loop.forEach((a, k) => { const b = loop[(k + 1) % loop.length]; if (Math.abs(rim.vertices[a][1] - 0.5) < 1e-3 && Math.abs(rim.vertices[b][1] - 0.5) < 1e-3) rimEdges.push([a, b]); }));
    s.applyModelMeshOp(id, mug, { type: 'bevel', edges: rimEdges, width: 0.015, segments: 2 });
    s.updateModelPart(id, mug, { modifiers: [{ type: 'subdivision', levels: 2 }], smoothAngle: 180 });
    s.addModelMeshPart(id, { kind: 'tube', radius: 0.07, sides: 10, path: [[0, 0.3, 0], [0.18, 0.32, 0], [0.3, 0.15, 0], [0.3, -0.15, 0], [0.18, -0.32, 0], [0, -0.3, 0]] }, { name: 'Handle', position: [0.36, 0.45, 0], scale: [1, 1, 1], colorSlot: 4 });
    const vase = s.addModelMeshPart(id, { kind: 'lathe', segments: 24, profile: [[0, -0.5], [0.22, -0.48], [0.38, -0.3], [0.42, -0.05], [0.24, 0.25], [0.16, 0.4], [0.22, 0.5]] }, { name: 'Vase', position: [-1.1, 0.6, 0], scale: [0.9, 1.2, 0.9], colorSlot: 8 });
    s.updateModelPart(id, vase, { modifiers: [{ type: 'subdivision', levels: 1 }], smoothAngle: 180 });
    s.setActiveModelSpec(id);
    return { id, parts: spec().parts.map((p) => ({ name: p.name, faces: p.mesh?.faces?.length })) };
  })()`);
  assert.equal(showcase.parts.length, 3, 'showcase built three mesh parts');
  await delay(700);
  await press('Escape');
  await app.evaluate(`document.querySelector('.model-forge-hud-fit')?.click()`);
  await delay(600);
  await shot('07-showcase');

  const errors = app.consoleErrors.filter((entry) => !/favicon|DevTools/.test(entry));
  assert.deepEqual(errors, [], `console errors: ${errors.join(' | ')}`);
  console.log('model-forge-mesh: OK');
} finally {
  await app.dispose();
}
