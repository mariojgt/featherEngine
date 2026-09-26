import type { AssetItem } from '../types';
import type { TerrainBiomeId } from './biomes';
import treeLibrary from './models/woodland-trees.glb?url';
import groundCoverLibrary from './models/woodland-ground-cover.glb?url';

const pending = new Map<string, Promise<AssetItem>>();

function embeddedModel(id: string, name: string, url: string): Promise<AssetItem> {
  let request = pending.get(id);
  if (!request) {
    request = (async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Cannot load bundled ${name} (${response.status})`);
      const bytes = await response.arrayBuffer();
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error ?? new Error(`Cannot embed ${name}`));
        reader.readAsDataURL(new Blob([bytes], { type: 'model/gltf-binary' }));
      });
      return { id, name, type: 'model' as const, size: bytes.byteLength, data, createdAt: 0 };
    })().catch(error => { pending.delete(id); throw error; });
    pending.set(id, request);
  }
  return request.then(asset => ({ ...asset }));
}

/** The authored library is an ordinary embedded model, including all textures and detail levels. */
export function biomeTreeAssets(biome: TerrainBiomeId): Promise<AssetItem[]> {
  if (biome === 'alpine') return Promise.resolve([]);
  const assets = [embeddedModel('feather-woodland-trees-v3', 'Woodland Trees.glb', treeLibrary)];
  if (biome === 'woodland') assets.push(embeddedModel('feather-woodland-ground-cover-v4', 'Woodland Ground Cover.glb', groundCoverLibrary));
  return Promise.all(assets);
}
