/**
 * Translates our flat, CSS-string `UIStyle` into @react-three/uikit component props.
 *
 * The DOM backend (`UIElementView`) consumes `UIStyle` directly as React inline styles. The WebGL
 * backend (`UIElementMesh`) can't — uikit takes numbers (pixels), percentage strings, and typed
 * enums rather than arbitrary CSS strings. This module is the single place that bridges the two so
 * a document authored once renders identically (enough) in both backends.
 *
 * Anything we can't faithfully map is dropped rather than guessed — the goal is "looks right",
 * not pixel-perfect CSS compliance (uikit is a flexbox subset, not a browser).
 */
import { withOpacity } from '@react-three/uikit';
import type { UIStyle } from '../types';

/** uikit accepts `number` (px), a `${n}%` string, or 'auto' for sizes. */
type Size = number | `${number}%` | 'auto';
/** A solid color string, or a `withOpacity(...)` signal carrying alpha (uikit has no separate *Opacity). */
export type UikitColor = string | ReturnType<typeof withOpacity>;

export interface UikitProps {
  width?: Size;
  height?: Size;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  marginTop?: number;
  marginRight?: number;
  marginBottom?: number;
  marginLeft?: number;
  display?: 'flex' | 'none';
  flexDirection?: 'row' | 'column';
  alignItems?: 'flex-start' | 'flex-end' | 'center' | 'stretch';
  justifyContent?: 'flex-start' | 'flex-end' | 'center' | 'space-between' | 'space-around' | 'space-evenly';
  gap?: number;
  backgroundColor?: UikitColor;
  color?: UikitColor;
  opacity?: number;
  borderWidth?: number;
  borderColor?: UikitColor;
  borderRadius?: number;
  fontSize?: number;
  fontWeight?: 'normal' | 'bold' | number;
  textAlign?: 'left' | 'center' | 'right';
  positionType?: 'relative' | 'absolute';
  left?: number;
  top?: number;
}

/** Build a uikit color value, folding any alpha < 1 into a `withOpacity` signal. */
export function uikitColor(color: string, alpha: number): UikitColor {
  return alpha < 1 ? withOpacity(color, alpha) : color;
}

/** Parse a CSS length like "12px", "50%" or "auto" into a uikit size. */
function parseSize(value: string | undefined): Size | undefined {
  if (value == null) return undefined;
  const v = value.trim();
  if (v === 'auto') return 'auto';
  if (v.endsWith('%')) {
    const n = Number(v.slice(0, -1));
    return Number.isFinite(n) ? (`${n}%` as Size) : undefined;
  }
  return parsePx(v);
}

/** Parse a CSS pixel length ("12px", "12") into a number; undefined if not numeric. */
function parsePx(value: string | undefined): number | undefined {
  if (value == null) return undefined;
  const n = Number(value.trim().replace(/px$/, ''));
  return Number.isFinite(n) ? n : undefined;
}

/** Expand a CSS box shorthand ("8px", "8px 16px", "1px 2px 3px 4px") to [top,right,bottom,left] px. */
function parseBox(value: string | undefined): [number, number, number, number] | undefined {
  if (value == null) return undefined;
  const parts = value.trim().split(/\s+/).map((p) => parsePx(p) ?? 0);
  if (parts.length === 0) return undefined;
  const [a, b = a, c = a, d = b] = parts;
  return [a, b, c, d];
}

/**
 * Split a CSS color into an opaque color string + alpha (uikit carries alpha separately as
 * `*Opacity`). Handles `#rgb/#rgba/#rrggbb/#rrggbbaa`, `rgb()/rgba()`, and named colors (alpha 1).
 */
