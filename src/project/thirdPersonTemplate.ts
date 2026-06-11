import { getPlatform } from '../platform';
import { useProjectStore } from '../store/projectStore';
import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import { inspectModel } from '../three/inspectModel';
import type { AssetItem, GraphNodeCategory, Vector3Tuple } from '../types';

/** The Quaternius "Universal Animation Library" pawn that ships with the engine (public/templates). */
const TEMPLATE_URL = 'templates/UAL1.glb';
const TEMPLATE_NAME = 'UAL1.glb';

/** Fetch + import a bundled static model from public/templates, reusing it if already imported. Returns the asset id. */
async function importBundledModel(name: string): Promise<string | undefined> {
  const existing = useEditorStore.getState().assets.find((a) => a.name === name && a.type === 'model');
  if (existing) return existing.id;
  try {
    const response = await fetch(`templates/${name}`);
    if (!response.ok) return undefined;
    const blob = await response.blob();
    const file = new File([blob], name, { type: 'model/gltf-binary' });
    const platform = await getPlatform();
    const dir = useProjectStore.getState().projectDir ?? 'web';
    const { path, url } = await platform.importAsset(dir, file);
    const assetId = `asset-${crypto.randomUUID()}`;
    const item: AssetItem = { id: assetId, name, type: 'model', size: file.size, path, url, createdAt: Date.now() };
    useEditorStore.getState().addAssetItems([item]);
    return assetId;
  } catch {
    return undefined;
  }
}

/** Fetch + import a bundled sound from public/audio, reusing it if already imported. Returns the asset id. */
async function importBundledAudio(name: string): Promise<string | undefined> {
  const existing = useEditorStore.getState().assets.find((a) => a.name === name && a.type === 'audio');
  if (existing) return existing.id;
  try {
    const response = await fetch(`audio/${name}`);
    if (!response.ok) return undefined;
    const blob = await response.blob();
    const file = new File([blob], name, { type: 'audio/mpeg' });
    const platform = await getPlatform();
    const dir = useProjectStore.getState().projectDir ?? 'web';
    const { path, url } = await platform.importAsset(dir, file);
    const assetId = `asset-${crypto.randomUUID()}`;
    const item: AssetItem = { id: assetId, name, type: 'audio', size: file.size, path, url, createdAt: Date.now() };
    useEditorStore.getState().addAssetItems([item]);
    return assetId;
  } catch {
    return undefined;
  }
}

/** Node-category inference shared by every blueprint builder in this template. */
function categoryFor(label: string): GraphNodeCategory {
  if (['Start', 'Update', 'Custom Event', 'Trigger Enter', 'Trigger Exit', 'Collision Enter', 'Interact', 'Key Down', 'Key Up'].includes(label)) return 'Events';
  if (['Branch', 'Compare', 'AND', 'OR', 'NOT', 'Do Once'].includes(label)) return 'Logic';
  if (['Get Variable', 'Set Variable', 'Get Object Var', 'Set Object Var'].includes(label)) return 'Variables';
  if (['Add', 'Clamp', 'Lerp', 'Make Vector3'].includes(label)) return 'Math';
  if (['Number', 'String', 'Boolean', 'Vector3'].includes(label)) return 'Values';
  if (['Show UI', 'Hide UI', 'Set UI Text'].includes(label)) return 'UI';
  return 'Runtime';
}

/**
 * Build the classic Unreal ThirdPersonMap from the bundled rig - a clean grey-checker arena built from
 * primitive geometry only, designed as a *gym* the player runs around in to feel out the controller.
 * Everything is a stock engine primitive so it's editable, and the controller is tuned for a steady,
 * weighty AAA TPS feel (smooth accel, soft turn, centred behind-the-character camera with no over-shoulder
 * micro-jitter).
 *
 * The arena (centred on the player spawn):
 *  - Wide grey checker FLOOR (a 60x60 base + a 4x4 dark-tile checker overlay)
 *  - A 5-step STAIRS up to a raised NORTH PLATFORM with a knee-high cover wall
 *  - A ramp going EAST up to a LOWER PLATFORM, then a JUMP to a HIGHER PLATFORM
 *  - A glowing JUMP PAD (W side) that launches the player onto three FLOATING PUZZLE platforms
 *  - Three staggered COVER WALLS on the S side
 *  - Four tall PILLARS at the arena corners for visual depth
 *  - PERIMETER WALLS keeping the player in the play space
 *  - The bundled rig as PLAYER with Fist/Bat/Pistol inventory + locomotion + over-the-shoulder camera
 *
 * Returns the player's id.
 */
export async function createThirdPersonTemplate(): Promise<string | undefined> {
  const editor = useEditorStore.getState();

  // Reuse the template model if it's already imported + split; otherwise fetch + import it once.
  let modelAsset = editor.assets.find((asset) => asset.name === TEMPLATE_NAME && asset.type === 'model');
  const alreadySplit = modelAsset && editor.skeletalMeshes.some((mesh) => mesh.sourceAssetId === modelAsset!.id);

  if (!modelAsset || !alreadySplit) {
    const response = await fetch(TEMPLATE_URL);
    if (!response.ok) throw new Error('Bundled template model not found.');
    const blob = await response.blob();
    const file = new File([blob], TEMPLATE_NAME, { type: 'model/gltf-binary' });
    const platform = await getPlatform();
    const dir = useProjectStore.getState().projectDir ?? 'web';
    const { path, url } = await platform.importAsset(dir, file);
    const assetId = `asset-${crypto.randomUUID()}`;
    const item: AssetItem = { id: assetId, name: TEMPLATE_NAME, type: 'model', size: file.size, path, url, createdAt: Date.now() };
    useEditorStore.getState().addAssetItems([item]);
    const inspection = await inspectModel(file);
    useEditorStore.getState().registerImportedModel({ assetId, assetName: TEMPLATE_NAME, inspection });
    modelAsset = useEditorStore.getState().assets.find((asset) => asset.id === assetId);
  }
  if (!modelAsset) return undefined;

  const store = useEditorStore.getState();
  const sceneId = store.activeSceneId;

  // Wipe the default starter-scene objects so the new arena starts on a clean slate.
  for (const defaultId of ['obj-player', 'obj-ground', 'obj-enemy', 'obj-camera']) {
    if (selectActiveObjects(useEditorStore.getState()).some((o) => o.id === defaultId)) {
      store.deleteObject(defaultId);
    }
  }

  // --- ENVIRONMENT: the Unreal default-level look - a bright blue-grey sky, a high warm sun, soft IBL
  //     ambient, almost no fog. Lets the matte grey arena read clean and casts long crisp shadows. ---
  store.updateSceneEnvironment(sceneId, {
    skyMode: 'procedural',
    skyTopColor: '#b3cee8',
    skyHorizonColor: '#e8eef5',
    skyGroundColor: '#5a6068',
    environmentIntensity: 1.2,
    sunColor: '#fff5e0',
    sunIntensity: 1.1,
    sunAzimuth: 35,
    sunElevation: 55,
    fogEnabled: true,
    fogColor: '#cad6e2',
    fogNear: 90,
    fogFar: 320,
    // A whisper of raymarched haze layered over the linear fog: it softens the long corridor
    // sightline, puts a warm in-scatter glow toward the sun, and (on High/Epic) draws faint shafts
    // through the door frames. Density stays very low so the daylight read remains crisp.
    volumetricFogEnabled: true,
    volumetricFogDensity: 0.014,
    volumetricFogColor: '#cdd9e6',
    volumetricFogHeight: 0,
    volumetricFogFalloff: 0.16,
    volumetricScattering: 0.55,
    volumetricSunStrength: 0.85,
    volumetricMaxDistance: 130,
  });
  store.updateRenderSettings({
    bloomEnabled: true,
    bloomIntensity: 0.55,
    bloomThreshold: 0.82,
    bloomRadius: 0.65,
    vignetteEnabled: true,
    minimapEnabled: false,
    // Showcase template: default to the High scalability preset so shadows/post read AAA out of the
    // box (autoQuality still steps down on weak machines), plus a barely-there filmic grade — a touch
    // of contrast and warmth so the grey-blue corridor doesn't read flat-ungraded.
    quality: 'High',
    colorGrade: { grade: 'custom', gradeIntensity: 1, contrast: 0.08, saturation: 0.06, temperature: 0.03 },
  });

  buildArena();

  // --- PLAYER: the bundled rig with locomotion + gameplay kit + the Fist/Bat/Pistol inventory.
  //     Controller tuned for an Unreal-style smooth feel (centred behind-the-character cam, gentle accel,
  //     no strafe mode - the strafe + camera-auto-follow loop produces a small rotational shake on
  //     diagonal walks, and a pure "face-the-direction-of-travel" rig reads as a more grounded TPS). ---
  const pawnId = store.createCharacterPawn(modelAsset.id, 'Player');
  if (!pawnId) return undefined;
  store.updateTransform(pawnId, 'position', [0, 0.1, TUTORIAL_ROOM_Z.movement - 5.0]);

  const kit = useEditorStore.getState().addGameplayKit;
  kit(pawnId, 'health');
  kit(pawnId, 'interactions');
  kit(pawnId, 'ranged');

  const [footstep, jump, land, swing, hurt, switchSound] = await Promise.all([
    importBundledAudio('footstep.mp3'),
    importBundledAudio('jump.mp3'),
    importBundledAudio('land.mp3'),
    importBundledAudio('sword-swing.mp3'),
    importBundledAudio('hurt.mp3'),
    importBundledAudio('weapon-switch.mp3'),
  ]);
  useEditorStore.getState().updateCharacterController(pawnId, {
    footstepSoundId: footstep,
    jumpSoundId: jump,
    landSoundId: land,
    attackSoundId: swing,
    hurtSoundId: hurt,
    // Centred behind-the-character camera (no over-the-shoulder offset). The over-shoulder offset turns
    // any tiny character rotation into a visible camera swing; centring it removes that completely while
    // still framing the body cleanly. This is the same framing UE's default ThirdPerson template uses.
    cameraOffset: [0, 1.55, -4.6],
    cameraPitch: 0.14,
    cameraMinPitch: -0.55,
    cameraMaxPitch: 0.85,
    mouseSensitivity: 0.0020,
    // Smooth motion ramp: the defaults accelerate at 60 m/s^2 - near-instant - which makes any physics
    // correction show up as a camera snap. This controller now pairs a weightier ramp with the stabilized
    // follow target in FollowCamera.tsx, so walking and diagonal starts stay calm.
    acceleration: 18,
    deceleration: 24,
    airControl: 0.45,
    turnSpeed: 8, // gentle - the body eases to face new headings instead of whipping around
    turnInPlace: true,
    turnInPlaceThreshold: 0.38,
    turnInPlaceSpeed: 9,
    mantleEnabled: true,
    mantleRange: 1.45,
    mantleMaxHeight: 1.55,
    vaultMaxHeight: 0.95,
    mantleDuration: 0.34,
    sprintMultiplier: 1.85,
    // Character-action style (face movement direction). Combined with cameraRelativeMovement: the player
    // presses W toward the camera, the body faces velocity, and the camera no longer needs to chase a
    // yaw heading - which kills the residual strafe-mode auto-follow micro-rotation.
    strafe: false,
    cameraRelativeMovement: true,
    meleeDamage: 40,
    meleeRange: 2.5,
    // Generous interact range so brushing up to a pedestal triggers the [E] prompt - 3.4 was tight
    // enough that walking past at speed didn't always catch it.
    interactRange: 4.5,
    jumpStrength: 6.8,
    gravity: 18,
  });

  // Health for the gameplay kit's health bar; ammo for the pistol's reload.
  useEditorStore.getState().setObjectVariable(pawnId, 'health', 100);
  useEditorStore.getState().setObjectVariable(pawnId, 'maxHealth', 100);
  useEditorStore.getState().setObjectVariable(pawnId, 'ammo', 24);
  useEditorStore.getState().setObjectVariable(pawnId, 'ammoMax', 24);
  useEditorStore.getState().setObjectVariable(pawnId, 'checkpointRoom', 1);
  useEditorStore.getState().setObjectVariable(pawnId, 'roomsCompleted', 0);
  useEditorStore.getState().setObjectVariable(pawnId, 'checkpointX', 0);
  useEditorStore.getState().setObjectVariable(pawnId, 'checkpointY', 0.1);
  useEditorStore.getState().setObjectVariable(pawnId, 'checkpointZ', TUTORIAL_ROOM_Z.movement - 5.0);

  // Soft ambient bed + background music (Play starts/stops them).
  const [ambient, music] = await Promise.all([importBundledAudio('ambient.mp3'), importBundledAudio('music.mp3')]);
  useEditorStore.getState().setSceneAudio(sceneId, { ambientSoundId: ambient, musicSoundId: music });

  await assemblePlayerKit(pawnId, switchSound);

  const tutorialUi = buildUIShowcase(pawnId);

  // These room blueprints reference the player by id, so they're built after the pawn exists.
  buildTutorialRooms(pawnId, tutorialUi);

  // Tidy the imported sounds into an Audio folder.
  const audioFolder = useEditorStore.getState().createFolder('Audio');
  for (const id of [footstep, jump, land, swing, hurt, ambient, music, switchSound]) {
    if (id) useEditorStore.getState().moveToFolder('asset', id, audioFolder);
  }
  return pawnId;
}

