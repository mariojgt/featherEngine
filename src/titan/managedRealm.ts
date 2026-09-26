import { isDesktop } from '../platform';
import { type TitanProjectSettings } from './settings';
import { type TitanRealmStatus, useTitanPreview } from './preview';

export async function managedRealm(action: 'status' | 'start' | 'stop', gameId?: string, settings?: TitanProjectSettings): Promise<TitanRealmStatus> {
  let state: TitanRealmStatus;
  if (isDesktop) {
    const { invoke } = await import('@tauri-apps/api/core');
    state = await invoke('manage_titan_realm', { action, gameId, settings, origin: window.location.origin });
  } else {
    if (!import.meta.env.DEV) throw new Error('Start local realms in the Feather desktop app. For a hosted editor, use your deployed realm address.');
    const response = await fetch(`${import.meta.env.BASE_URL}__feather/titan-realm`, action === 'status' ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, gameId, settings }),
    });
    const data = await response.json(); if (!response.ok) throw new Error(data.message ?? 'Could not manage the local realm.'); state = data;
  }
  useTitanPreview.setState({ url: undefined, gameId: undefined, storageId: undefined, authMode: undefined, ...state });
  return state;
}
