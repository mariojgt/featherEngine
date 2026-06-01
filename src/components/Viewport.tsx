import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { ContactShadows, Edges, Environment, Lightformer, OrbitControls, TransformControls } from '@react-three/drei';
import { Move3D, Rotate3D, Scaling, View } from 'lucide-react';
import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import * as THREE from 'three';
import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import { ModelAsset, useAssetTexture, useModelUrl } from '../three/ModelAsset';
import { SkinnedModel } from '../three/SkinnedModel';
import { useResolvedMaterial } from '../three/resolveMaterial';
import { assetDrag, isAssetDrag, readAssetDragId } from './dragShared';
import type { SceneObject } from '../types';

type DropContext = { camera: THREE.Camera; canvas: HTMLCanvasElement };

type TransformMode = 'translate' | 'rotate' | 'scale';

const modes: Array<{ mode: TransformMode; label: string; icon: typeof Move3D }> = [
  { mode: 'translate', label: 'Move', icon: Move3D },
  { mode: 'rotate', label: 'Rotate', icon: Rotate3D },
  { mode: 'scale', label: 'Scale', icon: Scaling },
];

const detectWebGL = () => {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
};

class WebGLErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) return <ViewportFallback />;
    return this.props.children;
  }
}

function Primitive({ object, selected }: { object: SceneObject; selected: boolean }) {
  const renderer = object.renderer;
  const resolved = useResolvedMaterial(renderer);
  const modelUrl = useModelUrl(renderer?.modelAssetId);
  const usingModel = Boolean(renderer?.modelAssetId && modelUrl);
  // Built-in geometries use the standard (flipped) UV convention; only load when not using a model.
  const builtinBaseTexture = useAssetTexture(usingModel ? undefined : resolved.baseColorUrl, true);
  const builtinNormalTexture = useAssetTexture(usingModel ? undefined : resolved.normalUrl, true);

  // A skinned model with an enabled animator plays its clips; otherwise the model is static.
  if (usingModel && object.animator?.enabled) {
    return (
      <Suspense fallback={null}>
        <SkinnedModel
          url={modelUrl as string}
          clip={object.animator.clip}
          speed={object.animator.speed}
          loop={object.animator.loop}
        />
      </Suspense>
    );
  }

  // An imported model replaces the built-in mesh when one is assigned and resolvable.
  if (usingModel) {
    return (
      <Suspense fallback={null}>
        <ModelAsset
          url={modelUrl as string}
          material={{
            color: resolved.color,
            metalness: resolved.metalness,
            roughness: resolved.roughness,
            emissiveColor: resolved.emissiveColor,
            emissiveIntensity: resolved.emissiveIntensity,
            override: resolved.overrideModel,
            baseColorUrl: resolved.baseColorUrl,
            normalUrl: resolved.normalUrl,
          }}
        />
      </Suspense>
    );
  }
  const commonMaterial = (
    <meshStandardMaterial
      color={resolved.color}
      metalness={resolved.metalness}
      roughness={resolved.roughness}
      emissive={resolved.emissiveColor}
      emissiveIntensity={resolved.emissiveIntensity}
      map={builtinBaseTexture ?? null}
      normalMap={builtinNormalTexture ?? null}
    />
  );

  if (object.kind === 'light') {
    return (
      <>
        <directionalLight intensity={2.4} castShadow position={[0, 0, 0]} />
        <mesh>
          <octahedronGeometry args={[0.28, 0]} />
          <meshBasicMaterial color="#F7B955" wireframe={!selected} />
          {selected && <Edges color="#F7B955" scale={1.08} />}
        </mesh>
      </>
    );
  }

  if (object.kind === 'camera') {
    return (
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.32, 0.62, 4]} />
        <meshBasicMaterial color="#3DDC97" wireframe={!selected} />
        {selected && <Edges color="#F7B955" scale={1.08} />}
      </mesh>
    );
  }

  if (!renderer || object.kind === 'empty') {
    return (
      <mesh>
        <boxGeometry args={[0.34, 0.34, 0.34]} />
        <meshBasicMaterial color="#9CA3AF" wireframe />
        {selected && <Edges color="#F7B955" scale={1.2} />}
      </mesh>
    );
  }

  if (renderer.mesh === 'sphere') {
    return (
      <mesh castShadow receiveShadow>
        <sphereGeometry args={[0.55, 32, 24]} />
        {commonMaterial}
        {selected && <Edges color="#F7B955" scale={1.04} />}
      </mesh>
    );
  }

  if (renderer.mesh === 'capsule') {
    return (
      <mesh castShadow receiveShadow>
        <capsuleGeometry args={[0.34, 0.82, 8, 18]} />
        {commonMaterial}
        {selected && <Edges color="#F7B955" scale={1.05} />}
      </mesh>
    );
  }

  if (renderer.mesh === 'plane') {
    return (
      <mesh receiveShadow>
        <planeGeometry args={[1, 1, 12, 12]} />
        {commonMaterial}
        {selected && <Edges color="#F7B955" scale={1.01} />}
      </mesh>
    );
  }

  return (
    <mesh castShadow receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      {commonMaterial}
      {selected && <Edges color="#F7B955" scale={1.03} />}
    </mesh>
  );
}

