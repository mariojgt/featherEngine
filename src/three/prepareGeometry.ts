import { MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import { readModelDocument, type GltfDocument } from './modelDocument';

export const PREPARED_GEOMETRY_EXTENSION = 'FEATHER_mesh_lods';
export const GEOMETRY_COOK_VERSION = 1;
export type AssetPreset = 'desktop' | 'web' | 'mobile';
export const GEOMETRY_PRESETS = {
  desktop: { ratios: [0.5, 0.2], error: 0.015 },
  web: { ratios: [0.4, 0.12], error: 0.03 },
  mobile: { ratios: [0.3, 0.08], error: 0.05 },
} as const;
export interface PreparedLods { version: number; preset: AssetPreset; indices: number[]; errors: number[] }
type Primitive = NonNullable<GltfDocument['meshes']>[number]['primitives'][number] & { targets?: unknown[]; extensions?: Record<string, unknown> };
export interface GeometryPreparation { bytes: Uint8Array; meshes: number; trianglesBefore: number; trianglesLod1: number; trianglesLod2: number; warnings: string[] }

function binaryChunk(source: ArrayBuffer): Uint8Array | undefined {
  const view = new DataView(source);
  if (source.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) return;
  for (let offset = 12; offset + 8 <= source.byteLength;) {
    const length = view.getUint32(offset, true);
    if (offset + length + 8 > source.byteLength || length % 4) throw new Error('Truncated GLB binary chunk.');
    if (view.getUint32(offset + 4, true) === 0x004e4942) return new Uint8Array(source, offset + 8, length);
    offset += length + 8;
  }
}

function toGlb(doc: GltfDocument, binary?: Uint8Array): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(doc)), jsonLength = Math.ceil(json.length / 4) * 4;
  const binaryLength = binary ? Math.ceil(binary.length / 4) * 4 : 0;
  const result = new Uint8Array(20 + jsonLength + (binary ? 8 + binaryLength : 0));
  const view = new DataView(result.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, result.length, true);
  view.setUint32(12, jsonLength, true); view.setUint32(16, 0x4e4f534a, true);
  result.fill(32, 20, 20 + jsonLength); result.set(json, 20);
  if (binary) { view.setUint32(20 + jsonLength, binaryLength, true); view.setUint32(24 + jsonLength, 0x004e4942, true); result.set(binary, 28 + jsonLength); }
  return result;
}

/** Discard only generated LOD metadata before texture reserialization, retaining full geometry.
 * The cooker regenerates target LODs after compression, so accessor renumbering cannot break them. */
export function clearPreparedGeometry(input: Uint8Array): Uint8Array {
  const source = input.slice().buffer, doc = readModelDocument(source);
  if (!doc.extensionsUsed?.includes(PREPARED_GEOMETRY_EXTENSION)) return input;
  for (const mesh of doc.meshes ?? []) for (const primitive of mesh.primitives as Primitive[]) {
    if (primitive.extensions) delete primitive.extensions[PREPARED_GEOMETRY_EXTENSION];
  }
  doc.extensionsUsed = doc.extensionsUsed.filter((name) => name !== PREPARED_GEOMETRY_EXTENSION);
  doc.extensionsRequired = doc.extensionsRequired?.filter((name) => name !== PREPARED_GEOMETRY_EXTENSION);
  return toGlb(doc, binaryChunk(source));
}

/** Prepare static triangle primitives while preserving the entire original glTF document and bytes.
 * Rigging, morphs and unsupported encodings retain full geometry. LODs are an optional extension. */
