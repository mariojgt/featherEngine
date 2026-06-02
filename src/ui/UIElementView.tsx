/**
 * Shared, recursive renderer for a UI element tree. Used by the HUD overlay (`ScreenUILayer`),
 * world-space widgets (`WorldUIAnchor`) and the editor preview (`UIEditorPanel`).
 *
 * Pure presentational: it takes an element + a binding context and renders DOM. Data bindings
 * are resolved per element via the CSP-safe `evalExpression`. The host decides the context
 * (live runtime values vs. edit-time defaults) and supplies asset-URL resolution + click handling.
 */
import type { CSSProperties } from 'react';
import type { UIElement, UIStyle } from '../types';
import { evalExpression, type UIExprContext } from './expression';

export interface UIElementViewProps {
  element: UIElement;
  ctx: UIExprContext;
  /** Runtime text overrides keyed by element id (from ui.setText). */
  textOverrides?: Record<string, string>;
  /** Resolve an image element's asset id to a displayable URL. */
  resolveAssetUrl?: (assetId: string) => string | undefined;
  /** Fired when a button element is clicked (live HUD only; preview passes undefined). */
  onButtonClick?: (element: UIElement) => void;
  /** When true, tag every node with data-uiel-id for the design canvas's hit-testing. */
  editable?: boolean;
}

/** Translate our flat `UIStyle` (plus `custom`) into a React style object. */
function toCssStyle(style: UIStyle): CSSProperties {
  const { custom, ...rest } = style;
  const css: Record<string, unknown> = { ...rest };
  if (custom) for (const [key, value] of Object.entries(custom)) css[key] = value;
  return css as CSSProperties;
}

/** Clamp a fill expression result (treated as 0..1, or 0..100 if >1) to a CSS width percentage. */
function fillToPercent(value: unknown): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '0%';
  const pct = n <= 1 ? n * 100 : n;
  return `${Math.max(0, Math.min(100, pct))}%`;
}

export function UIElementView({ element, ctx, textOverrides, resolveAssetUrl, onButtonClick, editable }: UIElementViewProps) {
  // Resolve this element's bindings into a small map of target → value.
  const resolved: Partial<Record<string, unknown>> = {};
  for (const binding of element.bindings) {
    resolved[binding.target] = evalExpression(binding.expression, ctx);
  }

  // A `visible` binding evaluating to false removes the element (and its subtree) entirely.
  if ('visible' in resolved && !truthyBind(resolved.visible)) return null;

  const style = toCssStyle(element.style);
  if ('color' in resolved && resolved.color != null) style.color = String(resolved.color);
  if ('background' in resolved && resolved.background != null) style.background = String(resolved.background);
  if ('width' in resolved && resolved.width != null) style.width = String(resolved.width);

  const overridden = textOverrides?.[element.id];
  const boundText = 'text' in resolved && resolved.text != null ? String(resolved.text) : undefined;
  const text = overridden ?? boundText ?? element.text ?? '';

  const children = element.children.map((child) => (
    <UIElementView
      key={child.id}
      element={child}
      ctx={ctx}
      textOverrides={textOverrides}
      resolveAssetUrl={resolveAssetUrl}
      onButtonClick={onButtonClick}
      editable={editable}
    />
  ));

  // In the design canvas, tag every node so pointer hit-testing can resolve which element was clicked.
  const idAttr = editable ? { 'data-uiel-id': element.id } : {};

  switch (element.kind) {
    case 'text':
      return (
        <div className={element.className} style={style} {...idAttr}>
          {text}
          {children}
        </div>
      );

    case 'button':
      return (
        <button
          type="button"
          className={element.className}
          style={{ border: 'none', cursor: 'pointer', pointerEvents: 'auto', ...style }}
          onClick={onButtonClick ? () => onButtonClick(element) : undefined}
          {...idAttr}
        >
          {text}
          {children}
        </button>
      );

    case 'image': {
      const src = element.assetId ? resolveAssetUrl?.(element.assetId) : undefined;
      return <img className={element.className} style={style} src={src} alt={element.name} {...idAttr} />;
    }

    case 'bar': {
      // The element's own style is the track; a nested fill div is driven by the `fill` binding.
      const fillWidth = 'fill' in resolved ? fillToPercent(resolved.fill) : '100%';
      const fillColor = 'color' in resolved && resolved.color != null ? String(resolved.color) : '#5B8CFF';
      return (
        <div className={element.className} style={{ overflow: 'hidden', ...style }} {...idAttr}>
          <div style={{ width: fillWidth, height: '100%', background: fillColor, borderRadius: 'inherit', transition: 'width 0.1s linear' }} />
          {children}
        </div>
      );
    }

    case 'panel':
    default:
      return (
        <div className={element.className} style={style} {...idAttr}>
          {children}
        </div>
      );
  }
}

function truthyBind(value: unknown): boolean {
  return typeof value === 'number' ? value !== 0 : Boolean(value);
}
