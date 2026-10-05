import './Launcher.css';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  Eye,
  FolderOpen,
  Gamepad2,
  Plus,
  PackageOpen,
  Search,
  ChevronDown,
  Clock3,
  RotateCcw,
  Sparkles,
  X,
} from 'lucide-react';
import { getPlatform, isDesktop } from '../platform';
import { useProjectStore } from '../store/projectStore';
import { useEditorStore } from '../store/editorStore';
import { clearRecovery, readRecovery, subscribeRecoveryStatus, getRecoveryStatus } from '../store/autosave';
import { useMarketplaceStore } from '../store/marketplaceStore';
import { formatSize, matchesQuery, type StoreListing } from '../marketplace/catalog';
import { CREATOR_QUICK_STARTS, isLauncherStarterVisible, type CreatorQuickStart } from '../creator/gameTemplates';

/** The starter world shown first. Everything else keeps the catalog's order. */
const FEATURED_SLUG = 'template-verdant';
const INITIAL_WORLD_COUNT = 4;

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
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const newProject = useProjectStore((state) => state.newProject);
  const openProject = useProjectStore((state) => state.openProject);
  const openTemplateFile = useProjectStore((state) => state.newProjectFromPackageFile);
  const openRecent = useProjectStore((state) => state.openRecent);
  const removeRecent = useProjectStore((state) => state.removeRecent);
  const useDemo = useProjectStore((state) => state.useDemo);
  const newProjectFromPackageUrl = useProjectStore((state) => state.newProjectFromPackageUrl);
  const recentProjects = useProjectStore((state) => state.recentProjects);
  const busy = useProjectStore((state) => state.busy);
  const error = useProjectStore((state) => state.error);
  const restoreRecovery = useProjectStore((state) => state.restoreRecovery);
  const recoveryStatus = useSyncExternalStore(subscribeRecoveryStatus, getRecoveryStatus, getRecoveryStatus);
  const [recovery, setRecovery] = useState<Awaited<ReturnType<typeof readRecovery>>>(null);
  useEffect(() => {
    let current = true;
    void readRecovery().then((snapshot) => { if (current) setRecovery(snapshot); });
    return () => { current = false; };
  }, []);

  const loadCatalog = useMarketplaceStore((state) => state.load);
  const catalogStatus = useMarketplaceStore((state) => state.status);
  const catalogError = useMarketplaceStore((state) => state.error);
  const packages = useMarketplaceStore((state) => state.packages);
  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const templates = useMemo(() => {
    const worlds = packages.filter(
      (entry) => entry.kind === 'project' && isLauncherStarterVisible(entry.slug),
    );
    return worlds.sort((a, b) => Number(b.slug === FEATURED_SLUG) - Number(a.slug === FEATURED_SLUG));
  }, [packages]);

  // A quick start and its catalog package are one choice, with one creation route.
  const offlineStarts = CREATOR_QUICK_STARTS.filter((entry) => entry.builtInTemplate || !entry.templateSlug);
  const library = templates.filter(
    (entry) => !offlineStarts.some((start) => start.templateSlug === entry.slug),
  );
  const filteredWorlds = library.filter((entry) => {
    const quickStart = CREATOR_QUICK_STARTS.find((start) => start.templateSlug === entry.slug);
    return (
      matchesQuery(entry, query) ||
      Boolean(query.trim() && quickStart?.label.toLowerCase().includes(query.trim().toLowerCase()))
    );
  });
  const visibleWorlds =
    query.trim() || showAll ? filteredWorlds : filteredWorlds.slice(0, INITIAL_WORLD_COUNT);
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
    if (busy) return;
    await newProjectFromPackageUrl(listing.downloadUrl, projectName());
  };

  const createQuickStart = async (quickStart: CreatorQuickStart) => {
    if (busy || quickStart.comingSoon) return;
    if (quickStart.builtInTemplate) {
      await useProjectStore.getState().newProjectFromStarter(projectName(), quickStart.builtInTemplate);
      return;
    }
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
    <div className="launcher launcher-hub">
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
            {isDesktop ? 'Desktop workspace' : 'Web workspace'}
          </div>
        </header>

        <div className="hub-layout">
          <aside className="hub-sidebar" aria-label="Your projects">
            <div className="hub-sidebar-actions">
              <a className="hub-new-link" href="#new-project">
                <Plus size={16} aria-hidden />
                New project
              </a>
              <button className="hub-open" type="button" disabled={busy} onClick={() => void openProject()}>
                <FolderOpen size={16} aria-hidden />
                Open project{isDesktop ? '…' : ' file'}
              </button>
              <button className="hub-open" type="button" data-open-template-file disabled={busy} onClick={() => void openTemplateFile(projectName())}>
                <PackageOpen size={16} aria-hidden />
                Open template file
              </button>
            </div>
            <section className="hub-recent" aria-labelledby="recent-projects-title">
              <h2 id="recent-projects-title">
                <Clock3 size={14} aria-hidden />
                Recent projects
              </h2>
              {isDesktop && recentProjects.length > 0 ? (
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
                          title="Show in folder"
                          aria-label={`Show ${project.name} in folder`}
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
              ) : (
                <p className="hub-empty-recent">
                  {isDesktop
                    ? 'Your projects will appear here. Start something new or open a project folder.'
                    : 'Continue a saved project by opening its .nforge file.'}
                </p>
              )}
            </section>
            <button className="hub-demo" type="button" disabled={busy} onClick={useDemo}>
              <Sparkles size={14} aria-hidden />
              Explore demo
              <ArrowRight size={14} aria-hidden />
            </button>
            <p className="hub-storage-note">
              {isDesktop ? 'Projects saved on your device.' : 'Save your work as a project file.'}
            </p>
          </aside>

          <div className="hub-main">
            <section className="hub-welcome" aria-labelledby="launcher-title">
              <span className="hub-eyebrow">Your next world starts here</span>
              <h1 id="launcher-title">Let's make something.</h1>
              <p>Start fresh, pick a world, or bring an idea to life.</p>
            </section>

            {recovery && (
              <div className="launcher-recovery" role="status">
                <RotateCcw size={16} aria-hidden />
                <div className="launcher-recovery-text">
                  <strong>Unsaved work is available</strong>
                  <small>
                    “{recovery.name}” · {formatAgo(recovery.savedAt)}
                  </small>
                </div>
                <button
                  type="button"
                  className="launcher-recovery-restore"
                  disabled={busy}
                  onClick={() => restoreRecovery(recovery)}
                >
                  Restore
                </button>
                <button
                  type="button"
                  className="launcher-recovery-dismiss"
                  title="Discard recovered work"
                  aria-label="Discard recovered work"
                  disabled={busy}
                  onClick={() => {
                    clearRecovery();
                    setRecovery(null);
                  }}
                >
                  <X size={14} aria-hidden />
                </button>
              </div>
            )}
            {error && (
              <div className="hub-error" role="alert">
                <AlertTriangle size={16} aria-hidden />
                <span>{error}</span>
              </div>
            )}
            {recoveryStatus.state === 'unavailable' && (
              <div className="hub-error" role="alert">
                <AlertTriangle size={16} aria-hidden />
                <span>Recovery unavailable: {recoveryStatus.reason}</span>
              </div>
            )}
            {busy && (
              <div className="hub-busy" role="status">
                Opening your workspace…
              </div>
            )}

            <section className="hub-create" id="new-project" aria-labelledby="new-project-title">
              <div className="hub-create-heading">
                <h2 id="new-project-title">New project</h2>
                <label className="launcher-project-name" htmlFor="launcher-project-name">
                  <span>Project name</span>
                  <input
                    id="launcher-project-name"
                    value={name}
                    disabled={busy}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="My Game"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
              </div>
              <div className="hub-basics">
                {[...offlineStarts].sort((a, b) => Number(b.id === 'cube-rpg') - Number(a.id === 'cube-rpg')).map((quickStart) => (
                  <button
                    type="button"
                    key={quickStart.id}
                    className="launcher-quick-card hub-basic"
                    data-quick-start={quickStart.id}
                    data-template-slug={quickStart.templateSlug}
                    disabled={busy || quickStart.comingSoon}
                    onClick={() => void createQuickStart(quickStart)}
                  >
                    <span className="hub-basic-icon">
                      {quickStart.builtInTemplate ? (
                        <Gamepad2 size={21} aria-hidden />
                      ) : (
                        <Plus size={21} aria-hidden />
                      )}
                    </span>
                    <span>
                      <strong>{quickStart.label}</strong>
                      <small>
                        {quickStart.builtInTemplate
                          ? `${quickStart.projectTitle ?? quickStart.label} · Playable, included offline`
                          : 'A fresh scene. Make it your own.'}
                      </small>
                    </span>
                    <ArrowRight size={16} aria-hidden />
                  </button>
                ))}
              </div>
              <details className="hub-ai">
                <summary>
                  <Sparkles size={15} aria-hidden />
                  <span>
                    Have an idea? <strong>Create with AI</strong>
                  </span>
                  <ChevronDown size={15} aria-hidden />
                </summary>
                <form className="launcher-new hub-ai-form" onSubmit={(event) => void createWithAI(event)}>
                  <label htmlFor="launcher-game-description">Describe your game</label>
                  <textarea
                    id="launcher-game-description"
                    value={description}
                    disabled={busy}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="A small third-person adventure with coins, three enemies, and a door that opens when every coin is collected…"
                    rows={3}
                  />
                  <div className="hub-ai-bottom">
                    <p>Start a project, then shape it with the Agent.</p>
                    <button type="submit" className="launcher-primary" disabled={busy || !description.trim()}>
                      <Sparkles size={15} aria-hidden />
                      <span>{busy ? 'Creating…' : 'Create with AI'}</span>
                      <ArrowRight size={15} aria-hidden />
                    </button>
                  </div>
                </form>
              </details>
            </section>

            <section className="hub-library" aria-labelledby="starter-worlds-title">
              <div className="hub-library-heading">
                <div>
                  <h2 id="starter-worlds-title">Starter worlds</h2>
                  <p>A head start, with room to make it yours.</p>
                </div>
                <div className="hub-library-tools">
                  <div className="hub-search">
                    <Search size={16} aria-hidden />
                    <input
                      type="search"
                      aria-label="Search starter worlds"
                      placeholder="Search worlds…"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                    {query && (
                      <button type="button" aria-label="Clear search" onClick={() => setQuery('')}>
                        <X size={14} aria-hidden />
                      </button>
                    )}
                  </div>
                  {!query.trim() && library.length > INITIAL_WORLD_COUNT && (
                    <button
                      type="button"
                      className="hub-library-toggle"
                      aria-expanded={showAll}
                      onClick={() => setShowAll(!showAll)}
                    >
                      {showAll ? 'Show fewer worlds' : `View all ${library.length} worlds`}
                      <ChevronDown size={14} aria-hidden />
                    </button>
                  )}
                </div>
              </div>
              {(catalogStatus === 'loading' || catalogStatus === 'idle') && (
                <p className="hub-catalog-message" role="status">
                  Loading starter worlds…
                </p>
              )}
              {catalogStatus === 'error' && (
                <div className="hub-catalog-message hub-catalog-error" role="alert">
                  <div>
                    <strong>Starter worlds couldn't load.</strong>
                    <p>Blank, Platformer, Cube RPG, Parcel Panic, Lumen Lane and Crystal Slice are ready to use offline.</p>
                    <details>
                      <summary>Error details</summary>
                      <p>{catalogError}</p>
                    </details>
                  </div>
                  <button type="button" disabled={busy} onClick={() => void loadCatalog(true)}>
                    Retry starter catalog
                  </button>
                </div>
              )}
              {catalogStatus === 'ready' && filteredWorlds.length === 0 && (
                <div className="hub-catalog-message" role="status">
                  {query.trim() ? (
                    <>
                      No worlds match “{query}”.{' '}
                      <button type="button" onClick={() => setQuery('')}>
                        Clear search
                      </button>
                    </>
                  ) : (
                    'More starter worlds will appear here. Blank, Platformer, Cube RPG, Parcel Panic, Lumen Lane and Crystal Slice are ready above.'
                  )}
                </div>
              )}
              <div className="hub-world-grid">
                {visibleWorlds.map((listing) => {
                  const featured = listing.slug === FEATURED_SLUG && !query.trim();
                  const quickStart = CREATOR_QUICK_STARTS.find(
                    (start) => start.templateSlug === listing.slug,
                  );
                  return (
                    <button
                      type="button"
                      key={listing.id}
                      className={`hub-world${featured ? ' hub-world--featured' : ''}`}
                      data-template-slug={listing.slug}
                      data-quick-start={quickStart?.id}
                      disabled={busy}
                      aria-label={`Create ${projectName()} from the ${listing.title} template`}
                      onClick={() =>
                        void (quickStart ? createQuickStart(quickStart) : createTemplateProject(listing))
                      }
                    >
                      <span className="hub-world-image">
                        {listing.thumbnail ? (
                          <img src={listing.thumbnail} alt="" loading="lazy" />
                        ) : (
                          <Boxes size={32} aria-hidden />
                        )}
                      </span>
                      <span className="hub-world-copy">
                        {featured && <span className="hub-eyebrow">Featured world · Cinematic</span>}
                        <strong>{listing.title}</strong>
                        <span className="hub-world-description">
                          {featured
                            ? 'Step into a sunlit woodland. Explore an editable cinematic with living trees, drifting mist, and an original score.'
                            : quickStart?.description || listing.description}
                        </span>
                        <span className="hub-world-meta">
                          {featured
                            ? 'Explore Verdant'
                            : quickStart?.label ||
                              listing.tags.find((tag) => tag !== 'template' && tag !== 'project') ||
                              'Editable world'}
                          <span>
                            {formatSize(listing.sizeBytes)}
                            <ArrowRight size={14} aria-hidden />
                          </span>
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
              {catalogStatus === 'ready' && filteredWorlds.length > 0 && (
                <div className="hub-library-footer">
                  <span aria-live="polite">
                    {query.trim()
                      ? `${filteredWorlds.length} matching world${filteredWorlds.length === 1 ? '' : 's'}`
                      : `${visibleWorlds.length} of ${library.length} worlds · plus Blank, Platformer, Parcel Panic, Lumen Lane & Crystal Slice above`}
                  </span>
                </div>
              )}
            </section>
          </div>
        </div>
        <footer className="launcher-footer">
          <span>Made for making.</span>
          <span>No account required · Your work stays yours</span>
        </footer>
      </main>
    </div>
  );
}