// hand_r bind orientation: local +Z -> world forward, local +X -> world up. Each weapon gets its own grip
// offset because the bat's blade is the model's +Z and the pistol's barrel is the model's +X.
const BAT_SCALE = 0.85;
const PISTOL_SCALE = 0.34;
const BAT_ROTATION: Vector3Tuple = [0, (90 * Math.PI) / 180, 0];
const PISTOL_ROTATION: Vector3Tuple = [0, (-90 * Math.PI) / 180, Math.PI];
const BAT_POSITION: Vector3Tuple = [0.015, -0.02, 0.02];
const PISTOL_POSITION: Vector3Tuple = [0.035, -0.035, 0.055];

/**
 * Per-pawn combat kit: imports the bat + pistol models, builds the RightHand socket, the click-to-shoot
 * gate (only while the pistol is out), a controls hint, and a Fist / Bat / Pistol inventory bar.
 */
async function assemblePlayerKit(pawnId: string, switchSound: string | undefined): Promise<void> {
  const batAsset = await importBundledModel('Sword.glb');
  const pistolAsset = await importBundledModel('Pistol.glb');

  const store = useEditorStore.getState();
  const player = selectActiveObjects(store).find((o) => o.id === pawnId);
  const blueprintId = player?.script?.blueprintId;
  const controller = store.animatorControllers.find((c) => c.id === player?.animator?.controllerId);
  const skeletonId =
    controller?.skeletonId ?? store.skeletalMeshes.find((m) => m.sourceAssetId === player?.renderer?.modelAssetId)?.skeletonId;

  const weaponsFolder = store.createFolder('Weapons');
  const uiFolder = store.createFolder('UI');
  if (batAsset) store.moveToFolder('asset', batAsset, weaponsFolder);
  if (pistolAsset) store.moveToFolder('asset', pistolAsset, weaponsFolder);
  if (blueprintId) store.moveToFolder('blueprint', blueprintId, store.createFolder('Player'));

  const clips = skeletonId ? store.animations.filter((a) => a.skeletonId === skeletonId) : [];
  const pickClip = (...patterns: RegExp[]) => {
    for (const p of patterns) {
      const found = clips.find((c) => p.test(c.name));
      if (found) return found.id;
    }
    return undefined;
  };
  const batEquipAnim = pickClip(/sword.*enter/i, /sword.*idle/i, /equip/i, /draw/i, /unsheath/i);
  const pistolEquipAnim = pickClip(/pistol.*idle/i, /pistol.*aim/i, /aim/i, /equip/i, /draw/i);

  if (skeletonId) store.addSkeletonSocket(skeletonId, { name: 'RightHand', boneName: 'hand_r' });

  // Click (release) -> fire, only while the pistol (RangedMode) is out.
  if (blueprintId) {
    const RUNTIME = new Set(['Spawn Projectile', 'Get Anim Param']);
    const add = (label: string, data?: Record<string, unknown>) =>
      store.addGraphNodeToBlueprint(blueprintId, label, RUNTIME.has(label) ? 'Runtime' : label === 'Branch' ? 'Logic' : 'Events', data);
    const shoot = add('Key Up', { keyCode: 'Mouse0' });
    const rangedCheck = add('Get Anim Param', { paramName: 'RangedMode' });
    const gate = add('Branch');
    const fire = add('Spawn Projectile', { projectileSpeed: 34, projectileDamage: 26, projectileColor: '#ffe08a', projectileSize: 0.12, projectileLife: 2.4 });
    store.connectGraphNodes(blueprintId, rangedCheck, gate, 'value-out', 'condition');
    store.connectGraphNodes(blueprintId, shoot, gate, 'exec-out', 'exec-in');
    store.connectGraphNodes(blueprintId, gate, fire, 'exec-out', 'exec-in');
  }

  // Controls bar: a centred bottom pill (blurred glass, letter-spaced caps) instead of a raw
  // text line in the corner — the same treatment AAA in-game control hints use.
  const hud = store.createUIDocument('HUD', 'screen');
  store.updateUIDocument(hud, { visibleOnStart: true });
  const hintId = store.addUIPreset(hud, undefined, 'label');
  store.updateUIElement(hud, hintId, {
    text: 'WASD Move   ·   Shift Sprint   ·   Space Jump   ·   LMB Attack   ·   RMB Aim   ·   Tab Weapons   ·   E Interact',
    style: {
      color: '#c3cbd9',
      fontSize: '11px',
      fontWeight: '600',
      background: 'rgba(9,13,20,0.62)',
      padding: '8px 22px',
      borderRadius: '999px',
      custom: {
        position: 'absolute',
        bottom: '16px',
        left: '50%',
        transform: 'translateX(-50%)',
        letterSpacing: '0.08em',
        whiteSpace: 'nowrap',
        border: '1px solid rgba(148,163,184,0.18)',
        backdropFilter: 'blur(8px)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
      },
    },
  });
  store.moveToFolder('uiDocument', hud, uiFolder);

  if (switchSound) {
    const audioFolder = useEditorStore.getState().folders.find((f) => f.name === 'Audio');
    if (audioFolder) store.moveToFolder('asset', switchSound, audioFolder.id);
  }
  store.setInventory(pawnId, {
    slots: [
      { label: 'Fist', ranged: false },
      ...(batAsset
        ? [{ label: 'Bat', weaponAssetId: batAsset, ranged: false, attachScale: BAT_SCALE, attachYaw: BAT_ROTATION[1], attachPosition: BAT_POSITION, attachRotation: BAT_ROTATION, equipAnimId: batEquipAnim }]
        : []),
      ...(pistolAsset
        ? [{ label: 'Pistol', weaponAssetId: pistolAsset, ranged: true, attachScale: PISTOL_SCALE, attachYaw: PISTOL_ROTATION[1], attachPosition: PISTOL_POSITION, attachRotation: PISTOL_ROTATION, equipAnimId: pistolEquipAnim }]
        : []),
    ],
    equipped: 0,
    boneName: 'hand_r',
    socketName: 'RightHand',
    switchSoundId: switchSound,
  });
}

