import { useEffect, useRef } from 'react';
import { useEditorStore } from '../store/editorStore';
import { resetFrameClock, smoothFrameDelta } from './frameClock';
import { resetGamepadInput, sampleGamepads } from './gamepadInput';
import { isCinematicCaptureEnabled } from './cinematicCapture';

export interface RuntimeLoopInstrumentation {
  onSessionStart?: () => void;
  onFrame?: (frameMs: number, tickMs: number) => void;
}

const RUNTIME_INPUT_CONTROL_SELECTOR = [
  'button',
  'input',
  'select',
  'textarea',
  '[role="button"]',
  '[role="combobox"]',
  '[role="searchbox"]',
  '[role="spinbutton"]',
  '[role="textbox"]',
].join(',');

/** UI controls own keyboard/mouse events while Play is running. For contenteditable trees, the
 * nearest explicit value wins so a contenteditable="false" island remains non-editable. */
function isRuntimeInputControl(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest(RUNTIME_INPUT_CONTROL_SELECTOR)) return true;
  const contentEditable = target.closest('[contenteditable]');
  return Boolean(contentEditable && contentEditable.getAttribute('contenteditable') !== 'false');
}

/**
 * The one frame/input driver used by editor Play and every exported Player. Keeping the shell here
 * means Blueprints, physics, gamepad and mouse/keyboard timing cannot drift between preview/build.
 */
export function useGameRuntime(active: boolean, instrumentation?: RuntimeLoopInstrumentation) {
  const tickRuntime = useEditorStore((state) => state.tickRuntime);
  const setRuntimeKey = useEditorStore((state) => state.setRuntimeKey);
  const instrumentationRef = useRef(instrumentation);
  instrumentationRef.current = instrumentation;

  useEffect(() => {
    if (!active) return;
    instrumentationRef.current?.onSessionStart?.();
    resetFrameClock();
    let frame = 0;
    let lastTime = performance.now();
    let clockNeedsAnchor = false;
    const invalidateClock = () => {
      // The next rAF timestamp is the new wall-clock anchor. Dropping that one simulation tick keeps
      // time spent in another tab/window out of both gameplay and editor performance diagnostics.
      clockNeedsAnchor = true;
      resetFrameClock();
    };
    const loop = (time: number) => {
      if (clockNeedsAnchor) {
        clockNeedsAnchor = false;
        lastTime = time;
        frame = requestAnimationFrame(loop);
        return;
      }
      const frameMs = time - lastTime;
      const delta = smoothFrameDelta(frameMs / 1000);
      lastTime = time;
      const tickStart = performance.now();
      // The production renderer advances fixed steps itself. Even paused ticks can process events
      // and allocate scene state, so do not run a competing wall-clock driver during capture.
      if (isCinematicCaptureEnabled()) {
        frame = requestAnimationFrame(loop);
        return;
      }
      // Live cinematic camera possession owns movement input; do not also drive the player/vehicle.
      if (!useEditorStore.getState().playtimeCameraSession) sampleGamepads(delta, setRuntimeKey);
      tickRuntime(delta);
      instrumentationRef.current?.onFrame?.(frameMs, performance.now() - tickStart);
      frame = requestAnimationFrame(loop);
    };
    window.addEventListener('blur', invalidateClock);
    window.addEventListener('focus', invalidateClock);
    document.addEventListener('visibilitychange', invalidateClock);
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('blur', invalidateClock);
      window.removeEventListener('focus', invalidateClock);
      document.removeEventListener('visibilitychange', invalidateClock);
      resetGamepadInput();
    };
  }, [active, tickRuntime, setRuntimeKey]);

  useEffect(() => {
    if (!active) return;
    // Only release inputs pressed by these DOM listeners. Do not sweep runtimeKeys: it also contains
    // touch/gamepad-only inputs that this keyboard/mouse lifecycle does not own.
    const heldInputs = new Set<string>();
    const pressInput = (code: string) => {
      if (heldInputs.has(code)) return;
      heldInputs.add(code);
      setRuntimeKey(code, true);
    };
    const releaseInput = (code: string) => {
      if (!heldInputs.delete(code)) return;
      setRuntimeKey(code, false);
    };
    const releaseHeldInputs = () => {
      // Stop clears runtimeKeys before React tears this effect down. Do not repopulate that clean
      // state with false-valued entries during cleanup; exported-player deactivation still releases
      // any owned code that remains pressed.
      const runtimeKeys = useEditorStore.getState().runtimeKeys;
      for (const code of heldInputs) if (runtimeKeys[code]) setRuntimeKey(code, false);
      heldInputs.clear();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (useEditorStore.getState().playtimeCameraSession) return;
      if (event.repeat || isRuntimeInputControl(event.target)) return;
      pressInput(event.code);
    };
    // Always release a key this driver owns, even if focus moved into a control while it was held.
    const onKeyUp = (event: KeyboardEvent) => releaseInput(event.code);
    const onMouseDown = (event: MouseEvent) => {
      if (useEditorStore.getState().playtimeCameraSession) return;
      // HUD and editor buttons own their actions; a potion/block/menu click must not also fire a weapon.
      if (isRuntimeInputControl(event.target)) return;
      pressInput(`Mouse${event.button}`);
    };
    const onMouseUp = (event: MouseEvent) => releaseInput(`Mouse${event.button}`);
    const onVisibilityChange = () => {
      if (document.hidden) releaseHeldInputs();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('blur', releaseHeldInputs);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('blur', releaseHeldInputs);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      releaseHeldInputs();
    };
  }, [active, setRuntimeKey]);
}
