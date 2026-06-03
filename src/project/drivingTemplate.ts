import type { Edge } from '@xyflow/react';
import * as THREE from 'three';
import { GLTFLoader } from 'three-stdlib';
import { getPlatform } from '../platform';
import { defaultVehicle, useEditorStore } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import { defaultSceneEnvironment } from '../three/environmentSettings';
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
  // Bottom-center speedometer: a rounded glass pill holding the big speed number + a KM/H unit, with a thin
  // accent rule between them. Binds to the runtime-mirrored `Speed` variable.
  const speedBox = uiElement('panel', 'Speed Box', {
    position: 'absolute', left: '50%', display: 'flex', flexDirection: 'column',
    background: 'rgba(10,14,22,0.55)', borderRadius: '16px',
    custom: {
      bottom: '48px', transform: 'translateX(-50%)', alignItems: 'center', gap: '2px',
      padding: '10px 30px 12px', backdropFilter: 'blur(6px)', border: '1px solid rgba(255,255,255,0.14)',
      boxShadow: '0 10px 32px rgba(0,0,0,0.45)',
    },
  });
  const speed = boundElement('text', 'Speed', {
    color: '#FFFFFF', fontSize: '52px', fontWeight: '800', textAlign: 'center',
    custom: { textShadow: '0 2px 14px rgba(0,0,0,0.85)', lineHeight: '1', fontVariantNumeric: 'tabular-nums' },
  }, [{ target: 'text', expression: `Speed` }], '0');
  const unit = uiElement('text', 'Unit', {
    color: '#27E0FF', fontSize: '12px', fontWeight: '700', textAlign: 'center',
    custom: { letterSpacing: '4px', marginTop: '4px' },
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
    custom: {
      alignItems: 'center', justifyContent: 'center', gap: '6px',
      background: 'radial-gradient(120% 90% at 50% 30%, rgba(18,26,42,0.45) 0%, rgba(5,7,12,0.94) 78%)',
    },
  });
  const title = uiElement('text', 'Title', {
    color: '#FFFFFF', fontSize: '44px', fontWeight: '800', textAlign: 'center',
    custom: { letterSpacing: '3px', textShadow: '0 2px 24px rgba(0,0,0,0.85)', marginBottom: '2px' },
  }, 'CHOOSE YOUR CAR');
  const sub = uiElement('text', 'Subtitle', {
    color: 'rgba(255,255,255,0.55)', fontSize: '14px', fontWeight: '600', textAlign: 'center',
    custom: { letterSpacing: '4px', textTransform: 'uppercase', marginBottom: '26px' },
  }, 'Pick your ride · hit the open world');
  const rowWrap = uiElement('panel', 'Cars', {
    display: 'flex', flexDirection: 'row', custom: { gap: '18px', flexWrap: 'wrap', justifyContent: 'center', maxWidth: '880px' },
  });
  rowWrap.children = CARS.map((car, i) => {
    // A tall card: a saturated accent header band over a dark body, an accent-tinted glow, and the car name
    // big with a "SELECT" call-to-action beneath. Accent-per-car keeps the grid readable at a glance.
    const card = uiElement('button', `Pick ${car.name}`, {
      width: '150px', height: '150px', borderRadius: '18px', color: '#FFFFFF',
      background: `linear-gradient(165deg, ${car.accent}26 0%, rgba(15,19,28,0.92) 46%, rgba(10,13,20,0.96) 100%)`,
      border: `1px solid ${car.accent}66`,
      display: 'flex', flexDirection: 'column',
      custom: {
        alignItems: 'center', justifyContent: 'center', gap: '4px', cursor: 'pointer', overflow: 'hidden',
        boxShadow: `0 10px 34px ${car.accent}33, inset 0 1px 0 rgba(255,255,255,0.08)`,
        transition: 'transform 0.12s ease, box-shadow 0.12s ease',
      },
    });
    const glyph = uiElement('text', 'Glyph', {
      fontSize: '40px', textAlign: 'center', custom: { lineHeight: '1', filter: `drop-shadow(0 4px 10px ${car.accent}88)` },
    }, '🏎️');
    const name = uiElement('text', 'Name', {
      color: '#FFFFFF', fontSize: '20px', fontWeight: '800', textAlign: 'center', custom: { letterSpacing: '0.5px' },
    }, car.name);
    const cta = uiElement('text', 'Select', {
      color: car.accent, fontSize: '11px', fontWeight: '700', textAlign: 'center', custom: { letterSpacing: '3px' },
    }, 'SELECT');
    card.children = [glyph, name, cta];
    card.onClickEvent = events[i];
    return card;
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
// ---- City builder ---------------------------------------------------------------------------------
// A small drivable downtown laid on flat ground: a square street GRID (asphalt base + raised sidewalk/lot
// blocks that leave road-width gaps between them), a varied building skyline, dashed lane centerlines on the
// two main avenues, glowing DIRECTIONAL ARROW chevrons painted on the road that guide a checkpoint loop, and
// dedicated practice zones (a roundabout to circle, a cone slalom to weave, parking bays, a pocket park).
//
// Layout: roads sit on a `PITCH`-spaced grid at x,z ∈ ROAD_LINES; (0,0) is the central intersection where the
// cars spawn facing +Z. Buildings are decorative scenery — the KINEMATIC car drives through them (only the
// DYNAMIC cones react to a hit) — so the roads/markings/arrows are what guide and test your driving.
const PITCH = 60; // spacing between road centerlines
const ROAD_HALF = 8; // half the road width (a two-lane street)
const ROAD_LINES = [-120, -60, 0, 60, 120]; // road centerlines on both axes → a 4×4 grid of blocks
const BLOCK_INNER = PITCH - ROAD_HALF * 2; // sidewalk/lot footprint between two roads (= 44)
const CITY_HALF = 132; // half-extent of the asphalt base (covers the grid + a ring-road margin)

const BUILDING_COLORS = ['#2e3440', '#3b4252', '#434c5e', '#4c566a', '#566080', '#46506b', '#5b6472'];

/** A simple solid box object (decorative by default — pass `physics` to make it interactive). */
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
      metalness: opts.metalness ?? 0.1,
      roughness: opts.roughness ?? 0.8,
      ...(opts.emissive ? { materialOverrides: { emissiveColor: opts.emissive, emissiveIntensity: opts.emissiveIntensity ?? 1 } } : {}),
    },
    ...(opts.physics ? { physics: opts.physics } : {}),
  };
}