// ----------------------------------------------------------------------------
// The arena. One builder per region - delete or reshape any of these freely.
// ----------------------------------------------------------------------------

const scaled = (id: string, v: Vector3Tuple) => useEditorStore.getState().updateTransform(id, 'scale', v);
const rotated = (id: string, v: Vector3Tuple) => useEditorStore.getState().updateTransform(id, 'rotation', v);

const ROOM_WIDTH = 18;
const ROOM_LENGTH = 13.5;
const ROOM_WALL_HEIGHT = 3.3;
const TUTORIAL_ROOM_Z = {
  movement: 0,
  ragdoll: 15,
  water: 30,
  climb: 45,
  interaction: 60,
  cinematic: 75,
} as const;

/**
 * A visually-OBVIOUS [E] interactable pedestal: a tall thin pillar that emits its own colour brightly,
 * sitting in a glowing emissive ring on the ground (a clear "stand on me" target). Bigger + brighter
 * than a generic cube so the player can see and read it from across the arena. Returns the pedestal id;
 * the caller wires `interactable / interactPrompt` instance vars + the [E] blueprint on top.
 */
function interactPedestal(name: string, position: Vector3Tuple, color: string): string {
  const store = useEditorStore.getState();
  // The pillar itself — taller (1.6u) and brighter than a generic cube, so it reads from spawn.
  // Fixed collider so the player can't walk through it (otherwise pedestals look fake / "broken").
  const ped = store.createObjectWithProps('cube', {
    name,
    position,
    color: '#0e1118',
    physics: { enabled: true, bodyType: 'fixed', collider: 'box' },
  });
  scaled(ped, [1.0, 1.6, 1.0]);
  store.updateRenderer(ped, {
    metalness: 0.45,
    roughness: 0.3,
    materialOverrides: { emissiveColor: color, emissiveIntensity: 2.2 },
  });
  store.setObjectVariable(ped, 'interactPriority', 1);
  // A glowing ring on the ground around the base — purely visual, no collider, sits just above the
  // floor. Two interlocking cubes give a clean square ring without needing a torus primitive.
  const ringId = store.createObjectWithProps('cube', { name: `${name} Ring`, position: [position[0], 0.06, position[2]], color });
  scaled(ringId, [2.6, 0.04, 0.12]);
  store.updateRenderer(ringId, { materialOverrides: { emissiveColor: color, emissiveIntensity: 2.6 } });
  const ringId2 = store.createObjectWithProps('cube', { name: `${name} Ring`, position: [position[0], 0.06, position[2]], color });
  scaled(ringId2, [0.12, 0.04, 2.6]);
  store.updateRenderer(ringId2, { materialOverrides: { emissiveColor: color, emissiveIntensity: 2.6 } });
  return ped;
}

/** A static fixed-collider cube. Used everywhere the player needs to stand on / walk into something. */
function block(name: string, position: Vector3Tuple, scale: Vector3Tuple, color: string, opts: { metalness?: number; roughness?: number; rotation?: Vector3Tuple; emissive?: { color: string; intensity: number } } = {}): string {
  const store = useEditorStore.getState();
  const id = store.createObjectWithProps('cube', {
    name,
    position,
    color,
    physics: { enabled: true, bodyType: 'fixed', collider: 'box' },
  });
  scaled(id, scale);
  if (opts.rotation) rotated(id, opts.rotation);
  store.updateRenderer(id, {
    metalness: opts.metalness ?? 0.05,
    roughness: opts.roughness ?? 0.85,
    ...(opts.emissive ? { materialOverrides: { emissiveColor: opts.emissive.color, emissiveIntensity: opts.emissive.intensity } } : {}),
  });
  return id;
}

/** Visual-only cube: useful for runway markers and labels that should never snag the controller. */
function decoBlock(name: string, position: Vector3Tuple, scale: Vector3Tuple, color: string, opts: { metalness?: number; roughness?: number; rotation?: Vector3Tuple; emissive?: { color: string; intensity: number } } = {}): string {
  const store = useEditorStore.getState();
  const id = store.createObjectWithProps('cube', { name, position, color });
  scaled(id, scale);
  if (opts.rotation) rotated(id, opts.rotation);
  store.updateRenderer(id, {
    metalness: opts.metalness ?? 0.05,
    roughness: opts.roughness ?? 0.7,
    ...(opts.emissive ? { materialOverrides: { emissiveColor: opts.emissive.color, emissiveIntensity: opts.emissive.intensity } } : {}),
  });
  return id;
}

type TutorialUi = {
  documentId: string;
  titleId: string;
  bodyId: string;
  statusId: string;
  /** "ROOM 0X / 06" progress chip at the top of the coach panel. */
  progressId: string;
};

function createWorldLabel(name: string, position: Vector3Tuple, title: string, body: string, color: string, scale = 0.012): void {
  const store = useEditorStore.getState();
  const doc = store.createUIDocument(`${name} Label`, 'world');
  store.updateUIDocument(doc, { visibleOnStart: true });
  const panel = store.addUIPreset(doc, undefined, 'panel');
  store.updateUIElement(doc, panel, {
    style: {
      background: 'rgba(10,14,22,0.82)',
      padding: '10px 14px',
      borderRadius: '10px',
      custom: { border: `1px solid ${color}`, textAlign: 'center', minWidth: '250px', boxShadow: '0 10px 30px rgba(0,0,0,0.35)' },
    },
  });
  const heading = store.addUIPreset(doc, panel, 'label');
  store.updateUIElement(doc, heading, { text: title, style: { color, fontSize: '15px', fontWeight: '800' } });
  const line = store.addUIElement(doc, panel, 'text');
  store.updateUIElement(doc, line, { text: body, style: { color: '#d6dee9', fontSize: '10px' } });
  const anchor = store.createObjectWithProps('empty', { name: `${name} Label Anchor`, position });
  store.attachUI(anchor, doc);
  store.updateUIComponent(anchor, { offset: [0, 0, 0], scale, billboard: true });
}

function tutorialPad(
  name: string,
  position: Vector3Tuple,
  scale: Vector3Tuple,
  color: string,
  ui: TutorialUi,
  title: string,
  body: string,
  status = 'Lesson discovered',
  playerId?: string,
  extra?: (blueprintId: string) => void,
): string {
  const store = useEditorStore.getState();
  decoBlock(`${name} Pad`, [position[0], 0.075, position[2]], [scale[0], 0.08, scale[2]], color, {
    emissive: { color, intensity: 1.2 },
    roughness: 0.35,
  });
  const trigger = store.createObjectWithProps('cube', {
    name: `${name} Trigger`,
    position: [position[0], 0.75, position[2]],
    color,
    physics: { enabled: true, bodyType: 'fixed', collider: 'box', isTrigger: true },
  });
  scaled(trigger, [scale[0], 1.4, scale[2]]);
  store.updateRenderer(trigger, { enabled: false, materialOverrides: { emissiveColor: color, emissiveIntensity: 0.0 } });

  const folder = store.folders.find((f) => f.name === 'Tutorial')?.id ?? store.createFolder('Tutorial');
  const { blueprintId } = store.createBlueprintNamed(`${name} Tutorial`, `Updates the tutorial HUD when the player enters ${name}.`, folder);
  store.attachScript(trigger, blueprintId);
  const add = (label: string, data?: Record<string, unknown>) => store.addGraphNodeToBlueprint(blueprintId, label, categoryFor(label), data);
  const ex = (a: string, b: string) => store.connectGraphNodes(blueprintId, a, b, 'exec-out', 'exec-in');
  const enter = add('Trigger Enter', playerId ? { otherObjectId: playerId } : undefined);
  const show = add('Show UI', { documentId: ui.documentId });
  const titleNode = add('Set UI Text', { documentId: ui.documentId, elementId: ui.titleId, stringValue: title });
  const bodyNode = add('Set UI Text', { documentId: ui.documentId, elementId: ui.bodyId, stringValue: body });
  const statusNode = add('Set UI Text', { documentId: ui.documentId, elementId: ui.statusId, stringValue: status });
  ex(enter, show);
  ex(show, titleNode);
  ex(titleNode, bodyNode);
  ex(bodyNode, statusNode);
  const roomMatch = title.match(/^(\d+)/) ?? name.match(/^(\d+)/);
  if (playerId && roomMatch) {
    const roomIndex = Number(roomMatch[1]);
    const setProgress = add('Set UI Text', {
      documentId: ui.documentId,
      elementId: ui.progressId,
      stringValue: `ROOM ${String(roomIndex).padStart(2, '0')} / 06`,
    });
    ex(statusNode, setProgress);
    const setRoom = add('Set Object Var', { targetObjectId: playerId, objectKey: 'checkpointRoom', numberValue: roomIndex });
    const setDone = add('Set Object Var', { targetObjectId: playerId, objectKey: 'roomsCompleted', numberValue: roomIndex });
    const setX = add('Set Object Var', { targetObjectId: playerId, objectKey: 'checkpointX', numberValue: position[0] });
    const setY = add('Set Object Var', { targetObjectId: playerId, objectKey: 'checkpointY', numberValue: position[1] });
    const setZ = add('Set Object Var', { targetObjectId: playerId, objectKey: 'checkpointZ', numberValue: position[2] });
    ex(setProgress, setRoom);
    ex(setRoom, setDone);
    ex(setDone, setX);
    ex(setX, setY);
    ex(setY, setZ);
  }
  extra?.(blueprintId);
  return trigger;
}

/** Build the full arena. */
function buildArena(): void {
  buildRoomedFoundation();
  buildTutorialRoomShells();
  buildArenaLighting();
  buildStartStack();
}

