import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useEditorStore } from '../../store/editorStore';
import { useGameRuntime } from '../useGameRuntime';

it('lets HUD buttons own their clicks while canvas clicks still attack and release', () => {
  const initial = useEditorStore.getState();
  const setRuntimeKey = vi.fn();
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  useEditorStore.setState({ setRuntimeKey });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const Harness = () => {
    useGameRuntime(true);
    return <><button><span>Block</span></button><canvas /></>;
  };
  try {
    act(() => root.render(<Harness />));
    const label = container.querySelector('span')!;
    label.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    label.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 2 }));
    expect(setRuntimeKey).not.toHaveBeenCalled();
    container.querySelector('canvas')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    expect(setRuntimeKey).toHaveBeenLastCalledWith('Mouse0', true);
    // Release even over a button, so leaving the canvas while holding cannot leave attack stuck.
    label.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    expect(setRuntimeKey).toHaveBeenLastCalledWith('Mouse0', false);
  } finally {
    act(() => root.unmount());
    container.remove();
    useEditorStore.setState(initial, true);
    delete globals.IS_REACT_ACT_ENVIRONMENT;
    vi.unstubAllGlobals();
  }
});
