import type { Server } from 'node:http';
import type { RealmWorld } from './world.mjs';
export interface RealmOptions { gameId?: string; host?: string; port?: number; dataFile?: string; titanUrl?: string; gameKey?: string; origins?: string }
export function startRealm(options?: RealmOptions): Promise<{ server: Server; world: RealmWorld; port: number; close(): Promise<void> }>;