function buildRoomedFoundation(): void {
  const minZ = TUTORIAL_ROOM_Z.movement - ROOM_LENGTH / 2 - 2;
  const maxZ = TUTORIAL_ROOM_Z.cinematic + ROOM_LENGTH / 2 + 2;
  const centerZ = (minZ + maxZ) / 2;
  block('Tutorial Foundation', [0, -0.5, centerZ], [ROOM_WIDTH + 4, 1, maxZ - minZ], '#303744', {
    metalness: 0.04,
    roughness: 0.9,
  });
  decoBlock('Main Tutorial Spine', [0, 0.09, centerZ], [3.4, 0.08, maxZ - minZ - 3], '#202938', {
    roughness: 0.44,
    emissive: { color: '#0f172a', intensity: 0.25 },
  });
  decoBlock('Spine Center Light', [0, 0.15, centerZ], [0.18, 0.04, maxZ - minZ - 5], '#38bdf8', {
    roughness: 0.35,
    emissive: { color: '#38bdf8', intensity: 1.25 },
  });
}

function buildDoorFrame(name: string, z: number, color: string): void {
  const segmentWidth = (ROOM_WIDTH - 4.4) / 2;
  const x = 2.2 + segmentWidth / 2;
  block(`${name} Door Wall L`, [-x, ROOM_WALL_HEIGHT / 2, z], [segmentWidth, ROOM_WALL_HEIGHT, 0.42], '#192130', {
    metalness: 0.12,
    roughness: 0.58,
  });
  block(`${name} Door Wall R`, [x, ROOM_WALL_HEIGHT / 2, z], [segmentWidth, ROOM_WALL_HEIGHT, 0.42], '#192130', {
    metalness: 0.12,
    roughness: 0.58,
  });
  block(`${name} Door Header`, [0, 3.15, z], [4.7, 0.5, 0.42], '#192130', { metalness: 0.12, roughness: 0.58 });
  decoBlock(`${name} Door Glow`, [0, 3.48, z - 0.03], [3.8, 0.07, 0.08], color, {
    roughness: 0.25,
    emissive: { color, intensity: 2.1 },
  });
  // Vertical jamb strips + a floor threshold in the next room's accent colour — the doorway reads as
  // an authored portal (and previews the colour of what's ahead) instead of a hole between two walls.
  for (const side of [-1, 1]) {
    decoBlock(`${name} Door Jamb ${side < 0 ? 'L' : 'R'}`, [side * 2.26, 1.45, z], [0.09, 2.9, 0.1], color, {
      roughness: 0.25,
      emissive: { color, intensity: 1.6 },
    });
  }
  decoBlock(`${name} Door Threshold`, [0, 0.11, z], [4.3, 0.05, 0.6], color, {
    roughness: 0.3,
    emissive: { color, intensity: 0.8 },
  });
}

function buildTutorialRoomFrame(name: string, z: number, color: string, title: string, body: string): void {
  decoBlock(`${name} Floor Plate`, [0, 0.06, z], [ROOM_WIDTH - 1.6, 0.08, ROOM_LENGTH - 0.9], '#252d3a', {
    metalness: 0.08,
    roughness: 0.5,
  });
  decoBlock(`${name} Accent Strip`, [0, 0.13, z], [ROOM_WIDTH - 3, 0.04, 0.18], color, {
    roughness: 0.35,
    emissive: { color, intensity: 1.5 },
  });
  block(`${name} Wall L`, [-ROOM_WIDTH / 2, ROOM_WALL_HEIGHT / 2, z], [0.45, ROOM_WALL_HEIGHT, ROOM_LENGTH], '#1b2432', {
    metalness: 0.12,
    roughness: 0.58,
  });
  block(`${name} Wall R`, [ROOM_WIDTH / 2, ROOM_WALL_HEIGHT / 2, z], [0.45, ROOM_WALL_HEIGHT, ROOM_LENGTH], '#1b2432', {
    metalness: 0.12,
    roughness: 0.58,
  });
  // Architectural finish pass — skirting at the wall base, a parapet cap on top, and two overhead
  // cross-beams. Purely decorative, but they close the silhouette so each room reads as a built
  // interior (UE-template style) rather than two floating walls.
  for (const side of [-1, 1]) {
    const wx = side * (ROOM_WIDTH / 2 - 0.32);
    decoBlock(`${name} Skirting ${side < 0 ? 'L' : 'R'}`, [wx, 0.16, z], [0.14, 0.32, ROOM_LENGTH - 0.2], '#2a3344', {
      metalness: 0.18,
      roughness: 0.45,
    });
    decoBlock(`${name} Wall Cap ${side < 0 ? 'L' : 'R'}`, [side * (ROOM_WIDTH / 2), ROOM_WALL_HEIGHT + 0.07, z], [0.62, 0.14, ROOM_LENGTH], '#242e3f', {
      metalness: 0.2,
      roughness: 0.4,
    });
  }
  for (const beamOffset of [-ROOM_LENGTH / 4, ROOM_LENGTH / 4]) {
    decoBlock(`${name} Roof Beam`, [0, ROOM_WALL_HEIGHT + 0.18, z + beamOffset], [ROOM_WIDTH + 0.4, 0.24, 0.34], '#1d2533', {
      metalness: 0.25,
      roughness: 0.42,
    });
  }
  createWorldLabel(`${name} Room Label`, [-6.3, 2.75, z - 3.8], title, body, color, 0.011);
}

function buildTutorialRoomShells(): void {
  const rooms: Array<{ name: string; z: number; color: string; title: string; body: string }> = [
    { name: 'Room 01 Movement', z: TUTORIAL_ROOM_Z.movement, color: '#38bdf8', title: 'ROOM 01 - MOVEMENT', body: 'WASD, sprint, camera, jump basics.' },
    { name: 'Room 02 Ragdoll', z: TUTORIAL_ROOM_Z.ragdoll, color: '#c084fc', title: 'ROOM 02 - RAGDOLL', body: 'Press E to hand control to physics.' },
    { name: 'Room 03 Water', z: TUTORIAL_ROOM_Z.water, color: '#22d3ee', title: 'ROOM 03 - WATER', body: 'A trigger volume switches swim mode.' },
    { name: 'Room 04 Climb', z: TUTORIAL_ROOM_Z.climb, color: '#f59e0b', title: 'ROOM 04 - CLIMB', body: 'A wall volume demonstrates climb mode.' },
    { name: 'Room 05 Interaction', z: TUTORIAL_ROOM_Z.interaction, color: '#f472b6', title: 'ROOM 05 - INTERACTION', body: 'E prompts drive light toggles.' },
    { name: 'Room 06 Cinematic', z: TUTORIAL_ROOM_Z.cinematic, color: '#fde047', title: 'ROOM 06 - CINEMATIC', body: 'Enter the stage or press E to play Film Mode.' },
  ];
  for (const room of rooms) buildTutorialRoomFrame(room.name, room.z, room.color, room.title, room.body);

  const doorData: Array<[string, number, string]> = [
    ['Start Gate', TUTORIAL_ROOM_Z.movement - ROOM_LENGTH / 2, '#38bdf8'],
    ['Movement To Ragdoll', (TUTORIAL_ROOM_Z.movement + TUTORIAL_ROOM_Z.ragdoll) / 2, '#c084fc'],
    ['Ragdoll To Water', (TUTORIAL_ROOM_Z.ragdoll + TUTORIAL_ROOM_Z.water) / 2, '#22d3ee'],
    ['Water To Climb', (TUTORIAL_ROOM_Z.water + TUTORIAL_ROOM_Z.climb) / 2, '#f59e0b'],
    ['Climb To Interaction', (TUTORIAL_ROOM_Z.climb + TUTORIAL_ROOM_Z.interaction) / 2, '#f472b6'],
    ['Interaction To Cinematic', (TUTORIAL_ROOM_Z.interaction + TUTORIAL_ROOM_Z.cinematic) / 2, '#fde047'],
    ['Final Back Wall', TUTORIAL_ROOM_Z.cinematic + ROOM_LENGTH / 2, '#fde047'],
  ];
  for (const [name, z, color] of doorData) buildDoorFrame(name, z, color);
}

/** A strong first-read spawn stack: hero arch, runway, and orientation signage. */
function buildStartStack(): void {
  decoBlock('Start Runway', [0, 0.075, -2.2], [5.4, 0.08, 8.8], '#202532', {
    roughness: 0.42,
    emissive: { color: '#111827', intensity: 0.2 },
  });
  decoBlock('Start Runway Centerline', [0, 0.14, -2.2], [0.16, 0.045, 8.2], '#38bdf8', {
    roughness: 0.3,
    emissive: { color: '#38bdf8', intensity: 1.8 },
  });
  block('Start Arch Left', [-3.2, 1.55, -1.4], [0.42, 3.1, 0.42], '#1f2937', { metalness: 0.25, roughness: 0.45 });
  block('Start Arch Right', [3.2, 1.55, -1.4], [0.42, 3.1, 0.42], '#1f2937', { metalness: 0.25, roughness: 0.45 });
  block('Start Arch Beam', [0, 3.18, -1.4], [6.8, 0.34, 0.34], '#1f2937', { metalness: 0.25, roughness: 0.45 });
  decoBlock('Start Arch Glow', [0, 3.42, -1.4], [5.8, 0.08, 0.12], '#38bdf8', {
    emissive: { color: '#38bdf8', intensity: 2.4 },
    roughness: 0.25,
  });
  block('Start Briefing Plinth', [-4.7, 0.65, 1.2], [0.35, 1.3, 2.2], '#111827', {
    metalness: 0.3,
    roughness: 0.38,
    emissive: { color: '#0ea5e9', intensity: 0.25 },
  });
  block('Systems Index Plinth', [4.7, 0.65, 1.2], [0.35, 1.3, 2.2], '#111827', {
    metalness: 0.3,
    roughness: 0.38,
    emissive: { color: '#f59e0b', intensity: 0.25 },
  });
  createWorldLabel('Start Briefing', [-4.9, 2.15, 1.2], 'THIRD PERSON TEMPLATE', 'Room path: movement, ragdoll, water, climb, interaction, cinematic.', '#38bdf8');
  createWorldLabel('Systems Index', [4.9, 2.15, 1.2], 'FOLLOW THE ROOMS', 'Every room updates the HUD and uses real runtime nodes.', '#f59e0b');
}

