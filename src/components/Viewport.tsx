import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { ContactShadows, Edges, PerformanceMonitor, TransformControls } from '@react-three/drei';
import { ArrowDownToLine, Camera, ChevronDown, Globe, Gauge, Magnet, Move3D, Pause, Play, Rotate3D, Scaling, View } from 'lucide-react';
import { useViewportPrefs } from '../store/viewportPrefsStore';
import { Component, Suspense, memo, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import * as THREE from 'three';
import { effectiveSelection, selectActiveObjects, useEditorStore } from '../store/editorStore';
import { isTransientVfx, nonVfxObjectsSignature, useVfxObjects } from '../store/stableSelectors';
import { undo, redo } from '../store/history';
import { useProjectStore } from '../store/projectStore';
import { recordRender, recordRenderTime } from '../runtime/perfStats';
import { readTransform } from '../runtime/transformBuffer';
import { ModelAsset, useAssetTexture, useModelUrl } from '../three/ModelAsset';
import { FragmentMesh } from '../three/FragmentMesh';
import { AudioListenerSync } from '../three/AudioListenerSync';
import { SkidMarks } from '../three/SkidMarks';
import { ShaderPrewarm } from '../three/ShaderPrewarm';
import { EffectLightPool } from '../three/effectLights';
import { SkinnedModel, useResolvedAnimator } from '../three/SkinnedModel';
import { FollowCamera, LockOnMarker, useFollowTargetId, computeRestingCameraPose, resolveCameraConfig } from '../three/FollowCamera';
import { CinematicCamera } from '../three/CinematicCamera';
import { CinematicPathGizmo } from '../three/CinematicPathGizmo';
import { EditorCamera, editorNav, type ViewPreset } from '../three/EditorCamera';
import { ViewCube } from './ViewCube';
import { BoneAttachment } from '../three/BoneAttachment';
import { useResolvedMaterial, useResolvedMaterialSlots, hasPhysicalLayers } from '../three/resolveMaterial';
import { assetDrag, isAssetDrag, isPrefabDrag, prefabDrag, readAssetDragId, readPrefabDragId } from './dragShared';
import { WorldUIAnchor } from '../ui/WorldUIAnchor';
import { ScreenUILayer } from '../ui/ScreenUILayer';
import { WebGLScreenUILayer } from '../ui/WebGLScreenUILayer';
import { DynamicCrosshair } from '../ui/DynamicCrosshair';
import { GameHud } from '../ui/GameHud';
import { MiniMap } from '../ui/MiniMap';
import { ImpactParticles } from '../three/ImpactParticles';
import { ParticleSystem } from '../three/ParticleSystem';
import { DamageNumber } from '../three/DamageNumber';
import { ProjectileVisual } from '../three/ProjectileVisual';
import { ColliderGizmo } from '../three/ColliderGizmo';
import { JointGizmo } from '../three/JointGizmo';
import { ClothSim } from '../three/ClothSim';
import { CableSim } from '../three/CableSim';
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
} from '../three/modelInstancing';
import { qualityProfile, QUALITY_LEVELS } from '../three/quality';
import { autoQualityStep, resetAutoQuality } from '../runtime/autoQuality';
import { CinematicOverlay } from './CinematicOverlay';
import { SceneEnvironment } from '../three/SceneEnvironment';
import { WaterSurface } from '../three/WaterSurface';
import { WaterEnvCapture } from '../three/WaterEnvCapture';
import { UnderwaterOverlay } from '../three/UnderwaterOverlay';
import { Terrain, TerrainBrushCursor } from '../three/Terrain';
import { highestTerrainWorldHeight } from '../terrain/terrain';
import type { MaterialOverrides, SceneObject } from '../types';

type DropContext = { camera: THREE.Camera; canvas: HTMLCanvasElement };

type TransformMode = 'translate' | 'rotate' | 'scale';

/** Imperative API the in-Canvas SceneContent exposes to the DOM-side ViewportPanel. */
type SceneApi = {
  /** Box-select: select every object whose screen position falls inside the client-space rect. */
  boxSelect: (rect: { left: number; top: number; right: number; bottom: number }, additive: boolean) => void;
  /** True while a transform-gizmo handle is hovered or being dragged (suppresses box-select). */
  isGizmoEngaged: () => boolean;
  /** Drop each given object straight down so its bounding-box bottom rests on the geometry below
   *  (or the y=0 ground if nothing is under it). Other selected objects are ignored as landing targets. */
  dropToSurface: (ids: string[]) => void;
};

// Blender-style numpad presets, with the row digits as a no-numpad fallback.
const VIEW_PRESET_KEYS: Record<string, ViewPreset> = {
  Numpad5: 'persp',
  Numpad1: 'front',
  Numpad3: 'right',
  Numpad7: 'top',
  '5': 'persp',
  '1': 'front',
  '3': 'right',
  '7': 'top',
};

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

/**
 * One shared geometry per built-in primitive kind, reused by every object of that kind instead of
 * constructing a fresh BufferGeometry per mesh (1000 cubes → 1 BoxGeometry, not 1000). Attached via
 * `<primitive ... dispose={null}>` so r3f never disposes the shared instance when one object unmounts,
 * while each object's own `<meshStandardMaterial>` still disposes normally. The args match what the
 * per-kind JSX used before, so visuals are unchanged.
 */
const SHARED_GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  sphere: new THREE.SphereGeometry(0.55, 32, 24),
  capsule: new THREE.CapsuleGeometry(0.34, 0.82, 8, 18),
  plane: new THREE.PlaneGeometry(1, 1, 12, 12),
};

/** Stable empty batch map reused when instancing is off — avoids allocating a Map every render. */
const EMPTY_BATCHES: Map<string, SceneObject[]> = new Map();

const hideInRuntime = (object: SceneObject) => object.renderer?.hideInPlay ?? Boolean(object.physics?.isTrigger);

