import type { Edge, OnConnect, OnEdgesChange, OnNodesChange, OnReconnect } from '@xyflow/react';
import { create } from 'zustand';
import {
  type Prefab,
  type AssetItem,
  type AssetType,
  type ColliderType,
  type CompareOperator,
  type DataAsset,
  type DataAssetColumn,
  type DataAssetRow,
  type GraphNodeCategory,
  type GraphValue,
  type GraphValueType,
  type GraphNodeKind,
  type GraphNodeTone,
  type AnimatorComponent,
  type CableComponent,
  type ClothComponent,
  type JointComponent,
  type JointType,
  type MaterialDefinition,
  type MaterialOverrides,
  type MeshRendererComponent,
  type NodeForgeProject,
  type NodeForgeNode,
  type NodeForgeNodeData,
  type PhysicsComponent,
  type ProjectFolder,
  type ProjectGraph,
  type ProjectileComponent,
  type LightComponent,
  type ReflectionProbeComponent,
  type ParticleSystemComponent,
  type ParticleConfig,
  type ParticleSystemDefinition,
  type RenderSettings,
  type RenderPresetId,
  type QualityLevel,
  type SceneEnvironmentSettings,
  type SceneStreamingSettings,
  type ProjectVariable,
  type RigidBodyType,
  type Scene,
  type SceneObject,
  type SceneObjectKind,
  type FractureComponent,
  type ScriptBlueprint,
  type BlueprintVariable,
  type SkeletonAsset,
  type SkeletonSocket,
  type AttachmentComponent,
  type RagdollSettings,
  type RagdollBodyDef,
  type SkeletalMeshAsset,
  type AnimationAsset,
  type AnimatorController,
  type AnimatorParameter,
  type AnimatorState,
  type AnimatorTransition,
  type AnimatorCondition,
  type CharacterControllerComponent,
  type VehicleComponent,
  type CinematicAction,
  type CinematicCameraKeyframe,
  type CinematicInterpolation,
  type CinematicMarker,
  type CinematicMaterialKeyframe,
  type CinematicTransformKeyframe,
  type CinematicEase,
  type CinematicLook,
  type CinematicSequence,
  type InventoryComponent,
  type RuntimeCinematicCamera,
  type RuntimeCinematicFade,
  type RuntimeScreenFade,
  type RuntimeCinematicState,
  type RuntimeCinematicText,
  type TerrainComponent,
  type TerrainBrushSettings,
  type TerrainMaterialLayer,
  type TerrainSculptOperation,
  type TimelineCurveKey,
  type RuntimeSoundEvent,
  type TransformComponent,
  type Vector3Tuple,
  type UIDocument,
  type UIElement,
  type UIElementKind,
  type UIBinding,
  type UIComponent,
  type UISurface,
  type UIPresetKind,
  type TreeArchetype,
  type TreeComponent,
  type TreeSpec,
  type WaterVolumeComponent,
  type ExportProfile,
  type ExportSettings,
} from '../types';
import { getActivePhysics, startPhysics, stopPhysics, type PhysicsContactEvent, type VehicleWheelState } from '../runtime/physicsWorld';
import { audioEngine } from '../runtime/audioEngine';
import { pushExplosion, clearExplosions } from '../runtime/explosionBus';
import { addDecal, clearDecals, type DecalKind } from '../runtime/decalBus';
import { cameraPitch as mouseCameraPitch, cameraYaw as mouseCameraYaw } from '../runtime/mouseLook';
import { gamepadInput } from '../runtime/gamepadInput';
import { recordValue } from '../runtime/valueTrace';
import { addSkidMark } from '../runtime/skidMarks';
import { isRagdoll, setRagdoll, getRagdollRoot } from '../runtime/ragdollState';
import { sendParticleCommand } from '../runtime/particleBus';
import { addVehicleDent, clearVehicleDents, clearVehicleDentsFor } from '../runtime/vehicleDamageBus';
import { publishTransforms, publishRenderTransforms, clearTransformBuffer, type BufferedTransform } from '../runtime/transformBuffer';
import { updateFoliageInteractors, clearFoliageInteractors, MAX_FOLIAGE_INTERACTORS, type FoliageInteractor } from '../three/foliageInteractors';
import { beginPerceptionFrame, clearPerception, cachedLineOfSight, storeLineOfSight } from '../runtime/aiPerception';
import { type ParticlePresetId } from '../runtime/particlePresets';
import { applyPhysicsMaterialPreset } from '../runtime/physicsMaterials';
import { resolveMaterial } from '../three/materialResolve';
import { customizedModelIds, isInstanceable } from '../three/modelInstancing';
import { WATER_LOOK_KEYS, findRenderPreset, waterStylePatch } from '../three/presets';
import { defaultSceneEnvironment, withSceneEnvironmentDefaults } from '../three/environmentSettings';
import { chopTree, clearTreeChops } from '../runtime/treeChop';
import { isRollInvulnerable, meleeComboDamage } from '../runtime/combatFeel';
import { wrapDayCycleTime } from '../three/dayCycle';
import { DEFAULT_TREE_IDS, defaultTreeLibrary, normalizeTreeSpec, treeRng, treeSpecFromArchetype } from '../tree/treeSpec';
import { getStylizedPreset, stylizedTreeSpec } from '../tree/stylizedPresets';
import { defaultModelLibrary, makeModelPart, modelSpecFromStarter, normalizeModelSpec } from '../model/modelSpec';
import {
  applyBooleanModelParts,
  applyConvertModelPartToMesh,
  applyExtrudeModelPartFaces,
  applySetModelPartMeshVertices,
  applySubdivideModelPartFaces,
} from './editor/treeActions';
import type { ModelPart, ModelPartShape, ModelSpec } from '../types';

/** How a grove picks its tree asset: an explicit library spec, a stylized preset, or an archetype. */
export interface PlantGroveOptions {
  /** Library asset to link every tree to. Takes precedence over presetId/archetype. */
  specId?: string;
  /** Stylized preset id — added to the library first (an existing same-named entry is reused). */
  presetId?: string;
  /** Fallback: the first library entry of this archetype (created if the library has none). */
  archetype?: TreeArchetype;
  /** Grove centre; y is only used where there is no terrain to snap to. */
  position?: Vector3Tuple;
  /** Trees to plant. Default 12, clamped to 1–80. */
  count?: number;
  /** Disc radius in world units. Default 12, clamped to 1–200. */
  radius?: number;
  /** Layout seed — the same seed replants the identical grove. Random when omitted. */
  seed?: number;
  name?: string;
}

export interface InstancedGridOptions {
  /** Number of rows along world Z. Defaults to 3. */
  rows?: number;
  /** Number of columns along world X. Defaults to 3. */
  columns?: number;
  /** Distance between columns. Defaults to 2 world units. */
  spacingX?: number;
  /** Distance between rows. Defaults to 2 world units. */
  spacingZ?: number;
}

/** Editor-only state for a live, possessed camera take being captured during Play. */
export interface PlaytimeCameraRecordingSession {
  sequenceId: string;
  samples: CinematicCameraKeyframe[];
}

