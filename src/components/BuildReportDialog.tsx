import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  Apple,
  ClipboardCheck,
  Cloud,
  Globe,
  Monitor,
  OctagonX,
  Scissors,
  Smartphone,
  X,
} from 'lucide-react';
import { useProjectStore } from '../store/projectStore';
import { isDesktop as runningInDesktopShell } from '../platform';
import type { ExportPlatformInfo, ExportPlatformsReport } from '../platform/types';
import type { ExportProfile, ExportTargetId } from '../types';
import { validateExportProfile } from '../project/exportProfiles';

/** Single asset above this size gets flagged in the breakdown — it dominates load time. */
const LARGE_ASSET_BYTES = 8 * 1024 * 1024;

/** Remembers the "Strip unused assets" choice across sessions. */
const STRIP_PREF_KEY = 'nodeforge.export.stripUnused';

const STAGED_PLATFORMS: ExportPlatformsReport = {
  host: 'web',
  hostLabel: 'Staged build',
  platforms: [
    { id: 'web', label: 'Web', kind: 'web', status: 'ready', requirements: [] },
    { id: 'windows', label: 'Windows', kind: 'desktop', status: 'ci', requirements: [] },
    { id: 'macos', label: 'macOS', kind: 'desktop', status: 'ci', requirements: [] },
    { id: 'linux', label: 'Linux', kind: 'desktop', status: 'ci', requirements: [] },
    { id: 'android', label: 'Android', kind: 'mobile', status: 'ci', requirements: [] },
    { id: 'ios', label: 'iOS', kind: 'mobile', status: 'ci', requirements: [] },
  ],
};

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function platformIcon(info: ExportPlatformInfo) {
  if (info.id === 'web') return <Globe size={14} aria-hidden />;
  if (info.id === 'ios') return <Apple size={14} aria-hidden />;
  if (info.kind === 'mobile') return <Smartphone size={14} aria-hidden />;
  return <Monitor size={14} aria-hidden />;
}

/**
 * Per-platform rows for a Production export: what this machine can build right now (checkbox),
 * what belongs on CI (cloud hint), and exactly what's missing otherwise (first unmet requirement).
 */
