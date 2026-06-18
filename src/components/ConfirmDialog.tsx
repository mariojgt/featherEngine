import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle } from 'lucide-react';
import { useConfirmStore } from '../store/confirmStore';

/**
 * Renders the pending confirmation request (see confirmStore). Keyboard: Enter confirms, Escape
 * cancels; the confirm button is auto-focused. Mounted once in App, portalled to <body>.
 */
export function ConfirmDialog() {
  const request = useConfirmStore((s) => s.request);
  const respond = useConfirmStore((s) => s.respond);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!request) return;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        respond(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        respond(true);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [request, respond]);

  return createPortal(
    <AnimatePresence>
      {request && (
        <motion.div
          className="confirm-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={() => respond(false)}
        >
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-label={request.title ?? 'Confirm'}
            className={`confirm-dialog ${request.danger ? 'is-danger' : ''}`}
            initial={{ opacity: 0, y: 14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.97 }}
            transition={{ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            {request.danger && (
              <div className="confirm-dialog__icon" aria-hidden>
                <AlertTriangle size={20} />
              </div>
            )}
            <div className="confirm-dialog__body">
              {request.title && <h3 className="confirm-dialog__title">{request.title}</h3>}
              <p className="confirm-dialog__message">{request.message}</p>
            </div>
            <div className="confirm-dialog__actions">
              <button type="button" className="confirm-dialog__cancel" onClick={() => respond(false)}>
                {request.cancelLabel ?? 'Cancel'}
              </button>
              <button
                ref={confirmRef}
                type="button"
                className={`confirm-dialog__confirm ${request.danger ? 'is-danger' : ''}`}
                onClick={() => respond(true)}
              >
                {request.confirmLabel ?? 'Confirm'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
