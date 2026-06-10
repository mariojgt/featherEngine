import type { AssetItem, NodeForgeProject } from '../types';
import type { GameBundle } from './exportGame';

/** Per-asset entry in the build report (sizes are decoded bytes, not base64 length). */
export interface BundleAssetInfo {
  id: string;
  name: string;
  type: string;
  bytes: number;
  /** True when the project actually references this asset somewhere. */
  referenced: boolean;
  /** True when the asset's bytes made it into the bundle. */
  embedded: boolean;
}

export interface BundleReport {
  /** True when no resource is missing/unembedded — i.e. the export is fully self-contained. */
  ok: boolean;
  /** Human-readable inventory lines (what's included). */
  summary: string[];
  /** Issues worth knowing about but that don't break the exported game. */
  warnings: string[];
  /** Problems that WOULD break the exported game at runtime (a used resource has no bytes). */
  errors: string[];
  /** Every asset in the bundle, sorted by size descending. */
  assets: BundleAssetInfo[];
  /** Serialized bundle size in bytes (uncompressed JSON). */
  totalBytes: number;
  /** Asset ids the project actually references (outside the asset list itself). */
  referencedAssetIds: string[];
  /** True when the reference scan threw — callers must fail open (treat everything as used). */
  scanFailed: boolean;
}

/** Decoded byte size of an asset's embedded data URL (falls back to its recorded file size). */
export function assetByteSize(asset: AssetItem): number {
  if (asset.data) {
    const comma = asset.data.indexOf(',');
    const base64Length = comma === -1 ? asset.data.length : asset.data.length - comma - 1;
    return Math.floor((base64Length * 3) / 4);
  }
  return asset.size ?? 0;
}

/**
 * Find every asset id the project references outside the asset list itself. Two complementary
 * scans, both sound over-approximations (they can only over-report, never miss a real use):
 * 1. Walk every string field and collect ids that look like asset ids ("asset-…") — this also
 *    catches *broken* references to ids that aren't in the asset list at all.
 * 2. Substring-search the serialized project JSON for each known asset id — this catches ids
 *    that don't follow the "asset-" naming (e.g. imported/remapped content).
 */
export function collectReferencedAssetIds(
  project: NodeForgeProject,
): { referenced: Set<string>; scanFailed: boolean } {
  const referenced = new Set<string>();
  try {
    const { assets, ...referencingData } = project;
    const visit = (value: unknown) => {
      if (typeof value === 'string') {
        if (value.startsWith('asset-')) referenced.add(value);
        return;
      }
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (value && typeof value === 'object') {
        for (const inner of Object.values(value)) visit(inner);
      }
    };
    visit(referencingData);
    const serialized = JSON.stringify(referencingData);
    for (const asset of assets ?? []) {
      if (!referenced.has(asset.id) && serialized.includes(asset.id)) referenced.add(asset.id);
    }
    return { referenced, scanFailed: false };
  } catch {
    // Fail open: report the scan as broken so callers include everything rather than guess.
    return { referenced, scanFailed: true };
  }
}

/**
 * Audit a built game bundle for completeness before it ships: inventory every kind of project
 * data, confirm each asset's bytes are embedded, and confirm every asset id the scene references
 * actually resolves to embedded bytes. `errors` are breaks the exported game would hit at runtime
 * (a referenced resource with no bytes); `warnings` are everything non-fatal. This is what lets
 * "Export to Production" promise that all game logic and resources made it in with nothing lost.
 */
export function verifyGameBundle(bundle: GameBundle): BundleReport {
  const project = bundle.project;
  const summary: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];

  const objectCount = project.scenes.reduce((total, scene) => total + (scene.objects?.length ?? 0), 0);
  const scriptedObjects = project.scenes.reduce(
    (total, scene) => total + (scene.objects?.filter((object) => object.script?.enabled).length ?? 0),
    0,
  );

  summary.push(`Scenes: ${project.scenes.length} (${objectCount} objects, ${scriptedObjects} scripted)`);
  summary.push(`Visual scripts: ${project.blueprints.length} blueprints / ${project.graphs.length} graphs`);
  summary.push(
    `Materials: ${project.materials.length} · Particles: ${project.particleSystems?.length ?? 0} · Prefabs: ${project.prefabs.length}`,
  );
  summary.push(
    `Animation: ${project.skeletons?.length ?? 0} skeletons / ${project.skeletalMeshes?.length ?? 0} meshes / ${project.animations?.length ?? 0} clips / ${project.animatorControllers?.length ?? 0} controllers`,
  );
  summary.push(
    `UI: ${project.uiDocuments?.length ?? 0} docs · Data assets: ${project.dataAssets.length} · Variables: ${project.variables.length}`,
  );
  summary.push(`Render settings: ${project.renderSettings ? 'included' : 'defaults'}`);

  const assets = project.assets ?? [];
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const embedded = assets.filter((asset) => asset.data && !asset.unresolved);
  const unresolved = assets.filter((asset) => !asset.data || asset.unresolved);
  const byType = new Map<string, number>();
  for (const asset of assets) byType.set(asset.type, (byType.get(asset.type) ?? 0) + 1);
  const typeBreakdown = [...byType.entries()].map(([type, count]) => `${count} ${type}`).join(', ');
  summary.push(
    `Resources: ${assets.length} total${typeBreakdown ? ` (${typeBreakdown})` : ''} — ${embedded.length} embedded${unresolved.length ? `, ${unresolved.length} NOT embedded` : ''}`,
  );

  // Collect every asset id referenced anywhere outside the asset list itself, then confirm each
  // one resolves to embedded bytes. If the scan itself breaks, treat every asset as referenced.
  const { referenced, scanFailed } = collectReferencedAssetIds(project);
  if (scanFailed) {
    warnings.push('Asset reference scan failed — treating every resource as used (nothing will be stripped).');
    for (const asset of assets) referenced.add(asset.id);
  }

  // A used resource without bytes is a runtime break (it would 404 in the player); an *unused*
  // one is only a warning — it can be stripped or shipped without breaking anything.
  for (const asset of unresolved) {
    const label = `"${asset.name ?? asset.id}" (${asset.path ?? asset.id})`;
    if (referenced.has(asset.id)) {
      errors.push(`Missing resource: ${label} is used by the game but its bytes are not embedded — it would fail to load.`);
    } else {
      warnings.push(`Resource not embedded: ${label} — its bytes are missing (unused, so the game still runs).`);
    }
  }

  let missing = 0;
  for (const id of referenced) {
    const asset = byId.get(id);
    if (!asset) {
      missing += 1;
      errors.push(`Broken reference: ${id} is used by the scene but is not in the resource list.`);
    } else if (!asset.data || asset.unresolved) {
      missing += 1; // already reported above as a missing resource, but count it as a live break too
    }
  }
  summary.push(
    `Referenced resources: ${referenced.size} used${missing ? `, ${missing} MISSING/broken` : ' — all resolve'}`,
  );

  const assetInfos: BundleAssetInfo[] = assets
    .map((asset) => ({
      id: asset.id,
      name: asset.name ?? asset.id,
      type: asset.type ?? 'unknown',
      bytes: assetByteSize(asset),
      referenced: referenced.has(asset.id),
      embedded: !!asset.data && !asset.unresolved,
    }))
    .sort((a, b) => b.bytes - a.bytes);

  return {
    ok: errors.length === 0 && warnings.length === 0,
    summary,
    warnings,
    errors,
    assets: assetInfos,
    totalBytes: JSON.stringify(bundle).length,
    referencedAssetIds: [...referenced],
    scanFailed,
  };
}
