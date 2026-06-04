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

/** Node-category inference shared by the world / vehicle / NPC / economy blueprint builders. */
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
 * Build a ready-to-play, GTA-STYLE URBAN third-person starter from the bundled rig:
 *  - a flat city block GROUND with a road grid, sidewalks and a skyline of neon-trimmed BUILDINGS (tagged so
 *    they show up on the radar) you roam freely;
 *  - a dusk/early-night ENVIRONMENT (deep sky + cool fog + punchy bloom on the neon) for a cinematic mood;
 *  - a PLAYER pawn (locomotion animator + over-the-shoulder camera) with a Fist / Bat / Pistol inventory and
 *    GTA HUD (radar minimap with health + armor arcs + a cash readout);
 *  - a parked, drivable CAR you walk up to and ENTER (press E) — the camera + HUD hand off to the car — and
 *    EXIT (press F), built on the engine's new Enter/Exit Vehicle nodes;
 *  - PEDESTRIANS that wander the sidewalks (two you can talk to), CASH pickups, and SHOPS that spend your cash
 *    on armor / health — all contextual "[E] …" prompts;
 *  - a short intro CINEMATIC that sweeps the skyline and settles behind the player.
 * Everything is built from the engine's own systems (environment, blueprints, vehicles, triggers, UI, the
 * radar render-setting, cinematics) so the whole city is editable in the editor. Returns the player's id.
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
  // and the placeholder camera) so they don't clutter the city. Keep the directional light for baseline lighting.
  for (const defaultId of ['obj-player', 'obj-ground', 'obj-enemy', 'obj-camera']) {
    if (selectActiveObjects(useEditorStore.getState()).some((o) => o.id === defaultId)) {
      store.deleteObject(defaultId);
    }
  }

  // --- 1. ENVIRONMENT: a dusk / early-night city — a deep blue sky bleeding to a warm horizon, a low sun, and
  //        cool atmospheric fog that fades the far towers. Strong bloom makes the neon + windows glow. ---
  store.updateSceneEnvironment(sceneId, {
    skyMode: 'procedural',
    skyTopColor: '#0b1130',
    skyHorizonColor: '#c8587a',
    skyGroundColor: '#0a0c14',
    environmentIntensity: 0.8,
    sunColor: '#ffb27a',
    sunIntensity: 1.0,
    sunAzimuth: 290,
    sunElevation: 9, // low sun = long dusk light + long shadows down the avenues
    fogEnabled: true,
    fogColor: '#1a1d33',
    fogNear: 36,
    fogFar: 200,
  });
  store.updateRenderSettings({
    bloomEnabled: true,
    bloomIntensity: 1.1,
    bloomThreshold: 0.55,
    bloomRadius: 0.75,
    vignetteEnabled: true,
    // GTA-style radar (src/ui/MiniMap.tsx): centered on the player/car, rotates with heading, ~70u range.
    minimapEnabled: true,
    minimapRotate: true,
    minimapRange: 70,
  });

  // --- 2. THE CITY: flat ground + a road grid + neon-trimmed buildings + street props. ---
  buildCity();

  // --- 3. PLAYER: the bundled rig with locomotion + the gameplay kit (health, interactions) and a
  //        Fist / Bat / Pistol inventory. Over-the-shoulder camera for exploring the streets. ---
  const pawnId = store.createCharacterPawn(modelAsset.id, 'Player');
  if (!pawnId) return undefined;
  store.updateTransform(pawnId, 'position', [0, 0.1, 7]);

  const kit = useEditorStore.getState().addGameplayKit;
  kit(pawnId, 'health');
  kit(pawnId, 'interactions'); // the "Interact" (E) ability used to enter cars, talk, and shop
  kit(pawnId, 'ranged'); // the pistol uses the aim/shoot pipeline

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
    // Over-the-shoulder city camera — pulled back a touch so you can read the streets.
    cameraOffset: [0.6, 1.7, -3.4],
    cameraPitch: 0.14,
    cameraMinPitch: -0.35,
    cameraMaxPitch: 0.95,
    mouseSensitivity: 0.0023,
    turnSpeed: 13,
    meleeDamage: 40,
    meleeRange: 2.5,
    interactRange: 3.4,
  });

  // GTA HUD-driving instance vars (read by the radar in src/ui/MiniMap.tsx): health is the source of truth,
  // armor soaks damage, money is your cash, minimapBlip is the player arrow color, ammo feeds the pistol.
  useEditorStore.getState().setObjectVariable(pawnId, 'health', 100);
  useEditorStore.getState().setObjectVariable(pawnId, 'maxHealth', 100);
  useEditorStore.getState().setObjectVariable(pawnId, 'armor', 50);
  useEditorStore.getState().setObjectVariable(pawnId, 'maxArmor', 100);
  useEditorStore.getState().setObjectVariable(pawnId, 'money', 0);
  useEditorStore.getState().setObjectVariable(pawnId, 'minimapBlip', '#7dd3fc');
  useEditorStore.getState().setObjectVariable(pawnId, 'ammo', 24);
  useEditorStore.getState().setObjectVariable(pawnId, 'ammoMax', 24);

  // Atmosphere: a looping ambient bed + background music (Play starts/stops them).
  const [ambient, music] = await Promise.all([importBundledAudio('ambient.mp3'), importBundledAudio('music.mp3')]);
  useEditorStore.getState().setSceneAudio(sceneId, { ambientSoundId: ambient, musicSoundId: music });

  // Weapons + inventory + the click-to-shoot gate (the per-pawn combat plumbing + HUD controls hint).
  await assemblePlayerKit(pawnId, switchSound);

  // The drivable car, the wandering pedestrians, and the cash + shop economy — each built on the city above.
  buildCar(pawnId);
  buildPedestrians(pawnId);
  buildEconomy(pawnId);
  buildIntroCinematic();

  // Tidy the imported sounds into an Audio folder.
  const audioFolder = useEditorStore.getState().createFolder('Audio');
  for (const id of [footstep, jump, land, swing, hurt, ambient, music, switchSound]) {
    if (id) useEditorStore.getState().moveToFolder('asset', id, audioFolder);
  }
  return pawnId;
}

