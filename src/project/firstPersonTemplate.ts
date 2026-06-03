import type { Edge } from '@xyflow/react';
import { getPlatform } from '../platform';
import { defaultCharacter, useEditorStore } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import { inspectModel } from '../three/inspectModel';
import type {
  AnimationAsset,
  AnimatorCondition,
  AnimatorController,
  AnimatorParameter,
  AnimatorState,
  AssetItem,
  GraphNodeCategory,
  MeshRendererComponent,
  NodeForgeNode,
  NodeForgeNodeData,
  PhysicsComponent,
  ProjectGraph,
  ProjectVariable,
  SceneObject,
  SkeletalMeshAsset,
  ScriptBlueprint,
  UIDocument,
  UIElement,
  Vector3Tuple,
} from '../types';

const makeId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

// --- Bundled low-poly FPS kit (public/templates/fps): 5 weapon arm rigs, each with its own animation set. ---
const ARMS_DIR = 'templates/fps/Arms';

/** Per-weapon view-model placement in camera space (down + forward). Tune in the Inspector if needed. */
const ARM_TRANSFORM = { position: [0, -0.32, -0.5] as Vector3Tuple, rotation: [0, Math.PI, 0] as Vector3Tuple, scale: [1, 1, 1] as Vector3Tuple };

type WeaponKind = 'ranged' | 'sniper' | 'melee' | 'grenade';
interface WeaponDef {
  file: string;
  name: string;
  key: string; // keyboard slot
  kind: WeaponKind;
  mag: number; // magazine size (0 = melee, no ammo)
}
const WEAPONS: WeaponDef[] = [
  { file: 'Arms_M416_Assault_Rifle.glb', name: 'M416 Rifle', key: 'Digit1', kind: 'ranged', mag: 30 },
  { file: 'Arms_Glock_G48.glb', name: 'Glock G48', key: 'Digit2', kind: 'ranged', mag: 17 },
  { file: 'Arms_AWM_Sniper.glb', name: 'AWM Sniper', key: 'Digit3', kind: 'sniper', mag: 5 },
  { file: 'Arms_Combat_Knife.glb', name: 'Combat Knife', key: 'Digit4', kind: 'melee', mag: 0 },
  { file: 'Arms_Grenade.glb', name: 'Grenade', key: 'Digit5', kind: 'grenade', mag: 1 },
];

const defaultRenderer = (mesh: MeshRendererComponent['mesh'], color: string): MeshRendererComponent => ({
  enabled: true,
  mesh,
  color,
  metalness: 0.1,
  roughness: 0.6,
});

const fixedBox = (collider: PhysicsComponent['collider'] = 'box'): PhysicsComponent => ({
  enabled: true,
  bodyType: 'fixed',
  collider,
  isTrigger: false,
  collisionLayer: 0,
  collisionMask: 0xffff,
  mass: 1,
  gravityScale: 1,
  friction: 0.8,
  linearDamping: 0,
  angularDamping: 0.05,
});

const dynamicBox = (): PhysicsComponent => ({ ...fixedBox('box'), bodyType: 'dynamic', mass: 0.7, friction: 0.6, angularDamping: 0.4 });

const toneByCategory: Record<GraphNodeCategory, NodeForgeNodeData['tone']> = {
  Events: 'event', Logic: 'logic', Math: 'math', Runtime: 'runtime', Physics: 'physics', Audio: 'audio',
  Values: 'value', Variables: 'variable', Data: 'data', Persistence: 'persistence', Material: 'material', UI: 'ui',
};

const nodeData = (label: string, category: GraphNodeCategory, data: Partial<NodeForgeNodeData>): NodeForgeNodeData => ({
  label,
  category,
  description: data.description ?? `${category} node`,
  tone: toneByCategory[category],
  hasInput: data.hasInput ?? !data.nodeKind?.startsWith('event.'),
  hasOutput: data.hasOutput ?? true,
  ...data,
  nodeKind: data.nodeKind ?? 'event.update',
});

const graphNode = (id: string, label: string, category: GraphNodeCategory, x: number, y: number, data: Partial<NodeForgeNodeData>): NodeForgeNode => ({
  id,
  type: 'nodeforge',
  position: { x, y },
  data: nodeData(label, category, data),
});

const execEdge = (source: string, target: string): Edge => ({ id: makeId('edge'), source, target, sourceHandle: 'exec-out', targetHandle: 'exec-in', animated: true, type: 'smoothstep' });
const valueEdge = (source: string, target: string, targetHandle: string): Edge => ({ id: makeId('edge'), source, target, sourceHandle: 'value-out', targetHandle, type: 'smoothstep', style: { stroke: '#3DD0DC', strokeWidth: 2 } });

const uiElement = (kind: UIElement['kind'], name: string, style: UIElement['style'], text?: string): UIElement => ({
  id: makeId('uiel'), kind, name, text, style, bindings: [], children: [],
});
const boundElement = (kind: UIElement['kind'], name: string, style: UIElement['style'], bindings: UIElement['bindings'], text?: string): UIElement => ({
  ...uiElement(kind, name, style, text), bindings,
});

/** Clean, bright minimal HUD: a bottom-right weapon + ammo readout (dark tabular count beside a dim
 *  "/ MAG") on a light glass chip, and a key-cap controls strip that auto-fades a few seconds after
 *  drop-in so the screen clears for play. Binds Weapon/Ammo/MagSize. No vignette, no health bar — the
 *  sandbox has no combat, so it stays calm and uncluttered.
 *  (The live crosshair is drawn by the engine's DynamicCrosshair overlay, not a static element.) */
