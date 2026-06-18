import { Suspense, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import * as THREE from 'three';
import { useEditorStore } from '../store/editorStore';
import { SceneObjectView } from './Viewport';
import type { Prefab, SceneObject } from '../types';

const noop = () => {};

/** Downscale a source canvas to a square PNG data URL of `size`px. */
function toThumbnailDataUrl(source: HTMLCanvasElement, size: number): string {
  const out = document.createElement('canvas');
  out.width = size;
  out.height = size;
  const ctx = out.getContext('2d');
  if (!ctx) return source.toDataURL('image/png');
  ctx.drawImage(source, 0, 0, size, size);
  return out.toDataURL('image/png');
}

/**
 * Renders the prefab's objects in an isolated scene, frames the camera to fit them, then captures a
 * PNG after a few frames (giving async models/textures time to load) and reports it back once.
 */
function Capture({ groupRef, onReady }: { groupRef: React.RefObject<THREE.Group>; onReady: (url: string) => void }) {
  const { gl, scene, camera } = useThree();
  const frame = useRef(0);
  const done = useRef(false);

  useFrame(() => {
    if (done.current) return;
    frame.current += 1;

    // Frame the camera to the prefab's bounding box once geometry exists.
    const group = groupRef.current;
    if (group && frame.current === 8) {
      const box = new THREE.Box3().setFromObject(group);
      if (!box.isEmpty()) {
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        const radius = Math.max(sphere.radius, 0.5);
        const dir = new THREE.Vector3(1, 0.7, 1).normalize();
        const dist = radius * 3.0;
        camera.position.copy(sphere.center.clone().add(dir.multiplyScalar(dist)));
        camera.lookAt(sphere.center);
        camera.updateProjectionMatrix();
      }
    }

    // Capture after models have had time to stream in.
    if (frame.current >= 48) {
      done.current = true;
      try {
        gl.render(scene, camera);
        onReady(toThumbnailDataUrl(gl.domElement as HTMLCanvasElement, 128));
      } catch {
        onReady('');
      }
    }
  });

  return null;
}

/**
 * Renders a set of scene objects in an isolated offscreen Canvas and captures a square PNG once they've
 * loaded + the camera has framed them. Shared by the prefab browser preview and the GLB/model-asset
 * preview (ModelThumbnailHost) so both produce identical-looking thumbnails.
 */
export function OffscreenThumbnail({ objects, onCapture }: { objects: SceneObject[]; onCapture: (url: string) => void }) {
  const groupRef = useRef<THREE.Group>(null);

  return (
    <div style={{ position: 'fixed', left: -10000, top: 0, width: 256, height: 256, pointerEvents: 'none', opacity: 0 }}>
      <Canvas
        gl={{ preserveDrawingBuffer: true, alpha: true, antialias: true }}
        camera={{ position: [4, 3, 4], fov: 42 }}
        frameloop="always"
      >
        <color attach="background" args={['#11141c']} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[6, 9, 4]} intensity={1.1} />
        <Suspense fallback={null}>
          <Environment resolution={128}>
            <Lightformer intensity={1.2} position={[0, 6, 0]} scale={[10, 10, 1]} />
            <Lightformer intensity={0.7} position={[6, 3, 4]} scale={[6, 6, 1]} color="#8aa0ff" />
            <Lightformer intensity={0.5} position={[-6, 2, -4]} scale={[6, 6, 1]} color="#ffd6a5" />
          </Environment>
          <group ref={groupRef}>
            {objects.map((object) => (
              <SceneObjectView key={object.id} object={object} selected={false} registerObject={noop} />
            ))}
          </group>
        </Suspense>
        <Capture groupRef={groupRef} onReady={onCapture} />
      </Canvas>
    </div>
  );
}

function PrefabThumbnailer({ prefab, onCapture }: { prefab: Prefab; onCapture: (url: string) => void }) {
  // Only objects with a visual presence; skip world-UI-only anchors.
  const objects = useMemo(() => prefab.objects.filter((object) => !object.viewModel), [prefab.objects]);
  return <OffscreenThumbnail objects={objects} onCapture={onCapture} />;
}

/**
 * Mounted once at the app root. Drains the store's prefab-thumbnail queue one at a time, rendering an
 * offscreen Canvas per prefab to produce its Project-browser preview.
 */
export function PrefabThumbnailHost() {
  const pendingId = useEditorStore((state) => state.prefabThumbnailQueue[0]);
  const prefab = useEditorStore((state) => state.prefabs.find((item) => item.id === state.prefabThumbnailQueue[0]));
  const setPrefabThumbnail = useEditorStore((state) => state.setPrefabThumbnail);
  // Guard so a single render only reports once even if useFrame fires again before unmount.
  const [capturedFor, setCapturedFor] = useState<string | null>(null);

  if (!pendingId || !prefab) return null;

  return (
    <PrefabThumbnailer
      key={pendingId}
      prefab={prefab}
      onCapture={(url) => {
        if (capturedFor === pendingId) return;
        setCapturedFor(pendingId);
        setPrefabThumbnail(pendingId, url);
      }}
    />
  );
}
