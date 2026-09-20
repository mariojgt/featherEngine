import { create } from 'zustand';
/** Editor-only connection state. Never persisted to the project or game export. */
export interface TitanRealmStatus { running: boolean; url?: string; gameId?: string; storageId?: string; authMode?: 'local' | 'titan' }
export const useTitanPreview = create<TitanRealmStatus>(() => ({ running: false }));
