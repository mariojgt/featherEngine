import { useEffect, useState } from 'react';
import { Check, CircleAlert } from 'lucide-react';
import { CREATOR_ROLES } from '../roles';
import { useEditorStore } from '../../store/editorStore';
import type { SceneObject } from '../../types';

interface Feedback {
  kind: 'success' | 'error';
  message: string;
}

const roleError = (error?: string) => {
  if (error === 'incompatible-kind') return 'That role needs a visible object or model.';
  if (error === 'behavior-attach-failed') return 'Feather could not create the editable behavior.';
  return 'That role could not be applied.';
};

export function MakeItPanel({ object }: { object: SceneObject }) {
  const makeObjectRole = useEditorStore((state) => state.makeObjectRole);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  // Never carry a success/error message (or implied current choice) to a newly
  // selected object. The persisted creatorRoleId remains the sole source of truth.
  useEffect(() => setFeedback(null), [object.id]);

  return (
    <section className="inspector-section creator-inspector-section make-it-section">
      <div className="creator-section-heading">
        <div>
          <span className="creator-section-kicker">Game role</span>
          <h3>Make It…</h3>
        </div>
        {object.creatorRoleId && <span className="creator-current-role">Configured</span>}
      </div>

      <div className="creator-role-grid">
        {CREATOR_ROLES.map((role) => {
          const current = object.creatorRoleId === role.id;
          const compatible = !role.compatibleKinds || role.compatibleKinds.includes(object.kind);
          return (
            <button
              type="button"
              key={role.id}
              className={current ? 'creator-role-card active' : 'creator-role-card'}
              aria-pressed={current}
              disabled={!compatible}
              title={compatible ? role.description : `${role.name} is not available for ${object.kind} objects.`}
              onClick={() => {
                setFeedback(null);
                const result = makeObjectRole(object.id, role.id);
                if (!result.ok) {
                  setFeedback({ kind: 'error', message: roleError(result.error) });
                  return;
                }
                setFeedback({
                  kind: 'success',
                  message: result.changed ? `${object.name} is now a ${role.name}.` : `${role.name} is already ready.`,
                });
              }}
            >
              <span className="creator-role-card-icon" aria-hidden>{role.icon}</span>
              <span>{role.name}</span>
              {current && <small>Current</small>}
            </button>
          );
        })}
      </div>

      {feedback && (
        <p className={`creator-action-feedback ${feedback.kind}`} role={feedback.kind === 'error' ? 'alert' : 'status'}>
          {feedback.kind === 'success' ? <Check size={14} aria-hidden /> : <CircleAlert size={14} aria-hidden />}
          <span>{feedback.message}</span>
        </p>
      )}
    </section>
  );
}