function SceneObjectView({
  object,
  selected,
  registerObject,
}: {
  object: SceneObject;
  selected: boolean;
  registerObject: (id: string, object: THREE.Group | null) => void;
}) {
  const selectObject = useEditorStore((state) => state.selectObject);

  return (
    <group
      ref={(node) => registerObject(object.id, node)}
      position={object.transform.position}
      rotation={object.transform.rotation}
      scale={object.transform.scale}
      onPointerDown={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        selectObject(object.id);
      }}
    >
      <Primitive object={object} selected={selected} />
    </group>
  );
}

function SceneContent({ transformMode }: { transformMode: TransformMode }) {
  const sceneObjects = useEditorStore(selectActiveObjects);
  const selectedObjectId = useEditorStore((state) => state.selectedObjectId);
  const selectObject = useEditorStore((state) => state.selectObject);
  const updateTransform = useEditorStore((state) => state.updateTransform);
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const objectRefs = useRef(new Map<string, THREE.Group>());
  const [selectedTarget, setSelectedTarget] = useState<THREE.Group | null>(null);

  const registerObject = useCallback(
    (id: string, object: THREE.Group | null) => {
      if (object) {
        objectRefs.current.set(id, object);
        if (id === selectedObjectId) setSelectedTarget(object);
        return;
      }

      objectRefs.current.delete(id);
      if (id === selectedObjectId) setSelectedTarget(null);
    },
    [selectedObjectId],
  );

  useEffect(() => {
    setSelectedTarget(objectRefs.current.get(selectedObjectId) ?? null);
  }, [selectedObjectId, sceneObjects.length]);

  const syncSelectedTransform = useCallback(() => {
    const target = objectRefs.current.get(selectedObjectId);
    if (!target) return;

    updateTransform(selectedObjectId, 'position', [target.position.x, target.position.y, target.position.z]);
    updateTransform(selectedObjectId, 'rotation', [target.rotation.x, target.rotation.y, target.rotation.z]);
    updateTransform(selectedObjectId, 'scale', [target.scale.x, target.scale.y, target.scale.z]);
  }, [selectedObjectId, updateTransform]);

  return (
    <>
      <color attach="background" args={['#0F1117']} />
      <fog attach="fog" args={['#0F1117', 14, 28]} />
      <ambientLight intensity={0.62} />
      <directionalLight position={[6, 9, 4]} intensity={1.1} />
      {/* Self-contained environment (no external HDRI fetch) so it works offline and under the desktop CSP. */}
      <Environment resolution={256}>
        <Lightformer intensity={1.2} position={[0, 6, 0]} scale={[10, 10, 1]} />
        <Lightformer intensity={0.7} position={[6, 3, 4]} scale={[6, 6, 1]} color="#8aa0ff" />
        <Lightformer intensity={0.5} position={[-6, 2, -4]} scale={[6, 6, 1]} color="#ffd6a5" />
      </Environment>
      <group onPointerMissed={() => selectObject('')}>
        {sceneObjects.map((object) => (
          <SceneObjectView
            key={object.id}
            object={object}
            selected={object.id === selectedObjectId}
            registerObject={registerObject}
          />
        ))}
      </group>
      {selectedTarget && !isPlaying && (
        <TransformControls
          object={selectedTarget}
          mode={transformMode}
          size={0.95}
          onObjectChange={syncSelectedTransform}
          space="local"
        />
      )}
      <gridHelper args={[24, 24, '#30394D', '#202737']} position={[0, 0.01, 0]} />
      <ContactShadows position={[0, -0.01, 0]} opacity={0.36} scale={14} blur={2.4} far={6} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.07} minDistance={2.5} maxDistance={18} />
    </>
  );
}

