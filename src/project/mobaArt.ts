import { Matrix4, Euler, Quaternion, Vector3 } from 'three';
import { getPartRenderGeometry } from '../model/modelGeometry';
import { useEditorStore } from '../store/editorStore';
import type { ModelPart, ModelPartShape, Vector3Tuple } from '../types';

export const RIFT_PALETTE = [
  '#223d35',
  '#315442',
  '#45624b',
  '#233a38',
  '#57655c',
  '#8a9380',
  '#b6b296',
  '#423e39',
  '#203e49',
  '#34707a',
  '#6aa7a3',
  '#1c302b',
  '#33563a',
  '#537449',
  '#8c9a61',
  '#caab64',
  '#42bcca',
  '#df686a',
  '#ede1b2',
  '#192936',
];
export const laneRoutes: Vector3Tuple[][] = [
  [
    [28, 0, 28],
    [30, 0, 18],
    [30, 0, -18],
    [22, 0, -30],
    [-18, 0, -30],
    [-28, 0, -28],
  ],
  [
    [28, 0, 28],
    [20, 0, 20],
    [10, 0, 10],
    [-10, 0, -10],
    [-20, 0, -20],
    [-28, 0, -28],
  ],
  [
    [28, 0, 28],
    [18, 0, 30],
    [-18, 0, 30],
    [-30, 0, 22],
    [-30, 0, -18],
    [-28, 0, -28],
  ],
];
export const towerPositions: Vector3Tuple[] = [
  [30, 0, 7],
  [13, 0, 13],
  [7, 0, 30],
];
export function artPart(
  shape: ModelPartShape,
  position: Vector3Tuple,
  scale: Vector3Tuple,
  colorSlot: number,
  rotation: Vector3Tuple = [0, 0, 0],
): ModelPart {
  return {
    id: `piece-${Math.random().toString(36).slice(2)}`,
    name: shape,
    shape,
    position,
    scale,
    colorSlot,
    rotation,
    collider: 'none',
  };
}
/** Bake static kit parts by palette to keep a forest's hundreds of details to a few draw calls.
 * The result remains a standard, editable Model Forge mesh and travels in ordinary packages. */
