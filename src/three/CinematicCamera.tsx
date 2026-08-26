import { PerspectiveCamera } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useEditorStore } from '../store/editorStore';
import type { RuntimeCinematicCamera } from '../types';
import {
  createFreeCameraNavigationState,
  lookFreeCamera,
  orbitFreeCamera,
  panFreeCamera,
  seedFreeCameraNavigation,
  stepFreeCameraNavigation,
  wheelFreeCamera,
} from './freeCameraNavigation';

export function CinematicCamera({ pose }: { pose?: RuntimeCinematicCamera }) {
  const runtimePose = useEditorStore((state) => state.runtimeCinematicCamera);
  const liveSequenceId = useEditorStore((state) => state.playtimeCameraSession?.sequenceId);
  const activePose = pose ?? runtimePose;
  const gl = useThree((state) => state.gl);
  const cameraRef = useRef<THREE.PerspectiveCamera>(null);
  const initialized = useRef(false);
  const nav = useRef(createFreeCameraNavigationState());
  const lastSampleTime = useRef(-Infinity);

  useEffect(() => {
    initialized.current = false;
    lastSampleTime.current = -Infinity;
    nav.current.mode = 'none';
    nav.current.keys.clear();
  }, [liveSequenceId]);

  useEffect(() => {
    if (!liveSequenceId) return;
    const el = gl.domElement;
    const state = nav.current;
    const movementKeys = new Set(['w', 'a', 's', 'd', 'q', 'e', 'shift']);

    const onContextMenu = (event: MouseEvent) => event.preventDefault();
    const onPointerDown = (event: PointerEvent) => {
      if (event.button === 2) state.mode = 'fly';
      else if (event.button === 1) state.mode = 'pan';
      else if (event.button === 0 && event.altKey) state.mode = 'orbit';
      else return;
      event.preventDefault();
      el.setPointerCapture?.(event.pointerId);
      el.style.cursor = state.mode === 'fly' ? 'none' : 'grabbing';
    };
    const endPointer = (event: PointerEvent) => {
      if (state.mode === 'none') return;
      state.mode = 'none';
      state.keys.clear();
      if (el.hasPointerCapture?.(event.pointerId)) el.releasePointerCapture(event.pointerId);
      el.style.cursor = '';
    };
    const onPointerMove = (event: PointerEvent) => {
      if (state.mode === 'none') return;
      const camera = cameraRef.current;
      if (!camera) return;
      const dx = event.movementX ?? 0;
      const dy = event.movementY ?? 0;
      if (state.mode === 'fly') lookFreeCamera(state, camera, dx, dy);
      else if (state.mode === 'orbit') orbitFreeCamera(state, camera, dx, dy);
      else panFreeCamera(state, camera, dx, dy);
    };
    const onWheel = (event: WheelEvent) => {
      const camera = cameraRef.current;
      if (!camera) return;
      event.preventDefault();
      wheelFreeCamera(state, camera, event.deltaY);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (state.mode !== 'fly') return;
      const key = event.key.toLowerCase();
      if (!movementKeys.has(key)) return;
      state.keys.add(key);
      event.preventDefault();
    };
    const onKeyUp = (event: KeyboardEvent) => state.keys.delete(event.key.toLowerCase());
    const onBlur = () => state.keys.clear();

    el.addEventListener('contextmenu', onContextMenu);
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', endPointer);
    el.addEventListener('pointercancel', endPointer);
    el.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      state.mode = 'none';
      state.keys.clear();
      el.style.cursor = '';
      el.removeEventListener('contextmenu', onContextMenu);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', endPointer);
      el.removeEventListener('pointercancel', endPointer);
      el.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [gl, liveSequenceId]);

  useFrame((_, delta) => {
    const camera = cameraRef.current;
    if (!camera || !activePose) return;

    if (Math.abs(camera.fov - activePose.fov) > 0.01) {
      camera.fov = activePose.fov;
      camera.updateProjectionMatrix();
    }

    if (liveSequenceId) {
      const state = nav.current;
      if (!initialized.current) {
        camera.position.set(...activePose.position);
        seedFreeCameraNavigation(state, camera, state.target.set(...activePose.lookAt));
        initialized.current = true;
      }
      stepFreeCameraNavigation(state, camera, delta);

      const store = useEditorStore.getState();
      const time = store.runtimeCinematic?.sequenceId === liveSequenceId ? store.runtimeCinematic.time : undefined;
      if (time !== undefined && (lastSampleTime.current < 0 || time - lastSampleTime.current >= 1 / 12)) {
        lastSampleTime.current = time;
        store.recordPlaytimeCameraSample({
          time,
          position: [camera.position.x, camera.position.y, camera.position.z],
          lookAt: [state.target.x, state.target.y, state.target.z],
          fov: camera.fov,
          focusDistance: activePose.focusDistance,
          aperture: activePose.aperture,
        });
      }
    } else {
      camera.position.set(...activePose.position);
      camera.lookAt(new THREE.Vector3(...activePose.lookAt));
    }
  });

  if (!activePose) return null;
  return <PerspectiveCamera ref={cameraRef} makeDefault fov={activePose.fov} near={0.02} position={activePose.position} />;
}
