import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Document, NodeIO } from '@gltf-transform/core';
import { KHRMaterialsEmissiveStrength } from '@gltf-transform/extensions';
import sharp from 'sharp';

// Original, editable district kit. Geometry is batched by material within each architectural module.
const out = 'public/templates/neon-afterlight';
mkdirSync(out, { recursive: true });
const hash = (x, y) => { let h = Math.imul(x + 71, 374761393) + Math.imul(y + 29, 668265263); h = Math.imul(h ^ h >>> 13, 1274126177); return ((h ^ h >>> 16) >>> 0) / 4294967295; };
for (const kind of ['asphalt', 'cladding']) {
  const size = 512, rgb = Buffer.alloc(size * size * 3), heights = new Float32Array(size * size), normals = Buffer.alloc(rgb.length);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const n = hash(x, y), k = (y * size + x) * 3;
    const seam = kind === 'cladding' && (x % 128 < 3 || y % 256 < 3);
    const scar = kind === 'asphalt' && Math.abs(x - 170 - Math.sin(y * .023) * 36 - Math.sin(y * .085) * 9) < 1.2;
    const v = seam || scar ? 25 : kind === 'asphalt' ? 72 + n * 47 : 125 + n * 18 + Math.sin(y * .04) * 9;
    rgb[k] = v * .82; rgb[k + 1] = v * .92; rgb[k + 2] = v;
    heights[y * size + x] = seam || scar ? .05 : .6 + n * (kind === 'asphalt' ? .035 : .025);
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const get = (a, b) => heights[((b + size) % size) * size + (a + size) % size];
    const dx = (get(x - 1, y) - get(x + 1, y)) * 1.4, dy = (get(x, y - 1) - get(x, y + 1)) * 1.4, len = Math.hypot(dx, dy, 1), k = (y * size + x) * 3;
    normals[k] = (dx / len * .5 + .5) * 255; normals[k + 1] = (dy / len * .5 + .5) * 255; normals[k + 2] = (.5 / len + .5) * 255;
  }
  await sharp(rgb, { raw: { width: size, height: size, channels: 3 } }).png().toFile(`${out}/${kind}.png`);
  await sharp(normals, { raw: { width: size, height: size, channels: 3 } }).png().toFile(`${out}/${kind}-normal.png`);
}

const signs = [
  ['afterlight', 'AFTER', 'LIGHT', 'DISTRICT 09 / OPEN ALL NIGHT', '#65efff'],
  ['noodle', 'NIGHT', 'MARKET', 'HOT FOOD / COLD CITY', '#ffb64d'],
  ['transit', '09', 'TRANSIT', 'LOWER LEVEL / PLATFORM 04', '#73edff'],
  ['soma', 'SOMA', 'CLINIC', 'MEMORY / REPAIR / RENEW', '#ff4b9f'],
  ['relay', 'RELAY', 'SYSTEMS', 'NETWORK ACCESS / 24 HOUR', '#b5a1ff'],
];
for (const [name, top, bottom, small, color] of signs) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="512"><rect width="1024" height="512" fill="#03080e"/><path d="M24 100V24h230M1000 412v76H770" fill="none" stroke="${color}" stroke-width="9"/><g fill="${color}" font-family="Arial, sans-serif"><text x="62" y="204" font-weight="900" font-size="172" letter-spacing="-7">${top}</text><text x="68" y="376" font-weight="900" font-size="150" letter-spacing="3">${bottom}</text><text x="74" y="451" font-size="25" letter-spacing="6">${small}</text></g><g stroke="${color}" opacity=".12">${Array.from({ length: 85 }, (_, i) => `<path d="M0 ${i * 6}h1024"/>`).join('')}</g><path d="M945 24h54v54h-54zM902 24h22v22h-22z" fill="${color}"/></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(`${out}/sign-${name}.png`);
}

