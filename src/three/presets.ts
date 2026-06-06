import type { CinematicLook, MaterialDefinition, RenderSettings, SceneEnvironmentSettings } from '../types';

export type MaterialPresetId =
  | 'plastic'
  | 'metal'
  | 'wet-floor'
  | 'glass'
  | 'neon'
  | 'rock'
  | 'grass'
  | 'skin'
  | 'rubber';

export type LightingPresetId = 'sunny' | 'overcast' | 'night' | 'cyberpunk' | 'indoor' | 'cinematic';

export interface MaterialPreset {
  id: MaterialPresetId;
  name: string;
  description: string;
  patch: Pick<MaterialDefinition, 'color' | 'metalness' | 'roughness' | 'emissiveColor' | 'emissiveIntensity'>;
}

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
    description: 'Bright transparent-looking surface for panels and displays.',
    patch: { color: '#BFEAFF', metalness: 0, roughness: 0.02, emissiveColor: '#72D7FF', emissiveIntensity: 0.12 },
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
];

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
    },
    renderSettings: { quality: 'Epic', bloomEnabled: true, bloomIntensity: 0.9, bloomThreshold: 0.58, bloomRadius: 0.7, vignetteEnabled: true },
    colorGrade: { grade: 'warm', gradeIntensity: 0.55, exposure: -0.02, contrast: 0.16, saturation: 0.1, tint: '#FFB26B', tintAmount: 0.1 },
  },
];

export const materialPresetIds = MATERIAL_PRESETS.map((preset) => preset.id) as [MaterialPresetId, ...MaterialPresetId[]];
export const lightingPresetIds = LIGHTING_PRESETS.map((preset) => preset.id) as [LightingPresetId, ...LightingPresetId[]];

export const findMaterialPreset = (id: MaterialPresetId) => MATERIAL_PRESETS.find((preset) => preset.id === id);
export const findLightingPreset = (id: LightingPresetId) => LIGHTING_PRESETS.find((preset) => preset.id === id);
