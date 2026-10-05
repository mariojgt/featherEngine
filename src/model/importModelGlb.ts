import * as THREE from 'three';
import { DRACOLoader, GLTFLoader, type GLTF } from 'three-stdlib';
import { MeshoptDecoder } from 'meshoptimizer';
import { makeId } from '../store/editor/ids';
import { DRACO_DECODER_PATH, extendGLTFLoader } from '../three/gltfDecoders';
import { normalizeModelSpec } from './modelSpec';
import {
  MAX_MESH_FACES,
  MAX_MESH_VERTICES,
  compactMesh,
  facesFromTriangles,
  makePolyMesh,
  normalizePolyMesh,
  type Vec3,
} from './polyMesh';
import type { ModelPart, ModelPartMesh, ModelSpec } from '../types';

/**
 * GLB → Model Forge spec. Each glTF mesh (all its primitives merged) becomes one editable `shape:
 * 'mesh'` part whose world transform is baked into its vertices, re-expressed in the part's ±0.5 unit
 * space (position = bbox center, scale = bbox size). Triangles are welded and merged back into quads
 * so imported quad meshes stay quad meshes; material colors become palette slots; source UVs survive
 * as per-corner `faceUVs` with their seams intact.
 *
 * Textures: base-color and normal maps (plus non-default PBR values) come back as project-material
 * descriptors with their ORIGINAL encoded image bytes (read straight from the GLB, no canvas), keyed so
 * the integrator can add the images as assets, create the materials, and set `part.materialId`.
 * Textures are stripped from the glTF before three parses it, so parsing never waits on image decoding.
 *
 * UV orientation: glTF images are top-left origin with V running DOWN (texel row = v·H from the top).
 * We store V-up UVs (`v_up = 1 - v`) and the viewport uploads images with flipY = true, which puts the
 * image's bottom row at t = 0, i.e. texel row from the top = (1 - v_up)·H = v·H — the same texel.
 */

export const MAX_IMPORTED_MESHES = 64;
const MAX_PALETTE = 16;
const FALLBACK_COLOR = '#cccccc';

/** A project material to create; texture fields reference `ImportedModel.textures[].key`. */
export interface ImportedMaterial {
  key: string;
  name: string;
  color: string;
  metalness: number;
  roughness: number;
  emissiveColor: string;
  emissiveIntensity: number;
  baseColorTextureKey?: string;
  normalTextureKey?: string;
}

export interface ImportedTexture {
  key: string;
  file: File;
}

export interface ImportedModel {
  spec: ModelSpec;
  warnings: string[];
  /** Image files to add as project assets (original PNG/JPEG/WebP bytes), keyed by a local texture key. */
  textures: ImportedTexture[];
  /** Project materials to create; the integrator swaps texture keys for real asset ids. */
  materials: ImportedMaterial[];
  /** part id → material key (set `part.materialId` once the material exists). */
  partMaterials: Record<string, string>;
}

interface SourceTriangle {
  corners: [number, number, number];
  slot: number;
  /** glTF material index, -1 for the default material. */
  material: number;
}

// ---------------------------------------------------------------------------------------------
// Raw glTF container access (JSON + BIN chunk) — textures are read and stripped here.
// ---------------------------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
type GltfJson = Record<string, any>;

interface GltfContainer {
  json: GltfJson;
  bin: Uint8Array | null;
  isGlb: boolean;
}

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

function readGltfContainer(buffer: ArrayBuffer): GltfContainer | null {
  try {
    if (buffer.byteLength >= 12) {
      const view = new DataView(buffer);
      if (view.getUint32(0, true) === GLB_MAGIC) {
        const length = Math.min(view.getUint32(8, true), buffer.byteLength);
        let offset = 12;
        let json: GltfJson | null = null;
        let bin: Uint8Array | null = null;
        while (offset + 8 <= length) {
          const chunkLength = view.getUint32(offset, true);
          const chunkType = view.getUint32(offset + 4, true);
          const start = offset + 8;
          if (start + chunkLength > length) break;
          if (chunkType === CHUNK_JSON && !json) {
            json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, start, chunkLength)));
          } else if (chunkType === CHUNK_BIN && !bin) {
            bin = new Uint8Array(buffer, start, chunkLength);
          }
          offset = start + chunkLength;
        }
        return json ? { json, bin, isGlb: true } : null;
      }
    }
    const text = new TextDecoder().decode(new Uint8Array(buffer)).trim();
    if (!text.startsWith('{')) return null;
    return { json: JSON.parse(text), bin: null, isGlb: false };
  } catch {
    return null;
  }
}

