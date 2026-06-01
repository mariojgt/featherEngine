import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

export type ProviderId = 'openai' | 'anthropic' | 'google';

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  /** Where the user creates an API key. */
  keysUrl: string;
  models: string[];
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  openai: {
    id: 'openai',
    label: 'OpenAI',
    keysUrl: 'https://platform.openai.com/api-keys',
    // Suggestions only — the model field is free-text so you can always type the newest id.
    models: ['gpt-5', 'gpt-5-mini', 'gpt-4.1', 'gpt-4o', 'o4-mini'],
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    keysUrl: 'https://console.anthropic.com/settings/keys',
    models: ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
  },
  google: {
    id: 'google',
    label: 'Google (Gemini)',
    keysUrl: 'https://aistudio.google.com/app/apikey',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
  },
};

export const DEFAULT_MODELS: Record<ProviderId, string> = {
  openai: PROVIDERS.openai.models[0],
  anthropic: PROVIDERS.anthropic.models[0],
  google: PROVIDERS.google.models[0],
};

/**
 * Build a configured AI SDK model for a BYO-key, browser-only setup.
 * All requests go directly browser -> provider with the user's key.
 */
export function resolveModel(provider: ProviderId, apiKey: string, model: string): LanguageModel {
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
    default:
      throw new Error(`Unknown provider: ${provider as string}`);
  }
}
