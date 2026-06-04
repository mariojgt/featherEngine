/**
 * Built-in GTA-style minimap / radar overlay. A click-through DOM canvas (sibling of GameHud) mounted in
 * both the editor viewport and the standalone player; only drawn while Play is on AND
 * `renderSettings.minimapEnabled` is true. It runs ONE requestAnimationFrame loop that reads the live store
 * via getState() (no per-frame React re-render) and paints a 2D radar:
 *   • centered on the controlled entity (the camera-follow character or vehicle), rotated with its heading;
 *   • building footprints — objects with a `minimapShape` instance var (rect from their XZ position+scale,
 *     color from `minimapShapeColor`);
 *   • blips — objects with a `minimapBlip` color instance var (dot in that color);
 *   • the player arrow at center, a money readout, and health + armor arcs around the ring (read from the
 *     controlled pawn's `health`/`maxHealth`/`armor`/`money` vars — the occupant pawn while driving).
 * Entirely data-driven so any project can opt in (set the render setting + tag objects); the third-person
 * (urban) template turns it on.
 */
import { useEffect, useRef } from 'react';
import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import type { SceneObject } from '../types';

const SIZE = 190; // CSS px diameter of the radar

function toNum(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function MiniMap() {
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const enabled = useEditorStore((state) => state.renderSettings.minimapEnabled ?? false);
  const rotate = useEditorStore((state) => state.renderSettings.minimapRotate ?? true);
  const range = useEditorStore((state) => state.renderSettings.minimapRange ?? 60);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!isPlaying || !enabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    const cx = SIZE / 2;
    const cy = SIZE / 2;
    const radius = SIZE / 2 - 3;
    const ppu = radius / range; // screen px per world unit

    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const state = useEditorStore.getState();
      const objects = selectActiveObjects(state);
      const controlled = objects.find(
        (o) => (o.character?.enabled && o.character.cameraFollow) || (o.vehicle?.enabled && o.vehicle.cameraFollow),
      );
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, SIZE, SIZE);
      if (!controlled) return;

      const px = controlled.transform.position[0];
      const pz = controlled.transform.position[2];
      const yaw = controlled.transform.rotation[1];
      // Stat source = the occupant pawn while driving, else the controlled entity itself.
      const occupantId = controlled.vehicle?.cameraFollow ? state.runtimeVehicleOccupants[controlled.id] : undefined;
      const statObj: SceneObject | undefined = occupantId ? objects.find((o) => o.id === occupantId) : controlled;
      const liveVars = statObj ? { ...(statObj.variables ?? {}), ...(state.runtimeObjectVariables[statObj.id] ?? {}) } : {};

      // World (dx,dz) → on-radar screen point. When `rotate`, the controlled heading points up.
      const c = rotate ? Math.cos(yaw) : 1;
      const s = rotate ? Math.sin(yaw) : 0;
      const project = (wx: number, wz: number): [number, number] => {
        const dx = wx - px;
        const dz = wz - pz;
        const rx = dx * c - dz * s;
        const rz = dx * s + dz * c;
        return [cx + rx * ppu, cy - rz * ppu];
      };

      // --- Clip to the radar circle + dark backdrop. ---
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = 'rgba(10,14,22,0.82)';
      ctx.fillRect(0, 0, SIZE, SIZE);

      // --- Building footprints (objects tagged `minimapShape`). Drawn as polygons of their 4 XZ corners so
      //     they rotate correctly with the radar; range-culled by center distance. ---
      const cull = range + 30;
      for (const o of objects) {
        if (!o.variables?.minimapShape) continue;
        const ox = o.transform.position[0];
        const oz = o.transform.position[2];
        if (Math.abs(ox - px) > cull || Math.abs(oz - pz) > cull) continue;
        const hx = Math.max(0.4, Math.abs(o.transform.scale[0]) / 2);
        const hz = Math.max(0.4, Math.abs(o.transform.scale[2]) / 2);
        const corners: Array<[number, number]> = [
          project(ox - hx, oz - hz),
          project(ox + hx, oz - hz),
          project(ox + hx, oz + hz),
          project(ox - hx, oz + hz),
        ];
        ctx.beginPath();
        ctx.moveTo(corners[0][0], corners[0][1]);
        for (let i = 1; i < 4; i++) ctx.lineTo(corners[i][0], corners[i][1]);
        ctx.closePath();
        ctx.fillStyle = (typeof o.variables.minimapShapeColor === 'string' && o.variables.minimapShapeColor) || 'rgba(120,134,156,0.5)';
        ctx.fill();
      }

      // --- Blips (objects tagged with a `minimapBlip` color). ---
      for (const o of objects) {
        const color = o.variables?.minimapBlip;
        if (typeof color !== 'string' || !color) continue;
        if (o.id === controlled.id || o.id === occupantId) continue;
        const ox = o.transform.position[0];
        const oz = o.transform.position[2];
        if (Math.abs(ox - px) > cull || Math.abs(oz - pz) > cull) continue;
        const [sx, sy] = project(ox, oz);
        ctx.beginPath();
        ctx.arc(sx, sy, 3.2, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.stroke();
      }
      ctx.restore();

      // --- Player arrow (center). Points up when the radar rotates with heading; otherwise rotates by yaw. ---
      ctx.save();
      ctx.translate(cx, cy);
      if (!rotate) ctx.rotate(yaw);
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(5, 6);
      ctx.lineTo(0, 3);
      ctx.lineTo(-5, 6);
      ctx.closePath();
      ctx.fillStyle = (typeof liveVars.minimapBlip === 'string' && liveVars.minimapBlip) || '#7dd3fc';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.stroke();
      ctx.restore();

      // --- Ring + health/armor arcs. ---
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(220,232,250,0.28)';
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();
      const arc = (frac: number, from: number, to: number, color: string) => {
        const f = Math.max(0, Math.min(1, frac));
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(0,0,0,0.45)';
        ctx.beginPath();
        ctx.arc(cx, cy, radius + 1, from, to);
        ctx.stroke();
        if (f <= 0) return;
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.arc(cx, cy, radius + 1, from, from + (to - from) * f);
        ctx.stroke();
      };
      const health = toNum(liveVars.health, 100);
      const maxHealth = toNum(liveVars.maxHealth, 100) || 100;
      const armor = toNum(liveVars.armor, 0);
      const maxArmor = toNum(liveVars.maxArmor, 100) || 100;
      // Health arc sweeps the bottom-left, armor the bottom-right (GTA-ish).
      arc(health / maxHealth, Math.PI * 0.62, Math.PI * 0.98, health / maxHealth < 0.3 ? '#ff5a4d' : '#4ade80');
      arc(armor / maxArmor, Math.PI * 0.02, Math.PI * 0.38, '#60a5fa');

      // --- Money readout above the radar. ---
      if (liveVars.money !== undefined) {
        ctx.font = '700 15px ui-sans-serif, system-ui, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'alphabetic';
        const text = `$${Math.round(toNum(liveVars.money)).toLocaleString()}`;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillText(text, SIZE + 1, -7);
        ctx.fillStyle = '#9be7a0';
        ctx.fillText(text, SIZE, -8);
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, enabled, rotate, range]);

  if (!isPlaying || !enabled) return null;
  return (
    <div style={{ position: 'absolute', left: '22px', bottom: '22px', width: `${SIZE}px`, height: `${SIZE}px`, pointerEvents: 'none', overflow: 'visible' }}>
      <canvas ref={canvasRef} style={{ width: `${SIZE}px`, height: `${SIZE}px`, filter: 'drop-shadow(0 6px 18px rgba(0,0,0,0.45))' }} />
    </div>
  );
}
