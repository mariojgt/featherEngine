import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { ContactShadows, Grid, OrbitControls, TransformControls } from '@react-three/drei';
import type { TransformControls as TransformControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import {
  Box, Boxes, CircleDot, Cone, Copy, Cylinder, Donut, Eye, Focus, Globe, Grid3X3, Hammer, Hexagon, Minus, Move3d,
  PackagePlus, Paintbrush, Pill, Plus, Pyramid, RotateCcw, Square, Tent, Trash2,
} from 'lucide-react';
import type { ModelMeshGenerator, ModelMeshOp, ModelMeshOpResult, ModelModifier, ModelPart, ModelPartCollider, ModelPartShape, ModelSpec, ModelStyle, Vector3Tuple } from '../types';
import {
  BOX_CORNER_LABELS,
  BOX_EDGE_CORNERS,
  DEFAULT_MODEL_STYLE,
  MODEL_FACE_GROUPS,
  MODEL_PART_SHAPES,
  boxComponentCorners,
  boxComponentCount,
  type BoxComponentMode,
} from '../model/modelSpec';
import { buildModelGroup, faceGroupForFaceIndex, getPartRenderEdges, getPartRenderGeometry, polyFaceForTriangle } from '../model/modelGeometry';
import { meshEdgePairs, meshFaceCount, DEFAULT_MESH } from '../model/modelMesh';
import { ensurePolyMesh, meshFaces, polygonCenter, polygonNormal } from '../model/polyMesh';
import { growSelection, selectLinked, shrinkSelection, verticesToFaces } from '../model/meshOps';
import {
  EMPTY_MESH_SELECTION,
  MeshEditOverlay,
  convertSelection,
  selectAllComponents as selectAllMeshComponents,
  selectionFromResult,
  selectionVertices,
  type MeshModalKind,
  type MeshModalRequest,
  type MeshSelection,
  type MeshToolSettings,
} from './modelForgeMeshEdit';
import { ModelPartMesh } from '../three/ModelMesh';
import { RangeField } from '../components/RangeField';
import { useEditorStore } from '../store/editorStore';
import { redo as redoHistory, undo as undoHistory } from '../store/history';
import type { FeatherPluginAPI } from './types';

/**
 * Model Forge — the store-installable prototype modeler: kit-bash primitives, shape box control
 * cages at vertex/edge/face level, paint faces, place live-linked props, and bake to GLB.
 *
 * Like Arbor Forge, everything goes through the public plugin API (api.models / api.objects /
 * api.panels / api.ui) — the panel is exactly the shape an outside plugin author would ship. The
 * model DATA layer (specs, rendering, serialization, AI tools) lives in the engine, so placed props
 * keep rendering and the AI keeps working even while this plugin is not installed; the plugin is
 * the visual studio on top.
 */


const SHAPE_ICONS: Record<ModelPartShape, typeof Box> = {
  box: Box,
  cylinder: Cylinder,
  sphere: Globe,
  cone: Cone,
  wedge: Pyramid,
  torus: Donut,
  pyramid: Tent,
  hexprism: Hexagon,
  capsule: Pill,
  mesh: Boxes,
};

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;
type ForgeMode = 'build' | 'mesh' | 'paint';
type ForgeGizmoMode = 'translate' | 'rotate' | 'scale';
type ForgeView = 'perspective' | 'front' | 'right' | 'top';
const round = (value: number, decimals = 4): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

/** Matches the default editor accent; canvas shaders can't read CSS variables. */
const OUTLINE_ACCENT = '#5b8cff';

const ignoreOutlineRaycast = () => null;

/** Edge outline that hugs one part — bevel- and deformation-accurate hover/selection feedback. */
function PartOutline({ part, style, color, opacity, neutralTransform }: {
  part: ModelPart;
  style?: ModelStyle;
  color: string;
  opacity: number;
  neutralTransform?: boolean;
}) {
  return (
    <lineSegments
      geometry={getPartRenderEdges(part, style)}
      position={neutralTransform ? [0, 0, 0] : part.position}
      rotation={neutralTransform ? [0, 0, 0] : part.rotation}
      scale={neutralTransform ? [1, 1, 1] : part.scale}
      raycast={ignoreOutlineRaycast}
    >
      <lineBasicMaterial color={color} transparent opacity={opacity} toneMapped={false} />
    </lineSegments>
  );
}

const cornerBase = (index: number): THREE.Vector3 =>
  new THREE.Vector3(index & 1 ? 0.5 : -0.5, index & 2 ? 0.5 : -0.5, index & 4 ? 0.5 : -0.5);

/**
 * Edit mode's compatibility-safe box control cage. Vertex, edge, and face handles all resolve to
 * one or more of the same eight logical corners, so grouped W/E/R transforms require no new saved
 * topology and keep live-linked props, collaboration, and GLB baking on the existing data path.
 */
function ComponentHandles({
  part,
  mode,
  gizmoMode,
  snap,
  roundTo,
  selectedComponents,
  onSelectComponent,
  onCommit,
  gizmoActive,
  onGizmoStart,
  onGizmoEnd,
}: {
  part: ModelPart;
  mode: BoxComponentMode;
  gizmoMode: ForgeGizmoMode;
  snap: boolean;
  roundTo: (value: number, decimals?: number) => number;
  selectedComponents: number[];
  onSelectComponent: (index: number, additive: boolean) => void;
  onCommit: (corners: Record<number, Vector3Tuple> | null) => void;
  gizmoActive: { current: boolean };
  onGizmoStart: (commit: () => void) => void;
  onGizmoEnd: () => void;
}) {
  const controlsRef = useRef<TransformControlsImpl | null>(null);
  const { inverse, worldCorners, cagePositions } = useMemo(() => {
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(...part.position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...part.rotation)),
      new THREE.Vector3(...part.scale),
    );
    const corners = Array.from({ length: 8 }, (_, index) => {
      const local = cornerBase(index);
      const offset = part.corners?.[index];
      if (offset) local.add(new THREE.Vector3(...offset));
      return local.applyMatrix4(matrix);
    });
    const cage = new Float32Array(BOX_EDGE_CORNERS.length * 6);
    BOX_EDGE_CORNERS.forEach(([a, b], edgeIndex) => {
      const offset = edgeIndex * 6;
      cage[offset] = corners[a].x;
      cage[offset + 1] = corners[a].y;
      cage[offset + 2] = corners[a].z;
      cage[offset + 3] = corners[b].x;
      cage[offset + 4] = corners[b].y;
      cage[offset + 5] = corners[b].z;
    });
    return { inverse: matrix.clone().invert(), worldCorners: corners, cagePositions: cage };
  }, [part]);

  const componentCorners = (index: number) => boxComponentCorners(mode, index);
  const componentCenter = (index: number) => {
    const corners = componentCorners(index);
    const center = new THREE.Vector3();
    corners.forEach((corner) => center.add(worldCorners[corner]));
    return corners.length ? center.multiplyScalar(1 / corners.length) : center;
  };
  const selectedCornerIndices = useMemo(
    () => [...new Set(selectedComponents.flatMap((index) => boxComponentCorners(mode, index)))],
    [mode, selectedComponents],
  );
  const pivot = useMemo(() => {
    const center = new THREE.Vector3();
    selectedCornerIndices.forEach((index) => center.add(worldCorners[index]));
    return selectedCornerIndices.length ? center.multiplyScalar(1 / selectedCornerIndices.length) : center;
  }, [selectedCornerIndices, worldCorners]);

  const commit = () => {
    const target = (controlsRef.current as unknown as { object?: THREE.Object3D } | null)?.object;
    if (!target || !selectedCornerIndices.length) return;
    const componentMatrix = new THREE.Matrix4().compose(target.position, target.quaternion, target.scale);
    const next: Record<number, Vector3Tuple> = { ...part.corners };
    selectedCornerIndices.forEach((index) => {
      const transformedWorld = worldCorners[index].clone().sub(pivot).applyMatrix4(componentMatrix);
      const offset = transformedWorld.applyMatrix4(inverse).sub(cornerBase(index));
      const rounded: Vector3Tuple = [roundTo(offset.x, 3), roundTo(offset.y, 3), roundTo(offset.z, 3)];
      if (Math.hypot(rounded[0], rounded[1], rounded[2]) < 0.01) delete next[index];
      else next[index] = rounded;
    });
    onCommit(Object.keys(next).length ? next : null);
  };

  return (
    <>
      <lineSegments raycast={ignoreOutlineRaycast}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[cagePositions, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={OUTLINE_ACCENT} transparent opacity={0.5} toneMapped={false} />
      </lineSegments>
      {Array.from({ length: boxComponentCount(mode) }, (_, index) => {
        const center = componentCenter(index);
        const selected = selectedComponents.includes(index);
        const label = mode === 'vertex'
          ? BOX_CORNER_LABELS[index]
          : mode === 'edge'
            ? `Edge ${index + 1}`
            : MODEL_FACE_GROUPS.box[index];
        return (
          <mesh
            key={`${mode}-${index}`}
            position={[center.x, center.y, center.z]}
            scale={selected ? 1.28 : 1}
            name={label}
            onPointerDown={(event) => {
              if (event.nativeEvent.button !== 0) return;
              event.stopPropagation();
              onSelectComponent(index, event.nativeEvent.shiftKey);
            }}
            onPointerOver={(event) => {
              event.stopPropagation();
              document.body.style.cursor = 'pointer';
            }}
            onPointerOut={() => {
              document.body.style.cursor = '';
            }}
          >
            {mode === 'vertex' ? (
              <sphereGeometry args={[0.055, 14, 12]} />
            ) : mode === 'edge' ? (
              <boxGeometry args={[0.1, 0.1, 0.1]} />
            ) : (
              <octahedronGeometry args={[0.075, 0]} />
            )}
            <meshBasicMaterial color={selected ? OUTLINE_ACCENT : '#ffffff'} transparent opacity={selected ? 1 : 0.88} toneMapped={false} />
          </mesh>
        );
      })}
      {selectedCornerIndices.length > 0 && (
        <TransformControls
          key={`${mode}-${selectedComponents.join('-')}`}
          ref={controlsRef}
          mode={gizmoMode}
          size={0.72}
          translationSnap={snap ? 0.05 : null}
          rotationSnap={snap ? Math.PI / 12 : null}
          scaleSnap={snap ? 0.1 : null}
          position={[pivot.x, pivot.y, pivot.z]}
          onMouseDown={() => {
            onGizmoStart(commit);
          }}
          onMouseUp={() => {
            onGizmoEnd();
          }}
        >
          <mesh>
            <sphereGeometry args={[0.04, 12, 10]} />
            <meshBasicMaterial color={OUTLINE_ACCENT} transparent opacity={0.3} toneMapped={false} />
          </mesh>
        </TransformControls>
      )}
    </>
  );
}

/** Reset the studio camera to a comfortable framing of the current prop. */
function FitCamera({
  framing,
  nonce,
  view,
}: {
  framing: { radius: number; height: number };
  nonce: number;
  view: ForgeView;
}) {
  const { camera, controls } = useThree();
  useEffect(() => {
    const targetY = framing.height * 0.45;
    const distance = framing.radius * 2.4;
    camera.up.set(0, 1, 0);
    if (view === 'front') camera.position.set(0, targetY, distance);
    else if (view === 'right') camera.position.set(distance, targetY, 0);
    else if (view === 'top') {
      camera.position.set(0, targetY + distance, 0.001);
      camera.up.set(0, 0, -1);
    } else camera.position.set(framing.radius * 1.7, framing.height * 0.9 + 0.6, framing.radius * 1.7);
    camera.lookAt(0, targetY, 0);
    camera.updateProjectionMatrix();
    const orbit = controls as { target?: THREE.Vector3; update?: () => void } | null;
    if (orbit?.target && typeof orbit.update === 'function') {
      orbit.target.set(0, targetY, 0);
      orbit.update();
    }
  }, [nonce, view, framing.radius, framing.height, camera, controls]);
  return null;
}

