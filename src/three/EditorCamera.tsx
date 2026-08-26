import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import {
  applyFreeCameraFromTarget,
  clampFreeCamera,
  createFreeCameraNavigationState,
  lookFreeCamera,
  orbitFreeCamera,
  panFreeCamera,
  seedFreeCameraNavigation,
  stepFreeCameraNavigation,
  wheelFreeCamera,
} from './freeCameraNavigation';

/**
 * Shared navigation state so editor-level keyboard handlers (gizmo hotkeys in ViewportPanel)
 * can tell when the camera is in flythrough mode and stand down (W/E/R fly vs. switch gizmo).
 */
export const editorNav = { flying: false };

/** Standard camera orientations the ViewCube / numpad presets can request. */
export type ViewPreset = 'persp' | 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right';

/** Live editor-camera orientation (yaw/pitch in radians), published each frame so the DOM-side
 * ViewCube can mirror where the camera is looking. */
export const editorViewOrientation = { yaw: 0, pitch: 0 };

// yaw/pitch (euler 'YXZ') for each preset. Pitch ±HALF_PI looks straight down/up.
const PRESET_ORIENT: Record<ViewPreset, { yaw: number; pitch: number }> = {
  persp: { yaw: 0.7, pitch: -0.42 },
  top: { yaw: 0, pitch: -Math.PI / 2 + 0.001 },
  bottom: { yaw: 0, pitch: Math.PI / 2 - 0.001 },
  front: { yaw: 0, pitch: 0 },
  back: { yaw: Math.PI, pitch: 0 },
  right: { yaw: Math.PI / 2, pitch: 0 },
  left: { yaw: -Math.PI / 2, pitch: 0 },
};

/**
 * Live framing of the editor viewport camera, refreshed every frame while EditorCamera is mounted.
 * Lets UI outside the Canvas (the Cinematic panel) capture "what I'm looking at right now" as a
 * camera shot — position + a look-at point on the view ray + current FOV. `valid` is false whenever
 * the editor camera isn't the active view (during Play or cinematic preview).
 */
export const editorCameraPose: {
  position: [number, number, number];
  lookAt: [number, number, number];
  fov: number;
  valid: boolean;
} = { position: [0, 0, 0], lookAt: [0, 0.5, 0], fov: 50, valid: false };

/** How much of the remaining distance the focus/view glide closes in one 60Hz frame. The frame loop
 *  rescales this by the real delta so the glide takes the same wall-clock time at any refresh rate. */
const FOCUS_EASE_PER_60HZ_FRAME = 0.18;

/**
 * Unreal-style editor viewport camera. Replaces OrbitControls in edit mode.
 *  - Right-mouse drag  → free-look; while held, WASD fly + Q/E down/up, Shift = boost, wheel = fly speed.
 *  - Alt + left drag    → orbit around the focus point.
 *  - Middle drag        → pan.
 *  - Wheel (not flying)  → dolly toward the focus point.
 *  - `focusNonce` bumps → frame the selected object (F key, wired from ViewportPanel).
 */
