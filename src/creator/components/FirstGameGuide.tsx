import { hasAppearanceChanged, hasAppearanceBaseline } from '../firstGameGuide';
import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Check, ChevronDown, X } from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';
import { useProjectStore } from '../../store/projectStore';
import { focusWorkspacePanel } from '../../components/workspacePanels';
import { FIRST_GAME_STEPS, useFirstGameGuide, type FirstGameStep } from '../firstGameGuide';

const lessons: Record<FirstGameStep, { title: string; text: string; action: string }> = {
  appearance: { title: 'Make it yours', text: 'Select a visible object, then change its color or material under Appearance. Its gameplay stays attached.', action: 'Find an object' },
  interaction: { title: 'Add a rule', text: 'Select a door or prop. Under Interactions, choose when something happens and what it should do.', action: 'Show interactions' },
  play: { title: 'Try your game', text: 'Press Play to try movement and your new rule. Press Escape to return to editing. Preview changes are restored when you stop.', action: 'Play' },
  save: { title: 'Keep your work', text: 'Save your project before sharing it. In the web editor, keep the downloaded .nforge file so you can open it again.', action: 'Save project' },
  export: { title: 'Share your game', text: 'Open Production Export to check the project and choose a platform. After building, test the output outside the editor.', action: 'Check export' },
};

export function FirstGameGuide() {
  const projectName = useProjectStore((s) => s.projectName);
  const projectDir = useProjectStore((s) => s.projectDir);
  const busy = useProjectStore((s) => s.busy);
  const pendingExport = useProjectStore((s) => s.pendingExport);
  const scenes = useEditorStore((s) => s.isPlaying ? null : s.scenes);
  const firstSceneId = useEditorStore((s) => s.scenes[0]?.id);
  const materials = useEditorStore((s) => s.materials);
  const playing = useEditorStore((s) => s.isPlaying);
  const toast = useProjectStore((s) => s.toast);
  const key = `${projectDir ?? 'unsaved'}:${projectName}:${firstSceneId ?? ''}`;
  const progress = useFirstGameGuide((s) => s.projects[key]);
  const [selected, setSelected] = useState<FirstGameStep | null>(null);
  const appearance = useMemo(() => JSON.stringify({
    objects: scenes?.flatMap((scene) => scene.objects).filter((object) => object.renderer).map((object) => [object.id, object.renderer]),
    materials,
  }), [scenes, materials]);
  const interactions = useMemo(() => scenes?.flatMap((scene) => scene.objects).reduce((n, object) => n + (object.creatorInteractions?.length ?? 0), 0) ?? 0, [scenes]);

  useEffect(() => {
    if (busy || playing) return;
    const frame = requestAnimationFrame(() => useFirstGameGuide.getState().start(key, appearance, interactions));
    return () => cancelAnimationFrame(frame);
  }, [key, busy, playing, appearance, interactions]);
  useEffect(() => {
    if (!progress || busy) return;
    const guide = useFirstGameGuide.getState();
    if (playing) guide.complete(key, 'play');
    if (!playing && hasAppearanceBaseline(progress.appearance, appearance)) {
      if (hasAppearanceChanged(progress.appearance, appearance)) guide.complete(key, 'appearance');
      if (interactions > progress.interactions) guide.complete(key, 'interaction');
    }
    if (toast?.kind === 'success' && ['Project saved', 'Project downloaded'].includes(toast.message)) guide.complete(key, 'save');
    if (pendingExport?.mode === 'production') guide.complete(key, 'export');
  }, [key, progress, appearance, interactions, playing, pendingExport, busy, toast]);
  useEffect(() => setSelected(null), [key]);

  if (!progress || playing) return null;
  const current = selected ?? FIRST_GAME_STEPS.find((step) => !progress.completed.includes(step)) ?? 'export';
  const lesson = lessons[current];
  const act = async () => {
    const editor = useEditorStore.getState();
    const project = useProjectStore.getState();
    if (current === 'play') { editor.setPlaying(true); return; }
    if (current === 'save') {
      await project.save();
      if (!useProjectStore.getState().error && !useEditorStore.getState().isDirty && useProjectStore.getState().projectDir) {
        useFirstGameGuide.getState().complete(key, 'save');
      }
      return;
    }
    if (current === 'export') { await project.exportProduction(); return; }
    const objects = editor.activeScene()?.objects ?? [];
    const object = current === 'interaction'
      ? objects.find((item) => item.creatorRoleId === 'door') ?? objects.find((item) => item.creatorRoleId === 'collectible') ?? objects.find((item) => item.renderer && !item.character)
      : objects.find((item) => item.creatorRoleId === 'collectible') ?? objects.find((item) => item.renderer);
    if (object) editor.selectObject(object.id);
    focusWorkspacePanel('inspector');
  };

  return (
    <section className={`first-game-guide${progress.dismissed ? ' collapsed' : ''}`} aria-label="Your first game">
      <div className="first-game-heading">
        <button type="button" className="first-game-toggle" aria-expanded={!progress.dismissed} onClick={() => useFirstGameGuide.getState().dismiss(key, !progress.dismissed)}>
          <BookOpen size={15} aria-hidden /><strong>Your first game</strong>
          <span>{progress.completed.length}/{FIRST_GAME_STEPS.length}</span><ChevronDown size={14} aria-hidden />
        </button>
        {!progress.dismissed && <button type="button" className="icon-button" aria-label="Minimize first game guide" onClick={() => useFirstGameGuide.getState().dismiss(key, true)}><X size={14} /></button>}
      </div>
      {!progress.dismissed && <div className="first-game-content">
        <ol className="first-game-steps">
          {FIRST_GAME_STEPS.map((step, index) => <li key={step}><button type="button" aria-current={step === current ? 'step' : undefined} onClick={() => setSelected(step)}>
            <span>{progress.completed.includes(step) ? <Check size={12} aria-label="Completed" /> : index + 1}</span>{lessons[step].title}
          </button></li>)}
        </ol>
        <div className="first-game-lesson"><p>{lesson.text}</p><button type="button" className="primary-button" disabled={busy} onClick={() => void act()}>{lesson.action}</button></div>
      </div>}
    </section>
  );
}
