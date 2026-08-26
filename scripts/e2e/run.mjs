/**
 * Editor end-to-end suite.
 *
 * Covers the visual scripting graph — the highest-value, least-covered surface in the editor. The
 * jsdom unit suite cannot render it and the MCP screenshot harness cannot click its nodes, so until
 * now the node editor's primary interactions had NO automated coverage at all.
 *
 * Run against an already-running dev server:  npm run test:e2e
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { openEditor } from './harness.mjs';
import { delay } from './cdp.mjs';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:17420';

const specs = [];
const spec = (name, fn) => specs.push({ name, fn });

/** Reveal the Scripting panel through the View menu (it is not docked by default). */
async function openScripting(app) {
  await app.evaluate(`(() => {
    const menu = document.querySelector('[data-menu=view] .file-menu-trigger');
    menu?.click();
  })()`);
  await app.waitFor(`document.querySelector('[data-menu=view] .file-menu-popover')`, { label: 'view menu open' });
  await app.evaluate(`(() => {
    const items = [...document.querySelectorAll('[data-menu=view] .file-menu-popover button')];
    items.find((b) => b.textContent.trim() === 'Scripting')?.click();
  })()`);
  await app.waitFor(`document.querySelector('.nodeforge-node')`, { label: 'graph nodes rendered' });
}

/** Retry an async module evaluation if Vite finishes a cold-start reload while CDP is awaiting it. */
async function evaluateAfterReload(app, expression) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await app.evaluate(expression);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('Promise was collected') || attempt === 3) throw error;
      await app.waitFor(`document.readyState === 'complete' && document.querySelector('.toolbar')`, {
        label: 'editor stable after Vite reload',
      });
      await delay(500);
    }
  }
  throw new Error('Editor evaluation did not complete.');
}

/** Open a named entry in the View menu (built-in panels and plugin panels alike). */
async function clickViewMenuEntry(app, title) {
  await app.evaluate(`document.querySelector('[data-menu=view] .file-menu-trigger')?.click()`);
  await app.waitFor(`document.querySelector('[data-menu=view] .file-menu-popover')`, { label: 'view menu open' });
  await app.evaluate(`(() => {
    const items = [...document.querySelectorAll('[data-menu=view] .file-menu-popover button')];
    items.find((b) => b.textContent.trim() === ${JSON.stringify(title)})?.click();
  })()`);
}

/** A genuine pointer drag via CDP — presses, sweeps in steps, releases. from===to acts as a click. */
async function dragOn(app, from, to, steps = 6) {
  await app.page.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none', buttons: 0 });
  await delay(40);
  await app.page.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
  await delay(40);
  for (let i = 1; i <= steps; i += 1) {
    await app.page.call('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: from.x + ((to.x - from.x) * i) / steps,
      y: from.y + ((to.y - from.y) * i) / steps,
      button: 'left',
      buttons: 1,
    });
    await delay(25);
  }
  await app.page.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0 });
  await delay(150);
}

spec('asset store installs the Arbor Forge plugin and its studio plants a grove', async () => {
  const app = await openEditor({ baseUrl: BASE_URL, query: '?demo=store' });
  try {
    // A previous run persisted the install; start from OFF so this covers the real install path.
    await app.evaluate(`localStorage.removeItem('nodeforge.plugins')`);
    await app.evaluate(`location.reload()`);
    await app.waitFor(`document.querySelector('.toolbar')`, { label: 'editor reloaded' });

    await clickViewMenuEntry(app, 'Store');
    await app.waitFor(`document.querySelector('.store-card')`, { label: 'catalog loaded' });
    await app.evaluate(`(() => {
      const card = [...document.querySelectorAll('.store-card')].find((c) => c.textContent.includes('Arbor Forge'));
      card?.querySelector('.store-install-button')?.click();
    })()`);
    // Install persists the module id and the card flips to Remove.
    await app.waitFor(
      `(JSON.parse(localStorage.getItem('nodeforge.plugins') ?? '{}').state?.enabledIds ?? []).includes('feather.arbor-forge')`,
      { label: 'plugin persisted' },
    );
    await app.waitFor(
      `[...document.querySelectorAll('.store-card')].find((c) => c.textContent.includes('Arbor Forge'))?.textContent.includes('Remove')`,
      { label: 'card shows Remove' },
    );

    // The activated plugin's panel is reachable from View → Extensions and renders its gallery.
    await clickViewMenuEntry(app, 'Arbor Forge');
    await app.waitFor(`document.querySelectorAll('.arbor-preset-card').length >= 12`, { label: 'preset gallery rendered' });
    await app.waitFor(`document.querySelector('.tree-preview-canvas canvas')`, { label: 'live preview canvas' });

    // Plant a grove and count what actually landed in the scene.
    const before = await app.evaluate(
      `(() => { const s = window.__featherStore; return s.scenes.find((x) => x.id === s.activeSceneId).objects.length; })()`,
    );
    await app.evaluate(`(() => {
      const cards = [...document.querySelectorAll('.arbor-preset-card')];
      cards.find((c) => c.textContent.includes('Baobab'))?.click();
    })()`);
    await app.evaluate(`(() => {
      const buttons = [...document.querySelectorAll('button')];
      buttons.find((b) => b.textContent.trim() === 'Plant Grove')?.click();
    })()`);
    // Default grove size is 14 trees + 1 group object.
    await app.waitFor(
      `(() => { const s = window.__featherStore; return s.scenes.find((x) => x.id === s.activeSceneId).objects.length === ${before} + 15; })()`,
      { label: 'grove landed' },
    );
  } finally {
    await app.dispose();
  }
});