/** A knockable traffic cone (DYNAMIC + light so the car bowls it over and the collision SFX fires). */
function cone(x: number, z: number): SceneObject {
  return {
    id: makeId('obj'),
    name: 'Cone',
    kind: 'cube',
    transform: { position: [x, 0.5, z], rotation: [0, 0, 0], scale: [0.34, 1, 0.34] },
    renderer: { ...defaultRenderer('cube', '#ff7a1a'), metalness: 0, roughness: 0.6, materialOverrides: { emissiveColor: '#ff6a12', emissiveIntensity: 0.9 } },
    physics: { enabled: true, bodyType: 'dynamic', collider: 'box', isTrigger: false, collisionLayer: 0, collisionMask: 0xffff, mass: 0.4, gravityScale: 1, friction: 0.6, linearDamping: 0.2, angularDamping: 0.3 },
  };
}

/** A glowing "›" chevron painted flat on the road, pointing along `yaw` (engine yaw: 0 = +Z) — two splayed bars. */
function chevron(cx: number, cz: number, yaw: number): SceneObject[] {
  const SPLAY = 0.62;
  return [1, -1].map((side) => {
    // Offset each bar to its side of the centerline, rotated into the travel direction.
    const ox = side * 0.7;
    const wx = cx + ox * Math.cos(yaw);
    const wz = cz - ox * Math.sin(yaw);
    return box('Arrow', [wx, 0.08, wz], [0.45, 0.05, 2.4], '#0a2a2e', {
      rotationY: yaw - side * SPLAY,
      metalness: 0,
      roughness: 0.5,
      emissive: '#27E0FF',
      emissiveIntensity: 2.4,
    });
  });
}

/**
 * Build the city scene objects. The checkpoint loop runs CP0(0,0)→CP1(0,120)→CP2(120,120)→CP3(120,0) and back,
 * so the existing lap timer + HUD stay meaningful; directional arrows guide each leg. Returns the flat object
 * list (a near-flat terrain is added separately as the physics ground). Cars spawn at (0,0) facing +Z.
 */