/** Base showcase lighting that makes the primitive gym read more authored before the player toggles stations. */
function buildArenaLighting(): void {
  const store = useEditorStore.getState();
  const rim = store.createObjectWithProps('light', { name: 'Corridor Rim Light', position: [-8, 9, TUTORIAL_ROOM_Z.interaction] });
  store.setObjectLight(rim, { type: 'spot', color: '#9ec6ff', intensity: 20, distance: 52, angle: Math.PI / 5, castShadow: true });
  rotated(rim, [-Math.PI / 3.3, -0.18, 0]);
  const fill = store.createObjectWithProps('light', { name: 'Corridor Soft Fill', position: [7, 6.5, TUTORIAL_ROOM_Z.water] });
  store.setObjectLight(fill, { type: 'point', color: '#ffe3b0', intensity: 22, distance: 58, angle: 0, castShadow: false });

  const lamps: Array<{ z: number; color: string }> = [
    { z: TUTORIAL_ROOM_Z.movement, color: '#38bdf8' },
    { z: TUTORIAL_ROOM_Z.ragdoll, color: '#c084fc' },
    { z: TUTORIAL_ROOM_Z.water, color: '#22d3ee' },
    { z: TUTORIAL_ROOM_Z.climb, color: '#f59e0b' },
    { z: TUTORIAL_ROOM_Z.interaction, color: '#f472b6' },
    { z: TUTORIAL_ROOM_Z.cinematic, color: '#fde047' },
  ];
  lamps.forEach((lamp, index) => {
    const fixture = store.createObjectWithProps('cube', { name: `Room Light Rail ${index + 1}`, position: [0, 3.25, lamp.z], color: lamp.color });
    scaled(fixture, [6.4, 0.08, 0.12]);
    store.updateRenderer(fixture, { materialOverrides: { emissiveColor: lamp.color, emissiveIntensity: 2.4 } });
    const light = store.createObjectWithProps('light', { name: `Room Fill ${index + 1}`, position: [0, 4.2, lamp.z - 1.8] });
    store.setObjectLight(light, { type: 'point', color: lamp.color, intensity: 8, distance: 14, angle: 0, castShadow: false });
  });
}

/**
 * The JUMP PAD on the W side. A glowing yellow tile under a player-only trigger volume; on Trigger Enter,
 * the player gets an upward Apply Impulse (one-shot launch velocity on the character) that pops them up
 * onto the first floating puzzle platform. Built last because its blueprint references the player by id.
 */
function buildJumpPad(playerId: string, ui?: TutorialUi): void {
  const store = useEditorStore.getState();
  const folder = store.createFolder('Jump Pad');
  const padX = 5.1;
  const padZ = TUTORIAL_ROOM_Z.movement + 2.7;

  // The visible pad - flush with the ground, yellow emissive so it reads as "step here". Fixed body.
  const pad = store.createObjectWithProps('cube', {
    name: 'Jump Pad',
    position: [padX, 0.06, padZ],
    color: '#fde047',
    physics: { enabled: true, bodyType: 'fixed', collider: 'box' },
  });
  scaled(pad, [1.6, 0.12, 1.6]);
  store.updateRenderer(pad, { metalness: 0.2, roughness: 0.35, materialOverrides: { emissiveColor: '#fde047', emissiveIntensity: 2.4 } });

  // The trigger volume just above the pad - this is what actually fires when the player walks on top.
  const trigger = store.createObjectWithProps('cube', {
    name: 'Jump Pad Trigger',
    position: [padX, 0.6, padZ],
    color: '#fde047',
    physics: { enabled: true, bodyType: 'fixed', collider: 'box', isTrigger: true },
  });
  scaled(trigger, [1.6, 1.0, 1.6]);
  store.updateRenderer(trigger, { enabled: false, materialOverrides: { emissiveColor: '#fde047', emissiveIntensity: 0.15 } });

  // Blueprint: Trigger Enter (filter by the player only) -> Apply Impulse with a +Y kick on the player.
  const { blueprintId: bp } = store.createBlueprintNamed('Jump Pad', 'On the player entering, give them a one-shot upward launch velocity.', folder);
  store.attachScript(trigger, bp);
  const add = (label: string, data?: Record<string, unknown>) => store.addGraphNodeToBlueprint(bp, label, categoryFor(label), data);
  const ex = (a: string, b: string) => store.connectGraphNodes(bp, a, b, 'exec-out', 'exec-in');
  const onEnter = add('Trigger Enter', { otherObjectId: playerId });
  const impulse = add('Apply Impulse', { targetObjectId: playerId, axis: 'y', amount: 8.6 });
  ex(onEnter, impulse);
  if (ui) {
    const show = add('Show UI', { documentId: ui.documentId });
    const title = add('Set UI Text', { documentId: ui.documentId, elementId: ui.titleId, stringValue: '01 MOVEMENT - JUMP PAD' });
    const body = add('Set UI Text', {
      documentId: ui.documentId,
      elementId: ui.bodyId,
      stringValue: 'This tile uses Trigger Enter -> Apply Impulse to demonstrate a authored movement boost inside the first room.',
    });
    const status = add('Set UI Text', { documentId: ui.documentId, elementId: ui.statusId, stringValue: 'Runtime nodes: Trigger Enter + Apply Impulse' });
    ex(impulse, show);
    ex(show, title);
    ex(title, body);
    ex(body, status);
  }
}

function buildTutorialRooms(playerId: string, ui: TutorialUi): void {
  const store = useEditorStore.getState();
  const folder = store.folders.find((f) => f.name === 'Tutorial')?.id ?? store.createFolder('Tutorial');

  buildMovementRoom(playerId, ui);

  tutorialPad(
    '02 Ragdoll Room',
    [0, 0, TUTORIAL_ROOM_Z.ragdoll - 4.5],
    [5.2, 1, 2],
    '#c084fc',
    ui,
    '02 RAGDOLL ROOM',
    'Use the pedestal to hand the character over to physics, then recover with P. The follow camera keeps a stable smoothed target.',
    'Lesson: runtime ragdoll toggle + camera stability',
    playerId,
  );
  buildRagdollStation(playerId, ui, folder);

  tutorialPad(
    '03 Water Room',
    [0, 0, TUTORIAL_ROOM_Z.water - 4.7],
    [5.2, 1, 2],
    '#22d3ee',
    ui,
    '03 WATER ROOM',
    'Walk into the pool. The hidden water trigger changes the movement mode to swimming, then walking resumes when you leave.',
    'Lesson: trigger volume + swim movement mode',
    playerId,
  );
  buildSwimPool();

  tutorialPad(
    '04 Climb Room',
    [0, 0, TUTORIAL_ROOM_Z.climb - 4.7],
    [5.2, 1, 2],
    '#f59e0b',
    ui,
    '04 CLIMB ROOM',
    'Walk into the wall volume and move forward/back to climb. This is the authored traversal-volume pattern.',
    'Lesson: trigger volume + climb movement mode',
    playerId,
  );
  buildClimbWall();

  tutorialPad(
    '05 Interaction Room',
    [0, 0, TUTORIAL_ROOM_Z.interaction - 4.6],
    [5.2, 1, 2],
    '#f472b6',
    ui,
    '05 INTERACTION ROOM',
    'Move close to a glowing pedestal and press E. Each object owns its own Interact event graph.',
    'Lesson: focus prompt + Interact event',
    playerId,
  );
  buildLightTheatre(ui);

  tutorialPad(
    '06 Cinematic Room',
    [0, 0, TUTORIAL_ROOM_Z.cinematic - 4.6],
    [5.2, 1, 2],
    '#fde047',
    ui,
    '06 CINEMATIC ROOM',
    'Step onto the gold slate or press E on the pedestal to play a simple Film Mode camera pass.',
    'Lesson: Play Cinematic node + authored shots',
    playerId,
  );
  buildFinalCinematicRoom(playerId, ui, folder);
}

