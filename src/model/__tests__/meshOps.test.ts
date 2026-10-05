import { describe, expect, it } from 'vitest';
import type { ModelPartMesh } from '../../types';
import {
  UNIT_CUBE_POLY,
  buildTopology,
  makePolyMesh,
  polygonCenter,
  polygonNormal,
  type Vec3,
} from '../polyMesh';
import {
  bevelEdges,
  bevelVertices,
  bisectMesh,
  knifeCut,
  bridgeEdgeLoops,
  deleteFaces,
  deleteVertices,
  dissolveEdges,
  dissolveVertices,
  edgesToVertices,
  extrudeFaces,
  extrudeFacesIndividual,
  facesToVertices,
  fillHole,
  flipFaces,
  growSelection,
  insetFaces,
  loopCut,
  mergeVertices,
  mirrorMeshDestructive,
  moveVertices,
  proportionalWeights,
  recalculateNormalsOutside,
  selectEdgeLoop,
  selectEdgeRing,
  selectFaceLoop,
  selectLinked,
  shrinkSelection,
  subdivideFaces,
  symmetryMap,
  verticesToEdges,
  verticesToFaces,
} from '../meshOps';

// ------------------------------------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------------------------------------

/** Signed volume from the derived triangulation (divergence theorem) — positive = outward winding. */
function signedVolume(mesh: ModelPartMesh): number {
  let volume = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = mesh.vertices[mesh.indices[i]];
    const b = mesh.vertices[mesh.indices[i + 1]];
    const c = mesh.vertices[mesh.indices[i + 2]];
    volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return volume;
}

/** Every edge has exactly two faces that traverse it in opposite directions. */
function expectClosedConsistent(mesh: ModelPartMesh): void {
  const faces = mesh.faces!;
  const topo = buildTopology(mesh);
  expect(topo.edgeFaces.every((list) => list.length === 2)).toBe(true);
  const directed = new Set<string>();
  for (const loop of faces) {
    expect(new Set(loop).size).toBe(loop.length);
    expect(loop.length).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < loop.length; i += 1) {
      const key = `${loop[i]}>${loop[(i + 1) % loop.length]}`;
      expect(directed.has(key)).toBe(false);
      directed.add(key);
    }
  }
  // No vertex left unused.
  const used = new Set(faces.flat());
  expect(used.size).toBe(mesh.vertices.length);
  expect(mesh.indices.length % 3).toBe(0);
}

function boundaryEdgeCount(mesh: ModelPartMesh): number {
  return buildTopology(mesh).edgeFaces.filter((list) => list.length === 1).length;
}

/** n×n quad grid in the XZ plane facing +Y, spanning [-0.5, 0.5]. Vertex (i, j) = i * (n+1) + j. */
function grid(n: number): ModelPartMesh {
  const vertices: Vec3[] = [];
  for (let i = 0; i <= n; i += 1) for (let j = 0; j <= n; j += 1) vertices.push([i / n - 0.5, 0, j / n - 0.5]);
  const id = (i: number, j: number) => i * (n + 1) + j;
  const faces: number[][] = [];
  for (let i = 0; i < n; i += 1) for (let j = 0; j < n; j += 1) faces.push([id(i, j), id(i, j + 1), id(i + 1, j + 1), id(i + 1, j)]);
  return makePolyMesh(vertices, faces);
}

function translate(mesh: ModelPartMesh, offset: Vec3): ModelPartMesh {
  return makePolyMesh(
    mesh.vertices.map((p) => [p[0] + offset[0], p[1] + offset[1], p[2] + offset[2]] as Vec3),
    mesh.faces!.map((loop) => [...loop]),
    { faceSlots: mesh.faceSlots },
  );
}

function combine(a: ModelPartMesh, b: ModelPartMesh): ModelPartMesh {
  const n = a.vertices.length;
  return makePolyMesh([...a.vertices, ...b.vertices], [...a.faces!, ...b.faces!.map((loop) => loop.map((v) => v + n))]);
}

const slottedCube = (): ModelPartMesh =>
  makePolyMesh(UNIT_CUBE_POLY.vertices, UNIT_CUBE_POLY.faces!, { faceSlots: [0, 1, 2, 3, 4, 5] });
const cubeWithUVs = (): ModelPartMesh =>
  makePolyMesh(UNIT_CUBE_POLY.vertices, UNIT_CUBE_POLY.faces!, {
    faceUVs: UNIT_CUBE_POLY.faces!.map(() => [[0, 0], [1, 0], [1, 1], [0, 1]] as Array<[number, number]>),
  });
const TOP = 4; // +Y face of UNIT_CUBE_POLY
const PLUS_X = 2;

// ------------------------------------------------------------------------------------------------
// Extrude
// ------------------------------------------------------------------------------------------------

