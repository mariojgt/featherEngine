import type { Edge } from '@xyflow/react';
import * as THREE from 'three';
import { GLTFLoader } from 'three-stdlib';
import { getPlatform } from '../platform';
import { defaultVehicle, useEditorStore } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import { defaultSceneEnvironment } from '../three/environmentSettings';
import { defaultTerrain, withTerrainDefaults } from '../terrain/terrain';
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
  SceneObject,
  ScriptBlueprint,
  UIDocument,
  UIElement,
  VehicleComponent,
  Vector3Tuple,
} from '../types';

const makeId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

const CARS_DIR = 'templates/cars';

// --- Bundled low-poly car kit (public/templates/cars): each car is a body GLB + a wheel GLB. ---
interface CarDef {
  body: string;
  wheel: string;
  name: string;
  /** Hue accent shown on the menu button. */
  accent: string;
}
const CARS: CarDef[] = [
  { body: 'CarModel1_body.glb', wheel: 'CarModel1_wheel.glb', name: 'Coupe', accent: '#27E0FF' },
  { body: 'CarModel2_body.glb', wheel: 'CarModel2_wheel.glb', name: 'Hatch', accent: '#FF8A3D' },
  { body: 'CarModel3_body.glb', wheel: 'CarModel3_wheel.glb', name: 'Sport', accent: '#FF5A5F' },
  { body: 'Ban_body.glb', wheel: 'Ban_wheel.glb', name: 'Ban', accent: '#FFD166' },
  { body: 'Furgon1_body.glb', wheel: 'Furgon1_wheel.glb', name: 'Van', accent: '#9bd0ff' },
];

