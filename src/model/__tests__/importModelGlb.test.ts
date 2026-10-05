import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFExporter } from 'three-stdlib';
import { deflateSync } from 'node:zlib';
import { importGlbAsModelSpec, importGlbFile } from '../importModelGlb';

// jsdom's Blob has no arrayBuffer(); GLTFExporter (binary) and File inputs need it.
if (typeof Blob.prototype.arrayBuffer !== 'function') {
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

async function buildGlb(): Promise<ArrayBuffer> {
  const scene = new THREE.Scene();
  const red = new THREE.MeshStandardMaterial({ color: '#ff0000' });
  const blue = new THREE.MeshStandardMaterial({ color: '#0000ff' });
  const green = new THREE.MeshStandardMaterial({ color: '#00ff00' });

  const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), red);
  box.name = 'RedBox';
  box.position.set(0, 3, 0); // floating: the importer must drop the model onto the ground
  scene.add(box);

  const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 2, 12), blue);
  cylinder.name = 'BlueCylinder';
  cylinder.position.set(3, 2, 0);
  scene.add(cylinder);

  // Multi-material box: two geometry groups (+X/-X/+Y faces red-ish green, the rest blue).
  const multiGeometry = new THREE.BoxGeometry(2, 0.5, 1);
  multiGeometry.clearGroups();
  multiGeometry.addGroup(0, 18, 0);
  multiGeometry.addGroup(18, 18, 1);
  const multi = new THREE.Mesh(multiGeometry, [green, blue]);
  multi.name = 'TwoToneBox';
  multi.position.set(-3, 2.5, 1);
  scene.add(multi);

  const exporter = new GLTFExporter();
  return (await exporter.parseAsync(scene, { binary: true })) as ArrayBuffer;
}

describe('importGlbAsModelSpec', () => {
  it('round-trips a three.js scene into mesh parts', async () => {
    const glb = await buildGlb();
    const { spec, warnings, textures, materials, partMaterials } = await importGlbAsModelSpec(glb, 'props/test-scene.glb');
    expect(warnings).toEqual([]);
    // Plain colored materials (default PBR) stay palette-only.
    expect(textures).toEqual([]);
    expect(materials).toEqual([]);
    expect(partMaterials).toEqual({});
    expect(spec.name).toBe('test-scene');
    expect(spec.id).toMatch(/^model-/);
    expect(spec.parts).toHaveLength(3);
    expect(spec.parts.every((part) => part.shape === 'mesh' && !!part.mesh)).toBe(true);
    expect(spec.palette).toEqual(expect.arrayContaining(['#ff0000', '#0000ff', '#00ff00']));

    const byName = (name: string) => spec.parts.find((part) => part.name === name)!;
    const box = byName('RedBox');
    expect(box.mesh!.faces).toHaveLength(6);
    expect(box.mesh!.faces!.every((loop) => loop.length === 4)).toBe(true);
    expect(box.mesh!.vertices).toHaveLength(8); // welded, but UV seams kept per corner
    expect(spec.palette[box.colorSlot]).toBe('#ff0000');
    expect(box.scale[0]).toBeCloseTo(1);
    expect(box.scale[1]).toBeCloseTo(1);
    expect(box.mesh!.faceUVs).toHaveLength(6);
    expect(box.mesh!.faceUVs!.every((uvs) => uvs.length === 4)).toBe(true);
    // Each BoxGeometry face carries the full 0..1 square.
    for (const uvs of box.mesh!.faceUVs!) {
      const us = uvs.map((uv) => uv[0]);
      const vs = uvs.map((uv) => uv[1]);
      expect(Math.min(...us)).toBeCloseTo(0);
      expect(Math.max(...us)).toBeCloseTo(1);
      expect(Math.min(...vs)).toBeCloseTo(0);
      expect(Math.max(...vs)).toBeCloseTo(1);
    }
    // Unit space: vertices within ±0.5.
    for (const vertex of box.mesh!.vertices) for (const c of vertex) expect(Math.abs(c)).toBeLessThanOrEqual(0.5 + 1e-6);

    const cylinder = byName('BlueCylinder');
    expect(spec.palette[cylinder.colorSlot]).toBe('#0000ff');
    expect(cylinder.scale[1]).toBeCloseTo(2);
    // The 12 side quads come back as quads (cap fans merge pairwise as facesFromTriangles allows).
    const mesh = cylinder.mesh!;
    const sideQuads = mesh.faces!.filter((loop) => {
      const ys = loop.map((index) => mesh.vertices[index][1]);
      return loop.length === 4 && Math.max(...ys) - Math.min(...ys) > 0.99;
    });
    expect(sideQuads).toHaveLength(12);
    expect(mesh.faces!.every((loop) => loop.length >= 3)).toBe(true);

    const multi = byName('TwoToneBox');
    expect(multi.mesh!.faces).toHaveLength(6);
    const slots = multi.mesh!.faceSlots!;
    expect(slots).toHaveLength(6);
    expect(slots.map((slot) => spec.palette[slot]).sort()).toEqual(['#0000ff', '#0000ff', '#0000ff', '#00ff00', '#00ff00', '#00ff00']);
    expect(multi.scale[0]).toBeCloseTo(2);
    expect(multi.scale[1]).toBeCloseTo(0.5);

    // Grounded and centered on X/Z.
    const minY = Math.min(...spec.parts.map((part) => part.position[1] - part.scale[1] / 2));
    expect(minY).toBeCloseTo(0, 5);
    const minX = Math.min(...spec.parts.map((part) => part.position[0] - part.scale[0] / 2));
    const maxX = Math.max(...spec.parts.map((part) => part.position[0] + part.scale[0] / 2));
    expect(minX + maxX).toBeCloseTo(0, 5);
    // Relative layout preserved: box 3 m above the original ground → its bottom sits at 2.5 - 1.25.
    expect(box.position[1] - cylinder.position[1]).toBeCloseTo(1, 5);
    expect(box.position[0] - cylinder.position[0]).toBeCloseTo(-3, 5);
  });

  it('accepts a File and names the model after it', async () => {
    const glb = await buildGlb();
    const { spec } = await importGlbFile(new File([glb], 'Crate Kit.glb', { type: 'model/gltf-binary' }));
    expect(spec.name).toBe('Crate Kit');
    expect(spec.parts).toHaveLength(3);
  });

  it('rejects garbage data', async () => {
    await expect(importGlbAsModelSpec(new Uint8Array([1, 2, 3, 4]).buffer, 'bad.glb')).rejects.toBeTruthy();
  });
});

