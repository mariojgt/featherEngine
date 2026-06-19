import type { CinematicLook, MaterialDefinition, PhysicalSurfaceProps, RenderSettings, SceneEnvironmentSettings, WaterStylePreset, WaterVolumeComponent } from '../types';

export type MaterialPresetId =
  | 'plastic'
  | 'metal'
  | 'wet-floor'
  | 'glass'
  | 'neon'
  | 'rock'
  | 'grass'
  | 'skin'
  | 'rubber'
  | 'water'
  | 'car-paint'
  | 'velvet'
  | 'gemstone';

export type LightingPresetId = 'sunny' | 'overcast' | 'night' | 'cyberpunk' | 'indoor' | 'cinematic' | 'godrays';

export interface MaterialPreset {
  id: MaterialPresetId;
  name: string;
  description: string;
  patch: Pick<MaterialDefinition, 'color' | 'metalness' | 'roughness' | 'emissiveColor' | 'emissiveIntensity'> & Partial<PhysicalSurfaceProps>;
}

/** Neutral physical layers, so applying a preset that doesn't use them clears any left over from a prior preset. */
const NEUTRAL_PHYS: Required<PhysicalSurfaceProps> = {
  clearcoat: 0,
  clearcoatRoughness: 0,
  sheen: 0,
  sheenColor: '#000000',
  transmission: 0,
  ior: 1.5,
  thickness: 0,
  iridescence: 0,
};

/** A preset's full material patch, with physical layers explicitly reset where the preset doesn't set them. */
export const materialPresetPatch = (preset: MaterialPreset) => ({ ...NEUTRAL_PHYS, ...preset.patch });

export interface LightingPreset {
  id: LightingPresetId;
  name: string;
  description: string;
  environment: Partial<SceneEnvironmentSettings>;
  renderSettings: Partial<RenderSettings>;
  colorGrade?: CinematicLook;
}

