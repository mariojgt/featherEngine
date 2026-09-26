import { afterEach, describe, it, expect, vi } from 'vitest';
import { TitanClient, TitanError, validateHttpUrl } from '../client';
import { validateTitanSettings } from '../settings';

afterEach(() => vi.unstubAllGlobals());

describe('Titan REST compatibility', () => {
  it('checks the key without creating players or relying on the public ping', async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response('{"configs":[]}'))
      .mockResolvedValueOnce(new Response('{"message":"Invalid key"}', { status: 401 }))
      .mockResolvedValueOnce(new Response('{"status":"ok"}'));
    const client = new TitanClient({ baseUrl: 'https://example.supabase.co', gameKey: 'test-game-key' }, request);
    await expect(client.checkConnection()).resolves.toBeUndefined();
    await expect(client.checkConnection()).rejects.toThrow('Invalid key');
    await expect(client.checkConnection()).rejects.toThrow('Titan project configuration');
    expect(request.mock.calls.every(([url, options]) => url.endsWith('/game-config') && options.method === 'GET')).toBe(true);
  });
  it('calls the default browser fetch with its Window receiver', async () => {
    const request = vi.fn(function (this: typeof globalThis, ..._args: Parameters<typeof fetch>) {
      if (this !== globalThis) throw new TypeError("'fetch' called on an object that does not implement interface Window.");
      return Promise.resolve(new Response(JSON.stringify({ ok: true })));
    });
    vi.stubGlobal('fetch', request);
    const client = new TitanClient({ baseUrl: 'https://example.supabase.co', gameKey: 'example-game-key' });
    await expect(client.ping()).resolves.toEqual({ ok: true });
    expect(request).toHaveBeenCalledWith('https://example.supabase.co/functions/v1/game-server/ping', expect.objectContaining({
      method: 'GET', headers: { 'Content-Type': 'application/json', 'X-Game-Key': 'example-game-key' },
    }));
  });
  it('uses the Unreal backend paths, game key and both supported player headers', async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ token: 'player-session', player: { uuid: 'player-session' } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: '{"level":2}' })))
      .mockResolvedValueOnce(new Response('{}'));
    const client = new TitanClient({ baseUrl: 'https://example.supabase.co/functions/v1/', gameKey: 'game-public-key' }, request);
    await client.login('hero@example.test', 'not-a-real-password');
    expect(request.mock.calls[0][0]).toBe('https://example.supabase.co/functions/v1/game-auth/login');
    expect(await client.load('ember-meadow')).toEqual({ level: 2 });
    expect(request.mock.calls[1][1].headers).toMatchObject({ 'X-Game-Key': 'game-public-key', 'X-Player-Token': 'player-session', Authorization: 'Bearer player-session' });
    client.logout(); await client.ping(); expect(request.mock.calls[2][1].headers).not.toHaveProperty('Authorization');
  });
  it('surfaces Titan failure responses and rejects bad URLs, paths, and secrets', async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_key', message: 'Invalid key' }), { status: 401 }));
    const client = new TitanClient({ baseUrl: 'http://localhost:54321', gameKey: 'public' }, request);
    await expect(client.ping()).rejects.toBeInstanceOf(TitanError);
    await expect(client.request('../secrets')).rejects.toThrow('Invalid Titan endpoint');
    for (const url of ['javascript:alert(1)', 'https://user:pass@example.test', 'http://remote.test', 'https://example.test?key=secret']) expect(() => validateHttpUrl(url)).toThrow();
    expect(() => validateTitanSettings({ realmUrl: 'http://localhost:8787/api', baseUrl: '', gameKey: '' })).toThrow();
    expect(() => validateTitanSettings({ realmUrl: 'http://localhost:8787', baseUrl: 'https://example.test', gameKey: 'sb_secret_wrong-key' })).toThrow();
  });
});
