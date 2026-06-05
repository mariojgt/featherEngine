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
  CinematicAction,
  CinematicSequence,
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
  // Per-weapon feel (AAA): fire cadence, punch, projectile speed, and knockback — each weapon plays distinctly.
  fireRate: number; // seconds between shots / swings / throws
  damage: number; // per-hit damage (melee/grenade use blast or swing values)
  speed: number; // projectile muzzle speed
  knockback: number; // shove on a dynamic prop
  fireFile: string; // bundled shoot/swing/throw sound
  reloadFile?: string; // bundled reload sound (guns only)
}
const WEAPONS: WeaponDef[] = [
  { file: 'Arms_M416_Assault_Rifle.glb', name: 'M416 Rifle', key: 'Digit1', kind: 'ranged', mag: 30, fireRate: 0.1, damage: 28, speed: 95, knockback: 1.4, fireFile: 'fps_rifle_fire.mp3', reloadFile: 'fps_rifle_reload.mp3' },
  { file: 'Arms_Glock_G48.glb', name: 'Glock G48', key: 'Digit2', kind: 'ranged', mag: 17, fireRate: 0.22, damage: 22, speed: 80, knockback: 1.2, fireFile: 'fps_pistol_fire.mp3', reloadFile: 'fps_pistol_reload.mp3' },
  { file: 'Arms_AWM_Sniper.glb', name: 'AWM Sniper', key: 'Digit3', kind: 'sniper', mag: 5, fireRate: 1.1, damage: 120, speed: 170, knockback: 3.4, fireFile: 'fps_sniper_fire.mp3', reloadFile: 'fps_sniper_reload.mp3' },
  { file: 'Arms_Combat_Knife.glb', name: 'Combat Knife', key: 'Digit4', kind: 'melee', mag: 0, fireRate: 0.4, damage: 40, speed: 0, knockback: 0, fireFile: 'fps_knife_swing.mp3' },
  { file: 'Arms_Grenade.glb', name: 'Grenade', key: 'Digit5', kind: 'grenade', mag: 3, fireRate: 0.9, damage: 0, speed: 22, knockback: 0, fireFile: 'fps_grenade_throw.mp3', reloadFile: 'fps_pistol_reload.mp3' },
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

const cinematicAction = (type: CinematicAction['type'], data: Omit<CinematicAction, 'id' | 'type'>): CinematicAction => ({
  id: makeId('caction'),
  type,
  ...data,
});

function createFpsShowcaseCinematic(heroOrbId: string): CinematicSequence {
  return {
    id: makeId('cinematic'),
    name: 'FPS Showcase Finale',
    duration: 6.4,
    frameRate: 24,
    autoplay: false,
    skippable: true,
    folder: 'FPS Showcase',
    look: { letterbox: 2.39, grade: 'teal-orange', gradeIntensity: 0.75, exposure: 0.04, contrast: 0.18, saturation: 0.12, grain: 0.04, vignette: 0.34 },
    markers: [
      { id: makeId('cmark'), time: 0, label: 'HUD handoff', color: '#15e8ff' },
      { id: makeId('cmark'), time: 2.2, label: 'Systems orbit', color: '#ff2bd6' },
      { id: makeId('cmark'), time: 5.6, label: 'Mission ready', color: '#39ff9e' },
    ],
    actions: [
      cinematicAction('fade', { time: 0, duration: 0.65, label: 'Neon fade in', fadeFrom: 1, fadeTo: 0, fadeColor: '#05030c' }),
      cinematicAction('camera', {
        time: 0,
        duration: 6.4,
        label: 'Showcase room flythrough',
        interpolation: 'smooth',
        keyframes: [
          { time: 0, position: [-5.4, 2.0, 20.8], lookAt: [0, 1.5, 25.2], fov: 56, aperture: 2.6, focusDistance: 8 },
          { time: 1.8, position: [5.8, 2.5, 23.4], lookAt: [0, 1.7, 26.0], fov: 48, aperture: 2.2, focusDistance: 6.5 },
          { time: 3.7, position: [0, 4.0, 20.2], lookAt: [0, 1.6, 29.4], fov: 52, aperture: 1.4, focusDistance: 10 },
          { time: 6.4, position: [0, 2.6, 18.2], lookAt: [9, 0.8, 6.5], fov: 58, aperture: 0.4, focusDistance: 16 },
        ],
      }),
      cinematicAction('transform', {
        time: 0,
        duration: 6.1,
        objectId: heroOrbId,
        ease: 'smooth',
        fromPosition: [0, 1.6, 26.6],
        toPosition: [0, 2.7, 26.6],
        fromRotation: [0, 0, 0],
        toRotation: [0, Math.PI * 2, 0],
        fromScale: [0.7, 0.7, 0.7],
        toScale: [1.25, 1.25, 1.25],
      }),
      cinematicAction('material', {
        time: 0.4,
        duration: 5.2,
        objectId: heroOrbId,
        fromMaterial: { emissiveColor: '#15e8ff', emissiveIntensity: 1.2, roughness: 0.18, metalness: 0.35 },
        toMaterial: { emissiveColor: '#ff2bd6', emissiveIntensity: 4.8, roughness: 0.08, metalness: 0.75 },
      }),
      cinematicAction('timeDilation', { time: 2.2, duration: 1.4, label: 'Slow showcase beat', fromTimeScale: 0.75, toTimeScale: 1.0 }),
      cinematicAction('fade', { time: 5.8, duration: 0.45, label: 'Handoff flash', fadeFrom: 0, fadeTo: 0.32, fadeColor: '#15e8ff' }),
      cinematicAction('fade', { time: 6.2, duration: 0.2, label: 'Clear flash', fadeFrom: 0.32, fadeTo: 0, fadeColor: '#15e8ff' }),
    ],
    createdAt: Date.now(),
  };
}

/** Cyberpunk neon HUD: a bottom-right weapon + ammo readout (glowing cyan name, big tabular count beside a
 *  dim "/ MAG") on a dark glass chip with a cyan edge-glow, and a key-cap controls strip that auto-fades a
 *  few seconds after drop-in. Binds Weapon/Ammo/MagSize. (The live crosshair is the engine's DynamicCrosshair.) */
const createFpsHud = (): UIDocument => {
  const root = uiElement('panel', 'Root', { width: '100%', height: '100%', position: 'relative', padding: '0' });

  // Bottom-right: glowing cyan weapon name, then a big tabular ammo count beside a dim "/ MAG", on a dark
  // neon-glass chip.
  const weaponBox = uiElement('panel', 'Weapon Box', {
    position: 'absolute', display: 'flex', flexDirection: 'column',
    custom: {
      right: '32px', bottom: '28px', alignItems: 'flex-end', gap: '2px', pointerEvents: 'none',
      background: 'rgba(10,8,22,0.62)', padding: '10px 18px', borderRadius: '12px',
      border: '1px solid rgba(21,232,255,0.45)', boxShadow: '0 0 22px rgba(21,232,255,0.28), inset 0 0 12px rgba(21,232,255,0.08)',
    },
  });
  const weaponName = boundElement('text', 'Weapon', {
    color: '#15e8ff', fontSize: '11px', fontWeight: '800', textAlign: 'right',
    custom: { letterSpacing: '3px', textTransform: 'uppercase', textShadow: '0 0 12px rgba(21,232,255,0.7)' },
  }, [{ target: 'text', expression: `Weapon` }], 'M416 RIFLE');
  const ammoRow = uiElement('panel', 'Ammo Row', { display: 'flex', custom: { alignItems: 'flex-end', gap: '6px' } });
  const ammoCurrent = boundElement('text', 'Ammo', {
    color: '#FFFFFF', fontSize: '40px', fontWeight: '800', textAlign: 'right',
    custom: { lineHeight: '1', fontVariantNumeric: 'tabular-nums', textShadow: '0 0 16px rgba(255,255,255,0.35)' },
  }, [
    { target: 'text', expression: `MagSize > 0 ? '' + Ammo : '—'` },
    { target: 'color', expression: `Ammo == 0 && MagSize > 0 ? '#ff2bd6' : '#FFFFFF'` },
  ], '30');
  const ammoMag = boundElement('text', 'Ammo Mag', {
    color: 'rgba(220,235,255,0.4)', fontSize: '16px', fontWeight: '700', textAlign: 'left',
    custom: { lineHeight: '1', paddingBottom: '4px', fontVariantNumeric: 'tabular-nums' },
  }, [{ target: 'text', expression: `MagSize > 0 ? '/ ' + MagSize : ''` }], '/ 30');
  ammoRow.children = [ammoCurrent, ammoMag];
  weaponBox.children = [weaponName, ammoRow];

  // Quick-start controls strip — dark neon key-cap chips, centered low. Holds then fades (pointerEvents none).
  const controls = uiElement('panel', 'Controls', {
    position: 'absolute', left: '50%', display: 'flex',
    custom: { bottom: '32px', transform: 'translateX(-50%)', gap: '14px', alignItems: 'center', pointerEvents: 'none', animation: 'nf-controls-fade 10s ease-in 0.5s forwards' },
  });
  const chip = (key: string, label: string): UIElement => {
    const wrap = uiElement('panel', `Key ${key}`, { display: 'flex', custom: { alignItems: 'center', gap: '7px' } });
    const cap = uiElement('text', 'Cap', {
      color: '#dffaff', fontSize: '11px', fontWeight: '800',
      custom: { letterSpacing: '1px', background: 'rgba(10,8,22,0.7)', border: '1px solid rgba(21,232,255,0.4)', borderRadius: '6px', padding: '3px 7px', textShadow: '0 0 8px rgba(21,232,255,0.55)' },
    }, key);
    const lab = uiElement('text', 'Label', { color: 'rgba(220,235,255,0.66)', fontSize: '11px', fontWeight: '600', custom: { letterSpacing: '0.5px' } }, label);
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
 * Build a room-based first-person engine showcase. Room 1 teaches movement and mouse-look, Room 2 shows
 * crawl/slow movement plus a real [E] interaction console, Room 3 showcases physics and shooting against
 * dynamic boxes/breakable targets, and Room 4 demonstrates bound UI + a trigger-driven Film Mode cinematic.
 * A deploy pad then loads a second Breach & Clear mission scene. Reuses the bundled FPS arm rigs (each with
 * its own idle/walk/run/jump/fire/aim/reload set) + auto-driven animators.
 * Returns the player object id. Requires a project to be open.
 */
export async function createFirstPersonTemplate(): Promise<string | undefined> {
  const store = useEditorStore.getState();
  const armsFolder = store.createFolder('FPS Arms');

  // --- Cyberpunk night: a deep indigo/violet sky, low cool ambient, a dim magenta "moon" sun, and thick
  //     neon-tinted fog so the cyan/magenta accents, muzzle flashes and grenade blasts BLOOM through the haze
  //     for a cinematic AAA look. (All tunable later in Scene Settings → Environment and Render.) ---
  const sceneId = store.activeSceneId;
  store.updateSceneEnvironment(sceneId, {
    skyMode: 'procedural',
    skyTopColor: '#070512',
    skyHorizonColor: '#2a0f47',
    skyGroundColor: '#05030c',
    environmentIntensity: 0.5,
    sunColor: '#ff4fd8',
    sunIntensity: 0.5,
    sunAzimuth: 210,
    sunElevation: 16,
    fogEnabled: true,
    fogColor: '#0a0618',
    fogNear: 10,
    fogFar: 60,
  });
  // Punchy neon post: strong bloom (low threshold so the emissive trim + tracers + blasts glow) and a
  // cinematic vignette to frame the dark arena.
  store.updateRenderSettings({ bloomEnabled: true, bloomIntensity: 0.9, bloomThreshold: 0.62, bloomRadius: 0.7, vignetteEnabled: true });

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

  // --- Sounds: a DISTINCT shot + reload per weapon (generated FX), the grenade throw + boom, footsteps, and a
  //     low ambient bed. Each unique file is imported once into a map the fire/reload graph wires per gun. ---
  const audioFolder = store.createFolder('FPS Audio');
  const soundByFile = new Map<string, string>(); // file → imported asset id
  const loadSound = async (file: string): Promise<string | undefined> => {
    if (soundByFile.has(file)) return soundByFile.get(file);
    const asset = await importAudio(file, audioFolder);
    if (asset) soundByFile.set(file, asset.id);
    return asset?.id;
  };
  for (const w of WEAPONS) {
    await loadSound(w.fireFile);
    if (w.reloadFile) await loadSound(w.reloadFile);
  }
  const grenadeBoomId = await loadSound('fps_grenade_explode.mp3');
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
  // Shooting-range score: TargetsAlive is a per-frame tally every LIVING breakable target re-adds itself to;
  // the Range Director snapshots it into TargetsLeft (stable for the HUD) then zeroes it. A shot target is
  // destroyed → stops ticking → drops out → TargetsLeft falls → "ALL CLEAR" at 0. (Same trick as enemy counts.)
  const targetsLeftVarId = makeId('var');
  const targetsAliveVarId = makeId('var');

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

  // Hold LMB to FIRE — one chain per weapon, each gated by its slot so only the equipped weapon acts, and each
  // with its OWN Cooldown (distinct fire rate), damage, projectile, knockback, and shot sound. Guns fire a neon
  // tracer (knocks no-health cubes, breaks health targets); the sniper hits hard + slow; the grenade lobs an
  // arcing orb that DETONATES (blast + boom); the knife just swings (its melee anim auto-plays).
  built.forEach((w, i) => {
    const slot = i + 1;
    const fireSfxId = soundByFile.get(w.fireFile);
    const fireKey = add(`Key Down: Mouse0 — ${w.name}`, 'Events', 40, { nodeKind: 'event.keyDown', keyCode: 'Mouse0', hasInput: false, description: `Fire/use ${w.name}.` });
    const rate = add('Cooldown', 'Logic', 240, { nodeKind: 'logic.cooldown', numberValue: w.fireRate, description: `${w.name} cadence (${w.fireRate}s).` });
    const getSlot = add('Get Variable', 'Variables', 240, { nodeKind: 'variable.get', variableId: slotVarId, valueType: 'number', hasInput: false });
    const slotCmp = add('Compare', 'Logic', 460, { nodeKind: 'logic.compare', compareOp: '==', numberValue: slot, description: `${w.name} equipped?` });
    const slotBranch = add('Branch', 'Logic', 680, { nodeKind: 'logic.branch' });
    edges.push(execEdge(fireKey, rate), valueEdge(getSlot, slotCmp, 'a'), valueEdge(slotCmp, slotBranch, 'condition'), execEdge(rate, slotBranch));
    if (w.kind === 'melee') {
      // Knife: no ammo, no projectile — the swing animation auto-plays (attacking param); just the swing SFX.
      if (fireSfxId) edges.push(execEdge(slotBranch, add('Play Sound', 'Audio', 900, { nodeKind: 'action.playSound', assetId: fireSfxId, description: `${w.name} swing.` })));
      row();
      return;
    }
    // Ammo gate → spend a round → fire.
    const getAmmo = add('Get Variable', 'Variables', 680, { nodeKind: 'variable.get', variableId: ammoVarId, valueType: 'number', hasInput: false });
    const ammoCmp = add('Compare', 'Logic', 900, { nodeKind: 'logic.compare', compareOp: '>', numberValue: 0, description: 'Have ammo?' });
    const ammoBranch = add('Branch', 'Logic', 1120, { nodeKind: 'logic.branch' });
    const getAmmo2 = add('Get Variable', 'Variables', 1120, { nodeKind: 'variable.get', variableId: ammoVarId, valueType: 'number', hasInput: false });
    const dec = add('Add', 'Math', 1340, { nodeKind: 'math.add', amount: -1, description: 'Spend a round.' });
    const setAmmo = add('Set Variable', 'Variables', 1560, { nodeKind: 'variable.set', variableId: ammoVarId, valueType: 'number' });
    edges.push(
      valueEdge(getAmmo, ammoCmp, 'a'), valueEdge(ammoCmp, ammoBranch, 'condition'), execEdge(slotBranch, ammoBranch),
      valueEdge(getAmmo2, dec, 'a'), valueEdge(dec, setAmmo, 'value'), execEdge(ammoBranch, setAmmo),
    );
    const shoot = add('Spawn Projectile', 'Runtime', 1780, w.kind === 'grenade'
      ? { nodeKind: 'action.spawnProjectile', projectileSpeed: w.speed, projectileDamage: 0, projectileLife: 1.6, projectileGravity: 1.2, projectileSize: 0.24, projectileColor: '#aaff00', projectileKnockback: 2.2, projectileExplosive: true, projectileBlastRadius: 5, projectileBlastDamage: 90, projectileBlastSound: grenadeBoomId, description: 'Lob a grenade orb that detonates on impact (or fuse-out).' }
      : { nodeKind: 'action.spawnProjectile', projectileSpeed: w.speed, projectileDamage: w.damage, projectileLife: 2, projectileColor: w.kind === 'sniper' ? '#ff2bd6' : '#39e0ff', projectileSize: w.kind === 'sniper' ? 0.2 : 0.14, projectileKnockback: w.knockback, description: `${w.name} shot.` });
    edges.push(execEdge(setAmmo, shoot));
    if (fireSfxId) edges.push(execEdge(shoot, add('Play Sound', 'Audio', 2000, { nodeKind: 'action.playSound', assetId: fireSfxId, description: `${w.name} sound.` })));
    row();
  });

  // Reload (R) — one chain per gun, gated by slot, refilling its own magazine with its own reload sound. The
  // reload arm animation plays automatically (the reload key drives the 'reloading' animator param).
  built.forEach((w, i) => {
    if (!w.reloadFile) return; // knife has nothing to reload
    const slot = i + 1;
    const reloadSfxId = soundByFile.get(w.reloadFile);
    const rKey = add(`Key Up: KeyR — ${w.name}`, 'Events', 40, { nodeKind: 'event.keyUp', keyCode: 'KeyR', hasInput: false, description: `Reload ${w.name}.` });
    const getSlot = add('Get Variable', 'Variables', 240, { nodeKind: 'variable.get', variableId: slotVarId, valueType: 'number', hasInput: false });
    const cmp = add('Compare', 'Logic', 460, { nodeKind: 'logic.compare', compareOp: '==', numberValue: slot, description: `${w.name} equipped?` });
    const br = add('Branch', 'Logic', 680, { nodeKind: 'logic.branch' });
    const setFull = add('Set Variable', 'Variables', 900, { nodeKind: 'variable.set', variableId: ammoVarId, valueType: 'number', numberValue: w.mag, description: `Refill to ${w.mag}.` });
    edges.push(execEdge(rKey, br), valueEdge(getSlot, cmp, 'a'), valueEdge(cmp, br, 'condition'), execEdge(br, setFull));
    if (reloadSfxId) edges.push(execEdge(setFull, add('Play Sound', 'Audio', 1120, { nodeKind: 'action.playSound', assetId: reloadSfxId, description: `${w.name} reload.` })));
    row();
  });

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
      keyCrouch: 'KeyC',
      keyCrawl: 'KeyZ',
      crawlMultiplier: 0.32,
      footstepSoundId: footstepSound?.id,
      rollSpeed: 0,
      rollDuration: 0.1,
    },
    // The player has INTEGRITY (health) so mission guard fire can hurt them; the runtime mirrors it into the
    // `Health` project var each frame for the mission HUD. Harmless in the training room (nothing shoots back).
    variables: { health: 100 },
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

  // Dark reflective "wet asphalt" floor — low roughness so the neon trim + lights streak across it.
  const ground: SceneObject = {
    id: makeId('obj'), name: 'Floor', kind: 'cube',
    transform: { position: [0, -0.1, 13], rotation: [0, 0, 0], scale: [30, 0.2, 36] },
    renderer: { ...defaultRenderer('cube', '#0c0a16'), metalness: 0.55, roughness: 0.32 },
    physics: fixedBox(),
  };

  // Dark walls with GLOWING NEON baseboard + cap trim (cyan one side, magenta the other) — the cyberpunk
  // signature. The strips are emissive + collision-free so they read as light, not geometry.
  const WALL = '#15121f';
  block('Wall Back', [0, 2, 31], [30, 4, 1], WALL, { roughness: 0.6, metalness: 0.3 });
  block('Wall Front', [0, 2, -5], [30, 4, 1], WALL, { roughness: 0.6, metalness: 0.3 });
  block('Wall Left', [-15, 2, 13], [1, 4, 36], WALL, { roughness: 0.6, metalness: 0.3 });
  block('Wall Right', [15, 2, 13], [1, 4, 36], WALL, { roughness: 0.6, metalness: 0.3 });
  const CYAN = '#15e8ff';
  const MAGENTA = '#ff2bd6';
  // Baseboard + waist-height neon runs along each side wall, plus a cap line on the back wall.
  block('Neon Left Low', [-14.4, 0.25, 13], [0.08, 0.16, 34], CYAN, { emissive: CYAN, intensity: 2.4, solid: false });
  block('Neon Left High', [-14.4, 2.6, 13], [0.08, 0.1, 34], CYAN, { emissive: CYAN, intensity: 2.0, solid: false });
  block('Neon Right Low', [14.4, 0.25, 13], [0.08, 0.16, 34], MAGENTA, { emissive: MAGENTA, intensity: 2.4, solid: false });
  block('Neon Right High', [14.4, 2.6, 13], [0.08, 0.1, 34], MAGENTA, { emissive: MAGENTA, intensity: 2.0, solid: false });
  block('Neon Back', [0, 3.6, 30.4], [29, 0.12, 0.08], CYAN, { emissive: CYAN, intensity: 2.0, solid: false });
  block('Neon Front', [0, 3.6, -4.4], [29, 0.12, 0.08], MAGENTA, { emissive: MAGENTA, intensity: 1.8, solid: false });

  // Colored neon point lights (cyan/magenta) that pool on the wet floor — moody, not flat. Kept moderate so
  // the dark holds and the emissives + blasts still pop through bloom.
  const lights: Array<{ p: Vector3Tuple; c: string; i: number }> = [
    { p: [-10, 4, 6], c: CYAN, i: 7 },
    { p: [10, 4, 10], c: MAGENTA, i: 7 },
    { p: [-9, 4, 20], c: MAGENTA, i: 6 },
    { p: [9, 4.5, 24], c: CYAN, i: 6 },
    { p: [0, 5, 29], c: '#ff5a5f', i: 5 },
  ];
  lights.forEach((l, i) =>
    props.push({
      id: makeId('obj'), name: `Neon Light ${i + 1}`, kind: 'light',
      transform: { position: l.p, rotation: [0, 0, 0], scale: [1, 1, 1] },
      light: { type: 'point', color: l.c, intensity: l.i, distance: 26, angle: Math.PI / 6, castShadow: false },
    }),
  );

  // ROOM ROUTE — four connected showcase rooms with wide center doorways. The route is intentionally made
  // from simple primitives so users can inspect, move, duplicate, or rebuild each piece in the editor.
  const divider = (name: string, z: number, color: string) => {
    block(`${name} Left Wall`, [-10.5, 1.7, z], [8.6, 3.4, 0.45], WALL, { roughness: 0.62, metalness: 0.25 });
    block(`${name} Right Wall`, [10.5, 1.7, z], [8.6, 3.4, 0.45], WALL, { roughness: 0.62, metalness: 0.25 });
    block(`${name} Header`, [0, 3.35, z], [6.4, 0.28, 0.5], color, { emissive: color, intensity: 1.7, solid: false });
  };
  divider('Gate 01 Movement To Crawl', 6.4, CYAN);
  divider('Gate 02 Crawl To Physics', 13.2, MAGENTA);
  divider('Gate 03 Physics To Finale', 21.2, '#39ff9e');
  block('Room 1 Movement Floor Strip', [0, 0.02, 1.2], [9, 0.04, 0.18], CYAN, { emissive: CYAN, intensity: 1.25, solid: false });
  block('Room 2 Crawl Floor Strip', [0, 0.02, 9.9], [9, 0.04, 0.18], MAGENTA, { emissive: MAGENTA, intensity: 1.25, solid: false });
  block('Room 3 Physics Floor Strip', [0, 0.02, 16.8], [9, 0.04, 0.18], '#ff8a3d', { emissive: '#ff8a3d', intensity: 1.25, solid: false });
  block('Room 4 UI Cinematic Floor Strip', [0, 0.02, 24.8], [9, 0.04, 0.18], '#39ff9e', { emissive: '#39ff9e', intensity: 1.25, solid: false });

  // STATION 1 — loose cubes right by the spawn: walk into them to feel the physics immediately.
  ([[-1.7, 0.3, 4.4], [-0.9, 0.3, 5.0], [-0.1, 0.3, 4.5], [1.3, 0.3, 4.4], [2.0, 0.3, 5.0]] as Vector3Tuple[]).forEach((p, i) =>
    target(`Loose Cube ${i + 1}`, p, i % 2 ? '#bfe3ff' : '#f2f5f8', i % 2 ? '#2b7fff' : undefined),
  );

  // ROOM 2 — crawl/interaction showcase. The low scanner tunnel is decorative (non-solid) so it demonstrates
  // the crawl input and crawling animator source without trapping a first-person capsule under a ceiling.
  block('Crawl Tunnel Left Rail', [-5.2, 0.45, 9.8], [0.24, 0.9, 4.2], '#231735', { emissive: MAGENTA, intensity: 0.35, solid: false });
  block('Crawl Tunnel Right Rail', [-1.8, 0.45, 9.8], [0.24, 0.9, 4.2], '#231735', { emissive: MAGENTA, intensity: 0.35, solid: false });
  block('Crawl Tunnel Low Scanner', [-3.5, 1.05, 9.8], [3.7, 0.18, 4.2], MAGENTA, { emissive: MAGENTA, intensity: 1.8, solid: false });
  block('Crawl Tunnel Entry Glow', [-3.5, 0.08, 7.7], [3.7, 0.1, 0.18], MAGENTA, { emissive: MAGENTA, intensity: 1.5, solid: false });
  const crawlConsole = block('Interaction Console Pedestal', [5.8, 0.45, 9.7], [0.9, 0.9, 0.9], '#1b1530', { roughness: 0.55, metalness: 0.35 });
  block('Interaction Console Screen', [5.8, 1.08, 9.25], [1.0, 0.42, 0.08], CYAN, { emissive: CYAN, intensity: 1.6, solid: false });

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

  // ROOM 4 — UI + cinematic showcase. The orb is animated by a real CinematicSequence and can be played
  // either by walking through the trigger or by interacting with the console in this room.
  const finaleOrb: SceneObject = {
    id: makeId('obj'), name: 'Finale Cinematic Orb', kind: 'sphere',
    transform: { position: [0, 1.6, 26.6], rotation: [0, 0, 0], scale: [0.7, 0.7, 0.7] },
    renderer: { ...defaultRenderer('sphere', '#15e8ff'), metalness: 0.45, roughness: 0.18, materialOverrides: { emissiveColor: '#15e8ff', emissiveIntensity: 2.2 } },
    physics: fixedBox('sphere'),
  };
  props.push(finaleOrb);
  const finaleCinematic = createFpsShowcaseCinematic(finaleOrb.id);
  const finaleConsole = block('Finale Console Pedestal', [-5.8, 0.45, 25.8], [0.9, 0.9, 0.9], '#1b1530', { roughness: 0.55, metalness: 0.35 });
  block('Finale Console Screen', [-5.8, 1.08, 25.35], [1.0, 0.42, 0.08], '#39ff9e', { emissive: '#39ff9e', intensity: 1.7, solid: false });
  block('UI Showcase Frame Top', [0, 3.05, 29.2], [9.2, 0.12, 0.12], '#39ff9e', { emissive: '#39ff9e', intensity: 1.8, solid: false });
  block('UI Showcase Frame Bottom', [0, 0.65, 29.2], [9.2, 0.12, 0.12], '#39ff9e', { emissive: '#39ff9e', intensity: 1.4, solid: false });
  block('UI Showcase Frame Left', [-4.6, 1.85, 29.2], [0.12, 2.4, 0.12], '#39ff9e', { emissive: '#39ff9e', intensity: 1.4, solid: false });
  block('UI Showcase Frame Right', [4.6, 1.85, 29.2], [0.12, 2.4, 0.12], '#39ff9e', { emissive: '#39ff9e', intensity: 1.4, solid: false });

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
        background: 'rgba(8,6,18,0.82)', padding: '14px 28px', borderRadius: '12px',
        border: `1px solid ${color}66`, borderLeft: `3px solid ${color}`,
        width: 'max-content', maxWidth: 'min(560px, 86%)', pointerEvents: 'none',
        boxShadow: `0 0 30px ${color}44, inset 0 0 16px ${color}14`, animation: 'nf-tip-in 0.26s ease-out',
      },
    });
    const headEl = uiElement('text', 'Tip Header', {
      color, fontSize: '13px', fontWeight: '800', textAlign: 'center',
      custom: { letterSpacing: '3px', textTransform: 'uppercase', textShadow: `0 0 12px ${color}aa` },
    }, header);
    const bodyEl = uiElement('text', 'Tip Body', {
      color: 'rgba(226,238,255,0.92)', fontSize: '15px', fontWeight: '600', textAlign: 'center',
      custom: { whiteSpace: 'pre-line', lineHeight: '1.45', textShadow: '0 2px 8px rgba(0,0,0,0.9)' },
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

  makeSign('Room 1: Movement', 'WASD to move   ·   Move the mouse to look\nSHIFT to sprint   ·   SPACE to jump', [0, 0, 3], '#15e8ff', 2);
  makeSign('Room 2: Crawl + Interact', 'Hold Z to crawl/slow-walk through the scanner lane.\nLook at the console and press E to fire an interaction Blueprint.', [0, 0, 8], '#ff2bd6', 2);
  makeSign('Room 3: Physics + Shooting', 'Hold LEFT MOUSE to fire. Shoot the loose boxes, tower, and red targets.\nPress 1–5 to swap weapons, R to reload, RMB to aim.', [0, 0, 14], '#ff8a3d', 2);
  makeSign('Room 4: UI + Cinematic', 'Walk through the green trigger or press E at the console.\nA screen UI panel appears and a real Film Mode cinematic plays.', [0, 0, 22.2], '#39ff9e', 2);

  const createToastDoc = (name: string, title: string, body: string, color: string): string => {
    const docId = makeId('ui');
    const root = uiElement('panel', `${name} Root`, { width: '100%', height: '100%', position: 'relative', padding: '0' });
    const box = uiElement('panel', name, {
      position: 'absolute', left: '50%', display: 'flex', flexDirection: 'column',
      custom: { top: '18%', transform: 'translateX(-50%)', alignItems: 'center', gap: '8px', pointerEvents: 'none', background: 'rgba(8,6,18,0.84)', padding: '18px 30px', borderRadius: '12px', border: `1px solid ${color}77`, boxShadow: `0 0 34px ${color}44, inset 0 0 18px ${color}14`, animation: 'nf-showcase-toast 0.25s ease-out' },
    });
    const head = uiElement('text', `${name} Header`, { color, fontSize: '13px', fontWeight: '800', textAlign: 'center', custom: { letterSpacing: '3px', textTransform: 'uppercase', textShadow: `0 0 14px ${color}aa` } }, title);
    const line = uiElement('text', `${name} Body`, { color: 'rgba(226,238,255,0.92)', fontSize: '15px', fontWeight: '600', textAlign: 'center', custom: { whiteSpace: 'pre-line', lineHeight: '1.45' } }, body);
    box.children = [head, line];
    root.children = [box];
    extraUIDocs.push({ id: docId, name, surface: 'screen', root, css: '@keyframes nf-showcase-toast { from { opacity: 0; transform: translate(-50%, -8px); } to { opacity: 1; transform: translate(-50%, 0); } }', visibleOnStart: false, createdAt: Date.now() });
    return docId;
  };

  const crawlConsoleDocId = createToastDoc('Crawl Console UI', 'Interaction Fired', 'This panel was shown by an Interact event on the console.\nOpen the "Crawl Console" Blueprint to edit the E-key logic.', '#15e8ff');
  const finaleDocId = createToastDoc('Finale UI', 'Engine Showcase Complete', 'Movement, crawl, physics, shooting, UI bindings, triggers, interaction, and cinematics are all live.\nUse the magenta DEPLOY pad to enter the mission scene.', '#39ff9e');

  const crawlConsoleBp = miniBlueprint('Crawl Console', '#15e8ff', (n, e) => {
    const interact = makeId('node');
    const show = makeId('node');
    const wait = makeId('node');
    const hide = makeId('node');
    n.push(graphNode(interact, 'Interact', 'Events', 40, 40, { nodeKind: 'event.interact', hasInput: false, description: 'Player pressed E on the console.' }));
    n.push(graphNode(show, 'Show UI', 'UI', 300, 40, { nodeKind: 'ui.show', documentId: crawlConsoleDocId, description: 'Show a console response.' }));
    n.push(graphNode(wait, 'Delay', 'Logic', 540, 40, { nodeKind: 'logic.delay', numberValue: 3, description: 'Leave it readable briefly.' }));
    n.push(graphNode(hide, 'Hide UI', 'UI', 780, 40, { nodeKind: 'ui.hide', documentId: crawlConsoleDocId }));
    e.push(execEdge(interact, show), execEdge(show, wait), execEdge(wait, hide));
  });
  crawlConsole.script = { blueprintId: crawlConsoleBp.blueprintId, graphId: crawlConsoleBp.graphId, enabled: true };
  crawlConsole.variables = { interactable: true, interactPrompt: 'Run crawl console' };

  const finaleBp = miniBlueprint('Finale Trigger', '#39ff9e', (n, e) => {
    const trig = makeId('node');
    const show = makeId('node');
    const play = makeId('node');
    const wait = makeId('node');
    const hide = makeId('node');
    n.push(graphNode(trig, 'Trigger Enter', 'Events', 40, 40, { nodeKind: 'event.triggerEnter', otherObjectId: pawnId, hasInput: false, description: 'Player enters the finale room trigger.' }));
    n.push(graphNode(show, 'Show UI', 'UI', 300, 40, { nodeKind: 'ui.show', documentId: finaleDocId, description: 'Show the showcase summary panel.' }));
    n.push(graphNode(play, 'Play Cinematic', 'Runtime', 540, 40, { nodeKind: 'action.playCinematic', cinematicId: finaleCinematic.id, description: 'Play the editable finale cinematic.' }));
    n.push(graphNode(wait, 'Delay', 'Logic', 780, 40, { nodeKind: 'logic.delay', numberValue: 6.5 }));
    n.push(graphNode(hide, 'Hide UI', 'UI', 1020, 40, { nodeKind: 'ui.hide', documentId: finaleDocId }));
    e.push(execEdge(trig, show), execEdge(show, play), execEdge(play, wait), execEdge(wait, hide));
  });
  const finaleInteractBp = miniBlueprint('Finale Console', '#39ff9e', (n, e) => {
    const interact = makeId('node');
    const show = makeId('node');
    const play = makeId('node');
    const wait = makeId('node');
    const hide = makeId('node');
    n.push(graphNode(interact, 'Interact', 'Events', 40, 40, { nodeKind: 'event.interact', hasInput: false, description: 'Player pressed E on the finale console.' }));
    n.push(graphNode(show, 'Show UI', 'UI', 300, 40, { nodeKind: 'ui.show', documentId: finaleDocId }));
    n.push(graphNode(play, 'Play Cinematic', 'Runtime', 540, 40, { nodeKind: 'action.playCinematic', cinematicId: finaleCinematic.id }));
    n.push(graphNode(wait, 'Delay', 'Logic', 780, 40, { nodeKind: 'logic.delay', numberValue: 6.5 }));
    n.push(graphNode(hide, 'Hide UI', 'UI', 1020, 40, { nodeKind: 'ui.hide', documentId: finaleDocId }));
    e.push(execEdge(interact, show), execEdge(show, play), execEdge(play, wait), execEdge(wait, hide));
  });
  finaleConsole.script = { blueprintId: finaleInteractBp.blueprintId, graphId: finaleInteractBp.graphId, enabled: true };
  finaleConsole.variables = { interactable: true, interactPrompt: 'Play finale cinematic' };
  tutorialObjects.push({
    id: makeId('obj'), name: 'Finale Cinematic Trigger', kind: 'empty',
    transform: { position: [0, 1.2, 24.0], rotation: [0, 0, 0], scale: [5.2, 2.4, 2.4] },
    physics: { ...fixedBox('box'), bodyType: 'dynamic', isTrigger: true, gravityScale: 0 },
    script: { blueprintId: finaleBp.blueprintId, graphId: finaleBp.graphId, enabled: true },
  });

  // ============================================================================================
  // EXTRAS — a scoring shooting range (breakable red targets + a HUD counter), a sliding moving target, a
  // bounce/launch pad, and a tall physics tower to topple. Optional playground; nothing here is required.
  // ============================================================================================

  // --- BREAKABLE TARGETS + score. Red plates with a `health` var: a shot DESTROYS them (the tracer deals
  //     damage; the knock-over cubes have no health, so they just get shoved). Every LIVING target re-adds 1
  //     to TargetsAlive each frame; the Range Director snapshots that into TargetsLeft then zeroes it — so the
  //     HUD shows how many remain and flips to "ALL CLEAR" once the last one is down. ---
  const targetBp = miniBlueprint('Range Target', '#ff5a5f', (n, e) => {
    const upd = makeId('node');
    const get = makeId('node');
    const inc = makeId('node');
    const set = makeId('node');
    n.push(graphNode(upd, 'Update', 'Events', 40, 40, { nodeKind: 'event.update', hasInput: false, description: 'Each frame.' }));
    n.push(graphNode(get, 'Get Variable', 'Variables', 40, 200, { nodeKind: 'variable.get', variableId: targetsAliveVarId, valueType: 'number', hasInput: false }));
    n.push(graphNode(inc, 'Add', 'Math', 300, 200, { nodeKind: 'math.add', amount: 1, description: 'Count myself as still standing.' }));
    n.push(graphNode(set, 'Set Variable', 'Variables', 540, 40, { nodeKind: 'variable.set', variableId: targetsAliveVarId, valueType: 'number', description: 'Re-assert each frame.' }));
    e.push(execEdge(upd, set), valueEdge(get, inc, 'a'), valueEdge(inc, set, 'value'));
  });
  block('Range Backboard', [0, 1.7, 30.7], [11, 3.4, 0.3], '#c2c8d2', { roughness: 0.85 });
  const breakSpots: Vector3Tuple[] = [[-4.5, 1.4, 30.4], [-2.7, 2.1, 30.4], [-0.9, 1.4, 30.4], [0.9, 2.1, 30.4], [2.7, 1.4, 30.4], [4.5, 2.1, 30.4]];
  breakSpots.forEach((p, i) =>
    tutorialObjects.push({
      id: makeId('obj'), name: `Range Target ${i + 1}`, kind: 'cube',
      transform: { position: p, rotation: [0, 0, 0], scale: [0.7, 0.7, 0.2] },
      renderer: { ...defaultRenderer('cube', '#ff5a5f'), metalness: 0.05, roughness: 0.55, materialOverrides: { emissiveColor: '#ff5a5f', emissiveIntensity: 0.7 } },
      physics: fixedBox('box'),
      script: { blueprintId: targetBp.blueprintId, graphId: targetBp.graphId, enabled: true },
      variables: { health: 30 },
    }),
  );
  const targetCount = breakSpots.length;
  const targetsLeftVar: ProjectVariable = { id: targetsLeftVarId, name: 'TargetsLeft', type: 'number', defaultValue: targetCount, persistent: false, createdAt: Date.now() };
  const targetsAliveVar: ProjectVariable = { id: targetsAliveVarId, name: 'TargetsAlive', type: 'number', defaultValue: targetCount, persistent: false, createdAt: Date.now() };
  // Range Director (an empty — it never dies, so it always ticks): snapshot the tally → zero it. Unshifted to
  // the FRONT of tutorialObjects so it runs BEFORE the targets re-add each frame, keeping the count crisp.
  const rangeDirector = miniBlueprint('Range Director', '#ffd082', (n, e) => {
    const upd = makeId('node');
    const get = makeId('node');
    const setLeft = makeId('node');
    const reset = makeId('node');
    n.push(graphNode(upd, 'Update', 'Events', 40, 40, { nodeKind: 'event.update', hasInput: false, description: 'Tally watcher.' }));
    n.push(graphNode(get, 'Get Variable', 'Variables', 40, 200, { nodeKind: 'variable.get', variableId: targetsAliveVarId, valueType: 'number', hasInput: false }));
    n.push(graphNode(setLeft, 'Set Variable', 'Variables', 300, 40, { nodeKind: 'variable.set', variableId: targetsLeftVarId, valueType: 'number', description: 'Stable count for the HUD.' }));
    n.push(graphNode(reset, 'Set Variable', 'Variables', 560, 40, { nodeKind: 'variable.set', variableId: targetsAliveVarId, valueType: 'number', numberValue: 0, description: 'Living targets re-add themselves.' }));
    e.push(execEdge(upd, setLeft), valueEdge(get, setLeft, 'value'), execEdge(setLeft, reset));
  });
  tutorialObjects.unshift({
    id: makeId('obj'), name: 'Range Director', kind: 'empty',
    transform: { position: [0, 4, 29], rotation: [0, 0, 0], scale: [1, 1, 1] },
    script: { blueprintId: rangeDirector.blueprintId, graphId: rangeDirector.graphId, enabled: true },
  });
  // Objective pill (top-center): "TARGETS LEFT: N" → "ALL CLEAR". Its own screen doc; root is a full-screen
  // container so the pill sizes to its content (same reason as the tip cards).
  {
    const objRoot = uiElement('panel', 'Objective Root', { width: '100%', height: '100%', position: 'relative', padding: '0' });
    const pill = uiElement('panel', 'Objective', {
      position: 'absolute', left: '50%', display: 'flex',
      custom: { top: '20px', transform: 'translateX(-50%)', background: 'rgba(8,6,18,0.66)', padding: '7px 20px', borderRadius: '999px', border: '1px solid rgba(255,43,214,0.4)', boxShadow: '0 0 20px rgba(255,43,214,0.3)', pointerEvents: 'none' },
    });
    const objText = boundElement('text', 'Objective Text', {
      color: '#ff7be0', fontSize: '12px', fontWeight: '800', textAlign: 'center',
      custom: { whiteSpace: 'nowrap', letterSpacing: '2px', textTransform: 'uppercase', textShadow: '0 0 12px rgba(255,43,214,0.7)' },
    }, [
      { target: 'text', expression: `TargetsLeft > 0 ? '◎  Targets Left  ' + TargetsLeft : '✓  Range Cleared'` },
      { target: 'color', expression: `TargetsLeft > 0 ? '#ff7be0' : '#39ff9e'` },
    ], '◎  Targets Left  6');
    // Hide the training-range counter once the player deploys into the mission (the mission has its own HUD).
    pill.bindings = [{ target: 'visible', expression: 'InMission < 1' }];
    pill.children = [objText];
    objRoot.children = [pill];
    extraUIDocs.push({ id: makeId('ui'), name: 'Objective', surface: 'screen', root: objRoot, css: '', visibleOnStart: true, createdAt: Date.now() });
  }

  // --- MOVING TARGET — a kinematic purple plate that slides between two invisible bound sensors (teaches
  //     kinematic motion + triggers). Its `vx` instance var is its signed speed; each bound flips it. The
  //     sensors carry the flip logic (a sensor's graph receives Trigger Enter), the plate just reads its vx. ---
  const moverId = makeId('obj');
  const slider = miniBlueprint('Slider', '#7c5cff', (n, e) => {
    const upd = makeId('node');
    const getVx = makeId('node');
    const move = makeId('node');
    n.push(graphNode(upd, 'Update', 'Events', 40, 40, { nodeKind: 'event.update', hasInput: false, description: 'Slide each frame.' }));
    n.push(graphNode(getVx, 'Get Object Var', 'Variables', 40, 200, { nodeKind: 'variable.getObject', objectKey: 'vx', hasInput: false, description: 'Signed slide speed.' }));
    n.push(graphNode(move, 'Translate', 'Runtime', 300, 40, { nodeKind: 'action.translate', axis: 'x', description: 'Move along X by vx.' }));
    e.push(execEdge(upd, move), valueEdge(getVx, move, 'amount'));
  });
  const boundBp = (dir: number) =>
    miniBlueprint(dir > 0 ? 'Bound → Right' : 'Bound → Left', '#7c5cff', (n, e) => {
      const tIn = makeId('node');
      const set = makeId('node');
      n.push(graphNode(tIn, 'Trigger Enter', 'Events', 40, 40, { nodeKind: 'event.triggerEnter', otherObjectId: moverId, hasInput: false, description: 'Slider reaches this end.' }));
      n.push(graphNode(set, 'Set Object Var', 'Variables', 300, 40, { nodeKind: 'variable.setObject', objectKey: 'vx', targetObjectId: moverId, numberValue: dir * 3, description: `Send it ${dir > 0 ? 'right' : 'left'}.` }));
      e.push(execEdge(tIn, set));
    });
  const leftBp = boundBp(1); // entering the LEFT bound sends it back to the right
  const rightBp = boundBp(-1);
  tutorialObjects.push({
    id: moverId, name: 'Moving Target', kind: 'cube',
    transform: { position: [0, 1.7, 28], rotation: [0, 0, 0], scale: [0.7, 0.7, 0.2] },
    renderer: { ...defaultRenderer('cube', '#7c5cff'), metalness: 0.1, roughness: 0.45, materialOverrides: { emissiveColor: '#7c5cff', emissiveIntensity: 0.6 } },
    physics: { ...fixedBox('box'), bodyType: 'kinematic' },
    script: { blueprintId: slider.blueprintId, graphId: slider.graphId, enabled: true },
    variables: { vx: 3 },
  });
  ([[leftBp, -5.5], [rightBp, 5.5]] as Array<[{ blueprintId: string; graphId: string }, number]>).forEach(([bp, x]) =>
    tutorialObjects.push({
      id: makeId('obj'), name: x < 0 ? 'Slider Bound L' : 'Slider Bound R', kind: 'empty',
      transform: { position: [x, 1.7, 28], rotation: [0, 0, 0], scale: [0.6, 2, 1.4] },
      physics: { ...fixedBox('box'), bodyType: 'dynamic', isTrigger: true, gravityScale: 0 },
      script: { blueprintId: bp.blueprintId, graphId: bp.graphId, enabled: true },
    }),
  );

  // --- JUMP PAD — a glowing pad; stepping on it LAUNCHES the player up (Apply Force on $trigger, which the
  //     engine turns into a launch velocity for the kinematic character). Teaches triggers + Apply Force. ---
  const padBp = miniBlueprint('Jump Pad', '#27e0c0', (n, e) => {
    const tIn = makeId('node');
    const launch = makeId('node');
    n.push(graphNode(tIn, 'Trigger Enter', 'Events', 40, 40, { nodeKind: 'event.triggerEnter', otherObjectId: pawnId, hasInput: false, description: 'Player steps on the pad.' }));
    n.push(graphNode(launch, 'Apply Force', 'Physics', 300, 40, { nodeKind: 'action.applyForce', targetObjectId: '$trigger', axis: 'y', amount: 9, description: 'Launch the player up.' }));
    e.push(execEdge(tIn, launch));
  });
  block('Bounce Pad', [-7, 0.08, 12], [2.2, 0.16, 2.2], '#27e0c0', { emissive: '#27e0c0', intensity: 1.4, solid: false });
  tutorialObjects.push({
    id: makeId('obj'), name: 'Bounce Pad Trigger', kind: 'empty',
    transform: { position: [-7, 0.7, 12], rotation: [0, 0, 0], scale: [2.2, 1.2, 2.2] },
    physics: { ...fixedBox('box'), bodyType: 'dynamic', isTrigger: true, gravityScale: 0 },
    script: { blueprintId: padBp.blueprintId, graphId: padBp.graphId, enabled: true },
  });

  // --- PHYSICS TOWER — a tall stack of light cubes to spray down in one burst (pure physics spectacle). ---
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 3; c++) {
      target('Tower Cube', [7 + (c - 1) * 0.62, 0.3 + r * 0.62, 12], r % 2 ? '#f2f5f8' : '#dbe7f5', c === 1 ? '#2b7fff' : undefined);
    }
  }

  // ============================================================================================
  // MISSION — "BREACH & CLEAR": a separate neon facility scene, reached from a glowing DEPLOY pad in
  // the training room. Infiltrate, eliminate every hostile across three rooms, then reach the green
  // extraction zone. Take fire and your INTEGRITY drops — at zero it's MISSION FAILED (Enter to redeploy).
  // It REUSES the same player pawn + arm rigs + weapon graph (same object ids in both scenes, which is
  // safe because scenes serialize independently), so all five guns, the HUD and the animators work here too.
  // ============================================================================================
  const missionSceneId = store.createScene('Mission — Breach & Clear');
  store.updateSceneEnvironment(missionSceneId, {
    skyMode: 'procedural', skyTopColor: '#070512', skyHorizonColor: '#2a0f47', skyGroundColor: '#05030c',
    environmentIntensity: 0.45, sunColor: '#ff4fd8', sunIntensity: 0.45, sunAzimuth: 210, sunElevation: 14,
    fogEnabled: true, fogColor: '#0a0618', fogNear: 12, fogFar: 70,
  });
  store.setSceneAudio(missionSceneId, { ambientSoundId: ambientSound?.id });

  // Mission project variables: player Health (mirrored from the pawn), the objective MissionStage, a live
  // GuardsLeft tally (same snapshot trick as the range), and InMission to gate the mission HUD off in the base.
  const healthVarId = makeId('var');
  const stageVarId = makeId('var');
  const guardsLeftVarId = makeId('var');
  const guardsAliveVarId = makeId('var');
  const inMissionVarId = makeId('var');
  const guardFireSfx = soundByFile.get('fps_rifle_fire.mp3');

  const missionObjects: SceneObject[] = [];
  const mBlock = (name: string, position: Vector3Tuple, scale: Vector3Tuple, color: string, opts: BlockOpts = {}): SceneObject => {
    const renderer: MeshRendererComponent = {
      ...defaultRenderer('cube', color),
      metalness: opts.metalness ?? 0.08,
      roughness: opts.roughness ?? 0.85,
      ...(opts.emissive ? { materialOverrides: { emissiveColor: opts.emissive, emissiveIntensity: opts.intensity ?? 1.2 } } : {}),
    };
    const obj: SceneObject = { id: makeId('obj'), name, kind: 'cube', transform: { position, rotation: opts.rotation ?? [0, 0, 0], scale }, renderer };
    if (opts.solid !== false) obj.physics = fixedBox();
    missionObjects.push(obj);
    return obj;
  };

  // --- GUARD AI (one blueprint, shared by every hostile) ---
  // Each guard runs three parallel branches off Update: (1) re-add itself to the GuardsAlive tally, (2) advance
  // on the player when in aggro range, (3) when it has LINE OF SIGHT and is in range, face the player and fire a
  // neon round on its own cooldown (Cooldown is keyed per-object, so all guards fire on independent timers).
  // Guards are kinematic capsules with `health`; a player round drops health → at 0 the engine despawns them
  // (no rig → no ragdoll), so they fall out of the GuardsAlive tally and GuardsLeft ticks down.
  const guardAi = miniBlueprint('Guard AI', '#ff5a4d', (n, e) => {
    const node = (label: string, cat: GraphNodeCategory, x: number, y: number, data: Partial<NodeForgeNodeData>): string => {
      const i = makeId('node'); n.push(graphNode(i, label, cat, x, y, data)); return i;
    };
    const upd = node('Update', 'Events', 40, 40, { nodeKind: 'event.update', hasInput: false, description: 'Guard brain — runs each frame.' });
    // (1) Stay-alive tally.
    const getAlive = node('Get Variable', 'Variables', 40, 200, { nodeKind: 'variable.get', variableId: guardsAliveVarId, valueType: 'number', hasInput: false });
    const incAlive = node('Add', 'Math', 260, 200, { nodeKind: 'math.add', amount: 1, description: 'Count myself among the living.' });
    const setAlive = node('Set Variable', 'Variables', 480, 40, { nodeKind: 'variable.set', variableId: guardsAliveVarId, valueType: 'number' });
    e.push(execEdge(upd, setAlive), valueEdge(getAlive, incAlive, 'a'), valueEdge(incAlive, setAlive, 'value'));
    // (2) Advance on the player (only between a min stand-off and the aggro radius).
    const dist1 = node('Distance To Player', 'Runtime', 40, 380, { nodeKind: 'ai.distanceToPlayer', hasInput: false });
    const cmpFar = node('Compare', 'Logic', 280, 360, { nodeKind: 'logic.compare', compareOp: '>', numberValue: 4, description: 'Not point-blank?' });
    const cmpAggro = node('Compare', 'Logic', 280, 480, { nodeKind: 'logic.compare', compareOp: '<', numberValue: 24, description: 'Within aggro?' });
    const andChase = node('AND', 'Logic', 500, 400, { nodeKind: 'logic.and' });
    const brChase = node('Branch', 'Logic', 700, 360, { nodeKind: 'logic.branch' });
    const dir = node('Direction To Player', 'Runtime', 700, 520, { nodeKind: 'ai.directionToPlayer', hasInput: false });
    const mv = node('Move', 'Runtime', 920, 360, { nodeKind: 'action.move', amount: 2.4, description: 'Push toward the player.' });
    e.push(execEdge(upd, brChase), valueEdge(dist1, cmpFar, 'a'), valueEdge(dist1, cmpAggro, 'a'), valueEdge(cmpFar, andChase, 'a'), valueEdge(cmpAggro, andChase, 'b'), valueEdge(andChase, brChase, 'condition'), execEdge(brChase, mv), valueEdge(dir, mv, 'vector'));
    // (3) Engage with fire when it can see the player.
    const dist2 = node('Distance To Player', 'Runtime', 40, 660, { nodeKind: 'ai.distanceToPlayer', hasInput: false });
    const cmpFire = node('Compare', 'Logic', 280, 640, { nodeKind: 'logic.compare', compareOp: '<', numberValue: 26, description: 'In firing range?' });
    const los = node('Has Line Of Sight', 'Runtime', 280, 760, { nodeKind: 'ai.hasLineOfSight', hasInput: false });
    const andFire = node('AND', 'Logic', 500, 680, { nodeKind: 'logic.and' });
    const brFire = node('Branch', 'Logic', 700, 660, { nodeKind: 'logic.branch' });
    const face = node('Face Player', 'Runtime', 900, 660, { nodeKind: 'action.facePlayer', description: 'Track the player.' });
    const cd = node('Cooldown', 'Logic', 1100, 660, { nodeKind: 'logic.cooldown', numberValue: 1.1, description: 'Fire cadence (per guard).' });
    const shoot = node('Spawn Projectile', 'Runtime', 1320, 660, { nodeKind: 'action.spawnProjectile', projectileSpeed: 34, projectileDamage: 9, projectileLife: 3, projectileColor: '#ff5a4d', projectileSize: 0.18, projectileKnockback: 0, description: 'Fire a round at the player.' });
    e.push(execEdge(upd, brFire), valueEdge(dist2, cmpFire, 'a'), valueEdge(cmpFire, andFire, 'a'), valueEdge(los, andFire, 'b'), valueEdge(andFire, brFire, 'condition'), execEdge(brFire, face), execEdge(face, cd), execEdge(cd, shoot));
    if (guardFireSfx) e.push(execEdge(shoot, node('Play Sound', 'Audio', 1540, 660, { nodeKind: 'action.playSound', assetId: guardFireSfx, description: 'Guard shot.' })));
  });

  // --- GUARD DIRECTOR: snapshot GuardsAlive → GuardsLeft, then zero it so the living re-add next frame. ---
  const guardDir = miniBlueprint('Guard Director', '#ffd082', (n, e) => {
    const node = (label: string, cat: GraphNodeCategory, x: number, y: number, data: Partial<NodeForgeNodeData>): string => {
      const i = makeId('node'); n.push(graphNode(i, label, cat, x, y, data)); return i;
    };
    const upd = node('Update', 'Events', 40, 40, { nodeKind: 'event.update', hasInput: false, description: 'Hostile tally.' });
    const get = node('Get Variable', 'Variables', 40, 200, { nodeKind: 'variable.get', variableId: guardsAliveVarId, valueType: 'number', hasInput: false });
    const setLeft = node('Set Variable', 'Variables', 300, 40, { nodeKind: 'variable.set', variableId: guardsLeftVarId, valueType: 'number', description: 'Stable count for the HUD.' });
    const reset = node('Set Variable', 'Variables', 560, 40, { nodeKind: 'variable.set', variableId: guardsAliveVarId, valueType: 'number', numberValue: 0, description: 'Living guards re-add themselves.' });
    e.push(execEdge(upd, setLeft), valueEdge(get, setLeft, 'value'), execEdge(setLeft, reset));
  });

  // --- MISSION DIRECTOR: arms the run on Start, advances to EXTRACT when all guards are down, and handles
  //     ENTER to redeploy after death / return to base after winning (both reload the training scene). ---
  const missionDir = miniBlueprint('Mission Director', '#ff2bd6', (n, e) => {
    const node = (label: string, cat: GraphNodeCategory, x: number, y: number, data: Partial<NodeForgeNodeData>): string => {
      const i = makeId('node'); n.push(graphNode(i, label, cat, x, y, data)); return i;
    };
    // Start: flip the mission HUD on, reset the stage, top up Health.
    const st = node('Start', 'Events', 40, 40, { nodeKind: 'event.start', hasInput: false, description: 'Arm the mission.' });
    const sIn = node('Set Variable', 'Variables', 280, 40, { nodeKind: 'variable.set', variableId: inMissionVarId, valueType: 'number', numberValue: 1 });
    const sStage = node('Set Variable', 'Variables', 520, 40, { nodeKind: 'variable.set', variableId: stageVarId, valueType: 'number', numberValue: 0 });
    const sHp = node('Set Variable', 'Variables', 760, 40, { nodeKind: 'variable.set', variableId: healthVarId, valueType: 'number', numberValue: 100, description: 'Full integrity.' });
    e.push(execEdge(st, sIn), execEdge(sIn, sStage), execEdge(sStage, sHp));
    // Update: once engaged (stage 1) and the sector is clear → EXTRACT (stage 2).
    const upd = node('Update', 'Events', 40, 220, { nodeKind: 'event.update', hasInput: false });
    const gStage = node('Get Variable', 'Variables', 40, 360, { nodeKind: 'variable.get', variableId: stageVarId, valueType: 'number', hasInput: false });
    const cStage = node('Compare', 'Logic', 280, 340, { nodeKind: 'logic.compare', compareOp: '==', numberValue: 1, description: 'In the fight?' });
    const gGuards = node('Get Variable', 'Variables', 40, 480, { nodeKind: 'variable.get', variableId: guardsLeftVarId, valueType: 'number', hasInput: false });
    const cGuards = node('Compare', 'Logic', 280, 460, { nodeKind: 'logic.compare', compareOp: '<=', numberValue: 0, description: 'All clear?' });
    const andClear = node('AND', 'Logic', 500, 400, { nodeKind: 'logic.and' });
    const brClear = node('Branch', 'Logic', 700, 360, { nodeKind: 'logic.branch' });
    const setEx = node('Set Variable', 'Variables', 920, 360, { nodeKind: 'variable.set', variableId: stageVarId, valueType: 'number', numberValue: 2, description: 'Sector clear → extract.' });
    e.push(execEdge(upd, brClear), valueEdge(gStage, cStage, 'a'), valueEdge(gGuards, cGuards, 'a'), valueEdge(cStage, andClear, 'a'), valueEdge(cGuards, andClear, 'b'), valueEdge(andClear, brClear, 'condition'), execEdge(brClear, setEx));
    // Enter → redeploy after death.
    const kd = node('Key Down: Enter', 'Events', 40, 640, { nodeKind: 'event.keyDown', keyCode: 'Enter', hasInput: false, description: 'Redeploy after failing.' });
    const gHp = node('Get Variable', 'Variables', 40, 780, { nodeKind: 'variable.get', variableId: healthVarId, valueType: 'number', hasInput: false });
    const cDead = node('Compare', 'Logic', 280, 760, { nodeKind: 'logic.compare', compareOp: '<=', numberValue: 0, description: 'Dead?' });
    const brDead = node('Branch', 'Logic', 500, 640, { nodeKind: 'logic.branch' });
    const back1 = node('Load Scene', 'Runtime', 720, 640, { nodeKind: 'action.loadScene', targetSceneId: sceneId, description: 'Back to the training base.' });
    e.push(execEdge(kd, brDead), valueEdge(gHp, cDead, 'a'), valueEdge(cDead, brDead, 'condition'), execEdge(brDead, back1));
    // Enter → return to base after completing.
    const kw = node('Key Down: Enter', 'Events', 40, 940, { nodeKind: 'event.keyDown', keyCode: 'Enter', hasInput: false, description: 'Return after completing.' });
    const gStageW = node('Get Variable', 'Variables', 40, 1080, { nodeKind: 'variable.get', variableId: stageVarId, valueType: 'number', hasInput: false });
    const cWin = node('Compare', 'Logic', 280, 1060, { nodeKind: 'logic.compare', compareOp: '>=', numberValue: 3, description: 'Complete?' });
    const brWin = node('Branch', 'Logic', 500, 940, { nodeKind: 'logic.branch' });
    const back2 = node('Load Scene', 'Runtime', 720, 940, { nodeKind: 'action.loadScene', targetSceneId: sceneId });
    e.push(execEdge(kw, brWin), valueEdge(gStageW, cWin, 'a'), valueEdge(cWin, brWin, 'condition'), execEdge(brWin, back2));
  });

  // --- BREACH ZONE: entering the facility starts the firefight (stage 0 → 1, once). ---
  const entryBp = miniBlueprint('Breach Trigger', '#15e8ff', (n, e) => {
    const node = (label: string, cat: GraphNodeCategory, x: number, y: number, data: Partial<NodeForgeNodeData>): string => {
      const i = makeId('node'); n.push(graphNode(i, label, cat, x, y, data)); return i;
    };
    const tin = node('Trigger Enter', 'Events', 40, 40, { nodeKind: 'event.triggerEnter', otherObjectId: pawnId, hasInput: false, description: 'Player breaches the facility.' });
    const get = node('Get Variable', 'Variables', 40, 200, { nodeKind: 'variable.get', variableId: stageVarId, valueType: 'number', hasInput: false });
    const cmp = node('Compare', 'Logic', 300, 180, { nodeKind: 'logic.compare', compareOp: '<', numberValue: 1, description: 'Not engaged yet?' });
    const br = node('Branch', 'Logic', 520, 40, { nodeKind: 'logic.branch' });
    const set = node('Set Variable', 'Variables', 740, 40, { nodeKind: 'variable.set', variableId: stageVarId, valueType: 'number', numberValue: 1, description: 'Engage hostiles.' });
    e.push(execEdge(tin, br), valueEdge(get, cmp, 'a'), valueEdge(cmp, br, 'condition'), execEdge(br, set));
  });

  // --- EXTRACTION ZONE: reaching it once the sector is clear (stage ≥ 2) completes the mission (stage 3). ---
  const exitBp = miniBlueprint('Extraction Trigger', '#39ff9e', (n, e) => {
    const node = (label: string, cat: GraphNodeCategory, x: number, y: number, data: Partial<NodeForgeNodeData>): string => {
      const i = makeId('node'); n.push(graphNode(i, label, cat, x, y, data)); return i;
    };
    const tin = node('Trigger Enter', 'Events', 40, 40, { nodeKind: 'event.triggerEnter', otherObjectId: pawnId, hasInput: false, description: 'Player reaches the LZ.' });
    const get = node('Get Variable', 'Variables', 40, 200, { nodeKind: 'variable.get', variableId: stageVarId, valueType: 'number', hasInput: false });
    const cmp = node('Compare', 'Logic', 300, 180, { nodeKind: 'logic.compare', compareOp: '>=', numberValue: 2, description: 'Sector cleared?' });
    const br = node('Branch', 'Logic', 520, 40, { nodeKind: 'logic.branch' });
    const set = node('Set Variable', 'Variables', 740, 40, { nodeKind: 'variable.set', variableId: stageVarId, valueType: 'number', numberValue: 3, description: 'Mission complete!' });
    e.push(execEdge(tin, br), valueEdge(get, cmp, 'a'), valueEdge(cmp, br, 'condition'), execEdge(br, set));
  });

  // --- DEPLOY PAD (lives in the TRAINING room): stepping on it loads the mission scene. ---
  const deployBp = miniBlueprint('Deploy Pad', '#ff2bd6', (n, e) => {
    const tin = makeId('node'); const load = makeId('node');
    n.push(graphNode(tin, 'Trigger Enter', 'Events', 40, 40, { nodeKind: 'event.triggerEnter', otherObjectId: pawnId, hasInput: false, description: 'Deploy into the mission.' }));
    n.push(graphNode(load, 'Load Scene', 'Runtime', 300, 40, { nodeKind: 'action.loadScene', targetSceneId: missionSceneId, description: 'Start Breach & Clear.' }));
    e.push(execEdge(tin, load));
  });

  // --- BASE DIRECTOR (lives in the TRAINING room): turns the mission HUD off whenever you're at base. ---
  const baseDir = miniBlueprint('Base Director', '#3DDC97', (n, e) => {
    const st = makeId('node'); const set = makeId('node');
    n.push(graphNode(st, 'Start', 'Events', 40, 40, { nodeKind: 'event.start', hasInput: false, description: 'Training base — mission HUD off.' }));
    n.push(graphNode(set, 'Set Variable', 'Variables', 300, 40, { nodeKind: 'variable.set', variableId: inMissionVarId, valueType: 'number', numberValue: 0 }));
    e.push(execEdge(st, set));
  });

  // --- Build the facility (directors first so the tally snapshots before the guards re-add). ---
  missionObjects.push({ id: makeId('obj'), name: 'Guard Director', kind: 'empty', transform: { position: [0, 4, 25], rotation: [0, 0, 0], scale: [1, 1, 1] }, script: { blueprintId: guardDir.blueprintId, graphId: guardDir.graphId, enabled: true } });
  missionObjects.push({ id: makeId('obj'), name: 'Mission Director', kind: 'empty', transform: { position: [0, 4, 20], rotation: [0, 0, 0], scale: [1, 1, 1] }, script: { blueprintId: missionDir.blueprintId, graphId: missionDir.graphId, enabled: true } });

  // Dark reflective floor (matches the training room) + a containing perimeter so you can't walk off the world.
  missionObjects.push({ id: makeId('obj'), name: 'Mission Floor', kind: 'cube', transform: { position: [0, -0.1, 18], rotation: [0, 0, 0], scale: [42, 0.2, 54] }, renderer: { ...defaultRenderer('cube', '#0c0a16'), metalness: 0.55, roughness: 0.32 }, physics: fixedBox() });
  const WALL2 = '#15121f';
  mBlock('Bound Back', [0, 2.5, -8], [40, 5, 1], WALL2, { roughness: 0.6, metalness: 0.3 });
  mBlock('Bound Far', [0, 2.5, 44], [40, 5, 1], WALL2, { roughness: 0.6, metalness: 0.3 });
  mBlock('Bound Left', [-20, 2.5, 18], [1, 5, 53], WALL2, { roughness: 0.6, metalness: 0.3 });
  mBlock('Bound Right', [20, 2.5, 18], [1, 5, 53], WALL2, { roughness: 0.6, metalness: 0.3 });

  // The facility: an outer shell (x[-14,14], z[10,40]) with a front breach gap (x[-3,3]) and two internal walls
  // whose doorways are STAGGERED (left at z=22, right at z=32) so the player snakes through all three rooms.
  mBlock('Facility Front L', [-8.5, 2, 10], [11, 4, 1], WALL2, { metalness: 0.3, roughness: 0.6 });
  mBlock('Facility Front R', [8.5, 2, 10], [11, 4, 1], WALL2, { metalness: 0.3, roughness: 0.6 });
  mBlock('Facility Back', [0, 2, 40], [28, 4, 1], WALL2, { metalness: 0.3, roughness: 0.6 });
  mBlock('Facility Left', [-14, 2, 25], [1, 4, 30], WALL2, { metalness: 0.3, roughness: 0.6 });
  mBlock('Facility Right', [14, 2, 25], [1, 4, 30], WALL2, { metalness: 0.3, roughness: 0.6 });
  mBlock('Inner Wall A R', [3.5, 2, 22], [21, 4, 1], WALL2, { metalness: 0.3, roughness: 0.6 }); // gap on the left (x -12..-7)
  mBlock('Inner Wall A L', [-13, 2, 22], [2, 4, 1], WALL2, { metalness: 0.3, roughness: 0.6 });
  mBlock('Inner Wall B L', [-3.5, 2, 32], [21, 4, 1], WALL2, { metalness: 0.3, roughness: 0.6 }); // gap on the right (x 7..12)
  mBlock('Inner Wall B R', [13, 2, 32], [2, 4, 1], WALL2, { metalness: 0.3, roughness: 0.6 });

  // Neon signature trim + a glowing breach line at the entrance and a green ring at extraction.
  mBlock('Mission Neon L', [-13.9, 2.8, 25], [0.08, 0.1, 29], CYAN, { emissive: CYAN, intensity: 2, solid: false });
  mBlock('Mission Neon R', [13.9, 2.8, 25], [0.08, 0.1, 29], MAGENTA, { emissive: MAGENTA, intensity: 2, solid: false });
  mBlock('Mission Neon Back', [0, 3.7, 39.9], [26, 0.1, 0.08], '#39ff9e', { emissive: '#39ff9e', intensity: 1.6, solid: false });
  mBlock('Breach Glow', [0, 0.06, 10], [6, 0.12, 1], CYAN, { emissive: CYAN, intensity: 1.6, solid: false });
  mBlock('Extraction Pad', [0, 0.06, 38], [4.4, 0.12, 4.4], '#39ff9e', { emissive: '#39ff9e', intensity: 1.7, solid: false });

  // Cover crates to fight around.
  ([[-4, 15], [5, 19], [0, 27], [-9, 30], [4, 35]] as Array<[number, number]>).forEach(([x, z]) =>
    mBlock('Crate', [x, 0.55, z], [1.4, 1.1, 1.4], '#1b1530', { roughness: 0.6, metalness: 0.35 }),
  );

  // Moody point lights, green over the extraction zone.
  ([{ p: [0, 5, 6], c: CYAN, i: 6 }, { p: [-7, 4.5, 16], c: MAGENTA, i: 6 }, { p: [7, 4.5, 18], c: CYAN, i: 6 }, { p: [0, 4.5, 27], c: MAGENTA, i: 6 }, { p: [0, 4.5, 37], c: '#39ff9e', i: 7 }] as Array<{ p: Vector3Tuple; c: string; i: number }>).forEach((l, i) =>
    missionObjects.push({ id: makeId('obj'), name: `Mission Light ${i + 1}`, kind: 'light', transform: { position: l.p, rotation: [0, 0, 0], scale: [1, 1, 1] }, light: { type: 'point', color: l.c, intensity: l.i, distance: 28, angle: Math.PI / 6, castShadow: false } }),
  );

  // Hostiles — neon-red kinematic troopers with health, spread across the three rooms.
  const makeGuard = (name: string, x: number, z: number) =>
    missionObjects.push({
      id: makeId('obj'), name, kind: 'capsule',
      transform: { position: [x, 1.1, z], rotation: [0, 0, 0], scale: [0.85, 1.1, 0.85] },
      renderer: { ...defaultRenderer('capsule', '#181226'), metalness: 0.35, roughness: 0.4, materialOverrides: { emissiveColor: '#ff5a4d', emissiveIntensity: 0.7 } },
      physics: { ...fixedBox('capsule'), bodyType: 'kinematic' },
      script: { blueprintId: guardAi.blueprintId, graphId: guardAi.graphId, enabled: true },
      variables: { health: 40, maxHealth: 40 },
    });
  const guardSpots: Array<[number, number]> = [[-7, 16], [7, 18], [-6, 27], [8, 26], [-7, 36], [7, 37]];
  guardSpots.forEach(([x, z], i) => makeGuard(`Hostile ${i + 1}`, x, z));
  const guardCount = guardSpots.length;

  // Trigger volumes (sensors): breach at the entrance, extraction at the LZ.
  missionObjects.push({ id: makeId('obj'), name: 'Breach Zone', kind: 'empty', transform: { position: [0, 1.5, 10], rotation: [0, 0, 0], scale: [6, 3, 2] }, physics: { ...fixedBox('box'), bodyType: 'dynamic', isTrigger: true, gravityScale: 0 }, script: { blueprintId: entryBp.blueprintId, graphId: entryBp.graphId, enabled: true } });
  missionObjects.push({ id: makeId('obj'), name: 'Extraction Zone', kind: 'empty', transform: { position: [0, 1.2, 38], rotation: [0, 0, 0], scale: [4.4, 3, 4.4] }, physics: { ...fixedBox('box'), bodyType: 'dynamic', isTrigger: true, gravityScale: 0 }, script: { blueprintId: exitBp.blueprintId, graphId: exitBp.graphId, enabled: true } });

  // The mission re-uses the exact player pawn + arm rigs (same ids → the shared weapon graph drives them here too).
  missionObjects.push(structuredClone(pawn));
  arms.forEach((a) => missionObjects.push(structuredClone(a)));

  // --- TRAINING ROOM additions: the DEPLOY pad + trigger, a Base Director, and a sign. ---
  block('Deploy Pad', [9, 0.06, 6.5], [2.6, 0.12, 2.6], '#ff2bd6', { emissive: '#ff2bd6', intensity: 1.7, solid: false });
  tutorialObjects.push({ id: makeId('obj'), name: 'Deploy Trigger', kind: 'empty', transform: { position: [9, 0.8, 6.5], rotation: [0, 0, 0], scale: [2.6, 1.6, 2.6] }, physics: { ...fixedBox('box'), bodyType: 'dynamic', isTrigger: true, gravityScale: 0 }, script: { blueprintId: deployBp.blueprintId, graphId: deployBp.graphId, enabled: true } });
  tutorialObjects.push({ id: makeId('obj'), name: 'Base Director', kind: 'empty', transform: { position: [0, 4, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, script: { blueprintId: baseDir.blueprintId, graphId: baseDir.graphId, enabled: true } });
  makeSign('Deploy', 'Step onto the MAGENTA pad (right) to deploy into the\nBREACH & CLEAR mission — clear every hostile, then extract.', [9, 0, 4.2], '#ff2bd6', 2);

  // --- Mission HUD docs (global, gated by InMission so the training room stays clean). ---
  // Objective banner — one bound line drives the whole flow from MissionStage + GuardsLeft.
  {
    const root = uiElement('panel', 'Mission Obj Root', { width: '100%', height: '100%', position: 'relative', padding: '0' });
    const pill = boundElement('panel', 'Mission Objective', {
      position: 'absolute', left: '50%', display: 'flex',
      custom: { top: '56px', transform: 'translateX(-50%)', background: 'rgba(8,6,18,0.7)', padding: '8px 22px', borderRadius: '999px', border: '1px solid rgba(21,232,255,0.45)', boxShadow: '0 0 22px rgba(21,232,255,0.3)', pointerEvents: 'none' },
    }, [{ target: 'visible', expression: 'InMission >= 1' }]);
    const txt = boundElement('text', 'Mission Objective Text', {
      color: '#15e8ff', fontSize: '13px', fontWeight: '800', textAlign: 'center',
      custom: { whiteSpace: 'nowrap', letterSpacing: '2px', textTransform: 'uppercase', textShadow: '0 0 12px rgba(21,232,255,0.7)' },
    }, [
      { target: 'text', expression: `MissionStage < 1 ? '◆  INFILTRATE — Breach the facility ahead' : MissionStage < 2 ? (GuardsLeft > 0 ? '⚔  ELIMINATE — Hostiles remaining: ' + GuardsLeft : '⚔  Sector clear — hold') : MissionStage < 3 ? '◎  EXTRACT — Reach the green extraction zone' : '✓  MISSION COMPLETE'` },
      { target: 'color', expression: `MissionStage < 2 ? '#ff7be0' : MissionStage < 3 ? '#15e8ff' : '#39ff9e'` },
    ], '◆  INFILTRATE');
    pill.children = [txt];
    root.children = [pill];
    extraUIDocs.push({ id: makeId('ui'), name: 'Mission Objective', surface: 'screen', root, css: '', visibleOnStart: true, createdAt: Date.now() });
  }
  // Integrity bar (bottom-left), colour shifts as Health drops.
  {
    const root = uiElement('panel', 'Integrity Root', { width: '100%', height: '100%', position: 'relative', padding: '0' });
    const box = boundElement('panel', 'Integrity Box', {
      position: 'absolute', display: 'flex', flexDirection: 'column',
      custom: { left: '32px', bottom: '28px', gap: '5px', pointerEvents: 'none' },
    }, [{ target: 'visible', expression: 'InMission >= 1' }]);
    const label = boundElement('text', 'Integrity Label', {
      color: '#ff7be0', fontSize: '10px', fontWeight: '800',
      custom: { letterSpacing: '3px', textTransform: 'uppercase', textShadow: '0 0 10px rgba(255,123,224,0.6)' },
    }, [{ target: 'text', expression: `'INTEGRITY  ' + Health` }], 'INTEGRITY  100');
    const bar = boundElement('bar', 'Integrity Bar', {
      width: '240px', height: '14px', background: 'rgba(10,8,22,0.7)', borderRadius: '8px', color: '#39ff9e',
      custom: { border: '1px solid rgba(21,232,255,0.4)', boxShadow: '0 0 16px rgba(21,232,255,0.25)' },
    }, [
      { target: 'fill', expression: `Health / 100` },
      { target: 'color', expression: `Health > 50 ? '#39ff9e' : Health > 25 ? '#ffd27f' : '#ff2bd6'` },
    ]);
    box.children = [label, bar];
    root.children = [box];
    extraUIDocs.push({ id: makeId('ui'), name: 'Integrity', surface: 'screen', root, css: '', visibleOnStart: true, createdAt: Date.now() });
  }
  // Full-screen MISSION FAILED / MISSION COMPLETE overlays (shown purely by their visible bindings).
  const overlay = (name: string, titleText: string, subText: string, titleColor: string, backColor: string, visibleExpr: string) => {
    const root = uiElement('panel', `${name} Root`, { width: '100%', height: '100%', position: 'relative', padding: '0' });
    const back = boundElement('panel', `${name} Back`, {
      position: 'absolute', display: 'flex', flexDirection: 'column',
      custom: { top: '0', left: '0', right: '0', bottom: '0', alignItems: 'center', justifyContent: 'center', gap: '16px', background: backColor, pointerEvents: 'none' },
    }, [{ target: 'visible', expression: visibleExpr }]);
    const title = uiElement('text', `${name} Title`, {
      color: titleColor, fontSize: '54px', fontWeight: '800', textAlign: 'center',
      custom: { letterSpacing: '8px', textTransform: 'uppercase', textShadow: `0 0 32px ${titleColor}cc` },
    }, titleText);
    const sub = uiElement('text', `${name} Sub`, {
      color: 'rgba(226,238,255,0.9)', fontSize: '16px', fontWeight: '600', textAlign: 'center',
      custom: { letterSpacing: '2px' },
    }, subText);
    back.children = [title, sub];
    root.children = [back];
    extraUIDocs.push({ id: makeId('ui'), name, surface: 'screen', root, css: '', visibleOnStart: true, createdAt: Date.now() });
  };
  overlay('Mission Failed', 'Mission Failed', 'Press ENTER to redeploy', '#ff2bd6', 'rgba(12,2,8,0.74)', 'InMission >= 1 && Health <= 0');
  overlay('Mission Complete', 'Mission Complete', 'Press ENTER to return to base', '#39ff9e', 'rgba(2,12,7,0.72)', 'MissionStage >= 3');

  // Mission project variables (defaults match the guard count so the HUD reads right on frame 1).
  const healthVar: ProjectVariable = { id: healthVarId, name: 'Health', type: 'number', defaultValue: 100, persistent: false, createdAt: Date.now() };
  const stageVar: ProjectVariable = { id: stageVarId, name: 'MissionStage', type: 'number', defaultValue: 0, persistent: false, createdAt: Date.now() };
  const guardsLeftVar: ProjectVariable = { id: guardsLeftVarId, name: 'GuardsLeft', type: 'number', defaultValue: guardCount, persistent: false, createdAt: Date.now() };
  const guardsAliveVar: ProjectVariable = { id: guardsAliveVarId, name: 'GuardsAlive', type: 'number', defaultValue: guardCount, persistent: false, createdAt: Date.now() };
  const inMissionVar: ProjectVariable = { id: inMissionVarId, name: 'InMission', type: 'number', defaultValue: 0, persistent: false, createdAt: Date.now() };

  const hud = createFpsHud();

  // --- Commit everything atomically. ---
  useEditorStore.setState((draft) => ({
    animatorControllers: [...draft.animatorControllers, ...built.map((w) => w.controller)],
    activeAnimatorControllerId: built[0].controller.id,
    variables: [...draft.variables, weaponVar, slotVar, ammoVar, magVar, targetsLeftVar, targetsAliveVar, healthVar, stageVar, guardsLeftVar, guardsAliveVar, inMissionVar],
    blueprints: [...draft.blueprints, blueprint, ...extraBlueprints],
    graphs: [...draft.graphs, graph, ...extraGraphs],
    activeBlueprintId: blueprintId,
    uiDocuments: [...draft.uiDocuments, hud, ...extraUIDocs],
    activeUIDocumentId: hud.id,
    scenes: draft.scenes.map((scene) =>
      scene.id === draft.activeSceneId
        ? { ...scene, objects: [...scene.objects, ground, ...props, ...tutorialObjects, ...arms, pawn], cinematics: [...(scene.cinematics ?? []), finaleCinematic] }
        : scene.id === missionSceneId
          ? { ...scene, objects: [...scene.objects, ...missionObjects] }
          : scene,
    ),
    selectedObjectId: pawnId,
    isDirty: true,
  }));

  return pawnId;
}
