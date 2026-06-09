import * as THREE from 'three';
import { GLTFLoader } from 'three-stdlib';
import { getPlatform } from '../platform';
import { defaultVehicle, useEditorStore } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import { defaultSceneEnvironment } from '../three/environmentSettings';
import type { Edge } from '@xyflow/react';
import type {
  AssetItem,
  GraphNodeCategory,
  LightComponent,
  MeshRendererComponent,
  NodeForgeNode,
  NodeForgeNodeData,
  PhysicsComponent,
  ProjectGraph,
  ProjectVariable,
  SceneEnvironmentSettings,
  SceneObject,
  ScriptBlueprint,
  UIDocument,
  UIElement,
  VehicleComponent,
  Vector3Tuple,
} from '../types';

// ============================================================================================================
//  SIM-RACING TEMPLATE  —  "Proving Ground"
//  A playground for the REAL (raycast) vehicle physics: a Rapier DynamicRayCastVehicleController car (the
//  bundled GLB body + wheels) with per-wheel suspension, weight transfer, tire friction and true rollovers, on
//  a proper proving-ground track — start/finish straight, a kicker ramp + landing, a banked turn, a slalom of
//  knock-over cones, a smashable crate stack, light towers, grandstands, and a dusk sky with bloom. No scripts:
//  spawn and drive (W/S/A/D, Space handbrake, mouse-orbit chase cam).
//  Wheels use a STEERING-ANCHOR rig (anchor child = steer + suspension, wheel mesh under it = spin) so the
//  steering composes correctly — exactly like the driving template.
// ============================================================================================================

const makeId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

const CARS_DIR = 'templates/cars';
// High-quality car sounds generated with the ElevenLabs MCP tool, bundled under the sim-racing template.
const AUDIO_DIR = 'templates/sim-racing/Audio';
const CAR_BODY = 'CarModel2_body.glb';
const CAR_WHEEL = 'CarModel2_wheel.glb';

const renderer = (color: string, opts: Partial<MeshRendererComponent> = {}): MeshRendererComponent => ({
  enabled: true,
  mesh: 'cube',
  color,
  metalness: 0.2,
  roughness: 0.7,
  ...opts,
});

const fixedBox = (friction = 1): PhysicsComponent => ({
  enabled: true,
  bodyType: 'fixed',
  collider: 'box',
  isTrigger: false,
  collisionLayer: 0,
  collisionMask: 0xffff,
  mass: 1,
  gravityScale: 1,
  friction,
  linearDamping: 0,
  angularDamping: 0.05,
});

const triggerBox = (): PhysicsComponent => ({
  enabled: true,
  bodyType: 'fixed',
  collider: 'box',
  isTrigger: true,
  collisionLayer: 0,
  collisionMask: 0xffff,
  mass: 1,
  gravityScale: 0,
  friction: 0.5,
  linearDamping: 0,
  angularDamping: 0.05,
});

const dynamicBox = (mass: number): PhysicsComponent => ({
  enabled: true,
  bodyType: 'dynamic',
  collider: 'box',
  isTrigger: false,
  collisionLayer: 0,
  collisionMask: 0xffff,
  mass,
  gravityScale: 1,
  friction: 0.8,
  linearDamping: 0.05,
  angularDamping: 0.1,
});

/** A static cube (track / wall / ramp / curb). */
function staticBox(
  name: string,
  position: Vector3Tuple,
  scale: Vector3Tuple,
  color: string,
  opts: { rotation?: Vector3Tuple; emissive?: string; emissiveIntensity?: number; friction?: number; metalness?: number; roughness?: number } = {},
): SceneObject {
  return {
    id: makeId('obj'),
    name,
    kind: 'cube',
    transform: { position, rotation: opts.rotation ?? [0, 0, 0], scale },
    renderer: renderer(color, {
      metalness: opts.metalness ?? 0.1,
      roughness: opts.roughness ?? 0.9,
      ...(opts.emissive ? { materialOverrides: { emissiveColor: opts.emissive, emissiveIntensity: opts.emissiveIntensity ?? 1 } } : {}),
    }),
    physics: fixedBox(opts.friction ?? 1),
  };
}

/** A knock-over dynamic prop (cone / crate). */
function prop(name: string, position: Vector3Tuple, scale: Vector3Tuple, color: string, mass: number, emissive?: string): SceneObject {
  return {
    id: makeId('obj'),
    name,
    kind: 'cube',
    transform: { position, rotation: [0, 0, 0], scale },
    renderer: renderer(color, { roughness: 0.7, ...(emissive ? { materialOverrides: { emissiveColor: emissive, emissiveIntensity: 0.5 } } : {}) }),
    physics: dynamicBox(mass),
  };
}

// --- Visual-scripting + UI helpers (for the in-game speed menu). ---
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
  id, type: 'nodeforge', position: { x, y }, data: nodeData(label, category, data),
});
const execEdge = (source: string, target: string): Edge => ({ id: makeId('edge'), source, target, sourceHandle: 'exec-out', targetHandle: 'exec-in', type: 'smoothstep', animated: true });
const valueEdge = (source: string, target: string, targetHandle: string): Edge => ({ id: makeId('edge'), source, target, sourceHandle: 'value-out', targetHandle, type: 'smoothstep', style: { stroke: '#ff8a3d', strokeWidth: 2 } });
const uiText = (name: string, style: UIElement['style'], text: string, bindings: UIElement['bindings'] = []): UIElement => ({
  id: makeId('uiel'), kind: 'text', name, text, style, bindings, children: [],
});
const uiButton = (name: string, text: string, onClickEvent: string, style: UIElement['style']): UIElement => ({
  id: makeId('uiel'), kind: 'button', name, text, style, bindings: [], children: [], onClickEvent,
});
const uiPanel = (name: string, style: UIElement['style'], children: UIElement[]): UIElement => ({
  id: makeId('uiel'), kind: 'panel', name, style, bindings: [], children,
});

function pointLight(name: string, position: Vector3Tuple, color: string, intensity: number, distance: number): SceneObject {
  const light: LightComponent = { type: 'point', color, intensity, distance, angle: Math.PI / 4, castShadow: false };
  return { id: makeId('obj'), name, kind: 'light', transform: { position, rotation: [0, 0, 0], scale: [1, 1, 1] }, light };
}

