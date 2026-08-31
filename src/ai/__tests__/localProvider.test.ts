import { describe, expect, it, vi } from 'vitest';

const localModel = { provider: 'test-local', modelId: 'local-test' };
const getLocalLanguageModel = vi.fn(async () => localModel);

vi.mock('../local/localModelManager', () => ({ getLocalLanguageModel }));

import {
  DEFAULT_MODELS,
  FAST_MODELS,
  PROVIDERS,
  isRemoteProvider,
  resolveModel,
  resolveRemoteModel,
} from '../providers';
import { LOCAL_MODELS } from '../local/localModelCatalog';

describe('AI provider selection', () => {
  it('keeps remote provider metadata and fast routes remote-only', () => {
    expect(PROVIDERS.openai).toMatchObject({ kind: 'remote', label: 'OpenAI' });
    expect(PROVIDERS.anthropic).toMatchObject({ kind: 'remote' });
    expect(PROVIDERS.google).toMatchObject({ kind: 'remote' });
    expect(FAST_MODELS).toEqual({
      openai: 'gpt-5-mini',
      anthropic: 'claude-haiku-4-5',
      google: 'gemini-2.5-flash',
    });
    expect(isRemoteProvider('openai')).toBe(true);
    expect(isRemoteProvider('local')).toBe(false);
  });

  it('exposes local as a keyless curated provider', () => {
    expect(PROVIDERS.local).toEqual({
      id: 'local',
      kind: 'local',
      label: 'Local AI (WebGPU)',
      models: LOCAL_MODELS.map((model) => model.id),
    });
    expect('keysUrl' in PROVIDERS.local).toBe(false);
  });

  it('keeps cloud resolution synchronous at its own boundary', () => {
    const model = resolveRemoteModel('openai', 'test-key', 'gpt-test');
    expect((model as { modelId: string }).modelId).toBe('gpt-test');
  });

  it('resolves Local only through the local manager without an API key', async () => {
    const model = await resolveModel({ provider: 'local', modelId: DEFAULT_MODELS.local });
    expect(model).toBe(localModel);
    expect(getLocalLanguageModel).toHaveBeenCalledWith(DEFAULT_MODELS.local);
  });
});