function buildMovementRoom(playerId: string, ui: TutorialUi): void {
  const z = TUTORIAL_ROOM_Z.movement;
  tutorialPad(
    '01 Movement Room',
    [0, 0, z - 4.5],
    [5.8, 1, 2],
    '#38bdf8',
    ui,
    '01 MOVEMENT ROOM',
    'WASD moves relative to the camera. Hold Shift to sprint, Space jumps, and Space near the low rail vaults over tagged traversal props.',
    'Lesson: movement, sprint, jump, vault, spring-arm follow camera',
    playerId,
  );
  createWorldLabel('Movement Course Label', [4.9, 2.2, z + 0.5], 'SPRINT + VAULT', 'Follow the blue lane, vault the low rail, then test the yellow launch pad.', '#38bdf8');
  decoBlock('Movement Sprint Lane', [-2.4, 0.13, z - 0.2], [1.2, 0.045, 6.4], '#38bdf8', {
    roughness: 0.35,
    emissive: { color: '#38bdf8', intensity: 1.2 },
  });
  decoBlock('Movement Jump Lane', [3.6, 0.13, z + 0.6], [1.2, 0.045, 5.2], '#fde047', {
    roughness: 0.35,
    emissive: { color: '#fde047', intensity: 1.2 },
  });
  const store = useEditorStore.getState();
  const railA = block('Movement Low Rail A', [-2.4, 0.34, z + 1.4], [2.8, 0.68, 0.22], '#536173', { roughness: 0.6 });
  const railB = block('Movement Low Rail B', [3.6, 0.42, z - 1.2], [2.5, 0.84, 0.22], '#536173', { roughness: 0.6 });
  store.setObjectVariable(railA, 'vaultable', true);
  store.setObjectVariable(railB, 'vaultable', true);
  const posts: Vector3Tuple[] = [[-3.2, 0.65, z - 2.3], [-1.2, 0.65, z - 0.9], [-3.1, 0.65, z + 0.7], [-1.1, 0.65, z + 2.2]];
  posts.forEach((pos, i) => {
    const post = useEditorStore.getState().createObjectWithProps('capsule', { name: `Movement Marker ${i + 1}`, position: pos, color: '#60a5fa' });
    scaled(post, [0.35, 0.65, 0.35]);
    useEditorStore.getState().updateRenderer(post, { materialOverrides: { emissiveColor: '#38bdf8', emissiveIntensity: 0.6 } });
  });
  buildJumpPad(playerId, ui);
}

function buildRagdollStation(playerId: string, ui: TutorialUi, folder: string): void {
  const store = useEditorStore.getState();
  const z = TUTORIAL_ROOM_Z.ragdoll;
  decoBlock('Ragdoll Crash Mat', [0, 0.07, z + 1.6], [5.2, 0.1, 3.2], '#c084fc', {
    emissive: { color: '#c084fc', intensity: 0.9 },
    roughness: 0.35,
  });
  createWorldLabel('Ragdoll Station', [0, 2.45, z + 1.6], '02 RAGDOLL', 'Press E on the pedestal. Press P to recover.', '#c084fc');
  const ped = interactPedestal('Ragdoll Test Pedestal', [0, 0.8, z - 1.8], '#c084fc');
  store.setObjectVariable(ped, 'interactable', true);
  store.setObjectVariable(ped, 'interactPrompt', 'Test ragdoll');
  const { blueprintId: bp } = store.createBlueprintNamed('Ragdoll Tutorial', 'Press E to set the player ragdoll on and update the tutorial HUD.', folder);
  store.attachScript(ped, bp);
  const add = (label: string, data?: Record<string, unknown>) => store.addGraphNodeToBlueprint(bp, label, categoryFor(label), data);
  const ex = (a: string, b: string) => store.connectGraphNodes(bp, a, b, 'exec-out', 'exec-in');
  const onI = add('Interact');
  const setRag = add('Set Ragdoll', { targetObjectId: playerId, booleanValue: true });
  const shake = add('Camera Shake', { shakeAmount: 0.22 });
  const show = add('Show UI', { documentId: ui.documentId });
  const title = add('Set UI Text', { documentId: ui.documentId, elementId: ui.titleId, stringValue: '02 RAGDOLL' });
  const body = add('Set UI Text', {
    documentId: ui.documentId,
    elementId: ui.bodyId,
    stringValue: 'Set Ragdoll hands the character to physics. The follow camera uses a smoothed pivot so the view stays readable while the body moves.',
  });
  const status = add('Set UI Text', { documentId: ui.documentId, elementId: ui.statusId, stringValue: 'Press P to toggle ragdoll recovery.' });
  ex(onI, setRag);
  ex(setRag, shake);
  ex(shake, show);
  ex(show, title);
  ex(title, body);
  ex(body, status);
}

// ----------------------------------------------------------------------------
// Feature stations - each demos one engine system right inside the gym.
// ----------------------------------------------------------------------------

/**
 * SWIM POOL (SW corner). A sunken floor + a translucent water surface + an invisible "water volume"
 * trigger box tagged `volume = 'water'`. Walking into the trigger flips the character into SWIM mode
 * (the controller's swim path takes over: jump = stroke up, crouch = dive down, no gravity).
 */
function buildSwimPool(): void {
  const store = useEditorStore.getState();
  const cx = 0;
  const cz = TUTORIAL_ROOM_Z.water + 0.8;
  const size = 7.4;
  const depth = 1.4;

  // Above-floor training pool: visual rims only, with a walk-in trigger volume so the mode change is obvious.
  decoBlock('Pool Floor', [cx, 0.09, cz], [size, 0.08, size], '#1f3b52', { roughness: 0.55, metalness: 0.08 });
  decoBlock('Pool Rim N', [cx, 0.22, cz - size / 2], [size, 0.25, 0.22], '#4b6577', { roughness: 0.7 });
  decoBlock('Pool Rim S', [cx, 0.22, cz + size / 2], [size, 0.25, 0.22], '#4b6577', { roughness: 0.7 });
  decoBlock('Pool Rim E', [cx + size / 2, 0.22, cz], [0.22, 0.25, size], '#4b6577', { roughness: 0.7 });
  decoBlock('Pool Rim W', [cx - size / 2, 0.22, cz], [0.22, 0.25, size], '#4b6577', { roughness: 0.7 });

  // The water VOLUME — an isTrigger box filling the pool, with a real Water Volume component (style
  // "pool"). The box mesh stays hidden; the engine renders an animated shader surface on its top face
  // (waves, fresnel, caustics, foam) and flips overlapping characters into swim mode. Sized so the
  // waterline sits right at the rim.
  const volume = store.createObjectWithProps('cube', {
    name: 'Water Volume',
    position: [cx, 0.18, cz],
    color: '#3a7fb3',
    physics: { enabled: true, bodyType: 'fixed', collider: 'box', isTrigger: true },
  });
  scaled(volume, [size - 0.4, depth * 0.36, size - 0.4]);
  store.updateRenderer(volume, { enabled: false });
  store.toggleWater(volume);
  store.updateWater(volume, { style: 'pool', underwaterFog: true });

  // A small "Swim Zone" label cube at the pool edge so it reads as an intentional demo, not a hole.
  block('Sign - Swim', [cx + size / 2 + 1.1, 1.0, cz], [0.3, 1.2, 2.4], '#a5f3fc', {
    roughness: 0.4,
    emissive: { color: '#a5f3fc', intensity: 0.6 },
  });
  createWorldLabel('Swim Station', [-4.8, 2.2, cz + 0.8], '03 WATER', 'Walk into the pool. Space swims up; crouch dives.', '#22d3ee');
}

/**
 * CLIMB WALL (NE corner). A tall vertical wall + a "climb volume" trigger in front of it. Walking up
 * to the trigger flips the character into CLIMB mode (the controller locks horizontal motion to the
 * wall, fwd/back keys move up/down). At the top sits an OUTLOOK platform you can drop back off of.
 */
function buildClimbWall(): void {
  const cx = 0;
  const cz = TUTORIAL_ROOM_Z.climb + 3.2;
  const wallH = 6;

  // The wall itself - chunky and obvious, with a vertical "ladder" emissive stripe so it reads as climbable.
  block('Climb Wall', [cx, wallH / 2, cz], [3.2, wallH, 0.4], '#5d6878', { roughness: 0.7 });
  // Three rung-stripes up the face (purely visual).
  for (let i = 0; i < 3; i++) {
    block(`Climb Rung ${i + 1}`, [cx, 1 + i * 1.8, cz - 0.22], [2.4, 0.15, 0.05], '#fbbf24', {
      emissive: { color: '#fbbf24', intensity: 1.4 },
    });
  }

  // The climb VOLUME - a thin tall trigger box in front of the wall. Tagged `volume:'climb'`.
  const store = useEditorStore.getState();
  const volume = store.createObjectWithProps('cube', {
    name: 'Climb Volume',
    position: [cx, wallH / 2, cz - 0.7],
    color: '#fbbf24',
    physics: { enabled: true, bodyType: 'fixed', collider: 'box', isTrigger: true },
  });
  scaled(volume, [3.2, wallH, 1.2]);
  store.updateRenderer(volume, { enabled: false, materialOverrides: { emissiveColor: '#fbbf24', emissiveIntensity: 0.0 } });
  store.setObjectVariable(volume, 'volume', 'climb');

  // The OUTLOOK platform on top - sticks out behind the wall so the player can dismount onto it.
  block('Outlook', [cx, wallH + 0.2, cz + 1.6], [4, 0.4, 3], '#8a8f9b');
  block('Outlook Rail', [cx, wallH + 1.05, cz + 3], [4, 1.2, 0.3], '#7d828e');

  // Sign at the base.
  block('Sign - Climb', [cx - 4.1, 1.0, cz - 0.8], [0.3, 1.2, 2.4], '#fde68a', {
    roughness: 0.4,
    emissive: { color: '#fbbf24', intensity: 0.7 },
  });
  createWorldLabel('Climb Station', [4.8, 3.4, cz - 0.8], '04 CLIMB', 'Enter the yellow volume, then move forward/back.', '#f59e0b');
}

/**
 * LIGHT THEATRE (south, past the cover walls). A polished white capsule statue on a stage, lit by three
 * coloured lights (warm point, cool spot, hot fill) each on an [E] toggle pedestal. Press E to flip a
 * light Set Active on/off and A/B compare the contributions live - the bread-and-butter rendering demo.
 */
