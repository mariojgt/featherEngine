import { getPlatform } from '../platform';
import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import type { AssetItem, CinematicAction, NodeForgeNodeData, SceneObjectKind, Vector3Tuple } from '../types';

/** RESONANCE: a 32-second, editable kinetic-light installation. No baked movie or mesh downloads.
 * The timeline directs cameras, decorative rings and light cues. Rapier owns the ball, dominoes
 * and fractured shell; the visible debris is never keyframed. Four cloth banners share scene wind.
 * A short quarter-speed physics beat keeps the camera/music on time using a reciprocal timeline
 * rate. The final frame holds behind a normal UI document with a real Restart Scene action.
 */
export const RESONANCE_DURATION = 32;
export const RESONANCE_IMPACT_TIME = 24;
const CORE: Vector3Tuple = [0, 5.8, -4];
const CYAN = '#73e3ed';
const GOLD = '#ffbd72';

async function importAudio(dir: string, file: string, folderId: string): Promise<AssetItem | undefined> {
  const existing = useEditorStore.getState().assets.find(a => a.name === file && a.type === 'audio');
  if (existing) return existing;
  try {
    const response = await fetch(`templates/${dir}/${file}`);
    if (!response.ok) return undefined;
    const blob = await response.blob();
    const input = new File([blob], file, { type: file.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg' });
    const platform = await getPlatform();
    const { path, url } = await platform.importAsset(useProjectStore.getState().projectDir ?? 'web', input);
    const item: AssetItem = { id: `asset-${crypto.randomUUID()}`, name: file, type: 'audio', size: input.size, path, url, folderId, createdAt: Date.now() };
    useEditorStore.getState().addAssetItems([item]);
    return item;
  } catch {
    // The installation remains playable when an optional bundled sound is unavailable.
    return undefined;
  }
}

type PartOptions = {
  parentId?: string;
  rotation?: Vector3Tuple;
  body?: 'fixed' | 'dynamic';
  metalness?: number;
  roughness?: number;
  glow?: string;
  intensity?: number;
};

function part(kind: SceneObjectKind, name: string, position: Vector3Tuple, scale: Vector3Tuple, color: string, options: PartOptions = {}): string {
  const store = useEditorStore.getState();
  const id = store.createObjectWithProps(kind, {
    name, position, color, parentId: options.parentId,
    ...(options.body ? { physics: { enabled: true, bodyType: options.body, collider: kind === 'sphere' ? 'sphere' : 'box', friction: 0.45, restitution: 0.12 } } : {}),
  });
  store.updateTransform(id, 'scale', scale);
  if (options.rotation) store.updateTransform(id, 'rotation', options.rotation);
  if (kind !== 'empty' && kind !== 'light' && kind !== 'camera') store.updateRenderer(id, {
    metalness: options.metalness ?? 0.35, roughness: options.roughness ?? 0.4,
    ...(options.glow ? { materialOverrides: { emissiveColor: options.glow, emissiveIntensity: options.intensity ?? 2 } } : {}),
  });
  return id;
}

/** Polygonal circular ribs. Child transforms stay local, so one timeline track can turn a ring. */
function ring(name: string, position: Vector3Tuple, radius: number, width: number, color: string, rotation: Vector3Tuple, glow?: string): { root: string; segments: string[] } {
  const root = part('empty', name, position, [1, 1, 1], color, { rotation });
  const segments = Array.from({ length: 32 }, (_, index) => {
    const angle = index * Math.PI / 16;
    return part('cube', `${name} · segment ${index + 1}`, [Math.cos(angle) * radius, Math.sin(angle) * radius, 0],
      [width, 2 * radius * Math.tan(Math.PI / 32) + 0.025, width], color,
      { parentId: root, rotation: [0, 0, angle], metalness: 0.7, roughness: 0.25, glow, intensity: 1.6 });
  });
  return { root, segments };
}

export async function createFilmModeTemplate(): Promise<string | undefined> {
  const store = useEditorStore.getState();
  const scene = store.activeScene();
  if (!scene) return undefined;
  for (const id of ['obj-player', 'obj-ground', 'obj-enemy', 'obj-camera']) {
    if (selectActiveObjects(useEditorStore.getState()).some(o => o.id === id)) store.deleteObject(id);
  }
  store.renameScene(scene.id, 'Resonance · Kinetic Hall');

  // Architecture: pale structural ribs against dark inlaid stone, with an open clerestory.
  const architecture = part('empty', '01 · Architecture', [0, 0, 0], [1, 1, 1], '#ffffff');
  const block = (name: string, p: Vector3Tuple, s: Vector3Tuple, color = '#b4bab7', options: PartOptions = {}) =>
    part('cube', name, p, s, color, { parentId: architecture, ...options });
  block('Hall foundation · collision floor', [0, -0.55, 0], [26, 1, 34], '#172a32', { body: 'fixed', metalness: 0.65, roughness: 0.24 });
  for (let x = -10; x <= 10; x += 4) for (let z = -12; z <= 12; z += 4) {
    block(`Stone inlay ${x}, ${z}`, [x, -0.025, z], [3.94, 0.04, 3.94], (x + z) % 8 === 0 ? '#33444b' : '#293b43', { metalness: 0.5, roughness: 0.28 });
  }
  for (const x of [-10.7, 10.7]) {
    block(`Side plinth ${x}`, [x, 0.4, 0], [1.8, 0.8, 33], '#54616a');
    for (const z of [-12, -6, 0, 6, 12]) {
      block(`Pier ${x}, ${z}`, [x, 5.2, z], [0.8, 9.6, 1.2], '#adb7b8', { metalness: 0.18, roughness: 0.6 });
      block(`Pier brass foot ${x}, ${z}`, [x, 1.2, z], [0.9, 1, 1.3], '#a17e52', { metalness: 0.8 });
      block(`Clerestory rib ${x}, ${z}`, [x * 0.57, 10.1, z], [9.7, 0.42, 0.65], '#9caeb0');
      block(`Warm rib light ${x}, ${z}`, [x * 0.57, 9.86, z + 0.33], [9.2, 0.045, 0.045], GOLD, { glow: GOLD, intensity: 2.3 });
    }
  }
  for (const x of [-6.8, 6.8]) block(`Cyan floor guide ${x}`, [x, 0.013, 0], [0.05, 0.035, 30], CYAN, { glow: CYAN });
  block('Rear wall', [0, 6, -14], [25, 12, 0.6], '#526970', { roughness: 0.7 });
  for (const x of [-8, -4, 0, 4, 8]) block(`Rear fluting ${x}`, [x, 6, -13.6], [0.18, 11.5, 0.15], '#9baead');
  ring('Oculus · architectural brass surround', [0, 6.2, -12.9], 5.2, 0.4, '#b2905b', [0, 0, 0]);
  ring('Oculus · warm rim', [0, 6.2, -12.65], 4.8, 0.07, GOLD, [0, 0, 0], GOLD);
  block('Reactor dais · collision', [0, 0.35, -4], [9, 0.8, 8], '#45565c', { body: 'fixed', metalness: 0.6 });
  block('Reactor pedestal', [0, 1.15, -4], [3.8, 0.8, 3.8], '#26343d', { body: 'fixed', metalness: 0.8 });
  for (const x of [-3.6, 3.6]) block(`Dais rim ${x}`, [x, 0.77, -4], [0.06, 0.06, 7], CYAN, { glow: CYAN, intensity: 2.5 });

  // Four real sheets, driven by one authored wind vector (their render transforms are never animated).
  for (const x of [-8.5, 8.5]) for (const z of [-3, 6]) {
    block(`Banner crossbar ${x}, ${z}`, [x, 6.3, z], [2.5, 0.08, 0.08], '#b99967', { metalness: 0.8 });
    const id = part('plane', `Wind banner ${x}, ${z}`, [x, 4.7, z], [1, 1, 1], x < 0 ? '#bf724a' : '#438d98', { metalness: 0.02, roughness: 0.85 });
    store.addCloth(id);
    store.updateCloth(id, { enabled: true, sourceMode: 'grid', resolution: 12, width: 2.2, height: 3.2, pinMode: 'top-edge', wind: [0, 0, 0], turbulence: 0.22, collideFloor: false, collideBodies: false });
  }

  // Act I: a heavy ball strikes a line of independently simulated brass/ceramic dominoes.
  const ball = part('sphere', 'Impulse ball · real rigid body', [-7.4, 0.85, 6], [1.6, 1.6, 1.6], '#c48d4d', { body: 'dynamic', metalness: 0.85, roughness: 0.2 });
  store.updatePhysics(ball, { mass: 5, friction: 0.22, restitution: 0.25, linearDamping: 0.04 });
  for (let i = 0; i < 12; i++) {
    const id = part('cube', `Domino ${String(i + 1).padStart(2, '0')} · real rigid body`, [-4.8 + i * 0.82, 1.2, 6], [0.28, 2.4, 1.15], i % 3 === 0 ? '#cb995c' : '#a0babd', { body: 'dynamic', metalness: i % 3 === 0 ? 0.8 : 0.3, roughness: 0.3 });
    store.updatePhysics(id, { mass: 0.75, friction: 0.5, restitution: 0.04, angularDamping: 0.06 });
  }
  block('Kinetic lane · front brass edge', [0, 0.055, 7.15], [18, 0.08, 0.07], GOLD, { glow: GOLD, intensity: 1 });
  block('Kinetic lane · back brass edge', [0, 0.055, 4.85], [18, 0.08, 0.07], GOLD, { glow: GOLD, intensity: 1 });

  // Act II: three nested gyroscope rings frame a suspended, destructible reactor shell.
  const outer = ring('02 · Gyroscope outer', CORE, 4.05, 0.18, '#b29161', [0.1, 0.15, 0]);
  const middle = ring('03 · Gyroscope middle', CORE, 3.55, 0.11, CYAN, [0.4, 0.75, 0.2], CYAN);
  const inner = ring('04 · Gyroscope inner', CORE, 2.95, 0.14, '#78949b', [-0.4, -0.55, 0]);
  const core = part('cube', 'Reactor shell · live fracture', CORE, [2.4, 3.6, 2.4], '#77959c', { rotation: [0.12, Math.PI / 4, 0], body: 'fixed', metalness: 0.75, roughness: 0.24 });
  store.setObjectFracture(core, { enabled: true, pattern: 'shatter', pieces: 4, seed: 27, strength: 7, impactThreshold: 0, focusImpact: false, debrisLifetime: 12, inheritVelocity: true });
  const heart = part('sphere', 'Exposed luminous heart', CORE, [1.1, 1.1, 1.1], CYAN, { glow: CYAN, intensity: 2.5, metalness: 0.45, roughness: 0.15 });
  const seam = part('cube', 'Shell charge seam', [0, 5.8, -2.23], [0.09, 3.1, 0.09], CYAN, { glow: CYAN, intensity: 0.3 });
  const lamp = (name: string, position: Vector3Tuple, color: string, intensity: number, distance: number) => {
    const id = store.createObjectWithProps('light', { name, position });
    store.setObjectLight(id, { type: 'point', color, intensity, distance, castShadow: false });
    return id;
  };
  lamp('Warm key · kinetic lane', [-4, 5, 8], GOLD, 40, 18);
  lamp('Cool fill · hall', [7, 7, -1], '#a4dbe8', 45, 24);
  const chargeLight = lamp('Charge light · staged at 16 seconds', [0, 5.8, -1.8], CYAN, 70, 22);
  const impactLight = lamp('Release flash · staged at 24 seconds', [0, 5.8, -1], '#e0fcff', 160, 24);

  store.applyRenderPreset(scene.id, 'moody-cinematic');
  store.updateSceneEnvironment(scene.id, {
    skyMode: 'procedural', skyTopColor: '#1b384b', skyHorizonColor: '#b5c8cb', skyGroundColor: '#293d49',
    environmentIntensity: 0.8, sunColor: '#ffe0b2', sunIntensity: 2.2, sunElevation: 32, sunAzimuth: 235,
    fogEnabled: true, fogColor: '#435d69', fogNear: 30, fogFar: 110,
    volumetricFogEnabled: true, volumetricFogDensity: 0.01, volumetricFogColor: '#afc5ce',
    volumetricFogHeight: 0, volumetricFogFalloff: 0.12, volumetricScattering: 0.45, volumetricSunStrength: 0.8, volumetricMaxDistance: 60,
    gravity: [0, -9.81, 0], wind: [1.6, 0, 2.8], windTurbulence: 0.35,
    lux: { enabled: true, mode: 'fixed', quality: 'balanced', position: [0, 4, 2], radius: 25, indirectIntensity: 0.5, reflections: true, reflectionIntensity: 0.8, screenTraces: true, updateInterval: 1, smoothing: 0.4 },
  });
  store.updateRenderSettings({ quality: 'High', autoQuality: true, bloomEnabled: true, bloomIntensity: 0.45, bloomThreshold: 0.85, bloomRadius: 0.55, vignetteEnabled: false });

  const cinematicId = store.createCinematic('Resonance', RESONANCE_DURATION);
  store.updateCinematic(cinematicId, { autoplay: true, skippable: false, frameRate: 60 });
  store.setCinematicLook(cinematicId, { letterbox: 2.39, grade: 'teal-orange', gradeIntensity: 0.12, grain: 0.015, vignette: 0.13, motionBlur: 0.03, anamorphic: 0, chromaticAberration: 0, lightLeak: 0, lensDirt: 0 });
  const beat = (action: Omit<CinematicAction, 'id'>) => store.addCinematicAction(cinematicId, action);
  const shot = (name: string, start: number, end: number, from: Vector3Tuple, to: Vector3Tuple, target: Vector3Tuple, fov = 48, shake = 0) => beat({
    type: 'camera', label: name, time: start, duration: end - start, interpolation: 'smooth', shake, shakeFrequency: 12,
    keyframes: [{ time: start, position: from, lookAt: target, fov, aperture: 0 }, { time: end, position: to, lookAt: target, fov, aperture: 0 }],
  });
  shot('01 · Wind / tactile opening', 0, 4, [-10, 5.2, 10.5], [-9.8, 4.9, 9.5], [-7.4, 4.7, 5], 48);
  shot('02 · The hall / establishing dolly', 4, 8, [8.3, 7.5, 18], [6.3, 6.4, 15], [0, 4.3, -3], 57);
  shot('03 · Transfer / real domino collision', 8, 14, [-5.8, 3.6, 12.4], [5.4, 3.3, 12], [0, 1.2, 6], 57);
  shot('04 · The machine / low crane', 14, 19, [4.8, 1.6, 6.5], [6, 3.8, 4.5], CORE, 52);
  shot('05 · Charge / intimate orbit', 19, 24, [5.8, 6.5, 3.3], [-4.5, 7.1, 3.5], CORE, 48);
  shot('06 · Release / quarter-speed debris', 24, 26, [-5.3, 6.4, 6], [-6.3, 6.9, 7.7], CORE, 59, 0.11);
  shot('07 · Afterglow / crane out', 26, 29, [-6.3, 6.9, 7.7], [3.6, 8, 13], [0, 4.7, -4], 59);
  shot('08 · Resonance / final tableau', 29, 32, [3.6, 8, 13], [0, 7.1, 16], [0, 4.7, -4], 57);
  beat({ type: 'fade', label: 'Open from ink', time: 0, duration: 1.2, fadeFrom: 1, fadeTo: 0, fadeColor: '#09171e' });
  beat({ type: 'text', label: 'Opening card', time: 1.5, duration: 2.2, text: 'FEATHER ENGINE  /  REAL-TIME STUDY 01', textStyle: 'lowerThird', textColor: '#f4dfc4' });
  beat({ type: 'text', label: 'Film title', time: 4.6, duration: 2.7, text: 'R E S O N A N C E', textStyle: 'title', textColor: '#eef7f5' });
  beat({ type: 'text', label: 'Physics chapter', time: 9, duration: 3.5, text: '01 / MOMENTUM     Rigid bodies · real collisions', textStyle: 'lowerThird', textColor: '#f4dfc4' });
  beat({ type: 'text', label: 'Light chapter', time: 15, duration: 3.2, text: '02 / RADIANCE     Local light · reflections · atmosphere', textStyle: 'lowerThird', textColor: '#c5f4f5' });
  beat({ type: 'text', label: 'Fracture chapter', time: 24.7, duration: 1.9, text: '03 / RELEASE     Live fracture · quarter-speed physics', textStyle: 'lowerThird', textColor: '#d9f7f5' });
  beat({ type: 'text', label: 'Closing credit', time: 28.8, duration: 2.4, text: 'FEATHER ENGINE', textStyle: 'title', textColor: '#f2f7ef' });

  for (const [assembly, from, to] of [
    [outer, [0.1, 0.15, 0], [0.15, 0.3, Math.PI * 0.8]],
    [middle, [0.4, 0.75, 0.2], [0.8, Math.PI * 1.7, -0.5]],
    [inner, [-0.4, -0.55, 0], [-0.8, -Math.PI * 1.4, 1.2]],
  ] as const) beat({ type: 'transform', label: 'Gyroscope / decorative rotation', time: 0, duration: 32, objectId: assembly.root, interpolation: 'linear',
    transformKeyframes: [{ time: 0, position: CORE, rotation: [...from], scale: [1, 1, 1] }, { time: 32, position: CORE, rotation: [...to], scale: [1, 1, 1] }],
  });
  for (const id of [seam, ...middle.segments]) beat({ type: 'material', label: 'Charge / emissive rise', time: 16, duration: 8, objectId: id,
    materialKeyframes: [{ time: 16, emissiveColor: CYAN, emissiveIntensity: 0.6 }, { time: 21, emissiveColor: CYAN, emissiveIntensity: 2.5 }, { time: 23.6, emissiveColor: '#dbffff', emissiveIntensity: 4.5 }, { time: 24, emissiveColor: '#f2ffff', emissiveIntensity: 7 }],
  });
  for (const id of middle.segments) beat({ type: 'material', label: 'Afterglow / light settles', time: 24, duration: 5, objectId: id, fromMaterial: { emissiveColor: '#dbffff', emissiveIntensity: 5 }, toMaterial: { emissiveColor: CYAN, emissiveIntensity: 1.2 } });
  for (const [id, on, off] of [[chargeLight, 16, 27], [impactLight, 24, 24.3]] as const) {
    beat({ type: 'visibility', label: 'Light cue / initially off', time: 0, objectId: id, visible: false });
    beat({ type: 'visibility', label: 'Light cue / on', time: on, objectId: id, visible: true });
    beat({ type: 'visibility', label: 'Light cue / off', time: off, objectId: id, visible: false });
  }
  beat({ type: 'visibility', label: 'Seam removed with fractured shell', time: 24, objectId: seam, visible: false });
  beat({ type: 'material', label: 'Heart / afterglow', time: 24, duration: 6, objectId: heart, fromMaterial: { emissiveColor: '#e3ffff', emissiveIntensity: 7 }, toMaterial: { emissiveColor: CYAN, emissiveIntensity: 2.5 } });
  beat({ type: 'fade', label: 'Release / brief cyan exposure flash', time: 23.98, duration: 0.32, fadeDip: true, fadeFrom: 0, fadeTo: 0.65, fadeColor: '#deffff' });
  // Cinematic timeDilation only affects the sequence clock. Blueprint Set Time Scale slows the
  // simulation; its reciprocal here preserves the 32s music/camera edit during the slow-motion shot.
  beat({ type: 'timeDilation', label: 'Keep camera and score in real time during slow motion', time: 24, duration: 2, timeScale: 4 });
  beat({ type: 'timeDilation', label: 'Restore camera clock after slow motion', time: 26, timeScale: 1 });

  const endScreen = store.createUIDocument('Resonance · Replay', 'screen');
  store.updateUIDocument(endScreen, { visibleOnStart: false, css: '.resonance-credit { letter-spacing: 2px; } .resonance-replay { cursor: pointer; } .resonance-replay:hover { background: #b7f2ef !important; } .resonance-replay:focus-visible { outline: 3px solid #ffca8a; outline-offset: 4px; }' });
  const root = useEditorStore.getState().uiDocuments.find(d => d.id === endScreen)!.root.id;
  // A screen root fills the viewport. Anchor a child card so the final tableau stays visible.
  store.updateUIElement(endScreen, root, { name: 'Replay screen', style: { padding: '0', background: 'transparent' } });
  const card = store.addUIElement(endScreen, root, 'panel');
  store.updateUIElement(endScreen, card, { name: 'Closing card', anchor: { h: 'center', v: 'bottom', offsetX: 0, offsetY: 55 }, style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', padding: '18px 30px', background: 'rgba(8,23,31,.88)', border: '1px solid rgba(137,216,221,.3)', borderRadius: '4px', color: '#eef8f7', width: '390px', maxWidth: '85vw' } });
  const caption = store.addUIElement(endScreen, card, 'text');
  store.updateUIElement(endScreen, caption, { name: 'Installation credit', text: 'RESONANCE  /  Made in Feather', className: 'resonance-credit', style: { fontSize: '14px', textAlign: 'center' } });
  const replay = store.addUIElement(endScreen, card, 'button');
  store.updateUIElement(endScreen, replay, { name: 'Replay film', text: 'Replay film', className: 'resonance-replay', style: { padding: '11px 30px', background: '#86d9df', color: '#102b35', fontWeight: '700', borderRadius: '3px' } });
  store.setUIButtonAction(endScreen, replay, { kind: 'restartScene' });

  const director = part('empty', '05 · Director / open Blueprint to edit cues', CORE, [1, 1, 1], '#ffffff');
  const { blueprintId } = store.createBlueprintNamed('Resonance · Physics & replay cues', 'Timeline events launch the ball, fracture the shell, slow physics and show Replay. R restarts the entire authored scene.');
  store.attachScript(director, blueprintId);
  const chain = (eventName: string, row: number, specs: Array<[string, NodeForgeNodeData['category'], Partial<NodeForgeNodeData>]>) => {
    let prev = store.addGraphNodeToBlueprint(blueprintId, 'Custom Event', 'Events', { eventName }, { x: 0, y: row * 230 });
    specs.forEach(([label, category, data], index) => {
      const node = store.addGraphNodeToBlueprint(blueprintId, label, category, data, { x: (index + 1) * 310, y: row * 230 });
      store.connectGraphNodes(blueprintId, prev, node, 'exec-out', 'exec-in');
      prev = node;
    });
  };
  chain('resonance_launch', 0, [['Apply Impulse', 'Physics', { targetObjectId: ball, axis: 'x', amount: 24, space: 'world' }]]);
  chain('resonance_release', 1, [['Fracture', 'Physics', { targetObjectId: core }], ['Set Time Scale', 'Runtime', { numberValue: 0.25 }]]);
  chain('resonance_afterglow', 2, [['Set Time Scale', 'Runtime', { numberValue: 1 }]]);
  chain('resonance_finished', 3, [['Show UI', 'UI', { documentId: endScreen }], ['Set Time Scale', 'Runtime', { numberValue: 0 }]]);
  const key = store.addGraphNodeToBlueprint(blueprintId, 'Key Down', 'Events', { keyCode: 'KeyR', keyTriggerMode: 'pressed' }, { x: 0, y: 920 });
  const restart = store.addGraphNodeToBlueprint(blueprintId, 'Load Scene', 'Runtime', { restartScene: true }, { x: 310, y: 920 });
  store.connectGraphNodes(blueprintId, key, restart, 'exec-out', 'exec-in');
  for (const [time, eventName] of [[8.15, 'resonance_launch'], [24, 'resonance_release'], [26, 'resonance_afterglow'], [31.7, 'resonance_finished']] as const) beat({ type: 'event', label: eventName.replace(/_/g, ' / '), time, eventName });
  for (const [time, label, color] of [[0, 'Wind', GOLD], [4, 'Resonance', CYAN], [8.15, 'Impulse → collision', GOLD], [14, 'Radiance', CYAN], [19, 'Charge', CYAN], [24, 'Live fracture / slow physics', '#ffffff'], [26, 'Afterglow', CYAN], [31.7, 'Replay', GOLD]] as const) store.addCinematicMarker(cinematicId, { time, label, color, determinismFence: time === 24 });

  const audioFolder = store.createFolder('Resonance · Score & sound');
  const audio = await Promise.all([
    importAudio('fall', 'fall_music.wav', audioFolder), importAudio('fall', 'wind_rush.mp3', audioFolder),
    importAudio('monolith', 'portal_approach.mp3', audioFolder), importAudio('monolith', 'lightning_crack.mp3', audioFolder),
    importAudio('monolith', 'awakening_impact.mp3', audioFolder), importAudio('monolith', 'arrival_chime.mp3', audioFolder),
  ]);
  audio.forEach((asset, index) => {
    if (asset) beat({ type: 'sound', label: ['Score / Resonance', 'Wind / opening', 'Charge / swell', 'Release / crack', 'Release / impact', 'Afterglow / chime'][index], time: [0, 0.8, 19, 24, 24, 28][index], soundId: asset.id });
  });
  store.setActiveCinematic(cinematicId);
  store.selectObject(director);
  return cinematicId;
}
