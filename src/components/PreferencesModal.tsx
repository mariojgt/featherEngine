import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Layout, Palette, Settings2, Trash2, X } from 'lucide-react';
import {
  useEditorPrefs,
  type Density,
  type FontScale,
  type ThemeMode,
} from '../store/editorPrefsStore';
import {
  WORKSPACE_LAYOUTS,
  applyCustomLayout,
  applyWorkspaceLayout,
  snapshotWorkspaceLayout,
  type WorkspaceLayoutId,
} from './Workspace';

type Tab = 'appearance' | 'workspace';

const TABS: Array<{ id: Tab; label: string; icon: typeof Palette }> = [
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'workspace', label: 'Workspace', icon: Layout },
];

const THEME_OPTIONS: Array<{ id: ThemeMode; label: string; hint: string }> = [
  { id: 'dark', label: 'Dark', hint: 'Default — soft blue-grey panels.' },
  { id: 'midnight', label: 'Midnight', hint: 'Deeper black for OLED + focus.' },
  { id: 'light', label: 'Light', hint: 'For bright rooms and demos.' },
];

const ACCENT_SWATCHES = ['#5b8cff', '#7c5cff', '#3ddc97', '#f7b955', '#ff6b6b', '#ff8ad6'];

const DENSITY_OPTIONS: Array<{ id: Density; label: string; hint: string }> = [
  { id: 'comfortable', label: 'Comfortable', hint: 'Default spacing.' },
  { id: 'compact', label: 'Compact', hint: 'Tighter rows — more on screen.' },
];

const FONT_SCALES: Array<{ id: FontScale; label: string }> = [
  { id: 0.9, label: 'Small' },
  { id: 1.0, label: 'Medium' },
  { id: 1.1, label: 'Large' },
];

