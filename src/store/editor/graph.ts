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
  'Collision Enter': 'Fires when this object starts touching another collider.',
  'Trigger Enter': 'Fires when this object starts overlapping a trigger collider.',
  'Trigger Exit': 'Fires when this object stops overlapping a trigger collider.',
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
  'Spawn Object': 'Creates an object instance.',
  'Destroy Object': 'Removes an object during Play.',
  'Play Sound': 'Plays an audio source.',
  'Play Cinematic': 'Starts a Film Mode cinematic sequence.',
  'Set Material Color': 'Changes the attached object\'s material color at runtime (per-object).',
  'Set Material Property': 'Sets a numeric material property (metalness/roughness/glow) at runtime (per-object).',
  'Set Anim Float': 'Writes a float into the object\'s animator parameter (e.g. Speed) to drive its state machine.',
  'Set Anim Bool': 'Writes a true/false into the object\'s animator parameter.',
  'Set Anim Trigger': 'Fires a one-shot animator trigger (e.g. Jump, Attack) consumed by a transition.',
  'Get Anim Param': 'Reads the current value of an animator parameter (float/bool) back into the blueprint.',
  'Get Anim State': 'Outputs the name of the animator\'s currently-active state, for the blueprint to react to.',
  'Get Move Input': 'Outputs a world-space move direction (Vector3) from WASD / arrow keys.',
  'Get Drive Input': 'Outputs [throttle, steer, handbrake] (Vector3) from the vehicle keys (W/S throttle, A/D steer, Space handbrake).',
  'Get Vehicle Speed': 'Outputs the owning Vehicle\'s current speed (units/sec) — for speedometers, gear logic, or speed-gated effects.',
  Move: 'Moves the owner along the ground by a direction vector at a speed, turning it to face travel.',
  Drive: 'Drives the owning Vehicle from a [throttle, steer, handbrake] vector — the Vehicle controller handles physics, suspension + terrain.',
  Jump: 'Makes the owning character jump (needs a Character Controller for height/gravity).',
  'Is Grounded': 'Outputs true when the owning character is on the ground.',
  'Set Camera': 'Overrides the follow-camera distance/height at runtime.',
  'Save Game': 'Writes persistent variables into local save storage.',
  'Load Game': 'Restores persistent variables from local save storage.',
  'Clear Save': 'Deletes a local save slot.',
  Print: 'Logs a message to the on-screen console during Play.',
  'Set Quality': 'Sets the game quality preset (Low/Medium/High/Epic) at runtime — adjusts resolution, shadows, and post-FX.',
};

export const keyLabels: Record<string, string> = {
  KeyW: 'W',
  KeyA: 'A',
  KeyS: 'S',
  KeyD: 'D',
  Space: 'Space',
  ArrowUp: 'Arrow Up',
  ArrowDown: 'Arrow Down',
  ArrowLeft: 'Arrow Left',
  ArrowRight: 'Arrow Right',
};

export const nodeKindByLabel: Record<string, GraphNodeKind> = {
  Start: 'event.start',
  Update: 'event.update',
  'Key Down': 'event.keyDown',
  'Key Down: W': 'event.keyDown',
  'Key Up': 'event.keyUp',
  'Custom Event': 'event.custom',
  'Collision Enter': 'event.collisionEnter',
  'Trigger Enter': 'event.triggerEnter',
  'Trigger Exit': 'event.triggerExit',
  Interact: 'event.interact',
  Branch: 'logic.branch',
  Compare: 'logic.compare',
  AND: 'logic.and',
  OR: 'logic.or',
  Cast: 'logic.cast',
  'For Loop': 'logic.forLoop',
  Add: 'math.add',
  Clamp: 'math.clamp',
  Lerp: 'math.lerp',
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
  Move: 'action.move',
  Drive: 'action.drive',
  Jump: 'action.jump',
  'Is Grounded': 'query.grounded',
  'Set Camera': 'action.setCamera',
  'Set Ragdoll': 'action.setRagdoll',
  'Spawn Projectile': 'action.spawnProjectile',
  'Set Visible': 'action.setVisible',
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
  Multiply: 'material.multiply',
  'Add (Material)': 'material.add',
  'Clamp (Material)': 'material.clamp',
  'Get Material Color': 'action.getMaterialColor',
  'Get Material Property': 'action.getMaterialProperty',
  'Save Game': 'save.write',
  'Load Game': 'save.load',
  'Clear Save': 'save.clear',
  Print: 'action.print',
  'Show UI': 'ui.show',
  'Hide UI': 'ui.hide',
  'Set UI Text': 'ui.setText',
  'Get Object Var': 'variable.getObject',
  'Set Object Var': 'variable.setObject',
  'Burst Particles': 'action.burstParticles',
  'Set Particles Emitting': 'action.setParticlesEmitting',
  'Spawn Particle System': 'action.spawnParticleSystem',
  'Camera Shake': 'action.cameraShake',
  'Move To': 'action.moveTo',
  Fracture: 'action.fractureObject',
  'Set Quality': 'action.setQuality',
};