const createFpsHud = (): UIDocument => {
  const root = uiElement('panel', 'Root', { width: '100%', height: '100%', position: 'relative', padding: '0' });

  // Bottom-right: small uppercase weapon name, then a big tabular ammo count beside a dim "/ MAG", on a
  // light translucent chip with a soft blue edge.
  const weaponBox = uiElement('panel', 'Weapon Box', {
    position: 'absolute', display: 'flex', flexDirection: 'column',
    custom: {
      right: '32px', bottom: '28px', alignItems: 'flex-end', gap: '2px', pointerEvents: 'none',
      background: 'rgba(255,255,255,0.78)', padding: '10px 18px', borderRadius: '14px',
      border: '1px solid rgba(43,127,255,0.3)', boxShadow: '0 8px 24px rgba(40,70,120,0.18)',
    },
  });
  const weaponName = boundElement('text', 'Weapon', {
    color: '#2b7fff', fontSize: '11px', fontWeight: '800', textAlign: 'right',
    custom: { letterSpacing: '3px', textTransform: 'uppercase' },
  }, [{ target: 'text', expression: `Weapon` }], 'M416 RIFLE');
  const ammoRow = uiElement('panel', 'Ammo Row', { display: 'flex', custom: { alignItems: 'flex-end', gap: '6px' } });
  const ammoCurrent = boundElement('text', 'Ammo', {
    color: '#16203a', fontSize: '38px', fontWeight: '800', textAlign: 'right',
    custom: { lineHeight: '1', fontVariantNumeric: 'tabular-nums' },
  }, [
    { target: 'text', expression: `MagSize > 0 ? '' + Ammo : '—'` },
    { target: 'color', expression: `Ammo == 0 && MagSize > 0 ? '#ff5a5f' : '#16203a'` },
  ], '30');
  const ammoMag = boundElement('text', 'Ammo Mag', {
    color: 'rgba(22,32,58,0.42)', fontSize: '16px', fontWeight: '700', textAlign: 'left',
    custom: { lineHeight: '1', paddingBottom: '4px', fontVariantNumeric: 'tabular-nums' },
  }, [{ target: 'text', expression: `MagSize > 0 ? '/ ' + MagSize : ''` }], '/ 30');
  ammoRow.children = [ammoCurrent, ammoMag];
  weaponBox.children = [weaponName, ammoRow];

  // Quick-start controls strip — light key-cap chips, centered low. Pure CSS: holds visible then fades a
  // few seconds after drop-in so the screen clears for play (pointerEvents none so it never eats clicks).
  const controls = uiElement('panel', 'Controls', {
    position: 'absolute', left: '50%', display: 'flex',
    custom: { bottom: '32px', transform: 'translateX(-50%)', gap: '14px', alignItems: 'center', pointerEvents: 'none', animation: 'nf-controls-fade 10s ease-in 0.5s forwards' },
  });
  const chip = (key: string, label: string): UIElement => {
    const wrap = uiElement('panel', `Key ${key}`, { display: 'flex', custom: { alignItems: 'center', gap: '7px' } });
    const cap = uiElement('text', 'Cap', {
      color: '#16203a', fontSize: '11px', fontWeight: '800',
      custom: { letterSpacing: '1px', background: 'rgba(255,255,255,0.85)', border: '1px solid rgba(43,127,255,0.32)', borderRadius: '6px', padding: '3px 7px', boxShadow: '0 2px 8px rgba(40,70,120,0.12)' },
    }, key);
    const lab = uiElement('text', 'Label', { color: 'rgba(22,32,58,0.66)', fontSize: '11px', fontWeight: '600', custom: { letterSpacing: '0.5px' } }, label);
    wrap.children = [cap, lab];
    return wrap;
  };
  controls.children = [chip('WASD', 'Move'), chip('LMB', 'Fire'), chip('RMB', 'Aim'), chip('R', 'Reload'), chip('1-5', 'Weapons'), chip('SPACE', 'Jump')];

  root.children = [weaponBox, controls];
  const css = '@keyframes nf-controls-fade { 0%, 70% { opacity: 1; } 100% { opacity: 0; } }';
  return { id: makeId('ui'), name: 'FPS HUD', surface: 'screen', root, css, visibleOnStart: true, createdAt: Date.now() };
};

/** Import a bundled audio clip once (for Play Sound nodes), reusing it if already imported. */
async function importAudio(file: string, folderId?: string): Promise<AssetItem | undefined> {
  const existing = useEditorStore.getState().assets.find((a) => a.name === file && a.type === 'audio');
  if (existing) return existing;
  const response = await fetch(`templates/fps/Audio/${file}`);
  if (!response.ok) return undefined;
  const blob = await response.blob();
  const platformFile = new File([blob], file, { type: 'audio/mpeg' });
  const platform = await getPlatform();
  const projectDir = useProjectStore.getState().projectDir ?? 'web';
  const { path, url } = await platform.importAsset(projectDir, platformFile);
  const assetId = makeId('asset');
  const item: AssetItem = { id: assetId, name: file, type: 'audio', size: platformFile.size, path, url, folderId, createdAt: Date.now() };
  useEditorStore.getState().addAssetItems([item]);
  return useEditorStore.getState().assets.find((a) => a.id === assetId);
}

/** Import a shared bundled clip from public/audio (ambient bed, music, hurt sting), reusing it if present. */
async function importPublicAudio(file: string, folderId?: string): Promise<AssetItem | undefined> {
  const existing = useEditorStore.getState().assets.find((a) => a.name === file && a.type === 'audio');
  if (existing) return existing;
  const response = await fetch(`audio/${file}`);
  if (!response.ok) return undefined;
  const blob = await response.blob();
  const platformFile = new File([blob], file, { type: 'audio/mpeg' });
  const platform = await getPlatform();
  const projectDir = useProjectStore.getState().projectDir ?? 'web';
  const { path, url } = await platform.importAsset(projectDir, platformFile);
  const assetId = makeId('asset');
  const item: AssetItem = { id: assetId, name: file, type: 'audio', size: platformFile.size, path, url, folderId, createdAt: Date.now() };
  useEditorStore.getState().addAssetItems([item]);
  return useEditorStore.getState().assets.find((a) => a.id === assetId);
}

interface ImportedRig {
  asset: AssetItem;
  mesh: SkeletalMeshAsset;
  clips: AnimationAsset[];
}

/** Import + split a rigged GLB (skeleton, skinned mesh, animations), reusing it if already imported. Defaults to
 *  the FPS arm rigs, but `dir` lets it pull other rigged models (e.g. the full-body UAL1 rig for enemies). */