function buildLightTheatre(ui?: TutorialUi): void {
  const store = useEditorStore.getState();
  const folder = store.createFolder('Light Theatre');

  const cx = 0;
  const cz = TUTORIAL_ROOM_Z.interaction + 1.0;

  // Stage + back wall + statue pedestal + statue.
  block('Theatre Stage', [cx, 0.05, cz], [10, 0.1, 7], '#1c1f27', { metalness: 0.2, roughness: 0.55 });
  block('Theatre Wall', [cx, 2.5, cz + 4], [8, 5, 0.4], '#262a34', { metalness: 0.1, roughness: 0.85 });
  block('Statue Pedestal', [cx, 0.45, cz], [1.4, 0.9, 1.4], '#0a0c12', { metalness: 0.6, roughness: 0.25 });

  const statue = store.createObjectWithProps('capsule', { name: 'Statue', position: [cx, 2.1, cz], color: '#f5f3ee' });
  scaled(statue, [0.6, 1.2, 0.6]);
  store.updateRenderer(statue, { metalness: 0.1, roughness: 0.35 });

  type LightConfig = {
    name: string;
    pos: Vector3Tuple;
    type: 'point' | 'spot';
    color: string;
    intensity: number;
    distance: number;
    angle?: number;
    aim?: Vector3Tuple;
    pedestal: Vector3Tuple;
  };
  const lightConfigs: LightConfig[] = [
    { name: 'Warm Point', pos: [cx - 2.4, 3.4, cz],     type: 'point', color: '#ffb574', intensity: 18, distance: 12, pedestal: [cx - 3.4, 0.5, cz - 2.6] },
    { name: 'Cool Spot',  pos: [cx,       5.5, cz],     type: 'spot',  color: '#9ec6ff', intensity: 32, distance: 14, angle: Math.PI / 5, aim: [-Math.PI / 2 + 0.15, 0, 0], pedestal: [cx, 0.5, cz - 3.2] },
    { name: 'Hot Fill',   pos: [cx + 2.4, 3.4, cz],     type: 'point', color: '#ff6f9e', intensity: 14, distance: 12, pedestal: [cx + 3.4, 0.5, cz - 2.6] },
  ];

  for (const cfg of lightConfigs) {
    // Visible fixture cube so the light source reads even when off.
    const fixture = store.createObjectWithProps('cube', { name: `${cfg.name} Fixture`, position: cfg.pos, color: cfg.color });
    scaled(fixture, [0.22, 0.22, 0.22]);
    store.updateRenderer(fixture, { materialOverrides: { emissiveColor: cfg.color, emissiveIntensity: 3.2 } });

    const light = store.createObjectWithProps('light', { name: cfg.name, position: cfg.pos });
    store.setObjectLight(light, {
      type: cfg.type,
      color: cfg.color,
      intensity: cfg.intensity,
      distance: cfg.distance,
      angle: cfg.angle ?? Math.PI / 4,
      castShadow: cfg.type === 'spot',
    });
    if (cfg.aim) rotated(light, cfg.aim);

    // [E] toggle pedestal: Interact -> NOT(lightOn) -> Set Object Var + Set Active on the light.
    const ped = interactPedestal(`Toggle - ${cfg.name}`, cfg.pedestal, cfg.color);
    store.setObjectVariable(ped, 'interactable', true);
    store.setObjectVariable(ped, 'interactPrompt', `Toggle ${cfg.name}`);
    store.setObjectVariable(ped, 'lightOn', true);

    const { blueprintId: bp } = store.createBlueprintNamed(`${cfg.name} Toggle`, `On Interact, flip ${cfg.name} on/off via Set Active.`, folder);
    store.attachScript(ped, bp);
    const add = (label: string, data?: Record<string, unknown>) => store.addGraphNodeToBlueprint(bp, label, categoryFor(label), data);
    const ex = (a: string, b: string) => store.connectGraphNodes(bp, a, b, 'exec-out', 'exec-in');
    const vl = (a: string, b: string, handle: string) => store.connectGraphNodes(bp, a, b, 'value-out', handle);

    const onI = add('Interact');
    const getOn = add('Get Object Var', { objectKey: 'lightOn' });
    const flip = add('NOT');
    const setOn = add('Set Object Var', { objectKey: 'lightOn' });
    const setActive = add('Set Active', { targetObjectId: light });
    vl(getOn, flip, 'value');
    vl(flip, setOn, 'value');
    vl(flip, setActive, 'on');
    ex(onI, setOn);
    ex(setOn, setActive);
    if (ui) {
      const show = add('Show UI', { documentId: ui.documentId });
      const title = add('Set UI Text', { documentId: ui.documentId, elementId: ui.titleId, stringValue: '05 INTERACTION' });
      const body = add('Set UI Text', {
        documentId: ui.documentId,
        elementId: ui.bodyId,
        stringValue: `${cfg.name} owns an Interact graph. E flips a local lightOn variable, then drives Set Active on the light object.`,
      });
      const status = add('Set UI Text', { documentId: ui.documentId, elementId: ui.statusId, stringValue: 'Runtime nodes: Interact + NOT + Set Object Var + Set Active' });
      ex(setActive, show);
      ex(show, title);
      ex(title, body);
      ex(body, status);
    }
  }
}

function buildFinalCinematicRoom(playerId: string, ui: TutorialUi, folder: string): void {
  const store = useEditorStore.getState();
  const z = TUTORIAL_ROOM_Z.cinematic;

  decoBlock('Cinematic Stage Floor', [0, 0.13, z + 1.4], [10.5, 0.08, 6.8], '#151923', {
    metalness: 0.18,
    roughness: 0.45,
  });
  block('Cinematic Back Wall', [0, 2.2, z + 5.4], [11, 4.4, 0.38], '#111827', {
    metalness: 0.18,
    roughness: 0.48,
  });
  decoBlock('Cinematic Gold Slate', [0, 0.18, z - 2.9], [5.2, 0.08, 2.1], '#fde047', {
    roughness: 0.28,
    emissive: { color: '#fde047', intensity: 1.8 },
  });
  createWorldLabel('Cinematic Station', [0, 3.1, z - 2.4], '06 CINEMATIC', 'Step onto the gold slate, or press E on the pedestal to replay.', '#fde047');

  const monolith = store.createObjectWithProps('cube', { name: 'Cinematic Hero Monolith', position: [0, 2.1, z + 2.6], color: '#05070c' });
  scaled(monolith, [1.4, 4.2, 1.4]);
  store.updateRenderer(monolith, {
    metalness: 0.42,
    roughness: 0.26,
    materialOverrides: { emissiveColor: '#38bdf8', emissiveIntensity: 0.28 },
  });
  decoBlock('Cinematic Halo Top', [0, 4.45, z + 2.6], [4.4, 0.08, 0.12], '#fde047', {
    roughness: 0.2,
    emissive: { color: '#fde047', intensity: 2.8 },
  });
  decoBlock('Cinematic Halo Bottom', [0, 0.22, z + 2.6], [4.4, 0.08, 0.12], '#38bdf8', {
    roughness: 0.2,
    emissive: { color: '#38bdf8', intensity: 2.2 },
  });

  const orb = store.createObjectWithProps('sphere', { name: 'Cinematic Camera Target Orb', position: [-4.2, 2.2, z + 0.2], color: '#fef3c7' });
  scaled(orb, [0.7, 0.7, 0.7]);
  store.updateRenderer(orb, { materialOverrides: { emissiveColor: '#fde047', emissiveIntensity: 2.4 } });

  const key = store.createObjectWithProps('light', { name: 'Cinematic Key Light', position: [-3.8, 5.6, z - 1.4] });
  store.setObjectLight(key, { type: 'spot', color: '#fff2b8', intensity: 36, distance: 18, angle: Math.PI / 5, castShadow: true });
  rotated(key, [-Math.PI / 3.2, -0.35, 0]);
  const rim = store.createObjectWithProps('light', { name: 'Cinematic Rim Light', position: [4.8, 4.4, z + 3.8] });
  store.setObjectLight(rim, { type: 'point', color: '#7dd3fc', intensity: 22, distance: 15, angle: 0, castShadow: false });

  const cinematicId = store.createCinematic('Room 06 - Basic Camera Pass', 6);
  store.setCinematicLook(cinematicId, {
    letterbox: 2.35,
    grade: 'teal-orange',
    gradeIntensity: 0.78,
    grain: 0.05,
    vignette: 0.22,
  });
  store.addCinematicAction(cinematicId, {
    type: 'fade',
    time: 0,
    duration: 0.55,
    fadeFrom: 0.95,
    fadeTo: 0,
    fadeColor: '#020617',
  });
  store.addCinematicAction(cinematicId, {
    type: 'transform',
    time: 0.35,
    duration: 4.8,
    objectId: orb,
    ease: 'smooth',
    fromPosition: [-4.2, 2.2, z + 0.2],
    toPosition: [4.1, 3.0, z + 3.3],
    fromRotation: [0, 0, 0],
    toRotation: [0, Math.PI * 2, 0],
    fromScale: [0.7, 0.7, 0.7],
    toScale: [1.0, 1.0, 1.0],
  });
  store.addCinematicAction(cinematicId, {
    type: 'material',
    time: 0.4,
    duration: 4.6,
    objectId: orb,
    fromMaterial: { emissiveColor: '#fde047', emissiveIntensity: 1.2 },
    toMaterial: { emissiveColor: '#38bdf8', emissiveIntensity: 4.2 },
  });
  store.addCinematicShot(cinematicId, {
    time: 0,
    duration: 2,
    label: 'Entrance Push',
    position: [0, 2.8, z - 6.2],
    lookAt: [0, 1.7, z + 1.7],
    fov: 54,
    blend: 0,
  });
  store.addCinematicShot(cinematicId, {
    time: 1.8,
    duration: 2.2,
    label: 'Orb Reveal',
    position: [-5.8, 3.1, z + 0.4],
    lookAt: [0, 2.3, z + 2.4],
    fov: 48,
    blend: 1.0,
  });
  store.addCinematicShot(cinematicId, {
    time: 3.8,
    duration: 2.2,
    label: 'Final Hero Frame',
    position: [4.8, 3.2, z + 6.0],
    lookAt: [0, 2.1, z + 2.5],
    fov: 42,
    blend: 1.0,
  });

  const trigger = store.createObjectWithProps('cube', {
    name: 'Final Cinematic Trigger',
    position: [0, 0.75, z - 2.9],
    color: '#fde047',
    physics: { enabled: true, bodyType: 'fixed', collider: 'box', isTrigger: true },
  });
  scaled(trigger, [5.2, 1.25, 2.1]);
  store.updateRenderer(trigger, { enabled: false });

  const { blueprintId: triggerBp } = store.createBlueprintNamed('Final Cinematic Trigger', 'Plays the final room cinematic once when the player enters the gold slate.', folder);
  store.attachScript(trigger, triggerBp);
  const addTrigger = (label: string, data?: Record<string, unknown>) => store.addGraphNodeToBlueprint(triggerBp, label, categoryFor(label), data);
  const exTrigger = (a: string, b: string) => store.connectGraphNodes(triggerBp, a, b, 'exec-out', 'exec-in');
  const enter = addTrigger('Trigger Enter', { otherObjectId: playerId });
  const once = addTrigger('Do Once');
  const play = addTrigger('Play Cinematic', { cinematicId });
  const show = addTrigger('Show UI', { documentId: ui.documentId });
  const title = addTrigger('Set UI Text', { documentId: ui.documentId, elementId: ui.titleId, stringValue: '06 CINEMATIC PLAYING' });
  const body = addTrigger('Set UI Text', {
    documentId: ui.documentId,
    elementId: ui.bodyId,
    stringValue: 'Film Mode is now driving the camera through authored shots while an object transform/material track animates the target orb.',
  });
  const status = addTrigger('Set UI Text', { documentId: ui.documentId, elementId: ui.statusId, stringValue: 'Runtime node: Trigger Enter -> Do Once -> Play Cinematic' });
  exTrigger(enter, once);
  exTrigger(once, play);
  exTrigger(play, show);
  exTrigger(show, title);
  exTrigger(title, body);
  exTrigger(body, status);

  const ped = interactPedestal('Replay Cinematic Pedestal', [5.2, 0.8, z - 1.4], '#fde047');
  store.setObjectVariable(ped, 'interactable', true);
  store.setObjectVariable(ped, 'interactPrompt', 'Replay cinematic');
  const { blueprintId: pedBp } = store.createBlueprintNamed('Replay Final Cinematic', 'Press E in the final room to replay the cinematic sequence.', folder);
  store.attachScript(ped, pedBp);
  const addPed = (label: string, data?: Record<string, unknown>) => store.addGraphNodeToBlueprint(pedBp, label, categoryFor(label), data);
  const exPed = (a: string, b: string) => store.connectGraphNodes(pedBp, a, b, 'exec-out', 'exec-in');
  const onInteract = addPed('Interact');
  const replay = addPed('Play Cinematic', { cinematicId });
  const shake = addPed('Camera Shake', { shakeAmount: 0.1 });
  exPed(onInteract, replay);
  exPed(replay, shake);
}