export async function prepareGlbGeometry(input: Uint8Array, preset: AssetPreset): Promise<GeometryPreparation> {
  const source = input.slice().buffer;
  const doc = readModelDocument(source);
  const originalBinary = binaryChunk(source);
  const result: GeometryPreparation = { bytes: input, meshes: 0, trianglesBefore: 0, trianglesLod1: 0, trianglesLod2: 0, warnings: [] };
  if (!GEOMETRY_PRESETS[preset]) throw new Error('Unknown geometry preset.');
  await Promise.all([MeshoptSimplifier.ready, MeshoptDecoder.ready]);
  if (!MeshoptSimplifier.supported) { result.warnings.push('Mesh simplification is unavailable on this device.'); return result; }
  const buffers = (doc.buffers ?? []).map((buffer, index) => {
    if (!buffer.uri) return index === 0 ? originalBinary : undefined;
    if (!/^data:[^,]*;base64,/.test(buffer.uri)) return undefined;
    return Uint8Array.from(atob(buffer.uri.slice(buffer.uri.indexOf(',') + 1)), (c) => c.charCodeAt(0));
  });
  const views = new Map<number, Uint8Array>();
  const readView = (index: number): Uint8Array => {
    const cached = views.get(index); if (cached) return cached;
    const view = doc.bufferViews?.[index];
    if (!view) throw new Error('Missing geometry buffer view.');
    const compressed = (view.extensions as { EXT_meshopt_compression?: { buffer: number; byteOffset?: number; byteLength: number; count: number; byteStride: number; mode: 'ATTRIBUTES' | 'TRIANGLES' | 'INDICES'; filter?: 'NONE' | 'OCTAHEDRAL' | 'QUATERNION' | 'EXPONENTIAL' } } | undefined)?.EXT_meshopt_compression;
    let bytes: Uint8Array;
    if (compressed) {
      const buffer = buffers[compressed.buffer], offset = compressed.byteOffset ?? 0;
      if (!buffer || offset < 0 || offset + compressed.byteLength > buffer.length || compressed.count * compressed.byteStride > 256 * 1024 * 1024) throw new Error('Invalid compressed geometry range.');
      bytes = new Uint8Array(compressed.count * compressed.byteStride);
      MeshoptDecoder.decodeGltfBuffer(bytes, compressed.count, compressed.byteStride, buffer.subarray(offset, offset + compressed.byteLength), compressed.mode, compressed.filter ?? 'NONE');
    } else {
      const buffer = buffers[view.buffer], offset = view.byteOffset ?? 0;
      if (!buffer || offset < 0 || offset + view.byteLength > buffer.length) throw new Error('Geometry has missing or external bytes.');
      bytes = buffer.subarray(offset, offset + view.byteLength);
    }
    views.set(index, bytes); return bytes;
  };
  const accessor = (index: number, position: boolean): Float32Array | Uint32Array => {
    const a = doc.accessors?.[index];
    if (!a || a.sparse || a.bufferView === undefined || !Number.isInteger(a.count) || a.count < 1 || a.count > 10_000_000 || a.type !== (position ? 'VEC3' : 'SCALAR')) throw new Error('Unsupported geometry accessor.');
    const width = a.componentType === 5121 ? 1 : a.componentType === 5123 ? 2 : a.componentType === 5125 || a.componentType === 5126 ? 4 : 0;
    if (!width || (position && a.componentType !== 5126) || (!position && a.componentType === 5126)) throw new Error('Unsupported geometry component format.');
    const bytes = readView(a.bufferView), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const components = position ? 3 : 1, stride = doc.bufferViews![a.bufferView].byteStride ?? width * components, start = a.byteOffset ?? 0;
    if (start < 0 || stride < components * width || start + (a.count - 1) * stride + components * width > bytes.length) throw new Error('Geometry accessor exceeds its buffer.');
    const output = position ? new Float32Array(a.count * 3) : new Uint32Array(a.count);
    for (let n = 0; n < a.count; n++) for (let c = 0; c < components; c++) {
      const offset = start + n * stride + c * width;
      const value = position ? view.getFloat32(offset, true) : width === 1 ? view.getUint8(offset) : width === 2 ? view.getUint16(offset, true) : view.getUint32(offset, true);
      if (!Number.isFinite(value)) throw new Error('Non-finite vertex position.');
      output[n * components + c] = value;
    }
    return output;
  };
  const skinned = new Set((doc.nodes ?? []).filter((n) => n.skin !== undefined).map((n) => n.mesh));
  const additions: Uint8Array[] = [];
  const binaryLength = originalBinary?.length ?? 0;
  let length = binaryLength;
  const indexBuffer = originalBinary ? 0 : (doc.buffers ?? []).length;
  const addIndices = (indices: Uint32Array) => {
    const bytes = new Uint8Array(indices.length * 4), view = new DataView(bytes.buffer);
    indices.forEach((value, i) => view.setUint32(i * 4, value, true));
    const views = doc.bufferViews ??= [], accessors = doc.accessors ??= [];
    const viewIndex = views.push({ buffer: indexBuffer, byteOffset: length, byteLength: bytes.length }) - 1;
    length += bytes.length; additions.push(bytes);
    return accessors.push({ bufferView: viewIndex, componentType: 5125, count: indices.length, type: 'SCALAR' }) - 1;
  };
  for (const [meshIndex, mesh] of (doc.meshes ?? []).entries()) for (const primitive of mesh.primitives as Primitive[]) {
    const count = doc.accessors?.[primitive.indices ?? -1]?.count ?? 0;
    if (skinned.has(meshIndex) || primitive.targets?.length || (primitive.mode ?? 4) !== 4 || count < 1500) continue;
    const prepared = primitive.extensions?.[PREPARED_GEOMETRY_EXTENSION] as PreparedLods | undefined;
    if (prepared?.version === GEOMETRY_COOK_VERSION && prepared.preset === preset) continue;
    if (primitive.extensions?.KHR_draco_mesh_compression) { result.warnings.push(`Mesh ${meshIndex}: Draco geometry retains its original detail.`); continue; }
    try {
      const position = accessor(primitive.attributes?.POSITION ?? -1, true) as Float32Array;
      const indices = accessor(primitive.indices ?? -1, false) as Uint32Array;
      if (indices.length % 3 || indices.some((n) => n >= position.length / 3)) throw new Error('Invalid triangle indices.');
      const config = GEOMETRY_PRESETS[preset];
      const levels = config.ratios.map((ratio) => MeshoptSimplifier.simplify(indices, position, 3, Math.max(3, Math.floor(indices.length * ratio / 3) * 3), config.error, ['LockBorder']));
      if (levels.every(([level]) => level.length >= indices.length * 0.95)) continue;
      primitive.extensions = { ...primitive.extensions, [PREPARED_GEOMETRY_EXTENSION]: {
        version: GEOMETRY_COOK_VERSION, preset,
        indices: levels.map(([level]) => addIndices(level)), errors: levels.map(([, error]) => error),
      } satisfies PreparedLods };
      result.meshes++; result.trianglesBefore += indices.length / 3;
      result.trianglesLod1 += levels[0][0].length / 3; result.trianglesLod2 += levels[1][0].length / 3;
    } catch (error) { result.warnings.push(`Mesh ${meshIndex}: ${error instanceof Error ? error.message : String(error)} Original geometry retained.`); }
  }
  if (!result.meshes) return result;
  doc.extensionsUsed = [...new Set([...(doc.extensionsUsed ?? []), PREPARED_GEOMETRY_EXTENSION])];
  const combined = new Uint8Array(length);
  if (originalBinary) combined.set(originalBinary);
  let offset = binaryLength; for (const addition of additions) { combined.set(addition, offset); offset += addition.length; }
  doc.buffers ??= [];
  if (originalBinary) { doc.buffers[0].byteLength = combined.length; result.bytes = toGlb(doc, combined); }
  else {
    // A JSON-only GLB may already carry embedded data buffers; preserve their indices verbatim.
    let binary = ''; for (let start = 0; start < combined.length; start += 8192) binary += String.fromCharCode(...combined.subarray(start, start + 8192));
    doc.buffers.push({ byteLength: combined.length, uri: `data:application/octet-stream;base64,${btoa(binary)}` });
    result.bytes = toGlb(doc);
  }
  return result;
}
