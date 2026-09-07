import type { ExportProfile, NodeForgeProject, SceneObject } from '../types';
import { validateExportProfile } from './exportProfiles';

export const RUNTIME_CONTRACT_VERSION = '1.1.0';

export const SUPPORTED_RUNTIME_FEATURES = [
  'multi-scene',
  'blueprints',
  'keyboard-press-events',
  'featherscript',
  'ui-dom',
  'ui-webgl',
  'world-ui',
  'attachments',
  'physics',
  'characters',
  'vehicles',
  'navigation',
  'terrain',
  'trees',
  'water',
  'cloth',
  'cables',
  'particles',
  'animation',
  'cinematics',
  'audio',
  'materials',
  'prefabs',
  'inventory',
  'destruction',
  'reflection-probes',
  'lux-lighting',
  'persistence',
  'timelines',
  'post-processing',
] as const;

export type RuntimeFeatureId = (typeof SUPPORTED_RUNTIME_FEATURES)[number];

export interface RuntimeContract {
  version: string;
  requiredFeatures: RuntimeFeatureId[];
}

export interface RuntimeCompatibilityReport {
  features: RuntimeFeatureId[];
  errors: string[];
  warnings: string[];
}

const featureOrder = new Map(SUPPORTED_RUNTIME_FEATURES.map((feature, index) => [feature, index]));
const sortFeatures = (features: Set<RuntimeFeatureId>) =>
  [...features].sort((a, b) => (featureOrder.get(a) ?? 0) - (featureOrder.get(b) ?? 0));

const allObjects = (project: NodeForgeProject): SceneObject[] => [
  ...project.scenes.flatMap((scene) => scene.objects ?? []),
  ...(project.prefabs ?? []).flatMap((prefab) => prefab.objects ?? []),
];

/** Detect every authored engine subsystem the standalone runtime must carry for this project. */
export function detectRuntimeFeatures(project: NodeForgeProject): RuntimeFeatureId[] {
  const features = new Set<RuntimeFeatureId>();
  if (project.scenes.some((scene) => scene.environment?.lux?.enabled)) features.add('lux-lighting');
  const objects = allObjects(project);
  const nodes = (project.graphs ?? []).flatMap((graph) => graph.nodes ?? []);
  const nodeKinds = new Set(nodes.map((node) => String(node.data.nodeKind ?? '')));
  if (nodes.some((node) => node.data.nodeKind === 'event.keyDown' && node.data.keyTriggerMode === 'pressed')) features.add('keyboard-press-events');

  if (project.scenes.length > 1 || nodeKinds.has('action.loadScene')) features.add('multi-scene');
  if ((project.blueprints?.length ?? 0) > 0 || objects.some((object) => object.script?.enabled)) {
    features.add('blueprints');
  }
  if ((project.blueprints ?? []).some((blueprint) => Boolean((blueprint as { featherSource?: string }).featherSource))) {
    features.add('featherscript');
  }
  if ((project.uiDocuments ?? []).some((document) => (document.renderMode ?? 'dom') === 'dom')) features.add('ui-dom');
  if ((project.uiDocuments ?? []).some((document) => document.renderMode === 'webgl')) features.add('ui-webgl');
  if (objects.some((object) => Boolean(object.ui))) features.add('world-ui');
  if (
    objects.some((object) => Boolean(object.attachment || object.viewModel)) ||
    nodeKinds.has('action.spawnAttached')
  ) {
    features.add('attachments');
  }
  if (
    objects.some((object) => object.physics?.enabled || object.joint) ||
    (project.skeletons ?? []).some((skeleton) => Boolean(skeleton.ragdoll))
  ) {
    features.add('physics');
  }
  if (objects.some((object) => object.character?.enabled)) features.add('characters');
  if (objects.some((object) => object.vehicle?.enabled)) features.add('vehicles');
  if (nodeKinds.has('action.moveTo')) features.add('navigation');
  if (objects.some((object) => object.terrain?.enabled)) features.add('terrain');
  if (objects.some((object) => object.tree?.enabled)) features.add('trees');
  if (objects.some((object) => object.water?.enabled)) features.add('water');
  if (objects.some((object) => object.cloth?.enabled)) features.add('cloth');
  if (objects.some((object) => object.cable?.enabled)) features.add('cables');
  if ((project.particleSystems?.length ?? 0) > 0 || objects.some((object) => object.particles?.enabled)) {
    features.add('particles');
  }
  if (
    (project.animations?.length ?? 0) > 0 ||
    (project.animatorControllers?.length ?? 0) > 0 ||
    objects.some((object) => object.animator?.enabled)
  ) {
    features.add('animation');
  }
  if (project.scenes.some((scene) => (scene.cinematics?.length ?? 0) > 0)) features.add('cinematics');
  if (
    project.scenes.some((scene) => Boolean(scene.ambientSoundId || scene.musicSoundId)) ||
    (project.assets ?? []).some((asset) => asset.type === 'audio') ||
    nodeKinds.has('action.playSound')
  ) {
    features.add('audio');
  }
  if ((project.materials?.length ?? 0) > 0) features.add('materials');
  if ((project.prefabs?.length ?? 0) > 0 || nodeKinds.has('action.spawnPrefab')) features.add('prefabs');
  if (objects.some((object) => Boolean(object.inventory))) features.add('inventory');
  if (objects.some((object) => object.fracture?.enabled) || nodeKinds.has('action.fractureObject')) {
    features.add('destruction');
  }
  if (objects.some((object) => object.reflectionProbe?.enabled)) features.add('reflection-probes');
  if ([...nodeKinds].some((kind) => kind.startsWith('save.'))) features.add('persistence');
  if (nodeKinds.has('action.tweenProperty') || nodeKinds.has('action.timelineControl')) features.add('timelines');
  if (project.renderSettings) features.add('post-processing');

  return sortFeatures(features);
}

