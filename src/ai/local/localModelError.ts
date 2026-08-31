import type { LocalModelDefinition } from './localModelCatalog';

export type LocalModelErrorCode =
  | 'resource-limit'
  | 'network'
  | 'model-data'
  | 'runtime-changed'
  | 'runtime-failure';

export type LocalModelErrorRecovery =
  | 'use-recommended-model'
  | 'retry'
  | 'clear-cache'
  | 'reload';

export interface LocalModelFailure {
  code: LocalModelErrorCode;
  message: string;
  recovery: LocalModelErrorRecovery;
  /** Kept for diagnostics only. Never render this raw runtime string in the settings UI. */
  technicalDetail: string;
}

const errorDetail = (error: unknown) =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown Local AI error';

export function classifyLocalModelError(
  error: unknown,
  definition: LocalModelDefinition,
): LocalModelFailure {
  const technicalDetail = errorDetail(error);

  if (/dynamically imported module|Outdated Optimize Dep|504 \(Outdated Optimize Dep\)/i.test(technicalDetail)) {
    return {
      code: 'runtime-changed',
      message: 'Feather\'s Local AI runtime changed while this development session was open. Reload Feather, then retry.',
      recovery: 'reload',
      technicalDetail,
    };
  }

  if (
    /\bAborted\(\)|out of memory|memory access out of bounds|allocation failed|Failed to generate kernel|buffer size|device lost/i
      .test(technicalDetail)
  ) {
    return {
      code: 'resource-limit',
      message: `${definition.label} could not initialize within this browser's WebGPU memory limits. Use the recommended Qwen3 0.6B model, or clear partial model data and retry.`,
      recovery: 'use-recommended-model',
      technicalDetail,
    };
  }

  if (/failed to fetch|networkerror|network request|load failed|fetch.*failed|offline/i.test(technicalDetail)) {
    return {
      code: 'network',
      message: `The ${definition.label} download could not be completed. Check the connection and retry; clear the local cache if a partial download keeps failing.`,
      recovery: 'retry',
      technicalDetail,
    };
  }

  if (/onnx|protobuf|invalid graph|model data|unexpected end|corrupt|external data/i.test(technicalDetail)) {
    return {
      code: 'model-data',
      message: `${definition.label}'s cached model data could not be loaded. Clear the local cache, then download it again.`,
      recovery: 'clear-cache',
      technicalDetail,
    };
  }

  return {
    code: 'runtime-failure',
    message: `${definition.label} could not be loaded. Retry once, or clear its cached data and use the recommended model.`,
    recovery: 'retry',
    technicalDetail,
  };
}
