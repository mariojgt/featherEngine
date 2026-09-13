#!/usr/bin/env node
/**
 * Real-browser smoke test for an assembled Feather production player.
 *
 * This intentionally uses Chrome's built-in DevTools protocol instead of Playwright/Puppeteer:
 * GitHub's hosted runners already contain Chrome, and `ws` is already a development dependency.
 * That keeps the production gate small while still exercising the emitted JavaScript, React player,
 * WebGL, embedded resources, Rapier, Blueprint runtime, and DOM HUD in a real browser process.
 *
 * Usage:
 *   node scripts/player-browser-smoke.mjs --dir /path/to/game-web [--legacy-dir /path/to/legacy-web]
 *
 * Set CHROME_PATH when Chrome is installed outside one of the common locations below.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFile,
  readFileSync,
  rmSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import WebSocket from 'ws';

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const primaryDirArg = option('--dir');
if (!primaryDirArg) {
  console.error('Usage: node scripts/player-browser-smoke.mjs --dir <game-web> [--legacy-dir <game-web>]');
  process.exit(2);
}

const primaryDir = resolve(primaryDirArg);
const legacyDir = option('--legacy-dir') ? resolve(option('--legacy-dir')) : undefined;
assert.ok(existsSync(resolve(primaryDir, 'index.html')), `Missing production player: ${primaryDir}`);
if (legacyDir) assert.ok(existsSync(resolve(legacyDir, 'index.html')), `Missing legacy production player: ${legacyDir}`);

const delay = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds));

function chromeExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.GOOGLE_CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    process.env.PROGRAMFILES && `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
    process.env['PROGRAMFILES(X86)'] && `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
    process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate));
}

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
};

function createStaticServer() {
  return createServer((request, response) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
    } catch {
      response.writeHead(400).end('Bad request');
      return;
    }

    const isLegacy = Boolean(legacyDir && (pathname === '/legacy' || pathname.startsWith('/legacy/')));
    const base = isLegacy ? legacyDir : primaryDir;
    let relativePath = isLegacy ? pathname.slice('/legacy'.length) : pathname;
    if (relativePath === '' || relativePath.endsWith('/')) relativePath += 'index.html';
    relativePath = relativePath.replace(/^\/+/, '');

    const file = resolve(base, relativePath);
    if (file !== base && !file.startsWith(`${base}${sep}`)) {
      response.writeHead(403).end('Forbidden');
      return;
    }

    readFile(file, (error, bytes) => {
      if (error) {
        response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.code ?? 'Read error');
        return;
      }
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': contentTypes[extname(file)] ?? 'application/octet-stream',
      });
      response.end(bytes);
    });
  });
}

async function listen(server) {
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object', 'Static server did not acquire a port');
  return address.port;
}

async function closeServer(server) {
  await new Promise((done) => server.close(() => done()));
}

class CdpSession {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    this.closed = false;
    socket.on('message', (raw) => this.onMessage(raw));
    socket.on('close', () => {
      this.closed = true;
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(new Error('Chrome DevTools connection closed'));
      }
      this.pending.clear();
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolveOpen, reject) => {
      socket.once('open', resolveOpen);
      socket.once('error', reject);
    });
    return new CdpSession(socket);
  }

  onEvent(listener) {
    this.listeners.add(listener);
  }

  onMessage(raw) {
    const message = JSON.parse(raw.toString());
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(`${message.error.message} (${message.error.code})`));
      else pending.resolve(message.result);
      return;
    }
    if (message.method) {
      for (const listener of this.listeners) listener(message.method, message.params ?? {});
    }
  }

  call(method, params = {}) {
    if (this.closed || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Chrome DevTools connection closed'));
    }
    const id = this.nextId++;
    return new Promise((resolveCall, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Chrome DevTools command timed out: ${method}`));
      }, 15_000);
      this.pending.set(id, { resolve: resolveCall, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

async function waitForDevTools(profileDir, chrome, output) {
  const activePortFile = resolve(profileDir, 'DevToolsActivePort');
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (chrome.exitCode !== null) {
      throw new Error(`Chrome exited before DevTools started (code ${chrome.exitCode}).\n${output()}`);
    }
    if (existsSync(activePortFile)) {
      const port = Number(readFileSync(activePortFile, 'utf8').split(/\r?\n/, 1)[0]);
      if (Number.isInteger(port) && port > 0) return port;
    }
    await delay(50);
  }
  throw new Error(`Timed out waiting for Chrome DevTools.\n${output()}`);
}

async function findPageTarget(debugPort) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      // Chrome may have opened its debug port but not registered the first page yet.
    }
    await delay(50);
  }
  throw new Error('Timed out waiting for a Chrome page target');
}

async function evaluate(cdp, expression) {
  const result = await cdp.call('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'Browser evaluation failed');
  }
  return result.result?.value;
}

/**
 * Runtime probes need simulated time, not just wall-clock: under SwiftShader with the water/cloth/
 * cable parity probes mounted, the player renders around one frame per second, so the fixed-timestep
 * sim advances at roughly 1% of realtime. The half-unit fall this asserts takes ~0.32s of sim time,
 * which measured ~27s of wall-clock on a developer machine and is slower again on a shared CI runner
 * — the default 20s made this leg flake. The generous ceiling only changes how long a genuinely
 * broken build takes to report; it cannot turn a failure into a pass.
 */
