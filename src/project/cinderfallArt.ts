import { IcosahedronGeometry } from 'three';
import type { ModelPart, ModelPartMesh, ModelSpec, Vector3Tuple } from '../types';

const part = (name: string, shape: ModelPart['shape'], position: Vector3Tuple, scale: Vector3Tuple, colorSlot: number, rotation: Vector3Tuple = [0, 0, 0]): ModelPart => ({
  id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, shape, position, scale, colorSlot, rotation, collider: 'none',
});
function rockMesh(seed: number): ModelPartMesh {
  const geometry = new IcosahedronGeometry(0.5, 0), positions = geometry.getAttribute('position');
  const vertices: Vector3Tuple[] = [];
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    const variation = 0.9 + Math.sin(x * 37 + y * 29 + z * 17 + seed) * 0.16;
    vertices.push([x * variation, y * variation, z * variation]);
  }
  geometry.dispose();
  return { vertices, indices: vertices.map((_, index) => index) };
}
const crystalMesh = (): ModelPartMesh => {
  const vertices: Vector3Tuple[] = [[0, 0.7, 0], [0, -0.5, 0]];
  for (let i = 0; i < 6; i++) vertices.push([Math.cos(i * Math.PI / 3) * 0.28, 0.15, Math.sin(i * Math.PI / 3) * 0.28]);
  for (let i = 0; i < 6; i++) vertices.push([Math.cos(i * Math.PI / 3) * 0.25, -0.32, Math.sin(i * Math.PI / 3) * 0.25]);
  const indices: number[] = [];
  for (let i = 0; i < 6; i++) {
    const a = 2 + i, b = 2 + (i + 1) % 6, c = a + 6, d = b + 6;
    indices.push(0, b, a, a, b, c, b, d, c, 1, c, d);
  }
  return { vertices, indices };
};

