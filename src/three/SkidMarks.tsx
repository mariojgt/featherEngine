import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useEditorStore } from '../store/editorStore';
import { clearSkidMarks, MAX_SKID_SEGMENTS, skidMarks } from '../runtime/skidMarks';

const dummy = new THREE.Object3D();
const colorScratch = new THREE.Color();

/**
 * Draws the persistent tire skid marks laid by vehicles (see runtime/skidMarks) as one instanced
 * mesh of flat dark quads hovering just above the ground — no per-mark React state, a single draw
 * call for up to MAX_SKID_SEGMENTS marks. Strength sets each mark's darkness; marks age out by
 * shrinking + lightening over their last seconds. Mounted in the editor viewport AND the player.
 */
export function SkidMarks() {
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const meshRef = useRef<THREE.InstancedMesh>(null);

  // Fresh track every Play session.
  useEffect(() => {
    if (isPlaying) clearSkidMarks();
    return () => clearSkidMarks();
  }, [isPlaying]);

  const geometry = useMemo(() => new THREE.PlaneGeometry(0.2, 0.62), []);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
        // Pull toward the camera in depth so marks never z-fight the track surface they sit on.
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    [],
  );

  useFrame((_, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const segments = skidMarks.segments;
    let count = 0;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (seg.life <= 0) continue;
      seg.life -= delta;
      // Fade tail: full presence until the last 3.5s, then shrink + lighten away.
      const fade = Math.min(1, Math.max(0, seg.life / 3.5));
      const scale = (0.7 + 0.5 * seg.strength) * (0.35 + 0.65 * fade);
      dummy.position.set(seg.x, seg.y, seg.z);
      dummy.rotation.set(-Math.PI / 2, 0, -seg.yaw);
      dummy.scale.set(scale, scale, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(count, dummy.matrix);
      // Rubber darkness from strength; aged marks lighten toward the road instead of popping off.
      const shade = 0.32 - 0.24 * seg.strength * fade;
      mesh.setColorAt(count, colorScratch.setRGB(shade, shade, shade + 0.012));
      count += 1;
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  if (!isPlaying) return null;
  return <instancedMesh ref={meshRef} args={[geometry, material, MAX_SKID_SEGMENTS]} frustumCulled={false} />;
}