export const MATERIAL_PRESETS: MaterialPreset[] = [
  {
    id: 'plastic',
    name: 'Plastic',
    description: 'Clean colored prop surface with soft highlights.',
    patch: { color: '#5B8CFF', metalness: 0, roughness: 0.46, emissiveColor: '#000000', emissiveIntensity: 0 },
  },
  {
    id: 'metal',
    name: 'Metal',
    description: 'Polished dark metal for weapons, machines, and trim.',
    patch: { color: '#B7C0CF', metalness: 1, roughness: 0.24, emissiveColor: '#000000', emissiveIntensity: 0 },
  },
  {
    id: 'wet-floor',
    name: 'Wet Floor',
    description: 'Glossy reflective ground, best with Epic quality SSR.',
    patch: { color: '#273241', metalness: 0, roughness: 0.08, emissiveColor: '#000000', emissiveIntensity: 0 },
  },
  {
    id: 'glass',
    name: 'Glass',
    description: 'Real refractive glass (light passes through) — windows, bottles, panels. Best at High/Epic quality.',
    patch: { color: '#EAF6FF', metalness: 0, roughness: 0.03, emissiveColor: '#000000', emissiveIntensity: 0, transmission: 0.95, ior: 1.5, thickness: 0.5 },
  },
  {
    id: 'neon',
    name: 'Neon',
    description: 'Emissive sign/tube material designed to bloom.',
    patch: { color: '#FFFFFF', metalness: 0, roughness: 0.18, emissiveColor: '#31F7FF', emissiveIntensity: 3.2 },
  },
  {
    id: 'rock',
    name: 'Rock',
    description: 'Matte natural stone base.',
    patch: { color: '#6E6A61', metalness: 0, roughness: 0.88, emissiveColor: '#000000', emissiveIntensity: 0 },
  },
  {
    id: 'grass',
    name: 'Grass',
    description: 'Soft matte green for terrain, foliage, and fields.',
    patch: { color: '#4D9B45', metalness: 0, roughness: 0.94, emissiveColor: '#000000', emissiveIntensity: 0 },
  },
  {
    id: 'skin',
    name: 'Skin',
    description: 'Warm low-metal character surface.',
    patch: { color: '#C78A67', metalness: 0, roughness: 0.58, emissiveColor: '#000000', emissiveIntensity: 0 },
  },
  {
    id: 'rubber',
    name: 'Rubber',
    description: 'Dark grippy material for tires, grips, and pads.',
    patch: { color: '#16181D', metalness: 0, roughness: 0.74, emissiveColor: '#000000', emissiveIntensity: 0 },
  },
  {
    id: 'water',
    name: 'Water',
    description: 'Glossy blue water surface; pair with a Water Volume for buoyancy and waves.',
    patch: { color: '#2BA8FF', metalness: 0, roughness: 0.08, emissiveColor: '#0B5C88', emissiveIntensity: 0.08 },
  },
  {
    id: 'car-paint',
    name: 'Car Paint',
    description: 'Glossy automotive paint with a clear lacquer coat — deep color under a sharp reflective layer.',
    patch: { color: '#B11226', metalness: 0.55, roughness: 0.38, emissiveColor: '#000000', emissiveIntensity: 0, clearcoat: 1, clearcoatRoughness: 0.06 },
  },
  {
    id: 'velvet',
    name: 'Velvet / Fabric',
    description: 'Soft cloth with a retroreflective sheen at grazing angles — velvet, satin, upholstery.',
    patch: { color: '#5A1230', metalness: 0, roughness: 0.92, emissiveColor: '#000000', emissiveIntensity: 0, sheen: 1, sheenColor: '#FF8FB0' },
  },
  {
    id: 'gemstone',
    name: 'Gemstone',
    description: 'Faceted refractive gem — high IOR transmission with a touch of iridescence. Best at High/Epic.',
    patch: { color: '#D6F0FF', metalness: 0, roughness: 0, emissiveColor: '#000000', emissiveIntensity: 0, transmission: 0.92, ior: 2.3, thickness: 0.6, iridescence: 0.35 },
  },
];

/** Visual + motion fields a Water Volume style preset overrides (physics buoyancy/drag are left alone). */
export type WaterStylePatch = Partial<
  Pick<
    WaterVolumeComponent,
    | 'shallowColor'
    | 'deepColor'
    | 'opacity'
    | 'reflectivity'
    | 'foam'
    | 'foamColor'
    | 'sparkle'
    | 'emissiveIntensity'
    | 'caustics'
    | 'waveAmplitude'
    | 'waveFrequency'
    | 'waveSpeed'
    | 'flowAngle'
    | 'flowStrength'
  >
>;

export interface WaterStyleDef {
  id: WaterStylePreset;
  name: string;
  description: string;
  patch: WaterStylePatch;
}

