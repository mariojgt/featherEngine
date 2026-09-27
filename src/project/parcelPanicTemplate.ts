import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import type { AssetItem, MaterialDefinition, SceneObjectKind, Vector3Tuple } from '../types';
import { graphToFeatherScript } from '../scripting/featherScript';
import { addParcelPanicCourier } from './parcelPanicCourier';
import { normalizeVillageSeed, villageHouse, villagePoint, villageTreeZone, villagePropZone, villageSample, VILLAGE_HOUSE_SOURCE, VILLAGE_SCATTER_SOURCE, type VillageZone } from './parcelPanicVillage';
import { addParcelPanicUI } from '../creator/parcelPanicUI';

export const PARCEL_PANIC_INTRO_SECONDS = 9;
export const PARCEL_PANIC_AUDIO = ['parcel-panic-theme.wav', 'pickup.wav', 'throw.wav', 'delivery.wav', 'finish.wav'] as const;

async function loadAudio(name: string): Promise<AssetItem> {
  const response = await fetch(`templates/parcel-panic/${name}`);
  if (!response.ok) throw new Error(`Parcel Panic could not load ${name}.`);
  const blob = await response.blob();
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(new Blob([blob], { type: 'audio/wav' }));
  });
  return { id: `parcel-panic-${name}`, name, type: 'audio', size: blob.size, data, createdAt: 0 };
}

