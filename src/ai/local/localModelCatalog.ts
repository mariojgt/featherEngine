export interface LocalModelDefinition {
  id: string;
  label: string;
  family: 'Qwen' | 'Gemma' | 'Liquid';
  description: string;
  tier: 'fast' | 'balanced' | 'advanced';
  device: 'webgpu';
  dtype: 'q4f16';
  approximateDownloadMb: number;
  recommendedMemoryGb: number;
  maxOutputTokens: number;
  toolCalling: boolean;
  toolFormat: 'native' | 'functiongemma';
  recommended?: boolean;
  experimental?: boolean;
}

/**
 * Curated rather than free-form: a random Hugging Face text model may not expose a compatible
 * ONNX graph, chat template, quantization, or tool-call format. Add models here only after a real
 * Feather tool benchmark.
 */
export const LOCAL_MODELS: readonly LocalModelDefinition[] = [
  {
    id: 'onnx-community/Qwen3-0.6B-ONNX',
    label: 'Qwen3 0.6B',
    family: 'Qwen',
    description: 'Fast local Feather agent for scene inspection and editor actions.',
    tier: 'fast',
    device: 'webgpu',
    dtype: 'q4f16',
    approximateDownloadMb: 580,
    recommendedMemoryGb: 3,
    maxOutputTokens: 1024,
    toolCalling: true,
    toolFormat: 'native',
    recommended: true,
  },
  {
    id: 'LiquidAI/LFM2.5-1.2B-Instruct-ONNX',
    label: 'LFM2.5 1.2B',
    family: 'Liquid',
    description: 'Balanced on-device agent with native tool use and stronger instruction following.',
    tier: 'balanced',
    device: 'webgpu',
    dtype: 'q4f16',
    approximateDownloadMb: 765,
    recommendedMemoryGb: 4,
    maxOutputTokens: 1280,
    toolCalling: true,
    toolFormat: 'native',
  },
  {
    id: 'onnx-community/Qwen3-1.7B-ONNX',
    label: 'Qwen3 1.7B',
    family: 'Qwen',
    description: 'Higher-quality Qwen agent for multi-step scene and gameplay work.',
    tier: 'balanced',
    device: 'webgpu',
    dtype: 'q4f16',
    approximateDownloadMb: 1440,
    recommendedMemoryGb: 5,
    maxOutputTokens: 1536,
    toolCalling: true,
    toolFormat: 'native',
  },
  {
    id: 'onnx-community/functiongemma-270m-it-ONNX',
    label: 'FunctionGemma 270M',
    family: 'Gemma',
    description: 'Tiny Gemma tool specialist for simple, direct editor actions.',
    tier: 'fast',
    device: 'webgpu',
    dtype: 'q4f16',
    approximateDownloadMb: 450,
    recommendedMemoryGb: 3,
    maxOutputTokens: 512,
    toolCalling: true,
    toolFormat: 'functiongemma',
    experimental: true,
  },
  {
    id: 'onnx-community/Qwen3-4B-ONNX',
    label: 'Qwen3 4B',
    family: 'Qwen',
    description: 'Advanced local agent for harder plans on high-memory GPUs.',
    tier: 'advanced',
    device: 'webgpu',
    dtype: 'q4f16',
    approximateDownloadMb: 2850,
    recommendedMemoryGb: 8,
    maxOutputTokens: 2048,
    toolCalling: true,
    toolFormat: 'native',
    experimental: true,
  },
];

export const DEFAULT_LOCAL_MODEL_ID = LOCAL_MODELS[0].id;

export function getLocalModelDefinition(modelId: string): LocalModelDefinition {
  const definition = LOCAL_MODELS.find((candidate) => candidate.id === modelId);
  if (!definition) throw new Error(`Unsupported local model: ${modelId}`);
  return definition;
}