const pad4 = (length: number) => (4 - (length % 4)) % 4;

function writeGltfContainer(container: GltfContainer): ArrayBuffer {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(container.json));
  if (!container.isGlb) return jsonBytes.buffer.slice(jsonBytes.byteOffset, jsonBytes.byteOffset + jsonBytes.byteLength) as ArrayBuffer;
  const jsonLength = jsonBytes.byteLength + pad4(jsonBytes.byteLength);
  const bin = container.bin;
  const binLength = bin ? bin.byteLength + pad4(bin.byteLength) : 0;
  const total = 12 + 8 + jsonLength + (bin ? 8 + binLength : 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, CHUNK_JSON, true);
  out.set(jsonBytes, 20);
  out.fill(0x20, 20 + jsonBytes.byteLength, 20 + jsonLength);
  if (bin) {
    const at = 20 + jsonLength;
    view.setUint32(at, binLength, true);
    view.setUint32(at + 4, CHUNK_BIN, true);
    out.set(bin, at + 8);
  }
  return out.buffer;
}

const TEXTURE_EXTENSIONS = new Set([
  'KHR_texture_transform',
  'KHR_texture_basisu',
  'EXT_texture_webp',
  'EXT_texture_avif',
  'MSFT_texture_dds',
]);

/** Remove every texture reference (`*Texture` texture-info objects) from a material definition. */
function stripTextureInfo(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach(stripTextureInfo);
    return;
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const child = record[key];
    if (/Texture$/.test(key) && child && typeof child === 'object' && typeof (child as { index?: unknown }).index === 'number') {
      delete record[key];
    } else {
      stripTextureInfo(child);
    }
  }
}

/** A deep-copied JSON with images/textures/samplers removed, so three never decodes an image. */
function withoutTextures(container: GltfContainer): ArrayBuffer | null {
  const json: GltfJson = JSON.parse(JSON.stringify(container.json));
  if (!json.textures?.length && !json.images?.length) return null;
  delete json.textures;
  delete json.images;
  delete json.samplers;
  stripTextureInfo(json.materials);
  for (const listKey of ['extensionsUsed', 'extensionsRequired']) {
    if (Array.isArray(json[listKey])) {
      json[listKey] = json[listKey].filter((name: string) => !TEXTURE_EXTENSIONS.has(name));
      if (!json[listKey].length) delete json[listKey];
    }
  }
  return writeGltfContainer({ ...container, json });
}

function decodeBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function parseDataUri(uri: string): { mime?: string; bytes: Uint8Array } | null {
  const match = /^data:([^;,]*)((?:;[^;,]*)*?)(;base64)?,(.*)$/s.exec(uri);
  if (!match) return null;
  const payload = match[4];
  const bytes = match[3] ? decodeBase64(payload) : new TextEncoder().encode(decodeURIComponent(payload));
  return { mime: match[1] || undefined, bytes };
}

function sniffImageMime(bytes: Uint8Array): string | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return 'image/webp';
  }
  if (bytes.length >= 4 && bytes[0] === 0xab && bytes[1] === 0x4b && bytes[2] === 0x54 && bytes[3] === 0x58) return 'image/ktx2';
  return undefined;
}

const IMAGE_EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

function bufferBytes(container: GltfContainer, bufferIndex: number): Uint8Array | null {
  const buffer = container.json.buffers?.[bufferIndex];
  if (!buffer) return null;
  if (typeof buffer.uri === 'string') return parseDataUri(buffer.uri)?.bytes ?? null;
  return container.isGlb && bufferIndex === 0 ? container.bin : null;
}