describe('extrude', () => {
  it('extrudes one cube face into a closed 10-face box', () => {
    const { mesh, faces, vertices } = extrudeFaces(UNIT_CUBE_POLY, [TOP], 0.5);
    expect(mesh.faces).toHaveLength(10);
    expect(mesh.vertices).toHaveLength(12);
    expectClosedConsistent(mesh);
    expect(signedVolume(mesh)).toBeCloseTo(1.5, 6);
    expect(faces).toEqual([TOP]);
    expect(vertices).toHaveLength(4);
    for (const v of mesh.faces![TOP]) expect(mesh.vertices[v][1]).toBeCloseTo(1, 6);
    expect(polygonNormal(mesh.vertices, mesh.faces![TOP])[1]).toBeCloseTo(1, 6);
  });

  it('new side faces inherit the slot of the face they grew from', () => {
    const { mesh } = extrudeFaces(slottedCube(), [TOP], 0.25);
    expect(mesh.faceSlots!.slice(0, 6)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(mesh.faceSlots!.slice(6)).toEqual([4, 4, 4, 4]);
  });

  it('region-extrudes two adjacent faces as one shell (no wall between them)', () => {
    const { mesh } = extrudeFaces(UNIT_CUBE_POLY, [TOP, PLUS_X], 0.2);
    expect(mesh.vertices).toHaveLength(14);
    expect(mesh.faces).toHaveLength(12);
    expectClosedConsistent(mesh);
    expect(signedVolume(mesh)).toBeGreaterThan(1);
    // The shared-edge vertices move out by 0.2 along both normals.
    const corner = mesh.vertices.find((p) => Math.abs(p[0] - 0.7) < 1e-6 && Math.abs(p[1] - 0.7) < 1e-6);
    expect(corner).toBeDefined();
  });

  it('extrudes individual faces separately', () => {
    const { mesh, faces } = extrudeFacesIndividual(UNIT_CUBE_POLY, [TOP, PLUS_X], 0.2);
    expect(mesh.vertices).toHaveLength(16);
    expect(mesh.faces).toHaveLength(14);
    expect(faces).toEqual([PLUS_X, TOP]);
    expectClosedConsistent(mesh);
  });

  it('works on triangle-only payloads and never mutates the input', () => {
    const tri: ModelPartMesh = { vertices: UNIT_CUBE_POLY.vertices.map((p) => [...p] as Vec3), indices: [...UNIT_CUBE_POLY.indices] };
    const snapshot = JSON.stringify(tri);
    const { mesh } = extrudeFaces(tri, [0], 0.3);
    expectClosedConsistent(mesh);
    expect(signedVolume(mesh)).toBeCloseTo(1.3, 6);
    expect(JSON.stringify(tri)).toBe(snapshot);
  });

  it('extrudes an open grid region with walls only on the region border', () => {
    const { mesh } = extrudeFaces(grid(3), [4], 0.1); // centre quad
    expect(mesh.faces).toHaveLength(9 + 4);
    expect(boundaryEdgeCount(mesh)).toBe(12);
  });
});

// ------------------------------------------------------------------------------------------------
// Inset
// ------------------------------------------------------------------------------------------------

describe('inset', () => {
  it('insets one cube face into an inner face + 4 rim quads', () => {
    const { mesh, faces } = insetFaces(UNIT_CUBE_POLY, [TOP], 0.1);
    expect(mesh.faces).toHaveLength(10);
    expect(mesh.vertices).toHaveLength(12);
    expectClosedConsistent(mesh);
    expect(signedVolume(mesh)).toBeCloseTo(1, 6);
    expect(faces).toEqual([TOP]);
    for (const v of mesh.faces![TOP]) {
      expect(Math.abs(mesh.vertices[v][0])).toBeCloseTo(0.4, 6);
      expect(Math.abs(mesh.vertices[v][2])).toBeCloseTo(0.4, 6);
    }
  });

  it('pushes the inner face with depth', () => {
    const { mesh } = insetFaces(UNIT_CUBE_POLY, [TOP], 0.1, { depth: 0.2 });
    expectClosedConsistent(mesh);
    // Frustum on top of the unit cube: h/3 (A1 + A2 + sqrt(A1 A2)).
    expect(signedVolume(mesh)).toBeCloseTo(1 + (0.2 / 3) * (1 + 0.64 + 0.8), 6);
  });

  it('region inset keeps interior vertices and only rims the border', () => {
    const base = grid(2);
    const { mesh, faces } = insetFaces(base, [0, 1, 2, 3], 0.1);
    expect(mesh.faces).toHaveLength(4 + 8);
    expect(faces).toEqual([0, 1, 2, 3]);
    expect(boundaryEdgeCount(mesh)).toBe(8);
    // The shared centre vertex is untouched.
    expect(mesh.vertices.some((p) => p[0] === 0 && p[2] === 0)).toBe(true);
  });

  it('individual inset rims every face', () => {
    const { mesh } = insetFaces(UNIT_CUBE_POLY, [0, 1, 2, 3, 4, 5], 0.1, { individual: true });
    expect(mesh.faces).toHaveLength(30);
    expectClosedConsistent(mesh);
    expect(signedVolume(mesh)).toBeCloseTo(1, 6);
  });
});

// ------------------------------------------------------------------------------------------------
// Bevel
// ------------------------------------------------------------------------------------------------

const cubeEdges = (): Array<[number, number]> => buildTopology(UNIT_CUBE_POLY).edges;

describe('bevel', () => {
  it('chamfers all 12 cube edges into a closed 26-face mesh', () => {
    const { mesh, faces } = bevelEdges(UNIT_CUBE_POLY, cubeEdges(), 0.1);
    expect(mesh.faces).toHaveLength(26);
    expect(mesh.vertices).toHaveLength(24);
    expectClosedConsistent(mesh);
    // Volume = 1 − 12 prisms (0.005 × 0.8) − 8 corner cut-offs.
    const v = signedVolume(mesh);
    expect(v).toBeGreaterThan(0.9);
    expect(v).toBeLessThan(1);
    expect(faces).toHaveLength(20);
    expect(mesh.faces!.filter((l) => l.length === 3)).toHaveLength(8);
  });

  it('chamfers a single edge (pentagon end caps)', () => {
    const { mesh, faces } = bevelEdges(UNIT_CUBE_POLY, [cubeEdges()[0]], 0.2);
    expect(mesh.faces).toHaveLength(7);
    expect(mesh.vertices).toHaveLength(10);
    expectClosedConsistent(mesh);
    expect(signedVolume(mesh)).toBeCloseTo(1 - 0.5 * 0.2 * 0.2, 6);
    expect(faces).toHaveLength(1);
    expect(mesh.faces!.filter((l) => l.length === 5)).toHaveLength(2);
  });

  it('miters two beveled edges meeting at a corner', () => {
    const topo = buildTopology(UNIT_CUBE_POLY);
    const [e0] = topo.edges;
    const second = topo.edges.find((e) => e !== e0 && (e.includes(e0[0]) || e.includes(e0[1])))!;
    const { mesh } = bevelEdges(UNIT_CUBE_POLY, [e0, second], 0.15);
    expectClosedConsistent(mesh);
    expect(mesh.faces).toHaveLength(8);
  });

  it('bevels three edges of one corner with a corner triangle', () => {
    const topo = buildTopology(UNIT_CUBE_POLY);
    const edges = topo.vertexEdges[6].map((e) => topo.edges[e]);
    const { mesh } = bevelEdges(UNIT_CUBE_POLY, edges, 0.1);
    expectClosedConsistent(mesh);
    expect(mesh.faces).toHaveLength(6 + 3 + 1);
  });

  it('rounds the profile with segments > 1 and stays closed', () => {
    const one = bevelEdges(UNIT_CUBE_POLY, [cubeEdges()[0]], 0.2, 4);
    expectClosedConsistent(one.mesh);
    expect(one.faces).toHaveLength(4);
    // An arc removes less than the flat chamfer but more than nothing.
    const v1 = signedVolume(one.mesh);
    expect(v1).toBeLessThan(1);
    expect(v1).toBeGreaterThan(1 - 0.5 * 0.2 * 0.2);
    expect(v1).toBeCloseTo(1 - (0.04 - Math.PI * 0.01) * 1, 2);

    const all = bevelEdges(UNIT_CUBE_POLY, cubeEdges(), 0.1, 3);
    expectClosedConsistent(all.mesh);
    expect(signedVolume(all.mesh)).toBeGreaterThan(signedVolume(bevelEdges(UNIT_CUBE_POLY, cubeEdges(), 0.1).mesh));
  });

  it('bevels a run of grid edges and keeps the open border intact', () => {
    // Middle column line of a closed shape: subdivided cube top so interior vertices are valence 4.
    const sub = subdivideFaces(UNIT_CUBE_POLY, [0, 1, 2, 3, 4, 5], 1).mesh;
    const loop = selectEdgeLoop(sub, buildTopology(sub).edges.find(([a, b]) => {
      const pa = sub.vertices[a];
      const pb = sub.vertices[b];
      return Math.abs(pa[0]) < 1e-9 && Math.abs(pb[0]) < 1e-9;
    })!);
    expect(loop).toHaveLength(8);
    const { mesh } = bevelEdges(sub, loop, 0.1);
    expectClosedConsistent(mesh);
    expect(mesh.faces).toHaveLength(24 + 8);
    expect(signedVolume(mesh)).toBeCloseTo(1, 6);
  });

  it('handles valence-4 ends, straight runs with segments and dense selections', () => {
    const sub = subdivideFaces(UNIT_CUBE_POLY, [0, 1, 2, 3, 4, 5], 1).mesh;
    const topo = buildTopology(sub);
    // A single edge ending at a valence-4 vertex (face centre) gets a corner patch there.
    const toCentre = topo.edges.find(([a, b]) => topo.vertexEdges[a].length === 4 || topo.vertexEdges[b].length === 4)!;
    for (const segments of [1, 3]) {
      const single = bevelEdges(sub, [toCentre], 0.1, segments).mesh;
      expectClosedConsistent(single);
      expect(signedVolume(single)).toBeLessThanOrEqual(1 + 1e-9);
    }
    for (const segments of [1, 2, 4]) {
      const all = bevelEdges(sub, topo.edges, 0.05, segments).mesh;
      expectClosedConsistent(all);
      expect(signedVolume(all)).toBeGreaterThan(0.9);
    }
  });

  it('skips edges on open borders instead of breaking topology', () => {
    const open = deleteFaces(UNIT_CUBE_POLY, [TOP]).mesh;
    const border = buildTopology(open).edges.filter((_, e) => buildTopology(open).edgeFaces[e].length === 1);
    const { mesh } = bevelEdges(open, border, 0.1);
    expect(mesh).toBe(open);
  });

  it('bevels a vertex into a corner triangle', () => {
    const { mesh, faces } = bevelVertices(UNIT_CUBE_POLY, [6], 0.2);
    expect(mesh.faces).toHaveLength(7);
    expect(mesh.vertices).toHaveLength(10);
    expect(faces).toHaveLength(1);
    expectClosedConsistent(mesh);
    expect(signedVolume(mesh)).toBeCloseTo(1 - 0.2 ** 3 / 6, 6);
  });
});

// ------------------------------------------------------------------------------------------------
// Loop cut + selection
// ------------------------------------------------------------------------------------------------

describe('loop cut', () => {
  it('cuts around the middle of a cube', () => {
    const { mesh, edges, vertices } = loopCut(UNIT_CUBE_POLY, [0, 1], 1);
    expect(mesh.faces).toHaveLength(10);
    expect(mesh.vertices).toHaveLength(12);
    expectClosedConsistent(mesh);
    expect(signedVolume(mesh)).toBeCloseTo(1, 6);
    expect(edges).toHaveLength(4);
    expect(vertices).toHaveLength(4);
    for (const v of vertices!) expect(mesh.vertices[v][0]).toBeCloseTo(0, 6);
    // The new loop is itself an edge loop (valence-4 vertices).
    expect(selectEdgeLoop(mesh, edges![0])).toHaveLength(4);
  });

  it('supports multiple cuts and a slide factor', () => {
    const multi = loopCut(UNIT_CUBE_POLY, [0, 1], 3);
    expect(multi.mesh.faces).toHaveLength(18);
    expect(multi.mesh.vertices).toHaveLength(20);
    expect(multi.edges).toHaveLength(12);
    expectClosedConsistent(multi.mesh);
    const slid = loopCut(UNIT_CUBE_POLY, [0, 1], 1, 0.25);
    for (const v of slid.vertices!) expect(slid.mesh.vertices[v][0]).toBeCloseTo(-0.25, 6);
  });

  it('cuts an open ring across a grid', () => {
    const g = grid(3);
    const { mesh, edges } = loopCut(g, [5, 6], 1); // interior edge (1,1)-(1,2)
    expect(mesh.faces).toHaveLength(12);
    expect(mesh.vertices).toHaveLength(20);
    expect(edges).toHaveLength(3);
    expect(boundaryEdgeCount(mesh)).toBe(14);
    expect(buildTopology(mesh).edgeFaces.every((l) => l.length <= 2)).toBe(true);
  });

  it('inserts the cut vertex into a non-quad neighbour (no T-junction)', () => {
    // Two quads + a triangle pair at the end of the ring.
    const vertices: Vec3[] = [
      [0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0],
      [0, 0, 1], [1, 0, 1], [2, 0, 1], [3, 0, 1],
    ];
    const faces = [[0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7], [2, 7, 3]];
    const mesh0 = makePolyMesh(vertices, faces);
    const { mesh } = loopCut(mesh0, [0, 4], 1);
    expect(mesh.faces).toHaveLength(6);
    expect(mesh.faces!.some((l) => l.length === 4 && l.includes(2) && l.includes(6) && l.includes(7))).toBe(true);
    // Only the open start edge gains a boundary segment; the triangle side stays shared.
    expect(boundaryEdgeCount(mesh)).toBe(boundaryEdgeCount(mesh0) + 1);
    expect(buildTopology(mesh).edgeFaces.every((l) => l.length <= 2)).toBe(true);
  });

  it('interpolates UVs and carries slots', () => {
    const { mesh } = loopCut(cubeWithUVs(), [0, 1], 1);
    expect(mesh.faceUVs).toHaveLength(10);
    expect(mesh.faceUVs!.flat().some(([u, v]) => u === 0.5 || v === 0.5)).toBe(true);
    const slotted = loopCut(slottedCube(), [0, 1], 1).mesh;
    expect(slotted.faceSlots).toHaveLength(10);
    expect(new Set(slotted.faceSlots)).toEqual(new Set([0, 1, 2, 3, 4, 5]));
  });
});

describe('selection helpers', () => {
  it('walks edge loops through valence-4 vertices and stops at poles', () => {
    expect(selectEdgeLoop(UNIT_CUBE_POLY, [0, 1])).toEqual([[0, 1]]);
    const g = grid(4);
    expect(selectEdgeLoop(g, [6, 7])).toHaveLength(4); // column i = 1
    expect(selectEdgeLoop(g, [0, 1])).toHaveLength(16); // boundary loop
  });

  it('selects edge rings and face loops', () => {
    expect(selectEdgeRing(UNIT_CUBE_POLY, [0, 1])).toHaveLength(4);
    expect(selectFaceLoop(UNIT_CUBE_POLY, [0, 1]).sort()).toEqual([0, 1, 4, 5]);
    expect(selectEdgeRing(grid(3), [5, 6])).toHaveLength(4);
    expect(selectFaceLoop(grid(3), [5, 6])).toHaveLength(3);
  });

  it('selects linked islands', () => {
    const two = combine(UNIT_CUBE_POLY, translate(UNIT_CUBE_POLY, [3, 0, 0]));
    expect(selectLinked(two, [0])).toEqual([0, 1, 2, 3, 4, 5]);
    expect(selectLinked(two, [7])).toEqual([6, 7, 8, 9, 10, 11]);
  });

  it('grows and shrinks vertex selections', () => {
    const g = grid(4);
    const centre = 12;
    const grown = growSelection(g, [centre]);
    expect(grown).toHaveLength(9);
    expect(shrinkSelection(g, grown)).toEqual([centre]);
    expect(growSelection(g, grown)).toHaveLength(25);
  });

  it('converts between selection modes', () => {
    expect(facesToVertices(UNIT_CUBE_POLY, [TOP])).toEqual([2, 3, 6, 7]);
    expect(edgesToVertices([[3, 1], [1, 2]])).toEqual([1, 2, 3]);
    expect(verticesToFaces(UNIT_CUBE_POLY, [2, 3, 6, 7])).toEqual([TOP]);
    expect(verticesToFaces(UNIT_CUBE_POLY, [6], false)).toHaveLength(3);
    expect(verticesToEdges(UNIT_CUBE_POLY, [2, 3, 6, 7])).toHaveLength(4);
  });
});

// ------------------------------------------------------------------------------------------------
// Merge / delete / dissolve
// ------------------------------------------------------------------------------------------------

describe('merge, delete, dissolve', () => {
  it('merges the top of a cube into a closed pyramid', () => {
    const { mesh, vertices } = mergeVertices(UNIT_CUBE_POLY, [2, 3, 6, 7], 'center');
    expect(mesh.faces).toHaveLength(5);
    expect(mesh.vertices).toHaveLength(5);
    expectClosedConsistent(mesh);
    expect(signedVolume(mesh)).toBeCloseTo(1 / 3, 6);
    expect(vertices).toHaveLength(1);
    expect(mesh.vertices[vertices![0]]).toEqual([0, 0.5, 0]);
  });

  it('merges at first / last / cursor', () => {
    expect(mergeVertices(UNIT_CUBE_POLY, [6, 7], 'first').mesh.vertices).toContainEqual([0.5, 0.5, 0.5]);
    expect(mergeVertices(UNIT_CUBE_POLY, [6, 7], 'last').mesh.vertices).toContainEqual([-0.5, 0.5, 0.5]);
    const cursor = mergeVertices(UNIT_CUBE_POLY, [6, 7], 'cursor', [0, 2, 0]);
    expect(cursor.mesh.vertices[cursor.vertices![0]]).toEqual([0, 2, 0]);
    expectClosedConsistent(cursor.mesh);
  });

  it('deletes faces and vertices, compacting what is left', () => {
    const noTop = deleteFaces(slottedCube(), [TOP]).mesh;
    expect(noTop.faces).toHaveLength(5);
    expect(noTop.vertices).toHaveLength(8);
    expect(boundaryEdgeCount(noTop)).toBe(4);
    expect(noTop.faceSlots).toEqual([0, 1, 2, 3, 5]);
    const noCorner = deleteVertices(UNIT_CUBE_POLY, [6]).mesh;
    expect(noCorner.faces).toHaveLength(3);
    expect(noCorner.vertices).toHaveLength(7);
  });

  it('dissolves a loop-cut loop back into the cube', () => {
    const cut = loopCut(UNIT_CUBE_POLY, [0, 1], 1);
    const { mesh, faces } = dissolveEdges(cut.mesh, cut.edges!);
    expect(mesh.faces).toHaveLength(6);
    expect(mesh.vertices).toHaveLength(8);
    expect(faces).toHaveLength(4);
    expectClosedConsistent(mesh);
    expect(signedVolume(mesh)).toBeCloseTo(1, 6);
  });

  it('dissolves one cube edge (endpoints become 2-valence and go too)', () => {
    const { mesh } = dissolveEdges(UNIT_CUBE_POLY, [[2, 6]]);
    expect(mesh.faces).toHaveLength(5);
    expect(mesh.vertices).toHaveLength(6);
    expectClosedConsistent(mesh);
  });

  it('dissolves vertices', () => {
    const g = grid(2);
    const { mesh, faces } = dissolveVertices(g, [4]);
    expect(mesh.faces).toHaveLength(1);
    expect(mesh.faces![0]).toHaveLength(8);
    expect(faces).toEqual([0]);
    expect(polygonNormal(mesh.vertices, mesh.faces![0])[1]).toBeCloseTo(1, 6);
    // A 2-valence vertex on a straight edge simply disappears.
    const cut = loopCut(grid(1), [0, 1], 1);
    const mid = cut.vertices![0];
    expect(dissolveVertices(cut.mesh, [mid]).mesh.vertices).toHaveLength(cut.mesh.vertices.length - 1);
  });
});

// ------------------------------------------------------------------------------------------------
// Normals
// ------------------------------------------------------------------------------------------------

describe('normals', () => {
  it('flips faces and recalculates them outward', () => {
    const flippedOne = flipFaces(cubeWithUVs(), [TOP]).mesh;
    expect(polygonNormal(flippedOne.vertices, flippedOne.faces![TOP])[1]).toBeCloseTo(-1, 6);
    expect(flippedOne.faceUVs![TOP]).toEqual([[0, 1], [1, 1], [1, 0], [0, 0]]);
    const fixed = recalculateNormalsOutside(flippedOne);
    expect(fixed.faces).toEqual([TOP]);
    expectClosedConsistent(fixed.mesh);
    expect(signedVolume(fixed.mesh)).toBeCloseTo(1, 6);

    const inside = flipFaces(UNIT_CUBE_POLY, [0, 1, 2, 3, 4, 5]).mesh;
    expect(signedVolume(inside)).toBeCloseTo(-1, 6);
    const out = recalculateNormalsOutside(inside);
    expect(out.faces).toHaveLength(6);
    expect(signedVolume(out.mesh)).toBeCloseTo(1, 6);
  });

  it('fixes mixed windings on an off-origin mesh', () => {
    const moved = translate(UNIT_CUBE_POLY, [5, 2, -3]);
    const broken = flipFaces(moved, [0, 2, 5]).mesh;
    const { mesh } = recalculateNormalsOutside(broken);
    expectClosedConsistent(mesh);
    expect(signedVolume(mesh)).toBeCloseTo(1, 6);
  });
});

// ------------------------------------------------------------------------------------------------
// Subdivide
// ------------------------------------------------------------------------------------------------

describe('subdivide', () => {
  it('subdivides every cube face into a closed 24-quad mesh', () => {
    const { mesh, faces } = subdivideFaces(UNIT_CUBE_POLY, [0, 1, 2, 3, 4, 5], 1);
    expect(mesh.faces).toHaveLength(24);
    expect(mesh.vertices).toHaveLength(26);
    expect(faces).toHaveLength(24);
    expectClosedConsistent(mesh);
    expect(signedVolume(mesh)).toBeCloseTo(1, 6);
  });

  it('keeps neighbours watertight when subdividing one face', () => {
    const one = subdivideFaces(slottedCube(), [TOP], 1);
    expect(one.mesh.faces).toHaveLength(9);
    expect(one.mesh.vertices).toHaveLength(13);
    expectClosedConsistent(one.mesh);
    expect(one.mesh.faces!.filter((l) => l.length === 5)).toHaveLength(4);
    expect(one.mesh.faceSlots!.filter((s) => s === 4)).toHaveLength(4);
    const two = subdivideFaces(UNIT_CUBE_POLY, [TOP], 2);
    expect(two.mesh.faces).toHaveLength(14);
    expectClosedConsistent(two.mesh);
  });

  it('subdivides triangles and n-gons', () => {
    const triCube: ModelPartMesh = makePolyMesh(
      UNIT_CUBE_POLY.vertices,
      UNIT_CUBE_POLY.faces!.flatMap(([a, b, c, d]) => [[a, b, c], [a, c, d]]),
    );
    const tris = subdivideFaces(triCube, triCube.faces!.map((_, i) => i), 1).mesh;
    expect(tris.faces).toHaveLength(48);
    expectClosedConsistent(tris);
    expect(signedVolume(tris)).toBeCloseTo(1, 6);
    const tris3 = subdivideFaces(triCube, [0], 3).mesh;
    expect(tris3.faces).toHaveLength(11 + 16);
    expectClosedConsistent(tris3);

    const pentagon = makePolyMesh(
      Array.from({ length: 5 }, (_, i) => [Math.cos((i * 2 * Math.PI) / 5), 0, -Math.sin((i * 2 * Math.PI) / 5)] as Vec3),
      [[0, 1, 2, 3, 4]],
    );
    const quads = subdivideFaces(pentagon, [0], 1).mesh;
    expect(quads.faces).toHaveLength(5);
    expect(quads.faces!.every((l) => l.length === 4)).toBe(true);
    expect(subdivideFaces(pentagon, [0], 2).mesh.faces).toHaveLength(15);
  });

  it('interpolates UVs', () => {
    const { mesh } = subdivideFaces(cubeWithUVs(), [0, 1, 2, 3, 4, 5], 1);
    expect(mesh.faceUVs).toHaveLength(24);
    expect(mesh.faceUVs!.flat()).toContainEqual([0.5, 0.5]);
  });

  it('returns the input unchanged when the result would exceed the mesh limits', () => {
    const dense = subdivideFaces(UNIT_CUBE_POLY, [0, 1, 2, 3, 4, 5], 31).mesh;
    expect(dense.faces).toHaveLength(6 * 32 * 32);
    const all = dense.faces!.map((_, i) => i);
    expect(subdivideFaces(dense, all, 2).mesh).toBe(dense);
  });
});

// ------------------------------------------------------------------------------------------------
// Fill / bridge
// ------------------------------------------------------------------------------------------------

describe('fill and bridge', () => {
  it('fills a hole with one correctly wound n-gon', () => {
    const open = deleteFaces(slottedCube(), [TOP]).mesh;
    const { mesh, faces } = fillHole(open, [2]);
    expect(mesh.faces).toHaveLength(6);
    expectClosedConsistent(mesh);
    expect(signedVolume(mesh)).toBeCloseTo(1, 6);
    expect(faces).toEqual([5]);
    expect(polygonNormal(mesh.vertices, mesh.faces![5])[1]).toBeCloseTo(1, 6);
  });

  it('bridges two facing boundary loops', () => {
    const a = deleteFaces(UNIT_CUBE_POLY, [PLUS_X]).mesh;
    const b = deleteFaces(translate(UNIT_CUBE_POLY, [2, 0, 0]), [3]).mesh; // -X face removed
    const both = combine(a, b);
    const left = both.vertices.findIndex((p) => p[0] === 0.5);
    const right = both.vertices.findIndex((p) => p[0] === 1.5);
    const { mesh, faces } = bridgeEdgeLoops(both, [left, right]);
    expect(faces).toHaveLength(4);
    expect(mesh.faces).toHaveLength(14);
    expectClosedConsistent(mesh);
    expect(signedVolume(mesh)).toBeCloseTo(3, 6);
  });
});

// ------------------------------------------------------------------------------------------------
// Symmetry, soft selection, move, mirror
// ------------------------------------------------------------------------------------------------

describe('symmetry and soft selection', () => {
  it('maps cube vertices to their mirror counterparts', () => {
    const map = symmetryMap(UNIT_CUBE_POLY, 'x');
    for (let v = 0; v < 8; v += 1) {
      const p = UNIT_CUBE_POLY.vertices[v];
      const q = UNIT_CUBE_POLY.vertices[map[v]];
      expect(q).toEqual([-p[0], p[1], p[2]]);
    }
    expect(Array.from(symmetryMap(UNIT_CUBE_POLY, 'y')).every((m, v) => m !== v && m >= 0)).toBe(true);
    const g = grid(2);
    const gm = symmetryMap(g, 'x');
    expect(gm[4]).toBe(4); // centre lies on the plane
    expect(gm[0]).toBe(6);
    const skewed = makePolyMesh(
      g.vertices.map((p, i) => (i === 0 ? ([p[0] - 0.1, p[1], p[2]] as Vec3) : p)),
      g.faces!,
    );
    expect(symmetryMap(skewed, 'x')[0]).toBe(-1);
  });

  it('weights fall off monotonically with distance', () => {
    const g = grid(8);
    const centre = 4 * 9 + 4;
    for (const falloff of ['smooth', 'sphere', 'root', 'linear', 'sharp'] as const) {
      const weights = proportionalWeights(g, [centre], 0.45, falloff);
      expect(weights.get(centre)).toBe(1);
      const samples = [1, 2, 3].map((k) => weights.get(centre + k * 9) ?? 0); // walking along +x
      expect(samples[0]).toBeGreaterThan(samples[1]);
      expect(samples[1]).toBeGreaterThan(samples[2]);
      expect(samples[2]).toBeGreaterThan(0);
      expect(weights.has(centre + 4 * 9)).toBe(false); // 0.5 away, outside the radius
    }
    expect(proportionalWeights(g, [centre], 0.45, 'constant').get(centre + 9)).toBe(1);
  });

  it('connected-only falloff ignores nearby but disconnected geometry', () => {
    const two = combine(UNIT_CUBE_POLY, translate(UNIT_CUBE_POLY, [1.2, 0, 0]));
    const seeds = [1, 2, 5, 6]; // +X face of the first cube
    const free = proportionalWeights(two, seeds, 0.5, 'linear');
    expect([...free.keys()].some((v) => v >= 8)).toBe(true);
    const connected = proportionalWeights(two, seeds, 0.5, 'linear', true);
    expect([...connected.keys()].some((v) => v >= 8)).toBe(false);
    const along = proportionalWeights(two, seeds, 1.5, 'linear', true);
    expect(along.get(0)).toBeCloseTo(1 - 1 / 1.5, 6);
  });

  it('moves vertices with mirrored deltas and pins on-plane vertices', () => {
    const { mesh, vertices } = moveVertices(UNIT_CUBE_POLY, [[1, [0.1, 0.2, 0]]], { symmetryAxes: ['x'] });
    expect(mesh.vertices[1]).toEqual([0.6, -0.3, -0.5]);
    expect(mesh.vertices[0]).toEqual([-0.6, -0.3, -0.5]);
    expect(vertices).toEqual([0, 1]);
    expect(mesh.faces).toEqual(UNIT_CUBE_POLY.faces);
    const g = grid(2);
    const pinned = moveVertices(g, new Map([[4, [0.3, 0.1, 0]]]), { symmetryAxes: ['x'] }).mesh;
    expect(pinned.vertices[4]).toEqual([0, 0.1, 0]);
    const both = moveVertices(UNIT_CUBE_POLY, [[6, [0.1, 0.1, 0]]], { symmetryAxes: ['x', 'y'] }).mesh;
    expect(both.vertices.filter((p, i) => p !== UNIT_CUBE_POLY.vertices[i] && JSON.stringify(p) !== JSON.stringify(UNIT_CUBE_POLY.vertices[i]))).toHaveLength(4);
  });

  it('applies a mirror destructively into a closed mesh', () => {
    const half = deleteFaces(translate(UNIT_CUBE_POLY, [0.5, 0, 0]), [3]).mesh; // open at x = 0
    const { mesh, faces } = mirrorMeshDestructive(half, 'x');
    expect(mesh.faces).toHaveLength(10);
    expect(mesh.vertices).toHaveLength(12);
    expect(faces).toHaveLength(5);
    expectClosedConsistent(mesh);
    expect(signedVolume(mesh)).toBeCloseTo(2, 6);
    // Faces lying in the plane would become internal walls and are dropped.
    const closedHalf = translate(UNIT_CUBE_POLY, [0.5, 0, 0]);
    const merged = mirrorMeshDestructive(closedHalf, 'x').mesh;
    expectClosedConsistent(merged);
    expect(merged.faces).toHaveLength(10);
    for (const loop of merged.faces!) {
      const n = polygonNormal(merged.vertices, loop);
      const c = polygonCenter(merged.vertices, loop);
      expect(n[0] * c[0] + n[1] * c[1] + n[2] * c[2]).toBeGreaterThan(0);
    }
  });
});

// ------------------------------------------------------------------------------------------------
// Bisect + knife
// ------------------------------------------------------------------------------------------------

/** Number of faces on each edge (2 everywhere = closed). */
function edgeFaceCounts(mesh: ModelPartMesh): number[] {
  return buildTopology(mesh).edgeFaces.map((list) => list.length);
}

/** L-shaped prism: L outline in XZ (x 0..2 for z 0..1, x 0..1 for z 1..2), height y 0..1. */
function lPrism(): ModelPartMesh {
  const outline: Array<[number, number]> = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]];
  const n = outline.length;
  const vertices: Vec3[] = [
    ...outline.map(([x, z]) => [x, 0, z] as Vec3),
    ...outline.map(([x, z]) => [x, 1, z] as Vec3),
  ];
  const faces: number[][] = [
    outline.map((_, i) => i),
    outline.map((_, i) => n + n - 1 - i),
    ...outline.map((_, i) => [i, n + i, n + ((i + 1) % n), (i + 1) % n]),
  ];
  return recalculateNormalsOutside(makePolyMesh(vertices, faces)).mesh;
}

