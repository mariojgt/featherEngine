import { useMemo } from 'react';
import { Music2, Volume2 } from 'lucide-react';
import { useEditorStore } from '../store/editorStore';

function audioName(id: string | undefined, assets: Array<{ id: string; name: string }>) {
  if (!id) return 'None';
  return assets.find((asset) => asset.id === id)?.name ?? 'Missing audio asset';
}

export function SceneSettingsPanel() {
  const activeSceneId = useEditorStore((state) => state.activeSceneId);
  const scene = useEditorStore((state) => state.scenes.find((item) => item.id === state.activeSceneId));
  const objectCount = useEditorStore((state) => state.scenes.find((item) => item.id === state.activeSceneId)?.objects.length ?? 0);
  const assets = useEditorStore((state) => state.assets);
  const renameScene = useEditorStore((state) => state.renameScene);
  const setSceneAudio = useEditorStore((state) => state.setSceneAudio);
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const audioAssets = useMemo(() => assets.filter((asset) => asset.type === 'audio'), [assets]);

  if (!scene) {
    return (
      <aside className="panel scene-settings-panel">
        <div className="empty-state compact">No active scene.</div>
      </aside>
    );
  }

  return (
    <aside className="panel scene-settings-panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Scene</span>
          <h2>{scene.name}</h2>
        </div>
      </div>

      <section className="inspector-section">
        <h3>Settings</h3>
        <label className="field-row">
          <span>Name</span>
          <input value={scene.name} onChange={(event) => renameScene(scene.id, event.target.value)} />
        </label>
        <div className="script-card scene-summary-card">
          <div>
            <span>{objectCount} objects</span>
          </div>
          <p>Scene id: {activeSceneId}</p>
        </div>
      </section>

      <section className="inspector-section">
        <h3>Audio</h3>
        <p className="field-hint">Ambient and music are scene-level loops. They start when Play begins and stop when Play ends.</p>

        <label className="field-row">
          <span><Volume2 size={13} aria-hidden /> Ambient</span>
          <select
            value={scene.ambientSoundId ?? ''}
            onChange={(event) => setSceneAudio(scene.id, { ambientSoundId: event.target.value || undefined })}
          >
            <option value="">None</option>
            {audioAssets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field-row">
          <span><Music2 size={13} aria-hidden /> Music</span>
          <select
            value={scene.musicSoundId ?? ''}
            onChange={(event) => setSceneAudio(scene.id, { musicSoundId: event.target.value || undefined })}
          >
            <option value="">None</option>
            {audioAssets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.name}
              </option>
            ))}
          </select>
        </label>

        {audioAssets.length === 0 && <p className="field-hint">Import MP3/WAV assets into the Project browser to assign scene audio.</p>}

        <div className="scene-audio-readout">
          <div>
            <span>Ambient</span>
            <strong>{audioName(scene.ambientSoundId, audioAssets)}</strong>
          </div>
          <div>
            <span>Music</span>
            <strong>{audioName(scene.musicSoundId, audioAssets)}</strong>
          </div>
        </div>

        <p className={isPlaying ? 'scene-audio-status active' : 'scene-audio-status'}>
          {isPlaying ? 'Scene audio is playing.' : 'Press Play to hear scene audio.'}
        </p>
      </section>
    </aside>
  );
}
