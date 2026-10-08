import { readTitanSettings, isTitanScene, titanZoneScenes, zoneOfScene } from '../titan/settings';
import { currentUIButtonAction } from '../ui/buttonActions';
import { usePerformanceAssistantStore } from '../store/performanceAssistantStore';
import { useBuildCentreStore } from '../store/buildCentreStore';
import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import { usePluginStore } from '../store/pluginStore';
import { useViewportPrefs } from '../store/viewportPrefsStore';
import { withSceneEnvironmentDefaults } from '../three/environmentSettings';
import { getPerfSnapshot } from '../runtime/perfStats';
import { useProjectStore } from '../store/projectStore';
import { gardenController, gardenSeed } from '../towerDefense/settings';
import { useGarden } from '../towerDefense/session';

export type SceneSnapshotDetail = 'tiny' | 'compact' | 'standard' | 'full';

export interface SceneSnapshotOptions {
  detail?: SceneSnapshotDetail;
  limit?: number;
}

const DEFAULT_SNAPSHOT_LIMIT = 16;

const limitItems = <T>(items: T[], limit: number): Array<T | { omitted: number; total: number }> =>
  items.length > limit ? [...items.slice(0, limit), { omitted: items.length - limit, total: items.length }] : items;

const sceneObjectPath = (
  objects: Array<{ id: string; name: string; parentId?: string }>,
  objectId: string,
): string | null => {
  const names: string[] = [];
  const visited = new Set<string>();
  let current = objects.find((object) => object.id === objectId);
  if (!current) return null;
  while (current && !visited.has(current.id)) {
    names.unshift(current.name);
    visited.add(current.id);
    current = current.parentId ? objects.find((object) => object.id === current!.parentId) : undefined;
  }
  if (current) names.unshift('[cyclic hierarchy]');
  return names.join(' / ');
};

