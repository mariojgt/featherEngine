import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useToastStore, type Toast, type ToastKind } from '../store/toastStore';
import { useProjectStore } from '../store/projectStore';

const ICONS: Record<ToastKind, typeof Info> = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  useEffect(() => {
    if (toast.duration <= 0) return;
    const timer = window.setTimeout(() => onDismiss(toast.id), toast.duration);
    return () => window.clearTimeout(timer);
  }, [toast.id, toast.duration, onDismiss]);

  const Icon = ICONS[toast.kind];
  return (
    <motion.div
      layout
      role="alert"
      className={`toast toast--${toast.kind}`}
      initial={{ opacity: 0, y: 12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 24, scale: 0.96 }}
      transition={{ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
    >
      <Icon size={16} className="toast__icon" aria-hidden />
      <div className="toast__body">
        {toast.title && <span className="toast__title">{toast.title}</span>}
        <span className="toast__message">{toast.message}</span>
      </div>
      <button type="button" className="toast__close" onClick={() => onDismiss(toast.id)} aria-label="Dismiss">
        <X size={14} aria-hidden />
      </button>
    </motion.div>
  );
}

/**
 * Renders the toast stack (bottom-centre, above the status bar) and bridges the legacy single-slot
 * `projectStore.toast` into the stackable store so existing save/export/build feedback flows through
 * the new UI without touching those call sites.
 */
export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  const projToast = useProjectStore((s) => s.toast);
  const clearProjToast = useProjectStore((s) => s.clearToast);

  useEffect(() => {
    if (!projToast) return;
    useToastStore.getState().push(projToast.kind, projToast.message);
    clearProjToast();
  }, [projToast, clearProjToast]);

  return createPortal(
    <div className="toast-host" aria-live="polite" aria-atomic="false">
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </AnimatePresence>
    </div>,
    document.body,
  );
}
