import { useMemo } from 'react';
import { Activity } from 'lucide-react';
import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import { buildAnimatorDebugSnapshot } from '../store/editor/animatorDebug';
import type { AnimatorController } from '../types';

/**
 * Live readout of what an Animator is doing: active state, every parameter's value, and the clips in
 * the pose with their weights. Answers "why is my character sliding?" without console logging.
 *
 * Deliberately its own component rather than part of AnimatorEditorPanel: the runtime record is
 * replaced every Play tick, so anything subscribed to it re-renders at frame rate. Keeping that
 * subscription isolated here means the xyflow state graph next door still only re-renders when the
 * active state actually changes, which is what its own selector was carefully written to achieve.
 */
export function AnimatorDebugView({ controller }: { controller: AnimatorController }) {
  const animations = useEditorStore((state) => state.animations);
  // The live record for whichever object in the active scene this controller is driving.
  const runtime = useEditorStore((state) => {
    for (const object of selectActiveObjects(state)) {
      if (object.animator?.controllerId === controller.id) {
        const live = state.runtimeAnimators[object.id];
        if (live) return live;
      }
    }
    return undefined;
  });

  const snapshot = useMemo(
    () => buildAnimatorDebugSnapshot(controller, runtime, animations),
    [controller, runtime, animations],
  );

  const fmt = (value: number) => (Number.isFinite(value) ? value.toFixed(2) : '—');

  return (
    <div className="blueprint-card animator-debug">
      <div className="animator-debug-head">
        <strong>
          <Activity size={12} aria-hidden /> Animation Debug
        </strong>
        <span className={`animator-debug-live ${snapshot.live ? 'on' : ''}`}>{snapshot.live ? 'live' : 'preview'}</span>
      </div>

      <div className="animator-debug-state">
        <span>Current State</span>
        <strong title={snapshot.stateName}>{snapshot.stateName}</strong>
      </div>
      {snapshot.live && (
        <div className="animator-debug-kv">
          <span>Time in state</span>
          <span className="animator-debug-num">{fmt(snapshot.timeInState)}s</span>
        </div>
      )}

      {snapshot.montage && (
        <div className="animator-debug-kv">
          <span>Montage</span>
          <span className="animator-debug-num">
            {snapshot.montage.label} · {fmt(snapshot.montage.remaining)}s left
          </span>
        </div>
      )}

      {snapshot.blend && (
        <>
          <div className="animator-debug-kv">
            <span>{snapshot.blend.xName} (X)</span>
            <span className="animator-debug-num">{fmt(snapshot.blend.x)}</span>
          </div>
          {snapshot.blend.yName && (
            <div className="animator-debug-kv">
              <span>{snapshot.blend.yName} (Y)</span>
              <span className="animator-debug-num">{fmt(snapshot.blend.y ?? 0)}</span>
            </div>
          )}
        </>
      )}

      {snapshot.parameters.length > 0 && (
        <>
          <span className="animator-debug-label">Parameters</span>
          {snapshot.parameters.map((parameter) => (
            <div key={parameter.id} className="animator-debug-kv">
              <span title={parameter.name}>{parameter.name}</span>
              <span className={`animator-debug-num ${parameter.live ? 'live' : ''}`}>
                {typeof parameter.value === 'boolean' ? String(parameter.value) : fmt(parameter.value)}
              </span>
            </div>
          ))}
        </>
      )}

      {snapshot.layers.length > 0 && (
        <>
          <span className="animator-debug-label">Layers</span>
          {snapshot.layers.map((layer) => (
            <div key={layer.id} className="animator-debug-clip">
              <div className="animator-debug-clip-head">
                <span title={`${layer.name} - mask: ${layer.maskRootBones.join(', ') || 'whole skeleton'}`}>
                  {layer.name} · {layer.stateName}
                </span>
                <span className="animator-debug-num">{layer.weight.toFixed(2)}</span>
              </div>
              <div className="animator-debug-bar">
                <div
                  className="animator-debug-bar-fill"
                  style={{ width: `${Math.min(100, Math.max(0, layer.weight * 100))}%` }}
                />
              </div>
              {/* A layer at zero weight, or one whose mask matches no bone, silently does nothing —
                  showing the mask and its clips here is what makes that diagnosable. */}
              {layer.clips.map((clip) => (
                <div key={clip.animationId} className="animator-debug-kv">
                  <span title={clip.label}>{clip.label}</span>
                  <span className="animator-debug-num">{(clip.weight * layer.weight).toFixed(2)}</span>
                </div>
              ))}
            </div>
          ))}
        </>
      )}

      <span className="animator-debug-label">Active Clips</span>
      {snapshot.clips.length === 0 ? (
        <span>No clip on this state.</span>
      ) : (
        snapshot.clips.map((clip) => (
          <div key={clip.animationId} className="animator-debug-clip">
            <div className="animator-debug-clip-head">
              <span title={clip.label}>{clip.label}</span>
              <span className="animator-debug-num">{clip.weight.toFixed(2)}</span>
            </div>
            {/* Weight bar — the fastest way to see a blend go lopsided or a clip refuse to fade out. */}
            <div className="animator-debug-bar">
              <div className="animator-debug-bar-fill" style={{ width: `${Math.min(100, Math.max(0, clip.weight * 100))}%` }} />
            </div>
          </div>
        ))
      )}
    </div>
  );
}
