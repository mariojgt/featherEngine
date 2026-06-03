import { getPlatform } from '../platform';
import { useProjectStore } from '../store/projectStore';
import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import { inspectModel } from '../three/inspectModel';
import { terrainWorldHeightAt } from '../terrain/terrain';
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
    return undefined; // missing/unreadable model — the starter still builds without it
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
    return undefined; // missing sound — the starter still plays, just silently
  }
}

/** Re-read the live terrain object and sample its surface height at a world (x,z). Falls back to 0. */
type GroundFn = (x: number, z: number) => number;
function makeGroundFn(terrainId: string): GroundFn {
  return (x, z) => {
    const terrain = selectActiveObjects(useEditorStore.getState()).find((o) => o.id === terrainId);
    return (terrain ? terrainWorldHeightAt(terrain, x, z) : undefined) ?? 0;
  };
}

/**
 * Build a ready-to-play, ZELDA-LIKE OPEN-WORLD third-person starter from the bundled rig:
 *  - a procedural TERRAIN island (rolling hills, grass + trees foliage, painted material layers) you roam freely;
 *  - a golden-hour SKY + atmospheric FOG (the scene environment system) for mood and depth;
 *  - a sword-wielding PLAYER pawn (locomotion animator + over-the-shoulder camera + melee + a bow);
 *  - a village ELDER you talk to (interact) who gives a 3-step QUEST CHAIN — find 3 lost relics, then clear the
 *    ruins and reach the shrine — tracked by a HUD relic counter + a swapping objective banner;
 *  - a few editable AI ENEMIES (ranged Skeletons, a melee Brute) and a tanky BOSS Champion guarding the shrine;
 *  - an autoplay intro CINEMATIC that sweeps the Vale and settles behind the player.
 * Everything is built from the engine's own systems (terrain, environment, blueprints, custom events, triggers,
 * UI, cinematics) so the whole thing is editable in the editor. Returns the player's object id.
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

  // Clear the default starter-scene objects (the blue Player cube, the flat Ground plane, the red Enemy sphere,
  // and the placeholder camera) so they don't clutter the world or sit at the origin. The flat Ground plane in
  // particular has a box collider at y=0 that pokes through the terrain and snags the collision-aware follow
  // camera — removing it is what stops the "grid in the middle" + camera-collision on Play. (No-ops on a scene
  // that doesn't have these default ids; the directional light is kept so there's always baseline lighting.)
  for (const defaultId of ['obj-player', 'obj-ground', 'obj-enemy', 'obj-camera']) {
    if (selectActiveObjects(useEditorStore.getState()).some((o) => o.id === defaultId)) {
      store.deleteObject(defaultId);
    }
  }

  // --- 1. THE VALE: a procedural terrain island. Rolling hills (low heightScale → gentle, walkable slopes),
  //        mixed grass + tree foliage, and a green→meadow→rock material palette. Physics heightfield colliders
  //        stream in around the player at Play, so the pawn + enemies walk the surface for free. ---
  const worldFolder = store.createFolder('World');
  // NOTE: we deliberately keep this terrain PURELY PROCEDURAL (no sculpt/paint overrides). Every terrain
  // sample re-normalizes the full heightOverrides/paintOverrides maps, so seeding hundreds of edits here would
  // make geometry/foliage/physics generation pathologically slow (a multi-minute freeze on load). The hills are
  // gentle enough to drop a village onto as-is; sculpt/paint interactively in the Terrain Editor instead.
  const terrainId = store.createObjectWithProps('terrain', {
    name: 'The Vale',
    position: [0, 0, 0],
    terrain: {
      size: 200,
      chunkSize: 32,
      resolution: 18,
      streamRadius: 4,
      physicsRadius: 2,
      seed: 24,
      heightScale: 4.5, // gentle, walkable rolling hills — calm enough for the village to sit on
      frequency: 0.014,
      octaves: 4,
      persistence: 0.5,
      lacunarity: 2,
      lowColor: '#4c7a3f',
      midColor: '#6f8f4f',
      highColor: '#b7ad94',
      foliage: {
        enabled: true,
        mode: 'mixed',
        density: 0.4,
        treeDensity: 0.16,
        minScale: 0.8,
        maxScale: 1.9,
        slopeLimit: 0.66,
        grassMesh: 'blade',
        treeMesh: 'cone',
        grassColor: '#5aa24c',
        trunkColor: '#6b4a2f',
        treeColor: '#2f7d45',
      },
    },
  });

  const groundY = makeGroundFn(terrainId);

  // --- 2. ENVIRONMENT: a warm golden-hour sky with a low sun + atmospheric fog that fades the far hills, so the
  //        open world reads with depth and mood. Tune in Scene Settings → Environment. ---
  store.updateSceneEnvironment(sceneId, {
    skyMode: 'procedural',
    skyTopColor: '#3f74d6',
    skyHorizonColor: '#f7c98a',
    skyGroundColor: '#23304a',
    environmentIntensity: 1.1,
    sunColor: '#ffdca0',
    sunIntensity: 1.4,
    sunAzimuth: 52,
    sunElevation: 22, // low sun = long warm light
    fogEnabled: true,
    fogColor: '#cdb89a',
    fogNear: 40,
    fogFar: 165, // far enough to explore, near enough to feel atmospheric
  });
  // Punchy bloom + vignette so relics, the campfire and the shrine glow cinematically.
  store.updateRenderSettings({ bloomEnabled: true, bloomIntensity: 0.95, bloomThreshold: 0.6, bloomRadius: 0.7, vignetteEnabled: true });

  // --- 3. PLAYER: the bundled rig with a full locomotion animator + the gameplay kit (health, interactions,
  //        emotes, ranged) and a sword-first inventory. Over-the-shoulder camera for exploration. ---
  const pawnId = store.createCharacterPawn(modelAsset.id, 'Player');
  if (!pawnId) return undefined;
  store.updateTransform(pawnId, 'position', [0, groundY(0, 0) + 0.1, 0]);

  const kit = useEditorStore.getState().addGameplayKit;
  kit(pawnId, 'health');
  kit(pawnId, 'interactions'); // adds the "Interact" (E) ability used to talk to the Elder
  kit(pawnId, 'emotes');
  kit(pawnId, 'ranged'); // the bow uses the same aim/shoot pipeline

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
    // Over-the-shoulder exploration camera — pulled back a touch so you can read the open world.
    cameraOffset: [0.62, 1.7, -3.2],
    cameraPitch: 0.17,
    cameraMinPitch: -0.35,
    cameraMaxPitch: 0.95,
    mouseSensitivity: 0.0023,
    turnSpeed: 13,
    // Satisfying sword reach: an LMB swing damages every foe in a front cone within meleeRange.
    meleeDamage: 45,
    meleeRange: 2.7,
    interactRange: 3.2,
  });

  // Combat/HUD-driving instance vars: health is the source of truth (mirrored to the HUD bar + death/ragdoll),
  // ammo feeds the bow's counter + per-shot consumption.
  useEditorStore.getState().setObjectVariable(pawnId, 'health', 100);
  useEditorStore.getState().setObjectVariable(pawnId, 'ammo', 20);
  useEditorStore.getState().setObjectVariable(pawnId, 'ammoMax', 20);

  // Atmosphere: a looping ambient bed + background music (Play starts/stops them).
  const [ambient, music] = await Promise.all([importBundledAudio('ambient.mp3'), importBundledAudio('music.mp3')]);
  useEditorStore.getState().setSceneAudio(sceneId, { ambientSoundId: ambient, musicSoundId: music });

  // Weapons + inventory + the click-to-shoot gate (all the per-pawn combat plumbing).
  const relicsVarId = await assemblePlayerKit(pawnId, switchSound);

  // World dressing (village + ruins + shrine + lights), the quest chain (Elder + objectives + relics), the
  // enemy encounter, and the intro cinematic — each builds on top of the terrain.
  buildWorld(pawnId, terrainId, groundY, worldFolder);
  buildQuest(pawnId, terrainId, groundY, relicsVarId);
  buildEnemies(pawnId, terrainId, groundY);
  buildIntroCinematic();

  // Tidy the imported sounds into an Audio folder.
  const audioFolder = useEditorStore.getState().createFolder('Audio');
  for (const id of [footstep, jump, land, swing, hurt, ambient, music, switchSound]) {
    if (id) useEditorStore.getState().moveToFolder('asset', id, audioFolder);
  }
  return pawnId;
}

// hand_r bind orientation (from the GLB): local +Z → world forward, local +X → world up. The sword's blade is
// the model's +Z and the bow/pistol's barrel is the model's +X, so each weapon gets a full local grip offset.
const SWORD_SCALE = 0.85;
const BOW_SCALE = 0.34;
const SWORD_ROTATION: Vector3Tuple = [0, (90 * Math.PI) / 180, 0];
const BOW_ROTATION: Vector3Tuple = [0, (-90 * Math.PI) / 180, Math.PI];
const SWORD_POSITION: Vector3Tuple = [0.015, -0.02, 0.02];
const BOW_POSITION: Vector3Tuple = [0.035, -0.035, 0.055];

/**
 * Per-pawn combat kit: imports the sword + bow models, builds the RightHand socket, the click-to-shoot gate
 * (only while the bow/ranged weapon is out), the HUD (health bar + controls hint + relic counter), and a
 * Fist / Sword / Bow inventory bar (sword equipped to start — melee is the hero weapon). Returns the project
 * variable id backing the relic HUD counter (created here so the quest can read it).
 */
