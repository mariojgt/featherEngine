import { getPlatform } from '../platform';
import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import { sampleTerrainLocalHeight, terrainEditKey, withTerrainDefaults, defaultStylizedGrass } from '../terrain/terrain';
import type { AssetItem, CinematicAction, NodeForgeNodeData, SceneEnvironmentSettings, SceneObjectKind, Vector3Tuple } from '../types';

export const BLACKTHORN_DURATION = 70;
export const BLACKTHORN_STRIKE = 42;
const FIRE = '#ffb35b';
const ZERO: Vector3Tuple = [0, 0, 0];

/** All art is bundled; every castle module, camera, weather cue and simulated prop is editable. */
export async function createBlackthornTemplate(): Promise<string | undefined> {
  const s = useEditorStore.getState(), scene = s.activeScene();
  if (!scene) return undefined;
  const assets: Record<string, string> = {};
  const folder = s.createFolder('Blackthorn Keep · Complete film assets');
  for (const name of ['spire-tower.glb', 'great-hall.glb', 'curtain-wall.glb', 'gatehouse.glb', 'blackthorn-tree.glb', 'moor-rock-1.glb', 'moor-rock-2.glb', 'moor-rock-3.glb', 'masonry.png', 'masonry-normal.png', 'blackthorn-banner.png', 'blackthorn-score.wav']) {
    const response = await fetch(`templates/blackthorn/${name}`);
    if (!response.ok) throw new Error(`Blackthorn asset missing: ${name}. Run npm run cinematic:blackthorn:assets.`);
    const type = name.endsWith('.glb') ? 'model' : name.endsWith('.wav') ? 'audio' : 'image';
    const file = new File([await response.blob()], name, { type: type === 'model' ? 'model/gltf-binary' : type === 'audio' ? 'audio/wav' : 'image/png' });
    const imported = await (await getPlatform()).importAsset(useProjectStore.getState().projectDir ?? 'web', file);
    const asset: AssetItem = { id: `asset-${crypto.randomUUID()}`, name, type, size: file.size, path: imported.path, url: imported.url, createdAt: Date.now(), folderId: folder };
    s.addAssetItems([asset]); assets[name] = asset.id;
  }
  for (const id of ['obj-player', 'obj-ground', 'obj-enemy', 'obj-light', 'obj-camera']) {
    if (selectActiveObjects(useEditorStore.getState()).some(o => o.id === id)) s.deleteObject(id);
  }
  s.renameScene(scene.id, 'Blackthorn Keep · The storm on the moor');
  const masonry = s.createMaterial('Blackthorn · Wet ashlar', 'Original tiled masonry and relief; storm-darkened stone.');
  s.updateMaterial(masonry, { color: '#89949a', roughness: 0.57, metalness: 0.08, textureAssetId: assets['masonry.png'], normalMapAssetId: assets['masonry-normal.png'] });
  const bannerMaterial = s.createMaterial('Blackthorn · House of thorns', 'Original heraldic textile.');
  s.updateMaterial(bannerMaterial, { color: '#ffffff', roughness: 0.92, textureAssetId: assets['blackthorn-banner.png'] });
  const part = (kind: SceneObjectKind, name: string, position: Vector3Tuple, scale: Vector3Tuple = [1, 1, 1], color = '#50575c', rotation: Vector3Tuple = ZERO) => {
    const id = s.createObjectWithProps(kind, { name, position, color });
    s.updateTransform(id, 'scale', scale); s.updateTransform(id, 'rotation', rotation);
    return id;
  };
  const model = (name: string, file: string, position: Vector3Tuple, scale: Vector3Tuple = [1, 1, 1], rotation: Vector3Tuple = ZERO) => {
    const id = part('cube', name, position, scale, '#ffffff', rotation); s.setObjectModel(id, assets[file]); return id;
  };
  const solid = (id: string) => s.updatePhysics(id, { enabled: true, bodyType: 'fixed', collider: 'box', friction: 0.8 });
  const pathX = (z: number) => Math.sin(z * 0.027) * 6;
  const foliageOverrides: Record<string, number> = {}, paintOverrides: Record<string, string> = {};
  // One authored mask, sampled by the existing foliage system: grass stays off the road and courtyard.
  for (let iz = -60; iz <= 60; iz++) for (let ix = -60; ix <= 60; ix++) {
    const x = ix * 2, z = iz * 2, road = Math.abs(x - pathX(z)) < 3.1 && z > -43;
    const courtyard = Math.abs(x) < 32 && z < -37 && z > -95;
    if (!road && !courtyard) foliageOverrides[terrainEditKey(ix, iz)] = 0.9;
    if (road || courtyard) paintOverrides[terrainEditKey(ix, iz)] = 'moor-mud';
  }
  const field = s.createObjectWithProps('terrain', { name: '01 · Wind-swept moor / painted road and tall grass', position: ZERO });
  s.updateTerrain(field, { size: 256, chunkSize: 24, resolution: 28, streamRadius: 6, physicsRadius: 2, seed: 8041,
    heightScale: 3.8, frequency: 0.011, octaves: 4, persistence: 0.42, ridgeStrength: 0.08, domainWarp: 12,
    editSpacing: 2, foliageOverrides, paintOverrides,
    materialLayers: [{ id: 'moor-turf', name: 'Peat and heather', color: '#354231' }, { id: 'moor-mud', name: 'Storm road', color: '#393c38' }, { id: 'moor-rock', name: 'Slate', color: '#586067' }],
    foliage: { ...withTerrainDefaults({}).foliage, enabled: true, mode: 'grass', grassMesh: 'clump', usePaintMask: true, density: 0.9,
      minScale: 1.05, maxScale: 1.85, grassColor: '#6b7650', flowerDensity: 0, treeDensity: 0, windStrength: 1.35,
      stylizedGrass: { ...defaultStylizedGrass(), gradientTop: '#bbb588', gradientBottom: '#253427', gradientOffset: 0.1,
        gradientContrast: 0.15, colorNoiseLow: '#56614c', colorNoiseHigh: '#abb07b', colorNoiseStrength: 0.3,
        windNoiseScale: 0.16, windSpeed: 1.4, fadeStart: 65, fadeEnd: 115, normalLift: 0.72, perspectiveCorrection: 0.12 } },
  });
  s.sculptTerrainAt(field, [0, 0, -62], { operation: 'flatten', radius: 45, strength: 1, flattenHeight: 4 });
  const ground = (x: number, z: number) => sampleTerrainLocalHeight(withTerrainDefaults(selectActiveObjects(useEditorStore.getState()).find(o => o.id === field)!.terrain), x, z);
  const hills = s.createObjectWithProps('terrain', { name: '02 · Distant highlands', position: [0, -29, -215] });
  s.updateTerrain(hills, { size: 560, chunkSize: 64, resolution: 44, streamRadius: 5, physicsRadius: 0, seed: 190,
    heightScale: 47, frequency: 0.006, octaves: 4, persistence: 0.46, ridgeStrength: 0.55, domainWarp: 65,
    materialLayers: [{ id: 'hill-a', name: 'Cold shale', color: '#28333e' }, { id: 'hill-b', name: 'Highland', color: '#3d4854' }],
    foliage: { ...withTerrainDefaults({}).foliage, enabled: false },
  });
  // Modular fortress: visible arch, copper spires, buttresses and emissive lancets. Modules can be moved,
  // scaled, replaced or opened as normal model assets. Batching lives inside each GLB, not the whole set.
  const castleY = 4;
  model('03 · Blackthorn / great hall', 'great-hall.glb', [0, castleY, -70]);
  model('Blackthorn / gatehouse', 'gatehouse.glb', [0, castleY, -40]);
  for (const [x, z, scale] of [[-12, -42, 0.78], [12, -42, 0.78], [-26, -50, 0.9], [26, -50, 0.9], [-24, -82, 1], [24, -82, 1], [-10, -78, 1.22], [10, -78, 1.12]] as const) {
    model(`Blackthorn / spire ${x},${z}`, 'spire-tower.glb', [x, castleY, z], [scale, scale, scale]);
  }
  for (const x of [-18, 18]) model(`Blackthorn / front curtain ${x}`, 'curtain-wall.glb', [x, castleY, -43]);
  for (const x of [-26, 26]) for (const z of [-59, -76]) model(`Blackthorn / side curtain ${x},${z}`, 'curtain-wall.glb', [x, castleY, z], [1, 1, 1], [0, Math.PI / 2, 0]);
  for (const x of [-9, 9]) model(`Blackthorn / rear curtain ${x}`, 'curtain-wall.glb', [x, castleY, -87]);
  const foundation = part('cube', 'Blackthorn / rock-founded courtyard', [0, 2.5, -65], [55, 3, 50]);
  s.setObjectMaterial(foundation, masonry); solid(foundation);
  // The road climbs into the open gate. Shallow slabs break the silhouette and give rain-lit edges.
  for (let i = 0; i < 18; i++) {
    const z = -37 + i * 5.2, x = pathX(z), y = ground(x, z);
    const slab = part('cube', `Road / worn ashlar ${i + 1}`, [x, y + 0.07, z], [5.7, 0.22, 4.2], '#656b68', [0, Math.cos(z * 0.027) * 0.15, 0]);
    s.setObjectMaterial(slab, masonry); if (z > 15 && z < 45) solid(slab);
  }
  let seed = 2147;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 38; i++) {
    const side = i % 2 ? 1 : -1, x = side * (25 + random() * 67), z = -110 + random() * 210, h = 0.7 + random() * 0.65;
    model(`Moor / blackthorn ${i + 1}`, 'blackthorn-tree.glb', [x, ground(x, z), z], [h, h, h], [0, random() * 6.28, 0]);
  }
  for (let i = 0; i < 62; i++) {
    const x = (random() - 0.5) * 170, z = (random() - 0.5) * 210;
    if (Math.abs(x - pathX(z)) < 7 || (Math.abs(x) < 34 && z < -35)) continue;
    const h = 0.45 + random() * 2.2;
    model(`Moor / slate boulder ${i + 1}`, `moor-rock-${i % 3 + 1}.glb`, [x, ground(x, z) + h * 0.2, z], [h * 1.2, h, h], [0, random() * 6.28, (random() - 0.5) * 0.3]);
  }
  const lamp = (name: string, p: Vector3Tuple, intensity: number, distance: number, shadow = false) => {
    const light = part('light', name, p); s.setObjectLight(light, { type: 'point', color: FIRE, intensity, distance, castShadow: shadow }); return light;
  };
  const torch = (name: string, x: number, z: number, baseY = ground(x, z)) => {
    part('cube', `${name} / iron stem`, [x, baseY + 1.25, z], [0.13, 2.5, 0.13], '#322a26');
    const fire = part('sphere', `${name} / flame heart`, [x, baseY + 2.55, z], [0.24, 0.5, 0.24], FIRE);
    s.updateRenderer(fire, { materialOverrides: { emissiveColor: FIRE, emissiveIntensity: 2.5, roughness: 0.4 } });
    const emitter = part('empty', `${name} / wind-stirred embers`, [x, baseY + 2.5, z]);
    s.addParticles(emitter, 'fire');
    s.updateParticles(emitter, { gpu: true, maxParticles: 160, rate: 40, startSize: 0.24, endSize: 0.02,
      lifetime: 1.3, speed: 0.85, direction: [0.15, 1, 0], startColor: '#ffce85', endColor: '#8e321d', shapeRadius: 0.08, light: false });
    lamp(`${name} / amber pool`, [x, baseY + 2.6, z], 26, 12, z < -30);
  };
  for (const x of [-5.2, 5.2]) torch('Gate brazier', x, -35, castleY);
  for (const [x, z] of [[-7, 17], [7, -13], [-7, 48]] as const) torch('Road fire', x, z);
  lamp('Gate / interior firelight', [0, 8, -42], 70, 20);
  const bannerKey = part('light', 'Moon bounce / readable cloth in the storm', [-10, ground(-7.5, 21) + 7.5, 28]);
  s.setObjectLight(bannerKey, { type: 'rect', color: '#b6c8df', intensity: 3.5, width: 7, height: 5, castShadow: false });
  s.updateTransform(bannerKey, 'rotation', [-0.32, -0.35, 0]);
  for (const [x, z, width, height] of [[-7.5, 21, 2, 4], [9, -15, 2, 4.5], [-9, -38, 2.4, 5], [9, -38, 2.4, 5]] as const) {
    const y = ground(x, z), pole = part('cube', `Banner / pole ${x},${z}`, [x, y + 4.1, z], [0.12, 8.2, 0.12], '#443c36'); solid(pole);
    part('cube', 'Banner / crossbar', [x + width * 0.5, y + 7.5, z], [width + 0.3, 0.08, 0.08], '#443c36');
    const flag = part('plane', `Banner / House of thorns ${x},${z}`, [x + width * 0.5, y + 7.45 - height * 0.5, z]);
    s.setObjectMaterial(flag, bannerMaterial); s.addCloth(flag);
    s.updateCloth(flag, { enabled: true, width, height, resolution: 16, pinMode: 'top-edge', wind: [0, 0, 0], turbulence: 0.35, damping: 0.035, stiffness: 7, collideFloor: false, collideBodies: false });
  }
  // Shallow rain pools mirror the cold sky; the volume's box stays hidden behind its water renderer.
  for (const [x, z, w, d] of [[-4.6, 35, 5, 3], [5.4, 52, 7, 4], [-6, -5, 6, 4]] as const) {
    const water = part('cube', 'Moor / rain pool', [x, ground(x, z) - 0.08, z], [w, 0.15, d], '#243641');
    s.updateRenderer(water, { hideInPlay: true });
    s.updateWater(water, { enabled: true, style: 'custom', shallowColor: '#405561', deepColor: '#16242a', opacity: 0.82,
      reflectivity: 0.8, foam: 0, waveAmplitude: 0.025, waveFrequency: 1.2, waveSpeed: 1.1, flowStrength: 0.08, sparkle: 0.12, caustics: 0 });
  }
  const wardGround = ground(9, 26), WARD: Vector3Tuple = [9, wardGround + 3.2, 26];
  const wardKey = part('light', 'Moon bounce / tumbling stone edges', [15, wardGround + 7, 35]);
  s.setObjectLight(wardKey, { type: 'rect', color: '#a3bedb', intensity: 4.5, width: 9, height: 6, castShadow: false });
  s.updateTransform(wardKey, 'rotation', [-0.38, 0.55, 0]);
  const ward = part('cube', '04 · Storm ward / lightning fractures this stone', WARD, [2, 5.7, 1.3], '#59616c', [0.02, -0.2, 0.03]);
  s.setObjectMaterial(ward, masonry); solid(ward);
  s.setObjectFracture(ward, { enabled: true, pattern: 'shatter', pieces: 4, seed: 83, strength: 7, angularSpeed: 3.1, jitter: 0.62, focusImpact: false, impactThreshold: 0, debrisLifetime: 30, inheritVelocity: true });
  const rune = part('cube', 'Ward / ember inscription', [8.86, WARD[1], 26.68], [0.06, 3.8, 0.045], '#f6b45e');
  s.updateRenderer(rune, { materialOverrides: { emissiveColor: '#f6b45e', emissiveIntensity: 1.3 } });
  const wardBase = part('cube', 'Ward / footing and collision', [9, wardGround + 0.15, 26], [5, 0.6, 5]); s.setObjectMaterial(wardBase, masonry); solid(wardBase);
  // A sparse, branching bolt is actual emissive geometry; the weather envelope illuminates its surroundings.
  const boltPieces: string[] = [];
  const boltPoints: Vector3Tuple[] = [[9, WARD[1], 26], [11, 12, 27], [8, 18, 25], [15, 27, 27], [12, 34, 25], [18, 45, 23], [14, 57, 21]];
  for (let i = 0; i < boltPoints.length - 1; i++) {
    const a = boltPoints[i], b = boltPoints[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const segment = part('cube', 'Lightning / emissive channel', a.map((v, k) => (v + b[k]) / 2) as Vector3Tuple, [0.09, Math.hypot(dx, dy, dz), 0.09], '#cde9ff', [Math.atan2(dz, dy), 0, -Math.atan2(dx, dy)]);
    s.updateRenderer(segment, { materialOverrides: { emissiveColor: '#b9dcff', emissiveIntensity: 8 } }); boltPieces.push(segment);
  }
  // Wind affects these loose props through Rapier. They also bend nearby grass through the interactor bus.
  for (let i = 0; i < 5; i++) {
    const x = -9 + i * 0.65, z = 27 + i * 0.7;
    const debris = part('cube', `05 · Windborne timber ${i + 1}`, [x, ground(x, z) + 0.4, z], [1.8, 0.18, 0.32], '#534331', [0, i * 0.5, 0]);
    s.updatePhysics(debris, { enabled: true, bodyType: 'dynamic', collider: 'box', mass: 0.8, friction: 0.45, restitution: 0.1, windInfluence: 0.22 });
  }

  s.applyRenderPreset(scene.id, 'moody-cinematic');
  s.updateSceneEnvironment(scene.id, { skyMode: 'procedural', backgroundColor: '#101b28', skyTopColor: '#223752', skyHorizonColor: '#77899e', skyGroundColor: '#172128',
    ambientMode: 'flat', ambientIntensity: 0.16, environmentIntensity: 1.15, toneMapping: 'agx', toneMappingExposure: 1.2,
    skyLighting: 'sky', surfaceWetness: 0.3, puddleCoverage: 0.78, wetnessFromRain: true,
    sunColor: '#a6c9f2', sunIntensity: 1.5, sunAzimuth: 215, sunElevation: 24, sunShadowExtent: 110,
    fogEnabled: true, atmosphericFog: true, fogColor: '#354553', fogNear: 70, fogFar: 350,
    volumetricFogEnabled: true, volumetricFogDensity: 0.009, volumetricFogColor: '#62768d', volumetricFogHeight: -1,
    volumetricFogFalloff: 0.13, volumetricScattering: 0.35, volumetricSunStrength: 0.55, volumetricMaxDistance: 220,
    wind: [2.5, 0, 1], windTurbulence: 0.35, cloudCoverage: 0.66, cloudSpeed: 0.5, rainIntensity: 0.05, lightningFlash: 0,
    contactShadows: false, lux: { enabled: true, quality: 'balanced', mode: 'fixed', position: [0, 8, -32], radius: 42, indirectIntensity: 0.3, reflections: true, reflectionIntensity: 0.45, updateInterval: 2 },
  });
  s.updateRenderSettings({ quality: 'High', autoQuality: false, ambientOcclusionEnabled:true, ambientOcclusionIntensity:0.8, ambientOcclusionRadius:0.45, bloomEnabled: true, bloomIntensity: 0.32, bloomThreshold: 0.92, bloomRadius: 0.65, vignetteEnabled: false });
  const id = s.createCinematic('Blackthorn Keep · The storm on the moor', BLACKTHORN_DURATION);
  s.updateCinematic(id, { autoplay: true, skippable: false, frameRate: 24 });
  s.setCinematicLook(id, { letterbox: 2.39, grade: 'custom', gradeIntensity: 1, contrast: 0.1, saturation: -0.08, temperature: -0.04, grain: 0.012, vignette: 0.15, anamorphic: 0.015, motionBlur: 0 });
  const beat = (action: Omit<CinematicAction, 'id'>) => s.addCinematicAction(id, action);
  const pos = (x: number, y: number, z: number): Vector3Tuple => [x, ground(x, z) + y, z];
  const shot = (label: string, start: number, end: number, from: Vector3Tuple, to: Vector3Tuple, target: Vector3Tuple, fov = 48, aperture = 0) => beat({
    type: 'camera', label, time: start, duration: end - start, interpolation: 'linear', keyframes: [from, to].map((position, i) => ({ time: i ? end : start, position, lookAt: target, fov, aperture, focusDistance: Math.hypot(...position.map((v, k) => v - target[k])) })),
  });
  shot('01 / The field holds its breath · grass-level drift', 0, 8, pos(-15, 1.7, 64), pos(-10, 2.5, 52), [0, 18, -60], 48);
  shot('02 / Blackthorn Keep · rising reveal', 8, 16, [23, 10, 60], [29, 19, 42], [0, 19, -63], 47);
  shot('03 / The rain arrives · wet road and fire', 16, 23, pos(-3.5, 1.8, 41), pos(-2.5, 2.1, 34), [1, ground(1, 15) + 0.2, 15], 54, 0.15);
  shot('04 / Stormfront · fortress under the clouds', 23, 30, [-41, 19, 14], [-31, 23, 3], [0, 22, -61], 54);
  shot('05 / House of thorns · cloth in the gust', 30, 37, pos(-12, 7, 28), pos(-11, 7.5, 24), [-6.4, ground(-7.5, 21) + 5.8, 21], 48);
  shot('06 / The ward · before the strike', 37, 42, pos(15, 3.3, 36), pos(13, 4, 33), WARD, 44);
  shot('07 / Thunder breaks the ward · live slow-motion physics', 42, 48, pos(15, 4, 35), pos(18, 5.5, 38), WARD, 58);
  shot('08 / A fire behind the gate · architecture and warm light', 48, 56, [-7, 8, -22], [-3, 9.5, -28], [0, 11, -42], 50);
  shot('09 / The crown above the storm · aerial orbit', 56, 64, [43, 31, -12], [35, 38, -30], [0, 23, -65], 52);
  shot('10 / Blackthorn Keep · the living world', 64, 70, [34, 20, 41], [42, 26, 56], [0, 21, -60], 47);
  beat({ type: 'fade', time: 0, duration: 1.8, fadeFrom: 1, fadeTo: 0, fadeColor: '#02060b', label: 'From darkness' });
  beat({ type: 'text', time: 2, duration: 3.8, text: 'A FEATHER ENGINE FILM', textStyle: 'credit', textColor: '#d6dce0' });
  beat({ type: 'text', time: 9.5, duration: 4.7, text: 'B L A C K T H O R N   K E E P', textStyle: 'title', textColor: '#e3e0d6' });
  beat({ type: 'text', time: 64, duration: 4.3, text: 'FEATHER ENGINE', textStyle: 'title', textColor: '#e3e0d6' });
  beat({ type: 'text', time: 64.8, duration: 3.5, text: 'A world shaped by light, wind and rain.', textStyle: 'credit', textColor: '#cdd6dc' });
  beat({ type: 'fade', time: 68, duration: 2, fadeFrom: 0, fadeTo: 1, fadeColor: '#02060b', label: 'Into darkness' });
  beat({ type: 'sound', time: 0, soundId: assets['blackthorn-score.wav'], label: 'Original score / wind, rain and thunder · 70 s' });
  for (const bolt of boltPieces) {
    beat({ type: 'visibility', time: 0, objectId: bolt, visible: false });
    beat({ type: 'visibility', time: BLACKTHORN_STRIKE, objectId: bolt, visible: true });
    beat({ type: 'visibility', time: BLACKTHORN_STRIKE + 0.22, objectId: bolt, visible: false });
  }
  beat({ type: 'visibility', time: BLACKTHORN_STRIKE, objectId: rune, visible: false });
  beat({ type: 'timeDilation', time: 42, duration: 6, timeScale: 4, label: 'Camera and score stay on time during slow physics' });
  beat({ type: 'timeDilation', time: 48, timeScale: 1, label: 'Normal speed' });
  const director = part('empty', '06 · Director / storm, lightning, fracture and replay', ZERO);
  const { blueprintId } = s.createBlueprintNamed('Blackthorn · Weather and physics direction', 'Authored storm progression, lightning envelopes, live Rapier fracture and replay.'); s.attachScript(director, blueprintId);
  let row = 0;
  const cue = (time: number, name: string, actions: Array<[string, NodeForgeNodeData['category'], Partial<NodeForgeNodeData>]>) => {
    const eventName = `blackthorn_${name}`;
    let previous = s.addGraphNodeToBlueprint(blueprintId, 'Custom Event', 'Events', { eventName }, { x: 0, y: row * 200 });
    actions.forEach(([label, category, data], i) => {
      const node = s.addGraphNodeToBlueprint(blueprintId, label, category, data, { x: (i + 1) * 330, y: row * 200 });
      s.connectGraphNodes(blueprintId, previous, node, 'exec-out', 'exec-in'); previous = node;
    }); row++;
    beat({ type: 'event', time, eventName, label: name.replace(/_/g, ' ') });
  };
  const weather = (time: number, name: string, patch: Partial<SceneEnvironmentSettings>) => cue(time, name, [['Set Environment', 'Runtime', { envPatch: patch }]]);
  for (let i = 0; i <= 8; i++) {
    const amount = i / 8;
    weather(16 + i * 2, `storm_build_${i}`, { cloudCoverage: 0.66 + amount * 0.23, rainIntensity: 0.08 + amount * 0.74, wind: [2.5 + amount * 9, 0, 1 + amount * 3], sunIntensity: 1.5 - amount * 0.6 });
  }
  for (const time of [26.2, 39.1, 42]) {
    weather(time, `lightning_${time}_peak`, { lightningFlash: 1 });
    weather(time + 0.12, `lightning_${time}_tail`, { lightningFlash: 0.22 });
    weather(time + 0.3, `lightning_${time}_end`, { lightningFlash: 0 });
  }
  cue(42, 'ward_breaks', [['Fracture', 'Physics', { targetObjectId: ward }], ['Set Time Scale', 'Runtime', { numberValue: 0.25 }]]);
  cue(48, 'after_thunder', [['Set Time Scale', 'Runtime', { numberValue: 1 }], ['Set Environment', 'Runtime', { envPatch: { rainIntensity: 0.55, wind: [7, 0, 2.5] } }]]);
  weather(58, 'moon_break', { cloudCoverage: 0.7, rainIntensity: 0.28, sunIntensity: 1.65, wind: [4, 0, 1.5] });
  const key = s.addGraphNodeToBlueprint(blueprintId, 'Key Down', 'Events', { keyCode: 'KeyR', keyTriggerMode: 'pressed' }, { x: 0, y: row * 200 });
  const restart = s.addGraphNodeToBlueprint(blueprintId, 'Load Scene', 'Runtime', { restartScene: true }, { x: 330, y: row * 200 }); s.connectGraphNodes(blueprintId, key, restart, 'exec-out', 'exec-in');
  for (const [time, label] of [[0, 'The field'], [8, 'The keep'], [16, 'Rain'], [26.2, 'Distant lightning'], [30, 'Wind and cloth'], [42, 'Live fracture'], [48, 'Gatefire'], [58, 'Moonbreak'], [70, 'End']] as const) s.addCinematicMarker(id, { time, label, color: time === 42 ? '#ffae6a' : '#9cbfe0', determinismFence: time === 42 || time === 48 });
  s.setActiveCinematic(id); s.selectObject(director); return id;
}
