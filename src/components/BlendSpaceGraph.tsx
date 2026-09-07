import { useMemo, useRef } from 'react';
import { blend1D, blend2D } from '../three/blendSpace';
import {
  clientToData,
  domainOf,
  PAD,
  PLOT_H,
  PLOT_W,
  snap,
  toScreenX as projectX,
  toScreenY as projectY,
  VIEW_H,
  VIEW_W,
} from './blendSpaceLayout';
import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import type { AnimatorController, AnimatorState } from '../types';

/**
 * Visual editor for a blend space: samples plotted on their parameter axes, draggable to reposition,
 * with a live cursor showing where the driving parameters currently sit and each sample sized by the
 * weight it is contributing.
 *
 * The numeric sample fields below it remain the precise input; this graph is for seeing the layout and
 * roughing it out. Weights and cursor come from the same `blend1D`/`blend2D` the renderer feeds the
 * mixer, so what the graph shows is what is posing the skeleton.
 *
 * Subscribes to the live runtime itself, like AnimatorDebugView, so the frame-rate re-render stays
 * contained here instead of reaching the xyflow state graph.
 */

export function BlendSpaceGraph({
  controller,
  state,
  labelOf,
  onMoveSample,
}: {
  controller: AnimatorController;
  state: AnimatorState;
  labelOf: (animationId: string) => string;
  onMoveSample: (index: number, next: { value: number; y?: number }) => void;
}) {
  const samples = state.blendSamples ?? [];
  const is2D = Boolean(state.blendParameterIdY);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragIndex = useRef<number | null>(null);

  // Live parameter values for whichever object this controller is driving (authored defaults outside Play).
  const liveParams = useEditorStore((store) => {
    for (const object of selectActiveObjects(store)) {
      if (object.animator?.controllerId === controller.id) {
        const live = store.runtimeAnimators[object.id];
        if (live) return live.params;
      }
    }
    return undefined;
  });

  const paramValue = (parameterId?: string): number => {
    if (!parameterId) return 0;
    const parameter = controller.parameters.find((item) => item.id === parameterId);
    const raw = liveParams?.[parameterId] ?? parameter?.defaultValue;
    if (typeof raw === 'number') return raw;
    if (typeof raw === 'boolean') return raw ? 1 : 0;
    return 0;
  };
  const paramName = (parameterId?: string): string =>
    controller.parameters.find((item) => item.id === parameterId)?.name ?? '—';

  const cursor = {
    x: paramValue(state.blendParameterId),
    y: is2D ? paramValue(state.blendParameterIdY) : 0,
  };

  const weights = useMemo(() => {
    if (!samples.length || !state.blendParameterId) return [];
    const result = is2D ? blend2D(samples, cursor.x, cursor.y) : blend1D(samples, cursor.x);
    return result.map((entry) => entry.weight);
  }, [samples, is2D, cursor.x, cursor.y, state.blendParameterId]);

  // Include the cursor in the domain so it stays visible when a parameter runs past the samples.
  const xDomain = domainOf([...samples.map((sample) => sample.value), cursor.x]);
  const yDomain = is2D ? domainOf([...samples.map((sample) => sample.y ?? 0), cursor.y]) : { min: -1, max: 1 };

  const toScreenX = (value: number) => projectX(value, xDomain);
  const toScreenY = (value: number) => projectY(value, yDomain, is2D);

  /** Maps a pointer event to data coordinates, clamped to the visible domain. */
  const toData = (event: React.PointerEvent) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return clientToData(event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height, xDomain, yDomain);
  };

  const handleMove = (event: React.PointerEvent) => {
    const index = dragIndex.current;
    if (index === null) return;
    const data = toData(event);
    if (!data) return;
    onMoveSample(index, is2D ? { value: snap(data.x), y: snap(data.y) } : { value: snap(data.x) });
  };

  const endDrag = (event: React.PointerEvent) => {
    if (dragIndex.current === null) return;
    dragIndex.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  if (!samples.length || !state.blendParameterId) return null;

  const fmt = (value: number) => (Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1));

  return (
    <div className="blendspace-graph">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        role="img"
        aria-label={`Blend space samples over ${paramName(state.blendParameterId)}${is2D ? ` and ${paramName(state.blendParameterIdY)}` : ''}`}
        onPointerMove={handleMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <rect x={PAD.left} y={PAD.top} width={PLOT_W} height={PLOT_H} className="blendspace-plot" />

        {/* Zero lines, when zero is actually in view — the natural origin for direction axes. */}
        {xDomain.min < 0 && xDomain.max > 0 && (
          <line x1={toScreenX(0)} y1={PAD.top} x2={toScreenX(0)} y2={PAD.top + PLOT_H} className="blendspace-zero" />
        )}
        {is2D && yDomain.min < 0 && yDomain.max > 0 && (
          <line x1={PAD.left} y1={toScreenY(0)} x2={PAD.left + PLOT_W} y2={toScreenY(0)} className="blendspace-zero" />
        )}
        {!is2D && (
          <line x1={PAD.left} y1={toScreenY(0)} x2={PAD.left + PLOT_W} y2={toScreenY(0)} className="blendspace-axis-line" />
        )}

        {/* Live parameter position. */}
        <line x1={toScreenX(cursor.x)} y1={PAD.top} x2={toScreenX(cursor.x)} y2={PAD.top + PLOT_H} className="blendspace-cursor-line" />
        {is2D && (
          <line x1={PAD.left} y1={toScreenY(cursor.y)} x2={PAD.left + PLOT_W} y2={toScreenY(cursor.y)} className="blendspace-cursor-line" />
        )}
        <circle cx={toScreenX(cursor.x)} cy={toScreenY(cursor.y)} r={3.5} className="blendspace-cursor" />

        {samples.map((sample, index) => {
          const weight = weights[index] ?? 0;
          const cx = toScreenX(sample.value);
          const cy = toScreenY(sample.y ?? 0);
          const active = weight > 5e-4;
          return (
            <g key={index} className={`blendspace-sample ${active ? 'active' : ''}`}>
              {/* Weight halo — an at-a-glance read of which samples are actually in the pose. */}
              {active && <circle cx={cx} cy={cy} r={4 + weight * 7} className="blendspace-sample-halo" />}
              <circle
                cx={cx}
                cy={cy}
                r={4}
                className="blendspace-sample-dot"
                onPointerDown={(event) => {
                  dragIndex.current = index;
                  event.currentTarget.ownerSVGElement?.setPointerCapture?.(event.pointerId);
                  event.stopPropagation();
                }}
              >
                <title>{`${labelOf(sample.animationId)} — ${fmt(sample.value)}${is2D ? `, ${fmt(sample.y ?? 0)}` : ''} · weight ${weight.toFixed(2)}`}</title>
              </circle>
              <text x={cx} y={cy - (active ? 6 + weight * 7 : 7)} className="blendspace-sample-label">
                {labelOf(sample.animationId)}
              </text>
            </g>
          );
        })}

        {/* Axis extents. */}
        <text x={PAD.left} y={VIEW_H - 6} className="blendspace-tick">{fmt(xDomain.min)}</text>
        <text x={PAD.left + PLOT_W} y={VIEW_H - 6} className="blendspace-tick end">{fmt(xDomain.max)}</text>
        {is2D && (
          <>
            <text x={PAD.left - 4} y={PAD.top + 4} className="blendspace-tick end">{fmt(yDomain.max)}</text>
            <text x={PAD.left - 4} y={PAD.top + PLOT_H} className="blendspace-tick end">{fmt(yDomain.min)}</text>
          </>
        )}
      </svg>
      <div className="blendspace-legend">
        <span>
          X: {paramName(state.blendParameterId)} = <strong>{fmt(cursor.x)}</strong>
        </span>
        {is2D && (
          <span>
            Y: {paramName(state.blendParameterIdY)} = <strong>{fmt(cursor.y)}</strong>
          </span>
        )}
      </div>
      <span className="field-hint">Drag a sample to move it. The ring is the live parameter position.</span>
    </div>
  );
}