function PlatformPicker({
  selected,
  onToggle,
  platforms,
  staged,
  error,
  onRetry,
}: {
  selected: Set<ExportTargetId>;
  onToggle: (target: ExportTargetId) => void;
  platforms: ExportPlatformsReport | null;
  staged: boolean;
  error?: string | null;
  onRetry: () => void;
}) {
  if (!platforms) {
    return (
      <section className="report-section">
        <h3>Platforms</h3>
        {error ? (
          <div className="report-platform-loading">
            Platform check failed: {error}{' '}
            <button type="button" className="prefs-link-button" onClick={onRetry}>Retry</button>
          </div>
        ) : (
          <div className="report-platform-loading">Checking local compilers and SDKs…</div>
        )}
      </section>
    );
  }

  return (
    <section className="report-section">
      <h3>Platforms</h3>
      <ul className="report-platforms">
        {platforms.platforms.map((info) => {
          const target = info.id;
          const buildable = staged || info.status !== 'missing';
          const checked = selected.has(target);
          const firstMissing = info.requirements.find((req) => !req.ok);
          return (
            <li key={info.id} className={`report-platform ${info.status}`}>
              <label className="report-platform-main">
                <input
                  type="checkbox"
                  checked={checked}
                  // A profile opened on another OS may contain unavailable targets. It must still
                  // be possible to uncheck those targets instead of trapping the dialog.
                  disabled={!buildable && !checked}
                  onChange={() => onToggle(target)}
                />
                {platformIcon(info)}
                <span className="report-platform-label">{info.label}</span>
                {staged && target !== 'web' && <span className="report-flag">package on target OS</span>}
                {staged && target === 'web' && <span className="report-flag ok">portable build</span>}
                {!staged && info.status === 'ready' && <span className="report-flag ok">ready locally</span>}
                {!staged && info.status === 'ci' && (
                  <span className="report-flag" title={info.notes}>
                    <Cloud size={11} aria-hidden /> stage for CI
                  </span>
                )}
                {!staged && info.status === 'missing' && (
                  <span className="report-flag warn" title={info.notes}>
                    setup needed
                  </span>
                )}
                {!staged && info.status === 'unsupported' && <span className="report-flag">stage for a Mac</span>}
              </label>
              {!staged && info.status === 'missing' && firstMissing && (
                <div className="report-platform-hint">
                  {firstMissing.label}
                  {firstMissing.fix ? ` — ${firstMissing.fix}` : ''}
                  {' · run `npm run doctor` for the full checklist'}
                </div>
              )}
              {!staged && info.status === 'ci' && (
                <div className="report-platform-hint">
                  One click away on GitHub: Actions → “Export Desktop Installers”.
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Pre-export "Build Report": what's in the bundle, how big each asset is, what's broken and
 * what will be stripped — shown before any file dialog so the user can trust what ships.
 * Opens whenever `pendingExport` is set (both the Export and Production buttons).
 */
export function BuildReportDialog() {
  const pending = useProjectStore((state) => state.pendingExport);
  const cancel = useProjectStore((state) => state.cancelPendingExport);
  const confirm = useProjectStore((state) => state.confirmPendingExport);
  const loadExportPlatforms = useProjectStore((state) => state.loadExportPlatforms);
  const platforms = useProjectStore((state) => state.exportPlatforms);
  const platformsError = useProjectStore((state) => state.exportPlatformsError);
  const [stripUnused, setStripUnused] = useState(() => localStorage.getItem(STRIP_PREF_KEY) !== '0');
  const [step, setStep] = useState<'platform' | 'check'>('platform');
  const [profile, setProfile] = useState<ExportProfile | null>(null);

  const isProduction = pending?.mode === 'production';

  useEffect(() => {
    if (!pending) return;
    setStep('platform');
    setProfile(structuredClone(pending.bundle.buildProfile));
    if (isProduction) void loadExportPlatforms();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, isProduction, cancel, loadExportPlatforms]);

  const toggleTarget = (target: ExportTargetId) => {
    setProfile((current) => {
      if (!current) return current;
      const targets = new Set(current.targets);
      if (targets.has(target)) targets.delete(target);
      else targets.add(target);
      return { ...current, targets: [...targets] };
    });
  };

  const report = useMemo(() => {
    if (!pending) return null;
    if (!isProduction || !profile) return pending.report;
    // Content/resource findings are immutable for this dialog. Remove only the errors produced by
    // the original profile so a user can repair bad metadata live without rescanning a large game
    // bundle on every keystroke; current profile errors are computed separately below.
    const originalProfileErrors = new Set(
      validateExportProfile(
        pending.bundle.buildProfile,
        pending.bundle.project.scenes.map((scene) => scene.id),
      ),
    );
    return {
      ...pending.report,
      errors: pending.report.errors.filter((error) => !originalProfileErrors.has(error)),
    };
  }, [pending, isProduction, profile]);
  const stripped = useMemo(
    () => (report && !report.scanFailed ? report.assets.filter((asset) => !asset.referenced) : []),
    [report],
  );
  const strippedBytes = stripped.reduce((total, asset) => total + asset.bytes, 0);
  const willStrip = stripUnused && !(report?.scanFailed ?? false) && stripped.length > 0;

  const setStrip = (value: boolean) => {
    setStripUnused(value);
    localStorage.setItem(STRIP_PREF_KEY, value ? '1' : '0');
  };

  const hasErrors = (report?.errors.length ?? 0) > 0;
  const hasWarnings = (report?.warnings.length ?? 0) > 0;
  const profileErrors =
    isProduction && profile && pending
      ? validateExportProfile(profile, pending.bundle.project.scenes.map((scene) => scene.id))
      : [];
  const selectedUnavailable =
    isProduction && runningInDesktopShell && profile && platforms
      ? profile.targets.filter((target) => {
          const platform = platforms.platforms.find((entry) => entry.id === target);
          return !platform || platform.status === 'missing';
        })
      : [];

  // Portal to <body> so the modal escapes the toolbar's `backdrop-filter` containing block
  // (otherwise `position: fixed` resolves against the 58px toolbar and gets clipped).
  return createPortal(
    <AnimatePresence>
      {pending && report && (
        <motion.div
          className="prefs-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) cancel();
          }}
        >
          <motion.div
            className="prefs-card report-card"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.16 }}
            role="dialog"
            aria-modal="true"
            aria-label="Build report"
          >
            <header className="prefs-header">
              <ClipboardCheck size={16} aria-hidden />
              <strong>Build Report — {pending.mode === 'production' ? 'Production' : 'Export'}</strong>
              <div className="prefs-spacer" />
              <button className="prefs-close" onClick={cancel} title="Close (Esc)">
                <X size={14} aria-hidden />
              </button>
            </header>

            {isProduction && <ol className="build-steps" aria-label="Build steps">
              <li aria-current={step === 'platform' ? 'step' : undefined}>1 Choose platform</li>
              <li aria-current={step === 'check' ? 'step' : undefined}>2 Check project</li>
              <li>3 Build</li><li>4 Test output</li>
            </ol>}
            <div className="report-body">
              {isProduction && profile && step === 'platform' && <>
                <p>Start with Web to share a playable game in a browser. Your chosen profile is saved with the project.</p>
                <div className="report-profile-grid">
                  <label><span>Game name</span><input value={profile.application.productName} onChange={(event) => setProfile({ ...profile, application: { ...profile.application, productName: event.target.value }, window: { ...profile.window, title: profile.window.title === profile.application.productName ? event.target.value : profile.window.title } })} /></label>
                  <label><span>First scene</span><select value={profile.startSceneId} onChange={(event) => setProfile({ ...profile, startSceneId: event.target.value })}>{pending.bundle.project.scenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.name}</option>)}</select></label>
                </div>
                <PlatformPicker selected={new Set(profile.targets)} onToggle={toggleTarget} platforms={platforms ?? (runningInDesktopShell ? null : STAGED_PLATFORMS)} staged={!runningInDesktopShell} error={platformsError} onRetry={() => void loadExportPlatforms()} />
                {!runningInDesktopShell && <p>The browser editor downloads a build package. Run its build command from the engine folder to create the playable output.</p>}
              </>}
              {isProduction && step === 'check' && <section className="report-section">
                <h3>{hasErrors || profileErrors.length ? 'Resolve the errors below' : 'Project checks passed'}</h3>
                <p>{profile?.application.productName} · {profile?.targets.join(', ')} · {profile?.configuration}</p>
                <p>{hasWarnings ? 'Review the warnings before continuing.' : 'Required content and logic references were checked.'} Test the finished game before sharing it.</p>
                <details><summary>What to test in the output</summary><p>Open the game through a local web server. Check Start, movement, sound, pause, win, restart, and saved progress. For a website, test both the site root and your game’s subfolder.</p></details>
              </section>}
              <div className="report-total" hidden={isProduction && step !== 'check'}>
                <strong>{humanSize(report.totalBytes)}</strong>
                <span>
                  total bundle{willStrip ? ` · ≈${humanSize(Math.max(0, report.totalBytes - strippedBytes))} after stripping` : ''}
                </span>
              </div>

              <section className="report-section" hidden={isProduction && step !== 'check'}>
                <h3>Contents</h3>
                <ul className="report-summary">
                  {report.summary.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </section>

              {isProduction && profile && step === 'platform' && (
                <details className="report-section" open={profileErrors.length > 0 ? true : undefined}>
                  <summary>Advanced settings · identity, version, window</summary>
                  <div className="report-profile-grid">
                    <label>
                      <span>Product name</span>
                      <input
                        value={profile.application.productName}
                        onChange={(event) => {
                          const productName = event.target.value;
                          setProfile({
                            ...profile,
                            application: { ...profile.application, productName },
                            window: {
                              ...profile.window,
                              title: profile.window.title === profile.application.productName
                                ? productName
                                : profile.window.title,
                            },
                          });
                        }}
                      />
                    </label>
                    <label>
                      <span>Application identifier</span>
                      <input
                        value={profile.application.identifier}
                        spellCheck={false}
                        onChange={(event) =>
                          setProfile({
                            ...profile,
                            application: { ...profile.application, identifier: event.target.value },
                          })
                        }
                      />
                    </label>
                    <label>
                      <span>Version</span>
                      <input
                        value={profile.application.version}
                        spellCheck={false}
                        onChange={(event) =>
                          setProfile({
                            ...profile,
                            application: { ...profile.application, version: event.target.value },
                          })
                        }
                      />
                    </label>
                    <label>
                      <span>Build number</span>
                      <input
                        type="number"
                        min={1}
                        value={profile.application.buildNumber}
                        onChange={(event) =>
                          setProfile({
                            ...profile,
                            application: { ...profile.application, buildNumber: Number(event.target.value) },
                          })
                        }
                      />
                    </label>
                    <label>
                      <span>Launch scene</span>
                      <select
                        value={profile.startSceneId}
                        onChange={(event) => setProfile({ ...profile, startSceneId: event.target.value })}
                      >
                        {pending.bundle.project.scenes.map((scene) => (
                          <option key={scene.id} value={scene.id}>
                            {scene.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Configuration</span>
                      <select
                        value={profile.configuration}
                        onChange={(event) =>
                          setProfile({ ...profile, configuration: event.target.value === 'debug' ? 'debug' : 'release' })
                        }
                      >
                        <option value="release">Release</option>
                        <option value="debug">Development</option>
                      </select>
                    </label>
                    <label>
                      <span>Window title</span>
                      <input
                        value={profile.window.title}
                        onChange={(event) =>
                          setProfile({ ...profile, window: { ...profile.window, title: event.target.value } })
                        }
                      />
                    </label>
                    <label>
                      <span>Window width</span>
                      <input
                        type="number"
                        min={profile.window.minWidth}
                        value={profile.window.width}
                        onChange={(event) =>
                          setProfile({ ...profile, window: { ...profile.window, width: Number(event.target.value) } })
                        }
                      />
                    </label>
                    <label>
                      <span>Window height</span>
                      <input
                        type="number"
                        min={profile.window.minHeight}
                        value={profile.window.height}
                        onChange={(event) =>
                          setProfile({ ...profile, window: { ...profile.window, height: Number(event.target.value) } })
                        }
                      />
                    </label>
                    <label>
                      <span>Minimum width</span>
                      <input
                        type="number"
                        min={1}
                        max={profile.window.width}
                        value={profile.window.minWidth}
                        onChange={(event) =>
                          setProfile({ ...profile, window: { ...profile.window, minWidth: Number(event.target.value) } })
                        }
                      />
                    </label>
                    <label>
                      <span>Minimum height</span>
                      <input
                        type="number"
                        min={1}
                        max={profile.window.height}
                        value={profile.window.minHeight}
                        onChange={(event) =>
                          setProfile({ ...profile, window: { ...profile.window, minHeight: Number(event.target.value) } })
                        }
                      />
                    </label>
                  </div>
                  <div className="report-profile-toggles">
                    <label>
                      <input
                        type="checkbox"
                        checked={profile.window.resizable}
                        onChange={(event) =>
                          setProfile({ ...profile, window: { ...profile.window, resizable: event.target.checked } })
                        }
                      />
                      Resizable window
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={profile.window.fullscreen}
                        onChange={(event) =>
                          setProfile({ ...profile, window: { ...profile.window, fullscreen: event.target.checked } })
                        }
                      />
                      Start fullscreen
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={profile.includeDebugOverlay}
                        onChange={(event) => setProfile({ ...profile, includeDebugOverlay: event.target.checked })}
                      />
                      Include runtime diagnostics
                    </label>
                  </div>
                  {profileErrors.length > 0 && (
                    <ul className="report-issues error">
                      {profileErrors.map((error) => (
                        <li key={error}>{error}</li>
                      ))}
                    </ul>
                  )}
                </details>
              )}

              {hasErrors && (!isProduction || step === 'check') && (
                <section className="report-section">
                  <h3 className="report-h-error">
                    <OctagonX size={14} aria-hidden /> Errors — export blocked
                  </h3>
                  <ul className="report-issues error">
                    {report.errors.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </section>
              )}

              {hasWarnings && (!isProduction || step === 'check') && (
                <section className="report-section">
                  <h3 className="report-h-warn">
                    <AlertTriangle size={14} aria-hidden /> Warnings
                  </h3>
                  <ul className="report-issues warn">
                    {report.warnings.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </section>
              )}

              {report.assets.length > 0 && (!isProduction || step === 'check') && (
                <section className="report-section">
                  <h3>Assets ({report.assets.length})</h3>
                  <table className="report-assets">
                    <tbody>
                      {report.assets.map((asset) => {
                        const isStripped = willStrip && !asset.referenced;
                        const isLarge = asset.bytes > LARGE_ASSET_BYTES;
                        return (
                          <tr key={asset.id} className={isStripped ? 'stripped' : isLarge ? 'large' : undefined}>
                            <td className="report-asset-name" title={asset.id}>
                              {asset.name}
                            </td>
                            <td className="report-asset-type">{asset.type}</td>
                            <td className="report-asset-flags">
                              {isLarge && !isStripped && (
                                <span className="report-flag warn" title="Over 8 MB — consider compressing">
                                  <AlertTriangle size={11} aria-hidden /> large
                                </span>
                              )}
                              {!asset.embedded && <span className="report-flag error">no data</span>}
                              {isStripped && <span className="report-flag">stripped</span>}
                            </td>
                            <td className="report-asset-size">{humanSize(asset.bytes)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </section>
              )}

              {selectedUnavailable.length > 0 && (
                <section className="report-section">
                  <ul className="report-issues warn">
                    <li>
                      Not buildable on this machine yet: {selectedUnavailable.join(', ')}. Configure its SDK or a remote builder before exporting.
                    </li>
                  </ul>
                </section>
              )}

              <section className="report-section" hidden={isProduction && step !== 'check'}>
                <label className="report-strip-toggle">
                  <input
                    type="checkbox"
                    checked={stripUnused}
                    disabled={report.scanFailed}
                    onChange={(e) => setStrip(e.target.checked)}
                  />
                  <Scissors size={14} aria-hidden />
                  <span>
                    Strip unused assets
                    {report.scanFailed
                      ? ' — unavailable: the reference scan failed, so everything ships.'
                      : stripped.length
                        ? ` — ${stripped.length} unreferenced asset${stripped.length === 1 ? '' : 's'}, saves ${humanSize(strippedBytes)}.`
                        : ' — every asset is referenced; nothing to strip.'}
                  </span>
                </label>
              </section>
            </div>

            <footer className="report-footer">
              <button className="prefs-link-button" onClick={cancel}>
                Cancel
              </button>
              {isProduction && step === 'check' && <button className="prefs-link-button" onClick={() => setStep('platform')}>Back to platforms</button>}
              <button
                className="prefs-primary-button"
                disabled={
                  (hasErrors && (!isProduction || step === 'check')) ||
                  profileErrors.length > 0 ||
                  selectedUnavailable.length > 0 ||
                  (isProduction && (!profile || (runningInDesktopShell && !platforms)))
                }
                title={
                  hasErrors || profileErrors.length || selectedUnavailable.length
                    ? 'Fix the build errors above first.'
                    : isProduction && runningInDesktopShell && !platforms
                      ? 'Waiting for the local platform check.'
                      : undefined
                }
                onClick={() => isProduction && step === 'platform' ? setStep('check') : void confirm(stripUnused, isProduction ? profile ?? undefined : undefined)}
              >
                {isProduction ? step === 'platform' ? 'Check project' : runningInDesktopShell ? 'Build game' : 'Download build package' : hasWarnings ? 'Export anyway' : 'Export'}
              </button>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