interface ForgePreviewProps {
  spec: ModelSpec;
  mode: ForgeMode;
  gizmoMode: ForgeGizmoMode;
  componentMode: BoxComponentMode;
  selectedComponents: number[];
  snap: boolean;
  gridVisible: boolean;
  wireframe: boolean;
  view: ForgeView;
  selectedPartId: string;
  fitNonce: number;
  onSelectPart: (partId: string) => void;
  onSelectComponent: (index: number, additive: boolean) => void;
  onClearComponentSelection: () => void;
  onPaintFace: (partId: string, faceGroup: number) => void;
  onCommitPart: (partId: string, patch: Pick<ModelPart, 'position' | 'rotation' | 'scale'>) => void;
  onCommitCorners: (partId: string, corners: Record<number, Vector3Tuple> | null) => void;
  meshSelection: MeshSelection;
  meshSettings: MeshToolSettings;
  meshModalRequest: MeshModalRequest | null;
  hiddenPartIds: readonly string[];
  onMeshSelectionChange: (selection: MeshSelection) => void;
  onCommitMeshPositions: (partId: string, positions: Array<[number, Vector3Tuple]>) => void;
  onCommitMeshOp: (partId: string, op: ModelMeshOp) => ModelMeshOpResult;
  onMeshModalChange: (label: string | null) => void;
  onProportionalRadiusChange: (radius: number) => void;
}

/** The cage polygon a paint click landed on. Without modifiers the render triangles map straight back;
 *  with a modifier stack (mirror/subdivision) the closest cage face to the hit point wins. */
