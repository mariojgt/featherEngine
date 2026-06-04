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

// Neon HUD palette (matches the cyberpunk night world + the car-select menu accents).
const NEON_CYAN = '#1AFFE0';
const NEON_PINK = '#FF2BD6';
const NEON_GOLD = '#FFC93D';

/** "▮▮▮▯▯" style level pips for an upgrade row, driven by a 0..MAX level variable. The UI binding evaluator is
 *  a tiny CSP-safe parser with NO function calls (no .repeat / Math.*), so the gauge is a ternary chain that
 *  maps each level to its filled/empty pip string. */
function pipExpression(varName: string, max: number): string {
  const pips = (lvl: number) => "'" + '▮'.repeat(lvl) + '▯'.repeat(max - lvl) + "'";
  // level >= max ? full : level >= max-1 ? ... : '▯▯▯▯▯'
  let expr = pips(0);
  for (let lvl = 1; lvl <= max; lvl++) expr = `${varName} >= ${lvl} ? ${pips(lvl)} : ${expr}`;
  return expr;
}

/**
 * Bottom-center neon speedometer + a top-right CASH readout with upgrade pips and a GARAGE button, a thin NITRO
 * bar, and an auto-fading controls strip. Everything binds to the runtime-mirrored project vars (`Speed`,
 * `Cash`, `SpeedLevel`, `GripLevel`, `Nitro`). The GARAGE button fires the `openGarage` custom event (handled
 * by the Garage Logic blueprint), so the shop is openable any time you're driving.
 */
function createDrivingHud(): UIDocument {
  const root = uiElement('panel', 'Root', { width: '100%', height: '100%', position: 'relative', padding: '0' });

  // --- Bottom-center speedometer: a neon glass pill, big tabular number + KM/H unit. ---
  const speedBox = uiElement('panel', 'Speed Box', {
    position: 'absolute', left: '50%', display: 'flex', flexDirection: 'column',
    background: 'rgba(8,10,20,0.55)', borderRadius: '18px',
    custom: {
      bottom: '40px', transform: 'translateX(-50%)', alignItems: 'center', gap: '0px',
      padding: '10px 34px 12px', backdropFilter: 'blur(7px)', border: `1px solid ${NEON_CYAN}55`,
      boxShadow: `0 0 26px ${NEON_CYAN}33, inset 0 1px 0 rgba(255,255,255,0.06)`,
    },
  });
  const speed = boundElement('text', 'Speed', {
    color: '#FFFFFF', fontSize: '54px', fontWeight: '800', textAlign: 'center',
    custom: { textShadow: `0 0 18px ${NEON_CYAN}cc`, lineHeight: '1', fontVariantNumeric: 'tabular-nums' },
  }, [{ target: 'text', expression: `Speed` }], '0');
  const unit = uiElement('text', 'Unit', {
    color: NEON_CYAN, fontSize: '12px', fontWeight: '700', textAlign: 'center',
    custom: { letterSpacing: '5px', marginTop: '3px' },
  }, 'KM / H');
  speedBox.children = [speed, unit];

  // --- Thin NITRO bar just above the speedometer: fills on a boost pad, drains as you burn it. ---
  const nitroWrap = uiElement('panel', 'Nitro Wrap', {
    position: 'absolute', left: '50%', display: 'flex', flexDirection: 'column',
    custom: { bottom: '128px', transform: 'translateX(-50%)', alignItems: 'center', gap: '4px', width: '220px' },
  });
  const nitroLabel = uiElement('text', 'Nitro Label', {
    color: NEON_PINK, fontSize: '10px', fontWeight: '800', textAlign: 'center', custom: { letterSpacing: '4px' },
  }, 'NITRO');
  const nitroBar = boundElement('bar', 'Nitro Bar', {
    width: '220px', height: '8px', borderRadius: '6px', background: 'rgba(8,10,20,0.7)',
    custom: { border: `1px solid ${NEON_PINK}55`, overflow: 'hidden', boxShadow: `0 0 14px ${NEON_PINK}44` },
  }, [{ target: 'fill', expression: `Nitro` }, { target: 'color', expression: `'${NEON_PINK}'` }]);
  nitroWrap.children = [nitroLabel, nitroBar];

  // --- Top-right CASH panel + upgrade pips + a GARAGE button. ---
  const cashPanel = uiElement('panel', 'Cash Panel', {
    position: 'absolute', display: 'flex', flexDirection: 'column',
    background: 'rgba(8,10,20,0.6)', borderRadius: '14px', padding: '12px 16px',
    custom: { top: '18px', right: '18px', gap: '8px', backdropFilter: 'blur(5px)', border: `1px solid ${NEON_GOLD}44`, boxShadow: `0 0 22px ${NEON_GOLD}22`, alignItems: 'stretch', minWidth: '168px' },
  });
  const cashRow = boundElement('text', 'Cash', {
    color: NEON_GOLD, fontSize: '26px', fontWeight: '800', textAlign: 'right',
    custom: { letterSpacing: '0.5px', textShadow: `0 0 16px ${NEON_GOLD}aa`, fontVariantNumeric: 'tabular-nums' },
  }, [{ target: 'text', expression: `'§ ' + Cash` }], '§ 0');
  const engineRow = boundElement('text', 'Engine Level', {
    color: 'rgba(255,255,255,0.82)', fontSize: '12px', fontWeight: '700', textAlign: 'right', custom: { letterSpacing: '2px' },
  }, [{ target: 'text', expression: `'ENGINE ' + (${pipExpression('SpeedLevel', 5)})` }], 'ENGINE ▯▯▯▯▯');
  const tiresRow = boundElement('text', 'Tires Level', {
    color: 'rgba(255,255,255,0.82)', fontSize: '12px', fontWeight: '700', textAlign: 'right', custom: { letterSpacing: '2px' },
  }, [{ target: 'text', expression: `'TIRES  ' + (${pipExpression('GripLevel', 5)})` }], 'TIRES  ▯▯▯▯▯');
  const garageBtn = uiElement('button', 'Garage Button', {
    color: '#05060c', fontSize: '13px', fontWeight: '800', textAlign: 'center',
    background: `linear-gradient(180deg, ${NEON_CYAN} 0%, #11c9b4 100%)`, borderRadius: '10px',
    border: 'none',
    custom: { marginTop: '2px', padding: '8px 0', letterSpacing: '2px', cursor: 'pointer', boxShadow: `0 0 18px ${NEON_CYAN}66` },
  }, '⚙ GARAGE');
  garageBtn.onClickEvent = 'openGarage';
  cashPanel.children = [cashRow, engineRow, tiresRow, garageBtn];

  // --- Auto-fading controls strip (CSS keyframe: holds, then fades after ~9s — teaches without nagging). ---
  const hint = uiElement('text', 'Controls', {
    position: 'absolute', left: '50%', color: 'rgba(255,255,255,0.72)', fontSize: '12px', fontWeight: '500', textAlign: 'center',
    custom: { bottom: '16px', transform: 'translateX(-50%)', textShadow: '0 1px 6px rgba(0,0,0,0.8)', animation: 'nf-drive-hint 9s ease-in 1s forwards' },
  }, 'W accelerate · S brake / reverse · A / D steer · Space drift · H horn · drive over a pad to NITRO · grab § to upgrade in the GARAGE');

  root.children = [nitroWrap, speedBox, cashPanel, hint];
  const css = '@keyframes nf-drive-hint { 0%,72% { opacity: 1; } 100% { opacity: 0; } }';
  return { id: makeId('ui'), name: 'Driving HUD', surface: 'screen', root, css, visibleOnStart: true, createdAt: Date.now() };
}