/** Ready-made water looks. Picking one in the inspector (or via the AI) stamps these onto the volume. */
export const WATER_STYLE_PRESETS: WaterStyleDef[] = [
  {
    id: 'ocean',
    name: 'Ocean',
    description: 'Deep rolling sea — big swell, strong reflections, crest foam.',
    patch: {
      shallowColor: '#4FD2E8',
      deepColor: '#0A3A66',
      opacity: 0.86,
      reflectivity: 0.7,
      foam: 0.6,
      foamColor: '#EAF6FF',
      sparkle: 0.7,
      emissiveIntensity: 0,
      caustics: 0.3,
      waveAmplitude: 0.4,
      waveFrequency: 0.4,
      waveSpeed: 1.6,
    },
  },
  {
    id: 'pool',
    name: 'Pool / Clear',
    description: 'Calm, very transparent light cyan with gentle ripples and bright caustics.',
    patch: {
      shallowColor: '#7FE9FF',
      deepColor: '#1C8FBF',
      opacity: 0.5,
      reflectivity: 0.45,
      foam: 0.12,
      foamColor: '#FFFFFF',
      sparkle: 0.85,
      emissiveIntensity: 0,
      caustics: 0.8,
      waveAmplitude: 0.08,
      waveFrequency: 0.9,
      waveSpeed: 1.0,
    },
  },
  {
    id: 'lake',
    name: 'Lake / River',
    description: 'Soft calm green-blue inland water with subtle waves and light foam.',
    patch: {
      shallowColor: '#5FC9B0',
      deepColor: '#15564F',
      opacity: 0.8,
      reflectivity: 0.5,
      foam: 0.25,
      foamColor: '#E6FFF6',
      sparkle: 0.45,
      emissiveIntensity: 0,
      caustics: 0.35,
      waveAmplitude: 0.16,
      waveFrequency: 0.5,
      waveSpeed: 1.1,
    },
  },
  {
    id: 'toxic',
    name: 'Toxic Sludge',
    description: 'Murky glowing green hazard — thick slow waves, faint emissive shimmer.',
    patch: {
      shallowColor: '#9BFF45',
      deepColor: '#15401A',
      opacity: 0.92,
      reflectivity: 0.3,
      foam: 0.35,
      foamColor: '#D6FF8F',
      sparkle: 0.35,
      emissiveIntensity: 0.7,
      caustics: 0.5,
      waveAmplitude: 0.18,
      waveFrequency: 0.35,
      waveSpeed: 0.7,
    },
  },
  {
    id: 'lava',
    name: 'Lava',
    description: 'Glowing molten rock — slow heavy swell, hot emissive glow, no reflection.',
    patch: {
      shallowColor: '#FFD23F',
      deepColor: '#7A1500',
      opacity: 1,
      reflectivity: 0.12,
      foam: 0.2,
      foamColor: '#FF7B2E',
      sparkle: 0.2,
      emissiveIntensity: 1.5,
      caustics: 0.6,
      waveAmplitude: 0.22,
      waveFrequency: 0.28,
      waveSpeed: 0.45,
    },
  },
];

/** Visual/wave fields a style preset (or a manual edit) governs — used to flag a volume 'custom'. */
export const WATER_LOOK_KEYS = [
  'shallowColor',
  'deepColor',
  'opacity',
  'reflectivity',
  'foam',
  'foamColor',
  'sparkle',
  'emissiveIntensity',
  'caustics',
  'waveAmplitude',
  'waveFrequency',
  'waveSpeed',
  'flowAngle',
  'flowStrength',
  'rainStrength',
] as const;

/** The visual patch for a named water style ({} for 'custom' or unknown ids). */
export function waterStylePatch(style: WaterStylePreset): WaterStylePatch {
  return WATER_STYLE_PRESETS.find((preset) => preset.id === style)?.patch ?? {};
}