function paintedCageFace(part: ModelPart, style: ModelStyle | undefined, event: ThreeEvent<PointerEvent>): number {
  const mesh = ensurePolyMesh(part.mesh ?? DEFAULT_MESH);
  const faces = meshFaces(mesh);
  const active = part.modifiers?.some((modifier) => modifier.enabled !== false);
  if (!active && event.faceIndex != null) {
    const face = polyFaceForTriangle(getPartRenderGeometry(part, style), event.faceIndex);
    if (face >= 0) return face;
  }
  const local = event.object.worldToLocal(event.point.clone());
  let best = -1;
  let bestDistance = Infinity;
  faces.forEach((loop, index) => {
    const center = polygonCenter(mesh.vertices, loop);
    const normal = polygonNormal(mesh.vertices, loop);
    const offset = [local.x - center[0], local.y - center[1], local.z - center[2]];
    const planeDistance = Math.abs(offset[0] * normal[0] + offset[1] * normal[1] + offset[2] * normal[2]);
    const distance = Math.hypot(offset[0], offset[1], offset[2]) + planeDistance * 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
}

function ForgePreview({
  spec,
  mode,
  gizmoMode,
  componentMode,
  selectedComponents,
  snap,
  gridVisible,
  wireframe,
  view,
  selectedPartId,
  fitNonce,
  onSelectPart,
  onSelectComponent,
  onClearComponentSelection,
  onPaintFace,
  onCommitPart,
  onCommitCorners,
  meshSelection,
  meshSettings,
  meshModalRequest,
  hiddenPartIds,
  onMeshSelectionChange,
  onCommitMeshPositions,
  onCommitMeshOp,
  onMeshModalChange,
  onProportionalRadiusChange,
}: ForgePreviewProps) {
  const [meshPreviewing, setMeshPreviewing] = useState(false);
  const selectedPartForEdit = spec.parts.find((part) => part.id === selectedPartId);
  const editingMeshPart = mode === 'mesh' && selectedPartForEdit?.shape === 'mesh' ? selectedPartForEdit : null;
  const controlsRef = useRef<TransformControlsImpl | null>(null);
  const activeGizmoCommit = useRef<(() => void) | null>(null);
  // True from gizmo grab until just AFTER release: the gizmo raycasts through its own DOM
  // listeners, so r3f sees a handle grab as "missed everything" — without this guard the
  // background-click deselect fires on every gizmo interaction and unmounts the gizmo mid-use.
  const gizmoActive = useRef(false);
  // Where the pointer went down, so the deselect below can tell a click from an orbit drag.
  const pointerDownAt = useRef<{ x: number; y: number } | null>(null);
  // Frame the initial camera off the model's bounds. The Canvas is keyed by spec id, so switching
  // models reframes while edits within one model never yank the camera around.
  const framing = useMemo(() => {
    const size = new THREE.Box3().setFromObject(buildModelGroup(spec)).getSize(new THREE.Vector3());
    const radius = Math.max(1.6, Math.max(size.y, (size.x + size.z) * 0.5) * 0.85);
    return { radius, height: Math.max(1.2, size.y) };
    // Only on mount (Canvas is remounted per spec id) — see comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hover feedback. Guarded during gizmo drags: a hover re-render makes drei re-attach its
  // controls, and detach() would end the active drag (same mechanism as the commit-on-release fix).
  const [hoveredPartId, setHoveredPartId] = useState('');
  const handlePartPointerOver = (part: ModelPart, event: ThreeEvent<PointerEvent>) => {
    if (gizmoActive.current) return;
    event.stopPropagation();
    setHoveredPartId(part.id);
  };
  const handlePartPointerOut = (part: ModelPart) => {
    if (gizmoActive.current) return;
    setHoveredPartId((current) => (current === part.id ? '' : current));
  };

  const handlePartPointerDown = (part: ModelPart, event: ThreeEvent<PointerEvent>) => {
    if (event.nativeEvent.button !== 0) return;
    event.stopPropagation();
    if (mode === 'paint') {
      if (part.shape === 'mesh') {
        const face = paintedCageFace(part, spec.style, event);
        if (face >= 0) onPaintFace(part.id, face);
        return;
      }
      const faceIndex = event.faceIndex;
      if (faceIndex != null) onPaintFace(part.id, faceGroupForFaceIndex(getPartRenderGeometry(part, spec.style), faceIndex));
      return;
    }
    onSelectPart(part.id);
  };

  // Commit ONCE on release, never per move-tick. A mid-drag commit re-renders the panel, drei
  // re-attaches its controls when children re-render, and detach() nulls the active axis — which
  // silently ends the drag after its first movement tick. During the drag the gizmo moves the
  // mesh imperatively, so the preview still tracks the pointer live.
  const commitFromGizmo = () => {
    // `object` is typed private on three-stdlib's TransformControls, but it IS the attached group.
    const target = (controlsRef.current as unknown as { object?: THREE.Object3D } | null)?.object;
    if (!target || !selectedPartId) return;
    onCommitPart(selectedPartId, {
      position: [round(target.position.x), round(target.position.y), round(target.position.z)],
      rotation: [round(target.rotation.x), round(target.rotation.y), round(target.rotation.z)],
      scale: [round(Math.max(0.01, target.scale.x)), round(Math.max(0.01, target.scale.y)), round(Math.max(0.01, target.scale.z))],
    });
  };

  const beginGizmo = (commit: () => void) => {
    gizmoActive.current = true;
    activeGizmoCommit.current = commit;
  };
  const finishGizmo = () => {
    const commit = activeGizmoCommit.current;
    if (!commit) return;
    activeGizmoCommit.current = null;
    commit();
    // The DOM click that ends the interaction fires after pointerup — keep the guard through it.
    setTimeout(() => {
      gizmoActive.current = false;
    }, 0);
  };

  // Drei normally emits mouseUp from TransformControls, but pointer capture can be lost when a
  // fast drag ends over an overlay or outside the handle. A window release fallback guarantees the
  // same single commit and prevents a gizmo from remaining latched.
  useEffect(() => {
    const release = () => finishGizmo();
    window.addEventListener('pointerup', release);
    window.addEventListener('mouseup', release);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('mouseup', release);
    };
  });

  return (
    <Canvas
      tabIndex={0}
      shadows
      dpr={[1, 1.75]}
      camera={{ position: [framing.radius * 1.7, framing.height * 0.9 + 0.6, framing.radius * 1.7], fov: 42 }}
      onCreated={({ scene, gl }) => {
        scene.background = new THREE.Color('#141820');
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
      }}
      onPointerDown={(event) => {
        pointerDownAt.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerMissed={(event) => {
        if (mode === 'paint' || gizmoActive.current) return;
        // Orbiting also ends in a "missed" click — only a true stationary click deselects.
        const down = pointerDownAt.current;
        if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) return;
        if (mode === 'mesh') {
          onClearComponentSelection();
          return;
        }
        onSelectPart('');
      }}
      style={{ cursor: mode === 'paint' ? 'crosshair' : hoveredPartId ? 'pointer' : 'grab' }}
    >
      <FitCamera framing={framing} nonce={fitNonce} view={view} />
      <color attach="background" args={['#141820']} />
      <hemisphereLight args={['#e8f0ff', '#2a2f38', 0.85]} />
      <directionalLight position={[5, 10, 4]} intensity={1.55} castShadow shadow-mapSize={[1024, 1024]} />
      <directionalLight position={[-4, 3, -5]} intensity={0.45} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <circleGeometry args={[8, 48]} />
        <meshStandardMaterial color="#1a1f28" roughness={0.92} metalness={0.05} />
      </mesh>
      {/* Spline-style ground: a distance-faded grid plus a soft blurred contact shadow. */}
      {gridVisible && (
        <Grid
          position={[0, 0.001, 0]}
          args={[12, 12]}
          cellSize={0.25}
          cellThickness={0.55}
          cellColor="#2a3344"
          sectionSize={1}
          sectionThickness={1.1}
          sectionColor="#3a4660"
          fadeDistance={22}
          fadeStrength={1.35}
          infiniteGrid
        />
      )}
      <ContactShadows position={[0, 0.006, 0]} opacity={0.48} scale={14} blur={2.4} far={8} resolution={512} />
      {spec.parts.filter((part) => !hiddenPartIds.includes(part.id)).map((part) =>
        editingMeshPart && part.id === editingMeshPart.id ? (
          // Edit mode owns this part's clicks (the overlay's pick surface); hide it while a modal previews.
          meshPreviewing ? null : <ModelPartMesh key={part.id} part={part} palette={spec.palette} style={spec.style} />
        ) : mode === 'build' && part.id === selectedPartId ? (
          <TransformControls
            key={part.id}
            ref={controlsRef}
            mode={gizmoMode}
            size={0.9}
            translationSnap={snap ? 0.25 : null}
            rotationSnap={snap ? Math.PI / 12 : null}
            scaleSnap={snap ? 0.1 : null}
            position={part.position}
            rotation={part.rotation}
            scale={part.scale}
            onMouseDown={() => beginGizmo(commitFromGizmo)}
            onMouseUp={finishGizmo}
          >
            {/* drei types children as ONE element; the identity group also keeps controls attachment stable. */}
            <group>
              <ModelPartMesh
                part={part}
                palette={spec.palette}
                style={spec.style}
                neutralTransform
                onPartPointerDown={handlePartPointerDown}
                onPartPointerOver={handlePartPointerOver}
                onPartPointerOut={handlePartPointerOut}
              />
              <PartOutline part={part} style={spec.style} color={OUTLINE_ACCENT} opacity={0.95} neutralTransform />
            </group>
          </TransformControls>
        ) : (
          <ModelPartMesh
            key={part.id}
            part={part}
            palette={spec.palette}
            style={spec.style}
            onPartPointerDown={handlePartPointerDown}
            onPartPointerOver={handlePartPointerOver}
            onPartPointerOut={handlePartPointerOut}
          />
        ),
      )}
      {mode !== 'build' && selectedPartId && (() => {
        const selected = spec.parts.find((part) => part.id === selectedPartId);
        return selected ? <PartOutline part={selected} style={spec.style} color={OUTLINE_ACCENT} opacity={0.55} /> : null;
      })()}
      {mode === 'mesh' && (() => {
        const selected = spec.parts.find((part) => part.id === selectedPartId);
        if (!selected || (selected.shape !== 'box' && selected.shape !== 'mesh')) return null;
        if (selected.shape === 'box') {
          return (
            <ComponentHandles
              part={selected}
              mode={componentMode}
              gizmoMode={gizmoMode}
              snap={snap}
              roundTo={round}
              selectedComponents={selectedComponents}
              onSelectComponent={onSelectComponent}
              onCommit={(corners) => onCommitCorners(selected.id, corners)}
              gizmoActive={gizmoActive}
              onGizmoStart={beginGizmo}
              onGizmoEnd={finishGizmo}
            />
          );
        }
        return (
          <MeshEditOverlay
            part={selected}
            palette={spec.palette}
            style={spec.style}
            mode={componentMode}
            selection={meshSelection}
            settings={meshSettings}
            gizmoMode={gizmoMode}
            modalRequest={meshModalRequest}
            onSelectionChange={onMeshSelectionChange}
            onCommitPositions={(positions) => onCommitMeshPositions(selected.id, positions)}
            onCommitOp={(op) => onCommitMeshOp(selected.id, op)}
            onModalChange={onMeshModalChange}
            onPreviewChange={setMeshPreviewing}
            onProportionalRadiusChange={onProportionalRadiusChange}
            gizmoActive={gizmoActive}
            onGizmoStart={beginGizmo}
            onGizmoEnd={finishGizmo}
          />
        );
      })()}
      {wireframe && spec.parts.map((part) => (
        <PartOutline key={`wire-${part.id}`} part={part} style={spec.style} color="#9eb6d8" opacity={0.22} />
      ))}
      {hoveredPartId && hoveredPartId !== selectedPartId && (() => {
        const hovered = spec.parts.find((part) => part.id === hoveredPartId);
        return hovered ? <PartOutline part={hovered} style={spec.style} color="#ffffff" opacity={0.35} /> : null;
      })()}
      {/* makeDefault lets the gizmo auto-pause orbiting while a handle is dragged; damping = the glide. */}
      <OrbitControls makeDefault enablePan enableDamping dampingFactor={0.08} target={[0, framing.height * 0.45, 0]} />
    </Canvas>
  );
}

function VecField({ label, value, step = 0.1, toDisplay = (v: number) => v, fromDisplay = (v: number) => v, onChange }: {
  label: string;
  value: Vector3Tuple;
  step?: number;
  toDisplay?: (value: number) => number;
  fromDisplay?: (value: number) => number;
  onChange: (next: Vector3Tuple) => void;
}) {
  return (
    <label className="node-field model-vec-field">
      <span>{label}</span>
      <div className="model-vec-inputs">
        {([0, 1, 2] as const).map((axis) => (
          <input
            key={axis}
            type="number"
            aria-label={`${label} ${['X', 'Y', 'Z'][axis]}`}
            step={step}
            value={round(toDisplay(value[axis]), 3)}
            onChange={(event) => {
              const parsed = Number(event.target.value);
              if (!Number.isFinite(parsed)) return;
              const next = [...value] as Vector3Tuple;
              next[axis] = fromDisplay(parsed);
              onChange(next);
            }}
          />
        ))}
      </div>
    </label>
  );
}

function PaletteStrip({ palette, activeSlot, onPick }: { palette: readonly string[]; activeSlot: number; onPick: (slot: number) => void }) {
  return (
    <div className="model-palette-strip" role="listbox" aria-label="Palette">
      {palette.map((color, slot) => (
        <button
          key={slot}
          type="button"
          role="option"
          aria-selected={slot === activeSlot}
          aria-label={`Palette slot ${slot}, ${color}`}
          className={`model-swatch${slot === activeSlot ? ' active' : ''}`}
          style={{ background: color }}
          title={`Slot ${slot} · ${color}`}
          onClick={() => onPick(slot)}
        />
      ))}
    </div>
  );
}

/** One-click clean-topology meshes for the Add menu: quad primitives, lathe profiles and tube sweeps. */
const MESH_PRESETS: ReadonlyArray<{ id: string; label: string; generator: ModelMeshGenerator; scale?: Vector3Tuple }> = [
  { id: 'quad-cube', label: 'Cube (2×2 quads)', generator: { kind: 'cube', segments: 2 } },
  { id: 'grid', label: 'Grid plane', generator: { kind: 'plane', segmentsX: 4, segmentsZ: 4 }, scale: [2, 1, 2] },
  { id: 'cylinder', label: 'Cylinder (12)', generator: { kind: 'cylinder', sides: 12 } },
  { id: 'sphere', label: 'UV sphere', generator: { kind: 'sphere', segments: 16, rings: 8 } },
  { id: 'torus', label: 'Torus', generator: { kind: 'torus', majorSegments: 24, minorSegments: 10, minorRatio: 0.3 } },
  { id: 'vase', label: 'Vase (lathe)', generator: { kind: 'lathe', segments: 20, profile: [[0, -0.5], [0.22, -0.48], [0.38, -0.3], [0.42, -0.05], [0.24, 0.25], [0.16, 0.4], [0.22, 0.5]] } },
  { id: 'bottle', label: 'Bottle (lathe)', generator: { kind: 'lathe', segments: 18, profile: [[0, -0.5], [0.3, -0.5], [0.32, 0.05], [0.12, 0.28], [0.1, 0.5], [0, 0.5]] } },
  { id: 'column', label: 'Column (lathe)', generator: { kind: 'lathe', segments: 16, profile: [[0, -0.5], [0.45, -0.5], [0.45, -0.42], [0.32, -0.36], [0.28, 0.36], [0.4, 0.42], [0.4, 0.5], [0, 0.5]] }, scale: [0.8, 2.4, 0.8] },
  { id: 'bowl', label: 'Bowl (lathe)', generator: { kind: 'lathe', segments: 24, profile: [[0, -0.2], [0.25, -0.2], [0.45, 0], [0.5, 0.2], [0.44, 0.2], [0.38, 0.02], [0.2, -0.12], [0, -0.12]] } },
  { id: 'handle', label: 'Handle (tube)', generator: { kind: 'tube', radius: 0.06, sides: 10, path: [[-0.4, 0, 0], [-0.4, 0.3, 0], [-0.25, 0.45, 0], [0.25, 0.45, 0], [0.4, 0.3, 0], [0.4, 0, 0]] } },
  { id: 'elbow', label: 'Pipe elbow (tube)', generator: { kind: 'tube', radius: 0.12, sides: 12, path: [[0, -0.5, 0], [0, 0, 0], [0.08, 0.22, 0], [0.28, 0.38, 0], [0.5, 0.4, 0]] } },
];

export function ModelForgePanel({ api }: { api: FeatherPluginAPI }) {
  const studioRef = useRef<HTMLElement | null>(null);
  // The plugin sees the library through detached api snapshots; models:changed says when to
  // re-read (edits from this panel, the AI tools, and undo all funnel through the same event).
  const [library, setLibrary] = useState<ReadonlyArray<Readonly<ModelSpec>>>(() => api.models.library());
  const [placedRefresh, setPlacedRefresh] = useState(0);
  useEffect(() => api.events.on('models:changed', () => setLibrary(api.models.library())), [api]);
  useEffect(() => api.events.on('scene:changed', () => setPlacedRefresh((tick) => tick + 1)), [api]);

  const activeModelSpecId = useEditorStore((state) => state.activeModelSpecId);
  const [selectedSpecId, setSelectedSpecId] = useState(() => useEditorStore.getState().activeModelSpecId || '');
  const [mode, setMode] = useState<ForgeMode>('build');
  const [gizmoMode, setGizmoMode] = useState<ForgeGizmoMode>('translate');
  const [componentMode, setComponentMode] = useState<BoxComponentMode>('vertex');
  const [selectedComponents, setSelectedComponents] = useState<number[]>([]);
  const [snap, setSnap] = useState(true);
  const [gridVisible, setGridVisible] = useState(true);
  const [wireframe, setWireframe] = useState(false);
  const [view, setView] = useState<ForgeView>('perspective');
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [starterQuery, setStarterQuery] = useState('');
  const [selectedPartId, setSelectedPartId] = useState('');
  const [activeSlot, setActiveSlot] = useState(1);
  const [baking, setBaking] = useState(false);
  const [fitNonce, setFitNonce] = useState(0);
  const [status, setStatus] = useState('Start in Object mode, then use Edit for the box control cage or Paint for faces.');
  const [meshSelection, setMeshSelection] = useState<MeshSelection>(EMPTY_MESH_SELECTION);
  const [meshTools, setMeshTools] = useState<Omit<MeshToolSettings, 'snap'>>({
    proportional: false,
    proportionalRadius: 0.5,
    falloff: 'smooth',
    symmetry: [],
    xray: false,
  });
  const meshSettings = useMemo<MeshToolSettings>(() => ({ ...meshTools, snap }), [meshTools, snap]);
  const [meshModalRequest, setMeshModalRequest] = useState<MeshModalRequest | null>(null);
  const [meshModalLabel, setMeshModalLabel] = useState<string | null>(null);
  const [hiddenPartIds, setHiddenPartIds] = useState<string[]>([]);
  const materials = useEditorStore((state) => state.materials);
  const glbInputRef = useRef<HTMLInputElement | null>(null);
  const [bakeOptions, setBakeOptions] = useState({ ao: true, normal: false, size: 512 });

  const spec = library.find((entry) => entry.id === selectedSpecId) ?? library[0];
  const placedCount = useMemo(
    () => (spec ? api.objects.list().filter((object) => object.model?.specId === spec.id).length : 0),
    // placedRefresh re-counts after scene changes (placing, deleting, undo).
    [api, spec, placedRefresh],
  );
  const filteredStarters = useMemo(() => {
    const query = starterQuery.trim().toLowerCase();
    return api.models.starters().filter((starter) =>
      !query || starter.name.toLowerCase().includes(query) || starter.tagline.toLowerCase().includes(query),
    );
  }, [api, starterQuery]);

  const selectSpec = (specId: string) => {
    setSelectedSpecId(specId);
    setSelectedPartId('');
    setSelectedComponents([]);
    useEditorStore.getState().setActiveModelSpec(specId);
  };

  // Opening the already-mounted studio from another prop must follow the asset selected elsewhere.
  useEffect(() => {
    if (!activeModelSpecId || activeModelSpecId === selectedSpecId) return;
    if (library.some((entry) => entry.id === activeModelSpecId)) {
      setSelectedSpecId(activeModelSpecId);
      setSelectedPartId('');
      setSelectedComponents([]);
    }
  }, [activeModelSpecId, library, selectedSpecId]);

  /** Every mutation funnels through here so a Play-mode or no-project error reads in the panel, not the console. */
  const attempt = (label: string, action: () => string) => {
    try {
      setStatus(action());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message);
      api.ui.notify(`${label}: ${message}`, 'error');
    }
  };

  // Edit mode needs an active cage. Object mode deliberately permits an empty selection, matching
  // the viewport and making a stationary background click a reliable deselect gesture.
  useEffect(() => {
    if (mode !== 'mesh' || !spec) return;
    if (selectedPartId && spec.parts.some((part) => part.id === selectedPartId)) return;
    if (spec.parts[0]) setSelectedPartId(spec.parts[0].id);
  }, [mode, spec, selectedPartId]);

  useEffect(() => {
    setSelectedComponents([]);
  }, [selectedPartId, mode, componentMode]);

  // Mesh selections survive component-mode switches (Blender converts them); a new part or mode clears.
  useEffect(() => {
    setMeshSelection(EMPTY_MESH_SELECTION);
  }, [selectedPartId, mode, selectedSpecId]);
  const previousComponentMode = useRef(componentMode);
  useEffect(() => {
    const from = previousComponentMode.current;
    previousComponentMode.current = componentMode;
    if (from === componentMode) return;
    const part = spec?.parts.find((entry) => entry.id === selectedPartId);
    if (part?.shape !== 'mesh' || !part.mesh) return;
    const mesh = ensurePolyMesh(part.mesh);
    setMeshSelection((current) => convertSelection(mesh, from, componentMode, current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [componentMode]);

  if (!spec) {
    return (
      <section className="panel material-panel">
        <div className="empty-state wide">
          <Box size={18} aria-hidden />
          <span>No model assets yet</span>
          <button
            className="full-button"
            onClick={() => attempt('Create model', () => {
              selectSpec(api.models.createFromStarter('crate'));
              return 'Created a Wooden Crate to start from.';
            })}
          >
            Create Model
          </button>
        </div>
      </section>
    );
  }

  const selectedPart = spec.parts.find((part) => part.id === selectedPartId);
  const clampedActiveSlot = Math.min(activeSlot, spec.palette.length - 1);
  const shapeFaceGroups = selectedPart ? MODEL_FACE_GROUPS[selectedPart.shape] : {};
  const componentPlural = componentMode === 'vertex' ? 'vertices' : `${componentMode}s`;

  const addPart = (shape: ModelPartShape) =>
    attempt('Add part', () => {
      const beside = spec.parts.find((part) => part.id === selectedPartId);
      const position: Vector3Tuple = beside
        ? [beside.position[0] + Math.max(beside.scale[0], 0.6), beside.position[1], beside.position[2]]
        : [0, 0.5, 0];
      const partId = api.models.addPart(spec.id, shape, { colorSlot: clampedActiveSlot, position });
      setSelectedPartId(partId);
      setSelectedComponents([]);
      setMode('build');
      setAddMenuOpen(false);
      return `Added a ${shape} beside the selection.`;
    });

  const placeInScene = () =>
    attempt('Place model', () => {
      const objectId = api.models.place(spec.id);
      api.objects.select(objectId);
      return `Placed "${spec.name}" in the scene — it stays linked, so edits here restyle it live.`;
    });

  const bakeToAsset = async () => {
    setBaking(true);
    try {
      const { fileName } = await api.models.bakeToAsset(spec.id);
      const message = `Baked "${spec.name}" to ${fileName} — it is in the Assets panel now.`;
      setStatus(message);
      api.ui.notify(message);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Bake failed: ${message}`);
      api.ui.notify(`Bake failed: ${message}`, 'error');
    } finally {
      setBaking(false);
    }
  };

  const styleOf = (entry: ModelSpec): ModelStyle => entry.style ?? DEFAULT_MODEL_STYLE;
  const patchStyle = (patch: Partial<ModelStyle>) =>
    attempt('Restyle model', () => {
      api.models.updateSpec(spec.id, { style: { ...styleOf(spec), ...patch } });
      return patch.finish
        ? patch.finish === 'smooth'
          ? 'Smooth finish: rounded corners + satin shading, Spline-style.'
          : 'Flat finish: crisp faceted edges, Meshy-style.'
        : status;
    });

  const paintFace = (partId: string, faceGroup: number) => {
    if (spec.parts.find((part) => part.id === partId)?.shape === 'mesh') {
      // Mesh parts paint per POLYGON (faceGroup is the cage face index here).
      setSelectedPartId(partId);
      runMeshOp('Paint face', { type: 'paintFaces', faces: [faceGroup], slot: clampedActiveSlot }, partId);
      return;
    }
    attempt('Paint face', () => {
      api.models.paintPart(spec.id, partId, clampedActiveSlot, faceGroup);
      setSelectedPartId(partId);
      return `Painted ${MODEL_FACE_GROUPS[spec.parts.find((part) => part.id === partId)?.shape ?? 'box'][faceGroup] ?? 'face'} with slot ${clampedActiveSlot}.`;
    });
  };

  const editPaletteColor = (slot: number, color: string) =>
    attempt('Edit palette', () => {
      const palette = [...spec.palette];
      palette[slot] = color;
      api.models.setPalette(spec.id, palette);
      return status;
    });

  const selectComponent = (index: number, additive: boolean) => {
    setSelectedComponents((current) => {
      if (!additive) return [index];
      return current.includes(index) ? current.filter((entry) => entry !== index) : [...current, index];
    });
  };

  const selectAllComponents = () => {
    if (!selectedPart) return;
    if (selectedPart.shape === 'mesh') {
      if (componentMode === 'vertex') setSelectedComponents(selectedPart.mesh!.vertices.map((_, index) => index));
      else if (componentMode === 'edge') setSelectedComponents(meshEdgePairs(selectedPart.mesh!).map((_, index) => index));
      else setSelectedComponents(Array.from({ length: Math.floor((selectedPart.mesh?.indices.length ?? 0) / 3) }, (_, index) => index));
      return;
    }
    setSelectedComponents(Array.from({ length: boxComponentCount(componentMode) }, (_, index) => index));
  };

  const resetSelectedComponents = () => {
    if (!selectedPart || !selectedComponents.length) return;
    if (selectedPart.shape === 'mesh') {
      // Mesh vertices can't be cheaply "reset" to a parametric shape — this button maps to the
      // canonical cube only when the mesh still has 8 vertices (i.e. an untouched default box).
      const count = selectedPart.mesh?.vertices.length ?? 0;
      const canReset = count === DEFAULT_MESH.vertices.length;
      attempt('Reset mesh', () => {
        if (!canReset) return 'This mesh has been edited — its vertices aren\'t parametric, so there is nothing to reset to. Use Extrude/Subdivide to shape it.';
        api.models.setPartMeshVertices(spec.id, selectedPart.id, DEFAULT_MESH.vertices.map((vertex, index) => [index, [...vertex] as Vector3Tuple]));
        setSelectedComponents([]);
        return `Reset "${selectedPart.name}" back to a pristine cube.`;
      });
      return;
    }
    if (selectedPart.shape !== 'box') return;
    const selectedCorners = new Set(selectedComponents.flatMap((index) => boxComponentCorners(componentMode, index)));
    attempt('Reset control points', () => {
      const next = { ...selectedPart.corners };
      selectedCorners.forEach((index) => delete next[index]);
      api.models.setPartCorners(spec.id, selectedPart.id, Object.keys(next).length ? next : null);
      return `Reset ${selectedCorners.size} control point${selectedCorners.size === 1 ? '' : 's'} on "${selectedPart.name}".`;
    });
  };

  const convertSelectedToMesh = () => {
    if (!selectedPart) return;
    attempt('Convert to mesh', () => {
      if (!api.models.convertPartToMesh(spec.id, selectedPart.id)) return 'Could not convert this part to a mesh.';
      return `Baked "${selectedPart.name}" into a real editable mesh — its exact surface is now draggable and booleans/extrudes apply.`;
    });
  };

  const meshPart = mode === 'mesh' && selectedPart?.shape === 'mesh' && selectedPart.mesh ? selectedPart : null;
  const meshCage = meshPart ? ensurePolyMesh(meshPart.mesh!) : null;
  const meshSelectedVerts = meshCage ? selectionVertices(meshCage, componentMode, meshSelection) : [];
  const meshSelectionCount = componentMode === 'vertex'
    ? meshSelection.vertices.length
    : componentMode === 'edge' ? meshSelection.edges.length : meshSelection.faces.length;

  /** One mesh op through the plugin API (one undo step); the selection follows Blender's rules. */
  const runMeshOp = (label: string, op: ModelMeshOp, partId = selectedPart?.id): ModelMeshOpResult => {
    let outcome: ModelMeshOpResult = { ok: false };
    if (!partId) return outcome;
    attempt(label, () => {
      outcome = api.models.meshOp(spec.id, partId, op);
      const updated = api.models.library().find((entry) => entry.id === spec.id)?.parts.find((part) => part.id === partId);
      if (updated?.mesh) {
        const mesh = ensurePolyMesh(updated.mesh as ModelPart['mesh'] & object);
        setMeshSelection(outcome.ok ? selectionFromResult(mesh, componentMode, outcome) : meshSelection);
      }
      if (!outcome.ok) return outcome.message ?? `${label} needs a valid selection.`;
      const after = updated?.mesh ? `${updated.mesh.vertices.length} verts · ${meshFaceCount(updated.mesh as ModelPart['mesh'] & object)} faces` : '';
      return `${label} done${after ? ` — ${after}` : ''}.${outcome.message ? ` ${outcome.message}` : ''}`;
    });
    return outcome;
  };

  const meshSelectedEdges = (): Array<[number, number]> => {
    if (!meshCage) return [];
    if (componentMode === 'edge') return meshSelection.edges;
    const verts = new Set(meshSelectedVerts);
    return convertSelection(meshCage, 'vertex', 'edge', { ...EMPTY_MESH_SELECTION, vertices: [...verts] }).edges;
  };
  const meshSelectedFaces = (): number[] => {
    if (!meshCage) return [];
    if (componentMode === 'face') return meshSelection.faces;
    return convertSelection(meshCage, 'vertex', 'face', { ...EMPTY_MESH_SELECTION, vertices: meshSelectedVerts }).faces;
  };

  const meshAction = (action: string) => {
    if (!meshPart || !meshCage) return;
    switch (action) {
      case 'extrude': runMeshOp('Extrude', { type: 'extrude', faces: meshSelectedFaces(), distance: 0.2 / Math.max(0.01, meshPart.scale[1]) }); break;
      case 'inset': runMeshOp('Inset', { type: 'inset', faces: meshSelectedFaces(), thickness: 0.06 }); break;
      case 'bevel': runMeshOp('Bevel', { type: 'bevel', edges: meshSelectedEdges(), width: 0.04, segments: 2 }); break;
      case 'loopcut': {
        const edge = meshSelectedEdges()[0];
        if (!edge) {
          setStatus('Loop Cut: hover the mesh and press Ctrl+R, or select one edge first.');
          return;
        }
        runMeshOp('Loop cut', { type: 'loopCut', edge, cuts: 1 });
        break;
      }
      case 'subdivide': runMeshOp('Subdivide', { type: 'subdivide', faces: meshSelectedFaces(), cuts: 1 }); break;
      case 'merge': runMeshOp('Merge', { type: 'merge', vertices: meshSelectedVerts, mode: 'center' }); break;
      case 'fill': runMeshOp('Fill', { type: 'fill', vertices: meshSelectedVerts }); break;
      case 'delete':
        if (componentMode === 'face') runMeshOp('Delete faces', { type: 'delete', faces: meshSelection.faces });
        else if (componentMode === 'edge') runMeshOp('Dissolve edges', { type: 'dissolveEdges', edges: meshSelection.edges });
        else runMeshOp('Delete vertices', { type: 'delete', vertices: meshSelection.vertices });
        break;
      case 'dissolve': runMeshOp('Dissolve edges', { type: 'dissolveEdges', edges: meshSelectedEdges() }); break;
      case 'flip': runMeshOp('Flip normals', { type: 'flip', faces: meshSelectedFaces() }); break;
      case 'recalc': runMeshOp('Recalculate normals', { type: 'recalculateNormals' }); break;
      case 'sharp': runMeshOp('Mark sharp', { type: 'markSharp', edges: meshSelectedEdges(), sharp: true }); break;
      case 'unsharp': runMeshOp('Clear sharp', { type: 'markSharp', edges: meshSelectedEdges(), sharp: false }); break;
      case 'weld': runMeshOp('Merge by distance', { type: 'weld', distance: 0.001 }); break;
      case 'all': setMeshSelection(selectAllMeshComponents(meshCage, componentMode)); break;
      case 'none': setMeshSelection(EMPTY_MESH_SELECTION); break;
      case 'invert': {
        const all = selectAllMeshComponents(meshCage, componentMode);
        const key = (edge: [number, number]) => `${edge[0]}:${edge[1]}`;
        const edgeKeys = new Set(meshSelection.edges.map(key));
        setMeshSelection({
          vertices: all.vertices.filter((index) => !meshSelection.vertices.includes(index)),
          edges: all.edges.filter((edge) => !edgeKeys.has(key(edge))),
          faces: all.faces.filter((index) => !meshSelection.faces.includes(index)),
        });
        break;
      }
      case 'linked': {
        const faces = selectLinked(meshCage, meshSelectedFaces().length ? meshSelectedFaces() : verticesToFaces(meshCage, meshSelectedVerts, false));
        setMeshSelection(convertSelection(meshCage, 'face', componentMode, { ...EMPTY_MESH_SELECTION, faces }));
        break;
      }
      case 'grow':
      case 'shrink': {
        const verts = action === 'grow' ? growSelection(meshCage, meshSelectedVerts) : shrinkSelection(meshCage, meshSelectedVerts);
        setMeshSelection(convertSelection(meshCage, 'vertex', componentMode, { ...EMPTY_MESH_SELECTION, vertices: verts }));
        break;
      }
      default:
        break;
    }
  };

  const startMeshModal = (kind: MeshModalKind) => {
    if (!meshPart) return;
    if (kind !== 'loopcut' && kind !== 'box' && kind !== 'knife' && !meshSelectedVerts.length) {
      setStatus('Select some geometry first (A selects everything).');
      return;
    }
    if ((kind === 'extrude' || kind === 'inset') && componentMode !== 'face') {
      setStatus(`${kind === 'extrude' ? 'Extrude' : 'Inset'} works on faces — press 3 for face select.`);
      return;
    }
    setMeshModalRequest({ kind, nonce: Date.now() });
  };

  const patchPart = (label: string, patch: Partial<Omit<ModelPart, 'id'>>, message?: string) =>
    attempt(label, () => {
      api.models.updatePart(spec.id, selectedPart!.id, patch);
      return message ?? status;
    });

  const addMeshPart = (generator: ModelMeshGenerator, name: string, scale: Vector3Tuple = [1, 1, 1]) =>
    attempt('Add mesh', () => {
      const position: Vector3Tuple = [0, scale[1] / 2, 0];
      const partId = api.models.addMeshPart(spec.id, generator, { name, colorSlot: clampedActiveSlot, position, scale });
      setSelectedPartId(partId);
      setAddMenuOpen(false);
      return `Added ${name} — a clean quad mesh. Tab into Edit mode to shape it.`;
    });

  const bakeTextures = async () => {
    if (!selectedPart) return;
    setBaking(true);
    setStatus('Baking textures… (a 512px bake takes a second or two)');
    // Let the status paint before the CPU-bound bake starts.
    await new Promise((resolve) => setTimeout(resolve, 30));
    try {
      const result = await api.models.bakePartTextures(spec.id, selectedPart.id, bakeOptions);
      setStatus(result.message);
      api.ui.notify(result.message, result.ok ? undefined : 'error');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Bake failed: ${message}`);
      api.ui.notify(`Bake failed: ${message}`, 'error');
    } finally {
      setBaking(false);
    }
  };

  const importGlb = async (file: File) => {
    try {
      const { specId, warnings } = await api.models.importGlb(file);
      selectSpec(specId);
      const message = `Imported ${file.name} as an editable model${warnings.length ? ` (${warnings.length} warning${warnings.length === 1 ? '' : 's'}: ${warnings[0]})` : ''}.`;
      setStatus(message);
      api.ui.notify(message);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Import failed: ${message}`);
      api.ui.notify(`Import failed: ${message}`, 'error');
    }
  };

  const booleanWithOpposite = (operation: 'union' | 'difference' | 'intersect') => {
    if (!selectedPart || spec.parts.length < 2) return;
    const other = spec.parts.find((part) => part.id !== selectedPart.id);
    if (!other) return;
    attempt('Boolean parts', () => {
      const ok = api.models.booleanParts(spec.id, selectedPart.id, other.id, operation);
      if (!ok) return 'Boolean failed — the parts may not overlap, or the result was empty.';
      setMode('build');
      return `${operation.charAt(0).toUpperCase() + operation.slice(1)} of "${selectedPart.name}" and "${other.name}" — result kept on "${selectedPart.name}".`;
    });
  };

  /** Blender's edit-mesh keymap, active while editing a mesh part. Returns true when it consumed the key. */
  const handleMeshKey = (event: ReactKeyboardEvent<HTMLElement>): boolean => {
    if (!meshPart || meshModalLabel) return false;
    const key = event.key.toLowerCase();
    const ctrl = event.ctrlKey || event.metaKey;
    if (ctrl && key === 'b') startMeshModal('bevel');
    else if (ctrl && key === 'r') startMeshModal('loopcut');
    else if (ctrl && key === 'i') meshAction('invert');
    else if (ctrl && key === 'l') meshAction('linked');
    else if (ctrl && (key === '=' || key === '+')) meshAction('grow');
    else if (ctrl && key === '-') meshAction('shrink');
    else if (ctrl) return false;
    else if (event.altKey && key === 'a') meshAction('none');
    else if (event.altKey && key === 'z') setMeshTools((tools) => ({ ...tools, xray: !tools.xray }));
    else if (event.altKey) return false;
    else if (event.shiftKey && key === 'n') meshAction('recalc');
    else if (key === 'b') startMeshModal('box');
    else if (key === 'k') startMeshModal('knife');
    else if (key === 'g') startMeshModal('grab');
    else if (key === 'r') startMeshModal('rotate');
    else if (key === 's') startMeshModal('scale');
    else if (key === 'e') startMeshModal('extrude');
    else if (key === 'i') startMeshModal('inset');
    else if (key === 'x' || key === 'delete' || key === 'backspace') meshAction('delete');
    else if (key === 'm') meshAction('merge');
    else if (key === 'f' && meshSelectedVerts.length) meshAction('fill');
    else if (key === 'o') setMeshTools((tools) => ({ ...tools, proportional: !tools.proportional }));
    else if (key === 'a') meshAction('all');
    else return false;
    return true;
  };

  const handleStudioKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
    if (handleMeshKey(event)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    // Undo/redo work while the studio has focus (the viewport's own shortcut only fires there).
    if ((event.metaKey || event.ctrlKey) && !meshModalLabel && (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y')) {
      if (event.key.toLowerCase() === 'y' || event.shiftKey) redoHistory();
      else undoHistory();
      setMeshSelection(EMPTY_MESH_SELECTION);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key.toLowerCase();
    let handled = true;
    if (key === 'w' && mode !== 'paint') setGizmoMode('translate');
    else if (key === 'e' && mode !== 'paint') setGizmoMode('rotate');
    else if (key === 'r' && mode !== 'paint') setGizmoMode('scale');
    else if (key === 'f') setFitNonce((nonce) => nonce + 1);
    else if (key === 'tab') setMode((current) => current === 'mesh' ? 'build' : 'mesh');
    else if (key === 'p') setMode((current) => current === 'paint' ? 'build' : 'paint');
    else if (mode === 'mesh' && key === '1') setComponentMode('vertex');
    else if (mode === 'mesh' && key === '2') setComponentMode('edge');
    else if (mode === 'mesh' && key === '3') setComponentMode('face');
    else if (mode === 'mesh' && key === 'a') selectAllComponents();
    else if (key === 'escape') {
      if (mode === 'mesh') setSelectedComponents([]);
      else setSelectedPartId('');
    } else handled = false;
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  return (
    <section
      ref={studioRef}
      data-testid="model-forge-studio"
      className="panel material-panel terrain-panel model-forge-panel"
      tabIndex={-1}
      onKeyDown={handleStudioKeyDown}
    >
      <div className="terrain-editor-body tree-builder-body">
        <aside className="node-palette terrain-toolbox">
          <div className="model-panel-kicker">Model library</div>
          <div className="terrain-layer-list">
            {library.map((entry) => (
              <button
                key={entry.id}
                className={entry.id === spec.id ? 'active' : ''}
                onClick={() => selectSpec(entry.id)}
                title={`${entry.name} · ${entry.parts.length} parts`}
              >
                <Box size={13} aria-hidden />
                <span>{entry.name}</span>
              </button>
            ))}
          </div>
          <button
            className="full-button"
            onClick={() => attempt('Duplicate model', () => {
              selectSpec(api.models.duplicateSpec(spec.id));
              return `Duplicated "${spec.name}".`;
            })}
          >
            <Copy size={13} aria-hidden /> Duplicate
          </button>
          <button
            className="full-button danger-soft"
            onClick={() => attempt('Delete model', () => {
              api.models.deleteSpec(spec.id);
              setSelectedPartId('');
              return `Deleted "${spec.name}" — placed copies keep their geometry.`;
            })}
          >
            <Trash2 size={13} aria-hidden /> Delete
          </button>
          <button className="full-button" onClick={() => glbInputRef.current?.click()} title="Turn a .glb into an editable Model Forge asset (one mesh part per mesh)">
            <PackagePlus size={13} aria-hidden /> Import GLB
          </button>
          <input
            ref={glbInputRef}
            type="file"
            accept=".glb,.gltf,model/gltf-binary"
            hidden
            data-testid="model-forge-import-glb"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void importGlb(file);
            }}
          />
          <button className="full-button primary" onClick={placeInScene}>Place in Scene</button>
          <button className="full-button" onClick={bakeToAsset} disabled={baking}>
            <PackagePlus size={13} aria-hidden /> {baking ? 'Baking…' : 'Bake to GLB Asset'}
          </button>
          <div className="model-starter-browser">
            <h4 className="inspector-subhead">Starter models</h4>
            <input
              className="model-starter-search"
              type="search"
              value={starterQuery}
              placeholder="Search starters…"
              aria-label="Search starter models"
              onChange={(event) => setStarterQuery(event.target.value)}
            />
          </div>
          <div className="model-starter-grid" aria-label="Starter models">
            {filteredStarters.map((starter) => (
              <button
                key={starter.id}
                title={starter.tagline}
                onClick={() => attempt('Create model', () => {
                  selectSpec(api.models.createFromStarter(starter.id));
                  return `Created a ${starter.name}.`;
                })}
              >
                <span>{starter.name}</span>
                <small>{starter.tagline}</small>
              </button>
            ))}
            {!filteredStarters.length && <p className="field-hint model-starter-empty">No starter models match.</p>}
          </div>
        </aside>

        <div className="terrain-preview-column">
          <div className="tree-preview-canvas model-forge-canvas">
            <div className="model-forge-hud" aria-hidden={false}>
              <span className={`model-forge-hud-mode is-${mode}`}>
                {mode === 'build' ? 'Object' : mode === 'mesh' ? 'Edit' : 'Paint'}
              </span>
              {selectedPart && (
                <span className="model-forge-hud-part" title={selectedPart.name}>
                  {selectedPart.name || selectedPart.shape}
                </span>
              )}
              <div className="model-forge-view-controls" role="toolbar" aria-label="View controls">
                {([
                  ['perspective', 'Persp'], ['front', 'Front'], ['right', 'Right'], ['top', 'Top'],
                ] as Array<[ForgeView, string]>).map(([nextView, label]) => (
                  <button
                    key={nextView}
                    type="button"
                    aria-pressed={view === nextView}
                    className={view === nextView ? 'active' : undefined}
                    title={`${label} view`}
                    onClick={() => {
                      setView(nextView);
                      setFitNonce((nonce) => nonce + 1);
                    }}
                  >
                    {label}
                  </button>
                ))}
                <button type="button" aria-pressed={gridVisible} className={gridVisible ? 'active' : undefined} title="Toggle grid" onClick={() => setGridVisible((visible) => !visible)}>
                  <Grid3X3 size={12} aria-hidden />
                </button>
                <button type="button" aria-pressed={wireframe} className={wireframe ? 'active' : undefined} title="Toggle wire overlay" onClick={() => setWireframe((visible) => !visible)}>
                  <Eye size={12} aria-hidden />
                </button>
                <button type="button" className="model-forge-hud-fit" title="Fit view (F)" onClick={() => setFitNonce((nonce) => nonce + 1)}>
                  <Focus size={12} aria-hidden /> Fit
                </button>
              </div>
            </div>
            <div className="model-forge-tool-rail" role="toolbar" aria-label="Model tools">
              <button type="button" aria-label="Object mode" aria-pressed={mode === 'build'} className={mode === 'build' ? 'active' : undefined} title="Object mode (Tab)" onClick={() => setMode('build')}>
                <Hammer size={15} aria-hidden />
              </button>
              <button type="button" aria-label="Edit mode" aria-pressed={mode === 'mesh'} className={mode === 'mesh' ? 'active' : undefined} title="Edit control cage (Tab)" onClick={() => setMode('mesh')}>
                <Move3d size={15} aria-hidden />
              </button>
              <button type="button" aria-label="Paint mode" aria-pressed={mode === 'paint'} className={mode === 'paint' ? 'active' : undefined} title="Paint faces (P)" onClick={() => setMode('paint')}>
                <Paintbrush size={15} aria-hidden />
              </button>
              <span className="model-forge-tool-divider" aria-hidden />
              <button
                type="button"
                data-testid="model-forge-add-primitive"
                aria-label="Add primitive"
                aria-expanded={addMenuOpen}
                className={addMenuOpen ? 'active' : undefined}
                title="Add primitive"
                onClick={() => setAddMenuOpen((open) => !open)}
              >
                <Plus size={16} aria-hidden />
              </button>
            </div>
            {addMenuOpen && (
              <div className="model-forge-add-popover" role="menu" aria-label="Add primitive" data-testid="model-forge-add-menu">
                <strong>Add primitive</strong>
                {MODEL_PART_SHAPES.map((shape) => {
                  const Icon = SHAPE_ICONS[shape];
                  return (
                    <button key={shape} type="button" role="menuitem" onClick={() => addPart(shape)}>
                      <Icon size={14} aria-hidden />
                      <span>{shape.charAt(0).toUpperCase() + shape.slice(1)}</span>
                    </button>
                  );
                })}
                <strong>Add mesh (editable quads)</strong>
                {MESH_PRESETS.map((preset) => (
                  <button key={preset.id} type="button" role="menuitem" data-testid={`model-forge-mesh-${preset.id}`} onClick={() => addMeshPart(preset.generator, preset.label.replace(/ \(.*\)$/, ''), preset.scale)}>
                    <Boxes size={14} aria-hidden />
                    <span>{preset.label}</span>
                  </button>
                ))}
              </div>
            )}
            {mode === 'mesh' && selectedPart?.shape === 'box' && (
              <div className="model-forge-component-bar" role="toolbar" aria-label="Mesh component selection" data-testid="model-forge-component-bar">
                {([
                  ['vertex', CircleDot, 'Vertex'], ['edge', Minus, 'Edge'], ['face', Square, 'Face'],
                ] as const).map(([kind, Icon, label], index) => (
                  <button
                    key={kind}
                    type="button"
                    data-testid={`model-forge-component-${kind}`}
                    aria-pressed={componentMode === kind}
                    className={componentMode === kind ? 'active' : undefined}
                    title={`${label} select (${index + 1})`}
                    onClick={() => setComponentMode(kind)}
                  >
                    <Icon size={13} aria-hidden /> {label}
                  </button>
                ))}
                <span>{selectedComponents.length || 0} selected</span>
              </div>
            )}
            {meshModalLabel && <div className="model-forge-modal-hud" role="status">{meshModalLabel}</div>}
            <ForgePreview
              key={spec.id}
              spec={spec}
              mode={mode}
              gizmoMode={gizmoMode}
              componentMode={componentMode}
              selectedComponents={selectedComponents}
              snap={snap}
              gridVisible={gridVisible}
              wireframe={wireframe}
              view={view}
              selectedPartId={selectedPartId}
              fitNonce={fitNonce}
              onSelectPart={(partId) => {
                setSelectedPartId(partId);
                setSelectedComponents([]);
              }}
              onSelectComponent={selectComponent}
              onClearComponentSelection={() => setSelectedComponents([])}
              onPaintFace={paintFace}
              onCommitPart={(partId, patch) => attempt('Move part', () => {
                api.models.updatePart(spec.id, partId, patch);
                return status;
              })}
              onCommitCorners={(partId, corners) => attempt('Edit vertices', () => {
                api.models.setPartCorners(spec.id, partId, corners);
                return corners ? 'Control cage committed — linked scene copies updated.' : 'Control cage reset.';
              })}
              meshSelection={meshSelection}
              meshSettings={meshSettings}
              meshModalRequest={meshModalRequest}
              hiddenPartIds={hiddenPartIds}
              onMeshSelectionChange={setMeshSelection}
              onCommitMeshPositions={(partId, positions) => attempt('Transform', () => {
                api.models.meshOp(spec.id, partId, { type: 'setVertices', positions });
                return `Moved ${positions.length} vertex${positions.length === 1 ? '' : 'es'}.`;
              })}
              onCommitMeshOp={(partId, op) => runMeshOp(op.type === 'loopCut' ? 'Loop cut' : op.type.charAt(0).toUpperCase() + op.type.slice(1), op, partId)}
              onMeshModalChange={setMeshModalLabel}
              onProportionalRadiusChange={(radius) => setMeshTools((tools) => ({ ...tools, proportionalRadius: radius }))}
            />
          </div>
          <div className="tree-preview-meta">
            <span>{spec.name} · {spec.parts.length} parts</span>
            <span>{placedCount} placed</span>
          </div>
          <div className="model-part-chips" role="listbox" aria-label="Parts">
            {[...spec.parts].sort((x, y) => (x.group ?? '').localeCompare(y.group ?? '')).map((part, index, sorted) => {
              const hidden = hiddenPartIds.includes(part.id);
              const showGroup = part.group && part.group !== sorted[index - 1]?.group;
              return (
                <span key={part.id} className="model-part-chip-wrap">
                  {showGroup && (
                    <button
                      type="button"
                      className="model-part-group"
                      title={`Select the "${part.group}" group's first part; hide/show the group`}
                      onClick={() => {
                        const members = spec.parts.filter((entry) => entry.group === part.group).map((entry) => entry.id);
                        const allHidden = members.every((id) => hiddenPartIds.includes(id));
                        setHiddenPartIds((current) => (allHidden ? current.filter((id) => !members.includes(id)) : [...new Set([...current, ...members])]));
                      }}
                    >
                      {part.group}
                    </button>
                  )}
                  <button
                    type="button"
                    role="option"
                    aria-selected={part.id === selectedPartId}
                    className={`${part.id === selectedPartId ? 'active' : ''}${hidden ? ' is-hidden' : ''}`}
                    onClick={() => {
                      setSelectedPartId(part.id);
                      setSelectedComponents([]);
                      if (mode === 'mesh' && part.shape !== 'box' && part.shape !== 'mesh') {
                        setStatus('Edit mode shapes boxes (control cage) or mesh parts (real polygons). Convert this part to a mesh to edit it.');
                      }
                    }}
                  >
                    <span
                      className="model-part-chip-swatch"
                      style={{ background: spec.palette[part.colorSlot] ?? '#888' }}
                    />
                    {part.name || part.shape}
                  </button>
                  <button
                    type="button"
                    className="model-part-eye"
                    aria-label={hidden ? `Show ${part.name}` : `Hide ${part.name}`}
                    title={hidden ? 'Show in the Forge preview' : 'Hide in the Forge preview (editor only)'}
                    onClick={() => setHiddenPartIds((current) => (hidden ? current.filter((id) => id !== part.id) : [...current, part.id]))}
                  >
                    <Eye size={11} aria-hidden style={{ opacity: hidden ? 0.35 : 1 }} />
                  </button>
                </span>
              );
            })}
            {selectedPart && (
              <button
                type="button"
                className="model-part-isolate"
                title="Isolate: hide every other part (click again to show all)"
                onClick={() => setHiddenPartIds((current) => (current.length ? [] : spec.parts.filter((part) => part.id !== selectedPart.id).map((part) => part.id)))}
              >
                {hiddenPartIds.length ? 'Show all' : 'Isolate'}
              </button>
            )}
          </div>
          <div className="model-toolbar">
            <div className="model-toolbar-seg" role="tablist" aria-label="Mode">
              <button role="tab" aria-selected={mode === 'build'} className={mode === 'build' ? 'active' : ''} onClick={() => setMode('build')} title="Object mode (Tab)">
                <Hammer size={12} aria-hidden /> Object
              </button>
              <button role="tab" aria-selected={mode === 'mesh'} className={mode === 'mesh' ? 'active' : ''} onClick={() => setMode('mesh')} title="Edit mode (Tab)">
                <Move3d size={12} aria-hidden /> Edit
              </button>
              <button role="tab" aria-selected={mode === 'paint'} className={mode === 'paint' ? 'active' : ''} onClick={() => setMode('paint')} title="Paint mode (P)">
                <Paintbrush size={12} aria-hidden /> Paint
              </button>
            </div>
            {meshPart && (
              <div className="model-toolbar-seg" role="toolbar" aria-label="Mesh selection">
                {(['vertex', 'edge', 'face'] as BoxComponentMode[]).map((kind, index) => (
                  <button key={kind} aria-pressed={componentMode === kind} className={componentMode === kind ? 'active' : ''} onClick={() => setComponentMode(kind)} title={`${kind} select (${index + 1})`}>
                    {kind.charAt(0).toUpperCase() + kind.slice(1)}
                  </button>
                ))}
                <button onClick={() => meshAction('all')} title="Select all (A)">All</button>
                <button disabled={!meshSelectionCount} onClick={() => meshAction('none')} title="Select none (Alt+A)">None</button>
                <button onClick={() => meshAction('invert')} title="Invert selection (Ctrl+I)">Invert</button>
                <button disabled={!meshSelectionCount} onClick={() => meshAction('linked')} title="Select linked (Ctrl+L)">Linked</button>
                <button disabled={!meshSelectionCount} onClick={() => meshAction('grow')} title="Grow selection (Ctrl +)">Grow</button>
                <button disabled={!meshSelectionCount} onClick={() => meshAction('shrink')} title="Shrink selection (Ctrl -)">Shrink</button>
                <span className="model-toolbar-count">{meshSelectionCount} selected</span>
              </div>
            )}
            {meshPart && (
              <div className="model-toolbar-seg" role="toolbar" aria-label="Mesh edit actions" data-testid="model-forge-mesh-tools">
                <button disabled={!meshSelectedFaces().length} onClick={() => meshAction('extrude')} title="Extrude faces (E drags it)">Extrude</button>
                <button disabled={!meshSelectedFaces().length} onClick={() => meshAction('inset')} title="Inset faces (I drags it)">Inset</button>
                <button disabled={!meshSelectedEdges().length} onClick={() => meshAction('bevel')} title="Bevel edges (Ctrl+B drags it, wheel = segments)">Bevel</button>
                <button onClick={() => (meshSelectedEdges().length ? meshAction('loopcut') : startMeshModal('loopcut'))} title="Loop cut (Ctrl+R: hover an edge, wheel = cuts, click)">Loop Cut</button>
                <button disabled={!meshSelectedFaces().length} onClick={() => meshAction('subdivide')} title="Subdivide faces">Subdivide</button>
                <button disabled={meshSelectedVerts.length < 2} onClick={() => meshAction('merge')} title="Merge at center (M)">Merge</button>
                <button disabled={!meshSelectedVerts.length} onClick={() => meshAction('fill')} title="Fill hole (F)">Fill</button>
                <button disabled={!meshSelectionCount} onClick={() => meshAction('delete')} title="Delete (X) — edges dissolve">Delete</button>
                <button disabled={!meshSelectedEdges().length} onClick={() => meshAction('dissolve')} title="Dissolve edges">Dissolve</button>
                <button disabled={!meshSelectedFaces().length} onClick={() => meshAction('flip')} title="Flip normals">Flip</button>
                <button onClick={() => meshAction('recalc')} title="Recalculate normals outside (Shift+N)">Normals</button>
                <button disabled={!meshSelectedEdges().length} onClick={() => meshAction('sharp')} title="Mark sharp: stays crisp under subdivision and auto-smooth">Sharp</button>
                <button disabled={!meshSelectedEdges().length} onClick={() => meshAction('unsharp')} title="Clear sharp">Smooth</button>
                <button onClick={() => meshAction('weld')} title="Merge vertices by distance">Weld</button>
              </div>
            )}
            {meshPart && (
              <div className="model-toolbar-seg" role="toolbar" aria-label="Modeling aids">
                {(['x', 'y', 'z'] as const).map((axis) => (
                  <button
                    key={axis}
                    aria-pressed={meshTools.symmetry.includes(axis)}
                    className={meshTools.symmetry.includes(axis) ? 'active' : ''}
                    title={`${axis.toUpperCase()}-mirror editing: moves also move the mirrored vertex`}
                    onClick={() => setMeshTools((tools) => ({
                      ...tools,
                      symmetry: tools.symmetry.includes(axis) ? tools.symmetry.filter((entry) => entry !== axis) : [...tools.symmetry, axis],
                    }))}
                  >
                    Mirror {axis.toUpperCase()}
                  </button>
                ))}
                <button
                  aria-pressed={meshTools.xray}
                  className={meshTools.xray ? 'active' : ''}
                  title="X-Ray (Alt+Z): see and select through the mesh"
                  onClick={() => setMeshTools((tools) => ({ ...tools, xray: !tools.xray }))}
                >
                  X-Ray
                </button>
                <button title="Box select (B): drag a rectangle; Shift adds, Ctrl subtracts" onClick={() => startMeshModal('box')}>Box</button>
                <button title="Knife (K): drag a line across faces to cut them" onClick={() => startMeshModal('knife')}>Knife</button>
                <button
                  aria-pressed={meshTools.proportional}
                  className={meshTools.proportional ? 'active' : ''}
                  title="Proportional editing (O) — mouse wheel during G/R/S changes the radius"
                  onClick={() => setMeshTools((tools) => ({ ...tools, proportional: !tools.proportional }))}
                >
                  Proportional
                </button>
                {meshTools.proportional && (
                  <select
                    aria-label="Proportional falloff"
                    value={meshTools.falloff}
                    onChange={(event) => setMeshTools((tools) => ({ ...tools, falloff: event.target.value as MeshToolSettings['falloff'] }))}
                  >
                    {(['smooth', 'sphere', 'root', 'linear', 'sharp', 'constant'] as const).map((falloff) => (
                      <option key={falloff} value={falloff}>{falloff}</option>
                    ))}
                  </select>
                )}
              </div>
            )}
            {mode === 'mesh' && selectedPart?.shape === 'box' && (
              <div className="model-toolbar-seg" role="toolbar" aria-label="Mesh selection">
                <button aria-pressed={componentMode === 'vertex'} className={componentMode === 'vertex' ? 'active' : ''} onClick={() => setComponentMode('vertex')} title="Vertex select (1)">Vertex</button>
                <button aria-pressed={componentMode === 'edge'} className={componentMode === 'edge' ? 'active' : ''} onClick={() => setComponentMode('edge')} title="Edge select (2)">Edge</button>
                <button aria-pressed={componentMode === 'face'} className={componentMode === 'face' ? 'active' : ''} onClick={() => setComponentMode('face')} title="Face select (3)">Face</button>
                <button onClick={selectAllComponents} title="Select all components (A)">All</button>
                <button disabled={!selectedComponents.length} onClick={() => setSelectedComponents([])}>Clear</button>
                <button disabled={!selectedComponents.length} onClick={resetSelectedComponents} title="Restore the selected control points">Reset</button>
              </div>
            )}
            {mode !== 'paint' && (
              <div className="model-toolbar-seg" role="toolbar" aria-label="Transform tool">
                <button aria-pressed={gizmoMode === 'translate'} className={gizmoMode === 'translate' ? 'active' : ''} onClick={() => setGizmoMode('translate')} title="W">Move</button>
                <button aria-pressed={gizmoMode === 'rotate'} className={gizmoMode === 'rotate' ? 'active' : ''} onClick={() => setGizmoMode('rotate')} title="E">Rotate</button>
                <button aria-pressed={gizmoMode === 'scale'} className={gizmoMode === 'scale' ? 'active' : ''} onClick={() => setGizmoMode('scale')} title="R">Scale</button>
              </div>
            )}
            <label className="model-snap-toggle">
              <input type="checkbox" checked={snap} onChange={(event) => setSnap(event.target.checked)} /> Snap
            </label>
          </div>
          <p className="field-hint">
            {mode === 'paint'
              ? 'Click a face to paint. Pick a swatch in the inspector first.'
              : mode === 'mesh'
                ? selectedPart?.shape === 'box'
                  ? `Select ${componentPlural}, Shift-click for more, then transform with W/E/R. The fixed eight-point cage keeps the model lightweight.`
                  : selectedPart?.shape === 'mesh'
                    ? `Click ${componentPlural} (Shift adds, Alt picks a loop). G/R/S transform (X/Y/Z lock, type a value), E extrude, I inset, Ctrl+B bevel, Ctrl+R loop cut, X delete, M merge, F fill, O proportional.`
                    : 'Edit mode shapes box parts (control cage) or mesh parts (real vertices). Select one, or change this part\'s shape in the inspector.'
                : 'Select a part and transform it with W/E/R. Add primitives from the + rail or inspector. F fits the view.'}
          </p>
          <div className="model-forge-shortcuts" aria-label="Keyboard shortcuts">
            <span><kbd>Tab</kbd> Object/Edit</span>
            <span><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> Components</span>
            <span><kbd>Shift</kbd> Multi-select</span>
            <span><kbd>A</kbd> Select all</span>
            <span><kbd>F</kbd> Frame</span>
            {meshPart && (
              <>
                <span><kbd>G</kbd><kbd>R</kbd><kbd>S</kbd> Move/Rotate/Scale</span>
                <span><kbd>E</kbd> Extrude</span>
                <span><kbd>I</kbd> Inset</span>
                <span><kbd>Ctrl</kbd><kbd>B</kbd> Bevel</span>
                <span><kbd>Ctrl</kbd><kbd>R</kbd> Loop cut</span>
                <span><kbd>Alt</kbd>-click Loop select</span>
                <span><kbd>O</kbd> Proportional</span>
                <span><kbd>B</kbd> Box select</span>
                <span><kbd>K</kbd> Knife</span>
                <span><kbd>Alt</kbd><kbd>Z</kbd> X-Ray</span>
              </>
            )}
          </div>
          <p className="field-hint model-forge-status">{status}</p>
        </div>

        <aside className="graph-inspector terrain-controls">
          <div className="node-inspector-body">
            <div className="terrain-control-grid">
              <label className="node-field">
                <span>Name</span>
                <input
                  value={spec.name}
                  onChange={(event) => attempt('Rename model', () => {
                    api.models.updateSpec(spec.id, { name: event.target.value });
                    return status;
                  })}
                />
              </label>

              <h4 className="inspector-subhead">Palette</h4>
              <PaletteStrip palette={spec.palette} activeSlot={clampedActiveSlot} onPick={setActiveSlot} />
              <div className="model-palette-edit">
                <input
                  type="color"
                  value={spec.palette[clampedActiveSlot] ?? '#888888'}
                  onChange={(event) => editPaletteColor(clampedActiveSlot, event.target.value)}
                  title="Edit selected color"
                />
                <button
                  className="full-button"
                  disabled={spec.palette.length >= 16}
                  onClick={() => attempt('Add color', () => {
                    api.models.setPalette(spec.id, [...spec.palette, spec.palette[clampedActiveSlot] ?? '#888888']);
                    return status;
                  })}
                >
                  Add color
                </button>
              </div>

              <h4 className="inspector-subhead">Style</h4>
              <div className="model-toolbar-seg" role="tablist" aria-label="Finish">
                <button
                  className={styleOf(spec).finish === 'smooth' ? 'active' : ''}
                  title="Spline-soft: rounded corners, smooth shading, satin sheen"
                  onClick={() => patchStyle({ finish: 'smooth' })}
                >
                  Smooth
                </button>
                <button
                  className={styleOf(spec).finish === 'flat' ? 'active' : ''}
                  title="Meshy-crisp: hard edges, faceted flat shading"
                  onClick={() => patchStyle({ finish: 'flat' })}
                >
                  Flat
                </button>
              </div>
              {styleOf(spec).finish === 'smooth' && (
                <RangeField
                  label="Bevel"
                  value={styleOf(spec).bevel}
                  min={0}
                  max={0.2}
                  step={0.005}
                  onChange={(value) => patchStyle({ bevel: value })}
                />
              )}
              <RangeField
                label="Roughness"
                value={styleOf(spec).roughness}
                min={0.05}
                max={1}
                step={0.05}
                onChange={(value) => patchStyle({ roughness: value })}
              />

              <h4 className="inspector-subhead">Add part</h4>
              <div className="model-shape-row">
                {MODEL_PART_SHAPES.map((shape) => {
                  const Icon = SHAPE_ICONS[shape];
                  return (
                    <button key={shape} title={`Add ${shape}`} onClick={() => addPart(shape)}>
                      <Icon size={14} aria-hidden />
                    </button>
                  );
                })}
              </div>

              {selectedPart ? (
                <>
                  <h4 className="inspector-subhead">Part · {selectedPart.name}</h4>
                  <label className="node-field">
                    <span>Name</span>
                    <input
                      value={selectedPart.name}
                      onChange={(event) => attempt('Rename part', () => {
                        api.models.updatePart(spec.id, selectedPart.id, { name: event.target.value });
                        return status;
                      })}
                    />
                  </label>
                  <label className="node-field">
                    <span>Shape</span>
                    <select
                      value={selectedPart.shape}
                      onChange={(event) => attempt('Reshape part', () => {
                        api.models.updatePart(spec.id, selectedPart.id, { shape: event.target.value as ModelPartShape });
                        return status;
                      })}
                    >
                      {MODEL_PART_SHAPES.map((shape) => (
                        <option key={shape} value={shape}>{shape}</option>
                      ))}
                    </select>
                  </label>
                  <label className="node-field">
                    <span>Collider</span>
                    <select
                      value={selectedPart.collider ?? 'auto'}
                      onChange={(event) => attempt('Set part collider', () => {
                        api.models.updatePart(spec.id, selectedPart.id, { collider: event.target.value as ModelPartCollider });
                        return status;
                      })}
                    >
                      {(['auto', 'box', 'sphere', 'capsule', 'none'] as ModelPartCollider[]).map((collider) => (
                        <option key={collider} value={collider}>
                          {collider === 'auto' ? 'auto (match shape)' : collider === 'none' ? 'none (no collision)' : collider}
                        </option>
                      ))}
                    </select>
                  </label>
                  <VecField
                    label="Position"
                    value={selectedPart.position}
                    step={0.25}
                    onChange={(next) => attempt('Move part', () => {
                      api.models.updatePart(spec.id, selectedPart.id, { position: next });
                      return status;
                    })}
                  />
                  <VecField
                    label="Rotation°"
                    value={selectedPart.rotation}
                    step={15}
                    toDisplay={(v) => v * RAD2DEG}
                    fromDisplay={(v) => v * DEG2RAD}
                    onChange={(next) => attempt('Rotate part', () => {
                      api.models.updatePart(spec.id, selectedPart.id, { rotation: next });
                      return status;
                    })}
                  />
                  <VecField
                    label="Size"
                    value={selectedPart.scale}
                    step={0.25}
                    onChange={(next) => attempt('Resize part', () => {
                      api.models.updatePart(spec.id, selectedPart.id, { scale: next.map((v) => Math.max(0.01, v)) as Vector3Tuple });
                      return status;
                    })}
                  />
                  {selectedPart.shape === 'box' && (
                    <div className="model-cage-summary">
                      <h4 className="inspector-subhead">Control cage</h4>
                      <p className="field-hint">8 vertices · 12 edges · 6 faces. These reshape the hull without increasing project size.</p>
                      <div className="model-toolbar-seg" role="toolbar" aria-label="Open control cage editing">
                        {(['vertex', 'edge', 'face'] as BoxComponentMode[]).map((kind) => (
                          <button
                            key={kind}
                            className={mode === 'mesh' && componentMode === kind ? 'active' : ''}
                            onClick={() => {
                              setMode('mesh');
                              setComponentMode(kind);
                            }}
                          >
                            {kind.charAt(0).toUpperCase() + kind.slice(1)}
                          </button>
                        ))}
                      </div>
                      {selectedPart.corners && (
                        <button
                          className="full-button"
                          onClick={() => attempt('Reset control cage', () => {
                            api.models.setPartCorners(spec.id, selectedPart.id, null);
                            setSelectedComponents([]);
                            return `Reset "${selectedPart.name}" back to a pristine box.`;
                          })}
                        >
                          <RotateCcw size={13} aria-hidden /> Reset Entire Cage
                        </button>
                      )}
                    </div>
                  )}
                  {selectedPart.shape === 'mesh' && selectedPart.mesh && (
                    <div className="model-cage-summary">
                      <h4 className="inspector-subhead">Mesh geometry</h4>
                      <p className="field-hint">
                        {selectedPart.mesh.vertices.length} vertices · {meshEdgePairs(selectedPart.mesh).length} edges · {meshFaceCount(selectedPart.mesh)} faces
                        {selectedPart.mesh.sharpEdges?.length ? ` · ${selectedPart.mesh.sharpEdges.length} sharp` : ''}. Tab into Edit mode: G/R/S move, E extrude, I inset, Ctrl+B bevel, Ctrl+R loop cut, Alt-click loops.
                      </p>
                      <div className="model-toolbar-seg" role="toolbar" aria-label="Open mesh editing">
                        {(['vertex', 'edge', 'face'] as BoxComponentMode[]).map((kind) => (
                          <button
                            key={kind}
                            className={mode === 'mesh' && componentMode === kind ? 'active' : ''}
                            onClick={() => {
                              setMode('mesh');
                              setComponentMode(kind);
                            }}
                          >
                            {kind.charAt(0).toUpperCase() + kind.slice(1)}
                          </button>
                        ))}
                      </div>

                      <h4 className="inspector-subhead">Modifiers</h4>
                      {(selectedPart.modifiers ?? []).map((modifier, index, list) => {
                        const update = (next: ModelModifier | null) => {
                          const stack = [...list];
                          if (next) stack[index] = next;
                          else stack.splice(index, 1);
                          patchPart('Edit modifier', { modifiers: stack });
                        };
                        const move = (delta: number) => {
                          const stack = [...list];
                          const [entry] = stack.splice(index, 1);
                          stack.splice(Math.min(stack.length, Math.max(0, index + delta)), 0, entry);
                          patchPart('Reorder modifiers', { modifiers: stack });
                        };
                        return (
                          <div key={index} className="model-modifier-card" data-testid={`model-modifier-${modifier.type}`}>
                            <div className="model-modifier-head">
                              <label>
                                <input type="checkbox" checked={modifier.enabled !== false} onChange={(event) => update({ ...modifier, enabled: event.target.checked })} />
                                {modifier.type === 'mirror' ? 'Mirror' : modifier.type === 'array' ? 'Array' : 'Subdivision Surface'}
                              </label>
                              <button type="button" title="Move up" disabled={index === 0} onClick={() => move(-1)}>↑</button>
                              <button type="button" title="Move down" disabled={index === list.length - 1} onClick={() => move(1)}>↓</button>
                              <button type="button" title="Remove modifier" onClick={() => update(null)}><Trash2 size={11} aria-hidden /></button>
                            </div>
                            {modifier.type === 'mirror' && (
                              <div className="model-toolbar-seg" role="group" aria-label="Mirror axes">
                                {(['x', 'y', 'z'] as const).map((axis) => (
                                  <button
                                    key={axis}
                                    className={modifier.axes.includes(axis) ? 'active' : ''}
                                    onClick={() => {
                                      const axes = modifier.axes.includes(axis) ? modifier.axes.filter((entry) => entry !== axis) : [...modifier.axes, axis];
                                      if (axes.length) update({ ...modifier, axes });
                                    }}
                                  >
                                    {axis.toUpperCase()}
                                  </button>
                                ))}
                              </div>
                            )}
                            {modifier.type === 'subdivision' && (
                              <RangeField label="Levels" value={modifier.levels} min={1} max={4} step={1} onChange={(value) => update({ ...modifier, levels: Math.round(value) })} />
                            )}
                            {modifier.type === 'array' && (
                              <>
                                <RangeField label="Count" value={modifier.count} min={1} max={32} step={1} onChange={(value) => update({ ...modifier, count: Math.round(value) })} />
                                <div className="model-toolbar-seg" role="group" aria-label="Array mode">
                                  {(['linear', 'radial'] as const).map((arrayMode) => (
                                    <button key={arrayMode} className={modifier.mode === arrayMode ? 'active' : ''} onClick={() => update({ ...modifier, mode: arrayMode })}>
                                      {arrayMode === 'linear' ? 'Linear' : 'Radial'}
                                    </button>
                                  ))}
                                </div>
                                {modifier.mode === 'linear' ? (
                                  <VecField label="Offset" value={modifier.offset ?? [1, 0, 0]} step={0.1} onChange={(offset) => update({ ...modifier, offset })} />
                                ) : (
                                  <>
                                    <div className="model-toolbar-seg" role="group" aria-label="Array axis">
                                      {(['x', 'y', 'z'] as const).map((axis) => (
                                        <button key={axis} className={(modifier.axis ?? 'y') === axis ? 'active' : ''} onClick={() => update({ ...modifier, axis })}>
                                          {axis.toUpperCase()}
                                        </button>
                                      ))}
                                    </div>
                                    <RangeField label="Angle°" value={modifier.angle ?? 360} min={10} max={360} step={5} onChange={(value) => update({ ...modifier, angle: value })} />
                                  </>
                                )}
                              </>
                            )}
                          </div>
                        );
                      })}
                      <div className="model-toolbar-seg" role="toolbar" aria-label="Add modifier">
                        <button onClick={() => patchPart('Add modifier', { modifiers: [...(selectedPart.modifiers ?? []), { type: 'mirror', axes: ['x'] }] }, 'Mirror modifier: model one half, the other follows live.')}>+ Mirror</button>
                        <button onClick={() => patchPart('Add modifier', { modifiers: [...(selectedPart.modifiers ?? []), { type: 'array', count: 3, mode: 'linear', offset: [1.2, 0, 0] }] }, 'Array modifier added.')}>+ Array</button>
                        <button onClick={() => patchPart('Add modifier', { modifiers: [...(selectedPart.modifiers ?? []), { type: 'subdivision', levels: 2 }] }, 'Subdivision surface: mark hard edges Sharp to keep them crisp.')}>+ Subdivision</button>
                      </div>
                      {!!selectedPart.modifiers?.length && (
                        <button className="full-button" onClick={() => runMeshOp('Apply modifiers', { type: 'applyModifiers' })} title="Bake the modifier stack into the editable cage">
                          Apply Modifiers
                        </button>
                      )}

                      <h4 className="inspector-subhead">Surface</h4>
                      <RangeField
                        label="Smooth angle°"
                        value={selectedPart.smoothAngle ?? (styleOf(spec).finish === 'smooth' ? 40 : 0)}
                        min={0}
                        max={180}
                        step={5}
                        onChange={(value) => patchPart('Auto smooth', { smoothAngle: value })}
                      />
                      <label className="node-field">
                        <span>Material</span>
                        <select
                          value={selectedPart.materialId ?? ''}
                          onChange={(event) => patchPart('Set material', { materialId: event.target.value || undefined }, event.target.value ? 'Project material applied — textures tile through the part UVs.' : 'Back to the palette color.')}
                        >
                          <option value="">Palette color</option>
                          {materials.map((material) => (
                            <option key={material.id} value={material.id}>{material.name}</option>
                          ))}
                        </select>
                      </label>
                      <div className="model-toolbar-seg" role="toolbar" aria-label="UV unwrap">
                        {(['box', 'smart', 'cylinder', 'sphere'] as const).map((method) => (
                          <button key={method} onClick={() => runMeshOp(`UV unwrap (${method})`, { type: 'unwrap', method })} title={method === 'smart' ? 'Smart UV project: non-overlapping charts packed in 0-1 (for painted/baked textures)' : `${method} projection, world-scaled tiling`}>
                            UV {method.charAt(0).toUpperCase() + method.slice(1)}
                          </button>
                        ))}
                      </div>
                      <p className="field-hint">{selectedPart.mesh.faceUVs ? 'Has its own UV layout.' : 'No UVs yet — textures use automatic box projection.'}</p>

                      <h4 className="inspector-subhead">Bake textures</h4>
                      <p className="field-hint">Bakes paint × ambient occlusion (and optionally a normal map from the subdivision detail) into a textured material — game-ready for GLB export.</p>
                      <div className="model-bake-row">
                        <label><input type="checkbox" checked={bakeOptions.ao} onChange={(event) => setBakeOptions((current) => ({ ...current, ao: event.target.checked }))} /> AO</label>
                        <label><input type="checkbox" checked={bakeOptions.normal} onChange={(event) => setBakeOptions((current) => ({ ...current, normal: event.target.checked }))} /> Normal map</label>
                        <select aria-label="Bake size" value={bakeOptions.size} onChange={(event) => setBakeOptions((current) => ({ ...current, size: Number(event.target.value) }))}>
                          {[256, 512, 1024, 2048].map((size) => <option key={size} value={size}>{size}px</option>)}
                        </select>
                      </div>
                      <button className="full-button" data-testid="model-forge-bake-textures" disabled={baking} onClick={() => void bakeTextures()}>
                        <Paintbrush size={13} aria-hidden /> {baking ? 'Baking…' : 'Bake Textures'}
                      </button>

                      <h4 className="inspector-subhead">Bisect (cut in half)</h4>
                      <div className="model-toolbar-seg" role="toolbar" aria-label="Bisect">
                        {(['x', 'y', 'z'] as const).map((axis) => (
                          <button
                            key={axis}
                            title={`Cut at ${axis.toUpperCase()}=0, delete the negative side and cap the cut`}
                            onClick={() => runMeshOp(`Bisect ${axis.toUpperCase()}`, {
                              type: 'bisect',
                              plane: { point: [0, 0, 0], normal: [axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0] },
                              clear: 'inner',
                              fill: true,
                            })}
                          >
                            Keep +{axis.toUpperCase()}
                          </button>
                        ))}
                      </div>

                      <h4 className="inspector-subhead">Mirror (apply)</h4>
                      <div className="model-toolbar-seg" role="toolbar" aria-label="Apply mirror">
                        {(['x', 'y', 'z'] as const).map((axis) => (
                          <button key={axis} onClick={() => runMeshOp(`Mirror ${axis.toUpperCase()}`, { type: 'mirror', axis })} title={`Duplicate across the ${axis.toUpperCase()}=0 plane and weld the seam`}>
                            {axis.toUpperCase()}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <label className="node-field">
                    <span>Group</span>
                    <input
                      value={selectedPart.group ?? ''}
                      placeholder="e.g. Wheels"
                      onChange={(event) => patchPart('Group part', { group: event.target.value || undefined })}
                    />
                  </label>
                  {selectedPart.shape !== 'mesh' && (
                    <button
                      className="full-button"
                      onClick={convertSelectedToMesh}
                      title="Bake this part's exact surface into an editable mesh (then drag, extrude, or boolean it)"
                    >
                      <Boxes size={13} aria-hidden /> Convert to Mesh
                    </button>
                  )}
                  {spec.parts.length >= 2 && (
                    <div className="model-toolbar-seg" role="toolbar" aria-label="Boolean with the other part">
                      {(['union', 'difference', 'intersect'] as const).map((operation) => (
                        <button
                          key={operation}
                          onClick={() => booleanWithOpposite(operation)}
                          title={`${operation} with the other part — result stays on this part`}
                        >
                          {operation === 'union' ? 'Union' : operation === 'difference' ? 'Subtract' : 'Intersect'}
                        </button>
                      ))}
                    </div>
                  )}
                  <label className="node-field">
                    <PaletteStrip
                      palette={spec.palette}
                      activeSlot={selectedPart.colorSlot}
                      onPick={(slot) => attempt('Paint part', () => {
                        api.models.paintPart(spec.id, selectedPart.id, slot);
                        return `Painted "${selectedPart.name}" with slot ${slot}.`;
                      })}
                    />
                  </label>
                  {Object.keys(shapeFaceGroups).length > 1 && (
                    <div className="model-face-chips">
                      {Object.entries(shapeFaceGroups).map(([group, label]) => {
                        const groupIndex = Number(group);
                        const effectiveSlot = selectedPart.faceColors?.[groupIndex] ?? selectedPart.colorSlot;
                        return (
                          <button
                            key={group}
                            title={`Paint ${label} with the selected palette color`}
                            onClick={() => paintFace(selectedPart.id, groupIndex)}
                          >
                            <span className="model-face-chip-swatch" style={{ background: spec.palette[effectiveSlot] ?? '#888' }} aria-hidden />
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div className="model-part-actions">
                    <button
                      className="full-button"
                      onClick={() => attempt('Duplicate part', () => {
                        setSelectedPartId(api.models.duplicatePart(spec.id, selectedPart.id));
                        return `Duplicated "${selectedPart.name}".`;
                      })}
                    >
                      <Copy size={13} aria-hidden /> Duplicate Part
                    </button>
                    <button
                      className="full-button danger-soft"
                      onClick={() => attempt('Delete part', () => {
                        api.models.removePart(spec.id, selectedPart.id);
                        setSelectedPartId('');
                        return `Deleted "${selectedPart.name}".`;
                      })}
                    >
                      <Trash2 size={13} aria-hidden /> Delete Part
                    </button>
                  </div>
                </>
              ) : (
                <p className="field-hint">
                  {mode === 'paint'
                    ? 'Painting the whole model: click faces in the preview.'
                    : 'No part selected — click one in the preview, or add a primitive above.'}
                </p>
              )}
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
