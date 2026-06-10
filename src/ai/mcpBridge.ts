import { z } from 'zod';
import { COMPACT_ENGINE_GUIDE } from './systemPrompt';
import { engineTools } from './tools';

/**
 * MCP bridge — lets external agents (Claude Code, VSCode, Cursor, …) drive this editor.
 *
 * The editor is a browser page, so it can't host an MCP endpoint itself. Instead a tiny
 * relay process (`npm run mcp`, scripts/mcp-server.mjs) exposes MCP over HTTP and hosts a
 * local WebSocket; this module connects to it, registers the SAME `engineTools` the in-app
 * chat uses (single source of truth — a tool added to tools.ts shows up in MCP with zero
 * extra wiring), and executes forwarded calls against the live Zustand store.
 *
 * The relay being down is the normal case (it's an opt-in dev companion), so connection
 * failures are silent and retried with backoff forever.
 */

// Must match the relay's port (NODEFORGE_MCP_PORT in scripts/mcp-server.mjs, default 5151).
const MCP_PORT = 5151;
const BRIDGE_URL = `ws://127.0.0.1:${MCP_PORT}/editor`;
const BACKOFF_MS = [2_000, 4_000, 8_000, 15_000, 30_000];

interface BridgeCallMessage {
  type: 'call';
  id: string;
  tool: string;
  input: unknown;
}

type LooseTool = {
  description?: string;
  inputSchema?: unknown;
  execute?: (input: unknown, options: { toolCallId: string; messages: never[] }) => unknown;
};

const looseTools = engineTools as unknown as Record<string, LooseTool>;

const isZodSchema = (value: unknown): value is z.ZodType =>
  !!value && typeof (value as z.ZodType).safeParse === 'function';

/** External clients don't get the chat widget's persona/snapshot framing — swap those lines. */
const MCP_INSTRUCTIONS = COMPACT_ENGINE_GUIDE.replace(
  'You are Feather Assistant, the in-editor AI for Feather Engine. Use tools to modify the live editor. Be concise.',
  'These tools drive a LIVE Feather Engine editor session (browser 3D game-engine editor). Calls mutate the open project immediately.',
).replace(
  'Tiny snapshot follows. Arrays may end with {omitted,total}; inspect for more detail.',
  'Call list_scene("compact") first to see the current scene before editing.',
);

/** name + description + JSON Schema for every engine tool, derived from the zod schemas. */
function buildToolManifest() {
  return Object.entries(looseTools)
    .filter(([, def]) => typeof def.execute === 'function')
    .map(([name, def]) => ({
      name,
      description: def.description ?? '',
      inputSchema: isZodSchema(def.inputSchema)
        ? z.toJSONSchema(def.inputSchema, { io: 'input', unrepresentable: 'any', reused: 'inline' })
        : { type: 'object' },
    }));
}

async function executeCall(message: BridgeCallMessage): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const def = looseTools[message.tool];
  if (!def?.execute) return { ok: false, error: `Unknown tool "${message.tool}"` };
  try {
    let input: unknown = message.input ?? {};
    if (isZodSchema(def.inputSchema)) {
      const parsed = def.inputSchema.safeParse(input);
      if (!parsed.success) return { ok: false, error: `Invalid input for ${message.tool}: ${parsed.error.message}` };
      input = parsed.data;
    }
    const result = await def.execute(input, { toolCallId: message.id, messages: [] });
    return { ok: true, result: result ?? 'OK' };
  } catch (caught) {
    return { ok: false, error: caught instanceof Error ? caught.message : String(caught) };
  }
}

let started = false;

export function startMcpBridge(): void {
  if (started) return;
  started = true;

  let attempt = 0;
  let wasConnected = false;

  const connect = () => {
    let socket: WebSocket;
    try {
      socket = new WebSocket(BRIDGE_URL);
    } catch {
      scheduleRetry();
      return;
    }

    socket.onopen = () => {
      attempt = 0;
      wasConnected = true;
      console.info(`[mcp] connected to MCP relay on :${MCP_PORT} — engine tools are live for external agents`);
      socket.send(
        JSON.stringify({
          type: 'register',
          name: 'feather-engine',
          version: '0.1.0',
          instructions: MCP_INSTRUCTIONS,
          tools: buildToolManifest(),
        }),
      );
    };

    socket.onmessage = (event) => {
      let message: BridgeCallMessage;
      try {
        message = JSON.parse(String(event.data)) as BridgeCallMessage;
      } catch {
        return;
      }
      if (message.type !== 'call') return;
      void executeCall(message).then((outcome) => {
        if (socket.readyState !== WebSocket.OPEN) return;
        let payload: string;
        try {
          // Throws on circular structures (no engine tool should return one, but never kill the socket).
          payload = JSON.stringify({ type: 'result', id: message.id, ...outcome });
        } catch {
          payload = JSON.stringify({ type: 'result', id: message.id, ok: false, error: 'Unserializable tool result' });
        }
        socket.send(payload);
      });
    };

    socket.onclose = () => {
      if (wasConnected) console.info('[mcp] relay disconnected — retrying in background');
      wasConnected = false;
      scheduleRetry();
    };
    // onclose always follows onerror; retry is handled there.
    socket.onerror = () => {};
  };

  const scheduleRetry = () => {
    const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
    attempt += 1;
    window.setTimeout(connect, delay);
  };

  connect();
}