export const categoryByKind = (nodeKind: GraphNodeKind): GraphNodeCategory => {
  if (nodeKind.startsWith('event.')) return 'Events';
  if (nodeKind.startsWith('logic.')) return 'Logic';
  if (nodeKind.startsWith('math.')) return 'Math';
  if (nodeKind.startsWith('value.')) return 'Values';
  if (nodeKind.startsWith('variable.')) return 'Variables';
  if (nodeKind.startsWith('data.')) return 'Data';
  if (nodeKind.startsWith('save.')) return 'Persistence';
  if (nodeKind.startsWith('material.')) return 'Material';
  if (nodeKind.startsWith('ui.')) return 'UI';
  if (nodeKind === 'action.applyForce' || nodeKind === 'action.fractureObject') return 'Physics';
  if (nodeKind === 'action.playSound') return 'Audio';
  return 'Runtime';
};

export const describeNode = (data: Partial<NodeForgeNodeData>): Pick<NodeForgeNodeData, 'label' | 'description'> => {
  const eventName = data.eventName || 'CustomEvent';
  const keyCode = data.keyCode || 'KeyW';
  const keyLabel = keyLabels[keyCode] ?? keyCode;
  const axis = (data.axis || 'z').toUpperCase();
  const amount = Number(data.amount ?? -3.6);

  switch (data.nodeKind) {
    case 'event.start':
      return { label: 'Start', description: 'Runs once when the Blueprint starts.' };
    case 'event.update':
      return { label: 'Update', description: 'Runs every preview frame while Play is active.' };
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
          ? 'Fires when this object starts touching the selected other object.'
          : 'Fires when this object starts touching any solid collider.',
      };
    case 'event.triggerEnter':
      return {
        label: 'Trigger Enter',
        description: data.otherObjectId
          ? 'Fires when this object starts overlapping the selected trigger participant.'
          : 'Fires when this object starts overlapping any trigger collider.',
      };
    case 'event.triggerExit':
      return {
        label: 'Trigger Exit',
        description: data.otherObjectId
          ? 'Fires when this object stops overlapping the selected trigger participant (e.g. walks away).'
          : 'Fires when this object stops overlapping a trigger collider.',
      };
    case 'event.interact':
      return {
        label: 'Interact',
        description: 'Fires when the player presses the interact key while focused on this object (Unreal-style). Mark the object interactable with an "interactable" instance variable; an "interactPrompt" variable sets the on-screen label.',
      };
    case 'action.fireEvent':
      return { label: `Fire: ${eventName}`, description: 'Triggers matching custom event entry nodes.' };
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
    case 'ui.setText':
      return { label: 'Set UI Text', description: "Overrides a UI element's text at runtime (wire a value into Text)." };
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

  if (nodeKind === 'action.cameraShake' && typeof normalized.shakeAmount !== 'number') {
    normalized.shakeAmount = 0.6;
  }

  if (nodeKind === 'action.setQuality' && !normalized.qualityLevel) {
    normalized.qualityLevel = 'High';
  }

  if (nodeKind === 'action.moveTo' && typeof normalized.numberValue !== 'number') {
    normalized.numberValue = 1.2; // arrival radius (units)
  }

  if (nodeKind === 'save.write' || nodeKind === 'save.load' || nodeKind === 'save.clear') {
    if (!normalized.saveSlot) normalized.saveSlot = 'slot1';
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

  const isPureValueNode =
    nodeKind.startsWith('value.') ||
    nodeKind.startsWith('math.') ||
    nodeKind === 'logic.compare' ||
    nodeKind === 'logic.and' ||
    nodeKind === 'logic.or' ||
    nodeKind === 'ai.distanceToPlayer' ||
    nodeKind === 'ai.directionToPlayer' ||
    nodeKind === 'ai.hasLineOfSight' ||
    nodeKind === 'ai.playerLocation' ||
    nodeKind === 'variable.get' ||
    nodeKind === 'data.tableGet' ||
    nodeKind === 'material.color' ||
    nodeKind === 'material.scalar' ||
    nodeKind === 'material.texture' ||
    nodeKind === 'material.mix' ||
    nodeKind === 'material.multiply' ||
    nodeKind === 'material.add' ||
    nodeKind === 'material.clamp' ||
    nodeKind === 'action.getMaterialColor' ||
    nodeKind === 'action.getMaterialProperty' ||
    nodeKind === 'input.move' ||
    nodeKind === 'input.driveInput' ||
    nodeKind === 'query.vehicleSpeed' ||
    nodeKind === 'query.grounded' ||
    nodeKind === 'animator.getParam' ||
    nodeKind === 'animator.getState' ||
    nodeKind === 'variable.getObject';

  if ((nodeKind === 'variable.getObject' || nodeKind === 'variable.setObject') && typeof normalized.objectKey !== 'string') {
    normalized.objectKey = 'health';
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
): NodeForgeNodeData => normalizeNodeData({ label, category, nodeKind: options.nodeKind ?? nodeKindByLabel[label], ...options });

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
