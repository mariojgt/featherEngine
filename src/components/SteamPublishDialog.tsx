import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CloudUpload,
  ExternalLink,
  Eye,
  FolderOpen,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Terminal,
  X,
} from 'lucide-react';
import { getPlatform, isDesktop } from '../platform';
import type { SteamPublishResult, SteamToolReport } from '../platform/types';
import { useProjectStore } from '../store/projectStore';

const GLOBAL_SETUP_KEY = 'feather.steam.local-setup.v1';
const PROJECT_SETUP_PREFIX = 'feather.steam.project.v1.';
const PROTECTED_BRANCHES = new Set(['default', 'public']);
const PACKAGED_FILE_RE = /\.(?:zip|dmg|msi|exe|pkg|deb|rpm|appimage)$/i;
const INSTALLER_FOLDER_RE = /(?:^|[/\\])(?:installers?|packages?|archives?)(?:[/\\]|$)/i;

type Step = 0 | 1 | 2;
type ToolState =
  | { status: 'idle'; checkedPath?: undefined; report?: undefined }
  | { status: 'checking'; checkedPath: string; report?: undefined }
  | { status: 'checked'; checkedPath: string; report: SteamToolReport };
type PublishState = 'idle' | 'running-preview' | 'running-upload' | 'success' | 'error';
type CheckStatus = 'pass' | 'warn' | 'fail';

interface StoredGlobalSetup {
  sdkPath?: string;
  account?: string;
}

interface StoredProjectSetup {
  appId?: string;
  depotId?: string;
  branch?: string;
}

interface PreflightItem {
  label: string;
  detail: string;
  status: CheckStatus;
}

function readStoredObject<T extends object>(key: string): Partial<T> {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return {};
    const value: unknown = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Partial<T>) : {};
  } catch {
    return {};
  }
}

function storeObject(key: string, value: object) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable in hardened webviews. Publishing itself should still work.
  }
}