// hand_r bind orientation (from the GLB): local +Z → world forward, local +X → world up. The bat's blade is
// the model's +Z and the pistol's barrel is the model's +X, so each weapon gets a full local grip offset.
const BAT_SCALE = 0.85;
const PISTOL_SCALE = 0.34;
const BAT_ROTATION: Vector3Tuple = [0, (90 * Math.PI) / 180, 0];
const PISTOL_ROTATION: Vector3Tuple = [0, (-90 * Math.PI) / 180, Math.PI];
const BAT_POSITION: Vector3Tuple = [0.015, -0.02, 0.02];
const PISTOL_POSITION: Vector3Tuple = [0.035, -0.035, 0.055];

/**
 * Per-pawn combat kit: imports the bat + pistol models, builds the RightHand socket, the click-to-shoot gate
 * (only while the pistol/ranged weapon is out), a controls hint, and a Fist / Bat / Pistol inventory bar
 * (Fist equipped to start). The radial weapon wheel (hold Tab) in the GameHud reads this same inventory.
 */
async function assemblePlayerKit(pawnId: string, switchSound: string | undefined): Promise<void> {
  const batAsset = await importBundledModel('Sword.glb'); // reused as a melee "bat"
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

  // Pick equip montages from the rig by best-effort name match (a missing clip just no-ops).
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

  // --- Click (release) → fire a bullet, but ONLY while the pistol (RangedMode) is out. With the bat out the
  //     same LMB instead triggers a melee swing (handled by the controller — damages the front cone). ---
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

  // --- Controls hint (the radar shows health/armor/cash, so the HUD stays clean). ---
  const hud = store.createUIDocument('HUD', 'screen');
  store.updateUIDocument(hud, { visibleOnStart: true });
  const hintId = store.addUIPreset(hud, undefined, 'label');
  store.updateUIElement(hud, hintId, {
    text: 'WASD move · Mouse look · Shift sprint · LMB attack · RMB aim · Tab weapon wheel · E enter car / talk / shop',
    style: { color: '#8a93a6', fontSize: '12px', custom: { position: 'absolute', bottom: '14px', left: '16px', opacity: '0.7' } },
  });
  store.moveToFolder('uiDocument', hud, uiFolder);

  // --- Inventory bar / weapon wheel source: Fist / Bat / Pistol. Fist equipped to start. Clicking a slot (or
  //     picking it from the Tab wheel) swaps the held weapon, plays its equip montage, and sets RangedMode. ---
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
    equipped: 0, // start unarmed (Fist) — pull a weapon from the Tab wheel or the bar
    boneName: 'hand_r',
    socketName: 'RightHand',
    switchSoundId: switchSound,
  });
}

/**
 * The CITY: one flat ground slab (the player + car walk/drive on it), a road grid with glowing lane lines, raised
 * sidewalks, a skyline of neon-trimmed BUILDINGS (each tagged `minimapShape` so the radar draws its footprint),
 * and street props (lampposts with warm pools of light, planters). All purely visual / collidable — retune or
 * delete freely. Everything is flat (y≈0) so it's cheap and reads urban; fog hides the far edges.
 */