function buildCity(): { objects: SceneObject[] } {
  const objects: SceneObject[] = [];

  // 1) Asphalt base — one big dark slab. The raised sidewalk/lot blocks sit on top and leave the roads showing.
  objects.push(box('Asphalt', [60, 0.02, 60], [CITY_HALF * 2, 0.04, CITY_HALF * 2], '#22262e', { metalness: 0, roughness: 0.95 }));

  // 2) City blocks: a sidewalk slab per block, then 1–2 buildings (skip a couple for a park + a parking lot).
  const blockCenters = [-90, -30, 30, 90];
  const parkingBlock: [number, number] = [-30, -30];
  const parkBlock: [number, number] = [30, -30];
  blockCenters.forEach((bx) => {
    blockCenters.forEach((bz) => {
      const isParking = bx === parkingBlock[0] && bz === parkingBlock[1];
      const isPark = bx === parkBlock[0] && bz === parkBlock[1];
      // Sidewalk / lot slab.
      objects.push(box('Sidewalk', [bx, 0.06, bz], [BLOCK_INNER, 0.12, BLOCK_INNER], isPark ? '#3d5a3a' : '#8c93a0', { metalness: 0, roughness: 0.9 }));

      if (isParking) {
        // Parking bays: pairs of white stall lines along the block's road edge, to practice lining up.
        const stalls = 4;
        for (let s = 0; s < stalls; s++) {
          const px = bx - BLOCK_INNER / 2 + 6 + s * ((BLOCK_INNER - 8) / stalls);
          [-1, 1].forEach((e) => objects.push(box('Stall Line', [px, 0.14, bz + e * 5], [0.2, 0.04, 9], '#e8eef5', { metalness: 0, roughness: 0.7 })));
        }
        objects.push(box('Stall Line', [bx, 0.14, bz - 9.5], [BLOCK_INNER - 8, 0.04, 0.2], '#e8eef5', { metalness: 0, roughness: 0.7 }));
        return;
      }
      if (isPark) {
        // Pocket park: a few rounded "bushes".
        [[-10, -8], [8, 6], [12, -10], [-6, 11]].forEach(([dx, dz], i) =>
          objects.push({
            id: makeId('obj'),
            name: `Bush ${i + 1}`,
            kind: 'sphere',
            transform: { position: [bx + dx, 1, bz + dz], rotation: [0, 0, 0], scale: [2.6, 2, 2.6] },
            renderer: { ...defaultRenderer('sphere', '#3f7d3a'), metalness: 0, roughness: 0.9 },
          }),
        );
        return;
      }

      // Buildings: a main tower + an occasional shorter neighbour, varied height/colour, with a faint window glow.
      const towers = Math.random() < 0.35 ? 2 : 1;
      for (let t = 0; t < towers; t++) {
        const h = 9 + Math.random() * 26;
        const foot = BLOCK_INNER * (0.42 + Math.random() * 0.22);
        const offset = towers === 2 ? (t === 0 ? -BLOCK_INNER * 0.18 : BLOCK_INNER * 0.2) : 0;
        const color = BUILDING_COLORS[Math.floor(Math.random() * BUILDING_COLORS.length)];
        objects.push(
          box('Building', [bx + offset, h / 2 + 0.12, bz + offset * 0.6], [foot, h, foot * (0.85 + Math.random() * 0.3)], color, {
            metalness: 0.2,
            roughness: 0.55,
            emissive: '#1b2740',
            emissiveIntensity: 0.3,
            // Solid: a fixed box collider so the DYNAMIC car bumps into the building instead of driving through it.
            physics: fixedBox(),
          }),
        );
      }
    });
  });

  // 3) Dashed centerlines down the two main avenues (the spawn avenue x=0 and the cross street z=0).
  for (let d = -116; d <= 116; d += 16) {
    if (Math.abs(d) < 9) continue; // keep the central intersection clear
    objects.push(box('Lane Dash', [0, 0.07, d], [0.4, 0.04, 4.5], '#d7dde6', { metalness: 0, roughness: 0.7 }));
    objects.push(box('Lane Dash', [d, 0.07, 0], [4.5, 0.04, 0.4], '#d7dde6', { metalness: 0, roughness: 0.7 }));
  }

  // 4) Directional arrows guiding the checkpoint loop: 2 chevrons per leg, pointing toward the next checkpoint.
  const legs: Array<{ from: [number, number]; to: [number, number]; yaw: number }> = [
    { from: [0, 0], to: [0, 120], yaw: 0 }, // north up the spawn avenue
    { from: [0, 120], to: [120, 120], yaw: Math.PI / 2 }, // east along the top
    { from: [120, 120], to: [120, 0], yaw: Math.PI }, // south down the right
    { from: [120, 0], to: [0, 0], yaw: -Math.PI / 2 }, // west back to start
  ];
  legs.forEach((leg) => {
    [0.34, 0.66].forEach((f) => {
      const cx = leg.from[0] + (leg.to[0] - leg.from[0]) * f;
      const cz = leg.from[1] + (leg.to[1] - leg.from[1]) * f;
      objects.push(...chevron(cx, cz, leg.yaw));
    });
  });

  // 5) Roundabout at the (60,120) intersection on the top leg — a SOLID central planter you must steer around
  //    (a box collider blocks the car cleanly; a green dome on top reads as a planter), ringed with cones.
  objects.push(box('Roundabout Planter', [60, 0.9, 120], [11, 1.8, 11], '#3f7d3a', { metalness: 0, roughness: 0.9, physics: fixedBox() }));
  objects.push({
    id: makeId('obj'),
    name: 'Roundabout Dome',
    kind: 'sphere',
    transform: { position: [60, 1.8, 120], rotation: [0, 0, 0], scale: [10, 1.6, 10] },
    renderer: { ...defaultRenderer('sphere', '#488a40'), metalness: 0, roughness: 0.9 },
  });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    objects.push(cone(60 + Math.cos(a) * 9, 120 + Math.sin(a) * 9));
  }

  // 6) Cone slalom on the west leg (z=0) — alternating cones to weave through and test precise steering.
  for (let i = 0; i < 8; i++) {
    const x = 100 - i * 11;
    objects.push(cone(x, i % 2 === 0 ? 4 : -4));
  }

  // 7) Checkpoint loop (0 = start/finish): an invisible "Checkpoint N" marker the lap timer reads, flanked by
  //    two glowing gate posts so you can see where to aim. Posts straddle the road perpendicular to travel.
  const cps: Array<{ pos: [number, number]; dir: [number, number] }> = [
    { pos: [0, 0], dir: [0, 1] },
    { pos: [0, 120], dir: [1, 0] },
    { pos: [120, 120], dir: [0, -1] },
    { pos: [120, 0], dir: [-1, 0] },
  ];
  const cpColors = ['#ffffff', '#27E0FF', '#FFD166', '#FF5A5F'];
  cps.forEach((cp, idx) => {
    objects.push({
      id: makeId('obj'),
      name: `Checkpoint ${idx}`,
      kind: 'empty',
      transform: { position: [cp.pos[0], 0, cp.pos[1]], rotation: [0, 0, 0], scale: [1, 1, 1] },
    });
    const perp: [number, number] = [-cp.dir[1], cp.dir[0]]; // across the road
    [-1, 1].forEach((side) => {
      objects.push(
        box(idx === 0 ? 'Start Post' : `CP ${idx} Post`, [cp.pos[0] + side * perp[0] * ROAD_HALF, 2.4, cp.pos[1] + side * perp[1] * ROAD_HALF], [0.4, 4.8, 0.4], cpColors[idx], {
          metalness: 0.2,
          roughness: 0.4,
          emissive: cpColors[idx],
          emissiveIntensity: 2.4,
        }),
      );
    });
  });

  // 8) Start/finish line + overhead banner across the spawn avenue.
  objects.push(box('Start Line', [0, 0.08, 0], [ROAD_HALF * 2, 0.04, 1.2], '#f5f5f5', { metalness: 0, roughness: 0.9 }));
  objects.push(box('Start Banner', [0, 5.4, 0], [ROAD_HALF * 2 + 1.4, 1.1, 0.4], '#0d1014', { metalness: 0.3, roughness: 0.4, emissive: '#27E0FF', emissiveIntensity: 1.4 }));

  return { objects };
}

