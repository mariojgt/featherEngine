import { useEditorStore } from '../store/editorStore';

export function CinematicOverlay() {
  const fade = useEditorStore((state) => state.runtimeCinematicFade);
  if (!fade || fade.opacity <= 0.001) return null;
  return (
    <div
      className="cinematic-fade-overlay"
      style={{ background: fade.color, opacity: Math.min(1, Math.max(0, fade.opacity)) }}
    />
  );
}
