/**
 * World-space UI: renders an object's `surface: 'world'` UI document as a drei `<Html>` widget
 * floating at the object's position (e.g. a health bar over an enemy). Rendered inside the R3F
 * Canvas in both the editor `Viewport` and the player `GameView`.
 *
 * Bindings get a `self.*` context built from the host object's instance variables, so each
 * instance shows its own data. Renders in edit mode too (with default values) so authors can
 * place and preview the widget.
 */
import { Html } from '@react-three/drei';
import { useEditorStore } from '../store/editorStore';
import type { SceneObject } from '../types';
import { buildUIContext } from './runtimeContext';
import { UIElementView } from './UIElementView';

export function WorldUIAnchor({ object }: { object: SceneObject }) {
  const ui = object.ui;
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const doc = useEditorStore((state) => state.uiDocuments.find((d) => d.id === ui?.documentId));
  const variables = useEditorStore((state) => state.variables);
  const runtimeVariableValues = useEditorStore((state) => state.runtimeVariableValues);
  const runtimeObjectVariables = useEditorStore((state) => state.runtimeObjectVariables);
  const assets = useEditorStore((state) => state.assets);

  if (!ui || !doc || doc.surface !== 'world') return null;

  const ctx = buildUIContext({ variables, runtimeVariableValues, runtimeObjectVariables, isPlaying, host: object });
  const resolveAssetUrl = (assetId: string) => assets.find((asset) => asset.id === assetId)?.url;
  const [px, py, pz] = object.transform.position;
  const [ox, oy, oz] = ui.offset;

  return (
    <group position={[px + ox, py + oy, pz + oz]}>
      <Html center transform={!ui.billboard} distanceFactor={ui.billboard ? undefined : 8} pointerEvents="none" zIndexRange={[10, 0]}>
        <div style={{ transform: `scale(${ui.scale})`, transformOrigin: 'center', pointerEvents: 'none' }}>
          {doc.css ? <style>{doc.css}</style> : null}
          <UIElementView element={doc.root} ctx={ctx} resolveAssetUrl={resolveAssetUrl} />
        </div>
      </Html>
    </group>
  );
}
