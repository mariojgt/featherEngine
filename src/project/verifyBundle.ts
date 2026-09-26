import type { AssetItem, NodeForgeProject } from '../types';
import { isTitanScene, readTitanSettings, titanReleaseConfig } from '../titan/settings';
import type { GameBundle } from './exportGame';
import { validateRuntimeContract, validateRuntimeReferences, type RuntimeFeatureId } from './runtimeCompatibility';

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
  /** Authored engine subsystems the production player must execute for parity with editor Play. */
  runtimeFeatures: RuntimeFeatureId[];
}

/**
 * Assets which are intentionally discovered by a runtime naming convention instead of an authored
 * asset-id field. Keep this list beside the general reference scanner so adding another convention
 * has one obvious production-packaging step. Template-time filename lookups are not listed here:
 * those resolve to ids before the project is saved.
 */
const RUNTIME_NAMED_ASSET_RULES: readonly {
  isEnabled: (project: NodeForgeProject) => boolean;
  names: readonly string[];
}[] = [
  { isEnabled: project => project.scenes.some(scene => isTitanScene(scene.objects)), names: ['UAL1.glb', 'Sword.glb'] },
  {
    // The lap/checkpoint pass in editorStore indexes these exact filenames when a Lap variable opts
    // the project into race timing. There is deliberately no serialized asset-id field to scan.
    isEnabled: (project) => project.variables.some((variable) => variable.name === 'Lap'),
    names: ['lap_complete.mp3', 'checkpoint.mp3'],
  },
];

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

    // A small number of built-in runtime systems intentionally resolve optional resources by an
    // exact filename. Preserve matching assets whenever that system is enabled; otherwise a valid
    // "strip unused" export can silently remove audio which editor Play still finds by name.
    const assetsByName = new Map((assets ?? []).map((asset) => [asset.name, asset]));
    for (const rule of RUNTIME_NAMED_ASSET_RULES) {
      if (!rule.isEnabled(project)) continue;
      for (const name of rule.names) {
        const asset = assetsByName.get(name);
        if (asset) referenced.add(asset.id);
      }
    }
    return { referenced, scanFailed: false };
  } catch {
    // Fail open: report the scan as broken so callers include everything rather than guess.
    return { referenced, scanFailed: true };
  }
}

function assetExtension(asset: AssetItem): string {
  const filename = asset.path ?? asset.name ?? '';
  const clean = filename.split(/[?#]/, 1)[0]?.toLowerCase() ?? '';
  const dot = clean.lastIndexOf('.');
  return dot === -1 ? '' : clean.slice(dot + 1);
}

/** Decode the JSON payload of an embedded .gltf data URL. */
function decodeGltfJson(dataUrl: string): unknown {
  const comma = dataUrl.indexOf(',');
  if (comma === -1) throw new Error('the embedded data URL has no payload separator');
  const metadata = dataUrl.slice(5, comma);
  const payload = dataUrl.slice(comma + 1);
  if (!payload) throw new Error('the embedded data URL is empty');

  let json: string;
  if (/;base64(?:;|$)/i.test(metadata)) {
    const binary = globalThis.atob(payload.replace(/\s/g, ''));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    json = new TextDecoder().decode(bytes);
  } else {
    json = decodeURIComponent(payload);
  }
  return JSON.parse(json) as unknown;
}

/**
 * Return every non-data URI in a glTF JSON document. glTF may put dependencies in extension
 * objects as well as the standard buffers/images arrays, so recursively inspect every `uri` field.
 */
function externalGltfUris(document: unknown): string[] {
  const external = new Set<string>();
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, inner] of Object.entries(value)) {
      if (key === 'uri' && typeof inner === 'string' && !inner.trim().toLowerCase().startsWith('data:')) {
        external.add(inner || '<empty URI>');
      } else {
        visit(inner);
      }
    }
  };
  visit(document);
  return [...external];
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
  if (project.scenes.some(scene => isTitanScene(scene.objects))) {
    try {
      const expected = titanReleaseConfig(readTitanSettings(project.variables), bundle.buildProfile.application.identifier, bundle.buildProfile.targets.includes('web'));
      if (JSON.stringify(expected) !== JSON.stringify(bundle.realmServer)) errors.push('Titan server configuration does not match this game. Rebuild the bundle from the project.');
      summary.push(expected ? 'Titan: online login configured; realm-server deployment included' : 'Titan: solo release; no server required');
    } catch (error) { errors.push(error instanceof Error ? error.message : 'Invalid Titan release settings.'); }
  }

  const compatibility = validateRuntimeReferences(bundle.project, bundle.startSceneId, bundle.buildProfile);
  errors.push(...validateRuntimeContract(bundle.runtimeContract), ...compatibility.errors);
  warnings.push(...compatibility.warnings);

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
  summary.push(
    `Runtime parity: ${compatibility.features.length ? compatibility.features.join(', ') : 'core scene runtime'} — supported by this player`,
  );

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

  // A .gltf file is JSON and can point at sibling .bin/image files. Embedding only the JSON does
  // not make those dependencies portable, and data/blob URLs have no sibling directory for the
  // loader to resolve. Permit genuinely self-contained glTF (data URIs or bufferViews), but block
  // every external dependency with a conversion hint. GLB remains the recommended import format.
  for (const asset of assets) {
    if (assetExtension(asset) !== 'gltf' || !asset.data || asset.unresolved) continue;
    const label = `"${asset.name ?? asset.id}" (${asset.path ?? asset.id})`;
    try {
      const externalUris = externalGltfUris(decodeGltfJson(asset.data));
      if (externalUris.length) {
        const preview = externalUris.slice(0, 3).join(', ');
        const remaining = externalUris.length - 3;
        errors.push(
          `External glTF dependencies: ${label} references ${preview}${remaining > 0 ? ` and ${remaining} more` : ''}. ` +
            'Production bundles cannot resolve sibling files from embedded data; convert the model to a self-contained .glb or embed every buffer/image as a data URI.',
        );
      }
    } catch (error) {
      errors.push(
        `Invalid embedded glTF: ${label} could not be inspected (${error instanceof Error ? error.message : String(error)}). ` +
          'Re-import it as a valid self-contained .gltf or convert it to .glb.',
      );
    }
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
    runtimeFeatures: compatibility.features,
  };
}
