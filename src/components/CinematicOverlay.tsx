import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../store/editorStore';
import type { CinematicLook, RuntimeCinematicFade } from '../types';

/**
 * The cinematic "film look" + fade layer rendered over the frame. Defaults to the live runtime
 * cinematic (player + editor Play); pass explicit `look`/`fade` to drive it from the editor scrub
 * preview. Renders letterbox bars (measured to the container so 2.35/1.85 are pixel-accurate),
 * a color grade, film grain, an extra vignette, and the fade-to/from-color. Fills its positioned
 * parent (`.scene-drop-zone` in the editor, the window in the player) and never eats pointer events.
 */
export function CinematicOverlay({ look: lookProp, fade: fadeProp }: { look?: CinematicLook; fade?: RuntimeCinematicFade } = {}) {
  const runtimeLook = useEditorStore((state) => state.runtimeCinematicLook);
  const runtimeFade = useEditorStore((state) => state.runtimeCinematicFade);
  const look = lookProp ?? runtimeLook;
  const fade = fadeProp ?? runtimeFade;
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
  // Note: the color grade is rendered as a post-processing shader on the cinematic camera (PostFx),
  // not here — this DOM layer only owns letterbox bars, grain, vignette, and the fade.
  const hasLook = Boolean(aspect > 0 || look?.grain || look?.vignette);
  if (!hasLook && !hasFade) return null;

  return (
    <div ref={ref} className="cinematic-overlay">
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
      {hasFade && (
        <div className="cinematic-fade-overlay" style={{ background: fade!.color, opacity: Math.min(1, Math.max(0, fade!.opacity)) }} />
      )}
    </div>
  );
}
