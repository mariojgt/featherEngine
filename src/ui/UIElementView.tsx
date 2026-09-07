import { anchorInsets } from './anchorLayout';
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
import type { UIAnchor, UIDocument, UIElement, UIStyle } from '../types';
import { evalExpression, type UIExprContext } from './expression';
import { animationStyle } from './uiAnimations';
import { UI_DOC_SCOPE_ATTR, UI_ELEMENT_ATTR, UI_ELEMENT_SRC_ATTR } from './uiCss';

export interface UIElementViewProps {
  element: UIElement;
  ctx: UIExprContext;
  /** Runtime text overrides keyed by element id (from ui.setText). */
  textOverrides?: Record<string, string>;
  /** Runtime visibility overrides keyed by element id (from ui.setVisible). When set, wins over bindings. */
  visibleOverrides?: Record<string, boolean>;
  /** Resolve an image element's asset id to a displayable URL. */
  resolveAssetUrl?: (assetId: string) => string | undefined;
  /** Fired when a button element is clicked (live HUD only; preview passes undefined). */
  onButtonClick?: (element: UIElement) => void;
  /** Fired when an interactive control edits its value (live HUD only). Host writes it to the variable. */
  onValueChange?: (element: UIElement, value: string | number | boolean) => void;
  /** Resolve a `component` element's `componentId` to the document it instances. */
  resolveComponent?: (documentId: string) => UIDocument | undefined;
  /**
   * Set when this element IS a component's root being drawn in place of an instance. The instance
   * contributes its identity and its own style/class ON TOP of the component root, and NO wrapper
   * element is emitted — an instance must not add a DOM level, or it changes the layout and the
   * CSS structure around it (flex/grid item promotion, `>` and `:nth-child` rules).
   */
  instanceOf?: { id: string; docScopeId: string; className?: string; style?: UIStyle; anchor?: UIAnchor; resolved?: Partial<Record<string, unknown>> };
  /**
   * Fallback click event supplied by an enclosing component INSTANCE. A reusable button widget
   * cannot hard-code what clicking it does — every instance means something different — so the
   * instance's own `onClickEvent` is used by any button inside it that does not define one.
   */
  inheritedClickEvent?: string;
  inheritedDisabled?: boolean;
  /**
   * Documents currently being rendered up the stack. A component that (transitively) instances
   * itself would recurse forever, so the chain is carried down and checked before descending.
   */
  componentStack?: readonly string[];
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
    ...anchorInsets(anchor),
    display: 'flex',
    flexDirection: column ? 'column' : 'row',
    justifyContent: column ? (anchor.v === 'stretch' ? 'flex-start' : main(anchor.v)) : main(anchor.h),
    alignItems: column ? 'stretch' : anchor.v === 'stretch' ? 'stretch' : main(anchor.v),
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

/** A component instance that cannot render. Deliberately visible — a blank box reads as "engine bug". */
const MISSING_COMPONENT_STYLE: CSSProperties = {
  padding: '6px 10px',
  border: '1px dashed #e0714f',
  borderRadius: 6,
  color: '#e0714f',
  fontSize: 11,
  fontFamily: 'ui-monospace, monospace',
};

export function UIElementView({
  element,
  ctx,
  textOverrides,
  visibleOverrides,
  resolveAssetUrl,
  onButtonClick,
  onValueChange,
  resolveComponent,
  componentStack,
  instanceOf,
  inheritedClickEvent,
  inheritedDisabled = false,
}: UIElementViewProps) {
  // Pointer states for interactive elements (always declared so hook order is stable).
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);

  // Runtime visibility override (ui.setVisible) wins over bind-visible expressions.
  const identity = instanceOf?.id ?? element.id;
  const forcedVisible = visibleOverrides?.[identity];
  if (forcedVisible === false) return null;

  // Resolve this element's bindings into a small map of target → value.
  const resolved: Partial<Record<string, unknown>> = {};
  for (const binding of element.bindings) {
    resolved[binding.target] = evalExpression(binding.expression, ctx);
  }

