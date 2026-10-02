/**
 * On-screen touch controls for phones/tablets — the layer that makes Android/iOS (and touch-screen
 * web) exports playable with zero per-game setup. Mounted inside GameHud, so it appears in both the
 * editor preview and the standalone player, only while Play is on and only on touch devices.
 *
 * How it reaches the runtime (all existing pipes, no new input model):
 *  - left virtual joystick → `touchInput.moveX/moveY`, merged into `gamepadInput` by
 *    `sampleGamepads` (characters move, vehicles throttle/steer);
 *  - right-side drag → `mouseLook.dx/dy`, same accumulator the mouse and right stick feed;
 *  - buttons → `setRuntimeKey` with the engine's standard codes (Space jump, KeyE interact,
 *    Mouse0 fire, ShiftLeft sprint) so every template and Key Down/Up node just works.
 */
import { useEffect, useRef, type RefObject } from 'react';
import { useEditorStore } from '../store/editorStore';
import { mouseLook } from '../runtime/mouseLook';
import { isTouchDevice, resetTouchInput, touchInput } from '../runtime/touchInput';

const JOYSTICK_RADIUS = 52;
/** Touch drags are shorter than mouse swipes; scale them up so a half-screen drag ≈ a full turn. */
const LOOK_SCALE = 2.4;

/**
 * Block the browser's synthesized compatibility mouse events (and scrolling) for touches that
 * begin on this element. Without it, every look-drag or button tap would also fire the window
 * `mousedown` listener as a phantom Mouse0 — auto-firing weapons in every shooter template.
 * React registers `onTouchStart` passively, so this needs a native non-passive listener.
 */
function useBlockNativeTouch(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const block = (e: TouchEvent) => e.preventDefault();
    el.addEventListener('touchstart', block, { passive: false });
    return () => el.removeEventListener('touchstart', block);
  }, [ref]);
}

function VirtualJoystick() {
  const zoneRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const pointerId = useRef<number | null>(null);
  useBlockNativeTouch(zoneRef);

  const setStick = (clientX: number, clientY: number) => {
    const zone = zoneRef.current;
    const thumb = thumbRef.current;
    if (!zone || !thumb) return;
    const rect = zone.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = (clientX - cx) / JOYSTICK_RADIUS;
    let dy = (clientY - cy) / JOYSTICK_RADIUS;
    const mag = Math.hypot(dx, dy);
    if (mag > 1) {
      dx /= mag;
      dy /= mag;
    }
    touchInput.moveX = dx;
    touchInput.moveY = -dy; // screen up = forward
    thumb.style.transform = `translate(${dx * JOYSTICK_RADIUS}px, ${dy * JOYSTICK_RADIUS}px)`;
  };

  const release = () => {
    pointerId.current = null;
    touchInput.moveX = 0;
    touchInput.moveY = 0;
    if (thumbRef.current) thumbRef.current.style.transform = 'translate(0, 0)';
  };

  return (
    <div
      ref={zoneRef}
      className="touch-joystick"
      onPointerDown={(e) => {
        pointerId.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        setStick(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        if (pointerId.current === e.pointerId) setStick(e.clientX, e.clientY);
      }}
      onPointerUp={release}
      onPointerCancel={release}
    >
      <div ref={thumbRef} className="touch-joystick-thumb" />
    </div>
  );
}

function LookZone() {
  const zoneRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  useBlockNativeTouch(zoneRef);

  return (
    <div
      ref={zoneRef}
      className="touch-look"
      onPointerDown={(e) => {
        drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const current = drag.current;
        if (!current || current.id !== e.pointerId) return;
        mouseLook.dx += (e.clientX - current.x) * LOOK_SCALE;
        mouseLook.dy += (e.clientY - current.y) * LOOK_SCALE;
        current.x = e.clientX;
        current.y = e.clientY;
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
    />
  );
}

function TouchButton({ code, label, wide }: { code: string; label: string; wide?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  const setRuntimeKey = useEditorStore((state) => state.setRuntimeKey);
  const down = useRef(false);
  useBlockNativeTouch(ref);

  const press = (pressed: boolean) => {
    if (down.current === pressed) return; // setRuntimeKey counts edges — never repeat a press
    down.current = pressed;
    setRuntimeKey(code, pressed);
  };

  // If Play stops (or the overlay unmounts) mid-press, release the key so it can't stick.
  useEffect(() => () => {
    if (down.current) useEditorStore.getState().setRuntimeKey(code, false);
  }, [code]);

  return (
    <button
      ref={ref}
      className={`touch-button${wide ? ' wide' : ''}`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        press(true);
      }}
      onPointerUp={() => press(false)}
      onPointerCancel={() => press(false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {label}
    </button>
  );
}

export function TouchControls() {
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const show = isPlaying && isTouchDevice();

  useEffect(() => {
    if (!show) return;
    touchInput.active = true;
    return () => resetTouchInput();
  }, [show]);

  if (!show) return null;

  return (
    <div className="touch-controls" aria-hidden>
      <LookZone />
      <VirtualJoystick />
      <div className="touch-buttons">
        <TouchButton code="ShiftLeft" label="SPRINT" />
        <TouchButton code="KeyE" label="USE" />
        <TouchButton code="Space" label="JUMP" />
        <TouchButton code="Mouse0" label="FIRE" wide />
      </div>
      {/* Styles ride along in the component (like GameHud's keyframes) because the standalone
          player build does NOT include the editor stylesheet. */}
      <style>{TOUCH_CSS}</style>
    </div>
  );
}

const TOUCH_CSS = `
.touch-controls {
  position: absolute;
  inset: 0;
  /* Authored screen UI (20) stays clickable above the camera-drag surface. */
  z-index: 19;
  pointer-events: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
}
.touch-look {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 55%;
  pointer-events: auto;
  touch-action: none;
}
.touch-joystick {
  position: absolute;
  left: calc(24px + env(safe-area-inset-left, 0px));
  bottom: calc(28px + env(safe-area-inset-bottom, 0px));
  width: 128px;
  height: 128px;
  border: 2px solid rgba(236, 246, 255, 0.28);
  border-radius: 50%;
  background: rgba(10, 14, 20, 0.28);
  pointer-events: auto;
  touch-action: none;
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(2px);
}
.touch-joystick-thumb {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: rgba(236, 246, 255, 0.55);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.45);
  will-change: transform;
}
.touch-buttons {
  position: absolute;
  right: calc(20px + env(safe-area-inset-right, 0px));
  bottom: calc(28px + env(safe-area-inset-bottom, 0px));
  display: grid;
  grid-template-columns: repeat(2, 64px);
  gap: 10px;
  justify-items: end;
  pointer-events: none;
}
.touch-button {
  width: 64px;
  height: 64px;
  border: 2px solid rgba(236, 246, 255, 0.3);
  border-radius: 50%;
  background: rgba(10, 14, 20, 0.32);
  color: rgba(236, 246, 255, 0.88);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  pointer-events: auto;
  touch-action: none;
  backdrop-filter: blur(2px);
}
.touch-button:active {
  background: rgba(236, 246, 255, 0.3);
}
.touch-button.wide {
  width: 76px;
  height: 76px;
}
`;