describe('bisect', () => {
  const Y0 = { point: [0, 0, 0], normal: [0, 1, 0] };

  it('splits a cube through the middle into 10 faces and stays closed', () => {
    const { mesh, edges } = bisectMesh(UNIT_CUBE_POLY, Y0);
    expect(mesh.faces).toHaveLength(10);
    expectClosedConsistent(mesh);
    expect(signedVolume(mesh)).toBeCloseTo(1, 9);
    expect(edges).toHaveLength(4);
    for (const [a, b] of edges!) {
      expect(mesh.vertices[a][1]).toBeCloseTo(0, 9);
      expect(mesh.vertices[b][1]).toBeCloseTo(0, 9);
    }
  });

  it('clear + fill makes a closed half box on either side', () => {
    const upper = bisectMesh(UNIT_CUBE_POLY, Y0, { clear: 'inner', fill: true }).mesh;
    expectClosedConsistent(upper);
    expect(upper.faces).toHaveLength(6);
    expect(signedVolume(upper)).toBeCloseTo(0.5, 9);
    expect(Math.min(...upper.vertices.map((p) => p[1]))).toBeCloseTo(0, 9);
    expect(Math.max(...upper.vertices.map((p) => p[1]))).toBeCloseTo(0.5, 9);
    // The fill cap faces down (-Y), the top still faces up.
    const normals = upper.faces!.map((loop) => polygonNormal(upper.vertices, loop));
    expect(normals.some((n) => n[1] < -0.999)).toBe(true);
    expect(normals.some((n) => n[1] > 0.999)).toBe(true);

    const lower = bisectMesh(UNIT_CUBE_POLY, Y0, { clear: 'outer', fill: true }).mesh;
    expectClosedConsistent(lower);
    expect(signedVolume(lower)).toBeCloseTo(0.5, 9);
    expect(Math.max(...lower.vertices.map((p) => p[1]))).toBeCloseTo(0, 9);
    expect(Math.min(...lower.vertices.map((p) => p[1]))).toBeCloseTo(-0.5, 9);
  });

  it('tilted planes: the two clear + fill halves are closed and sum to the cube volume', () => {
    const planes = [
      { point: [0.2, 0.2, 0.2], normal: [1, 1, 1] }, // clips one corner (triangle cut)
      { point: [0.05, -0.1, 0], normal: [1, 2, 0.5] }, // general cut through the middle
    ];
    for (const plane of planes) {
      const cut = bisectMesh(UNIT_CUBE_POLY, plane).mesh;
      expectClosedConsistent(cut);
      const inner = bisectMesh(UNIT_CUBE_POLY, plane, { clear: 'inner', fill: true }).mesh;
      const outer = bisectMesh(UNIT_CUBE_POLY, plane, { clear: 'outer', fill: true }).mesh;
      expectClosedConsistent(inner);
      expectClosedConsistent(outer);
      expect(signedVolume(inner)).toBeGreaterThan(0);
      expect(signedVolume(outer)).toBeGreaterThan(0);
      expect(signedVolume(inner) + signedVolume(outer)).toBeCloseTo(1, 9);
    }
    // Corner clip: the cut-off corner is a tetrahedron with legs 0.9.
    const corner = bisectMesh(UNIT_CUBE_POLY, planes[0], { clear: 'inner', fill: true }).mesh;
    expect(signedVolume(corner)).toBeCloseTo(0.9 ** 3 / 6, 9);
  });

  it('splits a concave n-gon crossed twice into three pieces and stays closed', () => {
    const prism = lPrism();
    expect(signedVolume(prism)).toBeCloseTo(3, 9);
    const plane = { point: [1.25, 0.5, 1.25], normal: [1, 0, 1] }; // x + z = 2.5
    const { mesh, edges } = bisectMesh(prism, plane);
    expectClosedConsistent(mesh);
    // 2 caps → 3 pieces each, 4 crossed walls → 2 pieces each, 2 untouched walls.
    expect(mesh.faces).toHaveLength(16);
    expect(edges).toHaveLength(2 + 2 + 4);
    expect(signedVolume(mesh)).toBeCloseTo(3, 9);
    const outer = bisectMesh(prism, plane, { clear: 'outer', fill: true }).mesh;
    const inner = bisectMesh(prism, plane, { clear: 'inner', fill: true }).mesh;
    expectClosedConsistent(outer);
    expectClosedConsistent(inner);
    expect(signedVolume(outer)).toBeCloseTo(2.75, 9);
    expect(signedVolume(inner)).toBeCloseTo(0.25, 9); // two separate corner wedges
  });

  it('carries face slots and interpolates UVs at the cut points', () => {
    const slotted = bisectMesh(slottedCube(), Y0).mesh;
    // The four side faces split in two: every slot except top/bottom appears twice.
    const counts = new Map<number, number>();
    for (const slot of slotted.faceSlots!) counts.set(slot, (counts.get(slot) ?? 0) + 1);
    expect(counts.get(0)).toBe(2);
    expect(counts.get(2)).toBe(2);
    expect(counts.get(TOP)).toBe(1);
    expect(counts.get(5)).toBe(1);

    const textured = bisectMesh(cubeWithUVs(), { point: [0, 0, 0], normal: [1, 0, 0] }).mesh;
    expect(textured.faceUVs).toBeDefined();
    // The -Y face [0,1,5,4] has UVs (0,0)…(1,0) along x at z = -0.5: its cut point is at u = 0.5.
    const mid = textured.vertices.findIndex((p) => Math.abs(p[0]) < 1e-9 && p[1] === -0.5 && p[2] === -0.5);
    expect(mid).toBeGreaterThanOrEqual(0);
    textured.faces!.forEach((loop, f) => {
      const n = polygonNormal(textured.vertices, loop);
      const corner = loop.indexOf(mid);
      if (n[1] < -0.999 && corner >= 0) expect(textured.faceUVs![f][corner]).toEqual([0.5, 0]);
    });
    // Fill faces have no UVs, so filling drops them.
    expect(bisectMesh(cubeWithUVs(), Y0, { clear: 'inner', fill: true }).mesh.faceUVs).toBeUndefined();
    // Fill caps take an adjacent slot.
    const cap = bisectMesh(slottedCube(), Y0, { clear: 'inner', fill: true }).mesh;
    expect(cap.faceSlots!.every((slot) => slot >= 0)).toBe(true);
  });

  it('returns the input unchanged for planes that miss the mesh or bad input', () => {
    const miss = { point: [0, 2, 0], normal: [0, 1, 0] };
    expect(bisectMesh(UNIT_CUBE_POLY, miss).mesh).toBe(UNIT_CUBE_POLY);
    expect(bisectMesh(UNIT_CUBE_POLY, miss, { clear: 'outer', fill: true }).mesh).toBe(UNIT_CUBE_POLY);
    // A clear that would delete everything is refused.
    expect(bisectMesh(UNIT_CUBE_POLY, miss, { clear: 'inner' }).mesh).toBe(UNIT_CUBE_POLY);
    // Plane touching only a face (no crossing) changes nothing.
    expect(bisectMesh(UNIT_CUBE_POLY, { point: [0, 0.5, 0], normal: [0, 1, 0] }).mesh).toBe(UNIT_CUBE_POLY);
    expect(bisectMesh(UNIT_CUBE_POLY, { point: [0, 0, 0], normal: [0, 0, 0] }).mesh).toBe(UNIT_CUBE_POLY);
    expect(knifeCut(UNIT_CUBE_POLY, { plane: Y0, faces: [] }).mesh).toBe(UNIT_CUBE_POLY);
  });

  it('treats vertices within 1e-6 of the plane as on it (no slivers)', () => {
    // Diagonal plane through two opposite top corners: no new vertices on the top face.
    const { mesh } = bisectMesh(UNIT_CUBE_POLY, { point: [0, 0, 1e-7], normal: [1, 0, -1] });
    expectClosedConsistent(mesh);
    expect(mesh.vertices).toHaveLength(8);
    expect(mesh.faces).toHaveLength(8);
  });
});