import { highestTerrainWorldHeight } from '../terrain/terrain';
import { GRASS_PRESETS, applyTerrainFoliagePaint, applyTerrainPaint, applyTerrainSculpt, createTerrainHeightSampler, defaultStylizedGrass, terrainLocalPointFromWorld, type GrassPresetId } from '../terrain/terrain';
import { worldTransformOf, worldToLocalUnderParent } from '../utils/transformHierarchy';
import type { ModelInspection } from '../three/inspectModel';
import type { PackageContent } from '../project/package';
import { activeExportProfile, createDefaultExportSettings, parseExportSettings, retargetDeletedScene } from '../project/exportProfiles';
import {
  cinematicActionsAt,
  cinematicCameraAt,
  cinematicFadeAt,
  cinematicHiddenAt,
  cinematicMaterialsAt,
  cinematicTextAt,
  cinematicTimeScaleAt,
  cinematicTransformsAt,
  clamp01,
  initialCinematicCamera,
  initialCinematicFade,
  mixVec3,
} from './editor/cinematics';
import { getAnimatorControllerRuntime } from './editor/animatorRuntime';
import {
  defaultAnimator,
  defaultCable,
  defaultCharacter,
  defaultCloth,
  defaultJoint,
  defaultRagdollSettings,
  defaultRenderSettings,
  defaultTerrainBrush,
  defaultVehicle,
  defaultWaterVolume,
  lerpAngle,
  resolveCharacter,
  resolveVehicle,
  syncTerrainLayerColors,
  type CreateObjectOptions,
  type RuntimeAnimator,
} from './editor/defaults';
import {
  makeUIElement,
  cloneUIElementFresh,
  defaultUIComponent,
  findUIElement,
  findUIParent,
  makeUIDocument,
  makeUIPreset,
  makeUITemplate,
  applyUIThemeToElement,
  clearUIComponentRefs,
  mapUIElement,
  removeUIElementFromTree,
  replaceUIElementInTree,
  wouldCreateUICycle,
  uiVariableRef,
  type UITemplateKind,
  type UIThemeKind,
} from './editor/ui';
import {
  graphId,
  blueprintId,
  starterBlueprints,
  starterDataAssets,
  starterEdges,
  starterNodes,
  starterSceneId,
  starterScenes,
  starterRenderSettings,
  starterVariables,
} from './editor/starterProject';
import {
  axisIndex,
  clearSaveSlot,
  compareValues,
  graphValueToString,
  defaultFracture,
  inferGraphType,
  makeFractureChunks,
  makeDamageNumber,
  makeExplosion,
  makeDustPuff,
  makeImpactObject,
  makeMuzzleFlash,
  makeProjectileObject,
  makeRuntimeVariableMap,
  makeRuntimeVelocityMap,
  makeSpawnedObject,
  makeSpawnedParticleEmitter,
  makeSplashObject,
  readSaveSlot,
  setSaveNamespace,
  seedBlueprintInstanceVars,
  toBoolean,
  toNumber,
  writeSaveSlot,
  type ProjectileSetup,
} from './editor/objectFactory';
import { buildContactIndex, contactMatches, contactOthers, contactTouches, firstContactEvent, firstContactOther, toIdSet, toLowerCaseSet } from './editor/runtimeIndexes';
import { makeId, stripUndefined } from './editor/ids';
import { type FeatherCompileResult } from '../scripting/featherCompiler';
import { buildNavGrid, findNavPath, type NavGrid, type NavObstacle } from '../runtime/navGrid';
import {
  cloneObjectTree,
  collectSubtree,
  deleteWithChildren,
  EARTH_GRAVITY,
  effectiveSelection,
  effectLife,
  EMPTY_EXEC_TARGETS,
  ensureNavGrid,
  indexAnimationsById,
  indexAssetsByName,
  indexBlueprintsById,
  indexControllersById,
  indexDataAssetsById,
  indexPrefabsById,
  indexSceneObjectsById,
  indexTableColumnsById,
  indexTableRowsByKey,
  indexVariablesById,
  indexVariablesByName,
  mapActiveSceneObjects,
  navPathsForPlay,
  resetNavCache,
  resetStreamingCache,
  selectActiveObjects,
  selectActiveSceneEnvironment,
  streamedOutIds,
} from './editor/storeHelpers';
export {
  effectiveSelection,
  selectActiveObjects,
  selectActiveSceneEnvironment,
} from './editor/storeHelpers';
import { applySetPlaying } from './editor/playState';
import { applyLoadProject } from './editor/loadProject';
import {
  applyCreateRoleObject,
  applyMakeObjectRole,
} from './editor/creatorActions';
import type { CreateRoleObjectOptions, CreatorRoleActionResult } from '../creator/roles';
import { applyAddSimpleInteraction, type SimpleInteractionActionResult } from './editor/simpleInteractionActions';
import type { SimpleInteractionDraft } from '../creator/simpleInteractions';
import { applyCreateCreatorGameplayKit, type CreatorGameplayKitResult } from './editor/gameplayKitActions';
import {
  applyAddSkeletonSocket,
  applyAttachBehaviorPreset,
  applyCreateCollectibleCounter,
  applyGenerateRagdollBodies,
  applyRegisterImportedModel,
  applyRemoveRagdollBody,
  applyRemoveSkeletonSocket,
  applySetRagdollBody,
  applySetVehicleEnabled,
  applyUpdateRenderSettings,
  applyUpdateSceneStreaming,
  applyUpdateSkeletonRagdoll,
  applyUpdateSkeletonSocket,
  applyUpdateVehicle,
} from './editor/componentActions';
import {
  applyAddAssets,
  applyAddAssetItems,
  applyBuildFolderPackage,
  applyBuildPrefabPackage,
  applyBuildProjectPackage,
  applyExportProject,
  applyMarkClean,
  applyMergePackage,
  applyMergeProjectPackage,
  applyRemoveAsset,
  applySetAssetSearch,
} from './editor/packageActions';
import { applyFinishPlaytimeCameraRecording } from './editor/finishPlaytimeCameraRecording';
import {
  applyAddAnimatorParameter,
  applyAddAnimatorState,
  applyAddAnimatorTransition,
  applyCreateAnimatorController,
  applyDeleteAnimatorController,
  applyRemoveAnimatorParameter,
  applyRemoveAnimatorState,
  applyRemoveAnimatorTransition,
  applySetActiveAnimatorController,
  applySetObjectAnimatorController,
  applySetRuntimeAnimatorParam,
  applyToggleAnimator,
  applyToggleCharacterController,
  applyUpdateAnimator,
  applyUpdateAnimatorController,
  applyUpdateAnimatorParameter,
  applyUpdateAnimatorState,
  applyUpdateAnimatorTransition,
  applyUpdateCharacterController,
} from './editor/animatorActions';
import {
  applyAddCinematicAction,
  applyAddCinematicCameraKeyframe,
  applyAddCinematicMarker,
  applyAddCinematicShot,
  applyAddCinematicTransition,
  applyAddCinematicTransformKeyframe,
  applyAimCinematicKeyframe,
  applyClearCinematicPreview,
  applyCreateCinematic,
  applyDeleteCinematic,
  applyDuplicateCinematicTake,
  applyMoveCinematicKeyframe,
  applyPreviewCinematic,
  applyPlayCinematic,
  applyRecordPlaytimeCameraSample,
  applyRemoveCinematicAction,
  applyRemoveCinematicMarker,
  applySelectCinematicKeyframe,
  applySetActiveCinematic,
  applySetCinematicLook,
  applySetCinematicPathMode,
  applySetCinematicRecording,
  applySetCinematicViewportMode,
  applySetPlaytimeCameraRecording,
  applyStopCinematic,
  applyUpdateCinematic,
  applyUpdateCinematicAction,
  applyUpdateCinematicMarker,
} from './editor/cinematicActions';
import {
  applyAddUIElement,
  applyAddUIPreset,
  applyAttachUI,
  applyCreateUIDocument,
  applyCreateUIComponent,
  applyCreateUIFromTemplate,
  applyDeleteUIDocument,
  applyDetachUI,
  applyDuplicateUIElement,
  applyExtractUIComponent,
  applyHideUI,
  applyInsertUIComponent,
  applyMoveUIElement,
  applyOpenUILogic,
  applyRemoveUIElement,
  applyRenameUIDocument,
  applySelectUIElement,
  applySetActiveUIDocument,
  applySetObjectVariable,
  applySetRuntimeVariableByName,
  applySetUIBinding,
  applySetUIComponentParam,
  applySetUIDocumentCss,
  applySetUIElementCss,
  applySetUIElementVisible,
  applySetUIText,
  applyShowUI,
  applyUITheme,
  applyUpdateUIComponent,
  applyUpdateUIDocument,
  applyUpdateUIElement,
} from './editor/uiActions';
import {
  applyAddTerrainMaterialLayer,
  applyApplyTerrainBrush,
  applyClearTerrainEdits,
  applyPaintFoliageAt,
  applyPaintTerrainAt,
  applyRemoveTerrainMaterialLayer,
  applySculptTerrainAt,
  applySetTerrainBrush,
  applyUpdateTerrain,
  applyUpdateTerrainMaterialLayer,
} from './editor/terrainActions';
import {
  applyAddModelPart,
  applyApplyGrassPreset,
  applyAttachModelSpec,
  applyChopTreeAt,
  applyCreateModelFromSpec,
  applyCreateModelSpec,
  applyCreateTree,
  applyCreateTreeFromSpec,
  applyCreateTreeSpec,
  applyCreateTreeSpecFromPreset,
  applyDeleteModelSpec,
  applyDeleteTreeSpec,
  applyDuplicateModelPart,
  applyDuplicateModelSpec,
  applyDuplicateTreeSpec,
  applyPaintModelPart,
  applyPlantGrove,
  applyRemoveModelPart,
  applySetActiveModelSpec,
  applySetActiveTreeSpec,
  applySetModelPalette,
  applySetModelPartCorners,
  applyUpdateModelPart,
  applyUpdateModelSpec,
  applyUpdateTree,
  applyUpdateTreeSpec,
} from './editor/treeActions';
import {
  applyAddCable,
  applyAddCloth,
  applyAddJoint,
  applyRemoveCable,
  applyRemoveCloth,
  applyRemoveJoint,
  applySetObjectFracture,
  applyTogglePhysics,
  applyToggleWater,
  applyUpdateCable,
  applyUpdateCloth,
  applyUpdateJoint,
  applyUpdatePhysics,
  applyUpdateWater,
} from './editor/physicsActions';
import {
  applyAddGameplayKit,
  applyAddParticles,
  applyCopySelectedObjects,
  applyCreateCharacterPawn,
  applyCreateInstancedGrid,
  applyCreateObject,
  applyCreateObjectWithProps,
  applyCreateReflectionProbe,
  applyDeleteObject,
  applyDeleteSelectedObject,
  applyDuplicateObject,
  applyDuplicateSelectedObject,
  applyEquipInventorySlot,
  applyGroupSelectedObjects,
  applyPasteClipboard,
  applyRebakeReflectionProbe,
  applyRemoveParticles,
  applyRemoveReflectionProbe,
  applyRenameObject,
  applySetAttachment,
  applySetInventory,
  applySetObjectLight,
  applySetObjectMaterial,
  applySetObjectMaterialSlot,
  applySetObjectModel,
  applySetObjectParent,
  applySetObjectParticleSystem,
  applySetObjectRagdoll,
  applySetReflectionProbe,
  applySpawnStressTest,
  applyUngroupObject,
  applyUpdateParticles,
  applyUpdateRenderer,
  applyUpdateTransform,
} from './editor/objectActions';
import {
  applyAddBlueprintVariable,
  applyAddDataAssetColumn,
  applyAddDataAssetRow,
  applyAddGraphNode,
  applyAddGraphNodeToBlueprint,
  applyAddMaterialNode,
  applyApplyBlueprintFeatherSource,
  applyAttachScript,
  applyAutoLayoutActiveGraph,
  applyAutoLayoutMaterialGraph,
  applyClearRuntimeLog,
  applyClearRuntimeSounds,
  applyConnectGraphNodes,
  applyConnectMaterialNodes,
  applyCreateBlueprint,
  applyCreateBlueprintNamed,
  applyCreateDataAsset,
  applyCreateFolder,
  applyCreateMaterial,
  applyCreateParticleSystem,
  applyCreateVariable,
  applyDeleteBlueprint,
  applyDeleteDataAsset,
  applyDeleteDataAssetColumn,
  applyDeleteDataAssetRow,
  applyDeleteFolder,
  applyDeleteGraphNode,
  applyDeleteGraphNodes,
  applyDeleteMaterial,
  applyDeleteMaterialNode,
  applyDeleteParticleSystem,
  applyDeleteVariable,
  applyDetachScript,
  applyEnsureMaterialGraph,
  applyFireCustomEvent,
  applyMoveToFolder,
  applyOnConnect,
  applyOnEdgesChange,
  applyOnMaterialConnect,
  applyOnMaterialEdgesChange,
  applyOnMaterialNodesChange,
  applyOnNodesChange,
  applyOnReconnect,
  applyOpenObjectScript,
  applyPasteGraphNodes,
  applyRemoveBlueprintVariable,
  applyRenameAsset,
  applyRenameBlueprint,
  applyRenameDataAsset,
  applyRenameFolder,
  applyRenameMaterial,
  applyRenameParticleSystem,
  applySelectGraphNode,
  applySetActiveBlueprint,
  applySetActiveMaterial,
  applySetActiveParticleSystem,
  applySetDataAssetCell,
  applySetPlayPaused,
  applySetReplayTime,
  applySetRuntimeKey,
  applyStartReplay,
  applyStepPlayFrame,
  applyStopReplay,
  applySyncBlueprintFeatherSource,
  applyTickRuntime,
  applyToggleGraphBreakpoint,
  applyUpdateBlueprintFeatherExternalLink,
  applyUpdateBlueprintFeatherSource,
  applyUpdateBlueprintVariable,
  applyUpdateDataAssetColumn,
  applyUpdateDataAssetRow,
  applyUpdateGraphNodeData,
  applyUpdateMaterial,
  applyUpdateParticleSystem,
  applyUpdateVariable,
} from './editor/graphActions';
import {
  applyActiveBlueprint,
  applyActiveGraph,
  applyActiveScene,
  applyCreateScene,
  applyDeleteScene,
  applyDuplicateScene,
  applyRenameScene,
  applySelectObject,
  applySelectObjects,
  applySelectedGraphNode,
  applySelectedObject,
  applySetActiveExportProfile,
  applySetActiveScene,
  applySetCameraRigTarget,
  applySetSceneAudio,
  applyToggleSelectObject,
  applyUpdateExportProfile,
  applyUpdateSceneEnvironment,
} from './editor/sceneActions';
import {
  applyApplyInstanceToPrefab,
  applyClosePrefabEditor,
  applyCreatePrefabFromObject,
  applyDeletePrefab,
  applyInstantiatePrefab,
  applyOpenPrefabEditor,
  applyRenamePrefab,
  applyRequestPrefabThumbnail,
  applyRevertInstanceToPrefab,
  applySetPrefabThumbnail,
} from './editor/prefabActions';
import { mergePrefabInstances, prefabWouldCycle } from './editor/prefabMerge';
import {
  aiFeelerExclude,
  blueprintVarTypeCache,
  clearNodeErrors,
  detachedParts,
  fillObjectIdMap,
  nodeErrorsSnapshot,
  recordNodeError,
  pendingPartKicks,
  pendingPartRestores,
  impactAudioCooldown,
  clearImpactAudioCooldown,
  prevTransformEntryPool,
  reportedScriptErrors,
  resetReportedScriptErrors,
  tickMappedById,
  tickPrevTransforms,
  tickRemainingById,
  tickResolvedById,
  tickVehicleById,
} from './editor/tickState';
import {
  SURFACE_DUST,
  checkpointIndexForName,
  crashDebrisObject,
  headingFromEuler,
  keepArray,
  keepRecord,
  literalValueForType,
  nextWaterImpactId,
  rotateLocalVector,
  tagTokens,
  waterSurfaceHeight,
} from './editor/runtimeHelpers';
import { recordRuntimeSection } from '../runtime/perfStats';
import { advanceTimelineTime, sampleTimelineCurve } from '../runtime/timelineCurve';

export {
  defaultCharacter,
  defaultLight,
  defaultReflectionProbe,
  defaultRagdollSettings,
  defaultRenderSettings,
  defaultVehicle,
  resolveCharacter,
  resolveVehicle,
  type CreateObjectOptions,
  type RuntimeAnimator,
} from './editor/defaults';

