import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Keyboard, X } from 'lucide-react';

/** Custom event the View menu (or anything else) can dispatch to open this overlay. */
export const OPEN_SHORTCUTS_EVENT = 'nf:open-shortcuts';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MOD = isMac ? '⌘' : 'Ctrl';

// Each key chip is a token; arrays render as "A then B" combos joined by a +.
type Shortcut = { keys: string[]; label: string };
type Group = { title: string; items: Shortcut[] };

const GROUPS: Group[] = [
  {
    title: 'General',
    items: [
      { keys: [MOD, 'K'], label: 'Command palette' },
      { keys: [MOD, 'S'], label: 'Save project' },
      { keys: [MOD, 'Z'], label: 'Undo' },
      { keys: [MOD, '⇧', 'Z'], label: 'Redo' },
      { keys: ['?'], label: 'Show this help' },
      { keys: ['Esc'], label: 'Close menu / deselect' },
    ],
  },
  {
    title: 'Objects',
    items: [
      { keys: [MOD, 'D'], label: 'Duplicate selection' },
      { keys: [MOD, 'A'], label: 'Select all' },
      { keys: [MOD, 'C'], label: 'Copy' },
      { keys: [MOD, 'V'], label: 'Paste' },
      { keys: [MOD, 'G'], label: 'Group selection' },
      { keys: [MOD, '⇧', 'G'], label: 'Ungroup' },
      { keys: ['Del'], label: 'Delete selection' },
      { keys: ['⇧', 'Click'], label: 'Add to selection (Hierarchy)' },
    ],
  },
  {
    title: 'Viewport & transform',
    items: [
      { keys: ['W'], label: 'Move tool' },
      { keys: ['E'], label: 'Rotate tool' },
      { keys: ['R'], label: 'Scale tool' },
      { keys: ['X'], label: 'Toggle world / local space' },
      { keys: ['F'], label: 'Focus selected object' },
      { keys: ['1'], label: 'Front view' },
      { keys: ['3'], label: 'Right view' },
      { keys: ['7'], label: 'Top view' },
      { keys: ['5'], label: 'Perspective view' },
    ],
  },
  {
    title: 'Panels & editors',
    items: [
      { keys: ['F8'], label: 'Performance overlay' },
      { keys: ['F9'], label: 'Variable watch' },
      { keys: ['Dbl-click'], label: 'Edit object blueprint (Hierarchy)' },
      { keys: ['Right-click'], label: 'Add node / object actions' },
      { keys: [MOD, 'C', '/', 'V'], label: 'Copy / paste nodes (Scripting)' },
    ],
  },
];

function isTypingTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return Boolean(el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)));
}

export function ShortcutsOverlay() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        return;
      }
      // "?" (Shift + /) opens the cheat-sheet — unless the user is typing into a field.
      if (event.key === '?' && !isTypingTarget(event.target)) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener(OPEN_SHORTCUTS_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener(OPEN_SHORTCUTS_EVENT, onOpen);
    };
  }, []);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="prefs-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <motion.div
            className="prefs-card shortcuts-card"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.16 }}
            role="dialog"
            aria-modal="true"
            aria-label="Keyboard shortcuts"
          >
            <header className="prefs-header">
              <Keyboard size={16} aria-hidden />
              <strong>Keyboard shortcuts</strong>
              <div className="prefs-spacer" />
              <button className="prefs-close" onClick={() => setOpen(false)} title="Close (Esc)">
                <X size={14} aria-hidden />
              </button>
            </header>
            <div className="shortcuts-grid">
              {GROUPS.map((group) => (
                <section key={group.title} className="shortcuts-group">
                  <h3>{group.title}</h3>
                  {group.items.map((item) => (
                    <div key={item.label} className="shortcut-row">
                      <span className="shortcut-keys">
                        {item.keys.map((key, index) =>
                          key === '+' || key === '/' ? (
                            <span key={index} className="shortcut-sep">{key}</span>
                          ) : (
                            <kbd key={index}>{key}</kbd>
                          ),
                        )}
                      </span>
                      <span className="shortcut-label">{item.label}</span>
                    </div>
                  ))}
                </section>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
