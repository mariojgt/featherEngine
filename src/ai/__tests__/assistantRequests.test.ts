import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../components/workspacePanels', () => ({ focusWorkspacePanel: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('window', new EventTarget());
});
afterEach(() => { vi.unstubAllGlobals(); });

const ask = (prompt?: string) => window.dispatchEvent(new CustomEvent('nf:ask-ai', { detail: { prompt } }));

describe('deferred Agent requests', () => {
  it('preserves a launcher prompt until the Agent mounts and delivers it once', async () => {
    const { startAssistantRequests, subscribeAssistantRequests } = await import('../assistantRequests');
    startAssistantRequests();
    startAssistantRequests();
    ask('  Build a platformer  ');
    const receive = vi.fn();
    const unsubscribe = subscribeAssistantRequests(receive);
    expect(receive).toHaveBeenCalledTimes(1);
    expect(receive).toHaveBeenCalledWith('Build a platformer');
    unsubscribe();
    const remount = vi.fn();
    subscribeAssistantRequests(remount);
    expect(remount).not.toHaveBeenCalled();
  });

  it('delivers live requests, then queues again while the panel is unmounted', async () => {
    const { startAssistantRequests, subscribeAssistantRequests } = await import('../assistantRequests');
    startAssistantRequests();
    const receive = vi.fn();
    const unsubscribe = subscribeAssistantRequests(receive);
    ask('Add a checkpoint');
    expect(receive).toHaveBeenCalledTimes(1);
    expect(receive).toHaveBeenCalledWith('Add a checkpoint');
    unsubscribe();
    ask('Add a finish line');
    expect(receive).toHaveBeenCalledTimes(1);
    const remount = vi.fn();
    subscribeAssistantRequests(remount);
    expect(remount).toHaveBeenCalledTimes(1);
    expect(remount).toHaveBeenCalledWith('Add a finish line');
  });

  it('reveals the Agent without forwarding empty requests', async () => {
    const { startAssistantRequests, subscribeAssistantRequests } = await import('../assistantRequests');
    const { focusWorkspacePanel } = await import('../../components/workspacePanels');
    startAssistantRequests();
    const receive = vi.fn();
    subscribeAssistantRequests(receive);
    ask('  ');
    ask();
    expect(receive).not.toHaveBeenCalled();
    expect(focusWorkspacePanel).toHaveBeenCalledWith('agent');
  });
});
