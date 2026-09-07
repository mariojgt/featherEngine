import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, CircleAlert, ExternalLink, Plus } from 'lucide-react';
import { findCreatorRole } from '../roles';
import { SIMPLE_ACTION_LABELS, SIMPLE_TRIGGER_LABELS, type SimpleInteraction, type SimpleInteractionDraft, type SimpleInteractionActionType, type SimpleInteractionTriggerType } from '../simpleInteractions';
import { INTERACTION_RECIPES } from '../interactionRecipes';
import { useEditorStore } from '../../store/editorStore';
import { canEditCreatorRules, type SimpleInteractionActionResult } from '../../store/editor/simpleInteractionActions';
import type { SceneObject, SceneObjectKind, Vector3Tuple } from '../../types';
import { focusWorkspacePanel } from '../../components/workspacePanels';

const ROLE_INTERACTIONS: Record<string, { when: string; action: string }> = {
  player: { when: 'Movement input', action: 'Move + jump + interact' },
  collectible: { when: 'Player enters', action: 'Add score + collect' },
  door: { when: 'Player interacts', action: 'Open / close' },
  enemy: { when: 'Player is nearby', action: 'Chase + attack' },
  hazard: { when: 'Player enters', action: 'Deal damage' },
  destructible: { when: 'Health reaches 0', action: 'Break apart' },
  'moving-platform': { when: 'Game starts', action: 'Move back and forth' },
};
const TRIGGERS: SimpleInteractionTriggerType[] = ['interact', 'trigger-enter', 'trigger-exit', 'collision', 'start', 'timer'];
const ACTIONS = Object.keys(SIMPLE_ACTION_LABELS) as SimpleInteractionActionType[];
const initialDraft = (): SimpleInteractionDraft => structuredClone(INTERACTION_RECIPES[0].rule);
const defaultVector = (action: SimpleInteractionActionType): Vector3Tuple => action === 'rotate' ? [0, 90, 0] : action === 'scale' ? [1.25, 1.25, 1.25] : [0, 1, 0];

function InteractionCard({ when, action }: { when: string; action: string }) {
  return <div className="creator-interaction-card"><div><small>When</small><strong>{when}</strong></div><ArrowRight size={14} aria-hidden /><div><small>Do</small><strong>{action}</strong></div></div>;
}

