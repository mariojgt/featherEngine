import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import { DEFAULT_LOCAL_MODEL_ID, LOCAL_MODELS } from './local/localModelCatalog';

export type RemoteProviderId = 'openai' | 'anthropic' | 'google';
export type ProviderId = RemoteProviderId | 'local';

interface BaseProviderInfo {
  id: ProviderId;
  label: string;
  models: string[];
}

export interface RemoteProviderInfo extends BaseProviderInfo {
  id: RemoteProviderId;
  kind: 'remote';
  /** Where the user creates an API key. */
  keysUrl: string;
}

export interface LocalProviderInfo extends BaseProviderInfo {
  id: 'local';
  kind: 'local';
}

export type ProviderInfo = RemoteProviderInfo | LocalProviderInfo;

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  openai: {
    id: 'openai',
    kind: 'remote',
    label: 'OpenAI',
    keysUrl: 'https://platform.openai.com/api-keys',
    // Suggestions only — the model field is free-text so you can always type the newest id.
    models: ['gpt-5', 'gpt-5-mini', 'gpt-4.1', 'gpt-4o', 'o4-mini'],
  },
  anthropic: {
    id: 'anthropic',
    kind: 'remote',
    label: 'Anthropic (Claude)',
    keysUrl: 'https://console.anthropic.com/settings/keys',
    models: ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
  },
  google: {
    id: 'google',
    kind: 'remote',
    label: 'Google (Gemini)',
    keysUrl: 'https://aistudio.google.com/app/apikey',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
  },
  local: {
    id: 'local',
    kind: 'local',
    label: 'Local AI (WebGPU)',
    models: LOCAL_MODELS.map((model) => model.id),
  },
};

export const DEFAULT_MODELS: Record<ProviderId, string> = {
  openai: PROVIDERS.openai.models[0],
  anthropic: PROVIDERS.anthropic.models[0],
  google: PROVIDERS.google.models[0],
  local: DEFAULT_LOCAL_MODEL_ID,
};

/** Each provider's fast/cheap tier, used by smart routing for simple read-only questions
 *  (e.g. Haiku 4.5 is ~1/5th the per-token price of Opus). */
export const FAST_MODELS: Record<RemoteProviderId, string> = {
  openai: 'gpt-5-mini',
  anthropic: 'claude-haiku-4-5',
  google: 'gemini-2.5-flash',
};

export const isRemoteProvider = (provider: ProviderId): provider is RemoteProviderId => provider !== 'local';

/**
 * Build a configured AI SDK model for a BYO-key, browser-only setup.
 * All requests go directly browser -> provider with the user's key.
 */
export function resolveRemoteModel(provider: RemoteProviderId, apiKey: string, model: string): LanguageModel {
  switch (provider) {
    case 'openai':
      return createOpenAI({ apiKey })(model);
    case 'anthropic':
      // Anthropic requires an explicit opt-in header for direct browser calls.
      return createAnthropic({
        apiKey,
        headers: { 'anthropic-dangerous-direct-browser-access': 'true' },
      })(model);
    case 'google':
      return createGoogleGenerativeAI({ apiKey })(model);
  }
}

export type ResolveModelOptions =
  | { provider: RemoteProviderId; apiKey: string; modelId: string }
  | { provider: 'local'; modelId: string };

/**
 * Resolve one AI SDK LanguageModel regardless of where inference runs. The local dependency is
 * dynamically imported so cloud-only users do not download the Transformers.js runtime bundle.
 */
export async function resolveModel(options: ResolveModelOptions): Promise<LanguageModel> {
  if (options.provider === 'local') {
    const { getLocalLanguageModel } = await import('./local/localModelManager');
    return getLocalLanguageModel(options.modelId);
  }
  return resolveRemoteModel(options.provider, options.apiKey, options.modelId);
}
