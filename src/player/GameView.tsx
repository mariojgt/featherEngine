import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  ContactShadows,
  OrbitControls,
  PerformanceMonitor,
  PerspectiveCamera,
} from '@react-three/drei';
import { memo, Suspense, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import { ModelAsset, useAssetTexture, useModelUrl } from '../three/ModelAsset';
import { SkinnedModel, useResolvedAnimator } from '../three/SkinnedModel';
import { FollowCamera, LockOnMarker, useFollowTarget } from '../three/FollowCamera';
import { AudioListenerSync } from '../three/AudioListenerSync';
import { SkidMarks } from '../three/SkidMarks';
import { ShaderPrewarm } from '../three/ShaderPrewarm';
import { EffectLightPool } from '../three/effectLights';
import { autoQualityStep } from '../runtime/autoQuality';
import { CinematicCamera } from '../three/CinematicCamera';
import { BoneAttachment } from '../three/BoneAttachment';
import { useResolvedMaterial } from '../three/resolveMaterial';
import { WorldUIAnchor } from '../ui/WorldUIAnchor';
import { WebGLScreenUILayer } from '../ui/WebGLScreenUILayer';
import { ImpactParticles } from '../three/ImpactParticles';
import { ParticleSystem } from '../three/ParticleSystem';
import { DamageNumber } from '../three/DamageNumber';
import { ProjectileVisual } from '../three/ProjectileVisual';
import { PostFx } from '../three/PostFx';
import { ShadowLOD } from '../three/ShadowLOD';
import { MeshLOD } from '../three/MeshLOD';
import { CompressedTextureSupport } from '../three/CompressedTextureSupport';
import { ModelInstances } from '../three/ModelInstances';
import {
  useInstancingEnabled,
  useIsInstanced,
  computeInstanceBatches,
  customizedModelIds,
  batchSignature,
  InstancedIdsContext,
  EMPTY_INSTANCE_BATCHES,
} from '../three/modelInstancing';
import { qualityProfile } from '../three/quality';
import { SceneEnvironment } from '../three/SceneEnvironment';
import { Terrain } from '../three/Terrain';
import { FragmentMesh } from '../three/FragmentMesh';
import { readTransform } from '../runtime/transformBuffer';
import type { SceneObject, Vector3Tuple } from '../types';

const hideInRuntime = (object: SceneObject) => object.renderer?.hideInPlay ?? Boolean(object.physics?.isTrigger);

const SHARED_GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  sphere: new THREE.SphereGeometry(0.55, 32, 24),
  capsule: new THREE.CapsuleGeometry(0.34, 0.82, 8, 18),
  plane: new THREE.PlaneGeometry(1, 1, 12, 12),
};

function gameSceneSignature(state: ReturnType<typeof useEditorStore.getState>) {
  return selectActiveObjects(state)
    .map((object) => {
      const renderer = object.renderer;
      return [
        object.id,
        object.parentId ?? '',
        object.kind,
        object.name,
        object.viewModel?.ownerObjectId ?? '',
        object.attachment?.targetObjectId ?? '',
        object.attachment?.socketName ?? '',
        object.physics?.enabled ? 'p' : '',
        object.physics?.isTrigger ? 't' : '',
        object.character?.enabled ? 'c' : '',
        object.vehicle?.enabled ? 'v' : '',
        object.terrain?.enabled ? 'terrain' : '',
        object.effect?.kind ?? '',
        object.projectile ? 'projectile' : '',
        renderer?.enabled === false ? 'off' : '',
        renderer?.hideInPlay ? 'hide' : '',
        renderer?.mesh ?? '',
        renderer?.modelAssetId ?? '',
        renderer?.materialId ?? '',
        renderer?.textureAssetId ?? '',
        renderer?.fragmentKey ?? '',
        renderer?.overrideMaterial ? 'override' : '',
        renderer?.materialOverrides?.color ?? '',
        object.animator?.enabled ? 'anim' : '',
        object.animator?.controllerId ?? '',
        object.particles?.systemId ?? '',
        object.ui?.documentId ?? '',
      ].join(':');
    })
    .join('|');
}

