import { PROJECT_VERSION, type AssetItem, type ExportProfile, type NodeForgeProject } from '../types';
import { sha256Hex } from '../utils/contentHash';
import { activeExportProfile, parseExportSettings } from './exportProfiles';
import {
  buildRuntimeContract,
  validateRuntimeContract,
  validateRuntimeReferences,
  type RuntimeContract,
} from './runtimeCompatibility';
import { migrateLoaded } from './serialize';

/** Bundle format version, bumped independently of the project file format. */
export const GAME_BUNDLE_VERSION = '1.1.0';
const PROFILED_BUNDLE_VERSION = '1.1.0';

function compareVersions(left: string, right: string, label: string): number {
  const parse = (value: string) => {
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
    if (!match) throw new Error(`Invalid ${label} version: ${value}`);
    return match.slice(1).map(Number);
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index]! - b[index]!;
  }
  return 0;
}

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
  /** Immutable profile snapshot used to build this artifact. */
  buildProfile: ExportProfile;
  /** Required engine subsystems; older players reject features they cannot execute. */
  runtimeContract: RuntimeContract;
  project: NodeForgeProject;
}

/**
 * Correct MIME type for an asset, by file extension. The Tauri asset server often reports binary
 * assets (.glb, .mp3, …) as `text/html`, which then poisons the embedded data URL — the player's
 * `<audio>`/texture decoders reject the wrong type. We re-stamp the data URL with this instead.
 *
 * Exported so package installs can label bytes unpacked from an archive: those arrive with no MIME
 * at all, and an image handed back as `application/octet-stream` will not render.
 */
export function mimeForAsset(asset: AssetItem): string | null {
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

/**
 * Read an asset's bytes (from its runtime `url`) into a self-contained data URL with a correct MIME,
 * plus their SHA-256 so importers can content-address the asset.
 */
async function readAssetBytes(asset: AssetItem): Promise<{ dataUrl: string; hash: string }> {
  const response = await fetch(asset.url as string);
  const blob = await response.blob();
  const hash = await sha256Hex(await blob.arrayBuffer());
  const raw = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read asset bytes'));
    reader.readAsDataURL(blob);
  });
  // Re-stamp the MIME from the extension when known — the source server may have mislabeled it.
  const mime = mimeForAsset(asset);
  const comma = raw.indexOf(',');
  if (mime && comma !== -1) return { dataUrl: `data:${mime};base64,${raw.slice(comma + 1)}`, hash };
  return { dataUrl: raw, hash };
}

/**
 * Inline each asset's bytes as a data URL so the bundle is fully self-contained.
 * Pass the *live* assets (which still carry their runtime `url`); assets that can't be
 * fetched are kept without `data` and flagged `unresolved`.
 */
