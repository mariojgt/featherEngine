import { usePerformanceAssistantStore } from '../store/performanceAssistantStore';
import { useEditorStore } from '../store/editorStore';
import { performanceSuggestions } from '../performance/assistant';
import { WorkflowDialog } from './WorkflowDialog';

export function PerformanceAssistantDialog() {
  const state = usePerformanceAssistantStore();
  const isPlaying = useEditorStore(s => s.isPlaying);
  if (state.recording) return <div className="performance-recording" role="status"><strong>{state.remaining > 10 ? 'Warming up…' : 'Measuring performance…'} {state.remaining}s</strong><span>Play your usual route. The check stops Play when finished.</span><button onClick={state.cancel}>Cancel check</button></div>;
  if (!state.open) return null;
  const report = state.report;
  return <WorkflowDialog title="Performance Assistant" onClose={state.close}>
    <p>Check how this scene runs on your computer, then try changes you can restore.</p>
    <div className="workflow-actions">
      <label>Frame-rate target<select aria-label="Frame-rate target" value={state.targetFps} onChange={e => usePerformanceAssistantStore.setState({ targetFps: Number(e.target.value) as 30 | 60 | 120 })}><option value={30}>30 fps · relaxed</option><option value={60}>60 fps · smooth</option><option value={120}>120 fps · high refresh</option></select></label>
      <button className="prefs-primary-button" disabled={isPlaying} onClick={() => state.measure()}>Play and measure · 12 seconds</button>
    </div>
    <p className="workflow-muted">Two seconds to warm up, then ten seconds of fresh frames. Automatic quality changes are held during the check; render resolution can still adapt. Repeat the same route and window size when comparing.</p>
    {isPlaying && <p>Stop Play before starting a check or changing settings.</p>}
    {state.error && <p className="workflow-error" role="alert">{state.error}</p>}
    {state.preview && <section className="workflow-card workflow-preview"><h3>Preview: {state.preview.title}</h3><p>{Object.entries(state.preview.after).map(([key, value]) => `${key}: ${String(state.preview?.before[key as keyof typeof state.preview.before])} → ${String(value)}`).join(', ')}</p><p>Measure again to compare. Closing this panel restores the preview unless you keep it.</p><div className="workflow-actions"><button disabled={isPlaying} onClick={state.restoreFix}>Restore previous settings</button><button disabled={isPlaying} onClick={state.keepFix}>Keep these settings</button></div></section>}
    {report && <>
      <section className="workflow-card"><h3>{report.sceneName} · {report.targetFps} fps target</h3>
        <div className="workflow-metrics"><div><strong>{(1000 / report.averageMs).toFixed(0)}</strong><span>average fps</span></div><div><strong>{report.p95Ms.toFixed(1)} ms</strong><span>95% of frames within</span></div><div><strong>{report.missedPercent.toFixed(0)}%</strong><span>frames over budget*</span></div><div><strong>{report.stalls}</strong><span>stalls over 100 ms</span></div></div>
        <p className="workflow-muted">{report.samples.toLocaleString()} frames · simulation {report.tickMs.toFixed(1)} ms · render submission {report.renderMs.toFixed(1)} ms. CPU timings, not GPU measurements. *Includes 10% tolerance for frame pacing.</p>
        <p>Peak load: {report.peakDrawCalls.toLocaleString()} draw calls · {report.peakTriangles.toLocaleString()} triangles · {report.peakTextures} textures.</p>
        {state.previous && <p>Previous check: {(1000 / state.previous.averageMs).toFixed(0)} fps average, {state.previous.p95Ms.toFixed(1)} ms at 95%. Current check: {(1000 / report.averageMs).toFixed(0)} fps, {report.p95Ms.toFixed(1)} ms. Scene activity and camera position affect this comparison.</p>}
      </section>
      {performanceSuggestions(report).length === 0 ? <p className="workflow-success">At least 95% of measured frames met this target within the pacing tolerance. Try the busiest part of your game next.</p> : performanceSuggestions(report).map(suggestion => <section className="workflow-card" key={suggestion.id}><h3>{suggestion.title}</h3><p>{suggestion.reason}</p><p className="workflow-muted">{suggestion.tradeoff}</p>{suggestion.patch && <button disabled={isPlaying || !!state.preview} onClick={() => state.previewFix(suggestion.id)}>Preview change</button>}</section>)}
      {!!report.assets?.length && <section className="workflow-card"><h3>Largest imported models in this scene</h3><p className="workflow-muted">Source file sizes, not GPU memory. Review these models in Assets and compare prepared builds.</p><ul>{report.assets.map(asset => <li key={asset.id}>{asset.name} · {(asset.sourceBytes / 1024 / 1024).toFixed(1)} MB · {asset.triangles.toLocaleString()} triangles · {asset.textures} textures</li>)}</ul></section>}
    </>}
  </WorkflowDialog>;
}
