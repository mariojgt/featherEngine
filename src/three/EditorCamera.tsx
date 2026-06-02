import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { selectActiveObjects, useEditorStore } from '../store/editorStore';

/**
 * Shared navigation state so editor-level keyboard handlers (gizmo hotkeys in ViewportPanel)
 * can tell when the camera is in flythrough mode and stand down (W/E/R fly vs. switch gizmo).
 */
export const editorNav = { flying: false };

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const tmpForward = new THREE.Vector3();
const tmpRight = new THREE.Vector3();
const tmpUp = new THREE.Vector3();
const tmpMove = new THREE.Vector3();
const tmpDelta = new THREE.Vector3();

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const HALF_PI = Math.PI / 2 - 0.01;

/**
 * Unreal-style editor viewport camera. Replaces OrbitControls in edit mode.
 *  - Right-mouse drag  → free-look; while held, WASD fly + Q/E down/up, Shift = boost, wheel = fly speed.
 *  - Alt + left drag    → orbit around the focus point.
 *  - Middle drag        → pan.
 *  - Wheel (not flying)  → dolly toward the focus point.
 *  - `focusNonce` bumps → frame the selected object (F key, wired from ViewportPanel).
 */
export function EditorCamera({ focusNonce }: { focusNonce: number }) {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);

  const nav = useRef({
    yaw: 0,
    pitch: 0,
    distance: 10,
    target: new THREE.Vector3(0, 0.5, 0),
    mode: 'none' as 'none' | 'fly' | 'orbit' | 'pan',
    keys: new Set<string>(),
    flySpeed: 8,
    euler: new THREE.Euler(0, 0, 0, 'YXZ'),
    // focus animation
    focusing: false,
    focusTarget: new THREE.Vector3(),
    focusDistance: 10,
  });

  // Seed orientation from the Canvas-provided camera, framing the world origin like OrbitControls did.
  useEffect(() => {
    const s = nav.current;
    s.target.set(0, 0.5, 0);
    s.distance = Math.max(camera.position.distanceTo(s.target), 2);
    camera.lookAt(s.target);
    s.euler.setFromQuaternion(camera.quaternion, 'YXZ');
    s.yaw = s.euler.y;
    s.pitch = s.euler.x;
  }, [camera]);

  // Pointer + wheel navigation on the canvas element.
  useEffect(() => {
    const el = gl.domElement;
    const s = nav.current;

    const orient = () => {
      s.euler.set(s.pitch, s.yaw, 0, 'YXZ');
      camera.quaternion.setFromEuler(s.euler);
    };
    const applyFromTarget = () => {
      orient();
      tmpForward.set(0, 0, -1).applyEuler(s.euler);
      camera.position.copy(s.target).addScaledVector(tmpForward, -s.distance);
    };
    const applyFromPosition = () => {
      orient();
      tmpForward.set(0, 0, -1).applyEuler(s.euler);
      s.target.copy(camera.position).addScaledVector(tmpForward, s.distance);
    };

    const onContextMenu = (event: MouseEvent) => event.preventDefault();

    const onPointerDown = (event: PointerEvent) => {
      if (event.button === 2) s.mode = 'fly';
      else if (event.button === 1) s.mode = 'pan';
      else if (event.button === 0 && event.altKey) s.mode = 'orbit';
      else return;
      s.focusing = false;
      editorNav.flying = s.mode === 'fly';
      event.preventDefault();
      el.setPointerCapture?.(event.pointerId);
      el.style.cursor = s.mode === 'fly' ? 'none' : 'grabbing';
    };

    const endDrag = (event: PointerEvent) => {
      if (s.mode === 'none') return;
      s.mode = 'none';
      editorNav.flying = false;
      s.keys.clear();
      el.releasePointerCapture?.(event.pointerId);
      el.style.cursor = '';
    };

    const onPointerMove = (event: PointerEvent) => {
      if (s.mode === 'none') return;
      const dx = event.movementX ?? 0;
      const dy = event.movementY ?? 0;
      if (s.mode === 'fly') {
        s.yaw -= dx * 0.0026;
        s.pitch = clamp(s.pitch - dy * 0.0026, -HALF_PI, HALF_PI);
        applyFromPosition();
      } else if (s.mode === 'orbit') {
        s.yaw -= dx * 0.006;
        s.pitch = clamp(s.pitch - dy * 0.006, -HALF_PI, HALF_PI);
        applyFromTarget();
      } else {
        // pan: slide camera + focus point along the screen plane
        orient();
        tmpForward.set(0, 0, -1).applyEuler(s.euler);
        tmpRight.crossVectors(tmpForward, WORLD_UP).normalize();
        tmpUp.crossVectors(tmpRight, tmpForward).normalize();
        const scale = Math.max(s.distance, 1) * 0.0016;
        tmpDelta.set(0, 0, 0).addScaledVector(tmpRight, -dx * scale).addScaledVector(tmpUp, dy * scale);
        camera.position.add(tmpDelta);
        s.target.add(tmpDelta);
      }
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (s.mode === 'fly') {
        s.flySpeed = clamp(s.flySpeed * (event.deltaY < 0 ? 1.15 : 0.87), 0.5, 240);
        return;
      }
      s.focusing = false;
      s.distance = clamp(s.distance * (event.deltaY < 0 ? 0.86 : 1.16), 0.5, 600);
      applyFromTarget();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (s.mode !== 'fly') return;
      s.keys.add(event.key.toLowerCase());
    };
    const onKeyUp = (event: KeyboardEvent) => {
      s.keys.delete(event.key.toLowerCase());
    };
    const onBlur = () => s.keys.clear();

    el.addEventListener('contextmenu', onContextMenu);
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);
    el.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    return () => {
      el.removeEventListener('contextmenu', onContextMenu);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', endDrag);
      el.removeEventListener('pointercancel', endDrag);
      el.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      editorNav.flying = false;
      el.style.cursor = '';
    };
  }, [camera, gl]);

  // Frame the selected object when the focus nonce changes.
  useEffect(() => {
    if (focusNonce === 0) return;
    const s = nav.current;
    const selectedId = useEditorStore.getState().selectedObjectId;
    const object = selectActiveObjects(useEditorStore.getState()).find((item) => item.id === selectedId);
    const position = object ? object.transform.position : [0, 0.5, 0];
    const scale = object ? object.transform.scale : [1, 1, 1];
    const radius = 0.6 * Math.max(Math.abs(scale[0]), Math.abs(scale[1]), Math.abs(scale[2]), 0.5);
    s.focusTarget.set(position[0], position[1], position[2]);
    s.focusDistance = clamp(radius * 4 + 2, 3, 60);
    s.focusing = true;
  }, [focusNonce]);

  useFrame((_, delta) => {
    const s = nav.current;
    const dt = Math.min(delta, 0.05);

    if (s.focusing) {
      s.target.lerp(s.focusTarget, 0.18);
      s.distance += (s.focusDistance - s.distance) * 0.18;
      s.euler.set(s.pitch, s.yaw, 0, 'YXZ');
      camera.quaternion.setFromEuler(s.euler);
      tmpForward.set(0, 0, -1).applyEuler(s.euler);
      camera.position.copy(s.target).addScaledVector(tmpForward, -s.distance);
      if (s.target.distanceToSquared(s.focusTarget) < 0.0004 && Math.abs(s.distance - s.focusDistance) < 0.02) {
        s.focusing = false;
      }
      return;
    }

    if (s.mode !== 'fly' || s.keys.size === 0) return;
    s.euler.set(s.pitch, s.yaw, 0, 'YXZ');
    tmpForward.set(0, 0, -1).applyEuler(s.euler);
    tmpRight.crossVectors(tmpForward, WORLD_UP).normalize();
    tmpMove.set(0, 0, 0);
    const k = s.keys;
    if (k.has('w')) tmpMove.add(tmpForward);
    if (k.has('s')) tmpMove.sub(tmpForward);
    if (k.has('d')) tmpMove.add(tmpRight);
    if (k.has('a')) tmpMove.sub(tmpRight);
    if (k.has('e')) tmpMove.add(WORLD_UP);
    if (k.has('q')) tmpMove.sub(WORLD_UP);
    if (tmpMove.lengthSq() === 0) return;
    tmpMove.normalize();
    const speed = s.flySpeed * (k.has('shift') ? 3 : 1) * dt;
    camera.position.addScaledVector(tmpMove, speed);
    s.target.addScaledVector(tmpMove, speed);
  });

  return null;
}
