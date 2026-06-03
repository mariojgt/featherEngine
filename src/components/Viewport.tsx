import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { ContactShadows, Edges, TransformControls } from '@react-three/drei';
import { Camera, Globe, Magnet, Move3D, Rotate3D, Scaling, View } from 'lucide-react';
import { Component, Suspense, memo, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import * as THREE from 'three';
import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import { ModelAsset, useAssetTexture, useModelUrl } from '../three/ModelAsset';
import { SkinnedModel, useResolvedAnimator } from '../three/SkinnedModel';
import { FollowCamera, useFollowTarget, computeRestingCameraPose } from '../three/FollowCamera';
import { CinematicCamera } from '../three/CinematicCamera';
import { CinematicPathGizmo } from '../three/CinematicPathGizmo';
import { EditorCamera, editorNav } from '../three/EditorCamera';
import { BoneAttachment } from '../three/BoneAttachment';
import { useResolvedMaterial } from '../three/resolveMaterial';
import { assetDrag, isAssetDrag, isPrefabDrag, prefabDrag, readAssetDragId, readPrefabDragId } from './dragShared';
import { WorldUIAnchor } from '../ui/WorldUIAnchor';
import { ScreenUILayer } from '../ui/ScreenUILayer';
import { WebGLScreenUILayer } from '../ui/WebGLScreenUILayer';
import { DynamicCrosshair } from '../ui/DynamicCrosshair';
import { GameHud } from '../ui/GameHud';
import { ImpactParticles } from '../three/ImpactParticles';
import { ParticleSystem } from '../three/ParticleSystem';
import { DamageNumber } from '../three/DamageNumber';
import { ProjectileVisual } from '../three/ProjectileVisual';
import { ColliderGizmo } from '../three/ColliderGizmo';
import { PostFx } from '../three/PostFx';
import { CinematicOverlay } from './CinematicOverlay';
import { SceneEnvironment } from '../three/SceneEnvironment';
import { Terrain } from '../three/Terrain';
import { highestTerrainWorldHeight } from '../terrain/terrain';
import type { MaterialOverrides, SceneObject } from '../types';

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
  const resolvedAnimator = useResolvedAnimator(object);
  // Built-in geometries use the standard (flipped) UV convention; only load when not using a model.
  const builtinBaseTexture = useAssetTexture(usingModel ? undefined : resolved.baseColorUrl, true);
  const builtinNormalTexture = useAssetTexture(usingModel ? undefined : resolved.normalUrl, true);

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
        <pointLight color={l.color} intensity={l.intensity} distance={l.distance} decay={2} castShadow={l.castShadow} />
      ) : l?.type === 'spot' ? (
        <spotLight color={l.color} intensity={l.intensity} distance={l.distance} angle={l.angle} penumbra={0.45} decay={2} castShadow={l.castShadow} />
      ) : (
        <directionalLight color={l?.color ?? '#ffffff'} intensity={l?.intensity ?? 2.4} castShadow={l?.castShadow ?? true} position={[0, 0, 0]} />
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

// Memoized: the runtime tick produces a NEW `objects` array every frame but keeps the SAME object reference
// for anything that didn't move, so static scenery (buildings, roads, props — the bulk of a scene) bails out
// of re-rendering here. Only objects whose transform/renderer actually changed (the car + its wheels, etc.)
// re-render. The callbacks/flags it takes are all stable (useCallback / play-constant), so a shallow prop
// compare is correct. This is the single biggest Play-mode FPS win in object-heavy scenes like the city.
export const SceneObjectView = memo(function SceneObjectView({
  object,
  selected,
  registerObject,
  isGizmoEngaged,
  drawSelf = true,
  children,
}: {
  object: SceneObject;
  selected: boolean;
  registerObject: (id: string, object: THREE.Group | null) => void;
  /** True when the pointer is over (or dragging) a transform-gizmo handle — selection must yield to it. */
  isGizmoEngaged?: () => boolean;
  /** Hide the object's own mesh while still positioning it (e.g. an empty group during Play). */
  drawSelf?: boolean;
  /** Nested child objects — rendered inside this object's group so they inherit its transform. */
  children?: ReactNode;
}) {
  const selectObject = useEditorStore((state) => state.selectObject);
  const isPlaying = useEditorStore((state) => state.isPlaying);

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
      ref={(node) => registerObject(object.id, node)}
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
        selectObject(object.id);
      }}
    >
      {drawSelf && <Primitive object={object} selected={selected} />}
      {object.particles && <ParticleSystem object={object} />}
      {children}
    </group>
  );
});

