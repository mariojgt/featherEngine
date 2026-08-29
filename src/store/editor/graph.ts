import type { Edge } from '@xyflow/react';
import type {
  DataAsset,
  GraphNodeCategory,
  GraphNodeKind,
  GraphNodeTone,
  GraphValue,
  GraphValueType,
  NodeForgeNode,
  NodeForgeNodeData,
  ProjectGraph,
  ProjectVariable,
  Vector3Tuple,
} from '../../types';

import { makeId } from './ids';
import { keyLabelByCode } from '../../utils/keyboardCodes';
import { normalizeTimelineCurve, timelineCurvePreset } from '../../runtime/timelineCurve';
import { valueProducerKinds } from './wireTypes';

export const defaultValueForType = (type: GraphValueType): GraphValue => {
  if (type === 'number') return 0;
  if (type === 'string') return '';
  if (type === 'boolean') return false;
  return [0, 0, 0];
};

export const valueTypeOf = (value: GraphValue): GraphValueType => {
  if (Array.isArray(value)) return 'vector3';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'string';
};

export const cloneGraphValue = (value: GraphValue): GraphValue =>
  Array.isArray(value) ? ([value[0], value[1], value[2]] as Vector3Tuple) : value;

export const coerceGraphValue = (value: unknown, type: GraphValueType): GraphValue => {
  if (type === 'number') {
    const next = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(next) ? next : 0;
  }
  if (type === 'string') return value === undefined || value === null ? '' : String(value);
  if (type === 'boolean') {
    if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
    return Boolean(value);
  }
  if (Array.isArray(value)) {
    return [Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0] as Vector3Tuple;
  }
  return [0, 0, 0];
};

export const nodeToneByCategory: Record<GraphNodeCategory, GraphNodeTone> = {
  Events: 'event',
  Logic: 'logic',
  Math: 'math',
  Runtime: 'runtime',
  Physics: 'physics',
  Audio: 'audio',
  Values: 'value',
  Variables: 'variable',
  Data: 'data',
  Persistence: 'persistence',
  Material: 'material',
  UI: 'ui',
};

export const nodeDescriptions: Record<string, string> = {
  Start: 'Runs once when the Blueprint starts.',
  Update: 'Runs every preview frame while Play is active.',
  'Key Down: W': 'Checks for a forward input event.',
  'Translate Z -1': 'Moves the attached object forward.',
  'Key Down': 'Fires when a key is pressed.',
  'Key Up': 'Fires when a key is released.',
  'Custom Event': 'A reusable entry point that can be fired by name.',
  'Fire Event': 'Triggers a custom event by name.',
  'Collision Enter': 'Fires when this object starts touching another collider. Value outs: Other, Normal, Point, Speed.',
  'Collision Exit': 'Fires when this object stops touching a solid collider. Value outs: Other, Point.',
  'Collision Stay': 'Fires EVERY frame this object is resting against a solid collider. Value out: Other.',
  'Trigger Enter': 'Fires when this object starts overlapping a trigger collider. Value outs: Other, Point.',
  'Trigger Exit': 'Fires when this object stops overlapping a trigger collider. Value outs: Other, Point.',
  'Trigger Stay': 'Fires EVERY frame this object is inside a trigger volume. Value out: Other.',
  'On Land': 'Fires when a character lands after falling. Value out: Speed (impact speed, u/s).',
  Branch: 'Chooses a path from a boolean value.',
  Compare: 'Compares two values.',
  AND: 'Requires both inputs to be true.',
  OR: 'Requires either input to be true.',
  Add: 'Adds two numeric values.',
  Clamp: 'Keeps a value within a range.',
  Lerp: 'Interpolates between two values.',
  Number: 'Outputs a numeric literal.',
  String: 'Outputs a text literal.',
  Boolean: 'Outputs a true or false value.',
  Vector3: 'Stores an X, Y, Z vector.',
  'Get Variable': 'Outputs the current value of a project variable.',
  'Set Variable': 'Writes a value into a project variable.',
  'Data Asset Lookup': 'Reads a typed value from a Data Asset row.',
  'Table Lookup': 'Reads a typed value from a legacy table row.',
  'Material Output': 'Final surface — wire inputs to override the material\'s base fields.',
  Color: 'Outputs a constant color.',
  Scalar: 'Outputs a constant number.',
  Texture: 'Outputs an image texture (feed Base Color or Normal).',
  Mix: 'Blends two colors by a 0-1 factor.',
  Multiply: 'Multiplies two numbers, two colors, or a color by a scalar.',
  'Add (Material)': 'Adds two numbers or two colors.',
  'Clamp (Material)': 'Clamps a number to a min/max range.',
  'Get Material Color': "Reads this object's current material color at runtime.",
  'Get Material Property': "Reads this object's current metalness/roughness/glow at runtime.",
  Translate: 'Moves the attached object.',
  Rotate: 'Rotates the attached object.',
  'Apply Force': 'Adds force to a rigid body.',
  'Set Physics': 'Enables, disables, or configures a target physics body at runtime.',
  'Spawn Object': 'Creates an object instance.',
  'Destroy Object': 'Removes an object during Play.',
  'Play Sound': 'Plays an audio source (optional Volume / Pitch / pitch jitter).',
  'Screen Fade': 'Fades the viewport to a color over a duration. Done fires when the fade settles.',
  'Play Cinematic': 'Starts a Film Mode cinematic sequence.',
  'Set Material Color': 'Changes the attached object\'s material color at runtime (per-object).',
  'Set Material Property': 'Sets a numeric material property (metalness/roughness/glow) at runtime (per-object).',
  Timeline: 'Animates a transform with an editable runtime curve, in local or world space.',
  'Timeline Control': 'Plays, restarts, reverses, or stops a named Timeline on this Blueprint instance.',
  'Set Anim Float': 'Writes a float into the object\'s animator parameter (e.g. Speed) to drive its state machine.',
  'Set Anim Bool': 'Writes a true/false into the object\'s animator parameter.',
  'Set Anim Trigger': 'Fires a one-shot animator trigger (e.g. Jump, Attack) consumed by a transition.',
  'Get Anim Param': 'Reads the current value of an animator parameter (float/bool) back into the blueprint.',
  'Get Anim State': 'Outputs the name of the animator\'s currently-active state, for the blueprint to react to.',
  'Get Move Input': 'Outputs a world-space move direction (Vector3) from WASD / arrow keys.',
  'Get Drive Input': 'Outputs [throttle, steer, handbrake] (Vector3) from the vehicle keys (W/S throttle, A/D steer, Space handbrake).',
  'Get Vehicle Speed': 'Outputs the owning Vehicle\'s current speed (units/sec) — for speedometers, gear logic, or speed-gated effects.',
  'Apply Force at Point': 'Applies an impulse at a LOCAL point on the target body — an off-center push that also spins it (car flips, catapults, thrusters).',
  'Get Speed': 'Outputs the target\'s current linear speed (units/sec) — the magnitude of its Get Velocity vector.',
  Move: 'Moves the owner along the ground by a direction vector at a speed, turning it to face travel.',
  Drive: 'Drives the owning Vehicle from a [throttle, steer, handbrake] vector — the Vehicle controller handles physics, suspension + terrain.',
  Jump: 'Makes the owning character jump (needs a Character Controller for height/gravity).',
  'Is Grounded': 'Outputs true when the owning character is on the ground.',
  'Set Camera': 'Overrides the follow-camera distance/height at runtime.',
  'Save Game': 'Writes persistent variables into local save storage (saves ALL project variables when none are flagged persistent).',
  'Load Game': 'Restores persistent variables from local save storage.',
  'Has Save': 'Outputs true when the save slot holds data — gate a "Continue" button or skip an intro.',
  'Set Time Scale': 'Sets global game speed: 1 = normal, 0 = paused (input/UI keep running), 0.2 = slow-mo.',
  'Get Time Of Day': 'Outputs the active scene\'s normalized time of day (0–1): 0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset. Follows the day cycle during Play.',
  'Set Time Of Day': 'Sets normalized time of day (0–1) and optionally enables the day cycle. Drives sun/sky when Day Cycle is on.',
  'Start Replay': 'Plays an instant replay of the last few seconds (freezes the sim, glides the meshes through the recorded motion). Wire the seconds into the node or set it; great on a goal/kill/crash event.',
  'Clear Save': 'Deletes a local save slot.',
  Print: 'Logs a message to the on-screen console during Play.',
  'Set Quality': 'Sets the game quality preset (Low/Medium/High/Epic) at runtime — adjusts resolution, shadows, and post-FX.',
  'Show UI': 'Shows a screen UI document (HUD) during Play.',
  'Hide UI': 'Hides a screen UI document during Play.',
  'Toggle UI': 'Toggles a screen UI document visible ↔ hidden.',
  'Set UI Text': "Overrides a UI element's text at runtime (wire a value into Text).",
  'Set UI Visible': "Shows or hides one UI element inside a document (wire Visible, or set the checkbox).",
};

