import type { StoreApi } from 'zustand';
import type { EditorState } from '../editorStore';
import type { ModelMeshGenerator, ModelMeshOp, ModelMeshOpResult, ModelPart, ModelPartMesh, ModelSpec, Vector3Tuple } from '../../types';
import { makeModelPart, normalizeModelSpec } from '../../model/modelSpec';
import { ensurePolyMesh, makePolyMesh, meshFaces, weldMesh } from '../../model/polyMesh';
import {
  bevelEdges,
  bisectMesh,
  knifeCut,
  deleteFaces,
  deleteVertices,
  dissolveEdges,
  extrudeFaces,
  extrudeFacesIndividual,
  fillHole,
  flipFaces,
  insetFaces,
  loopCut,
  mergeVertices,
  mirrorMeshDestructive,
  moveVertices,
  recalculateNormalsOutside,
  subdivideFaces,
} from '../../model/meshOps';
import { evaluateModifiers } from '../../model/meshModifiers';
import {
  generatePrimitivePolyMesh,
  lathe,
  polyCube,
  polyCylinder,
  polyPlane,
  polySphere,
  polyTorus,
  tube,
} from '../../model/meshGenerators';
import { unwrapMesh } from '../../model/meshUV';
import { makeId } from './ids';

type SetState = StoreApi<EditorState>['setState'];
type GetState = StoreApi<EditorState>['getState'];

/**
 * Store side of Model Forge's polygon modeling. Every topology edit — from the Forge's Edit mode, the
 * plugin API or the AI tools — is ONE `ModelMeshOp` applied here, so each is a single undo step and
 * behaves the same from every entry point. The pure geometry lives in src/model/mesh*.ts.
 */

const clampInt = (value: unknown, lo: number, hi: number, fallback: number): number =>
  Number.isFinite(value) ? Math.min(hi, Math.max(lo, Math.round(value as number))) : fallback;
const clampNum = (value: unknown, lo: number, hi: number, fallback: number): number =>
  Number.isFinite(value) ? Math.min(hi, Math.max(lo, value as number)) : fallback;

const edgeSet = (edges: Array<[number, number]>) => new Set(edges.map(([a, b]) => (a < b ? `${a}:${b}` : `${b}:${a}`)));