function buildCity(): void {
  const store = useEditorStore.getState();

  // Ground slab (dark wet asphalt) with one fixed box collider.
  const ground = store.createObjectWithProps('cube', {
    name: 'Ground',
    position: [0, -0.5, 0],
    color: '#0a0c14',
    physics: { enabled: true, bodyType: 'fixed', collider: 'box' },
  });
  store.updateTransform(ground, 'scale', [320, 1, 320]);
  store.updateRenderer(ground, { metalness: 0.15, roughness: 0.85 });

  const move = (id: string, key: 'scale' | 'rotation' | 'position', v: Vector3Tuple) => store.updateTransform(id, key, v);

  // A thin road strip (asphalt) + a dashed center line. Roads sit just above the ground so they read on top.
  const road = (name: string, x: number, z: number, sx: number, sz: number, vertical: boolean) => {
    const r = store.createObjectWithProps('cube', { name, position: [x, 0.02, z], color: '#15171f' });
    move(r, 'scale', [sx, 0.04, sz]);
    store.updateRenderer(r, { metalness: 0.1, roughness: 0.9 });
    // Glowing dashed center line down the middle of the road.
    const len = vertical ? sz : sx;
    const dashes = Math.max(2, Math.floor(len / 6));
    for (let i = 0; i < dashes; i++) {
      const t = (i + 0.5) / dashes - 0.5;
      const dx = vertical ? x : x + t * sx;
      const dz = vertical ? z + t * sz : z;
      const d = store.createObjectWithProps('cube', { name: `${name} Line`, position: [dx, 0.05, dz], color: '#f4d27a' });
      move(d, 'scale', vertical ? [0.18, 0.02, 2] : [2, 0.02, 0.18]);
      store.updateRenderer(d, { materialOverrides: { emissiveColor: '#ffcf6b', emissiveIntensity: 1.1 } });
    }
  };
  // A simple cross + ring layout: two main avenues through the plaza, framed by blocks.
  road('Avenue NS', 0, 0, 9, 300, true);
  road('Avenue EW', 0, 0, 300, 9, false);
  road('Street N', 0, 70, 9, 60, true);
  road('Street S', 0, -70, 9, 60, true);

  // Sidewalks: pale raised curbs flanking the main avenues near the plaza.
  const sidewalk = (x: number, z: number, sx: number, sz: number) => {
    const s = store.createObjectWithProps('cube', { name: 'Sidewalk', position: [x, 0.12, z], color: '#2b2f3a' });
    move(s, 'scale', [sx, 0.24, sz]);
    store.updateRenderer(s, { roughness: 0.95 });
  };
  for (const sx of [-9, 9]) {
    sidewalk(sx, 0, 4, 120);
  }
  for (const sz of [-9, 9]) {
    sidewalk(0, sz, 120, 4);
  }

  // Buildings — a skyline of varied neon-trimmed towers laid out in the four blocks around the plaza. Each is a
  // matte base cube + an emissive "window band" near the top; tagged `minimapShape` so the radar shows the city.
  const palette = ['#1b2030', '#22283a', '#2a2230', '#1e2a33', '#262433'];
  const neon = ['#ff4da6', '#43e0ff', '#ffd54a', '#9b6bff', '#3affa3'];
  const tower = (x: number, z: number, w: number, h: number, d: number, i: number) => {
    const base = store.createObjectWithProps('cube', {
      name: 'Building',
      position: [x, h / 2, z],
      color: palette[i % palette.length],
      physics: { enabled: true, bodyType: 'fixed', collider: 'box' },
    });
    move(base, 'scale', [w, h, d]);
    store.updateRenderer(base, { metalness: 0.2, roughness: 0.7 });
    store.setObjectVariable(base, 'minimapShape', true);
    store.setObjectVariable(base, 'minimapShapeColor', 'rgba(150,164,196,0.55)');
    // Neon window band wrapping the upper third.
    const band = store.createObjectWithProps('cube', { name: 'Neon Band', position: [x, h * 0.78, z], color: neon[i % neon.length] });
    move(band, 'scale', [w + 0.1, h * 0.06, d + 0.1]);
    store.updateRenderer(band, { materialOverrides: { emissiveColor: neon[i % neon.length], emissiveIntensity: 2.2 } });
  };
  // Lay towers in the 4 blocks (avoid the 9u-wide avenues + the central plaza).
  let bi = 0;
  const blockCenters: Array<[number, number]> = [
    [-26, 26], [-44, 44], [-26, 52], [-52, 22],
    [26, 26], [44, 44], [26, 52], [52, 22],
    [-26, -26], [-44, -44], [-26, -52], [-52, -22],
    [26, -26], [44, -44], [26, -52], [52, -22],
  ];
  for (const [bx, bz] of blockCenters) {
    const w = 8 + (bi % 3) * 3;
    const d = 8 + ((bi + 1) % 3) * 3;
    const h = 14 + ((bi * 7) % 5) * 8; // 14..46u tall
    tower(bx, bz, w, h, d, bi);
    bi++;
  }

  // Lampposts down the avenues — warm pools of light that bloom at dusk.
  const lamp = (x: number, z: number) => {
    const post = store.createObjectWithProps('cube', { name: 'Lamppost', position: [x, 2.4, z], color: '#0e1018' });
    move(post, 'scale', [0.25, 4.8, 0.25]);
    const bulb = store.createObjectWithProps('sphere', { name: 'Lamp Glow', position: [x, 4.9, z], color: '#ffd9a0' });
    move(bulb, 'scale', [0.32, 0.32, 0.32]);
    store.updateRenderer(bulb, { materialOverrides: { emissiveColor: '#ffd9a0', emissiveIntensity: 3 } });
    const light = store.createObjectWithProps('light', { name: 'Lamp Light', position: [x, 4.6, z] });
    store.setObjectLight(light, { type: 'point', color: '#ffcf9a', intensity: 9, distance: 16, castShadow: false });
  };
  for (let i = -2; i <= 2; i++) {
    if (i === 0) continue;
    lamp(-7, i * 22);
    lamp(7, i * 22);
  }
}