async function importArmRig(file: string, folderId?: string, dir: string = ARMS_DIR): Promise<ImportedRig | undefined> {
  const editor = useEditorStore.getState();
  let asset = editor.assets.find((a) => a.name === file && a.type === 'model');
  let mesh = asset ? editor.skeletalMeshes.find((m) => m.sourceAssetId === asset!.id) : undefined;

  if (!asset || !mesh) {
    const response = await fetch(`${dir}/${file}`);
    if (!response.ok) return undefined;
    const blob = await response.blob();
    const platformFile = new File([blob], file, { type: 'model/gltf-binary' });
    const platform = await getPlatform();
    const projectDir = useProjectStore.getState().projectDir ?? 'web';
    const { path, url } = await platform.importAsset(projectDir, platformFile);
    const assetId = makeId('asset');
    const item: AssetItem = { id: assetId, name: file, type: 'model', size: platformFile.size, path, url, folderId, createdAt: Date.now() };
    useEditorStore.getState().addAssetItems([item]);
    const inspection = await inspectModel(platformFile);
    useEditorStore.getState().registerImportedModel({ assetId, assetName: file, folderId, inspection });
    const after = useEditorStore.getState();
    asset = after.assets.find((a) => a.id === assetId);
    mesh = asset ? after.skeletalMeshes.find((m) => m.sourceAssetId === asset!.id) : undefined;
  }
  if (!asset || !mesh) return undefined;
  const clips = useEditorStore.getState().animations.filter((a) => a.skeletonId === mesh!.skeletonId);
  return { asset, mesh, clips };
}

const C = (parameterId: string, op: AnimatorCondition['op'], value: number | boolean): AnimatorCondition => ({ parameterId, op, value });

/**
 * Build a per-weapon FP animator controller. Locomotion (Idle/Walk/Run/Jump) and actions
 * (Fire/ADS/Reload/Melee/Throw) are driven by AUTO-SOURCED parameters that the runtime feeds from the
 * OWNER pawn's state (movement speed, grounded, and the aim/fire/reload keys) — so the arms animate
 * automatically from the player's input, Unreal-style. "Draw" is a manual trigger fired on weapon swap.
 */
function buildWeaponController(name: string, skeletonId: string, clips: AnimationAsset[], kind: WeaponKind): { controller: AnimatorController; drawParam: string } {
  const pick = (...res: RegExp[]) => {
    for (const re of res) {
      const found = clips.find((c) => re.test(c.name) || re.test(c.clipName));
      if (found) return found.id;
    }
    return undefined;
  };
  const pickNot = (re: RegExp, not: RegExp) => clips.find((c) => (re.test(c.name) || re.test(c.clipName)) && !(not.test(c.name) || not.test(c.clipName)))?.id;

  const idleId = pick(/idle/i);
  const walkId = pick(/walk/i);
  const runId = pick(/run/i);
  const jumpId = pick(/jump/i);
  const fireId = pickNot(/fire/i, /ads/i);
  const adsId = pickNot(/ads/i, /fire/i);
  const reloadId = pick(/reload_anim/i, /reload(?!_empty)/i, /reload/i);
  const drawId = pick(/draw/i);
  const meleeId = pick(/melee/i, /attack_1/i, /attack/i);
  const throwId = pick(/throw/i);

  const speedP = makeId('param');
  const vspeedP = makeId('param');
  const groundedP = makeId('param');
  const aimingP = makeId('param');
  const reloadingP = makeId('param');
  const attackingP = makeId('param');
  const drawP = makeId('param');
  const parameters: AnimatorParameter[] = [
    { id: speedP, name: 'Speed', type: 'float', source: 'speed', defaultValue: 0 },
    { id: vspeedP, name: 'VerticalSpeed', type: 'float', source: 'verticalSpeed', defaultValue: 0 },
    { id: groundedP, name: 'Grounded', type: 'bool', source: 'grounded', defaultValue: true },
    { id: aimingP, name: 'Aiming', type: 'bool', source: 'aiming', defaultValue: false },
    { id: reloadingP, name: 'Reloading', type: 'bool', source: 'reloading', defaultValue: false },
    { id: attackingP, name: 'Attacking', type: 'bool', source: 'attacking', defaultValue: false },
    { id: drawP, name: 'Draw', type: 'trigger', source: 'manual', defaultValue: false },
  ];

  const states: AnimatorState[] = [];
  const id: Record<string, string> = {};
  const layout: Record<string, { x: number; y: number }> = {
    idle: { x: 80, y: 60 }, walk: { x: 340, y: 60 }, run: { x: 600, y: 60 },
    jump: { x: 340, y: 220 }, fire: { x: 80, y: 380 }, ads: { x: 340, y: 380 },
    reload: { x: 600, y: 380 }, draw: { x: 600, y: 220 }, melee: { x: 80, y: 540 }, throw: { x: 340, y: 540 },
  };
  const addState = (key: string, label: string, animationId: string | undefined, loop: boolean) => {
    if (!animationId) return;
    const sid = makeId('state');
    id[key] = sid;
    states.push({ id: sid, name: label, animationId, speed: 1, loop, position: layout[key] ?? { x: 80, y: 60 + states.length * 80 } });
  };
  addState('idle', 'Idle', idleId, true);
  addState('walk', 'Walk', walkId, true);
  addState('run', 'Run', runId, true);
  addState('jump', 'Jump', jumpId, true);
  // Fire/Melee are ONE-SHOTS that play the clip fully (exit-time near the end), then return home.
  // (Looping a single-shot recoil clip snaps at the loop point; one-shot-to-completion reads clean —
  // a held trigger simply re-enters once the clip finishes, giving a natural fire rate.)
  addState('fire', 'Fire', fireId, false);
  addState('ads', 'Aim', adsId, true);
  addState('reload', 'Reload', reloadId, false);
  addState('draw', 'Draw', drawId, false);
  addState('melee', 'Melee', meleeId, false);
  addState('throw', 'Throw', throwId, false);

  const transitions: AnimatorController['transitions'] = [];
  const link = (from: string, to: string, conditions: AnimatorCondition[], duration = 0.16) => {
    if (id[from] && id[to]) transitions.push({ id: makeId('xition'), from: id[from], to: id[to], conditions, duration });
  };
  const linkAny = (to: string, conditions: AnimatorCondition[], duration = 0.1) => {
    if (id[to]) transitions.push({ id: makeId('xition'), from: 'any', to: id[to], conditions, duration });
  };
  const linkExit = (from: string, to: string, exitTime = 0.85, duration = 0.12) => {
    if (id[from] && id[to]) transitions.push({ id: makeId('xition'), from: id[from], to: id[to], conditions: [], duration, hasExitTime: true, exitTime });
  };

  const home = id.idle ? 'idle' : states[0] ? Object.keys(id).find((k) => id[k] === states[0].id)! : 'idle';

  // Highest priority first (the runtime takes the first satisfied transition).
  // Weapon swap → Draw, then play out back home.
  linkAny('draw', [C(drawP, '==', true)], 0.04);
  linkExit('draw', home);
  // Reload.
  linkAny('reload', [C(reloadingP, '==', true)], 0.06);
  linkExit('reload', home, 0.95);
  // Attack: ranged/sniper → Fire, melee → Melee, grenade → Throw. Each is a ONE-SHOT that plays the
  // clip to completion (exit-time) then returns home — no mid-clip restart, no loop-point snap. A held
  // trigger re-enters once the clip finishes (natural fire rate).
  if (kind === 'melee') {
    linkAny('melee', [C(attackingP, '==', true)], 0.05);
    linkExit('melee', home, 0.85);
  } else if (kind === 'grenade') {
    linkAny('throw', [C(attackingP, '==', true)], 0.04);
    linkExit('throw', home, 0.9);
  } else {
    linkAny('fire', [C(attackingP, '==', true)], 0.04);
    linkExit('fire', home, 0.92);
  }
  // Jump (from grounded movement states).
  ['idle', 'walk', 'run'].forEach((from) => link(from, 'jump', [C(vspeedP, '>', 1)], 0.1));
  link('jump', home, [C(groundedP, '==', true)], 0.18);
  // Aim down sights — a hold pose, lowest action priority so Fire/Reload win.
  linkAny('ads', [C(aimingP, '==', true)], 0.16);
  link('ads', home, [C(aimingP, '==', false)], 0.18);
  // Locomotion speed tiers, with HYSTERESIS (enter-high / exit-low gaps) so a speed hovering near a
  // threshold doesn't flicker between states, and longer crossfades so blends read smoothly.
  link('idle', 'walk', [C(speedP, '>', 0.4)], 0.25);
  link('walk', 'idle', [C(speedP, '<', 0.15)], 0.3);
  link('walk', 'run', [C(speedP, '>', 3.4)], 0.28);
  link('run', 'walk', [C(speedP, '<', 2.6)], 0.28);
  if (!id.walk) {
    link('idle', 'run', [C(speedP, '>', 0.4)], 0.25);
    link('run', 'idle', [C(speedP, '<', 0.15)], 0.3);
  }

  const controller: AnimatorController = {
    id: makeId('animctl'),
    name: `${name} Arms`,
    skeletonId,
    parameters,
    states,
    defaultStateId: id.idle ?? states[0]?.id,
    transitions,
    createdAt: Date.now(),
  };
  return { controller, drawParam: 'Draw' };
}

