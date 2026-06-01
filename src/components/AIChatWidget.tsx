import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
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

const SUGGESTIONS = [
  'Create a red sphere with dynamic physics',
  'Let me walk the Player with WASD, then attach it',
  "What's in my scene?",
];

function SettingsPanel({ onClose }: { onClose: () => void }) {
  const provider = useAISettings((state) => state.provider);
  const apiKeys = useAISettings((state) => state.apiKeys);
  const models = useAISettings((state) => state.models);
  const setProvider = useAISettings((state) => state.setProvider);
  const setApiKey = useAISettings((state) => state.setApiKey);
  const setModel = useAISettings((state) => state.setModel);
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

export function AIChatWidget() {
  const [open, setOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [draft, setDraft] = useState('');
  const { messages, status, error, sendMessage, clearMessages, stop } = useAIChat();
  const logRef = useRef<HTMLDivElement>(null);
  const hasKey = useAISettings((state) => Boolean(state.apiKeys[state.provider]));

  useEffect(() => {
    if (!hasKey && open) setShowSettings(true);
  }, [hasKey, open]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const submit = () => {
    const text = draft;
    setDraft('');
    void sendMessage(text);
  };

  return (
    <>
      <AnimatePresence>
        {!open && (
          <motion.button
            key="ai-launcher"
            className="ai-launcher"
            title="Open AI assistant"
            onClick={() => setOpen(true)}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
          >
            <Sparkles size={18} aria-hidden />
            <span>Ask AI</span>
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {open && (
          <motion.section
            key="ai-widget"
            className="ai-widget"
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
          >
            <header className="ai-widget-header">
              <div className="ai-widget-title">
                <Bot size={16} aria-hidden />
                <strong>NodeForge Assistant</strong>
              </div>
              <div className="ai-widget-actions">
                <button
                  className="icon-button compact"
                  title="Settings"
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
                <button className="icon-button compact" title="Close" onClick={() => setOpen(false)}>
                  <X size={14} aria-hidden />
                </button>
              </div>
            </header>

            {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}

            <div className="ai-log" ref={logRef}>
              {messages.length === 0 && !showSettings && (
                <div className="ai-empty">
                  <Sparkles size={20} aria-hidden />
                  <p>Tell me what to build. I can create objects, set physics, and wire up blueprints for you.</p>
                  <div className="ai-suggestions">
                    {SUGGESTIONS.map((suggestion) => (
                      <button key={suggestion} onClick={() => void sendMessage(suggestion)} disabled={!hasKey}>
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((message) => (
                <div key={message.id} className={`ai-message ${message.role}`}>
                  {message.actions.length > 0 && (
                    <div className="ai-actions">
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
                <AlertTriangle size={13} aria-hidden /> {error}
              </div>
            )}

            <div className="ai-composer">
              <textarea
                value={draft}
                placeholder={hasKey ? 'Ask the engine to build something…' : 'Add an API key in settings first'}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    submit();
                  }
                }}
                rows={1}
              />
              {status === 'streaming' ? (
                <button className="ai-send stop" title="Stop" onClick={stop}>
                  <Square size={15} aria-hidden />
                </button>
              ) : (
                <button
                  className="ai-send"
                  title="Send"
                  onClick={submit}
                  disabled={!draft.trim() || !hasKey}
                >
                  <ArrowUp size={16} aria-hidden />
                </button>
              )}
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </>
  );
}
