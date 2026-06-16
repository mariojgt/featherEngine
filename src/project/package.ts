import {
  PROJECT_VERSION,
  type AnimationAsset,
  type AnimatorController,
  type AssetItem,
  type DataAsset,
  type MaterialDefinition,
  type NodeForgeNode,
  type ParticleSystemDefinition,
  type Prefab,
  type ProjectGraph,
  type ProjectVariable,
  type Scene,
  type SceneObject,
  type ScriptBlueprint,
  type SkeletalMeshAsset,
  type SkeletonAsset,
  type UIDocument,
  type UIElement,
} from '../types';

/**
 * Portable template/module exchange format. A `.nfpack` file is a self-contained slice of a
 * project — a reusable prefab plus its full dependency closure, or a whole game — that can be
 * imported into any other project without colliding with it (every id is regenerated on import).
 *
 * See [docs/AI_ASSISTANT.md] and the package-marketplace design notes. Distribution (a store) is a
 * later phase; for now packages are plain files exported/imported through the platform layer.
 */
export const PACKAGE_FORMAT = 'nodeforge-package' as const;

/** Package schema version, bumped independently of PROJECT_VERSION / the game-bundle version. */
export const PACKAGE_VERSION = '1.0.0';

/** File extension for exported packages. */
export const PACKAGE_EXT = 'nfpack';

export type PackageKind = 'module' | 'project';

export interface PackageMeta {
  /** Stable id for this package's identity (survives re-exports of the same content). */
  id: string;
  name: string;
  description?: string;
  author?: string;
  /** Semver of the *content* (the creator bumps this as they revise the template). */
  version: string;
  createdAt: string;
  tags?: string[];
  /** PNG data-URL preview (e.g. the seed prefab's thumbnail). */
  thumbnail?: string;
  /** PROJECT_VERSION the package was authored against, for forward-compat checks. */
  engineVersion: string;
}

/** The transferable slice of a project. Only the entities the seed actually references are included. */
export interface PackageContent {
  prefabs: Prefab[];
  blueprints: ScriptBlueprint[];
  graphs: ProjectGraph[];
  materials: MaterialDefinition[];
  particleSystems: ParticleSystemDefinition[];
  skeletons: SkeletonAsset[];
  skeletalMeshes: SkeletalMeshAsset[];
  animations: AnimationAsset[];
  animatorControllers: AnimatorController[];
  dataAssets: DataAsset[];
  uiDocuments: UIDocument[];
  variables: ProjectVariable[];
  /** Only present for `kind: 'project'` packages. */
  scenes?: Scene[];
}

export interface NodeForgePackage {
  format: typeof PACKAGE_FORMAT;
  formatVersion: string;
  kind: PackageKind;
  meta: PackageMeta;
  content: PackageContent;
  /** Referenced assets with bytes inlined as data URLs (via embedAssets) so the file is portable. */
  assets: AssetItem[];
}

/** The project entities the collector/remapper reads from (a subset of the editor store). */
export interface PackageSource extends PackageContent {
  assets: AssetItem[];
}

const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

const isPackage = (value: unknown): value is NodeForgePackage =>
  !!value && typeof value === 'object' && (value as { format?: unknown }).format === PACKAGE_FORMAT;

/** Validate + narrow an arbitrary parsed JSON into a NodeForgePackage, or throw a friendly error. */
export function parsePackage(raw: unknown): NodeForgePackage {
  if (!isPackage(raw)) throw new Error('Not a NodeForge package file (.nfpack).');
  const pkg = raw as NodeForgePackage;
  if (!pkg.content || !Array.isArray(pkg.content.prefabs)) {
    throw new Error('Package is missing content.');
  }
  return pkg;
}

// ---------------------------------------------------------------------------------------------
// Dependency collection — walk every id reference from a seed prefab to gather its closure.
// ---------------------------------------------------------------------------------------------