/**
 * Build a clean, bright "first-person learning sandbox" — Unreal-FP-template style. A calm, well-lit
 * room that teaches the basics one station at a time: move + mouse-look, hold-to-fire at knock-over
 * target cubes, swap between the 5 bundled weapons, reload, and climb a short staircase onto a platform.
 * No enemies, no win/lose, no fog — just a friendly playground with floating tip prompts. Reuses the
 * bundled FPS arm rigs (each with its own idle/walk/run/jump/fire/aim/reload set) + auto-driven animators.
 * Returns the player object id. Requires a project to be open.
 */
export async function createFirstPersonTemplate(): Promise<string | undefined> {
  const store = useEditorStore.getState();
  const armsFolder = store.createFolder('FPS Arms');

  // --- Bright, clean daylight: a soft blue sky, strong ambient so every surface reads clearly, and a
  //     high warm sun for gentle shadows. No fog — keep the room open and legible. (All tunable later in
  //     Scene Settings → Environment and Render.) ---
  const sceneId = store.activeSceneId;
  store.updateSceneEnvironment(sceneId, {
    skyMode: 'procedural',
    skyTopColor: '#8fb8e6',
    skyHorizonColor: '#dbe7f2',
    skyGroundColor: '#cfd6dd',
    environmentIntensity: 1.15,
    sunColor: '#fff3df',
    sunIntensity: 1.7,
    sunAzimuth: 135,
    sunElevation: 58,
    fogEnabled: false,
  });
  // Soft, restrained post: just a touch of bloom on the brightest accents, and NO vignette — the clean
  // daylight look reads best without darkened corners.
  store.updateRenderSettings({ bloomEnabled: true, bloomIntensity: 0.28, bloomThreshold: 0.9, bloomRadius: 0.5, vignetteEnabled: false });

  // --- Import every weapon arm rig + build its animator controller (locomotion + fire/aim/reload auto-
  //     sourced from the owner pawn's input — Unreal-style). ---
  const pawnId = makeId('obj');
  interface BuiltWeapon extends WeaponDef { armsId: string; controller: AnimatorController; mesh: SkeletalMeshAsset; assetId: string; }
  const built: BuiltWeapon[] = [];
  for (const weapon of WEAPONS) {
    const rig = await importArmRig(weapon.file, armsFolder);
    if (!rig) continue;
    const { controller } = buildWeaponController(weapon.name, rig.mesh.skeletonId, rig.clips, weapon.kind);
    built.push({ ...weapon, armsId: makeId('obj'), controller, mesh: rig.mesh, assetId: rig.asset.id });
  }
  if (!built.length) throw new Error('Bundled FPS arm rigs not found under public/templates/fps/Arms.');

  // --- Sounds: shot + reload (wired into the fire/reload graph), footsteps, and a low ambient room tone. ---
  const audioFolder = store.createFolder('FPS Audio');
  const fireSound = await importAudio('fps_fire.mp3', audioFolder);
  const reloadSound = await importAudio('fps_reload.mp3', audioFolder);
  const footstepSound = await importAudio('fps_footstep.mp3', audioFolder);
  const ambientSound = await importPublicAudio('ambient.mp3', audioFolder);
  store.setSceneAudio(sceneId, { ambientSoundId: ambientSound?.id });

  // --- Project variables: HUD weapon name, slot (gates which weapons fire), and ammo + magazine size. ---
  const weaponVarId = makeId('var');
  const slotVarId = makeId('var');
  const ammoVarId = makeId('var');
  const magVarId = makeId('var');
  const weaponVar: ProjectVariable = { id: weaponVarId, name: 'Weapon', type: 'string', defaultValue: built[0].name, persistent: false, createdAt: Date.now() };
  const slotVar: ProjectVariable = { id: slotVarId, name: 'WeaponSlot', type: 'number', defaultValue: 1, persistent: false, createdAt: Date.now() };
  const ammoVar: ProjectVariable = { id: ammoVarId, name: 'Ammo', type: 'number', defaultValue: built[0].mag, persistent: false, createdAt: Date.now() };
  const magVar: ProjectVariable = { id: magVarId, name: 'MagSize', type: 'number', defaultValue: built[0].mag, persistent: false, createdAt: Date.now() };

  // --- Arms view-models (one per weapon), pinned to the player camera; only the first starts visible. ---
  const arms: SceneObject[] = built.map((w) => ({
    id: w.armsId,
    name: `${w.name} Arms`,
    kind: 'cube',
    transform: { ...ARM_TRANSFORM, position: [...ARM_TRANSFORM.position] as Vector3Tuple, rotation: [...ARM_TRANSFORM.rotation] as Vector3Tuple, scale: [...ARM_TRANSFORM.scale] as Vector3Tuple },
    renderer: { ...defaultRenderer('cube', '#c7b39c'), modelAssetId: w.assetId },
    animator: { enabled: true, controllerId: w.controller.id, skeletalMeshId: w.mesh.id, speed: 1, loop: true },
    viewModel: { ownerObjectId: pawnId },
  }));

  // --- Player graph: weapon picker (1–5), movement/jump, hold-to-fire, and reload. ---
  const graphId = makeId('graph');
  const blueprintId = makeId('bp');
  const nodes: NodeForgeNode[] = [];
  const edges: Edge[] = [];
  let cursorY = 40;
  const add = (label: string, category: GraphNodeCategory, x: number, data: Partial<NodeForgeNodeData>): string => {
    const id = makeId('node');
    nodes.push(graphNode(id, label, category, x, cursorY, data));
    return id;
  };
  const row = () => { cursorY += 120; };

  // Movement + jump (the pawn is scripted, so its motion comes from these nodes; the arms animator reads
  // the resulting speed automatically).
  const updateNode = add('Update', 'Events', 40, { nodeKind: 'event.update', hasInput: false, description: 'Every frame.' });
  const moveInput = add('Get Move Input', 'Runtime', 40 + 600, { nodeKind: 'input.move', hasInput: false });
  const moveNode = add('Move', 'Runtime', 320, { nodeKind: 'action.move', amount: 4.2, description: 'Move the player.' });
  edges.push(execEdge(updateNode, moveNode), valueEdge(moveInput, moveNode, 'vector'));
  row();
  const jumpKey = add('Key Down: Space', 'Events', 40, { nodeKind: 'event.keyDown', keyCode: 'Space', hasInput: false });
  const jumpNode = add('Jump', 'Runtime', 320, { nodeKind: 'action.jump' });
  edges.push(execEdge(jumpKey, jumpNode));
  row();

  // Start: hide every weapon except the first.
  const startNode = add('Start', 'Events', 40, { nodeKind: 'event.start', hasInput: false, description: 'Holster all but the first weapon.' });
  let prev = startNode;
  built.forEach((w, i) => {
    const vis = add('Set Visible', 'Runtime', 320 + i * 60, { nodeKind: 'action.setVisible', targetObjectId: w.armsId, visible: i === 0, description: `${i === 0 ? 'Show' : 'Hide'} ${w.name}.` });
    edges.push(execEdge(prev, vis));
    prev = vis;
  });
  row();

  // Weapon picker: keys 1–5 → show this weapon, hide the others, play its Draw, set the HUD name + slot + ammo.
  built.forEach((w, i) => {
    const keyNode = add(`Key Up: ${w.key}`, 'Events', 40, { nodeKind: 'event.keyUp', keyCode: w.key, hasInput: false, description: `Equip ${w.name}.` });
    let chain = keyNode;
    built.forEach((other, j) => {
      const vis = add('Set Visible', 'Runtime', 300 + j * 50, { nodeKind: 'action.setVisible', targetObjectId: other.armsId, visible: j === i });
      edges.push(execEdge(chain, vis));
      chain = vis;
    });
    const base = 300 + built.length * 50;
    const draw = add('Set Anim Trigger', 'Runtime', base, { nodeKind: 'animator.setTrigger', targetObjectId: w.armsId, paramName: 'Draw', description: `Play ${w.name} draw.` });
    const setName = add('Set Variable', 'Variables', base + 220, { nodeKind: 'variable.set', variableId: weaponVarId, valueType: 'string', stringValue: w.name });
    const setSlot = add('Set Variable', 'Variables', base + 440, { nodeKind: 'variable.set', variableId: slotVarId, valueType: 'number', numberValue: i + 1 });
    const setMag = add('Set Variable', 'Variables', base + 660, { nodeKind: 'variable.set', variableId: magVarId, valueType: 'number', numberValue: w.mag, description: `${w.name} magazine size.` });
    const setAmmo = add('Set Variable', 'Variables', base + 880, { nodeKind: 'variable.set', variableId: ammoVarId, valueType: 'number', numberValue: w.mag, description: 'Equip with a full magazine.' });
    edges.push(execEdge(chain, draw), execEdge(draw, setName), execEdge(setName, setSlot), execEdge(setSlot, setMag), execEdge(setMag, setAmmo));
    row();
  });

  // Hold to shoot (full-auto) — fire while LMB is HELD, gated by a Cooldown so it fires at a steady rate.
  // Only guns (slots 1–3) fire, and only when there's ammo; each shot spends a round and fires a built-in
  // tracer that physically KNOCKS the light target cubes (no damage — they topple, they don't vanish).
  {
    const fireKey = add('Key Down: Mouse0', 'Events', 40, { nodeKind: 'event.keyDown', keyCode: 'Mouse0', hasInput: false, description: 'Hold to fire (auto).' });
    const fireRate = add('Cooldown', 'Logic', 200, { nodeKind: 'logic.cooldown', numberValue: 0.12, description: 'Auto fire rate (seconds per shot).' });
    const getSlot = add('Get Variable', 'Variables', 40 + 760, { nodeKind: 'variable.get', variableId: slotVarId, valueType: 'number', hasInput: false });
    const slotCmp = add('Compare', 'Logic', 300, { nodeKind: 'logic.compare', compareOp: '<=', numberValue: 3, description: 'Guns only.' });
    const slotBranch = add('Branch', 'Logic', 520, { nodeKind: 'logic.branch' });
    const getAmmo = add('Get Variable', 'Variables', 40 + 1020, { nodeKind: 'variable.get', variableId: ammoVarId, valueType: 'number', hasInput: false });
    const ammoCmp = add('Compare', 'Logic', 740, { nodeKind: 'logic.compare', compareOp: '>', numberValue: 0, description: 'Have ammo?' });
    const ammoBranch = add('Branch', 'Logic', 960, { nodeKind: 'logic.branch' });
    const getAmmo2 = add('Get Variable', 'Variables', 740 + 600, { nodeKind: 'variable.get', variableId: ammoVarId, valueType: 'number', hasInput: false });
    const dec = add('Add', 'Math', 1180, { nodeKind: 'math.add', amount: -1, description: 'Spend a round.' });
    const setAmmo = add('Set Variable', 'Variables', 1400, { nodeKind: 'variable.set', variableId: ammoVarId, valueType: 'number' });
    const shoot = add('Spawn Projectile', 'Runtime', 1620, {
      nodeKind: 'action.spawnProjectile', projectileSpeed: 80, projectileDamage: 0, projectileLife: 2,
      projectileColor: '#bfe3ff', projectileSize: 0.14, projectileKnockback: 1.6, description: 'Fire a tracer that knocks the cubes flying.',
    });
    edges.push(
      valueEdge(getSlot, slotCmp, 'a'), valueEdge(slotCmp, slotBranch, 'condition'), execEdge(fireKey, fireRate), execEdge(fireRate, slotBranch),
      valueEdge(getAmmo, ammoCmp, 'a'), valueEdge(ammoCmp, ammoBranch, 'condition'), execEdge(slotBranch, ammoBranch),
      valueEdge(getAmmo2, dec, 'a'), valueEdge(dec, setAmmo, 'value'), execEdge(ammoBranch, setAmmo), execEdge(setAmmo, shoot),
    );
    if (fireSound) {
      const fireSfx = add('Play Sound', 'Audio', 1840, { nodeKind: 'action.playSound', assetId: fireSound.id, description: 'Gunshot.' });
      edges.push(execEdge(shoot, fireSfx));
    }
    row();
  }

  // Reload (R) — refill the magazine to MagSize. The Reload arm animation plays automatically (the reload
  // key drives the 'reloading' animator param), so this just tops the ammo back up.
  {
    const reloadKey = add('Key Up: KeyR', 'Events', 40, { nodeKind: 'event.keyUp', keyCode: 'KeyR', hasInput: false, description: 'Reload.' });
    const getMag = add('Get Variable', 'Variables', 40 + 600, { nodeKind: 'variable.get', variableId: magVarId, valueType: 'number', hasInput: false });
    const setAmmoFull = add('Set Variable', 'Variables', 320, { nodeKind: 'variable.set', variableId: ammoVarId, valueType: 'number', description: 'Ammo = MagSize.' });
    edges.push(valueEdge(getMag, setAmmoFull, 'value'), execEdge(reloadKey, setAmmoFull));
    if (reloadSound) {
      const reloadSfx = add('Play Sound', 'Audio', 560, { nodeKind: 'action.playSound', assetId: reloadSound.id, description: 'Reload sound.' });
      edges.push(execEdge(setAmmoFull, reloadSfx));
    }
    row();
  }

  const blueprint: ScriptBlueprint = { id: blueprintId, name: 'FPS Controller', description: 'First-person movement, weapon switching, and shooting.', graphId, color: '#3DDC97', createdAt: Date.now() };
  store.moveToFolder('blueprint', blueprintId, store.createFolder('FPS Player'));
  const graph: ProjectGraph = { id: graphId, name: 'FPS Controller', nodes, edges };

  // --- The player pawn (first-person, mouse-look). Scripted motion feeds the arms animators. ---
  const pawn: SceneObject = {
    id: pawnId,
    name: 'FPS Player',
    kind: 'empty',
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    character: {
      ...defaultCharacter(),
      enabled: true,
      moveSpeed: 4.2,
      sprintMultiplier: 1.5,
      jumpStrength: 5.5,
      cameraMode: 'firstPerson',
      cameraFollow: true,
      mouseLook: true,
      cameraOffset: [0, 1.7, 0],
      cameraPitch: 0,
      cameraMinPitch: -1.2,
      cameraMaxPitch: 1.2,
      keyAttack: 'Mouse0',
      keyAim: 'Mouse1',
      keyReload: 'KeyR',
      footstepSoundId: footstepSound?.id,
      rollSpeed: 0,
      rollDuration: 0.1,
    },
    script: { blueprintId, graphId, enabled: true },
  };

  // ============================================================================================
  // THE ROOM — one clean, bright, open space. Light walls with a blue baseboard accent, a few soft fill
  // lights, and learning "stations" along a central path: loose cubes to nudge, knock-over target stacks
  // to shoot, pedestal targets, and a short staircase up to a platform. Floating tip prompts teach each beat.
  // ============================================================================================
  const props: SceneObject[] = [];
  interface BlockOpts { emissive?: string; intensity?: number; metalness?: number; roughness?: number; rotation?: Vector3Tuple; solid?: boolean; }
  // A fixed structural block (wall/step/platform/pedestal). solid:false makes it a decorative, collision-free accent.
  const block = (name: string, position: Vector3Tuple, scale: Vector3Tuple, color: string, opts: BlockOpts = {}): SceneObject => {
    const renderer: MeshRendererComponent = {
      ...defaultRenderer('cube', color),
      metalness: opts.metalness ?? 0.08,
      roughness: opts.roughness ?? 0.85,
      ...(opts.emissive ? { materialOverrides: { emissiveColor: opts.emissive, emissiveIntensity: opts.intensity ?? 1.2 } } : {}),
    };
    const obj: SceneObject = {
      id: makeId('obj'), name, kind: 'cube',
      transform: { position, rotation: opts.rotation ?? [0, 0, 0], scale },
      renderer,
    };
    if (opts.solid !== false) obj.physics = fixedBox();
    props.push(obj);
    return obj;
  };
  // A light, low-friction DYNAMIC cube — the classic shoot/walk-into knock-over target. The player's tracer
  // (a moving dynamic body) and the character controller (applyImpulsesToDynamicBodies) both shove it.
  const target = (name: string, position: Vector3Tuple, color: string, accent?: string): SceneObject => {
    const obj: SceneObject = {
      id: makeId('obj'), name, kind: 'cube',
      transform: { position, rotation: [0, 0, 0], scale: [0.6, 0.6, 0.6] },
      renderer: { ...defaultRenderer('cube', color), metalness: 0.05, roughness: 0.7, ...(accent ? { materialOverrides: { emissiveColor: accent, emissiveIntensity: 0.5 } } : {}) },
      physics: { ...dynamicBox(), mass: 0.3, friction: 0.45, angularDamping: 0.25 },
    };
    props.push(obj);
    return obj;
  };

  const ground: SceneObject = {
    id: makeId('obj'), name: 'Floor', kind: 'cube',
    transform: { position: [0, -0.1, 13], rotation: [0, 0, 0], scale: [30, 0.2, 36] },
    renderer: { ...defaultRenderer('cube', '#cfd4db'), metalness: 0.1, roughness: 0.9 },
    physics: fixedBox(),
  };

  // Enclosing walls (off-white) + a glowing blue baseboard accent — the clean signature trim.
  const WALL = '#e9edf2';
  block('Wall Back', [0, 2, 31], [30, 4, 1], WALL, { roughness: 0.95 });
  block('Wall Front', [0, 2, -5], [30, 4, 1], WALL, { roughness: 0.95 });
  block('Wall Left', [-15, 2, 13], [1, 4, 36], WALL, { roughness: 0.95 });
  block('Wall Right', [15, 2, 13], [1, 4, 36], WALL, { roughness: 0.95 });
  const ACC = '#2b7fff';
  block('Accent Left', [-14.4, 0.2, 13], [0.1, 0.14, 34], ACC, { emissive: ACC, intensity: 1.6, solid: false });
  block('Accent Right', [14.4, 0.2, 13], [0.1, 0.14, 34], ACC, { emissive: ACC, intensity: 1.6, solid: false });
  block('Accent Back', [0, 0.2, 30.4], [29, 0.14, 0.1], ACC, { emissive: ACC, intensity: 1.6, solid: false });

  // Soft, neutral fill lights so the room is evenly, brightly lit (no dark corners).
  const lights: Array<{ p: Vector3Tuple; c: string; i: number }> = [
    { p: [-6, 5, 8], c: '#fff4e2', i: 5 },
    { p: [6, 5, 18], c: '#eef4ff', i: 5 },
    { p: [0, 5.5, 25], c: '#ffffff', i: 4 },
  ];
  lights.forEach((l, i) =>
    props.push({
      id: makeId('obj'), name: `Fill Light ${i + 1}`, kind: 'light',
      transform: { position: l.p, rotation: [0, 0, 0], scale: [1, 1, 1] },
      light: { type: 'point', color: l.c, intensity: l.i, distance: 28, angle: Math.PI / 6, castShadow: false },
    }),
  );

  // STATION 1 — loose cubes right by the spawn: walk into them to feel the physics immediately.
  ([[-1.7, 0.3, 4.4], [-0.9, 0.3, 5.0], [-0.1, 0.3, 4.5], [1.3, 0.3, 4.4], [2.0, 0.3, 5.0]] as Vector3Tuple[]).forEach((p, i) =>
    target(`Loose Cube ${i + 1}`, p, i % 2 ? '#bfe3ff' : '#f2f5f8', i % 2 ? '#2b7fff' : undefined),
  );

  // STATION 2 — two knock-over pyramids flanking the path: shoot them and they topple (light, low-friction).
  const pyramid = (bx: number, bz: number) => {
    ([-0.66, 0, 0.66] as number[]).forEach((dx, i) => target('Target Cube', [bx + dx, 0.3, bz], i === 1 ? '#ffd27f' : '#f2f5f8', i === 1 ? '#ff8a3d' : undefined));
    ([-0.33, 0.33] as number[]).forEach((dx) => target('Target Cube', [bx + dx, 0.9, bz], '#bfe3ff', '#2b7fff'));
    target('Target Cube', [bx, 1.5, bz], '#f2f5f8');
  };
  pyramid(-5, 9);
  pyramid(5, 9);

  // STATION 3 — pedestal targets: a row of single cubes perched on posts to pop off with a clean shot.
  [-6, -2, 2, 6].forEach((x) => {
    block('Pedestal', [x, 0.5, 15], [0.5, 1.0, 0.5], '#b6bcc6', { roughness: 0.7 });
    target('Pedestal Target', [x, 1.25, 15], '#ffd27f', '#ff8a3d');
  });

  // STATION 4 — a short staircase (each step ≤ the controller's 0.4 autostep, so it walks right up) onto a
  // raised platform with a few more targets to clear from the high ground.
  block('Platform', [0, 0.7, 25], [8, 1.4, 5], '#dde2e8', { roughness: 0.8 });
  ([[0.35, 20.05], [0.7, 20.75], [1.05, 21.45], [1.4, 22.15]] as Array<[number, number]>).forEach(([topY, z], i) =>
    block(`Step ${i + 1}`, [0, topY / 2, z], [5, topY, 0.7], '#d3d9e0', { roughness: 0.8 }),
  );
  target('Platform Target', [-1.4, 1.7, 25], '#bfe3ff', '#2b7fff');
  target('Platform Target', [0, 1.7, 24.4], '#ffd27f', '#ff8a3d');
  target('Platform Target', [1.4, 1.7, 25], '#bfe3ff', '#2b7fff');

  // ============================================================================================
  // TIP PROMPTS — a glowing floor pad + a trigger zone at each station. Walking in shows a sleek HUD card
  // (the right tip at the right moment); leaving hides it; each shows only the first time so it never nags.
  // ============================================================================================
  const tutorialObjects: SceneObject[] = [];
  const extraBlueprints: ScriptBlueprint[] = [];
  const extraGraphs: ProjectGraph[] = [];
  const extraUIDocs: UIDocument[] = [];

  const miniBlueprint = (name: string, color: string, build: (n: NodeForgeNode[], e: Edge[]) => void): { blueprintId: string; graphId: string } => {
    const gId = makeId('graph');
    const bId = makeId('bp');
    const n: NodeForgeNode[] = [];
    const e: Edge[] = [];
    build(n, e);
    extraGraphs.push({ id: gId, name, nodes: n, edges: e });
    extraBlueprints.push({ id: bId, name, description: name, graphId: gId, color, createdAt: Date.now() });
    return { blueprintId: bId, graphId: gId };
  };

  const makeSign = (header: string, body: string, position: Vector3Tuple, color = '#2b7fff', range = 2) => {
    // Hidden HUD prompt: a clean light-glass card with a colored left accent, an uppercase header, and a body
    // line. The doc ROOT must be a full-screen container (ScreenUILayer forces width/height 100% onto the
    // root) — the card is a CHILD pinned to upper-center, so it sizes to its content instead of ballooning
    // to fill (and pushing the text off-screen). It also stays clear of the bottom controls strip + crosshair.
    const docId = makeId('ui');
    const root = uiElement('panel', 'Tip Root', { width: '100%', height: '100%', position: 'relative', padding: '0' });
    const box = uiElement('panel', 'Tip', {
      position: 'absolute', left: '50%', display: 'flex', flexDirection: 'column',
      custom: {
        top: '13%', transform: 'translateX(-50%)', alignItems: 'center', gap: '5px',
        background: 'rgba(255,255,255,0.93)', padding: '14px 28px', borderRadius: '14px',
        border: `1px solid ${color}44`, borderLeft: `3px solid ${color}`,
        width: 'max-content', maxWidth: 'min(560px, 86%)', pointerEvents: 'none',
        boxShadow: '0 10px 30px rgba(40,70,120,0.22)', animation: 'nf-tip-in 0.26s ease-out',
      },
    });
    const headEl = uiElement('text', 'Tip Header', {
      color, fontSize: '13px', fontWeight: '800', textAlign: 'center',
      custom: { letterSpacing: '3px', textTransform: 'uppercase' },
    }, header);
    const bodyEl = uiElement('text', 'Tip Body', {
      color: 'rgba(22,32,58,0.86)', fontSize: '15px', fontWeight: '600', textAlign: 'center',
      custom: { whiteSpace: 'pre-line', lineHeight: '1.45' },
    }, body);
    box.children = [headEl, bodyEl];
    root.children = [box];
    const tipCss = '@keyframes nf-tip-in { from { opacity: 0; transform: translate(-50%, -10px); } to { opacity: 1; transform: translate(-50%, 0); } }';
    extraUIDocs.push({ id: docId, name: 'Tip', surface: 'screen', root, css: tipCss, visibleOnStart: false, createdAt: Date.now() });
    // Trigger zone: show the tip the FIRST time the player enters (gated by a `tipUnseen` flag we clear after),
    // then hide on exit — so a read tip won't nag you again if you backtrack.
    const zone = miniBlueprint('Sign Prompt', color, (n, e) => {
      const tIn = makeId('node');
      const getSeen = makeId('node');
      const branch = makeId('node');
      const show = makeId('node');
      const setSeen = makeId('node');
      const tOut = makeId('node');
      const hide = makeId('node');
      n.push(graphNode(tIn, 'Trigger Enter', 'Events', 40, 40, { nodeKind: 'event.triggerEnter', otherObjectId: pawnId, hasInput: false, description: 'Player nears the sign.' }));
      n.push(graphNode(getSeen, 'Get Object Var', 'Variables', 40, 200, { nodeKind: 'variable.getObject', objectKey: 'tipUnseen', hasInput: false, description: 'Not read yet?' }));
      n.push(graphNode(branch, 'Branch', 'Logic', 300, 40, { nodeKind: 'logic.branch', description: 'Only the first time.' }));
      n.push(graphNode(show, 'Show UI', 'UI', 540, 40, { nodeKind: 'ui.show', documentId: docId, description: 'Show the tip (fades in).' }));
      n.push(graphNode(setSeen, 'Set Object Var', 'Variables', 780, 40, { nodeKind: 'variable.setObject', objectKey: 'tipUnseen', numberValue: 0, description: 'Mark as read.' }));
      n.push(graphNode(tOut, 'Trigger Exit', 'Events', 40, 360, { nodeKind: 'event.triggerExit', otherObjectId: pawnId, hasInput: false, description: 'Player leaves the range.' }));
      n.push(graphNode(hide, 'Hide UI', 'UI', 300, 360, { nodeKind: 'ui.hide', documentId: docId, description: 'Hide the tip.' }));
      e.push(execEdge(tIn, branch), valueEdge(getSeen, branch, 'condition'), execEdge(branch, show), execEdge(show, setSeen), execEdge(tOut, hide));
    });
    tutorialObjects.push({
      id: makeId('obj'), name: 'Sign Zone', kind: 'empty',
      transform: { position: [position[0], 1.5, position[2]], rotation: [0, 0, 0], scale: [range * 2, 3, range * 2] },
      physics: { ...fixedBox('box'), bodyType: 'dynamic', isTrigger: true, gravityScale: 0 },
      script: { blueprintId: zone.blueprintId, graphId: zone.graphId, enabled: true },
      variables: { tipUnseen: true },
    });
    // A low glowing floor pad so the player can see where the tip is, kept flat so it never bars the view.
    tutorialObjects.push({
      id: makeId('obj'), name: 'Sign Marker', kind: 'cube',
      transform: { position: [position[0], 0.04, position[2]], rotation: [0, 0, 0], scale: [0.9, 0.06, 0.9] },
      renderer: { ...defaultRenderer('cube', color), materialOverrides: { emissiveColor: color, emissiveIntensity: 1.1 } },
    });
  };

  makeSign('Move & Look', 'WASD to move   ·   Move the mouse to look\nSHIFT to sprint   ·   SPACE to jump', [0, 0, 3], '#2b7fff', 2);
  makeSign('Shoot', 'Hold LEFT MOUSE to fire.\nKnock the stacked cubes flying!', [0, 0, 8], '#ff8a3d', 2);
  makeSign('Weapons', 'Press 1–5 to swap weapons   ·   R to reload\nHold RIGHT MOUSE to aim down sights.', [0, 0, 14], '#2b7fff', 2);
  makeSign('Climb', 'Walk up the steps onto the platform,\nthen clear the targets from the high ground.', [0, 0, 19], '#22b07a', 2);

  const hud = createFpsHud();

  // --- Commit everything atomically. ---
  useEditorStore.setState((draft) => ({
    animatorControllers: [...draft.animatorControllers, ...built.map((w) => w.controller)],
    activeAnimatorControllerId: built[0].controller.id,
    variables: [...draft.variables, weaponVar, slotVar, ammoVar, magVar],
    blueprints: [...draft.blueprints, blueprint, ...extraBlueprints],
    graphs: [...draft.graphs, graph, ...extraGraphs],
    activeBlueprintId: blueprintId,
    uiDocuments: [...draft.uiDocuments, hud, ...extraUIDocs],
    activeUIDocumentId: hud.id,
    scenes: draft.scenes.map((scene) =>
      scene.id === draft.activeSceneId
        ? { ...scene, objects: [...scene.objects, ground, ...props, ...tutorialObjects, ...arms, pawn] }
        : scene,
    ),
    selectedObjectId: pawnId,
    isDirty: true,
  }));

  return pawnId;
}
