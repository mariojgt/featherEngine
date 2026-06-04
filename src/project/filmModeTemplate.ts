import { getPlatform } from '../platform';
import { useEditorStore } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import type { AssetItem, Vector3Tuple } from '../types';

/**
 * Film Mode starter — a self-running **cyberpunk city cinematic**. It builds a neon street canyon out of
 * the bundled low-poly city kit (public/templates/cyberpunk: road + sidewalk tiles, building blocks,
 * skyscrapers, holo-billboards, a rooftop satellite dish), drops it into a rainy-night neon environment
 * with strong bloom, then authors an ~18s autoplay flythrough that dollies down the avenue and pulls up to
 * reveal the skyline — letterboxed, graded, with fade bookends and a slowly turning dish for life.
 *
 * Recreate any of it by scrubbing the playhead, framing the viewport, and clicking "Add camera shot" /
 * tuning the "Film look" panel. The whole scene is editable — move buildings, retime the camera keyframes,
 * swap the grade.
 */

const CYBER_DIR = 'templates/cyberpunk';
const makeId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

/** All city props share one big-unit space; this scale maps a 200-unit road tile to a 12m avenue tile. */
const S = 0.06;

/** Known GLB footprints (offline-measured, x/y/z in source units). Used for deterministic tiling/spacing. */
interface Kit {
  file: string;
  /** source-space size [x, y, z] */
  size: Vector3Tuple;
}
const ROAD: Kit = { file: 'Road_Chunk_5.glb', size: [200, 10, 200] };
const SIDEWALK: Kit = { file: 'Sidewalk_Chunk_2.glb', size: [200, 20, 200] };
const BUILDINGS: Kit[] = [
  { file: 'BuildingBlock_1.glb', size: [600, 250, 240] },
  { file: 'BuildingBlock_2.glb', size: [600, 250, 200] },
  { file: 'BuildingBlock_18.glb', size: [400, 250, 220] },
  { file: 'BuildingBlock_19.glb', size: [400, 250, 220] },
  { file: 'BuildingBlock_24.glb', size: [400, 160, 210] },
];
const TOWER: Kit = { file: 'Building_3.glb', size: [400, 1620, 200] };
const ADS: Kit[] = [
  { file: 'Advertising_6.glb', size: [120, 180, 30] },
  { file: 'Advertising_7.glb', size: [180, 90, 50] },
  { file: 'Advertising_5.glb', size: [70, 160, 10] },
];
const DISH: Kit = { file: 'SateliteDish.glb', size: [90, 90, 30] };