/**
 * UI SHOWCASE - demos the engine's UI document system in BOTH surfaces:
 *  - SCREEN HUD: a stats panel with a label header, a health bar (bound to the player's `health`), a
 *    counter (interaction count), and a tiny image swatch. Shows the typical inventory/HUD pattern.
 *  - WORLD-SPACE BILLBOARD: a "Welcome to Feather Engine" widget that hovers above the spawn disc and
 *    always faces the camera (Unreal widget-component style).
 */
function buildUIShowcase(playerId: string): TutorialUi {
  const store = useEditorStore.getState();
  const uiFolderEntry = store.folders.find((f) => f.name === 'UI');
  const uiFolderId = uiFolderEntry ? uiFolderEntry.id : store.createFolder('UI');

  // Mirror the player's health into the global `health` variable so the gameplayKit health flow + the
  // healthBar preset (which binds to that variable) show the SAME value on the HUD.
  store.setObjectVariable(playerId, 'health', 100);

  // --- Screen-space stats panel (top-left). Anchored absolute so it sits clear of the controls hint. ---
  const stats = store.createUIDocument('Stats', 'screen');
  store.updateUIDocument(stats, { visibleOnStart: true });

  const panel = store.addUIPreset(stats, undefined, 'panel');
  store.updateUIElement(stats, panel, {
    style: {
      background: 'rgba(10,14,21,0.66)',
      padding: '12px 16px',
      borderRadius: '14px',
      custom: {
        position: 'absolute',
        top: '14px',
        left: '14px',
        border: '1px solid rgba(125,211,252,0.22)',
        borderLeft: '3px solid rgba(56,189,248,0.85)',
        backdropFilter: 'blur(10px)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        minWidth: '220px',
      },
    },
  });

  // Header label.
  const title = store.addUIPreset(stats, panel, 'label');
  store.updateUIElement(stats, title, {
    text: 'PLAYER',
    style: { color: '#9ec6ff', fontSize: '11px', fontWeight: '700', custom: { letterSpacing: '0.18em' } },
  });

  // Health bar preset — auto-creates a global `health` variable and binds the fill to it. The gameplay
  // kit syncs the player's instance health here, so taking damage drives this bar live.
  store.addUIPreset(stats, panel, 'healthBar');

  // A simple flavour label under the bar — proves multi-element panels compose correctly.
  const flavour = store.addUIPreset(stats, panel, 'label');
  store.updateUIElement(stats, flavour, {
    text: 'Status: Nominal',
    style: { color: '#cbd5e1', fontSize: '12px' },
  });

  store.moveToFolder('uiDocument', stats, uiFolderId);

  const tutorial = store.createUIDocument('Tutorial Coach', 'screen');
  store.updateUIDocument(tutorial, { visibleOnStart: true });
  const coach = store.addUIPreset(tutorial, undefined, 'panel');
  store.updateUIElement(tutorial, coach, {
    style: {
      background: 'rgba(8,12,20,0.7)',
      padding: '14px 18px',
      borderRadius: '12px',
      custom: {
        position: 'absolute',
        right: '18px',
        top: '18px',
        border: '1px solid rgba(148,163,184,0.24)',
        borderLeft: '3px solid rgba(253,224,71,0.8)',
        backdropFilter: 'blur(10px)',
        boxShadow: '0 14px 36px rgba(0,0,0,0.38)',
        width: '320px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      },
    },
  });
  // Progress chip ("ROOM 01 / 06") — each room's lesson pad advances it, so the player always knows
  // how far down the corridor they are.
  const lessonProgress = store.addUIPreset(tutorial, coach, 'label');
  store.updateUIElement(tutorial, lessonProgress, {
    text: 'ROOM 00 / 06',
    style: { color: '#fde68a', fontSize: '10px', fontWeight: '700', custom: { letterSpacing: '0.22em' } },
  });
  const lessonTitle = store.addUIPreset(tutorial, coach, 'label');
  store.updateUIElement(tutorial, lessonTitle, {
    text: 'ORIENTATION',
    style: { color: '#f8fafc', fontSize: '15px', fontWeight: '800', custom: { letterSpacing: '0.04em' } },
  });
  const lessonBody = store.addUIElement(tutorial, coach, 'text');
  store.updateUIElement(tutorial, lessonBody, {
    text: 'Move room by room. Each lesson pad updates this panel and demonstrates a real engine system.',
    style: { color: '#cbd5e1', fontSize: '12px', custom: { lineHeight: '1.5' } },
  });
  const lessonStatus = store.addUIPreset(tutorial, coach, 'label');
  store.updateUIElement(tutorial, lessonStatus, {
    text: 'Ready: movement, ragdoll, water, climb, interaction, cinematic.',
    style: { color: '#93c5fd', fontSize: '11px' },
  });
  store.moveToFolder('uiDocument', tutorial, uiFolderId);

  // --- World-space billboard widget hovering above spawn ----------------------------------------------
  const welcome = store.createUIDocument('Welcome Banner', 'world');
  store.updateUIDocument(welcome, { visibleOnStart: true });
  const wPanel = store.addUIPreset(welcome, undefined, 'panel');
  store.updateUIElement(welcome, wPanel, {
    style: {
      background: 'rgba(13,17,23,0.82)',
      padding: '10px 18px',
      borderRadius: '12px',
      custom: { border: '1px solid rgba(253,224,71,0.4)', textAlign: 'center', minWidth: '320px' },
    },
  });
  const wLabel = store.addUIPreset(welcome, wPanel, 'label');
  store.updateUIElement(welcome, wLabel, {
    text: 'WELCOME TO FEATHER ENGINE',
    style: { color: '#fde68a', fontSize: '18px', fontWeight: '800', custom: { letterSpacing: '0.16em' } },
  });
  const wHint = store.addUIElement(welcome, wPanel, 'text');
  store.updateUIElement(welcome, wHint, {
    text: 'Room 01 Movement - 02 Ragdoll - 03 Water - 04 Climb - 05 Interaction - 06 Cinematic',
    style: { color: '#cbd5e1', fontSize: '11px' },
  });
  store.moveToFolder('uiDocument', welcome, uiFolderId);

  // Anchor it to a hidden empty above the spawn disc; billboard=true so it always faces the camera.
  const anchor = store.createObjectWithProps('empty', { name: 'Welcome Anchor', position: [0, 3.6, TUTORIAL_ROOM_Z.movement - 1.0] });
  store.attachUI(anchor, welcome);
  store.updateUIComponent(anchor, { offset: [0, 0, 0], scale: 0.012, billboard: true });
  return { documentId: tutorial, titleId: lessonTitle, bodyId: lessonBody, statusId: lessonStatus, progressId: lessonProgress };
}
