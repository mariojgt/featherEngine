export type LocalModelState =
  | 'unsupported'
  | 'not-installed'
  | 'downloading'
  | 'installed'
  | 'loading'
  | 'ready'
  | 'error';

export type LocalHardwareState = 'idle' | 'checking' | 'available' | 'unavailable';

export interface LocalHardwareStatus {
  state: LocalHardwareState;
  reason?: string;
  shaderF16: boolean;
  /** Conservative first-pass token ceiling for full-sequence-logit WebGPU graphs. */
  prefillTokenBudget?: number;
  maxBufferSize?: number;
  maxStorageBufferBindingSize?: number;
}

export interface LocalModelRuntimeState {
  modelId: string;
  state: LocalModelState;
  /** Normalized download/load progress in the inclusive range 0..1. */
  progress: number;
  error?: string;
  errorCode?: import('./localModelError').LocalModelErrorCode;
  errorRecovery?: import('./localModelError').LocalModelErrorRecovery;
  /** Raw worker/runtime detail for diagnostics. Do not render directly. */
  technicalError?: string;
}

export interface LocalStorageEstimate {
  usage?: number;
  quota?: number;
}
