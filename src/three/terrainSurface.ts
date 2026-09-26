import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useEditorStore } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import type { TerrainComponent } from '../types';
import { resolveAssetItemUrl } from './ModelAsset';

const MAX_TERRAIN_LAYERS = 8;


interface TerrainSurfaceState {
  albedoAtlas: THREE.DataArrayTexture;
  normalAtlas: THREE.DataArrayTexture;
  layerColors: THREE.Color[];
  textureScales: number[];
  textureVariations: number[];
  normalStrengths: number[];
  hasNormals: number[];
  roughnesses: number[];
  layerCount: number;
  shaders: Set<THREE.WebGLProgramParametersWithUniforms>;
}

function createAtlas(normal: boolean, size: number, count: number) {
  const data = new Uint8Array(size * size * count * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i + 1] = normal ? 128 : 255;
    data[i + 2] = data[i + 3] = 255;
  }
  // WebGL2 arrays have isolated mip chains for every layer, including the distant 1x1 mip.
  const texture = new THREE.DataArrayTexture(data, size, size, count);
  texture.colorSpace = normal ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function loadImage(url: string): Promise<{ image: HTMLImageElement; objectUrl?: string }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    if (/^https?:/i.test(url)) image.crossOrigin = 'anonymous';
    image.onload = () => resolve({ image });
    image.onerror = async () => {
      try {
        // Tauri asset URLs occasionally fail as direct image sources. Fetching them into a blob mirrors
        // the engine's robust model-material texture fallback and also handles escaped desktop paths.
        const response = await fetch(url);
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        const objectUrl = URL.createObjectURL(await response.blob());
        const fallback = new Image();
        fallback.onload = () => resolve({ image: fallback, objectUrl });
        fallback.onerror = () => {
          URL.revokeObjectURL(objectUrl);
          reject(new Error(`Unable to decode terrain texture ${url}`));
        };
        fallback.src = objectUrl;
      } catch (error) {
        reject(error);
      }
    };
    image.src = url;
  });
}

function paintAtlasCell(texture: THREE.DataArrayTexture, index: number, image?: CanvasImageSource, normal = false) {
  const SURFACE_SIZE = texture.image.width;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SURFACE_SIZE;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.fillStyle = normal ? 'rgb(128,128,255)' : '#ffffff';
  context.fillRect(0, 0, SURFACE_SIZE, SURFACE_SIZE);
  if (image) context.drawImage(image, 0, 0, SURFACE_SIZE, SURFACE_SIZE);
  const pixels = context.getImageData(0, 0, SURFACE_SIZE, SURFACE_SIZE).data;
  const target = texture.image.data as Uint8Array;
  const row = SURFACE_SIZE * 4, offset = index * SURFACE_SIZE * row;
  // Array textures cannot use UNPACK_FLIP_Y_WEBGL. Store conventional UV bottom-to-top rows here.
  for (let y = 0; y < SURFACE_SIZE; y++) target.set(pixels.subarray(y * row, (y + 1) * row), offset + (SURFACE_SIZE - y - 1) * row);
  texture.addLayerUpdate(index);
  texture.needsUpdate = true;
}

const shaderHeader = /* glsl */ `
  attribute vec4 terrainWeightsA;
  attribute vec4 terrainWeightsB;
  varying vec3 vTerrainLocalPosition;
  varying vec3 vTerrainLocalNormal;
  varying vec4 vTerrainWeightsA;
  varying vec4 vTerrainWeightsB;
`;

