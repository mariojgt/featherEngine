import type { AssetItem } from '../types';
import grassAlbedo from './surfaces/grass-albedo.webp?url';
import grassNormal from './surfaces/grass-normal.webp?url';
import soilAlbedo from './surfaces/soil-albedo.webp?url';
import soilNormal from './surfaces/soil-normal.webp?url';
import rockAlbedo from './surfaces/rock-albedo.webp?url';
import rockNormal from './surfaces/rock-normal.webp?url';

const surfaces = [
  ['grass', grassAlbedo, grassNormal], ['soil', soilAlbedo, soilNormal], ['rock', rockAlbedo, rockNormal],
] as const;
let pending: Promise<AssetItem[]> | undefined;

/** Self-hosted CC0 scans; persisted as ordinary embedded assets so exports need no network. */
export function biomeSurfaceAssets(): Promise<AssetItem[]> {
  if (!pending) pending = Promise.all(surfaces.flatMap(([kind, albedo, normal]) => [albedo, normal].map(async (url, index) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Cannot load bundled ${kind} surface (${response.status})`);
    const bytes = await response.arrayBuffer();
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error('Cannot embed landscape surface'));
      reader.readAsDataURL(new Blob([bytes], { type: 'image/webp' }));
    });
    return { id: `feather-natural-${kind}${index ? '-normal' : ''}-v3`, name: `Natural ${kind}${index ? ' normal' : ''}.webp`,
      type: 'image' as const, size: bytes.byteLength, data, createdAt: 0 };
  }))).catch((error) => { pending = undefined; throw error; });
  return pending.then((assets) => assets.map((asset) => ({ ...asset })));
}
