import { create } from 'zustand';
import type { ModelPartShape } from '../types';

/**
 * Ephemeral Model Forge session for in-viewport kit-bashing. The studio expands `mesh` into the
 * Blender-like Edit workspace with vertex/edge/face control-cage selection.
 * Not persisted — it follows the current selection and editor tools.
 */
export type ModelForgeMode = 'build' | 'paint' | 'mesh';
export type ModelForgeGizmoMode = 'translate' | 'rotate' | 'scale';

interface ModelForgeSessionState {
  mode: ModelForgeMode;
  partId: string;
  colorSlot: number;
  /** Mirrors the viewport W/E/R toolbar so the part gizmo uses the same tool. */
  gizmoMode: ModelForgeGizmoMode;
  /** True while the in-scene part TransformControls handle is grabbed. */
  partGizmoEngaged: boolean;
  setMode: (mode: ModelForgeMode) => void;
  setPartId: (partId: string) => void;
  setColorSlot: (slot: number) => void;
  setGizmoMode: (mode: ModelForgeGizmoMode) => void;
  setPartGizmoEngaged: (engaged: boolean) => void;
}

export const useModelForgeSession = create<ModelForgeSessionState>()((set) => ({
  mode: 'build',
  partId: '',
  colorSlot: 1,
  gizmoMode: 'translate',
  partGizmoEngaged: false,
  setMode: (mode) => set({ mode }),
  setPartId: (partId) => set({ partId }),
  setColorSlot: (colorSlot) => set({ colorSlot: Math.max(0, Math.trunc(colorSlot)) }),
  setGizmoMode: (gizmoMode) => set({ gizmoMode }),
  setPartGizmoEngaged: (partGizmoEngaged) => set({ partGizmoEngaged }),
}));

export const MODEL_FORGE_SHAPES: Array<{ shape: ModelPartShape; label: string }> = [
  { shape: 'box', label: 'Box' },
  { shape: 'cylinder', label: 'Cylinder' },
  { shape: 'sphere', label: 'Sphere' },
  { shape: 'cone', label: 'Cone' },
  { shape: 'wedge', label: 'Wedge' },
];
