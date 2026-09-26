import { readFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { startRealm } from './server.mjs';

/** Executable entry point; the editor/exporter writes this configuration, never the player. */
const arg = name => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
async function main() {
const configFile = resolve(arg('--config') ?? 'realm-config.json');
let config;
try { config = JSON.parse(await readFile(configFile, 'utf8')); }
catch (error) { if (arg('--config') || error.code !== 'ENOENT') throw error; config = { version: 1, gameId: 'ember-meadow', host: '127.0.0.1', port: 8787 }; }
if (config.version !== 1 || typeof config.gameId !== 'string') throw new Error('Invalid realm configuration. Export it again from Titan Backend.');
const local = process.argv.includes('--local');
const id = createHash('sha256').update(config.gameId).digest('hex').slice(0, 24);
const dataFile = local && config.dataFile ? config.dataFile : process.env.REALM_DATA ?? join(homedir(), '.feather-realms', id, 'players.json');
await mkdir(dirname(dataFile), { recursive: true });
const realm = await startRealm({
  gameId: config.gameId,
  host: local ? '127.0.0.1' : process.env.HOST ?? config.host ?? '127.0.0.1',
  port: local ? 0 : Number(process.env.PORT ?? config.port ?? 8787), dataFile,
  titanUrl: config.titanUrl ?? process.env.TITAN_URL ?? '', gameKey: config.gameKey ?? process.env.TITAN_GAME_KEY ?? '',
  origins: config.origins ?? process.env.ALLOWED_ORIGINS,
});
console.log(JSON.stringify({ type: 'ready', running: true, url: `http://127.0.0.1:${realm.port}`, gameId: config.gameId, ...(local ? { storageId: config.storageId } : {}), authMode: (config.titanUrl ?? process.env.TITAN_URL) ? 'titan' : 'local' }));
let closing = false;
async function close() { if (closing) return; closing = true; await realm.close(); process.exit(0); }
process.on('SIGINT', close); process.on('SIGTERM', close);
// The managed editor owns stdin: closing the editor also releases its realm, including on Windows.
if (local) { process.stdin.resume(); process.stdin.on('data', close); process.stdin.on('end', close); }
}
main().catch(error => { console.error(`Realm could not start: ${error.message}`); process.exit(1); });
