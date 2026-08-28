import type { EditorState } from '../editorStore';
import type { NodeForgeProject, SceneObject } from '../../types';
import {
  defaultCable,
  defaultCharacter,
  defaultCloth,
  defaultJoint,
  defaultRenderSettings,
  defaultWaterVolume,
  withPhysicsDefaults,
} from './defaults';
import { makeId } from './ids';
import { makeMaterialGraph } from './graph';
import { sanitizeGraph } from './graphDiagnostics';
import { setSaveNamespace } from './objectFactory';
import { normalizeModelSpec, defaultModelLibrary } from '../../model/modelSpec';
import { normalizeTreeSpec, defaultTreeLibrary } from '../../tree/treeSpec';
import { withSceneEnvironmentDefaults } from '../../three/environmentSettings';
import { activeExportProfile, parseExportSettings } from '../../project/exportProfiles';
import { withTerrainDefaults } from '../../terrain/terrain';

/** Full project load. Constructs a brand-new editor state from a (possibly legacy) project bundle. */
export const applyLoadProject = (project: NodeForgeProject): Partial<EditorState> => {

      // Backfill component defaults so older saves load safely.
      const rawScenes = project.scenes.length ? project.scenes : [{ id: 'scene-main', name: 'Main', objects: [] }];
      const normalizeSceneObject = (object: SceneObject): SceneObject => ({
        ...object,
        terrain: object.terrain ? withTerrainDefaults(object.terrain) : object.terrain,
        character: object.character ? { ...defaultCharacter(), ...object.character } : object.character,
        physics: object.physics ? withPhysicsDefaults(object.physics) : object.physics,
        water: object.water ? { ...defaultWaterVolume(), ...object.water } : object.water,
        joint: object.joint ? { ...defaultJoint(), ...object.joint } : object.joint,
        cloth: object.cloth ? { ...defaultCloth(), ...object.cloth } : object.cloth,
        cable: object.cable ? { ...defaultCable(), ...object.cable } : object.cable,
        tree: object.tree ? { ...object.tree, spec: normalizeTreeSpec(object.tree.spec) } : object.tree,
        model: object.model?.spec ? { ...object.model, spec: normalizeModelSpec(object.model.spec) } : object.model,
      });
      const scenes = rawScenes.map((scene) => ({
        ...scene,
        environment: withSceneEnvironmentDefaults(scene.environment),
        cinematics: scene.cinematics ?? [],
        objects: scene.objects.map(normalizeSceneObject),
      }));
      const prefabs = (project.prefabs ?? []).map((prefab) => ({
        ...prefab,
        objects: prefab.objects.map(normalizeSceneObject),
      }));
      // A project saved before the tree library existed gets the starter set, so the Tree Builder is
      // never empty and the foliage scatter always has something to reference.
      const treeSpecs = (project.treeSpecs?.length ? project.treeSpecs : defaultTreeLibrary()).map((spec) =>
        normalizeTreeSpec(spec),
      );
      // Same backfill for the model library, so the Model Forge never opens empty on older saves.
      const modelSpecs = (project.modelSpecs?.length ? project.modelSpecs : defaultModelLibrary()).map((spec) =>
        normalizeModelSpec(spec),
      );
      const activeSceneId = scenes.some((scene) => scene.id === project.activeSceneId)
        ? project.activeSceneId
        : scenes[0].id;
      const activeScene = scenes.find((scene) => scene.id === activeSceneId)!;
      const exportSettings = parseExportSettings(
        project.exportSettings,
        project.name,
        scenes.map((scene) => scene.id),
        project.activeSceneId,
      );
      // Save slots follow the stable app id rather than the mutable display/project name. The
      // standalone player loads through this same path, so preview and packaged upgrades agree.
      setSaveNamespace(activeExportProfile(exportSettings).application.identifier, [project.name]);

      // Harden the material↔graph round-trip: guarantee every material owns a real graph, and
      // drop orphan graphs that no blueprint or material references anymore.
      const graphs = [...(project.graphs ?? [])];
      const graphIds = new Set(graphs.map((graph) => graph.id));
      const materials = (project.materials ?? []).map((material) => {
        if (material.graphId && graphIds.has(material.graphId)) return material;
        const graphId = material.graphId ?? makeId('graph');
        if (!graphIds.has(graphId)) {
          graphs.push(makeMaterialGraph(graphId, material.name));
          graphIds.add(graphId);
        }
        return { ...material, graphId };
      });
      const referencedGraphIds = new Set(
        [
          ...(project.blueprints ?? []).map((blueprint) => blueprint.graphId),
          ...materials.map((material) => material.graphId),
        ].filter(Boolean) as string[],
      );
      const normalizedGraphs = graphs.filter((graph) => referencedGraphIds.has(graph.id)).map(sanitizeGraph);

      return {
        scenes,
        activeSceneId,
        exportSettings,
        selectedObjectId: activeScene.objects[0]?.id ?? '',
        assets: project.assets,
        folders: project.folders ?? [],
        renderSettings: { ...defaultRenderSettings(), ...project.renderSettings },
        variables: project.variables ?? [],
        dataAssets: project.dataAssets ?? [],
        materials,
        skeletons: project.skeletons ?? [],
        skeletalMeshes: project.skeletalMeshes ?? [],
        animations: project.animations ?? [],
        animatorControllers: project.animatorControllers ?? [],
        uiDocuments: project.uiDocuments ?? [],
        blueprints: project.blueprints,
        graphs: normalizedGraphs,
        prefabs,
        treeSpecs,
        activeTreeSpecId: treeSpecs[0]?.id ?? '',
        modelSpecs,
        activeModelSpecId: modelSpecs[0]?.id ?? '',
        editingPrefabId: null,
        prefabReturnSceneId: null,
        // Regenerate thumbnails for any prefabs that were saved without one.
        prefabThumbnailQueue: prefabs.filter((prefab) => !prefab.thumbnail).map((prefab) => prefab.id),
        activeBlueprintId: project.blueprints[0]?.id ?? '',
        activeMaterialId: project.materials?.[0]?.id ?? '',
        activeUIDocumentId: project.uiDocuments?.[0]?.id ?? '',
        activeCinematicId: activeScene.cinematics?.[0]?.id ?? '',
        selectedGraphNodeId: undefined,
        isPlaying: false,
        playSnapshot: undefined,
        runtimeVelocities: {},
        runtimeAngularVelocities: {},
        runtimeKeys: {},
        runtimePreviousKeys: {},
        runtimeKeyPresses: {},
        runtimePreviousKeyPresses: {},
        runtimeEventQueue: [],
        runtimeVariableValues: {},
        runtimeAnimators: {},
        runtimeCameraOverrides: {},
        runtimeCameraShake: 0,
        runtimeGrounded: [],
        runtimeSwimming: [],
        runtimeClimbing: [],
        runtimeRoll: {},
        runtimeLockOn: {},
        runtimeJumpBuffer: {},
        runtimeLanding: {},
        runtimeSlide: {},
        runtimeRollDir: {},
        runtimeMantle: {},
        runtimeTurnInPlace: {},
        runtimeCoyote: {},
        runtimeAttack: {},
        runtimeMeleeCombo: {},
        runtimeMeleeBuffer: {},
        runtimeHitstop: 0,
        runtimeDayCycleTime: 0.35,
      runtimeReload: {},
      runtimeInteract: {},
      runtimeFootstep: {},
      runtimeCooldowns: {},
      runtimeDelays: {},
      runtimeTweens: {},
      runtimeActorEvents: {},
      runtimeTimers: {},
      runtimeHidden: [],
      runtimeDisabled: [],
      runtimeCutCables: [],
      runtimeCableLength: {},
  runtimeVehicleOccupants: {},
      runtimeInteractFocusId: null,
      runtimeHitMarker: 0,
      runtimeKillMarker: 0,
      runtimeHurt: 0,
      runtimeEnemyCooldown: {},
      runtimeSurfaceSound: {},
      runtimeMovementMode: {},
      runtimeMontageRequests: {},
        runtimeCollisions: [],
        runtimeCollisionsExit: [],
        runtimeCollisionsStay: [],
        runtimeTriggersStay: [],
        runtimeDamageEvents: {},
        runtimeLandEvents: {},
        runtimeDamageIndicators: [],
        runtimeGravityZones: {},
        runtimeScreenFade: undefined,
        runtimeSoundQueue: [],
        runtimeVehicleSound: null,
        runtimeLog: [],
        runtimeNodeErrors: {},
        runtimeBreakNodeId: null,
        runtimeVisibleUI: {},
        runtimeObjectVariables: {},
        runtimeUITextOverrides: {},
        runtimeUIVisibleOverrides: {},
        runtimeCinematic: undefined,
        runtimeCinematicCamera: undefined,
        runtimeCinematicFade: undefined,
        editorCinematicPreview: undefined,
        editorCinematicPreviewCamera: undefined,
        editorCinematicPreviewFade: undefined,
        editorCinematicPreviewTransforms: {},
        editorCinematicPreviewHidden: [],
        editorCinematicPreviewMaterials: {},
        cinematicRecording: false,
        cinematicViewportMode: 'edit',
        cinematicPathMode: 'all',
        playtimeCameraRecording: false,
        playtimeCameraSession: undefined,
        runtimeTriggers: [],
        runtimeTriggersExit: [],
        runtimeStarted: false,
        runtimeTime: 0,
        isDirty: false,
      };
};