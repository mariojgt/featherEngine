import { useEditorStore } from '../store/editorStore';
import type { MaterialDefinition, MeshRendererComponent, ProjectGraph } from '../types';

/** The effective surface of an object after merging material asset + graph + per-object overrides. */
export interface ResolvedMaterial {
  color: string;
  metalness: number;
  roughness: number;
  emissiveColor: string;
  emissiveIntensity: number;
  baseColorAssetId?: string;
  normalAssetId?: string;
  /** Whether these props should override an imported model's baked materials. */
  overrideModel: boolean;
}

/** Resolved material plus the runtime URLs for its texture maps. */
export interface ResolvedMaterialUrls extends ResolvedMaterial {
  baseColorUrl?: string;
  normalUrl?: string;
}

/** A value produced by a material graph node. */
type MatValue =
  | { kind: 'color'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'texture'; assetId?: string };

/** Channels a Material Output node exposes; what a connected pin overrides on the base material. */
export interface MaterialGraphOutput {
  color?: string;
  metalness?: number;
  roughness?: number;
  emissiveColor?: string;
  emissiveIntensity?: number;
  baseColorAssetId?: string;
  normalAssetId?: string;
}

const clampUnit = (n: number) => Math.min(Math.max(n, 0), 1);

/** Linear-interpolate two #rrggbb colors; returns #rrggbb. */
function mixHex(a: string, b: string, t: number): string {
  const parse = (hex: string) => {
    const h = hex.replace('#', '');
    const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
    return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
  };
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const f = clampUnit(t);
  const ch = (x: number, y: number) => Math.round(x + (y - x) * f).toString(16).padStart(2, '0');
  return `#${ch(ar, br)}${ch(ag, bg)}${ch(ab, bb)}`;
}

/**
 * Evaluate a material node graph into the channels its Material Output node drives.
 * Unconnected channels are absent (the caller keeps the material's flat-field value).
 */
export function evaluateMaterialGraph(graph: ProjectGraph): MaterialGraphOutput {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const output = graph.nodes.find((node) => node.data.nodeKind === 'material.output');
  if (!output) return {};

  // Map each node's incoming value edges by the target pin id.
  const incomingByTarget = new Map<string, Map<string, string>>();
  for (const edge of graph.edges) {
    if (!edge.targetHandle) continue;
    const map = incomingByTarget.get(edge.target) ?? new Map<string, string>();
    map.set(edge.targetHandle, edge.source);
    incomingByTarget.set(edge.target, map);
  }

  const evalNode = (nodeId: string, visited: Set<string>): MatValue | undefined => {
    if (visited.has(nodeId)) return undefined;
    visited.add(nodeId);
    const node = nodesById.get(nodeId);
    if (!node) return undefined;
    const pinSource = (pin: string) => incomingByTarget.get(nodeId)?.get(pin);
    switch (node.data.nodeKind) {
      case 'material.color':
        return { kind: 'color', value: node.data.materialColor ?? '#ffffff' };
      case 'material.scalar':
        return { kind: 'number', value: Number(node.data.numberValue ?? 0) };
      case 'material.texture':
        return { kind: 'texture', assetId: node.data.assetId };
      case 'material.mix': {
        const a = evalNode(pinSource('a') ?? '', new Set(visited));
        const b = evalNode(pinSource('b') ?? '', new Set(visited));
        const tNode = evalNode(pinSource('t') ?? '', new Set(visited));
        const colorA = a?.kind === 'color' ? a.value : '#000000';
        const colorB = b?.kind === 'color' ? b.value : '#ffffff';
        const t = tNode?.kind === 'number' ? tNode.value : Number(node.data.numberValue ?? 0.5);
        return { kind: 'color', value: mixHex(colorA, colorB, t) };
      }
      default:
        return undefined;
    }
  };

  const pins = incomingByTarget.get(output.id);
  if (!pins) return {};
  const out: MaterialGraphOutput = {};
  const resolve = (pin: string) => {
    const source = pins.get(pin);
    return source ? evalNode(source, new Set()) : undefined;
  };

  const baseColor = resolve('baseColor');
  if (baseColor?.kind === 'texture') out.baseColorAssetId = baseColor.assetId;
  else if (baseColor?.kind === 'color') out.color = baseColor.value;

  const normal = resolve('normal');
  if (normal?.kind === 'texture') out.normalAssetId = normal.assetId;

  const metalness = resolve('metalness');
  if (metalness?.kind === 'number') out.metalness = clampUnit(metalness.value);

  const roughness = resolve('roughness');
  if (roughness?.kind === 'number') out.roughness = clampUnit(roughness.value);

  const emissiveColor = resolve('emissiveColor');
  if (emissiveColor?.kind === 'color') out.emissiveColor = emissiveColor.value;

  const emissiveIntensity = resolve('emissiveIntensity');
  if (emissiveIntensity?.kind === 'number') out.emissiveIntensity = Math.max(emissiveIntensity.value, 0);

  return out;
}

