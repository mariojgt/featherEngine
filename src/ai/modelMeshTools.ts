import { tool } from 'ai';
import { z } from 'zod';
import { useEditorStore } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import { meshForPart } from '../store/editor/modelMeshActions';
import { buildTopology, meshFaces, polygonCenter, polygonNormal } from '../model/polyMesh';
import { selectEdgeLoop } from '../model/meshOps';
import { resolveAssetItemUrl } from '../three/ModelAsset';
import type { ModelAxis, ModelMeshOp, ModelModifier, ModelPart, ModelPartMesh, Vector3Tuple } from '../types';

/**
 * AI tools for Model Forge's polygon modeling (Blender-style edit ops, modifiers, generators, UVs,
 * GLB import). Spread into engineTools from tools.ts. Every edit funnels through the store's
 * applyModelMeshOp, so the assistant and the Forge UI produce identical results and undo steps.
 *
 * The model can't see the mesh, so selections are expressed the way a person would describe them —
 * "faces facing +Y", "all edges", "the loop through this edge" — and resolved here against the
 * part's current cage. inspect_model_mesh reports indices, centers and normals when exact picks matter.
 */

const store = () => useEditorStore.getState();
const vec3 = z.array(z.number()).length(3).describe('[x, y, z]');
const axisEnum = z.enum(['x', 'y', 'z']);
const directionEnum = z.enum(['+x', '-x', '+y', '-y', '+z', '-z']);
type Direction = z.infer<typeof directionEnum>;

const findPart = (specId: string, partId: string): ModelPart | undefined =>
  store().modelSpecs.find((entry) => entry.id === specId)?.parts.find((part) => part.id === partId);

/** The cage the next op will act on (non-mesh parts convert to clean quads first, same as the store). */
const cageOf = (part: ModelPart): ModelPartMesh => meshForPart(part);

const directionVector = (direction: Direction): Vector3Tuple => {
  const sign = direction[0] === '-' ? -1 : 1;
  const axis = direction[1];
  return [axis === 'x' ? sign : 0, axis === 'y' ? sign : 0, axis === 'z' ? sign : 0];
};

function resolveFaces(mesh: ModelPartMesh, faces?: number[], facing?: Direction, allFaces?: boolean): number[] {
  const loops = meshFaces(mesh);
  if (allFaces) return loops.map((_, index) => index);
  const picked = new Set((faces ?? []).filter((index) => Number.isInteger(index) && index >= 0 && index < loops.length));
  if (facing) {
    const dir = directionVector(facing);
    loops.forEach((loop, index) => {
      const normal = polygonNormal(mesh.vertices, loop);
      if (normal[0] * dir[0] + normal[1] * dir[1] + normal[2] * dir[2] > 0.7) picked.add(index);
    });
  }
  return [...picked];
}

function resolveEdges(
  mesh: ModelPartMesh,
  edges?: number[][],
  allEdges?: boolean,
  edgesOfFacing?: Direction,
  loopThrough?: number[],
): Array<[number, number]> {
  const topology = buildTopology({ vertices: mesh.vertices, faces: meshFaces(mesh) });
  if (allEdges) return topology.edges;
  const result = new Map<string, [number, number]>();
  const add = (a: number, b: number) => result.set(a < b ? `${a}:${b}` : `${b}:${a}`, a < b ? [a, b] : [b, a]);
  for (const edge of edges ?? []) if (edge.length === 2 && topology.edgeIndex.has(a2k(edge[0], edge[1]))) add(edge[0], edge[1]);
  if (edgesOfFacing) {
    for (const face of resolveFaces(mesh, undefined, edgesOfFacing)) {
      const loop = meshFaces(mesh)[face];
      loop.forEach((vertex, corner) => add(vertex, loop[(corner + 1) % loop.length]));
    }
  }
  if (loopThrough?.length === 2) for (const [a, b] of selectEdgeLoop(mesh, [loopThrough[0], loopThrough[1]])) add(a, b);
  return [...result.values()];
}

