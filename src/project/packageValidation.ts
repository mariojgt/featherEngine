import { z } from 'zod';

const id = z.string().trim().min(1).max(256);
const entity = z.object({ id }).passthrough();
const entities = z.array(entity).max(50000).superRefine((items, ctx) => {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) ctx.addIssue({ code: 'custom', message: `Duplicate id: ${item.id}` });
    seen.add(item.id);
  }
});
const collections = ['prefabs', 'blueprints', 'graphs', 'materials', 'particleSystems', 'skeletons',
  'skeletalMeshes', 'animations', 'animatorControllers', 'dataAssets', 'uiDocuments', 'variables'] as const;
export const PACKAGE_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
export const PLUGIN_ID = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
const schema = z.object({
  format: z.literal('nodeforge-package'),
  formatVersion: z.string().regex(/^1\.\d+\.\d+$/, 'Unsupported package format version; use a compatible Feather build.'),
  kind: z.enum(['asset', 'project', 'plugin', 'module']).default('asset'),
  meta: z.object({ id, name: z.string().trim().min(1).max(160), version: z.string().regex(PACKAGE_SEMVER, 'Use a version such as 1.0.0.'),
    pluginId: z.string().regex(PLUGIN_ID).optional(), tags: z.array(z.string()).optional() }).passthrough(),
  content: z.object(Object.fromEntries(collections.map((key) => [key, key === 'prefabs' ? entities : entities.default([])])))
    .extend({ folders: entities.optional(), scenes: entities.optional(), modelSpecs: entities.optional(), treeSpecs: entities.optional() }).passthrough(),
  assets: entities,
}).passthrough();
const widget = z.object({ id, name: z.string(), kind: z.enum(['panel', 'scroll', 'text', 'button', 'image', 'bar', 'input', 'toggle', 'slider', 'dropdown', 'component']),
  style: z.record(z.string(), z.unknown()), bindings: z.array(z.object({ target: z.enum(['text', 'fill', 'visible', 'color', 'background', 'width', 'disabled']), expression: z.string() })),
  children: z.array(z.unknown()), componentId: z.string().optional(), componentParams: z.record(z.string(), z.string()).optional(),
}).passthrough();

/** Reject malformed authoring data before remapping ids or touching the open project. */
export function validatePackageStructure(raw: unknown): unknown {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(`Invalid package at ${issue.path.join('.') || 'manifest'}: ${issue.message}`);
  }
  const pkg = result.data;
  if (pkg.kind === 'plugin' && !pkg.meta.pluginId) throw new Error('Plugin package must name its compiled plugin module (meta.pluginId).');
  const content = pkg.content as Record<string, Array<Record<string, unknown>>>;
  for (const asset of pkg.assets) {
    if (typeof asset.name !== 'string' || !asset.name.trim()) throw new Error(`Asset ${asset.id} is missing its filename.`);
    if (asset.hash !== undefined && (typeof asset.hash !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(asset.hash))) throw new Error(`Asset ${asset.id} has an invalid content hash.`);
  }
  for (const graph of content.graphs) {
    const parsed = z.object({ nodes: entities, edges: z.array(z.object({ id, source: id, target: id }).passthrough()) }).safeParse(graph);
    if (!parsed.success) throw new Error(`Graph ${graph.id} is missing valid nodes or connections.`);
    const nodeIds = new Set(parsed.data.nodes.map((node) => node.id));
    for (const edge of parsed.data.edges) if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) throw new Error(`Graph ${graph.id} has a connection to a missing node.`);
    for (const node of parsed.data.nodes) {
      if (!node.data || typeof node.data !== 'object' || typeof (node.data as Record<string, unknown>).nodeKind !== 'string') throw new Error(`Graph ${graph.id} has a node without its type.`);
    }
  }
  for (const scene of content.scenes ?? []) if (!Array.isArray(scene.objects)) throw new Error(`Scene ${scene.id} is missing its objects.`);
  const refs = new Map<string, Set<string>>();
  for (const doc of content.uiDocuments) {
    const seen = new Set<string>(), dependencies = new Set<string>();
    const walk = (rawElement: unknown, depth: number) => {
      if (depth > 100 || seen.size > 10000) throw new Error(`UI ${doc.id} exceeds the widget nesting or count limit.`);
      const parsed = widget.safeParse(rawElement);
      if (!parsed.success) throw new Error(`UI ${doc.id} has an invalid widget: ${parsed.error.issues[0].message}`);
      const element = parsed.data;
      if (seen.has(element.id)) throw new Error(`UI ${doc.id} has duplicate widget id ${element.id}.`);
      seen.add(element.id);
      if (element.kind === 'component' && element.componentId) dependencies.add(element.componentId);
      element.children.forEach((child) => walk(child, depth + 1));
    };
    walk(doc.root, 0);
    refs.set(String(doc.id), dependencies);
  }
  const done = new Set<string>(), active = new Set<string>();
  const visit = (docId: string) => {
    if (active.has(docId)) throw new Error(`UI component cycle involving ${docId}.`);
    if (done.has(docId)) return;
    if (!refs.has(docId)) throw new Error(`Package is missing UI component ${docId}.`);
    if (active.size > 100) throw new Error('UI component nesting exceeds 100 levels.');
    active.add(docId);
    refs.get(docId)!.forEach(visit);
    active.delete(docId); done.add(docId);
  };
  refs.forEach((_, key) => visit(key));
  return pkg;
}