/**
 * The GARAGE upgrade shop (hidden until the HUD's ⚙ GARAGE button fires `openGarage`). Two upgrade tracks —
 * ENGINE (raises SpeedLevel + AccelLevel → faster top speed & launch) and TIRES (raises GripLevel → tighter
 * cornering & drift control) — each a row with live level pips, a fixed cost, and a BUY button that fires a
 * custom event the Garage Logic blueprint handles (it checks Cash, deducts it, and bumps the level). A big DRIVE
 * button closes the shop. All values bind to the runtime project vars so the shop reflects purchases instantly.
 */
function createGarageUI(engineCost: number, tiresCost: number): UIDocument {
  const root = uiElement('panel', 'Root', {
    width: '100%', height: '100%', position: 'relative', display: 'flex', flexDirection: 'column',
    custom: {
      alignItems: 'center', justifyContent: 'center', gap: '4px',
      background: 'radial-gradient(120% 90% at 50% 24%, rgba(20,8,40,0.55) 0%, rgba(4,5,12,0.93) 76%)',
    },
  });
  const title = uiElement('text', 'Title', {
    color: '#FFFFFF', fontSize: '40px', fontWeight: '800', textAlign: 'center',
    custom: { letterSpacing: '5px', textShadow: `0 0 28px ${NEON_PINK}aa` },
  }, 'GARAGE');
  const cashLine = boundElement('text', 'Garage Cash', {
    color: NEON_GOLD, fontSize: '18px', fontWeight: '800', textAlign: 'center',
    custom: { letterSpacing: '1px', marginBottom: '22px', textShadow: `0 0 16px ${NEON_GOLD}88` },
  }, [{ target: 'text', expression: `'BANK   § ' + Cash` }], 'BANK   § 0');

  const rows = uiElement('panel', 'Rows', {
    display: 'flex', flexDirection: 'column', custom: { gap: '14px', width: '440px' },
  });

  // One upgrade row: name + pips on the left, BUY (with cost) on the right. `event` is the buy custom event.
  const upgradeRow = (
    label: string, blurb: string, levelVar: string, cost: number, accent: string, event: string,
  ): UIElement => {
    const row = uiElement('panel', `${label} Row`, {
      display: 'flex', flexDirection: 'row', background: 'rgba(10,12,22,0.85)', borderRadius: '14px',
      custom: { alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', gap: '12px', border: `1px solid ${accent}55`, boxShadow: `0 0 20px ${accent}22` },
    });
    const left = uiElement('panel', `${label} Info`, { display: 'flex', flexDirection: 'column', custom: { gap: '3px', alignItems: 'flex-start' } });
    const name = uiElement('text', `${label} Name`, { color: '#FFFFFF', fontSize: '18px', fontWeight: '800', custom: { letterSpacing: '1px' } }, label);
    const desc = uiElement('text', `${label} Desc`, { color: 'rgba(255,255,255,0.5)', fontSize: '11px', fontWeight: '500' }, blurb);
    const pips = boundElement('text', `${label} Pips`, {
      color: accent, fontSize: '16px', fontWeight: '800', custom: { letterSpacing: '3px', marginTop: '2px', textShadow: `0 0 10px ${accent}aa` },
    }, [{ target: 'text', expression: pipExpression(levelVar, 5) }], '▯▯▯▯▯');
    left.children = [name, desc, pips];
    const buy = uiElement('button', `Buy ${label}`, {
      color: '#05060c', fontSize: '14px', fontWeight: '800', textAlign: 'center',
      background: `linear-gradient(180deg, ${accent} 0%, ${accent}cc 100%)`, borderRadius: '10px', border: 'none',
      custom: { padding: '12px 18px', cursor: 'pointer', letterSpacing: '1px', boxShadow: `0 0 18px ${accent}66`, minWidth: '120px' },
    }, `BUY  § ${cost}`);
    buy.onClickEvent = event;
    row.children = [left, buy];
    return row;
  };

  rows.children = [
    upgradeRow('ENGINE', 'Higher top speed & sharper launch', 'SpeedLevel', engineCost, NEON_CYAN, 'buyEngine'),
    upgradeRow('TIRES', 'Tighter grip & drift control', 'GripLevel', tiresCost, NEON_PINK, 'buyTires'),
  ];

  const driveBtn = uiElement('button', 'Drive Button', {
    color: '#05060c', fontSize: '16px', fontWeight: '800', textAlign: 'center',
    background: 'linear-gradient(180deg, #ffffff 0%, #d4dbe6 100%)', borderRadius: '12px', border: 'none',
    custom: { marginTop: '26px', padding: '12px 44px', cursor: 'pointer', letterSpacing: '3px', boxShadow: '0 0 22px rgba(255,255,255,0.35)' },
  }, 'DRIVE ▸');
  driveBtn.onClickEvent = 'closeGarage';

  root.children = [title, cashLine, rows, driveBtn];
  return { id: makeId('ui'), name: 'Garage', surface: 'screen', root, css: '', visibleOnStart: false, createdAt: Date.now() };
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
    color: '#FFFFFF', fontSize: '46px', fontWeight: '800', textAlign: 'center',
    custom: { letterSpacing: '4px', textShadow: `0 0 30px ${NEON_CYAN}88, 0 2px 24px rgba(0,0,0,0.85)`, marginBottom: '2px' },
  }, 'CHOOSE YOUR RIDE');
  const sub = uiElement('text', 'Subtitle', {
    color: NEON_CYAN, fontSize: '13px', fontWeight: '700', textAlign: 'center',
    custom: { letterSpacing: '5px', textTransform: 'uppercase', marginBottom: '26px', textShadow: `0 0 14px ${NEON_CYAN}66` },
  }, 'Hit the neon streets · collect § · upgrade in the garage');
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
 * Build a ready-to-play NEED-FOR-SPEED-style arcade driving starter from the bundled low-poly car kit: a "choose
 * your ride" menu (5 cars), then an open CYBERPUNK NEON NIGHT city you cruise with WASD + mouse-orbit and a real
 * sense of suspension (squat/dive/lean, spinning + steering wheels, headlights, brake lights). The fun loop:
 * grab glowing CASH ORBS (§), hit NITRO pads for a surge, and spend § in the GARAGE on ENGINE / TIRES upgrades
 * that actually change how the car drives (the vehicle pass scales handling from the upgrade-level project vars).
 * Returns the first (default) car's object id. Requires a project to be open.
 */
