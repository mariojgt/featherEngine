import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('AI settings persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('migrates remote-only settings and deep-merges the new local default', async () => {
    localStorage.setItem('nodeforge.ai', JSON.stringify({
      version: 0,
      state: {
        provider: 'anthropic',
        apiKeys: { openai: 'open-key', anthropic: 'claude-key', google: '' },
        models: { openai: 'gpt-old', anthropic: 'claude-old', google: 'gemini-old' },
        smartRouting: false,
      },
    }));

    const [{ useAISettings }, { DEFAULT_MODELS }] = await Promise.all([
      import('../aiSettingsStore'),
      import('../../ai/providers'),
    ]);
    const settings = useAISettings.getState();
    expect(settings.provider).toBe('anthropic');
    expect(settings.apiKeys.anthropic).toBe('claude-key');
    expect(settings.models).toMatchObject({
      openai: 'gpt-old',
      anthropic: 'claude-old',
      google: 'gemini-old',
      local: DEFAULT_MODELS.local,
    });
  });

  it('uses Local without an API key and persists choices only', async () => {
    const { useAISettings } = await import('../aiSettingsStore');
    useAISettings.getState().setProvider('local');
    expect(useAISettings.getState().activeKey()).toBe('');

    const persisted = JSON.parse(localStorage.getItem('nodeforge.ai') ?? '{}') as { state?: Record<string, unknown> };
    expect(persisted.state?.provider).toBe('local');
    expect(persisted.state).not.toHaveProperty('runtime');
    expect(persisted.state).not.toHaveProperty('worker');
    expect(persisted.state).not.toHaveProperty('progress');
  });

  it('preserves a selected model from the curated Local AI catalog', async () => {
    const modelId = 'onnx-community/Qwen3-1.7B-ONNX';
    localStorage.setItem('nodeforge.ai', JSON.stringify({
      version: 1,
      state: { provider: 'local', models: { local: modelId } },
    }));

    const { useAISettings } = await import('../aiSettingsStore');
    expect(useAISettings.getState().models.local).toBe(modelId);
  });

  it('falls back safely when a removed or arbitrary local model id was persisted', async () => {
    localStorage.setItem('nodeforge.ai', JSON.stringify({
      version: 1,
      state: { provider: 'local', models: { local: 'someone/random-unsupported-model' } },
    }));

    const [{ useAISettings }, { DEFAULT_MODELS }] = await Promise.all([
      import('../aiSettingsStore'),
      import('../../ai/providers'),
    ]);
    expect(useAISettings.getState().models.local).toBe(DEFAULT_MODELS.local);
  });
});