function Primitive({ object, selected }: { object: SceneObject; selected: boolean }) {
  // Floating combat damage number.
  if (object.effect?.kind === 'damage') return <DamageNumber effect={object.effect} />;
  // Runtime particle burst (bullet impact, etc.) — render the points effect, nothing else.
  if (object.effect) return <ImpactParticles effect={object.effect} />;
  // Runtime projectile — glowing tracer + point light instead of a dull sphere.
  if (object.projectile) return <ProjectileVisual object={object} />;
  if (object.terrain?.enabled) return <Terrain object={object} />;
  // Cloth replaces the object's normal mesh with a deforming Verlet sheet (separate from Rapier). Placed
  // among the top early-returns (before any hooks) so toggling cloth never changes this component's hook
  // count — ClothSim owns its own hooks. It resolves its material from the object's renderer internally.
  if (object.cloth?.enabled) return <ClothSim object={object} selected={selected} />;
  // Cable/rope — a Verlet tube (separate from Rapier). Same pre-hooks early-return rule as cloth.
  if (object.cable?.enabled) return <CableSim object={object} selected={selected} />;
  const renderer = object.renderer;
  const baseResolved = useResolvedMaterial(renderer);
  // Interaction focus highlight (during Play) — warm emissive rim, matching the standalone player.
  // Subscribe to the DERIVED boolean, not the raw focus id: when focus moves between objects the id
  // changes for every Primitive's selector, but the boolean only flips for the two objects whose
  // highlight actually toggles — so the rest don't re-render (this component renders once per object).
  const focusGlow = useEditorStore((state) => state.runtimeInteractFocusId === object.id);
  // Combat hit-flash: a brief white-hot emissive blink when this object takes damage. `runtimeDamageEvents`
  // already carries per-object damage each tick; subscribing to just THIS object's entry keeps the re-render
  // local to the struck object (the value is undefined on no-damage frames, so quiet frames never re-render).
  const damageTick = useEditorStore((state) => (state.isPlaying ? state.runtimeDamageEvents[object.id] : undefined));
  const [hitFlash, setHitFlash] = useState(false);
  useEffect(() => {
    if (damageTick === undefined) return;
    setHitFlash(true);
    const t = setTimeout(() => setHitFlash(false), 150);
    return () => clearTimeout(t);
  }, [damageTick]);
  const resolved = hitFlash
    ? { ...baseResolved, emissiveColor: '#ffffff', emissiveIntensity: 1.5, overrideModel: true }
    : focusGlow
      ? { ...baseResolved, emissiveColor: '#ffcf66', emissiveIntensity: 0.7, overrideModel: true }
      : baseResolved;
  // Per-slot materials for imported models (each model material editable independently). Folds in the
  // interact-focus glow so a slot-bound model still highlights. Memoized so ModelAsset's apply effect
  // doesn't re-run every frame during Play.
  const slotResolved = useResolvedMaterialSlots(renderer);
  const slotMaterials = useMemo(
    () =>
      slotResolved?.map((slot) =>
        slot
          ? {
              color: slot.color,
              metalness: slot.metalness,
              roughness: slot.roughness,
              emissiveColor: hitFlash ? '#ffffff' : focusGlow ? '#ffcf66' : slot.emissiveColor,
              emissiveIntensity: hitFlash ? 1.5 : focusGlow ? 0.7 : slot.emissiveIntensity,
              override: hitFlash || focusGlow ? true : slot.overrideModel,
              baseColorUrl: slot.baseColorUrl,
              normalUrl: slot.normalUrl,
            }
          : undefined,
      ),
    [slotResolved, focusGlow, hitFlash],
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
  // Built-in geometries use the standard (flipped) UV convention; only load when not using a model.
  const builtinBaseTexture = useAssetTexture(usingModel ? undefined : resolved.baseColorUrl, true);
  const builtinNormalTexture = useAssetTexture(usingModel ? undefined : resolved.normalUrl, true);

  // A spawned fracture shard renders its raw generated geometry (from the geometry cache).
  if (renderer?.fragmentKey) {
    return <FragmentMesh geometryKey={renderer.fragmentKey} resolved={resolved} />;
  }

  // A skinned model with an enabled animator plays its clips; otherwise the model is static.
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

  // This object's model is currently drawn by a shared InstancedMesh batch (see ModelInstances) — don't
  // also draw it individually. The batch handles its transform; the group still exists for hierarchy.
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
  // MeshPhysicalMaterial only when a clearcoat/sheen/transmission/iridescence layer is actually engaged
  // — it's a heavier shader, so plain props keep the lighter MeshStandardMaterial. Defaults match, so
  // switching is purely additive. Transmission renders via three's own refraction pass (not the
  // transparent queue), so we don't force `transparent` for it.
  const commonMaterial = hasPhysicalLayers(resolved) ? (
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

  if (object.kind === 'light') {
    const l = object.light;
    const lightEl =
      l?.type === 'point' ? (
        <pointLight
          color={l.color}
          intensity={l.intensity}
          distance={l.distance}
          decay={2}
          castShadow={l.castShadow}
          // Bounded shadow map (512²) + bias instead of the three.js default — predictable cost and
          // no shadow acne. Point lights are the most expensive (cubemap), so keep them small.
          shadow-mapSize-width={512}
          shadow-mapSize-height={512}
          shadow-bias={-0.0008}
        />
      ) : l?.type === 'spot' ? (
        <spotLight
          color={l.color}
          intensity={l.intensity}
          distance={l.distance}
          angle={l.angle}
          penumbra={0.45}
          decay={2}
          castShadow={l.castShadow}
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
          shadow-bias={-0.0006}
        />
      ) : (
        <directionalLight
          color={l?.color ?? '#ffffff'}
          intensity={l?.intensity ?? 2.4}
          castShadow={l?.castShadow ?? true}
          position={[0, 0, 0]}
          // The sun: a tightly-framed shadow camera keeps a 2048² map sharp over the play area
          // rather than smearing it across an unbounded default frustum.
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-bias={-0.0004}
          shadow-camera-near={0.5}
          shadow-camera-far={120}
          shadow-camera-left={-40}
          shadow-camera-right={40}
          shadow-camera-top={40}
          shadow-camera-bottom={-40}
        />
      );
    return (
      <>
        {lightEl}
        <mesh>
          <octahedronGeometry args={[0.28, 0]} />
          <meshBasicMaterial color={l?.color ?? '#F7B955'} wireframe={!selected} />
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
        <primitive object={SHARED_GEO.sphere} attach="geometry" dispose={null} />
        {commonMaterial}
        {selected && <Edges color="#F7B955" scale={1.04} />}
      </mesh>
    );
  }

  if (renderer.mesh === 'capsule') {
    return (
      <mesh castShadow receiveShadow>
        <primitive object={SHARED_GEO.capsule} attach="geometry" dispose={null} />
        {commonMaterial}
        {selected && <Edges color="#F7B955" scale={1.05} />}
      </mesh>
    );
  }

  if (renderer.mesh === 'plane') {
    return (
      <mesh receiveShadow>
        <primitive object={SHARED_GEO.plane} attach="geometry" dispose={null} />
        {commonMaterial}
        {selected && <Edges color="#F7B955" scale={1.01} />}
      </mesh>
    );
  }

  return (
    <mesh castShadow receiveShadow>
      <primitive object={SHARED_GEO.box} attach="geometry" dispose={null} />
      {commonMaterial}
      {selected && <Edges color="#F7B955" scale={1.03} />}
    </mesh>
  );
}

// Memoized: the runtime tick produces a NEW `objects` array every frame but keeps the SAME object reference
// for anything that didn't move, so static scenery (buildings, roads, props — the bulk of a scene) bails out
// of re-rendering here. Only objects whose transform/renderer actually changed (the car + its wheels, etc.)
// re-render. The callbacks/flags it takes are all stable (useCallback / play-constant), so a shallow prop
// compare is correct. This is the single biggest Play-mode FPS win in object-heavy scenes like the city.
type SceneObjectViewProps = {
  object: SceneObject;
  selected: boolean;
  registerObject: (id: string, object: THREE.Group | null) => void;
  /** True when the pointer is over (or dragging) a transform-gizmo handle — selection must yield to it. */
  isGizmoEngaged?: () => boolean;
  /** Hide the object's own mesh while still positioning it (e.g. an empty group during Play). */
  drawSelf?: boolean;
  /** Nested child objects — rendered inside this object's group so they inherit its transform. */
  children?: ReactNode;
};

/**
 * Custom memo comparator that powers the runtime→React transform decoupling.
 *
 * While playing, an object's `transform` is applied imperatively in useFrame from the transform
 * buffer, so a frame where ONLY the transform changed must NOT re-render (return true to skip).
 * Every other field is still compared by reference, so material/visibility/structural changes
 * re-render normally. While NOT playing, transform IS compared so gizmo/inspector edits show.
 */
function sceneObjectPropsEqual(prev: SceneObjectViewProps, next: SceneObjectViewProps): boolean {
  if (
    prev.selected !== next.selected ||
    prev.drawSelf !== next.drawSelf ||
    prev.registerObject !== next.registerObject ||
    prev.isGizmoEngaged !== next.isGizmoEngaged ||
    prev.children !== next.children
  )
    return false;
  const a = prev.object as unknown as Record<string, unknown>;
  const b = next.object as unknown as Record<string, unknown>;
  if (a === b) return true;
  const playing = useEditorStore.getState().isPlaying;
  for (const key in b) {
    if (playing && key === 'transform') continue;
    if (a[key] !== b[key]) return false;
  }
  for (const key in a) {
    if (playing && key === 'transform') continue;
    if (!(key in b)) return false;
  }
  return true;
}

export const SceneObjectView = memo(function SceneObjectView({
  object,
  selected,
  registerObject,
  isGizmoEngaged,
  drawSelf = true,
  children,
}: SceneObjectViewProps) {
  const selectObject = useEditorStore((state) => state.selectObject);
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const groupRef = useRef<THREE.Group | null>(null);
  // Reference of the transform tuple last written to the group. tickRuntime keeps the SAME transform
  // object for objects that didn't move (only moved ones get a fresh `{...object, transform}`), so a
  // ref match means "static this frame" → skip the writes entirely. Reset on Stop via the null below.
  const lastApplied = useRef<unknown>(null);

  // Imperative transform application during Play: read this object's final transform from the
  // runtime buffer and write it straight to the group. Paired with sceneObjectPropsEqual (which
  // ignores `transform` while playing), this is the core decoupling — movement no longer churns
  // React. Declared before any early return so hook order stays stable; for bone-attached objects
  // groupRef stays null and this no-ops (they ride a bone instead).
  useFrame(() => {
    if (!useEditorStore.getState().isPlaying) {
      lastApplied.current = null;
      return;
    }
    const group = groupRef.current;
    if (!group) return;
    const t = readTransform(object.id);
    // Same tuple reference as last applied → the object is static this frame; the writes (and the
    // rotation→quaternion sync each one triggers) would be redundant, so skip them. Most of a scene
    // is static scenery, so this makes the steady-state cost scale with MOVING objects, not all.
    if (!t || t === lastApplied.current) return;
    lastApplied.current = t;
    group.position.set(t.position[0], t.position[1], t.position[2]);
    group.rotation.set(t.rotation[0], t.rotation[1], t.rotation[2]);
    group.scale.set(t.scale[0], t.scale[1], t.scale[2]);
  });

  // Attached objects ride a character's bone instead of sitting at their own transform.
  if (object.attachment) {
    return (
      <BoneAttachment object={object} onSelect={() => !isPlaying && selectObject(object.id)}>
        {drawSelf && <Primitive object={object} selected={selected} />}
        {object.particles && <ParticleSystem object={object} />}
        {children}
      </BoneAttachment>
    );
  }

  return (
    <group
      ref={(node) => {
        groupRef.current = node;
        registerObject(object.id, node);
      }}
      userData={{ nfObjectId: object.id }}
      position={object.transform.position}
      rotation={object.transform.rotation}
      scale={object.transform.scale}
      onPointerDown={(event: ThreeEvent<PointerEvent>) => {
        // While playing, clicks belong to the game (mouse-look / shooting), not editor selection.
        if (isPlaying) return;
        // Alt+LMB drives the orbit camera; don't hijack it for selection.
        if (event.nativeEvent.altKey || event.nativeEvent.button !== 0) return;
        // Pointer is on a transform-gizmo handle (which raycasts separately): let the gizmo grab it
        // instead of reselecting whatever mesh happens to sit behind the handle.
        if (isGizmoEngaged?.()) return;
        event.stopPropagation();
        // Shift/Ctrl/Cmd-click extends the multi-selection; a plain click replaces it.
        if (event.nativeEvent.shiftKey || event.nativeEvent.ctrlKey || event.nativeEvent.metaKey) {
          useEditorStore.getState().toggleSelectObject(object.id);
        } else {
          selectObject(object.id);
        }
      }}
    >
      {drawSelf && <Primitive object={object} selected={selected} />}
      {object.particles && <ParticleSystem object={object} />}
      {children}
    </group>
  );
}, sceneObjectPropsEqual);

type TreeRenderOpts = {
  isPlaying: boolean;
  recording: boolean;
  draggingGizmo: boolean;
  previewingCinematic: boolean;
  cinematicPreviewTransforms: Record<string, SceneObject['transform']>;
  cinematicPreviewMaterials: Record<string, MaterialOverrides>;
  selectedObjectId: string;
  /** Every selected object id (multi-select) — drives the highlight outline. */
  selectedSet: Set<string>;
  registerObject: (id: string, object: THREE.Group | null) => void;
  isGizmoEngaged: () => boolean;
};

/**
 * Render the scene's objects as a true parent/child graph: each object is a <group> nested inside
 * its parent's group, so a child's stored transform is LOCAL (relative to the parent) and moving /
 * rotating / scaling a parent carries every descendant with it.
 *
 * Two objects render at the world root even when parented:
 *  - their parent isn't in the visible set (e.g. a hidden parent) — so the child still shows;
 *  - during Play, a physics/character object — the Rapier world owns its WORLD transform, so it
 *    must not also inherit a parent's matrix (which would double-transform it).
 */
function renderObjectTree(objects: SceneObject[], opts: TreeRenderOpts): ReactNode {
  const visible = new Set(objects.map((o) => o.id));
  const detached = (o: SceneObject) =>
    !o.parentId ||
    !visible.has(o.parentId) ||
    (opts.isPlaying && (o.physics?.enabled || o.character?.enabled));

  const childrenByParent = new Map<string, SceneObject[]>();
  const roots: SceneObject[] = [];
  for (const object of objects) {
    if (detached(object)) {
      roots.push(object);
    } else {
      const list = childrenByParent.get(object.parentId!) ?? [];
      list.push(object);
      childrenByParent.set(object.parentId!, list);
    }
  }

  const renderNode = (object: SceneObject): ReactNode => {
    // While recording, the object being dragged uses its live transform (not the keyframe
    // sample) so the gizmo edit is what you see and key.
    const suppressOverride = opts.recording && opts.draggingGizmo && object.id === opts.selectedObjectId;
    const previewTransform =
      opts.previewingCinematic && !suppressOverride ? opts.cinematicPreviewTransforms[object.id] : undefined;
    const previewMaterial = opts.previewingCinematic ? opts.cinematicPreviewMaterials[object.id] : undefined;
    const visibleObject =
      previewTransform || (previewMaterial && object.renderer)
        ? {
            ...object,
            transform: previewTransform ?? object.transform,
            renderer: previewMaterial && object.renderer
              ? { ...object.renderer, overrideMaterial: true, materialOverrides: { ...object.renderer.materialOverrides, ...previewMaterial } }
              : object.renderer,
          }
        : object;
    // Empties are organizational; hide their gizmo box during Play but keep the group so children
    // (and authored particle/effect empties) still position correctly.
    const drawSelf = !(opts.isPlaying && object.kind === 'empty' && !object.effect && !object.particles);
    const kids = childrenByParent.get(object.id);
    return (
      <SceneObjectView
        key={object.id}
        object={visibleObject}
        selected={opts.selectedSet.has(object.id)}
        registerObject={opts.registerObject}
        isGizmoEngaged={opts.isGizmoEngaged}
        drawSelf={drawSelf}
      >
        {kids?.map(renderNode)}
      </SceneObjectView>
    );
  };

  return roots.map(renderNode);
}

// Transient VFX are never selectable or gizmo-targeted, so they don't register their group node.
// These no-ops are module-level (stable references) so SceneObjectView's memo comparator doesn't
// re-render every VFX whenever the editor's selection changes.
const NOOP_REGISTER = () => {};
const NOOP_GIZMO = () => false;

/**
 * Renders the scene's transient runtime VFX — impact sparks, muzzle flashes, dust, splashes, floating
 * damage numbers and projectiles — as a flat list on its OWN store subscription (`useVfxObjects`).
 *
 * This is the render-layer half of the VFX split. The data model is unchanged: tickRuntime still emits
 * one objects array. But by rendering VFX here instead of inside the authored-object tree, their
 * constant spawn/despawn (and per-frame projectile life-ticks) reconcile only this short list, leaving
 * the ~hundreds of authored objects untouched. Each VFX still renders through the exact same
 * SceneObjectView → Primitive path, so visuals and motion (via the transform buffer) are identical.
 */
function VfxLayer() {
  const vfx = useVfxObjects();
  return (
    <>
      {vfx.map((object) => (
        <SceneObjectView
          key={object.id}
          object={object}
          selected={false}
          registerObject={NOOP_REGISTER}
          isGizmoEngaged={NOOP_GIZMO}
        />
      ))}
    </>
  );
}

/** A draggable handle for placing a character's follow-camera offset, with a line back to the pawn. */
/**
 * A live wireframe frustum showing where the selected character's follow camera sits and looks,
 * driven by the SAME resting-pose math as the real camera. It updates every frame, so changing
 * Side/Up/Back/Pitch/Mode in the Inspector visibly moves it — immediate feedback without needing
 * to enter preview or press Play. Purely a viewport gizmo; it never becomes the render camera.
 */
/**
 * Editor-only camera gizmo (Unreal-style): a little 3D camera body sitting at each follow camera's
 * resting pose, plus a wireframe frustum showing its view range. Shown for every camera in the scene
 * so you can see where they are and what they frame; brighter green when its owner is selected, blue
 * otherwise. Purely visual — it never raycasts (so it can't steal selection) and never ships in-game.
 */
function CameraGizmo({ object, selected }: { object: SceneObject; selected: boolean }) {
  const groupRef = useRef<THREE.Group | null>(null);
  const color = selected ? '#3DDC97' : '#5B8CFF';
  // The frustum is a helper for a throwaway camera we re-pose each frame from the resting pose.
  const cam = useMemo(() => new THREE.PerspectiveCamera(50, 16 / 9, 0.3, 6), []);
  const helper = useMemo(() => new THREE.CameraHelper(cam), [cam]);
  useEffect(() => {
    if (helper.material instanceof THREE.LineBasicMaterial) helper.material.color = new THREE.Color(color);
    return () => helper.dispose();
  }, [helper, color]);
  useFrame(() => {
    const pose = computeRestingCameraPose(object);
    cam.fov = pose.fov;
    cam.far = selected ? 9 : 6; // how far the view-range cone is drawn
    cam.position.copy(pose.position);
    cam.lookAt(pose.lookAt);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    helper.update();
    // Pose the camera body the same way (its local -Z points down the view direction).
    const group = groupRef.current;
    if (group) {
      group.position.copy(pose.position);
      group.lookAt(pose.lookAt);
    }
  });
  const noRaycast = () => null;
  return (
    <>
      <primitive object={helper} />
      <group ref={groupRef}>
        {/* body */}
        <mesh raycast={noRaycast}>
          <boxGeometry args={[0.42, 0.3, 0.5]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.35} roughness={0.5} />
        </mesh>
        {/* lens, pointing forward (local -Z) */}
        <mesh raycast={noRaycast} position={[0, 0, -0.32]} rotation={[-Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.13, 0.2, 18]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.45} roughness={0.4} />
        </mesh>
        {/* two film reels on top, for the classic camera silhouette */}
        <mesh raycast={noRaycast} position={[-0.08, 0.27, 0.1]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.11, 0.11, 0.05, 16]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.3} roughness={0.5} />
        </mesh>
        <mesh raycast={noRaycast} position={[0.1, 0.27, 0.1]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.11, 0.11, 0.05, 16]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.3} roughness={0.5} />
        </mesh>
      </group>
    </>
  );
}