/** Resolve the shared Driving project variable (created once so the car gate + Enter/Exit nodes share it). */
function ensureDrivingVar(): string {
  const store = useEditorStore.getState();
  const existing = store.variables.find((v) => v.name === 'Driving');
  return existing ? existing.id : store.createVariable('Driving', 'number', false);
}

/**
 * The drivable CAR (GTA-style enter/exit). A dynamic cube chassis + cabin + 4 wheels + 2 headlights, with a
 * Vehicle controller (idle — cameraFollow off — until entered). Its blueprint: every frame, IF Driving is on,
 * Drive it from WASD; on Interact (E, while on foot) ENTER it; on a Key Down (F, while driving) EXIT it. The
 * Enter/Exit nodes flip camera + HUD + input to/from the car (see action.enterVehicle/exitVehicle).
 */
function buildCar(pawnId: string): void {
  const store = useEditorStore.getState();
  const folder = store.createFolder('Vehicles');
  const drivingVarId = ensureDrivingVar();

  const px = 4.5;
  const pz = 4; // parked just off the plaza, beside the player spawn
  const body = store.createObjectWithProps('cube', {
    name: 'Sports Car',
    position: [px, 0.7, pz],
    color: '#c81e3a',
    physics: { enabled: true, bodyType: 'dynamic', collider: 'box', mass: 4, friction: 0.8, linearDamping: 0.4, angularDamping: 0.6 },
  });
  store.updateTransform(body, 'scale', [2, 0.7, 4.2]);
  store.updateRenderer(body, { metalness: 0.55, roughness: 0.35 });

  const cabin = store.createObjectWithProps('cube', { name: 'Cabin', position: [0, 0.55, -0.2], color: '#10131c', parentId: body });
  store.updateTransform(cabin, 'scale', [1.7, 0.7, 2]);
  store.updateRenderer(cabin, { metalness: 0.4, roughness: 0.2, materialOverrides: { emissiveColor: '#39d8ff', emissiveIntensity: 0.4 } });

  // 4 wheels at the corners (children, local space). Front two are steered.
  const wheelIds: string[] = [];
  const steeredIds: string[] = [];
  const wheelSpots: Array<[number, number, boolean]> = [
    [-0.95, 1.4, true],
    [0.95, 1.4, true],
    [-0.95, -1.4, false],
    [0.95, -1.4, false],
  ];
  for (const [wx, wz, front] of wheelSpots) {
    const w = store.createObjectWithProps('cube', { name: 'Wheel', position: [wx, -0.35, wz], color: '#0c0d12', parentId: body });
    store.updateTransform(w, 'scale', [0.35, 0.7, 0.7]);
    store.updateRenderer(w, { metalness: 0.3, roughness: 0.7 });
    wheelIds.push(w);
    if (front) steeredIds.push(w);
  }

  // Headlights (forward spot lights) + a glowing front strip.
  const headlightIds: string[] = [];
  for (const s of [-1, 1]) {
    const hl = store.createObjectWithProps('light', { name: 'Headlight', position: [s * 0.6, 0.1, 2.1], parentId: body });
    store.setObjectLight(hl, { type: 'spot', color: '#fff4d6', intensity: 8, distance: 34, angle: Math.PI / 7, castShadow: false });
    store.updateTransform(hl, 'rotation', [-0.12, 0, 0]);
    headlightIds.push(hl);
  }
  const strip = store.createObjectWithProps('cube', { name: 'Light Bar', position: [0, 0.12, 2.12], color: '#9bf6ff', parentId: body });
  store.updateTransform(strip, 'scale', [1.6, 0.08, 0.08]);
  store.updateRenderer(strip, { materialOverrides: { emissiveColor: '#9bf6ff', emissiveIntensity: 2.4 } });

  store.updateVehicle(body, {
    enabled: true,
    cameraFollow: false, // idle until the player enters (Enter Vehicle flips this on)
    wheelObjectIds: wheelIds,
    steeredWheelIds: steeredIds,
    headlightIds,
    wheelRadius: 0.35,
    rideHeight: 0.7,
    wheelRestY: 0.35,
    bodyRoll: 0.07,
    cameraOffset: [0, 3.0, -8.5],
  });

  // Walk-up affordances: a contextual "[E] Enter car" prompt + a radar blip + the in-car "exit" label.
  store.setObjectVariable(body, 'interactable', true);
  store.setObjectVariable(body, 'interactPrompt', 'Enter car');
  store.setObjectVariable(body, 'exitPrompt', 'Exit car');
  store.setObjectVariable(body, 'minimapBlip', '#ffd54a');

  // Car Controller blueprint (the visible, editable driving + enter/exit logic).
  const { blueprintId: bp } = store.createBlueprintNamed('Car Controller', 'Drive with WASD while Driving is on; Interact (E) to enter, Key F to exit. Edit to retune.', folder);
  store.attachScript(body, bp);
  const add = (label: string, data?: Record<string, unknown>) => store.addGraphNodeToBlueprint(bp, label, categoryFor(label), data);
  const ex = (a: string, b: string) => store.connectGraphNodes(bp, a, b, 'exec-out', 'exec-in');
  const vl = (a: string, b: string, handle: string) => store.connectGraphNodes(bp, a, b, 'value-out', handle);

  // Update → IF Driving > 0 → Drive(WASD).
  const upd = add('Update');
  const getDrv = add('Get Variable', { variableId: drivingVarId, valueType: 'number' });
  const cmp = add('Compare', { compareOp: '>', numberValue: 0 });
  const br = add('Branch');
  const inp = add('Get Drive Input');
  const drive = add('Drive');
  ex(upd, br);
  vl(getDrv, cmp, 'a');
  vl(cmp, br, 'condition');
  ex(br, drive);
  vl(inp, drive, 'vector');

  // Interact (E, on foot) → Enter Vehicle (target defaults to this car).
  const onInteract = add('Interact');
  const enter = add('Enter Vehicle');
  ex(onInteract, enter);

  // Key F (while driving) → Exit Vehicle.
  const keyExit = add('Key Down', { keyCode: 'KeyF' });
  const exit = add('Exit Vehicle');
  ex(keyExit, exit);
}