function ViewportFallback() {
  const sceneObjects = useEditorStore(selectActiveObjects);
  const selectedObjectId = useEditorStore((state) => state.selectedObjectId);
  const selectObject = useEditorStore((state) => state.selectObject);

  return (
    <div className="viewport-fallback">
      <div className="fallback-stage">
        {sceneObjects.slice(0, 5).map((object, index) => (
          <button
            key={object.id}
            className={object.id === selectedObjectId ? 'selected' : undefined}
            onClick={() => selectObject(object.id)}
            style={{
              left: `${Math.min(Math.max(16 + index * 15 + object.transform.position[0] * 5, 8), 78)}%`,
              bottom: `${Math.min(Math.max(18 + (index % 3) * 18 - object.transform.position[2] * 4, 12), 72)}%`,
            }}
          >
            {object.name}
          </button>
        ))}
      </div>
      <div className="fallback-copy">
        <strong>WebGL unavailable</strong>
        <span>The editor UI is still active. Open in a WebGL-capable browser to render the 3D scene.</span>
      </div>
    </div>
  );
}

/** Lives inside the Canvas so it can expose the live camera + canvas DOM node for drop raycasting. */
function DropController({ contextRef }: { contextRef: MutableRefObject<DropContext | null> }) {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  useEffect(() => {
    contextRef.current = { camera, canvas: gl.domElement };
    return () => {
      contextRef.current = null;
    };
  }, [camera, gl, contextRef]);
  return null;
}

export function ViewportPanel() {
  const [transformMode, setTransformMode] = useState<TransformMode>('translate');
  const hasWebGL = useMemo(detectWebGL, []);
  const isPlaying = useEditorStore((state) => state.isPlaying);

  // Drag-and-drop a model from the project browser onto the ground under the cursor.
  const dropContextRef = useRef<DropContext | null>(null);
  const groundPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);

  const handleDragOver = useCallback((event: React.DragEvent) => {
    // Rely on the shared holder (the webview may hide our custom type during dragover).
    if (!isAssetDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      const assetId = readAssetDragId(event.dataTransfer);
      assetDrag.id = null;
      if (!assetId) return;
      event.preventDefault();
      event.stopPropagation();
      const store = useEditorStore.getState();
      const asset = store.assets.find((item) => item.id === assetId);
      if (!asset) return;
      if (asset.type !== 'model') {
        useProjectStore.setState({
          toast: { kind: 'error', message: 'Only 3D models can be dropped into the scene.' },
        });
        return;
      }

      // Project the cursor onto the ground plane (y=0); fall back to the origin if unavailable.
      let position: [number, number, number] = [0, 0, 0];
      const ctx = dropContextRef.current;
      if (ctx) {
        const rect = ctx.canvas.getBoundingClientRect();
        const ndc = new THREE.Vector2(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          -((event.clientY - rect.top) / rect.height) * 2 + 1,
        );
        raycaster.setFromCamera(ndc, ctx.camera);
        const hit = new THREE.Vector3();
        if (raycaster.ray.intersectPlane(groundPlane, hit)) {
          position = [Number(hit.x.toFixed(2)), 0, Number(hit.z.toFixed(2))];
        }
      }

      const name = asset.name.replace(/\.[^./\\]+$/, '');
      const id = store.createObjectWithProps('cube', { name, position });
      store.setObjectModel(id, assetId);
    },
    [groundPlane, raycaster],
  );

  return (
    <section className="viewport-panel">
      <div className="viewport-topbar">
        <div className="viewport-title">
          <View size={16} aria-hidden />
          <span>Viewport</span>
        </div>
        <span className={isPlaying ? 'viewport-mode running' : 'viewport-mode'}>
          {isPlaying ? 'Preview Running' : 'Edit Mode'}
        </span>
        <div className="segmented" aria-label="Transform mode">
          {modes.map(({ mode, label, icon: Icon }) => (
            <button
              key={mode}
              className={transformMode === mode ? 'active' : undefined}
              title={label}
              onClick={() => setTransformMode(mode)}
            >
              <Icon size={15} aria-hidden />
            </button>
          ))}
        </div>
      </div>
      <div className="scene-drop-zone" onDragOverCapture={handleDragOver} onDropCapture={handleDrop}>
        {hasWebGL ? (
          <WebGLErrorBoundary>
            <Canvas className="scene-canvas" shadows camera={{ position: [6, 4.2, 7], fov: 46 }}>
              <SceneContent transformMode={transformMode} />
              <DropController contextRef={dropContextRef} />
            </Canvas>
          </WebGLErrorBoundary>
        ) : (
          <ViewportFallback />
        )}
      </div>
    </section>
  );
}
