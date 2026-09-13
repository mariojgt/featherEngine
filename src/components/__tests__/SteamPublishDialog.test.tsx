import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProjectStore } from '../../store/projectStore';
import { SteamPublishDialog } from '../SteamPublishDialog';

const desktop = vi.hoisted(() => ({ enabled: false }));
vi.mock('../../platform', async (original) => ({
  ...await original<object>(), get isDesktop() { return desktop.enabled; },
  getPlatform: async () => ({ isDesktop: desktop.enabled, checkSteamTools: async () => ({ ready: true, steamcmdPath: '/sdk/steamcmd', errors: [] }) }),
}));

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
    desktop.enabled = false;
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
      lastProductionBuild: null,
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

  it('connects platform folders, shows depot mappings and blocks a failed launch', async () => {
    desktop.enabled = true;
    localStorage.setItem('feather.steam.local-setup.v1', JSON.stringify({ sdkPath: '/sdk', account: 'build_account' }));
    useProjectStore.setState({ lastProductionBuild: {
      formatVersion: 1, buildId: 'build-123', sourceHash: 'runtime', profile: { application: { productName: 'Steam Test', version: '1.2.0' } } as never,
      artifacts: [
        { target: 'windows', directory: '/exports/build/windows', depotRoot: '/exports/build/windows', executable: '/exports/build/windows/game.exe', launchTest: 'failed' },
        { target: 'linux', directory: '/exports/build/linux', depotRoot: '/exports/build/linux', executable: '/exports/build/linux/game', launchTest: 'not-run' },
      ], assetReports: {},
    } });
    act(() => root.render(<SteamPublishDialog open onClose={() => undefined} />));
    await act(async () => { await Promise.resolve(); });
    const next = [...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Continue');
    expect(next).toBeDefined();
    await act(async () => { next!.click(); await Promise.resolve(); });
    expect(document.body.textContent).toContain('windows Depot ID');
    expect(document.querySelector('input[aria-label="linux Depot ID"]')).not.toBeNull();
    expect(document.body.textContent).toContain('windows: launch test failed');
    expect(document.body.textContent).toContain('A launch check failed');
    const inputs = [...document.querySelectorAll('input')].map((input) => input.value);
    expect(inputs).toContain('/exports/build/windows');
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