spec('Pixel Art Trees installs, renders all species and plants deterministic vegetation', async () => {
  const app = await openEditor({ baseUrl: BASE_URL, query: '?demo=store' });
  try {
    await app.evaluate(`localStorage.removeItem('nodeforge.plugins')`);
    await app.evaluate(`location.reload()`);
    await app.waitFor(`document.querySelector('.toolbar')`, { label: 'editor reloaded' });

    await clickViewMenuEntry(app, 'Store');
    await app.waitFor(`document.querySelector('.store-card')`, { label: 'catalog loaded' });
    await app.evaluate(`(() => {
      const card = [...document.querySelectorAll('.store-card')]
        .find((candidate) => candidate.textContent.includes('Pixel Art Trees'));
      card?.querySelector('.store-install-button')?.click();
    })()`);
    await app.waitFor(
      `(JSON.parse(localStorage.getItem('nodeforge.plugins') ?? '{}').state?.enabledIds ?? []).includes('feather.pixel-art-trees')`,
      { label: 'Pixel Art Trees persisted' },
    );

    await clickViewMenuEntry(app, 'Pixel Art Trees');
    await app.waitFor(`document.querySelectorAll('.pixel-art-trees-species').length === 9`, {
      label: 'nine pixel species rendered',
    });
    await app.waitFor(`document.querySelector('.pixel-art-trees-canvas canvas')`, { label: 'pixel tree preview rendered' });
    const previewPixels = await app.pixelStats('.pixel-art-trees-canvas');
    assert.ok(previewPixels.meanLuminance > 8, 'preview is not a blank black WebGL surface');
    assert.ok(previewPixels.meanLuminance < 190, 'preview keeps its dark editor framing');

    // Pick a fantasy leaf language, switch the growth habit, and verify the real recipe reaches the scene.
    await app.evaluate(`(() => {
      [...document.querySelectorAll('.pixel-art-trees-species')]
        .find((button) => button.textContent.includes('Lanternwood'))?.click();
      const habit = [...document.querySelectorAll('.pixel-art-trees-controls select')]
        .find((select) => select.closest('label')?.textContent.includes('Growth habit'));
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(habit, 'ancient');
      habit.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await app.waitFor(
      `document.querySelector('.tree-preview-meta')?.textContent.includes('Pixel Lanternwood — Ancient')`,
      { label: 'Lanternwood ancient preview updated' },
    );

    const before = await app.evaluate(
      `(() => { const s = window.__featherStore; return s.scenes.find((scene) => scene.id === s.activeSceneId).objects.length; })()`,
    );
    await app.evaluate(`(() => {
      [...document.querySelectorAll('.pixel-art-trees-panel button')]
        .find((button) => button.textContent.trim() === 'Plant This Tree')?.click();
    })()`);
    await app.waitFor(
      `(() => {
        const s = window.__featherStore;
        const objects = s.scenes.find((scene) => scene.id === s.activeSceneId).objects;
        return objects.length === ${before} + 1 && objects.some((object) =>
          object.tree?.spec?.look?.pixelArt?.enabled && object.tree.spec.look.pixelArt.leafArt === 'pod');
      })()`,
      { label: 'painted Lanternwood tree landed' },
    );

    await app.evaluate(`(() => {
      [...document.querySelectorAll('.pixel-art-trees-panel button')]
        .find((button) => button.textContent.trim() === 'Plant Pixel Grove')?.click();
    })()`);
    // Default is 18 linked trees plus their grouping object.
    await app.waitFor(
      `(() => { const s = window.__featherStore; return s.scenes.find((scene) => scene.id === s.activeSceneId).objects.length === ${before} + 20; })()`,
      { label: 'pixel grove landed' },
    );
  } finally {
    await app.dispose();
  }
});

spec('preferences plugin manager installs, opens and removes Arbor Forge', async () => {
  const app = await openEditor({ baseUrl: BASE_URL, query: '?demo=store' });
  try {
    await app.evaluate(`localStorage.removeItem('nodeforge.plugins')`);
    await app.evaluate(`location.reload()`);
    await app.waitFor(`document.querySelector('.toolbar')`, { label: 'editor reloaded' });

    // View → Preferences… → Plugins tab.
    await clickViewMenuEntry(app, 'Preferences…');
    await app.waitFor(`document.querySelector('.prefs-card')`, { label: 'preferences open' });
    await app.evaluate(`(() => {
      const tabs = [...document.querySelectorAll('.prefs-tab')];
      tabs.find((b) => b.textContent.trim() === 'Plugins')?.click();
    })()`);
    await app.waitFor(`document.querySelector('.prefs-plugin-row')`, { label: 'plugin rows rendered' });

    // The gallery plugin lists OFF, switches ON, and persists.
    const arborSwitch = `[...document.querySelectorAll('.prefs-plugin-row')]
      .find((r) => r.textContent.includes('Arbor Forge'))?.querySelector('input[role=switch]')`;
    await app.waitFor(`(${arborSwitch})?.checked === false`, { label: 'Arbor Forge listed off' });
    await app.evaluate(`(${arborSwitch})?.click()`);
    await app.waitFor(
      `(JSON.parse(localStorage.getItem('nodeforge.plugins') ?? '{}').state?.enabledIds ?? []).includes('feather.arbor-forge')`,
      { label: 'manager persisted the install' },
    );

    // The row's Open panel button lands in the studio (and closes the modal).
    await app.evaluate(`(() => {
      const row = [...document.querySelectorAll('.prefs-plugin-row')].find((r) => r.textContent.includes('Arbor Forge'));
      [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Open panel')?.click();
    })()`);
    await app.waitFor(`document.querySelectorAll('.arbor-preset-card').length >= 12`, { label: 'panel opened from manager' });
    await app.waitFor(`!document.querySelector('.prefs-card')`, { label: 'modal closed' });

    // Switching OFF deactivates live: the persisted id AND the open panel both go away.
    await clickViewMenuEntry(app, 'Preferences…');
    await app.waitFor(`document.querySelector('.prefs-card')`, { label: 'preferences reopened' });
    await app.evaluate(`(() => {
      const tabs = [...document.querySelectorAll('.prefs-tab')];
      tabs.find((b) => b.textContent.trim() === 'Plugins')?.click();
    })()`);
    await app.waitFor(`(${arborSwitch})?.checked === true`, { label: 'switch reflects installed state' });
    await app.evaluate(`(${arborSwitch})?.click()`);
    await app.waitFor(
      `!(JSON.parse(localStorage.getItem('nodeforge.plugins') ?? '{}').state?.enabledIds ?? []).includes('feather.arbor-forge')`,
      { label: 'manager forgot the install' },
    );
    await app.waitFor(`!document.querySelector('.arbor-preset-card')`, { label: 'plugin panel closed on remove' });
  } finally {
    await app.dispose();
  }
});

spec('production export exposes one profile and all six exact platform targets', async () => {
  const app = await openEditor({ baseUrl: BASE_URL, query: '?demo=timeline' });
  try {
    await app.waitFor(`document.querySelector('button[title="Export your game"]')`, { label: 'Export menu trigger' });
    await app.realClick('button[title="Export your game"]');
    await app.waitFor(`document.querySelector('.export-popover')`, { label: 'Export menu open' });
    await app.realClick('.export-popover button:nth-of-type(2)');
    await app.waitFor(`document.querySelector('[role="dialog"][aria-label="Build report"]')`, {
      label: 'Production Build Report open',
    });

    const dialog = await app.evaluate(`(() => {
      const labels = [...document.querySelectorAll('.report-platform-label')].map((element) => element.textContent.trim());
      const checked = [...document.querySelectorAll('.report-platform-main')]
        .filter((label) => label.querySelector('input').checked)
        .map((label) => label.querySelector('.report-platform-label').textContent.trim());
      const profileFields = [...document.querySelectorAll('.report-profile-grid label > span')]
        .map((element) => element.textContent.trim());
      const build = document.querySelector('.report-footer .prefs-primary-button');
      return { labels, checked, profileFields, buildText: build?.textContent.trim(), buildDisabled: build?.disabled };
    })()`);

    assert.deepEqual(dialog.labels, ['Web', 'Windows', 'macOS', 'Linux', 'Android', 'iOS']);
    assert.deepEqual(dialog.checked, ['Web'], 'a new project starts with a portable Web profile');
    assert.deepEqual(dialog.profileFields, [
      'Product name',
      'Application identifier',
      'Version',
      'Build number',
      'Launch scene',
      'Configuration',
      'Window title',
      'Window width',
      'Window height',
      'Minimum width',
      'Minimum height',
    ]);
    assert.equal(dialog.buildText, 'Build');
    assert.equal(dialog.buildDisabled, false, 'a valid Web production profile can be built');

    await app.evaluate(`(() => {
      const label = [...document.querySelectorAll('.report-profile-grid label')]
        .find((candidate) => candidate.querySelector('span')?.textContent.trim() === 'Application identifier');
      const input = label.querySelector('input');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'invalid');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await app.waitFor(`document.querySelector('.report-footer .prefs-primary-button').disabled`, {
      label: 'invalid profile blocks the build',
    });
    await app.evaluate(`(() => {
      const label = [...document.querySelectorAll('.report-profile-grid label')]
        .find((candidate) => candidate.querySelector('span')?.textContent.trim() === 'Application identifier');
      const input = label.querySelector('input');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'com.example.repaired');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await app.waitFor(`!document.querySelector('.report-footer .prefs-primary-button').disabled`, {
      label: 'repairing the profile re-enables the build',
    });

    await app.evaluate(
      `document.querySelector('.report-platform:nth-child(2) input[type="checkbox"]')?.scrollIntoView({ block: 'center' })`,
    );
    await delay(100);
    await app.realClick('.report-platform:nth-child(2) input[type="checkbox"]');
    await app.waitFor(
      `[...document.querySelectorAll('.report-platform-main')].filter((label) => label.querySelector('input').checked).length === 2`,
      { label: 'Windows added to the staged profile' },
    );
    assert.equal(
      await app.evaluate(`document.querySelector('.report-platform:nth-child(2) input').disabled`),
      false,
      'a browser-authored profile can stage Windows for packaging on a Windows runner',
    );
  } finally {
    await app.dispose();
  }
});

spec('the production parity fixture behaves the same in editor Play', async () => {
  const app = await openEditor({ baseUrl: BASE_URL, query: '?demo=script' });
  try {
    await app.evaluate(`(async () => {
      const raw = await fetch('/scripts/fixtures/production-smoke-game.json').then((response) => response.json());
      const { readGameBundle } = await import('/src/project/exportGame.ts');
      const { useEditorStore } = await import('/src/store/editorStore.ts');
      const loaded = readGameBundle(raw);
      const store = useEditorStore.getState();
      store.loadProject(loaded.project);
      store.setActiveScene(loaded.startSceneId);
      store.setPlaying(true);
    })()`);
    await app.waitFor(
      `document.querySelector('.smoke-script-status')?.textContent?.trim() === 'SCRIPT_OK'`,
      { label: 'Blueprint Start and HUD binding ran in editor Play', timeout: 45_000 },
    );
    await app.waitFor(
      `(() => {
        const values = (document.querySelector('.smoke-physics-position')?.textContent || '').split(',').map(Number);
        return values.length === 3 && Number.isFinite(values[1]) && values[1] < 3.5;
      })()`,
      { label: 'Rapier and Blueprint Update advanced in editor Play', timeout: 45_000 },
    );
    await app.realClick('.smoke-runtime-button');
    await app.waitFor(
      `document.querySelector('.smoke-script-status')?.textContent?.trim() === 'BUTTON_OK'`,
      { label: 'widget custom event reached the Blueprint runtime', timeout: 45_000 },
    );
    assert.equal(await app.count('.cinematic-overlay'), 1, 'editor Play mounts one cinematic overlay, like the player');
  } finally {
    await app.dispose();
  }
});

spec('graph nodes respond to a real click by selecting', async () => {
  const app = await openEditor({ baseUrl: BASE_URL, query: '?demo=script' });
  try {
    await openScripting(app);
    assert.equal(await app.count('.react-flow__node.selected'), 0, 'nothing should be selected initially');
    await app.realClick('.nodeforge-node .nfn-label', { within: '.flow-shell' });
    await app.waitFor(`document.querySelectorAll('.react-flow__node.selected').length === 1`, {
      label: 'a node became selected',
    });
  } finally {
    await app.dispose();
  }
});

spec('scripting canvas is responsive and focus mode keeps the graph readable', async () => {
  const app = await openEditor({ baseUrl: BASE_URL, query: '?demo=script', width: 1600, height: 1000 });
  try {
    await openScripting(app);
    const docked = await app.evaluate(`(() => {
      const body = document.querySelector('.scripting-body').getBoundingClientRect();
      const flow = document.querySelector('.flow-shell').getBoundingClientRect();
      const compact = getComputedStyle(document.querySelector('.scripting-compact-nav')).display !== 'none';
      return { bodyWidth: body.width, flowWidth: flow.width, flowHeight: flow.height, compact };
    })()`);
    assert.equal(docked.compact, true, 'a docked graph uses the canvas-first compact workspace');
    assert.ok(docked.flowWidth >= docked.bodyWidth * 0.9, 'the docked canvas receives nearly the full panel width');
    assert.ok(docked.flowHeight >= 300, 'Scripting opens tall enough to program comfortably');

    await app.realClick('.graph-focus-toggle');
    await app.waitFor(`document.querySelector('.graph-focus-toggle')?.getAttribute('aria-pressed') === 'true'`, {
      label: 'Scripting focus mode enabled',
    });
    const focused = await app.evaluate(`(() => {
      const flow = document.querySelector('.flow-shell').getBoundingClientRect();
      return { width: flow.width, height: flow.height };
    })()`);
    assert.ok(focused.width > 900, 'focused graph has a wide programming canvas');
    assert.ok(focused.height > docked.flowHeight, 'focused graph grows vertically');

    // The primary graph shortcuts work from the focused canvas, not from form fields elsewhere.
    await app.evaluate(`document.querySelector('.flow-shell')?.focus()`);
    await app.page.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA' });
    await app.page.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA' });
    await app.waitFor(`document.querySelector('.node-search')`, { label: 'A shortcut opened node search' });
    await app.page.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    await app.page.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });

    await app.realClick('.graph-focus-toggle');
    await app.waitFor(`document.querySelector('.graph-focus-toggle')?.getAttribute('aria-pressed') === 'false'`, {
      label: 'Scripting focus mode restored',
    });
  } finally {
    await app.dispose();
  }
});

spec('dragging a value wire to empty canvas creates and connects a compatible node', async () => {
  const app = await openEditor({ baseUrl: BASE_URL, query: '?demo=script' });
  try {
    await openScripting(app);
    const numberId = await app.evaluate(
      `window.__featherStore.activeGraph().nodes.find((node) => node.data.nodeKind === 'value.number')?.id`,
    );
    assert.ok(numberId, 'the demo graph has a Number node');
    await app.realClick('.graph-focus-toggle');
    await app.waitFor(`document.querySelector('.graph-focus-toggle')?.getAttribute('aria-pressed') === 'true'`, {
      label: 'graph focused for wire gesture',
    });
    await app.evaluate(`new Promise((resolve) => setTimeout(resolve, 700))`);

    const sourceSelector = `[data-id=${JSON.stringify(numberId)}] .node-port.value-port.source`;
    const source = await app.boxOf(sourceSelector, {
      within: '.flow-shell',
    });
    const sourceState = await app.evaluate(`(() => {
      const node = document.querySelector(${JSON.stringify(`[data-id=${JSON.stringify(numberId)}]`)});
      const pin = document.querySelector(${JSON.stringify(`[data-id=${JSON.stringify(numberId)}] .node-port.value-port.source`)});
      const rect = node?.getBoundingClientRect();
      return { numberId: ${JSON.stringify(numberId)}, nodes: document.querySelectorAll('.react-flow__node').length, node: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null, pin: Boolean(pin) };
    })()`);
    assert.ok(source, `the Number output pin is visible: ${JSON.stringify(sourceState)}`);
    const empty = await app.evaluate(`(() => {
      const r = document.querySelector('.flow-shell').getBoundingClientRect();
      const candidates = [
        [r.left + r.width * 0.76, r.top + r.height * 0.72],
        [r.left + r.width * 0.72, r.top + r.height * 0.52],
        [r.left + r.width * 0.52, r.top + r.height * 0.78],
      ];
      for (const [x, y] of candidates) {
        if (document.elementFromPoint(x, y)?.classList.contains('react-flow__pane')) return { x, y };
      }
      return null;
    })()`);
    assert.ok(empty, 'the graph exposes empty canvas for drag-to-create');
    await dragOn(app, source, empty, 8);
    await app.waitFor(`document.querySelector('.node-search')`, { label: 'compatible node menu opened' });
    await app.evaluate(`(() => {
      const buttons = [...document.querySelectorAll('.node-search-list button')];
      buttons.find((button) => button.textContent.includes('Rotate'))?.click();
    })()`);
    await app.waitFor(
      `(() => {
        const graph = window.__featherStore.graphs.find((item) => item.id === window.__featherStore.blueprints.find((item) => item.id === window.__featherStore.activeBlueprintId)?.graphId);
        const rotate = graph?.nodes.find((node) => node.data.nodeKind === 'action.rotate');
        return Boolean(rotate && graph.edges.some((edge) => edge.source === ${JSON.stringify(numberId)} && edge.target === rotate.id && edge.targetHandle === 'amount'));
      })()`,
      { label: 'new Rotate node auto-wired to Number' },
    );
  } finally {
    await app.dispose();
  }
});

spec('breakpoint dot arms and disarms on click', async () => {
  const app = await openEditor({ baseUrl: BASE_URL, query: '?demo=script' });
  try {
    await openScripting(app);
    assert.equal(await app.count('.nfn-breakpoint.on'), 0, 'no breakpoints at rest');
    assert.ok((await app.count('.nfn-breakpoint')) > 0, 'exec nodes expose a breakpoint toggle');

    await app.realClick('.nfn-breakpoint', { within: '.flow-shell' });
    await app.waitFor(`document.querySelectorAll('.nfn-breakpoint.on').length === 1`, { label: 'breakpoint armed' });

    await app.realClick('.nfn-breakpoint.on', { within: '.flow-shell' });
    await app.waitFor(`document.querySelectorAll('.nfn-breakpoint.on').length === 0`, { label: 'breakpoint cleared' });
  } finally {
    await app.dispose();
  }
});

spec('an armed breakpoint pauses Play and reveals the blueprint', async () => {
  // ?bp=1 arms a breakpoint on a node that runs every frame (rotating-prop's Update).
  const app = await openEditor({ baseUrl: BASE_URL, query: '?demo=script&bp=1' });
  try {
    await app.waitFor(`document.querySelector('.run-button')`, { label: 'run button' });
    await app.realClick('.run-button');
    await app.waitFor(`document.querySelector("[title^='Pause preview']")?.classList.contains('active')`, {
      label: 'Play paused on the breakpoint',
    });
    await app.waitFor(`document.querySelector('.scripting-panel')`, { label: 'Scripting panel auto-revealed' });
    await app.waitFor(`document.querySelector('.exec-broke')`, { label: 'stopped node marked' });
  } finally {
    await app.dispose();
  }
});

spec('node search offers to build from a plain-English description', async () => {
  const app = await openEditor({ baseUrl: BASE_URL, query: '?demo=script' });
  try {
    await openScripting(app);
    await app.realClick('.flow-add-node');
    await app.waitFor(`document.querySelector('.node-search')`, { label: 'node search opened' });

    // A real node name still wins the top slot (the pre-existing behaviour must not regress).
    await app.evaluate(`(() => {
      const input = document.querySelector('.node-search-field input');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'Branch');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await app.waitFor(`document.querySelector('.node-search-list button.active')`, { label: 'node match highlighted' });

    // A description that matches no node offers the AI row instead of a dead end.
    await app.evaluate(`(() => {
      const input = document.querySelector('.node-search-field input');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'when the player touches this add ten score');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await app.waitFor(`document.querySelector('.node-search-ask.active')`, { label: 'AI build row is the active option' });
    assert.equal(await app.count('.node-search-empty'), 0, 'no dead-end empty state while the AI row is offered');
  } finally {
    await app.dispose();
  }
});

spec('Timeline nodes expose an editable curve and controllable playback', async () => {
  const app = await openEditor({ baseUrl: BASE_URL, query: '?demo=script' });
  try {
    await openScripting(app);
    const nodeId = await app.evaluate(`(() => {
      const store = window.__featherStore;
      const id = store.addGraphNodeToBlueprint(store.activeBlueprintId, 'Timeline', 'Runtime', {}, { x: 420, y: 360 });
      store.selectGraphNode(id);
      return id;
    })()`);
    assert.ok(nodeId, 'Timeline node was created');
    await app.waitFor(`document.querySelector('.timeline-curve-editor')`, { label: 'Timeline curve editor' });
    assert.equal(await app.count('.timeline-curve-key'), 2, 'fresh Timelines start with a two-key curve');
    assert.equal(await app.count('.node-port.source[data-handleid="exec-update"]'), 1, 'Timeline exposes Update');
    assert.equal(await app.count('.node-port.source[data-handleid="exec-done"]'), 1, 'Timeline exposes Finished');

    await app.evaluate(`document.querySelector('.timeline-curve-presets button:nth-child(2)')?.scrollIntoView({ block: 'center' })`);
    await delay(150);
    await app.realClick('.timeline-curve-presets button:nth-child(2)');
    await app.waitFor(
      `window.__featherStore.selectedGraphNode().data.tweenCurve.every((key) => key.interpolation === 'linear')`,
      { label: 'Linear preset persisted to graph data' },
    );

    // Use real browser input for the editor's double-click-to-add interaction.
    await app.evaluate(`document.querySelector('.timeline-curve-graph')?.scrollIntoView({ block: 'center' })`);
    await delay(150);
    const point = await app.boxOf('.timeline-curve-graph');
    assert.ok(point, 'curve graph is visible');
    const mouse = { x: point.x, y: point.y, button: 'left', buttons: 1 };
    await app.page.call('Input.dispatchMouseEvent', { ...mouse, type: 'mouseMoved', buttons: 0 });
    await app.page.call('Input.dispatchMouseEvent', { ...mouse, type: 'mousePressed', clickCount: 1 });
    await app.page.call('Input.dispatchMouseEvent', { ...mouse, type: 'mouseReleased', buttons: 0, clickCount: 1 });
    await delay(40);
    await app.page.call('Input.dispatchMouseEvent', { ...mouse, type: 'mousePressed', clickCount: 2 });
    await app.page.call('Input.dispatchMouseEvent', { ...mouse, type: 'mouseReleased', buttons: 0, clickCount: 2 });
    await app.waitFor(`window.__featherStore.selectedGraphNode().data.tweenCurve.length === 3`, {
      label: 'double-click added a Timeline key',
    });
    assert.equal(await app.count('.timeline-curve-key'), 3, 'the added key renders in the editor');

    const controlId = await app.evaluate(`(() => {
      const store = window.__featherStore;
      const id = store.addGraphNodeToBlueprint(store.activeBlueprintId, 'Timeline Control', 'Runtime', {}, { x: 700, y: 360 });
      store.selectGraphNode(id);
      return id;
    })()`);
    assert.ok(controlId, 'Timeline Control node was created');
    await app.waitFor(`document.querySelector('select[aria-label="Timeline to control"]')`, {
      label: 'Timeline selector visible',
    });
    assert.equal(
      await app.evaluate(`(() => {
        const store = window.__featherStore;
        const graph = store.activeGraph();
        const timeline = graph.nodes.find((node) => node.id === ${JSON.stringify(nodeId)});
        return store.selectedGraphNode().data.timelineRefId === (timeline.data.timelineId || timeline.id);
      })()`),
      true,
      'a fresh Control targets the existing Timeline',
    );
    await app.evaluate(`(() => {
      const select = document.querySelector('select[aria-label="Timeline command"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(select, 'reverse');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await app.waitFor(`window.__featherStore.selectedGraphNode().data.timelineCommand === 'reverse'`, {
      label: 'Reverse command persisted to graph data',
    });
  } finally {
    await app.dispose();
  }
});

spec('Timeline Mechanics ships a reusable door that opens and reverses through interaction', async () => {
  const app = await openEditor({ baseUrl: BASE_URL, query: '?demo=timeline' });
  try {
    await app.waitFor(
      `window.__featherStore.prefabs.some((prefab) => prefab.name === 'Interactive Vault Door')`,
      { label: 'Timeline Mechanics gallery and prefab built' },
    );
    const setup = await app.evaluate(`(() => {
      const store = window.__featherStore;
      const prefab = store.prefabs.find((item) => item.name === 'Interactive Vault Door');
      const root = store.activeScene().objects.find(
        (object) => object.prefabSourceId === prefab.id && object.prefabObjectId === prefab.rootId,
      );
      return {
        prefabId: prefab.id,
        rootId: root.id,
        blueprints: store.blueprints.filter((item) => item.folderId === prefab.folderId).length,
      };
    })()`);
    assert.ok(setup.prefabId, 'the reusable prefab exists');
    assert.ok(setup.rootId, 'the scene contains a placed prefab root');
    assert.equal(setup.blueprints, 6, 'all six inspectable mechanism Blueprints exist');

    await app.realClick('.run-button');
    await app.waitFor(`window.__featherStore.runtimeInteractFocusId === ${JSON.stringify(setup.rootId)}`, {
      label: 'player focused the Vault Door',
    });
    const pressInteract = async () => {
      await app.page.call('Input.dispatchKeyEvent', {
        type: 'keyDown', code: 'KeyE', key: 'e', windowsVirtualKeyCode: 69, nativeVirtualKeyCode: 69,
      });
      await delay(45);
      await app.page.call('Input.dispatchKeyEvent', {
        type: 'keyUp', code: 'KeyE', key: 'e', windowsVirtualKeyCode: 69, nativeVirtualKeyCode: 69,
      });
    };

    await pressInteract();
    await app.waitFor(
      `Math.abs(window.__featherStore.activeScene().objects.find((object) => object.id === ${JSON.stringify(setup.rootId)}).transform.rotation[1]) > 0.25`,
      { label: 'Vault Door opened along its Timeline curve' },
    );
    const openAngle = await app.evaluate(
      `Math.abs(window.__featherStore.activeScene().objects.find((object) => object.id === ${JSON.stringify(setup.rootId)}).transform.rotation[1])`,
    );

    await pressInteract();
    await app.waitFor(
      `Math.abs(window.__featherStore.activeScene().objects.find((object) => object.id === ${JSON.stringify(setup.rootId)}).transform.rotation[1]) < ${openAngle - 0.05}`,
      { label: 'Vault Door reversed without snapping' },
    );
  } finally {
    await app.dispose();
  }
});

spec('the graph canvas has no large near-white slab on a dark theme', async () => {
  // Regression guard for the minimap rendering as a white rectangle over the canvas: xyflow's
  // MiniMap defaults to a light bgColor/maskColor, and those are SVG paint attributes that the
  // dark CSS on .react-flow__minimap could never reach.
  const app = await openEditor({ baseUrl: BASE_URL, query: '?demo=script&theme=nova' });
  try {
    await openScripting(app);
    await app.waitFor(`document.querySelector('.react-flow__minimap')`, { label: 'minimap present' });
    const canvas = await app.pixelStats('.flow-shell');
    assert.ok(
      canvas.brightRatio < 0.08,
      `graph canvas is ${(canvas.brightRatio * 100).toFixed(1)}% near-white — something light is covering it`,
    );
    const minimap = await app.pixelStats('.react-flow__minimap');
    assert.ok(
      minimap.meanLuminance < 120,
      `minimap mean luminance ${minimap.meanLuminance.toFixed(0)} is too light for a dark theme`,
    );
  } finally {
    await app.dispose();
  }
});

spec('Inspector controls do not collide at their docked width', async () => {
  // Regression guard for panels squeezed past their usable width — the Tree editor's labels sat on
  // top of its own sliders when it was tabbed into the ~330px Inspector column.
  const app = await openEditor({ baseUrl: BASE_URL, query: '?demo=script&theme=nova' });
  try {
    await app.waitFor(`document.querySelector('.inspector-panel .inspector-section')`, { label: 'inspector rendered' });
    const collisions = await app.overlaps('.inspector-panel', '.field-row, .inspector-section-head, .full-button');
    assert.deepEqual(collisions, [], `overlapping Inspector controls: ${collisions.join(' | ')}`);
  } finally {
    await app.dispose();
  }
});

spec('play and stop round-trips without leaving runtime state behind', async () => {
  const app = await openEditor({ baseUrl: BASE_URL, query: '?demo=script' });
  try {
    await app.waitFor(`document.querySelector('.run-button')`, { label: 'run button' });
    assert.equal(await app.count("[title^='Pause preview']"), 0, 'pause/step hidden while stopped');

    await app.realClick('.run-button');
    await app.waitFor(`document.querySelectorAll("[title^='Pause preview']").length === 1`, { label: 'Play started' });

    await app.realClick('.run-button');
    await app.waitFor(`document.querySelectorAll("[title^='Pause preview']").length === 0`, { label: 'Play stopped' });
    assert.equal(await app.count('.exec-broke'), 0, 'no stale breakpoint marker after Stop');
  } finally {
    await app.dispose();
  }
});

/** Boot the editor with a UI Kit installed from the store and its document open in the UI panel. */
async function openInstalledKit(kit) {
  const app = await openEditor({ baseUrl: BASE_URL, query: `?demo=uikit&kit=${kit}` });
  await app.waitFor(`document.querySelector('.ui-edit-layer [data-uiel-id]')`, { label: `${kit} rendered in the design canvas` });
  return app;
}

spec('an installed UI kit renders styled in the design canvas', async () => {
  // The reported bug: a kit installed from the Asset Store previewed as "all black, no colours".
  // Its look lives entirely in doc.css (every element ships an empty style object), and the design
  // canvas never injected that stylesheet — so it drew a few hundred transparent divs.
  const app = await openInstalledKit('pkg-feather-ui-arcade-hud');
  try {
    await app.waitFor(`document.querySelector('style[data-ui-css]')`, { label: 'document stylesheet injected' });

    // Every selector must have been rewritten to the document scope; an unscoped rule is the bug.
    const unscoped = await app.evaluate(`(() => {
      const sheet = document.querySelector('style[data-ui-css]');
      const rules = [...sheet.sheet.cssRules].filter((r) => r.type === CSSRule.STYLE_RULE);
      return rules.filter((r) => !r.selectorText.split(',').every((s) => s.trim().startsWith('[data-uidoc'))).length;
    })()`);
    assert.equal(unscoped, 0, 'every style rule must be scoped to the document');

    // And the rules must actually be landing on elements — not just present.
    const painted = await app.evaluate(`(() => {
      const nodes = [...document.querySelectorAll('.ui-edit-layer [data-uiel-id]')];
      const colours = new Set();
      for (const el of nodes) {
        const s = getComputedStyle(el);
        if (s.backgroundColor && s.backgroundColor !== 'rgba(0, 0, 0, 0)') colours.add(s.backgroundColor);
        if (s.backgroundImage && s.backgroundImage !== 'none') colours.add(s.backgroundImage.slice(0, 40));
      }
      return { nodes: nodes.length, colours: colours.size };
    })()`);
    assert.ok(painted.nodes > 20, `expected the kit's element tree, got ${painted.nodes} nodes`);
    assert.ok(painted.colours >= 5, `kit renders unstyled — only ${painted.colours} distinct backgrounds across ${painted.nodes} elements`);
  } finally {
    await app.dispose();
  }
});

spec('an installed UI kit cannot restyle the editor around it', async () => {
  // The other half of the bug: the kit's own `html, body { background: #101819 }` and its `:root`
  // custom properties used to be injected raw, repainting the whole editor and hijacking the
  // editor's design tokens (--accent, --text, --panel).
  const app = await openInstalledKit('pkg-feather-ui-arcade-hud');
  try {
    const leaked = await app.evaluate(`(() => {
      const body = getComputedStyle(document.body);
      const root = getComputedStyle(document.documentElement);
      return {
        bodyBackground: body.backgroundColor,
        bodyOverflow: body.overflow,
        accent: root.getPropertyValue('--accent').trim(),
        text: root.getPropertyValue('--text').trim(),
        // The kit's own frame SHOULD have picked those page-level rules up instead.
        frameBackground: getComputedStyle(document.querySelector('.ui-edit-layer')).backgroundColor,
        frameAccent: getComputedStyle(document.querySelector('.ui-edit-layer')).getPropertyValue('--accent').trim(),
      };
    })()`);

    assert.notEqual(leaked.bodyBackground, 'rgb(16, 24, 25)', 'the kit repainted the editor body');
    assert.notEqual(leaked.accent, '#6ff7ff', 'the kit overrode the editor --accent token');
    assert.notEqual(leaked.text, '#f5fff9', 'the kit overrode the editor --text token');
    // The rules did not vanish — they moved onto the widget frame, which is the point.
    assert.equal(leaked.frameAccent, '#6ff7ff', 'the kit tokens should apply inside the document');
    assert.equal(leaked.frameBackground, 'rgb(16, 24, 25)', 'page-level background should style the widget frame');

    // The toolbar must still be readable — a proxy for "the editor still looks like the editor".
    const toolbar = await app.pixelStats('.toolbar');
    assert.ok(toolbar.pixels > 0, 'toolbar still laid out');
  } finally {
    await app.dispose();
  }
});

spec('the RPG kit\'s id-based layout rules survive installation', async () => {
  // 54% of the RPG kit's rules use `#id` selectors, but capture rewrote ids into `id-<name>`
  // classes and elements never render a DOM id — so its entire layout backbone (`#hud > *
  // { position: absolute }`) was dead on arrival and every region stacked in normal flow.
  const app = await openInstalledKit('pkg-feather-ui-rpg-hud');
  try {
    const placed = await app.evaluate(`(() => {
      const hud = document.querySelector('.ui-edit-layer .id-hud');
      if (!hud) return null;
      const kids = [...hud.children];
      // #hud > * { position: absolute } — plus a few regions with their own stronger rule.
      return { kids: kids.length, positioned: kids.filter((k) => getComputedStyle(k).position !== 'static').length };
    })()`);
    assert.ok(placed, 'the #hud root should be reachable as .id-hud');
    assert.ok(placed.kids > 4, `expected the HUD regions, got ${placed.kids}`);
    assert.equal(placed.positioned, placed.kids, 'every HUD region should be positioned by the kit CSS, not stacked in flow');

    // The kit's bars are styled by its stylesheet; our unbound placeholder fill used to paint a
    // flat #5B8CFF rectangle over every one of them.
    const fills = await app.evaluate(`(() => {
      const el = document.querySelector('.ui-edit-layer .id-pHpFill');
      if (!el) return null;
      const s = getComputedStyle(el);
      return { background: s.backgroundColor, image: s.backgroundImage, placeholders: el.querySelectorAll('.ui-bar-fill').length };
    })()`);
    assert.ok(fills, "the kit's health-bar fill should be in the tree");
    assert.equal(fills.placeholders, 0, 'no placeholder fill should be painted over a stylesheet-driven bar');
    assert.ok(
      fills.image !== 'none' || fills.background !== 'rgb(91, 140, 255)',
      `health bar is still the default placeholder blue (${fills.background})`,
    );
  } finally {
    await app.dispose();
  }
});

spec('an installed UI kit ships reusable components, not one hardcoded tree', async () => {
  const app = await openInstalledKit('pkg-feather-ui-rpg-hud');
  try {
    const shape = await app.evaluate(`(() => {
      const s = window.__featherStore;
      const count = (el, k) => (el.kind === k ? 1 : 0) + el.children.reduce((n, c) => n + count(c, k), 0);
      const hud = s.uiDocuments.find((d) => !d.isComponent);
      return {
        components: s.uiDocuments.filter((d) => d.isComponent).length,
        instances: count(hud.root, 'component'),
        parameterised: (() => {
          let n = 0;
          const walk = (el) => { if (el.componentParams) n += 1; el.children.forEach(walk); };
          walk(hud.root);
          return n;
        })(),
      };
    })()`);
    assert.ok(shape.components >= 3, `expected repeated widgets to be components, got ${shape.components}`);
    assert.ok(shape.instances >= 20, `expected many instances, got ${shape.instances}`);
    assert.equal(shape.instances, shape.parameterised, 'every instance should carry its own data as params');

    // Params are what stop one component flattening ten slots into ten copies of the first.
    const labels = await app.evaluate(`(() => {
      const els = [...document.querySelectorAll('.ui-edit-layer .buildTile')];
      return [...new Set(els.map((e) => e.textContent.trim()))].filter(Boolean).slice(0, 8);
    })()`);
    assert.ok(labels.length > 3, `component instances all render the same label: ${JSON.stringify(labels)}`);

    const broken = await app.evaluate(`document.body.innerText.includes('Missing component')`);
    assert.equal(broken, false, 'no instance should render as a missing-component placeholder');
  } finally {
    await app.dispose();
  }
});

spec('editing a component updates every instance at once', async () => {
  const app = await openInstalledKit('pkg-feather-ui-rpg-hud');
  try {
    // The payoff of instancing by reference: one edit, N places, no propagation step.
    const result = await app.evaluate(`(() => {
      const s = window.__featherStore;
      const component = s.uiDocuments.find((d) => d.isComponent);
      s.setUIElementCss(component.id, component.root.id, 'outline: 2px solid rgb(7, 231, 99);');
      return component.id;
    })()`);
    assert.ok(result, 'a component to edit');
    // Every instance renders that component's root in place, so the edit lands on all of them at
    // once — there is no propagation step to wait for beyond the re-render.
    await app.waitFor(
      `[...document.querySelectorAll('.ui-edit-layer [data-uidoc="${result}"]')].filter((e) => getComputedStyle(e).outlineColor === 'rgb(7, 231, 99)').length > 3`,
      { label: 'one component edit reached every instance' },
    );
  } finally {
    await app.dispose();
  }
});

spec('the hand-authored kit assembles three screens from three components', async () => {
  const app = await openInstalledKit('pkg-feather-ui-party-royale');
  try {
    const kit = await app.evaluate(`(() => {
      const s = window.__featherStore;
      const count = (el, k) => (el.kind === k ? 1 : 0) + el.children.reduce((n, c) => n + count(c, k), 0);
      const screens = s.uiDocuments.filter((d) => !d.isComponent);
      return {
        screens: screens.length,
        components: s.uiDocuments.filter((d) => d.isComponent).length,
        instances: screens.reduce((n, d) => n + count(d.root, 'component'), 0),
        // The kit ships the variables its HUD is already bound to.
        vars: s.variables.map((v) => v.name).sort(),
      };
    })()`);
    assert.equal(kit.screens, 3, 'menu + HUD + results');
    assert.equal(kit.components, 3, 'jelly button + stat pill + qualifier row');
    assert.ok(kit.instances >= 10, `expected the screens to be built from instances, got ${kit.instances}`);
    assert.deepEqual(kit.vars, ['Crowns', 'Kudos', 'PlayersLeft', 'Qualified', 'RoundName', 'TimeLeft']);

    // One component, many looks: each instance differs only by params and a tone class.
    const rows = await app.evaluate(`(() => {
      const s = window.__featherStore;
      s.setActiveUIDocument(s.uiDocuments.find((d) => d.name.includes('Results')).id);
      return true;
    })()`);
    assert.ok(rows);
    await app.waitFor(`document.querySelectorAll('.ui-edit-layer .pr-slot').length === 4`, { label: 'four qualifier rows' });
    const distinct = await app.evaluate(`(() => {
      const els = [...document.querySelectorAll('.ui-edit-layer .pr-slot')];
      return {
        names: [...new Set(els.map((e) => e.querySelector('.pr-slot-name').textContent.trim()))].length,
        toned: els.filter((e) => e.className.includes('is-you') || e.className.includes('is-out')).length,
      };
    })()`);
    assert.equal(distinct.names, 4, 'each instance renders its own name from params');
    assert.equal(distinct.toned, 2, 'instance classes reach the component root');
  } finally {
    await app.dispose();
  }
});

spec('each instance of a shared button fires its own event', async () => {
  // A reusable button cannot hard-code what clicking it does, so the instance supplies the event.
  const app = await openInstalledKit('pkg-feather-ui-party-royale');
  try {
    await app.evaluate(`(async () => {
      const { useEditorStore } = await import('/src/store/editorStore.ts');
      window.__events = [];
      useEditorStore.setState({ fireCustomEvent: (name) => window.__events.push(name) });
      useEditorStore.getState().setPlaying(true);
    })()`);
    await app.waitFor(`document.querySelectorAll('.pr-btn').length === 3`, { label: 'menu buttons live in Play' });
    for (const label of ['PLAY', 'PARTY', 'SHOP']) {
      await app.evaluate(`[...document.querySelectorAll('.pr-btn')].find((b) => b.textContent.trim() === '${label}').click()`);
    }
    const events = await app.evaluate(`JSON.stringify(window.__events)`);
    assert.deepEqual(JSON.parse(events), ['startMatch', 'openParty', 'openShop']);
  } finally {
    await app.dispose();
  }
});

spec('per-element CSS applies in the design canvas and in Play', async () => {
  // Reuse the kit demo purely because it leaves the UI panel docked and open.
  const app = await openInstalledKit('pkg-feather-ui-arcade-hud');
  try {
    // Build a screen HUD with one element styled purely through element CSS.
    const ids = await app.evaluate(`(() => {
      const store = window.__featherStore;
      const docId = store.createUIDocument('CSS Test', 'screen');
      store.updateUIDocument(docId, { visibleOnStart: true });
      const elId = store.addUIElement(docId, undefined, 'text');
      store.updateUIElement(docId, elId, { text: 'styled' });
      store.setUIElementCss(docId, elId, 'background: rgb(9, 200, 77); padding: 11px;');
      store.setActiveUIDocument(docId);
      return { docId, elId };
    })()`);
    await app.waitFor(`document.querySelector('.ui-edit-layer [data-uiel-id="${ids.elId}"]')`, { label: 'test element in the canvas' });

    const previewBg = await app.evaluate(
      `getComputedStyle(document.querySelector('.ui-edit-layer [data-uiel-id="${ids.elId}"]')).backgroundColor`,
    );
    assert.equal(previewBg, 'rgb(9, 200, 77)', 'element CSS should apply in the design canvas');

    await app.realClick('.run-button');
    await app.waitFor(`document.querySelector('[data-uidoc="${ids.docId}"] [data-uiel-id="${ids.elId}"]')`, {
      label: 'HUD element rendered in Play',
    });
    const playStyle = await app.evaluate(`(() => {
      const el = document.querySelector('[data-uidoc="${ids.docId}"] [data-uiel-id="${ids.elId}"]');
      const s = getComputedStyle(el);
      return { background: s.backgroundColor, padding: s.paddingTop };
    })()`);
    assert.equal(playStyle.background, 'rgb(9, 200, 77)', 'element CSS should apply in Play');
    assert.equal(playStyle.padding, '11px', 'element CSS declarations should all apply in Play');
  } finally {
    await app.dispose();
  }
});

spec('model forge installs from the store, builds, paints, places and bakes a prop', async () => {
  const app = await openEditor({ baseUrl: BASE_URL, query: '?demo=store' });
  try {
    // Start from OFF so this covers the real install path (a previous run persisted the install).
    await app.evaluate(`localStorage.removeItem('nodeforge.plugins')`);
    await app.evaluate(`location.reload()`);
    await app.waitFor(`document.querySelector('.toolbar')`, { label: 'editor reloaded' });

    // Install the Model Forge plugin from its Asset Store card.
    await clickViewMenuEntry(app, 'Store');
    await app.waitFor(`document.querySelector('.store-card')`, { label: 'catalog loaded' });
    await app.evaluate(`(() => {
      const card = [...document.querySelectorAll('.store-card')].find((c) => c.textContent.includes('Model Forge'));
      card?.querySelector('.store-install-button')?.click();
    })()`);
    await app.waitFor(
      `(JSON.parse(localStorage.getItem('nodeforge.plugins') ?? '{}').state?.enabledIds ?? []).includes('feather.model-forge')`,
      { label: 'plugin persisted' },
    );

    // The activated plugin's studio is reachable from the View menu like any extension panel.
    await clickViewMenuEntry(app, 'Model Forge');
    await app.waitFor(`document.querySelector('.model-toolbar')`, { label: 'model forge open' });
    await app.waitFor(`document.querySelector('.model-forge-canvas canvas')`, { label: 'live preview canvas' });
    await app.waitFor(`document.querySelectorAll('.model-swatch').length >= 10`, { label: 'palette rendered' });

    // --- Real-pointer gizmo coverage: the bugs here only ever reproduced with a live mouse. ---
    // A genuine click on the crate in the 3D preview selects that part.
    // The preview canvas resizes a beat after the panel mounts — interact only once it is real.
    await app.waitFor(
      `(() => { const c = document.querySelector('.model-forge-canvas canvas'); return !!c && c.getBoundingClientRect().width > 350; })()`,
      { label: 'preview canvas sized' },
    );
    await app.realClick('.model-forge-canvas canvas');
    await app.realClick('.model-forge-canvas canvas');
    await app.waitFor(`document.querySelector('.model-part-actions')`, { label: 'canvas click selects a part' });

    const canvasBox = await app.evaluate(`(() => {
      const r = document.querySelector('.model-forge-canvas canvas').getBoundingClientRect();
      return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    })()`);
    const POSITIONS = `JSON.stringify((window.__featherStore.modelSpecs.find((s) => s.id === 'model-starter-crate') ?? {parts:[]}).parts.map((p) => p.position))`;
    const positionsBefore = await app.evaluate(POSITIONS);

    // Find the translate gizmo's red X arrow BY PIXEL (the capture is CSS-pixel 1:1, same as
    // pixelStats) and drag straight along it: the grab must survive the whole drag (regression:
    // per-tick commits detached the controls and killed it after one tick), commit a new transform
    // on release, and keep the part selected (regression: a handle grab read as a "missed" click
    // and deselected, unmounting the gizmo mid-use).
    const shot = await app.page.call('Page.captureScreenshot', { format: 'png' });
    const arrow = await app.evaluate(`(async () => {
      const img = new Image();
      img.src = 'data:image/png;base64,${shot.data}';
      await img.decode();
      const r = ${JSON.stringify({ x: canvasBox.x, y: canvasBox.y, w: canvasBox.w, h: canvasBox.h })};
      const c = document.createElement('canvas');
      c.width = r.w; c.height = r.h;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      const data = ctx.getImageData(0, 0, r.w, r.h).data;
      const pts = [];
      for (let y = 0; y < r.h; y += 2) {
        for (let x = 0; x < r.w; x += 2) {
          const i = (y * r.w + x) * 4;
          const R = data[i], G = data[i + 1], B = data[i + 2];
          // Red-dominant = the X axis; nothing else in the preview palette qualifies.
          if (R > 140 && R - G > 70 && R - B > 60) pts.push([x, y]);
        }
      }
      if (pts.length < 8) return null;
      let sx = 0, sy = 0;
      for (const [x, y] of pts) { sx += x; sy += y; }
      const cx = sx / pts.length, cy = sy / pts.length;
      // The farthest red pixel from the centroid fixes the arrow's screen direction.
      let best = pts[0], bd = -1;
      for (const p of pts) { const d = (p[0] - cx) ** 2 + (p[1] - cy) ** 2; if (d > bd) { bd = d; best = p; } }
      const len = Math.hypot(best[0] - cx, best[1] - cy) || 1;
      return { x: r.x + cx, y: r.y + cy, dx: (best[0] - cx) / len, dy: (best[1] - cy) / len };
    })()`);
    assert.ok(arrow, 'the translate gizmo X arrow should be visible in the preview');
    await dragOn(app, { x: arrow.x, y: arrow.y }, { x: arrow.x + arrow.dx * 60, y: arrow.y + arrow.dy * 60 });
    assert.notEqual(await app.evaluate(POSITIONS), positionsBefore, 'dragging the gizmo arrow should commit a new part transform');
    assert.ok(await app.evaluate(`!!document.querySelector('.model-part-actions')`), 'part stays selected through a gizmo drag');

    // Orbiting the camera must not clear the selection (regression: every orbit ended in a
    // "missed" click that deselected) — while a STATIONARY background click still deselects.
    const corner = {
      x: canvasBox.cx - Math.min(200, canvasBox.w * 0.4),
      y: canvasBox.cy - Math.min(130, canvasBox.h * 0.35),
    };
    await dragOn(app, corner, { x: corner.x + 90, y: corner.y + 55 });
    assert.ok(await app.evaluate(`!!document.querySelector('.model-part-actions')`), 'orbiting kept the part selected');
    await dragOn(app, corner, corner);
    await app.waitFor(`!document.querySelector('.model-part-actions')`, { label: 'stationary background click deselects' });

    // A starter kit lands in the library and becomes the active model.
    await app.evaluate(`(() => {
      const buttons = [...document.querySelectorAll('.model-starter-grid button')];
      buttons.find((b) => b.textContent.trim() === 'Fence Segment')?.click();
    })()`);
    await app.waitFor(`window.__featherStore.modelSpecs.some((s) => s.name === 'Fence Segment')`, {
      label: 'fence starter in library',
    });

    // Place in Scene drops an object LINKED to the asset (model.specId), not a copy.
    const before = await app.evaluate(
      `(() => { const s = window.__featherStore; return s.scenes.find((x) => x.id === s.activeSceneId).objects.length; })()`,
    );
    await app.evaluate(`(() => {
      const buttons = [...document.querySelectorAll('button')];
      buttons.find((b) => b.textContent.trim() === 'Place in Scene')?.click();
    })()`);
    await app.waitFor(
      `(() => {
        const s = window.__featherStore;
        const scene = s.scenes.find((x) => x.id === s.activeSceneId);
        const placed = scene.objects[scene.objects.length - 1];
        const spec = s.modelSpecs.find((x) => x.name === 'Fence Segment');
        return scene.objects.length === ${before} + 1 && placed.model?.enabled === true && placed.model?.specId === spec.id;
      })()`,
      { label: 'placed prop linked to the asset' },
    );

    // Face painting writes into the shared asset — the live-restyle link the whole feature rests on.
    await app.evaluate(`(() => {
      const s = window.__featherStore;
      const spec = s.modelSpecs.find((x) => x.name === 'Fence Segment');
      s.paintModelPart(spec.id, spec.parts[0].id, 5, 2);
    })()`);
    await app.waitFor(
      `(() => {
        const spec = window.__featherStore.modelSpecs.find((x) => x.name === 'Fence Segment');
        return spec.parts[0].faceColors && spec.parts[0].faceColors[2] === 5;
      })()`,
      { label: 'face paint landed on the asset' },
    );

    // Bake runs GLTFExporter in the real browser and lands a first-class .glb asset in the project.
    const assetsBefore = await app.evaluate(`window.__featherStore.assets.length`);
    await app.evaluate(`(() => {
      const buttons = [...document.querySelectorAll('button')];
      buttons.find((b) => b.textContent.includes('Bake to GLB'))?.click();
    })()`);
    await app.waitFor(
      `(() => {
        const assets = window.__featherStore.assets;
        return assets.length === ${assetsBefore} + 1 && assets[assets.length - 1].name.endsWith('.glb');
      })()`,
      { label: 'baked GLB asset in the project', timeout: 20000 },
    );
  } finally {
    await app.dispose();
  }
});

spec('collaboration dialog exposes safe host setup and validates join invites without a tunnel', async () => {
  const app = await openEditor({ baseUrl: BASE_URL, query: '?demo=timeline', width: 1280, height: 800 });
  try {
    await app.realClick('[data-testid="collaboration-toolbar-button"]');
    await app.waitFor(`document.querySelector('[data-testid="collaboration-dialog"]')`, {
      label: 'collaboration dialog open',
    });
    await app.waitFor(`document.activeElement?.dataset?.testid === 'collaboration-display-name'`, {
      label: 'collaboration dialog autofocus',
    });

    const initial = await app.evaluate(`(() => {
      const dialog = document.querySelector('[data-testid="collaboration-dialog"]');
      const token = document.querySelector('[data-testid="collaboration-authtoken"]');
      const submit = document.querySelector('[data-testid="collaboration-start-submit"]');
      const rect = dialog.getBoundingClientRect();
      return {
        role: dialog.getAttribute('role'),
        modal: dialog.getAttribute('aria-modal'),
        tokenType: token.type,
        tokenAutocomplete: token.autocomplete,
        startDisabled: submit.disabled,
        focused: document.activeElement?.dataset?.testid,
        fitsViewport: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight,
        mentionsMemoryOnly: dialog.textContent.includes('Memory only'),
        mentionsHostPlay: dialog.textContent.includes('Host controls Play'),
      };
    })()`);
    assert.deepEqual(initial, {
      role: 'dialog',
      modal: 'true',
      tokenType: 'password',
      tokenAutocomplete: 'off',
      startDisabled: true,
      focused: 'collaboration-display-name',
      fitsViewport: true,
      mentionsMemoryOnly: true,
      mentionsHostPlay: true,
    });

    await app.realClick('[data-testid="collaboration-tab-join"]');
    assert.equal(
      await app.evaluate(`document.querySelector('[data-testid="collaboration-join-submit"]').disabled`),
      true,
      'join remains blocked until name and invite are present',
    );

    await app.evaluate(`(() => {
      const setValue = (selector, value) => {
        const input = document.querySelector(selector);
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      setValue('[data-testid="collaboration-join-display-name"]', 'Morgan');
      setValue(
        '[data-testid="collaboration-join-invite"]',
        'https://sample.ngrok.app/#feather-session=session_0123456789&feather-secret=secret_0123456789abcdefghijklmnopqrstuvwxyz',
      );
    })()`);
    await app.waitFor(`!document.querySelector('[data-testid="collaboration-join-submit"]').disabled`, {
      label: 'valid join form enabled',
    });

    await app.page.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    await app.page.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
    await app.waitFor(`!document.querySelector('[data-testid="collaboration-dialog"]')`, {
      label: 'Escape closes collaboration dialog',
    });
    assert.equal(
      await app.evaluate(`document.activeElement?.dataset?.testid`),
      'collaboration-toolbar-button',
      'closing restores focus to the toolbar launcher',
    );

    // Exercise the guest toolbar policy through the local Zustand state only. No network or ngrok
    // process is involved, so this remains deterministic in CI and cannot create an external tunnel.
    await app.evaluate(`(async () => {
      const { useCollaborationStore } = await import('/src/store/collaborationStore.ts');
      useCollaborationStore.setState({
        status: 'connected',
        role: 'editor',
        sessionName: 'Mock review',
        participants: [],
      });
    })()`);
    await app.waitFor(
      `document.querySelector('[data-testid="toolbar-play-button"]').disabled
        && document.querySelector('[data-testid="toolbar-save-button"]').disabled`,
      { label: 'guest Play and Save controls disabled' },
    );
    const guestControls = await app.evaluate(`(() => ({
      playTitle: document.querySelector('[data-testid="toolbar-play-button"]').title,
      saveTitle: document.querySelector('[data-testid="toolbar-save-button"]').title,
      toolbarState: document.querySelector('[data-testid="collaboration-toolbar-button"]').dataset.collaborationStatus,
    }))()`);
    assert.ok(guestControls.playTitle.includes('Only the collaboration host'));
    assert.ok(guestControls.saveTitle.includes('Only the collaboration host'));
    assert.equal(guestControls.toolbarState, 'connected');

    await app.evaluate(`(async () => {
      const { useCollaborationStore } = await import('/src/store/collaborationStore.ts');
      useCollaborationStore.setState({ status: 'idle', role: null, sessionName: '', participants: [] });
    })()`);
  } finally {
    await app.dispose();
  }
});

spec('collaboration awareness follows the same scene object and Blueprint node', async () => {
  const app = await openEditor({ baseUrl: BASE_URL, query: '?demo=timeline', width: 1440, height: 900 });
  try {
    const objectId = await evaluateAfterReload(app, `(async () => {
      const { useCollaborationStore } = await import('/src/store/collaborationStore.ts');
      const editor = window.__featherStore;
      const scene = editor.scenes.find((candidate) => candidate.id === editor.activeSceneId);
      const object = scene.objects.find((candidate) => !candidate.viewModel && !candidate.effect && !candidate.projectile);
      useCollaborationStore.setState({
        status: 'connected',
        role: 'editor',
        sessionName: 'Mock awareness',
        participants: [{
          id: 'remote-alex',
          name: 'Alex',
          role: 'editor',
          color: '#f05da8',
          presence: {
            activeSceneId: editor.activeSceneId,
            selectedObjectId: object.id,
            editing: { kind: 'transform', targetId: object.id, mode: 'translate' },
          },
          isSelf: false,
        }],
      });
      return object.id;
    })()`);

    await app.waitFor(
      `document.querySelector(${JSON.stringify(`[data-testid="viewport-collaborator-${objectId}"]`)})`,
      { label: 'remote collaborator badge follows the viewport object' },
    );
    await app.waitFor(
      `document.querySelector('.hierarchy-row.has-collaborator [data-testid="collaborator-avatars"]')`,
      { label: 'remote collaborator badge appears in the hierarchy' },
    );

    await openScripting(app);
    const graphTarget = await evaluateAfterReload(app, `(async () => {
      const { useCollaborationStore } = await import('/src/store/collaborationStore.ts');
      const editor = window.__featherStore;
      const graph = editor.activeGraph();
      const node = graph.nodes[0];
      useCollaborationStore.setState({
        participants: [{
          id: 'remote-alex',
          name: 'Alex',
          role: 'editor',
          color: '#f05da8',
          presence: {
            activeBlueprintId: editor.activeBlueprintId,
            selectedGraphNodeId: node.id,
            surface: 'graph',
          },
          isSelf: false,
        }],
      });
      return { blueprintId: editor.activeBlueprintId, nodeId: node.id };
    })()`);
    assert.ok(graphTarget.blueprintId && graphTarget.nodeId, 'fixture exposes an active Blueprint node');
    await app.waitFor(
      `document.querySelector('.nodeforge-node.has-collaborator .nfn-collaborators [data-testid="collaborator-avatars"]')`,
      { label: 'remote collaborator badge appears on the same graph node' },
    );
    await app.waitFor(
      `document.querySelector('.graph-actions > [data-testid="collaborator-avatars"]')`,
      { label: 'same-file collaborator appears in the Blueprint header' },
    );

    await evaluateAfterReload(app, `(async () => {
      const { useCollaborationStore } = await import('/src/store/collaborationStore.ts');
      useCollaborationStore.setState({ status: 'idle', role: null, sessionName: '', participants: [] });
    })()`);
  } finally {
    await app.dispose();
  }
});

async function serverUp() {
  try {
    const response = await fetch(BASE_URL, { signal: AbortSignal.timeout(2000) });
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

async function main() {
  const requested = process.env.E2E_GREP?.trim().toLowerCase();
  const selectedSpecs = requested ? specs.filter(({ name }) => name.toLowerCase().includes(requested)) : specs;
  if (!selectedSpecs.length) throw new Error(`No e2e spec matched E2E_GREP=${JSON.stringify(process.env.E2E_GREP)}`);
  let devServer;
  if (!(await serverUp())) {
    process.stdout.write(`Starting dev server for e2e…\n`);
    devServer = spawn('npm', ['run', 'dev'], { stdio: 'ignore', detached: false });
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline && !(await serverUp())) await delay(1000);
    if (!(await serverUp())) {
      devServer.kill();
      throw new Error(`Dev server never came up at ${BASE_URL}`);
    }
  }

  let failed = 0;
  try {
    for (const { name, fn } of selectedSpecs) {
      const started = Date.now();
      try {
        await fn();
        process.stdout.write(`  ✓ ${name} (${Date.now() - started}ms)\n`);
      } catch (error) {
        failed += 1;
        process.stdout.write(`  ✕ ${name}\n    ${error.message}\n`);
      }
    }
  } finally {
    if (devServer) devServer.kill();
  }

  process.stdout.write(`\n${selectedSpecs.length - failed}/${selectedSpecs.length} e2e specs passed\n`);
  process.exit(failed ? 1 : 0);
}

await main();
