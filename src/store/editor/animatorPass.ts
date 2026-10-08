import type { EditorState } from '../editorStore';
import type { AnimationAsset, AnimatorController, CompareOperator, GraphValue, SceneObject, Vector3Tuple } from '../../types';
import { setRagdoll } from '../../runtime/ragdollState';
import { getAnimatorControllerRuntime, localMoveVector, resolveLayerWeight, stepStateMachine } from './animatorRuntime';
import type { RuntimeAnimator } from './defaults';
import { compareValues, toBoolean, toNumber } from './objectFactory';

interface AnimatorPassContext {
  remainingResolvedObjects: readonly SceneObject[];
  remainingResolvedObjectById: ReadonlyMap<string, SceneObject>;
  controllerById: ReadonlyMap<string, AnimatorController>;
  animationById: ReadonlyMap<string, AnimationAsset>;
  prevTransforms: ReadonlyMap<string, { position: Vector3Tuple; rotation: Vector3Tuple }>;
  previousAnimators: EditorState['runtimeAnimators'];
  delta: number;
  desiredSpeedById: Record<string, number>;
  currentKeys: EditorState['runtimeKeys'];
  groundedIdSet: ReadonlySet<string>;
  swimmingIdSet: ReadonlySet<string>;
  climbingIdSet: ReadonlySet<string>;
  attachedOwnerIds: ReadonlySet<string>;
  nextMantle: EditorState['runtimeMantle'];
  nextTurnInPlace: EditorState['runtimeTurnInPlace'];
  nextRoll: EditorState['runtimeRoll'];
  nextSlide: EditorState['runtimeSlide'];
  nextLanding: EditorState['runtimeLanding'];
  nextRollDir: EditorState['runtimeRollDir'];
  nextAttack: EditorState['runtimeAttack'];
  nextReload: EditorState['runtimeReload'];
  nextInteract: EditorState['runtimeInteract'];
  nextVariableValues: EditorState['runtimeVariableValues'];
  animatorWrites: Record<string, Array<{ name: string; value: number | boolean; trigger?: boolean }>>;
  animMontages: EditorState['runtimeMontageRequests'];
}

/** Run after physics: animator sources read final poses, owner motion and this tick's script writes. */
export function runAnimatorPass({
  remainingResolvedObjects, remainingResolvedObjectById, controllerById, animationById, prevTransforms,
  delta, desiredSpeedById, currentKeys,
  groundedIdSet, swimmingIdSet, climbingIdSet, attachedOwnerIds,
  nextMantle, nextTurnInPlace, nextRoll, nextSlide, nextLanding, nextRollDir,
  nextAttack, nextReload, nextInteract, nextVariableValues, animatorWrites, animMontages, previousAnimators,
}: AnimatorPassContext): Record<string, RuntimeAnimator> {
  const nextAnimators: Record<string, RuntimeAnimator> = {};
  for (const object of remainingResolvedObjects) {
    const controllerId = object.animator?.enabled ? object.animator.controllerId : undefined;
    if (!controllerId) continue;
    const controller = controllerById.get(controllerId);
    if (!controller || !controller.states.length) continue;
    const { statesById, paramsById, paramsByName, transitionCandidatesByState, layerTransitionCandidates } =
      getAnimatorControllerRuntime(controller);

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
      const facing = sourceObj.transform.rotation[1] - (sourceObj.character?.modelYawOffset ?? 0);
      // Scaled by speed relative to the character's own move speed, so the blend point travels out
      // from the origin as it accelerates instead of snapping to the rim (see localMoveVector).
      ({ moveX, moveY } = localMoveVector(dx, dz, facing, horizontalSpeed, sourceObj.character?.moveSpeed ?? 0));
    }

    const prev = previousAnimators[object.id];
    // Seed parameter values from controller defaults, then carry over the previous frame's values.
    const params: Record<string, number | boolean> = {};
    for (const param of controller.parameters) params[param.id] = param.defaultValue;
    if (prev) for (const [key, value] of Object.entries(prev.params)) if (key in params) params[key] = value;

    // Auto-source parameters (object/world state → animator), then manual script writes.
    for (const param of controller.parameters) {
      if (param.source === 'speed') params[param.id] = horizontalSpeed;
      // Desired speed rather than measured — the source to blend on when root motion is applied.
      else if (param.source === 'inputSpeed') params[param.id] = desiredSpeedById[sourceId] ?? 0;
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

    // Base state machine. The same evaluator runs every animation layer below, so a layer is not a
    // special case — it is another instance of these rules.
    const durationOf = (id: string) => animationById.get(id)?.duration;
    const compare = (left: number | boolean, right: number | boolean, op: CompareOperator) =>
      Boolean(compareValues(left as GraphValue, right as GraphValue, op));
    const baseStep = stepStateMachine({
      states: controller.states,
      transitionCandidatesByState,
      defaultStateId: controller.defaultStateId,
      prev: prev ? { stateId: prev.stateId, fade: prev.fade, time: prev.time } : undefined,
      dt,
      params,
      paramsById,
      durationOf,
      compare,
    });
    const nextStateId = baseStep.stateId;
    const fade = baseStep.fade;

    // Animation layers: each runs its own state machine over the SHARED parameters, so one
    // `isAiming` drives the base and every layer alike. Evaluated after the base so a layer can
    // react to the same frame's parameter values.
    let layerSteps: RuntimeAnimator['layers'];
    for (const layer of controller.layers ?? []) {
      if (!layer.states.length) continue;
      const step = stepStateMachine({
        states: layer.states,
        transitionCandidatesByState: layerTransitionCandidates.get(layer.id) ?? new Map(),
        defaultStateId: layer.defaultStateId,
        prev: prev?.layers?.[layer.id],
        dt,
        params,
        paramsById,
        durationOf,
        compare,
      });
      if (!step.stateId) continue;
      layerSteps ??= {};
      layerSteps[layer.id] = { ...step, weight: resolveLayerWeight(layer, params) };
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

    nextAnimators[object.id] = { stateId: nextStateId, params, fade, time: baseStep.time, montage, layers: layerSteps };

    // Death → ragdoll: entering a state named like "death"/"dead"/"die" goes limp automatically.
    const nextStateName = statesById.get(nextStateId)?.name ?? '';
    if (/death|dead|\bdie\b/i.test(nextStateName)) setRagdoll(object.id, true);
  }
  return nextAnimators;
}
