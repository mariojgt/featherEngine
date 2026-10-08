import { afterEach, describe, expect, it, vi } from 'vitest';
import { gamepadInput, resetGamepadInput, sampleGamepads } from '../gamepadInput';
import { resetTouchInput, touchInput } from '../touchInput';

describe('gamepad button lifecycle', () => {
  afterEach(() => {
    resetGamepadInput();
    resetTouchInput();
    vi.unstubAllGlobals();
  });

  it('releases held buttons and aliases when the last controller disconnects', () => {
    const getGamepads = vi.fn(() => [{ connected: true, axes: [0.8, 0, 0, 0], buttons: [{ pressed: true, value: 1 }] }]);
    vi.stubGlobal('navigator', { getGamepads });
    const setKey = vi.fn();
    sampleGamepads(1 / 60, setKey);
    expect(setKey.mock.calls).toEqual([['GamepadA', true], ['Space', true]]);
    sampleGamepads(1 / 60, setKey);
    expect(setKey).toHaveBeenCalledTimes(2);

    getGamepads.mockReturnValue([]);
    sampleGamepads(1 / 60, setKey);
    expect(setKey.mock.calls.slice(2)).toEqual([['GamepadA', false], ['Space', false]]);
    expect(gamepadInput.connected).toBe(false);
    expect(gamepadInput.moveX).toBe(0);
    sampleGamepads(1 / 60, setKey);
    expect(setKey).toHaveBeenCalledTimes(4);

    getGamepads.mockReturnValue([{ connected: true, axes: [], buttons: [{ pressed: true, value: 1 }] }]);
    sampleGamepads(1 / 60, setKey);
    expect(setKey.mock.calls.slice(4)).toEqual([['GamepadA', true], ['Space', true]]);
  });

  it('keeps touch movement active while releasing a disconnected controller', () => {
    const getGamepads = vi.fn(() => [{ connected: true, axes: [], buttons: [{ pressed: true, value: 1 }] }]);
    vi.stubGlobal('navigator', { getGamepads });
    const setKey = vi.fn();
    sampleGamepads(1 / 60, setKey);
    touchInput.active = true;
    touchInput.moveX = 0.6;
    touchInput.moveY = 0.8;
    getGamepads.mockReturnValue([]);
    sampleGamepads(1 / 60, setKey);
    expect(gamepadInput.moveX).toBe(0.6);
    expect(gamepadInput.throttle).toBe(0.8);
    expect(setKey).toHaveBeenLastCalledWith('Space', false);
  });
});
