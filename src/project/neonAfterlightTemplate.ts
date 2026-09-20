import { getPlatform } from '../platform';
import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import type { AssetItem, CinematicAction, NodeForgeNodeData, ParticleSystemComponent, SceneEnvironmentSettings, SceneObjectKind, Vector3Tuple } from '../types';

export const NEON_AFTERLIGHT_DURATION = 70;
export const NEON_AFTERLIGHT_ASSETS = ['tower-habitat.glb', 'tower-relay.glb', 'street-workshop.glb', 'service-bridge.glb',
  'sign-afterlight.glb', 'sign-noodle.glb', 'sign-transit.glb', 'sign-soma.glb', 'sign-relay.glb', 'courier-drone.glb', 'utility-vent.glb',
  'asphalt.png', 'asphalt-normal.png', 'cladding.png', 'cladding-normal.png', 'neon-afterlight-score.wav'];
const CYAN = '#53def5', AMBER = '#ffb45c', PINK = '#fa408e';
const ZERO: Vector3Tuple = [0, 0, 0];

/** An original street-scale cyberpunk film: practical light sources, wet materials, water and live VFX. */
export async function createNeonAfterlightTemplate(): Promise<string | undefined> {
  const s = useEditorStore.getState(), scene = s.activeScene();
  if (!scene) return undefined;
  const folder = s.createFolder('Neon Afterlight · Complete district kit'), assets: Record<string, string> = {};
  for (const name of NEON_AFTERLIGHT_ASSETS) {
    const response = await fetch(`templates/neon-afterlight/${name}`);
    if (!response.ok) throw new Error(`Missing Neon Afterlight asset: ${name}. Run npm run cinematic:neon:assets.`);
    const type = name.endsWith('.glb') ? 'model' : name.endsWith('.wav') ? 'audio' : 'image';
    const file = new File([await response.blob()], name, { type: type === 'model' ? 'model/gltf-binary' : type === 'audio' ? 'audio/wav' : 'image/png' });
    const imported = await (await getPlatform()).importAsset(useProjectStore.getState().projectDir ?? 'web', file);
    const asset: AssetItem = { id: `asset-${crypto.randomUUID()}`, name, type, size: file.size, path: imported.path, url: imported.url, createdAt: Date.now(), folderId: folder };
    s.addAssetItems([asset]); assets[name] = asset.id;
  }
  for (const id of ['obj-player', 'obj-ground', 'obj-enemy', 'obj-light', 'obj-camera']) if (selectActiveObjects(useEditorStore.getState()).some(o => o.id === id)) s.deleteObject(id);
  s.renameScene(scene.id, 'Neon Afterlight · District 09');
  const asphalt = s.createMaterial('Afterlight · Rain-soaked asphalt', 'Original aggregate and crack normal map; live weather supplies puddles.');
  s.updateMaterial(asphalt, { color: '#858d98', metalness: .13, roughness: .48, textureAssetId: assets['asphalt.png'], normalMapAssetId: assets['asphalt-normal.png'] });
  const metal = s.createMaterial('Afterlight · Brushed service panels', 'Original panel seams and surface relief.');
  s.updateMaterial(metal, { color: '#71838b', metalness: .7, roughness: .26, textureAssetId: assets['cladding.png'], normalMapAssetId: assets['cladding-normal.png'] });
  const part = (kind: SceneObjectKind, name: string, position: Vector3Tuple, scale: Vector3Tuple = [1, 1, 1], color = '#26313d', rotation: Vector3Tuple = ZERO, parentId?: string) => {
    const id = s.createObjectWithProps(kind, { name, position, color, parentId });
    s.updateTransform(id, 'scale', scale); s.updateTransform(id, 'rotation', rotation); return id;
  };
  const model = (name: string, file: string, position: Vector3Tuple, scale: Vector3Tuple = [1, 1, 1], rotation: Vector3Tuple = ZERO) => {
    const id = part('cube', name, position, scale, '#ffffff', rotation); s.setObjectModel(id, assets[file]); return id;
  };
  const block = (name: string, p: Vector3Tuple, size: Vector3Tuple, material?: string, color?: string) => {
    const id = part('cube', name, p, size, color); if (material) s.setObjectMaterial(id, material); return id;
  };
  const glow = (name: string, p: Vector3Tuple, size: Vector3Tuple, color: string, intensity = 2) => {
    const id = block(name, p, size, undefined, color);
    s.updateRenderer(id, { materialOverrides: { emissiveColor: color, emissiveIntensity: intensity, roughness: .22 } }); return id;
  };
  const area = (name: string, p: Vector3Tuple, color: string, power: number, width: number, height: number, rotation: Vector3Tuple) => {
    const id = part('light', name, p, [1, 1, 1], color, rotation);
    s.setObjectLight(id, { type: 'rect', color, intensity: power, width, height, castShadow: false }); return id;
  };
  const point = (name: string, p: Vector3Tuple, color: string, intensity: number, distance = 16) => {
    const id = part('light', name, p); s.setObjectLight(id, { type: 'point', color, intensity, distance, decay: 2, castShadow: false }); return id;
  };
  const emitter = (name: string, p: Vector3Tuple, preset: 'smoke' | 'sparks' | 'fountain', patch: Partial<ParticleSystemComponent>) => {
    const id = part('empty', name, p); s.addParticles(id, preset); s.updateParticles(id, { gpu: true, light: false, ...patch }); return id;
  };

  // The ground is broken into small UV-mapped sections so surface detail stays at a believable scale.
  for (let z = -78; z <= 42; z += 6) for (const x of [-7, 0, 7]) block('01 · Street / wet asphalt', [x, -.2, z], [7, .3, 6], asphalt);
  for (const side of [-1, 1]) for (let z = -78; z <= 42; z += 6) {
    block('Street / raised service walkway', [side * 11.5, .06, z], [3.6, .45, 6], metal);
    block('Street / curb', [side * 9.6, .18, z], [.18, .65, 6], metal);
    if (z % 12 === 0) {
      block('Street / drain', [side * 8.8, -.025, z], [.7, .04, 1.6], undefined, '#071018');
      for (let i = 0; i < 5; i++) block('Drain / grate', [side * 8.8, 0, z - .6 + i * .3], [.68, .04, .05], metal);
    }
  }
  for (let z = -72; z < 40; z += 9) for (const x of [-.2, .2]) block('Road / worn lane marking', [x, -.035, z], [.07, .015, 2.8], undefined, '#b89e64');

  // Close, layered architecture frames the street; skyline modules extend beyond the hero district.
  for (const side of [-1, 1]) for (let i = 0; i < 6; i++) {
    const z = 30 - i * 23, height = .8 + (i % 3) * .16;
    model(`02 · ${side < 0 ? 'West' : 'East'} habitat ${i + 1}`, i % 3 === 1 ? 'tower-relay.glb' : 'tower-habitat.glb', [side * (19 + i % 2 * 2), 0, z], [1, height, 1], [0, side * -.12, 0]);
    if (i < 5) model('Street / workshop and mechanical facade', 'street-workshop.glb', [side * 17.6, 0, z], [1, 1, 1], [0, side < 0 ? Math.PI / 2 : -Math.PI / 2, 0]);
  }
  for (let i = 0; i < 7; i++) model('Skyline / distant signal towers', i % 2 ? 'tower-relay.glb' : 'tower-habitat.glb', [(i - 3) * 19, 0, -130 - (i % 2) * 20], [1.1, .85 + (i % 3) * .24, 1.1]);
  model('03 · Lower service crossing', 'service-bridge.glb', [0, 13, -30]);
  model('Upper service crossing', 'service-bridge.glb', [0, 24, -67]);
  for (const x of [-8.5, 8.5]) {
    const pipe = part('cube', 'Utility / overhead cable conduit', [x, 9, -31], [.35, 94, .35], '#3c5059', [Math.PI / 2, 0, 0]); s.setObjectMaterial(pipe, metal);
    for (const z of [25, -7, -39, -69]) block('Utility / pipe suspension', [x, 10.5, z], [.12, 3, .12], metal);
  }

  const sign = (name: string, position: Vector3Tuple, size: number, yaw: number, color: string, power = 10) => {
    model(`04 · Sign / ${name}`, `sign-${name}.glb`, position, [size, size, size], [0, yaw, 0]);
    // Model fronts face +Z; Three area lights face -Z.
    const outward: Vector3Tuple = [Math.sin(yaw), 0, Math.cos(yaw)];
    area(`Sign / ${name} practical light`, position.map((v, k) => v + outward[k] * .18) as Vector3Tuple, color, power, 3.8 * size, 1.8 * size, [0, yaw + Math.PI, 0]);
  };
  sign('afterlight', [-10.7, 7, 8], 1.65, .32, CYAN, 14);
  sign('noodle', [10.5, 4.4, 5], 1.2, -.65, AMBER, 13);
  sign('soma', [10.4, 11, -16], 1.55, -.35, PINK, 12);
  sign('relay', [-10, 15, -44], 1.55, .4, '#a799ff', 12);
  sign('transit', [0, 9.2, -30], 2.15, 0, CYAN, 12);
  sign('afterlight', [-14.8, 29, -24], 2.2, .52, CYAN, 8);
  sign('soma', [14.5, 33, -52], 2.3, -.35, PINK, 8);
  sign('transit', [0, 20, -67], 1.6, 0, AMBER, 10);
  for (const side of [-1, 1]) for (const z of [22, -4, -51]) {
    const color = side < 0 ? CYAN : AMBER;
    glow('Shop / practical strip', [side * 11, 2.5, z], [.08, 4.5, .12], color);
    point('Shop / pavement spill', [side * 9.8, 2.6, z], color, 32, 13);
    block('Street / bollard', [side * 8.7, .65, z + 3], [.24, 1.3, .24], metal);
    glow('Bollard / reflector', [side * 8.7, 1.16, z + 3], [.255, .09, .255], color, .9);
  }

  // Real planar water, deliberately foregrounded in two shots. All pools share one height.
  for (const [x, z, width, depth] of [[-3.3, 16, 5, 13], [3.6, -10, 6, 11], [0, -44, 12, 19]] as const) {
    const water = part('cube', '05 · Street water / neon reflection basin', [x, -.17, z], [width, .4, depth]);
    s.updateRenderer(water, { hideInPlay: true });
    s.updateWater(water, { enabled: true, style: 'custom', shallowColor: '#153747', deepColor: '#05111c', opacity: .82, reflectivity: .94,
      waveAmplitude: .017, waveFrequency: .4, waveSpeed: .5, flowStrength: .08, flowAngle: 15, foam: 0, caustics: 0, sparkle: .03, rainStrength: .35 });
  }
  for (const [x, z] of [[-9.8, 10], [10.1, -13], [-10.2, -41], [9.7, 24]] as const) {
    model('Mechanical / rooftop extraction', 'utility-vent.glb', [x, .2, z]);
    emitter('06 · Steam / rising vent plume', [x, 3.2, z], 'smoke', { maxParticles: 100, rate: 20, lifetime: 4.5, speed: .8, speedJitter: .35,
      gravity: -.12, drag: .15, shape: 'disc', shapeRadius: .25, direction: [.15, 1, .1], startSize: .55, endSize: 3.5, startColor: x < 0 ? '#719ca9' : '#b69b92', endColor: '#283440', startOpacity: .13, endOpacity: 0, blend: 'normal' });
  }
  const sparks = emitter('07 · Arc / live maintenance sparks', [-8.8, 5.2, -12], 'sparks', { maxParticles: 240, rate: 80, lifetime: 1.2, speed: 3.8, speedJitter: .6,
    gravity: 4.2, direction: [.7, .3, .5], coneAngle: 46, startSize: .07, endSize: .01, startColor: '#ffe5ad', endColor: '#ff4d12', startOpacity: 1, endOpacity: 0 });
  const arc = point('Arc / electrical discharge', [-8.5, 4.8, -11.7], '#a5dcff', 100, 12);
  // A visible service assembly motivates the close-up's light and gives the water a real outlet.
  model('Cooling / service exchanger', 'utility-vent.glb', [10.2, .2, -40], [1.1, 1.25, 1.1], [0, -.25, 0]);
  block('Cooling / vertical return pipe', [9, 3.5, -40], [.22, 6.2, .22], metal);
  block('Cooling / overflow outlet', [8.45, 6.6, -40], [1.3, .24, .24], metal);
  glow('Cooling / cyan service lamp', [9.35, 4.9, -39.35], [.13, 1.4, .18], CYAN, 2.2);
  point('Cooling / cyan service spill', [8.6, 4.6, -38.9], CYAN, 45, 10);
  glow('Cooling / amber maintenance lamp', [10.3, 1.3, -38.4], [.55, .08, .16], AMBER, 1.8);
  point('Cooling / warm metal fill', [9.3, 2.1, -37.8], AMBER, 24, 8);
  emitter('Water / overflowing cooling pipe', [7.9, 6.6, -40], 'fountain', { maxParticles: 900, rate: 480, lifetime: 1.45, speed: .7, gravity: 6.5,
    direction: [-.7, -.3, 0], shapeRadius: .085, startSize: .024, endSize: .012, startColor: '#a1dfeb', endColor: '#426b7b', startOpacity: .55, endOpacity: .02, blend: 'normal' });
  emitter('Water / coolant impact spray', [7.3, .15, -40], 'fountain', { maxParticles: 260, rate: 150, lifetime: .6, speed: 1.5, gravity: 4,
    direction: [0, 1, 0], coneAngle: 65, shapeRadius: .24, startSize: .027, endSize: .008, startColor: '#79c6db', endColor: '#173347', startOpacity: .6, endOpacity: 0 });

  const drone = model('08 · Courier / animated inspection drone', 'courier-drone.glb', [-5, 7.8, 8]);
  const droneLamp = part('light', 'Courier / moving search beam', [0, -.4, .1], [1, 1, 1], '#d1f6ff', [-Math.PI / 2, 0, 0], drone);
  s.setObjectLight(droneLamp, { type: 'spot', color: '#b6e9ff', intensity: 65, distance: 25, angle: .45, penumbra: .8, useRotation: true, castShadow: true, shadowNear: .2, shadowFar: 28 });
  // A side key supplies a visible shaft through the central crossing and lights its wet deck.
  const shaft = part('light', 'Crossing / amber inspection beam', [9, 12, -27], [1, 1, 1], AMBER, [-.65, .75, 0]);
  s.setObjectLight(shaft, { type: 'spot', color: AMBER, intensity: 180, distance: 45, angle: .5, penumbra: .65, useRotation: true, castShadow: true });
  area('Street / overhead blue bounce', [0, 20, 6], '#739ebc', 2.2, 15, 30, [-Math.PI / 2, 0, 0]);

  s.applyRenderPreset(scene.id, 'moody-cinematic');
  s.updateSceneEnvironment(scene.id, { skyMode: 'procedural', skyLighting: 'sky', skyTopColor: '#030713', skyHorizonColor: '#14263e', skyGroundColor: '#040811',
    backgroundColor: '#050916', ambientMode: 'flat', ambientIntensity: .16, environmentIntensity: .6, toneMapping: 'agx', toneMappingExposure: 1.3,
    sunColor: '#829ebc', sunIntensity: .35, sunAzimuth: 210, sunElevation: 48, sunShadowExtent: 100,
    fogEnabled: true, atmosphericFog: true, fogColor: '#0e1e31', fogNear: 30, fogFar: 185,
    volumetricFogEnabled: true, volumetricFogDensity: .018, volumetricFogColor: '#152b40', volumetricFogHeight: 8, volumetricFogFalloff: .075,
    volumetricScattering: .3, volumetricSunStrength: .12, volumetricLocalStrength: 1.4, volumetricMaxDistance: 145,
    surfaceWetness: .78, puddleCoverage: .82, wetnessFromRain: true, rainIntensity: .42, cloudCoverage: .86, cloudSpeed: .22, wind: [1.4, 0, .45], windTurbulence: .12,
    contactShadows: false, lux: { enabled: true, quality: 'cinematic', mode: 'fixed', position: [0, 4, -4], radius: 65, indirectIntensity: .32, reflections: true, reflectionIntensity: .65, updateInterval: 1.5, smoothing: .3 },
  });
  s.updateRenderSettings({ quality: 'Epic', autoQuality: false, ambientOcclusionEnabled: true, ambientOcclusionIntensity: .9, ambientOcclusionRadius: .65,
    bloomEnabled: true, bloomIntensity: .38, bloomThreshold: .85, bloomRadius: .6, vignetteEnabled: false });
  const id = s.createCinematic('Neon Afterlight · District 09', NEON_AFTERLIGHT_DURATION);
  s.updateCinematic(id, { autoplay: true, skippable: false, frameRate: 24 });
  s.setCinematicLook(id, { letterbox: 2.39, grade: 'custom', gradeIntensity: 1, contrast: .06, saturation: .03, temperature: -.02, grain: .009, vignette: .12, anamorphic: .035, motionBlur: 0 });
  const beat = (action: Omit<CinematicAction, 'id'>) => s.addCinematicAction(id, action);
  const shot = (label: string, start: number, end: number, from: Vector3Tuple, to: Vector3Tuple, target: Vector3Tuple, fov = 52, aperture = 0) => beat({
    type: 'camera', label, time: start, duration: end - start, interpolation: 'linear', keyframes: [from, to].map((position, i) => ({ time: i ? end : start, position, lookAt: target, fov, aperture, focusDistance: Math.hypot(...position.map((v, k) => v - target[k])) })),
  });
  shot('01 / After the rain · puddle-level approach', 0, 8, [-3, .65, 31], [-2.2, 1.15, 23], [-3, 5.4, -8], 57);
  shot('02 / District 09 · street reveal', 8, 16, [2, 4.5, 29], [3.7, 7.4, 20], [0, 15, -42], 59);
  shot('03 / Open all night · warm shop, cold street', 16, 23, [5, 2.4, 17], [6.8, 2.8, 12], [10.4, 4.1, 5], 48, .12);
  shot('04 / The city exhales · steam and neon', 23, 30, [-5.8, 3.1, 16], [-6, 4.1, 11], [-10, 5.4, 8], 48);
  shot('05 / Courier · moving light through mist', 30, 37, [-.5, 5.8, 5], [1.6, 6.3, -2], [0, 6.6, -13], 55);
  shot('06 / Service arc · sparks in the rain', 37, 44, [-3.2, 3.6, -4], [-4.8, 4.3, -7], [-8.7, 4.7, -12], 48);
  shot('07 / Beneath the crossing · water and reflected signs', 44, 52, [2, .8, -24], [3.8, 1.3, -30], [0, 9, -57], 58);
  shot('08 / Cooling the city · falling water and spray', 52, 58, [3.7, 3.1, -31], [4.7, 3.7, -34], [8.8, 3.6, -40], 47);
  shot('09 / A vertical world · crane through the canyon', 58, 64, [-1, 13, 14], [0, 24, 22], [0, 26, -52], 59);
  shot('10 / Neon Afterlight · the street keeps breathing', 64, 70, [1, 8, 31], [2, 10.5, 39], [0, 13, -33], 54);
  beat({ type: 'transform', time: 0, duration: 30, objectId: drone, fromPosition: [-5, 7.8, 8], toPosition: [-2, 7.5, -8], interpolation: 'linear', label: 'Courier / patrol approach' });
  beat({ type: 'transform', time: 30, duration: 14, objectId: drone, fromPosition: [-2, 7.5, -8], toPosition: [3, 7, -32], interpolation: 'linear', label: 'Courier / pass the camera' });
  beat({ type: 'transform', time: 44, duration: 26, objectId: drone, fromPosition: [3, 7, -32], toPosition: [5, 12, -79], interpolation: 'linear', label: 'Courier / disappear into the district' });
  for (const objectId of [sparks, arc]) {
    beat({ type: 'visibility', time: 0, objectId, visible: false });
    beat({ type: 'visibility', time: 38.5, objectId, visible: true });
    beat({ type: 'visibility', time: 43.6, objectId, visible: false });
  }
  beat({ type: 'fade', time: 0, duration: 1.8, fadeFrom: 1, fadeTo: 0, fadeColor: '#02050a' });
  beat({ type: 'text', time: 2.3, duration: 3.2, text: 'A FEATHER ENGINE FILM', textStyle: 'credit', textColor: '#c8e2e9' });
  beat({ type: 'text', time: 9.5, duration: 4.5, text: 'N E O N   A F T E R L I G H T', textStyle: 'title', textColor: '#e0f4f4' });
  beat({ type: 'text', time: 64.5, duration: 3.3, text: 'FEATHER ENGINE', textStyle: 'title', textColor: '#d8f3f3' });
  beat({ type: 'text', time: 65, duration: 3, text: 'Light. Atmosphere. A city after dark.', textStyle: 'credit', textColor: '#9dc6d3' });
  beat({ type: 'fade', time: 68, duration: 2, fadeFrom: 0, fadeTo: 1, fadeColor: '#02050a' });
  beat({ type: 'sound', time: 0, soundId: assets['neon-afterlight-score.wav'], label: 'Original synth score / rain, steam, electrical arc' });
  const director = part('empty', '09 · Director / weather and replay', ZERO);
  const { blueprintId } = s.createBlueprintNamed('Afterlight · Rain and atmosphere direction', 'Editable rain progression and replay; camera, courier and VFX cues live in Film Mode.');
  s.attachScript(director, blueprintId);
  const weather = (time: number, name: string, patch: Partial<SceneEnvironmentSettings>, row: number) => {
    const eventName = `afterlight_${name}`;
    const event = s.addGraphNodeToBlueprint(blueprintId, 'Custom Event', 'Events', { eventName }, { x: 0, y: row * 200 });
    const action = s.addGraphNodeToBlueprint(blueprintId, 'Set Environment', 'Runtime', { envPatch: patch } as Partial<NodeForgeNodeData>, { x: 330, y: row * 200 });
    s.connectGraphNodes(blueprintId, event, action, 'exec-out', 'exec-in'); beat({ type: 'event', time, eventName, label: name });
  };
  weather(16, 'rain_at_the_market', { rainIntensity: .58 }, 0);
  weather(30, 'rain_over_the_crossing', { rainIntensity: .72, wind: [2.1, 0, .8] }, 1);
  weather(44, 'rain_softens', { rainIntensity: .48, wind: [1.2, 0, .4] }, 2);
  weather(58, 'afterlight', { rainIntensity: .26 }, 3);
  const key = s.addGraphNodeToBlueprint(blueprintId, 'Key Down', 'Events', { keyCode: 'KeyR', keyTriggerMode: 'pressed' }, { x: 0, y: 800 });
  const replay = s.addGraphNodeToBlueprint(blueprintId, 'Load Scene', 'Runtime', { restartScene: true }, { x: 330, y: 800 }); s.connectGraphNodes(blueprintId, key, replay, 'exec-out', 'exec-in');
  for (const [time, label] of [[0, 'Reflections'], [8, 'District 09'], [16, 'Market'], [23, 'Steam'], [30, 'Courier'], [38.5, 'Live sparks'], [44, 'Water'], [52, 'Cooling'], [58, 'Skyline'], [70, 'End']] as const) s.addCinematicMarker(id, { time, label, color: CYAN });
  s.setActiveCinematic(id); s.selectObject(director); return id;
}
