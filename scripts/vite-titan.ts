import type { Plugin } from 'vite';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { startRealm } from '../examples/titan-mmo/server/server.mjs';

function localConnection(input: unknown): { baseUrl: string; gameKey: string } {
  const settings = input as Record<string, unknown> | undefined;
  if (typeof settings?.baseUrl !== 'string' || typeof settings?.gameKey !== 'string') throw new Error('Choose demo accounts or enter your Titan connection.');
  const baseUrl = settings.baseUrl.trim().replace(/\/$/, ''), gameKey = settings.gameKey.trim();
  if (Boolean(baseUrl) !== Boolean(gameKey)) throw new Error('Enter both the Titan API URL and game key.');
  if (baseUrl) {
    const url = new URL(baseUrl);
    if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('Use an HTTPS Titan API URL.');
  }
  if (/^(sb_secret_|service_role|eyJ)/i.test(gameKey)) throw new Error('Use your Titan game key, not a Supabase secret.');
  return { baseUrl, gameKey };
}

/** Same-origin development bridge; packaged desktop uses the owned native realm process. */
export function titanRealmBridge(): Plugin {
  let realm: Awaited<ReturnType<typeof startRealm>> | undefined;
  let status: { running: boolean; gameId?: string; storageId?: string; url?: string; authMode?: string } = { running: false };
  let busy = false;
  return { name: 'feather-titan-realm', apply: 'serve', configureServer(server) {
    server.httpServer?.once('close', () => { void realm?.close(); realm = undefined; });
    server.middlewares.use('/__feather/titan-realm', async (req, res) => {
      res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
      const reply = (code: number, data: unknown) => { res.statusCode = code; res.end(JSON.stringify(data)); };
      const address = req.socket.remoteAddress ?? '';
      const origin = `http://${req.headers.host}`;
      let hostname = ''; try { hostname = new URL(origin).hostname; } catch {}
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address) || !['localhost', '127.0.0.1', '[::1]'].includes(hostname)) return reply(403, { message: 'Open the editor on localhost to manage a local realm.' });
      if (req.method === 'GET') return reply(200, status);
      if (req.method !== 'POST' || req.headers.origin !== origin || !req.headers['content-type']?.startsWith('application/json')) return reply(403, { message: 'Use the Titan setup panel to manage this realm.' });
      if (busy) return reply(409, { message: 'The realm is already starting or stopping.' });
      busy = true;
      try {
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 16384) throw new Error('Setup request is too large.'); chunks.push(chunk); }
        const input = JSON.parse(Buffer.concat(chunks).toString());
        if (!['start', 'stop'].includes(input.action)) throw new Error('Unknown realm action.');
        if (input.action === 'start') {
          if (typeof input.gameId !== 'string' || !/^[\w.-]{1,128}$/.test(input.gameId)) throw new Error('Invalid game identity.');
          const settings = localConnection(input.settings);
          await realm?.close(); realm = undefined; status = { running: false };
          const namespace = createHash('sha256').update(`${input.gameId}:${settings.baseUrl}:${settings.gameKey}`).digest('hex').slice(0, 24);
          realm = await startRealm({ gameId: input.gameId, port: 0, host: '127.0.0.1', dataFile: resolve(server.config.root, '.feather-cache/titan', namespace, 'players.json'),
            titanUrl: settings.baseUrl, gameKey: settings.gameKey, origins: origin });
          status = { running: true, gameId: input.gameId, storageId: namespace, url: `http://127.0.0.1:${realm.port}`, authMode: settings.baseUrl ? 'titan' : 'local' };
        } else { await realm?.close(); realm = undefined; status = { running: false }; }
        reply(200, status);
      } catch (error) { reply(400, { message: error instanceof Error ? error.message : 'Could not manage the realm.' }); }
      finally { busy = false; }
    });
  } };
}
