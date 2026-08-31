import type { LocalHardwareStatus, LocalStorageEstimate } from './localAI.types';

interface GPUFeatureSetLike {
  has: (feature: string) => boolean;
}

interface GPUAdapterLike {
  features?: GPUFeatureSetLike;
  limits?: {
    maxBufferSize?: number;
    maxStorageBufferBindingSize?: number;
  };
}

interface NavigatorWithGPU extends Navigator {
  gpu?: {
    requestAdapter: () => Promise<GPUAdapterLike | null>;
  };
}

// The official Qwen3 ONNX graphs currently emit float32 logits for every prompt token. Keep the
// largest single logits buffer below 75% of the adapter's usable buffer ceiling. The tiering avoids
// advertising a brittle, device-specific value and leaves room for weights, KV cache and scratch.
const QWEN3_VOCAB_SIZE = 151_936;
const FLOAT32_BYTES = 4;
const PREFILL_BUDGET_TIERS = [1024, 512, 256] as const;

export function calculateLocalPrefillTokenBudget(
  maxBufferSize?: number,
  maxStorageBufferBindingSize?: number,
): number {
  const limits = [maxBufferSize, maxStorageBufferBindingSize].filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0,
  );
  if (!limits.length) return 512;

  const usable = Math.min(...limits);
  const rawBudget = Math.floor((usable * 0.75) / (QWEN3_VOCAB_SIZE * FLOAT32_BYTES));
  return PREFILL_BUDGET_TIERS.find((tier) => tier <= rawBudget) ?? PREFILL_BUDGET_TIERS.at(-1)!;
}

export async function detectLocalAIHardware(): Promise<LocalHardwareStatus> {
  if (typeof navigator === 'undefined') {
    return { state: 'unavailable', reason: 'WebGPU is only available in a supported browser or app.', shaderF16: false };
  }

  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return { state: 'unavailable', reason: 'WebGPU requires HTTPS, localhost, or the desktop app.', shaderF16: false };
  }

  const gpu = (navigator as NavigatorWithGPU).gpu;
  if (!gpu) {
    return { state: 'unavailable', reason: 'This browser or device does not expose WebGPU.', shaderF16: false };
  }

  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) {
      return { state: 'unavailable', reason: 'No compatible GPU adapter is available.', shaderF16: false };
    }

    const shaderF16 = adapter.features?.has('shader-f16') ?? false;
    if (!shaderF16) {
      return {
        state: 'unavailable',
        reason: 'This GPU does not expose shader-f16, which the recommended local model requires.',
        shaderF16,
      };
    }

    const maxBufferSize = adapter.limits?.maxBufferSize;
    const maxStorageBufferBindingSize = adapter.limits?.maxStorageBufferBindingSize;
    return {
      state: 'available',
      shaderF16,
      prefillTokenBudget: calculateLocalPrefillTokenBudget(maxBufferSize, maxStorageBufferBindingSize),
      maxBufferSize,
      maxStorageBufferBindingSize,
    };
  } catch (error) {
    return {
      state: 'unavailable',
      reason: error instanceof Error ? error.message : 'WebGPU adapter detection failed.',
      shaderF16: false,
    };
  }
}

export async function getLocalStorageEstimate(): Promise<LocalStorageEstimate> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return {};
  try {
    const estimate = await navigator.storage.estimate();
    return { usage: estimate.usage, quota: estimate.quota };
  } catch {
    return {};
  }
}