/** Scan a graph's nodes for the ids they reference, pushing each into the right bucket. */
function scanGraphNodeRefs(
  nodes: NodeForgeNode[],
  add: {
    asset: (id?: string) => void;
    prefab: (id?: string) => void;
    blueprint: (id?: string) => void;
    material: (id?: string) => void;
    particleSystem: (id?: string) => void;
    animation: (id?: string) => void;
    variable: (id?: string) => void;
    dataAsset: (id?: string) => void;
    uiDocument: (id?: string) => void;
  },
) {
  for (const node of nodes) {
    const data = node.data;
    if (!data) continue;
    add.asset(data.assetId);
    add.asset(data.projectileBlastSound);
    add.prefab(data.prefabId);
    add.blueprint(data.castBlueprintId);
    add.particleSystem(data.particleSystemId);
    add.animation(data.animationId);
    add.variable(data.variableId);
    add.dataAsset(data.tableId);
    add.uiDocument(data.documentId);
  }
}

/** Scan a UI element subtree for image asset references. */
function scanUIElement(element: UIElement, addAsset: (id?: string) => void) {
  addAsset(element.assetId);
  for (const child of element.children ?? []) scanUIElement(child, addAsset);
}

/** Which entity buckets a package collection can be seeded from. */
export type PackageSeeds = Partial<{
  prefabs: string[];
  blueprints: string[];
  materials: string[];
  particleSystems: string[];
  animatorControllers: string[];
  dataAssets: string[];
  uiDocuments: string[];
  assets: string[];
}>;

/**
 * Collect the full dependency closure of a prefab into a transferable PackageContent + asset id set.
 * Returns null if the prefab id isn't found. Pure — reads only from `src`.
 */
export function collectPrefabPackage(
  src: PackageSource,
  prefabId: string,
): { content: PackageContent; assetIds: string[] } | null {
  const seed = src.prefabs.find((p) => p.id === prefabId);
  if (!seed) return null;
  return collectPackage(src, { prefabs: [prefabId] });
}

/**
 * Collect a closure from an arbitrary set of seed entities (used for "export folder" — like Unreal's
 * Migrate). Every seeded entity plus everything it transitively references is gathered. Pure.
 */
