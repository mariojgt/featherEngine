/**
 * World-space UI: renders an object's `surface: 'world'` UI document floating at the object's
 * position (e.g. a health bar over an enemy). Rendered inside the R3F Canvas in both the editor
 * `Viewport` and the player `GameView`.
 *
 * Two backends, chosen per document:
 *  - `renderMode: 'dom'` (default) → a drei `<Html>` widget. Simple, full CSS, but a DOM node that
 *    always draws on top (no depth occlusion) and costs a per-frame matrix sync per instance.
 *  - `renderMode: 'webgl'` → a @react-three/uikit `<Root>`. Depth-correct (hidden behind walls),
 *    cheap at scale, and caught by the PostFx bloom pass.
 *
 * Bindings get a `self.*` context built from the host object's instance variables, so each instance
 * shows its own data. Renders in edit mode too (with default values) so authors can place it.
 */
import { Billboard, Html, RenderTexture } from '@react-three/drei';
import { Fullscreen, Root } from '@react-three/uikit';
import { useEditorStore } from '../store/editorStore';
import type { SceneObject } from '../types';
import { buildUIContext } from './runtimeContext';
import { UIElementMesh } from './UIElementMesh';
import { UIElementView } from './UIElementView';

export function WorldUIAnchor({ object }: { object: SceneObject }) {
  const ui = object.ui;
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const doc = useEditorStore((state) => state.uiDocuments.find((d) => d.id === ui?.documentId));
  const variables = useEditorStore((state) => state.variables);
  const runtimeVariableValues = useEditorStore((state) => state.runtimeVariableValues);
  const runtimeObjectVariables = useEditorStore((state) => state.runtimeObjectVariables);
  const assets = useEditorStore((state) => state.assets);
  const setRuntimeVariableByName = useEditorStore((state) => state.setRuntimeVariableByName);

  if (!ui || !doc || doc.surface !== 'world') return null;

  const ctx = buildUIContext({ variables, runtimeVariableValues, runtimeObjectVariables, isPlaying, host: object });
  const resolveAssetUrl = (assetId: string) => assets.find((asset) => asset.id === assetId)?.url;
  const [px, py, pz] = object.transform.position;
  const [ox, oy, oz] = ui.offset;

  if (doc.renderMode === 'webgl') {
    // Diegetic: render the UI onto a flat in-world panel (monitor/terminal) via render-to-texture,
    // oriented and scaled by the host object's transform. Lit-looking, depth-correct, occludable.
    if (ui.diegetic) {
      const w = (ui.surfaceWidth ?? 1.6) * ui.scale;
      const h = (ui.surfaceHeight ?? 0.9) * ui.scale;
      // Texture resolution tracks the panel aspect so text stays crisp.
      const texH = 1024;
      const texW = Math.max(256, Math.round((w / h) * texH));
      return (
        <group position={[px + ox, py + oy, pz + oz]} rotation={object.transform.rotation}>
          <mesh>
            <planeGeometry args={[w, h]} />
            <meshBasicMaterial toneMapped={false}>
              <RenderTexture attach="map" width={texW} height={texH} anisotropy={16}>
                <Fullscreen flexDirection="column" backgroundColor="#000000">
                  <UIElementMesh element={doc.root} ctx={ctx} resolveAssetUrl={resolveAssetUrl} />
                </Fullscreen>
              </RenderTexture>
            </meshBasicMaterial>
          </mesh>
        </group>
      );
    }

    // pixelSize maps UI pixels → world units; `scale` lets authors tune size per object.
    const root = (
      <Root pixelSize={0.0045 * ui.scale} anchorX="center" anchorY="center" flexDirection="column" depthTest={!ui.billboard}>
        <UIElementMesh element={doc.root} ctx={ctx} resolveAssetUrl={resolveAssetUrl} />
      </Root>
    );
    return (
      <group position={[px + ox, py + oy, pz + oz]}>
        {ui.billboard ? <Billboard>{root}</Billboard> : root}
      </group>
    );
  }

  return (
    <group position={[px + ox, py + oy, pz + oz]}>
      <Html center transform={!ui.billboard} distanceFactor={ui.billboard ? undefined : 8} pointerEvents="none" zIndexRange={[10, 0]}>
        <div style={{ transform: `scale(${ui.scale})`, transformOrigin: 'center', pointerEvents: 'none' }}>
          {doc.css ? <style>{doc.css}</style> : null}
          <UIElementView
            element={doc.root}
            ctx={ctx}
            resolveAssetUrl={resolveAssetUrl}
            onValueChange={(el, value) => el.valueVariable && setRuntimeVariableByName(el.valueVariable, value)}
          />
        </div>
      </Html>
    </group>
  );
}
