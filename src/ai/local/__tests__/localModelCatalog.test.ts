import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCAL_MODEL_ID, LOCAL_MODELS, getLocalModelDefinition } from '../localModelCatalog';

describe('Local model catalog', () => {
  it('offers unique, curated tool-capable WebGPU models across useful tiers', () => {
    expect(new Set(LOCAL_MODELS.map((model) => model.id)).size).toBe(LOCAL_MODELS.length);
    expect(LOCAL_MODELS.length).toBeGreaterThanOrEqual(5);
    expect(LOCAL_MODELS.every((model) => model.device === 'webgpu' && model.dtype === 'q4f16')).toBe(true);
    expect(LOCAL_MODELS.every((model) => model.toolCalling)).toBe(true);
    expect(new Set(LOCAL_MODELS.map((model) => model.family))).toEqual(new Set(['Qwen', 'Gemma', 'Liquid']));
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