export const nodeKindByLabel: Record<string, GraphNodeKind> = {
  Start: 'event.start',
  Update: 'event.update',
  'Key Down': 'event.keyDown',
  'Key Down: W': 'event.keyDown',
  'Key Up': 'event.keyUp',
  'Custom Event': 'event.custom',
  'Collision Enter': 'event.collisionEnter',
  'Collision Exit': 'event.collisionExit',
  'Collision Stay': 'event.collisionStay',
  'Trigger Enter': 'event.triggerEnter',
  'Trigger Exit': 'event.triggerExit',
  'Trigger Stay': 'event.triggerStay',
  Interact: 'event.interact',
  'On Land': 'event.land',
  'On Receive Damage': 'event.receiveDamage',
  Timer: 'event.timer',
  Branch: 'logic.branch',
  Compare: 'logic.compare',
  AND: 'logic.and',
  OR: 'logic.or',
  Cast: 'logic.cast',
  'For Loop': 'logic.forLoop',
  'For Each Actor': 'logic.forEachActor',
  NOT: 'logic.not',
  'Do Once': 'logic.doOnce',
  Delay: 'logic.delay',
  Function: 'event.functionEntry',
  'Call Function': 'logic.callFunction',
  Return: 'logic.functionReturn',
  Switch: 'logic.switch',
  Sequence: 'logic.sequence',
  'Flip Flop': 'logic.flipFlop',
  Select: 'logic.select',
  Comment: 'comment.note',
  Abs: 'math.abs',
  Min: 'math.min',
  Max: 'math.max',
  Round: 'math.round',
  Power: 'math.power',
  Sin: 'math.sin',
  Cos: 'math.cos',
  Append: 'string.append',
  Add: 'math.add',
  Subtract: 'math.subtract',
  Multiply: 'math.multiply',
  Divide: 'math.divide',
  Modulo: 'math.modulo',
  Clamp: 'math.clamp',
  Lerp: 'math.lerp',
  Distance: 'math.distance',
  'Add Vectors': 'math.vectorAdd',
  'Subtract Vectors': 'math.vectorSubtract',
  'Scale Vector': 'math.vectorScale',
  Normalize: 'math.normalize',
  'Make Vector3': 'math.makeVector',
  'Map Range': 'math.mapRange',
  Floor: 'math.floor',
  'Vector Length': 'math.vectorLength',
  'Dot Product': 'math.dot',
  Number: 'value.number',
  Random: 'value.random',
  String: 'value.string',
  Boolean: 'value.boolean',
  Vector3: 'value.vector3',
  'Get Variable': 'variable.get',
  'Set Variable': 'variable.set',
  'Data Asset Lookup': 'data.tableGet',
  'Table Lookup': 'data.tableGet',
  Translate: 'action.translate',
  'Translate Z -1': 'action.translate',
  Rotate: 'action.rotate',
  'Apply Force': 'action.applyForce',
  'Apply Impulse': 'action.applyImpulse',
  'Apply Force at Point': 'action.applyForceAtPoint',
  'Set Physics': 'action.setPhysics',
  'Set Velocity': 'action.setVelocity',
  'Get Velocity': 'query.velocity',
  'Get Speed': 'query.getSpeed',
  'Set Angular Velocity': 'action.setAngularVelocity',
  'Get Angular Velocity': 'query.angularVelocity',
  'Set Gravity': 'action.setGravity',
  'Fire Event': 'action.fireEvent',
  'Spawn Object': 'action.spawnObject',
  'Spawn Prefab': 'action.spawnPrefab',
  'Load Scene': 'action.loadScene',
  'Destroy Object': 'action.destroyObject',
  'Play Sound': 'action.playSound',
  'Set Material Color': 'action.setMaterialColor',
  'Set Material Property': 'action.setMaterialProperty',
  'Set Anim Float': 'animator.setFloat',
  'Set Anim Bool': 'animator.setBool',
  'Set Anim Trigger': 'animator.setTrigger',
  'Get Anim Param': 'animator.getParam',
  'Get Anim State': 'animator.getState',
  'Get Move Input': 'input.move',
  'Get Drive Input': 'input.driveInput',
  'Get Vehicle Speed': 'query.vehicleSpeed',
  'Find Actor By Blueprint': 'query.findActorByBlueprint',
  'Find Actor By Tag': 'query.findActorByTag',
  Raycast: 'query.raycast',
  'Overlap Sphere': 'query.overlapSphere',
  'Sphere Cast': 'query.sphereCast',
  'Set Joint Motor': 'action.setJointMotor',
  'Cut Cable': 'action.cutCable',
  'Set Cable Length': 'action.setCableLength',
  'Get Cable Tension': 'query.cableTension',
  Move: 'action.move',
  Drive: 'action.drive',
  Jump: 'action.jump',
  'Is Grounded': 'query.grounded',
  'Set Camera': 'action.setCamera',
  'Set Ragdoll': 'action.setRagdoll',
  'Spawn Projectile': 'action.spawnProjectile',
  'Set Visible': 'action.setVisible',
  'Set Active': 'action.setActive',
  'Spawn Attached': 'action.spawnAttached',
  'Play Animation': 'action.playAnimation',
  'Play Cinematic': 'action.playCinematic',
  'Set Movement Mode': 'action.setMovementMode',
  'Distance To Player': 'ai.distanceToPlayer',
  'Direction To Player': 'ai.directionToPlayer',
  'Player Location': 'ai.playerLocation',
  'Has Line Of Sight': 'ai.hasLineOfSight',
  'Face Player': 'action.facePlayer',
  Cooldown: 'logic.cooldown',
  'Material Output': 'material.output',
  Color: 'material.color',
  Scalar: 'material.scalar',
  Texture: 'material.texture',
  Mix: 'material.mix',
  'Multiply (Material)': 'material.multiply',
  'Add (Material)': 'material.add',
  'Clamp (Material)': 'material.clamp',
  'Get Material Color': 'action.getMaterialColor',
  'Get Material Property': 'action.getMaterialProperty',
  'Get Position': 'action.getPosition',
  'Get Rotation': 'action.getRotation',
  'Get Scale': 'action.getScale',
  'Set Position': 'action.setPosition',
  'Set Rotation': 'action.setRotation',
  'Set Scale': 'action.setScale',
  'Look At': 'action.lookAt',
  Tween: 'action.tweenProperty',
  Timeline: 'action.tweenProperty',
  'Timeline Control': 'action.timelineControl',
  'Save Game': 'save.write',
  'Load Game': 'save.load',
  'Clear Save': 'save.clear',
  'Has Save': 'save.has',
  'Set Time Scale': 'action.setTimeScale',
  'Get Time Of Day': 'query.getTimeOfDay',
  'Set Time Of Day': 'action.setTimeOfDay',
  'Start Replay': 'action.startReplay',
  Print: 'action.print',
  'Show UI': 'ui.show',
  'Hide UI': 'ui.hide',
  'Toggle UI': 'ui.toggle',
  'Set UI Text': 'ui.setText',
  'Set UI Visible': 'ui.setVisible',
  'Get Object Var': 'variable.getObject',
  'Set Object Var': 'variable.setObject',
  'Burst Particles': 'action.burstParticles',
  'Set Particles Emitting': 'action.setParticlesEmitting',
  'Spawn Particle System': 'action.spawnParticleSystem',
  'Camera Shake': 'action.cameraShake',
  'Screen Flash': 'action.screenFlash',
  'Screen Fade': 'action.screenFade',
  'Spawn Decal': 'action.spawnDecal',
  Explode: 'action.explode',
  'Move To': 'action.moveTo',
  Fracture: 'action.fractureObject',
  'Apply Damage': 'action.applyDamage',
  'Enter Vehicle': 'action.enterVehicle',
  'Exit Vehicle': 'action.exitVehicle',
  'Set Quality': 'action.setQuality',
  'Apply Torque': 'action.applyTorque',
  'Set Environment': 'action.setEnvironment',
};

export const categoryByKind = (nodeKind: GraphNodeKind): GraphNodeCategory => {
  if (nodeKind.startsWith('comment.')) return 'Logic';
  if (nodeKind.startsWith('string.')) return 'Values';
  if (nodeKind.startsWith('event.')) return 'Events';
  if (nodeKind.startsWith('logic.')) return 'Logic';
  if (nodeKind.startsWith('math.')) return 'Math';
  if (nodeKind.startsWith('value.')) return 'Values';
  if (nodeKind.startsWith('variable.')) return 'Variables';
  if (nodeKind.startsWith('data.')) return 'Data';
  if (nodeKind.startsWith('save.')) return 'Persistence';
  if (nodeKind.startsWith('material.')) return 'Material';
  if (nodeKind.startsWith('ui.')) return 'UI';
  if (
    nodeKind === 'action.applyForce' ||
    nodeKind === 'action.applyImpulse' ||
    nodeKind === 'action.applyForceAtPoint' ||
    nodeKind === 'action.applyTorque' ||
    nodeKind === 'action.setPhysics' ||
    nodeKind === 'action.setVelocity' ||
    nodeKind === 'query.velocity' ||
    nodeKind === 'query.getSpeed' ||
    nodeKind === 'action.setAngularVelocity' ||
    nodeKind === 'query.angularVelocity' ||
    nodeKind === 'action.setGravity' ||
    nodeKind === 'query.overlapSphere' ||
    nodeKind === 'query.sphereCast' ||
    nodeKind === 'action.setJointMotor' ||
    nodeKind === 'query.cableTension' ||
    nodeKind === 'action.cutCable' ||
    nodeKind === 'action.setCableLength' ||
    nodeKind === 'action.fractureObject' ||
    nodeKind === 'action.explode'
  )
    return 'Physics';
  if (nodeKind === 'action.playSound') return 'Audio';
  return 'Runtime';
};

