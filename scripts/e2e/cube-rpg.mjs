/** Offline launcher → actual input/combat → progression/retry → portable project package. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { openEditor } from './harness.mjs';
import { delay } from './cdp.mjs';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:17420';
const out = resolve(process.env.CUBE_RPG_E2E_DIR ?? 'exports/cube-rpg-acceptance');
await mkdir(out, { recursive: true });
const app = await openEditor({ baseUrl, readySelector: '.launcher', width: 1440, height: 900 });
app.page.socket.on('message', (raw) => {
  const e = JSON.parse(raw.toString());
  if (e.method === 'Page.javascriptDialogOpening' && e.params.type === 'beforeunload') {
    void app.page.call('Page.handleJavaScriptDialog', { accept: true });
  }
});
const shot = async (name) => {
  const result = await app.page.call('Page.captureScreenshot', { format: 'png' });
  await writeFile(resolve(out, `${name}.png`), Buffer.from(result.data, 'base64'));
};
const press = (code, key, type = 'keyDown') => app.page.call('Input.dispatchKeyEvent', { type, code, key });
const tap = async (code, key) => { await press(code, key); await delay(70); await press(code, key, 'keyUp'); };
const vars = () => app.evaluate(`Object.fromEntries(window.__featherStore.variables.map(v => [v.name, window.__featherStore.runtimeVariableValues[v.id] ?? v.defaultValue]))`);
const clickText = async (text) => {
  await app.evaluate(`(() => { const b = [...document.querySelectorAll('.rpg-button')].find(b => b.textContent === ${JSON.stringify(text)} && b.offsetHeight > 0); if (!b) throw new Error('Button missing: ' + ${JSON.stringify(text)}); b.click(); })()`);
};
const snapshot = () => app.evaluate(`window.__featherStore.activeScene().objects.map(o => ({ id: o.id, name: o.name, p: o.transform.position, enemy: o.variables?.enemy, arena: o.variables?.arena }))`);
try {
  await app.page.call('Network.enable');
  await app.page.call('Network.setBlockedURLs', { urls: ['*/store/catalog.json'] });
  await app.evaluate('window.rpgBeforeReload = true');
  await app.page.call('Page.reload', { ignoreCache: true });
  await app.waitFor(`!window.rpgBeforeReload && document.querySelector('[data-quick-start="cube-rpg"]')`);
  await shot('launcher');
  await app.evaluate(`document.querySelector('[data-quick-start="cube-rpg"]').scrollIntoView({ block: 'center' })`);
  await app.realClick('[data-quick-start="cube-rpg"]');
  await app.waitFor(`window.__featherStore?.scenes.some(s => s.name === 'Cube RPG — The Skyward Trials') && document.querySelector('[data-testid="toolbar-play-button"]')`);
  assert.equal(await app.evaluate(`window.__featherStore.assets.length`), 0);
  if ((process.env.FEATHER_E2E_ANGLE ?? process.env.FEATHER_CHROME_ANGLE ?? 'swiftshader') === 'swiftshader') {
    // CI uses a CPU renderer. Keep its gameplay test within that rendering budget.
    await app.evaluate(`window.__featherStore.updateRenderSettings({ quality: 'Low', autoQuality: false })`);
  }
  await app.realClick('[data-testid="toolbar-play-button"]');
  await app.waitFor(`document.querySelector('.rpg-menu')?.textContent.includes('Begin adventure')`);
  await app.waitFor(`document.querySelector('canvas')?.getBoundingClientRect().width > 400`);
  // Shader compilation can finish after the DOM HUD mounts. Verify the actual world rendered.
  const deadline = Date.now() + 60_000;
  let pixels;
  do { pixels = await app.pixelStats('canvas'); if (pixels.meanLuminance > 85) break; await delay(500); } while (Date.now() < deadline);
  assert.ok(pixels.meanLuminance > 85, `World renders behind the HUD: ${JSON.stringify(pixels)}`);
  await shot('start');
  await clickText('Begin adventure →');
  await app.waitFor(`window.__featherStore.runtimeTimeScale === 1 && document.querySelector('.rpg-actions')?.offsetHeight > 0`);
  await delay(800);
  const before = (await snapshot()).find(o => o.name === 'Cubie — Player Controller');
  await press('KeyW', 'w');
  await app.waitFor(`(() => { const p = window.__featherStore.activeScene().objects.find(o => o.id === ${JSON.stringify(before.id)}).transform.position; return Math.hypot(p[0] - ${before.p[0]}, p[2] - ${before.p[2]}) > 1; })()`, { label: 'Actual WASD movement' });
  await press('KeyW', 'w', 'keyUp');
  const after = (await snapshot()).find(o => o.id === before.id);
  assert.ok(Math.hypot(after.p[0] - before.p[0], after.p[2] - before.p[2]) > 1, 'Actual WASD moves Cubie');
  await shot('combat');
  await press('KeyQ', 'q');
  await app.waitFor(`(() => { const s = window.__featherStore; const v = s.variables.find(v => v.name === 'RpgBlocking'); return s.runtimeVariableValues[v.id] === true; })()`);
  assert.equal((await vars()).RpgBlocking, true, 'Actual held shield input');
  await press('KeyQ', 'q', 'keyUp');
  await tap('Digit1', '1'); await delay(150);
  assert.equal((await vars()).RpgSword, false, 'Equipment can be removed');
  await tap('Digit1', '1'); await delay(150);
  assert.equal((await vars()).RpgSword, true, 'Equipment can be restored');
  // Observe the actual rendered runtime at contact. Freeze the first hit through the game's
  // own pause event so a screenshot can show the brief flash, squint and impact star together.
  await app.evaluate(`(() => {
    const observe = () => {
      const s = window.__featherStore, objects = s.activeScene().objects;
      const foe = objects.find(o => o.variables?.enemy && s.runtimeObjectVariables[o.id]?.reacting);
      if (foe) {
        const rig = objects.find(o => o.id === foe.variables.rig_anchor);
        const mesh = objects.find(o => o.id === rig.variables.mesh_anchor);
        if (mesh.renderer.materialOverrides?.color === '#FFF4CC') {
          window.rpgImpact = {
            face: objects.find(o => o.id === rig.variables.eye_left).transform.scale,
            mouth: objects.find(o => o.id === rig.variables.mouth_anchor).transform.scale,
            pose: s.runtimeObjectVariables[rig.id].pose,
            flash: mesh.renderer.materialOverrides,
            star: objects.find(o => o.id === foe.variables.impact_anchor).transform.scale,
            camera: s.runtimeCameraOverrides[${JSON.stringify(before.id)}], shake: s.runtimeCameraShake
          };
          s.fireCustomEvent('CubePause'); return;
        }
      }
      requestAnimationFrame(observe);
    }; requestAnimationFrame(observe);
  })()`);
  await app.evaluate(`(() => { window.rpgMaxCombo = 0; const watch = () => {
    const s = window.__featherStore, v = s.variables.find(v => v.name === 'RpgCombo');
    window.rpgMaxCombo = Math.max(window.rpgMaxCombo, s.runtimeVariableValues[v.id] ?? 0);
    if (s.isPlaying) requestAnimationFrame(watch);
  }; requestAnimationFrame(watch); })()`);
  // Put the knight in reach, then use real attack inputs. No direct damage or enemy deletion.
  for (let arena = 1; arena <= 3; arena++) {
    for (const foe of (await snapshot()).filter(o => o.enemy && o.arena === arena)) {
      await app.evaluate(`window.__featherStore.updateTransform(${JSON.stringify(before.id)}, 'position', ${JSON.stringify([foe.p[0], 0.1, foe.p[2] - 1.2])})`);
      if (arena === 3) {
        // Real jump + attack: the plunge must land on the arena and slam the boss.
        await delay(500);
        const hpOf = `(window.__featherStore.runtimeObjectVariables[${JSON.stringify(foe.id)}]?.hp ?? 252)`;
        const hpBefore = await app.evaluate(hpOf);
        await tap('Space', ' '); await delay(160); await tap('KeyJ', 'j');
        await app.waitFor(`${hpOf} < ${hpBefore} && window.__featherStore.runtimeObjectVariables[${JSON.stringify(before.id)}]?.air_ready === true`, { label: 'Real jump-attack ground slam' });
        const landed = await app.evaluate(`window.__featherStore.activeScene().objects.find(o => o.id === ${JSON.stringify(before.id)}).transform.position[1]`);
        assert.ok(landed > -0.2 && landed < 0.6, `Slam lands on the arena floor (y=${landed})`);
        await shot('ground-slam');
        console.log(`Ground slam: boss ${hpBefore} → ${await app.evaluate(hpOf)} hp`);
      }
      for (let hits = 0; hits < 14; hits++) {
        if (arena === 1 && hits === 0) await app.realClick('canvas');
        else await tap('KeyJ', 'j');
        if (arena === 1 && hits === 0 && !await app.evaluate('window.rpgImpactCaptured')) {
          // A foe that is already winding up is armored against a single slash; keep slashing until one staggers.
          for (let retry = 0; retry < 8 && !await app.evaluate('Boolean(window.rpgImpact)'); retry++) { await delay(450); await tap('KeyJ', 'j'); }
          await app.waitFor('window.rpgImpact && window.__featherStore.runtimeTimeScale === 0');
          const impact = await app.evaluate('window.rpgImpact');
          assert.equal(impact.pose, 'hurt');
          assert.equal(impact.face[1], 0.22, 'Real hit squints the face');
          assert.deepEqual(impact.mouth, [1, 1, 1], 'Real hit opens the hurt mouth');
          assert.equal(impact.flash.emissiveIntensity, 0.8);
          assert.ok(impact.star[0] > 0.1, 'Real hit displays the impact star');
          assert.deepEqual(impact.camera, { distance: 9.7, height: 4.7 });
          assert.ok(impact.shake > 0, 'Contact kicks the camera');
          await writeFile(resolve(out, 'hit-reaction.json'), JSON.stringify(impact, null, 2));
          await app.evaluate(`document.head.insertAdjacentHTML('beforeend', '<style id="rpg-hit-capture">.rpg-menu { visibility: hidden !important; }</style>')`);
          await shot('hit-reaction');
          await app.evaluate(`document.querySelector('#rpg-hit-capture').remove(); window.rpgImpactCaptured = true; window.__featherStore.fireCustomEvent('CubeResume')`);
          await app.waitFor('window.__featherStore.runtimeTimeScale === 1');
        }
        await delay(400);
        if (!(await snapshot()).some(o => o.id === foe.id)) break;
      }
      assert.equal((await snapshot()).some(o => o.id === foe.id), false, `Sword defeats ${foe.name}`);
      if ((await vars()).RpgHealth < 80) { await tap('KeyE', 'e'); await delay(150); }
    }
    assert.equal((await vars()).RpgEnemies, 0);
    console.log(`Arena ${arena} cleared through real sword input (best combo ${await app.evaluate('window.rpgMaxCombo')})`);
    if (arena < 3) {
      await app.evaluate(`window.__featherStore.updateTransform(${JSON.stringify(before.id)}, 'position', [0, 0.2, ${(arena - 1) * 36 + 23}])`);
      await app.waitFor(`(() => { const s = window.__featherStore; const v = s.variables.find(v => v.name === 'RpgArena'); return s.runtimeVariableValues[v.id] === ${arena + 1}; })()`);
      await shot(`arena-${arena + 1}`);
    }
  }
  assert.equal(await app.evaluate('window.rpgMaxCombo'), 3, 'Real key taps chain the full 3-hit combo');
  await app.waitFor(`document.querySelector('.rpg-menu')?.textContent.includes('The crown is yours') || [...document.querySelectorAll('.rpg-menu')].some(p => p.offsetHeight > 0 && p.textContent.includes('The crown is yours'))`);
  assert.equal((await vars()).RpgVictory, true);
  await shot('victory');
  await clickText('Play again →');
  await app.waitFor(`window.__featherStore.runtimeTimeScale === 1`);
  assert.equal((await vars()).RpgHealth, 100);
  assert.equal((await snapshot()).filter(o => o.enemy).length, 7);
  await tap('KeyP', 'p');
  await app.waitFor(`window.__featherStore.runtimeTimeScale === 0`);
  await shot('pause');
  await clickText('Resume adventure →');
  await app.waitFor(`window.__featherStore.runtimeTimeScale === 1`);
  // Run off the authored floor to exercise the real physics recovery trigger.
  await app.evaluate(`window.__featherStore.updateTransform(${JSON.stringify(before.id)}, 'position', [0, 0.2, -11.5])`);
  await press('KeyS', 's');
  await app.waitFor(`(() => { const s = window.__featherStore; const v = s.variables.find(v => v.name === 'RpgHealth'); return s.runtimeVariableValues[v.id] === 80; })()`, { label: 'Physical fall recovery' });
  await press('KeyS', 's', 'keyUp');
  await app.realClick('[data-testid="toolbar-play-button"]');
  await app.waitFor(`!window.__featherStore.isPlaying`);
  await app.evaluate(`window.__featherStore.updateRenderSettings({ quality: 'High', autoQuality: true })`);
  const pkg = await app.evaluate(`window.__featherStore.buildProjectPackage()`);
  assert.equal(pkg.assetIds.length, 0);
  assert.equal(pkg.content.prefabs.length, 1);
  await writeFile(resolve(out, 'project-package.json'), JSON.stringify(pkg.content));
  const bundle = await app.evaluate(`(async () => {
    const { buildGameBundle } = await import('/src/project/exportGame.ts');
    const project = window.__featherStore.exportProject(); project.name = 'Cube RPG';
    return buildGameBundle(project);
  })()`);
  await writeFile(resolve(out, 'cube-rpg.json'), JSON.stringify(bundle));
  console.log(`✓ Cube RPG passed: offline creation, real movement, equipment, shield, sword combat, 3-hit combo, jump-attack ground slam, hit expressions/material flash/VFX/camera kick, all three arenas, boss, victory, replay, pause and physical fall recovery. Artifacts: ${out}`);
} catch (error) {
  await shot('failure').catch(() => {});
  console.error('Cube RPG failed:', error, await vars().catch(() => null));
  throw error;
} finally { await app.dispose(); }
