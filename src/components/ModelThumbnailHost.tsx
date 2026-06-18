import { useEffect, useMemo, useState } from 'react';
import { OffscreenThumbnail } from './PrefabThumbnailer';
import { useModelThumbnails } from '../store/modelThumbnailStore';
import { useEditorStore } from '../store/editorStore';
import { defaultRenderer } from '../store/editor/defaults';
import type { SceneObject } from '../types';

/**
 * Mounted once at the app root. Drains the model-thumbnail queue one asset at a time, rendering the GLB
 * offscreen (as a one-object scene, exactly how it renders in the viewport) and capturing a PNG preview
 * for the Project browser. Same offscreen-capture path as the prefab thumbnailer.
 */
export function ModelThumbnailHost() {
  const pendingId = useModelThumbnails((state) => state.queue[0]);
  const setThumbnail = useModelThumbnails((state) => state.set);
  const asset = useEditorStore((state) => state.assets.find((item) => item.id === pendingId));
  // Guard so a single render only reports once even if useFrame fires again before unmount.
  const [capturedFor, setCapturedFor] = useState<string | null>(null);

  const renderable = Boolean(pendingId && asset && asset.type === 'model' && !asset.unresolved);

  // A queued asset that can't be rendered (deleted, wrong type, or missing file) would block the queue —
  // drop it with an empty result so the next one proceeds. Done in an effect, never during render.
  useEffect(() => {
    if (pendingId && !renderable) setThumbnail(pendingId, '');
  }, [pendingId, renderable, setThumbnail]);

  // Synthesize the same SceneObject a model becomes in the scene: a cube whose renderer points at the GLB.
  const objects = useMemo<SceneObject[]>(() => {
    if (!pendingId) return [];
    return [
      {
        id: `thumb-${pendingId}`,
        name: 'preview',
        kind: 'cube',
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        renderer: { ...defaultRenderer('cube'), modelAssetId: pendingId },
      },
    ];
  }, [pendingId]);

  if (!pendingId || !renderable) return null;

  return (
    <OffscreenThumbnail
      key={pendingId}
      objects={objects}
      onCapture={(url) => {
        if (capturedFor === pendingId) return;
        setCapturedFor(pendingId);
        setThumbnail(pendingId, url);
      }}
    />
  );
}
