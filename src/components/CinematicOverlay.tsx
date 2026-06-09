import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../store/editorStore';
import type { CinematicLook, CinematicTextStyle, RuntimeCinematicFade, RuntimeCinematicText } from '../types';

/** Layout + typography for each on-screen text style. `position` anchors the block within the frame. */
const textStyleLayout: Record<CinematicTextStyle, { position: React.CSSProperties; text: React.CSSProperties }> = {
  subtitle: {
    position: { left: 0, right: 0, bottom: '9%', alignItems: 'center', textAlign: 'center' },
    text: { fontSize: 'clamp(14px, 2.6vw, 30px)', fontWeight: 500, textShadow: '0 2px 8px rgba(0,0,0,0.85)', padding: '0 8%' },
  },
  title: {
    position: { left: 0, right: 0, top: '50%', transform: 'translateY(-50%)', alignItems: 'center', textAlign: 'center' },
    text: { fontSize: 'clamp(28px, 6vw, 76px)', fontWeight: 800, letterSpacing: '0.04em', textShadow: '0 4px 18px rgba(0,0,0,0.7)' },
  },
  lowerThird: {
    position: { left: '6%', right: '6%', bottom: '14%', alignItems: 'flex-start', textAlign: 'left' },
    text: { fontSize: 'clamp(16px, 3vw, 38px)', fontWeight: 700, textShadow: '0 2px 10px rgba(0,0,0,0.8)', borderLeft: '4px solid currentColor', paddingLeft: '0.5em' },
  },
  credit: {
    position: { left: 0, right: 0, bottom: '16%', alignItems: 'center', textAlign: 'center' },
    text: { fontSize: 'clamp(13px, 2.2vw, 26px)', fontWeight: 400, letterSpacing: '0.08em', textShadow: '0 2px 8px rgba(0,0,0,0.8)' },
  },
};

/** clip-path for a wipe that covers `cov` (0–1) of the frame, entering from the given direction. */
const wipeClip = (dir: NonNullable<RuntimeCinematicFade['wipe']>, cov: number): string => {
  const rest = `${((1 - cov) * 100).toFixed(2)}%`;
  switch (dir) {
    case 'right': return `inset(0 ${rest} 0 0)`; // colour grows from the left edge rightward
    case 'left': return `inset(0 0 0 ${rest})`; // grows from the right edge leftward
    case 'down': return `inset(0 0 ${rest} 0)`; // grows from the top downward
    case 'up': return `inset(${rest} 0 0 0)`; // grows from the bottom upward
  }
};

/**
 * The cinematic "film look" + fade layer rendered over the frame. Defaults to the live runtime
 * cinematic (player + editor Play); pass explicit `look`/`fade` to drive it from the editor scrub
 * preview. Renders letterbox bars (measured to the container so 2.35/1.85 are pixel-accurate),
 * a color grade, film grain, an extra vignette, and the fade-to/from-color. Fills its positioned
 * parent (`.scene-drop-zone` in the editor, the window in the player) and never eats pointer events.
 */
export function CinematicOverlay({ look: lookProp, fade: fadeProp, text: textProp }: { look?: CinematicLook; fade?: RuntimeCinematicFade; text?: RuntimeCinematicText[] } = {}) {
  const runtimeLook = useEditorStore((state) => state.runtimeCinematicLook);
  const runtimeFade = useEditorStore((state) => state.runtimeCinematicFade);
  const runtimeText = useEditorStore((state) => state.runtimeCinematicText);
  const previewText = useEditorStore((state) => state.editorCinematicPreviewText);
  const look = lookProp ?? runtimeLook;
  const fade = fadeProp ?? runtimeFade;
  const text = textProp ?? runtimeText ?? previewText;
  const aspect = look?.letterbox ?? 0;

  const ref = useRef<HTMLDivElement>(null);
  const [bars, setBars] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el || !aspect || aspect <= 0) {
      setBars({ x: 0, y: 0 });
      return;
    }
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      if (w / h > aspect) setBars({ x: Math.max(0, (w - h * aspect) / 2), y: 0 }); // pillarbox
      else setBars({ x: 0, y: Math.max(0, (h - w / aspect) / 2) }); // letterbox
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [aspect]);

  const hasFade = Boolean(fade && fade.opacity > 0.001);
  const hasText = Boolean(text && text.length);
  // Note: the color grade is rendered as a post-processing shader on the cinematic camera (PostFx),
  // not here — this DOM layer only owns letterbox bars, grain, vignette, text, and the fade.
  const hasLook = Boolean(aspect > 0 || look?.grain || look?.vignette || look?.lightLeak);
  if (!hasLook && !hasFade && !hasText) return null;

  return (
    <div ref={ref} className="cinematic-overlay">
      {look?.lightLeak ? <div className="cinematic-light-leak" style={{ opacity: Math.min(0.9, look.lightLeak) }} /> : null}
      {look?.vignette ? <div className="cinematic-look-vignette" style={{ opacity: Math.min(1, look.vignette) }} /> : null}
      {look?.grain ? <div className="cinematic-grain" style={{ opacity: Math.min(0.85, look.grain) }} /> : null}
      {bars.y > 0 && (
        <>
          <div className="cinematic-bar" style={{ top: 0, left: 0, right: 0, height: bars.y }} />
          <div className="cinematic-bar" style={{ bottom: 0, left: 0, right: 0, height: bars.y }} />
        </>
      )}
      {bars.x > 0 && (
        <>
          <div className="cinematic-bar" style={{ top: 0, bottom: 0, left: 0, width: bars.x }} />
          <div className="cinematic-bar" style={{ top: 0, bottom: 0, right: 0, width: bars.x }} />
        </>
      )}
      {hasText &&
        text!.map((entry) => {
          const layout = textStyleLayout[entry.style] ?? textStyleLayout.subtitle;
          return (
            <div
              key={entry.id}
              className="cinematic-text-line"
              style={{
                position: 'absolute',
                display: 'flex',
                flexDirection: 'column',
                opacity: entry.opacity,
                color: entry.color,
                pointerEvents: 'none',
                ...layout.position,
              }}
            >
              <span style={{ whiteSpace: 'pre-wrap', lineHeight: 1.2, ...layout.text }}>{entry.text}</span>
            </div>
          );
        })}
      {hasFade && (
        <div
          className="cinematic-fade-overlay"
          style={
            fade!.wipe
              ? // Directional wipe: a solid colour edge sweeps in; `opacity` is the coverage fraction.
                { background: fade!.color, opacity: 1, clipPath: wipeClip(fade!.wipe, Math.min(1, Math.max(0, fade!.opacity))) }
              : { background: fade!.color, opacity: Math.min(1, Math.max(0, fade!.opacity)) }
          }
        />
      )}
    </div>
  );
}
