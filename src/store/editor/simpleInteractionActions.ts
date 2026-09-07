import type { StoreApi } from 'zustand';
import { graphToFeatherScript } from '../../scripting/featherScript';
import { compileFeatherScriptToGraph } from '../../scripting/featherCompiler';
import { appendSimpleInteractionToFeatherSource, simpleInteractionUsesScore, type SimpleInteraction, type SimpleInteractionDraft } from '../../creator/simpleInteractions';
import type { SceneObject, ScriptBlueprint, ProjectGraph, ProjectVariable } from '../../types';
import type { EditorState } from '../editorStore';
import { separateHistoryAction } from '../history';
import { makeId } from './ids';
import { defaultPhysics } from './defaults';
import { mapActiveSceneObjects, selectActiveObjects } from './storeHelpers';

type SetState = StoreApi<EditorState>['setState'];
type GetState = StoreApi<EditorState>['getState'];
export interface SimpleInteractionActionResult {
  ok: boolean;
  objectId: string;
  blueprintId?: string;
  interaction?: SimpleInteraction;
  error?: 'object-not-found' | 'interaction-not-found' | 'custom-logic' | 'invalid-rule' | 'compile-failed';
  diagnostics?: string[];
}

export function creatorLogicSource(state: Pick<EditorState, 'blueprints' | 'graphs' | 'variables'>, object: SceneObject): string | undefined {
  const blueprint = state.blueprints.find((item) => item.id === object.script?.blueprintId);
  const graph = state.graphs.find((item) => item.id === blueprint?.graphId);
  if (!blueprint || !graph) return undefined;
  return graphToFeatherScript({ blueprint, graph, variables: state.variables, blueprints: state.blueprints });
}

export function canEditCreatorRules(state: Pick<EditorState, 'blueprints' | 'graphs' | 'variables'>, object: SceneObject): boolean {
  const blueprint = state.blueprints.find((item) => item.id === object.script?.blueprintId);
  // An uncompiled draft is authored work too; cards must not overwrite it.
  return Boolean(object.creatorLogic && !blueprint?.featherSource && creatorLogicSource(state, object) === object.creatorLogic.generatedSource);
}

function invalidRule(state: EditorState, rule: SimpleInteractionDraft): string | undefined {
  if (rule.trigger.type === 'timer' && rule.trigger.seconds !== undefined && (!Number.isFinite(rule.trigger.seconds) || rule.trigger.seconds < 0.05)) return 'Timer interval must be at least 0.05 seconds.';
  if (rule.duration !== undefined && (!Number.isFinite(rule.duration) || rule.duration < 0.01)) return 'Duration must be at least 0.01 seconds.';
  for (const action of [rule.action, ...(rule.then ?? [])]) {
    if (action.vector && (action.vector.length !== 3 || !action.vector.every(Number.isFinite))) return 'Use three finite numbers for the target.';
    if (action.value !== undefined && (!Number.isFinite(action.value) || (action.type === 'damage' && action.value < 0))) return 'Use a valid amount; damage cannot be negative.';
    if (action.type === 'play-sound' && !state.assets.some((asset) => asset.id === action.assetId && asset.type === 'audio')) return 'Choose an imported sound.';
    if (action.type === 'play-animation' && !state.animations.some((clip) => clip.id === action.animationId)) return 'Choose an animation from this project.';
    if (action.type === 'event' && !action.eventName?.trim()) return 'Give the event a name.';
  }
  return undefined;
}

