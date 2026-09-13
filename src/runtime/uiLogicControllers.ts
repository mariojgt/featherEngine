import type { SceneObject, ScriptBlueprint, UIDocument } from '../types';
/** Project-scoped UI logic has one transient controller in each played level. Authored scenes stay clean. */
export function withProjectUILogic(objects: SceneObject[], documents: UIDocument[], blueprints: ScriptBlueprint[]): SceneObject[] {
  const ids = new Set(documents.filter(d => d.logicScope === 'project' && d.logicBlueprintId).map(d => d.logicBlueprintId!));
  const added: SceneObject[] = [];
  for (const id of ids) {
    // An authored controller (including an intentionally disabled one) takes precedence.
    if (objects.some(o => o.script?.blueprintId === id)) continue;
    const blueprint = blueprints.find(b => b.id === id); if (!blueprint) continue;
    let objectId = `ui-controller:${id}`;
    while (objects.some(o => o.id === objectId) || added.some(o => o.id === objectId)) objectId += ':';
    added.push({ id: objectId, name: `${blueprint.name} UI Logic`, kind: 'empty', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, script: { blueprintId: id, graphId: blueprint.graphId, enabled: true } });
  }
  return added.length ? [...objects, ...added] : objects;
}
