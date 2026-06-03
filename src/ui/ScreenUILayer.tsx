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
import { useEditorStore } from '../store/editorStore';
import type { UIDocument } from '../types';
import { buildUIContext } from './runtimeContext';
import { UIElementView } from './UIElementView';

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

  if (!isPlaying) return null;
  // `webgl` docs are drawn in-canvas by WebGLScreenUILayer; the DOM overlay handles the rest.
  const docs = uiDocuments.filter((doc) => doc.surface === 'screen' && doc.renderMode !== 'webgl' && visible[doc.id]);
  if (docs.length === 0) return null;

  const ctx = buildUIContext({ variables, runtimeVariableValues, runtimeObjectVariables, isPlaying });
  const resolveAssetUrl = (assetId: string) => assets.find((asset) => asset.id === assetId)?.url;

  const overridesFor = (doc: UIDocument) => scopeOverrides(textOverrides, doc.id);

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 20 }}>
      {docs.map((doc) => (
        // Each screen doc's root fills the viewport (position: relative) so its children can flow
        // OR be absolutely placed by left/top — matching what the design canvas shows.
        <div key={doc.id} style={{ position: 'absolute', inset: 0 }}>
          {doc.css ? <style>{doc.css}</style> : null}
          <UIElementView
            element={{ ...doc.root, style: { width: '100%', height: '100%', position: 'relative', ...doc.root.style } }}
            ctx={ctx}
            textOverrides={overridesFor(doc)}
            resolveAssetUrl={resolveAssetUrl}
            onButtonClick={(el) => el.onClickEvent && fireCustomEvent(el.onClickEvent)}
          />
        </div>
      ))}
    </div>
  );
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