async function assemblePlayerKit(pawnId: string, switchSound: string | undefined): Promise<string> {
  const swordAsset = await importBundledModel('Sword.glb');
  const bowAsset = await importBundledModel('Pistol.glb'); // reused as the "bow" ranged weapon

  const store = useEditorStore.getState();
  const player = selectActiveObjects(store).find((o) => o.id === pawnId);
  const blueprintId = player?.script?.blueprintId;
  const controller = store.animatorControllers.find((c) => c.id === player?.animator?.controllerId);
  const skeletonId =
    controller?.skeletonId ?? store.skeletalMeshes.find((m) => m.sourceAssetId === player?.renderer?.modelAssetId)?.skeletonId;

  const weaponsFolder = store.createFolder('Weapons');
  const uiFolder = store.createFolder('UI');
  if (swordAsset) store.moveToFolder('asset', swordAsset, weaponsFolder);
  if (bowAsset) store.moveToFolder('asset', bowAsset, weaponsFolder);
  if (blueprintId) store.moveToFolder('blueprint', blueprintId, store.createFolder('Player'));

  // Pick equip montages from the rig by best-effort name match (a missing clip just no-ops).
  const clips = skeletonId ? store.animations.filter((a) => a.skeletonId === skeletonId) : [];
  const pickClip = (...patterns: RegExp[]) => {
    for (const p of patterns) {
      const found = clips.find((c) => p.test(c.name));
      if (found) return found.id;
    }
    return undefined;
  };
  const swordEquipAnim = pickClip(/sword.*enter/i, /sword.*idle/i, /equip/i, /draw/i, /unsheath/i);
  const bowEquipAnim = pickClip(/bow/i, /pistol.*idle/i, /pistol.*aim/i, /aim/i, /equip/i, /draw/i);

  if (skeletonId) store.addSkeletonSocket(skeletonId, { name: 'RightHand', boneName: 'hand_r' });

  // --- Click (release) → fire an arrow, but ONLY while the bow (RangedMode) is out. With the sword out the
  //     same LMB instead triggers a melee swing (handled by the controller — damages the front cone). ---
  if (blueprintId) {
    const RUNTIME = new Set(['Spawn Projectile', 'Get Anim Param']);
    const add = (label: string, data?: Record<string, unknown>) =>
      store.addGraphNodeToBlueprint(blueprintId, label, RUNTIME.has(label) ? 'Runtime' : label === 'Branch' ? 'Logic' : 'Events', data);
    const shoot = add('Key Up', { keyCode: 'Mouse0' });
    const rangedCheck = add('Get Anim Param', { paramName: 'RangedMode' });
    const gate = add('Branch');
    const fire = add('Spawn Projectile', { projectileSpeed: 26, projectileDamage: 30, projectileColor: '#ffe08a', projectileSize: 0.16, projectileLife: 3 });
    store.connectGraphNodes(blueprintId, rangedCheck, gate, 'value-out', 'condition');
    store.connectGraphNodes(blueprintId, shoot, gate, 'exec-out', 'exec-in');
    store.connectGraphNodes(blueprintId, gate, fire, 'exec-out', 'exec-in');
  }

  // --- HUD: a controls hint + a health bar bound to the player's mirrored Health variable. ---
  const hud = store.createUIDocument('HUD', 'screen');
  store.updateUIDocument(hud, { visibleOnStart: true });
  const hintId = store.addUIPreset(hud, undefined, 'label');
  store.updateUIElement(hud, hintId, {
    text: 'WASD move · Mouse look · Shift sprint · Space jump · LMB attack · RMB aim · E talk/interact',
    style: { color: '#8a93a6', fontSize: '12px', custom: { position: 'absolute', bottom: '14px', left: '16px', opacity: '0.75' } },
  });
  store.addUIPreset(hud, undefined, 'healthBar', { variableName: 'Health' });
  store.moveToFolder('uiDocument', hud, uiFolder);

  // Relic HUD counter (top-left "Relics: N") + the backing project variable the relic pickups increment.
  const counter = store.createCollectibleCounter({
    name: 'Relic Seed', // a throwaway pickup so the counter + variable exist; we hide + remove it below
    variableName: 'Relics',
    label: 'Relics',
    amount: 0,
    color: '#9be7ff',
    position: [0, -50, 0],
    playerObjectId: pawnId,
  });
  store.deleteObject(counter.objectId); // remove the seed pickup; the counter UI + 'Relics' variable remain
  store.deleteBlueprint(counter.blueprintId); // ...and its now-orphaned pickup logic
  store.moveToFolder('uiDocument', counter.uiDocumentId, uiFolder);

  // --- Inventory bar: Fist / Sword / Bow. Sword is equipped to start (melee hero weapon). Clicking a slot
  //     swaps the held weapon, plays its equip montage + switch sound, and sets RangedMode (the shoot gate). ---
  if (switchSound) {
    const audioFolder = useEditorStore.getState().folders.find((f) => f.name === 'Audio');
    if (audioFolder) store.moveToFolder('asset', switchSound, audioFolder.id);
  }
  store.setInventory(pawnId, {
    slots: [
      { label: 'Fist', ranged: false },
      ...(swordAsset
        ? [{ label: 'Sword', weaponAssetId: swordAsset, ranged: false, attachScale: SWORD_SCALE, attachYaw: SWORD_ROTATION[1], attachPosition: SWORD_POSITION, attachRotation: SWORD_ROTATION, equipAnimId: swordEquipAnim }]
        : []),
      ...(bowAsset
        ? [{ label: 'Bow', weaponAssetId: bowAsset, ranged: true, attachScale: BOW_SCALE, attachYaw: BOW_ROTATION[1], attachPosition: BOW_POSITION, attachRotation: BOW_ROTATION, equipAnimId: bowEquipAnim }]
        : []),
    ],
    equipped: swordAsset ? 1 : 0, // start with the sword drawn
    boneName: 'hand_r',
    socketName: 'RightHand',
    switchSoundId: switchSound,
  });

  return counter.variableId;
}