const palette = {
  shell: { color: [.24, .3, .35, 1], roughness: .48, metalness: .42, map: 'cladding' },
  trim: { color: [.085, .11, .14, 1], roughness: .3, metalness: .78 },
  panel: { color: [.36, .42, .45, 1], roughness: .38, metalness: .66, map: 'cladding' },
  dark: { color: [.009, .018, .025, 1], roughness: .23, metalness: .55 },
  warm: { color: [1, .36, .055, 1], emissive: [1, .32, .045], strength: 2, roughness: .4 },
  cool: { color: [.05, .55, .72, 1], emissive: [.025, .65, 1], strength: 2.5, roughness: .3 },
  pink: { color: [.9, .03, .22, 1], emissive: [1, .025, .2], strength: 2.5, roughness: .3 },
};
let bins = {};
function add(g, material, p = [0, 0, 0], rotation = [0, 0, 0]) {
  // glTF texture coordinates use the image's top-left origin; Three's plane UVs start below.
  if (palette[material].sign) for (let i = 0; i < g.attributes.uv.count; i++) g.attributes.uv.setY(i, 1 - g.attributes.uv.getY(i));
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), new THREE.Vector3(1, 1, 1)));
  (bins[material] ??= []).push(g.index ? g.toNonIndexed() : g.clone()); g.dispose();
}
function box(material, p, size, rotation) {
  const g = new THREE.BoxGeometry(...size), uv = g.attributes.uv;
  if (palette[material].map) for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(size[0], size[2]) * .35, uv.getY(i) * size[1] * .35);
  add(g, material, p, rotation);
}
function pipe(material, a, b, radius = .14) {
  const direction = new THREE.Vector3(...b).sub(new THREE.Vector3(...a));
  const g = new THREE.CylinderGeometry(radius, radius, direction.length(), 12);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
  add(g, material, a.map((v, i) => (v + b[i]) / 2));
}
async function save(name) {
  const d = new Document(), buffer = d.createBuffer(), extension = d.createExtension(KHRMaterialsEmissiveStrength);
  const scene = d.createScene(name).setExtras({ featherPreserveScale: true, authoringUnits: 'metres' }), mesh = d.createMesh(name);
  const textures = new Map();
  const texture = name => { if (!textures.has(name)) textures.set(name, d.createTexture(name).setImage(readFileSync(`${out}/${name}.png`)).setMimeType('image/png')); return textures.get(name); };
  let triangles = 0;
  for (const [key, list] of Object.entries(bins)) {
    const g = mergeGeometries(list), v = palette[key];
    const material = d.createMaterial(key).setBaseColorFactor(v.color).setRoughnessFactor(v.roughness).setMetallicFactor(v.metalness ?? 0);
    if (v.map) { material.setBaseColorTexture(texture(v.map)).setNormalTexture(texture(`${v.map}-normal`)).setNormalScale(.6); }
    if (v.emissive) material.setEmissiveFactor(v.emissive).setExtension('KHR_materials_emissive_strength', extension.createEmissiveStrength().setEmissiveStrength(v.strength));
    if (v.sign) material.setBaseColorTexture(texture(v.sign)).setEmissiveTexture(texture(v.sign));
    const primitive = d.createPrimitive().setMaterial(material);
    for (const [attribute, type, semantic] of [['position', 'VEC3', 'POSITION'], ['normal', 'VEC3', 'NORMAL'], ['uv', 'VEC2', 'TEXCOORD_0']]) primitive.setAttribute(semantic, d.createAccessor().setType(type).setArray(new Float32Array(g.attributes[attribute].array)).setBuffer(buffer));
    mesh.addPrimitive(primitive); triangles += g.attributes.position.count / 3; g.dispose(); list.forEach(item => item.dispose());
  }
  scene.addChild(d.createNode(name).setMesh(mesh));
  const bytes = await new NodeIO().registerExtensions([KHRMaterialsEmissiveStrength]).writeBinary(d);
  writeFileSync(`${out}/${name}.glb`, bytes); console.log(`${name}: ${triangles} triangles / ${Object.keys(bins).length} batches / ${Math.round(bytes.length / 1024)} KiB`); bins = {};
}

for (let variant = 0; variant < 2; variant++) {
  const height = variant ? 72 : 52, width = variant ? 15 : 12, depth = variant ? 14 : 16;
  box('shell', [0, height / 2, 0], [width, height, depth]);
  box('trim', [0, 1.2, 0], [width + 1, 2.4, depth + 1]);
  for (let y = 5; y < height - 1; y += 3.5) {
    box('trim', [0, y - 1.45, 0], [width + .2, .15, depth + .2]);
    for (const side of [-1, 1]) {
      for (let x = -width / 2 + 1.2; x < width / 2; x += 1.5) {
        const active = hash(Math.round(x * 10) + variant * 91, Math.round(y) + side * 13) > .45;
        box(active ? (hash(Math.round(x * 3), Math.round(y)) > .76 ? 'cool' : 'warm') : 'dark', [x, y, side * (depth / 2 + .03)], [.76, 1.7, .04]);
      }
      for (let z = -depth / 2 + 1.2; z < depth / 2; z += 1.7) {
        box(hash(Math.round(z * 10), Math.round(y) + side * 35) > .5 ? 'warm' : 'dark', [side * (width / 2 + .03), y, z], [.04, 1.5, .8]);
      }
    }
  }
  for (const x of [-width / 2 - .12, width / 2 + .12]) for (const z of [-depth / 2, depth / 2]) box('trim', [x, height / 2, z], [.35, height, .5]);
  for (let i = 0; i < 4; i++) box('panel', [-3 + i * 2, height + 1, 1], [1.4, 2, 3]);
  box('shell', [0, height + 3, -2], [width * .5, 6, depth * .48]);
  pipe('trim', [0, height + 4, 0], [0, height + 14, 0], .09);
  box('pink', [0, height + 14, 0], [.22, .24, .22]);
  if (variant) for (const x of [-width / 2 - .2, width / 2 + .2]) box('cool', [x, height * .6, depth / 2 + .1], [.11, height * .65, .1]);
  await save(`tower-${variant ? 'relay' : 'habitat'}`);
}

