import { Plus, Trash2, Workflow } from 'lucide-react';
import { useEditorStore } from '../store/editorStore';
import type {
  AnimatorCondition,
  AnimatorController,
  AnimatorParameter,
  AnimatorState,
  AnimatorTransition,
  CompareOperator,
} from '../types';

const COMPARE_OPS: CompareOperator[] = ['==', '!=', '>', '>=', '<', '<='];
const PARAM_SOURCES: Array<{ value: AnimatorParameter['source']; label: string }> = [
  { value: 'manual', label: 'Manual (scripts/AI)' },
  { value: 'speed', label: 'Object speed' },
  { value: 'verticalSpeed', label: 'Vertical speed' },
  { value: 'moving', label: 'Is moving' },
  { value: 'crouching', label: 'Is crouching' },
  { value: 'variable', label: 'Project variable' },
];

/** Parameters: the inputs the state machine reads. Auto-sources connect object/script state to animation. */
function ParametersEditor({ controller }: { controller: AnimatorController }) {
  const variables = useEditorStore((state) => state.variables);
  const addAnimatorParameter = useEditorStore((state) => state.addAnimatorParameter);
  const updateAnimatorParameter = useEditorStore((state) => state.updateAnimatorParameter);
  const removeAnimatorParameter = useEditorStore((state) => state.removeAnimatorParameter);

  return (
    <section className="inspector-section">
      <div className="animator-section-head">
        <h3>Parameters</h3>
        <button
          className="icon-button compact"
          title="Add parameter"
          onClick={() => addAnimatorParameter(controller.id, { name: `Param ${controller.parameters.length + 1}`, type: 'float' })}
        >
          <Plus size={14} aria-hidden />
        </button>
      </div>
      {controller.parameters.length === 0 && <p className="field-hint">No parameters yet. Add “Speed” (Float, source: Object speed) for locomotion.</p>}
      {controller.parameters.map((param) => (
        <div key={param.id} className="animator-row">
          <input
            className="animator-name"
            value={param.name}
            onChange={(event) => updateAnimatorParameter(controller.id, param.id, { name: event.target.value })}
          />
          <select
            value={param.type}
            onChange={(event) => updateAnimatorParameter(controller.id, param.id, { type: event.target.value as AnimatorParameter['type'] })}
          >
            <option value="float">Float</option>
            <option value="bool">Bool</option>
            <option value="trigger">Trigger</option>
          </select>
          <select
            value={param.source}
            onChange={(event) => updateAnimatorParameter(controller.id, param.id, { source: event.target.value as AnimatorParameter['source'] })}
          >
            {PARAM_SOURCES.map((source) => (
              <option key={source.value} value={source.value}>
                {source.label}
              </option>
            ))}
          </select>
          {param.source === 'variable' && (
            <select
              value={param.variableId ?? ''}
              onChange={(event) => updateAnimatorParameter(controller.id, param.id, { variableId: event.target.value || undefined })}
            >
              <option value="">Pick variable…</option>
              {variables.map((variable) => (
                <option key={variable.id} value={variable.id}>
                  {variable.name}
                </option>
              ))}
            </select>
          )}
          <button className="icon-button compact danger" title="Remove" onClick={() => removeAnimatorParameter(controller.id, param.id)}>
            <Trash2 size={13} aria-hidden />
          </button>
        </div>
      ))}
    </section>
  );
}

