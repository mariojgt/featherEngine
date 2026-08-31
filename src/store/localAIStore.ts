import { create } from 'zustand';
import { DEFAULT_LOCAL_MODEL_ID } from '../ai/local/localModelCatalog';
import type {
  LocalHardwareStatus,
  LocalModelRuntimeState,
  LocalStorageEstimate,
} from '../ai/local/localAI.types';

interface LocalAIState {
  hardware: LocalHardwareStatus;
  runtime: LocalModelRuntimeState;
  storage: LocalStorageEstimate;
  cachedModelIds: string[];
}

export const useLocalAIStore = create<LocalAIState>()(() => ({
  hardware: { state: 'idle', shaderF16: false },
  runtime: {
    modelId: DEFAULT_LOCAL_MODEL_ID,
    state: 'not-installed',
    progress: 0,
  },
  storage: {},
  cachedModelIds: [],
}));
