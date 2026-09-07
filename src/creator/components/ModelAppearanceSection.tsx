import { useState } from 'react';
import { useEditorStore } from '../../store/editorStore';
import type { SceneObject } from '../../types';

export function ModelAppearanceSection({ object }: { object: SceneObject }) {
  const assets = useEditorStore((state) => state.assets);
  const [message, setMessage] = useState('');
  const asset = assets.find((item) => item.id === object.renderer?.modelAssetId);
  const info = asset?.modelInspection;
  return <div className="creator-model-appearance">
    <label><span>Replace this mesh</span><select value="" disabled={Boolean(object.animator?.enabled || object.model?.enabled)} onChange={(event) => {
      if (!event.target.value) return;
      const result = useEditorStore.getState().replaceObjectAppearance(object.id, event.target.value);
      setMessage(result.ok ? 'Appearance added as a child. Select it to adjust its scale and position; the parent keeps its physics and gameplay.' : result.error ?? 'Could not replace appearance.');
    }}><option value="">Choose an imported model…</option>{assets.filter((item) => item.type === 'model').map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
    {object.creatorOriginalRendererEnabled !== undefined && <button type="button" onClick={() => {
      const result = useEditorStore.getState().replaceObjectAppearance(object.id, null);
      setMessage(result.ok ? 'Original mesh restored.' : result.error ?? 'Could not restore.');
    }}>Restore original mesh</button>}
    {(object.animator?.enabled || object.model?.enabled) && <p className="field-hint">Replace rigged meshes in Skeleton or Model Forge so animation mappings stay explicit.</p>}
    {info?.stats && <dl className="model-stats"><div><dt>Triangles</dt><dd>{info.stats.triangles.toLocaleString()}</dd></div><div><dt>Size (meters)</dt><dd>{info.stats.dimensions.map((n) => n.toFixed(2)).join(' × ')}</dd></div><div><dt>Textures / clips</dt><dd>{info.stats.textures} / {info.clips.length}</dd></div></dl>}
    {info?.warnings?.map((warning) => <p className="field-hint" key={warning}>{warning}</p>)}
    {asset?.originalAssetId && <p className="field-hint">Original: {assets.find((item) => item.id === asset.originalAssetId)?.name ?? 'source asset missing'}</p>}
    {message && <p className="field-hint" role="status">{message}</p>}
  </div>;
}