export function EditorCamera({ focusNonce, viewCommand }: { focusNonce: number; viewCommand?: { view: ViewPreset; nonce: number } }) {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);

  const nav = useRef({
    ...createFreeCameraNavigationState(),
    // focus animation
    focusing: false,
    focusTarget: new THREE.Vector3(),
    focusDistance: 10,
    // orientation the focus animation eases toward (unchanged for F-focus, set for view presets)
    focusYaw: 0,
    focusPitch: 0,
  });

  // Seed orientation from the Canvas-provided camera, framing the world origin like OrbitControls did.
  useEffect(() => {
    const s = nav.current;
    s.target.set(0, 0.5, 0);
    seedFreeCameraNavigation(s, camera, s.target, 2);
  }, [camera]);

  // Mark the captured framing stale whenever the editor camera isn't the live view.
  useEffect(() => () => {
    editorCameraPose.valid = false;
  }, []);

  // Pointer + wheel navigation on the canvas element.
  useEffect(() => {
    const el = gl.domElement;
    const s = nav.current;

    const onContextMenu = (event: MouseEvent) => event.preventDefault();

    // Record mode: drop/refresh a camera keyframe at the playhead from the framing we just navigated to.
    const autoKeyCamera = () => {
      const store = useEditorStore.getState();
      if (!store.cinematicRecording || store.isPlaying) return;
      const cinematicId = store.activeCinematicId || store.activeScene()?.cinematics?.[0]?.id;
      if (!cinematicId) return;
      const time = store.editorCinematicPreview?.sequenceId === cinematicId ? store.editorCinematicPreview.time : 0;
      store.addCinematicCameraKeyframe(cinematicId, time, {
        position: [camera.position.x, camera.position.y, camera.position.z],
        lookAt: [s.target.x, s.target.y, s.target.z],
        fov: (camera as THREE.PerspectiveCamera).isPerspectiveCamera ? (camera as THREE.PerspectiveCamera).fov : 50,
      });
    };

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
      autoKeyCamera();
    };

    const onPointerMove = (event: PointerEvent) => {
      if (s.mode === 'none') return;
      const dx = event.movementX ?? 0;
      const dy = event.movementY ?? 0;
      if (s.mode === 'fly') {
        lookFreeCamera(s, camera, dx, dy);
      } else if (s.mode === 'orbit') {
        orbitFreeCamera(s, camera, dx, dy);
      } else {
        panFreeCamera(s, camera, dx, dy);
      }
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      s.focusing = false;
      const wasFlying = s.mode === 'fly';
      wheelFreeCamera(s, camera, event.deltaY);
      if (!wasFlying) autoKeyCamera();
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
    s.focusDistance = clampFreeCamera(radius * 4 + 2, 3, 60);
    // F-focus keeps the current viewing angle.
    s.focusYaw = s.yaw;
    s.focusPitch = s.pitch;
    s.focusing = true;
  }, [focusNonce]);

  // Snap to a standard orientation (ViewCube / numpad presets), framing the selection if any.
  useEffect(() => {
    if (!viewCommand || viewCommand.nonce === 0) return;
    const s = nav.current;
    const selectedId = useEditorStore.getState().selectedObjectId;
    const object = selectActiveObjects(useEditorStore.getState()).find((item) => item.id === selectedId);
    const position = object ? object.transform.position : [s.target.x, s.target.y, s.target.z];
    s.focusTarget.set(position[0], position[1], position[2]);
    s.focusDistance = s.distance; // keep the current zoom; only re-orient
    const orient = PRESET_ORIENT[viewCommand.view];
    s.focusYaw = orient.yaw;
    s.focusPitch = orient.pitch;
    s.focusing = true;
  }, [viewCommand?.nonce]);

  useFrame((_, delta) => {
    const s = nav.current;
    const dt = Math.min(delta, 0.05);

    // Publish the live framing so the Cinematic panel can capture this exact angle as a shot.
    editorCameraPose.position = [camera.position.x, camera.position.y, camera.position.z];
    editorCameraPose.lookAt = [s.target.x, s.target.y, s.target.z];
    editorCameraPose.fov = (camera as THREE.PerspectiveCamera).isPerspectiveCamera ? (camera as THREE.PerspectiveCamera).fov : 50;
    editorCameraPose.valid = true;
    // Publish orientation for the ViewCube.
    editorViewOrientation.yaw = s.yaw;
    editorViewOrientation.pitch = s.pitch;

    if (s.focusing) {
      // Framerate-independent ease. This used to apply a flat 0.18 PER FRAME, so the glide ran at
      // whatever rate the display happened to tick: ~2.4x faster on a 144Hz panel than on 60Hz, and
      // crawling on a struggling frame. Converting to an exponential decay over dt keeps the motion
      // identical at 60Hz (alpha == 0.18 there, so the tuned feel is preserved) while making every
      // other refresh rate take the same wall-clock time.
      const alpha = 1 - Math.pow(1 - FOCUS_EASE_PER_60HZ_FRAME, dt * 60);
      s.target.lerp(s.focusTarget, alpha);
      s.distance += (s.focusDistance - s.distance) * alpha;
      // Ease the viewing angle toward the focus orientation (shortest yaw path).
      let yawDelta = s.focusYaw - s.yaw;
      yawDelta = Math.atan2(Math.sin(yawDelta), Math.cos(yawDelta));
      s.yaw += yawDelta * alpha;
      s.pitch += (s.focusPitch - s.pitch) * alpha;
      applyFreeCameraFromTarget(s, camera);
      if (
        s.target.distanceToSquared(s.focusTarget) < 0.0004 &&
        Math.abs(s.distance - s.focusDistance) < 0.02 &&
        Math.abs(yawDelta) < 0.01 &&
        Math.abs(s.focusPitch - s.pitch) < 0.01
      ) {
        s.focusing = false;
      }
      return;
    }

    stepFreeCameraNavigation(s, camera, dt);
  });

  return null;
}