describe('knife', () => {
  it('splits one face and inserts the cut points into its neighbours', () => {
    const { mesh, edges } = knifeCut(UNIT_CUBE_POLY, { plane: { point: [0, 0, 0], normal: [1, 0, 0] }, faces: [TOP] });
    expectClosedConsistent(mesh);
    expect(edgeFaceCounts(mesh).every((c) => c === 2)).toBe(true);
    expect(mesh.faces).toHaveLength(7);
    expect(mesh.vertices).toHaveLength(10);
    expect(edges).toHaveLength(1);
    // -Z and +Z faces each gained one vertex (now pentagons).
    expect(mesh.faces!.filter((loop) => loop.length === 5)).toHaveLength(2);
    // The two top pieces face up.
    const up = mesh.faces!.filter((loop) => polygonNormal(mesh.vertices, loop)[1] > 0.999);
    expect(up).toHaveLength(2);
    expect(signedVolume(mesh)).toBeCloseTo(1, 9);
  });
});

// ------------------------------------------------------------------------------------------------
// Rounded bevel corners
// ------------------------------------------------------------------------------------------------

/** Max distance of a face's corners from its Newell plane through the centroid. */
function planarity(mesh: ModelPartMesh, loop: number[]): number {
  const n = polygonNormal(mesh.vertices, loop);
  const c = polygonCenter(mesh.vertices, loop);
  return Math.max(...loop.map((v) => {
    const p = mesh.vertices[v];
    return Math.abs((p[0] - c[0]) * n[0] + (p[1] - c[1]) * n[1] + (p[2] - c[2]) * n[2]);
  }));
}

