import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LOCAL_MODEL_ID, LOCAL_MODELS } from '../localModelCatalog';

const mocks = vi.hoisted(() => ({
  cachedIds: new Set<string>(),
  createSession: vi.fn(async (onProgress?: (progress: number) => void) => {
    onProgress?.(0.4);
    onProgress?.(1);
  }),
  transformersJS: vi.fn(),
  clearCache: vi.fn(async () => {}),
  markCached: vi.fn(),
}));

vi.mock('@browser-ai/transformers-js', () => ({
  transformersJS: mocks.transformersJS,
}));

vi.mock('../localHardware', () => ({
  detectLocalAIHardware: vi.fn(async () => ({ state: 'available', shaderF16: true })),
  getLocalStorageEstimate: vi.fn(async () => ({ usage: 1024, quota: 4096 })),
}));

vi.mock('../localCache', () => ({
  clearLocalModelCache: vi.fn(async () => {
    mocks.cachedIds.clear();
    await mocks.clearCache();
  }),
  isLocalModelCached: vi.fn(async (modelId: string) => mocks.cachedIds.has(modelId)),
  listCachedLocalModelIds: vi.fn(async () => [...mocks.cachedIds]),
  markLocalModelCached: mocks.markCached,
}));

class FakeWorker {
  static instances: FakeWorker[] = [];
  messages: unknown[] = [];
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(message: unknown) {
    this.messages.push(message);
  }

  terminate() {
    this.terminated = true;
  }
}

describe('Local model manager', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.cachedIds.clear();
    FakeWorker.instances = [];
    vi.stubGlobal('Worker', FakeWorker);
    mocks.markCached.mockImplementation((modelId: string) => mocks.cachedIds.add(modelId));
    mocks.transformersJS.mockImplementation((modelId: string) => ({
      createSessionWithProgress: mocks.createSession,
      provider: 'transformers-js',
      modelId,
    }));
  });

  it('downloads explicitly, reports progress, and reuses one ready runtime', async () => {
    const [{ downloadAndLoadLocalModel, getLocalLanguageModel }, { useLocalAIStore }] = await Promise.all([
      import('../localModelManager'),
      import('../../../store/localAIStore'),
    ]);

    const first = await downloadAndLoadLocalModel(DEFAULT_LOCAL_MODEL_ID);
    const second = await getLocalLanguageModel(DEFAULT_LOCAL_MODEL_ID);

    expect(second).toBe(first);
    expect(FakeWorker.instances).toHaveLength(1);
    expect(mocks.createSession).toHaveBeenCalledTimes(1);
    expect(mocks.markCached).toHaveBeenCalledWith(DEFAULT_LOCAL_MODEL_ID);
    expect(useLocalAIStore.getState().runtime).toMatchObject({ state: 'ready', progress: 1 });
  });

  it('never starts an unapproved first download from the chat path', async () => {
    const [{ getLocalLanguageModel }, { useLocalAIStore }] = await Promise.all([
      import('../localModelManager'),
      import('../../../store/localAIStore'),
    ]);
    await expect(getLocalLanguageModel(DEFAULT_LOCAL_MODEL_ID)).rejects.toThrow('Download & load');
    expect(FakeWorker.instances).toHaveLength(0);
    expect(useLocalAIStore.getState().runtime.state).toBe('not-installed');
  });

  it('terminates the worker on unload and clears only the owned cache', async () => {
    const manager = await import('../localModelManager');
    mocks.cachedIds.add(DEFAULT_LOCAL_MODEL_ID);
    await manager.downloadAndLoadLocalModel(DEFAULT_LOCAL_MODEL_ID);
    await manager.unloadLocalModel();
    expect(FakeWorker.instances[0].terminated).toBe(true);

    await manager.clearAllLocalAIModels();
    expect(mocks.clearCache).toHaveBeenCalledTimes(1);
  });

  it('keeps only one model on the GPU and terminates it when the selection changes', async () => {
    const manager = await import('../localModelManager');
    const nextModelId = LOCAL_MODELS[1].id;

    await manager.downloadAndLoadLocalModel(DEFAULT_LOCAL_MODEL_ID);
    await manager.downloadAndLoadLocalModel(nextModelId);

    expect(FakeWorker.instances).toHaveLength(2);
    expect(FakeWorker.instances[0].terminated).toBe(true);
    expect(FakeWorker.instances[1].terminated).toBe(false);
    expect(mocks.transformersJS).toHaveBeenLastCalledWith(
      nextModelId,
      expect.objectContaining({ device: 'webgpu', dtype: 'q4f16' }),
    );
  });

  it('recovers to an error state when worker model initialization fails', async () => {
    mocks.createSession.mockRejectedValueOnce(new Error('Model graph failed'));
    const [{ downloadAndLoadLocalModel }, { useLocalAIStore }] = await Promise.all([
      import('../localModelManager'),
      import('../../../store/localAIStore'),
    ]);
    await expect(downloadAndLoadLocalModel(DEFAULT_LOCAL_MODEL_ID)).rejects.toThrow('Model graph failed');
    expect(FakeWorker.instances[0].terminated).toBe(true);
    expect(useLocalAIStore.getState().runtime).toMatchObject({
      state: 'error',
      errorCode: 'runtime-failure',
      technicalError: 'Model graph failed',
    });
    expect(useLocalAIStore.getState().runtime.error).not.toContain('Model graph failed');
  });

  it('turns opaque WebAssembly aborts into an actionable resource-limit error', async () => {
    mocks.createSession.mockRejectedValueOnce(new Error('Aborted(). Build with -sASSERTIONS for more info.'));
    const [{ downloadAndLoadLocalModel }, { useLocalAIStore }] = await Promise.all([
      import('../localModelManager'),
      import('../../../store/localAIStore'),
    ]);
    await expect(downloadAndLoadLocalModel(DEFAULT_LOCAL_MODEL_ID)).rejects.toThrow('Aborted');
    expect(useLocalAIStore.getState().runtime).toMatchObject({
      state: 'error',
      errorCode: 'resource-limit',
      errorRecovery: 'use-recommended-model',
    });
    expect(useLocalAIStore.getState().runtime.error).toContain('WebGPU memory limits');
    expect(useLocalAIStore.getState().runtime.error).not.toContain('ASSERTIONS');
  });
});
