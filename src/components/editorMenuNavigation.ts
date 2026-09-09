import type { KeyboardEvent } from 'react';

/** Arrow-key navigation complements native Tab/Enter behavior in editor menus. */
export function handleEditorMenuKeyDown(event: KeyboardEvent<HTMLElement>) {
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
  const index = items.indexOf(document.activeElement as HTMLButtonElement);
  let next: number | undefined;
  if (event.key === 'ArrowDown') next = (index + 1) % items.length;
  if (event.key === 'ArrowUp') next = index <= 0 ? items.length - 1 : index - 1;
  if (event.key === 'Home') next = 0;
  if (event.key === 'End') next = items.length - 1;
  if (next !== undefined) { event.preventDefault(); event.stopPropagation(); items[next]?.focus(); }
}
