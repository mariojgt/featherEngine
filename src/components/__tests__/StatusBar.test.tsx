import { act, Profiler } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { blankProject } from '../../project/serialize';
import { useEditorStore } from '../../store/editorStore';
import { StatusBar } from '../StatusBar';

describe('status bar update cadence', () => {
  let container: HTMLDivElement;
  let root: Root;
  let objectId: string;
  const initial = useEditorStore.getState();
  const commits = vi.fn();

  beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });
  afterAll(() => {
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });
  beforeEach(() => {
    vi.useFakeTimers();
    useEditorStore.getState().loadProject(blankProject('Status test'));
    objectId = useEditorStore.getState().createObjectWithProps('cube', { name: 'Mover' });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    commits.mockClear();
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    useEditorStore.setState(initial, true);
    vi.useRealTimers();
  });

  const render = () => act(() => root.render(<Profiler id="status" onRender={commits}><StatusBar /></Profiler>));
  const move = (x: number) => act(() => useEditorStore.getState().updateTransform(objectId, 'position', [x, 2, 3]));
  const position = () => container.querySelector('[title="World position (X, Y, Z)"]')?.textContent;

  it('does not commit on each moving-object tick, but still samples its latest position', () => {
    useEditorStore.setState({ isPlaying: true });
    render();
    commits.mockClear();
    for (let frame = 1; frame <= 60; frame++) move(frame);
    expect(commits).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(250));
    expect(position()).toContain('X 60');
    expect(commits).toHaveBeenCalledOnce();
    act(() => useEditorStore.setState({ isPlaying: false }));
    move(75);
    expect(position()).toContain('X 75');
    commits.mockClear();
    act(() => vi.advanceTimersByTime(1000));
    expect(commits).not.toHaveBeenCalled();
  });

  it('keeps selection changes immediate and hides single-object coordinates for multi-selection', () => {
    useEditorStore.setState({ isPlaying: true });
    render();
    act(() => useEditorStore.getState().createObjectWithProps('cube', { name: 'Other', position: [9, 8, 7] }));
    expect(container.textContent).toContain('Other');
    expect(position()).toContain('X 9');
    act(() => useEditorStore.getState().toggleSelectObject(objectId));
    expect(container.textContent).toContain('2 selected');
    expect(position()).toBeUndefined();
  });
});
