import type { NodeForgeNode, ProjectGraph, Scene, SceneObject, ScriptBlueprint, UIDocument } from '../types';
import { visitUIElements } from './buttonActions';

export interface InteractionProblem {
  severity: 'error' | 'warning' | 'info'; message: string;
  blueprintId?: string; nodeId?: string; uiDocumentId?: string; uiElementId?: string;
}
export function nodeInteractionHints(node: NodeForgeNode, documents: UIDocument[], scenes: Array<Pick<Scene, 'id' | 'name'>>): string[] {
  const hints: string[] = [], data = node.data, kind = data.nodeKind;
  if (kind === 'action.loadScene' && !data.restartScene && !scenes.some(s => s.id === data.targetSceneId)) {
    hints.push('This level is missing. Choose a level below, or choose Current level to restart.');
  }
  if (kind === 'action.loadScene' && data.hideUIDocumentId && !documents.some(d => d.id === data.hideUIDocumentId)) {
    hints.push('The screen to close after loading is missing. Choose a screen or clear Close screen below.');
  }
  if (['ui.show', 'ui.hide', 'ui.toggle', 'ui.setText', 'ui.setVisible'].includes(kind ?? '')) {
    const doc = documents.find(d => d.id === data.documentId);
    if (!doc || doc.isComponent || (['ui.show', 'ui.hide', 'ui.toggle'].includes(kind!) && doc.surface !== 'screen')) {
      hints.push('This screen is missing or cannot be shown on its own. Choose a UI document below.');
    } else if (kind === 'ui.setText' || kind === 'ui.setVisible') {
      let found = false; visitUIElements(doc.root, el => { if (el.id === data.elementId) found = true; });
      if (!found) hints.push('This UI element is missing. Choose an element from the selected document below.');
    }
  }
  return hints;
}
/** Authored structures only; callers freeze this scan during Play. */
export function scanInteractionProblems(objects: SceneObject[], graphs: ProjectGraph[], blueprints: ScriptBlueprint[], documents: UIDocument[], scenes: Scene[]): InteractionProblem[] {
  const problems: InteractionProblem[] = [];
  const graphFor = (id?: string) => graphs.find(g => g.id === blueprints.find(b => b.id === id)?.graphId);
  const running = (id: string) => {
    const controllers = objects.filter(o => o.script?.blueprintId === id);
    return controllers.length ? controllers.some(o => o.script?.enabled !== false) : documents.some(d => d.logicBlueprintId === id && d.logicScope === 'project');
  };
  for (const blueprint of blueprints) {
    const graph = graphFor(blueprint.id); if (!graph) continue;
    const uiDocumentId = documents.find(d => d.logicBlueprintId === blueprint.id)?.id;
    for (const node of graph.nodes) for (const message of nodeInteractionHints(node, documents, scenes)) {
      problems.push({ severity: 'error', message: `${blueprint.name}: ${message}`, blueprintId: blueprint.id, nodeId: node.id, uiDocumentId });
    }
  }
  for (const doc of documents) visitUIElements(doc.root, el => {
    if (el.kind !== 'button') return;
    const target = { uiDocumentId: doc.id, uiElementId: el.id };
    const prefix = `${doc.name} / ${el.name}`;
    if (!el.onClickEvent?.trim()) {
      if (!doc.isComponent) problems.push({ ...target, severity: 'info', message: `${prefix}: this button has no action. Choose what happens when it is clicked.` });
      return;
    }
    const handlers = blueprints.flatMap(bp => (graphFor(bp.id)?.nodes ?? []).filter(n => n.data.nodeKind === 'event.custom' && (n.data.eventName || 'CustomEvent').toLowerCase() === el.onClickEvent!.toLowerCase()).map(node => ({ bp, node, graph: graphFor(bp.id)! })));
    if (!handlers.length) {
      problems.push({ ...target, severity: 'warning', message: `${prefix}: no Blueprint listens for this click. Choose a button action or add a matching Custom Event.` }); return;
    }
    const activeHandlers = handlers.filter(h => running(h.bp.id));
    if (!activeHandlers.length) {
      problems.push({ ...target, severity: 'warning', message: `${prefix}: its click Blueprint does not run in this level. Choose a button action, or attach and enable its Blueprint on an object in this level.` }); return;
    }
    for (const { bp, node, graph } of activeHandlers) {
      const connected = graph.edges.some(e => e.source === node.id && (e.sourceHandle ?? 'exec-out') === 'exec-out' && (e.targetHandle ?? 'exec-in') === 'exec-in' && graph.nodes.some(n => n.id === e.target));
      if (!connected) problems.push({ ...target, severity: 'warning', message: `${prefix}: the click event stops here. Connect its execution output to an action.`, blueprintId: bp.id, nodeId: node.id });
    }
  });
  return problems;
}
