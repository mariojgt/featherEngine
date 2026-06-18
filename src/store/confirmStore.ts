import { create } from 'zustand';

export interface ConfirmRequest {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm button as destructive (red). */
  danger?: boolean;
}

interface ConfirmState {
  request: (ConfirmRequest & { id: number }) | null;
  resolver: ((ok: boolean) => void) | null;
  ask: (req: ConfirmRequest) => Promise<boolean>;
  respond: (ok: boolean) => void;
}

let seq = 0;

/**
 * Promise-based confirmation modal — a styled, themeable replacement for blocking `window.confirm`.
 * `await confirmAction({ message, danger: true })` resolves true/false; the dialog is rendered by
 * ConfirmDialog (mounted once in App). One request at a time, which matches how confirms are used.
 */
export const useConfirmStore = create<ConfirmState>((set, get) => ({
  request: null,
  resolver: null,
  ask: (req) =>
    new Promise<boolean>((resolve) => {
      // If a confirm is already open, resolve it false before replacing it.
      get().resolver?.(false);
      set({ request: { ...req, id: ++seq }, resolver: resolve });
    }),
  respond: (ok) => {
    get().resolver?.(ok);
    set({ request: null, resolver: null });
  },
}));

export const confirmAction = (req: ConfirmRequest): Promise<boolean> => useConfirmStore.getState().ask(req);
