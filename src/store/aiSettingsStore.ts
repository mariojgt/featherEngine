import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_MODELS, type ProviderId } from '../ai/providers';

interface AISettingsState {
  provider: ProviderId;
  /** API key per provider, kept in localStorage (browser-only / BYO-key tool). */
  apiKeys: Record<ProviderId, string>;
  /** Selected model id per provider. */
  models: Record<ProviderId, string>;
  /** Smart routing: answer short read-only questions with the provider's fast/cheap model
   *  (FAST_MODELS) instead of the selected one. Building/editing always uses the selected model. */
  smartRouting: boolean;
  setProvider: (provider: ProviderId) => void;
  setApiKey: (provider: ProviderId, key: string) => void;
  setModel: (provider: ProviderId, model: string) => void;
  setSmartRouting: (value: boolean) => void;
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
      smartRouting: true,
      setProvider: (provider) => set({ provider }),
      setApiKey: (provider, key) => set((state) => ({ apiKeys: { ...state.apiKeys, [provider]: key } })),
      setModel: (provider, model) => set((state) => ({ models: { ...state.models, [provider]: model } })),
      setSmartRouting: (smartRouting) => set({ smartRouting }),
      activeKey: () => get().apiKeys[get().provider] ?? '',
      activeModel: () => get().models[get().provider] ?? DEFAULT_MODELS[get().provider],
    }),
    { name: 'nodeforge.ai' },
  ),
);