interface BuiltCar extends CarDef {
  bodyAsset: AssetItem;
  wheelAsset: AssetItem;
}

interface CarSounds {
  engineSoundId?: string;
  skidSoundId?: string;
  brakeSoundId?: string;
  hornSoundId?: string;
  collisionSoundId?: string;
}

/**
 * Build one drivable car: a KINEMATIC body root (the vehicle pass owns its transform so the solver never
 * fights it) + 4 wheels + 2 headlights + 2 brake lights, all sized from the body model's MEASURED bounding
 * box so they sit at the real corners (the kit's cars differ in size). Returns the root id (so the menu can
 * destroy the unchosen ones) plus the flat object list. `showcaseIndex`/`count` space the cars across the grid.
 */
async function buildCar(
  car: BuiltCar,
  showcaseIndex: number,
  count: number,
  scriptRef: { blueprintId: string; graphId: string },
  sounds: CarSounds,
): Promise<{ rootId: string; objects: SceneObject[] }> {
  const rootId = makeId('obj');
  const showcaseX = (showcaseIndex - (count - 1) / 2) * 4.6;

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
  // Wheel placement, tuned for a planted stance + a stable, car-like steering arc: tuck the wheels close to the
  // body's outer flanks (0.9 of half-width) and push them out toward the bumpers (0.72 of half-length) for a
  // long wheelbase. The rest height seats the tyre so its bottom just kisses the ground under the body.
  const sideX = halfW * 0.9;
  const frontZ = cz + halfL * 0.72;
  const rearZ = cz - halfL * 0.72;
  const wheelRestY = min[1] + wheelR * 0.92;

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
    // A touch extra body roll over the (already arcade-tuned) defaults so the chosen ride leans hard into
    // drifts and reads as lively; everything else inherits the tuned defaultVehicle() feel.
    bodyRoll: 0.07,
    wheelObjectIds: wheelIds,
    steeredWheelIds: steeredIds,
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
    // Chase camera sized to the car: above + behind by roughly the car's length.
    cameraOffset: [0, 2.2 + (max[1] - min[1]), -(halfL * 2 + 5)] as Vector3Tuple,
  };

  const root: SceneObject = {
    id: rootId,
    name: car.name,
    kind: 'cube',
    transform: { position: [showcaseX, 2, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    renderer: { ...defaultRenderer('cube', '#cdd3dc'), modelAssetId: car.bodyAsset.id, metalness: 0.3, roughness: 0.45 },
    // DYNAMIC: the vehicle pass commands the car's horizontal velocity + yaw, while the Rapier solver OWNS the
    // vertical (gravity + resting on the terrain/ramps) and RESOLVES collisions — so the convex hull (rebuilt
    // from the car model) genuinely bumps into buildings/the roundabout instead of driving through them. A
    // little damping settles any residual knockback when stopped.
    physics: {
      enabled: true, bodyType: 'dynamic', collider: 'convex', isTrigger: false,
      collisionLayer: 0, collisionMask: 0xffff, mass: 4, gravityScale: 1, friction: 0.8, linearDamping: 0.4, angularDamping: 0.6,
    },
    vehicle,
    script: { blueprintId: scriptRef.blueprintId, graphId: scriptRef.graphId, enabled: true },
  };

  return { rootId, objects: [root, ...wheels, ...headlights, ...brakeLights] };
}

export async function createDrivingTemplate(): Promise<string | undefined> {
  const store = useEditorStore.getState();
  const carsFolder = store.createFolder('Cars');

  // --- Import every car body + wheel model. ---
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

  // --- Build each car (see buildCar): a KINEMATIC body root + 4 wheels + 2 headlights + 2 brake lights,
  //     sized from the model's measured bounding box. All cars share the editable Car Controller blueprint
  //     and want the follow camera; only the chosen one survives selection. ---
  const carSounds: CarSounds = {
    engineSoundId: engineSound?.id,
    skidSoundId: skidSound?.id,
    brakeSoundId: brakeSound?.id,
    hornSoundId: hornSound?.id,
    collisionSoundId: collisionSound?.id,
  };
  const allObjects: SceneObject[] = [];
  const carRootIds: string[] = [];
  for (let i = 0; i < built.length; i++) {
    const { rootId, objects } = await buildCar(built[i], i, built.length, { blueprintId: carBpId, graphId: carGraphId }, carSounds);
    carRootIds.push(rootId);
    allObjects.push(...objects);
  }

  // --- Flat ground. A city is flat, so instead of a streamed PROCEDURAL terrain — which regenerates chunk
  //     geometry + foliage + a Rapier heightfield on the MAIN THREAD every time the car crosses a chunk
  //     boundary (a major "while driving" FPS sink, and entirely wasted work when heightScale is 0) — we use
  //     ONE large static ground slab with a single box collider. The dynamic car rests on it; fog hides the
  //     far edges so it still reads as open ground around the city. ---
  const ground = box('Ground', [0, -1, 0], [3200, 2, 3200], '#55623f', { metalness: 0, roughness: 1, physics: fixedBox() });

  // The drivable city: asphalt grid, sidewalks + building skyline, lane dashes, directional arrows guiding the
  // checkpoint loop, a roundabout, a cone slalom, and parking bays. Cars spawn at (0,0) facing +Z up the avenue.
  const { objects: cityObjects } = buildCity();

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
            objects: [...scene.objects, ground, ...cityObjects, menuObject, ...allObjects],
            environment: {
              ...defaultSceneEnvironment(),
              skyMode: 'procedural',
              // A deeper zenith fading to a warm haze near the horizon, with a lower sun for longer, more
              // cinematic shadows and a golden-hour warmth — while staying bright enough to read the track.
              skyTopColor: '#2a64c9',
              skyHorizonColor: '#e7ddca',
              sunIntensity: 1.45,
              sunElevation: 33,
              sunAzimuth: 38,
              fogEnabled: true,
              // Warm distance haze, pushed back so the circuit stays crisp and only the far world softens.
              fogColor: '#cdd6dd',
              fogNear: 130,
              fogFar: 540,
            },
          }
        : scene,
    ),
    selectedObjectId: playerCarId,
    isDirty: true,
  }));

  return playerCarId;
}