const RUNTIME_WAIT_TIMEOUT_MS = 120_000;

async function waitFor(cdp, label, expression, predicate = Boolean, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  let lastValue;
  let lastError;
  while (Date.now() < deadline) {
    try {
      lastValue = await evaluate(cdp, expression);
      if (predicate(lastValue)) return lastValue;
    } catch (error) {
      // A navigation briefly destroys the old execution context. Retry against the new document.
      if (error.message.includes('Chrome DevTools connection closed')) throw error;
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(
    `Timed out waiting for ${label}. Last value: ${JSON.stringify(lastValue)}` +
      (lastError ? `; last error: ${lastError.message}` : ''),
  );
}

const readySnapshotExpression = `(() => {
  const root = document.querySelector('#game-root');
  const canvas = root?.querySelector('canvas');
  const image = document.querySelector('.smoke-embedded-asset');
  let webgl = false;
  if (canvas) {
    const context = canvas.getContext('webgl2') || canvas.getContext('webgl');
    webgl = Boolean(context && !context.isContextLost());
  }
  return {
    root: Boolean(root && root.childElementCount),
    canvas: Boolean(canvas && canvas.width > 0 && canvas.height > 0),
    webgl,
    heading: document.querySelector('.smoke-heading')?.textContent?.trim() || '',
    script: document.querySelector('.smoke-script-status')?.textContent?.trim() || '',
    assetData: (image?.getAttribute('src')?.startsWith('data:image/svg+xml') || image?.getAttribute('src')?.startsWith('./game-assets/')) || false,
    assetDecoded: Boolean(image?.complete && image?.naturalWidth > 0),
    cinematicText: document.querySelector('.cinematic-text-line')?.textContent?.trim() || '',
    cinematicPosition: document.querySelector('.cinematic-overlay')?.style.position || '',
    cinematicBars: document.querySelectorAll('.cinematic-bar').length,
    cinematicGrainPosition: document.querySelector('.cinematic-grain')?.style.position || '',
    failed: document.body.innerText.includes('Failed to start the game'),
  };
})()`;

async function checkPlayer(cdp, url, heading, { exerciseRuntime }) {
  await cdp.call('Page.navigate', { url });
  const snapshot = await waitFor(
    cdp,
    `${heading} player readiness`,
    readySnapshotExpression,
    (value) =>
      value?.root &&
      value?.canvas &&
      value?.webgl &&
      value?.heading === heading &&
      value?.script === 'SCRIPT_OK' &&
      value?.assetData &&
      value?.assetDecoded &&
      value?.cinematicText === 'CINEMATIC_OVERLAY_OK' &&
      value?.cinematicPosition === 'absolute' &&
      value?.cinematicBars === 2 &&
      value?.cinematicGrainPosition === 'absolute' &&
      !value?.failed,
  );
  assert.equal(snapshot.heading, heading);

  if (!exerciseRuntime) return;

  const physics = await waitFor(
    cdp,
    'Rapier body to move and publish its transform through the Blueprint/HUD path',
    `(() => {
      const text = document.querySelector('.smoke-physics-position')?.textContent?.trim() || '';
      const values = text.split(',').map(Number);
      return { text, y: values.length === 3 ? values[1] : null };
    })()`,
    // SwiftShader is intentionally slow once the water/cloth/cable parity probes are mounted; a clear
    // half-unit fall is enough to prove that Rapier and the Update -> HUD data path are both advancing.
    (value) => Number.isFinite(value?.y) && value.y < 3.5,
    RUNTIME_WAIT_TIMEOUT_MS,
  );
  assert.ok(physics.y < 3.5, `Physics probe did not fall from y=4: ${physics.text}`);

  const clicked = await evaluate(
    cdp,
    `(() => { const button = document.querySelector('.smoke-runtime-button'); button?.click(); return Boolean(button); })()`,
  );
  assert.equal(clicked, true, 'Production HUD button was not rendered');
  await waitFor(
    cdp,
    'HUD custom event to reach the production Blueprint runtime',
    `document.querySelector('.smoke-script-status')?.textContent?.trim() || ''`,
    (value) => value === 'BUTTON_OK',
    RUNTIME_WAIT_TIMEOUT_MS,
  );
}

async function main() {
  const executable = chromeExecutable();
  assert.ok(
    executable,
    'Chrome/Chromium was not found. Install Chrome or set CHROME_PATH to its executable.',
  );

  const staticServer = createStaticServer();
  const httpPort = await listen(staticServer);
  const profileDir = mkdtempSync(join(tmpdir(), 'feather-player-chrome-'));
  let chrome;
  let cdp;
  let chromeOutput = '';

  try {
    chrome = spawn(
      executable,
      [
        '--headless=new',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-default-apps',
        '--disable-sync',
        '--enable-unsafe-swiftshader',
        '--enable-webgl',
        '--ignore-gpu-blocklist',
        '--metrics-recording-only',
        '--mute-audio',
        '--no-default-browser-check',
        '--no-first-run',
        '--use-angle=swiftshader',
        '--window-size=1280,720',
        '--remote-debugging-port=0',
        `--user-data-dir=${profileDir}`,
        'about:blank',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const appendChromeOutput = (chunk) => {
      chromeOutput = `${chromeOutput}${chunk}`.slice(-8_000);
    };
    chrome.stdout.on('data', appendChromeOutput);
    chrome.stderr.on('data', appendChromeOutput);

    const debugPort = await waitForDevTools(profileDir, chrome, () => chromeOutput);
    const page = await findPageTarget(debugPort);
    cdp = await CdpSession.connect(page.webSocketDebuggerUrl);

    const problems = [];
    cdp.onEvent((method, params) => {
      if (method === 'Runtime.exceptionThrown') {
        problems.push(`Uncaught exception: ${params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text ?? 'unknown'}`);
      } else if (method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(params.type)) {
        const message = (params.args ?? []).map((arg) => arg.value ?? arg.description ?? '').join(' ');
        // SwiftShader (used so WebGL works on headless CI machines without a GPU) cannot expose this
        // optional extension. Three reports that fact as a warning even though its fallback is healthy.
        if (!message.includes('KHR_parallel_shader_compile extension not supported')) {
          problems.push(`console.${params.type}: ${message}`);
        }
      } else if (
        method === 'Log.entryAdded' &&
        ['error', 'warning'].includes(params.entry?.level) &&
        // Chrome emits GL driver/performance notices through the rendering log when SwiftShader is
        // active. The explicit live/context check above is the meaningful pass/fail signal here.
        params.entry?.source !== 'rendering'
      ) {
        problems.push(`${params.entry.level}: ${params.entry.text}`);
      } else if (method === 'Network.loadingFailed' && !params.canceled) {
        problems.push(`Network failure: ${params.errorText} (${params.type ?? 'unknown'})`);
      } else if (method === 'Network.responseReceived' && params.response?.status >= 400) {
        problems.push(`HTTP ${params.response.status}: ${params.response.url}`);
      }
    });

    await Promise.all([
      cdp.call('Page.enable'),
      cdp.call('Runtime.enable'),
      cdp.call('Log.enable'),
      cdp.call('Network.enable'),
    ]);

    await checkPlayer(
      cdp,
      `http://127.0.0.1:${httpPort}/`,
      'FEATHER_PRODUCTION_SMOKE',
      { exerciseRuntime: true },
    );

    if (legacyDir) {
      await checkPlayer(
        cdp,
        `http://127.0.0.1:${httpPort}/legacy/`,
        'FEATHER_LEGACY_MIGRATION_OK',
        { exerciseRuntime: false },
      );
    }

    // Give deferred React/browser errors a chance to surface after the final successful assertion.
    await delay(300);
    assert.deepEqual([...new Set(problems)], [], `Production browser reported failures:\n${[...new Set(problems)].join('\n')}`);
    console.log(
      `OK: Real-browser player smoke passed (WebGL, asset delivery, physics, Blueprint, HUD, water/cloth/cable, cinematic overlay${legacyDir ? ', migration' : ''}).`,
    );
  } finally {
    cdp?.close();
    if (chrome && chrome.exitCode === null) {
      chrome.kill();
      await Promise.race([
        new Promise((done) => chrome.once('exit', done)),
        delay(5_000),
      ]);
      if (chrome.exitCode === null) chrome.kill('SIGKILL');
    }
    // Chrome helpers can inherit stderr after the browser exits. Release that pipe so a passed
    // smoke check does not keep the export command alive waiting on an unrelated helper process.
    chrome?.stdout?.destroy();
    chrome?.stderr?.destroy();
    chrome?.unref();
    const serverClosed = closeServer(staticServer);
    staticServer.closeAllConnections?.();
    await serverClosed;
    try {
      rmSync(profileDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      // A stale browser temp directory must not turn a successful runtime assertion into a failure.
    }
  }
}

main().catch((error) => {
  console.error(`ERROR: ${error.stack ?? error.message ?? error}`);
  process.exitCode = 1;
});
