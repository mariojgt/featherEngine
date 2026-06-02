import { PROJECT_VERSION, type AssetItem, type NodeForgeProject } from '../types';

/** Bundle format version, bumped independently of the project file format. */
export const GAME_BUNDLE_VERSION = '1.0.0';

/** File name the standalone player fetches at startup (next to its index.html). */
export const GAME_BUNDLE_FILE = 'game.json';

/**
 * A self-contained game bundle: everything the standalone player needs to run the game.
 * Asset bytes are inlined as data URLs (see `AssetItem.data`) so the export is portable —
 * the player rebuilds runtime URLs from them on load.
 */
export interface GameBundle {
  bundleVersion: string;
  /** When the game's window/player opens, this scene plays first. */
  startSceneId: string;
  project: NodeForgeProject;
}

/** Read an asset's bytes (from its runtime `url`) into a self-contained data URL. */
/**
 * Correct MIME type for an asset, by file extension. The Tauri asset server often reports binary
 * assets (.glb, .mp3, …) as `text/html`, which then poisons the embedded data URL — the player's
 * `<audio>`/texture decoders reject the wrong type. We re-stamp the data URL with this instead.
 */
function mimeForAsset(asset: AssetItem): string | null {
  const ext = (asset.path ?? asset.name ?? '').toLowerCase().split('.').pop() ?? '';
  switch (ext) {
    case 'glb':
      return 'model/gltf-binary';
    case 'gltf':
      return 'model/gltf+json';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'ktx2':
      return 'image/ktx2';
    case 'hdr':
      return 'image/vnd.radiance';
    case 'mp3':
      return 'audio/mpeg';
    case 'wav':
      return 'audio/wav';
    case 'ogg':
      return 'audio/ogg';
    case 'm4a':
    case 'mp4':
      return 'audio/mp4';
    default:
      return null;
  }
}

/** Read an asset's bytes (from its runtime `url`) into a self-contained data URL with a correct MIME. */
async function toDataUrl(asset: AssetItem): Promise<string> {
  const response = await fetch(asset.url as string);
  const blob = await response.blob();
  const raw = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read asset bytes'));
    reader.readAsDataURL(blob);
  });
  // Re-stamp the MIME from the extension when known — the source server may have mislabeled it.
  const mime = mimeForAsset(asset);
  if (mime) {
    const comma = raw.indexOf(',');
    if (comma !== -1) return `data:${mime};base64,${raw.slice(comma + 1)}`;
  }
  return raw;
}

/**
 * Inline each asset's bytes as a data URL so the bundle is fully self-contained.
 * Pass the *live* assets (which still carry their runtime `url`); assets that can't be
 * fetched are kept without `data` and flagged `unresolved`.
 */
export async function embedAssets(assets: AssetItem[]): Promise<AssetItem[]> {
  return await Promise.all(
    assets.map(async (asset) => {
      if (!asset.url) return { ...asset, unresolved: true };
      try {
        return { ...asset, data: await toDataUrl(asset) };
      } catch {
        return { ...asset, unresolved: true };
      }
    }),
  );
}

/**
 * Build a portable game bundle from a project. Pass assets through `embedAssets` first to
 * make it self-contained; this keeps the embedded `data` but drops the runtime-only `url`.
 */
export function buildGameBundle(project: NodeForgeProject): GameBundle {
  return {
    bundleVersion: GAME_BUNDLE_VERSION,
    startSceneId: project.activeSceneId,
    project: {
      ...project,
      version: project.version || PROJECT_VERSION,
      // Drop the runtime-only url; keep embedded `data` so the player can resolve assets offline.
      assets: project.assets.map(({ url: _url, ...asset }) => asset),
    },
  };
}

/** Point each asset's runtime `url` at its embedded data so the player can render/play it. */
function resolveEmbeddedAssets(project: NodeForgeProject): NodeForgeProject {
  return {
    ...project,
    assets: project.assets.map((asset) => (asset.data ? { ...asset, url: asset.data } : asset)),
  };
}

/** Parse a loaded game bundle back into a runnable project. Accepts a raw `NodeForgeProject` too. */
export function readGameBundle(raw: unknown): { project: NodeForgeProject; startSceneId: string } {
  const data = raw as Partial<GameBundle> & Partial<NodeForgeProject>;
  if (data && typeof data === 'object' && 'project' in data && data.project) {
    const project = resolveEmbeddedAssets(data.project as NodeForgeProject);
    return { project, startSceneId: data.startSceneId ?? project.activeSceneId };
  }
  // Fall back to treating the payload as a bare project (e.g. a raw .nforge file).
  const project = resolveEmbeddedAssets(raw as NodeForgeProject);
  return { project, startSceneId: project.activeSceneId };
}