function runOp(part: ModelPart, mesh: ModelPartMesh, op: ModelMeshOp): { mesh: ModelPartMesh; result: ModelMeshOpResult; partPatch?: Partial<ModelPart> } | null {
  switch (op.type) {
    case 'extrude': {
      const distance = clampNum(op.distance, -4, 4, 0.25);
      const out = op.individual ? extrudeFacesIndividual(mesh, op.faces, distance) : extrudeFaces(mesh, op.faces, distance);
      return { mesh: out.mesh, result: { ok: out.mesh !== mesh, faces: out.faces } };
    }
    case 'inset': {
      const out = insetFaces(mesh, op.faces, clampNum(op.thickness, 0.0005, 2, 0.08), {
        individual: !!op.individual,
        depth: clampNum(op.depth, -2, 2, 0),
      });
      return { mesh: out.mesh, result: { ok: out.mesh !== mesh, faces: out.faces } };
    }
    case 'bevel': {
      const out = bevelEdges(mesh, op.edges, clampNum(op.width, 0.0005, 1, 0.05), clampInt(op.segments, 1, 8, 1));
      return { mesh: out.mesh, result: { ok: out.mesh !== mesh, faces: out.faces, edges: out.edges } };
    }
    case 'loopCut': {
      const out = loopCut(mesh, op.edge, clampInt(op.cuts, 1, 32, 1), clampNum(op.factor, 0, 1, 0.5));
      return { mesh: out.mesh, result: { ok: out.mesh !== mesh, edges: out.edges } };
    }
    case 'subdivide': {
      const out = subdivideFaces(mesh, op.faces, clampInt(op.cuts, 1, 8, 1));
      return { mesh: out.mesh, result: { ok: out.mesh !== mesh, faces: out.faces } };
    }
    case 'merge': {
      const out = mergeVertices(mesh, op.vertices, op.mode ?? 'center');
      return { mesh: out.mesh, result: { ok: out.mesh !== mesh, vertices: out.vertices } };
    }
    case 'delete': {
      let next = mesh;
      if (op.faces?.length) next = deleteFaces(next, op.faces).mesh;
      if (op.vertices?.length) next = deleteVertices(next, op.vertices).mesh;
      if (!meshFaces(next).length) return { mesh, result: { ok: false, message: 'That would delete the whole mesh — delete the part instead.' } };
      return { mesh: next, result: { ok: next !== mesh } };
    }
    case 'dissolveEdges': {
      const out = dissolveEdges(mesh, op.edges);
      return { mesh: out.mesh, result: { ok: out.mesh !== mesh, faces: out.faces } };
    }
    case 'flip': {
      const out = flipFaces(mesh, op.faces);
      return { mesh: out.mesh, result: { ok: true, faces: op.faces } };
    }
    case 'recalculateNormals':
      return { mesh: recalculateNormalsOutside(mesh).mesh, result: { ok: true } };
    case 'fill': {
      const out = fillHole(mesh, op.vertices);
      return { mesh: out.mesh, result: { ok: out.mesh !== mesh, faces: out.faces } };
    }
    case 'weld': {
      const next = weldMesh(mesh, clampNum(op.distance, 1e-6, 0.5, 1e-3));
      const removed = mesh.vertices.length - next.vertices.length;
      return { mesh: next, result: { ok: true, message: `Merged ${removed} vertex${removed === 1 ? '' : 'es'}.` } };
    }
    case 'mirror': {
      const out = mirrorMeshDestructive(mesh, op.axis, clampNum(op.mergeDistance, 0, 0.5, 1e-3));
      return { mesh: out.mesh, result: { ok: out.mesh !== mesh, faces: out.faces } };
    }
    case 'applyModifiers': {
      if (!part.modifiers?.length) return { mesh, result: { ok: false, message: 'This part has no modifiers to apply.' } };
      const baked = ensurePolyMesh(evaluateModifiers(mesh, part.modifiers));
      return { mesh: baked, result: { ok: true }, partPatch: { modifiers: undefined } };
    }
    case 'moveVertices': {
      const out = moveVertices(mesh, op.deltas, { symmetryAxes: op.symmetry });
      return { mesh: out.mesh, result: { ok: true, vertices: out.vertices } };
    }
    case 'setVertices': {
      const vertices = mesh.vertices.map((vertex) => [...vertex] as Vector3Tuple);
      for (const [index, position] of op.positions) {
        if (Number.isInteger(index) && index >= 0 && index < vertices.length && position.every(Number.isFinite)) vertices[index] = [...position];
      }
      return {
        mesh: makePolyMesh(vertices, meshFaces(mesh), { faceSlots: mesh.faceSlots, faceUVs: mesh.faceUVs, sharpEdges: mesh.sharpEdges }),
        result: { ok: true, vertices: op.positions.map(([index]) => index) },
      };
    }
    case 'paintFaces': {
      const faces = meshFaces(mesh);
      const slots = faces.map((_, index) => mesh.faceSlots?.[index] ?? -1);
      for (const face of op.faces) if (face >= 0 && face < slots.length) slots[face] = op.slot;
      return {
        mesh: makePolyMesh(mesh.vertices, faces, { faceSlots: slots, faceUVs: mesh.faceUVs, sharpEdges: mesh.sharpEdges }),
        result: { ok: true, faces: op.faces },
      };
    }
    case 'markSharp': {
      const current = mesh.sharpEdges ?? [];
      const target = edgeSet(op.edges);
      const kept = current.filter(([a, b]) => !target.has(a < b ? `${a}:${b}` : `${b}:${a}`));
      const sharpEdges = op.sharp ? [...kept, ...op.edges.map(([a, b]) => [a, b] as [number, number])] : kept;
      return {
        mesh: makePolyMesh(mesh.vertices, meshFaces(mesh), { faceSlots: mesh.faceSlots, faceUVs: mesh.faceUVs, sharpEdges }),
        result: { ok: true, edges: op.edges },
      };
    }
    case 'knife': {
      const out = knifeCut(mesh, { plane: op.plane, faces: op.faces });
      return { mesh: out.mesh, result: { ok: out.mesh !== mesh, edges: out.edges, message: out.mesh === mesh ? 'The cut line did not cross those faces.' : undefined } };
    }
    case 'bisect': {
      const out = bisectMesh(mesh, op.plane, { faces: op.faces, clear: op.clear ?? 'none', fill: !!op.fill });
      return { mesh: out.mesh, result: { ok: out.mesh !== mesh, edges: out.edges, message: out.mesh === mesh ? 'The plane does not cut the mesh.' : undefined } };
    }
    case 'unwrap': {
      const next = unwrapMesh(mesh, op.method, { axis: op.axis, tiling: clampNum(op.tiling, 0.01, 100, 1), partScale: part.scale });
      return { mesh: next, result: { ok: true } };
    }
    default:
      return null;
  }
}

