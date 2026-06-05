import { PerspectiveCamera } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { Suspense, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { defaultCharacter, selectActiveObjects, useEditorStore } from '../store/editorStore';
import { cameraPitch as lookPitch, cameraYaw as lookYaw, mouseLook, resetMouseLook } from '../runtime/mouseLook';
import { SkinnedModel, useResolvedAnimator } from './SkinnedModel';
import type { CharacterControllerComponent, SceneObject } from '../types';

/**
 * Normalize a follow-camera config from EITHER a character controller OR a vehicle controller, so the
 * one rich follow camera (spring arm, zoom, look-ahead, mouse orbit) serves both pawns and cars. A
 * vehicle's camera fields are mapped onto a character-shaped config (third-person, no camera-relative
 * movement); `moveSpeed` is set to the car's top speed so the sprint-FOV / look-ahead scale sensibly.
 */
export function resolveCameraConfig(object: SceneObject | undefined): CharacterControllerComponent | undefined {
  if (!object) return undefined;
  if (object.character?.enabled && object.character.cameraFollow) return { ...defaultCharacter(), ...object.character };
  if (object.vehicle?.enabled && object.vehicle.cameraFollow) {
    const v = object.vehicle;
    return {
      ...defaultCharacter(),
      enabled: true,
      cameraMode: 'thirdPerson',
      cameraFollow: true,
      cameraOffset: v.cameraOffset,
      cameraPitch: v.cameraPitch,
      cameraMinPitch: v.cameraMinPitch,
      cameraMaxPitch: v.cameraMaxPitch,
      mouseLook: v.mouseLook,
      mouseSensitivity: v.mouseSensitivity,
      moveSpeed: v.maxSpeed,
      sprintMultiplier: 1,
      cameraRelativeMovement: false,
      modelYawOffset: 0,
    };
  }
  return undefined;
}

/** Reusable zero vector for relaxing the look-ahead offset back to center when idle (avoids per-frame allocs). */
const ZERO = new THREE.Vector3();

/** True if `object3d` (or any ancestor) is the rendered group of scene object `objectId`. */
function belongsToObject(object3d: THREE.Object3D | null, objectId: string): boolean {
  let node: THREE.Object3D | null = object3d;
  while (node) {
    if (node.userData?.nfObjectId === objectId) return true;
    node = node.parent;
  }
  return false;
}

function sceneObjectIdFor(object3d: THREE.Object3D | null): string | undefined {
  let node: THREE.Object3D | null = object3d;
  while (node) {
    const id = node.userData?.nfObjectId;
    if (typeof id === 'string') return id;
    node = node.parent;
  }
  return undefined;
}

/** The first active-scene object whose character OR vehicle controller wants a follow camera. */
export function useFollowTarget(): SceneObject | undefined {
  const objects = useEditorStore(selectActiveObjects);
  return objects.find(
    (object) =>
      (object.character?.enabled && object.character.cameraFollow) ||
      (object.vehicle?.enabled && object.vehicle.cameraFollow),
  );
}

export interface CameraPose {
  position: THREE.Vector3;
  lookAt: THREE.Vector3;
  fov: number;
}

/**
 * The camera's RESTING pose from a character's controller settings — i.e. where the follow camera
 * sits before any mouse-look is applied. This is the single source of truth shared by the live
 * camera frustum in the editor (so adjusting Side/Up/Back/Pitch/Mode shows immediate feedback) and
 * the Play / preview camera below, so the indicator and the real camera can never disagree.
 */
export function computeRestingCameraPose(target: SceneObject): CameraPose {
  const cc = resolveCameraConfig(target) ?? { ...defaultCharacter(), ...(target.character ?? {}) };
  const [x, y, z] = target.transform.position;

  if (cc.cameraMode === 'firstPerson') {
    const yaw = target.transform.rotation[1] - cc.modelYawOffset;
    const pitch = cc.cameraPitch;
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const position = new THREE.Vector3(x, y + cc.cameraOffset[1], z)
      .addScaledVector(right, cc.cameraOffset[0])
      .addScaledVector(forward, cc.cameraOffset[2]);
    const look = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    return { position, lookAt: position.clone().add(look), fov: 68 };
  }

  const side = cc.cameraOffset[0];
  const up = cc.cameraOffset[1];
  const back = cc.cameraOffset[2];
  const radius = Math.hypot(side, back) || 0.001;
  const azimuth = Math.atan2(side, back);
  const pitch = cc.cameraPitch;
  const horizontal = radius * Math.cos(pitch);
  const position = new THREE.Vector3(
    x + Math.sin(azimuth) * horizontal,
    y + up + Math.sin(pitch) * radius,
    z + Math.cos(azimuth) * horizontal,
  );
  return { position, lookAt: new THREE.Vector3(x, y + up * 0.4, z), fov: 50 };
}

function CameraViewModel({ object }: { object: SceneObject }) {
  const resolvedAnimator = useResolvedAnimator(object);
  if (!object.animator?.enabled || !resolvedAnimator.meshUrl) return null;

  return (
    <Suspense fallback={null}>
      <SkinnedModel
        meshUrl={resolvedAnimator.meshUrl}
        clipSourceUrls={resolvedAnimator.clipSourceUrls}
        clipName={resolvedAnimator.clipName}
        speed={resolvedAnimator.speed}
        loop={resolvedAnimator.loop}
        fade={resolvedAnimator.fade}
        registerId={object.id}
      />
    </Suspense>
  );
}

function CameraViewModelMount({ object, owner }: { object: SceneObject; owner: SceneObject }) {
  const groupRef = useRef<THREE.Group>(null);
  const runtimeKeys = useEditorStore((state) => state.runtimeKeys);

  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group) return;
    const cc = { ...defaultCharacter(), ...(owner.character ?? {}) };
    const moving = Boolean(
      runtimeKeys[cc.keyForward] ||
        runtimeKeys[cc.keyBackward] ||
        runtimeKeys[cc.keyLeft] ||
        runtimeKeys[cc.keyRight] ||
        runtimeKeys.ArrowUp ||
        runtimeKeys.ArrowDown ||
        runtimeKeys.ArrowLeft ||
        runtimeKeys.ArrowRight,
    );
    const sprinting = moving && Boolean(runtimeKeys[cc.keySprint]);
    const time = clock.elapsedTime;
    const bob = moving ? (sprinting ? 0.04 : 0.028) : 0.006;
    const targetX = object.transform.position[0] + Math.sin(time * (sprinting ? 11 : 8)) * bob * 0.45;
    const targetY = object.transform.position[1] + Math.cos(time * (sprinting ? 22 : 16)) * bob * 0.32;
    const targetZ = object.transform.position[2] + (moving ? Math.sin(time * (sprinting ? 11 : 8)) * bob * 0.18 : 0);
    group.position.lerp(new THREE.Vector3(targetX, targetY, targetZ), 0.22);
    group.rotation.x = THREE.MathUtils.lerp(group.rotation.x, object.transform.rotation[0] + Math.cos(time * 8) * bob * 0.4, 0.18);
    group.rotation.y = THREE.MathUtils.lerp(group.rotation.y, object.transform.rotation[1], 0.18);
    group.rotation.z = THREE.MathUtils.lerp(group.rotation.z, object.transform.rotation[2] + Math.sin(time * 8) * bob * 0.35, 0.18);
    group.scale.set(object.transform.scale[0], object.transform.scale[1], object.transform.scale[2]);
  });

  return (
    <group
      ref={groupRef}
      position={object.transform.position}
      rotation={object.transform.rotation}
      scale={object.transform.scale}
    >
      <CameraViewModel object={object} />
    </group>
  );
}

