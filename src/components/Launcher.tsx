import { useState } from 'react';
import { AlertTriangle, Crosshair, FolderOpen, Gamepad2, PersonStanding, Plus, Sparkles } from 'lucide-react';
import { isDesktop } from '../platform';
import { useProjectStore } from '../store/projectStore';
import { createThirdPersonTemplate } from '../project/thirdPersonTemplate';
import { createFirstPersonTemplate } from '../project/firstPersonTemplate';

export function Launcher() {
  const [name, setName] = useState('My Game');
  const newProject = useProjectStore((state) => state.newProject);
  const openProject = useProjectStore((state) => state.openProject);
  const openRecent = useProjectStore((state) => state.openRecent);
  const useDemo = useProjectStore((state) => state.useDemo);
  const recentProjects = useProjectStore((state) => state.recentProjects);
  const busy = useProjectStore((state) => state.busy);
  const error = useProjectStore((state) => state.error);
  const createTemplateProject = async (builder: () => Promise<unknown>) => {
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

        <section className="launcher-new">
          <label className="node-field">
            <span>New project name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="My Game"
              spellCheck={false}
            />
          </label>
          <button className="launcher-primary" disabled={busy || !name.trim()} onClick={() => void newProject(name.trim())}>
            <Plus size={16} aria-hidden />
            <span>{isDesktop ? 'Create project…' : 'New project'}</span>
          </button>
        </section>

        <button
          className="launcher-primary template-button"
          disabled={busy || !name.trim()}
          onClick={() => void createTemplateProject(createThirdPersonTemplate)}
        >
          <PersonStanding size={16} aria-hidden />
          <span>New third-person template</span>
        </button>

        <button
          className="launcher-primary template-button"
          disabled={busy || !name.trim()}
          onClick={() => void createTemplateProject(createFirstPersonTemplate)}
        >
          <Crosshair size={16} aria-hidden />
          <span>New FPS template</span>
        </button>

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