// ---------------------------------------------------------------------------------------------
// Textures: a hand-written PNG is injected into an exported GLB (GLTFExporter needs a canvas for
// texture export, which jsdom lacks).
// ---------------------------------------------------------------------------------------------

type RGBA = [number, number, number, number];
const RED: RGBA = [255, 0, 0, 255];
const GREEN: RGBA = [0, 255, 0, 255];
const BLUE: RGBA = [0, 0, 255, 255];
const YELLOW: RGBA = [255, 255, 0, 255];
const SIZE = 4;
/** Image rows top-to-bottom (PNG / glTF order): TL red, TR green, BL blue, BR yellow. */
const CHECKER: RGBA[][] = Array.from({ length: SIZE }, (_, row) =>
  Array.from({ length: SIZE }, (_, col) => (row < SIZE / 2 ? (col < SIZE / 2 ? RED : GREEN) : col < SIZE / 2 ? BLUE : YELLOW)),
);

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  const typed = new Uint8Array(4 + data.length);
  typed.set(new TextEncoder().encode(type), 0);
  typed.set(data, 4);
  out.set(typed, 4);
  view.setUint32(8 + data.length, crc32(typed));
  return out;
}
function encodePng(rows: RGBA[][]): Uint8Array {
  const height = rows.length;
  const width = rows[0].length;
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA, no interlace
  const raw = new Uint8Array(height * (1 + width * 4));
  rows.forEach((row, y) => row.forEach((pixel, x) => raw.set(pixel, y * (1 + width * 4) + 1 + x * 4)));
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', new Uint8Array(deflateSync(raw))),
    pngChunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
interface Glb {
  json: any;
  bin: Uint8Array;
}
function readGlb(buffer: ArrayBuffer): Glb {
  const view = new DataView(buffer);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength)));
  const binAt = 20 + jsonLength;
  const bin = new Uint8Array(buffer, binAt + 8, view.getUint32(binAt, true)).slice();
  return { json, bin };
}
function writeGlb({ json, bin }: Glb): ArrayBuffer {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(jsonBytes.length / 4) * 4;
  const binLength = Math.ceil(bin.length / 4) * 4;
  const out = new Uint8Array(28 + jsonLength + binLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.length, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.fill(0x20, 20, 20 + jsonLength);
  out.set(jsonBytes, 20);
  view.setUint32(20 + jsonLength, binLength, true);
  view.setUint32(24 + jsonLength, 0x004e4942, true);
  out.set(bin, 28 + jsonLength);
  return out.buffer;
}
/** Append bytes to the BIN chunk as a new bufferView; returns its index. */
function appendBufferView(glb: Glb, bytes: Uint8Array): number {
  const offset = Math.ceil(glb.bin.length / 4) * 4;
  const bin = new Uint8Array(offset + bytes.length);
  bin.set(glb.bin, 0);
  bin.set(bytes, offset);
  glb.bin = bin;
  glb.json.buffers[0].byteLength = bin.length;
  glb.json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length });
  return glb.json.bufferViews.length - 1;
}
function readAccessor(glb: Glb, index: number): number[][] {
  const accessor = glb.json.accessors[index];
  const view = glb.json.bufferViews[accessor.bufferView];
  const size = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type as 'SCALAR'];
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const data = glb.bin.buffer.slice(glb.bin.byteOffset + start, glb.bin.byteOffset + start + view.byteLength - (accessor.byteOffset ?? 0));
  expect(accessor.componentType).toBe(5126); // float32, tightly packed (GLTFExporter output)
  const floats = new Float32Array(data, 0, accessor.count * size);
  return Array.from({ length: accessor.count }, (_, i) => Array.from(floats.subarray(i * size, i * size + size)));
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const PNG_BYTES = encodePng(CHECKER);
const fract = (value: number) => value - Math.floor(value);