const fragmentHeader = /* glsl */ `
  varying vec3 vTerrainLocalPosition;
  varying vec3 vTerrainLocalNormal;
  varying vec4 vTerrainWeightsA;
  varying vec4 vTerrainWeightsB;
  uniform highp sampler2DArray terrainAlbedoAtlas;
  uniform highp sampler2DArray terrainNormalAtlas;
  uniform vec3 terrainLayerColors[8];
  uniform float terrainTextureScales[8];
  uniform float terrainTextureVariations[8];
  uniform float terrainNormalStrengths[8];
  uniform float terrainHasNormals[8];
  uniform float terrainRoughnesses[8];
  uniform int terrainLayerCount;
  uniform mat3 normalMatrix;

  float terrainWeight(int index) {
    if (index == 0) return vTerrainWeightsA.x;
    if (index == 1) return vTerrainWeightsA.y;
    if (index == 2) return vTerrainWeightsA.z;
    if (index == 3) return vTerrainWeightsA.w;
    if (index == 4) return vTerrainWeightsB.x;
    if (index == 5) return vTerrainWeightsB.y;
    if (index == 6) return vTerrainWeightsB.z;
    return vTerrainWeightsB.w;
  }

  vec2 terrainSideUv(vec3 n, float scale) {
    return abs(n.x) > abs(n.z)
      ? vec2(-vTerrainLocalPosition.z * sign(n.x), vTerrainLocalPosition.y) / scale
      : vec2(vTerrainLocalPosition.x * sign(n.z), vTerrainLocalPosition.y) / scale;
  }

  float terrainNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    vec4 h = fract(sin(vec4(dot(i, vec2(127.1, 311.7)), dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7)),
      dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7)), dot(i + vec2(1.0), vec2(127.1, 311.7)))) * 43758.5453);
    return mix(mix(h.x, h.y, f.x), mix(h.z, h.w, f.x), f.y);
  }

  // Warp one lookup through a slowly varying, continuous phase field. The previous implementation
  // cross-faded two translated copies of the same scan, which visibly doubled blades and erased fine
  // detail around every blend. Color and normal use this identical UV, so their features stay aligned
  // and the signed projection bases below remain valid.
  vec2 terrainStochasticUv(vec2 uv, int index) {
    float variation = terrainTextureVariations[index];
    if (variation < 0.001) return uv;
    vec2 field = uv * 0.19 + vec2(float(index) * 13.7, float(index) * -8.3);
    vec2 phase = vec2(
      terrainNoise(field),
      terrainNoise(field + vec2(19.1, -7.7))
    ) - 0.5;
    return uv + phase * (0.72 * variation);
  }

  vec4 terrainTileSample(highp sampler2DArray layers, int index, vec2 uv) {
    return texture(layers, vec3(terrainStochasticUv(uv, index), float(index)));
  }

  vec4 terrainProjectedSample(highp sampler2DArray layers, int index, float scale) {
    vec3 n = normalize(vTerrainLocalNormal);
    float topBlend = smoothstep(0.45, 0.75, abs(n.y));
    vec4 top = terrainTileSample(layers, index, vTerrainLocalPosition.xz * vec2(1.0, -1.0) / scale);
    vec4 side = terrainTileSample(layers, index, terrainSideUv(n, scale));
    return mix(side, top, topBlend);
  }

  vec3 terrainSurfaceColor() {
    vec3 result = vec3(0.0);
    float total = 0.0;
    for (int i = 0; i < 8; i++) {
      if (i >= terrainLayerCount) break;
      float weight = terrainWeight(i);
      if (weight <= 0.0001) continue;
      vec3 albedo = terrainProjectedSample(terrainAlbedoAtlas, i, terrainTextureScales[i]).rgb;
      // A restrained large-scale value shift breaks repetition without painting obvious dark noise over
      // the scan. Fine contrast remains supplied by the single, unblurred texture lookup above.
      float macro = mix(0.92, 1.06, terrainNoise(vTerrainLocalPosition.xz * 0.052 + float(i) * 11.0));
      albedo *= mix(1.0, macro, terrainTextureVariations[i]);
      result += albedo * terrainLayerColors[i] * weight;
      total += weight;
    }
    return result / max(total, 0.0001);
  }

  float terrainSurfaceRoughness() {
    float result = 0.0;
    float total = 0.0;
    for (int i = 0; i < 8; i++) {
      if (i >= terrainLayerCount) break;
      float weight = terrainWeight(i);
      result += terrainRoughnesses[i] * weight;
      total += weight;
    }
    return result / max(total, 0.0001);
  }

  vec3 terrainMappedNormal() {
    vec3 geometric = normalize(vTerrainLocalNormal);
    vec3 result = vec3(0.0);
    float total = 0.0;
    for (int i = 0; i < 8; i++) {
      if (i >= terrainLayerCount) break;
      float weight = terrainWeight(i);
      if (weight <= 0.0001) continue;
      if (terrainHasNormals[i] < 0.5) {
        result += geometric * weight;
        total += weight;
        continue;
      }
      float scale = terrainTextureScales[i];
      vec3 topMap = terrainTileSample(terrainNormalAtlas, i, vTerrainLocalPosition.xz * vec2(1.0, -1.0) / scale).xyz * 2.0 - 1.0;
      vec3 sideMap = terrainTileSample(terrainNormalAtlas, i, terrainSideUv(geometric, scale)).xyz * 2.0 - 1.0;
      topMap.xy *= terrainNormalStrengths[i]; sideMap.xy *= terrainNormalStrengths[i];
      topMap = normalize(topMap); sideMap = normalize(sideMap);
      float topBlend = smoothstep(0.45, 0.75, abs(geometric.y));
      // Explicit right-handed bases match the signed UVs: top T=+X/B=-Z/N=+Y,
      // side X T=-sign(X)Z/B=+Y; side Z T=sign(Z)X/B=+Y.
      vec3 top = vec3(topMap.x, topMap.z, -topMap.y);
      bool onX = abs(geometric.x) > abs(geometric.z);
      vec3 side = onX ? vec3(sideMap.z * sign(geometric.x), sideMap.y, -sideMap.x * sign(geometric.x))
                     : vec3(sideMap.x * sign(geometric.z), sideMap.y, sideMap.z * sign(geometric.z));
      vec3 sideBase = onX ? vec3(sign(geometric.x), 0.0, 0.0) : vec3(0.0, 0.0, sign(geometric.z));
      result += normalize(geometric + (top - vec3(0.0, 1.0, 0.0)) * topBlend + (side - sideBase) * (1.0 - topBlend)) * weight;
      total += weight;
    }
    return normalize(result / max(total, 0.0001));
  }
`;

