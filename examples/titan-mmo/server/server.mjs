import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { RealmWorld, saveHero } from './world.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const cleanName = value => String(value ?? 'Wayfarer').trim().replace(/[\u0000-\u001f]/g, '').slice(0, 24) || 'Wayfarer';

/** One realm, capped at 32 concurrent players. No client can submit a position or grant an item. */
export async function startRealm(options = {}) {
  const host = options.host ?? process.env.HOST ?? '127.0.0.1';
  const port = options.port ?? Number(process.env.PORT ?? 8787);
  const dataFile = options.dataFile ?? resolve(process.env.REALM_DATA ?? 'realm-data/players.json');
  const titanUrl = options.titanUrl ?? process.env.TITAN_URL ?? '';
  const gameKey = options.gameKey ?? process.env.TITAN_GAME_KEY ?? '';
  const titan = Boolean(titanUrl && gameKey);
  if (Boolean(titanUrl) !== Boolean(gameKey)) throw new Error('Set both TITAN_URL and TITAN_GAME_KEY, or neither for local demo accounts.');
  const allowedOrigins = (options.origins ?? process.env.ALLOWED_ORIGINS ?? 'http://localhost:17420,http://127.0.0.1:17420,tauri://localhost,http://tauri.localhost').split(',').map(origin => origin.trim());
  const allowed = origin => !origin || allowedOrigins.includes(origin);
  const world = new RealmWorld();
  let records = {};
  try { const parsed = JSON.parse(await readFile(dataFile, 'utf8')); if (parsed.version !== 1 || !parsed.players || typeof parsed.players !== 'object') throw new Error('Unsupported realm save.'); records = parsed.players; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const sessions = new Map();
  const peers = new Map();
  let pendingConnections = 0;
  let saveQueue = Promise.resolve();
  const persist = () => {
    for (const [id, hero] of world.players) if (records[id]) records[id].progress = saveHero(hero);
    const bytes = JSON.stringify({ version: 1, players: records });
    const next = saveQueue.catch(() => {}).then(async () => {
      await mkdir(dirname(dataFile), { recursive: true });
      await writeFile(`${dataFile}.tmp`, bytes, { mode: 0o600 });
      await rename(`${dataFile}.tmp`, dataFile);
    });
    saveQueue = next; return next;
  };
  const reportSaveError = error => console.error('Realm save failed:', error.message);
  const titanRequest = async (path, body, token, method = 'POST') => {
    const url = `${titanUrl.replace(/\/+$/, '').replace(/\/functions\/v1$/, '')}/functions/v1/${path}`;
    const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-Game-Key': gameKey,
      ...(token ? { 'X-Player-Token': token, Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message ?? `Titan returned ${response.status}`);
    return data;
  };
  const rate = new Map();
  const server = createServer(async (req, res) => {
    const origin = req.headers.origin;
    const reply = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
      ...(origin && allowed(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
      'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' });
      // Bun's Node compatibility layer does not suppress a body on 204 like Node does.
      // Sending JSON here corrupts persistent HTTP connections after browser preflights.
      res.end(status === 204 ? undefined : JSON.stringify(data)); };
    // Public readiness contains no credentials; the editor can test a hosted realm before deployment.
    if (req.method === 'GET' && req.url === '/health') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      return reply(200, { name: 'Ember Meadow', protocol: 1, gameId: options.gameId, authMode: titan ? 'titan' : 'local', players: world.players.size, capacity: 32 });
    }
    if (!allowed(origin)) return reply(403, { message: 'Origin is not in ALLOWED_ORIGINS.' });
    if (req.method === 'OPTIONS') return reply(204, {});
    if (req.method !== 'POST' || req.url !== '/auth') return reply(404, { message: 'Not found' });
    const ip = req.socket.remoteAddress ?? '';
    const window = rate.get(ip) ?? { until: 0, count: 0 };
    if (Date.now() > window.until) { window.until = Date.now() + 60000; window.count = 0; }
    rate.set(ip, window);
    if (++window.count > 20 || pendingConnections >= 32) return reply(429, { message: 'Too many login attempts. Try again in a minute.' });
    pendingConnections++;
    try {
      let bytes = 0; const chunks = [];
      for await (const chunk of req) { bytes += chunk.length; if (bytes > 4096) { reply(413, { message: 'Request too large.' }); return; } chunks.push(chunk); }
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const mode = body?.mode;
      if (!['guest', 'login', 'register'].includes(mode)) throw new Error('Choose guest, login, or register.');
      let id, credential, titanToken;
      let name = cleanName(body.name);
      if (titan) {
        const action = mode === 'guest' ? 'anonymous' : mode;
        const auth = await titanRequest(`game-auth/${action}`, mode === 'guest'
          ? { ...(typeof body.resume === 'string' ? { uuid: body.resume } : {}) }
          : { email: body.email, password: body.password, display_name: name });
        if (typeof auth.token !== 'string') throw new Error('Titan did not return a player token.');
        titanToken = auth.token; credential = auth.token; id = hash(`titan:${auth.token}`);
        name = cleanName(auth.player?.display_name || name);
      } else {
        if (mode !== 'guest') throw new Error('Email accounts require Titan. Choose Local adventurer.');
        credential = typeof body.resume === 'string' && /^[a-f0-9]{64}$/.test(body.resume) && records[hash(body.resume)] ? body.resume : randomBytes(32).toString('hex');
        id = hash(credential);
      }
      records[id] ??= { name, progress: null };
      name = records[id].name;
      await persist();
      const ticket = randomBytes(32).toString('hex');
      sessions.set(ticket, { id, name, titanToken, expires: Date.now() + 30000 });
      reply(200, { ticket, resume: mode === 'guest' ? credential : undefined, name });
    } catch (error) { reply(400, { message: error.message || 'Login failed.' }); }
    finally { pendingConnections--; }
  });
  server.requestTimeout = 15000;
  const wss = new WebSocketServer({ server, maxPayload: 2048, perMessageDeflate: false });
  wss.on('error', () => {}); // Listen failures are reported by server.listen's rejected promise.
  wss.on('connection', (ws, req) => {
    if (!allowed(req.headers.origin) || req.url !== '/realm' || wss.clients.size > 40) { ws.close(1008, 'Realm unavailable'); return; }
    let session; let burst = 0; let windowAt = Date.now(); let saving = false;
    const authTimer = setTimeout(() => ws.close(1008, 'Login timed out'), 5000);
    const send = data => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); };
    ws.on('error', () => {});
    ws.on('message', async bytes => {
      try {
        if (Date.now() - windowAt > 1000) { windowAt = Date.now(); burst = 0; }
        if (++burst > 45) { ws.close(1008, 'Too many commands'); return; }
        const command = JSON.parse(bytes.toString());
        if (!session) {
          if (command?.type !== 'join' || typeof command.ticket !== 'string') throw new Error('Authenticate before joining.');
          const ticket = sessions.get(command.ticket); sessions.delete(command.ticket);
          if (!ticket || ticket.expires < Date.now()) throw new Error('Login expired. Please reconnect.');
          if (world.players.size >= 32) throw new Error('The realm is full.');
          if (peers.has(ticket.id)) throw new Error('This character is already connected. Use another browser profile for a second player.');
          session = ticket; clearTimeout(authTimer);
          world.join(session.id, session.name, records[session.id]?.progress); peers.set(session.id, ws);
          send({ type: 'snapshot', data: world.snapshot(session.id) }); return;
        }
        if (command?.type === 'save') {
          if (saving) return; saving = true;
          try {
            await persist();
            if (session.titanToken) await titanRequest('game-saves/ember-meadow', { data: saveHero(world.players.get(session.id)) }, session.titanToken, 'PUT');
            send({ type: 'notice', message: session.titanToken ? 'Progress saved to the realm and Titan cloud.' : 'Progress saved to the realm.' });
          } finally { saving = false; }
        } else world.command(session.id, command);
      } catch (error) { send({ type: 'error', message: error.message }); if (!session) ws.close(1008, 'Join failed'); }
    });
    ws.on('close', () => {
      clearTimeout(authTimer);
      if (!session) return;
      const hero = world.players.get(session.id);
      if (hero && records[session.id]) records[session.id].progress = saveHero(hero);
      world.leave(session.id); peers.delete(session.id); persist().catch(reportSaveError);
    });
  });
  await new Promise((done, reject) => { server.once('error', reject); server.listen(port, host, done); });
  const tick = setInterval(() => {
    world.tick(0.05);
    for (const [id, peer] of peers) {
      if (peer.bufferedAmount > 128 * 1024) { peer.close(1013, 'Connection too slow'); continue; }
      if (peer.readyState === WebSocket.OPEN) peer.send(JSON.stringify({ type: 'snapshot', data: world.snapshot(id) }));
    }
  }, 50);
  const autosave = setInterval(() => {
    persist().catch(reportSaveError);
    for (const [key, session] of sessions) if (session.expires < Date.now()) sessions.delete(key);
    for (const [key, entry] of rate) if (entry.until < Date.now()) rate.delete(key);
  }, 10000);
  return { server, world, port: server.address().port, close: async () => {
    clearInterval(tick); clearInterval(autosave); await persist();
    for (const ws of wss.clients) ws.close(1001, 'Realm stopping');
    const force = setTimeout(() => { for (const ws of wss.clients) { try { ws.terminate(); } catch {} } }, 500);
    try {
      await new Promise(done => wss.close(done));
      await new Promise(done => {
        // Bun 1.1.x can close the listener without calling back after outgoing Titan fetches.
        // Finish pending HTTP work briefly, then release owned sockets and complete shutdown.
        const forceHttp = setTimeout(() => { server.closeAllConnections?.(); done(); }, 1000);
        server.close(() => { clearTimeout(forceHttp); done(); });
        server.closeIdleConnections?.();
      });
      await saveQueue;
    }
    finally { clearTimeout(force); }
  } };
}