/** A 1 m box whose single material samples the checker PNG (optionally through KHR_texture_transform). */
async function buildTexturedBoxGlb(transform?: { offset: [number, number]; scale: [number, number] }): Promise<Glb> {
  const scene = new THREE.Scene();
  const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#ffffff', name: 'Crate Wood' }));
  box.name = 'Crate';
  scene.add(box);
  const glb = readGlb((await new GLTFExporter().parseAsync(scene, { binary: true })) as ArrayBuffer);
  const bufferView = appendBufferView(glb, PNG_BYTES);
  glb.json.images = [{ bufferView, mimeType: 'image/png', name: 'checker' }];
  glb.json.samplers = [{ wrapS: 10497, wrapT: 10497 }];
  glb.json.textures = [{ source: 0, sampler: 0 }];
  const info: Record<string, unknown> = { index: 0 };
  if (transform) {
    info.extensions = { KHR_texture_transform: transform };
    glb.json.extensionsUsed = [...(glb.json.extensionsUsed ?? []), 'KHR_texture_transform'];
  }
  glb.json.materials[0].pbrMetallicRoughness.baseColorTexture = info;
  return glb;
}

/** Texel the SOURCE glTF samples: top-left image origin, V down (texel row = v * H). */
function sampleGltf(u: number, v: number): RGBA {
  return CHECKER[Math.floor(fract(v) * SIZE)][Math.floor(fract(u) * SIZE)];
}

/**
 * Texel the VIEWPORT samples for one of our V-up faceUVs: `useAssetTexture(url, true)` uploads with
 * flipY, i.e. the image rows are reversed so texture row 0 (t = 0) is the image's BOTTOM row; GL then
 * reads uploaded row floor(t * H).
 */
function sampleViewport(u: number, vUp: number): RGBA {
  const uploaded = [...CHECKER].reverse();
  return uploaded[Math.floor(fract(vUp) * SIZE)][Math.floor(fract(u) * SIZE)];
}

/** Sample points pulled 25% from each +Y-face corner toward the face center (avoids texel edges). */
function insetSamples(corners: Array<{ key: string; uv: [number, number] }>): Map<string, [number, number]> {
  const center = corners.reduce<[number, number]>((sum, c) => [sum[0] + c.uv[0] / corners.length, sum[1] + c.uv[1] / corners.length], [0, 0]);
  return new Map(corners.map((c) => [c.key, [c.uv[0] + (center[0] - c.uv[0]) * 0.25, c.uv[1] + (center[1] - c.uv[1]) * 0.25]]));
}

