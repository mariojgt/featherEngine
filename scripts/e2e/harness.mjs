/**
 * Editor end-to-end harness: page helpers on top of the CDP driver.
 *
 * The important one is realClick(). It resolves an element's centre and dispatches genuine
 * mousePressed/mouseReleased input, which is what ReactFlow (and anything else using native pointer
 * listeners rather than React synthetic events) actually responds to.
 */
import assert from 'node:assert/strict';
import { delay, launch } from './cdp.mjs';

export async function openEditor({ baseUrl, query = '', timeoutMs = 60_000, readySelector = '.toolbar', width = 1600, height = 1000 } = {}) {
  const { page, dispose } = await launch({ width, height });
  const url = `${baseUrl}/${query}`;

  const evaluate = async (expression) => {
    const result = await page.call('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(`Page threw: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
    }
    return result.result?.value;
  };

  /** Poll a boolean expression until true. Far more reliable than fixed sleeps for an app that
   *  boots WebGL, WASM physics and a project before the editor is usable. */
  const waitFor = async (expression, { label = expression, timeout = timeoutMs } = {}) => {
    const deadline = Date.now() + timeout;
    let last;
    while (Date.now() < deadline) {
      try {
        last = await evaluate(`Boolean(${expression})`);
        if (last) return true;
      } catch (error) {
        if (error.message.includes('Chrome DevTools connection closed')) throw error;
        last = error.message;
      }
      await delay(250);
    }
    throw new Error(`Timed out waiting for: ${label}${last ? ` (last: ${last})` : ''}`);
  };

  const count = (selector) => evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
  const text = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);

  /**
   * Centre coordinates of the first CLICKABLE match, in viewport pixels.
   *
   * `within` matters for the graph: ReactFlow renders every node in a transformed viewport, so
   * plenty of `.nodeforge-node` elements exist in the DOM while sitting outside the visible canvas
   * (their rects land over the palette, or off-screen entirely). Clicking querySelector's first
   * match therefore aims at whatever happens to be under those coordinates. Constraining to the
   * container's rect picks a node you can actually see.
   */
  const boxOf = (selector, { within } = {}) =>
    evaluate(`(() => {
      const bounds = ${within ? `document.querySelector(${JSON.stringify(within)})?.getBoundingClientRect()` : 'null'};
      if (${within ? 'true' : 'false'} && !bounds) return null;
      for (const el of document.querySelectorAll(${JSON.stringify(selector)})) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) continue;
        if (bounds && (cx < bounds.left || cx > bounds.right || cy < bounds.top || cy > bounds.bottom)) continue;
        // Only aim where this element (or a descendant of it) is genuinely on top.
        const hit = document.elementFromPoint(cx, cy);
        if (hit && !el.contains(hit) && hit !== el) continue;
        return { x: cx, y: cy };
      }
      return null;
    })()`);

  /** A real mouse click at the element's centre — synthetic DOM clicks do not drive ReactFlow. */
  const realClick = async (selector, options) => {
    let box, previous, stable = 0;
    const deadline = Date.now() + 4000;
    do {
      box = await boxOf(selector, options);
      if (box && previous && Math.abs(box.x - previous.x) < 0.5 && Math.abs(box.y - previous.y) < 0.5) stable++;
      else stable = 0;
      if (stable >= 3) break;
      previous = box;
      await delay(100);
    } while (Date.now() < deadline);
    assert.ok(box, `Cannot click, no visible/unobstructed element for: ${selector}`);
    const base = { x: box.x, y: box.y, button: 'left', clickCount: 1, buttons: 1 };
    await page.call('Input.dispatchMouseEvent', { ...base, type: 'mouseMoved', buttons: 0 });
    await page.call('Input.dispatchMouseEvent', { ...base, type: 'mousePressed' });
    await delay(30);
    await page.call('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased', buttons: 0 });
    await delay(120);
  };

  /**
   * Pixel statistics for a region, without any image-decoding dependency: capture via CDP, hand the
   * base64 PNG back to the page, draw it into a canvas and read it with getImageData.
   *
   * Catches the class of bug that only ever showed up by eye — e.g. the graph minimap rendering as a
   * large WHITE slab over a dark canvas, because xyflow's default bgColor/maskColor are light and
   * are SVG paint attributes that CSS cannot reach.
   */
  const pixelStats = async (selector, { brightness = 200 } = {}) => {
    const rect = await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    })()`);
    assert.ok(rect && rect.w > 0 && rect.h > 0, `No laid-out element to sample: ${selector}`);
    const shot = await page.call('Page.captureScreenshot', { format: 'png' });
    return evaluate(`(async () => {
      const img = new Image();
      img.src = 'data:image/png;base64,${shot.data}';
      await img.decode();
      const r = ${JSON.stringify(rect)};
      const c = document.createElement('canvas');
      c.width = r.w; c.height = r.h;
      const ctx = c.getContext('2d');
      // The capture is in CSS pixels at dpr 1 for our headless window, so rect maps 1:1.
      ctx.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      const data = ctx.getImageData(0, 0, r.w, r.h).data;
      let bright = 0, sum = 0;
      const total = data.length / 4;
      for (let i = 0; i < data.length; i += 4) {
        const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        sum += lum;
        if (lum >= ${brightness}) bright += 1;
      }
      return { meanLuminance: sum / total, brightRatio: bright / total, pixels: total };
    })()`);
  };

  /**
   * Elements inside `root` whose rects overlap despite being siblings in the layout flow — the
   * signature of a panel squeezed past its usable width. This is what the Tree panel did when it was
   * tabbed into the 330px Inspector column: its labels sat on top of its own sliders.
   */
  const overlaps = (root, selector) =>
    evaluate(`(() => {
      const scope = document.querySelector(${JSON.stringify(root)});
      if (!scope) return [];
      const items = [...scope.querySelectorAll(${JSON.stringify(selector)})]
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter((i) => i.r.width > 0 && i.r.height > 0);
      const hits = [];
      for (let a = 0; a < items.length; a += 1) {
        for (let b = a + 1; b < items.length; b += 1) {
          const A = items[a], B = items[b];
          if (A.el.contains(B.el) || B.el.contains(A.el)) continue;
          const ox = Math.min(A.r.right, B.r.right) - Math.max(A.r.left, B.r.left);
          const oy = Math.min(A.r.bottom, B.r.bottom) - Math.max(A.r.top, B.r.top);
          // A couple of px of overlap is normal (borders, negative margins); real collisions are big.
          if (ox > 6 && oy > 6) {
            hits.push((A.el.textContent || A.el.className).trim().slice(0, 28) + ' ↔ ' +
                      (B.el.textContent || B.el.className).trim().slice(0, 28));
          }
        }
      }
      return hits.slice(0, 8);
    })()`);

  const consoleErrors = [];
  await page.call('Log.enable').catch(() => {});

  await page.call('Page.navigate', { url });
  // The editor is ready once the toolbar exists; individual specs wait for what they need.
  await waitFor(`document.querySelector(${JSON.stringify(readySelector)})`, { label: readySelector });

  return { page, evaluate, waitFor, count, text, boxOf, realClick, pixelStats, overlaps, consoleErrors, dispose, url };
}