type TreeRenderOpts = {
  isPlaying: boolean;
  recording: boolean;
  draggingGizmo: boolean;
  previewingCinematic: boolean;
  cinematicPreviewTransforms: Record<string, SceneObject['transform']>;
  cinematicPreviewMaterials: Record<string, MaterialOverrides>;
  selectedObjectId: string;
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
        selected={object.id === opts.selectedObjectId}
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
function CameraIndicator({ object }: { object: SceneObject }) {
  const cam = useMemo(() => new THREE.PerspectiveCamera(50, 1.5, 0.12, 2.2), []);
  const helper = useMemo(() => new THREE.CameraHelper(cam), [cam]);
  useEffect(() => {
    helper.material instanceof THREE.LineBasicMaterial && (helper.material.color = new THREE.Color('#3DDC97'));
    return () => helper.dispose();
  }, [helper]);
  useFrame(() => {
    const pose = computeRestingCameraPose(object);
    cam.fov = pose.fov;
    cam.position.copy(pose.position);
    cam.lookAt(pose.lookAt);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    helper.update();
  });
  return <primitive object={helper} />;
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
  previewCamera,
}: {
  transformMode: TransformMode;
  transformSpace: 'world' | 'local';
  snapEnabled: boolean;
  snapStep: number;
  focusNonce: number;
  previewCamera: boolean;
}) {
  const allSceneObjects = useEditorStore(selectActiveObjects);
  const sceneEnvironment = useEditorStore((state) => state.scenes.find((scene) => scene.id === state.activeSceneId)?.environment);
  const runtimeHidden = useEditorStore((state) => state.runtimeHidden);
  const selectedObjectId = useEditorStore((state) => state.selectedObjectId);
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
  const cameraRigTarget = useEditorStore((state) => state.cameraRigTarget);
  const followTarget = useFollowTarget();
  const cameraRigObject = cameraRigTarget ? sceneObjects.find((o) => o.id === cameraRigTarget && o.character) : undefined;
  // The selected character that has a follow camera — gets a live frustum indicator in edit mode.
  const selectedCameraObject = sceneObjects.find(
    (o) => o.id === selectedObjectId && o.character?.enabled && o.character.cameraFollow,
  );
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

  const syncSelectedTransform = useCallback(() => {
    const target = objectRefs.current.get(selectedObjectId);
    if (!target) return;

    updateTransform(selectedObjectId, 'position', [target.position.x, target.position.y, target.position.z]);
    updateTransform(selectedObjectId, 'rotation', [target.rotation.x, target.rotation.y, target.rotation.z]);
    updateTransform(selectedObjectId, 'scale', [target.scale.x, target.scale.y, target.scale.z]);
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
    setDraggingGizmo(true);
  }, [recording, previewingCinematic, cinematicPreviewTransforms, selectedObjectId, updateTransform]);

  // Record mode: on release, drop/refresh a transform keyframe at the playhead from the dragged pose.
  const endGizmoDrag = useCallback(() => {
    setDraggingGizmo(false);
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

  return (
    <>
      <SceneEnvironment environment={sceneEnvironment} />
      <group
        onPointerMissed={(event: MouseEvent) => {
          // While playing, clicks belong to the game, not editor selection.
          if (isPlaying) return;
          // Ignore the click that ends an Alt-orbit / right-drag navigation gesture.
          if (event.altKey || event.button !== 0) return;
          // Grabbing a gizmo handle over empty space hits no mesh and would otherwise fire here and
          // deselect the object — bail so the gizmo keeps the selection while you drag.
          if (isGizmoEngaged()) return;
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
          registerObject,
          isGizmoEngaged,
        })}
      </group>
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
      {/* Live camera frustum for the selected player — shows where its camera sits/looks and updates
          as you tune Side/Up/Back/Pitch/Mode. Hidden while playing or looking through the camera. */}
      {selectedCameraObject && !isPlaying && !previewCamera && !previewingCinematic && <CameraIndicator object={selectedCameraObject} />}
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
        <EditorCamera focusNonce={focusNonce} />
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
  const [transformSpace, setTransformSpace] = useState<'world' | 'local'>('world');
  const [snapEnabled, setSnapEnabled] = useState(false);
  const [snapStep, setSnapStep] = useState(0.5);
  const [focusNonce, setFocusNonce] = useState(0);
  const [previewCamera, setPreviewCamera] = useState(false);
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
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      switch (key) {
        case 'w':
        case 'e':
        case 'r':
          // While the right-mouse flythrough is active these drive the camera, not the gizmo.
          if (editorNav.flying) return;
          setTransformMode(key === 'w' ? 'translate' : key === 'e' ? 'rotate' : 'scale');
          break;
        case 'x':
          setTransformSpace((space) => (space === 'world' ? 'local' : 'world'));
          break;
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
            onClick={() => setTransformSpace((space) => (space === 'world' ? 'local' : 'world'))}
          >
            <Globe size={15} aria-hidden />
          </button>
          <button
            className={snapEnabled ? 'active' : undefined}
            title="Snap to grid"
            onClick={() => setSnapEnabled((on) => !on)}
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
      </div>
      <div className="scene-drop-zone" onDragOverCapture={handleDragOver} onDropCapture={handleDrop}>
        {hasWebGL ? (
          <WebGLErrorBoundary>
            <Canvas className="scene-canvas" shadows camera={{ position: [6, 4.2, 7], fov: 46 }}>
              <SceneContent
                transformMode={transformMode}
                transformSpace={transformSpace}
                snapEnabled={snapEnabled}
                snapStep={snapStep}
                focusNonce={focusNonce}
                previewCamera={previewCamera}
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
          <div className="mouse-look-hint">RMB + WASD/QE fly · Alt+LMB orbit · MMB pan · F focus · W/E/R gizmo · Ctrl+D dupe</div>
        )}
        {/* Cinematic film look (letterbox / grade / grain) + fade — clipped to the viewport (Unreal-style
            "Game View"), not the whole window. During Play it reads the live runtime cinematic; while
            scrubbing in the editor it's driven by the preview look/fade. */}
        {isPlaying ? <CinematicOverlay /> : <CinematicOverlay look={cinematicPreviewLook} fade={cinematicPreviewFade} />}
        <ScreenUILayer />
        <DynamicCrosshair />
        <GameHud />
      </div>
    </section>
  );
}
