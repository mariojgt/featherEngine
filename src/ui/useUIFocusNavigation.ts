/**
 * Keyboard + gamepad focus navigation for the screen HUD (menus, settings, pause screens).
 *
 * Pro engines let a player drive UI with the d-pad/arrows and confirm with A/Enter. This hook,
 * mounted by `ScreenUILayer` while playing, gives the HUD overlay that behaviour with zero authoring:
 *   - Arrow Up/Down (and gamepad d-pad up/down) move focus between focusable controls.
 *   - Enter / gamepad-A activate the focused control (clicks buttons, toggles checkboxes).
 *   - Left/Right and text typing fall through to the browser so sliders/inputs/dropdowns edit natively.
 *
 * It reads the live DOM (`querySelectorAll` inside the overlay) so it always reflects what's actually
 * shown, and polls the gamepad directly on rAF (cheap, edge-tracked) — independent of the runtime tick.
 */
import { useEffect } from 'react';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), [data-ui-focusable]';

function focusables(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el.getClientRects().length > 0,
  );
}

export function useUIFocusNavigation(container: HTMLElement | null, enabled: boolean) {
  useEffect(() => {
    if (!enabled || !container) return;

    const move = (dir: 1 | -1) => {
      const items = focusables(container);
      if (items.length === 0) return;
      const active = document.activeElement as HTMLElement | null;
      const current = active ? items.indexOf(active) : -1;
      const next = current < 0 ? (dir === 1 ? 0 : items.length - 1) : (current + dir + items.length) % items.length;
      items[next]?.focus();
    };

    const activate = () => {
      const active = document.activeElement as HTMLElement | null;
      if (active && container.contains(active)) active.click();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        move(1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        move(-1);
      } else if (event.key === 'Enter') {
        // Let inputs submit naturally; for buttons/labels, trigger the click.
        const active = document.activeElement as HTMLElement | null;
        if (active && (active.tagName === 'BUTTON' || active.hasAttribute('data-ui-focusable'))) {
          event.preventDefault();
          activate();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);

    // Gamepad d-pad / A polling, edge-triggered so a held button moves one step.
    let raf = 0;
    let prevUp = false;
    let prevDown = false;
    let prevA = false;
    const poll = () => {
      const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
      let up = false;
      let down = false;
      let a = false;
      for (const pad of pads) {
        if (!pad || !pad.connected) continue;
        if (pad.buttons[12]?.pressed) up = true; // d-pad up
        if (pad.buttons[13]?.pressed) down = true; // d-pad down
        if (pad.buttons[0]?.pressed) a = true; // A
        // Left stick as a coarse fallback for the d-pad.
        const ly = pad.axes[1] ?? 0;
        if (ly < -0.6) up = true;
        if (ly > 0.6) down = true;
      }
      if (down && !prevDown) move(1);
      if (up && !prevUp) move(-1);
      if (a && !prevA) activate();
      prevUp = up;
      prevDown = down;
      prevA = a;
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      cancelAnimationFrame(raf);
    };
  }, [container, enabled]);
}