export function buildRuntimeContract(project: NodeForgeProject): RuntimeContract {
  return { version: RUNTIME_CONTRACT_VERSION, requiredFeatures: detectRuntimeFeatures(project) };
}

/** Refuse bundles produced by a newer player contract or requiring unknown runtime subsystems. */
export function validateRuntimeContract(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return [];
  const contract = raw as Partial<RuntimeContract>;
  const errors: string[] = [];
  const parseVersion = (value: unknown) => {
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(String(value ?? ''));
    return match ? match.slice(1).map(Number) : null;
  };
  const current = parseVersion(RUNTIME_CONTRACT_VERSION)!;
  const requested = parseVersion(contract.version);
  const isFuture =
    !requested || requested.some((part, index) => part > current[index]! && requested.slice(0, index).every((value, prior) => value === current[prior]));
  if (isFuture) {
    errors.push(
      `This game requires runtime contract ${String(contract.version)}; this player supports ${RUNTIME_CONTRACT_VERSION}. Re-export with the current engine.`,
    );
  }
  const supported = new Set<string>(SUPPORTED_RUNTIME_FEATURES);
  if (!Array.isArray(contract.requiredFeatures)) {
    errors.push('Runtime contract requiredFeatures must be an array.');
  } else {
    for (const feature of contract.requiredFeatures) {
      if (!supported.has(String(feature))) errors.push(`This player does not support required runtime feature: ${String(feature)}`);
    }
  }
  return errors;
}

const duplicateIds = (label: string, ids: string[], errors: string[]) => {
  const seen = new Set<string>();
  for (const id of ids) {
    if (!id) errors.push(`${label} contains an empty id.`);
    else if (seen.has(id)) errors.push(`${label} contains duplicate id: ${id}`);
    seen.add(id);
  }
};

/**
 * Validate the authored dependency graph that drives Play. Missing runtime references are blocking:
 * silently skipping a Blueprint/widget/controller would make the exported game differ from preview.
 */