/** The original encoded bytes of a glTF image, or a reason they can't be read. */
function readImage(container: GltfContainer, imageIndex: number): { bytes: Uint8Array; mime: string } | { error: string } {
  const image = container.json.images?.[imageIndex];
  if (!image) return { error: `image ${imageIndex} is missing` };
  let bytes: Uint8Array | null = null;
  let mime: string | undefined = image.mimeType;
  if (typeof image.bufferView === 'number') {
    const view = container.json.bufferViews?.[image.bufferView];
    const source = view ? bufferBytes(container, view.buffer ?? 0) : null;
    if (view && source) {
      const start = view.byteOffset ?? 0;
      if (start + view.byteLength <= source.byteLength) bytes = source.slice(start, start + view.byteLength);
    }
  } else if (typeof image.uri === 'string') {
    if (!image.uri.startsWith('data:')) return { error: `image "${image.uri}" is an external file (pack textures into the .glb)` };
    const parsed = parseDataUri(image.uri);
    if (parsed) {
      bytes = parsed.bytes;
      mime = mime ?? parsed.mime;
    }
  }
  if (!bytes || !bytes.byteLength) return { error: `image ${imageIndex} has no readable data` };
  const sniffed = sniffImageMime(bytes);
  mime = sniffed ?? mime;
  if (!mime || !IMAGE_EXTENSIONS[mime]) return { error: `image ${imageIndex} uses an unsupported format (${mime ?? 'unknown'})` };
  return { bytes, mime };
}

/** UV transform in glTF space (V down): uv' = T · R · S · uv (KHR_texture_transform). */
interface UVTransform {
  offset: [number, number];
  scale: [number, number];
  rotation: number;
}

function readTransform(info: any): UVTransform | null {
  const ext = info?.extensions?.KHR_texture_transform;
  if (!ext) return null;
  const transform: UVTransform = {
    offset: [ext.offset?.[0] ?? 0, ext.offset?.[1] ?? 0],
    scale: [ext.scale?.[0] ?? 1, ext.scale?.[1] ?? 1],
    rotation: ext.rotation ?? 0,
  };
  const identity = transform.offset[0] === 0 && transform.offset[1] === 0 && transform.scale[0] === 1 && transform.scale[1] === 1 && transform.rotation === 0;
  return identity ? null : transform;
}

const sameTransform = (a: UVTransform | null, b: UVTransform | null) => JSON.stringify(a) === JSON.stringify(b);

/** Apply a glTF-space transform to one of our V-up UVs (v_up = 1 - v_gltf on both sides). */
function applyTransform(uv: [number, number], t: UVTransform): [number, number] {
  const c = Math.cos(t.rotation);
  const s = Math.sin(t.rotation);
  const u = uv[0] * t.scale[0];
  const v = (1 - uv[1]) * t.scale[1];
  // Same rotation sense as three's Texture.setUvTransform (what GLTFLoader uses for this extension).
  const u2 = c * u + s * v + t.offset[0];
  const v2 = -s * u + c * v + t.offset[1];
  return [u2, 1 - v2];
}

interface ResolvedMaterial {
  /** Material key when this glTF material is worth a project material. */
  key?: string;
  name: string;
  /** Transform baked into UVs of faces using this material. */
  transform: UVTransform | null;
  textured: boolean;
}

const linearToHex = (rgb: unknown, fallback: string): string => {
  if (!Array.isArray(rgb) || rgb.length < 3) return fallback;
  return `#${new THREE.Color().setRGB(Number(rgb[0]) || 0, Number(rgb[1]) || 0, Number(rgb[2]) || 0, THREE.LinearSRGBColorSpace).getHexString()}`;
};

const safeFileName = (text: string) => text.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'texture';

/** Turns glTF materials into deduped project-material descriptors + image files, on demand. */
class MaterialExtractor {
  readonly textures: ImportedTexture[] = [];
  readonly materials: ImportedMaterial[] = [];
  private readonly resolved = new Map<number, ResolvedMaterial>();
  private readonly imageKeys = new Map<number, string | null>();
  private readonly bySignature = new Map<string, string>();

  constructor(
    private readonly container: GltfContainer | null,
    private readonly modelName: string,
    private readonly warnings: string[],
  ) {}

