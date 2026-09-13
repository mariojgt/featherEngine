import { useEffect, useMemo, useState } from 'react';
import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import type { UIDocument, UIElement } from '../types';
import { currentUIButtonAction, UI_BUTTON_ACTION_LABELS, validateUIButtonAction, type UIButtonAction } from '../ui/buttonActions';
import { scanInteractionProblems } from '../ui/interactionProblems';
import { revealInteractionProblem, showUIButtonLogic } from './interactionNavigation';

export function UIButtonActionFields({ doc, element }: { doc: UIDocument; element: UIElement }) {
  const documents = useEditorStore(s => s.uiDocuments), graphs = useEditorStore(s => s.graphs), blueprints = useEditorStore(s => s.blueprints);
  const scenes = useEditorStore(s => s.isPlaying ? null : s.scenes), objects = useEditorStore(s => s.isPlaying ? null : selectActiveObjects(s));
  const isPlaying = useEditorStore(s => s.isPlaying), setAction = useEditorStore(s => s.setUIButtonAction);
  const current = currentUIButtonAction(doc, element, blueprints, graphs), currentKey = JSON.stringify(current);
  const [draft, setDraft] = useState<UIButtonAction>(current), [error, setError] = useState('');
  useEffect(() => { setDraft(JSON.parse(currentKey)); setError(''); }, [doc.id, element.id, currentKey]);
  const problems = useMemo(() => objects && scenes ? scanInteractionProblems(objects, graphs, blueprints, documents, scenes).filter(p => p.uiDocumentId === doc.id && (p.uiElementId === element.id || p.nodeId && element.clickAction?.nodeIds.includes(p.nodeId))) : [], [objects, scenes, graphs, blueprints, documents, doc.id, element]);
  const screens = documents.filter(d => d.surface === 'screen' && !d.isComponent);
  const changed = JSON.stringify(draft) !== currentKey;
  const validation = validateUIButtonAction(draft, scenes ?? [], documents);
  const chooseKind = (kind: UIButtonAction['kind']) => {
    setError('');
    if (kind === 'customEvent') setDraft({ kind, eventName: element.onClickEvent ?? '' });
    else if (kind === 'loadScene') setDraft({ kind, sceneId: '', hideCurrent: true });
    else if (kind === 'showUI' || kind === 'toggleUI' || kind === 'pauseGame') setDraft({ kind, documentId: '' });
    else if (kind === 'hideUI') setDraft({ kind, documentId: doc.surface === 'screen' && !doc.isComponent ? doc.id : '' });
    else setDraft({ kind });
  };
  return <section className="ui-button-action" aria-label="Button behavior">
    <strong>When clicked</strong>
    <fieldset disabled={isPlaying}>
      <label className="node-field"><span>Action</span>
        <select aria-label="Button action" value={draft.kind} onChange={e => chooseKind(e.target.value as UIButtonAction['kind'])}>
          {Object.entries(UI_BUTTON_ACTION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      {draft.kind === 'loadScene' && <label className="node-field"><span>Level</span><select aria-label="Action level" value={draft.sceneId} onChange={e => setDraft({ ...draft, sceneId: e.target.value })}>
        <option value="">Choose a level…</option>
        {draft.sceneId && !scenes?.some(s => s.id === draft.sceneId) && <option value={draft.sceneId}>Missing level — choose another</option>}
        {(scenes ?? []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select></label>}
      {'documentId' in draft && <label className="node-field"><span>Screen</span><select aria-label="Action screen" value={draft.documentId} onChange={e => setDraft({ ...draft, documentId: e.target.value })}>
        <option value="">Choose a screen…</option>
        {draft.documentId && !screens.some(d => d.id === draft.documentId) && <option value={draft.documentId}>Missing screen — choose another</option>}
        {screens.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>{screens.length === 0 && <small>Create a screen in the UI designer first.</small>}</label>}
      {['loadScene', 'showUI', 'toggleUI'].includes(draft.kind) && doc.surface === 'screen' && !doc.isComponent && <label className="ui-action-check">
        <input type="checkbox" checked={'hideCurrent' in draft ? draft.hideCurrent ?? draft.kind === 'loadScene' : false} onChange={e => setDraft({ ...draft, hideCurrent: e.target.checked } as UIButtonAction)} />Close this screen
      </label>}
      {draft.kind === 'customEvent' && <label className="node-field"><span>Event name</span><input aria-label="Button custom event" value={draft.eventName} placeholder="e.g. buyUpgrade" onChange={e => setDraft({ ...draft, eventName: e.target.value })} /><small>The name must match a Custom Event in a running Blueprint.</small></label>}
      {draft.kind === 'restartScene' && <small>Resets the current level and resumes play. Project variables such as score are kept; reset those in Logic if needed.</small>}
      {draft.kind === 'resumeGame' && <small>Resumes game time and closes this screen.</small>}
      {draft.kind === 'pauseGame' && <small>Opens the screen and pauses game time. Give that screen a Resume game button.</small>}
      {element.clickAction && current.kind === 'customEvent' && <small>This logic was edited by hand. Applying a different action keeps the existing graph and creates a new click handler.</small>}
      {changed && validation && <small>{validation}</small>}
      <div className="ui-action-buttons">
        <button type="button" disabled={!changed || !!validation} onClick={() => { try { setAction(doc.id, element.id, draft); setError(''); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }}>Apply action</button>
        {element.onClickEvent && <button type="button" onClick={() => showUIButtonLogic(doc.id, element.onClickEvent)}>Show logic</button>}
      </div>
    </fieldset>
    {isPlaying && <small>Stop Play to change this button.</small>}
    {error && <p role="alert">{error}</p>}
    {!isPlaying && problems.length > 0 && <div className="interaction-guidance" aria-label="Button guidance">{problems.map((p, i) => <div key={i}><small>{p.message}</small>{p.nodeId && <button type="button" onClick={() => revealInteractionProblem(p)}>Go to connection</button>}</div>)}</div>}
  </section>;
}