/** Node-category inference shared by the world/quest/enemy blueprint builders. */
function categoryFor(label: string): GraphNodeCategory {
  if (['Start', 'Update', 'Custom Event', 'Trigger Enter', 'Trigger Exit', 'Collision Enter', 'Interact', 'Key Down', 'Key Up'].includes(label)) return 'Events';
  if (['Branch', 'Compare', 'AND', 'OR'].includes(label)) return 'Logic';
  if (['Get Variable', 'Set Variable', 'Get Object Var', 'Set Object Var'].includes(label)) return 'Variables';
  if (['Add', 'Clamp', 'Lerp'].includes(label)) return 'Math';
  if (['Number', 'String', 'Boolean', 'Vector3'].includes(label)) return 'Values';
  if (['Show UI', 'Hide UI', 'Set UI Text'].includes(label)) return 'UI';
  return 'Runtime';
}

/**
 * Hand-built world dressing on top of the terrain: a small village (huts + a glowing campfire), a ruined arena
 * to the north (broken walls + cover the enemies guard), a glowing shrine beyond it (the quest's end), plus
 * colored point lights + emissive waypoint beacons that bloom and pull the eye toward each landmark. All purely
 * visual / collidable — safe to retune or delete. Everything nests under the "World" folder's logic where it has any.
 */
