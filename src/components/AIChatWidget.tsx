import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUp,
  Bot,
  CheckCircle2,
  Cpu,
  Download,
  ExternalLink,
  HardDrive,
  RotateCcw,
  Settings2,
  Sparkles,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { useAIChat } from '../ai/useAIChat';
import {
  DEFAULT_MODELS,
  PROVIDERS,
  type ProviderId,
  type RemoteProviderInfo,
} from '../ai/providers';
import { getLocalModelDefinition, LOCAL_MODELS } from '../ai/local/localModelCatalog';
import {
  cancelLocalModelLoad,
  clearAllLocalAIModels,
  downloadAndLoadLocalModel,
  refreshLocalAIStatus,
  unloadLocalModel,
} from '../ai/local/localModelManager';
import { useAISettings } from '../store/aiSettingsStore';
import { useLocalAIStore } from '../store/localAIStore';
import { focusWorkspacePanel } from './workspacePanels';

const SUGGESTIONS = [
  {
    label: 'Polished HUD',
    meta: 'UI template',
    prompt: 'Create a polished HUD with health, score, ammo, and a clean readable layout',
  },
  {
    label: 'Smart Debug',
    meta: 'Inspect logic',
    prompt: 'Inspect my selected object and explain what its blueprint and animation logic are doing',
  },
  {
    label: 'Playable Room',
    meta: 'Scene + pickups',
    prompt: 'Build a small playable room with pickups, a counter HUD, lighting, and clear collision',
  },
];

