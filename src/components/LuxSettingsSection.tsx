import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { LuxSettings } from '../types';
import { selectActiveSceneEnvironment, useEditorStore } from '../store/editorStore';
import { getLuxStatus, type LuxStatus } from '../three/lux/cache';
import { luxBudget, resolveLux } from '../three/lux/settings';

export function LuxSettingsSection() {
  const sceneId = useEditorStore((state) => state.activeSceneId);
  const authored = useEditorStore((state) => selectActiveSceneEnvironment(state)?.lux);
  const quality = useEditorStore((state) => state.renderSettings.quality);
  const updateEnvironment = useEditorStore((state) => state.updateSceneEnvironment);
  const s = resolveLux(authored);
  const budget = luxBudget(s, quality);
  const [status, setStatus] = useState<LuxStatus>();
  useEffect(() => {
    setStatus(undefined);
    if (!s.enabled) return;
    const timer = setInterval(() => { const next = getLuxStatus(sceneId); setStatus(next ? { ...next } : undefined); }, 500);
    return () => clearInterval(timer);
  }, [sceneId, s.enabled]);
  const update = (patch: Partial<LuxSettings>) => updateEnvironment(sceneId, { lux: patch });
  const numeric = (key: 'radius' | 'indirectIntensity' | 'reflectionIntensity' | 'updateInterval' | 'smoothing', label: string, min: number, max: number, step: number) => (
    <label className="field-row"><span>{label}</span><input type="number" min={min} max={max} step={step} value={s[key]} onChange={(e) => { if (e.target.value !== '') update({ [key]: Number(e.target.value) }); }} /></label>
  );
  return (
    <section className="inspector-section lux-settings" aria-label="Lux 1.0 lighting">
      <h3><Sparkles size={14} aria-hidden /> Lux 1.0</h3>
      <p className="field-hint">Dynamic color bounce and local reflections. No light baking required.</p>
      <label className="field-row"><span>Enable Lux</span><input type="checkbox" checked={s.enabled} onChange={(e) => update({ enabled: e.target.checked })} /></label>
      {s.enabled && <>
        <label className="field-row"><span>Lux quality</span><select value={s.quality} onChange={(e) => update({ quality: e.target.value as LuxSettings['quality'] })}>
          <option value="auto">Match engine quality</option><option value="performance">Performance</option><option value="balanced">Balanced</option><option value="cinematic">Cinematic</option>
        </select></label>
        <label className="field-row"><span>Capture location</span><select value={s.mode} onChange={(e) => update({ mode: e.target.value as LuxSettings['mode'] })}>
          <option value="camera">Follow camera</option><option value="fixed">Fixed room position</option>
        </select></label>
        {s.mode === 'fixed' && <div className="creator-vector-inputs">{['X', 'Y', 'Z'].map((axis, i) => <label key={axis}>{axis}<input aria-label={`Lux position ${axis}`} type="number" step="0.5" value={s.position[i]} onChange={(e) => { const position = [...s.position] as LuxSettings['position']; position[i] = Number(e.target.value); update({ position }); }} /></label>)}</div>}
        {numeric('radius', 'Coverage radius', 2, 200, 1)}
        {numeric('indirectIntensity', 'Indirect light', 0, 3, 0.05)}
        <label className="field-row"><span>Local reflections</span><input type="checkbox" checked={s.reflections} onChange={(e) => update({ reflections: e.target.checked })} /></label>
        {s.reflections && numeric('reflectionIntensity', 'Reflection strength', 0, 3, 0.05)}
        <label className="field-row"><span>Screen reflections (Epic)</span><input type="checkbox" checked={s.screenTraces} onChange={(e) => update({ screenTraces: e.target.checked })} /></label>
        {numeric('updateInterval', 'Update interval (s)', 0.1, 10, 0.1)}
        {numeric('smoothing', 'Light smoothing (s)', 0, 2, 0.1)}
        <label className="field-row"><span>Show coverage</span><input type="checkbox" checked={s.debug} onChange={(e) => update({ debug: e.target.checked })} /></label>
        <button className="prefs-primary-button" onClick={() => update({ refreshNonce: s.refreshNonce + 1 })}>Refresh lighting</button>
        <p className="field-hint" role="status" data-lux-status={budget ? status?.state ?? 'warming' : 'suspended'}>
          {!budget ? 'Paused at Low engine quality. Choose Medium or higher to use Lux.' : status?.state === 'error' ? `Using authored lighting: ${status.error}` :
            `${budget.label} · ${budget.resolution}px · ${status?.captures ?? 0} captures · ${status?.state ?? 'warming'}${status ? ` · ${status.hdr ? 'HDR' : 'LDR diffuse only'}` : ''}`}
        </p>
        {status?.captures ? <p className="field-hint">Last capture CPU submission: {status.captureMs.toFixed(1)} ms across six faces + filtering. Updates no faster than {budget?.interval ?? 0}s.</p> : null}
        <p className="field-hint">Best within one open room. Coverage fades with distance; walls do not bound it. Keep a fixed cache inside the room. Fast motion can briefly show older lighting.</p>
      </>}
    </section>
  );
}