/**
 * A third-person camera that trails the character controller's object. When the character has
 * `mouseLook`, clicking the view captures the pointer and the mouse orbits the camera (yaw/pitch);
 * the deltas live in the shared `mouseLook` module so the runtime can make movement camera-relative.
 * Otherwise it simply sits behind the character's facing. Renders nothing without a follow target.
 */
export function FollowCamera({ preview = false }: { preview?: boolean }) {
  const target = useFollowTarget();
  const objects = useEditorStore(selectActiveObjects);
  const runtimeHidden = useEditorStore((state) => state.runtimeHidden);
  const allViewModels = target ? objects.filter((object) => object.viewModel?.ownerObjectId === target.id) : [];
  // During Play, respect Set Visible so a weapon picker that holsters the others shows only the equipped
  // one. In the editor preview the picker hasn't run (nothing hidden yet), so just show the first weapon.
  const viewModels = preview ? allViewModels.slice(0, 1) : allViewModels.filter((object) => !runtimeHidden.includes(object.id));
  const overrides = useEditorStore((state) => state.runtimeCameraOverrides);
  const cameraRef = useRef<THREE.PerspectiveCamera>(null);
  const desired = useRef(new THREE.Vector3());
  const rawTarget = useRef(new THREE.Vector3());
  const smoothedTarget = useRef(new THREE.Vector3());
  const smoothedTargetId = useRef<string | undefined>(undefined);
  const smoothedVelocity = useRef(new THREE.Vector3());
  const lookTarget = useRef(new THREE.Vector3());
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  // Spring-arm collision raycaster + smoothed aim-down-sights blend (0 = hip, 1 = aiming).
  const springRay = useRef(new THREE.Raycaster());
  const springArmDistance = useRef<number | undefined>(undefined);
  const adsBlend = useRef(0);
  // Camera-polish state: smoothed sprint-FOV boost, a velocity-derived look-ahead offset, and the
  // previous target position used to estimate that velocity frame-to-frame.
  const sprintBlend = useRef(0);
  // Vehicles widen the FOV with speed (the "sense of speed" a chase cam gives) — smoothed so it eases in
  // rather than pumping with every velocity wobble.
  const speedFovBlend = useRef(0);
  const lookAhead = useRef(new THREE.Vector3());
  // Mouse-wheel zoom: a distance multiplier on the resting offset (1 = authored distance). Scroll in/out,
  // clamped so you can't zoom inside the character or absurdly far. Smoothed toward its target each frame.
  const zoomTarget = useRef(1);
  const zoom = useRef(1);
  // Auto-follow: when moving and NOT actively steering with the mouse, the camera gently swings to trail the
  // travel heading (AAA TPS feel). These track recent mouse activity so manual look always wins.
  const lastMouseDx = useRef(0);
  const lastMouseDy = useRef(0);
  const mouseIdle = useRef(0);

  // Normalize so a controller created before `mouseLook` existed still enables the camera.
  // In `preview` mode (editor, not playing) we deliberately ignore mouse-look so tuning the camera
  // offset/pitch shows a stable resting framing and never hijacks the editor pointer.
  const useMouse = Boolean(resolveCameraConfig(target)?.mouseLook) && Boolean(target) && !preview;
  const wantsMouseLook = useMouse;

  // Mouse-look. Two ways, both supported so it always works: (1) click to capture the pointer
  // (Unreal-style free-look, ESC releases), or (2) click-drag in the view to orbit. Active only
  // while a mouse-look follow target is mounted (i.e. during Play), so it never hijacks the editor.
  useEffect(() => {
    if (!wantsMouseLook) return;
    resetMouseLook();
    zoomTarget.current = 1;
    zoom.current = 1;
    const canvas = gl.domElement;
    let dragging = false;
    const locked = () => document.pointerLockElement === canvas;
    // Mouse wheel zooms the camera in/out (scales the resting distance). preventDefault stops the page scrolling.
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomTarget.current = THREE.MathUtils.clamp(zoomTarget.current + event.deltaY * 0.0012, 0.45, 2.2);
    };
    const onPointerDown = () => {
      dragging = true;
      // First click in the viewport captures the pointer (this also hides the OS cursor
      // natively), so you can't accidentally click the scene behind the game. ESC releases.
      if (!locked()) canvas.requestPointerLock?.();
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
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('mousemove', onMove);
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('dblclick', onDblClick);
      canvas.removeEventListener('contextmenu', onContext);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('mousemove', onMove);
      if (locked()) document.exitPointerLock?.();
    };
  }, [wantsMouseLook, gl, target?.id]);

  useFrame((_, delta) => {
    const camera = cameraRef.current;
    const ccResolved = resolveCameraConfig(target);
    if (!camera || !target || !ccResolved) return;
    const cc = ccResolved;
    const [rawX, rawY, rawZ] = target.transform.position;
    // Framerate-independent smoothing factor for a given responsiveness `k` (higher = snappier).
    const smooth = (k: number) => 1 - Math.exp(-k * Math.min(delta, 0.1));

    // Camera shake: the runtime owns a decaying trauma scalar (fire/hurt/explosions/Camera Shake node).
    // Turn it into a positional jitter + a roll/pitch kick, applied AFTER the camera is positioned each
    // frame (call applyShake() at every exit). Eased by t² so small trauma is subtle, big trauma snaps.
    const shakeT = preview ? 0 : useEditorStore.getState().runtimeCameraShake;
    const applyShake = () => {
      if (shakeT <= 0.0001) return;
      const t = shakeT * shakeT;
      const ti = performance.now() * 0.001;
      camera.position.x += (Math.sin(ti * 54.7) + Math.sin(ti * 97.3)) * t * 0.16;
      camera.position.y += (Math.sin(ti * 63.1) + Math.sin(ti * 108.9)) * t * 0.16;
      camera.position.z += Math.sin(ti * 71.3) * t * 0.1;
      camera.rotateX(Math.sin(ti * 73.9) * t * 0.035);
      camera.rotateZ(Math.sin(ti * 46.1) * t * 0.05);
    };

    // Aim-down-sights: hold the aim key (keyAim) → smoothly zoom in + tuck the camera closer. Read keys
    // via getState so the camera frame loop doesn't re-subscribe on every keypress.
    const aiming = !preview && Boolean(useEditorStore.getState().runtimeKeys[cc.keyAim]);
    adsBlend.current = THREE.MathUtils.lerp(adsBlend.current, aiming ? 1 : 0, smooth(14));
    const ads = adsBlend.current;

    if (cc.cameraMode === 'firstPerson') {
      const yaw = cc.mouseLook && useMouse ? lookYaw(cc.mouseSensitivity) : target.transform.rotation[1] - cc.modelYawOffset;
      const pitch = cc.mouseLook && useMouse ? lookPitch(cc.cameraPitch, cc.mouseSensitivity, cc.cameraMinPitch, cc.cameraMaxPitch) : cc.cameraPitch;
      const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      desired.current
        .set(rawX, rawY + cc.cameraOffset[1], rawZ)
        .addScaledVector(right, cc.cameraOffset[0])
        .addScaledVector(forward, cc.cameraOffset[2]);

      const look = new THREE.Vector3(
        Math.sin(yaw) * Math.cos(pitch),
        Math.sin(pitch),
        Math.cos(yaw) * Math.cos(pitch),
      );
      camera.position.copy(desired.current);
      camera.lookAt(desired.current.clone().add(look));
      const fpFov = THREE.MathUtils.lerp(68, 50, ads);
      if (Math.abs(camera.fov - fpFov) > 0.05) {
        camera.fov = fpFov;
        camera.updateProjectionMatrix();
      }
      applyShake();
      return;
    }

    rawTarget.current.set(rawX, rawY, rawZ);
    if (smoothedTargetId.current !== target.id || preview) {
      smoothedTarget.current.copy(rawTarget.current);
      smoothedVelocity.current.set(0, 0, 0);
      smoothedTargetId.current = target.id;
      springArmDistance.current = undefined;
    } else {
      const horizontalT = smooth(target.vehicle?.enabled ? 24 : 18);
      const verticalT = smooth(target.vehicle?.enabled ? 18 : 6);
      smoothedTarget.current.x = THREE.MathUtils.lerp(smoothedTarget.current.x, rawTarget.current.x, horizontalT);
      smoothedTarget.current.y = THREE.MathUtils.lerp(smoothedTarget.current.y, rawTarget.current.y, verticalT);
      smoothedTarget.current.z = THREE.MathUtils.lerp(smoothedTarget.current.z, rawTarget.current.z, horizontalT);
    }
    const x = smoothedTarget.current.x;
    const y = smoothedTarget.current.y;
    const z = smoothedTarget.current.z;

    // Sprint speed-feel: while sprinting, smoothly widen the FOV (sense of speed). Read keys via getState so
    // the frame loop doesn't re-subscribe per keypress; preview (editor) never sprints.
    const keys = preview ? {} : useEditorStore.getState().runtimeKeys;
    const moving = Boolean(keys[cc.keyForward] || keys[cc.keyBackward] || keys[cc.keyLeft] || keys[cc.keyRight]);
    const sprinting = moving && Boolean(keys[cc.keySprint]);
    sprintBlend.current = THREE.MathUtils.lerp(sprintBlend.current, sprinting ? 1 : 0, smooth(6));

    // Look-ahead: lead the camera toward where the character is moving so you see more ahead. Driven by the
    // runtime's ALREADY-SMOOTHED horizontal velocity (accel/decel ramped) rather than a raw frame-to-frame
    // position delta — the delta spikes for a frame when the physics body depenetrates from geometry or you
    // reverse direction, which read as a camera "snap". The smoothed velocity never spikes, so the lead glides.
    const rv = preview ? undefined : useEditorStore.getState().runtimeVelocities[target.id];
    if (rv) {
      rawTarget.current.set(rv[0], 0, rv[2]).clampLength(0, cc.moveSpeed * cc.sprintMultiplier);
      smoothedVelocity.current.lerp(rawTarget.current, smooth(target.vehicle?.enabled ? 10 : 8));
      const lead = rawTarget.current.copy(smoothedVelocity.current).multiplyScalar(target.vehicle?.enabled ? 0.14 : 0.08);
      lookAhead.current.lerp(lead, smooth(4));
    } else {
      smoothedVelocity.current.lerp(ZERO, smooth(8));
      lookAhead.current.lerp(ZERO, smooth(4));
    }

    // Auto-follow: ease the camera behind the travel heading when moving, UNLESS the player is actively steering
    // (any recent mouse motion resets the idle timer and wins) or aiming. We nudge the shared mouse-look yaw
    // itself — angularly, shortest-path — so camera-relative movement stays perfectly in sync with the camera.
    const mouseMoved = Math.abs(mouseLook.dx - lastMouseDx.current) > 0.5 || Math.abs(mouseLook.dy - lastMouseDy.current) > 0.5;
    lastMouseDx.current = mouseLook.dx;
    lastMouseDy.current = mouseLook.dy;
    mouseIdle.current = mouseMoved ? 0 : mouseIdle.current + delta;
    const speed = Math.hypot(smoothedVelocity.current.x, smoothedVelocity.current.z);
    if (cc.mouseLook && useMouse && !aiming && speed > 0.6 && mouseIdle.current > 0.35) {
      const heading = Math.atan2(smoothedVelocity.current.x, smoothedVelocity.current.z);
      const curYaw = -mouseLook.dx * cc.mouseSensitivity;
      const diff = Math.atan2(Math.sin(heading - curYaw), Math.cos(heading - curYaw));
      const newYaw = curYaw + diff * smooth(1.4); // gentle so it trails, never whips
      mouseLook.dx = -newYaw / cc.mouseSensitivity;
    }

    // Resting offset [side, up, back]. The Set Camera node can override distance/height at runtime; the mouse
    // wheel scales the distance (zoom), smoothed so a scroll glides in/out instead of jumping.
    zoom.current = THREE.MathUtils.lerp(zoom.current, zoomTarget.current, smooth(12));
    const override = overrides[target.id];
    const baseSide = cc.cameraOffset[0] * zoom.current;
    const up = override?.height ?? cc.cameraOffset[1];
    const baseBack = (override ? -Math.abs(override.distance) : cc.cameraOffset[2]) * zoom.current;
    const side = THREE.MathUtils.lerp(baseSide, baseSide + 0.7, ads); // shift to the shoulder
    const back = THREE.MathUtils.lerp(baseBack, baseBack * 0.5, ads); // pull in

    // Velocity feed-forward: an exponential follow lags a moving target by ~speed/k, which reads as the
    // character constantly sliding toward the front of frame — the "camera always trailing" feel. Add that
    // predicted lag back into the target (off the ALREADY-SMOOTHED velocity, so it never snaps) so the camera
    // lands ON the moving character and keeps its resting framing while walking/sprinting. (followK also
    // sets the follow stiffness below — raised from 12 so the catch-up is a touch snappier, not rubber-bandy.)
    const followK = 16;
    const feedFwd = rawTarget.current.copy(smoothedVelocity.current).multiplyScalar(target.vehicle?.enabled ? 1 / followK : 0);

    // Horizontal radius + base azimuth from the offset, then add mouse yaw; pitch raises/pulls in.
    const radius = Math.hypot(side, back) || 0.001;
    const azimuth = Math.atan2(side, back) + (cc.mouseLook && useMouse ? lookYaw(cc.mouseSensitivity) : 0);
    const pitch = cc.mouseLook && useMouse ? lookPitch(cc.cameraPitch, cc.mouseSensitivity, cc.cameraMinPitch, cc.cameraMaxPitch) : cc.cameraPitch;
    const horizontal = radius * Math.cos(pitch);
    desired.current
      .set(x + Math.sin(azimuth) * horizontal, y + up + Math.sin(pitch) * radius, z + Math.cos(azimuth) * horizontal)
      .add(lookAhead.current)
      .add(feedFwd);

    // Spring-arm: cast from the pivot (over the character) toward the desired camera spot; if a wall is in
    // the way, pull the camera in to just before it so it never clips through geometry. Point-blank hits
    // (the character's own body, < 0.6u) are ignored.
    const pivot = new THREE.Vector3(x, y + up, z).add(lookAhead.current);
    const toCam = desired.current.clone().sub(pivot);
    const wanted = toCam.length();
    if (wanted > 0.001) {
      toCam.divideScalar(wanted);
      springRay.current.set(pivot, toCam);
      springRay.current.far = wanted;
      const hits = springRay.current.intersectObjects(scene.children, true);
      const objectById = new Map(objects.map((object) => [object.id, object]));
      const hiddenNow = new Set(useEditorStore.getState().runtimeHidden);
      // Ignore the followed character's own meshes — otherwise the spring arm collides with the very
      // body it's trailing and snaps the camera inside it, filling the screen (a black view) — AND ignore
      // the terrain/foliage (tagged userData.nfGround), so the camera never pulls in on the ground or grass.
      const isGround = (obj: THREE.Object3D | null) => {
        for (let o = obj; o; o = o.parent) if (o.userData?.nfGround) return true;
        return false;
      };
      const isCameraBlocker = (hit: THREE.Intersection) => {
        if (hit.distance <= 0.6 || belongsToObject(hit.object, target.id) || isGround(hit.object)) return false;
        const id = sceneObjectIdFor(hit.object);
        if (!id || hiddenNow.has(id)) return false;
        const object = objectById.get(id);
        if (!object) return false;
        if (object.viewModel?.ownerObjectId === target.id) return false;
        if (object.kind === 'camera' || object.kind === 'empty' || object.kind === 'light' || object.projectile || object.effect) return false;
        if (object.renderer?.enabled === false || object.renderer?.hideInPlay || object.physics?.isTrigger) return false;
        return Boolean(object.physics?.enabled || object.terrain?.enabled);
      };
      const wall = hits.find(isCameraBlocker);
      const targetDistance = wall ? Math.max(0.6, wall.distance - 0.28) : wanted;
      const currentDistance = springArmDistance.current ?? targetDistance;
      springArmDistance.current = THREE.MathUtils.lerp(
        currentDistance,
        targetDistance,
        smooth(targetDistance < currentDistance ? 24 : 9),
      );
      desired.current.copy(pivot).addScaledVector(toCam, springArmDistance.current);
    }

    // Framerate-independent follow lag (paired with the velocity feed-forward above, so it eases transients
    // — turns, stops, wall pull-ins — without leaving a steady trail while moving at constant speed).
    camera.position.lerp(desired.current, smooth(followK));
    lookTarget.current.set(x + lookAhead.current.x, y + up * 0.42, z + lookAhead.current.z);
    camera.lookAt(lookTarget.current);
    // Vehicle speed-feel: ramp the FOV out toward +10° as the car approaches its top speed (cc.moveSpeed is
    // the vehicle's maxSpeed). Characters never trip this (speedFovTarget stays 0), so their FOV is unchanged.
    const speedFovTarget = target.vehicle?.enabled ? Math.min(1, speed / Math.max(0.001, cc.moveSpeed)) : 0;
    speedFovBlend.current = THREE.MathUtils.lerp(speedFovBlend.current, speedFovTarget, smooth(3));
    const tpFov = THREE.MathUtils.lerp(50, 40, ads) + sprintBlend.current * 7 + speedFovBlend.current * 10;
    if (Math.abs(camera.fov - tpFov) > 0.05) {
      camera.fov = tpFov;
      camera.updateProjectionMatrix();
    }
    applyShake();
  });

  if (!target) return null;
  const cc = resolveCameraConfig(target) ?? { ...defaultCharacter(), ...target.character };
  return (
    <PerspectiveCamera ref={cameraRef} makeDefault fov={cc.cameraMode === 'firstPerson' ? 68 : 50} near={0.02} position={[0, 3, 6]}>
      {/* First-person view-model (arms/weapon) — shown in Play AND in the editor camera preview, so you
          can see the equipped weapon and its idle animation while looking through the player camera. */}
      {cc.cameraMode === 'firstPerson'
        ? viewModels.map((object) => (
            <CameraViewModelMount key={object.id} object={object} owner={target} />
          ))
        : null}
    </PerspectiveCamera>
  );
}
