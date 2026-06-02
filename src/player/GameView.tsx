import { Canvas } from '@react-three/fiber';
import { ContactShadows, Environment, Lightformer, OrbitControls, PerspectiveCamera } from '@react-three/drei';
import { Suspense, useLayoutEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import { ModelAsset, useAssetTexture, useModelUrl } from '../three/ModelAsset';
import { SkinnedModel, useResolvedAnimator } from '../three/SkinnedModel';
import { FollowCamera, useFollowTarget } from '../three/FollowCamera';
import { BoneAttachment } from '../three/BoneAttachment';
import { useResolvedMaterial } from '../three/resolveMaterial';
import { WorldUIAnchor } from '../ui/WorldUIAnchor';
import { ImpactParticles } from '../three/ImpactParticles';
import { DamageNumber } from '../three/DamageNumber';
import { ProjectileVisual } from '../three/ProjectileVisual';
import { PostFx } from '../three/PostFx';
import type { SceneObject, Vector3Tuple } from '../types';

/** Built-in mesh rendering — mirrors the editor's primitives, minus selection/gizmo chrome. */
function GameMesh({ object, focused = false }: { object: SceneObject; focused?: boolean }) {
  // Floating combat damage number.
  if (object.effect?.kind === 'damage') return <DamageNumber effect={object.effect} />;
  // Runtime particle burst (bullet impact, etc.).
  if (object.effect) return <ImpactParticles effect={object.effect} />;
  // Runtime projectile — glowing tracer + point light.
  if (object.projectile) return <ProjectileVisual object={object} />;
  const renderer = object.renderer;
  const baseResolved = useResolvedMaterial(renderer);
  // Interaction focus highlight: warm emissive rim so the player sees what they can use (Unreal-style).
  const resolved = focused
    ? { ...baseResolved, emissiveColor: '#ffcf66', emissiveIntensity: 0.7, overrideModel: true }
    : baseResolved;
  const modelUrl = useModelUrl(renderer?.modelAssetId);
  const usingModel = Boolean(renderer?.modelAssetId && modelUrl);
  const resolvedAnimator = useResolvedAnimator(object);
  const builtinBaseTexture = useAssetTexture(usingModel ? undefined : resolved.baseColorUrl, true);
  const builtinNormalTexture = useAssetTexture(usingModel ? undefined : resolved.normalUrl, true);

  if (object.kind === 'light') {
    const l = object.light;
    if (l?.type === 'point') return <pointLight color={l.color} intensity={l.intensity} distance={l.distance} decay={2} castShadow={l.castShadow} />;
    if (l?.type === 'spot') return <spotLight color={l.color} intensity={l.intensity} distance={l.distance} angle={l.angle} penumbra={0.45} decay={2} castShadow={l.castShadow} />;
    return <directionalLight color={l?.color ?? '#ffffff'} intensity={l?.intensity ?? 2.4} castShadow={l?.castShadow ?? true} position={[0, 0, 0]} />;
  }

  // Cameras and empties are invisible scaffolding at runtime.
  if (object.kind === 'camera' || object.kind === 'empty' || !renderer || !renderer.enabled) {
    return null;
  }

  // A skinned model with an enabled animator plays its clips (state machine or single clip).
  if (object.animator?.enabled && resolvedAnimator.meshUrl) {
    return (
      <Suspense fallback={null}>
        <SkinnedModel
          meshUrl={resolvedAnimator.meshUrl}
          clipSourceUrls={resolvedAnimator.clipSourceUrls}
          clipName={resolvedAnimator.clipName}
          blend={resolvedAnimator.blend}
          speed={resolvedAnimator.speed}
          loop={resolvedAnimator.loop}
          fade={resolvedAnimator.fade}
          registerId={object.id}
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
          geometryKey={renderer?.modelAssetId}
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

  const material = (
    <meshStandardMaterial
      color={resolved.color}
      metalness={resolved.metalness}
      roughness={resolved.roughness}
      emissive={resolved.emissiveColor}
      emissiveIntensity={resolved.emissiveIntensity}
      map={builtinBaseTexture ?? null}
      normalMap={builtinNormalTexture ?? null}
      transparent={resolved.opacity < 1}
      opacity={resolved.opacity}
      depthWrite={resolved.opacity >= 1}
    />
  );

  if (renderer.mesh === 'sphere') {
    return (
      <mesh castShadow receiveShadow>
        <sphereGeometry args={[0.55, 32, 24]} />
        {material}
      </mesh>
    );
  }

  if (renderer.mesh === 'capsule') {
    return (
      <mesh castShadow receiveShadow>
        <capsuleGeometry args={[0.34, 0.82, 8, 18]} />
        {material}
      </mesh>
    );
  }

  if (renderer.mesh === 'plane') {
    return (
      <mesh receiveShadow>
        <planeGeometry args={[1, 1, 12, 12]} />
        {material}
      </mesh>
    );
  }

  return (
    <mesh castShadow receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      {material}
    </mesh>
  );
}

/** Aims the active camera at the scene origin once it is mounted. */
function CameraTarget({ target }: { target: Vector3Tuple }) {
  const camera = useThree((state) => state.camera);
  useLayoutEffect(() => {
    camera.lookAt(target[0], target[1], target[2]);
  }, [camera, target]);
  return null;
}

function GameScene() {
  const allObjects = useEditorStore(selectActiveObjects);
  const runtimeHidden = useEditorStore((state) => state.runtimeHidden);
  const focusId = useEditorStore((state) => state.runtimeInteractFocusId);
  // Objects holstered/hidden at runtime (action.setVisible) aren't rendered.
  const objects = allObjects.filter((object) => !object.viewModel && !runtimeHidden.includes(object.id));

  // Camera priority: a character's follow camera, then an authored camera object, then free-orbit.
  const followTarget = useFollowTarget();
  const cameraObject = useMemo(() => objects.find((object) => object.kind === 'camera'), [objects]);
  const cameraPosition = cameraObject?.transform.position ?? ([6, 4.2, 7] as Vector3Tuple);

  return (
    <>
      <color attach="background" args={['#0F1117']} />
      <fog attach="fog" args={['#0F1117', 14, 28]} />
      <ambientLight intensity={0.62} />
      <directionalLight position={[6, 9, 4]} intensity={1.1} castShadow />
      {/* Self-contained lighting (no external HDRI) so the export runs offline and under the desktop CSP. */}
      <Environment resolution={256}>
        <Lightformer intensity={1.2} position={[0, 6, 0]} scale={[10, 10, 1]} />
        <Lightformer intensity={0.7} position={[6, 3, 4]} scale={[6, 6, 1]} color="#8aa0ff" />
        <Lightformer intensity={0.5} position={[-6, 2, -4]} scale={[6, 6, 1]} color="#ffd6a5" />
      </Environment>

      {followTarget ? (
        <FollowCamera />
      ) : cameraObject ? (
        <>
          <PerspectiveCamera makeDefault fov={50} position={cameraPosition} />
          <CameraTarget target={[0, 0, 0]} />
        </>
      ) : (
        <OrbitControls makeDefault enableDamping dampingFactor={0.07} minDistance={2.5} maxDistance={24} />
      )}

      <group>
        {objects.map((object) =>
          object.attachment ? (
            <BoneAttachment key={object.id} object={object} onSelect={() => undefined}>
              <GameMesh object={object} focused={object.id === focusId} />
            </BoneAttachment>
          ) : (
            <group
              key={object.id}
              position={object.transform.position}
              rotation={object.transform.rotation}
              scale={object.transform.scale}
            >
              <GameMesh object={object} focused={object.id === focusId} />
            </group>
          ),
        )}
      </group>

      {/* World-space UI widgets (health bars, nameplates) anchored at each object's position. */}
      {objects.map((object) => (object.ui ? <WorldUIAnchor key={`ui-${object.id}`} object={object} /> : null))}

      <ContactShadows position={[0, -0.01, 0]} opacity={0.36} scale={14} blur={2.4} far={6} />
      <PostFx />
    </>
  );
}

export function GameView() {
  return (
    <Canvas className="game-canvas" shadows camera={{ position: [6, 4.2, 7], fov: 50 }}>
      <GameScene />
    </Canvas>
  );
}