function buildWorld(_pawnId: string, _terrainId: string, groundY: GroundFn, _worldFolder: string): void {
  const store = useEditorStore.getState();

  const block = (name: string, x: number, z: number, scale: Vector3Tuple, color: string, yLift = 0, rotation?: Vector3Tuple) => {
    const id = store.createObjectWithProps('cube', {
      name,
      position: [x, groundY(x, z) + scale[1] / 2 + yLift - 0.15, z],
      color,
      physics: { enabled: true, bodyType: 'fixed', collider: 'box' },
    });
    store.updateTransform(id, 'scale', scale);
    if (rotation) store.updateTransform(id, 'rotation', rotation);
    return id;
  };

  // --- Village (around spawn): a few simple huts the player explores between. ---
  const hut = (x: number, z: number, color: string) => {
    block(`Hut`, x, z, [3.4, 2.6, 3.4], color);
    block(`Hut Roof`, x, z, [4, 1, 4], '#6b4a2f', 2.4); // a darker "roof" block perched on top
  };
  hut(-9, 5, '#caa777');
  hut(8, 7, '#bfa06d');
  hut(-6, -8, '#c4a980');

  // Glowing campfire at the village centre — emissive logs + a warm point light + a beacon glow.
  const fire = store.createObjectWithProps('sphere', { name: 'Campfire', position: [4, groundY(4, 0) + 0.3, 0], color: '#ff8a3d' });
  store.updateTransform(fire, 'scale', [0.5, 0.5, 0.5]);
  store.updateRenderer(fire, { materialOverrides: { emissiveColor: '#ff8a3d', emissiveIntensity: 3 } });
  const fireLight = store.createObjectWithProps('light', { name: 'Campfire Light', position: [4, groundY(4, 0) + 1.2, 0] });
  store.setObjectLight(fireLight, { type: 'point', color: '#ffb066', intensity: 14, distance: 16, castShadow: false });

  // --- Ruined arena to the north (+z): broken walls + scattered cover the enemies fight from. ---
  block('Ruin Wall W', -8, 58, [0.6, 3, 14], '#8b8475');
  block('Ruin Wall E', 8, 58, [0.6, 3, 14], '#8b8475');
  block('Ruin Wall N', 0, 65, [16, 3, 0.6], '#807a6b');
  block('Broken Pillar 1', -3, 54, [1, 2.4, 1], '#9a937f');
  block('Broken Pillar 2', 4, 60, [1, 1.6, 1], '#9a937f');
  block('Rubble Cover', -2, 60, [2.6, 1, 1.2], '#736d5e');

  // --- Shrine beyond the ruins (the quest's end): a glowing dais + pillars that bloom in the fog. ---
  const shrineBaseY = groundY(0, 78);
  const dais = store.createObjectWithProps('cube', { name: 'Shrine Dais', position: [0, shrineBaseY + 0.25, 78], color: '#cfd6e6', physics: { enabled: true, bodyType: 'fixed', collider: 'box' } });
  store.updateTransform(dais, 'scale', [6, 0.5, 6]);
  const crystal = store.createObjectWithProps('sphere', { name: 'Shrine Crystal', position: [0, shrineBaseY + 1.8, 78], color: '#9be7ff' });
  store.updateTransform(crystal, 'scale', [1, 1.4, 1]);
  store.updateRenderer(crystal, { metalness: 0.1, roughness: 0.3, materialOverrides: { emissiveColor: '#9be7ff', emissiveIntensity: 3.2 } });
  const shrineLight = store.createObjectWithProps('light', { name: 'Shrine Light', position: [0, shrineBaseY + 3, 78] });
  store.setObjectLight(shrineLight, { type: 'point', color: '#7fd6ff', intensity: 18, distance: 26, castShadow: false });

  // Emissive waypoint beacons that bloom toward each landmark (village → relics out in the world → ruins → shrine).
  const beacon = (name: string, x: number, z: number, color: string) => {
    const id = store.createObjectWithProps('sphere', { name, position: [x, groundY(x, z) + 0.6, z], color });
    store.updateTransform(id, 'scale', [0.3, 0.3, 0.3]);
    store.updateRenderer(id, { materialOverrides: { emissiveColor: color, emissiveIntensity: 2.6 } });
  };
  beacon('Beacon · Ruins', 0, 48, '#ff9a6b');
  beacon('Beacon · Shrine', 0, 72, '#9be7ff');
}

/**
 * The QUEST CHAIN, built entirely from the engine's own systems (interact event, custom events, instance vars,
 * triggers, UI). A village ELDER (interactable rig) drives a 3-step story:
 *   stage 0 → talk → "find my 3 lost relics" (3 collectible relics scattered in the Vale; HUD counter tracks them)
 *   stage 1 → collect all 3 → the Elder auto-advances + asks you to return (Update watches the Relics variable)
 *   stage 2 → talk again → "clear the ruins & reach the shrine" (heals you for the fight)
 *   stage 3 → step onto the shrine dais → quest complete 🎉
 * A "Quest Director" swaps a styled objective banner each step. Returns the relic project-variable id.
 */
