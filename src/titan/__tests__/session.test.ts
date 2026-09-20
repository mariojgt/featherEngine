import { afterEach, expect, it, vi } from 'vitest';
import { connectRealm, disconnectRealm } from '../session';
afterEach(() => { disconnectRealm(); localStorage.clear(); vi.unstubAllGlobals(); });
it('keeps managed guest identity when the ephemeral port changes, without sharing it across projects or hosted realms', async () => {
  class Socket { close() {} }
  vi.stubGlobal('WebSocket', Socket);
  const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ ticket: 'ticket', resume: 'guest-resume' })));
  vi.stubGlobal('fetch', fetch);
  await connectRealm('http://127.0.0.1:12001', { name: 'Aster', mode: 'guest' }, 'project-a');
  await connectRealm('http://127.0.0.1:13002', { name: 'Aster', mode: 'guest' }, 'project-a');
  expect(JSON.parse(fetch.mock.calls[1][1].body).resume).toBe('guest-resume');
  await connectRealm('http://127.0.0.1:14003', { name: 'Aster', mode: 'guest' }, 'project-b');
  expect(JSON.parse(fetch.mock.calls[2][1].body).resume).toBeUndefined();
  await connectRealm('https://realm.example.test', { name: 'Aster', mode: 'guest' });
  expect(JSON.parse(fetch.mock.calls[3][1].body).resume).toBeUndefined();
});