/** Source side: +Y-face corners (keyed by their X/Z sign) with their glTF UVs (+ transform). */
function sourceTopSamples(glb: Glb, transform?: { offset: [number, number]; scale: [number, number] }): Map<string, RGBA> {
  const primitive = glb.json.meshes[0].primitives[0];
  const positions = readAccessor(glb, primitive.attributes.POSITION);
  const normals = readAccessor(glb, primitive.attributes.NORMAL);
  const uvs = readAccessor(glb, primitive.attributes.TEXCOORD_0);
  const corners = positions
    .map((p, i) => ({ p, n: normals[i], uv: uvs[i] as [number, number] }))
    .filter(({ n }) => n[1] > 0.99)
    .map(({ p, uv }) => ({ key: `${Math.sign(p[0])},${Math.sign(p[2])}`, uv }));
  expect(corners).toHaveLength(4);
  const out = new Map<string, RGBA>();
  for (const [key, [u, v]] of insetSamples(corners)) {
    const tu = transform ? u * transform.scale[0] + transform.offset[0] : u;
    const tv = transform ? v * transform.scale[1] + transform.offset[1] : v;
    out.set(key, sampleGltf(tu, tv));
  }
  return out;
}

/** Imported side: the box part's +Y face corners and faceUVs, sampled the way the viewport does. */
function importedTopSamples(part: { mesh?: { vertices: number[][]; faces?: number[][]; faceUVs?: Array<Array<[number, number]>> } }): Map<string, RGBA> {
  const mesh = part.mesh!;
  const faceIndex = mesh.faces!.findIndex((loop) => loop.every((index) => mesh.vertices[index][1] > 0.49));
  expect(faceIndex).toBeGreaterThanOrEqual(0);
  const loop = mesh.faces![faceIndex];
  const corners = loop.map((index, corner) => {
    const p = mesh.vertices[index];
    return { key: `${Math.sign(p[0])},${Math.sign(p[2])}`, uv: mesh.faceUVs![faceIndex][corner] };
  });
  const out = new Map<string, RGBA>();
  for (const [key, [u, v]] of insetSamples(corners)) out.set(key, sampleViewport(u, v));
  return out;
}