function buildQuest(pawnId: string, terrainId: string, groundY: GroundFn, relicsVarId: string): string {
  const store = useEditorStore.getState();
  const folder = store.createFolder('Quests');

  // --- Objective banners: one hidden top-center pill per step; the Director shows/hides them in turn. ---
  const makeObjective = (text: string): string => {
    const doc = store.createUIDocument('Objective', 'screen');
    store.updateUIDocument(doc, { visibleOnStart: false, css: '@keyframes nf-obj-in { from { opacity: 0; transform: translate(-50%, -10px); } to { opacity: 1; transform: translate(-50%, 0); } }' });
    const label = store.addUIPreset(doc, undefined, 'label');
    store.updateUIElement(doc, label, {
      text,
      style: {
        color: '#eaf2ff', fontSize: '16px', fontWeight: '600', background: 'rgba(13,16,23,0.82)', padding: '10px 20px', borderRadius: '999px',
        custom: { position: 'absolute', top: '52px', left: '50%', transform: 'translateX(-50%)', whiteSpace: 'nowrap', border: '1px solid rgba(123,223,255,0.45)', boxShadow: '0 4px 18px rgba(0,0,0,0.45)', animation: 'nf-obj-in 0.28s ease-out' },
      },
    });
    store.moveToFolder('uiDocument', doc, folder);
    return doc;
  };
  const obTalk = makeObjective('◆  Quest — Speak with the Elder in the village (press E).');
  const obRelics = makeObjective('◆  Quest — Recover the 3 lost relics scattered across the Vale.');
  const obReturn = makeObjective('◆  Quest — Return to the Elder with the relics.');
  const obCombat = makeObjective('⚔  Quest — Clear the northern ruins and reach the glowing shrine.');
  const obDone = makeObjective('🎉  Quest complete — the Vale is safe. Roam, fight and explore freely!');

  // --- Dialogue box: one styled panel + line of text the Elder rewrites per step (Set UI Text), shown on
  //     interact and hidden when you step away from the Elder. ---
  const dialogue = store.createUIDocument('Elder Dialogue', 'screen');
  store.updateUIDocument(dialogue, { visibleOnStart: false });
  const dlgPanel = store.addUIPreset(dialogue, undefined, 'panel');
  store.updateUIElement(dialogue, dlgPanel, {
    style: { background: 'rgba(12,14,20,0.9)', padding: '16px 22px', borderRadius: '14px', custom: { position: 'absolute', bottom: '120px', left: '50%', transform: 'translateX(-50%)', maxWidth: '560px', border: '1px solid rgba(123,223,255,0.4)', boxShadow: '0 8px 28px rgba(0,0,0,0.5)' } },
  });
  const dlgText = store.addUIElement(dialogue, dlgPanel, 'text');
  store.updateUIElement(dialogue, dlgText, { text: '…', style: { color: '#eaf2ff', fontSize: '16px', fontWeight: '500', custom: { whiteSpace: 'pre-line', lineHeight: '1.4' } } });
  store.moveToFolder('uiDocument', dialogue, folder);

  // --- Quest Director: Start shows step 1; custom events (q_relics / q_return / q_combat / q_done) swap banners. ---
  const dirObj = store.createObjectWithProps('empty', { name: 'Quest Director', position: [0, 0, 0] });
  const { blueprintId: dirBp } = store.createBlueprintNamed('Quest Director', 'Swaps the on-screen objective banner each quest step. Open me to retune the flow.', folder);
  store.attachScript(dirObj, dirBp);
  const addD = (label: string, data?: Record<string, unknown>) => store.addGraphNodeToBlueprint(dirBp, label, categoryFor(label), data);
  const wireD = (a: string, b: string) => store.connectGraphNodes(dirBp, a, b, 'exec-out', 'exec-in');
  wireD(addD('Start'), addD('Show UI', { documentId: obTalk }));
  const step = (eventName: string, hideDoc: string, showDoc: string) => {
    const ev = addD('Custom Event', { eventName });
    const hide = addD('Hide UI', { documentId: hideDoc });
    wireD(ev, hide);
    wireD(hide, addD('Show UI', { documentId: showDoc }));
  };
  step('q_relics', obTalk, obRelics);
  step('q_return', obRelics, obReturn);
  step('q_combat', obReturn, obCombat);
  step('q_done', obCombat, obDone);

  // --- The Elder: the same rig, recolored, planted as a friendly NPC. Marked interactable so the player can
  //     talk (E). One consolidated blueprint handles BOTH the dialogue branching (on interact) and the relic
  //     auto-advance (on update). `stage` lives on the Elder as the quest's state machine. ---
  const elderModel = selectActiveObjects(store).find((o) => o.id === pawnId)?.renderer?.modelAssetId;
  const elderId = elderModel ? store.createCharacterPawn(elderModel, 'Elder') : store.createObjectWithProps('capsule', { name: 'Elder' });
  if (!elderId) return relicsVarId;
  // Drop the auto WASD brain a pawn ships with; the Elder stands still and runs the quest brain instead.
  const elderAutoBp = useEditorStore.getState().scenes.flatMap((s) => s.objects).find((o) => o.id === elderId)?.script?.blueprintId;
  store.updateTransform(elderId, 'position', [-2, groundY(-2, 4) + 0.1, 4]);
  store.updateRenderer(elderId, { color: '#e8d9a0', overrideMaterial: true });
  if (elderModel) store.updateCharacterController(elderId, { moveSpeed: 0, sprintMultiplier: 1, jumpStrength: 0, cameraFollow: false, mouseLook: false });
  store.setObjectVariable(elderId, 'stage', 0);
  store.setObjectVariable(elderId, 'interactable', true);
  store.setObjectVariable(elderId, 'interactPrompt', 'Talk to the Elder');

  const { blueprintId: elderBp } = store.createBlueprintNamed('Elder Quest Brain', 'The village Elder: dialogue branching on interact + relic auto-advance on update. `stage` is the quest state.', folder);
  store.attachScript(elderId, elderBp);
  if (elderAutoBp && elderAutoBp !== elderBp) store.deleteBlueprint(elderAutoBp);

  const addE = (label: string, data?: Record<string, unknown>) => store.addGraphNodeToBlueprint(elderBp, label, categoryFor(label), data);
  const ex = (a: string, b: string) => store.connectGraphNodes(elderBp, a, b, 'exec-out', 'exec-in');
  const vl = (a: string, b: string, handle: string) => store.connectGraphNodes(elderBp, a, b, 'value-out', handle);

  const line0 = 'Traveler! Beasts scattered my three sacred relics across the Vale.\nBring them home and the path ahead will open.';
  const line2 = 'You found them all — bless you!\nNow drive the monsters from the northern ruins and reach the shrine. Take my strength.';

  // INTERACT handler — branch on `stage` so the same key advances the story.
  const onInteract = addE('Interact');
  const getStageA = addE('Get Object Var', { objectKey: 'stage' });
  // stage == 0 → give the relic quest.
  const cmp0 = addE('Compare', { compareOp: '==', numberValue: 0 });
  const br0 = addE('Branch');
  vl(getStageA, cmp0, 'a');
  vl(cmp0, br0, 'condition');
  ex(onInteract, br0);
  const set0 = addE('Set UI Text', { documentId: dialogue, elementId: dlgText, stringValue: line0 });
  const show0 = addE('Show UI', { documentId: dialogue });
  const stage1 = addE('Set Object Var', { objectKey: 'stage', numberValue: 1 });
  const fireRelics = addE('Fire Event', { eventName: 'q_relics' });
  ex(br0, set0);
  ex(set0, show0);
  ex(show0, stage1);
  ex(stage1, fireRelics);
  // stage == 2 → relics returned: send the player to the ruins + heal for the fight.
  const cmp2 = addE('Compare', { compareOp: '==', numberValue: 2 });
  const br2 = addE('Branch');
  vl(getStageA, cmp2, 'a');
  vl(cmp2, br2, 'condition');
  ex(onInteract, br2);
  const set2 = addE('Set UI Text', { documentId: dialogue, elementId: dlgText, stringValue: line2 });
  const show2 = addE('Show UI', { documentId: dialogue });
  const stage3 = addE('Set Object Var', { objectKey: 'stage', numberValue: 3 });
  const fireCombat = addE('Fire Event', { eventName: 'q_combat' });
  const heal = addE('Set Object Var', { objectKey: 'health', numberValue: 100, targetObjectId: pawnId });
  ex(br2, set2);
  ex(set2, show2);
  ex(show2, stage3);
  ex(stage3, fireCombat);
  ex(fireCombat, heal);

  // UPDATE handler — when all 3 relics are in AND we're still on the relic step, auto-advance to "return".
  const onUpdate = addE('Update');
  const getRelics = addE('Get Variable', { variableId: relicsVarId });
  const cmpRelics = addE('Compare', { compareOp: '>=', numberValue: 3 });
  const getStageB = addE('Get Object Var', { objectKey: 'stage' });
  const cmpStage1 = addE('Compare', { compareOp: '==', numberValue: 1 });
  const bothIn = addE('AND');
  const brAuto = addE('Branch');
  vl(getRelics, cmpRelics, 'a');
  vl(getStageB, cmpStage1, 'a');
  vl(cmpRelics, bothIn, 'a');
  vl(cmpStage1, bothIn, 'b');
  vl(bothIn, brAuto, 'condition');
  ex(onUpdate, brAuto);
  const stage2 = addE('Set Object Var', { objectKey: 'stage', numberValue: 2 });
  const fireReturn = addE('Fire Event', { eventName: 'q_return' });
  ex(brAuto, stage2);
  ex(stage2, fireReturn);

  // --- Elder proximity zone: hide the dialogue box when the player walks away. ---
  const zone = store.createObjectWithProps('empty', { name: 'Elder Zone', position: [-2, groundY(-2, 4) + 1.2, 4], physics: { enabled: true, bodyType: 'dynamic', collider: 'box', isTrigger: true, gravityScale: 0 } });
  store.updateTransform(zone, 'scale', [6, 3, 6]);
  const { blueprintId: zoneBp } = store.createBlueprintNamed('Elder Zone Logic', 'Hide the Elder dialogue when the player leaves.', folder);
  store.attachScript(zone, zoneBp);
  const zExit = store.addGraphNodeToBlueprint(zoneBp, 'Trigger Exit', 'Events', { otherObjectId: pawnId });
  const zHide = store.addGraphNodeToBlueprint(zoneBp, 'Hide UI', 'UI', { documentId: dialogue });
  store.connectGraphNodes(zoneBp, zExit, zHide, 'exec-out', 'exec-in');

  // --- The 3 relics: glowing collectibles scattered across the Vale that increment the 'Relics' counter on
  //     touch (self-contained pickups from the engine's collectible helper). Placed at scenic spots to reward
  //     exploration; lifted onto the terrain surface. ---
  const relicSpots: Array<[number, number]> = [
    [-52, 28], // a far western hill
    [46, -34], // across the southern fields
    [30, 50], // tucked near the ruins
  ];
  const pickupFolder = store.createFolder('Pickups');
  relicSpots.forEach(([x, z], i) => {
    const c = store.createCollectibleCounter({
      name: `Relic ${i + 1}`,
      variableName: 'Relics',
      label: 'Relics',
      amount: 1,
      color: '#9be7ff',
      position: [x, groundY(x, z) + 1, z],
      playerObjectId: pawnId,
    });
    store.updateRenderer(c.objectId, { materialOverrides: { emissiveColor: '#9be7ff', emissiveIntensity: 2.8 } });
    // The helper makes a tiny 0.35-unit sphere — enlarge it into a readable, easy-to-walk-into relic so the
    // trigger has a generous catch radius (and it sits at the player's chest height to overlap the capsule).
    store.updateTransform(c.objectId, 'scale', [1.3, 1.6, 1.3]);
    store.updateTransform(c.objectId, 'position', [x, groundY(x, z) + 1.1, z]);
    store.moveToFolder('blueprint', c.blueprintId, pickupFolder);
    // A small beacon light over each relic so it reads from afar in the fog.
    const lid = store.createObjectWithProps('light', { name: `Relic ${i + 1} Glow`, position: [x, groundY(x, z) + 2, z] });
    store.setObjectLight(lid, { type: 'point', color: '#7fd6ff', intensity: 8, distance: 12, castShadow: false });
  });

  // Two stat pickups near the ruins approach — top up before the fight (reuses the same portable-prefab pattern).
  const statPickup = (name: string, x: number, z: number, color: string, varKey: string, value: number) => {
    const id = store.createObjectWithProps('cube', { name, position: [x, groundY(x, z) + 0.6, z], color, physics: { enabled: true, bodyType: 'dynamic', collider: 'box', isTrigger: true, gravityScale: 0 } });
    store.updateTransform(id, 'scale', [0.6, 0.6, 0.6]);
    store.updateRenderer(id, { materialOverrides: { emissiveColor: color, emissiveIntensity: 0.7 } });
    const { blueprintId: bp } = store.createBlueprintNamed(`${name} Logic`, `Refill ${varKey} on the toucher, then despawn.`, pickupFolder);
    store.attachScript(id, bp);
    const trg = store.addGraphNodeToBlueprint(bp, 'Trigger Enter', 'Events', { otherObjectId: pawnId });
    const give = store.addGraphNodeToBlueprint(bp, 'Set Object Var', 'Variables', { objectKey: varKey, numberValue: value, targetObjectId: '$trigger' });
    const destroy = store.addGraphNodeToBlueprint(bp, 'Destroy Object', 'Runtime');
    store.connectGraphNodes(bp, trg, give, 'exec-out', 'exec-in');
    store.connectGraphNodes(bp, give, destroy, 'exec-out', 'exec-in');
    store.createPrefabFromObject(id, `${name} Prefab`, pickupFolder);
  };
  statPickup('Health Herb', -4, 44, '#4ade80', 'health', 100);
  statPickup('Arrow Bundle', 4, 44, '#fbbf24', 'ammo', 20);

  // --- Shrine trigger: stepping onto the dais beyond the ruins fires q_done (the quest's finale). ---
  const shrineY = groundY(0, 78);
  const shrineZone = store.createObjectWithProps('empty', { name: 'Shrine Zone', position: [0, shrineY + 1, 78], physics: { enabled: true, bodyType: 'dynamic', collider: 'box', isTrigger: true, gravityScale: 0 } });
  store.updateTransform(shrineZone, 'scale', [6, 3, 6]);
  const { blueprintId: shrineBp } = store.createBlueprintNamed('Shrine Logic', 'Player reaches the shrine → complete the quest (fires q_done).', folder);
  store.attachScript(shrineZone, shrineBp);
  const sEnter = store.addGraphNodeToBlueprint(shrineBp, 'Trigger Enter', 'Events', { otherObjectId: pawnId });
  const sFire = store.addGraphNodeToBlueprint(shrineBp, 'Fire Event', 'Runtime', { eventName: 'q_done' });
  store.connectGraphNodes(shrineBp, sEnter, sFire, 'exec-out', 'exec-in');

  void terrainId;
  return relicsVarId;
}