/** Compact, token-friendly snapshot of the current project for the model. */
export function buildSceneSnapshot(options: SceneSnapshotOptions = {}) {
  const detail = options.detail ?? 'tiny';
  const limit = detail === 'full' ? Number.POSITIVE_INFINITY : Math.max(1, options.limit ?? DEFAULT_SNAPSHOT_LIMIT);
  const state = useEditorStore.getState();
  const activeScene = state.scenes.find((scene) => scene.id === state.activeSceneId);
  const activeEnvironment = activeScene ? withSceneEnvironmentDefaults(activeScene.environment) : null;
  const gardenDirector = gardenController(selectActiveObjects(state));
  const gardenSession = gardenDirector && state.isPlaying ? useGarden.getState() : null;

  const objects = (activeScene?.objects ?? []).map((object) => ({
    creatorRole: object.creatorRoleId,
    creatorRules: object.creatorInteractions?.map((rule) => ({ id: rule.id, trigger: rule.trigger.type, action: rule.action.type, enabled: rule.enabled !== false, managed: rule.managed !== false })),
    ...(detail === 'tiny'
      ? {
          id: object.id,
          name: object.name,
          kind: object.kind,
          parentId: object.parentId ?? null,
          position: object.transform.position,
          modelAssetId: object.renderer?.modelAssetId ?? null,
          materialId: object.renderer?.materialId ?? null,
          hideInPlay: object.renderer?.hideInPlay ?? undefined,
          physics: object.physics?.enabled
            ? {
                bodyType: object.physics.bodyType,
                collider: object.physics.collider,
                materialPreset: object.physics.materialPreset ?? 'default',
                isTrigger: object.physics.isTrigger ?? false,
                friction: object.physics.friction,
                restitution: object.physics.restitution ?? 0.05,
              }
            : null,
          water: object.water?.enabled
            ? {
                style: object.water.style ?? 'custom',
                buoyancy: object.water.buoyancy,
                drag: object.water.drag,
                surfaceBounce: object.water.surfaceBounce,
                waveAmplitude: object.water.waveAmplitude,
                waveSpeed: object.water.waveSpeed,
              }
            : null,
          blueprintId: object.script?.enabled ? object.script.blueprintId : null,
          reflectionProbe: object.reflectionProbe?.enabled ? { radius: object.reflectionProbe.radius, refresh: object.reflectionProbe.refresh } : null,
          animatorControllerId: object.animator?.enabled ? object.animator.controllerId ?? null : null,
          character: object.character?.enabled
            ? { cameraMode: object.character.cameraMode, cameraFollow: object.character.cameraFollow, moveSpeed: object.character.moveSpeed, jumpStrength: object.character.jumpStrength, stepHeight: object.character.stepHeight ?? 0.4, groundSnap: object.character.groundSnap ?? 0.4, maxSlopeDegrees: object.character.maxSlopeDegrees ?? null, autoInputWithScript: object.character.autoInputWithScript ?? false }
            : null,
          vehicle: object.vehicle?.enabled
            ? { physicsModel: object.vehicle.physicsModel ?? 'arcade', maxSpeed: object.vehicle.maxSpeed, gripFactor: object.vehicle.gripFactor, handbrakeGrip: object.vehicle.handbrakeGrip, weightTransfer: object.vehicle.weightTransfer ?? null, tractionControl: object.vehicle.tractionControl ?? null, downforce: object.vehicle.downforce ?? null, crashDamage: object.vehicle.crashDamageEnabled ?? true, rollover: object.vehicle.crashRolloverThreshold ?? null, cameraFollow: object.vehicle.cameraFollow, wheels: object.vehicle.wheelObjectIds.length, tireMarks: object.vehicle.tireMarkIds?.length ?? 0 }
            : null,
          terrain: object.terrain?.enabled
            ? {
                size: object.terrain.size,
                chunkSize: object.terrain.chunkSize,
                streamRadius: object.terrain.streamRadius,
                ridgeStrength: object.terrain.ridgeStrength ?? 0,
                domainWarp: object.terrain.domainWarp ?? 0,
                layers: object.terrain.materialLayers?.map((layer) => ({ id: layer.id, name: layer.name, texture: layer.textureAssetId ?? null })).slice(0, 8) ?? [],
                edits: {
                  height: Object.keys(object.terrain.heightOverrides ?? {}).length,
                  paint: Object.keys(object.terrain.paintOverrides ?? {}).length,
                },
                foliage: object.terrain.foliage?.enabled ? { mode: object.terrain.foliage.mode, species: object.terrain.foliage.treeSpecies ?? [], treeSpecId: object.terrain.foliage.treeSpecId ?? null, treeSpacing: object.terrain.foliage.treeSpacing ?? 0, distribution: object.terrain.foliage.distribution ?? 'uniform', understoryDensity: object.terrain.foliage.understoryDensity ?? 0 } : null,
              }
            : null,
          model: object.model?.enabled ? { specId: object.model.specId ?? null } : null,
          viewModelOwnerId: object.viewModel?.ownerObjectId ?? null,
          variables: object.variables ? Object.keys(object.variables) : undefined,
        }
      : {
          id: object.id,
          name: object.name,
          kind: object.kind,
          parentId: object.parentId ?? null,
          // When set, this object's root was stamped from this prefab (instance provenance).
          prefabSourceId: object.prefabSourceId ?? null,
          position: object.transform.position,
          rotation: object.transform.rotation,
          scale: object.transform.scale,
          color: object.renderer?.color,
          opacity: object.renderer?.opacity ?? 1,
          hideInPlay: object.renderer?.hideInPlay ?? undefined,
          modelAssetId: object.renderer?.modelAssetId ?? null,
          textureAssetId: object.renderer?.textureAssetId ?? null,
          materialId: object.renderer?.materialId ?? null,
          // Per-slot material overrides for an imported model (index = material slot). null entry = the
          // slot's imported default. Only present when the user has overridden a slot.
          materialSlots: object.renderer?.materialSlots ?? null,
          physics: object.physics?.enabled
            ? {
                bodyType: object.physics.bodyType,
                collider: object.physics.collider,
                materialPreset: object.physics.materialPreset ?? 'default',
                isTrigger: object.physics.isTrigger ?? false,
                mass: object.physics.mass,
                friction: object.physics.friction,
                restitution: object.physics.restitution ?? 0.05,
                collisionLayer: object.physics.collisionLayer ?? 0,
                collisionMask: object.physics.collisionMask ?? 0xffff,
              }
            : null,
          blueprintId: object.script?.enabled ? object.script.blueprintId : null,
          fracture: object.fracture?.enabled ? { pattern: object.fracture.pattern, pieces: object.fracture.pieces, impactThreshold: object.fracture.impactThreshold, debrisLifetime: object.fracture.debrisLifetime ?? 12, inheritVelocity: object.fracture.inheritVelocity !== false, angularSpeed: object.fracture.angularSpeed ?? 0 } : null,
          joint: object.joint?.enabled
            ? {
                type: object.joint.type,
                connectedObjectId: object.joint.connectedObjectId ?? null,
                axis: object.joint.axis,
                limitsEnabled: object.joint.limitsEnabled ?? false,
                motorTargetVelocity: object.joint.motorTargetVelocity ?? 0,
              }
            : null,
          cloth: object.cloth?.enabled
            ? { sourceMode: object.cloth.sourceMode ?? 'grid', meshAssetId: object.cloth.meshAssetId ?? null, pinMode: object.cloth.pinMode, wind: object.cloth.wind, resolution: object.cloth.resolution }
            : null,
          water: object.water?.enabled
            ? {
                style: object.water.style ?? 'custom',
                buoyancy: object.water.buoyancy,
                drag: object.water.drag,
                angularDrag: object.water.angularDrag,
                surfaceBounce: object.water.surfaceBounce,
                waveAmplitude: object.water.waveAmplitude,
                waveFrequency: object.water.waveFrequency,
                waveSpeed: object.water.waveSpeed,
                emissiveIntensity: object.water.emissiveIntensity ?? 0,
                underwaterFog: object.water.underwaterFog ?? false,
              }
            : null,
          animator: object.animator?.enabled
            ? {
                controllerId: object.animator.controllerId ?? null,
                animationId: object.animator.animationId ?? null,
                clip: object.animator.clip ?? null,
                loop: object.animator.loop,
              }
            : null,
          character: object.character?.enabled
            ? {
                stableJumpArc: object.character.stableJumpArc ?? false,
                stepHeight: object.character.stepHeight ?? 0.4,
                groundSnap: object.character.groundSnap ?? 0.4,
                maxSlopeDegrees: object.character.maxSlopeDegrees ?? null,
                autoInputWithScript: object.character.autoInputWithScript ?? false,
                moveSpeed: object.character.moveSpeed,
                jumpStrength: object.character.jumpStrength,
                cameraMode: object.character.cameraMode,
                cameraFollow: object.character.cameraFollow,
              }
            : null,
          vehicle: object.vehicle?.enabled
            ? {
                physicsModel: object.vehicle.physicsModel ?? 'arcade',
                maxSpeed: object.vehicle.maxSpeed,
                gripFactor: object.vehicle.gripFactor,
                handbrakeGrip: object.vehicle.handbrakeGrip,
                weightTransfer: object.vehicle.weightTransfer ?? null,
                tractionControl: object.vehicle.tractionControl ?? null,
                downforce: object.vehicle.downforce ?? null,
                turnRate: object.vehicle.turnRate ?? 0,
                crashDamageEnabled: object.vehicle.crashDamageEnabled ?? true,
                crashDamageThreshold: object.vehicle.crashDamageThreshold ?? null,
                crashRolloverThreshold: object.vehicle.crashRolloverThreshold ?? null,
                crashRolloverStrength: object.vehicle.crashRolloverStrength ?? null,
                crashWheelBreakThreshold: object.vehicle.crashWheelBreakThreshold ?? null,
                crashDebris: object.vehicle.crashDebris ?? true,
                cameraFollow: object.vehicle.cameraFollow,
                wheels: object.vehicle.wheelObjectIds.length,
                tireMarks: object.vehicle.tireMarkIds?.length ?? 0,
              }
            : null,
          terrain: object.terrain?.enabled
            ? {
                size: object.terrain.size,
                chunkSize: object.terrain.chunkSize,
                resolution: object.terrain.resolution,
                streamRadius: object.terrain.streamRadius,
                ridgeStrength: object.terrain.ridgeStrength ?? 0,
                domainWarp: object.terrain.domainWarp ?? 0,
                physicsRadius: object.terrain.physicsRadius,
                seed: object.terrain.seed,
                heightScale: object.terrain.heightScale,
                    materialDistribution: object.terrain.materialDistribution ?? 'height',
                frequency: object.terrain.frequency,
                octaves: object.terrain.octaves,
                editSpacing: object.terrain.editSpacing,
                colors: [object.terrain.lowColor, object.terrain.midColor, object.terrain.highColor],
                layers:
                  object.terrain.materialLayers?.map((layer) => ({
                    id: layer.id,
                    name: layer.name,
                    color: layer.color,
                    textureAssetId: layer.textureAssetId ?? null,
                    normalMapAssetId: layer.normalMapAssetId ?? null,
                    textureScale: layer.textureScale ?? 8, textureVariation: layer.textureVariation ?? 0, normalStrength: layer.normalStrength ?? 1, roughness: layer.roughness ?? 0.92,
                  })) ?? [],
                edits: {
                  height: Object.keys(object.terrain.heightOverrides ?? {}).length,
                  paint: Object.keys(object.terrain.paintOverrides ?? {}).length,
                },
                foliage: object.terrain.foliage
                  ? {
                      enabled: object.terrain.foliage.enabled,
                      mode: object.terrain.foliage.mode,
                      density: object.terrain.foliage.density,
                      treeDensity: object.terrain.foliage.treeDensity,
                      treeSpecId: object.terrain.foliage.treeSpecId ?? null,
                      treeSpecies: object.terrain.foliage.treeSpecies ?? [],
                      treeSpacing: object.terrain.foliage.treeSpacing ?? 0,
                      distribution: object.terrain.foliage.distribution ?? 'uniform',
                      understoryDensity: object.terrain.foliage.understoryDensity ?? 0,
                      understoryAssetId: object.terrain.foliage.understoryAssetId ?? null,
                      minElevation: object.terrain.foliage.minElevation ?? null, maxElevation: object.terrain.foliage.maxElevation ?? null,
                      grassMesh: object.terrain.foliage.grassMesh,
                      treeMesh: object.terrain.foliage.treeMesh,
                      grassSource: object.terrain.foliage.grassSource ?? (object.terrain.foliage.grassModelAssetId ? 'model' : 'builtin'),
                      treeSource: object.terrain.foliage.treeSource ?? (object.terrain.foliage.treeModelAssetId ? 'model' : 'builtin'),
                      grassModelAssetId: object.terrain.foliage.grassModelAssetId ?? null,
                      treeModelAssetId: object.terrain.foliage.treeModelAssetId ?? null,
                      grassImageAssetId: object.terrain.foliage.grassImageAssetId ?? null,
                      treeImageAssetId: object.terrain.foliage.treeImageAssetId ?? null,
                      windStrength: object.terrain.foliage.windStrength ?? 1,
                      interactStrength: object.terrain.foliage.interactStrength ?? 1,
                      flowerDensity: object.terrain.foliage.flowerDensity ?? 0,
                      usePaintMask: object.terrain.foliage.usePaintMask ?? false,
                      grassColor: object.terrain.foliage.grassColor,
                      // Only the look-defining subset — the full stylizedGrass block is ~20 fields and
                      // would crowd out the rest of the snapshot on every turn.
                      stylizedGrass:
                        ['natural', 'clump'].includes(object.terrain.foliage.grassMesh)
                          ? {
                              gradientTop: object.terrain.foliage.stylizedGrass?.gradientTop,
                              gradientBottom: object.terrain.foliage.stylizedGrass?.gradientBottom,
                              colorNoiseStrength: object.terrain.foliage.stylizedGrass?.colorNoiseStrength,
                              interactionStrength: object.terrain.foliage.stylizedGrass?.interactionStrength,
                              fadeMode: object.terrain.foliage.stylizedGrass?.fadeMode,
                            }
                          : null,
                    }
                  : null,
              }
            : null,
          attachment: object.attachment
            ? { targetObjectId: object.attachment.targetObjectId, boneName: object.attachment.boneName, socketName: object.attachment.socketName ?? null }
            : null,
          // Light config for `kind: 'light'` objects (set_light).
          light: object.light ? { type: object.light.type, color: object.light.color, intensity: object.light.intensity, distance: object.light.distance } : null,
          // Local reflection probe (set_reflection_probe) — captures a cubemap for nearby reflective surfaces.
          reflectionProbe: object.reflectionProbe?.enabled
            ? { radius: object.reflectionProbe.radius, resolution: object.reflectionProbe.resolution, intensity: object.reflectionProbe.intensity, refresh: object.reflectionProbe.refresh, giIntensity: object.reflectionProbe.giIntensity ?? 0 }
            : null,
          // Authored particle emitter (add/update/remove_particle_system).
          particles: object.particles
            ? { enabled: object.particles.enabled, looping: object.particles.looping, shape: object.particles.shape, blend: object.particles.blend, startColor: object.particles.startColor }
            : null,
          // Weapon inventory (set_inventory) — slot labels + which is equipped, for the on-screen bar.
          inventory: object.inventory
            ? { equipped: object.inventory.equipped, slots: object.inventory.slots.map((s) => s.label) }
            : null,
          // Anchored world-space UI widget, and per-instance variables (read by world UI as self.<key>).
          worldUI: object.ui?.documentId ?? null,
          viewModel: object.viewModel ?? null,
          variables: object.variables ?? null,
        }),
  }));

  const assets = state.assets.map((asset) => ({
    id: asset.id,
    name: asset.name,
    type: asset.type,
    folderId: asset.folderId ?? null,
    modelStats: asset.modelInspection?.stats ?? null,
    importWarnings: asset.modelInspection?.warnings ?? null,
    originalAssetId: asset.originalAssetId ?? null,
  }));

  const blueprints = state.blueprints.map((blueprint) => {
    const graph = state.graphs.find((item) => item.id === blueprint.graphId);
    if (detail === 'tiny') {
      return {
        id: blueprint.id,
        name: blueprint.name,
        folderId: blueprint.folderId ?? null,
        nodeCount: graph?.nodes.length ?? 0,
        edgeCount: graph?.edges.length ?? 0,
      };
    }
    return {
      id: blueprint.id,
      name: blueprint.name,
      folderId: blueprint.folderId ?? null,
      nodes:
        graph?.nodes.map((node) =>
          detail === 'compact'
            ? { id: node.id, label: node.data.label, nodeKind: node.data.nodeKind }
            : {
                id: node.id,
                label: node.data.label,
                nodeKind: node.data.nodeKind,
                keyCode: node.data.keyCode,
                axis: node.data.axis,
                space: node.data.space,
                amount: node.data.amount,
                numberValue: node.data.numberValue,
                stringValue: node.data.stringValue,
                booleanValue: node.data.booleanValue,
                vectorValue: node.data.vectorValue,
                variableId: node.data.variableId,
                dataAssetId: node.data.tableId,
                tableId: node.data.tableId,
                rowKey: node.data.rowKey,
                columnId: node.data.columnId,
                compareOp: node.data.compareOp,
                saveSlot: node.data.saveSlot,
                eventName: node.data.eventName,
                otherObjectId: node.data.otherObjectId,
                targetObjectId: node.data.targetObjectId,
                assetId: node.data.assetId,
                spawnKind: node.data.spawnKind,
                projectileSpeed: node.data.projectileSpeed,
                projectileDamage: node.data.projectileDamage,
                projectileTemplateId: node.data.projectileTemplateId,
                projectileDebug: node.data.projectileDebug,
                materialColor: node.data.materialColor,
                materialProperty: node.data.materialProperty,
                envPatch: node.data.envPatch,
                documentId: node.data.documentId,
                elementId: node.data.elementId,
                objectKey: node.data.objectKey,
              },
        ) ?? [],
      edges:
        detail === 'compact'
          ? graph?.edges.length ?? 0
          : graph?.edges.map((edge) =>
              edge.targetHandle
                ? `${edge.source}:${edge.sourceHandle ?? 'out'} -> ${edge.target}:${edge.targetHandle}`
                : `${edge.source} -> ${edge.target}`,
            ) ?? [],
    };
  });

  const variables = state.variables.map((variable) => ({
    id: variable.id,
    name: variable.name,
    type: variable.type,
    defaultValue: variable.defaultValue,
    persistent: variable.persistent,
  }));

  const dataAssets = state.dataAssets.map((table) => ({
    id: table.id,
    name: table.name,
    folderId: table.folderId ?? null,
    columns: detail === 'tiny' ? table.columns.length : table.columns.map((column) => ({ id: column.id, name: column.name, type: column.type })),
    rows: detail === 'compact' || detail === 'tiny' ? table.rows.length : limitItems(table.rows.map((row) => ({ id: row.id, key: row.key, values: row.values })), limit),
  }));

  const materials = state.materials.map((material) => {
    const graph = material.graphId ? state.graphs.find((item) => item.id === material.graphId) : undefined;
    if (detail === 'tiny') {
      return {
        id: material.id,
        name: material.name,
        color: material.color,
        emissiveIntensity: material.emissiveIntensity,
        textureAssetId: material.textureAssetId ?? null,
        nodeCount: graph?.nodes.length ?? 0,
      };
    }
    return {
      id: material.id,
      name: material.name,
      // Flat fields = the BASE surface (used for any Output pin left unconnected).
      color: material.color,
      metalness: material.metalness,
      roughness: material.roughness,
      emissiveColor: material.emissiveColor,
      emissiveIntensity: material.emissiveIntensity,
      textureAssetId: material.textureAssetId ?? null,
      normalMapAssetId: material.normalMapAssetId ?? null,
      folderId: material.folderId ?? null,
      // Cel-shaded surfaces report their finish so the assistant knows which materials are toon.
      ...(material.toon ? { toon: true, toonFinish: material.toonFinish ?? 'flat' } : {}),
      // The node graph that overrides base fields via its Material Output pins.
      nodes:
        graph?.nodes.map((node) =>
          detail === 'compact'
            ? { id: node.id, label: node.data.label, nodeKind: node.data.nodeKind }
            : {
                id: node.id,
                label: node.data.label,
                nodeKind: node.data.nodeKind,
                materialColor: node.data.materialColor,
                numberValue: node.data.numberValue,
                assetId: node.data.assetId,
              },
        ) ?? [],
      edges:
        detail === 'compact'
          ? graph?.edges.length ?? 0
          : graph?.edges.map((edge) =>
              edge.targetHandle
                ? `${edge.source}:${edge.sourceHandle ?? 'value-out'} -> ${edge.target}:${edge.targetHandle}`
                : `${edge.source} -> ${edge.target}`,
            ) ?? [],
    };
  });

  // Reusable particle-system assets (Unreal-style) — referenced by objects via `particles.systemId`
  // and spawned at runtime by the "Spawn Particle System" node. Edit once → every instance updates.
  const particleSystems = state.particleSystems.map((system) =>
    detail === 'tiny'
      ? { id: system.id, name: system.name, shape: system.shape, blend: system.blend, looping: system.looping }
      : {
          id: system.id,
          name: system.name,
          folderId: system.folderId ?? null,
          looping: system.looping,
          rate: system.rate,
          burst: system.burst,
          shape: system.shape,
          gravity: system.gravity,
          lifetime: system.lifetime,
          startColor: system.startColor,
          endColor: system.endColor,
          blend: system.blend,
          worldSpace: system.worldSpace,
        },
  );

  // Skeletal-animation assets. Importing a rigged model splits it into a skeleton, a skeletal mesh,
  // and one animation per clip; animations whose skeletonId matches a mesh's skeletonId play on it.
  // Bone names are omitted to keep the snapshot lean — use the list_bones tool to fetch them on demand.
  const skeletons = state.skeletons.map((skeleton) => ({
    id: skeleton.id,
    name: skeleton.name,
    boneCount: skeleton.boneNames.length,
    sockets: (skeleton.sockets ?? []).map((socket) => ({ name: socket.name, boneName: socket.boneName })),
    // Ragdoll tuning. Global defaults from set_ragdoll_settings; `bodies` are per-bone PhAT-style overrides
    // (set_ragdoll_body) — summarized to {boneName, shape, enabled} to stay lean.
    ragdoll: skeleton.ragdoll
      ? {
          capsuleRadius: skeleton.ragdoll.capsuleRadius,
          density: skeleton.ragdoll.density,
          linearDamping: skeleton.ragdoll.linearDamping,
          angularDamping: skeleton.ragdoll.angularDamping,
          groundY: skeleton.ragdoll.groundY,
          excludePattern: skeleton.ragdoll.excludePattern,
          bodies:
            detail === 'compact'
              ? skeleton.ragdoll.bodies?.length ?? 0
              : limitItems((skeleton.ragdoll.bodies ?? []).map((b) => ({ boneName: b.boneName, shape: b.shape ?? 'capsule', enabled: b.enabled !== false })), limit),
        }
      : null,
  }));
  const skeletalMeshes = state.skeletalMeshes.map((mesh) => ({
    id: mesh.id,
    name: mesh.name,
    skeletonId: mesh.skeletonId,
    sourceAssetId: mesh.sourceAssetId,
  }));
  const animations = state.animations.map((anim) => ({
    id: anim.id,
    name: anim.name,
    skeletonId: anim.skeletonId,
    ...(detail === 'tiny' ? {} : { loop: anim.loop }),
  }));
  const animatorControllers = state.animatorControllers.map((controller) => ({
    id: controller.id,
    name: controller.name,
    skeletonId: controller.skeletonId ?? null,
    ...(detail === 'tiny'
      ? {
          parameterCount: controller.parameters.length,
          stateCount: controller.states.length,
          transitionCount: controller.transitions.length,
        }
      : {
          defaultStateId: controller.defaultStateId ?? null,
          parameters: controller.parameters.map((p) => ({ id: p.id, name: p.name, type: p.type, source: p.source })),
          states: limitItems(
            controller.states.map((s) => ({
              id: s.id,
              name: s.name,
              animationId: s.animationId ?? null,
              // Present when the state is a blend space (set_blendspace). parameterIdY present = 2D.
              blend: s.blendSamples?.length
                ? { parameterId: s.blendParameterId, parameterIdY: s.blendParameterIdY, samples: detail === 'compact' ? s.blendSamples.length : s.blendSamples }
                : undefined,
            })),
            limit,
          ),
          transitions:
            detail === 'compact'
              ? controller.transitions.length
              : limitItems(
                  controller.transitions.map((t) => ({
                    id: t.id,
                    from: t.from,
                    to: t.to,
                    duration: t.duration,
                    conditions: t.conditions.map((c) => ({ parameterId: c.parameterId, op: c.op, value: c.value })),
                  })),
                  limit,
                ),
          // Animation layers: masked machines over the base. Their states/transitions are authored
          // with the same tools by passing layerId.
          layers: controller.layers?.length
            ? controller.layers.map((layer) => ({
                id: layer.id,
                name: layer.name,
                maskRootBones: layer.maskRootBones,
                weight: layer.weight,
                weightParameterId: layer.weightParameterId ?? null,
                defaultStateId: layer.defaultStateId ?? null,
                states:
                  detail === 'compact'
                    ? layer.states.length
                    : layer.states.map((state) => ({
                        id: state.id,
                        name: state.name,
                        animationId: state.animationId ?? null,
                        blend: state.blendSamples?.length
                          ? { parameterId: state.blendParameterId, parameterIdY: state.blendParameterIdY }
                          : undefined,
                      })),
                transitions: detail === 'compact' ? layer.transitions.length : layer.transitions,
              }))
            : undefined,
        }),
  }));

  // Game UI documents. Each element is flattened to (id, kind, parentId) plus its bindings so the
  // model can target elements without re-fetching the tree. Kept lean — text/style omitted.
  const flattenUI = (el: import('../types').UIElement, parentId: string | null, doc: import('../types').UIDocument): Array<Record<string, unknown>> => [
    {
      id: el.id,
      kind: el.kind,
      parentId,
      // className/hasCss are what make an element targetable by CSS — without them the model
      // can't tell a plain widget from one a UI kit already styles.
      className: el.className,
      hasCss: el.css ? true : undefined,
      // Composition has to be visible, or the model re-duplicates widgets that already exist.
      componentId: el.componentId,
      params: el.componentParams ? Object.keys(el.componentParams) : undefined,
      bindings: el.bindings.length ? el.bindings.map((b) => `${b.target}=${b.expression}`) : undefined,
      onClickEvent: el.onClickEvent,
      buttonAction: el.kind === 'button' ? currentUIButtonAction(doc, el, state.blueprints, state.graphs) : undefined,
      valueVariable: el.valueVariable,
    },
    ...el.children.flatMap((child) => flattenUI(child, el.id, doc)),
  ];
  const uiDocuments = state.uiDocuments.map((doc) => ({
    id: doc.id,
    name: doc.name,
    surface: doc.surface,
    isComponent: doc.isComponent || undefined,
    renderMode: doc.renderMode ?? 'dom',
    // Length, not content: a UI kit's sheet is tens of thousands of characters.
    cssChars: doc.css?.length || undefined,
    visibleOnStart: doc.visibleOnStart,
    logicBlueprintId: doc.logicBlueprintId ?? null,
    logicScope: doc.logicScope ?? 'scene',
    rootId: doc.root.id,
    elements: detail === 'compact' || detail === 'tiny' ? flattenUI(doc.root, null, doc).length : limitItems(flattenUI(doc.root, null, doc), limit),
  }));

  const cinematicSummaryLimit = detail === 'tiny' ? 4 : limit;

  return {
    activeSceneId: state.activeSceneId,
    sproutwatch: gardenDirector ? {
      directorId: gardenDirector.id,
      seed: gardenSeed(selectActiveObjects(state)),
      phase: gardenSession ? (gardenSession.started ? gardenSession.game.phase : 'title') : 'editing',
      wave: gardenSession?.game.wave,
      coins: gardenSession?.game.coins,
      health: gardenSession?.game.lives,
      defenders: gardenSession?.game.towers.length,
      paused: gardenSession ? gardenSession.paused || state.isPlayPaused : undefined,
    } : undefined,
    // Editor-level, not scene-level: which store plugins are installed (see list_plugins).
    enabledPlugins: usePluginStore.getState().enabledIds,
    titan: { starterActive: isTitanScene(selectActiveObjects(state)), zone: zoneOfScene(selectActiveObjects(state)), zones: Object.keys(titanZoneScenes(state.scenes)), realmUrl: readTitanSettings(state.variables).realmUrl, configured: Boolean(readTitanSettings(state.variables).gameKey), publishMode: readTitanSettings(state.variables).publishMode, gameOrigin: readTitanSettings(state.variables).gameOrigin },
    scenes: state.scenes.map((scene) => ({
      id: scene.id,
      name: scene.name,
      objectCount: scene.objects.length,
      environment: scene.environment
        ? {
            skyMode: scene.environment.skyMode,
            lux: scene.environment.lux ?? null,
            skyTextureAssetId: scene.environment.skyTextureAssetId ?? null,
            environmentMapAssetId: scene.environment.environmentMapAssetId ?? null,
            fogEnabled: scene.environment.fogEnabled,
            atmosphericFog: scene.environment.atmosphericFog ?? false,
            volumetricFogEnabled: scene.environment.volumetricFogEnabled ?? false,
            toneMapping: scene.environment.toneMapping ?? 'aces',
            toneMappingExposure: scene.environment.toneMappingExposure ?? 1,
            ambientMode: scene.environment.ambientMode ?? 'flat',
            ambientIntensity: scene.environment.ambientIntensity ?? null,
            sunShadowExtent: scene.environment.sunShadowExtent ?? 80,
            cloudCoverage: scene.environment.cloudCoverage ?? 0,
            skyLighting: scene.environment.skyLighting ?? 'studio',
            surfaceWetness: scene.environment.surfaceWetness ?? 0,
            puddleCoverage: scene.environment.puddleCoverage ?? 0,
            wetnessFromRain: scene.environment.wetnessFromRain ?? false,
            cloudSpeed: scene.environment.cloudSpeed ?? 0.35,
            rainIntensity: scene.environment.rainIntensity ?? 0,
            lightningFlash: scene.environment.lightningFlash ?? 0,
            contactShadows: scene.environment.contactShadows ?? true,
            contactShadowBlur: scene.environment.contactShadowBlur ?? 2.4,
            contactShadowColor: scene.environment.contactShadowColor ?? '#000000',
          }
        : null,
      ambientSoundId: scene.ambientSoundId ?? null,
      musicSoundId: scene.musicSoundId ?? null,
      cinematics: (scene.cinematics ?? []).map((cinematic, cinematicIndex) => {
        const includeActionSummaries = detail !== 'tiny'
          || (scene.id === state.activeSceneId && (state.activeCinematicId ? cinematic.id === state.activeCinematicId : cinematicIndex === 0));
        const binding = (objectId: string | undefined) => {
          if (!objectId) return null;
          const object = scene.objects.find((item) => item.id === objectId);
          return {
            id: objectId,
            name: object?.name ?? null,
            kind: object?.kind ?? null,
            path: sceneObjectPath(scene.objects, objectId),
            status: object ? 'ok' : 'missing',
          };
        };
        const keyTimes = (times: number[]) => limitItems([...times].sort((a, b) => a - b), Math.min(cinematicSummaryLimit, 12));
        const actionTypeCounts = cinematic.actions.reduce<Record<string, number>>((counts, action) => {
          counts[action.type] = (counts[action.type] ?? 0) + 1;
          return counts;
        }, {});
        return {
          id: cinematic.id,
          name: cinematic.name,
          duration: cinematic.duration,
          frameRate: cinematic.frameRate ?? 24,
          folder: cinematic.folder ?? null,
          takeOf: cinematic.takeOf ?? null,
          takeNumber: cinematic.takeNumber ?? null,
          autoplay: Boolean(cinematic.autoplay),
          skippable: cinematic.skippable ?? true,
          actionCount: cinematic.actions.length,
          actionTypeCounts,
          markers: limitItems(
            [...(cinematic.markers ?? [])]
              .sort((a, b) => a.time - b.time)
              .map((marker) => ({ id: marker.id, time: marker.time, label: marker.label, determinismFence: marker.determinismFence ?? false })),
            cinematicSummaryLimit,
          ),
          cameraShots: limitItems(
            cinematic.actions
              .filter((action) => action.type === 'camera')
              .sort((a, b) => a.time - b.time)
              .map((action) => ({
                id: action.id,
                label: action.label ?? null,
                time: action.time,
                duration: action.duration ?? null,
                binding: binding(action.objectId),
                fov: action.fov ?? action.keyframes?.[0]?.fov ?? null,
                blend: action.blend ?? 0,
                cut: (action.blend ?? 0) <= 0 ? 'hard' : 'blend',
                interpolation: action.interpolation ?? 'smooth',
                keyframes: action.keyframes?.length ?? 0,
                keyframeTimes: keyTimes(action.keyframes?.map((frame) => frame.time) ?? []),
              })),
            cinematicSummaryLimit,
          ),
          objectTracks: includeActionSummaries ? limitItems(
            cinematic.actions
              .filter((action) => action.type === 'transform')
              .sort((a, b) => a.time - b.time)
              .map((action) => ({
                id: action.id,
                label: action.label ?? null,
                time: action.time,
                duration: action.duration ?? null,
                binding: binding(action.objectId),
                interpolation: action.interpolation ?? action.ease ?? 'smooth',
                mode: action.transformKeyframes?.length ? 'keyframed' : 'legacy-range',
                keyframes: action.transformKeyframes?.length ?? 0,
                keyframeTimes: keyTimes(action.transformKeyframes?.map((frame) => frame.time) ?? []),
              })),
            cinematicSummaryLimit,
          ) : [],
          otherActions: includeActionSummaries ? limitItems(
            cinematic.actions
              .filter((action) => action.type !== 'camera' && action.type !== 'transform')
              .sort((a, b) => a.time - b.time)
              .map((action) => ({
                id: action.id,
                type: action.type,
                label: action.label ?? null,
                time: action.time,
                duration: action.duration ?? null,
                binding: binding(action.objectId),
                keyframes: action.materialKeyframes?.length ?? 0,
                keyframeTimes: keyTimes(action.materialKeyframes?.map((frame) => frame.time) ?? []),
              })),
            cinematicSummaryLimit,
          ) : [],
          look: cinematic.look,
        };
      }),
    })),
    filmMode: {
      activeCinematicId: state.activeCinematicId || null,
      playhead: state.runtimeCinematic
        ? { sequenceId: state.runtimeCinematic.sequenceId, time: state.runtimeCinematic.time, source: 'play' }
        : state.editorCinematicPreview
          ? { sequenceId: state.editorCinematicPreview.sequenceId, time: state.editorCinematicPreview.time, source: 'preview' }
          : null,
      selectedKeyframe: state.selectedCinematicKeyframe ?? null,
      selectedObjectIds: state.selectedObjectIds.length ? state.selectedObjectIds : state.selectedObjectId ? [state.selectedObjectId] : [],
      autoKey: state.cinematicRecording,
      liveCameraRecord: state.playtimeCameraRecording,
      viewportMode: state.cinematicViewportMode,
      pathMode: state.cinematicPathMode,
    },
    activeEnvironment,
    exportSettings: state.exportSettings,
    performanceAssistant: (() => { const s = usePerformanceAssistantStore.getState(); return { recording: s.recording, remaining: s.remaining, report: s.report, preview: s.preview, error: s.error }; })(),
    buildCentre: (() => { const s = useBuildCentreStore.getState(); return { setup: s.setup, busy: s.busy, prepared: Boolean(s.prepared), jobs: s.jobs.slice(0, 3).map(j => ({ requestId: j.requestId, repository: j.repository, status: j.run?.status, conclusion: j.run?.conclusion, cleaned: j.cleaned })), error: s.error }; })(),
    lastBuild: (() => { const build = useProjectStore.getState().lastProductionBuild; return build ? { buildId: build.buildId, profile: build.profile, artifacts: build.artifacts.map(({ target, directory, depotRoot, executable, launchTest }) => ({ target, directory, depotRoot, executable, launchTest })), assets: Object.fromEntries(Object.entries(build.assetReports ?? {}).map(([target, report]) => [target, { cacheHits: report.cacheHits, prepared: report.prepared, sourceBytes: report.sourceBytes, outputBytes: report.outputBytes, largest: limitItems(report.assets, Math.min(limit, 5)) }])) } : null; })(),
    // Open-world activation streaming for the active scene (undefined = off).
    streaming: activeScene?.streaming ?? null,
    selectedObjectId: state.selectedObjectId,
    isPlaying: state.isPlaying,
    replayActive: state.replayPlayback != null,
    // Live profiler readout (the F8 overlay's data): averages over the last ~2s plus the stall log —
    // every >50ms frame since Play started, each attributed tick (game logic/physics) vs render (GPU
    // submission) vs other (GC / React / shader compile / browser). Lets the assistant diagnose
    // "my game stutters" from real numbers instead of guesses. Survives Stop until the next Play.
    perf: (() => {
      const p = getPerfSnapshot();
      const r1 = (n: number) => Math.round(n * 10) / 10;
      return {
        fps: Math.round(p.fps),
        frameMsAvg: r1(p.frameMs.avg),
        frameMsMax: r1(p.frameMs.max),
        tickMsAvg: r1(p.tickMs.avg),
        renderMsAvg: r1(p.renderMs.avg),
        hitches: p.hitches,
        stalls: p.stalls.map((s) => ({
          at: r1(s.at),
          frameMs: Math.round(s.frameMs),
          tickMs: r1(s.tickMs),
          renderMs: r1(s.renderMs),
          other: Math.round(s.other),
        })),
        // Scene costs renderer.info cannot see. lights x shadowLights x shadowCasters is usually the
        // answer when renderMs is high but drawCalls looks reasonable.
        drawCalls: p.render.calls,
        triangles: p.render.triangles,
        lights: p.render.lights,
        shadowLights: p.render.shadowLights,
        shadowCasters: p.render.shadowCasters,
        skinnedMeshes: p.render.skinned,
      };
    })(),
    assets: limitItems(assets, limit),
    folders: limitItems(state.folders.map((folder) => ({ id: folder.id, name: folder.name, parentId: folder.parentId })), limit),
    prefabs: limitItems(
      state.prefabs.map((prefab) => ({
        id: prefab.id,
        name: prefab.name,
        folderId: prefab.folderId ?? null,
        objectCount: prefab.objects.length,
      })),
      limit,
    ),
    // Prototype-model assets (Model Forge). Placed objects reference one by model.specId.
    treeSpecs: limitItems(state.treeSpecs.map((spec) => ({ id: spec.id, name: spec.name, surface: spec.look.surface?.style ?? 'stylized', lod: spec.lod })), limit),
    modelSpecs: limitItems(
      state.modelSpecs.map((spec) => ({ id: spec.id, name: spec.name, partCount: spec.parts.length, finish: spec.style?.finish ?? 'flat' })),
      limit,
    ),
    // When non-null, the active scene IS a prefab being edited; object tools edit the prefab's
    // contents. close_prefab saves and returns to the real scene.
    editingPrefabId: state.editingPrefabId,
    variables: limitItems(variables, limit),
    dataAssets: limitItems(dataAssets, limit),
    materials: limitItems(materials, limit),
    particleSystems: limitItems(particleSystems, limit),
    skeletons: limitItems(skeletons, limit),
    skeletalMeshes: limitItems(skeletalMeshes, limit),
    animations: limitItems(animations, limit),
    animatorControllers: limitItems(animatorControllers, limit),
    uiDocuments: limitItems(uiDocuments, limit),
    // `objects` below are the ACTIVE scene's objects — the ones your tools edit.
    objects: limitItems(objects, limit),
    blueprints: limitItems(blueprints, limit),
    // Project-wide post-processing (set_render_settings).
    renderSettings: state.renderSettings,
    // Editor-only parity toggle; does not change Play/export pixels.
    viewportRenderPreview: useViewportPrefs.getState().renderPreviewEnabled,
  };
}


