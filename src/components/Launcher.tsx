import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, Car, Clapperboard, Crosshair, FolderOpen, Gamepad2, Gauge, PersonStanding, Plus, RotateCcw, Sparkles, X } from 'lucide-react';
import { isDesktop } from '../platform';
import { useProjectStore } from '../store/projectStore';
import { clearRecovery, readRecovery } from '../store/autosave';
import { createThirdPersonTemplate } from '../project/thirdPersonTemplate';
import { createFirstPersonTemplate } from '../project/firstPersonTemplate';
import { createFilmModeTemplate } from '../project/filmModeTemplate';
import { createDrivingTemplate } from '../project/drivingTemplate';
import { createSimRacingTemplate } from '../project/simRacingTemplate';

type TemplateChoice = {
  icon: LucideIcon;
  title: string;
  blurb: string;
  build: () => Promise<unknown> | unknown;
};

/** Human-friendly "time ago" for the recovery banner. */
function formatAgo(ms: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (seconds < 60) return 'moments ago';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return new Date(ms).toLocaleString();
}

const TEMPLATES: TemplateChoice[] = [
  { icon: PersonStanding, title: 'Third-person', blurb: 'Character + camera tutorial world', build: createThirdPersonTemplate },
  { icon: Crosshair, title: 'First-person shooter', blurb: 'Neon FPS with guns & grenades', build: createFirstPersonTemplate },
  { icon: Car, title: 'Driving', blurb: 'NFS-lite neon cruise & garage', build: createDrivingTemplate },
  { icon: Gauge, title: 'Sim racing', blurb: 'Realistic car physics & laps', build: createSimRacingTemplate },
  { icon: Clapperboard, title: 'Cinematic', blurb: '"The Summit" film flythrough', build: createFilmModeTemplate },
];

export function Launcher() {
  const [name, setName] = useState('My Game');
  const newProject = useProjectStore((state) => state.newProject);
  const openProject = useProjectStore((state) => state.openProject);
  const openRecent = useProjectStore((state) => state.openRecent);
  const useDemo = useProjectStore((state) => state.useDemo);
  const recentProjects = useProjectStore((state) => state.recentProjects);
  const busy = useProjectStore((state) => state.busy);
  const error = useProjectStore((state) => state.error);
  const restoreRecovery = useProjectStore((state) => state.restoreRecovery);
  // Unsaved work from a crashed/closed session, if any (read once on mount).
  const [recovery, setRecovery] = useState(() => readRecovery());
  const createTemplateProject = async (builder: () => Promise<unknown> | unknown) => {
    try {
      await newProject(name.trim());
      if (!useProjectStore.getState().hasProject) return;
      await builder();
    } catch (error) {
      useProjectStore.setState({ error: error instanceof Error ? error.message : 'Template failed' });
    }
  };

  return (
    <div className="launcher">
      <div className="launcher-card">
        <div className="launcher-brand">
          <Gamepad2 size={26} aria-hidden />
          <div>
            <strong>Feather Engine</strong>
            <span>{isDesktop ? 'Desktop' : 'Web preview'}</span>
          </div>
        </div>

        {recovery && (
          <div className="launcher-recovery">
            <RotateCcw size={16} aria-hidden />
            <div className="launcher-recovery-text">
              <strong>Restore unsaved work?</strong>
              <small>
                “{recovery.name}” · {formatAgo(recovery.savedAt)}
              </small>
            </div>
            <button className="launcher-recovery-restore" disabled={busy} onClick={() => restoreRecovery(recovery)}>
              Restore
            </button>
            <button
              className="launcher-recovery-dismiss"
              title="Discard recovered work"
              onClick={() => {
                clearRecovery();
                setRecovery(null);
              }}
            >
              <X size={15} aria-hidden />
            </button>
          </div>
        )}

        <section className="launcher-new">
          <label className="node-field">
            <span>Project name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="My Game"
              spellCheck={false}
            />
          </label>
          <button className="launcher-primary" disabled={busy || !name.trim()} onClick={() => void newProject(name.trim())}>
            <Plus size={16} aria-hidden />
            <span>{isDesktop ? 'Create blank project…' : 'Create blank project'}</span>
          </button>
        </section>

        <section className="launcher-templates">
          <span className="eyebrow">Or start from a template</span>
          <div className="template-grid">
            {TEMPLATES.map(({ icon: Icon, title, blurb, build }) => (
              <button
                key={title}
                className="template-card"
                disabled={busy || !name.trim()}
                onClick={() => void createTemplateProject(build)}
              >
                <Icon size={20} aria-hidden />
                <strong>{title}</strong>
                <small>{blurb}</small>
              </button>
            ))}
          </div>
        </section>

        <div className="launcher-actions">
          <button disabled={busy} onClick={() => void openProject()}>
            <FolderOpen size={15} aria-hidden />
            <span>Open project{isDesktop ? '…' : ' file'}</span>
          </button>
          <button disabled={busy} onClick={useDemo}>
            <Sparkles size={15} aria-hidden />
            <span>Open demo scene</span>
          </button>
        </div>

        {isDesktop && recentProjects.length > 0 && (
          <section className="launcher-recent">
            <span className="eyebrow">Recent</span>
            {recentProjects.map((project) => (
              <button key={project.dir} disabled={busy} onClick={() => void openRecent(project.dir)} title={project.dir}>
                <strong>{project.name}</strong>
                <small>{project.dir}</small>
              </button>
            ))}
          </section>
        )}

        {error && (
          <div className="ai-error">
            <AlertTriangle size={13} aria-hidden /> {error}
          </div>
        )}

        {!isDesktop && (
          <p className="launcher-note">
            You're in the web preview — projects save as a downloadable <code>.nforge</code> file. Run the desktop
            app for real project folders and asset files on disk.
          </p>
        )}
      </div>
    </div>
  );
}