export function collectPackage(
  src: PackageSource,
  seeds: PackageSeeds,
): { content: PackageContent; assetIds: string[] } {
  const ids = {
    prefab: new Set<string>(),
    blueprint: new Set<string>(),
    graph: new Set<string>(),
    material: new Set<string>(),
    particleSystem: new Set<string>(),
    skeleton: new Set<string>(),
    skeletalMesh: new Set<string>(),
    animation: new Set<string>(),
    animatorController: new Set<string>(),
    dataAsset: new Set<string>(),
    uiDocument: new Set<string>(),
    variable: new Set<string>(),
    asset: new Set<string>(),
  };
  const addTo = (set: Set<string>) => (id?: string) => {
    if (id) set.add(id);
  };
  const add = {
    prefab: addTo(ids.prefab),
    blueprint: addTo(ids.blueprint),
    graph: addTo(ids.graph),
    material: addTo(ids.material),
    particleSystem: addTo(ids.particleSystem),
    skeleton: addTo(ids.skeleton),
    skeletalMesh: addTo(ids.skeletalMesh),
    animation: addTo(ids.animation),
    animatorController: addTo(ids.animatorController),
    dataAsset: addTo(ids.dataAsset),
    uiDocument: addTo(ids.uiDocument),
    variable: addTo(ids.variable),
    asset: addTo(ids.asset),
  };

  /** Pull every id referenced by a captured object's components into the buckets. */
  const scanObject = (object: SceneObject) => {
    // A nested prefab INSTANCE inside this prefab pulls its source prefab into the closure too —
    // without this, exporting a prefab-of-prefabs shipped ghosts.
    add.prefab(object.prefabSourceId);
    add.asset(object.renderer?.modelAssetId);
    add.asset(object.renderer?.textureAssetId);
    add.material(object.renderer?.materialId);
    add.blueprint(object.script?.blueprintId);
    add.graph(object.script?.graphId);
    add.animatorController(object.animator?.controllerId);
    add.animation(object.animator?.animationId);
    add.skeletalMesh(object.animator?.skeletalMeshId);
    add.uiDocument(object.ui?.documentId);
    add.particleSystem(object.particles?.systemId);
    add.asset(object.particles?.textureAssetId);
    const c = object.character;
    if (c) [c.footstepSoundId, c.jumpSoundId, c.landSoundId, c.swimSoundId, c.attackSoundId, c.hurtSoundId].forEach(add.asset);
    const v = object.vehicle;
    if (v) {
      [v.engineSoundId, v.skidSoundId, v.brakeSoundId, v.hornSoundId, v.collisionSoundId].forEach(add.asset);
      (v.garageBodyIds ?? []).forEach(add.asset);
    }
    for (const layer of object.terrain?.materialLayers ?? []) {
      add.asset(layer.textureAssetId);
      add.asset(layer.normalMapAssetId);
    }
    add.asset(object.terrain?.foliage?.grassModelAssetId);
    add.asset(object.terrain?.foliage?.treeModelAssetId);
    for (const slot of object.inventory?.slots ?? []) {
      add.asset(slot.weaponAssetId);
      add.animation(slot.equipAnimId);
    }
    add.asset(object.inventory?.switchSoundId);
  };

  // Seed the buckets directly from the requested entities; the closure walk pulls in the rest.
  seeds.prefabs?.forEach(add.prefab);
  seeds.blueprints?.forEach(add.blueprint);
  seeds.materials?.forEach(add.material);
  seeds.particleSystems?.forEach(add.particleSystem);
  seeds.animatorControllers?.forEach(add.animatorController);
  seeds.dataAssets?.forEach(add.dataAsset);
  seeds.uiDocuments?.forEach(add.uiDocument);
  seeds.assets?.forEach(add.asset);

  // Fixed-point: keep re-scanning every included entity until no new ids appear. Package-sized, so cheap.
  let changed = true;
  while (changed) {
    const before = Object.values(ids).reduce((sum, set) => sum + set.size, 0);

    for (const prefab of src.prefabs.filter((p) => ids.prefab.has(p.id))) {
      for (const object of prefab.objects) scanObject(object);
    }
    for (const bp of src.blueprints.filter((b) => ids.blueprint.has(b.id))) {
      add.graph(bp.graphId);
    }
    for (const graph of src.graphs.filter((g) => ids.graph.has(g.id))) {
      scanGraphNodeRefs(graph.nodes, add);
    }
    for (const mat of src.materials.filter((m) => ids.material.has(m.id))) {
      add.asset(mat.textureAssetId);
      add.asset(mat.normalMapAssetId);
      add.graph(mat.graphId);
    }
    for (const ps of src.particleSystems.filter((p) => ids.particleSystem.has(p.id))) {
      add.asset(ps.textureAssetId);
    }
    for (const ac of src.animatorControllers.filter((a) => ids.animatorController.has(a.id))) {
      add.skeleton(ac.skeletonId);
      for (const state of ac.states) add.animation(state.animationId);
      for (const param of ac.parameters) add.variable(param.variableId);
    }
    for (const anim of src.animations.filter((a) => ids.animation.has(a.id))) {
      add.asset(anim.sourceAssetId);
      add.skeleton(anim.skeletonId);
    }
    for (const sm of src.skeletalMeshes.filter((s) => ids.skeletalMesh.has(s.id))) {
      add.asset(sm.sourceAssetId);
      add.skeleton(sm.skeletonId);
    }
    for (const sk of src.skeletons.filter((s) => ids.skeleton.has(s.id))) {
      add.asset(sk.sourceAssetId);
    }
    for (const doc of src.uiDocuments.filter((d) => ids.uiDocument.has(d.id))) {
      scanUIElement(doc.root, add.asset);
      add.blueprint(doc.logicBlueprintId);
    }

    const after = Object.values(ids).reduce((sum, set) => sum + set.size, 0);
    changed = after !== before;
  }

  const pick = <T extends { id: string }>(arr: T[], set: Set<string>) => arr.filter((item) => set.has(item.id));

  const content: PackageContent = {
    prefabs: pick(src.prefabs, ids.prefab),
    blueprints: pick(src.blueprints, ids.blueprint),
    graphs: pick(src.graphs, ids.graph),
    materials: pick(src.materials, ids.material),
    particleSystems: pick(src.particleSystems, ids.particleSystem),
    skeletons: pick(src.skeletons, ids.skeleton),
    skeletalMeshes: pick(src.skeletalMeshes, ids.skeletalMesh),
    animations: pick(src.animations, ids.animation),
    animatorControllers: pick(src.animatorControllers, ids.animatorController),
    dataAssets: pick(src.dataAssets, ids.dataAsset),
    uiDocuments: pick(src.uiDocuments, ids.uiDocument),
    variables: pick(src.variables, ids.variable),
  };

  return { content, assetIds: [...ids.asset] };
}