// Same keying as polyMesh.edgeKey (kept local to avoid widening that module's surface).
const a2k = (a: number, b: number): number => (a < b ? a * 67108864 + b : b * 67108864 + a);

const round3 = (value: number) => Math.round(value * 1000) / 1000;

const opSummary = (label: string, result: { ok: boolean; message?: string; faces?: number[]; edges?: unknown[]; vertices?: number[] }, mesh?: ModelPartMesh) => {
  if (!result.ok) return `${label} did nothing${result.message ? ` — ${result.message}` : ' (check the selection)'}.`;
  const selection = [
    result.faces?.length ? `faces [${result.faces.slice(0, 40).join(', ')}${result.faces.length > 40 ? ', …' : ''}]` : '',
    result.edges?.length ? `${result.edges.length} edge(s)` : '',
    result.vertices?.length ? `${result.vertices.length} vertex(es)` : '',
  ].filter(Boolean).join(', ');
  const stats = mesh ? ` Cage now: ${mesh.vertices.length} verts, ${meshFaces(mesh).length} faces.` : '';
  return `${label} done.${selection ? ` New selection: ${selection}.` : ''}${stats}${result.message ? ` ${result.message}` : ''}`;
};

const modifierSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('mirror'), axes: z.array(axisEnum).min(1), mergeDistance: z.number().optional(), enabled: z.boolean().optional() }),
  z.object({
    type: z.literal('array'),
    count: z.number(),
    mode: z.enum(['linear', 'radial']),
    offset: vec3.optional(),
    axis: axisEnum.optional(),
    angle: z.number().optional(),
    enabled: z.boolean().optional(),
  }),
  z.object({ type: z.literal('subdivision'), levels: z.number(), enabled: z.boolean().optional() }),
]);

