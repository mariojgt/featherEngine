import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { useProjectStore } from '../../store/projectStore';
import { SteamPublishDialog } from '../SteamPublishDialog';

describe('SteamPublishDialog', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  beforeEach(() => {
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      },
    });
    Object.defineProperty(window, 'cancelAnimationFrame', {
      configurable: true,
      value: () => undefined,
    });
    useProjectStore.setState({
      projectName: 'Steam Test',
      projectDir: '/projects/steam-test',
      lastProductionOutput: '/exports/steam-content',
    });
    act(() => {
      root = createRoot(container);
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.querySelectorAll('[data-testid="steam-publish-backdrop"]').forEach((element) => element.remove());
  });

  it('can open, close, and reopen without changing React hook order', () => {
    const onClose = () => undefined;

    act(() => root.render(<SteamPublishDialog open={false} onClose={onClose} />));
    expect(document.querySelector('[data-testid="steam-publish-dialog"]')).toBeNull();

    act(() => root.render(<SteamPublishDialog open onClose={onClose} />));
    expect(document.querySelector('[data-testid="steam-publish-dialog"]')).not.toBeNull();
    expect(document.body.textContent).toContain('Desktop app required');

    act(() => root.render(<SteamPublishDialog open={false} onClose={onClose} />));
    expect(document.querySelector('[data-testid="steam-publish-dialog"]')).toBeNull();

    act(() => root.render(<SteamPublishDialog open onClose={onClose} />));
    expect(document.querySelector('[data-testid="steam-publish-dialog"]')).not.toBeNull();
  });
});
