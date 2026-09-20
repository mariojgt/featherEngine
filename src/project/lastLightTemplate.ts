import { getPlatform } from '../platform';
import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import type { AssetItem, CinematicAction, NodeForgeNodeData, SceneObjectKind, Vector3Tuple } from '../types';

export const LAST_LIGHT_DURATION = 70;
export const LAST_LIGHT_RELEASE = 48;
const HEART: Vector3Tuple = [0, 6, -5];
const GOLD = '#ffd19a';
const ICE = '#b1eef2';

/** A complete, editable film set. Geometry, terrain, lighting and destruction run in Feather. */
export async function createLastLightTemplate(): Promise<string | undefined> {
  const s = useEditorStore.getState();
  const scene = s.activeScene();
  if (!scene) return undefined;
  for (const id of ['obj-player', 'obj-ground', 'obj-enemy', 'obj-light', 'obj-camera']) {
    if (selectActiveObjects(useEditorStore.getState()).some(o => o.id === id)) s.deleteObject(id);
  }
  s.renameScene(scene.id, 'Last Light · The drowned observatory');
  const surfaceAssets: Record<string, string> = {};
  for (const name of ['stone-albedo.png', 'stone-normal.png']) {
    try {
      const response = await fetch(`templates/last-light/${name}`);
      if (!response.ok) continue;
      const file = new File([await response.blob()], name, { type: 'image/png' });
      const imported = await (await getPlatform()).importAsset(useProjectStore.getState().projectDir ?? 'web', file);
      const asset: AssetItem = { id: `asset-${crypto.randomUUID()}`, name, type: 'image', size: file.size, path: imported.path, url: imported.url, createdAt: Date.now() };
      s.addAssetItems([asset]); surfaceAssets[name] = asset.id;
    } catch { /* Surfaces fall back to their authored colors without optional maps. */ }
  }
  const stoneMaterial = s.createMaterial('Last Light · Weathered limestone', 'Original procedural stone with fine pores and worn mineral fissures.');
  s.updateMaterial(stoneMaterial, { color: '#ffffff', metalness: 0.05, roughness: 0.85, textureAssetId: surfaceAssets['stone-albedo.png'], normalMapAssetId: surfaceAssets['stone-normal.png'] });
  const part = (kind: SceneObjectKind, name: string, position: Vector3Tuple, scale: Vector3Tuple, color: string, rotation: Vector3Tuple = [0, 0, 0], metalness = 0.05, roughness = 0.82) => {
    const id = s.createObjectWithProps(kind, { name, position, color });
    s.updateTransform(id, 'scale', scale);
    s.updateTransform(id, 'rotation', rotation);
    if (!['empty', 'light', 'terrain'].includes(kind)) s.updateRenderer(id, { metalness, roughness,
      ...(kind === 'cube' && metalness < 0.6 ? { materialId: stoneMaterial, materialOverrides: { color, metalness, roughness } } : {}),
    });
    return id;
  };
  const glow = (id: string, color: string, intensity: number) => s.updateRenderer(id, { materialOverrides: { emissiveColor: color, emissiveIntensity: intensity } });
  const fixed = (id: string) => s.updatePhysics(id, { enabled: true, bodyType: 'fixed', collider: 'box', friction: 0.7 });
  const lamp = (name: string, position: Vector3Tuple, color: string, intensity: number, distance: number) => {
    const id = s.createObjectWithProps('light', { name, position });
    s.setObjectLight(id, { type: 'point', color, intensity, distance, castShadow: false });
    return id;
  };
  // A shared heightfield drives both streamed meshes and terrain collision.
  const terrain = s.createObjectWithProps('terrain', { name: '01 · Mountain basin / sculpt and paint me', position: [0, -17, -65] });
  s.updateTerrain(terrain, {
    size: 448, chunkSize: 48, resolution: 40, streamRadius: 5, physicsRadius: 1, seed: 2718,
    heightScale: 75, frequency: 0.0105, octaves: 5, persistence: 0.46, lacunarity: 2.1,
    ridgeStrength: 0.88, domainWarp: 48,
    materialLayers: [
      { id: 'basin-silt', name: 'Wet shale', color: '#283c3c' },
      { id: 'basin-rock', name: 'Weathered stone', color: '#647775' },
      { id: 'basin-snow', name: 'Pale summits', color: '#b3bfbc' },
    ],
    foliage: { ...selectActiveObjects(useEditorStore.getState()).find(o => o.id === terrain)!.terrain!.foliage, enabled: false },
  });
  s.sculptTerrainAt(terrain, [0, -3, 0], { operation: 'flatten', radius: 56, strength: 1, flattenHeight: 14 });
  const water = part('cube', '02 · Still water / shallow reflections', [0, -3.2, 0], [240, 3, 240], '#34545a');
  s.updateRenderer(water, { hideInPlay: true });
  s.updateWater(water, { enabled: true, style: 'custom', shallowColor: '#446367', deepColor: '#13282f', opacity: 0.85, reflectivity: 0.7, foam: 0.12, sparkle: 0.25, waveAmplitude: 0.07, waveFrequency: 0.07, waveSpeed: 0.25, flowStrength: 0.12, caustics: 0.1 });

  // Terraced island and ceremonial approach. Broken stone silhouettes frame the water shots.
  for (let i = 0; i < 4; i++) {
    const id = part('cube', `03 · Observatory terrace ${i + 1}`, [0, -1.3 + i * 0.38, -5], [29 - i * 3.4, 0.8, 27 - i * 3.2], ['#364849', '#53615c', '#69746a', '#788074'][i]);
    fixed(id);
  }
  for (let i = 0; i < 18; i++) {
    const z = 9 + i * 2.8;
    const id = part('cube', `Approach / worn flagstone ${i + 1}`, [Math.sin(i * 1.1) * 0.12, -0.95, z], [5.2, 0.65, 2.5], i % 3 ? '#7b8172' : '#5e6b65', [0, Math.sin(i) * 0.025, 0]);
    if (i < 5) fixed(id);
  }
  let seed = 9837;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const rockSpecs = Array.from({ length: 4 }, (_, variant) => {
    const spec = s.createModelSpec('blank', `Last Light · Shale outcrop ${variant + 1}`)!;
    s.updateModelSpec(spec, { style: { finish: 'flat', bevel: 0.025, roughness: 0.9 }, palette: ['#58645f', '#758076', '#3e514e'] });
    const corners: Record<number, Vector3Tuple> = {};
    for (let corner = 0; corner < 8; corner++) corners[corner] = [
      (corner & 1 ? -1 : 1) * (corner & 2 ? 0.12 + random() * 0.25 : random() * 0.08),
      (random() - 0.5) * 0.25,
      (corner & 4 ? -1 : 1) * (corner & 2 ? random() * 0.3 : random() * 0.08),
    ];
    s.addModelPart(spec, 'box', { name: 'Weathered outcrop', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], colorSlot: variant % 3, corners });
    return spec;
  });
  for (let i = 0; i < 65; i++) {
    const a = random() * Math.PI * 2;
    const radius = 17 + random() * 53;
    const x = Math.cos(a) * radius;
    const z = Math.sin(a) * radius - 5;
    if (Math.abs(x) < 5 && z > 7) continue;
    const h = 1.2 + random() * 5;
    const rock = part('cube', `Shore / fractured shale ${i + 1}`, [x, -1.6 + h * 0.3, z], [2.5 + random() * 5, h, 2 + random() * 4], ['#4e605c', '#6e7970', '#384d4c'][i % 3], [random() * 0.3, random() * 6.28, random() * 0.45]);
    s.attachModelSpec(rock, rockSpecs[i % rockSpecs.length]);
  }
  // Asymmetric remnants read as an abandoned place, with a surviving arch at the hero's back.
  for (const x of [-9, 9]) for (let i = 0; i < 5; i++) {
    const z = 5 - i * 5;
    const h = i === 1 && x < 0 ? 3.2 : 7 + (i % 3) * 0.9;
    part('cube', `Colonnade / foot ${x},${i}`, [x, 0.7, z], [2.2, 0.55, 2.2], '#8b8c78');
    for (let j = 0; j < 4; j++) part('cube', `Colonnade / weathered course ${x},${i},${j}`, [x, 1 + (j + 0.5) * h / 4, z], [1.35 - j * 0.05, h / 4 - 0.055, 1.5], j % 2 ? '#95917b' : '#7c8474', [0.008 * j, j * 0.025, x < 0 ? -0.018 : 0.008]);
    part('cube', `Colonnade / capital ${x},${i}`, [x, h + 1.2, z], [2, 0.4, 2], '#aaa48a');
  }
  for (let i = 0; i <= 16; i++) {
    const a = i / 16 * Math.PI;
    part('cube', `Surviving arch / voussoir ${i}`, [Math.cos(a) * 8.8, 7.5 + Math.sin(a) * 8.8, -15], [1.6, 1.7, 1.8], i % 3 === 0 ? '#aca68c' : '#858b79', [0, 0, a]);
  }
  // A tilted golden instrument, inlaid with thin luminous lines. This is the film's recurring shape.
  const halo = part('empty', '04 · Astral instrument / animated assembly', HEART, [1, 1, 1], '#ffffff');
  for (let i = 0; i < 48; i++) {
    const a = i / 48 * Math.PI * 2;
    const id = part('cube', `Instrument / gold segment ${i}`, [Math.cos(a) * 5, Math.sin(a) * 5, 0], [0.18, 0.69, 0.28], '#bc9a60', [0, 0, a], 0.78, 0.28);
    s.setObjectParent(id, halo);
    // setObjectParent preserves world pose; restore the intended local pose explicitly.
    s.updateTransform(id, 'position', [Math.cos(a) * 5, Math.sin(a) * 5, 0]);
  }
  const shell = part('cube', '05 · The last seal / live Voronoi fracture', HEART, [2.9, 5.8, 2.1], '#667c79', [0, Math.PI / 4, 0], 0.48, 0.35);
  fixed(shell);
  s.setObjectFracture(shell, { enabled: true, pattern: 'shatter', pieces: 4, seed: 71, strength: 5.5, angularSpeed: 2.2, jitter: 0.65, focusImpact: false, impactThreshold: 0, debrisLifetime: 24, inheritVelocity: true });
  const heart = part('sphere', '06 · Light inside the seal', HEART, [1.35, 1.35, 1.35], GOLD, [0, 0, 0], 0.45, 0.24);
  glow(heart, GOLD, 2.5);
  const seam = part('cube', 'Seal / illuminated inscription', [0.78, 6, -3.88], [0.065, 4.9, 0.06], GOLD);
  glow(seam, GOLD, 0.7);
  const lamps: string[] = [];
  for (const x of [-5.5, 5.5]) for (const z of [4, -5, -13]) {
    part('cube', `Votive / plinth ${x},${z}`, [x, 0.9, z], [0.8, 1.3, 0.8], '#4a5c59');
    const id = part('sphere', `Votive / ember ${x},${z}`, [x, 1.65, z], [0.25, 0.25, 0.25], GOLD);
    glow(id, GOLD, 2.8);
    lamps.push(lamp(`Votive / pool of warm light ${x},${z}`, [x, 2, z], GOLD, 12, 7));
  }
  lamp('Key / cool water bounce', [-6, 8, 4], '#c5edf2', 50, 24);
  const chargeLight = lamp('Cue / golden awakening', [0, 6, -2], GOLD, 95, 25);
  const flashLight = lamp('Cue / release flash', [0, 6, 0], '#fff2d6', 240, 30);
  for (const x of [-7.8, 7.8]) {
    const banner = part('plane', `Relic / wind-torn banner ${x}`, [x, 5.5, -9.5], [1, 1, 1], x < 0 ? '#937258' : '#647f7a');
    s.addCloth(banner);
    s.updateCloth(banner, { enabled: true, width: 1.6, height: 3.6, resolution: 12, pinMode: 'top-edge', wind: [0, 0, 0], turbulence: 0.2, collideFloor: false, collideBodies: false });
  }
  s.applyRenderPreset(scene.id, 'moody-cinematic');
  s.updateSceneEnvironment(scene.id, {
    skyMode: 'procedural', skyTopColor: '#1c3a51', skyHorizonColor: '#aebcc0', skyGroundColor: '#182e3b',
    environmentIntensity: 0.55, ambientMode: 'hemisphere', ambientIntensity: 0.18,
    sunColor: '#ffe1b0', sunIntensity: 2.8, sunAzimuth: 235, sunElevation: 17, sunShadowExtent: 42,
    fogEnabled: true, fogColor: '#728a90', fogNear: 55, fogFar: 230,
    aerialFogEnabled: true, aerialFogHeightFalloff: 0.045, aerialFogInscatter: 0.65,
    volumetricFogEnabled: true, volumetricFogDensity: 0.006, volumetricFogColor: '#9db4bd',
    volumetricFogHeight: -2, volumetricFogFalloff: 0.11, volumetricScattering: 0.58, volumetricSunStrength: 0.8, volumetricMaxDistance: 120,
    contactShadows: false, wind: [2.2, 0, 1.3], windTurbulence: 0.4,
    lux: { enabled: true, quality: 'balanced', mode: 'fixed', position: [0, 5, -4], radius: 28, indirectIntensity: 0.35, reflections: true, reflectionIntensity: 0.55, updateInterval: 2, smoothing: 0.45 },
  });
  s.updateRenderSettings({ quality: 'High', autoQuality: false, bloomEnabled: true, bloomIntensity: 0.35, bloomThreshold: 0.95, bloomRadius: 0.6, vignetteEnabled: false });
  const id = s.createCinematic('Last Light', LAST_LIGHT_DURATION);
  s.updateCinematic(id, { autoplay: true, skippable: false, frameRate: 24 });
  s.setCinematicLook(id, { letterbox: 2.39, grade: 'teal-orange', gradeIntensity: 0.22, grain: 0.015, vignette: 0.16, motionBlur: 0, anamorphic: 0.025, chromaticAberration: 0 });
  const beat = (action: Omit<CinematicAction, 'id'>) => s.addCinematicAction(id, action);
  const shot = (label: string, start: number, end: number, from: Vector3Tuple, to: Vector3Tuple, target: Vector3Tuple, fov: number, aperture = 0) => beat({
    type: 'camera', label, time: start, duration: end - start, interpolation: 'linear',
    keyframes: [from, to].map((position, i) => ({ time: i ? end : start, position, lookAt: target, fov, aperture, focusDistance: Math.hypot(...position.map((v, axis) => v - target[axis])) })),
  });
  shot('01 / The drowned valley · aerial approach', 0, 9, [59, 34, 92], [37, 22, 66], [0, 4, -8], 49);
  shot('02 / A path through still water · low dolly', 9, 17, [5, 1.2, 45], [3.8, 1.6, 30], [0, 5, -7], 52);
  shot('03 / Traces of the past · lateral stone study', 17, 24, [-14, 4, 9], [-12, 5, 2], [-5, 4, -6], 48);
  shot('04 / The observatory · crane reveal', 24, 32, [4, 8, 19], [6, 13, 17], [0, 6, -6], 54);
  shot('05 / One ember remains · close focus', 32, 39, [3.6, 2.5, 7.2], [4.2, 2.8, 6], [5.5, 1.65, 4], 42, 0.4);
  shot('06 / Awakening · monumental push', 39, 45, [6, 5, 8], [4.2, 5.7, 4], HEART, 46);
  shot('07 / Held breath · the last seal', 45, 48, [-4.8, 6.8, 3], [-3.8, 6.5, 2.7], HEART, 44);
  shot('08 / Release · live fracture', 48, 53, [-7, 5.5, 7], [-10, 7, 10], HEART, 53);
  shot('09 / The light survives · orbit', 53, 61, [-10, 7, 10], [10, 9, 14], [0, 5, -5], 56);
  shot('10 / Last light · departure', 61, 70, [10, 9, 14], [23, 17, 38], [0, 6, -7], 52);
  beat({ type: 'fade', label: 'From black', time: 0, duration: 2, fadeFrom: 1, fadeTo: 0, fadeColor: '#050b10' });
  beat({ type: 'text', label: 'Opening credit', time: 2.2, duration: 4.4, text: 'A FEATHER ENGINE FILM', textStyle: 'credit', textColor: '#e8e7d5' });
  beat({ type: 'text', label: 'Last Light', time: 10.2, duration: 4.8, text: 'L A S T   L I G H T', textStyle: 'title', textColor: '#eee6d6' });
  beat({ type: 'text', label: 'Closing title', time: 62, duration: 5.2, text: 'FEATHER ENGINE', textStyle: 'title', textColor: '#eee6d6' });
  beat({ type: 'text', label: 'Closing credit', time: 63.5, duration: 4, text: 'An editable world. A story told in light.', textStyle: 'credit', textColor: '#d6ded8' });
  beat({ type: 'fade', label: 'To black / exact 70-second ending', time: 68, duration: 2, fadeFrom: 0, fadeTo: 1, fadeColor: '#050b10' });
  beat({ type: 'transform', label: 'Instrument / slow precession', time: 0, duration: 70, objectId: halo, fromRotation: [0.12, -0.3, 0], toRotation: [0.12, 0.45, 0.5] });
  beat({ type: 'material', label: 'Seal / rising light', time: 39, duration: 9, objectId: seam, fromMaterial: { emissiveColor: GOLD, emissiveIntensity: 0.7 }, toMaterial: { emissiveColor: '#fff3d7', emissiveIntensity: 6 } });
  beat({ type: 'material', label: 'Heart / afterglow', time: 48, duration: 12, objectId: heart, fromMaterial: { emissiveColor: '#fff3d7', emissiveIntensity: 8 }, toMaterial: { emissiveColor: GOLD, emissiveIntensity: 2.5 } });
  for (const [light, on, off] of [[chargeLight, 39, 61], [flashLight, 48, 48.2]] as const) {
    beat({ type: 'visibility', time: 0, objectId: light, visible: false });
    beat({ type: 'visibility', time: on, objectId: light, visible: true });
    beat({ type: 'visibility', time: off, objectId: light, visible: false });
  }
  beat({ type: 'visibility', label: 'The inscription breaks', time: 48, objectId: seam, visible: false });
  beat({ type: 'fade', label: 'Release / exposure bloom', time: 48, duration: 0.24, fadeDip: true, fadeFrom: 0, fadeTo: 0.35, fadeColor: '#fff3dd' });
  beat({ type: 'timeDilation', label: 'Keep edit on time during quarter-speed physics', time: 48, duration: 5, timeScale: 4 });
  beat({ type: 'timeDilation', label: 'Normal time', time: 53, timeScale: 1 });
  const director = part('empty', '07 · Director / destruction and atmosphere cues', [0, 0, 0], [1, 1, 1], '#ffffff');
  const { blueprintId } = s.createBlueprintNamed('Last Light · Director', 'Timeline events fracture the seal, slow physics and restore speed. Press R to replay.');
  s.attachScript(director, blueprintId);
  const event = (name: string, row: number, specs: Array<[string, NodeForgeNodeData['category'], Partial<NodeForgeNodeData>]>) => {
    let prev = s.addGraphNodeToBlueprint(blueprintId, 'Custom Event', 'Events', { eventName: name }, { x: 0, y: row * 240 });
    specs.forEach(([label, category, data], i) => {
      const node = s.addGraphNodeToBlueprint(blueprintId, label, category, data, { x: 330 * (i + 1), y: row * 240 });
      s.connectGraphNodes(blueprintId, prev, node, 'exec-out', 'exec-in'); prev = node;
    });
  };
  event('last_light_release', 0, [['Fracture', 'Physics', { targetObjectId: shell }], ['Set Time Scale', 'Runtime', { numberValue: 0.25 }]]);
  event('last_light_afterglow', 1, [['Set Time Scale', 'Runtime', { numberValue: 1 }]]);
  for (const [time, name] of [[48, 'last_light_release'], [53, 'last_light_afterglow']] as const) beat({ type: 'event', time, eventName: name, label: name });
  const key = s.addGraphNodeToBlueprint(blueprintId, 'Key Down', 'Events', { keyCode: 'KeyR', keyTriggerMode: 'pressed' }, { x: 0, y: 480 });
  const restart = s.addGraphNodeToBlueprint(blueprintId, 'Load Scene', 'Runtime', { restartScene: true }, { x: 330, y: 480 });
  s.connectGraphNodes(blueprintId, key, restart, 'exec-out', 'exec-in');
  for (const [time, label] of [[0, 'The valley'], [9, 'Last Light'], [24, 'The observatory'], [39, 'Awakening'], [48, 'Live fracture'], [53, 'Afterglow'], [61, 'Departure'], [70, 'End']] as const) s.addCinematicMarker(id, { time, label, color: time === 48 ? GOLD : ICE, determinismFence: time === 48 || time === 53 });
  // Original synthesized score generated by scripts/generate-last-light-score.mjs; no external music.
  try {
    const response = await fetch('templates/last-light/last-light-score.wav');
    if (response.ok) {
      const blob = await response.blob();
      const file = new File([blob], 'last-light-score.wav', { type: 'audio/wav' });
      const platform = await getPlatform();
      const imported = await platform.importAsset(useProjectStore.getState().projectDir ?? 'web', file);
      const audio: AssetItem = { id: `asset-${crypto.randomUUID()}`, name: file.name, type: 'audio', size: file.size, path: imported.path, url: imported.url, createdAt: Date.now(), folderId: s.createFolder('Last Light · Original score') };
      s.addAssetItems([audio]);
      beat({ type: 'sound', label: 'Original score / 70-second master', time: 0, soundId: audio.id });
    }
  } catch { /* The editable set remains available offline even if the optional score is absent. */ }
  s.setActiveCinematic(id);
  s.selectObject(director);
  return id;
}
