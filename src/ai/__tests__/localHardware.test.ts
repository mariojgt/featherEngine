import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateLocalPrefillTokenBudget, detectLocalAIHardware } from '../local/localHardware';

const setGPU = (value: unknown) =>
  Object.defineProperty(navigator, 'gpu', { configurable: true, value });

describe('Local AI WebGPU detection', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
  });

  afterEach(() => {
    setGPU(undefined);
    vi.restoreAllMocks();
  });

  it('reports a missing WebGPU API', async () => {
    setGPU(undefined);
    await expect(detectLocalAIHardware()).resolves.toMatchObject({ state: 'unavailable', shaderF16: false });
  });

  it('reports a missing adapter', async () => {
    setGPU({ requestAdapter: vi.fn(async () => null) });
    await expect(detectLocalAIHardware()).resolves.toMatchObject({
      state: 'unavailable',
      reason: 'No compatible GPU adapter is available.',
    });
  });

  it('requires shader-f16 for the q4f16 catalog model', async () => {
    setGPU({ requestAdapter: vi.fn(async () => ({ features: new Set<string>() })) });
    await expect(detectLocalAIHardware()).resolves.toMatchObject({
      state: 'unavailable',
      shaderF16: false,
    });
  });

  it('accepts a WebGPU adapter with shader-f16', async () => {
    setGPU({ requestAdapter: vi.fn(async () => ({ features: new Set(['shader-f16']) })) });
    await expect(detectLocalAIHardware()).resolves.toEqual({
      state: 'available',
      shaderF16: true,
      prefillTokenBudget: 512,
      maxBufferSize: undefined,
      maxStorageBufferBindingSize: undefined,
    });
  });

  it('derives conservative Qwen prefill tiers from WebGPU buffer limits', () => {
    expect(calculateLocalPrefillTokenBudget(2 ** 30, 2 ** 30)).toBe(1024);
    expect(calculateLocalPrefillTokenBudget(512 * 2 ** 20, 512 * 2 ** 20)).toBe(512);
    expect(calculateLocalPrefillTokenBudget(256 * 2 ** 20, 256 * 2 ** 20)).toBe(256);
  });

  it('turns adapter errors into a recoverable unavailable state', async () => {
    setGPU({ requestAdapter: vi.fn(async () => { throw new Error('GPU process unavailable'); }) });
    await expect(detectLocalAIHardware()).resolves.toMatchObject({
      state: 'unavailable',
      reason: 'GPU process unavailable',
    });
  });
});