function CameraRigGizmo({ object }: { object: SceneObject }) {
  const updateCharacterController = useEditorStore((state) => state.updateCharacterController);
  const [marker, setMarker] = useState<THREE.Mesh | null>(null);
  const [bx, by, bz] = object.transform.position;
  const offset = object.character?.cameraOffset ?? [0, 2.6, -6];
  const worldPos: [number, number, number] = [bx + offset[0], by + offset[1], bz + offset[2]];

  // Keep the marker synced when the offset changes from elsewhere (numeric fields, AI, Set Camera).
  useEffect(() => {
    if (marker) marker.position.set(worldPos[0], worldPos[1], worldPos[2]);
  }, [marker, worldPos[0], worldPos[1], worldPos[2]]);

  const linePoints = useMemo(() => new Float32Array([bx, by, bz, worldPos[0], worldPos[1], worldPos[2]]), [bx, by, bz, worldPos[0], worldPos[1], worldPos[2]]);

  return (
    <>
      <line>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[linePoints, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#3DDC97" />
      </line>
      <mesh ref={setMarker} position={worldPos}>
        <sphereGeometry args={[0.2, 16, 12]} />
        <meshBasicMaterial color="#3DDC97" />
      </mesh>
      {marker && (
        <TransformControls
          object={marker}
          mode="translate"
          size={0.75}
          onObjectChange={() =>
            updateCharacterController(object.id, {
              cameraOffset: [marker.position.x - bx, marker.position.y - by, marker.position.z - bz],
            })
          }
        />
      )}
    </>
  );
}

function SceneContent({
  transformMode,
  transformSpace,
  snapEnabled,
  snapStep,
  angleStepDeg,
  scaleStep,
  focusNonce,
  viewCommand,
  previewCamera,
  sceneApiRef,
  suppressDeselectRef,
}: {
  transformMode: TransformMode;
  transformSpace: 'world' | 'local';
  snapEnabled: boolean;
  snapStep: number;
  angleStepDeg: number;
  scaleStep: number;
  focusNonce: number;
  viewCommand: { view: ViewPreset; nonce: number };
  previewCamera: boolean;
  sceneApiRef: MutableRefObject<SceneApi | null>;
  suppressDeselectRef: MutableRefObject<boolean>;
}) {
  // Shared token-based structural signature (see stableSelectors): same decoupling as the bespoke
  // field-string signature this used before, but the per-tick selector cost is integer compares
  // instead of building a multi-KB string from ~30 fields × every object on every frame.
  // Subscribe to the AUTHORED-object signature only: transient VFX (impacts, muzzle flashes, dust,
  // damage numbers, projectiles) are excluded here and rendered by <VfxLayer/> below on their own
  // subscription. So a burst spawning mid-combat — or a projectile ticking its life every frame — no
  // longer re-renders this whole component (and re-reconciles the entire authored scene); it only
  // touches the small VFX list. The authored geometry is what's expensive to reconcile, and now it
  // re-renders only on real structural edits (spawn/destroy/reparent/component change).
  const sceneSignature = useEditorStore(nonVfxObjectsSignature);
  const allSceneObjects = useMemo(
    () => selectActiveObjects(useEditorStore.getState()).filter((object) => !isTransientVfx(object)),
    [sceneSignature],
  );
  const sceneEnvironment = useEditorStore((state) => state.scenes.find((scene) => scene.id === state.activeSceneId)?.environment);
  const runtimeHidden = useEditorStore((state) => state.runtimeHidden);
  const selectedObjectId = useEditorStore((state) => state.selectedObjectId);
  const selectedObjectIds = useEditorStore((state) => state.selectedObjectIds);
  // Effective multi-selection: the set when it includes the active object, else just the active one.
  const selectedSet = useMemo(
    () => new Set(selectedObjectIds.includes(selectedObjectId) ? selectedObjectIds : selectedObjectId ? [selectedObjectId] : []),
    [selectedObjectId, selectedObjectIds],
  );
  const selectObject = useEditorStore((state) => state.selectObject);
  const updateTransform = useEditorStore((state) => state.updateTransform);
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const cinematicCamera = useEditorStore((state) => state.runtimeCinematicCamera);
  const cinematicPreview = useEditorStore((state) => state.editorCinematicPreview);
  const cinematicPreviewCamera = useEditorStore((state) => state.editorCinematicPreviewCamera);
  const cinematicPreviewTransforms = useEditorStore((state) => state.editorCinematicPreviewTransforms);
  const cinematicPreviewHidden = useEditorStore((state) => state.editorCinematicPreviewHidden);
  const cinematicPreviewMaterials = useEditorStore((state) => state.editorCinematicPreviewMaterials);
  const recording = useEditorStore((state) => state.cinematicRecording);
  const editingKeyframe = useEditorStore((state) => Boolean(state.selectedCinematicKeyframe));
  const previewingCinematic = !isPlaying && Boolean(cinematicPreview);
  // Volumetric fog (post-FX) renders in the editor viewport too, not just Play, so its look is
  // authorable live in Scene Settings. Mount PostFx whenever it's enabled on the active scene.
  const volumetricFogActive = useEditorStore(
    (state) =>
      Boolean(state.scenes.find((scene) => scene.id === state.activeSceneId)?.environment?.volumetricFogEnabled),
  );
  // Camera-space view-models are hidden from the world viewport; select them from the Hierarchy
  // and edit their transform in the Inspector when their first-person placement needs tuning.
  const sceneObjects = allSceneObjects.filter(
    (object) =>
      !object.viewModel &&
      !(isPlaying && hideInRuntime(object)) &&
      !((isPlaying ? runtimeHidden : cinematicPreviewHidden).includes(object.id)),
  );
  // GPU instancing for repeated static decoration models (Play-only, toggle in the F8 overlay). Batches
  // recompute structurally only — the active-scene array gets a new identity every tick, so we keep the
  // SAME batches object until the membership SIGNATURE changes (object added/removed/hidden), which stops
  // the InstancedMeshes from being torn down and rebuilt 60×/s when nothing structural moved.
  const instancingOn = useInstancingEnabled();
  // Models whose imported materials carry a custom texture diverge from their baked maps, so they can't
  // share the instanced (baked-material) draw — exclude them from batching.
  const allMaterials = useEditorStore((state) => state.materials);
  const customizedModels = useMemo(() => customizedModelIds(allMaterials), [allMaterials]);
  const rawInstanceBatches =
    instancingOn && isPlaying ? computeInstanceBatches(sceneObjects, customizedModels) : EMPTY_BATCHES;
  const instanceSig = batchSignature(rawInstanceBatches);
  const instanceBatchesRef = useRef<Map<string, SceneObject[]>>(EMPTY_BATCHES);
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

  const cameraRigTarget = useEditorStore((state) => state.cameraRigTarget);
  const followTargetId = useFollowTargetId();
  const followTarget = followTargetId ? allSceneObjects.find((object) => object.id === followTargetId) : undefined;
  const cameraRigObject = cameraRigTarget ? sceneObjects.find((o) => o.id === cameraRigTarget && o.character) : undefined;
  // Every object that drives a follow camera (character or vehicle) — each gets a 3D camera gizmo
  // + frustum in edit mode so you can see where the cameras are and what they frame.
  const cameraObjects = sceneObjects.filter((object) => resolveCameraConfig(object));
  // The selected physics object — gets a wireframe preview of its true collider shape.
  const selectedColliderObject = sceneObjects.find(
    (o) => o.id === selectedObjectId && o.physics?.enabled,
  );
  // The selected object's joint — gets an anchor/link/axis preview (see JointGizmo).
  const selectedJointObject = sceneObjects.find((o) => o.id === selectedObjectId && o.joint?.enabled);
  const objectRefs = useRef(new Map<string, THREE.Group>());
  const [selectedTarget, setSelectedTarget] = useState<THREE.Group | null>(null);
  // Hold Ctrl to momentarily flip snapping (Blender/Unity convention): snap on → off while held, and
  // off → on. Lets you nudge freely without toggling the persisted setting, or snap a single drag.
  const [snapOverride, setSnapOverride] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Control') setSnapOverride(event.type === 'keydown');
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, []);
  const effectiveSnap = snapEnabled !== snapOverride;
  // Ref to the live three TransformControls. `axis` is non-null while the pointer hovers a handle
  // (set on pointer-move, before the press), and `dragging` is true mid-drag — either means a click
  // belongs to the gizmo, not to editor selection.
  const controlsRef = useRef<{ axis: string | null; dragging: boolean } | null>(null);
  const isGizmoEngaged = useCallback(
    () => Boolean(controlsRef.current && (controlsRef.current.axis || controlsRef.current.dragging)),
    [],
  );

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

  const [draggingGizmo, setDraggingGizmo] = useState(false);
  // While moving a multi-selection, the start poses of the active object and the others, so each
  // frame's gizmo delta (from the active object) can be applied to the rest as a group transform.
  const multiDragRef = useRef<{
    activeStart: { position: number[]; rotation: number[]; scale: number[] };
    others: Array<{ id: string; position: number[]; rotation: number[]; scale: number[] }>;
  } | null>(null);

  const syncSelectedTransform = useCallback(() => {
    const target = objectRefs.current.get(selectedObjectId);
    if (!target) return;

    updateTransform(selectedObjectId, 'position', [target.position.x, target.position.y, target.position.z]);
    updateTransform(selectedObjectId, 'rotation', [target.rotation.x, target.rotation.y, target.rotation.z]);
    updateTransform(selectedObjectId, 'scale', [target.scale.x, target.scale.y, target.scale.z]);

    // Group move/rotate/scale: apply the active object's delta-from-start to every other selected one.
    const md = multiDragRef.current;
    if (md) {
      const dp = [target.position.x - md.activeStart.position[0], target.position.y - md.activeStart.position[1], target.position.z - md.activeStart.position[2]];
      const dr = [target.rotation.x - md.activeStart.rotation[0], target.rotation.y - md.activeStart.rotation[1], target.rotation.z - md.activeStart.rotation[2]];
      const sr = [
        md.activeStart.scale[0] ? target.scale.x / md.activeStart.scale[0] : 1,
        md.activeStart.scale[1] ? target.scale.y / md.activeStart.scale[1] : 1,
        md.activeStart.scale[2] ? target.scale.z / md.activeStart.scale[2] : 1,
      ];
      md.others.forEach((o) => {
        updateTransform(o.id, 'position', [o.position[0] + dp[0], o.position[1] + dp[1], o.position[2] + dp[2]]);
        updateTransform(o.id, 'rotation', [o.rotation[0] + dr[0], o.rotation[1] + dr[1], o.rotation[2] + dr[2]]);
        updateTransform(o.id, 'scale', [o.scale[0] * sr[0], o.scale[1] * sr[1], o.scale[2] * sr[2]]);
      });
    }
  }, [selectedObjectId, updateTransform]);

  // Record mode: seed the object's pose from the current keyframe sample so grabbing the gizmo
  // doesn't snap, then suppress its preview override for the duration of the drag.
  const beginGizmoDrag = useCallback(() => {
    if (recording && previewingCinematic) {
      const sampled = cinematicPreviewTransforms[selectedObjectId];
      if (sampled) {
        updateTransform(selectedObjectId, 'position', sampled.position);
        updateTransform(selectedObjectId, 'rotation', sampled.rotation);
        updateTransform(selectedObjectId, 'scale', sampled.scale);
      }
    }
    // Snapshot the group's starting poses (siblings move 1:1; the active object is the gizmo pivot).
    const state = useEditorStore.getState();
    const ids = effectiveSelection(state);
    if (ids.length > 1) {
      const objects = selectActiveObjects(state);
      const active = objects.find((object) => object.id === selectedObjectId);
      if (active) {
        multiDragRef.current = {
          activeStart: {
            position: [...active.transform.position],
            rotation: [...active.transform.rotation],
            scale: [...active.transform.scale],
          },
          others: ids
            .filter((id) => id !== selectedObjectId)
            .map((id) => objects.find((object) => object.id === id))
            .filter((object): object is SceneObject => Boolean(object))
            .map((object) => ({
              id: object.id,
              position: [...object.transform.position],
              rotation: [...object.transform.rotation],
              scale: [...object.transform.scale],
            })),
        };
      }
    } else {
      multiDragRef.current = null;
    }
    setDraggingGizmo(true);
  }, [recording, previewingCinematic, cinematicPreviewTransforms, selectedObjectId, updateTransform]);

  // Record mode: on release, drop/refresh a transform keyframe at the playhead from the dragged pose.
  const endGizmoDrag = useCallback(() => {
    setDraggingGizmo(false);
    multiDragRef.current = null;
    const store = useEditorStore.getState();
    if (!store.cinematicRecording || store.isPlaying) return;
    const target = objectRefs.current.get(selectedObjectId);
    if (!target) return;
    const cinematicId = store.activeCinematicId || store.activeScene()?.cinematics?.[0]?.id;
    if (!cinematicId) return;
    const time = store.editorCinematicPreview?.sequenceId === cinematicId ? store.editorCinematicPreview.time : 0;
    store.addCinematicTransformKeyframe(cinematicId, selectedObjectId, time, {
      position: [target.position.x, target.position.y, target.position.z],
      rotation: [target.rotation.x, target.rotation.y, target.rotation.z],
      scale: [target.scale.x, target.scale.y, target.scale.z],
    });
  }, [selectedObjectId]);

  // Expose box-select to the DOM-side ViewportPanel: project each object's world position to screen
  // and select everything inside the dragged rectangle. Reads the scene fresh so deps stay stable.
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  useEffect(() => {
    sceneApiRef.current = {
      isGizmoEngaged: () => isGizmoEngaged(),
      boxSelect: (rect, additive) => {
        const cr = gl.domElement.getBoundingClientRect();
        const v = new THREE.Vector3();
        const hits: string[] = [];
        for (const object of selectActiveObjects(useEditorStore.getState())) {
          if (object.viewModel) continue;
          const group = objectRefs.current.get(object.id);
          if (!group) continue;
          group.getWorldPosition(v).project(camera);
          if (v.z > 1) continue; // behind the camera
          const cx = cr.left + (v.x * 0.5 + 0.5) * cr.width;
          const cy = cr.top + (-v.y * 0.5 + 0.5) * cr.height;
          if (cx >= rect.left && cx <= rect.right && cy >= rect.top && cy <= rect.bottom) hits.push(object.id);
        }
        const store = useEditorStore.getState();
        store.selectObjects(additive ? [...effectiveSelection(store), ...hits] : hits);
      },
      dropToSurface: (ids) => {
        if (ids.length === 0) return;
        const idSet = new Set(ids);
        // Landing targets = every OTHER registered object group (excludes the dropped objects, and
        // naturally excludes the grid / gizmo / shadows / lights, which aren't in objectRefs).
        const targets: THREE.Object3D[] = [];
        for (const [tid, group] of objectRefs.current) if (!idSet.has(tid)) targets.push(group);
        const ray = new THREE.Raycaster();
        const down = new THREE.Vector3(0, -1, 0);
        const box = new THREE.Box3();
        const origin = new THREE.Vector3();
        for (const id of ids) {
          const group = objectRefs.current.get(id);
          if (!group) continue;
          group.getWorldPosition(origin);
          box.setFromObject(group);
          if (!Number.isFinite(box.min.y)) continue;
          // Cast from just above the object's top so we never start inside it.
          ray.set(new THREE.Vector3(origin.x, box.max.y + 0.05, origin.z), down);
          const hits = ray.intersectObjects(targets, true);
          const surfaceY = hits.length > 0 ? hits[0].point.y : 0;
          const bottomToOrigin = origin.y - box.min.y; // how far the pivot sits above the AABB bottom
          const world = new THREE.Vector3(origin.x, surfaceY + bottomToOrigin, origin.z);
          // Object transforms are LOCAL; convert through the parent (identity for unparented objects).
          const local = group.parent ? group.parent.worldToLocal(world.clone()) : world;
          updateTransform(id, 'position', [local.x, local.y, local.z]);
        }
      },
    };
    return () => {
      sceneApiRef.current = null;
    };
  }, [camera, gl, isGizmoEngaged, sceneApiRef, updateTransform]);

  return (
    <>
      <SceneEnvironment environment={sceneEnvironment} />
      {/* Shared InstancedMesh batches for repeated static decoration models (Play-only; off unless toggled). */}
      <ModelInstances batches={instanceBatches} />
      <InstancedIdsContext.Provider value={instancedIds}>
      <group
        onPointerMissed={(event: MouseEvent) => {
          // While playing, clicks belong to the game, not editor selection.
          if (isPlaying) return;
          // Ignore the click that ends an Alt-orbit / right-drag navigation gesture.
          if (event.altKey || event.button !== 0) return;
          // Grabbing a gizmo handle over empty space hits no mesh and would otherwise fire here and
          // deselect the object — bail so the gizmo keeps the selection while you drag.
          if (isGizmoEngaged()) return;
          // A box-select drag just ran (and set the selection itself) — don't clear it.
          if (suppressDeselectRef.current) return;
          selectObject('');
        }}
      >
        {renderObjectTree(sceneObjects, {
          isPlaying,
          recording,
          draggingGizmo,
          previewingCinematic,
          cinematicPreviewTransforms,
          cinematicPreviewMaterials,
          selectedObjectId,
          selectedSet,
          registerObject,
          isGizmoEngaged,
        })}
        {/* Transient runtime VFX (impacts/muzzle/dust/splash/damage numbers/projectiles) render here on
            their OWN store subscription, so their constant spawn/despawn churn never re-reconciles the
            authored objects above. Same components/visuals — just an isolated React list. */}
        <VfxLayer />
      </group>
      </InstancedIdsContext.Provider>
      {/* World-space UI widgets anchored to objects (edit + play). Use the UNFILTERED list so signs on
          invisible/empty anchors (e.g. tutorial labels) still show during Play. */}
      {allSceneObjects.map((object) => (object.ui ? <WorldUIAnchor key={`ui-${object.id}`} object={object} /> : null))}
      {/* Animated, translucent skin for every enabled Water Volume — renders the buoyancy wave so the
          surface is visible in edit AND Play. Unfiltered list: volumes are usually triggers (hidden in
          runtime), but their water must still show. */}
      {allSceneObjects.map((object) =>
        object.water?.enabled ? <WaterSurface key={`water-${object.id}`} object={object} /> : null,
      )}
      {/* Scene-capture pass feeding water reflections/refraction/depth-foam (High/Epic; no-op otherwise). */}
      <WaterEnvCapture />
      {/* Screen tint + murk while the active camera is submerged in a Water Volume (edit + play). */}
      <UnderwaterOverlay />
      {/* WebGL HUD (uikit) for renderMode:'webgl' screen docs — lives in-canvas so PostFx bloom hits it. */}
      <WebGLScreenUILayer />
      {selectedTarget && !isPlaying && !cameraRigObject && (!previewingCinematic || recording) && (
        <TransformControls
          ref={controlsRef as never}
          object={selectedTarget}
          mode={transformMode}
          size={1.1}
          onObjectChange={syncSelectedTransform}
          onMouseDown={beginGizmoDrag}
          onMouseUp={endGizmoDrag}
          space={transformSpace}
          translationSnap={effectiveSnap ? snapStep : null}
          rotationSnap={effectiveSnap ? (angleStepDeg * Math.PI) / 180 : null}
          scaleSnap={effectiveSnap ? scaleStep : null}
        />
      )}
      {/* 3D camera gizmos + view-range frustums for every follow camera in the scene (Unreal-style),
          so cameras are visible and their framing updates live. Hidden while playing / previewing. */}
      {!isPlaying &&
        !previewCamera &&
        !previewingCinematic &&
        cameraObjects.map((object) => (
          <CameraGizmo key={`cam-gizmo-${object.id}`} object={object} selected={selectedSet.has(object.id)} />
        ))}
      {/* Camera-placement mode: drag a handle to set the follow-camera offset. Hidden while previewing
          through the camera (you can't grab a handle from inside the lens — toggle preview off to drag). */}
      {cameraRigObject && !isPlaying && !previewCamera && !previewingCinematic && <CameraRigGizmo object={cameraRigObject} />}
      {/* Wireframe preview of the selected object's true collider (edit + Play), so the
          actual physics shape — which often differs from the visual mesh — is visible. */}
      {selectedColliderObject && <ColliderGizmo object={selectedColliderObject} />}
      {/* Anchor + link + axis preview for the selected object's physics joint. */}
      {selectedJointObject && <JointGizmo object={selectedJointObject} sceneObjects={sceneObjects} />}
      {/* Unreal-style terrain brush ring — self-gates on the active sculpt/paint tool + cursor hover. */}
      <TerrainBrushCursor />
      {/* Film Mode: draggable spline + keyframe handles so camera/object paths are built in 3D. */}
      <CinematicPathGizmo />
      {/* Editor ground aids — hidden during Play so they don't show up (or sit at the origin over terrain) in
          the running game. */}
      {!isPlaying && <gridHelper args={[24, 24, '#30394D', '#202737']} position={[0, 0.01, 0]} />}
      {!isPlaying && (sceneEnvironment?.contactShadows ?? true) && (
        <ContactShadows
          position={[0, (sceneEnvironment?.contactShadowY ?? 0) - 0.01, 0]}
          opacity={sceneEnvironment?.contactShadowOpacity ?? 0.36}
          scale={sceneEnvironment?.contactShadowScale ?? 14}
          blur={2.4}
          far={6}
        />
      )}
      {/* During Play (or when previewing) a character's follow camera takes over the view; otherwise free-orbit.
          Preview mode (editor, not playing) frames the resting camera so offset/pitch tuning is visible live. */}
      {isPlaying && cinematicCamera ? (
        <CinematicCamera />
      ) : !isPlaying && cinematicPreviewCamera && !recording && !editingKeyframe ? (
        // While recording (or editing a keyframe handle) you stay on the free editor camera so you can
        // fly to frame / drag the path; navigating the viewport auto-keys the cinematic camera track.
        <CinematicCamera pose={cinematicPreviewCamera} />
      ) : (isPlaying || previewCamera) && followTarget ? (
        <FollowCamera preview={!isPlaying} />
      ) : (
        <EditorCamera focusNonce={focusNonce} viewCommand={viewCommand} />
      )}
      {/* Marker over the player's lock-on target — only ever set during Play, renders nothing otherwise. */}
      {isPlaying && <LockOnMarker />}
      {/* Post-FX (bloom/vignette + cinematic grade/DoF) during Play so the editor matches the shipped
          game look — and also while scrubbing a cinematic preview so grading/focus are visible there. */}
      {(isPlaying || previewingCinematic || volumetricFogActive) && <PostFx />}
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

/**
 * Reads three.js renderer counters once per frame and feeds them to the perf overlay.
 * `gl.info` auto-resets right before each render, so in a pre-render `useFrame` these hold the
 * PREVIOUS frame's totals — a 1-frame lag that's irrelevant for a stats display.
 */
function RenderStatsProbe() {
  const gl = useThree((state) => state.gl);
  // Wrap WebGLRenderer.render with a wall-clock accumulator: a frame may render several times
  // (post-fx passes, shadow updates happen inside), so sum all calls between two useFrames. The
  // pre-render useFrame below then publishes the PREVIOUS frame's total — same 1-frame lag as gl.info.
  const renderAccum = useRef(0);
  // gl.info auto-resets at the START of every render call, and the post-fx composer issues several
  // per frame — so sampling info once per frame only ever saw the LAST pass (the fullscreen copy:
  // 1 call, 1 triangle). Sum each call's counters right after it completes instead.
  const callsAccum = useRef(0);
  const trianglesAccum = useRef(0);
  useEffect(() => {
    const original = gl.render.bind(gl);
    (gl as { render: typeof gl.render }).render = (...args: Parameters<typeof gl.render>) => {
      const start = performance.now();
      original(...args);
      renderAccum.current += performance.now() - start;
      callsAccum.current += gl.info.render.calls;
      trianglesAccum.current += gl.info.render.triangles;
    };
    return () => {
      (gl as { render: typeof gl.render }).render = original;
    };
  }, [gl]);
  useFrame(() => {
    recordRenderTime(renderAccum.current);
    renderAccum.current = 0;
    const info = gl.info;
    recordRender({
      calls: callsAccum.current,
      triangles: trianglesAccum.current,
      programs: info.programs?.length ?? 0,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
    });
    callsAccum.current = 0;
    trianglesAccum.current = 0;
  });
  return null;
}

/**
 * Shadow budget: during Play, keep shadows on the first N shadow-capable lights and disable the rest,
 * where N comes from the active quality preset (`maxShadowCasters` — 0 on Low, up to 16 on Epic).
 * Forward rendering makes each shadow-caster a full extra depth pass, so over-budget scenes (e.g. the
 * car-select menu's 10 spotlights) cap here. Deliberately re-evaluated ONLY when the caster COUNT or the
 * quality level CHANGES — never per-frame or by camera distance — because toggling `castShadow` triggers
 * a shader recompile, and doing that every frame would cost more than it saves. Authored intent is
 * remembered in userData and restored when the scene drops back under budget. Stop resets it.
 */
function LightBudget() {
  const scene = useThree((state) => state.scene);
  const evaluatedCount = useRef(-1);
  const evaluatedQuality = useRef<string | undefined>(undefined);
  const frameCounter = useRef(0);
  useFrame(({ camera }) => {
    const editorState = useEditorStore.getState();
    if (!editorState.isPlaying) {
      evaluatedCount.current = -1;
      evaluatedQuality.current = undefined;
      return;
    }
    // The caster-count check below needs a full scene traversal — far too heavy to run per frame for
    // a count that almost never changes (the effect-light pool keeps it constant during gameplay).
    // Poll at ~4Hz; a light added mid-Play gets budgeted within a quarter second.
    frameCounter.current += 1;
    if (frameCounter.current % 15 !== 1) return;
    const quality = editorState.renderSettings.quality;
    const maxCasters = qualityProfile(quality).maxShadowCasters;
    const casters: THREE.Light[] = [];
    scene.traverse((obj) => {
      const light = obj as THREE.Light & { shadow?: unknown };
      if (light.isLight && light.shadow) casters.push(light);
    });
    if (casters.length === evaluatedCount.current && quality === evaluatedQuality.current) return;
    evaluatedCount.current = casters.length;
    evaluatedQuality.current = quality;
    // Over budget, spend the shadow slots on what the player can SEE: the sun (directional) first,
    // then the lights nearest the camera at evaluation time — not whatever scene-traversal order
    // happened to produce. Still evaluated only on count/quality changes (see the recompile note above).
    if (casters.length > maxCasters) {
      casters.sort((a, b) => {
        const aDir = (a as THREE.DirectionalLight).isDirectionalLight ? 1 : 0;
        const bDir = (b as THREE.DirectionalLight).isDirectionalLight ? 1 : 0;
        if (aDir !== bDir) return bDir - aDir;
        return a.getWorldPosition(lightPosA).distanceToSquared(camera.position) - b.getWorldPosition(lightPosB).distanceToSquared(camera.position);
      });
    }
    casters.forEach((light, i) => {
      if (light.userData.nfWantsShadow === undefined) light.userData.nfWantsShadow = light.castShadow;
      light.castShadow = Boolean(light.userData.nfWantsShadow) && i < maxCasters;
    });
  });
  return null;
}

const lightPosA = new THREE.Vector3();
const lightPosB = new THREE.Vector3();

/**
 * Empty-scene quick start: when a project has no objects yet, the viewport offers the two clicks
 * every game starts with (ground + player) instead of a blank stare. Disappears the moment the
 * scene has content.
 */
function QuickStartOverlay() {
  const isEmpty = useEditorStore((state) => selectActiveObjects(state).length === 0);
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const editingPrefabId = useEditorStore((state) => state.editingPrefabId);
  if (!isEmpty || isPlaying || editingPrefabId) return null;
  const store = () => useEditorStore.getState();
  const addGround = () => {
    const id = store().createObjectWithProps('plane', {
      name: 'Ground',
      position: [0, 0, 0],
      color: '#39414f',
      physics: { enabled: true, bodyType: 'fixed', collider: 'box' },
    });
    store().updateTransform(id, 'scale', [60, 1, 60]);
    store().selectObject(id);
  };
  const addPlayer = () => {
    const id = store().createObjectWithProps('capsule', {
      name: 'Player',
      position: [0, 1.1, 0],
      color: '#22e0ff',
    });
    store().toggleCharacterController(id); // seeds the third-person controller (WASD + follow camera)
    store().selectObject(id);
  };
  return (
    <div className="quickstart-overlay">
      <div className="quickstart-card">
        <h3>Start your game</h3>
        <p>Every game starts the same way — or skip ahead with a template or the AI assistant.</p>
        <div className="quickstart-actions">
          <button onClick={addGround}>＋ Add ground</button>
          <button
            onClick={() => {
              addGround();
              addPlayer();
            }}
          >
            ＋ Ground + playable character
          </button>
        </div>
        <small>Tip: the AI chat (bottom right) can build whole scenes — try “make a small race track”.</small>
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

const SNAP_STEPS = [0.25, 0.5, 1, 2];
const SNAP_ANGLES = [5, 15, 45, 90];
const SNAP_SCALES = [0.1, 0.25, 0.5, 1];

/** Quality preset + Auto toggle, tucked into a popover so the topbar shows only frequent controls. */
function QualityControl() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const quality = useEditorStore((state) => state.renderSettings.quality) ?? 'High';
  const autoQuality = useEditorStore((state) => state.renderSettings.autoQuality !== false);
  const updateRenderSettings = useEditorStore((state) => state.updateRenderSettings);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div className="file-menu" ref={ref}>
      <button
        className={open ? 'viewport-tool-trigger active' : 'viewport-tool-trigger'}
        title="Game quality (scalability) — resolution, shadows, post-FX"
        onClick={() => setOpen((value) => !value)}
      >
        <Gauge size={14} aria-hidden />
        <span>{quality}</span>
        <ChevronDown size={12} aria-hidden />
      </button>
      {open && (
        <div className="file-menu-popover quality-popover">
          <div className="file-menu-section">Game quality</div>
          {QUALITY_LEVELS.map((level) => (
            <button
              key={level}
              className={quality === level ? 'active' : undefined}
              onClick={() => updateRenderSettings({ quality: level })}
            >
              {level}
            </button>
          ))}
          <hr />
          <label className="quality-auto">
            <input type="checkbox" checked={autoQuality} onChange={(event) => updateRenderSettings({ autoQuality: event.target.checked })} />
            <span>Auto — drop under load while playing</span>
          </label>
        </div>
      )}
    </div>
  );
}

export function ViewportPanel() {
  const [transformMode, setTransformMode] = useState<TransformMode>('translate');
  // Snap + coordinate space persist across reloads (browser-only viewport prefs).
  const transformSpace = useViewportPrefs((state) => state.transformSpace);
  const setTransformSpace = useViewportPrefs((state) => state.setTransformSpace);
  const snapEnabled = useViewportPrefs((state) => state.snapEnabled);
  const setSnapEnabled = useViewportPrefs((state) => state.setSnapEnabled);
  const snapStep = useViewportPrefs((state) => state.snapStep);
  const setSnapStep = useViewportPrefs((state) => state.setSnapStep);
  const angleStepDeg = useViewportPrefs((state) => state.angleStepDeg);
  const setAngleStepDeg = useViewportPrefs((state) => state.setAngleStepDeg);
  const scaleStep = useViewportPrefs((state) => state.scaleStep);
  const setScaleStep = useViewportPrefs((state) => state.setScaleStep);
  const [focusNonce, setFocusNonce] = useState(0);
  // Bumped to command the editor camera to a standard orientation (ViewCube / numpad presets).
  const [viewCommand, setViewCommand] = useState<{ view: ViewPreset; nonce: number }>({ view: 'persp', nonce: 0 });
  const [previewCamera, setPreviewCamera] = useState(false);
  // Adaptive resolution for the editor viewport. Without a cap the Canvas renders at native
  // devicePixelRatio (2–3x on Retina = 4–9x the fragments), which is the biggest "editor feels
  // heavy" cost. Cap at 1.5 and let PerformanceMonitor drop to 1 when the frame rate dips.
  const [dpr, setDpr] = useState(1.5);
  const hasWebGL = useMemo(detectWebGL, []);
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const setPlaying = useEditorStore((state) => state.setPlaying);
  const hasSelection = useEditorStore((state) => Boolean(state.selectedObjectId));
  const dropSelectionToSurface = useCallback(() => {
    sceneApiRef.current?.dropToSurface(effectiveSelection(useEditorStore.getState()));
  }, []);
  // Adaptive quality only degrades DURING Play — give the user back their authored preset on Stop.
  useEffect(() => {
    if (!isPlaying) resetAutoQuality();
  }, [isPlaying]);
  const cinematicPreview = useEditorStore((state) => state.editorCinematicPreview);
  const cinematicPreviewFade = useEditorStore((state) => state.editorCinematicPreviewFade);
  const cinematicPreviewLook = useEditorStore((state) => state.editorCinematicPreviewLook);
  const editingPrefabId = useEditorStore((state) => state.editingPrefabId);
  const editingPrefabName = useEditorStore((state) =>
    state.prefabs.find((prefab) => prefab.id === state.editingPrefabId)?.name ?? 'Prefab',
  );
  const closePrefabEditor = useEditorStore((state) => state.closePrefabEditor);
  // Game quality (scalability) preset — drives render resolution, shadows, and post-FX MSAA.
  const quality = useEditorStore((state) => state.renderSettings.quality);
  const autoQuality = useEditorStore((state) => state.renderSettings.autoQuality !== false);
  const updateRenderSettings = useEditorStore((state) => state.updateRenderSettings);
  const qProfile = qualityProfile(quality);
  const followTargetMeta = useEditorStore((state) => {
    const target = selectActiveObjects(state).find(
      (object) =>
        (object.character?.enabled && object.character.cameraFollow) ||
        (object.vehicle?.enabled && object.vehicle.cameraFollow),
    );
    return target ? `${target.id}|${target.name}|${target.character?.mouseLook ? 'mouse' : ''}` : '';
  });
  const followTarget = useMemo(() => {
    const id = followTargetMeta.split('|')[0];
    return id ? selectActiveObjects(useEditorStore.getState()).find((object) => object.id === id) : undefined;
  }, [followTargetMeta]);
  const showMouseHint = isPlaying && Boolean(followTarget?.character?.mouseLook);
  // Camera preview (look through the player camera) and gizmo positioning are mutually exclusive —
  // you can't grab a world handle from inside the lens. Starting to position the camera exits preview.
  const cameraRigTarget = useEditorStore((state) => state.cameraRigTarget);
  const setCameraRigTarget = useEditorStore((state) => state.setCameraRigTarget);
  useEffect(() => {
    if (cameraRigTarget) setPreviewCamera(false);
  }, [cameraRigTarget]);

  // Unreal-style viewport hotkeys: gizmo modes, focus, duplicate, delete, deselect, space toggle.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (document.activeElement?.closest('.flow-shell')) return;
      const store = useEditorStore.getState();
      if (store.isPlaying) return;
      // Don't steal keystrokes while typing in a field.
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;

      const key = event.key.toLowerCase();
      // Undo / redo (Ctrl/Cmd+Z, Shift+Z or Ctrl+Y to redo).
      if ((event.metaKey || event.ctrlKey) && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && key === 'y') {
        event.preventDefault();
        redo();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && key === 'd') {
        if (store.selectedObjectId) {
          event.preventDefault();
          store.duplicateSelectedObject();
        }
        return;
      }
      // Select-all in the active scene (Ctrl/Cmd+A).
      if ((event.metaKey || event.ctrlKey) && key === 'a') {
        const ids = selectActiveObjects(store).filter((object) => !object.viewModel).map((object) => object.id);
        if (ids.length) {
          event.preventDefault();
          store.selectObjects(ids);
        }
        return;
      }
      // Copy / paste the selection.
      if ((event.metaKey || event.ctrlKey) && key === 'c') {
        if (store.selectedObjectId) {
          event.preventDefault();
          store.copySelectedObjects();
        }
        return;
      }
      if ((event.metaKey || event.ctrlKey) && key === 'v') {
        if (store.objectClipboard?.length) {
          event.preventDefault();
          store.pasteClipboard();
        }
        return;
      }
      // Group (Ctrl/Cmd+G) / ungroup (add Shift) the selection.
      if ((event.metaKey || event.ctrlKey) && key === 'g') {
        event.preventDefault();
        if (event.shiftKey) store.ungroupObject(store.selectedObjectId);
        else store.groupSelectedObjects();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      // View presets (Blender-style numpad, plus the row digits as a fallback).
      const preset = VIEW_PRESET_KEYS[event.code] ?? VIEW_PRESET_KEYS[key];
      if (preset) {
        if (editorNav.flying) return;
        setViewCommand((command) => ({ view: preset, nonce: command.nonce + 1 }));
        return;
      }

      switch (key) {
        case 'w':
        case 'e':
        case 'r':
          // While the right-mouse flythrough is active these drive the camera, not the gizmo.
          if (editorNav.flying) return;
          setTransformMode(key === 'w' ? 'translate' : key === 'e' ? 'rotate' : 'scale');
          break;
        case 'x': {
          const prefs = useViewportPrefs.getState();
          prefs.setTransformSpace(prefs.transformSpace === 'world' ? 'local' : 'world');
          break;
        }
        case 'f':
          setFocusNonce((nonce) => nonce + 1);
          break;
        case 'end':
          // Drop the selection onto the geometry below it (Unreal "End" convention).
          if (store.selectedObjectId) {
            event.preventDefault();
            sceneApiRef.current?.dropToSurface(effectiveSelection(store));
          }
          break;
        case 'escape':
          store.selectObject('');
          break;
        case 'delete':
        case 'backspace':
          if (store.selectedObjectId) {
            event.preventDefault();
            store.deleteSelectedObject();
          }
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Box-select bridge to the in-Canvas scene, plus the live marquee rectangle (client coords).
  const sceneApiRef = useRef<SceneApi | null>(null);
  const suppressDeselectRef = useRef(false);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const [boxRect, setBoxRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  // Drag a rectangle over empty viewport space to select everything inside it (Shift = add).
  const handleViewportMouseDown = (event: React.MouseEvent) => {
    if (isPlaying || previewCamera) return;
    // A terrain tool (sculpt/paint/foliage) is active — left-drag paints the terrain, so don't also start
    // a box-select marquee (it would fight the brush and obscure the terrain).
    if (useEditorStore.getState().terrainBrush.enabled) return;
    // Plain left-drag only — RMB/MMB/Alt belong to the camera; Ctrl/Cmd are reserved.
    if (event.button !== 0 || event.altKey || event.metaKey || event.ctrlKey) return;
    // Pressing a transform-gizmo handle starts a drag, not a box-select.
    if (sceneApiRef.current?.isGizmoEngaged()) return;
    const additive = event.shiftKey;
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;
    const move = (e: MouseEvent) => {
      if (!moved && (Math.abs(e.clientX - startX) > 4 || Math.abs(e.clientY - startY) > 4)) {
        moved = true;
        suppressDeselectRef.current = true; // keep the click-on-empty handler from clearing the box result
      }
      if (moved) setBoxRect({ x0: startX, y0: startY, x1: e.clientX, y1: e.clientY });
    };
    const up = (e: MouseEvent) => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      if (moved) {
        sceneApiRef.current?.boxSelect(
          { left: Math.min(startX, e.clientX), right: Math.max(startX, e.clientX), top: Math.min(startY, e.clientY), bottom: Math.max(startY, e.clientY) },
          additive,
        );
        // Release the suppression once this event has fully settled (after R3F's pointerMissed).
        setTimeout(() => {
          suppressDeselectRef.current = false;
        }, 0);
      }
      setBoxRect(null);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  // Drag-and-drop a model from the project browser onto the ground under the cursor.
  const dropContextRef = useRef<DropContext | null>(null);
  const groundPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);

  const handleDragOver = useCallback((event: React.DragEvent) => {
    // Rely on the shared holder (the webview may hide our custom type during dragover).
    if (!isAssetDrag(event.dataTransfer) && !isPrefabDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  // Project the cursor onto the ground plane (y=0); falls back to the origin if unavailable.
  const cursorGroundPosition = useCallback(
    (event: React.DragEvent): [number, number, number] => {
      const ctx = dropContextRef.current;
      if (!ctx) return [0, 0, 0];
      const rect = ctx.canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, ctx.camera);
      const hit = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(groundPlane, hit)) {
        const sceneObjects = selectActiveObjects(useEditorStore.getState());
        const terrainY = highestTerrainWorldHeight(sceneObjects, hit.x, hit.z);
        return [Number(hit.x.toFixed(2)), Number((terrainY ?? 0).toFixed(2)), Number(hit.z.toFixed(2))];
      }
      return [0, 0, 0];
    },
    [groundPlane, raycaster],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      const store = useEditorStore.getState();

      // A prefab dragged from the browser → stamp an instance at the cursor.
      const prefabId = readPrefabDragId(event.dataTransfer);
      if (prefabId) {
        prefabDrag.id = null;
        event.preventDefault();
        event.stopPropagation();
        const prefab = store.prefabs.find((item) => item.id === prefabId);
        if (!prefab) return;
        const position = cursorGroundPosition(event);
        const id = store.instantiatePrefab(prefabId, { position });
        useProjectStore.setState({
          toast: id
            ? { kind: 'success', message: `Placed "${prefab.name}" in the scene.` }
            : { kind: 'error', message: `Couldn't place "${prefab.name}".` },
        });
        return;
      }

      const assetId = readAssetDragId(event.dataTransfer);
      assetDrag.id = null;
      if (!assetId) return;
      event.preventDefault();
      event.stopPropagation();

      // A Particle System asset → drop an empty effect anchor at the cursor, emitting that system.
      const particleSystem = store.particleSystems.find((item) => item.id === assetId);
      if (particleSystem) {
        const position = cursorGroundPosition(event);
        const id = store.createObjectWithProps('empty', { name: particleSystem.name, position });
        store.setObjectParticleSystem(id, particleSystem.id);
        store.selectObject(id);
        useProjectStore.setState({ toast: { kind: 'success', message: `Placed "${particleSystem.name}" in the scene.` } });
        return;
      }

      const asset = store.assets.find((item) => item.id === assetId);
      if (!asset) return;
      if (asset.type !== 'model') {
        useProjectStore.setState({
          toast: { kind: 'error', message: 'Only 3D models can be dropped into the scene.' },
        });
        return;
      }

      const position = cursorGroundPosition(event);
      const name = asset.name.replace(/\.[^./\\]+$/, '');
      const id = store.createObjectWithProps('cube', { name, position });
      store.setObjectModel(id, assetId);
      store.selectObject(id);
      useProjectStore.setState({ toast: { kind: 'success', message: `Placed "${name}" in the scene.` } });
    },
    [cursorGroundPosition],
  );

  return (
    <section className="viewport-panel">
      <div className="viewport-topbar">
        <div className="viewport-title">
          <View size={16} aria-hidden />
          <span>Viewport</span>
        </div>
        {editingPrefabId ? (
          <span className="viewport-mode editing-prefab" title={`Editing prefab "${editingPrefabName}"`}>
            Editing Prefab: {editingPrefabName}
            <button className="prefab-done-btn" title="Save prefab & close" onClick={() => closePrefabEditor(true)}>
              Done
            </button>
          </span>
        ) : (
          <span className={isPlaying ? 'viewport-mode running' : 'viewport-mode'}>
            {isPlaying ? 'Preview Running' : 'Edit Mode'}
          </span>
        )}
        <div className="segmented labeled" aria-label="Transform mode">
          {modes.map(({ mode, label, icon: Icon }) => {
            const key = mode === 'translate' ? 'W' : mode === 'rotate' ? 'E' : 'R';
            return (
              <button
                key={mode}
                className={transformMode === mode ? 'active' : undefined}
                title={`${label} tool (${key})`}
                onClick={() => setTransformMode(mode)}
              >
                <Icon size={14} aria-hidden />
                <span>{label}</span>
                <kbd>{key}</kbd>
              </button>
            );
          })}
        </div>
        <div className="segmented" aria-label="Camera preview">
          <button
            className={previewCamera ? 'active' : undefined}
            disabled={isPlaying || !followTarget}
            title={
              followTarget
                ? previewCamera
                  ? 'Previewing the player camera — click to return to the free editor camera'
                  : 'Look through the player camera (live preview of camera offset / pitch / mode)'
                : 'No character with a follow camera in this scene'
            }
            onClick={() =>
              setPreviewCamera((on) => {
                if (!on) setCameraRigTarget(undefined); // turning preview ON: leave gizmo-positioning mode
                return !on;
              })
            }
          >
            <Camera size={14} aria-hidden />
          </button>
        </div>
        <div className="segmented" aria-label="Gizmo options">
          <button
            className={transformSpace === 'local' ? 'active' : undefined}
            title={`Coordinate space: ${transformSpace} (X to toggle)`}
            onClick={() => setTransformSpace(transformSpace === 'world' ? 'local' : 'world')}
          >
            <Globe size={14} aria-hidden />
          </button>
          <button
            className={snapEnabled ? 'active' : undefined}
            title="Snap to grid (hold Ctrl to flip while dragging)"
            onClick={() => setSnapEnabled(!snapEnabled)}
          >
            <Magnet size={14} aria-hidden />
          </button>
          {transformMode === 'rotate' ? (
            <select
              className="snap-step"
              value={angleStepDeg}
              title="Rotation snap (degrees)"
              onChange={(event) => setAngleStepDeg(Number(event.target.value))}
            >
              {SNAP_ANGLES.map((step) => (
                <option key={step} value={step}>
                  {step}°
                </option>
              ))}
            </select>
          ) : transformMode === 'scale' ? (
            <select
              className="snap-step"
              value={scaleStep}
              title="Scale snap increment"
              onChange={(event) => setScaleStep(Number(event.target.value))}
            >
              {SNAP_SCALES.map((step) => (
                <option key={step} value={step}>
                  {step}×
                </option>
              ))}
            </select>
          ) : (
            <select
              className="snap-step"
              value={snapStep}
              title="Move snap step (metres)"
              onChange={(event) => setSnapStep(Number(event.target.value))}
            >
              {SNAP_STEPS.map((step) => (
                <option key={step} value={step}>
                  {step}m
                </option>
              ))}
            </select>
          )}
          <button
            disabled={!hasSelection}
            title="Drop selection to surface below (End)"
            aria-label="Drop selection to surface"
            onClick={dropSelectionToSurface}
          >
            <ArrowDownToLine size={14} aria-hidden />
          </button>
        </div>
        <QualityControl />
      </div>
      {!editingPrefabId && (
        <button
          className={isPlaying ? 'viewport-play active' : 'viewport-play'}
          title={isPlaying ? 'Stop preview — back to Edit Mode' : 'Play preview'}
          onClick={() => setPlaying(!isPlaying)}
        >
          {isPlaying ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
          <span>{isPlaying ? 'Stop' : 'Play'}</span>
        </button>
      )}
      <div
        ref={dropZoneRef}
        className="scene-drop-zone"
        onDragOverCapture={handleDragOver}
        onDropCapture={handleDrop}
        onMouseDown={handleViewportMouseDown}
      >
        {hasWebGL ? (
          <WebGLErrorBoundary>
            <Canvas
              className="scene-canvas"
              shadows={qProfile.shadows}
              // During Play the bloom/HDR post pass is the dominant GPU cost and it scales with resolution, so
              // render Play at the quality preset's DPR; in edit mode let PerformanceMonitor adapt but never
              // exceed the preset's cap (each dpr switch reallocates framebuffers = a hitch/spike).
              dpr={isPlaying ? qProfile.dpr : Math.min(dpr, qProfile.dpr)}
              // preserveDrawingBuffer lets the cinematic exporter read finished frames off the canvas
              // (drawImage into the compositor) at any time — required for frame-locked offline export.
              gl={{ powerPreference: 'high-performance', preserveDrawingBuffer: true }}
              performance={{ min: 0.5 }}
              camera={{ position: [6, 4.2, 7], fov: 46 }}
            >
              <PerformanceMonitor
                onDecline={() => {
                  setDpr(1);
                  autoQualityStep(-1);
                }}
                onIncline={() => {
                  setDpr(1.5);
                  autoQualityStep(1);
                }}
              />
              <CompressedTextureSupport />
              <ToneMapping />
              <AudioListenerSync />
              <SkidMarks />
              <ShaderPrewarm />
              <EffectLightPool />
              <RenderStatsProbe />
              <LightBudget />
              <ShadowLOD />
              <MeshLOD />
              <SceneContent
                transformMode={transformMode}
                transformSpace={transformSpace}
                snapEnabled={snapEnabled}
                snapStep={snapStep}
                angleStepDeg={angleStepDeg}
                scaleStep={scaleStep}
                focusNonce={focusNonce}
                viewCommand={viewCommand}
                previewCamera={previewCamera}
                sceneApiRef={sceneApiRef}
                suppressDeselectRef={suppressDeselectRef}
              />
              <DropController contextRef={dropContextRef} />
            </Canvas>
          </WebGLErrorBoundary>
        ) : (
          <ViewportFallback />
        )}
        {showMouseHint && <div className="mouse-look-hint">Click to capture mouse · ESC to release</div>}
        {!isPlaying && cinematicPreview && (
          <div className="mouse-look-hint cinematic-preview-hint">Film preview {cinematicPreview.time.toFixed(2)}s</div>
        )}
        {!isPlaying && !cinematicPreview && previewCamera && followTarget && (
          <div className="mouse-look-hint">📷 Previewing “{followTarget.name}” camera — edit Side/Up/Back/Pitch/Mode in the Inspector to see it update live</div>
        )}
        {!isPlaying && !previewCamera && !cinematicPreview && (
          <div className="mouse-look-hint">LMB-drag box-select · Shift/Ctrl-click multi · RMB fly · Alt+LMB orbit · MMB pan · F focus</div>
        )}
        {/* Box-select marquee (drawn relative to the drop zone). */}
        {boxRect && dropZoneRef.current && (
          <div
            className="viewport-marquee"
            style={{
              left: Math.min(boxRect.x0, boxRect.x1) - dropZoneRef.current.getBoundingClientRect().left,
              top: Math.min(boxRect.y0, boxRect.y1) - dropZoneRef.current.getBoundingClientRect().top,
              width: Math.abs(boxRect.x1 - boxRect.x0),
              height: Math.abs(boxRect.y1 - boxRect.y0),
            }}
          />
        )}
        {/* Orientation cube + view presets (hidden during Play / camera preview). */}
        {!isPlaying && !previewCamera && !cinematicPreview && (
          <ViewCube onView={(view) => setViewCommand((command) => ({ view, nonce: command.nonce + 1 }))} />
        )}
        {/* Cinematic film look (letterbox / grade / grain) + fade — clipped to the viewport (Unreal-style
            "Game View"), not the whole window. During Play it reads the live runtime cinematic; while
            scrubbing in the editor it's driven by the preview look/fade. */}
        {isPlaying ? <CinematicOverlay /> : <CinematicOverlay look={cinematicPreviewLook} fade={cinematicPreviewFade} />}
        <ScreenUILayer />
        <DynamicCrosshair />
        <GameHud />
        <MiniMap />
        <QuickStartOverlay />
      </div>
    </section>
  );
}