  Object.assign(resolved, instanceOf?.resolved);

  // A `visible` binding evaluating to false removes the element (and its subtree) entirely —
  // unless a runtime override forced it visible.
  if (forcedVisible !== true && 'visible' in resolved && !truthyBind(resolved.visible)) return null;

  const interactive = INTERACTIVE.has(element.kind);
  const disabled = inheritedDisabled || ('disabled' in resolved && truthyBind(resolved.disabled));

  // Base style + pointer-state overlays (hover/active/disabled), then binding overrides.
  // An instance layers its own style over the component root's, so placement set on the instance
  // (the anchor/position extraction preserved) wins over the component's defaults.
  let merged: UIStyle = instanceOf?.style ? { ...element.style, ...instanceOf.style } : element.style;
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

  const overridden = textOverrides?.[identity];
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
      visibleOverrides={visibleOverrides}
      resolveAssetUrl={resolveAssetUrl}
      onButtonClick={onButtonClick}
      onValueChange={onValueChange}
      resolveComponent={resolveComponent}
      componentStack={componentStack}
      inheritedClickEvent={inheritedClickEvent}
      inheritedDisabled={disabled}
    />
  ));

  // Tag every node with its element id. The design canvas hit-tests on it, and per-element raw CSS
  // is scoped to it — so it has to be present in Play too, not just while editing.
  // Identity comes from the INSTANCE when there is one: selection, element CSS and hit-testing all
  // address the instance, while the rendered node is the component's root.
  // Both classes apply: the component's own, plus whatever the instance adds at this site.
  const nodeClassName = [element.className, instanceOf?.className].filter(Boolean).join(' ') || undefined;
  // `data-uiel-id` is the INSTANCE (that is the element the host document owns and selects), while
  // `data-uiel-src` keeps the component root's own id so CSS attached to it still matches.
  const idAttr = instanceOf
    ? { [UI_ELEMENT_ATTR]: instanceOf.id, [UI_DOC_SCOPE_ATTR]: instanceOf.docScopeId, [UI_ELEMENT_SRC_ATTR]: element.id }
    : { [UI_ELEMENT_ATTR]: element.id };
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
          <div className={nodeClassName} style={style} {...idAttr}>
            {text}
            {children}
          </div>
        );

      case 'button':
        return (
          <button
            type="button"
            className={nodeClassName}
            style={{ border: 'none', cursor: disabled ? 'not-allowed' : 'pointer', pointerEvents: 'auto', ...style }}
            disabled={disabled}
            onClick={
              !disabled && onButtonClick
                ? () => onButtonClick(element.onClickEvent ? element : { ...element, onClickEvent: inheritedClickEvent })
                : undefined
            }
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
            className={nodeClassName}
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
            className={nodeClassName}
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
            className={nodeClassName}
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
            className={nodeClassName}
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
              className={nodeClassName}
              style={{ ...style, borderStyle: 'solid', borderWidth: inset, borderImageSource: `url(${src})`, borderImageSlice: inset, borderImageRepeat: 'stretch' } as CSSProperties}
              {...idAttr}
            />
          );
        }
        const objectFit = fit === 'contain' ? 'contain' : fit === 'cover' ? 'cover' : 'fill';
        return <img className={nodeClassName} style={{ objectFit, ...style }} src={src} alt={element.name} {...idAttr} />;
      }

      case 'bar': {
        // The element's own style is the track; a nested fill div is driven by the `fill` binding.
        const fillWidth = 'fill' in resolved ? fillToPercent(resolved.fill) : '100%';
        const fillColor = 'color' in resolved && resolved.color != null ? String(resolved.color) : '#5B8CFF';
        // The nested fill is a placeholder when nothing drives it: without a `fill` binding it is a
        // static full-width blue rectangle. On a bar whose look comes from a stylesheet (a captured
        // UI kit, or any element with a class/CSS of its own) that placeholder buries the real
        // artwork, so leave those to their CSS.
        const ownFill = !('fill' in resolved) && (!!element.className || !!element.css);
        return (
          <div className={nodeClassName} style={{ overflow: 'hidden', ...style }} {...idAttr}>
            {/* The fill is ours, not the author's, so it carries a stable class: raw CSS has no
                other way to restyle a bar's fill (e.g. a gradient instead of a flat colour). */}
            {!ownFill && (
              <div
                className="ui-bar-fill"
                style={{ width: fillWidth, height: '100%', background: fillColor, borderRadius: 'inherit', transition: 'width 0.1s linear' }}
              />
            )}
            {children}
          </div>
        );
      }

      case 'scroll':
        // A scrollable list/panel — wheel + touch scrolling, so it opts back into pointer events.
        return (
          <div className={nodeClassName} style={{ overflowY: 'auto', pointerEvents: 'auto', ...style }} {...idAttr}>
            {text}
            {children}
          </div>
        );

      case 'component': {
        // An instance of another document, rendered BY REFERENCE — so editing the component
        // updates every place it is used, which is the whole point of the kind.
        const source = element.componentId ? resolveComponent?.(element.componentId) : undefined;
        if (!source) {
          // Loud, not blank: a missing component is a broken reference the author must see.
          return (
            <div className={nodeClassName} style={{ ...MISSING_COMPONENT_STYLE, ...style }} {...idAttr}>
              {element.componentId ? 'Missing component' : 'No component set'}
            </div>
          );
        }
        if (componentStack?.includes(source.id)) {
          return (
            <div className={nodeClassName} style={{ ...MISSING_COMPONENT_STYLE, ...style }} {...idAttr}>
              Circular component: {source.name}
            </div>
          );
        }
        // Params are expressions evaluated in THIS document's context, then handed to the
        // component's own bindings as `param.<key>`.
        const params: Record<string, unknown> = {};
        for (const [key, expression] of Object.entries(element.componentParams ?? {})) {
          params[key] = evalExpression(expression, ctx);
        }
        // No wrapper: the component's ROOT is rendered directly in this slot, carrying the
        // instance's identity, class, style and anchor. An extra div here would change flex/grid
        // item promotion and break `>` / `:nth-child` rules written against the original markup.
        return (
          <UIElementView
            element={{ ...source.root, anchor: undefined }}
            ctx={{ ...ctx, params }}
            textOverrides={textOverrides}
            visibleOverrides={visibleOverrides}
            resolveAssetUrl={resolveAssetUrl}
            onButtonClick={onButtonClick}
            onValueChange={onValueChange}
            resolveComponent={resolveComponent}
            componentStack={[...(componentStack ?? []), source.id]}
            inheritedClickEvent={element.onClickEvent ?? inheritedClickEvent}
            inheritedDisabled={disabled}
            instanceOf={{
              id: identity,
              docScopeId: source.id,
              className: element.className,
              style: merged,
              resolved,
              // The enclosing instance applies its anchor once, after resolving this root.
              anchor: undefined,
            }}
          />
        );
      }

      case 'panel':
      default:
        // Containers carry text too — captured UI kits routinely put a label on a styled div, and
        // dropping it silently is how a kit ends up rendering as empty boxes.
        return (
          <div className={nodeClassName} style={style} {...idAttr}>
            {text}
            {children}
          </div>
        );
    }
  })();

  // A screen anchor floats the element to its corner/edge via a full-frame flex wrapper (the root's
  // own anchor is stripped by the hosts — anchors apply to elements inside the document).
  const anchor = instanceOf ? instanceOf.anchor ?? element.anchor : element.anchor;
  if (anchor) return <div style={anchorWrapStyle(anchor)}>{content}</div>;
  return content;
}

function truthyBind(value: unknown): boolean {
  return typeof value === 'number' ? value !== 0 : Boolean(value);
}
