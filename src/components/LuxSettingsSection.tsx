import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { LuxRoom, LuxSettings } from '../types';
import { selectActiveSceneEnvironment, useEditorStore } from '../store/editorStore';
import { getLuxStatus, type LuxStatus } from '../three/lux/cache';
import { luxBudget, MAX_LUX_ROOMS, resolveLux } from '../three/lux/settings';

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
  const updateRoom = (id: string, patch: Partial<LuxRoom>) => update({ rooms: s.rooms.map((room) => room.id === id ? { ...room, ...patch } : room) });
  const numeric = (key: 'radius' | 'indirectIntensity' | 'reflectionIntensity' | 'updateInterval' | 'smoothing', label: string, min: number, max: number, step: number) => (
    <label className="field-row"><span>{label}</span><input type="number" min={min} max={max} step={step} value={s[key]} onChange={(e) => { if (e.target.value !== '') update({ [key]: Number(e.target.value) }); }} /></label>
  );
  return (
    <section className="inspector-section lux-settings" aria-label="Lux 2.0 lighting">
      <h3><Sparkles size={14} aria-hidden /> Lux 2.0</h3>
      <p className="field-hint">Dynamic color bounce and local reflections. No light baking required.</p>
      <label className="field-row"><span>Enable Lux</span><input type="checkbox" checked={s.enabled} onChange={(e) => update({ enabled: e.target.checked })} /></label>
      {s.enabled && <>
        <label className="field-row"><span>Lux quality</span><select value={s.quality} onChange={(e) => update({ quality: e.target.value as LuxSettings['quality'] })}>
          <option value="auto">Match engine quality</option><option value="performance">Performance</option><option value="balanced">Balanced</option><option value="cinematic">Cinematic</option>
        </select></label>
        <label className="field-row"><span>Capture location</span><select value={s.mode} onChange={(e) => update({ mode: e.target.value as LuxSettings['mode'] })}>
          <option value="camera">Follow camera</option><option value="fixed">Fixed position</option><option value="rooms">Rooms</option>
        </select></label>
        {s.mode === 'rooms' && <>
          <p className="field-hint">Set each room's centre and size. Captures are placed at the centre automatically; overlapping edges blend. Use Show coverage to line up the bounds with your walls.</p>
          {s.rooms.map((room, index) => <fieldset key={room.id} className="lux-room-settings">
            <legend>{room.name}</legend>
            <label className="field-row"><span>Name</span><input aria-label={`Room ${index + 1} name`} value={room.name} onChange={(e) => updateRoom(room.id, { name: e.target.value })} /></label>
            {(['center', 'size'] as const).map((key) => <div key={key}>
              <span className="field-hint">{key === 'center' ? 'Centre' : 'Size'}</span>
              <div className="creator-vector-inputs">{['X', 'Y', 'Z'].map((axis, i) => <label key={axis}>{axis}<input aria-label={`Room ${index + 1} ${key} ${axis}`} type="number" step="0.5" min={key === 'size' ? 0.5 : undefined} value={room[key][i]} onChange={(e) => { if (!e.target.value) return; const vector = [...room[key]] as LuxRoom['center']; vector[i] = Number(e.target.value); updateRoom(room.id, { [key]: vector }); }} /></label>)}</div>
            </div>)}
            <label className="field-row"><span>Blend at edges</span><input aria-label={`Room ${index + 1} blend distance`} type="number" min="0.01" step="0.1" value={room.blendDistance} onChange={(e) => updateRoom(room.id, { blendDistance: Number(e.target.value) })} /></label>
            <label className="field-row"><span>Automatic capture position</span><input type="checkbox" checked={!room.capturePosition} onChange={(e) => updateRoom(room.id, { capturePosition: e.target.checked ? undefined : [...room.center] })} /></label>
            {room.capturePosition && <div className="creator-vector-inputs">{['X', 'Y', 'Z'].map((axis, i) => <label key={axis}>{axis}<input aria-label={`Room ${index + 1} capture ${axis}`} type="number" step="0.5" value={room.capturePosition![i]} onChange={(e) => { const position = [...room.capturePosition!] as LuxRoom['center']; position[i] = Number(e.target.value); updateRoom(room.id, { capturePosition: position }); }} /></label>)}</div>}
            <button className="prefs-primary-button" onClick={() => update({ rooms: s.rooms.filter((r) => r.id !== room.id) })}>Remove room</button>
            <p className="field-hint">{status?.rooms?.find((r) => r.id === room.id)?.state ?? 'Waiting for capture'}</p>
          </fieldset>)}
          <button className="prefs-primary-button" disabled={s.rooms.length >= MAX_LUX_ROOMS} onClick={() => update({ rooms: [...s.rooms, { id: crypto.randomUUID(), name: `Room ${s.rooms.length + 1}`, center: [s.rooms.length * 10, 2, 0], size: [10, 4, 10], blendDistance: 0.5 }] })}>Add room ({s.rooms.length}/{MAX_LUX_ROOMS})</button>
          <label className="field-row"><span>Check walls and obstacles</span><input type="checkbox" checked={s.roomOcclusion} onChange={(e) => update({ roomOcclusion: e.target.checked })} /></label>
        </>}
        {s.mode === 'fixed' && <div className="creator-vector-inputs">{['X', 'Y', 'Z'].map((axis, i) => <label key={axis}>{axis}<input aria-label={`Lux position ${axis}`} type="number" step="0.5" value={s.position[i]} onChange={(e) => { const position = [...s.position] as LuxSettings['position']; position[i] = Number(e.target.value); update({ position }); }} /></label>)}</div>}
        {s.mode !== 'rooms' && numeric('radius', 'Coverage radius', 2, 200, 1)}
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
        {status?.captures ? <p className="field-hint">{s.mode === 'rooms' ? 'All rooms share one capture face per frame, including wall checks.' : `Last capture CPU submission: ${status.captureMs.toFixed(1)} ms across six faces + filtering.`} Updates no faster than {budget?.interval ?? 0}s.</p> : null}
        <p className="field-hint">{s.mode === 'rooms' ? 'Place captures in empty space. Room bounds stop spill outside the room; captured depth reduces light crossing interior obstacles. Thin geometry and moving objects can still show approximation errors.' : 'Coverage fades with distance. For enclosed interiors, choose Rooms to bound lighting and check walls.'}</p>
      </>}
    </section>
  );
}
