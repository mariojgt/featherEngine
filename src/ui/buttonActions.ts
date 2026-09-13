import type { NodeForgeNode, NodeForgeNodeData, ProjectGraph, ScriptBlueprint, UIDocument, UIElement, Scene } from '../types';

export type UIButtonAction =
  | { kind: 'none' }
  | { kind: 'customEvent'; eventName: string }
  | { kind: 'loadScene'; sceneId: string; hideCurrent?: boolean }
  | { kind: 'restartScene' }
  | { kind: 'showUI' | 'toggleUI'; documentId: string; hideCurrent?: boolean }
  | { kind: 'hideUI'; documentId: string }
  | { kind: 'resumeGame' }
  | { kind: 'pauseGame'; documentId: string };
export interface UIButtonActionBinding {
  version: 1; action: UIButtonAction; blueprintId: string; eventName: string; nodeIds: string[]; signature: string;
}
export const UI_BUTTON_ACTION_LABELS: Record<UIButtonAction['kind'], string> = {
  none: 'No action', customEvent: 'Custom Blueprint event', loadScene: 'Start game / load level', restartScene: 'Restart current level',
  showUI: 'Open a screen', hideUI: 'Close a screen', toggleUI: 'Toggle a screen', resumeGame: 'Resume game', pauseGame: 'Pause and open a screen',
};
export const buttonActionNeedsScreen = (kind: UIButtonAction['kind']) => ['showUI', 'hideUI', 'toggleUI', 'pauseGame'].includes(kind);
export function validateUIButtonAction(action: UIButtonAction, scenes: Scene[], documents: UIDocument[]): string | null {
  if (action.kind === 'loadScene' && !scenes.some(s => s.id === action.sceneId)) return 'Choose the level this button should open.';
  if ('documentId' in action && !documents.some(d => d.id === action.documentId && d.surface === 'screen' && !d.isComponent)) return 'Choose a screen this button should open or close.';
  if (action.kind === 'customEvent' && !action.eventName.trim()) return 'Enter the custom event name.';
  return null;
}
export function visitUIElements(root: UIElement, visit: (element: UIElement) => void) { visit(root); root.children.forEach(child => visitUIElements(child, visit)); }
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
};
/** Positions/selection are freely editable. Semantic node edits and any extra wiring relinquish ownership. */
export function buttonGraphSignature(graph: ProjectGraph, nodeIds: string[]): string {
  const ids = new Set(nodeIds);
  const nodes = nodeIds.map(id => { const node = graph.nodes.find(n => n.id === id); return node ? { id, data: node.data } : null; });
  const edges = graph.edges.filter(e => ids.has(e.source) || ids.has(e.target)).map(e => ({ source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? 'exec-out', targetHandle: e.targetHandle ?? 'exec-in' })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return JSON.stringify(canonical({ nodes, edges }));
}
export function ownedButtonGraph(doc: UIDocument, element: UIElement, blueprints: ScriptBlueprint[], graphs: ProjectGraph[]): ProjectGraph | undefined {
  const binding = element.clickAction;
  if (!binding || binding.version !== 1 || element.onClickEvent !== binding.eventName || binding.blueprintId !== doc.logicBlueprintId) return;
  const blueprint = blueprints.find(b => b.id === binding.blueprintId), graph = graphs.find(g => g.id === blueprint?.graphId);
  if (!graph || buttonGraphSignature(graph, binding.nodeIds) !== binding.signature) return;
  return graph;
}
export function countUIEventUsers(documents: UIDocument[], eventName: string): number {
  let count = 0;
  documents.forEach(doc => visitUIElements(doc.root, el => { if (el.onClickEvent?.toLowerCase() === eventName.toLowerCase()) count++; }));
  return count;
}
export function currentUIButtonAction(doc: UIDocument, element: UIElement, blueprints: ScriptBlueprint[], graphs: ProjectGraph[]): UIButtonAction {
  if (ownedButtonGraph(doc, element, blueprints, graphs)) return element.clickAction!.action;
  return element.onClickEvent ? { kind: 'customEvent', eventName: element.onClickEvent } : { kind: 'none' };
}
export interface ActionNodeSpec { label: string; category: NodeForgeNodeData['category']; data: Partial<NodeForgeNodeData> }
export function buttonActionNodeSpecs(action: UIButtonAction, doc: UIDocument): ActionNodeSpec[] {
  const specs: ActionNodeSpec[] = [];
  const add = (label: string, category: ActionNodeSpec['category'], data: ActionNodeSpec['data']) => specs.push({ label, category, data });
  const hideCurrent = () => { if (doc.surface === 'screen' && !doc.isComponent) add('Hide UI', 'UI', { documentId: doc.id }); };
  if (action.kind === 'loadScene') {
    add('Load Scene', 'Runtime', { targetSceneId: action.sceneId, hideUIDocumentId: action.hideCurrent !== false && doc.surface === 'screen' && !doc.isComponent ? doc.id : undefined });
  } else if (action.kind === 'restartScene') {
    add('Load Scene', 'Runtime', { restartScene: true });
  } else if (action.kind === 'showUI' || action.kind === 'toggleUI') {
    if (action.hideCurrent && action.documentId !== doc.id) hideCurrent();
    add(action.kind === 'showUI' ? 'Show UI' : 'Toggle UI', 'UI', { documentId: action.documentId });
  } else if (action.kind === 'hideUI') add('Hide UI', 'UI', { documentId: action.documentId });
  else if (action.kind === 'resumeGame') {
    add('Set Time Scale', 'Runtime', { numberValue: 1 }); hideCurrent();
  } else if (action.kind === 'pauseGame') {
    add('Show UI', 'UI', { documentId: action.documentId }); add('Set Time Scale', 'Runtime', { numberValue: 0 });
  }
  return specs;
}
export const buttonEventNode = (graph: ProjectGraph, name: string): NodeForgeNode | undefined => graph.nodes.find(n => n.data.nodeKind === 'event.custom' && (n.data.eventName || 'CustomEvent').toLowerCase() === name.toLowerCase());

/** Keep private event ids out of the graph's main reading path. The editable event name remains in Details. */
export function uiClickCaption(nodeId: string, data: NodeForgeNodeData, documents: UIDocument[]): string | undefined {
  if (data.nodeKind !== 'event.custom') return;
  for (const doc of documents) {
    let caption: string | undefined;
    visitUIElements(doc.root, element => {
      if (!caption && element.clickAction?.nodeIds[0] === nodeId && element.onClickEvent === data.eventName) caption = `Click: ${element.name}`;
    });
    if (caption) return caption;
  }
}
