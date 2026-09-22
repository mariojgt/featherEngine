import { afterEach, expect, it, vi } from 'vitest';
import { connectRealm, disconnectRealm, realmCommand, sayInRealm, startSolo, useRealm } from '../session';
import type { RealmSnapshot } from '../../../examples/titan-mmo/server/world.mjs';

afterEach(() => { disconnectRealm(); localStorage.clear(); vi.unstubAllGlobals(); });

/** A WebSocket stand-in that records what the client sends and replays what the realm answers. */
class FakeSocket {
  static OPEN = 1;
  static last: FakeSocket | undefined;
  static sent: string[] = [];
  readyState = FakeSocket.OPEN;
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: (() => void) | null;
  onerror?: () => void;
  constructor() { FakeSocket.last = this; FakeSocket.sent = []; }
  send(data: string) { FakeSocket.sent.push(data); }
  close() {}
}
const snapshot = (version: number): RealmSnapshot => ({
  version, time: 4, selfId: 'hero', zone: 'thornwood', online: 1,
  players: [], enemies: [], effects: [],
});

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

it('states the chosen class and the zones this build can show, and only trusts version 2 snapshots', async () => {
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ticket: 'join-ticket' }))));
  await connectRealm('http://127.0.0.1:8787', { name: 'Aster', mode: 'guest' }, undefined, { class: 'mage', zones: ['ember-meadow', 'thornwood'] });
  FakeSocket.last!.onopen!();
  expect(JSON.parse(FakeSocket.sent[0])).toEqual({ type: 'join', ticket: 'join-ticket', class: 'mage', zones: ['ember-meadow', 'thornwood'] });

  FakeSocket.last!.onmessage!({ data: JSON.stringify({ type: 'snapshot', data: snapshot(1) }) });
  expect(useRealm.getState().status).toBe('connecting');
  FakeSocket.last!.onmessage!({ data: JSON.stringify({ type: 'snapshot', data: snapshot(2) }) });
  expect(useRealm.getState().status).toBe('playing');
  expect(useRealm.getState().snapshot?.zone).toBe('thornwood');
});

it('forwards zone chat to the realm and keeps what the realm broadcasts back', async () => {
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ticket: 'join-ticket' }))));
  await connectRealm('http://127.0.0.1:8787', { name: 'Aster', mode: 'guest' });
  FakeSocket.last!.onopen!();
  sayInRealm('   ');
  sayInRealm('  well met  ');
  expect(FakeSocket.sent.slice(1).map(line => JSON.parse(line))).toEqual([{ type: 'say', text: 'well met' }]);
  FakeSocket.last!.onmessage!({ data: JSON.stringify({ type: 'chat', id: 3, from: 'Wren', text: 'well met', at: 9, zone: 'thornwood', self: false }) });
  expect(useRealm.getState().chat).toEqual([{ id: 1, from: 'Wren', text: 'well met', at: 9, self: false }]);
});

it('starts a solo character in the chosen class and echoes its own chat locally', () => {
  startSolo('Aster', 'test-game', { class: 'ranger', zones: ['ember-meadow'] });
  expect(useRealm.getState().snapshot?.players[0].class).toBe('ranger');
  sayInRealm('anyone out here?');
  expect(useRealm.getState().chat).toEqual([{ id: expect.any(Number), from: 'Aster', text: 'anyone out here?', at: 0, self: true }]);
  realmCommand({ type: 'save' });
  expect(useRealm.getState().message).toMatch(/saved/);
});
