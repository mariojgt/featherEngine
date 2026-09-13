import { useEditorStore } from '../store/editorStore';
import { focusWorkspacePanel } from './workspacePanels';
import type { InteractionProblem } from '../ui/interactionProblems';
import { buttonEventNode } from '../ui/buttonActions';

export function revealInteractionProblem(problem: InteractionProblem) {
  const state = useEditorStore.getState();
  if (problem.uiDocumentId) {
    state.setActiveUIDocument(problem.uiDocumentId);
    if (problem.uiElementId) state.selectUIElement(problem.uiElementId);
  }
  const doc = state.uiDocuments.find(d => d.id === problem.uiDocumentId);
  const inUILogic = problem.blueprintId && doc?.logicBlueprintId === problem.blueprintId;
  if (problem.blueprintId) {
    state.setActiveBlueprint(problem.blueprintId);
    state.selectGraphNode(problem.nodeId);
  }
  if (inUILogic || !problem.blueprintId && problem.uiDocumentId) {
    state.setUIEditorMode(inUILogic ? 'logic' : 'design');
    focusWorkspacePanel('ui');
  } else if (problem.blueprintId) focusWorkspacePanel('scripting');
}
export function showUIButtonLogic(documentId: string, eventName?: string) {
  const state = useEditorStore.getState(), doc = state.uiDocuments.find(d => d.id === documentId);
  if (!doc) return;
  // Prefer the document's handler, then an existing custom handler elsewhere.
  const candidates = [...state.blueprints].sort((a, b) => Number(b.id === doc.logicBlueprintId) - Number(a.id === doc.logicBlueprintId));
  for (const bp of candidates) {
    const graph = state.graphs.find(g => g.id === bp.graphId), node = graph && eventName && buttonEventNode(graph, eventName);
    if (node) { revealInteractionProblem({ severity: 'info', message: '', uiDocumentId: documentId, blueprintId: bp.id, nodeId: node.id }); return bp.id; }
  }
  const blueprintId = state.openUILogic(documentId);
  revealInteractionProblem({ severity: 'info', message: '', uiDocumentId: documentId, blueprintId });
  return blueprintId;
}
