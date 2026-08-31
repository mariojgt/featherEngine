import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FEATHER_LOCAL_AI_CACHE,
  clearLocalModelCache,
  isLocalModelCached,
  listCachedLocalModelIds,
  markLocalModelCached,
} from '../localCache';

describe('Local AI owned cache', () => {
  const keys = [
    { url: 'https://huggingface.co/onnx-community/Qwen3-0.6B-ONNX/resolve/main/onnx/model_q4f16.onnx' },
  ] as Request[];
  const cache = { keys: vi.fn(async () => keys) };
  const cacheStorage = {
    has: vi.fn(async () => true),
    open: vi.fn(async () => cache),
    delete: vi.fn(async () => true),
  };

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.stubGlobal('caches', cacheStorage);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('reports only model markers that still have bytes in Feather cache storage', async () => {
    markLocalModelCached('onnx-community/Qwen3-0.6B-ONNX');
    markLocalModelCached('onnx-community/Qwen3-4B-ONNX');

    await expect(listCachedLocalModelIds()).resolves.toEqual(['onnx-community/Qwen3-0.6B-ONNX']);
    await expect(isLocalModelCached('onnx-community/Qwen3-4B-ONNX')).resolves.toBe(false);
  });

  it('clears only Feather local-model storage and its consent markers', async () => {
    markLocalModelCached('onnx-community/Qwen3-0.6B-ONNX');
    await clearLocalModelCache();

    expect(cacheStorage.delete).toHaveBeenCalledWith(FEATHER_LOCAL_AI_CACHE);
    await expect(listCachedLocalModelIds()).resolves.toEqual([]);
  });
});
