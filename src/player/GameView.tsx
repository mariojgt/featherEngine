import { Canvas, useFrame } from '@react-three/fiber';
import {
  ContactShadows,
  OrbitControls,
  PerformanceMonitor,
  PerspectiveCamera,
} from '@react-three/drei';
import { memo, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three-stdlib';
import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import { ModelAsset, useAssetTexture, useModelUrl } from '../three/ModelAsset';
import { SkinnedModel, useResolvedAnimator } from '../three/SkinnedModel';
import { FollowCamera, LockOnMarker, useFollowTarget } from '../three/FollowCamera';
import { AudioListenerSync } from '../three/AudioListenerSync';
import { SkidMarks } from '../three/SkidMarks';
import { DecalLayer } from '../three/DecalLayer';
import { ShaderPrewarm } from '../three/ShaderPrewarm';
import { EffectLightPool } from '../three/effectLights';
import { autoQualityStep } from '../runtime/autoQuality';
import { CinematicCamera } from '../three/CinematicCamera';
import { BoneAttachment } from '../three/BoneAttachment';
import { ReflectionProbeApply, ReflectionProbeCapture } from '../three/ReflectionProbes';
import { LuxLighting } from '../three/LuxLighting';
import { useResolvedMaterial, useResolvedMaterialSlots, hasPhysicalLayers } from '../three/resolveMaterial';
import { useToonMaterial } from '../three/toonMaterial';
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
import { ToneMapping } from '../three/ToneMapping';
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
import { TreeMesh } from '../three/TreeMesh';
import { ModelMesh } from '../three/ModelMesh';
import { ClothSim } from '../three/ClothSim';
import { CableSim } from '../three/CableSim';
import { WaterSurface } from '../three/WaterSurface';
import { WaterEnvCapture } from '../three/WaterEnvCapture';
import { UnderwaterOverlay } from '../three/UnderwaterOverlay';
import { FragmentMesh } from '../three/FragmentMesh';
import { readTransform } from '../runtime/transformBuffer';
import { structuralObjectsSignature } from '../store/stableSelectors';
import type { SceneObject } from '../types';

const hideInRuntime = (object: SceneObject) => object.renderer?.hideInPlay ?? Boolean(object.physics?.isTrigger);

const SHARED_GEO = {
  // Keep shipped games pixel-identical to the editor's tactile, studio-lit primitive language.
  box: new RoundedBoxGeometry(1, 1, 1, 3, 0.08),
  sphere: new THREE.SphereGeometry(0.55, 32, 24),
  capsule: new THREE.CapsuleGeometry(0.34, 0.82, 8, 18),
  plane: new THREE.PlaneGeometry(1, 1, 12, 12),
};

function gameSceneSignature(state: ReturnType<typeof useEditorStore.getState>) {
  // The shared structural selector ignores only Play-mode transforms (those flow through the
  // transform buffer) and invalidates for every other authored/runtime field. This keeps material
  // overrides, animator/controller changes, UI, VFX and future components visible without another
  // hand-maintained partial signature drifting from the runtime.
  return `${state.activeSceneId}|${structuralObjectsSignature(state)}`;
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
  if (object.tree?.enabled) return <TreeMesh object={object} />;
  // Prototype models (Model Forge) — same early-return placement as the editor viewport.
  if (object.model?.enabled) return <ModelMesh object={object} />;
  // Soft-body visuals replace the object's regular mesh, matching editor Play. Keep these before
  // hooks so enabling either component never changes this component's hook count.
  if (object.cloth?.enabled) return <ClothSim object={object} selected={false} />;
  if (object.cable?.enabled) return <CableSim object={object} selected={false} />;
  const renderer = object.renderer;
  const baseResolved = useResolvedMaterial(renderer);
  // Combat hit-flash: mirror editor Play's brief white-hot blink on the object that took damage.
  // Each mesh subscribes only to its own event, so unrelated objects stay quiet.
  const damageTick = useEditorStore((state) => (state.isPlaying ? state.runtimeDamageEvents[object.id] : undefined));
  const [hitFlash, setHitFlash] = useState(false);
  const hitFlashTimeout = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (damageTick === undefined) return;
    setHitFlash(true);
    if (hitFlashTimeout.current) clearTimeout(hitFlashTimeout.current);
    hitFlashTimeout.current = setTimeout(() => {
      hitFlashTimeout.current = undefined;
      setHitFlash(false);
    }, 150);
  }, [damageTick]);
  useEffect(
    () => () => {
      if (hitFlashTimeout.current) clearTimeout(hitFlashTimeout.current);
    },
    [],
  );
  const resolved = hitFlash
    ? { ...baseResolved, emissiveColor: '#ffffff', emissiveIntensity: 1.5, overrideModel: true }
    : focused
      ? { ...baseResolved, emissiveColor: '#ffcf66', emissiveIntensity: 0.7, overrideModel: true }
      : baseResolved;
  // Imported-model material slots use the same resolution path as editor Play. Fold transient
  // focus/damage emissive into each slot so slot-bound models still provide gameplay feedback.
  const slotResolved = useResolvedMaterialSlots(renderer);
  const slotMaterials = useMemo(
    () =>
      slotResolved?.map((slot) =>
        slot
          ? {
              color: slot.color,
              metalness: slot.metalness,
              roughness: slot.roughness,
              emissiveColor: hitFlash ? '#ffffff' : focused ? '#ffcf66' : slot.emissiveColor,
              emissiveIntensity: hitFlash ? 1.5 : focused ? 0.7 : slot.emissiveIntensity,
              override: hitFlash || focused ? true : slot.overrideModel,
              baseColorUrl: slot.baseColorUrl,
              normalUrl: slot.normalUrl,
              clearcoat: slot.clearcoat,
              clearcoatRoughness: slot.clearcoatRoughness,
              sheen: slot.sheen,
              sheenColor: slot.sheenColor,
              transmission: slot.transmission,
              ior: slot.ior,
              thickness: slot.thickness,
              iridescence: slot.iridescence,
            }
          : undefined,
      ),
    [slotResolved, focused, hitFlash],
  );
  const modelMaterial = useMemo(
    () => ({
      color: resolved.color,
      metalness: resolved.metalness,
      roughness: resolved.roughness,
      emissiveColor: resolved.emissiveColor,
      emissiveIntensity: resolved.emissiveIntensity,
      override: resolved.overrideModel,
      baseColorUrl: resolved.baseColorUrl,
      normalUrl: resolved.normalUrl,
      clearcoat: resolved.clearcoat,
      clearcoatRoughness: resolved.clearcoatRoughness,
      sheen: resolved.sheen,
      sheenColor: resolved.sheenColor,
      transmission: resolved.transmission,
      ior: resolved.ior,
      thickness: resolved.thickness,
      iridescence: resolved.iridescence,
    }),
    [resolved],
  );
  const modelUrl = useModelUrl(renderer?.modelAssetId);
  const usingModel = Boolean(renderer?.modelAssetId && modelUrl);
  const instanced = useIsInstanced(object.id);
  const resolvedAnimator = useResolvedAnimator(object);
  const builtinBaseTexture = useAssetTexture(usingModel ? undefined : resolved.baseColorUrl, true);
  const builtinNormalTexture = useAssetTexture(usingModel ? undefined : resolved.normalUrl, true, 'data');
  // Cel-shaded surfaces render via MeshToonMaterial (null = normal PBR path). Must mirror Viewport so
  // the standalone player matches the editor. Hook is unconditional (before any early return below).
  const toonMaterial = useToonMaterial(resolved, builtinBaseTexture ?? null);

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
          material={modelMaterial}
          slotMaterials={slotMaterials}
          deformObjectId={object.vehicle?.deformable ? object.id : undefined}
        />
      </Suspense>
    );
  }

  // Heavier MeshPhysicalMaterial only when a physical layer (clearcoat/sheen/transmission/iridescence)
  // is engaged; otherwise the lighter MeshStandardMaterial (defaults match, so this is purely additive).
  const material = toonMaterial ? (
    <primitive object={toonMaterial} attach="material" />
  ) : hasPhysicalLayers(resolved) ? (
    <meshPhysicalMaterial
      color={resolved.color}
      metalness={resolved.metalness}
      roughness={resolved.roughness}
      emissive={resolved.emissiveColor}
      emissiveIntensity={resolved.emissiveIntensity}
      map={builtinBaseTexture ?? null}
      normalMap={builtinNormalTexture ?? null}
      clearcoat={resolved.clearcoat}
      clearcoatRoughness={resolved.clearcoatRoughness}
      sheen={resolved.sheen}
      sheenColor={resolved.sheenColor}
      transmission={resolved.transmission}
      ior={resolved.ior}
      thickness={resolved.thickness}
      iridescence={resolved.iridescence}
      transparent={resolved.opacity < 1}
      opacity={resolved.opacity}
      depthWrite={resolved.opacity >= 1}
    />
  ) : (
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

/** Runtime camera driven by an authored camera object's position and Euler rotation. */
function AuthoredCamera({ object }: { object: SceneObject }) {
  const cameraRef = useRef<THREE.PerspectiveCamera>(null);
  useFrame(() => {
    const camera = cameraRef.current;
    if (!camera) return;
    const transform = readTransform(object.id) ?? object.transform;
    camera.position.set(transform.position[0], transform.position[1], transform.position[2]);
    camera.rotation.set(transform.rotation[0], transform.rotation[1], transform.rotation[2]);
  });
  return (
    <PerspectiveCamera
      ref={cameraRef}
      makeDefault
      fov={50}
      near={0.02}
      position={object.transform.position}
      rotation={object.transform.rotation}
    />
  );
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
    prev.vehicle === next.vehicle &&
    prev.tree === next.tree &&
    prev.model === next.model &&
    prev.cloth === next.cloth &&
    prev.cable === next.cable &&
    prev.water === next.water &&
    prev.attachment === next.attachment &&
    prev.reflectionProbe === next.reflectionProbe &&
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
        {object.reflectionProbe?.enabled && (
          <ReflectionProbeCapture objectId={object.id} probe={object.reflectionProbe} />
        )}
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

/**
 * World UI and water need the live object transforms, unlike regular meshes (which read the mutable
 * transform buffer). Isolate their per-tick subscription here so moving anchors stay in parity with
 * editor Play without making the whole player scene reconcile every frame.
 */
function RuntimeAnchoredLayers() {
  const objects = useEditorStore(selectActiveObjects);
  return (
    <>
      {objects.map((object) => (object.ui ? <WorldUIAnchor key={`ui-${object.id}`} object={object} /> : null))}
      {objects.map((object) =>
        object.water?.enabled ? <WaterSurface key={`water-${object.id}`} object={object} /> : null,
      )}
    </>
  );
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
  // Cloth/cable can source an imported mesh but must stay on their deforming renderer, never the static
  // imported-model instancing path.
  const instanceCandidates = objects.filter((object) => !object.cloth?.enabled && !object.cable?.enabled);
  const rawInstanceBatches = instancingOn
    ? computeInstanceBatches(instanceCandidates, customizedModels)
    : EMPTY_INSTANCE_BATCHES;
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
        <AuthoredCamera object={cameraObject} />
      ) : (
        <OrbitControls makeDefault enableDamping dampingFactor={0.07} minDistance={2.5} maxDistance={24} />
      )}

      {/* Shared InstancedMesh batches for repeated static decoration (off unless toggled). */}
      <ModelInstances batches={instanceBatches} />
      <InstancedIdsContext.Provider value={instancedIds}>
        <group>{renderGameTree(objects, focusId)}</group>
      </InstancedIdsContext.Provider>

      {/* World UI and water use the unfiltered live list: invisible/empty UI anchors remain valid, and
          trigger-backed water keeps its visible surface while following runtime transforms. */}
      <RuntimeAnchoredLayers />
      <WaterEnvCapture />

      {/* Local reflection probes → nearby reflective materials' envMap (no-op when the scene has no probes). */}
      <ReflectionProbeApply />
      <LuxLighting />

      {/* Camera-submersion tint/murk for water volumes. */}
      <UnderwaterOverlay />

      {/* WebGL HUD (uikit) for renderMode:'webgl' screen docs — caught by PostFx bloom. */}
      <WebGLScreenUILayer />

      {(sceneEnvironment?.contactShadows ?? true) && (
        <ContactShadows
          position={[0, (sceneEnvironment?.contactShadowY ?? 0) - 0.01, 0]}
          opacity={sceneEnvironment?.contactShadowOpacity ?? 0.36}
          scale={sceneEnvironment?.contactShadowScale ?? 14}
          blur={sceneEnvironment?.contactShadowBlur ?? 2.4}
          far={sceneEnvironment?.contactShadowFar ?? 6}
          color={sceneEnvironment?.contactShadowColor ?? '#000000'}
        />
      )}
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
      <ToneMapping />
      <AudioListenerSync />
      <SkidMarks />
      <DecalLayer />
      <ShaderPrewarm />
      <EffectLightPool />
      <ShadowLOD />
      <MeshLOD />
      <GameScene />
    </Canvas>
  );
}