/**
 * PEDESTRIANS that wander the city — recolored UAL1 pawns sharing one "Pedestrian AI" blueprint that strolls
 * between each pawn's own two waypoints (`wpA`/`wpB` instance vars), flipping target on a timer (Move To steers
 * around buildings). Two are interactable (E) and say a line. The first is saved as a reusable prefab.
 */
function buildPedestrians(pawnId: string): void {
  const store = useEditorStore.getState();
  const player = selectActiveObjects(store).find((o) => o.id === pawnId);
  const modelAssetId = player?.renderer?.modelAssetId;
  if (!modelAssetId) return;
  const folder = store.createFolder('Pedestrians');

  // --- Shared dialogue box (interactable peds rewrite + show it on talk). ---
  const dialogue = store.createUIDocument('Citizen Dialogue', 'screen');
  store.updateUIDocument(dialogue, { visibleOnStart: false });
  const dlgPanel = store.addUIPreset(dialogue, undefined, 'panel');
  store.updateUIElement(dialogue, dlgPanel, {
    style: { background: 'rgba(12,14,20,0.9)', padding: '14px 20px', borderRadius: '14px', custom: { position: 'absolute', bottom: '120px', left: '50%', transform: 'translateX(-50%)', maxWidth: '520px', border: '1px solid rgba(123,223,255,0.4)', boxShadow: '0 8px 28px rgba(0,0,0,0.5)' } },
  });
  const dlgText = store.addUIElement(dialogue, dlgPanel, 'text');
  store.updateUIElement(dialogue, dlgText, { text: '…', style: { color: '#eaf2ff', fontSize: '15px', fontWeight: '500', custom: { whiteSpace: 'pre-line', lineHeight: '1.4' } } });
  store.moveToFolder('uiDocument', dialogue, folder);

  // --- Shared "Pedestrian AI" wander blueprint. ---
  const { blueprintId: bp } = store.createBlueprintNamed('Pedestrian AI', 'Strolls between this pawn\'s wpA / wpB waypoints, flipping target every few seconds (Move To steers around buildings).', folder);
  const add = (label: string, data?: Record<string, unknown>) => store.addGraphNodeToBlueprint(bp, label, categoryFor(label), data);
  const ex = (a: string, b: string) => store.connectGraphNodes(bp, a, b, 'exec-out', 'exec-in');
  const vl = (a: string, b: string, handle: string) => store.connectGraphNodes(bp, a, b, 'value-out', handle);

  const upd = add('Update');
  // Every ~6s, flip `wp` between 0 and 1 in ONE write (no re-read race): wp = Lerp(1, 0, wp) = 1 − wp.
  const cool = add('Cooldown', { numberValue: 6 });
  ex(upd, cool);
  const one = add('Number', { numberValue: 1 });
  const zero = add('Number', { numberValue: 0 });
  const getWp1 = add('Get Object Var', { objectKey: 'wp' });
  const flip = add('Lerp');
  const setFlip = add('Set Object Var', { objectKey: 'wp' });
  vl(one, flip, 'a');
  vl(zero, flip, 'b');
  vl(getWp1, flip, 't');
  ex(cool, setFlip);
  vl(flip, setFlip, 'value');

  // Each frame, walk toward the current waypoint (wpA when wp<0.5, else wpB).
  const getWp2 = add('Get Object Var', { objectKey: 'wp' });
  const cmpA = add('Compare', { compareOp: '<', numberValue: 0.5 });
  const brA = add('Branch');
  const getWpA = add('Get Object Var', { objectKey: 'wpA' });
  const moveA = add('Move To', { amount: 1.6 });
  vl(getWp2, cmpA, 'a');
  vl(cmpA, brA, 'condition');
  ex(upd, brA);
  ex(brA, moveA);
  vl(getWpA, moveA, 'target');

  const cmpB = add('Compare', { compareOp: '>', numberValue: 0.5 });
  const brB = add('Branch');
  const getWpB = add('Get Object Var', { objectKey: 'wpB' });
  const moveB = add('Move To', { amount: 1.6 });
  vl(getWp2, cmpB, 'a');
  vl(cmpB, brB, 'condition');
  ex(upd, brB);
  ex(brB, moveB);
  vl(getWpB, moveB, 'target');

  // --- Interactable talk handler (only some peds use it): on Interact, show a line; an Update-driven proximity
  //     hide is overkill for a starter, so the line simply shows on talk. Shared by the chatty peds. ---
  const { blueprintId: talkBp } = store.createBlueprintNamed('Citizen Talk', 'On Interact, show a one-line greeting in the dialogue box.', folder);
  {
    const a = (label: string, data?: Record<string, unknown>) => store.addGraphNodeToBlueprint(talkBp, label, categoryFor(label), data);
    const onI = a('Interact');
    const setTxt = a('Set UI Text', { documentId: dialogue, elementId: dlgText, stringValue: 'Nice night for a walk, huh? Watch the traffic out there.' });
    const show = a('Show UI', { documentId: dialogue });
    store.connectGraphNodes(talkBp, onI, setTxt, 'exec-out', 'exec-in');
    store.connectGraphNodes(talkBp, setTxt, show, 'exec-out', 'exec-in');
  }

  const tints = ['#6f87b4', '#b48a6f', '#7fae8e', '#a87fae', '#aeae7f'];
  const makePed = (name: string, x: number, z: number, a: Vector3Tuple, b: Vector3Tuple, i: number, chatty: boolean): string | undefined => {
    const id = store.createCharacterPawn(modelAssetId, name);
    if (!id) return undefined;
    const autoBp = useEditorStore.getState().scenes.flatMap((s) => s.objects).find((o) => o.id === id)?.script?.blueprintId;
    store.attachScript(id, chatty ? talkBp : bp);
    if (autoBp && autoBp !== bp && autoBp !== talkBp) store.deleteBlueprint(autoBp);
    store.updateTransform(id, 'position', [x, 0.1, z]);
    store.updateRenderer(id, { color: tints[i % tints.length], overrideMaterial: true });
    store.updateCharacterController(id, { moveSpeed: 1.6, sprintMultiplier: 1, jumpStrength: 0, cameraFollow: false, mouseLook: false, turnSpeed: 7 });
    store.setObjectVariable(id, 'wp', i % 2);
    store.setObjectVariable(id, 'wpA', a);
    store.setObjectVariable(id, 'wpB', b);
    store.setObjectVariable(id, 'minimapBlip', '#cbd5e1');
    if (chatty) {
      // Chatty peds run the talk brain, but still wander: give them the wander brain too isn't possible (one
      // script), so they stand as friendly NPCs you talk to. Mark interactable + prompt.
      store.setObjectVariable(id, 'interactable', true);
      store.setObjectVariable(id, 'interactPrompt', `Talk to ${name}`);
      store.updateCharacterController(id, { moveSpeed: 0 });
    }
    return id;
  };

  // Wandering peds patrolling the avenues (each between two points down a sidewalk; y is ignored by Move To).
  const first = makePed('Citizen', -7, -30, [-7, 0.1, -55], [-7, 0.1, 55], 0, false);
  makePed('Citizen', 7, 30, [7, 0.1, 55], [7, 0.1, -55], 1, false);
  makePed('Citizen', -30, 7, [-55, 0.1, 7], [55, 0.1, 7], 0, false);
  makePed('Citizen', 30, -7, [55, 0.1, -7], [-55, 0.1, -7], 1, false);
  // Two chatty NPCs standing near the plaza.
  makePed('Mara', -3.5, 9, [-3.5, 0.1, 9], [-3.5, 0.1, 9], 0, true);
  makePed('Dex', 3.5, -9, [3.5, 0.1, -9], [3.5, 0.1, -9], 1, true);

  if (first) store.createPrefabFromObject(first, 'Pedestrian Prefab', folder);
}