/**
 * Compute an object's effective surface:
 * - An assigned MaterialDefinition supplies the base look (and overrides a model's baked materials).
 *   If the material owns a graph, its Material Output pins override the matching base fields.
 * - Otherwise the renderer's own inline color/metalness/roughness/texture apply (legacy behavior).
 * - `materialOverrides` (written by runtime "Set Material" nodes) are layered on top of everything.
 */
export function resolveMaterial(
  renderer: MeshRendererComponent | undefined,
  materials: MaterialDefinition[],
  graphs: ProjectGraph[],
): ResolvedMaterial {
  const inline: ResolvedMaterial = {
    color: renderer?.color ?? '#9CA3AF',
    metalness: renderer?.metalness ?? 0.1,
    roughness: renderer?.roughness ?? 0.65,
    emissiveColor: '#000000',
    emissiveIntensity: 0,
    baseColorAssetId: renderer?.textureAssetId,
    normalAssetId: undefined,
    overrideModel: Boolean(renderer?.overrideMaterial),
  };
  if (!renderer) return inline;

  const material = renderer.materialId ? materials.find((item) => item.id === renderer.materialId) : undefined;
  let base: ResolvedMaterial = material
    ? {
        color: material.color,
        metalness: material.metalness,
        roughness: material.roughness,
        emissiveColor: material.emissiveColor,
        emissiveIntensity: material.emissiveIntensity,
        baseColorAssetId: material.textureAssetId,
        normalAssetId: material.normalMapAssetId,
        overrideModel: true,
      }
    : inline;

  // The material's node graph overrides whichever channels its Output pins are wired to.
  if (material?.graphId) {
    const graph = graphs.find((item) => item.id === material.graphId);
    if (graph) {
      const out = evaluateMaterialGraph(graph);
      base = {
        ...base,
        color: out.color ?? base.color,
        metalness: out.metalness ?? base.metalness,
        roughness: out.roughness ?? base.roughness,
        emissiveColor: out.emissiveColor ?? base.emissiveColor,
        emissiveIntensity: out.emissiveIntensity ?? base.emissiveIntensity,
        baseColorAssetId: out.baseColorAssetId ?? base.baseColorAssetId,
        normalAssetId: out.normalAssetId ?? base.normalAssetId,
      };
    }
  }

  const overrides = renderer.materialOverrides;
  if (!overrides) return base;
  return {
    ...base,
    color: overrides.color ?? base.color,
    metalness: overrides.metalness ?? base.metalness,
    roughness: overrides.roughness ?? base.roughness,
    emissiveColor: overrides.emissiveColor ?? base.emissiveColor,
    emissiveIntensity: overrides.emissiveIntensity ?? base.emissiveIntensity,
    // Any override means the model's baked materials should yield to it too.
    overrideModel: base.overrideModel || Object.keys(overrides).length > 0,
  };
}

/** Hook form: resolves the material from the store and turns texture asset ids into runtime URLs. */
export function useResolvedMaterial(renderer: MeshRendererComponent | undefined): ResolvedMaterialUrls {
  const materials = useEditorStore((state) => state.materials);
  const graphs = useEditorStore((state) => state.graphs);
  const assets = useEditorStore((state) => state.assets);
  const resolved = resolveMaterial(renderer, materials, graphs);
  const urlFor = (id?: string) => (id ? assets.find((asset) => asset.id === id)?.url : undefined);
  return { ...resolved, baseColorUrl: urlFor(resolved.baseColorAssetId), normalUrl: urlFor(resolved.normalAssetId) };
}