export const modelMeshTools = {
  inspect_model_mesh: tool({
    description:
      "Read a model part's editable polygon cage (non-mesh parts are shown as the clean quad mesh they convert to): vertex/face counts, every face's index + center + normal (unit space, up to 200), boundary/sharp edge counts, modifiers, smooth angle and UV state. Use before precise edit_model_mesh calls when 'facing' selectors aren't specific enough.",
    inputSchema: z.object({ specId: z.string(), partId: z.string() }),
    execute: async ({ specId, partId }) => {
      const part = findPart(specId, partId);
      if (!part) return `No such model part (${specId} / ${partId}).`;
      const mesh = cageOf(part);
      const faces = meshFaces(mesh);
      const topology = buildTopology({ vertices: mesh.vertices, faces });
      return JSON.stringify({
        shape: part.shape,
        converted: part.shape !== 'mesh',
        vertices: mesh.vertices.length,
        faceCount: faces.length,
        edgeCount: topology.edges.length,
        boundaryEdges: topology.edgeFaces.filter((entry) => entry.length === 1).length,
        sharpEdges: mesh.sharpEdges?.length ?? 0,
        hasUVs: !!mesh.faceUVs,
        modifiers: part.modifiers ?? [],
        smoothAngle: part.smoothAngle ?? null,
        materialId: part.materialId ?? null,
        faces: faces.slice(0, 200).map((loop, index) => ({
          index,
          corners: loop.length,
          verts: loop,
          center: polygonCenter(mesh.vertices, loop).map(round3),
          normal: polygonNormal(mesh.vertices, loop).map(round3),
          slot: mesh.faceSlots?.[index] ?? -1,
        })),
      });
    },
  }),

  edit_model_mesh: tool({
    description:
      "Blender-style polygon modeling on one model part (non-mesh parts auto-convert to clean quads first). ONE op per call, each one undo step; the reply lists the new selection (e.g. extruded caps) so you can chain: inset → extrude → bevel. Select faces by index and/or `facing` ('+y' = every face whose normal points up), `allFaces`; edges by `edges` ([[a,b],…] vertex pairs), `allEdges`, `edgesOfFacing` (the outline edges of faces facing a direction) or `loopThrough` ([a,b] → the whole edge loop). Ops: extrude {distance, individual}; inset {thickness, depth, individual}; bevel {width, segments} (edges); loopCut {loopCutEdge:[a,b], cuts, factor} — cuts the ring of quads crossing that edge; subdivide {cuts}; merge {vertices, mergeMode}; delete {faces | vertices}; dissolveEdges; flip; recalculateNormals; fill {vertices on a hole's border}; weld {distance}; mirror {axis} (destructive: duplicate across the axis=0 plane and weld — for live symmetry use set_model_part_modifiers mirror instead); applyModifiers (bake the modifier stack into the cage); moveVertices {deltas:[[index,[dx,dy,dz]]], symmetry axes}; paintFaces {slot}; markSharp {sharp} (edges stay crisp under subdivision/auto-smooth); unwrap {method box|smart|planar|cylinder|sphere, axis, tiling} for textured materials; bisect {planePoint, planeNormal, clear 'inner'|'outer', fillCut} — slice the mesh with a plane (e.g. cut a sphere in half into a dome: planeNormal [0,1,0], clear 'inner', fillCut true); knife {planePoint, planeNormal, faces} — add a cut line across faces without deleting anything. Units are the part's UNIT space (a cube spans ±0.5; part.scale sizes it in the world).",
    inputSchema: z.object({
      specId: z.string(),
      partId: z.string(),
      op: z.enum([
        'extrude', 'inset', 'bevel', 'loopCut', 'subdivide', 'merge', 'delete', 'dissolveEdges', 'flip',
        'recalculateNormals', 'fill', 'weld', 'mirror', 'applyModifiers', 'moveVertices', 'paintFaces', 'markSharp', 'unwrap',
        'bisect', 'knife',
      ]),
      faces: z.array(z.number()).optional(),
      facing: directionEnum.optional(),
      allFaces: z.boolean().optional(),
      edges: z.array(z.array(z.number()).length(2)).optional(),
      allEdges: z.boolean().optional(),
      edgesOfFacing: directionEnum.optional(),
      loopThrough: z.array(z.number()).length(2).optional(),
      vertices: z.array(z.number()).optional(),
      distance: z.number().optional().describe('extrude distance / weld distance (unit space)'),
      thickness: z.number().optional(),
      depth: z.number().optional(),
      individual: z.boolean().optional(),
      width: z.number().optional(),
      segments: z.number().optional(),
      loopCutEdge: z.array(z.number()).length(2).optional(),
      cuts: z.number().optional(),
      factor: z.number().optional(),
      mergeMode: z.enum(['center', 'first', 'last']).optional(),
      axis: axisEnum.optional(),
      deltas: z.array(z.tuple([z.number(), vec3])).optional(),
      symmetry: z.array(axisEnum).optional(),
      slot: z.number().optional(),
      sharp: z.boolean().optional(),
      method: z.enum(['box', 'smart', 'planar', 'cylinder', 'sphere']).optional(),
      tiling: z.number().optional(),
      planePoint: vec3.optional().describe('bisect/knife: a point on the cut plane (unit space)'),
      planeNormal: vec3.optional().describe('bisect/knife: the cut plane normal'),
      clear: z.enum(['none', 'inner', 'outer']).optional().describe("bisect: delete the side behind the normal ('inner') or in front ('outer')"),
      fillCut: z.boolean().optional().describe('bisect: close the cut with a cap face'),
    }),
    execute: async (input) => {
      const part = findPart(input.specId, input.partId);
      if (!part) return `No such model part (${input.specId} / ${input.partId}).`;
      const cage = cageOf(part);
      const faces = () => resolveFaces(cage, input.faces, input.facing, input.allFaces);
      const edges = () => resolveEdges(cage, input.edges, input.allEdges, input.edgesOfFacing, input.loopThrough);
      let op: ModelMeshOp;
      switch (input.op) {
        case 'extrude': op = { type: 'extrude', faces: faces(), distance: input.distance, individual: input.individual }; break;
        case 'inset': op = { type: 'inset', faces: faces(), thickness: input.thickness, depth: input.depth, individual: input.individual }; break;
        case 'bevel': op = { type: 'bevel', edges: edges(), width: input.width, segments: input.segments }; break;
        case 'loopCut': {
          const edge = input.loopCutEdge ?? input.edges?.[0] ?? edges()[0];
          if (!edge) return 'loopCut needs loopCutEdge: [a, b] — any edge the ring should cross (see inspect_model_mesh).';
          op = { type: 'loopCut', edge: [edge[0], edge[1]], cuts: input.cuts, factor: input.factor };
          break;
        }
        case 'subdivide': op = { type: 'subdivide', faces: faces(), cuts: input.cuts }; break;
        case 'merge': op = { type: 'merge', vertices: input.vertices ?? [], mode: input.mergeMode }; break;
        case 'delete': op = { type: 'delete', faces: faces(), vertices: input.vertices }; break;
        case 'dissolveEdges': op = { type: 'dissolveEdges', edges: edges() }; break;
        case 'flip': op = { type: 'flip', faces: faces() }; break;
        case 'recalculateNormals': op = { type: 'recalculateNormals' }; break;
        case 'fill': op = { type: 'fill', vertices: input.vertices ?? [] }; break;
        case 'weld': op = { type: 'weld', distance: input.distance }; break;
        case 'mirror': op = { type: 'mirror', axis: (input.axis ?? 'x') as ModelAxis }; break;
        case 'applyModifiers': op = { type: 'applyModifiers' }; break;
        case 'moveVertices':
          op = { type: 'moveVertices', deltas: (input.deltas ?? []).map(([index, delta]) => [index, delta as Vector3Tuple]), symmetry: input.symmetry };
          break;
        case 'paintFaces': op = { type: 'paintFaces', faces: faces(), slot: input.slot ?? 0 }; break;
        case 'markSharp': op = { type: 'markSharp', edges: edges(), sharp: input.sharp ?? true }; break;
        case 'unwrap': op = { type: 'unwrap', method: input.method ?? 'box', axis: input.axis, tiling: input.tiling }; break;
        case 'bisect':
        case 'knife': {
          const plane = { point: (input.planePoint ?? [0, 0, 0]) as Vector3Tuple, normal: (input.planeNormal ?? [0, 1, 0]) as Vector3Tuple };
          const picked = input.faces || input.facing || input.allFaces ? faces() : undefined;
          op = input.op === 'knife'
            ? { type: 'knife', plane, faces: picked ?? meshFaces(cage).map((_, index) => index) }
            : { type: 'bisect', plane, faces: picked, clear: input.clear, fill: input.fillCut };
          break;
        }
        default: return `Unknown op ${input.op}.`;
      }
      const result = store().applyModelMeshOp(input.specId, input.partId, op);
      const after = findPart(input.specId, input.partId)?.mesh;
      return opSummary(input.op, result, after);
    },
  }),

  set_model_part_modifiers: tool({
    description:
      "Set a model part's NON-DESTRUCTIVE modifier stack (replaces the whole stack; [] clears) and its surface options. Modifiers run in order at render/physics/bake time and never change the editable cage: mirror {axes:['x']} (model half, get both — symmetric characters, vehicles, furniture), array {count, mode 'linear' + offset [x,y,z] | 'radial' + axis + angle} (fence posts, gear teeth, columns around a temple), subdivision {levels 1-3} (Catmull-Clark: turns a low-poly blocky cage into a smooth organic shape — mark edges sharp with edit_model_mesh markSharp to keep them crisp). Also smoothAngle (0 faceted … 180 fully smooth; auto-smooth splits shading at sharper edges), materialId (a project material from the Material Editor — textures tile via the part's UVs; use edit_model_mesh unwrap for control), group (outliner label). Non-mesh parts convert to a mesh first when modifiers are set.",
    inputSchema: z.object({
      specId: z.string(),
      partId: z.string(),
      modifiers: z.array(modifierSchema).optional(),
      smoothAngle: z.number().optional(),
      materialId: z.string().nullable().optional(),
      group: z.string().nullable().optional(),
    }),
    execute: async ({ specId, partId, modifiers, smoothAngle, materialId, group }) => {
      const part = findPart(specId, partId);
      if (!part) return `No such model part (${specId} / ${partId}).`;
      if (modifiers?.length && part.shape !== 'mesh') store().convertModelPartToMesh(specId, partId);
      if (materialId && !store().materials.some((material) => material.id === materialId)) return `No project material with id ${materialId}.`;
      const patch: Partial<ModelPart> = {};
      if (modifiers) patch.modifiers = modifiers as ModelModifier[];
      if (smoothAngle !== undefined) patch.smoothAngle = smoothAngle;
      if (materialId !== undefined) patch.materialId = materialId ?? undefined;
      if (group !== undefined) patch.group = group ?? undefined;
      const ok = store().updateModelPart(specId, partId, patch);
      if (!ok) return `Could not update part ${partId}.`;
      const next = findPart(specId, partId);
      return `Part ${partId}: modifiers ${JSON.stringify(next?.modifiers ?? [])}, smoothAngle ${next?.smoothAngle ?? 'default'}, material ${next?.materialId ?? 'palette'}${next?.group ? `, group "${next.group}"` : ''}.`;
    },
  }),

  add_model_mesh_part: tool({
    description:
      "Add a clean-topology MESH part to a model asset from a generator: primitive {shape} (box/cylinder/sphere/cone/torus/pyramid/hexprism/capsule/wedge as real quads), cube {segments}, plane {segmentsX, segmentsZ}, cylinder {sides, heightSegments}, sphere {segments, rings}, torus {majorSegments, minorSegments, minorRatio}, lathe {profile [[radius, y], …] bottom→top, segments, angle, capEnds} (vases, bottles, lamps, chess pieces, columns, wheels — radius 0 points close to a pole), tube {path [[x,y,z], …], radius, sides, closed} (pipes, handles, cables, railings). Generated geometry is unit-ish; position/scale place and size it (scale multiplies). Returns the part id; follow with edit_model_mesh / set_model_part_modifiers.",
    inputSchema: z.object({
      specId: z.string(),
      kind: z.enum(['primitive', 'cube', 'plane', 'cylinder', 'sphere', 'torus', 'lathe', 'tube']),
      shape: z.enum(['box', 'cylinder', 'sphere', 'cone', 'wedge', 'torus', 'pyramid', 'hexprism', 'capsule']).optional(),
      segments: z.number().optional(),
      segmentsX: z.number().optional(),
      segmentsZ: z.number().optional(),
      sides: z.number().optional(),
      heightSegments: z.number().optional(),
      rings: z.number().optional(),
      majorSegments: z.number().optional(),
      minorSegments: z.number().optional(),
      minorRatio: z.number().optional(),
      profile: z.array(z.array(z.number()).length(2)).optional(),
      angle: z.number().optional(),
      capEnds: z.boolean().optional(),
      path: z.array(vec3).optional(),
      radius: z.number().optional(),
      closed: z.boolean().optional(),
      name: z.string().optional(),
      position: vec3.optional(),
      rotationDeg: vec3.optional(),
      scale: vec3.optional(),
      colorSlot: z.number().optional(),
    }),
    execute: async (input) => {
      const generator = (() => {
        switch (input.kind) {
          case 'primitive': return { kind: 'primitive' as const, shape: input.shape ?? 'box' };
          case 'cube': return { kind: 'cube' as const, segments: input.segments };
          case 'plane': return { kind: 'plane' as const, segmentsX: input.segmentsX, segmentsZ: input.segmentsZ };
          case 'cylinder': return { kind: 'cylinder' as const, sides: input.sides, heightSegments: input.heightSegments };
          case 'sphere': return { kind: 'sphere' as const, segments: input.segments, rings: input.rings };
          case 'torus': return { kind: 'torus' as const, majorSegments: input.majorSegments, minorSegments: input.minorSegments, minorRatio: input.minorRatio };
          case 'lathe': return { kind: 'lathe' as const, profile: (input.profile ?? []).map((point) => [point[0], point[1]] as [number, number]), segments: input.segments, angle: input.angle, capEnds: input.capEnds };
          case 'tube': return { kind: 'tube' as const, path: (input.path ?? []) as Vector3Tuple[], radius: input.radius, sides: input.sides, closed: input.closed };
          default: return null;
        }
      })();
      if (!generator) return `Unknown generator ${input.kind}.`;
      const id = store().addModelMeshPart(input.specId, generator, {
        name: input.name,
        position: input.position as Vector3Tuple | undefined,
        rotation: input.rotationDeg ? (input.rotationDeg.map((v) => (v * Math.PI) / 180) as Vector3Tuple) : undefined,
        scale: input.scale as Vector3Tuple | undefined,
        colorSlot: input.colorSlot,
      });
      return id ? `Added ${input.kind} mesh part ${id}.` : `Could not build that ${input.kind} (check specId and parameters — lathe needs ≥2 profile points, tube ≥2 path points).`;
    },
  }),

  bake_model_textures: tool({
    description:
      "Bake a model part into real textures and assign them as a project material (game-ready export): base color (palette paint, per-face) multiplied by ambient occlusion (soft contact shadows; other parts of the model occlude), plus an optional tangent-space NORMAL map carrying the subdivision detail — when normal is on, the part's subdivision modifier is switched off because its detail now lives in the normal map. UVs are Smart-unwrapped automatically if needed. size 256-2048 (default 512), samples 8-64 (default 16). The textures appear in the Assets panel and travel with bake_model_asset/exports.",
    inputSchema: z.object({
      specId: z.string(),
      partId: z.string(),
      ao: z.boolean().optional(),
      normal: z.boolean().optional(),
      size: z.number().optional(),
      samples: z.number().optional(),
    }),
    execute: async ({ specId, partId, ao, normal, size, samples }) => {
      if (!findPart(specId, partId)) return `No such model part (${specId} / ${partId}).`;
      const result = await store().bakeModelPartTextures(specId, partId, { ao, normal, size, samples });
      return result.message;
    },
  }),

  import_model_glb: tool({
    description:
      "Turn an imported GLB/GLTF model asset (Assets panel, kind 'model') into an EDITABLE Model Forge asset: one mesh part per glTF mesh, quads rebuilt, material colors become the palette, UVs kept, base-color/normal textures + PBR values become project materials on the parts. Use when the user wants to modify a downloaded/AI-generated model with the polygon tools. Returns the new model asset id.",
    inputSchema: z.object({ assetId: z.string() }),
    execute: async ({ assetId }) => {
      const asset = store().assets.find((item) => item.id === assetId);
      if (!asset) return `No asset with id ${assetId}.`;
      const url = resolveAssetItemUrl(asset, useProjectStore.getState().projectDir);
      if (!url) return `Asset ${assetId} has no loadable file.`;
      const response = await fetch(url);
      if (!response.ok) return `Could not read ${asset.name} (HTTP ${response.status}).`;
      const { specId, warnings } = await store().importModelFromGlb(await response.arrayBuffer(), asset.name.replace(/\.[^.]+$/, ''));
      const spec = store().modelSpecs.find((entry) => entry.id === specId);
      return `Imported ${asset.name} as model asset ${specId} (${spec?.parts.length ?? 0} mesh parts).${warnings.length ? ` Warnings: ${warnings.join('; ')}` : ''}`;
    },
  }),
};