/**
 * The cash + shop ECONOMY. CASH pickups add to the player's `money` instance var (shown on the radar); SHOPS are
 * interactable storefronts that spend cash on armor / health. All built from triggers + interact + instance-var
 * math, so it's fully editable. The first cash pickup is saved as a prefab.
 */
function buildEconomy(pawnId: string): void {
  const store = useEditorStore.getState();
  const folder = store.createFolder('Economy');

  // --- Shared "Cash Pickup" blueprint: on touch, add $50 to the toucher's money, then despawn. ---
  const { blueprintId: cashBp } = store.createBlueprintNamed('Cash Pickup', 'Adds $50 to the player\'s money on touch, then removes the pickup.', folder);
  {
    const a = (label: string, data?: Record<string, unknown>) => store.addGraphNodeToBlueprint(cashBp, label, categoryFor(label), data);
    const trg = a('Trigger Enter', { otherObjectId: pawnId });
    const get = a('Get Object Var', { objectKey: 'money', targetObjectId: '$trigger' });
    const addAmt = a('Add', { numberValue: 50 });
    const setM = a('Set Object Var', { objectKey: 'money', targetObjectId: '$trigger' });
    const destroy = a('Destroy Object');
    store.connectGraphNodes(cashBp, get, addAmt, 'value-out', 'a');
    store.connectGraphNodes(cashBp, addAmt, setM, 'value-out', 'value');
    store.connectGraphNodes(cashBp, trg, setM, 'exec-out', 'exec-in');
    store.connectGraphNodes(cashBp, setM, destroy, 'exec-out', 'exec-in');
  }
  const cashSpots: Array<[number, number]> = [
    [-7, 14], [7, -14], [-7, -46], [7, 46], [-30, 7], [30, -7], [14, 7], [-14, -7],
  ];
  let first: string | undefined;
  cashSpots.forEach(([x, z], i) => {
    const c = store.createObjectWithProps('sphere', {
      name: `Cash $50 #${i + 1}`,
      position: [x, 1, z],
      color: '#9be7a0',
      physics: { enabled: true, bodyType: 'dynamic', collider: 'box', isTrigger: true, gravityScale: 0 },
    });
    store.updateTransform(c, 'scale', [0.7, 0.9, 0.7]);
    store.updateRenderer(c, { materialOverrides: { emissiveColor: '#9be7a0', emissiveIntensity: 2.4 } });
    store.setObjectVariable(c, 'minimapBlip', '#9be7a0');
    store.attachScript(c, cashBp);
    if (i === 0) first = c;
  });
  if (first) store.createPrefabFromObject(first, 'Cash Pickup Prefab', folder);

  // --- Shop "purchased" flash UI (shared). ---
  const flash = store.createUIDocument('Shop Flash', 'screen');
  store.updateUIDocument(flash, { visibleOnStart: false });
  const flashLabel = store.addUIPreset(flash, undefined, 'label');
  store.updateUIElement(flash, flashLabel, {
    text: 'Purchased!',
    style: { color: '#9be7a0', fontSize: '20px', fontWeight: '700', background: 'rgba(13,16,23,0.85)', padding: '10px 22px', borderRadius: '999px', custom: { position: 'absolute', top: '120px', left: '50%', transform: 'translateX(-50%)', border: '1px solid rgba(155,231,160,0.5)' } },
  });
  store.moveToFolder('uiDocument', flash, folder);

  // A shop: an interactable storefront that, on E, checks money>=cost and (if affordable) spends it and refills
  // a stat var on the player to 100, flashing "Purchased!". `statKey` = 'armor' or 'health'.
  const makeShop = (name: string, x: number, z: number, statKey: string, cost: number, color: string) => {
    const stall = store.createObjectWithProps('cube', {
      name,
      position: [x, 1.3, z],
      color,
      physics: { enabled: true, bodyType: 'fixed', collider: 'box' },
    });
    store.updateTransform(stall, 'scale', [3, 2.6, 2]);
    store.updateRenderer(stall, { metalness: 0.3, roughness: 0.5, materialOverrides: { emissiveColor: color, emissiveIntensity: 0.6 } });
    store.setObjectVariable(stall, 'interactable', true);
    store.setObjectVariable(stall, 'interactPrompt', `${name} — buy for $${cost} (E)`);
    store.setObjectVariable(stall, 'minimapBlip', color);

    const { blueprintId: bp } = store.createBlueprintNamed(`${name} Logic`, `On Interact, if money ≥ ${cost}: spend it and refill ${statKey} to 100.`, folder);
    store.attachScript(stall, bp);
    const a = (label: string, data?: Record<string, unknown>) => store.addGraphNodeToBlueprint(bp, label, categoryFor(label), data);
    const onI = a('Interact');
    const getMoney = a('Get Object Var', { objectKey: 'money', targetObjectId: '$player' });
    const cmp = a('Compare', { compareOp: '>=', numberValue: cost });
    const br = a('Branch');
    const spend = a('Add', { numberValue: -cost });
    const setMoney = a('Set Object Var', { objectKey: 'money', targetObjectId: '$player' });
    const giveStat = a('Set Object Var', { objectKey: statKey, numberValue: 100, targetObjectId: '$player' });
    const showFlash = a('Show UI', { documentId: flash });
    store.connectGraphNodes(bp, getMoney, cmp, 'value-out', 'a');
    store.connectGraphNodes(bp, cmp, br, 'value-out', 'condition');
    store.connectGraphNodes(bp, onI, br, 'exec-out', 'exec-in');
    // affordable → spend, refill, flash
    store.connectGraphNodes(bp, getMoney, spend, 'value-out', 'a');
    store.connectGraphNodes(bp, br, setMoney, 'exec-out', 'exec-in');
    store.connectGraphNodes(bp, spend, setMoney, 'value-out', 'value');
    store.connectGraphNodes(bp, setMoney, giveStat, 'exec-out', 'exec-in');
    store.connectGraphNodes(bp, giveStat, showFlash, 'exec-out', 'exec-in');
  };
  makeShop('Armor Shop', -11, 16, 'armor', 100, '#60a5fa');
  makeShop('Health Clinic', 11, -16, 'health', 80, '#4ade80');
}

