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
            cursor="pointer"
            onClick={onButtonClick ? () => onButtonClick(element) : undefined}
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
