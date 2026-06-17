/**
 * Player-screen HUD: a DOM overlay (sibling to the 3D canvas) that draws every visible
 * `surface: 'screen'` UI document during Play. Positioned `absolute` so it fills — and is
 * clipped to — its nearest positioned ancestor: the editor mounts it inside the Viewport's
 * `.scene-drop-zone` (so the HUD stays inside the viewport, Unreal-style), and the standalone
 * player (`Player.tsx`) mounts it full-window. It only renders while `isPlaying`.
 *
 * The overlay itself is click-through (`pointerEvents: none`) so it never steals camera input;
 * buttons opt back in (`pointerEvents: auto`, set in `UIElementView`). Button clicks fire a
 * custom runtime event, reusing the existing `event.custom` node path.
 */
import { useMemo, useState } from 'react';
import { useEditorStore } from '../store/editorStore';
import type { UIDocument } from '../types';
import { buildUIContext } from './runtimeContext';
import { UIElementView } from './UIElementView';
import { UI_ANIMATION_CSS } from './uiAnimations';
import { useUIFocusNavigation } from './useUIFocusNavigation';

export function ScreenUILayer() {
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const uiDocuments = useEditorStore((state) => state.uiDocuments);
  const visible = useEditorStore((state) => state.runtimeVisibleUI);
  const variables = useEditorStore((state) => state.variables);
  const runtimeVariableValues = useEditorStore((state) => state.runtimeVariableValues);
  const runtimeObjectVariables = useEditorStore((state) => state.runtimeObjectVariables);
  const textOverrides = useEditorStore((state) => state.runtimeUITextOverrides);
  const assets = useEditorStore((state) => state.assets);
  const fireCustomEvent = useEditorStore((state) => state.fireCustomEvent);
  const setRuntimeVariableByName = useEditorStore((state) => state.setRuntimeVariableByName);

  // Memoized on their actual inputs — the tick's identity guards keep `visible`/values stable when
  // unchanged, so these no longer allocate (or re-render the HUD tree) 60×/s.
  // `webgl` docs are drawn in-canvas by WebGLScreenUILayer; the DOM overlay handles the rest.
  const docs = useMemo(
    () => uiDocuments.filter((doc) => doc.surface === 'screen' && doc.renderMode !== 'webgl' && visible[doc.id]),
    [uiDocuments, visible],
  );
  const ctx = useMemo(
    () => buildUIContext({ variables, runtimeVariableValues, runtimeObjectVariables, isPlaying }),
    [variables, runtimeVariableValues, runtimeObjectVariables, isPlaying],
  );

  // Enable keyboard/gamepad focus navigation whenever there's an interactive control on screen.
  const [overlay, setOverlay] = useState<HTMLDivElement | null>(null);
  const navActive = isPlaying && docs.some((doc) => hasInteractive(doc));
  useUIFocusNavigation(overlay, navActive);

  if (!isPlaying || docs.length === 0) return null;
  const resolveAssetUrl = (assetId: string) => assets.find((asset) => asset.id === assetId)?.url;

  const overridesFor = (doc: UIDocument) => scopeOverrides(textOverrides, doc.id);

  return (
    <div ref={setOverlay} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 20 }}>
      <style>{UI_ANIMATION_CSS}</style>
      {docs.map((doc) => (
        // Each screen doc's root fills the viewport (position: relative) so its children can flow
        // OR be absolutely placed by left/top — matching what the design canvas shows.
        <div key={doc.id} style={{ position: 'absolute', inset: 0 }}>
          {doc.css ? <style>{doc.css}</style> : null}
          <UIElementView
            // The root fills the screen; its legacy `anchor` is stripped — anchors place elements WITHIN the doc.
            element={{ ...doc.root, anchor: undefined, style: { width: '100%', height: '100%', position: 'relative', ...doc.root.style } }}
            ctx={ctx}
            textOverrides={overridesFor(doc)}
            resolveAssetUrl={resolveAssetUrl}
            onButtonClick={(el) => el.onClickEvent && fireCustomEvent(el.onClickEvent)}
            onValueChange={(el, value) => el.valueVariable && setRuntimeVariableByName(el.valueVariable, value)}
          />
        </div>
      ))}
    </div>
  );
}

const INTERACTIVE_KINDS = new Set(['button', 'input', 'toggle', 'slider', 'dropdown']);
/** Whether a document's tree contains any focusable/interactive control (gates focus navigation). */
function hasInteractive(doc: UIDocument): boolean {
  const walk = (el: import('../types').UIElement): boolean =>
    INTERACTIVE_KINDS.has(el.kind) || el.children.some(walk);
  return walk(doc.root);
}

/** Reduce the global `${docId}:${elementId}` override map to `{ elementId: text }` for one doc. */
function scopeOverrides(all: Record<string, string>, docId: string): Record<string, string> {
  const prefix = `${docId}:`;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith(prefix)) out[key.slice(prefix.length)] = value;
  }
  return out;
}