// ---- Neon-night city builder ----------------------------------------------------------------------
// A drivable cyberpunk downtown on a dark, wet-looking asphalt slab: a square street GRID (sidewalk/lot blocks
// leaving road-width gaps), a neon-lit building skyline (dark towers with emissive window glow), glowing cyan
// lane strips + directional chevrons, scattered CASH ORBS to grab (§ → upgrades) and NITRO boost pads to hit,
// a neon roundabout landmark, a few knockable cones, and a handful of colored point lights for atmosphere.
//
// Layout: roads sit on a `PITCH`-spaced grid at x,z ∈ ROAD_LINES; (0,0) is the central intersection where the
// cars spawn facing +Z. Buildings are SOLID (fixed colliders) so the DYNAMIC car bumps/crash-stops on them;
// orbs + pads are trigger volumes; cones are knockable. There's no race/lap — it's an open-world cruise:
// collect §, upgrade your ride in the garage, hit pads for a nitro surge.
const PITCH = 60; // spacing between road centerlines
const ROAD_HALF = 8; // half the road width (a two-lane street)
const ROAD_LINES = [-120, -60, 0, 60, 120]; // road centerlines on both axes → a 4×4 grid of blocks
const BLOCK_INNER = PITCH - ROAD_HALF * 2; // sidewalk/lot footprint between two roads (= 44)
const CITY_HALF = 132; // half-extent of the asphalt base (covers the grid + a ring-road margin)

// Dark tower bodies; each gets one of these emissive "window glow" hues so the skyline reads as a lit night city.
const BUILDING_COLORS = ['#0b0e18', '#0e1018', '#0c111c', '#10101a', '#0a0d16'];
const WINDOW_GLOWS = ['#1AFFE0', '#FF2BD6', '#7A5BFF', '#1A8CFF', '#FFC93D'];

interface CityScriptRefs {
  collectible: { blueprintId: string; graphId: string };
  boost: { blueprintId: string; graphId: string };
}

/** A floating neon CASH ORB: a glowing sphere that's a fixed TRIGGER. Touching it runs the Collectible
 *  blueprint (add §, chime, destroy self). */