/** Built-in mesh rendering — mirrors the editor's primitives, minus selection/gizmo chrome. */
function GameMesh({ object, focused = false }: { object: SceneObject; focused?: boolean }) {
  // Floating combat damage number.
  if (object.effect?.kind === 'damage') return <DamageNumber effect={object.effect} />;
  // Runtime particle burst (bullet impact, etc.).
  if (object.effect) return <ImpactParticles effect={object.effect} />;
  // Runtime projectile — glowing tracer + point light.
  if (object.projectile) return <ProjectileVisual object={object} />;
  if (object.terrain?.enabled) return <Terrain object={object} />;
  const renderer = object.renderer;
  const baseResolved = useResolvedMaterial(renderer);
  // Interaction focus highlight: warm emissive rim so the player sees what they can use (Unreal-style).
  // Combat damage reads via the floating damage number only — no emissive tint on the struck object.
  const resolved = focused
    ? { ...baseResolved, emissiveColor: '#ffcf66', emissiveIntensity: 0.7, overrideModel: true }
    : baseResolved;
  const modelUrl = useModelUrl(renderer?.modelAssetId);
  const usingModel = Boolean(renderer?.modelAssetId && modelUrl);
  const instanced = useIsInstanced(object.id);
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

  // A spawned fracture shard renders its raw generated geometry (from the geometry cache).
  if (renderer.fragmentKey) {
    return <FragmentMesh geometryKey={renderer.fragmentKey} resolved={resolved} />;
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
          tint={
            // Recolor the rig only when the renderer itself overrides material (e.g. a per-enemy color tint) —
            // NOT for the transient hit-flash/focus glow, which must keep the model's baked color and just add
            // emissive. `baseResolved` is pre-flash, so it isolates the persistent color-override intent.
            baseResolved.overrideModel || resolved.emissiveIntensity > 0
              ? {
                  color: baseResolved.overrideModel ? resolved.color : undefined,
                  emissiveColor: resolved.emissiveIntensity > 0 ? resolved.emissiveColor : undefined,
                  emissiveIntensity: resolved.emissiveIntensity > 0 ? resolved.emissiveIntensity : undefined,
                }
              : undefined
          }
        />
      </Suspense>
    );
  }

  // Drawn by a shared InstancedMesh batch (see ModelInstances) — don't also draw it individually.
  if (usingModel && instanced) return null;

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
        <primitive object={SHARED_GEO.sphere} attach="geometry" dispose={null} />
        {material}
      </mesh>
    );
  }

  if (renderer.mesh === 'capsule') {
    return (
      <mesh castShadow receiveShadow>
        <primitive object={SHARED_GEO.capsule} attach="geometry" dispose={null} />
        {material}
      </mesh>
    );
  }

  if (renderer.mesh === 'plane') {
    return (
      <mesh receiveShadow>
        <primitive object={SHARED_GEO.plane} attach="geometry" dispose={null} />
        {material}
      </mesh>
    );
  }

  return (
    <mesh castShadow receiveShadow>
      <primitive object={SHARED_GEO.box} attach="geometry" dispose={null} />
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

function applyRuntimeTransform(group: THREE.Group, object: SceneObject) {
  const transform = readTransform(object.id) ?? object.transform;
  group.position.set(transform.position[0], transform.position[1], transform.position[2]);
  group.rotation.set(transform.rotation[0], transform.rotation[1], transform.rotation[2]);
  group.scale.set(transform.scale[0], transform.scale[1], transform.scale[2]);
}

function sameRenderObject(prev: SceneObject, next: SceneObject) {
  if (prev === next) return true;
  return (
    prev.id === next.id &&
    prev.kind === next.kind &&
    prev.name === next.name &&
    prev.parentId === next.parentId &&
    prev.renderer === next.renderer &&
    prev.light === next.light &&
    prev.terrain === next.terrain &&
    prev.effect === next.effect &&
    prev.projectile === next.projectile &&
    prev.particles === next.particles &&
    prev.animator === next.animator &&
    prev.attachment === next.attachment &&
    prev.ui === next.ui &&
    prev.viewModel === next.viewModel
  );
}

const GameObjectView = memo(
  function GameObjectView({
    object,
    focused,
    children,
  }: {
    object: SceneObject;
    focused: boolean;
    children?: ReactNode;
  }) {
    const groupRef = useRef<THREE.Group>(null);

    useFrame(() => {
      const group = groupRef.current;
      if (group) applyRuntimeTransform(group, object);
    });

    const body = (
      <>
        <GameMesh object={object} focused={focused} />
        {object.particles && <ParticleSystem object={object} />}
        {children}
      </>
    );

    return object.attachment ? (
      <BoneAttachment object={object} onSelect={() => undefined}>
        {body}
      </BoneAttachment>
    ) : (
      <group
        ref={groupRef}
        userData={{ nfObjectId: object.id }}
        position={object.transform.position}
        rotation={object.transform.rotation}
        scale={object.transform.scale}
      >
        {body}
      </group>
    );
  },
  (prev, next) => prev.focused === next.focused && prev.children === next.children && sameRenderObject(prev.object, next.object),
);

/**
 * Render the running game's objects as a parent/child scene graph — children sit inside their
 * parent's <group> so they inherit its transform (matches the editor viewport). Physics/character
 * objects render at the world root: the simulation owns their world transform, so they must not
 * also inherit a parent's matrix.
 */
function renderGameTree(objects: SceneObject[], focusId: string | null): ReactNode {
  const visible = new Set(objects.map((o) => o.id));
  const childrenByParent = new Map<string, SceneObject[]>();
  const roots: SceneObject[] = [];
  for (const object of objects) {
    const detached =
      !object.parentId || !visible.has(object.parentId) || object.physics?.enabled || object.character?.enabled;
    if (detached) {
      roots.push(object);
    } else {
      const list = childrenByParent.get(object.parentId!) ?? [];
      list.push(object);
      childrenByParent.set(object.parentId!, list);
    }
  }

  const renderNode = (object: SceneObject): ReactNode => {
    const kids = childrenByParent.get(object.id)?.map(renderNode);
    return (
      <GameObjectView key={object.id} object={object} focused={object.id === focusId}>
        {kids}
      </GameObjectView>
    );
  };

  return roots.map(renderNode);
}

function GameScene() {
  const sceneSignature = useEditorStore(gameSceneSignature);
  const allObjects = useMemo(() => selectActiveObjects(useEditorStore.getState()), [sceneSignature]);
  const sceneEnvironment = useEditorStore((state) => state.scenes.find((scene) => scene.id === state.activeSceneId)?.environment);
  const runtimeHidden = useEditorStore((state) => state.runtimeHidden);
  const focusId = useEditorStore((state) => state.runtimeInteractFocusId);
  const cinematicCamera = useEditorStore((state) => state.runtimeCinematicCamera);
  // Objects holstered/hidden at runtime (action.setVisible) aren't rendered.
  const objects = allObjects.filter((object) => !object.viewModel && !runtimeHidden.includes(object.id) && !hideInRuntime(object));

  // GPU instancing for repeated static decoration (same path as the editor). The player is always
  // runtime, so it's gated only on the toggle. Batches are kept structurally stable (the object array
  // gets a new identity every frame) so the InstancedMeshes aren't rebuilt 60×/s.
  const instancingOn = useInstancingEnabled();
  // Models with custom-textured imported materials can't share the baked-material instanced draw.
  const allMaterials = useEditorStore((state) => state.materials);
  const customizedModels = useMemo(() => customizedModelIds(allMaterials), [allMaterials]);
  const rawInstanceBatches = instancingOn ? computeInstanceBatches(objects, customizedModels) : EMPTY_INSTANCE_BATCHES;
  const instanceSig = batchSignature(rawInstanceBatches);
  const instanceBatchesRef = useRef<Map<string, SceneObject[]>>(EMPTY_INSTANCE_BATCHES);
  const instanceSigRef = useRef('');
  if (instanceSig !== instanceSigRef.current) {
    instanceSigRef.current = instanceSig;
    instanceBatchesRef.current = rawInstanceBatches;
  }
  const instanceBatches = instanceBatchesRef.current;
  const instancedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const objs of instanceBatches.values()) for (const o of objs) ids.add(o.id);
    return ids;
  }, [instanceBatches]);

  // Camera priority: a character's follow camera, then an authored camera object, then free-orbit.
  const followTarget = useFollowTarget();
  const cameraObject = useMemo(() => objects.find((object) => object.kind === 'camera'), [objects]);
  const cameraPosition = cameraObject?.transform.position ?? ([6, 4.2, 7] as Vector3Tuple);

  return (
    <>
      <SceneEnvironment environment={sceneEnvironment} shadows />

      {/* Marker over the player's lock-on target — renders nothing while no lock is held. */}
      <LockOnMarker />
      {cinematicCamera ? (
        <CinematicCamera />
      ) : followTarget ? (
        <FollowCamera />
      ) : cameraObject ? (
        <>
          <PerspectiveCamera makeDefault fov={50} position={cameraPosition} />
          <CameraTarget target={[0, 0, 0]} />
        </>
      ) : (
        <OrbitControls makeDefault enableDamping dampingFactor={0.07} minDistance={2.5} maxDistance={24} />
      )}

      {/* Shared InstancedMesh batches for repeated static decoration (off unless toggled). */}
      <ModelInstances batches={instanceBatches} />
      <InstancedIdsContext.Provider value={instancedIds}>
        <group>{renderGameTree(objects, focusId)}</group>
      </InstancedIdsContext.Provider>

      {/* World-space UI widgets (health bars, nameplates) anchored at each object's position. */}
      {objects.map((object) => (object.ui ? <WorldUIAnchor key={`ui-${object.id}`} object={object} /> : null))}

      {/* WebGL HUD (uikit) for renderMode:'webgl' screen docs — caught by PostFx bloom. */}
      <WebGLScreenUILayer />

      <ContactShadows position={[0, -0.01, 0]} opacity={0.36} scale={14} blur={2.4} far={6} />
      <PostFx />
    </>
  );
}

