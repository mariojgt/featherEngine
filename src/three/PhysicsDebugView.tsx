import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getActivePhysics } from '../runtime/physicsWorld';
import { useEditorStore } from '../store/editorStore';

/**
 * Physics debug view (F10 during Play): renders Rapier's own debug wireframe — every collider,
 * joint, and body EXACTLY as the physics world sees them. The "why doesn't this collide?" tool:
 * mismatched collider sizes, wrong collider type on a scaled model, and misplaced triggers are all
 * instantly visible. Play-only by nature (the Rapier world exists only while playing); the buffers
 * come straight from world.debugRender() each frame, so what you see IS the simulation.
 */
export function PhysicsDebugView() {
  const [open, setOpen] = useState(() => localStorage.getItem('nodeforge.physicsDebug') === '1');
  const lineRef = useRef<THREE.LineSegments>(null);
  const geometryRef = useRef(new THREE.BufferGeometry());
  const capacityRef = useRef(0);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'F10') return;
      event.preventDefault();
      setOpen((prev) => {
        localStorage.setItem('nodeforge.physicsDebug', prev ? '0' : '1');
        return !prev;
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The debug line's buffers are re-uploaded every frame while open; release them on unmount.
  useEffect(() => {
    const geometry = geometryRef.current;
    return () => geometry.dispose();
  }, []);

  useFrame(() => {
    const line = lineRef.current;
    if (!line) return;
    const physics = useEditorStore.getState().isPlaying && open ? getActivePhysics() : null;
    if (!physics) {
      line.visible = false;
      return;
    }
    const { vertices } = physics.debugRender();
    const geometry = geometryRef.current;
    // Grow-only position buffer: reallocate when Rapier reports more lines than we've seen, else
    // copy in place and draw-range down — no per-frame allocation in the steady state.
    if (vertices.length > capacityRef.current) {
      capacityRef.current = Math.ceil(vertices.length * 1.5);
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacityRef.current), 3));
    }
    const attribute = geometry.getAttribute('position') as THREE.BufferAttribute;
    (attribute.array as Float32Array).set(vertices);
    attribute.needsUpdate = true;
    geometry.setDrawRange(0, vertices.length / 3);
    line.visible = true;
  });

  return (
    <lineSegments ref={lineRef} geometry={geometryRef.current} frustumCulled={false} visible={false} renderOrder={999}>
      <lineBasicMaterial color="#3dff88" depthTest={false} transparent opacity={0.85} toneMapped={false} />
    </lineSegments>
  );
}