/**
 * The combat encounter in the northern ruins: editable AI enemies (ranged Skeletons sharing a "Skeleton AI"
 * brain, a melee Brute), and a tanky BOSS Champion guarding the shrine. Every enemy is the SAME UAL1 rig as the
 * player (built via createCharacterPawn so it animates identically), just recolored + scaled, with the default
 * WASD brain swapped for an AI blueprint and a floating world-space health bar. Aggro leashes keep them dormant
 * until the player approaches, so the village stays peaceful while you do the early quest steps.
 */
function buildEnemies(pawnId: string, terrainId: string, groundY: GroundFn): void {
  const store = useEditorStore.getState();
  const player = selectActiveObjects(store).find((o) => o.id === pawnId);
  const modelAssetId = player?.renderer?.modelAssetId;
  const skeletonId = store.animatorControllers.find((c) => c.id === player?.animator?.controllerId)?.skeletonId;
  if (!modelAssetId) return;
  const enemyFolder = store.createFolder('Enemies');

  const clips = skeletonId ? store.animations.filter((a) => a.skeletonId === skeletonId) : [];
  const pickClip = (...patterns: RegExp[]) => {
    for (const p of patterns) {
      const found = clips.find((c) => p.test(c.name));
      if (found) return found.id;
    }
    return undefined;
  };

  // (1) RANGED SKELETON brain — chase when far (but inside aggro range), then face + shoot on a cooldown. One
  //     editable blueprint shared by every skeleton.
  const { blueprintId: enemyBp } = store.createBlueprintNamed('Skeleton AI', 'Chase the player within aggro range, then face + shoot on a cooldown. Open me to tweak ranges.', enemyFolder);
  const addE = (label: string, data?: Record<string, unknown>) => store.addGraphNodeToBlueprint(enemyBp, label, categoryFor(label), data);
  const execE = (a: string, b: string) => store.connectGraphNodes(enemyBp, a, b, 'exec-out', 'exec-in');
  const valE = (a: string, b: string, handle: string) => store.connectGraphNodes(enemyBp, a, b, 'value-out', handle);
  const eUpdate = addE('Update');
  const eDist = addE('Distance To Player');
  const eCmpChase = addE('Compare', { compareOp: '>', numberValue: 2.6 });
  const eCmpAggro = addE('Compare', { compareOp: '<', numberValue: 16 });
  const eAnd = addE('AND');
  const eBranchChase = addE('Branch');
  const eDir = addE('Direction To Player');
  const eMove = addE('Move', { amount: 3 });
  const eCmpAtk = addE('Compare', { compareOp: '<', numberValue: 16 });
  const eBranchAtk = addE('Branch');
  const eFace = addE('Face Player');
  const eCool = addE('Cooldown', { numberValue: 1.4 });
  const eShoot = addE('Spawn Projectile', { projectileSpeed: 16, projectileDamage: 8, projectileColor: '#ff5a4d', projectileSize: 0.22, projectileLife: 3 });
  execE(eUpdate, eBranchChase);
  execE(eUpdate, eBranchAtk);
  valE(eDist, eCmpChase, 'a');
  valE(eDist, eCmpAggro, 'a');
  valE(eCmpChase, eAnd, 'a');
  valE(eCmpAggro, eAnd, 'b');
  valE(eAnd, eBranchChase, 'condition');
  execE(eBranchChase, eMove);
  valE(eDir, eMove, 'vector');
  valE(eDist, eCmpAtk, 'a');
  valE(eCmpAtk, eBranchAtk, 'condition');
  execE(eBranchAtk, eFace);
  execE(eFace, eCool);
  execE(eCool, eShoot);

  // (2) MELEE BRUTE/BOSS brain — chase within aggro range; contact damage (the `enemy` var) does the hurting,
  //     plus a punch montage when in reach.
  const { blueprintId: chaserBp } = store.createBlueprintNamed('Brute AI', 'Chase the player within aggro range and strike on contact. Shared by the Brute + Boss.', enemyFolder);
  const cUpdate = store.addGraphNodeToBlueprint(chaserBp, 'Update', 'Events');
  const cDir = store.addGraphNodeToBlueprint(chaserBp, 'Direction To Player', 'Runtime');
  const cMove = store.addGraphNodeToBlueprint(chaserBp, 'Move', 'Runtime', { amount: 3.2 });
  const cAggroDist = store.addGraphNodeToBlueprint(chaserBp, 'Distance To Player', 'Runtime');
  const cAggroCmp = store.addGraphNodeToBlueprint(chaserBp, 'Compare', 'Logic', { compareOp: '<', numberValue: 18 });
  const cAggroBranch = store.addGraphNodeToBlueprint(chaserBp, 'Branch', 'Logic');
  store.connectGraphNodes(chaserBp, cUpdate, cAggroBranch, 'exec-out', 'exec-in');
  store.connectGraphNodes(chaserBp, cAggroDist, cAggroCmp, 'value-out', 'a');
  store.connectGraphNodes(chaserBp, cAggroCmp, cAggroBranch, 'value-out', 'condition');
  store.connectGraphNodes(chaserBp, cAggroBranch, cMove, 'exec-out', 'exec-in');
  store.connectGraphNodes(chaserBp, cDir, cMove, 'value-out', 'vector');
  const punchAnim = pickClip(/punch.*cross/i, /punch.*jab/i, /punch/i, /\bkick\b/i, /attack(?!.*rm)/i);
  if (punchAnim) {
    const cDist = store.addGraphNodeToBlueprint(chaserBp, 'Distance To Player', 'Runtime');
    const cCmp = store.addGraphNodeToBlueprint(chaserBp, 'Compare', 'Logic', { compareOp: '<', numberValue: 2.8 });
    const cBranch = store.addGraphNodeToBlueprint(chaserBp, 'Branch', 'Logic');
    const cCool = store.addGraphNodeToBlueprint(chaserBp, 'Cooldown', 'Logic', { numberValue: 1.1 });
    const cPunch = store.addGraphNodeToBlueprint(chaserBp, 'Play Animation', 'Runtime', { animationId: punchAnim });
    store.connectGraphNodes(chaserBp, cUpdate, cBranch, 'exec-out', 'exec-in');
    store.connectGraphNodes(chaserBp, cDist, cCmp, 'value-out', 'a');
    store.connectGraphNodes(chaserBp, cCmp, cBranch, 'value-out', 'condition');
    store.connectGraphNodes(chaserBp, cBranch, cCool, 'exec-out', 'exec-in');
    store.connectGraphNodes(chaserBp, cCool, cPunch, 'exec-out', 'exec-in');
  }

  // Floating world-space health bar shared by every enemy (bound to each host's own self.health / self.maxHealth).
  const enemyBarDoc = store.createUIDocument('Enemy Health Bar', 'world');
  const enemyBar = store.addUIElement(enemyBarDoc, undefined, 'bar');
  store.updateUIElement(enemyBarDoc, enemyBar, { style: { width: '120px', height: '10px', background: 'rgba(15,17,23,0.8)', borderRadius: '5px', color: '#e3504a' } });
  store.setUIBinding(enemyBarDoc, enemyBar, 'fill', 'self.health / self.maxHealth');
  store.moveToFolder('uiDocument', enemyBarDoc, enemyFolder);

  const buildEnemy = (name: string, x: number, z: number, color: string, scale: number, aiBp: string, vars: Record<string, number | boolean>, maxHealth: number, barOffsetY: number, barScale: number): string | undefined => {
    const id = store.createCharacterPawn(modelAssetId, name);
    if (!id) return undefined;
    const autoBp = useEditorStore.getState().scenes.flatMap((s) => s.objects).find((o) => o.id === id)?.script?.blueprintId;
    store.attachScript(id, aiBp);
    if (autoBp && autoBp !== aiBp) store.deleteBlueprint(autoBp);
    store.updateTransform(id, 'position', [x, groundY(x, z) + 0.2, z]);
    if (scale !== 1) store.updateTransform(id, 'scale', [scale, scale, scale]);
    store.updateRenderer(id, { color, overrideMaterial: true });
    store.updateCharacterController(id, { moveSpeed: 3, sprintMultiplier: 1, jumpStrength: 0, cameraFollow: false, mouseLook: false, turnSpeed: 9 });
    for (const [key, value] of Object.entries(vars)) store.setObjectVariable(id, key, value);
    store.setObjectVariable(id, 'maxHealth', maxHealth);
    store.attachUI(id, enemyBarDoc);
    store.updateUIComponent(id, { offset: [0, barOffsetY, 0], scale: barScale });
    return id;
  };

  // Skeletons (ranged) flanking the ruins; the first is saved as a reusable prefab.
  const skelId = buildEnemy('Skeleton', -4, 56, '#cfd6e6', 1, enemyBp, { health: 60 }, 60, 2, 1);
  buildEnemy('Skeleton', 5, 58, '#cfd6e6', 1, enemyBp, { health: 60 }, 60, 2, 1);
  if (skelId) store.createPrefabFromObject(skelId, 'Skeleton Prefab', enemyFolder);

  // A melee Brute prowling the ruins.
  const bruteId = buildEnemy('Brute', 0, 60, '#9a4b3f', 1.4, chaserBp, { enemy: true, health: 130, enemyDamage: 16, attackRange: 2.4 }, 130, 2.6, 1.1);
  if (bruteId) store.createPrefabFromObject(bruteId, 'Brute Prefab', enemyFolder);

  // The BOSS "Champion" guarding the shrine — same chase AI, far tankier + harder-hitting.
  const bossId = buildEnemy('Champion', 0, 70, '#7a2f8f', 2.2, chaserBp, { enemy: true, health: 520, enemyDamage: 30, attackRange: 3.4 }, 520, 4, 1.8);
  if (bossId) store.createPrefabFromObject(bossId, 'Champion Prefab', enemyFolder);

  void terrainId;
}

