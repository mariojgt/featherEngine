import { useEffect, useState } from 'react';
import { getFrameHistory, getPerfSnapshot, type PerfSnapshot, type RuntimeSection } from '../runtime/perfStats';
import { getActivePhysics } from '../runtime/physicsWorld';
import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import { useInstancingEnabled, toggleInstancing } from '../three/modelInstancing';

interface Counts {
  objects: number;
  scripted: number;
  dynamicBodies: number;
  lights: number;
}

interface PhysStats {
  bodies: number;
  sleeping: number;
  characters: number;
  joints: number;
}

interface MemStats {
  used: number; // bytes
  limit: number; // bytes
}

const ZERO_SNAPSHOT: PerfSnapshot = {
  fps: 0,
  frameMs: { avg: 0, p95: 0, max: 0, last: 0 },
  tickMs: { avg: 0, p95: 0, max: 0, last: 0 },
  sections: {
    scripts: { avg: 0, p95: 0, max: 0, last: 0 },
    physics: { avg: 0, p95: 0, max: 0, last: 0 },
    combat: { avg: 0, p95: 0, max: 0, last: 0 },
    animator: { avg: 0, p95: 0, max: 0, last: 0 },
  },
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
const fmtMB = (bytes: number) => `${Math.round(bytes / (1024 * 1024))}`;

/** FPS color: green ≥55, amber ≥30, red below. */
const fpsColor = (fps: number) => (fps >= 55 ? '#5ee08a' : fps >= 30 ? '#ffd166' : '#ff6b6b');
/** Per-frame color by frame time: ≤18ms (≈60fps) green, ≤34ms (≈30fps) amber, else red. */
const frameColor = (ms: number) => (ms <= 18 ? '#5ee08a' : ms <= 34 ? '#ffd166' : '#ff6b6b');

const SECTION_COLORS: Record<RuntimeSection, string> = {
  scripts: '#6ea8ff',
  physics: '#ffa657',
  combat: '#ff6b6b',
  animator: '#b388ff',
};

const Row = ({ label, value }: { label: string; value: string }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
    <span style={{ opacity: 0.6 }}>{label}</span>
    <span>{value}</span>
  </div>
);

/** Frame-time history as colored bars; dashed reference lines mark the 60fps (16.7ms) and 30fps (33.3ms) budgets. */
function FrameGraph({ frames }: { frames: number[] }) {
  const W = 188;
  const H = 38;
  if (!frames.length) return <div style={{ height: H, marginBottom: 6 }} />;
  const maxMs = Math.max(34, ...frames); // keep the 30fps line on-graph and give spikes headroom
  const bw = W / frames.length;
  const yFor = (ms: number) => H - Math.min(H, (ms / maxMs) * H);
  return (
    <svg
      width={W}
      height={H}
      style={{ display: 'block', margin: '2px 0 6px', borderRadius: 4, background: 'rgba(255,255,255,0.04)' }}
    >
      {frames.map((ms, i) => {
        const y = yFor(ms);
        return <rect key={i} x={i * bw} y={y} width={Math.max(0.7, bw - 0.25)} height={H - y} fill={frameColor(ms)} />;
      })}
      <line x1={0} x2={W} y1={yFor(16.7)} y2={yFor(16.7)} stroke="rgba(94,224,138,0.35)" strokeWidth={1} strokeDasharray="3 3" />
      <line x1={0} x2={W} y1={yFor(33.3)} y2={yFor(33.3)} stroke="rgba(255,209,102,0.3)" strokeWidth={1} strokeDasharray="3 3" />
    </svg>
  );
}

/** Where the sim frame budget went: a stacked bar of the four runtime sections plus an "other" remainder. */
function SectionBar({ snap }: { snap: PerfSnapshot }) {
  const order: RuntimeSection[] = ['scripts', 'physics', 'combat', 'animator'];
  const sum = order.reduce((acc, key) => acc + snap.sections[key].avg, 0);
  const total = Math.max(snap.tickMs.avg, sum, 0.0001);
  return (
    <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', background: 'rgba(255,255,255,0.06)', margin: '2px 0 6px' }}>
      {order.map((key) => {
        const pct = (snap.sections[key].avg / total) * 100;
        return pct > 0.5 ? <div key={key} title={`${key} ${fmt(snap.sections[key].avg)}ms`} style={{ width: `${pct}%`, background: SECTION_COLORS[key] }} /> : null;
      })}
    </div>
  );
}

/**
 * Performance HUD / profiler. Polls the mutable perf singleton on a low-frequency timer (it does NOT
 * subscribe to the store reactively — that would add to the very re-render cost it measures). Toggle with F8.
 * Shows a frame-time history graph, a per-section sim breakdown, JS heap, live physics body counts, render
 * stats, and a stress-scene spawner so every optimization is measurable against the same load.
 */
export function PerfOverlay() {
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [snap, setSnap] = useState<PerfSnapshot>(ZERO_SNAPSHOT);
  const [frames, setFrames] = useState<number[]>([]);
  const [counts, setCounts] = useState<Counts>({ objects: 0, scripted: 0, dynamicBodies: 0, lights: 0 });
  const [phys, setPhys] = useState<PhysStats | null>(null);
  const [mem, setMem] = useState<MemStats | null>(null);
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
      setFrames(getFrameHistory());
      setCounts(readCounts());
      setPhys(getActivePhysics()?.getStats() ?? null);
      // performance.memory is a non-standard Chromium extension — absent in Firefox/Safari.
      const m = (performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
      setMem(m ? { used: m.usedJSHeapSize, limit: m.jsHeapSizeLimit } : null);
    };
    poll();
    const id = window.setInterval(poll, 250);
    return () => window.clearInterval(id);
  }, [visible]);

  if (!visible) return null;

  const { frameMs, tickMs, sections, render } = snap;

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
          <FrameGraph frames={frames} />
          <Row label="frame" value={`${fmt(frameMs.avg)} / p95 ${fmt(frameMs.p95)}ms`} />
          <Row label="tick (sim)" value={`${fmt(tickMs.avg)} / max ${fmt(tickMs.max)}ms`} />
          <SectionBar snap={snap} />
          <Row label="scripts" value={`${fmt(sections.scripts.avg)}ms`} />
          <Row label="physics" value={`${fmt(sections.physics.avg)}ms`} />
          <Row label="combat" value={`${fmt(sections.combat.avg)}ms`} />
          <Row label="animator" value={`${fmt(sections.animator.avg)}ms`} />
          <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '6px 0' }} />
          <Row label="draw calls" value={fmtInt(render.calls)} />
          <Row label="triangles" value={fmtInt(render.triangles)} />
          <Row label="programs" value={String(render.programs)} />
          <Row label="geo / tex" value={`${render.geometries} / ${render.textures}`} />
          {mem && (
            <Row label="js heap" value={`${fmtMB(mem.used)} / ${fmtMB(mem.limit)} MB`} />
          )}
          <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '6px 0' }} />
          <Row label="objects" value={String(counts.objects)} />
          <Row label="scripted" value={String(counts.scripted)} />
          {phys ? (
            <>
              <Row label="bodies (awake)" value={`${phys.bodies} (${phys.bodies - phys.sleeping})`} />
              <Row label="characters" value={String(phys.characters)} />
              {phys.joints > 0 && <Row label="joints" value={String(phys.joints)} />}
            </>
          ) : (
            <Row label="dyn bodies" value={String(counts.dynamicBodies)} />
          )}
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
