import type { Edge } from '@xyflow/react';
import { makeNodeData } from './graph';
import { defaultRenderer, defaultCharacter } from './defaults';
import { makeId } from './ids';
import type { EditorState } from '../editorStore';
import type {
  AnimatorCondition,
  AnimatorController,
  AnimatorParameter,
  AnimatorState,
  AnimatorTransition,
  GraphNodeCategory,
  NodeForgeNode,
  NodeForgeNodeData,
  ProjectGraph,
  SceneObject,
  ScriptBlueprint,
} from '../../types';

export interface CharacterPawnResult {
  controller: AnimatorController;
  blueprint: ScriptBlueprint;
  presetGraph: ProjectGraph;
  pawn: SceneObject;
}

export const buildCharacterPawn = (
  state: EditorState,
  modelAssetId: string,
  name?: string,
): CharacterPawnResult | undefined => {
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

  return { controller, blueprint, presetGraph, pawn };
};
