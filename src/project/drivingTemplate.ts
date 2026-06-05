import type { Edge } from '@xyflow/react';
import * as THREE from 'three';
import { GLTFLoader } from 'three-stdlib';
import { getPlatform } from '../platform';
import { defaultVehicle, useEditorStore } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import { defaultSceneEnvironment } from '../three/environmentSettings';
import type {
  AssetItem,
  CinematicAction,
  CinematicSequence,
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
//  APOCALYPTIC DRIVING TEMPLATE
//  A simple, all-in-one driving showcase. One car, one open wasteland, three cinematic trigger zones that
//  punch the camera, fire a sound, flash a styled banner, and tick an objective list. Designed to put the
//  engine's lighting (low ember sun + thick haze + emissive props + bloom), UI bindings (live speedometer,
//  weight readout, objective checklist driven by a single variable) and visual-scripting logic (event.start,
//  trigger.enter, logic.delay, custom events, variable.set, ui.show / ui.hide) on display in one drive.
// ============================================================================================================

const makeId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const CARS_DIR = 'templates/cars';

// --- Bundled rig: one car (body + wheel GLB). Apocalypse survivor doesn't get a showroom. ---
const CAR_BODY = 'CarModel1_body.glb';
const CAR_WHEEL = 'CarModel1_wheel.glb';
const CAR_NAME = 'Survivor';
const CAR_MASS = 9; // also surfaced in the HUD as WEIGHT t

// --- Wasteland palette (warm rust + ember vs. cold ash; banner accents per zone). ---
const EMBER = '#ff7a1a';
const RUST = '#6e2f12';
const ASH_LIGHT = '#3a3128';
const BANNER_FIRE = '#ff8a3d';
const BANNER_TOXIC = '#a7ff5a';
const BANNER_GOLD = '#ffd166';

// --- Cinematic trigger zones. Each one is a flat trigger volume + a tall beacon marker, and gets its OWN
//     per-zone blueprint + banner UI built below. Layout sits the player car at (0,0) facing +Z; the zones
//     are spread out so the player has to actually drive between them. ---
interface ZoneDef {
  name: string;
  position: Vector3Tuple; // ground center of the trigger pad
  banner: string;
  blurb: string;
  accent: string;
  shake: number;
  /** Vertical impulse (axis=y) applied to the toucher ($trigger) on enter — a "shockwave" hop. 0 = no kick. */
  bounceY: number;
  /** action.setEnvironment patch the zone applies on enter; the same fields are restored from `envDefault`
   *  after the dwell. Keep it small (3–4 fields) so the crossfade reads as an *atmosphere* shift, not a swap. */
  env: Record<string, string | number | boolean>;
  /** How long (s) the banner + atmosphere stay up before the zone restores the default environment. */
  dwell: number;
}
// --- Base apocalyptic dusk environment. Each zone's cinematic restores the keys it modified from THIS
//     object — so a 4-field zone reverts those 4 fields without disturbing the rest of the world settings.
const BASE_ENV: Record<string, string | number | boolean> = {
  skyTopColor: '#1a0d05',
  skyHorizonColor: '#4d1f0a',
  skyGroundColor: '#08050a',
  environmentIntensity: 0.45,
  sunColor: '#ff8a3a',
  sunIntensity: 0.5,
  sunElevation: 8,
  sunAzimuth: 230,
  fogEnabled: true,
  fogColor: '#241008',
  fogNear: 30,
  fogFar: 220,
};

const ZONES: ZoneDef[] = [
  {
    name: 'Wreckage',
    position: [-55, 0, 30],
    banner: '⚠  CRASH SITE',
    blurb: 'Convoy ambushed · dust storm closing',
    accent: BANNER_FIRE,
    shake: 0.6,
    bounceY: 4,
    env: { fogColor: '#3a1408', fogNear: 10, fogFar: 70, skyHorizonColor: '#7a2810', sunColor: '#ff4a1a', sunIntensity: 0.6 },
    dwell: 3.4,
  },
  {
    name: 'Reactor',
    position: [50, 0, 75],
    banner: '☢  RADIATION ZONE',
    blurb: 'Geiger spike · keep it moving',
    accent: BANNER_TOXIC,
    shake: 0.85,
    bounceY: 7,
    env: { fogColor: '#0e2a10', fogNear: 14, fogFar: 90, skyHorizonColor: '#2a6a0a', sunColor: '#9aff5a', sunIntensity: 0.85 },
    dwell: 4.2,
  },
  {
    name: 'Beacon',
    position: [-25, 0, 130],
    banner: '★  FINAL BEACON',
    blurb: 'Signal reached · convoy lives',
    accent: BANNER_GOLD,
    shake: 0.5,
    bounceY: 0,
    env: { fogColor: '#a08070', fogNear: 60, fogFar: 280, skyTopColor: '#3a5a78', skyHorizonColor: '#ffb070', sunColor: '#ffe9c4', sunIntensity: 1.05, sunElevation: 22 },
    dwell: 5.0,
  },
];

// --- Generic factories (renderer / fixed box collider / graph nodes / edges / UI elements). ---
const defaultRenderer = (mesh: MeshRendererComponent['mesh'], color: string): MeshRendererComponent => ({
  enabled: true,
  mesh,
  color,
  metalness: 0.1,
  roughness: 0.85,
});

const fixedBox = (): PhysicsComponent => ({
  enabled: true,
  bodyType: 'fixed',
  collider: 'box',
  isTrigger: false,
  collisionLayer: 0,
  collisionMask: 0xffff,
  mass: 1,
  gravityScale: 1,
  friction: 0.9,
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
  friction: 0,
  linearDamping: 0,
  angularDamping: 0,
});

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
const valueEdge = (source: string, target: string, targetHandle: string): Edge => ({ id: makeId('edge'), source, target, sourceHandle: 'value-out', targetHandle, type: 'smoothstep', style: { stroke: '#ff8a3d', strokeWidth: 2 } });

function createCarIntroCinematic(carId: string): CinematicSequence {
  const action = (type: CinematicAction['type'], data: Omit<CinematicAction, 'id' | 'type'>): CinematicAction => ({
    id: makeId('caction'),
    type,
    ...data,
  });
  return {
    id: makeId('cinematic'),
    name: 'Survivor Car Intro',
    duration: 6.8,
    frameRate: 24,
    autoplay: false,
    skippable: true,
    folder: 'Driving',
    look: { letterbox: 2.39, grade: 'teal-orange', gradeIntensity: 0.8, exposure: 0.05, contrast: 0.18, saturation: 0.08, grain: 0.06, vignette: 0.32 },
    markers: [
      { id: makeId('cmark'), time: 0, label: 'Low reveal', color: EMBER },
      { id: makeId('cmark'), time: 3.2, label: 'Orbit bodywork', color: BANNER_GOLD },
      { id: makeId('cmark'), time: 6.2, label: 'Handoff', color: '#dcefff' },
    ],
    actions: [
      action('fade', { time: 0, duration: 0.8, label: 'Dust fade in', fadeFrom: 1, fadeTo: 0, fadeColor: '#060302' }),
      action('camera', {
        time: 0,
        duration: 6.8,
        label: 'Low car orbit to playable camera',
        interpolation: 'smooth',
        keyframes: [
          { time: 0, position: [-5.6, 1.05, -6.2], lookAt: [0, 2.1, 0.8], fov: 42, aperture: 4.2, focusDistance: 6 },
          { time: 1.6, position: [-3.8, 1.45, 2.9], lookAt: [0.15, 2.0, 1.4], fov: 36, aperture: 3.8, focusDistance: 4.2 },
          { time: 3.2, position: [4.4, 1.8, 4.8], lookAt: [0, 2.0, 0.6], fov: 44, aperture: 2.8, focusDistance: 5.5 },
          { time: 5.2, position: [0, 4.8, -9.5], lookAt: [0, 2.1, 8], fov: 52, aperture: 1.2, focusDistance: 12 },
          { time: 6.8, position: [0, 5.0, -12.5], lookAt: [0, 2.0, 18], fov: 58, aperture: 0.4, focusDistance: 18 },
        ],
      }),
      action('event', { time: 6.7, label: 'Intro complete', objectId: carId, eventName: 'DrivingIntroComplete' }),
    ],
    createdAt: Date.now(),
  };
}

const uiElement = (kind: UIElement['kind'], name: string, style: UIElement['style'], text?: string): UIElement => ({
  id: makeId('uiel'), kind, name, text, style, bindings: [], children: [],
});
const boundElement = (kind: UIElement['kind'], name: string, style: UIElement['style'], bindings: UIElement['bindings'], text?: string): UIElement => ({
  ...uiElement(kind, name, style, text), bindings,
});

// --- Asset import helpers (re-use any already-imported clone so re-creating the template is idempotent). ---
async function importStaticModel(file: string, folderId?: string): Promise<AssetItem | undefined> {
  const existing = useEditorStore.getState().assets.find((a) => a.name === file && a.type === 'model');
  if (existing) return existing;
  const response = await fetch(`${CARS_DIR}/${file}`);
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

async function importAudio(file: string, folderId?: string): Promise<AssetItem | undefined> {
  const existing = useEditorStore.getState().assets.find((a) => a.name === file && a.type === 'audio');
  if (existing) return existing;
  const response = await fetch(`${CARS_DIR}/Audio/${file}`);
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

// --- Simple primitives used by the wasteland builder. -------------------------------------------------------
function box(
  name: string,
  position: Vector3Tuple,
  scale: Vector3Tuple,
  color: string,
  opts: { rotationY?: number; metalness?: number; roughness?: number; emissive?: string; emissiveIntensity?: number; physics?: PhysicsComponent } = {},
): SceneObject {
  return {
    id: makeId('obj'),
    name,
    kind: 'cube',
    transform: { position, rotation: [0, opts.rotationY ?? 0, 0], scale },
    renderer: {
      ...defaultRenderer('cube', color),
      metalness: opts.metalness ?? 0.05,
      roughness: opts.roughness ?? 0.85,
      ...(opts.emissive ? { materialOverrides: { emissiveColor: opts.emissive, emissiveIntensity: opts.emissiveIntensity ?? 1 } } : {}),
    },
    ...(opts.physics ? { physics: opts.physics } : {}),
  };
}

/** A point light wrapper — used for ember/torch glows around fires + a few atmospheric fills. */
function pointLight(name: string, position: Vector3Tuple, color: string, intensity: number, distance: number): SceneObject {
  return {
    id: makeId('obj'),
    name,
    kind: 'light',
    transform: { position, rotation: [0, 0, 0], scale: [1, 1, 1] },
    light: { type: 'point', color, intensity, distance, angle: Math.PI / 4, castShadow: false },
  };
}

/** A burning oil drum: a SOLID rusty cylinder (box collider) topped with an emissive ember "fire" cap and a
 *  tight point light. Tiny per-instance, but the cluster does most of the night-scene atmosphere work. */
function burningDrum(x: number, z: number): SceneObject[] {
  const drum = box('Drum', [x, 0.6, z], [0.7, 1.2, 0.7], RUST, { metalness: 0.55, roughness: 0.7, physics: fixedBox() });
  const fire = box('Fire', [x, 1.45, z], [0.55, 0.7, 0.55], EMBER, { emissive: EMBER, emissiveIntensity: 4.2, metalness: 0, roughness: 0.5 });
  const glow = pointLight('Fire Glow', [x, 1.6, z], EMBER, 5, 14);
  return [drum, fire, glow];
}

/** A wrecked car silhouette: a rusted body cube + a tilted "roof" cube — read at a glance as a dead vehicle.
 *  SOLID so the survivor's car bumps into it. */
function wreck(x: number, z: number, yaw: number): SceneObject[] {
  const body = box('Wreck Body', [x, 0.6, z], [4, 1.2, 1.8], '#2a1a14', {
    rotationY: yaw, metalness: 0.4, roughness: 0.75, physics: fixedBox(),
  });
  const cabin = box('Wreck Cabin', [x, 1.55, z], [2.2, 0.7, 1.6], '#1c100c', {
    rotationY: yaw, metalness: 0.4, roughness: 0.7,
  });
  return [body, cabin];
}

/** A knockable rusted barrel (DYNAMIC) — the survivor can plow through it. */
function loose(x: number, z: number): SceneObject {
  return {
    id: makeId('obj'),
    name: 'Loose Barrel',
    kind: 'cube',
    transform: { position: [x, 0.55, z], rotation: [0, 0, 0], scale: [0.55, 1.1, 0.55] },
    renderer: { ...defaultRenderer('cube', RUST), metalness: 0.5, roughness: 0.7, materialOverrides: { emissiveColor: EMBER, emissiveIntensity: 0.18 } },
    physics: { enabled: true, bodyType: 'dynamic', collider: 'box', isTrigger: false, collisionLayer: 0, collisionMask: 0xffff, mass: 0.4, gravityScale: 1, friction: 0.6, linearDamping: 0.2, angularDamping: 0.3 },
  };
}

/** A broken concrete pillar — uneven slab silhouette for parallax. SOLID. */
function pillar(x: number, z: number, h: number): SceneObject {
  return box('Pillar', [x, h / 2, z], [1.4, h, 1.4], ASH_LIGHT, { metalness: 0.1, roughness: 0.95, physics: fixedBox() });
}

// --- Wasteland builder -------------------------------------------------------------------------------------
//
// A flat ashy world with a cracked highway through the middle, ruined props, a handful of fire drums for
// ember light, and the three trigger-zone beacons. No grid, no race, no orbs — just open driving with
// cinematic moments at the zones. Returns the flat object list; the ground slab is added separately.
function buildWasteland(zoneBlueprintIds: Array<{ blueprintId: string; graphId: string }>): SceneObject[] {
  const objects: SceneObject[] = [];

  // 1) Cracked highway: a long dark slab running +Z, with a faint emissive yellow lane crack. Decorative —
  //    the player can drive on/off it anywhere because the ground slab provides the physics floor.
  objects.push(box('Highway', [0, 0.05, 60], [14, 0.05, 240], '#0d0c0a', { metalness: 0.05, roughness: 0.9 }));
  for (let z = -60; z <= 180; z += 14) {
    objects.push(box('Crack', [0, 0.09, z], [0.4, 0.02, 6], '#3a2e10', { emissive: '#8a6a1c', emissiveIntensity: 0.7 }));
  }

  // 2) Outer ash flats: a few dusty mounds to break up the silhouette. Decorative.
  const mounds: Array<[number, number, number, number]> = [
    [-30, -10, 6, 1.2], [40, -25, 8, 1.4], [-60, 60, 7, 1.1], [55, 110, 9, 1.6],
    [-80, 100, 6, 1.0], [25, 150, 5, 0.9], [-15, 170, 7, 1.2],
  ];
  mounds.forEach(([x, z, r, h]) => objects.push(box('Ash Mound', [x, h / 2, z], [r, h, r], ASH_LIGHT, { metalness: 0, roughness: 1 })));

  // 3) Wrecked convoy: dead vehicles scattered around the first zone for "ambush site" reading.
  const wrecks: Array<[number, number, number]> = [
    [-50, 22, 0.3], [-60, 35, -0.6], [-46, 40, 1.1], [-65, 28, 0.0],
    [10, 60, 0.4], [22, 95, -0.5], [-12, 145, 0.7],
  ];
  wrecks.forEach(([x, z, yaw]) => objects.push(...wreck(x, z, yaw)));

  // 4) Broken concrete pillars (collapsed bridge / building remnants) — vertical silhouettes that read in fog.
  const pillars: Array<[number, number, number]> = [
    [-20, 18, 6], [-18, 22, 4.5], [22, 18, 5.5], [20, 22, 7],
    [-25, 90, 6], [-22, 95, 5], [42, 100, 6.5], [38, 95, 5.5],
    [-30, 155, 6], [30, 150, 5.5],
  ];
  pillars.forEach(([x, z, h]) => objects.push(pillar(x, z, h)));

  // 5) Burning oil drums clustered around the zones (and along the highway) for ember lighting at night.
  const drums: Array<[number, number]> = [
    [-45, 32], [-48, 38], [-58, 28], [-55, 24],
    [44, 70], [54, 78], [56, 72],
    [-22, 128], [-26, 135], [-28, 130],
    [4, 10], [-5, 0], [6, 40], [-7, 95], [8, 120],
  ];
  drums.forEach(([x, z]) => objects.push(...burningDrum(x, z)));

  // 6) Knockable loose barrels around the highway shoulders (a few satisfying things to bowl over).
  const looseSpots: Array<[number, number]> = [
    [-8, 22], [8, 22], [-8, 50], [8, 50], [-8, 90], [8, 90], [-8, 140], [8, 140],
  ];
  looseSpots.forEach(([x, z]) => objects.push(loose(x, z)));

  // 7) ZONE BEACONS — each zone gets a flat trigger pad (TRIGGER, ~6m radius square) with a tall emissive
  //    pillar marker so you can see + drive to it, and the per-zone blueprint runs the cinematic on touch.
  ZONES.forEach((zone, i) => {
    const ref = zoneBlueprintIds[i];
    const [x, , z] = zone.position;
    // The trigger sensor: a wide thin invisible-ish trigger. Bright emissive top so it reads as a glowing ring.
    objects.push({
      id: makeId('obj'),
      name: `${zone.name} Trigger`,
      kind: 'cube',
      transform: { position: [x, 0.18, z], rotation: [0, 0, 0], scale: [10, 0.3, 10] },
      renderer: {
        ...defaultRenderer('cube', '#06060a'),
        metalness: 0.1, roughness: 0.6,
        materialOverrides: { emissiveColor: zone.accent, emissiveIntensity: 1.6 },
      },
      physics: triggerBox(),
      script: { blueprintId: ref.blueprintId, graphId: ref.graphId, enabled: true },
    });
    // Tall pillar beacon (decorative) so you can see the zone from a distance through the haze.
    objects.push(box(`${zone.name} Beacon`, [x, 6, z], [0.7, 12, 0.7], '#08070a', {
      emissive: zone.accent, emissiveIntensity: 2.6, metalness: 0.2, roughness: 0.4,
    }));
    // A bright accent point light so the beacon throws colored light onto the dust + nearby props.
    objects.push(pointLight(`${zone.name} Light`, [x, 4.5, z], zone.accent, 10, 28));
  });

  // 8) A pair of warm fill lights at the spawn so the car reads against the dark wasteland on play.
  objects.push(pointLight('Spawn Glow', [0, 6, 0], EMBER, 12, 40));
  objects.push(pointLight('Spawn Glow Back', [0, 5, -8], '#ffb070', 8, 26));

  return objects;
}

// --- Single car build -------------------------------------------------------------------------------------
//
// One DYNAMIC car: a body root, 4 wheels at the measured corners, 2 headlights, 2 brake lights. Same shape
// as the old multi-car builder, but stripped to one car and tuned a touch more "lumbering wasteland truck"
// (slightly higher mass already baked in by CAR_MASS, and a touch of extra body roll to feel hefty).
interface CarSounds {
  engineSoundId?: string;
  skidSoundId?: string;
  brakeSoundId?: string;
  hornSoundId?: string;
  collisionSoundId?: string;
}

async function buildCar(
  bodyAsset: AssetItem,
  wheelAsset: AssetItem,
  scriptRef: { blueprintId: string; graphId: string },
  sounds: CarSounds,
): Promise<{ rootId: string; objects: SceneObject[] }> {
  const rootId = makeId('obj');

  const bodyBox = await measureModel(CAR_BODY);
  const wheelBox = await measureModel(CAR_WHEEL);
  const min = bodyBox?.min ?? [-0.9, -0.4, -2];
  const max = bodyBox?.max ?? [0.9, 1.1, 2];
  const cx = (min[0] + max[0]) / 2;
  const cy = (min[1] + max[1]) / 2;
  const cz = (min[2] + max[2]) / 2;
  const halfW = (max[0] - min[0]) / 2;
  const halfL = (max[2] - min[2]) / 2;
  const wheelR = wheelBox ? Math.max(wheelBox.max[1] - wheelBox.min[1], wheelBox.max[0] - wheelBox.min[0]) / 2 : 0.35;
  const sideX = halfW * 0.9;
  const frontZ = cz + halfL * 0.72;
  const rearZ = cz - halfL * 0.72;
  const wheelRestY = min[1] + wheelR * 0.92;

  const wheelIds: string[] = [];
  const steeredIds: string[] = [];
  const tireMarkIds: string[] = [];
  const headlightIds: string[] = [];
  const brakeIds: string[] = [];

  const wheelSpots: Array<{ x: number; z: number; front: boolean }> = [
    { x: cx - sideX, z: frontZ, front: true },
    { x: cx + sideX, z: frontZ, front: true },
    { x: cx - sideX, z: rearZ, front: false },
    { x: cx + sideX, z: rearZ, front: false },
  ];
  const wheelObjects: SceneObject[] = [];
  wheelSpots.forEach((spot, w) => {
    const anchorId = makeId('obj');
    const wheelId = makeId('obj');
    wheelIds.push(wheelId);
    if (spot.front) steeredIds.push(anchorId);
    wheelObjects.push({
      id: anchorId,
      name: `Wheel Anchor ${w + 1}`,
      kind: 'empty',
      parentId: rootId,
      transform: { position: [spot.x, wheelRestY, spot.z], rotation: [0, 0, 0], scale: [1, 1, 1] },
    });
    wheelObjects.push({
      id: wheelId,
      name: `Wheel ${w + 1}`,
      kind: 'cube',
      parentId: anchorId,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      renderer: { ...defaultRenderer('cube', '#15171c'), modelAssetId: wheelAsset.id, metalness: 0.5, roughness: 0.6 },
    });
  });

  const tireMarks: SceneObject[] = wheelSpots.filter((spot) => !spot.front).map((spot, i) => {
    const id = makeId('obj');
    tireMarkIds.push(id);
    return {
      id,
      name: `Tire Marks ${i + 1}`,
      kind: 'empty',
      parentId: rootId,
      transform: { position: [spot.x, wheelRestY - wheelR * 0.92 + 0.04, spot.z], rotation: [0, 0, 0], scale: [1, 1, 1] },
      particles: {
        enabled: false,
        looping: true,
        rate: 72,
        burst: 0,
        maxParticles: 520,
        shape: 'disc',
        shapeRadius: Math.max(0.08, wheelR * 0.32),
        coneAngle: 8,
        speed: 0.02,
        speedJitter: 0.7,
        direction: [0, 1, 0] as Vector3Tuple,
        gravity: 0,
        drag: 1.2,
        lifetime: 7.5,
        lifetimeJitter: 0.25,
        startSize: Math.max(0.2, wheelR * 0.7),
        endSize: Math.max(0.28, wheelR * 0.95),
        startColor: '#0d0907',
        endColor: '#2c241e',
        startOpacity: 0.62,
        endOpacity: 0,
        worldSpace: true,
        blend: 'normal',
        light: false,
      },
    };
  });

  const headlights: SceneObject[] = [-1, 1].map((s, h) => {
    const id = makeId('obj');
    headlightIds.push(id);
    const light: LightComponent = { type: 'spot', color: '#fff1c4', intensity: 9, distance: 36, angle: Math.PI / 7, castShadow: false };
    return {
      id,
      name: `Headlight ${h + 1}`,
      kind: 'light',
      parentId: rootId,
      transform: { position: [cx + s * halfW * 0.62, cy, max[2] * 0.98], rotation: [-0.12, 0, 0], scale: [1, 1, 1] },
      light,
    };
  });

  const brakeLights: SceneObject[] = [-1, 1].map((s, b) => {
    const id = makeId('obj');
    brakeIds.push(id);
    return {
      id,
      name: `Brake Light ${b + 1}`,
      kind: 'cube',
      parentId: rootId,
      transform: { position: [cx + s * halfW * 0.6, cy, min[2] * 0.98], rotation: [0, 0, 0], scale: [Math.max(0.12, halfW * 0.32), 0.12, 0.06] },
      renderer: { ...defaultRenderer('cube', '#3a0c0c'), materialOverrides: { emissiveColor: '#ff2a2a', emissiveIntensity: 0.18 } },
    };
  });

  const vehicle: VehicleComponent = {
    ...defaultVehicle(),
    enabled: true,
    cameraFollow: true,
    maxSpeed: 34,
    maxReverseSpeed: 11,
    acceleration: 22,
    braking: 38,
    drag: 5.5,
    steerAngle: 0.54,
    turnRate: 2.1,
    gripFactor: 0.88,
    handbrakeGrip: 0.16,
    suspensionTravel: 0.22,
    suspensionStiffness: 0.24,
    // Extra roll + pitch so the heavy survivor truck reads as weighty when cornering / braking.
    bodyRoll: 0.085,
    bodyPitch: 0.075,
    crashDamageEnabled: true,
    crashDamageThreshold: 7.5,
    crashRolloverThreshold: 13.5,
    crashRolloverStrength: 0.62,
    crashDeformation: 0.6,
    crashWheelBreakThreshold: 1.2,
    crashDebris: true,
    wheelObjectIds: wheelIds,
    steeredWheelIds: steeredIds,
    tireMarkIds,
    headlightIds,
    brakeLightIds: brakeIds,
    engineSoundId: sounds.engineSoundId,
    skidSoundId: sounds.skidSoundId,
    brakeSoundId: sounds.brakeSoundId,
    hornSoundId: sounds.hornSoundId,
    collisionSoundId: sounds.collisionSoundId,
    wheelRadius: wheelR,
    rideHeight: -min[1],
    wheelRestY,
    cameraOffset: [0, 2.4 + (max[1] - min[1]), -(halfL * 2 + 5.5)] as Vector3Tuple,
  };

  const root: SceneObject = {
    id: rootId,
    name: CAR_NAME,
    kind: 'cube',
    transform: { position: [0, 2, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    renderer: { ...defaultRenderer('cube', '#cdd3dc'), modelAssetId: bodyAsset.id, metalness: 0.3, roughness: 0.55 },
    // DYNAMIC: the vehicle pass drives horizontal velocity + yaw, gravity/rest is solver-owned, and the convex
    // hull bumps into wrecks/pillars/drums genuinely. CAR_MASS is also surfaced into the HUD as WEIGHT.
    physics: {
      enabled: true, bodyType: 'dynamic', collider: 'convex', isTrigger: false,
      collisionLayer: 0, collisionMask: 0xffff,
      mass: CAR_MASS, gravityScale: 1, friction: 1.05, linearDamping: 0.18, angularDamping: 0.32,
    },
    vehicle,
    script: { blueprintId: scriptRef.blueprintId, graphId: scriptRef.graphId, enabled: true },
  };

  return { rootId, objects: [root, ...wheelObjects, ...tireMarks, ...headlights, ...brakeLights] };
}

// --- HUD ---------------------------------------------------------------------------------------------------
//
// Bottom-center neon speedometer (km/h, bound to the runtime-mirrored `Speed`) with a WEIGHT chip beneath
// (bound to `Weight`, which the start blueprint sets to CAR_MASS). Top-left objective list bound to
// `Objective` (0..3) — each row reads ✓ when its index is below the variable. Top-right waypoint chip
// bound to `Objective` shows the current target's name. An auto-fading hint strip at the bottom teaches the
// controls without nagging. NOTE: the runtime auto-mirrors a "Speed" project var when there's a vehicle
// in the scene — we don't have to write Speed ourselves.
function createWastelandHud(weight: number): UIDocument {
  const root = uiElement('panel', 'Root', { width: '100%', height: '100%', position: 'relative', padding: '0' });

  // --- Bottom-center speedometer + weight chip ---
  const speedBox = uiElement('panel', 'Speed Box', {
    position: 'absolute', left: '50%', display: 'flex', flexDirection: 'column',
    background: 'rgba(20,12,6,0.55)', borderRadius: '16px',
    custom: {
      bottom: '38px', transform: 'translateX(-50%)', alignItems: 'center', gap: '0px',
      padding: '10px 32px 12px', backdropFilter: 'blur(6px)',
      border: `1px solid ${EMBER}55`, boxShadow: `0 0 24px ${EMBER}33`,
    },
  });
  const speed = boundElement('text', 'Speed', {
    color: '#FFFFFF', fontSize: '54px', fontWeight: '800', textAlign: 'center',
    custom: { textShadow: `0 0 16px ${EMBER}aa`, lineHeight: '1', fontVariantNumeric: 'tabular-nums' },
  }, [{ target: 'text', expression: 'Speed' }], '0');
  const unit = uiElement('text', 'Unit', {
    color: EMBER, fontSize: '12px', fontWeight: '700', textAlign: 'center',
    custom: { letterSpacing: '5px', marginTop: '2px' },
  }, 'KM / H');
  const weightChip = boundElement('text', 'Weight', {
    color: 'rgba(255,220,180,0.8)', fontSize: '11px', fontWeight: '700', textAlign: 'center',
    custom: { letterSpacing: '3px', marginTop: '6px' },
  }, [{ target: 'text', expression: `'WEIGHT  ' + Weight + ' t'` }], `WEIGHT  ${weight} t`);
  speedBox.children = [speed, unit, weightChip];

  // --- Top-left objective list. Each row's "✓" vs "○" is a ternary on Objective. ---
  // Using a 4-state expression keeps the runtime expression evaluator (no Math.* / function calls) happy.
  const objPanel = uiElement('panel', 'Objectives', {
    position: 'absolute', display: 'flex', flexDirection: 'column',
    background: 'rgba(14,10,6,0.62)', borderRadius: '12px', padding: '14px 16px',
    custom: { top: '18px', left: '18px', gap: '6px', backdropFilter: 'blur(5px)', border: `1px solid ${EMBER}44`, boxShadow: `0 0 20px ${EMBER}1a`, minWidth: '220px' },
  });
  const title = uiElement('text', 'Objectives Title', {
    color: EMBER, fontSize: '12px', fontWeight: '800', textAlign: 'left',
    custom: { letterSpacing: '4px', marginBottom: '4px' },
  }, 'OBJECTIVES');
  objPanel.children = [
    title,
    ...ZONES.map((zone, i) => boundElement('text', `Objective ${i + 1}`, {
      color: '#ffeacc', fontSize: '13px', fontWeight: '700', textAlign: 'left',
      custom: { letterSpacing: '1px' },
    }, [{ target: 'text', expression: `(Objective > ${i} ? '✓  ' : '○  ') + '${zone.banner.replace(/'/g, "\\'")}'` }], `○  ${zone.banner}`),
    ),
  ];

  // --- Top-right waypoint chip. Shows the current zone name; flips to "ALL CLEAR" when all done. ---
  const wpChip = uiElement('panel', 'Waypoint', {
    position: 'absolute', display: 'flex', flexDirection: 'column',
    background: 'rgba(14,10,6,0.62)', borderRadius: '12px', padding: '12px 18px',
    custom: { top: '18px', right: '18px', gap: '4px', backdropFilter: 'blur(5px)', border: `1px solid ${BANNER_GOLD}55`, boxShadow: `0 0 22px ${BANNER_GOLD}22`, alignItems: 'flex-end' },
  });
  const wpLabel = uiElement('text', 'Waypoint Label', {
    color: BANNER_GOLD, fontSize: '11px', fontWeight: '800', textAlign: 'right',
    custom: { letterSpacing: '4px' },
  }, 'NEXT WAYPOINT');
  // Build a ternary chain like: Objective>=3 ? '★ ALL CLEAR' : Objective>=2 ? '→ Beacon' : ...
  // (Bound expressions can't call functions — a chain is the simplest CSP-safe way to map a count to a label.)
  const labels = ZONES.map((z) => `'→  ${z.banner.replace(/'/g, "\\'")}'`);
  let wpExpr = `'★  ALL CLEAR'`;
  for (let i = ZONES.length - 1; i >= 0; i--) wpExpr = `Objective <= ${i} ? ${labels[i]} : ${wpExpr}`;
  const wpName = boundElement('text', 'Waypoint Name', {
    color: '#FFFFFF', fontSize: '15px', fontWeight: '800', textAlign: 'right',
    custom: { letterSpacing: '1px', textShadow: `0 0 12px ${BANNER_GOLD}88` },
  }, [{ target: 'text', expression: wpExpr }], `→  ${ZONES[0].banner}`);
  const progressLine = boundElement('text', 'Progress', {
    color: 'rgba(255,220,160,0.7)', fontSize: '11px', fontWeight: '700', textAlign: 'right',
    custom: { letterSpacing: '2px', marginTop: '2px' },
  }, [{ target: 'text', expression: `Objective + ' / ${ZONES.length}'` }], `0 / ${ZONES.length}`);
  wpChip.children = [wpLabel, wpName, progressLine];

  // --- Auto-fading controls hint (fades after ~9s — teaches the controls without becoming clutter). ---
  const hint = uiElement('text', 'Controls', {
    position: 'absolute', left: '50%', color: 'rgba(255,235,200,0.7)', fontSize: '12px', fontWeight: '500', textAlign: 'center',
    custom: { bottom: '14px', transform: 'translateX(-50%)', textShadow: '0 1px 6px rgba(0,0,0,0.85)', animation: 'nf-wasteland-hint 9s ease-in 1s forwards' },
  }, 'W accelerate · S brake / reverse · A / D steer · Space drift · H horn · drive into a beacon');

  root.children = [objPanel, wpChip, speedBox, hint];
  const css = '@keyframes nf-wasteland-hint { 0%,72% { opacity: 1; } 100% { opacity: 0; } }';
  return { id: makeId('ui'), name: 'Driving HUD', surface: 'screen', root, css, visibleOnStart: true, createdAt: Date.now() };
}

// --- Per-zone banner UI: a big centered title + a one-line blurb, hidden by default, shown by the zone's
//     blueprint on trigger, then hidden again on a logic.delay. Accent color matches the zone marker. ---
function createZoneBanner(zone: ZoneDef): UIDocument {
  const root = uiElement('panel', 'Root', {
    width: '100%', height: '100%', position: 'relative', display: 'flex', flexDirection: 'column',
    custom: {
      alignItems: 'center', justifyContent: 'center', gap: '8px',
      background: `radial-gradient(circle at 50% 50%, ${zone.accent}1a 0%, rgba(0,0,0,0) 60%)`,
      pointerEvents: 'none',
    },
  });
  const title = uiElement('text', 'Banner Title', {
    color: '#FFFFFF', fontSize: '64px', fontWeight: '800', textAlign: 'center',
    custom: { letterSpacing: '6px', textShadow: `0 0 28px ${zone.accent}cc, 0 0 60px ${zone.accent}66` },
  }, zone.banner);
  const sub = uiElement('text', 'Banner Sub', {
    color: zone.accent, fontSize: '14px', fontWeight: '700', textAlign: 'center',
    custom: { letterSpacing: '4px', textShadow: `0 0 18px ${zone.accent}88` },
  }, zone.blurb);
  root.children = [title, sub];
  return { id: makeId('ui'), name: `Banner – ${zone.name}`, surface: 'screen', root, css: '', visibleOnStart: false, createdAt: Date.now() };
}

// ============================================================================================================
//  Template builder — orchestrates the asset imports, world build, blueprints, UI, and one atomic commit.
// ============================================================================================================
export async function createDrivingTemplate(): Promise<string | undefined> {
  const store = useEditorStore.getState();
  const folder = store.createFolder('Survivor');

  // --- Import the car body + wheel + SFX (single rig, single SFX set). ---
  const bodyAsset = await importStaticModel(CAR_BODY, folder);
  const wheelAsset = await importStaticModel(CAR_WHEEL, folder);
  if (!bodyAsset || !wheelAsset) throw new Error('Bundled survivor car models not found under public/templates/cars.');
  const engineSound = await importAudio('engine_loop.mp3', folder);
  const skidSound = await importAudio('skid_loop.mp3', folder);
  const brakeSound = await importAudio('brake.mp3', folder);
  const hornSound = await importAudio('horn.mp3', folder);
  const collisionSound = await importAudio('collision.mp3', folder);
  const dingSound = await importAudio('checkpoint.mp3', folder); // reused as the trigger-zone "ping"

  // --- Project variables. Driving gates the controller; Speed is runtime-mirrored from the vehicle pass; ---
  //     Weight is set on event.start so the HUD can display the car's mass; Objective counts cleared zones.
  const drivingVarId = makeId('var');
  const speedVarId = makeId('var');
  const weightVarId = makeId('var');
  const objectiveVarId = makeId('var');
  const mkVar = (id: string, name: string): ProjectVariable => ({ id, name, type: 'number', defaultValue: 0, persistent: false, createdAt: Date.now() });
  const drivingVar = mkVar(drivingVarId, 'Driving');
  const speedVar = mkVar(speedVarId, 'Speed');
  const weightVar = mkVar(weightVarId, 'Weight');
  const objectiveVar = mkVar(objectiveVarId, 'Objective');

  // --- CAR CONTROLLER blueprint. Four cooperating chains visible in the graph:
  //     1) Update → Branch(Driving>0) → Drive(Get Drive Input)  — the auto vehicle pass owns the base motion
  //                                                                (tire grip/slip, wheels, audio pitch, headlights,
  //                                                                brake-light auto-toggle, suspension feel + follow camera).
  //     2) KeyDown Shift → Apply Impulse Local +Z 60             — a REAL physics nitro punch in car-forward space
  //                                                                (impulses bypass the
  //                                                                vehicle's tire model → visible thrust).
  //     3) KeyDown KeyH (horn) → Play Sound + Apply Torque Y 8   — donut-spin demo: a torque kick on top of the
  //                                                                horn. Showcases the new Apply Torque node.
  //     4) Collision Enter → Camera Shake + Apply Impulse +Y 9   — real physics recoil: hit a wreck/pillar,
  //                                                                the car bounces up a touch (mass-scaled).
  //     The Drive node still gates the base driving so the vehicle's wheels/audio/lights stay in sync, while the
  //     three side chains visibly add real Rapier forces — proof the car is a true dynamic physics body, not just
  //     a script-moved rig. Re-route any chain in the graph editor to retune the feel.
  const carGraphId = makeId('graph');
  const carBpId = makeId('bp');
  // Chain 1 (base drive)
  const cUpdate = makeId('node');
  const cGetDriving = makeId('node');
  const cCmp = makeId('node');
  const cBranch = makeId('node');
  const cInput = makeId('node');
  const cDrive = makeId('node');
  // Chain 2 (nitro impulse)
  const cBoostKey = makeId('node');
  const cBoostBranch = makeId('node');
  const cBoostGetDrv = makeId('node');
  const cBoostDrvCmp = makeId('node');
  const cBoostImpulse = makeId('node');
  // Chain 3 (horn + torque)
  const cHornKey = makeId('node');
  const cHornSound = makeId('node');
  const cHornTorque = makeId('node');
  // Chain 4 (collision recoil)
  const cHit = makeId('node');
  const cHitShake = makeId('node');
  const cHitImpulse = makeId('node');

  const carNodes: NodeForgeNode[] = [
    // === Chain 1: base drive (the vehicle pass owns wheels/audio/camera/lights/suspension) ===
    graphNode(cUpdate, 'Update', 'Events', 40, 40, { nodeKind: 'event.update', hasInput: false, description: 'Every frame.' }),
    graphNode(cGetDriving, 'Get Driving', 'Variables', 40, 220, { nodeKind: 'variable.get', variableId: drivingVarId, valueType: 'number', hasInput: false, description: 'Has the game started?' }),
    graphNode(cCmp, 'Driving > 0', 'Logic', 300, 220, { nodeKind: 'logic.compare', compareOp: '>', numberValue: 0, description: 'Gate input on the start signal.' }),
    graphNode(cBranch, 'Branch', 'Logic', 320, 40, { nodeKind: 'logic.branch', description: 'Drive only after the start.' }),
    graphNode(cInput, 'Get Drive Input', 'Runtime', 560, 220, { nodeKind: 'input.driveInput', hasInput: false, description: 'WASD → throttle / steer / handbrake.' }),
    graphNode(cDrive, 'Drive', 'Runtime', 600, 40, { nodeKind: 'action.drive', description: 'Hands the input to the vehicle controller (wheels, audio, headlights, brake lights, suspension feel).' }),

    // === Chain 2: physics nitro — SHIFT held → an instantaneous local Z+ impulse. The body is a real dynamic Rapier
    //     body, so impulses add momentum on top of the vehicle pass. Gated on the throttle so reverse doesn't
    //     pop you forward. ===
    graphNode(cBoostKey, 'Key Down: Shift', 'Events', 40, 440, { nodeKind: 'event.keyDown', keyCode: 'ShiftLeft', hasInput: false, description: 'Hold SHIFT for a physics nitro punch.' }),
    graphNode(cBoostGetDrv, 'Get Drive Input', 'Runtime', 40, 620, { nodeKind: 'input.driveInput', hasInput: false, description: 'Read the WASD vector to gate on throttle.' }),
    graphNode(cBoostDrvCmp, 'Throttle > 0', 'Logic', 280, 620, { nodeKind: 'logic.compare', compareOp: '>', numberValue: 0, description: 'Only nitro when actually accelerating.' }),
    graphNode(cBoostBranch, 'Forward?', 'Logic', 300, 440, { nodeKind: 'logic.branch', description: 'Skip if not throttling.' }),
    graphNode(cBoostImpulse, 'Apply Impulse Local +Z 60', 'Physics', 560, 440, { nodeKind: 'action.applyImpulse', axis: 'z', amount: 60, space: 'local', description: 'A one-shot Rapier impulse in the car’s local forward direction — a real physics shove (mass-scaled).' }),

    // === Chain 3: horn + torque (donut demo). Tap H — the car gets a real Y-axis angular impulse so it
    //     spins; useful as a "physics is here" parlor trick. ===
    graphNode(cHornKey, 'Key Down: H', 'Events', 40, 820, { nodeKind: 'event.keyDown', keyCode: 'KeyH', hasInput: false, description: 'Horn + a Y-axis torque kick (donut spin demo).' }),
    graphNode(cHornSound, 'Honk', 'Audio', 280, 820, { nodeKind: 'action.playSound', assetId: hornSound?.id, description: 'Horn one-shot.' }),
    graphNode(cHornTorque, 'Apply Torque Y 8', 'Physics', 540, 820, { nodeKind: 'action.applyTorque', axis: 'y', amount: 8, description: 'New node: a Rapier angular impulse around Y — visible physics-driven spin.' }),

    // === Chain 4: collision recoil. Trigger Enter doesn't fire on solid contacts; Collision Enter does. ===
    graphNode(cHit, 'Collision Enter', 'Events', 40, 1020, { nodeKind: 'event.collisionEnter', hasInput: false, description: 'A solid contact this frame (a wreck, pillar, drum, or another car).' }),
    graphNode(cHitShake, 'Camera Shake 0.4', 'Runtime', 280, 1020, { nodeKind: 'action.cameraShake', shakeAmount: 0.4, description: 'A small camera punch on impact.' }),
    graphNode(cHitImpulse, 'Apply Impulse +Y 9', 'Physics', 540, 1020, { nodeKind: 'action.applyImpulse', axis: 'y', amount: 9, description: 'Real physics recoil — the body actually hops on impact (the heavier the car, the smaller the hop).' }),
  ];
  const carEdges: Edge[] = [
    // Chain 1
    execEdge(cUpdate, cBranch),
    valueEdge(cGetDriving, cCmp, 'a'),
    valueEdge(cCmp, cBranch, 'condition'),
    execEdge(cBranch, cDrive),
    valueEdge(cInput, cDrive, 'vector'),
    // Chain 2
    execEdge(cBoostKey, cBoostBranch),
    valueEdge(cBoostGetDrv, cBoostDrvCmp, 'a'),
    valueEdge(cBoostDrvCmp, cBoostBranch, 'condition'),
    execEdge(cBoostBranch, cBoostImpulse),
    // Chain 3
    execEdge(cHornKey, cHornSound),
    execEdge(cHornSound, cHornTorque),
    // Chain 4
    execEdge(cHit, cHitShake),
    execEdge(cHitShake, cHitImpulse),
  ];
  const carGraph: ProjectGraph = { id: carGraphId, name: 'Survivor Controller', nodes: carNodes, edges: carEdges };
  const carBlueprint: ScriptBlueprint = {
    id: carBpId,
    name: 'Survivor Controller',
    description: 'Physics-first car: WASD drives (auto vehicle pass = wheels/audio/lights/camera), SHIFT applies a Rapier impulse (real nitro), H + Apply Torque spins the body, and Collision Enter adds a physics recoil hop.',
    graphId: carGraphId,
    color: EMBER,
    createdAt: Date.now(),
  };

  // --- GAME START blueprint (one empty object hosts it): on event.start, set Driving=1 + Weight=CAR_MASS so
  //     the HUD lights up immediately and the car can be driven. Keep this one tiny — it's a clean reference
  //     for users to see how a single boot script works. ---
  const startGraphId = makeId('graph');
  const startBpId = makeId('bp');
  const sStart = makeId('node');
  const sSetDriving = makeId('node');
  const sSetWeight = makeId('node');
  const sPlayIntro = makeId('node');
  const startNodes: NodeForgeNode[] = [
    graphNode(sStart, 'On Start', 'Events', 40, 40, { nodeKind: 'event.start', hasInput: false, description: 'Once, when Play begins.' }),
    graphNode(sSetDriving, 'Driving = 1', 'Variables', 300, 40, { nodeKind: 'variable.set', variableId: drivingVarId, valueType: 'number', numberValue: 1, description: 'Unlock input.' }),
    graphNode(sSetWeight, `Weight = ${CAR_MASS}`, 'Variables', 580, 40, { nodeKind: 'variable.set', variableId: weightVarId, valueType: 'number', numberValue: CAR_MASS, description: 'Surface the car mass to the HUD.' }),
    graphNode(sPlayIntro, 'Play Car Intro', 'Runtime', 860, 40, { nodeKind: 'action.playCinematic', description: 'Editable Film Mode intro: low car orbit, dust fade, and gameplay handoff.' }),
  ];
  const startEdges: Edge[] = [execEdge(sStart, sSetDriving), execEdge(sSetDriving, sSetWeight), execEdge(sSetWeight, sPlayIntro)];
  const startGraph: ProjectGraph = { id: startGraphId, name: 'Game Start', nodes: startNodes, edges: startEdges };
  const startBlueprint: ScriptBlueprint = { id: startBpId, name: 'Game Start', description: 'On game start: enable driving + publish the car weight to the HUD.', graphId: startGraphId, color: BANNER_GOLD, createdAt: Date.now() };

  // --- ZONE CINEMATIC blueprints (one per zone). Each chain is:
  //     1) Trigger Enter           — the car drove into the pad
  //     2) Camera Shake            — cinematic punch (size per zone)
  //     3) Play Ping               — the bundled chime
  //     4) Apply Impulse +Y (opt)  — a real Rapier vertical kick on $trigger (the toucher = the car) for a
  //                                  "shockwave" hop. The RADIATION ZONE pad has the biggest bounce.
  //     5) Set Environment (patch) — atmosphere shift (sky/fog/sun) using the NEW action.setEnvironment node
  //     6) Show Banner             — bold styled overlay
  //     7) Objective += 1          — drives the HUD checklist + waypoint chip
  //     8) Delay zone.dwell        — let the moment breathe
  //     9) Hide Banner             — back to driving
  //    10) Set Environment (base)  — restore the keys this zone touched from BASE_ENV (cleanup)
  //    The trigger object lives in the world (placed by buildWasteland), and we point it at this blueprint.
  const zoneBanners: UIDocument[] = ZONES.map((z) => createZoneBanner(z));

  const zoneBlueprints: ScriptBlueprint[] = [];
  const zoneGraphs: ProjectGraph[] = [];
  const zoneScriptRefs: Array<{ blueprintId: string; graphId: string }> = [];
  ZONES.forEach((zone, i) => {
    const banner = zoneBanners[i];
    const graphId = makeId('graph');
    const bpId = makeId('bp');
    const n = (label: string, cat: GraphNodeCategory, x: number, y: number, data: Partial<NodeForgeNodeData>) => {
      const id = makeId('node');
      return graphNode(id, label, cat, x, y, data);
    };
    // Restore patch: only the keys THIS zone modified, snapped back to BASE_ENV values.
    const restorePatch: Record<string, string | number | boolean> = {};
    for (const key of Object.keys(zone.env)) {
      if (Object.prototype.hasOwnProperty.call(BASE_ENV, key)) restorePatch[key] = BASE_ENV[key]!;
    }

    const evNode = n('On Driven Into', 'Events', 40, 40, { nodeKind: 'event.triggerEnter', hasInput: false, description: `A vehicle entered ${zone.name}.` });
    const shake = n(`Camera Shake ${zone.shake}`, 'Runtime', 280, 40, { nodeKind: 'action.cameraShake', shakeAmount: zone.shake, description: 'Cinematic punch.' });
    const ping = n('Play Ping', 'Audio', 520, 40, { nodeKind: 'action.playSound', assetId: dingSound?.id, description: 'Confirm chime.' });
    const setEnv = n('Set Environment', 'Runtime', 1000, 40, { nodeKind: 'action.setEnvironment', envPatch: zone.env, description: 'New node: crossfade the sky/fog/sun into the zone palette.' });
    const showBanner = n('Show Banner', 'UI', 1260, 40, { nodeKind: 'ui.show', documentId: banner.id, description: `Reveal the ${zone.banner} banner.` });
    const getObj = n('Get Objective', 'Variables', 1500, 200, { nodeKind: 'variable.get', variableId: objectiveVarId, valueType: 'number', hasInput: false });
    const addObj = n('+ 1', 'Math', 1740, 200, { nodeKind: 'math.add', amount: 1, hasInput: false, description: 'Advance the objective.' });
    const setObj = n('Set Objective', 'Variables', 1500, 40, { nodeKind: 'variable.set', variableId: objectiveVarId, valueType: 'number', description: 'Tick the checklist.' });
    const delay = n(`Hold ${zone.dwell}s`, 'Logic', 1780, 40, { nodeKind: 'logic.delay', numberValue: zone.dwell, description: 'Let the banner read and the atmosphere settle.' });
    const hideBanner = n('Hide Banner', 'UI', 2060, 40, { nodeKind: 'ui.hide', documentId: banner.id, description: 'Back to driving.' });
    const restoreEnv = n('Restore Environment', 'Runtime', 2300, 40, { nodeKind: 'action.setEnvironment', envPatch: restorePatch, description: 'Crossfade the touched env keys back to the apocalyptic dusk default.' });

    const nodes: NodeForgeNode[] = [evNode, shake, ping];
    const edges: Edge[] = [execEdge(evNode.id, shake.id), execEdge(shake.id, ping.id)];

    // Optional physics bounce on $trigger (the toucher = the car). RADIATION ZONE has the strongest hop.
    let pingNext = ping.id;
    if (zone.bounceY > 0) {
      const bounce = n(`Apply Impulse +Y ${zone.bounceY}`, 'Physics', 760, 40, {
        nodeKind: 'action.applyImpulse',
        axis: 'y',
        amount: zone.bounceY,
        targetObjectId: '$trigger',
        description: "Real Rapier impulse on the toucher ($trigger) — a physics-driven shockwave bounce.",
      });
      nodes.push(bounce);
      edges.push(execEdge(ping.id, bounce.id), execEdge(bounce.id, setEnv.id));
      pingNext = bounce.id;
    } else {
      edges.push(execEdge(ping.id, setEnv.id));
    }
    void pingNext;

    nodes.push(setEnv, showBanner, getObj, addObj, setObj, delay, hideBanner, restoreEnv);
    edges.push(
      execEdge(setEnv.id, showBanner.id),
      execEdge(showBanner.id, setObj.id),
      valueEdge(getObj.id, addObj.id, 'a'),
      valueEdge(addObj.id, setObj.id, 'value'),
      execEdge(setObj.id, delay.id),
      execEdge(delay.id, hideBanner.id),
      execEdge(hideBanner.id, restoreEnv.id),
    );

    const graph: ProjectGraph = { id: graphId, name: `${zone.name} Cinematic`, nodes, edges };
    const blueprint: ScriptBlueprint = {
      id: bpId,
      name: `${zone.name} Cinematic`,
      description: 'On enter: shake → ping → physics impulse on the toucher → set environment → banner → Objective + 1 → delay → hide + restore env.',
      graphId,
      color: zone.accent,
      createdAt: Date.now(),
    };
    zoneBlueprints.push(blueprint);
    zoneGraphs.push(graph);
    zoneScriptRefs.push({ blueprintId: bpId, graphId });
  });

  // --- Build the car. ---
  const carSounds: CarSounds = {
    engineSoundId: engineSound?.id,
    skidSoundId: skidSound?.id,
    brakeSoundId: brakeSound?.id,
    hornSoundId: hornSound?.id,
    collisionSoundId: collisionSound?.id,
  };
  const { rootId: carId, objects: carObjects } = await buildCar(bodyAsset, wheelAsset, { blueprintId: carBpId, graphId: carGraphId }, carSounds);
  const carIntro = createCarIntroCinematic(carId);
  startGraph.nodes.forEach((node) => {
    if (node.id === sPlayIntro) node.data.cinematicId = carIntro.id;
  });

  // --- Flat ground. Big single slab + single box collider — same reason as before (no streamed terrain that
  //     regenerates while driving). Fog hides the far edges so the wasteland still feels open. ---
  const ground = box('Ground', [0, -1, 60], [3200, 2, 3200], '#0c0a08', { metalness: 0, roughness: 1, physics: fixedBox() });

  // --- Build the wasteland (props + zone triggers). ---
  const wastelandObjects = buildWasteland(zoneScriptRefs);

  // --- A start-script holder (an empty object that hosts the Game Start blueprint). ---
  const startObject: SceneObject = {
    id: makeId('obj'),
    name: 'Game Start',
    kind: 'empty',
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    script: { blueprintId: startBpId, graphId: startGraphId, enabled: true },
  };

  // --- UI documents: the always-visible HUD + three (initially hidden) zone banners. ---
  const hud = createWastelandHud(CAR_MASS);

  // --- Commit everything atomically (vars + blueprints + graphs + UI + scene objects + apocalyptic env). ---
  useEditorStore.setState((draft) => ({
    variables: [...draft.variables, drivingVar, speedVar, weightVar, objectiveVar],
    blueprints: [...draft.blueprints, carBlueprint, startBlueprint, ...zoneBlueprints],
    graphs: [...draft.graphs, carGraph, startGraph, ...zoneGraphs],
    activeBlueprintId: carBpId,
    uiDocuments: [...draft.uiDocuments, hud, ...zoneBanners],
    activeUIDocumentId: hud.id,
    scenes: draft.scenes.map((scene) =>
      scene.id === draft.activeSceneId
        ? {
            ...scene,
            objects: [...scene.objects, ground, ...wastelandObjects, startObject, ...carObjects],
            cinematics: [...(scene.cinematics ?? []), carIntro],
            environment: {
              ...defaultSceneEnvironment(),
              skyMode: 'procedural',
              // Apocalyptic dusk (BASE_ENV is the single source of truth — each zone's cinematic restores
              // its modified keys from the same constant, so the world reverts cleanly after the dwell).
              ...BASE_ENV,
            } as SceneEnvironmentSettings,
          }
        : scene,
    ),
    selectedObjectId: carId,
    activeCinematicId: carIntro.id,
    isDirty: true,
  }));

  // Punchy ember post: strong bloom (low threshold so drum fires, beacon pillars and lane cracks glow) + a
  // cinematic vignette to frame the dark wasteland.
  store.updateRenderSettings({ bloomEnabled: true, bloomIntensity: 0.95, bloomThreshold: 0.55, bloomRadius: 0.75, vignetteEnabled: true });

  return carId;
}