// --- Asset import (re-use any already-imported clone so re-creating the template is idempotent). ---
async function importAsset(file: string, type: 'model' | 'audio', dir = CARS_DIR): Promise<AssetItem | undefined> {
  const existing = useEditorStore.getState().assets.find((a) => a.name === file && a.type === type);
  if (existing) return existing;
  const response = await fetch(`${dir}/${file}`);
  if (!response.ok) return undefined;
  const blob = await response.blob();
  const mime = type === 'model' ? 'model/gltf-binary' : 'audio/mpeg';
  const platformFile = new File([blob], file, { type: mime });
  const platform = await getPlatform();
  const projectDir = useProjectStore.getState().projectDir ?? 'web';
  const { path, url } = await platform.importAsset(projectDir, platformFile);
  const assetId = makeId('asset');
  const item: AssetItem = { id: assetId, name: file, type, size: platformFile.size, path, url, createdAt: Date.now() };
  useEditorStore.getState().addAssetItems([item]);
  return useEditorStore.getState().assets.find((a) => a.id === assetId);
}

interface ModelBounds { min: Vector3Tuple; max: Vector3Tuple }
async function measureModel(file: string): Promise<ModelBounds | undefined> {
  try {
    const response = await fetch(`${CARS_DIR}/${file}`);
    if (!response.ok) return undefined;
    const buffer = await response.arrayBuffer();
    const loader = new GLTFLoader();
    const gltf = await new Promise<{ scene: THREE.Object3D }>((resolve, reject) =>
      loader.parse(buffer, '', (g) => resolve(g as unknown as { scene: THREE.Object3D }), reject),
    );
    const b = new THREE.Box3().setFromObject(gltf.scene);
    if (!Number.isFinite(b.min.x) || !Number.isFinite(b.max.x)) return undefined;
    return { min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] };
  } catch {
    return undefined;
  }
}

