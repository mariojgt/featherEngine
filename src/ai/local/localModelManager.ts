import type { TransformersJSLanguageModel } from '@browser-ai/transformers-js';
import type { LanguageModel } from 'ai';
import { useLocalAIStore } from '../../store/localAIStore';
import {
  clearLocalModelCache,
  isLocalModelCached,
  listCachedLocalModelIds,
  markLocalModelCached,
} from './localCache';
import { detectLocalAIHardware, getLocalStorageEstimate } from './localHardware';
import { adaptLocalLanguageModel } from './localModelAdapter';
import { getLocalModelDefinition } from './localModelCatalog';

interface LocalRuntime {
  modelId: string;
  worker: Worker;
  model: TransformersJSLanguageModel;
  languageModel: LanguageModel;
}

let runtime: LocalRuntime | null = null;
let preparation: { modelId: string; promise: Promise<LanguageModel> } | null = null;
let loadAbort: AbortController | null = null;
let operation = 0;

const updateRuntime = (patch: Partial<ReturnType<typeof useLocalAIStore.getState>['runtime']>) =>
  useLocalAIStore.setState((state) => ({ runtime: { ...state.runtime, ...patch } }));

async function updateStorageEstimate() {
  const [storage, cachedModelIds] = await Promise.all([
    getLocalStorageEstimate(),
    listCachedLocalModelIds(),
  ]);
  useLocalAIStore.setState({ storage, cachedModelIds });
}

function terminateRuntime() {
  if (!runtime) return;
  runtime.worker.postMessage({ type: 'interrupt' });
  runtime.worker.terminate();
  runtime = null;
}

async function createRuntime(modelId: string): Promise<LocalRuntime> {
  if (runtime?.modelId === modelId) return runtime;
  terminateRuntime();

  const definition = getLocalModelDefinition(modelId);
  const worker = new Worker(new URL('./localAIWorker.ts', import.meta.url), {
    type: 'module',
    name: 'feather-local-ai',
  });

  try {
    const { transformersJS } = await import('./localProviderRuntime');
    const model = transformersJS(modelId, {
      device: definition.device,
      dtype: definition.dtype,
      worker,
    });
    runtime = {
      modelId,
      worker,
      model,
      languageModel: adaptLocalLanguageModel(model, definition, worker),
    };
    return runtime;
  } catch (error) {
    worker.terminate();
    const detail = error instanceof Error ? error.message : String(error);
    if (/dynamically imported module|Outdated Optimize Dep|504 \(Outdated Optimize Dep\)/i.test(detail)) {
      throw new Error(
        'Feather\'s Local AI runtime changed while this development session was open. Reload or restart Feather, then retry; the model download did not start.',
      );
    }
    throw error;
  }
}

export async function refreshLocalAIStatus(modelId: string): Promise<void> {
  const currentOperation = ++operation;
  if (runtime && runtime.modelId !== modelId) terminateRuntime();
  useLocalAIStore.setState((state) => ({
    hardware: { state: 'checking', shaderF16: false },
    runtime: { ...state.runtime, modelId, error: undefined },
  }));

  const [hardware, cached, storage, cachedModelIds] = await Promise.all([
    detectLocalAIHardware(),
    isLocalModelCached(modelId),
    getLocalStorageEstimate(),
    listCachedLocalModelIds(),
  ]);
  if (currentOperation !== operation) return;

  useLocalAIStore.setState((state) => ({
    hardware,
    storage,
    cachedModelIds,
    runtime: {
      ...state.runtime,
      modelId,
      state:
        hardware.state === 'unavailable'
          ? 'unsupported'
          : runtime?.modelId === modelId && state.runtime.state === 'ready'
            ? 'ready'
            : cached
              ? 'installed'
              : 'not-installed',
      progress: runtime?.modelId === modelId && state.runtime.state === 'ready' ? 1 : 0,
      error: hardware.state === 'unavailable' ? hardware.reason : undefined,
    },
  }));
}

