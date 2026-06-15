import { describe, it, expect, afterEach } from 'vitest';
import { useEditorStore } from '../editorStore';

/**
 * Headless runtime smoke test. The single biggest stability gap in this engine has been that `tsc`
 * passing tells us nothing about whether the runtime actually survives a frame — features ship
 * "build-green but never live-tested". This drives the real Zustand store through Play + many
 * `tickRuntime` frames against the default project and asserts the frame loop never throws and
 * never silently stops. No rendering: the runtime is pure logic, so we exercise it directly.
 */
describe('tickRuntime — default project smoke', () => {
  afterEach(() => {
    // Always leave Play so one test can't bleed runtime state into the next.
    useEditorStore.getState().setPlaying(false);
  });

  it('plays and ticks 180 frames without throwing', () => {
    const store = useEditorStore.getState();
    store.setPlaying(true);
    expect(useEditorStore.getState().isPlaying).toBe(true);

    expect(() => {
      for (let frame = 0; frame < 180; frame += 1) {
        useEditorStore.getState().tickRuntime(1 / 60);
      }
    }).not.toThrow();

    // The loop must still be live — a thrown frame or a bad state patch would have flipped this.
    expect(useEditorStore.getState().isPlaying).toBe(true);
  });

  it('survives held-key input driving the player controller', () => {
    const store = useEditorStore.getState();
    store.setPlaying(true);
    // The starter Player Controller moves on KeyW (Key Down → Translate). Hold it down so the
    // input → movement path actually executes rather than idling.
    store.setRuntimeKey('KeyW', true);

    expect(() => {
      for (let frame = 0; frame < 120; frame += 1) {
        useEditorStore.getState().tickRuntime(1 / 60);
      }
    }).not.toThrow();

    store.setRuntimeKey('KeyW', false);
    expect(useEditorStore.getState().isPlaying).toBe(true);
  });
});