export const describeNode = (data: Partial<NodeForgeNodeData>): Pick<NodeForgeNodeData, 'label' | 'description'> => {
  const eventName = data.eventName || 'CustomEvent';
  const keyCode = data.keyCode || 'KeyW';
  const keyLabel = keyLabelByCode(keyCode);
  const axis = (data.axis || 'z').toUpperCase();
  const amount = Number(data.amount ?? -3.6);

  switch (data.nodeKind) {
    case 'event.start':
      return { label: 'Start', description: 'Runs once when the Blueprint starts.' };
    case 'event.update':
      return { label: 'Update', description: 'Runs every preview frame while Play is active. Set Interval above 0 to throttle it.' };
    case 'event.keyDown':
      return { label: `Key Down: ${keyLabel}`, description: `Fires while ${keyLabel} is pressed during preview.` };
    case 'event.keyUp':
      return { label: `Key Up: ${keyLabel}`, description: `Fires once when ${keyLabel} is released.` };
    case 'event.custom':
      return { label: `Event: ${eventName}`, description: 'Custom event entry point fired by name.' };
    case 'event.collisionEnter':
      return {
        label: 'Collision Enter',
        description: data.otherObjectId
          ? 'Fires when this object starts touching the selected other object. Value outs: Other, Normal, Point, Speed.'
          : 'Fires when this object starts touching any solid collider. Value outs: Other, Normal, Point, Speed.',
      };
    case 'event.collisionExit':
      return {
        label: 'Collision Exit',
        description: data.otherObjectId
          ? 'Fires when this object stops touching the selected other object. Value outs: Other, Point.'
          : 'Fires when this object stops touching a solid collider. Value outs: Other, Point.',
      };
    case 'event.collisionStay':
      return {
        label: 'Collision Stay',
        description: data.otherObjectId
          ? 'Fires EVERY frame this object is resting against the selected other object. Value out: Other.'
          : 'Fires EVERY frame this object is touching a solid collider — "while standing on", "while pressed against". Collision Enter fires only once, so continuous logic belongs here. Value out: Other.',
      };
    case 'event.triggerEnter':
      return {
        label: 'Trigger Enter',
        description: data.otherObjectId
          ? 'Fires when this object starts overlapping the selected trigger participant. Value outs: Other, Point.'
          : 'Fires when this object starts overlapping any trigger collider. Value outs: Other, Point.',
      };
    case 'event.triggerExit':
      return {
        label: 'Trigger Exit',
        description: data.otherObjectId
          ? 'Fires when this object stops overlapping the selected trigger participant. Value outs: Other, Point.'
          : 'Fires when this object stops overlapping a trigger collider. Value outs: Other, Point.',
      };
    case 'event.triggerStay':
      return {
        label: 'Trigger Stay',
        description: data.otherObjectId
          ? 'Fires EVERY frame this object is inside the selected trigger participant. Value out: Other.'
          : 'Fires EVERY frame this object is overlapping a trigger volume — damage zones, healing auras, pressure plates, "hold to charge" pads. Value out: Other.',
      };
    case 'event.timer':
      return {
        label: `Timer: ${Number(data.numberValue ?? 1)}s`,
        description:
          'Fires repeatedly every N seconds during Play, on its own (no Update needed). Set the interval (seconds). Use for spawners, ticking damage, periodic AI re-think, regen. Unlike Cooldown (which gates an Update chain), Timer is its own event entry point.',
      };
    case 'event.interact':
      return {
        label: 'Interact',
        description: 'Fires when the player presses the interact key while focused on this object (Unreal-style). Mark the object interactable with an "interactable" instance variable; an "interactPrompt" variable sets the on-screen label.',
      };
    case 'event.receiveDamage':
      return {
        label: 'On Receive Damage',
        description:
          "Fires on this object when it's hit — by an Apply Damage node, a projectile, a melee swing, enemy contact, or an explosion (the frame after). Just having THIS event makes the object damageable AUTOMATICALLY — no `health` variable required (it fires notify-only and the object never dies). To make it actually have HP and DIE at 0 (ragdoll/shatter/despawn), set this node's Health (HP) field > 0 — no need to add a `health` variable by hand. The Damage value-out carries how much was dealt this hit. Unreal-style \"AnyDamage\".",
      };
    case 'event.land':
      return {
        label: 'On Land',
        description:
          'Fires when a character controller lands after falling (became grounded this frame with downward impact). Speed value-out is the impact speed in u/s — use it to spawn dust, camera shake, or hard-landing damage.',
      };
    case 'action.fireEvent':
      return { label: `Fire: ${eventName}`, description: 'Triggers matching custom event entry nodes.' };
    case 'action.enterVehicle':
      return {
        label: 'Enter Vehicle',
        description:
          'GTA-style: puts the on-foot player into a car. Run it on the CAR\'s blueprint (wire Interact → Enter Vehicle, and mark the car interactable). Hands the follow-camera + HUD to the car, parks/hides the pawn, and sets the Driving variable so the car takes input. Target defaults to this object; set targetObjectId to enter a different car.',
      };
    case 'action.exitVehicle':
      return {
        label: 'Exit Vehicle',
        description:
          'Takes the player back out of the car: the pawn reappears beside the car and regains camera + movement, the car drops its camera. Run it on the CAR\'s blueprint via a Key Down (Interact can\'t fire while driving). The Vector3 input is the car-local exit offset (default 2.2u to the right).',
      };
    case 'action.translate':
      return { label: `Translate ${axis} ${amount}`, description: 'Moves the attached object when execution reaches this node.' };
    case 'action.rotate':
      return { label: `Rotate ${axis} ${amount}`, description: 'Rotates the attached object when execution reaches this node.' };
    case 'logic.compare':
      return { label: `Compare ${data.compareOp ?? '=='}`, description: 'Outputs true or false by comparing two values.' };
    case 'logic.cast':
      return {
        label: 'Cast To Blueprint',
        description:
          "Unreal-style Cast: continues only if the target object (targetObjectId — $self/$player/$trigger or an id) runs the given blueprint (castBlueprintId). On success it records the target as the \"$cast\" reference, so downstream Get/Set Object Var with targetObjectId \"$cast\" read/write THAT instance's blueprint variables.",
      };
    case 'value.number':
      return { label: `Number ${Number(data.numberValue ?? 0)}`, description: 'Outputs a numeric literal.' };
    case 'value.random': {
      const lo = Number(data.randomMin ?? 0);
      const hi = Number(data.randomMax ?? 1);
      return {
        label: `Random ${lo}–${hi}${data.randomInteger ? ' (int)' : ''}`,
        description: data.randomInteger
          ? 'Outputs a random whole number between Min and Max (both inclusive) — dice rolls, picking an index, loot tiers.'
          : 'Outputs a random number between Min and Max. Wire into damage variance, spawn offsets, drop rolls.',
      };
    }
    case 'logic.forLoop':
      return {
        label: `For Loop ×${Number(data.loopCount ?? 4)}`,
        description:
          'Fires its "Body" output N times (the loop index 0..N-1 is on the value-out), then fires "Completed" once. Use Body→Spawn Prefab for enemy waves / room population; Completed→ to continue after.',
      };
    case 'value.string':
      return { label: `String "${data.stringValue ?? ''}"`, description: 'Outputs a text literal.' };
    case 'value.boolean':
      return { label: `Boolean ${data.booleanValue ? 'True' : 'False'}`, description: 'Outputs a true or false value.' };
    case 'value.vector3': {
      const vector = data.vectorValue ?? [0, 0, 0];
      return { label: `Vector3 ${vector.join(', ')}`, description: 'Outputs an X, Y, Z vector.' };
    }
    case 'variable.get':
      return { label: 'Get Variable', description: 'Reads the current runtime value of a project variable.' };
    case 'variable.set':
      return { label: 'Set Variable', description: 'Writes a runtime value into a project variable.' };
    case 'data.tableGet':
      return { label: 'Data Asset Lookup', description: 'Reads one typed value from a Data Asset row.' };
    case 'save.write':
      return { label: `Save Game: ${data.saveSlot || 'slot1'}`, description: 'Stores all persistent variables in a local save slot.' };
    case 'save.load':
      return { label: `Load Game: ${data.saveSlot || 'slot1'}`, description: 'Restores persistent variables from a local save slot.' };
    case 'save.clear':
      return { label: `Clear Save: ${data.saveSlot || 'slot1'}`, description: 'Deletes a local save slot.' };
    case 'save.has':
      return { label: `Has Save: ${data.saveSlot || 'slot1'}`, description: 'True when the save slot holds data. Wire into a Branch to gate a Continue path or skip an intro.' };
    case 'action.setTimeScale':
      return {
        label: `Set Time Scale: ${Number(data.numberValue ?? 1)}`,
        description: 'Sets the global game speed. 1 = normal, 0 = paused (scripts still receive input so they can unpause), values between = slow motion. Resets to 1 when a scene loads.',
      };
    case 'query.getTimeOfDay':
      return {
        label: 'Get Time Of Day',
        description:
          'Outputs normalized time of day (0–1). During Play with Day Cycle on this follows the live clock; otherwise it reads the scene\'s authored dayCycleTime.',
      };
    case 'action.setTimeOfDay':
      return {
        label: `Set Time Of Day: ${Number(data.timeOfDay ?? data.numberValue ?? 0.35).toFixed(2)}`,
        description:
          'Sets normalized time of day (0–1) on the active scene. When Day Cycle is enabled, sun/sky update immediately. Wire a Number into Time, or set the node field.',
      };
    case 'action.startReplay':
      return {
        label: `Start Replay: last ${Number(data.numberValue ?? 8)}s`,
        description: 'Plays an instant replay of the last N seconds: freezes the simulation and glides every object through its recorded motion, then resumes live. Great on a goal/kill/crash event. Capped at the 8s buffer.',
      };
    case 'material.output':
      return { label: 'Material Output', description: 'Final surface — connected pins override the material\'s base fields.' };
    case 'material.color':
      return { label: `Color ${data.materialColor || '#ffffff'}`, description: 'Outputs a constant color.' };
    case 'material.scalar':
      return { label: `Scalar ${Number(data.numberValue ?? 0)}`, description: 'Outputs a constant number.' };
    case 'material.texture':
      return { label: 'Texture', description: 'Outputs an image texture (feed Base Color or Normal).' };
    case 'material.mix':
      return { label: 'Mix', description: 'Blends two colors by a 0-1 factor.' };
    case 'material.multiply':
      return { label: 'Multiply', description: 'Multiplies two numbers/colors, or a color by a scalar.' };
    case 'material.add':
      return { label: 'Add', description: 'Adds two numbers or two colors.' };
    case 'material.clamp':
      return { label: 'Clamp', description: 'Clamps a number to a min/max range.' };
    case 'action.setMaterialColor':
      return {
        label: `Set ${data.materialColorTarget === 'emissive' ? 'Emissive' : 'Color'} ${data.materialColor || '#ffffff'}`,
        description: "Sets the attached object's base or emissive color at runtime (per-object).",
      };
    case 'action.setMaterialProperty':
      return { label: `Set ${data.materialProperty ?? 'metalness'} ${Number(data.numberValue ?? 0)}`, description: 'Sets a numeric material property at runtime (per-object).' };
    case 'action.getMaterialColor':
      return { label: 'Get Material Color', description: "Reads this object's current material color at runtime." };
    case 'action.getMaterialProperty':
      return { label: `Get ${data.materialProperty ?? 'metalness'}`, description: "Reads this object's current numeric material property at runtime." };
    case 'action.destroyObject':
      return {
        label: data.targetObjectId ? 'Destroy Object' : 'Destroy Self',
        description: data.targetObjectId ? 'Removes the target object during Play.' : 'Removes the owning object during Play.',
      };
    case 'animator.setFloat':
      return { label: `Set Anim Float: ${data.paramName || 'param'}`, description: 'Writes a float into an animator parameter.' };
    case 'animator.setBool':
      return { label: `Set Anim Bool: ${data.paramName || 'param'}`, description: 'Writes a boolean into an animator parameter.' };
    case 'animator.setTrigger':
      return { label: `Set Anim Trigger: ${data.paramName || 'param'}`, description: 'Fires a one-shot animator trigger.' };
    case 'animator.getParam':
      return { label: `Get Anim Param: ${data.paramName || 'param'}`, description: 'Reads an animator parameter value.' };
    case 'animator.getState':
      return { label: 'Get Anim State', description: 'Outputs the active animator state name.' };
    case 'input.move':
      return { label: 'Get Move Input', description: 'WASD / arrows → a world move direction.' };
    case 'input.driveInput':
      return { label: 'Get Drive Input', description: 'Vehicle keys → [throttle, steer, handbrake].' };
    case 'query.vehicleSpeed':
      return { label: 'Get Vehicle Speed', description: 'The owning Vehicle\'s current speed (units/sec).' };
    case 'action.move':
      return { label: 'Move', description: 'Moves + turns the owner along a direction at a speed.' };
    case 'action.drive':
      return { label: 'Drive', description: 'Drive the owning Vehicle from a [throttle, steer, handbrake] vector.' };
    case 'action.jump':
      return { label: 'Jump', description: 'Makes the owning character jump.' };
    case 'query.grounded':
      return { label: 'Is Grounded', description: 'True when the character is on the ground.' };
    case 'action.setCamera':
      return { label: 'Set Camera', description: 'Override follow-camera distance/height at runtime.' };
    case 'action.setRagdoll':
      return {
        label: `Set Ragdoll ${data.booleanValue === false ? 'Off' : 'On'}`,
        description: 'Switches the owner (or Target) into a physics ragdoll — bones go limp.',
      };
    case 'action.spawnProjectile':
      return {
        label: 'Spawn Projectile',
        description: 'Fires a projectile forward from the owner; it stops at the first solid thing in its path (a wall blocks it — cover works) and only damages that hit when it has a health var, then despawns.',
      };
    case 'action.setVisible':
      return {
        label: `Set Visible ${data.visible === false ? 'Off' : 'On'}`,
        description: 'Shows or hides the owner (or Target) object during Play — used to equip/holster weapons.',
      };
    case 'action.setActive':
      return {
        label: `Set Active ${data.booleanValue === false ? 'Off' : 'On'}`,
        description:
          'Fully activates or deactivates the owner (or Target). OFF = the object stops rendering, stops running its script, drops its physics collider, and is ignored by AI/Find — like switching it off. ON = back to normal. Use for doors/hazards/spawned enemies you toggle. Stronger than Set Visible (which only hides the mesh). Wire a Boolean into "on", or set it on the node.',
      };
    case 'action.spawnAttached':
      return {
        label: 'Spawn Attached',
        description: 'Spawns a model and attaches it to the owner (or Target) at a bone/socket — Unreal-style equip. Replaces any weapon already on that socket.',
      };
    case 'action.spawnPrefab':
      return {
        label: 'Spawn Prefab',
        description: 'Instantiates a prefab (a captured object tree, with its scripts/animator) at a position at runtime — use for enemy waves, breakables, hazards. Spawned objects clear when Play stops.',
      };
    case 'action.moveTo':
      return {
        label: 'Move To',
        description:
          'Walks the owner toward a target position (wire Player Location or a waypoint into Target), steering around walls/pillars/cover with forward raycasts — Unreal "MoveTo" pathing for chasing & patrolling. Stops within the arrival radius. Add a Has Line Of Sight gate to stop shooting through walls.',
      };
    case 'action.cameraShake':
      return {
        label: `Camera Shake ${Number(data.shakeAmount ?? 0.6)}`,
        description:
          'Shakes the player camera (trauma 0..1, fades automatically) — explosions, big hits, impacts. The player firing/taking damage already adds shake; use this node for scripted punch.',
      };
    case 'action.screenFlash':
      return {
        label: `Screen Flash ${Number(data.flashAmount ?? 0.7)}`,
        description:
          'Pops a full-screen color flash that fades in ~0.3s — muzzle/explosion bloom, an ability blink, a damage blink. Amount = peak opacity 0..1 (wire a number into "amount"); set flashColor (white default, hot orange for blasts, red for damage). Explosions already add a flash automatically, so reserve this for scripted moments.',
      };
    case 'action.screenFade':
      return {
        label: `Screen Fade → ${Number(data.fadeTo ?? 1)}`,
        description:
          'Fades the gameplay viewport toward an opacity (0 clear … 1 covered) over Duration seconds, tinted by Color. Done fires when the fade settles. Great for respawns, teleports, and scene transitions. Independent of Film Mode cinematics.',
      };
    case 'action.spawnDecal':
      return {
        label: `Spawn Decal (${String(data.decalKind ?? 'bullet')})`,
        description:
          'Stamps a persistent surface mark — a bullet hole, blood splat, or scorch/burn — onto whatever a shot hit. Wire Location + Normal (typically from a Raycast or Sphere Cast hit: its Point → Location, Normal → Normal); unwired it uses the owner\'s position facing up. Fields: kind (bullet/blood/scorch), size (half-width in world units), life (seconds before it fades; 0 = permanent), color (optional hex tint). Marks are pooled and the oldest recycle after a cap, so it\'s cheap to spray. Weapon/projectile impacts already drop bullet-hole/blood decals automatically — use this node for scripted marks (footprints, paint, magic runes).',
      };
    case 'action.explode':
      return {
        label: `Explode r${Number(data.explodeRadius ?? 5)}`,
        description:
          'Detonate a blast at a Location (wired), else the Target object, else self: flings nearby DYNAMIC bodies/debris outward (radial force) and billows cloth, deals radial damage, spawns the burst FX + camera shake. Damage fires each hit object\'s "On Receive Damage" event AUTOMATICALLY (any object with that event is damageable — no health var needed); objects WITH a health var lose HP and die/fracture/ragdoll at 0, chaining explosives. Fields: radius, force (outward impulse), damage.',
      };
    case 'action.loadScene':
      return {
        label: 'Load Scene',
        description:
          'Switches the active Scene during Play (next dungeon floor, level, game-over screen). Project variables persist across the load (score, floor, unlocks); the scene you leave reverts to pristine.',
      };
    case 'ai.distanceToPlayer':
      return { label: 'Distance To Player', description: 'Outputs the distance (units) from this object to the player. Wire into Compare for range checks.' };
    case 'ai.directionToPlayer':
      return { label: 'Direction To Player', description: 'Outputs a normalized direction vector toward the player. Wire into Move so the enemy chases.' };
    case 'ai.playerLocation':
      return { label: 'Player Location', description: "Outputs the player's world position [x,y,z]. Wire into Spawn Particle System's Location (or any vector input) to spawn an effect at the player." };
    case 'ai.hasLineOfSight':
      return { label: 'Has Line Of Sight', description: 'True when nothing solid (walls, cover, doors) sits between this object and the player. Wire into a Branch to gate Move/Shoot so enemies stop chasing or firing through walls.' };
    case 'action.facePlayer':
      return { label: 'Face Player', description: 'Turns this object to face the player (so Spawn Projectile fires at them).' };
    case 'logic.cooldown':
      return { label: `Cooldown: ${Number(data.numberValue ?? 1)}s`, description: 'Gate: lets execution through at most once every N seconds. Use for fire rate / spawn rate.' };
    case 'logic.not':
      return { label: 'NOT', description: 'Inverts a boolean — true becomes false and false becomes true. Wire a bool into Value.' };
    case 'logic.forEachActor': {
      const filter = data.castBlueprintId ? 'Blueprint' : `Tag: ${data.stringValue || 'any'}`;
      return {
        label: `For Each Actor (${filter})`,
        description:
          'Fires its "Body" output once for EVERY actor matching a Blueprint or a Tag — the iterating form of Unreal "Get All Actors Of Class". The current actor is on the value-out (wire it into a Cast / Get Position / Set Object Var / Apply Damage Target inside the Body). Fires "Completed" once after. Pick a Blueprint, or set a Tag (matches the object\'s Tags). Skips self/dead/disabled. Gate behind an event/Cooldown — it scans every matching actor each time it runs.',
      };
    }
    case 'logic.switch': {
      const count = data.switchCases?.length ?? 2;
      return {
        label: `Switch (${count} cases)`,
        description:
          'Routes execution by VALUE — the state-machine node. Wire a number/string into Value; it\'s matched against the case list (edit cases in the inspector) and the matching case pin fires; no match → Default. E.g. Switch on a "GamePhase" variable: menu / playing / gameover.',
      };
    }
    case 'logic.sequence':
      return {
        label: 'Sequence',
        description: 'Fires Then 0, Then 1, Then 2 in order (same frame) — splits a long chain into readable parallel lanes (Unreal Sequence).',
      };
    case 'logic.flipFlop':
      return {
        label: 'Flip Flop',
        description: 'Alternates: first trigger fires A, next fires B, then A again… (Unreal FlipFlop). Toggle doors, alternate gun barrels, on/off switches.',
      };
    case 'logic.select':
      return {
        label: 'Select',
        description: 'Outputs A when the condition is true, else B (pure value pick — the value-side Branch). Wire any types.',
      };
    case 'logic.functionReturn':
      return {
        label: 'Return',
        description: 'Inside a Function chain: sets the function\'s return value (read from the Call Function node\'s Return pin) and ENDS the function — nodes after it don\'t run.',
      };
    case 'math.abs':
      return { label: 'Abs', description: 'Outputs |value| (absolute value).' };
    case 'math.min':
      return { label: 'Min', description: 'Outputs the smaller of A and B.' };
    case 'math.max':
      return { label: 'Max', description: 'Outputs the larger of A and B.' };
    case 'math.round':
      return { label: `Round (${data.roundMode ?? 'round'})`, description: 'Rounds a number — round (nearest), floor (down) or ceil (up).' };
    case 'math.power':
      return { label: 'Power', description: 'Outputs A raised to the power B (A^B).' };
    case 'math.sin':
      return { label: 'Sin', description: 'Outputs sin(angle in DEGREES) — orbits, bobbing, waves.' };
    case 'math.cos':
      return { label: 'Cos', description: 'Outputs cos(angle in DEGREES) — orbits, bobbing, waves.' };
    case 'string.append':
      return { label: 'Append', description: 'Joins A + B as text (e.g. "Score: " + score) — wire into Set UI Text or Print.' };
    case 'comment.note':
      return {
        label: 'Comment',
        description:
          'A resizable note frame for organizing/explaining a graph — no pins, never executes. Double-click the text to edit; drag the corner to resize around a group of nodes.',
      };
    case 'event.functionEntry':
      return {
        label: `Function: ${data.functionName || 'MyFunction'}`,
        description:
          'A reusable subgraph entry (Unreal Blueprint function-lite). It NEVER fires on its own — it runs only when a "Call Function" node with the same name executes, then returns to the caller. Build a chain once (open door, reload, apply buff…) and call it from many places. Use Get/Set variables to pass data in and out.',
      };
    case 'logic.callFunction':
      return {
        label: `Call: ${data.functionName || 'MyFunction'}`,
        description:
          'Runs the matching "Function" entry\'s chain in THIS blueprint synchronously, then continues. Reuse logic instead of copy-pasting node chains. Recursion is capped at depth 16.',
      };
    case 'logic.doOnce':
      return { label: 'Do Once', description: 'Gate: lets execution through ONLY the first time it is reached this Play session, then blocks forever. Use to fire one-shot setup from an event that can repeat (a trigger, a key).' };
    case 'logic.delay':
      return { label: `Delay: ${Number(data.numberValue ?? 1)}s`, description: 'Waits N seconds, then fires its output (Unreal-style latent Delay). Re-triggers are ignored while it is counting. Wire a number into Seconds to set the wait, or set the value on the node.' };
    case 'math.subtract':
      return { label: 'Subtract', description: 'Outputs A − B (numbers).' };
    case 'math.multiply':
      return { label: 'Multiply', description: 'Outputs A × B (numbers).' };
    case 'math.divide':
      return { label: 'Divide', description: 'Outputs A ÷ B (numbers). Division by zero yields 0.' };
    case 'math.modulo':
      return { label: 'Modulo', description: 'Outputs the remainder of A ÷ B. Modulo by zero yields 0. Use for wrapping/looping counters.' };
    case 'math.distance':
      return { label: 'Distance', description: 'Outputs the straight-line distance between two Vector3 positions A and B.' };
    case 'math.vectorAdd':
      return { label: 'Add Vectors', description: 'Adds two Vector3s component-wise (A + B). Offset a position by a direction.' };
    case 'math.vectorSubtract':
      return { label: 'Subtract Vectors', description: 'Subtracts Vector3 B from A — the vector pointing from B to A (e.g. a direction between two points).' };
    case 'math.vectorScale':
      return { label: 'Scale Vector', description: 'Multiplies a Vector3 by a scalar number — lengthen/shorten a direction (e.g. step size).' };
    case 'math.normalize':
      return { label: 'Normalize', description: 'Returns a Vector3 pointing the same way but with length 1 — turn a difference into a pure direction.' };
    case 'math.makeVector':
      return { label: 'Make Vector3', description: 'Builds a Vector3 from separate X, Y, Z numbers.' };
    case 'math.mapRange':
      return { label: 'Map Range', description: 'Remaps Value from the input range [In Min, In Max] to the output range [Out Min, Out Max], clamped (Unreal Map Range Clamped). E.g. health 0..100 → bar 0..1, or input -1..1 → angle 0..360.' };
    case 'math.floor':
      return { label: 'Floor', description: 'Rounds Value DOWN to the nearest whole number (3.7 → 3, −0.2 → −1). Use for grid/tile indices, counters, quantising.' };
    case 'math.vectorLength':
      return { label: 'Vector Length', description: 'Outputs the magnitude (length) of a Vector3 — e.g. speed from a velocity vector, or distance from an offset.' };
    case 'math.dot':
      return { label: 'Dot Product', description: 'Outputs the dot product of two Vector3s (A·B). With normalized directions it is the cosine of the angle between them — positive = same way, 0 = perpendicular, negative = opposing. Great for facing/aim checks.' };
    case 'action.getPosition':
      return { label: 'Get Position', description: "Outputs an actor's world position [x,y,z] (Unreal GetActorLocation). Defaults to this object; pick a Target ($player/$trigger/$cast/an object) or wire a reference into Target." };
    case 'action.getRotation':
      return { label: 'Get Rotation', description: "Outputs an actor's rotation as Euler degrees [x,y,z] (Unreal GetActorRotation). Defaults to this object; pick a Target or wire a reference into Target." };
    case 'action.getScale':
      return { label: 'Get Scale', description: "Outputs an actor's scale [x,y,z] (Unreal GetActorScale3D). Defaults to this object; pick a Target or wire a reference into Target." };
    case 'query.findActorByBlueprint':
      return {
        label: `Find Actor (BP) · ${data.findMode === 'nearest' ? 'nearest' : 'first'}`,
        description:
          "Searches the live scene for an actor running the chosen Blueprint and outputs a reference to it (Unreal Get Actor Of Class). Mode: 'first' (deterministic, cheap — the boss/objective) or 'nearest' to the owner (the AI case). Returns nothing if none match. Wire the reference into a Cast (to validate + access its typed variables), or straight into Get/Set Object Var / Get Position. Gate it behind an event or Cooldown — don't run it on raw Update in a big scene.",
      };
    case 'action.applyImpulse':
      return {
        label: `Apply Impulse${data.space === 'local' ? ' · Local' : ''}`,
        description:
          'Gives a target an INSTANT velocity kick (a one-shot impulse) — jumps, explosions, knockback, launches. Wire a Vector3 into Force (or set an axis + amount). Space=world uses global axes; Space=local rotates the vector by the target actor so Local +Z follows a car/actor forward. Unlike Apply Force, this is immediate. On a DYNAMIC body it adds to its momentum; on a CHARACTER it becomes a one-shot launch velocity. Target defaults to self.',
      };
    case 'action.applyForceAtPoint':
      return {
        label: `Apply Force at Point${data.space === 'local' ? ' · Local' : ''}`,
        description:
          'Pushes a DYNAMIC body at a LOCAL point on it — an off-center hit that BOTH shoves it AND spins it (the lever arm turns the push into torque). Car flips, catapults, off-center thrusters, hinged lever pushes. Wire a Vector3 into Force (or set axis + amount), and a Vector3 into Local Point (e.g. [0, 1, 0] to hit above the center of mass) or set the Point field. Space=world applies the force in global axes; Space=local rotates the force by the target. Target defaults to self.',
      };
    case 'action.setVelocity':
      return {
        label: 'Set Velocity',
        description:
          "Hard-sets a DYNAMIC physics body's linear velocity (units/sec) — wire a Vector3 into Velocity. Overrides momentum/gravity for that body this frame (it keeps coasting at that velocity after). Use for conveyor belts, projectiles, dashes, precise launches. No effect on character/kinematic/fixed bodies. Target defaults to self.",
      };
    case 'action.setPhysics':
      return {
        label: `Set Physics ${data.physicsEnabled === false ? 'Off' : 'On'}`,
        description:
          'Enables, disables, or reconfigures the Target object\'s physics body at runtime. Change body type, collider, trigger mode, mass, gravity, material preset, friction, bounce, and damping. Target defaults to self and supports $player/$trigger/$cast or a wired Target reference. Physics rebuilds from these values during Play and resets on Stop.',
      };
    case 'action.applyTorque':
      return {
        label: `Apply Torque ${Number(data.amount ?? 4)} · ${(data.axis || 'y').toUpperCase()}`,
        description:
          "Kicks a DYNAMIC body's spin (an angular impulse) — physics-driven steering, tip-over forces, spinners. Wire a Vector3 into Torque (or set Axis + Amount, signed = direction). The body's mass-derived inertia resists the kick, so a heavier car steers slower for free. No effect on character/kinematic/fixed bodies. Target defaults to self.",
      };
    case 'action.setEnvironment':
      return {
        label: 'Set Environment',
        description:
          "Patches the active scene's environment (sky colors, fog, sun, environment intensity) at runtime. Set only the envPatch fields you want to change — undefined fields are left alone. Use it for cinematic atmosphere shifts on a trigger (clear → toxic green → dawn), day/night crossfades, or storm rolls in.",
      };
    case 'query.velocity':
      return {
        label: 'Get Velocity',
        description:
          "Outputs an actor's current velocity [x,y,z] (units/sec) — its speed and direction of travel. Works for dynamic physics bodies, characters, and vehicles. Wire into Make/➗ math for speed-based logic, or into a speedometer. Target defaults to self.",
      };
    case 'query.getSpeed':
      return {
        label: 'Get Speed',
        description:
          "Outputs an actor's current LINEAR speed (units/sec) — the magnitude of its Get Velocity vector, ignoring direction. Great for speedometers, 'is it moving?' gates, air-speed for gliders, or Compare checks against a max speed. Works for dynamic physics bodies, characters, and vehicles. Target defaults to self.",
      };
    case 'action.setAngularVelocity':
      return {
        label: 'Set Angular Velocity',
        description:
          "Hard-sets a DYNAMIC physics body's SPIN (radians/sec) — wire a Vector3 into Velocity, or set Axis + Amount. The body keeps spinning at that rate until something changes it, so this is the node for turntables, rolling boulders, spinning traps, and stabilising a tumbling projectile. Unlike Apply Torque (a one-off kick the body's inertia resists) this sets the rate exactly. No effect on character/kinematic/fixed bodies. Target defaults to self.",
      };
    case 'query.angularVelocity':
      return {
        label: 'Get Angular Velocity',
        description:
          "Outputs an actor's current spin [x,y,z] in radians/sec. Feed it into Vector Length for a raw spin rate (drift/roll scoring, 'is it still spinning?' checks, wheel audio pitch). Target defaults to self.",
      };
    case 'action.setGravity':
      return {
        label: 'Set Gravity',
        description:
          "Sets WORLD gravity for the whole scene as an acceleration vector (units/s²). Default Earth is [0, -9.81, 0]; use [0, -1.62, 0] for the Moon, [0, 0, 0] for space, or point it sideways/up for a gimmick level. Every dynamic body still scales this by its own Gravity value, and gravityMultiplier trigger volumes still layer on top. Sleeping bodies wake so the change bites immediately.",
      };
    case 'query.raycast':
      return {
        label: `Raycast ${Number(data.numberValue ?? 20)}u`,
        description:
          "Casts a ray from this object (chest height) and reports what it hits. Outputs: Hit (true if something solid is in the way), Hit Actor (a reference to the object hit — wire into Cast / Get Position / Set Object Var), Hit Point (world position of the impact), and Distance. Direction defaults to the object's forward; wire a Vector3 into Direction (e.g. Direction To Player) and a number into Distance to aim/range it. Use for ground checks, shooting/aim, AI sensing, interaction probes. Skips self, the dead, and projectiles.",
      };
    case 'query.overlapSphere':
      return {
        label: `Overlap Sphere ${Number(data.numberValue ?? 5)}u`,
        description:
          "Finds every SOLID actor whose collider overlaps a sphere — Unreal's OverlapSphere / Unity's Physics.OverlapSphere, the idiomatic 'who's in range' for AoE damage, ability ranges, proximity sensing. Outputs: Hit (true if anything is inside), Actor (the NEAREST overlapping actor — wire into Cast / Apply Damage Target / Get Position), and Count (how many). Center defaults to this object's position; wire a Vector3 into Location to probe elsewhere. Radius from the node field or a wired number. Uses the physics broadphase so it respects real collider sizes; skips self and triggers/sensors. Needs physics-enabled bodies to detect. Gate behind an event or Cooldown, not raw Update if you only need it occasionally.",
      };
    case 'query.sphereCast':
      return {
        label: `Sphere Cast ${Number(data.numberValue ?? 20)}u`,
        description:
          "Sweeps a SPHERE from this object along a direction and reports the FIRST solid it touches — Unreal's SphereTrace / Unity's SphereCast. Unlike Raycast it has thickness (radius from the node field or a wired number into Radius), so it can't slip through small gaps: the right probe for thick projectiles, ledge/clearance checks, melee arcs, and vehicle sensors. Outputs: Hit (bool), Actor (reference to the object hit), Point (world contact position), Distance, and Normal (the surface normal at the hit — reflect projectiles or align decals with it). Direction defaults to this object's forward; wire a Vector3 into Direction and a number into Distance to aim/range it. Skips self and sensors. Gate behind an event or Cooldown, not raw Update.",
      };
    case 'action.setJointMotor':
      return {
        label: 'Set Joint Motor',
        description:
          "Drives a hinge/slider JOINT's motor on the Target object (default self) during Play — the powered-mechanism node. Wire a number into Position to SERVO toward an angle (radians, hinge) or offset (units, slider): powered doors (0 → 1.57 to swing open), elevators, drawbridges. Or wire a number into Velocity to spin/slide at a constant rate: windmills, conveyors, cranes (Position wins if both are wired). The Target must have a hinge or slider Joint component (add one in the Inspector or with add_joint). Typical door: On Interact → Set Joint Motor(position: 1.57); interact again → position: 0.",
      };
    case 'action.cutCable':
      return {
        label: 'Cut Cable',
        description:
          "Severs a cable's physics constraint at runtime and detaches its end — the dynamic end flies FREE (drop the wrecking ball, snap a tether, collapse a bridge) and the rope dangles. Targets the cable owner (default self; set targetObjectId / wire a reference). Works for a cable's own physical rope, a followed joint, or a plain rope joint between the two ends. One-shot — wire it to an event (a key, Trigger Enter, a shot), not Update.",
      };
    case 'action.setCableLength':
      return {
        label: `Set Cable Length${typeof data.numberValue === 'number' ? ` ${data.numberValue}` : ''}`,
        description:
          "Sets a cable's length at runtime — a WINCH / reel: raise or lower the hanging mass (crane, elevator, zipline, fishing line, grappling line). Wire a number into Length (or set the field). Retracts (shorter) pull the end up; extends let it drop. Drives the visual slack AND the physical rope's max distance. Targets the cable owner (default self).",
      };
    case 'query.cableTension':
      return {
        label: 'Get Cable Tension',
        description:
          "Outputs a cable's current STRETCH ratio: end-to-end distance ÷ length. ~1 = at rest, >1 = taut/straining (≈ the tear ratio just before it snaps), <1 = slack. Wire into Compare for 'rope is taut' logic — strain alarms, snap warnings, auto-winch. Targets the cable owner (default self).",
      };
    case 'query.findActorByTag':
      return {
        label: `Find Actor (Tag: ${data.stringValue || 'any'})${data.findMode === 'nearest' ? ' · nearest' : ' · first'}`,
        description:
          "Searches the live scene for an actor with the given Tag and outputs a reference to it. The Tag matches the chips in an object's Inspector ‘Tags’ section (or a Set Object Var on the `tags` variable), or a truthy variable named the tag (e.g. `interactable`). Leave Tag blank to find any tagged actor. Class-independent. Mode first/nearest. Returns nothing if none match. Gate behind an event or Cooldown, not raw Update.",
      };
    case 'action.setPosition':
      return { label: 'Set Position', description: "Teleports this object to a world position (wire a Vector3 into Position). Snap/place the owner." };
    case 'action.setRotation':
      return { label: 'Set Rotation', description: "Sets this object's rotation from Euler degrees [x,y,z] (wire a Vector3 into Rotation)." };
    case 'action.setScale':
      return { label: 'Set Scale', description: "Sets this object's scale (wire a Vector3 into Scale) — grow/shrink/pulse the owner." };
    case 'action.lookAt':
      return { label: 'Look At', description: 'Turns this object to face a world position on the ground plane (wire a Vector3 — e.g. Player Location — into Target).' };
    case 'action.tweenProperty': {
      const prop = data.tweenProperty ?? 'position';
      const isTimeline = Boolean(data.tweenCurve?.length);
      return {
        label: isTimeline
          ? `${data.timelineName || 'Timeline'} · ${prop} ${Number(data.numberValue ?? 1)}s`
          : `Tween ${prop} ${Number(data.numberValue ?? 1)}s`,
        description:
          'Animates an actor\'s position/rotation/scale over an editable value curve — doors, lifts, pickups, mechanisms, and UI-like world motion. Choose local or world coordinates and absolute or relative values. Then continues immediately; Update fires every playback frame and Finished fires once at the end. Moving kinematic/fixed bodies follow the Timeline; dynamic bodies fight authored animation.',
      };
    }
    case 'action.timelineControl': {
      const command = data.timelineCommand ?? 'play';
      return {
        label: `Timeline ${command[0].toUpperCase()}${command.slice(1)}`,
        description:
          'Controls a named Timeline on this Blueprint instance. Play resumes forward, Restart begins at the captured start, Reverse continues backward from the current point, and Stop holds the current pose.',
      };
    }
    case 'action.playAnimation':
      return {
        label: 'Play Animation',
        description: "Plays a one-shot animation (montage) on the owner's (or Target's) animator, overriding the state machine until it finishes, then returning automatically. Unreal Play-Montage style — fire it from any event (Interact, key, equip).",
      };
    case 'action.playCinematic':
      return { label: 'Play Cinematic', description: 'Starts a Film Mode cinematic sequence from Blueprint logic, trigger volumes, or interactions.' };
    case 'action.setMovementMode':
      return {
        label: `Set Movement Mode: ${data.movementMode ?? 'walking'}`,
        description: "Sets how the owner (or Target) character moves until changed — walking / swimming (buoyant) / climbing (wall) / flying (free 3D). Drives the swimming/climbing animator params. Wire Trigger Enter→swimming, Trigger Exit→walking for a water volume (Unreal SetMovementMode).",
      };
    case 'action.fractureObject':
      return {
        label: 'Fracture',
        description:
          'Shatters the owner (or Target) into small dynamic cubes that fly apart, then removes the original — breakable crates/walls/rocks. Wire it to a one-shot event (Collision Enter, a shot, a key), not Update.',
      };
    case 'action.applyDamage':
      return {
        label: `Apply Damage ${Number(data.damageAmount ?? 10)}`,
        description:
          "Subtracts HP from a target's `health` instance variable (owner by default; set Target to $player/$trigger/$cast or wire a Target reference). When health hits 0 the target dies — rigged actors ragdoll, destructibles shatter, explosives blast, props despawn. It fires the target's On Receive Damage event; if the target has that event but NO `health` var it's still notified (notify-only, never dies). Add a `health` var when you want real HP/death. Spawns a floating damage number.",
      };
    case 'action.setQuality':
      return {
        label: `Set Quality: ${data.qualityLevel ?? 'High'}`,
        description:
          'Sets the game quality preset (Low/Medium/High/Epic) at runtime — adjusts render resolution, shadow budget, and post-FX. Wire to a settings menu button or a custom event.',
      };
    case 'action.print':
      return { label: `Print: ${data.message || 'message'}`, description: 'Logs its message to the on-screen console during Play.' };
    case 'ui.show':
      return { label: 'Show UI', description: 'Shows a screen UI document (HUD) during Play.' };
    case 'ui.hide':
      return { label: 'Hide UI', description: 'Hides a screen UI document during Play.' };
    case 'ui.toggle':
      return { label: 'Toggle UI', description: 'Toggles a screen UI document visible ↔ hidden.' };
    case 'ui.setText':
      return { label: 'Set UI Text', description: "Overrides a UI element's text at runtime (wire a value into Text)." };
    case 'ui.setVisible':
      return { label: 'Set UI Visible', description: 'Shows or hides one UI element inside a document during Play.' };
    case 'action.burstParticles':
      return {
        label: `Burst Particles x${Number(data.numberValue ?? 16)}`,
        description: "Emits a one-shot burst from the owner's (or Target's) particle emitter — explosions, hit sparks, puffs. The object must have a particle emitter.",
      };
    case 'action.setParticlesEmitting':
      return {
        label: `Particles ${data.booleanValue === false ? 'Off' : 'On'}`,
        description: 'Starts or stops a continuous particle emitter on the owner (or Target) — e.g. ignite a torch, switch on a smoke plume.',
      };
    case 'action.spawnParticleSystem':
      return {
        label: 'Spawn Particle System',
        description: "Spawns a fresh emitter from a reusable Particle System asset (explosions, pickups, hit effects). Position priority: a Vector3 wired into Location (e.g. Player Location) → the Target object's position → the owner. An Offset vector is added on top. Set its particleSystemId. Runtime-spawned; removed on Stop.",
      };
    case 'variable.getObject':
      return { label: `Get Object Var: ${data.objectKey || 'health'}`, description: "Reads one of this object's instance variables (self)." };
    case 'variable.setObject':
      return { label: `Set Object Var: ${data.objectKey || 'health'}`, description: "Writes an instance variable on the target object (self by default; set targetObjectId / \"$trigger\" to write the toucher)." };
    default: {
      const label = data.label ?? 'Node';
      return { label, description: nodeDescriptions[label] ?? `${data.category ?? 'Graph'} node` };
    }
  }
};

