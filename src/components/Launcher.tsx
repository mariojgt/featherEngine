import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  Eye,
  FolderOpen,
  Gamepad2,
  RotateCcw,
  Sparkles,
  X,
} from 'lucide-react';
import { getPlatform, isDesktop } from '../platform';
import { useProjectStore } from '../store/projectStore';
import { useEditorStore } from '../store/editorStore';
import { clearRecovery, readRecovery } from '../store/autosave';
import { useMarketplaceStore } from '../store/marketplaceStore';
import { formatSize, type StoreListing } from '../marketplace/catalog';
import {
  CREATOR_QUICK_STARTS,
  type CreatorQuickStart,
} from '../creator/gameTemplates';

/** The starter world shown first. Everything else keeps the catalog's order. */
const FEATURED_SLUG = 'template-spline-studio';

function formatAgo(ms: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (seconds < 60) return 'moments ago';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return new Date(ms).toLocaleString();
}

/** Let React mount the editor + persistent Agent panel before handing it the launcher prompt. */
function askAgentAfterProjectOpens(prompt: string) {
  window.requestAnimationFrame(() => {
    window.dispatchEvent(new CustomEvent('nf:ask-ai', { detail: { prompt } }));
  });
}

export function Launcher() {
  const [name, setName] = useState('My Game');
  const [description, setDescription] = useState('');
  const newProject = useProjectStore((state) => state.newProject);
  const openProject = useProjectStore((state) => state.openProject);
  const openRecent = useProjectStore((state) => state.openRecent);
  const removeRecent = useProjectStore((state) => state.removeRecent);
  const useDemo = useProjectStore((state) => state.useDemo);
  const newProjectFromPackageUrl = useProjectStore((state) => state.newProjectFromPackageUrl);
  const recentProjects = useProjectStore((state) => state.recentProjects);
  const busy = useProjectStore((state) => state.busy);
  const error = useProjectStore((state) => state.error);
  const restoreRecovery = useProjectStore((state) => state.restoreRecovery);
  const [recovery, setRecovery] = useState(() => readRecovery());

  const loadCatalog = useMarketplaceStore((state) => state.load);
  const catalogStatus = useMarketplaceStore((state) => state.status);
  const catalogError = useMarketplaceStore((state) => state.error);
  const packages = useMarketplaceStore((state) => state.packages);
  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const templates = useMemo(() => {
    const worlds = packages.filter((entry) => entry.kind === 'project');
    return worlds.sort((a, b) => Number(b.slug === FEATURED_SLUG) - Number(a.slug === FEATURED_SLUG));
  }, [packages]);

  const projectName = () => name.trim() || 'My Game';

  const createWithAI = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const prompt = description.trim();
    if (!prompt || busy) return;
    await newProject(projectName());
    if (useProjectStore.getState().hasProject) askAgentAfterProjectOpens(prompt);
  };

  const createBlankProject = async () => {
    if (busy) return;
    await newProject(projectName());
  };

  const createTemplateProject = async (listing: StoreListing) => {
    await newProjectFromPackageUrl(listing.downloadUrl, projectName());
  };

  const createQuickStart = async (quickStart: CreatorQuickStart) => {
    if (busy || quickStart.comingSoon) return;
    if (quickStart.gameplayKitId) {
      await newProject(projectName());
      if (useProjectStore.getState().hasProject) {
        useEditorStore.getState().createCreatorGameplayKit(quickStart.gameplayKitId);
      }
      return;
    }
    if (!quickStart.templateSlug) {
      await createBlankProject();
      return;
    }
    const listing = templates.find((candidate) => candidate.slug === quickStart.templateSlug);
    if (listing) await createTemplateProject(listing);
  };

  const handleReveal = async (event: React.MouseEvent, dir: string) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      const platform = await getPlatform();
      await platform.revealFile?.(dir);
    } catch {
      // Non-fatal — reveal is a convenience.
    }
  };

  const handleRemove = (event: React.MouseEvent, dir: string) => {
    event.preventDefault();
    event.stopPropagation();
    removeRecent(dir);
  };

  return (
    <div className="launcher">
      <div className="launcher-ambient" aria-hidden>
        <span />
        <span />
      </div>

      <main className="launcher-shell" aria-busy={busy}>
        <header className="launcher-header">
          <div className="launcher-brand">
            <span className="launcher-brand-mark">
              <Gamepad2 size={20} aria-hidden />
            </span>
            <div>
              <strong>Feather</strong>
              <span>Engine</span>
            </div>
          </div>
          <div className="launcher-platform">
            <span aria-hidden />
            {isDesktop ? 'Desktop workspace' : 'Web preview'}
          </div>
        </header>

        <section className="launcher-intro" aria-labelledby="launcher-title">
          <div>
            <span className="eyebrow">Create a playable world in minutes</span>
            <h1 id="launcher-title">What do you want to make?</h1>
            <p>Describe the game in plain language, choose a familiar game type, or explore one of Feather's editable starter worlds.</p>
          </div>
          <div className="launcher-intro-meta" aria-label="Available starter projects">
            <strong>{templates.length || '—'}</strong>
            <span>starter worlds</span>
          </div>
        </section>

        {recovery && (
          <div className="launcher-recovery" role="status">
            <RotateCcw size={16} aria-hidden />
            <div className="launcher-recovery-text">
              <strong>Unsaved work is available</strong>
              <small>“{recovery.name}” · {formatAgo(recovery.savedAt)}</small>
            </div>
            <button type="button" className="launcher-recovery-restore" disabled={busy} onClick={() => restoreRecovery(recovery)}>
              Restore
            </button>
            <button
              type="button"
              className="launcher-recovery-dismiss"
              title="Discard recovered work"
              aria-label="Discard recovered work"
              onClick={() => {
                clearRecovery();
                setRecovery(null);
              }}
            >
              <X size={14} aria-hidden />
            </button>
          </div>
        )}

        <div className="launcher-content launcher-content--creator">
          <aside className="launcher-create-panel launcher-create-panel--creator">
            <div className="launcher-section-heading">
              <span className="launcher-step" aria-hidden>✨</span>
              <div>
                <h2>Describe your game</h2>
                <p>The Agent will build with normal Feather objects and editable logic.</p>
              </div>
            </div>

            <form className="launcher-new launcher-new--creator" onSubmit={(event) => void createWithAI(event)}>
              <label className="sr-only" htmlFor="launcher-game-description">Describe your game</label>
              <textarea
                id="launcher-game-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="A small third-person adventure with coins, three enemies, and a door that opens when every coin is collected…"
                rows={6}
              />
              <label className="launcher-project-name" htmlFor="launcher-project-name">
                <span>Project name</span>
                <input
                  id="launcher-project-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="My Game"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <button type="submit" className="launcher-primary" disabled={busy || !description.trim()}>
                <Sparkles size={16} aria-hidden />
                <span>{busy ? 'Creating…' : 'Create with AI'}</span>
                {!busy && <ArrowRight size={15} aria-hidden />}
              </button>
            </form>

            <div className="launcher-divider"><span>or continue</span></div>

            <div className="launcher-actions">
              <button type="button" disabled={busy} onClick={() => void openProject()}>
                <FolderOpen size={15} aria-hidden />
                <span>Open project{isDesktop ? '…' : ' file'}</span>
              </button>
              <button type="button" disabled={busy} onClick={useDemo}>
                <Sparkles size={15} aria-hidden />
                <span>Explore demo</span>
              </button>
            </div>

            {isDesktop && recentProjects.length > 0 && (
              <section className="launcher-recent" aria-labelledby="recent-projects-title">
                <span id="recent-projects-title" className="eyebrow">Recent projects</span>
                <div className="launcher-recent-list">
                  {recentProjects.map((project) => (
                    <div key={project.dir} className="launcher-recent-item">
                      <button
                        type="button"
                        className="launcher-recent-main"
                        disabled={busy}
                        onClick={() => void openRecent(project.dir)}
                        title={project.dir}
                      >
                        <strong>{project.name}</strong>
                        <small>{project.dir}</small>
                      </button>
                      <div className="launcher-recent-actions">
                        <button
                          type="button"
                          className="launcher-recent-action"
                          title="Reveal in Finder"
                          aria-label={`Reveal ${project.name} in Finder`}
                          disabled={busy}
                          onClick={(event) => void handleReveal(event, project.dir)}
                        >
                          <Eye size={14} aria-hidden />
                        </button>
                        <button
                          type="button"
                          className="launcher-recent-action"
                          title="Remove from recent"
                          aria-label={`Remove ${project.name} from recent projects`}
                          disabled={busy}
                          onClick={(event) => handleRemove(event, project.dir)}
                        >
                          <X size={14} aria-hidden />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {error && <div className="ai-error" role="alert"><AlertTriangle size={14} aria-hidden /> {error}</div>}

            {!isDesktop && (
              <p className="launcher-note">
                Web projects save as a downloadable <code>.nforge</code> file. Use the desktop app for project folders and assets stored directly on disk.
              </p>
            )}
          </aside>

          <section className="launcher-templates launcher-templates--creator" aria-labelledby="quick-start-title">
            <div className="launcher-section-heading launcher-section-heading--templates">
              <span className="launcher-step" aria-hidden>01</span>
              <div>
                <h2 id="quick-start-title">Quick start</h2>
                <p>Choose the kind of game you want to make, not an engine package.</p>
              </div>
              <span className="launcher-template-count">5 game types</span>
            </div>

            <div className="launcher-quick-grid">
              {CREATOR_QUICK_STARTS.map((quickStart) => {
                const available = Boolean(quickStart.gameplayKitId) || !quickStart.templateSlug || templates.some((entry) => entry.slug === quickStart.templateSlug);
                return (
                  <button
                    type="button"
                    key={quickStart.id}
                    className="launcher-quick-card"
                    data-quick-start={quickStart.id}
                    disabled={busy || quickStart.comingSoon || !available}
                    onClick={() => void createQuickStart(quickStart)}
                  >
                    <span className="launcher-quick-icon" aria-hidden>{quickStart.icon}</span>
                    <span>
                      <strong>{quickStart.label}</strong>
                      <small>{quickStart.description}</small>
                    </span>
                    {quickStart.comingSoon ? <em>Coming soon</em> : <ArrowRight size={15} aria-hidden />}
                  </button>
                );
              })}
            </div>

            <div className="launcher-starter-heading">
              <div>
                <h2 id="starter-worlds-title">Starter worlds</h2>
                <p>Playable scenes you can inspect, remix, and make your own.</p>
              </div>
              <span className="launcher-template-count">
                {catalogStatus === 'ready' ? `${templates.length} worlds` : '…'}
              </span>
            </div>

            {catalogStatus === 'loading' && <p className="launcher-template-hint">Loading starter worlds…</p>}
            {catalogStatus === 'error' && (
              <p className="launcher-template-hint">Could not load starter worlds ({catalogError}). Blank is still available.</p>
            )}

            <div className="template-grid">
              {templates.map((listing, index) => (
                <button
                  type="button"
                  key={listing.id}
                  className={`template-card ${index === 0 ? 'template-card--featured' : ''}`}
                  disabled={busy}
                  aria-label={`Create ${projectName()} from the ${listing.title} template`}
                  onClick={() => void createTemplateProject(listing)}
                >
                  <span className="template-card-icon">
                    {listing.thumbnail ? <img src={listing.thumbnail} alt="" width={20} height={20} /> : <Boxes size={20} aria-hidden />}
                  </span>
                  <span className="template-card-copy">
                    {index === 0 && <span className="template-card-kicker">Recommended</span>}
                    <strong>{listing.title}</strong>
                    <small>{listing.description}</small>
                    <span className="template-card-meta">{formatSize(listing.sizeBytes)}</span>
                  </span>
                  <ArrowRight className="template-card-arrow" size={16} aria-hidden />
                </button>
              ))}
            </div>
          </section>
        </div>

        <footer className="launcher-footer">
          <span>Local-first workspace</span><span aria-hidden>•</span><span>No account required</span><span aria-hidden>•</span><span>Your work stays yours</span>
        </footer>
      </main>
    </div>
  );
}