// Street-front workshop: recessed roller door, canopy, ducts, fan cage and ladder.
box('shell', [0, 5.5, 0], [12, 11, 8]); box('trim', [0, .3, 4.5], [12.8, .6, 1.5]);
for (const x of [-4, 0, 4]) {
  box('dark', [x, 2.6, 4.05], [3.5, 4.5, .12]);
  for (let y = .65; y < 4.7; y += .25) box('panel', [x, y, 4.17], [3.3, .065, .13]);
  box('warm', [x, 4.8, 4.28], [3.3, .09, .1]);
}
box('trim', [0, 5.2, 4.9], [12.9, .28, 2.3]);
for (const x of [-5.8, 5.8]) pipe('panel', [x, .5, 4.3], [x, 11.5, 4.3], .19);
for (let x = -4; x <= 4; x += 4) {
  box('panel', [x, 8.5, 4.55], [2.8, 2, 1]);
  for (let y = 7.8; y < 9.4; y += .2) box('dark', [x, y, 5.08], [2.5, .09, .06]);
}
for (const x of [4.8, 5.5]) pipe('trim', [x, 0, 4.9], [x, 12, 4.9], .055);
for (let y = .5; y < 12; y += .5) pipe('trim', [4.8, y, 4.9], [5.5, y, 4.9], .045);
await save('street-workshop');

// Maintenance crossing, with railings and diagonal structural bracing.
box('panel', [0, 0, 0], [24, .5, 4]);
for (const side of [-1, 1]) {
  for (let x = -12; x <= 12; x += 2) pipe('trim', [x, 0, side * 1.9], [x, 1.6, side * 1.9], .065);
  pipe('trim', [-12, 1.6, side * 1.9], [12, 1.6, side * 1.9], .085);
  box('cool', [0, -.3, side * 2.05], [23.8, .075, .07]);
  for (let x = -12; x < 12; x += 4) pipe('trim', [x, -.4, side * 1.7], [x + 4, -2.6, side * 1.7], .13);
}
await save('service-bridge');

for (const [name] of signs) {
  palette.sign = { color: [1, 1, 1, 1], roughness: .34, emissive: [1, 1, 1], strength: 2.7, sign: `sign-${name}` };
  box('trim', [0, 0, -.1], [4.3, 2.3, .22]);
  add(new THREE.PlaneGeometry(4, 2), 'sign', [0, 0, .035]);
  for (const x of [-1.8, 1.8]) box('trim', [x, -1.6, -.6], [.1, 1.2, 1.2]);
  await save(`sign-${name}`);
}

// Cargo drone with ducted rotors and lenses; the complete object can be animated in the timeline.
box('panel', [0, 0, 0], [1.5, .45, 1.2]); box('dark', [0, -.28, .2], [.8, .5, .75]);
for (const x of [-1, 1]) for (const z of [-.75, .75]) {
  add(new THREE.TorusGeometry(.46, .07, 8, 24), 'trim', [x, .15, z], [Math.PI / 2, 0, 0]);
  box('dark', [x, .15, z], [.65, .035, .08]);
  box('cool', [x, -.02, z], [.16, .09, .16]);
  pipe('trim', [x * .4, 0, z * .4], [x, .15, z], .045);
}
box('warm', [0, -.3, .64], [.25, .16, .025]);
await save('courier-drone');

box('panel', [0, .8, 0], [1.8, 1.6, 1.2]);
for (const x of [-.75, .75]) box('trim', [x, .8, .63], [.09, 1.55, .08]);
for (let y = .25; y < 1.5; y += .18) box('dark', [0, y, .65], [1.25, .075, .04]);
pipe('trim', [-.6, 1.6, 0], [-.6, 3.1, 0], .18);
pipe('trim', [.55, 1.6, 0], [.55, 2.4, 0], .13);
await save('utility-vent');
console.log('Neon Afterlight: original city modules, emissive typography and PBR surface maps ready.');