  resolve(index: number): ResolvedMaterial | undefined {
    if (index < 0 || !this.container) return undefined;
    const cached = this.resolved.get(index);
    if (cached) return cached;
    const def = this.container.json.materials?.[index];
    if (!def) return undefined;
    const name = (typeof def.name === 'string' && def.name.trim()) || `Material ${index + 1}`;
    const pbr = def.pbrMetallicRoughness;
    const label = `material "${name}"`;

    const baseInfo = pbr?.baseColorTexture;
    const normalInfo = def.normalTexture;
    const baseColorTextureKey = baseInfo ? this.textureKey(baseInfo, name, 'basecolor', label) : undefined;
    const normalTextureKey = normalInfo ? this.textureKey(normalInfo, name, 'normal', label) : undefined;

    const unsupported = [
      pbr?.metallicRoughnessTexture && 'metallic-roughness',
      def.occlusionTexture && 'occlusion',
      def.emissiveTexture && 'emissive',
    ].filter(Boolean);
    if (unsupported.length) {
      this.warnings.push(`The ${label} has ${unsupported.join('/')} maps; only base-color and normal maps are imported.`);
    }

    const baseTransform = baseColorTextureKey ? readTransform(baseInfo) : null;
    const normalTransform = normalTextureKey ? readTransform(normalInfo) : null;
    const transform = baseColorTextureKey ? baseTransform : normalTransform;
    if (baseColorTextureKey && normalTextureKey && !sameTransform(baseTransform, normalTransform)) {
      this.warnings.push(`The ${label} uses different texture transforms for its base-color and normal maps; the base-color transform was applied to both.`);
    }

    const color = linearToHex(pbr?.baseColorFactor, '#ffffff');
    // glTF defaults: metallic 1 / roughness 1 when the PBR block omits a factor (matches three's loader).
    const metalness = THREE.MathUtils.clamp(Number(pbr?.metallicFactor ?? 1), 0, 1);
    const roughness = THREE.MathUtils.clamp(Number(pbr?.roughnessFactor ?? 1), 0, 1);
    const emissiveColor = linearToHex(def.emissiveFactor, '#000000');
    const emissive = emissiveColor !== '#000000';
    const emissiveIntensity = emissive ? Number(def.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? 1) : 0;
    const textured = !!(baseColorTextureKey || normalTextureKey);
    const worthKeeping = textured || metalness > 0.1 || roughness < 0.5 || emissive;

    let key: string | undefined;
    if (worthKeeping) {
      const fields = { color, metalness, roughness, emissiveColor, emissiveIntensity, baseColorTextureKey, normalTextureKey };
      const signature = JSON.stringify(fields);
      key = this.bySignature.get(signature);
      if (!key) {
        key = `material-${this.materials.length + 1}`;
        this.bySignature.set(signature, key);
        const entry: ImportedMaterial = {
          key,
          name: (typeof def.name === 'string' && def.name.trim()) || `${this.modelName} Material ${index + 1}`,
          color,
          metalness,
          roughness,
          emissiveColor,
          emissiveIntensity,
        };
        if (baseColorTextureKey) entry.baseColorTextureKey = baseColorTextureKey;
        if (normalTextureKey) entry.normalTextureKey = normalTextureKey;
        this.materials.push(entry);
      }
    }
    const result: ResolvedMaterial = { key, name, transform, textured };
    this.resolved.set(index, result);
    return result;
  }

  private textureKey(info: any, materialName: string, role: string, label: string): string | undefined {
    const json = this.container!.json;
    const texture = json.textures?.[info.index];
    if (!texture) return undefined;
    if ((info.texCoord ?? 0) !== 0 || (info.extensions?.KHR_texture_transform?.texCoord ?? 0) !== 0) {
      this.warnings.push(`The ${label} ${role} map uses a second UV set; it was mapped through the first one.`);
    }
    const source: number | undefined =
      texture.source ?? texture.extensions?.EXT_texture_webp?.source ?? texture.extensions?.KHR_texture_basisu?.source ?? texture.extensions?.EXT_texture_avif?.source;
    if (typeof source !== 'number') {
      this.warnings.push(`Skipped the ${label} ${role} map: it has no image source.`);
      return undefined;
    }
    if (this.imageKeys.has(source)) return this.imageKeys.get(source) ?? undefined;
    const image = readImage(this.container!, source);
    if ('error' in image) {
      this.warnings.push(`Skipped the ${label} ${role} map: ${image.error}.`);
      this.imageKeys.set(source, null);
      return undefined;
    }
    const key = `texture-${this.textures.length + 1}`;
    const fileName = `${safeFileName(this.modelName)}-${safeFileName(materialName)}-${role}.${IMAGE_EXTENSIONS[image.mime]}`;
    const bytes = image.bytes.buffer.slice(image.bytes.byteOffset, image.bytes.byteOffset + image.bytes.byteLength) as ArrayBuffer;
    this.textures.push({ key, file: new File([bytes], fileName, { type: image.mime }) });
    this.imageKeys.set(source, key);
    return key;
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

interface MeshGroup {
  name: string;
  meshes: THREE.Mesh[];
  bounds: THREE.Box3;
}

function parseGlb(data: ArrayBuffer): Promise<GLTF> {
  const loader = new GLTFLoader();
  loader.setDRACOLoader(new DRACOLoader().setDecoderPath(DRACO_DECODER_PATH));
  loader.setMeshoptDecoder(MeshoptDecoder);
  extendGLTFLoader(loader);
  return new Promise((resolve, reject) => {
    loader.parse(data, '', resolve, (error: unknown) => reject(error instanceof Error ? error : new Error(String(error))));
  });
}

const stripExtension = (fileName: string): string => fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '').trim() || 'Imported Model';

const isFile = (value: ArrayBuffer | File): value is File =>
  typeof (value as File).arrayBuffer === 'function' && typeof (value as File).name === 'string';

/** Palette builder: dedupes by hex, caps at 16 colors, maps the overflow to the nearest color. */
class PaletteBuilder {
  readonly colors: string[] = [];
  private readonly rgb: Array<[number, number, number]> = [];
  overflowed = false;

