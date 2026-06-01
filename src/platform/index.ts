import type { Platform } from './types';
import { webPlatform } from './web';

/** True when running inside the Tauri desktop shell. */
export const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

let cached: Platform | null = null;

/** Resolve the active platform implementation (desktop on Tauri, web fallback otherwise). */
export async function getPlatform(): Promise<Platform> {
  if (cached) return cached;
  if (isDesktop) {
    const { tauriPlatform } = await import('./tauri');
    cached = tauriPlatform;
  } else {
    cached = webPlatform;
  }
  return cached;
}

export type { Platform, OpenedProject } from './types';