export const LIGHTING_PRESETS: LightingPreset[] = [
  {
    id: 'sunny',
    name: 'Sunny',
    description: 'Clear bright daylight with crisp shadows.',
    environment: {
      skyMode: 'procedural',
      backgroundColor: '#86B9FF',
      skyTopColor: '#4F95FF',
      skyHorizonColor: '#F7D08A',
      skyGroundColor: '#CFE7FF',
      environmentIntensity: 1.15,
      sunColor: '#FFF1C2',
      sunIntensity: 1.55,
      sunAzimuth: 42,
      sunElevation: 48,
      fogEnabled: true,
      fogColor: '#BFD9FF',
      fogNear: 70,
      fogFar: 180,
    },
    renderSettings: { quality: 'High', bloomEnabled: true, bloomIntensity: 0.45, bloomThreshold: 0.82, bloomRadius: 0.38, vignetteEnabled: false },
    colorGrade: { grade: 'warm', gradeIntensity: 0.25, exposure: 0.04, contrast: 0.03, saturation: 0.08 },
  },
  {
    id: 'overcast',
    name: 'Overcast',
    description: 'Soft cloudy light with gentle fog and low contrast.',
    environment: {
      skyMode: 'procedural',
      backgroundColor: '#7C8796',
      skyTopColor: '#7B8797',
      skyHorizonColor: '#BAC2CC',
      skyGroundColor: '#697383',
      environmentIntensity: 1.05,
      sunColor: '#DDE5EE',
      sunIntensity: 0.55,
      sunAzimuth: 18,
      sunElevation: 56,
      fogEnabled: true,
      fogColor: '#AEB7C2',
      fogNear: 18,
      fogFar: 85,
    },
    renderSettings: { quality: 'Medium', bloomEnabled: false, bloomIntensity: 0.25, bloomThreshold: 0.9, bloomRadius: 0.35, vignetteEnabled: false },
    colorGrade: { grade: 'cool', gradeIntensity: 0.28, exposure: -0.02, contrast: -0.04, saturation: -0.12 },
  },
  {
    id: 'night',
    name: 'Night',
    description: 'Moonlit blue darkness with strong bloom for lamps.',
    environment: {
      skyMode: 'procedural',
      backgroundColor: '#050812',
      skyTopColor: '#071021',
      skyHorizonColor: '#172A4A',
      skyGroundColor: '#03050A',
      environmentIntensity: 0.42,
      sunColor: '#8FB6FF',
      sunIntensity: 0.38,
      sunAzimuth: 220,
      sunElevation: 24,
      fogEnabled: true,
      fogColor: '#07101E',
      fogNear: 12,
      fogFar: 65,
      volumetricFogEnabled: true,
      volumetricFogDensity: 0.05,
      volumetricFogColor: '#0B1626',
      volumetricFogHeight: 0,
      volumetricFogFalloff: 0.07,
      volumetricScattering: 0.6,
      volumetricSunStrength: 0.7,
      volumetricMaxDistance: 75,
    },
    renderSettings: { quality: 'High', bloomEnabled: true, bloomIntensity: 1.05, bloomThreshold: 0.48, bloomRadius: 0.72, vignetteEnabled: true },
    colorGrade: { grade: 'cool', gradeIntensity: 0.55, exposure: -0.12, contrast: 0.12, saturation: -0.08 },
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk',
    description: 'Neon nightlife with saturated glow and glossy surfaces.',
    environment: {
      skyMode: 'procedural',
      backgroundColor: '#060611',
      skyTopColor: '#130B2F',
      skyHorizonColor: '#0B6C91',
      skyGroundColor: '#120817',
      environmentIntensity: 0.8,
      sunColor: '#8C6BFF',
      sunIntensity: 0.28,
      sunAzimuth: 300,
      sunElevation: 16,
      fogEnabled: true,
      fogColor: '#12112A',
      fogNear: 10,
      fogFar: 58,
      volumetricFogEnabled: true,
      volumetricFogDensity: 0.07,
      volumetricFogColor: '#171433',
      volumetricFogHeight: 0,
      volumetricFogFalloff: 0.06,
      volumetricScattering: 0.55,
      volumetricSunStrength: 0.8,
      volumetricMaxDistance: 70,
    },
    renderSettings: { quality: 'Epic', bloomEnabled: true, bloomIntensity: 1.45, bloomThreshold: 0.34, bloomRadius: 0.78, vignetteEnabled: true },
    colorGrade: { grade: 'teal-orange', gradeIntensity: 0.72, exposure: 0.02, contrast: 0.18, saturation: 0.26, tint: '#35E8FF', tintAmount: 0.08 },
  },
  {
    id: 'indoor',
    name: 'Indoor',
    description: 'Neutral studio/interior light with minimal fog.',
    environment: {
      skyMode: 'color',
      backgroundColor: '#11151D',
      environmentIntensity: 0.82,
      sunColor: '#FFE3B5',
      sunIntensity: 0.48,
      sunAzimuth: 30,
      sunElevation: 62,
      fogEnabled: false,
      fogColor: '#11151D',
      fogNear: 30,
      fogFar: 120,
    },
    renderSettings: { quality: 'High', bloomEnabled: true, bloomIntensity: 0.55, bloomThreshold: 0.72, bloomRadius: 0.44, vignetteEnabled: true },
    colorGrade: { grade: 'warm', gradeIntensity: 0.22, exposure: 0, contrast: 0.06, saturation: 0.02 },
  },
  {
    id: 'cinematic',
    name: 'Cinematic',
    description: 'Golden low sun, mist, bloom, vignette, and film contrast.',
    environment: {
      skyMode: 'procedural',
      backgroundColor: '#1B1420',
      skyTopColor: '#26345C',
      skyHorizonColor: '#F0A15D',
      skyGroundColor: '#140C13',
      environmentIntensity: 0.9,
      sunColor: '#FFB45B',
      sunIntensity: 1.25,
      sunAzimuth: 60,
      sunElevation: 18,
      fogEnabled: true,
      fogColor: '#2A1D24',
      fogNear: 12,
      fogFar: 72,
      volumetricFogEnabled: true,
      volumetricFogDensity: 0.055,
      volumetricFogColor: '#3A2A30',
      volumetricFogHeight: 2,
      volumetricFogFalloff: 0.05,
      volumetricScattering: 0.8,
      volumetricSunStrength: 1.6,
      volumetricMaxDistance: 95,
    },
    renderSettings: { quality: 'Epic', bloomEnabled: true, bloomIntensity: 0.9, bloomThreshold: 0.58, bloomRadius: 0.7, vignetteEnabled: true },
    colorGrade: { grade: 'warm', gradeIntensity: 0.55, exposure: -0.02, contrast: 0.16, saturation: 0.1, tint: '#FFB26B', tintAmount: 0.1 },
  },
  {
    id: 'godrays',
    name: 'God Rays',
    description: 'Low hazy sun with strong volumetric light shafts — the Unreal-style beam look.',
    environment: {
      skyMode: 'procedural',
      backgroundColor: '#A9C2E8',
      skyTopColor: '#3E78D0',
      skyHorizonColor: '#FFE0A8',
      skyGroundColor: '#9FB6CC',
      environmentIntensity: 0.85,
      sunColor: '#FFE6B0',
      sunIntensity: 1.4,
      sunAzimuth: 135,
      // Low sun so the beams rake across the scene and catch geometry edges.
      sunElevation: 11,
      fogEnabled: true,
      fogColor: '#DDE8F5',
      fogNear: 20,
      fogFar: 120,
      volumetricFogEnabled: true,
      volumetricFogDensity: 0.13,
      volumetricFogColor: '#E6EEFA',
      volumetricFogHeight: 0,
      volumetricFogFalloff: 0.02,
      // Strong forward scattering + sun strength = pronounced shafts toward the sun.
      volumetricScattering: 0.82,
      volumetricSunStrength: 2.4,
      volumetricMaxDistance: 160,
    },
    // High/Epic both render shafts; Epic gives the crispest shadow sampling.
    renderSettings: { quality: 'Epic', bloomEnabled: true, bloomIntensity: 0.8, bloomThreshold: 0.6, bloomRadius: 0.6, vignetteEnabled: true },
    colorGrade: { grade: 'warm', gradeIntensity: 0.3, exposure: 0.03, contrast: 0.08, saturation: 0.06 },
  },
];

export const materialPresetIds = MATERIAL_PRESETS.map((preset) => preset.id) as [MaterialPresetId, ...MaterialPresetId[]];
export const lightingPresetIds = LIGHTING_PRESETS.map((preset) => preset.id) as [LightingPresetId, ...LightingPresetId[]];

export const findMaterialPreset = (id: MaterialPresetId) => MATERIAL_PRESETS.find((preset) => preset.id === id);
export const findLightingPreset = (id: LightingPresetId) => LIGHTING_PRESETS.find((preset) => preset.id === id);