/** Build the raycast-sim car from the bundled GLBs, with a steering-anchor wheel rig. */
async function buildSimCar(): Promise<{ carId: string; objects: SceneObject[] }> {
  const carId = makeId('obj');
  const bodyAsset = await importAsset(CAR_BODY, 'model');
  const wheelAsset = await importAsset(CAR_WHEEL, 'model');
  // Pre-import the OTHER bundled car bodies + wheel sets so they're ready to swap (Inspector Customize picker,
  // the customize_vehicle AI tool, AND the in-game GARAGE). garageBodyIds is the ordered carousel for the garage.
  const garageBodyIds: string[] = bodyAsset ? [bodyAsset.id] : [];
  for (const f of ['CarModel1_body.glb', 'CarModel3_body.glb', 'Ban_body.glb', 'Furgon1_body.glb']) {
    const a = await importAsset(f, 'model');
    if (a) garageBodyIds.push(a.id);
  }
  for (const f of ['CarModel1_wheel.glb', 'CarModel3_wheel.glb', 'Ban_wheel.glb', 'Furgon1_wheel.glb']) {
    await importAsset(f, 'model');
  }
  const engineSound = await importAsset('engine_loop.mp3', 'audio', AUDIO_DIR);
  const skidSound = await importAsset('skid_loop.mp3', 'audio', AUDIO_DIR);
  const brakeSound = await importAsset('brake.mp3', 'audio', AUDIO_DIR);
  const hornSound = await importAsset('horn.mp3', 'audio', AUDIO_DIR);
  const collisionSound = await importAsset('collision.mp3', 'audio', AUDIO_DIR);

  const bodyBox = await measureModel(CAR_BODY);
  const wheelBox = await measureModel(CAR_WHEEL);
  const min = bodyBox?.min ?? [-0.9, 0, -2];
  const max = bodyBox?.max ?? [0.9, 1.4, 2];
  const cx = (min[0] + max[0]) / 2;
  const cz = (min[2] + max[2]) / 2;
  const halfW = (max[0] - min[0]) / 2;
  const halfL = (max[2] - min[2]) / 2;
  const wheelRadius = wheelBox ? Math.max(wheelBox.max[1] - wheelBox.min[1], wheelBox.max[0] - wheelBox.min[0]) / 2 : 0.4;
  const sideX = halfW * 0.92;
  const frontZ = cz + halfL * 0.72;
  const rearZ = cz - halfL * 0.72;
  // Wheel rest CENTER at the model's bottom; spawn height (below) puts the wheels on the ground for traction.
  const wheelY = min[1];

  // STEERING-ANCHOR rig: anchor (empty, child of car) holds the corner + steer; wheel mesh sits under it at the
  // origin and only spins. wheelObjectIds = wheel meshes (spin); steeredWheelIds = FRONT anchor ids (steer).
  const spots: Array<{ x: number; z: number; front: boolean; tag: string }> = [
    { x: cx - sideX, z: frontZ, front: true, tag: 'FL' },
    { x: cx + sideX, z: frontZ, front: true, tag: 'FR' },
    { x: cx - sideX, z: rearZ, front: false, tag: 'RL' },
    { x: cx + sideX, z: rearZ, front: false, tag: 'RR' },
  ];
  const wheelIds: string[] = [];
  const steeredIds: string[] = [];
  const tireMarkIds: string[] = [];
  const wheelObjects: SceneObject[] = [];
  // Tire-mark emitters at the REAR contact patches — worldSpace dark specks that linger as skid marks on the
  // road; the runtime toggles them on only while the car is actually sliding/handbraking.
  ([[cx - sideX, rearZ], [cx + sideX, rearZ]] as Array<[number, number]>).forEach(([mx, mz], i) => {
    const id = makeId('obj');
    tireMarkIds.push(id);
    wheelObjects.push({
      id,
      name: `Tire Mark ${i ? 'R' : 'L'}`,
      kind: 'empty',
      parentId: carId,
      transform: { position: [mx, wheelY - wheelRadius + 0.04, mz], rotation: [0, 0, 0], scale: [1, 1, 1] },
      particles: {
        enabled: false,
        looping: true,
        rate: 120,
        burst: 0,
        maxParticles: 900,
        shape: 'disc',
        shapeRadius: Math.max(0.08, wheelRadius * 0.3),
        coneAngle: 6,
        speed: 0.01,
        speedJitter: 0.4,
        direction: [0, 1, 0] as Vector3Tuple,
        gravity: 0,
        drag: 1.4,
        lifetime: 14,
        lifetimeJitter: 0.2,
        startSize: Math.max(0.32, wheelRadius * 1.05),
        endSize: Math.max(0.4, wheelRadius * 1.3),
        startColor: '#070605',
        endColor: '#161210',
        startOpacity: 0.92,
        endOpacity: 0,
        worldSpace: true,
        blend: 'normal',
        light: false,
      },
    });
  });
  spots.forEach((spot) => {
    const anchorId = makeId('obj');
    const wheelId = makeId('obj');
    wheelIds.push(wheelId);
    if (spot.front) steeredIds.push(anchorId);
    wheelObjects.push({
      id: anchorId,
      name: `Wheel Anchor ${spot.tag}`,
      kind: 'empty',
      parentId: carId,
      transform: { position: [spot.x, wheelY, spot.z], rotation: [0, 0, 0], scale: [1, 1, 1] },
    });
    wheelObjects.push({
      id: wheelId,
      name: `Wheel ${spot.tag}`,
      kind: 'cube',
      parentId: anchorId,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      renderer: renderer('#14161b', { modelAssetId: wheelAsset?.id, metalness: 0.4, roughness: 0.6 }),
    });
  });

  // --- Car VFX: exhaust smoke, headlights, glowing brake lights, neon underglow + a roof accent. ---
  const cy = (min[1] + max[1]) / 2;
  const bodyH = max[1] - min[1];
  const vfx: SceneObject[] = [];
  const headlightIds: string[] = [];
  const brakeLightIds: string[] = [];
  const boostFlameIds: string[] = [];

  // Exhaust puffs out the back (worldSpace so they trail behind the car).
  ([-1, 1] as const).forEach((s, i) => {
    vfx.push({
      id: makeId('obj'),
      name: `Exhaust ${i ? 'R' : 'L'}`,
      kind: 'empty',
      parentId: carId,
      transform: { position: [cx + s * halfW * 0.35, min[1] + 0.18, min[2] * 0.98], rotation: [0, 0, 0], scale: [1, 1, 1] },
      particles: {
        enabled: true, looping: true, rate: 26, burst: 0, maxParticles: 240, shape: 'disc', shapeRadius: 0.06,
        coneAngle: 18, speed: 0.7, speedJitter: 0.5, direction: [0, 0.4, -1] as Vector3Tuple, gravity: -0.2, drag: 1.4,
        lifetime: 1.1, lifetimeJitter: 0.4, startSize: 0.18, endSize: 0.7, startColor: '#3a3a3a', endColor: '#101010',
        startOpacity: 0.5, endOpacity: 0, worldSpace: true, blend: 'normal', light: false,
      },
    });
  });

  // Nitro exhaust FLAMES (off until the Nitro var burns — toggled by the runtime). Bright additive jets.
  ([-1, 1] as const).forEach((s, i) => {
    const id = makeId('obj');
    boostFlameIds.push(id);
    vfx.push({
      id,
      name: `Boost Flame ${i ? 'R' : 'L'}`,
      kind: 'empty',
      parentId: carId,
      transform: { position: [cx + s * halfW * 0.35, min[1] + 0.18, min[2] * 1.02], rotation: [0, 0, 0], scale: [1, 1, 1] },
      particles: {
        enabled: false, looping: true, rate: 90, burst: 0, maxParticles: 260, shape: 'disc', shapeRadius: 0.05,
        coneAngle: 12, speed: 5, speedJitter: 0.4, direction: [0, 0.15, -1] as Vector3Tuple, gravity: 0, drag: 2.4,
        lifetime: 0.32, lifetimeJitter: 0.3, startSize: 0.34, endSize: 0.05, startColor: '#9fe8ff', endColor: '#ff7a18',
        startOpacity: 0.95, endOpacity: 0, worldSpace: false, blend: 'additive', light: true,
      },
    });
  });

  // Headlights: warm spot lights + emissive lens cubes at the front.
  ([-1, 1] as const).forEach((s, i) => {
    const lensId = makeId('obj');
    headlightIds.push(lensId);
    vfx.push({
      id: makeId('obj'),
      name: `Headlight ${i ? 'R' : 'L'}`,
      kind: 'light',
      parentId: carId,
      transform: { position: [cx + s * halfW * 0.62, cy, max[2] * 0.98], rotation: [-0.12, 0, 0], scale: [1, 1, 1] },
      light: { type: 'spot', color: '#fff1c4', intensity: 10, distance: 40, angle: Math.PI / 7, castShadow: false },
    });
    vfx.push({
      id: lensId,
      name: `Headlamp ${i ? 'R' : 'L'}`,
      kind: 'cube',
      parentId: carId,
      transform: { position: [cx + s * halfW * 0.62, cy, max[2] * 0.99], rotation: [0, 0, 0], scale: [0.28, 0.16, 0.08] },
      renderer: renderer('#fff4cf', { materialOverrides: { emissiveColor: '#fff4cf', emissiveIntensity: 2.2 } }),
    });
  });

  // Brake lights: emissive red cubes at the rear (runtime brightens them while braking).
  ([-1, 1] as const).forEach((s, i) => {
    const id = makeId('obj');
    brakeLightIds.push(id);
    vfx.push({
      id,
      name: `Brake Light ${i ? 'R' : 'L'}`,
      kind: 'cube',
      parentId: carId,
      transform: { position: [cx + s * halfW * 0.6, cy, min[2] * 0.99], rotation: [0, 0, 0], scale: [Math.max(0.14, halfW * 0.34), 0.14, 0.07] },
      renderer: renderer('#3a0c0c', { materialOverrides: { emissiveColor: '#ff2a2a', emissiveIntensity: 0.2 } }),
    });
  });

  // Neon underglow + a thin emissive roof accent (pure eye-candy with the bloom pass).
  vfx.push(pointLight('Underglow', [cx, min[1] - 0.05, cz], '#22e0ff', 7, 7));
  vfx.push({
    id: makeId('obj'),
    name: 'Underglow Strip',
    kind: 'cube',
    parentId: carId,
    transform: { position: [cx, min[1] + 0.02, cz], rotation: [0, 0, 0], scale: [halfW * 1.7, 0.04, halfL * 1.7] },
    renderer: renderer('#22e0ff', { materialOverrides: { emissiveColor: '#22e0ff', emissiveIntensity: 1.6 } }),
  });
  vfx.push({
    id: makeId('obj'),
    name: 'Roof Accent',
    kind: 'cube',
    parentId: carId,
    transform: { position: [cx, max[1] * 0.98, cz], rotation: [0, 0, 0], scale: [halfW * 0.5, 0.05, halfL * 1.2] },
    renderer: renderer('#ff2eea', { materialOverrides: { emissiveColor: '#ff2eea', emissiveIntensity: 1.8 } }),
  });

  const vehicle: VehicleComponent = {
    ...defaultVehicle(),
    enabled: true,
    physicsModel: 'raycast',
    cameraFollow: true,
    wheelRadius,
    wheelObjectIds: wheelIds,
    steeredWheelIds: steeredIds,
    tireMarkIds,
    boostFlameIds,
    garageBodyIds,
    deformable: true,
    headlightIds,
    brakeLightIds,
    // A fast, planted, grippy RWD car. Strong engine + low drag for a high top speed; low CoM so it leans
    // without flipping on flat ground, but a curb/ramp can still roll it.
    engineForce: 5600,
    brakeForce: 3600,
    handbrakeForce: 1700,
    drivetrain: 'awd',
    chassisMass: 1000,
    centerOfMassY: -0.6,
    linearDamping: 0.04,
    angularDamping: 1.1,
    wheelFrictionSlip: 2.3,
    sideFrictionStiffness: 1.5,
    suspensionRestLength: 0.42,
    suspensionStiffnessSim: 36,
    suspensionCompression: 0.9,
    suspensionRelaxation: 0.94,
    maxSuspensionForce: 38000,
    steerAngle: 0.55,
    engineSoundId: engineSound?.id,
    skidSoundId: skidSound?.id,
    brakeSoundId: brakeSound?.id,
    hornSoundId: hornSound?.id,
    collisionSoundId: collisionSound?.id,
    cameraOffset: [0, 2.6 + (max[1] - min[1]), -(halfL * 2 + 6)] as Vector3Tuple,
  };

  // Spawn so the wheel bottoms rest on the ground (y=0): wheel center wants to be radius above the floor, and
  // wheel center world = spawnY + wheelY, so spawnY = radius − wheelY (+ a small drop to settle into contact).
  const spawnY = wheelRadius - wheelY + 0.1;
  const car: SceneObject = {
    id: carId,
    name: 'Sim Car',
    kind: 'cube',
    transform: { position: [0, spawnY, -34], rotation: [0, 0, 0], scale: [1, 1, 1] },
    renderer: renderer('#d24b3c', { modelAssetId: bodyAsset?.id, metalness: 0.5, roughness: 0.45 }),
    // No Rapier physics component: the raycast vehicle controller builds its own dynamic chassis from the model.
    vehicle,
  };

  return { carId, objects: [car, ...wheelObjects, ...vfx] };
}

