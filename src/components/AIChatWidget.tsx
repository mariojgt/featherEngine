import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUp,
  Bot,
  ExternalLink,
  Settings2,
  Sparkles,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { useAIChat } from '../ai/useAIChat';
import { PROVIDERS, type ProviderId } from '../ai/providers';
import { useAISettings } from '../store/aiSettingsStore';
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

function SettingsPanel({ onClose }: { onClose: () => void }) {
  const provider = useAISettings((state) => state.provider);
  const apiKeys = useAISettings((state) => state.apiKeys);
  const models = useAISettings((state) => state.models);
  const setProvider = useAISettings((state) => state.setProvider);
  const setApiKey = useAISettings((state) => state.setApiKey);
  const setModel = useAISettings((state) => state.setModel);
  const smartRouting = useAISettings((state) => state.smartRouting);
  const setSmartRouting = useAISettings((state) => state.setSmartRouting);
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

      <label className="node-field">
        <span>Model</span>
        <input
          list={`models-${provider}`}
          value={models[provider]}
          onChange={(event) => setModel(provider, event.target.value)}
          placeholder="Type or pick a model id"
          autoComplete="off"
          spellCheck={false}
        />
        <datalist id={`models-${provider}`}>
          {info.models.map((model) => (
            <option key={model} value={model} />
          ))}
        </datalist>
      </label>

      <label className="node-field" title="Short read-only questions are answered by the provider's fast tier (≈1/5th the price). Anything that builds or edits always uses the model above.">
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
          value={apiKeys[provider]}
          onChange={(event) => setApiKey(provider, event.target.value)}
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
    </div>
  );
}

export function AgentPanel() {
  const [showSettings, setShowSettings] = useState(false);
  const [draft, setDraft] = useState('');
  const { messages, status, error, sendMessage, clearMessages, stop } = useAIChat();
  const logRef = useRef<HTMLDivElement>(null);
  const hasKey = useAISettings((state) => Boolean(state.apiKeys[state.provider]));
  const provider = useAISettings((state) => state.provider);
  const activeModel = useAISettings((state) => state.models[state.provider]);
  const providerLabel = PROVIDERS[provider].label;

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  // `nf:ask-ai` lets anywhere in the editor hand a prompt to the assistant. The node search uses it
  // so "just describe what you want" is offered where people actually get stuck — in front of the
  // 161-node palette — instead of only inside this widget.
  // Read through a ref so the listener is attached once and never sees a stale sendMessage.
  const askRef = useRef({ hasKey, send: (_text: string) => {} });
  askRef.current = { hasKey, send: (text: string) => void sendMessage(text) };
  useEffect(() => {
    const onAsk = (event: Event) => {
      const prompt = (event as CustomEvent<{ prompt?: string }>).detail?.prompt?.trim();
      focusWorkspacePanel('agent');
      if (!prompt) return;
      // With no API key we cannot send. Park the text in the draft so the user's typing survives the
      // detour through settings rather than being silently swallowed.
      if (askRef.current.hasKey) askRef.current.send(prompt);
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

  return (
    <section className="panel ai-widget ai-widget--embedded agent-panel" aria-label="Feather Agent">
      <header className="ai-widget-header">
        <div className="ai-widget-title">
          <span className="ai-avatar">
            <Bot size={14} aria-hidden />
          </span>
          <span className="ai-title-copy">
            <strong>Feather Agent</strong>
            <span>{providerLabel} · {activeModel}</span>
          </span>
        </div>
        <span className={`ai-status-pill ${status === 'streaming' ? 'active' : ''}`}>
          {status === 'streaming' ? 'Working' : 'Ready'}
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
                <button key={suggestion.label} onClick={() => void sendMessage(suggestion.prompt)} disabled={!hasKey}>
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
              <div className="ai-bubble ai-thinking">Thinking…</div>
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
          placeholder={hasKey ? 'Describe what you want to build…' : 'Your prompt is safe — add an API key to send it'}
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
          <button className="ai-send" title="Send" onClick={submit} disabled={!draft.trim() || !hasKey}>
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