/** Import a bundled GLB once (reusing it if already imported), returning the asset. */
async function importModel(file: string, folderId?: string): Promise<AssetItem | undefined> {
  const existing = useEditorStore.getState().assets.find((a) => a.name === file && a.type === 'model');
  if (existing) return existing;
  const response = await fetch(`${CYBER_DIR}/${file}`);
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

export async function createFilmModeTemplate(): Promise<string | undefined> {
  const store = useEditorStore.getState();
  const scene = store.activeScene();
  if (!scene) return undefined;

  // --- Import every city-kit model up front (reused below). ---
  const folder = store.createFolder('Cyberpunk Kit');
  const assets = new Map<string, AssetItem>();
  const allFiles = [ROAD, SIDEWALK, TOWER, DISH, ...BUILDINGS, ...ADS];
  for (const kit of allFiles) {
    const asset = await importModel(kit.file, folder);
    if (asset) assets.set(kit.file, asset);
  }
  if (assets.size === 0) throw new Error('Cyberpunk kit not found under public/templates/cyberpunk.');

  /** Place a kit model as a uniformly-scaled object. y is the ground the model's base (min y = 0) sits on. */
  const placeModel = (kit: Kit, name: string, pos: Vector3Tuple, rotY = 0, scaleMul = 1): string | undefined => {
    const asset = assets.get(kit.file);
    if (!asset) return undefined;
    const id = store.createObjectWithProps('cube', { name, position: pos });
    store.setObjectModel(id, asset.id);
    store.updateTransform(id, 'scale', [S * scaleMul, S * scaleMul, S * scaleMul]);
    if (rotY) store.updateTransform(id, 'rotation', [0, rotY, 0]);
    return id;
  };

  // Scaled footprints we tile against.
  const tile = ROAD.size[0] * S; // 12m road/sidewalk tile
  const LANE_COUNT = 12; // avenue length in tiles
  const avenueLen = LANE_COUNT * tile; // 144m
  const roadHalf = tile / 2; // 6
  const sidewalkCenterX = tile; // sidewalk sits one tile out from centerline (x = ±12)
  const buildingFaceX = sidewalkCenterX + tile / 2; // street-facing wall at x = ±18

  // --- A dark ground slab so the world has a floor under the fog. ---
  const groundId = store.createObjectWithProps('cube', {
    name: 'City Ground',
    position: [0, -0.35, avenueLen / 2 - tile / 2],
    color: '#070611',
  });
  store.updateTransform(groundId, 'scale', [120, 0.7, avenueLen + 40]);
  store.updateRenderer(groundId, { metalness: 0.1, roughness: 0.85 });

  // --- Lay the avenue: road down the centerline, raised sidewalks either side, tiled along +Z. ---
  for (let i = 0; i < LANE_COUNT; i++) {
    const z = i * tile + tile / 2;
    placeModel(ROAD, `Road ${i + 1}`, [0, 0, z]);
    placeModel(SIDEWALK, `Sidewalk L ${i + 1}`, [-sidewalkCenterX, 0, z]);
    placeModel(SIDEWALK, `Sidewalk R ${i + 1}`, [sidewalkCenterX, 0, z]);
  }

  // --- Line both sides with buildings, rotated 90° so each block's long face fronts the street. After the
  //     rotation a block occupies its original WIDTH along Z and its DEPTH toward the street. Two towers per
  //     side punch the skyline; the far end is capped with towers for the final reveal. ---
  const gap = 2.5;
  const buildSide = (side: -1 | 1, order: number[]) => {
    const rotY = side * Math.PI * 0.5;
    let cursor = 0;
    let palette = 0;
    while (cursor < avenueLen) {
      // every 3rd slot is a tower landmark
      const isTower = palette % 3 === 2;
      const kit = isTower ? TOWER : BUILDINGS[order[palette % order.length]];
      const frontage = kit.size[0] * S;
      const depthHalf = (kit.size[2] * S) / 2;
      const z = cursor + frontage / 2;
      const x = side * (buildingFaceX + depthHalf);
      placeModel(kit, isTower ? `Tower ${side < 0 ? 'L' : 'R'}` : `Building ${side < 0 ? 'L' : 'R'}`, [x, 0, z], rotY);
      cursor += frontage + gap;
      palette++;
    }
  };
  buildSide(-1, [0, 2, 1, 4, 3]);
  buildSide(1, [3, 1, 4, 0, 2]);

  // --- Holo-billboards along the canyon, faces turned toward the street, mounted at mid-rise height. ---
  const adSpots: Array<{ z: number; side: -1 | 1; ad: number; y: number; scale: number }> = [
    { z: avenueLen * 0.22, side: 1, ad: 0, y: 7, scale: 1.1 },
    { z: avenueLen * 0.45, side: -1, ad: 1, y: 9, scale: 1.0 },
    { z: avenueLen * 0.68, side: 1, ad: 2, y: 11, scale: 1.2 },
    { z: avenueLen * 0.82, side: -1, ad: 0, y: 8, scale: 1.0 },
  ];
  adSpots.forEach((spot, i) => {
    placeModel(ADS[spot.ad], `Holo Billboard ${i + 1}`, [spot.side * (buildingFaceX - 1.2), spot.y, spot.z], spot.side * Math.PI * 0.5, spot.scale);
  });

  // --- Rooftop satellite dish as a hero prop near the end of the avenue (slowly turns during the flythrough). ---
  const dishHostHeight = BUILDINGS[0].size[1] * S; // ~15m roof
  const dishPos: Vector3Tuple = [-(buildingFaceX + 4), dishHostHeight, avenueLen * 0.78];
  const dishScale: Vector3Tuple = [S * 1.3, S * 1.3, S * 1.3];
  const dishId = placeModel(DISH, 'Rooftop Dish', dishPos, 0.6, 1.3);

  // --- Neon curb strips: thin bright emissive rails that bloom hard — the signature wet-neon read. ---
  const curbL = store.createObjectWithProps('cube', { name: 'Neon Curb L', position: [-roadHalf - 0.1, 0.7, avenueLen / 2 - tile / 2], color: '#13e0ff' });
  store.updateTransform(curbL, 'scale', [0.22, 0.22, avenueLen]);
  store.updateRenderer(curbL, { materialOverrides: { emissiveColor: '#13e0ff', emissiveIntensity: 4.5 } });
  const curbR = store.createObjectWithProps('cube', { name: 'Neon Curb R', position: [roadHalf + 0.1, 0.7, avenueLen / 2 - tile / 2], color: '#ff2ee6' });
  store.updateTransform(curbR, 'scale', [0.22, 0.22, avenueLen]);
  store.updateRenderer(curbR, { materialOverrides: { emissiveColor: '#ff2ee6', emissiveIntensity: 4.5 } });
  // A dashed centerline glow.
  const centerLine = store.createObjectWithProps('cube', { name: 'Center Glow', position: [0, 0.66, avenueLen / 2 - tile / 2], color: '#fff3a0' });
  store.updateTransform(centerLine, 'scale', [0.18, 0.06, avenueLen]);
  store.updateRenderer(centerLine, { materialOverrides: { emissiveColor: '#ffd86b', emissiveIntensity: 2.5 } });

  // --- A few colored point lights wash the street (kept low-count; the bloom + emissive do most of the work). ---
  const lightSpots: Array<{ z: number; x: number; color: string }> = [
    { z: avenueLen * 0.15, x: -8, color: '#16e6ff' },
    { z: avenueLen * 0.4, x: 8, color: '#ff35e0' },
    { z: avenueLen * 0.62, x: -8, color: '#16e6ff' },
    { z: avenueLen * 0.85, x: 8, color: '#ff8a3d' },
  ];
  lightSpots.forEach((spot, i) => {
    const lid = store.createObjectWithProps('light', { name: `Neon Light ${i + 1}`, position: [spot.x, 9, spot.z] });
    store.setObjectLight(lid, { type: 'point', color: spot.color, intensity: 18, distance: 34, castShadow: false });
  });

  // --- Rainy cyberpunk NIGHT: deep indigo sky, dim magenta key, thick neon-tinted fog. ---
  store.updateSceneEnvironment(scene.id, {
    skyMode: 'procedural',
    skyTopColor: '#05040f',
    skyHorizonColor: '#241043',
    skyGroundColor: '#03020a',
    environmentIntensity: 0.45,
    sunColor: '#ff5fd6',
    sunIntensity: 0.4,
    sunElevation: 14,
    sunAzimuth: 215,
    fogEnabled: true,
    fogColor: '#0a0618',
    fogNear: 30,
    fogFar: 260,
  });
  // Punchy neon post: strong bloom (low threshold so the emissive rails/billboards glow) + a vignette.
  store.updateRenderSettings({ bloomEnabled: true, bloomIntensity: 1.0, bloomThreshold: 0.55, bloomRadius: 0.75, vignetteEnabled: true });

  // --- The cinematic: an ~18s flythrough down the avenue that pulls up to the skyline. ---
  const duration = 18;
  const cinematicId = store.createCinematic('Neon City Flythrough', duration);
  store.updateCinematic(cinematicId, { autoplay: true, skippable: true, duration });
  // Anamorphic scope bars + a teal/orange grade for neon contrast, a touch of grain + vignette.
  store.setCinematicLook(cinematicId, { letterbox: 2.39, grade: 'teal-orange', grain: 0.08, vignette: 0.34 });

  // Open from black.
  store.addCinematicAction(cinematicId, {
    type: 'fade',
    time: 0,
    duration: 1.5,
    label: 'Fade in',
    fadeFrom: 1,
    fadeTo: 0,
    fadeColor: '#04030a',
  });

  // One smooth camera track flown through 5 keyframes: low canyon entry → drift + rise → skyline pull-up.
  const dof = (pos: Vector3Tuple, look: Vector3Tuple) => Number(Math.hypot(pos[0] - look[0], pos[1] - look[1], pos[2] - look[2]).toFixed(2));
  const kf = (t: number, position: Vector3Tuple, lookAt: Vector3Tuple, fov: number, aperture?: number) => ({
    time: Number((duration * t).toFixed(3)),
    position,
    lookAt,
    fov,
    aperture,
    focusDistance: aperture ? dof(position, lookAt) : undefined,
  });
  store.addCinematicAction(cinematicId, {
    type: 'camera',
    time: 0,
    duration,
    label: 'Avenue flythrough',
    ease: 'smooth',
    keyframes: [
      kf(0.0, [0, 2.2, -10], [0, 7, 40], 52, 3.5),
      kf(0.28, [-3.2, 3.8, avenueLen * 0.22], [4, 9, avenueLen * 0.5], 46, 4),
      kf(0.55, [3.4, 6.5, avenueLen * 0.48], [-2, 12, avenueLen * 0.8], 44, 4.5),
      kf(0.8, [-2.2, 11, avenueLen * 0.78], [2, 18, avenueLen * 1.05], 42),
      kf(1.0, [0, 18, avenueLen * 1.0], [0, 32, avenueLen * 1.35], 39),
    ],
  });

  // The rooftop dish slowly tracks across the sky during the flythrough.
  if (dishId) {
    store.addCinematicAction(cinematicId, {
      type: 'transform',
      time: 1,
      duration: duration - 2,
      label: 'Dish sweep',
      objectId: dishId,
      ease: 'smooth',
      transformKeyframes: [
        { time: 0, position: dishPos, rotation: [0, 0.6, 0], scale: dishScale },
        { time: duration - 2, position: dishPos, rotation: [0, 0.6 + Math.PI * 0.7, 0], scale: dishScale },
      ],
    });
  }

  // Story beat + close to black.
  store.addCinematicAction(cinematicId, {
    type: 'event',
    time: duration - 0.4,
    label: 'Fire cinematic_finished',
    eventName: 'cinematic_finished',
  });
  store.addCinematicAction(cinematicId, {
    type: 'fade',
    time: duration - 1.6,
    duration: 1.6,
    label: 'Fade out',
    fadeFrom: 0,
    fadeTo: 1,
    fadeColor: '#04030a',
  });

  store.setActiveCinematic(cinematicId);
  if (dishId) store.selectObject(dishId);
  return cinematicId;
}
