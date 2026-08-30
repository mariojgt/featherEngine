import { useEffect, useState } from 'react';
import { ArrowRight, Check, CircleAlert, ExternalLink, Plus } from 'lucide-react';
import { findCreatorRole } from '../roles';
import {
  SIMPLE_ACTION_LABELS,
  SIMPLE_TRIGGER_LABELS,
  type SimpleInteractionAction,
  type SimpleInteractionActionType,
  type SimpleInteractionTriggerType,
} from '../simpleInteractions';
import { useEditorStore } from '../../store/editorStore';
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
const ACTIONS: SimpleInteractionActionType[] = ['move', 'rotate', 'scale', 'destroy', 'damage', 'score', 'play-sound', 'play-animation', 'spawn', 'event'];
const SPAWN_KINDS: SceneObjectKind[] = ['cube', 'sphere', 'capsule', 'plane', 'empty'];

const defaultVector = (action: SimpleInteractionActionType): Vector3Tuple => {
  if (action === 'rotate') return [0, 90, 0];
  if (action === 'scale') return [1.25, 1.25, 1.25];
  return [0, 1, 0];
};

function InteractionCard({ when, action, generated = false }: { when: string; action: string; generated?: boolean }) {
  return (
    <div className={generated ? 'creator-interaction-card generated' : 'creator-interaction-card'}>
      <div><small>When</small><strong>{when}</strong></div>
      <ArrowRight size={14} aria-hidden />
      <div><small>Do</small><strong>{action}</strong></div>
    </div>
  );
}
export function CreatorInteractionsSection({ object }: { object: SceneObject }) {
  const role = object.creatorRoleId ? findCreatorRole(object.creatorRoleId) : undefined;
  const roleInteraction = role ? ROLE_INTERACTIONS[role.id] : undefined;
  const openObjectScript = useEditorStore((state) => state.openObjectScript);
  const setActiveBlueprint = useEditorStore((state) => state.setActiveBlueprint);
  const addSimpleInteraction = useEditorStore((state) => state.addSimpleInteraction);
  const [trigger, setTrigger] = useState<SimpleInteractionTriggerType>('interact');
  const [actionType, setActionType] = useState<SimpleInteractionActionType>('rotate');
  const [seconds, setSeconds] = useState(1);
  const [duration, setDuration] = useState(0.8);
  const [amount, setAmount] = useState(10);
  const [vector, setVector] = useState<Vector3Tuple>([0, 90, 0]);
  const [reference, setReference] = useState('');
  const [spawnKind, setSpawnKind] = useState<SceneObjectKind>('cube');
  const [thenDestroy, setThenDestroy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    setFeedback(null);
  }, [object.id]);

  const autoInputPlayer = Boolean(object.character?.enabled && !object.script);

  const openLogic = () => {
    // Creating a blank graph for an auto-input Player changes its movement semantics. Its built-in
    // controller remains available under Advanced without forcing a script onto it.
    if (autoInputPlayer) return;
    const blueprintId = object.script?.blueprintId ?? openObjectScript(object.id);
    if (blueprintId) setActiveBlueprint(blueprintId);
    focusWorkspacePanel('scripting');
  };

  const setAxis = (index: number, value: number) => {
    setVector((current) => current.map((item, itemIndex) => (itemIndex === index ? value : item)) as Vector3Tuple);
  };

  const action = (): SimpleInteractionAction => {
    if (actionType === 'move' || actionType === 'rotate' || actionType === 'scale') return { type: actionType, vector };
    if (actionType === 'damage' || actionType === 'score') return { type: actionType, value: amount };
    if (actionType === 'play-sound') return { type: actionType, assetId: reference };
    if (actionType === 'play-animation') return { type: actionType, animationId: reference };
    if (actionType === 'event') return { type: actionType, eventName: reference };
    if (actionType === 'spawn') return { type: actionType, spawnKind };
    return { type: actionType };
  };

  const add = () => {
    setFeedback(null);
    const result = addSimpleInteraction(object.id, {
      trigger: { type: trigger, ...(trigger === 'timer' ? { seconds } : {}) },
      action: action(),
      ...(actionType === 'move' || actionType === 'rotate' || actionType === 'scale' ? { duration } : {}),
      ...(thenDestroy && actionType !== 'destroy' ? { then: [{ type: 'destroy' as const }] } : {}),
    });
    if (!result.ok) {
      const message = result.error === 'character-auto-runtime'
        ? 'Player interactions need graph-driven movement. Open Advanced to configure the built-in controller.'
        : result.error === 'compile-failed'
          ? `Feather could not compile this rule${result.diagnostics?.[0] ? `: ${result.diagnostics[0]}` : '.'}`
          : 'Feather could not add this rule.';
      setFeedback({ kind: 'error', message });
      return;
    }
    setFeedback({ kind: 'success', message: 'Interaction added as editable Feather logic.' });
  };

  return (
    <section className="inspector-section creator-inspector-section creator-interactions-section">
      <div className="creator-section-heading compact">
        <h3>Interactions</h3>
      </div>

      <div className="creator-interaction-list">
        {roleInteraction && <InteractionCard when={roleInteraction.when} action={roleInteraction.action} />}
        {(object.creatorInteractions ?? []).map((interaction) => (
          <InteractionCard
            key={interaction.id}
            generated
            when={SIMPLE_TRIGGER_LABELS[interaction.trigger.type]}
            action={`${SIMPLE_ACTION_LABELS[interaction.action.type]}${interaction.then?.some((item) => item.type === 'destroy') ? ' → Destroy' : ''}`}
          />
        ))}
      </div>

      {!roleInteraction && !(object.creatorInteractions?.length) && (
        <p className="creator-empty-copy">Build a trigger and action here; Feather turns it into normal editable logic.</p>
      )}

      {!autoInputPlayer ? (
        <details className="creator-interaction-builder">
          <summary><Plus size={13} aria-hidden /> Add interaction</summary>
          <div className="creator-interaction-form">
            <label>
              <span>When</span>
              <select value={trigger} onChange={(event) => setTrigger(event.target.value as SimpleInteractionTriggerType)}>
                {TRIGGERS.map((item) => <option key={item} value={item}>{SIMPLE_TRIGGER_LABELS[item]}</option>)}
              </select>
            </label>
            {trigger === 'timer' && (
              <label>
                <span>Every (seconds)</span>
                <input type="number" min={0.05} step={0.05} value={seconds} onChange={(event) => setSeconds(Number(event.target.value))} />
              </label>
            )}
            <label>
              <span>Do</span>
              <select
                value={actionType}
                onChange={(event) => {
                  const next = event.target.value as SimpleInteractionActionType;
                  setActionType(next);
                  setVector(defaultVector(next));
                  setReference('');
                }}
              >
                {ACTIONS.map((item) => <option key={item} value={item}>{SIMPLE_ACTION_LABELS[item]}</option>)}
              </select>
            </label>

            {(actionType === 'move' || actionType === 'rotate' || actionType === 'scale') && (
              <>
                <div className="creator-interaction-vector" aria-label={`${SIMPLE_ACTION_LABELS[actionType]} target`}>
                  {(['X', 'Y', 'Z'] as const).map((axis, index) => (
                    <label key={axis}><span>{axis}</span><input type="number" step={0.1} value={vector[index]} onChange={(event) => setAxis(index, Number(event.target.value))} /></label>
                  ))}
                </div>
                <label>
                  <span>Over (seconds)</span>
                  <input type="number" min={0.01} step={0.05} value={duration} onChange={(event) => setDuration(Number(event.target.value))} />
                </label>
              </>
            )}

            {(actionType === 'damage' || actionType === 'score') && (
              <label>
                <span>{actionType === 'score' ? 'Value' : 'Damage'}</span>
                <input type="number" step={1} value={amount} onChange={(event) => setAmount(Number(event.target.value))} />
              </label>
            )}

            {(actionType === 'play-sound' || actionType === 'play-animation' || actionType === 'event') && (
              <label>
                <span>{actionType === 'event' ? 'Event name' : actionType === 'play-sound' ? 'Sound asset ID' : 'Animation ID'}</span>
                <input value={reference} onChange={(event) => setReference(event.target.value)} placeholder={actionType === 'event' ? 'DoorOpened' : 'Choose or paste an asset ID'} />
              </label>
            )}

            {actionType === 'spawn' && (
              <label>
                <span>Object</span>
                <select value={spawnKind} onChange={(event) => setSpawnKind(event.target.value as SceneObjectKind)}>
                  {SPAWN_KINDS.map((kind) => <option key={kind} value={kind}>{kind[0].toUpperCase() + kind.slice(1)}</option>)}
                </select>
              </label>
            )}

            {actionType !== 'destroy' && (
              <label className="creator-interaction-check">
                <input type="checkbox" checked={thenDestroy} onChange={(event) => setThenDestroy(event.target.checked)} />
                <span>Then destroy this object</span>
              </label>
            )}

            <button type="button" className="creator-interaction-add" onClick={add}>Add to Logic</button>
          </div>
        </details>
      ) : (
        <p className="creator-gameplay-runtime-note">Player movement is using Feather's instant built-in controller. Configure it under Advanced.</p>
      )}

      {feedback && (
        <p className={`creator-action-feedback ${feedback.kind}`} role={feedback.kind === 'error' ? 'alert' : 'status'}>
          {feedback.kind === 'success' ? <Check size={14} aria-hidden /> : <CircleAlert size={14} aria-hidden />}
          <span>{feedback.message}</span>
        </p>
      )}

      {!autoInputPlayer && (
        <button type="button" className="creator-open-logic subtle" onClick={openLogic}>
          <span>{object.script ? 'Open editable logic' : 'Open Logic Editor'}</span>
          <ExternalLink size={13} aria-hidden />
        </button>
      )}
    </section>
  );
}
