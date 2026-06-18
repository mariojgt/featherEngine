import { create } from 'zustand';

export type ToastKind = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  title?: string;
  /** Auto-dismiss after this many ms. 0 = sticky (manual dismiss only). */
  duration: number;
}

interface ToastState {
  toasts: Toast[];
  push: (kind: ToastKind, message: string, opts?: { title?: string; duration?: number }) => number;
  dismiss: (id: number) => void;
  clear: () => void;
}

let seq = 0;

/**
 * App-wide, stackable toast notifications — the "nothing happens silently" layer every pro tool has.
 * Replaces the single-slot project toast: any code (store actions, the AI assistant, panels) can call
 * `pushToast(...)`. Errors stick longer; everything else auto-dismisses. The render lives in ToastHost.
 */
export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (kind, message, opts) => {
    const id = ++seq;
    const duration = opts?.duration ?? (kind === 'error' ? 6000 : 3200);
    set((state) => ({ toasts: [...state.toasts, { id, kind, message, title: opts?.title, duration }] }));
    return id;
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

/** Imperative helper for non-React callers (store actions, the MCP bridge, etc.). */
export const pushToast = (
  kind: ToastKind,
  message: string,
  opts?: { title?: string; duration?: number },
): number => useToastStore.getState().push(kind, message, opts);