  slotFor(material: THREE.Material | undefined): number {
    const color = (material as THREE.MeshStandardMaterial | undefined)?.color;
    const hex = color instanceof THREE.Color ? `#${color.getHexString()}` : FALLBACK_COLOR;
    const existing = this.colors.indexOf(hex);
    if (existing >= 0) return existing;
    const value = parseInt(hex.slice(1), 16);
    const rgb: [number, number, number] = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
    if (this.colors.length < MAX_PALETTE) {
      this.colors.push(hex);
      this.rgb.push(rgb);
      return this.colors.length - 1;
    }
    this.overflowed = true;
    let best = 0;
    let bestDistance = Infinity;
    this.rgb.forEach((other, index) => {
      const distance = (other[0] - rgb[0]) ** 2 + (other[1] - rgb[1]) ** 2 + (other[2] - rgb[2]) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    return best;
  }
}

/** Group meshes by glTF mesh: a multi-primitive glTF mesh loads as a Group of one Mesh per primitive. */
function collectMeshGroups(gltf: GLTF): MeshGroup[] {
  const associations = (gltf.parser as unknown as { associations?: Map<object, { meshes?: number; primitives?: number }> }).associations;
  const groups = new Map<string, MeshGroup>();
  const order: string[] = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry?.getAttribute('position')) return;
    const parent = mesh.parent;
    const parentRef = parent ? associations?.get(parent) : undefined;
    const ownRef = associations?.get(mesh);
    const merged = !!parent && parentRef?.meshes !== undefined && parentRef.primitives === undefined && ownRef?.primitives !== undefined;
    const key = merged ? parent!.uuid : mesh.uuid;
    let group = groups.get(key);
    if (!group) {
      const name = (merged ? parent!.name : mesh.name) || mesh.name || parent?.name || '';
      group = { name, meshes: [], bounds: new THREE.Box3() };
      groups.set(key, group);
      order.push(key);
    }
    group.meshes.push(mesh);
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    group.bounds.union(mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld));
  });
  return order.map((key) => groups.get(key)!);
}

interface BuiltPart {
  part: ModelPart;
  bounds: { min: Vec3; max: Vec3 };
  /** Project-material key of the part's dominant material, when it is worth one. */
  materialKey?: string;
}

interface PartContext {
  palette: PaletteBuilder;
  warnings: string[];
  /** three material → glTF material index (-1 = default material). */
  materialIndexOf: (material: THREE.Material | undefined) => number;
  extractor: MaterialExtractor;
}