/** Build the in-game SPEED MENU: a HUD speedometer + −/+ buttons that adjust a "SpeedLevel" var (which the
 *  raycast car reads to scale its engine force), plus the blueprint that handles the button events. */
function buildSpeedMenu(): {
  speedLevelVar: ProjectVariable;
  speedVar: ProjectVariable;
  menuOpenVar: ProjectVariable;
  nitroVar: ProjectVariable;
  blueprint: ScriptBlueprint;
  graph: ProjectGraph;
  hud: UIDocument;
} {
  const now = Date.now();
  const speedLevelVar: ProjectVariable = { id: makeId('var'), name: 'SpeedLevel', type: 'number', defaultValue: 2, persistent: false, createdAt: now };
  const speedVar: ProjectVariable = { id: makeId('var'), name: 'Speed', type: 'number', defaultValue: 0, persistent: false, createdAt: now };
  // The speed-setup panel is hidden until this is flipped true (by pressing P) — its `visible` binding reads it.
  const menuOpenVar: ProjectVariable = { id: makeId('var'), name: 'MenuOpen', type: 'boolean', defaultValue: false, persistent: false, createdAt: now };
  // Hold SHIFT → Nitro = 1 (sustained while held); the raycast pass surges engine force and drains it back to 0.
  const nitroVar: ProjectVariable = { id: makeId('var'), name: 'Nitro', type: 'number', defaultValue: 0, persistent: false, createdAt: now };

  const graphId = makeId('graph');
  const bpId = makeId('bp');
  const mk = (label: string, cat: GraphNodeCategory, x: number, y: number, data: Partial<NodeForgeNodeData>) => graphNode(makeId('node'), label, cat, x, y, data);
  // Speed ±: each clamps SpeedLevel to 0..6 after ±1. (math.add = a + amount; math.clamp uses value/min(0)/max=amount.)
  const upEv = mk('On Speed Up', 'Events', 40, 40, { nodeKind: 'event.custom', eventName: 'speed_up', hasInput: false });
  const getU = mk('Get SpeedLevel', 'Variables', 300, 170, { nodeKind: 'variable.get', variableId: speedLevelVar.id, valueType: 'number', hasInput: false });
  const addU = mk('+ 1', 'Math', 540, 170, { nodeKind: 'math.add', amount: 1, hasInput: false });
  const clU = mk('Clamp 0..6', 'Math', 780, 170, { nodeKind: 'math.clamp', amount: 6, hasInput: false });
  const setU = mk('Set SpeedLevel', 'Variables', 540, 40, { nodeKind: 'variable.set', variableId: speedLevelVar.id, valueType: 'number' });
  const dnEv = mk('On Speed Down', 'Events', 40, 360, { nodeKind: 'event.custom', eventName: 'speed_down', hasInput: false });
  const getD = mk('Get SpeedLevel', 'Variables', 300, 490, { nodeKind: 'variable.get', variableId: speedLevelVar.id, valueType: 'number', hasInput: false });
  const addD = mk('- 1', 'Math', 540, 490, { nodeKind: 'math.add', amount: -1, hasInput: false });
  const clD = mk('Clamp 0..6', 'Math', 780, 490, { nodeKind: 'math.clamp', amount: 6, hasInput: false });
  const setD = mk('Set SpeedLevel', 'Variables', 540, 360, { nodeKind: 'variable.set', variableId: speedLevelVar.id, valueType: 'number' });
  // Toggle: press P → MenuOpen = !MenuOpen. event.keyDown is LEVEL-triggered (true EVERY frame held), so a
  // logic.cooldown debounces it to one flip per ~0.35s — a clean toggle for a quick tap, no flicker if held.
  const keyP = mk('Key Down: P', 'Events', 40, 680, { nodeKind: 'event.keyDown', keyCode: 'KeyP', hasInput: false });
  const cdO = mk('Debounce', 'Logic', 300, 680, { nodeKind: 'logic.cooldown', numberValue: 0.35 });
  const getO = mk('Get MenuOpen', 'Variables', 300, 820, { nodeKind: 'variable.get', variableId: menuOpenVar.id, valueType: 'boolean', hasInput: false });
  const notO = mk('Toggle', 'Logic', 560, 820, { nodeKind: 'logic.not', hasInput: false });
  const setO = mk('Set MenuOpen', 'Variables', 560, 680, { nodeKind: 'variable.set', variableId: menuOpenVar.id, valueType: 'boolean' });
  // Nitro: hold Shift → Nitro = 1 (level-triggered keyDown sustains it while held; the runtime drains it on release).
  const shiftEv = mk('Key Down: Shift', 'Events', 40, 980, { nodeKind: 'event.keyDown', keyCode: 'ShiftLeft', hasInput: false });
  const setN = mk('Set Nitro = 1', 'Variables', 300, 980, { nodeKind: 'variable.set', variableId: nitroVar.id, valueType: 'number', numberValue: 1 });
  const graph: ProjectGraph = {
    id: graphId,
    name: 'Speed Menu',
    nodes: [upEv, getU, addU, clU, setU, dnEv, getD, addD, clD, setD, keyP, cdO, getO, notO, setO, shiftEv, setN],
    edges: [
      execEdge(upEv.id, setU.id), valueEdge(getU.id, addU.id, 'a'), valueEdge(addU.id, clU.id, 'value'), valueEdge(clU.id, setU.id, 'value'),
      execEdge(dnEv.id, setD.id), valueEdge(getD.id, addD.id, 'a'), valueEdge(addD.id, clD.id, 'value'), valueEdge(clD.id, setD.id, 'value'),
      execEdge(keyP.id, cdO.id), execEdge(cdO.id, setO.id), valueEdge(getO.id, notO.id, 'value'), valueEdge(notO.id, setO.id, 'value'),
      execEdge(shiftEv.id, setN.id),
    ],
  };
  const blueprint: ScriptBlueprint = { id: bpId, name: 'Speed Menu', description: 'P toggles the speed setup; its −/+ buttons adjust SpeedLevel (engine power), clamped 0..6.', graphId, color: '#22e0ff', createdAt: now };

  // --- Compact HUD: a small always-on speedometer chip + a P-toggled "TOP SPEED" stepper above it. ---
  const btnStyle: UIElement['style'] = {
    width: '34px', height: '34px', background: '#22e0ff22', color: '#dffcff', fontSize: '20px', fontWeight: '800', borderRadius: '8px', textAlign: 'center',
    custom: { border: '1px solid #22e0ff88', cursor: 'pointer', boxShadow: '0 0 10px #22e0ff44', lineHeight: '1' },
  };
  // Always-on speedometer chip (small, bottom-center) + a hint to press P.
  const speedo = uiText('Speedometer', { color: '#ffffff', fontSize: '22px', fontWeight: '800', textAlign: 'center', custom: { lineHeight: '1', fontVariantNumeric: 'tabular-nums', textShadow: '0 0 10px #22e0ff88' } }, '0 KM/H', [{ target: 'text', expression: `Speed + ' KM/H'` }]);
  // Nitro charge bar (fill bound to the Nitro var, orange).
  const nitroBar: UIElement = {
    id: makeId('uiel'), kind: 'bar', name: 'Nitro Bar',
    style: { width: '130px', height: '5px', background: '#ffffff14', borderRadius: '3px', custom: { marginTop: '5px', border: '1px solid #ff8a3d55' } },
    bindings: [{ target: 'fill', expression: 'Nitro' }, { target: 'color', expression: `'#ff8a3d'` }], children: [],
  };
  const hint = uiText('Hint', { color: '#22e0ffcc', fontSize: '9px', fontWeight: '700', textAlign: 'center', custom: { letterSpacing: '2px', marginTop: '3px' } }, 'P SETUP · G GARAGE · SHIFT NITRO');
  const speedoChip = uiPanel('Speedo', { display: 'flex', flexDirection: 'column', alignItems: 'center', background: 'rgba(8,12,20,0.5)', borderRadius: '10px', custom: { padding: '5px 14px', border: '1px solid #22e0ff44', backdropFilter: 'blur(5px)' } }, [speedo, nitroBar, hint]);

  // Toggled setup chip (hidden until MenuOpen) with the −/+ stepper.
  const level = uiText('Speed Level', { color: '#ffeacc', fontSize: '13px', fontWeight: '800', textAlign: 'center', custom: { letterSpacing: '1px', minWidth: '120px' } }, 'TOP SPEED  Lv 2', [{ target: 'text', expression: `'TOP SPEED  Lv ' + SpeedLevel` }]);
  const minus = uiButton('Speed Down', '−', 'speed_down', btnStyle);
  minus.className = 'sim-speed-down';
  const plus = uiButton('Speed Up', '+', 'speed_up', btnStyle);
  plus.className = 'sim-speed-up';
  const row = uiPanel('Stepper', { display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: '10px' }, [minus, level, plus]);
  const setupChip = uiPanel('Speed Setup', {
    display: 'flex', flexDirection: 'column', alignItems: 'center', background: 'rgba(8,12,20,0.62)', borderRadius: '12px',
    custom: { padding: '8px 16px', border: '1px solid #22e0ff66', backdropFilter: 'blur(6px)', boxShadow: '0 0 18px #22e0ff33', marginBottom: '6px' },
  }, [row]);
  setupChip.bindings = [{ target: 'visible', expression: 'MenuOpen' }];

  const root = uiPanel('Sim HUD', {
    position: 'absolute', left: '50%', display: 'flex', flexDirection: 'column', alignItems: 'center',
    custom: { bottom: '22px', transform: 'translateX(-50%)', gap: '0px' },
  }, [setupChip, speedoChip]);
  const hud: UIDocument = { id: makeId('ui'), name: 'Sim Racing HUD', surface: 'screen', root, visibleOnStart: true, logicBlueprintId: bpId, createdAt: now };

  return { speedLevelVar, speedVar, menuOpenVar, nitroVar, blueprint, graph, hud };
}

