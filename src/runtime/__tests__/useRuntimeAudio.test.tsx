import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssetItem } from '../../types';

const mocks = vi.hoisted(() => {
  const loopHandle = { source: null, gain: {}, panner: null, element: null, stopped: false, assetId: 'loop' };
  return {
    loopHandle,
    audioEngine: {
      cancelOneShots: vi.fn(),
      playOneShot: vi.fn(),
      startLoop: vi.fn(() => loopHandle),
      stopLoop: vi.fn(),
      updateLoop: vi.fn(),
      playBackfirePop: vi.fn(),
      playCountdownBeep: vi.fn(),
    },
  };
});

vi.mock('../audioEngine', () => ({ audioEngine: mocks.audioEngine }));

import { useEditorStore } from '../../store/editorStore';
import { useRuntimeAudio } from '../useRuntimeAudio';

const initialState = useEditorStore.getState();
const dataAsset = (id: string): AssetItem => ({
  id,
  name: `${id}.wav`,
  type: 'audio',
  size: 3,
  data: `data:audio/wav;base64,${id}`,
  createdAt: 0,
});

const RuntimeAudioHarness = () => {
  useRuntimeAudio();
  return null;
};

describe('useRuntimeAudio', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });
  afterAll(() => {
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });
  beforeEach(() => {
    vi.clearAllMocks();
    useEditorStore.setState(initialState, true);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = () => act(() => root.render(<RuntimeAudioHarness />));

  it('uses embedded data for queued cues, scene beds, and vehicle loops when url is absent', () => {
    const baseScene = initialState.scenes[0];
    useEditorStore.setState({
      activeSceneId: 'audio-scene',
      scenes: [{ ...baseScene, id: 'audio-scene', ambientSoundId: 'ambient', musicSoundId: 'music' }],
      assets: ['cue', 'ambient', 'music', 'engine', 'skid'].map(dataAsset),
      isPlaying: true,
      runtimeTime: 2,
      runtimeSoundQueue: [{ assetId: 'cue', volume: 0.7 }],
      runtimeVehicleSound: { engineId: 'engine', skidId: 'skid', rpm: 0.5, slip: 0.25 },
    });

    render();

    expect(mocks.audioEngine.playOneShot).toHaveBeenCalledWith(
      'cue',
      'data:audio/wav;base64,cue',
      undefined,
      0.7,
      1,
    );
    expect(mocks.audioEngine.startLoop).toHaveBeenCalledWith(
      'ambient',
      'data:audio/wav;base64,ambient',
      { volume: 0.35 },
    );
    expect(mocks.audioEngine.startLoop).toHaveBeenCalledWith(
      'music',
      'data:audio/wav;base64,music',
      { volume: 0.45 },
    );
    expect(mocks.audioEngine.startLoop).toHaveBeenCalledWith(
      'engine',
      'data:audio/wav;base64,engine',
      { volume: 0.3, playbackRate: 0.85 },
    );
    expect(mocks.audioEngine.startLoop).toHaveBeenCalledWith(
      'skid',
      'data:audio/wav;base64,skid',
      { volume: 0 },
    );
  });

  it('cancels synchronously on same-scene restart before playing its newly queued cue, then cancels on Stop', () => {
    useEditorStore.setState({
      isPlaying: true,
      activeSceneId: initialState.activeSceneId,
      runtimeTime: 12,
      runtimeSoundQueue: [],
      assets: [dataAsset('replay')],
    });
    render();

    act(() => useEditorStore.setState({
      runtimeTime: 0,
      runtimeSoundQueue: [{ assetId: 'replay' }],
    }));

    expect(mocks.audioEngine.cancelOneShots).toHaveBeenCalledOnce();
    expect(mocks.audioEngine.playOneShot).toHaveBeenCalledWith(
      'replay',
      'data:audio/wav;base64,replay',
      undefined,
      1,
      1,
    );
    expect(mocks.audioEngine.cancelOneShots.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.audioEngine.playOneShot.mock.invocationCallOrder[0]);

    act(() => useEditorStore.setState({ isPlaying: false }));
    expect(mocks.audioEngine.cancelOneShots).toHaveBeenCalledTimes(2);
  });

  it('cancels one-shots when the active runtime scene changes', () => {
    useEditorStore.setState({ isPlaying: true, runtimeTime: 4 });
    render();

    act(() => useEditorStore.setState({ activeSceneId: 'next-scene', runtimeTime: 0 }));

    expect(mocks.audioEngine.cancelOneShots).toHaveBeenCalledOnce();
  });
});
