import { useEffect, useRef, useState } from 'react';
import { getPerfSnapshot, type PerfSnapshot } from '../runtime/perfStats';
import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import { useInstancingEnabled, toggleInstancing } from '../three/modelInstancing';

interface Counts {
  objects: number;
  scripted: number;
  dynamicBodies: number;
  lights: number;
}

const ZERO_SNAPSHOT: PerfSnapshot = {
  fps: 0,
  frameMs: { avg: 0, p95: 0, max: 0, last: 0 },
  tickMs: { avg: 0, p95: 0, max: 0, last: 0 },
  render: { calls: 0, triangles: 0, programs: 0, geometries: 0, textures: 0 },
};

function readCounts(): Counts {
  const objects = selectActiveObjects(useEditorStore.getState());
  let scripted = 0;
  let dynamicBodies = 0;
  let lights = 0;
  for (const object of objects) {
    if (object.script?.blueprintId) scripted += 1;
    if (object.physics?.enabled && object.physics.bodyType === 'dynamic') dynamicBodies += 1;
    if (object.kind === 'light') lights += 1;
  }
  return { objects: objects.length, scripted, dynamicBodies, lights };
}

const fmt = (n: number, digits = 1) => n.toFixed(digits);
const fmtInt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));

/** FPS color: green ≥55, amber ≥30, red below. */
const fpsColor = (fps: number) => (fps >= 55 ? '#5ee08a' : fps >= 30 ? '#ffd166' : '#ff6b6b');

const Row = ({ label, value }: { label: string; value: string }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
    <span style={{ opacity: 0.6 }}>{label}</span>
    <span>{value}</span>
  </div>
);

/**
 * Performance HUD. Polls the mutable perf singleton on a low-frequency timer (it does NOT
 * subscribe to the store reactively — that would add to the very re-render cost it measures).
 * Toggle with F8. Includes a stress-scene spawner so every later optimization is measurable
 * against the same load.
 */
export function PerfOverlay() {
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [snap, setSnap] = useState<PerfSnapshot>(ZERO_SNAPSHOT);
  const [counts, setCounts] = useState<Counts>({ objects: 0, scripted: 0, dynamicBodies: 0, lights: 0 });
  const stressCount = useRef(200);
  const instancingOn = useInstancingEnabled();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === 'F8') {
        event.preventDefault();
        setVisible((value) => !value);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const poll = () => {
      setSnap(getPerfSnapshot());
      setCounts(readCounts());
    };
    poll();
    const id = window.setInterval(poll, 250);
    return () => window.clearInterval(id);
  }, [visible]);

  if (!visible) return null;

  const { frameMs, tickMs, render } = snap;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 12,
        left: 12,
        zIndex: 4000,
        background: 'rgba(12,14,20,0.92)',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 8,
        padding: '10px 12px',
        font: '11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace',
        color: '#e6e9f0',
        minWidth: 188,
        boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
        userSelect: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: expanded ? 8 : 0 }}>
        <span style={{ fontWeight: 600 }}>
          <span style={{ color: fpsColor(snap.fps), fontSize: 14 }}>{fmt(snap.fps, 0)}</span>
          <span style={{ opacity: 0.5 }}> fps</span>
        </span>
        <button
          onClick={() => setExpanded((value) => !value)}
          style={{ background: 'none', border: 'none', color: '#8a93a6', cursor: 'pointer', fontSize: 11 }}
        >
          {expanded ? '▾' : '▸'}
        </button>
      </div>

      {expanded && (
        <>
          <Row label="frame" value={`${fmt(frameMs.avg)} / p95 ${fmt(frameMs.p95)}ms`} />
          <Row label="tick (sim)" value={`${fmt(tickMs.avg)} / max ${fmt(tickMs.max)}ms`} />
          <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '6px 0' }} />
          <Row label="draw calls" value={fmtInt(render.calls)} />
          <Row label="triangles" value={fmtInt(render.triangles)} />
          <Row label="programs" value={String(render.programs)} />
          <Row label="geo / tex" value={`${render.geometries} / ${render.textures}`} />
          <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '6px 0' }} />
          <Row label="objects" value={String(counts.objects)} />
          <Row label="scripted" value={String(counts.scripted)} />
          <Row label="dyn bodies" value={String(counts.dynamicBodies)} />
          <Row label="lights" value={String(counts.lights)} />
          <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '6px 0' }} />
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            {[100, 500, 1000].map((n) => (
              <button
                key={n}
                onClick={() => useEditorStore.getState().spawnStressTest(n)}
                style={{
                  flex: 1,
                  background: 'rgba(94,224,138,0.12)',
                  border: '1px solid rgba(94,224,138,0.3)',
                  borderRadius: 5,
                  color: '#9af0bb',
                  cursor: 'pointer',
                  padding: '3px 0',
                  fontSize: 10,
                }}
                title={`Spawn ${n} falling dynamic cubes`}
              >
                +{n}
              </button>
            ))}
          </div>
          <button
            onClick={toggleInstancing}
            style={{
              width: '100%',
              marginTop: 6,
              background: instancingOn ? 'rgba(94,224,138,0.18)' : 'rgba(255,255,255,0.06)',
              border: `1px solid ${instancingOn ? 'rgba(94,224,138,0.4)' : 'rgba(255,255,255,0.15)'}`,
              borderRadius: 5,
              color: instancingOn ? '#9af0bb' : '#aeb6c6',
              cursor: 'pointer',
              padding: '3px 0',
              fontSize: 10,
            }}
            title="Experimental: batch repeated static decoration models into instanced draws during Play."
          >
            instancing: {instancingOn ? 'ON' : 'off'}
          </button>
          <div style={{ marginTop: 6, opacity: 0.4, fontSize: 10 }}>F8 toggle · Play to measure sim</div>
        </>
      )}
    </div>
  );
}
