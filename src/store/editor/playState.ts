import type { EditorState } from '../editorStore';

import {
  effectLife,
  resetNavCache,
  resetStreamingCache,
  selectActiveObjects,
} from './storeHelpers';
import { clearImpactAudioCooldown, clearNodeErrors, detachedParts, pendingPartKicks, pendingPartRestores, prevTransformEntryPool, resetReportedScriptErrors, resetStartedScriptObjects } from './tickState';
import { initialCinematicCamera, initialCinematicFade } from './cinematics';
import { makeRuntimeVariableMap, makeRuntimeVelocityMap, seedBlueprintInstanceVars } from './objectFactory';
import { scanBlueprintGraphProblems } from './graphDiagnostics';
import { startPhysics, stopPhysics } from '../../runtime/physicsWorld';
import { clearTransformBuffer } from '../../runtime/transformBuffer';
import { clearReplayRecorder, resetReplayRecorder } from '../../runtime/replayRecorder';
import { clearPerception } from '../../runtime/aiPerception';
import { clearVehicleDents } from '../../runtime/vehicleDamageBus';
import { clearExplosions } from '../../runtime/explosionBus';
import { clearDecals } from '../../runtime/decalBus';
import { clearFoliageInteractors } from '../../three/foliageInteractors';
import { clearTreeChops } from '../../runtime/treeChop';
import { canUseHostOnlyFeatures } from '../../collaboration/access';

/** Full Play / Stop state transition for the editor store. Mirrors the previous inline action body. */
export const applySetPlaying = (
  state: EditorState,
  isPlaying: boolean,
): Partial<EditorState> | EditorState => {

      if (isPlaying === state.isPlaying) return state;
      if (isPlaying && !canUseHostOnlyFeatures()) return state;
      // Play runs the game scene, not a prefab being edited — block it while the prefab editor is open.
      if (isPlaying && state.editingPrefabId) return state;
      // Fresh run = fresh error reporting: a script fixed since the last run should report again.
      resetReportedScriptErrors();
      resetStartedScriptObjects();
      clearImpactAudioCooldown();
      clearNodeErrors();
      if (isPlaying) {
        const objects = selectActiveObjects(state);
        const autoplay = state.scenes.find((scene) => scene.id === state.activeSceneId)?.cinematics?.find((cinematic) => cinematic.autoplay);
        // Spin up a fresh Rapier world to own the simulation for this play session.
        startPhysics();
        clearTransformBuffer();
        resetReplayRecorder(objects); // fix the replay slot table + clear the ring for this run
        clearPerception();
        clearVehicleDents(); // start each run with a pristine (undented) car
        effectLife.clear(); // drop any stale burst-lifetime entries from the previous run
        prevTransformEntryPool.clear();
        detachedParts.clear();
        pendingPartKicks.clear();
        pendingPartRestores.clear();
        resetNavCache(); // rebake the Move To navmesh from this run's static colliders
        resetStreamingCache(); // fresh activation-streaming set for this run
        const scriptIssues: string[] = [];
        for (const blueprint of state.blueprints) {
          const graph = state.graphs.find((item) => item.id === blueprint.graphId);
          if (!graph) continue;
          const attached = objects.some((object) => object.script?.blueprintId === blueprint.id);
          if (!attached) continue;
          for (const problem of scanBlueprintGraphProblems(blueprint, graph, state.variables)) {
            if (problem.severity === 'error') scriptIssues.push(`⚠️ ${problem.message}`);
          }
        }
        return {
          isPlaying,
          isPlayPaused: false,
          playStepFrames: 0,
          runtimeTime: 0,
          runtimeTimeScale: 1,
          replayPlayback: null,
          runtimeVelocities: makeRuntimeVelocityMap(objects),
          runtimeAngularVelocities: {},
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
          runtimeMeleeCombo: {},
          runtimeMeleeBuffer: {},
          runtimeHitstop: 0,
          runtimeDayCycleTime: state.scenes.find((s) => s.id === state.activeSceneId)?.environment?.dayCycleTime ?? 0.35,
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
          runtimeLog: scriptIssues.slice(-100),
          runtimeNodeErrors: {},
          runtimeBreakNodeId: null,
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
          runtimeUIVisibleOverrides: {},
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
      clearDecals();
      clearTransformBuffer();
      clearReplayRecorder(); // drop the replay ring + any active clip
      clearPerception();
      clearVehicleDents();
      clearFoliageInteractors(); // grass stops parting once the actors are gone
      clearTreeChops(); // felled trees stand back up with the rest of the Play snapshot
      return {
        isPlaying,
        isPlayPaused: false,
        playStepFrames: 0,
        runtimeTime: 0,
        runtimeTimeScale: 1,
        replayPlayback: null,
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
        runtimeStarted: false,
        scenes,
        activeSceneId: restoredActiveSceneId,
        playSnapshot: undefined,
        runtimeSceneSnapshots: undefined,
      };
};
