import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { defaultWaterVolume } from '../store/editor/defaults';
import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import { registerWaterMesh } from './waterShared';

const forward = new THREE.Vector3();
const tmpColor = new THREE.Color();

/**
 * Tints the screen and murks the view whenever the ACTIVE camera (editor orbit, follow, or first-person)
 * dips below a Water Volume whose `underwaterFog` is on. Implemented as a camera-locked full-screen quad
 * so it works with every camera and shows up in screenshots/recordings — no scene.fog fighting the
 * environment system. One instance lives in the viewport; it picks whichever volume the camera is inside.
 */
export function UnderwaterOverlay() {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const { camera } = useThree();

  // Register so the capture pass hides this full-screen tint while re-rendering the scene.
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    return registerWaterMesh(mesh);
  }, []);

  useFrame(() => {
    const mesh = meshRef.current;
    const mat = matRef.current;
    if (!mesh || !mat) return;

    const objects = selectActiveObjects(useEditorStore.getState());
    const cam = camera.position;
    let submersion = 0; // 0 = above water, 1 = well below the surface
    let color: string | null = null;

    for (const object of objects) {
      const water = object.water?.enabled ? { ...defaultWaterVolume(), ...object.water } : null;
      if (!water || !water.underwaterFog) continue;
      const [px, py, pz] = object.transform.position;
      const hx = Math.max(0.001, Math.abs(object.transform.scale[0])) * 0.5;
      const hy = Math.max(0.001, Math.abs(object.transform.scale[1])) * 0.5;
      const hz = Math.max(0.001, Math.abs(object.transform.scale[2])) * 0.5;
      const surfaceY = py + hy;
      // Inside the column and below the surface (small margin so the eyeline transition isn't abrupt).
      if (Math.abs(cam.x - px) > hx || Math.abs(cam.z - pz) > hz) continue;
      if (cam.y > surfaceY + 0.15 || cam.y < py - hy - 2) continue;
      const depth = Math.min(1, Math.max(0, (surfaceY - cam.y) / Math.max(0.6, hy)));
      if (depth >= submersion) {
        submersion = depth;
        color = water.deepColor ?? '#0A3A66';
      }
    }

    if (submersion <= 0.001 || !color) {
      mesh.visible = false;
      return;
    }

    mesh.visible = true;
    tmpColor.set(color);
    mat.color.copy(tmpColor);
    mat.opacity = 0.35 + submersion * 0.45;

    // Lock the quad to the camera, just past the near plane, sized to fill the frustum.
    const persp = camera as THREE.PerspectiveCamera;
    const dist = 0.12;
    const h = 2 * dist * Math.tan(THREE.MathUtils.degToRad((persp.fov ?? 60) / 2));
    const w = h * (persp.aspect ?? 1.6);
    mesh.scale.set(w, h, 1);
    camera.getWorldDirection(forward);
    mesh.position.copy(cam).addScaledVector(forward, dist);
    mesh.quaternion.copy(camera.quaternion);
  });

  return (
    <mesh ref={meshRef} renderOrder={3000} frustumCulled={false} visible={false}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial
        ref={matRef}
        transparent
        opacity={0.5}
        depthTest={false}
        depthWrite={false}
        toneMapped={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