// ---------------------------------------------------------------------------------------------
// Import remap — regenerate every id and rewrite every reference so the import can't collide
// with the host project. This is what keeps imports additive and non-destructive.
// ---------------------------------------------------------------------------------------------

type IdMap = Map<string, string>;

/** Look up a remapped id, leaving foreign ids (not in this package) untouched. */
const remap = (map: IdMap, id?: string) => (id && map.has(id) ? map.get(id)! : id);

export interface RemapResult {
  content: PackageContent;
  assets: AssetItem[];
  /** old prefab id -> new prefab id, so the caller can instantiate the imported prefab. */
  prefabIdMap: Record<string, string>;
}

/**
 * Produce import-ready content: fresh ids for every entity, all cross-references rewritten, asset
 * bytes carried through (their runtime url/path is resolved by the caller). `existingSkeletons` lets
 * us dedupe identical rigs by signature instead of importing a second copy. Pure.
 */
export function remapPackageForImport(
  pkg: NodeForgePackage,
  existingSkeletons: SkeletonAsset[] = [],
): RemapResult {
  const c = structuredClone(pkg.content) as PackageContent;

  // 1. Allocate fresh top-level ids for everything we will actually add.
  const maps = {
    prefab: new Map<string, string>(),
    blueprint: new Map<string, string>(),
    graph: new Map<string, string>(),
    material: new Map<string, string>(),
    particleSystem: new Map<string, string>(),
    skeleton: new Map<string, string>(),
    skeletalMesh: new Map<string, string>(),
    animation: new Map<string, string>(),
    animatorController: new Map<string, string>(),
    dataAsset: new Map<string, string>(),
    uiDocument: new Map<string, string>(),
    variable: new Map<string, string>(),
    asset: new Map<string, string>(),
    object: new Map<string, string>(),
    // UI element ids are regenerated on import; graph nodes (Set UI Text) reference them, so the
    // old→new mapping is allocated UP FRONT and applied in BOTH rewriteUIElement and rewriteGraph.
    uiElement: new Map<string, string>(),
  };

  // Skeletons: reuse an existing identical rig (by signature) when present; otherwise import fresh.
  const importedSkeletons: SkeletonAsset[] = [];
  for (const sk of c.skeletons) {
    const match = existingSkeletons.find((e) => e.signature && e.signature === sk.signature);
    if (match) {
      maps.skeleton.set(sk.id, match.id);
    } else {
      const id = newId('skeleton');
      maps.skeleton.set(sk.id, id);
      importedSkeletons.push(sk);
    }
  }

  c.prefabs.forEach((p) => maps.prefab.set(p.id, newId('prefab')));
  c.blueprints.forEach((b) => maps.blueprint.set(b.id, newId('blueprint')));
  c.graphs.forEach((g) => maps.graph.set(g.id, newId('graph')));
  c.materials.forEach((m) => maps.material.set(m.id, newId('material')));
  c.particleSystems.forEach((p) => maps.particleSystem.set(p.id, newId('particles')));
  c.skeletalMeshes.forEach((s) => maps.skeletalMesh.set(s.id, newId('skelmesh')));
  c.animations.forEach((a) => maps.animation.set(a.id, newId('anim')));
  c.animatorControllers.forEach((a) => maps.animatorController.set(a.id, newId('animator')));
  c.dataAssets.forEach((d) => maps.dataAsset.set(d.id, newId('data')));
  c.uiDocuments.forEach((d) => maps.uiDocument.set(d.id, newId('ui')));
  c.variables.forEach((v) => maps.variable.set(v.id, newId('var')));
  pkg.assets.forEach((a) => maps.asset.set(a.id, newId('asset')));
  // Every object across every prefab gets a fresh id (refs between them are rewritten below).
  c.prefabs.forEach((p) => p.objects.forEach((o) => maps.object.set(o.id, newId('obj'))));
  // Allocate UI element ids before any rewriting so graph nodes can be remapped in the same pass.
  const allocElementIds = (element: UIElement) => {
    maps.uiElement.set(element.id, newId('uiel'));
    for (const child of element.children ?? []) allocElementIds(child);
  };
  c.uiDocuments.forEach((doc) => allocElementIds(doc.root));

  // 2. Rewrite a captured object's components.
  const rewriteObject = (object: SceneObject): SceneObject => {
    const o = object;
    o.id = remap(maps.object, o.id)!;
    if (o.parentId) o.parentId = remap(maps.object, o.parentId);
    if (o.prefabSourceId) o.prefabSourceId = remap(maps.prefab, o.prefabSourceId);
    if (o.renderer) {
      o.renderer.modelAssetId = remap(maps.asset, o.renderer.modelAssetId);
      o.renderer.textureAssetId = remap(maps.asset, o.renderer.textureAssetId);
      o.renderer.materialId = remap(maps.material, o.renderer.materialId);
    }
    if (o.script) {
      o.script.blueprintId = remap(maps.blueprint, o.script.blueprintId)!;
      o.script.graphId = remap(maps.graph, o.script.graphId)!;
    }
    if (o.animator) {
      o.animator.controllerId = remap(maps.animatorController, o.animator.controllerId);
      o.animator.animationId = remap(maps.animation, o.animator.animationId);
      o.animator.skeletalMeshId = remap(maps.skeletalMesh, o.animator.skeletalMeshId);
    }
    if (o.ui) o.ui.documentId = remap(maps.uiDocument, o.ui.documentId)!;
    if (o.attachment) o.attachment.targetObjectId = remap(maps.object, o.attachment.targetObjectId)!;
    if (o.viewModel) o.viewModel.ownerObjectId = remap(maps.object, o.viewModel.ownerObjectId)!;
    if (o.projectile) o.projectile.ownerId = remap(maps.object, o.projectile.ownerId)!;
    if (o.particles) {
      o.particles.systemId = remap(maps.particleSystem, o.particles.systemId);
      o.particles.textureAssetId = remap(maps.asset, o.particles.textureAssetId);
    }
    if (o.character) {
      const ch = o.character;
      ch.footstepSoundId = remap(maps.asset, ch.footstepSoundId);
      ch.jumpSoundId = remap(maps.asset, ch.jumpSoundId);
      ch.landSoundId = remap(maps.asset, ch.landSoundId);
      ch.swimSoundId = remap(maps.asset, ch.swimSoundId);
      ch.attackSoundId = remap(maps.asset, ch.attackSoundId);
      ch.hurtSoundId = remap(maps.asset, ch.hurtSoundId);
    }
    if (o.vehicle) {
      const v = o.vehicle;
      v.wheelObjectIds = v.wheelObjectIds.map((id) => remap(maps.object, id)!);
      v.steeredWheelIds = v.steeredWheelIds.map((id) => remap(maps.object, id)!);
      v.tireMarkIds = (v.tireMarkIds ?? []).map((id) => remap(maps.object, id)!);
      v.headlightIds = v.headlightIds.map((id) => remap(maps.object, id)!);
      v.brakeLightIds = v.brakeLightIds.map((id) => remap(maps.object, id)!);
      v.boostFlameIds = (v.boostFlameIds ?? []).map((id) => remap(maps.object, id)!);
      v.brakeDiscIds = (v.brakeDiscIds ?? []).map((id) => remap(maps.object, id)!);
      v.loosePartIds = (v.loosePartIds ?? []).map((id) => remap(maps.object, id)!);
      v.garageBodyIds = (v.garageBodyIds ?? []).map((id) => remap(maps.asset, id)!);
      v.wheels = (v.wheels ?? []).map((wheel) => ({ ...wheel, objectId: remap(maps.object, wheel.objectId)! }));
      v.engineSoundId = remap(maps.asset, v.engineSoundId);
      v.skidSoundId = remap(maps.asset, v.skidSoundId);
      v.brakeSoundId = remap(maps.asset, v.brakeSoundId);
      v.hornSoundId = remap(maps.asset, v.hornSoundId);
      v.collisionSoundId = remap(maps.asset, v.collisionSoundId);
    }
    // Physics joints link to another body by object id — without this an imported jointed rig falls apart.
    if (o.joint?.connectedObjectId) o.joint.connectedObjectId = remap(maps.object, o.joint.connectedObjectId);
    // A cable's far end attaches to another object by id — remap it so an imported cable stays connected.
    if (o.cable?.endObjectId) o.cable.endObjectId = remap(maps.object, o.cable.endObjectId);
    if (o.terrain) {
      for (const layer of o.terrain.materialLayers ?? []) {
        layer.id = newId('layer');
        layer.textureAssetId = remap(maps.asset, layer.textureAssetId);
        layer.normalMapAssetId = remap(maps.asset, layer.normalMapAssetId);
      }
      if (o.terrain.foliage) {
        o.terrain.foliage.grassModelAssetId = remap(maps.asset, o.terrain.foliage.grassModelAssetId);
        o.terrain.foliage.treeModelAssetId = remap(maps.asset, o.terrain.foliage.treeModelAssetId);
      }
    }
    if (o.inventory) {
      for (const slot of o.inventory.slots ?? []) {
        slot.weaponAssetId = remap(maps.asset, slot.weaponAssetId);
        slot.equipAnimId = remap(maps.animation, slot.equipAnimId);
      }
      o.inventory.switchSoundId = remap(maps.asset, o.inventory.switchSoundId);
    }
    return o;
  };

  // 3. Rewrite graph node data refs (graphs are otherwise isolated, so node ids stay as-is).
  const rewriteGraph = (graph: ProjectGraph) => {
    graph.id = remap(maps.graph, graph.id)!;
    for (const node of graph.nodes) {
      const d = node.data;
      if (!d) continue;
      if (d.assetId) d.assetId = remap(maps.asset, d.assetId);
      if (d.prefabId) d.prefabId = remap(maps.prefab, d.prefabId);
      if (d.castBlueprintId) d.castBlueprintId = remap(maps.blueprint, d.castBlueprintId);
      if (d.particleSystemId) d.particleSystemId = remap(maps.particleSystem, d.particleSystemId);
      if (d.animationId) d.animationId = remap(maps.animation, d.animationId);
      if (d.variableId) d.variableId = remap(maps.variable, d.variableId);
      if (d.tableId) d.tableId = remap(maps.dataAsset, d.tableId);
      if (d.documentId) d.documentId = remap(maps.uiDocument, d.documentId);
      if (d.targetObjectId) d.targetObjectId = remap(maps.object, d.targetObjectId);
      if (d.otherObjectId) d.otherObjectId = remap(maps.object, d.otherObjectId);
      if (d.projectileTemplateId) d.projectileTemplateId = remap(maps.object, d.projectileTemplateId);
      if (d.projectileBlastSound) d.projectileBlastSound = remap(maps.asset, d.projectileBlastSound);
      if (d.elementId) d.elementId = remap(maps.uiElement, d.elementId);
      // Scenes and cinematics are PROJECT-level and never travel inside a package — a dangling id
      // here would silently no-op at runtime in the importing project. Clear them so the node reads
      // as "unset" in the editor (and the Problems panel can point at it) instead of lying.
      if (d.cinematicId) d.cinematicId = undefined;
      if (d.targetSceneId) d.targetSceneId = undefined;
    }
  };

  const rewriteUIElement = (element: UIElement) => {
    element.id = remap(maps.uiElement, element.id) ?? newId('uiel');
    element.assetId = remap(maps.asset, element.assetId);
    for (const child of element.children ?? []) rewriteUIElement(child);
  };

  // 4. Apply across all entity collections. Drop folderId so imports land at the project root.
  for (const prefab of c.prefabs) {
    prefab.id = remap(maps.prefab, prefab.id)!;
    prefab.folderId = undefined;
    prefab.objects = prefab.objects.map(rewriteObject);
    prefab.rootId = remap(maps.object, prefab.rootId)!;
  }
  for (const bp of c.blueprints) {
    bp.id = remap(maps.blueprint, bp.id)!;
    bp.graphId = remap(maps.graph, bp.graphId)!;
    bp.folderId = undefined;
  }
  c.graphs.forEach(rewriteGraph);
  for (const mat of c.materials) {
    mat.id = remap(maps.material, mat.id)!;
    mat.textureAssetId = remap(maps.asset, mat.textureAssetId);
    mat.normalMapAssetId = remap(maps.asset, mat.normalMapAssetId);
    mat.graphId = remap(maps.graph, mat.graphId);
    mat.folderId = undefined;
  }
  for (const ps of c.particleSystems) {
    ps.id = remap(maps.particleSystem, ps.id)!;
    ps.textureAssetId = remap(maps.asset, ps.textureAssetId);
    ps.folderId = undefined;
  }
  for (const ac of c.animatorControllers) {
    ac.id = remap(maps.animatorController, ac.id)!;
    ac.skeletonId = remap(maps.skeleton, ac.skeletonId);
    ac.folderId = undefined;
    // Re-id internal parameter/state/transition ids and rewire the references between them.
    const paramMap: IdMap = new Map();
    const stateMap: IdMap = new Map();
    ac.parameters.forEach((p) => paramMap.set(p.id, newId('param')));
    ac.states.forEach((s) => stateMap.set(s.id, newId('state')));
    for (const param of ac.parameters) {
      param.id = paramMap.get(param.id)!;
      param.variableId = remap(maps.variable, param.variableId);
    }
    for (const state of ac.states) {
      state.id = stateMap.get(state.id)!;
      state.animationId = remap(maps.animation, state.animationId);
      state.blendParameterId = remap(paramMap, state.blendParameterId);
      state.blendParameterIdY = remap(paramMap, state.blendParameterIdY);
    }
    for (const t of ac.transitions) {
      t.id = newId('trans');
      if (t.from !== 'any') t.from = remap(stateMap, t.from)!;
      t.to = remap(stateMap, t.to)!;
      for (const cond of t.conditions) cond.parameterId = remap(paramMap, cond.parameterId)!;
    }
    ac.defaultStateId = remap(stateMap, ac.defaultStateId);
  }
  for (const anim of c.animations) {
    anim.id = remap(maps.animation, anim.id)!;
    anim.sourceAssetId = remap(maps.asset, anim.sourceAssetId)!;
    anim.skeletonId = remap(maps.skeleton, anim.skeletonId)!;
    anim.folderId = undefined;
  }
  for (const sm of c.skeletalMeshes) {
    sm.id = remap(maps.skeletalMesh, sm.id)!;
    sm.sourceAssetId = remap(maps.asset, sm.sourceAssetId)!;
    sm.skeletonId = remap(maps.skeleton, sm.skeletonId)!;
    sm.folderId = undefined;
  }
  for (const sk of importedSkeletons) {
    sk.id = remap(maps.skeleton, sk.id)!;
    sk.sourceAssetId = remap(maps.asset, sk.sourceAssetId)!;
    for (const socket of sk.sockets ?? []) socket.id = newId('socket');
    sk.folderId = undefined;
  }
  for (const doc of c.uiDocuments) {
    doc.id = remap(maps.uiDocument, doc.id)!;
    doc.logicBlueprintId = remap(maps.blueprint, doc.logicBlueprintId);
    doc.folderId = undefined;
    rewriteUIElement(doc.root);
  }
  for (const data of c.dataAssets) {
    data.id = remap(maps.dataAsset, data.id)!;
    data.folderId = undefined;
  }
  for (const v of c.variables) {
    v.id = remap(maps.variable, v.id)!;
  }

  // 5. Assets: fresh ids + carry bytes; strip path/url (the caller re-imports the bytes per platform).
  const assets: AssetItem[] = pkg.assets.map((asset) => ({
    ...asset,
    id: remap(maps.asset, asset.id)!,
    path: undefined,
    url: undefined,
    folderId: undefined,
  }));

  // Only emit the skeletons we actually imported (deduped ones reuse an existing rig).
  c.skeletons = importedSkeletons;

  const prefabIdMap: Record<string, string> = {};
  maps.prefab.forEach((to, from) => {
    prefabIdMap[from] = to;
  });

  return { content: c, assets, prefabIdMap };
}

/** Assemble a package envelope around already-collected content + embedded assets. */
export function buildPackage(
  kind: PackageKind,
  content: PackageContent,
  assets: AssetItem[],
  meta: Omit<PackageMeta, 'engineVersion' | 'createdAt'> & { createdAt?: string },
): NodeForgePackage {
  return {
    format: PACKAGE_FORMAT,
    formatVersion: PACKAGE_VERSION,
    kind,
    meta: {
      ...meta,
      createdAt: meta.createdAt ?? new Date().toISOString(),
      engineVersion: PROJECT_VERSION,
    },
    content,
    assets,
  };
}
