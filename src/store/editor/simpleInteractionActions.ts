import type { StoreApi } from 'zustand';
import { graphToFeatherScript } from '../../scripting/featherScript';
import {
  appendSimpleInteractionToFeatherSource,
  simpleInteractionUsesScore,
  type SimpleInteraction,
  type SimpleInteractionDraft,
} from '../../creator/simpleInteractions';
import type { SceneObject } from '../../types';
import type { EditorState } from '../editorStore';
import { makeId } from './ids';
import { mapActiveSceneObjects, selectActiveObjects } from './storeHelpers';

type SetState = StoreApi<EditorState>['setState'];
type GetState = StoreApi<EditorState>['getState'];

export interface SimpleInteractionActionResult {
  ok: boolean;
  objectId: string;
  blueprintId?: string;
  interaction?: SimpleInteraction;
  error?: 'object-not-found' | 'character-auto-runtime' | 'compile-failed';
  diagnostics?: string[];
}

const objectById = (state: EditorState, objectId: string): SceneObject | undefined =>
  selectActiveObjects(state).find((object) => object.id === objectId);

const sourceForObject = (state: EditorState, object: SceneObject): string | undefined => {
  const blueprint = state.blueprints.find((item) => item.id === object.script?.blueprintId);
  const graph = state.graphs.find((item) => item.id === blueprint?.graphId);
  if (!blueprint || !graph) return undefined;
  return graphToFeatherScript({ blueprint, graph, variables: state.variables, blueprints: state.blueprints });
};

/**
 * Append one Creator rule to an object-specific, ordinary Blueprint. Shared role Blueprints are
 * always forked first, so adding an interaction to one coin/door never changes its siblings.
 */
export const applyAddSimpleInteraction = (
  set: SetState,
  get: GetState,
  objectId: string,
  draft: SimpleInteractionDraft,
): SimpleInteractionActionResult => {
  const object = objectById(get(), objectId);
  if (!object) return { ok: false, objectId, error: 'object-not-found' };
  // Attaching any Blueprint deliberately changes the existing character controller from auto-input
  // to graph-driven input. Keep the one-click Player playable instead of silently changing semantics.
  if (object.character?.enabled && !object.script) {
    return { ok: false, objectId, error: 'character-auto-runtime' };
  }

  const interaction: SimpleInteraction = { ...draft, id: makeId('interaction') };

  if (simpleInteractionUsesScore(interaction) && !get().variables.some((item) => item.name === 'Score')) {
    const variableId = get().createVariable('Score', 'number', true);
    get().updateVariable(variableId, { defaultValue: 0 });
  }

  if (interaction.trigger.type === 'interact') {
    get().setObjectVariable(objectId, 'interactable', true);
    if (objectById(get(), objectId)?.variables?.interactPrompt === undefined) {
      get().setObjectVariable(objectId, 'interactPrompt', 'Interact');
    }
  } else if (interaction.trigger.type === 'trigger-enter' || interaction.trigger.type === 'trigger-exit') {
    if (!objectById(get(), objectId)?.physics) get().togglePhysics(objectId);
    get().updatePhysics(objectId, { enabled: true, bodyType: 'fixed', isTrigger: true });
  } else if (interaction.trigger.type === 'collision') {
    if (!objectById(get(), objectId)?.physics) get().togglePhysics(objectId);
    get().updatePhysics(objectId, { enabled: true, bodyType: 'fixed', isTrigger: false });
  }

  const latest = objectById(get(), objectId)!;
  const existingSource = sourceForObject(get(), latest);
  const blueprintName = `${latest.name} Creator Logic`;
  const source = appendSimpleInteractionToFeatherSource(existingSource, interaction, blueprintName);

  // The first Creator interaction always gets an object-specific Blueprint. Later additions safely
  // update that already-forked graph, preserving any manual Logic-editor edits made between additions.
  let blueprintId = latest.creatorInteractions?.length ? latest.script?.blueprintId : undefined;
  let createdBlueprint = false;
  if (!blueprintId) {
    blueprintId = get().createBlueprintNamed(blueprintName, `Creator interactions for ${latest.name}.`).blueprintId;
    createdBlueprint = true;
  }

  const compiled = get().applyBlueprintFeatherSource(blueprintId, source);
  if (!compiled.ok) {
    if (createdBlueprint) get().deleteBlueprint(blueprintId);
    return {
      ok: false,
      objectId,
      error: 'compile-failed',
      diagnostics: compiled.diagnostics.map((item) => item.message),
    };
  }

  get().attachScript(objectId, blueprintId);
  set((state) => ({
    ...mapActiveSceneObjects(state, (objects) =>
      objects.map((item) =>
        item.id === objectId
          ? { ...item, creatorInteractions: [...(item.creatorInteractions ?? []), interaction] }
          : item,
      ),
    ),
    isDirty: true,
  }));

  return { ok: true, objectId, blueprintId, interaction };
};
