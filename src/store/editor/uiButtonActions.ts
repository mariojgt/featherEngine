import { separateHistoryAction } from '../history';
import type { StoreApi } from 'zustand';
import type { EditorState } from '../editorStore';
import { invalidateFeatherSourceForGraph } from '../editorStore';
import type { NodeForgeNode, ProjectGraph, ScriptBlueprint } from '../../types';
import { buttonActionNodeSpecs, buttonGraphSignature, countUIEventUsers, ownedButtonGraph, validateUIButtonAction, type UIButtonAction } from '../../ui/buttonActions';
import { findUIElement, mapUIElement } from './ui';
import { makeNodeData } from './graph';
import { makeId } from './ids';
import { canUseHostOnlyFeatures } from '../../collaboration/access';
type SetState = StoreApi<EditorState>['setState'];

/** One authored transaction: the button, its owned graph branch and document scope undo together. */
export function applySetUIButtonAction(set: SetState, docId: string, elementId: string, action: UIButtonAction): { blueprintId?: string; nodeId?: string } {
  let result: { blueprintId?: string; nodeId?: string } = {};
  set(state => {
    if (state.isPlaying) throw new Error('Stop Play before changing a button action.');
    if (!canUseHostOnlyFeatures()) throw new Error('Only the collaboration host can configure button actions.');
    const doc = state.uiDocuments.find(d => d.id === docId), button = doc && findUIElement(doc.root, elementId);
    if (!doc || !button || button.kind !== 'button') throw new Error('Select a button in the UI designer.');
    const error = validateUIButtonAction(action, state.scenes, state.uiDocuments); if (error) throw new Error(error);
    separateHistoryAction();
    const owned = ownedButtonGraph(doc, button, state.blueprints, state.graphs);
    // Shared or hand-edited handlers remain in place. This button gets its own new event and branch.
    const keepCustom = action.kind === 'customEvent' && action.eventName.trim().toLowerCase() === button.onClickEvent?.toLowerCase();
    const replaceable = owned && !keepCustom && countUIEventUsers(state.uiDocuments, button.onClickEvent!) === 1;
    let graphs = state.graphs;
    if (replaceable) {
      const ids = new Set(button.clickAction!.nodeIds);
      graphs = graphs.map(g => g.id === owned.id ? { ...g, nodes: g.nodes.filter(n => !ids.has(n.id)), edges: g.edges.filter(e => !ids.has(e.source) && !ids.has(e.target)) } : g);
    }
    let blueprints = state.blueprints;
    if (replaceable) blueprints = invalidateFeatherSourceForGraph(blueprints, owned.id);
    if (action.kind === 'none' || action.kind === 'customEvent') return {
      graphs, blueprints,
      uiDocuments: state.uiDocuments.map(d => d.id === docId ? { ...d, root: mapUIElement(d.root, elementId, el => ({ ...el, clickAction: undefined, onClickEvent: action.kind === 'customEvent' ? action.eventName.trim() : undefined })) } : d),
      isDirty: true,
    };
    let blueprint = blueprints.find(b => b.id === doc.logicBlueprintId);
    let graph = graphs.find(g => g.id === blueprint?.graphId);
    if (blueprint && !graph) throw new Error('This UI lost its Blueprint graph. Restore the graph or unlink it before adding an action.');
    if (!blueprint || !graph) {
      const graphId = makeId('graph');
      blueprint = { id: makeId('blueprint'), graphId, name: `${doc.name} Logic`, description: 'Button actions. Open Logic to extend these connections.', color: '#3DDC97', createdAt: Date.now(), folderId: doc.folderId } satisfies ScriptBlueprint;
      graph = { id: graphId, name: blueprint.name, nodes: [], edges: [] } satisfies ProjectGraph;
      graphs = [...graphs, graph]; blueprints = [...blueprints, blueprint];
    }
    const eventName = `feather.ui.${makeId('click')}`;
    const oldNodes = replaceable ? button.clickAction!.nodeIds.map(id => owned.nodes.find(n => n.id === id)) : [];
    const y = oldNodes[0]?.position.y ?? (graph.nodes.length ? Math.max(...graph.nodes.map(n => n.position.y)) + 220 : 60);
    const specs = [{ label: 'Custom Event', category: 'Events' as const, data: { eventName } }, ...buttonActionNodeSpecs(action, doc)];
    const nodes: NodeForgeNode[] = specs.map((spec, i) => ({ id: oldNodes[i]?.id ?? makeId('node'), type: 'nodeforge', position: oldNodes[i]?.position ?? { x: 60 + i * 285, y }, data: makeNodeData(spec.label, spec.category, spec.data) }));
    const edges = nodes.slice(1).map((node, i) => ({ id: makeId('edge'), source: nodes[i].id, target: node.id, sourceHandle: 'exec-out', targetHandle: 'exec-in', type: 'smoothstep', animated: false }));
    const updated = { ...graph, nodes: [...graph.nodes, ...nodes], edges: [...graph.edges, ...edges] };
    const binding = { version: 1 as const, action, blueprintId: blueprint.id, eventName, nodeIds: nodes.map(n => n.id), signature: buttonGraphSignature(updated, nodes.map(n => n.id)) };
    result = { blueprintId: blueprint.id, nodeId: nodes[0].id };
    return {
      graphs: graphs.map(g => g.id === graph.id ? updated : g),
      blueprints: invalidateFeatherSourceForGraph(blueprints, graph.id),
      uiDocuments: state.uiDocuments.map(d => d.id === docId ? { ...d, logicBlueprintId: blueprint.id, logicScope: 'project' as const, root: mapUIElement(d.root, elementId, el => ({ ...el, onClickEvent: eventName, clickAction: binding })) } : d),
      isDirty: true,
    };
  });
  return result;
}