export const normalizeNodeData = (data: Partial<NodeForgeNodeData>): NodeForgeNodeData => {
  const nodeKind = data.nodeKind ?? nodeKindByLabel[data.label ?? 'Update'] ?? 'event.update';
  const category = data.category ?? categoryByKind(nodeKind);
  const normalized: NodeForgeNodeData = {
    ...data,
    label: data.label ?? 'Node',
    nodeKind,
    category,
    description: data.description ?? `${category} node`,
    tone: nodeToneByCategory[category],
    hasInput: data.hasInput ?? !nodeKind.startsWith('event.'),
    hasOutput: data.hasOutput ?? true,
  };

  if ((nodeKind === 'event.keyDown' || nodeKind === 'event.keyUp') && !normalized.keyCode) {
    normalized.keyCode = 'KeyW';
  }

  if ((nodeKind === 'event.custom' || nodeKind === 'action.fireEvent') && !normalized.eventName) {
    normalized.eventName = 'CustomEvent';
  }

  if ((nodeKind === 'event.functionEntry' || nodeKind === 'logic.callFunction') && !normalized.functionName) {
    normalized.functionName = 'MyFunction';
  }

  if (nodeKind === 'logic.switch' && !Array.isArray(normalized.switchCases)) {
    normalized.switchCases = ['0', '1'];
  }

  if (nodeKind === 'math.round' && !normalized.roundMode) {
    normalized.roundMode = 'round';
  }

  if (nodeKind === 'comment.note') {
    if (typeof normalized.message !== 'string') normalized.message = 'Comment';
    // A comment has no pins and never participates in execution.
    normalized.hasInput = false;
    normalized.hasOutput = false;
  }

  if ((nodeKind === 'action.translate' || nodeKind === 'action.rotate') && !normalized.axis) {
    normalized.axis = nodeKind === 'action.translate' ? 'z' : 'y';
  }

  if (nodeKind === 'action.translate' && typeof normalized.amount !== 'number') {
    normalized.amount = -3.6;
  }

  if (nodeKind === 'action.rotate' && typeof normalized.amount !== 'number') {
    normalized.amount = 90;
  }

  if (nodeKind === 'action.print' && typeof normalized.message !== 'string') {
    normalized.message = 'Hello';
  }

  if (
    (nodeKind === 'animator.setFloat' ||
      nodeKind === 'animator.setBool' ||
      nodeKind === 'animator.setTrigger' ||
      nodeKind === 'animator.getParam') &&
    typeof normalized.paramName !== 'string'
  ) {
    normalized.paramName = 'Speed';
  }

  if (nodeKind === 'logic.compare' && !normalized.compareOp) {
    normalized.compareOp = '==';
  }

  if (nodeKind === 'value.number') {
    normalized.valueType = 'number';
    if (typeof normalized.numberValue !== 'number') normalized.numberValue = 0;
  }

  if (nodeKind === 'value.string') {
    normalized.valueType = 'string';
    if (typeof normalized.stringValue !== 'string') normalized.stringValue = 'Text';
  }

  if (nodeKind === 'value.boolean') {
    normalized.valueType = 'boolean';
    if (typeof normalized.booleanValue !== 'boolean') normalized.booleanValue = true;
  }

  if (nodeKind === 'value.vector3') {
    normalized.valueType = 'vector3';
    if (!Array.isArray(normalized.vectorValue)) normalized.vectorValue = [0, 0, 0];
  }

  if (nodeKind === 'value.random') {
    normalized.valueType = 'number';
    if (typeof normalized.randomMin !== 'number') normalized.randomMin = 0;
    if (typeof normalized.randomMax !== 'number') normalized.randomMax = 1;
    if (typeof normalized.randomInteger !== 'boolean') normalized.randomInteger = false;
  }

  if (nodeKind === 'logic.forLoop' && typeof normalized.loopCount !== 'number') {
    normalized.loopCount = 4;
  }

  if (nodeKind === 'logic.delay' && typeof normalized.numberValue !== 'number') {
    normalized.numberValue = 1;
  }

  if (nodeKind === 'action.tweenProperty') {
    const freshTimeline = data.label === 'Timeline';
    if (!normalized.tweenProperty) normalized.tweenProperty = freshTimeline ? 'rotation' : 'position';
    if (typeof normalized.numberValue !== 'number') normalized.numberValue = 1; // duration (seconds)
    if (!normalized.easing) normalized.easing = 'easeInOut';
    if (!Array.isArray(normalized.vectorValue)) normalized.vectorValue = freshTimeline ? [0, 90, 0] : [0, 0, 0]; // "To" fallback
    if (freshTimeline && !normalized.tweenCurve) normalized.tweenCurve = timelineCurvePreset('smooth');
    if (normalized.tweenCurve) normalized.tweenCurve = normalizeTimelineCurve(normalized.tweenCurve);
    if (!normalized.tweenSpace) normalized.tweenSpace = 'local';
    if (!normalized.tweenValueMode) normalized.tweenValueMode = freshTimeline ? 'relative' : 'absolute';
    if (typeof normalized.tweenLoop !== 'boolean') normalized.tweenLoop = false;
    if (typeof normalized.tweenPingPong !== 'boolean') normalized.tweenPingPong = false;
  }

  if (nodeKind === 'action.timelineControl') {
    if (!['play', 'restart', 'reverse', 'stop'].includes(String(normalized.timelineCommand))) {
      normalized.timelineCommand = 'play';
    }
  }

  if (nodeKind === 'event.timer' && typeof normalized.numberValue !== 'number') {
    normalized.numberValue = 1; // fire interval (seconds)
  }

  if (nodeKind === 'query.findActorByBlueprint' || nodeKind === 'query.findActorByTag') {
    if (normalized.findMode !== 'nearest') normalized.findMode = 'first';
  }
  if (nodeKind === 'query.findActorByTag' && typeof normalized.objectKey !== 'string') {
    normalized.objectKey = 'tags';
  }

  if (nodeKind === 'query.raycast' && typeof normalized.numberValue !== 'number') {
    normalized.numberValue = 20; // default ray length (units)
  }

  if (nodeKind === 'query.overlapSphere' && typeof normalized.numberValue !== 'number') {
    normalized.numberValue = 5; // default overlap radius (units)
  }

  if (nodeKind === 'query.sphereCast') {
    if (typeof normalized.numberValue !== 'number') normalized.numberValue = 20; // sweep length (units)
    if (typeof normalized.amount !== 'number') normalized.amount = 0.5; // sphere radius (units)
  }

  if (nodeKind === 'action.cameraShake' && typeof normalized.shakeAmount !== 'number') {
    normalized.shakeAmount = 0.6;
  }

  if (nodeKind === 'action.screenFlash') {
    if (typeof normalized.flashAmount !== 'number') normalized.flashAmount = 0.7;
    if (typeof normalized.flashColor !== 'string') normalized.flashColor = '#ffffff';
  }

  if (nodeKind === 'action.screenFade') {
    if (typeof normalized.fadeTo !== 'number') normalized.fadeTo = 1;
    if (typeof normalized.numberValue !== 'number') normalized.numberValue = 0.5; // duration seconds
    if (typeof normalized.fadeColor !== 'string') normalized.fadeColor = '#000000';
  }

  if (nodeKind === 'action.playSound') {
    if (typeof normalized.soundVolume !== 'number') normalized.soundVolume = 1;
    if (typeof normalized.soundPitch !== 'number') normalized.soundPitch = 1;
    if (typeof normalized.pitchJitter !== 'number') normalized.pitchJitter = 0;
  }

  if (nodeKind === 'action.explode') {
    if (typeof normalized.explodeRadius !== 'number') normalized.explodeRadius = 5;
    if (typeof normalized.explodeForce !== 'number') normalized.explodeForce = 16;
    if (typeof normalized.explodeDamage !== 'number') normalized.explodeDamage = 50;
  }

  if (nodeKind === 'action.spawnDecal') {
    if (normalized.decalKind !== 'bullet' && normalized.decalKind !== 'blood' && normalized.decalKind !== 'scorch') normalized.decalKind = 'bullet';
    if (typeof normalized.decalSize !== 'number') normalized.decalSize = 0.4;
    if (typeof normalized.decalLife !== 'number') normalized.decalLife = 0;
  }

  if (nodeKind === 'action.applyTorque') {
    if (typeof normalized.amount !== 'number') normalized.amount = 4;
    if (!normalized.axis) normalized.axis = 'y';
  }

  if (nodeKind === 'action.applyForceAtPoint') {
    if (typeof normalized.amount !== 'number') normalized.amount = 8;
    if (!normalized.axis) normalized.axis = 'z';
    if (!normalized.space) normalized.space = 'world';
    if (!Array.isArray(normalized.localPoint)) normalized.localPoint = [0, 0, 0]; // center of mass = pure shove
  }

  if (nodeKind === 'action.setPhysics') {
    if (typeof normalized.physicsEnabled !== 'boolean') normalized.physicsEnabled = true;
    if (!normalized.physicsBodyType) normalized.physicsBodyType = 'dynamic';
    if (!normalized.physicsCollider) normalized.physicsCollider = 'box';
    if (typeof normalized.physicsIsTrigger !== 'boolean') normalized.physicsIsTrigger = false;
    if (typeof normalized.physicsMass !== 'number') normalized.physicsMass = 1;
    if (typeof normalized.physicsGravityScale !== 'number') normalized.physicsGravityScale = 1;
    if (!normalized.physicsMaterialPreset) normalized.physicsMaterialPreset = 'default';
    if (typeof normalized.physicsFriction !== 'number') normalized.physicsFriction = 0.6;
    if (typeof normalized.physicsRestitution !== 'number') normalized.physicsRestitution = 0.05;
    if (typeof normalized.physicsLinearDamping !== 'number') normalized.physicsLinearDamping = 0;
    if (typeof normalized.physicsAngularDamping !== 'number') normalized.physicsAngularDamping = 0.05;
  }

  if (nodeKind === 'action.applyDamage' && typeof normalized.damageAmount !== 'number') {
    normalized.damageAmount = 10;
  }

  if (nodeKind === 'action.setQuality' && !normalized.qualityLevel) {
    normalized.qualityLevel = 'High';
  }

  if (nodeKind === 'action.moveTo' && typeof normalized.numberValue !== 'number') {
    normalized.numberValue = 1.2; // arrival radius (units)
  }

  if (nodeKind === 'save.write' || nodeKind === 'save.load' || nodeKind === 'save.clear' || nodeKind === 'save.has') {
    if (!normalized.saveSlot) normalized.saveSlot = 'slot1';
  }

  if (nodeKind === 'action.setTimeScale' && typeof normalized.numberValue !== 'number') {
    normalized.numberValue = 1;
  }

  if (nodeKind === 'action.startReplay' && typeof normalized.numberValue !== 'number') {
    normalized.numberValue = 8; // seconds of motion to replay (capped at the buffer)
  }

  if (nodeKind === 'action.setMaterialColor' && typeof normalized.materialColor !== 'string') {
    normalized.materialColor = '#ff5555';
  }

  if (nodeKind === 'action.setMaterialProperty') {
    if (!normalized.materialProperty) normalized.materialProperty = 'metalness';
    if (typeof normalized.numberValue !== 'number') normalized.numberValue = 1;
  }

  if (nodeKind === 'material.output') {
    normalized.hasInput = false;
    normalized.hasOutput = false;
  }

  if (nodeKind === 'material.color' && typeof normalized.materialColor !== 'string') {
    normalized.materialColor = '#B4BCCC';
  }

  if ((nodeKind === 'material.scalar' || nodeKind === 'material.mix') && typeof normalized.numberValue !== 'number') {
    normalized.numberValue = 0.5;
  }

  if (nodeKind === 'action.getMaterialProperty' && !normalized.materialProperty) {
    normalized.materialProperty = 'metalness';
  }

  if (nodeKind === 'logic.functionReturn') {
    // Return ends the function — there is no exec continuation.
    normalized.hasOutput = false;
  }

  if (nodeKind === 'logic.sequence' || nodeKind === 'logic.flipFlop') {
    // These route ONLY through their named pins (Then 0/1/2, A/B) — no default exec-out.
    normalized.hasOutput = false;
  }

  const isPureValueNode = valueProducerKinds.has(nodeKind);

  if ((nodeKind === 'variable.getObject' || nodeKind === 'variable.setObject') && typeof normalized.objectKey !== 'string') {
    normalized.objectKey = 'health';
  }

  // Set Gravity starts at Earth so a freshly dropped node reads as "this is the value you're changing"
  // rather than silently doing nothing (an unset vector would leave gravity untouched at runtime).
  if (nodeKind === 'action.setGravity' && !Array.isArray(normalized.vectorValue)) {
    normalized.vectorValue = [0, -9.81, 0];
  }

  if (isPureValueNode) {
    normalized.hasInput = false;
    normalized.hasOutput = true;
  }

  return { ...normalized, ...describeNode(normalized) };
};