function cashOrb(x: number, z: number, ref: CityScriptRefs['collectible']): SceneObject {
  return {
    id: makeId('obj'),
    name: 'Credits',
    kind: 'sphere',
    transform: { position: [x, 1.6, z], rotation: [0, 0, 0], scale: [1.5, 1.5, 1.5] },
    renderer: { ...defaultRenderer('sphere', NEON_GOLD), metalness: 0.3, roughness: 0.2, materialOverrides: { emissiveColor: NEON_GOLD, emissiveIntensity: 2.8 } },
    physics: { enabled: true, bodyType: 'fixed', collider: 'box', isTrigger: true, collisionLayer: 0, collisionMask: 0xffff, mass: 1, gravityScale: 0, friction: 0, linearDamping: 0, angularDamping: 0 },
    script: { blueprintId: ref.blueprintId, graphId: ref.graphId, enabled: true },
  };
}

/** A flat glowing NITRO boost pad across a lane: a fixed TRIGGER. Driving over it runs the Boost blueprint
 *  (sets the `Nitro` var to full → the vehicle pass surges top speed/accel, then drains it). */
function boostPad(x: number, z: number, yaw: number, ref: CityScriptRefs['boost']): SceneObject {
  return {
    id: makeId('obj'),
    name: 'Boost Pad',
    kind: 'cube',
    // Sits just ABOVE the ground slab (top at y=0) so its sensor only fires against cars, never the ground.
    transform: { position: [x, 0.34, z], rotation: [0, yaw, 0], scale: [ROAD_HALF * 1.5, 0.5, 4.5] },
    renderer: { ...defaultRenderer('cube', '#220a22'), metalness: 0.2, roughness: 0.35, materialOverrides: { emissiveColor: NEON_PINK, emissiveIntensity: 3.2 } },
    physics: { enabled: true, bodyType: 'fixed', collider: 'box', isTrigger: true, collisionLayer: 0, collisionMask: 0xffff, mass: 1, gravityScale: 0, friction: 0, linearDamping: 0, angularDamping: 0 },
    script: { blueprintId: ref.blueprintId, graphId: ref.graphId, enabled: true },
  };
}

/** A colored point light for street/intersection neon ambience (kept few — many lights tank FPS). */
function neonLight(name: string, position: Vector3Tuple, color: string, intensity: number, distance: number): SceneObject {
  return {
    id: makeId('obj'),
    name,
    kind: 'light',
    transform: { position, rotation: [0, 0, 0], scale: [1, 1, 1] },
    light: { type: 'point', color, intensity, distance, angle: Math.PI / 4, castShadow: false },
  };
}

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
 * Build the neon-night city scene objects. There's no lap/race — it's an open cruise: drive the grid, grab the
 * glowing CASH ORBS (§), hit NITRO pads for a surge, and spend § on upgrades in the garage. Returns the flat
 * object list (a big flat ground slab is added separately as the physics floor). Cars spawn at (0,0) facing +Z.
 */
