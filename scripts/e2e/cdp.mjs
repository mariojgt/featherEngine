/**
 * Minimal Chrome DevTools Protocol driver for end-to-end tests.
 *
 * Why CDP over a framework: the repo already drives Chrome this way in
 * scripts/player-browser-smoke.mjs, `ws` is already a dependency, and it needs no browser download.
 * More importantly it gives REAL pointer input via Input.dispatchMouseEvent — the MCP screenshot
 * harness dispatches synthetic DOM clicks, which ReactFlow ignores entirely (clicking a graph node
 * there does not even select it). Anything touching the node editor has to drive real mouse events.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import WebSocket from 'ws';

export const delay = (ms) => new Promise((done) => setTimeout(done, ms));

/** Chrome binaries under Puppeteer's download cache, newest version first. */
function puppeteerCacheChromes() {
  const root = join(homedir(), '.cache', 'puppeteer', 'chrome');
  if (!existsSync(root)) return [];
  const inner = process.platform === 'darwin' ? ['Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'] : ['chrome'];
  return readdirSync(root)
    .sort()
    .reverse()
    .flatMap((version) => {
      const dir = join(root, version);
      const builds = existsSync(dir) ? readdirSync(dir) : [];
      return builds.map((build) => join(dir, build, ...inner));
    });
}

export function chromeExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.GOOGLE_CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    // Puppeteer's managed download, which is present on plenty of dev machines that have no
    // system Chrome at all. Newest version first.
    ...puppeteerCacheChromes(),
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    process.env.PROGRAMFILES && `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
    process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate));
}

export class CdpSession {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
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
    await new Promise((open, reject) => {
      socket.once('open', open);
      socket.once('error', reject);
    });
    return new CdpSession(socket);
  }

  onMessage(raw) {
    const message = JSON.parse(raw.toString());
    if (!message.id) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) pending.reject(new Error(`${message.error.message} (${message.error.code})`));
    else pending.resolve(message.result);
  }

  call(method, params = {}) {
    const first = this.sendCommand(method, params);
    if (method !== 'Page.captureScreenshot') return first;
    // In CI a headless SwiftShader capture timed out, then a fresh capture succeeded.
    // Retry that read once;
    // never replay input/mutation commands or suppress a second screenshot failure.
    return first.catch((error) => {
      if (error.message !== `CDP command timed out: ${method}`) throw error;
      console.warn('Retrying timed-out browser screenshot once.');
      return this.sendCommand(method, params);
    });
  }

  sendCommand(method, params) {
    if (this.closed || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Chrome DevTools connection closed'));
    }
    const id = this.nextId++;
    return new Promise((done, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, Number(process.env.FEATHER_CDP_TIMEOUT_MS) || 30_000);
      this.pending.set(id, { resolve: done, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

async function waitForDevToolsUrl(profileDir, chrome) {
  const portFile = resolve(profileDir, 'DevToolsActivePort');
  // Generous, because every spec launches its own browser on a fresh profile: a cold start behind
  // Gatekeeper (or several specs contending) regularly took >20s here and surfaced as a random
  // spec "failing" with no assertion — the most misleading kind of flake.
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (chrome.exitCode !== null) throw new Error(`Chrome exited early (code ${chrome.exitCode})`);
    if (existsSync(portFile)) {
      const [port, path] = readFileSync(portFile, 'utf8').split('\n');
      if (port && path) return `ws://127.0.0.1:${port.trim()}${path.trim()}`;
    }
    await delay(120);
  }
  throw new Error('Chrome never reported a DevTools port');
}

/** Launch headless Chrome and attach to a page target. Returns a Page plus a dispose(). */
export async function launch({ width = 1600, height = 1000, hostResolverRules, ignoreCertificateErrors = false } = {}) {
  const executable = chromeExecutable();
  assert.ok(executable, 'No Chrome/Chromium found. Set CHROME_PATH to run the e2e suite.');
  const profileDir = mkdtempSync(join(tmpdir(), 'feather-e2e-'));
  const chrome = spawn(
    executable,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profileDir}`,
      `--window-size=${width},${height}`,
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-sync',
      '--no-first-run',
      '--no-default-browser-check',
      '--enable-webgl',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--metrics-recording-only',
      '--mute-audio',
      ...(hostResolverRules ? [`--host-resolver-rules=${hostResolverRules}`] : []),
      ...(ignoreCertificateErrors ? ['--ignore-certificate-errors'] : []),
      // The editor is a WebGL app; ANGLE's SwiftShader path is the stable deterministic headless
      // renderer. Combining the older --use-gl flag with --disable-gpu intermittently killed Chrome.
      `--use-angle=${process.env.FEATHER_E2E_ANGLE ?? process.env.FEATHER_CHROME_ANGLE ?? 'swiftshader'}`,
      '--hide-scrollbars',
      'about:blank',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  // Drain Chrome diagnostics even when the suite does not need to print them. Leaving these pipes
  // unread can fill the OS buffer during WebGL-heavy specs and stall or terminate the browser.
  chrome.stdout.resume();
  chrome.stderr.resume();

  const browserWs = await waitForDevToolsUrl(profileDir, chrome);
  const browser = await CdpSession.connect(browserWs);
  const { targetId } = await browser.call('Target.createTarget', { url: 'about:blank' });
  const { targetInfo } = await browser.call('Target.getTargetInfo', { targetId });
  assert.equal(targetInfo.type, 'page');
  const page = await CdpSession.connect(browserWs.replace(/\/devtools\/browser\/.*$/, `/devtools/page/${targetId}`));
  await page.call('Page.enable');
  await page.call('Runtime.enable');

  return {
    page,
    async dispose() {
      try {
        page.close();
        browser.close();
      } catch {
        /* sockets may already be gone */
      }
      chrome.kill();
      // Wait for the process to actually exit before removing its profile: rmSync raced Chrome's
      // final writes and threw EACCES "Directory not empty", failing otherwise-passing specs.
      await Promise.race([
        new Promise((done) => chrome.once('exit', done)),
        delay(5_000),
      ]);
      if (chrome.exitCode === null) {
        chrome.kill('SIGKILL');
        await Promise.race([
          new Promise((done) => chrome.once('exit', done)),
          delay(2_000),
        ]);
      }
      // A leftover temp dir is never worth failing a test over — the OS reaps it.
      try {
        rmSync(profileDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      } catch {
        /* ignore */
      }
    },
  };
}