/** A shared blueprint for boost pads: drive over the trigger → Nitro = 1 (the runtime surges + drains it). */
function buildBoostBlueprint(nitroVarId: string): { blueprint: ScriptBlueprint; graph: ProjectGraph } {
  const graphId = makeId('graph');
  const bpId = makeId('bp');
  const ev = graphNode(makeId('node'), 'On Drive Over', 'Events', 40, 40, { nodeKind: 'event.triggerEnter', hasInput: false });
  const set = graphNode(makeId('node'), 'Set Nitro = 1', 'Variables', 300, 40, { nodeKind: 'variable.set', variableId: nitroVarId, valueType: 'number', numberValue: 1 });
  const graph: ProjectGraph = { id: graphId, name: 'Boost Pad', nodes: [ev, set], edges: [execEdge(ev.id, set.id)] };
  const blueprint: ScriptBlueprint = { id: bpId, name: 'Boost Pad', description: 'Drive over → Nitro = 1 (engine-force surge that drains over ~2s).', graphId, color: '#ff8a3d', createdAt: Date.now() };
  return { blueprint, graph };
}

/** In-game GARAGE: a top-center panel (toggle with G) whose ◀/▶ cycle a "CarBody" var (0..4); the vehicle's
 *  garageBodyIds list maps that index to a body model the runtime swaps onto the chassis live. */
