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

/** Crosshair + bottom-right weapon readout + a controls hint. The weapon name binds to the `Weapon` variable. */
const createFpsHud = (): UIDocument => {
  const root = uiElement('panel', 'Root', { width: '100%', height: '100%', position: 'relative', padding: '0' });
  const vignette = uiElement('panel', 'Vignette', {
    position: 'absolute', left: '0', top: '0', width: '100%', height: '100%',
    custom: { pointerEvents: 'none', background: 'radial-gradient(circle at center, transparent 55%, rgba(0,0,0,0.22) 100%)' },
  });
  // (No static crosshair element — the engine's DynamicCrosshair overlay draws a live CoD-style reticle
  // that spreads while moving and pops a hitmarker on hits.)
  // Bottom-right: weapon name + big ammo readout (Ammo / MagSize), turning red when empty.
  const weaponBox = uiElement('panel', 'Weapon Box', {
    position: 'absolute', display: 'flex', flexDirection: 'column',
    custom: { right: '26px', bottom: '22px', alignItems: 'flex-end', gap: '2px' },
  });
  const weaponName = boundElement('text', 'Weapon', {
    color: '#FFE082', fontSize: '16px', fontWeight: '700', textAlign: 'right',
    custom: { textShadow: '0 1px 6px rgba(0,0,0,0.7)' },
  }, [{ target: 'text', expression: `'🔫  ' + Weapon` }], '🔫  M416 Rifle');
  const ammo = boundElement('text', 'Ammo', {
    color: '#FFFFFF', fontSize: '30px', fontWeight: '800', textAlign: 'right',
    custom: { textShadow: '0 1px 8px rgba(0,0,0,0.8)' },
  }, [
    { target: 'text', expression: `MagSize > 0 ? Ammo + ' / ' + MagSize : '—'` },
    { target: 'color', expression: `Ammo == 0 && MagSize > 0 ? '#FF5A5F' : '#FFFFFF'` },
  ], '30 / 30');
  weaponBox.children = [weaponName, ammo];
  const hint = uiElement('text', 'Controls', {
    position: 'absolute', left: '50%', color: 'rgba(255,255,255,0.72)', fontSize: '12px', fontWeight: '500', textAlign: 'center',
    custom: { bottom: '20px', transform: 'translateX(-50%)', textShadow: '0 1px 4px rgba(0,0,0,0.7)' },
  }, '1-5 switch weapon · LMB fire · RMB aim · R reload · WASD move · Space jump');
  root.children = [vignette, weaponBox, hint];
  return { id: makeId('ui'), name: 'FPS HUD', surface: 'screen', root, css: '', visibleOnStart: true, createdAt: Date.now() };
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

interface ImportedRig {
  asset: AssetItem;
  mesh: SkeletalMeshAsset;
  clips: AnimationAsset[];
}

/** Import + split a rigged arm GLB (skeleton, skinned mesh, animations), reusing it if already imported. */
async function importArmRig(file: string, folderId?: string): Promise<ImportedRig | undefined> {
  const editor = useEditorStore.getState();
  let asset = editor.assets.find((a) => a.name === file && a.type === 'model');
  let mesh = asset ? editor.skeletalMeshes.find((m) => m.sourceAssetId === asset!.id) : undefined;

  if (!asset || !mesh) {
    const response = await fetch(`${ARMS_DIR}/${file}`);
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

  // Click to shoot — only guns (slots 1–3) fire, and only when there's ammo. Each shot spends a round.
  if (bulletTemplate) {
    const fireKey = add('Key Up: Mouse0', 'Events', 40, { nodeKind: 'event.keyUp', keyCode: 'Mouse0', hasInput: false, description: 'Fire on click.' });
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
      valueEdge(getSlot, slotCmp, 'a'), valueEdge(slotCmp, slotBranch, 'condition'), execEdge(fireKey, slotBranch),
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
      rollSpeed: 0,
      rollDuration: 0.1,
    },
    script: { blueprintId, graphId, enabled: true },
    variables: { health: 100 },
  };

  // --- Arena: an enclosed combat space with cover, crate stacks to climb, glowing neon accents, and
  //     destructible barrels. The dynamic muzzle/projectile/impact lights make the dim space pop. ---
  const props: SceneObject[] = [];
  interface PropOpts { modelAssetId?: string; emissive?: string; intensity?: number; dynamic?: boolean; health?: number; metalness?: number; roughness?: number; }
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
  accents.forEach((a, i) => prop(`Accent ${i + 1}`, a.p, [0.25, 3.2, 0.25], a.c, { emissive: a.c, intensity: 2.4 }));

  // Real point lights that actually illuminate the arena (colored to match the neon mood).
  const lights: Array<{ p: Vector3Tuple; c: string; i: number }> = [
    { p: [-10, 4, 6], c: '#27E0FF', i: 14 },
    { p: [10, 4, 16], c: '#FF8A3D', i: 14 },
    { p: [0, 4.5, 26], c: '#9bd0ff', i: 12 },
    { p: [0, 4, 2], c: '#ffd9a8', i: 10 },
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

  // Destructible explosive barrels (shoot them) — scattered as targets through the lane.
  const barrelSpots: Vector3Tuple[] = [[-4, 0.7, 9], [4.5, 0.7, 12], [-7, 0.7, 16], [0, 0.7, 18], [7, 0.7, 18], [-3, 0.7, 24], [3.5, 0.7, 27], [11, 0.7, 12]];
  barrelSpots.forEach((position, i) =>
    prop(`Barrel ${i + 1}`, position, [1, 1.2, 1], '#9a5b2d', { modelAssetId: barrelAsset?.id, health: 50, metalness: 0.4, roughness: 0.5 }),
  );

  // Loose kickable bricks for physics flavour near the spawn.
  const brickSpots: Vector3Tuple[] = [[-1.4, 0.4, 5.5], [-1.4, 1.0, 5.5], [-0.6, 0.4, 5.8], [0.4, 0.4, 5.5], [1.2, 0.4, 6]];
  brickSpots.forEach((position, i) =>
    prop(`Brick ${i + 1}`, position, [0.7, 0.5, 0.4], '#b5563f', { modelAssetId: brickAsset?.id, dynamic: true }),
  );

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
  );
  enEdges.push(
    execEdge(eUpdate, eBranchChase), execEdge(eUpdate, eBranchAtk),
    valueEdge(eDist, eCmpChase, 'a'), valueEdge(eCmpChase, eBranchChase, 'condition'), execEdge(eBranchChase, eMove), valueEdge(eDir, eMove, 'vector'),
    valueEdge(eDist, eCmpAtk, 'a'), valueEdge(eCmpAtk, eBranchAtk, 'condition'), execEdge(eBranchAtk, eFace), execEdge(eFace, eCool), execEdge(eCool, eShoot),
  );
  const enemyGraph: ProjectGraph = { id: enemyGraphId, name: 'Enemy AI', nodes: en, edges: enEdges };
  const enemyBlueprint: ScriptBlueprint = { id: enemyBpId, name: 'Enemy AI', description: 'Chase the player, then face + shoot on a cooldown.', graphId: enemyGraphId, color: '#FF5A5F', createdAt: Date.now() };

  const enemySpots: Vector3Tuple[] = [[-6, 1, 22], [6, 1, 24], [0, 1, 28]];
  const enemies: SceneObject[] = enemySpots.map((position, i) => ({
    id: makeId('obj'),
    name: `Enemy ${i + 1}`,
    kind: 'capsule',
    transform: { position, rotation: [0, 0, 0], scale: [1, 1, 1] },
    renderer: { ...defaultRenderer('capsule', '#e0484d'), metalness: 0.1, roughness: 0.5, materialOverrides: { emissiveColor: '#e0484d', emissiveIntensity: 0.45 } },
    character: { ...defaultCharacter(), enabled: true, moveSpeed: 2.8, sprintMultiplier: 1, jumpStrength: 0, cameraFollow: false, mouseLook: false },
    script: { blueprintId: enemyBpId, graphId: enemyGraphId, enabled: true },
    variables: { health: 60 },
  }));

  const hud = createFpsHud();

  // --- Commit everything atomically. ---
  useEditorStore.setState((draft) => ({
    animatorControllers: [...draft.animatorControllers, ...built.map((w) => w.controller)],
    activeAnimatorControllerId: built[0].controller.id,
    variables: [...draft.variables, weaponVar, slotVar, ammoVar, magVar],
    blueprints: [...draft.blueprints, blueprint, enemyBlueprint],
    graphs: [...draft.graphs, graph, enemyGraph],
    activeBlueprintId: blueprintId,
    uiDocuments: [...draft.uiDocuments, hud],
    activeUIDocumentId: hud.id,
    scenes: draft.scenes.map((scene) =>
      scene.id === draft.activeSceneId
        ? { ...scene, objects: [...scene.objects, ground, ...props, ...enemies, ...arms, ...(bulletTemplate ? [bulletTemplate] : []), pawn] }
        : scene,
    ),
    selectedObjectId: pawnId,
    isDirty: true,
  }));

  return pawnId;
}
