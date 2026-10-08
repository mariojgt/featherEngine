import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const mocks = vi.hoisted(() => ({ getTools: vi.fn(), execute: vi.fn() }));
vi.mock('../tools', () => ({ getActiveEngineTools: mocks.getTools }));
vi.mock('../systemPrompt', () => ({ COMPACT_ENGINE_GUIDE: 'Test instructions' }));

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 0;
  onopen: (() => Promise<void>) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn();
  constructor() { Socket.instances.push(this); }
  close() { this.readyState = 3; this.onclose?.(); }
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.clearAllMocks();
  Socket.instances = [];
  vi.stubGlobal('WebSocket', Socket);
  mocks.getTools.mockReturnValue({ test_tool: { description: 'Test', inputSchema: z.object({ count: z.number() }), execute: mocks.execute } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('deferred MCP tools', () => {
  it('does not inspect tools while the relay is disconnected and retries', async () => {
    const { startMcpBridge } = await import('../mcpBridge');
    startMcpBridge();
    startMcpBridge();
    expect(Socket.instances).toHaveLength(1);
    Socket.instances[0].close();
    await vi.advanceTimersByTimeAsync(2000);
    expect(Socket.instances).toHaveLength(2);
    expect(mocks.getTools).not.toHaveBeenCalled();
  });

  it('registers tools when connected and validates calls against their live schemas', async () => {
    const { startMcpBridge } = await import('../mcpBridge');
    startMcpBridge();
    const socket = Socket.instances[0];
    socket.readyState = Socket.OPEN;
    await socket.onopen!();
    expect(JSON.parse(socket.send.mock.calls[0][0])).toMatchObject({ type: 'register', tools: [{ name: 'test_tool', inputSchema: { type: 'object' } }] });
    mocks.execute.mockResolvedValue('done');
    socket.onmessage!({ data: JSON.stringify({ type: 'call', id: 'valid', tool: 'test_tool', input: { count: 2 } }) });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.execute).toHaveBeenCalledWith({ count: 2 }, { toolCallId: 'valid', messages: [] });
    expect(JSON.parse(socket.send.mock.calls[socket.send.mock.calls.length - 1][0])).toEqual({ type: 'result', id: 'valid', ok: true, result: 'done' });
    socket.onmessage!({ data: JSON.stringify({ type: 'call', id: 'invalid', tool: 'test_tool', input: { count: 'bad' } }) });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(JSON.parse(socket.send.mock.calls[socket.send.mock.calls.length - 1][0])).toMatchObject({ type: 'result', id: 'invalid', ok: false });
  });

  it('does not register on a socket that closes while tools are loading', async () => {
    const { startMcpBridge } = await import('../mcpBridge');
    startMcpBridge();
    const socket = Socket.instances[0];
    socket.readyState = Socket.OPEN;
    const opening = socket.onopen!();
    socket.close();
    await opening;
    expect(socket.send).not.toHaveBeenCalled();
  });
});
