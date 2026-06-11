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
  VehicleWheelSetup,
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
// Exec edge from a NAMED source pin (Flip Flop's 'flip-a'/'flip-b', Sequence's 'then-0', …).
const execEdgeFrom = (source: string, sourceHandle: string, target: string): Edge => ({ id: makeId('edge'), source, target, sourceHandle, targetHandle: 'exec-in', type: 'smoothstep', animated: true });
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
async function buildSimCar(): Promise<{ carId: string; rainEmitterId: string; objects: SceneObject[] }> {
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
  // Modern explicit wheel rig: each wheel referenced WITH its role (axle/side/steered) — the physics
  // reads these, never array order. The legacy lists above are kept for older tooling/display.
  const wheelSetups: VehicleWheelSetup[] = [];
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
  const brakeDiscIds: string[] = [];
  spots.forEach((spot) => {
    const anchorId = makeId('obj');
    const wheelId = makeId('obj');
    wheelIds.push(wheelId);
    if (spot.front) steeredIds.push(anchorId);
    wheelSetups.push({
      objectId: wheelId,
      axle: spot.front ? 'front' : 'rear',
      side: spot.x < cx ? 'left' : 'right',
      steered: spot.front,
    });
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
    // Brake DISC: a thin dark plate inside the wheel, parented to the ANCHOR (steers + bobs, never spins).
    // The runtime drives its emissive with accumulated brake heat — hard stops from speed glow it orange.
    const discId = makeId('obj');
    brakeDiscIds.push(discId);
    wheelObjects.push({
      id: discId,
      name: `Brake Disc ${spot.tag}`,
      kind: 'cube',
      parentId: anchorId,
      // Tucked slightly inboard (toward the chassis center) so it peeks through the rim.
      transform: {
        position: [spot.x < cx ? 0.06 : -0.06, 0, 0],
        rotation: [0, 0, 0],
        scale: [0.05, wheelRadius * 1.1, wheelRadius * 1.1],
      },
      renderer: renderer('#1b1d22', { metalness: 0.8, roughness: 0.35, materialOverrides: { emissiveColor: '#ff5a1f', emissiveIntensity: 0 } }),
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

  // --- LOOSE crash parts: bumpers, a rear wing and side skirts that TEAR OFF on hard impacts (the part
  //     facing the hit goes first) and tumble away as real dynamic props. R-respawn bolts them back on. ---
  const loosePartIds: string[] = [];
  const loosePart = (name: string, position: Vector3Tuple, scale: Vector3Tuple, color = '#15171c') => {
    const id = makeId('obj');
    loosePartIds.push(id);
    vfx.push({
      id,
      name,
      kind: 'cube',
      parentId: carId,
      transform: { position, rotation: [0, 0, 0], scale },
      renderer: renderer(color, { metalness: 0.55, roughness: 0.45 }),
    });
  };
  const bumperY = min[1] + 0.24;
  loosePart('Front Bumper', [cx, bumperY, max[2] * 1.02], [halfW * 1.85, 0.16, 0.16]);
  loosePart('Rear Bumper', [cx, bumperY, min[2] * 1.02], [halfW * 1.85, 0.16, 0.16]);
  loosePart('Side Skirt L', [cx - halfW * 1.0, min[1] + 0.14, cz], [0.09, 0.12, halfL * 1.25]);
  loosePart('Side Skirt R', [cx + halfW * 1.0, min[1] + 0.14, cz], [0.09, 0.12, halfL * 1.25]);
  // Rear wing: a low spoiler plate riding the trunk lip — satisfying to lose on a rear-ender.
  loosePart('Rear Wing', [cx, max[1] * 0.92, min[2] * 0.9], [halfW * 1.35, 0.05, 0.3], '#1d2026');

  const vehicle: VehicleComponent = {
    ...defaultVehicle(),
    enabled: true,
    physicsModel: 'raycast',
    cameraFollow: true,
    wheelRadius,
    wheelObjectIds: wheelIds,
    steeredWheelIds: steeredIds,
    wheels: wheelSetups,
    tireMarkIds,
    boostFlameIds,
    garageBodyIds,
    deformable: true,
    headlightIds,
    brakeLightIds,
    brakeDiscIds,
    loosePartIds,
    // Onboard camera mounts (C cycles chase → hood → cockpit): measured from the body model so they sit
    // at the windshield base / driver's eye whatever body the garage swaps in later.
    hoodCameraOffset: [0, max[1] * 0.96, cz + halfL * 0.42] as Vector3Tuple,
    cockpitCameraOffset: [0, max[1] * 0.88, cz + halfL * 0.02] as Vector3Tuple,
    // ARCADE (NFS/Burnout) tune: punchy pickup + high top speed, planted on flat ground, AWD so it hooks up out
    // of corners — but holding Space breaks the rear loose for a controllable power-slide (engine drift assist).
    engineForce: 7800,
    brakeForce: 4100,
    handbrakeForce: 1500,
    drivetrain: 'awd',
    chassisMass: 950,
    centerOfMassY: -0.62,
    linearDamping: 0.02,
    // Lower yaw damping = the nose answers the wheel NOW; anti-roll bars + assists keep it from darting.
    angularDamping: 0.92,
    wheelFrictionSlip: 2.6,
    sideFrictionStiffness: 1.85,
    suspensionRestLength: 0.42,
    suspensionStiffnessSim: 38,
    suspensionCompression: 0.92,
    suspensionRelaxation: 0.95,
    maxSuspensionForce: 40000,
    steerAngle: 0.58,
    // Drive feel: light engine braking (lift-and-coast sets the nose for a corner without feeling draggy),
    // weight-transfer grip balance (trail-brake rotates, throttle plants the exit), and a firm counter-steer
    // assist so handbrake drifts stay catchable at this tune's speeds.
    engineBrakeForce: 750,
    loadSensitivity: 0.55,
    counterSteerAssist: 0.6,
    engineSoundId: engineSound?.id,
    skidSoundId: skidSound?.id,
    brakeSoundId: brakeSound?.id,
    hornSoundId: hornSound?.id,
    collisionSoundId: collisionSound?.id,
    cameraOffset: [0, 2.6 + (max[1] - min[1]), -(halfL * 2 + 6)] as Vector3Tuple,
  };

  // RAIN: a wide overhead streak emitter that travels WITH the car (parented), off until the in-game
  // weather toggle (M) switches it on via a Set Particles Emitting node. Streaks fall fast + die on the
  // ground so the sheet of rain always surrounds the player without flooding the whole map with particles.
  const rainEmitterId = makeId('obj');
  vfx.push({
    id: rainEmitterId,
    name: 'Rain',
    kind: 'empty',
    parentId: carId,
    transform: { position: [cx, max[1] + 9, cz], rotation: [0, 0, 0], scale: [1, 1, 1] },
    particles: {
      enabled: false,
      looping: true,
      rate: 420,
      burst: 0,
      maxParticles: 800,
      shape: 'disc',
      shapeRadius: 16,
      coneAngle: 2,
      speed: 17,
      speedJitter: 0.15,
      direction: [0, -1, 0] as Vector3Tuple,
      gravity: 0,
      drag: 0,
      lifetime: 0.62,
      lifetimeJitter: 0.1,
      startSize: 0.045,
      endSize: 0.035,
      startColor: '#a9c3da',
      endColor: '#7d93a8',
      startOpacity: 0.55,
      endOpacity: 0.25,
      worldSpace: true,
      blend: 'normal',
      light: false,
    },
  });

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

  return { carId, rainEmitterId, objects: [car, ...wheelObjects, ...vfx] };
}

/** A lean AI RIVAL: a bundled body + wheel set on the same raycast sim, driven by the engine's aiDriver
 *  autopilot around the "Checkpoint <n>" gates (no blueprint). Carries only brake lights, headlamp lenses
 *  and a team-color roof stripe — three of these race the player without the player car's full VFX cost. */
async function buildRivalCar(
  bodyFile: string,
  wheelFile: string,
  color: string,
  name: string,
  aiSkill: number,
  gridX: number,
  gridZ: number,
): Promise<SceneObject[]> {
  const carId = makeId('obj');
  const bodyAsset = await importAsset(bodyFile, 'model');
  const wheelAsset = await importAsset(wheelFile, 'model');
  const collisionSound = await importAsset('collision.mp3', 'audio', AUDIO_DIR);
  const bodyBox = await measureModel(bodyFile);
  const wheelBox = await measureModel(wheelFile);
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
  const wheelY = min[1];
  const cy = (min[1] + max[1]) / 2;

  // Same steering-anchor wheel rig as the player car (anchor steers + bobs, wheel mesh spins under it).
  const spots: Array<{ x: number; z: number; front: boolean; tag: string }> = [
    { x: cx - sideX, z: frontZ, front: true, tag: 'FL' },
    { x: cx + sideX, z: frontZ, front: true, tag: 'FR' },
    { x: cx - sideX, z: rearZ, front: false, tag: 'RL' },
    { x: cx + sideX, z: rearZ, front: false, tag: 'RR' },
  ];
  const wheelIds: string[] = [];
  const steeredIds: string[] = [];
  const wheelSetups: VehicleWheelSetup[] = [];
  const parts: SceneObject[] = [];
  spots.forEach((spot) => {
    const anchorId = makeId('obj');
    const wheelId = makeId('obj');
    wheelIds.push(wheelId);
    if (spot.front) steeredIds.push(anchorId);
    wheelSetups.push({ objectId: wheelId, axle: spot.front ? 'front' : 'rear', side: spot.x < cx ? 'left' : 'right', steered: spot.front });
    parts.push({
      id: anchorId,
      name: `Wheel Anchor ${spot.tag}`,
      kind: 'empty',
      parentId: carId,
      transform: { position: [spot.x, wheelY, spot.z], rotation: [0, 0, 0], scale: [1, 1, 1] },
    });
    parts.push({
      id: wheelId,
      name: `Wheel ${spot.tag}`,
      kind: 'cube',
      parentId: anchorId,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      renderer: renderer('#14161b', { modelAssetId: wheelAsset?.id, metalness: 0.4, roughness: 0.6 }),
    });
  });
  // Brake lights (the runtime brightens them while the autopilot brakes for a corner) + headlamp lenses
  // (emissive only — no spot lights, three rivals' worth would be a real lighting cost at night).
  const brakeLightIds: string[] = [];
  const headlightIds: string[] = [];
  ([-1, 1] as const).forEach((s, i) => {
    const brakeId = makeId('obj');
    brakeLightIds.push(brakeId);
    parts.push({
      id: brakeId,
      name: `Brake Light ${i ? 'R' : 'L'}`,
      kind: 'cube',
      parentId: carId,
      transform: { position: [cx + s * halfW * 0.6, cy, min[2] * 0.99], rotation: [0, 0, 0], scale: [Math.max(0.14, halfW * 0.34), 0.14, 0.07] },
      renderer: renderer('#3a0c0c', { materialOverrides: { emissiveColor: '#ff2a2a', emissiveIntensity: 0.2 } }),
    });
    const lensId = makeId('obj');
    headlightIds.push(lensId);
    parts.push({
      id: lensId,
      name: `Headlamp ${i ? 'R' : 'L'}`,
      kind: 'cube',
      parentId: carId,
      transform: { position: [cx + s * halfW * 0.62, cy, max[2] * 0.99], rotation: [0, 0, 0], scale: [0.28, 0.16, 0.08] },
      renderer: renderer('#fff4cf', { materialOverrides: { emissiveColor: '#fff4cf', emissiveIntensity: 1.6 } }),
    });
  });
  // Team-color roof stripe so you can tell who you're fighting at a glance (pops under bloom).
  parts.push({
    id: makeId('obj'),
    name: 'Team Stripe',
    kind: 'cube',
    parentId: carId,
    transform: { position: [cx, max[1] * 0.98, cz], rotation: [0, 0, 0], scale: [halfW * 0.5, 0.05, halfL * 1.2] },
    renderer: renderer(color, { materialOverrides: { emissiveColor: color, emissiveIntensity: 1.8 } }),
  });

  const vehicle: VehicleComponent = {
    ...defaultVehicle(),
    enabled: true,
    physicsModel: 'raycast',
    cameraFollow: false,
    aiDriver: true,
    aiSkill,
    aiRubberBand: 0.55,
    wheelRadius,
    wheelObjectIds: wheelIds,
    steeredWheelIds: steeredIds,
    wheels: wheelSetups,
    deformable: true,
    headlightIds,
    brakeLightIds,
    // Same baseline tune as the player car; pace differences come from aiSkill, not a faster engine.
    engineForce: 7400,
    brakeForce: 4100,
    handbrakeForce: 1500,
    drivetrain: 'awd',
    chassisMass: 950,
    centerOfMassY: -0.62,
    linearDamping: 0.02,
    angularDamping: 0.92,
    wheelFrictionSlip: 2.6,
    sideFrictionStiffness: 1.85,
    suspensionRestLength: 0.42,
    suspensionStiffnessSim: 38,
    suspensionCompression: 0.92,
    suspensionRelaxation: 0.95,
    maxSuspensionForce: 40000,
    steerAngle: 0.58,
    engineBrakeForce: 750,
    loadSensitivity: 0.55,
    counterSteerAssist: 0.6,
    transmission: 'auto',
    collisionSoundId: collisionSound?.id,
  };

  const spawnY = wheelRadius - wheelY + 0.1;
  parts.unshift({
    id: carId,
    name,
    kind: 'cube',
    // Grid slot, nose pointed down the start/finish straight (+X) like the player.
    transform: { position: [gridX, spawnY, gridZ], rotation: [0, Math.PI / 2, 0], scale: [1, 1, 1] },
    renderer: renderer(color, { modelAssetId: bodyAsset?.id, metalness: 0.5, roughness: 0.45 }),
    vehicle,
  });
  return parts;
}

/** Build the in-game SPEED MENU: a HUD speedometer + −/+ buttons that adjust a "SpeedLevel" var (which the
 *  raycast car reads to scale its engine force), plus the blueprint that handles the button events. */
function buildSpeedMenu(): {
  speedLevelVar: ProjectVariable;
  speedVar: ProjectVariable;
  menuOpenVar: ProjectVariable;
  nitroVar: ProjectVariable;
  damageVar: ProjectVariable;
  rpmVar: ProjectVariable;
  gearVar: ProjectVariable;
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
  // Bumped by the runtime on each crash dent — drives a HUD readout (and confirms damage detection is firing).
  const damageVar: ProjectVariable = { id: makeId('var'), name: 'Damage', type: 'number', defaultValue: 0, persistent: false, createdAt: now };
  // Drivetrain sim mirrors (written every frame by the runtime): live engine RPM + current gear ('R', '1'..'6').
  const rpmVar: ProjectVariable = { id: makeId('var'), name: 'RPM', type: 'number', defaultValue: 0, persistent: false, createdAt: now };
  const gearVar: ProjectVariable = { id: makeId('var'), name: 'Gear', type: 'string', defaultValue: '1', persistent: false, createdAt: now };

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
  // Gear digit + speed side by side, with a thin tachometer bar under them: the bar fills with RPM and
  // flashes red near the limiter — you can SHORT-SHIFT off it in manual (E/Q or gamepad Y/LB).
  const gearDigit = uiText('Gear', { color: '#ffd34d', fontSize: '22px', fontWeight: '900', textAlign: 'center', custom: { lineHeight: '1', minWidth: '22px', textShadow: '0 0 10px #ffd34d66' } }, '1', [{ target: 'text', expression: 'Gear' }]);
  const dialRow = uiPanel('Dial Row', { display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: '10px' }, [gearDigit, speedo]);
  const rpmBar: UIElement = {
    id: makeId('uiel'), kind: 'bar', name: 'Tachometer',
    style: { width: '130px', height: '4px', background: '#ffffff14', borderRadius: '2px', custom: { marginTop: '5px', border: '1px solid #22e0ff33' } },
    bindings: [
      { target: 'fill', expression: 'RPM / 7200' },
      { target: 'color', expression: `RPM > 6200 ? '#ff5d5d' : '#22e0ff'` },
    ],
    children: [],
  };
  // Nitro charge bar (fill bound to the Nitro var, orange).
  const nitroBar: UIElement = {
    id: makeId('uiel'), kind: 'bar', name: 'Nitro Bar',
    style: { width: '130px', height: '5px', background: '#ffffff14', borderRadius: '3px', custom: { marginTop: '5px', border: '1px solid #ff8a3d55' } },
    bindings: [{ target: 'fill', expression: 'Nitro' }, { target: 'color', expression: `'#ff8a3d'` }], children: [],
  };
  // Damage readout — rises on each crash dent (confirms damage is registering + a wreck meter).
  const damage = uiText('Damage', { color: '#ff7a6a', fontSize: '10px', fontWeight: '800', textAlign: 'center', custom: { letterSpacing: '2px', marginTop: '3px' } }, 'DMG 0', [{ target: 'text', expression: `'DMG ' + Damage` }]);
  const hint = uiText('Hint', { color: '#22e0ffcc', fontSize: '9px', fontWeight: '700', textAlign: 'center', custom: { letterSpacing: '2px', marginTop: '3px' } }, 'P SETUP · G GARAGE · SHIFT NITRO · C CAMERA · V LOOK BACK · N NIGHT · M RAIN · R RESET');
  const speedoChip = uiPanel('Speedo', { display: 'flex', flexDirection: 'column', alignItems: 'center', background: 'rgba(8,12,20,0.5)', borderRadius: '10px', custom: { padding: '5px 14px', border: '1px solid #22e0ff44', backdropFilter: 'blur(5px)' } }, [dialRow, rpmBar, nitroBar, damage, hint]);

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

  return { speedLevelVar, speedVar, menuOpenVar, nitroVar, damageVar, rpmVar, gearVar, blueprint, graph, hud };
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

/** NIGHT + RAIN toggles: N flips the dusk sky to deep night (suddenly the headlights/neon matter); M toggles
 *  a rainstorm — an overhead streak emitter that travels with the car, a soaked grey sky, AND a "Wet" project
 *  var the raycast sim reads as a GLOBAL grip multiplier (everything brakes longer and slides earlier). Both
 *  are Flip Flops so the same key toggles back, restoring the authored dusk. */
function buildTrackConditions(rainEmitterId: string): { wetVar: ProjectVariable; blueprint: ScriptBlueprint; graph: ProjectGraph } {
  const now = Date.now();
  const wetVar: ProjectVariable = { id: makeId('var'), name: 'Wet', type: 'number', defaultValue: 0, persistent: false, createdAt: now };
  const graphId = makeId('graph');
  const bpId = makeId('bp');
  const mk = (label: string, cat: GraphNodeCategory, x: number, y: number, data: Partial<NodeForgeNodeData>) => graphNode(makeId('node'), label, cat, x, y, data);
  // The authored golden-hour dusk (must mirror the scene environment literal below) — both Flip Flop "off"
  // branches restore it, so toggling night/rain off always lands back on the original look.
  const DUSK = { skyTopColor: '#243b6b', skyHorizonColor: '#ffb066', skyGroundColor: '#1a1c22', sunColor: '#ffd9a0', sunIntensity: 2.4, fogColor: '#caa9a7', fogNear: 60, fogFar: 320 };
  const NIGHT = { skyTopColor: '#070b18', skyHorizonColor: '#16233f', skyGroundColor: '#04060a', sunColor: '#9db5ff', sunIntensity: 0.35, fogColor: '#0a1020', fogNear: 40, fogFar: 230 };
  const RAIN = { skyTopColor: '#2a323c', skyHorizonColor: '#5c6873', skyGroundColor: '#14181d', sunColor: '#cfd8e2', sunIntensity: 0.9, fogColor: '#5b6670', fogNear: 35, fogFar: 200 };

  // NIGHT: N → debounce → Flip Flop → A = night sky, B = dusk restore.
  const keyN = mk('Key Down: N', 'Events', 40, 40, { nodeKind: 'event.keyDown', keyCode: 'KeyN', hasInput: false });
  const cdN = mk('Debounce', 'Logic', 280, 40, { nodeKind: 'logic.cooldown', numberValue: 0.4 });
  const ffN = mk('Night / Dusk', 'Logic', 520, 40, { nodeKind: 'logic.flipFlop' });
  const envNight = mk('Set Night Sky', 'Runtime', 780, 20, { nodeKind: 'action.setEnvironment', envPatch: NIGHT });
  const envDuskN = mk('Restore Dusk', 'Runtime', 780, 170, { nodeKind: 'action.setEnvironment', envPatch: DUSK });

  // RAIN: M → debounce → Flip Flop → A = Wet 1 → rain sky → emitter on; B = Wet 0 → dusk → emitter off.
  const keyM = mk('Key Down: M', 'Events', 40, 360, { nodeKind: 'event.keyDown', keyCode: 'KeyM', hasInput: false });
  const cdM = mk('Debounce', 'Logic', 280, 360, { nodeKind: 'logic.cooldown', numberValue: 0.4 });
  const ffM = mk('Rain / Dry', 'Logic', 520, 360, { nodeKind: 'logic.flipFlop' });
  const wetOn = mk('Set Wet = 1', 'Variables', 780, 340, { nodeKind: 'variable.set', variableId: wetVar.id, valueType: 'number', numberValue: 1 });
  const envRain = mk('Set Rain Sky', 'Runtime', 1020, 340, { nodeKind: 'action.setEnvironment', envPatch: RAIN });
  const rainOn = mk('Rain On', 'Runtime', 1260, 340, { nodeKind: 'action.setParticlesEmitting', targetObjectId: rainEmitterId, booleanValue: true });
  const wetOff = mk('Set Wet = 0', 'Variables', 780, 500, { nodeKind: 'variable.set', variableId: wetVar.id, valueType: 'number', numberValue: 0 });
  const envDuskM = mk('Restore Dusk', 'Runtime', 1020, 500, { nodeKind: 'action.setEnvironment', envPatch: DUSK });
  const rainOff = mk('Rain Off', 'Runtime', 1260, 500, { nodeKind: 'action.setParticlesEmitting', targetObjectId: rainEmitterId, booleanValue: false });

  const graph: ProjectGraph = {
    id: graphId,
    name: 'Track Conditions',
    nodes: [keyN, cdN, ffN, envNight, envDuskN, keyM, cdM, ffM, wetOn, envRain, rainOn, wetOff, envDuskM, rainOff],
    edges: [
      execEdge(keyN.id, cdN.id), execEdge(cdN.id, ffN.id),
      execEdgeFrom(ffN.id, 'flip-a', envNight.id), execEdgeFrom(ffN.id, 'flip-b', envDuskN.id),
      execEdge(keyM.id, cdM.id), execEdge(cdM.id, ffM.id),
      execEdgeFrom(ffM.id, 'flip-a', wetOn.id), execEdge(wetOn.id, envRain.id), execEdge(envRain.id, rainOn.id),
      execEdgeFrom(ffM.id, 'flip-b', wetOff.id), execEdge(wetOff.id, envDuskM.id), execEdge(envDuskM.id, rainOff.id),
    ],
  };
  const blueprint: ScriptBlueprint = {
    id: bpId,
    name: 'Track Conditions',
    description: 'N toggles night, M toggles rain (rain sets the Wet var — the sim slicks every wheel’s grip).',
    graphId,
    color: '#7da9ff',
    createdAt: now,
  };
  return { wetVar, blueprint, graph };
}

/** Score HUD: a top-right SCORE readout with a live "+N" COMBO chip under it (pending style points — they
 *  bank into Score after a second of clean driving and are LOST if you crash first), plus a center
 *  DRIFT!/BIG AIR!/PERFECT LAUNCH! banner. The runtime writes the Score/Combo/Stunt vars — no blueprint. */
function buildScoreHud(): { scoreVar: ProjectVariable; stuntVar: ProjectVariable; comboVar: ProjectVariable; hud: UIDocument } {
  const now = Date.now();
  const scoreVar: ProjectVariable = { id: makeId('var'), name: 'Score', type: 'number', defaultValue: 0, persistent: false, createdAt: now };
  const stuntVar: ProjectVariable = { id: makeId('var'), name: 'Stunt', type: 'number', defaultValue: 0, persistent: false, createdAt: now };
  const comboVar: ProjectVariable = { id: makeId('var'), name: 'Combo', type: 'number', defaultValue: 0, persistent: false, createdAt: now };
  const score = uiText('Score', {
    color: '#ffe08a', fontSize: '22px', fontWeight: '800', textAlign: 'right',
    position: 'absolute', custom: { top: '16px', right: '18px', letterSpacing: '1px', textShadow: '0 0 12px #ffb24788', fontVariantNumeric: 'tabular-nums' },
  }, 'SCORE 0', [{ target: 'text', expression: `'SCORE ' + Score` }]);
  // Pending combo: visible while style points are on the line — crash and it vanishes unbanked.
  const combo = uiText('Combo', {
    color: '#22e0ff', fontSize: '15px', fontWeight: '800', textAlign: 'right',
    position: 'absolute', custom: { top: '44px', right: '18px', letterSpacing: '1px', textShadow: '0 0 12px #22e0ff88', fontVariantNumeric: 'tabular-nums', fontStyle: 'italic' },
  }, '', [
    { target: 'text', expression: `'+' + Combo` },
    { target: 'visible', expression: `Combo > 0` },
  ]);
  const banner = uiText('Stunt Banner', {
    color: '#ff8a3d', fontSize: '40px', fontWeight: '800', textAlign: 'center',
    position: 'absolute', custom: { top: '74px', left: '50%', transform: 'translateX(-50%)', letterSpacing: '4px', textShadow: '0 0 18px #ff8a3daa' },
  }, '', [
    { target: 'text', expression: `(Stunt == 1 ? 'DRIFT!' : Stunt == 2 ? 'BIG AIR!' : Stunt == 3 ? 'PERFECT LAUNCH!' : '')` },
    { target: 'visible', expression: `Stunt > 0` },
  ]);
  const root = uiPanel('Score Root', { width: '100%', height: '100%', position: 'relative' }, [score, combo, banner]);
  const hud: UIDocument = { id: makeId('ui'), name: 'Score HUD', surface: 'screen', root, visibleOnStart: true, createdAt: now };
  return { scoreVar, stuntVar, comboVar, hud };
}

/** RACE CONTROL: the project vars the engine's race systems read/write (Lap/LapTime/BestLap/Checkpoint
 *  from the lap timer, Position from the rank pass, Draft from slipstream, Driving as the start gate), a
 *  3-2-1-GO countdown blueprint that holds the whole grid then waves it green, and the race HUD. */
function buildRaceControl(): { vars: ProjectVariable[]; blueprint: ScriptBlueprint; graph: ProjectGraph; hud: UIDocument } {
  const now = Date.now();
  const lapVar: ProjectVariable = { id: makeId('var'), name: 'Lap', type: 'number', defaultValue: 0, persistent: false, createdAt: now };
  const lapTimeVar: ProjectVariable = { id: makeId('var'), name: 'LapTime', type: 'number', defaultValue: 0, persistent: false, createdAt: now };
  const bestVar: ProjectVariable = { id: makeId('var'), name: 'BestLap', type: 'number', defaultValue: 0, persistent: false, createdAt: now };
  const checkpointVar: ProjectVariable = { id: makeId('var'), name: 'Checkpoint', type: 'number', defaultValue: 0, persistent: false, createdAt: now };
  const positionVar: ProjectVariable = { id: makeId('var'), name: 'Position', type: 'number', defaultValue: 1, persistent: false, createdAt: now };
  // Gate for ALL driving input (player keys and AI throttle): 0 during the countdown, 1 at the green.
  const drivingVar: ProjectVariable = { id: makeId('var'), name: 'Driving', type: 'number', defaultValue: 0, persistent: false, createdAt: now };
  // Countdown display state: 3 / 2 / 1 / 0 (= GO!) / -1 (= hidden).
  const countVar: ProjectVariable = { id: makeId('var'), name: 'Count', type: 'number', defaultValue: -1, persistent: false, createdAt: now };
  // Slipstream tow strength 0..1, mirrored by the sim for the player car (drives the SLIPSTREAM chip).
  const draftVar: ProjectVariable = { id: makeId('var'), name: 'Draft', type: 'number', defaultValue: 0, persistent: false, createdAt: now };

  const graphId = makeId('graph');
  const bpId = makeId('bp');
  const mk = (label: string, cat: GraphNodeCategory, x: number, y: number, data: Partial<NodeForgeNodeData>) => graphNode(makeId('node'), label, cat, x, y, data);
  const setCount = (label: string, x: number, value: number) => mk(label, 'Variables', x, 40, { nodeKind: 'variable.set', variableId: countVar.id, valueType: 'number', numberValue: value });
  const wait = (label: string, x: number, secs: number) => mk(label, 'Logic', x, 40, { nodeKind: 'logic.delay', numberValue: secs });
  const start = mk('On Race Start', 'Events', 40, 40, { nodeKind: 'event.start', hasInput: false });
  const c3 = setCount('Count = 3', 280, 3);
  const w3 = wait('1s', 520, 1);
  const c2 = setCount('Count = 2', 760, 2);
  const w2 = wait('1s', 1000, 1);
  const c1 = setCount('Count = 1', 1240, 1);
  const w1 = wait('1s', 1480, 1);
  const go = setCount('Count = GO', 1720, 0);
  const green = mk('Driving = 1', 'Variables', 1960, 40, { nodeKind: 'variable.set', variableId: drivingVar.id, valueType: 'number', numberValue: 1 });
  const wGo = wait('1.2s', 2200, 1.2);
  const hide = setCount('Hide Count', 2440, -1);
  const graph: ProjectGraph = {
    id: graphId,
    name: 'Race Control',
    nodes: [start, c3, w3, c2, w2, c1, w1, go, green, wGo, hide],
    edges: [
      execEdge(start.id, c3.id), execEdge(c3.id, w3.id), execEdge(w3.id, c2.id), execEdge(c2.id, w2.id),
      execEdge(w2.id, c1.id), execEdge(c1.id, w1.id), execEdge(w1.id, go.id), execEdge(go.id, green.id),
      execEdge(green.id, wGo.id), execEdge(wGo.id, hide.id),
    ],
  };
  const blueprint: ScriptBlueprint = {
    id: bpId,
    name: 'Race Control',
    description: '3-2-1-GO countdown: holds the grid (Driving = 0 gates player keys AND the AI rivals), then waves it green.',
    graphId,
    color: '#2ecf6f',
    createdAt: now,
  };

  // --- Race HUD: position + lap board (top-left), countdown banner (center), slipstream chip. ---
  const pos = uiText('Race Position', {
    color: '#ffffff', fontSize: '30px', fontWeight: '900', textAlign: 'left',
    custom: { letterSpacing: '1px', textShadow: '0 0 14px #2ecf6f88', fontVariantNumeric: 'tabular-nums', lineHeight: '1' },
  }, 'POS 4/4', [{ target: 'text', expression: `'POS ' + Position + '/4'` }]);
  const lap = uiText('Lap Readout', { color: '#c9f7da', fontSize: '13px', fontWeight: '800', textAlign: 'left', custom: { letterSpacing: '2px', marginTop: '5px', fontVariantNumeric: 'tabular-nums' } }, 'LAP 1', [
    { target: 'text', expression: `'LAP ' + (Lap < 1 ? 1 : Lap)` },
  ]);
  const time = uiText('Lap Time', { color: '#9fe8ff', fontSize: '12px', fontWeight: '700', textAlign: 'left', custom: { letterSpacing: '2px', marginTop: '3px', fontVariantNumeric: 'tabular-nums' } }, 'TIME 0s', [
    { target: 'text', expression: `'TIME ' + LapTime + 's'` },
  ]);
  const best = uiText('Best Lap', { color: '#ffd34d', fontSize: '12px', fontWeight: '800', textAlign: 'left', custom: { letterSpacing: '2px', marginTop: '3px', fontVariantNumeric: 'tabular-nums' } }, '', [
    { target: 'text', expression: `'BEST ' + BestLap + 's'` },
    { target: 'visible', expression: 'BestLap > 0' },
  ]);
  const board = uiPanel('Race Board', {
    position: 'absolute', display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
    background: 'rgba(8,16,12,0.55)', borderRadius: '12px',
    custom: { top: '16px', left: '18px', padding: '10px 16px', border: '1px solid #2ecf6f55', backdropFilter: 'blur(6px)', boxShadow: '0 0 18px #2ecf6f22' },
  }, [pos, lap, time, best]);
  const countdown = uiText('Countdown', {
    color: '#ffd34d', fontSize: '84px', fontWeight: '900', textAlign: 'center', position: 'absolute',
    custom: { top: '30%', left: '50%', transform: 'translateX(-50%)', letterSpacing: '6px', textShadow: '0 0 30px #ffd34daa', lineHeight: '1' },
  }, '', [
    { target: 'text', expression: `(Count == 3 ? '3' : Count == 2 ? '2' : Count == 1 ? '1' : Count == 0 ? 'GO!' : '')` },
    { target: 'visible', expression: 'Count >= 0' },
  ]);
  const slip = uiText('Slipstream Chip', {
    color: '#22e0ff', fontSize: '14px', fontWeight: '800', textAlign: 'center', position: 'absolute',
    custom: { top: '58%', left: '50%', transform: 'translateX(-50%)', letterSpacing: '4px', textShadow: '0 0 16px #22e0ffcc', fontStyle: 'italic' },
  }, 'SLIPSTREAM', [{ target: 'visible', expression: 'Draft > 0.05' }]);
  const root = uiPanel('Race Root', { width: '100%', height: '100%', position: 'relative' }, [board, countdown, slip]);
  const hud: UIDocument = { id: makeId('ui'), name: 'Race HUD', surface: 'screen', root, visibleOnStart: true, createdAt: now };

  return {
    vars: [lapVar, lapTimeVar, bestVar, checkpointVar, positionVar, drivingVar, countVar, draftVar],
    blueprint,
    graph,
    hud,
  };
}

// The neon circuit: an octagonal loop around the proving-ground perimeter (the playground toys stay
// in the infield). Checkpoint 0 is the start/finish on the south straight; the engine's lap timer AND
// the AI rivals both read these gates, so this one list is the whole race.
const CIRCUIT: Array<[number, number]> = [
  [0, -78],
  [55, -55],
  [78, 0],
  [55, 55],
  [0, 78],
  [-55, 55],
  [-78, 0],
  [-60, -78],
];

/** Build the circuit: checkpoint gates with glowing arches, a dark ribbon of track with neon edge lines,
 *  a start/finish checker line, and two on-line boost pads (nitro strategy: hold it for the straights). */
function buildCircuit(boost: { blueprint: ScriptBlueprint; graph: ProjectGraph }): SceneObject[] {
  const objects: SceneObject[] = [];
  CIRCUIT.forEach(([x, z], i) => {
    // The functional gate the engine reads (lap timer + AI driving line).
    objects.push({
      id: makeId('obj'),
      name: `Checkpoint ${i}`,
      kind: 'empty',
      transform: { position: [x, 0.5, z], rotation: [0, 0, 0], scale: [1, 1, 1] },
    });
    // Visual arch: posts straddle the ribbon radially (the loop circles the origin), crossbar overhead.
    const r = Math.hypot(x, z) || 1;
    const rx = x / r;
    const rz = z / r;
    const accent = i === 0 ? '#ff2eea' : '#22e0ff';
    for (const s of [-1, 1] as const) {
      objects.push(staticBox(`Gate ${i} Post ${s < 0 ? 'In' : 'Out'}`, [x + rx * 7.5 * s, 2.3, z + rz * 7.5 * s], [0.5, 4.6, 0.5], '#15171c', { metalness: 0.6, roughness: 0.4, emissive: accent, emissiveIntensity: 0.5 }));
    }
    const bar: SceneObject = {
      id: makeId('obj'),
      name: `Gate ${i} Arch`,
      kind: 'cube',
      transform: { position: [x, 4.8, z], rotation: [0, Math.atan2(rx, rz), 0], scale: [0.45, 0.4, 16] },
      renderer: renderer(accent, { materialOverrides: { emissiveColor: accent, emissiveIntensity: 1.8 } }),
    };
    objects.push(bar);
    // Ribbon segment to the NEXT gate (visual only — the asphalt pad below does the physics), with neon
    // edge lines so the line through dusk/night/rain is always readable.
    const [nx, nz] = CIRCUIT[(i + 1) % CIRCUIT.length];
    const dx = nx - x;
    const dz = nz - z;
    const len = Math.hypot(dx, dz);
    const yaw = Math.atan2(dx, dz);
    const midX = x + dx / 2;
    const midZ = z + dz / 2;
    objects.push({
      id: makeId('obj'),
      name: `Track Ribbon ${i}`,
      kind: 'cube',
      transform: { position: [midX, 0.02, midZ], rotation: [0, yaw, 0], scale: [13, 0.02, len + 8] },
      renderer: renderer('#272b34', { roughness: 0.9 }),
    });
    const px = Math.cos(yaw);
    const pz = -Math.sin(yaw);
    for (const s of [-1, 1] as const) {
      objects.push({
        id: makeId('obj'),
        name: `Track Edge ${i}${s < 0 ? 'L' : 'R'}`,
        kind: 'cube',
        transform: { position: [midX + px * 6.5 * s, 0.03, midZ + pz * 6.5 * s], rotation: [0, yaw, 0], scale: [0.3, 0.025, len + 6] },
        renderer: renderer('#22e0ff', { materialOverrides: { emissiveColor: '#22e0ff', emissiveIntensity: 0.7 } }),
      });
    }
  });
  // Start/finish checker line across the south straight at Checkpoint 0.
  for (let i = -5; i <= 5; i++) {
    objects.push(staticBox(`Start Stripe ${i + 5}`, [0, 0.045, -78 + i * 1.15], [2.4, 0.03, 0.95], i % 2 ? '#0a0a0a' : '#f2f2f2'));
  }
  // Two boost pads ON the racing line — grab the tow, hit the pad, send it down the straight.
  ([[-15, -78], [27.5, 66.5]] as Array<[number, number]>).forEach(([px2, pz2], i) => {
    objects.push({
      id: makeId('obj'),
      name: `Circuit Boost ${i}`,
      kind: 'cube',
      transform: { position: [px2, 0.06, pz2], rotation: [0, 0, 0], scale: [4, 0.12, 4] },
      renderer: renderer('#ff8a3d', { materialOverrides: { emissiveColor: '#ff8a3d', emissiveIntensity: 1.4 } }),
      physics: triggerBox(),
      script: { blueprintId: boost.blueprint.id, graphId: boost.graph.id, enabled: true },
    });
  });
  return objects;
}

/** Build the SIM-RACING "Proving Ground" into the (already-created) active project. */
export async function createSimRacingTemplate(): Promise<string> {
  const { carId, rainEmitterId, objects: carObjects } = await buildSimCar();
  const menu = buildSpeedMenu();
  const boost = buildBoostBlueprint(menu.nitroVar.id);
  const garage = buildGarage();
  const score = buildScoreHud();
  const conditions = buildTrackConditions(rainEmitterId);
  const objects: SceneObject[] = [];

  // --- Track surface: a big asphalt pad with a brighter racing strip down the middle. ---
  objects.push(staticBox('Track', [0, -0.5, 0], [220, 1, 220], '#23262d', { friction: 1.3, roughness: 0.95 }));
  objects.push(staticBox('Racing Strip', [0, 0.01, 0], [16, 0.02, 150], '#2c3038', { roughness: 0.85 }));

  // --- Start / finish line (checker stripes). ---
  for (let i = -7; i <= 7; i++) {
    objects.push(staticBox(`Grid Stripe ${i}`, [i * 1.1, 0.03, -40], [0.9, 0.04, 2.2], i % 2 ? '#0a0a0a' : '#f2f2f2'));
  }

  // --- Red/white curbs lining the main straight. Tagged `surface: curb` — the sim's per-wheel surface
  //     grip reads the tag, so riding a curb costs a little bite (and grass/sand cost a LOT, below). ---
  for (let i = 0; i < 20; i++) {
    const z = -38 + i * 4;
    const c = i % 2 ? '#d92b2b' : '#f2f2f2';
    const curbL = staticBox(`Curb L ${i}`, [-9, 0.12, z], [1, 0.24, 3.6], c, { emissive: c, emissiveIntensity: 0.25 });
    const curbR = staticBox(`Curb R ${i}`, [9, 0.12, z], [1, 0.24, 3.6], c, { emissive: c, emissiveIntensity: 0.25 });
    curbL.variables = { surface: 'curb' };
    curbR.variables = { surface: 'curb' };
    objects.push(curbL, curbR);
  }

  // --- Low-grip runoff surfaces (the sim's per-wheel surface grip): grass verges past the curbs along the
  //     straight, and a sand trap past the slalom — run wide and the car washes out until you're back on
  //     tarmac. Thin slabs sitting just on top of the pad. ---
  const grassL = staticBox('Grass Verge L', [-16.5, 0.015, -4], [13, 0.03, 84], '#2c5a30', { roughness: 1 });
  const grassR = staticBox('Grass Verge R', [16.5, 0.015, -4], [13, 0.03, 84], '#2c5a30', { roughness: 1 });
  grassL.variables = { surface: 'grass' };
  grassR.variables = { surface: 'grass' };
  const sandTrap = staticBox('Sand Trap', [-22, 0.015, 30], [16, 0.03, 18], '#cfb377', { roughness: 1 });
  sandTrap.variables = { surface: 'sand' };
  objects.push(grassL, grassR, sandTrap);

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

  // --- REACTIVE TOYS: everything below DOES something back — explosive barrel chains, car football
  //     with a scoring goal, a rotating sweeper hazard, a Tween-driven piston gate, an air ring worth
  //     +100 through the jump, and a domino run. All ordinary blueprints — open + remix them. ---
  const mkNode = (label: string, cat: GraphNodeCategory, x: number, y: number, data: Partial<NodeForgeNodeData>) =>
    graphNode(makeId('node'), label, cat, x, y, data);
  /** Exec edge leaving a Tween's "Done" pin (fires when the animation completes). */
  const doneEdge = (source: string, target: string): Edge => ({
    id: makeId('edge'), source, target, sourceHandle: 'exec-done', targetHandle: 'exec-in', type: 'smoothstep', animated: true,
  });

  // 1) EXPLOSIVE BARRELS — ram one and it detonates; the blast damages its neighbours, which chain
  //    via On Receive Damage (Explode notifies every damageable object in radius automatically).
  const barrelGraphId = makeId('graph');
  const barrelBp: ScriptBlueprint = {
    id: makeId('bp'), name: 'Explosive Barrel', graphId: barrelGraphId, color: '#ff4d2e', createdAt: Date.now(),
    description: 'Car contact OR splash damage → Explode (chain reactions) → Destroy. Do Once stops a double-fire.',
  };
  const barrelGraph: ProjectGraph = (() => {
    const hitEv = mkNode('On Car Hit', 'Events', 40, 40, { nodeKind: 'event.collisionEnter', otherObjectId: carId, hasInput: false });
    const dmgEv = mkNode('On Damaged', 'Events', 40, 220, { nodeKind: 'event.receiveDamage', hasInput: false });
    const once = mkNode('Do Once', 'Logic', 300, 130, { nodeKind: 'logic.doOnce' });
    const boom = mkNode('Explode', 'Physics', 540, 130, { nodeKind: 'action.explode', explodeRadius: 7, explodeForce: 22, explodeDamage: 45 });
    const gone = mkNode('Destroy Self', 'Runtime', 780, 130, { nodeKind: 'action.destroyObject' });
    return {
      id: barrelGraphId, name: 'Explosive Barrel',
      nodes: [hitEv, dmgEv, once, boom, gone],
      edges: [execEdge(hitEv.id, once.id), execEdge(dmgEv.id, once.id), execEdge(once.id, boom.id), execEdge(boom.id, gone.id)],
    };
  })();
  // Two clusters: a tight chain-reaction trio and a spread quartet along the east run.
  [[-14, 52], [-12, 55], [-15.5, 56], [22, 0], [26, -6], [24, 8], [20, 14]].forEach(([bx, bz], i) => {
    objects.push({
      id: makeId('obj'),
      name: `Boom Barrel ${i}`,
      kind: 'capsule',
      transform: { position: [bx, 1, bz], rotation: [0, 0, 0], scale: [0.9, 1.4, 0.9] },
      renderer: renderer('#c92f1d', { metalness: 0.35, roughness: 0.5, materialOverrides: { emissiveColor: '#ff5a2e', emissiveIntensity: 0.5 } }),
      physics: { ...dynamicBox(14), collider: 'capsule' },
      script: { blueprintId: barrelBp.id, graphId: barrelGraphId, enabled: true },
    });
  });

  // 2) CAR FOOTBALL — a giant ball and a goal that actually SCORES: +25, a teal burst, and the ball
  //    teleports back to the spot for the next attack.
  const ballId = makeId('obj');
  const ballSpawn: Vector3Tuple = [10, 2.1, -18];
  const goalBurstId = makeId('obj');
  const goalGraphId = makeId('graph');
  const goalBp: ScriptBlueprint = {
    id: makeId('bp'), name: 'Football Goal', graphId: goalGraphId, color: '#22e0ff', createdAt: Date.now(),
    description: 'Ball crosses the line → Score +25, celebration burst, ball respawns at the spot.',
  };
  const goalGraph: ProjectGraph = (() => {
    const ev = mkNode('On Ball In', 'Events', 40, 40, { nodeKind: 'event.triggerEnter', otherObjectId: ballId, hasInput: false });
    const getS = mkNode('Get Score', 'Variables', 40, 200, { nodeKind: 'variable.get', variableId: score.scoreVar.id, valueType: 'number', hasInput: false });
    const addS = mkNode('+ 25', 'Math', 300, 200, { nodeKind: 'math.add', amount: 25, hasInput: false });
    const setS = mkNode('Set Score', 'Variables', 300, 40, { nodeKind: 'variable.set', variableId: score.scoreVar.id, valueType: 'number' });
    const spot = mkNode('Ball Spot', 'Values', 300, 360, { nodeKind: 'value.vector3', vectorValue: [...ballSpawn] as Vector3Tuple, hasInput: false });
    const resetB = mkNode('Reset Ball', 'Runtime', 560, 40, { nodeKind: 'action.setPosition', targetObjectId: ballId });
    const burst = mkNode('Celebrate', 'Runtime', 820, 40, { nodeKind: 'action.burstParticles', targetObjectId: goalBurstId, numberValue: 90 });
    return {
      id: goalGraphId, name: 'Football Goal',
      nodes: [ev, getS, addS, setS, spot, resetB, burst],
      edges: [
        execEdge(ev.id, setS.id), valueEdge(getS.id, addS.id, 'a'), valueEdge(addS.id, setS.id, 'value'),
        execEdge(setS.id, resetB.id), valueEdge(spot.id, resetB.id, 'position'), execEdge(resetB.id, burst.id),
      ],
    };
  })();
  objects.push({
    id: ballId,
    name: 'Football',
    kind: 'sphere',
    transform: { position: [...ballSpawn] as Vector3Tuple, rotation: [0, 0, 0], scale: [3, 3, 3] },
    renderer: renderer('#f4f4f0', { roughness: 0.35, metalness: 0.05 }),
    physics: { ...dynamicBox(3), collider: 'sphere', restitution: 0.55, friction: 0.4 },
  });
  // Goal frame (posts + crossbar) at the east edge of the pitch, mouth facing the spot.
  objects.push(staticBox('Goal Post L', [30, 2.2, -25], [0.5, 4.4, 0.5], '#f2f2f2', { emissive: '#22e0ff', emissiveIntensity: 0.4 }));
  objects.push(staticBox('Goal Post R', [30, 2.2, -11], [0.5, 4.4, 0.5], '#f2f2f2', { emissive: '#22e0ff', emissiveIntensity: 0.4 }));
  objects.push(staticBox('Goal Crossbar', [30, 4.4, -18], [0.5, 0.5, 14.5], '#f2f2f2', { emissive: '#22e0ff', emissiveIntensity: 0.4 }));
  objects.push({
    id: makeId('obj'),
    name: 'Goal Line',
    kind: 'cube',
    transform: { position: [31.4, 2, -18], rotation: [0, 0, 0], scale: [2, 4, 13.5] },
    renderer: renderer('#22e0ff', { opacity: 0.12, materialOverrides: { emissiveColor: '#22e0ff', emissiveIntensity: 0.4 } }),
    physics: triggerBox(),
    script: { blueprintId: goalBp.id, graphId: goalGraphId, enabled: true },
  });
  objects.push({
    id: goalBurstId,
    name: 'Goal Burst',
    kind: 'empty',
    transform: { position: [30, 3, -18], rotation: [0, 0, 0], scale: [1, 1, 1] },
    particles: {
      enabled: false, looping: false, rate: 0, burst: 0, maxParticles: 240, shape: 'sphere', shapeRadius: 0.6,
      coneAngle: 60, speed: 7, speedJitter: 0.5, direction: [0, 1, 0] as Vector3Tuple, gravity: 4, drag: 0.4,
      lifetime: 1.1, lifetimeJitter: 0.3, startSize: 0.22, endSize: 0.05, startColor: '#22e0ff', endColor: '#ffffff',
      startOpacity: 1, endOpacity: 0, worldSpace: true, blend: 'additive', light: true,
    },
  });

  // 3) SWEEPER — a rotating arm over the skid pad (kinematic, so it genuinely shoves the car):
  //    dodge it while doing donuts around the cone ring.
  const sweepGraphId = makeId('graph');
  const sweepBp: ScriptBlueprint = {
    id: makeId('bp'), name: 'Sweeper Arm', graphId: sweepGraphId, color: '#ffd34d', createdAt: Date.now(),
    description: 'Update → Rotate Y: a constantly spinning kinematic arm that knocks cars around.',
  };
  const sweepGraph: ProjectGraph = (() => {
    const upd = mkNode('Update', 'Events', 40, 40, { nodeKind: 'event.update', hasInput: false });
    const rot = mkNode('Spin', 'Runtime', 300, 40, { nodeKind: 'action.rotate', axis: 'y', amount: 70 });
    return { id: sweepGraphId, name: 'Sweeper Arm', nodes: [upd, rot], edges: [execEdge(upd.id, rot.id)] };
  })();
  objects.push(staticBox('Sweeper Pylon', [40, 1.5, -36], [1.2, 3, 1.2], '#15171c', { metalness: 0.6, roughness: 0.4 }));
  objects.push({
    id: makeId('obj'),
    name: 'Sweeper Arm',
    kind: 'cube',
    transform: { position: [40, 1.05, -36], rotation: [0, 0, 0], scale: [21, 0.7, 0.7] },
    renderer: renderer('#ffd34d', { materialOverrides: { emissiveColor: '#ffd34d', emissiveIntensity: 0.5 } }),
    physics: { ...fixedBox(0.3), bodyType: 'kinematic' },
    script: { blueprintId: sweepBp.id, graphId: sweepGraphId, enabled: true },
  });

  // 4) PISTON GATE — a kinematic block that slams across the racing strip on a timer, driven by the
  //    Tween node (out on easeIn, Done → glide back). Time your pass.
  const pistonGraphId = makeId('graph');
  const pistonBp: ScriptBlueprint = {
    id: makeId('bp'), name: 'Piston Gate', graphId: pistonGraphId, color: '#ff8a3d', createdAt: Date.now(),
    description: 'Timer → Tween across the strip → Done → Tween home. A rhythm hazard built on the Tween node.',
  };
  const pistonGraph: ProjectGraph = (() => {
    const tick = mkNode('Every 4s', 'Events', 40, 40, { nodeKind: 'event.timer', numberValue: 4 });
    const out = mkNode('Slam Out', 'Runtime', 300, 40, {
      nodeKind: 'action.tweenProperty', tweenProperty: 'position', vectorValue: [-4, 1, 16] as Vector3Tuple, numberValue: 0.7, easing: 'easeIn',
    });
    const back = mkNode('Glide Home', 'Runtime', 560, 40, {
      nodeKind: 'action.tweenProperty', tweenProperty: 'position', vectorValue: [-13, 1, 16] as Vector3Tuple, numberValue: 1.6, easing: 'easeInOut',
    });
    return { id: pistonGraphId, name: 'Piston Gate', nodes: [tick, out, back], edges: [execEdge(tick.id, out.id), doneEdge(out.id, back.id)] };
  })();
  objects.push({
    id: makeId('obj'),
    name: 'Piston Gate',
    kind: 'cube',
    transform: { position: [-13, 1, 16], rotation: [0, 0, 0], scale: [3.2, 2, 4.6] },
    renderer: renderer('#ff8a3d', { metalness: 0.5, roughness: 0.4, materialOverrides: { emissiveColor: '#ff8a3d', emissiveIntensity: 0.6 } }),
    physics: { ...fixedBox(0.3), bodyType: 'kinematic' },
    script: { blueprintId: pistonBp.id, graphId: pistonGraphId, enabled: true },
  });
  objects.push(staticBox('Piston Housing', [-16.4, 1.4, 16], [3.4, 2.8, 5.4], '#2b2f38', { roughness: 0.9 }));

  // 5) AIR RING — fly through the glowing ring off the kicker for +100 (3s cooldown so a parked car
  //    inside it can't farm points).
  const ringBurstId = makeId('obj');
  const ringGraphId = makeId('graph');
  const ringBp: ScriptBlueprint = {
    id: makeId('bp'), name: 'Air Ring', graphId: ringGraphId, color: '#c14df0', createdAt: Date.now(),
    description: 'Fly through off the kicker → Score +100 + burst (cooldown-gated).',
  };
  const ringGraph: ProjectGraph = (() => {
    const ev = mkNode('On Fly Through', 'Events', 40, 40, { nodeKind: 'event.triggerEnter', otherObjectId: carId, hasInput: false });
    const gate = mkNode('Cooldown 3s', 'Logic', 280, 40, { nodeKind: 'logic.cooldown', numberValue: 3 });
    const getS = mkNode('Get Score', 'Variables', 280, 200, { nodeKind: 'variable.get', variableId: score.scoreVar.id, valueType: 'number', hasInput: false });
    const addS = mkNode('+ 100', 'Math', 520, 200, { nodeKind: 'math.add', amount: 100, hasInput: false });
    const setS = mkNode('Set Score', 'Variables', 520, 40, { nodeKind: 'variable.set', variableId: score.scoreVar.id, valueType: 'number' });
    const burst = mkNode('Ring Burst', 'Runtime', 780, 40, { nodeKind: 'action.burstParticles', targetObjectId: ringBurstId, numberValue: 120 });
    return {
      id: ringGraphId, name: 'Air Ring',
      nodes: [ev, gate, getS, addS, setS, burst],
      edges: [execEdge(ev.id, gate.id), execEdge(gate.id, setS.id), valueEdge(getS.id, addS.id, 'a'), valueEdge(addS.id, setS.id, 'value'), execEdge(setS.id, burst.id)],
    };
  })();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    objects.push(staticBox(`Ring Seg ${i}`, [Math.cos(a) * 3.6, 5.6 + Math.sin(a) * 3.6, 51.5], [0.5, 0.5, 0.4], '#c14df0', { emissive: '#c14df0', emissiveIntensity: 1.6 }));
  }
  objects.push({
    id: makeId('obj'),
    name: 'Air Ring Trigger',
    kind: 'cube',
    transform: { position: [0, 5.6, 51.5], rotation: [0, 0, 0], scale: [5.4, 5.4, 1.2] },
    renderer: { ...renderer('#c14df0', { opacity: 0.06 }), hideInPlay: true },
    physics: triggerBox(),
    script: { blueprintId: ringBp.id, graphId: ringGraphId, enabled: true },
  });
  objects.push({
    id: ringBurstId,
    name: 'Ring Burst',
    kind: 'empty',
    transform: { position: [0, 5.6, 51.5], rotation: [0, 0, 0], scale: [1, 1, 1] },
    particles: {
      enabled: false, looping: false, rate: 0, burst: 0, maxParticles: 260, shape: 'sphere', shapeRadius: 3.4,
      coneAngle: 60, speed: 4, speedJitter: 0.6, direction: [0, 0, -1] as Vector3Tuple, gravity: 1, drag: 0.5,
      lifetime: 1.2, lifetimeJitter: 0.3, startSize: 0.26, endSize: 0.06, startColor: '#c14df0', endColor: '#22e0ff',
      startOpacity: 1, endOpacity: 0, worldSpace: true, blend: 'additive', light: true,
    },
  });

  // 6) DOMINO RUN — a long row of slabs to topple at speed (pure physics, no blueprint needed).
  for (let i = 0; i < 14; i++) {
    objects.push(prop(`Domino ${i}`, [-38 + i * 2.6, 1.7, -52], [0.45, 3.4, 1.8], i % 2 ? '#e8e4da' : '#22e0ff', 8, i % 2 ? undefined : '#22e0ff'));
  }

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

  // Track-conditions controller: listens for the N (night) / M (rain) toggles.
  objects.push({
    id: makeId('obj'),
    name: 'Track Conditions',
    kind: 'empty',
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    script: { blueprintId: conditions.blueprint.id, graphId: conditions.graph.id, enabled: true },
  });
  useEditorStore.setState((draft) => ({
    variables: [...draft.variables, menu.speedLevelVar, menu.speedVar, menu.menuOpenVar, menu.nitroVar, menu.damageVar, menu.rpmVar, menu.gearVar, garage.carBodyVar, garage.garageOpenVar, score.scoreVar, score.stuntVar, score.comboVar, conditions.wetVar],
    blueprints: [...draft.blueprints, menu.blueprint, boost.blueprint, garage.blueprint, conditions.blueprint, barrelBp, goalBp, sweepBp, pistonBp, ringBp],
    graphs: [...draft.graphs, menu.graph, boost.graph, garage.graph, conditions.graph, barrelGraph, goalGraph, sweepGraph, pistonGraph, ringGraph],
    uiDocuments: [...draft.uiDocuments, menu.hud, garage.hud, score.hud],
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
