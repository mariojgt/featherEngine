/**
 * UI entrance/looping animations for the DOM backend.
 *
 * Elements carry an optional `animation` ({type,duration,delay,easing,loop}); the renderer turns it
 * into a CSS `animation` shorthand referencing one of the keyframes below. The keyframes are injected
 * once per host (HUD overlay / world widget / editor preview) via `<style>{UI_ANIMATION_CSS}</style>`.
 *
 * Kept CSS-only (no JS tweening) so it's cheap and never touches the per-frame React tree.
 */
import type { CSSProperties } from 'react';
import type { UIAnimation } from '../types';

export const UI_ANIMATION_KEYFRAMES: Record<UIAnimation['type'], string> = {
  fade: '@keyframes nf-ui-fade { from { opacity: 0 } to { opacity: 1 } }',
  scale: '@keyframes nf-ui-scale { from { opacity: 0; transform: scale(0.85) } to { opacity: 1; transform: scale(1) } }',
  pop: '@keyframes nf-ui-pop { 0% { opacity: 0; transform: scale(0.6) } 60% { transform: scale(1.08) } 100% { opacity: 1; transform: scale(1) } }',
  slideUp: '@keyframes nf-ui-slideUp { from { opacity: 0; transform: translateY(24px) } to { opacity: 1; transform: translateY(0) } }',
  slideDown: '@keyframes nf-ui-slideDown { from { opacity: 0; transform: translateY(-24px) } to { opacity: 1; transform: translateY(0) } }',
  slideLeft: '@keyframes nf-ui-slideLeft { from { opacity: 0; transform: translateX(24px) } to { opacity: 1; transform: translateX(0) } }',
  slideRight: '@keyframes nf-ui-slideRight { from { opacity: 0; transform: translateX(-24px) } to { opacity: 1; transform: translateX(0) } }',
  pulse: '@keyframes nf-ui-pulse { 0%,100% { transform: scale(1) } 50% { transform: scale(1.06) } }',
  spin: '@keyframes nf-ui-spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }',
};

/** All keyframes concatenated — render once inside the host so every animated element can use them. */
export const UI_ANIMATION_CSS = Object.values(UI_ANIMATION_KEYFRAMES).join('\n');

const NAME: Record<UIAnimation['type'], string> = {
  fade: 'nf-ui-fade',
  scale: 'nf-ui-scale',
  pop: 'nf-ui-pop',
  slideUp: 'nf-ui-slideUp',
  slideDown: 'nf-ui-slideDown',
  slideLeft: 'nf-ui-slideLeft',
  slideRight: 'nf-ui-slideRight',
  pulse: 'nf-ui-pulse',
  spin: 'nf-ui-spin',
};

/** Build the inline CSS for an element's animation (returns {} when none). */
export function animationStyle(anim: UIAnimation | undefined): CSSProperties {
  if (!anim) return {};
  const duration = anim.duration ?? 0.3;
  const delay = anim.delay ?? 0;
  const easing = anim.easing ?? 'ease-out';
  const iteration = anim.loop ? 'infinite' : '1';
  return {
    animationName: NAME[anim.type],
    animationDuration: `${duration}s`,
    animationDelay: `${delay}s`,
    animationTimingFunction: anim.type === 'spin' ? (anim.loop ? 'linear' : easing) : easing,
    animationIterationCount: iteration,
    animationFillMode: 'both',
  };
}

export const UI_ANIMATION_TYPES: UIAnimation['type'][] = [
  'fade',
  'scale',
  'pop',
  'slideUp',
  'slideDown',
  'slideLeft',
  'slideRight',
  'pulse',
  'spin',
];
