import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { ContactShadows, Edges, PerformanceMonitor, TransformControls } from '@react-three/drei';
import { Camera, Globe, Gauge, Magnet, Move3D, Rotate3D, Scaling, View } from 'lucide-react';
import { useViewportPrefs } from '../store/viewportPrefsStore';
import { Component, Suspense, memo, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import * as THREE from 'three';
import { effectiveSelection, selectActiveObjects, useEditorStore } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import { recordRender } from '../runtime/perfStats';
import { readTransform } from '../runtime/transformBuffer';
import { ModelAsset, useAssetTexture, useModelUrl } from '../three/ModelAsset';
import { FragmentMesh } from '../three/FragmentMesh';
import { SkinnedModel, useResolvedAnimator } from '../three/SkinnedModel';
import { FollowCamera, useFollowTarget, computeRestingCameraPose, resolveCameraConfig } from '../three/FollowCamera';
import { CinematicCamera } from '../three/CinematicCamera';
import { CinematicPathGizmo } from '../three/CinematicPathGizmo';
import { EditorCamera, editorNav, type ViewPreset } from '../three/EditorCamera';
import { ViewCube } from './ViewCube';
import { BoneAttachment } from '../three/BoneAttachment';
import { useResolvedMaterial } from '../three/resolveMaterial';
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
import { PostFx } from '../three/PostFx';
import { ShadowLOD } from '../three/ShadowLOD';
import { ModelInstances } from '../three/ModelInstances';
import {
  useInstancingEnabled,
  useIsInstanced,
  computeInstanceBatches,
  batchSignature,
  InstancedIdsContext,
} from '../three/modelInstancing';
import { qualityProfile, QUALITY_LEVELS } from '../three/quality';
import { CinematicOverlay } from './CinematicOverlay';
import { SceneEnvironment } from '../three/SceneEnvironment';
import { Terrain } from '../three/Terrain';
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

function Primitive({ object, selected }: { object: SceneObject; selected: boolean }) {
  // Floating combat damage number.
  if (object.effect?.kind === 'damage') return <DamageNumber effect={object.effect} />;
  // Runtime particle burst (bullet impact, etc.) — render the points effect, nothing else.
  if (object.effect) return <ImpactParticles effect={object.effect} />;
  // Runtime projectile — glowing tracer + point light instead of a dull sphere.
  if (object.projectile) return <ProjectileVisual object={object} />;
  if (object.terrain?.enabled) return <Terrain object={object} />;
  const renderer = object.renderer;
  const baseResolved = useResolvedMaterial(renderer);
  // Interaction focus highlight (during Play) — warm emissive rim, matching the standalone player.
  const interactFocusId = useEditorStore((state) => state.runtimeInteractFocusId);
  // Combat damage reads via the floating damage number only — no emissive tint on the struck object.
  const resolved =
    interactFocusId === object.id
      ? { ...baseResolved, emissiveColor: '#ffcf66', emissiveIntensity: 0.7, overrideModel: true }
      : baseResolved;
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
  focusNonce: number;
  viewCommand: { view: ViewPreset; nonce: number };
  previewCamera: boolean;
  sceneApiRef: MutableRefObject<SceneApi | null>;
  suppressDeselectRef: MutableRefObject<boolean>;
}) {
  const allSceneObjects = useEditorStore(selectActiveObjects);
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
  // Camera-space view-models are hidden from the world viewport; select them from the Hierarchy
  // and edit their transform in the Inspector when their first-person placement needs tuning.
  const sceneObjects = allSceneObjects.filter(
    (object) =>
      !object.viewModel &&
      !((isPlaying ? runtimeHidden : cinematicPreviewHidden).includes(object.id)),
  );
  // GPU instancing for repeated static decoration models (Play-only, toggle in the F8 overlay). Batches
  // recompute structurally only — the active-scene array gets a new identity every tick, so we keep the
  // SAME batches object until the membership SIGNATURE changes (object added/removed/hidden), which stops
  // the InstancedMeshes from being torn down and rebuilt 60×/s when nothing structural moved.
  const instancingOn = useInstancingEnabled();
  const rawInstanceBatches = instancingOn && isPlaying ? computeInstanceBatches(sceneObjects) : EMPTY_BATCHES;
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
  const followTarget = useFollowTarget();
  const cameraRigObject = cameraRigTarget ? sceneObjects.find((o) => o.id === cameraRigTarget && o.character) : undefined;
  // Every object that drives a follow camera (character or vehicle) — each gets a 3D camera gizmo
  // + frustum in edit mode so you can see where the cameras are and what they frame.
  const cameraObjects = sceneObjects.filter((object) => resolveCameraConfig(object));
  // The selected physics object — gets a wireframe preview of its true collider shape.
  const selectedColliderObject = sceneObjects.find(
    (o) => o.id === selectedObjectId && o.physics?.enabled,
  );
  const objectRefs = useRef(new Map<string, THREE.Group>());
  const [selectedTarget, setSelectedTarget] = useState<THREE.Group | null>(null);
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
    };
    return () => {
      sceneApiRef.current = null;
    };
  }, [camera, gl, isGizmoEngaged, sceneApiRef]);

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
      </group>
      </InstancedIdsContext.Provider>
      {/* World-space UI widgets anchored to objects (edit + play). Use the UNFILTERED list so signs on
          invisible/empty anchors (e.g. tutorial labels) still show during Play. */}
      {allSceneObjects.map((object) => (object.ui ? <WorldUIAnchor key={`ui-${object.id}`} object={object} /> : null))}
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
          translationSnap={snapEnabled ? snapStep : null}
          rotationSnap={snapEnabled ? Math.PI / 12 : null}
          scaleSnap={snapEnabled ? 0.25 : null}
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
      {/* Film Mode: draggable spline + keyframe handles so camera/object paths are built in 3D. */}
      <CinematicPathGizmo />
      {/* Editor ground aids — hidden during Play so they don't show up (or sit at the origin over terrain) in
          the running game. */}
      {!isPlaying && <gridHelper args={[24, 24, '#30394D', '#202737']} position={[0, 0.01, 0]} />}
      {!isPlaying && <ContactShadows position={[0, -0.01, 0]} opacity={0.36} scale={14} blur={2.4} far={6} />}
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
      {/* Post-FX (bloom/vignette + cinematic grade/DoF) during Play so the editor matches the shipped
          game look — and also while scrubbing a cinematic preview so grading/focus are visible there. */}
      {(isPlaying || previewingCinematic) && <PostFx />}
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
  useFrame(() => {
    const info = gl.info;
    recordRender({
      calls: info.render.calls,
      triangles: info.render.triangles,
      programs: info.programs?.length ?? 0,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
    });
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
  useFrame(() => {
    const editorState = useEditorStore.getState();
    if (!editorState.isPlaying) {
      evaluatedCount.current = -1;
      evaluatedQuality.current = undefined;
      return;
    }
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
    casters.forEach((light, i) => {
      if (light.userData.nfWantsShadow === undefined) light.userData.nfWantsShadow = light.castShadow;
      light.castShadow = Boolean(light.userData.nfWantsShadow) && i < maxCasters;
    });
  });
  return null;
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

export function ViewportPanel() {
  const [transformMode, setTransformMode] = useState<TransformMode>('translate');
  // Snap + coordinate space persist across reloads (browser-only viewport prefs).
  const transformSpace = useViewportPrefs((state) => state.transformSpace);
  const setTransformSpace = useViewportPrefs((state) => state.setTransformSpace);
  const snapEnabled = useViewportPrefs((state) => state.snapEnabled);
  const setSnapEnabled = useViewportPrefs((state) => state.setSnapEnabled);
  const snapStep = useViewportPrefs((state) => state.snapStep);
  const setSnapStep = useViewportPrefs((state) => state.setSnapStep);
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
  const updateRenderSettings = useEditorStore((state) => state.updateRenderSettings);
  const qProfile = qualityProfile(quality);
  const followTarget = useFollowTarget();
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
      const store = useEditorStore.getState();
      if (store.isPlaying) return;
      // Don't steal keystrokes while typing in a field.
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;

      const key = event.key.toLowerCase();
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
        <div className="segmented" aria-label="Transform mode">
          {modes.map(({ mode, label, icon: Icon }) => (
            <button
              key={mode}
              className={transformMode === mode ? 'active' : undefined}
              title={`${label} (${mode === 'translate' ? 'W' : mode === 'rotate' ? 'E' : 'R'})`}
              onClick={() => setTransformMode(mode)}
            >
              <Icon size={15} aria-hidden />
            </button>
          ))}
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
            <Camera size={15} aria-hidden />
          </button>
        </div>
        <div className="segmented" aria-label="Gizmo options">
          <button
            className={transformSpace === 'local' ? 'active' : undefined}
            title={`Coordinate space: ${transformSpace} (X to toggle)`}
            onClick={() => setTransformSpace(transformSpace === 'world' ? 'local' : 'world')}
          >
            <Globe size={15} aria-hidden />
          </button>
          <button
            className={snapEnabled ? 'active' : undefined}
            title="Snap to grid"
            onClick={() => setSnapEnabled(!snapEnabled)}
          >
            <Magnet size={15} aria-hidden />
          </button>
          <select
            className="snap-step"
            value={snapStep}
            title="Snap step (units)"
            onChange={(event) => setSnapStep(Number(event.target.value))}
          >
            {SNAP_STEPS.map((step) => (
              <option key={step} value={step}>
                {step}m
              </option>
            ))}
          </select>
        </div>
        <div className="segmented" aria-label="Game quality">
          <Gauge size={15} aria-hidden style={{ marginLeft: 6, opacity: 0.8 }} />
          <select
            className="snap-step"
            value={quality ?? 'High'}
            title="Game quality (scalability) — resolution, shadows, and post-FX. Lower = faster."
            onChange={(event) => updateRenderSettings({ quality: event.target.value as (typeof QUALITY_LEVELS)[number] })}
          >
            {QUALITY_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </div>
      </div>
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
              gl={{ powerPreference: 'high-performance' }}
              performance={{ min: 0.5 }}
              camera={{ position: [6, 4.2, 7], fov: 46 }}
            >
              <PerformanceMonitor onDecline={() => setDpr(1)} onIncline={() => setDpr(1.5)} />
              <RenderStatsProbe />
              <LightBudget />
              <ShadowLOD />
              <SceneContent
                transformMode={transformMode}
                transformSpace={transformSpace}
                snapEnabled={snapEnabled}
                snapStep={snapStep}
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
      </div>
    </section>
  );
}
