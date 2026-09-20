import { create } from 'zustand';
import { RealmWorld, saveHero, type RealmCommand, type RealmSnapshot } from '../../examples/titan-mmo/server/world.mjs';
import { validateHttpUrl } from './client';

interface RealmState { snapshot: RealmSnapshot | null; status: 'idle' | 'connecting' | 'playing' | 'disconnected'; mode: 'solo' | 'online'; message: string }
export const useRealm = create<RealmState>(() => ({ snapshot: null, status: 'idle', mode: 'solo', message: '' }));
let cleanup: (() => void) | undefined;
let send: ((command: RealmCommand) => void) | undefined;
let generation = 0;
let controller: AbortController | undefined;
const storageRead = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const storageWrite = (key: string, data: string) => { localStorage.setItem(key, data); };
export function realmCommand(command: RealmCommand) { send?.(command); }
export function disconnectRealm() {
  generation++; controller?.abort(); controller = undefined;
  const dispose = cleanup; cleanup = undefined; send = undefined; dispose?.();
  useRealm.setState({ snapshot: null, status: 'idle', message: '' });
}
export function startSolo(name: string, namespace: string) {
  disconnectRealm();
  const world = new RealmWorld(); const key = `feather.titan.practice.${namespace}`;
  let saved: unknown;
  try { saved = JSON.parse(storageRead(key) ?? 'null'); } catch { saved = null; }
  world.join('solo', name, saved);
  const save = () => { try { storageWrite(key, JSON.stringify(saveHero(world.players.get('solo')!))); return true; }
    catch { useRealm.setState({ message: 'Browser storage is unavailable. Progress lasts until you leave.' }); return false; } };
  send = command => { if (command.type === 'save') { if (save()) useRealm.setState({ message: 'Practice progress saved on this device.' }); }
    else { world.command('solo', command); if (command.type !== 'move') useRealm.setState({ message: '' }); } };
  useRealm.setState({ mode: 'solo', status: 'playing', snapshot: world.snapshot('solo'), message: '' });
  const tick = setInterval(() => { world.tick(0.05); useRealm.setState({ snapshot: world.snapshot('solo') }); }, 50);
  const autosave = setInterval(save, 5000);
  cleanup = () => { clearInterval(tick); clearInterval(autosave); save(); };
}
export async function connectRealm(url: string, details: { name: string; mode: 'guest' | 'login' | 'register'; email?: string; password?: string }, localStorageId?: string) {
  disconnectRealm(); const run = generation;
  let base: string;
  try { base = validateHttpUrl(url); } catch (error) { useRealm.setState({ status: 'disconnected', message: error instanceof Error ? error.message : 'Invalid realm URL.' }); return; }
  // Managed realms choose a fresh port on restart; their game/connection identity is stable.
  const key = `feather.titan.realm.${localStorageId ? `local.${localStorageId}` : base}`;
  controller = new AbortController(); const signal = controller.signal;
  useRealm.setState({ status: 'connecting', mode: 'online', message: '' });
  const timeout = setTimeout(() => controller?.abort(), 12000);
  try {
    const response = await fetch(`${base}/auth`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...details, ...(details.mode === 'guest' ? { resume: storageRead(key) ?? undefined } : {}) }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message ?? 'Login failed.');
    if (generation !== run) return;
    if (typeof data.ticket !== 'string') throw new Error('The realm returned an invalid login ticket.');
    if (typeof data.resume === 'string') { try { storageWrite(key, data.resume); } catch { /* connection still works without persistence */ } }
    const socket = new WebSocket(`${base.replace(/^http/, 'ws')}/realm`);
    const joinTimeout = setTimeout(() => { socket.close(); if (generation === run) useRealm.setState({ status: 'disconnected', message: 'The realm did not respond. Try again.' }); }, 10000);
    socket.onopen = () => socket.send(JSON.stringify({ type: 'join', ticket: data.ticket }));
    socket.onmessage = event => {
      if (generation !== run) return;
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'snapshot' && message.data?.version === 1 && Array.isArray(message.data.players) && Array.isArray(message.data.enemies)) {
          clearTimeout(joinTimeout); useRealm.setState({ status: 'playing', snapshot: message.data });
        } else if (['notice', 'error'].includes(message.type)) useRealm.setState({ message: String(message.message) });
      } catch { socket.close(1002, 'Invalid realm message'); }
    };
    socket.onclose = () => { clearTimeout(joinTimeout); if (generation === run) { send = undefined; useRealm.setState(s => ({ status: 'disconnected', message: s.message || 'Disconnected. Reconnect to restore your character.' })); } };
    socket.onerror = () => { if (generation === run) useRealm.setState({ message: 'Could not reach the realm. Check the server address and allowed origins.' }); };
    send = command => { if (socket.readyState === WebSocket.OPEN) { socket.send(JSON.stringify(command)); if (command.type !== 'move') useRealm.setState({ message: '' }); } };
    cleanup = () => { clearTimeout(joinTimeout); socket.onclose = null; socket.close(); };
  } catch (error) {
    if (generation === run) useRealm.setState({ status: 'disconnected', message: error instanceof Error && error.name !== 'AbortError' ? error.message : 'Connection timed out. Start the realm server and try again.' });
  } finally { clearTimeout(timeout); }
}