/**
 * Apply one mesh op to a mesh part. Non-mesh parts are converted to clean quad meshes first, so
 * "select a box, bevel its edges" works without a separate Convert step.
 */
export const applyModelMeshOp = (
  set: SetState,
  get: GetState,
  specId: string,
  partId: string,
  op: ModelMeshOp,
): ModelMeshOpResult => {
  const spec = get().modelSpecs.find((entry) => entry.id === specId);
  const index = spec?.parts.findIndex((part) => part.id === partId) ?? -1;
  if (!spec || index < 0) return { ok: false, message: 'Unknown model or part.' };
  const part = spec.parts[index];
  const source = part.shape === 'mesh' && part.mesh ? ensurePolyMesh(part.mesh) : meshForPart(part);
  let outcome: ReturnType<typeof runOp>;
  try {
    outcome = runOp(part, source, op);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
  if (!outcome) return { ok: false, message: `Unknown mesh op "${(op as { type?: string }).type}".` };
  if (!outcome.result.ok && part.shape === 'mesh') return outcome.result;
  const parts = spec.parts.map((entry, partIndex) => {
    if (partIndex !== index) return entry;
    const next: ModelPart = { ...entry, ...outcome!.partPatch, shape: 'mesh', mesh: outcome!.mesh };
    delete next.corners;
    delete next.faceColors;
    if (outcome!.partPatch && 'modifiers' in outcome!.partPatch && !outcome!.partPatch.modifiers) delete next.modifiers;
    return next;
  });
  get().updateModelSpec(specId, { parts });
  return outcome.result;
};

/**
 * The clean polygon version of any part — what Convert to Mesh produces. Primitives come from the
 * quad generators (a converted cylinder has real side quads and n-gon caps, so loop cuts and
 * subdivision behave), with box corner offsets applied trilinearly, and face paint carried over.
 */
export function meshForPart(part: ModelPart): ModelPartMesh {
  if (part.shape === 'mesh') return ensurePolyMesh(part.mesh ?? polyCube(1));
  let mesh = generatePrimitivePolyMesh(part.shape);
  if (part.shape === 'box' && part.corners && Object.keys(part.corners).length) {
    const corners = part.corners;
    const offset = (index: number): Vector3Tuple => corners[index] ?? [0, 0, 0];
    const vertices = mesh.vertices.map(([x, y, z]) => {
      const u = x + 0.5;
      const v = y + 0.5;
      const w = z + 0.5;
      const result: Vector3Tuple = [x, y, z];
      for (let corner = 0; corner < 8; corner += 1) {
        const weight = (corner & 1 ? u : 1 - u) * (corner & 2 ? v : 1 - v) * (corner & 4 ? w : 1 - w);
        const delta = offset(corner);
        result[0] += delta[0] * weight;
        result[1] += delta[1] * weight;
        result[2] += delta[2] * weight;
      }
      return result;
    });
    mesh = makePolyMesh(vertices, meshFaces(mesh), { sharpEdges: mesh.sharpEdges });
  }
  if (part.shape === 'box' && part.faceColors && Object.keys(part.faceColors).length) {
    // Box face groups follow three's BoxGeometry order: +X, -X, +Y, -Y, +Z, -Z.
    const groupNormals: Vector3Tuple[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    const faces = meshFaces(mesh);
    const slots = faces.map((loop) => {
      const centroid = loop.reduce<Vector3Tuple>((sum, i) => [sum[0] + mesh.vertices[i][0], sum[1] + mesh.vertices[i][1], sum[2] + mesh.vertices[i][2]], [0, 0, 0]);
      let best = 0;
      let bestDot = -Infinity;
      groupNormals.forEach((normal, group) => {
        const dot = normal[0] * centroid[0] + normal[1] * centroid[1] + normal[2] * centroid[2];
        if (dot > bestDot) {
          bestDot = dot;
          best = group;
        }
      });
      return part.faceColors?.[best] ?? -1;
    });
    mesh = makePolyMesh(mesh.vertices, faces, { faceSlots: slots, sharpEdges: mesh.sharpEdges });
  }
  return mesh;
}

/** Build a mesh from a generator description (AI tools + the Forge's "Add mesh" menu). */
export function generateModelMesh(generator: ModelMeshGenerator): ModelPartMesh | null {
  switch (generator.kind) {
    case 'primitive':
      return generatePrimitivePolyMesh(generator.shape);
    case 'cube':
      return polyCube(clampInt(generator.segments, 1, 16, 1));
    case 'plane':
      return polyPlane(clampInt(generator.segmentsX, 1, 64, 1), clampInt(generator.segmentsZ, 1, 64, 1));
    case 'cylinder':
      return polyCylinder(clampInt(generator.sides, 3, 64, 16), clampInt(generator.heightSegments, 1, 32, 1));
    case 'sphere':
      return polySphere(clampInt(generator.segments, 3, 64, 24), clampInt(generator.rings, 2, 48, 12));
    case 'torus':
      return polyTorus(
        clampInt(generator.majorSegments, 3, 96, 24),
        clampInt(generator.minorSegments, 3, 48, 12),
        clampNum(generator.minorRatio, 0.02, 0.95, 0.3),
      );
    case 'lathe': {
      const profile = (generator.profile ?? []).filter(
        (point) => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite),
      ).map(([radius, y]) => [Math.max(0, radius), y] as [number, number]);
      if (profile.length < 2) return null;
      return lathe(profile, clampInt(generator.segments, 3, 96, 24), clampNum(generator.angle, 1, 360, 360), generator.capEnds ?? true);
    }
    case 'tube': {
      const path = (generator.path ?? []).filter((point) => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite));
      if (path.length < 2) return null;
      return tube(path, clampNum(generator.radius, 0.002, 2, 0.05), clampInt(generator.sides, 3, 32, 8), !!generator.closed);
    }
    default:
      return null;
  }
}