const defaultRenderer = (mesh: MeshRendererComponent['mesh'], color: string): MeshRendererComponent => ({
  enabled: true,
  mesh,
  color,
  metalness: 0.1,
  roughness: 0.7,
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

/** Import a static (non-rigged) bundled model once, reusing it if already imported. Returns the asset. */
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

interface ModelBounds {
  min: Vector3Tuple;
  max: Vector3Tuple;
}

/** Load a bundled GLB and measure its world-space bounding box, so wheels/lights can be placed at the
 *  car body's real corners (the models differ in size) instead of hard-coded guesses. */
async function measureModel(file: string): Promise<ModelBounds | undefined> {
  try {
    const response = await fetch(`${CARS_DIR}/${file}`);
    if (!response.ok) return undefined;
    const buffer = await response.arrayBuffer();
    const loader = new GLTFLoader();
    const gltf = await new Promise<{ scene: THREE.Object3D }>((resolve, reject) =>
      loader.parse(buffer, '', (g) => resolve(g as unknown as { scene: THREE.Object3D }), reject),
    );
    const box = new THREE.Box3().setFromObject(gltf.scene);
    if (!Number.isFinite(box.min.x) || !Number.isFinite(box.max.x)) return undefined;
    return { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] };
  } catch {
    return undefined;
  }
}

/** Import a bundled audio clip once (e.g. the engine loop), reusing it if already imported. */
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

/** Bottom-center speedometer + a controls hint. The speed binds to the project `Speed` variable, which the
 *  runtime mirrors from the driven car's velocity. */
function createDrivingHud(): UIDocument {
  const root = uiElement('panel', 'Root', { width: '100%', height: '100%', position: 'relative', padding: '0' });
  const speedBox = uiElement('panel', 'Speed Box', {
    position: 'absolute', left: '50%', display: 'flex', flexDirection: 'column',
    custom: { bottom: '54px', transform: 'translateX(-50%)', alignItems: 'center', gap: '2px' },
  });
  const speed = boundElement('text', 'Speed', {
    color: '#FFFFFF', fontSize: '42px', fontWeight: '800', textAlign: 'center',
    custom: { textShadow: '0 2px 10px rgba(0,0,0,0.8)' },
  }, [{ target: 'text', expression: `Speed` }], '0');
  const unit = uiElement('text', 'Unit', {
    color: 'rgba(255,255,255,0.7)', fontSize: '13px', fontWeight: '700', textAlign: 'center',
    custom: { letterSpacing: '2px' },
  }, 'KM / H');
  speedBox.children = [speed, unit];
  const hint = uiElement('text', 'Controls', {
    position: 'absolute', left: '50%', color: 'rgba(255,255,255,0.72)', fontSize: '12px', fontWeight: '500', textAlign: 'center',
    custom: { bottom: '20px', transform: 'translateX(-50%)', textShadow: '0 1px 4px rgba(0,0,0,0.7)' },
  }, 'W accelerate · S brake / reverse · A / D steer · Space handbrake (drift) · H horn · Mouse look');

  // Top-left race panel: lap count + current/best lap time, bound to the runtime-mirrored vars.
  const racePanel = uiElement('panel', 'Race Panel', {
    position: 'absolute', display: 'flex', flexDirection: 'column',
    background: 'rgba(12,16,24,0.6)', borderRadius: '12px', padding: '12px 16px',
    custom: { top: '18px', left: '18px', gap: '4px', backdropFilter: 'blur(4px)', border: '1px solid rgba(255,255,255,0.12)' },
  });
  const lapRow = boundElement('text', 'Lap', {
    color: '#FFFFFF', fontSize: '22px', fontWeight: '800', custom: { letterSpacing: '0.5px' },
  }, [{ target: 'text', expression: `'LAP  ' + (Lap + 1)` }], 'LAP  1');
  const timeRow = boundElement('text', 'Lap Time', {
    color: '#27E0FF', fontSize: '15px', fontWeight: '700',
  }, [{ target: 'text', expression: `'TIME  ' + LapTime + 's'` }], 'TIME  0s');
  const bestRow = boundElement('text', 'Best Lap', {
    color: 'rgba(255,209,102,0.95)', fontSize: '13px', fontWeight: '600',
  }, [{ target: 'text', expression: `'BEST  ' + BestLap + 's'` }], 'BEST  0s');
  racePanel.children = [lapRow, timeRow, bestRow];

  root.children = [speedBox, hint, racePanel];
  return { id: makeId('ui'), name: 'Driving HUD', surface: 'screen', root, css: '', visibleOnStart: true, createdAt: Date.now() };
}

/** "Choose your car" start menu: a centered panel with one button per car. Each button fires a custom
 *  event (`selectCar{i}`) that the Menu Logic blueprint listens for. */
function createCarMenu(): { doc: UIDocument; events: string[] } {
  const events = CARS.map((_, i) => `selectCar${i}`);
  const root = uiElement('panel', 'Root', {
    width: '100%', height: '100%', position: 'relative', display: 'flex', flexDirection: 'column',
    custom: { alignItems: 'center', justifyContent: 'center', gap: '18px', background: 'radial-gradient(circle at 50% 40%, rgba(10,14,22,0.55) 0%, rgba(6,8,13,0.9) 100%)' },
  });
  const title = uiElement('text', 'Title', {
    color: '#FFFFFF', fontSize: '34px', fontWeight: '800', textAlign: 'center',
    custom: { letterSpacing: '1px', textShadow: '0 2px 16px rgba(0,0,0,0.8)' },
  }, '🏁  CHOOSE YOUR CAR');
  const sub = uiElement('text', 'Subtitle', {
    color: 'rgba(255,255,255,0.62)', fontSize: '14px', fontWeight: '500', textAlign: 'center',
  }, 'Pick a ride, then drive the open world');
  const rowWrap = uiElement('panel', 'Cars', {
    display: 'flex', flexDirection: 'row', custom: { gap: '14px', flexWrap: 'wrap', justifyContent: 'center', maxWidth: '760px' },
  });
  rowWrap.children = CARS.map((car, i) => {
    const button = uiElement('button', `Pick ${car.name}`, {
      width: '128px', height: '92px', borderRadius: '14px', color: '#FFFFFF', fontSize: '17px', fontWeight: '700',
      background: 'rgba(20,24,34,0.82)', border: `2px solid ${car.accent}`,
      display: 'flex', flexDirection: 'column',
      custom: { alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: `0 6px 20px ${car.accent}33` },
    }, `🚗\n${car.name}`);
    button.onClickEvent = events[i];
    return button;
  });
  root.children = [title, sub, rowWrap];
  return { doc: { id: makeId('ui'), name: 'Car Select', surface: 'screen', root, css: '', visibleOnStart: true, createdAt: Date.now() }, events };
}

/**
 * Build a ready-to-play arcade DRIVING starter from the bundled low-poly car kit: a start menu to pick one
 * of 5 cars, an infinite procedurally-streamed terrain world to drive, WASD + mouse-orbit driving with a
 * sense of suspension (chassis squat/dive/lean + spinning, steering wheels), headlights, brake lights, and a
 * speedometer HUD. Returns the first (default) car's object id. Requires a project to be open.
 */
/**
 * Build a marked race circuit: a stadium oval whose START STRAIGHT runs +Z out of the car-select grid (cars
 * spawn across it like a starting grid). Returns the scene objects (edge cones, checkpoint gate posts, the
 * start/finish gate + line) plus the checkpoint count. Checkpoints are invisible "Checkpoint N" markers at the
 * centerline — the runtime detects the driven car passing them in order (0 = start/finish) to time laps.
 * Cones are DYNAMIC + light so the car knocks them flying (and the collision SFX fires); posts/banners are
 * decorative. The whole loop sits in +X of the start line so the return straight never overlaps the grid.
 */
function buildTrack(): { objects: SceneObject[]; checkpointCount: number } {
  const HALF_W = 13; // track half-width (the grid + drive lane)
  const STRAIGHT = 150; // length of each straight (along Z)
  const RC = 46; // curve radius (= half the gap between the two straights)
  type Sample = { x: number; z: number; tx: number; tz: number };
  const samples: Sample[] = [];
  const nStraight = 25;
  const nArc = 18;
  // 1) Start straight: (0,0) → (0,STRAIGHT), heading +Z.
  for (let i = 0; i < nStraight; i++) samples.push({ x: 0, z: (i / nStraight) * STRAIGHT, tx: 0, tz: 1 });
  // 2) Top 180° curve, center (RC,STRAIGHT), θ: π → 0.
  for (let i = 0; i < nArc; i++) {
    const th = Math.PI * (1 - i / nArc);
    samples.push({ x: RC + RC * Math.cos(th), z: STRAIGHT + RC * Math.sin(th), tx: Math.sin(th), tz: -Math.cos(th) });
  }
  // 3) Return straight: (2RC,STRAIGHT) → (2RC,0), heading -Z.
  for (let i = 0; i < nStraight; i++) samples.push({ x: 2 * RC, z: STRAIGHT - (i / nStraight) * STRAIGHT, tx: 0, tz: -1 });
  // 4) Bottom 180° curve, center (RC,0), θ: 0 → -π (closes back to the start).
  for (let i = 0; i < nArc; i++) {
    const th = -Math.PI * (i / nArc);
    samples.push({ x: RC + RC * Math.cos(th), z: RC * Math.sin(th), tx: Math.sin(th), tz: -Math.cos(th) });
  }

  const objects: SceneObject[] = [];
  // Edge cones: knockable dynamic markers down both sides of the track.
  samples.forEach((s, i) => {
    if (i % 3 !== 0) return;
    const nx = -s.tz; // left normal (tangent rotated +90°)
    const nz = s.tx;
    [-1, 1].forEach((side) => {
      const px = s.x + side * HALF_W * nx;
      const pz = s.z + side * HALF_W * nz;
      objects.push({
        id: makeId('obj'),
        name: 'Cone',
        kind: 'cube',
        transform: { position: [px, 0.5, pz], rotation: [0, 0, 0], scale: [0.34, 1, 0.34] },
        renderer: { ...defaultRenderer('cube', '#ff7a1a'), materialOverrides: { emissiveColor: '#ff5a00', emissiveIntensity: 0.5 } },
        physics: { enabled: true, bodyType: 'dynamic', collider: 'box', isTrigger: false, collisionLayer: 0, collisionMask: 0xffff, mass: 0.4, gravityScale: 1, friction: 0.6, linearDamping: 0.2, angularDamping: 0.3 },
      });
    });
  });

  // Checkpoints (incl. the start/finish at index 0): an invisible centerline marker the runtime times against,
  // flanked by two tall glowing gate posts so the player can see where to aim.
  const cpFractions = [0, 0.28, 0.5, 0.78];
  const cpColors = ['#ffffff', '#27E0FF', '#FFD166', '#FF5A5F'];
  cpFractions.forEach((frac, cpIdx) => {
    const s = samples[Math.round(frac * samples.length) % samples.length];
    const nx = -s.tz;
    const nz = s.tx;
    // Detection marker (invisible — the lap timer reads its XZ position).
    objects.push({
      id: makeId('obj'),
      name: `Checkpoint ${cpIdx}`,
      kind: 'empty',
      transform: { position: [s.x, 0, s.z], rotation: [0, 0, 0], scale: [1, 1, 1] },
    });
    // Two gate posts at the edges.
    [-1, 1].forEach((side) => {
      objects.push({
        id: makeId('obj'),
        name: cpIdx === 0 ? 'Start Post' : `CP ${cpIdx} Post`,
        kind: 'cube',
        transform: { position: [s.x + side * HALF_W * nx, 2.4, s.z + side * HALF_W * nz], rotation: [0, 0, 0], scale: [0.4, 4.8, 0.4] },
        renderer: { ...defaultRenderer('cube', cpColors[cpIdx]), materialOverrides: { emissiveColor: cpColors[cpIdx], emissiveIntensity: 1.6 } },
      });
    });
  });

  // Start/finish line: a checkered strip across the track at (0,0) + an overhead banner.
  const startS = samples[0];
  objects.push({
    id: makeId('obj'),
    name: 'Start Line',
    kind: 'cube',
    transform: { position: [startS.x, 0.06, startS.z], rotation: [0, 0, 0], scale: [HALF_W * 2, 0.12, 1.4] },
    renderer: { ...defaultRenderer('cube', '#f5f5f5'), metalness: 0, roughness: 0.9 },
  });
  objects.push({
    id: makeId('obj'),
    name: 'Start Banner',
    kind: 'cube',
    transform: { position: [startS.x, 5.4, startS.z], rotation: [0, 0, 0], scale: [HALF_W * 2 + 1.2, 1.1, 0.4] },
    renderer: { ...defaultRenderer('cube', '#111418'), materialOverrides: { emissiveColor: '#27E0FF', emissiveIntensity: 0.6 } },
  });

  return { objects, checkpointCount: cpFractions.length };
}

export async function createDrivingTemplate(): Promise<string | undefined> {
  const store = useEditorStore.getState();
  const carsFolder = store.createFolder('Cars');

  // --- Import every car body + wheel model. ---
  interface BuiltCar extends CarDef { bodyAsset: AssetItem; wheelAsset: AssetItem; }
  const built: BuiltCar[] = [];
  for (const car of CARS) {
    const bodyAsset = await importStaticModel(car.body, carsFolder);
    const wheelAsset = await importStaticModel(car.wheel, carsFolder);
    if (bodyAsset && wheelAsset) built.push({ ...car, bodyAsset, wheelAsset });
  }
  if (!built.length) throw new Error('Bundled car models not found under public/templates/cars.');

  // Car SFX set: the engine + skid are looped by the runtime (engine pitch ∝ speed, skid volume ∝ drift slip);
  // brake/horn/collision are one-shots; lap_complete/checkpoint are fired by the lap timer (looked up by name).
  const engineSound = await importAudio('engine_loop.mp3', carsFolder);
  const skidSound = await importAudio('skid_loop.mp3', carsFolder);
  const brakeSound = await importAudio('brake.mp3', carsFolder);
  const hornSound = await importAudio('horn.mp3', carsFolder);
  const collisionSound = await importAudio('collision.mp3', carsFolder);
  // Imported so the runtime lap timer can find them by name (it plays them on lap / checkpoint).
  await importAudio('lap_complete.mp3', carsFolder);
  await importAudio('checkpoint.mp3', carsFolder);

  // --- Project variables: Driving gate (0 until a car is chosen) + Speed (HUD speedometer). ---
  const drivingVarId = makeId('var');
  const speedVarId = makeId('var');
  const drivingVar: ProjectVariable = { id: drivingVarId, name: 'Driving', type: 'number', defaultValue: 0, persistent: false, createdAt: Date.now() };
  const speedVar: ProjectVariable = { id: speedVarId, name: 'Speed', type: 'number', defaultValue: 0, persistent: false, createdAt: Date.now() };
  // Lap-timer variables — the runtime mirrors these from the driven car passing the "Checkpoint N" markers
  // (see the lap pass in tickRuntime). The HUD binds to them. BestLap persists so a record survives restarts.
  const lapVar: ProjectVariable = { id: makeId('var'), name: 'Lap', type: 'number', defaultValue: 0, persistent: false, createdAt: Date.now() };
  const checkpointVar: ProjectVariable = { id: makeId('var'), name: 'Checkpoint', type: 'number', defaultValue: 1, persistent: false, createdAt: Date.now() };
  const lapTimeVar: ProjectVariable = { id: makeId('var'), name: 'LapTime', type: 'number', defaultValue: 0, persistent: false, createdAt: Date.now() };
  const bestLapVar: ProjectVariable = { id: makeId('var'), name: 'BestLap', type: 'number', defaultValue: 0, persistent: true, createdAt: Date.now() };

  // --- Editable CAR CONTROLLER blueprint (shared by every car). This is the visible driving logic the
  //     user (and the AI) can open + rewire: every frame, IF the Driving variable is on, Drive the car with
  //     WASD. The Vehicle component only supplies the physics/suspension feel — the INPUT + flow live here. ---
  const carGraphId = makeId('graph');
  const carBpId = makeId('bp');
  const cUpdate = makeId('node');
  const cGetDriving = makeId('node');
  const cCmp = makeId('node');
  const cBranch = makeId('node');
  const cInput = makeId('node');
  const cDrive = makeId('node');
  const carNodes: NodeForgeNode[] = [
    graphNode(cUpdate, 'Update', 'Events', 40, 40, { nodeKind: 'event.update', hasInput: false, description: 'Every frame.' }),
    graphNode(cGetDriving, 'Get Variable', 'Variables', 40, 220, { nodeKind: 'variable.get', variableId: drivingVarId, valueType: 'number', hasInput: false, description: 'Is driving enabled?' }),
    graphNode(cCmp, 'Compare', 'Logic', 300, 220, { nodeKind: 'logic.compare', compareOp: '>', numberValue: 0, description: 'Driving > 0 (a car was chosen).' }),
    graphNode(cBranch, 'Branch', 'Logic', 320, 40, { nodeKind: 'logic.branch', description: 'Only drive once a car is selected.' }),
    graphNode(cInput, 'Get Drive Input', 'Runtime', 560, 220, { nodeKind: 'input.driveInput', hasInput: false, description: 'WASD → throttle / steer / handbrake.' }),
    graphNode(cDrive, 'Drive', 'Runtime', 600, 40, { nodeKind: 'action.drive', description: 'Drive this car from the input (physics + suspension handled by the Vehicle controller).' }),
  ];
  const carEdges: Edge[] = [
    execEdge(cUpdate, cBranch),
    valueEdge(cGetDriving, cCmp, 'a'),
    valueEdge(cCmp, cBranch, 'condition'),
    execEdge(cBranch, cDrive),
    valueEdge(cInput, cDrive, 'vector'),
  ];
  const carGraph: ProjectGraph = { id: carGraphId, name: 'Car Controller', nodes: carNodes, edges: carEdges };
  const carBlueprint: ScriptBlueprint = { id: carBpId, name: 'Car Controller', description: 'Drive the car with WASD when Driving is on. Edit these nodes to customize controls.', graphId: carGraphId, color: '#FF8A3D', createdAt: Date.now() };

  // --- Build each car: a body root (KINEMATIC — the vehicle pass fully drives it so it never fights the
  //     physics solver) + 4 wheels + 2 headlights (spot) + 2 brake lights (emissive). Wheel/light positions
  //     come from the body model's MEASURED bounding box so they sit at the real corners (cars differ in
  //     size). All cars want the follow camera; only the chosen one survives selection. ---
  const allObjects: SceneObject[] = [];
  const carRootIds: string[] = [];
  let carIndex = 0;
  for (const car of built) {
    const i = carIndex++;
    const rootId = makeId('obj');
    carRootIds.push(rootId);
    const showcaseX = (i - (built.length - 1) / 2) * 4.6;

    const body = await measureModel(car.body);
    const wheelBox = await measureModel(car.wheel);
    const min = body?.min ?? [-0.9, -0.4, -2];
    const max = body?.max ?? [0.9, 1.1, 2];
    const cx = (min[0] + max[0]) / 2;
    const cy = (min[1] + max[1]) / 2;
    const cz = (min[2] + max[2]) / 2;
    const halfW = (max[0] - min[0]) / 2;
    const halfL = (max[2] - min[2]) / 2;
    const wheelR = wheelBox ? Math.max(wheelBox.max[1] - wheelBox.min[1], wheelBox.max[0] - wheelBox.min[0]) / 2 : 0.35;
    const sideX = halfW * 0.84;
    const frontZ = cz + halfL * 0.66;
    const rearZ = cz - halfL * 0.66;
    const wheelRestY = min[1] + wheelR;

    const wheelIds: string[] = [];
    const steeredIds: string[] = [];
    const headlightIds: string[] = [];
    const brakeIds: string[] = [];

    // 4 wheels [FL, FR, RL, RR] at the measured corners.
    const wheelSpots: Array<{ x: number; z: number; front: boolean }> = [
      { x: cx - sideX, z: frontZ, front: true },
      { x: cx + sideX, z: frontZ, front: true },
      { x: cx - sideX, z: rearZ, front: false },
      { x: cx + sideX, z: rearZ, front: false },
    ];
    const wheels: SceneObject[] = wheelSpots.map((spot, w) => {
      const id = makeId('obj');
      wheelIds.push(id);
      if (spot.front) steeredIds.push(id);
      return {
        id,
        name: `Wheel ${w + 1}`,
        kind: 'cube',
        parentId: rootId,
        transform: { position: [spot.x, wheelRestY, spot.z], rotation: [0, 0, 0], scale: [1, 1, 1] },
        renderer: { ...defaultRenderer('cube', '#15171c'), modelAssetId: car.wheelAsset.id, metalness: 0.5, roughness: 0.6 },
      };
    });

    // 2 headlights (forward-facing spot lights) at the front face.
    const headlights: SceneObject[] = [-1, 1].map((s, h) => {
      const id = makeId('obj');
      headlightIds.push(id);
      const light: LightComponent = { type: 'spot', color: '#fff4d6', intensity: 7, distance: 30, angle: Math.PI / 7, castShadow: false };
      return {
        id,
        name: `Headlight ${h + 1}`,
        kind: 'light',
        parentId: rootId,
        transform: { position: [cx + s * halfW * 0.62, cy, max[2] * 0.98], rotation: [-0.12, 0, 0], scale: [1, 1, 1] },
        light,
      };
    });

    // 2 brake lights (emissive cubes at the rear — the vehicle pass brightens them while braking).
    const brakeLights: SceneObject[] = [-1, 1].map((s, b) => {
      const id = makeId('obj');
      brakeIds.push(id);
      return {
        id,
        name: `Brake Light ${b + 1}`,
        kind: 'cube',
        parentId: rootId,
        transform: { position: [cx + s * halfW * 0.6, cy, min[2] * 0.98], rotation: [0, 0, 0], scale: [Math.max(0.12, halfW * 0.32), 0.12, 0.06] },
        renderer: { ...defaultRenderer('cube', '#3a0c0c'), materialOverrides: { emissiveColor: '#ff2a2a', emissiveIntensity: 0.15 } },
      };
    });

    const vehicle: VehicleComponent = {
      ...defaultVehicle(),
      enabled: true,
      cameraFollow: true,
      // A touch more grunt + a looser handbrake than the bare default, for a satisfying arcade drift.
      maxSpeed: 26,
      acceleration: 14,
      handbrakeGrip: 0.28,
      bodyRoll: 0.09,
      wheelObjectIds: wheelIds,
      steeredWheelIds: steeredIds,
      headlightIds,
      brakeLightIds: brakeIds,
      engineSoundId: engineSound?.id,
      skidSoundId: skidSound?.id,
      brakeSoundId: brakeSound?.id,
      hornSoundId: hornSound?.id,
      collisionSoundId: collisionSound?.id,
      wheelRadius: wheelR,
      rideHeight: -min[1],
      wheelRestY,
      // Chase camera sized to the car: above + behind by roughly the car's length.
      cameraOffset: [0, 2.2 + (max[1] - min[1]), -(halfL * 2 + 5)] as Vector3Tuple,
    };

    const root: SceneObject = {
      id: rootId,
      name: car.name,
      kind: 'cube',
      transform: { position: [showcaseX, 4, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      renderer: { ...defaultRenderer('cube', '#cdd3dc'), modelAssetId: car.bodyAsset.id, metalness: 0.3, roughness: 0.45 },
      // KINEMATIC: the vehicle pass owns the transform (incl. terrain-following Y), so the car can never be
      // launched/jittered by the solver. The convex collider still pushes dynamic props it touches.
      physics: {
        enabled: true, bodyType: 'kinematic', collider: 'convex', isTrigger: false,
        collisionLayer: 0, collisionMask: 0xffff, mass: 4, gravityScale: 1, friction: 0.9, linearDamping: 0, angularDamping: 0,
      },
      vehicle,
      script: { blueprintId: carBpId, graphId: carGraphId, enabled: true },
    };
    allObjects.push(root, ...wheels, ...headlights, ...brakeLights);
  }

  // --- Infinite procedurally-streamed terrain world. Kept nearly FLAT (low heightScale) so the marked race
  //     circuit sits on drivable ground; it still streams around the car so you can also free-roam off-track. ---
  const terrain: SceneObject = {
    id: makeId('obj'),
    name: 'World Terrain',
    kind: 'terrain',
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    terrain: withTerrainDefaults({
      ...defaultTerrain(),
      size: 4096,
      heightScale: 1.1,
      frequency: 0.009,
      streamRadius: 4,
      physicsRadius: 3,
    }),
    physics: { ...fixedBox(), collider: 'mesh' },
  };

  // The marked race circuit: edge cones, checkpoint gate posts, start/finish line + banner. The start straight
  // runs +Z out of the car-select grid, so the chosen car launches straight down it.
  const { objects: trackObjects } = buildTrack();

  // --- Car-select menu + HUD + Menu Logic blueprint. ---
  const hud = createDrivingHud();
  const { doc: menuDoc, events: selectEvents } = createCarMenu();

  // Menu Logic: for each car button event, destroy the OTHER car roots (children cascade), set Driving=1,
  // and hide the menu. After selection only the chosen car remains → it gets the follow camera and drives.
  const menuGraphId = makeId('graph');
  const menuBpId = makeId('bp');
  const menuNodes: NodeForgeNode[] = [];
  const menuEdges: Edge[] = [];
  built.forEach((_, i) => {
    const rowY = i * 200;
    const evNode = makeId('node');
    menuNodes.push(graphNode(evNode, `On ${CARS[i].name} chosen`, 'Events', 40, rowY, { nodeKind: 'event.custom', eventName: selectEvents[i], hasInput: false, description: `Player picked ${CARS[i].name}.` }));
    let chain = evNode;
    let col = 1;
    carRootIds.forEach((rid, j) => {
      if (j === i) return;
      const del = makeId('node');
      menuNodes.push(graphNode(del, 'Destroy Object', 'Runtime', 40 + col * 220, rowY, { nodeKind: 'action.destroyObject', targetObjectId: rid, description: `Remove ${CARS[j].name}.` }));
      menuEdges.push(execEdge(chain, del));
      chain = del;
      col += 1;
    });
    const setDriving = makeId('node');
    menuNodes.push(graphNode(setDriving, 'Set Variable', 'Variables', 40 + col * 220, rowY, { nodeKind: 'variable.set', variableId: drivingVarId, valueType: 'number', numberValue: 1, description: 'Start driving.' }));
    const hide = makeId('node');
    menuNodes.push(graphNode(hide, 'Hide UI', 'UI', 40 + (col + 1) * 220, rowY, { nodeKind: 'ui.hide', documentId: menuDoc.id, description: 'Close the menu.' }));
    menuEdges.push(execEdge(chain, setDriving), execEdge(setDriving, hide));
  });
  const menuGraph: ProjectGraph = { id: menuGraphId, name: 'Menu Logic', nodes: menuNodes, edges: menuEdges };
  const menuBlueprint: ScriptBlueprint = { id: menuBpId, name: 'Menu Logic', description: 'Car-select menu: pick a car to start driving.', graphId: menuGraphId, color: '#27E0FF', createdAt: Date.now() };
  const menuObject: SceneObject = {
    id: makeId('obj'), name: 'Menu Logic', kind: 'empty',
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    script: { blueprintId: menuBpId, graphId: menuGraphId, enabled: true },
  };

  // --- Commit everything atomically (cars + world + menu logic + UI + variables + environment). ---
  const playerCarId = carRootIds[0];
  useEditorStore.setState((draft) => ({
    variables: [...draft.variables, drivingVar, speedVar, lapVar, checkpointVar, lapTimeVar, bestLapVar],
    blueprints: [...draft.blueprints, carBlueprint, menuBlueprint],
    graphs: [...draft.graphs, carGraph, menuGraph],
    activeBlueprintId: carBpId,
    uiDocuments: [...draft.uiDocuments, hud, menuDoc],
    activeUIDocumentId: menuDoc.id,
    scenes: draft.scenes.map((scene) =>
      scene.id === draft.activeSceneId
        ? {
            ...scene,
            objects: [...scene.objects, terrain, ...trackObjects, menuObject, ...allObjects],
            environment: {
              ...defaultSceneEnvironment(),
              skyMode: 'procedural',
              skyTopColor: '#3f78d8',
              skyHorizonColor: '#cfe0f0',
              sunIntensity: 1.3,
              sunElevation: 42,
              sunAzimuth: 50,
              fogEnabled: true,
              fogColor: '#aebfce',
              fogNear: 90,
              fogFar: 460,
            },
          }
        : scene,
    ),
    selectedObjectId: playerCarId,
    isDirty: true,
  }));

  return playerCarId;
}