export function splitColor(value: string | undefined): { color: string; alpha: number } | undefined {
  if (value == null) return undefined;
  const v = value.trim();
  if (v === 'transparent') return { color: '#000000', alpha: 0 };

  const rgba = v.match(/^rgba?\(([^)]+)\)$/i);
  if (rgba) {
    const nums = rgba[1].split(',').map((s) => Number(s.trim()));
    const [r = 0, g = 0, b = 0, a = 1] = nums;
    const hex = `#${[r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('')}`;
    return { color: hex, alpha: Number.isFinite(a) ? a : 1 };
  }

  const hexA = v.match(/^#([0-9a-f]{8})$/i);
  if (hexA) return { color: `#${hexA[1].slice(0, 6)}`, alpha: parseInt(hexA[1].slice(6, 8), 16) / 255 };

  const hex4 = v.match(/^#([0-9a-f]{4})$/i);
  if (hex4) {
    const c = hex4[1];
    return { color: `#${c[0]}${c[0]}${c[1]}${c[1]}${c[2]}${c[2]}`, alpha: parseInt(c[3] + c[3], 16) / 255 };
  }

  return { color: v, alpha: 1 }; // #rgb, #rrggbb, or a named color — fully opaque
}

/** Parse `border: "1px solid #fff"` into width + color (style keyword ignored). */
function parseBorder(value: string | undefined): { width: number; color?: string } | undefined {
  if (value == null) return undefined;
  const tokens = value.trim().split(/\s+/);
  const width = parsePx(tokens.find((t) => /px$|^\d/.test(t)));
  const colorTok = tokens.find((t) => t.startsWith('#') || t.startsWith('rgb') || /^[a-z]+$/i.test(t) === false);
  return { width: width ?? 1, color: colorTok };
}

function parseWeight(value: string | undefined): 'normal' | 'bold' | number | undefined {
  if (value == null) return undefined;
  if (value === 'bold' || value === 'normal') return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Convert a `UIStyle` into props ready to spread onto a uikit `<Container>`/`<Text>`. */
export function styleToUikit(style: UIStyle): UikitProps {
  const out: UikitProps = {};

  const w = parseSize(style.width);
  if (w !== undefined) out.width = w;
  const h = parseSize(style.height);
  if (h !== undefined) out.height = h;

  const pad = parseBox(style.padding);
  if (pad) [out.paddingTop, out.paddingRight, out.paddingBottom, out.paddingLeft] = pad;
  const mar = parseBox(style.margin);
  if (mar) [out.marginTop, out.marginRight, out.marginBottom, out.marginLeft] = mar;

  if (style.display === 'none') out.display = 'none';
  else if (style.display) out.display = 'flex'; // 'block' has no uikit analogue; flex is the closest
  if (style.flexDirection) out.flexDirection = style.flexDirection;
  if (style.alignItems) out.alignItems = style.alignItems as UikitProps['alignItems'];
  if (style.justifyContent) out.justifyContent = style.justifyContent as UikitProps['justifyContent'];
  const gap = parsePx(style.gap);
  if (gap !== undefined) out.gap = gap;

  const bg = splitColor(style.background);
  if (bg) out.backgroundColor = uikitColor(bg.color, bg.alpha);
  const col = splitColor(style.color);
  if (col) out.color = uikitColor(col.color, col.alpha);
  if (typeof style.opacity === 'number') out.opacity = style.opacity;

  const border = parseBorder(style.border);
  if (border) {
    out.borderWidth = border.width;
    const bc = splitColor(border.color);
    if (bc) out.borderColor = uikitColor(bc.color, bc.alpha);
  }
  const radius = parsePx(style.borderRadius);
  if (radius !== undefined) out.borderRadius = radius;

  const fontSize = parsePx(style.fontSize);
  if (fontSize !== undefined) out.fontSize = fontSize;
  const weight = parseWeight(style.fontWeight);
  if (weight !== undefined) out.fontWeight = weight;
  if (style.textAlign) out.textAlign = style.textAlign;

  if (style.position === 'absolute') {
    out.positionType = 'absolute';
    const left = parsePx(style.left);
    if (left !== undefined) out.left = left;
    const top = parsePx(style.top);
    if (top !== undefined) out.top = top;
  }

  return out;
}