function buildPart(group: MeshGroup, label: string, context: PartContext): BuiltPart | null {
  const { palette, warnings } = context;
  const positions: THREE.Vector3[] = [];
  const uvs: Array<[number, number]> = [];
  const triangles: SourceTriangle[] = [];
  const hasUV = group.meshes.every((mesh) => !!mesh.geometry.getAttribute('uv'));
  const scratch = new THREE.Vector3();

  let triangleTotal = 0;
  for (const mesh of group.meshes) {
    const geometry = mesh.geometry;
    const count = geometry.index ? geometry.index.count : geometry.getAttribute('position').count;
    triangleTotal += Math.floor(count / 3);
  }
  // Every polygon holds at least one triangle and quads hold two, so this bound is exact enough to
  // reject huge meshes before welding them.
  if (triangleTotal > MAX_MESH_FACES * 2) {
    warnings.push(`Skipped "${label}": ${triangleTotal} triangles exceeds the ${MAX_MESH_FACES}-face mesh limit.`);
    return null;
  }

  for (const mesh of group.meshes) {
    const geometry = mesh.geometry;
    const position = geometry.getAttribute('position') as THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
    const uv = geometry.getAttribute('uv') as THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined;
    const base = positions.length;
    for (let i = 0; i < position.count; i += 1) {
      scratch.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      positions.push(scratch.clone());
      // glTF UVs have V running down the image; Model Forge UVs use the three.js primitive convention
      // (V up, textures with flipY), so flip once on the way in.
      if (hasUV && uv) uvs.push([uv.getX(i), 1 - uv.getY(i)]);
    }
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const slots = materials.map((material) => palette.slotFor(material));
    const materialIndices = materials.map((material) => context.materialIndexOf(material));
    const flip = mesh.matrixWorld.determinant() < 0;
    const index = geometry.index;
    const vertexAt = (i: number) => base + (index ? index.getX(i) : i);
    const total = index ? index.count : position.count;
    const ranges = geometry.groups.length
      ? geometry.groups
      : [{ start: 0, count: total, materialIndex: 0 }];
    for (const range of ranges) {
      const slot = slots[range.materialIndex ?? 0] ?? slots[0] ?? palette.slotFor(undefined);
      const material = materialIndices[range.materialIndex ?? 0] ?? materialIndices[0] ?? -1;
      const end = Math.min(total, range.start + range.count);
      for (let i = range.start; i + 2 < end; i += 3) {
        const a = vertexAt(i);
        const b = vertexAt(i + 1);
        const c = vertexAt(i + 2);
        triangles.push({ corners: flip ? [a, c, b] : [a, b, c], slot, material });
      }
    }
  }
  if (!triangles.length || !positions.length) return null;

  // Weld. Position-only ids give the shared topology; position+uv+slot ids decide which triangles may
  // merge into quads, so UV seams and material borders never get merged across.
  const box = new THREE.Box3().setFromPoints(positions);
  const diagonal = box.getSize(new THREE.Vector3()).length();
  const epsilon = Math.max(diagonal * 1e-5, 1e-9);
  const q = (value: number) => Math.round(value / epsilon);
  const positionIds = new Map<string, number>();
  const weldedPositions: Vec3[] = [];
  const rawToPosition = positions.map((p) => {
    const key = `${q(p.x)},${q(p.y)},${q(p.z)}`;
    let id = positionIds.get(key);
    if (id === undefined) {
      id = weldedPositions.length;
      positionIds.set(key, id);
      weldedPositions.push([p.x, p.y, p.z]);
    }
    return id;
  });
  const cornerIds = new Map<string, number>();
  const cornerPosition: number[] = [];
  const cornerUV: Array<[number, number]> = [];
  const cornerSlot: number[] = [];
  const cornerMaterial: number[] = [];
  const cornerPoints: Vec3[] = [];
  const indices: number[] = [];
  for (const triangle of triangles) {
    for (const raw of triangle.corners) {
      const positionId = rawToPosition[raw];
      const uv = hasUV ? uvs[raw] : null;
      const key = `${positionId}|${uv ? `${Math.round(uv[0] * 1e5)},${Math.round(uv[1] * 1e5)}` : ''}|${triangle.slot}|${triangle.material}`;
      let id = cornerIds.get(key);
      if (id === undefined) {
        id = cornerPosition.length;
        cornerIds.set(key, id);
        cornerPosition.push(positionId);
        cornerUV.push(uv ?? [0, 0]);
        cornerSlot.push(triangle.slot);
        cornerMaterial.push(triangle.material);
        cornerPoints.push(weldedPositions[positionId]);
      }
      indices.push(id);
    }
  }

  const cornerFaces = facesFromTriangles(cornerPoints, indices);
  const faces: number[][] = [];
  const faceSlots: number[] = [];
  const faceMaterials: number[] = [];
  const faceUVs: Array<Array<[number, number]>> = [];
  for (const loop of cornerFaces) {
    const mapped = loop.map((corner) => cornerPosition[corner]);
    if (new Set(mapped).size !== mapped.length) continue; // collapsed by the weld
    faces.push(mapped);
    faceSlots.push(cornerSlot[loop[0]]);
    faceMaterials.push(cornerMaterial[loop[0]]);
    faceUVs.push(loop.map((corner) => [cornerUV[corner][0], cornerUV[corner][1]]));
  }
  if (!faces.length) return null;

  // Re-express in unit space around the welded bbox center.
  const min: Vec3 = [box.min.x, box.min.y, box.min.z];
  const max: Vec3 = [box.max.x, box.max.y, box.max.z];
  const center: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const size: Vec3 = [
    Math.max(max[0] - min[0], 1e-3),
    Math.max(max[1] - min[1], 1e-3),
    Math.max(max[2] - min[2], 1e-3),
  ];
  const unitVertices: Vec3[] = weldedPositions.map((p) => [
    (p[0] - center[0]) / size[0],
    (p[1] - center[1]) / size[1],
    (p[2] - center[2]) / size[2],
  ]);

  const slotCounts = new Map<number, number>();
  for (const slot of faceSlots) slotCounts.set(slot, (slotCounts.get(slot) ?? 0) + 1);
  let colorSlot = faceSlots[0];
  let bestCount = -1;
  for (const [slot, count] of slotCounts) {
    if (count > bestCount) {
      bestCount = count;
      colorSlot = slot;
    }
  }

  // Texture material: the glTF material most used by the colorSlot faces (the faces a part material
  // renders on). Its KHR_texture_transform is baked into those faces' UVs.
  const materialCounts = new Map<number, number>();
  faceMaterials.forEach((material, face) => {
    if (faceSlots[face] === colorSlot) materialCounts.set(material, (materialCounts.get(material) ?? 0) + 1);
  });
  let dominant = -1;
  let dominantCount = -1;
  for (const [material, count] of materialCounts) {
    if (count > dominantCount) {
      dominantCount = count;
      dominant = material;
    }
  }
  const resolved = context.extractor.resolve(dominant);
  const materialKey = resolved?.key;
  if (materialKey) {
    if (resolved.textured && !hasUV) {
      warnings.push(`"${label}" has no UVs, so the textures of material "${resolved.name}" cannot map onto it.`);
    }
    if (resolved.transform && hasUV) {
      faceMaterials.forEach((material, face) => {
        if (material === dominant) faceUVs[face] = faceUVs[face].map((uv) => applyTransform(uv, resolved.transform!));
      });
    }
    if (materialCounts.size > 1) {
      warnings.push(
        `"${label}": other materials share material "${resolved.name}"'s color, so their faces also render with it.`,
      );
    }
  }
  const otherKept = [...new Set(faceMaterials)]
    .filter((material) => material !== dominant)
    .map((material) => context.extractor.resolve(material))
    .filter((other): other is ResolvedMaterial => !!other?.key);
  if (otherKept.length) {
    warnings.push(
      `"${label}" uses ${otherKept.length + (materialKey ? 1 : 0)} textured/PBR materials; only one material per part is supported, so ${otherKept
        .map((other) => `"${other.name}"`)
        .join(', ')} kept a flat palette color.`,
    );
  }

  const mesh: ModelPartMesh = compactMesh(
    makePolyMesh(unitVertices, faces, {
      faceSlots: slotCounts.size > 1 ? faceSlots : undefined,
      faceUVs: hasUV ? faceUVs : undefined,
    }),
  );
  if (mesh.vertices.length > MAX_MESH_VERTICES || (mesh.faces?.length ?? 0) > MAX_MESH_FACES) {
    warnings.push(
      `Skipped "${label}": ${mesh.vertices.length} vertices / ${mesh.faces?.length ?? 0} faces exceeds the ${MAX_MESH_VERTICES}-vertex / ${MAX_MESH_FACES}-face mesh limit.`,
    );
    return null;
  }

  return {
    part: {
      id: makeId('part'),
      name: label,
      shape: 'mesh',
      position: center,
      rotation: [0, 0, 0],
      scale: size,
      colorSlot,
      mesh,
    },
    bounds: { min, max },
    materialKey,
  };
}

