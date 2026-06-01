import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_MODELS, type ProviderId } from '../ai/providers';

interface AISettingsState {
  provider: ProviderId;
  /** API key per provider, kept in localStorage (browser-only / BYO-key tool). */
  apiKeys: Record<ProviderId, string>;
  /** Selected model id per provider. */
  models: Record<ProviderId, string>;
  setProvider: (provider: ProviderId) => void;
  setApiKey: (provider: ProviderId, key: string) => void;
  setModel: (provider: ProviderId, model: string) => void;
  /** Convenience getters for the active provider. */
  activeKey: () => string;
  activeModel: () => string;
}

export const useAISettings = create<AISettingsState>()(
  persist(
    (set, get) => ({
      provider: 'openai',
      apiKeys: { openai: '', anthropic: '', google: '' },
      models: { ...DEFAULT_MODELS },
      setProvider: (provider) => set({ provider }),
      setApiKey: (provider, key) => set((state) => ({ apiKeys: { ...state.apiKeys, [provider]: key } })),
      setModel: (provider, model) => set((state) => ({ models: { ...state.models, [provider]: model } })),
      activeKey: () => get().apiKeys[get().provider] ?? '',
      activeModel: () => get().models[get().provider] ?? DEFAULT_MODELS[get().provider],
    }),
    { name: 'nodeforge.ai' },
  ),
);