function buildGarage(): { carBodyVar: ProjectVariable; garageOpenVar: ProjectVariable; blueprint: ScriptBlueprint; graph: ProjectGraph; hud: UIDocument } {
  const now = Date.now();
  const carBodyVar: ProjectVariable = { id: makeId('var'), name: 'CarBody', type: 'number', defaultValue: 0, persistent: false, createdAt: now };
  const garageOpenVar: ProjectVariable = { id: makeId('var'), name: 'GarageOpen', type: 'boolean', defaultValue: false, persistent: false, createdAt: now };
  const graphId = makeId('graph');
  const bpId = makeId('bp');
  const mk = (label: string, cat: GraphNodeCategory, x: number, y: number, data: Partial<NodeForgeNodeData>) => graphNode(makeId('node'), label, cat, x, y, data);
  const nextEv = mk('On Car Next', 'Events', 40, 40, { nodeKind: 'event.custom', eventName: 'car_next', hasInput: false });
  const getN = mk('Get CarBody', 'Variables', 300, 170, { nodeKind: 'variable.get', variableId: carBodyVar.id, valueType: 'number', hasInput: false });
  const addN = mk('+ 1', 'Math', 540, 170, { nodeKind: 'math.add', amount: 1, hasInput: false });
  const clN = mk('Clamp 0..4', 'Math', 780, 170, { nodeKind: 'math.clamp', amount: 4, hasInput: false });
  const setN = mk('Set CarBody', 'Variables', 540, 40, { nodeKind: 'variable.set', variableId: carBodyVar.id, valueType: 'number' });
  const prevEv = mk('On Car Prev', 'Events', 40, 360, { nodeKind: 'event.custom', eventName: 'car_prev', hasInput: false });
  const getP = mk('Get CarBody', 'Variables', 300, 490, { nodeKind: 'variable.get', variableId: carBodyVar.id, valueType: 'number', hasInput: false });
  const addP = mk('- 1', 'Math', 540, 490, { nodeKind: 'math.add', amount: -1, hasInput: false });
  const clP = mk('Clamp 0..4', 'Math', 780, 490, { nodeKind: 'math.clamp', amount: 4, hasInput: false });
  const setP = mk('Set CarBody', 'Variables', 540, 360, { nodeKind: 'variable.set', variableId: carBodyVar.id, valueType: 'number' });
  const keyG = mk('Key Down: G', 'Events', 40, 680, { nodeKind: 'event.keyDown', keyCode: 'KeyG', hasInput: false });
  const cdG = mk('Debounce', 'Logic', 300, 680, { nodeKind: 'logic.cooldown', numberValue: 0.35 });
  const getG = mk('Get GarageOpen', 'Variables', 300, 820, { nodeKind: 'variable.get', variableId: garageOpenVar.id, valueType: 'boolean', hasInput: false });
  const notG = mk('Toggle', 'Logic', 560, 820, { nodeKind: 'logic.not', hasInput: false });
  const setG = mk('Set GarageOpen', 'Variables', 560, 680, { nodeKind: 'variable.set', variableId: garageOpenVar.id, valueType: 'boolean' });
  const graph: ProjectGraph = {
    id: graphId, name: 'Garage',
    nodes: [nextEv, getN, addN, clN, setN, prevEv, getP, addP, clP, setP, keyG, cdG, getG, notG, setG],
    edges: [
      execEdge(nextEv.id, setN.id), valueEdge(getN.id, addN.id, 'a'), valueEdge(addN.id, clN.id, 'value'), valueEdge(clN.id, setN.id, 'value'),
      execEdge(prevEv.id, setP.id), valueEdge(getP.id, addP.id, 'a'), valueEdge(addP.id, clP.id, 'value'), valueEdge(clP.id, setP.id, 'value'),
      execEdge(keyG.id, cdG.id), execEdge(cdG.id, setG.id), valueEdge(getG.id, notG.id, 'value'), valueEdge(notG.id, setG.id, 'value'),
    ],
  };
  const blueprint: ScriptBlueprint = { id: bpId, name: 'Garage', description: 'G toggles the garage; ◀/▶ cycle CarBody (the body model the chassis shows).', graphId, color: '#9b7bff', createdAt: now };

  const btnStyle: UIElement['style'] = {
    width: '38px', height: '38px', background: '#9b7bff22', color: '#eadfff', fontSize: '18px', fontWeight: '800', borderRadius: '8px', textAlign: 'center',
    custom: { border: '1px solid #9b7bff99', cursor: 'pointer', boxShadow: '0 0 10px #9b7bff44', lineHeight: '1' },
  };
  const title = uiText('Garage Title', { color: '#c8b6ff', fontSize: '10px', fontWeight: '800', textAlign: 'center', custom: { letterSpacing: '4px', marginBottom: '4px' } }, 'GARAGE');
  const name = uiText('Car Name', { color: '#ffffff', fontSize: '16px', fontWeight: '800', textAlign: 'center', custom: { minWidth: '110px', letterSpacing: '2px' } }, 'SPORT', [{ target: 'text', expression: `(CarBody == 0 ? 'SPORT' : CarBody == 1 ? 'COUPE' : CarBody == 2 ? 'MUSCLE' : CarBody == 3 ? 'BANGER' : 'VAN')` }]);
  const prevB = uiButton('Car Prev', '◀', 'car_prev', btnStyle); prevB.className = 'sim-car-prev';
  const nextB = uiButton('Car Next', '▶', 'car_next', btnStyle); nextB.className = 'sim-car-next';
  const row = uiPanel('Garage Row', { display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: '12px' }, [prevB, name, nextB]);
  const panel = uiPanel('Garage Panel', {
    display: 'flex', flexDirection: 'column', alignItems: 'center', background: 'rgba(14,10,24,0.66)', borderRadius: '12px',
    custom: { padding: '10px 18px', border: '1px solid #9b7bff66', backdropFilter: 'blur(6px)', boxShadow: '0 0 20px #9b7bff33' },
  }, [title, row]);
  panel.bindings = [{ target: 'visible', expression: 'GarageOpen' }];
  const root = uiPanel('Garage Root', { position: 'absolute', left: '50%', display: 'flex', flexDirection: 'column', alignItems: 'center', custom: { top: '20px', transform: 'translateX(-50%)' } }, [panel]);
  const hud: UIDocument = { id: makeId('ui'), name: 'Garage HUD', surface: 'screen', root, visibleOnStart: true, logicBlueprintId: bpId, createdAt: now };
  return { carBodyVar, garageOpenVar, blueprint, graph, hud };
}