/**
 * An autoplay intro CINEMATIC that establishes the world: a high sweep over the shrine + ruins, back across the
 * fields, then settles into the over-the-shoulder framing behind the player at the village. A "Director" plays
 * it on Start. Open the cinematic to retime/reframe.
 */
function buildIntroCinematic(): void {
  const store = useEditorStore.getState();
  const cinematicFolder = store.createFolder('Cinematics');
  const introId = store.createCinematic('Intro', 6);
  store.addCinematicCameraKeyframe(introId, 0, { position: [0, 22, 90], lookAt: [0, 3, 72], fov: 55 }); // high over the shrine
  store.addCinematicCameraKeyframe(introId, 2.2, { position: [10, 12, 58], lookAt: [0, 2, 58], fov: 52 }); // across the ruins
  store.addCinematicCameraKeyframe(introId, 4, { position: [14, 8, 26], lookAt: [0, 2, 12], fov: 48 }); // sweep over the fields
  store.addCinematicCameraKeyframe(introId, 6, { position: [0.7, 2.4, -3.4], lookAt: [0, 1.6, 2], fov: 45 }); // settle behind the player
  const directorId = store.createObjectWithProps('empty', { name: 'Intro Director', position: [0, 0, 0] });
  const { blueprintId: directorBp } = store.createBlueprintNamed('Intro Director', 'Play the intro cinematic when the game starts.', cinematicFolder);
  store.attachScript(directorId, directorBp);
  const dStart = store.addGraphNodeToBlueprint(directorBp, 'Start', 'Events');
  const dPlay = store.addGraphNodeToBlueprint(directorBp, 'Play Cinematic', 'Runtime', { cinematicId: introId });
  store.connectGraphNodes(directorBp, dStart, dPlay, 'exec-out', 'exec-in');
}