export function PreferencesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('appearance');
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Portal to <body> so the modal escapes the toolbar's `backdrop-filter` containing block
  // (otherwise `position: fixed` resolves against the 58px toolbar and gets clipped).
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="prefs-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            ref={cardRef}
            className="prefs-card"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.16 }}
            role="dialog"
            aria-modal="true"
            aria-label="Editor preferences"
          >
            <header className="prefs-header">
              <Settings2 size={16} aria-hidden />
              <strong>Preferences</strong>
              <div className="prefs-spacer" />
              <button className="prefs-close" onClick={onClose} title="Close (Esc)">
                <X size={15} aria-hidden />
              </button>
            </header>
            <div className="prefs-body">
              <nav className="prefs-tabs" aria-label="Preference categories">
                {TABS.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    className={`prefs-tab ${tab === id ? 'active' : ''}`}
                    onClick={() => setTab(id)}
                  >
                    <Icon size={14} aria-hidden />
                    <span>{label}</span>
                  </button>
                ))}
              </nav>
              <div className="prefs-panel">
                {tab === 'appearance' && <AppearancePanel />}
                {tab === 'workspace' && <WorkspacePanel onClose={onClose} />}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function AppearancePanel() {
  const themeMode = useEditorPrefs((s) => s.themeMode);
  const accent = useEditorPrefs((s) => s.accent);
  const density = useEditorPrefs((s) => s.density);
  const fontScale = useEditorPrefs((s) => s.fontScale);
  const setThemeMode = useEditorPrefs((s) => s.setThemeMode);
  const setAccent = useEditorPrefs((s) => s.setAccent);
  const setDensity = useEditorPrefs((s) => s.setDensity);
  const setFontScale = useEditorPrefs((s) => s.setFontScale);
  const resetAppearance = useEditorPrefs((s) => s.resetAppearance);

  return (
    <div className="prefs-section">
      <PrefRow label="Theme" hint="Pick the base colour palette.">
        <div className="prefs-chip-group">
          {THEME_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              className={`prefs-chip ${themeMode === opt.id ? 'active' : ''}`}
              onClick={() => setThemeMode(opt.id)}
              title={opt.hint}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </PrefRow>

      <PrefRow label="Accent" hint="Used for active controls, gizmos and highlights.">
        <div className="prefs-accent-row">
          {ACCENT_SWATCHES.map((color) => (
            <button
              key={color}
              className={`prefs-swatch ${accent.toLowerCase() === color.toLowerCase() ? 'active' : ''}`}
              style={{ background: color }}
              onClick={() => setAccent(color)}
              title={color}
              aria-label={`Accent ${color}`}
            />
          ))}
          <label className="prefs-color-input" title="Custom colour">
            <input
              type="color"
              value={accent}
              onChange={(e) => setAccent(e.target.value)}
            />
            <span>Custom</span>
          </label>
        </div>
      </PrefRow>

      <PrefRow label="Density" hint="How tightly UI rows pack together.">
        <div className="prefs-chip-group">
          {DENSITY_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              className={`prefs-chip ${density === opt.id ? 'active' : ''}`}
              onClick={() => setDensity(opt.id)}
              title={opt.hint}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </PrefRow>

      <PrefRow label="Font size" hint="Scales editor text everywhere.">
        <div className="prefs-chip-group">
          {FONT_SCALES.map((opt) => (
            <button
              key={opt.id}
              className={`prefs-chip ${fontScale === opt.id ? 'active' : ''}`}
              onClick={() => setFontScale(opt.id)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </PrefRow>

      <div className="prefs-footer">
        <button className="prefs-link-button" onClick={resetAppearance}>
          Reset appearance to defaults
        </button>
      </div>
    </div>
  );
}

function WorkspacePanel({ onClose }: { onClose: () => void }) {
  const customLayouts = useEditorPrefs((s) => s.customLayouts);
  const saveCustomLayout = useEditorPrefs((s) => s.saveCustomLayout);
  const deleteCustomLayout = useEditorPrefs((s) => s.deleteCustomLayout);
  const [newName, setNewName] = useState('');
  const customList = useMemo(
    () => Object.values(customLayouts).sort((a, b) => b.savedAt - a.savedAt),
    [customLayouts],
  );

  const handleApplyPreset = (id: WorkspaceLayoutId) => {
    applyWorkspaceLayout(id);
    onClose();
  };

  const handleSaveCurrent = () => {
    const name = newName.trim();
    if (!name) return;
    const json = snapshotWorkspaceLayout();
    if (!json) return;
    saveCustomLayout(name, json);
    setNewName('');
  };

  const handleApplyCustom = (json: unknown) => {
    if (applyCustomLayout(json)) onClose();
  };

  return (
    <div className="prefs-section">
      <PrefRow label="Built-in layouts" hint="One-click presets tuned for a workflow.">
        <div className="prefs-layout-grid">
          {WORKSPACE_LAYOUTS.map((layout) => (
            <button
              key={layout.id}
              className="prefs-layout-card"
              onClick={() => handleApplyPreset(layout.id)}
            >
              <strong>{layout.label}</strong>
            </button>
          ))}
        </div>
      </PrefRow>

      <PrefRow label="Save current layout" hint="Snapshot your arrangement to reuse later.">
        <div className="prefs-save-row">
          <input
            className="prefs-input"
            placeholder="Layout name…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveCurrent();
            }}
          />
          <button
            className="prefs-primary-button"
            onClick={handleSaveCurrent}
            disabled={!newName.trim()}
          >
            Save
          </button>
        </div>
      </PrefRow>

      {customList.length > 0 && (
        <PrefRow label="Your saved layouts" hint="Click a name to apply it.">
          <ul className="prefs-saved-list">
            {customList.map((layout) => (
              <li key={layout.name}>
                <button
                  className="prefs-saved-apply"
                  onClick={() => handleApplyCustom(layout.json)}
                  title={`Apply "${layout.name}"`}
                >
                  {layout.name}
                </button>
                <button
                  className="prefs-saved-delete"
                  onClick={() => deleteCustomLayout(layout.name)}
                  title={`Delete "${layout.name}"`}
                >
                  <Trash2 size={13} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </PrefRow>
      )}
    </div>
  );
}

function PrefRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="prefs-row">
      <div className="prefs-row-label">
        <strong>{label}</strong>
        {hint && <span>{hint}</span>}
      </div>
      <div className="prefs-row-control">{children}</div>
    </div>
  );
}