function projectKey(dir: string | null, name: string) {
  const source = dir && dir !== 'web' ? dir : name.trim().toLocaleLowerCase();
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${PROJECT_SETUP_PREFIX}${(hash >>> 0).toString(36)}`;
}

function positiveInteger(value: string) {
  if (!/^\d+$/.test(value.trim())) return false;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 0xffff_ffff;
}

function cleanBranch(value: string) {
  return value.trim();
}

function protectedBranch(value: string) {
  return PROTECTED_BRANCHES.has(cleanBranch(value).toLocaleLowerCase());
}

function validAccount(value: string) {
  const clean = value.trim();
  return clean.length > 0
    && clean.length <= 64
    && clean.toLocaleLowerCase() !== 'anonymous'
    && /^[A-Za-z0-9_.@-]+$/.test(clean);
}

function validBranch(value: string) {
  const clean = cleanBranch(value);
  return !clean || (clean.length <= 64 && /^[A-Za-z0-9_-]+$/.test(clean) && !protectedBranch(clean));
}

function authNeedsAttention(error: string | null, log: string[]) {
  if (!error) return false;
  const detail = `${error}\n${log.slice(-40).join('\n')}`;
  return /steam\s*guard|two[- ]factor|\b2fa\b|account\s+logon|login\s+failure|authentication|credential|password/i.test(detail);
}

function focusableElements(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute('hidden'));
}

function CheckMark({ status }: { status: CheckStatus }) {
  if (status === 'pass') return <CheckCircle2 size={15} aria-hidden />;
  if (status === 'warn') return <AlertTriangle size={15} aria-hidden />;
  return <X size={15} aria-hidden />;
}

export function SteamPublishDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const projectName = useProjectStore((state) => state.projectName);
  const projectDir = useProjectStore((state) => state.projectDir);
  const lastProductionOutput = useProjectStore((state) => state.lastProductionOutput);
  const storageKey = useMemo(() => projectKey(projectDir, projectName), [projectDir, projectName]);

  const [step, setStep] = useState<Step>(0);
  const [hydrated, setHydrated] = useState(false);
  const [sdkPath, setSdkPath] = useState('');
  const [contentRoot, setContentRoot] = useState('');
  const [account, setAccount] = useState('');
  const [appId, setAppId] = useState('');
  const [depotId, setDepotId] = useState('');
  const [description, setDescription] = useState('');
  const [branch, setBranch] = useState('internal');
  const [preview, setPreview] = useState(true);
  const [toolState, setToolState] = useState<ToolState>({ status: 'idle' });
  const [publishState, setPublishState] = useState<PublishState>('idle');
  const [publishError, setPublishError] = useState<string | null>(null);
  const [result, setResult] = useState<SteamPublishResult | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const dialogRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLPreElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const toolRequestRef = useRef(0);
  const isRunning = publishState === 'running-preview' || publishState === 'running-upload';
  const sdkPathClean = sdkPath.trim();
  const contentRootClean = contentRoot.trim();
  const branchClean = cleanBranch(branch);
  const toolReady = toolState.status === 'checked'
    && toolState.checkedPath === sdkPathClean
    && toolState.report.ready;

  const checkTools = useCallback(async (path: string): Promise<SteamToolReport | null> => {
    const cleanPath = path.trim();
    const request = ++toolRequestRef.current;
    if (!cleanPath) {
      setToolState({ status: 'idle' });
      return null;
    }
    setToolState({ status: 'checking', checkedPath: cleanPath });
    try {
      const platform = await getPlatform();
      if (!platform.isDesktop || !platform.checkSteamTools) {
        const report = { ready: false, errors: ['Steam publishing is available in the Feather desktop app only.'] };
        if (request === toolRequestRef.current) setToolState({ status: 'checked', checkedPath: cleanPath, report });
        return report;
      }
      const report = await platform.checkSteamTools(cleanPath);
      if (request === toolRequestRef.current) setToolState({ status: 'checked', checkedPath: cleanPath, report });
      return report;
    } catch (error) {
      const report = {
        ready: false,
        errors: [error instanceof Error ? error.message : String(error)],
      };
      if (request === toolRequestRef.current) setToolState({ status: 'checked', checkedPath: cleanPath, report });
      return report;
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const global = readStoredObject<StoredGlobalSetup>(GLOBAL_SETUP_KEY);
    const project = readStoredObject<StoredProjectSetup>(storageKey);
    const restoredSdkPath = typeof global.sdkPath === 'string' ? global.sdkPath : '';
    setHydrated(false);
    setStep(0);
    setSdkPath(restoredSdkPath);
    setContentRoot(lastProductionOutput ?? '');
    setAccount(typeof global.account === 'string' ? global.account : '');
    setAppId(typeof project.appId === 'string' ? project.appId : '');
    setDepotId(typeof project.depotId === 'string' ? project.depotId : '');
    setDescription(`${projectName} build`);
    setBranch(typeof project.branch === 'string' ? project.branch : 'internal');
    setPreview(true);
    setToolState({ status: 'idle' });
    setPublishState('idle');
    setPublishError(null);
    setResult(null);
    setLog([]);
    setHydrated(true);
    if (restoredSdkPath) void checkTools(restoredSdkPath);
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>('[data-autofocus="true"]')?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      toolRequestRef.current += 1;
      previousFocusRef.current?.focus();
    };
  }, [checkTools, lastProductionOutput, open, projectName, storageKey]);

  useEffect(() => {
    if (!open || !hydrated) return;
    storeObject(GLOBAL_SETUP_KEY, { sdkPath, account } satisfies StoredGlobalSetup);
    storeObject(storageKey, { appId, depotId, branch } satisfies StoredProjectSetup);
  }, [account, appId, branch, depotId, hydrated, open, sdkPath, storageKey]);

  useEffect(() => {
    if (!logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  const close = () => {
    if (!isRunning) onClose();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const focusable = focusableElements(dialogRef.current);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const pickSdkFolder = async () => {
    const platform = await getPlatform();
    if (!platform.pickDirectory) {
      setToolState({
        status: 'checked',
        checkedPath: sdkPathClean,
        report: { ready: false, errors: ['Folder selection requires the Feather desktop app.'] },
      });
      return;
    }
    const picked = await platform.pickDirectory('Choose the Steamworks SDK or ContentBuilder folder');
    if (!picked) return;
    setSdkPath(picked);
    void checkTools(picked);
  };

  const pickContentFolder = async () => {
    try {
      const platform = await getPlatform();
      if (!platform.pickDirectory) throw new Error('Folder selection requires the Feather desktop app.');
      const picked = await platform.pickDirectory('Choose the exact unpacked folder for this Steam depot');
      if (picked) setContentRoot(picked);
    } catch (error) {
      setPublishError(error instanceof Error ? error.message : String(error));
      setPublishState('error');
    }
  };

  const goToDepot = async () => {
    if (!sdkPathClean || !accountValid) return;
    if (toolReady) {
      setStep(1);
      return;
    }
    const report = await checkTools(sdkPathClean);
    if (report?.ready) setStep(1);
  };

  const fileLikeContent = PACKAGED_FILE_RE.test(contentRootClean);
  const installerLikeContent = INSTALLER_FOLDER_RE.test(contentRootClean);
  const idsValid = positiveInteger(appId) && positiveInteger(depotId);
  const accountValid = validAccount(account);
  const branchValid = validBranch(branchClean);
  const depotValid = Boolean(contentRootClean) && !fileLikeContent && idsValid && branchValid && Boolean(description.trim());

  const preflight = useMemo<PreflightItem[]>(() => {
    const contentStatus: CheckStatus = !contentRootClean || fileLikeContent
      ? 'fail'
      : installerLikeContent
        ? 'warn'
        : 'pass';
    const contentDetail = !contentRootClean
      ? 'Choose the unpacked directory whose files belong in this depot.'
      : fileLikeContent
        ? 'SteamPipe needs a directory, not a zip, disk image, or installer file.'
        : installerLikeContent
          ? 'This looks like an installer/package folder. Confirm it contains the exact unpacked depot files.'
          : 'An unpacked content directory is selected. The native preflight will verify it exists.';
    const branchStatus: CheckStatus = !branchValid ? 'fail' : branchClean ? 'pass' : 'warn';
    const branchDetail = protectedBranch(branchClean)
      ? `“${branchClean}” is protected. Feather will not target the default/public branch.`
      : !branchValid
        ? 'Use at most 64 letters, numbers, hyphens, or underscores.'
        : branchClean
          ? `The uploaded build will be assigned to the private “${branchClean}” beta branch.`
          : 'No beta branch selected; the build will be uploaded without changing a branch.';
    return [
      {
        label: 'Desktop publishing bridge',
        detail: isDesktop ? 'Local publishing is available.' : 'Open this project in the Feather desktop app.',
        status: isDesktop ? 'pass' : 'fail',
      },
      {
        label: 'Steamworks ContentBuilder',
        detail: toolReady
          ? `SteamCMD found${toolState.status === 'checked' && toolState.report.steamcmdPath ? ` at ${toolState.report.steamcmdPath}` : ''}.`
          : 'Validate a Steamworks SDK or ContentBuilder folder before continuing.',
        status: toolReady ? 'pass' : 'fail',
      },
      { label: 'Depot content', detail: contentDetail, status: contentStatus },
      {
        label: 'Steam identifiers',
        detail: idsValid ? `App ${appId.trim()} · depot ${depotId.trim()}` : 'App ID and Depot ID must be positive numbers.',
        status: idsValid ? 'pass' : 'fail',
      },
      { label: 'Release branch', detail: branchDetail, status: branchStatus },
      {
        label: 'Credentials',
        detail: 'No password, API key, or Steam Guard code is collected or stored by Feather.',
        status: 'pass',
      },
    ];
  }, [appId, branchClean, branchValid, contentRootClean, depotId, fileLikeContent, idsValid, installerLikeContent, toolReady, toolState]);

  // Keep every hook above this guard. The dialog stays mounted under the toolbar and toggles
  // `open`, so returning before `useMemo` would change the hook order between renders.
  if (!open) return null;

  const canPublish = accountValid && depotValid && toolReady && isDesktop && !isRunning;

  const publish = async (event: FormEvent) => {
    event.preventDefault();
    if (!canPublish) return;
    setPublishError(null);
    setResult(null);
    setLog([]);

    const latestReport = await checkTools(sdkPathClean);
    if (!latestReport?.ready) {
      setPublishState('error');
      setPublishError('SteamCMD validation failed. Fix the local tool setup, then retry.');
      return;
    }

    try {
      const platform = await getPlatform();
      if (!platform.publishSteam) throw new Error('Steam publishing is unavailable in this build of Feather desktop.');
      setPublishState(preview ? 'running-preview' : 'running-upload');
      const publishResult = await platform.publishSteam(
        {
          sdkPath: sdkPathClean,
          contentRoot: contentRootClean,
          account: account.trim(),
          appId: Number(appId.trim()),
          depotId: Number(depotId.trim()),
          description: description.trim(),
          branch: branchClean || undefined,
          preview,
        },
        (line) => setLog((current) => [...current, line].slice(-2000)),
      );
      setResult(publishResult);
      setPublishState('success');
    } catch (error) {
      setPublishError(error instanceof Error ? error.message : String(error));
      setPublishState('error');
    }
  };

  const openSteamworks = () => {
    const targetApp = result?.appId ?? (positiveInteger(appId) ? Number(appId) : null);
    if (!targetApp) return;
    const opened = window.open(`https://partner.steamgames.com/apps/builds/${targetApp}`, '_blank', 'noopener,noreferrer');
    if (opened) opened.opener = null;
  };

  const authAttention = authNeedsAttention(publishError, log);

  return createPortal(
    <div
      className="steam-publish-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && close()}
      data-testid="steam-publish-backdrop"
    >
      <div
        ref={dialogRef}
        className="steam-publish-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="steam-publish-title"
        aria-describedby="steam-publish-description"
        onKeyDown={handleKeyDown}
        data-testid="steam-publish-dialog"
      >
        <header className="steam-publish-header">
          <span className="steam-publish-mark" aria-hidden><CloudUpload size={19} /></span>
          <div>
            <h2 id="steam-publish-title">Upload to Steam</h2>
            <p id="steam-publish-description">Prepare and upload one depot build for {projectName}.</p>
          </div>
          <button
            type="button"
            className="steam-publish-close"
            onClick={close}
            disabled={isRunning}
            aria-label="Close Steam upload dialog"
            title={isRunning ? 'Wait for SteamCMD to finish' : 'Close (Esc)'}
          >
            <X size={16} aria-hidden />
          </button>
        </header>

        <nav className="steam-publish-steps" aria-label="Steam upload setup">
          {(['Local tools', 'Depot build', 'Preflight'] as const).map((label, index) => (
            <button
              key={label}
              type="button"
              className={step === index ? 'active' : step > index ? 'complete' : ''}
              onClick={() => index < step && !isRunning && setStep(index as Step)}
              disabled={index > step || isRunning}
              aria-current={step === index ? 'step' : undefined}
            >
              <span>{step > index ? <Check size={12} aria-hidden /> : index + 1}</span>
              {label}
            </button>
          ))}
        </nav>

        {!isDesktop ? (
          <main className="steam-publish-body steam-publish-desktop-only">
            <Terminal size={28} aria-hidden />
            <h3>Desktop app required</h3>
            <p>SteamCMD runs locally, so depot preview and upload are only available in Feather desktop.</p>
          </main>
        ) : (
          <form onSubmit={publish}>
            <main className="steam-publish-body">
              {step === 0 && (
                <section className="steam-publish-panel" aria-labelledby="steam-local-tools-heading">
                  <div className="steam-publish-intro">
                    <span><Terminal size={18} aria-hidden /></span>
                    <div>
                      <h3 id="steam-local-tools-heading">Connect local Steamworks tools</h3>
                      <p>Point Feather at Valve’s SDK or its ContentBuilder folder. The SDK is not bundled with Feather.</p>
                    </div>
                  </div>

                  <label className="steam-publish-field">
                    <span>Steamworks SDK / ContentBuilder folder <em>required</em></span>
                    <div className="steam-publish-path-input">
                      <input
                        data-autofocus="true"
                        value={sdkPath}
                        onChange={(event) => {
                          setSdkPath(event.target.value);
                          setToolState({ status: 'idle' });
                        }}
                        placeholder="/path/to/steamworks_sdk/tools/ContentBuilder"
                        spellCheck={false}
                        autoComplete="off"
                      />
                      <button type="button" onClick={() => void pickSdkFolder()}>
                        <FolderOpen size={14} aria-hidden /> Browse
                      </button>
                    </div>
                  </label>

                  <label className="steam-publish-field">
                    <span>Steam build account <em>saved on this computer</em></span>
                    <input
                      value={account}
                      onChange={(event) => setAccount(event.target.value)}
                      placeholder="build-account-name"
                      spellCheck={false}
                      autoComplete="username"
                      maxLength={64}
                    />
                    {account.trim() && !accountValid
                      ? <small className="is-error"><X size={13} aria-hidden /> Use letters, numbers, dot, underscore, hyphen, or @; anonymous cannot upload.</small>
                      : <small>Use a dedicated account with only the permissions needed for this app.</small>}
                  </label>

                  <div className={`steam-tool-status ${toolReady ? 'ready' : toolState.status === 'checked' ? 'error' : ''}`} aria-live="polite">
                    <div>
                      {toolState.status === 'checking' ? <LoaderCircle className="spin" size={16} aria-hidden /> : toolReady ? <CheckCircle2 size={16} aria-hidden /> : <Terminal size={16} aria-hidden />}
                      <strong>{toolState.status === 'checking' ? 'Checking SteamCMD…' : toolReady ? 'Steam tools ready' : 'Validate local tools'}</strong>
                    </div>
                    {toolReady && toolState.status === 'checked' && toolState.report.steamcmdPath && (
                      <code>{toolState.report.steamcmdPath}</code>
                    )}
                    {toolState.status === 'checked' && !toolState.report.ready && (
                      <ul>{toolState.report.errors.map((error) => <li key={error}>{error}</li>)}</ul>
                    )}
                    <button type="button" onClick={() => void checkTools(sdkPath)} disabled={!sdkPathClean || toolState.status === 'checking'}>
                      <RefreshCw size={13} aria-hidden /> {toolState.status === 'checking' ? 'Checking…' : 'Check tools'}
                    </button>
                  </div>

                  <div className="steam-publish-notice">
                    <ShieldCheck size={16} aria-hidden />
                    <p><strong>No Steam password or API key is requested.</strong> SteamCMD uses its local authenticated session. Feather stores only this folder and account name on this computer.</p>
                  </div>
                </section>
              )}

              {step === 1 && (
                <section className="steam-publish-panel" aria-labelledby="steam-depot-heading">
                  <div className="steam-publish-intro">
                    <span><CloudUpload size={18} aria-hidden /></span>
                    <div>
                      <h3 id="steam-depot-heading">Choose exactly what enters the depot</h3>
                      <p>The production output root can also contain zips and installers. Select the exact unpacked content directory for this depot.</p>
                    </div>
                  </div>

                  <label className="steam-publish-field steam-publish-field-wide">
                    <span>Depot content directory <em>required</em></span>
                    <div className="steam-publish-path-input">
                      <input
                        data-autofocus="true"
                        value={contentRoot}
                        onChange={(event) => setContentRoot(event.target.value)}
                        placeholder="/path/to/unpacked/game/files"
                        spellCheck={false}
                        autoComplete="off"
                      />
                      <button type="button" onClick={() => void pickContentFolder()}>
                        <FolderOpen size={14} aria-hidden /> Browse
                      </button>
                    </div>
                    {lastProductionOutput && contentRoot === lastProductionOutput && (
                      <small className="is-warning"><AlertTriangle size={13} aria-hidden /> Prefilled from the last production build. Verify this is the depot-ready subfolder, not its outer artifact folder.</small>
                    )}
                    {fileLikeContent && (
                      <small className="is-error"><X size={13} aria-hidden /> Choose an unpacked directory. SteamPipe cannot use a zip or installer as the content root.</small>
                    )}
                    {!fileLikeContent && installerLikeContent && (
                      <small className="is-warning"><AlertTriangle size={13} aria-hidden /> This path looks installer-oriented. Confirm the folder contains the unpacked files players should receive.</small>
                    )}
                  </label>

                  <div className="steam-publish-grid">
                    <label className="steam-publish-field">
                      <span>Steam App ID <em>required</em></span>
                      <input value={appId} onChange={(event) => setAppId(event.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="480" />
                    </label>
                    <label className="steam-publish-field">
                      <span>Depot ID <em>required</em></span>
                      <input value={depotId} onChange={(event) => setDepotId(event.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="481" />
                    </label>
                  </div>

                  <label className="steam-publish-field">
                    <span>Build description <em>visible in Steamworks</em></span>
                    <input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={100} placeholder="Internal QA build" />
                  </label>

                  <label className="steam-publish-field">
                    <span>Private beta branch <em>optional</em></span>
                    <input value={branch} onChange={(event) => setBranch(event.target.value)} placeholder="internal" spellCheck={false} maxLength={64} />
                    {protectedBranch(branchClean) ? (
                      <small className="is-error"><X size={13} aria-hidden /> Feather will not target the protected default/public branch. Use a private beta branch or leave this blank.</small>
                    ) : branchClean && !branchValid ? (
                      <small className="is-error"><X size={13} aria-hidden /> Use only letters, numbers, hyphens, or underscores.</small>
                    ) : (
                      <small>Defaults to “internal”. Leave blank to upload without assigning a branch.</small>
                    )}
                  </label>

                  <div className="steam-publish-notice is-warning">
                    <AlertTriangle size={16} aria-hidden />
                    <p><strong>This uploads a depot build; it does not release your game’s store page.</strong> Store review, pricing, visibility, and public release remain in Steamworks.</p>
                  </div>
                </section>
              )}

              {step === 2 && (
                <section className="steam-publish-panel" aria-labelledby="steam-preflight-heading">
                  <div className="steam-publish-intro">
                    <span><ShieldCheck size={18} aria-hidden /></span>
                    <div>
                      <h3 id="steam-preflight-heading">Preflight</h3>
                      <p>Review the destination and choose whether to validate locally or upload to Steamworks.</p>
                    </div>
                  </div>

                  <ul className="steam-preflight-list">
                    {preflight.map((item) => (
                      <li key={item.label} className={item.status}>
                        <CheckMark status={item.status} />
                        <div><strong>{item.label}</strong><span>{item.detail}</span></div>
                      </li>
                    ))}
                  </ul>

                  <fieldset className="steam-publish-mode" disabled={isRunning}>
                    <legend>Action</legend>
                    <label className={preview ? 'selected' : ''}>
                      <input type="radio" name="steam-action" checked={preview} onChange={() => setPreview(true)} />
                      <Eye size={17} aria-hidden />
                      <span><strong>Preview only</strong><small>Generate and validate SteamPipe configuration without uploading.</small></span>
                      <em>Recommended first</em>
                    </label>
                    <label className={!preview ? 'selected' : ''}>
                      <input type="radio" name="steam-action" checked={!preview} onChange={() => setPreview(false)} />
                      <CloudUpload size={17} aria-hidden />
                      <span><strong>Upload depot build</strong><small>Send files to Steamworks{branchClean ? ` and assign “${branchClean}” beta` : ''}.</small></span>
                    </label>
                  </fieldset>

                  {(isRunning || log.length > 0) && (
                    <section className="steam-publish-log-section" aria-labelledby="steam-log-heading">
                      <div>
                        <h4 id="steam-log-heading"><Terminal size={14} aria-hidden /> SteamCMD output</h4>
                        {isRunning && <span><LoaderCircle className="spin" size={13} aria-hidden /> Running</span>}
                      </div>
                      <pre ref={logRef} className="steam-publish-log" role="log" aria-live="polite" aria-relevant="additions text">{log.join('\n') || 'Waiting for SteamCMD output…'}</pre>
                    </section>
                  )}

                  {publishState === 'error' && publishError && (
                    <div className="steam-publish-result error" role="alert">
                      <X size={18} aria-hidden />
                      <div><strong>Steam upload stopped</strong><p>{publishError}</p></div>
                    </div>
                  )}

                  {authAttention && (
                    <div className="steam-publish-auth" role="alert">
                      <ShieldCheck size={18} aria-hidden />
                      <div>
                        <strong>Steam authentication needs action</strong>
                        <p>Open SteamCMD directly, sign in with this build account, complete Steam Guard, then return and retry. Do not paste a password or code into Feather.</p>
                      </div>
                    </div>
                  )}

                  {publishState === 'success' && result && (
                    <div className="steam-publish-result success" role="status">
                      <CheckCircle2 size={20} aria-hidden />
                      <div>
                        <strong>{result.status === 'previewed' ? 'Preview completed' : result.status === 'live-beta' ? 'Beta branch updated' : 'Depot build uploaded'}</strong>
                        <p>
                          {result.status === 'previewed'
                            ? 'No files were uploaded. Review the log, then switch to Upload when ready.'
                            : result.status === 'live-beta'
                              ? `Build ${result.buildId ?? 'completed'} was uploaded and assigned to the “${result.branch ?? branchClean}” beta branch. This did not release the store page.`
                              : `Build ${result.buildId ?? 'completed'} was uploaded to Steamworks. This did not release the store page.`}
                        </p>
                        {result.buildId && <span className="steam-build-id">Build ID <code>{result.buildId}</code></span>}
                      </div>
                    </div>
                  )}

                  <div className="steam-publish-runtime-note">
                    Steam SDK runtime features—overlay, achievements, cloud saves, and matchmaking—are a separate game integration and are not added by this uploader.
                  </div>
                </section>
              )}
            </main>

            <footer className="steam-publish-footer">
              {step > 0 && (
                <button type="button" className="steam-secondary-button" onClick={() => setStep((step - 1) as Step)} disabled={isRunning}>
                  <ChevronLeft size={14} aria-hidden /> Back
                </button>
              )}
              <span className="steam-publish-footer-spacer" />
              {step === 0 && (
                <button type="button" className="steam-primary-button" onClick={() => void goToDepot()} disabled={!sdkPathClean || !accountValid || toolState.status === 'checking'}>
                  Continue <ChevronRight size={14} aria-hidden />
                </button>
              )}
              {step === 1 && (
                <button type="button" className="steam-primary-button" onClick={() => setStep(2)} disabled={!depotValid}>
                  Review preflight <ChevronRight size={14} aria-hidden />
                </button>
              )}
              {step === 2 && result && result.status !== 'previewed' && (
                <button type="button" className="steam-secondary-button" onClick={openSteamworks}>
                  Open Steamworks builds <ExternalLink size={14} aria-hidden />
                </button>
              )}
              {step === 2 && result?.status === 'previewed' && !isRunning && (
                <button type="button" className="steam-secondary-button" onClick={() => {
                  setPreview(false);
                  setPublishState('idle');
                  setResult(null);
                }}>
                  Continue to upload
                </button>
              )}
              {step === 2 && (
                <button type="submit" className="steam-primary-button" disabled={!canPublish}>
                  {isRunning ? <LoaderCircle className="spin" size={14} aria-hidden /> : preview ? <Eye size={14} aria-hidden /> : <CloudUpload size={14} aria-hidden />}
                  {publishState === 'running-preview' ? 'Previewing…' : publishState === 'running-upload' ? 'Uploading…' : preview ? 'Run preview' : 'Upload build'}
                </button>
              )}
            </footer>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
