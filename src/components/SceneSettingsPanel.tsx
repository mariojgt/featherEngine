import { useMemo } from 'react';
import { CloudFog, CloudSun, Image as ImageIcon, Music2, Sparkles, Sun, Volume2 } from 'lucide-react';
import { useEditorStore } from '../store/editorStore';
import { withSceneEnvironmentDefaults } from '../three/environmentSettings';
import type { SceneEnvironmentSettings } from '../types';
import { LIGHTING_PRESETS } from '../three/presets';

function audioName(id: string | undefined, assets: Array<{ id: string; name: string }>) {
  if (!id) return 'None';
  return assets.find((asset) => asset.id === id)?.name ?? 'Missing audio asset';
}

const num = (value: string, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export function SceneSettingsPanel() {
  const activeSceneId = useEditorStore((state) => state.activeSceneId);
  const scene = useEditorStore((state) => state.scenes.find((item) => item.id === state.activeSceneId));
  const objectCount = useEditorStore((state) => state.scenes.find((item) => item.id === state.activeSceneId)?.objects.length ?? 0);
  const assets = useEditorStore((state) => state.assets);
  const renameScene = useEditorStore((state) => state.renameScene);
  const setSceneAudio = useEditorStore((state) => state.setSceneAudio);
  const updateSceneEnvironment = useEditorStore((state) => state.updateSceneEnvironment);
  const updateRenderSettings = useEditorStore((state) => state.updateRenderSettings);
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const audioAssets = useMemo(() => assets.filter((asset) => asset.type === 'audio'), [assets]);
  const imageAssets = useMemo(() => assets.filter((asset) => asset.type === 'image'), [assets]);

  if (!scene) {
    return (
      <aside className="panel scene-settings-panel">
        <div className="empty-state compact">No active scene.</div>
      </aside>
    );
  }

  const environment = withSceneEnvironmentDefaults(scene.environment);
  const updateEnvironment = (patch: Partial<SceneEnvironmentSettings>) => updateSceneEnvironment(scene.id, patch);
  const skyPreview =
    environment.skyMode === 'procedural'
      ? `linear-gradient(180deg, ${environment.skyTopColor} 0%, ${environment.skyHorizonColor} 58%, ${environment.skyGroundColor} 100%)`
      : environment.backgroundColor;

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

      <section className="inspector-section">
        <h3>Environment</h3>
        <div className="scene-sky-preview" style={{ background: skyPreview }}>
          <span>{environment.skyMode === 'image' ? 'Panorama' : environment.skyMode === 'procedural' ? 'Procedural' : 'Color'}</span>
        </div>
        <div className="lighting-preset-library" aria-label="Lighting presets">
          <div className="preset-library-head">
            <span>
              <Sparkles size={13} aria-hidden />
              Presets
            </span>
          </div>
          <div className="preset-chip-grid">
            {LIGHTING_PRESETS.map((preset) => (
              <button
                key={preset.id}
                title={preset.description}
                onClick={() => {
                  updateSceneEnvironment(scene.id, preset.environment);
                  updateRenderSettings({ ...preset.renderSettings, colorGrade: preset.colorGrade });
                }}
              >
                <span className={`lighting-dot lighting-dot-${preset.id}`} />
                <span>{preset.name}</span>
              </button>
            ))}
          </div>
        </div>

        <label className="field-row">
          <span><CloudSun size={13} aria-hidden /> Sky</span>
          <select
            value={environment.skyMode}
            onChange={(event) => updateEnvironment({ skyMode: event.target.value as SceneEnvironmentSettings['skyMode'] })}
          >
            <option value="procedural">Procedural</option>
            <option value="color">Color</option>
            <option value="image">Image</option>
          </select>
        </label>

        {environment.skyMode === 'image' && (
          <label className="field-row">
            <span><ImageIcon size={13} aria-hidden /> Panorama</span>
            <select
              value={environment.skyTextureAssetId ?? ''}
              onChange={(event) => updateEnvironment({ skyTextureAssetId: event.target.value || undefined })}
            >
              <option value="">None</option>
              {imageAssets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="field-row">
          <span>Background</span>
          <input type="color" value={environment.backgroundColor} onChange={(event) => updateEnvironment({ backgroundColor: event.target.value })} />
        </label>

        {environment.skyMode === 'procedural' && (
          <>
            <label className="field-row">
              <span>Zenith</span>
              <input type="color" value={environment.skyTopColor} onChange={(event) => updateEnvironment({ skyTopColor: event.target.value })} />
            </label>
            <label className="field-row">
              <span>Horizon</span>
              <input type="color" value={environment.skyHorizonColor} onChange={(event) => updateEnvironment({ skyHorizonColor: event.target.value })} />
            </label>
            <label className="field-row">
              <span>Ground Tint</span>
              <input type="color" value={environment.skyGroundColor} onChange={(event) => updateEnvironment({ skyGroundColor: event.target.value })} />
            </label>
          </>
        )}

        {environment.skyMode !== 'color' && (
          <label className="field-row">
            <span>Sky Yaw</span>
            <input
              type="number"
              step={1}
              value={environment.skyRotation}
              onChange={(event) => updateEnvironment({ skyRotation: num(event.target.value, environment.skyRotation) })}
            />
          </label>
        )}

        <label className="field-row">
          <span><ImageIcon size={13} aria-hidden /> IBL Map</span>
          <select
            value={environment.environmentMapAssetId ?? ''}
            onChange={(event) => updateEnvironment({ environmentMapAssetId: event.target.value || undefined })}
            title="Image-based lighting: an equirectangular panorama/HDRI drives reflections + ambient light. Studio = built-in light rig."
          >
            <option value="">Studio (default)</option>
            {imageAssets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field-row">
          <span>Env Light</span>
          <input
            type="number"
            min={0}
            step={0.05}
            value={environment.environmentIntensity}
            onChange={(event) => updateEnvironment({ environmentIntensity: num(event.target.value, environment.environmentIntensity) })}
          />
        </label>
      </section>

      <section className="inspector-section">
        <h3>Sun & Fog</h3>
        <label className="field-row">
          <span><Sun size={13} aria-hidden /> Sun</span>
          <input type="color" value={environment.sunColor} onChange={(event) => updateEnvironment({ sunColor: event.target.value })} />
        </label>
        <label className="field-row">
          <span>Strength</span>
          <input
            type="number"
            min={0}
            step={0.05}
            value={environment.sunIntensity}
            onChange={(event) => updateEnvironment({ sunIntensity: num(event.target.value, environment.sunIntensity) })}
          />
        </label>
        <label className="field-row">
          <span>Azimuth</span>
          <input
            type="number"
            step={1}
            value={environment.sunAzimuth}
            onChange={(event) => updateEnvironment({ sunAzimuth: num(event.target.value, environment.sunAzimuth) })}
          />
        </label>
        <label className="field-row">
          <span>Elevation</span>
          <input
            type="number"
            step={1}
            value={environment.sunElevation}
            onChange={(event) => updateEnvironment({ sunElevation: num(event.target.value, environment.sunElevation) })}
          />
        </label>
        <label className="field-row">
          <span><CloudFog size={13} aria-hidden /> Fog</span>
          <input type="checkbox" checked={environment.fogEnabled} onChange={(event) => updateEnvironment({ fogEnabled: event.target.checked })} />
        </label>
        {environment.fogEnabled && (
          <>
            <label className="field-row">
              <span>Fog Color</span>
              <input type="color" value={environment.fogColor} onChange={(event) => updateEnvironment({ fogColor: event.target.value })} />
            </label>
            <label className="field-row">
              <span>Near</span>
              <input
                type="number"
                min={0}
                step={1}
                value={environment.fogNear}
                onChange={(event) => updateEnvironment({ fogNear: num(event.target.value, environment.fogNear) })}
              />
            </label>
            <label className="field-row">
              <span>Far</span>
              <input
                type="number"
                min={1}
                step={1}
                value={environment.fogFar}
                onChange={(event) => updateEnvironment({ fogFar: num(event.target.value, environment.fogFar) })}
              />
            </label>
          </>
        )}
      </section>
    </aside>
  );
}
