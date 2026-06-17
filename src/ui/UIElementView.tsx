/**
 * Shared, recursive renderer for a UI element tree. Used by the HUD overlay (`ScreenUILayer`),
 * world-space widgets (`WorldUIAnchor`) and the editor preview (`UIEditorPanel`).
 *
 * Pure presentational: it takes an element + a binding context and renders DOM. Data bindings
 * are resolved per element via the CSP-safe `evalExpression`. The host decides the context
 * (live runtime values vs. edit-time defaults) and supplies asset-URL resolution + click handling.
 *
 * Interactive kinds (button/input/toggle/slider/dropdown) honour pointer-state styles
 * (`states.hover/active/disabled`) and, when a live `onValueChange` is supplied, two-way-bind their
 * value to a project variable (`valueVariable`) via the host.
 */
import { useState, type CSSProperties } from 'react';
import type { UIAnchor, UIElement, UIStyle } from '../types';
import { evalExpression, type UIExprContext } from './expression';
import { animationStyle } from './uiAnimations';

export interface UIElementViewProps {
  element: UIElement;
  ctx: UIExprContext;
  /** Runtime text overrides keyed by element id (from ui.setText). */
  textOverrides?: Record<string, string>;
  /** Resolve an image element's asset id to a displayable URL. */
  resolveAssetUrl?: (assetId: string) => string | undefined;
  /** Fired when a button element is clicked (live HUD only; preview passes undefined). */
  onButtonClick?: (element: UIElement) => void;
  /** Fired when an interactive control edits its value (live HUD only). Host writes it to the variable. */
  onValueChange?: (element: UIElement, value: string | number | boolean) => void;
  /** When true, tag every node with data-uiel-id for the design canvas's hit-testing. */
  editable?: boolean;
}

/** Translate our flat `UIStyle` (plus `custom`) into a React style object. */
function toCssStyle(style: UIStyle): CSSProperties {
  const { custom, gridColumns, ...rest } = style;
  const css: Record<string, unknown> = { ...rest };
  // Grid: turn our `display: 'grid'` + `gridColumns` count into equal-width columns.
  if (style.display === 'grid') css.gridTemplateColumns = `repeat(${gridColumns ?? 2}, 1fr)`;
  // Ellipsis truncation needs overflow hidden alongside textOverflow.
  if (style.textOverflow === 'ellipsis') css.overflow = 'hidden';
  if (custom) for (const [key, value] of Object.entries(custom)) css[key] = value;
  return css as CSSProperties;
}

/**
 * Map a 9-slice screen anchor onto a full-frame flex wrapper that floats the element to its
 * corner/edge/center (offsets become padding). Resolution-independent — this is what makes a HUD
 * authored once sit correctly at any viewport size. 'stretch' fills that axis.
 */
export function anchorWrapStyle(anchor: UIAnchor): CSSProperties {
  const main = (pos: UIAnchor['h'] | UIAnchor['v']) =>
    pos === 'left' || pos === 'top' ? 'flex-start' : pos === 'right' || pos === 'bottom' ? 'flex-end' : pos === 'stretch' ? 'flex-start' : 'center';
  // h-stretch flips to a column so alignItems: stretch fills the width; v keeps placing via justify.
  const column = anchor.h === 'stretch';
  return {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: column ? 'column' : 'row',
    justifyContent: column ? (anchor.v === 'stretch' ? 'flex-start' : main(anchor.v)) : main(anchor.h),
    alignItems: column ? 'stretch' : anchor.v === 'stretch' ? 'stretch' : main(anchor.v),
    padding: `${anchor.offsetY}px ${anchor.offsetX}px`,
    pointerEvents: 'none',
  };
}

/** Clamp a fill expression result (treated as 0..1, or 0..100 if >1) to a CSS width percentage. */
function fillToPercent(value: unknown): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '0%';
  const pct = n <= 1 ? n * 100 : n;
  return `${Math.max(0, Math.min(100, pct))}%`;
}

const INTERACTIVE = new Set(['button', 'input', 'toggle', 'slider', 'dropdown']);

