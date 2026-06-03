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

// --- Bundled low-poly FPS kit (public/templates/fps): 5 weapon arm rigs (each with its own animation
//     set), bullet/grenade props, and destructible barrels/walls. ---
const ARMS_DIR = 'templates/fps/Arms';
const WEAPONS_DIR = 'templates/fps/Weapons';
const PROPS_DIR = 'templates/fps/Props';

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

/** Sleek neon-military HUD: a cinematic vignette, a bottom-right weapon + ammo readout (big tabular count
 *  beside a dim "/ MAG"), a bottom-left health label + value + bar, and a key-cap controls strip that
 *  auto-fades a few seconds after drop-in so the screen clears for play. Binds Weapon/Ammo/MagSize/Health.
 *  (The live crosshair is drawn by the engine's DynamicCrosshair overlay, not a static element.) */
const createFpsHud = (): UIDocument => {
  const root = uiElement('panel', 'Root', { width: '100%', height: '100%', position: 'relative', padding: '0' });

  // Cinematic vignette — frames the action and deepens the night-raid mood.
  const vignette = uiElement('panel', 'Vignette', {
    position: 'absolute', left: '0', top: '0', width: '100%', height: '100%',
    custom: { pointerEvents: 'none', background: 'radial-gradient(ellipse at center, transparent 62%, rgba(0,0,0,0.26) 100%)' },
  });

  // Bottom-right: small uppercase weapon name, then a big tabular ammo count beside a dim "/ MAG".
  const weaponBox = uiElement('panel', 'Weapon Box', {
    position: 'absolute', display: 'flex', flexDirection: 'column',
    custom: { right: '36px', bottom: '30px', alignItems: 'flex-end', gap: '3px', pointerEvents: 'none' },
  });
  const weaponName = boundElement('text', 'Weapon', {
    color: '#7fe8ff', fontSize: '12px', fontWeight: '700', textAlign: 'right',
    custom: { letterSpacing: '3px', textTransform: 'uppercase', textShadow: '0 0 12px rgba(39,224,255,0.5)' },
  }, [{ target: 'text', expression: `Weapon` }], 'M416 RIFLE');
  const ammoRow = uiElement('panel', 'Ammo Row', { display: 'flex', custom: { alignItems: 'flex-end', gap: '7px' } });
  const ammoCurrent = boundElement('text', 'Ammo', {
    color: '#FFFFFF', fontSize: '42px', fontWeight: '800', textAlign: 'right',
    custom: { lineHeight: '1', fontVariantNumeric: 'tabular-nums', textShadow: '0 2px 14px rgba(0,0,0,0.85)' },
  }, [
    { target: 'text', expression: `MagSize > 0 ? '' + Ammo : '—'` },
    { target: 'color', expression: `Ammo == 0 && MagSize > 0 ? '#FF5A5F' : '#FFFFFF'` },
  ], '30');
  const ammoMag = boundElement('text', 'Ammo Mag', {
    color: 'rgba(255,255,255,0.42)', fontSize: '18px', fontWeight: '700', textAlign: 'left',
    custom: { lineHeight: '1', paddingBottom: '5px', fontVariantNumeric: 'tabular-nums' },
  }, [{ target: 'text', expression: `MagSize > 0 ? '/ ' + MagSize : ''` }], '/ 30');
  ammoRow.children = [ammoCurrent, ammoMag];
  weaponBox.children = [weaponName, ammoRow];

  // Bottom-left: uppercase HEALTH label + tabular value, then a thin glowing bar. Both redden when low.
  // (Bound to the project `Health` var, which the runtime mirrors from the player's instance health.)
  const healthBox = uiElement('panel', 'Health Box', {
    position: 'absolute', display: 'flex', flexDirection: 'column',
    custom: { left: '36px', bottom: '30px', gap: '6px', pointerEvents: 'none' },
  });
  const healthHeader = uiElement('panel', 'HP Header', { display: 'flex', custom: { alignItems: 'baseline', gap: '9px' } });
  const healthLabel = uiElement('text', 'HP Label', {
    color: 'rgba(159,231,160,0.85)', fontSize: '12px', fontWeight: '700',
    custom: { letterSpacing: '3px', textTransform: 'uppercase', textShadow: '0 0 12px rgba(58,217,122,0.45)' },
  }, 'Health');
  const healthValue = boundElement('text', 'HP Value', {
    color: '#FFFFFF', fontSize: '22px', fontWeight: '800',
    custom: { lineHeight: '1', fontVariantNumeric: 'tabular-nums', textShadow: '0 2px 10px rgba(0,0,0,0.8)' },
  }, [
    { target: 'text', expression: `'' + (Health - Health % 1)` },
    { target: 'color', expression: `Health <= 30 ? '#FF5A5F' : '#FFFFFF'` },
  ], '100');
  healthHeader.children = [healthLabel, healthValue];
  const healthBar = boundElement('bar', 'HP Bar', {
    width: '236px', height: '8px', background: 'rgba(15,17,23,0.7)', borderRadius: '4px', color: '#3ad97a',
    custom: { border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 0 14px rgba(58,217,122,0.22)' },
  }, [{ target: 'fill', expression: `Health / 100` }, { target: 'color', expression: `Health <= 30 ? '#FF5A5F' : '#3ad97a'` }]);
  healthBox.children = [healthHeader, healthBar];

  // Quick-start controls strip — key-cap chips, centered low. Pure CSS: holds visible then fades a few
  // seconds after drop-in so the screen clears for play (pointerEvents none so it never eats clicks).
  const controls = uiElement('panel', 'Controls', {
    position: 'absolute', left: '50%', display: 'flex',
    custom: { bottom: '34px', transform: 'translateX(-50%)', gap: '14px', alignItems: 'center', pointerEvents: 'none', animation: 'nf-controls-fade 10s ease-in 0.5s forwards' },
  });
  const chip = (key: string, label: string): UIElement => {
    const wrap = uiElement('panel', `Key ${key}`, { display: 'flex', custom: { alignItems: 'center', gap: '7px' } });
    const cap = uiElement('text', 'Cap', {
      color: '#dbeeff', fontSize: '11px', fontWeight: '800',
      custom: { letterSpacing: '1px', background: 'rgba(18,24,36,0.78)', border: '1px solid rgba(127,232,255,0.38)', borderRadius: '5px', padding: '3px 7px', textShadow: '0 0 8px rgba(39,224,255,0.5)' },
    }, key);
    const lab = uiElement('text', 'Label', { color: 'rgba(255,255,255,0.72)', fontSize: '11px', fontWeight: '600', custom: { letterSpacing: '0.5px' } }, label);
    wrap.children = [cap, lab];
    return wrap;
  };
  controls.children = [chip('WASD', 'Move'), chip('LMB', 'Fire'), chip('RMB', 'Aim'), chip('R', 'Reload'), chip('1-5', 'Weapons'), chip('SPACE', 'Jump')];

  root.children = [vignette, weaponBox, healthBox, controls];
  const css = '@keyframes nf-controls-fade { 0%, 70% { opacity: 1; } 100% { opacity: 0; } }';
  return { id: makeId('ui'), name: 'FPS HUD', surface: 'screen', root, css, visibleOnStart: true, createdAt: Date.now() };
};

/** Import a static (non-rigged) bundled model once, reusing it if already imported. Returns the asset. */
async function importStaticModel(dir: string, file: string, folderId?: string): Promise<AssetItem | undefined> {
  const existing = useEditorStore.getState().assets.find((a) => a.name === file && a.type === 'model');
  if (existing) return existing;
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
  return useEditorStore.getState().assets.find((a) => a.id === assetId);
}

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
 * Build a ready-to-play first-person shooter starter from the bundled low-poly FPS kit:
 * 5 weapon arm rigs (each with its own idle/walk/run/jump/fire/aim/reload animation set), a 1–5
 * weapon picker, click-to-shoot projectiles, destructible barrels + cover walls, and a HUD.
 * Returns the player object id. Requires a project to be open.
 */
export async function createFirstPersonTemplate(): Promise<string | undefined> {
  const store = useEditorStore.getState();
  const armsFolder = store.createFolder('FPS Arms');
  const weaponsFolder = store.createFolder('FPS Weapons');
  const propsFolder = store.createFolder('FPS Props');

  // --- Cinematic mood: a dark, cool "night raid" sky + atmospheric fog so the neon accents, the warm arena
  //     lights, and the dynamic muzzle/tracer/impact lights of every shot POP, plus bloom + vignette for a
  //     filmic look. (All tunable later in Scene Settings → Environment and Render.) ---
  const sceneId = store.activeSceneId;
  store.updateSceneEnvironment(sceneId, {
    skyMode: 'procedural',
    skyTopColor: '#0a0f1e',
    skyHorizonColor: '#1a2740',
    skyGroundColor: '#070a10',
    environmentIntensity: 0.6, // enough ambient to read the room clearly while the neon still pops
    sunColor: '#9fb6ff',
    sunIntensity: 0.72,
    sunAzimuth: 205,
    sunElevation: 12,
    fogEnabled: true,
    fogColor: '#0b1018',
    fogNear: 16,
    fogFar: 72,
  });
  // Restrained bloom: a high threshold so only the brightest emissives glow (not the whole orange-lit room),
  // and NO post-FX vignette — the HUD draws its own subtle one, so stacking both just washed out the view.
  store.updateRenderSettings({ bloomEnabled: true, bloomIntensity: 0.5, bloomThreshold: 0.82, bloomRadius: 0.55, vignetteEnabled: false });

  // --- Import every weapon arm rig + build its animator controller. ---
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

  // --- Bundled projectile + props. ---
  const bulletAsset = await importStaticModel(WEAPONS_DIR, 'M416_Bullet.glb', weaponsFolder);
  const barrelAsset = await importStaticModel(PROPS_DIR, 'Barrel.glb', propsFolder);
  const wallAsset = await importStaticModel(PROPS_DIR, 'Wall.glb', propsFolder);
  const brickAsset = await importStaticModel(PROPS_DIR, 'Brick.glb', propsFolder);

  // --- Bundled sound effects (Play Sound nodes fire these on shoot / reload). ---
  const audioFolder = store.createFolder('FPS Audio');
  const fireSound = await importAudio('fps_fire.mp3', audioFolder);
  const reloadSound = await importAudio('fps_reload.mp3', audioFolder);
  const footstepSound = await importAudio('fps_footstep.mp3', audioFolder);
  // Atmosphere bed: a looping ambient room-tone + background music (Play starts/stops them), plus a hurt sting
  // the pawn plays when an enemy round connects.
  const ambientSound = await importPublicAudio('ambient.mp3', audioFolder);
  const musicSound = await importPublicAudio('music.mp3', audioFolder);
  const hurtSound = await importPublicAudio('hurt.mp3', audioFolder);
  store.setSceneAudio(sceneId, { ambientSoundId: ambientSound?.id, musicSoundId: musicSound?.id });

  // --- Project variables: HUD weapon name, slot (gates which weapons fire), and ammo + magazine size. ---
  const weaponVarId = makeId('var');
  const slotVarId = makeId('var');
  const ammoVarId = makeId('var');
  const magVarId = makeId('var');
  const weaponVar: ProjectVariable = { id: weaponVarId, name: 'Weapon', type: 'string', defaultValue: built[0].name, persistent: false, createdAt: Date.now() };
  const slotVar: ProjectVariable = { id: slotVarId, name: 'WeaponSlot', type: 'number', defaultValue: 1, persistent: false, createdAt: Date.now() };
  const ammoVar: ProjectVariable = { id: ammoVarId, name: 'Ammo', type: 'number', defaultValue: built[0].mag, persistent: false, createdAt: Date.now() };
  const magVar: ProjectVariable = { id: magVarId, name: 'MagSize', type: 'number', defaultValue: built[0].mag, persistent: false, createdAt: Date.now() };
  // Player health: the runtime mirrors the pawn's instance `health` into this project var, so the HUD bar + any
  // health pickups read/write it. (Enemy shots already damage the pawn's instance health.)
  const healthVarId = makeId('var');
  const healthVar: ProjectVariable = { id: healthVarId, name: 'Health', type: 'number', defaultValue: 100, persistent: false, createdAt: Date.now() };
  // "Clear the arena" win/lose flow. EnemiesAlive is a per-frame tally that every LIVING enemy re-adds itself to
  // each frame (a dead/ragdolling body stops ticking, so it silently drops out); the Game Director snapshots it
  // into AlivePrev (stable for the HUD + win check) and resets it. GameOver is a one-shot flag: 0 playing / 1 win / 2 lose.
  const enemiesAliveVarId = makeId('var');
  const alivePrevVarId = makeId('var');
  const gameOverVarId = makeId('var');

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

  // --- Hidden bullet template — Spawn Projectile clones it so shots use the real bullet model. ---
  const bulletTemplateId = makeId('obj');
  const bulletTemplate: SceneObject | undefined = bulletAsset
    ? {
        id: bulletTemplateId,
        name: 'Bullet (template)',
        kind: 'sphere',
        transform: { position: [0, -50, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        renderer: { ...defaultRenderer('sphere', '#ffcc66'), modelAssetId: bulletAsset.id },
      }
    : undefined;

  // --- Player graph: weapon picker (1–5), movement/jump, and gated click-to-shoot. ---
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

  // Movement + jump (the pawn is scripted, so its motion comes from these nodes; the arms animator
  // reads the resulting speed automatically).
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
  if (bulletTemplate) {
    const hideBullet = add('Set Visible', 'Runtime', 320 + built.length * 60, { nodeKind: 'action.setVisible', targetObjectId: bulletTemplateId, visible: false, description: 'Hide the bullet template.' });
    edges.push(execEdge(prev, hideBullet));
  }
  row();

  // Weapon picker: keys 1–5 → show this weapon, hide the others, play its Draw, set the HUD name + slot.
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

  // Hold to shoot (full-auto) — fire while LMB is HELD, gated by a Cooldown so it fires at a steady rate
  // instead of needing a click per shot. Only guns (slots 1–3) fire, and only when there's ammo; each shot
  // spends a round. (Tune the Cooldown's seconds for fire rate — lower = faster.)
  if (bulletTemplate) {
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
      nodeKind: 'action.spawnProjectile', projectileTemplateId: bulletTemplateId, projectileSpeed: 70, projectileDamage: 30, projectileLife: 2, description: 'Fire a bullet from the muzzle.',
    });
    edges.push(
      valueEdge(getSlot, slotCmp, 'a'), valueEdge(slotCmp, slotBranch, 'condition'), execEdge(fireKey, fireRate), execEdge(fireRate, slotBranch),
      valueEdge(getAmmo, ammoCmp, 'a'), valueEdge(ammoCmp, ammoBranch, 'condition'), execEdge(slotBranch, ammoBranch),
      valueEdge(getAmmo2, dec, 'a'), valueEdge(dec, setAmmo, 'value'), execEdge(ammoBranch, setAmmo), execEdge(setAmmo, shoot),
    );
    // Gunshot sound on each fired round.
    if (fireSound) {
      const fireSfx = add('Play Sound', 'Audio', 1840, { nodeKind: 'action.playSound', assetId: fireSound.id, description: 'Gunshot.' });
      edges.push(execEdge(shoot, fireSfx));
    }
    row();
  }

  // Reload (R) — refill the magazine to MagSize. The Reload arm animation plays automatically (the
  // reload key drives the 'reloading' animator param), so this just tops the ammo back up.
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
      hurtSoundId: hurtSound?.id,
      rollSpeed: 0,
      rollDuration: 0.1,
    },
    script: { blueprintId, graphId, enabled: true },
    variables: { health: 100 },
  };

  // --- Arena: an enclosed combat space with cover, crate stacks to climb, glowing neon accents, and
  //     destructible barrels. The dynamic muzzle/projectile/impact lights make the dim space pop. ---
  const props: SceneObject[] = [];
  interface PropOpts { modelAssetId?: string; emissive?: string; intensity?: number; dynamic?: boolean; health?: number; metalness?: number; roughness?: number; explosive?: boolean; }
  const prop = (name: string, position: Vector3Tuple, scale: Vector3Tuple, color: string, opts: PropOpts = {}): SceneObject => {
    const renderer: MeshRendererComponent = {
      ...defaultRenderer('cube', color),
      metalness: opts.metalness ?? 0.1,
      roughness: opts.roughness ?? 0.7,
      ...(opts.modelAssetId ? { modelAssetId: opts.modelAssetId } : {}),
      ...(opts.emissive ? { materialOverrides: { emissiveColor: opts.emissive, emissiveIntensity: opts.intensity ?? 1.6 } } : {}),
    };
    const obj: SceneObject = {
      id: makeId('obj'), name, kind: 'cube',
      transform: { position, rotation: [0, 0, 0], scale },
      renderer,
      physics: opts.dynamic ? dynamicBox() : fixedBox(),
    };
    if (opts.health) obj.variables = { health: opts.health };
    // Explosive props (barrels) burst on death: a fiery VFX + area damage that can chain to nearby barrels/enemies.
    if (opts.explosive) obj.variables = { ...obj.variables, explosive: true, explosionDamage: 70, explosionRadius: 5 };
    props.push(obj);
    return obj;
  };

  const ground: SceneObject = {
    id: makeId('obj'), name: 'Ground', kind: 'cube',
    transform: { position: [0, -0.1, 11], rotation: [0, 0, 0], scale: [40, 0.2, 52] },
    renderer: { ...defaultRenderer('cube', '#202530'), metalness: 0.25, roughness: 0.85 },
    physics: fixedBox(),
  };

  // Enclosing perimeter walls (concrete) — keep the fight inside the arena.
  const WALL = '#3a4150';
  prop('Wall Back', [0, 2, 33], [42, 4, 1], WALL);
  prop('Wall Front', [0, 2, -5], [42, 4, 1], WALL);
  prop('Wall Left', [-18, 2, 14], [1, 4, 40], WALL);
  prop('Wall Right', [18, 2, 14], [1, 4, 40], WALL);

  // Neon accent pillars along the walls (alternating cyan/orange) — atmosphere + readability.
  const accents: Array<{ p: Vector3Tuple; c: string }> = [
    { p: [-17.4, 1.6, 2], c: '#27E0FF' }, { p: [17.4, 1.6, 2], c: '#FF8A3D' },
    { p: [-17.4, 1.6, 14], c: '#FF8A3D' }, { p: [17.4, 1.6, 14], c: '#27E0FF' },
    { p: [-17.4, 1.6, 26], c: '#27E0FF' }, { p: [17.4, 1.6, 26], c: '#FF8A3D' },
    { p: [0, 1.6, 32.4], c: '#27E0FF' },
  ];
  accents.forEach((a, i) => prop(`Accent ${i + 1}`, a.p, [0.25, 3.2, 0.25], a.c, { emissive: a.c, intensity: 1.5 }));

  // Real point lights that actually illuminate the arena (colored to match the neon mood). Kept moderate so
  // they light the space without blooming into a wash over the view.
  const lights: Array<{ p: Vector3Tuple; c: string; i: number }> = [
    { p: [-10, 4, 6], c: '#27E0FF', i: 9 },
    { p: [10, 4, 16], c: '#FF8A3D', i: 9 },
    { p: [0, 4.5, 26], c: '#9bd0ff', i: 8 },
    { p: [0, 4, 2], c: '#ffd9a8', i: 7 },
  ];
  lights.forEach((l, i) =>
    props.push({
      id: makeId('obj'), name: `Arena Light ${i + 1}`, kind: 'light',
      transform: { position: l.p, rotation: [0, 0, 0], scale: [1, 1, 1] },
      light: { type: 'point', color: l.c, intensity: l.i, distance: 22, angle: Math.PI / 6, castShadow: false },
    }),
  );

  // Cover walls (low) the player + AI can duck behind, staggered for a real combat lane.
  prop('Cover A', [-5, 0.9, 10], [0.5, 1.8, 3.2], '#566072', { modelAssetId: wallAsset?.id });
  prop('Cover B', [5.5, 0.9, 14], [0.5, 1.8, 3.6], '#566072', { modelAssetId: wallAsset?.id });
  prop('Cover C', [-3, 0.9, 20], [3.4, 1.8, 0.5], '#566072', { modelAssetId: wallAsset?.id });
  prop('Cover D', [6, 0.9, 24], [0.5, 1.8, 3.2], '#566072', { modelAssetId: wallAsset?.id });

  // Crate stacks (fixed platforms you can climb + shoot from) — verticality.
  const crate = '#6b4a2b';
  prop('Crate Platform 1', [-9, 0.6, 8], [1.4, 1.2, 1.4], crate, { modelAssetId: brickAsset?.id });
  prop('Crate Platform 2', [-9, 1.8, 8], [1.2, 1.2, 1.2], crate, { modelAssetId: brickAsset?.id });
  prop('Crate Platform 3', [-7.6, 0.6, 8.4], [1.2, 1.2, 1.2], crate, { modelAssetId: brickAsset?.id });
  prop('Crate Platform 4', [9, 0.6, 22], [1.4, 1.2, 1.4], crate, { modelAssetId: brickAsset?.id });
  prop('Crate Platform 5', [9, 1.8, 22], [1.2, 1.2, 1.2], crate, { modelAssetId: brickAsset?.id });

  // Destructible explosive barrels (shoot them) — practice targets in the combat room + arena (Room 1 stays clear).
  const barrelSpots: Vector3Tuple[] = [[-7, 0.7, 16], [7, 0.7, 18], [4.5, 0.7, 14], [-3, 0.7, 27], [11, 0.7, 19], [-9, 0.7, 28]];
  barrelSpots.forEach((position, i) =>
    prop(`Barrel ${i + 1}`, position, [1, 1.2, 1], '#9a5b2d', { modelAssetId: barrelAsset?.id, health: 50, metalness: 0.4, roughness: 0.5, explosive: true }),
  );

  // Loose kickable bricks for physics flavour near the spawn.
  const brickSpots: Vector3Tuple[] = [[-1.4, 0.4, 5.5], [-1.4, 1.0, 5.5], [-0.6, 0.4, 5.8], [0.4, 0.4, 5.5], [1.2, 0.4, 6]];
  brickSpots.forEach((position, i) =>
    prop(`Brick ${i + 1}`, position, [0.7, 0.5, 0.4], '#b5563f', { modelAssetId: brickAsset?.id, dynamic: true }),
  );

  // ============================================================================================
  // TUTORIAL ROOMS — split the arena into 3 gated rooms that teach the engine before the fight:
  //   Room 1 (Controls, z 0–11) → Room 2 (Combat, z 11–23) → Room 3 (Arena + pickups, z 23–33).
  // Gate 1 is a door that opens when you reach it; Gate 2 is a wall of explosive barrels you shoot
  // through. Floating signs teach each beat. New blueprints/graphs/UI collect here and are merged
  // into the final atomic commit.
  // ============================================================================================
  const tutorialObjects: SceneObject[] = [];
  const extraBlueprints: ScriptBlueprint[] = [];
  const extraGraphs: ProjectGraph[] = [];
  const extraUIDocs: UIDocument[] = [];

  // Build a small blueprint from a node/edge builder; returns ids to attach to an object's script.
  const miniBlueprint = (name: string, color: string, build: (n: NodeForgeNode[], e: Edge[]) => void): { blueprintId: string; graphId: string } => {
    const graphId = makeId('graph');
    const blueprintId = makeId('bp');
    const n: NodeForgeNode[] = [];
    const e: Edge[] = [];
    build(n, e);
    extraGraphs.push({ id: graphId, name, nodes: n, edges: e });
    extraBlueprints.push({ id: blueprintId, name, description: name, graphId, color, createdAt: Date.now() });
    return { blueprintId, graphId };
  };

  // Proximity tutorial sign: a small glowing beacon you walk up to. Its tip shows on the HUD (a centered toast)
  // while the player is INSIDE the surrounding trigger zone, and hides again when they leave the range — so the
  // world stays clean and the right tip appears exactly when it's relevant. (Zones are spaced so they don't
  // overlap; each tip is its own hidden screen doc, shown/hidden by the zone's Trigger Enter/Exit.)
  const makeSign = (header: string, body: string, position: Vector3Tuple, color = '#9bd0ff', range = 2) => {
    // Hidden HUD prompt: a sleek dark-glass card with a colored left accent, an uppercase header line, and a
    // lighter body line. Shown (faded in) while the player is inside the sign's trigger zone the first time.
    const docId = makeId('ui');
    const box = uiElement('panel', 'Tip', {
      position: 'absolute', left: '50%', display: 'flex', flexDirection: 'column',
      // The `animation` (defined in the doc css below) fades + slides the tip in each time it's shown.
      custom: {
        bottom: '92px', transform: 'translateX(-50%)', alignItems: 'center', gap: '5px',
        background: 'rgba(10,13,20,0.86)', padding: '13px 26px', borderRadius: '12px',
        border: `1px solid ${color}55`, borderLeft: `3px solid ${color}`, maxWidth: '64%',
        boxShadow: '0 8px 30px rgba(0,0,0,0.5)', animation: 'nf-tip-in 0.24s ease-out',
      },
    });
    const headEl = uiElement('text', 'Tip Header', {
      color, fontSize: '13px', fontWeight: '800', textAlign: 'center',
      custom: { letterSpacing: '3px', textTransform: 'uppercase', textShadow: `0 0 12px ${color}88` },
    }, header);
    const bodyEl = uiElement('text', 'Tip Body', {
      color: 'rgba(231,240,255,0.92)', fontSize: '15px', fontWeight: '600', textAlign: 'center',
      custom: { whiteSpace: 'pre-line', lineHeight: '1.45', textShadow: '0 2px 8px rgba(0,0,0,0.9)' },
    }, body);
    box.children = [headEl, bodyEl];
    const tipCss = '@keyframes nf-tip-in { from { opacity: 0; transform: translate(-50%, 12px); } to { opacity: 1; transform: translate(-50%, 0); } }';
    extraUIDocs.push({ id: docId, name: 'Tip', surface: 'screen', root: box, css: tipCss, visibleOnStart: false, createdAt: Date.now() });
    // Trigger zone: show the tip the FIRST time the player enters (gated by a `tipUnseen` flag we clear after),
    // then hide on exit. So a read tip won't nag you again if you backtrack.
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
      variables: { tipUnseen: true }, // cleared to 0 after the first read so the tip won't re-show
    });
    // A low glowing FLOOR marker (a waypoint pad) so the player can see where the tip is — kept flat on the
    // ground so it never bars the forward view the way a tall pillar would (it used to plant a glowing post
    // dead-center in the spawn sightline).
    tutorialObjects.push({
      id: makeId('obj'), name: 'Sign Marker', kind: 'cube',
      transform: { position: [position[0], 0.04, position[2]], rotation: [0, 0, 0], scale: [0.9, 0.06, 0.9] },
      renderer: { ...defaultRenderer('cube', color), materialOverrides: { emissiveColor: color, emissiveIntensity: 1.1 } },
    });
  };

  // Room-divider wall segments (leave a centered ~3u doorway at x −1.5…1.5).
  const DIVIDER = '#2b3340';
  const divider = (name: string, z: number) => {
    prop(`${name} L`, [-9.75, 2, z], [16.5, 4, 1], DIVIDER, { metalness: 0.2, roughness: 0.8 });
    prop(`${name} R`, [9.75, 2, z], [16.5, 4, 1], DIVIDER, { metalness: 0.2, roughness: 0.8 });
  };
  divider('Divider 1', 11);
  divider('Divider 2', 23);

  // GATE 1 (Room 1 → 2): a glowing door filling the doorway; a trigger just before it opens (destroys) the
  // door once the player walks up — teaching "reach the exit".
  const door1 = prop('Gate Door', [0, 1.5, 11], [3, 3, 0.5], '#1b6fb0', { emissive: '#27E0FF', intensity: 2.2 });
  const gate1Bp = miniBlueprint('Gate 1 Opener', '#27E0FF', (n, e) => {
    const t = makeId('node');
    const d = makeId('node');
    n.push(graphNode(t, 'Trigger Enter', 'Events', 40, 40, { nodeKind: 'event.triggerEnter', otherObjectId: pawnId, hasInput: false, description: 'Player reaches the gate.' }));
    n.push(graphNode(d, 'Destroy Object', 'Runtime', 320, 40, { nodeKind: 'action.destroyObject', targetObjectId: door1.id, description: 'Open the gate.' }));
    e.push(execEdge(t, d));
  });
  tutorialObjects.push({
    id: makeId('obj'), name: 'Gate 1 Trigger', kind: 'empty',
    transform: { position: [0, 1.5, 9], rotation: [0, 0, 0], scale: [3, 3, 2.4] },
    physics: { ...fixedBox('box'), bodyType: 'dynamic', isTrigger: true, gravityScale: 0 },
    script: { blueprintId: gate1Bp.blueprintId, graphId: gate1Bp.graphId, enabled: true },
  });

  // GATE 2 (Room 2 → 3): a wall of explosive barrels plugging the doorway — shoot one and the chain blast
  // clears them all, opening the path (teaches shooting + explosives). They're FIXED so they can't roll aside.
  ([[-1, 0.7, 23], [0, 0.7, 23], [1, 0.7, 23]] as Vector3Tuple[]).forEach((position, i) =>
    prop(`Gate Barrel ${i + 1}`, position, [1, 1.4, 1], '#9a5b2d', { modelAssetId: barrelAsset?.id, health: 40, metalness: 0.4, roughness: 0.5, explosive: true }),
  );

  // Walk-over pickup: a glowing trigger box that writes a variable on whoever touches it ($trigger), then
  // despawns. Health refills the player's instance `health` (mirrored to the HUD); ammo tops the magazine up.
  const makePickup = (name: string, position: Vector3Tuple, color: string, kind: 'health' | 'ammo') => {
    const bp = miniBlueprint(`${name} Logic`, color, (n, e) => {
      const t = makeId('node');
      n.push(graphNode(t, 'Trigger Enter', 'Events', 40, 40, { nodeKind: 'event.triggerEnter', otherObjectId: pawnId, hasInput: false, description: `Pick up ${name}.` }));
      const destroy = makeId('node');
      if (kind === 'health') {
        const give = makeId('node');
        n.push(graphNode(give, 'Set Object Var', 'Variables', 320, 40, { nodeKind: 'variable.setObject', objectKey: 'health', targetObjectId: '$trigger', numberValue: 100, description: 'Refill health.' }));
        e.push(execEdge(t, give), execEdge(give, destroy));
      } else {
        const getMag = makeId('node');
        const setAmmo = makeId('node');
        n.push(graphNode(getMag, 'Get Variable', 'Variables', 320, 200, { nodeKind: 'variable.get', variableId: magVarId, valueType: 'number', hasInput: false }));
        n.push(graphNode(setAmmo, 'Set Variable', 'Variables', 320, 40, { nodeKind: 'variable.set', variableId: ammoVarId, valueType: 'number', description: 'Refill ammo to a full magazine.' }));
        e.push(execEdge(t, setAmmo), valueEdge(getMag, setAmmo, 'value'), execEdge(setAmmo, destroy));
      }
      n.push(graphNode(destroy, 'Destroy Object', 'Runtime', 560, 40, { nodeKind: 'action.destroyObject', description: 'Consume the pickup.' }));
    });
    tutorialObjects.push({
      id: makeId('obj'), name, kind: 'cube',
      transform: { position, rotation: [0, 0, 0], scale: [0.6, 0.6, 0.6] },
      renderer: { ...defaultRenderer('cube', color), materialOverrides: { emissiveColor: color, emissiveIntensity: 0.8 } },
      physics: { ...fixedBox('box'), bodyType: 'dynamic', isTrigger: true, gravityScale: 0 },
      script: { blueprintId: bp.blueprintId, graphId: bp.graphId, enabled: true },
    });
  };
  // Room 2 gives a spare ammo box; Room 3 (the arena) has health + ammo to survive the fight.
  makePickup('Ammo Box', [-6, 0.6, 17], '#fbbf24', 'ammo');
  makePickup('Health Pack', [-5, 0.6, 26], '#4ade80', 'health');
  makePickup('Ammo Box', [5, 0.6, 26], '#fbbf24', 'ammo');
  makePickup('Health Pack', [5, 0.6, 31], '#4ade80', 'health');
  makePickup('Ammo Box', [-5, 0.6, 31], '#fbbf24', 'ammo');

  // One clean proximity card per room — each folds in that room's single action so there's never more than one
  // prompt on screen. Beacons are spaced so their ~2u zones don't overlap; each shows once, then won't nag.
  makeSign('Room 1 · Controls', 'WASD move   ·   Mouse look   ·   SHIFT sprint   ·   SPACE jump\nHead through the glowing door ahead.', [0, 0, 5], '#9bd0ff', 2);
  makeSign('Room 2 · Combat', 'Hold LMB to fire   ·   R reload   ·   1–5 swap weapon   ·   RMB aim\nShoot the barrels to blast the exit open.', [0, 0, 14], '#FFD082', 2);
  makeSign('Room 3 · Arena', 'Clear every enemy to win.\nGrab the health + ammo pickups to stay alive.', [0, 0, 25.5], '#FF6B6B', 2);

  // --- Example enemies: chase the player, stop in range, face + shoot on a cooldown. Fully node-based,
  //     so the user can open "Enemy AI" in the Scripting panel and tweak ranges/behavior. ---
  const enemyGraphId = makeId('graph');
  const enemyBpId = makeId('bp');
  const en: NodeForgeNode[] = [];
  const enEdges: Edge[] = [];
  const eUpdate = makeId('node');
  const eDist = makeId('node');
  const eCmpChase = makeId('node');
  const eBranchChase = makeId('node');
  const eDir = makeId('node');
  const eMove = makeId('node');
  const eCmpAtk = makeId('node');
  const eBranchAtk = makeId('node');
  const eFace = makeId('node');
  const eCool = makeId('node');
  const eShoot = makeId('node');
  const eGetAlive = makeId('node');
  const eIncAlive = makeId('node');
  const eSetAlive = makeId('node');
  en.push(
    graphNode(eUpdate, 'Update', 'Events', 40, 40, { nodeKind: 'event.update', hasInput: false, description: 'Every frame.' }),
    graphNode(eDist, 'Distance To Player', 'Runtime', 40, 200, { nodeKind: 'ai.distanceToPlayer', hasInput: false, description: 'Range to the player.' }),
    graphNode(eCmpChase, 'Compare', 'Logic', 320, 200, { nodeKind: 'logic.compare', compareOp: '>', numberValue: 8, description: 'Farther than 8m?' }),
    graphNode(eBranchChase, 'Branch', 'Logic', 560, 60, { nodeKind: 'logic.branch', description: 'Chase when far.' }),
    graphNode(eDir, 'Direction To Player', 'Runtime', 560, 260, { nodeKind: 'ai.directionToPlayer', hasInput: false, description: 'Toward the player.' }),
    graphNode(eMove, 'Move', 'Runtime', 820, 60, { nodeKind: 'action.move', amount: 2.8, description: 'Walk toward the player.' }),
    graphNode(eCmpAtk, 'Compare', 'Logic', 320, 420, { nodeKind: 'logic.compare', compareOp: '<', numberValue: 18, description: 'Within 18m?' }),
    graphNode(eBranchAtk, 'Branch', 'Logic', 560, 460, { nodeKind: 'logic.branch', description: 'Attack when in range.' }),
    graphNode(eFace, 'Face Player', 'Runtime', 820, 420, { nodeKind: 'action.facePlayer', description: 'Aim at the player.' }),
    graphNode(eCool, 'Cooldown', 'Logic', 1060, 420, { nodeKind: 'logic.cooldown', numberValue: 1.3, description: 'Fire rate (1.3s).' }),
    graphNode(eShoot, 'Spawn Projectile', 'Runtime', 1300, 420, {
      nodeKind: 'action.spawnProjectile', projectileSpeed: 22, projectileDamage: 8, projectileLife: 3, projectileColor: '#ff5a4d', projectileSize: 0.2,
      description: 'Shoot at the player.',
    }),
    // Living head-count: every frame each ALIVE enemy adds 1 to EnemiesAlive (the Director zeroes it first, then
    // reads it back). A dead enemy ragdolls and stops ticking, so it stops counting itself — that's the win signal.
    graphNode(eGetAlive, 'Get Variable', 'Variables', 40, 620, { nodeKind: 'variable.get', variableId: enemiesAliveVarId, valueType: 'number', hasInput: false, description: 'Living-enemy tally.' }),
    graphNode(eIncAlive, 'Add', 'Math', 320, 620, { nodeKind: 'math.add', amount: 1, description: 'Count myself among the living.' }),
    graphNode(eSetAlive, 'Set Variable', 'Variables', 560, 620, { nodeKind: 'variable.set', variableId: enemiesAliveVarId, valueType: 'number', description: 'Re-assert each frame.' }),
  );
  enEdges.push(
    execEdge(eUpdate, eBranchChase), execEdge(eUpdate, eBranchAtk),
    valueEdge(eDist, eCmpChase, 'a'), valueEdge(eCmpChase, eBranchChase, 'condition'), execEdge(eBranchChase, eMove), valueEdge(eDir, eMove, 'vector'),
    valueEdge(eDist, eCmpAtk, 'a'), valueEdge(eCmpAtk, eBranchAtk, 'condition'), execEdge(eBranchAtk, eFace), execEdge(eFace, eCool), execEdge(eCool, eShoot),
    execEdge(eUpdate, eSetAlive), valueEdge(eGetAlive, eIncAlive, 'a'), valueEdge(eIncAlive, eSetAlive, 'value'),
  );
  const enemyGraph: ProjectGraph = { id: enemyGraphId, name: 'Enemy AI', nodes: en, edges: enEdges };
  const enemyBlueprint: ScriptBlueprint = { id: enemyBpId, name: 'Enemy AI', description: 'Chase the player, then face + shoot on a cooldown.', graphId: enemyGraphId, color: '#FF5A5F', createdAt: Date.now() };

  // Floating world-space health bar shared by every enemy, bound to each host's own self.health / self.maxHealth.
  const enemyBar = boundElement('bar', 'HP', { width: '120px', height: '9px', background: 'rgba(15,17,23,0.82)', borderRadius: '5px', color: '#e3504a' }, [{ target: 'fill', expression: 'self.health / self.maxHealth' }]);
  const enemyBarRoot = uiElement('panel', 'Root', { display: 'flex', custom: { justifyContent: 'center' } });
  enemyBarRoot.children = [enemyBar];
  const enemyBarDoc: UIDocument = { id: makeId('ui'), name: 'Enemy Health Bar', surface: 'world', root: enemyBarRoot, css: '', visibleOnStart: true, createdAt: Date.now() };
  extraUIDocs.push(enemyBarDoc);

  // Enemies are full-body RIGS (the bundled UAL1 humanoid), animated by a shared locomotion controller and
  // recolored red — not bare capsules. The FPS kit only ships ARM rigs, so we pull the body rig from templates/.
  const enemyRig = await importArmRig('UAL1.glb', store.createFolder('FPS Enemies'), 'templates');
  const enemyController = enemyRig ? buildWeaponController('Enemy', enemyRig.mesh.skeletonId, enemyRig.clips, 'melee').controller : undefined;
  const enemyColor = '#e0484d';
  const enemySpots: Vector3Tuple[] = [[-6, 0, 27], [6, 0, 29], [0, 0, 32]];
  const enemies: SceneObject[] = enemySpots.map((position, i) =>
    enemyRig && enemyController
      ? {
          id: makeId('obj'),
          name: `Enemy ${i + 1}`,
          kind: 'cube',
          transform: { position, rotation: [0, 0, 0], scale: [1, 1, 1] },
          // overrideMaterial + color tints the rig red; the SkinnedModel honors it as a per-enemy tint.
          renderer: { ...defaultRenderer('cube', enemyColor), overrideMaterial: true, modelAssetId: enemyRig.asset.id, materialOverrides: { emissiveColor: enemyColor, emissiveIntensity: 0.3 } },
          animator: { enabled: true, controllerId: enemyController.id, skeletalMeshId: enemyRig.mesh.id, speed: 1, loop: true },
          character: { ...defaultCharacter(), enabled: true, moveSpeed: 2.8, sprintMultiplier: 1, jumpStrength: 0, cameraFollow: false, mouseLook: false },
          script: { blueprintId: enemyBpId, graphId: enemyGraphId, enabled: true },
          variables: { health: 60, maxHealth: 60 },
          ui: { documentId: enemyBarDoc.id, offset: [0, 2.4, 0], scale: 1, billboard: true },
        }
      : {
          // Fallback to a capsule only if the body rig failed to load.
          id: makeId('obj'),
          name: `Enemy ${i + 1}`,
          kind: 'capsule',
          transform: { position: [position[0], 1, position[2]] as Vector3Tuple, rotation: [0, 0, 0], scale: [1, 1, 1] },
          renderer: { ...defaultRenderer('capsule', enemyColor), materialOverrides: { emissiveColor: enemyColor, emissiveIntensity: 0.45 } },
          character: { ...defaultCharacter(), enabled: true, moveSpeed: 2.8, sprintMultiplier: 1, jumpStrength: 0, cameraFollow: false, mouseLook: false },
          script: { blueprintId: enemyBpId, graphId: enemyGraphId, enabled: true },
          variables: { health: 60, maxHealth: 60 },
          ui: { documentId: enemyBarDoc.id, offset: [0, 2.4, 0], scale: 1, billboard: true },
        },
  );

  // ============================================================================================
  // GAME STATE — an objective banner, an intro cinematic, and a win/lose flow. A "Game Director" (an
  // empty that never dies, so it ticks every frame) plays the intro on Start and, on Update, snapshots the
  // living-enemy tally + watches the player's mirrored Health to declare VICTORY (arena cleared) or DEFEAT.
  // ============================================================================================
  const enemyCount = enemies.length;
  const enemiesAliveVar: ProjectVariable = { id: enemiesAliveVarId, name: 'EnemiesAlive', type: 'number', defaultValue: enemyCount, persistent: false, createdAt: Date.now() };
  const alivePrevVar: ProjectVariable = { id: alivePrevVarId, name: 'AlivePrev', type: 'number', defaultValue: enemyCount, persistent: false, createdAt: Date.now() };
  const gameOverVar: ProjectVariable = { id: gameOverVarId, name: 'GameOver', type: 'number', defaultValue: 0, persistent: false, createdAt: Date.now() };

  // Top-center objective pill — bound to AlivePrev so it shows a live "ENEMIES LEFT: N" that flips to "ARENA CLEAR".
  const objText = boundElement('text', 'Objective Text', {
    color: '#ffd9a8', fontSize: '13px', fontWeight: '700', textAlign: 'center',
    custom: { whiteSpace: 'nowrap', letterSpacing: '2px', textTransform: 'uppercase', textShadow: '0 1px 6px rgba(0,0,0,0.85)' },
  }, [{ target: 'text', expression: `AlivePrev > 0 ? '◈  Enemies Left  ' + AlivePrev : '✓  Arena Clear'` }], '◈  Enemies Left  3');
  const objBox = uiElement('panel', 'Objective', {
    position: 'absolute', left: '50%', display: 'flex',
    custom: { top: '40px', transform: 'translateX(-50%)', background: 'rgba(10,13,20,0.7)', padding: '8px 20px', borderRadius: '999px', border: '1px solid rgba(255,138,61,0.42)', boxShadow: '0 4px 20px rgba(0,0,0,0.45)', pointerEvents: 'none' },
  });
  objBox.children = [objText];
  const objectiveDocId = makeId('ui');
  extraUIDocs.push({ id: objectiveDocId, name: 'Objective', surface: 'screen', root: objBox, css: '', visibleOnStart: true, createdAt: Date.now() });

  // Full-screen VICTORY / DEFEAT overlays (hidden until the Director shows them). pointerEvents:none so they
  // never eat clicks; an animation fades the title up for impact.
  const endTitleCss = '@keyframes nf-end-in { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }';
  const makeEndScreen = (name: string, title: string, sub: string, titleColor: string, wash: string): string => {
    const root = uiElement('panel', name, {
      position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      custom: { alignItems: 'center', justifyContent: 'center', gap: '12px', background: wash, pointerEvents: 'none' },
    });
    const t = uiElement('text', 'Title', { color: titleColor, fontSize: '64px', fontWeight: '800', textAlign: 'center', custom: { letterSpacing: '6px', textShadow: '0 4px 28px rgba(0,0,0,0.95)', animation: 'nf-end-in 0.4s ease-out' } }, title);
    const s = uiElement('text', 'Sub', { color: '#dbe8ff', fontSize: '18px', fontWeight: '600', textAlign: 'center', custom: { textShadow: '0 2px 10px rgba(0,0,0,0.95)' } }, sub);
    root.children = [t, s];
    const id = makeId('ui');
    extraUIDocs.push({ id, name, surface: 'screen', root, css: endTitleCss, visibleOnStart: false, createdAt: Date.now() });
    return id;
  };
  const victoryDocId = makeEndScreen('Victory', 'VICTORY', 'Arena cleared — every hostile is down.', '#7CFFB0', 'radial-gradient(circle at center, rgba(20,46,32,0.32), rgba(0,0,0,0.8))');
  const defeatDocId = makeEndScreen('Defeat', 'YOU DIED', 'Press Play to drop back in and try again.', '#FF6B6B', 'radial-gradient(circle at center, rgba(60,18,18,0.36), rgba(0,0,0,0.84))');

  // Intro cinematic: a quick aerial sweep over the arena that descends and settles into the first-person eye.
  // When it ends the runtime hands the camera back to the pawn's first-person follow camera automatically.
  const introId = store.createCinematic('Combat Drop', 2.5);
  store.addCinematicCameraKeyframe(introId, 0, { position: [0, 12, -8], lookAt: [0, 2, 16], fov: 56 });
  store.addCinematicCameraKeyframe(introId, 1.2, { position: [-3, 5, 0], lookAt: [1, 2, 14], fov: 54 });
  store.addCinematicCameraKeyframe(introId, 2.5, { position: [0, 1.7, -0.2], lookAt: [0, 1.7, 6], fov: 68 });

  // The Game Director's graph (built into the shared extra-blueprint arrays via miniBlueprint).
  const director = miniBlueprint('Game Director', '#FFD082', (n, e) => {
    // Start → play the intro.
    const start = makeId('node');
    const playCine = makeId('node');
    n.push(graphNode(start, 'Start', 'Events', 40, 40, { nodeKind: 'event.start', hasInput: false, description: 'Roll the intro on Play.' }));
    n.push(graphNode(playCine, 'Play Cinematic', 'Runtime', 320, 40, { nodeKind: 'action.playCinematic', cinematicId: introId, description: 'Sweep the arena, settle into first-person.' }));
    e.push(execEdge(start, playCine));

    // Update → snapshot last frame's tally into AlivePrev, zero EnemiesAlive (living enemies re-add this frame),
    // then run the win + lose checks.
    const upd = makeId('node');
    const getAlive = makeId('node');
    const setPrev = makeId('node');
    const reset = makeId('node');
    n.push(graphNode(upd, 'Update', 'Events', 40, 220, { nodeKind: 'event.update', hasInput: false, description: 'Win/lose watcher.' }));
    n.push(graphNode(getAlive, 'Get Variable', 'Variables', 40, 360, { nodeKind: 'variable.get', variableId: enemiesAliveVarId, valueType: 'number', hasInput: false }));
    n.push(graphNode(setPrev, 'Set Variable', 'Variables', 300, 220, { nodeKind: 'variable.set', variableId: alivePrevVarId, valueType: 'number', description: 'Stable alive count (HUD + win check).' }));
    n.push(graphNode(reset, 'Set Variable', 'Variables', 540, 220, { nodeKind: 'variable.set', variableId: enemiesAliveVarId, valueType: 'number', numberValue: 0, description: 'Living enemies re-add themselves.' }));
    e.push(execEdge(upd, setPrev), valueEdge(getAlive, setPrev, 'value'), execEdge(setPrev, reset));

    // WIN: AlivePrev <= 0 AND GameOver == 0 → mark victory + show the screen.
    const getPrev = makeId('node');
    const cmpWin = makeId('node');
    const getGo1 = makeId('node');
    const cmpGo1 = makeId('node');
    const andWin = makeId('node');
    const brWin = makeId('node');
    const setWin = makeId('node');
    const showWin = makeId('node');
    n.push(graphNode(getPrev, 'Get Variable', 'Variables', 540, 360, { nodeKind: 'variable.get', variableId: alivePrevVarId, valueType: 'number', hasInput: false }));
    n.push(graphNode(cmpWin, 'Compare', 'Logic', 760, 360, { nodeKind: 'logic.compare', compareOp: '<=', numberValue: 0, description: 'All enemies down?' }));
    n.push(graphNode(getGo1, 'Get Variable', 'Variables', 540, 480, { nodeKind: 'variable.get', variableId: gameOverVarId, valueType: 'number', hasInput: false }));
    n.push(graphNode(cmpGo1, 'Compare', 'Logic', 760, 480, { nodeKind: 'logic.compare', compareOp: '==', numberValue: 0, description: 'Still playing?' }));
    n.push(graphNode(andWin, 'AND', 'Logic', 980, 360, { nodeKind: 'logic.and' }));
    n.push(graphNode(brWin, 'Branch', 'Logic', 1180, 220, { nodeKind: 'logic.branch' }));
    n.push(graphNode(setWin, 'Set Variable', 'Variables', 1400, 220, { nodeKind: 'variable.set', variableId: gameOverVarId, valueType: 'number', numberValue: 1, description: 'Victory (one-shot).' }));
    n.push(graphNode(showWin, 'Show UI', 'UI', 1620, 220, { nodeKind: 'ui.show', documentId: victoryDocId, description: 'VICTORY screen.' }));
    e.push(
      execEdge(reset, brWin), valueEdge(getPrev, cmpWin, 'a'), valueEdge(getGo1, cmpGo1, 'a'),
      valueEdge(cmpWin, andWin, 'a'), valueEdge(cmpGo1, andWin, 'b'), valueEdge(andWin, brWin, 'condition'),
      execEdge(brWin, setWin), execEdge(setWin, showWin),
    );

    // LOSE: Health <= 0 AND GameOver == 0. Health is the engine-mirrored player health (written every frame
    // regardless of the player's own scripts), so it stays reliable even as the player ragdolls on death.
    const getHp = makeId('node');
    const cmpLose = makeId('node');
    const getGo2 = makeId('node');
    const cmpGo2 = makeId('node');
    const andLose = makeId('node');
    const brLose = makeId('node');
    const setLose = makeId('node');
    const showLose = makeId('node');
    n.push(graphNode(getHp, 'Get Variable', 'Variables', 40, 640, { nodeKind: 'variable.get', variableId: healthVarId, valueType: 'number', hasInput: false }));
    n.push(graphNode(cmpLose, 'Compare', 'Logic', 300, 640, { nodeKind: 'logic.compare', compareOp: '<=', numberValue: 0, description: 'Player dead?' }));
    n.push(graphNode(getGo2, 'Get Variable', 'Variables', 40, 760, { nodeKind: 'variable.get', variableId: gameOverVarId, valueType: 'number', hasInput: false }));
    n.push(graphNode(cmpGo2, 'Compare', 'Logic', 300, 760, { nodeKind: 'logic.compare', compareOp: '==', numberValue: 0 }));
    n.push(graphNode(andLose, 'AND', 'Logic', 520, 640, { nodeKind: 'logic.and' }));
    n.push(graphNode(brLose, 'Branch', 'Logic', 740, 600, { nodeKind: 'logic.branch' }));
    n.push(graphNode(setLose, 'Set Variable', 'Variables', 960, 600, { nodeKind: 'variable.set', variableId: gameOverVarId, valueType: 'number', numberValue: 2, description: 'Defeat (one-shot).' }));
    n.push(graphNode(showLose, 'Show UI', 'UI', 1180, 600, { nodeKind: 'ui.show', documentId: defeatDocId, description: 'YOU DIED screen.' }));
    e.push(
      execEdge(upd, brLose), valueEdge(getHp, cmpLose, 'a'), valueEdge(getGo2, cmpGo2, 'a'),
      valueEdge(cmpLose, andLose, 'a'), valueEdge(cmpGo2, andLose, 'b'), valueEdge(andLose, brLose, 'condition'),
      execEdge(brLose, setLose), execEdge(setLose, showLose),
    );
  });
  // Place the Director FIRST among the extra objects so it ticks before the enemies each frame (it zeroes the
  // tally; the enemies then re-add themselves), keeping the count crisp.
  tutorialObjects.unshift({
    id: makeId('obj'), name: 'Game Director', kind: 'empty',
    transform: { position: [0, 4, 16], rotation: [0, 0, 0], scale: [1, 1, 1] },
    script: { blueprintId: director.blueprintId, graphId: director.graphId, enabled: true },
  });

  const hud = createFpsHud();

  // --- Commit everything atomically. ---
  useEditorStore.setState((draft) => ({
    animatorControllers: [...draft.animatorControllers, ...built.map((w) => w.controller), ...(enemyController ? [enemyController] : [])],
    activeAnimatorControllerId: built[0].controller.id,
    variables: [...draft.variables, weaponVar, slotVar, ammoVar, magVar, healthVar, enemiesAliveVar, alivePrevVar, gameOverVar],
    blueprints: [...draft.blueprints, blueprint, enemyBlueprint, ...extraBlueprints],
    graphs: [...draft.graphs, graph, enemyGraph, ...extraGraphs],
    activeBlueprintId: blueprintId,
    uiDocuments: [...draft.uiDocuments, hud, ...extraUIDocs],
    activeUIDocumentId: hud.id,
    scenes: draft.scenes.map((scene) =>
      scene.id === draft.activeSceneId
        ? { ...scene, objects: [...scene.objects, ground, ...props, ...tutorialObjects, ...enemies, ...arms, ...(bulletTemplate ? [bulletTemplate] : []), pawn] }
        : scene,
    ),
    selectedObjectId: pawnId,
    isDirty: true,
  }));

  return pawnId;
}
