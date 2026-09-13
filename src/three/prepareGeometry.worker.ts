import { prepareGlbGeometry, type AssetPreset } from './prepareGeometry';
self.onmessage = async (event: MessageEvent<{ bytes: Uint8Array; preset: AssetPreset }>) => {
  try { const result = await prepareGlbGeometry(event.data.bytes, event.data.preset); self.postMessage({ result }, { transfer: [result.bytes.buffer] }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
