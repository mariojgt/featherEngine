import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  DEFAULT_MODELS,
  type ProviderId,
  type RemoteProviderId,
} from '../ai/providers';
import { normalizeLocalModelId } from '../ai/local/localModelCatalog';

export interface AISettingsState {
  provider: ProviderId;
  /** API key per provider, kept in localStorage (browser-only / BYO-key tool). */
  apiKeys: Record<RemoteProviderId, string>;
  /** Selected model id per provider. */
  models: Record<ProviderId, string>;
  /** Smart routing: answer short read-only questions with the provider's fast/cheap model
   *  (FAST_MODELS) instead of the selected one. Building/editing always uses the selected model. */
  smartRouting: boolean;
  setProvider: (provider: ProviderId) => void;
  setApiKey: (provider: RemoteProviderId, key: string) => void;
  setModel: (provider: ProviderId, model: string) => void;
  setSmartRouting: (value: boolean) => void;
  /** Convenience getters for the active provider. */
  activeKey: () => string;
  activeModel: () => string;
}

type PersistedAISettings = Pick<AISettingsState, 'provider' | 'apiKeys' | 'models' | 'smartRouting'>;

const DEFAULT_API_KEYS: Record<RemoteProviderId, string> = {
  openai: '',
  anthropic: '',
  google: '',
};

export const useAISettings = create<AISettingsState>()(
  persist(
    (set, get) => ({
      provider: 'openai',
      apiKeys: { ...DEFAULT_API_KEYS },
      models: { ...DEFAULT_MODELS },
      smartRouting: true,
      setProvider: (provider) => set({ provider }),
      setApiKey: (provider, key) => set((state) => ({ apiKeys: { ...state.apiKeys, [provider]: key } })),
      setModel: (provider, model) => set((state) => ({
        models: {
          ...state.models,
          [provider]: provider === 'local' ? normalizeLocalModelId(model) : model,
        },
      })),
      setSmartRouting: (smartRouting) => set({ smartRouting }),
      activeKey: () => {
        const provider = get().provider;
        return provider === 'local' ? '' : get().apiKeys[provider] ?? '';
      },
      activeModel: () => {
        const provider = get().provider;
        const model = get().models[provider] ?? DEFAULT_MODELS[provider];
        return provider === 'local' ? normalizeLocalModelId(model) : model;
      },
    }),
    {
      name: 'nodeforge.ai',
      version: 1,
      // Version 0 assumed every provider had an API key. Preserve those cloud choices; `merge`
      // supplies the new local model default without persisting any Worker/session/runtime state.
      migrate: (persisted) => persisted as PersistedAISettings,
      partialize: ({ provider, apiKeys, models, smartRouting }) => ({
        provider,
        apiKeys,
        models,
        smartRouting,
      }),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<PersistedAISettings>;
        const models = { ...current.models, ...(saved.models ?? {}) };
        models.local = normalizeLocalModelId(models.local);
        return {
          ...current,
          ...saved,
          apiKeys: { ...current.apiKeys, ...(saved.apiKeys ?? {}) },
          models,
        };
      },
    },
  ),
);
