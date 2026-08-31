import { describe, expect, it } from 'vitest';
import {
  BALANCED_LOCAL_MODEL_ID,
  DEFAULT_LOCAL_MODEL_ID,
  LOCAL_MODELS,
  RETIRED_QWEN3_1_7B_MODEL_ID,
  getLocalModelDefinition,
  normalizeLocalModelId,
} from '../localModelCatalog';

describe('Local model catalog', () => {
  it('offers unique, curated tool-capable WebGPU models across useful tiers', () => {
    expect(new Set(LOCAL_MODELS.map((model) => model.id)).size).toBe(LOCAL_MODELS.length);
    expect(LOCAL_MODELS.length).toBeGreaterThanOrEqual(4);
    expect(LOCAL_MODELS.every((model) => model.device === 'webgpu' && model.dtype === 'q4f16')).toBe(true);
    expect(LOCAL_MODELS.every((model) => model.toolCalling)).toBe(true);
    expect(new Set(LOCAL_MODELS.map((model) => model.family))).toEqual(new Set(['Qwen', 'Gemma', 'Liquid']));
  });

  it('retires the browser-incompatible Qwen3 1.7B artifact and migrates it to the balanced model', () => {
    expect(LOCAL_MODELS.some((model) => model.id === RETIRED_QWEN3_1_7B_MODEL_ID)).toBe(false);
    expect(normalizeLocalModelId(RETIRED_QWEN3_1_7B_MODEL_ID)).toBe(BALANCED_LOCAL_MODEL_ID);
    expect(getLocalModelDefinition(RETIRED_QWEN3_1_7B_MODEL_ID).id).toBe(BALANCED_LOCAL_MODEL_ID);
  });

  it('keeps the smallest proven Qwen model as the recommended default', () => {
    const definition = getLocalModelDefinition(DEFAULT_LOCAL_MODEL_ID);
    expect(definition).toMatchObject({ label: 'Qwen3 0.6B', recommended: true });
    expect(definition.experimental).not.toBe(true);
    expect(LOCAL_MODELS.filter((model) => model.recommended)).toEqual([definition]);
  });

  it('labels unbenchmarked Gemma and high-memory choices as experimental', () => {
    expect(LOCAL_MODELS.find((model) => model.family === 'Gemma')).toMatchObject({
      toolFormat: 'functiongemma',
      experimental: true,
    });
    expect(getLocalModelDefinition('onnx-community/Qwen3-4B-ONNX')).toMatchObject({
      tier: 'advanced',
      experimental: true,
    });
  });
});
