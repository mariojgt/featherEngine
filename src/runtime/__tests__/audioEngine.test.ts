import { afterEach, describe, expect, it, vi } from 'vitest';

class FakeNode {
  connect = vi.fn((destination: FakeNode) => destination);
  disconnect = vi.fn();
}

class FakeSource extends FakeNode {
  buffer: AudioBuffer | null = null;
  loop = false;
  playbackRate = { value: 1 };
  onended: ((event: Event) => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
}

class FakeGain extends FakeNode {
  gain = { value: 1 };
}

class FakePanner extends FakeNode {
  panningModel = 'equalpower';
  distanceModel = 'inverse';
  refDistance = 1;
  maxDistance = 10_000;
  rolloffFactor = 1;
  positionX = { value: 0 };
  positionY = { value: 0 };
  positionZ = { value: 0 };
}

type ContextHarness = {
  context: {
    sources: FakeSource[];
    gains: FakeGain[];
    panners: FakePanner[];
    decodeStarted: () => boolean;
    resolveDecode: (buffer: AudioBuffer) => void;
  };
};

const installWebAudio = (decodeImmediately = true): ContextHarness => {
  let resolveDecode = (_buffer: AudioBuffer) => {};
  let decodeStarted = false;
  const sources: FakeSource[] = [];
  const gains: FakeGain[] = [];
  const panners: FakePanner[] = [];
  class FakeAudioContext {
    state = 'running';
    currentTime = 0;
    destination = new FakeNode();
    listener = {};
    createGain = () => {
      const node = new FakeGain();
      gains.push(node);
      return node;
    };
    createPanner = () => {
      const node = new FakePanner();
      panners.push(node);
      return node;
    };
    createBufferSource = () => {
      const node = new FakeSource();
      sources.push(node);
      return node;
    };
    decodeAudioData = vi.fn(() => {
      decodeStarted = true;
      if (decodeImmediately) return Promise.resolve({ duration: 1 } as AudioBuffer);
      return new Promise<AudioBuffer>((resolve) => { resolveDecode = resolve; });
    });
  }

  vi.stubGlobal('AudioContext', FakeAudioContext);
  delete (window as typeof window & { webkitAudioContext?: unknown }).webkitAudioContext;
  vi.stubGlobal('fetch', vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(8) })));
  return {
    context: {
      sources,
      gains,
      panners,
      decodeStarted: () => decodeStarted,
      resolveDecode: (buffer: AudioBuffer) => resolveDecode(buffer),
    },
  };
};

const waitForSource = async (context: ContextHarness['context']) => {
  await vi.waitFor(() => expect(context.sources).toHaveLength(1));
  return context.sources[0];
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('AudioEngine one-shot lifecycle', () => {
  it('stops active WebAudio sources and disconnects their complete spatial graph', async () => {
    const { context } = installWebAudio();
    const { audioEngine } = await import('../audioEngine');

    audioEngine.playOneShot('score', 'data:audio/mpeg;base64,AAA', [1, 2, 3]);
    const source = await waitForSource(context);
    audioEngine.cancelOneShots();

    expect(source.stop).toHaveBeenCalledOnce();
    expect(source.disconnect).toHaveBeenCalledOnce();
    expect(context.panners[0].disconnect).toHaveBeenCalledOnce();
    expect(context.gains[1].disconnect).toHaveBeenCalledOnce();
  });

  it('disconnects source, panner, and gain when a positioned source completes naturally', async () => {
    const { context } = installWebAudio();
    const { audioEngine } = await import('../audioEngine');

    audioEngine.playOneShot('cue', '/cue.wav', [4, 5, 6]);
    const source = await waitForSource(context);
    source.onended?.(new Event('ended'));

    expect(source.disconnect).toHaveBeenCalledOnce();
    expect(context.panners[0].disconnect).toHaveBeenCalledOnce();
    expect(context.gains[1].disconnect).toHaveBeenCalledOnce();
    audioEngine.cancelOneShots();
    expect(source.stop).not.toHaveBeenCalled();
  });

  it('does not start a canceled pending decode, while allowing a new replay request sharing it', async () => {
    const { context } = installWebAudio(false);
    const { audioEngine } = await import('../audioEngine');

    audioEngine.playOneShot('score', '/score.mp3');
    await vi.waitFor(() => expect(context.decodeStarted()).toBe(true));
    audioEngine.cancelOneShots();
    audioEngine.playOneShot('score', '/score.mp3');
    context.resolveDecode({ duration: 48 } as AudioBuffer);

    const source = await waitForSource(context);
    expect(source.start).toHaveBeenCalledOnce();
    expect(context.sources).toHaveLength(1);
  });

  it('pauses, unloads, and forgets HTMLAudio fallback one-shots on cancellation', async () => {
    vi.stubGlobal('AudioContext', undefined);
    delete (window as typeof window & { webkitAudioContext?: unknown }).webkitAudioContext;
    const instances: FakeAudio[] = [];
    class FakeAudio extends EventTarget {
      src: string;
      volume = 1;
      pause = vi.fn();
      load = vi.fn();
      play = vi.fn(async () => {});
      removeAttribute = vi.fn((name: string) => { if (name === 'src') this.src = ''; });
      constructor(src: string) {
        super();
        this.src = src;
        instances.push(this);
      }
    }
    vi.stubGlobal('Audio', FakeAudio);
    const { audioEngine } = await import('../audioEngine');

    audioEngine.playOneShot('fallback', 'data:audio/wav;base64,BBB');
    expect(instances[0].play).toHaveBeenCalledOnce();
    audioEngine.cancelOneShots();
    audioEngine.cancelOneShots();

    expect(instances[0].pause).toHaveBeenCalledOnce();
    expect(instances[0].removeAttribute).toHaveBeenCalledWith('src');
    expect(instances[0].load).toHaveBeenCalledOnce();
    expect(instances[0].src).toBe('');
  });
});