function createTerrainMaterial(state: TerrainSurfaceState) {
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, metalness: 0.02 });
  material.onBeforeCompile = (shader) => {
    state.shaders.add(shader);
    shader.uniforms.terrainAlbedoAtlas = { value: state.albedoAtlas };
    shader.uniforms.terrainNormalAtlas = { value: state.normalAtlas };
    shader.uniforms.terrainLayerColors = { value: state.layerColors };
    shader.uniforms.terrainTextureScales = { value: state.textureScales };
    shader.uniforms.terrainTextureVariations = { value: state.textureVariations };
    shader.uniforms.terrainNormalStrengths = { value: state.normalStrengths };
    shader.uniforms.terrainHasNormals = { value: state.hasNormals };
    shader.uniforms.terrainRoughnesses = { value: state.roughnesses };
    shader.uniforms.terrainLayerCount = { value: state.layerCount };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${shaderHeader}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vTerrainLocalPosition = position;
        vTerrainLocalNormal = normal;
        vTerrainWeightsA = terrainWeightsA;
        vTerrainWeightsB = terrainWeightsB;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${fragmentHeader}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        diffuseColor.rgb *= terrainSurfaceColor();`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor *= terrainSurfaceRoughness();`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = normalize(normalMatrix * terrainMappedNormal());`);
  };
  material.customProgramCacheKey = () => 'feather-terrain-surface-array-v5';
  return material;
}

/** One shared two-sampler texture-array material for all chunks of a terrain actor. */
export function useTerrainSurfaceMaterial(terrain: TerrainComponent): THREE.MeshStandardMaterial {
  const assets = useEditorStore((store) => store.assets);
  const projectDir = useProjectStore((store) => store.projectDir);
  const quality = useEditorStore((store) => store.renderSettings.quality);
  const albedoSize = quality === 'Low' || quality === 'Medium' ? 512 : 1024;
  const count = Math.max(1, Math.min(MAX_TERRAIN_LAYERS, terrain.materialLayers.length));
  const state = useMemo<TerrainSurfaceState>(() => ({
    albedoAtlas: createAtlas(false, albedoSize, count),
    normalAtlas: createAtlas(true, 512, count),
    layerColors: Array.from({ length: MAX_TERRAIN_LAYERS }, () => new THREE.Color('#ffffff')),
    textureScales: Array(MAX_TERRAIN_LAYERS).fill(8),
    textureVariations: Array(MAX_TERRAIN_LAYERS).fill(0),
    normalStrengths: Array(MAX_TERRAIN_LAYERS).fill(0),
    hasNormals: Array(MAX_TERRAIN_LAYERS).fill(0),
    roughnesses: Array(MAX_TERRAIN_LAYERS).fill(0.92),
    layerCount: 1,
    shaders: new Set(),
  }), [albedoSize, count]);
  const material = useMemo(() => createTerrainMaterial(state), [state]);
  const layerSignature = JSON.stringify(terrain.materialLayers);
  const resolvedLayers = useMemo(() => terrain.materialLayers.slice(0, MAX_TERRAIN_LAYERS).map((layer) => ({
    layer,
    albedoUrl: resolveAssetItemUrl(assets.find((asset) => asset.id === layer.textureAssetId), projectDir),
    normalUrl: resolveAssetItemUrl(assets.find((asset) => asset.id === layer.normalMapAssetId), projectDir),
    // `layerSignature` keeps foliage-only terrain edits from reloading every surface texture. The current
    // normalized layer array is intentionally read here only when that value signature changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  })), [assets, projectDir, layerSignature]);

  useEffect(() => {
    state.layerCount = Math.max(1, resolvedLayers.length);
    for (let index = 0; index < MAX_TERRAIN_LAYERS; index += 1) {
      const layer = resolvedLayers[index]?.layer;
      state.layerColors[index].set(layer?.color ?? '#ffffff');
      state.textureScales[index] = layer?.textureScale ?? 8;
      state.textureVariations[index] = layer?.textureVariation ?? 0;
      state.normalStrengths[index] = layer?.normalMapAssetId ? (layer.normalStrength ?? 1) : 0;
      state.hasNormals[index] = resolvedLayers[index]?.normalUrl ? 1 : 0;
      state.roughnesses[index] = layer?.roughness ?? 0.92;
    }
    for (const shader of state.shaders) shader.uniforms.terrainLayerCount.value = state.layerCount;
  }, [resolvedLayers, state]);

  useEffect(() => {
    let cancelled = false;
    const objectUrls: string[] = [];
    resolvedLayers.forEach(({ albedoUrl, normalUrl }, index) => {
      paintAtlasCell(state.albedoAtlas, index, undefined, false);
      paintAtlasCell(state.normalAtlas, index, undefined, true);
      if (albedoUrl) loadImage(albedoUrl).then(({ image, objectUrl }) => {
        if (cancelled) {
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          return;
        }
        if (objectUrl) objectUrls.push(objectUrl);
        paintAtlasCell(state.albedoAtlas, index, image, false);
      }).catch((error) => console.warn('Terrain albedo texture load failed:', albedoUrl, error));
      if (normalUrl) loadImage(normalUrl).then(({ image, objectUrl }) => {
        if (cancelled) {
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          return;
        }
        if (objectUrl) objectUrls.push(objectUrl);
        paintAtlasCell(state.normalAtlas, index, image, true);
      }).catch((error) => console.warn('Terrain normal texture load failed:', normalUrl, error));
    });
    for (let index = resolvedLayers.length; index < state.albedoAtlas.image.depth; index += 1) {
      paintAtlasCell(state.albedoAtlas, index, undefined, false);
      paintAtlasCell(state.normalAtlas, index, undefined, true);
    }
    return () => {
      cancelled = true;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [resolvedLayers, state]);

  useEffect(() => () => {
    material.dispose();
    state.albedoAtlas.dispose();
    state.normalAtlas.dispose();
    state.shaders.clear();
  }, [material, state]);

  return material;
}