async function prepareLocalModel(modelId: string, allowDownload: boolean): Promise<LanguageModel> {
  if (runtime?.modelId === modelId && useLocalAIStore.getState().runtime.state === 'ready') {
    return runtime.languageModel;
  }
  if (preparation?.modelId === modelId) return preparation.promise;

  const promise = (async () => {
    const currentOperation = ++operation;
    const hardware = await detectLocalAIHardware();
    if (currentOperation !== operation) throw new DOMException('Local AI load was cancelled.', 'AbortError');
    useLocalAIStore.setState({ hardware });
    if (hardware.state !== 'available') {
      updateRuntime({ modelId, state: 'unsupported', progress: 0, error: hardware.reason });
      throw new Error(hardware.reason ?? 'WebGPU is unavailable.');
    }

    const cached = await isLocalModelCached(modelId);
    if (!cached && !allowDownload) {
      updateRuntime({ modelId, state: 'not-installed', progress: 0, error: undefined });
      throw new Error('Download & load the local model in Agent settings before using it.');
    }

    updateRuntime({
      modelId,
      state: cached ? 'loading' : 'downloading',
      progress: 0,
      error: undefined,
    });

    const controller = new AbortController();
    loadAbort = controller;

    try {
      const nextRuntime = await createRuntime(modelId);
      const aborted = new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener(
          'abort',
          () => reject(new DOMException('Local AI load was cancelled.', 'AbortError')),
          { once: true },
        );
      });
      await Promise.race([
        nextRuntime.model.createSessionWithProgress((progress) => {
          if (currentOperation !== operation) return;
          updateRuntime({ progress: Math.max(0, Math.min(1, progress)) });
        }),
        aborted,
      ]);
      if (currentOperation !== operation) throw new DOMException('Local AI load was cancelled.', 'AbortError');

      markLocalModelCached(modelId);
      await updateStorageEstimate();
      updateRuntime({ modelId, state: 'ready', progress: 1, error: undefined });
      return nextRuntime.languageModel;
    } catch (error) {
      terminateRuntime();
      if (currentOperation === operation) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          updateRuntime({ modelId, state: cached ? 'installed' : 'not-installed', progress: 0, error: undefined });
        } else {
          updateRuntime({
            modelId,
            state: 'error',
            progress: 0,
            error: error instanceof Error ? error.message : 'Local model failed to load.',
          });
        }
      }
      throw error;
    } finally {
      if (loadAbort === controller) loadAbort = null;
    }
  })();

  preparation = { modelId, promise };
  try {
    return await promise;
  } finally {
    if (preparation?.promise === promise) preparation = null;
  }
}

/** Explicit first-use action. Downloads missing bytes and warms the model in the WebGPU worker. */
export const downloadAndLoadLocalModel = (modelId: string) => prepareLocalModel(modelId, true);

/** Agent path. It will reuse/warm a previously approved cache but never start a new first download. */
export const getLocalLanguageModel = (modelId: string) => prepareLocalModel(modelId, false);

export async function cancelLocalModelLoad(): Promise<void> {
  operation += 1;
  loadAbort?.abort();
  loadAbort = null;
  preparation = null;
  terminateRuntime();
  const modelId = useLocalAIStore.getState().runtime.modelId;
  const cached = await isLocalModelCached(modelId);
  updateRuntime({ state: cached ? 'installed' : 'not-installed', progress: 0, error: undefined });
}

export async function unloadLocalModel(): Promise<void> {
  operation += 1;
  loadAbort?.abort();
  loadAbort = null;
  preparation = null;
  terminateRuntime();
  const modelId = useLocalAIStore.getState().runtime.modelId;
  const cached = await isLocalModelCached(modelId);
  updateRuntime({ state: cached ? 'installed' : 'not-installed', progress: 0, error: undefined });
}

export async function clearAllLocalAIModels(): Promise<void> {
  await unloadLocalModel();
  await clearLocalModelCache();
  useLocalAIStore.setState({ cachedModelIds: [] });
  updateRuntime({ state: 'not-installed', progress: 0, error: undefined });
  await updateStorageEstimate();
}