/**
 * Parse a .glb (binary glTF) into a normalized Model Forge spec. Throws when the file cannot be parsed
 * or holds no usable triangle mesh; recoverable losses (skipped meshes, palette overflow) are reported
 * in `warnings`.
 */
export async function importGlbAsModelSpec(data: ArrayBuffer | File, name?: string): Promise<ImportedModel> {
  const file = isFile(data) ? data : null;
  const buffer = file ? await file.arrayBuffer() : (data as ArrayBuffer);
  const modelName = stripExtension(name ?? file?.name ?? 'Imported Model');
  const container = readGltfContainer(buffer);
  // Parse without textures: images are extracted from the raw container below, and three never has to
  // decode (or wait on) an image.
  const stripped = container ? withoutTextures(container) : null;
  const gltf = await parseGlb(stripped ?? buffer);
  const warnings: string[] = [];
  const associations = (gltf.parser as unknown as { associations?: Map<object, { materials?: number }> }).associations;
  const extractor = new MaterialExtractor(container, modelName, warnings);
  const context: PartContext = {
    palette: new PaletteBuilder(),
    warnings,
    materialIndexOf: (material) => (material ? associations?.get(material)?.materials ?? -1 : -1),
    extractor,
  };

  let groups = collectMeshGroups(gltf);
  if (groups.length > MAX_IMPORTED_MESHES) {
    warnings.push(`The file has ${groups.length} meshes; kept the ${MAX_IMPORTED_MESHES} largest.`);
    const sizeOf = (group: MeshGroup) => (group.bounds.isEmpty() ? 0 : group.bounds.getSize(new THREE.Vector3()).length());
    const keep = new Set([...groups].sort((a, b) => sizeOf(b) - sizeOf(a)).slice(0, MAX_IMPORTED_MESHES));
    groups = groups.filter((group) => keep.has(group));
  }

  const palette = context.palette;
  const built: BuiltPart[] = [];
  groups.forEach((group, index) => {
    const label = group.name.trim() || `Mesh ${index + 1}`;
    const result = buildPart(group, label, context);
    if (result) built.push(result);
  });
  if (!built.length) {
    throw new Error(warnings.length ? `No importable meshes: ${warnings.join(' ')}` : 'The GLB contains no triangle meshes.');
  }
  if (palette.overflowed) {
    warnings.push(`More than ${MAX_PALETTE} material colors; extra colors were mapped to the nearest palette color.`);
  }

  // Sit the whole model on the ground, centered on X/Z — the convention every starter follows.
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const { bounds } of built) {
    for (let k = 0; k < 3; k += 1) {
      min[k] = Math.min(min[k], bounds.min[k]);
      max[k] = Math.max(max[k], bounds.max[k]);
    }
  }
  const offset: Vec3 = [-(min[0] + max[0]) / 2, -min[1], -(min[2] + max[2]) / 2];
  const parts = built.map(({ part }) => ({
    ...part,
    position: [part.position[0] + offset[0], part.position[1] + offset[1], part.position[2] + offset[2]] as Vec3,
  }));

  const raw: ModelSpec = {
    id: makeId('model'),
    name: modelName,
    palette: palette.colors.length ? palette.colors : [FALLBACK_COLOR],
    parts,
    style: { finish: 'smooth', bevel: 0, roughness: 0.6 },
  };
  const spec = normalizeModelSpec(raw);
  // Keep the full polygon payload (faces, slots, UVs) even if spec normalization only knows the
  // legacy triangle form.
  const byId = new Map(parts.map((part) => [part.id, part]));
  spec.parts = spec.parts.map((part) => {
    const source = byId.get(part.id)?.mesh;
    const mesh = source ? normalizePolyMesh(source) : null;
    return mesh && part.shape === 'mesh' ? { ...part, mesh } : part;
  });
  const partMaterials: Record<string, string> = {};
  for (const { part, materialKey } of built) if (materialKey) partMaterials[part.id] = materialKey;
  // Only materials/images some part actually uses go out (secondary materials stay palette colors).
  const usedMaterials = new Set(Object.values(partMaterials));
  const materials = extractor.materials.filter((material) => usedMaterials.has(material.key));
  const usedTextures = new Set(materials.flatMap((material) => [material.baseColorTextureKey, material.normalTextureKey]));
  const textures = extractor.textures.filter((texture) => usedTextures.has(texture.key));
  return { spec, warnings, textures, materials, partMaterials };
}

/** Convenience for file pickers / drag-and-drop: the model is named after the file. */
export function importGlbFile(file: File): Promise<ImportedModel> {
  return importGlbAsModelSpec(file, file.name);
}