/** Editable primitives, ordinary FeatherScript graphs, a Film Mode intro and portable embedded audio. */
export async function createParcelPanicTemplate(options: { seed?: number } = {}): Promise<string> {
  const s = useEditorStore.getState();
  const sceneId = s.activeSceneId;
  const villageSeed = normalizeVillageSeed(options.seed ?? Math.floor(Math.random() * 999982));
  // Do all fallible asset work before changing a scene. Packages embed these bytes for offline use.
  const audio = await Promise.all(PARCEL_PANIC_AUDIO.map(loadAudio));
  if (useEditorStore.getState().activeSceneId !== sceneId) throw new Error('The active scene changed while Parcel Panic was loading.');
  for (const id of ['obj-player', 'obj-ground', 'obj-enemy', 'obj-light', 'obj-camera']) {
    if (selectActiveObjects(useEditorStore.getState()).some(o => o.id === id)) s.deleteObject(id);
  }
  s.renameScene(sceneId, 'Parcel Panic · Postcard Island');
  s.applyRenderPreset(sceneId, 'vibrant-arcade');
  s.updateSceneEnvironment(sceneId, {
    skyMode: 'procedural', backgroundColor: '#97DDE7', skyTopColor: '#73CFE4', skyHorizonColor: '#DEF4DA',
    skyGroundColor: '#80CAD0', environmentIntensity: 0.9, ambientMode: 'hemisphere', ambientIntensity: 0.65,
    sunColor: '#FFF0CF', sunIntensity: 2, sunAzimuth: 220, sunElevation: 45,
    fogEnabled: true, fogColor: '#C4EBDC', fogNear: 55, fogFar: 140, atmosphericFog: true,
    toneMapping: 'agx', toneMappingExposure: 1.03, contactShadows: true, contactShadowY: 0,
    contactShadowScale: 42, contactShadowOpacity: 0.25, contactShadowBlur: 3, contactShadowFar: 8,
    gravity: [0, -9.81, 0], wind: [0.8, 0, 0.3], windTurbulence: 0.2,
  });
  s.updateRenderSettings({ quality: 'High', autoQuality: true, bloomEnabled: true, bloomIntensity: 0.22, bloomThreshold: 1, vignetteEnabled: false });
  const artFolder = s.createFolder('Parcel Panic · Materials');
  const logicFolder = s.createFolder('Parcel Panic · Gameplay');
  const prefabFolder = s.createFolder('Parcel Panic · Reusable pieces');
  const audioFolder = s.createFolder('Parcel Panic · Original audio');
  s.addAssetItems(audio.map(a => ({ ...a, folderId: audioFolder })));
  s.setSceneAudio(sceneId, { musicSoundId: audio[0].id });
  const sound = (index: number) => `Audio.play("${audio[index].id}")`;
  const mat = (name: string, color: string, patch: Partial<MaterialDefinition> = {}) => {
    const id = s.createMaterial(name, 'Editable toy-town material.', artFolder);
    s.updateMaterial(id, { color, metalness: 0, roughness: 0.65, toon: true, toonBands: 3, toonFinish: 'pearl', toonRimStrength: 0.12, ...patch });
    return id;
  };
  const m = {
    cream: mat('Warm porcelain', '#FFF1CF'), mint: mat('Courier mint', '#4AD9BE'), ink: mat('Midnight rubber', '#193F4B'),
    coral: mat('01 · Coral Post', '#F77F7F'), blue: mat('02 · Bluebell Post', '#78A4EC'), gold: mat('03 · Honey Post', '#F7C65A'),
    grass: mat('Pistachio turf', '#99C879'), leaf: mat('Leaf green', '#508B67'), sand: mat('Biscuit paths', '#E5CD9E'),
    rock: mat('Terracotta island edge', '#B38469'), sea: mat('Lagoon blue', '#73C4CA'), wood: mat('Parcel cardboard', '#DFAE7E'),
    foam: mat('Sea-foam porcelain', '#EAF7DF'), glass: mat('Window blue', '#326C7A', { roughness: 0.34 }),
    shade: mat('Deep lagoon shade', '#4E9FAA'), blush: mat('Shell pink', '#EFA39A'),
  };
  type Options = { parent?: string; rotation?: Vector3Tuple; body?: 'fixed' | 'dynamic' | 'kinematic'; trigger?: boolean };
  const part = (name: string, position: Vector3Tuple, scale: Vector3Tuple, materialId: string, kind: SceneObjectKind = 'cube', opts: Options = {}) => {
    const id = s.createObjectWithProps(kind, { name, position, parentId: opts.parent,
      ...(opts.body ? { physics: { enabled: true, bodyType: opts.body, collider: kind === 'sphere' ? 'sphere' : 'box', isTrigger: opts.trigger ?? false, friction: 0.7, restitution: 0.18 } } : {}) });
    s.updateTransform(id, 'scale', scale);
    if (opts.rotation) s.updateTransform(id, 'rotation', opts.rotation);
    if (kind !== 'empty') s.setObjectMaterial(id, materialId);
    return id;
  };
  const root = (name: string, position: Vector3Tuple = [0, 0, 0], parent?: string) => part(name, position, [1, 1, 1], m.cream, 'empty', { parent });
  const compile = (name: string, description: string, source: string) => {
    const { blueprintId } = s.createBlueprintNamed(name, description, logicFolder);
    const result = s.applyBlueprintFeatherSource(blueprintId, source.trim());
    if (!result.ok || result.diagnostics.length) throw new Error(`${name}: ${result.diagnostics.map(d => d.message).join('; ')}`);
    return blueprintId;
  };
  const globals: Array<[string, 'number' | 'boolean' | 'string', number | boolean | string]> = [
    ['PPSeed', villageSeed], ['PPVillage', 1], ['PPPickupPulse', 0], ['PPThrowPulse', 0], ['PPCarryWeight', 0],
    ['PPIntro', true], ['PPPlaying', false], ['PPPaused', false], ['PPDone', false], ['PPTimed', false],
    ['PPSeconds', 0], ['PPTimeLeft', 90], ['PPScore', 0], ['PPDelivered', 0], ['PPCarry', ''], ['PPToast', ''], ['PPToastTime', 0],
  ].map(([name, value]) => [name as string, typeof value as 'number' | 'boolean' | 'string', value as number | boolean | string]);
  for (const [name, type, value] of globals) {
    const id = s.createVariable(name, type, false); s.updateVariable(id, { defaultValue: value });
  }

  const scatterBlueprint = compile('Village · Seeded prop placement', 'Deterministic placement inside safe bays. Change PPSeed to remix; never obstruct the delivery approaches.', VILLAGE_SCATTER_SOURCE);
  const houseBlueprint = compile('Village · Houses and routes', 'A seeded permutation of three spacious lots. The basket, sign, confetti and path move with each house.', VILLAGE_HOUSE_SOURCE);
  const scatter = (id: string, key: number, zone: VillageZone, y = 0, scale: Vector3Tuple = [1, 1, 1], size: [number, number] = [1, 1], loose = false) => {
    const home = villagePoint(villageSeed, key, zone, y);
    const factor = size[0] + villageSample(villageSeed, key + 2) * (size[1] - size[0]);
    s.attachScript(id, scatterBlueprint);
    for (const [name, value] of Object.entries({ tags: 'parcel-panic-generated', scatter_key: key, min_x: zone.x[0], max_x: zone.x[1], min_z: zone.z[0], max_z: zone.z[1], home_y: y, base_scale: scale, scale_min: size[0], scale_max: size[1], home, loose })) s.setObjectVariable(id, name, value);
    s.updateTransform(id, 'position', home);
    s.updateTransform(id, 'scale', scale.map(v => v * factor) as Vector3Tuple);
    s.updateTransform(id, 'rotation', [0, villageSample(villageSeed, key + 3) * Math.PI * 2, 0]);
  };

  const world = root('Parcel Panic · World');
  const scenery = root('01 · Island and scenery', [0, 0, 0], world);
  const town = root('02 · Houses and delivery baskets', [0, 0, 0], world);
  const depot = root('03 · Parcel depot', [0, 0, 0], world);
  const play = root('04 · Playful obstacles', [0, 0, 0], world);
  // A simple, dependable collider sits under a more articulated toy-island silhouette.
  part('Island · walkable turf', [0, -0.4, 5], [30, 0.8, 30], m.grass, 'cube', { parent: scenery, body: 'fixed' });
  part('Island · biscuit shoreline', [0, -0.9, 5], [31.5, 0.55, 31.5], m.sand, 'cube', { parent: scenery });
  part('Island · terracotta foundation', [0, -1.58, 5], [30.5, 1.1, 30.5], m.rock, 'cube', { parent: scenery });
  part('Lagoon · calm water', [0, -2.5, 5], [180, 0.2, 180], m.sea, 'cube', { parent: scenery });
  // Low rounded shelves and foam knots break up the rectangular primitive edge without adding
  // misleading playable ground beyond the physical island.
  const coast = [
    [-13.8, -5.8, 2.8, 1.7], [-14, -1.8, 2.3, 1.5], [-14, 4, 2.2, 1.7], [-14, 10.5, 2.4, 1.8], [-13.6, 17.1, 3, 1.8],
    [13.8, -5.8, 2.8, 1.7], [14, -1.8, 2.3, 1.5], [14, 4, 2.2, 1.7], [14, 10.5, 2.4, 1.8], [13.6, 17.1, 3, 1.8],
    [-9.5, -8.4, 2.8, 1.5], [-3.5, -8.7, 2.5, 1.4], [3.8, -8.6, 2.8, 1.4], [10, -8.3, 2.7, 1.6],
    [-9, 18.8, 3, 1.5], [-3, 19.1, 2.6, 1.4], [3.4, 19.1, 2.8, 1.4], [9.4, 18.8, 3, 1.5],
  ] as const;
  coast.forEach(([x, z, sx, sz], index) => {
    part(`Coast · rounded grass shelf ${index + 1}`, [x, -0.34, z], [sx, 0.38, sz], index % 4 === 0 ? m.leaf : m.grass, 'sphere', { parent: scenery });
    if (index % 2 === 0) part(`Coast · foam curl ${index / 2 + 1}`, [x * 1.035, -1.74, z + (index < 10 ? 0.25 : z < 0 ? -0.2 : 0.2)], [sx * 0.62, 0.1, 0.24], m.foam, 'sphere', { parent: scenery, rotation: [0, index * 0.31, 0] });
  });
  for (const [index, x, z, scale] of [[1, -14.4, -6.8, 0.7], [2, -13.7, 18.2, 0.9], [3, 14.1, 16.8, 0.65], [4, 13.8, -4.7, 0.8]] as const) {
    part(`Coast · tide-smoothed rock ${index}`, [x, -0.55, z], [scale, scale * 0.7, scale * 1.25], index % 2 ? m.rock : m.sand, 'sphere', { parent: scenery, rotation: [0.15, index * 0.7, 0.18] });
  }
  part('Village · postal plaza', [0, 0.026, 0.4], [12.5, 0.045, 7.4], m.sand, 'cube', { parent: scenery });
  part('Village · plaza mint inset', [3.9, 0.058, 0.5], [2.8, 0.018, 2.8], m.mint, 'cube', { parent: scenery, rotation: [0, 0.12, 0] });
  part('Main lane · biscuit spine', [0, 0.025, 6], [3.6, 0.04, 26], m.sand, 'cube', { parent: scenery });
  // House-specific paths below are regenerated with their destination, leaving the centre lane open.
  for (let i = 0; i < 10; i++) {
    const z = 0.2 + i * 1.85;
    part(`Lane · postage-stamp marker ${i + 1}`, [0, 0.065, z], [0.22, 0.02, 0.62], i % 3 === 0 ? m.gold : m.cream, 'cube', { parent: scenery, rotation: [0, i % 2 ? 0.04 : -0.04, 0] });
  }

  const label = (name: string, position: Vector3Tuple, title: string, color: string) => {
    const doc = s.createUIDocument(`${name} · Sign`, 'world');
    const document = useEditorStore.getState().uiDocuments.find(d => d.id === doc)!;
    s.updateUIElement(doc, document.root.id, { style: { background: '#FFF4DC', padding: '8px 12px', borderRadius: '12px', width: '180px', textAlign: 'center' } });
    s.setUIBinding(doc, document.root.id, 'visible', '!PPIntro && !PPPaused && !PPDone');
    const text = s.addUIElement(doc, document.root.id, 'text');
    s.updateUIElement(doc, text, { name, text: title, style: { fontSize: '18px', fontWeight: '900', color, whiteSpace: 'pre', textAlign: 'center' } });
    const anchor = root(`${name} · Sign anchor`, position, town);
    s.attachUI(anchor, doc);
    s.updateUIComponent(anchor, { scale: 0.55, offset: [0, 0, 0], billboard: true });
    return anchor;
  };
  const destinations = [
    { name: 'Coral', number: '01', x: -10, z: 10, basket: [-8, 1, 6.6] as Vector3Tuple, material: m.coral, color: '#AD454E' },
    { name: 'Bluebell', number: '02', x: 10, z: 12, basket: [8, 1, 8.5] as Vector3Tuple, material: m.blue, color: '#3E639F' },
    { name: 'Honey', number: '03', x: 0, z: 18, basket: [0, 1, 14] as Vector3Tuple, material: m.gold, color: '#8A671C' },
  ];
  const baskets: string[] = [];
  const bursts: string[] = [];
  for (const [identity, d] of destinations.entries()) {
    const home = villageHouse(villageSeed, identity);
    d.x = home[0]; d.z = home[2]; d.basket = [d.x, 1, d.z - 3.6];
    const house = root(`${d.number} · ${d.name} House`, [d.x, 0, d.z], town);
    part('House · walls', [0, 1.45, 0], [4.5, 2.9, 4], m.cream, 'cube', { parent: house, body: 'fixed' });
    part('House · coloured plinth', [0, 0.25, 0], [4.7, 0.5, 4.2], d.material, 'cube', { parent: house });
    for (const side of [-1, 1]) {
      part('House · sloped roof', [side * 1.18, 3.55, 0], [2.85, 0.32, 4.75], d.material, 'cube', { parent: house, rotation: [0, 0, -side * 0.48] });
      part('House · painted roof fascia', [side * 2.26, 3.2, -0.05], [0.18, 0.24, 4.95], m.cream, 'cube', { parent: house, rotation: [0, 0, -side * 0.48] });
      part('House · window frame', [side * 1.35, 1.7, -2.06], [0.92, 1.12, 0.12], d.material, 'cube', { parent: house });
      part('House · window glass', [side * 1.35, 1.7, -2.14], [0.63, 0.8, 0.06], m.glass, 'cube', { parent: house });
      part('House · window cross', [side * 1.35, 1.7, -2.18], [0.08, 0.85, 0.03], m.cream, 'cube', { parent: house });
      part('House · window sill', [side * 1.35, 1.08, -2.2], [1.08, 0.14, 0.28], m.cream, 'cube', { parent: house });
      part('House · shutter', [side * 0.77, 1.7, -2.19], [0.2, 1.08, 0.08], d.material, 'cube', { parent: house, rotation: [0, side * 0.12, 0] });
    }
    part('House · porcelain roof ridge', [0, 4.08, 0], [0.18, 4.9, 0.18], m.cream, 'capsule', { parent: house, rotation: [Math.PI / 2, 0, 0] });
    part('House · front gable face', [0, 3.05, -2.03], [1.55, 0.72, 0.16], m.cream, 'sphere', { parent: house });
    part('House · round attic window', [0, 3.07, -2.17], [0.5, 0.5, 0.08], m.glass, 'sphere', { parent: house });
    part('House · attic window rim', [0, 3.07, -2.22], [0.12, 0.12, 0.035], d.material, 'sphere', { parent: house });
    part('House · front door', [0, 0.94, -2.07], [0.9, 1.85, 0.13], d.material, 'cube', { parent: house });
    part('House · door inset', [0, 1.38, -2.17], [0.52, 0.5, 0.05], m.cream, 'cube', { parent: house });
    part('House · number plaque', [-0.5, 2.28, -2.17], [0.56, 0.38, 0.08], m.ink, 'cube', { parent: house });
    for (let dot = 0; dot <= identity; dot++) part('House · address dot', [-0.68 + dot * 0.18, 2.28, -2.27], [0.09, 0.09, 0.035], d.material, 'sphere', { parent: house });
    part('House · brass handle', [0.26, 0.96, -2.18], [0.13, 0.13, 0.1], m.gold, 'sphere', { parent: house });
    part('House · chimney', [1.2, 4, 0.7], [0.65, 1.1, 0.65], m.cream, 'cube', { parent: house });
    part('House · chimney cap', [1.2, 4.58, 0.7], [0.85, 0.18, 0.85], d.material, 'cube', { parent: house });
    part('House · porch canopy', [0, 2.28, -2.35], [1.55, 0.18, 0.72], identity === 1 ? m.cream : d.material, 'cube', { parent: house, rotation: [-0.09, 0, 0] });
    for (const side of [-1, 1]) part('House · canopy bracket', [side * 0.58, 2.02, -2.18], [0.09, 0.48, 0.1], m.wood, 'cube', { parent: house, rotation: [0, 0, side * 0.35] });
    // Solid porches and garden edges add readable physical boundaries without closing the front approach.
    part('House · porch step', [0, 0.12, -2.35], [1.7, 0.24, 0.6], d.material, 'cube', { parent: house, body: 'fixed' });
    for (let step = 0; step < 3; step++) part('Garden · front stepping stone', [0, 0.04, -2.8 - step * 0.38], [0.72 - step * 0.08, 0.08, 0.28], step === 1 ? m.cream : m.sand, 'sphere', { parent: house });
    for (const side of [-1, 1]) {
      part('Garden · curved bed', [side * 1.62, 0.055, -2.5], [1.45, 0.1, 1.1], m.sand, 'sphere', { parent: house });
      part('Garden · planter', [side * 1.65, 0.3, -2.45], [0.7, 0.6, 0.65], m.rock, 'cube', { parent: house, body: 'fixed' });
      part('Garden · flowering shrub', [side * 1.65, 0.78, -2.45], [0.8, 0.65, 0.75], m.leaf, 'sphere', { parent: house });
      part('Garden · shrub highlight', [side * 1.48, 0.93, -2.61], [0.38, 0.34, 0.36], m.grass, 'sphere', { parent: house });
      part('Garden · blossom', [side * 1.65, 1.05, -2.57], [0.34, 0.25, 0.34], d.material, 'sphere', { parent: house });
    }
    if (identity === 0) {
      part('Coral House · scalloped flower box', [1.35, 1.03, -2.3], [1.08, 0.2, 0.28], m.coral, 'cube', { parent: house });
      for (const x of [0.98, 1.34, 1.7]) part('Coral House · window bloom', [x, 1.23, -2.38], [0.22, 0.18, 0.2], m.blush, 'sphere', { parent: house });
    } else if (identity === 1) {
      part('Bluebell House · side bay window', [2.28, 1.5, 0.45], [0.32, 1.4, 1.5], m.blue, 'cube', { parent: house });
      part('Bluebell House · bay glass', [2.46, 1.52, 0.45], [0.08, 0.92, 1.05], m.glass, 'cube', { parent: house });
    } else {
      part('Honey House · sun crest', [0, 2.76, -2.3], [0.42, 0.42, 0.08], m.gold, 'sphere', { parent: house });
      for (const x of [-0.58, 0.58]) part('Honey House · porch lantern', [x, 1.76, -2.25], [0.18, 0.3, 0.18], m.gold, 'capsule', { parent: house });
    }
    s.createPrefabFromObject(house, `${d.name} · Modular house`, prefabFolder);
    const basket = root(`${d.number} · ${d.name} Delivery Basket`, d.basket, town);
    baskets.push(basket);
    part('Basket · base', [0, -0.62, 0], [1.9, 0.2, 1.9], d.material, 'cube', { parent: basket, body: 'fixed' });
    for (const side of [-1, 1]) {
      part('Basket · side rail', [side * 0.9, -0.2, 0], [0.16, 0.65, 1.95], d.material, 'cube', { parent: basket, body: 'fixed' });
      part('Basket · end rail', [0, -0.2, side * 0.9], [1.95, 0.65, 0.16], d.material, 'cube', { parent: basket, body: 'fixed' });
      part('Basket · woven side', [side * 0.91, -0.24, 0], [0.08, 0.12, 1.62], m.cream, 'cube', { parent: basket });
      part('Basket · woven end', [0, -0.24, side * 0.91], [1.62, 0.12, 0.08], m.cream, 'cube', { parent: basket });
    }
    for (const x of [-0.68, 0.68]) for (const z of [-0.68, 0.68]) part('Basket · rounded corner', [x, -0.1, z], [0.2, 0.52, 0.2], m.wood, 'capsule', { parent: basket });
    const burst = root(`${d.name} · Delivery confetti`, d.basket, town);
    s.addParticles(burst, 'magic');
    s.updateParticles(burst, { enabled: false, looping: false, maxParticles: 48, light: false, startColor: d.name === 'Coral' ? '#F77F7F' : d.name === 'Bluebell' ? '#78A4EC' : '#F7C65A', endColor: '#FFF1CF', lifetime: 1.1, speed: 3, gravity: 4 });
    bursts.push(burst);
    const sign = label(d.name, [d.basket[0], 2.8, d.basket[2]], `${d.number}  ${d.name.toUpperCase()}`, d.color);
    const path = part(`${d.name} · Delivery lane`, [d.x * 0.5, 0.035, d.z - 3.6], [Math.abs(d.x) + 2.2, 0.035, 2.2], m.sand, 'cube', { parent: scenery });
    s.attachScript(house, houseBlueprint);
    for (const [key, value] of Object.entries({ tags: 'parcel-panic-generated', identity, home, basket, sign, confetti: burst, path })) s.setObjectVariable(house, key, value);

  }

  // A tiny open-front post office wraps the working conveyor without narrowing its approach.
  part('Depot · sorting house', [-2.7, 1.55, 0.55], [8.1, 3.1, 1.7], m.cream, 'cube', { parent: depot, body: 'fixed' });
  part('Depot · coral foundation', [-2.7, 0.28, 0.55], [8.35, 0.55, 1.95], m.coral, 'cube', { parent: depot });
  part('Depot · canopy roof', [-2.7, 3.34, -0.65], [9, 0.32, 4.25], m.mint, 'cube', { parent: depot, rotation: [-0.06, 0, 0] });
  part('Depot · cream roof cap', [-2.7, 3.53, -0.52], [9.2, 0.16, 0.42], m.cream, 'cube', { parent: depot });
  for (const x of [-6.85, 1.45]) {
    part('Depot · canopy post', [x, 1.65, -2.18], [0.28, 3.15, 0.28], m.mint, 'cube', { parent: depot, body: 'fixed' });
    part('Depot · post foot', [x, 0.13, -2.18], [0.62, 0.25, 0.62], m.coral, 'cube', { parent: depot });
  }
  for (let cubby = 0; cubby < 5; cubby++) {
    const x = -5.55 + cubby * 1.4;
    part(`Depot · sorting cubby ${cubby + 1}`, [x, 1.68, -0.34], [1.12, 0.82, 0.2], cubby % 3 === 0 ? m.coral : cubby % 3 === 1 ? m.blue : m.gold, 'cube', { parent: depot });
    part('Depot · cubby opening', [x, 1.68, -0.47], [0.78, 0.5, 0.06], m.ink, 'cube', { parent: depot });
  }
  part('Depot · service hatch', [0.35, 1.65, -0.35], [1.18, 1.4, 0.22], m.mint, 'cube', { parent: depot });
  part('Depot · hatch window', [0.35, 1.75, -0.5], [0.72, 0.68, 0.06], m.glass, 'cube', { parent: depot });
  part('Depot · conveyor deck', [-2.7, 0.38, -1.4], [7.4, 0.7, 2.5], m.ink, 'cube', { parent: depot, body: 'fixed' });
  part('Depot · loading apron', [-2.7, 0.055, -3.05], [8.6, 0.1, 0.8], m.cream, 'cube', { parent: depot });
  for (let i = 0; i < 12; i++) part(`Depot · roller ${i + 1}`, [-6 + i * 0.6, 0.75, -1.4], [0.14, 0.12, 2.35], m.cream, 'cube', { parent: depot });
  for (const x of [-6.2, 0.8]) part('Depot · mint rail', [x, 0.8, -1.4], [0.16, 0.3, 2.75], m.mint, 'cube', { parent: depot });
  part('Depot · winged post emblem', [-2.7, 2.62, -0.48], [1.08, 0.68, 0.1], m.gold, 'sphere', { parent: depot });
  for (const side of [-1, 1]) part('Depot · emblem wing', [-2.7 + side * 0.92, 2.62, -0.46], [0.85, 0.18, 0.08], m.gold, 'cube', { parent: depot, rotation: [0, 0, side * 0.24] });
  // The depot's winged post emblem and HUD identify it; leave the skyline clear for destination signs.

  for (let i = 0; i < 12; i++) {
    const tree = root(`Coastal Grove · Tree ${i + 1}`, [0, 0, 0], scenery);
    const lean = i % 2 ? 0.1 : -0.08;
    part('Tree · root mound', [0, 0.06, 0], [1.45, 0.14, 1.2], i % 3 === 0 ? m.sand : m.leaf, 'sphere', { parent: tree });
    part('Tree · warm trunk', [0, 0.95, 0], [0.3, 1.9 + (i % 3) * 0.16, 0.3], m.rock, 'capsule', { parent: tree, body: 'fixed', rotation: [0, 0, lean] });
    part('Tree · low branch', [i % 2 ? -0.32 : 0.32, 1.62, 0], [0.18, 0.92, 0.18], m.rock, 'capsule', { parent: tree, rotation: [0, 0, i % 2 ? 0.68 : -0.68] });
    const crown = i % 3 === 0 ? m.grass : m.leaf;
    part('Tree · crown centre', [0, 2.72 + (i % 2) * 0.18, 0], [2.05, 2.15, 1.85], crown, 'sphere', { parent: tree });
    part('Tree · crown seaward', [i % 2 ? -0.75 : 0.75, 2.65, 0.12], [1.5, 1.48, 1.4], m.leaf, 'sphere', { parent: tree });
    part('Tree · sunlit crown', [i % 2 ? 0.42 : -0.42, 3.25, -0.18], [1.12, 1.08, 1.05], m.grass, 'sphere', { parent: tree });
    if (i % 4 === 0) part('Tree · coral fruit', [i % 2 ? -0.48 : 0.48, 2.68, -0.78], [0.24, 0.24, 0.24], m.coral, 'sphere', { parent: tree });
    if (!i) s.createPrefabFromObject(tree, 'Coastal grove tree', prefabFolder);
    // Keep this generated root at unit scale so every child retains its authored proportions.
    scatter(tree, 100 + i * 4, villageTreeZone(i), 0);
  }
  const flowerBeds: readonly VillageZone[] = [
    { x: [-9, -7.8], z: [-6.7, -5.3] }, { x: [7.8, 9], z: [-6.7, -5.3] },
    { x: [-12.6, -11.4], z: [14.9, 16.1] }, { x: [11.4, 12.6], z: [14.9, 16.1] },
    { x: [-7, -5.2], z: [14.5, 15.5] }, { x: [5.2, 7], z: [14.5, 15.5] },
  ];
  for (let i = 0; i < flowerBeds.length; i++) {
    const bed = root(`Garden Cluster ${i + 1} · Paper flowers`, [0, 0, 0], scenery);
    part('Garden cluster · biscuit bed', [0, 0.045, 0], [1.9, 0.09, 1.3], m.sand, 'sphere', { parent: bed });
    part('Garden cluster · low foliage', [-0.5, 0.27, 0.15], [0.9, 0.48, 0.72], m.leaf, 'sphere', { parent: bed });
    part('Garden cluster · mint foliage', [0.48, 0.22, -0.12], [0.8, 0.4, 0.68], m.grass, 'sphere', { parent: bed });
    for (let bloom = 0; bloom < 3; bloom++) {
      const bx = -0.6 + bloom * 0.6, bz = bloom === 1 ? -0.22 : 0.18, height = 0.58 + (bloom % 2) * 0.16;
      part('Flower · stem', [bx, height * 0.5, bz], [0.06, height / 1.5, 0.06], m.leaf, 'capsule', { parent: bed, rotation: [0, 0, (bloom - 1) * 0.1] });
      part('Flower · paper petals', [bx, height, bz], [0.42, 0.18, 0.42], (i + bloom) % 3 === 0 ? m.coral : (i + bloom) % 3 === 1 ? m.cream : m.blue, 'sphere', { parent: bed });
      part('Flower · honey heart', [bx, height + 0.09, bz - 0.03], [0.15, 0.09, 0.15], m.gold, 'sphere', { parent: bed });
    }
    scatter(bed, 200 + i * 4, flowerBeds[i], 0, [1, 1, 1], [0.86, 1.08]);
  }
  const drift = compile('Cloud drift', 'A reusable gentle local-position timeline.', `blueprint Cloud_Drift
on start:
    timeline(self, property: "position", to: vec3(2, 0, 0), duration: 9, relative: true, loop: true, ping_pong: true)`);
  for (const [index, x, y, z] of [[1, -24, 12, 22], [2, 21, 14, 33], [3, -10, 17, 42]]) {
    const cloud = root(`Marshmallow cloud ${index}`, [x, y, z], scenery);
    for (let j = 0; j < 3; j++) part('Cloud · puff', [j * 2 - 2, j === 1 ? 0.5 : 0, 0], [4, j === 1 ? 2.8 : 2, 2.3], m.cream, 'sphere', { parent: cloud });
    s.attachScript(cloud, drift);
  }

  const spin = part('Slow spinning gate · jump or go around', [0, 0.8, 5.4], [5.6, 0.38, 0.38], m.coral, 'cube', { parent: play, body: 'kinematic' });
  s.attachScript(spin, compile('Spinning gate', 'Change turn_speed to tune this gentle obstacle.', `blueprint Spinning_Gate
var turn_speed: number = 65
on event PPGenerate(payload):
    self.turn_speed = 42 + Game.PPSeed % 35
    set_rotation(self, vec3(0, Game.PPSeed % 180, 0))
on update(dt):
    if Game.PPPlaying:
        self.rotate(axis: "y", amount: self.turn_speed)`));
  s.setObjectVariable(spin, 'tags', 'parcel-panic-generated');
  part('Gate · centre cap', [0, 0.85, 5.4], [0.65, 0.65, 0.65], m.gold, 'sphere', { parent: play });


  const robot = s.createRoleObject('player', { kind: 'empty', name: 'Pip · Robot Courier', position: [0, 0.15, -5] });
  if (!robot.ok || !robot.objectId) throw new Error('Could not create the robot courier.');
  const playerId = robot.objectId;
  s.updateCharacterController(playerId, {
    autoInputWithScript: false, cameraFollow: true, cameraRelativeMovement: true,
    moveSpeed: 5.8, sprintMultiplier: 1.35, acceleration: 30, deceleration: 38, airControl: 0.5, turnSpeed: 10, jumpStrength: 7, gravity: 18, stableJumpArc: true,
    groundLevel: -15, stepHeight: 0.3, coyoteTime: 0.15, jumpBufferTime: 0.15,
    cameraOffset: [0, 4.2, -8], cameraPitch: 0.25, cameraMinPitch: 0.05, cameraMaxPitch: 0.95,
    keyAttack: 'Unbound', keyRoll: 'Unbound', keyCrouch: 'Unbound', keyEmote: 'Unbound',
  });
  // Courier visuals and animation are attached after the game-loop blueprint is compiled.

  const intro = s.createCinematic('Parcel Panic · A very special delivery', PARCEL_PANIC_INTRO_SECONDS);
  s.updateCinematic(intro, { autoplay: true, skippable: true, frameRate: 30 });
  s.setCinematicLook(intro, { letterbox: 2.15, grade: 'warm', gradeIntensity: 0.1, grain: 0, vignette: 0.08 });
  const shots: Array<[string, number, number, Vector3Tuple, Vector3Tuple, Vector3Tuple]> = [
    ['01 · Welcome to Postcard Island', 0, 3.5, [24, 22, -25], [17, 15, -18], [0, 1, 6]],
    ['02 · Five parcels, three neighbours', 3.5, 6, [-9, 5, -7], [-5, 3.5, -6], [-2.5, 1, -1]],
    ['03 · Meet your new courier', 6, 9, [3, 2.7, -1.8], [2.5, 2.4, -2.3], [0, 1.1, -5]],
  ];
  for (const [name, start, end, from, to, target] of shots) {
    s.addCinematicAction(intro, { type: 'camera', label: name, time: start, duration: end - start, interpolation: 'smooth', keyframes: [
      { time: start, position: from, lookAt: target, fov: 52 }, { time: end, position: to, lookAt: target, fov: 52 },
    ] });
    s.addCinematicMarker(intro, { time: start, label: name, color: '#4AD9BE' });
  }
  s.addCinematicAction(intro, { type: 'fade', time: 0, duration: 0.7, fadeFrom: 1, fadeTo: 0, fadeColor: '#193F4B' });
  s.addCinematicAction(intro, { type: 'text', time: 0.8, duration: 2.6, text: 'PARCEL PANIC', textStyle: 'title', textColor: '#FFF4DD' });
  s.addCinematicAction(intro, { type: 'text', time: 3.7, duration: 2.2, text: 'Five parcels. Three neighbours. One very keen robot.', textStyle: 'subtitle', textColor: '#FFF4DD' });
  s.addCinematicAction(intro, { type: 'text', time: 6.3, duration: 2.5, text: 'A little kindness, delivered. Your shift starts now!', textStyle: 'subtitle', textColor: '#FFF4DD' });
  s.addCinematicAction(intro, { type: 'event', time: 8.999, duration: 0.001, eventName: 'PPBegin', label: 'Hand control to the courier' });
  // A short camera-free sequence replaces the intro on Skip using the existing cinematic graph node.
  const handoff = s.createCinematic('Parcel Panic · Skip to gameplay', 0.5);
  s.addCinematicAction(handoff, { type: 'event', time: 0, eventName: 'PPBegin', label: 'Same handoff as normal completion' });

  const playerLogic = compile('Courier · Movement and round flow', 'Intro handoff, movement, pause, timed/relaxed rounds and replay. All game rules are editable.', `blueprint Parcel_Panic_Courier
var walk_speed: number = 5.8
var pp_nearest: string = ""
var pp_nearest_distance: number = 2.6
on start:
    Game.PPIntro = true
    Game.PPPlaying = false
    fire_event("PPGenerateVillage")
on event PPGenerateVillage(payload):
    for actor in find_actors(tag: "parcel-panic-generated"):
        fire_event("PPGenerate", target: actor)
on event PPNewVillage(payload):
    Game.PPSeed = (Game.PPSeed * 48271) % 999983
    Game.PPVillage = Game.PPVillage + 1
    fire_event("PPReset")
    Screen.flash(0.22, color: "#FFF4DD")
    Game.PPToast = "A new village! Find your neighbours and deliver some smiles."
on event PPBegin(payload):
    if Game.PPIntro:
        Game.PPIntro = false
        Game.PPPlaying = true
        Game.PPToast = "Welcome, courier! Pick a parcel at the depot."
        Game.PPToastTime = 4
on event PPSkip(payload):
    if Game.PPIntro:
        Cinematic.play("${handoff}")
on key_pressed("Enter"):
    fire_event("PPSkip")
on update(dt):
    if Game.PPPlaying:
        if Game.PPPaused == false:
            self.move(Input.move(), speed: self.walk_speed - Game.PPCarryWeight * 0.35)
            if dot(position(self), vec3(0, 1, 0)) < -4:
                set_position(self, vec3(0, 0.2, -5))
                set_velocity(self, vec3(0, 0, 0))
            if Game.PPDelivered >= 5:
                Game.PPPlaying = false
                Game.PPDone = true
                ${sound(4)}
            if Game.PPTimed:
                if Game.PPSeconds >= 90:
                    Game.PPPlaying = false
                    Game.PPDone = true
                    ${sound(4)}
on timer(1):
    if Game.PPPlaying and Game.PPPaused == false:
        Game.PPSeconds = Game.PPSeconds + 1
        Game.PPTimeLeft = max(0, 90 - Game.PPSeconds)
        Game.PPToastTime = max(0, Game.PPToastTime - 1)
on key_pressed("Space"):
    if Game.PPPlaying and Game.PPPaused == false:
        self.jump()
on key_pressed("KeyE"):
    fire_event("PPInteract")
on event PPInteract(payload):
    if Game.PPPlaying and Game.PPPaused == false and Game.PPCarry == "":
        self.pp_nearest = ""
        self.pp_nearest_distance = 2.6
        for actor in find_actors(tag: "parcel-panic-parcel"):
            if get_var(actor, "delivered") == false:
                if distance(position(actor), Player.location) < self.pp_nearest_distance:
                    self.pp_nearest = actor
                    self.pp_nearest_distance = distance(position(actor), Player.location)
        if self.pp_nearest != "":
            fire_event("PPPickup", target: self.pp_nearest)
on key_pressed("KeyQ"):
    for actor in find_actors(tag: "parcel-panic-parcel"):
        fire_event("PPThrow", target: actor)
on key_pressed("KeyP"):
    fire_event("PPPause")
on event PPPause(payload):
    if Game.PPPlaying:
        if Game.PPPaused:
            Game.PPPaused = false
            Time.scale = 1
        else:
            Game.PPPaused = true
            Time.scale = 0
on event PPRelaxed(payload):
    Game.PPTimed = false
    fire_event("PPReset")
on event PPTimeTrial(payload):
    Game.PPTimed = true
    fire_event("PPReset")
on event PPReset(payload):
    Time.scale = 1
    Game.PPIntro = false
    Game.PPPlaying = true
    Game.PPPaused = false
    Game.PPDone = false
    Game.PPSeconds = 0
    Game.PPTimeLeft = 90
    Game.PPScore = 0
    Game.PPDelivered = 0
    Game.PPCarry = ""
    Game.PPCarryWeight = 0
    Game.PPThrowPulse = 0
    Game.PPPickupPulse = 0
    fire_event("PPGenerateVillage")
    Game.PPToast = "Fresh parcels! Let us make some neighbours happy."
    Game.PPToastTime = 3
    set_position(self, vec3(0, 0.2, -5))
    set_velocity(self, vec3(0, 0, 0))
    set_rotation(self, vec3(0, 0, 0))
    for actor in find_actors(tag: "parcel-panic-resettable"):
        fire_event("PPReset", target: actor)
on key_pressed("KeyR"):
    if Game.PPPlaying and Game.PPPaused == false:
        for actor in find_actors(tag: "parcel-panic-parcel"):
            fire_event("PPRecall", target: actor)`);
  s.attachScript(playerId, playerLogic);
  const courier = addParcelPanicCourier(playerId, m, logicFolder);
  // Feather has one script component per actor. Compile both authored behaviors into one editable
  // courier blueprint so animation can read the same controller's grounding and velocity.
  const print = (id: string) => {
    const state = useEditorStore.getState();
    const blueprint = state.blueprints.find(b => b.id === id)!;
    return graphToFeatherScript({ blueprint, graph: state.graphs.find(g => g.id === blueprint.graphId)!, variables: state.variables, blueprints: state.blueprints });
  };
  const merged = s.applyBlueprintFeatherSource(playerLogic, print(playerLogic) + '\n' + print(courier.blueprintId).replace(/^blueprint[^\n]*\n/, ''));
  if (!merged.ok || merged.diagnostics.length) throw new Error(`Courier animation integration: ${merged.diagnostics.map(d => d.message).join('; ')}`);
  s.attachScript(playerId, playerLogic);
  s.createPrefabFromObject(playerId, 'Pip · Playable robot courier', prefabFolder);

  const pad = part('Honey hop · Bounce pad', [4.3, 0.16, 7], [2.2, 0.32, 2.2], m.gold, 'cube', { parent: play, body: 'fixed', trigger: true });
  const padVisual = part('Bounce pad · centre', [4.3, 0.34, 7], [1.4, 0.07, 1.4], m.cream, 'cube', { parent: play });
  s.attachScript(pad, compile('Honey hop · Spring', 'A player-only trigger adds a little lift. Change the impulse vector to tune the bounce.', `blueprint Honey_Hop
var home: vector3 = vec3(4.3, 0.16, 7)
on event PPGenerate(payload):
    if Game.PPSeed % 2 == 0:
        self.home = vec3(-4.3, 0.16, 5.2 + (Game.PPSeed % 100) / 50)
    else:
        self.home = vec3(4.3, 0.16, 5.2 + (Game.PPSeed % 100) / 50)
    set_position(self, self.home)
    set_position("${padVisual}", vec_add(self.home, vec3(0, 0.18, 0)))
on trigger_enter(other: "${playerId}"):
    if Game.PPPlaying and Game.PPPaused == false:
        apply_impulse(Player, vector: vec3(0, 7, 0))
        ${sound(2)}`));
  s.setObjectVariable(pad, 'tags', 'parcel-panic-generated');
  const padHome: Vector3Tuple = [villageSeed % 2 === 0 ? -4.3 : 4.3, 0.16, 5.2 + villageSeed % 100 / 50];
  s.updateTransform(pad, 'position', padHome);
  s.updateTransform(padVisual, 'position', [padHome[0], padHome[1] + 0.18, padHome[2]]);

  for (const side of [-1, 1]) {
    const x = side * 10.65;
    part(`Mail yard · ${side < 0 ? 'drum' : 'crate'} bay mat`, [x, 0.045, 2.7], [3.7, 0.08, 4.15], side < 0 ? m.blue : m.coral, 'cube', { parent: play });
    part('Mail yard · cream bay inset', [x, 0.09, 2.7], [3.05, 0.025, 3.5], m.cream, 'cube', { parent: play });
    part('Mail yard · outer bumper', [side * 12.38, 0.28, 2.7], [0.22, 0.55, 4.2], m.mint, 'cube', { parent: play });
    for (const z of [0.7, 4.7]) part('Mail yard · corner bollard', [side * 12.38, 0.52, z], [0.3, 0.9, 0.3], m.gold, 'capsule', { parent: play });
    const pennant = root(`Mail yard · ${side < 0 ? 'ROLL' : 'STACK'} marker`, [side * 12.4, 1.55, 2.7], play);
    part('Mail yard · marker post', [0, 0, 0], [0.12, 1.5, 0.12], m.ink, 'capsule', { parent: pennant });
    part('Mail yard · marker flag', [-side * 0.38, 0.52, 0], [0.75, 0.42, 0.08], side < 0 ? m.blue : m.coral, 'cube', { parent: pennant, rotation: [0, 0, side * 0.08] });
  }
  for (let i = 0; i < 8; i++) {
    const ball = i >= 6, crate = i >= 3 && !ball;
    const id = part(`${ball ? 'Rubber ball' : crate ? 'Stackable crate' : 'Rolling mail drum'} ${i + 1}`, [0, 0.7, 0], [1, 1, 1], ball ? m.gold : crate ? m.wood : i % 2 ? m.coral : m.blue, ball || !crate ? 'sphere' : 'cube', { parent: play, body: 'dynamic' });
    s.updatePhysics(id, { mass: ball ? 0.45 : crate ? 1.6 : 0.8, friction: crate ? 0.82 : 0.48, restitution: ball ? 0.76 : crate ? 0.1 : 0.32, linearDamping: 0.25, angularDamping: crate ? 1.1 : 0.4, ccd: true });
    if (crate) {
      for (const side of [-1, 1]) part('Crate · wooden band', [0, side * 0.32, 0], [1.025, 0.12, 1.025], m.cream, 'cube', { parent: id });
      part('Crate · postage label', [0, 0.08, -0.52], [0.52, 0.38, 0.035], i % 2 ? m.blue : m.coral, 'cube', { parent: id, rotation: [0, 0, 0.08] });
    } else if (!ball) {
      part('Drum · postage stripe', [0, 0, 0], [1.02, 0.23, 1.02], m.cream, 'sphere', { parent: id });
      for (const side of [-1, 1]) part('Drum · hub cap', [side * 0.5, 0, 0], [0.16, 0.42, 0.42], m.ink, 'sphere', { parent: id });
    } else {
      part('Ball · cream highlight', [-0.26, 0.3, -0.38], [0.28, 0.18, 0.12], m.cream, 'sphere', { parent: id });
      part('Ball · coral patch', [0.32, -0.24, 0.3], [0.22, 0.14, 0.12], m.coral, 'sphere', { parent: id });
    }
    if (i === 0 || i === 3 || i === 6) s.createPrefabFromObject(id, ball ? 'Bouncy rubber ball' : crate ? 'Stackable mail crate' : 'Rolling mail drum', prefabFolder);
    scatter(id, 400 + i * 4, villagePropZone(i), 0.7, [1, 1, 1], [0.82, 1.08], true);
  }

  const parcelLogic = compile('Parcel · Pick up, carry, throw and deliver', 'E picks up; Q throws with a gentle assist when facing a nearby matching basket. Edit destination, label, value and throw_speed per parcel.', `blueprint Parcel_Delivery
var destination: string = ""
var destination_name: string = "Coral 01"
var confetti: string = ""
var home: vector3 = vec3(0, 1, 0)
var held: boolean = false
var delivered: boolean = false
var throw_age: number = 99
var value: number = 100
var throw_speed: number = 8
var heading: vector3 = vec3(0, 0, 1)
var parcel_mass: number = 0.7
on event PPPickup(payload):
    if Game.PPPlaying and Game.PPPaused == false:
        if self.delivered == false and self.held == false:
            if Game.PPCarry == "":
                if distance(position(self), Player.location) < 2.6:
                    self.held = true
                    self.throw_age = 99
                    Game.PPCarry = self.destination_name
                    Game.PPCarryWeight = self.parcel_mass
                    Game.PPPickupPulse = Game.PPPickupPulse + 1
                    set_physics(self, { enabled: false, body: "dynamic", collider: "box", mass: self.parcel_mass })
                    set_velocity(self, vec3(0, 0, 0))
                    ${sound(1)}
on event PPThrow(payload):
    if self.held and Game.PPPlaying and Game.PPPaused == false:
        self.held = false
        Game.PPCarry = ""
        Game.PPCarryWeight = 0
        Game.PPThrowPulse = Game.PPThrowPulse + 1
        self.throw_age = 0
        set_physics(self, { enabled: true, body: "dynamic", collider: "box", mass: self.parcel_mass })
        wait(0.02)
        if self.throw_age < 0.2 and self.held == false and self.delivered == false:
            if distance(position(self), position(self.destination)) < 9:
                if dot(self.heading, normalize(vec_sub(position(self.destination), position(self)))) > 0.65:
                    set_velocity(self, vec_add(vec_scale(vec_sub(position(self.destination), position(self)), 1.333333), vec3(0, 3.68, 0)))
                else:
                    set_velocity(self, vec_add(vec_scale(self.heading, self.throw_speed), vec3(0, 4, 0)))
            else:
                set_velocity(self, vec_add(vec_scale(self.heading, self.throw_speed), vec3(0, 4, 0)))
            set_angular_velocity(self, vec3(3, 1.4, 0.6))
            ${sound(2)}
on update(dt):
    if Game.PPPlaying and Game.PPPaused == false:
        if self.delivered == false:
            if self.held:
                self.heading = vec3(sin(dot(rotation(Player), vec3(0, 1, 0))), 0, cos(dot(rotation(Player), vec3(0, 1, 0))))
                set_position(self, vec_add(Player.location, vec_add(vec_scale(self.heading, 0.95), vec3(0, 1.1, 0))))
                set_rotation(self, rotation(Player))
                set_velocity(self, vec3(0, 0, 0))
            if distance(position(self), position(self.destination)) < 1.2:
                self.delivered = true
                if self.held:
                    Game.PPCarry = ""
                    Game.PPCarryWeight = 0
                self.held = false
                Game.PPDelivered = Game.PPDelivered + 1
                Game.PPScore = Game.PPScore + self.value
                Game.PPToast = "Special delivery! +100"
                if self.throw_age < 1.6:
                    Game.PPScore = Game.PPScore + 50
                    Game.PPToast = "AIR MAIL! Lovely throw. +150"
                Game.PPToastTime = 2.5
                burst_particles(self.confetti, 32)
                ${sound(3)}
                set_position(self, vec3(0, -30, 0))
                set_physics(self, { enabled: false })
                set_visible(self, false)
            if dot(position(self), vec3(0, 1, 0)) < -5 and self.delivered == false:
                set_position(self, self.home)
                set_velocity(self, vec3(0, 0, 0))
                set_angular_velocity(self, vec3(0, 0, 0))
                self.throw_age = 99
on timer(0.1):
    if Game.PPPlaying and Game.PPPaused == false:
        self.throw_age = self.throw_age + 0.1
on event PPRecall(payload):
    if self.delivered == false:
        self.held = false
        self.throw_age = 99
        Game.PPCarry = ""
        Game.PPCarryWeight = 0
        set_physics(self, { enabled: true, body: "dynamic", collider: "box", mass: self.parcel_mass })
        set_position(self, self.home)
        set_rotation(self, vec3(0, 0, 0))
        set_velocity(self, vec3(0, 0, 0))
        set_angular_velocity(self, vec3(0, 0, 0))
on event PPReset(payload):
    self.delivered = false
    self.held = false
    self.throw_age = 99
    set_visible(self, true)
    set_physics(self, { enabled: true, body: "dynamic", collider: "box", mass: self.parcel_mass })
    set_position(self, self.home)
    set_rotation(self, vec3(0, 0, 0))
    set_velocity(self, vec3(0, 0, 0))
    set_angular_velocity(self, vec3(0, 0, 0))`);
  for (let i = 0; i < 5; i++) {
    const d = i % 3, home: Vector3Tuple = [-5.5 + i * 1.3, 1.22, -1.4];
    const id = part(`Parcel ${i + 1} · ${destinations[d].name} ${destinations[d].number}`, home, [0.72, 0.72, 0.72], m.wood, 'cube', { body: 'dynamic', parent: depot });
    s.updatePhysics(id, { mass: 0.55 + i * 0.14, restitution: 0.16, friction: 0.72, linearDamping: 0.12, angularDamping: 0.7, ccd: true });
    part('Parcel · cross ribbon', [0, 0, 0], [1.025, 1.025, 0.19], destinations[d].material, 'cube', { parent: id });
    part('Parcel · length ribbon', [0, 0, 0], [0.19, 1.04, 1.025], destinations[d].material, 'cube', { parent: id });
    for (let mark = 0; mark <= d; mark++) part('Parcel · address dots', [-0.22 + mark * 0.22, 0.2, -0.515], [0.12, 0.12, 0.02], m.ink, 'sphere', { parent: id });
    s.attachScript(id, parcelLogic);
    for (const [key, value] of Object.entries({ tags: 'parcel-panic-parcel,parcel-panic-resettable', destination: baskets[d], destination_name: `${destinations[d].name} ${destinations[d].number}`, confetti: bursts[d], home, parcel_mass: 0.55 + i * 0.14, value: 100, throw_speed: 8.5 - i * 0.2 })) s.setObjectVariable(id, key, value);
    if (i < 3) s.createPrefabFromObject(id, `${destinations[d].name} · Throwable parcel`, prefabFolder);
  }
  addParcelPanicUI(world);
  s.selectObject(playerId);
  return playerId;
}