/** Original reusable, editable Model Forge assets; no downloaded art or baked gameplay meshes. */
export function cinderfallModelDefinitions(): Omit<ModelSpec, 'id'>[] {
  const result: Omit<ModelSpec, 'id'>[] = [0, 1, 2].map(index => ({
    name: `Cinderfall · Basalt ${index + 1}`, palette: ['#3c4653', '#455164', '#303c4c'],
    parts: [{ ...part('Fractured basalt', 'mesh', [0, 0, 0], [1, 1, 1], index), mesh: rockMesh(index * 17 + 3) }],
    style: { finish: 'flat', bevel: 0, roughness: 0.94 },
  }));
  result.push({ name: 'Cinderfall · Aetherite vein', palette: ['#4bddc1', '#96f3dd', '#236c73', '#343f4d'],
    parts: [
      { ...part('Vein bed', 'mesh', [0, -0.17, 0], [2.3, 0.6, 1.6], 3), mesh: rockMesh(4) },
      ...[[-0.6, 0.1, 0, 0.85], [0, 0.35, 0, 1.5], [0.57, 0.02, 0.18, 0.85], [0.18, 0.1, -0.5, 0.7]].map(([x, y, z, height], index) => ({ ...part(`Crystal ${index + 1}`, 'mesh', [x, y, z], [1, height, 1], index % 2, [0.12, index * 0.7, index % 2 ? -0.2 : 0.2]), mesh: crystalMesh() })),
    ], style: { finish: 'flat', bevel: 0, roughness: 0.25 },
  });
  result.push({ name: 'Cinderfall · VX-24 Survey Rifle', palette: ['#d9aa47', '#26333c', '#bac7c6', '#17242c', '#70e7ce', '#835c2f'],
    parts: [
      part('Receiver', 'box', [0, 0, 0], [0.17, 0.17, 0.5], 0),
      part('Upper receiver', 'box', [0, 0.085, -0.035], [0.14, 0.065, 0.43], 1),
      part('Reinforced barrel', 'cylinder', [0, 0.026, -0.4], [0.07, 0.45, 0.07], 2, [Math.PI / 2, 0, 0]),
      part('Muzzle shroud', 'hexprism', [0, 0.026, -0.62], [0.095, 0.12, 0.095], 1, [Math.PI / 2, 0, 0]),
      part('Foregrip', 'box', [0, -0.07, -0.22], [0.18, 0.11, 0.22], 5),
      part('Pistol grip', 'box', [0, -0.145, 0.095], [0.09, 0.19, 0.12], 3, [0.15, 0, 0]),
      part('Magazine', 'box', [0, -0.16, -0.08], [0.115, 0.23, 0.115], 2, [-0.12, 0, 0]),
      part('Buttstock', 'box', [0, -0.015, 0.35], [0.15, 0.15, 0.2], 1),
      part('Sight bridge', 'box', [0, 0.155, 0.04], [0.07, 0.07, 0.14], 3),
      part('Sight glass', 'box', [0, 0.185, -0.015], [0.045, 0.023, 0.013], 4),
      part('Power indicator', 'box', [0.089, 0.008, -0.04], [0.009, 0.025, 0.19], 4),
      part('Armoured right glove', 'box', [0.01, -0.21, 0.12], [0.13, 0.095, 0.15], 5),
      part('Right sleeve', 'capsule', [0.035, -0.27, 0.26], [0.14, 0.24, 0.15], 1, [0.75, 0, 0]),
      part('Armoured left glove', 'box', [-0.025, -0.15, -0.22], [0.13, 0.08, 0.14], 5),
      part('Left sleeve', 'capsule', [-0.065, -0.22, -0.1], [0.14, 0.25, 0.15], 1, [0.8, 0, -0.2]),
    ], style: { finish: 'smooth', bevel: 0.008, roughness: 0.47 },
  });
  result.push({ name: 'Cinderfall · Cavewarden shell', palette: ['#9a6242', '#cb9a58', '#354751', '#72ddbc', '#26313a'],
    parts: [
      { ...part('Abdomen', 'mesh', [0, 0.66, -0.22], [1.4, 0.8, 1.3], 0), mesh: rockMesh(12) },
      { ...part('Carapace plate', 'mesh', [0, 0.89, -0.25], [1.24, 0.5, 1.1], 1), mesh: rockMesh(21) },
      { ...part('Head armour', 'mesh', [0, 0.47, 0.59], [0.82, 0.55, 0.72], 2), mesh: rockMesh(2) },
      part('Left compound eye', 'sphere', [-0.25, 0.59, 0.84], [0.2, 0.14, 0.12], 3),
      part('Right compound eye', 'sphere', [0.25, 0.59, 0.84], [0.2, 0.14, 0.12], 3),
      part('Left mandible', 'cone', [-0.23, 0.29, 0.96], [0.17, 0.42, 0.16], 4, [1.1, 0, 0.3]),
      part('Right mandible', 'cone', [0.23, 0.29, 0.96], [0.17, 0.42, 0.16], 4, [1.1, 0, -0.3]),
      ...[-0.65, -0.25, 0.15].map((z, index) => part(`Dorsal ridge ${index + 1}`, 'cone', [0, 1.02, z], [0.22, 0.38, 0.24], 1, [-0.3, 0, 0])),
    ], style: { finish: 'flat', bevel: 0, roughness: 0.55 },
  });
  result.push({ name: 'Cinderfall · Articulated leg', palette: ['#a7754e', '#26343b'], parts: [
    part('Coxa', 'box', [0.3, 0, 0], [0.62, 0.12, 0.14], 0, [0, 0, -0.3]),
    part('Knee', 'sphere', [0.62, -0.1, 0], [0.2, 0.2, 0.2], 1),
    part('Tibia', 'box', [0.78, -0.32, 0], [0.14, 0.62, 0.13], 1, [0, 0, -0.5]),
  ], style: { finish: 'flat', bevel: 0, roughness: 0.68 } });
  return result;
}
