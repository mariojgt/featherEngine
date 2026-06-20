import type { Edge, OnConnect, OnEdgesChange, OnNodesChange } from '@xyflow/react';
import { addEdge, applyEdgeChanges, applyNodeChanges } from '@xyflow/react';
import { create } from 'zustand';
import {
  PROJECT_VERSION,
  PREFAB_EDIT_SCENE_ID,
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
  type ParticleSystemComponent,
  type ParticleConfig,
  type ParticleSystemDefinition,
  type RenderSettings,
  type QualityLevel,
  type SceneEnvironmentSettings,
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
  type RuntimeCinematicState,
  type RuntimeCinematicText,
  type TerrainComponent,
  type TerrainBrushSettings,
  type TerrainMaterialLayer,
  type TerrainSculptOperation,
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
  type WaterVolumeComponent,
} from '../types';
import { getActivePhysics, startPhysics, stopPhysics, type PhysicsContactEvent, type VehicleWheelState } from '../runtime/physicsWorld';
import { pushExplosion, clearExplosions } from '../runtime/explosionBus';
import { cameraPitch as mouseCameraPitch, cameraYaw as mouseCameraYaw } from '../runtime/mouseLook';
import { gamepadInput } from '../runtime/gamepadInput';
import { markExec } from '../runtime/execTrace';
import { recordValue } from '../runtime/valueTrace';
import { addSkidMark } from '../runtime/skidMarks';
import { isRagdoll, setRagdoll, getRagdollRoot } from '../runtime/ragdollState';
import { sendParticleCommand } from '../runtime/particleBus';
import { addVehicleDent, clearVehicleDents, clearVehicleDentsFor } from '../runtime/vehicleDamageBus';
import { publishTransforms, publishRenderTransforms, clearTransformBuffer, type BufferedTransform } from '../runtime/transformBuffer';
import { beginPerceptionFrame, clearPerception, cachedLineOfSight, storeLineOfSight } from '../runtime/aiPerception';
import { withParticleDefaults, defaultParticleConfig, particlePresets, particleAssetConfig, type ParticlePresetId } from '../runtime/particlePresets';
import { applyPhysicsMaterialPreset } from '../runtime/physicsMaterials';
import { resolveMaterial } from '../three/materialResolve';
import { WATER_LOOK_KEYS, waterStylePatch } from '../three/presets';
import { defaultSceneEnvironment, withSceneEnvironmentDefaults } from '../three/environmentSettings';
import { applyTerrainFoliagePaint, applyTerrainPaint, applyTerrainSculpt, createTerrainHeightSampler, terrainLocalPointFromWorld, withTerrainDefaults } from '../terrain/terrain';
import { worldTransformOf, worldToLocalUnderParent } from '../utils/transformHierarchy';
import type { ModelInspection } from '../three/inspectModel';
import { collectPackage, collectPrefabPackage, type PackageContent, type PackageSeeds, type PackageSource } from '../project/package';
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
  defaultLight,
  defaultPhysics,
  defaultRagdollSettings,
  defaultRenderSettings,
  defaultRenderer,
  defaultTerrainBrush,
  defaultTransform,
  defaultVehicle,
  defaultWaterVolume,
  lerpAngle,
  resolveCharacter,
  resolveVehicle,
  syncTerrainLayerColors,
  titleCase,
  withPhysicsDefaults,
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
  mapUIElement,
  removeUIElementFromTree,
  uiVariableRef,
  type UITemplateKind,
  type UIThemeKind,
} from './editor/ui';
import {
  cloneGraphValue,
  coerceGraphValue,
  defaultValueForType,
  makeMaterialGraph,
  makeNodeData,
  mapGraphById,
  normalizeNodeData,
  seedNodeDataFromProject,
} from './editor/graph';
import {
  graphId,
  blueprintId,
  starterBlueprints,
  starterDataAssets,
  starterEdges,
  starterNodes,
  starterSceneId,
  starterScenes,
  starterVariables,
} from './editor/starterProject';
import {
  axisIndex,
  clearSaveSlot,
  compareValues,
  getAssetType,
  graphValueToString,
  defaultFracture,
  inferGraphType,
  makeAttachedWeapon,
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
  objectDefaults,
  readSaveSlot,
  setSaveNamespace,
  seedBlueprintInstanceVars,
  toBoolean,
  toNumber,
  writeSaveSlot,
  type ProjectileSetup,
} from './editor/objectFactory';
import { getGraphRuntimeMap, layoutGraphNodes } from './editor/graphRuntime';
import { buildContactIndex, contactMatches, contactOthers, contactTouches, firstContactOther, toIdSet, toLowerCaseSet } from './editor/runtimeIndexes';
import { makeId, stripUndefined } from './editor/ids';
import { createArrayIndexer } from './editor/arrayIndex';
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

// Per-frame lookup Maps over project-level arrays. The arrays are replaced
// immutably only on edit, so these WeakMap-cached indexers return the same Map
// across Play frames instead of rebuilding it 60×/s (see tickRuntime).
const indexVariablesById = createArrayIndexer((v: ProjectVariable) => v.id);
const indexVariablesByName = createArrayIndexer((v: ProjectVariable) => v.name);
const indexDataAssetsById = createArrayIndexer((a: DataAsset) => a.id);
const indexPrefabsById = createArrayIndexer((p: Prefab) => p.id);
const indexControllersById = createArrayIndexer((c: AnimatorController) => c.id);
const indexAnimationsById = createArrayIndexer((a: AnimationAsset) => a.id);
const indexAssetsByName = createArrayIndexer((a: AssetItem) => a.name);
const indexBlueprintsById = createArrayIndexer((b: ScriptBlueprint) => b.id);
const indexSceneObjectsById = createArrayIndexer((o: SceneObject) => o.id);
// Data-table lookups, cached by the columns/rows array identity (those arrays are replaced only when
// the table is edited). A `data.tableGet` node inside an Update loop previously re-scanned the whole
// table every frame with two `.find()`s.
const indexTableColumnsById = createArrayIndexer((c: DataAssetColumn) => c.id);
const indexTableRowsByKey = createArrayIndexer((r: DataAssetRow) => r.key);

export {
  defaultCharacter,
  defaultLight,
  defaultRagdollSettings,
  defaultRenderSettings,
  defaultVehicle,
  resolveCharacter,
  resolveVehicle,
  type CreateObjectOptions,
  type RuntimeAnimator,
} from './editor/defaults';

interface EditorState {
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
  /** Per (owner:node) running Tween Property animations — advanced each tick (eased transform writes onto
   *  the target via the cross-object transform pass); the node's "Done" pin fires when one completes. */
  runtimeTweens: Record<
    string,
    {
      targetId: string;
      property: 'position' | 'rotation' | 'scale';
      from: Vector3Tuple;
      to: Vector3Tuple;
      time: number;
      duration: number;
      easing: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';
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
  /** HP lost per object during the previous tick (any source: Apply Damage node, projectile, melee, contact,
   *  explosion); drives event.receiveDamage (one-frame delayed, like collisions) + its Damage value-out. */
  runtimeDamageEvents: Record<string, number>;
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
  /** Screen UI documents currently shown during Play (keyed by doc id). Seeded from `visibleOnStart`. */
  runtimeVisibleUI: Record<string, boolean>;
  /** Per-object instance variables during Play (e.g. each enemy's health), read by world-UI `self.*` bindings. */
  runtimeObjectVariables: Record<string, Record<string, GraphValue>>;
  /** Runtime text overrides written by ui.setText, keyed by `${docId}:${elementId}`. Play-only. */
  runtimeUITextOverrides: Record<string, string>;
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
  /** Editor-only: the keyframe selected for 3D path editing (its handle gets a transform gizmo). */
  selectedCinematicKeyframe?: { actionId: string; index: number };
  runtimeStarted: boolean;
  runtimeTime: number;
  /** Global game speed (Set Time Scale node): 1 = normal, 0 = paused, <1 = slow-mo. Scales the tick delta
   *  (scripts, timers, physics); input + UI keep running so a paused game can still unpause itself. */
  runtimeTimeScale: number;
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
  renameObject: (id: string, name: string) => void;
  /** Re-parent `id` under `parentId` (or detach to scene root when undefined). Cycle-safe. */
  setObjectParent: (id: string, parentId?: string) => void;
  // --- Prefabs (reusable objects) ---
  /** Capture an object + all its descendants as a reusable prefab in the browser. Returns the prefab id. */
  createPrefabFromObject: (objectId: string, name?: string, folderId?: string) => string | undefined;
  /** Stamp an independent copy of a prefab into the active scene (fresh ids). Returns the new root object id. */
  instantiatePrefab: (prefabId: string, options?: { position?: Vector3Tuple; parentId?: string }) => string | undefined;
  /** Open a prefab in the editor: swaps the active scene to a transient edit scene built from it. */
  openPrefabEditor: (prefabId: string) => void;
  /** Close the prefab editor, optionally saving edits back into the prefab, and restore the prior scene. */
  closePrefabEditor: (save?: boolean) => void;
  renamePrefab: (id: string, name: string) => void;
  deletePrefab: (id: string) => void;
  /** Push a prefab-instance's current edits back into its source prefab (affects FUTURE instances only).
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
  /** Configure a `kind: 'light'` object's light (type/color/intensity/distance/angle). Creates the component if absent. */
  setObjectLight: (objectId: string, patch: Partial<LightComponent>) => void;
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
  addCinematicCameraKeyframe: (cinematicId: string, time: number, pose: RuntimeCinematicCamera) => string | undefined;
  /** Capture/replace an object transform keyframe at `time` (uses `transform` or the object's live pose). */
  addCinematicTransformKeyframe: (cinematicId: string, objectId: string, time: number, transform?: TransformComponent) => string | undefined;
  setCinematicRecording: (recording: boolean) => void;
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
  setRuntimeKey: (code: string, pressed: boolean) => void;
  clearRuntimeSounds: () => void;
  clearRuntimeLog: () => void;
  tickRuntime: (delta: number) => void;
  onNodesChange: OnNodesChange<NodeForgeNode>;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  addGraphNode: (label: string, category: GraphNodeCategory) => void;
  exportProject: () => NodeForgeProject;
  loadProject: (project: NodeForgeProject) => void;
  markClean: () => void;
  /** Collect a prefab + its full dependency closure into a transferable package payload. */
  buildPrefabPackage: (prefabId: string) => { content: PackageContent; assetIds: string[] } | null;
  /** Collect everything in a folder (and its subfolders) + dependencies, like Unreal's Migrate. */
  buildFolderPackage: (folderId: string) => { content: PackageContent; assetIds: string[]; name: string } | null;
  /** Additively merge already-remapped package content + resolved assets into the project. */
  mergePackage: (content: PackageContent, assets: AssetItem[]) => void;
}

const deleteWithChildren = (objects: SceneObject[], id: string) => {
  const ids = new Set<string>([id]);
  let changed = true;

  while (changed) {
    changed = false;
    objects.forEach((object) => {
      if (object.parentId && ids.has(object.parentId) && !ids.has(object.id)) {
        ids.add(object.id);
        changed = true;
      }
    });
  }

  return objects.filter((object) => !ids.has(object.id));
};

/** Collect `rootId` plus every descendant (following parentId), preserving document order. */
const collectSubtree = (objects: SceneObject[], rootId: string): SceneObject[] => {
  const ids = new Set<string>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    objects.forEach((object) => {
      if (object.parentId && ids.has(object.parentId) && !ids.has(object.id)) {
        ids.add(object.id);
        changed = true;
      }
    });
  }
  return objects.filter((object) => ids.has(object.id));
};

/**
 * Deep-clone a self-contained object tree with fresh ids, remapping every INTERNAL reference
 * (parentId + the cross-object id fields attachment/viewModel hold) from old → new. References that
 * point outside the tree are left untouched. Returns the cloned objects and the new root id.
 */
const cloneObjectTree = (
  tree: SceneObject[],
  rootId: string,
): { objects: SceneObject[]; rootId: string } => {
  const idMap = new Map<string, string>();
  tree.forEach((object) => idMap.set(object.id, makeId('obj')));
  const remap = (id: string | undefined) => (id && idMap.has(id) ? idMap.get(id)! : id);
  const objects = tree.map((object) => {
    const clone = structuredClone(object) as SceneObject;
    clone.id = idMap.get(object.id)!;
    if (clone.parentId) clone.parentId = remap(clone.parentId);
    if (clone.attachment?.targetObjectId) {
      clone.attachment = { ...clone.attachment, targetObjectId: remap(clone.attachment.targetObjectId)! };
    }
    if (clone.viewModel?.ownerObjectId) {
      clone.viewModel = { ...clone.viewModel, ownerObjectId: remap(clone.viewModel.ownerObjectId)! };
    }
    // A joint linking two objects INSIDE this tree (e.g. a wrecking-ball prefab roped to its crane)
    // must point at the clone's new id, not the original — else the instantiated prefab links to the
    // source object (or nothing). A world-anchored joint (empty connectedObjectId) is left as-is.
    if (clone.joint?.connectedObjectId) {
      clone.joint = { ...clone.joint, connectedObjectId: remap(clone.joint.connectedObjectId) };
    }
    // A cable whose far end attaches to another object INSIDE this tree must follow the clone — same
    // reasoning as the joint above. A free-hanging cable (no endObjectId) or one attached OUTSIDE the
    // tree keeps its id (remap() passes through ids it doesn't know).
    if (clone.cable?.endObjectId) {
      clone.cable = { ...clone.cable, endObjectId: remap(clone.cable.endObjectId) };
    }
    // Vehicles reference their rig by OBJECT ID (wheels, anchors, lights, emitters, loose parts) — a
    // cloned car must point at its own cloned parts, or a spawned/duplicated vehicle has a dead rig.
    // (garageBodyIds are ASSET ids — shared, never remapped.)
    if (clone.vehicle) {
      const v = clone.vehicle;
      const remapAll = (ids: string[] | undefined) => ids?.map((id) => remap(id)!) ?? ids;
      clone.vehicle = {
        ...v,
        wheelObjectIds: remapAll(v.wheelObjectIds) ?? [],
        steeredWheelIds: remapAll(v.steeredWheelIds) ?? [],
        wheels: v.wheels?.map((w) => ({ ...w, objectId: remap(w.objectId)! })),
        tireMarkIds: remapAll(v.tireMarkIds) ?? [],
        headlightIds: remapAll(v.headlightIds) ?? [],
        brakeLightIds: remapAll(v.brakeLightIds) ?? [],
        brakeDiscIds: remapAll(v.brakeDiscIds),
        boostFlameIds: remapAll(v.boostFlameIds),
        loosePartIds: remapAll(v.loosePartIds),
      };
    }
    return clone;
  });
  return { objects, rootId: idMap.get(rootId)! };
};

/**
 * Remaining lifetime of each spawned VFX burst (impact sparks / dust puffs / explosions), keyed by object
 * id. Kept OUTSIDE the store so ticking a burst's clock never re-mints the object (and with it the whole
 * scene-objects array identity) every frame — the burst component animates itself; the runtime only needs
 * to know when to despawn. Cleared when Play starts.
 */
const effectLife = new Map<string, number>();

/**
 * "Checkpoint <n>" name → gate index (-1 = not a checkpoint) is memoized in `checkpointIndexForName`
 * (see ./editor/runtimeHelpers). The per-Play runtime scratch (pooled Maps, error dedup, crash-part
 * bookkeeping) lives in ./editor/tickState — imported above. Both are kept out of store state.
 */

/** Stable selector for the active scene's objects. Use this in components, not an inline arrow. */
export const selectActiveObjects = (state: EditorState): SceneObject[] =>
  state.scenes.find((scene) => scene.id === state.activeSceneId)?.objects ?? [];

/** One Call Function activation: the evaluated A/B/C arguments + the value a Return node set. */
interface FunctionFrame {
  args: [GraphValue | undefined, GraphValue | undefined, GraphValue | undefined];
  ret: GraphValue | undefined;
}

/** Stable selector for the active scene's environment settings (sky/fog/sun). May be undefined. */
export const selectActiveSceneEnvironment = (
  state: EditorState,
): SceneEnvironmentSettings | undefined =>
  state.scenes.find((scene) => scene.id === state.activeSceneId)?.environment;

/**
 * The effective selection: the multi-select set when it actually contains the active object,
 * otherwise just the active object. This lets every single-select consumer keep reading
 * `selectedObjectId` while multi-select layers on top — any code path that sets only
 * `selectedObjectId` (create, scene switch, etc.) automatically collapses back to single-select.
 */
export const effectiveSelection = (state: EditorState): string[] => {
  const { selectedObjectId, selectedObjectIds } = state;
  if (selectedObjectId && selectedObjectIds.includes(selectedObjectId)) return selectedObjectIds;
  return selectedObjectId ? [selectedObjectId] : [];
};

/**
 * Apply `fn` to the active scene's objects and mark the project dirty.
 * Non-active scenes keep their identity so scene-list consumers don't thrash.
 * NOTE: do NOT use this in tickRuntime/setPlaying — those must not set isDirty.
 */
const mapActiveSceneObjects = (
  state: EditorState,
  fn: (objects: SceneObject[]) => SceneObject[],
): Partial<EditorState> => ({
  scenes: state.scenes.map((scene) =>
    scene.id === state.activeSceneId ? { ...scene, objects: fn(scene.objects) } : scene,
  ),
  isDirty: true,
});

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
  renderSettings: defaultRenderSettings(),
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
  runtimeVelocities: {},
  runtimeKeys: {},
  runtimePreviousKeys: {},
  runtimeKeyPresses: {},
  runtimePreviousKeyPresses: {},
  runtimeEventQueue: [],
  runtimeVariableValues: {},
  runtimeAnimators: {},
  runtimeCameraOverrides: {},
  runtimeCameraShake: 0,
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
  runtimeTriggers: [],
  runtimeTriggersExit: [],
  runtimeDamageEvents: {},
  runtimeSoundQueue: [],
  runtimeVehicleSound: null,
  runtimeLog: [],
  runtimeNodeErrors: {},
  runtimeVisibleUI: {},
  runtimeObjectVariables: {},
  runtimeUITextOverrides: {},
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
  selectedCinematicKeyframe: undefined,
  runtimeStarted: false,
  runtimeTime: 0,
  runtimeTimeScale: 1,
  assetSearch: '',
  activeScene: () => get().scenes.find((scene) => scene.id === get().activeSceneId),
  selectedObject: () => selectActiveObjects(get()).find((object) => object.id === get().selectedObjectId),
  createScene: (name) => {
    const id = makeId('scene');
    set((state) => ({
      scenes: [
        ...state.scenes,
        { id, name: name ?? `Scene ${state.scenes.length + 1}`, objects: [], cinematics: [], environment: defaultSceneEnvironment() },
      ],
      isDirty: true,
    }));
    return id;
  },
  renameScene: (id, name) =>
    set((state) => ({
      scenes: state.scenes.map((scene) => (scene.id === id ? { ...scene, name } : scene)),
      isDirty: true,
    })),
  setSceneAudio: (id, patch) =>
    set((state) => ({
      scenes: state.scenes.map((scene) => (scene.id === id ? { ...scene, ...patch } : scene)),
      isDirty: true,
    })),
  updateSceneEnvironment: (id, patch) =>
    set((state) => ({
      scenes: state.scenes.map((scene) =>
        scene.id === id
          ? { ...scene, environment: { ...withSceneEnvironmentDefaults(scene.environment), ...stripUndefined(patch) } }
          : scene,
      ),
      isDirty: true,
    })),
  deleteScene: (id) =>
    set((state) => {
      if (state.isPlaying || state.scenes.length <= 1) return state;
      const remaining = state.scenes.filter((scene) => scene.id !== id);
      const activeSceneId = state.activeSceneId === id ? remaining[0].id : state.activeSceneId;
      const selectedObjectId =
        state.activeSceneId === id ? remaining[0].objects[0]?.id ?? '' : state.selectedObjectId;
      return { scenes: remaining, activeSceneId, selectedObjectId, isDirty: true };
    }),
  setActiveScene: (id) =>
    set((state) => {
      if (state.isPlaying || id === state.activeSceneId) return state;
      const scene = state.scenes.find((item) => item.id === id);
      if (!scene) return state;
      return { activeSceneId: id, selectedObjectId: scene.objects[0]?.id ?? '' };
    }),
  duplicateScene: (id) => {
    const newId = makeId('scene');
    set((state) => {
      const source = state.scenes.find((scene) => scene.id === id);
      if (!source) return state;
      // Keep ids inside the scene copy: they only need to be unique within a scene, and preserving them
      // keeps parent/action/track links intact. Scenes run independently, so cross-scene id reuse is fine.
      const copy: Scene = { ...structuredClone(source), id: newId, name: `${source.name} Copy` };
      return { scenes: [...state.scenes, copy], isDirty: true };
    });
    return newId;
  },
  activeBlueprint: () => get().blueprints.find((blueprint) => blueprint.id === get().activeBlueprintId),
  activeGraph: () => {
    const activeBlueprint = get().activeBlueprint();
    return get().graphs.find((graph) => graph.id === activeBlueprint?.graphId);
  },
  selectedGraphNode: () => get().activeGraph()?.nodes.find((node) => node.id === get().selectedGraphNodeId),
  selectObject: (id) => set({ selectedObjectId: id, selectedObjectIds: [] }),
  toggleSelectObject: (id) =>
    set((state) => {
      if (!id) return state;
      const current = effectiveSelection(state);
      const has = current.includes(id);
      const next = has ? current.filter((value) => value !== id) : [...current, id];
      return { selectedObjectIds: next, selectedObjectId: has ? next[next.length - 1] ?? '' : id };
    }),
  selectObjects: (ids) => {
    const unique = [...new Set(ids.filter(Boolean))];
    set({ selectedObjectIds: unique, selectedObjectId: unique[unique.length - 1] ?? '' });
  },
  setCameraRigTarget: (id) => set({ cameraRigTarget: id }),
  createObject: (kind) =>
    set((state) => {
      const defaults = objectDefaults[kind];
      const id = makeId('obj');
      const next: SceneObject = {
        id,
        name: kind === 'empty' ? 'Empty Object' : `${kind[0].toUpperCase()}${kind.slice(1)}`,
        kind,
        transform: defaultTransform([0, kind === 'plane' || kind === 'terrain' ? 0 : 2, 0]),
        ...defaults,
      } as SceneObject;

      return { ...mapActiveSceneObjects(state, (objects) => [...objects, next]), selectedObjectId: id };
    }),
  createObjectWithProps: (kind, options = {}) => {
    const id = makeId('obj');
    set((state) => {
      const defaults = objectDefaults[kind];
      const next: SceneObject = {
        id,
        name: options.name ?? (kind === 'empty' ? 'Empty Object' : titleCase(kind)),
        kind,
        transform: defaultTransform(options.position ?? [0, kind === 'plane' || kind === 'terrain' ? 0 : 2, 0]),
        ...defaults,
      } as SceneObject;

      if (options.color && next.renderer) {
        next.renderer = { ...next.renderer, color: options.color };
      }
      if (kind === 'terrain') {
        next.terrain = withTerrainDefaults({ ...next.terrain, ...options.terrain });
      }
      if (options.physics) {
        next.physics = withPhysicsDefaults({ ...(next.physics ?? defaultPhysics()), ...options.physics });
      }
      // Nest under a parent when asked (only if that parent exists in the active scene).
      if (options.parentId && selectActiveObjects(state).some((object) => object.id === options.parentId)) {
        next.parentId = options.parentId;
      }

      return { ...mapActiveSceneObjects(state, (objects) => [...objects, next]), selectedObjectId: id };
    });
    return id;
  },
  spawnStressTest: (count) =>
    set((state) => {
      const created: SceneObject[] = [];
      const side = Math.max(1, Math.ceil(Math.sqrt(count)));
      for (let i = 0; i < count; i += 1) {
        const gx = (i % side) - side / 2;
        const gz = Math.floor(i / side) - side / 2;
        created.push({
          id: makeId('stress'),
          name: `Stress ${i}`,
          kind: 'cube',
          transform: defaultTransform([gx * 1.2, 6 + (i % 6) * 1.3, gz * 1.2]),
          ...objectDefaults.cube,
          physics: withPhysicsDefaults({ ...defaultPhysics(), bodyType: 'dynamic', collider: 'box' }),
        } as SceneObject);
      }
      return mapActiveSceneObjects(state, (objects) => [...objects, ...created]);
    }),
  deleteObject: (id) =>
    set((state) => {
      const objects = selectActiveObjects(state);
      const remaining = deleteWithChildren(objects, id);
      const selectedObjectId = remaining.some((object) => object.id === state.selectedObjectId)
        ? state.selectedObjectId
        : remaining[0]?.id ?? '';
      return { ...mapActiveSceneObjects(state, () => remaining), selectedObjectId };
    }),
  deleteSelectedObject: () =>
    set((state) => {
      const ids = effectiveSelection(state);
      if (!ids.length) return state;
      let remaining = selectActiveObjects(state);
      ids.forEach((id) => {
        remaining = deleteWithChildren(remaining, id);
      });
      return { ...mapActiveSceneObjects(state, () => remaining), selectedObjectId: remaining[0]?.id ?? '', selectedObjectIds: [] };
    }),
  duplicateSelectedObject: () =>
    set((state) => {
      const ids = effectiveSelection(state);
      const objects = selectActiveObjects(state);
      const copies: SceneObject[] = [];
      const newIds: string[] = [];
      ids.forEach((srcId) => {
        const selected = objects.find((object) => object.id === srcId);
        if (!selected) return;
        const id = makeId('obj');
        copies.push({
          ...structuredClone(selected),
          id,
          name: `${selected.name} Copy`,
          transform: {
            ...selected.transform,
            position: [
              selected.transform.position[0] + 0.8,
              selected.transform.position[1],
              selected.transform.position[2] + 0.8,
            ],
          },
        });
        newIds.push(id);
      });
      if (!copies.length) return state;
      return {
        ...mapActiveSceneObjects(state, (current) => [...current, ...copies]),
        selectedObjectId: newIds[newIds.length - 1],
        selectedObjectIds: newIds.length > 1 ? newIds : [],
      };
    }),
  copySelectedObjects: () => {
    const state = get();
    const ids = effectiveSelection(state);
    if (!ids.length) return;
    const objects = selectActiveObjects(state);
    const selectedSet = new Set(ids);
    // A selected id is "top-level" only if none of its ancestors are also selected (avoids copying
    // an object twice when both it and its parent are in the selection).
    const isTopLevel = (object: SceneObject) => {
      let parentId = object.parentId;
      while (parentId) {
        if (selectedSet.has(parentId)) return false;
        parentId = objects.find((candidate) => candidate.id === parentId)?.parentId;
      }
      return true;
    };
    const clipboard: Array<{ rootId: string; objects: SceneObject[] }> = [];
    ids.forEach((id) => {
      const object = objects.find((candidate) => candidate.id === id);
      if (object && isTopLevel(object)) clipboard.push({ rootId: id, objects: collectSubtree(objects, id) });
    });
    set({ objectClipboard: clipboard.length ? clipboard : null });
  },
  pasteClipboard: () => {
    const newIds: string[] = [];
    set((state) => {
      const clip = state.objectClipboard;
      if (!clip?.length) return state;
      const additions: SceneObject[] = [];
      clip.forEach((group) => {
        const { objects: clones, rootId: newRoot } = cloneObjectTree(group.objects, group.rootId);
        // Offset the new root so the paste doesn't sit exactly on the original.
        const placed = clones.map((object) =>
          object.id === newRoot
            ? {
                ...object,
                transform: {
                  ...object.transform,
                  position: [
                    object.transform.position[0] + 0.8,
                    object.transform.position[1],
                    object.transform.position[2] + 0.8,
                  ] as Vector3Tuple,
                },
              }
            : object,
        );
        additions.push(...placed);
        newIds.push(newRoot);
      });
      if (!additions.length) return state;
      return {
        ...mapActiveSceneObjects(state, (current) => [...current, ...additions]),
        selectedObjectId: newIds[newIds.length - 1] ?? state.selectedObjectId,
        selectedObjectIds: newIds.length > 1 ? newIds : [],
      };
    });
    return newIds;
  },
  groupSelectedObjects: () =>
    set((state) => {
      const ids = effectiveSelection(state);
      if (!ids.length) return state;
      const objects = selectActiveObjects(state);
      const selectedSet = new Set(ids);
      const topLevel = ids.filter((id) => {
        const object = objects.find((candidate) => candidate.id === id);
        if (!object) return false;
        let parentId = object.parentId;
        while (parentId) {
          if (selectedSet.has(parentId)) return false;
          parentId = objects.find((candidate) => candidate.id === parentId)?.parentId;
        }
        return true;
      });
      if (!topLevel.length) return state;
      // Group lives at the origin with an identity transform, so reparented children keep their
      // world pose (parent matrix is identity) — no jump on group, and moving the group moves all.
      const groupId = makeId('obj');
      const group = {
        id: groupId,
        name: 'Group',
        kind: 'empty',
        transform: defaultTransform([0, 0, 0]),
        ...objectDefaults.empty,
      } as SceneObject;
      const topSet = new Set(topLevel);
      const next = [
        ...objects.map((object) => (topSet.has(object.id) ? { ...object, parentId: groupId } : object)),
        group,
      ];
      return { ...mapActiveSceneObjects(state, () => next), selectedObjectId: groupId, selectedObjectIds: [] };
    }),
  ungroupObject: (id) =>
    set((state) => {
      const objects = selectActiveObjects(state);
      const group = objects.find((object) => object.id === id);
      if (!group) return state;
      const childIds = objects.filter((object) => object.parentId === id).map((object) => object.id);
      if (!childIds.length) return state;
      const next = objects
        .map((object) => (object.parentId === id ? { ...object, parentId: group.parentId } : object))
        .filter((object) => object.id !== id);
      return {
        ...mapActiveSceneObjects(state, () => next),
        selectedObjectId: childIds[childIds.length - 1],
        selectedObjectIds: childIds.length > 1 ? childIds : [],
      };
    }),
  duplicateObject: (id, options = {}) => {
    const count = Math.max(1, Math.min(Math.round(options.count ?? 1), 200));
    const offset = options.offset ?? [0.8, 0, 0.8];
    const newRootIds: string[] = [];
    set((state) => {
      const objects = selectActiveObjects(state);
      const root = objects.find((object) => object.id === id);
      if (!root) return state;
      const subtree = collectSubtree(objects, id);
      const additions: SceneObject[] = [];
      for (let i = 1; i <= count; i += 1) {
        const { objects: clones, rootId } = cloneObjectTree(subtree, id);
        const placed = clones.map((object) => {
          if (object.id !== rootId) return object;
          return {
            ...object,
            name: `${root.name} Copy${count > 1 ? ` ${i}` : ''}`,
            transform: {
              ...object.transform,
              position: [
                root.transform.position[0] + offset[0] * i,
                root.transform.position[1] + offset[1] * i,
                root.transform.position[2] + offset[2] * i,
              ] as Vector3Tuple,
            },
          };
        });
        newRootIds.push(rootId);
        additions.push(...placed);
      }
      return {
        ...mapActiveSceneObjects(state, (current) => [...current, ...additions]),
        selectedObjectId: newRootIds[newRootIds.length - 1],
      };
    });
    return newRootIds;
  },
  setObjectParent: (id, parentId) =>
    set((state) => {
      if (id === parentId) return state;
      const objects = selectActiveObjects(state);
      if (!objects.some((object) => object.id === id)) return state;
      if (parentId && !objects.some((object) => object.id === parentId)) return state;
      // Reject cycles: a node can't be parented under one of its own descendants.
      if (parentId && collectSubtree(objects, id).some((object) => object.id === parentId)) return state;
      // Keep the object's WORLD pose fixed across the re-parent: capture where it is now, then
      // re-express that pose as a LOCAL transform under the new parent (identity when detaching).
      const world = worldTransformOf(objects, id);
      const localTransform = worldToLocalUnderParent(objects, world, parentId || undefined);
      return mapActiveSceneObjects(state, (current) =>
        current.map((object) =>
          object.id === id ? { ...object, parentId: parentId || undefined, transform: localTransform } : object,
        ),
      );
    }),
  createPrefabFromObject: (objectId, name, folderId) => {
    const objects = selectActiveObjects(get());
    const root = objects.find((object) => object.id === objectId);
    if (!root) return undefined;
    // Capture the object + all descendants, then re-id to prefab-local ids so the stored template
    // never collides with the live scene it was captured from.
    const subtree = collectSubtree(objects, objectId);
    const { objects: captured, rootId } = cloneObjectTree(subtree, objectId);
    // The prefab root has no parent inside the prefab; strip instance-provenance so the template is clean.
    const normalized = captured.map((object) => {
      const { prefabSourceId: _drop, ...rest } = object;
      return object.id === rootId ? { ...rest, parentId: undefined } : rest;
    });
    const id = makeId('prefab');
    set((state) => ({
      prefabs: [
        ...state.prefabs,
        { id, name: name ?? `${root.name} Prefab`, folderId, objects: normalized, rootId, createdAt: Date.now() },
      ],
      // Render a browser thumbnail for the new prefab.
      prefabThumbnailQueue: [...state.prefabThumbnailQueue, id],
      isDirty: true,
    }));
    return id;
  },
  requestPrefabThumbnail: (prefabId) =>
    set((state) =>
      state.prefabThumbnailQueue.includes(prefabId)
        ? state
        : { prefabThumbnailQueue: [...state.prefabThumbnailQueue, prefabId] },
    ),
  setPrefabThumbnail: (prefabId, dataUrl) =>
    set((state) => ({
      prefabs: state.prefabs.map((prefab) => (prefab.id === prefabId ? { ...prefab, thumbnail: dataUrl } : prefab)),
      prefabThumbnailQueue: state.prefabThumbnailQueue.filter((id) => id !== prefabId),
    })),
  instantiatePrefab: (prefabId, options = {}) => {
    const state = get();
    const prefab = state.prefabs.find((item) => item.id === prefabId);
    if (!prefab || !prefab.objects.length) return undefined;
    // CYCLE GUARD: while the prefab editor is open, stamping the edited prefab into itself (directly,
    // or via a chain of nested instances) would make A contain A — refuse instead of corrupting it.
    if (state.editingPrefabId && prefabWouldCycle(state.prefabs, prefabId, state.editingPrefabId)) {
      console.warn(
        `[Feather] Blocked prefab cycle: "${prefab.name}" contains (or is) the prefab being edited.`,
      );
      return undefined;
    }
    const { objects: clones, rootId } = cloneObjectTree(prefab.objects, prefab.rootId);
    // cloneObjectTree preserves order, so clones[i] came from prefab.objects[i] — tag each with its
    // prefab-local id + the source prefab so edits can later 3-way-merge into this instance.
    clones.forEach((clone, i) => {
      clone.prefabObjectId = prefab.objects[i].id;
      clone.prefabSourceId = prefabId;
    });
    const capturedRoot = prefab.objects.find((object) => object.id === prefab.rootId);
    // Without an explicit drop position, spread successive stamps diagonally so they don't pile up
    // exactly on top of each other (one step per existing instance of this prefab in the active scene).
    const existing = selectActiveObjects(state).filter((object) => object.prefabSourceId === prefabId).length;
    const base = capturedRoot?.transform.position ?? ([0, 0, 0] as Vector3Tuple);
    const spread: Vector3Tuple = [base[0] + existing * 1.2, base[1], base[2] + existing * 1.2];
    const placed = clones.map((object) => {
      if (object.id !== rootId) return object;
      const next: SceneObject = { ...object, parentId: options.parentId, prefabSourceId: prefabId };
      next.transform = { ...object.transform, position: options.position ?? spread };
      return next;
    });
    set((current) => ({
      ...mapActiveSceneObjects(current, (objects) => [...objects, ...placed]),
      selectedObjectId: rootId,
    }));
    return rootId;
  },
  openPrefabEditor: (prefabId) =>
    set((state) => {
      const prefab = state.prefabs.find((item) => item.id === prefabId);
      if (!prefab) return state;
      if (state.isPlaying) return state; // don't enter the prefab editor mid-play
      if (state.editingPrefabId === prefabId) return state; // already open

      // If another prefab is already open, save its edits before switching so nothing is lost.
      let prefabs = state.prefabs;
      const openEditScene = state.scenes.find((scene) => scene.id === PREFAB_EDIT_SCENE_ID);
      if (state.editingPrefabId && openEditScene) {
        prefabs = prefabs.map((item) => {
          if (item.id !== state.editingPrefabId) return item;
          const objects = structuredClone(openEditScene.objects);
          const root = objects.find((o) => o.id === item.rootId) ?? objects.find((o) => !o.parentId);
          return { ...item, objects, rootId: root?.id ?? item.rootId };
        });
      }
      const savedPrefab = prefabs.find((item) => item.id === prefabId)!;

      // Build a fresh transient scene from a clone of the prefab so edits don't mutate it until saved.
      const editScene: Scene = {
        id: PREFAB_EDIT_SCENE_ID,
        name: `Prefab: ${savedPrefab.name}`,
        objects: structuredClone(savedPrefab.objects),
      };
      const scenes = [...state.scenes.filter((scene) => scene.id !== PREFAB_EDIT_SCENE_ID), editScene];
      return {
        prefabs,
        scenes,
        activeSceneId: PREFAB_EDIT_SCENE_ID,
        editingPrefabId: prefabId,
        // Only remember a real scene to return to (never the edit scene itself).
        prefabReturnSceneId:
          state.activeSceneId === PREFAB_EDIT_SCENE_ID ? state.prefabReturnSceneId : state.activeSceneId,
        selectedObjectId: savedPrefab.rootId,
        isDirty: true,
      };
    }),
  closePrefabEditor: (save = true) =>
    set((state) => {
      const editScene = state.scenes.find((scene) => scene.id === PREFAB_EDIT_SCENE_ID);
      const editingPrefabId = state.editingPrefabId;
      // The prefab BEFORE this edit — needed for the 3-way instance merge (override = differs from this).
      const oldPrefab = editingPrefabId ? state.prefabs.find((p) => p.id === editingPrefabId) : undefined;
      let prefabs = state.prefabs;
      if (save && editScene && editingPrefabId) {
        prefabs = state.prefabs.map((prefab) => {
          if (prefab.id !== editingPrefabId) return prefab;
          const objects = structuredClone(editScene.objects);
          // The root is whichever object still has no parent (the original root, unless the user
          // re-rooted the tree). Fall back to the stored rootId if it's still present.
          const root =
            objects.find((object) => object.id === prefab.rootId) ?? objects.find((object) => !object.parentId);
          return { ...prefab, objects, rootId: root?.id ?? prefab.rootId };
        });
      }
      const updatedPrefab = editingPrefabId ? prefabs.find((p) => p.id === editingPrefabId) : undefined;
      const scenes = state.scenes
        .filter((scene) => scene.id !== PREFAB_EDIT_SCENE_ID)
        // Propagate the edit into every placed instance (3-way merge — keeps per-instance overrides).
        .map((scene) =>
          save && editingPrefabId && updatedPrefab && oldPrefab
            ? { ...scene, objects: mergePrefabInstances(scene.objects, editingPrefabId, oldPrefab, updatedPrefab) }
            : scene,
        );
      const activeSceneId =
        state.prefabReturnSceneId && scenes.some((scene) => scene.id === state.prefabReturnSceneId)
          ? state.prefabReturnSceneId
          : scenes[0]?.id ?? '';
      const activeObjects = scenes.find((scene) => scene.id === activeSceneId)?.objects ?? [];
      // Re-render the thumbnail for the prefab we just saved.
      const prefabThumbnailQueue =
        save && editingPrefabId && !state.prefabThumbnailQueue.includes(editingPrefabId)
          ? [...state.prefabThumbnailQueue, editingPrefabId]
          : state.prefabThumbnailQueue;
      return {
        scenes,
        prefabs,
        activeSceneId,
        editingPrefabId: null,
        prefabReturnSceneId: null,
        selectedObjectId: activeObjects[0]?.id ?? '',
        prefabThumbnailQueue,
        isDirty: true,
      };
    }),
  renamePrefab: (id, name) =>
    set((state) => ({
      prefabs: state.prefabs.map((prefab) => (prefab.id === id ? { ...prefab, name } : prefab)),
      isDirty: true,
    })),
  deletePrefab: (id) =>
    set((state) => ({
      prefabs: state.prefabs.filter((prefab) => prefab.id !== id),
      // CASCADE: placed instances detach from the dead prefab (they stay in the scene as ordinary
      // objects, but no longer claim a source) — otherwise they'd carry ghost references that make
      // restamp/apply/revert silently misbehave forever.
      scenes: state.scenes.map((scene) => ({
        ...scene,
        objects: scene.objects.map((object) =>
          object.prefabSourceId === id ? { ...object, prefabSourceId: undefined, prefabObjectId: undefined } : object,
        ),
      })),
      isDirty: true,
    })),
  applyInstanceToPrefab: (objectId) => {
    const objects = selectActiveObjects(get());
    const instance = objects.find((object) => object.id === objectId);
    if (!instance?.prefabSourceId) return undefined;
    const prefabId = instance.prefabSourceId;
    const oldPrefab = get().prefabs.find((prefab) => prefab.id === prefabId);
    if (!oldPrefab) return undefined;
    // Capture the instance's subtree into prefab-local space, REUSING each object's prefabObjectId as its
    // prefab id so other instances still match it for the merge (user-added objects get fresh prefab ids).
    const subtree = collectSubtree(objects, objectId);
    const idMap = new Map<string, string>();
    for (const o of subtree) idMap.set(o.id, o.prefabObjectId ?? makeId('pfb'));
    const rootId = idMap.get(objectId)!;
    const oldRootTransform = oldPrefab.objects.find((o) => o.id === oldPrefab.rootId)?.transform;
    const normalized = subtree.map((object) => {
      const { prefabSourceId: _s, prefabObjectId: _p, ...rest } = object;
      const isRoot = object.id === objectId;
      return {
        ...rest,
        id: idMap.get(object.id)!,
        parentId: isRoot ? undefined : object.parentId ? idMap.get(object.parentId) : undefined,
        // The prefab keeps its OWN root transform (placement is an instance property, not applied up).
        transform: isRoot && oldRootTransform ? structuredClone(oldRootTransform) : object.transform,
      } as SceneObject;
    });
    const newPrefab = { objects: normalized, rootId };
    set((state) => ({
      prefabs: state.prefabs.map((prefab) => (prefab.id === prefabId ? { ...prefab, ...newPrefab } : prefab)),
      // Propagate to the OTHER placed instances (the source `objectId` is left as-is). 3-way merge keeps
      // each sibling's own overrides while picking up what this apply changed.
      scenes: state.scenes.map((scene) => ({
        ...scene,
        objects: mergePrefabInstances(scene.objects, prefabId, oldPrefab, newPrefab, objectId),
      })),
      prefabThumbnailQueue: state.prefabThumbnailQueue.includes(prefabId)
        ? state.prefabThumbnailQueue
        : [...state.prefabThumbnailQueue, prefabId],
      isDirty: true,
    }));
    return prefabId;
  },
  revertInstanceToPrefab: (objectId) => {
    const state = get();
    const objects = selectActiveObjects(state);
    const instance = objects.find((object) => object.id === objectId);
    if (!instance?.prefabSourceId) return undefined;
    const prefab = state.prefabs.find((item) => item.id === instance.prefabSourceId);
    if (!prefab || !prefab.objects.length) return undefined;
    // Drop the instance's current subtree, then stamp a fresh copy of the prefab at the same
    // world position/parent so local tweaks are discarded.
    const remaining = deleteWithChildren(objects, objectId);
    const { objects: clones, rootId } = cloneObjectTree(prefab.objects, prefab.rootId);
    const placed = clones.map((object) =>
      object.id === rootId
        ? {
            ...object,
            parentId: instance.parentId,
            prefabSourceId: prefab.id,
            transform: { ...object.transform, position: instance.transform.position },
          }
        : object,
    );
    set((current) => ({
      ...mapActiveSceneObjects(current, () => [...remaining, ...placed]),
      selectedObjectId: rootId,
    }));
    return rootId;
  },
  renameObject: (id, name) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) => (object.id === id ? { ...object, name } : object)),
      ),
    ),
  updateTransform: (id, field, value) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) =>
          object.id === id ? { ...object, transform: { ...object.transform, [field]: value } } : object,
        ),
      ),
    ),
  updateRenderer: (id, patch) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) =>
          object.id === id && object.renderer ? { ...object, renderer: { ...object.renderer, ...patch } } : object,
        ),
      ),
    ),
  setObjectModel: (id, modelAssetId) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) => {
          if (object.id !== id) return object;
          // Assigning a model needs a renderer to hang it on; seed a default one if missing.
          const renderer = object.renderer ?? defaultRenderer('cube');
          return {
            ...object,
            // Each model slot defaults to its imported material (resolved by sourceAssetId — see
            // useResolvedMaterialSlots), so editing that material shows on the model with no per-object
            // wiring. `materialSlots` only holds explicit per-object overrides; clear them when the model
            // changes/clears so a different model's slots don't inherit stale bindings.
            renderer: { ...renderer, modelAssetId: modelAssetId || undefined, materialSlots: undefined },
          };
        }),
      ),
    ),
  setObjectMaterialSlot: (objectId, slotIndex, materialId) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) => {
          if (object.id !== objectId || !object.renderer) return object;
          const slots = [...(object.renderer.materialSlots ?? [])];
          // Grow the array if needed so the slot index is addressable.
          while (slots.length <= slotIndex) slots.push(undefined);
          slots[slotIndex] = materialId || undefined;
          return { ...object, renderer: { ...object.renderer, materialSlots: slots } };
        }),
      ),
    ),
  updateTerrain: (id, patch) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) => {
          if (object.id !== id) return object;
          const current = withTerrainDefaults(object.terrain);
          const terrain = withTerrainDefaults({
            ...current,
            ...stripUndefined(patch),
            foliage: {
              ...current.foliage,
              ...(patch.foliage ? stripUndefined(patch.foliage) : {}),
            },
          });
          const synced = syncTerrainLayerColors(terrain);
          return { ...object, terrain: { ...synced, editVersion: (current.editVersion ?? 0) + 1 } };
        }),
      ),
    ),
  setTerrainBrush: (patch) =>
    set((state) => ({
      terrainBrush: {
        ...state.terrainBrush,
        ...stripUndefined(patch),
        radius: Math.min(256, Math.max(0.5, patch.radius ?? state.terrainBrush.radius)),
        strength: Math.min(64, Math.max(0, patch.strength ?? state.terrainBrush.strength)),
      },
    })),
  applyTerrainBrush: (objectId, worldPosition) => {
    const brush = get().terrainBrush;
    const object = selectActiveObjects(get()).find((item) => item.id === objectId);
    if (!object?.terrain || !brush.enabled) return;
    const terrain = withTerrainDefaults(object.terrain);
    const layerId = brush.targetLayerId && terrain.materialLayers.some((layer) => layer.id === brush.targetLayerId)
      ? brush.targetLayerId
      : terrain.materialLayers[0]?.id;
    if (brush.mode === 'foliage') {
      get().paintFoliageAt(objectId, worldPosition, {
        radius: brush.radius,
        density: brush.foliageDensity ?? 1,
        erase: brush.foliageErase ?? false,
      });
      return;
    }
    if (brush.mode === 'paint' && layerId) {
      get().paintTerrainAt(objectId, worldPosition, { layerId, radius: brush.radius });
      return;
    }
    get().sculptTerrainAt(objectId, worldPosition, {
      operation: brush.operation,
      radius: brush.radius,
      strength: brush.strength,
      flattenHeight: brush.flattenHeight,
    });
  },
  sculptTerrainAt: (objectId, worldPosition, options) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) => {
          if (object.id !== objectId || !object.terrain) return object;
          const terrain = withTerrainDefaults(object.terrain);
          const local = terrainLocalPointFromWorld(object, worldPosition);
          const sculpted = applyTerrainSculpt(terrain, local[0], local[2], {
            operation: options.operation ?? 'raise',
            radius: options.radius ?? get().terrainBrush.radius,
            strength: options.strength ?? get().terrainBrush.strength,
            flattenHeight: options.flattenHeight ?? get().terrainBrush.flattenHeight,
          });
          return { ...object, terrain: { ...sculpted, editVersion: (terrain.editVersion ?? 0) + 1 } };
        }),
      ),
    ),
  paintTerrainAt: (objectId, worldPosition, options) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) => {
          if (object.id !== objectId || !object.terrain) return object;
          const terrain = withTerrainDefaults(object.terrain);
          const local = terrainLocalPointFromWorld(object, worldPosition);
          const painted = applyTerrainPaint(terrain, local[0], local[2], {
            layerId: options.layerId,
            radius: options.radius ?? get().terrainBrush.radius,
          });
          return { ...object, terrain: { ...painted, editVersion: (terrain.editVersion ?? 0) + 1 } };
        }),
      ),
    ),
  paintFoliageAt: (objectId, worldPosition, options) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) => {
          if (object.id !== objectId || !object.terrain) return object;
          const terrain = withTerrainDefaults(object.terrain);
          const local = terrainLocalPointFromWorld(object, worldPosition);
          const painted = applyTerrainFoliagePaint(terrain, local[0], local[2], {
            radius: options.radius ?? get().terrainBrush.radius,
            density: options.density ?? 1,
            erase: options.erase ?? false,
          });
          return { ...object, terrain: { ...painted, editVersion: (terrain.editVersion ?? 0) + 1 } };
        }),
      ),
    ),
  updateTerrainMaterialLayer: (objectId, layerId, patch) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) => {
          if (object.id !== objectId || !object.terrain) return object;
          const terrain = withTerrainDefaults(object.terrain);
          const materialLayers = terrain.materialLayers.map((layer) =>
            layer.id === layerId ? { ...layer, ...stripUndefined(patch), id: layer.id } : layer,
          );
          return { ...object, terrain: syncTerrainLayerColors(withTerrainDefaults({ ...terrain, materialLayers })) };
        }),
      ),
    ),
  addTerrainMaterialLayer: (objectId) => {
    const id = makeId('terrain-layer');
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) => {
          if (object.id !== objectId || !object.terrain) return object;
          const terrain = withTerrainDefaults(object.terrain);
          const materialLayers = [
            ...terrain.materialLayers,
            { id, name: `Layer ${terrain.materialLayers.length + 1}`, color: '#8aa36f' },
          ];
          return { ...object, terrain: syncTerrainLayerColors(withTerrainDefaults({ ...terrain, materialLayers })) };
        }),
      ),
    );
    return id;
  },
  removeTerrainMaterialLayer: (objectId, layerId) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) => {
          if (object.id !== objectId || !object.terrain) return object;
          const terrain = withTerrainDefaults(object.terrain);
          if (terrain.materialLayers.length <= 1) return object;
          const materialLayers = terrain.materialLayers.filter((layer) => layer.id !== layerId);
          const paintOverrides = Object.fromEntries(
            Object.entries(terrain.paintOverrides).filter(([, paintedLayerId]) => paintedLayerId !== layerId),
          );
          return { ...object, terrain: syncTerrainLayerColors(withTerrainDefaults({ ...terrain, materialLayers, paintOverrides })) };
        }),
      ),
    ),
  clearTerrainEdits: (objectId, edits = 'all') =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) => {
          if (object.id !== objectId || !object.terrain) return object;
          const terrain = withTerrainDefaults(object.terrain);
          return {
            ...object,
            terrain: withTerrainDefaults({
              ...terrain,
              heightOverrides: edits === 'paint' ? terrain.heightOverrides : {},
              paintOverrides: edits === 'height' ? terrain.paintOverrides : {},
            }),
          };
        }),
      ),
    ),
  setObjectMaterial: (objectId, materialId) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) => {
          if (object.id !== objectId) return object;
          // Assigning a material needs a renderer to hang it on; seed a default one if missing.
          const renderer = object.renderer ?? defaultRenderer('cube');
          return { ...object, renderer: { ...renderer, materialId: materialId || undefined } };
        }),
      ),
    ),
  updatePhysics: (id, patch) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) =>
          object.id === id && object.physics ? { ...object, physics: withPhysicsDefaults({ ...object.physics, ...patch }) } : object,
        ),
      ),
    ),
  updateWater: (id, patch) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) => {
          if (object.id !== id) return object;
          // Choosing a named style stamps its look; the rest of `patch` can still override on top.
          // Hand-editing a visual/wave field with no style in the patch marks the volume 'custom' so the
          // inspector dropdown stops claiming a preset it no longer matches.
          const stylePatch =
            patch.style && patch.style !== 'custom' ? waterStylePatch(patch.style) : {};
          const touchesLook = WATER_LOOK_KEYS.some((key) => key in patch);
          const derivedStyle = patch.style ?? (touchesLook ? 'custom' : undefined);
          return {
            ...object,
            water: {
              ...defaultWaterVolume(),
              ...object.water,
              ...stylePatch,
              ...patch,
              ...(derivedStyle ? { style: derivedStyle } : {}),
            },
          };
        }),
      ),
    ),
  toggleWater: (id) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) => {
          if (object.id !== id) return object;
          const water = { ...defaultWaterVolume(), ...object.water };
          const enabled = !water.enabled;
          const nextPhysics = withPhysicsDefaults({
            ...(object.physics ?? defaultPhysics('fixed', 'box')),
            enabled: true,
            bodyType: 'fixed',
            collider: 'box',
            isTrigger: true,
            gravityScale: 0,
          });
          return {
            ...object,
            water: { ...water, enabled },
            physics: nextPhysics,
            variables: { ...(object.variables ?? {}), volume: enabled ? 'water' : object.variables?.volume ?? 'water' },
            renderer: object.renderer ? { ...object.renderer, color: '#2BA8FF', opacity: object.renderer.opacity ?? 0.45 } : object.renderer,
          };
        }),
      ),
    ),
  togglePhysics: (id) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) => {
          if (object.id !== id) return object;
          const current = withPhysicsDefaults(object.physics ?? defaultPhysics());
          return { ...object, physics: { ...current, enabled: !current.enabled } };
        }),
      ),
    ),
  addJoint: (id, type = 'hinge') =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) => {
          if (object.id !== id || object.joint) return object;
          // A joint needs a rigid body to act on — ensure physics is on (dynamic by default so it moves).
          const physics = withPhysicsDefaults({ ...(object.physics ?? defaultPhysics('dynamic', 'box')), enabled: true });
          return { ...object, joint: defaultJoint(type), physics };
        }),
      ),
    ),
  updateJoint: (id, patch) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) => {
          if (object.id === id) {
            return { ...object, joint: { ...defaultJoint(), ...object.joint, ...patch } };
          }
          // A joint links two rigid BODIES — so the object we're connecting to needs physics too. Give it
          // a dynamic body if it has none, otherwise the joint silently can't build (syncJoints waits for
          // both bodies to exist). This makes "Connect to X" just work without a separate enable step.
          if (patch.connectedObjectId && object.id === patch.connectedObjectId && !object.physics?.enabled) {
            return { ...object, physics: withPhysicsDefaults({ ...(object.physics ?? defaultPhysics('dynamic', 'box')), enabled: true }) };
          }
          return object;
        }),
      ),
    ),
  removeJoint: (id) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) => (object.id === id ? { ...object, joint: undefined } : object)),
      ),
    ),
  addCloth: (id) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) => (object.id === id && !object.cloth ? { ...object, cloth: defaultCloth() } : object)),
      ),
    ),
  updateCloth: (id, patch) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) =>
          object.id === id ? { ...object, cloth: { ...defaultCloth(), ...object.cloth, ...patch } } : object,
        ),
      ),
    ),
  removeCloth: (id) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) => (object.id === id ? { ...object, cloth: undefined } : object)),
      ),
    ),
  addCable: (id) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) => (object.id === id && !object.cable ? { ...object, cable: defaultCable() } : object)),
      ),
    ),
  updateCable: (id, patch) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) => {
        const owner = objects.find((object) => object.id === id);
        const merged = { ...defaultCable(), ...owner?.cable, ...patch };
        // A PHYSICAL cable needs a rigid body at BOTH ends or the rope joint can't build. Seed sensible
        // bodies for any end that has none: the cable owner is the PIVOT → fixed; the attached end is the
        // swinging MASS → dynamic. Existing physics (any body type) is respected — only absent ones seed.
        const wirePhysics = Boolean(merged.physics && merged.endObjectId);
        return objects.map((object) => {
          if (object.id === id) {
            const physics =
              wirePhysics && !object.physics?.enabled
                ? withPhysicsDefaults({ ...(object.physics ?? defaultPhysics('fixed', 'box')), enabled: true })
                : object.physics;
            return { ...object, cable: merged, physics };
          }
          if (wirePhysics && object.id === merged.endObjectId && !object.physics?.enabled) {
            return { ...object, physics: withPhysicsDefaults({ ...(object.physics ?? defaultPhysics('dynamic', 'box')), enabled: true }) };
          }
          return object;
        });
      }),
    ),
  removeCable: (id) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) => (object.id === id ? { ...object, cable: undefined } : object)),
      ),
    ),
  setObjectFracture: (id, patch) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) =>
          object.id === id ? { ...object, fracture: { ...defaultFracture(), ...object.fracture, ...patch } } : object,
        ),
      ),
    ),
  toggleAnimator: (id) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) => {
          if (object.id !== id) return object;
          const current = object.animator ?? { enabled: false, speed: 1, loop: true };
          return { ...object, animator: { ...current, enabled: !current.enabled } };
        }),
      ),
    ),
  updateAnimator: (id, patch) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) =>
          object.id === id && object.animator ? { ...object, animator: { ...object.animator, ...patch } } : object,
        ),
      ),
    ),
  setRuntimeAnimatorParam: (objectId, paramId, value) =>
    set((state) => {
      const live = state.runtimeAnimators[objectId];
      if (!live) {
        const object = selectActiveObjects(state).find((item) => item.id === objectId);
        const controller = state.animatorControllers.find((item) => item.id === object?.animator?.controllerId);
        const stateId = controller?.defaultStateId ?? controller?.states[0]?.id;
        if (!controller || !stateId) return state;
        const params = Object.fromEntries(controller.parameters.map((param) => [param.id, param.defaultValue])) as Record<
          string,
          number | boolean
        >;
        if (!(paramId in params)) return state;
        return {
          runtimeAnimators: {
            ...state.runtimeAnimators,
            [objectId]: { stateId, params: { ...params, [paramId]: value }, fade: 0, time: 0 },
          },
        };
      }
      // Carried into next tick; manual params persist (auto-sourced ones get recomputed, as expected).
      return { runtimeAnimators: { ...state.runtimeAnimators, [objectId]: { ...live, params: { ...live.params, [paramId]: value } } } };
    }),
  setObjectRagdoll: (objectId, on) => {
    // Module-singleton flag (see ragdollState); the render layer (RagdollRig) reacts each frame.
    setRagdoll(objectId, on);
  },
  registerImportedModel: ({ assetId, assetName, folderId, inspection }) => {
    let materialsAdded = 0;
    let animationsAdded = 0;
    const baseName = assetName.replace(/\.(glb|gltf|fbx)$/i, '');
    const now = Date.now();
    let skeletalMeshId: string | undefined;

    set((state) => {
      const importedMaterials: MaterialDefinition[] = inspection.materials.map((material, index) => ({
        id: makeId('material'),
        name: material.name ? `${baseName} / ${material.name}` : `${baseName} Material ${index + 1}`,
        description: [
          `Imported from ${assetName}.`,
          material.hasBaseColorMap || material.hasNormalMap
            ? 'The model keeps its embedded texture maps; this editable asset mirrors the material values available to the engine.'
            : 'Editable material values derived from the imported model.',
        ].join(' '),
        color: material.color,
        metalness: material.metalness,
        roughness: material.roughness,
        emissiveColor: material.emissiveColor,
        emissiveIntensity: material.emissiveIntensity,
        graphId: makeId('graph'),
        sourceAssetId: assetId,
        folderId,
        createdAt: now,
      }));
      materialsAdded = importedMaterials.length;
      const materialGraphs = importedMaterials.map((material) => makeMaterialGraph(material.graphId!, material.name));

      if (!inspection.skeleton) {
        return {
          materials: [...state.materials, ...importedMaterials],
          graphs: [...state.graphs, ...materialGraphs],
          activeMaterialId: importedMaterials.at(-1)?.id ?? state.activeMaterialId,
          isDirty: state.isDirty || importedMaterials.length > 0,
        };
      }

      // Reuse a skeleton with the same signature, else create one. This is what lets a second
      // character on the same rig share all of the first's animations.
      let skeleton = state.skeletons.find((item) => item.signature === inspection.skeleton!.signature);
      const skeletons = [...state.skeletons];
      if (!skeleton) {
        skeleton = {
          id: makeId('skeleton'),
          name: `${baseName} Skeleton`,
          sourceAssetId: assetId,
          boneNames: inspection.skeleton!.boneNames,
          signature: inspection.skeleton!.signature,
          rootBone: inspection.skeleton!.rootBone,
          folderId,
          createdAt: now,
        };
        skeletons.push(skeleton);
      }

      const skeletalMesh: SkeletalMeshAsset = {
        id: makeId('skmesh'),
        name: baseName,
        sourceAssetId: assetId,
        skeletonId: skeleton.id,
        folderId,
        createdAt: now,
      };
      skeletalMeshId = skeletalMesh.id;

      // Add only clips not already present for this skeleton (dedupe by name).
      const existingNames = new Set(
        state.animations.filter((anim) => anim.skeletonId === skeleton!.id).map((anim) => anim.clipName),
      );
      const newAnimations: AnimationAsset[] = inspection.clips
        .filter((clip) => clip.name && !existingNames.has(clip.name))
        .map((clip) => ({
          id: makeId('anim'),
          name: clip.name,
          sourceAssetId: assetId,
          clipName: clip.name,
          skeletonId: skeleton!.id,
          duration: clip.duration,
          loop: /(_loop|idle)$/i.test(clip.name),
          folderId,
          createdAt: now,
        }));
      animationsAdded = newAnimations.length;

      return {
        materials: [...state.materials, ...importedMaterials],
        graphs: [...state.graphs, ...materialGraphs],
        skeletons,
        skeletalMeshes: [...state.skeletalMeshes, skeletalMesh],
        animations: [...state.animations, ...newAnimations],
        activeMaterialId: importedMaterials.at(-1)?.id ?? state.activeMaterialId,
        isDirty: true,
      };
    });

    return { skeletalMeshId, materialsAdded, animationsAdded };
  },
  createAnimatorController: (name, skeletonId, folderId) => {
    const id = makeId('animctl');
    set((state) => ({
      animatorControllers: [
        ...state.animatorControllers,
        {
          id,
          name: name ?? `Animator ${state.animatorControllers.length + 1}`,
          skeletonId,
          parameters: [],
          states: [],
          defaultStateId: undefined,
          transitions: [],
          folderId,
          createdAt: Date.now(),
        },
      ],
      activeAnimatorControllerId: id,
      isDirty: true,
    }));
    return id;
  },
  updateAnimatorController: (id, patch) =>
    set((state) => ({
      animatorControllers: state.animatorControllers.map((controller) =>
        controller.id === id ? { ...controller, ...patch } : controller,
      ),
      isDirty: true,
    })),
  deleteAnimatorController: (id) =>
    set((state) => ({
      animatorControllers: state.animatorControllers.filter((controller) => controller.id !== id),
      activeAnimatorControllerId:
        state.activeAnimatorControllerId === id
          ? state.animatorControllers.find((controller) => controller.id !== id)?.id ?? ''
          : state.activeAnimatorControllerId,
      isDirty: true,
    })),
  setActiveAnimatorController: (id) => set({ activeAnimatorControllerId: id }),
  setObjectAnimatorController: (objectId, controllerId) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) => {
          if (object.id !== objectId) return object;
          const animator = object.animator ?? defaultAnimator();
          return { ...object, animator: { ...animator, enabled: true, controllerId: controllerId || undefined } };
        }),
      ),
    ),
  addAnimatorParameter: (controllerId, param) => {
    const controller = get().animatorControllers.find((item) => item.id === controllerId);
    if (!controller) return undefined;
    const id = makeId('param');
    const defaultValue = param.defaultValue ?? (param.type === 'float' ? 0 : false);
    set((state) => ({
      animatorControllers: state.animatorControllers.map((item) =>
        item.id === controllerId
          ? {
              ...item,
              parameters: [
                ...item.parameters,
                { id, name: param.name, type: param.type, source: param.source ?? 'manual', variableId: param.variableId, defaultValue },
              ],
            }
          : item,
      ),
      isDirty: true,
    }));
    return id;
  },
  updateAnimatorParameter: (controllerId, paramId, patch) =>
    set((state) => ({
      animatorControllers: state.animatorControllers.map((item) =>
        item.id === controllerId
          ? { ...item, parameters: item.parameters.map((p) => (p.id === paramId ? { ...p, ...patch } : p)) }
          : item,
      ),
      isDirty: true,
    })),
  removeAnimatorParameter: (controllerId, paramId) =>
    set((state) => ({
      animatorControllers: state.animatorControllers.map((item) =>
        item.id === controllerId
          ? {
              ...item,
              parameters: item.parameters.filter((p) => p.id !== paramId),
              // Drop conditions that referenced the removed parameter.
              transitions: item.transitions.map((t) => ({ ...t, conditions: t.conditions.filter((c) => c.parameterId !== paramId) })),
            }
          : item,
      ),
      isDirty: true,
    })),
  addAnimatorState: (controllerId, stateInput) => {
    const controller = get().animatorControllers.find((item) => item.id === controllerId);
    if (!controller) return undefined;
    const id = makeId('state');
    set((state) => ({
      animatorControllers: state.animatorControllers.map((item) =>
        item.id === controllerId
          ? {
              ...item,
              states: [
                ...item.states,
                {
                  id,
                  name: stateInput?.name ?? `State ${item.states.length + 1}`,
                  animationId: stateInput?.animationId,
                  speed: stateInput?.speed ?? 1,
                  loop: stateInput?.loop ?? true,
                  // Stagger new states down a column so they don't stack on the graph canvas.
                  position: stateInput?.position ?? { x: 80, y: 40 + item.states.length * 90 },
                },
              ],
              // First state added becomes the default (entry) state.
              defaultStateId: item.defaultStateId ?? id,
            }
          : item,
      ),
      isDirty: true,
    }));
    return id;
  },
  updateAnimatorState: (controllerId, stateId, patch) =>
    set((state) => ({
      animatorControllers: state.animatorControllers.map((item) =>
        item.id === controllerId
          ? { ...item, states: item.states.map((s) => (s.id === stateId ? { ...s, ...patch } : s)) }
          : item,
      ),
      isDirty: true,
    })),
  removeAnimatorState: (controllerId, stateId) =>
    set((state) => ({
      animatorControllers: state.animatorControllers.map((item) =>
        item.id === controllerId
          ? {
              ...item,
              states: item.states.filter((s) => s.id !== stateId),
              defaultStateId: item.defaultStateId === stateId ? item.states.find((s) => s.id !== stateId)?.id : item.defaultStateId,
              // Drop transitions touching the removed state.
              transitions: item.transitions.filter((t) => t.from !== stateId && t.to !== stateId),
            }
          : item,
      ),
      isDirty: true,
    })),
  addAnimatorTransition: (controllerId, transition) => {
    const controller = get().animatorControllers.find((item) => item.id === controllerId);
    if (!controller) return undefined;
    const id = makeId('xition');
    set((state) => ({
      animatorControllers: state.animatorControllers.map((item) =>
        item.id === controllerId
          ? {
              ...item,
              transitions: [
                ...item.transitions,
                { id, from: transition.from, to: transition.to, conditions: transition.conditions ?? [], duration: transition.duration ?? 0.2, hasExitTime: transition.hasExitTime, exitTime: transition.exitTime },
              ],
            }
          : item,
      ),
      isDirty: true,
    }));
    return id;
  },
  updateAnimatorTransition: (controllerId, transitionId, patch) =>
    set((state) => ({
      animatorControllers: state.animatorControllers.map((item) =>
        item.id === controllerId
          ? { ...item, transitions: item.transitions.map((t) => (t.id === transitionId ? { ...t, ...patch } : t)) }
          : item,
      ),
      isDirty: true,
    })),
  removeAnimatorTransition: (controllerId, transitionId) =>
    set((state) => ({
      animatorControllers: state.animatorControllers.map((item) =>
        item.id === controllerId
          ? { ...item, transitions: item.transitions.filter((t) => t.id !== transitionId) }
          : item,
      ),
      isDirty: true,
    })),
  toggleCharacterController: (id) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) => {
          if (object.id !== id) return object;
          const current = object.character ?? defaultCharacter();
          return { ...object, character: { ...current, enabled: !current.enabled } };
        }),
      ),
    ),
  updateCharacterController: (id, patch) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) =>
          object.id === id && object.character ? { ...object, character: { ...object.character, ...patch } } : object,
        ),
      ),
    ),
  setVehicleEnabled: (id, enabled) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) => {
          if (object.id !== id) return object;
          const current = object.vehicle ?? defaultVehicle();
          return { ...object, vehicle: { ...current, enabled: enabled ?? !current.enabled } };
        }),
      ),
    ),
  updateVehicle: (id, patch) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) =>
          object.id === id ? { ...object, vehicle: { ...defaultVehicle(), ...object.vehicle, ...patch } } : object,
        ),
      ),
    ),
  setInventory: (objectId, inventory) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) => (object.id === objectId ? { ...object, inventory } : object)),
      ),
    ),
  equipInventorySlot: (objectId, index) => {
    const player = selectActiveObjects(get()).find((o) => o.id === objectId);
    const inv = player?.inventory;
    if (!player || !inv || index < 0 || index >= inv.slots.length) return;
    const slot = inv.slots[index];
    const socketName = inv.socketName ?? 'RightHand';
    const boneName = inv.boneName ?? 'hand_r';
    const markerSlot = socketName || boneName;
    const scale = slot.attachScale ?? 1;
    const yaw = slot.attachYaw ?? 0;
    const offsetPosition = slot.attachPosition;
    const offsetRotation = slot.attachRotation ?? ([0, yaw, 0] as Vector3Tuple);
    const offsetScale = [scale, scale, scale] as Vector3Tuple;
    set((state) => {
      const scenes = state.scenes.map((scene) => {
        if (scene.id !== state.activeSceneId) return scene;
        // Drop the weapon currently held on that socket, then attach the new slot's weapon (if any).
        let objects = scene.objects.filter(
          (o) =>
            !(o.variables?.__attachedWeapon && o.attachment?.targetObjectId === objectId && (o.attachment.socketName || o.attachment.boneName) === markerSlot),
        );
        if (slot.weaponAssetId) {
          objects = [...objects, makeAttachedWeapon(objectId, slot.weaponAssetId, boneName, socketName, offsetPosition, offsetRotation, offsetScale)];
        }
        objects = objects.map((o) => (o.id === objectId && o.inventory ? { ...o, inventory: { ...o.inventory, equipped: index } } : o));
        return { ...scene, objects };
      });
      const playing = state.isPlaying;
      return {
        scenes,
        // During Play: fire the equip montage + switch sound. (Don't dirty the project — it's gameplay.)
        runtimeMontageRequests:
          playing && slot.equipAnimId
            ? { ...state.runtimeMontageRequests, [objectId]: { animationId: slot.equipAnimId, speed: 1 } }
            : state.runtimeMontageRequests,
        runtimeSoundQueue: playing && inv.switchSoundId ? [...state.runtimeSoundQueue, { assetId: inv.switchSoundId }] : state.runtimeSoundQueue,
        isDirty: playing ? state.isDirty : true,
      };
    });
    // Ranged gate + aim pose follow the equipped slot (RangedMode is target-able by the shooting graph).
    if (get().isPlaying) {
      const controller = get().animatorControllers.find((c) => c.id === player.animator?.controllerId);
      const ranged = controller?.parameters.find((p) => p.name === 'RangedMode');
      if (ranged) get().setRuntimeAnimatorParam(objectId, ranged.id, Boolean(slot.ranged));
    }
  },
  updateRenderSettings: (patch) =>
    set((state) => ({ renderSettings: { ...state.renderSettings, ...stripUndefined(patch) }, isDirty: true })),
  setObjectLight: (objectId, patch) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) =>
          object.id === objectId
            ? { ...object, kind: 'light', light: { ...defaultLight(), ...object.light, ...stripUndefined(patch) } }
            : object,
        ),
      ),
    ),
  addParticles: (objectId, preset) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) =>
          object.id === objectId
            ? { ...object, particles: withParticleDefaults({ ...object.particles, ...(preset ? particlePresets[preset] : {}) }) }
            : object,
        ),
      ),
    ),
  updateParticles: (objectId, patch) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) =>
          object.id === objectId && object.particles
            ? { ...object, particles: { ...object.particles, ...stripUndefined(patch) } }
            : object,
        ),
      ),
    ),
  removeParticles: (objectId) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) => {
          if (object.id !== objectId) return object;
          const next = { ...object };
          delete next.particles;
          return next;
        }),
      ),
    ),
  setAttachment: (objectId, attachment) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) => {
          if (object.id !== objectId) return object;
          const next = { ...object };
          if (attachment) next.attachment = attachment;
          else delete next.attachment;
          return next;
        }),
      ),
    ),
  addSkeletonSocket: (skeletonId, socket) => {
    const skeleton = get().skeletons.find((item) => item.id === skeletonId);
    if (!skeleton) return undefined;
    const id = makeId('socket');
    set((state) => ({
      skeletons: state.skeletons.map((item) =>
        item.id === skeletonId
          ? {
              ...item,
              sockets: [
                ...(item.sockets ?? []),
                { id, name: socket.name ?? `Socket ${(item.sockets?.length ?? 0) + 1}`, boneName: socket.boneName, position: [0, 0, 0], rotation: [0, 0, 0] },
              ],
            }
          : item,
      ),
      isDirty: true,
    }));
    return id;
  },
  updateSkeletonSocket: (skeletonId, socketId, patch) =>
    set((state) => ({
      skeletons: state.skeletons.map((item) =>
        item.id === skeletonId
          ? { ...item, sockets: (item.sockets ?? []).map((s) => (s.id === socketId ? { ...s, ...patch } : s)) }
          : item,
      ),
      isDirty: true,
    })),
  removeSkeletonSocket: (skeletonId, socketId) =>
    set((state) => ({
      skeletons: state.skeletons.map((item) =>
        item.id === skeletonId ? { ...item, sockets: (item.sockets ?? []).filter((s) => s.id !== socketId) } : item,
      ),
      isDirty: true,
    })),
  updateSkeletonRagdoll: (skeletonId, patch) =>
    set((state) => ({
      skeletons: state.skeletons.map((item) =>
        item.id === skeletonId ? { ...item, ragdoll: { ...defaultRagdollSettings(), ...item.ragdoll, ...patch } } : item,
      ),
      isDirty: true,
    })),
  setRagdollBody: (skeletonId, boneName, patch) =>
    set((state) => ({
      skeletons: state.skeletons.map((item) => {
        if (item.id !== skeletonId) return item;
        if (!item.boneNames.includes(boneName)) return item;
        const base = { ...defaultRagdollSettings(), ...item.ragdoll };
        const bodies = base.bodies ?? [];
        const existing = bodies.find((b) => b.boneName === boneName);
        const nextBodies = existing
          ? bodies.map((b) => (b.boneName === boneName ? { ...b, ...patch } : b))
          : [...bodies, { boneName, ...patch }];
        return { ...item, ragdoll: { ...base, bodies: nextBodies } };
      }),
      isDirty: true,
    })),
  removeRagdollBody: (skeletonId, boneName) =>
    set((state) => ({
      skeletons: state.skeletons.map((item) => {
        if (item.id !== skeletonId || !item.ragdoll) return item;
        return { ...item, ragdoll: { ...item.ragdoll, bodies: (item.ragdoll.bodies ?? []).filter((b) => b.boneName !== boneName) } };
      }),
      isDirty: true,
    })),
  generateRagdollBodies: (skeletonId) =>
    set((state) => ({
      skeletons: state.skeletons.map((item) => {
        if (item.id !== skeletonId) return item;
        const base = { ...defaultRagdollSettings(), ...item.ragdoll };
        let exclude: RegExp;
        try {
          exclude = new RegExp(base.excludePattern, 'i');
        } catch {
          exclude = new RegExp(defaultRagdollSettings().excludePattern, 'i');
        }
        // One default capsule body per non-excluded bone — a starting point the user/AI can tweak.
        const bodies = item.boneNames
          .filter((name) => !exclude.test(name))
          .map((boneName) => ({ boneName, enabled: true, shape: 'capsule' as const }));
        return { ...item, ragdoll: { ...base, bodies } };
      }),
      isDirty: true,
    })),
  createCharacterPawn: (modelAssetId, name) => {
    const state = get();
    const mesh = state.skeletalMeshes.find((item) => item.sourceAssetId === modelAssetId);
    if (!mesh) return undefined; // not a rigged model
    const clips = state.animations.filter((anim) => anim.skeletonId === mesh.skeletonId);
    const pick = (...patterns: RegExp[]) => {
      for (const pattern of patterns) {
        const found = clips.find((clip) => pattern.test(clip.name));
        if (found) return found.id;
      }
      return undefined;
    };
    const idleId = pick(/^idle_loop/i, /idle.*loop/i, /^idle/i, /loop/i);
    const walkId = pick(/^walk_loop/i, /walk.*loop/i, /^walk/i);
    // Three move tiers: Walk (slow) → Jog (normal) → Sprint (fast). Falls back gracefully if some are absent.
    const runId = pick(/jog.*fwd.*loop/i, /jog.*loop/i, /run.*loop/i, /run/i);
    const sprintId = pick(/sprint.*loop/i, /sprint/i);
    const kickId = pick(/^kick$/i, /kick/i);
    // Full jump sequence: take-off, airborne loop, landing. Falls back to a single jump clip.
    const jumpStartId = pick(/jump.*start/i, /jump.*up/i);
    const jumpLoopId = pick(/jump.*loop/i, /jump.*air/i, /^falling/i, /in.?air/i);
    const jumpLandId = pick(/jump.*land/i, /land/i);
    const jumpId = !jumpStartId && !jumpLoopId ? pick(/^jump$/i, /jump/i, /fall/i) : undefined;
    const crouchIdleId = pick(/crouch.*idle/i);
    const crouchWalkId = pick(/crouch.*(fwd|walk)/i, /crouch.*loop/i);
    // In-place roll (we drive the dash in code) — avoid the root-motion "_RM" variant.
    const rollId = pick(/^roll$/i, /^dodge/i, /roll_loop/i);
    // Sideways dodge clips (UAL ships Dodge_Left/Dodge_Right) → the Roll state becomes a directional blend.
    const dodgeLeftId = pick(/^dodge_left$/i, /dodge.*left(?!.*rm)/i);
    const dodgeRightId = pick(/^dodge_right$/i, /dodge.*right(?!.*rm)/i);
    const rollClip = state.animations.find((a) => a.id === rollId);
    const rollDuration = rollClip?.duration ?? 0.7;
    // Match the dash distance to the rig's root-motion roll (~5 units) so the slide aligns with the clip.
    const rollSpeed = Math.round((5 / Math.max(rollDuration, 0.2)) * 10) / 10;
    // Attack clips: a sword swing when armed, a punch when not (avoid the _RM root-motion variant).
    const swordAttackId = pick(/sword.*attack(?!.*rm)/i, /sword.*slash/i, /weapon.*attack/i);
    const punchId = pick(/punch.*cross/i, /punch.*jab/i, /punch/i, /attack(?!.*rm)/i, /kick/i);

    // Build states for whichever clips exist; the first becomes the default (entry) state.
    const speedParamId = makeId('param');
    const vspeedParamId = makeId('param');
    const crouchParamId = makeId('param');
    const groundedParamId = makeId('param');
    const rollParamId = makeId('param');
    const parameters: AnimatorParameter[] = [
      { id: speedParamId, name: 'Speed', type: 'float', source: 'speed', defaultValue: 0 },
      { id: vspeedParamId, name: 'VerticalSpeed', type: 'float', source: 'verticalSpeed', defaultValue: 0 },
      { id: crouchParamId, name: 'Crouching', type: 'bool', source: 'crouching', defaultValue: false },
      { id: groundedParamId, name: 'Grounded', type: 'bool', source: 'grounded', defaultValue: true },
      { id: rollParamId, name: 'Rolling', type: 'bool', source: 'rolling', defaultValue: false },
      { id: makeId('param'), name: 'Mantling', type: 'bool', source: 'mantling', defaultValue: false },
      { id: makeId('param'), name: 'Turning', type: 'bool', source: 'turning', defaultValue: false },
      { id: makeId('param'), name: 'Attacking', type: 'bool', source: 'attacking', defaultValue: false },
      { id: makeId('param'), name: 'WeaponEquipped', type: 'bool', source: 'weaponEquipped', defaultValue: false },
    ];
    const attackParamId = parameters[parameters.length - 2].id;
    const weaponParamId = parameters[parameters.length - 1].id;
    // Directional + crawl sources (strafe blend space + crawl traversal). Added after the index lookups above.
    const moveXParamId = makeId('param');
    const moveYParamId = makeId('param');
    const crawlParamId = makeId('param');
    const swimParamId = makeId('param');
    const climbParamId = makeId('param');
    parameters.push(
      { id: moveXParamId, name: 'MoveX', type: 'float', source: 'moveX', defaultValue: 0 },
      { id: moveYParamId, name: 'MoveY', type: 'float', source: 'moveY', defaultValue: 0 },
      { id: crawlParamId, name: 'Crawling', type: 'bool', source: 'crawling', defaultValue: false },
      { id: swimParamId, name: 'Swimming', type: 'bool', source: 'swimming', defaultValue: false },
      { id: climbParamId, name: 'Climbing', type: 'bool', source: 'climbing', defaultValue: false },
    );
    // Directional dodge + sprint-slide sources (the runtime feeds both — see the movement pass).
    const rollXParamId = makeId('param');
    const slideParamId = makeId('param');
    parameters.push(
      { id: rollXParamId, name: 'RollX', type: 'float', source: 'rollX', defaultValue: 0 },
      { id: slideParamId, name: 'Sliding', type: 'bool', source: 'sliding', defaultValue: false },
    );
    // PRECISE underscore-anchored picks so directional clips don't collide (loose /jog.*fwd.*loop/ matches
    // BOTH "Jog_Fwd_Loop" and "Jog_Fwd_L_Loop" → duplicate samples → one overwrites the other's weight → A-pose).
    // Each direction must resolve to a DISTINCT clip.
    const jogFwd = pick(/jog_fwd_loop/i) ?? runId; // straight forward
    const jogBwd = pick(/jog_bwd_loop/i);
    const jogLeftId = pick(/jog_left_loop/i);
    const jogRightId = pick(/jog_right_loop/i);
    const jogFwdL = pick(/jog_fwd_l_loop/i, /jog_fwd_leanl_loop/i);
    const jogFwdR = pick(/jog_fwd_r_loop/i, /jog_fwd_leanr_loop/i);
    const jogBwdL = pick(/jog_bwd_l_loop/i);
    const jogBwdR = pick(/jog_bwd_r_loop/i);
    const crawlIdleId = pick(/crawl.*idle.*loop/i, /crawl.*idle/i);
    const crawlFwdId = pick(/crawl.*fwd.*loop/i, /crawl.*loop/i);
    // Traversal modes: swim (in a water volume) + climb (on a climb volume). Each is a BLEND SPACE so it
    // eases between a stationary pose and the moving stroke/climb (no hard pop, idle when not moving).
    const swimIdleId = pick(/swim.*idle.*loop/i, /tread.*water/i, /swim.*idle/i);
    const swimFwdId = pick(/swim.*fwd.*loop/i, /swim.*forward/i, /swim.*loop/i);
    const climbIdleId = pick(/climb.*idle.*loop/i, /climb.*idle/i, /hang.*idle/i);
    const climbUpId = pick(/climb.*up.*loop/i, /climb.*up/i, /climb.*loop/i);
    const climbDownId = pick(/climb.*down.*loop/i, /climb.*down/i);
    // Strafe locomotion needs at least forward + the two sides; otherwise fall back to 1D speed locomotion.
    const strafeMode = Boolean(jogFwd && jogLeftId && jogRightId);
    const states: AnimatorState[] = [];
    const stateId: Record<string, string> = {};
    const layout: Record<string, { x: number; y: number }> = {
      idle: { x: 60, y: 40 },
      walk: { x: 320, y: 40 },
      run: { x: 580, y: 40 },
      sprint: { x: 840, y: 40 },
      kick: { x: 60, y: 700 },
      jumpStart: { x: 320, y: 220 },
      jumpLoop: { x: 540, y: 220 },
      jumpLand: { x: 760, y: 220 },
      jump: { x: 320, y: 220 },
      crouchIdle: { x: 60, y: 380 },
      crouchWalk: { x: 320, y: 380 },
      roll: { x: 580, y: 380 },
      punch: { x: 60, y: 540 },
      swordAttack: { x: 320, y: 540 },
    };
    const addState = (key: string, name: string, animationId: string | undefined, loop = true) => {
      if (!animationId) return;
      const id = makeId('state');
      stateId[key] = id;
      states.push({ id, name, animationId, speed: 1, loop, position: layout[key] ?? { x: 60, y: 40 + states.length * 90 } });
    };
    // Locomotion blend space. STRAFE mode (when 8-way jog clips exist): a 2D blend over MoveX × MoveY so the
    // character faces the camera and blends directional jogs (Unreal-style). Otherwise a 1D blend over Speed
    // (idle→walk→jog→sprint). Either way it's one smooth state with no popping.
    if (strafeMode) {
      const dir = [
        idleId && { animationId: idleId, value: 0, y: 0 },
        jogFwd && { animationId: jogFwd, value: 0, y: 1 },
        jogBwd && { animationId: jogBwd, value: 0, y: -1 },
        jogLeftId && { animationId: jogLeftId, value: -1, y: 0 },
        jogRightId && { animationId: jogRightId, value: 1, y: 0 },
        jogFwdL && { animationId: jogFwdL, value: -0.7, y: 0.7 },
        jogFwdR && { animationId: jogFwdR, value: 0.7, y: 0.7 },
        jogBwdL && { animationId: jogBwdL, value: -0.7, y: -0.7 },
        jogBwdR && { animationId: jogBwdR, value: 0.7, y: -0.7 },
      ].filter(Boolean) as { animationId: string; value: number; y: number }[];
      const id = makeId('state');
      stateId.locomotion = id;
      states.push({
        id,
        name: 'Locomotion',
        animationId: idleId ?? dir[0].animationId,
        speed: 1,
        loop: true,
        position: layout.idle,
        blendParameterId: moveXParamId,
        blendParameterIdY: moveYParamId,
        blendSamples: dir,
      });
    } else {
      const locoSamples = [
        idleId && { animationId: idleId, value: 0 },
        walkId && { animationId: walkId, value: 1.5 },
        runId && { animationId: runId, value: 3.4 },
        sprintId && { animationId: sprintId, value: 6.8 },
      ].filter(Boolean) as { animationId: string; value: number }[];
      if (locoSamples.length) {
        const id = makeId('state');
        stateId.locomotion = id;
        states.push({
          id,
          name: 'Locomotion',
          animationId: idleId ?? locoSamples[0].animationId,
          speed: 1,
          loop: true,
          position: layout.idle,
          blendParameterId: speedParamId,
          blendSamples: locoSamples,
        });
      }
    }
    addState('jumpStart', 'Jump Start', jumpStartId, false);
    addState('jumpLoop', 'Jump Loop', jumpLoopId, true);
    addState('jumpLand', 'Jump Land', jumpLandId, false);
    addState('jump', 'Jump', jumpId, false);
    addState('crouchIdle', 'Crouch Idle', crouchIdleId);
    addState('crouchWalk', 'Crouch Walk', crouchWalkId);
    addState('crawlIdle', 'Crawl Idle', crawlIdleId);
    addState('crawlFwd', 'Crawl', crawlFwdId);
    // Swim — 1D blend over Speed: float/tread when still, stroke forward as horizontal speed rises.
    const swimSamples = [
      swimIdleId && { animationId: swimIdleId, value: 0 },
      swimFwdId && { animationId: swimFwdId, value: 3 },
    ].filter(Boolean) as { animationId: string; value: number }[];
    if (swimSamples.length) {
      const id = makeId('state');
      stateId.swim = id;
      states.push({
        id,
        name: 'Swim',
        animationId: swimIdleId ?? swimSamples[0].animationId,
        speed: 1,
        loop: true,
        position: { x: 840, y: 380 },
        blendParameterId: speedParamId,
        blendSamples: swimSamples,
      });
    }
    // Climb — 1D blend over VerticalSpeed: descend (−) ↔ cling (0) ↔ ascend (+), so it reverses on the way down.
    const climbSamples = [
      climbDownId && { animationId: climbDownId, value: -1.5 },
      climbIdleId && { animationId: climbIdleId, value: 0 },
      climbUpId && { animationId: climbUpId, value: 1.5 },
    ].filter(Boolean) as { animationId: string; value: number }[];
    if (climbSamples.length) {
      const id = makeId('state');
      stateId.climb = id;
      states.push({
        id,
        name: 'Climb',
        animationId: climbIdleId ?? climbSamples[0].animationId,
        speed: 1,
        loop: true,
        position: { x: 840, y: 540 },
        blendParameterId: vspeedParamId,
        blendSamples: climbSamples,
      });
    }
    // Roll: a 1D blend space over RollX when the rig has sideways dodge clips (Dodge_Left ↔ Roll ↔
    // Dodge_Right) so a directional dodge plays the matching clip; otherwise the plain roll one-shot.
    if (rollId && (dodgeLeftId || dodgeRightId)) {
      const id = makeId('state');
      stateId.roll = id;
      states.push({
        id,
        name: 'Roll',
        animationId: rollId,
        speed: 1,
        loop: false,
        position: layout.roll,
        blendParameterId: rollXParamId,
        blendSamples: [
          dodgeLeftId && { animationId: dodgeLeftId, value: -1 },
          { animationId: rollId, value: 0 },
          dodgeRightId && { animationId: dodgeRightId, value: 1 },
        ].filter(Boolean) as { animationId: string; value: number }[],
      });
    } else addState('roll', 'Roll', rollId, false);
    // Slide: the crouch pose doubles as a power-slide pose (the rig ships no dedicated slide clip);
    // swap the clip on the state to customize.
    addState('slide', 'Slide', crouchIdleId);
    addState('punch', 'Punch', punchId, false);
    addState('kick', 'Kick', kickId, false);
    addState('swordAttack', 'Sword Attack', swordAttackId, false);
    if (!states.length) return undefined; // no usable clips

    const C = (parameterId: string, op: AnimatorCondition['op'], value: number | boolean): AnimatorCondition => ({ parameterId, op, value });
    const transitions: AnimatorTransition[] = [];
    const link = (from: string, to: string, conditions: AnimatorCondition[], duration = 0.18) => {
      if (stateId[from] && stateId[to]) transitions.push({ id: makeId('xition'), from: stateId[from], to: stateId[to], conditions, duration });
    };
    const linkAny = (to: string, conditions: AnimatorCondition[], duration = 0.12) => {
      if (stateId[to]) transitions.push({ id: makeId('xition'), from: 'any', to: stateId[to], conditions, duration });
    };
    /** Transition that waits for the source clip to play to `exitTime` (one-shots like Jump Start/Land). */
    const linkExit = (from: string, to: string, conditions: AnimatorCondition[] = [], duration = 0.12, exitTime = 1) => {
      if (stateId[from] && stateId[to]) transitions.push({ id: makeId('xition'), from: stateId[from], to: stateId[to], conditions, duration, hasExitTime: true, exitTime });
    };

    // --- Jump (highest priority). Take off → airborne loop → land, detecting the ground via Grounded. ---
    const groundStates = ['locomotion', 'crouchIdle', 'crouchWalk'];
    const airKey = stateId.jumpLoop ? 'jumpLoop' : stateId.jumpStart ? 'jumpStart' : undefined;
    if (stateId.jumpStart || stateId.jumpLoop) {
      // Take-off only from grounded states (not "any") so the airborne loop never bounces back to Start.
      const entry = stateId.jumpStart ? 'jumpStart' : 'jumpLoop';
      groundStates.forEach((from) => link(from, entry, [C(vspeedParamId, '>', 1)], 0.08));
      // Start clip plays out, then the airborne loop.
      // Blend to the airborne loop partway through the launch clip so it doesn't wait the full wind-up.
      if (stateId.jumpStart && stateId.jumpLoop) linkExit('jumpStart', 'jumpLoop', [], 0.12, 0.5);
      // Short hop: if we land while still in the start clip, recover instead of waiting.
      if (stateId.jumpStart) link('jumpStart', stateId.jumpLand ? 'jumpLand' : 'locomotion', [C(groundedParamId, '==', true)], 0.1);
      // Land when we touch ground again. If you touch down ALREADY MOVING, skip the land plant and go straight
      // to locomotion (push this first so it wins); land stationary and the plant clip plays.
      if (stateId.jumpLand && airKey) {
        link(airKey, 'locomotion', [C(groundedParamId, '==', true), C(speedParamId, '>', 0.1)], 0.12);
        link(airKey, 'jumpLand', [C(groundedParamId, '==', true)], 0.1);
      }
      // Out of the land plant: starting to move INTERRUPTS it immediately (no exit time) so it never overstays;
      // if you just stand there it still recovers partway through the clip rather than waiting for the full end.
      if (stateId.jumpLand) {
        link('jumpLand', 'locomotion', [C(speedParamId, '>', 0.1)]);
        linkExit('jumpLand', 'locomotion', [], 0.12, 0.45);
      } else if (airKey) link(airKey, 'locomotion', [C(groundedParamId, '==', true)]);
    } else if (stateId.jump) {
      groundStates.forEach((from) => link(from, 'jump', [C(vspeedParamId, '>', 1)], 0.1));
      link('jump', 'locomotion', [C(groundedParamId, '==', true)]);
    }
    // --- Roll/dodge: enter from grounded states while Rolling, return to locomotion when it ends. ---
    if (stateId.roll) {
      groundStates.forEach((from) => link(from, 'roll', [C(rollParamId, '==', true)], 0.08));
      link('roll', 'locomotion', [C(rollParamId, '==', false)]);
    }
    // --- Attack: sword swing when a weapon is equipped, otherwise a punch; clip plays out, then locomotion. ---
    if (stateId.swordAttack) {
      groundStates.forEach((from) => link(from, 'swordAttack', [C(attackParamId, '==', true), C(weaponParamId, '==', true)], 0.08));
      linkExit('swordAttack', 'locomotion');
    }
    // Unarmed: a running attack (moving fast) plays a Kick; standing plays a Punch. Evaluated before
    // punch so the speed>4 case wins. Both require the weapon to be unequipped (when a sword exists).
    const unarmed = stateId.swordAttack ? [C(weaponParamId, '==', false)] : [];
    if (stateId.kick) {
      groundStates.forEach((from) => link(from, 'kick', [C(attackParamId, '==', true), C(speedParamId, '>', 4), ...unarmed], 0.08));
      linkExit('kick', 'locomotion');
    }
    if (stateId.punch) {
      groundStates.forEach((from) => link(from, 'punch', [C(attackParamId, '==', true), ...unarmed], 0.08));
      linkExit('punch', 'locomotion');
    }
    // Sprint-slide: highest-priority ground move — registered BEFORE crouch so its "any" link wins while
    // the crouch key is still held during a tap-slide.
    if (stateId.slide) {
      linkAny('slide', [C(slideParamId, '==', true)], 0.1);
      link('slide', 'locomotion', [C(slideParamId, '==', false)], 0.16);
    }
    // Crouch: enter the crouch states while crouching, return to the locomotion blend space when released.
    if (stateId.crouchIdle || stateId.crouchWalk) {
      linkAny('crouchWalk', [C(crouchParamId, '==', true), C(speedParamId, '>', 0.1)]);
      linkAny('crouchIdle', [C(crouchParamId, '==', true), C(speedParamId, '<', 0.1)]);
      link('crouchIdle', 'crouchWalk', [C(speedParamId, '>', 0.1)]);
      link('crouchWalk', 'crouchIdle', [C(speedParamId, '<', 0.1)]);
      link('crouchIdle', 'locomotion', [C(crouchParamId, '==', false)]);
      link('crouchWalk', 'locomotion', [C(crouchParamId, '==', false)]);
    }
    // Crawl (traversal): hold the crawl key → drop to crawl idle/move, release → back to locomotion.
    if (stateId.crawlIdle || stateId.crawlFwd) {
      linkAny('crawlFwd', [C(crawlParamId, '==', true), C(speedParamId, '>', 0.1)]);
      linkAny('crawlIdle', [C(crawlParamId, '==', true), C(speedParamId, '<', 0.1)]);
      if (stateId.crawlIdle && stateId.crawlFwd) {
        link('crawlIdle', 'crawlFwd', [C(speedParamId, '>', 0.1)]);
        link('crawlFwd', 'crawlIdle', [C(speedParamId, '<', 0.1)]);
      }
      link('crawlIdle', 'locomotion', [C(crawlParamId, '==', false)]);
      link('crawlFwd', 'locomotion', [C(crawlParamId, '==', false)]);
    }
    // Swim / climb traversal modes (entered while inside a water / climb volume; highest priority via "any").
    if (stateId.swim) {
      linkAny('swim', [C(swimParamId, '==', true)], 0.15);
      link('swim', 'locomotion', [C(swimParamId, '==', false)], 0.15);
    }
    if (stateId.climb) {
      linkAny('climb', [C(climbParamId, '==', true)], 0.15);
      link('climb', 'locomotion', [C(climbParamId, '==', false)], 0.15);
    }
    // (Speed tiers are handled inside the Locomotion blend space — no discrete tier transitions.)

    const controllerId = makeId('animctl');
    const defaultStateId = stateId.locomotion ?? stateId.idle ?? states[0].id;
    const controller: AnimatorController = {
      id: controllerId,
      name: `${mesh.name} Locomotion`,
      skeletonId: mesh.skeletonId,
      parameters,
      states,
      defaultStateId,
      transitions,
      createdAt: Date.now(),
    };

    // Preset, fully-editable controller graph (Unreal Event-Graph style): Update → Move(Get Move Input),
    // and Space → Jump. The user opens this blueprint to change the logic; the animator reads the
    // resulting motion automatically. Having an enabled script puts the character in "scripted" mode.
    const graphId = makeId('graph');
    const blueprintId = makeId('bp');
    const node = (nodeId: string, label: string, category: GraphNodeCategory, x: number, y: number, extra: Partial<NodeForgeNodeData> = {}): NodeForgeNode => ({
      id: nodeId,
      type: 'nodeforge',
      position: { x, y },
      data: makeNodeData(label, category, extra),
    });
    const updateNodeId = makeId('node');
    const inputNodeId = makeId('node');
    const moveNodeId = makeId('node');
    const spaceNodeId = makeId('node');
    const jumpNodeId = makeId('node');
    const presetNodes: NodeForgeNode[] = [
      node(updateNodeId, 'Update', 'Events', 40, 60, { hasInput: false }),
      node(inputNodeId, 'Get Move Input', 'Runtime', 40, 200),
      node(moveNodeId, 'Move', 'Runtime', 360, 90),
      node(spaceNodeId, 'Key Down', 'Events', 40, 360, { keyCode: 'Space', hasInput: false }),
      node(jumpNodeId, 'Jump', 'Runtime', 360, 360),
    ];
    const execEdge = (source: string, target: string): Edge => ({
      id: makeId('edge'),
      source,
      target,
      sourceHandle: 'exec-out',
      targetHandle: 'exec-in',
      animated: true,
      type: 'smoothstep',
    });
    const valueEdge = (source: string, target: string, targetHandle: string): Edge => ({
      id: makeId('edge'),
      source,
      target,
      sourceHandle: 'value-out',
      targetHandle,
      type: 'smoothstep',
      style: { stroke: '#3DD0DC', strokeWidth: 2 },
    });
    const presetEdges: Edge[] = [
      execEdge(updateNodeId, moveNodeId),
      valueEdge(inputNodeId, moveNodeId, 'vector'),
      execEdge(spaceNodeId, jumpNodeId),
    ];
    const presetGraph: ProjectGraph = { id: graphId, name: `${mesh.name} Controller`, nodes: presetNodes, edges: presetEdges };
    const blueprint: ScriptBlueprint = {
      id: blueprintId,
      name: `${mesh.name} Controller`,
      description: 'Third-person character logic — edit these nodes to change movement, jump, abilities.',
      graphId,
      color: '#5b8cff',
      createdAt: Date.now(),
    };

    const objectId = makeId('obj');
    const pawn: SceneObject = {
      id: objectId,
      name: name ?? mesh.name,
      kind: 'cube',
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      renderer: { ...defaultRenderer('cube'), modelAssetId },
      animator: { enabled: true, controllerId, speed: 1, loop: true },
      // Strafe mode (faces camera + 8-way move) when the rig has directional jogs for the 2D blend space.
      character: { ...defaultCharacter(), enabled: true, rollDuration, rollSpeed, jumpStrength: 6, strafe: strafeMode },
      script: { blueprintId, graphId, enabled: true },
    };

    set((draft) => ({
      animatorControllers: [...draft.animatorControllers, controller],
      activeAnimatorControllerId: controllerId,
      blueprints: [...draft.blueprints, blueprint],
      graphs: [...draft.graphs, presetGraph],
      activeBlueprintId: blueprintId,
      ...mapActiveSceneObjects(draft, (objects) => [...objects, pawn]),
      selectedObjectId: objectId,
    }));
    return objectId;
  },
  addGameplayKit: (objectId, kit) => {
    let summary = '';
    set((draft) => {
      const object = selectActiveObjects(draft).find((o) => o.id === objectId);
      const controller = draft.animatorControllers.find((c) => c.id === object?.animator?.controllerId);
      if (!object || !controller) return draft;
      const clips = draft.animations.filter((a) => a.skeletonId === controller.skeletonId);
      const pick = (...patterns: RegExp[]) => {
        for (const p of patterns) {
          const f = clips.find((c) => p.test(c.name));
          if (f) return f.id;
        }
        return undefined;
      };
      const params = [...controller.parameters];
      const states = [...controller.states];
      const transitions = [...controller.transitions];
      let nextVariables = draft.variables;
      const C = (parameterId: string, op: AnimatorCondition['op'], value: number | boolean): AnimatorCondition => ({ parameterId, op, value });
      const ensureParam = (name: string, type: AnimatorParameter['type'], source: AnimatorParameter['source'], defaultValue: number | boolean, variableId?: string) => {
        let p = params.find((x) => x.name === name);
        if (!p) {
          p = { id: makeId('param'), name, type, source, defaultValue, ...(variableId ? { variableId } : {}) };
          params.push(p);
        }
        return p.id;
      };
      // "Home" = the locomotion idle we return action states to.
      const homeId = (
        states.find((s) => /^idle$/i.test(s.name)) ??
        states.find((s) => /idle/i.test(s.name) && !/pistol|crouch/i.test(s.name)) ??
        states.find((s) => s.id === controller.defaultStateId) ??
        states[0]
      ).id;
      let placeX = 60;
      let placeY = 760;
      const addState = (name: string, animationId: string | undefined, loop: boolean) => {
        if (!animationId) return undefined;
        const existing = states.find((s) => s.name === name);
        if (existing) return existing.id;
        const id = makeId('state');
        states.push({ id, name, animationId, speed: 1, loop, position: { x: placeX, y: placeY } });
        placeX += 240;
        if (placeX > 820) {
          placeX = 60;
          placeY += 160;
        }
        return id;
      };
      const link = (from: string, to: string, conds: AnimatorCondition[], duration = 0.12) =>
        transitions.push({ id: makeId('xition'), from, to, conditions: conds, duration });
      const linkAny = (to: string, conds: AnimatorCondition[], duration = 0.12) =>
        transitions.push({ id: makeId('xition'), from: 'any', to, conditions: conds, duration });
      const linkExit = (from: string, to: string, conds: AnimatorCondition[] = [], exitTime = 0.9) =>
        transitions.push({ id: makeId('xition'), from, to, conditions: conds, duration: 0.12, hasExitTime: true, exitTime });

      if (kit === 'ranged') {
        const aiming = ensureParam('Aiming', 'bool', 'aiming', false);
        const reloading = ensureParam('Reloading', 'bool', 'reloading', false);
        const attacking = ensureParam('Attacking', 'bool', 'attacking', false);
        const ranged = ensureParam('RangedMode', 'bool', 'manual', false);
        const pistolIdle = addState('Pistol Idle', pick(/pistol.*idle/i), true);
        const aim = addState('Aim', pick(/pistol.*aim.*neutral/i, /pistol.*aim/i), true);
        const shoot = addState('Shoot', pick(/pistol.*shoot/i), false);
        const reload = addState('Reload', pick(/pistol.*reload/i), false);
        if (pistolIdle) {
          const meleeStateIds = new Set(
            states.filter((state) => /sword attack|punch|kick/i.test(state.name)).map((state) => state.id),
          );
          transitions.forEach((transition) => {
            if (!meleeStateIds.has(transition.to)) return;
            if (transition.conditions.some((condition) => condition.parameterId === ranged)) return;
            transition.conditions = [...transition.conditions, C(ranged, '==', false)];
          });
          const linkFirst = (from: string, to: string, conds: AnimatorCondition[], duration = 0.08) =>
            transitions.unshift({ id: makeId('xition'), from, to, conditions: conds, duration });
          link(homeId, pistolIdle, [C(ranged, '==', true)]);
          link(pistolIdle, homeId, [C(ranged, '==', false)]);
          if (aim) {
            link(pistolIdle, aim, [C(aiming, '==', true)]);
            link(aim, pistolIdle, [C(aiming, '==', false)]);
          }
          if (shoot) {
            linkFirst(homeId, shoot, [C(ranged, '==', true), C(attacking, '==', true)]);
            link(pistolIdle, shoot, [C(attacking, '==', true)]);
            if (aim) link(aim, shoot, [C(attacking, '==', true)]);
            linkExit(shoot, aim ?? pistolIdle);
          }
          if (reload) {
            link(pistolIdle, reload, [C(reloading, '==', true)]);
            if (aim) link(aim, reload, [C(reloading, '==', true)]);
            linkExit(reload, pistolIdle);
          }
          summary = 'ranged pistol (aim/shoot/reload)';
        }
      } else if (kit === 'health') {
        let healthVar = draft.variables.find((v) => v.name === 'Health');
        if (!healthVar) {
          healthVar = { id: makeId('var'), name: 'Health', type: 'number', defaultValue: 100, persistent: false, createdAt: Date.now() };
          nextVariables = [...draft.variables, healthVar];
        }
        const health = ensureParam('Health', 'float', 'variable', 100, healthVar.id);
        const hit = ensureParam('Hit', 'trigger', 'manual', false);
        const hitState = addState('Hit React', pick(/hit.*chest/i, /hit.*head/i, /hit/i), false);
        const deathState = addState('Death', pick(/death/i, /\bdie\b/i), false);
        if (hitState) {
          linkAny(hitState, [C(hit, '==', true)]);
          linkExit(hitState, homeId);
        }
        // Entering a "Death" state auto-triggers the ragdoll (see tickRuntime).
        if (deathState) linkAny(deathState, [C(health, '<=', 0)]);
        summary = 'health + hit reactions + death→ragdoll';
      } else if (kit === 'interactions') {
        const interacting = ensureParam('Interacting', 'bool', 'interacting', false);
        const interact = addState('Interact', pick(/^interact$/i, /pick.?up/i, /interact/i, /fixing/i), false);
        if (interact) {
          link(homeId, interact, [C(interacting, '==', true)]);
          linkExit(interact, homeId);
          summary = 'interactions (use / pick up)';
        }
      } else if (kit === 'emotes') {
        const emoting = ensureParam('Emoting', 'bool', 'emoting', false);
        const dance = addState('Emote', pick(/dance/i, /talk/i), true);
        if (dance) {
          link(homeId, dance, [C(emoting, '==', true)]);
          link(dance, homeId, [C(emoting, '==', false)]);
          summary = 'emote (dance/wave)';
        }
      }

      if (!summary) return draft;
      const nextController: AnimatorController = { ...controller, parameters: params, states, transitions };
      return {
        variables: nextVariables,
        animatorControllers: draft.animatorControllers.map((c) => (c.id === controller.id ? nextController : c)),
        isDirty: true,
      };
    });
    return summary || undefined;
  },
  createCollectibleCounter: (options = {}) => {
    const variableName = options.variableName?.trim() || 'Coins';
    const variableExpression = uiVariableRef(variableName);
    const label = options.label?.trim() || variableName;
    const amount = options.amount ?? 1;
    const name = options.name?.trim() || `${label} Pickup`;
    const color = options.color ?? '#FFD166';
    const expressionLabel = label.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    let variable = get().variables.find((item) => item.name === variableName);
    if (!variable) {
      const id = get().createVariable(variableName, 'number', false);
      get().updateVariable(id, { defaultValue: 0 });
      variable = get().variables.find((item) => item.id === id);
    }
    const variableId = variable?.id ?? get().createVariable(variableName, 'number', false);

    const findCounter = (element: UIElement): string | undefined => {
      if (
        element.bindings.some(
          (binding) =>
            binding.target === 'text' &&
            (binding.expression.includes(variableName) || binding.expression.includes(variableExpression)),
        )
      ) {
        return element.id;
      }
      for (const child of element.children) {
        const found = findCounter(child);
        if (found) return found;
      }
      return undefined;
    };

    let uiDocument =
      get().uiDocuments.find((doc) => doc.surface === 'screen' && doc.name.toLowerCase() === `${label.toLowerCase()} hud`) ??
      get().uiDocuments.find((doc) => doc.surface === 'screen' && doc.name.toLowerCase() === 'hud') ??
      get().uiDocuments.find((doc) => doc.surface === 'screen');
    if (!uiDocument) {
      const docId = get().createUIDocument(`${label} HUD`, 'screen');
      uiDocument = get().uiDocuments.find((doc) => doc.id === docId);
    }
    const uiDocumentId = uiDocument?.id ?? get().createUIDocument(`${label} HUD`, 'screen');
    get().updateUIDocument(uiDocumentId, { surface: 'screen', visibleOnStart: true });
    const currentDoc = get().uiDocuments.find((doc) => doc.id === uiDocumentId);
    let counterElementId = currentDoc ? findCounter(currentDoc.root) : undefined;
    if (!counterElementId) {
      counterElementId = get().addUIElement(uiDocumentId, undefined, 'text');
      get().updateUIElement(uiDocumentId, counterElementId, {
        name: `${label} Counter`,
        text: `${label}: 0`,
        style: {
          color: '#ffffff',
          fontSize: '20px',
          fontWeight: '700',
          custom: { textShadow: '0 2px 6px rgba(0,0,0,0.65)' },
        },
      });
      get().setUIBinding(uiDocumentId, counterElementId, 'text', `'${expressionLabel}: ' + ${variableExpression}`);
    }

    const objectId = get().createObjectWithProps('sphere', {
      name,
      position: options.position ?? [0, 1, 0],
      color,
      physics: { enabled: true, bodyType: 'fixed', collider: 'sphere', isTrigger: true, gravityScale: 0 },
    });
    get().updateTransform(objectId, 'scale', [0.35, 0.35, 0.35]);

    const { blueprintId } = get().createBlueprintNamed(`${name} Pickup Logic`, `Adds ${amount} to ${variableName} and removes the pickup.`);
    const triggerId = get().addGraphNodeToBlueprint(
      blueprintId,
      'Trigger Enter',
      'Events',
      { otherObjectId: options.playerObjectId },
      { x: 80, y: 180 },
    );
    const getId = get().addGraphNodeToBlueprint(blueprintId, 'Get Variable', 'Variables', { variableId }, { x: 80, y: 360 });
    const amountId = get().addGraphNodeToBlueprint(blueprintId, 'Number', 'Values', { numberValue: amount }, { x: 80, y: 500 });
    const addId = get().addGraphNodeToBlueprint(blueprintId, 'Add', 'Math', {}, { x: 320, y: 420 });
    const setId = get().addGraphNodeToBlueprint(blueprintId, 'Set Variable', 'Variables', { variableId }, { x: 560, y: 240 });
    const destroyId = get().addGraphNodeToBlueprint(blueprintId, 'Destroy Object', 'Runtime', {}, { x: 800, y: 240 });
    get().connectGraphNodes(blueprintId, triggerId, setId);
    get().connectGraphNodes(blueprintId, setId, destroyId);
    get().connectGraphNodes(blueprintId, getId, addId, 'value-out', 'a');
    get().connectGraphNodes(blueprintId, amountId, addId, 'value-out', 'b');
    get().connectGraphNodes(blueprintId, addId, setId, 'value-out', 'value');
    get().attachScript(objectId, blueprintId);
    get().setActiveBlueprint(blueprintId);

    return { objectId, blueprintId, variableId, uiDocumentId, counterElementId };
  },
  createCinematic: (name = 'New Cinematic', duration = 8) => {
    const id = makeId('cinematic');
    const sequence: CinematicSequence = {
      id,
      name,
      duration: Math.max(0.5, duration),
      frameRate: 24,
      skippable: true,
      actions: [],
      markers: [],
      createdAt: Date.now(),
    };
    set((state) => ({
      scenes: state.scenes.map((scene) =>
        scene.id === state.activeSceneId ? { ...scene, cinematics: [...(scene.cinematics ?? []), sequence] } : scene,
      ),
      activeCinematicId: id,
      isDirty: true,
    }));
    return id;
  },
  updateCinematic: (id, patch) =>
    set((state) => ({
      scenes: state.scenes.map((scene) => ({
        ...scene,
        cinematics: (scene.cinematics ?? []).map((cinematic) =>
          cinematic.id === id ? { ...cinematic, ...stripUndefined(patch), duration: Math.max(0.5, patch.duration ?? cinematic.duration) } : cinematic,
        ),
      })),
      isDirty: true,
    })),
  duplicateCinematicTake: (id) => {
    const source = get().activeScene()?.cinematics?.find((cinematic) => cinematic.id === id);
    if (!source) return undefined;
    const takeNumber =
      Math.max(0, ...(get().activeScene()?.cinematics ?? []).filter((cinematic) => (cinematic.takeOf ?? cinematic.id) === (source.takeOf ?? source.id)).map((cinematic) => cinematic.takeNumber ?? 0)) + 1;
    const nextId = makeId('cinematic');
    const next: CinematicSequence = {
      ...source,
      id: nextId,
      name: `${source.name} Take ${takeNumber}`,
      takeOf: source.takeOf ?? source.id,
      takeNumber,
      actions: source.actions.map((action) => ({ ...action, id: makeId('caction') })),
      markers: (source.markers ?? []).map((marker) => ({ ...marker, id: makeId('cmark') })),
      createdAt: Date.now(),
    };
    set((state) => ({
      scenes: state.scenes.map((scene) =>
        scene.id === state.activeSceneId ? { ...scene, cinematics: [...(scene.cinematics ?? []), next] } : scene,
      ),
      activeCinematicId: nextId,
      isDirty: true,
    }));
    return nextId;
  },
  addCinematicMarker: (cinematicId, marker) => {
    const id = makeId('cmark');
    set((state) => ({
      scenes: state.scenes.map((scene) => ({
        ...scene,
        cinematics: (scene.cinematics ?? []).map((cinematic) =>
          cinematic.id === cinematicId
            ? {
                ...cinematic,
                markers: [
                  ...(cinematic.markers ?? []),
                  { id, time: Math.max(0, marker.time), label: marker.label?.trim() || `Marker ${(cinematic.markers?.length ?? 0) + 1}`, color: marker.color, determinismFence: marker.determinismFence },
                ].sort((a, b) => a.time - b.time),
              }
            : cinematic,
        ),
      })),
      isDirty: true,
    }));
    return get().activeScene()?.cinematics?.some((cinematic) => cinematic.id === cinematicId) ? id : undefined;
  },
  updateCinematicMarker: (cinematicId, markerId, patch) =>
    set((state) => ({
      scenes: state.scenes.map((scene) => ({
        ...scene,
        cinematics: (scene.cinematics ?? []).map((cinematic) =>
          cinematic.id === cinematicId
            ? {
                ...cinematic,
                markers: (cinematic.markers ?? [])
                  .map((marker) => (marker.id === markerId ? { ...marker, ...stripUndefined(patch), time: Math.max(0, patch.time ?? marker.time) } : marker))
                  .sort((a, b) => a.time - b.time),
              }
            : cinematic,
        ),
      })),
      isDirty: true,
    })),
  removeCinematicMarker: (cinematicId, markerId) =>
    set((state) => ({
      scenes: state.scenes.map((scene) => ({
        ...scene,
        cinematics: (scene.cinematics ?? []).map((cinematic) =>
          cinematic.id === cinematicId ? { ...cinematic, markers: (cinematic.markers ?? []).filter((marker) => marker.id !== markerId) } : cinematic,
        ),
      })),
      isDirty: true,
    })),
  setCinematicLook: (id, patch) =>
    set((state) => {
      let nextLook: CinematicLook | undefined;
      const scenes = state.scenes.map((scene) => ({
        ...scene,
        cinematics: (scene.cinematics ?? []).map((cinematic) => {
          if (cinematic.id !== id) return cinematic;
          const merged = stripUndefined({ ...(cinematic.look ?? {}), ...patch }) as CinematicLook;
          nextLook = merged;
          return { ...cinematic, look: merged };
        }),
      }));
      return {
        scenes,
        // Live-update the active runtime/preview look so the overlay reflects edits immediately.
        runtimeCinematicLook: state.runtimeCinematic?.sequenceId === id ? nextLook : state.runtimeCinematicLook,
        editorCinematicPreviewLook: state.editorCinematicPreview?.sequenceId === id ? nextLook : state.editorCinematicPreviewLook,
        isDirty: true,
      };
    }),
  deleteCinematic: (id) =>
    set((state) => ({
      scenes: state.scenes.map((scene) => ({
        ...scene,
        cinematics: (scene.cinematics ?? []).filter((cinematic) => cinematic.id !== id),
      })),
      activeCinematicId: state.activeCinematicId === id ? '' : state.activeCinematicId,
      runtimeCinematic: state.runtimeCinematic?.sequenceId === id ? undefined : state.runtimeCinematic,
      runtimeCinematicCamera: state.runtimeCinematic?.sequenceId === id ? undefined : state.runtimeCinematicCamera,
      runtimeCinematicFade: state.runtimeCinematic?.sequenceId === id ? undefined : state.runtimeCinematicFade,
      runtimeCinematicLook: state.runtimeCinematic?.sequenceId === id ? undefined : state.runtimeCinematicLook,
      editorCinematicPreview: state.editorCinematicPreview?.sequenceId === id ? undefined : state.editorCinematicPreview,
      editorCinematicPreviewCamera: state.editorCinematicPreview?.sequenceId === id ? undefined : state.editorCinematicPreviewCamera,
      editorCinematicPreviewFade: state.editorCinematicPreview?.sequenceId === id ? undefined : state.editorCinematicPreviewFade,
      editorCinematicPreviewLook: state.editorCinematicPreview?.sequenceId === id ? undefined : state.editorCinematicPreviewLook,
      editorCinematicPreviewTransforms: state.editorCinematicPreview?.sequenceId === id ? {} : state.editorCinematicPreviewTransforms,
      editorCinematicPreviewHidden: state.editorCinematicPreview?.sequenceId === id ? [] : state.editorCinematicPreviewHidden,
      editorCinematicPreviewMaterials: state.editorCinematicPreview?.sequenceId === id ? {} : state.editorCinematicPreviewMaterials,
      isDirty: true,
    })),
  setActiveCinematic: (id) =>
    set((state) =>
      state.editorCinematicPreview && state.editorCinematicPreview.sequenceId !== id
        ? {
            activeCinematicId: id,
            editorCinematicPreview: undefined,
            editorCinematicPreviewCamera: undefined,
            editorCinematicPreviewFade: undefined,
            editorCinematicPreviewTransforms: {},
            editorCinematicPreviewHidden: [],
            editorCinematicPreviewMaterials: {},
          }
        : { activeCinematicId: id },
    ),
  addCinematicAction: (cinematicId, action) => {
    const actionId = makeId('caction');
    set((state) => {
      let found = false;
      const scenes = state.scenes.map((scene) => ({
        ...scene,
        cinematics: (scene.cinematics ?? []).map((cinematic) => {
          if (cinematic.id !== cinematicId) return cinematic;
          found = true;
          const nextAction: CinematicAction = { ...action, id: actionId, time: Math.max(0, action.time) };
          const actions = [...cinematic.actions, nextAction].sort((a, b) => a.time - b.time);
          const duration = Math.max(cinematic.duration, nextAction.time + (nextAction.duration ?? 0.1));
          return { ...cinematic, actions, duration };
        }),
      }));
      return found ? { scenes, isDirty: true } : state;
    });
    return get().activeScene()?.cinematics?.some((cinematic) => cinematic.id === cinematicId) ? actionId : undefined;
  },
  updateCinematicAction: (cinematicId, actionId, patch) =>
    set((state) => ({
      scenes: state.scenes.map((scene) => ({
        ...scene,
        cinematics: (scene.cinematics ?? []).map((cinematic) =>
          cinematic.id === cinematicId
            ? {
                ...cinematic,
                actions: cinematic.actions
                  .map((action) => (action.id === actionId ? { ...action, ...stripUndefined(patch), time: Math.max(0, patch.time ?? action.time) } : action))
                  .sort((a, b) => a.time - b.time),
              }
            : cinematic,
        ),
      })),
      isDirty: true,
    })),
  removeCinematicAction: (cinematicId, actionId) =>
    set((state) => ({
      scenes: state.scenes.map((scene) => ({
        ...scene,
        cinematics: (scene.cinematics ?? []).map((cinematic) =>
          cinematic.id === cinematicId ? { ...cinematic, actions: cinematic.actions.filter((action) => action.id !== actionId) } : cinematic,
        ),
      })),
      isDirty: true,
    })),
  addCinematicShot: (cinematicId, shot) => {
    const cinematic = get().activeScene()?.cinematics?.find((item) => item.id === cinematicId);
    if (!cinematic) return undefined;
    const shotCount = cinematic.actions.filter((action) => action.type === 'camera').length;
    const time = Number(Math.max(0, shot.time).toFixed(3));
    return get().addCinematicAction(cinematicId, {
      type: 'camera',
      time,
      duration: Math.max(0.5, shot.duration ?? Math.max(1.5, cinematic.duration - time)),
      label: shot.label ?? `Shot ${shotCount + 1}`,
      ease: 'smooth',
      position: [...shot.position],
      lookAt: [...shot.lookAt],
      fov: shot.fov ?? 50,
      // Shot-list editing defaults to hard cuts. Set blend > 0 for a deliberate smooth camera blend.
      blend: shot.blend ?? 0,
      focusDistance: shot.focusDistance,
      aperture: shot.aperture,
    });
  },
  addCinematicTransition: (cinematicId, opts) => {
    const cinematic = get().activeScene()?.cinematics?.find((item) => item.id === cinematicId);
    if (!cinematic) return undefined;
    const time = Math.max(0, opts.time ?? 0);
    const duration = Math.max(0.05, opts.duration ?? 0.6);
    // cut / crossfade are camera-blend operations on the INCOMING shot (the one at/after the playhead).
    if (opts.style === 'cut' || opts.style === 'crossfade') {
      const cams = cinematic.actions.filter((action) => action.type === 'camera').sort((a, b) => a.time - b.time);
      if (!cams.length) return undefined;
      const incoming = cams.find((cam) => cam.time >= time - 0.001) ?? cams[cams.length - 1];
      get().updateCinematicAction(cinematicId, incoming.id, { blend: opts.style === 'crossfade' ? duration : 0 });
      return incoming.id;
    }
    // fade / flash / wipe are full-frame dip overlays centered on the cut point.
    const color = opts.style === 'flash' ? '#ffffff' : opts.color ?? '#000000';
    const label = opts.style === 'wipe' ? 'Wipe' : opts.style === 'flash' ? 'Flash' : 'Fade transition';
    return get().addCinematicAction(cinematicId, {
      type: 'fade',
      time: Math.max(0, time - duration / 2),
      duration,
      label,
      fadeFrom: 0,
      fadeTo: 1,
      fadeColor: color,
      fadeDip: true,
      fadeWipe: opts.style === 'wipe' ? opts.direction ?? 'right' : undefined,
      ease: 'smooth',
    });
  },
  addCinematicCameraKeyframe: (cinematicId, time, pose) => {
    const cinematic = get().activeScene()?.cinematics?.find((item) => item.id === cinematicId);
    if (!cinematic) return undefined;
    const frame: CinematicCameraKeyframe = {
      time: Number(Math.max(0, time).toFixed(3)),
      position: [...pose.position],
      lookAt: [...pose.lookAt],
      fov: Math.round(pose.fov),
      focusDistance: pose.focusDistance,
      aperture: pose.aperture,
    };
    const track = cinematic.actions.find((action) => action.type === 'camera' && action.keyframes?.length);
    let actionId = track?.id;
    if (!track) {
      actionId = get().addCinematicAction(cinematicId, { type: 'camera', time: frame.time, duration: 0.5, label: 'Camera track', ease: 'smooth', keyframes: [frame] });
    }
    if (!actionId) return undefined;
    const existing = track?.keyframes ?? [frame];
    const merged = [...existing.filter((keyframe) => Math.abs(keyframe.time - frame.time) > 0.06), frame].sort((a, b) => a.time - b.time);
    const minTime = Math.min(0, ...merged.map((keyframe) => keyframe.time));
    const maxTime = Math.max(0.5, ...merged.map((keyframe) => keyframe.time));
    get().updateCinematicAction(cinematicId, actionId, { keyframes: merged, time: minTime, duration: Math.max(0.5, maxTime - minTime) });
    const preview = get().editorCinematicPreview;
    if (preview?.sequenceId === cinematicId) get().previewCinematic(cinematicId, preview.time);
    return actionId;
  },
  addCinematicTransformKeyframe: (cinematicId, objectId, time, transform) => {
    const cinematic = get().activeScene()?.cinematics?.find((item) => item.id === cinematicId);
    if (!cinematic) return undefined;
    const object = selectActiveObjects(get()).find((item) => item.id === objectId);
    const pose = transform ?? object?.transform;
    if (!pose) return undefined;
    const frame: CinematicTransformKeyframe = {
      time: Number(Math.max(0, time).toFixed(3)),
      position: [...pose.position],
      rotation: [...pose.rotation],
      scale: [...pose.scale],
    };
    const track = cinematic.actions.find((action) => action.type === 'transform' && action.objectId === objectId && action.transformKeyframes);
    let actionId = track?.id;
    if (!track) {
      actionId = get().addCinematicAction(cinematicId, {
        type: 'transform',
        objectId,
        time: frame.time,
        duration: 0.5,
        label: `Animate ${object?.name ?? 'object'}`,
        ease: 'smooth',
        transformKeyframes: [frame],
      });
    }
    if (!actionId) return undefined;
    const existing = track?.transformKeyframes ?? [frame];
    const merged = [...existing.filter((keyframe) => Math.abs(keyframe.time - frame.time) > 0.06), frame].sort((a, b) => a.time - b.time);
    const minTime = Math.min(0, ...merged.map((keyframe) => keyframe.time));
    const maxTime = Math.max(0.5, ...merged.map((keyframe) => keyframe.time));
    get().updateCinematicAction(cinematicId, actionId, { transformKeyframes: merged, time: minTime, duration: Math.max(0.5, maxTime - minTime) });
    const preview = get().editorCinematicPreview;
    if (preview?.sequenceId === cinematicId) get().previewCinematic(cinematicId, preview.time);
    return actionId;
  },
  setCinematicRecording: (recording) =>
    set((state) => {
      if (!recording) return { cinematicRecording: false };
      // Turning Record on implies an active preview so the playhead has a position to key against.
      const cinematicId = state.activeCinematicId || state.scenes.find((scene) => scene.id === state.activeSceneId)?.cinematics?.[0]?.id;
      if (cinematicId && !state.editorCinematicPreview) {
        queueMicrotask(() => get().previewCinematic(cinematicId, 0));
      }
      return { cinematicRecording: true };
    }),
  selectCinematicKeyframe: (actionId, index) => {
    if (!actionId || index == null) {
      set({ selectedCinematicKeyframe: undefined });
      return;
    }
    set({ selectedCinematicKeyframe: { actionId, index } });
    // Pose the scene at this keyframe's time so editing it shows the right moment.
    const cinematic = get().activeScene()?.cinematics?.find((item) => item.actions.some((action) => action.id === actionId));
    const action = cinematic?.actions.find((item) => item.id === actionId);
    // index -1 = a STATIC camera shot (no keyframes array); pose the scene at the shot's own start time.
    if (cinematic && index === -1 && action) {
      get().previewCinematic(cinematic.id, action.time);
      return;
    }
    const frame = action?.type === 'camera' ? action.keyframes?.[index] : action?.type === 'transform' ? action.transformKeyframes?.[index] : undefined;
    if (cinematic && frame) get().previewCinematic(cinematic.id, frame.time);
  },
  moveCinematicKeyframe: (actionId, index, position) => {
    const cinematic = get().activeScene()?.cinematics?.find((item) => item.actions.some((action) => action.id === actionId));
    const action = cinematic?.actions.find((item) => item.id === actionId);
    if (!cinematic || !action) return;
    if (index === -1 && action.type === 'camera') {
      // Static shot: move the shot's own framing position.
      get().updateCinematicAction(cinematic.id, actionId, { position });
    } else if (action.type === 'camera' && action.keyframes?.[index]) {
      const keyframes = action.keyframes.map((keyframe, i) => (i === index ? { ...keyframe, position } : keyframe));
      get().updateCinematicAction(cinematic.id, actionId, { keyframes });
    } else if (action.type === 'transform' && action.transformKeyframes?.[index]) {
      const transformKeyframes = action.transformKeyframes.map((keyframe, i) => (i === index ? { ...keyframe, position } : keyframe));
      get().updateCinematicAction(cinematic.id, actionId, { transformKeyframes });
    } else {
      return;
    }
    const preview = get().editorCinematicPreview;
    if (preview?.sequenceId === cinematic.id) get().previewCinematic(cinematic.id, preview.time);
  },
  aimCinematicKeyframe: (actionId, index, lookAt) => {
    const cinematic = get().activeScene()?.cinematics?.find((item) => item.actions.some((action) => action.id === actionId));
    const action = cinematic?.actions.find((item) => item.id === actionId);
    if (!cinematic || action?.type !== 'camera') return;
    if (index === -1) {
      // Static shot: re-aim the shot's own framing.
      get().updateCinematicAction(cinematic.id, actionId, { lookAt });
      const preview = get().editorCinematicPreview;
      if (preview?.sequenceId === cinematic.id) get().previewCinematic(cinematic.id, preview.time);
      return;
    }
    if (!action.keyframes?.[index]) return;
    const keyframes = action.keyframes.map((keyframe, i) => (i === index ? { ...keyframe, lookAt } : keyframe));
    get().updateCinematicAction(cinematic.id, actionId, { keyframes });
    const preview = get().editorCinematicPreview;
    if (preview?.sequenceId === cinematic.id) get().previewCinematic(cinematic.id, preview.time);
  },
  previewCinematic: (cinematicId, time) =>
    set((state) => {
      if (state.isPlaying) return state;
      const scene = state.scenes.find((item) => item.id === state.activeSceneId);
      const sequence = scene?.cinematics?.find((cinematic) => cinematic.id === cinematicId);
      if (!sequence) return state;
      const previewTime = Math.min(Math.max(time, 0), sequence.duration);
      const objects = scene?.objects ?? [];
      const sequences = scene?.cinematics ?? [];
      return {
        editorCinematicPreview: { sequenceId: cinematicId, time: previewTime },
        editorCinematicPreviewCamera: cinematicCameraAt(sequence, objects, previewTime, undefined, sequences),
        editorCinematicPreviewFade: cinematicFadeAt(sequence, previewTime, undefined, sequences),
        editorCinematicPreviewLook: sequence.look,
        editorCinematicPreviewText: cinematicTextAt(sequence, previewTime, sequences),
        editorCinematicPreviewTransforms: cinematicTransformsAt(sequence, objects, previewTime, sequences),
        editorCinematicPreviewHidden: cinematicHiddenAt(sequence, previewTime, sequences),
        editorCinematicPreviewMaterials: cinematicMaterialsAt(sequence, objects, previewTime, sequences),
      };
    }),
  clearCinematicPreview: () =>
    set((state) =>
      state.editorCinematicPreview || state.selectedCinematicKeyframe
        ? {
            editorCinematicPreview: undefined,
            editorCinematicPreviewCamera: undefined,
            editorCinematicPreviewFade: undefined,
            editorCinematicPreviewLook: undefined,
            editorCinematicPreviewText: undefined,
            editorCinematicPreviewTransforms: {},
            editorCinematicPreviewHidden: [],
            editorCinematicPreviewMaterials: {},
            selectedCinematicKeyframe: undefined,
          }
        : state,
    ),
  playCinematic: (cinematicId) => {
    const current = get();
    if (!current.isPlaying) {
      current.setPlaying(true);
      if (!get().isPlaying) return;
    }

    set((state) => {
      const scene = state.scenes.find((item) => item.id === state.activeSceneId);
      const sequence = scene?.cinematics?.find((cinematic) => cinematic.id === cinematicId);
      if (!sequence) return state;
      const sequences = scene?.cinematics ?? [];
      return {
        runtimeCinematic: { sequenceId: cinematicId, time: 0, firedActionIds: [], spawnedObjectIds: [] },
        runtimeCinematicCamera: initialCinematicCamera(sequence, scene?.objects ?? [], sequences),
        runtimeCinematicFade: initialCinematicFade(sequence, sequences),
        runtimeCinematicLook: sequence.look,
        runtimeCinematicText: cinematicTextAt(sequence, 0, sequences),
      };
    });
  },
  stopCinematic: () =>
    set((state) => {
      const spawnedIds = new Set(state.runtimeCinematic?.spawnedObjectIds ?? []);
      return {
        scenes: spawnedIds.size
          ? state.scenes.map((scene) => (scene.id === state.activeSceneId ? { ...scene, objects: scene.objects.filter((object) => !spawnedIds.has(object.id)) } : scene))
          : state.scenes,
        runtimeCinematic: undefined,
        runtimeCinematicCamera: undefined,
        runtimeCinematicFade: undefined,
        runtimeCinematicLook: undefined,
        runtimeCinematicText: undefined,
      };
    }),
  attachScript: (id, nextBlueprintId) =>
    set((state) => {
      const blueprint = state.blueprints.find((item) => item.id === (nextBlueprintId ?? state.activeBlueprintId));
      if (!blueprint) return state;
      return {
        ...mapActiveSceneObjects(state, (objects) =>
          objects.map((object) =>
            object.id === id
              ? {
                  ...object,
                  script: { blueprintId: blueprint.id, graphId: blueprint.graphId, enabled: true },
                  // Seed this instance's own copy of the blueprint's declared variables (keep existing values).
                  variables: seedBlueprintInstanceVars(object.variables, blueprint),
                }
              : object,
          ),
        ),
        activeBlueprintId: blueprint.id,
      };
    }),
  addBlueprintVariable: (blueprintId, opts = {}) => {
    const blueprint = get().blueprints.find((b) => b.id === blueprintId);
    if (!blueprint) return undefined;
    const type = opts.type ?? 'number';
    const id = makeId('bpvar');
    const existing = blueprint.variables ?? [];
    const variable: BlueprintVariable = {
      id,
      name: opts.name?.trim() || `Var ${existing.length + 1}`,
      type,
      defaultValue: opts.defaultValue !== undefined ? coerceGraphValue(opts.defaultValue, type) : defaultValueForType(type),
    };
    set((state) => ({
      blueprints: state.blueprints.map((b) => (b.id === blueprintId ? { ...b, variables: [...existing, variable] } : b)),
      // Seed the new variable's default onto every object already running this blueprint (don't clobber values).
      ...mapActiveSceneObjects(state, (objects) =>
        objects.map((object) =>
          object.script?.blueprintId === blueprintId && object.variables?.[variable.name] === undefined
            ? { ...object, variables: { ...(object.variables ?? {}), [variable.name]: cloneGraphValue(variable.defaultValue) } }
            : object,
        ),
      ),
      isDirty: true,
    }));
    return id;
  },
  updateBlueprintVariable: (blueprintId, variableId, patch) =>
    set((state) => {
      const blueprint = state.blueprints.find((b) => b.id === blueprintId);
      const current = blueprint?.variables?.find((v) => v.id === variableId);
      if (!blueprint || !current) return state;
      const type = patch.type ?? current.type;
      const nextName = patch.name?.trim() || current.name;
      const defaultValue =
        patch.defaultValue !== undefined ? coerceGraphValue(patch.defaultValue, type) : coerceGraphValue(current.defaultValue, type);
      const renamed = nextName !== current.name;
      return {
        blueprints: state.blueprints.map((b) =>
          b.id === blueprintId
            ? { ...b, variables: (b.variables ?? []).map((v) => (v.id === variableId ? { ...v, name: nextName, type, defaultValue } : v)) }
            : b,
        ),
        // Carry a rename across to instances that hold the old key (preserve their per-instance value).
        ...(renamed
          ? mapActiveSceneObjects(state, (objects) =>
              objects.map((object) => {
                if (object.script?.blueprintId !== blueprintId || object.variables?.[current.name] === undefined) return object;
                const { [current.name]: held, ...rest } = object.variables;
                return { ...object, variables: { ...rest, [nextName]: held } };
              }),
            )
          : {}),
        isDirty: true,
      };
    }),
  removeBlueprintVariable: (blueprintId, variableId) =>
    set((state) => {
      const blueprint = state.blueprints.find((b) => b.id === blueprintId);
      const removed = blueprint?.variables?.find((v) => v.id === variableId);
      if (!blueprint || !removed) return state;
      return {
        blueprints: state.blueprints.map((b) =>
          b.id === blueprintId ? { ...b, variables: (b.variables ?? []).filter((v) => v.id !== variableId) } : b,
        ),
        isDirty: true,
      };
    }),
  detachScript: (id) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) => (object.id === id ? { ...object, script: undefined } : object)),
      ),
    ),
  setActiveBlueprint: (activeBlueprintId) => set({ activeBlueprintId, selectedGraphNodeId: undefined }),
  createBlueprint: () =>
    set((state) => {
      const nextIndex = state.blueprints.length + 1;
      const newGraphId = makeId('graph');
      const newBlueprintId = makeId('blueprint');
      const blueprint: ScriptBlueprint = {
        id: newBlueprintId,
        name: `Blueprint ${nextIndex}`,
        description: 'Reusable Blueprint asset.',
        graphId: newGraphId,
        color: '#3DDC97',
        createdAt: Date.now(),
      };
      const graph: ProjectGraph = {
        id: newGraphId,
        name: blueprint.name,
        nodes: [
          {
            id: makeId('node'),
            type: 'nodeforge',
            position: { x: 80, y: 80 },
            data: makeNodeData('Start', 'Events', { hasInput: false }),
          },
          {
            id: makeId('node'),
            type: 'nodeforge',
            position: { x: 280, y: 80 },
            data: makeNodeData('Update', 'Events'),
          },
        ],
        edges: [],
      };

      return {
        blueprints: [...state.blueprints, blueprint],
        graphs: [...state.graphs, graph],
        activeBlueprintId: newBlueprintId,
        selectedGraphNodeId: graph.nodes[0]?.id,
        isDirty: true,
      };
    }),
  createBlueprintNamed: (name, description, folderId) => {
    const newGraphId = makeId('graph');
    const newBlueprintId = makeId('blueprint');
    set((state) => {
      const blueprint: ScriptBlueprint = {
        id: newBlueprintId,
        name: name ?? `Blueprint ${state.blueprints.length + 1}`,
        description: description ?? 'Reusable Blueprint asset.',
        graphId: newGraphId,
        color: '#3DDC97',
        folderId,
        createdAt: Date.now(),
      };
      const graph: ProjectGraph = {
        id: newGraphId,
        name: blueprint.name,
        nodes: [
          {
            id: makeId('node'),
            type: 'nodeforge',
            position: { x: 80, y: 80 },
            data: makeNodeData('Start', 'Events', { hasInput: false }),
          },
          {
            id: makeId('node'),
            type: 'nodeforge',
            position: { x: 280, y: 80 },
            data: makeNodeData('Update', 'Events'),
          },
        ],
        edges: [],
      };

      return {
        blueprints: [...state.blueprints, blueprint],
        graphs: [...state.graphs, graph],
        activeBlueprintId: newBlueprintId,
        selectedGraphNodeId: undefined,
        isDirty: true,
      };
    });
    return { blueprintId: newBlueprintId, graphId: newGraphId };
  },
  openObjectScript: (objectId) => {
    const object = selectActiveObjects(get()).find((item) => item.id === objectId);
    if (!object) return undefined;
    // Already scripted → just open that blueprint in the Scripting panel.
    if (object.script) {
      set({ activeBlueprintId: object.script.blueprintId, selectedObjectId: objectId, selectedGraphNodeId: undefined });
      return object.script.blueprintId;
    }
    // No script yet → create one for this object, attach it, and open it.
    const { blueprintId } = get().createBlueprintNamed(`${object.name} Script`, `Script for ${object.name}.`);
    get().attachScript(objectId, blueprintId);
    set({ selectedObjectId: objectId });
    return blueprintId;
  },
  createFolder: (name, parentId) => {
    const id = makeId('folder');
    set((state) => ({
      folders: [...state.folders, { id, name: name ?? 'New Folder', parentId }],
      isDirty: true,
    }));
    return id;
  },
  renameFolder: (id, name) =>
    set((state) => ({
      folders: state.folders.map((folder) => (folder.id === id ? { ...folder, name } : folder)),
      isDirty: true,
    })),
  deleteFolder: (id) =>
    set((state) => {
      const folder = state.folders.find((item) => item.id === id);
      if (!folder) return state;
      // Move direct children (sub-folders, assets, blueprints) up to this folder's parent — no recursive loss.
      const parentId = folder.parentId;
      return {
        folders: state.folders
          .filter((item) => item.id !== id)
          .map((item) => (item.parentId === id ? { ...item, parentId } : item)),
        assets: state.assets.map((asset) => (asset.folderId === id ? { ...asset, folderId: parentId } : asset)),
        dataAssets: state.dataAssets.map((asset) => (asset.folderId === id ? { ...asset, folderId: parentId } : asset)),
        materials: state.materials.map((material) =>
          material.folderId === id ? { ...material, folderId: parentId } : material,
        ),
        blueprints: state.blueprints.map((blueprint) =>
          blueprint.folderId === id ? { ...blueprint, folderId: parentId } : blueprint,
        ),
        prefabs: state.prefabs.map((prefab) =>
          prefab.folderId === id ? { ...prefab, folderId: parentId } : prefab,
        ),
        isDirty: true,
      };
    }),
  moveToFolder: (kind, id, folderId) =>
    set((state) =>
      kind === 'asset'
        ? {
            assets: state.assets.map((asset) => (asset.id === id ? { ...asset, folderId } : asset)),
            isDirty: true,
          }
        : kind === 'dataAsset'
          ? {
              dataAssets: state.dataAssets.map((asset) => (asset.id === id ? { ...asset, folderId } : asset)),
              isDirty: true,
            }
        : kind === 'material'
          ? {
              materials: state.materials.map((material) => (material.id === id ? { ...material, folderId } : material)),
              isDirty: true,
            }
        : kind === 'particleSystem'
          ? {
              particleSystems: state.particleSystems.map((system) => (system.id === id ? { ...system, folderId } : system)),
              isDirty: true,
            }
        : kind === 'uiDocument'
          ? {
              uiDocuments: state.uiDocuments.map((doc) => (doc.id === id ? { ...doc, folderId } : doc)),
              isDirty: true,
            }
        : kind === 'prefab'
          ? {
              prefabs: state.prefabs.map((prefab) => (prefab.id === id ? { ...prefab, folderId } : prefab)),
              isDirty: true,
            }
        : {
            blueprints: state.blueprints.map((blueprint) =>
              blueprint.id === id ? { ...blueprint, folderId } : blueprint,
            ),
            isDirty: true,
          },
    ),
  renameBlueprint: (id, name) =>
    set((state) => {
      const blueprint = state.blueprints.find((item) => item.id === id);
      return {
        blueprints: state.blueprints.map((item) => (item.id === id ? { ...item, name } : item)),
        graphs: state.graphs.map((graph) => (graph.id === blueprint?.graphId ? { ...graph, name } : graph)),
        isDirty: true,
      };
    }),
  deleteBlueprint: (id) =>
    set((state) => {
      const blueprint = state.blueprints.find((item) => item.id === id);
      if (!blueprint) return state;
      const remaining = state.blueprints.filter((item) => item.id !== id);
      return {
        blueprints: remaining,
        graphs: state.graphs.filter((graph) => graph.id !== blueprint.graphId),
        activeBlueprintId: state.activeBlueprintId === id ? remaining[0]?.id ?? '' : state.activeBlueprintId,
        // Detach this blueprint from any object in any scene that referenced it.
        scenes: state.scenes.map((scene) => ({
          ...scene,
          objects: scene.objects.map((object) =>
            object.script?.blueprintId === id ? { ...object, script: undefined } : object,
          ),
        })),
        // CASCADE: also detach from objects captured inside PREFABS — otherwise every future
        // instantiation ships a dead script reference whose logic silently never runs.
        prefabs: state.prefabs.map((prefab) =>
          prefab.objects.some((object) => object.script?.blueprintId === id)
            ? {
                ...prefab,
                objects: prefab.objects.map((object) =>
                  object.script?.blueprintId === id ? { ...object, script: undefined } : object,
                ),
              }
            : prefab,
        ),
        isDirty: true,
      };
    }),
  renameAsset: (id, name) =>
    set((state) => ({
      assets: state.assets.map((asset) => (asset.id === id ? { ...asset, name } : asset)),
      isDirty: true,
    })),
  createVariable: (name, type = 'number', persistent = true) => {
    const id = makeId('var');
    set((state) => ({
      variables: [
        ...state.variables,
        {
          id,
          name: name ?? `Variable ${state.variables.length + 1}`,
          type,
          defaultValue: defaultValueForType(type),
          persistent,
          createdAt: Date.now(),
        },
      ],
      isDirty: true,
    }));
    return id;
  },
  updateVariable: (id, patch) =>
    set((state) => ({
      variables: state.variables.map((variable) => {
        if (variable.id !== id) return variable;
        const type = patch.type ?? variable.type;
        const defaultValue =
          patch.defaultValue !== undefined
            ? coerceGraphValue(patch.defaultValue, type)
            : patch.type
              ? coerceGraphValue(variable.defaultValue, type)
              : variable.defaultValue;
        return {
          ...variable,
          ...patch,
          type,
          defaultValue,
        };
      }),
      runtimeVariableValues:
        patch.defaultValue !== undefined || patch.type
          ? Object.fromEntries(
              Object.entries(state.runtimeVariableValues).map(([variableId, value]) => [
                variableId,
                variableId === id
                  ? coerceGraphValue(
                      patch.defaultValue ?? value,
                      patch.type ?? state.variables.find((variable) => variable.id === id)?.type ?? 'number',
                    )
                  : value,
              ]),
            )
          : state.runtimeVariableValues,
      isDirty: true,
    })),
  deleteVariable: (id) =>
    set((state) => ({
      variables: state.variables.filter((variable) => variable.id !== id),
      runtimeVariableValues: Object.fromEntries(
        Object.entries(state.runtimeVariableValues).filter(([variableId]) => variableId !== id),
      ),
      graphs: state.graphs.map((graph) => ({
        ...graph,
        nodes: graph.nodes.map((node) =>
          node.data.variableId === id ? { ...node, data: { ...node.data, variableId: undefined } } : node,
        ),
      })),
      isDirty: true,
    })),
  createDataAsset: (name, folderId) => {
    const id = makeId('data');
    const columnId = makeId('col');
    const rowId = makeId('row');
    set((state) => ({
      dataAssets: [
        ...state.dataAssets,
        {
          id,
          name: name ?? `Data Asset ${state.dataAssets.length + 1}`,
          folderId,
          columns: [{ id: columnId, name: 'Value', type: 'string' }],
          rows: [{ id: rowId, key: 'row_1', values: { [columnId]: 'Text' } }],
          createdAt: Date.now(),
        },
      ],
      isDirty: true,
    }));
    return id;
  },
  renameDataAsset: (id, name) =>
    set((state) => ({
      dataAssets: state.dataAssets.map((table) => (table.id === id ? { ...table, name } : table)),
      isDirty: true,
    })),
  deleteDataAsset: (id) =>
    set((state) => ({
      dataAssets: state.dataAssets.filter((table) => table.id !== id),
      graphs: state.graphs.map((graph) => ({
        ...graph,
        nodes: graph.nodes.map((node) =>
          node.data.tableId === id
            ? { ...node, data: normalizeNodeData({ ...node.data, tableId: undefined, rowKey: undefined, columnId: undefined }) }
            : node,
        ),
      })),
      isDirty: true,
    })),
  addDataAssetColumn: (tableId, name, type = 'string') => {
    const id = makeId('col');
    set((state) => ({
      dataAssets: state.dataAssets.map((table) =>
        table.id === tableId
          ? {
              ...table,
              columns: [...table.columns, { id, name: name ?? `Column ${table.columns.length + 1}`, type }],
              rows: table.rows.map((row) => ({
                ...row,
                values: { ...row.values, [id]: defaultValueForType(type) },
              })),
            }
          : table,
      ),
      isDirty: true,
    }));
    return id;
  },
  updateDataAssetColumn: (tableId, columnId, patch) =>
    set((state) => ({
      dataAssets: state.dataAssets.map((table) => {
        if (table.id !== tableId) return table;
        const current = table.columns.find((column) => column.id === columnId);
        const nextType = patch.type ?? current?.type ?? 'string';
        return {
          ...table,
          columns: table.columns.map((column) =>
            column.id === columnId ? { ...column, ...patch, type: nextType } : column,
          ),
          rows: table.rows.map((row) => ({
            ...row,
            values:
              patch.type && current
                ? { ...row.values, [columnId]: coerceGraphValue(row.values[columnId], nextType) }
                : row.values,
          })),
        };
      }),
      isDirty: true,
    })),
  deleteDataAssetColumn: (tableId, columnId) =>
    set((state) => ({
      dataAssets: state.dataAssets.map((table) =>
        table.id === tableId
          ? {
              ...table,
              columns: table.columns.filter((column) => column.id !== columnId),
              rows: table.rows.map((row) => {
                const { [columnId]: _deleted, ...values } = row.values;
                return { ...row, values };
              }),
            }
          : table,
      ),
      graphs: state.graphs.map((graph) => ({
        ...graph,
        nodes: graph.nodes.map((node) =>
          node.data.tableId === tableId && node.data.columnId === columnId
            ? { ...node, data: normalizeNodeData({ ...node.data, columnId: undefined }) }
            : node,
        ),
      })),
      isDirty: true,
    })),
  addDataAssetRow: (tableId, key) => {
    const id = makeId('row');
    set((state) => ({
      dataAssets: state.dataAssets.map((table) =>
        table.id === tableId
          ? {
              ...table,
              rows: [
                ...table.rows,
                {
                  id,
                  key: key ?? `row_${table.rows.length + 1}`,
                  values: Object.fromEntries(
                    table.columns.map((column) => [column.id, defaultValueForType(column.type)]),
                  ) as Record<string, GraphValue>,
                },
              ],
            }
          : table,
      ),
      isDirty: true,
    }));
    return id;
  },
  updateDataAssetRow: (tableId, rowId, patch) =>
    set((state) => ({
      dataAssets: state.dataAssets.map((table) =>
        table.id === tableId
          ? { ...table, rows: table.rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)) }
          : table,
      ),
      isDirty: true,
    })),
  deleteDataAssetRow: (tableId, rowId) =>
    set((state) => ({
      dataAssets: state.dataAssets.map((table) =>
        table.id === tableId ? { ...table, rows: table.rows.filter((row) => row.id !== rowId) } : table,
      ),
      isDirty: true,
    })),
  setDataAssetCell: (tableId, rowId, columnId, value) =>
    set((state) => ({
      dataAssets: state.dataAssets.map((table) => {
        if (table.id !== tableId) return table;
        const column = table.columns.find((item) => item.id === columnId);
        if (!column) return table;
        return {
          ...table,
          rows: table.rows.map((row) =>
            row.id === rowId
              ? { ...row, values: { ...row.values, [columnId]: coerceGraphValue(value, column.type) } }
              : row,
          ),
        };
      }),
      isDirty: true,
    })),
  createMaterial: (name, description, folderId) => {
    const id = makeId('material');
    const graphId = makeId('graph');
    set((state) => {
      const materialName = name ?? `Material ${state.materials.length + 1}`;
      return {
        materials: [
          ...state.materials,
          {
            id,
            name: materialName,
            description: description ?? 'Reusable material asset.',
            color: '#B4BCCC',
            metalness: 0.1,
            roughness: 0.65,
            emissiveColor: '#000000',
            emissiveIntensity: 0,
            graphId,
            folderId,
            createdAt: Date.now(),
          },
        ],
        graphs: [...state.graphs, makeMaterialGraph(graphId, materialName)],
        activeMaterialId: id,
        isDirty: true,
      };
    });
    return id;
  },
  renameMaterial: (id, name) =>
    set((state) => ({
      materials: state.materials.map((material) => (material.id === id ? { ...material, name } : material)),
      isDirty: true,
    })),
  updateMaterial: (id, patch) =>
    set((state) => ({
      materials: state.materials.map((material) => (material.id === id ? { ...material, ...patch } : material)),
      isDirty: true,
    })),
  deleteMaterial: (id) =>
    set((state) => {
      const material = state.materials.find((item) => item.id === id);
      return {
        materials: state.materials.filter((item) => item.id !== id),
        // Drop the material's paired graph too (mirrors deleteBlueprint).
        graphs: material?.graphId ? state.graphs.filter((graph) => graph.id !== material.graphId) : state.graphs,
        activeMaterialId:
          state.activeMaterialId === id ? state.materials.find((m) => m.id !== id)?.id ?? '' : state.activeMaterialId,
        // Clear dangling references so no object points at a removed material.
        scenes: state.scenes.map((scene) => ({
          ...scene,
          objects: scene.objects.map((object) => {
            const renderer = object.renderer;
            if (!renderer) return object;
            const usesAsId = renderer.materialId === id;
            const usesInSlot = renderer.materialSlots?.includes(id);
            if (!usesAsId && !usesInSlot) return object;
            return {
              ...object,
              renderer: {
                ...renderer,
                materialId: usesAsId ? undefined : renderer.materialId,
                materialSlots: usesInSlot
                  ? renderer.materialSlots!.map((slot) => (slot === id ? undefined : slot))
                  : renderer.materialSlots,
              },
            };
          }),
        })),
        isDirty: true,
      };
    }),
  setActiveMaterial: (id) => set({ activeMaterialId: id }),
  // --- Reusable particle-system assets ---
  createParticleSystem: (name, preset, folderId) => {
    const id = makeId('psys');
    set((state) => {
      const systemName = name ?? `Particle System ${state.particleSystems.length + 1}`;
      const config: ParticleConfig = { ...defaultParticleConfig(), ...(preset ? particlePresets[preset] : {}) };
      return {
        particleSystems: [
          ...state.particleSystems,
          { id, name: systemName, description: 'Reusable particle system.', folderId, createdAt: Date.now(), ...config },
        ],
        activeParticleSystemId: id,
        isDirty: true,
      };
    });
    return id;
  },
  renameParticleSystem: (id, name) =>
    set((state) => ({
      particleSystems: state.particleSystems.map((system) => (system.id === id ? { ...system, name } : system)),
      isDirty: true,
    })),
  updateParticleSystem: (id, patch) =>
    set((state) => ({
      particleSystems: state.particleSystems.map((system) => (system.id === id ? { ...system, ...stripUndefined(patch) } : system)),
      isDirty: true,
    })),
  deleteParticleSystem: (id) =>
    set((state) => ({
      particleSystems: state.particleSystems.filter((item) => item.id !== id),
      activeParticleSystemId:
        state.activeParticleSystemId === id ? state.particleSystems.find((p) => p.id !== id)?.id ?? '' : state.activeParticleSystemId,
      // Detach the emitter from any object referencing the removed asset.
      scenes: state.scenes.map((scene) => ({
        ...scene,
        objects: scene.objects.map((object) => {
          if (object.particles?.systemId !== id) return object;
          const next = { ...object };
          delete next.particles;
          return next;
        }),
      })),
      isDirty: true,
    })),
  setActiveParticleSystem: (id) => set({ activeParticleSystemId: id }),
  setObjectParticleSystem: (objectId, systemId) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) => {
          if (object.id !== objectId) return object;
          if (!systemId) {
            const next = { ...object };
            delete next.particles;
            return next;
          }
          const asset = state.particleSystems.find((p) => p.id === systemId);
          const config = asset ? particleAssetConfig(asset) : defaultParticleConfig();
          return { ...object, particles: { ...config, enabled: true, systemId } };
        }),
      ),
    ),
  // --- Game UI documents ---
  createUIDocument: (name, surface, folderId) => {
    const docName = name ?? `UI ${useEditorStore.getState().uiDocuments.length + 1}`;
    const doc = makeUIDocument(docName, surface ?? 'screen', folderId);
    set((state) => ({
      uiDocuments: [...state.uiDocuments, doc],
      activeUIDocumentId: doc.id,
      isDirty: true,
    }));
    return doc.id;
  },
  createUIFromTemplate: (template, folderId) => {
    const { doc, vars } = makeUITemplate(template);
    if (folderId) doc.folderId = folderId;
    set((state) => {
      // Auto-provision (only) the variables this template binds to but the project doesn't have yet,
      // so the HUD shows live data immediately instead of zeros that look broken.
      const existing = new Set(state.variables.map((variable) => variable.name));
      const created = vars
        .filter((variable) => !existing.has(variable.name))
        .map((variable) => ({
          id: makeId('var'),
          name: variable.name,
          type: variable.type ?? ('number' as const),
          defaultValue: variable.defaultValue,
          persistent: true,
          createdAt: Date.now(),
        }));
      return {
        uiDocuments: [...state.uiDocuments, doc],
        activeUIDocumentId: doc.id,
        selectedUIElementId: doc.root.id,
        variables: [...state.variables, ...created],
        isDirty: true,
      };
    });
    return doc.id;
  },
  applyUITheme: (docId, theme) =>
    set((state) => ({
      uiDocuments: state.uiDocuments.map((doc) =>
        doc.id === docId ? { ...doc, root: applyUIThemeToElement(doc.root, theme) } : doc,
      ),
      isDirty: true,
    })),
  renameUIDocument: (id, name) =>
    set((state) => ({
      uiDocuments: state.uiDocuments.map((doc) => (doc.id === id ? { ...doc, name } : doc)),
      isDirty: true,
    })),
  updateUIDocument: (id, patch) =>
    set((state) => ({
      uiDocuments: state.uiDocuments.map((doc) => (doc.id === id ? { ...doc, ...patch } : doc)),
      isDirty: true,
    })),
  deleteUIDocument: (id) =>
    set((state) => ({
      uiDocuments: state.uiDocuments.filter((doc) => doc.id !== id),
      activeUIDocumentId:
        state.activeUIDocumentId === id ? state.uiDocuments.find((doc) => doc.id !== id)?.id ?? '' : state.activeUIDocumentId,
      // Clear dangling world-UI references so no object points at a removed document.
      scenes: state.scenes.map((scene) => ({
        ...scene,
        objects: scene.objects.map((object) =>
          object.ui?.documentId === id ? { ...object, ui: undefined } : object,
        ),
      })),
      isDirty: true,
    })),
  setActiveUIDocument: (id) => set({ activeUIDocumentId: id, selectedUIElementId: '' }),
  selectUIElement: (id) => set({ selectedUIElementId: id }),
  openUILogic: (docId) => {
    const state = get();
    const doc = state.uiDocuments.find((d) => d.id === docId);
    if (!doc) return '';
    // Reuse an existing logic blueprint if it's still around, else make one.
    let blueprintId = doc.logicBlueprintId && state.blueprints.some((b) => b.id === doc.logicBlueprintId) ? doc.logicBlueprintId : '';
    if (!blueprintId) {
      blueprintId = get().createBlueprintNamed(`${doc.name} Logic`, 'UI behaviour graph.').blueprintId;
      get().updateUIDocument(docId, { logicBlueprintId: blueprintId });
    }
    // Ensure something runs the graph: a tiny empty "UI Logic" object carrying this blueprint.
    const objects = selectActiveObjects(get());
    const hasController = objects.some((o) => o.script?.blueprintId === blueprintId);
    if (!hasController) {
      const objectId = get().createObjectWithProps('empty', { name: `${doc.name} UI Logic` });
      get().attachScript(objectId, blueprintId);
    }
    get().setActiveBlueprint(blueprintId);
    return blueprintId;
  },
  addUIElement: (docId, parentId, kind) => {
    const element = makeUIElement(kind);
    set((state) => ({
      uiDocuments: state.uiDocuments.map((doc) => {
        if (doc.id !== docId) return doc;
        const targetId = parentId ?? doc.root.id;
        return { ...doc, root: mapUIElement(doc.root, targetId, (el) => ({ ...el, children: [...el.children, element] })) };
      }),
      isDirty: true,
    }));
    return element.id;
  },
  updateUIElement: (docId, elementId, patch) =>
    set((state) => ({
      uiDocuments: state.uiDocuments.map((doc) =>
        doc.id === docId ? { ...doc, root: mapUIElement(doc.root, elementId, (el) => ({ ...el, ...patch })) } : doc,
      ),
      isDirty: true,
    })),
  removeUIElement: (docId, elementId) =>
    set((state) => ({
      uiDocuments: state.uiDocuments.map((doc) =>
        // Never remove the root element.
        doc.id === docId && doc.root.id !== elementId ? { ...doc, root: removeUIElementFromTree(doc.root, elementId) } : doc,
      ),
      isDirty: true,
    })),
  setUIBinding: (docId, elementId, target, expression) =>
    set((state) => ({
      uiDocuments: state.uiDocuments.map((doc) => {
        if (doc.id !== docId) return doc;
        return {
          ...doc,
          root: mapUIElement(doc.root, elementId, (el) => {
            const rest = el.bindings.filter((b) => b.target !== target);
            const bindings = expression.trim() ? [...rest, { target, expression }] : rest;
            return { ...el, bindings };
          }),
        };
      }),
      isDirty: true,
    })),
  addUIPreset: (docId, parentId, preset, options) => {
    // Data-bound presets reference a variable BY NAME; make sure it exists (create a number var if not).
    let variableName = options?.variableName ?? (preset === 'healthBar' ? 'health' : preset === 'counter' ? 'score' : '');
    if ((preset === 'healthBar' || preset === 'counter') && variableName) {
      const existing = get().variables.find((v) => v.name === variableName);
      if (!existing) {
        const id = get().createVariable(variableName, 'number', false);
        // Health defaults to 100 so the preview bar starts full.
        get().updateVariable(id, { defaultValue: preset === 'healthBar' ? 100 : 0 });
        variableName = get().variables.find((v) => v.id === id)?.name ?? variableName;
      }
    }
    const subtree = makeUIPreset(preset, variableName);
    set((state) => ({
      uiDocuments: state.uiDocuments.map((doc) => {
        if (doc.id !== docId) return doc;
        const targetId = parentId ?? doc.root.id;
        return { ...doc, root: mapUIElement(doc.root, targetId, (el) => ({ ...el, children: [...el.children, subtree] })) };
      }),
      isDirty: true,
    }));
    return subtree.id;
  },
  moveUIElement: (docId, elementId, dir) =>
    set((state) => ({
      uiDocuments: state.uiDocuments.map((doc) => {
        if (doc.id !== docId) return doc;
        const parent = findUIParent(doc.root, elementId);
        if (!parent) return doc; // root can't move
        const index = parent.children.findIndex((c) => c.id === elementId);
        const swap = dir === 'up' ? index - 1 : index + 1;
        if (swap < 0 || swap >= parent.children.length) return doc;
        const reordered = [...parent.children];
        [reordered[index], reordered[swap]] = [reordered[swap], reordered[index]];
        return { ...doc, root: mapUIElement(doc.root, parent.id, (el) => ({ ...el, children: reordered })) };
      }),
      isDirty: true,
    })),
  duplicateUIElement: (docId, elementId) => {
    const doc = get().uiDocuments.find((d) => d.id === docId);
    const original = doc ? findUIElement(doc.root, elementId) : undefined;
    if (!doc || !original || doc.root.id === elementId) return elementId; // never duplicate the root
    const clone = cloneUIElementFresh(original);
    set((state) => ({
      uiDocuments: state.uiDocuments.map((d) => {
        if (d.id !== docId) return d;
        const parent = findUIParent(d.root, elementId);
        if (!parent) return d;
        const index = parent.children.findIndex((c) => c.id === elementId);
        const next = [...parent.children];
        next.splice(index + 1, 0, clone);
        return { ...d, root: mapUIElement(d.root, parent.id, (el) => ({ ...el, children: next })) };
      }),
      isDirty: true,
    }));
    return clone.id;
  },
  attachUI: (objectId, documentId) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) =>
          object.id === objectId ? { ...object, ui: { ...defaultUIComponent(documentId), ...object.ui, documentId } } : object,
        ),
      ),
    ),
  detachUI: (objectId) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) => (object.id === objectId ? { ...object, ui: undefined } : object)),
      ),
    ),
  updateUIComponent: (objectId, patch) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) => (object.id === objectId && object.ui ? { ...object, ui: { ...object.ui, ...patch } } : object)),
      ),
    ),
  setObjectVariable: (objectId, key, value) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) =>
          object.id === objectId ? { ...object, variables: { ...(object.variables ?? {}), [key]: value } } : object,
        ),
      ),
    ),
  showUI: (docId) =>
    set((state) => ({ runtimeVisibleUI: { ...state.runtimeVisibleUI, [docId]: true } })),
  hideUI: (docId) =>
    set((state) => ({ runtimeVisibleUI: { ...state.runtimeVisibleUI, [docId]: false } })),
  setUIText: (docId, elementId, text) =>
    set((state) => ({ runtimeUITextOverrides: { ...state.runtimeUITextOverrides, [`${docId}:${elementId}`]: text } })),
  setRuntimeVariableByName: (name, value) =>
    set((state) => {
      if (!state.isPlaying) return {};
      const variable = state.variables.find((v) => v.name === name);
      if (!variable) return {};
      return {
        runtimeVariableValues: {
          ...state.runtimeVariableValues,
          [variable.id]: coerceGraphValue(value, variable.type),
        },
      };
    }),
  ensureMaterialGraph: (materialId) => {
    const state = get();
    const material = state.materials.find((item) => item.id === materialId);
    if (!material || (material.graphId && state.graphs.some((graph) => graph.id === material.graphId))) return;
    const graphId = material.graphId ?? makeId('graph');
    set((current) => ({
      materials: current.materials.map((item) => (item.id === materialId ? { ...item, graphId } : item)),
      graphs: [...current.graphs, makeMaterialGraph(graphId, material.name)],
      isDirty: true,
    }));
  },
  addMaterialNode: (label, category, data, position) => {
    const nodeId = makeId('node');
    set((state) => {
      const material = state.materials.find((item) => item.id === state.activeMaterialId);
      if (!material?.graphId) return state;
      return {
        graphs: mapGraphById(state.graphs, material.graphId, (graph) => {
          const offset = graph.nodes.length * 38;
          const node: NodeForgeNode = {
            id: nodeId,
            type: 'nodeforge',
            position: position ?? { x: 80 + (offset % 320), y: 80 + Math.floor(offset / 320) * 112 },
            data: makeNodeData(label, category, data),
          };
          const edges = [...graph.edges];
          if (
            node.data.nodeKind === 'material.texture' &&
            !edges.some((edge) => edge.targetHandle === 'baseColor')
          ) {
            const output = graph.nodes.find((item) => item.data.nodeKind === 'material.output');
            if (output) {
              edges.push({
                id: makeId('edge'),
                source: nodeId,
                target: output.id,
                sourceHandle: 'value-out',
                targetHandle: 'baseColor',
                animated: false,
                type: 'smoothstep',
                style: { stroke: '#3DD0DC', strokeWidth: 2 },
              });
            }
          }
          return { ...graph, nodes: [...graph.nodes, node], edges };
        }),
        selectedGraphNodeId: nodeId,
        isDirty: true,
      };
    });
    return nodeId;
  },
  connectMaterialNodes: (sourceId, targetId, sourceHandle, targetHandle) =>
    set((state) => {
      const material = state.materials.find((item) => item.id === state.activeMaterialId);
      if (!material?.graphId) return state;
      return {
        graphs: mapGraphById(state.graphs, material.graphId, (graph) => ({
          ...graph,
          edges: addEdge(
            {
              id: makeId('edge'),
              source: sourceId,
              target: targetId,
              sourceHandle: sourceHandle ?? 'value-out',
              targetHandle,
              animated: false,
              type: 'smoothstep',
              style: { stroke: '#3DD0DC', strokeWidth: 2 },
            },
            graph.edges,
          ),
        })),
        isDirty: true,
      };
    }),
  deleteMaterialNode: (nodeId) =>
    set((state) => {
      const material = state.materials.find((item) => item.id === state.activeMaterialId);
      if (!material?.graphId) return state;
      return {
        graphs: mapGraphById(state.graphs, material.graphId, (graph) => ({
          ...graph,
          // The Material Output sink is permanent — keep it even if asked to delete.
          nodes: graph.nodes.filter((node) => node.id !== nodeId || node.data.nodeKind === 'material.output'),
          edges: graph.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
        })),
        selectedGraphNodeId: state.selectedGraphNodeId === nodeId ? undefined : state.selectedGraphNodeId,
        isDirty: true,
      };
    }),
  onMaterialNodesChange: (changes) =>
    set((state) => {
      const material = state.materials.find((item) => item.id === state.activeMaterialId);
      if (!material?.graphId) return state;
      const dirtied = changes.some((change) => change.type !== 'select' && change.type !== 'dimensions');
      return {
        graphs: mapGraphById(state.graphs, material.graphId, (graph) => ({
          ...graph,
          nodes: applyNodeChanges(changes, graph.nodes),
        })),
        ...(dirtied ? { isDirty: true } : {}),
      };
    }),
  onMaterialEdgesChange: (changes) =>
    set((state) => {
      const material = state.materials.find((item) => item.id === state.activeMaterialId);
      if (!material?.graphId) return state;
      const dirtied = changes.some((change) => change.type !== 'select');
      return {
        graphs: mapGraphById(state.graphs, material.graphId, (graph) => ({
          ...graph,
          edges: applyEdgeChanges(changes, graph.edges),
        })),
        ...(dirtied ? { isDirty: true } : {}),
      };
    }),
  onMaterialConnect: (connection) =>
    set((state) => {
      const material = state.materials.find((item) => item.id === state.activeMaterialId);
      if (!material?.graphId) return state;
      return {
        graphs: mapGraphById(state.graphs, material.graphId, (graph) => ({
          ...graph,
          edges: addEdge(
            { ...connection, animated: false, type: 'smoothstep', style: { stroke: '#3DD0DC', strokeWidth: 2 } },
            graph.edges,
          ),
        })),
        isDirty: true,
      };
    }),
  autoLayoutMaterialGraph: () =>
    set((state) => {
      const material = state.materials.find((item) => item.id === state.activeMaterialId);
      if (!material?.graphId) return state;
      return {
        graphs: mapGraphById(state.graphs, material.graphId, (graph) => ({
          ...graph,
          nodes: layoutGraphNodes(graph.nodes, graph.edges),
        })),
        isDirty: true,
      };
    }),
  addGraphNodeToBlueprint: (blueprintId, label, category, data, position) => {
    const nodeId = makeId('node');
    set((state) => {
      const blueprint = state.blueprints.find((item) => item.id === blueprintId);
      if (!blueprint) return state;
      return {
        graphs: state.graphs.map((graph) => {
          if (graph.id !== blueprint.graphId) return graph;
          const offset = graph.nodes.length * 38;
          const nodeData = makeNodeData(label, category, seedNodeDataFromProject(label, data, state.variables, state.dataAssets));
          const node: NodeForgeNode = {
            id: nodeId,
            type: 'nodeforge',
            position: position ?? { x: 80 + (offset % 560), y: 220 + Math.floor(offset / 560) * 112 },
            data: nodeData,
            // Comments are resizable background frames: spawn with a useful size and sit BEHIND real nodes.
            ...(nodeData.nodeKind === 'comment.note' ? { width: 340, height: 200, zIndex: -1 } : {}),
          };
          return { ...graph, nodes: [...graph.nodes, node] };
        }),
        isDirty: true,
      };
    });
    return nodeId;
  },
  connectGraphNodes: (blueprintId, sourceId, targetId, sourceHandle, targetHandle) =>
    set((state) => {
      const blueprint = state.blueprints.find((item) => item.id === blueprintId);
      if (!blueprint) return state;
      const isValueEdge = Boolean(targetHandle && targetHandle !== 'exec-in');
      return {
        graphs: state.graphs.map((graph) =>
          graph.id === blueprint.graphId
            ? {
                ...graph,
                edges: addEdge(
                  {
                    id: makeId('edge'),
                    source: sourceId,
                    target: targetId,
                    sourceHandle,
                    targetHandle,
                    animated: !isValueEdge,
                    type: 'smoothstep',
                    style: isValueEdge ? { stroke: '#3DD0DC', strokeWidth: 2 } : undefined,
                  },
                  graph.edges,
                ),
              }
            : graph,
        ),
        isDirty: true,
      };
    }),
  deleteGraphNode: (nodeId) =>
    set((state) => {
      const blueprint = state.blueprints.find((item) => item.id === state.activeBlueprintId);
      if (!blueprint) return state;
      return {
        graphs: state.graphs.map((graph) =>
          graph.id === blueprint.graphId
            ? {
                ...graph,
                nodes: graph.nodes.filter((node) => node.id !== nodeId),
                edges: graph.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
              }
            : graph,
        ),
        selectedGraphNodeId: state.selectedGraphNodeId === nodeId ? undefined : state.selectedGraphNodeId,
        isDirty: true,
      };
    }),
  deleteGraphNodes: (nodeIds) =>
    set((state) => {
      const blueprint = state.blueprints.find((item) => item.id === state.activeBlueprintId);
      if (!blueprint || nodeIds.length === 0) return state;
      const doomed = new Set(nodeIds);
      return {
        graphs: state.graphs.map((graph) =>
          graph.id === blueprint.graphId
            ? {
                ...graph,
                nodes: graph.nodes.filter((node) => !doomed.has(node.id)),
                edges: graph.edges.filter((edge) => !doomed.has(edge.source) && !doomed.has(edge.target)),
              }
            : graph,
        ),
        selectedGraphNodeId:
          state.selectedGraphNodeId && doomed.has(state.selectedGraphNodeId) ? undefined : state.selectedGraphNodeId,
        isDirty: true,
      };
    }),
  pasteGraphNodes: (blueprintId, nodes, edges, offset = { x: 36, y: 36 }) => {
    const idMap = new Map(nodes.map((node) => [node.id, makeId('node')]));
    set((state) => {
      const blueprint = state.blueprints.find((item) => item.id === blueprintId);
      if (!blueprint) return state;
      return {
        graphs: state.graphs.map((graph) => {
          if (graph.id !== blueprint.graphId) return graph;
          const pasted: NodeForgeNode[] = nodes.map((node) => ({
            ...node,
            id: idMap.get(node.id)!,
            position: { x: node.position.x + offset.x, y: node.position.y + offset.y },
            data: structuredClone(node.data),
            selected: true,
          }));
          // Only wires fully inside the copied set come along; new ids keep them isolated from the originals.
          const pastedEdges: Edge[] = edges
            .filter((edge) => idMap.has(edge.source) && idMap.has(edge.target))
            .map((edge) => ({
              ...edge,
              id: makeId('edge'),
              source: idMap.get(edge.source)!,
              target: idMap.get(edge.target)!,
            }));
          return {
            ...graph,
            // The pasted set becomes the new selection (originals deselect) so repeat-paste cascades read clearly.
            nodes: [...graph.nodes.map((node) => (node.selected ? { ...node, selected: false } : node)), ...pasted],
            edges: [...graph.edges, ...pastedEdges],
          };
        }),
        isDirty: true,
      };
    });
    return nodes.map((node) => idMap.get(node.id)!);
  },
  autoLayoutActiveGraph: () =>
    set((state) => {
      const blueprint = state.blueprints.find((item) => item.id === state.activeBlueprintId);
      if (!blueprint) return state;
      return {
        graphs: state.graphs.map((graph) =>
          graph.id === blueprint.graphId
            ? { ...graph, nodes: layoutGraphNodes(graph.nodes, graph.edges) }
            : graph,
        ),
        isDirty: true,
      };
    }),
  selectGraphNode: (selectedGraphNodeId) => {
    if (get().selectedGraphNodeId !== selectedGraphNodeId) set({ selectedGraphNodeId });
  },
  updateGraphNodeData: (id, patch) =>
    set((state) => ({
      // Find the node in whichever graph holds it (blueprint OR material graph).
      graphs: state.graphs.map((graph) => {
        const existing = graph.nodes.find((node) => node.id === id);
        if (!existing) return graph;
        const nextNodes = graph.nodes.map((node) =>
          node.id === id ? { ...node, data: normalizeNodeData({ ...node.data, ...patch }) } : node,
        );
        let nextEdges = graph.edges;
        const becameTextured =
          existing.data.nodeKind === 'material.texture' &&
          typeof patch.assetId !== 'undefined' &&
          patch.assetId &&
          !graph.edges.some((edge) => edge.source === id) &&
          !graph.edges.some((edge) => edge.targetHandle === 'baseColor');
        if (becameTextured) {
          const output = graph.nodes.find((node) => node.data.nodeKind === 'material.output');
          if (output) {
            nextEdges = [
              ...graph.edges,
              {
                id: makeId('edge'),
                source: id,
                target: output.id,
                sourceHandle: 'value-out',
                targetHandle: 'baseColor',
                animated: false,
                type: 'smoothstep',
                style: { stroke: '#3DD0DC', strokeWidth: 2 },
              },
            ];
          }
        }
        return { ...graph, nodes: nextNodes, edges: nextEdges };
      }),
      isDirty: true,
    })),
  fireCustomEvent: (eventName) =>
    set((state) => ({
      runtimeEventQueue: [...state.runtimeEventQueue, eventName.trim() || 'CustomEvent'],
    })),
  addAssets: (files) =>
    set((state) => ({
      assets: [
        ...state.assets,
        ...Array.from(files).map((file) => ({
          id: makeId('asset'),
          name: file.name,
          type: getAssetType(file.name),
          size: file.size,
          url: URL.createObjectURL(file),
          createdAt: Date.now(),
        })),
      ],
      isDirty: true,
    })),
  addAssetItems: (items) =>
    set((state) => ({ assets: [...state.assets, ...items], isDirty: true })),
  setAssetSearch: (assetSearch) => set({ assetSearch }),
  removeAsset: (id) =>
    set((state) => {
      const asset = state.assets.find((item) => item.id === id);
      // Only blob: URLs need revoking; data:/asset:/empty are no-ops but harmless.
      if (asset?.url?.startsWith('blob:')) URL.revokeObjectURL(asset.url);
      return {
        assets: state.assets.filter((item) => item.id !== id),
        // Clear any dangling references so the engine never points at a removed asset.
        scenes: state.scenes.map((scene) => ({
          ...scene,
          objects: scene.objects.map((object) => {
            const renderer = object.renderer;
            if (!renderer || (renderer.modelAssetId !== id && renderer.textureAssetId !== id)) return object;
            return {
              ...object,
              renderer: {
                ...renderer,
                modelAssetId: renderer.modelAssetId === id ? undefined : renderer.modelAssetId,
                textureAssetId: renderer.textureAssetId === id ? undefined : renderer.textureAssetId,
              },
            };
          }),
        })),
        // Materials may reference this asset as a base-color or normal map.
        materials: state.materials.map((material) =>
          material.textureAssetId === id || material.normalMapAssetId === id
            ? {
                ...material,
                textureAssetId: material.textureAssetId === id ? undefined : material.textureAssetId,
                normalMapAssetId: material.normalMapAssetId === id ? undefined : material.normalMapAssetId,
              }
            : material,
        ),
        graphs: state.graphs.map((graph) => ({
          ...graph,
          nodes: graph.nodes.map((node) =>
            node.data.assetId === id ? { ...node, data: { ...node.data, assetId: undefined } } : node,
          ),
        })),
        isDirty: true,
      };
    }),
  setPlaying: (isPlaying) =>
    set((state) => {
      if (isPlaying === state.isPlaying) return state;
      // Play runs the game scene, not a prefab being edited — block it while the prefab editor is open.
      if (isPlaying && state.editingPrefabId) return state;
      // Fresh run = fresh error reporting: a script fixed since the last run should report again.
      resetReportedScriptErrors();
      clearNodeErrors();
      if (isPlaying) {
        const objects = selectActiveObjects(state);
        const autoplay = state.scenes.find((scene) => scene.id === state.activeSceneId)?.cinematics?.find((cinematic) => cinematic.autoplay);
        // Spin up a fresh Rapier world to own the simulation for this play session.
        startPhysics();
        clearTransformBuffer();
        clearPerception();
        clearVehicleDents(); // start each run with a pristine (undented) car
        effectLife.clear(); // drop any stale burst-lifetime entries from the previous run
        prevTransformEntryPool.clear();
        detachedParts.clear();
        pendingPartKicks.clear();
        pendingPartRestores.clear();
        return {
          isPlaying,
          runtimeTime: 0,
          runtimeTimeScale: 1,
          runtimeVelocities: makeRuntimeVelocityMap(objects),
          runtimeKeys: {},
          runtimePreviousKeys: {},
          runtimeKeyPresses: {},
          runtimePreviousKeyPresses: {},
          runtimeEventQueue: [],
          runtimeVariableValues: makeRuntimeVariableMap(state.variables),
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
          runtimeTriggers: [],
          runtimeTriggersExit: [],
          runtimeDamageEvents: {},
          runtimeSoundQueue: [],
          runtimeVehicleSound: null,
          runtimeLog: [],
          runtimeNodeErrors: {},
          // Show every screen HUD flagged visibleOnStart; world docs render whenever their object exists.
          runtimeVisibleUI: Object.fromEntries(
            state.uiDocuments.filter((doc) => doc.surface === 'screen' && doc.visibleOnStart).map((doc) => [doc.id, true]),
          ),
          // Seed per-instance object variables: each object gets its OWN copy of its blueprint's declared
          // variables (merged under any authored overrides), so world-UI `self.*` + Get/Set Object Var start
          // from typed defaults — this is the per-instance scope (vs shared project variables).
          runtimeObjectVariables: Object.fromEntries(
            objects.map((object) => [
              object.id,
              seedBlueprintInstanceVars(
                object.variables,
                object.script?.blueprintId ? state.blueprints.find((b) => b.id === object.script!.blueprintId) : undefined,
              ),
            ]),
          ),
          runtimeUITextOverrides: {},
          runtimeCinematic: autoplay ? { sequenceId: autoplay.id, time: 0, firedActionIds: [], spawnedObjectIds: [] } : undefined,
          runtimeCinematicCamera: initialCinematicCamera(autoplay, objects, state.scenes.find((s) => s.id === state.activeSceneId)?.cinematics ?? []),
          runtimeCinematicFade: initialCinematicFade(autoplay, state.scenes.find((s) => s.id === state.activeSceneId)?.cinematics ?? []),
          runtimeCinematicLook: autoplay?.look,
          runtimeCinematicText: undefined,
          editorCinematicPreview: undefined,
          editorCinematicPreviewCamera: undefined,
          editorCinematicPreviewFade: undefined,
          editorCinematicPreviewLook: undefined,
          editorCinematicPreviewText: undefined,
          editorCinematicPreviewTransforms: {},
          editorCinematicPreviewHidden: [],
          editorCinematicPreviewMaterials: {},
          runtimeStarted: false,
          // Full deep clone so Stop fully resets the scene (restores picked-up/destroyed objects, removes
          // spawned projectiles, reverts transforms/materials/instance variables).
          playSnapshot: { sceneId: state.activeSceneId, objects: structuredClone(objects) },
          runtimeSceneSnapshots: { [state.activeSceneId]: structuredClone(objects) },
        };
      }

      // Restore the snapshot wholesale into the scene it was taken from (does NOT mark dirty): the cloned
      // objects re-appear (picked-up/destroyed ones come back, runtime-spawned ones are gone). If a Load Scene
      // node visited other scenes this session, revert each of those too (runtimeSceneSnapshots).
      const snapshot = state.playSnapshot;
      const sceneSnaps = state.runtimeSceneSnapshots ?? (snapshot ? { [snapshot.sceneId]: snapshot.objects } : {});
      const scenes = state.scenes.map((scene) =>
        sceneSnaps[scene.id] ? { ...scene, objects: sceneSnaps[scene.id] } : scene,
      );
      // If Play hopped to another scene, return the editor to the scene it started in.
      const restoredActiveSceneId = snapshot?.sceneId ?? state.activeSceneId;

      // Tear the physics world down so the next play session starts clean.
      stopPhysics();
      clearExplosions();
      clearTransformBuffer();
      clearPerception();
      clearVehicleDents();
      return {
        isPlaying,
        runtimeTime: 0,
        runtimeTimeScale: 1,
        runtimeVelocities: {},
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
        runtimeTriggers: [],
        runtimeTriggersExit: [],
        runtimeDamageEvents: {},
        runtimeSoundQueue: [],
        runtimeVehicleSound: null,
        runtimeLog: [],
        runtimeNodeErrors: {},
        runtimeVisibleUI: {},
        runtimeObjectVariables: {},
        runtimeUITextOverrides: {},
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
        runtimeStarted: false,
        scenes,
        activeSceneId: restoredActiveSceneId,
        playSnapshot: undefined,
        runtimeSceneSnapshots: undefined,
      };
    }),
  setRuntimeKey: (code, pressed) =>
    set((state) => {
      const keysChanged = state.runtimeKeys[code] !== pressed;
      if (!pressed) return keysChanged ? { runtimeKeys: { ...state.runtimeKeys, [code]: false } } : state;
      return {
        ...(keysChanged ? { runtimeKeys: { ...state.runtimeKeys, [code]: true } } : {}),
        runtimeKeyPresses: { ...state.runtimeKeyPresses, [code]: (state.runtimeKeyPresses[code] ?? 0) + 1 },
      };
    }),
  clearRuntimeSounds: () =>
    set((state) => (state.runtimeSoundQueue.length ? { runtimeSoundQueue: [] } : state)),
  clearRuntimeLog: () => set((state) => (state.runtimeLog.length ? { runtimeLog: [] } : state)),
  tickRuntime: (delta) =>
    set((state) => {
      if (!state.isPlaying) return state;
      // Global time scale (Set Time Scale node): scales scripts, timers, physics and motion in one place.
      // At 0 (paused) the tick still RUNS — key/UI events keep firing so the pause menu can unpause —
      // but nothing advances and the physics step is skipped (physics.frame early-outs on dt <= 0).
      delta *= state.runtimeTimeScale ?? 1;
      beginPerceptionFrame(); // advance the AI perception clock (throttled line-of-sight cache)
      const activeObjects = selectActiveObjects(state);
      const activeObjectById = indexSceneObjectsById(activeObjects);
      // These index Maps are WeakMap-cached on their source array identity, so during
      // Play (when the arrays don't change) the same Map is reused every frame instead
      // of being rebuilt — see indexers defined near the top of this module.
      const variableById = indexVariablesById(state.variables);
      const variableByName = indexVariablesByName(state.variables);
      const dataAssetById = indexDataAssetsById(state.dataAssets);
      const prefabById = indexPrefabsById(state.prefabs);
      const controllerById = indexControllersById(state.animatorControllers);
      const animationById = indexAnimationsById(state.animations);
      const assetByName = indexAssetsByName(state.assets);
      const blueprintById = indexBlueprintsById(state.blueprints);
      const declaredObjectVarType = (targetObj: SceneObject | undefined, key: string): GraphValueType | undefined => {
        const blueprintId = targetObj?.script?.blueprintId;
        if (!blueprintId) return undefined;
        const blueprint = blueprintById.get(blueprintId);
        if (!blueprint) return undefined;
        let types = blueprintVarTypeCache.get(blueprint);
        if (!types) {
          types = new Map((blueprint.variables ?? []).map((variable) => [variable.name, variable.type]));
          blueprintVarTypeCache.set(blueprint, types);
        }
        return types.get(key);
      };
      const runtimeGroundedSet = toIdSet(state.runtimeGrounded);
      const runtimeSwimmingSet = toIdSet(state.runtimeSwimming);
      const runtimeClimbingSet = toIdSet(state.runtimeClimbing);
      const priorCollisionIndex = buildContactIndex(state.runtimeCollisions);
      const priorTriggerIndex = buildContactIndex(state.runtimeTriggers);
      const priorTriggerExitIndex = buildContactIndex(state.runtimeTriggersExit);
      const priorCollisionExitIndex = buildContactIndex(state.runtimeCollisionsExit);
      const graphRuntimes = getGraphRuntimeMap(state.graphs);
      // Objects whose blueprint listens for "On Receive Damage". Having that event = intent to take damage,
      // so damage sources notify them automatically — no manual `health` var needed (that was a silent
      // footgun). A listener with NO health var is notify-only (fires the event, never dies); add a health
      // var only when you want it to actually have HP and die at 0.
      const listensForReceiveDamage = new Set<string>();
      // Optional HP pool declared on the On Receive Damage node (startingHealth > 0) for objects without an
      // explicit `health` var — lets damage actually reduce HP + kill, configured right on the node.
      const receiveDamageHealth = new Map<string, number>();
      for (const obj of activeObjects) {
        if (!obj.script?.enabled) continue;
        const dmgNode = graphRuntimes.get(obj.script.graphId)?.receiveDamageRoot;
        if (!dmgNode) continue;
        listensForReceiveDamage.add(obj.id);
        const hp = Number(dmgNode.data.startingHealth ?? 0);
        if (hp > 0) receiveDamageHealth.set(obj.id, hp);
      }
      // Timer events and throttled Update roots: advance countdowns once per tick (NOT inside
      // eventRootFires, which is a pure predicate called twice per tick). A root that reaches 0 fires this
      // frame and re-arms to its interval. firedTimers is read by eventRootFires; nextTimers is persisted.
      const nextTimers: Record<string, number> = {};
      const firedTimers = new Set<string>();
      const timerStep = delta || 1 / 60;
      for (const obj of activeObjects) {
        if (!obj.script?.enabled || isRagdoll(obj.id)) continue;
        const gr = graphRuntimes.get(obj.script.graphId);
        if (!gr || gr.timerRoots.length === 0) continue;
        for (const node of gr.timerRoots) {
          const isThrottledUpdate = node.data.nodeKind === 'event.update';
          const key = `${obj.id}:${node.id}`;
          const interval = Math.max(0.05, Number(node.data.numberValue ?? 1));
          let remaining = (state.runtimeTimers[key] ?? (isThrottledUpdate ? 0 : interval)) - timerStep;
          if (remaining <= 0) {
            firedTimers.add(key);
            remaining += interval;
            if (remaining <= 0) remaining = interval; // huge frame / tiny interval: don't burst-fire
          }
          nextTimers[key] = remaining;
        }
      }
      const runtimeTime = state.runtimeTime + delta;
      const nextVelocities = { ...state.runtimeVelocities };
      // Per-frame Vehicle drive input set by the "Drive" blueprint node (throttle/steer/handbrake).
      // A scripted car (one with a blueprint) is driven ONLY by this — its graph is authoritative.
      const vehicleScriptInputs: Record<string, { throttle: number; steer: number; handbrake: boolean }> = {};
      const nextVariableValues = { ...state.runtimeVariableValues };
      // Per-object instance variables are copy-on-write: most objects only read their bag each frame.
      let nextObjectVariables: Record<string, Record<string, GraphValue>> = state.runtimeObjectVariables;
      const mutableObjectVars = (
        objectId: string,
        authoredVars?: Record<string, GraphValue>,
      ): Record<string, GraphValue> => {
        if (nextObjectVariables === state.runtimeObjectVariables) nextObjectVariables = { ...state.runtimeObjectVariables };
        const current = nextObjectVariables[objectId];
        if (current && current !== state.runtimeObjectVariables[objectId]) return current;
        const next = { ...(current ?? authoredVars ?? {}) };
        nextObjectVariables[objectId] = next;
        return next;
      };
      // UI runtime side effects this frame.
      const nextVisibleUI = { ...state.runtimeVisibleUI };
      const nextUITextOverrides = { ...state.runtimeUITextOverrides };
      const firedEvents = toLowerCaseSet(state.runtimeEventQueue);
      // Last payload carried by each custom event (lowercased name) — written by Fire Event's Payload
      // pin, read from the matching Custom Event's value-out. Persists until the same event fires again.
      const eventPayloads: Record<string, GraphValue> = { ...(state.runtimeEventPayloads ?? {}) };
      // HP each object lost on the PREVIOUS tick — drives event.receiveDamage this frame (one-frame delayed,
      // like collisions) and its Damage value-out. Damage dealt THIS tick accumulates into `damageThisFrame`
      // (from the Apply Damage node + every combat-pass source) and becomes next tick's runtimeDamageEvents.
      const priorDamage = state.runtimeDamageEvents;
      const damageThisFrame: Record<string, number> = {};
      const recordDamage = (id: string, amount: number) => {
        if (amount > 0) damageThisFrame[id] = (damageThisFrame[id] ?? 0) + amount;
      };
      const currentKeys = state.runtimeKeys;
      const previousKeys = state.runtimePreviousKeys;
      const currentKeyPresses = state.runtimeKeyPresses;
      const previousKeyPresses = state.runtimePreviousKeyPresses;
      const keyPressedThisTick = (code: string) => (currentKeyPresses[code] ?? 0) > (previousKeyPresses[code] ?? 0);
      // Transforms at the start of the tick — the diff after scripts run is the motion a
      // script applied, which the physics world turns into body inputs (velocity/teleport).
      // Map AND entries pooled (physicsWorld only reads it synchronously within this tick).
      const prevTransforms = tickPrevTransforms;
      prevTransforms.clear();
      for (const object of activeObjects) {
        let entry = prevTransformEntryPool.get(object.id);
        if (entry) {
          entry.position = object.transform.position;
          entry.rotation = object.transform.rotation;
        } else {
          entry = { position: object.transform.position, rotation: object.transform.rotation };
          prevTransformEntryPool.set(object.id, entry);
        }
        prevTransforms.set(object.id, entry);
      }
      // Impulses requested by action.applyForce/applyImpulse this frame, applied to bodies post-step.
      const physicsImpulses: Record<string, Vector3Tuple> = {};
      // Angular impulses (torque kicks) requested by action.applyTorque — applied in physics.frame for
      // physics-driven steering / tip-over forces on a dynamic body.
      const physicsAngularImpulses: Record<string, Vector3Tuple> = {};
      // Hard velocity sets requested by action.setVelocity this frame (dynamic bodies), applied in physics.frame.
      const setVelocities: Record<string, Vector3Tuple> = {};
      // Momentum hand-off for freshly torn-off car parts: their dynamic body is created during THIS
      // frame's physics sync, so the inherited velocity + tumble queued at detach time applies now.
      if (pendingPartKicks.size) {
        for (const [pid, kick] of pendingPartKicks) {
          setVelocities[pid] = kick.vel;
          physicsAngularImpulses[pid] = kick.spin;
        }
        pendingPartKicks.clear();
      }
      // Driver input for raycast-sim cars (physicsModel === 'raycast'), resolved in the vehicle pass and handed
      // to the Rapier vehicle controller inside physics.frame. Keyed by chassis object id.
      const vehicleInputs: Record<
        string,
        { throttle: number; steer: number; handbrake: boolean; engineScale?: number; respawn?: boolean; shiftUp?: boolean; shiftDown?: boolean; gripScale?: number; brakeScale?: number }
      > = {};
      // Absolute transform writes to ANOTHER actor (Set Position/Rotation/Scale/Look At with a Target).
      // Self writes still mutate the owner's tuples directly; these are merged into the object list before
      // the character/physics passes, so a teleported kinematic/fixed body follows (physics.frame reads the
      // post-script transform). Last write wins. Keyed by target object id.
      const nextTransforms: Record<string, { position?: Vector3Tuple; rotation?: Vector3Tuple; scale?: Vector3Tuple }> = {};
      const nextPhysics: Record<string, Partial<PhysicsComponent>> = {};
      // BREAKAWAY PROPS (GTA streetlights): a FIXED body with physics.knockOverThreshold converts to a
      // DYNAMIC body and tumbles when something faster than the threshold slams it. Uses LAST frame's
      // contacts (the same one-frame delay as event.collisionEnter); the inherited kick is queued through
      // pendingPartKicks so it lands once the rebuilt dynamic body exists (next frame's physics sync).
      for (const contact of state.runtimeCollisions) {
        for (let side = 0; side < 2; side++) {
          const propId = side === 0 ? contact.objectId : contact.otherObjectId;
          const otherId = side === 0 ? contact.otherObjectId : contact.objectId;
          const prop = activeObjectById.get(propId);
          const threshold = prop?.physics?.knockOverThreshold ?? 0;
          if (!prop || threshold <= 0 || prop.physics?.bodyType !== 'fixed' || nextPhysics[propId]) continue;
          // Impact severity: the event's PRE-IMPACT speed (the solver has already stopped the impactor
          // against this very prop by the time post-step velocity is readable).
          const vel = state.runtimeVelocities[otherId];
          const speed = contact.speed ?? (vel ? Math.hypot(vel[0], vel[2]) : 0);
          if (speed < threshold) continue;
          // Kick direction: the impactor's (possibly deflected) velocity if it's still meaningful,
          // else straight from the impactor toward the prop — scaled back up to the impact speed.
          let dirX = vel?.[0] ?? 0;
          let dirZ = vel?.[2] ?? 0;
          const dirLen = Math.hypot(dirX, dirZ);
          if (dirLen > 0.5) {
            dirX = (dirX / dirLen) * speed;
            dirZ = (dirZ / dirLen) * speed;
          } else {
            const other = activeObjectById.get(otherId);
            if (!other) continue;
            const dx = prop.transform.position[0] - other.transform.position[0];
            const dz = prop.transform.position[2] - other.transform.position[2];
            const len = Math.hypot(dx, dz) || 1;
            dirX = (dx / len) * speed;
            dirZ = (dz / len) * speed;
          }
          nextPhysics[propId] = { bodyType: 'dynamic' };
          pendingPartKicks.set(propId, {
            // Carried along with the impactor + popped slightly up; the spin tips it over the impact axis.
            vel: [dirX * 0.55, 1.6 + speed * 0.1, dirZ * 0.55],
            spin: [dirZ * 0.35, (Math.random() - 0.5) * 1.2, -dirX * 0.35],
          });
        }
      }
      // Targeted custom events (Fire Event with a Target) → delivered to that actor NEXT frame (one-frame
      // delay, like runtimeCollisions), since each object runs its own graph in its own context.
      const nextActorEvents: Record<string, string[]> = {};
      const incomingActorEvents = state.runtimeActorEvents ?? {};
      // Side effects collected while executing graphs this frame.
      const sounds: RuntimeSoundEvent[] = [];
      // Queue a sound; a world `position` makes it spatial (heard from where it happened), omitted = 2D.
      const pushSound = (assetId: string, position?: Vector3Tuple) => sounds.push({ assetId, position });
      const spawned: SceneObject[] = [];
      const destroyedIds = new Set<string>();
      const prints: string[] = [];
      let pendingCinematicId: string | undefined;
      // A Load Scene node fired this frame → switch the active scene at the end of the tick (project vars carry over).
      let pendingSceneId: string | undefined;
      // A Set Quality node fired this frame → apply the new scalability preset at the end of the tick.
      let pendingQuality: QualityLevel | undefined;
      // A Set Time Scale node fired this frame → applied at the end of the tick (next frame runs at the new speed).
      let pendingTimeScale: number | undefined;
      // action.setEnvironment patches accumulated this frame — sky/fog/sun overrides applied to the active
      // scene's environment at the end of the tick. Each successive node overlays on top.
      let pendingEnvironment: Partial<SceneEnvironmentSettings> | undefined;
      // Combat feedback counters (bumped on hits / when the local player is hurt) + per-enemy attack cooldowns.
      let hitMarker = state.runtimeHitMarker;
      let killMarker = state.runtimeKillMarker;
      let hurt = state.runtimeHurt;
      const nextEnemyCd: Record<string, number> = {};
      const meleeSwings = new Set<string>(); // characters that started an attack swing this frame (melee hit-test)
      // On lethal damage: a rigged target (character/animator) goes LIMP like the player (ragdoll), so it crumples
      // instead of vanishing; a simple prop (e.g. the target dummy) just despawns.
      // Destructibles already shattered this frame, so one hit doesn't spawn chunks twice.
      const fracturedIds = new Set<string>();
      /** Replace a destructible object with its dynamic box chunks, then remove the original.
       *  `origin` is the world-space hit point (smaller pieces near it, flung outward from it). */
      const fractureSource = (src: SceneObject | undefined, id: string, origin?: Vector3Tuple) => {
        if (!src || fracturedIds.has(id) || destroyedIds.has(id)) return false;
        fracturedIds.add(id);
        for (const chunk of makeFractureChunks(src, origin)) spawned.push(chunk);
        destroyedIds.add(id);
        return true;
      };
      const dieOrRagdoll = (target: SceneObject | undefined, id: string, origin?: Vector3Tuple) => {
        if (target && (target.character?.enabled || target.animator?.enabled)) setRagdoll(id, true);
        else if (target?.fracture?.enabled && fractureSource(target, id, origin)) return;
        else {
          // A plain enemy/health prop (e.g. a kinematic guard capsule) would otherwise just blink out — give
          // it a death burst at the kill point so a downed foe reads as a hit, not a despawn glitch.
          if (target && (target.variables?.enemy || target.variables?.health !== undefined)) {
            spawned.push(makeImpactObject(origin ?? target.transform.position, '#7e0f0f'));
          }
          destroyedIds.add(id);
        }
      };
      // Explosions: an object with an `explosive` instance var bursts on death (barrels, grenades) — queued here,
      // then processed after the hit passes so blasts can CHAIN (a barrel killed by another barrel explodes too).
      const explodeQueue: Array<{ pos: Vector3Tuple; dmg: number; radius: number; force?: number; byPlayer?: boolean }> = [];
      const exploded = new Set<string>();
      const killTarget = (target: SceneObject | undefined, id: string, origin?: Vector3Tuple) => {
        if (target?.variables?.explosive) {
          if (exploded.has(id)) return;
          exploded.add(id);
          destroyedIds.add(id);
          explodeQueue.push({
            pos: [...target.transform.position] as Vector3Tuple,
            dmg: toNumber(target.variables.explosionDamage ?? 60),
            radius: toNumber(target.variables.explosionRadius ?? 4.5),
            force: toNumber(target.variables.explosionForce ?? 16),
          });
        } else dieOrRagdoll(target, id, origin);
      };
      // Per-character movement-mode override (Set Movement Mode node) — persists across frames, updated by the
      // node in the script pass, then read by the character + animator passes below.
      const movementModeNow: Record<string, string> = { ...state.runtimeMovementMode };
      // The local player = the camera-follow character (drives hit marker / hurt flash / who enemies chase).
      const playerId = activeObjects.find((o) => o.character?.enabled && o.character.cameraFollow)?.id;
      const physicsFocusPoints = activeObjects
        .filter((o) => (o.character?.enabled && o.character.cameraFollow) || (o.vehicle?.enabled && o.vehicle.cameraFollow))
        .map((o) => o.transform.position);
      if (!physicsFocusPoints.length && playerId) {
        const player = activeObjectById.get(playerId);
        if (player) physicsFocusPoints.push(player.transform.position);
      }
      const physicsActivationRadius = 55;
      const shouldSimulatePhysicsObject = (o: SceneObject): boolean => {
        if (!o.physics?.enabled || o.physics.bodyType !== 'dynamic') return true;
        if (
          o.projectile ||
          o.character?.enabled ||
          o.vehicle?.enabled ||
          o.script?.enabled ||
          o.fracture?.enabled ||
          o.variables?.health !== undefined ||
          o.variables?.enemy ||
          o.variables?.explosive
        ) {
          return true;
        }
        if (!physicsFocusPoints.length) return true;
        const [x, y, z] = o.transform.position;
        const pad = Math.max(Math.abs(o.transform.scale[0]), Math.abs(o.transform.scale[1]), Math.abs(o.transform.scale[2]), 1);
        const limitSq = (physicsActivationRadius + pad) * (physicsActivationRadius + pad);
        return physicsFocusPoints.some(([fx, fy, fz]) => {
          const dx = x - fx;
          const dy = y - fy;
          const dz = z - fz;
          return dx * dx + dy * dy + dz * dz <= limitSq;
        });
      };
      // Objects hidden by action.setVisible — carried across frames so weapons stay holstered.
      const nextHidden = new Set<string>(state.runtimeHidden);
      // Deactivated objects (Set Active off): no render, no script, no physics body, ignored by AI. Persisted
      // across frames; toggled by the action.setActive node. Disabled ids are merged into runtimeHidden on output.
      const nextDisabled = new Set<string>(state.runtimeDisabled);
      // Cable runtime control (Cut Cable / Set Cable Length nodes). Cut owners persist for the session;
      // length overrides hold until changed again (a winch keeps its reeled length).
      const nextCutCables = new Set<string>(state.runtimeCutCables);
      const nextCableLength: Record<string, number> = { ...state.runtimeCableLength };
      // GTA-style vehicle possession (Enter/Exit Vehicle nodes). `nextOccupants` carries which pawn drives
      // which car across frames; the request arrays are this-frame edges the movedObjects pass applies as
      // component-flag flips (camera/HUD/vehicle-pass all read those flags, so control hands off + reverts on Stop).
      const nextOccupants: Record<string, string> = { ...state.runtimeVehicleOccupants };
      const vehicleEnter: Array<{ player: string; vehicle: string }> = [];
      const vehicleExit: Array<{ player: string; vehicle: string; offset: Vector3Tuple }> = [];
      // Animator parameter writes requested by animator.setX nodes this frame, keyed by object id.
      const animatorWrites: Record<string, Array<{ name: string; value: number | boolean; trigger?: boolean }>> = {};
      // One-shot montage requests this frame (Play Animation node + external HUD equips), keyed by target id.
      const animMontages: Record<string, { animationId: string; speed: number }> = { ...state.runtimeMontageRequests };
      // Character node requests this frame: object ids that fired a Jump node, and live camera overrides.
      const characterJumpRequests = new Set<string>();
      // Launch velocities for CHARACTERS this frame (jump pads, knockback): applyForce on a kinematic character
      // can't push a Rapier body, so it records a one-shot velocity here that the vertical pass applies instead.
      const characterLaunch: Record<string, Vector3Tuple> = {};
      const nextCameraOverrides: Record<string, { distance: number; height: number }> = { ...state.runtimeCameraOverrides };
      // Camera-shake trauma decays ~2/sec (a full 1.0 hit settles in ~0.5s). The Camera Shake node, the
      // player firing/being hurt, and explosions add to it below; the follow camera reads it and jitters.
      let cameraShake = Math.max(0, state.runtimeCameraShake - delta * 2);
      // Screen flash opacity decays ~3.3/sec (a full 1.0 pop fades in ~0.3s). Explosions + the Screen Flash
      // node bump it; GameHud renders a full-screen tinted overlay at this opacity.
      let flash = Math.max(0, state.runtimeFlash - delta * 3.3);
      let flashColor = state.runtimeFlashColor;
      // Roll/dodge + attack/reload/interact timers carried frame-to-frame (started on their key, counted down here).
      const nextRoll: Record<string, number> = {};
      const nextLockOn: Record<string, string> = {};
      const nextJumpBuffer: Record<string, number> = {};
      const nextLanding: Record<string, number> = {};
      const nextSlide: EditorState['runtimeSlide'] = {};
      const nextRollDir: EditorState['runtimeRollDir'] = {};
      const nextMantle: EditorState['runtimeMantle'] = {};
      const nextTurnInPlace: Record<string, number> = {};
      const nextCoyote: Record<string, number> = {};
      const nextAttack: Record<string, number> = {};
      const nextReload: Record<string, number> = {};
      const nextInteract: Record<string, number> = {};
      // Distance-since-last-footstep per character (carried across frames) → footstep audio cadence.
      const nextFootstep: Record<string, number> = { ...state.runtimeFootstep };
      // Cooldown gate timers per (object:node), decremented each frame; armed to N seconds when one passes.
      const nextCooldowns: Record<string, number> = {};
      for (const [key, remaining] of Object.entries(state.runtimeCooldowns)) {
        const left = remaining - (delta || 1 / 60);
        if (left > 0) nextCooldowns[key] = left;
      }
      // Latent Delay timers (key = `${objId}:${nodeId}`): decrement each frame; a timer that reaches 0
      // this frame fires its node's exec output via the resume pass below (and is dropped from the map).
      const nextDelays: Record<string, number> = {};
      const elapsedDelaysByObject = new Map<string, string[]>();
      for (const [key, remaining] of Object.entries(state.runtimeDelays)) {
        const left = remaining - (delta || 1 / 60);
        if (left > 0) {
          nextDelays[key] = left;
        } else {
          const sep = key.indexOf(':');
          const objId = key.slice(0, sep);
          const nodeId = key.slice(sep + 1);
          const list = elapsedDelaysByObject.get(objId);
          if (list) list.push(nodeId);
          else elapsedDelaysByObject.set(objId, [nodeId]);
        }
      }
      // Tween Property animations (key = `${ownerId}:${nodeId}`): advance each frame and write the eased
      // value onto the target via nextTransforms (applied before the character/physics passes, so moving
      // kinematic/fixed bodies follow). A tween that finishes this frame fires its node's "Done" pin via
      // the resume pass below (on the OWNER object, like Delay).
      const nextTweens: EditorState['runtimeTweens'] = {};
      const elapsedTweensByObject = new Map<string, string[]>();
      for (const [key, tween] of Object.entries(state.runtimeTweens)) {
        const time = tween.time + (delta || 1 / 60);
        const t = Math.min(1, time / Math.max(0.01, tween.duration));
        const eased =
          tween.easing === 'linear'
            ? t
            : tween.easing === 'easeIn'
              ? t * t
              : tween.easing === 'easeOut'
                ? 1 - (1 - t) * (1 - t)
                : t * t * (3 - 2 * t);
        const value: Vector3Tuple = [
          tween.from[0] + (tween.to[0] - tween.from[0]) * eased,
          tween.from[1] + (tween.to[1] - tween.from[1]) * eased,
          tween.from[2] + (tween.to[2] - tween.from[2]) * eased,
        ];
        const slot = (nextTransforms[tween.targetId] ??= {});
        if (tween.property === 'position') slot.position = value;
        else if (tween.property === 'rotation') slot.rotation = value;
        else slot.scale = value;
        if (t >= 1) {
          const sep = key.indexOf(':');
          const objId = key.slice(0, sep);
          const nodeId = key.slice(sep + 1);
          const list = elapsedTweensByObject.get(objId);
          if (list) list.push(nodeId);
          else elapsedTweensByObject.set(objId, [nodeId]);
        } else {
          nextTweens[key] = { ...tween, time };
        }
      }
      // "The player" for AI nodes (Distance/Direction/Face To Player) = the active follow-camera character.
      const aiPlayer = playerId ? activeObjectById.get(playerId) : undefined;

      // --- Interaction focus (Unreal-style): each character looks for the nearest object tagged with an
      //     `interactable` instance variable, within interactRange and roughly in front. The focused object
      //     is highlighted + prompted on screen (camera-follow character only); a rising edge on the interact
      //     key fires that object's event.interact this frame. ---
      const interactedThisFrame = new Set<string>();
      let interactFocusId: string | null = null;
      {
        const hiddenNow = new Set(state.runtimeHidden);
        // One pass collects interactables WITH their priority resolved, so the per-character loop below
        // does zero allocations (previously it spread a merged-vars object per interactable × character
        // × frame, the single biggest GC churn in the interaction pass).
        const interactables: Array<{ id: string; position: Vector3Tuple; priority: number }> = [];
        for (const o of activeObjects) {
          if (nextDisabled.has(o.id) || hiddenNow.has(o.id)) continue;
          const live = nextObjectVariables[o.id];
          const flag = live && 'interactable' in live ? live.interactable : o.variables?.interactable;
          if (!toBoolean(flag ?? false)) continue;
          const prio = live && 'interactPriority' in live ? live.interactPriority : o.variables?.interactPriority;
          interactables.push({ id: o.id, position: o.transform.position, priority: toNumber(prio ?? 0) });
        }
        if (interactables.length) {
          for (const char of activeObjects) {
            if (!char.character?.enabled || isRagdoll(char.id)) continue;
            // Only scan when the result could matter THIS frame: the camera-follow character needs the
            // focus highlight every frame, but an NPC's scan only matters while its interact key is down
            // (keys are global, so this preserves the exact firing semantics while skipping the O(N)
            // candidate walk for every idle NPC every frame).
            const isFollow = Boolean(char.character.cameraFollow);
            const interactKey = char.character.keyInteract ?? 'KeyE';
            // (keyPressedThisTick covers a tap that was already released before this tick ran.)
            if (!isFollow && !currentKeys[interactKey] && !keyPressedThisTick(interactKey)) continue;
            const cc = resolveCharacter(char.character);
            const range = Math.max(0.25, cc.interactRange ?? 3);
            const cp = char.transform.position;
            const yaw = cc.cameraFollow && cc.mouseLook ? mouseCameraYaw(cc.mouseSensitivity) : char.transform.rotation[1] - cc.modelYawOffset;
            const fwdX = Math.sin(yaw);
            const fwdZ = Math.cos(yaw);
            let best: { id: string; score: number } | null = null;
            for (const it of interactables) {
              if (it.id === char.id) continue;
              const dx = it.position[0] - cp[0];
              const dy = it.position[1] - cp[1];
              const dz = it.position[2] - cp[2];
              const horizontal = Math.hypot(dx, dz);
              const verticalLimit = Math.max(1.8, range * 0.75);
              if (Math.abs(dy) > verticalLimit) continue;
              const weightedDistance = Math.hypot(horizontal, Math.abs(dy) * 0.55);
              if (weightedDistance > range) continue;
              const dot = horizontal > 0.001 ? (dx / horizontal) * fwdX + (dz / horizontal) * fwdZ : 1;
              const nearOverride = horizontal <= Math.min(1.6, range * 0.42);
              if (!nearOverride && dot < (cc.cameraFollow ? -0.55 : -0.15)) continue;
              const score =
                it.priority * 3 +
                (1 - weightedDistance / range) * 2.4 +
                Math.max(0, dot) * 1.25 +
                (nearOverride ? 0.75 : 0) -
                Math.abs(dy) * 0.12;
              if (!best || score > best.score) best = { id: it.id, score };
            }
            if (best) {
              if (cc.cameraFollow) interactFocusId = best.id;
              const k = cc.keyInteract;
              const interactReady = (state.runtimeInteract[char.id] ?? 0) <= 0;
              if (k && (keyPressedThisTick(k) || (currentKeys[k] && interactReady))) interactedThisFrame.add(best.id);
            }
          }
        }
      }

      // Corpses (ragdolls) and projectiles must never count as line-of-sight blockers. This set is
      // identical for every `ai.hasLineOfSight` evaluation this frame, so build it once here instead
      // of rescanning all objects inside each enemy's evaluation.
      const aiLineOfSightExclude = new Set<string>();
      for (const o of activeObjects) if (o.projectile || isRagdoll(o.id) || nextDisabled.has(o.id)) aiLineOfSightExclude.add(o.id);

      // Per-tick memo for "Find Actor" nodes, keyed by `${ownerId}:${nodeId}`. A find is an O(n) scan;
      // caching the resolved id per (owner,node) collapses repeat evaluations within one frame to one scan
      // (e.g. a Cast + two Get Object Vars all reading the same Find Actor pin). '' = computed, none found.
      const findActorCache = new Map<string, string>();

      // Per-tick memo for "Has Save": readSaveSlot is a synchronous localStorage read + JSON.parse, so a
      // Has Save pin read in per-frame logic must hit storage once per slot per TICK, not per evaluation.
      // The Save/Clear Save action handlers update this cache in place so a same-tick check stays correct.
      const saveSlotHasCache = new Map<string, boolean>();

      // Per-tick candidate lists for actor queries (Find Actor / For Each Actor), keyed by the QUERY
      // itself rather than the evaluating node. Previously N enemies each finding the player cost N
      // full-scene scans per frame; now each distinct query scans the scene once per tick and every
      // evaluation filters the (small) cached list with its per-owner dynamic checks (self/destroyed/
      // disabled/ragdoll), which keeps the original semantics — including 'first' picking the earliest
      // match in scene order. Static exclusions (projectiles, effects) are baked into the list.
      const actorQueryCache = new Map<string, SceneObject[]>();
      const actorQueryCandidates = (kind: 'bp' | 'tag', a: string, b = ''): SceneObject[] => {
        const cacheKey = kind === 'bp' ? `bp:${a}` : `tag:${a}:${b}`;
        let list = actorQueryCache.get(cacheKey);
        if (list) return list;
        list = [];
        if (kind === 'bp') {
          for (const c of activeObjects) {
            if (c.projectile || c.effect) continue;
            if (c.script?.blueprintId === a) list.push(c);
          }
        } else {
          const tagKey = a;
          const tag = b;
          for (const c of activeObjects) {
            if (c.projectile || c.effect) continue;
            const listed = c.variables?.[tagKey];
            let match: boolean;
            if (!tag) {
              // No specific tag → match any actor that HAS the tag variable (flag-style, like `interactable`).
              match = listed !== undefined;
            } else {
              match = false;
              // (1) the tag is one of the comma-separated values in the tag variable (the Inspector chips),
              //     or the whole value equals the tag.
              if (listed !== undefined) {
                const sv = String(listed);
                if (sv === tag || tagTokens(sv).includes(tag)) match = true;
              }
              // (2) or the actor has a truthy instance variable literally NAMED the tag (flag idiom).
              if (!match) {
                const flag = c.variables?.[tag];
                if (flag !== undefined && flag !== false && flag !== 0 && flag !== '') match = true;
              }
            }
            if (match) list.push(c);
          }
        }
        actorQueryCache.set(cacheKey, list);
        return list;
      };

      // Per-tick memo for Raycast nodes (keyed `${ownerId}:${nodeId}`): one physics ray serves all four of
      // a Raycast node's outputs (Hit/Actor/Point/Distance) within the frame instead of casting per pin.
      const raycastCache = new Map<string, { hit: boolean; actor: string | undefined; point: Vector3Tuple; distance: number }>();

      // Per-tick memo for Overlap Sphere nodes (keyed `${ownerId}:${nodeId}`): one broadphase query serves
      // all three outputs (Hit/Actor/Count) within the frame instead of querying per pin.
      const overlapCache = new Map<string, { hit: boolean; actor: string | undefined; count: number }>();

      // Whether a graph event-root fires for `objectId` this frame. Hoisted out of the per-object
      // loop (defined once per tick, not per scripted object) and shared by BOTH the early-skip below
      // and the root dispatch further down, so the firing rules can't drift between the two.
      const eventRootFires = (node: NodeForgeNode, objectId: string): boolean => {
        switch (node.data.nodeKind) {
          case 'event.start':
            return !state.runtimeStarted;
          case 'event.update':
            return Number(node.data.numberValue ?? 0) > 0 ? firedTimers.has(`${objectId}:${node.id}`) : true;
          case 'event.keyDown':
            return Boolean(currentKeys[node.data.keyCode ?? 'KeyW']);
          case 'event.keyUp': {
            const keyCode = node.data.keyCode ?? 'KeyW';
            return Boolean(previousKeys[keyCode]) && !currentKeys[keyCode];
          }
          case 'event.custom': {
            const name = (node.data.eventName || 'CustomEvent').toLowerCase();
            // Global broadcast (UI buttons / no-target Fire Event) OR a targeted Fire Event aimed at THIS
            // actor last frame (one-frame-delayed delivery).
            return firedEvents.has(name) || (incomingActorEvents[objectId]?.includes(name) ?? false);
          }
          case 'event.collisionEnter':
            return contactMatches(priorCollisionIndex, objectId, node.data.otherObjectId);
          case 'event.collisionExit':
            return contactMatches(priorCollisionExitIndex, objectId, node.data.otherObjectId);
          case 'event.triggerEnter':
            return contactMatches(priorTriggerIndex, objectId, node.data.otherObjectId);
          case 'event.triggerExit':
            return contactMatches(priorTriggerExitIndex, objectId, node.data.otherObjectId);
          case 'event.interact':
            return interactedThisFrame.has(objectId);
          case 'event.receiveDamage':
            return (priorDamage[objectId] ?? 0) > 0;
          case 'event.timer':
            return firedTimers.has(`${objectId}:${node.id}`);
          default:
            return false;
        }
      };

      // Run each object's script graph. Physics-enabled objects are simulated by Rapier
      // in the post-pass below, so here we only collect scripted motion + side effects.
      const scriptsStart = performance.now();
      let mappedObjects = activeObjects.map((object) => {
          if (destroyedIds.has(object.id)) return object;
          // A deactivated object (Set Active off) runs no script.
          if (nextDisabled.has(object.id)) return object;
          // A limp (ragdolling) body doesn't run its scripts — so a dead enemy stops chasing/shooting.
          if (isRagdoll(object.id)) return object;
          // Bail before allocating anything for the common case: scriptless scenery (most of a
          // scene) keeps its existing object reference, so this map costs ~nothing for them.
          if (!object.script?.enabled) return object;
          const graphRuntime = graphRuntimes.get(object.script.graphId);
          if (!graphRuntime) return object;
          // Fast path for idle scripted objects (pickups/doors/enemies whose only events are
          // collision/trigger/interact/key, none firing this frame): if no event-root fires, the
          // dispatch below would run nothing and `changed` would stay false, so returning the object
          // unchanged is identical behavior — but skips the transform-tuple clones + roots array.
          if (
            !elapsedDelaysByObject.has(object.id) &&
            !elapsedTweensByObject.has(object.id) &&
            !graphRuntime.eventRoots.some((node) => eventRootFires(node, object.id))
          )
            return object;
          // Only scripted objects clone their transform tuples — a script may mutate these in place.
          const position = [...object.transform.position] as Vector3Tuple;
          const rotation = [...object.transform.rotation] as Vector3Tuple;
          const scale = [...object.transform.scale] as Vector3Tuple;
          let changed = false;
          // Per-object material overrides (Unreal-MID style) written by "Set Material" nodes — never the shared definition.
          let nextRenderer = object.renderer;
          const runtime = graphRuntime;

          // One cycle-guard set reused across every value-input evaluation for this object instead of
          // a fresh `new Set` per edge. Cleared and re-seeded with the consumer node at each top-level
          // call, so each traversal still starts clean — identical semantics, far less GC churn.
          const valueVisited = new Set<string>();
          // Coerce any graph value into a [x,y,z] tuple — used by the vector-math nodes (a non-vector
          // input degrades to the origin rather than throwing).
          const asVec3 = (value: GraphValue | undefined): Vector3Tuple =>
            Array.isArray(value)
              ? [Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0]
              : [0, 0, 0];
          // ⚠️ The evaluator functions below are `const` arrows ON PURPOSE: `function` declarations are
          // instantiated at scope ENTRY, so every object in the scene — including the scriptless scenery
          // that early-returns above — paid four closure allocations per frame. As consts they only
          // exist for objects that actually run a script this tick. (Mutual references between them are
          // fine: nothing calls them until the event-root dispatch at the bottom, after all are defined.)
          const valueInput = (node: NodeForgeNode, handle: string, fallback?: GraphValue): GraphValue | undefined => {
            const edge = runtime.incomingValueByHandle.get(node.id)?.get(handle);
            if (!edge) return fallback;
            valueVisited.clear();
            valueVisited.add(node.id);
            // Pass which OUTPUT pin of the source we're reading, so multi-output value nodes (Raycast:
            // Hit/Actor/Point/Distance) can return a different value per handle.
            const resolved = evaluateValue(edge.source, valueVisited, edge.sourceHandle ?? 'value-out');
            // Live value trace (no-op unless a graph editor is open in Play): record the value flowing
            // out of the source node so the editor can show it on the node.
            recordValue(edge.source, resolved);
            return resolved;
          }

          const evaluateValue = (nodeId: string, visited: Set<string>, sourceHandle = 'value-out'): GraphValue | undefined => {
            if (visited.has(nodeId)) return undefined;
            visited.add(nodeId);
            const node = runtime.nodesById.get(nodeId);
            if (!node) return undefined;
            const kind = node.data.nodeKind;
            switch (kind) {
            case 'value.number': return Number(node.data.numberValue ?? 0);
            case 'value.string': return node.data.stringValue ?? '';
            case 'value.boolean': return Boolean(node.data.booleanValue);
            case 'value.vector3': return node.data.vectorValue ?? [0, 0, 0];

            case 'value.random': {
              const lo = toNumber(valueInput(node, 'min', Number(node.data.randomMin ?? 0)));
              const hi = toNumber(valueInput(node, 'max', Number(node.data.randomMax ?? 1)));
              const min = Math.min(lo, hi);
              const max = Math.max(lo, hi);
              if (node.data.randomInteger) return Math.floor(Math.random() * (Math.floor(max) - Math.ceil(min) + 1)) + Math.ceil(min);
              return min + Math.random() * (max - min);
            }

            // For Loop's value-out = the current 0-based iteration index (0 when not iterating).
            case 'logic.forLoop': return loopIndex.get(nodeId) ?? 0;

            // Function entry's A/B/C value-outs = the CURRENT call's arguments (top call frame).
            case 'event.functionEntry': {
              const frame = functionFrames[functionFrames.length - 1];
              if (!frame) return undefined;
              return sourceHandle === 'arg-b' ? frame.args[1] : sourceHandle === 'arg-c' ? frame.args[2] : frame.args[0];
            }

            // Call Function's Return pin = whatever a Return node set during this node's LAST call.
            case 'logic.callFunction': return callReturns.get(nodeId);

            // Spawn Prefab's value-out = a reference to the actor it most recently spawned.
            case 'action.spawnPrefab': return lastSpawnedByNode.get(nodeId);

            // Custom Event's value-out = the payload the firing Fire Event carried (last one per name).
            case 'event.custom': {
              return eventPayloads[(node.data.eventName || 'CustomEvent').toLowerCase()];
            }

            // For Each Actor's value-out = the current iteration's actor reference (a wired Body chain reads it).
            case 'logic.forEachActor': return forEachCurrent.get(nodeId);

            // On Receive Damage's value-out = how much HP this object lost on the hit that fired the event.
            case 'event.receiveDamage': return priorDamage[object.id] ?? 0;

            case 'input.move': {
              // Move direction from the character's key bindings (falls back to WASD), normalized.
              // Camera-relative when the character uses mouse-look so "forward" follows the view.
              const cc = object.character;
              const fwd = cc?.keyForward ?? 'KeyW';
              const back = cc?.keyBackward ?? 'KeyS';
              const left = cc?.keyLeft ?? 'KeyA';
              const right = cc?.keyRight ?? 'KeyD';
              let ix = 0;
              let iz = 0;
              if (currentKeys[fwd] || currentKeys.ArrowUp) iz += 1;
              if (currentKeys[back] || currentKeys.ArrowDown) iz -= 1;
              if (currentKeys[left] || currentKeys.ArrowLeft) ix += 1;
              if (currentKeys[right] || currentKeys.ArrowRight) ix -= 1;
              // Gamepad left stick (analog): stick right = -X here (left is +1), stick up = forward.
              ix -= gamepadInput.moveX;
              iz += gamepadInput.moveY;
              const length = Math.hypot(ix, iz);
              if (length < 0.001) return [0, 0, 0] as Vector3Tuple;
              // Keep analog magnitude (≤1) so a half-tilted stick walks; keys still produce unit vectors.
              const magnitude = Math.min(1, length);
              let dirX = (ix / length) * magnitude;
              let dirZ = (iz / length) * magnitude;
              if (cc?.cameraRelativeMovement && cc.mouseLook) {
                const yaw = mouseCameraYaw(cc.mouseSensitivity);
                const cos = Math.cos(yaw);
                const sin = Math.sin(yaw);
                [dirX, dirZ] = [dirX * cos + dirZ * sin, -dirX * sin + dirZ * cos];
              }
              return [dirX, 0, dirZ] as Vector3Tuple;
            }

            case 'query.vehicleSpeed': {
              const v = nextVelocities[object.id];
              return v ? Math.hypot(v[0], v[2]) : 0;
            }

            case 'input.driveInput': {
              // Vehicle input → [throttle (W=+1/S=-1), steer (A=+1/D=-1), handbrake (Space=1/0)]. Reads the
              // owner Vehicle's key bindings so the graph is fully editable (rebind keys, gate it, etc.).
              const veh = object.vehicle;
              const kThrottle = veh?.keyThrottle ?? 'KeyW';
              const kReverse = veh?.keyReverse ?? 'KeyS';
              const kLeft = veh?.keyLeft ?? 'KeyA';
              const kRight = veh?.keyRight ?? 'KeyD';
              const kHand = veh?.keyHandbrake ?? 'Space';
              // Gamepad: RT/LT are analog throttle/brake, left stick X steers (stick right = steer right = -1 here).
              const throttle = Math.max(
                -1,
                Math.min(
                  1,
                  (currentKeys[kThrottle] ? 1 : 0) - (currentKeys[kReverse] ? 1 : 0) + gamepadInput.throttle - gamepadInput.brake,
                ),
              );
              const steer = Math.max(
                -1,
                Math.min(1, (currentKeys[kLeft] ? 1 : 0) - (currentKeys[kRight] ? 1 : 0) - gamepadInput.moveX),
              );
              const hand = currentKeys[kHand] ? 1 : 0;
              return [throttle, steer, hand] as Vector3Tuple;
            }

            case 'query.grounded': {
              return position[1] <= (object.character?.groundLevel ?? 0) + 0.05;
            }

            // Has Save: true when the slot holds saved data — gate a "Continue" button / skip-intro branch.
            case 'save.has': {
              const slot = node.data.saveSlot ?? 'slot1';
              let has = saveSlotHasCache.get(slot);
              if (has === undefined) {
                has = readSaveSlot(slot) !== null;
                saveSlotHasCache.set(slot, has);
              }
              return has;
            }

            // Find Actor (Unreal Get Actor Of Class / With Tag): scan the live scene for an actor matching a
            // blueprint or an instance-var "tag", returning its id (a reference). Skips self, the dead
            // (ragdolls), and transient projectiles/effects. 'first' breaks early (cheap); 'nearest' keeps the
            // closest by squared horizontal distance (no sqrt). Memoized per (owner,node) for the frame.
            case 'query.findActorByBlueprint':
            case 'query.findActorByTag': {
              const cacheKey = `${object.id}:${nodeId}`;
              const memo = findActorCache.get(cacheKey);
              if (memo !== undefined) return memo || undefined;

              const byTag = kind === 'query.findActorByTag';
              const blueprintId = node.data.castBlueprintId;
              // `tag` = the tag to find (the prominent field; matches the Inspector "Tags" chips).
              // `tagKey` = which instance variable holds the tag list (default 'tags', what the Tags UI writes).
              const tag = typeof node.data.stringValue === 'string' ? node.data.stringValue.trim() : '';
              const tagKey = node.data.objectKey || 'tags';
              const nearest = node.data.findMode === 'nearest';
              // A blueprint find with no blueprint chosen can't match anything — bail (avoids a scan).
              if (!byTag && !blueprintId) {
                findActorCache.set(cacheKey, '');
                return undefined;
              }
              let best: string | undefined;
              let bestDist = Infinity;
              // Static predicate (blueprint / tag / projectile / effect) is resolved by the shared
              // per-tick candidate list — one scene scan per DISTINCT query per frame, not per node.
              const candidates = byTag ? actorQueryCandidates('tag', tagKey, tag) : actorQueryCandidates('bp', blueprintId!);
              for (const candidate of candidates) {
                if (candidate.id === object.id || destroyedIds.has(candidate.id) || nextDisabled.has(candidate.id)) continue;
                if (isRagdoll(candidate.id)) continue;
                if (!nearest) {
                  best = candidate.id;
                  break;
                }
                const cp = candidate.transform.position;
                const dist = (cp[0] - position[0]) ** 2 + (cp[2] - position[2]) ** 2;
                if (dist < bestDist) {
                  bestDist = dist;
                  best = candidate.id;
                }
              }
              findActorCache.set(cacheKey, best ?? '');
              return best;
            }

            // Raycast: one ray, four outputs (selected by sourceHandle). Origin = owner chest; direction =
            // a wired Vector3 or the owner's forward; length = wired number or the node's distance field.
            case 'query.raycast': {
              const cacheKey = `${object.id}:${nodeId}`;
              let result = raycastCache.get(cacheKey);
              if (!result) {
                const maxDistance = Math.max(0.01, toNumber(valueInput(node, 'distance', Number(node.data.numberValue ?? 20))));
                const dirInput = valueInput(node, 'direction');
                let dir: Vector3Tuple;
                if (Array.isArray(dirInput) && (dirInput[0] || dirInput[1] || dirInput[2])) {
                  dir = [Number(dirInput[0]) || 0, Number(dirInput[1]) || 0, Number(dirInput[2]) || 0];
                } else {
                  const facing = rotation[1] - (object.character?.modelYawOffset ?? 0);
                  dir = [Math.sin(facing), 0, Math.cos(facing)];
                }
                const dl = Math.hypot(dir[0], dir[1], dir[2]) || 1;
                const nd: Vector3Tuple = [dir[0] / dl, dir[1] / dl, dir[2] / dl];
                const origin: Vector3Tuple = [position[0], position[1] + 0.9, position[2]];
                const phys = getActivePhysics();
                let hitRes: { objectId: string; distance: number } | null = null;
                if (phys) {
                  const hadSelf = aiLineOfSightExclude.has(object.id);
                  if (!hadSelf) aiLineOfSightExclude.add(object.id);
                  hitRes = phys.castRay(origin, nd, maxDistance, aiLineOfSightExclude);
                  if (!hadSelf) aiLineOfSightExclude.delete(object.id);
                }
                const dist = hitRes ? hitRes.distance : maxDistance;
                result = {
                  hit: Boolean(hitRes),
                  actor: hitRes?.objectId,
                  point: [origin[0] + nd[0] * dist, origin[1] + nd[1] * dist, origin[2] + nd[2] * dist],
                  distance: dist,
                };
                raycastCache.set(cacheKey, result);
              }
              if (sourceHandle === 'actor') return result.actor;
              if (sourceHandle === 'point') return [result.point[0], result.point[1], result.point[2]] as Vector3Tuple;
              if (sourceHandle === 'distance') return result.distance;
              return result.hit; // 'value-out' = Hit (bool)
            }

            // Overlap Sphere: one broadphase ball query, three outputs (Hit/Actor/Count) by sourceHandle.
            // Center = a wired Vector3 or the owner's position; radius = wired number or the node's field.
            // "Actor" is the NEAREST overlapping solid actor — the idiomatic "who's in range" for AoE/abilities.
            case 'query.overlapSphere': {
              const cacheKey = `${object.id}:${nodeId}`;
              let result = overlapCache.get(cacheKey);
              if (!result) {
                const radius = Math.max(0.01, toNumber(valueInput(node, 'radius', Number(node.data.numberValue ?? 5))));
                const centerInput = valueInput(node, 'location');
                const center: Vector3Tuple = Array.isArray(centerInput)
                  ? [Number(centerInput[0]) || 0, Number(centerInput[1]) || 0, Number(centerInput[2]) || 0]
                  : [position[0], position[1], position[2]];
                const phys = getActivePhysics();
                const ids = phys ? phys.overlapSphere(center, radius, new Set([object.id])) : [];
                let nearest: string | undefined;
                let nearestDist = Infinity;
                for (const id of ids) {
                  const other = activeObjectById.get(id);
                  if (!other) continue;
                  const op = other.transform.position;
                  const d = (op[0] - center[0]) ** 2 + (op[1] - center[1]) ** 2 + (op[2] - center[2]) ** 2;
                  if (d < nearestDist) {
                    nearestDist = d;
                    nearest = id;
                  }
                }
                result = { hit: ids.length > 0, actor: nearest, count: ids.length };
                overlapCache.set(cacheKey, result);
              }
              if (sourceHandle === 'actor') return result.actor;
              if (sourceHandle === 'count') return result.count;
              return result.hit; // 'value-out' = Hit (bool)
            }

            // Get Cable Tension: current stretch ratio (end-to-end distance ÷ length). ~1 at rest, >1 taut.
            case 'query.cableTension': {
              const target = resolveTarget(node.data.targetObjectId) || object.id;
              const owner = activeObjectById.get(target);
              const cab = owner?.cable;
              if (!cab) return 0;
              let endId = cab.endObjectId;
              if (cab.followJoint) {
                if (owner.joint?.connectedObjectId) endId = owner.joint.connectedObjectId;
                else endId = activeObjects.find((o) => o.joint?.enabled && o.joint.connectedObjectId === target)?.id ?? endId;
              }
              const endObj = endId ? activeObjectById.get(endId) : undefined;
              if (!endObj) return 0;
              const a = owner.transform.position;
              const b = endObj.transform.position;
              const dist = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
              const len = Math.max(nextCableLength[target] ?? cab.length, 0.05);
              return dist / len;
            }

            // Get Velocity: an actor's current velocity [x,y,z]. Tracked in nextVelocities for dynamic bodies
            // (written back from the physics step), characters, and vehicles.
            case 'query.velocity': {
              const tid = objectVarTarget(node);
              const v = nextVelocities[tid];
              return (v ? [v[0], v[1], v[2]] : [0, 0, 0]) as Vector3Tuple;
            }

            case 'ai.distanceToPlayer': {
              if (!aiPlayer || aiPlayer.id === object.id) return 9999;
              const p = aiPlayer.transform.position;
              return Math.hypot(p[0] - position[0], p[2] - position[2]);
            }

            case 'ai.directionToPlayer': {
              if (!aiPlayer || aiPlayer.id === object.id) return [0, 0, 0] as Vector3Tuple;
              const p = aiPlayer.transform.position;
              const dx = p[0] - position[0];
              const dz = p[2] - position[2];
              const len = Math.hypot(dx, dz) || 1;
              return [dx / len, 0, dz / len] as Vector3Tuple;
            }

            case 'ai.playerLocation': {
              const p = aiPlayer?.transform.position;
              return (p ? [p[0], p[1], p[2]] : [0, 0, 0]) as Vector3Tuple;
            }

            case 'ai.hasLineOfSight': {
              // True if a chest-to-chest ray from this object to the player isn't blocked by solid
              // geometry (walls, doors, cover). Used by enemy brains to gate Move + Spawn Projectile so
              // they don't chase or shoot through walls. Defaults to true when the player or the
              // physics world aren't ready yet (first few frames after Play).
              if (!aiPlayer || aiPlayer.id === object.id) return false;
              const phys = getActivePhysics();
              if (!phys) return true;
              // Perception runs at ~20 Hz, not the full tick rate: serve a recent cached result if one
              // exists (≤50 ms old), so a scene of N enemies costs ~N/3 raycasts/frame, not N. Also
              // collapses repeat evaluations of this same node within one frame.
              const cachedLos = cachedLineOfSight(object.id);
              if (cachedLos !== undefined) return cachedLos;
              const pp = aiPlayer.transform.position;
              const ep = position;
              const ox = ep[0];
              const oy = ep[1] + 0.9;
              const oz = ep[2];
              const dx = pp[0] - ox;
              const dy = pp[1] + 0.9 - oy;
              const dz = pp[2] - oz;
              const dist = Math.hypot(dx, dy, dz);
              if (dist < 1e-4) return true;
              // Reuse the shared corpse/projectile exclude set; temporarily add this caster's own id
              // (restoring afterward) so we don't allocate a fresh set per evaluation.
              const selfAlreadyExcluded = aiLineOfSightExclude.has(object.id);
              if (!selfAlreadyExcluded) aiLineOfSightExclude.add(object.id);
              const hit = phys.castRay([ox, oy, oz], [dx, dy, dz], dist, aiLineOfSightExclude);
              if (!selfAlreadyExcluded) aiLineOfSightExclude.delete(object.id);
              const visible = !hit || hit.objectId === aiPlayer.id || hit.distance >= dist - 0.15;
              storeLineOfSight(object.id, visible);
              return visible;
            }

            case 'animator.getParam': {
              // Read the live animator parameter (previous frame) — from self, or another object's animator.
              const targetId = node.data.targetObjectId || object.id;
              const targetObj = targetId === object.id ? object : activeObjectById.get(targetId);
              const controller = targetObj?.animator?.controllerId ? controllerById.get(targetObj.animator.controllerId) : undefined;
              const controllerRuntime = controller ? getAnimatorControllerRuntime(controller) : undefined;
              const param = controllerRuntime?.paramsByName.get(node.data.paramName ?? '');
              const live = state.runtimeAnimators[targetId];
              if (param) return (live?.params[param.id] ?? param.defaultValue) as GraphValue;
              return 0;
            }

            case 'animator.getState': {
              const targetId = node.data.targetObjectId || object.id;
              const targetObj = targetId === object.id ? object : activeObjectById.get(targetId);
              const controller = targetObj?.animator?.controllerId ? controllerById.get(targetObj.animator.controllerId) : undefined;
              const controllerRuntime = controller ? getAnimatorControllerRuntime(controller) : undefined;
              const stateId = state.runtimeAnimators[targetId]?.stateId ?? controller?.defaultStateId;
              return stateId ? controllerRuntime?.statesById.get(stateId)?.name ?? '' : '';
            }

            case 'variable.get': {
              if (node.data.variableId) {
                const variable = variableById.get(node.data.variableId);
                return variable ? cloneGraphValue(nextVariableValues[variable.id] ?? variable.defaultValue) : undefined;
              }
              // Instance variable picked in the Get Variable dropdown → read THIS object's (self) value.
              if (node.data.objectKey) {
                return cloneGraphValue(
                  nextObjectVariables[object.id]?.[node.data.objectKey] ?? object.variables?.[node.data.objectKey] ?? 0,
                );
              }
              return undefined;
            }

            case 'variable.getObject': {
              const key = node.data.objectKey || '';
              // Target comes from the wired reference input (a Cast's "As" pin) or the targetObjectId sentinel —
              // so a script can READ another actor's instance variable (then e.g. increment it).
              const targetId = objectVarTarget(node);
              return cloneGraphValue(
                nextObjectVariables[targetId]?.[key] ?? activeObjectById.get(targetId)?.variables?.[key] ?? 0,
              );
            }

            // Cast's value-out ("As <Blueprint>"): the validated actor id, or undefined if it isn't that blueprint.
            case 'logic.cast': {
              const wired = valueInput(node, 'object');
              const targetId = (typeof wired === 'string' && wired) || resolveTarget(node.data.targetObjectId) || object.id;
              const targetObj = activeObjectById.get(targetId);
              return targetObj && (!node.data.castBlueprintId || targetObj.script?.blueprintId === node.data.castBlueprintId)
                ? targetId
                : undefined;
            }

            case 'data.tableGet': {
              const table = node.data.tableId ? dataAssetById.get(node.data.tableId) : undefined;
              const column = table && node.data.columnId ? indexTableColumnsById(table.columns).get(node.data.columnId) : undefined;
              const rowKey = graphValueToString(valueInput(node, 'rowKey', node.data.rowKey ?? ''));
              const row = table ? indexTableRowsByKey(table.rows).get(rowKey) : undefined;
              return column && row ? cloneGraphValue(row.values[column.id] ?? defaultValueForType(column.type)) : undefined;
            }

            case 'math.add': {
              return toNumber(valueInput(node, 'a', Number(node.data.numberValue ?? 0))) + toNumber(valueInput(node, 'b', Number(node.data.amount ?? 0)));
            }

            case 'math.clamp': {
              const value = toNumber(valueInput(node, 'value', Number(node.data.numberValue ?? 0)));
              const min = toNumber(valueInput(node, 'min', 0));
              const max = toNumber(valueInput(node, 'max', Number(node.data.amount ?? 1)));
              return Math.min(Math.max(value, min), max);
            }

            case 'math.lerp': {
              const a = toNumber(valueInput(node, 'a', 0));
              const b = toNumber(valueInput(node, 'b', Number(node.data.amount ?? 1)));
              const t = Math.min(Math.max(toNumber(valueInput(node, 't', Number(node.data.numberValue ?? 0.5))), 0), 1);
              return a + (b - a) * t;
            }

            case 'math.mapRange': {
              const value = toNumber(valueInput(node, 'value', Number(node.data.numberValue ?? 0)));
              const inMin = toNumber(valueInput(node, 'inMin', 0));
              const inMax = toNumber(valueInput(node, 'inMax', 1));
              const outMin = toNumber(valueInput(node, 'outMin', 0));
              const outMax = toNumber(valueInput(node, 'outMax', 1));
              const span = inMax - inMin;
              const t = span === 0 ? 0 : Math.min(Math.max((value - inMin) / span, 0), 1); // clamped
              return outMin + (outMax - outMin) * t;
            }

            case 'math.floor': {
              return Math.floor(toNumber(valueInput(node, 'value', Number(node.data.numberValue ?? 0))));
            }

            case 'math.vectorLength': {
              const v = asVec3(valueInput(node, 'vector'));
              return Math.hypot(v[0], v[1], v[2]);
            }

            case 'math.dot': {
              const a = asVec3(valueInput(node, 'a'));
              const b = asVec3(valueInput(node, 'b'));
              return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
            }

            case 'math.subtract': {
              return toNumber(valueInput(node, 'a', 0)) - toNumber(valueInput(node, 'b', 0));
            }

            case 'math.multiply': {
              return toNumber(valueInput(node, 'a', 0)) * toNumber(valueInput(node, 'b', 0));
            }

            case 'math.divide': {
              const b = toNumber(valueInput(node, 'b', 0));
              return b === 0 ? 0 : toNumber(valueInput(node, 'a', 0)) / b;
            }

            case 'math.modulo': {
              const b = toNumber(valueInput(node, 'b', 0));
              return b === 0 ? 0 : toNumber(valueInput(node, 'a', 0)) % b;
            }

            case 'math.abs': return Math.abs(toNumber(valueInput(node, 'value', 0)));
            case 'math.min': return Math.min(toNumber(valueInput(node, 'a', 0)), toNumber(valueInput(node, 'b', 0)));
            case 'math.max': return Math.max(toNumber(valueInput(node, 'a', 0)), toNumber(valueInput(node, 'b', 0)));
            case 'math.round': {
              const value = toNumber(valueInput(node, 'value', 0));
              const mode = node.data.roundMode ?? 'round';
              return mode === 'floor' ? Math.floor(value) : mode === 'ceil' ? Math.ceil(value) : Math.round(value);
            }
            case 'math.power': return Math.pow(toNumber(valueInput(node, 'a', 0)), toNumber(valueInput(node, 'b', 2)));
            // Sin/Cos take DEGREES (matching Set Rotation's authoring convention).
            case 'math.sin': return Math.sin((toNumber(valueInput(node, 'value', 0)) * Math.PI) / 180);
            case 'math.cos': return Math.cos((toNumber(valueInput(node, 'value', 0)) * Math.PI) / 180);

            // Append: text join (numbers/bools stringify naturally) — HUD labels, print messages.
            case 'string.append': {
              const a = valueInput(node, 'a', node.data.stringValue ?? '');
              const b = valueInput(node, 'b', '');
              return `${a ?? ''}${b ?? ''}`;
            }

            // Select: the value-side Branch — condition ? A : B, any types.
            case 'logic.select': {
              return toBoolean(valueInput(node, 'condition', false)) ? valueInput(node, 'a') : valueInput(node, 'b');
            }

            // --- Vector math (read inputs as [x,y,z] tuples) ---
            case 'math.distance': {
              const a = asVec3(valueInput(node, 'a'));
              const b = asVec3(valueInput(node, 'b'));
              return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
            }

            case 'math.vectorAdd': {
              const a = asVec3(valueInput(node, 'a'));
              const b = asVec3(valueInput(node, 'b'));
              return [a[0] + b[0], a[1] + b[1], a[2] + b[2]] as Vector3Tuple;
            }

            case 'math.vectorSubtract': {
              const a = asVec3(valueInput(node, 'a'));
              const b = asVec3(valueInput(node, 'b'));
              return [a[0] - b[0], a[1] - b[1], a[2] - b[2]] as Vector3Tuple;
            }

            case 'math.vectorScale': {
              const v = asVec3(valueInput(node, 'vector'));
              const s = toNumber(valueInput(node, 'scale', 1));
              return [v[0] * s, v[1] * s, v[2] * s] as Vector3Tuple;
            }

            case 'math.normalize': {
              const v = asVec3(valueInput(node, 'value'));
              const len = Math.hypot(v[0], v[1], v[2]) || 1;
              return [v[0] / len, v[1] / len, v[2] / len] as Vector3Tuple;
            }

            case 'math.makeVector': {
              return [
                toNumber(valueInput(node, 'x', 0)),
                toNumber(valueInput(node, 'y', 0)),
                toNumber(valueInput(node, 'z', 0)),
              ] as Vector3Tuple;
            }

            case 'logic.not': {
              return !toBoolean(valueInput(node, 'value', false));
            }

            // Read an actor's transform (Unreal GetActorLocation/Rotation/Scale). Target resolves via the wired
            // "target" reference or the targetObjectId sentinel ($self/$player/$trigger/$cast), default self. For
            // self we read the LIVE arrays (reflecting this-frame mutations); other actors read their transform.
            case 'action.getPosition':
            case 'action.getRotation':
            case 'action.getScale': {
              const targetId = objectVarTarget(node);
              const self = targetId === object.id;
              const tf = self ? undefined : activeObjectById.get(targetId)?.transform;
              if (kind === 'action.getPosition') {
                const p = self ? position : tf?.position;
                return (p ? [p[0], p[1], p[2]] : [0, 0, 0]) as Vector3Tuple;
              }
              if (kind === 'action.getScale') {
                const s = self ? scale : tf?.scale;
                return (s ? [s[0], s[1], s[2]] : [1, 1, 1]) as Vector3Tuple;
              }
              // getRotation → Euler DEGREES
              const r = self ? rotation : tf?.rotation;
              const d = 180 / Math.PI;
              return (r ? [r[0] * d, r[1] * d, r[2] * d] : [0, 0, 0]) as Vector3Tuple;
            }

            case 'logic.compare': {
              return compareValues(valueInput(node, 'a', 0), valueInput(node, 'b', Number(node.data.numberValue ?? 0)), node.data.compareOp ?? '==');
            }

            case 'logic.and': {
              return toBoolean(valueInput(node, 'a', false)) && toBoolean(valueInput(node, 'b', false));
            }

            case 'logic.or': {
              return toBoolean(valueInput(node, 'a', false)) || toBoolean(valueInput(node, 'b', false));
            }

            // Read this object's CURRENT effective material (base + graph + overrides written so far this frame).
            case 'action.getMaterialColor': {
              return resolveMaterial(nextRenderer, state.materials, state.graphs).color;
            }

            case 'action.getMaterialProperty': {
              const current = resolveMaterial(nextRenderer, state.materials, state.graphs);
              const property = node.data.materialProperty ?? 'metalness';
              return property in current ? (current as unknown as Record<string, GraphValue>)[property] : undefined;
            }
            }
            return undefined;
          }

          const executeFrom = (nodeId: string, visited: Set<string>) => {
            if (visited.has(nodeId)) return;
            visited.add(nodeId);
            const node = runtime.nodesById.get(nodeId);
            if (!node) return;
            // Per-node error isolation: a throw below is recorded against THIS node (so the editor can
            // badge the exact failing node) and swallowed, so one broken node never aborts its siblings
            // or the frame. The innermost executeFrom frame catches first → precise attribution.
            try {
            // Feed the editor's exec-flow visualization (no-op unless a graph editor is open in Play).
            markExec(nodeId);
            // Call Function: run the named "Function" entry's chain synchronously (a reusable subgraph —
            // Unreal Blueprint function-lite), then continue this chain. Each call gets a fresh visited
            // set so the body re-runs on every call; the depth cap stops runaway recursion. Arguments
            // (the A/B/C pins) evaluate ONCE before the body runs and are exposed on the Function entry's
            // value-outs; a Return node inside the body sets what this node's Return pin reads.
            if (node.data.nodeKind === 'logic.callFunction') {
              const fnName = (node.data.functionName || 'MyFunction').toLowerCase();
              if (functionDepth < 16) {
                functionDepth += 1;
                const frame: FunctionFrame = {
                  args: [valueInput(node, 'a'), valueInput(node, 'b'), valueInput(node, 'c')],
                  ret: undefined,
                };
                functionFrames.push(frame);
                for (const entry of runtime.functionRoots.get(fnName) ?? []) {
                  markExec(entry.id);
                  (runtime.outgoing.get(entry.id) ?? []).forEach((targetId) => executeFrom(targetId, new Set([entry.id])));
                }
                functionFrames.pop();
                callReturns.set(nodeId, frame.ret);
                functionDepth -= 1;
              }
              (runtime.outgoing.get(nodeId) ?? []).forEach((targetId) => executeFrom(targetId, visited));
              return;
            }

            // Switch: route execution by VALUE — the state-machine node. The wired value is stringified
            // and matched against the editable case list; the matching case pin fires, else Default.
            if (node.data.nodeKind === 'logic.switch') {
              const raw = valueInput(node, 'value', node.data.numberValue ?? '');
              const value = String(raw ?? '');
              const index = (node.data.switchCases ?? []).indexOf(value);
              if (index >= 0) {
                (runtime.outgoingByHandle.get(nodeId)?.get(`case-${index}`) ?? []).forEach((targetId) => executeFrom(targetId, visited));
              } else {
                (runtime.outgoing.get(nodeId) ?? []).forEach((targetId) => executeFrom(targetId, visited));
              }
              return;
            }

            // Sequence: fire Then 0 → Then 1 → Then 2 in order, same frame — readable parallel lanes.
            if (node.data.nodeKind === 'logic.sequence') {
              for (const handle of ['then-0', 'then-1', 'then-2']) {
                (runtime.outgoingByHandle.get(nodeId)?.get(handle) ?? []).forEach((targetId) => executeFrom(targetId, visited));
              }
              return;
            }

            // Flip Flop: alternate A / B per trigger. The toggle lives in the owner's instance-variable
            // bag (keyed by node id), so it persists across frames and resets cleanly when Play stops.
            if (node.data.nodeKind === 'logic.flipFlop') {
              const bag = mutableObjectVars(object.id, object.variables);
              const key = `__flip:${node.id}`;
              const fireA = !toBoolean(bag[key] ?? false);
              bag[key] = fireA;
              (runtime.outgoingByHandle.get(nodeId)?.get(fireA ? 'flip-a' : 'flip-b') ?? []).forEach((targetId) => executeFrom(targetId, visited));
              return;
            }

            // For Loop: fire the "Body" pin N times (exposing the index on the value-out), then fall through
            // to the default "exec-out" pin ("Completed"). Each iteration gets a fresh visited set seeded with
            // this node so the body re-runs every pass but can't re-enter the loop (no infinite recursion).
            if (node.data.nodeKind === 'logic.forLoop') {
              const raw = Math.floor(toNumber(valueInput(node, 'count', Number(node.data.loopCount ?? 4))));
              const count = Math.max(0, Math.min(raw, 10000));
              const bodyTargets = runtime.outgoingByHandle.get(nodeId)?.get('exec-body') ?? [];
              for (let i = 0; i < count; i += 1) {
                loopIndex.set(nodeId, i);
                bodyTargets.forEach((targetId) => executeFrom(targetId, new Set([nodeId])));
              }
              loopIndex.delete(nodeId);
              (runtime.outgoing.get(nodeId) ?? []).forEach((targetId) => executeFrom(targetId, visited));
              return;
            }

            // For Each Actor: fire the "Body" output once per actor matching a Blueprint (castBlueprintId) or
            // a Tag (stringValue) — the iterating form of "Get All Actors Of Class". The current actor is on
            // the value-out. Skips self/dead/disabled/projectiles. Then fires "Completed". (Snapshot the matches
            // first so Body logic that destroys/spawns can't disturb the iteration.)
            if (node.data.nodeKind === 'logic.forEachActor') {
              const byBlueprint = Boolean(node.data.castBlueprintId);
              const tag = typeof node.data.stringValue === 'string' ? node.data.stringValue.trim() : '';
              const key = node.data.objectKey || 'tags';
              const matches: string[] = [];
              if (byBlueprint || tag) {
                // Shared per-tick candidate list: one scene scan per distinct query per frame; only the
                // per-owner dynamic checks (self/destroyed/disabled/ragdoll) run here.
                const candidates = byBlueprint
                  ? actorQueryCandidates('bp', node.data.castBlueprintId!)
                  : actorQueryCandidates('tag', key, tag);
                for (const c of candidates) {
                  if (c.id === object.id || destroyedIds.has(c.id) || nextDisabled.has(c.id) || isRagdoll(c.id)) continue;
                  matches.push(c.id);
                }
              }
              const bodyTargets = runtime.outgoingByHandle.get(nodeId)?.get('exec-body') ?? [];
              for (const actorId of matches) {
                forEachCurrent.set(nodeId, actorId);
                bodyTargets.forEach((targetId) => executeFrom(targetId, new Set([nodeId])));
              }
              forEachCurrent.delete(nodeId);
              (runtime.outgoing.get(nodeId) ?? []).forEach((targetId) => executeFrom(targetId, visited));
              return;
            }

            const shouldContinue = applyAction(node, visited);
            if (shouldContinue !== false) {
              (runtime.outgoing.get(nodeId) ?? []).forEach((targetId) => executeFrom(targetId, visited));
            }
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              if (recordNodeError(nodeId, message)) {
                prints.push(`⚠️ Node error in "${object.name}" → ${node.data.label ?? node.data.nodeKind}: ${message}`);
              }
            }
          }

          // Current 0-based index of each active For Loop on this owner, read by the loop's value-out.
          const loopIndex = new Map<string, number>();
          // Current actor reference of each active For Each Actor on this owner, read by its value-out.
          const forEachCurrent = new Map<string, string>();
          // Live Call Function nesting depth — caps recursion (a function calling itself) at 16.
          let functionDepth = 0;
          // Function call frames: the entry's A/B/C value-outs read the TOP frame's args; Return writes
          // ret; each Call Function node remembers what its last call returned (read on its Return pin).
          const functionFrames: FunctionFrame[] = [];
          const callReturns = new Map<string, GraphValue | undefined>();
          // The actor most recently spawned by each Spawn Prefab node — its value-out reference.
          const lastSpawnedByNode = new Map<string, string>();

          // The most recent successful Cast target on THIS owner this execution — resolved by the "$cast"
          // sentinel so downstream Get/Set Object Var act on the cast actor's instance variables.
          let castTargetId: string | undefined;

          // Resolve a node's target object id. Sentinels: "$trigger" = the object overlapping the owner this
          // frame; "$self" = the owner; "$player" = the camera-follow player; "$cast" = the last successful Cast.
          const resolveTarget = (raw: string | undefined): string | undefined => {
            if (raw === '$trigger')
              return firstContactOther(priorTriggerIndex, object.id) ?? firstContactOther(priorTriggerExitIndex, object.id);
            if (raw === '$self') return object.id;
            if (raw === '$player') return playerId;
            if (raw === '$cast') return castTargetId;
            return raw;
          };

          // The object a Get/Set Object Var acts on: a wired "target" reference (a Cast's "As" pin) wins, then
          // the targetObjectId sentinel/id, then self.
          const objectVarTarget = (node: NodeForgeNode): string => {
            const wired = valueInput(node, 'target');
            return (typeof wired === 'string' && wired ? wired : resolveTarget(node.data.targetObjectId)) || object.id;
          };

          const applyAction = (node: NodeForgeNode, visited: Set<string>): boolean => {
            if (node.data.nodeKind === 'logic.branch') {
              return toBoolean(valueInput(node, 'condition', node.data.booleanValue ?? true));
            }

            // Cast (Unreal-style): gate the chain on the target running a specific blueprint. The object to test
            // comes from the wired "object" reference input (e.g. another Cast's "As" pin) or the targetObjectId
            // sentinel. On success, record it as "$cast" AND expose it from this node's value-out (the "As" pin).
            if (node.data.nodeKind === 'logic.cast') {
              const wired = valueInput(node, 'object');
              const targetId = (typeof wired === 'string' && wired) || resolveTarget(node.data.targetObjectId) || object.id;
              const targetObj = activeObjectById.get(targetId);
              const ok = Boolean(targetObj) && (!node.data.castBlueprintId || targetObj!.script?.blueprintId === node.data.castBlueprintId);
              if (ok) castTargetId = targetId;
              return ok;
            }

            // Cooldown gate: passes through at most once per N seconds (fire rate / spawn rate). While on
            // cooldown it stops the chain (returns false). Tracked per (object:node) in nextCooldowns.
            if (node.data.nodeKind === 'logic.cooldown') {
              const key = `${object.id}:${node.id}`;
              if ((nextCooldowns[key] ?? 0) > 0) return false;
              nextCooldowns[key] = Math.max(0.05, toNumber(valueInput(node, 'seconds', Number(node.data.numberValue ?? 1))));
              return true;
            }

            // Do Once gate: passes the FIRST time it's reached this Play session, then blocks forever. Reuses
            // the cooldown timer map armed to a huge value so it never re-opens (cleared when Play stops).
            if (node.data.nodeKind === 'logic.doOnce') {
              const key = `doOnce:${object.id}:${node.id}`;
              if ((nextCooldowns[key] ?? 0) > 0) return false;
              nextCooldowns[key] = Number.MAX_SAFE_INTEGER;
              return true;
            }

            // Delay (latent): the first time it's reached, arm a timer and STOP the chain here; when the timer
            // elapses (decremented each tick) the resume pass fires this node's exec-out. Re-triggers while
            // counting are ignored. Continuation never happens inline, so this always returns false.
            if (node.data.nodeKind === 'logic.delay') {
              const key = `${object.id}:${node.id}`;
              if (nextDelays[key] === undefined) {
                nextDelays[key] = Math.max(0.01, toNumber(valueInput(node, 'seconds', Number(node.data.numberValue ?? 1))));
              }
              return false;
            }

            // Tween Property (latent, non-blocking): arm a tween animating the target's transform property
            // to "To" over Duration seconds, then continue the chain IMMEDIATELY (the tween advances in the
            // per-tick pass; its "Done" pin fires from the resume pass on completion). Re-triggers while one
            // is running are ignored, like Delay — so an Update-driven arm doesn't restart it every frame.
            if (node.data.nodeKind === 'action.tweenProperty') {
              const key = `${object.id}:${node.id}`;
              if (nextTweens[key] === undefined) {
                const property = node.data.tweenProperty ?? 'position';
                const tid = objectVarTarget(node);
                const targetObj = activeObjectById.get(tid);
                if (tid !== object.id && !targetObj) return true; // unknown target — skip arming
                const rawTo = valueInput(node, 'to', node.data.vectorValue ?? ([0, 0, 0] as Vector3Tuple));
                const toVec: Vector3Tuple = Array.isArray(rawTo)
                  ? [Number(rawTo[0]) || 0, Number(rawTo[1]) || 0, Number(rawTo[2]) || 0]
                  : [0, 0, 0];
                // Rotation tweens are authored in degrees (matching Set Rotation) but run in radians.
                const d = Math.PI / 180;
                const to: Vector3Tuple = property === 'rotation' ? [toVec[0] * d, toVec[1] * d, toVec[2] * d] : toVec;
                const fromSource =
                  tid === object.id
                    ? property === 'position'
                      ? position
                      : property === 'rotation'
                        ? rotation
                        : scale
                    : targetObj!.transform[property];
                nextTweens[key] = {
                  targetId: tid,
                  property,
                  from: [fromSource[0], fromSource[1], fromSource[2]],
                  to,
                  time: 0,
                  duration: Math.max(0.01, toNumber(valueInput(node, 'duration', Number(node.data.numberValue ?? 1)))),
                  easing: node.data.easing ?? 'easeInOut',
                };
              }
              return true;
            }

            // Teleport an actor to a world position (wire a Vector3 into "position"). Owner by default;
            // a Target ($self/$player/$trigger/$cast/id or wired ref) teleports that actor instead.
            if (node.data.nodeKind === 'action.setPosition') {
              const p = valueInput(node, 'position');
              if (Array.isArray(p)) {
                const next: Vector3Tuple = [Number(p[0]) || 0, Number(p[1]) || 0, Number(p[2]) || 0];
                const tid = objectVarTarget(node);
                if (tid === object.id) {
                  position[0] = next[0];
                  position[1] = next[1];
                  position[2] = next[2];
                  changed = true;
                } else {
                  (nextTransforms[tid] ??= {}).position = next;
                }
              }
            }

            // Set an actor's rotation from Euler DEGREES (wire a Vector3 into "rotation").
            if (node.data.nodeKind === 'action.setRotation') {
              const r = valueInput(node, 'rotation');
              if (Array.isArray(r)) {
                const d = Math.PI / 180;
                const next: Vector3Tuple = [(Number(r[0]) || 0) * d, (Number(r[1]) || 0) * d, (Number(r[2]) || 0) * d];
                const tid = objectVarTarget(node);
                if (tid === object.id) {
                  rotation[0] = next[0];
                  rotation[1] = next[1];
                  rotation[2] = next[2];
                  changed = true;
                } else {
                  (nextTransforms[tid] ??= {}).rotation = next;
                }
              }
            }

            // Set an actor's scale (wire a Vector3 into "scale").
            if (node.data.nodeKind === 'action.setScale') {
              const s = valueInput(node, 'scale');
              if (Array.isArray(s)) {
                const next: Vector3Tuple = [Number(s[0]) || 0, Number(s[1]) || 0, Number(s[2]) || 0];
                const tid = objectVarTarget(node);
                if (tid === object.id) {
                  scale[0] = next[0];
                  scale[1] = next[1];
                  scale[2] = next[2];
                  changed = true;
                } else {
                  (nextTransforms[tid] ??= {}).scale = next;
                }
              }
            }

            // Yaw an actor to face a world position on the ground plane (wire a Vector3 into "point";
            // the actor to rotate comes from "target"/targetObjectId, default owner).
            if (node.data.nodeKind === 'action.lookAt') {
              const t = valueInput(node, 'point');
              if (Array.isArray(t)) {
                const tid = objectVarTarget(node);
                const from = tid === object.id ? position : activeObjectById.get(tid)?.transform.position;
                const yawOffset = (tid === object.id ? object : activeObjectById.get(tid))?.character?.modelYawOffset ?? 0;
                if (from) {
                  const dx = (Number(t[0]) || 0) - from[0];
                  const dz = (Number(t[2]) || 0) - from[2];
                  if (dx !== 0 || dz !== 0) {
                    const yaw = Math.atan2(dx, dz) + yawOffset;
                    if (tid === object.id) {
                      rotation[1] = yaw;
                      changed = true;
                    } else {
                      const cur = activeObjectById.get(tid)?.transform.rotation ?? [0, 0, 0];
                      (nextTransforms[tid] ??= {}).rotation = [cur[0], yaw, cur[2]];
                    }
                  }
                }
              }
            }

            // Turn this object to face the player on the ground plane (so Spawn Projectile fires at them).
            if (node.data.nodeKind === 'action.facePlayer') {
              if (aiPlayer && aiPlayer.id !== object.id) {
                const p = aiPlayer.transform.position;
                rotation[1] = Math.atan2(p[0] - position[0], p[2] - position[2]) + (object.character?.modelYawOffset ?? 0);
                changed = true;
              }
              return true;
            }

            if (node.data.nodeKind === 'action.translate') {
              const vector = valueInput(node, 'vector');
              if (Array.isArray(vector)) {
                position[0] += vector[0] * delta;
                position[1] += vector[1] * delta;
                position[2] += vector[2] * delta;
              } else {
                position[axisIndex(node.data.axis)] += toNumber(valueInput(node, 'amount', Number(node.data.amount ?? -3.6))) * delta;
              }
              changed = true;
            }

            if (node.data.nodeKind === 'action.rotate') {
              rotation[axisIndex(node.data.axis)] +=
                (toNumber(valueInput(node, 'amount', Number(node.data.amount ?? 90))) * Math.PI * delta) / 180;
              changed = true;
            }

            if (node.data.nodeKind === 'action.applyForce') {
              const forceVector = valueInput(node, 'vector');
              const amount = toNumber(valueInput(node, 'amount', Number(node.data.amount ?? 8)));
              const force = Array.isArray(forceVector)
                ? (forceVector as Vector3Tuple)
                : ([0, 0, 0].map((value, index) => (index === axisIndex(node.data.axis) ? amount : value)) as Vector3Tuple);
              // Target another object (e.g. a jump pad launching $trigger / $player), else the graph's owner.
              const forceTargetId = resolveTarget(node.data.targetObjectId) || object.id;
              const forceTarget = activeObjectById.get(forceTargetId);
              if (forceTarget?.character?.enabled) {
                // A kinematic character can't take a Rapier impulse — record it as a one-shot LAUNCH velocity
                // (jump pad / blast knockback). The vertical pass reads the Y; X/Z displace the body this frame.
                const prevLaunch = characterLaunch[forceTargetId] ?? [0, 0, 0];
                characterLaunch[forceTargetId] = [prevLaunch[0] + force[0], Math.max(prevLaunch[1], force[1]), prevLaunch[2] + force[2]];
              } else if (forceTarget?.physics?.enabled && forceTarget.physics.bodyType === 'dynamic') {
                // Accumulate as an impulse (force over the frame); Rapier divides by mass on apply.
                const accrued = physicsImpulses[forceTargetId] ?? [0, 0, 0];
                physicsImpulses[forceTargetId] = [accrued[0] + force[0] * delta, accrued[1] + force[1] * delta, accrued[2] + force[2] * delta];
              }
            }

            // Apply Impulse: an INSTANT velocity kick (no *delta) — same target handling as Apply Force.
            if (node.data.nodeKind === 'action.applyImpulse') {
              const impVector = valueInput(node, 'vector');
              const amount = toNumber(valueInput(node, 'amount', Number(node.data.amount ?? 8)));
              const imp = Array.isArray(impVector)
                ? (impVector as Vector3Tuple)
                : ([0, 0, 0].map((value, index) => (index === axisIndex(node.data.axis) ? amount : value)) as Vector3Tuple);
              const impTargetId = resolveTarget(node.data.targetObjectId) || object.id;
              const impTarget = activeObjectById.get(impTargetId);
              const impulse = node.data.space === 'local' && impTarget ? rotateLocalVector(imp, impTarget.transform.rotation) : imp;
              if (impTarget?.character?.enabled) {
                const prevLaunch = characterLaunch[impTargetId] ?? [0, 0, 0];
                characterLaunch[impTargetId] = [prevLaunch[0] + impulse[0], Math.max(prevLaunch[1], impulse[1]), prevLaunch[2] + impulse[2]];
              } else if (impTarget?.physics?.enabled && impTarget.physics.bodyType === 'dynamic') {
                const accrued = physicsImpulses[impTargetId] ?? [0, 0, 0];
                physicsImpulses[impTargetId] = [accrued[0] + impulse[0], accrued[1] + impulse[1], accrued[2] + impulse[2]];
              }
            }

            // Apply Torque: an angular impulse (kicks the body's spin). Used for physics-driven steering —
            // wire a number into Amount to spin the car around Y, sign = left/right. Same target handling
            // as Apply Force / Apply Impulse: a wired ref or $sentinel picks another actor, else self.
            if (node.data.nodeKind === 'action.applyTorque') {
              const torqVector = valueInput(node, 'vector');
              const amount = toNumber(valueInput(node, 'amount', Number(node.data.amount ?? 4)));
              const torq = Array.isArray(torqVector)
                ? (torqVector as Vector3Tuple)
                : ([0, 0, 0].map((value, index) => (index === axisIndex(node.data.axis ?? 'y') ? amount : value)) as Vector3Tuple);
              const torqTargetId = resolveTarget(node.data.targetObjectId) || object.id;
              const torqTarget = activeObjectById.get(torqTargetId);
              if (torqTarget?.physics?.enabled && torqTarget.physics.bodyType === 'dynamic') {
                const accrued = physicsAngularImpulses[torqTargetId] ?? [0, 0, 0];
                physicsAngularImpulses[torqTargetId] = [accrued[0] + torq[0], accrued[1] + torq[1], accrued[2] + torq[2]];
              }
            }

            // Set Environment: overlay sky/fog/sun fields onto the active scene's environment at the end of
            // the tick. Each successive call merges on top — so two triggers can each set a different subset.
            if (node.data.nodeKind === 'action.setEnvironment') {
              const patch = node.data.envPatch;
              if (patch && typeof patch === 'object') {
                pendingEnvironment = { ...(pendingEnvironment ?? {}), ...(patch as Partial<SceneEnvironmentSettings>) };
              }
            }

            // Set Velocity: hard-set a DYNAMIC body's linear velocity (physics.frame applies it via setLinvel).
            if (node.data.nodeKind === 'action.setVelocity') {
              const velVector = valueInput(node, 'vector');
              if (Array.isArray(velVector)) {
                const velTargetId = resolveTarget(node.data.targetObjectId) || object.id;
                const velTarget = activeObjectById.get(velTargetId);
                if (velTarget?.physics?.enabled && velTarget.physics.bodyType === 'dynamic') {
                  const v: Vector3Tuple = [Number(velVector[0]) || 0, Number(velVector[1]) || 0, Number(velVector[2]) || 0];
                  setVelocities[velTargetId] = v;
                  nextVelocities[velTargetId] = v; // so Get Velocity reflects it the same frame
                }
              }
            }

            if (node.data.nodeKind === 'action.setPhysics') {
              const physicsTargetId = objectVarTarget(node);
              const physicsTarget = activeObjectById.get(physicsTargetId);
              if (physicsTarget) {
                const basePhysics = withPhysicsDefaults({
                  ...defaultPhysics(),
                  ...(physicsTarget.physics ?? {}),
                  materialPreset: node.data.physicsMaterialPreset ?? physicsTarget.physics?.materialPreset ?? 'default',
                });
                const presetPhysics = node.data.physicsMaterialPreset
                  ? applyPhysicsMaterialPreset(basePhysics, node.data.physicsMaterialPreset)
                  : basePhysics;
                nextPhysics[physicsTargetId] = {
                  ...presetPhysics,
                  enabled: toBoolean(valueInput(node, 'enabled', node.data.physicsEnabled ?? true)),
                  bodyType: node.data.physicsBodyType ?? 'dynamic',
                  collider: node.data.physicsCollider ?? 'box',
                  materialPreset: node.data.physicsMaterialPreset ?? presetPhysics.materialPreset ?? 'default',
                  isTrigger: Boolean(node.data.physicsIsTrigger),
                  mass: Math.max(0.001, toNumber(valueInput(node, 'mass', Number(node.data.physicsMass ?? 1)))),
                  gravityScale: toNumber(valueInput(node, 'gravityScale', Number(node.data.physicsGravityScale ?? 1))),
                  friction: Math.max(0, toNumber(valueInput(node, 'friction', Number(node.data.physicsFriction ?? presetPhysics.friction)))),
                  restitution: Math.min(1, Math.max(0, toNumber(valueInput(node, 'restitution', Number(node.data.physicsRestitution ?? presetPhysics.restitution))))),
                  linearDamping: Math.max(0, Number(node.data.physicsLinearDamping ?? presetPhysics.linearDamping)),
                  angularDamping: Math.max(0, Number(node.data.physicsAngularDamping ?? presetPhysics.angularDamping)),
                };
              }
            }

            if (node.data.nodeKind === 'variable.set') {
              const variable = node.data.variableId ? variableById.get(node.data.variableId) : undefined;
              if (variable) {
                nextVariableValues[variable.id] = coerceGraphValue(
                  valueInput(node, 'value', literalValueForType(node.data, variable.type)),
                  variable.type,
                );
              } else if (node.data.objectKey) {
                // Instance variable picked in the Set Variable dropdown → write THIS object's (self) value.
                const declType = declaredObjectVarType(object, node.data.objectKey);
                const raw = valueInput(node, 'value', declType ? literalValueForType(node.data, declType) : (node.data.numberValue ?? 0));
                mutableObjectVars(object.id, object.variables)[node.data.objectKey] = coerceGraphValue(raw, declType ?? inferGraphType(raw));
              }
            }

            if (node.data.nodeKind === 'variable.setObject') {
              const key = node.data.objectKey || '';
              // Target: a wired reference (a Cast's "As" pin) wins, else the targetObjectId sentinel
              // ($self/$player/$trigger/$cast) or an id, else self — so a pickup can write a variable on whoever
              // walked into it, or on a cast actor.
              const targetId = objectVarTarget(node);
              if (key) {
                const targetObj = activeObjectById.get(targetId);
                // Coerce to the variable's DECLARED type on the target's blueprint (so bools/strings/vectors
                // work, not just numbers); fall back to inferring the type from the supplied value.
                const declType = declaredObjectVarType(targetObj, key);
                const fallback = declType ? literalValueForType(node.data, declType) : (node.data.numberValue ?? 0);
                const raw = valueInput(node, 'value', fallback);
                mutableObjectVars(targetId, targetObj?.variables)[key] = coerceGraphValue(raw, declType ?? inferGraphType(raw));
              }
            }

            if (node.data.nodeKind === 'ui.show' && node.data.documentId) {
              nextVisibleUI[node.data.documentId] = true;
            }

            if (node.data.nodeKind === 'ui.hide' && node.data.documentId) {
              nextVisibleUI[node.data.documentId] = false;
            }

            if (node.data.nodeKind === 'ui.setText' && node.data.documentId && node.data.elementId) {
              const text = graphValueToString(valueInput(node, 'text', node.data.stringValue ?? ''));
              nextUITextOverrides[`${node.data.documentId}:${node.data.elementId}`] = text;
            }

            if (node.data.nodeKind === 'save.write') {
              // Variables flagged `persistent` define the save set; a project that never flagged any
              // saves ALL project variables instead — so Save Game is never a silent no-op ("easy by
              // default, precise when you opt in"). Keyed by NAME (stable across re-imports/copies).
              const anyFlagged = state.variables.some((variable) => variable.persistent);
              const pool = anyFlagged ? state.variables.filter((variable) => variable.persistent) : state.variables;
              const saved = Object.fromEntries(
                pool.map((variable) => [
                  variable.name,
                  coerceGraphValue(nextVariableValues[variable.id] ?? variable.defaultValue, variable.type),
                ]),
              ) as Record<string, GraphValue>;
              writeSaveSlot(node.data.saveSlot ?? 'slot1', saved);
              saveSlotHasCache.set(node.data.saveSlot ?? 'slot1', true);
              prints.push(`${object.name}: Saved ${Object.keys(saved).length} variables`);
            }

            if (node.data.nodeKind === 'save.load') {
              const saved = readSaveSlot(node.data.saveSlot ?? 'slot1');
              if (saved) {
                // Apply whatever the save holds — name-keyed (current format) or id-keyed (legacy saves).
                state.variables.forEach((variable) => {
                  const value = saved[variable.name] ?? saved[variable.id];
                  if (value !== undefined) nextVariableValues[variable.id] = coerceGraphValue(value, variable.type);
                });
                prints.push(`${object.name}: Loaded save slot ${node.data.saveSlot ?? 'slot1'}`);
              } else {
                prints.push(`${object.name}: No save data in ${node.data.saveSlot ?? 'slot1'}`);
              }
            }

            if (node.data.nodeKind === 'save.clear') {
              clearSaveSlot(node.data.saveSlot ?? 'slot1');
              saveSlotHasCache.set(node.data.saveSlot ?? 'slot1', false);
              prints.push(`${object.name}: Cleared save slot ${node.data.saveSlot ?? 'slot1'}`);
            }

            if (node.data.nodeKind === 'action.fireEvent') {
              const eventName = (node.data.eventName || 'CustomEvent').toLowerCase();
              // Optional payload: carried by name, read from the matching Custom Event's value-out (so
              // "enemy_died" can say HOW MANY points, "checkpoint" WHICH index). Last fire wins per name.
              const payload = valueInput(node, 'payload');
              if (payload !== undefined) eventPayloads[eventName] = payload;
              // A Target ($player/$trigger/$cast/id or wired ref) other than self = call the event on THAT
              // actor's blueprint, delivered next frame (Unreal call-event-on-reference). No target = fire
              // this graph's own matching Custom Event roots synchronously, as before.
              const tid = objectVarTarget(node);
              if (tid && tid !== object.id) {
                (nextActorEvents[tid] ??= []).push(eventName);
              } else {
                (runtime.customEventRoots.get(eventName) ?? []).forEach((candidate) => executeFrom(candidate.id, visited));
              }
            }

            // Return: set the enclosing function call's return value and END the function chain here.
            // Outside a function call it's just a chain terminator.
            if (node.data.nodeKind === 'logic.functionReturn') {
              const frame = functionFrames[functionFrames.length - 1];
              if (frame) frame.ret = valueInput(node, 'value');
              return false;
            }

            if (node.data.nodeKind === 'action.playSound' && node.data.assetId) {
              pushSound(node.data.assetId, [...object.transform.position] as Vector3Tuple);
            }

            if (node.data.nodeKind === 'action.playCinematic' && node.data.cinematicId) {
              pendingCinematicId = node.data.cinematicId;
            }

            // Load Scene: request a switch to another scene (next floor/level/menu). Applied once at the end of
            // the tick; stop this chain now since the world is about to be replaced. Only the first request wins.
            if (node.data.nodeKind === 'action.loadScene') {
              const sceneId = node.data.targetSceneId;
              if (sceneId && sceneId !== state.activeSceneId && state.scenes.some((scene) => scene.id === sceneId)) {
                if (!pendingSceneId) pendingSceneId = sceneId;
              }
              return false;
            }

            if (node.data.nodeKind === 'action.burstParticles') {
              // Spit a one-shot burst from the target's authored emitter (e.g. an explosion on hit).
              const target = resolveTarget(node.data.targetObjectId) || object.id;
              const count = Math.max(1, Math.round(toNumber(valueInput(node, 'count', Number(node.data.numberValue ?? 16)))));
              sendParticleCommand(target, { type: 'burst', count });
            }

            if (node.data.nodeKind === 'action.cameraShake') {
              cameraShake = Math.min(1, cameraShake + Math.max(0, toNumber(valueInput(node, 'amount', Number(node.data.shakeAmount ?? 0.6)))));
            }

            if (node.data.nodeKind === 'action.screenFlash') {
              // Set (don't accumulate) the screen flash to its peak — a single bright pop, then it fades.
              const amount = Math.max(0, Math.min(1, toNumber(valueInput(node, 'amount', Number(node.data.flashAmount ?? 0.7)))));
              if (amount > flash) flash = amount;
              if (typeof node.data.flashColor === 'string') flashColor = node.data.flashColor;
            }

            if (node.data.nodeKind === 'action.explode') {
              // Blast at a wired Location, else the Target object's position, else the owner. Queues into the
              // shared explosion pass → flings nearby dynamic bodies (radial impulse), damages health objects
              // in radius, spawns the burst FX, and kicks the camera. Chains into explosive props it kills.
              const loc = valueInput(node, 'location');
              let pos: Vector3Tuple;
              if (Array.isArray(loc) && loc.length === 3) {
                pos = [Number(loc[0]) || 0, Number(loc[1]) || 0, Number(loc[2]) || 0];
              } else {
                const targetId = resolveTarget(node.data.targetObjectId);
                const targetObj = targetId && targetId !== object.id ? activeObjectById.get(targetId) : null;
                pos = targetObj ? ([...targetObj.transform.position] as Vector3Tuple) : [position[0], position[1], position[2]];
              }
              explodeQueue.push({
                pos,
                radius: Math.max(0.1, toNumber(valueInput(node, 'radius', Number(node.data.explodeRadius ?? 5)))),
                dmg: Math.max(0, toNumber(valueInput(node, 'damage', Number(node.data.explodeDamage ?? 50)))),
                force: Math.max(0, toNumber(valueInput(node, 'force', Number(node.data.explodeForce ?? 16)))),
              });
            }

            if (node.data.nodeKind === 'action.setTimeScale') {
              // Clamped 0..4: 0 pauses (tick keeps running so the graph can unpause), <1 slow-mo, >1 fast-forward.
              pendingTimeScale = Math.min(4, Math.max(0, toNumber(valueInput(node, 'scale', Number(node.data.numberValue ?? 1)))));
            }

            if (node.data.nodeKind === 'action.setQuality') {
              // Last Set Quality this tick wins; applied to renderSettings in the returned patch (no isDirty).
              pendingQuality = node.data.qualityLevel ?? 'High';
            }

            if (node.data.nodeKind === 'action.setParticlesEmitting') {
              // Start/stop a continuous emitter (e.g. ignite a torch, turn on a smoke plume).
              const target = resolveTarget(node.data.targetObjectId) || object.id;
              const on = toBoolean(valueInput(node, 'on', node.data.booleanValue ?? true));
              sendParticleCommand(target, { type: 'emit', on });
            }

            if (node.data.nodeKind === 'action.spawnParticleSystem' && node.data.particleSystemId) {
              // Position priority: a Vector3 wired into Location → the Target object's position → the owner.
              const loc = valueInput(node, 'location');
              let base: Vector3Tuple;
              if (Array.isArray(loc) && loc.length === 3) {
                base = [Number(loc[0]) || 0, Number(loc[1]) || 0, Number(loc[2]) || 0];
              } else {
                const targetId = resolveTarget(node.data.targetObjectId);
                const targetObj = targetId && targetId !== object.id ? activeObjectById.get(targetId) : null;
                base = targetObj ? [...targetObj.transform.position] : [position[0], position[1], position[2]];
              }
              // A static Offset (the node's vector field) is added on top — e.g. spawn 2 units above.
              const off = node.data.vectorValue;
              if (Array.isArray(off) && off.length === 3) base = [base[0] + off[0], base[1] + off[1], base[2] + off[2]];
              spawned.push(makeSpawnedParticleEmitter(node.data.particleSystemId, base));
            }

            if (node.data.nodeKind === 'action.spawnObject') {
              spawned.push(makeSpawnedObject(node.data.spawnKind ?? 'cube', position));
            }

            if (node.data.nodeKind === 'action.spawnPrefab' && node.data.prefabId) {
              // Instantiate a prefab tree (re-ided) at a wired Location (spawn points!) or the spawner's
              // position. The clones keep the prefab's controllerId/blueprintId (project-level), so spawned
              // enemies animate + run their AI immediately. The node's value-out is a REFERENCE to the new
              // actor — chain it into Set Object Var / Get Position / Apply Damage Targets.
              const prefab = prefabById.get(node.data.prefabId);
              if (prefab && prefab.objects.length) {
                const loc = valueInput(node, 'location');
                const base: Vector3Tuple =
                  Array.isArray(loc) && loc.length === 3
                    ? [Number(loc[0]) || 0, Number(loc[1]) || 0, Number(loc[2]) || 0]
                    : ([...position] as Vector3Tuple);
                const { objects: clones, rootId } = cloneObjectTree(prefab.objects, prefab.rootId);
                for (const clone of clones) {
                  spawned.push(
                    clone.id === rootId
                      ? { ...clone, parentId: undefined, transform: { ...clone.transform, position: base } }
                      : clone,
                  );
                }
                lastSpawnedByNode.set(node.id, rootId);
              } else {
                // LOUD failure: a dangling/empty prefab reference would otherwise spawn nothing with no
                // trace. Surface it once per node (per Play) in the on-screen console so it gets fixed.
                const bag = mutableObjectVars(object.id, object.variables);
                const key = `__warnedPrefab:${node.id}`;
                if (!bag[key]) {
                  bag[key] = true;
                  prints.push(
                    `${object.name}: Spawn Prefab failed — prefab ${prefab ? 'is empty' : 'was deleted or not found'}`,
                  );
                }
              }
            }

            if (node.data.nodeKind === 'action.destroyObject') {
              destroyedIds.add(node.data.targetObjectId || object.id);
            }

            if (node.data.nodeKind === 'action.fractureObject') {
              // Shatter the owner (or Target) into small dynamic cubes that fly apart, then remove the original.
              const targetId = resolveTarget(node.data.targetObjectId) || object.id;
              fractureSource(activeObjectById.get(targetId), targetId);
            }

            if (node.data.nodeKind === 'action.applyDamage') {
              // Subtract HP from the target's `health` instance var (owner by default; a wired Target reference or
              // the $self/$player/$trigger/$cast sentinel picks another actor). Mirrors the combat-pass damage:
              // record it for On Receive Damage, spawn a damage number, and run death (ragdoll/shatter/blast/despawn)
              // when health reaches 0. The target needs a `health` instance variable, or this is a no-op.
              const targetId = objectVarTarget(node);
              const targetObj = activeObjectById.get(targetId);
              const hasHealth = nextObjectVariables[targetId]?.health !== undefined || targetObj?.variables?.health !== undefined;
              const amount = Math.max(0, toNumber(valueInput(node, 'amount', Number(node.data.damageAmount ?? 10))));
              // Apply if the target has a health var OR listens for On Receive Damage (auto — no var needed).
              if (targetObj && amount > 0 && !destroyedIds.has(targetId) && (hasHealth || listensForReceiveDamage.has(targetId))) {
                const nodeHp = receiveDamageHealth.get(targetId);
                if (hasHealth || nodeHp !== undefined) {
                  const cur = toNumber(nextObjectVariables[targetId]?.health ?? targetObj.variables?.health ?? nodeHp ?? 0);
                  if (cur > 0) {
                    const next = Math.max(0, cur - amount);
                    mutableObjectVars(targetId, targetObj.variables).health = next;
                    recordDamage(targetId, amount);
                    spawned.push(makeDamageNumber(targetObj.transform.position, amount));
                    if (targetId === playerId) hurt += 1;
                    if (next > 0 && targetObj.character?.hurtSoundId) pushSound(targetObj.character.hurtSoundId, [...targetObj.transform.position] as Vector3Tuple);
                    if (next <= 0) {
                      if (object.id === playerId && targetId !== playerId) killMarker += 1;
                      killTarget(targetObj, targetId, targetObj.transform.position);
                    }
                  }
                } else {
                  // Listener with no health var: fire its On Receive Damage event (notify-only, never dies).
                  recordDamage(targetId, amount);
                  spawned.push(makeDamageNumber(targetObj.transform.position, amount));
                }
              }
            }

            if (node.data.nodeKind === 'action.setMaterialColor') {
              if (nextRenderer) {
                const color = graphValueToString(valueInput(node, 'color', node.data.materialColor ?? '#ffffff'));
                // Write either the base color or the emissive color, depending on the node's target.
                const channel = node.data.materialColorTarget === 'emissive' ? 'emissiveColor' : 'color';
                nextRenderer = {
                  ...nextRenderer,
                  materialOverrides: { ...nextRenderer.materialOverrides, [channel]: color },
                };
                changed = true;
              }
            }

            if (node.data.nodeKind === 'action.setMaterialProperty') {
              if (nextRenderer) {
                const property = node.data.materialProperty ?? 'metalness';
                const value = toNumber(valueInput(node, 'value', Number(node.data.numberValue ?? 0)));
                nextRenderer = {
                  ...nextRenderer,
                  materialOverrides: { ...nextRenderer.materialOverrides, [property]: value },
                };
                changed = true;
              }
            }

            if (node.data.nodeKind === 'action.print') {
              prints.push(`${object.name}: ${graphValueToString(valueInput(node, 'message', node.data.message ?? ''))}`);
            }

            // Anim writes target the owning object by default, or another object via targetObjectId ($trigger = whoever triggered).
            const animTargetId = resolveTarget(node.data.targetObjectId) || object.id;

            if (node.data.nodeKind === 'animator.setFloat' && node.data.paramName) {
              (animatorWrites[animTargetId] ??= []).push({
                name: node.data.paramName,
                value: toNumber(valueInput(node, 'value', Number(node.data.numberValue ?? 0))),
              });
            }

            if (node.data.nodeKind === 'animator.setBool' && node.data.paramName) {
              (animatorWrites[animTargetId] ??= []).push({
                name: node.data.paramName,
                value: toBoolean(valueInput(node, 'value', Boolean(node.data.booleanValue))),
              });
            }

            if (node.data.nodeKind === 'animator.setTrigger' && node.data.paramName) {
              (animatorWrites[animTargetId] ??= []).push({ name: node.data.paramName, value: true, trigger: true });
            }

            if (node.data.nodeKind === 'action.move') {
              const vector = valueInput(node, 'vector');
              const cc = object.character;
              // Apply sprint/crouch from the owner's bindings so node-driven pawns run + crouch too.
              const speedScale = cc ? (currentKeys[cc.keyCrouch] ? cc.crouchMultiplier : currentKeys[cc.keySprint] ? cc.sprintMultiplier : 1) : 1;
              const speed = toNumber(valueInput(node, 'speed', Number(node.data.amount ?? cc?.moveSpeed ?? 3.4))) * speedScale;
              if (Array.isArray(vector)) {
                position[0] += vector[0] * speed * delta;
                position[2] += vector[2] * speed * delta;
                if (vector[0] !== 0 || vector[2] !== 0) {
                  const turn = object.character?.turnSpeed ?? 10;
                  const yawOffset = object.character?.modelYawOffset ?? 0;
                  rotation[1] = lerpAngle(rotation[1], Math.atan2(vector[0], vector[2]) + yawOffset, turn * delta);
                }
                changed = true;
              }
            }

            // Move To: walk toward a target POSITION, steering around obstacles with forward raycasts
            // (context steering). The dependency-free "navigate around walls" path for chase/patrol AI.
            if (node.data.nodeKind === 'action.moveTo') {
              const target = valueInput(node, 'target');
              if (Array.isArray(target)) {
                const cc = object.character;
                const speed = toNumber(valueInput(node, 'speed', Number(node.data.amount ?? cc?.moveSpeed ?? 3.4)));
                const arrival = Math.max(0.2, Number(node.data.numberValue ?? 1.2));
                const dx = target[0] - position[0];
                const dz = target[2] - position[2];
                const dist = Math.hypot(dx, dz);
                if (dist > arrival) {
                  let yaw = Math.atan2(dx, dz); // desired heading toward the target
                  const phys = getActivePhysics();
                  const probe = 2.6; // how far ahead we look for obstacles (units)
                  // Only steer around obstacles when we're farther than the probe — when close to the target
                  // we head straight in, so the target itself (e.g. the player) isn't treated as a wall.
                  if (phys && dist > probe + 0.5) {
                    const hadSelf = aiLineOfSightExclude.has(object.id);
                    if (!hadSelf) aiLineOfSightExclude.add(object.id);
                    const oy = position[1] + 0.9;
                    // Probe the desired heading plus fanned-out angles; pick the path that's clearest AND
                    // closest to desired (penalty grows with the angle away from straight-at-target).
                    let best: { yaw: number; score: number } | null = null;
                    for (const off of [0, 0.44, -0.44, 0.88, -0.88, 1.4, -1.4]) {
                      const yo = yaw + off;
                      const hit = phys.castRay([position[0], oy, position[2]], [Math.sin(yo), 0, Math.cos(yo)], probe, aiLineOfSightExclude);
                      const clear = hit ? hit.distance : probe;
                      const score = clear - Math.abs(off) * 0.7;
                      if (!best || score > best.score) best = { yaw: yo, score };
                    }
                    if (!hadSelf) aiLineOfSightExclude.delete(object.id);
                    if (best) yaw = best.yaw;
                  }
                  const mvx = Math.sin(yaw);
                  const mvz = Math.cos(yaw);
                  position[0] += mvx * speed * delta;
                  position[2] += mvz * speed * delta;
                  const turn = cc?.turnSpeed ?? 10;
                  const yawOffset = cc?.modelYawOffset ?? 0;
                  rotation[1] = lerpAngle(rotation[1], Math.atan2(mvx, mvz) + yawOffset, turn * delta);
                  changed = true;
                }
              }
            }

            if (node.data.nodeKind === 'action.drive') {
              const v = valueInput(node, 'vector');
              if (Array.isArray(v)) vehicleScriptInputs[object.id] = { throttle: v[0] ?? 0, steer: v[1] ?? 0, handbrake: (v[2] ?? 0) > 0.5 };
              else vehicleScriptInputs[object.id] = { throttle: 0, steer: 0, handbrake: false };
            }

            if (node.data.nodeKind === 'action.jump') {
              characterJumpRequests.add(object.id);
            }

            if (node.data.nodeKind === 'action.setCamera') {
              const current = nextCameraOverrides[object.id];
              const offset = object.character?.cameraOffset;
              nextCameraOverrides[object.id] = {
                distance: toNumber(valueInput(node, 'distance', current?.distance ?? (offset ? Math.abs(offset[2]) : 6))),
                height: toNumber(valueInput(node, 'height', current?.height ?? (offset ? offset[1] : 2.6))),
              };
            }

            if (node.data.nodeKind === 'action.setRagdoll') {
              // Default On; wire/author a boolean into `on` to turn it off.
              const target = node.data.targetObjectId || object.id;
              const on = toBoolean(valueInput(node, 'on', node.data.booleanValue ?? true));
              setRagdoll(target, on);
            }

            if (node.data.nodeKind === 'action.setVisible') {
              // Hide/show the owner (or Target) — e.g. holster the inactive weapon.
              const target = node.data.targetObjectId || object.id;
              const visible = toBoolean(valueInput(node, 'visible', node.data.visible ?? true));
              if (visible) nextHidden.delete(target);
              else nextHidden.add(target);
            }

            if (node.data.nodeKind === 'action.setActive') {
              // Fully (de)activate the owner (or Target): off = no render, no script, no physics body, ignored
              // by AI; on = back to normal. Distinct from Set Visible (which only hides the mesh).
              const target = resolveTarget(node.data.targetObjectId) || object.id;
              const on = toBoolean(valueInput(node, 'on', node.data.booleanValue ?? true));
              if (on) nextDisabled.delete(target);
              else nextDisabled.add(target);
            }

            if (node.data.nodeKind === 'action.cutCable') {
              // Sever a cable's constraint and detach its end: the dynamic end flies free (drop the ball).
              const target = resolveTarget(node.data.targetObjectId) || object.id;
              const cab = activeObjectById.get(target)?.cable;
              if (cab) {
                // The other end: an explicit endObjectId, or (followJoint) the joint partner — owner's joint,
                // or whatever object's joint connects to the owner.
                let endId = cab.endObjectId;
                if (cab.followJoint) {
                  const owner = activeObjectById.get(target);
                  if (owner?.joint?.connectedObjectId) endId = owner.joint.connectedObjectId;
                  else endId = activeObjects.find((o) => o.joint?.enabled && o.joint.connectedObjectId === target)?.id ?? endId;
                }
                nextCutCables.add(target);
                getActivePhysics()?.severCable(target, endId);
              }
            }

            if (node.data.nodeKind === 'action.setCableLength') {
              // Winch/reel: set a cable's length at runtime (visual slack + its physical rope's max distance).
              const target = resolveTarget(node.data.targetObjectId) || object.id;
              if (activeObjectById.get(target)?.cable) {
                nextCableLength[target] = Math.max(0.1, toNumber(valueInput(node, 'length', Number(node.data.numberValue ?? 2))));
              }
            }

            if (node.data.nodeKind === 'action.enterVehicle') {
              // GTA-style: the on-foot camera-follow player gets into the target car (default: the owner of
              // this graph — wire Interact on the car → Enter Vehicle). The movedObjects pass disables the
              // pawn (camera/move/script) + hides it, and hands the follow-camera to the car; Driving=1 lets
              // auto-cars take input. No-op if the car is already occupied.
              const vehicleId = resolveTarget(node.data.targetObjectId) ?? object.id;
              const player = playerId;
              if (player && vehicleId && player !== vehicleId && !nextOccupants[vehicleId]) {
                vehicleEnter.push({ player, vehicle: vehicleId });
                nextOccupants[vehicleId] = player;
                nextHidden.add(player);
                const dv = variableByName.get('Driving');
                if (dv) nextVariableValues[dv.id] = 1;
              }
            }

            if (node.data.nodeKind === 'action.exitVehicle') {
              // Reverse of Enter: the occupant pawn reappears beside the car (car-local `vectorValue` offset,
              // default 2.2u to the right) and regains camera/move/script; the car drops camera-follow. Wire a
              // Key Down on the CAR's blueprint → Exit Vehicle (Interact won't fire while driving).
              const vehicleId = resolveTarget(node.data.targetObjectId) ?? object.id;
              const player = vehicleId ? nextOccupants[vehicleId] : undefined;
              if (vehicleId && player) {
                const offset = (Array.isArray(node.data.vectorValue) ? node.data.vectorValue : [2.2, 0, 0]) as Vector3Tuple;
                vehicleExit.push({ player, vehicle: vehicleId, offset });
                delete nextOccupants[vehicleId];
                nextHidden.delete(player);
                const dv = variableByName.get('Driving');
                if (dv) nextVariableValues[dv.id] = 0;
              }
            }

            if (node.data.nodeKind === 'action.spawnAttached' && node.data.assetId) {
              // Equip: spawn the weapon model attached to the owner's bone/socket, replacing any weapon
              // already on that slot. The grip offset rides on the attachment so it's map-independent.
              // targetObjectId "$trigger" attaches to whoever walked into the pickup (self-contained pickups).
              const owner = resolveTarget(node.data.targetObjectId) || object.id;
              const socketName = node.data.attachSocketName;
              const boneName = node.data.attachBoneName ?? '';
              const slot = socketName || boneName;
              for (const o of activeObjects) {
                if (o.variables?.__attachedWeapon && o.attachment?.targetObjectId === owner && (o.attachment.socketName || o.attachment.boneName) === slot) {
                  destroyedIds.add(o.id);
                }
              }
              spawned.push(
                makeAttachedWeapon(owner, node.data.assetId, boneName, socketName, node.data.attachOffsetPosition, node.data.attachOffsetRotation, node.data.attachOffsetScale),
              );
            }

            if (node.data.nodeKind === 'action.playAnimation' && node.data.animationId) {
              // Montage: queue a one-shot clip on the owner's (or Target's) animator — the animator pass below
              // turns it into a timed override that returns to the state machine when done.
              const target = resolveTarget(node.data.targetObjectId) || object.id;
              animMontages[target] = { animationId: node.data.animationId, speed: Math.max(0.05, node.data.animationSpeed ?? 1) };
            }

            if (node.data.nodeKind === 'action.setMovementMode') {
              // Override how the target moves (walking/swimming/climbing/flying) until changed — the character
              // + animator passes read movementModeNow. This is what makes swim/climb fully blueprint-driven.
              const target = resolveTarget(node.data.targetObjectId) || object.id;
              movementModeNow[target] = node.data.movementMode ?? 'walking';
            }

            if (node.data.nodeKind === 'action.spawnProjectile') {
              // Ammo: if the shooter owns an `ammo` instance variable, each shot consumes one and an empty
              // clip blocks the shot (reload — see the character pass — refills it to `ammoMax`).
              const ammoNow = nextObjectVariables[object.id]?.ammo ?? object.variables?.ammo;
              if (ammoNow !== undefined) {
                const ammo = toNumber(ammoNow);
                if (ammo <= 0) return true; // out of ammo — no shot
                mutableObjectVars(object.id, object.variables).ammo = ammo - 1;
              }
              const speed = toNumber(valueInput(node, 'speed', node.data.projectileSpeed ?? 20));
              const damage = toNumber(valueInput(node, 'damage', node.data.projectileDamage ?? 25));
              const template = node.data.projectileTemplateId
                ? activeObjectById.get(node.data.projectileTemplateId)
                : undefined;
              const setup: ProjectileSetup = {
                size: node.data.projectileSize,
                color: node.data.projectileColor,
                life: node.data.projectileLife,
                gravity: node.data.projectileGravity,
                knockback: node.data.projectileKnockback,
                explosive: node.data.projectileExplosive,
                blastRadius: node.data.projectileBlastRadius,
                blastDamage: node.data.projectileBlastDamage,
                blastSound: node.data.projectileBlastSound,
                debug: node.data.projectileDebug,
                template,
              };
              const cc = object.character ? resolveCharacter(object.character) : undefined;
              const facing = cc?.cameraMode === 'firstPerson' && cc.mouseLook
                ? mouseCameraYaw(cc.mouseSensitivity)
                : rotation[1] - (cc?.modelYawOffset ?? 0);
              const pitch = cc?.cameraMode === 'firstPerson' && cc.mouseLook
                ? mouseCameraPitch(cc.cameraPitch, cc.mouseSensitivity, cc.cameraMinPitch, cc.cameraMaxPitch)
                : 0;
              const horizontal = Math.cos(pitch);
              const dir: Vector3Tuple = [Math.sin(facing) * horizontal, Math.sin(pitch), Math.cos(facing) * horizontal];
              const right: Vector3Tuple = [Math.cos(facing), 0, -Math.sin(facing)];
              const fp = cc?.cameraMode === 'firstPerson';
              // The eye/camera world position — where the crosshair ray starts.
              const off = cc?.cameraOffset ?? [0, 1.4, 0];
              const eye: Vector3Tuple = fp
                ? [
                    position[0] + right[0] * off[0] + dir[0] * off[2],
                    position[1] + off[1] + dir[1] * off[2],
                    position[2] + right[2] * off[0] + dir[2] * off[2],
                  ]
                : [position[0], position[1] + 1.4, position[2]];
              // Spawn at the WEAPON MUZZLE: a configurable camera-space offset [right, up, forward] from
              // the eye (default = down-right where a held gun's barrel sits).
              const m = (fp && node.data.projectileMuzzle) || [0.12, -0.24, 0.8];
              const muzzle: Vector3Tuple = fp
                ? [
                    eye[0] + right[0] * m[0] + dir[0] * m[2],
                    eye[1] + m[1] + dir[1] * m[2],
                    eye[2] + right[2] * m[0] + dir[2] * m[2],
                  ]
                : [position[0] + dir[0] * 0.8, position[1] + 1.4, position[2] + dir[2] * 0.8];
              // Converge: aim from the muzzle toward a point far down the crosshair ray so the shot both
              // LOOKS like it leaves the gun AND still hits where the player is aiming.
              let velocity: Vector3Tuple = [dir[0] * speed, dir[1] * speed, dir[2] * speed];
              if (fp) {
                const ax = eye[0] + dir[0] * 50 - muzzle[0];
                const ay = eye[1] + dir[1] * 50 - muzzle[1];
                const az = eye[2] + dir[2] * 50 - muzzle[2];
                const len = Math.hypot(ax, ay, az) || 1;
                velocity = [(ax / len) * speed, (ay / len) * speed, (az / len) * speed];
              }
              // Spread/bloom: jitter the shot direction within a random cone (degrees) so automatic fire isn't
              // a laser. Build a basis around the aim direction, offset by random angles, renormalize to speed.
              const spreadDeg = toNumber(valueInput(node, 'spread', Number(node.data.projectileSpread ?? 0)));
              if (spreadDeg > 0) {
                const sp = Math.hypot(velocity[0], velocity[1], velocity[2]) || speed || 1;
                const vn: Vector3Tuple = [velocity[0] / sp, velocity[1] / sp, velocity[2] / sp];
                const upRef: Vector3Tuple = Math.abs(vn[1]) > 0.99 ? [1, 0, 0] : [0, 1, 0];
                // rightB = normalize(vn × upRef); upB = rightB × vn  (orthonormal basis around the aim dir)
                let rb: Vector3Tuple = [vn[1] * upRef[2] - vn[2] * upRef[1], vn[2] * upRef[0] - vn[0] * upRef[2], vn[0] * upRef[1] - vn[1] * upRef[0]];
                const rl = Math.hypot(rb[0], rb[1], rb[2]) || 1;
                rb = [rb[0] / rl, rb[1] / rl, rb[2] / rl];
                const ub: Vector3Tuple = [rb[1] * vn[2] - rb[2] * vn[1], rb[2] * vn[0] - rb[0] * vn[2], rb[0] * vn[1] - rb[1] * vn[0]];
                const rad = (spreadDeg * Math.PI) / 180;
                const ta = Math.tan((Math.random() * 2 - 1) * rad);
                const tb = Math.tan((Math.random() * 2 - 1) * rad);
                const nd: Vector3Tuple = [vn[0] + rb[0] * ta + ub[0] * tb, vn[1] + rb[1] * ta + ub[1] * tb, vn[2] + rb[2] * ta + ub[2] * tb];
                const nl = Math.hypot(nd[0], nd[1], nd[2]) || 1;
                velocity = [(nd[0] / nl) * sp, (nd[1] / nl) * sp, (nd[2] / nl) * sp];
              }
              // Recoil punch: when the PLAYER fires, add a little camera-shake trauma for weighty feedback.
              if (object.id === playerId) cameraShake = Math.min(1, cameraShake + 0.12);
              // Muzzle flash at the barrel for punchy weapon feedback.
              spawned.push(makeMuzzleFlash(muzzle));
              const gravity = typeof setup.gravity === 'number' ? setup.gravity : 0;
              const useHitscan = !setup.explosive && !setup.template && Math.abs(gravity) < 1e-6;
              if (useHitscan) {
                const phys = getActivePhysics();
                const sp = Math.hypot(velocity[0], velocity[1], velocity[2]) || speed || 1;
                const dirNorm: Vector3Tuple = [velocity[0] / sp, velocity[1] / sp, velocity[2] / sp];
                const maxDistance = Math.max(1, sp * (setup.life ?? 3));
                const exclude = new Set<string>([object.id]);
                for (const o of activeObjects) if (o.projectile || isRagdoll(o.id)) exclude.add(o.id);
                const hit = phys?.castRay(muzzle, dirNorm, maxDistance, exclude);
                if (hit) {
                  const target = activeObjectById.get(hit.objectId);
                  const hitPoint: Vector3Tuple = [
                    muzzle[0] + dirNorm[0] * hit.distance,
                    muzzle[1] + dirNorm[1] * hit.distance,
                    muzzle[2] + dirNorm[2] * hit.distance,
                  ];
                  if (target && !(hit.objectId === playerId && Boolean(state.runtimeCinematic || pendingCinematicId))) {
                    const cur = toNumber(nextObjectVariables[hit.objectId]?.health ?? target.variables?.health ?? 0);
                    if (target.variables?.health !== undefined || nextObjectVariables[hit.objectId]?.health !== undefined) {
                      const next = Math.max(0, cur - damage);
                      mutableObjectVars(hit.objectId, target.variables).health = next;
                      recordDamage(hit.objectId, cur - next);
                      if (next > 0 && target.character?.hurtSoundId) pushSound(target.character.hurtSoundId, [...target.transform.position] as Vector3Tuple);
                      if (next <= 0) {
                        if (object.id === playerId && hit.objectId !== playerId) killMarker += 1;
                        killTarget(target, hit.objectId, hitPoint);
                      }
                      spawned.push(makeDamageNumber(hitPoint, damage));
                      if (object.id === playerId) hitMarker += 1;
                      if (hit.objectId === playerId) hurt += 1;
                    } else {
                      const knockMul = setup.knockback ?? 1;
                      if (phys && knockMul > 0 && target.physics?.bodyType === 'dynamic') {
                        const k = Math.min(4, Math.max(1.5, sp * 0.045)) * knockMul;
                        phys.applyImpulse(hit.objectId, [dirNorm[0] * k, dirNorm[1] * k + 0.5 * knockMul, dirNorm[2] * k]);
                      }
                    }
                    spawned.push(makeImpactObject(hitPoint, setup.color));
                    if (setup.debug) prints.push(`Hitscan shot hit ${target.name}: ${target.variables?.health !== undefined ? `-${damage} hp` : 'impact'}`);
                  }
                } else if (setup.debug) {
                  prints.push(`Hitscan shot missed (${maxDistance.toFixed(1)}u)`);
                }
              } else {
                const projectileObj = makeProjectileObject(muzzle, velocity, object.id, damage, setup);
                spawned.push(projectileObj);
                if (setup.debug) {
                  prints.push(
                    `${object.name}: 🔫 spawned ${projectileObj.name} [${projectileObj.id.slice(-4)}] ` +
                      `at (${muzzle.map((n) => n.toFixed(1)).join(', ')}) ` +
                      `vel (${velocity.map((n) => n.toFixed(1)).join(', ')}) speed ${speed} dmg ${damage}` +
                      (template ? ` · template "${template.name}"` : ''),
                  );
                }
              }
            }

            return true;
          }

          // Per-object script error isolation: a throwing blueprint node (null ref, bad cast, divide
          // error in user logic) must not take down the whole frame loop and freeze Play. We catch it
          // here, report it once per session to the runtime console (see reportedScriptErrors), and let
          // every other object keep ticking. Partial transform writes made before the throw still commit
          // via the `changed` return below — same as a node chain that simply stops early.
          try {
            runtime.eventRoots
              .filter((node) => eventRootFires(node, object.id))
              .forEach((node) => executeFrom(node.id, new Set()));

            // Resume latent Delay nodes whose timer elapsed this frame: fire each delay node's exec-out
            // (the continuation that was held back when the Delay was first reached).
            const elapsedHere = elapsedDelaysByObject.get(object.id);
            if (elapsedHere) {
              for (const delayNodeId of elapsedHere) {
                (runtime.outgoing.get(delayNodeId) ?? []).forEach((targetId) => executeFrom(targetId, new Set()));
              }
            }

            // Resume Tween Property "Done" pins for tweens that finished this frame (exec-done handle).
            const tweensDoneHere = elapsedTweensByObject.get(object.id);
            if (tweensDoneHere) {
              for (const tweenNodeId of tweensDoneHere) {
                (runtime.outgoingByHandle.get(tweenNodeId)?.get('exec-done') ?? []).forEach((targetId) =>
                  executeFrom(targetId, new Set()),
                );
              }
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const key = `${object.id}:${message}`;
            if (!reportedScriptErrors.has(key)) {
              reportedScriptErrors.add(key);
              prints.push(`⚠️ Script error in "${object.name}": ${message}`);
              if (typeof console !== 'undefined') {
                console.error(`[NodeForge] Script error in "${object.name}" (${object.id}):`, error);
              }
            }
          }

          return changed
            ? {
                ...object,
                transform: { position, rotation, scale },
                renderer: nextRenderer,
              }
            : object;
      });
      recordRuntimeSection('scripts', performance.now() - scriptsStart);

      // Character controller pass: turn input into ground movement + jump for character objects.
      // Runs after scripts, before physics; the motion it produces feeds the animator's speed params.
      // Move `current` toward `target` by at most `maxStep` — the basis for accel/decel velocity ramping.
      const approach = (current: number, target: number, maxStep: number) => {
        const diff = target - current;
        return Math.abs(diff) <= maxStep ? target : current + Math.sign(diff) * maxStep;
      };

      // ---- Vehicle pass (pre-compute) ----------------------------------------------------------
      // Vehicle driving prepass. A kinematic car is fully positioned by this pass and follows terrain height;
      // a dynamic car leaves vertical motion and contact resolution to Rapier, while this pass commands only a
      // plausible horizontal tire velocity. The handling model keeps longitudinal speed and lateral slip
      // separate, so cars arc, drift and recover instead of instantly snapping to the heading every frame.
      const vehicleBody = new Map<string, { position: Vector3Tuple; rotation: Vector3Tuple; scale?: Vector3Tuple }>();
      const vehicleSteer = new Map<string, { position: Vector3Tuple; rotation: Vector3Tuple }>();
      const vehicleWheel = new Map<string, { position: Vector3Tuple; rotation: Vector3Tuple }>();
      const vehicleBrake = new Map<string, number>();
      // Live audio state for the driven car (engine pitch + skid volume), set below and published after the loop.
      let nextVehicleSound: EditorState['runtimeVehicleSound'] = null;
      const drivingVar = variableByName.get('Driving');
      const drivingActive =
        !drivingVar || toNumber(nextVariableValues[drivingVar.id] ?? drivingVar.defaultValue) > 0.5;
      const vehiclePlayerId = activeObjects.find((o) => o.vehicle?.enabled && o.vehicle.cameraFollow)?.id;
      // Apply cross-object transform writes (Set Position/Rotation/Scale/Look At with a Target) onto the
      // object list before the character/physics passes — so a teleported physics body follows (physics.frame
      // reads the post-script transform) and non-physics actors move too.
      if (Object.keys(nextTransforms).length) {
        mappedObjects = mappedObjects.map((object) => {
          const patch = nextTransforms[object.id];
          if (!patch || destroyedIds.has(object.id)) return object;
          return {
            ...object,
            transform: {
              position: patch.position ?? object.transform.position,
              rotation: patch.rotation ?? object.transform.rotation,
              scale: patch.scale ?? object.transform.scale,
            },
          };
        });
      }
      const mappedObjectById = fillObjectIdMap(tickMappedById, mappedObjects);
      // One terrain sampler for the whole tick: filters terrain objects once and memoizes
      // height queries on a grid (terrain transforms are identical across the mapped/moved/
      // resolved arrays, so this is valid for every pass below).
      const sampleTerrainHeight = createTerrainHeightSampler(mappedObjects);
      const groundAt = (x: number, z: number) => sampleTerrainHeight(x, z) ?? 0;
      const angleDelta = (from: number, to: number) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
      const findMantleTarget = (
        characterId: string,
        position: Vector3Tuple,
        dirX: number,
        dirZ: number,
        cc: CharacterControllerComponent,
        floorLevel: number,
      ): Vector3Tuple | undefined => {
        const dirLen = Math.hypot(dirX, dirZ);
        if (dirLen < 0.001) return undefined;
        const fx = dirX / dirLen;
        const fz = dirZ / dirLen;
        const range = Math.max(0.2, cc.mantleRange ?? 1.35);
        const maxHeight = Math.max(0.25, cc.mantleMaxHeight ?? 1.45);
        const minHeight = 0.25;
        let best: { to: Vector3Tuple; score: number } | undefined;
        for (const candidate of mappedObjects) {
          if (candidate.id === characterId || nextDisabled.has(candidate.id)) continue;
          if (!candidate.physics?.enabled || candidate.physics.isTrigger || candidate.physics.bodyType === 'dynamic') continue;
          const vars = { ...(candidate.variables ?? {}), ...(nextObjectVariables[candidate.id] ?? {}) };
          if (!toBoolean(vars.vaultable ?? false) && !toBoolean(vars.mantleable ?? false)) continue;
          const [cx, cy, cz] = candidate.transform.position;
          const [sx, sy, sz] = candidate.transform.scale;
          const relX = cx - position[0];
          const relZ = cz - position[2];
          const forward = relX * fx + relZ * fz;
          const halfDepth = Math.max(0.05, Math.max(Math.abs(sx), Math.abs(sz)) * 0.5);
          if (forward < 0.05 || forward > range + halfDepth) continue;
          const side = Math.abs(relX * fz - relZ * fx);
          const halfWidth = Math.max(0.5, Math.max(Math.abs(sx), Math.abs(sz)) * 0.55 + 0.45);
          if (side > halfWidth) continue;
          const topY = cy + Math.abs(sy) * 0.5;
          const height = topY - floorLevel;
          if (height < minHeight || height > maxHeight) continue;
          const vault = height <= (cc.vaultMaxHeight ?? 0.9) || toBoolean(vars.vaultable ?? false);
          const landingDistance = halfDepth + (vault ? 0.9 : 0.55);
          const to: Vector3Tuple = [cx + fx * landingDistance, topY + 0.08, cz + fz * landingDistance];
          const score = forward + side * 0.35 + height * 0.15;
          if (!best || score < best.score) best = { to, score };
        }
        return best?.to;
      };
      // ---- Race support (AI rivals / slipstream / positions) -----------------------------------
      // Last frame's pose of every vehicle — slipstream and the rivals' rubber-band read these.
      const vehiclePoses: Array<{ id: string; x: number; z: number; yaw: number; speed: number }> = [];
      for (const o of mappedObjects) {
        if (!o.vehicle?.enabled) continue;
        const bag = nextObjectVariables[o.id] ?? o.variables ?? {};
        const yawRaw = bag.__vehicleYaw;
        vehiclePoses.push({
          id: o.id,
          x: o.transform.position[0],
          z: o.transform.position[2],
          yaw: typeof yawRaw === 'number' && Number.isFinite(yawRaw) ? yawRaw : headingFromEuler(o.transform.rotation),
          speed: toNumber(bag.__vehicleSpeed ?? 0),
        });
      }
      // The scene's "Checkpoint <n>" gates double as the AI rivals' driving line — the same objects the
      // lap timer reads, so authoring a circuit once gives both lap timing AND opponents a racing line.
      // Every consumer is vehicle-bound (rivals, slipstream, lap timing), so the scan is skipped outright
      // in scenes with no vehicles, and the name→index regex is memoized (names are static; this ran
      // O(objects) regex execs every frame in every template).
      const raceCheckpoints: Array<{ idx: number; pos: Vector3Tuple }> = [];
      if (vehiclePoses.length) {
        for (const o of mappedObjects) {
          const idx = checkpointIndexForName(o.name);
          if (idx >= 0) raceCheckpoints.push({ idx, pos: o.transform.position });
        }
        raceCheckpoints.sort((a, b) => a.idx - b.idx);
      }
      const raceCpCount = raceCheckpoints.length ? raceCheckpoints[raceCheckpoints.length - 1].idx + 1 : 0;
      // Continuous race progress: laps + gates passed + how far toward the next gate. Comparable across
      // every car, so it ranks the field and feeds the rivals' rubber-banding.
      const raceProgress = (lap: number, nextIdx: number, x: number, z: number): number => {
        const t = raceCheckpoints.find((c) => c.idx === nextIdx) ?? raceCheckpoints[0];
        const frac = 1 - Math.min(1, Math.hypot(t.pos[0] - x, t.pos[2] - z) / 80);
        return lap * raceCpCount + ((nextIdx - 1 + raceCpCount) % raceCpCount) + frac;
      };
      let playerRaceProgress: number | undefined;
      if (raceCpCount && vehiclePlayerId) {
        const lapV = variableByName.get('Lap');
        const cpV = variableByName.get('Checkpoint');
        const pose = vehiclePoses.find((p) => p.id === vehiclePlayerId);
        if (lapV && cpV && pose) {
          playerRaceProgress = raceProgress(
            toNumber(nextVariableValues[lapV.id] ?? lapV.defaultValue),
            toNumber(nextVariableValues[cpV.id] ?? cpV.defaultValue) % raceCpCount,
            pose.x,
            pose.z,
          );
        }
      }
      for (const object of mappedObjects) {
        if (!object.vehicle?.enabled) continue;
        let veh = resolveVehicle(object.vehicle);
        // UPGRADE SCALING (Need-for-Speed-style garage): optional project variables let an in-game shop tune the
        // DRIVEN car at runtime with no per-car code — each is an upgrade LEVEL (0 = stock) the runtime turns into
        // a small percentage step. SpeedLevel raises top speed, AccelLevel sharpens the launch, GripLevel tightens
        // cornering + handbrake grip. Absent vars = stock handling, so this is invisible to non-upgrade games. Only
        // the player car (camera-follow) is scaled (the menu's idle cars stay stock).
        if (object.id === vehiclePlayerId) {
          // The upgrade/nitro scaling below mutates the player's copy — never the shared resolved view.
          veh = { ...veh };
          const upgradeLevel = (name: string): number => {
            const v = variableByName.get(name);
            return v ? Math.max(0, toNumber(nextVariableValues[v.id] ?? v.defaultValue)) : 0;
          };
          const speedLvl = upgradeLevel('SpeedLevel');
          const accelLvl = upgradeLevel('AccelLevel');
          const gripLvl = upgradeLevel('GripLevel');
          if (speedLvl) {
            veh.maxSpeed *= 1 + 0.16 * speedLvl;
            veh.maxReverseSpeed *= 1 + 0.16 * speedLvl;
          }
          if (accelLvl) veh.acceleration *= 1 + 0.2 * accelLvl;
          if (gripLvl) {
            veh.gripFactor = Math.min(0.995, veh.gripFactor + 0.012 * gripLvl);
            veh.handbrakeGrip = Math.min(0.6, veh.handbrakeGrip + 0.02 * gripLvl);
          }
          // NITRO / boost (also opt-in via a project var): a boost pad's graph sets "Nitro" to 1; while it's
          // above 0 the runtime lifts top speed + launch (a NFS-style surge), then DRAINS it back to 0 over ~2s.
          // Done here (not via Apply Force) because sustained boost should raise the car's handling envelope;
          // one-shot impulses still layer on top, but Nitro is smoother for a multi-frame surge.
          const nitroVar = variableByName.get('Nitro');
          if (nitroVar) {
            const nitro = Math.max(0, Math.min(1, toNumber(nextVariableValues[nitroVar.id] ?? nitroVar.defaultValue)));
            if (nitro > 0) {
              veh.maxSpeed *= 1 + 0.7 * nitro;
              veh.acceleration *= 1 + 1.6 * nitro;
              nextVariableValues[nitroVar.id] = Math.max(0, nitro - delta * 0.5);
            }
          }
        }
        // A DYNAMIC car lets the Rapier solver own its vertical motion + collision response (so fixed scenery
        // physically stops it); a KINEMATIC car has the runtime own the whole transform (terrain-following Y +
        // suspension) and is never stopped by the solver.
        const dynamic = object.physics?.bodyType === 'dynamic';
        const vehicleVars = mutableObjectVars(object.id, object.variables);
        if (!Array.isArray(vehicleVars.__vehicleBaseScale)) vehicleVars.__vehicleBaseScale = object.transform.scale;
        const authoredYaw = headingFromEuler(object.transform.rotation);
        const storedYaw = typeof vehicleVars.__vehicleYaw === 'number' ? vehicleVars.__vehicleYaw : undefined;
        const yaw: number = storedYaw !== undefined && Number.isFinite(storedYaw) ? storedYaw : Number(authoredYaw ?? 0);
        let crashTimer = Math.max(0, toNumber(vehicleVars.__vehicleCrashTimer ?? 0) - delta);
        const crashDamage = Math.max(0, toNumber(vehicleVars.__vehicleDamage ?? 0));
        const crashPhysicsActive = Boolean(veh.crashDamageEnabled) && crashTimer > 0;
        const prevVel = nextVelocities[object.id] ?? [0, 0, 0];
        const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
        const forwardX = Math.sin(yaw);
        const forwardZ = Math.cos(yaw);
        const rightX = Math.cos(yaw);
        const rightZ = -Math.sin(yaw);
        const prevVx = prevVel[0] ?? 0;
        const prevVz = prevVel[2] ?? 0;
        const prevSpeed = prevVx * forwardX + prevVz * forwardZ;
        let lateralSpeed = prevVx * rightX + prevVz * rightZ;
        // Input: a SCRIPTED car (has a blueprint) is driven by its "Drive" node (vehicleScriptInputs) — fully
        // editable in the graph. An AUTO car (no blueprint) reads its keys directly, gated by the Driving var.
        const scripted = Boolean(object.script?.enabled);
        const di = vehicleScriptInputs[object.id];
        const crashControl = crashPhysicsActive ? 0.22 : 1;
        // AI RIVAL DRIVER: a self-driving opponent aiming at the "Checkpoint <n>" gates. Pure-pursuit
        // steering toward the next gate (aim blends toward the one after as it nears, cutting a racing line),
        // corner-aware pace, a reverse-out unstick, and rubber-banding against the player's race progress.
        // It holds on the grid while a "Driving" var gates the start, exactly like the player's keys.
        const aiDriving = Boolean(veh.aiDriver) && !scripted;
        let aiThrottle = 0;
        let aiSteer = 0;
        let aiHandbrake = false;
        if (aiDriving && raceCpCount) {
          const skill = clamp(veh.aiSkill ?? 0.7, 0, 1);
          // 'wander' = ambient TRAFFIC: the gates are a road network, not a racing line — on reaching one,
          // pick a random NEARBY gate next (avoiding an immediate U-turn), cruise at city pace, and ignore
          // the race-only behaviors (lap counting, rubber-band, grid hold).
          const wander = veh.aiMode === 'wander';
          let nextCp = toNumber(vehicleVars.__aiNextCp ?? 0) % raceCpCount;
          const pos = object.transform.position;
          let target = raceCheckpoints.find((c) => c.idx === nextCp) ?? raceCheckpoints[0];
          const dist = Math.hypot(target.pos[0] - pos[0], target.pos[2] - pos[2]);
          if (dist < (wander ? 11 : 16)) {
            if (wander) {
              const fromIdx = nextCp;
              const cameFrom = toNumber(vehicleVars.__aiPrevCp ?? -1);
              const nearby = raceCheckpoints
                .filter((c) => c.idx !== fromIdx)
                .map((c) => ({ idx: c.idx, d: Math.hypot(c.pos[0] - target.pos[0], c.pos[2] - target.pos[2]) }))
                .sort((a, b) => a.d - b.d)
                .slice(0, 3);
              const forward = nearby.length > 1 ? nearby.filter((c) => c.idx !== cameFrom) : nearby;
              const pick = forward[Math.floor(Math.random() * forward.length)] ?? nearby[0];
              if (pick) {
                vehicleVars.__aiPrevCp = fromIdx;
                nextCp = pick.idx;
                vehicleVars.__aiNextCp = nextCp;
                target = raceCheckpoints.find((c) => c.idx === nextCp) ?? target;
              }
            } else {
              // Same gate radius + ordering rules as the player's lap timer, so rivals bank laps fairly.
              if (nextCp === 0) vehicleVars.__aiLap = toNumber(vehicleVars.__aiLap ?? 0) + 1;
              nextCp = (nextCp + 1) % raceCpCount;
              vehicleVars.__aiNextCp = nextCp;
            }
          }
          // Traffic aims straight at its gate (no race-line cutting through corners).
          const after = wander ? target : raceCheckpoints.find((c) => c.idx === (nextCp + 1) % raceCpCount) ?? target;
          const blend = clamp(1 - dist / 34, 0, 0.6);
          let aimX = target.pos[0] + (after.pos[0] - target.pos[0]) * blend;
          let aimZ = target.pos[2] + (after.pos[2] - target.pos[2]) * blend;
          if (wander) {
            // Drive on the RIGHT: shift the aim point sideways off the gate-to-gate line, so opposing
            // traffic passes instead of meeting head-on in the middle of the road.
            const toAimX = aimX - pos[0];
            const toAimZ = aimZ - pos[2];
            const toAimLen = Math.hypot(toAimX, toAimZ) || 1;
            aimX += (toAimZ / toAimLen) * 2.4;
            aimZ += (-toAimX / toAimLen) * 2.4;
          }
          const desired = angleDelta(yaw, Math.atan2(aimX - pos[0], aimZ - pos[2]));
          aiSteer = clamp(desired * (1.6 + skill * 0.8), -1, 1);
          const spd = Math.abs(toNumber(vehicleVars.__vehicleSpeed ?? prevSpeed));
          // Corner-aware pace: the harder the line bends at the gate, the more it slows on approach.
          const corner = Math.abs(
            angleDelta(
              Math.atan2(target.pos[0] - pos[0], target.pos[2] - pos[2]),
              Math.atan2(after.pos[0] - target.pos[0], after.pos[2] - target.pos[2]),
            ),
          );
          const cornerBrake = clamp(1 - dist / 40, 0, 1) * clamp(corner / 1.6, 0, 1);
          // City traffic cruises; racers commit.
          let targetSpeed = wander
            ? (8 + 7 * skill) * (1 - 0.5 * Math.abs(aiSteer))
            : (16 + 18 * skill) * (1 - 0.62 * cornerBrake) * (1 - 0.5 * Math.abs(aiSteer));
          // RUBBER-BAND: quietly breathe when ahead of the player, push when behind — keeps the pack close.
          if (!wander && playerRaceProgress !== undefined) {
            const rubber = clamp(veh.aiRubberBand ?? 0.5, 0, 1);
            const gap = raceProgress(toNumber(vehicleVars.__aiLap ?? 0), nextCp, pos[0], pos[2]) - playerRaceProgress;
            targetSpeed *= 1 - clamp(gap * 0.1, -0.3, 0.22) * rubber;
          }
          // --- WANDER competence: queue behind cars and feel for obstacles instead of ramming them. ---
          if (wander) {
            // Car ahead (incl. the player): match its pace, stop short when close — traffic queues.
            const fAx = Math.sin(yaw);
            const fAz = Math.cos(yaw);
            for (const p of vehiclePoses) {
              if (p.id === object.id) continue;
              const ox = p.x - pos[0];
              const oz = p.z - pos[2];
              const d = Math.hypot(ox, oz);
              if (d < 0.001 || d > 11) continue;
              if ((ox * fAx + oz * fAz) / d > 0.8) {
                targetSpeed = Math.min(targetSpeed, d < 5.5 ? 0 : Math.max(0, Math.abs(p.speed) * 0.9));
              }
            }
            // Feelers: three short rays sweep ahead; steer toward the clearer side, slow when boxed in.
            // (positive steer turns RIGHT, so a blocked right side pushes the correction negative/left.)
            const phys = getActivePhysics();
            if (phys) {
              aiFeelerExclude.clear();
              aiFeelerExclude.add(object.id);
              const reach = clamp(5 + spd * 0.9, 5, 13);
              const origin: Vector3Tuple = [pos[0], pos[1] + 0.55, pos[2]];
              const clearance = (offset: number) => {
                const a = yaw + offset;
                const hit = phys.castRay(origin, [Math.sin(a), 0, Math.cos(a)], reach, aiFeelerExclude);
                return hit ? hit.distance / reach : 1;
              };
              const cLeft = clearance(-0.45);
              const cMid = clearance(0);
              const cRight = clearance(0.45);
              if (cMid < 1 || cLeft < 1 || cRight < 1) {
                aiSteer = clamp(aiSteer + (cRight - cLeft) * 1.5, -1, 1);
                if (cMid < 0.4) targetSpeed = 0; // boxed in — stop; the unstick below reverses out if it stays stuck
                else if (cMid < 0.75) targetSpeed = Math.min(targetSpeed, 4);
              }
            }
          }
          aiThrottle = clamp((targetSpeed - spd) * 0.35, -1, 1);
          // Unstick: nosed into a wall (commanding throttle, not moving) → back out with opposite lock.
          let stuck = toNumber(vehicleVars.__aiStuck ?? 0);
          let reverseT = toNumber(vehicleVars.__aiReverse ?? 0);
          if (reverseT > 0) {
            reverseT -= delta;
            aiThrottle = -1;
            aiSteer = -aiSteer;
          } else {
            stuck = drivingActive && spd < 1.2 && aiThrottle > 0.2 ? stuck + delta : 0;
            if (stuck > 1.6) {
              reverseT = 1.3;
              stuck = 0;
            }
          }
          vehicleVars.__aiStuck = stuck;
          vehicleVars.__aiReverse = Math.max(0, reverseT);
          if (!drivingActive && !wander) {
            // Grid hold: lights aren't green yet — park on the handbrake. (Traffic ignores the race grid.)
            aiThrottle = 0;
            aiHandbrake = true;
          }
        }
        // Gamepad (auto cars only — scripted cars get pad input through their Get Drive Input node):
        // RT/LT analog throttle/brake, left stick X steers (stick right = steer right = -1 here).
        const throttleSig = (scripted
          ? (di ? di.throttle : 0)
          : aiDriving
            ? aiThrottle
            : drivingActive
              ? Math.max(
                  -1,
                  Math.min(
                    1,
                    (currentKeys[veh.keyThrottle] ? 1 : 0) -
                      (currentKeys[veh.keyReverse] ? 1 : 0) +
                      gamepadInput.throttle -
                      gamepadInput.brake,
                  ),
                )
              : 0) * crashControl;
        const steerRaw = (scripted
          ? (di ? di.steer : 0)
          : aiDriving
            ? aiSteer
            : drivingActive
              ? Math.max(
                  -1,
                  Math.min(1, (currentKeys[veh.keyLeft] ? 1 : 0) - (currentKeys[veh.keyRight] ? 1 : 0) - gamepadInput.moveX),
                )
              : 0) * crashControl;
        // Handbrake: scripted cars read it from the Drive node, auto cars from the key. It loosens rear grip
        // (oversteer / drift) and bleeds a little speed.
        const handbrake = scripted
          ? Boolean(di?.handbrake)
          : aiDriving
            ? aiHandbrake
            : drivingActive
              ? Boolean(currentKeys[veh.keyHandbrake])
              : false;
        // RAYCAST SIM: a real Rapier DynamicRayCastVehicleController owns the chassis dynamics. We only resolve
        // driver input here and hand it to physics.frame; the chassis transform + wheel poses come BACK from the
        // physics result (handled in the post-step writeback below). Skip the entire arcade tire model.
        if (veh.physicsModel === 'raycast') {
          // The speed menu / Nitro / Damage project vars tune (and drain against) the PLAYER car only —
          // rivals on the same circuit must not get the player's upgrades or burn the player's Nitro.
          const isPlayerCar = object.id === vehiclePlayerId;
          // In-game speed menu: a "SpeedLevel" project var scales engine force at runtime (buttons inc/dec it).
          const slVar = variableByName.get('SpeedLevel');
          const speedLevel = isPlayerCar && slVar ? toNumber(nextVariableValues[slVar.id] ?? slVar.defaultValue) : 0;
          // NITRO boost (opt-in, same hook as arcade): a "Nitro" var set to 1 (e.g. a Shift key / boost pad)
          // gives a big engine-force surge that drains back to 0 over ~2s. Bind a HUD bar's fill to "Nitro".
          const nitroVar = variableByName.get('Nitro');
          let nitroBoost = 1;
          if (isPlayerCar && nitroVar) {
            const nitro = Math.max(0, Math.min(1, toNumber(nextVariableValues[nitroVar.id] ?? nitroVar.defaultValue)));
            if (nitro > 0) {
              nitroBoost = 1 + 1.4 * nitro;
              nextVariableValues[nitroVar.id] = Math.max(0, nitro - delta * 0.5);
            }
          }
          // CRASH CONSEQUENCE: accumulated body damage saps engine power (each dent costs ~2.5%, capped at
          // -40%) — wreck the car and it limps, which makes the breakables/walls actually matter.
          const dmgVarIn = variableByName.get('Damage');
          const dmgNow = isPlayerCar && dmgVarIn ? Math.max(0, toNumber(nextVariableValues[dmgVarIn.id] ?? dmgVarIn.defaultValue)) : 0;
          const damageScale = 1 - Math.min(0.4, dmgNow * 0.025);
          // SLIPSTREAM: tuck in close behind another car at speed and the hole it punches in the air feeds
          // the engine — following close pays off with a genuine overtake run (rivals draft each other too).
          let draft = 0;
          const draftSpd = Math.abs(toNumber(vehicleVars.__vehicleSpeed ?? 0));
          if (draftSpd > 13) {
            const fwdX = Math.sin(yaw);
            const fwdZ = Math.cos(yaw);
            for (const other of vehiclePoses) {
              if (other.id === object.id) continue;
              const dx = other.x - object.transform.position[0];
              const dz = other.z - object.transform.position[2];
              const ahead = dx * fwdX + dz * fwdZ;
              if (ahead < 4 || ahead > 22) continue;
              const side = Math.abs(dx * fwdZ - dz * fwdX);
              if (side > 3.2) continue;
              draft = Math.max(draft, (1 - (ahead - 4) / 18) * (1 - side / 3.2));
            }
          }
          // Mirror the player's tow strength into an optional "Draft" var (HUD slipstream indicator).
          const draftVar = variableByName.get('Draft');
          if (isPlayerCar && draftVar) nextVariableValues[draftVar.id] = Math.round(draft * 100) / 100;
          const engineScale = Math.max(0.5, Math.min(4, (1 + 0.18 * speedLevel) * nitroBoost)) * damageScale * (1 + 0.34 * draft);
          // WEATHER: a "Wet" project var (0..1, toggled by the template's rain mode) slicks every surface —
          // the sim multiplies each wheel's surface grip by this, so braking/cornering degrade for real.
          const wetVar = variableByName.get('Wet');
          const wetNow = wetVar ? Math.max(0, Math.min(1, toNumber(nextVariableValues[wetVar.id] ?? wetVar.defaultValue))) : 0;
          const gripScale = 1 - 0.42 * wetNow;
          // BRAKE FADE: the disc-heat model (accumulated post-physics) softens the service brake once the
          // discs run hot — up to -40% bite at full glow, recovering as they cool. Handbrake is unaffected.
          const heatNow = Math.max(0, Math.min(1, toNumber(vehicleVars.__brakeHeat ?? 0)));
          const brakeScale = 1 - (0.4 * Math.max(0, heatNow - 0.45)) / 0.55;
          // Respawn on a fresh R press (edge): teleports the car back to spawn (auto flip-recover is automatic).
          const respawn = isPlayerCar && Boolean(currentKeys['KeyR'] && !previousKeys['KeyR']);
          // Respawning also REPAIRS: dents pop back out and the Damage counter (with its power penalty) resets.
          if (respawn) {
            clearVehicleDentsFor(object.id);
            if (dmgVarIn) nextVariableValues[dmgVarIn.id] = 0;
            vehicleVars.__brakeHeat = 0;
            // …and every torn-off loose part bolts back onto its original spot (post-physics pass).
            for (const [pid, info] of detachedParts) {
              if (info.parentId === object.id) {
                pendingPartRestores.set(pid, info);
                detachedParts.delete(pid);
                pendingPartKicks.delete(pid);
              }
            }
          }
          // DRIVE FEEL: ease the steering in/out instead of snapping (twitchy) AND reduce the lock at speed so
          // the car is stable on the straights but still turns sharply when slow. Smoothed per-car.
          const refSpeed = 42;
          const spd = Math.abs(toNumber(vehicleVars.__vehicleSpeed ?? 0));
          // Keep more steering authority at speed (0.68 floor) so it stays fun/responsive, not numb.
          const steerLimit = 1 - 0.32 * Math.min(1, spd / refSpeed);
          const targetSteer = steerRaw * steerLimit;
          const prevSteerState = toNumber(vehicleVars.__vehicleSteerState ?? 0);
          // Crisp turn-in, even crisper return-to-center — and BOTH quicken at low speed, so parking-lot
          // flicks feel instant while highway speed keeps a touch of ease (stable, never darty).
          const lowSpeedBoost = 1 + 0.6 * (1 - Math.min(1, spd / refSpeed));
          const steerRate = (steerRaw === 0 ? 13 : 9.5) * lowSpeedBoost * delta;
          const steerState = approach(prevSteerState, targetSteer, steerRate);
          vehicleVars.__vehicleSteerState = steerState;
          // Manual gearbox paddles (level-style; the sim edge-detects): E/Q by default, which the gamepad
          // Y / LB buttons hit through the default key aliases.
          const shiftUp = isPlayerCar && Boolean(currentKeys[veh.keyShiftUp ?? 'KeyE']);
          const shiftDown = isPlayerCar && Boolean(currentKeys[veh.keyShiftDown ?? 'KeyQ']);
          // PERFECT LAUNCH: be at full throttle the instant the start gate (the "Driving" var) waves green
          // and the launch pays out — a free shot of Nitro, a "PERFECT LAUNCH!" banner (Stunt = 3) and combo
          // points. Turns every countdown into a drag-tree timing mini-game.
          if (isPlayerCar && drivingVar) {
            const wasDriving = toNumber(vehicleVars.__wasDriving ?? 0) > 0.5;
            if (drivingActive && !wasDriving && throttleSig > 0.9) {
              if (nitroVar) nextVariableValues[nitroVar.id] = Math.max(0.8, toNumber(nextVariableValues[nitroVar.id] ?? nitroVar.defaultValue));
              vehicleVars.__stuntKind = 3;
              vehicleVars.__stuntTimer = 1.6;
              vehicleVars.__stuntPending = Math.max(0, toNumber(vehicleVars.__stuntPending ?? 0)) + 120;
              vehicleVars.__stuntLapse = 0;
            }
            vehicleVars.__wasDriving = drivingActive ? 1 : 0;
          }
          vehicleInputs[object.id] = { throttle: throttleSig, steer: steerState, handbrake, engineScale, respawn, shiftUp, shiftDown, gripScale, brakeScale };
          continue;
        }
        const braking = throttleSig < -0.05;
        // Integrate longitudinal speed. Throttle tapers near the limiter, reverse first brakes a forward roll,
        // and coasting keeps real momentum while drag gradually bleeds it off.
        let speed = prevSpeed;
        if (throttleSig > 0.05) {
          const accel = veh.acceleration * throttleSig * (0.28 + 0.72 * Math.max(0, 1 - Math.max(0, speed) / Math.max(0.001, veh.maxSpeed)));
          speed = speed < -0.01 ? approach(speed, 0, veh.braking * delta) : Math.min(veh.maxSpeed, speed + accel * delta);
        } else if (throttleSig < -0.05) {
          speed = speed > 0.01 ? approach(speed, 0, veh.braking * delta) : Math.max(-veh.maxReverseSpeed, speed - veh.acceleration * 0.6 * -throttleSig * delta);
        } else {
          speed = approach(speed, 0, veh.drag * delta);
        }
        // Handbrake locks the rears: it drops lateral grip and also scrubs a little forward speed.
        if (handbrake) speed = approach(speed, 0, veh.drag * 1.8 * delta);
        if (Math.abs(speed) < 0.02) speed = 0;

        // Find the wheels (needed for steering wheelbase + suspension).
        const wheels = veh.wheelObjectIds
          .map((wid) => mappedObjectById.get(wid))
          .filter((w): w is SceneObject => Boolean(w));
        const wheelAnchor = (wheel: SceneObject): SceneObject | undefined => {
          const parent = wheel.parentId ? mappedObjectById.get(wheel.parentId) : undefined;
          return parent?.parentId === object.id ? parent : undefined;
        };
        const wheelCenter = (wheel: SceneObject): Vector3Tuple => wheelAnchor(wheel)?.transform.position ?? wheel.transform.position;

        // STEERING — a kinematic "bicycle model" so it feels like a car, not a spinning top:
        //  • the steer angle is SMOOTHED toward the input and SPEED-SENSITIVE (less lock at speed) — no twitch;
        //  • yaw rate = (speed / wheelbase) · tan(steer), so the car ARCS with a radius set by speed and steer,
        //    and CANNOT spin in place (zero speed → zero turn). Reversing flips the turn direction naturally.
        const steeredWheels = wheels.filter((w) => veh.steeredWheelIds.includes(w.id));
        const steeredAnchors = veh.steeredWheelIds
          .map((id) => mappedObjectById.get(id))
          .filter((w): w is SceneObject => Boolean(w));
        // VISUAL steer cranks the front wheels to the FULL steer angle (clearly visible that the WHEELS turn,
        // not just the frame), smoothed for weight. The car's actual yaw uses a gentler, speed-reduced steer so
        // it arcs instead of spinning — decoupling the two keeps the wheels expressive without twitchy handling.
        const prevSteer = (steeredAnchors[0] ?? steeredWheels[0])?.transform.rotation[1] ?? 0;
        const topFrac = Math.min(1, Math.abs(speed) / Math.max(0.001, veh.maxSpeed));
        const steerK = 1 - Math.exp(-9 * Math.min(delta, 0.1));
        const visualSteer = prevSteer + (steerRaw * veh.steerAngle - prevSteer) * steerK;
        // Grip controls lateral velocity recovery. High grip kills sideways motion quickly; handbrake lowers it
        // so the car carries a slide and then settles instead of snapping straight.
        const loadAccel = Math.abs(speed - prevSpeed) / Math.max(delta, 1e-4);
        const weightTransfer = clamp(Number(veh.weightTransfer ?? 0.42), 0, 1);
        const downforce = Math.max(0, Number(veh.downforce ?? 0.18));
        const loadFactor = clamp((loadAccel / Math.max(1, veh.braking)) * 0.45 + Math.abs(steerRaw) * topFrac * 0.55, 0, 1);
        const baseGrip = clamp(handbrake ? veh.handbrakeGrip : veh.gripFactor, 0.02, 0.995);
        const transferGrip = baseGrip * (1 - weightTransfer * loadFactor * (handbrake ? 0.1 : 0.22));
        const aeroGrip = transferGrip + downforce * topFrac * topFrac * 0.08;
        const grip = clamp(aeroGrip, 0.02, 0.995);
        const lateralDamping = (handbrake ? 1.6 : 3.2) + grip * (handbrake ? 7 : 22);
        lateralSpeed *= Math.exp(-lateralDamping * Math.min(delta, 0.1));
        const effectiveSteer = visualSteer * (1 - (handbrake ? 0.15 : 0.5) * topFrac);
        const lzs = wheels.map((w) => wheelCenter(w)[2]);
        const wheelbase = wheels.length ? Math.max(0.8, Math.max(...lzs) - Math.min(...lzs)) : 2.4;
        const oversteer = 1 + (1 - grip) * (handbrake ? 1.9 : 0.45);
        const lowSpeedAssist = 1.25 - 0.25 * topFrac;
        const yawRate = (speed / wheelbase) * Math.tan(effectiveSteer) * oversteer * lowSpeedAssist * Math.max(0.2, veh.turnRate / 2);
        const cornerLoad = Math.abs(yawRate * speed) / Math.max(8, veh.maxSpeed * 0.9);
        const slip = clamp(
          Math.abs(lateralSpeed) / (5 + topFrac * 14) + Math.max(0, cornerLoad * (1 - grip) - 0.08) + (handbrake && Math.abs(speed) > 2 ? 0.25 + 0.45 * topFrac : 0),
          0,
          1,
        );
        const tractionControl = clamp(Number(veh.tractionControl ?? 0.35), 0, 1);
        if (tractionControl > 0 && throttleSig > 0.05 && !handbrake && slip > 0.32) {
          const cut = ((slip - 0.32) / 0.68) * tractionControl;
          speed = approach(speed, prevSpeed, veh.acceleration * cut * delta);
        }
        const newYaw = yaw + yawRate * delta;
        vehicleVars.__vehicleYaw = newYaw;
        const cosY = Math.cos(newYaw);
        const sinY = Math.sin(newYaw);
        const position = [...object.transform.position] as Vector3Tuple;

        // Crash-stop against fixed scenery from last frame's contact index. Dynamic props still get pushed.
        if (dynamic) {
          const wallContacts = contactOthers(priorCollisionIndex, object.id);
          if (wallContacts) {
            let hardImpact = false;
            for (const otherId of wallContacts) {
              const other = mappedObjectById.get(otherId);
              if (other && other.kind !== 'terrain' && other.physics?.bodyType !== 'dynamic') {
                hardImpact = true;
                speed = approach(speed, 0, veh.braking * 2.8 * delta);
                lateralSpeed = approach(lateralSpeed, 0, veh.braking * 2.2 * delta);
                break;
              }
            }
            if (hardImpact && veh.crashDamageEnabled) {
              const impactSpeed = Math.hypot(prevVx, prevVel[1] ?? 0, prevVz);
              const damageThreshold = Math.max(0.1, Number(veh.crashDamageThreshold ?? 9));
              const rolloverThreshold = Math.max(damageThreshold, Number(veh.crashRolloverThreshold ?? 16));
              const severity = Math.max(0, (impactSpeed - damageThreshold) / Math.max(1, rolloverThreshold - damageThreshold));
              if (severity > 0) {
                const nextDamage = Math.min(10, crashDamage + severity * 0.55);
                vehicleVars.__vehicleDamage = nextDamage;
                crashTimer = Math.max(crashTimer, impactSpeed >= rolloverThreshold ? 1.3 + Math.min(1.4, severity * 0.5) : 0.35);
                vehicleVars.__vehicleCrashTimer = crashTimer;
                const strength = Number(veh.crashRolloverStrength ?? 0.42);
                const lateralSign = Math.sign(lateralSpeed || steerRaw || prevVx * cosY - prevVz * sinY || 1);
                const forwardSign = Math.sign(prevSpeed || speed || 1);
                const torque: Vector3Tuple = [
                  -forwardSign * severity * strength * 8,
                  lateralSign * severity * strength * 1.5,
                  -lateralSign * severity * strength * 10,
                ];
                const accruedTorque = physicsAngularImpulses[object.id] ?? [0, 0, 0];
                physicsAngularImpulses[object.id] = [accruedTorque[0] + torque[0], accruedTorque[1] + torque[1], accruedTorque[2] + torque[2]];
                const recoil: Vector3Tuple = [-sinY * severity * 2.2, Math.min(2.5, severity * 1.2), -cosY * severity * 2.2];
                const accruedImpulse = physicsImpulses[object.id] ?? [0, 0, 0];
                physicsImpulses[object.id] = [accruedImpulse[0] + recoil[0], accruedImpulse[1] + recoil[1], accruedImpulse[2] + recoil[2]];
                const debrisCooldown = Math.max(0, toNumber(vehicleVars.__vehicleCrashDebrisCooldown ?? 0) - delta);
                if (veh.crashDebris && severity > 0.75 && debrisCooldown <= 0) {
                  vehicleVars.__vehicleCrashDebrisCooldown = 0.8;
                  const count = Math.min(5, 2 + Math.floor(severity));
                  for (let i = 0; i < count; i += 1) {
                    const scatter = (i - (count - 1) / 2) * 0.45;
                    spawned.push(
                      crashDebrisObject(
                        [position[0] + cosY * scatter, position[1] + 0.5 + Math.random() * 0.35, position[2] - sinY * scatter],
                        [recoil[0] * (1 + Math.random()), 1.5 + Math.random() * 2, recoil[2] * (1 + Math.random())],
                        i,
                      ),
                    );
                  }
                } else {
                  vehicleVars.__vehicleCrashDebrisCooldown = debrisCooldown;
                }
              }
            }
          }
        }

        const velocityX = sinY * speed + cosY * lateralSpeed;
        const velocityZ = cosY * speed - sinY * lateralSpeed;
        position[0] += velocityX * delta;
        position[2] += velocityZ * delta;

        // Signed acceleration (squat/dive + the brake-squeal trigger), shared by both body modes.
        const accelSig = (speed - prevSpeed) / Math.max(delta, 1e-4);
        const TWO_PI = Math.PI * 2;
        const physicsRollActive = Boolean(veh.crashDamageEnabled) && crashTimer > 0;
        vehicleVars.__vehicleCrashTimer = crashTimer;
        const currentDamage = Math.max(0, toNumber(vehicleVars.__vehicleDamage ?? 0));
        const baseScale = Array.isArray(vehicleVars.__vehicleBaseScale) ? vehicleVars.__vehicleBaseScale : object.transform.scale;
        const crush = Boolean(veh.crashDamageEnabled) ? clamp((currentDamage / 10) * Number(veh.crashDeformation ?? 0.45), 0, 0.22) : 0;
        const damageScale: Vector3Tuple | undefined = crush > 0.001
          ? [Number(baseScale[0]) * (1 + crush * 0.18), Number(baseScale[1]) * (1 - crush * 0.4), Number(baseScale[2]) * (1 - crush * 0.16)]
          : undefined;
        const wheelBreakThreshold = Math.max(0.1, Number(veh.crashWheelBreakThreshold ?? 1.6));
        const brokenWheelCount = veh.crashDamageEnabled ? clamp(Math.floor((currentDamage - wheelBreakThreshold) / Math.max(0.25, wheelBreakThreshold * 0.45)) + 1, 0, wheels.length) : 0;

        if (dynamic) {
          if (downforce > 0 && Math.abs(speed) > 2) {
            const mass = Math.max(0.1, Number(object.physics?.mass ?? 1));
            const impulse = downforce * topFrac * topFrac * mass * 9.8 * delta;
            const accruedImpulse = physicsImpulses[object.id] ?? [0, 0, 0];
            physicsImpulses[object.id] = [accruedImpulse[0], accruedImpulse[1] - impulse, accruedImpulse[2]];
          }
          // DYNAMIC body: Rapier owns Y and contact resolution. We command X/Z from the tire model only;
          // leaving Y unchanged means gravity/resting contact remain fully solver-owned.
          position[1] = object.transform.position[1];
          nextVelocities[object.id] = [velocityX, 0, velocityZ];

          // Normal driving uses cosmetic squat/dive + turn lean. During a hard crash/rollover, Rapier's
          // rotation is preserved so the car can actually tumble instead of snapping upright.
          const targetPitch = Math.max(-0.08, Math.min(0.08, -accelSig * veh.bodyPitch * 0.04 * (1 + weightTransfer * 0.7)));
          const turnLean = (-yawRate * Math.abs(speed) - lateralSpeed * 0.12) * veh.bodyRoll * (1 + slip * 1.5 + weightTransfer * 0.35);
          const targetRoll = clamp(turnLean, -0.16, 0.16);
          const tiltK = 1 - Math.exp(-12 * Math.min(delta, 0.1));
          const pitchNow = object.transform.rotation[0] + (targetPitch - object.transform.rotation[0]) * tiltK;
          const rollNow = object.transform.rotation[2] + (targetRoll - object.transform.rotation[2]) * tiltK;
          vehicleBody.set(object.id, { position, rotation: physicsRollActive ? object.transform.rotation : [pitchNow, newYaw, rollNow], scale: damageScale });

          // Wheels spin from forward travel and steer visibly; dynamic cars keep the wheel centers authored so
          // the chassis collision hull remains stable while the solver handles ground contact.
          wheels.forEach((w) => {
            const base = w.transform.rotation;
            const spin = (base[0] + (speed / Math.max(0.05, veh.wheelRadius)) * delta) % TWO_PI;
            const wheelIndex = wheels.findIndex((wheel) => wheel.id === w.id);
            const broken = wheelIndex >= 0 && wheelIndex >= wheels.length - brokenWheelCount;
            const brokenDrop = broken ? Math.min(0.65, 0.18 + currentDamage * 0.06) : 0;
            const brokenToe = broken ? (wheelIndex % 2 ? -1 : 1) * Math.min(1.0, 0.32 + currentDamage * 0.05) : 0;
            const anchor = wheelAnchor(w);
            if (anchor) {
              const steerY = veh.steeredWheelIds.includes(anchor.id) ? visualSteer : anchor.transform.rotation[1];
              vehicleSteer.set(anchor.id, {
                position: [anchor.transform.position[0], anchor.transform.position[1] - brokenDrop, anchor.transform.position[2]],
                rotation: [anchor.transform.rotation[0] + (broken ? 0.35 : 0), steerY + brokenToe, anchor.transform.rotation[2] + brokenToe * 0.45],
              });
              vehicleWheel.set(w.id, { position: w.transform.position, rotation: [spin, broken ? brokenToe * 0.5 : 0, base[2] + (broken ? 0.45 : 0)] });
            } else {
              const steerY = veh.steeredWheelIds.includes(w.id) ? visualSteer : base[1];
              vehicleWheel.set(w.id, { position: [w.transform.position[0], w.transform.position[1] - brokenDrop, w.transform.position[2]], rotation: [spin, steerY + brokenToe, base[2] + (broken ? 0.45 : 0)] });
            }
          });
        } else {
          // KINEMATIC body: the runtime fully owns the transform (terrain-following Y + suspension), so the car
          // can never be launched by the solver — but fixed scenery does NOT stop it (it drives through).
          // Sample the terrain under each wheel (world space) for the suspension.
          const wheelGround = wheels.map((w) => {
            const center = wheelCenter(w);
            const lx = center[0];
            const lz = center[2];
            return groundAt(position[0] + lx * cosY + lz * sinY, position[2] - lx * sinY + lz * cosY);
          });
          const avgGround = wheelGround.length
            ? wheelGround.reduce((a, b) => a + b, 0) / wheelGround.length
            : groundAt(position[0], position[2]);

          // Chassis Y rides on the terrain (springy). suspensionStiffness controls how fast it settles.
          const settle = 1 - Math.exp(-(8 + veh.suspensionStiffness * 40) * Math.min(delta, 0.1));
          const targetY = avgGround + veh.rideHeight;
          position[1] = object.transform.position[1] + (targetY - object.transform.position[1]) * settle;
          const velocity: Vector3Tuple = [sinY * speed, (position[1] - object.transform.position[1]) / Math.max(delta, 1e-4), cosY * speed];
          velocity[0] = velocityX;
          velocity[2] = velocityZ;
          nextVelocities[object.id] = velocity;

          // Terrain tilt (pitch from front↔rear ground, roll from left↔right) + accel squat + turn lean.
          const frontG: number[] = [];
          const rearG: number[] = [];
          const leftG: number[] = [];
          const rightG: number[] = [];
          wheels.forEach((w, i) => {
            const center = wheelCenter(w);
            (center[2] >= 0 ? frontG : rearG).push(wheelGround[i]);
            (center[0] <= 0 ? leftG : rightG).push(wheelGround[i]);
          });
          const avg = (a: number[], fallback: number) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : fallback);
          const terrainPitch = Math.atan2(avg(rearG, avgGround) - avg(frontG, avgGround), wheelbase);
          const terrainRoll = Math.atan2(avg(leftG, avgGround) - avg(rightG, avgGround), 1.7);
          const targetPitch = clamp(terrainPitch + -accelSig * veh.bodyPitch * 0.04 * (1 + weightTransfer * 0.7), -0.18, 0.18);
          // Lean into the turn, plus an extra drift lean while the tires slip (reads as a slide).
          const turnLean = (-yawRate * Math.abs(speed) - lateralSpeed * 0.12) * veh.bodyRoll * (1 + slip * 1.5 + weightTransfer * 0.35);
          const targetRoll = clamp(terrainRoll + turnLean, -0.3, 0.3);
          const pitchNow = object.transform.rotation[0] + (targetPitch - object.transform.rotation[0]) * settle;
          const rollNow = object.transform.rotation[2] + (targetRoll - object.transform.rotation[2]) * settle;
          vehicleBody.set(object.id, { position, rotation: [pitchNow, newYaw, rollNow], scale: damageScale });

          // Wheels: spin around local X (∝ distance travelled), the front pair shows the smoothed steer angle
          // around local Y, and each wheel bobs toward its own ground contact (visible per-wheel suspension).
          wheels.forEach((w, i) => {
            const base = w.transform.rotation;
            const spin = (base[0] + (speed / Math.max(0.05, veh.wheelRadius)) * delta) % TWO_PI;
            const anchor = wheelAnchor(w);
            // Per-wheel suspension: target compression from this wheel's own ground contact, SMOOTHED toward
            // the previous wheel Y so it glides over terrain noise instead of jittering (the straight-line wobble).
            const comp = Math.max(-veh.suspensionTravel, Math.min(veh.suspensionTravel, wheelGround[i] - avgGround));
            const center = wheelCenter(w);
            const wheelY = center[1] + (veh.wheelRestY + comp - center[1]) * settle;
            if (anchor) {
              const steerY = veh.steeredWheelIds.includes(anchor.id) ? visualSteer : anchor.transform.rotation[1];
              vehicleSteer.set(anchor.id, { position: [center[0], wheelY, center[2]], rotation: [anchor.transform.rotation[0], steerY, anchor.transform.rotation[2]] });
              vehicleWheel.set(w.id, { position: w.transform.position, rotation: [spin, 0, base[2]] });
            } else {
              const steerY = veh.steeredWheelIds.includes(w.id) ? visualSteer : base[1];
              vehicleWheel.set(w.id, { position: [w.transform.position[0], wheelY, w.transform.position[2]], rotation: [spin, steerY, base[2]] });
            }
          });
        }
        const tireMarksOn = Math.abs(speed) > 2 && (handbrake || slip > 0.06 || (Math.abs(steerRaw) > 0.2 && Math.abs(speed) > 4));
        for (const id of veh.tireMarkIds) sendParticleCommand(id, { type: 'emit', on: tireMarksOn });
        // Brake lights glow while braking / reversing / handbraking.
        for (const lid of veh.brakeLightIds) vehicleBrake.set(lid, braking || handbrake ? 4 : 0.15);

        // --- Audio ---
        // Engine + skid are continuous LOOPS handled imperatively by useRuntimeAudio; here we just publish the
        // driven car's live state (engine playback rate ∝ rpm, skid volume ∝ slip). Other one-shots fire below.
        if (object.id === vehiclePlayerId) {
          nextVehicleSound = {
            engineId: veh.engineSoundId,
            skidId: veh.skidSoundId,
            rpm: Math.min(1, Math.abs(speed) / Math.max(0.001, veh.maxSpeed)),
            slip,
          };
        }
        // Brake squeal: a one-shot when the car scrubs off real speed (hard brake or handbrake at speed).
        if (veh.brakeSoundId && Math.abs(prevSpeed) > 6 && (braking || handbrake) && accelSig < -8) {
          const key = `${object.id}:brakeSfx`;
          if ((nextCooldowns[key] ?? 0) <= 0) {
            pushSound(veh.brakeSoundId, [...object.transform.position] as Vector3Tuple);
            nextCooldowns[key] = 0.9;
          }
        }
        // Horn: one-shot on the horn key (debounced), independent of the drive flow.
        if (veh.hornSoundId && drivingActive && currentKeys[veh.keyHorn]) {
          const key = `${object.id}:hornSfx`;
          if ((nextCooldowns[key] ?? 0) <= 0) {
            pushSound(veh.hornSoundId, [...object.transform.position] as Vector3Tuple);
            nextCooldowns[key] = 0.5;
          }
        }
        // Collision thud: a one-shot when this car contacts something while moving (it knocks cones/barriers).
        if (veh.collisionSoundId && Math.abs(speed) > 3) {
          const hit = contactTouches(priorCollisionIndex, object.id);
          if (hit) {
            const key = `${object.id}:hitSfx`;
            if ((nextCooldowns[key] ?? 0) <= 0) {
              pushSound(veh.collisionSoundId, [...object.transform.position] as Vector3Tuple);
              nextCooldowns[key] = 0.35;
            }
          }
        }
      }

      // Vehicle possession flips (Enter/Exit Vehicle) — applied this transition frame only. Building the
      // lookup maps here (after the vehicle pass) lets Exit place the pawn at the car's freshest position.
      const enterPawns = new Set<string>(vehicleEnter.map((r) => r.player));
      const enterCars = new Set<string>(vehicleEnter.map((r) => r.vehicle));
      const exitCars = new Set<string>(vehicleExit.map((r) => r.vehicle));
      const exitPawnPos = new Map<string, Vector3Tuple>();
      for (const r of vehicleExit) {
        const car = mappedObjectById.get(r.vehicle);
        const carPos = vehicleBody.get(r.vehicle)?.position ?? car?.transform.position ?? [0, 0, 0];
        const carYaw = (vehicleBody.get(r.vehicle)?.rotation ?? car?.transform.rotation ?? [0, 0, 0])[1];
        const right: Vector3Tuple = [Math.cos(carYaw), 0, -Math.sin(carYaw)];
        const fwd: Vector3Tuple = [Math.sin(carYaw), 0, Math.cos(carYaw)];
        exitPawnPos.set(r.player, [
          carPos[0] + right[0] * r.offset[0] + fwd[0] * r.offset[2],
          carPos[1] + r.offset[1],
          carPos[2] + right[2] * r.offset[0] + fwd[2] * r.offset[2],
        ]);
      }

      const movedObjects = mappedObjects.map((object) => {
        // A deactivated object skips the character/vehicle movement passes entirely.
        if (nextDisabled.has(object.id)) return object;
        // Vehicle possession: on the enter/exit edge, flip the pawn + car component flags so the follow
        // camera + HUD + vehicle pass switch control (these all key off character/vehicle enabled+cameraFollow).
        if (enterPawns.has(object.id)) {
          return {
            ...object,
            character: object.character ? { ...object.character, enabled: false, cameraFollow: false } : object.character,
            script: object.script ? { ...object.script, enabled: false } : object.script,
          };
        }
        const exitPos = exitPawnPos.get(object.id);
        if (exitPos) {
          return {
            ...object,
            transform: { ...object.transform, position: exitPos },
            character: object.character ? { ...object.character, enabled: true, cameraFollow: true } : object.character,
            script: object.script ? { ...object.script, enabled: true } : object.script,
          };
        }
        if ((enterCars.has(object.id) || exitCars.has(object.id)) && object.vehicle) {
          const vb2 = vehicleBody.get(object.id);
          const base = vb2 ? { ...object, transform: { ...object.transform, position: vb2.position, rotation: vb2.rotation, ...(vb2.scale ? { scale: vb2.scale } : {}) } } : object;
          return { ...base, vehicle: { ...base.vehicle!, enabled: true, cameraFollow: enterCars.has(object.id) } };
        }
        // Vehicle body / wheel / brake-light updates computed in the vehicle pass above.
        const vb = vehicleBody.get(object.id);
        if (vb) return { ...object, transform: { ...object.transform, position: vb.position, rotation: vb.rotation, ...(vb.scale ? { scale: vb.scale } : {}) } };
        const vs = vehicleSteer.get(object.id);
        if (vs) return { ...object, transform: { ...object.transform, position: vs.position, rotation: vs.rotation } };
        const vw = vehicleWheel.get(object.id);
        if (vw) return { ...object, transform: { ...object.transform, position: vw.position, rotation: vw.rotation } };
        const vbrake = vehicleBrake.get(object.id);
        if (vbrake !== undefined && object.renderer) {
          // Only mint a new renderer when the glow VALUE changes (press/release edges) — re-cloning every
          // frame while braking gave the light a fresh identity 60×/s and re-rendered its subtree.
          if (object.renderer.materialOverrides?.emissiveIntensity === vbrake) return object;
          return {
            ...object,
            renderer: {
              ...object.renderer,
              materialOverrides: {
                ...object.renderer.materialOverrides,
                emissiveColor: object.renderer.materialOverrides?.emissiveColor ?? '#ff2a2a',
                emissiveIntensity: vbrake,
              },
            },
          };
        }
        const physicsPatch = nextPhysics[object.id];
        if (physicsPatch) {
          return { ...object, physics: withPhysicsDefaults({ ...defaultPhysics(), ...object.physics, ...physicsPatch }) };
        }
        // Particle bursts (impacts): count down their life; despawn when spent. The countdown lives in a
        // MODULE map, not the object — ImpactParticles self-animates from its own clock, so re-minting the
        // object every frame only served the despawn check while invalidating the whole objects array's
        // identity 60×/s for as long as ANY puff/spark was alive (a re-render storm while drifting/crashing).
        if (object.effect) {
          const left = (effectLife.get(object.id) ?? object.effect.life) - delta;
          if (left <= 0) {
            effectLife.delete(object.id);
            destroyedIds.add(object.id);
          } else {
            effectLife.set(object.id, left);
          }
          return object;
        }
        // Projectiles: fly straight along their stored velocity and count down their life.
        if (object.projectile) {
          const v = object.projectile.velocity;
          const p = object.transform.position;
          return {
            ...object,
            transform: { ...object.transform, position: [p[0] + v[0] * delta, p[1] + v[1] * delta, p[2] + v[2] * delta] as Vector3Tuple },
            projectile: { ...object.projectile, life: object.projectile.life - delta },
          };
        }
        // Enemy AI (Unreal-style behavior, no scripting): an object tagged with an `enemy` instance variable
        // chases the local player when within `chaseRange` and otherwise drifts back toward its spawn. Contact
        // damage is applied in the post-physics combat pass. Tunables: enemySpeed, chaseRange (instance vars).
        if (object.variables?.enemy && !object.character?.enabled) {
          const player = playerId ? activeObjectById.get(playerId) : undefined;
          if (!player) return object;
          const p = [...object.transform.position] as Vector3Tuple;
          const r = [...object.transform.rotation] as Vector3Tuple;
          const speed = toNumber(object.variables.enemySpeed ?? 2.6);
          const chaseRange = toNumber(object.variables.chaseRange ?? 9);
          const tp = player.transform.position;
          const dx = tp[0] - p[0];
          const dz = tp[2] - p[2];
          const dist = Math.hypot(dx, dz);
          if (dist < chaseRange && dist > 1.1) {
            p[0] += (dx / dist) * speed * delta;
            p[2] += (dz / dist) * speed * delta;
            r[1] = Math.atan2(dx, dz); // face the player
          }
          return { ...object, transform: { ...object.transform, position: p, rotation: r } };
        }
        if (!object.character?.enabled) return object;
        // Ragdolling: physics owns the bones; the controller must not drive motion (it goes limp).
        // Track the limp body's pelvis so the follow camera stays on it instead of a frozen point.
        if (isRagdoll(object.id)) {
          const rootPos = getRagdollRoot(object.id);
          return rootPos ? { ...object, transform: { ...object.transform, position: rootPos } } : object;
        }
        // Backfill defaults so characters created before newer fields existed still work.
        const cc = resolveCharacter(object.character);
        // Scripted: a blueprint (Move/Jump nodes) drives horizontal motion + jump — Unreal Event-Graph
        // style. Auto (no blueprint): the built-in WASD/Space drives it. Vertical physics runs either way.
        const scripted = Boolean(object.script?.enabled);
        const position = [...object.transform.position] as Vector3Tuple;
        const rotation = [...object.transform.rotation] as Vector3Tuple;
        // The walkable floor under this character: the flat groundLevel OR the terrain surface beneath it,
        // whichever is higher — so a character stands on procedural terrain hills, not just the y=0 plane.
        // (Only raise the floor where terrain actually exists; otherwise behavior is unchanged.)
        const terrainFloor = sampleTerrainHeight(position[0], position[2]);
        // Over terrain the terrain surface is the floor (it may be below y=0); only fall back to the flat
        // groundLevel where there's no terrain — never max() the two, or a sub-zero hill floats the pawn at 0.
        const floorLevel = terrainFloor !== undefined ? terrainFloor : cc.groundLevel;
        const grounded = runtimeGroundedSet.has(object.id) || position[1] <= floorLevel + 0.001;
        const overrideMode = movementModeNow[object.id];
        const swimming = overrideMode === 'swimming' || (!overrideMode && runtimeSwimmingSet.has(object.id));
        const climbing = overrideMode === 'climbing' || (!overrideMode && runtimeClimbingSet.has(object.id));
        const flying = overrideMode === 'flying';

        const activeMantle = state.runtimeMantle[object.id];
        if (activeMantle) {
          const duration = Math.max(0.08, activeMantle.duration);
          const time = activeMantle.time + delta;
          const t = Math.min(1, time / duration);
          const eased = t * t * (3 - 2 * t);
          const arc = Math.sin(Math.PI * t) * 0.28;
          position[0] = activeMantle.from[0] + (activeMantle.to[0] - activeMantle.from[0]) * eased;
          position[1] = activeMantle.from[1] + (activeMantle.to[1] - activeMantle.from[1]) * eased + arc;
          position[2] = activeMantle.from[2] + (activeMantle.to[2] - activeMantle.from[2]) * eased;
          const dx = activeMantle.to[0] - activeMantle.from[0];
          const dz = activeMantle.to[2] - activeMantle.from[2];
          if (Math.hypot(dx, dz) > 0.001) rotation[1] = lerpAngle(rotation[1], Math.atan2(dx, dz) + cc.modelYawOffset, 1 - Math.exp(-18 * Math.min(delta, 0.1)));
          if (t < 1) nextMantle[object.id] = { ...activeMantle, time };
          nextVelocities[object.id] = [0, 0, 0];
          return { ...object, transform: { ...object.transform, position, rotation } };
        }

        // Roll/dodge: started on the roll key while grounded, dashes for rollDuration. DIRECTIONAL — the
        // dash goes toward the held input (camera-relative), so you can dodge sideways/backwards (vital
        // while locked on); no input falls back to the facing direction (the classic forward roll).
        let rollRemaining = state.runtimeRoll[object.id] ?? 0;
        if (rollRemaining <= 0 && grounded && currentKeys[cc.keyRoll]) {
          rollRemaining = cc.rollDuration;
          let inX = (currentKeys[cc.keyLeft] ? 1 : 0) - (currentKeys[cc.keyRight] ? 1 : 0) - gamepadInput.moveX;
          let inZ = (currentKeys[cc.keyForward] ? 1 : 0) - (currentKeys[cc.keyBackward] ? 1 : 0) + gamepadInput.moveY;
          const inLen = Math.hypot(inX, inZ);
          if (inLen > 0.25) {
            inX /= inLen;
            inZ /= inLen;
            if (cc.cameraRelativeMovement && cc.mouseLook) {
              const yaw = mouseCameraYaw(cc.mouseSensitivity);
              const cos = Math.cos(yaw);
              const sin = Math.sin(yaw);
              [inX, inZ] = [inX * cos + inZ * sin, -inX * sin + inZ * cos];
            }
            nextRollDir[object.id] = [inX, inZ];
          } else {
            const facing = rotation[1] - cc.modelYawOffset;
            nextRollDir[object.id] = [Math.sin(facing), Math.cos(facing)];
          }
        } else if (rollRemaining > 0 && state.runtimeRollDir[object.id]) {
          nextRollDir[object.id] = state.runtimeRollDir[object.id];
        }
        const rolling = rollRemaining > 0;

        // Lock-on (Z-targeting): the lock key toggles a lock onto the nearest living target — an object
        // with a `health` instance variable > 0 or an `enemy` tag — within lockOnRange. The lock persists
        // until the target dies, despawns, or moves past lockOnBreakDistance; while held, the facing pass
        // below strafes the character toward it and FollowCamera steers to keep both in frame.
        let lockOnTargetId: string | undefined = state.runtimeLockOn[object.id];
        const lockOnCandidate = (id: string): { pos: Vector3Tuple; dist: number } | undefined => {
          if (id === object.id || destroyedIds.has(id) || nextDisabled.has(id)) return undefined;
          const candidate = mappedObjectById.get(id);
          if (!candidate || state.runtimeHidden.includes(id)) return undefined;
          // Direct lookups instead of merging the two variable bags — this runs per candidate in the
          // O(N) lock-on scan and per frame while a lock is held.
          const bag = nextObjectVariables[id];
          const health = bag && 'health' in bag ? bag.health : candidate.variables?.health;
          const enemy = bag && 'enemy' in bag ? bag.enemy : candidate.variables?.enemy;
          if (health !== undefined && toNumber(health) <= 0) return undefined;
          if (health === undefined && !enemy) return undefined;
          const cp = candidate.transform.position;
          return { pos: cp, dist: Math.hypot(cp[0] - position[0], cp[2] - position[2]) };
        };
        if (cc.lockOnEnabled && keyPressedThisTick(cc.keyLockOn ?? 'KeyT')) {
          if (lockOnTargetId) {
            lockOnTargetId = undefined; // second press releases the lock
          } else {
            let bestDist = cc.lockOnRange ?? 16;
            for (const other of mappedObjects) {
              const found = lockOnCandidate(other.id);
              if (found && found.dist <= bestDist) {
                lockOnTargetId = other.id;
                bestDist = found.dist;
              }
            }
          }
        }
        let lockOnPos: Vector3Tuple | undefined;
        if (lockOnTargetId) {
          const held = lockOnCandidate(lockOnTargetId);
          if (held && held.dist <= (cc.lockOnBreakDistance ?? 22)) {
            lockOnPos = held.pos;
            nextLockOn[object.id] = lockOnTargetId;
          }
        }

        // Persistent horizontal velocity (carried across frames so movement accelerates/decelerates instead of
        // snapping on/off — the fix for "stiff" feel). Only the auto-WASD path ramps it; scripted/rolling motion
        // is driven directly, so they start from a clean stop.
        const storedVel = nextVelocities[object.id];
        let hVelX = !scripted && !rolling ? storedVel?.[0] ?? 0 : 0;
        let hVelZ = !scripted && !rolling ? storedVel?.[2] ?? 0 : 0;

        // Landing recovery: the post-physics pass seeds this timer on a hard touchdown; it decays here and
        // saps the movement target speed below (and dips the follow camera) while it lasts.
        const landingRemaining = Math.max(0, (state.runtimeLanding[object.id] ?? 0) - delta);
        if (landingRemaining > 0) nextLanding[object.id] = landingRemaining;
        const landPenalty = Math.min(1, landingRemaining / 0.3) * (cc.landingRecovery ?? 0.4);

        // Sprint-slide: tapping crouch at sprint speed drops into a momentum slide — a small speed surge that
        // decays toward crouch speed, gently steerable with A/D, cancelled by a jump (slide-hop) or going
        // airborne. Drives the "sliding" animator source. The normal input pass is bypassed while sliding.
        let slideState: EditorState['runtimeSlide'][string] | undefined = state.runtimeSlide[object.id];
        if (
          (cc.slideEnabled ?? true) &&
          !scripted &&
          !rolling &&
          !slideState &&
          grounded &&
          !swimming &&
          !climbing &&
          !flying &&
          keyPressedThisTick(cc.keyCrouch) &&
          currentKeys[cc.keySprint]
        ) {
          const entrySpeed = Math.hypot(hVelX, hVelZ);
          if (entrySpeed > cc.moveSpeed * 1.05) {
            slideState = {
              remaining: cc.slideDuration ?? 0.9,
              dirX: hVelX / entrySpeed,
              dirZ: hVelZ / entrySpeed,
              speed: entrySpeed * (cc.slideSpeedBoost ?? 1.2),
            };
          }
        }
        // End conditions: airborne, jump-cancel (the buffered jump then fires from the slide momentum),
        // timer out, or decayed down to crouch pace.
        if (slideState && (!grounded || (!scripted && keyPressedThisTick(cc.keyJump)))) slideState = undefined;
        const sliding = Boolean(
          slideState && slideState.remaining > 0 && slideState.speed > cc.moveSpeed * (cc.crouchMultiplier + 0.1),
        );
        if (slideState && sliding && !scripted && !rolling) {
          const steer =
            ((currentKeys[cc.keyLeft] ? 1 : 0) - (currentKeys[cc.keyRight] ? 1 : 0) - gamepadInput.moveX) * 1.15 * delta;
          if (Math.abs(steer) > 1e-5) {
            const cos = Math.cos(steer);
            const sin = Math.sin(steer);
            const dx = slideState.dirX * cos + slideState.dirZ * sin;
            const dz = -slideState.dirX * sin + slideState.dirZ * cos;
            slideState = { ...slideState, dirX: dx, dirZ: dz };
          }
          const speed = Math.max(0, slideState.speed - 5.5 * delta);
          slideState = { ...slideState, speed, remaining: slideState.remaining - delta };
          hVelX = slideState.dirX * speed;
          hVelZ = slideState.dirZ * speed;
          position[0] += hVelX * delta;
          position[2] += hVelZ * delta;
          // The body leans into the slide direction (unless locked on — locked slides keep facing the target).
          if (!lockOnPos) {
            rotation[1] = lerpAngle(
              rotation[1],
              Math.atan2(slideState.dirX, slideState.dirZ) + cc.modelYawOffset,
              1 - Math.exp(-10 * Math.min(delta, 0.1)),
            );
          }
          if (slideState.remaining > 0) nextSlide[object.id] = slideState;
        }

        if (!scripted && !rolling && !sliding) {
          // Forward = +Z (model forward); right = -X. Camera sits behind, so this reads correctly on screen.
          let inputX = 0;
          let inputZ = 0;
          if (currentKeys[cc.keyForward]) inputZ += 1;
          if (currentKeys[cc.keyBackward]) inputZ -= 1;
          if (currentKeys[cc.keyLeft]) inputX += 1;
          if (currentKeys[cc.keyRight]) inputX -= 1;
          // Gamepad left stick (analog): stick right = -X here (left is +1), stick up = forward.
          inputX -= gamepadInput.moveX;
          inputZ += gamepadInput.moveY;
          const length = Math.hypot(inputX, inputZ);
          const sprinting = Boolean(currentKeys[cc.keySprint]);
          const crouching = Boolean(currentKeys[cc.keyCrouch]);
          const crawling = Boolean(cc.keyCrawl && currentKeys[cc.keyCrawl]);
          const speed =
            cc.moveSpeed *
            (crawling ? cc.crawlMultiplier ?? 0.4 : crouching ? cc.crouchMultiplier : sprinting ? cc.sprintMultiplier : 1) *
            (1 - 0.6 * landPenalty); // hard landings briefly sap the target speed (landing recovery)
          // Target velocity from the (camera-relative) input direction; 0 when no key is held (→ decelerate to stop).
          let targetX = 0;
          let targetZ = 0;
          let moveDirX = Math.sin(rotation[1] - cc.modelYawOffset);
          let moveDirZ = Math.cos(rotation[1] - cc.modelYawOffset);
          if (length > 0) {
            let dirX = inputX / length;
            let dirZ = inputZ / length;
            // Camera-relative: rotate the input by the mouse-look camera yaw so "forward" follows the view.
            if (cc.cameraRelativeMovement && cc.mouseLook) {
              const yaw = mouseCameraYaw(cc.mouseSensitivity);
              const cos = Math.cos(yaw);
              const sin = Math.sin(yaw);
              [dirX, dirZ] = [dirX * cos + dirZ * sin, -dirX * sin + dirZ * cos];
            }
            moveDirX = dirX;
            moveDirZ = dirZ;
            // Analog walk: a half-tilted stick moves slower (keys always give length ≥ 1 → full speed).
            const analog = Math.min(1, length);
            targetX = dirX * speed * analog;
            targetZ = dirZ * speed * analog;
          }
          const mantleKey = cc.keyMantle || cc.keyJump;
          const wantsMantle =
            Boolean(cc.mantleEnabled) &&
            grounded &&
            !swimming &&
            !climbing &&
            !flying &&
            (keyPressedThisTick(cc.keyJump) || Boolean(mantleKey && keyPressedThisTick(mantleKey)));
          if (wantsMantle) {
            const mantleTarget = findMantleTarget(object.id, position, moveDirX, moveDirZ, cc, floorLevel);
            if (mantleTarget) {
              const duration = Math.max(0.08, cc.mantleDuration ?? 0.38);
              nextMantle[object.id] = { from: [...position] as Vector3Tuple, to: mantleTarget, time: 0, duration };
              nextVelocities[object.id] = [0, 0, 0];
              rotation[1] = lerpAngle(
                rotation[1],
                Math.atan2(mantleTarget[0] - position[0], mantleTarget[2] - position[2]) + cc.modelYawOffset,
                1,
              );
              return { ...object, transform: { ...object.transform, position, rotation } };
            }
          }
          // Ramp velocity toward the target: accelerate when there's input, decelerate when not. Airborne motion
          // is dampened (airControl) so you mostly keep your jump momentum instead of turning on a dime mid-air.
          const rate = (length > 0 ? cc.acceleration ?? 60 : cc.deceleration ?? 70) * (grounded ? 1 : cc.airControl ?? 0.35);
          const maxStep = rate * delta;
          hVelX = approach(hVelX, targetX, maxStep);
          hVelZ = approach(hVelZ, targetZ, maxStep);
          position[0] += hVelX * delta;
          position[2] += hVelZ * delta;
          // Face the actual velocity (not raw input) so turning eases in/out with the slide. Strafe faces the camera.
          const moveLen = Math.hypot(hVelX, hVelZ);
          if (lockOnPos) {
            // Locked on: always face the target (strafe-style locomotion), so circling reads as orbiting it.
            rotation[1] = lerpAngle(
              rotation[1],
              Math.atan2(lockOnPos[0] - position[0], lockOnPos[2] - position[2]) + cc.modelYawOffset,
              1 - Math.exp(-cc.turnSpeed * Math.min(delta, 0.1)),
            );
          } else if (!(cc.strafe && cc.mouseLook) && moveLen > 0.05) {
            // Framerate-independent easing (was turnSpeed*delta, which turns faster at low FPS and can
            // overshoot >1 on a hitch); exp gives the same ~0.18 feel at 60fps but a smooth turn at any rate.
            // Turn rate eases down with speed (full rate at a walk → sprintTurnFactor at sprint) so fast
            // runs carve weighty arcs instead of pivoting on a dime.
            const turnScale =
              1 +
              ((cc.sprintTurnFactor ?? 0.55) - 1) *
                Math.min(1, moveLen / Math.max(0.001, cc.moveSpeed * cc.sprintMultiplier));
            rotation[1] = lerpAngle(rotation[1], Math.atan2(hVelX, hVelZ) + cc.modelYawOffset, 1 - Math.exp(-cc.turnSpeed * turnScale * Math.min(delta, 0.1)));
          } else if (
            Boolean(cc.turnInPlace) &&
            grounded &&
            !swimming &&
            !climbing &&
            !flying &&
            cc.mouseLook &&
            cc.cameraRelativeMovement
          ) {
            const targetYaw = mouseCameraYaw(cc.mouseSensitivity) + cc.modelYawOffset;
            const diff = Math.abs(angleDelta(rotation[1], targetYaw));
            if (diff > (cc.turnInPlaceThreshold ?? 0.45)) {
              rotation[1] = lerpAngle(rotation[1], targetYaw, 1 - Math.exp(-(cc.turnInPlaceSpeed ?? cc.turnSpeed) * Math.min(delta, 0.1)));
              nextTurnInPlace[object.id] = Math.min(1, diff / Math.PI);
            }
          }
          // Strafe: always face the camera yaw so the character can move in all 8 directions (2D blend).
          if (cc.strafe && cc.mouseLook && !lockOnPos) {
            rotation[1] = mouseCameraYaw(cc.mouseSensitivity) + cc.modelYawOffset;
          }
        }

        if (cc.cameraMode === 'firstPerson' && cc.mouseLook) {
          rotation[1] = mouseCameraYaw(cc.mouseSensitivity) + cc.modelYawOffset;
        }

        // Roll dash: travel along the dodge direction captured at roll start (input direction, else facing).
        // Free dodges turn the body into the dash; locked-on dodges keep facing the target (souls-style).
        if (rolling) {
          const facing = rotation[1] - cc.modelYawOffset;
          const dir = nextRollDir[object.id] ?? [Math.sin(facing), Math.cos(facing)];
          position[0] += dir[0] * cc.rollSpeed * delta;
          position[2] += dir[1] * cc.rollSpeed * delta;
          if (!lockOnPos) {
            rotation[1] = lerpAngle(rotation[1], Math.atan2(dir[0], dir[1]) + cc.modelYawOffset, 1 - Math.exp(-14 * Math.min(delta, 0.1)));
          }
          rollRemaining = Math.max(0, rollRemaining - delta);
        }
        if (rollRemaining > 0) nextRoll[object.id] = rollRemaining;

        // Attack: a short pulse on the attack key that the animator turns into a punch / weapon swing.
        let attackRemaining = state.runtimeAttack[object.id] ?? 0;
        if (attackRemaining <= 0 && currentKeys[cc.keyAttack]) {
          attackRemaining = 0.18;
          if (cc.attackSoundId) pushSound(cc.attackSoundId, [...object.transform.position] as Vector3Tuple); // swing/whoosh on the swing's first frame
          meleeSwings.add(object.id); // melee hit-test this frame (skipped later if a ranged weapon is out)
        } else if (attackRemaining > 0) attackRemaining = Math.max(0, attackRemaining - delta);
        if (attackRemaining > 0) nextAttack[object.id] = attackRemaining;

        // Reload: a longer pulse on the reload key (ranged weapon) → the "reloading" param. On start it
        // refills `ammo` to `ammoMax` (if the character owns those instance variables).
        let reloadRemaining = state.runtimeReload[object.id] ?? 0;
        if (reloadRemaining <= 0 && currentKeys[cc.keyReload]) {
          reloadRemaining = 1.2;
          const ammoMax = nextObjectVariables[object.id]?.ammoMax ?? object.variables?.ammoMax;
          if (ammoMax !== undefined) mutableObjectVars(object.id, object.variables).ammo = toNumber(ammoMax);
        } else if (reloadRemaining > 0) reloadRemaining = Math.max(0, reloadRemaining - delta);
        if (reloadRemaining > 0) nextReload[object.id] = reloadRemaining;

        // Interact: a short pulse on the interact key → the "interacting" param (use / pick up).
        let interactRemaining = state.runtimeInteract[object.id] ?? 0;
        if (interactRemaining <= 0 && currentKeys[cc.keyInteract]) interactRemaining = 0.9;
        else if (interactRemaining > 0) interactRemaining = Math.max(0, interactRemaining - delta);
        if (interactRemaining > 0) nextInteract[object.id] = interactRemaining;

        // Movement mode: a "Set Movement Mode" node OVERRIDES the volume-tag swim/climb detection (so swim/
        // climb can be fully blueprint-driven). Falls back to the volume sets when no override is set.
        if (climbing) {
          // Lock horizontal to the wall (undo this frame's script/auto XZ move) and climb up/down with fwd/back keys.
          const start = prevTransforms.get(object.id)?.position;
          if (start) {
            position[0] = start[0];
            position[2] = start[2];
          }
          const climbDir = (currentKeys[cc.keyForward] ? 1 : 0) - (currentKeys[cc.keyBackward] ? 1 : 0);
          position[1] += climbDir * cc.moveSpeed * 0.6 * delta;
          nextVelocities[object.id] = [0, 0, 0];
        } else if (swimming || flying) {
          // No gravity. Swim = buoyant (settles toward neutral); fly = stays put. Both: jump=up, crouch=down,
          // horizontal moves freely (the horizontal step is applied above by the move pass).
          let vy = nextVelocities[object.id]?.[1] ?? 0;
          if (currentKeys[cc.keyJump]) vy = cc.moveSpeed * 0.7;
          else if (currentKeys[cc.keyCrouch]) vy = -cc.moveSpeed * 0.7;
          else vy *= swimming ? 0.85 : 0; // swim drifts toward neutral buoyancy; fly holds altitude
          position[1] += vy * delta;
          nextVelocities[object.id] = [hVelX, vy, hVelZ];
        } else {
          // Vertical motion: gravity + jump. Grounded comes from the physics character controller
          // (last frame) so the character can stand on real colliders, not just the ground plane.
          let verticalVelocity = nextVelocities[object.id]?.[1] ?? 0;
          // Jump buffering: a press while still airborne is remembered for jumpBufferTime and fires on
          // touchdown — the twin of coyote time below. Together they make jumping feel reliable.
          let jumpBuffer = Math.max(0, (state.runtimeJumpBuffer[object.id] ?? 0) - delta);
          if (!scripted && keyPressedThisTick(cc.keyJump)) jumpBuffer = cc.jumpBufferTime ?? 0.15;
          const wantsJump = scripted ? characterJumpRequests.has(object.id) : Boolean(currentKeys[cc.keyJump]) || jumpBuffer > 0;
          if (grounded && verticalVelocity < 0) verticalVelocity = 0;
          // Coyote time: top up the grace window while grounded; otherwise count it down. Lets a jump pressed a
          // few frames after running off a ledge still fire — a big responsiveness win.
          let coyote = grounded ? cc.coyoteTime ?? 0.12 : Math.max(0, (state.runtimeCoyote[object.id] ?? 0) - delta);
          // Jump only when on (or just-off) the ground AND not already rising (prevents a grounded re-jump / double jump).
          if (wantsJump && (grounded || coyote > 0) && verticalVelocity <= 0.0001) {
            verticalVelocity = cc.jumpStrength;
            coyote = 0; // consume the grace so one press = one jump
            jumpBuffer = 0; // consume the buffered press too
            if (cc.jumpSoundId) pushSound(cc.jumpSoundId, [...object.transform.position] as Vector3Tuple);
          }
          if (jumpBuffer > 0) nextJumpBuffer[object.id] = jumpBuffer;
          // Launch (jump pad / blast): a one-shot velocity from action.applyForce. Works mid-air and overrides a
          // fall, so the pad always pops you up; horizontal displaces the capsule (collide-and-slide via physics).
          const launch = characterLaunch[object.id];
          if (launch) {
            if (launch[1] > 0) verticalVelocity = Math.max(verticalVelocity, launch[1]);
            position[0] += launch[0] * delta;
            position[2] += launch[2] * delta;
          }
          // Variable jump height: releasing the jump key while still rising cuts the climb short (tap = hop,
          // hold = full jump). Auto mode only — scripted jumps don't read the raw key.
          if (!scripted && verticalVelocity > 0 && !currentKeys[cc.keyJump] && previousKeys[cc.keyJump]) {
            verticalVelocity *= cc.jumpCutMultiplier ?? 0.45;
          }
          // Asymmetric gravity: fall faster than you rose so the arc feels snappy, not floaty. Near the
          // APEX (small |vy| while airborne) gravity eases off briefly — a hang that makes the jump feel
          // controllable at its peak without slowing the descent (fallMultiplier still rules the fall).
          const nearApex = !grounded && Math.abs(verticalVelocity) < 1.6;
          const g =
            cc.gravity *
            (nearApex ? cc.apexHang ?? 0.65 : verticalVelocity < 0 ? cc.fallMultiplier ?? 1.9 : 1);
          verticalVelocity -= g * delta;
          position[1] += verticalVelocity * delta;
          // Over TERRAIN, do NOT clamp the vertical here — let the Rapier kinematic controller resolve the
          // capsule against the (continuous) heightfield. Clamping to the analytic surface fights the physics
          // (camera jitter) and can bury the capsule below the collider (which then blocks horizontal movement).
          // Gravity above still produces a downward "desired" that physics stops at the surface. On flat-ground
          // scenes (no terrain) keep the simple groundLevel clamp.
          const overTerrain = sampleTerrainHeight(position[0], position[2]) !== undefined;
          if (!overTerrain && position[1] <= cc.groundLevel) {
            position[1] = cc.groundLevel;
            if (verticalVelocity < 0) verticalVelocity = 0;
          }
          nextVelocities[object.id] = [hVelX, verticalVelocity, hVelZ];
          if (coyote > 0) nextCoyote[object.id] = coyote;
        }

        // Footsteps: accumulate horizontal distance and play a footstep sound each stride while grounded.
        // Surface-aware: a footstep volume the character stands in overrides the default sound (grass/stone/etc.).
        const stepSound = state.runtimeSurfaceSound[object.id] || cc.footstepSoundId;
        if (stepSound) {
          const start = object.transform.position;
          const stepped = Math.hypot(position[0] - start[0], position[2] - start[2]);
          let acc = (nextFootstep[object.id] ?? 0) + stepped;
          const stride = 2.1; // world units between footstep sounds
          if (grounded && !sliding && acc >= stride) {
            pushSound(stepSound, [position[0], position[1], position[2]]);
            acc = 0;
          }
          nextFootstep[object.id] = grounded ? acc : 0; // reset mid-air so landing doesn't dump a step
        }

        return { ...object, transform: { ...object.transform, position, rotation } };
      });

      // Physics post-pass: step the Rapier world and let it own every physics body's
      // transform (object-to-object collisions, stacking, gravity). Non-physics objects
      // keep whatever their script produced. Contacts/triggers are reported one frame later
      // so graph events run from a stable, previous-step physics result.
      const physicsStart = performance.now();
      let collisions: PhysicsContactEvent[] = [];
      let triggers: PhysicsContactEvent[] = [];
      let triggersExit: PhysicsContactEvent[] = [];
      let collisionsExit: PhysicsContactEvent[] = [];
      let groundedIds: string[] = [];
      // Smoothed render transforms from the fixed-timestep physics step (interpolated between the two
      // most recent sim states). Applied to the render buffer AFTER publishTransforms so the mesh glides
      // while the store keeps the authoritative pose. Null when physics didn't run this frame.
      let physicsRenderTransforms: Map<string, BufferedTransform> | null = null;
      let resolvedObjects = movedObjects;
      // Fracture chunks carry a one-shot outward kick; apply it the frame their body first exists, then clear it.
      const kickedChunkIds = new Set<string>();
      for (const o of movedObjects) {
        const kick = o.variables?.__impulse;
        if (Array.isArray(kick) && kick.length === 3) {
          physicsImpulses[o.id] = [Number(kick[0]), Number(kick[1]), Number(kick[2])];
          kickedChunkIds.add(o.id);
        }
      }
      // Surface FX: bodies overlapping a water volume this frame (drives splash/ripple on first entry),
      // and the new ripple impacts to feed the water shader. Both also collected from the swim-entry block.
      const inWaterIds: string[] = [];
      const newWaterImpacts: { id: number; x: number; z: number }[] = [];
      const nextWaterWake: Record<string, number> = {};
      const waterVolumes = movedObjects
        .filter((object) => !nextDisabled.has(object.id))
        .map((object) => {
          const taggedWater = !object.water && object.variables?.volume === 'water';
          const water = object.water?.enabled ? { ...defaultWaterVolume(), ...object.water } : taggedWater ? defaultWaterVolume() : undefined;
          if (!water?.enabled) return null;
          const [x, y, z] = object.transform.position;
          const [sx, sy, sz] = object.transform.scale.map((value) => Math.max(0.001, Math.abs(value))) as Vector3Tuple;
          return {
            id: object.id,
            water,
            minX: x - sx * 0.5,
            maxX: x + sx * 0.5,
            minY: y - sy * 0.5,
            maxY: y + sy * 0.5,
            minZ: z - sz * 0.5,
            maxZ: z + sz * 0.5,
          };
        })
        .filter((volume): volume is NonNullable<typeof volume> => Boolean(volume));
      if (waterVolumes.length) {
        const runtimeInWaterSet = new Set(state.runtimeInWater);
        for (const object of movedObjects) {
          if (nextDisabled.has(object.id) || object.water?.enabled || object.projectile) continue;
          if (!object.physics?.enabled || object.physics.bodyType !== 'dynamic') continue;
          const [x, y, z] = object.transform.position;
          const radius = Math.max(0.05, Math.max(Math.abs(object.transform.scale[0]), Math.abs(object.transform.scale[1]), Math.abs(object.transform.scale[2])) * 0.5);
          for (const volume of waterVolumes) {
            if (object.id === volume.id) continue;
            if (x + radius < volume.minX || x - radius > volume.maxX || z + radius < volume.minZ || z - radius > volume.maxZ) continue;
            if (y + radius < volume.minY || y - radius > volume.maxY) continue;
            const water = volume.water;
            // Wave-accurate: sample the SAME surface the shader draws at the body + small offsets so the
            // body rides the visible crest and we can read the wave slope (for tilt + horizontal sway).
            const eps = Math.max(0.25, radius * 0.6);
            const wave = waterSurfaceHeight(water, x, z, runtimeTime);
            const waveX = waterSurfaceHeight(water, x + eps, z, runtimeTime);
            const waveZ = waterSurfaceHeight(water, x, z + eps, runtimeTime);
            const slopeX = (waveX - wave) / eps; // d(height)/dx
            const slopeZ = (waveZ - wave) / eps; // d(height)/dz
            const surfaceY = volume.maxY + wave;
            const bottomY = volume.minY;
            const bodyBottom = y - radius;
            const bodyTop = y + radius;
            if (bodyBottom > surfaceY || bodyTop < bottomY) continue;
            // First frame this body breaks the surface → splash crown + an expanding ripple on the water.
            inWaterIds.push(object.id);
            if (!runtimeInWaterSet.has(object.id)) {
              spawned.push(makeSplashObject([x, surfaceY, z]));
              // A hard, fast entry throws up a bigger, denser splash.
              const entrySpeed = -(state.runtimeVelocities[object.id]?.[1] ?? 0);
              if (entrySpeed > 4) spawned.push(makeSplashObject([x, surfaceY, z]));
              newWaterImpacts.push({ id: nextWaterImpactId(), x, z });
            }
            const submerged = Math.min(1, Math.max(0, (surfaceY - bodyBottom) / Math.max(radius * 2, 0.001)));
            const mass = Math.max(0.001, object.physics.mass ?? 1);
            const velocity = nextVelocities[object.id] ?? state.runtimeVelocities[object.id] ?? [0, 0, 0];
            const drag = Math.max(0, water.drag) * submerged;
            const waveLift = Math.max(0, wave) * water.waveSpeed * 2.4;
            let impulseY = mass * (9.81 * water.buoyancy * submerged + waveLift) * delta;
            const nearSurface = Math.abs(y - surfaceY) < radius * 0.9;
            if (nearSurface && velocity[1] < 0) impulseY += -velocity[1] * mass * water.surfaceBounce;
            const dragScale = Math.min(0.9, drag * delta);
            // Crests push bodies down their slope (toward troughs) — the sideways shove that bobs a raft.
            const slopeShoveX = -slopeX * water.waveAmplitude * water.waveSpeed * 6 * mass * delta * submerged;
            const slopeShoveZ = -slopeZ * water.waveAmplitude * water.waveSpeed * 6 * mass * delta * submerged;
            // Directional current pushes bodies along flowAngle.
            const flow = water.flowStrength ?? 0;
            let flowX = 0;
            let flowZ = 0;
            if (flow > 0) {
              const ang = ((water.flowAngle ?? 0) * Math.PI) / 180;
              flowX = Math.cos(ang) * flow * 4 * mass * delta * submerged;
              flowZ = Math.sin(ang) * flow * 4 * mass * delta * submerged;
            }
            const accrued = physicsImpulses[object.id] ?? [0, 0, 0];
            physicsImpulses[object.id] = [
              accrued[0] - velocity[0] * mass * dragScale + slopeShoveX + flowX,
              accrued[1] + impulseY - velocity[1] * mass * dragScale,
              accrued[2] - velocity[2] * mass * dragScale + slopeShoveZ + flowZ,
            ];
            // Tilt to lie along the wave surface: a gentle torque rolls the body toward the wave normal so
            // rafts/crates pitch and roll with the swell (Rapier's angular damping keeps it from tumbling).
            if (submerged > 0.05) {
              const tilt = water.waveAmplitude * 1.8 * submerged * mass * delta;
              const accruedTorque = physicsAngularImpulses[object.id] ?? [0, 0, 0];
              physicsAngularImpulses[object.id] = [
                accruedTorque[0] - slopeZ * tilt,
                accruedTorque[1],
                accruedTorque[2] + slopeX * tilt,
              ];
            }
            // Continuous wake: a body skimming the surface sheds a ripple ring behind it (throttled).
            const horizSpeed = Math.hypot(velocity[0], velocity[2]);
            if (nearSurface && horizSpeed > 1.6) {
              const lastWake = state.runtimeWaterWake?.[object.id] ?? -1;
              if (runtimeTime - lastWake > 0.16) {
                newWaterImpacts.push({ id: nextWaterImpactId(), x: x - velocity[0] * 0.12, z: z - velocity[2] * 0.12 });
                nextWaterWake[object.id] = runtimeTime;
              } else {
                nextWaterWake[object.id] = lastWake;
              }
            }
            break;
          }
        }
      }
      const physics = getActivePhysics();
      if (physics) {
        // Deactivated objects are excluded from the physics objects list, so syncBodies removes their
        // bodies (no collision) until re-enabled.
        const physicsObjects = movedObjects
          .filter(
            (o) =>
              !nextDisabled.has(o.id) &&
              (shouldSimulatePhysicsObject(o) ||
                physicsImpulses[o.id] !== undefined ||
                physicsAngularImpulses[o.id] !== undefined ||
                setVelocities[o.id] !== undefined),
          )
          // Reflect a runtime winch (Set Cable Length) into the physics rope's max distance: hand physics
          // the overridden cable length so its rope joint rebuilds at the reeled length this frame.
          .map((o) =>
            o.cable && nextCableLength[o.id] !== undefined && nextCableLength[o.id] !== o.cable.length
              ? { ...o, cable: { ...o.cable, length: nextCableLength[o.id] } }
              : o,
          );
        const sceneEnv = selectActiveSceneEnvironment(state);
        const sceneWind = sceneEnv?.wind ?? [0, 0, 0];
        const result = physics.frame(
          physicsObjects,
          prevTransforms,
          physicsImpulses,
          delta,
          setVelocities,
          physicsAngularImpulses,
          sceneWind,
          sceneEnv?.windTurbulence ?? 0,
          vehicleInputs,
        );
        if (result.renderTransforms.size) {
          // The buffer's BufferedTransform needs a scale; physics never changes scale, so reuse each
          // object's authored scale and only swap in the smoothed position/rotation.
          const renderMap = new Map<string, BufferedTransform>();
          for (const o of movedObjects) {
            const rt = result.renderTransforms.get(o.id);
            if (rt) renderMap.set(o.id, { position: rt.position, rotation: rt.rotation, scale: o.transform.scale });
          }
          physicsRenderTransforms = renderMap;
        }
        collisions = result.collisions;
        triggers = result.triggers;
        triggersExit = result.triggersExit;
        collisionsExit = result.collisionsExit;
        groundedIds = result.grounded;
        // Publish dynamic bodies' post-step velocity so Get Velocity (and vehicleSpeed) read the real value.
        for (const [id, v] of result.velocities) nextVelocities[id] = v;
        const groundedSet = new Set(groundedIds);
        resolvedObjects = movedObjects.map((object) => {
          // While ragdolling the limp body owns the transform (set from the pelvis above) — don't let
          // the kinematic character capsule overwrite it back to a standing pose.
          if (isRagdoll(object.id)) return object;
          // Physics bodies AND character controllers get their post-collision transform written back.
          if (!object.physics?.enabled && !object.character?.enabled) return object;
          const next = result.transforms.get(object.id);
          if (!next) return object;
          let position = next.position;
          // Terrain floor guard: the Rapier kinematic character controller doesn't always catch the streamed
          // terrain heightfield, which would let a pawn sink through a hill and fall forever. Where terrain
          // exists under the character, clamp its Y to the terrain surface (or the flat groundLevel, whichever
          // is higher) and report it grounded so the animator leaves its falling/airborne state. Scenes with no
          // terrain are untouched (the physics result stands).
          if (object.character?.enabled) {
            // Let Rapier's heightfield resolution stand for the character's Y (it's continuous, so walking is
            // smooth). Only RECOVER from a genuine fall-through (sank well below the surface because the physics
            // chunk wasn't streamed yet) — never nudge Y during normal walking, which would fight the physics
            // (jitter) or bury the capsule (blocks movement). Also report "grounded" when resting on the surface.
            const floor = sampleTerrainHeight(position[0], position[2]);
            if (floor !== undefined) {
              if (position[1] < floor - 1) {
                position = [position[0], floor, position[2]];
                groundedSet.add(object.id);
              } else if (position[1] <= floor + 0.15) {
                groundedSet.add(object.id);
              }
            }
          }
          if (object.vehicle?.enabled) {
            const vars = nextObjectVariables[object.id] ?? object.variables;
            const crashTimer = Math.max(0, toNumber(vars?.__vehicleCrashTimer ?? 0));
            const usePhysicsRotation = Boolean(object.vehicle.crashDamageEnabled) && object.physics?.bodyType === 'dynamic' && crashTimer > 0;
            if (usePhysicsRotation) {
              const mutable = mutableObjectVars(object.id, object.variables);
              mutable.__vehicleYaw = next.rotation[1];
            }
            return {
              ...object,
              transform: { position, rotation: usePhysicsRotation ? next.rotation : object.transform.rotation, scale: object.transform.scale },
            };
          }
          // IDENTITY GUARD (perf): a sleeping/static body reports the exact same numbers every step —
          // cloning it anyway gave every physics object a fresh identity each frame, defeating the React
          // memo layer scene-wide. Keep the object when nothing actually moved.
          const cur = object.transform;
          const rot = next.rotation;
          if (
            cur.position[0] === position[0] && cur.position[1] === position[1] && cur.position[2] === position[2] &&
            cur.rotation[0] === rot[0] && cur.rotation[1] === rot[1] && cur.rotation[2] === rot[2]
          ) {
            return object;
          }
          return {
            ...object,
            transform: { position, rotation: next.rotation, scale: object.transform.scale },
          };
        });
        // Raycast-sim vehicles: the Rapier vehicle controller is authoritative — write the chassis transform and
        // wheel poses from the physics result. Wheels use a steering-ANCHOR rig (anchor child = steer + suspension
        // bob, wheel mesh under it = spin) so steer and spin compose correctly instead of skewing the wheel.
        if (result.vehicles.size) {
          const wheelStates = new Map<string, VehicleWheelState>();
          for (const [, st] of result.vehicles) for (const w of st.wheels) wheelStates.set(w.objectId, w);
          // Each wheel mesh's PARENT is its steering anchor — map anchorId → wheel state so the anchor carries
          // steer + the suspension bob. (A wheel parented directly to the car has no anchor → handled inline.)
          const byIdNow = fillObjectIdMap(tickVehicleById, resolvedObjects);
          const anchorStates = new Map<string, VehicleWheelState>();
          for (const ws of wheelStates.values()) {
            const parentId = byIdNow.get(ws.objectId)?.parentId;
            if (parentId && !result.vehicles.has(parentId)) anchorStates.set(parentId, ws);
          }
          // Brake-light glow + speedometer/tach mirrors (raycast cars skip the arcade pass that normally does this).
          const brakeLightGlow = new Map<string, number>();
          // Loose parts torn off by THIS frame's crashes — converted into free dynamic props after the pass.
          const partDetachQueue: Array<{ partId: string; vel: Vector3Tuple; spin: Vector3Tuple }> = [];
          const speedVarMirror = variableByName.get('Speed');
          const rpmVarMirror = variableByName.get('RPM');
          const gearVarMirror = variableByName.get('Gear');
          for (const [carId, st] of result.vehicles) {
            const veh = resolveVehicle(byIdNow.get(carId)?.vehicle);
            const input = vehicleInputs[carId];
            const braking = Boolean(input && (input.throttle < -0.05 || input.handbrake));
            for (const lid of veh.brakeLightIds ?? []) brakeLightGlow.set(lid, braking ? 4 : 0.2);
            // BRAKE DISC HEAT: sustained hard braking from speed heats the discs to an orange glow; they
            // cool back down once released. Quantized so the emissive renderer only re-clones at visible
            // steps (the brake-light identity rule), never 60×/s while the value creeps.
            {
              // Heat is tracked for EVERY raycast car (it also drives brake fade), the glow only when the
              // car actually has disc meshes to light up.
              const bag = mutableObjectVars(carId, byIdNow.get(carId)?.variables ?? {});
              const spd = Math.abs(st.speed);
              let heat = toNumber(bag.__brakeHeat ?? 0);
              heat = braking && spd > 6 ? Math.min(1, heat + delta * (0.3 + spd * 0.014)) : Math.max(0, heat - delta * 0.35);
              bag.__brakeHeat = heat;
              if (veh.brakeDiscIds?.length) {
                const glow = (Math.round(heat * 8) / 8) * 6;
                for (const did of veh.brakeDiscIds) brakeLightGlow.set(did, glow);
              }
            }
            if (carId === vehiclePlayerId) {
              if (speedVarMirror) nextVariableValues[speedVarMirror.id] = Math.round(Math.abs(st.speed) * 3.6);
              // Drivetrain HUD: bind UI text/bars to "RPM" and "Gear" project vars (created by the template,
              // or by hand) — mirrored every frame from the sim.
              if (rpmVarMirror) nextVariableValues[rpmVarMirror.id] = Math.round(st.rpm);
              if (gearVarMirror) nextVariableValues[gearVarMirror.id] = st.gear === -1 ? 'R' : String(st.gear);
            }
          }
          resolvedObjects = resolvedObjects.map((object) => {
            const cs = result.vehicles.get(object.id);
            if (cs) {
              const mutable = mutableObjectVars(object.id, object.variables);
              const prevSpeed = toNumber(mutable.__vehicleSpeed ?? 0);
              mutable.__vehicleYaw = headingFromEuler(cs.chassis.rotation);
              mutable.__vehicleSpeed = cs.speed;
              const veh = resolveVehicle(object.vehicle);
              const input = vehicleInputs[object.id];
              // SKID SOUND only on a real slide — moving sideways, or handbrake locking the rears at speed.
              // (Keying it off raw tire side-impulse made it screech on every normal grippy turn.)
              const handbrake = Boolean(input?.handbrake);
              const braking = Boolean(input && input.throttle < -0.1);
              const skidding = Math.abs(cs.speed) > 3 && (Math.abs(cs.lateralSpeed) > 3.5 || (handbrake && Math.abs(cs.speed) > 5));
              // TIRE MARKS are more lenient than the screech: lay rubber on any slide, the handbrake, OR hard
              // braking from speed — so you actually see marks "when you brake and stuff", not just big drifts.
              const leavingMarks = Math.abs(cs.speed) > 2 && (Math.abs(cs.lateralSpeed) > 1.6 || handbrake || (braking && Math.abs(cs.speed) > 7));
              // Gear-change edge: drives the exhaust backfire burst below AND a synthesized exhaust "pop" in
              // the engine audio (useRuntimeAudio fires one pop whenever this sequence number advances).
              const prevGear = toNumber(mutable.__vehicleGear ?? 1);
              mutable.__vehicleGear = cs.gear;
              const upshifted = cs.gear > prevGear && prevGear >= 1;
              if (upshifted) mutable.__popSeq = toNumber(mutable.__popSeq ?? 0) + 1;
              if (object.id === vehiclePlayerId) {
                // Engine pitch from the SIM'S RPM, not road speed — so the note climbs through each gear and
                // drops on the shift, exactly what sells "this car has a real gearbox".
                const idle = veh.idleRpm ?? 900;
                nextVehicleSound = {
                  engineId: veh.engineSoundId,
                  skidId: veh.skidSoundId,
                  rpm: Math.min(1, Math.max(0, (cs.rpm - idle) / Math.max(1, (veh.maxRpm ?? 7200) - idle))),
                  slip: skidding ? Math.min(1, Math.abs(cs.lateralSpeed) / 10) : 0,
                  pop: toNumber(mutable.__popSeq ?? 0),
                };
              }
              for (const id of veh.tireMarkIds) sendParticleCommand(id, { type: 'emit', on: leavingMarks });
              // Nitro exhaust flames: on while the Nitro var is burning.
              if (veh.boostFlameIds?.length) {
                const nv = variableByName.get('Nitro');
                const flaming = nv ? toNumber(nextVariableValues[nv.id] ?? nv.defaultValue) > 0.05 : false;
                for (const id of veh.boostFlameIds) sendParticleCommand(id, { type: 'emit', on: flaming });
              }
              // One-shots: raycast cars skip the arcade audio block, so fire them here.
              const pos = cs.chassis.position;
              const inCollision = result.collisions.some((c) => c.objectId === object.id || c.otherObjectId === object.id);
              if (veh.collisionSoundId && Math.abs(cs.speed) > 4 && inCollision) {
                const key = `${object.id}:hitSfx`;
                if ((nextCooldowns[key] ?? 0) <= 0) { pushSound(veh.collisionSoundId, pos); nextCooldowns[key] = 0.4; }
              }
              // SOFT-BODY DAMAGE: a hard hit is EITHER a fresh contact while moving, OR a sudden speed drop (the
              // car slammed into something) — the decel test catches impacts even when the contact-event timing
              // is missed. Record a plastic dent from the car's travel direction (car-local). Bumps "Damage".
              const decel = Math.abs(prevSpeed) - Math.abs(cs.speed);
              const hardImpact = (inCollision && Math.abs(cs.speed) > 2) || decel > 4;
              if (veh.deformable && hardImpact) {
                const key = `${object.id}:dent`;
                if ((nextCooldowns[key] ?? 0) <= 0) {
                  // Impact severity = whichever is bigger: the decel spike or current speed.
                  const sev = Math.max(decel, Math.abs(prevSpeed));
                  const depth = Math.min(0.55, Math.max(0.14, sev * 0.05));
                  // Direction: prefer the pre-impact travel direction (prevSpeed) so the leading face crumples.
                  addVehicleDent(object.id, [cs.lateralSpeed, -0.15, prevSpeed !== 0 ? prevSpeed : cs.speed], depth);
                  nextCooldowns[key] = 0.15;
                  const dmgVar = variableByName.get('Damage');
                  if (dmgVar) nextVariableValues[dmgVar.id] = toNumber(nextVariableValues[dmgVar.id] ?? dmgVar.defaultValue) + 1;
                }
              }
              // CRASH VFX: every hard hit throws a spark burst from the leading edge (where the dent lands);
              // a violent one (high decel/speed) goes up in a fiery burst instead, and the player's camera
              // gets a jolt scaled to the impact. Self-despawning effect objects — no emitter setup needed.
              if (hardImpact) {
                const key = `${object.id}:crashFx`;
                if ((nextCooldowns[key] ?? 0) <= 0) {
                  nextCooldowns[key] = 0.25;
                  const sev = Math.max(decel, Math.abs(prevSpeed));
                  const yaw = cs.chassis.rotation[1];
                  const dir = prevSpeed >= 0 ? 1 : -1;
                  const nose: Vector3Tuple = [pos[0] + Math.sin(yaw) * dir * 1.1, pos[1] + 0.35, pos[2] + Math.cos(yaw) * dir * 1.1];
                  spawned.push(sev > 14 ? makeExplosion(nose, '#ff9a3d') : makeImpactObject(nose, '#ffd27f'));
                  if (object.id === vehiclePlayerId) cameraShake = Math.min(1, cameraShake + Math.min(0.55, 0.1 + sev * 0.025));
                }
              }
              // SCRAPE SPARKS: grinding along a wall/guardrail (still touching solid scenery after the initial
              // hit, moving, but below the hard-impact threshold) streams sparks from the scraping flank.
              // Contact events are enter/exit edges, so a touch latch carries the "still against it" state.
              {
                let wallTouch = toNumber(mutable.__wallTouch ?? 0) > 0.5;
                for (const c of result.collisions) {
                  if (c.objectId !== object.id) continue;
                  const other = byIdNow.get(c.otherObjectId);
                  if (other && other.kind !== 'terrain' && other.physics?.bodyType !== 'dynamic') { wallTouch = true; break; }
                }
                if (result.collisionsExit.some((c) => c.objectId === object.id)) wallTouch = false;
                mutable.__wallTouch = wallTouch ? 1 : 0;
                if (wallTouch && !hardImpact && Math.abs(cs.speed) > 5) {
                  const key = `${object.id}:scrapeFx`;
                  if ((nextCooldowns[key] ?? 0) <= 0) {
                    nextCooldowns[key] = 0.14;
                    // The wall sits on the side the car is sliding toward; remember it while grinding straight.
                    const side = Math.abs(cs.lateralSpeed) > 0.4 ? Math.sign(cs.lateralSpeed) : toNumber(mutable.__scrapeSide ?? 1) || 1;
                    mutable.__scrapeSide = side;
                    const yawSc = cs.chassis.rotation[1];
                    spawned.push(
                      makeImpactObject([pos[0] + Math.cos(yawSc) * side * 1.05, pos[1] + 0.3, pos[2] - Math.sin(yawSc) * side * 1.05], '#ffd9a0'),
                    );
                  }
                }
              }
              // LOOSE PARTS: a hard enough hit TEARS OFF the cosmetic part facing the impact — the bumper
              // on a head-on, a skirt on a side swipe, two parts on a violent crash. Queued here; after
              // this pass the part becomes a free dynamic prop that tumbles away with the car's momentum.
              if (veh.loosePartIds?.length && hardImpact) {
                const sevP = Math.max(decel, Math.abs(prevSpeed));
                const key = `${object.id}:partDetach`;
                if (sevP > 7 && (nextCooldowns[key] ?? 0) <= 0) {
                  nextCooldowns[key] = 0.35;
                  const attached = veh.loosePartIds.filter(
                    (pid) => byIdNow.get(pid)?.parentId === object.id && !detachedParts.has(pid),
                  );
                  // Impact direction in car-local space (same convention as the dent): lateral + travel.
                  const dLat = cs.lateralSpeed;
                  const dLong = prevSpeed !== 0 ? prevSpeed : cs.speed;
                  const dLen = Math.hypot(dLat, dLong) || 1;
                  const scored = attached
                    .map((pid) => {
                      const p = byIdNow.get(pid)!.transform.position;
                      const pLen = Math.hypot(p[0], p[2]) || 1;
                      return { pid, score: (p[0] * dLat + p[2] * dLong) / (pLen * dLen) };
                    })
                    .sort((a, b) => b.score - a.score);
                  const yawD = cs.chassis.rotation[1];
                  const fwd = prevSpeed >= 0 ? 1 : -1;
                  for (const { pid, score } of scored.slice(0, sevP > 15 ? 2 : 1)) {
                    if (score < 0.2) break; // nothing mounted on that side — the body just dents
                    partDetachQueue.push({
                      partId: pid,
                      // Inherit most of the pre-impact momentum + an upward/outward scatter kick.
                      vel: [
                        Math.sin(yawD) * fwd * Math.abs(prevSpeed) * 0.55 + (Math.random() - 0.5) * 3,
                        2.2 + Math.random() * 1.6,
                        Math.cos(yawD) * fwd * Math.abs(prevSpeed) * 0.55 + (Math.random() - 0.5) * 3,
                      ],
                      spin: [(Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4],
                    });
                  }
                }
              }
              // --- Per-wheel VFX: smoke/dust spawn at each tire's CONTACT PATCH (chassis-local connection
              //     point rotated by the car's yaw), not the car's center — a four-wheel slide smokes at all
              //     four corners, a clipped curb puffs only at the wheel that clipped it. ---
              const carYaw = cs.chassis.rotation[1];
              const yawSin = Math.sin(carYaw);
              const yawCos = Math.cos(carYaw);
              const wheelRadius = Math.max(veh.wheelRadius ?? 0.4, 0.05);
              const wheelGround = (w: (typeof cs.wheels)[number]): Vector3Tuple => [
                pos[0] + w.connectionX * yawCos + w.connectionZ * yawSin,
                pos[1] + w.connectionY - w.suspension - wheelRadius + 0.06,
                pos[2] - w.connectionX * yawSin + w.connectionZ * yawCos,
              ];
              // Travel heading from the position delta (robust on slides, where facing ≠ direction of travel).
              const prevPX = toNumber(mutable.__vehiclePX ?? pos[0]);
              const prevPZ = toNumber(mutable.__vehiclePZ ?? pos[2]);
              const moveDX = pos[0] - prevPX;
              const moveDZ = pos[2] - prevPZ;
              mutable.__vehiclePX = pos[0];
              mutable.__vehiclePZ = pos[2];
              const travelYaw = Math.hypot(moveDX, moveDZ) > 0.02 ? Math.atan2(moveDX, moveDZ) : carYaw;

              // LANDING DUST: stomp a puff under EACH wheel as it touches down off a real jump.
              const groundedNow = cs.wheels.some((w) => w.inContact);
              const wasAirborne = toNumber(mutable.__airtime ?? 0) > 0.35;
              if (groundedNow && wasAirborne) {
                for (const w of cs.wheels) if (w.inContact) spawned.push(makeDustPuff(wheelGround(w), '#b9a37e', 12, 0.8));
              }
              // DRIFT SMOKE: while genuinely sliding, shed grey billows from each REAR contact patch — tire
              // smoke trailing the slide (the looped skid audio keys off the same signal).
              if (skidding) {
                const key = `${object.id}:driftFx`;
                if ((nextCooldowns[key] ?? 0) <= 0) {
                  nextCooldowns[key] = 0.16;
                  for (const w of cs.wheels) {
                    if (w.axle === 'rear' && w.inContact) spawned.push(makeDustPuff(wheelGround(w), '#c9ccd2', 10, 1.1));
                  }
                }
              }
              // OFFROAD KICK-UP + RAIN SPRAY: each wheel reports the actual `surface` tag it's rolling on,
              // so the puff matches the ground — green-flecked grass, bright sand, grey gravel, white snow.
              // A WET track (the rain toggle's "Wet" var slicking untagged tarmac) throws blue-grey water
              // spray off the tires instead of dirt — the rooster-tail look that sells driving in rain.
              if (Math.abs(cs.speed) > 6) {
                const key = `${object.id}:dustFx`;
                if ((nextCooldowns[key] ?? 0) <= 0) {
                  const wetVarRef = variableByName.get('Wet');
                  const wetNow = wetVarRef ? toNumber(nextVariableValues[wetVarRef.id] ?? wetVarRef.defaultValue) : 0;
                  let any = false;
                  for (const w of cs.wheels) {
                    if (!w.inContact || (w.grip ?? 1) >= 0.8) continue;
                    const color =
                      SURFACE_DUST[w.surface] ??
                      (wetNow > 0.3 ? '#a8c6dd' : (w.grip ?? 1) < 0.5 ? '#d8c08a' : '#9a8d6b');
                    spawned.push(makeDustPuff(wheelGround(w), color, 9, 0.9));
                    any = true;
                  }
                  if (any) nextCooldowns[key] = 0.2;
                }
              }
              // PERSISTENT SKID MARKS: braking hard, sliding, or handbraking lays real rubber on the track
              // at each working wheel's contact patch (rendered by the SkidMarks instanced layer; spaced by
              // distance + capped in runtime/skidMarks). Loose surfaces dust instead of marking.
              if (leavingMarks) {
                const strength = Math.min(1, Math.abs(cs.lateralSpeed) / 7 + (handbrake ? 0.45 : 0) + (braking ? 0.3 : 0));
                cs.wheels.forEach((w, i) => {
                  if (!w.inContact || (w.grip ?? 1) < 0.8) return;
                  // Rears always mark; fronts only under service braking (locked-front feel).
                  if (w.axle === 'front' && !braking) return;
                  const g = wheelGround(w);
                  addSkidMark(`${object.id}:${i}`, g[0], g[1] - 0.03, g[2], travelYaw, strength);
                });
              }
              // SHIFT BACKFIRE: an upshift pops a quick flame burst from the exhaust/boost emitters — pairs
              // with the RPM drop + the synthesized pop in the engine audio (gear edge detected above).
              if (upshifted && veh.boostFlameIds?.length) {
                for (const id of veh.boostFlameIds) sendParticleCommand(id, { type: 'burst', count: 12 });
              }
              // WRECKED-ENGINE SMOKE: a badly damaged car (8+ dents) trails dark smoke from the hood,
              // thickening (and blackening) as damage climbs. R respawns AND repairs, which stops it.
              if (object.id === vehiclePlayerId) {
                const dmgVarV = variableByName.get('Damage');
                const dmgVal = dmgVarV ? toNumber(nextVariableValues[dmgVarV.id] ?? dmgVarV.defaultValue) : 0;
                if (dmgVal >= 8) {
                  const key = `${object.id}:engineSmoke`;
                  if ((nextCooldowns[key] ?? 0) <= 0) {
                    nextCooldowns[key] = Math.max(0.12, 0.4 - dmgVal * 0.012);
                    const hood: Vector3Tuple = [pos[0] + Math.sin(carYaw) * 1.0, pos[1] + 0.75, pos[2] + Math.cos(carYaw) * 1.0];
                    spawned.push(makeDustPuff(hood, dmgVal >= 14 ? '#23272e' : '#555b66', 6, 0.9));
                  }
                }
              }
              if (veh.brakeSoundId && input && input.throttle < -0.1 && cs.speed > 8) {
                const key = `${object.id}:brakeSfx`;
                if ((nextCooldowns[key] ?? 0) <= 0) { pushSound(veh.brakeSoundId, pos); nextCooldowns[key] = 0.9; }
              }
              if (veh.hornSoundId && currentKeys[veh.keyHorn]) {
                const key = `${object.id}:hornSfx`;
                if ((nextCooldowns[key] ?? 0) <= 0) { pushSound(veh.hornSoundId, pos); nextCooldowns[key] = 0.5; }
              }
              // DRIFT & STUNT SCORING with a COMBO BANK: style points (drift slip + big air) build up as a
              // PENDING combo first — drive clean for a second and they bank into "Score"; crash while the
              // combo is alive and the pending points are LOST (the crash already plays its own FX, the HUD
              // chip vanishing is the punishment). "Combo" mirrors the live pending points for the HUD; the
              // "Stunt" var (0 none / 1 DRIFT / 2 BIG AIR / 3 PERFECT LAUNCH) flashes the banner. Engine-level —
              // any car with those project vars scores.
              const grounded = cs.wheels.some((w) => w.inContact);
              let airtime = toNumber(mutable.__airtime ?? 0);
              let stuntTimer = Math.max(0, toNumber(mutable.__stuntTimer ?? 0) - delta);
              let stuntKind = stuntTimer > 0 ? toNumber(mutable.__stuntKind ?? 0) : 0;
              let pending = Math.max(0, toNumber(mutable.__stuntPending ?? 0));
              let lapse = toNumber(mutable.__stuntLapse ?? 0) + delta;
              if (!grounded) {
                if (Math.abs(cs.speed) > 2) airtime += delta;
              } else {
                if (airtime > 0.45) { pending += Math.round(airtime * 140); lapse = 0; stuntKind = 2; stuntTimer = 1.4; } // BIG AIR on landing
                airtime = 0;
              }
              const drifting = grounded && Math.abs(cs.lateralSpeed) > 4 && Math.abs(cs.speed) > 6;
              if (drifting) {
                pending += Math.abs(cs.lateralSpeed) * delta * 4; // drift points while sliding
                lapse = 0;
                if (stuntKind !== 2 && stuntKind !== 3) { stuntKind = 1; stuntTimer = Math.max(stuntTimer, 0.25); }
              }
              let scoreAdd = 0;
              if (hardImpact && pending > 0) pending = 0; // wrecked the combo — pending style points are lost
              else if (pending >= 1 && lapse > 1) { scoreAdd = Math.round(pending); pending = 0; } // banked clean
              mutable.__airtime = airtime;
              mutable.__stuntTimer = stuntTimer;
              mutable.__stuntKind = stuntKind;
              mutable.__stuntPending = pending;
              mutable.__stuntLapse = lapse;
              if (object.id === vehiclePlayerId) {
                const scoreVar = variableByName.get('Score');
                if (scoreVar && scoreAdd > 0) nextVariableValues[scoreVar.id] = Math.round(toNumber(nextVariableValues[scoreVar.id] ?? scoreVar.defaultValue) + scoreAdd);
                const comboVar = variableByName.get('Combo');
                if (comboVar) nextVariableValues[comboVar.id] = Math.round(pending);
                const stuntVar = variableByName.get('Stunt');
                if (stuntVar) nextVariableValues[stuntVar.id] = stuntKind;
                // BURNOUT-STYLE LOOP: drifting + big air CHARGE the Nitro bar (so style → boost → more style).
                const nitroV = variableByName.get('Nitro');
                if (nitroV && (drifting || stuntKind === 2)) {
                  nextVariableValues[nitroV.id] = Math.min(1, toNumber(nextVariableValues[nitroV.id] ?? nitroV.defaultValue) + delta * 0.35);
                }
              }
              // GARAGE: a "CarBody" var picks which body model the chassis shows; swap renderer.modelAssetId when
              // it changes (the raycast chassis re-sizes to the new body via its signature rebuild).
              let nextRenderer = object.renderer;
              if (veh.garageBodyIds?.length && object.renderer) {
                const cbVar = variableByName.get('CarBody');
                if (cbVar) {
                  const n = veh.garageBodyIds.length;
                  const idx = ((Math.round(toNumber(nextVariableValues[cbVar.id] ?? cbVar.defaultValue)) % n) + n) % n;
                  const want = veh.garageBodyIds[idx];
                  if (want && object.renderer.modelAssetId !== want) nextRenderer = { ...object.renderer, modelAssetId: want };
                }
              }
              return { ...object, renderer: nextRenderer, transform: { ...object.transform, position: cs.chassis.position, rotation: cs.chassis.rotation } };
            }
            // Steering anchor: placed at the auto-fit connection point (X/Z), bobs in Y (connectionY − suspension),
            // and steers (Y rot). Positioning X/Z here is what re-fits the wheels when the body model changes.
            const as = anchorStates.get(object.id);
            if (as) {
              return {
                ...object,
                transform: {
                  ...object.transform,
                  position: [as.connectionX, as.connectionY - as.suspension, as.connectionZ] as Vector3Tuple,
                  rotation: [0, as.steer, 0] as Vector3Tuple,
                },
              };
            }
            const ws = wheelStates.get(object.id);
            if (ws) {
              // Wheel mesh UNDER an anchor: only spin (X) — the anchor already applied position + steer + bob.
              if (anchorStates.has(object.parentId ?? '')) {
                return { ...object, transform: { ...object.transform, rotation: [ws.rotation, 0, 0] as Vector3Tuple } };
              }
              // Direct-child fallback (no anchor): position + combined spin/steer.
              return {
                ...object,
                transform: {
                  ...object.transform,
                  position: [ws.connectionX, ws.connectionY - ws.suspension, ws.connectionZ] as Vector3Tuple,
                  rotation: [ws.rotation, ws.steer, 0] as Vector3Tuple,
                },
              };
            }
            // Brake lights: brighten the emissive while braking/handbraking. Only mint a NEW renderer when
            // the glow VALUE changed (press/release edges) — re-cloning every frame while braking gave the
            // light a fresh identity 60×/s, re-resolving its material and re-rendering its subtree.
            const glow = brakeLightGlow.get(object.id);
            if (glow !== undefined && object.renderer) {
              if (object.renderer.materialOverrides?.emissiveIntensity === glow) return object;
              return {
                ...object,
                renderer: {
                  ...object.renderer,
                  materialOverrides: {
                    ...object.renderer.materialOverrides,
                    emissiveColor: object.renderer.materialOverrides?.emissiveColor ?? '#ff2a2a',
                    emissiveIntensity: glow,
                  },
                },
              };
            }
            return object;
          });
          // LOOSE PARTS, rare path (only on the frame a part comes off / a repair bolts it back on):
          // detaching = freeze the part's current WORLD pose, drop the parent link, give it a dynamic
          // body (its momentum kick applies next tick, once the body exists); restoring = re-parent at
          // the original LOCAL transform and remove the body.
          if (partDetachQueue.length || pendingPartRestores.size) {
            const worldSource = resolvedObjects;
            resolvedObjects = resolvedObjects.map((object) => {
              const det = partDetachQueue.find((d) => d.partId === object.id);
              if (det && object.parentId) {
                detachedParts.set(object.id, { parentId: object.parentId, transform: object.transform });
                pendingPartKicks.set(object.id, { vel: det.vel, spin: det.spin });
                return {
                  ...object,
                  parentId: undefined,
                  transform: worldTransformOf(worldSource, object.id),
                  physics: withPhysicsDefaults({ ...defaultPhysics(), enabled: true, bodyType: 'dynamic', collider: 'box' }),
                };
              }
              const restore = pendingPartRestores.get(object.id);
              if (restore) {
                return { ...object, parentId: restore.parentId, transform: structuredClone(restore.transform), physics: undefined };
              }
              return object;
            });
            pendingPartRestores.clear();
          }
        }
        groundedIds = [...groundedSet];
      }
      recordRuntimeSection('physics', performance.now() - physicsStart);
      // RACE LIGHT TREE (name convention, like "Checkpoint <n>"): cubes named "Start Light 1..3" follow the
      // "Count" project var that countdown blueprints write — 3/2/1 light them red one by one, GO! (0) flips
      // the row green, and -1 (countdown hidden) dims the tree. Identity-guarded: a lamp only re-clones on
      // the countdown steps themselves, never per frame.
      {
        const countVarRef = variableByName.get('Count');
        if (countVarRef) {
          const countNow = Math.round(toNumber(nextVariableValues[countVarRef.id] ?? countVarRef.defaultValue));
          resolvedObjects = resolvedObjects.map((object) => {
            if (!object.renderer || !object.name.startsWith('Start Light ')) return object;
            const lampIdx = Number(object.name.slice('Start Light '.length));
            if (!Number.isInteger(lampIdx)) return object;
            const go = countNow === 0;
            const lit = countNow >= 1 && countNow <= 3 && lampIdx <= 4 - countNow;
            const emissiveColor = go ? '#2ecf6f' : '#ff3b30';
            const emissiveIntensity = go ? 3.5 : lit ? 3 : 0.12;
            const cur = object.renderer.materialOverrides;
            if (cur?.emissiveColor === emissiveColor && cur?.emissiveIntensity === emissiveIntensity) return object;
            return { ...object, renderer: { ...object.renderer, materialOverrides: { ...cur, emissiveColor, emissiveIntensity } } };
          });
        }
      }
      const combatStart = performance.now();
      const resolvedObjectById = fillObjectIdMap(tickResolvedById, resolvedObjects);
      // Auto-fracture: a destructible object shatters when it (or the thing it hit) is moving fast enough on
      // contact. No contact-force readout exists, so approximate the impact with this-frame speed.
      if (collisions.length) {
        const speedOf = (id: string) => {
          const cur = resolvedObjectById.get(id)?.transform.position;
          const prev = prevTransforms.get(id)?.position;
          if (!cur || !prev) return 0;
          return Math.hypot(cur[0] - prev[0], cur[1] - prev[1], cur[2] - prev[2]) / Math.max(delta, 1e-4);
        };
        for (const contact of collisions) {
          for (const [selfId, otherId] of [
            [contact.objectId, contact.otherObjectId],
            [contact.otherObjectId, contact.objectId],
          ] as Array<[string, string]>) {
            const obj = resolvedObjectById.get(selfId);
            const threshold = obj?.fracture?.enabled ? obj.fracture.impactThreshold : 0;
            if (!threshold || threshold <= 0) continue;
            if (Math.max(speedOf(selfId), speedOf(otherId)) >= threshold) {
              fractureSource(obj, selfId, resolvedObjectById.get(otherId)?.transform.position);
            }
          }
        }
      }
      const currentCollisionIndex = buildContactIndex(collisions);

      // Swim / climb modes: maintain the "inside a volume" sets from trigger enter/exit against objects
      // tagged with a `volume` instance variable of 'water' or 'climb'. One frame delayed (like grounded).
      const nextSwimming = new Set(state.runtimeSwimming);
      const nextClimbing = new Set(state.runtimeClimbing);
      const nextSurfaceSound: Record<string, string> = { ...state.runtimeSurfaceSound };
      if (triggers.length || triggersExit.length) {
        const otherObj = (id: string) => resolvedObjectById.get(id);
        const volumeKind = (id: string) => {
          const object = otherObj(id);
          if (object?.water) return object.water.enabled ? 'water' : undefined;
          const v = object?.variables?.volume;
          return typeof v === 'string' ? v : undefined;
        };
        const isCharacter = (id: string) => Boolean(resolvedObjectById.get(id)?.character?.enabled);
        const apply = (charId: string, otherId: string, entering: boolean) => {
          if (!isCharacter(charId)) return;
          const kind = volumeKind(otherId);
          if (kind === 'water') entering ? nextSwimming.add(charId) : nextSwimming.delete(charId);
          else if (kind === 'climb') entering ? nextClimbing.add(charId) : nextClimbing.delete(charId);
          // Surface-aware footsteps: a footstep volume overrides the character's step sound while inside it.
          const surface = otherObj(otherId)?.variables?.footstepSound;
          if (typeof surface === 'string' && surface) {
            if (entering) nextSurfaceSound[charId] = surface;
            else if (nextSurfaceSound[charId] === surface) delete nextSurfaceSound[charId];
          }
        };
        for (const t of triggers) apply(t.objectId, t.otherObjectId, true);
        for (const t of triggersExit) apply(t.objectId, t.otherObjectId, false);
      }
      // Effective swim/climb = the "Set Movement Mode" OVERRIDE if present, else the volume-tag set. This is
      // what makes swim/climb work whether driven by a blueprint (Set Movement Mode) or the zero-config volume.
      const candidateIds = new Set<string>([...nextSwimming, ...nextClimbing, ...Object.keys(movementModeNow)]);
      const swimmingIds: string[] = [];
      const climbingIds: string[] = [];
      for (const id of candidateIds) {
        const m = movementModeNow[id];
        if (m ? m === 'swimming' : nextSwimming.has(id)) swimmingIds.push(id);
        if (m ? m === 'climbing' : nextClimbing.has(id)) climbingIds.push(id);
      }

      // Water entry FX: when a character first starts swimming (volume- OR blueprint-driven), fountain a splash
      // at its feet and play its swim/splash sound. Detected as "newly swimming vs last frame".
      for (const id of swimmingIds) {
        if (runtimeSwimmingSet.has(id)) continue;
        const obj = resolvedObjectById.get(id);
        if (!obj) continue;
        spawned.push(makeSplashObject(obj.transform.position));
        newWaterImpacts.push({ id: nextWaterImpactId(), x: obj.transform.position[0], z: obj.transform.position[2] });
        const splashSound = obj.character?.swimSoundId;
        if (splashSound) pushSound(splashSound, [...obj.transform.position] as Vector3Tuple);
      }

      // Landing sound: a character that became grounded this frame after falling (downward velocity last
      // frame) plays its land sound. The velocity check skips the play-start frame (rests at rest).
      // Hard landings also seed the LANDING-RECOVERY timer (impact-scaled): the next ticks sap move speed,
      // dip the follow camera, and drive the "landing" animator source — jumps gain consequence and weight.
      for (const id of groundedIds) {
        if (runtimeGroundedSet.has(id)) continue;
        const impactVy = state.runtimeVelocities[id]?.[1] ?? 0;
        if (impactVy >= -1) continue;
        const landObj = resolvedObjectById.get(id);
        if (!landObj?.character) continue;
        const landSound = landObj.character.landSoundId;
        if (landSound) pushSound(landSound, [...landObj.transform.position] as Vector3Tuple);
        const recovery = landObj.character.landingRecovery ?? 0.4;
        if (recovery > 0 && impactVy < -9) {
          nextLanding[id] = Math.min(0.4, Math.max(0.1, -impactVy / 45));
        }
      }

      // While a cinematic plays the player is locked in the cutscene (no input/camera control), so it must be
      // INVULNERABLE — otherwise an enemy that wandered into range during an intro cinematic could whittle the
      // frozen player down (the "I die during the opening cutscene" bug). Guards the three player-damage spots
      // below (projectile / contact / melee). `pendingCinematicId` covers the frame a Play-Cinematic node fires.
      const cinematicActive = Boolean(state.runtimeCinematic || pendingCinematicId);

      // Projectiles: a real moving rigid body. On its first solid contact with a non-owner it subtracts from
      // that object's `health` instance var (if any) and despawns; it also despawns when its life runs out.
      // Continuous collision detection on the body (see physicsWorld.createBody) stops a fast bullet from
      // tunnelling through a thin wall — so a shot that meets a wall splats THERE instead of carrying on to a
      // foe behind it. When several contacts register in one frame we resolve the NEAREST, so cover always
      // wins over a target standing behind it. Projectiles + corpses never block a shot (excluded below).
      const shotPassThrough = new Set<string>();
      for (const o of resolvedObjects) if (o.projectile || isRagdoll(o.id)) shotPassThrough.add(o.id);
      for (const obj of resolvedObjects) {
        const proj = obj.projectile;
        if (!proj) continue;
        // Detonate an explosive projectile (grenade/rocket) on impact OR when its fuse (life) runs out.
        const detonate = () => {
          explodeQueue.push({ pos: [...obj.transform.position] as Vector3Tuple, dmg: proj.blastDamage ?? 60, radius: proj.blastRadius ?? 4.5, force: 13, byPlayer: proj.ownerId === playerId });
          if (proj.blastSound) pushSound(proj.blastSound, [...obj.transform.position] as Vector3Tuple);
        };
        if (proj.life <= 0) {
          if (proj.explosive) detonate();
          destroyedIds.add(obj.id);
          continue;
        }
        // Of everything this bullet touched this frame, take the contact closest to it (cover beats target).
        let other: string | undefined;
        let bestDist = Infinity;
        const projectileContacts = contactOthers(currentCollisionIndex, obj.id);
        if (!projectileContacts) continue;
        for (const hit of projectileContacts) {
          if (hit === proj.ownerId || shotPassThrough.has(hit)) continue;
          const ho = resolvedObjectById.get(hit);
          if (!ho) continue;
          const dx = ho.transform.position[0] - obj.transform.position[0];
          const dy = ho.transform.position[1] - obj.transform.position[1];
          const dz = ho.transform.position[2] - obj.transform.position[2];
          const dd = dx * dx + dy * dy + dz * dz;
          if (dd < bestDist) {
            bestDist = dd;
            other = hit;
          }
        }
        if (!other) continue; // still flying — it hasn't struck anything yet
        const target = resolvedObjectById.get(other);
        if (!target) {
          destroyedIds.add(obj.id);
          continue;
        }
        const hasHealth = nextObjectVariables[other]?.health !== undefined || target.variables?.health !== undefined;
        if (hasHealth && !(other === playerId && cinematicActive)) {
          const cur = toNumber(nextObjectVariables[other]?.health ?? target.variables?.health ?? 0);
          const next = Math.max(0, cur - proj.damage);
          mutableObjectVars(other, target.variables).health = next;
          recordDamage(other, cur - next);
          // Hurt sound: a damaged character grunts (unless this hit kills it — death handles that).
          if (next > 0 && target.character?.hurtSoundId) pushSound(target.character.hurtSoundId, [...target.transform.position] as Vector3Tuple);
          if (next <= 0) {
            if (proj.ownerId === playerId && other !== playerId) killMarker += 1;
            killTarget(target, other, obj.transform.position); // explosive → blast; rig → ragdoll; destructible → shatter from hit; prop → despawn
          }
          // Combat feedback: floating damage number at the hit; hit marker if the LOCAL player shot it;
          // hurt vignette if the LOCAL player was the one hit.
          spawned.push(makeDamageNumber(obj.transform.position, proj.damage));
          if (proj.ownerId === playerId) hitMarker += 1;
          if (other === playerId) hurt += 1;
          if (proj.debug) prints.push(`🎯 ${obj.name} [${obj.id.slice(-4)}] hit ${target.name}: -${proj.damage} hp → ${next}${next <= 0 ? ' (destroyed)' : ''}`);
        } else if (proj.debug) {
          prints.push(`🎯 ${obj.name} [${obj.id.slice(-4)}] hit ${target.name} (no health var — no damage)`);
        }
        // Knockback: shove a struck DYNAMIC prop along the shot, so shooting a box/crate visibly pushes it.
        // (The bullet is removed the instant it reports a hit, so the solver alone won't reliably transfer
        // momentum — this applies the impulse directly to the hit body. Fixed/kinematic bodies are unaffected.)
        // Strength = a speed-scaled base × the projectile's `knockback` multiplier (node field, default 1; 0 = off).
        const knockMul = proj.knockback ?? 1;
        if (physics && knockMul > 0 && target.physics?.bodyType === 'dynamic') {
          const sp = Math.hypot(proj.velocity[0], proj.velocity[1], proj.velocity[2]) || 1;
          const k = Math.min(4, Math.max(1.5, sp * 0.045)) * knockMul;
          physics.applyImpulse(other, [(proj.velocity[0] / sp) * k, (proj.velocity[1] / sp) * k + 0.5 * knockMul, (proj.velocity[2] / sp) * k]);
        }
        // Consume the bullet (a wall stops it too): explosive rounds DETONATE (blast + area damage); the rest
        // spawn a small particle burst at the impact point.
        if (proj.explosive) detonate();
        // A bullet that struck a living thing (has health) throws a BLOOD-red burst; a wall/prop throws
        // the neutral warm spark. Reads as a real hit-vs-miss tell, the way AAA shooters do.
        else spawned.push(makeImpactObject(obj.transform.position, hasHealth ? '#a01515' : '#ffd27f'));
        destroyedIds.add(obj.id);
      }

      // Enemy contact damage: an enemy within `attackRange` of the local player drains its `health` on a
      // ~1s cadence (per-enemy cooldown). Triggers the hurt flash + the player's hurt sound. Suppressed while a
      // cinematic plays so the locked player can't be chipped down during a cutscene.
      if (playerId && !cinematicActive) {
        const player = resolvedObjectById.get(playerId);
        if (player) {
          const pp = player.transform.position;
          const hasHealth = nextObjectVariables[playerId]?.health !== undefined || player.variables?.health !== undefined;
          for (const e of resolvedObjects) {
            if (!e.variables?.enemy || isRagdoll(e.id)) continue; // dead/limp enemies stop dealing contact damage
            let cd = (state.runtimeEnemyCooldown[e.id] ?? 0) - delta;
            const dx = pp[0] - e.transform.position[0];
            const dz = pp[2] - e.transform.position[2];
            const near = Math.hypot(dx, dz) < toNumber(e.variables.attackRange ?? 1.6);
            // Only spend a line-of-sight raycast when a hit could actually land this frame: the enemy
            // is in range, its attack cooldown has elapsed, and the player has health to lose.
            // Otherwise the cover check is moot, so skip it (most nearby enemies are mid-cooldown).
            let blocked = false;
            if (near && cd <= 0 && hasHealth && physics) {
              // A wall between the enemy and the player blocks the swipe (no hitting through cover).
              const ep = e.transform.position;
              const dir3: Vector3Tuple = [pp[0] - ep[0], pp[1] - ep[1], pp[2] - ep[2]];
              const dist3 = Math.hypot(dir3[0], dir3[1], dir3[2]);
              const exclude = new Set(shotPassThrough);
              exclude.add(e.id);
              const los = physics.castRay([ep[0], ep[1] + 0.9, ep[2]], dir3, dist3, exclude);
              if (los && los.objectId !== playerId && los.distance < dist3 - 0.15) blocked = true;
            }
            if (near && !blocked && cd <= 0 && hasHealth) {
              const dmg = toNumber(e.variables.enemyDamage ?? 10);
              const cur = toNumber(nextObjectVariables[playerId]?.health ?? player.variables?.health ?? 0);
              mutableObjectVars(playerId, player.variables).health = Math.max(0, cur - dmg);
              recordDamage(playerId, Math.min(dmg, cur));
              hurt += 1;
              if (player.character?.hurtSoundId) pushSound(player.character.hurtSoundId, [...player.transform.position] as Vector3Tuple);
              cd = 1;
            }
            if (cd > 0) nextEnemyCd[e.id] = cd;
          }
        }
      }

      // Melee hits: a character that started an attack swing this frame WITHOUT a ranged weapon out (sword
      // swing / punch) damages every object with `health` in a front cone within meleeRange. Ranged shots are
      // handled by the projectile system, so attackers in RangedMode are skipped here.
      for (const attackerId of meleeSwings) {
        const attacker = resolvedObjectById.get(attackerId);
        if (!attacker?.character) continue;
        const ctrl = attacker.animator?.controllerId ? controllerById.get(attacker.animator.controllerId) : undefined;
        const rangedParam = ctrl ? getAnimatorControllerRuntime(ctrl).paramsByName.get('RangedMode') : undefined;
        const isRanged = rangedParam ? Boolean(state.runtimeAnimators[attackerId]?.params?.[rangedParam.id]) : false;
        if (isRanged) continue; // the gun's projectiles deal the damage, not the swing
        const acc = resolveCharacter(attacker.character);
        const range = acc.meleeRange ?? 2.4;
        const dmg = acc.meleeDamage ?? 34;
        const ap = attacker.transform.position;
        const facing = attacker.transform.rotation[1] - (acc.modelYawOffset ?? 0);
        const fwd: [number, number] = [Math.sin(facing), Math.cos(facing)];
        const meleeExclude = new Set(shotPassThrough); // projectiles + corpses never block a swing
        meleeExclude.add(attackerId);
        for (const target of resolvedObjects) {
          if (target.id === attackerId || target.projectile || isRagdoll(target.id)) continue;
          if (target.id === playerId && cinematicActive) continue; // player is invulnerable during cutscenes
          const hasHealth = nextObjectVariables[target.id]?.health !== undefined || target.variables?.health !== undefined;
          if (!hasHealth) continue;
          const dx = target.transform.position[0] - ap[0];
          const dz = target.transform.position[2] - ap[2];
          const d = Math.hypot(dx, dz);
          if (d > range) continue;
          if (d > 0.3 && (dx / d) * fwd[0] + (dz / d) * fwd[1] < 0.35) continue; // must be in the swing's front cone
          // Line-of-sight: don't let a swing pass through a wall to hit a foe behind cover. Cast from the
          // attacker's chest to the target's; if solid geometry sits closer than the target, the hit is blocked.
          if (physics) {
            const tp = target.transform.position;
            const dir3: Vector3Tuple = [tp[0] - ap[0], tp[1] - ap[1], tp[2] - ap[2]];
            const dist3 = Math.hypot(dir3[0], dir3[1], dir3[2]);
            const los = physics.castRay([ap[0], ap[1] + 0.9, ap[2]], dir3, dist3, meleeExclude);
            if (los && los.objectId !== target.id && los.distance < dist3 - 0.15) continue;
          }
          const cur = toNumber(nextObjectVariables[target.id]?.health ?? target.variables?.health ?? 0);
          const next = Math.max(0, cur - dmg);
          mutableObjectVars(target.id, target.variables).health = next;
          recordDamage(target.id, cur - next);
          spawned.push(makeDamageNumber(target.transform.position, dmg));
          spawned.push(makeImpactObject(target.transform.position, '#ffd27f'));
          if (attackerId === playerId) hitMarker += 1;
          if (target.id === playerId) hurt += 1;
          if (next > 0 && target.character?.hurtSoundId) pushSound(target.character.hurtSoundId, [...target.transform.position] as Vector3Tuple);
          if (next <= 0) {
            if (attackerId === playerId && target.id !== playerId) killMarker += 1;
            killTarget(target, target.id); // explosive → blast; rig → ragdoll; prop → despawn
          }
        }
      }

      // Process queued explosions: each spawns a fiery burst + deals falloff-free area damage to every health
      // object in radius. A barrel/enemy killed by the blast that is itself `explosive` chains (re-queued); the
      // `exploded` guard + the count cap keep it bounded.
      let blastGuard = 0;
      // The pool of objects a blast can damage (health var or Receive Damage listener) is the same for
      // every blast this tick — build it once on the first blast so a chained detonation (barrel → barrel)
      // re-scans this short list instead of the whole scene. Per-blast state (destroyed/ragdoll/current
      // HP) is still checked inside the loop, so chain semantics are unchanged.
      let blastCandidates: SceneObject[] | null = null;
      while (explodeQueue.length && blastGuard++ < 64) {
        const blast = explodeQueue.shift()!;
        spawned.push(makeExplosion(blast.pos));
        // Physical blast: fling nearby dynamic props/debris outward (the fun part — damage is separate).
        const blastForce = blast.force ?? 14;
        getActivePhysics()?.applyRadialImpulse(blast.pos, blast.radius, blastForce);
        // Publish it so NON-rigid sims (cloth) can react to the same blast (a flag billows when hit).
        pushExplosion(blast.pos, blast.radius, blastForce);
        // Explosions kick the camera, scaled down with distance from the player.
        if (aiPlayer) {
          const pp = aiPlayer.transform.position;
          const bd = Math.hypot(pp[0] - blast.pos[0], pp[1] - blast.pos[1], pp[2] - blast.pos[2]);
          cameraShake = Math.min(1, cameraShake + 0.6 * Math.max(0, 1 - bd / (blast.radius * 4)));
          // A hot-orange screen bloom on close blasts, falling off faster than the shake (radius*3).
          const fp = 0.8 * Math.max(0, 1 - bd / (blast.radius * 3));
          if (fp > flash) {
            flash = Math.min(1, fp);
            flashColor = '#ffd29a';
          }
        }
        if (!blastCandidates) {
          blastCandidates = [];
          for (const o of resolvedObjects) {
            if (o.projectile || o.effect) continue;
            const hasHp = nextObjectVariables[o.id]?.health !== undefined || o.variables?.health !== undefined;
            // Damageable if it has a health var OR listens for On Receive Damage (auto — no var needed).
            if (hasHp || listensForReceiveDamage.has(o.id)) blastCandidates.push(o);
          }
        }
        for (const o of blastCandidates) {
          if (destroyedIds.has(o.id) || isRagdoll(o.id)) continue;
          const hasHp = nextObjectVariables[o.id]?.health !== undefined || o.variables?.health !== undefined;
          const dx = o.transform.position[0] - blast.pos[0];
          const dy = o.transform.position[1] - blast.pos[1];
          const dz = o.transform.position[2] - blast.pos[2];
          if (Math.hypot(dx, dy, dz) > blast.radius || blast.dmg <= 0) continue;
          // Effective HP pool: explicit health var, else the node's startingHealth, else none (notify-only).
          const nodeHp = receiveDamageHealth.get(o.id);
          if (hasHp || nodeHp !== undefined) {
            const cur = toNumber(nextObjectVariables[o.id]?.health ?? o.variables?.health ?? nodeHp ?? 0);
            if (cur <= 0) continue;
            const next = Math.max(0, cur - blast.dmg);
            mutableObjectVars(o.id, o.variables).health = next;
            recordDamage(o.id, cur - next);
            if (o.id === playerId) hurt += 1;
            if (next <= 0) {
              if (blast.byPlayer && o.id !== playerId) killMarker += 1;
              killTarget(o, o.id); // chains if `o` is explosive
            }
          } else {
            // Listener with no HP pool: just fire its On Receive Damage event (notify-only, never dies).
            recordDamage(o.id, blast.dmg);
          }
        }
      }

      // Mirror the player's instance `health` into the project 'Health' variable so the HUD bar + death/ragdoll
      // (which read that variable) reflect combat damage AND health pickups. Instance `health` is the source of
      // truth (it's what the projectile/melee/enemy-contact passes write); this is a one-way follow.
      if (playerId) {
        const healthVar = variableByName.get('Health');
        const player = resolvedObjectById.get(playerId);
        const h = nextObjectVariables[playerId]?.health ?? player?.variables?.health;
        if (healthVar && h !== undefined) nextVariableValues[healthVar.id] = toNumber(h);
      }

      // Mirror the driven car's horizontal speed into a project 'Speed' variable (km/h-ish) so a driving HUD
      // speedometer can bind to it. The vehicle pass stored the car's world velocity in nextVelocities.
      if (vehiclePlayerId) {
        const speedVar = variableByName.get('Speed');
        const v = nextVelocities[vehiclePlayerId];
        if (speedVar && v) nextVariableValues[speedVar.id] = Math.round(Math.hypot(v[0], v[2]) * 3.6);
      }

      // --- Lap / checkpoint timing (race tracks) ---
      // Opt-in: only runs when the project has a `Lap` variable (the driving template creates it). Checkpoints
      // are scene objects named "Checkpoint <n>" (0 = start/finish); the driven car must pass them IN ORDER, and
      // re-crossing the start/finish (0) after the last one banks a lap. Mirrored into project vars for the HUD —
      // far more robust than wiring per-gate trigger blueprints. Proximity-based so it needs no physical colliders.
      const lapVar = variableByName.get('Lap');
      if (lapVar && vehiclePlayerId && drivingActive) {
        const nextIdxVar = variableByName.get('Checkpoint');
        const lapTimeVar = variableByName.get('LapTime');
        const bestVar = variableByName.get('BestLap');
        // Reuse the race-support pass's extraction (same "Checkpoint <n>" objects; gates are static, and
        // a driven car existing guarantees the vehicle-gated scan above actually ran).
        const checkpoints = raceCheckpoints;
        const carPos = vehicleBody.get(vehiclePlayerId)?.position ?? activeObjectById.get(vehiclePlayerId)?.transform.position;
        if (checkpoints.length && carPos && nextIdxVar) {
          const maxIdx = checkpoints[checkpoints.length - 1].idx;
          let nextIdx = toNumber(nextVariableValues[nextIdxVar.id] ?? nextIdxVar.defaultValue);
          let laps = toNumber(nextVariableValues[lapVar.id] ?? lapVar.defaultValue);
          let lapTime = toNumber((lapTimeVar && nextVariableValues[lapTimeVar.id]) ?? lapTimeVar?.defaultValue ?? 0) + delta;
          let best = toNumber((bestVar && nextVariableValues[bestVar.id]) ?? bestVar?.defaultValue ?? 0);
          const target = checkpoints.find((c) => c.idx === nextIdx) ?? checkpoints[0];
          const CP_RADIUS = 16;
          if (Math.hypot(carPos[0] - target.pos[0], carPos[2] - target.pos[2]) < CP_RADIUS) {
            if (target.idx === 0) {
              // The FIRST start/finish crossing only arms the lap (leaving the grid) — a best time can
              // only bank once a full flying lap has been driven, never the few seconds off the grid.
              if (laps > 0 && (best === 0 || lapTime < best)) best = lapTime;
              laps += 1;
              lapTime = 0;
              nextIdx = maxIdx > 0 ? 1 : 0;
              const chime = assetByName.get('lap_complete.mp3');
              if (chime) pushSound(chime.id);
            } else {
              nextIdx = target.idx >= maxIdx ? 0 : target.idx + 1;
              const blip = assetByName.get('checkpoint.mp3');
              if (blip) pushSound(blip.id);
            }
          }
          nextVariableValues[nextIdxVar.id] = nextIdx;
          nextVariableValues[lapVar.id] = laps;
          if (lapTimeVar) nextVariableValues[lapTimeVar.id] = Math.round(lapTime * 10) / 10;
          if (bestVar) nextVariableValues[bestVar.id] = Math.round(best * 10) / 10;
          // RACE POSITION (opt-in via a "Position" var): rank the player against every aiDriver rival by
          // continuous race progress (laps + gates passed + distance toward the next gate) — drives a
          // "POS 2/4" HUD chip. Rival lap/gate state lives in their __aiLap/__aiNextCp runtime vars.
          const posVar = variableByName.get('Position');
          if (posVar) {
            const cpCountRank = maxIdx + 1;
            const progressOf = (lap: number, next: number, x: number, z: number) => {
              const t = checkpoints.find((c) => c.idx === next) ?? checkpoints[0];
              const frac = 1 - Math.min(1, Math.hypot(t.pos[0] - x, t.pos[2] - z) / 80);
              return lap * cpCountRank + ((next - 1 + cpCountRank) % cpCountRank) + frac;
            };
            const playerProg = progressOf(laps, nextIdx, carPos[0], carPos[2]);
            let rank = 1;
            for (const o of resolvedObjects) {
              if (o.id === vehiclePlayerId || !o.vehicle?.enabled || !o.vehicle.aiDriver) continue;
              const bag = nextObjectVariables[o.id] ?? o.variables ?? {};
              const rivalProg = progressOf(
                toNumber(bag.__aiLap ?? 0),
                toNumber(bag.__aiNextCp ?? 0) % cpCountRank,
                o.transform.position[0],
                o.transform.position[2],
              );
              if (rivalProg > playerProg) rank += 1;
            }
            nextVariableValues[posVar.id] = rank;
          }
        }
      }
      recordRuntimeSection('combat', performance.now() - combatStart);

      let allObjects = [...resolvedObjects, ...spawned];
      for (const id of destroyedIds) allObjects = deleteWithChildren(allObjects, id);
      // Drop the one-shot fracture kick now it's been applied, so chunks aren't re-kicked every frame.
      if (kickedChunkIds.size) {
        allObjects = allObjects.map((o) => {
          if (!kickedChunkIds.has(o.id)) return o;
          const { __impulse: _used, ...rest } = o.variables ?? {};
          return { ...o, variables: rest };
        });
      }
      const cinematicEvents: string[] = [];
      const startingCinematic = pendingCinematicId ? { sequenceId: pendingCinematicId, time: 0, firedActionIds: [], spawnedObjectIds: [] } : undefined;
      let nextRuntimeCinematic = startingCinematic ?? state.runtimeCinematic;
      let nextRuntimeCinematicCamera = startingCinematic ? undefined : state.runtimeCinematicCamera;
      let nextRuntimeCinematicFade = startingCinematic ? undefined : state.runtimeCinematicFade;
      let nextRuntimeCinematicLook = startingCinematic ? undefined : state.runtimeCinematicLook;
      let nextRuntimeCinematicText = startingCinematic ? undefined : state.runtimeCinematicText;
      if (nextRuntimeCinematic) {
        const scene = state.scenes.find((item) => item.id === state.activeSceneId);
        const sequence = scene?.cinematics?.find((item) => item.id === nextRuntimeCinematic?.sequenceId);
        if (!sequence) {
          nextRuntimeCinematic = undefined;
          nextRuntimeCinematicCamera = undefined;
          nextRuntimeCinematicFade = undefined;
          nextRuntimeCinematicLook = undefined;
          nextRuntimeCinematicText = undefined;
        } else {
          const prevTime = nextRuntimeCinematic.time;
          const sequenceList = scene?.cinematics ?? [];
          const timeScale = cinematicTimeScaleAt(sequence, prevTime, sequenceList);
          const currentTime = Math.min(sequence.duration, prevTime + delta * timeScale);
          const fired = new Set(nextRuntimeCinematic.firedActionIds);
          const spawnedByCinematic = new Set(nextRuntimeCinematic.spawnedObjectIds);

          nextRuntimeCinematicCamera = cinematicCameraAt(sequence, allObjects, currentTime, nextRuntimeCinematicCamera, sequenceList);
          nextRuntimeCinematicFade = cinematicFadeAt(sequence, currentTime, nextRuntimeCinematicFade, sequenceList);
          nextRuntimeCinematicLook = sequence.look;
          nextRuntimeCinematicText = cinematicTextAt(sequence, currentTime, sequenceList);
          const transformOverrides = cinematicTransformsAt(sequence, allObjects, currentTime, sequenceList);
          const materialOverrides = cinematicMaterialsAt(sequence, allObjects, currentTime, sequenceList);
          if (Object.keys(transformOverrides).length || Object.keys(materialOverrides).length) {
            allObjects = allObjects.map((object) => ({
              ...object,
              transform: transformOverrides[object.id] ?? object.transform,
              renderer:
                object.renderer && materialOverrides[object.id]
                  ? { ...object.renderer, overrideMaterial: true, materialOverrides: { ...object.renderer.materialOverrides, ...materialOverrides[object.id] } }
                  : object.renderer,
            }));
          }

          for (const action of cinematicActionsAt(sequence, sequenceList, currentTime)) {
            const length = Math.max(action.duration ?? 0, 0.001);
            const local = clamp01((currentTime - action.time) / length);
            const active = currentTime >= action.time && currentTime <= action.time + length;
            const shouldFire = !fired.has(action.id) && action.time >= prevTime && action.time <= currentTime;

            if (action.type === 'transform' && active && action.objectId) {
              allObjects = allObjects.map((object) => {
                if (object.id !== action.objectId) return object;
                return {
                  ...object,
                  transform: {
                    position: action.fromPosition && action.toPosition ? mixVec3(action.fromPosition, action.toPosition, local) : action.toPosition ?? action.position ?? object.transform.position,
                    rotation: action.fromRotation && action.toRotation ? mixVec3(action.fromRotation, action.toRotation, local) : action.toRotation ?? action.rotation ?? object.transform.rotation,
                    scale: action.fromScale && action.toScale ? mixVec3(action.fromScale, action.toScale, local) : action.toScale ?? action.scale ?? object.transform.scale,
                  },
                };
              });
            }

            if (!shouldFire) continue;
            fired.add(action.id);
            if (action.type === 'visibility' && action.objectId) {
              if (action.visible === false) nextHidden.add(action.objectId);
              else nextHidden.delete(action.objectId);
            } else if (action.type === 'spawn') {
              if (action.prefabId) {
                const prefab = prefabById.get(action.prefabId);
                if (prefab) {
                  const { objects: clones, rootId } = cloneObjectTree(prefab.objects, prefab.rootId);
                  const root = clones.find((object) => object.id === rootId);
                  if (root && action.position) root.transform.position = action.position;
                  allObjects = [...allObjects, ...clones];
                  for (const clone of clones) spawnedByCinematic.add(clone.id);
                }
              } else {
                const kind = action.spawnKind ?? 'cube';
                const object: SceneObject = {
                  id: makeId('obj'),
                  name: action.name ?? `Cinematic ${kind}`,
                  kind,
                  transform: {
                    position: action.position ?? [0, 1, 0],
                    rotation: action.rotation ?? [0, 0, 0],
                    scale: action.scale ?? [1, 1, 1],
                  },
                  ...objectDefaults[kind],
                  variables: { cinematicOnly: true },
                };
                allObjects.push(object);
                spawnedByCinematic.add(object.id);
              }
            } else if (action.type === 'animation' && action.objectId && action.animationId) {
              animMontages[action.objectId] = { animationId: action.animationId, speed: action.animationSpeed ?? 1 };
            } else if (action.type === 'sound' && action.soundId) {
              pushSound(action.soundId); // cinematic beats are 2D (cutscene-wide, not world-positioned)
            } else if (action.type === 'event' && action.eventName) {
              cinematicEvents.push(action.eventName);
            }
          }

          if (currentTime >= sequence.duration) {
            allObjects = allObjects.filter((object) => !spawnedByCinematic.has(object.id));
            nextRuntimeCinematic = undefined;
            nextRuntimeCinematicCamera = undefined;
            nextRuntimeCinematicFade = undefined;
            nextRuntimeCinematicLook = undefined;
            nextRuntimeCinematicText = undefined;
          } else {
            nextRuntimeCinematic = { ...nextRuntimeCinematic, time: currentTime, firedActionIds: [...fired], spawnedObjectIds: [...spawnedByCinematic] };
          }
        }
      }
      const remainingObjectIds = new Set(allObjects.map((object) => object.id));
      const attachedOwnerIds = new Set(allObjects.map((object) => object.attachment?.targetObjectId).filter(Boolean) as string[]);
      const remainingResolvedObjects = resolvedObjects.filter((object) => remainingObjectIds.has(object.id));
      const remainingResolvedObjectById = fillObjectIdMap(tickRemainingById, remainingResolvedObjects);
      const groundedIdSet = new Set(groundedIds);
      const swimmingIdSet = new Set(swimmingIds);
      const climbingIdSet = new Set(climbingIds);
      // IDENTITY GUARD (perf): when every object survived the tick with the same identity (idle scene —
      // nothing moved, scripted, spawned or despawned), keep the previous scenes array wholesale. This is
      // what stops every selectActiveObjects subscriber + the scene's React reconciliation from churning
      // at 60fps while the world is still.
      const sceneObjectsUnchanged = !pendingEnvironment && keepArray(activeObjects, allObjects) === activeObjects;
      const nextScenes = sceneObjectsUnchanged
        ? state.scenes
        : state.scenes.map((scene) => {
            if (scene.id !== state.activeSceneId) return scene;
            // action.setEnvironment patches accumulated this tick → merge them onto the live scene's
            // environment so a cinematic trigger can crossfade sky/fog/sun in one frame.
            const env = pendingEnvironment && scene.environment
              ? { ...scene.environment, ...pendingEnvironment } as SceneEnvironmentSettings
              : scene.environment;
            return { ...scene, objects: allObjects, ...(env !== scene.environment ? { environment: env } : {}) };
          });
      // Publish this frame's final transforms to the mutable render buffer. SceneObjectView reads
      // them imperatively in useFrame, so moving objects don't reconcile their React subtree each
      // frame (see transformBuffer.ts). The store copy above still drives Inspector/gizmo/save.
      publishTransforms(allObjects);
      // Then swap in the fixed-step physics bodies' SMOOTHED render poses (cars, props, characters) so
      // they don't stutter against the interpolated follow camera. Store/Inspector keep the authoritative
      // transform written above; only the high-frequency render path reads these.
      if (physicsRenderTransforms) publishRenderTransforms(physicsRenderTransforms);

      // --- Animator pass: feed object state into parameters, then run the state machine. ---
      // Runs after physics so "speed"/"verticalSpeed" reflect the object's final motion this frame.
      const animatorStart = performance.now();
      const nextAnimators: Record<string, RuntimeAnimator> = {};
      for (const object of remainingResolvedObjects) {
        const controllerId = object.animator?.enabled ? object.animator.controllerId : undefined;
        if (!controllerId) continue;
        const controller = controllerById.get(controllerId);
        if (!controller || !controller.states.length) continue;
        const { statesById, paramsById, paramsByName, transitionCandidatesByState } = getAnimatorControllerRuntime(controller);

        // A first-person view model (arms/weapon) is pinned to the camera and never moves, and has no
        // character of its own — so its animator sources state from the OWNER pawn (speed, grounded,
        // aim/fire/reload keys, etc.). This is what makes per-weapon arm rigs animate automatically.
        const ownerId = object.viewModel?.ownerObjectId;
        const sourceObj = (ownerId ? remainingResolvedObjectById.get(ownerId) : undefined) ?? object;
        const sourceId = sourceObj.id;

        // Movement this frame (start-of-tick transform vs. final transform) of the source object.
        const before = prevTransforms.get(sourceId);
        const after = sourceObj.transform.position;
        const dt = delta || 1 / 60;
        let horizontalSpeed = 0;
        let verticalSpeed = 0;
        // Local move direction relative to the source's facing (for 2D directional/strafe blend spaces):
        // moveY = forward (−1 back … +1 fwd), moveX = right (−1 left … +1 right); ~0 when idle.
        let moveX = 0;
        let moveY = 0;
        if (before) {
          const dx = after[0] - before.position[0];
          const dy = after[1] - before.position[1];
          const dz = after[2] - before.position[2];
          horizontalSpeed = Math.hypot(dx, dz) / dt;
          verticalSpeed = dy / dt;
          const h = Math.hypot(dx, dz);
          if (h > 1e-4) {
            const facing = sourceObj.transform.rotation[1] - (sourceObj.character?.modelYawOffset ?? 0);
            const wx = dx / h;
            const wz = dz / h;
            moveY = wx * Math.sin(facing) + wz * Math.cos(facing); // forward axis (sin,cos)
            moveX = wx * Math.cos(facing) - wz * Math.sin(facing); // right axis (cos,−sin)
          }
        }

        const prev = state.runtimeAnimators[object.id];
        // Seed parameter values from controller defaults, then carry over the previous frame's values.
        const params: Record<string, number | boolean> = {};
        for (const param of controller.parameters) params[param.id] = param.defaultValue;
        if (prev) for (const [key, value] of Object.entries(prev.params)) if (key in params) params[key] = value;

        // Auto-source parameters (object/world state → animator), then manual script writes.
        for (const param of controller.parameters) {
          if (param.source === 'speed') params[param.id] = horizontalSpeed;
          else if (param.source === 'verticalSpeed') params[param.id] = verticalSpeed;
          else if (param.source === 'moving') params[param.id] = horizontalSpeed > 0.1;
          else if (param.source === 'crouching') params[param.id] = Boolean(sourceObj.character && currentKeys[sourceObj.character.keyCrouch]);
          else if (param.source === 'crawling') params[param.id] = Boolean(sourceObj.character?.keyCrawl && currentKeys[sourceObj.character.keyCrawl]);
          else if (param.source === 'moveX') params[param.id] = moveX;
          else if (param.source === 'moveY') params[param.id] = moveY;
          else if (param.source === 'grounded') params[param.id] = groundedIdSet.has(sourceId);
          else if (param.source === 'swimming') params[param.id] = swimmingIdSet.has(sourceId);
          else if (param.source === 'climbing') params[param.id] = climbingIdSet.has(sourceId);
          else if (param.source === 'mantling') params[param.id] = Boolean(nextMantle[sourceId]);
          else if (param.source === 'turning') params[param.id] = (nextTurnInPlace[sourceId] ?? 0) > 0.05;
          else if (param.source === 'rolling') params[param.id] = (nextRoll[sourceId] ?? 0) > 0;
          else if (param.source === 'sliding') params[param.id] = Boolean(nextSlide[sourceId]);
          else if (param.source === 'landing') params[param.id] = (nextLanding[sourceId] ?? 0) > 0;
          else if (param.source === 'rollX') {
            // Local sideways component of the active dodge (−1 left … +1 right), 0 when not rolling —
            // drives the directional roll blend space (Dodge_Left ↔ Roll ↔ Dodge_Right).
            const rollDir = nextRollDir[sourceId];
            if (rollDir && (nextRoll[sourceId] ?? 0) > 0) {
              const facing = sourceObj.transform.rotation[1] - (sourceObj.character?.modelYawOffset ?? 0);
              params[param.id] = rollDir[0] * Math.cos(facing) - rollDir[1] * Math.sin(facing);
            } else params[param.id] = 0;
          }
          else if (param.source === 'attacking') params[param.id] = (nextAttack[sourceId] ?? 0) > 0;
          else if (param.source === 'aiming') params[param.id] = Boolean(sourceObj.character && currentKeys[sourceObj.character.keyAim]);
          else if (param.source === 'reloading') params[param.id] = (nextReload[sourceId] ?? 0) > 0;
          else if (param.source === 'interacting') params[param.id] = (nextInteract[sourceId] ?? 0) > 0;
          else if (param.source === 'emoting') params[param.id] = Boolean(sourceObj.character && currentKeys[sourceObj.character.keyEmote]);
          else if (param.source === 'weaponEquipped') params[param.id] = attachedOwnerIds.has(sourceId);
          else if (param.source === 'variable' && param.variableId !== undefined) {
            const raw = nextVariableValues[param.variableId];
            params[param.id] = param.type === 'bool' ? toBoolean(raw) : toNumber(raw);
          }
        }
        const triggered = new Set<string>();
        for (const write of animatorWrites[object.id] ?? []) {
          const param = paramsByName.get(write.name);
          if (!param) continue;
          params[param.id] = write.value;
          if (write.trigger) triggered.add(param.id);
        }

        // Current state + how long we've been in it (drives exit-time / one-shot clips like Jump Land).
        let fromStateId = prev?.stateId ?? controller.defaultStateId ?? controller.states[0].id;
        if (!statesById.has(fromStateId)) fromStateId = controller.states[0].id;
        const fromState = statesById.get(fromStateId);
        const fromAnim = fromState?.animationId ? animationById.get(fromState.animationId) : undefined;
        const clipDuration = fromAnim ? fromAnim.duration / Math.max(fromState?.speed ?? 1, 0.01) : 0;
        const timeInState = (prev?.stateId === fromStateId ? prev.time : 0) + dt;

        // Evaluate transitions from the current state (plus "any state" transitions).
        let nextStateId = fromStateId;
        let fade = 0;
        const candidates = transitionCandidatesByState.get(fromStateId) ?? [];
        for (const transition of candidates) {
          if (transition.to === fromStateId) continue;
          if (!statesById.has(transition.to)) continue;
          // Exit time: wait until the current clip has played far enough before leaving.
          if (transition.hasExitTime && timeInState < clipDuration * (transition.exitTime ?? 1)) continue;
          const pass = transition.conditions.every((condition) => {
            const param = paramsById.get(condition.parameterId);
            if (!param) return false;
            return Boolean(compareValues(params[param.id] as GraphValue, condition.value as GraphValue, condition.op));
          });
          if (pass) {
            nextStateId = transition.to;
            fade = transition.duration;
            break;
          }
        }

        // Consume triggers (one-shot) so they don't re-fire next frame.
        for (const id of triggered) {
          const param = paramsById.get(id);
          if (param?.type === 'trigger') params[id] = false;
        }

        // Montage (Play Animation): a fresh request this frame starts a timed clip override; otherwise the
        // previous montage counts down and clears when done. While active it overrides the state-machine clip.
        let montage = prev?.montage && prev.montage.remaining > 0
          ? { ...prev.montage, remaining: prev.montage.remaining - dt }
          : undefined;
        const requested = animMontages[object.id];
        if (requested) {
          const clip = animationById.get(requested.animationId);
          if (clip) montage = { animationId: requested.animationId, speed: requested.speed, remaining: clip.duration / requested.speed };
        }
        if (montage && montage.remaining <= 0) montage = undefined;

        nextAnimators[object.id] = { stateId: nextStateId, params, fade, time: nextStateId === fromStateId ? timeInState : 0, montage };

        // Death → ragdoll: entering a state named like "death"/"dead"/"die" goes limp automatically.
        const nextStateName = statesById.get(nextStateId)?.name ?? '';
        if (/death|dead|\bdie\b/i.test(nextStateName)) setRagdoll(object.id, true);
      }
      recordRuntimeSection('animator', performance.now() - animatorStart);

      // Taking damage this frame jolts the camera (the player's hurt counter rose since last frame).
      if (hurt > state.runtimeHurt) cameraShake = Math.min(1, cameraShake + 0.45);

      // --- Load Scene transition --------------------------------------------------------------------
      // A Load Scene node fired this frame: swap to the target scene now that this tick's work is done.
      // Project variables (score, floor, unlocks) carry over; the scene we leave reverts to pristine; the
      // scene we enter is re-seeded from its authored (clean) state; physics rebuilds for the new world.
      if (pendingSceneId) {
        const targetScene = state.scenes.find((scene) => scene.id === pendingSceneId);
        if (targetScene) {
          const leavingId = state.activeSceneId;
          const snaps = { ...(state.runtimeSceneSnapshots ?? {}) };
          // First visit to the target this session → capture its pristine objects for later revert.
          if (!snaps[targetScene.id]) snaps[targetScene.id] = structuredClone(targetScene.objects);
          const freshObjects = structuredClone(snaps[targetScene.id]);
          // Revert the scene we're leaving back to the clean state it had when first entered.
          const revertedScenes = state.scenes.map((scene) => {
            if (scene.id === targetScene.id) return { ...scene, objects: freshObjects };
            if (scene.id === leavingId && snaps[leavingId]) return { ...scene, objects: structuredClone(snaps[leavingId]) };
            return scene;
          });
          startPhysics();
          clearTransformBuffer();
          clearPerception();
          publishTransforms(freshObjects);
          const autoplay = targetScene.cinematics?.find((cinematic) => cinematic.autoplay);
          return {
            activeSceneId: targetScene.id,
            scenes: revertedScenes,
            runtimeSceneSnapshots: snaps,
            runtimeStarted: false,
            runtimeTime: 0,
            runtimeTimeScale: 1, // a freshly loaded scene starts at normal speed (a pause carried across a load would soft-lock it)
            runtimeVelocities: makeRuntimeVelocityMap(freshObjects),
            // Project variables persist across the load — this is how run state survives a floor change.
            runtimeVariableValues: nextVariableValues,
            runtimeObjectVariables: Object.fromEntries(
              freshObjects.map((object) => [
                object.id,
                seedBlueprintInstanceVars(
                  object.variables,
                  object.script?.blueprintId ? state.blueprints.find((b) => b.id === object.script!.blueprintId) : undefined,
                ),
              ]),
            ),
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
            runtimeEnemyCooldown: {},
            runtimeSurfaceSound: {},
            runtimeMovementMode: {},
            runtimeMontageRequests: {},
            runtimeCollisions: [],
            runtimeCollisionsExit: [],
            runtimeTriggers: [],
            runtimeTriggersExit: [],
            runtimeDamageEvents: {},
            runtimePreviousKeys: {},
            runtimePreviousKeyPresses: { ...currentKeyPresses },
            runtimeEventQueue: [],
            runtimeSoundQueue: sounds.length ? [...state.runtimeSoundQueue, ...sounds] : state.runtimeSoundQueue,
            runtimeVehicleSound: null,
            runtimeLog: prints.length ? [...state.runtimeLog, ...prints].slice(-100) : state.runtimeLog,
            runtimeNodeErrors: nodeErrorsSnapshot(),
            runtimeVisibleUI: Object.fromEntries(
              state.uiDocuments.filter((doc) => doc.surface === 'screen' && doc.visibleOnStart).map((doc) => [doc.id, true]),
            ),
            runtimeUITextOverrides: {},
            runtimeCinematic: autoplay ? { sequenceId: autoplay.id, time: 0, firedActionIds: [], spawnedObjectIds: [] } : undefined,
            runtimeCinematicCamera: undefined,
            runtimeCinematicFade: undefined,
            runtimeCinematicLook: autoplay?.look,
            ...(pendingQuality && pendingQuality !== state.renderSettings.quality
              ? { renderSettings: { ...state.renderSettings, quality: pendingQuality } }
              : {}),
          };
        }
      }

      return {
        runtimeTime,
        // keepRecord/keepArray: hand back the PREVIOUS reference when the fresh-built value is
        // content-identical, so 60fps subscribers only re-render for data that actually changed.
        runtimeVelocities: keepRecord(state.runtimeVelocities, nextVelocities),
        runtimeVariableValues: keepRecord(state.runtimeVariableValues, nextVariableValues),
        runtimeAnimators: keepRecord(state.runtimeAnimators, nextAnimators),
        runtimeCameraOverrides: keepRecord(state.runtimeCameraOverrides, nextCameraOverrides),
        runtimeCameraShake: cameraShake,
        runtimeFlash: flash,
        runtimeFlashColor: flashColor,
        runtimeGrounded: keepArray(state.runtimeGrounded, groundedIds),
        runtimeSwimming: keepArray(state.runtimeSwimming, swimmingIds),
        runtimeInWater: keepArray(state.runtimeInWater, inWaterIds),
        runtimeWaterImpacts: newWaterImpacts.length
          ? [...state.runtimeWaterImpacts, ...newWaterImpacts].slice(-10)
          : state.runtimeWaterImpacts,
        runtimeWaterWake: keepRecord(state.runtimeWaterWake, nextWaterWake),
        runtimeClimbing: keepArray(state.runtimeClimbing, climbingIds),
        runtimeRoll: keepRecord(state.runtimeRoll, nextRoll),
        runtimeLockOn: keepRecord(state.runtimeLockOn, nextLockOn),
        runtimeJumpBuffer: keepRecord(state.runtimeJumpBuffer, nextJumpBuffer),
        runtimeLanding: keepRecord(state.runtimeLanding, nextLanding),
        runtimeSlide: keepRecord(state.runtimeSlide, nextSlide),
        runtimeRollDir: keepRecord(state.runtimeRollDir, nextRollDir),
        runtimeMantle: keepRecord(state.runtimeMantle, nextMantle),
        runtimeTurnInPlace: keepRecord(state.runtimeTurnInPlace, nextTurnInPlace),
        runtimeCoyote: keepRecord(state.runtimeCoyote, nextCoyote),
        runtimeAttack: keepRecord(state.runtimeAttack, nextAttack),
        runtimeReload: keepRecord(state.runtimeReload, nextReload),
        runtimeInteract: keepRecord(state.runtimeInteract, nextInteract),
        runtimeFootstep: keepRecord(state.runtimeFootstep, nextFootstep),
        runtimeCooldowns: keepRecord(state.runtimeCooldowns, nextCooldowns),
        runtimeDelays: keepRecord(state.runtimeDelays, nextDelays),
        runtimeTweens: keepRecord(state.runtimeTweens, nextTweens),
        runtimeActorEvents: keepRecord(state.runtimeActorEvents ?? {}, nextActorEvents),
        runtimeTimers: keepRecord(state.runtimeTimers, nextTimers),
        // Disabled objects are also hidden (no render) via the existing hidden path.
        runtimeHidden: keepArray(state.runtimeHidden, [...new Set([...nextHidden, ...nextDisabled])]),
        runtimeDisabled: keepArray(state.runtimeDisabled, [...nextDisabled]),
        runtimeCutCables: keepArray(state.runtimeCutCables, [...nextCutCables]),
        runtimeCableLength: keepRecord(state.runtimeCableLength, nextCableLength),
        runtimeVehicleOccupants: keepRecord(state.runtimeVehicleOccupants, nextOccupants),
        runtimeInteractFocusId: interactFocusId,
        runtimeHitMarker: hitMarker,
        runtimeKillMarker: killMarker,
        runtimeHurt: hurt,
        runtimeEnemyCooldown: keepRecord(state.runtimeEnemyCooldown, nextEnemyCd),
        runtimeSurfaceSound: keepRecord(state.runtimeSurfaceSound, nextSurfaceSound),
        runtimeMovementMode: keepRecord(state.runtimeMovementMode, movementModeNow),
        runtimeMontageRequests: keepRecord(state.runtimeMontageRequests, {}),
        runtimeCollisions: keepArray(state.runtimeCollisions, collisions),
        runtimeCollisionsExit: keepArray(state.runtimeCollisionsExit, collisionsExit),
        runtimeTriggers: keepArray(state.runtimeTriggers, triggers),
        runtimeTriggersExit: keepArray(state.runtimeTriggersExit, triggersExit),
        runtimeDamageEvents: keepRecord(state.runtimeDamageEvents, damageThisFrame),
        runtimePreviousKeys: keepRecord(state.runtimePreviousKeys, { ...currentKeys }),
        runtimePreviousKeyPresses: keepRecord(state.runtimePreviousKeyPresses, { ...currentKeyPresses }),
        runtimeEventPayloads: keepRecord(state.runtimeEventPayloads ?? {}, eventPayloads),
        runtimeEventQueue: cinematicEvents,
        runtimeStarted: true,
        runtimeSoundQueue: sounds.length ? [...state.runtimeSoundQueue, ...sounds] : state.runtimeSoundQueue,
        runtimeVehicleSound: nextVehicleSound,
        runtimeLog: prints.length ? [...state.runtimeLog, ...prints].slice(-100) : state.runtimeLog,
        runtimeNodeErrors: nodeErrorsSnapshot(),
        runtimeObjectVariables: nextObjectVariables,
        runtimeVisibleUI: keepRecord(state.runtimeVisibleUI, nextVisibleUI),
        runtimeUITextOverrides: keepRecord(state.runtimeUITextOverrides, nextUITextOverrides),
        runtimeCinematic: nextRuntimeCinematic,
        runtimeCinematicCamera: nextRuntimeCinematicCamera,
        runtimeCinematicFade: nextRuntimeCinematicFade,
        runtimeCinematicLook: nextRuntimeCinematicLook,
        runtimeCinematicText: nextRuntimeCinematicText,
        scenes: nextScenes,
        // A Set Quality node fired → update the project's render settings (no isDirty: tickRuntime never dirties).
        ...(pendingQuality && pendingQuality !== state.renderSettings.quality
          ? { renderSettings: { ...state.renderSettings, quality: pendingQuality } }
          : {}),
        // A Set Time Scale node fired → the next tick runs at the new speed (0 = paused; see tick entry).
        ...(pendingTimeScale !== undefined && pendingTimeScale !== state.runtimeTimeScale
          ? { runtimeTimeScale: pendingTimeScale }
          : {}),
      };
    }),
  onNodesChange: (changes) =>
    set((state) => {
      const activeBlueprint = state.blueprints.find((item) => item.id === state.activeBlueprintId);
      if (!activeBlueprint) return state;
      // Selection changes ARE applied (multi-select + marquee copy/paste need the `selected` flags on the
      // nodes), but they never mark the project dirty — only real structural edits do. Dimension changes
      // are measurement noise EXCEPT a user-driven resize (comment frames via NodeResizer), which must
      // persist + dirty.
      const structuralChanges = changes.filter(
        (change) => change.type !== 'dimensions' || ('resizing' in change && change.resizing === true),
      );
      if (structuralChanges.length === 0) return state;
      const dirtied = changes.some(
        (change) => change.type !== 'select' && (change.type !== 'dimensions' || ('resizing' in change && change.resizing === true)),
      );
      return {
        graphs: state.graphs.map((graph) =>
          graph.id === activeBlueprint.graphId ? { ...graph, nodes: applyNodeChanges(structuralChanges, graph.nodes) } : graph,
        ),
        ...(dirtied ? { isDirty: true } : {}),
      };
    }),
  onEdgesChange: (changes) =>
    set((state) => {
      const activeBlueprint = state.blueprints.find((item) => item.id === state.activeBlueprintId);
      if (!activeBlueprint) return state;
      const dirtied = changes.some((change) => change.type !== 'select');
      return {
        graphs: state.graphs.map((graph) =>
          graph.id === activeBlueprint.graphId ? { ...graph, edges: applyEdgeChanges(changes, graph.edges) } : graph,
        ),
        ...(dirtied ? { isDirty: true } : {}),
      };
    }),
  onConnect: (connection) =>
    set((state) => {
      const activeBlueprint = state.blueprints.find((item) => item.id === state.activeBlueprintId);
      if (!activeBlueprint) return state;
      const isValueEdge = Boolean(connection.targetHandle && connection.targetHandle !== 'exec-in');
      return {
        graphs: state.graphs.map((graph) =>
          graph.id === activeBlueprint.graphId
            ? {
                ...graph,
                edges: addEdge(
                  {
                    ...connection,
                    animated: !isValueEdge,
                    type: 'smoothstep',
                    style: isValueEdge ? { stroke: '#3DD0DC', strokeWidth: 2 } : undefined,
                  },
                  graph.edges,
                ),
              }
            : graph,
        ),
        isDirty: true,
      };
    }),
  addGraphNode: (label, category) =>
    set((state) => {
      const activeBlueprint = state.blueprints.find((item) => item.id === state.activeBlueprintId);
      if (!activeBlueprint) return state;
      let selectedGraphNodeId = state.selectedGraphNodeId;
      return {
        graphs: state.graphs.map((graph) => {
          if (graph.id !== activeBlueprint.graphId) return graph;
          const offset = graph.nodes.length * 38;
          const node: NodeForgeNode = {
            id: makeId('node'),
            type: 'nodeforge',
            position: { x: 80 + (offset % 560), y: 220 + Math.floor(offset / 560) * 112 },
            data: makeNodeData(label, category, seedNodeDataFromProject(label, undefined, state.variables, state.dataAssets)),
          };
          selectedGraphNodeId = node.id;
          return { ...graph, nodes: [...graph.nodes, node] };
        }),
        selectedGraphNodeId,
        isDirty: true,
      };
    }),
  exportProject: () => {
    const state = get();
    return {
      version: PROJECT_VERSION,
      name: 'Untitled Project',
      savedAt: new Date().toISOString(),
      // Exclude the transient prefab-editing scene; fall back active id to a real scene if needed.
      activeSceneId:
        state.activeSceneId === PREFAB_EDIT_SCENE_ID
          ? state.prefabReturnSceneId ??
            state.scenes.find((scene) => scene.id !== PREFAB_EDIT_SCENE_ID)?.id ??
            state.activeSceneId
          : state.activeSceneId,
      scenes: state.scenes.filter((scene) => scene.id !== PREFAB_EDIT_SCENE_ID),
      assets: state.assets.map(({ url: _url, ...asset }) => asset),
      folders: state.folders,
      variables: state.variables,
      dataAssets: state.dataAssets,
      materials: state.materials ?? [],
      skeletons: state.skeletons ?? [],
      skeletalMeshes: state.skeletalMeshes ?? [],
      animations: state.animations ?? [],
      animatorControllers: state.animatorControllers ?? [],
      uiDocuments: state.uiDocuments ?? [],
      particleSystems: state.particleSystems ?? [],
      blueprints: state.blueprints,
      graphs: state.graphs,
      prefabs: state.prefabs ?? [],
      renderSettings: state.renderSettings,
    };
  },
  loadProject: (project) =>
    set(() => {
      // Scope game-save slots to this game (the standalone player loads through here too).
      setSaveNamespace(project.name ?? 'project');
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
      const activeSceneId = scenes.some((scene) => scene.id === project.activeSceneId)
        ? project.activeSceneId
        : scenes[0].id;
      const activeScene = scenes.find((scene) => scene.id === activeSceneId)!;

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
      const normalizedGraphs = graphs.filter((graph) => referencedGraphIds.has(graph.id));

      return {
        scenes,
        activeSceneId,
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
        runtimeDamageEvents: {},
        runtimeSoundQueue: [],
        runtimeVehicleSound: null,
        runtimeLog: [],
        runtimeNodeErrors: {},
        runtimeVisibleUI: {},
        runtimeObjectVariables: {},
        runtimeUITextOverrides: {},
        runtimeCinematic: undefined,
        runtimeCinematicCamera: undefined,
        runtimeCinematicFade: undefined,
        editorCinematicPreview: undefined,
        editorCinematicPreviewCamera: undefined,
        editorCinematicPreviewFade: undefined,
        editorCinematicPreviewTransforms: {},
        editorCinematicPreviewHidden: [],
        editorCinematicPreviewMaterials: {},
        runtimeTriggers: [],
        runtimeTriggersExit: [],
        runtimeStarted: false,
        runtimeTime: 0,
        isDirty: false,
      };
    }),
  markClean: () => set({ isDirty: false }),

  buildPrefabPackage: (prefabId) => {
    const state = get();
    const src: PackageSource = {
      prefabs: state.prefabs,
      blueprints: state.blueprints,
      graphs: state.graphs,
      materials: state.materials,
      particleSystems: state.particleSystems,
      skeletons: state.skeletons,
      skeletalMeshes: state.skeletalMeshes,
      animations: state.animations,
      animatorControllers: state.animatorControllers,
      dataAssets: state.dataAssets,
      uiDocuments: state.uiDocuments,
      variables: state.variables,
      assets: state.assets,
    };
    return collectPrefabPackage(src, prefabId);
  },

  buildFolderPackage: (folderId) => {
    const state = get();
    const folder = state.folders.find((f) => f.id === folderId);
    if (!folder) return null;
    // The folder + every folder nested under it (an asset's folderId points at exactly one of these).
    const folderIds = new Set<string>([folderId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const f of state.folders) {
        if (f.parentId && folderIds.has(f.parentId) && !folderIds.has(f.id)) {
          folderIds.add(f.id);
          grew = true;
        }
      }
    }
    const inFolder = <T extends { id: string; folderId?: string }>(arr: T[]) =>
      arr.filter((item) => item.folderId && folderIds.has(item.folderId)).map((item) => item.id);
    const seeds: PackageSeeds = {
      prefabs: inFolder(state.prefabs),
      blueprints: inFolder(state.blueprints),
      materials: inFolder(state.materials),
      particleSystems: inFolder(state.particleSystems),
      animatorControllers: inFolder(state.animatorControllers),
      dataAssets: inFolder(state.dataAssets),
      uiDocuments: inFolder(state.uiDocuments),
      assets: inFolder(state.assets),
    };
    if (!Object.values(seeds).some((list) => list && list.length)) return null;
    const src: PackageSource = {
      prefabs: state.prefabs,
      blueprints: state.blueprints,
      graphs: state.graphs,
      materials: state.materials,
      particleSystems: state.particleSystems,
      skeletons: state.skeletons,
      skeletalMeshes: state.skeletalMeshes,
      animations: state.animations,
      animatorControllers: state.animatorControllers,
      dataAssets: state.dataAssets,
      uiDocuments: state.uiDocuments,
      variables: state.variables,
      assets: state.assets,
    };
    return { ...collectPackage(src, seeds), name: folder.name };
  },

  mergePackage: (content, assets) =>
    set((state) => ({
      // Everything was re-id'd on import, so a plain append can't collide with existing content.
      assets: [...state.assets, ...assets],
      prefabs: [...state.prefabs, ...content.prefabs],
      blueprints: [...state.blueprints, ...content.blueprints],
      graphs: [...state.graphs, ...content.graphs],
      materials: [...state.materials, ...content.materials],
      particleSystems: [...state.particleSystems, ...content.particleSystems],
      skeletons: [...state.skeletons, ...content.skeletons],
      skeletalMeshes: [...state.skeletalMeshes, ...content.skeletalMeshes],
      animations: [...state.animations, ...content.animations],
      animatorControllers: [...state.animatorControllers, ...content.animatorControllers],
      dataAssets: [...state.dataAssets, ...content.dataAssets],
      uiDocuments: [...state.uiDocuments, ...content.uiDocuments],
      variables: [...state.variables, ...content.variables],
      prefabThumbnailQueue: [...state.prefabThumbnailQueue, ...content.prefabs.map((p) => p.id)],
      isDirty: true,
    })),
}));