export function UIElementView({ element, ctx, textOverrides, resolveAssetUrl, onButtonClick, onValueChange, editable }: UIElementViewProps) {
  // Pointer states for interactive elements (always declared so hook order is stable).
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);

  // Resolve this element's bindings into a small map of target → value.
  const resolved: Partial<Record<string, unknown>> = {};
  for (const binding of element.bindings) {
    resolved[binding.target] = evalExpression(binding.expression, ctx);
  }

  // A `visible` binding evaluating to false removes the element (and its subtree) entirely.
  if ('visible' in resolved && !truthyBind(resolved.visible)) return null;

  const interactive = INTERACTIVE.has(element.kind);
  const disabled = 'disabled' in resolved && truthyBind(resolved.disabled);

  // Base style + pointer-state overlays (hover/active/disabled), then binding overrides.
  let merged: UIStyle = element.style;
  if (interactive && element.states) {
    if (disabled && element.states.disabled) merged = { ...merged, ...element.states.disabled };
    else {
      if (hovered && element.states.hover) merged = { ...merged, ...element.states.hover };
      if (pressed && element.states.active) merged = { ...merged, ...element.states.active };
    }
  }
  const style = toCssStyle(merged);
  if ('color' in resolved && resolved.color != null) style.color = String(resolved.color);
  if ('background' in resolved && resolved.background != null) style.background = String(resolved.background);
  if ('width' in resolved && resolved.width != null) style.width = String(resolved.width);
  Object.assign(style, animationStyle(element.animation));

  const overridden = textOverrides?.[element.id];
  const boundText = 'text' in resolved && resolved.text != null ? String(resolved.text) : undefined;
  const text = overridden ?? boundText ?? element.text ?? '';

  // Current value for a two-way-bound control (reads the project variable by name).
  const liveValue = element.valueVariable != null ? ctx.vars[element.valueVariable] : undefined;
  const canEdit = interactive && !!onValueChange && !disabled;

  const children = element.children.map((child) => (
    <UIElementView
      key={child.id}
      element={child}
      ctx={ctx}
      textOverrides={textOverrides}
      resolveAssetUrl={resolveAssetUrl}
      onButtonClick={onButtonClick}
      onValueChange={onValueChange}
      editable={editable}
    />
  ));

  // In the design canvas, tag every node so pointer hit-testing can resolve which element was clicked.
  const idAttr = editable ? { 'data-uiel-id': element.id } : {};
  // Hover/press handlers for interactive elements with state styling.
  const stateHandlers =
    interactive && element.states
      ? {
          onPointerEnter: () => setHovered(true),
          onPointerLeave: () => {
            setHovered(false);
            setPressed(false);
          },
          onPointerDown: () => setPressed(true),
          onPointerUp: () => setPressed(false),
        }
      : {};

  const content = (() => {
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
            style={{ border: 'none', cursor: disabled ? 'not-allowed' : 'pointer', pointerEvents: 'auto', ...style }}
            disabled={disabled}
            onClick={!disabled && onButtonClick ? () => onButtonClick(element) : undefined}
            {...stateHandlers}
            {...idAttr}
          >
            {text}
            {children}
          </button>
        );

      case 'input':
        return (
          <input
            className={element.className}
            style={{ pointerEvents: 'auto', ...style }}
            placeholder={element.placeholder}
            value={liveValue != null ? String(liveValue) : ''}
            readOnly={!canEdit}
            disabled={disabled}
            onChange={canEdit ? (e) => onValueChange!(element, e.target.value) : undefined}
            {...stateHandlers}
            {...idAttr}
          />
        );

      case 'toggle': {
        const on = truthyBind(liveValue);
        return (
          <label
            className={element.className}
            style={{ cursor: canEdit ? 'pointer' : 'default', pointerEvents: 'auto', ...style }}
            tabIndex={canEdit ? 0 : undefined}
            data-ui-focusable={canEdit ? '' : undefined}
            onKeyDown={canEdit ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onValueChange!(element, !on); } } : undefined}
            {...stateHandlers}
            {...idAttr}
          >
            <span
              style={{
                width: 18,
                height: 18,
                borderRadius: 4,
                border: '2px solid currentColor',
                background: on ? 'currentColor' : 'transparent',
                flex: '0 0 auto',
                display: 'inline-block',
              }}
            />
            <input
              type="checkbox"
              checked={on}
              readOnly={!canEdit}
              disabled={disabled}
              onChange={canEdit ? (e) => onValueChange!(element, e.target.checked) : undefined}
              style={{ display: 'none' }}
            />
            {text}
            {children}
          </label>
        );
      }

      case 'slider': {
        const min = element.min ?? 0;
        const max = element.max ?? 100;
        const step = element.step ?? 1;
        const num = typeof liveValue === 'number' ? liveValue : Number(liveValue);
        return (
          <input
            type="range"
            className={element.className}
            style={{ pointerEvents: 'auto', accentColor: 'currentColor', ...style }}
            min={min}
            max={max}
            step={step}
            value={Number.isFinite(num) ? num : min}
            disabled={disabled || !canEdit}
            onChange={canEdit ? (e) => onValueChange!(element, Number(e.target.value)) : undefined}
            {...stateHandlers}
            {...idAttr}
          />
        );
      }

      case 'dropdown':
        return (
          <select
            className={element.className}
            style={{ pointerEvents: 'auto', ...style }}
            value={liveValue != null ? String(liveValue) : ''}
            disabled={disabled || !canEdit}
            onChange={canEdit ? (e) => onValueChange!(element, e.target.value) : undefined}
            {...stateHandlers}
            {...idAttr}
          >
            {(element.options ?? []).map((opt, i) => (
              <option key={`${opt}-${i}`} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        );

      case 'image': {
        const src = element.assetId ? resolveAssetUrl?.(element.assetId) : undefined;
        const fit = element.imageFit ?? 'stretch';
        // 9-slice: render as a div with border-image so corners stay fixed while edges/center stretch.
        if (fit === 'nineSlice' && src) {
          const inset = element.sliceInset ?? 12;
          return (
            <div
              className={element.className}
              style={{ ...style, borderStyle: 'solid', borderWidth: inset, borderImageSource: `url(${src})`, borderImageSlice: inset, borderImageRepeat: 'stretch' } as CSSProperties}
              {...idAttr}
            />
          );
        }
        const objectFit = fit === 'contain' ? 'contain' : fit === 'cover' ? 'cover' : 'fill';
        return <img className={element.className} style={{ objectFit, ...style }} src={src} alt={element.name} {...idAttr} />;
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

      case 'scroll':
        // A scrollable list/panel — wheel + touch scrolling, so it opts back into pointer events.
        return (
          <div className={element.className} style={{ overflowY: 'auto', pointerEvents: 'auto', ...style }} {...idAttr}>
            {children}
          </div>
        );

      case 'panel':
      default:
        return (
          <div className={element.className} style={style} {...idAttr}>
            {children}
          </div>
        );
    }
  })();

  // A screen anchor floats the element to its corner/edge via a full-frame flex wrapper (the root's
  // own anchor is stripped by the hosts — anchors apply to elements inside the document).
  if (element.anchor) return <div style={anchorWrapStyle(element.anchor)}>{content}</div>;
  return content;
}

function truthyBind(value: unknown): boolean {
  return typeof value === 'number' ? value !== 0 : Boolean(value);
}