/**
 * A short autoplay intro CINEMATIC: a high sweep over the skyline, down an avenue, then it settles into the
 * over-the-shoulder framing behind the player at the plaza. A Director plays it on Start.
 */
function buildIntroCinematic(): void {
  const store = useEditorStore.getState();
  const cinematicFolder = store.createFolder('Cinematics');
  const introId = store.createCinematic('Intro', 6);
  store.addCinematicCameraKeyframe(introId, 0, { position: [40, 38, 60], lookAt: [0, 10, 0], fov: 58 }); // high over the skyline
  store.addCinematicCameraKeyframe(introId, 2.4, { position: [14, 10, 40], lookAt: [0, 2, 10], fov: 52 }); // drop into an avenue
  store.addCinematicCameraKeyframe(introId, 4.2, { position: [6, 4, 18], lookAt: [0, 1.6, 7], fov: 46 }); // glide toward the player
  store.addCinematicCameraKeyframe(introId, 6, { position: [0.6, 2.4, 3.6], lookAt: [0, 1.6, 9], fov: 45 }); // settle behind the player
  const directorId = store.createObjectWithProps('empty', { name: 'Intro Director', position: [0, 0, 0] });
  const { blueprintId: directorBp } = store.createBlueprintNamed('Intro Director', 'Play the intro cinematic when the game starts.', cinematicFolder);
  store.attachScript(directorId, directorBp);
  const dStart = store.addGraphNodeToBlueprint(directorBp, 'Start', 'Events');
  const dPlay = store.addGraphNodeToBlueprint(directorBp, 'Play Cinematic', 'Runtime', { cinematicId: introId });
  store.connectGraphNodes(directorBp, dStart, dPlay, 'exec-out', 'exec-in');
}
