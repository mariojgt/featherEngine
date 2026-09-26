/** Offline extraction of pinned CC0 scans; no network, decoders, or generated imagery. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const source = 'src/terrain/models/woodland-ground-cover.glb';
const bytes = fs.readFileSync(source);
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const provenance = JSON.parse(fs.readFileSync('src/terrain/models/ground-cover-provenance.json'));
assert.equal(hash(bytes), provenance.output.sha256, 'Bundled source must match its CC0 provenance');
const jsonLength = bytes.readUInt32LE(12);
const coverJson = JSON.parse(bytes.subarray(20, 20 + jsonLength));
const coverBinary = bytes.subarray(28 + jsonLength);
const treeSourceBytes = fs.readFileSync('src/terrain/models/woodland-trees.glb');
const treeProvenance = JSON.parse(fs.readFileSync('src/terrain/models/provenance.json'));
assert.equal(hash(treeSourceBytes), treeProvenance.output.sha256, 'Bundled tree source must match provenance');
const treeSourceJsonLength = treeSourceBytes.readUInt32LE(12);
const treeSourceJson = JSON.parse(treeSourceBytes.subarray(20, 20 + treeSourceJsonLength));
const outputs = [];
for (const [name, kind, variants, lod] of [
  ['verdant-rock-shelf', 'rock', [0], 0],
  ['verdant-rock-crag', 'rock', [3], 0],
  ['verdant-rock-boulder', 'rock', [5], 0],
  ['verdant-fern-bank', 'fern', [0, 1, 3], 1],
  ['verdant-shrub', 'shrub', [1], 2],
]) {
  const sourceJson = kind === 'shrub' ? treeSourceJson : coverJson;
  const binary = kind === 'shrub' ? treeSourceBytes.subarray(28 + treeSourceJsonLength) : coverBinary;
  const d = { asset: { version: '2.0', generator: 'Feather Verdant CC0 extraction' }, scene: 0,
    scenes: [{ nodes: [], extras: { featherPreserveScale: true } }], nodes: [], meshes: [], materials: [],
    textures: [], images: [], samplers: sourceJson.samplers, accessors: [], bufferViews: [], buffers: [],
    extensionsUsed: sourceJson.extensionsUsed, extensionsRequired: ['KHR_mesh_quantization'] };
  const shrubLeafViews = new Set(kind === 'shrub' ? sourceJson.meshes[sourceJson.nodes.find(n=>n.extras.featherTreeVariant===variants[0] && n.extras.featherTreeLod===lod).mesh].primitives
    .filter(p => sourceJson.materials[p.material].alphaMode === 'MASK')
    .map(p => sourceJson.accessors[p.attributes.POSITION].bufferView) : []);
  const chunks = [], maps = new Map(); let size = 0, triangles = 0;
  function copy(type, id) {
    const key = `${type}:${id}`;
    if (maps.has(key)) return maps.get(key);
    const value = structuredClone(sourceJson[type][id]);
    if (type === 'bufferViews') {
      const data = Buffer.from(binary.subarray(value.byteOffset ?? 0, (value.byteOffset ?? 0) + value.byteLength));
      // Keep the source card centres/atlas UVs; broader leaves read as a shrub at this small scale.
      if (shrubLeafViews.has(id)) for (let card=0; card<data.length; card+=48) for (let axis=0; axis<3; axis++) {
        const centre=[0,1,2,3].reduce((sum,v)=>sum+data.readFloatLE(card+v*12+axis*4),0)/4;
        for (let v=0; v<4; v++) { const offset=card+v*12+axis*4; data.writeFloatLE(centre+(data.readFloatLE(offset)-centre)*2.2,offset); }
      }
      value.byteOffset = size; value.buffer = 0; chunks.push(data); size += data.length;
      const pad = (4 - size % 4) % 4; chunks.push(Buffer.alloc(pad)); size += pad;
    }
    if (type === 'accessors' && shrubLeafViews.has(value.bufferView)) { value.min=value.min.map(v=>v-.5); value.max=value.max.map(v=>v+.5); }
    if (type === 'accessors' || type === 'images') value.bufferView = copy('bufferViews', value.bufferView);
    if (type === 'textures') value.source = copy('images', value.source);
    if (type === 'materials') {
      for (const info of [value.pbrMetallicRoughness?.baseColorTexture, value.pbrMetallicRoughness?.metallicRoughnessTexture, value.normalTexture, value.occlusionTexture])
        if (info) info.index = copy('textures', info.index);
      if (kind === 'shrub' && value.alphaMode === 'MASK') {
        value.pbrMetallicRoughness.baseColorFactor=[.7,.82,.6,1];
        delete value.pbrMetallicRoughness.metallicRoughnessTexture;
        value.pbrMetallicRoughness.roughnessFactor=.95; value.normalTexture.scale=.3; value.alphaCutoff=.3;
      }
      // Restrain bright scanned fern tips without replacing their PBR maps.
      if (kind === 'fern') value.pbrMetallicRoughness.baseColorFactor = [.8, .85, .7, 1];
    }
    const next = d[type].push(value) - 1; maps.set(key, next); return next;
  }
  for (const [i, variant] of variants.entries()) {
    const node = sourceJson.nodes.find(n => (kind === 'shrub' || n.extras?.featherGroundCoverKind === kind) && n.extras.featherTreeVariant === variant && n.extras.featherTreeLod === lod);
    const mesh = structuredClone(sourceJson.meshes[node.mesh]);
    for (const p of mesh.primitives) {
      triangles += sourceJson.accessors[p.indices].count / 3;
      p.indices = copy('accessors', p.indices); p.material = copy('materials', p.material);
      for (const key of Object.keys(p.attributes)) p.attributes[key] = copy('accessors', p.attributes[key]);
    }
    const next = { name: `${name}-${i}`, mesh: d.meshes.push(mesh) - 1 };
    if (kind === 'shrub') { next.scale = [.145, .115, .145]; next.translation = [0, -.025, 0]; }
    if (kind === 'fern') {
      next.translation = [[-.35, 0, .1], [.4, -.03, .25], [0, .02, -.4]][i];
      next.rotation = [0, Math.sin(i * 1.1), 0, Math.cos(i * 1.1)];
      next.scale = [[1.1, 1.1, 1.1], [.85, .9, .85], [1, 1.2, 1]][i];
    }
    d.scenes[0].nodes.push(d.nodes.push(next) - 1);
  }
  d.buffers = [{ byteLength: size }];
  let json = Buffer.from(JSON.stringify(d)); json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)]);
  const data = Buffer.concat(chunks), header = Buffer.alloc(12), j = Buffer.alloc(8), b = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + json.length + data.length, 8);
  j.writeUInt32LE(json.length); j.writeUInt32LE(0x4e4f534a, 4); b.writeUInt32LE(data.length); b.writeUInt32LE(0x004e4942, 4);
  const glb = Buffer.concat([header, j, json, b, data]);
  const file = `${name}.glb`; fs.writeFileSync(`src/terrain/models/${file}`, glb);
  outputs.push({ file, bytes: glb.length, sha256: hash(glb), triangles, meshes: d.meshes.length, textures: d.textures.length });
}
const report = { license: 'CC0-1.0', source, sourceSha256: hash(bytes), treeSourceSha256: hash(treeSourceBytes), sources: [...provenance.sources.filter(s => ['fern_02', 'rock_moss_set_01'].includes(s.asset)), ...treeProvenance.sources.filter(s => s.asset === 'island_tree_02')], outputs };
fs.writeFileSync('src/terrain/models/verdant-provenance.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(outputs, null, 2));
// Conservative half-metre slabs of the two source trees' solid wood. Cinematic routing uses
// their union, so a future change to the renderer's variant hash cannot invalidate clearance.
const treeBytes = fs.readFileSync('src/terrain/models/woodland-trees.glb');
const treeJsonSize = treeBytes.readUInt32LE(12), tree = JSON.parse(treeBytes.subarray(20, 20 + treeJsonSize));
const treeBin = treeBytes.subarray(28 + treeJsonSize), slabs = [];
function readAccessor(id) {
  const a = tree.accessors[id], v = tree.bufferViews[a.bufferView], n = a.type === 'VEC3' ? 3 : 1;
  const stride = a.componentType === 5126 || a.componentType === 5125 ? 4 : 2;
  const result = [];
  for (let i = 0; i < a.count * n; i++) {
    const offset = (v.byteOffset ?? 0) + (a.byteOffset ?? 0) + i * stride;
    result.push(a.componentType === 5126 ? treeBin.readFloatLE(offset) : stride === 4 ? treeBin.readUInt32LE(offset) : treeBin.readUInt16LE(offset));
  }
  return result;
}
for (let y = -.5; y < 8; y += .5) {
  const min = [Infinity, y, Infinity], max = [-Infinity, y + .5, -Infinity];
  for (const node of tree.nodes) for (const p of tree.meshes[node.mesh].primitives) {
    if (tree.materials[p.material].name.includes('leaves')) continue;
    const positions = readAccessor(p.attributes.POSITION), indices = readAccessor(p.indices);
    for (let i = 0; i < indices.length; i += 3) {
      const triangle = indices.slice(i, i + 3).map(index => positions.slice(index * 3, index * 3 + 3));
      if (Math.min(...triangle.map(v => v[1])) > y + .5 || Math.max(...triangle.map(v => v[1])) < y) continue;
      for (const v of triangle) for (const axis of [0, 2]) { min[axis] = Math.min(min[axis], v[axis]); max[axis] = Math.max(max[axis], v[axis]); }
    }
  }
  if (Number.isFinite(min[0])) slabs.push({ min, max });
}
fs.writeFileSync('src/terrain/models/verdant-tree-clearance.json', JSON.stringify({ sourceSha256: hash(treeBytes), slabs }, null, 2) + '\n');