/** States: each plays one animation. The first added is the default (entry) state. */
function StatesEditor({ controller }: { controller: AnimatorController }) {
  const animations = useEditorStore((state) => state.animations);
  const addAnimatorState = useEditorStore((state) => state.addAnimatorState);
  const updateAnimatorState = useEditorStore((state) => state.updateAnimatorState);
  const removeAnimatorState = useEditorStore((state) => state.removeAnimatorState);
  const updateAnimatorController = useEditorStore((state) => state.updateAnimatorController);

  // Offer clips on the controller's skeleton (or all clips if the controller isn't skeleton-bound yet).
  const clips = controller.skeletonId ? animations.filter((anim) => anim.skeletonId === controller.skeletonId) : animations;

  return (
    <section className="inspector-section">
      <div className="animator-section-head">
        <h3>States</h3>
        <button className="icon-button compact" title="Add state" onClick={() => addAnimatorState(controller.id)}>
          <Plus size={14} aria-hidden />
        </button>
      </div>
      {controller.states.length === 0 && <p className="field-hint">No states yet. Add Idle / Walk / Jog and pick a clip for each.</p>}
      {controller.states.map((state: AnimatorState) => (
        <div key={state.id} className="animator-state">
          <div className="animator-row">
            <input
              className="animator-name"
              value={state.name}
              onChange={(event) => updateAnimatorState(controller.id, state.id, { name: event.target.value })}
            />
            <label className="animator-default" title="Default (entry) state">
              <input
                type="radio"
                name={`default-${controller.id}`}
                checked={controller.defaultStateId === state.id}
                onChange={() => updateAnimatorController(controller.id, { defaultStateId: state.id })}
              />
              <span>Entry</span>
            </label>
            <button className="icon-button compact danger" title="Remove" onClick={() => removeAnimatorState(controller.id, state.id)}>
              <Trash2 size={13} aria-hidden />
            </button>
          </div>
          <label className="field-row">
            <span>Clip</span>
            <select
              value={state.animationId ?? ''}
              onChange={(event) => updateAnimatorState(controller.id, state.id, { animationId: event.target.value || undefined })}
            >
              <option value="">None</option>
              {clips.map((clip) => (
                <option key={clip.id} value={clip.id}>
                  {clip.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field-row">
            <span>Speed</span>
            <input
              type="number"
              step="0.05"
              value={state.speed}
              onChange={(event) => updateAnimatorState(controller.id, state.id, { speed: Number(event.target.value) })}
            />
          </label>
          <label className="field-row">
            <span>Loop</span>
            <input
              type="checkbox"
              checked={state.loop}
              onChange={(event) => updateAnimatorState(controller.id, state.id, { loop: event.target.checked })}
            />
          </label>
        </div>
      ))}
    </section>
  );
}

/** A single transition's condition row. */
function ConditionRow({
  controller,
  transition,
  condition,
  index,
}: {
  controller: AnimatorController;
  transition: AnimatorTransition;
  condition: AnimatorCondition;
  index: number;
}) {
  const updateAnimatorTransition = useEditorStore((state) => state.updateAnimatorTransition);
  const param = controller.parameters.find((p) => p.id === condition.parameterId);
  const isBool = param?.type === 'bool' || param?.type === 'trigger';

  const setConditions = (next: AnimatorCondition[]) => updateAnimatorTransition(controller.id, transition.id, { conditions: next });
  const patch = (changes: Partial<AnimatorCondition>) =>
    setConditions(transition.conditions.map((c, i) => (i === index ? { ...c, ...changes } : c)));

  return (
    <div className="animator-row">
      <select value={condition.parameterId} onChange={(event) => patch({ parameterId: event.target.value })}>
        <option value="">Param…</option>
        {controller.parameters.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <select value={condition.op} onChange={(event) => patch({ op: event.target.value as CompareOperator })}>
        {COMPARE_OPS.map((op) => (
          <option key={op} value={op}>
            {op}
          </option>
        ))}
      </select>
      {isBool ? (
        <select value={String(condition.value)} onChange={(event) => patch({ value: event.target.value === 'true' })}>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      ) : (
        <input type="number" step="0.05" value={Number(condition.value)} onChange={(event) => patch({ value: Number(event.target.value) })} />
      )}
      <button
        className="icon-button compact danger"
        title="Remove condition"
        onClick={() => setConditions(transition.conditions.filter((_, i) => i !== index))}
      >
        <Trash2 size={12} aria-hidden />
      </button>
    </div>
  );
}

/** Transitions: from → to, taken when all conditions pass; duration is the crossfade. */
function TransitionsEditor({ controller }: { controller: AnimatorController }) {
  const addAnimatorTransition = useEditorStore((state) => state.addAnimatorTransition);
  const updateAnimatorTransition = useEditorStore((state) => state.updateAnimatorTransition);
  const removeAnimatorTransition = useEditorStore((state) => state.removeAnimatorTransition);

  const stateName = (id: string) => (id === 'any' ? 'Any State' : controller.states.find((s) => s.id === id)?.name ?? '—');

  return (
    <section className="inspector-section">
      <div className="animator-section-head">
        <h3>Transitions</h3>
        <button
          className="icon-button compact"
          title="Add transition"
          disabled={controller.states.length < 1}
          onClick={() =>
            addAnimatorTransition(controller.id, {
              from: controller.defaultStateId ?? controller.states[0]?.id ?? 'any',
              to: controller.states[0]?.id ?? '',
            })
          }
        >
          <Plus size={14} aria-hidden />
        </button>
      </div>
      {controller.transitions.length === 0 && <p className="field-hint">No transitions. Add one and set conditions (e.g. Speed &gt; 0.1).</p>}
      {controller.transitions.map((transition) => (
        <div key={transition.id} className="animator-state">
          <div className="animator-row">
            <select value={transition.from} onChange={(event) => updateAnimatorTransition(controller.id, transition.id, { from: event.target.value })}>
              <option value="any">Any State</option>
              {controller.states.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <span className="animator-arrow">→</span>
            <select value={transition.to} onChange={(event) => updateAnimatorTransition(controller.id, transition.id, { to: event.target.value })}>
              {controller.states.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <button className="icon-button compact danger" title="Remove transition" onClick={() => removeAnimatorTransition(controller.id, transition.id)}>
              <Trash2 size={13} aria-hidden />
            </button>
          </div>
          <p className="field-hint">When {stateName(transition.from)} → {stateName(transition.to)}, if ALL:</p>
          {transition.conditions.map((condition, index) => (
            <ConditionRow key={index} controller={controller} transition={transition} condition={condition} index={index} />
          ))}
          <div className="animator-row">
            <button
              className="full-button"
              onClick={() =>
                updateAnimatorTransition(controller.id, transition.id, {
                  conditions: [...transition.conditions, { parameterId: controller.parameters[0]?.id ?? '', op: '>', value: 0 }],
                })
              }
            >
              <Plus size={13} aria-hidden /> Condition
            </button>
            <label className="field-row">
              <span>Fade</span>
              <input
                type="number"
                step="0.05"
                value={transition.duration}
                onChange={(event) => updateAnimatorTransition(controller.id, transition.id, { duration: Number(event.target.value) })}
              />
            </label>
          </div>
        </div>
      ))}
    </section>
  );
}

export function AnimatorEditorPanel() {
  const controllers = useEditorStore((state) => state.animatorControllers);
  const activeAnimatorControllerId = useEditorStore((state) => state.activeAnimatorControllerId);
  const setActiveAnimatorController = useEditorStore((state) => state.setActiveAnimatorController);
  const createAnimatorController = useEditorStore((state) => state.createAnimatorController);

  const controller = controllers.find((item) => item.id === activeAnimatorControllerId) ?? controllers[0];

  return (
    <section className="panel inspector-panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Animation</span>
          <h2>Animator</h2>
        </div>
        {controllers.length > 0 && (
          <select
            className="blueprint-select"
            value={controller?.id ?? ''}
            onChange={(event) => setActiveAnimatorController(event.target.value)}
            title="Select controller"
          >
            {controllers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        )}
        <button className="icon-button compact" title="Create controller" onClick={() => createAnimatorController()}>
          <Plus size={15} aria-hidden />
        </button>
      </div>

      {!controller ? (
        <div className="empty-state wide">
          <Workflow size={18} aria-hidden />
          <span>No animator controller yet</span>
          <button className="full-button" onClick={() => createAnimatorController()}>
            Create Controller
          </button>
        </div>
      ) : (
        <div className="inspector-content">
          <section className="inspector-section title-section">
            <input
              className="name-input"
              value={controller.name}
              onChange={(event) => useEditorStore.getState().updateAnimatorController(controller.id, { name: event.target.value })}
            />
            <span className="kind-label">state machine</span>
          </section>
          <ParametersEditor controller={controller} />
          <StatesEditor controller={controller} />
          <TransitionsEditor controller={controller} />
        </div>
      )}
    </section>
  );
}