const formatBytes = (value?: number) => {
  if (!value || !Number.isFinite(value)) return 'Unavailable';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** exponent).toFixed(exponent > 2 ? 1 : 0)} ${units[exponent]}`;
};

const formatModelDownload = (megabytes: number) =>
  megabytes >= 1000 ? `${(megabytes / 1000).toFixed(1)} GB` : `${megabytes} MB`;

function RemoteProviderSettings({ info }: { info: RemoteProviderInfo }) {
  const apiKeys = useAISettings((state) => state.apiKeys);
  const models = useAISettings((state) => state.models);
  const setApiKey = useAISettings((state) => state.setApiKey);
  const setModel = useAISettings((state) => state.setModel);
  const smartRouting = useAISettings((state) => state.smartRouting);
  const setSmartRouting = useAISettings((state) => state.setSmartRouting);

  return (
    <>
      <label className="node-field">
        <span>Model</span>
        <input
          list={`models-${info.id}`}
          value={models[info.id] ?? DEFAULT_MODELS[info.id]}
          onChange={(event) => setModel(info.id, event.target.value)}
          placeholder="Type or pick a model id"
          autoComplete="off"
          spellCheck={false}
        />
        <datalist id={`models-${info.id}`}>
          {info.models.map((model) => (
            <option key={model} value={model} />
          ))}
        </datalist>
      </label>

      <label className="node-field" title="Short read-only questions are answered by the provider's fast tier. Anything that builds or edits always uses the selected model.">
        <span>Smart routing</span>
        <select value={smartRouting ? 'on' : 'off'} onChange={(event) => setSmartRouting(event.target.value === 'on')}>
          <option value="on">On — cheap model for simple questions</option>
          <option value="off">Off — always use the selected model</option>
        </select>
      </label>

      <label className="node-field">
        <span>{info.label} API key</span>
        <input
          type="password"
          placeholder="sk-..."
          value={apiKeys[info.id]}
          onChange={(event) => setApiKey(info.id, event.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </label>

      <a className="ai-settings-link" href={info.keysUrl} target="_blank" rel="noreferrer">
        Get a {info.label} key <ExternalLink size={12} aria-hidden />
      </a>

      <p className="ai-settings-note">
        <AlertTriangle size={12} aria-hidden /> Your key is stored in this browser and sent directly to{' '}
        {info.label}. Use your own key locally — don't deploy this app publicly with a shared key.
      </p>
    </>
  );
}

function LocalProviderSettings() {
  const modelId = useAISettings((state) => state.models.local ?? DEFAULT_MODELS.local);
  const setModel = useAISettings((state) => state.setModel);
  const hardware = useLocalAIStore((state) => state.hardware);
  const runtime = useLocalAIStore((state) => state.runtime);
  const storage = useLocalAIStore((state) => state.storage);
  const cachedModelIds = useLocalAIStore((state) => state.cachedModelIds);
  const [confirmDownload, setConfirmDownload] = useState(false);
  const definition = getLocalModelDefinition(modelId);
  const busy = runtime.state === 'downloading' || runtime.state === 'loading';
  const approximateDownload = formatModelDownload(definition.approximateDownloadMb);
  const availableStorage =
    storage.quota !== undefined && storage.usage !== undefined
      ? Math.max(0, storage.quota - storage.usage)
      : undefined;
  const insufficientStorage =
    availableStorage !== undefined && availableStorage < definition.approximateDownloadMb * 1_000_000 * 1.05;

  useEffect(() => setConfirmDownload(false), [modelId]);

  const startDownload = () => {
    setConfirmDownload(false);
    void downloadAndLoadLocalModel(modelId).catch(() => {
      // Runtime state carries the actionable error; avoid an unhandled click promise.
    });
  };

  const clearCache = () => {
    if (!window.confirm('Clear all cached Local AI model data for Feather? You can download it again later.')) return;
    void clearAllLocalAIModels();
  };

  const statusLabel = (() => {
    switch (runtime.state) {
      case 'unsupported':
        return 'Unavailable';
      case 'not-installed':
        return 'Not downloaded';
      case 'downloading':
        return `Downloading · ${Math.round(runtime.progress * 100)}%`;
      case 'installed':
        return 'Cached locally';
      case 'loading':
        return `Loading on GPU · ${Math.round(runtime.progress * 100)}%`;
      case 'ready':
        return 'Ready on this device';
      case 'error':
        return 'Needs attention';
    }
  })();

  return (
    <div className="local-ai-settings">
      <div className={`local-ai-device ${hardware.state === 'available' ? 'ready' : ''}`}>
        <Cpu size={15} aria-hidden />
        <span>
          <strong>WebGPU</strong>
          <small>
            {hardware.state === 'checking'
              ? 'Checking this device…'
              : hardware.state === 'available'
                ? 'Compatible GPU adapter ready'
                : hardware.reason ?? 'Select Local AI to check this device'}
          </small>
        </span>
      </div>

      <label className="node-field">
        <span>Local model · {LOCAL_MODELS.length} curated choices</span>
        <select
          data-testid="local-model-select"
          value={modelId}
          onChange={(event) => setModel('local', event.target.value)}
          disabled={busy}
        >
          {LOCAL_MODELS.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label} — {model.recommended ? 'Recommended' : model.experimental ? 'Experimental' : model.tier}
              {' · '}{formatModelDownload(model.approximateDownloadMb)}
              {cachedModelIds.includes(model.id) ? ' · Downloaded' : ''}
            </option>
          ))}
        </select>
      </label>

      <div className="local-ai-model-card" data-model-id={definition.id}>
        <div className="local-ai-model-copy">
          <span className="local-ai-model-title">
            <strong>{definition.label}</strong>
            <em className={definition.experimental ? 'experimental' : definition.tier}>
              {definition.recommended ? 'Recommended' : definition.experimental ? 'Experimental' : definition.tier}
            </em>
          </span>
          <p>{definition.description}</p>
          <small>
            {statusLabel} · approximately {approximateDownload} · {definition.recommendedMemoryGb} GB free memory recommended
          </small>
          {definition.experimental && (
            <p className="local-ai-model-caveat">
              Preview model: use Qwen3 0.6B for the most conservative default while this model completes Feather benchmarks.
            </p>
          )}
        </div>

        {busy && (
          <div className="local-ai-progress" aria-label={statusLabel}>
            <span style={{ width: `${Math.max(2, Math.round(runtime.progress * 100))}%` }} />
          </div>
        )}

        {runtime.error && runtime.state !== 'unsupported' && (
          <p className="local-ai-inline-error"><AlertTriangle size={12} aria-hidden /> {runtime.error}</p>
        )}

        {insufficientStorage && runtime.state === 'not-installed' && (
          <p className="local-ai-inline-error">
            <AlertTriangle size={12} aria-hidden /> This browser reports less free storage than the approximately {approximateDownload} download.
          </p>
        )}

        {confirmDownload && runtime.state === 'not-installed' ? (
          <div className="local-ai-confirm">
            <p>
              Download {definition.label} ({approximateDownload})? Model files are stored in this browser/app cache and inference runs on this device.
            </p>
            <div className="local-ai-buttons">
              <button className="secondary-button" onClick={() => setConfirmDownload(false)}>Cancel</button>
              <button className="primary-button" onClick={startDownload} disabled={insufficientStorage}>
                <Download size={13} aria-hidden /> Download &amp; load
              </button>
            </div>
          </div>
        ) : (
          <div className="local-ai-buttons">
            {(runtime.state === 'not-installed' || runtime.state === 'error') && hardware.state === 'available' && (
              <button
                className="primary-button"
                onClick={() => runtime.state === 'not-installed' ? setConfirmDownload(true) : startDownload()}
                disabled={insufficientStorage && runtime.state === 'not-installed'}
              >
                {runtime.state === 'error' ? <RotateCcw size={13} aria-hidden /> : <Download size={13} aria-hidden />}
                {runtime.state === 'error' ? 'Retry' : 'Download & load'}
              </button>
            )}
            {runtime.state === 'installed' && (
              <button className="primary-button" onClick={startDownload}>
                <Cpu size={13} aria-hidden /> Load model
              </button>
            )}
            {runtime.state === 'ready' && (
              <button className="secondary-button" onClick={() => void unloadLocalModel()}>
                Unload from GPU
              </button>
            )}
            {busy && (
              <button className="secondary-button" onClick={() => void cancelLocalModelLoad()}>
                Cancel
              </button>
            )}
          </div>
        )}
      </div>

      <div className="local-ai-storage">
        <HardDrive size={14} aria-hidden />
        <span>
          <strong>Site storage</strong>
          <small>
            {formatBytes(storage.usage)} used{storage.quota ? ` of ${formatBytes(storage.quota)}` : ''}
            {cachedModelIds.length > 0 ? ` · ${cachedModelIds.length} model${cachedModelIds.length === 1 ? '' : 's'} cached` : ''}
          </small>
        </span>
        <button className="secondary-button" onClick={clearCache} disabled={busy || cachedModelIds.length === 0}>
          Clear local cache
        </button>
      </div>

      <p className="ai-settings-note local">
        <CheckCircle2 size={12} aria-hidden /> Local mode requires no API key and never falls back to a cloud provider.
      </p>
    </div>
  );
}

function SettingsPanel({ onClose }: { onClose: () => void }) {
  const provider = useAISettings((state) => state.provider);
  const setProvider = useAISettings((state) => state.setProvider);
  const info = PROVIDERS[provider];

  return (
    <div className="ai-settings">
      <div className="ai-settings-header">
        <span className="eyebrow">AI Settings</span>
        <button className="icon-button compact" onClick={onClose} title="Close settings">
          <X size={14} aria-hidden />
        </button>
      </div>

      <label className="node-field">
        <span>Provider</span>
        <select value={provider} onChange={(event) => setProvider(event.target.value as ProviderId)}>
          {Object.values(PROVIDERS).map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>

      {info.kind === 'remote' ? <RemoteProviderSettings info={info} /> : <LocalProviderSettings />}
    </div>
  );
}

export function AgentPanel() {
  const [showSettings, setShowSettings] = useState(false);
  const [draft, setDraft] = useState('');
  const { messages, status, error, sendMessage, clearMessages, stop } = useAIChat();
  const logRef = useRef<HTMLDivElement>(null);
  const provider = useAISettings((state) => state.provider);
  const apiKeys = useAISettings((state) => state.apiKeys);
  const activeModel = useAISettings((state) => state.models[state.provider] ?? DEFAULT_MODELS[state.provider]);
  const localRuntime = useLocalAIStore((state) => state.runtime);
  const providerLabel = PROVIDERS[provider].label;
  const canSend =
    provider === 'local'
      ? localRuntime.modelId === activeModel && (localRuntime.state === 'ready' || localRuntime.state === 'installed')
      : Boolean(apiKeys[provider]);
  const activeModelLabel = provider === 'local' ? getLocalModelDefinition(activeModel).label : activeModel;

  const previousProvider = useRef(provider);
  useEffect(() => {
    if (provider === 'local') void refreshLocalAIStatus(activeModel);
  }, [activeModel, provider]);

  useEffect(() => {
    if (previousProvider.current === 'local' && provider !== 'local') void unloadLocalModel();
    previousProvider.current = provider;
  }, [provider]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  // `nf:ask-ai` lets anywhere in the editor hand a prompt to the assistant. The node search uses it
  // so "just describe what you want" is offered where people actually get stuck — in front of the
  // 161-node palette — instead of only inside this widget.
  // Read through a ref so the listener is attached once and never sees a stale sendMessage.
  const askRef = useRef({ canSend, send: (_text: string) => {} });
  askRef.current = { canSend, send: (text: string) => void sendMessage(text) };
  useEffect(() => {
    const onAsk = (event: Event) => {
      const prompt = (event as CustomEvent<{ prompt?: string }>).detail?.prompt?.trim();
      focusWorkspacePanel('agent');
      if (!prompt) return;
      // If the selected provider is not configured/loaded, keep the prompt while settings opens.
      if (askRef.current.canSend) askRef.current.send(prompt);
      else {
        setDraft(prompt);
        setShowSettings(true);
      }
    };
    window.addEventListener('nf:ask-ai', onAsk);
    return () => window.removeEventListener('nf:ask-ai', onAsk);
  }, []);

  const submit = () => {
    const text = draft;
    setDraft('');
    void sendMessage(text);
  };

  const localProgress = Math.round(localRuntime.progress * 100);
  const statusText =
    provider === 'local' && localRuntime.state === 'downloading'
      ? `Downloading ${localProgress}%`
      : provider === 'local' && localRuntime.state === 'loading'
        ? `Loading ${localProgress}%`
        : status === 'streaming'
          ? provider === 'local' ? 'Working locally' : 'Working'
          : 'Ready';

  const composerPlaceholder = (() => {
    if (provider !== 'local') return canSend ? 'Describe what you want to build…' : 'Your prompt is safe — add an API key to send it';
    switch (localRuntime.state) {
      case 'ready':
        return 'Describe what you want to build locally…';
      case 'installed':
        return 'Cached model will load on the GPU when you send…';
      case 'downloading':
        return `Downloading local model · ${localProgress}%`;
      case 'loading':
        return `Loading local model · ${localProgress}%`;
      case 'unsupported':
        return 'Local AI is unavailable on this device';
      default:
        return 'Open Agent settings to download the local model';
    }
  })();

  return (
    <section className="panel ai-widget ai-widget--embedded agent-panel" aria-label="Feather Agent">
      <header className="ai-widget-header">
        <div className="ai-widget-title">
          <span className="ai-avatar">
            <Bot size={14} aria-hidden />
          </span>
          <span className="ai-title-copy">
            <strong>Feather Agent</strong>
            <span title={`${providerLabel} · ${activeModel}`}>
              {provider === 'local' ? `Local · ${activeModelLabel} · WebGPU` : `${providerLabel} · ${activeModelLabel}`}
            </span>
          </span>
        </div>
        <span className={`ai-status-pill ${status === 'streaming' || (provider === 'local' && (localRuntime.state === 'downloading' || localRuntime.state === 'loading')) ? 'active' : ''}`}>
          {statusText}
        </span>
        <div className="ai-widget-actions">
          <button
            className="icon-button compact"
            title="Agent settings"
            onClick={() => setShowSettings((value) => !value)}
          >
            <Settings2 size={14} aria-hidden />
          </button>
          <button
            className="icon-button compact"
            title="Clear conversation"
            onClick={clearMessages}
            disabled={messages.length === 0}
          >
            <Trash2 size={14} aria-hidden />
          </button>
        </div>
      </header>

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}

      <div className="ai-log" ref={logRef}>
        {messages.length === 0 && !showSettings && (
          <div className="ai-empty">
            <div className="ai-empty-card">
              <span className="ai-empty-icon">
                <Sparkles size={20} aria-hidden />
              </span>
              <h3>Build with an agent</h3>
              <p>Describe a playable scene, ask for a polish pass, or inspect your logic.</p>
            </div>
            <div className="ai-suggestions">
              {SUGGESTIONS.map((suggestion) => (
                <button key={suggestion.label} onClick={() => void sendMessage(suggestion.prompt)} disabled={!canSend}>
                  <span className="ai-suggestion-icon">
                    <Sparkles size={14} aria-hidden />
                  </span>
                  <span className="ai-suggestion-copy">
                    <strong>{suggestion.label}</strong>
                    <span>{suggestion.meta}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message) => (
          <div key={message.id} className={`ai-message ${message.role}`}>
            {message.actions.length > 0 && (
              <div className="ai-actions" aria-label="Agent progress">
                {message.actions.map((action) => (
                  <span key={action.id} className="ai-action-chip">
                    {action.label}
                  </span>
                ))}
              </div>
            )}
            {message.content && <div className="ai-bubble">{message.content}</div>}
            {message.role === 'assistant' && !message.content && status === 'streaming' && (
              <div className="ai-bubble ai-thinking">
                {provider === 'local' ? 'Working in your project…' : 'Thinking…'}
              </div>
            )}
          </div>
        ))}
      </div>

      {error && (
        <div className="ai-error">
          <AlertTriangle size={14} aria-hidden /> {error}
        </div>
      )}

      <div className="ai-composer">
        <textarea
          value={draft}
          placeholder={composerPlaceholder}
          aria-label="Message Feather Agent"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          rows={2}
        />
        {status === 'streaming' ? (
          <button className="ai-send stop" title="Stop" onClick={stop}>
            <Square size={14} aria-hidden />
          </button>
        ) : (
          <button className="ai-send" title="Send" onClick={submit} disabled={!draft.trim() || !canSend}>
            <ArrowUp size={16} aria-hidden />
          </button>
        )}
      </div>
    </section>
  );
}

/** Compatibility export for extensions that imported the old component name. */
export function AIChatWidget() {
  return <AgentPanel />;
}
