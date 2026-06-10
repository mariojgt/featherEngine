/**
 * WebGL screen HUD: the uikit twin of `ScreenUILayer`. Renders every visible `surface: 'screen'`
 * document whose `renderMode` is `'webgl'` as a uikit `<Fullscreen>` overlay INSIDE the R3F canvas
 * (so it's caught by the `PostFx` EffectComposer — bloom, vignette, color grade — unlike the DOM
 * overlay which floats above the canvas).
 *
 * Mounted inside the Canvas in both the editor `Viewport` (`SceneContent`) and the player
 * `GameView` (`GameScene`), next to `WorldUIAnchor`. Only renders while `isPlaying`. Data, text
 * overrides and button → `fireCustomEvent` wiring are identical to the DOM layer.
 */
import { Container, Fullscreen } from '@react-three/uikit';
import { useEditorStore } from '../store/editorStore';
import { buildUIContext } from './runtimeContext';
import { UIElementMesh } from './UIElementMesh';

/** Reduce the global `${docId}:${elementId}` override map to `{ elementId: text }` for one doc. */
function scopeOverrides(all: Record<string, string>, docId: string): Record<string, string> {
  const prefix = `${docId}:`;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith(prefix)) out[key.slice(prefix.length)] = value;
  }
  return out;
}

export function WebGLScreenUILayer() {
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
  const docs = uiDocuments.filter((doc) => doc.surface === 'screen' && doc.renderMode === 'webgl' && visible[doc.id]);
  if (docs.length === 0) return null;

  const ctx = buildUIContext({ variables, runtimeVariableValues, runtimeObjectVariables, isPlaying });
  const resolveAssetUrl = (assetId: string) => assets.find((asset) => asset.id === assetId)?.url;

  return (
    <Fullscreen flexDirection="column" depthTest={false} renderOrder={100}>
      {docs.map((doc) => (
        // Each doc fills the overlay; children flow or place absolutely via their own styles.
        <Container key={doc.id} positionType="absolute" inset={0} width="100%" height="100%">
          <UIElementMesh
            // The root fills the overlay; its legacy `anchor` is stripped (anchors place elements WITHIN the doc).
            element={{ ...doc.root, anchor: undefined }}
            ctx={ctx}
            textOverrides={scopeOverrides(textOverrides, doc.id)}
            resolveAssetUrl={resolveAssetUrl}
            onButtonClick={(el) => el.onClickEvent && fireCustomEvent(el.onClickEvent)}
          />
        </Container>
      ))}
    </Fullscreen>
  );
}
