import type { GameBundle } from './exportGame';

export interface BundleReport {
  /** True when no resource is missing/unembedded — i.e. the export is fully self-contained. */
  ok: boolean;
  /** Human-readable inventory lines (what's included). */
  summary: string[];
  /** Problems that mean something would be lost or broken in the exported game. */
  warnings: string[];
}

/**
 * Audit a built game bundle for completeness before it ships: inventory every kind of project
 * data, confirm each asset's bytes are embedded, and confirm every asset id the scene references
 * actually resolves to embedded bytes. This is what lets "Export to Production" promise that all
 * game logic and resources made it into the viewport build with nothing lost.
 */
export function verifyGameBundle(bundle: GameBundle): BundleReport {
  const project = bundle.project;
  const summary: string[] = [];
  const warnings: string[] = [];

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
  summary.push(
    `Resources: ${assets.length} total — ${embedded.length} embedded${unresolved.length ? `, ${unresolved.length} NOT embedded` : ''}`,
  );

  for (const asset of unresolved) {
    warnings.push(`Resource not embedded: "${asset.name ?? asset.id}" (${asset.path ?? asset.id}) — its bytes are missing.`);
  }

  // Collect every asset id referenced anywhere outside the asset list itself, then confirm each one
  // resolves to embedded bytes. A generic scan (asset ids look like "asset-<uuid>") catches every
  // reference field — model, texture, audio, etc. — without hard-coding their names.
  const referenced = new Set<string>();
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
  const { assets: _ignored, ...referencingData } = project;
  visit(referencingData);

  let missing = 0;
  for (const id of referenced) {
    const asset = byId.get(id);
    if (!asset) {
      missing += 1;
      warnings.push(`Broken reference: ${id} is used by the scene but is not in the resource list.`);
    } else if (!asset.data || asset.unresolved) {
      missing += 1; // already reported above as not-embedded, but count it as a live break too
    }
  }
  summary.push(
    `Referenced resources: ${referenced.size} used${missing ? `, ${missing} MISSING/broken` : ' — all resolve'}`,
  );

  return { ok: warnings.length === 0, summary, warnings };
}