export function CreatorInteractionsSection({ object }: { object: SceneObject }) {
  const role = object.creatorRoleId ? findCreatorRole(object.creatorRoleId) : undefined;
  const roleInteraction = role ? ROLE_INTERACTIONS[role.id] : undefined;
  const assets = useEditorStore((s) => s.assets);
  const animations = useEditorStore((s) => s.animations);
  const blueprints = useEditorStore((s) => s.blueprints);
  const graphs = useEditorStore((s) => s.graphs);
  const variables = useEditorStore((s) => s.variables);
  const playing = useEditorStore((s) => s.isPlaying);
  const editable = useMemo(() => canEditCreatorRules({ blueprints, graphs, variables }, object), [blueprints, graphs, variables, object]);
  const [draft, setDraft] = useState<SimpleInteractionDraft>(initialDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => { setFeedback(null); setDraft(initialDraft()); setEditingId(null); }, [object.id]);

  const report = (result: SimpleInteractionActionResult, message: string) => {
    setFeedback(result.ok ? { kind: 'success', message } : { kind: 'error', message: result.diagnostics?.[0] ?? `Could not change this rule (${result.error}).` });
    return result.ok;
  };
  const openLogic = () => {
    const editor = useEditorStore.getState();
    // Opening a blank script must retain built-in movement, just like adding a rule.
    if (object.character?.enabled && !object.script) editor.updateCharacterController(object.id, { autoInputWithScript: true });
    const id = object.script?.blueprintId ?? editor.openObjectScript(object.id);
    if (id) editor.setActiveBlueprint(id);
    focusWorkspacePanel('scripting');
  };
  const edit = (rule: SimpleInteraction) => {
    setDraft(structuredClone(rule)); setEditingId(rule.id); setFeedback(null);
    if (details.current) details.current.open = true;
  };
  const submit = () => {
    const editor = useEditorStore.getState();
    const result = editingId ? editor.updateSimpleInteraction(object.id, editingId, draft) : editor.addSimpleInteraction(object.id, draft);
    if (report(result, editingId ? 'Rule updated. Press Play to try it.' : 'Interaction added as editable Feather logic.')) { setEditingId(null); setDraft(initialDraft()); }
  };
  const patchAction = (patch: Partial<SimpleInteraction['action']>) => setDraft((current) => ({ ...current, action: { ...current.action, ...patch } }));
  const type = draft.action.type;
  const vector = draft.action.vector ?? defaultVector(type);
  const sounds = assets.filter((asset) => asset.type === 'audio');
  const assetOptions = type === 'play-sound' ? sounds : animations;
  const reference = type === 'play-sound' ? draft.action.assetId ?? '' : draft.action.animationId ?? '';

  return <section className="inspector-section creator-inspector-section creator-interactions-section">
    <div className="creator-section-heading compact"><h3>Interactions</h3></div>
    <div className="creator-interaction-list">
      {roleInteraction && <InteractionCard {...roleInteraction} />}
      {(object.creatorInteractions ?? []).map((rule) => {
        const managed = editable && rule.managed !== false;
        return <div className="creator-rule" key={rule.id}>
          <InteractionCard when={SIMPLE_TRIGGER_LABELS[rule.trigger.type]} action={`${SIMPLE_ACTION_LABELS[rule.action.type]}${rule.then?.some((action) => action.type === 'destroy') ? ' → Destroy' : ''}`} />
          <div className="creator-rule-actions">
            <span>{!managed ? 'Custom graph' : rule.enabled === false ? 'Disabled' : 'Active'}</span>
            {managed ? <>
              <button type="button" disabled={playing} onClick={() => edit(rule)}>Edit</button>
              <button type="button" disabled={playing} onClick={() => report(useEditorStore.getState().updateSimpleInteraction(object.id, rule.id, { ...rule, enabled: rule.enabled === false }), rule.enabled === false ? 'Rule enabled.' : 'Rule disabled.')}>{rule.enabled === false ? 'Enable' : 'Disable'}</button>
              <button type="button" disabled={playing} onClick={() => report(useEditorStore.getState().addSimpleInteraction(object.id, { ...rule, enabled: false }), 'Duplicated rule disabled. Edit it, then enable it when ready.')}>Duplicate</button>
              <button type="button" disabled={playing} onClick={() => { if (report(useEditorStore.getState().updateSimpleInteraction(object.id, rule.id, null), 'Rule deleted. Undo restores it.')) setEditingId(null); }}>Delete</button>
            </> : <button type="button" onClick={openLogic}>Open graph</button>}
          </div>
        </div>;
      })}
    </div>
    {object.creatorInteractions?.length && !editable ? <p className="field-hint">Custom graph edits are preserved. Existing cards are read-only; a new rule will be added alongside that logic.</p> : null}
    {object.character?.enabled && <p className="field-hint">Adding a rule to a built-in Player keeps its movement controls active.</p>}
    <details ref={details} className="creator-interaction-builder">
      <summary><Plus size={13} aria-hidden /> {editingId ? 'Edit interaction' : 'Add interaction'}</summary>
      <div className="creator-interaction-form">
        <label><span>Start with a recipe</span><select value="" onChange={(event) => {
          const recipe = INTERACTION_RECIPES.find((item) => item.id === event.target.value);
          if (recipe) { setDraft(structuredClone(recipe.rule)); setFeedback({ kind: 'success', message: recipe.description }); }
        }}><option value="">Choose a recipe…</option>{INTERACTION_RECIPES.map((recipe) => <option key={recipe.id} value={recipe.id}>{recipe.name}</option>)}</select></label>
        {roleInteraction && <p className="field-hint">This adds to the role above. Use Gameplay to change the role's existing behavior.</p>}
        <label><span>When</span><select value={draft.trigger.type} onChange={(event) => setDraft({ ...draft, trigger: { type: event.target.value as SimpleInteractionTriggerType, seconds: 2 } })}>
          {TRIGGERS.map((trigger) => <option key={trigger} value={trigger}>{SIMPLE_TRIGGER_LABELS[trigger]}</option>)}
        </select></label>
        {draft.trigger.type === 'timer' && <label><span>Every (seconds)</span><input type="number" min={0.05} step={0.05} value={draft.trigger.seconds ?? 2} onChange={(event) => setDraft({ ...draft, trigger: { ...draft.trigger, seconds: Number(event.target.value) } })} /></label>}
        <label><span>Do</span><select value={type} onChange={(event) => {
          const action = event.target.value as SimpleInteractionActionType;
          setDraft({ ...draft, action: { type: action, vector: defaultVector(action), value: 10 }, then: undefined });
        }}>{ACTIONS.map((action) => <option key={action} value={action}>{SIMPLE_ACTION_LABELS[action]}</option>)}</select></label>
        {['move', 'rotate', 'scale'].includes(type) && <>
          <label><span>Target {type === 'move' ? 'position (meters)' : type === 'rotate' ? 'rotation (degrees)' : 'scale'}</span><div className="creator-vector-inputs">{vector.map((value, index) => <input key={index} aria-label={`Target ${['X', 'Y', 'Z'][index]}`} type="number" step={0.1} value={value} onChange={(event) => patchAction({ vector: vector.map((n, i) => i === index ? Number(event.target.value) : n) as Vector3Tuple })} />)}</div></label>
          <label><span>Duration (seconds)</span><input type="number" min={0.01} step={0.1} value={draft.duration ?? 0.8} onChange={(event) => setDraft({ ...draft, duration: Number(event.target.value) })} /></label>
        </>}
        {(type === 'score' || type === 'damage') && <label><span>{type === 'score' ? 'Points' : 'Damage to the entering/interacting object'}</span><input type="number" min={type === 'damage' ? 0 : undefined} value={draft.action.value ?? 10} onChange={(event) => patchAction({ value: Number(event.target.value) })} /></label>}
        {(type === 'play-sound' || type === 'play-animation') && <label><span>{type === 'play-sound' ? 'Sound' : 'Animation'}</span><select value={reference} onChange={(event) => patchAction(type === 'play-sound' ? { assetId: event.target.value } : { animationId: event.target.value })}>
          <option value="">Choose {type === 'play-sound' ? 'a sound' : 'an animation'}…</option>
          {reference && !assetOptions.some((asset) => asset.id === reference) && <option value={reference}>Missing asset — choose a replacement</option>}
          {assetOptions.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
        </select>{!assetOptions.length && <small>Import {type === 'play-sound' ? 'an audio file' : 'a rigged model with animations'} in Assets first.</small>}</label>}
        {type === 'event' && <label><span>Event name</span><input value={draft.action.eventName ?? ''} placeholder="DoorOpened" onChange={(event) => patchAction({ eventName: event.target.value })} /></label>}
        {type === 'spawn' && <label><span>Object</span><select value={draft.action.spawnKind ?? 'cube'} onChange={(event) => patchAction({ spawnKind: event.target.value as SceneObjectKind })}>{['cube', 'sphere', 'capsule', 'plane', 'empty'].map((kind) => <option value={kind} key={kind}>{kind}</option>)}</select></label>}
        {type !== 'destroy' && <label className="creator-interaction-check"><input type="checkbox" checked={Boolean(draft.then?.some((action) => action.type === 'destroy'))} onChange={(event) => setDraft({ ...draft, then: event.target.checked ? [...(draft.then ?? []).filter((action) => action.type !== 'destroy'), { type: 'destroy' }] : draft.then?.filter((action) => action.type !== 'destroy') })} /><span>Then destroy this object</span></label>}
        <button type="button" disabled={playing} className="creator-interaction-add" onClick={submit}>{editingId ? 'Save rule' : 'Add to Logic'}</button>
        {editingId && <button type="button" onClick={() => { setEditingId(null); setDraft(initialDraft()); }}>Cancel edit</button>}
      </div>
    </details>
    {feedback && <p className={`creator-action-feedback ${feedback.kind}`} role={feedback.kind === 'error' ? 'alert' : 'status'}>{feedback.kind === 'success' ? <Check size={14} aria-hidden /> : <CircleAlert size={14} aria-hidden />}<span>{feedback.message}</span></p>}
    <button type="button" className="creator-open-logic subtle" onClick={openLogic}><span>{object.script ? 'Open editable logic' : 'Open Logic Editor'}</span><ExternalLink size={13} aria-hidden /></button>
  </section>;
}
