import { ExternalLink } from 'lucide-react';
import { findCreatorRole } from '../roles';
import { findBehaviorPreset, type BehaviorParameter } from '../../project/behaviors';
import { useEditorStore } from '../../store/editorStore';
import type { GraphValue, SceneObject } from '../../types';
import { focusWorkspacePanel } from '../../components/workspacePanels';

function scriptedDefault(parameter: BehaviorParameter, script: string): GraphValue {
  const escapedKey = parameter.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = script.match(new RegExp(`^\\s*var\\s+${escapedKey}\\s*:\\s*\\w+\\s*=\\s*(.+?)\\s*$`, 'm'));
  const source = match?.[1]?.trim();
  if (parameter.type === 'number') {
    const value = Number(source);
    return Number.isFinite(value) ? value : (parameter.min ?? 0);
  }
  if (parameter.type === 'boolean') return source === 'true';
  if (source && /^(["']).*\1$/.test(source)) return source.slice(1, -1);
  return source ?? '';
}

function ParameterControl({ object, parameter, script }: { object: SceneObject; parameter: BehaviorParameter; script: string }) {
  const setObjectVariable = useEditorStore((state) => state.setObjectVariable);
  const value = object.variables?.[parameter.key] ?? scriptedDefault(parameter, script);

  if (parameter.type === 'boolean') {
    return (
      <label className="creator-gameplay-field boolean">
        <span>
          <strong>{parameter.label}</strong>
          {parameter.description && <small>{parameter.description}</small>}
        </span>
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => setObjectVariable(object.id, parameter.key, event.target.checked)}
        />
      </label>
    );
  }

  return (
    <label className="creator-gameplay-field">
      <span>
        <strong>{parameter.label}</strong>
        {parameter.description && <small>{parameter.description}</small>}
      </span>
      <span className="creator-gameplay-control">
        {parameter.type === 'color' ? (
          <input
            type="color"
            value={typeof value === 'string' ? value : '#ffffff'}
            onChange={(event) => setObjectVariable(object.id, parameter.key, event.target.value)}
          />
        ) : (
          <input
            type={parameter.type === 'number' ? 'number' : 'text'}
            value={typeof value === 'number' || typeof value === 'string' ? value : ''}
            min={parameter.min}
            max={parameter.max}
            step={parameter.step}
            onChange={(event) =>
              setObjectVariable(
                object.id,
                parameter.key,
                parameter.type === 'number' ? Number(event.target.value) : event.target.value,
              )
            }
          />
        )}
        {parameter.unit && <small className="creator-field-unit">{parameter.unit}</small>}
      </span>
    </label>
  );
}

export function CreatorGameplaySection({ object }: { object: SceneObject }) {
  const role = object.creatorRoleId ? findCreatorRole(object.creatorRoleId) : undefined;
  const preset = role?.behaviorPresetId ? findBehaviorPreset(role.behaviorPresetId) : undefined;
  const setActiveBlueprint = useEditorStore((state) => state.setActiveBlueprint);
  const openObjectScript = useEditorStore((state) => state.openObjectScript);

  const openLogic = () => {
    const blueprintId = object.script?.blueprintId ?? openObjectScript(object.id);
    if (blueprintId) setActiveBlueprint(blueprintId);
    focusWorkspacePanel('scripting');
  };

  return (
    <section className="inspector-section creator-inspector-section creator-gameplay-section">
      <div className="creator-section-heading compact">
        <h3>Gameplay</h3>
        {role && <span className="creator-role-summary"><span aria-hidden>{role.icon}</span>{role.name}</span>}
      </div>

      {!role ? (
        <p className="creator-empty-copy">Choose a role above to reveal simple game settings.</p>
      ) : (
        <>
          {(preset?.parameters ?? []).length > 0 ? (
            <div className="creator-gameplay-fields">
              {preset!.parameters!.map((parameter) => (
                <ParameterControl key={parameter.key} object={object} parameter={parameter} script={preset!.script} />
              ))}
            </div>
          ) : (
            <p className="creator-empty-copy">{role.description}</p>
          )}
          {role.behaviorPresetId ? (
            <button type="button" className="creator-open-logic" onClick={openLogic}>
              <span>Open in Logic Editor</span>
              <ExternalLink size={13} aria-hidden />
            </button>
          ) : (
            <p className="creator-gameplay-runtime-note">Uses Feather's built-in character controller. Advanced controls remain available below.</p>
          )}
        </>
      )}
    </section>
  );
}
