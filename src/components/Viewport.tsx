import { Canvas, type ThreeEvent } from '@react-three/fiber';
import { ContactShadows, Edges, Environment, OrbitControls, TransformControls } from '@react-three/drei';
import { Move3D, Rotate3D, Scaling, View } from 'lucide-react';
import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type * as THREE from 'three';
import { useEditorStore } from '../store/editorStore';
import type { SceneObject } from '../types';

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
  const color = renderer?.color ?? '#9CA3AF';
  const commonMaterial = (
    <meshStandardMaterial
      color={color}
      metalness={renderer?.metalness ?? 0.08}
      roughness={renderer?.roughness ?? 0.72}
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
  const sceneObjects = useEditorStore((state) => state.sceneObjects);
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
      <Suspense fallback={null}>
        <Environment preset="city" />
      </Suspense>
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
  const sceneObjects = useEditorStore((state) => state.sceneObjects);
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

export function ViewportPanel() {
  const [transformMode, setTransformMode] = useState<TransformMode>('translate');
  const hasWebGL = useMemo(detectWebGL, []);
  const isPlaying = useEditorStore((state) => state.isPlaying);

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
      {hasWebGL ? (
        <WebGLErrorBoundary>
          <Canvas className="scene-canvas" shadows camera={{ position: [6, 4.2, 7], fov: 46 }}>
            <SceneContent transformMode={transformMode} />
          </Canvas>
        </WebGLErrorBoundary>
      ) : (
        <ViewportFallback />
      )}
    </section>
  );
}