export interface EditorState {
  scenes: Scene[];
  activeSceneId: string;
  /** The "active" object — last clicked; drives the Inspector, gizmo pivot, and all existing single-select consumers. */
  selectedObjectId: string;
  /** Full multi-selection set. Empty means "use selectedObjectId alone" (see effectiveSelection). */
  selectedObjectIds: string[];
  /** Undo/redo stack depths, mirrored from the history module (src/store/history.ts) so the toolbar can
   *  reflect canUndo/canRedo reactively. The snapshots themselves live outside the store. */
  undoDepth: number;
  redoDepth: number;
  /** In-memory copy/paste buffer: one entry per copied top-level object, holding its subtree. */
  objectClipboard: Array<{ rootId: string; objects: SceneObject[] }> | null;
  /** Editor-only active terrain brush. Durable sculpt/paint results live on each TerrainComponent. */
  terrainBrush: TerrainBrushSettings;
  /** Object whose follow-camera offset is being positioned with the on-screen gizmo (editor UI only). */
  cameraRigTarget?: string;
  isDirty: boolean;
  assets: AssetItem[];
  folders: ProjectFolder[];
  /** Project-wide render / post-processing (bloom, vignette). */
  renderSettings: RenderSettings;
  variables: ProjectVariable[];
  dataAssets: DataAsset[];
  materials: MaterialDefinition[];
  particleSystems: ParticleSystemDefinition[];
  skeletons: SkeletonAsset[];
  skeletalMeshes: SkeletalMeshAsset[];
  animations: AnimationAsset[];
  animatorControllers: AnimatorController[];
  blueprints: ScriptBlueprint[];
  graphs: ProjectGraph[];
  uiDocuments: UIDocument[];
  /** Reusable object templates (prefabs). */
  prefabs: Prefab[];
  /** Reusable parametric tree assets, edited in the Tree Builder. */
  treeSpecs: TreeSpec[];
  /** Project-owned production profiles; credentials remain outside the project file. */
  exportSettings: ExportSettings;
  activeTreeSpecId: string;
  /** Reusable prototype-model assets (Model Forge). Objects reference one by model.specId. */
  modelSpecs: ModelSpec[];
  activeModelSpecId: string;
  /** Id of the prefab currently open in the prefab editor, or null when editing a normal scene. */
  editingPrefabId: string | null;
  /** While editing a prefab, the scene to return to when the editor closes. */
  prefabReturnSceneId: string | null;
  activeBlueprintId: string;
  activeAnimatorControllerId: string;
  activeMaterialId: string;
  activeParticleSystemId: string;
  activeUIDocumentId: string;
  activeCinematicId: string;
  /** Editor-only: selected UI element id (shared between the UI panel and viewport overlay). */
  selectedUIElementId: string;
  isPlaying: boolean;
  /** Editor pause during Play — zeros sim delta (scripts still see input/UI, like runtimeTimeScale 0). */
  isPlayPaused: boolean;
  /** While paused, allow this many sim frames through (frame-step). Consumed in tickRuntime. */
  playStepFrames: number;
  playSnapshot?: {
    sceneId: string;
    /** Deep clone of the scene's objects at play start — restored wholesale on Stop (re-adds destroyed
     *  objects, drops runtime-spawned ones, resets transforms/renderers/instance variables). */
    objects: SceneObject[];
  };
  /** Pristine deep clones of every scene VISITED during a Play session (keyed by scene id), captured the
   *  moment each scene is entered. Lets a Load Scene node revert the scene it leaves and re-seed the scene
   *  it enters from clean authored state; all are restored on Stop. */
  runtimeSceneSnapshots?: Record<string, SceneObject[]>;
  runtimeVelocities: Record<string, Vector3Tuple>;
  /** Post-step angular velocity (rad/s) per dynamic body — drives the Get Angular Velocity node. */
  runtimeAngularVelocities: Record<string, Vector3Tuple>;
  runtimeKeys: Record<string, boolean>;
  runtimePreviousKeys: Record<string, boolean>;
  /** Per-key press counters. Unlike runtimeKeys, this preserves a physical keydown until the next tick consumes it. */
  runtimeKeyPresses: Record<string, number>;
  runtimePreviousKeyPresses: Record<string, number>;
  runtimeEventQueue: string[];
  /** Last payload carried by each custom event (lowercased name) — Fire Event's Payload pin writes it,
   *  the matching Custom Event's value-out reads it. Optional: older saves/projects simply have none. */
  runtimeEventPayloads?: Record<string, GraphValue>;
  runtimeVariableValues: Record<string, GraphValue>;
  /** Per-object animator state machine runtime: active state + live parameter values. Play-only. */
  runtimeAnimators: Record<string, RuntimeAnimator>;
  /** Per-object follow-camera overrides written by the Set Camera node. Play-only. */
  runtimeCameraOverrides: Record<string, { distance: number; height: number }>;
  /** Camera-shake trauma (0..1). Bumped by the Camera Shake node, the player firing/being hurt, and
   *  explosions; decayed every tick. The follow camera turns it into a positional + rotational jitter. */
  runtimeCameraShake: number;
  /** Floating-origin rebase event: bumped each time the world shifts; consumers subtract (dx, dz) from cached world positions. */
  runtimeRebase?: { seq: number; dx: number; dz: number };
  /** Character-controller object ids standing on the ground last frame (drives jump + grounded). */
  runtimeGrounded: string[];
  /** Character ids currently inside a water volume (swim mode) / on a climb volume (climb mode). Maintained
   *  via trigger enter/exit against objects whose `volume` instance variable is 'water' / 'climb'. */
  runtimeSwimming: string[];
  runtimeClimbing: string[];
  /** Object ids (any dynamic body or character) overlapping a water volume last frame — used to fire a
   *  one-shot splash + surface ripple the frame something first breaks the surface. */
  runtimeInWater: string[];
  /** Recent surface-impact points for the water shader's expanding ripple rings (newest last, capped). */
  runtimeWaterImpacts: { id: number; x: number; z: number }[];
  /** Per-body cooldown (last runtimeTime a wake ripple was shed) so surface-skimming wakes stay throttled. */
  runtimeWaterWake: Record<string, number>;
  /** Remaining roll/dodge time (seconds) per object — drives the forward dash + "rolling" param. */
  runtimeRoll: Record<string, number>;
  /** Active lock-on target per character (character id → locked target object id). */
  runtimeLockOn: Record<string, string>;
  /** Buffered jump press per character (seconds remaining) — fires on touchdown (jump buffering). */
  runtimeJumpBuffer: Record<string, number>;
  /** Landing-recovery time remaining per character (seconds) — saps speed + dips the camera after a hard landing. */
  runtimeLanding: Record<string, number>;
  /** Active sprint-slide per character: time remaining, world direction, and current (decaying) speed. */
  runtimeSlide: Record<string, { remaining: number; dirX: number; dirZ: number; speed: number }>;
  /** World-space dodge direction ([x, z]) of the active roll per character — feeds the "rollX" animator source. */
  runtimeRollDir: Record<string, [number, number]>;
  /** Active mantle/vault arcs per character. The controller owns the arc until time reaches duration. */
  runtimeMantle: Record<string, { from: Vector3Tuple; to: Vector3Tuple; time: number; duration: number }>;
  /** Idle turn-in-place intensity per character (0..1), auto-fed into animator params. */
  runtimeTurnInPlace: Record<string, number>;
  /** Remaining coyote-time (seconds) per object — a jump still registers this long after leaving the ground. */
  runtimeCoyote: Record<string, number>;
  /** Remaining attack time (seconds) per object — drives the "attacking" param. */
  runtimeAttack: Record<string, number>;
  /** Current melee combo index (0-based) per character while a chain is live. */
  runtimeMeleeCombo: Record<string, number>;
  /** Buffered attack press waiting to fire the next combo hit (per character). */
  runtimeMeleeBuffer: Record<string, boolean>;
  /** Wall-clock seconds of melee hitstop remaining (global). */
  runtimeHitstop: number;
  /** Live day-cycle clock in [0,1) while Playing — mirrors environment.dayCycleTime when Play starts. */
  runtimeDayCycleTime: number;
  /** Remaining reload time (seconds) per object — drives the "reloading" param. */
  runtimeReload: Record<string, number>;
  /** Remaining interact time (seconds) per object — drives the "interacting" param. */
  runtimeInteract: Record<string, number>;
  /** Distance walked since the last footstep sound, per object — drives footstep audio cadence. */
  runtimeFootstep: Record<string, number>;
  /** Per (object:node) remaining seconds for Cooldown gate nodes — drives AI fire rate / spawn rate. */
  runtimeCooldowns: Record<string, number>;
  /** Per (object:node) remaining seconds for latent Delay nodes — when one hits 0 the node's output fires. */
  runtimeDelays: Record<string, number>;
  /** Per (owner:logical Timeline id) Timeline sessions. Completed/stopped entries are retained so a later
   *  Control node can resume or reverse from the held time without recapturing the authored endpoints. */
  runtimeTweens: Record<
    string,
    {
      ownerId: string;
      nodeId: string;
      timelineId: string;
      targetId: string;
      property: 'position' | 'rotation' | 'scale';
      from: Vector3Tuple;
      to: Vector3Tuple;
      time: number;
      duration: number;
      easing: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';
      curve?: TimelineCurveKey[];
      space: 'local' | 'world';
      loop: boolean;
      pingPong: boolean;
      direction: 1 | -1;
      playing: boolean;
    }
  >;
  /** Targeted custom events queued for delivery NEXT tick: objectId → event names to fire on that actor
   *  (Fire Event with a Target, one-frame-delayed like collisions). */
  runtimeActorEvents: Record<string, string[]>;
  /** Per (object:node) seconds until the next fire of a Timer event node (decremented each tick). */
  runtimeTimers: Record<string, number>;
  /** Object ids hidden at runtime by action.setVisible (e.g. holstered weapons). */
  runtimeHidden: string[];
  /** Object ids deactivated at runtime by action.setActive (no render/script/physics/AI). */
  runtimeDisabled: string[];
  /** Cable owner ids cut at runtime by action.cutCable (constraint severed, end detached). */
  runtimeCutCables: string[];
  /** Runtime cable-length overrides set by action.setCableLength (winch/reel), by cable owner id. */
  runtimeCableLength: Record<string, number>;
  /** GTA-style vehicle possession: vehicleObjectId → the player pawn id currently driving it (set by the
   *  Enter Vehicle node, cleared by Exit Vehicle). Lets the HUD follow the occupant pawn while driving. */
  runtimeVehicleOccupants: Record<string, string>;
  /** The interactable object the local (camera-follow) player is currently focused on — highlighted +
   *  prompted on screen; pressing the interact key fires its event.interact. Null when nothing is in range. */
  runtimeInteractFocusId: string | null;
  /** Monotonic counter bumped each time a player-owned projectile lands a hit — drives the HUD hit marker. */
  runtimeHitMarker: number;
  /** Monotonic counter bumped each time PLAYER damage kills a target — drives the red kill-confirm marker. */
  runtimeKillMarker: number;
  /** Monotonic counter bumped each time the local player takes damage — drives the HUD hurt flash. */
  runtimeHurt: number;
  /** Full-screen flash opacity (0..1), decays each frame. Bumped by nearby explosions + the Screen Flash node. */
  runtimeFlash: number;
  /** Tint (hex) of the current screen flash — white bloom by default, hot orange for blasts. */
  runtimeFlashColor: string;
  /** Per-enemy attack cooldown (seconds remaining) so contact damage applies on a cadence, not every frame. */
  runtimeEnemyCooldown: Record<string, number>;
  /** Per-character footstep-sound override from the surface volume they're standing in (a trigger tagged with
   *  a `footstepSound` instance variable). Empty → use the character's own footstepSoundId. */
  runtimeSurfaceSound: Record<string, string>;
  /** Per-character movement-mode override set by the "Set Movement Mode" node (walking/swimming/climbing/
   *  flying). Persists until changed; takes precedence over the volume-tag swim/climb detection. */
  runtimeMovementMode: Record<string, string>;
  /** One-shot montage requests from outside the tick (e.g. clicking an inventory slot) — consumed next tick
   *  to start a Play-Animation montage on the keyed object. Keyed by target object id. */
  runtimeMontageRequests: Record<string, { animationId: string; speed: number }>;
  /** Solid-contact pairs that started in the previous physics step; drives event.collisionEnter. */
  runtimeCollisions: PhysicsContactEvent[];
  /** Trigger-overlap pairs that started in the previous physics step; drives event.triggerEnter. */
  runtimeTriggers: PhysicsContactEvent[];
  /** Trigger-overlap pairs that ENDED in the previous physics step; drives event.triggerExit. */
  runtimeTriggersExit: PhysicsContactEvent[];
  /** Solid-contact pairs that ENDED in the previous physics step; drives event.collisionExit. */
  runtimeCollisionsExit: PhysicsContactEvent[];
  /** Solid-contact pairs still touching as of the previous physics step; drives event.collisionStay.
   *  Only ever populated for objects whose graph has a Stay root (see GraphRuntime.hasStayRoot). */
  runtimeCollisionsStay: PhysicsContactEvent[];
  /** Trigger-overlap pairs still overlapping as of the previous physics step; drives event.triggerStay. */
  runtimeTriggersStay: PhysicsContactEvent[];
  /** HP lost per object during the previous tick (any source: Apply Damage node, projectile, melee, contact,
   *  explosion); drives event.receiveDamage (one-frame delayed, like collisions) + its Damage value-out. */
  runtimeDamageEvents: Record<string, number>;
  /** Character landings last tick: objectId → impact speed (u/s). Drives event.land. */
  runtimeLandEvents: Record<string, number>;
  /** Screen-edge damage chevrons for the local player (Halo-style); angles are degrees relative to camera yaw. */
  runtimeDamageIndicators: Array<{ angle: number; at: number }>;
  /** Effective gravity scale overrides from gravity-zone triggers (`gravityMultiplier` instance var). */
  runtimeGravityZones: Record<string, number>;
  /** Gameplay Screen Fade overlay (independent of Film Mode); lerped in real time. */
  runtimeScreenFade?: RuntimeScreenFade;
  /** Sounds queued this frame (asset id + optional world position for spatial playback); drained + cleared by
   *  the audio runtime. */
  runtimeSoundQueue: RuntimeSoundEvent[];
  /** Live audio state for the driven (camera-follow) vehicle, set each tick by the vehicle pass. Drives the
   *  looping engine (playbackRate ∝ rpm) + skid (volume ∝ slip) beds in useRuntimeAudio. Null when no car drives. */
  runtimeVehicleSound: { engineId?: string; skidId?: string; rpm: number; slip: number; pop?: number } | null;
  /** Messages emitted by action.print during Play; shown by the on-screen console overlay. */
  runtimeLog: string[];
  /** Blueprint node id → the error it threw this Play session, so the node editor can badge the exact
   *  failing node. Identity-stable across frames (see nodeErrorsSnapshot); reset on Play start. */
  runtimeNodeErrors: Record<string, string>;
  /** Node a breakpoint paused Play on, so the editor can highlight where it stopped. */
  /** Nodes flagged to pause Play. Mirrored into execTrace for the runtime hot lookup. */
  breakpointNodeIds: string[];
  toggleGraphBreakpoint: (nodeId: string) => void;
  runtimeBreakNodeId: string | null;
  /** Screen UI documents currently shown during Play (keyed by doc id). Seeded from `visibleOnStart`. */
  runtimeVisibleUI: Record<string, boolean>;
  /** Per-object instance variables during Play (e.g. each enemy's health), read by world-UI `self.*` bindings. */
  runtimeObjectVariables: Record<string, Record<string, GraphValue>>;
  /** Runtime text overrides written by ui.setText, keyed by `${docId}:${elementId}`. Play-only. */
  runtimeUITextOverrides: Record<string, string>;
  /** Runtime element visibility overrides written by ui.setVisible, keyed by `${docId}:${elementId}`. Play-only. */
  runtimeUIVisibleOverrides: Record<string, boolean>;
  runtimeCinematic?: RuntimeCinematicState;
  runtimeCinematicCamera?: RuntimeCinematicCamera;
  runtimeCinematicFade?: RuntimeCinematicFade;
  /** The active cinematic's film look (letterbox/grade/grain) while playing; drives CinematicOverlay. */
  runtimeCinematicLook?: CinematicLook;
  /** Text overlays (titles/subtitles/credits) on screen this frame while playing; drives CinematicOverlay. */
  runtimeCinematicText?: RuntimeCinematicText[];
  editorCinematicPreview?: { sequenceId: string; time: number };
  editorCinematicPreviewCamera?: RuntimeCinematicCamera;
  editorCinematicPreviewFade?: RuntimeCinematicFade;
  /** The previewed cinematic's film look while scrubbing in the editor (mirrors runtimeCinematicLook). */
  editorCinematicPreviewLook?: CinematicLook;
  /** Text overlays shown while scrubbing the editor preview (mirrors runtimeCinematicText). */
  editorCinematicPreviewText?: RuntimeCinematicText[];
  editorCinematicPreviewTransforms: Record<string, TransformComponent>;
  editorCinematicPreviewHidden: string[];
  editorCinematicPreviewMaterials: Record<string, MaterialOverrides>;
  /** Editor-only: Film Mode "Record" mode — moving the camera or dragging objects auto-keys them. */
  cinematicRecording: boolean;
  /** Film Mode viewport behavior: edit keeps the free camera + trails; camera pilots the evaluated shot. */
  cinematicViewportMode: 'edit' | 'camera';
  /** Which motion trails Film Mode draws in the viewport. */
  cinematicPathMode: 'all' | 'selected' | 'off';
  /** Editor-only option: the next cinematic Play run possesses the camera and captures a new take. */
  playtimeCameraRecording: boolean;
  /** Active live-camera capture. Samples stay transient until Play ends, then become a non-destructive take. */
  playtimeCameraSession?: PlaytimeCameraRecordingSession;
  /** Editor-only: the keyframe selected for 3D path editing (its handle gets a transform gizmo). */
  selectedCinematicKeyframe?: { actionId: string; index: number };
  runtimeStarted: boolean;
  runtimeTime: number;
  /** Global game speed (Set Time Scale node): 1 = normal, 0 = paused, <1 = slow-mo. Scales the tick delta
   *  (scripts, timers, physics); input + UI keep running so a paused game can still unpause itself. */
  runtimeTimeScale: number;
  /** Active instant-replay playback, or null. `t` is the current playback time within `duration`
   *  (both seconds). The recorded frames live module-side in replayRecorder.ts; this field only
   *  coordinates the tick + HUD scrubber. Runtime-only — never persisted. */
  replayPlayback: { t: number; duration: number } | null;
  assetSearch: string;
  selectedGraphNodeId?: string;
  activeScene: () => Scene | undefined;
  selectedObject: () => SceneObject | undefined;
  createScene: (name?: string) => string;
  renameScene: (id: string, name: string) => void;
  setSceneAudio: (id: string, patch: { ambientSoundId?: string; musicSoundId?: string }) => void;
  updateSceneEnvironment: (id: string, patch: Partial<SceneEnvironmentSettings>) => void;
  deleteScene: (id: string) => void;
  setActiveScene: (id: string) => void;
  duplicateScene: (id: string) => void;
  updateExportProfile: (profile: ExportProfile) => void;
  setActiveExportProfile: (id: string) => void;
  activeBlueprint: () => ScriptBlueprint | undefined;
  activeGraph: () => ProjectGraph | undefined;
  selectedGraphNode: () => NodeForgeNode | undefined;
  selectObject: (id: string) => void;
  /** Add/remove an object from the multi-selection (Ctrl/Shift-click); the toggled id becomes active. */
  toggleSelectObject: (id: string) => void;
  /** Replace the whole selection with `ids` (box-select); the last id becomes active. */
  selectObjects: (ids: string[]) => void;
  setCameraRigTarget: (id?: string) => void;
  createObject: (kind: SceneObjectKind) => void;
  createObjectWithProps: (kind: SceneObjectKind, options?: CreateObjectOptions) => string;
  /** Make an existing object a beginner-facing game role using normal physics, variables, and blueprint data. */
  makeObjectRole: (objectId: string, roleId: string) => CreatorRoleActionResult;
  /** Create a normal scene object and compose a Creator role onto it. */
  createRoleObject: (roleId: string, options?: CreateRoleObjectOptions) => CreatorRoleActionResult;
  /** Compile a beginner interaction into an object-specific, normal editable Blueprint. */
  addSimpleInteraction: (objectId: string, interaction: SimpleInteractionDraft) => SimpleInteractionActionResult;
  /** Add a playable multi-object starter by composing normal Creator/store actions. */
  createCreatorGameplayKit: (kitId: string) => CreatorGameplayKitResult;
  /** Dev/perf utility: batch-spawn N falling dynamic cubes (one set()) to stress the runtime + renderer. */
  spawnStressTest: (count: number) => void;
  deleteObject: (id: string) => void;
  deleteSelectedObject: () => void;
  duplicateSelectedObject: () => void;
  /** Copy the current selection (each top-level object + its subtree) to the in-memory clipboard. */
  copySelectedObjects: () => void;
  /** Paste the clipboard into the active scene (cloned with fresh ids, offset, kept under their parents). Returns the new root ids. */
  pasteClipboard: () => string[];
  /** Parent every top-level selected object under a new empty "Group" (created at the origin). */
  groupSelectedObjects: () => void;
  /** Dissolve an empty group: reparent its children to the group's parent, then remove the empty. */
  ungroupObject: (id: string) => void;
  /** Clone an object (and its descendants) `count` times, each offset from the previous copy. Returns the new root ids. */
  duplicateObject: (id: string, options?: { count?: number; offset?: Vector3Tuple }) => string[];
  /** Build an editable grid from one safe static model; Play/export batches the result into real GPU instances. */
  createInstancedGrid: (sourceId: string, options?: InstancedGridOptions) => string[];
  renameObject: (id: string, name: string) => void;
  /** Re-parent `id` under `parentId` (or detach to scene root when undefined). Cycle-safe. */
  setObjectParent: (id: string, parentId?: string) => void;
  // --- Prefabs (reusable objects) ---
  /** Capture an object subtree and turn the authored hierarchy into its first linked instance. */
  createPrefabFromObject: (objectId: string, name?: string, folderId?: string) => string | undefined;
  /** Place a fresh, live-linked prefab instance in the active scene. Returns its new root object id. */
  instantiatePrefab: (prefabId: string, options?: { position?: Vector3Tuple; parentId?: string }) => string | undefined;
  /** Open a prefab in the editor: swaps the active scene to a transient edit scene built from it. */
  openPrefabEditor: (prefabId: string) => void;
  /** Close the prefab editor, optionally saving edits back into the prefab, and restore the prior scene. */
  closePrefabEditor: (save?: boolean) => void;
  renamePrefab: (id: string, name: string) => void;
  deletePrefab: (id: string) => void;
  /** Push a prefab-instance's current edits into its source and propagate them to other linked instances.
   * `objectId` must be an instance root (carries prefabSourceId). Returns the updated prefab id. */
  applyInstanceToPrefab: (objectId: string) => string | undefined;
  /** Discard a prefab-instance's local edits and replace its subtree with a fresh copy of the prefab,
   * keeping its world position/parent. `objectId` must be an instance root. Returns the new root id. */
  revertInstanceToPrefab: (objectId: string) => string | undefined;
  /** Prefab ids awaiting an offscreen-rendered thumbnail (drained by the PrefabThumbnailHost). */
  prefabThumbnailQueue: string[];
  /** Queue a prefab for (re)rendering its browser thumbnail. */
  requestPrefabThumbnail: (prefabId: string) => void;
  /** Store a freshly rendered thumbnail (PNG data URL) and drop the prefab from the render queue. */
  setPrefabThumbnail: (prefabId: string, dataUrl: string) => void;
  updateTransform: (id: string, field: keyof TransformComponent, value: Vector3Tuple) => void;
  updateRenderer: (id: string, patch: Partial<MeshRendererComponent>) => void;
  setObjectModel: (id: string, modelAssetId?: string) => void;
  updateTerrain: (id: string, patch: Partial<TerrainComponent>) => void;
  /** Add a tree asset to the project library (copied from an archetype). Returns its id. */
  createTreeSpec: (archetype: TreeArchetype, name?: string) => string;
  /** Patch a library tree asset. Every object and scattered instance referencing it updates. */
  updateTreeSpec: (specId: string, patch: Partial<TreeSpec>) => void;
  /** Duplicate a library tree asset. */
  duplicateTreeSpec: (specId: string) => string;
  /** Remove a library tree asset, detaching any object that referenced it (they keep their inline copy). */
  deleteTreeSpec: (specId: string) => void;
  setActiveTreeSpec: (specId: string) => void;
  /** Create a parametric tree object from an archetype. Returns the new object's id. */
  createTree: (archetype: TreeArchetype, options?: { position?: Vector3Tuple; seed?: number; name?: string }) => string;
  /** Patch a tree object's component (spec, seed, choppable). The spec is re-normalized on every edit. */
  updateTree: (id: string, patch: Partial<TreeComponent>) => void;
  /** Add a stylized preset (src/tree/stylizedPresets.ts) to the library. Returns its id; null = unknown preset. */
  createTreeSpecFromPreset: (presetId: string, name?: string) => string | null;
  /** Create a tree object linked to a SPECIFIC library asset (createTree only links by archetype). */
  createTreeFromSpec: (specId: string, options?: { position?: Vector3Tuple; seed?: number; name?: string }) => string | null;
  /** Plant a grove: one group empty + `count` linked trees on a jittered sunflower disc. Same seed = same grove. */
  plantGrove: (options?: PlantGroveOptions) => { groupId: string; treeIds: string[] } | null;
  /** Land one axe hit on a tree. Severs it (spawning the felled log) once that break point runs out of hits. */
  chopTreeAt: (objectId: string, worldPoint: Vector3Tuple, direction?: Vector3Tuple) => string;
  /** Add a prototype model asset to the library from a starter kit (src/model/modelSpec.ts). Returns its id; null = unknown starter. */
  createModelSpec: (starterId?: string, name?: string) => string | null;
  /** Patch a library model asset (normalized). Every placed instance referencing it updates live. */
  updateModelSpec: (specId: string, patch: Partial<ModelSpec>) => void;
  /** Duplicate a library model asset (parts get fresh ids). */
  duplicateModelSpec: (specId: string) => string;
  /** Remove a library model asset. Placed instances (in every scene) keep an inline copy of the spec. */
  deleteModelSpec: (specId: string) => void;
  setActiveModelSpec: (specId: string) => void;
  /** Add one primitive part to a model asset. Returns the part id; null = unknown spec. */
  addModelPart: (specId: string, shape: ModelPartShape, init?: Partial<Omit<ModelPart, 'id' | 'shape'>>) => string | null;
  /** Patch one part (name, shape, transform, colorSlot, faceColors). */
  updateModelPart: (specId: string, partId: string, patch: Partial<Omit<ModelPart, 'id'>>) => boolean;
  removeModelPart: (specId: string, partId: string) => boolean;
  /** Copy one part in place. Returns the new part id; null = unknown spec/part. */
  duplicateModelPart: (specId: string, partId: string) => string | null;
  /** Paint a part from the palette: the whole part when faceGroup is omitted (clearing face overrides), else one face group. */
  paintModelPart: (specId: string, partId: string, colorSlot: number, faceGroup?: number) => boolean;
  /** Replace a box part's vertex-edit corner offsets (unit space, keys 0-7). null clears the deformation. */
  setModelPartCorners: (specId: string, partId: string, corners: Record<number, Vector3Tuple> | null) => boolean;
  /** Bake a part's exact rendered geometry into a Mesh part (shape 'mesh'): pierced/extruded right now is editable where the cage isn't. */
  convertModelPartToMesh: (specId: string, partId: string) => boolean;
  /** Move specific mesh vertices to new positions in unit space (keys the vertex index). */
  setModelPartMeshVertices: (specId: string, partId: string, updates: Array<[number, Vector3Tuple]>) => boolean;
  /** Extrude triangle faces of a Mesh part along their normals. Returns false if the part isn't a mesh. */
  extrudeModelPartFaces: (specId: string, partId: string, faceIndices: number[], delta?: number) => boolean;
  /** Midpoint-subdivide triangle faces of a Mesh part. Returns false if the part isn't a mesh. */
  subdivideModelPartFaces: (specId: string, partId: string, faceIndices: number[]) => boolean;
  /** CSG boolean of two parts; the result lands in the first part (converted to a mesh). Returns the new part; null on failure. */
  booleanModelParts: (specId: string, partId: string, otherPartId: string, operation: 'union' | 'difference' | 'intersect') => boolean;
  /** Replace a model asset's flat-color palette (1-16 hex colors). */
  setModelPalette: (specId: string, palette: string[]) => boolean;
  /** Place a prototype model object linked to a library asset (terrain-snapped). Returns the object id; null = unknown spec. */
  createModelFromSpec: (specId: string, options?: { position?: Vector3Tuple; name?: string }) => string | null;
  /** Attach (or replace) a prototype-model spec on an existing object so it can be kit-bashed in the viewport. */
  attachModelSpec: (objectId: string, specId: string) => boolean;
  /** Apply a one-click grass look (switches the terrain to stylized clump grass). Returns the preset label. */
  applyGrassPreset: (id: string, presetId: GrassPresetId) => string | null;
  setTerrainBrush: (patch: Partial<TerrainBrushSettings>) => void;
  applyTerrainBrush: (objectId: string, worldPosition: Vector3Tuple) => void;
  sculptTerrainAt: (
    objectId: string,
    worldPosition: Vector3Tuple,
    options: { operation?: TerrainSculptOperation; radius?: number; strength?: number; flattenHeight?: number },
  ) => void;
  paintTerrainAt: (objectId: string, worldPosition: Vector3Tuple, options: { layerId: string; radius?: number }) => void;
  /** Hand-paint the foliage density mask within the brush (Unreal-style). erase clears instead of adding. */
  paintFoliageAt: (objectId: string, worldPosition: Vector3Tuple, options: { radius?: number; density?: number; erase?: boolean }) => void;
  updateTerrainMaterialLayer: (objectId: string, layerId: string, patch: Partial<TerrainMaterialLayer>) => void;
  addTerrainMaterialLayer: (objectId: string) => string | undefined;
  removeTerrainMaterialLayer: (objectId: string, layerId: string) => void;
  clearTerrainEdits: (objectId: string, edits?: 'height' | 'paint' | 'all') => void;
  updatePhysics: (id: string, patch: Partial<PhysicsComponent>) => void;
  updateWater: (id: string, patch: Partial<WaterVolumeComponent>) => void;
  toggleWater: (id: string) => void;
  /** Add a physics joint to `id` (defaults to a hinge). No-op if it already has one. */
  addJoint: (id: string, type?: JointType) => void;
  updateJoint: (id: string, patch: Partial<JointComponent>) => void;
  removeJoint: (id: string) => void;
  /** Add a cloth sheet to `id`. No-op if it already has one. */
  addCloth: (id: string) => void;
  updateCloth: (id: string, patch: Partial<ClothComponent>) => void;
  removeCloth: (id: string) => void;
  /** Add a cable/rope to `id`. No-op if it already has one. */
  addCable: (id: string) => void;
  updateCable: (id: string, patch: Partial<CableComponent>) => void;
  removeCable: (id: string) => void;
  togglePhysics: (id: string) => void;
  /** Make an object destructible / patch its fracture config (seeds defaults on first use). */
  setObjectFracture: (id: string, patch: Partial<FractureComponent>) => void;
  /** Enable/disable the animator on an object (seeds a default component when first enabled). */
  toggleAnimator: (id: string) => void;
  /** Patch an object's animator component (clip, speed, loop). No-op if it has no animator. */
  updateAnimator: (id: string, patch: Partial<AnimatorComponent>) => void;
  /** Live-set a running animator parameter value (for the in-Play parameters panel / testing). */
  setRuntimeAnimatorParam: (objectId: string, paramId: string, value: number | boolean) => void;
  /** Toggle a physics ragdoll on an object during Play (bones go limp). */
  setObjectRagdoll: (objectId: string, on: boolean) => void;
  /**
   * Split an imported model into reusable Skeleton + Skeletal Mesh + Animation assets. Skeletons are
   * deduped by signature (so rigs sharing a skeleton reuse one), and clips are deduped by
   * (skeleton, clip name) so re-importing the same animation pack doesn't pile up duplicates.
   * Returns the skeletal-mesh asset id, or undefined for a non-skinned model.
   */
  registerImportedModel: (input: {
    assetId: string;
    assetName: string;
    folderId?: string;
    inspection: ModelInspection;
  }) => { skeletalMeshId?: string; materialsAdded: number; animationsAdded: number };
  // --- Animator Controller (state machine) authoring. All AI-friendly: explicit params, return ids. ---
  createAnimatorController: (name?: string, skeletonId?: string, folderId?: string) => string;
  updateAnimatorController: (id: string, patch: Partial<Pick<AnimatorController, 'name' | 'defaultStateId' | 'skeletonId'>>) => void;
  deleteAnimatorController: (id: string) => void;
  setActiveAnimatorController: (id: string) => void;
  /** Assign (or clear) the controller driving an object's animator. Seeds the animator component. */
  setObjectAnimatorController: (objectId: string, controllerId?: string) => void;
  addAnimatorParameter: (controllerId: string, param: { name: string; type: AnimatorParameter['type']; source?: AnimatorParameter['source']; variableId?: string; defaultValue?: number | boolean }) => string | undefined;
  updateAnimatorParameter: (controllerId: string, paramId: string, patch: Partial<Omit<AnimatorParameter, 'id'>>) => void;
  removeAnimatorParameter: (controllerId: string, paramId: string) => void;
  addAnimatorState: (controllerId: string, state?: { name?: string; animationId?: string; speed?: number; loop?: boolean; position?: { x: number; y: number } }) => string | undefined;
  updateAnimatorState: (controllerId: string, stateId: string, patch: Partial<Omit<AnimatorState, 'id'>>) => void;
  removeAnimatorState: (controllerId: string, stateId: string) => void;
  addAnimatorTransition: (controllerId: string, transition: { from: string; to: string; conditions?: AnimatorCondition[]; duration?: number; hasExitTime?: boolean; exitTime?: number }) => string | undefined;
  updateAnimatorTransition: (controllerId: string, transitionId: string, patch: Partial<Omit<AnimatorTransition, 'id'>>) => void;
  removeAnimatorTransition: (controllerId: string, transitionId: string) => void;
  // --- Built-in character controller ---
  /** Enable/disable the character controller on an object (seeds defaults when first enabled). */
  toggleCharacterController: (id: string) => void;
  /** Patch an object's character controller. No-op if it has none. */
  updateCharacterController: (id: string, patch: Partial<CharacterControllerComponent>) => void;
  /** Enable/disable the built-in arcade vehicle (car) controller on an object (seeds defaults when first enabled). */
  setVehicleEnabled: (id: string, enabled?: boolean) => void;
  /** Patch an object's vehicle controller (seeds defaults if it has none). */
  updateVehicle: (id: string, patch: Partial<VehicleComponent>) => void;
  /** Define/replace an object's weapon inventory (pass undefined to remove it). */
  setInventory: (objectId: string, inventory: InventoryComponent | undefined) => void;
  /** Equip the inventory slot at `index`: swaps the attached weapon, plays the equip montage + switch sound,
   *  and sets the RangedMode animator param. Driven by the on-screen inventory bar (and AI). */
  equipInventorySlot: (objectId: string, index: number) => void;
  /** Update project-wide render/post-processing settings (bloom, vignette). */
  updateRenderSettings: (patch: Partial<RenderSettings>) => void;
  /**
   * Apply a named art-direction "Render Look" (RENDER_PRESETS): stamps the preset's tonemapping + ambient
   * fill onto the given scene's environment and its bloom shape + color grade (and the selected id) onto the
   * project render settings — one coherent visual identity in a single call. Sky/sun/fog are left untouched.
   */
  applyRenderPreset: (sceneId: string, preset: RenderPresetId) => void;
  /** Configure a `kind: 'light'` object's light (type/color/intensity/distance/angle). Creates the component if absent. */
  setObjectLight: (objectId: string, patch: Partial<LightComponent>) => void;
  /** Add/patch a local reflection probe on an object (captures a cubemap for nearby reflective surfaces). Creates it if absent. */
  setReflectionProbe: (objectId: string, patch: Partial<ReflectionProbeComponent>) => void;
  /** Create and select a dedicated Reflection Probe entity. */
  createReflectionProbe: (position?: Vector3Tuple) => string;
  /** Force a static reflection probe to re-capture its cubemap (bumps bakeNonce). */
  rebakeReflectionProbe: (objectId: string) => void;
  /** Remove an object's reflection probe. */
  removeReflectionProbe: (objectId: string) => void;
  /** Add an authored particle emitter to an object (optionally seeded from a preset). Creates the component if absent. */
  addParticles: (objectId: string, preset?: ParticlePresetId) => void;
  /** Patch an object's particle emitter (no-op if it has none). */
  updateParticles: (objectId: string, patch: Partial<ParticleSystemComponent>) => void;
  /** Remove an object's particle emitter. */
  removeParticles: (objectId: string) => void;
  /** Attach an object to a character's bone socket (or pass undefined target to detach). */
  setAttachment: (objectId: string, attachment?: AttachmentComponent) => void;
  /** Add a named socket (bone + offset) to a Skeleton asset. Returns the socket id. */
  addSkeletonSocket: (skeletonId: string, socket: { name?: string; boneName: string }) => string | undefined;
  updateSkeletonSocket: (skeletonId: string, socketId: string, patch: Partial<Omit<SkeletonSocket, 'id'>>) => void;
  removeSkeletonSocket: (skeletonId: string, socketId: string) => void;
  /** Tune a skeleton's global ragdoll defaults (shared by everything using that skeleton). */
  updateSkeletonRagdoll: (skeletonId: string, patch: Partial<RagdollSettings>) => void;
  /** Upsert a per-bone ragdoll body override (Unreal PhAT-style). */
  setRagdollBody: (skeletonId: string, boneName: string, patch: Partial<Omit<RagdollBodyDef, 'boneName'>>) => void;
  /** Remove a per-bone ragdoll body override (the bone reverts to the global defaults). */
  removeRagdollBody: (skeletonId: string, boneName: string) => void;
  /** Auto-generate a default capsule body for every non-excluded bone (Unreal "auto-generate bodies"). */
  generateRagdollBodies: (skeletonId: string) => void;
  /**
   * One-click third-person pawn: from a rigged model asset, create an object that renders it, build a
   * locomotion Animator Controller (Idle/Walk/Jog/Jump from the skeleton's clips, matched by name) and
   * attach a character controller. Returns the new object's id, or undefined if the model isn't rigged.
   */
  createCharacterPawn: (modelAssetId: string, name?: string) => string | undefined;
  /** Augment a character's animator with a gameplay kit (extra states/params/transitions). Returns a summary. */
  addGameplayKit: (objectId: string, kit: 'ranged' | 'health' | 'interactions' | 'emotes') => string | undefined;
  /** Create a self-contained collectible pickup wired to increment a project variable and update a HUD counter. */
  createCollectibleCounter: (options?: {
    name?: string;
    variableName?: string;
    label?: string;
    amount?: number;
    position?: Vector3Tuple;
    playerObjectId?: string;
    color?: string;
  }) => { objectId: string; blueprintId: string; variableId: string; uiDocumentId: string; counterElementId: string };
  createCinematic: (name?: string, duration?: number) => string;
  updateCinematic: (id: string, patch: Partial<Omit<CinematicSequence, 'id' | 'actions' | 'createdAt'>>) => void;
  duplicateCinematicTake: (id: string) => string | undefined;
  addCinematicMarker: (cinematicId: string, marker: { time: number; label?: string; color?: string; determinismFence?: boolean }) => string | undefined;
  updateCinematicMarker: (cinematicId: string, markerId: string, patch: Partial<Omit<CinematicMarker, 'id'>>) => void;
  removeCinematicMarker: (cinematicId: string, markerId: string) => void;
  /** Set/merge the cinematic's film look (letterbox aspect, color grade, grain, vignette). */
  setCinematicLook: (id: string, patch: Partial<CinematicLook>) => void;
  /**
   * Add one static camera shot (a single framing) to a cinematic at `time`. This is the "shot list"
   * authoring primitive: each call is a cut to a new framing. `blend` 0 = hard cut, >0 = dolly from the
   * previous shot. Optional `focusDistance`+`aperture` give the shot depth-of-field. Returns the beat id.
   */
  addCinematicShot: (
    cinematicId: string,
    shot: {
      time: number;
      position: Vector3Tuple;
      lookAt: Vector3Tuple;
      fov?: number;
      blend?: number;
      focusDistance?: number;
      aperture?: number;
      duration?: number;
      label?: string;
    },
  ) => string | undefined;
  deleteCinematic: (id: string) => void;
  setActiveCinematic: (id: string) => void;
  /** One-click transition at `time`. cut/crossfade set the incoming camera shot's blend; fade/flash/wipe
   *  drop a dip-fade overlay beat (returns the affected/created action id). */
  addCinematicTransition: (
    cinematicId: string,
    opts: {
      time?: number;
      duration?: number;
      style: 'cut' | 'crossfade' | 'fade' | 'flash' | 'wipe';
      color?: string;
      direction?: 'left' | 'right' | 'up' | 'down';
    },
  ) => string | undefined;
  addCinematicAction: (cinematicId: string, action: Omit<CinematicAction, 'id'>) => string | undefined;
  updateCinematicAction: (cinematicId: string, actionId: string, patch: Partial<Omit<CinematicAction, 'id'>>) => void;
  removeCinematicAction: (cinematicId: string, actionId: string) => void;
  /** Capture/replace a camera keyframe at `time` on the cinematic's camera track (creates one). */
  addCinematicCameraKeyframe: (cinematicId: string, time: number, pose: RuntimeCinematicCamera, targetActionId?: string) => string | undefined;
  /** Capture/replace an object transform keyframe at `time` (uses `transform` or the object's live pose). */
  addCinematicTransformKeyframe: (cinematicId: string, objectId: string, time: number, transform?: TransformComponent, targetActionId?: string) => string | undefined;
  setCinematicRecording: (recording: boolean) => void;
  setCinematicViewportMode: (mode: 'edit' | 'camera') => void;
  setCinematicPathMode: (mode: 'all' | 'selected' | 'off') => void;
  /** Arm/disarm live camera possession for the next cinematic Play. */
  setPlaytimeCameraRecording: (recording: boolean) => void;
  /** Append one sampled camera pose to the active live take. */
  recordPlaytimeCameraSample: (sample: CinematicCameraKeyframe) => void;
  /** Stop Play if needed and commit the captured path as a new, non-destructive cinematic take. */
  finishPlaytimeCameraRecording: () => void;
  /** Select (or clear, with null) a keyframe for 3D path editing; poses the scene at its time. */
  selectCinematicKeyframe: (actionId: string | null, index?: number) => void;
  /** Move the selected keyframe's world position (camera or object) — used by the 3D path gizmo. */
  moveCinematicKeyframe: (actionId: string, index: number, position: Vector3Tuple) => void;
  /** Aim a camera keyframe at a world point (its look-at) — used by the 3D path gizmo's aim handle. */
  aimCinematicKeyframe: (actionId: string, index: number, lookAt: Vector3Tuple) => void;
  previewCinematic: (cinematicId: string, time: number) => void;
  clearCinematicPreview: () => void;
  playCinematic: (cinematicId: string) => void;
  stopCinematic: () => void;
  attachScript: (id: string, nextBlueprintId?: string) => void;
  /** One-click behavior: compile the preset's FeatherScript into a (shared) blueprint, apply the
   *  collider it needs, ensure its project variables, and attach it. Returns the blueprintId. */
  attachBehaviorPreset: (objectId: string, presetId: string) => string | undefined;
  /** Patch the ACTIVE scene's activation-streaming settings (open-world distance deactivation). */
  updateSceneStreaming: (patch: Partial<SceneStreamingSettings>) => void;
  detachScript: (id: string) => void;
  setActiveBlueprint: (id: string) => void;
  createBlueprint: () => void;
  createBlueprintNamed: (
    name?: string,
    description?: string,
    folderId?: string,
  ) => { blueprintId: string; graphId: string };
  openObjectScript: (objectId: string) => string | undefined;
  /** Declare a typed PER-INSTANCE variable on a blueprint; every object running it gets its own copy
   *  (seeded into object.variables by name). Returns the new variable id. */
  addBlueprintVariable: (
    blueprintId: string,
    opts?: { name?: string; type?: GraphValueType; defaultValue?: GraphValue },
  ) => string | undefined;
  updateBlueprintVariable: (
    blueprintId: string,
    variableId: string,
    patch: { name?: string; type?: GraphValueType; defaultValue?: GraphValue },
  ) => void;
  removeBlueprintVariable: (blueprintId: string, variableId: string) => void;
  createFolder: (name?: string, parentId?: string) => string;
  renameFolder: (id: string, name: string) => void;
  deleteFolder: (id: string) => void;
  moveToFolder: (kind: 'asset' | 'blueprint' | 'dataAsset' | 'material' | 'particleSystem' | 'uiDocument' | 'prefab', id: string, folderId?: string) => void;
  renameBlueprint: (id: string, name: string) => void;
  updateBlueprintFeatherSource: (id: string, source?: string) => void;
  updateBlueprintFeatherExternalLink: (
    id: string,
    link?: { path: string; lastSyncedHash?: string; lastSyncedVisualHash?: string },
  ) => void;
  syncBlueprintFeatherSource: (id: string, source: string) => FeatherCompileResult;
  applyBlueprintFeatherSource: (id: string, source: string) => FeatherCompileResult;
  deleteBlueprint: (id: string) => void;
  renameAsset: (id: string, name: string) => void;
  createVariable: (name?: string, type?: GraphValueType, persistent?: boolean) => string;
  updateVariable: (id: string, patch: Partial<Pick<ProjectVariable, 'name' | 'type' | 'defaultValue' | 'persistent'>>) => void;
  deleteVariable: (id: string) => void;
  createDataAsset: (name?: string, folderId?: string) => string;
  renameDataAsset: (id: string, name: string) => void;
  deleteDataAsset: (id: string) => void;
  addDataAssetColumn: (tableId: string, name?: string, type?: GraphValueType) => string;
  updateDataAssetColumn: (
    tableId: string,
    columnId: string,
    patch: Partial<Pick<DataAssetColumn, 'name' | 'type'>>,
  ) => void;
  deleteDataAssetColumn: (tableId: string, columnId: string) => void;
  addDataAssetRow: (tableId: string, key?: string) => string;
  updateDataAssetRow: (tableId: string, rowId: string, patch: Partial<Pick<DataAssetRow, 'key'>>) => void;
  deleteDataAssetRow: (tableId: string, rowId: string) => void;
  setDataAssetCell: (tableId: string, rowId: string, columnId: string, value: GraphValue) => void;
  createMaterial: (name?: string, description?: string, folderId?: string) => string;
  renameMaterial: (id: string, name: string) => void;
  updateMaterial: (id: string, patch: Partial<MaterialDefinition>) => void;
  deleteMaterial: (id: string) => void;
  setActiveMaterial: (id: string) => void;
  setObjectMaterial: (objectId: string, materialId?: string) => void;
  /** Bind a single material slot of an imported model (by slot index) to a material, or clear it (undefined). */
  setObjectMaterialSlot: (objectId: string, slotIndex: number, materialId?: string) => void;
  // --- Reusable particle-system assets (Unreal-style). Edit once, every referencing emitter updates. ---
  createParticleSystem: (name?: string, preset?: ParticlePresetId, folderId?: string) => string;
  renameParticleSystem: (id: string, name: string) => void;
  updateParticleSystem: (id: string, patch: Partial<ParticleConfig>) => void;
  deleteParticleSystem: (id: string) => void;
  setActiveParticleSystem: (id: string) => void;
  /** Assign a particle-system asset to an object (seeds/points its emitter component at the asset). Pass undefined to detach. */
  setObjectParticleSystem: (objectId: string, systemId?: string) => void;
  // --- Game UI documents (HUD + world-space widgets). AI-friendly: explicit params, return ids. ---
  createUIDocument: (name?: string, surface?: UISurface, folderId?: string) => string;
  /** Create a complete ready-made HUD/menu from a template, auto-provisioning the variables it binds to. Returns the new document id. */
  createUIFromTemplate: (template: UITemplateKind, folderId?: string) => string;
  /** Restyle a whole UI document with a visual theme (sci-fi/minimal/arcade) — colours/borders/glow only, layout preserved. */
  applyUITheme: (docId: string, theme: UIThemeKind) => void;
  renameUIDocument: (id: string, name: string) => void;
  updateUIDocument: (id: string, patch: Partial<Pick<UIDocument, 'name' | 'surface' | 'css' | 'visibleOnStart' | 'logicBlueprintId' | 'renderMode'>>) => void;
  deleteUIDocument: (id: string) => void;
  setActiveUIDocument: (id: string) => void;
  /** Editor-only: which UI element is selected (shared by the panel tree and the viewport overlay). */
  selectUIElement: (id: string) => void;
  /** Ensure a UI document has a runnable behaviour blueprint (+ "UI Logic" controller object). Returns its id. */
  openUILogic: (docId: string) => string;
  /** Add a child element under `parentId` (or the doc root when omitted). Returns the new element id. */
  addUIElement: (docId: string, parentId: string | undefined, kind: UIElementKind) => string;
  updateUIElement: (docId: string, elementId: string, patch: Partial<Omit<UIElement, 'id' | 'children'>>) => void;
  removeUIElement: (docId: string, elementId: string) => void;
  /**
   * Set a document's raw stylesheet (DOM renderer). `mode: 'append'` adds to what's there, which is
   * how you extend an installed UI kit without re-sending its whole sheet. Empty css clears it.
   */
  setUIDocumentCss: (docId: string, css: string, mode?: 'replace' | 'append') => void;
  /** Set one element's own CSS snippet, scoped to it on injection. Empty css clears it. */
  setUIElementCss: (docId: string, elementId: string, css: string, mode?: 'replace' | 'append') => void;