describe('bevel rounded corners', () => {
  it('rounds all 12 cube edges with quad-grid corner patches (segments 2, 3, 4)', () => {
    for (const segments of [2, 3, 4]) {
      let previous = Infinity;
      for (const width of [0.05, 0.1, 0.2]) {
        const { mesh, faces } = bevelEdges(UNIT_CUBE_POLY, cubeEdges(), width, segments);
        expectClosedConsistent(mesh);
        const volume = signedVolume(mesh);
        expect(volume).toBeGreaterThan(0);
        expect(volume).toBeLessThan(previous);
        previous = volume;
        // No face over 4 corners anywhere (cube faces stay quads, strips are quads, patches ≤ 4).
        expect(Math.max(...mesh.faces!.map((loop) => loop.length))).toBeLessThanOrEqual(4);
        for (const loop of mesh.faces!) {
          if (loop.length === 4) expect(planarity(mesh, loop)).toBeLessThan(0.02 * width);
        }
        // Per corner: m² quads ×3 (+ 3m strip quads + 1 triangle for odd segments).
        const m = Math.floor(segments / 2);
        const perCorner = 3 * m * m + (segments % 2 ? 3 * m + 1 : 0);
        expect(faces).toHaveLength(12 * segments + 8 * perCorner);
        expect(mesh.faces!.filter((loop) => loop.length === 3)).toHaveLength(segments % 2 ? 8 : 0);
        // Rounder than the flat chamfer, never outside the cube.
        expect(volume).toBeGreaterThan(signedVolume(bevelEdges(UNIT_CUBE_POLY, cubeEdges(), width).mesh));
        expect(Math.max(...mesh.vertices.flat().map(Math.abs))).toBeLessThanOrEqual(0.5 + 1e-9);
      }
    }
  });

  it('puts corner patch vertices near the sphere of radius = width', () => {
    const width = 0.2;
    const { mesh } = bevelEdges(UNIT_CUBE_POLY, cubeEdges(), width, 4);
    const centre = 0.5 - width;
    for (const p of mesh.vertices) {
      if (p.some((c) => Math.abs(c) <= centre + 1e-9)) continue; // only corner-region vertices
      const r = Math.hypot(Math.abs(p[0]) - centre, Math.abs(p[1]) - centre, Math.abs(p[2]) - centre);
      expect(r).toBeGreaterThan(0.9 * width);
      expect(r).toBeLessThan(width * 1.01);
    }
  });

  it('bevels one or two edges at valence-3 corners with segments > 1', () => {
    const one = bevelEdges(UNIT_CUBE_POLY, [cubeEdges()[0]], 0.2, 3);
    expectClosedConsistent(one.mesh);
    expect(signedVolume(one.mesh)).toBeGreaterThan(1 - 0.5 * 0.2 * 0.2);
    expect(signedVolume(one.mesh)).toBeLessThan(1);

    const topo = buildTopology(UNIT_CUBE_POLY);
    const [e0] = topo.edges;
    const second = topo.edges.find((e) => e !== e0 && (e.includes(e0[0]) || e.includes(e0[1])))!;
    for (const segments of [2, 3, 5]) {
      const two = bevelEdges(UNIT_CUBE_POLY, [e0, second], 0.15, segments);
      expectClosedConsistent(two.mesh);
      const volume = signedVolume(two.mesh);
      expect(volume).toBeGreaterThan(signedVolume(bevelEdges(UNIT_CUBE_POLY, [e0, second], 0.15).mesh));
      expect(volume).toBeLessThan(1);
      expect(Math.max(...two.mesh.vertices.flat().map(Math.abs))).toBeLessThanOrEqual(0.5 + 1e-9);
    }
    // Three edges of one corner (all beveled) with segments: rounded patch, closed.
    const three = bevelEdges(UNIT_CUBE_POLY, topo.vertexEdges[6].map((e) => topo.edges[e]), 0.1, 3);
    expectClosedConsistent(three.mesh);
    expect(signedVolume(three.mesh)).toBeGreaterThan(0.98);
  });
});