export function GameView() {
  // Adaptive resolution. The exported game runs full-window/fullscreen, which on a Retina display
  // is up to ~4x the fragments of the editor's small docked viewport — the usual cause of FPS drops
  // after export. Start at a capped DPR and let PerformanceMonitor lower it when the frame rate dips,
  // then restore it once there's headroom again (smoothness over a slightly softer image under load).
  const [dpr, setDpr] = useState(1.5);
  // Honour the project's game-quality preset: cap render resolution + toggle shadows to its budget.
  const quality = useEditorStore((state) => state.renderSettings.quality);
  const qProfile = qualityProfile(quality);
  return (
    <Canvas
      className="game-canvas"
      shadows={qProfile.shadows}
      dpr={Math.min(dpr, qProfile.dpr)}
      gl={{ powerPreference: 'high-performance' }}
      performance={{ min: 0.5 }}
      camera={{ position: [6, 4.2, 7], fov: 50 }}
    >
      {/* DPR drops once and STAYS dropped: each flip reallocates the framebuffer + every post-FX
          target (~0.1s stall), and at any sustained load that sits on the monitor's boundary the
          old setDpr(1)/setDpr(1.5) pair flapped — a periodic mid-game hitch that only appeared
          above a certain speed/scene load. autoQualityStep has its own hysteresis + session latch. */}
      <PerformanceMonitor onDecline={() => { setDpr(1); autoQualityStep(-1); }} onIncline={() => autoQualityStep(1)} />
      <CompressedTextureSupport />
      <AudioListenerSync />
      <SkidMarks />
      <ShaderPrewarm />
      <EffectLightPool />
      <ShadowLOD />
      <MeshLOD />
      <GameScene />
    </Canvas>
  );
}
