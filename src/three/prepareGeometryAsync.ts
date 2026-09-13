import { prepareGlbGeometry, type AssetPreset, type GeometryPreparation } from './prepareGeometry';

export function prepareGeometryAsync(bytes: Uint8Array, preset: AssetPreset): Promise<GeometryPreparation> {
  if (typeof Worker === 'undefined') return prepareGlbGeometry(bytes, preset);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./prepareGeometry.worker.ts', import.meta.url), { type: 'module' });
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('Geometry preparation timed out.')); }, 120_000);
    const stop = () => { clearTimeout(timer); worker.terminate(); };
    worker.onmessage = (event: MessageEvent<{ result?: GeometryPreparation; error?: string }>) => { stop(); if (event.data.result) resolve(event.data.result); else reject(new Error(event.data.error ?? 'Geometry preparation failed.')); };
    worker.onerror = (error) => { stop(); reject(new Error(error.message)); };
    const copy = bytes.slice(); worker.postMessage({ bytes: copy, preset }, [copy.buffer]);
  });
}