function buildCity(refs: CityScriptRefs): { objects: SceneObject[] } {
  const objects: SceneObject[] = [];

  // 1) Asphalt base — one big dark slab. MATTE (metalness 0, high roughness): a low-roughness metallic surface
  //    this large samples the environment map across the whole lower screen every frame, a real GPU cost — the
  //    neon "wet" read comes from the emissive strips/towers + bloom instead, which is far cheaper.
  objects.push(box('Asphalt', [60, 0.02, 60], [CITY_HALF * 2, 0.04, CITY_HALF * 2], '#0a0c14', { metalness: 0, roughness: 0.9 }));

  // 2) City blocks: a sidewalk slab per block, then 1–2 dark neon-lit towers (skip one block for a plaza).
  const blockCenters = [-90, -30, 30, 90];
  const plazaBlock: [number, number] = [30, -30];
  let glowIdx = 0;
  blockCenters.forEach((bx) => {
    blockCenters.forEach((bz) => {
      const isPlaza = bx === plazaBlock[0] && bz === plazaBlock[1];
      // Dark sidewalk slab with a faint cyan edge glow.
      objects.push(box('Sidewalk', [bx, 0.06, bz], [BLOCK_INNER, 0.12, BLOCK_INNER], '#10131e', { metalness: 0.2, roughness: 0.6, emissive: NEON_CYAN, emissiveIntensity: 0.06 }));

      if (isPlaza) {
        // Open neon plaza: a glowing ring on the ground + a couple of orbs to grab (filled in below).
        objects.push(box('Plaza Glow', [bx, 0.12, bz], [BLOCK_INNER * 0.7, 0.04, BLOCK_INNER * 0.7], '#120a1e', { metalness: 0.2, roughness: 0.4, emissive: NEON_PINK, emissiveIntensity: 1.1 }));
        return;
      }

      // Towers: a main one + an occasional shorter neighbour. Dark body, one neon "window glow" emissive hue.
      const towers = ((bx + bz) % 120 === 0) ? 2 : 1;
      for (let t = 0; t < towers; t++) {
        // Deterministic-ish variation from the block coords (no per-build randomness drift in the skyline feel).
        const h = 14 + ((Math.abs(bx) + Math.abs(bz) + t * 37) % 24);
        const foot = BLOCK_INNER * (0.46 + ((Math.abs(bx * 3 + bz) + t) % 5) * 0.04);
        const offset = towers === 2 ? (t === 0 ? -BLOCK_INNER * 0.18 : BLOCK_INNER * 0.2) : 0;
        const body = BUILDING_COLORS[(glowIdx) % BUILDING_COLORS.length];
        const glow = WINDOW_GLOWS[glowIdx % WINDOW_GLOWS.length];
        glowIdx += 1;
        objects.push(
          box('Tower', [bx + offset, h / 2 + 0.12, bz + offset * 0.6], [foot, h, foot * 0.95], body, {
            metalness: 0.35,
            roughness: 0.4,
            emissive: glow,
            emissiveIntensity: 0.5,
            // Solid: a fixed box collider so the DYNAMIC car bumps into the tower instead of driving through it.
            physics: fixedBox(),
          }),
        );
        // A bright emissive cap strip on top of the main tower so the skyline edge glows.
        if (t === 0) objects.push(box('Tower Cap', [bx + offset, h + 0.4, bz + offset * 0.6], [foot * 1.02, 0.5, foot * 0.97], '#04050a', { metalness: 0.2, roughness: 0.3, emissive: glow, emissiveIntensity: 2.4 }));
      }
    });
  });

  // 3) Glowing cyan lane strips down the two main avenues (spawn avenue x=0 and cross street z=0).
  for (let d = -116; d <= 116; d += 16) {
    if (Math.abs(d) < 9) continue; // keep the central intersection clear
    objects.push(box('Lane Strip', [0, 0.07, d], [0.4, 0.04, 5], NEON_CYAN, { metalness: 0, roughness: 0.5, emissive: NEON_CYAN, emissiveIntensity: 1.8 }));
    objects.push(box('Lane Strip', [d, 0.07, 0], [5, 0.04, 0.4], NEON_CYAN, { metalness: 0, roughness: 0.5, emissive: NEON_CYAN, emissiveIntensity: 1.8 }));
  }

  // 4) Neon directional chevrons around the outer loop — pure eye-candy that gives the streets a "track" feel.
  const legs: Array<{ from: [number, number]; to: [number, number]; yaw: number }> = [
    { from: [0, 0], to: [0, 120], yaw: 0 },
    { from: [0, 120], to: [120, 120], yaw: Math.PI / 2 },
    { from: [120, 120], to: [120, 0], yaw: Math.PI },
    { from: [120, 0], to: [0, 0], yaw: -Math.PI / 2 },
  ];
  legs.forEach((leg) => {
    [0.34, 0.66].forEach((f) => {
      const cx = leg.from[0] + (leg.to[0] - leg.from[0]) * f;
      const cz = leg.from[1] + (leg.to[1] - leg.from[1]) * f;
      objects.push(...chevron(cx, cz, leg.yaw));
    });
  });

  // 5) Neon roundabout landmark at (60,120): a SOLID planter (box collider blocks the car) topped with a glowing
  //    dome + an emissive ring, with a few knockable cones around it for fun.
  objects.push(box('Roundabout Planter', [60, 0.9, 120], [11, 1.8, 11], '#0a0d18', { metalness: 0.3, roughness: 0.4, emissive: NEON_PINK, emissiveIntensity: 0.8, physics: fixedBox() }));
  objects.push({
    id: makeId('obj'),
    name: 'Roundabout Dome',
    kind: 'sphere',
    transform: { position: [60, 1.8, 120], rotation: [0, 0, 0], scale: [10, 1.6, 10] },
    renderer: { ...defaultRenderer('sphere', '#0a0d18'), metalness: 0.3, roughness: 0.3, materialOverrides: { emissiveColor: NEON_CYAN, emissiveIntensity: 1.4 } },
  });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    objects.push(cone(60 + Math.cos(a) * 9, 120 + Math.sin(a) * 9));
  }
  // A loose cone cluster on the west leg to bowl through.
  for (let i = 0; i < 6; i++) objects.push(cone(96 - i * 12, i % 2 === 0 ? 4 : -4));

  // 6) CASH ORBS (§) scattered along the streets — the core collect loop. Each is a fixed trigger that adds §
  //    and destroys itself on touch (Collectible blueprint). Spread along the avenues + cross streets + plaza.
  const orbSpots: Array<[number, number]> = [
    [0, 30], [0, 60], [0, 90], [0, 150], [0, -36], [0, -90],
    [30, 0], [60, 0], [90, 0], [-36, 0], [-90, 0], [150, 0],
    [120, 60], [120, 150], [60, 60], [-60, 60], [30, -30], [42, -18],
  ];
  orbSpots.forEach(([x, z]) => objects.push(cashOrb(x, z, refs.collectible)));

  // 7) NITRO boost pads on the long straights — hit one for a speed surge (Boost blueprint sets Nitro=1).
  const padSpots: Array<{ x: number; z: number; yaw: number }> = [
    { x: 0, z: 42, yaw: 0 },
    { x: 0, z: 102, yaw: 0 },
    { x: 0, z: -66, yaw: 0 },
    { x: 42, z: 0, yaw: Math.PI / 2 },
    { x: 102, z: 0, yaw: Math.PI / 2 },
    { x: -66, z: 0, yaw: Math.PI / 2 },
  ];
  padSpots.forEach((p) => objects.push(boostPad(p.x, p.z, p.yaw, refs.boost)));

  // 8) Just TWO colored fill lights at the spawn intersection. Real-time lights are the dominant FPS cost in a
  //    forward renderer (each one re-shades every lit surface), so the neon look comes from EMISSIVE materials +
  //    the bloom pass (both ~free per-object) rather than many point lights. Keep this count low.
  objects.push(neonLight('Neon Fill 1', [0, 8, 8], NEON_CYAN, 16, 60));
  objects.push(neonLight('Neon Fill 2', [60, 9, 120], NEON_PINK, 12, 55));

  // 9) Start gantry over the spawn point — a dark beam with a bright neon underglow (a "you start here" marker).
  objects.push(box('Start Gantry', [0, 5.6, 0], [ROAD_HALF * 2 + 2, 0.7, 0.5], '#04050a', { metalness: 0.4, roughness: 0.3, emissive: NEON_CYAN, emissiveIntensity: 2.2 }));

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
  // brake/horn/collision are one-shots. The checkpoint chime is reused as the cash-pickup "ping".
  const engineSound = await importAudio('engine_loop.mp3', carsFolder);
  const skidSound = await importAudio('skid_loop.mp3', carsFolder);
  const brakeSound = await importAudio('brake.mp3', carsFolder);
  const hornSound = await importAudio('horn.mp3', carsFolder);
  const collisionSound = await importAudio('collision.mp3', carsFolder);
  const pickupSound = await importAudio('checkpoint.mp3', carsFolder); // reused as the § pickup / purchase ping
  await importAudio('lap_complete.mp3', carsFolder); // kept available for users who want to add a race/lap

  // --- Economy + upgrade tuning. ---
  const ENGINE_COST = 200; // § per ENGINE upgrade (top speed + launch)
  const TIRES_COST = 150; // § per TIRES upgrade (grip + drift control)
  const ORB_VALUE = 50; // § granted per cash orb grabbed
  const MAX_LEVEL = 5; // upgrade cap per track

  // --- Project variables. Driving gates input until a car is chosen; Speed feeds the HUD speedometer; Cash is
  //     the upgrade currency; SpeedLevel/AccelLevel/GripLevel are read by the VEHICLE PASS to scale the driven
  //     car's handling (the upgrade "engine power"); Nitro is set by boost pads and surges speed while it drains. ---
  const drivingVarId = makeId('var');
  const speedVarId = makeId('var');
  const cashVarId = makeId('var');
  const speedLevelVarId = makeId('var');
  const accelLevelVarId = makeId('var');
  const gripLevelVarId = makeId('var');
  const nitroVarId = makeId('var');
  const mkVar = (id: string, name: string, persistent = false): ProjectVariable => ({ id, name, type: 'number', defaultValue: 0, persistent, createdAt: Date.now() });
  const drivingVar = mkVar(drivingVarId, 'Driving');
  const speedVar = mkVar(speedVarId, 'Speed');
  const cashVar = mkVar(cashVarId, 'Cash');
  const speedLevelVar = mkVar(speedLevelVarId, 'SpeedLevel');
  const accelLevelVar = mkVar(accelLevelVarId, 'AccelLevel');
  const gripLevelVar = mkVar(gripLevelVarId, 'GripLevel');
  const nitroVar = mkVar(nitroVarId, 'Nitro');

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
  //     far edges so it still reads as open ground around the dark city. ---
  const ground = box('Ground', [0, -1, 0], [3200, 2, 3200], '#06070d', { metalness: 0, roughness: 1, physics: fixedBox() });

  // --- Ids for the orb/pad blueprints (generated now so buildCity can attach them; the graphs are built below). ---
  const colGraphId = makeId('graph');
  const colBpId = makeId('bp');
  const boGraphId = makeId('graph');
  const boBpId = makeId('bp');

  // The drivable neon city: dark asphalt + lit towers, glowing lane strips, cash orbs, nitro pads, a roundabout
  // landmark, and a few colored lights. Cars spawn at (0,0) facing +Z. Orbs/pads carry the blueprints below.
  const { objects: cityObjects } = buildCity({
    collectible: { blueprintId: colBpId, graphId: colGraphId },
    boost: { blueprintId: boBpId, graphId: boGraphId },
  });

  // --- COLLECTIBLE blueprint (shared by every cash orb): on a car touching the orb's trigger, add § to Cash,
  //     play the pickup ping, and destroy the orb. Get Cash → Add ORB_VALUE → Set Cash, then ping + destroy. ---
  const colNodes: NodeForgeNode[] = [];
  const colEdges: Edge[] = [];
  const cn = (label: string, cat: GraphNodeCategory, x: number, y: number, data: Partial<NodeForgeNodeData>) => {
    const id = makeId('node');
    colNodes.push(graphNode(id, label, cat, x, y, data));
    return id;
  };
  {
    const ev = cn('On Touched', 'Events', 40, 40, { nodeKind: 'event.triggerEnter', hasInput: false, description: 'A car drove into this orb.' });
    const get = cn('Get Cash', 'Variables', 40, 240, { nodeKind: 'variable.get', variableId: cashVarId, valueType: 'number', hasInput: false });
    const add = cn(`+ ${ORB_VALUE}`, 'Math', 300, 240, { nodeKind: 'math.add', amount: ORB_VALUE, hasInput: false, description: `Cash + ${ORB_VALUE}.` });
    const set = cn('Set Cash', 'Variables', 320, 40, { nodeKind: 'variable.set', variableId: cashVarId, valueType: 'number', description: 'Bank the credits.' });
    const snd = cn('Pickup Ping', 'Audio', 580, 40, { nodeKind: 'action.playSound', assetId: pickupSound?.id, description: 'Pickup chime.' });
    const del = cn('Destroy Orb', 'Runtime', 820, 40, { nodeKind: 'action.destroyObject', description: 'Remove this orb (targets self).' });
    colEdges.push(execEdge(ev, set), valueEdge(get, add, 'a'), valueEdge(add, set, 'value'), execEdge(set, snd), execEdge(snd, del));
  }
  const colGraph: ProjectGraph = { id: colGraphId, name: 'Collectible', nodes: colNodes, edges: colEdges };
  const colBlueprint: ScriptBlueprint = { id: colBpId, name: 'Collectible', description: 'Cash orb: on touch, add § and disappear.', graphId: colGraphId, color: NEON_GOLD, createdAt: Date.now() };

  // --- BOOST blueprint (shared by every pad): driving over the pad sets Nitro to full (the vehicle pass surges
  //     top speed/accel while it drains) and gives the camera a little kick for punch. ---
  const boNodes: NodeForgeNode[] = [];
  const boEdges: Edge[] = [];
  const bn = (label: string, cat: GraphNodeCategory, x: number, y: number, data: Partial<NodeForgeNodeData>) => {
    const id = makeId('node');
    boNodes.push(graphNode(id, label, cat, x, y, data));
    return id;
  };
  {
    const ev = bn('On Driven Over', 'Events', 40, 40, { nodeKind: 'event.triggerEnter', hasInput: false, description: 'A car hit this pad.' });
    const set = bn('Nitro = Full', 'Variables', 300, 40, { nodeKind: 'variable.set', variableId: nitroVarId, valueType: 'number', numberValue: 1, description: 'Charge nitro (drains over ~2s).' });
    const shake = bn('Camera Kick', 'Runtime', 560, 40, { nodeKind: 'action.cameraShake', shakeAmount: 0.45, description: 'A little punch.' });
    boEdges.push(execEdge(ev, set), execEdge(set, shake));
  }
  const boGraph: ProjectGraph = { id: boGraphId, name: 'Boost Pad', nodes: boNodes, edges: boEdges };
  const boBlueprint: ScriptBlueprint = { id: boBpId, name: 'Boost Pad', description: 'Nitro pad: on drive-over, charge Nitro for a speed surge.', graphId: boGraphId, color: NEON_PINK, createdAt: Date.now() };

  // --- Car-select menu + Garage shop UI + HUD. ---
  const garageDoc = createGarageUI(ENGINE_COST, TIRES_COST);
  const hud = createDrivingHud();
  const { doc: menuDoc, events: selectEvents } = createCarMenu();

  // --- GARAGE LOGIC blueprint: open/close the shop, and BUY upgrades (check Cash + level cap, deduct §, bump the
  //     level vars the vehicle pass reads). ENGINE buys raise SpeedLevel + AccelLevel; TIRES raise GripLevel. ---
  const gaGraphId = makeId('graph');
  const gaBpId = makeId('bp');
  const gaNodes: NodeForgeNode[] = [];
  const gaEdges: Edge[] = [];
  const gn = (label: string, cat: GraphNodeCategory, x: number, y: number, data: Partial<NodeForgeNodeData>) => {
    const id = makeId('node');
    gaNodes.push(graphNode(id, label, cat, x, y, data));
    return id;
  };
  {
    // Open / close the shop.
    const opEv = gn('On Open Garage', 'Events', 40, 40, { nodeKind: 'event.custom', eventName: 'openGarage', hasInput: false, description: 'HUD ⚙ GARAGE button.' });
    const opShow = gn('Show Garage', 'UI', 300, 40, { nodeKind: 'ui.show', documentId: garageDoc.id, description: 'Open the shop.' });
    const clEv = gn('On Close Garage', 'Events', 40, 160, { nodeKind: 'event.custom', eventName: 'closeGarage', hasInput: false, description: 'Garage DRIVE button.' });
    const clHide = gn('Hide Garage', 'UI', 300, 160, { nodeKind: 'ui.hide', documentId: garageDoc.id, description: 'Back to driving.' });
    gaEdges.push(execEdge(opEv, opShow), execEdge(clEv, clHide));

    // One BUY chain: gate on (Cash >= cost) AND (firstLevel < MAX), then deduct § and bump each level var by 1.
    const buildBuy = (event: string, label: string, cost: number, baseY: number, levelVarIds: string[]) => {
      const ev = gn(`On ${label}`, 'Events', 40, baseY, { nodeKind: 'event.custom', eventName: event, hasInput: false, description: `Buy ${label}.` });
      const getCashA = gn('Get Cash', 'Variables', 40, baseY + 300, { nodeKind: 'variable.get', variableId: cashVarId, valueType: 'number', hasInput: false });
      const cmpCash = gn(`Cash ≥ ${cost}`, 'Logic', 40, baseY + 420, { nodeKind: 'logic.compare', compareOp: '>=', numberValue: cost, hasInput: false, description: 'Can you afford it?' });
      const brCash = gn('Afford?', 'Logic', 280, baseY, { nodeKind: 'logic.branch', description: 'Stop unless you can pay.' });
      gaEdges.push(valueEdge(getCashA, cmpCash, 'a'), valueEdge(cmpCash, brCash, 'condition'), execEdge(ev, brCash));
      const getLvl = gn('Get Level', 'Variables', 520, baseY + 300, { nodeKind: 'variable.get', variableId: levelVarIds[0], valueType: 'number', hasInput: false });
      const cmpLvl = gn(`Level < ${MAX_LEVEL}`, 'Logic', 520, baseY + 420, { nodeKind: 'logic.compare', compareOp: '<', numberValue: MAX_LEVEL, hasInput: false, description: 'Not maxed yet?' });
      const brLvl = gn('Not maxed?', 'Logic', 520, baseY, { nodeKind: 'logic.branch', description: 'Stop if already maxed.' });
      gaEdges.push(valueEdge(getLvl, cmpLvl, 'a'), valueEdge(cmpLvl, brLvl, 'condition'), execEdge(brCash, brLvl));
      const getCashB = gn('Get Cash', 'Variables', 760, baseY + 300, { nodeKind: 'variable.get', variableId: cashVarId, valueType: 'number', hasInput: false });
      const sub = gn(`− ${cost}`, 'Math', 760, baseY + 420, { nodeKind: 'math.add', amount: -cost, hasInput: false, description: `Pay ${cost} §.` });
      const setCash = gn('Set Cash', 'Variables', 760, baseY, { nodeKind: 'variable.set', variableId: cashVarId, valueType: 'number' });
      gaEdges.push(valueEdge(getCashB, sub, 'a'), valueEdge(sub, setCash, 'value'), execEdge(brLvl, setCash));
      let chain = setCash;
      let lx = 1000;
      levelVarIds.forEach((lv) => {
        const getL = gn('Get Level', 'Variables', lx, baseY + 300, { nodeKind: 'variable.get', variableId: lv, valueType: 'number', hasInput: false });
        const addL = gn('+ 1', 'Math', lx, baseY + 420, { nodeKind: 'math.add', amount: 1, hasInput: false });
        const setL = gn('Set Level', 'Variables', lx, baseY, { nodeKind: 'variable.set', variableId: lv, valueType: 'number', description: 'Upgrade installed.' });
        gaEdges.push(valueEdge(getL, addL, 'a'), valueEdge(addL, setL, 'value'), execEdge(chain, setL));
        chain = setL;
        lx += 240;
      });
      const snd = gn('Purchase Ping', 'Audio', lx, baseY, { nodeKind: 'action.playSound', assetId: pickupSound?.id });
      gaEdges.push(execEdge(chain, snd));
    };
    buildBuy('buyEngine', 'ENGINE', ENGINE_COST, 360, [speedLevelVarId, accelLevelVarId]);
    buildBuy('buyTires', 'TIRES', TIRES_COST, 920, [gripLevelVarId]);
  }
  const gaGraph: ProjectGraph = { id: gaGraphId, name: 'Garage Logic', nodes: gaNodes, edges: gaEdges };
  const gaBlueprint: ScriptBlueprint = { id: gaBpId, name: 'Garage Logic', description: 'Open/close the garage and buy ENGINE / TIRES upgrades with §.', graphId: gaGraphId, color: NEON_CYAN, createdAt: Date.now() };
  const garageObject: SceneObject = {
    id: makeId('obj'), name: 'Garage Logic', kind: 'empty',
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    script: { blueprintId: gaBpId, graphId: gaGraphId, enabled: true },
  };

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

  // --- Commit everything atomically (cars + world + orbs/pads + menu/garage logic + UI + variables + env). ---
  const playerCarId = carRootIds[0];
  useEditorStore.setState((draft) => ({
    variables: [...draft.variables, drivingVar, speedVar, cashVar, speedLevelVar, accelLevelVar, gripLevelVar, nitroVar],
    blueprints: [...draft.blueprints, carBlueprint, menuBlueprint, colBlueprint, boBlueprint, gaBlueprint],
    graphs: [...draft.graphs, carGraph, menuGraph, colGraph, boGraph, gaGraph],
    activeBlueprintId: carBpId,
    uiDocuments: [...draft.uiDocuments, hud, menuDoc, garageDoc],
    activeUIDocumentId: menuDoc.id,
    scenes: draft.scenes.map((scene) =>
      scene.id === draft.activeSceneId
        ? {
            ...scene,
            objects: [...scene.objects, ground, ...cityObjects, menuObject, garageObject, ...allObjects],
            environment: {
              ...defaultSceneEnvironment(),
              skyMode: 'procedural',
              // Cyberpunk NIGHT: a deep indigo zenith fading to a violet horizon, a low, dim, magenta-tinted
              // "moon" sun, and thick neon-tinted fog so the dark holds while the emissive towers/strips/orbs
              // pop through the bloom pass (set below). The scattered colored point lights do the street work.
              skyTopColor: '#060512',
              skyHorizonColor: '#241043',
              skyGroundColor: '#04030a',
              environmentIntensity: 0.5,
              sunColor: '#ff5fd6',
              sunIntensity: 0.45,
              sunElevation: 16,
              sunAzimuth: 210,
              fogEnabled: true,
              fogColor: '#0a0618',
              fogNear: 60,
              fogFar: 320,
            },
          }
        : scene,
    ),
    selectedObjectId: playerCarId,
    isDirty: true,
  }));

  // Punchy neon post: strong bloom (low threshold so the emissive towers/strips/orbs/pads glow) + a cinematic
  // vignette to frame the dark city — matches the FPS template's AAA look.
  store.updateRenderSettings({ bloomEnabled: true, bloomIntensity: 0.95, bloomThreshold: 0.6, bloomRadius: 0.7, vignetteEnabled: true });

  return playerCarId;
}
