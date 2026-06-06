import { useEffect, useState } from 'react';
import { defaultCharacter, selectActiveObjects, useEditorStore } from '../store/editorStore';
import { useFollowTargetId } from '../three/FollowCamera';

/**
 * A dynamic first-person crosshair (Call-of-Duty style): four ticks that SPREAD apart while the player
 * moves (more when sprinting) and ease back when still, plus a brief X "hitmarker" pop each time the
 * player's shot damages a target. Pure DOM overlay; only shows during Play for a first-person pawn.
 * Reads `runtimeKeys` (movement) and `runtimeHitMarker` (the store bumps it on a player hit).
 */
export function DynamicCrosshair() {
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const targetId = useFollowTargetId();
  const keys = useEditorStore((state) => state.runtimeKeys);
  const hitMarker = useEditorStore((state) => state.runtimeHitMarker);
  const target = targetId ? selectActiveObjects(useEditorStore.getState()).find((object) => object.id === targetId) : undefined;

  // Show only for a first-person player during Play.
  const cc = { ...defaultCharacter(), ...(target?.character ?? {}) };
  const active = isPlaying && Boolean(target) && cc.cameraMode === 'firstPerson';

  // Hitmarker: flash a keyed element whenever the hit count changes (restarts the CSS pop animation).
  const [hit, setHit] = useState(false);
  useEffect(() => {
    if (!hitMarker) return;
    setHit(true);
    const t = setTimeout(() => setHit(false), 240);
    return () => clearTimeout(t);
  }, [hitMarker]);

  if (!active) return null;

  const moving = Boolean(keys[cc.keyForward] || keys[cc.keyBackward] || keys[cc.keyLeft] || keys[cc.keyRight]);
  const sprinting = moving && Boolean(keys[cc.keySprint]);
  const gap = 5 + (sprinting ? 16 : moving ? 9 : 0); // resting gap + movement spread (bloom)

  const bar = (transform: string, w: number, h: number): React.CSSProperties => ({
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: w,
    height: h,
    marginLeft: -w / 2,
    marginTop: -h / 2,
    background: 'rgba(255,255,255,0.92)',
    boxShadow: '0 0 2px rgba(0,0,0,0.85)',
    transform,
    transition: 'transform 0.09s ease-out',
    borderRadius: 1,
  });

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 25 }}>
      <style>{`@keyframes nf-hitmarker { 0% { opacity: 0; transform: translate(-50%,-50%) scale(1.7); } 25% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%,-50%) scale(0.85); } }`}</style>
      <div style={{ position: 'absolute', left: '50%', top: '50%' }}>
        {/* Center dot */}
        <div style={bar('translateY(0)', 2.5, 2.5)} />
        {/* Four spreading ticks */}
        <div style={bar(`translateY(${-(gap + 4)}px)`, 2, 8)} />
        <div style={bar(`translateY(${gap + 4}px)`, 2, 8)} />
        <div style={bar(`translateX(${-(gap + 4)}px)`, 8, 2)} />
        <div style={bar(`translateX(${gap + 4}px)`, 8, 2)} />
      </div>
      {/* Hitmarker X — pops big then shrinks/fades on each confirmed hit. */}
      {hit && (
        <div
          key={hitMarker}
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: 22,
            height: 22,
            transform: 'translate(-50%,-50%)',
            animation: 'nf-hitmarker 0.24s ease-out forwards',
          }}
        >
          {[45, -45].map((deg) => (
            <div
              key={deg}
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                width: 16,
                height: 2.5,
                marginLeft: -8,
                marginTop: -1.25,
                background: '#ffffff',
                boxShadow: '0 0 3px rgba(0,0,0,0.9)',
                transform: `rotate(${deg}deg)`,
                borderRadius: 2,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