export function validateRuntimeReferences(
  project: NodeForgeProject,
  startSceneId: string,
  profile?: ExportProfile,
): RuntimeCompatibilityReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const scenes = new Set(project.scenes.map((scene) => scene.id));
  const blueprints = new Map((project.blueprints ?? []).map((blueprint) => [blueprint.id, blueprint]));
  const graphs = new Set((project.graphs ?? []).map((graph) => graph.id));
  const uiDocuments = new Set((project.uiDocuments ?? []).map((document) => document.id));
  const materials = new Set((project.materials ?? []).map((material) => material.id));
  const particles = new Set((project.particleSystems ?? []).map((system) => system.id));
  const controllers = new Set((project.animatorControllers ?? []).map((controller) => controller.id));
  const animations = new Set((project.animations ?? []).map((animation) => animation.id));
  const skeletalMeshes = new Set((project.skeletalMeshes ?? []).map((mesh) => mesh.id));
  const skeletons = new Set((project.skeletons ?? []).map((skeleton) => skeleton.id));
  const treeSpecs = new Set((project.treeSpecs ?? []).map((spec) => spec.id));
  const prefabs = new Set((project.prefabs ?? []).map((prefab) => prefab.id));
  const assets = new Set((project.assets ?? []).map((asset) => asset.id));
  const variables = new Set((project.variables ?? []).map((variable) => variable.id));
  const dataAssets = new Set((project.dataAssets ?? []).map((asset) => asset.id));
  const cinematicsByScene = new Map(
    project.scenes.map((scene) => [scene.id, new Set((scene.cinematics ?? []).map((sequence) => sequence.id))]),
  );
  const allCinematics = new Set(
    project.scenes.flatMap((scene) => (scene.cinematics ?? []).map((sequence) => sequence.id)),
  );
  const graphScenes = new Map<string, Set<string>>();
  for (const scene of project.scenes) {
    for (const object of scene.objects ?? []) {
      if (!object.script?.enabled) continue;
      const scopes = graphScenes.get(object.script.graphId) ?? new Set<string>();
      scopes.add(scene.id);
      graphScenes.set(object.script.graphId, scopes);
    }
  }

  duplicateIds('Scenes', project.scenes.map((scene) => scene.id), errors);
  duplicateIds('Blueprints', (project.blueprints ?? []).map((blueprint) => blueprint.id), errors);
  duplicateIds('Graphs', (project.graphs ?? []).map((graph) => graph.id), errors);
  duplicateIds('UI documents', (project.uiDocuments ?? []).map((document) => document.id), errors);
  duplicateIds('Materials', (project.materials ?? []).map((material) => material.id), errors);
  duplicateIds('Particle systems', (project.particleSystems ?? []).map((system) => system.id), errors);
  duplicateIds('Skeletons', (project.skeletons ?? []).map((skeleton) => skeleton.id), errors);
  duplicateIds('Skeletal meshes', (project.skeletalMeshes ?? []).map((mesh) => mesh.id), errors);
  duplicateIds('Animations', (project.animations ?? []).map((animation) => animation.id), errors);
  duplicateIds('Animator controllers', (project.animatorControllers ?? []).map((controller) => controller.id), errors);
  duplicateIds('Prefabs', (project.prefabs ?? []).map((prefab) => prefab.id), errors);
  for (const scene of project.scenes) {
    duplicateIds(
      `Scene "${scene.name}" cinematics`,
      (scene.cinematics ?? []).map((sequence) => sequence.id),
      errors,
    );
  }

  if (!scenes.has(startSceneId)) errors.push(`Launch scene does not exist: ${startSceneId}`);
  if (profile) {
    errors.push(...validateExportProfile(profile, [...scenes]));
    if (profile.startSceneId !== startSceneId) {
      errors.push(
        `Bundle launch scene (${startSceneId}) does not match build profile launch scene (${profile.startSceneId}).`,
      );
    }
  }

  for (const blueprint of blueprints.values()) {
    if (!graphs.has(blueprint.graphId)) errors.push(`Blueprint "${blueprint.name}" references missing graph ${blueprint.graphId}.`);
  }

  for (const document of project.uiDocuments ?? []) {
    if (document.logicBlueprintId && !blueprints.has(document.logicBlueprintId)) {
      errors.push(`UI document "${document.name}" references missing logic Blueprint ${document.logicBlueprintId}.`);
    }
    const visitElement = (element: typeof document.root) => {
      if (element.kind === 'component' && element.componentId && !uiDocuments.has(element.componentId)) {
        errors.push(
          `UI document "${document.name}" element "${element.name}" references missing component ${element.componentId}.`,
        );
      }
      for (const child of element.children ?? []) visitElement(child);
    };
    visitElement(document.root);
  }

  for (const material of project.materials ?? []) {
    if (material.graphId && !graphs.has(material.graphId)) {
      errors.push(`Material "${material.name}" references missing graph ${material.graphId}.`);
    }
  }

  for (const skeleton of project.skeletons ?? []) {
    if (!assets.has(skeleton.sourceAssetId)) {
      errors.push(`Skeleton "${skeleton.name}" references missing source asset ${skeleton.sourceAssetId}.`);
    }
  }
  for (const mesh of project.skeletalMeshes ?? []) {
    if (!assets.has(mesh.sourceAssetId)) {
      errors.push(`Skeletal mesh "${mesh.name}" references missing source asset ${mesh.sourceAssetId}.`);
    }
    if (!skeletons.has(mesh.skeletonId)) {
      errors.push(`Skeletal mesh "${mesh.name}" references missing skeleton ${mesh.skeletonId}.`);
    }
  }
  for (const animation of project.animations ?? []) {
    if (!assets.has(animation.sourceAssetId)) {
      errors.push(`Animation "${animation.name}" references missing source asset ${animation.sourceAssetId}.`);
    }
    if (!skeletons.has(animation.skeletonId)) {
      errors.push(`Animation "${animation.name}" references missing skeleton ${animation.skeletonId}.`);
    }
  }
  for (const controller of project.animatorControllers ?? []) {
    const parameterIds = new Set(controller.parameters.map((parameter) => parameter.id));
    const stateIds = new Set(controller.states.map((state) => state.id));
    duplicateIds(`Animator controller "${controller.name}" parameters`, controller.parameters.map((parameter) => parameter.id), errors);
    duplicateIds(`Animator controller "${controller.name}" states`, controller.states.map((state) => state.id), errors);
    if (controller.skeletonId && !skeletons.has(controller.skeletonId)) {
      errors.push(`Animator controller "${controller.name}" references missing skeleton ${controller.skeletonId}.`);
    }
    if (controller.defaultStateId && !stateIds.has(controller.defaultStateId)) {
      errors.push(`Animator controller "${controller.name}" has missing default state ${controller.defaultStateId}.`);
    }
    for (const parameter of controller.parameters) {
      if (parameter.source === 'variable' && parameter.variableId && !variables.has(parameter.variableId)) {
        errors.push(
          `Animator controller "${controller.name}" parameter "${parameter.name}" references missing variable ${parameter.variableId}.`,
        );
      }
    }
    for (const state of controller.states) {
      if (state.animationId && !animations.has(state.animationId)) {
        errors.push(`Animator controller "${controller.name}" state "${state.name}" references missing animation ${state.animationId}.`);
      }
      for (const sample of state.blendSamples ?? []) {
        if (!animations.has(sample.animationId)) {
          errors.push(
            `Animator controller "${controller.name}" state "${state.name}" references missing blend animation ${sample.animationId}.`,
          );
        }
      }
    }
    for (const transition of controller.transitions) {
      if (transition.from !== 'any' && !stateIds.has(transition.from)) {
        errors.push(`Animator controller "${controller.name}" transition references missing state ${transition.from}.`);
      }
      if (!stateIds.has(transition.to)) {
        errors.push(`Animator controller "${controller.name}" transition references missing state ${transition.to}.`);
      }
      for (const condition of transition.conditions) {
        if (!parameterIds.has(condition.parameterId)) {
          errors.push(
            `Animator controller "${controller.name}" transition references missing parameter ${condition.parameterId}.`,
          );
        }
      }
    }
  }

  const validateObjects = (scope: string, objects: SceneObject[]) => {
    const objectIds = new Set(objects.map((object) => object.id));
    duplicateIds(`${scope} objects`, objects.map((object) => object.id), errors);
    for (const object of objects) {
      const label = `${scope} object "${object.name}"`;
      if (object.parentId && !objectIds.has(object.parentId)) errors.push(`${label} references missing parent ${object.parentId}.`);
      if (object.attachment?.targetObjectId && !objectIds.has(object.attachment.targetObjectId)) {
        errors.push(`${label} references missing attachment target ${object.attachment.targetObjectId}.`);
      }
      if (object.viewModel?.ownerObjectId && !objectIds.has(object.viewModel.ownerObjectId)) {
        errors.push(`${label} references missing view-model owner ${object.viewModel.ownerObjectId}.`);
      }
      if (object.joint?.connectedObjectId && !objectIds.has(object.joint.connectedObjectId)) {
        errors.push(`${label} references missing joint body ${object.joint.connectedObjectId}.`);
      }
    }
  };
  for (const scene of project.scenes) validateObjects(`Scene "${scene.name}"`, scene.objects ?? []);
  for (const prefab of project.prefabs ?? []) {
    validateObjects(`Prefab "${prefab.name}"`, prefab.objects ?? []);
    if (!prefab.objects.some((object) => object.id === prefab.rootId)) {
      errors.push(`Prefab "${prefab.name}" references missing root object ${prefab.rootId}.`);
    }
  }

  for (const object of allObjects(project)) {
    const label = `Object "${object.name}"`;
    if (object.script?.enabled) {
      const blueprint = blueprints.get(object.script.blueprintId);
      if (!blueprint) errors.push(`${label} references missing Blueprint ${object.script.blueprintId}.`);
      if (!graphs.has(object.script.graphId)) errors.push(`${label} references missing graph ${object.script.graphId}.`);
      if (blueprint && blueprint.graphId !== object.script.graphId) {
        errors.push(`${label} Blueprint and graph references disagree (${blueprint.graphId} vs ${object.script.graphId}).`);
      }
    }
    if (object.ui && !uiDocuments.has(object.ui.documentId)) errors.push(`${label} references missing UI document ${object.ui.documentId}.`);
    if (object.renderer?.materialId && !materials.has(object.renderer.materialId)) errors.push(`${label} references missing material ${object.renderer.materialId}.`);
    if (object.particles?.systemId && !particles.has(object.particles.systemId)) errors.push(`${label} references missing particle system ${object.particles.systemId}.`);
    if (object.animator?.controllerId && !controllers.has(object.animator.controllerId)) errors.push(`${label} references missing animator controller ${object.animator.controllerId}.`);
    if (object.animator?.animationId && !animations.has(object.animator.animationId)) errors.push(`${label} references missing animation ${object.animator.animationId}.`);
    if (object.animator?.skeletalMeshId && !skeletalMeshes.has(object.animator.skeletalMeshId)) errors.push(`${label} references missing skeletal mesh ${object.animator.skeletalMeshId}.`);
    if (object.tree?.specId && !treeSpecs.has(object.tree.specId)) errors.push(`${label} references missing tree spec ${object.tree.specId}.`);
    for (const slot of object.inventory?.slots ?? []) {
      if (slot.weaponAssetId && !assets.has(slot.weaponAssetId)) errors.push(`${label} inventory references missing weapon asset ${slot.weaponAssetId}.`);
      if (slot.equipAnimId && !animations.has(slot.equipAnimId)) errors.push(`${label} inventory references missing equip animation ${slot.equipAnimId}.`);
    }
    if (object.inventory?.switchSoundId && !assets.has(object.inventory.switchSoundId)) {
      errors.push(`${label} inventory references missing switch audio ${object.inventory.switchSoundId}.`);
    }
  }

  for (const graph of project.graphs ?? []) {
    for (const node of graph.nodes ?? []) {
      const data = node.data;
      const label = `Graph "${graph.name}" node "${data.label || data.nodeKind}"`;
      if (data.documentId && !uiDocuments.has(data.documentId)) errors.push(`${label} references missing UI document ${data.documentId}.`);
      if (data.prefabId && !prefabs.has(data.prefabId)) errors.push(`${label} references missing prefab ${data.prefabId}.`);
      if (data.particleSystemId && !particles.has(data.particleSystemId)) errors.push(`${label} references missing particle system ${data.particleSystemId}.`);
      if (data.animationId && !animations.has(data.animationId)) errors.push(`${label} references missing animation ${data.animationId}.`);
      if (data.cinematicId) {
        const scopedScenes = graphScenes.get(graph.id);
        if (scopedScenes?.size) {
          for (const sceneId of scopedScenes) {
            if (!cinematicsByScene.get(sceneId)?.has(data.cinematicId)) {
              const sceneName = project.scenes.find((scene) => scene.id === sceneId)?.name ?? sceneId;
              errors.push(`${label} references cinematic ${data.cinematicId}, which is missing from scene "${sceneName}".`);
            }
          }
        } else if (!allCinematics.has(data.cinematicId)) {
          errors.push(`${label} references missing cinematic ${data.cinematicId}.`);
        }
      }
      if (data.targetSceneId && !scenes.has(data.targetSceneId)) errors.push(`${label} references missing scene ${data.targetSceneId}.`);
      if (data.assetId && !assets.has(data.assetId)) errors.push(`${label} references missing asset ${data.assetId}.`);
      if (data.castBlueprintId && !blueprints.has(data.castBlueprintId)) errors.push(`${label} references missing Blueprint ${data.castBlueprintId}.`);
      if (data.variableId && !variables.has(data.variableId)) errors.push(`${label} references missing variable ${data.variableId}.`);
      if (data.tableId && !dataAssets.has(data.tableId)) errors.push(`${label} references missing data asset ${data.tableId}.`);
    }
  }

  for (const scene of project.scenes) {
    if (scene.ambientSoundId && !assets.has(scene.ambientSoundId)) errors.push(`Scene "${scene.name}" references missing ambient audio ${scene.ambientSoundId}.`);
    if (scene.musicSoundId && !assets.has(scene.musicSoundId)) errors.push(`Scene "${scene.name}" references missing music audio ${scene.musicSoundId}.`);
    const objectIds = new Set(scene.objects.map((object) => object.id));
    const sceneCinematics = cinematicsByScene.get(scene.id) ?? new Set<string>();
    for (const sequence of scene.cinematics ?? []) {
      for (const action of sequence.actions ?? []) {
        const label = `Cinematic "${sequence.name}" action ${action.id}`;
        for (const objectId of [
          action.objectId,
          action.focusObjectId,
          action.lookAtObjectId,
          action.followObjectId,
        ]) {
          if (objectId && !objectIds.has(objectId)) errors.push(`${label} references missing object ${objectId}.`);
        }
        if (action.cinematicId && !sceneCinematics.has(action.cinematicId)) {
          errors.push(`${label} references missing subsequence ${action.cinematicId} in scene "${scene.name}".`);
        }
        if (action.prefabId && !prefabs.has(action.prefabId)) errors.push(`${label} references missing prefab ${action.prefabId}.`);
        if (action.animationId && !animations.has(action.animationId)) errors.push(`${label} references missing animation ${action.animationId}.`);
        if (action.soundId && !assets.has(action.soundId)) errors.push(`${label} references missing audio ${action.soundId}.`);
      }
    }
  }

  return { features: detectRuntimeFeatures(project), errors: [...new Set(errors)], warnings };
}
