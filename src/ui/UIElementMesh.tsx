/**
 * WebGL twin of `UIElementView`: renders the SAME `UIElement` tree inside the R3F canvas using
 * @react-three/uikit (flexbox layout + instanced meshes) instead of DOM. Used when a `UIDocument`
 * has `renderMode: 'webgl'` — by the screen HUD (`WebGLScreenUILayer` via uikit `<Fullscreen>`),
 * by world widgets (`WorldUIAnchor` via uikit `<Root>`), and by diegetic surfaces (render-to-texture).
 *
 * Binding resolution, text overrides and click handling are identical to the DOM renderer — only
 * the leaf rendering differs. Because it lives in WebGL it gets post-processing (bloom/glitch),
 * depth occlusion in world space, and can be mapped onto in-world geometry.
 */
import { Container, Image, Text } from '@react-three/uikit';
import type { UIElement } from '../types';
import { evalExpression, type UIExprContext } from './expression';
import { splitColor, styleToUikit, uikitColor } from './styleToUikit';

export interface UIElementMeshProps {
  element: UIElement;
  ctx: UIExprContext;
  /** Runtime text overrides keyed by element id (from ui.setText). */
  textOverrides?: Record<string, string>;
  resolveAssetUrl?: (assetId: string) => string | undefined;
  /** Fired when a button element is clicked (live HUD only). */
  onButtonClick?: (element: UIElement) => void;
}

/** Clamp a fill expression result (0..1, or 0..100 if >1) to a uikit percentage width. */
function fillToPercent(value: unknown): `${number}%` {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '0%';
  const pct = n <= 1 ? n * 100 : n;
  return `${Math.max(0, Math.min(100, pct))}%`;
}

function truthy(value: unknown): boolean {
  return typeof value === 'number' ? value !== 0 : Boolean(value);
}

