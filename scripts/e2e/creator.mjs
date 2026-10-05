/** Focused Creator Mode browser smoke test. Run against `npm run dev -- --port 17420`. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { launch, delay } from './cdp.mjs';
import { openEditor } from './harness.mjs';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:17420';
const SHOT_DIR = process.env.CREATOR_E2E_SHOT_DIR;

async function screenshot(page, name) {
  if (!SHOT_DIR) return;
  await mkdir(SHOT_DIR, { recursive: true });
  const shot = await page.call('Page.captureScreenshot', { format: 'png' });
  await writeFile(`${SHOT_DIR}/${name}.png`, Buffer.from(shot.data, 'base64'));
}

async function launcherSmoke() {
  const { page, dispose } = await launch({ width: 1600, height: 1000 });
  const evaluate = async (expression) => {
    const result = await page.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result?.value;
  };
  const waitFor = async (expression, label) => {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (await evaluate(`Boolean(${expression})`).catch(() => false)) return;
      await delay(200);
    }
    throw new Error(`Timed out waiting for ${label}`);
  };
  const assertHiddenStarters = async () => {
    for (const slug of ['template-third-person', 'template-sim-racing', 'template-tower-defense']) {
      assert.equal(
        await evaluate(`document.querySelectorAll('[data-template-slug="${slug}"]').length`),
        0,
        `${slug} stays hidden in the launcher`,
      );
    }
  };

  try {
    await page.call('Page.navigate', { url: `${BASE_URL}/` });
    await waitFor(`document.querySelector('.launcher')`, 'Creator launcher');
    assert.equal(await evaluate(`document.querySelector('#launcher-title')?.textContent.trim()`), "Let's make something.");
    assert.equal(await evaluate(`document.querySelectorAll('.launcher-quick-card').length`), 6);
    assert.equal(await evaluate(`document.querySelectorAll('[data-quick-start="tower-defense"], [data-quick-start="third-person"]').length`), 0);
    assert.equal(await evaluate(`document.querySelector('[data-quick-start="crystal-slice"]')?.disabled`), false);
    assert.equal(await evaluate(`document.querySelector('[data-quick-start="cube-rpg"]')?.disabled`), false);
    assert.equal(await evaluate(`document.querySelector('[data-quick-start="platformer"]')?.disabled`), false);
    assert.equal(await evaluate(`document.querySelector('[data-quick-start="platformer"]')?.textContent.includes('Coming soon')`), false);
    assert.equal(await evaluate(`document.querySelector('.hub-ai').open`), false);
    await evaluate(`document.querySelector('.hub-ai > summary').click()`);
    assert.ok(await evaluate(`document.querySelector('#launcher-game-description')?.placeholder.includes('third-person adventure')`));
    await waitFor(`document.querySelector('.hub-library-footer')`, 'starter catalog loaded');
    await assertHiddenStarters();
    await screenshot(page, 'launcher');

    await evaluate(`document.querySelector('.hub-library-toggle').click()`);
    await waitFor(`document.querySelector('.hub-library-toggle')?.getAttribute('aria-expanded') === 'true'`, 'all starter worlds');
    await assertHiddenStarters();
    for (const slug of ['template-first-person', 'template-driving', 'template-spline-studio', 'template-verdant']) {
      assert.equal(await evaluate(`document.querySelector('[data-template-slug="${slug}"]')?.disabled`), false);
    }

    for (const query of ['First Person', 'Third Person', 'third-person', 'Sim Racing', 'sim-racing', 'Sproutwatch', 'tower-defense']) {
      await evaluate(`(() => {
        const input = document.querySelector('[aria-label="Search starter worlds"]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(query)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await waitFor(`document.querySelector('[aria-label="Clear search"]')`, 'starter search active');
      if (query === 'First Person') {
        await waitFor(`document.querySelector('.hub-library-footer')?.textContent.includes('matching world')`, 'search results updated');
        assert.equal(await evaluate(`document.querySelector('[data-template-slug="template-first-person"]')?.disabled`), false);
      }
      await assertHiddenStarters();
    }
  } finally {
    await dispose();
  }
}

async function editorSmoke() {
  const app = await openEditor({ baseUrl: BASE_URL, query: '?demo=store', width: 1600, height: 1000 });
  try {
    await app.waitFor(`document.querySelector('[data-creator-mode="build"].active')`, { label: 'Build mode active' });
    assert.equal(await app.count('[data-creator-mode]'), 3);
    assert.equal(await app.count('.dv-tabs-and-actions-container'), 4, 'default workspace includes the bottom asset dock');
    assert.ok((await app.text('.dv-tabs-and-actions-container'))?.includes('Agent'));
    assert.ok(await app.evaluate(`Array.from(document.querySelectorAll('.dv-tabs-and-actions-container')).some((tabs) => tabs.textContent.includes('Assets') && tabs.textContent.includes('Asset Store'))`), 'Assets and Asset Store share the bottom dock');

    await app.realClick('.add-trigger');
    await app.waitFor(`document.querySelector('.editor-picker[role="dialog"]')`, { label: 'Creator Add object picker' });
    const categories = await app.text('.editor-picker-categories');
    for (const name of ['Gameplay', 'Nature', 'Advanced', 'Scene starters']) assert.ok(categories.includes(name));
    await app.evaluate(`Array.from(document.querySelectorAll('.editor-picker-categories button')).find((button) => button.textContent === 'Gameplay').click()`);
    await app.waitFor(`document.querySelector('[data-action-id="role-collectible"]')`);
    assert.equal(await app.count('.editor-picker-result[data-action-id^="role-"]'), 7);
    await app.realClick('[data-action-id="role-collectible"]');
    await app.waitFor(`window.__featherStore.scenes.flatMap((scene) => scene.objects).some((object) => object.creatorRoleId === 'collectible')`, {
      label: 'Collectible created through Add',
    });
    await app.waitFor(`document.querySelector('.make-it-section') && document.querySelector('.creator-appearance-section')`, {
      label: 'Creator Inspector sections',
    });
    assert.ok((await app.text('.inspector-panel'))?.includes('Gameplay role'));
    assert.ok((await app.text('.inspector-panel'))?.includes('Gameplay'));
    assert.ok((await app.text('.inspector-panel'))?.includes('Appearance'));
    assert.ok((await app.text('.inspector-panel'))?.includes('Interactions'));
    assert.ok((await app.text('.hierarchy-panel'))?.includes('Collectible'));

    // The milestone scene needs a real Player and ground before Play. Create the Player through the
    // visible gameplay-first Add menu, then let the kit action add only the missing ground.
    await app.realClick('.add-trigger');
    await app.waitFor(`document.querySelector('.editor-picker')`, { label: 'Add object picker reopened' });
    await app.evaluate(`Array.from(document.querySelectorAll('.editor-picker-categories button')).find((button) => button.textContent === 'Gameplay').click()`);
    await app.waitFor(`document.querySelector('[data-action-id="role-player"]')`);
    await app.realClick('[data-action-id="role-player"]');
    await app.waitFor(`window.__featherStore.scenes.flatMap((scene) => scene.objects).some((object) => object.creatorRoleId === 'player')`, {
      label: 'Player created through Add',
    });
    await app.evaluate(`(() => {
      const store = window.__featherStore;
      store.createCreatorGameplayKit('third-person-starter');
      const player = store.scenes.flatMap((scene) => scene.objects).find((object) => object.creatorRoleId === 'player');
      const collectible = store.scenes.flatMap((scene) => scene.objects).find((object) => object.creatorRoleId === 'collectible');
      if (player) store.updateTransform(player.id, 'position', [0, 1.1, 4]);
      if (collectible) store.updateTransform(collectible.id, 'position', [2, 1, 0]);
    })()`);

    const doorId = await app.evaluate(`(() => {
      const id = window.__featherStore.createObjectWithProps('cube', { name: 'QA Door', position: [0, 1, -3] });
      window.__featherStore.selectObject(id);
      return id;
    })()`);
    await app.waitFor(`document.querySelector('.make-it-section')`, { label: 'Make It available for cube' });
    await app.evaluate(`Array.from(document.querySelectorAll('.editor-disclosure summary')).find((summary) => summary.textContent.startsWith('Gameplay role')).click()`);
    await app.evaluate(`(() => {
      const buttons = [...document.querySelectorAll('.creator-role-card')];
      buttons.find((button) => button.textContent.includes('Door'))?.click();
    })()`);
    await app.waitFor(`window.__featherStore.scenes.flatMap((scene) => scene.objects).find((object) => object.id === ${JSON.stringify(doorId)})?.creatorRoleId === 'door'`, {
      label: 'Make It Door applied',
    });
    const sharedDoorBlueprint = await app.evaluate(`window.__featherStore.scenes.flatMap((scene) => scene.objects).find((object) => object.id === ${JSON.stringify(doorId)}).script.blueprintId`);
    await app.evaluate(`document.querySelector('.creator-interaction-builder summary')?.click()`);
    await app.waitFor(`document.querySelector('.creator-interaction-form')`, { label: 'simple interaction builder expanded' });
    await app.evaluate(`document.querySelector('.creator-interaction-add')?.click()`);
    await app.waitFor(`window.__featherStore.scenes.flatMap((scene) => scene.objects).find((object) => object.id === ${JSON.stringify(doorId)})?.creatorInteractions?.length === 1`, {
      label: 'simple interaction compiled',
    });
    const creatorDoorBlueprint = await app.evaluate(`window.__featherStore.scenes.flatMap((scene) => scene.objects).find((object) => object.id === ${JSON.stringify(doorId)}).script.blueprintId`);
    assert.notEqual(creatorDoorBlueprint, sharedDoorBlueprint, 'simple interaction forks shared role logic');

    await screenshot(app.page, 'build');

    await app.realClick('[data-creator-mode="logic"]');
    await app.waitFor(`document.querySelector('[data-creator-mode="logic"].active') && document.querySelector('.scripting-panel')`, {
      label: 'Logic mode focused existing scripting panel',
    });
    await app.realClick('[data-creator-mode="build"]');
    await app.waitFor(`document.querySelector('[data-creator-mode="build"].active')`, { label: 'Build mode restored' });

    await app.realClick('[data-testid="toolbar-play-button"]');
    await app.waitFor(`window.__featherStore.isPlaying === true && document.querySelector('[data-creator-mode="play"].active')`, {
      label: 'Play uses existing runtime',
    });
    await app.waitFor(`document.querySelector('.scene-drop-zone canvas')`, { label: 'game canvas mounted' });
    await delay(900);
    const playPixels = await app.pixelStats('.scene-drop-zone');
    await screenshot(app.page, 'play');
    console.log(`[creator-e2e] Play pixels: ${JSON.stringify(playPixels)}`);
    assert.ok(playPixels.meanLuminance > 3, 'Play view rendered visible scene pixels');
    await app.page.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    await app.page.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
    await app.waitFor(`window.__featherStore.isPlaying === false && document.querySelector('[data-creator-mode="build"].active')`, {
      label: 'Escape returns Play to Build',
    });
    assert.equal(await app.evaluate(`window.__featherStore.scenes.flatMap((scene) => scene.objects).find((object) => object.id === ${JSON.stringify(doorId)})?.creatorRoleId`), 'door');
  } finally {
    await app.dispose();
  }
}

await launcherSmoke();
if (!process.argv.includes('--launcher-only')) await editorSmoke();
console.log('✓ Creator Mode browser smoke passed');
