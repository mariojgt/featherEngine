import { mouseLook } from './mouseLook';

/**
 * Gamepad input for Play mode, shared (like `mouseLook`) as a plain module singleton so per-frame
 * polling never churns the Zustand store. `sampleGamepads` is called once per runtime tick from the
 * editor preview loop and the exported player; the analog snapshot below is read inside
 * `tickRuntime` (Get Move Input / Get Drive Input / the character + vehicle passes).
 *
 * Buttons are bridged onto the existing virtual-key system two ways:
 *  - a gamepad-specific code (`GamepadA`, `GamepadRT`, …) — bindable anywhere a key code is accepted
 *    (Key Down/Up nodes, character/vehicle key bindings);
 *  - a default alias onto the engine's standard keyboard/mouse bindings (A → Space, RT → Mouse0, …)
 *    so every template plays on a controller with zero rebinding.
 */
export const gamepadInput = {
  connected: false,
  /** Left stick with deadzone applied: right = +1, forward (stick up) = +1. */
  moveX: 0,
  moveY: 0,
  /** Analog triggers 0..1 — RT drives throttle, LT brake/reverse for vehicles. */
  throttle: 0,
  brake: 0,
};

/** Standard-mapping button order (https://w3c.github.io/gamepad/#remapping). */
const GAMEPAD_CODES = [
  'GamepadA',
  'GamepadB',
  'GamepadX',
  'GamepadY',
  'GamepadLB',
  'GamepadRB',
  'GamepadLT',
  'GamepadRT',
  'GamepadSelect',
  'GamepadStart',
  'GamepadLS',
  'GamepadRS',
  'GamepadUp',
  'GamepadDown',
  'GamepadLeft',
  'GamepadRight',
];

/** Default aliases onto the engine's stock bindings (see store/editor/defaults.ts):
 *  A=jump/handbrake, B=crouch, X=reload, Y=interact, LB=roll, LT=aim, RT=fire, LS click=sprint. */
const KEY_ALIASES: Record<number, string> = {
  0: 'Space',
  1: 'KeyC',
  2: 'KeyR',
  3: 'KeyE',
  4: 'KeyQ',
  6: 'Mouse2',
  7: 'Mouse0',
  10: 'ShiftLeft',
  12: 'ArrowUp',
  13: 'ArrowDown',
  14: 'ArrowLeft',
  15: 'ArrowRight',
};

const DEADZONE = 0.15;
/** Mouse-look pixels injected per second at full right-stick deflection (yaw feel ≈ 1.5 rad/s
 *  at the default 0.003 sensitivity). */
const LOOK_SPEED = 520;

/** Deadzone with rescale so output still sweeps the full -1..1 range. */
const dz = (v: number) => (Math.abs(v) < DEADZONE ? 0 : (v - Math.sign(v) * DEADZONE) / (1 - DEADZONE));

let prevPressed: boolean[] = [];

export function resetGamepadInput() {
  gamepadInput.connected = false;
  gamepadInput.moveX = 0;
  gamepadInput.moveY = 0;
  gamepadInput.throttle = 0;
  gamepadInput.brake = 0;
  prevPressed = [];
}

/**
 * Poll all connected gamepads (merged: max-magnitude axes, OR'd buttons), update the analog
 * snapshot, inject right-stick look into `mouseLook`, and fire key edges through `setKey`.
 * `setKey` must only be called on edges — every pressed=true call bumps the press counter.
 */
export function sampleGamepads(delta: number, setKey: (code: string, pressed: boolean) => void) {
  const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
  let moveX = 0;
  let moveY = 0;
  let lookX = 0;
  let lookY = 0;
  let throttle = 0;
  let brake = 0;
  const pressed: boolean[] = [];
  let connected = false;
  for (const pad of pads) {
    if (!pad || !pad.connected) continue;
    connected = true;
    const ax = pad.axes;
    const mx = dz(ax[0] ?? 0);
    const my = -dz(ax[1] ?? 0);
    const lx = dz(ax[2] ?? 0);
    const ly = dz(ax[3] ?? 0);
    if (Math.abs(mx) > Math.abs(moveX)) moveX = mx;
    if (Math.abs(my) > Math.abs(moveY)) moveY = my;
    if (Math.abs(lx) > Math.abs(lookX)) lookX = lx;
    if (Math.abs(ly) > Math.abs(lookY)) lookY = ly;
    for (let i = 0; i < pad.buttons.length && i < GAMEPAD_CODES.length; i += 1) {
      const button = pad.buttons[i];
      if (button.pressed || button.value > 0.5) pressed[i] = true;
      if (i === 6) brake = Math.max(brake, button.value);
      if (i === 7) throttle = Math.max(throttle, button.value);
    }
  }
  gamepadInput.connected = connected;
  gamepadInput.moveX = moveX;
  gamepadInput.moveY = moveY;
  gamepadInput.throttle = throttle;
  gamepadInput.brake = brake;
  if (!connected) {
    prevPressed = [];
    return;
  }
  // Right stick → shared mouse-look accumulator (squared response curve for fine aim near center).
  if (lookX || lookY) {
    mouseLook.dx += lookX * Math.abs(lookX) * LOOK_SPEED * delta;
    mouseLook.dy += lookY * Math.abs(lookY) * LOOK_SPEED * delta;
  }
  for (let i = 0; i < GAMEPAD_CODES.length; i += 1) {
    const now = Boolean(pressed[i]);
    if (now === Boolean(prevPressed[i])) continue;
    setKey(GAMEPAD_CODES[i], now);
    const alias = KEY_ALIASES[i];
    if (alias) setKey(alias, now);
  }
  prevPressed = pressed;
}
