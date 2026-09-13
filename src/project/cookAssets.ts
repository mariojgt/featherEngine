import type { AssetItem, ExportTargetId } from '../types';
import type { GameBundle } from './exportGame';
import { clearPreparedGeometry, prepareGlbGeometry, type AssetPreset, type GeometryPreparation } from '../three/prepareGeometry';
import { dataUrlToBytes, sha256Hex } from '../utils/contentHash';

export const ASSET_COOK_VERSION = 2;
export interface CookOptions { geometry: boolean; textures: boolean; streamAssets: boolean }
export const DEFAULT_COOK_OPTIONS: CookOptions = { geometry: true, textures: false, streamAssets: true };
export const assetPresetFor = (target: ExportTargetId): AssetPreset => target === 'android' || target === 'ios' ? 'mobile' : target === 'web' ? 'web' : 'desktop';
export interface CookAssetResult {
  bytes: Uint8Array; sha256: string; meshes: number; trianglesBefore: number; trianglesLod1: number; trianglesLod2: number; warnings: string[];
}
export interface AssetCookCache { get(key: string): Promise<CookAssetResult | null>; put(key: string, value: CookAssetResult): Promise<void> }
export interface AssetCookRow {
  id: string; name: string; sourceBytes: number; outputBytes: number; cached: boolean; meshes: number;
  trianglesBefore: number; trianglesLod1: number; trianglesLod2: number; warnings: string[];
}
export interface CookReport { preset: AssetPreset; assets: AssetCookRow[]; cacheHits: number; prepared: number; sourceBytes: number; outputBytes: number }
export interface CookServices {
  cache?: AssetCookCache;
  geometry?: (bytes: Uint8Array, preset: AssetPreset) => Promise<GeometryPreparation>;
  textures?: (bytes: Uint8Array, preset: AssetPreset) => Promise<Uint8Array>;
  /** Encoder backends have separate caches because their output bytes can differ. */
  backend?: string;
  onProgress?: (line: string) => void;
}
export const bytesDataUrl = (bytes: Uint8Array, mime: string) => {
  let text = ''; for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return `data:${mime};base64,${btoa(text)}`;
};

/** Process a snapshot, never authored assets. Source bytes, options, target and cooker version all
 * enter the cache identity; a changed asset invalidates only its own prepared variant. */
export async function cookGameAssets(bundle: GameBundle, target: ExportTargetId, services: CookServices = {}): Promise<{ bundle: GameBundle; report: CookReport }> {
  const options = { ...DEFAULT_COOK_OPTIONS, ...bundle.buildProfile.optimization };
  const preset = assetPresetFor(target), assets: AssetItem[] = [], rows: AssetCookRow[] = [];
  for (const asset of bundle.project.assets) {
    if (!asset.data?.startsWith('data:')) { assets.push(asset); continue; }
    const original = dataUrlToBytes(asset.data);
    const hash = await sha256Hex(original);
    const model = asset.type === 'model' && /\.(glb|gltf)$/i.test(asset.name);
    const key = await sha256Hex(new TextEncoder().encode(JSON.stringify([ASSET_COOK_VERSION, hash, preset, options.geometry, options.textures, services.backend ?? 'shared'])));
    let cached = false, prepared: CookAssetResult | null = null;
    if (model && (options.geometry || options.textures)) {
      try {
        const entry = await services.cache?.get(key);
        if (entry && entry.sha256 === await sha256Hex(entry.bytes)) { prepared = entry; cached = true; }
      } catch { /* A missing/corrupt cache is rebuilt from the source. */ }
    }
    if (!prepared) {
      services.onProgress?.(`Preparing ${asset.name} for ${preset}…`);
      let bytes = original; const warnings: string[] = [];
      if (model && options.textures && services.textures) {
        try { bytes = await services.textures(options.geometry ? clearPreparedGeometry(bytes) : bytes, preset); }
        catch (error) { warnings.push(`Texture preparation: ${error instanceof Error ? error.message : String(error)} Original textures retained.`); }
      }
      let geometry: GeometryPreparation = { bytes, meshes: 0, trianglesBefore: 0, trianglesLod1: 0, trianglesLod2: 0, warnings: [] };
      if (model && options.geometry) {
        try { geometry = await (services.geometry ?? prepareGlbGeometry)(bytes, preset); }
        catch (error) { warnings.push(`Geometry preparation: ${error instanceof Error ? error.message : String(error)} Original geometry retained.`); }
      }
      prepared = { ...geometry, sha256: await sha256Hex(geometry.bytes), warnings: [...warnings, ...geometry.warnings] };
      // Transient decoder/encoder failures must be retried on the next build.
      if (model && !prepared.warnings.length) try { await services.cache?.put(key, prepared); } catch { /* Cache quota does not block export. */ }
    }
    const mime = model ? 'model/gltf-binary' : asset.data.slice(5, asset.data.indexOf(';'));
    assets.push({ ...asset, data: bytesDataUrl(prepared.bytes, mime), hash: prepared.sha256, size: prepared.bytes.length });
    rows.push({ id: asset.id, name: asset.name, sourceBytes: original.length, outputBytes: prepared.bytes.length, cached, meshes: prepared.meshes, trianglesBefore: prepared.trianglesBefore, trianglesLod1: prepared.trianglesLod1, trianglesLod2: prepared.trianglesLod2, warnings: prepared.warnings });
    services.onProgress?.(`${cached ? 'Reused' : 'Prepared'} ${asset.name}: ${(prepared.bytes.length / 1024).toFixed(0)} KB${prepared.meshes ? ` · ${prepared.meshes} meshes with detail levels` : ''}`);
  }
  return {
    bundle: { ...bundle, project: { ...bundle.project, assets } },
    report: { preset, assets: rows.sort((a, b) => b.outputBytes - a.outputBytes), cacheHits: rows.filter((r) => r.cached).length, prepared: rows.filter((r) => !r.cached && r.meshes > 0).length, sourceBytes: rows.reduce((n, r) => n + r.sourceBytes, 0), outputBytes: rows.reduce((n, r) => n + r.outputBytes, 0) },
  };
}

/** Content-addressed files keep the launch manifest small and let the runtime load assets as used.
 * Identical resources occupy one file, with stable names that also help incremental Steam patches. */
export function externalizeGameAssets(bundle: GameBundle): { bundle: GameBundle; files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  if (bundle.buildProfile.optimization?.streamAssets === false) return { bundle, files };
  const assets = bundle.project.assets.map((asset) => {
    if (!asset.data || !/^[a-f0-9]{64}$/.test(asset.hash ?? '')) return asset;
    const bytes = dataUrlToBytes(asset.data);
    const ext = asset.name.toLowerCase().match(/\.([a-z0-9]{1,8})$/)?.[1] ?? 'bin';
    const path = `game-assets/${asset.hash}.${ext}`;
    files.set(path, bytes);
    const { data: _data, url: _url, ...rest } = asset;
    return { ...rest, delivery: { path, sha256: asset.hash!, bytes: bytes.length } };
  });
  const features = [...new Set([...bundle.runtimeContract.requiredFeatures, 'streamed-assets' as const])];
  return { bundle: { ...bundle, runtimeContract: { ...bundle.runtimeContract, requiredFeatures: features }, project: { ...bundle.project, assets } }, files };
}