  // --- Reusable UI components (UMG-style user widgets). A component IS a UI document; a
  //     `component` element instances it BY REFERENCE, so editing it updates every instance. ---
  /** Create an empty reusable component document. Returns its id. */
  createUIComponent: (name?: string, folderId?: string) => string;
  /**
   * Turn an existing subtree into a reusable component: the subtree moves into a new component
   * document and is replaced in place by an instance of it. The single most useful action here —
   * it is how a hand-built or imported tree stops being hardcoded. Returns the component's id.
   */
  extractUIComponent: (docId: string, elementId: string, name?: string) => string | null;
  /** Insert an instance of `componentId` under `parentId` (or root). Returns the element id, or null on a cycle. */
  insertUIComponent: (docId: string, parentId: string | undefined, componentId: string) => string | null;
  /** Set one instance's parameter (read inside the component as `param.<key>`). Empty value clears it. */
  setUIComponentParam: (docId: string, elementId: string, key: string, value: string) => void;
  /** Upsert a data binding (by target) on an element. Pass an empty expression to remove it. */
  setUIBinding: (docId: string, elementId: string, target: UIBinding['target'], expression: string) => void;
  /** Insert a prebuilt widget (pre-styled, pre-bound) under parentId (or root). Returns its element id. */
  addUIPreset: (docId: string, parentId: string | undefined, preset: UIPresetKind, options?: { variableName?: string }) => string;
  /** Reorder an element among its siblings. */
  moveUIElement: (docId: string, elementId: string, dir: 'up' | 'down') => void;
  /** Deep-clone an element next to itself (fresh ids). Returns the new element id. */
  duplicateUIElement: (docId: string, elementId: string) => string;
  /** Attach (or replace) a world-space UI document on an object. Seeds offset/scale/billboard defaults. */
  attachUI: (objectId: string, documentId: string) => void;
  detachUI: (objectId: string) => void;
  updateUIComponent: (objectId: string, patch: Partial<UIComponent>) => void;
  /** Author a per-instance object variable (read by world UI via `self.<key>`). */
  setObjectVariable: (objectId: string, key: string, value: GraphValue) => void;
  /** Runtime: show/hide a screen UI document (driven by ui.show/ui.hide nodes). */
  showUI: (docId: string) => void;
  hideUI: (docId: string) => void;
  /** Runtime: override an element's text (driven by ui.setText nodes). */
  setUIText: (docId: string, elementId: string, text: string) => void;
  /** Runtime: override an element's visibility (driven by ui.setVisible nodes). */
  setUIElementVisible: (docId: string, elementId: string, visible: boolean) => void;
  /**
   * Runtime: write a project variable BY NAME from an interactive UI control (input/toggle/slider/
   * dropdown two-way binding). No-op outside Play; coerces to the variable's declared type.
   */
  setRuntimeVariableByName: (name: string, value: GraphValue) => void;
  ensureMaterialGraph: (materialId: string) => void;
  addMaterialNode: (
    label: string,
    category: GraphNodeCategory,
    data?: Partial<NodeForgeNodeData>,
    position?: { x: number; y: number },
  ) => string;
  connectMaterialNodes: (sourceId: string, targetId: string, sourceHandle?: string, targetHandle?: string) => void;
  deleteMaterialNode: (nodeId: string) => void;
  onMaterialNodesChange: OnNodesChange<NodeForgeNode>;
  onMaterialEdgesChange: OnEdgesChange;
  onMaterialConnect: OnConnect;
  autoLayoutMaterialGraph: () => void;
  addGraphNodeToBlueprint: (
    blueprintId: string,
    label: string,
    category: GraphNodeCategory,
    data?: Partial<NodeForgeNodeData>,
    position?: { x: number; y: number },
  ) => string;
  connectGraphNodes: (
    blueprintId: string,
    sourceId: string,
    targetId: string,
    sourceHandle?: string,
    targetHandle?: string,
  ) => void;
  deleteGraphNode: (nodeId: string) => void;
  /** Delete several graph nodes (and every wire touching them) from the active blueprint in one step. */
  deleteGraphNodes: (nodeIds: string[]) => void;
  /** Paste a copied set of nodes (+ the wires between them) into a blueprint's graph with fresh ids,
   *  offset from the originals. The pasted set becomes the selection. Returns the new node ids. */
  pasteGraphNodes: (
    blueprintId: string,
    nodes: NodeForgeNode[],
    edges: Edge[],
    offset?: { x: number; y: number },
  ) => string[];
  autoLayoutActiveGraph: () => void;
  selectGraphNode: (id?: string) => void;
  updateGraphNodeData: (id: string, patch: Partial<NodeForgeNodeData>) => void;
  fireCustomEvent: (eventName: string) => void;
  addAssets: (files: FileList | File[]) => void;
  addAssetItems: (items: AssetItem[]) => void;
  setAssetSearch: (value: string) => void;
  removeAsset: (id: string) => void;
  setPlaying: (value: boolean) => void;
  /** Pause/resume the Play simulation without stopping (does not dirty). No-op when not playing. */
  setPlayPaused: (value: boolean) => void;
  /** Advance one simulation frame while paused (enters pause if needed). No-op when not playing. */
  stepPlayFrame: () => void;
  setRuntimeKey: (code: string, pressed: boolean) => void;
  clearRuntimeSounds: () => void;
  clearRuntimeLog: () => void;
  tickRuntime: (delta: number) => void;
  /** Trigger an instant replay of the last `seconds` (default 8, capped at the 8s buffer) of Play.
   *  Returns false if not playing, a replay is already active, or not enough motion is buffered yet. */
  startReplay: (seconds?: number) => boolean;
  /** Scrub the active replay to time `t` (seconds); no-op if no replay is active. */
  setReplayTime: (t: number) => void;
  /** End the active replay and resume live rendering. */
  stopReplay: () => void;
  onNodesChange: OnNodesChange<NodeForgeNode>;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  onReconnect: OnReconnect<Edge>;
  addGraphNode: (label: string, category: GraphNodeCategory) => void;
  exportProject: () => NodeForgeProject;
  loadProject: (project: NodeForgeProject) => void;
  markClean: () => void;
  /** Collect a prefab + its full dependency closure into a transferable package payload. */
  buildPrefabPackage: (prefabId: string) => { content: PackageContent; assetIds: string[] } | null;
  /** Collect everything in a folder (and its subfolders) + dependencies, like Unreal's Migrate. */
  buildFolderPackage: (folderId: string) => { content: PackageContent; assetIds: string[]; name: string } | null;
  /** Collect every scene + its dependency closure — the content of a `kind: 'project'` package. */
  buildProjectPackage: () => { content: PackageContent; assetIds: string[] };
  /** Additively merge already-remapped package content + resolved assets into the project. */
  mergePackage: (content: PackageContent, assets: AssetItem[]) => void;
  /**
   * Merge a `kind: 'project'` package and switch to its world: the package's scenes REPLACE the
   * current ones. Only valid on a freshly-created project — installing a template over work in
   * progress would discard it, so the caller is responsible for starting from a blank project.
   */
  mergeProjectPackage: (content: PackageContent, assets: AssetItem[]) => void;
}

