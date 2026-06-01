import { PerspectiveCamera } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { defaultCharacter, selectActiveObjects, useEditorStore } from '../store/editorStore';
import { cameraPitch as lookPitch, cameraYaw as lookYaw, mouseLook, resetMouseLook } from '../runtime/mouseLook';
import type { SceneObject } from '../types';

/** The first active-scene object whose character controller wants a follow camera. */
export function useFollowTarget(): SceneObject | undefined {
  const objects = useEditorStore(selectActiveObjects);
  return objects.find((object) => object.character?.enabled && object.character.cameraFollow);
}

/**
 * A third-person camera that trails the character controller's object. When the character has
 * `mouseLook`, clicking the view captures the pointer and the mouse orbits the camera (yaw/pitch);
 * the deltas live in the shared `mouseLook` module so the runtime can make movement camera-relative.
 * Otherwise it simply sits behind the character's facing. Renders nothing without a follow target.
 */
export function FollowCamera() {
  const target = useFollowTarget();
  const overrides = useEditorStore((state) => state.runtimeCameraOverrides);
  const cameraRef = useRef<THREE.PerspectiveCamera>(null);
  const desired = useRef(new THREE.Vector3());
  const gl = useThree((state) => state.gl);

  // Normalize so a controller created before `mouseLook` existed still enables the camera.
  const wantsMouseLook = Boolean({ ...defaultCharacter(), ...(target?.character ?? {}) }.mouseLook) && Boolean(target);

  // Mouse-look. Two ways, both supported so it always works: (1) click to capture the pointer
  // (Unreal-style free-look, ESC releases), or (2) click-drag in the view to orbit. Active only
  // while a mouse-look follow target is mounted (i.e. during Play), so it never hijacks the editor.
  useEffect(() => {
    if (!wantsMouseLook) return;
    resetMouseLook();
    const canvas = gl.domElement;
    let dragging = false;
    const locked = () => document.pointerLockElement === canvas;
    const onPointerDown = () => {
      dragging = true;
    };
    const onPointerUp = () => {
      dragging = false;
    };
    const onDblClick = () => {
      if (!locked()) canvas.requestPointerLock?.();
    };
    const onMove = (event: MouseEvent) => {
      if (!locked() && !dragging) return;
      mouseLook.dx += event.movementX;
      mouseLook.dy += event.movementY;
    };
    const onContext = (event: Event) => event.preventDefault();
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('dblclick', onDblClick);
    canvas.addEventListener('contextmenu', onContext);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('mousemove', onMove);
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('dblclick', onDblClick);
      canvas.removeEventListener('contextmenu', onContext);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('mousemove', onMove);
      if (locked()) document.exitPointerLock?.();
    };
  }, [wantsMouseLook, gl, target?.id]);

  useFrame(() => {
    const camera = cameraRef.current;
    if (!camera || !target?.character) return;
    const cc = { ...defaultCharacter(), ...target.character };
    const [x, y, z] = target.transform.position;

    // Resting offset [side, up, back]. The Set Camera node can override distance/height at runtime.
    const override = overrides[target.id];
    const side = cc.cameraOffset[0];
    const up = override?.height ?? cc.cameraOffset[1];
    const back = override ? -Math.abs(override.distance) : cc.cameraOffset[2];

    // Horizontal radius + base azimuth from the offset, then add mouse yaw; pitch raises/pulls in.
    const radius = Math.hypot(side, back) || 0.001;
    const azimuth = Math.atan2(side, back) + (cc.mouseLook ? lookYaw(cc.mouseSensitivity) : 0);
    const pitch = cc.mouseLook ? lookPitch(cc.cameraPitch, cc.mouseSensitivity, cc.cameraMinPitch, cc.cameraMaxPitch) : cc.cameraPitch;
    const horizontal = radius * Math.cos(pitch);
    desired.current.set(x + Math.sin(azimuth) * horizontal, y + up + Math.sin(pitch) * radius, z + Math.cos(azimuth) * horizontal);
    camera.position.lerp(desired.current, 0.18);
    camera.lookAt(x, y + up * 0.4, z);
  });

  if (!target) return null;
  return <PerspectiveCamera ref={cameraRef} makeDefault fov={50} position={[0, 3, 6]} />;
}