/** Compile in memory, then publish the whole change once. No half-created graph, variable or collider. */
function commitRules(set: SetState, state: EditorState, object: SceneObject, rules: SimpleInteraction[], baseSource: string | undefined, configuredRule?: SimpleInteraction): SimpleInteractionActionResult {
  const activeTriggers = rules.filter((rule) => rule.enabled !== false).map((rule) => rule.trigger.type);
  const usesSensor = activeTriggers.some((trigger) => trigger === 'trigger-enter' || trigger === 'trigger-exit');
  if (usesSensor && (activeTriggers.includes('collision') || object.character?.enabled)) {
    return { ok: false, objectId: object.id, error: 'invalid-rule', diagnostics: ['Put entry/exit rules on a separate trigger object so the player or solid collision rules keep their collider.'] };
  }
  let variables = state.variables;
  if (rules.some((rule) => rule.managed !== false && rule.enabled !== false && simpleInteractionUsesScore(rule)) && !variables.some((item) => item.name === 'Score')) {
    const score: ProjectVariable = { id: makeId('var'), name: 'Score', type: 'number', defaultValue: 0, persistent: true, createdAt: Date.now() };
    variables = [...variables, score];
  }
  const oldBlueprint = state.blueprints.find((item) => item.id === object.script?.blueprintId);
  const shared = oldBlueprint && [...state.scenes.flatMap((scene) => scene.objects), ...state.prefabs.flatMap((prefab) => prefab.objects)]
    .some((item) => item !== object && item.script?.blueprintId === oldBlueprint.id);
  const reuse = Boolean(object.creatorLogic && oldBlueprint && !shared);
  const blueprintId = reuse ? oldBlueprint!.id : makeId('blueprint');
  const graphId = reuse ? oldBlueprint!.graphId : makeId('graph');
  const name = reuse ? oldBlueprint!.name : `${object.name} Creator Logic`;
  const blueprint: ScriptBlueprint = reuse ? oldBlueprint! : {
    id: blueprintId, graphId, name, description: `Editable interactions for ${object.name}.`, color: oldBlueprint?.color ?? '#5B8CFF', createdAt: Date.now(),
  };
  const graph: ProjectGraph = { id: graphId, name: `${name} Graph`, nodes: [], edges: [] };
  let source = baseSource ?? `blueprint ${name.replace(/[^A-Za-z0-9_]+/g, '_')}`;
  for (const rule of rules) {
    if (rule.managed !== false && rule.enabled !== false) source = appendSimpleInteractionToFeatherSource(source, rule, name);
  }
  source = source.replace(/^blueprint\s+[^\n]+/m, `blueprint ${name.replace(/[^A-Za-z0-9_]+/g, '_')}`);
  const result = compileFeatherScriptToGraph({ source, blueprint, graph, variables, blueprints: state.blueprints });
  if (!result.ok || !result.graph || !result.blueprint) return { ok: false, objectId: object.id, error: 'compile-failed', diagnostics: result.diagnostics.map((item) => item.message) };
  const nextBlueprint = { ...result.blueprint, featherSource: undefined, featherSourceLastSynced: undefined };
  const blueprints = reuse ? state.blueprints.map((item) => item.id === blueprintId ? nextBlueprint : item) : [...state.blueprints, nextBlueprint];
  const generatedSource = graphToFeatherScript({ blueprint: nextBlueprint, graph: result.graph, variables, blueprints });
  let nextObject: SceneObject = {
    ...object,
    script: { blueprintId, graphId, enabled: object.script?.enabled ?? true },
    creatorInteractions: rules,
    creatorLogic: { baseSource: baseSource ?? `blueprint ${name.replace(/[^A-Za-z0-9_]+/g, '_')}`, generatedSource },
    ...(object.character?.enabled && !object.script ? { character: { ...object.character, autoInputWithScript: true } } : {}),
  };
  if (configuredRule && configuredRule.enabled !== false) {
    const trigger = configuredRule.trigger.type;
    if (trigger === 'interact') nextObject = { ...nextObject, variables: { ...nextObject.variables, interactable: true, interactPrompt: nextObject.variables?.interactPrompt ?? 'Interact' } };
    if (trigger === 'trigger-enter' || trigger === 'trigger-exit' || trigger === 'collision') {
      nextObject = { ...nextObject, physics: { ...(nextObject.physics ?? defaultPhysics(object.character ? 'kinematic' : 'fixed', 'box')), enabled: true, isTrigger: trigger !== 'collision' } };
    }
  }
  separateHistoryAction();
  set({
    ...mapActiveSceneObjects(state, (objects) => objects.map((item) => item.id === object.id ? nextObject : item)),
    variables, blueprints,
    graphs: reuse ? state.graphs.map((item) => item.id === graphId ? result.graph! : item) : [...state.graphs, result.graph],
    isDirty: true,
  });
  return { ok: true, objectId: object.id, blueprintId, interaction: configuredRule };
}

export const applyAddSimpleInteraction = (set: SetState, get: GetState, objectId: string, draft: SimpleInteractionDraft): SimpleInteractionActionResult => {
  const state = get();
  const object = selectActiveObjects(state).find((item) => item.id === objectId);
  if (!object) return { ok: false, objectId, error: 'object-not-found' };
  const issue = invalidRule(state, draft);
  if (issue) return { ok: false, objectId, error: 'invalid-rule', diagnostics: [issue] };
  const blueprint = state.blueprints.find((item) => item.id === object.script?.blueprintId);
  if (blueprint?.featherSource) return { ok: false, objectId, error: 'custom-logic', diagnostics: ['Apply or discard the code draft before adding a rule.'] };
  const managed = canEditCreatorRules(state, object);
  const interaction: SimpleInteraction = { ...draft, id: makeId('interaction'), managed: true };
  const previous = (object.creatorInteractions ?? []).map((rule) => managed ? rule : { ...rule, managed: false });
  return commitRules(set, state, object, [...previous, interaction], managed ? object.creatorLogic!.baseSource : creatorLogicSource(state, object), interaction);
};

export const applyUpdateSimpleInteraction = (set: SetState, get: GetState, objectId: string, interactionId: string, draft: SimpleInteractionDraft | null): SimpleInteractionActionResult => {
  const state = get();
  const object = selectActiveObjects(state).find((item) => item.id === objectId);
  if (!object) return { ok: false, objectId, error: 'object-not-found' };
  const current = object.creatorInteractions?.find((rule) => rule.id === interactionId);
  if (!current) return { ok: false, objectId, error: 'interaction-not-found' };
  if (!canEditCreatorRules(state, object) || current.managed === false) return { ok: false, objectId, error: 'custom-logic', diagnostics: ['This graph has custom edits. Open Logic to change it without losing your work.'] };
  const issue = draft && invalidRule(state, draft);
  if (issue) return { ok: false, objectId, error: 'invalid-rule', diagnostics: [issue] };
  const next = draft ? { ...draft, id: interactionId, managed: true } : undefined;
  const rules = object.creatorInteractions!.flatMap((rule) => rule.id === interactionId ? next ? [next] : [] : [rule]);
  return commitRules(set, state, object, rules, object.creatorLogic!.baseSource, next);
};
