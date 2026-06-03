import type { MaterialDefinition, MeshRendererComponent, ProjectGraph } from '../types';

/** The effective surface of an object after merging material asset + graph + per-object overrides. */
export interface ResolvedMaterial {
  color: string;
  metalness: number;
  roughness: number;
  emissiveColor: string;
  emissiveIntensity: number;
  /** Surface opacity 0–1 (1 = opaque). Below 1 renders translucent (water/glass). */
  opacity: number;
  baseColorAssetId?: string;
  normalAssetId?: string;
  /** Whether these props should override an imported model's baked materials. */
  overrideModel: boolean;
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

const parseHex = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
};

const toHex = (r: number, g: number, b: number): string => {
  const ch = (x: number) => Math.round(Math.min(Math.max(x, 0), 255)).toString(16).padStart(2, '0');
  return `#${ch(r)}${ch(g)}${ch(b)}`;
};

/** Linear-interpolate two #rrggbb colors; returns #rrggbb. */
function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  const f = clampUnit(t);
  return toHex(ar + (br - ar) * f, ag + (bg - ag) * f, ab + (bb - ab) * f);
}

/** Channel-wise multiply of two colors (0-1 normalized). */
function multiplyHex(a: string, b: string): string {
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  return toHex((ar * br) / 255, (ag * bg) / 255, (ab * bb) / 255);
}

/** Scale a color's channels by a scalar. */
function scaleHex(a: string, s: number): string {
  const [ar, ag, ab] = parseHex(a);
  return toHex(ar * s, ag * s, ab * s);
}

/** Channel-wise add of two colors (clamped to 0-255). */
function addHex(a: string, b: string): string {
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  return toHex(ar + br, ag + bg, ab + bb);
}

// A material graph's output only changes when the graph is edited (which replaces the graph
// object). Cache the evaluated output per graph identity so per-object material resolution —
// run for every object that re-renders, and per-frame by "Get Material" script nodes — doesn't
// re-walk the whole graph each time.
const materialGraphCache = new WeakMap<ProjectGraph, MaterialGraphOutput>();

/**
 * Evaluate a material node graph into the channels its Material Output node drives.
 * Unconnected channels are absent (the caller keeps the material's flat-field value).
 * Constant-time only — no per-pixel shading. Result is cached on the graph object.
 */
export function evaluateMaterialGraph(graph: ProjectGraph): MaterialGraphOutput {
  const cached = materialGraphCache.get(graph);
  if (cached) return cached;
  const result = computeMaterialGraph(graph);
  materialGraphCache.set(graph, result);
  return result;
}

function computeMaterialGraph(graph: ProjectGraph): MaterialGraphOutput {
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
    const evalPin = (pin: string) => {
      const source = pinSource(pin);
      return source ? evalNode(source, new Set(visited)) : undefined;
    };
    switch (node.data.nodeKind) {
      case 'material.color':
        return { kind: 'color', value: node.data.materialColor ?? '#ffffff' };
      case 'material.scalar':
        return { kind: 'number', value: Number(node.data.numberValue ?? 0) };
      case 'material.texture':
        return { kind: 'texture', assetId: node.data.assetId };
      case 'material.mix': {
        const a = evalPin('a');
        const b = evalPin('b');
        const tNode = evalPin('t');
        const colorA = a?.kind === 'color' ? a.value : '#000000';
        const colorB = b?.kind === 'color' ? b.value : '#ffffff';
        const t = tNode?.kind === 'number' ? tNode.value : Number(node.data.numberValue ?? 0.5);
        return { kind: 'color', value: mixHex(colorA, colorB, t) };
      }
      case 'material.multiply': {
        const a = evalPin('a');
        const b = evalPin('b');
        if (a?.kind === 'number' && b?.kind === 'number') return { kind: 'number', value: a.value * b.value };
        if (a?.kind === 'color' && b?.kind === 'color') return { kind: 'color', value: multiplyHex(a.value, b.value) };
        // color × scalar tint (in either order)
        if (a?.kind === 'color' && b?.kind === 'number') return { kind: 'color', value: scaleHex(a.value, b.value) };
        if (a?.kind === 'number' && b?.kind === 'color') return { kind: 'color', value: scaleHex(b.value, a.value) };
        return a ?? b;
      }
      case 'material.add': {
        const a = evalPin('a');
        const b = evalPin('b');
        if (a?.kind === 'number' && b?.kind === 'number') return { kind: 'number', value: a.value + b.value };
        if (a?.kind === 'color' && b?.kind === 'color') return { kind: 'color', value: addHex(a.value, b.value) };
        return a ?? b;
      }
      case 'material.clamp': {
        const value = evalPin('value');
        const min = evalPin('min');
        const max = evalPin('max');
        const v = value?.kind === 'number' ? value.value : 0;
        const lo = min?.kind === 'number' ? min.value : 0;
        const hi = max?.kind === 'number' ? max.value : 1;
        return { kind: 'number', value: Math.min(Math.max(v, lo), hi) };
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
    opacity: renderer?.opacity ?? 1,
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
        opacity: renderer.opacity ?? 1,
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
