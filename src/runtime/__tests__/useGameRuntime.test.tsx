import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditorStore } from '../../store/editorStore';
import { configureCinematicCapture } from '../cinematicCapture';
import { useGameRuntime, type RuntimeLoopInstrumentation } from '../useGameRuntime';

const originalStore = useEditorStore.getState();
const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const originalActEnvironment = globals.IS_REACT_ACT_ENVIRONMENT;

function RuntimeHarness({
  active = true,
  instrumentation,
  children,
}: {
  active?: boolean;
  instrumentation?: RuntimeLoopInstrumentation;
  children?: ReactNode;
}) {
  useGameRuntime(active, instrumentation);
  return <>{children}</>;
}

describe('useGameRuntime input and clock lifecycle', () => {
  let container: HTMLDivElement;
  let root: Root;

  const renderRuntime = (
    children?: ReactNode,
    active = true,
    instrumentation?: RuntimeLoopInstrumentation,
  ) => {
    act(() => root.render(
      <RuntimeHarness active={active} instrumentation={instrumentation}>{children}</RuntimeHarness>,
    ));
  };

  beforeEach(() => {
    globals.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    configureCinematicCapture(false);
    useEditorStore.setState(originalStore, true);
    delete (document as unknown as { hidden?: boolean }).hidden;
    if (originalActEnvironment === undefined) delete globals.IS_REACT_ACT_ENVIRONMENT;
    else globals.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('lets HUD buttons own their clicks while canvas clicks still attack and release', () => {
    const setRuntimeKey = vi.fn();
    useEditorStore.setState({ setRuntimeKey });
    renderRuntime(<><button><span>Block</span></button><canvas /></>);

    const label = container.querySelector('span')!;
    label.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    label.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 2 }));
    expect(setRuntimeKey).not.toHaveBeenCalled();

    container.querySelector('canvas')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    expect(setRuntimeKey).toHaveBeenLastCalledWith('Mouse0', true);
    // Release even over a button, so leaving the canvas while holding cannot leave attack stuck.
    label.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    expect(setRuntimeKey).toHaveBeenLastCalledWith('Mouse0', false);
  });

  it('keeps typing and keyboard activation in UI controls out of gameplay input', () => {
    const setRuntimeKey = vi.fn();
    useEditorStore.setState({ setRuntimeKey });
    renderRuntime(<>
      <input aria-label="Inspector value" />
      <textarea aria-label="AI prompt" />
      <div contentEditable suppressContentEditableWarning><span>HUD name</span></div>
      <div role="textbox" tabIndex={0}>Custom editor</div>
      <button>Confirm</button>
      <canvas />
    </>);

    const controls = [
      container.querySelector('input')!,
      container.querySelector('textarea')!,
      container.querySelector('[contenteditable] span')!,
      container.querySelector('[role="textbox"]')!,
    ];
    for (const control of controls) {
      control.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'KeyW' }));
      control.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, code: 'KeyW' }));
    }
    container.querySelector('button')!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'Space' }));
    expect(setRuntimeKey).not.toHaveBeenCalled();

    const canvas = container.querySelector('canvas')!;
    canvas.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'KeyW' }));
    canvas.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'KeyW', repeat: true }));
    expect(setRuntimeKey.mock.calls).toEqual([['KeyW', true]]);

    // A key accepted by gameplay still releases if focus moves into a text control before keyup.
    container.querySelector('input')!.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, code: 'KeyW' }));
    expect(setRuntimeKey.mock.calls).toEqual([['KeyW', true], ['KeyW', false]]);
  });

  it.each(['window blur', 'hidden tab'] as const)(
    'releases owned keyboard/mouse input on %s without sweeping unrelated virtual input',
    (interruption) => {
      useEditorStore.setState({ runtimeKeys: { Space: true } });
      renderRuntime(<canvas />);
      const canvas = container.querySelector('canvas')!;
      canvas.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'KeyW' }));
      canvas.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));

      if (interruption === 'window blur') {
        window.dispatchEvent(new Event('blur'));
      } else {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
      }

      expect(useEditorStore.getState().runtimeKeys).toMatchObject({
        Space: true,
        KeyW: false,
        Mouse0: false,
      });
    },
  );

  it('releases owned inputs and detaches listeners when Play stops', () => {
    useEditorStore.setState({ runtimeKeys: { Space: true } });
    renderRuntime(<canvas />);
    const canvas = container.querySelector('canvas')!;
    canvas.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'KeyD' }));
    canvas.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 2 }));

    renderRuntime(<canvas />, false);
    expect(useEditorStore.getState().runtimeKeys).toMatchObject({ Space: true, KeyD: false, Mouse2: false });
    expect(cancelAnimationFrame).toHaveBeenCalled();

    canvas.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'KeyA' }));
    expect(useEditorStore.getState().runtimeKeys.KeyA).toBeUndefined();
  });

  it('does not repopulate runtime keys after Stop has already cleared them', () => {
    useEditorStore.setState({ runtimeKeys: {} });
    renderRuntime(<canvas />);
    container.querySelector('canvas')!.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, code: 'KeyS' }),
    );
    expect(useEditorStore.getState().runtimeKeys.KeyS).toBe(true);

    // setPlaying(false) clears this map synchronously before React observes active=false.
    useEditorStore.setState({ runtimeKeys: {} });
    renderRuntime(<canvas />, false);
    expect(useEditorStore.getState().runtimeKeys).toEqual({});
  });

  it.each(['window focus', 'tab visibility'] as const)(
    'anchors the frame clock after %s resumes instead of ticking a stale delta',
    (resumePath) => {
      let now = 0;
      let nextFrame: FrameRequestCallback | undefined;
      let nextFrameId = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => now);
      vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
        nextFrame = callback;
        nextFrameId += 1;
        return nextFrameId;
      }));
      const tickRuntime = vi.fn();
      const onFrame = vi.fn();
      useEditorStore.setState({ tickRuntime, setRuntimeKey: vi.fn() });
      renderRuntime(undefined, true, { onFrame });

      const runFrame = (time: number) => {
        const callback = nextFrame;
        expect(callback).toBeTypeOf('function');
        nextFrame = undefined;
        now = time;
        act(() => callback!(time));
      };
      runFrame(16);
      expect(tickRuntime).toHaveBeenCalledTimes(1);
      expect(tickRuntime).toHaveBeenLastCalledWith(0.016);

      if (resumePath === 'window focus') {
        now = 100;
        window.dispatchEvent(new Event('blur'));
        now = 216;
        window.dispatchEvent(new Event('focus'));
      } else {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        now = 100;
        document.dispatchEvent(new Event('visibilitychange'));
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
        now = 216;
        document.dispatchEvent(new Event('visibilitychange'));
      }

      runFrame(216);
      expect(tickRuntime).toHaveBeenCalledTimes(1);
      expect(onFrame).toHaveBeenCalledTimes(1);
      runFrame(232);
      expect(tickRuntime).toHaveBeenCalledTimes(2);
      expect(tickRuntime).toHaveBeenLastCalledWith(0.016);
      expect(onFrame).toHaveBeenLastCalledWith(16, 0);
    },
  );

  it('leaves simulation ticks under fixed-step capture ownership', () => {
    let nextFrame: FrameRequestCallback | undefined;
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      nextFrame = callback;
      return 1;
    }));
    const tickRuntime = vi.fn();
    useEditorStore.setState({ tickRuntime, setRuntimeKey: vi.fn() });
    configureCinematicCapture(true);
    renderRuntime();

    act(() => nextFrame!(performance.now() + 16));
    expect(tickRuntime).not.toHaveBeenCalled();

    configureCinematicCapture(false);
    act(() => nextFrame!(performance.now() + 32));
    expect(tickRuntime).toHaveBeenCalledTimes(1);
  });
});