export function makeArt(
  name: string,
  parts: ModelPart[],
  palette = RIFT_PALETTE,
  parentId?: string,
  position: Vector3Tuple = [0, 0, 0],
): string {
  const s = useEditorStore.getState();
  const buckets: {
    slot: number;
    vertices: Vector3Tuple[];
    indices: number[];
  }[] = [];
  const matrix = new Matrix4();
  const vector = new Vector3();
  for (const part of parts) {
    const geo = getPartRenderGeometry(part, {
      finish: 'flat',
      bevel: 0,
      roughness: 0.86,
    });
    const attr = geo.getAttribute('position');
    const index = geo.getIndex();
    let data = [...buckets]
      .reverse()
      .find(
        (b) =>
          b.slot === part.colorSlot &&
          b.vertices.length + attr.count < 8000 &&
          b.indices.length + (index?.count ?? attr.count) < 48000,
      );
    if (!data) {
      data = { slot: part.colorSlot, vertices: [], indices: [] };
      buckets.push(data);
    }
    matrix.compose(
      new Vector3(...part.position),
      new Quaternion().setFromEuler(new Euler(...part.rotation)),
      new Vector3(...part.scale),
    );
    const offset = data.vertices.length;
    for (let i = 0; i < attr.count; i++) {
      vector.fromBufferAttribute(attr, i).applyMatrix4(matrix);
      data.vertices.push([vector.x, vector.y, vector.z]);
    }
    for (let i = 0; i < (index?.count ?? attr.count); i++)
      data.indices.push(offset + (index ? index.getX(i) : i));
  }
  const specId = s.createModelSpec('blank', name)!;
  s.updateModelSpec(specId, {
    palette,
    style: { finish: 'flat', bevel: 0, roughness: 0.86 },
    parts: buckets.map(({ slot, vertices, indices }, i) => {
      const lo = [Infinity, Infinity, Infinity],
        hi = [-Infinity, -Infinity, -Infinity];
      for (const vertex of vertices)
        for (let a = 0; a < 3; a++) {
          lo[a] = Math.min(lo[a], vertex[a]);
          hi[a] = Math.max(hi[a], vertex[a]);
        }
      const center = lo.map((v, a) => (v + hi[a]) / 2) as Vector3Tuple,
        scale = lo.map((v, a) => Math.max(0.001, hi[a] - v)) as Vector3Tuple;
      return {
        ...artPart('mesh', center, scale, slot),
        name: `${name} · pigment ${slot + 1}/${i}`,
        mesh: {
          vertices: vertices.map(
            (v) => v.map((n, a) => (n - center[a]) / scale[a]) as Vector3Tuple,
          ),
          indices,
        },
      };
    }),
  });
  const id = s.createObjectWithProps('empty', { name, parentId, position });
  // Inline fallback + library reference use the same serialization path as ordinary Model Forge props.
  useEditorStore.setState((state) => ({
    scenes: state.scenes.map((scene) =>
      scene.id === state.activeSceneId
        ? {
            ...scene,
            objects: scene.objects.map((o) =>
              o.id === id ? { ...o, model: { enabled: true, specId } } : o,
            ),
          }
        : scene,
    ),
  }));
  return id;
}
export function buildRiftMap(parent: string): void {
  const s = useEditorStore.getState();
  const p: ModelPart[] = [];
  const add = (...args: Parameters<typeof artPart>) => p.push(artPart(...args));
  add('box', [0, -1.3, 0], [88, 2.3, 88], 3);
  add('box', [0, -0.25, 0], [86, 0.5, 86], 0);
  // Land patches break up the large silhouette; winding worn stone routes remain easy to read.
  for (let x = -38; x <= 38; x += 9)
    for (let z = -38; z <= 38; z += 9)
      add(
        'cylinder',
        [x, 0.035, z],
        [12, 0.06, 11],
        (Math.abs(x + z) % 3) + 0,
        [0, (x * z) % 6, 0],
      );
  // River runs across the map, perpendicular to mid; fords stay at gameplay ground height.
  add('box', [0, 0.02, 0], [9, 0.12, 108], 8, [0, -Math.PI / 4, 0]);
  add('box', [0, 0.09, 0], [6.6, 0.1, 108], 9, [0, -Math.PI / 4, 0]);
  for (let i = -32; i <= 32; i += 5)
    add('box', [i, 0.15, -i + 1], [2.7, 0.04, 0.15], 10, [0, -0.3, 0]);
  for (let lane = 0; lane < 3; lane++) {
    const points = laneRoutes[lane];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i],
        dx = b[0] - a[0],
        dz = b[2] - a[2],
        d = Math.hypot(dx, dz),
        yaw = Math.atan2(dx, dz);
      add(
        'box',
        [(a[0] + b[0]) / 2, 0.12, (a[2] + b[2]) / 2],
        [7, 0.2, d + 1],
        7,
        [0, yaw, 0],
      );
      add(
        'box',
        [(a[0] + b[0]) / 2, 0.24, (a[2] + b[2]) / 2],
        [6.1, 0.16, d + 0.5],
        4,
        [0, yaw, 0],
      );
      for (let t = 1; t < d; t += 3) {
        const x = a[0] + (dx * t) / d,
          z = a[2] + (dz * t) / d;
        for (const side of [-1, 1])
          add(
            'box',
            [
              x + Math.cos(yaw) * side * 1.55,
              0.34,
              z - Math.sin(yaw) * side * 1.55,
            ],
            [2.8, 0.08, 2.6],
            (Math.floor(t) + lane) % 3 === 0 ? 6 : 5,
            [0, yaw + side * 0.015, 0],
          );
      }
    }
  }
  // Two citadels with engraved terraces, radiating steps and defensive parapets.
  for (const team of [1, -1]) {
    const c = team * 30,
      tint = team === 1 ? 16 : 17;
    add('cylinder', [c, 0.25, c], [17, 0.5, 17], 7);
    add('cylinder', [c, 0.5, c], [15, 0.4, 15], 5);
    add('cylinder', [c, 0.73, c], [11, 0.1, 11], 4);
    add('torus', [c, 0.83, c], [8, 8, 0.12], tint, [Math.PI / 2, 0, 0]);
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      add(
        'box',
        [c + Math.cos(a) * 6, 0.78, c + Math.sin(a) * 6],
        [1.5, 0.13, 1.5],
        6,
        [0, -a, 0],
      );
      if (i % 2 === 0) {
        add(
          'hexprism',
          [c + Math.cos(a) * 8, 1.3, c + Math.sin(a) * 8],
          [1.5, 2.3, 1.5],
          4,
        );
        add(
          'pyramid',
          [c + Math.cos(a) * 8, 2.7, c + Math.sin(a) * 8],
          [1.9, 0.8, 1.9],
          15,
        );
      }
    }
  }
  for (let lane = 0; lane < 3; lane++)
    for (let n = 0; n < 34; n++) {
      const route = laneRoutes[lane],
        segment = 1 + (n % (route.length - 1)),
        a = route[segment - 1],
        b = route[segment],
        t = (Math.floor(n / (route.length - 1)) + 0.4) / 7;
      const dx = b[0] - a[0],
        dz = b[2] - a[2],
        d = Math.hypot(dx, dz),
        side = n % 2 ? 1 : -1,
        x = a[0] + ((dx * t) / d) * d + (dz / d) * 3.7 * side,
        z = a[2] + ((dz * t) / d) * d - (dx / d) * 3.7 * side;
      add(
        'hexprism',
        [x, 0.3, z],
        [0.5 + (n % 3) * 0.2, 0.55, 0.7],
        n % 3 === 0 ? 5 : 4,
        [0.12, n * 0.7, 0.1],
      );
      add('cone', [x + 0.5, 0.32, z - 0.3], [0.4, 0.8, 0.4], 13, [0, n, 0]);
    }
  makeArt(
    'Rift · River, three lanes and citadel terraces',
    p,
    RIFT_PALETTE,
    parent,
  );
  // Seeded placement: dense forest islands separated by real jungle corridors, no scatter over lanes.
  let seed = 147;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const forest: ModelPart[] = [];
  const tree = (x: number, z: number, h: number) => {
    forest.push(artPart('hexprism', [x, h * 0.3, z], [0.55, h * 0.6, 0.55], 7));
    for (let i = 0; i < 3; i++)
      forest.push(
        artPart(
          'cone',
          [x, h * (0.48 + i * 0.17), z],
          [h * (0.62 - i * 0.12), h * 0.55, h * (0.62 - i * 0.12)],
          11 + i,
        ),
      );
    forest.push(
      artPart('cone', [x, h * 0.96, z], [h * 0.21, h * 0.29, h * 0.21], 14),
    );
  };
  for (const [cx, cz] of [
    [16, -3],
    [3, -16],
    [-16, 3],
    [-3, 16],
    [19, 5],
    [5, 19],
    [-19, -5],
    [-5, -19],
  ]) {
    for (let i = 0; i < 6; i++) {
      const a = i * 2.4,
        r = 1.3 + rand() * 3.3;
      tree(cx + Math.cos(a) * r, cz + Math.sin(a) * r, 4.4 + rand() * 2.3);
    }
    const block = s.createObjectWithProps('cube', {
      name: 'Jungle · Impassable grove',
      position: [cx, 1, cz],
      parentId: parent,
    });
    s.updateTransform(block, 'scale', [5, 2, 5]);
    s.updatePhysics(block, {
      enabled: true,
      bodyType: 'fixed',
      collider: 'box',
    });
    s.updateRenderer(block, { hideInPlay: true });
  }
  for (const [x, z] of [
    [21, -2],
    [-2, 21],
    [-21, 2],
    [2, -21],
  ]) {
    forest.push(artPart('hexprism', [x, 1.7, z], [0.65, 3.4, 0.65], 7));
    for (let i = 0; i < 5; i++) {
      const a = i * 2.4;
      forest.push(
        artPart(
          'hexprism',
          [x + Math.cos(a) * 1.15, 3.2 + (i % 2) * 0.8, z + Math.sin(a) * 1.15],
          [2.8, 1.4, 2.8],
          12 + (i % 3),
          [0.1, a, 0.1],
        ),
      );
    }
  }
  for (let n = 0; n < 44; n++) {
    const side = n % 4,
      t = -39 + Math.floor(n / 4) * 7.6;
    tree(
      side < 2 ? (side === 0 ? -40 : 40) : t,
      side < 2 ? t : side === 2 ? -40 : 40,
      5 + rand() * 3,
    );
  }
  for (let i = 0; i < 60; i++) {
    const x = (rand() - 0.5) * 76,
      z = (rand() - 0.5) * 76;
    if (
      Math.abs(x - z) < 6 ||
      Math.abs(Math.abs(x) - 30) < 5 ||
      Math.abs(Math.abs(z) - 30) < 5 ||
      Math.hypot(x - 30, z - 30) < 11 ||
      Math.hypot(x + 30, z + 30) < 11
    )
      continue;
    forest.push(
      artPart(
        'hexprism',
        [x, 0.45, z],
        [1 + rand() * 1.6, 1 + rand(), 1 + rand() * 1.8],
        4,
        [0.15, rand() * 5, 0.2],
      ),
    );
    forest.push(artPart('cone', [x + 1, 0.35, z + 0.6], [0.7, 0.8, 0.7], 13));
  }
  makeArt(
    'Rift · Ancient pines, moss and river stones',
    forest,
    RIFT_PALETTE,
    parent,
  );
  const landmarks: ModelPart[] = [];
  for (const [x, z] of [
    [18, -18],
    [-18, 18],
  ]) {
    landmarks.push(
      artPart('cylinder', [x, 0.23, z], [8, 0.4, 8], 7),
      artPart('torus', [x, 0.49, z], [6, 6, 0.3], 15, [Math.PI / 2, 0, 0]),
    );
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      landmarks.push(
        artPart(
          'hexprism',
          [x + Math.cos(a) * 4, 1, z + Math.sin(a) * 4],
          [0.8, 2, 0.8],
          5,
        ),
      );
    }
    landmarks.push(
      artPart('pyramid', [x, 1.3, z], [1.8, 2.5, 1.8], 16),
      artPart('pyramid', [x, 3, z], [1.8, 1.3, 1.8], 10, [Math.PI, 0, 0]),
    );
  }
  for (const [x, z] of [
    [7, -7],
    [-7, 7],
    [28, 0],
    [0, 28],
    [-28, 0],
    [0, -28],
  ]) {
    landmarks.push(
      artPart('hexprism', [x, 1, z], [0.55, 2, 0.55], 7),
      artPart('pyramid', [x, 2.3, z], [1.1, 0.7, 1.1], 15),
      artPart('sphere', [x, 2.7, z], [0.45, 0.65, 0.45], 18),
    );
  }
  makeArt(
    'Rift · Jungle shrines and crossing lanterns',
    landmarks,
    RIFT_PALETTE,
    parent,
  );
}
