/** Read only the glTF document. Inspection never needs GPU texture decoding or geometry decompression. */
export interface GltfDocument {
  asset: { version: string; copyright?: string };
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: { name?: string; mesh?: number; skin?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }[];
  meshes?: { primitives: { attributes?: Record<string, number>; indices?: number; material?: number; mode?: number }[] }[];
  skins?: { joints: number[]; skeleton?: number }[];
  materials?: { name?: string; pbrMetallicRoughness?: { baseColorFactor?: number[]; metallicFactor?: number; roughnessFactor?: number; baseColorTexture?: unknown }; normalTexture?: unknown; emissiveFactor?: number[]; extensions?: { KHR_materials_emissive_strength?: { emissiveStrength?: number } } }[];
  accessors?: { count: number; type?: string; componentType?: number; min?: number[]; max?: number[]; bufferView?: number; byteOffset?: number; sparse?: unknown }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number; extensions?: unknown }[];
  animations?: { name?: string; samplers: { input: number }[] }[];
  buffers?: { uri?: string; byteLength: number }[];
  images?: { uri?: string; mimeType?: string }[];
  textures?: unknown[];
  extensionsUsed?: string[];
}

/** Animation times are ordinary float accessors even when meshes and textures are compressed. */
export function animationTimeMaximum(doc: GltfDocument, source: ArrayBuffer, accessorIndex: number): number | undefined {
  const accessor = doc.accessors?.[accessorIndex];
  if (Number.isFinite(accessor?.max?.[0])) return accessor!.max![0];
  const view = doc.bufferViews?.[accessor?.bufferView ?? -1];
  if (!accessor || accessor.type !== 'SCALAR' || accessor.componentType !== 5126 || accessor.sparse || !view || view.extensions) return undefined;
  const buffer = doc.buffers?.[view.buffer];
  let bytes: Uint8Array | undefined;
  if (buffer?.uri?.startsWith('data:')) {
    const [header, encoded] = buffer.uri.split(',', 2);
    if (!header.endsWith(';base64') || !encoded) return undefined;
    bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
  } else if (buffer && !buffer.uri && view.buffer === 0) {
    const container = new DataView(source);
    if (source.byteLength < 20 || container.getUint32(0, true) !== 0x46546c67) return undefined;
    for (let offset = 12; offset + 8 <= source.byteLength;) {
      const length = container.getUint32(offset, true);
      if (offset + 8 + length > source.byteLength) return undefined;
      if (container.getUint32(offset + 4, true) === 0x004e4942) { bytes = new Uint8Array(source, offset + 8, length); break; }
      offset += 8 + length;
    }
  }
  if (!bytes) return undefined;
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const stride = view.byteStride ?? 4;
  const end = start + Math.max(0, accessor.count - 1) * stride + 4;
  if (accessor.count < 1 || stride < 4 || start < 0 || end > bytes.length || end > (view.byteOffset ?? 0) + view.byteLength) return undefined;
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let maximum = 0;
  for (let index = 0; index < accessor.count; index++) {
    const time = data.getFloat32(start + index * stride, true);
    if (!Number.isFinite(time) || time < 0) return undefined;
    maximum = Math.max(maximum, time);
  }
  return maximum;
}

export function readModelDocument(buffer: ArrayBuffer): GltfDocument {
  const view = new DataView(buffer);
  let json: string;
  if (buffer.byteLength >= 4 && view.getUint32(0, true) === 0x46546c67) {
    if (buffer.byteLength < 20 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== buffer.byteLength) throw new Error('Invalid GLB header or truncated file.');
    const length = view.getUint32(12, true);
    if (view.getUint32(16, true) !== 0x4e4f534a || length % 4 || length > buffer.byteLength - 20) throw new Error('Invalid GLB JSON chunk.');
    json = new TextDecoder().decode(new Uint8Array(buffer, 20, length));
  } else json = new TextDecoder().decode(buffer);
  const doc = JSON.parse(json.trim()) as GltfDocument;
  if (!doc || doc.asset?.version !== '2.0') throw new Error('Use a glTF 2.0 or GLB 2.0 model.');
  for (const key of ['nodes', 'scenes', 'meshes', 'skins', 'accessors', 'animations', 'materials', 'buffers', 'images'] as const) {
    if (doc[key] !== undefined && !Array.isArray(doc[key])) throw new Error(`Invalid glTF ${key} list.`);
  }
  return doc;
}

export function documentToGlb(doc: GltfDocument): ArrayBuffer {
  const json = new TextEncoder().encode(JSON.stringify(doc));
  const padded = Math.ceil(json.length / 4) * 4;
  const result = new ArrayBuffer(20 + padded);
  const view = new DataView(result);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, result.byteLength, true);
  view.setUint32(12, padded, true); view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(result, 20).fill(32); new Uint8Array(result, 20, json.length).set(json);
  return result;
}

/** Pack selected glTF sidecars into data URIs so save/export cannot lose relative textures or buffers. */
export async function packGltfFile(file: File, siblings: File[]): Promise<File> {
  const doc = readModelDocument(await file.arrayBuffer());
  for (const entry of [...(doc.buffers ?? []), ...(doc.images ?? [])]) {
    if (!entry.uri || entry.uri.startsWith('data:')) continue;
    const uri = decodeURIComponent(entry.uri).replace(/\\/g, '/');
    const exact = siblings.filter((candidate) => (candidate.webkitRelativePath || candidate.name) === uri);
    const matching = exact.length ? exact : siblings.filter((candidate) => candidate.name === uri.split('/').at(-1));
    if (matching.length !== 1) throw new Error(`${matching.length ? 'Ambiguous' : 'Missing'} glTF file "${entry.uri}". Select the model together with its buffers and texture images.`);
    const source = matching[0];
    const bytes = new Uint8Array(await source.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    const mime = source.type || (/\.png$/i.test(source.name) ? 'image/png' : /\.jpe?g$/i.test(source.name) ? 'image/jpeg' : /\.webp$/i.test(source.name) ? 'image/webp' : /\.ktx2$/i.test(source.name) ? 'image/ktx2' : 'application/octet-stream');
    entry.uri = `data:${mime};base64,${btoa(binary)}`;
  }
  return new File([documentToGlb(doc)], file.name.replace(/\.gltf$/i, '.glb'), { type: 'model/gltf-binary' });
}