export const COMPACT_ENGINE_GUIDE = `
Launcher choices: Blank, Platformer, Parcel Panic, Lumen Lane and Crystal Slice are included offline. First Person, Driving, Spline Studio and the remaining catalog samples are available in Starter worlds, its expanded list and search. Third Person Starter (template-third-person), Sim Racing (template-sim-racing) and Sproutwatch (template-tower-defense) are hidden from all default launcher choices. Their builders, runtime, package archives and explicit APIs remain supported. Use create_third_person_template, create_sim_racing_template or create_tower_defense_template for requests for those optional samples; do not direct users to hidden launcher entries or recommend them as first-run choices.

Woodland film: create_verdant_template builds Verdant — A Woodland Study, an original 48-second cinematic with rocky clearings, fern and shrub banks, natural blade grass, clustered authored trees, volumetric sunlight, six editable shots and an original generated score plus ambience. Adds to the active scene; use a blank project. Play; R replays. The local reusable package has mixed licensing: template code MIT, terrain assets CC0, generated audio governed by provider terms (no new audio license grant). npm run cinematic:verdant:preview captures stills; npm run cinematic:verdant:render captures the actual engine film at 1080p/24fps with audio.

Dark fantasy storm film: create_blackthorn_template builds Blackthorn Keep: a detailed modular Gothic fortress beyond a tall-grass moor, animated clouds, wind-driven rain, moonlight and fire, physical banners and a lightning-fractured ward. All twelve assets, soundtrack and ten shots ship in the Blackthorn Keep Asset Store project package. Play from the start; R replays.

70-second landscape film: create_last_light_template builds Last Light, a drowned mountain observatory with ten shots, an original score, warm/cool lighting and a live tumbling fracture at 48s. R replays; Play from the start for physics. The production CLI npm run cinematic:render captures live simulation and audio at exact frame times.
You are Feather Assistant, the in-editor AI for Feather Engine. Use tools to modify the live editor. Be concise.
- Button actions: use \`set_ui_button_action\` for loadScene, restartScene, showUI/hideUI/toggleUI, pauseGame or resumeGame. Pick explicit scene/screen ids. The designer exposes When clicked → Action → Apply action and Show logic. Generated nodes run in every level (logicScope=project); hand-edited/shared branches are preserved on replacement. Restart resets level objects and time, but keeps project variables. Use \`get_interaction_problems\` for missing listeners, disconnected click events and deleted targets; \`open_ui_logic\` with elementId reveals a button handler. For custom logic, load-scene nodes accept restartScene and hideUIDocumentId.
- **Performance Assistant** (View menu or F8 profiler): performance_assistant opens a 12-second guided Play check (2s warmup, 10s fresh samples), with frame budget, p95, stalls, simulation and CPU render-submission timings. Auto-quality is held; DPR may adapt. Suggestions are candidates, not measured bottlenecks. Preview changes, remeasure the same route/window, then keep or restore; closing restores a pending preview. Do not claim GPU timing or guaranteed speed gains.
- **Build Centre** (Export menu): build_centre configures/checks a GitHub owner/repo and engine branch, prepares an immutable package and reads job history. Desktop uses authenticated GitHub CLI; commit the Build Centre workflow/scripts to the engine repository and default branch first. The user reviews the exact upload destination/size then starts cloud builds in the UI. Native matrix jobs package and launch-test Windows/macOS/Linux; Linux also packages web (browser playtest still needed). Collect tar.gz artifacts, extract before Steam, inspect launch reports, retry/cancel jobs and remove draft input packages. Inputs persist until removed; artifacts expire after 14 days. Builds are unsigned (macOS ad-hoc, not notarized); signing guidance links explain certificate setup. Tools do not initiate cloud uploads.

- Lux 2.0 rooms: set_scene_environment lux:{enabled:true,mode:"rooms",rooms:[{id,name,center,size,blendDistance}],roomOcclusion:true}. Up to four bounded/blended caches with automatic centre capture placement and depth wall checks. Low suspends Lux. Keep captures in empty space.
- configure_build_profile saves targets, identity, launch scene and optimization:{geometry,textures,streamAssets}. Mesh detail is prepared/cached per target; original assets stay intact. export_production opens Build Report. Web downloads a playable zip; installed desktop packages prebuilt game runtimes and checks launch. get_build_status returns artifacts, checks and asset size/cache reports. open_steam_publisher uses the built folders with platform depots and beta upload history. Opening these dialogs does not build/upload. Additional runner packs enable desktop targets; mobile signing uses source/CI tools. Public release remains in Steamworks.
- **Weather:** set_scene_environment and Set Environment envPatch support cloudCoverage (0–1; procedural sky), cloudSpeed (0–5), rainIntensity (0–1; depth-tested, wind-driven) and lightningFlash (0–1; actual scene illumination plus sky/rain). Author a flash envelope with brief nonzero cues followed by zero. Rain, clouds, foliage, GPU particles and cloth follow the simulation clock during Play and pause with it. For wet PBR surfaces use surfaceWetness and puddleCoverage (0–1), plus wetnessFromRain:true for accumulation/drying. skyLighting:"sky" with skyMode:"procedural" and no environmentMapAssetId makes ambient light and reflections follow the visible sky. Rectangular area lights (set_light type:"rect", width/height) create broad highlights, face local -Z and do not cast shadows. Point/spot lights expose decay; spot/directional lights expose useRotation and shadowBias/shadowNormalBias/shadowNear/shadowFar/shadowExtent. These controls use the same renderer in editor and exported games.
- **Cinematic landscapes and light:** update_terrain supports ridgeStrength (0–1) and domainWarp (0–256 world units), shared by render and collision heightfields. set_scene_environment supports ambientIntensity (0–5, independent of reflections) and sunShadowExtent (8–256 world-unit half-width; smaller sharpens shadows over a smaller set). Omitted values preserve existing projects.
- **Destruction debris (set_fracture):** angularSpeed (0–20 rad/s, default 0) adds deterministic seeded fragment tumbling;  debrisLifetime controls piece lifetime in seconds (0.1–120, default 12); inheritVelocity (default true) carries a moving body’s velocity into its fragments. Generated pieces preserve the source rotation and recycle oldest-first above 256 live pieces; authored props are never recycled. Explode uses smooth pressure falloff, bounded blast speed/spin, and CCD for fast debris. Keep fracture detail modest: mesh cutting still happens at break time.

Rules:
- Models and movement: replace_object_appearance swaps a static mesh using an imported asset while preserving the collision root; assetId:null restores it. Cloudstep Model Forge starters: cloudstep-crate, cloudstep-lantern, cloudstep-gate. apply_movement_preset selects forgiving-platformer or grounded-adventure; set_character_controller also exposes stepHeight/groundSnap (meters) and maxSlopeDegrees/slideSlopeDegrees. Input policy and rig mappings survive presets.
- Lumen Lane: create_moba_template builds the complete solo MOBA starter. Choose from five champions, click to move/attack, push three lanes and break an enemy tower before its core. The forest map, hero abilities, minimap settings, waves and HUD are editable.
- Parcel Panic: create_parcel_panic_template creates the complete delivery starter with a nine-second intro, weighted physics parcels, articulated animation, seeded village generation, relaxed/time-trial rounds and original audio. Optional seed reproduces a layout; New village generates another and Retry keeps the current route. Inspect the Courier and Parcel Blueprints to change rules; edit destination, destination_name and confetti per parcel to change its target. See Cinematic for the opening shots.
- Beginner gameplay: add_simple_interaction adds When/Do cards using ordinary Blueprints. update_simple_interaction edits/deletes/enables/disables/duplicates by creatorRules.id. Built-in Players retain movement; old scripted controllers keep their behavior. Custom graph edits and unapplied code drafts are protected. Duplicates start disabled. The Your first game guide leads through appearance, rules, Play, Save, and Production Export; Platformer is included locally.
- Active-scene tools edit only Snapshot.objects. Use ids from the snapshot or inspection tools.
- Start with the tiny snapshot. Call list_scene("compact"/"standard") or inspect_object/inspect_blueprint/inspect_animator_controller only when needed. For an existing cutscene, call inspect_cinematic before changing its tracks. Use "full" sparingly.
- Prefer high-level/bulk tools over many small calls: create_character_pawn, create_third_person_template, create_platformer_template (Cloudstep Garden: primitive-built sky course, composite hero, collectibles/checkpoint/goal and responsive HUD), create_spline_studio_template (asset-free polished Spline-like product stage with candy materials + kinetic motion), create_cinderfall_template (original single-player cave mining/extraction FPS: mine sixteen units, fight cavewardens, return to the rig; editable art/Blueprints, timed reloads, pause and replay), create_first_person_template, create_driving_template, create_timeline_showcase_template (six inspectable Timeline mechanisms plus a reusable Vault Door prefab), create_storyboard_cinematic, create_ui_template, add_gameplay_kit, spawn_grid, duplicate_object, group_objects, add_ui_preset.
- For "fix", "debug", or "why" requests, inspect the focused object/blueprint/controller first, then make the smallest useful tool change.
- Objects: kind + transform. +Y is up. Physics must be enabled for collision; fixed = static, dynamic = moves/falls, kinematic = scripted mover, trigger = overlap only.
- Scene Settings: use set_scene_environment for sky/fog/sun/base environment light, and set_scene_audio for ambientSoundId/musicSoundId loops. They are scene-level settings, not Blueprint nodes. For atmospheric/cinematic/foggy/dusty moods prefer **volumetric fog** (volumetricFogEnabled + volumetricFogDensity/Color/scattering/sunStrength) over flat linear fog — it adds height-based mist, a sun glow, and god-ray shafts (shafts show on High/Epic quality). It auto-replaces linear fog when on.
- **Natural landscapes:** apply_terrain_biome(objectId, biome: woodland/meadow/alpine) applies bundled CC0 scanned ground textures, natural blade grass, and authored textured trees with wind and three detail levels (woodland/meadow); alpine uses editable parametric species, preserving sculpting and painted masks. update_terrain foliage.treeSpecies accepts up to 4 {specId,weight} entries; an empty mix uses treeSpecId. treeSpacing is minimum separation (0 preserves legacy scatter); minElevation/maxElevation are local heights (null clears); maxSlope and painted masks also constrain placement. materialDistribution ground favors grass on gentle terrain and rock on cliffs; height restores elevation bands. Terrain layers render textureAssetId + normalMapAssetId with textureScale (terrain units per repeat), normalStrength, roughness and textureVariation (0..1 to reduce repetition). Natural grass (foliage.grassMesh natural) uses curved blades with the same stylizedGrass color/wind/interaction/fade controls. update_tree_spec surface.style natural enables PBR bark and cutout leaves; use foliage.strategy leaves for small branch-attached leaves or conifer needle sprays. Surface roughness and alphaCutoff are adjustable; lod.levels/distances select camera-distance detail with hysteresis. Woodland also embeds CC0 ferns, mossy rocks and decayed wood: foliage.understoryDensity (0..1, 0 disables) controls ground cover; understoryAssetId is its portable model library. foliage.distribution woodland clusters spaced trees and thins grass beneath canopies; uniform preserves legacy distribution. Natural grass reduces geometry and shadows with camera distance. Leaves transmit direct light with shadowing. Trees and ground cover use region caches, distance detail, fade and quality budgets.
- Open-world terrain: use create_terrain/update_terrain for large landscapes instead of tiling plane objects. It streams render chunks around the camera/player, streams Rapier heightfield physics chunks near active bodies, supports material layers, sculpt_terrain, paint_terrain, and instanced/custom foliage settings.
- Film Mode cinematics: empty Film Mode shows a **Quick Cinematic** gallery (same presets as **create_storyboard_cinematic**) — prefer that tool first for complete intros, reveals and handoffs. Use **polish_cinematic_look** for letterbox, grade, grain, vignette and fades; **duplicate_cinematic_take** before alternatives; **add_cinematic_marker** for beats; and the focused cinematic tools for camera shots, transitions, object tracks, audio, text, material/property tracks, time dilation and subsequences. Inspect a cinematic before surgical edits, preserve sampled transform values when changing one channel, and Play from the start when physics or runtime events matter.
- **Simple Film Mode workflow:** Add shot → optionally arm Live Camera Record → Play. Live Camera Record possesses the camera during Play (WASD + RMB look + Q/E vertical) and saves a non-destructive new take on Stop. Camera rows have separate Select/Cut/Delete actions; deleting a scene camera freezes linked shot framing. Use **delete_cinematic_action** for one shot/beat and **delete_cinematic** only for a whole sequence.
- **Object tracks in Film Mode:** **Add Object Track** opens a searchable scene-object picker; untracked objects are first, existing bindings say “On timeline”, the current multi-selection can be added together, and objects can be dropped from the Objects hierarchy. Adding an untracked object creates its Transform row and first key at the playhead; choosing a tracked object reveals that row without adding a duplicate. Each Camera/Object row has a ◆+ key button, and **S** keys the selected object. Tell users this workflow when they ask how to add scene actors to a cinematic.
- **AI cinematic editing:** inspect_cinematic first, then use **set_cinematic_keyframe** for camera or object keys and **delete_cinematic_keyframe** for one key. These tools create/reuse the correct track, replace a key on the same sequence frame, and keep the sequence duration reachable. Reuse the returned/action snapshot actionId; do not create parallel Transform actions for one object unless the user explicitly wants layered clips. Object key position/rotation/scale are the object's complete **LOCAL (parent-relative)** transform, rotations are radians, and key times are absolute sequence seconds. When changing only position, preserve sampled rotation/scale; one key is a static hold and two or more keys create motion.
- **Complex cinematic recipe:** create or duplicate a take → add named markers for story beats → author the camera shot list/path → key subject and prop tracks → add animation/material/audio/event/fade/time-dilation beats → set the film look → inspect again and preview. Prefer create_storyboard_cinematic (Quick Cinematic presets, optional title/subtitle) for a strong first pass, polish_cinematic_look for a rough sequence, then refine surgically with inspected action ids and set_cinematic_keyframe.

- **Cinematic film look + depth of field (making cutscenes look like film):** call **set_cinematic_look** to add letterbox bars (letterbox: 2.39/2.35 scope, 1.85 flat), film grain (0–1), an extra vignette (0–1), **camera motion blur** (motionBlur 0–1 — pans/dollies smear like film; only applies while the cinematic camera is live), **anamorphic** (0–1, bright neon/highlights smear into a blue horizontal lens-flare streak — the signature neon-cinema look), **chromaticAberration** (0–1, RGB edge fringing / sci-fi look), **lightLeak** (0–1, warm film-burn streaks drifting across the frame), **lensDirt** (0–1, procedural lens grime that lights up where bright neon/highlights hit it), and a real **color grade** rendered as a post-processing shader on the cinematic camera (it grades the 3D render itself, not a flat overlay). The grade is a preset (warm / teal-orange / noir / cool / sepia) that seeds manual params, PLUS optional overrides — exposure, contrast, saturation, temperature (−1 cool .. 1 warm), and a custom tint (hex) + tintAmount — all scaled by gradeIntensity (0–1). Pass a preset for a quick look, or grade:"custom" with the params to dial in your own. All of it shows while it plays and while scrubbing the preview. For **depth of field / focus pulls**, give camera beats (or add_cinematic_shot, or camera keyframes) a focusDistance (world units ahead of the camera) + aperture (bokeh strength; 0 = sharp, 3–6 = shallow). Focus distance blends between shots, so two blended shots with different focusDistance produce a **rack-focus pull** during the dolly; on a keyframe track it splines across keyframes. DoF renders during Play and in the exported game (it's a post effect on the cinematic camera). A good "cinematic" recipe: 2.39 letterbox + a warm or teal-orange grade + light grain, plus a shallow focus on the subject during a slow push-in. Prefer this over hand-built Blueprint timelines for cutscenes. **The player is INVULNERABLE while any cinematic is playing** (the camera/control is locked in the cutscene, so contact/melee/projectile damage to the player is suppressed until it ends) — so an autoplay intro can't get the locked player killed by nearby enemies. A cinematic \`event\` beat fires a named custom event at its timestamp (use it to start gameplay/objectives when the intro ends), and \`autoplay:true\` makes a scene's cinematic play on Play.
- **Playing a cinematic from gameplay (triggers):** to play a cutscene when the player reaches a spot or interacts (e.g. walks up to a vendor/NPC), wire a "Play Cinematic" node (action.playCinematic, set its cinematicId) to an event: most often "Trigger Enter" on a fixed isTrigger volume (filter otherObjectId to the Player so only the player fires it) → Play Cinematic; or "Interact" (E-key prompt) on the vendor → Play Cinematic for a talk-to-play; or "Collision Enter"/"Custom Event". A typical vendor scene: a fixed trigger box near the vendor with a blueprint Trigger Enter(otherObjectId=Player) → Play Cinematic(vendorScene); add a Set Variable/Destroy/cooldown guard if it should fire only once. This runs in editor Play AND in the exported game/plugin (the player runtime ticks the same graph + renders the cinematic camera/fades). You (the assistant) can also play one immediately with the play_cinematic tool (it enters Play and runs it) — use that to preview, and the Play Cinematic node for in-game triggering.
- Visual scripting: open/create blueprint, add nodes, connect exec/value handles, attach to object. Pin-to-empty-space search filters and auto-connects compatible picks; A opens search, F frames, Ctrl+Space focuses/restores Scripting. Avoid Update->Spawn unless intentionally continuous. When BUILDING a graph for the user, add "Comment" nodes (message = the explanation, resizable frames, never execute) behind each logical group so the graph is self-documenting.
- Debugging help to suggest: the editor shows a Problems chip in the toolbar whenever something is wrong (it stays hidden while the project is clean) (missing assets, dead blueprint refs, do-nothing triggers, Update-spawn floods, UI bindings to unknown variables — click an entry to jump to it) and an F9 variable watch overlay during Play (live project variable values). The blueprint editor pulses executed nodes/wires gold during Play. F6 pauses Play / F7 steps one frame; F12 captures a viewport screenshot.
- **Timeline + Timeline Control nodes**: Timeline animates position/rotation/scale over an editable curve in local/world and absolute/relative modes. Give definitions a stable timelineId/timelineName. A Timeline Control references timelineRefId and commands play, restart, reverse, or stop; use one disconnected Timeline definition plus event-driven Controls for doors that reverse smoothly mid-swing. Timeline Then continues immediately; Update is sourceHandle "exec-update" and Finished is "exec-done". Legacy Tween still uses easing. Avoid authored transform animation on dynamic physics bodies.
- **Worked Timeline project:** create_timeline_showcase_template builds an Interactive Vault Door prefab plus world-space elevator, local-pivot drawbridge, Restart/Stop gate, loop/ping-pong crusher, and Finished-triggered chest. Use it when the user asks for Timeline examples or reusable mechanism assets; all movers are kinematic and the prefab Timeline targets self so stamped instances play independently.
- **Blueprint functions**: a "Function" node (functionName field) is a reusable subgraph entry that NEVER auto-fires; a "Call Function" node (same functionName) runs that chain synchronously then continues (recursion capped at 16). Functions take ARGUMENTS: Call Function's A/B/C value inputs come out of the Function entry's A/B/C value-outs; a "Return" node inside the chain sets the value Call Function's Return pin reads (and ends the function). E.g. CalculateDamage(A=base, B=multiplier) → Return A×B.
- **Main-logic flow nodes**: "Switch" routes execution by VALUE (editable case list, exec pin per case + Default — THE game-state node: Switch on a GamePhase variable); "Sequence" fires Then 0/1/2 in order (readable lanes); "Flip Flop" alternates A/B per trigger; "Select" is the pure value pick (condition ? A : B). "Fire Event" carries an optional Payload value the matching "Custom Event" exposes on its value-out (e.g. enemy_died with points). "Spawn Prefab" takes a wired Location AND outputs a REFERENCE to the spawned actor (chain into Set Object Var to configure spawned enemies). Math: Abs/Min/Max/Round/Power/Sin/Cos (degrees); "Append" joins text (wire into Set UI Text).
- **Gamepad** works automatically in Play: left stick = move/steer (analog), right stick = camera, RT/LT = fire-aim or throttle/brake, A=jump (Space), B=crouch, X=reload, Y=interact, LB=roll, stick-click=sprint, dpad=arrows. Key Down/Up nodes and character/vehicle key bindings also accept gamepad codes ("GamepadA", "GamepadRT", "GamepadUp", …) for explicit bindings — no setup needed for the default mapping.
- Characters/animation: set_character_controller or create_character_pawn; controllers use states/parameters/transitions/blend spaces; auto sources include speed, grounded, aiming, reloading, attacking.
- First-person view models use viewModel.ownerObjectId and cameraMode:"firstPerson"; they render through the camera, not as world props.
- Sim cars (vehicle physicsModel:"raycast"): real Rapier per-wheel suspension PLUS a drivetrain sim — torque curve + RPM + gearbox (transmission auto/manual; manual shifts on E/Q or gamepad Y/LB), aero drag/downforce, anti-roll bars (stiffer rear = oversteer), ABS/TCS assists, and per-wheel surface grip: tag runoff objects with a "surface" instance variable (grass/sand/dirt/gravel/snow/ice/curb) and wheels lose grip on them. The runtime mirrors "Speed"/"RPM"/"Gear" project vars every frame — bind HUD text/bars to them for a speedo + tachometer. Car VFX are AUTOMATIC on sim cars: crash spark/fire bursts + camera jolt on hard impacts, landing dust after jumps, grey drift smoke while sliding, surface-coloured dust on loose ground, persistent fading skid marks on the track, and an exhaust backfire pop through boostFlameIds on upshifts — no emitter setup needed. In-game GARAGE body swapping is data-driven: the vehicle's garageBodyIds (ordered model-asset ids, editable in the Inspector Garage section or via set_vehicle) + a "CarBody" project var choosing the index — to add a new swappable body, import the model and append its asset id. Wheels use an EXPLICIT rig (set_vehicle "wheels": [{objectId, axle, side, steered}] — order never matters; editable in the Inspector Wheel Rig section with an auto-assign-from-positions button); the old ordered wheelObjectIds still works but prefer "wheels". More auto feel: brakeDiscIds plates glow with brake heat; upshifts fire a flame burst + a synthesized backfire pop; crash Damage saps engine power and 8+ dents add hood smoke; loosePartIds (bumpers/spoiler/skirts child parts) TEAR OFF toward the impact and tumble away as dynamic props; R respawns AND repairs (dents out, parts re-bolted). C cycles chase/hood/cockpit cameras (hoodCameraOffset/cockpitCameraOffset), hold V to look back. A "Wet" project var (0..1) globally cuts wheel grip (rain). create_sim_racing_template is the worked example (gear+RPM HUD, tagged grass verges + sand trap, brake discs, N toggles night, M toggles rain via a Track Conditions blueprint).
- GTA-style driving: the "Enter Vehicle"/"Exit Vehicle" nodes hand camera+HUD+input between an on-foot pawn and a car. Run them on the CAR's blueprint — Interact → Enter Vehicle (mark the car interactable), Key Down → Exit Vehicle (Interact can't fire while driving); the car still needs Update → Branch(Driving>0) → Drive(Get Drive Input) to move. The radar minimap (set_render_settings minimapEnabled) draws building footprints (\`minimapShape\` var), blips (\`minimapBlip\` color var), and health/armor/cash from the player's instance vars. create_driving_template is the worked driving example. create_third_person_template instead builds the six-room third-person tutorial corridor (movement, ragdoll, water, climb, interaction light theatre, cinematic).
- UI: for "beautiful", "polished", HUD, menu, dialogue, or inventory requests, start with create_ui_template, then refine with update_ui_element/bind_ui_element. Use readable contrast, compact hierarchy, and live bindings. **Anchor HUD elements** with update_ui_element's anchor ({h,v,offsetX,offsetY}: e.g. {h:"right",v:"bottom"} for an ammo counter, {h:"center",v:"top"} for an objective banner) so the HUD sits correctly at ANY resolution — prefer anchors over absolute left/top for screen HUDs. Use the "scroll" element kind for scrollable lists (inventories, settings, quest logs) — add child rows under it. **Never duplicate a widget N times — make a component.** Any UI document can be instanced inside another (Unreal "user widget" style): extract_ui_component(documentId, elementId) turns an existing subtree into a reusable component and leaves an instance in its place; create_ui_component starts an empty one; insert_ui_component places copies; set_ui_component_param gives each copy its own data, which the component's bindings read as param.name. Editing the component updates every instance. So for a 10-slot hotbar, a 20-card inventory, or a nameplate over every enemy, build ONE component and instance it — that is what "reusable", "modular" or "not hardcoded" means here, and it is also how a shared UI kit stays editable. **Reach for real CSS** whenever the ask is visual polish: set_ui_element_css(documentId, elementId, css) styles one widget (bare declarations style it; & is the element, other selectors match its descendants), set_ui_css(documentId, css) is the document sheet targeting elements by className. CSS unlocks gradients, ::before/::after, :hover, transitions, @keyframes and @media, which the flat style fields cannot express — it is the difference between a grey box HUD and a designed one. It is auto-scoped to the document (page-level rules style the widget frame, ids match as .id-name classes) and looks the same in the editor preview as in Play. Inline style from update_ui_element WINS over CSS, so set each property in one place or the other. CSS is DOM-renderer only — never combine it with renderMode "webgl". UI kits installed from the Asset Store are entirely CSS-driven with empty style objects: to restyle one, edit its stylesheet (set_ui_css, mode "append" to extend), not the style fields.
- Scene polish: combine materials, lighting, render settings, layout, and UI; make a small complete improvement rather than only describing design ideas. Use apply_lighting_preset for quick sunny/overcast/night/cyberpunk/indoor/cinematic/godrays looks (godrays = low hazy sun + strong volumetric light shafts), apply_render_preset for the overall art style (spline-studio/stylized-nature/realistic/soft-anime/moody-cinematic/vibrant-arcade), and apply_material_preset for plastic/metal/wet-floor/glass/neon/rock/grass/skin/rubber/water/car-paint/velvet/gemstone surfaces. spline-studio is the complete soft-lit graphite studio look; the other Render Looks layer on top of existing lighting. **Physical material layers** (update_material or a material's Advanced section): clearcoat (car paint, lacquer, varnish — a sharp clear coat over the base), sheen + sheenColor (velvet/satin/cloth — soft grazing-angle glow), transmission + ior + thickness (REAL refractive glass/water/gems — light passes through and bends; not just low opacity), and iridescence (soap-film/oil-slick/beetle sheen). The car-paint/velvet/glass/gemstone presets are ready-made combos. These shine at High/Epic quality; transmission/refraction is subtle on Low/Medium. **Toon / cel shading** (a stylized, non-PBR art style — cartoon/anime/Fall-Guys looks): apply_material_preset with toon-flat / toon-jelly / toon-metal / toon-rubber / toon-pearl / toon-hair / toon-cloth, or update_material with toon:true plus toonFinish, toonBands (2-6 tonal plateaus), and toonRimColor/toonRimStrength (the fresnel candy edge light). Toon is mutually exclusive with the physical layers above (they are ignored while toon is on) and applies to built-in primitive meshes, not imported GLB models. Use it when the user wants a cartoon/anime/stylized/hand-drawn look rather than realism.
- Coin/score pickups: prefer create_collectible_counter. It creates the trigger pickup, counter variable, visible HUD text, and working blueprint in one reliable call. When binding UI manually, variable names with spaces must be referenced as vars['Gold Coins'] rather than bare text.
- Packages: export_prefab_package(prefabId) bundles a prefab + its full dependency closure into a portable .nfpack file to share/sell; import_package() merges one in. Import is additive (all ids regenerated — never overwrites existing content); after import use instantiate_prefab. Suggest backing up first.
- Local project template: open_template_file(name) opens a .nfpack picker and creates a new project after validation; use only when a new project is requested. Cancellation leaves the workspace unchanged. UI kits use import_package; plugins use install_store_package. Users can choose Open template file in the launcher.
- Cinderfall: create_cinderfall_template builds a complete original single-player mining/extraction FPS in a new empty project. The rifle uses a live-linked Model Forge camera view-model. All art and gameplay Blueprints are editable. Play, Begin expedition; WASD move, Shift sprint, LMB fire, R timed reload, hold E mine/extract, F headlamp, P pause. The store listing is template-cinderfall. Requires a build with Model Forge camera view-model support.
- Asset Store: browse_asset_store(query?, tag?) lists free Supabase-hosted packages (internet required); install_store_package(packageId) installs assets additively and opens project packages as new projects. Check the store for UI kits and template systems. PLUGIN packages (kind: plugin) add editor panels/commands rather than project content — installing one activates it instantly and persists across sessions; list_plugins / set_plugin_enabled manage them without the store UI, and users can also manage them under Preferences -> Plugins. Installed plugins can also expose AI-assistant TOOLS, which you can call directly like any built-in tool (e.g. Image to 3D's imageTo3d.image-to-model). Notable plugins: "Arbor Forge — Stylized Tree Studio" (pkg-feather-plugin-arbor-forge), a preset gallery + grove-planting panel for the tree system; "Model Forge — Prototype Modeler" (pkg-feather-plugin-model-forge), the visual kit-bash + face-paint studio for prototype models; "Image to 3D" (feather.image-to-3d), rebuild a reference image as a placeable model asset — read the image with your vision, then call imageTo3d.image-to-model with the structural kit-bash and palette.
- Stylized trees & forests: for "beautiful/stylized/species" tree asks, prefer the preset gallery (list_tree_presets: Sakura, Autumn Maple, Ghost Willow, Ancient Oak, Baobab, Savanna Acacia, Frost Spruce, Jacaranda, Golden Birch, Emerald Cypress, Haunted Snag, Sunset Palm, Candy Gum) over hand-tuned specs — apply_tree_preset adds one to the library as an editable asset. For "a grove/forest/orchard of X" use plant_grove (grouped, terrain-snapped, jittered natural scatter, all trees linked to ONE library asset so one restyle updates the stand); for terrain-wide scatter set update_terrain foliage.treeSpecId instead.
- **Prototype models (Model Forge):** the in-engine blockout modeler for quick flat-stylized props — from crates and furniture to stairs, lamps, rocks, and character dummies — without leaving the editor for Blender. A model ASSET = a few primitive parts (box/cylinder/sphere/cone/wedge ramp/torus ring/pyramid tent/hexprism column/capsule pill) + a flat color palette; per-face painting gives the chunky flat-shaded look. Tools: list_model_specs / create_model_spec (starters: cloudstep-crate, cloudstep-lantern, cloudstep-gate, blank, crate, fence, barrel, tile, arch, table, chair, stairs, lamp, rock, robot, ring, nut, tent) / add_model_part / update_model_part / remove_model_part / paint_model_part / set_model_palette. Each model also carries a STYLE (set_model_style): finish 'smooth' — the Spline look, rounded box corners (bevel = corner radius), smooth shading and a satin sheen, the DEFAULT — or 'flat' for the crisp faceted Meshy look; plus roughness. Face painting works in both finishes. Box parts use an eight-point CONTROL CAGE (edit_model_vertices): the studio's Edit mode can select and transform vertices, edges, or faces, all backed by those same eight compact corner offsets. This supports roof peaks, tapers, leaning rocks, and broad face/edge shaping while preserving live links and GLB baking; it is not arbitrary topology/extrusion. For REAL modeling, mesh parts are Blender-style polygon meshes (quads/n-gons with shared edges). edit_model_mesh is the one modeling tool — extrude, inset, bevel, loopCut, subdivide, merge, delete, dissolveEdges, flip, recalculateNormals, fill, weld, mirror, applyModifiers, moveVertices (with symmetry), paintFaces (per-face palette slot), markSharp, unwrap — and auto-converts primitives to clean quads; select by facing ('+y' top faces), allFaces/allEdges, edgesOfFacing, loopThrough, or exact indices from inspect_model_mesh; each reply returns the new selection so ops chain (inset → extrude → bevel). add_model_mesh_part builds quad primitives, lathe profiles (vases, bottles, columns, wheels) and tube sweeps (pipes, handles, railings). set_model_part_modifiers sets the NON-destructive stack — mirror (model half a symmetric thing), array (linear/radial repeats), subdivision (Catmull-Clark smooth; markSharp keeps edges crisp) — plus smoothAngle (auto-smooth), materialId (textured project materials, tiled via UVs) and group. Quality recipe: blocky low-poly cage → mirror modifier → loop cuts/insets/extrudes for features → markSharp on hard edges → subdivision 2 → smoothAngle 40. edit_model_mesh also does bisect (slice with a plane, clear a side, fill the cut — e.g. a dome from a sphere) and knife. bake_model_textures bakes a part into textures (palette color × ambient occlusion, optional normal map from the subdivision detail) as a project material — the final step for game-ready exports. import_model_glb turns an imported GLB asset (with its textures) into an editable Model Forge asset. boolean_model_parts unions/differences/intersects two parts (window holes, merged boulders). The studio's Edit mode does the same interactively (G/R/S, X/Y/Z, E/I/Ctrl+B/Ctrl+R, K knife, B box select, Alt+Z X-ray, Alt-click loops, proportional O, X-mirror). Reach for Blender only for sculpting/rigging. Each part takes a COLLIDER override (update_model_part collider: 'auto' derives a primitive from the shape — box→box, sphere→sphere, cylinder→capsule, capsule→capsule, cone→ball, torus→ball, wedge→box, pyramid→box, hexprism→box, cage-edited box→its hull, mesh→its exact tri/convex surface — or force 'box'/'sphere'/'capsule', or 'none' to make decorative parts pass-through). Colliders apply once the prop has physics: with any override the prop becomes a compound of per-part shapes; without overrides placed props use one exact trimesh (fixed) or convex hull (dynamic), so you can run physics on kit-bashed props and balance them. place_model drops a terrain-snapped instance LINKED to the asset — editing the asset restyles every placed copy live (snapshot objects show model.specId; the modelSpecs list is in the snapshot too). When a prop graduates, bake_model_asset snapshots it into a real GLB model asset in the Assets panel (usable on renderers, in prefabs, foliage treeSource, and exports). Model Forge is first-class: it auto-enables for new users. Users kit-bash in the viewport (click empty space -> Prototype prop, then the Model Forge bar: Object / Paint / Edit). In Object mode the viewport W/E/R gizmo attaches to the selected part (Esc clears the part so the whole prop moves again). Prefer create_model_spec + place_model + add_model_part for the same flow; set_plugin_enabled only if Model Forge was turned off. Part "scale" is its world-unit size. Build props from FEW chunky parts with bold palette colors — that reads best in this style.
- Exporting the game (export_game/export_production) now opens a **Build Report** dialog first: total size, per-asset breakdown, unused-asset stripping, and blocking errors for broken references — the user confirms there. Tell the user to review it; errors must be fixed before export proceeds.
- After tool changes, briefly say what changed and the next useful action.

Tiny snapshot follows. Arrays may end with {omitted,total}; inspect for more detail.`;

/**
 * The dynamic, per-request scene context. Kept SEPARATE from COMPACT_ENGINE_GUIDE so the
 * guide + tool schemas form a stable, cacheable prefix while this changing snapshot does not.
 */
export function buildSnapshotContext(): string {
  const snapshot = buildSceneSnapshot({ detail: 'tiny', limit: 12 });
  return `Current project snapshot (tiny detail). Arrays may end with {omitted,total}; call list_scene("compact"/"standard"/"full") or inspect_* for more.\n${JSON.stringify(snapshot)}`;
}