/** Build the SIM-RACING "Proving Ground" into the (already-created) active project. */
export async function createSimRacingTemplate(): Promise<string> {
  const { carId, objects: carObjects } = await buildSimCar();
  const menu = buildSpeedMenu();
  const boost = buildBoostBlueprint(menu.nitroVar.id);
  const garage = buildGarage();
  const objects: SceneObject[] = [];

  // --- Track surface: a big asphalt pad with a brighter racing strip down the middle. ---
  objects.push(staticBox('Track', [0, -0.5, 0], [220, 1, 220], '#23262d', { friction: 1.3, roughness: 0.95 }));
  objects.push(staticBox('Racing Strip', [0, 0.01, 0], [16, 0.02, 150], '#2c3038', { roughness: 0.85 }));

  // --- Start / finish line (checker stripes). ---
  for (let i = -7; i <= 7; i++) {
    objects.push(staticBox(`Grid Stripe ${i}`, [i * 1.1, 0.03, -40], [0.9, 0.04, 2.2], i % 2 ? '#0a0a0a' : '#f2f2f2'));
  }

  // --- Red/white curbs lining the main straight. ---
  for (let i = 0; i < 20; i++) {
    const z = -38 + i * 4;
    const c = i % 2 ? '#d92b2b' : '#f2f2f2';
    objects.push(staticBox(`Curb L ${i}`, [-9, 0.12, z], [1, 0.24, 3.6], c, { emissive: c, emissiveIntensity: 0.25 }));
    objects.push(staticBox(`Curb R ${i}`, [9, 0.12, z], [1, 0.24, 3.6], c, { emissive: c, emissiveIntensity: 0.25 }));
  }

  // --- Kicker ramp + landing ramp (a jump). ---
  objects.push(staticBox('Kicker Ramp', [0, 0.8, 44], [11, 0.5, 10], '#2a2e38', { rotation: [-0.36, 0, 0] }));
  objects.push(staticBox('Landing Ramp', [0, 0.7, 58], [12, 0.5, 11], '#2a2e38', { rotation: [0.3, 0, 0] }));

  // --- Banked turn wall on the east side (drive up against it). ---
  objects.push(staticBox('Banked Turn', [28, 2.6, 20], [2, 7, 30], '#343a46', { rotation: [0, 0, -0.5] }));

  // --- Slalom of knock-over cones (between the rollers and the crest). ---
  for (let i = 0; i < 7; i++) {
    objects.push(prop(`Cone ${i}`, [(i % 2 ? 2.5 : -2.5), 0.5, -8 + i * 4], [0.5, 1, 0.5], '#ff7a18', 6, '#ff7a18'));
  }

  // --- BREAKABLE crate pyramid past the landing: dynamic boxes that SHATTER (fracture) when the car plows in.
  //     Boxes are 0.7 wide and spaced ≥0.9 apart (NO spawn overlap — overlapping boxes shove each other fast
  //     enough on the first frame to self-fracture), and the impact threshold is high so ONLY a fast car breaks
  //     them (idle settling stays well under it). 3-2-1 stack to keep the chunk count modest. ---
  const CRATE = 0.7;
  const crateRows = [
    [-0.95, 0, 0.95],
    [-0.48, 0.48],
    [0],
  ];
  crateRows.forEach((row, r) => {
    row.forEach((x, c) => {
      const crate = prop(`Crate ${r}-${c}`, [x, CRATE / 2 + r * (CRATE + 0.02), 76], [CRATE, CRATE, CRATE], '#9c6b3f', 8);
      crate.fracture = { enabled: true, pattern: 'chunks', pieces: 3, jitter: 0.4, seed: r * 4 + c + 1, strength: 3, impactThreshold: 13, focusImpact: true };
      objects.push(crate);
    });
  });
  // A row of breakable barrels guarding the crates (well separated; explode into chunks only on a fast hit).
  for (let i = -1; i <= 1; i++) {
    const barrel = prop(`Breakable Barrel ${i}`, [i * 3, 0.7, 68], [0.7, 1.4, 0.7], '#3f7fae', 12, '#3f7fae');
    barrel.fracture = { enabled: true, pattern: 'shatter', pieces: 4, jitter: 0.5, seed: 20 + i, strength: 4, impactThreshold: 15, focusImpact: true };
    objects.push(barrel);
  }

  // --- ROLLING section right off the start: a washboard of low wide rollers + a gentle crest, so the
  //     suspension visibly works the wheels before the slalom. ---
  for (let i = 0; i < 6; i++) {
    objects.push(staticBox(`Roller ${i}`, [0, 0.16, -30 + i * 2.6], [16, 0.32, 1.2], '#2a2e36', { roughness: 0.9 }));
  }
  objects.push(staticBox('Rolling Crest', [0, 0.6, 28], [16, 1.2, 7], '#2a2e36'));
  objects.push(staticBox('Crest Ramp In', [0, 0.32, 23.5], [16, 0.6, 4], '#2a2e36', { rotation: [-0.18, 0, 0] }));
  objects.push(staticBox('Crest Ramp Out', [0, 0.32, 32.5], [16, 0.6, 4], '#2a2e36', { rotation: [0.18, 0, 0] }));

  // --- Perimeter barriers so the car can bump and not drive off. ---
  objects.push(staticBox('Barrier N', [0, 1.2, 95], [200, 2.4, 2], '#3a4150'));
  objects.push(staticBox('Barrier S', [0, 1.2, -95], [200, 2.4, 2], '#3a4150'));
  objects.push(staticBox('Barrier E', [95, 1.2, 0], [2, 2.4, 200], '#3a4150'));
  objects.push(staticBox('Barrier W', [-95, 1.2, 0], [2, 2.4, 200], '#3a4150'));

  // --- Light towers at the four corners (mast + warm point light) for night-track glow + bloom. ---
  const corners: Vector3Tuple[] = [[60, 0, 60], [-60, 0, 60], [60, 0, -60], [-60, 0, -60]];
  corners.forEach((c, i) => {
    objects.push(staticBox(`Light Mast ${i}`, [c[0], 6, c[2]], [0.8, 12, 0.8], '#15171c', { metalness: 0.6, roughness: 0.4 }));
    objects.push(staticBox(`Light Head ${i}`, [c[0], 12, c[2]], [3, 0.6, 1.4], '#fff4cf', { emissive: '#fff4cf', emissiveIntensity: 2 }));
    objects.push(pointLight(`Tower Light ${i}`, [c[0], 12, c[2]], '#fff1c4', 22, 90));
  });

  // --- A small grandstand on the west side (stepped boxes) for scenery. ---
  for (let i = 0; i < 4; i++) {
    objects.push(staticBox(`Grandstand ${i}`, [-40, 1 + i * 1.2, -10 + i * 1.6], [3, 1, 40], '#2b2f38', { roughness: 0.95 }));
  }

  // --- SANDBOX TOYS ------------------------------------------------------------------------------------------
  // Boost pads: glowing trigger pads that fire the Boost Pad blueprint (drive over → Nitro = 1).
  ([[-3, 4], [3, 36], [0, -12]] as Array<[number, number]>).forEach(([px, pz], i) => {
    objects.push({
      id: makeId('obj'),
      name: `Boost Pad ${i}`,
      kind: 'cube',
      transform: { position: [px, 0.06, pz], rotation: [0, 0, 0], scale: [4, 0.12, 4] },
      renderer: renderer('#ff8a3d', { materialOverrides: { emissiveColor: '#ff8a3d', emissiveIntensity: 1.4 } }),
      physics: triggerBox(),
      script: { blueprintId: boost.blueprint.id, graphId: boost.graph.id, enabled: true },
    });
  });
  // Knock-around balls — dynamic spheres to bat across the pad (great with the CCD chassis).
  for (let i = 0; i < 7; i++) {
    objects.push({
      id: makeId('obj'),
      name: `Ball ${i}`,
      kind: 'sphere',
      transform: { position: [-18 + i * 6, 0.7, 40], rotation: [0, 0, 0], scale: [1.4, 1.4, 1.4] },
      renderer: renderer(['#e23b2e', '#2ecf6f', '#3f7fae', '#f2c53d'][i % 4], { roughness: 0.5, metalness: 0.1 }),
      physics: { ...dynamicBox(5), collider: 'sphere' },
    });
  }
  // A big launch ramp off to the side for jumps.
  objects.push(staticBox('Big Ramp', [-26, 1.4, -30], [12, 0.6, 16], '#2a2e38', { rotation: [-0.42, 0, 0] }));

  // Bowling stack — a pyramid of dynamic boxes to smash through (no fracture, just scatter).
  [[-0.8, 0.4, -0.8], [0, 0.4, -0.8], [0.8, 0.4, -0.8], [-0.4, 1.2, -0.8], [0.4, 1.2, -0.8], [0, 2.0, -0.8]].forEach((p, i) => {
    objects.push(prop(`Block ${i}`, [30 + p[0], p[1], 44 + p[2]], [0.7, 0.7, 0.7], '#caa23a', 6));
  });
  // Quarter-pipe wall to ride up / launch off.
  objects.push(staticBox('Quarter Pipe', [-28, 3, 22], [14, 8, 2], '#343a46', { rotation: [0.6, 0, 0] }));
  // Skid-pad cone ring (slalom / donut practice).
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    objects.push(prop(`Ring Cone ${i}`, [40 + Math.cos(a) * 12, 0.5, -36 + Math.sin(a) * 12], [0.5, 1, 0.5], '#ff7a18', 6, '#ff7a18'));
  }
  // A high platform reached by a ramp (a destination to aim for).
  objects.push(staticBox('Platform Ramp', [44, 1.6, 8], [8, 0.6, 14], '#2a2e38', { rotation: [-0.5, 0, 0] }));
  objects.push(staticBox('Platform', [44, 3.1, 20], [12, 0.6, 10], '#2b3340', { emissive: '#22e0ff', emissiveIntensity: 0.12 }));

  // A blueprint only RUNS if a scene object references it via `script` — add a holder so the HUD's −/+ button
  // events are actually handled (logicBlueprintId alone only wires the editor's UI Logic tab).
  objects.push({
    id: makeId('obj'),
    name: 'Speed Menu Logic',
    kind: 'empty',
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    script: { blueprintId: menu.blueprint.id, graphId: menu.graph.id, enabled: true },
  });
  objects.push({
    id: makeId('obj'),
    name: 'Garage Logic',
    kind: 'empty',
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    script: { blueprintId: garage.blueprint.id, graphId: garage.graph.id, enabled: true },
  });

  useEditorStore.setState((draft) => ({
    variables: [...draft.variables, menu.speedLevelVar, menu.speedVar, menu.menuOpenVar, menu.nitroVar, garage.carBodyVar, garage.garageOpenVar],
    blueprints: [...draft.blueprints, menu.blueprint, boost.blueprint, garage.blueprint],
    graphs: [...draft.graphs, menu.graph, boost.graph, garage.graph],
    uiDocuments: [...draft.uiDocuments, menu.hud, garage.hud],
    activeUIDocumentId: menu.hud.id,
    scenes: draft.scenes.map((scene) =>
      scene.id === draft.activeSceneId
        ? {
            ...scene,
            objects: [...scene.objects, ...objects, ...carObjects],
            environment: {
              ...defaultSceneEnvironment(),
              skyMode: 'procedural',
              // Warm golden-hour dusk: low sun, faint haze — reads great with the emissive curbs + light towers.
              skyTopColor: '#243b6b',
              skyHorizonColor: '#ffb066',
              skyGroundColor: '#1a1c22',
              sunColor: '#ffd9a0',
              sunIntensity: 2.4,
              sunElevation: 0.18,
              sunAzimuth: 2.2,
              fogEnabled: true,
              fogColor: '#caa9a7',
              fogNear: 60,
              fogFar: 320,
            } as SceneEnvironmentSettings,
          }
        : scene,
    ),
    selectedObjectId: carId,
    isDirty: true,
  }));

  // Bloom + vignette so the emissive curbs, grid, and light heads glow at dusk.
  useEditorStore.getState().updateRenderSettings({ bloomEnabled: true, bloomIntensity: 0.8, bloomThreshold: 0.6, bloomRadius: 0.7, vignetteEnabled: true });

  return carId;
}
