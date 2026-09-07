import { File as NodeFile } from 'node:buffer';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { documentToGlb, packGltfFile, readModelDocument, type GltfDocument } from '../modelDocument';
import { inspectModel } from '../inspectModel';

const document = (): GltfDocument => ({
  asset: { version: '2.0', copyright: 'Example Artist' },
  scene: 0, scenes: [{ nodes: [0] }],
  nodes: [{ name: 'Hero', mesh: 0, skin: 0, scale: [2, 2, 2], children: [1] }, { name: 'Hips' }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
  accessors: [{ count: 8, min: [-.5, 0, -.5], max: [.5, 1, .5] }, { count: 36 }, { count: 2, min: [0], max: [1.5] }],
  skins: [{ joints: [1] }],
  animations: [{ name: 'Idle', samplers: [{ input: 2 }] }],
  materials: [{ name: 'Jacket', pbrMetallicRoughness: { baseColorFactor: [1, .5, .25, 1], baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: .7 } }],
  textures: [{}], extensionsUsed: ['KHR_texture_basisu', 'KHR_draco_mesh_compression', 'EXT_meshopt_compression'],
});
beforeAll(() => vi.stubGlobal('File', NodeFile));
afterAll(() => vi.unstubAllGlobals());

describe('model metadata and portable imports', () => {
  it('inspects compressed-format metadata, animation, materials and world bounds without a renderer', async () => {
    const file = new File([documentToGlb(document())], 'hero.glb');
    const result = await inspectModel(file);
    expect(result.skeleton?.boneNames).toEqual(['Hips']);
    expect(result.clips).toEqual([{ name: 'Idle', duration: 1.5 }]);
    expect(result.materials[0]).toMatchObject({ name: 'Jacket', hasBaseColorMap: true, metalness: 0, roughness: .7 });
    expect(result.stats).toMatchObject({ triangles: 12, dimensions: [2, 2, 2], copyright: 'Example Artist', textures: 1 });
    expect(result.warnings).toEqual([]);
  });
  it('packs selected glTF buffers and images into a self-contained GLB', async () => {
    const doc = { ...document(), buffers: [{ uri: 'geometry.bin', byteLength: 4 }], images: [{ uri: 'textures/color.png' }] };
    const packed = await packGltfFile(new File([JSON.stringify(doc)], 'hero.gltf'), [new File([new Uint8Array([0, 1, 2, 3])], 'geometry.bin'), new File([new Uint8Array([4, 5])], 'color.png')]);
    const parsed = readModelDocument(await packed.arrayBuffer());
    expect(packed.name).toBe('hero.glb');
    expect(parsed.buffers![0].uri).toBe('data:application/octet-stream;base64,AAECAw==');
    expect(parsed.images![0].uri).toBe('data:image/png;base64,BAU=');
  });
  it('reports missing sidecars and refuses ambiguous filename resolution', async () => {
    const doc = { ...document(), buffers: [{ uri: 'mesh.bin', byteLength: 4 }] };
    const file = new File([JSON.stringify(doc)], 'hero.gltf');
    await expect(packGltfFile(file, [])).rejects.toThrow('Missing glTF file');
    await expect(packGltfFile(file, [new File(['a'], 'mesh.bin'), new File(['b'], 'mesh.bin')])).rejects.toThrow('Ambiguous');
  });
  it('rejects truncated containers and surfaces unsupported animation metadata', async () => {
    const binary = documentToGlb(document());
    expect(() => readModelDocument(binary.slice(0, binary.byteLength - 1))).toThrow('truncated');
    const doc = document(); delete doc.accessors![2].max;
    const result = await inspectModel(new File([JSON.stringify(doc)], 'model.gltf'));
    expect(result.warnings?.join(' ')).toContain('incomplete time bounds');
    expect(result.clips).toEqual([]);
  });
  it('reads missing animation time bounds from real accessor bytes and refuses invented joint names', async () => {
    const doc = document();
    const times = new Float32Array([0, 2.25]);
    doc.buffers = [{ uri: `data:application/octet-stream;base64,${Buffer.from(times.buffer).toString('base64')}`, byteLength: 8 }];
    doc.bufferViews = [{ buffer: 0, byteLength: 8 }];
    doc.accessors![2] = { count: 2, type: 'SCALAR', componentType: 5126, bufferView: 0 };
    delete doc.nodes![1].name;
    const result = await inspectModel(new File([documentToGlb(doc)], 'unnamed-rig.glb'));
    expect(result.clips).toEqual([{ name: 'Idle', duration: 2.25 }]);
    expect(result.skeleton).toBeUndefined();
    expect(result.warnings?.join(' ')).toContain('unique names');
  });
});