export function UIElementMesh({ element, ctx, textOverrides, resolveAssetUrl, onButtonClick }: UIElementMeshProps) {
  const resolved: Partial<Record<string, unknown>> = {};
  for (const binding of element.bindings) resolved[binding.target] = evalExpression(binding.expression, ctx);

  if ('visible' in resolved && !truthy(resolved.visible)) return null;

  const props = styleToUikit(element.style);
  const disabled = 'disabled' in resolved && truthy(resolved.disabled);
  if (disabled && element.states?.disabled) Object.assign(props, styleToUikit({ ...element.style, ...element.states.disabled }));
  // uikit drives hover/active off its own pointer state — feed the per-state style overlays through.
  const hover = element.states?.hover ? styleToUikit(element.states.hover) : undefined;
  const active = element.states?.active ? styleToUikit(element.states.active) : undefined;

  // Binding overrides, mirroring UIElementView.
  if ('color' in resolved && resolved.color != null) {
    const c = splitColor(String(resolved.color));
    if (c) props.color = uikitColor(c.color, c.alpha);
  }
  if ('background' in resolved && resolved.background != null) {
    const bg = splitColor(String(resolved.background));
    if (bg) props.backgroundColor = uikitColor(bg.color, bg.alpha);
  }
  if ('width' in resolved && resolved.width != null) {
    const w = String(resolved.width);
    props.width = w.endsWith('%') ? (w as `${number}%`) : Number(w.replace(/px$/, '')) || props.width;
  }

  // WebGL-only fx. `glow` relies on the PostFx bloom pass catching bright colors (no per-element
  // change needed); `holographic`/`scanline` read as translucent panels (tint kept via authored
  // color). Full animated CRT/holo shaders are a future per-material pass.
  if (element.fx === 'holographic') props.opacity = (props.opacity ?? 1) * 0.78;
  else if (element.fx === 'scanline') props.opacity = (props.opacity ?? 1) * 0.9;

  const overridden = textOverrides?.[element.id];
  const boundText = 'text' in resolved && resolved.text != null ? String(resolved.text) : undefined;
  const text = overridden ?? boundText ?? element.text ?? '';
  // Two-way-bound controls show their live variable value (interactivity itself is DOM-only).
  const liveValue = element.valueVariable != null ? ctx.vars[element.valueVariable] : undefined;

  const childMeshes = element.children.map((child) => (
    <UIElementMesh
      key={child.id}
      element={child}
      ctx={ctx}
      textOverrides={textOverrides}
      resolveAssetUrl={resolveAssetUrl}
      onButtonClick={onButtonClick}
    />
  ));

  const content = (() => {
    switch (element.kind) {
      case 'text':
        // uikit text styling lives on the <Text> itself; layout props wrap it in a Container.
        return (
          <Container {...props}>
            <Text color={props.color} fontSize={props.fontSize} fontWeight={props.fontWeight} textAlign={props.textAlign}>
              {text}
            </Text>
            {childMeshes}
          </Container>
        );

      case 'button':
        return (
          <Container
            {...props}
            cursor={disabled ? 'default' : 'pointer'}
            hover={hover}
            active={active}
            onClick={!disabled && onButtonClick ? () => onButtonClick(element) : undefined}
            backgroundColor={props.backgroundColor ?? '#5B8CFF'}
          >
            {text ? (
              <Text color={props.color ?? '#ffffff'} fontSize={props.fontSize} fontWeight={props.fontWeight}>
                {text}
              </Text>
            ) : null}
            {childMeshes}
          </Container>
        );

      // Interactive controls are DOM-only; in WebGL they render as their nearest static readout so a
      // webgl HUD still shows the bound value (full editing requires the DOM renderer).
      case 'input':
      case 'dropdown': {
        const display = liveValue != null && String(liveValue) ? String(liveValue) : element.placeholder ?? '';
        return (
          <Container {...props} backgroundColor={props.backgroundColor ?? 'rgba(15,17,23,0.9)'}>
            <Text color={props.color ?? '#ffffff'} fontSize={props.fontSize}>
              {display}
            </Text>
            {childMeshes}
          </Container>
        );
      }

      case 'toggle': {
        const on = truthy(liveValue);
        return (
          <Container {...props} flexDirection="row" alignItems="center" gap={props.gap ?? 8}>
            <Container width={16} height={16} borderRadius={4} borderWidth={2} borderColor={props.color ?? '#ffffff'} backgroundColor={on ? props.color ?? '#ffffff' : undefined} />
            {text ? <Text color={props.color ?? '#ffffff'} fontSize={props.fontSize}>{text}</Text> : null}
            {childMeshes}
          </Container>
        );
      }

      case 'slider': {
        const min = element.min ?? 0;
        const max = element.max ?? 100;
        const n = typeof liveValue === 'number' ? liveValue : Number(liveValue);
        const pct = `${Math.max(0, Math.min(100, ((Number.isFinite(n) ? n : min) - min) / (max - min || 1) * 100))}%` as `${number}%`;
        return (
          <Container {...props} height={props.height ?? 20} justifyContent="center">
            <Container width="100%" height={6} borderRadius={3} backgroundColor="rgba(255,255,255,0.25)">
              <Container width={pct} height="100%" borderRadius={3} backgroundColor={props.color ?? '#5B8CFF'} />
            </Container>
          </Container>
        );
      }

      case 'image': {
        const src = element.assetId ? resolveAssetUrl?.(element.assetId) : undefined;
        return <Image src={src} width={props.width} height={props.height} borderRadius={props.borderRadius} />;
      }

      case 'bar': {
        const fillWidth = 'fill' in resolved ? fillToPercent(resolved.fill) : '100%';
        const fillColor = 'color' in resolved && resolved.color != null ? String(resolved.color) : '#5B8CFF';
        return (
          <Container {...props} color={undefined}>
            <Container width={fillWidth} height="100%" backgroundColor={fillColor} borderRadius={props.borderRadius} />
            {childMeshes}
          </Container>
        );
      }

      case 'scroll':
        // Scrollable list — uikit handles drag/wheel scrolling + scrollbar when overflow is 'scroll'.
        return (
          <Container {...props} overflow="scroll">
            {childMeshes}
          </Container>
        );

      case 'panel':
      default:
        return <Container {...props}>{childMeshes}</Container>;
    }
  })();

  // Screen anchor → a full-size absolute flex wrapper floating the element to its corner/edge
  // (mirrors UIElementView.anchorWrapStyle; offsets become padding so it's resolution-independent).
  const anchor = element.anchor;
  if (!anchor) return content;
  const main = (pos: typeof anchor.h | typeof anchor.v) =>
    pos === 'left' || pos === 'top' ? 'flex-start' : pos === 'right' || pos === 'bottom' ? 'flex-end' : pos === 'stretch' ? 'flex-start' : 'center';
  const column = anchor.h === 'stretch';
  return (
    <Container
      positionType="absolute"
      width="100%"
      height="100%"
      flexDirection={column ? 'column' : 'row'}
      justifyContent={column ? (anchor.v === 'stretch' ? 'flex-start' : main(anchor.v)) : main(anchor.h)}
      alignItems={column ? 'stretch' : anchor.v === 'stretch' ? 'stretch' : main(anchor.v)}
      paddingLeft={anchor.offsetX}
      paddingRight={anchor.offsetX}
      paddingTop={anchor.offsetY}
      paddingBottom={anchor.offsetY}
    >
      {content}
    </Container>
  );
}