/**
 * Visual graph edits make a previously hand-authored FeatherScript draft stale. Clearing the stored
 * draft makes the next Code view regenerate from the graph, so an old text snapshot can never compile
 * later and silently replace newer visual work.
 */
export const invalidateFeatherSourceForGraphs = (
  blueprints: ScriptBlueprint[],
  graphIds: ReadonlySet<string>,
): ScriptBlueprint[] =>
  blueprints.map((blueprint) => {
    if (!graphIds.has(blueprint.graphId) || blueprint.featherSource === undefined) return blueprint;
    // A draft newer than the last successful compile may contain errors. Preserve it rather than
    // silently replacing the user's text when an AI/tool/store mutation touches the visual graph.
    if (blueprint.featherSource !== blueprint.featherSourceLastSynced) return blueprint;
    return { ...blueprint, featherSource: undefined, featherSourceLastSynced: undefined };
  });

export const invalidateFeatherSourceForGraph = (blueprints: ScriptBlueprint[], graphId: string): ScriptBlueprint[] =>
  invalidateFeatherSourceForGraphs(blueprints, new Set([graphId]));

/** One Call Function activation: the evaluated A/B/C arguments + the value a Return node set. */
interface FunctionFrame {
  args: [GraphValue | undefined, GraphValue | undefined, GraphValue | undefined];
  ret: GraphValue | undefined;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  scenes: starterScenes,
  activeSceneId: starterSceneId,
  selectedObjectId: 'obj-player',
  selectedObjectIds: [],
  undoDepth: 0,
  redoDepth: 0,
  objectClipboard: null,
  terrainBrush: defaultTerrainBrush(),
  isDirty: false,
  assets: [],
  folders: [],
  renderSettings: starterRenderSettings,
  variables: starterVariables,
  dataAssets: starterDataAssets,
  materials: [],
  particleSystems: [],
  skeletons: [],
  skeletalMeshes: [],
  animations: [],
  animatorControllers: [],
  blueprints: starterBlueprints,
  graphs: [{ id: graphId, name: 'Player Controller', nodes: starterNodes, edges: starterEdges }],
  uiDocuments: [],
  prefabs: [],
  treeSpecs: defaultTreeLibrary(),
  exportSettings: createDefaultExportSettings('Untitled Project', starterSceneId),
  activeTreeSpecId: DEFAULT_TREE_IDS.oak,
  modelSpecs: defaultModelLibrary(),
  activeModelSpecId: 'model-starter-crate',
  editingPrefabId: null,
  prefabReturnSceneId: null,
  prefabThumbnailQueue: [],
  activeBlueprintId: blueprintId,
  activeMaterialId: '',
  activeParticleSystemId: '',
  activeUIDocumentId: '',
  activeCinematicId: '',
  selectedUIElementId: '',
  activeAnimatorControllerId: '',
  isPlaying: false,
  isPlayPaused: false,
  playStepFrames: 0,
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
  runtimeRebase: undefined,
  runtimeFlash: 0,
  runtimeFlashColor: '#ffffff',
  runtimeGrounded: [],
  runtimeSwimming: [],
  runtimeInWater: [],
  runtimeWaterImpacts: [],
  runtimeWaterWake: {},
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
  runtimeTriggers: [],
  runtimeTriggersExit: [],
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
  breakpointNodeIds: [],
  runtimeVisibleUI: {},
  runtimeObjectVariables: {},
  runtimeUITextOverrides: {},
  runtimeUIVisibleOverrides: {},
  runtimeCinematic: undefined,
  runtimeCinematicCamera: undefined,
  runtimeCinematicFade: undefined,
  runtimeCinematicLook: undefined,
  runtimeCinematicText: undefined,
  editorCinematicPreview: undefined,
  editorCinematicPreviewCamera: undefined,
  editorCinematicPreviewFade: undefined,
  editorCinematicPreviewLook: undefined,
  editorCinematicPreviewText: undefined,
  editorCinematicPreviewTransforms: {},
  editorCinematicPreviewHidden: [],
  editorCinematicPreviewMaterials: {},
  cinematicRecording: false,
  cinematicViewportMode: 'edit',
  cinematicPathMode: 'all',
  playtimeCameraRecording: false,
  playtimeCameraSession: undefined,
  selectedCinematicKeyframe: undefined,
  runtimeStarted: false,
  runtimeTime: 0,
  runtimeTimeScale: 1,
  replayPlayback: null,
  assetSearch: '',
  activeScene: () => applyActiveScene(get),
  selectedObject: () => applySelectedObject(get),
  createScene: (name) => applyCreateScene(set, name),
  renameScene: (id, name) => applyRenameScene(set, id, name),
  setSceneAudio: (id, patch) => applySetSceneAudio(set, id, patch),
  updateSceneEnvironment: (id, patch) => applyUpdateSceneEnvironment(set, id, patch),
  deleteScene: (id) => applyDeleteScene(set, id),
  setActiveScene: (id) => applySetActiveScene(set, id),
  duplicateScene: (id) => applyDuplicateScene(set, id),
  updateExportProfile: (profile) => applyUpdateExportProfile(set, get, profile),
  setActiveExportProfile: (id) => applySetActiveExportProfile(set, get, id),
  activeBlueprint: () => applyActiveBlueprint(get),
  activeGraph: () => applyActiveGraph(get),
  selectedGraphNode: () => applySelectedGraphNode(get),
  selectObject: (id) => applySelectObject(set, id),
  toggleSelectObject: (id) => applyToggleSelectObject(set, id),
  selectObjects: (ids) => applySelectObjects(set, ids),
  setCameraRigTarget: (id) => applySetCameraRigTarget(set, id),
  createObject: (kind) => applyCreateObject(set, kind),
  createObjectWithProps: (kind, options = {}) => applyCreateObjectWithProps(set, kind, options),
  makeObjectRole: (objectId, roleId) => applyMakeObjectRole(set, get, objectId, roleId),
  createRoleObject: (roleId, options = {}) => applyCreateRoleObject(set, get, roleId, options),
  addSimpleInteraction: (objectId, interaction) => applyAddSimpleInteraction(set, get, objectId, interaction),
  createCreatorGameplayKit: (kitId) => applyCreateCreatorGameplayKit(get, kitId),
  spawnStressTest: (count) => applySpawnStressTest(set, count),
  deleteObject: (id) => applyDeleteObject(set, id),
  deleteSelectedObject: () => applyDeleteSelectedObject(set),
  duplicateSelectedObject: () => applyDuplicateSelectedObject(set),
  copySelectedObjects: () => applyCopySelectedObjects(set, get),
  pasteClipboard: () => applyPasteClipboard(set),
  groupSelectedObjects: () => applyGroupSelectedObjects(set),
  ungroupObject: (id) => applyUngroupObject(set, id),
  duplicateObject: (id, options = {}) => applyDuplicateObject(set, id, options),
  createInstancedGrid: (sourceId, options = {}) => applyCreateInstancedGrid(set, sourceId, options),
  setObjectParent: (id, parentId) => applySetObjectParent(set, id, parentId),
  createPrefabFromObject: (objectId, name, folderId) => applyCreatePrefabFromObject(set, get, objectId, name, folderId),
  requestPrefabThumbnail: (prefabId) => applyRequestPrefabThumbnail(set, prefabId),
  setPrefabThumbnail: (prefabId, dataUrl) => applySetPrefabThumbnail(set, prefabId, dataUrl),
  instantiatePrefab: (prefabId, options = {}) => applyInstantiatePrefab(set, get, prefabId, options),
  openPrefabEditor: (prefabId) => applyOpenPrefabEditor(set, prefabId),
  closePrefabEditor: (save = true) => applyClosePrefabEditor(set, save),
  renamePrefab: (id, name) => applyRenamePrefab(set, id, name),
  deletePrefab: (id) => applyDeletePrefab(set, id),
  applyInstanceToPrefab: (objectId) => applyApplyInstanceToPrefab(set, get, objectId),
  revertInstanceToPrefab: (objectId) => applyRevertInstanceToPrefab(set, get, objectId),
  renameObject: (id, name) => applyRenameObject(set, id, name),
  updateTransform: (id, field, value) => applyUpdateTransform(set, id, field, value),
  updateRenderer: (id, patch) => applyUpdateRenderer(set, id, patch),
  setObjectModel: (id, modelAssetId) => applySetObjectModel(set, id, modelAssetId),
  setObjectMaterialSlot: (objectId, slotIndex, materialId) => applySetObjectMaterialSlot(set, objectId, slotIndex, materialId),
  updateTerrain: (id, patch) => applyUpdateTerrain(set, id, patch),
  createTreeSpec: (archetype, name) => applyCreateTreeSpec(set, archetype, name),
  updateTreeSpec: (specId, patch) => applyUpdateTreeSpec(set, specId, patch),
  duplicateTreeSpec: (specId) => applyDuplicateTreeSpec(set, specId),
  deleteTreeSpec: (specId) => applyDeleteTreeSpec(set, specId),
  setActiveTreeSpec: (specId) => applySetActiveTreeSpec(set, specId),
  createTree: (archetype, options = {}) => applyCreateTree(set, get, archetype, options),
  updateTree: (id, patch) => applyUpdateTree(set, id, patch),
  createTreeSpecFromPreset: (presetId, name) => applyCreateTreeSpecFromPreset(set, presetId, name),
  createTreeFromSpec: (specId, options = {}) => applyCreateTreeFromSpec(set, get, specId, options),
  plantGrove: (options = {}) => applyPlantGrove(set, get, options),
  chopTreeAt: (objectId, worldPoint, direction) => applyChopTreeAt(set, get, objectId, worldPoint, direction),
  createModelSpec: (starterId = 'blank', name) => applyCreateModelSpec(set, starterId, name),
  updateModelSpec: (specId, patch) => applyUpdateModelSpec(set, specId, patch),
  duplicateModelSpec: (specId) => applyDuplicateModelSpec(set, specId),
  deleteModelSpec: (specId) => applyDeleteModelSpec(set, specId),
  setActiveModelSpec: (specId) => applySetActiveModelSpec(set, specId),
  addModelPart: (specId, shape, init = {}) => applyAddModelPart(set, get, specId, shape, init),
  updateModelPart: (specId, partId, patch) => applyUpdateModelPart(set, get, specId, partId, patch),
  removeModelPart: (specId, partId) => applyRemoveModelPart(set, get, specId, partId),
  duplicateModelPart: (specId, partId) => applyDuplicateModelPart(set, get, specId, partId),
  paintModelPart: (specId, partId, colorSlot, faceGroup) => applyPaintModelPart(set, get, specId, partId, colorSlot, faceGroup),
  setModelPartCorners: (specId, partId, corners) => applySetModelPartCorners(set, get, specId, partId, corners),
  convertModelPartToMesh: (specId, partId) => applyConvertModelPartToMesh(set, get, specId, partId),
  setModelPartMeshVertices: (specId, partId, updates) => applySetModelPartMeshVertices(set, get, specId, partId, updates),
  extrudeModelPartFaces: (specId, partId, faceIndices, delta) => applyExtrudeModelPartFaces(set, get, specId, partId, faceIndices, delta),
  subdivideModelPartFaces: (specId, partId, faceIndices) => applySubdivideModelPartFaces(set, get, specId, partId, faceIndices),
  booleanModelParts: (specId, partId, otherPartId, operation) => applyBooleanModelParts(set, get, specId, partId, otherPartId, operation),
  setModelPalette: (specId, palette) => applySetModelPalette(set, get, specId, palette),
  createModelFromSpec: (specId, options = {}) => applyCreateModelFromSpec(set, get, specId, options),
  attachModelSpec: (objectId, specId) => applyAttachModelSpec(set, get, objectId, specId),
  applyGrassPreset: (id, presetId) => applyApplyGrassPreset(set, get, id, presetId),
  setTerrainBrush: (patch) => applySetTerrainBrush(set, patch),
  applyTerrainBrush: (objectId, worldPosition) => applyApplyTerrainBrush(set, get, objectId, worldPosition),
  sculptTerrainAt: (objectId, worldPosition, options) => applySculptTerrainAt(set, get, objectId, worldPosition, options),
  paintTerrainAt: (objectId, worldPosition, options) => applyPaintTerrainAt(set, get, objectId, worldPosition, options),
  paintFoliageAt: (objectId, worldPosition, options) => applyPaintFoliageAt(set, get, objectId, worldPosition, options),
  updateTerrainMaterialLayer: (objectId, layerId, patch) => applyUpdateTerrainMaterialLayer(set, objectId, layerId, patch),
  addTerrainMaterialLayer: (objectId) => applyAddTerrainMaterialLayer(set, objectId),
  removeTerrainMaterialLayer: (objectId, layerId) => applyRemoveTerrainMaterialLayer(set, objectId, layerId),
  clearTerrainEdits: (objectId, edits = 'all') => applyClearTerrainEdits(set, objectId, edits),
  setObjectMaterial: (objectId, materialId) => applySetObjectMaterial(set, objectId, materialId),
  updatePhysics: (id, patch) => applyUpdatePhysics(set, id, patch),
  updateWater: (id, patch) => applyUpdateWater(set, id, patch),
  toggleWater: (id) => applyToggleWater(set, id),
  togglePhysics: (id) => applyTogglePhysics(set, id),
  addJoint: (id, type = 'hinge') => applyAddJoint(set, id, type),
  updateJoint: (id, patch) => applyUpdateJoint(set, id, patch),
  removeJoint: (id) => applyRemoveJoint(set, id),
  addCloth: (id) => applyAddCloth(set, id),
  updateCloth: (id, patch) => applyUpdateCloth(set, id, patch),
  removeCloth: (id) => applyRemoveCloth(set, id),
  addCable: (id) => applyAddCable(set, id),
  updateCable: (id, patch) => applyUpdateCable(set, id, patch),
  removeCable: (id) => applyRemoveCable(set, id),
  setObjectFracture: (id, patch) => applySetObjectFracture(set, id, patch),
  toggleAnimator: (id) => applyToggleAnimator(set, id),
  updateAnimator: (id, patch) => applyUpdateAnimator(set, id, patch),
  setRuntimeAnimatorParam: (objectId, paramId, value) => applySetRuntimeAnimatorParam(set, objectId, paramId, value),
  setObjectRagdoll: (objectId, on) => applySetObjectRagdoll(set, objectId, on),
  registerImportedModel: (input) => applyRegisterImportedModel(set, get, input),
  createAnimatorController: (name, skeletonId, folderId) => applyCreateAnimatorController(set, name, skeletonId, folderId),
  updateAnimatorController: (id, patch) => applyUpdateAnimatorController(set, id, patch),
  deleteAnimatorController: (id) => applyDeleteAnimatorController(set, id),
  setActiveAnimatorController: (id) => applySetActiveAnimatorController(set, id),
  setObjectAnimatorController: (objectId, controllerId) => applySetObjectAnimatorController(set, objectId, controllerId),
  addAnimatorParameter: (controllerId, param) => applyAddAnimatorParameter(set, get, controllerId, param),
  updateAnimatorParameter: (controllerId, paramId, patch) => applyUpdateAnimatorParameter(set, controllerId, paramId, patch),
  removeAnimatorParameter: (controllerId, paramId) => applyRemoveAnimatorParameter(set, controllerId, paramId),
  addAnimatorState: (controllerId, stateInput) => applyAddAnimatorState(set, get, controllerId, stateInput),
  updateAnimatorState: (controllerId, stateId, patch) => applyUpdateAnimatorState(set, controllerId, stateId, patch),
  removeAnimatorState: (controllerId, stateId) => applyRemoveAnimatorState(set, controllerId, stateId),
  addAnimatorTransition: (controllerId, transition) => applyAddAnimatorTransition(set, get, controllerId, transition),
  updateAnimatorTransition: (controllerId, transitionId, patch) => applyUpdateAnimatorTransition(set, controllerId, transitionId, patch),
  removeAnimatorTransition: (controllerId, transitionId) => applyRemoveAnimatorTransition(set, controllerId, transitionId),
  toggleCharacterController: (id) => applyToggleCharacterController(set, id),
  updateCharacterController: (id, patch) => applyUpdateCharacterController(set, id, patch),
  setVehicleEnabled: (id, enabled) => applySetVehicleEnabled(set, id, enabled),
  updateVehicle: (id, patch) => applyUpdateVehicle(set, id, patch),
  setInventory: (objectId, inventory) => applySetInventory(set, objectId, inventory),
  equipInventorySlot: (objectId, index) => applyEquipInventorySlot(set, get, objectId, index),
  updateRenderSettings: (patch) => applyUpdateRenderSettings(set, patch),
  applyRenderPreset: (sceneId, presetId) => {
    const preset = findRenderPreset(presetId);
    if (!preset) return;
    // Tonemapping + ambient fill are per-scene; bloom + grade are project-wide. Stamp both, and record the
    // selected id so the picker highlights it and the AI snapshot can report the active look.
    get().updateSceneEnvironment(sceneId, preset.environment);
    get().updateRenderSettings({ ...preset.renderSettings, colorGrade: preset.colorGrade, renderPreset: presetId });
  },
  setObjectLight: (objectId, patch) => applySetObjectLight(set, objectId, patch),
  setReflectionProbe: (objectId, patch) => applySetReflectionProbe(set, objectId, patch),
  createReflectionProbe: (position = [0, 2, 0]) => applyCreateReflectionProbe(set, position),
  rebakeReflectionProbe: (objectId) => applyRebakeReflectionProbe(set, objectId),
  removeReflectionProbe: (objectId) => applyRemoveReflectionProbe(set, objectId),
  addParticles: (objectId, preset) => applyAddParticles(set, objectId, preset),
  updateParticles: (objectId, patch) => applyUpdateParticles(set, objectId, patch),
  removeParticles: (objectId) => applyRemoveParticles(set, objectId),
  setAttachment: (objectId, attachment) => applySetAttachment(set, objectId, attachment),
  addSkeletonSocket: (skeletonId, socket) => applyAddSkeletonSocket(set, get, skeletonId, socket),
  updateSkeletonSocket: (skeletonId, socketId, patch) => applyUpdateSkeletonSocket(set, skeletonId, socketId, patch),
  removeSkeletonSocket: (skeletonId, socketId) => applyRemoveSkeletonSocket(set, skeletonId, socketId),
  updateSkeletonRagdoll: (skeletonId, patch) => applyUpdateSkeletonRagdoll(set, skeletonId, patch),
  setRagdollBody: (skeletonId, boneName, patch) => applySetRagdollBody(set, skeletonId, boneName, patch),
  removeRagdollBody: (skeletonId, boneName) => applyRemoveRagdollBody(set, skeletonId, boneName),
  generateRagdollBodies: (skeletonId) => applyGenerateRagdollBodies(set, skeletonId),
  createCharacterPawn: (modelAssetId, name) => applyCreateCharacterPawn(set, get, modelAssetId, name),
  addGameplayKit: (objectId, kit) => applyAddGameplayKit(set, objectId, kit),
  createCollectibleCounter: (options = {}) => applyCreateCollectibleCounter(set, get, options),
  createCinematic: (name = 'New Cinematic', duration = 8) => applyCreateCinematic(set, name, duration),
  updateCinematic: (id, patch) => applyUpdateCinematic(set, id, patch),
  duplicateCinematicTake: (id) => applyDuplicateCinematicTake(set, get, id),
  addCinematicMarker: (cinematicId, marker) => applyAddCinematicMarker(set, get, cinematicId, marker),
  updateCinematicMarker: (cinematicId, markerId, patch) => applyUpdateCinematicMarker(set, cinematicId, markerId, patch),
  removeCinematicMarker: (cinematicId, markerId) => applyRemoveCinematicMarker(set, cinematicId, markerId),
  setCinematicLook: (id, patch) => applySetCinematicLook(set, id, patch),
  deleteCinematic: (id) => applyDeleteCinematic(set, id),
  setActiveCinematic: (id) => applySetActiveCinematic(set, id),
  addCinematicAction: (cinematicId, action) => applyAddCinematicAction(set, get, cinematicId, action),
  updateCinematicAction: (cinematicId, actionId, patch) => applyUpdateCinematicAction(set, cinematicId, actionId, patch),
  removeCinematicAction: (cinematicId, actionId) => applyRemoveCinematicAction(set, cinematicId, actionId),
  addCinematicShot: (cinematicId, shot) => applyAddCinematicShot(set, get, cinematicId, shot),
  addCinematicTransition: (cinematicId, opts) => applyAddCinematicTransition(set, get, cinematicId, opts),
  addCinematicCameraKeyframe: (cinematicId, time, pose, targetActionId) => applyAddCinematicCameraKeyframe(set, get, cinematicId, time, pose, targetActionId),
  addCinematicTransformKeyframe: (cinematicId, objectId, time, transform, targetActionId) => applyAddCinematicTransformKeyframe(set, get, cinematicId, objectId, time, transform, targetActionId),
  setCinematicRecording: (recording) => applySetCinematicRecording(set, get, recording),
  setCinematicViewportMode: (mode) => applySetCinematicViewportMode(set, mode),
  setCinematicPathMode: (mode) => applySetCinematicPathMode(set, mode),
  setPlaytimeCameraRecording: (recording) => applySetPlaytimeCameraRecording(set, recording),
  recordPlaytimeCameraSample: (sample) => applyRecordPlaytimeCameraSample(set, sample),
  finishPlaytimeCameraRecording: () => applyFinishPlaytimeCameraRecording(set, get),
  selectCinematicKeyframe: (actionId, index) => applySelectCinematicKeyframe(set, get, actionId, index),
  moveCinematicKeyframe: (actionId, index, position) => applyMoveCinematicKeyframe(set, get, actionId, index, position),
  aimCinematicKeyframe: (actionId, index, lookAt) => applyAimCinematicKeyframe(set, get, actionId, index, lookAt),
  previewCinematic: (cinematicId, time) => applyPreviewCinematic(set, cinematicId, time),
  clearCinematicPreview: () => applyClearCinematicPreview(set),
  playCinematic: (cinematicId) => applyPlayCinematic(set, get, cinematicId),
  stopCinematic: () => applyStopCinematic(set),
  attachScript: (id, nextBlueprintId) => applyAttachScript(set, id, nextBlueprintId),
  updateSceneStreaming: (patch) => applyUpdateSceneStreaming(set, patch),
  attachBehaviorPreset: (objectId, presetId) => applyAttachBehaviorPreset(set, get, objectId, presetId),
  addBlueprintVariable: (blueprintId, opts = {}) => applyAddBlueprintVariable(set, get, blueprintId, opts),
  updateBlueprintVariable: (blueprintId, variableId, patch) => applyUpdateBlueprintVariable(set, blueprintId, variableId, patch),
  removeBlueprintVariable: (blueprintId, variableId) => applyRemoveBlueprintVariable(set, blueprintId, variableId),
  detachScript: (id) => applyDetachScript(set, id),
  setActiveBlueprint: (activeBlueprintId) => applySetActiveBlueprint(set, activeBlueprintId),
  createBlueprint: () => applyCreateBlueprint(set),
  createBlueprintNamed: (name, description, folderId) => applyCreateBlueprintNamed(set, name, description, folderId),
  openObjectScript: (objectId) => applyOpenObjectScript(set, get, objectId),
  createFolder: (name, parentId) => applyCreateFolder(set, name, parentId),
  renameFolder: (id, name) => applyRenameFolder(set, id, name),
  deleteFolder: (id) => applyDeleteFolder(set, id),
  moveToFolder: (kind, id, folderId) => applyMoveToFolder(set, kind, id, folderId),
  renameBlueprint: (id, name) => applyRenameBlueprint(set, id, name),
  updateBlueprintFeatherSource: (id, source) => applyUpdateBlueprintFeatherSource(set, id, source),
  updateBlueprintFeatherExternalLink: (id, link) => applyUpdateBlueprintFeatherExternalLink(set, id, link),
  syncBlueprintFeatherSource: (id, source) => applySyncBlueprintFeatherSource(set, get, id, source),
  applyBlueprintFeatherSource: (id, source) => applyApplyBlueprintFeatherSource(set, get, id, source),
  deleteBlueprint: (id) => applyDeleteBlueprint(set, id),
  renameAsset: (id, name) => applyRenameAsset(set, id, name),
  createVariable: (name, type = 'number', persistent = true) => applyCreateVariable(set, name, type, persistent),
  updateVariable: (id, patch) => applyUpdateVariable(set, id, patch),
  deleteVariable: (id) => applyDeleteVariable(set, id),
  createDataAsset: (name, folderId) => applyCreateDataAsset(set, name, folderId),
  renameDataAsset: (id, name) => applyRenameDataAsset(set, id, name),
  deleteDataAsset: (id) => applyDeleteDataAsset(set, id),
  addDataAssetColumn: (tableId, name, type = 'string') => applyAddDataAssetColumn(set, tableId, name, type),
  updateDataAssetColumn: (tableId, columnId, patch) => applyUpdateDataAssetColumn(set, tableId, columnId, patch),
  deleteDataAssetColumn: (tableId, columnId) => applyDeleteDataAssetColumn(set, tableId, columnId),
  addDataAssetRow: (tableId, key) => applyAddDataAssetRow(set, tableId, key),
  updateDataAssetRow: (tableId, rowId, patch) => applyUpdateDataAssetRow(set, tableId, rowId, patch),
  deleteDataAssetRow: (tableId, rowId) => applyDeleteDataAssetRow(set, tableId, rowId),
  setDataAssetCell: (tableId, rowId, columnId, value) => applySetDataAssetCell(set, tableId, rowId, columnId, value),
  createMaterial: (name, description, folderId) => applyCreateMaterial(set, name, description, folderId),
  renameMaterial: (id, name) => applyRenameMaterial(set, id, name),
  updateMaterial: (id, patch) => applyUpdateMaterial(set, id, patch),
  deleteMaterial: (id) => applyDeleteMaterial(set, id),
  setActiveMaterial: (id) => applySetActiveMaterial(set, id),
  // --- Reusable particle-system assets ---
  createParticleSystem: (name, preset, folderId) => applyCreateParticleSystem(set, name, preset, folderId),
  renameParticleSystem: (id, name) => applyRenameParticleSystem(set, id, name),
  updateParticleSystem: (id, patch) => applyUpdateParticleSystem(set, id, patch),
  deleteParticleSystem: (id) => applyDeleteParticleSystem(set, id),
  setActiveParticleSystem: (id) => applySetActiveParticleSystem(set, id),
  setObjectParticleSystem: (objectId, systemId) => applySetObjectParticleSystem(set, objectId, systemId),
  // --- Game UI documents ---
  createUIDocument: (name, surface, folderId) => applyCreateUIDocument(set, get, name, surface, folderId),
  createUIFromTemplate: (template, folderId) => applyCreateUIFromTemplate(set, get, template, folderId),
  applyUITheme: (docId, theme) => applyUITheme(set, docId, theme),
  renameUIDocument: (id, name) => applyRenameUIDocument(set, id, name),
  updateUIDocument: (id, patch) => applyUpdateUIDocument(set, id, patch),
  deleteUIDocument: (id) => applyDeleteUIDocument(set, id),
  setActiveUIDocument: (id) => applySetActiveUIDocument(set, id),
  selectUIElement: (id) => applySelectUIElement(set, id),
  openUILogic: (docId) => applyOpenUILogic(set, get, docId),
  addUIElement: (docId, parentId, kind) => applyAddUIElement(set, docId, parentId, kind),
  updateUIElement: (docId, elementId, patch) => applyUpdateUIElement(set, docId, elementId, patch),
  removeUIElement: (docId, elementId) => applyRemoveUIElement(set, docId, elementId),
  setUIDocumentCss: (docId, css, mode) => applySetUIDocumentCss(set, docId, css, mode),
  setUIElementCss: (docId, elementId, css, mode) => applySetUIElementCss(set, docId, elementId, css, mode),
  createUIComponent: (name, folderId) => applyCreateUIComponent(set, name, folderId),
  extractUIComponent: (docId, elementId, name) => applyExtractUIComponent(set, get, docId, elementId, name),
  insertUIComponent: (docId, parentId, componentId) => applyInsertUIComponent(set, get, docId, parentId, componentId),
  setUIComponentParam: (docId, elementId, key, value) => applySetUIComponentParam(set, docId, elementId, key, value),
  setUIBinding: (docId, elementId, target, expression) => applySetUIBinding(set, docId, elementId, target, expression),
  addUIPreset: (docId, parentId, preset, options) => applyAddUIPreset(set, get, docId, parentId, preset, options),
  moveUIElement: (docId, elementId, dir) => applyMoveUIElement(set, docId, elementId, dir),
  duplicateUIElement: (docId, elementId) => applyDuplicateUIElement(set, get, docId, elementId),
  attachUI: (objectId, documentId) => applyAttachUI(set, objectId, documentId),
  detachUI: (objectId) => applyDetachUI(set, objectId),
  updateUIComponent: (objectId, patch) => applyUpdateUIComponent(set, objectId, patch),
  setObjectVariable: (objectId, key, value) => applySetObjectVariable(set, objectId, key, value),
  showUI: (docId) => applyShowUI(set, docId),
  hideUI: (docId) => applyHideUI(set, docId),
  setUIText: (docId, elementId, text) => applySetUIText(set, docId, elementId, text),
  setUIElementVisible: (docId, elementId, visible) => applySetUIElementVisible(set, docId, elementId, visible),
  setRuntimeVariableByName: (name, value) => applySetRuntimeVariableByName(set, name, value),
  ensureMaterialGraph: (materialId) => applyEnsureMaterialGraph(set, get, materialId),
  addMaterialNode: (label, category, data, position) => applyAddMaterialNode(set, label, category, data, position),
  connectMaterialNodes: (sourceId, targetId, sourceHandle, targetHandle) =>
    applyConnectMaterialNodes(set, sourceId, targetId, sourceHandle, targetHandle),
  deleteMaterialNode: (nodeId) => applyDeleteMaterialNode(set, nodeId),
  onMaterialNodesChange: (changes) => applyOnMaterialNodesChange(set, changes),
  onMaterialEdgesChange: (changes) => applyOnMaterialEdgesChange(set, changes),
  onMaterialConnect: (connection) => applyOnMaterialConnect(set, connection),
  autoLayoutMaterialGraph: () => applyAutoLayoutMaterialGraph(set),
  addGraphNodeToBlueprint: (blueprintId, label, category, data, position) =>
    applyAddGraphNodeToBlueprint(set, blueprintId, label, category, data, position),
  connectGraphNodes: (blueprintId, sourceId, targetId, sourceHandle, targetHandle) =>
    applyConnectGraphNodes(set, blueprintId, sourceId, targetId, sourceHandle, targetHandle),
  deleteGraphNode: (nodeId) => applyDeleteGraphNode(set, nodeId),
  deleteGraphNodes: (nodeIds) => applyDeleteGraphNodes(set, nodeIds),
  pasteGraphNodes: (blueprintId, nodes, edges, offset = { x: 36, y: 36 }) =>
    applyPasteGraphNodes(set, blueprintId, nodes, edges, offset),
  autoLayoutActiveGraph: () => applyAutoLayoutActiveGraph(set),
  selectGraphNode: (selectedGraphNodeId) => applySelectGraphNode(set, get, selectedGraphNodeId),
  updateGraphNodeData: (id, patch) => applyUpdateGraphNodeData(set, id, patch),
  fireCustomEvent: (eventName) => applyFireCustomEvent(set, eventName),
  addAssets: (files) => applyAddAssets(set, files),
  addAssetItems: (items) => applyAddAssetItems(set, items),
  setAssetSearch: (assetSearch) => applySetAssetSearch(set, assetSearch),
  removeAsset: (id) => applyRemoveAsset(set, id),
  setPlaying: (isPlaying) => set((state) => applySetPlaying(state, isPlaying)),
  setPlayPaused: (value) => applySetPlayPaused(set, value),
  stepPlayFrame: () => applyStepPlayFrame(set),
  setRuntimeKey: (code, pressed) => applySetRuntimeKey(set, code, pressed),
  clearRuntimeSounds: () => applyClearRuntimeSounds(set),
  clearRuntimeLog: () => applyClearRuntimeLog(set),
  startReplay: (seconds) => applyStartReplay(set, get, seconds),
  setReplayTime: (t) => applySetReplayTime(set, t),
  stopReplay: () => applyStopReplay(set),
  tickRuntime: (delta) => applyTickRuntime(set, get, delta),
  toggleGraphBreakpoint: (nodeId) => applyToggleGraphBreakpoint(set, nodeId),
  onNodesChange: (changes) => applyOnNodesChange(set, changes),
  onEdgesChange: (changes) => applyOnEdgesChange(set, changes),
  onConnect: (connection) => applyOnConnect(set, connection),
  onReconnect: (oldEdge, connection) => applyOnReconnect(set, oldEdge, connection),
  addGraphNode: (label, category) => applyAddGraphNode(set, label, category),
  exportProject: () => applyExportProject(set, get),
  loadProject: (project) => set(() => applyLoadProject(project)),
  markClean: () => applyMarkClean(set),

  buildPrefabPackage: (prefabId) => applyBuildPrefabPackage(set, get, prefabId),

  buildFolderPackage: (folderId) => applyBuildFolderPackage(set, get, folderId),

  buildProjectPackage: () => applyBuildProjectPackage(set, get),

  mergeProjectPackage: (content, assets) => applyMergeProjectPackage(set, content, assets),

  mergePackage: (content, assets) => applyMergePackage(set, content, assets),
}));