export async function embedAssets(assets: AssetItem[]): Promise<AssetItem[]> {
  return await Promise.all(
    assets.map(async (asset) => {
      if (!asset.url) return asset.data?.startsWith('data:') ? { ...asset, unresolved: false } : { ...asset, unresolved: true };
      try {
        const { dataUrl, hash } = await readAssetBytes(asset);
        return { ...asset, data: dataUrl, hash, unresolved: false };
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
export function buildGameBundle(project: NodeForgeProject, profile?: ExportProfile): GameBundle {
  const sceneIds = project.scenes.map((scene) => scene.id);
  const exportSettings = parseExportSettings(project.exportSettings, project.name, sceneIds, project.activeSceneId);
  const buildProfile = structuredClone(profile ?? activeExportProfile(exportSettings));
  const canonicalProject = { ...project, exportSettings };
  return {
    bundleVersion: GAME_BUNDLE_VERSION,
    startSceneId: buildProfile.startSceneId,
    buildProfile,
    runtimeContract: buildRuntimeContract(canonicalProject),
    project: {
      ...canonicalProject,
      version: project.version || PROJECT_VERSION,
      // Drop the runtime-only url; keep embedded `data` so the player can resolve assets offline.
      assets: project.assets.map(({ url: _url, ...asset }) => asset),
    },
  };
}

/**
 * Drop assets the project never references from a bundle (smaller download, nothing lost).
 * Callers must pass ids from a *successful* reference scan — when the scan fails, fail open
 * and keep everything (see `collectReferencedAssetIds`).
 */
export function stripUnusedAssets(bundle: GameBundle, referencedAssetIds: string[]): GameBundle {
  const keep = new Set(referencedAssetIds);
  return {
    ...bundle,
    project: {
      ...bundle.project,
      assets: bundle.project.assets.filter((asset) => keep.has(asset.id)),
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
export function readGameBundle(raw: unknown): {
  project: NodeForgeProject;
  startSceneId: string;
  buildProfile: ExportProfile;
  runtimeContract: RuntimeContract;
} {
  const data = raw as Partial<GameBundle> & Partial<NodeForgeProject>;
  const isBundle = Boolean(data && typeof data === 'object' && 'project' in data && data.project);
  if (isBundle && data.bundleVersion !== undefined && typeof data.bundleVersion !== 'string') {
    throw new Error('Game bundle version must be a semantic-version string.');
  }
  const bundleVersion = isBundle && typeof data.bundleVersion === 'string' ? data.bundleVersion : '1.0.0';
  if (isBundle && compareVersions(bundleVersion, GAME_BUNDLE_VERSION, 'game bundle') > 0) {
    throw new Error(
      `Game bundle ${bundleVersion} is newer than this player (${GAME_BUNDLE_VERSION}). Update Feather Engine/player.`,
    );
  }
  const hasProfiledFormat =
    isBundle && compareVersions(bundleVersion, PROFILED_BUNDLE_VERSION, 'game bundle') >= 0;
  if (hasProfiledFormat && !data.buildProfile) {
    throw new Error(`Game bundle ${bundleVersion} is missing its required build profile.`);
  }
  if (hasProfiledFormat && !data.runtimeContract) {
    throw new Error(`Game bundle ${bundleVersion} is missing its required runtime contract.`);
  }
  // Bundles exported by older engine versions predate whole project collections, so run the same
  // migration the editor uses when opening a project file. Without it the player would hand the
  // runtime a project whose collections are `undefined` rather than empty arrays.
  // The payload may also be a bare `NodeForgeProject` (e.g. a raw .nforge file dropped next to
  // the player), which `migrateLoaded` accepts and normalizes the same way.
  const rawProject = (isBundle ? data.project : raw) as Partial<NodeForgeProject> | undefined;
  if (typeof rawProject?.version === 'string' && compareVersions(rawProject.version, PROJECT_VERSION, 'project') > 0) {
    throw new Error(
      `Project ${rawProject.version} is newer than this player (${PROJECT_VERSION}). Update Feather Engine/player.`,
    );
  }
  let project = resolveEmbeddedAssets(migrateLoaded(rawProject));
  const startSceneId = (isBundle ? data.startSceneId : undefined) ?? project.activeSceneId;
  const rawBundle = data as Partial<GameBundle>;
  const buildProfile =
    rawBundle.buildProfile ?? { ...activeExportProfile(project.exportSettings), startSceneId };
  if (!rawBundle.buildProfile) {
    project = {
      ...project,
      exportSettings: {
        ...project.exportSettings,
        profiles: project.exportSettings.profiles.map((profile) =>
          profile.id === project.exportSettings.activeProfileId ? buildProfile : profile,
        ),
      },
    };
  }
  const runtimeContract = rawBundle.runtimeContract ?? buildRuntimeContract(project);
  const contractErrors = validateRuntimeContract(runtimeContract);
  const referenceErrors = validateRuntimeReferences(project, startSceneId, buildProfile).errors;
  const errors = [...contractErrors, ...referenceErrors];
  if (errors.length) throw new Error(`Game bundle is not runtime-compatible:\n- ${errors.join('\n- ')}`);
  return { project, startSceneId, buildProfile, runtimeContract };
}