describe('importGlbAsModelSpec textures', () => {
  it('extracts the base-color PNG and a project material for the textured part', async () => {
    const glb = await buildTexturedBoxGlb();
    const { spec, warnings, textures, materials, partMaterials } = await importGlbAsModelSpec(writeGlb(glb), 'Crate.glb');
    expect(warnings).toEqual([]);
    expect(spec.parts).toHaveLength(1);

    expect(textures).toHaveLength(1);
    const [texture] = textures;
    expect(texture.file.type).toBe('image/png');
    expect(texture.file.name).toBe('Crate-Crate-Wood-basecolor.png');
    const bytes = new Uint8Array(await texture.file.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(0);
    expect(Array.from(bytes)).toEqual(Array.from(PNG_BYTES)); // original encoded bytes, untouched

    expect(materials).toHaveLength(1);
    expect(materials[0]).toMatchObject({ name: 'Crate Wood', color: '#ffffff', metalness: 0, roughness: 1, baseColorTextureKey: texture.key });
    expect(materials[0].normalTextureKey).toBeUndefined();
    expect(partMaterials).toEqual({ [spec.parts[0].id]: materials[0].key });
  });

  it('keeps texture orientation: the viewport samples the same texel as the source glTF', async () => {
    const glb = await buildTexturedBoxGlb();
    const { spec } = await importGlbAsModelSpec(writeGlb(glb), 'Crate.glb');
    const source = sourceTopSamples(glb);
    const imported = importedTopSamples(spec.parts[0]);
    // The +Y face spans all four quadrants, so a flipped/mirrored mapping could not pass.
    expect(new Set([...source.values()].map(String)).size).toBe(4);
    for (const [key, color] of source) expect(imported.get(key)).toEqual(color);
  });

  it('bakes KHR_texture_transform offset/scale into the faceUVs', async () => {
    const transform = { offset: [0.5, 0.25] as [number, number], scale: [1, 0.5] as [number, number] };
    const glb = await buildTexturedBoxGlb(transform);
    const { spec, warnings, materials, partMaterials } = await importGlbAsModelSpec(writeGlb(glb), 'Crate.glb');
    expect(warnings).toEqual([]);
    expect(materials).toHaveLength(1);
    expect(partMaterials[spec.parts[0].id]).toBe(materials[0].key);
    const source = sourceTopSamples(glb, transform);
    const imported = importedTopSamples(spec.parts[0]);
    // Shifted by half a tile horizontally: the transform genuinely changes what is sampled.
    expect(new Set([...source.values()].map(String)).size).toBeGreaterThan(1);
    expect(source).not.toEqual(sourceTopSamples(glb));
    for (const [key, color] of source) expect(imported.get(key)).toEqual(color);
  });

  it('keeps non-default PBR (metalness 1) without textures, and dedupes identical materials', async () => {
    const scene = new THREE.Scene();
    const metal = new THREE.MeshStandardMaterial({ color: '#888888', metalness: 1, roughness: 0.3, name: 'Steel' });
    const metalTwin = new THREE.MeshStandardMaterial({ color: '#888888', metalness: 1, roughness: 0.3, name: 'Steel Copy' });
    const plain = new THREE.MeshStandardMaterial({ color: '#ff0000' });
    const a = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), metal);
    a.name = 'A';
    const b = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), metalTwin);
    b.name = 'B';
    b.position.x = 2;
    const c = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), plain);
    c.name = 'C';
    c.position.x = -2;
    scene.add(a, b, c);
    const glb = (await new GLTFExporter().parseAsync(scene, { binary: true })) as ArrayBuffer;
    const { spec, warnings, textures, materials, partMaterials } = await importGlbAsModelSpec(glb, 'metal.glb');
    expect(warnings).toEqual([]);
    expect(textures).toEqual([]);
    expect(materials).toHaveLength(1);
    expect(materials[0]).toMatchObject({ name: 'Steel', color: '#888888', metalness: 1, emissiveIntensity: 0 });
    expect(materials[0].roughness).toBeCloseTo(0.3);
    expect(materials[0].baseColorTextureKey).toBeUndefined();
    const byName = (name: string) => spec.parts.find((part) => part.name === name)!;
    expect(partMaterials[byName('A').id]).toBe(materials[0].key);
    expect(partMaterials[byName('B').id]).toBe(materials[0].key);
    expect(partMaterials[byName('C').id]).toBeUndefined();
  });

  it('applies only the dominant textured material on a multi-material part and warns', async () => {
    const glb = await buildTexturedBoxGlb();
    // Second material (metal, untextured) on 2 of the 6 faces via a second primitive.
    glb.json.materials.push({ name: 'Trim', pbrMetallicRoughness: { baseColorFactor: [0, 0, 1, 1], metallicFactor: 1, roughnessFactor: 0.2 } });
    const primitive = glb.json.meshes[0].primitives[0];
    const indices = readAccessorIndices(glb, primitive.indices);
    const split = 12; // first two faces (4 triangles) → Trim
    glb.json.accessors.push(indexAccessor(glb, indices.slice(0, split)), indexAccessor(glb, indices.slice(split)));
    const count = glb.json.accessors.length;
    glb.json.meshes[0].primitives = [
      { ...primitive, indices: count - 2, material: 1 },
      { ...primitive, indices: count - 1, material: 0 },
    ];
    const { spec, warnings, textures, materials, partMaterials } = await importGlbAsModelSpec(writeGlb(glb), 'Crate.glb');
    expect(spec.parts).toHaveLength(1);
    expect(textures).toHaveLength(1);
    expect(materials).toHaveLength(1);
    expect(materials[0].baseColorTextureKey).toBe(textures[0].key);
    expect(partMaterials[spec.parts[0].id]).toBe(materials[0].key);
    expect(warnings.some((w) => w.includes('only one material per part') && w.includes('"Trim"'))).toBe(true);
    const part = spec.parts[0];
    expect(part.mesh!.faceSlots!.filter((slot) => slot !== part.colorSlot)).toHaveLength(2);
  });
});

function readAccessorIndices(glb: Glb, index: number): number[] {
  const accessor = glb.json.accessors[index];
  const view = glb.json.bufferViews[accessor.bufferView];
  const start = glb.bin.byteOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const Ctor = accessor.componentType === 5125 ? Uint32Array : accessor.componentType === 5123 ? Uint16Array : Uint8Array;
  return Array.from(new Ctor(glb.bin.buffer.slice(start, start + accessor.count * Ctor.BYTES_PER_ELEMENT)));
}

function indexAccessor(glb: Glb, values: number[]) {
  const bytes = new Uint8Array(new Uint32Array(values).buffer);
  const bufferView = appendBufferView(glb, bytes);
  return { bufferView, componentType: 5125, count: values.length, type: 'SCALAR' };
}
