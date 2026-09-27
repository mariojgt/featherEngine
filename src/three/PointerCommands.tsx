import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Plane, Raycaster, Vector2, Vector3 } from 'three';
import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import { readTransform } from '../runtime/transformBuffer';
import type { GraphValue, Vector3Tuple } from '../types';

/** Opt-in, reusable point-and-click input for scripted characters. Events carry either a world
 * position or an actor id. Gameplay remains in the character's ordinary editable blueprint. */
export function dispatchPointerCommand(
  event: string,
  payload: GraphValue,
): void {
  useEditorStore.setState((s) => ({
    runtimeEventPayloads: {
      ...s.runtimeEventPayloads,
      [event.toLowerCase()]: payload,
    },
    runtimeEventQueue: [...s.runtimeEventQueue, event],
  }));
}
export function PointerCommands() {
  const { gl, camera, scene } = useThree();
  const mapRef = useRef<HTMLCanvasElement>();
  const clock = useRef(0);
  const config = () => {
    const s = useEditorStore.getState();
    if (!s.isPlaying || s.isPlayPaused) return;
    const hero = selectActiveObjects(s).find(
      (o) =>
        o.character?.cameraFollow &&
        typeof o.variables?.pointerMoveEvent === 'string',
    );
    if (!hero) return;
    const v = hero.variables!;
    const global = (name: GraphValue | undefined) =>
      s.runtimeVariableValues[
        s.variables.find((x) => x.name === name)?.id ?? ''
      ];
    return {
      s,
      hero,
      v,
      active:
        global(v.pointerPlayingVariable) === true &&
        global(v.pointerPausedVariable) !== true &&
        global(v.pointerBlockedVariable) !== true,
    };
  };
  useEffect(() => {
    const canvas = gl.domElement,
      ray = new Raycaster(),
      ndc = new Vector2(),
      plane = new Plane(new Vector3(0, 1, 0), 0),
      hit = new Vector3();
    const issue = (point: Vector3Tuple, actor?: string) => {
      const c = config();
      if (!c?.active) return;
      const bound = Number(c.v.pointerBounds ?? 35);
      if (actor && typeof c.v.pointerAttackEvent === 'string')
        dispatchPointerCommand(c.v.pointerAttackEvent, actor);
      else
        dispatchPointerCommand(String(c.v.pointerMoveEvent), [
          Math.max(-bound, Math.min(bound, point[0])),
          0,
          Math.max(-bound, Math.min(bound, point[2])),
        ]);
    };
    const down = (e: PointerEvent) => {
      const c = config();
      if (!c?.active || (e.button !== 0 && e.button !== 2)) return;
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      ndc.set(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        (-(e.clientY - r.top) / r.height) * 2 + 1,
      );
      ray.setFromCamera(ndc, camera);
      const objects = new Map(selectActiveObjects(c.s).map((o) => [o.id, o]));
      let target: string | undefined;
      for (const intersect of ray.intersectObjects(scene.children, true)) {
        for (let node = intersect.object; node; node = node.parent!) {
          const object = objects.get(node.userData.nfObjectId);
          if (!object || object.variables?.tags !== c.v.pointerTargetTag)
            continue;
          const vars =
            c.s.runtimeObjectVariables[object.id] ?? object.variables;
          if (vars.team !== c.hero.variables?.team && Number(vars.hp) > 0) {
            target = object.id;
            break;
          }
        }
        if (target) break;
      }
      if (ray.ray.intersectPlane(plane, hit)) issue([hit.x, 0, hit.z], target);
    };
    let lastAim = 0;
    let pointer: [number, number] | undefined;
    const updateAim = () => {
      const c = config();
      if (!c?.active || !pointer || typeof c.v.pointerAimVariable !== 'string')
        return;
      const r = canvas.getBoundingClientRect();
      ndc.set(
        ((pointer[0] - r.left) / r.width) * 2 - 1,
        1 - ((pointer[1] - r.top) / r.height) * 2,
      );
      ray.setFromCamera(ndc, camera);
      if (!ray.ray.intersectPlane(plane, hit)) return;
      const key = c.v.pointerAimVariable;
      const point: Vector3Tuple = [hit.x, 0, hit.z];
      useEditorStore.setState((s) => ({
        runtimeObjectVariables: {
          ...s.runtimeObjectVariables,
          [c.hero.id]: { ...s.runtimeObjectVariables[c.hero.id], [key]: point },
        },
      }));
    };
    const aim = (e: PointerEvent) => {
      pointer = [e.clientX, e.clientY];
      if (e.timeStamp - lastAim < 32) return;
      lastAim = e.timeStamp;
      updateAim();
    };
    const keyDown = (event: KeyboardEvent) => {
      const c = config();
      // A game can reserve Escape for its own menus; the editor still has its Stop button.
      if (event.code === 'Escape' && c?.v.pointerCaptureEscape === true) {
        const playing = c.s.variables.find(v => v.name === c.v.pointerPlayingVariable);
        if (playing && c.s.runtimeVariableValues[playing.id] === true) event.preventDefault();
      }
      updateAim();
    };
    // Reproject before keyboard abilities: the follow camera may have moved under a stationary cursor.
    window.addEventListener('keydown', keyDown, true);
    const menu = (e: Event) => {
      if (config()) e.preventDefault();
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', aim);
    canvas.addEventListener('contextmenu', menu);
    const map = document.createElement('canvas');
    map.width = 250;
    map.height = 250;
    map.className = 'nf-tactical-map';
    map.setAttribute('aria-label', 'Battlefield map. Click to move.');
    Object.assign(map.style, {
      position: 'absolute',
      right: '16px',
      bottom: '16px',
      width: 'min(220px, 22vw)',
      height: 'min(220px, 22vw)',
      border: '2px solid #a9925a',
      borderRadius: '4px',
      background: '#101e21',
      boxShadow: '0 8px 35px #0009',
      zIndex: '10',
      display: 'none',
      cursor: 'crosshair',
    });
    canvas.parentElement?.appendChild(map);
    mapRef.current = map;
    const mapDown = (e: PointerEvent) => {
      const c = config();
      if (!c?.active) return;
      e.preventDefault();
      e.stopPropagation();
      const r = map.getBoundingClientRect(),
        span = Number(c.v.pointerMapSpan ?? 84);
      issue([
        (0.5 - (e.clientX - r.left) / r.width) * span,
        0,
        ((e.clientY - r.top) / r.height - 0.5) * span,
      ]);
    };
    map.addEventListener('pointerdown', mapDown);
    map.addEventListener('contextmenu', menu);
    return () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', aim);
      window.removeEventListener('keydown', keyDown, true);
      canvas.removeEventListener('contextmenu', menu);
      map.remove();
      mapRef.current = undefined;
    };
  }, [gl, camera, scene]);
  useFrame((_, dt) => {
    clock.current += dt;
    if (clock.current < 0.1) return;
    clock.current = 0;
    const map = mapRef.current,
      c = config();
    if (!map) return;
    map.style.display = c?.active ? 'block' : 'none';
    if (!c?.active) return;
    const ctx = map.getContext('2d');
    if (!ctx) return;
    const size = 250,
      span = Number(c.v.pointerMapSpan ?? 84),
      point = (p: number[]) => [
        (0.5 - p[0] / span) * size,
        (0.5 + p[2] / span) * size,
      ];
    ctx.fillStyle = '#142d2a';
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = '#285565';
    ctx.lineWidth = 18;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(size, size);
    ctx.stroke();
    let routes: number[][][] = [];
    try {
      routes = JSON.parse(String(c.v.pointerMapPaths ?? '[]'));
    } catch {
      /* A missing map drawing never blocks input. */
    }
    ctx.strokeStyle = '#73816b';
    ctx.lineWidth = 9;
    ctx.lineJoin = 'round';
    for (const route of routes) {
      ctx.beginPath();
      route.forEach((p, i) => {
        const [x, y] = point(p);
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      ctx.stroke();
    }
    for (const o of selectActiveObjects(c.s)) {
      if (o.variables?.tags !== c.v.pointerTargetTag) continue;
      const v = c.s.runtimeObjectVariables[o.id] ?? o.variables;
      if (Number(v.hp) <= 0) continue;
      const t = readTransform(o.id) ?? o.transform,
        [x, y] = point(t.position);
      ctx.fillStyle = v.team === 1 ? '#53dbdf' : '#f37a77';
      const radius =
        o.id === c.hero.id ? 5 : v.kind === 1 ? 3.5 : v.kind === 0 ? 1.7 : 4;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      if (o.id === c.hero.id) {
        ctx.strokeStyle = '#fff0b3';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
    const t = readTransform(c.hero.id) ?? c.hero.transform,
      [x, y] = point(t.position);
    ctx.strokeStyle = '#ffffff60';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 36, y - 25, 72, 50);
  });
  return null;
}
