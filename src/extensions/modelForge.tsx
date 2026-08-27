import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { ContactShadows, Grid, OrbitControls, TransformControls } from '@react-three/drei';
import type { TransformControls as TransformControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import {
  Box, CircleDot, Cone, Copy, Cylinder, Eye, Focus, Globe, Grid3X3, Hammer, Minus, Move3d, PackagePlus,
  Paintbrush, Plus, Pyramid, RotateCcw, Square, Trash2,
} from 'lucide-react';
import type { ModelPart, ModelPartShape, ModelSpec, ModelStyle, Vector3Tuple } from '../types';
import {
  BOX_CORNER_LABELS,
  BOX_EDGE_CORNERS,
  BOX_FACE_CORNERS,
  DEFAULT_MODEL_STYLE,
  MODEL_FACE_GROUPS,
  MODEL_PART_SHAPES,
  boxComponentCorners,
  boxComponentCount,
  type BoxComponentMode,
} from '../model/modelSpec';
import { buildModelGroup, faceGroupForFaceIndex, getPartRenderEdges, getPartRenderGeometry } from '../model/modelGeometry';
import { ModelPartMesh } from '../three/ModelMesh';
import { RangeField } from '../components/InspectorPanel';
import { useEditorStore } from '../store/editorStore';
import { defineFeatherPlugin, type FeatherPluginAPI } from './types';

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

const PLUGIN_ID = 'feather.model-forge';
const PANEL_ID = `${PLUGIN_ID}.studio`;

const SHAPE_ICONS: Record<ModelPartShape, typeof Box> = {
  box: Box,
  cylinder: Cylinder,
  sphere: Globe,
  cone: Cone,
  wedge: Pyramid,
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
}: ForgePreviewProps) {
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
      {spec.parts.map((part) =>
        mode === 'build' && part.id === selectedPartId ? (
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
        if (!selected || selected.shape !== 'box') return null;
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

function ModelForgePanel({ api }: { api: FeatherPluginAPI }) {
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

  const paintFace = (partId: string, faceGroup: number) =>
    attempt('Paint face', () => {
      api.models.paintPart(spec.id, partId, clampedActiveSlot, faceGroup);
      setSelectedPartId(partId);
      return `Painted ${MODEL_FACE_GROUPS[spec.parts.find((part) => part.id === partId)?.shape ?? 'box'][faceGroup] ?? 'face'} with slot ${clampedActiveSlot}.`;
    });

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

  const selectAllComponents = () =>
    setSelectedComponents(Array.from({ length: boxComponentCount(componentMode) }, (_, index) => index));

  const resetSelectedComponents = () => {
    if (!selectedPart || selectedPart.shape !== 'box' || !selectedComponents.length) return;
    const selectedCorners = new Set(selectedComponents.flatMap((index) => boxComponentCorners(componentMode, index)));
    attempt('Reset control points', () => {
      const next = { ...selectedPart.corners };
      selectedCorners.forEach((index) => delete next[index]);
      api.models.setPartCorners(spec.id, selectedPart.id, Object.keys(next).length ? next : null);
      return `Reset ${selectedCorners.size} control point${selectedCorners.size === 1 ? '' : 's'} on "${selectedPart.name}".`;
    });
  };

  const handleStudioKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
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
            />
          </div>
          <div className="tree-preview-meta">
            <span>{spec.name} · {spec.parts.length} parts</span>
            <span>{placedCount} placed</span>
          </div>
          <div className="model-part-chips" role="listbox" aria-label="Parts">
            {spec.parts.map((part) => (
              <button
                key={part.id}
                type="button"
                role="option"
                aria-selected={part.id === selectedPartId}
                className={part.id === selectedPartId ? 'active' : undefined}
                onClick={() => {
                  setSelectedPartId(part.id);
                  setSelectedComponents([]);
                  if (mode === 'mesh' && part.shape !== 'box') {
                    setStatus('Edit mode uses the eight-point control cage on box parts. Pick a box or reshape this part.');
                  }
                }}
              >
                <span
                  className="model-part-chip-swatch"
                  style={{ background: spec.palette[part.colorSlot] ?? '#888' }}
                />
                {part.name || part.shape}
              </button>
            ))}
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
            {mode === 'mesh' && selectedPart?.shape === 'box' && (
              <div className="model-toolbar-seg" role="toolbar" aria-label="Control cage selection">
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
                  : 'Edit mode works on box parts. Select a box part or change this part\'s shape in the inspector.'
                : 'Select a part and transform it with W/E/R. Add primitives from the + rail or inspector. F fits the view.'}
          </p>
          <div className="model-forge-shortcuts" aria-label="Keyboard shortcuts">
            <span><kbd>Tab</kbd> Object/Edit</span>
            <span><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> Components</span>
            <span><kbd>Shift</kbd> Multi-select</span>
            <span><kbd>A</kbd> Select all</span>
            <span><kbd>F</kbd> Frame</span>
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
                  <label className="node-field">
                    <span>Color</span>
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

export const modelForgePlugin = defineFeatherPlugin({
  id: PLUGIN_ID,
  name: 'Model Forge',
  version: '1.1.0',
  description:
    'A Blender-inspired in-engine modeler with Object, Edit, and Paint workflows, vertex/edge/face box-cage shaping, starter props, live-linked copies, and GLB baking.',
  apiVersion: '0.2.0',
  activate(api) {
    api.panels.register({
      id: PANEL_ID,
      title: 'Model Forge',
      // A library + 3D gizmo canvas + part inspector needs Tree-Builder width, so it docks below the viewport.
      placement: { referencePanel: 'viewport', direction: 'below' },
      render: () => <ModelForgePanel api={api} />,
    });

    api.commands.register({
      id: `${PLUGIN_ID}.open`,
      title: 'Open Model Forge (prototype modeler)',
      group: 'Extensions',
      keywords: 'model prop prototype blockout kitbash paint fence crate mesh',
      run: () => {
        if (!api.panels.open(PANEL_ID)) api.ui.notify('The editor workspace is not ready yet.', 'error');
      },
    });

    api.commands.register({
      id: `${PLUGIN_ID}.new-prop`,
      title: 'New prototype prop (Model Forge)',
      group: 'Extensions',
      keywords: 'model prop new crate starter',
      run: () => {
        api.models.createFromStarter('crate');
        if (!api.panels.open(PANEL_ID)) api.ui.notify('The editor workspace is not ready yet.', 'error');
      },
    });

    api.log.info('Activated');
    return () => api.log.info('Deactivated');
  },
});