/**
 * Add a generated mesh part. Generators output unit-ish geometry; the part's `scale` multiplies it
 * like any other part, so `init.scale` sizes it in world units. Returns the new part id.
 */
export const applyAddModelMeshPart = (
  set: SetState,
  get: GetState,
  specId: string,
  generator: ModelMeshGenerator,
  init: Partial<Omit<ModelPart, 'id' | 'shape' | 'mesh'>> = {},
): string | null => {
  const spec = get().modelSpecs.find((entry) => entry.id === specId);
  if (!spec) return null;
  const mesh = generateModelMesh(generator);
  if (!mesh) return null;
  const part: ModelPart = {
    ...makeModelPart('mesh', { name: init.name ?? (generator.kind === 'primitive' ? generator.shape : generator.kind), ...init }),
    mesh,
  };
  get().updateModelSpec(specId, { parts: [...spec.parts, part] });
  return part.id;
};

/** Add an imported model (e.g. from a GLB) as a new library asset. Returns its id. */
export const applyAddImportedModelSpec = (set: SetState, spec: ModelSpec): string => {
  const id = makeId('model');
  const normalized = normalizeModelSpec({ ...spec, id });
  set((state) => ({ modelSpecs: [...state.modelSpecs, normalized], activeModelSpecId: id, isDirty: true }));
  return id;
};

/**
 * Run an op WITHOUT committing — the Forge's modal tools (inset/bevel/loop-cut drags) preview with
 * exactly the geometry the commit will produce. Returns null when the op is unknown or throws.
 */
export function previewModelMeshOp(part: ModelPart, op: ModelMeshOp): { mesh: ModelPartMesh; result: ModelMeshOpResult } | null {
  const source = part.shape === 'mesh' && part.mesh ? ensurePolyMesh(part.mesh) : meshForPart(part);
  try {
    const outcome = runOp(part, source, op);
    return outcome ? { mesh: outcome.mesh, result: outcome.result } : null;
  } catch {
    return null;
  }
}