export const makeNodeData = (
  label: string,
  category: GraphNodeCategory,
  options: Partial<NodeForgeNodeData> = {},
): NodeForgeNodeData => {
  const normalized = normalizeNodeData({ label, category, nodeKind: options.nodeKind ?? nodeKindByLabel[label], ...options });
  // Logical Timeline ids are minted only at creation time. normalizeNodeData also runs on every inspector
  // edit, so generating one there would silently break every Timeline Control reference.
  if (normalized.nodeKind === 'action.tweenProperty' && normalized.tweenCurve?.length && !normalized.timelineId) {
    return { ...normalized, timelineId: makeId('timeline'), timelineName: normalized.timelineName || 'Timeline' };
  }
  return normalized;
};

/** Replace a single graph (by id) via a mapper — used by the material-graph editor actions. */
export const mapGraphById = (graphs: ProjectGraph[], graphId: string, fn: (graph: ProjectGraph) => ProjectGraph) =>
  graphs.map((graph) => (graph.id === graphId ? fn(graph) : graph));

/** A fresh material graph: just the Material Output sink (unconnected → renders from the material's flat fields). */
export const makeMaterialGraph = (graphId: string, name: string): ProjectGraph => ({
  id: graphId,
  name,
  nodes: [
    {
      id: makeId('node'),
      type: 'nodeforge',
      position: { x: 360, y: 140 },
      data: makeNodeData('Material Output', 'Material'),
    },
  ],
  edges: [],
});

export const seedNodeDataFromProject = (
  label: string,
  data: Partial<NodeForgeNodeData> | undefined,
  variables: ProjectVariable[],
  dataAssets: DataAsset[],
): Partial<NodeForgeNodeData> => {
  const next: Partial<NodeForgeNodeData> = { ...(data ?? {}) };
  if ((label === 'Get Variable' || label === 'Set Variable') && !next.variableId) {
    const variable = variables[0];
    if (variable) {
      next.variableId = variable.id;
      next.valueType = variable.type;
      const value = variable.defaultValue;
      if (variable.type === 'number') next.numberValue = value as number;
      if (variable.type === 'string') next.stringValue = value as string;
      if (variable.type === 'boolean') next.booleanValue = value as boolean;
      if (variable.type === 'vector3') next.vectorValue = value as Vector3Tuple;
    }
  }
  if ((label === 'Data Asset Lookup' || label === 'Table Lookup') && !next.tableId) {
    const table = dataAssets[0];
    if (table) {
      next.tableId = table.id;
      next.rowKey = table.rows[0]?.key;
      next.columnId = table.columns[0]?.id;
    }
  }
  return next;
};
