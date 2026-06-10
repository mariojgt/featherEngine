#!/usr/bin/env node
/**
 * Feather Engine MCP relay — exposes the running editor's AI tools over MCP so external
 * agents (Claude Code, VSCode, Cursor, …) can drive the editor.
 *
 *   npm run mcp                # start the relay (default port 5151)
 *   claude mcp add --transport http feather http://127.0.0.1:5151/mcp
 *
 * Architecture: the editor is a browser page, so this process is a dumb relay with two faces:
 *   - ws://127.0.0.1:5151/editor  — the editor connects here (src/ai/mcpBridge.ts) and
 *     registers its tool manifest (names + descriptions + JSON Schemas derived from the same
 *     zod schemas the in-app chat uses). Tool calls are forwarded back over this socket and
 *     executed against the live Zustand store inside the editor.
 *   - http://127.0.0.1:5151/mcp   — MCP streamable-HTTP endpoint for clients.
 *
 * This file never imports editor code; the manifest arrives at runtime, so new tools added to
 * src/ai/tools.ts appear here automatically. The last manifest is cached on disk so clients
 * can list tools before the editor is opened (calls still require a connected editor).
 */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const PORT = Number(process.env.NODEFORGE_MCP_PORT ?? 5151);
const CALL_TIMEOUT_MS = 120_000;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_FILE = join(ROOT, 'node_modules', '.cache', 'nodeforge-mcp', 'manifest.json');

// --- Editor bridge state --------------------------------------------------------------------

/** @type {import('ws').WebSocket | null} */
let editorSocket = null;
let tools = [];
let instructions =
  'Feather Engine MCP. Tools drive a LIVE editor session — open the editor (npm run dev or npm run tauri:dev) to connect it.';
/** @type {Map<string, {resolve: (v: any) => void, timer: NodeJS.Timeout}>} */
const pending = new Map();

function loadCache() {
  try {
    const cached = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
    if (Array.isArray(cached.tools)) tools = cached.tools;
    if (typeof cached.instructions === 'string') instructions = cached.instructions;
  } catch {
    /* first run — no cache yet */
  }
}

function saveCache() {
  try {
    mkdirSync(dirname(CACHE_FILE), { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({ tools, instructions }));
  } catch (error) {
    console.warn('[mcp] could not cache tool manifest:', error.message);
  }
}

function rejectPending(reason) {
  for (const [id, entry] of pending) {
    clearTimeout(entry.timer);
    entry.resolve({ ok: false, error: reason });
    pending.delete(id);
  }
}

/** Forward one tool call to the connected editor and await its result. */
function callEditor(tool, input) {
  return new Promise((resolve) => {
    if (!editorSocket) {
      resolve({ ok: false, error: 'editor not connected' });
      return;
    }
    const id = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ ok: false, error: `Timed out after ${CALL_TIMEOUT_MS / 1000}s waiting for the editor` });
    }, CALL_TIMEOUT_MS);
    pending.set(id, { resolve, timer });
    editorSocket.send(JSON.stringify({ type: 'call', id, tool, input }));
  });
}

// --- MCP server (one lightweight instance per request — stateless HTTP mode) -----------------

function buildMcpServer() {
  const server = new Server(
    { name: 'feather-engine', version: '0.1.0' },
    { capabilities: { tools: { listChanged: true } }, instructions },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    if (!editorSocket) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: 'Feather Engine editor is not connected. Open the editor (npm run dev → http://localhost:1420, or npm run tauri:dev) with a project loaded — it attaches to this relay automatically within a few seconds.',
          },
        ],
      };
    }
    if (!tools.some((tool) => tool.name === name)) {
      return { isError: true, content: [{ type: 'text', text: `Unknown tool "${name}"` }] };
    }
    const outcome = await callEditor(name, args ?? {});
    if (!outcome.ok) {
      return { isError: true, content: [{ type: 'text', text: `Tool failed: ${outcome.error}` }] };
    }
    const text =
      typeof outcome.result === 'string' ? outcome.result : JSON.stringify(outcome.result, null, 2);
    return { content: [{ type: 'text', text }] };
  });

  return server;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : undefined);
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

async function handleMcpRequest(req, res) {
  const body = req.method === 'POST' ? await readBody(req) : undefined;
  const server = buildMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless: no sessions, every request self-contained
    enableJsonResponse: true,
  });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

// --- HTTP + WebSocket host ---------------------------------------------------------------------

loadCache();

const httpServer = createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (path === '/mcp') {
    handleMcpRequest(req, res).catch((error) => {
      console.error('[mcp] request failed:', error);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32603, message: String(error?.message ?? error) },
            id: null,
          }),
        );
      }
    });
    return;
  }
  if (path === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        name: 'feather-engine-mcp',
        editorConnected: editorSocket !== null,
        tools: tools.length,
        mcpEndpoint: `http://127.0.0.1:${PORT}/mcp`,
      }),
    );
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ server: httpServer, path: '/editor' });

wss.on('connection', (socket) => {
  socket.isAlive = true;
  socket.on('pong', () => {
    socket.isAlive = true;
  });

  socket.on('message', (data) => {
    let message;
    try {
      message = JSON.parse(String(data));
    } catch {
      return;
    }
    if (message.type === 'register') {
      if (editorSocket && editorSocket !== socket) {
        console.log('[mcp] a new editor window registered — replacing the previous one');
        editorSocket.close();
        rejectPending('editor was replaced by a new editor window');
      }
      editorSocket = socket;
      if (Array.isArray(message.tools)) tools = message.tools;
      if (typeof message.instructions === 'string') instructions = message.instructions;
      saveCache();
      console.log(`[mcp] editor connected — ${tools.length} engine tools available`);
      return;
    }
    if (message.type === 'result' && pending.has(message.id)) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(entry.timer);
      entry.resolve({ ok: message.ok === true, result: message.result, error: message.error });
    }
  });

  socket.on('close', () => {
    if (editorSocket === socket) {
      editorSocket = null;
      rejectPending('editor disconnected mid-call');
      console.log('[mcp] editor disconnected — tool calls will fail until it reconnects (tool list stays cached)');
    }
  });
});

// Drop dead editor sockets (e.g. the window was killed without a close frame).
setInterval(() => {
  for (const socket of wss.clients) {
    if (socket.isAlive === false) {
      socket.terminate();
      continue;
    }
    socket.isAlive = false;
    socket.ping();
  }
}, 30_000).unref();

// Localhost only: these tools mutate the user's project — never expose them to the LAN.
httpServer.listen(PORT, '127.0.0.1', () => {
  console.log(`Feather Engine MCP relay`);
  console.log(`  MCP endpoint : http://127.0.0.1:${PORT}/mcp`);
  console.log(`  Editor bridge: ws://127.0.0.1:${PORT}/editor (the editor attaches automatically)`);
  console.log(`  Tools cached : ${tools.length}${editorSocket ? '' : ' (open the editor to enable calls)'}`);
  console.log('');
  console.log('  Add to Claude Code:');
  console.log(`    claude mcp add --transport http feather http://127.0.0.1:${PORT}/mcp`);
});

httpServer.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`[mcp] port ${PORT} is already in use — is another relay running? (NODEFORGE_MCP_PORT overrides)`);
    process.exit(1);
  }
  throw error;
});
