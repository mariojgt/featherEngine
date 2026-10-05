import { useEffect, useMemo, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { TransformControls } from '@react-three/drei';
import type { TransformControls as TransformControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import type { ModelAxis, ModelMeshOp, ModelMeshOpResult, ModelPart, ModelPartMesh, ModelStyle, Vector3Tuple } from '../types';
import { buildTopology, edgeKey, ensurePolyMesh, makePolyMesh, meshFaces, polygonNormal, triangulateFaces } from '../model/polyMesh';
import { proportionalWeights, selectEdgeLoop, selectFaceLoop, symmetryMap, type ProportionalFalloff } from '../model/meshOps';
import { evaluateModifiers } from '../model/meshModifiers';
import { buildRenderArrays } from '../model/meshRenderArrays';
import { getStyledMaterial, partSmoothAngle } from '../model/modelGeometry';
import { previewModelMeshOp } from '../store/editor/modelMeshActions';
import { DEFAULT_MESH } from '../model/modelMesh';

/**
 * Model Forge Edit mode for MESH parts — the Blender edit-mesh workflow on the polygon cage.
 *
 * - Picking: an invisible pick surface over the cage resolves clicks to the polygon under the cursor,
 *   then to its nearest vertex/edge in SCREEN space (what the eye expects). Shift toggles, Alt picks
 *   the whole edge/face loop.
 * - Modal tools (started by the panel's keyboard shortcuts): G/R/S transform with X/Y/Z axis locks
 *   (part-local axes), typed values, snapping, proportional editing (mouse wheel = radius) and X-mirror
 *   symmetry; E/I/Ctrl+B/Ctrl+R extrude, inset, bevel and loop cut with a live preview computed by the
 *   same pure op the store commits. LMB/Enter confirms, RMB/Esc cancels.
 * - Every commit is ONE store op (setVertices or the tool's op) → one undo step.
 *
 * Everything renders inside the part's transform group, so geometry stays in unit space.
 */

export type MeshComponentMode = 'vertex' | 'edge' | 'face';

export interface MeshSelection {
  vertices: number[];
  edges: Array<[number, number]>;
  faces: number[];
}

export const EMPTY_MESH_SELECTION: MeshSelection = { vertices: [], edges: [], faces: [] };

export type MeshModalKind = 'grab' | 'rotate' | 'scale' | 'extrude' | 'inset' | 'bevel' | 'loopcut' | 'box' | 'knife';

export interface MeshModalRequest {
  kind: MeshModalKind;
  nonce: number;
}

export interface MeshToolSettings {
  proportional: boolean;
  proportionalRadius: number;
  falloff: ProportionalFalloff;
  symmetry: ModelAxis[];
  snap: boolean;
  /** See-through editing: back-facing components are visible and selectable (Blender Alt+Z). */
  xray: boolean;
}

const ACCENT = '#5b8cff';
const PREVIEW = '#ffd23f';
const ignoreRaycast = () => null;

/** Every vertex the selection touches, whatever the component mode. */
export function selectionVertices(mesh: ModelPartMesh, mode: MeshComponentMode, selection: MeshSelection): number[] {
  if (mode === 'vertex') return selection.vertices;
  if (mode === 'edge') return [...new Set(selection.edges.flat())];
  const faces = meshFaces(mesh);
  return [...new Set(selection.faces.flatMap((face) => faces[face] ?? []))];
}

const sanitizeSelection = (mesh: ModelPartMesh, selection: MeshSelection): MeshSelection => {
  const faces = meshFaces(mesh);
  const topology = buildTopology({ vertices: mesh.vertices, faces });
  return {
    vertices: selection.vertices.filter((index) => index >= 0 && index < mesh.vertices.length),
    edges: selection.edges.filter(([a, b]) => topology.edgeIndex.has(edgeKey(a, b))),
    faces: selection.faces.filter((index) => index >= 0 && index < faces.length),
  };
};

interface ActiveModal {
  kind: MeshModalKind;
  axis: ModelAxis | 'normal' | null;
  typed: string;
  startClient: { x: number; y: number };
  /** Grab/extrude: where the pointer ray first hit the view plane through the pivot. */
  startHit: THREE.Vector3 | null;
  loopCuts: number;
}

export interface MeshEditOverlayProps {
  part: ModelPart;
  palette: readonly string[];
  style?: ModelStyle;
  mode: MeshComponentMode;
  selection: MeshSelection;
  settings: MeshToolSettings;
  gizmoMode: 'translate' | 'rotate' | 'scale';
  modalRequest: MeshModalRequest | null;
  onSelectionChange: (selection: MeshSelection) => void;
  onCommitPositions: (positions: Array<[number, Vector3Tuple]>) => void;
  onCommitOp: (op: ModelMeshOp) => ModelMeshOpResult;
  onModalChange: (label: string | null) => void;
  onPreviewChange: (previewing: boolean) => void;
  onProportionalRadiusChange: (radius: number) => void;
  gizmoActive: { current: boolean };
  onGizmoStart: (commit: () => void) => void;
  onGizmoEnd: () => void;
}

export function MeshEditOverlay({
  part,
  palette,
  style,
  mode,
  selection: rawSelection,
  settings,
  gizmoMode,
  modalRequest,
  onSelectionChange,
  onCommitPositions,
  onCommitOp,
  onModalChange,
  onPreviewChange,
  onProportionalRadiusChange,
  gizmoActive,
  onGizmoStart,
  onGizmoEnd,
}: MeshEditOverlayProps) {
  const { camera, gl } = useThree();
  const mesh = useMemo(() => ensurePolyMesh(part.mesh ?? DEFAULT_MESH), [part.mesh]);
  const faces = useMemo(() => meshFaces(mesh), [mesh]);
  const topology = useMemo(() => buildTopology({ vertices: mesh.vertices, faces }), [mesh, faces]);
  const selection = useMemo(() => sanitizeSelection(mesh, rawSelection), [mesh, rawSelection]);
  const selectedVerts = useMemo(() => selectionVertices(mesh, mode, selection), [mesh, mode, selection]);

  const matrix = useMemo(
    () => new THREE.Matrix4().compose(
      new THREE.Vector3(...part.position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...part.rotation)),
      new THREE.Vector3(...part.scale),
    ),
    [part.position, part.rotation, part.scale],
  );
  const inverse = useMemo(() => matrix.clone().invert(), [matrix]);
  const worldOf = (index: number, vertices: readonly Vector3Tuple[] = mesh.vertices) =>
    new THREE.Vector3(...vertices[index]).applyMatrix4(matrix);

  const pivotWorld = useMemo(() => {
    const center = new THREE.Vector3();
    selectedVerts.forEach((index) => center.add(new THREE.Vector3(...mesh.vertices[index])));
    if (selectedVerts.length) center.multiplyScalar(1 / selectedVerts.length);
    return center.applyMatrix4(matrix);
  }, [selectedVerts, mesh, matrix]);

  // ---------------------------------------------------------------------------------------------
  // Pointer tracking (modal tools start from the pointer's current position)
  // ---------------------------------------------------------------------------------------------
  const pointer = useRef({ x: 0, y: 0 });
  useEffect(() => {
    const element = gl.domElement;
    const move = (event: PointerEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY };
    };
    element.addEventListener('pointermove', move);
    return () => element.removeEventListener('pointermove', move);
  }, [gl]);

  const toNdc = (clientX: number, clientY: number) => {
    const rect = gl.domElement.getBoundingClientRect();
    return new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  };
  const toScreen = (world: THREE.Vector3) => {
    const rect = gl.domElement.getBoundingClientRect();
    const projected = world.clone().project(camera);
    return new THREE.Vector2(rect.left + ((projected.x + 1) / 2) * rect.width, rect.top + ((1 - projected.y) / 2) * rect.height);
  };
  const viewPlaneHit = (clientX: number, clientY: number, through: THREE.Vector3): THREE.Vector3 | null => {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(toNdc(clientX, clientY), camera);
    const normal = camera.getWorldDirection(new THREE.Vector3());
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, through);
    return raycaster.ray.intersectPlane(plane, new THREE.Vector3());
  };
  /** World length of one screen pixel at the pivot's depth — maps mouse travel to tool values. */
  const worldPerPixel = () => {
    const a = toScreen(pivotWorld);
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    const b = toScreen(pivotWorld.clone().add(right));
    return 1 / Math.max(1e-6, a.distanceTo(b));
  };
  const meanScale = (Math.abs(part.scale[0]) + Math.abs(part.scale[1]) + Math.abs(part.scale[2])) / 3 || 1;

  // ---------------------------------------------------------------------------------------------
  // Shared transform pipeline: world-space point mapping → proportional blend → symmetry → local
  // ---------------------------------------------------------------------------------------------
  const symmetryMaps = useMemo(
    () => settings.symmetry.map((axis) => ({ axis, map: symmetryMap(mesh, axis, 1e-3) })),
    [mesh, settings.symmetry],
  );
  const weights = useMemo(() => {
    if (!settings.proportional) return new Map(selectedVerts.map((index) => [index, 1]));
    return proportionalWeights(mesh, selectedVerts, settings.proportionalRadius / meanScale, settings.falloff);
  }, [mesh, selectedVerts, settings.proportional, settings.proportionalRadius, settings.falloff, meanScale]);

  const positionsFor = (mapPoint: (world: THREE.Vector3) => THREE.Vector3): Array<[number, Vector3Tuple]> => {
    const next = new Map<number, Vector3Tuple>();
    weights.forEach((weight, index) => {
      const world = worldOf(index);
      const moved = mapPoint(world.clone());
      const blended = world.lerp(moved, weight).applyMatrix4(inverse);
      next.set(index, [blended.x, blended.y, blended.z]);
    });
    for (const { axis, map } of symmetryMaps) {
      const component = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
      for (const [index, position] of [...next]) {
        const counterpart = map[index];
        if (counterpart === index) {
          // On the mirror plane: stay on it.
          next.set(index, position.map((value, k) => (k === component ? mesh.vertices[index][k] : value)) as Vector3Tuple);
        } else if (counterpart >= 0 && !weights.has(counterpart)) {
          next.set(counterpart, position.map((value, k) => (k === component ? -value : value)) as Vector3Tuple);
        }
      }
    }
    return [...next].map(([index, position]) => [index, position.map((value) => Math.round(value * 1e5) / 1e5) as Vector3Tuple]);
  };

  const localAxisWorld = (axis: ModelAxis | 'normal'): THREE.Vector3 => {
    if (axis === 'normal') {
      const normal = new THREE.Vector3();
      const sourceFaces = mode === 'face' && selection.faces.length
        ? selection.faces
        : faces.map((_, index) => index).filter((index) => faces[index].every((vertex) => selectedVerts.includes(vertex)));
      sourceFaces.forEach((face) => normal.add(new THREE.Vector3(...polygonNormal(mesh.vertices, faces[face]))));
      if (normal.lengthSq() < 1e-9) normal.set(0, 1, 0);
      return normal.transformDirection(matrix).normalize();
    }
    const local = new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0);
    return local.transformDirection(matrix).normalize();
  };

  // ---------------------------------------------------------------------------------------------
  // Modal state
  // ---------------------------------------------------------------------------------------------
  const [modal, setModal] = useState<ActiveModal | null>(null);
  const [preview, setPreview] = useState<{ mesh: ModelPartMesh; lines?: Float32Array } | null>(null);
  const [hoverEdge, setHoverEdge] = useState<[number, number] | null>(null);
  const modalRef = useRef<ActiveModal | null>(null);
  modalRef.current = modal;

  useEffect(() => {
    onPreviewChange((!!preview && modal?.kind !== 'loopcut') || settings.xray);
  }, [preview, modal, settings.xray, onPreviewChange]);

  // Start a modal when the panel asks for one.
  const lastNonce = useRef(0);
  useEffect(() => {
    if (!modalRequest || modalRequest.nonce === lastNonce.current) return;
    lastNonce.current = modalRequest.nonce;
    const kind = modalRequest.kind;
    if (kind !== 'loopcut' && kind !== 'box' && kind !== 'knife' && !selectedVerts.length) {
      onModalChange(null);
      return;
    }
    if ((kind === 'extrude' || kind === 'inset') && mode !== 'face') {
      onModalChange(null);
      return;
    }
    if (kind === 'bevel' && !(mode === 'edge' ? selection.edges.length : selectedVerts.length > 1)) {
      onModalChange(null);
      return;
    }
    const start = { ...pointer.current };
    setModal({
      kind,
      axis: kind === 'extrude' ? 'normal' : null,
      typed: '',
      startClient: start,
      startHit: viewPlaneHit(start.x, start.y, pivotWorld),
      loopCuts: 1,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalRequest]);

  const modalLabel = (state: ActiveModal | null, value?: string) => {
    if (!state) return null;
    const names: Record<MeshModalKind, string> = {
      grab: 'Move', rotate: 'Rotate', scale: 'Scale', extrude: 'Extrude', inset: 'Inset', bevel: 'Bevel', loopcut: 'Loop Cut',
      box: 'Box Select', knife: 'Knife',
    };
    if (state.kind === 'box') return 'Box Select — drag a rectangle (Shift adds, Ctrl subtracts), Esc/RMB cancel';
    if (state.kind === 'knife') return 'Knife — drag a line across the faces to cut, Esc/RMB cancel';
    const axis = state.axis ? ` along ${state.axis.toUpperCase()}` : '';
    const extra = state.kind === 'loopcut' ? ` · ${state.loopCuts} cut${state.loopCuts === 1 ? '' : 's'} (wheel)` : '';
    const prop = settings.proportional && (state.kind === 'grab' || state.kind === 'rotate' || state.kind === 'scale')
      ? ` · proportional ${settings.proportionalRadius.toFixed(2)} (wheel)`
      : '';
    return `${names[state.kind]}${axis}${value ? `: ${value}` : ''}${extra}${prop} — LMB/Enter confirm, RMB/Esc cancel${state.kind !== 'loopcut' ? ', X/Y/Z axis, type a value' : ''}`;
  };

  /** Compute the modal's live result for a pointer position. */
  const evaluateModal = (state: ActiveModal, clientX: number, clientY: number):
    | { kind: 'positions'; positions: Array<[number, Vector3Tuple]>; label: string }
    | { kind: 'op'; op: ModelMeshOp; mesh: ModelPartMesh; label: string }
    | null => {
    const typedValue = state.typed && state.typed !== '-' ? Number(state.typed) : null;
    const pivotScreen = toScreen(pivotWorld);
    const start = new THREE.Vector2(state.startClient.x, state.startClient.y);
    const current = new THREE.Vector2(clientX, clientY);
    if (state.kind === 'grab' || state.kind === 'extrude') {
      const hit = viewPlaneHit(clientX, clientY, pivotWorld);
      let offset = hit && state.startHit ? hit.clone().sub(state.startHit) : new THREE.Vector3();
      if (state.axis) {
        const axis = localAxisWorld(state.axis);
        let amount = typedValue ?? offset.dot(axis);
        if (settings.snap && typedValue === null) amount = Math.round(amount / 0.05) * 0.05;
        offset = axis.multiplyScalar(amount);
      } else if (settings.snap) {
        offset.set(Math.round(offset.x / 0.05) * 0.05, Math.round(offset.y / 0.05) * 0.05, Math.round(offset.z / 0.05) * 0.05);
      }
      if (state.kind === 'extrude') {
        const normal = localAxisWorld('normal');
        const viewDot = Math.abs(normal.dot(camera.getWorldDirection(new THREE.Vector3())));
        // Facing the camera, a drag can't travel along the normal — use vertical mouse travel instead.
        let worldDistance = viewDot > 0.9
          ? (typedValue ?? (start.y - current.y) * worldPerPixel())
          : offset.length() * Math.sign(offset.dot(normal) || 1);
        if (settings.snap && typedValue === null) worldDistance = Math.round(worldDistance / 0.05) * 0.05;
        const distance = worldDistance / meanScale;
        const op: ModelMeshOp = { type: 'extrude', faces: selection.faces, distance };
        const previewed = previewModelMeshOp(part, op);
        return previewed ? { kind: 'op', op, mesh: previewed.mesh, label: (distance * meanScale).toFixed(3) } : null;
      }
      return { kind: 'positions', positions: positionsFor((world) => world.add(offset)), label: offset.length().toFixed(3) };
    }
    if (state.kind === 'rotate') {
      const a0 = Math.atan2(start.y - pivotScreen.y, start.x - pivotScreen.x);
      const a1 = Math.atan2(current.y - pivotScreen.y, current.x - pivotScreen.x);
      let angle = typedValue !== null ? (typedValue * Math.PI) / 180 : -(a1 - a0);
      if (settings.snap && typedValue === null) angle = Math.round(angle / (Math.PI / 12)) * (Math.PI / 12);
      const toCamera = camera.position.clone().sub(pivotWorld).normalize();
      let axis = state.axis ? localAxisWorld(state.axis) : toCamera;
      if (state.axis && axis.dot(toCamera) < 0) axis = axis.negate();
      const rotation = new THREE.Quaternion().setFromAxisAngle(axis, angle);
      return {
        kind: 'positions',
        positions: positionsFor((world) => world.sub(pivotWorld).applyQuaternion(rotation).add(pivotWorld)),
        label: `${((angle * 180) / Math.PI).toFixed(1)}°`,
      };
    }
    if (state.kind === 'scale') {
      let factor = typedValue ?? current.distanceTo(pivotScreen) / Math.max(1, start.distanceTo(pivotScreen));
      if (settings.snap && typedValue === null) factor = Math.round(factor / 0.1) * 0.1;
      const axis = state.axis ? localAxisWorld(state.axis) : null;
      return {
        kind: 'positions',
        positions: positionsFor((world) => {
          const relative = world.sub(pivotWorld);
          if (axis) relative.add(axis.clone().multiplyScalar(relative.dot(axis) * (factor - 1)));
          else relative.multiplyScalar(factor);
          return relative.add(pivotWorld);
        }),
        label: `×${factor.toFixed(2)}`,
      };
    }
    if (state.kind === 'inset' || state.kind === 'bevel') {
      const travel = (current.distanceTo(pivotScreen) - start.distanceTo(pivotScreen)) * worldPerPixel();
      const base = state.kind === 'inset' ? 0.05 : 0.04;
      let amount = typedValue ?? Math.max(0.001, base + travel);
      if (settings.snap && typedValue === null) amount = Math.max(0.005, Math.round(amount / 0.005) * 0.005);
      const unit = amount / meanScale;
      const op: ModelMeshOp = state.kind === 'inset'
        ? { type: 'inset', faces: selection.faces, thickness: unit }
        : {
            type: 'bevel',
            edges: mode === 'edge'
              ? selection.edges
              : topology.edges.filter(([a, b]) => selectedVerts.includes(a) && selectedVerts.includes(b)),
            width: unit,
            segments: state.loopCuts,
          };
      const previewed = previewModelMeshOp(part, op);
      return previewed ? { kind: 'op', op, mesh: previewed.mesh, label: amount.toFixed(3) } : null;
    }
    return null;
  };

  // Live modal: pointer + keyboard + wheel listeners while a modal runs.
  useEffect(() => {
    if (!modal) {
      setPreview(null);
      onModalChange(null);
      return;
    }
    if (modal.kind === 'box' || modal.kind === 'knife') return; // handled by the drag-tool effect below
    let latest: ReturnType<typeof evaluateModal> = null;
    const refresh = (clientX = pointer.current.x, clientY = pointer.current.y) => {
      const state = modalRef.current;
      if (!state || state.kind === 'loopcut') {
        onModalChange(modalLabel(state));
        return;
      }
      latest = evaluateModal(state, clientX, clientY);
      if (!latest) return;
      if (latest.kind === 'positions') {
        const vertices = mesh.vertices.map((vertex) => [...vertex] as Vector3Tuple);
        latest.positions.forEach(([index, position]) => {
          vertices[index] = position;
        });
        setPreview({ mesh: makePolyMesh(vertices, faces, { faceSlots: mesh.faceSlots, faceUVs: mesh.faceUVs, sharpEdges: mesh.sharpEdges }) });
      } else {
        setPreview({ mesh: latest.mesh });
      }
      onModalChange(modalLabel(state, latest.label));
    };
    const finish = (confirm: boolean) => {
      const state = modalRef.current;
      if (confirm && state && state.kind !== 'loopcut') {
        const result = latest ?? evaluateModal(state, pointer.current.x, pointer.current.y);
        const zeroExtrude = result?.kind === 'op' && result.op.type === 'extrude' && Math.abs(result.op.distance ?? 0) < 1e-4;
        if (result?.kind === 'positions' && result.positions.length) onCommitPositions(result.positions);
        else if (result?.kind === 'op' && !zeroExtrude) onCommitOp(result.op);
      }
      setModal(null);
    };
    const onMove = (event: PointerEvent) => refresh(event.clientX, event.clientY);
    const onDown = (event: PointerEvent) => {
      if (modalRef.current?.kind === 'loopcut') {
        // The pick surface commits loop cuts on LMB; any other button cancels.
        if (event.button !== 0) {
          event.preventDefault();
          event.stopPropagation();
          finish(false);
        }
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      finish(event.button === 0);
    };
    const onContext = (event: MouseEvent) => event.preventDefault();
    const onKey = (event: KeyboardEvent) => {
      const state = modalRef.current;
      if (!state) return;
      const key = event.key.toLowerCase();
      let handled = true;
      if (key === 'escape') finish(false);
      else if (key === 'enter') finish(true);
      else if ((key === 'x' || key === 'y' || key === 'z') && state.kind !== 'loopcut' && state.kind !== 'extrude') {
        setModal({ ...state, axis: state.axis === key ? null : key });
      } else if (/^[0-9.]$/.test(key) || (key === '-' && !state.typed)) {
        setModal({ ...state, typed: state.typed + key });
      } else if (key === 'backspace') {
        setModal({ ...state, typed: state.typed.slice(0, -1) });
      } else handled = false;
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const onWheel = (event: WheelEvent) => {
      const state = modalRef.current;
      if (!state) return;
      event.preventDefault();
      event.stopPropagation();
      const step = event.deltaY < 0 ? 1 : -1;
      if (state.kind === 'loopcut' || state.kind === 'bevel') {
        setModal({ ...state, loopCuts: Math.min(16, Math.max(1, state.loopCuts + step)) });
      } else if (settings.proportional) {
        onProportionalRadiusChange(Math.max(0.05, settings.proportionalRadius * (step > 0 ? 1.15 : 1 / 1.15)));
      }
    };
    refresh();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('contextmenu', onContext, true);
    window.addEventListener('keydown', onKey, true);
    gl.domElement.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('contextmenu', onContext, true);
      window.removeEventListener('keydown', onKey, true);
      gl.domElement.removeEventListener('wheel', onWheel, true);
    };
    // Re-bind whenever the modal state or anything evaluateModal reads changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal, mesh, weights, symmetryMaps, settings, matrix]);

  // Loop-cut preview follows the hovered edge.
  useEffect(() => {
    if (modal?.kind !== 'loopcut' || !hoverEdge) {
      if (modal?.kind === 'loopcut') setPreview(null);
      return;
    }
    const previewed = previewModelMeshOp(part, { type: 'loopCut', edge: hoverEdge, cuts: modal.loopCuts });
    if (!previewed?.result.ok || !previewed.result.edges) {
      setPreview(null);
      return;
    }
    const lines = new Float32Array(previewed.result.edges.flatMap(([a, b]) => [...previewed.mesh.vertices[a], ...previewed.mesh.vertices[b]]));
    setPreview({ mesh: previewed.mesh, lines });
  }, [modal, hoverEdge, part]);

  // ---------------------------------------------------------------------------------------------
  // Picking
  // ---------------------------------------------------------------------------------------------
  const pick = useMemo(() => {
    const { indices, triangleFaces } = triangulateFaces(mesh.vertices, faces);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.vertices.flat(), 3));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    return { geometry, triangleFaces };
  }, [mesh, faces]);
  useEffect(() => () => pick.geometry.dispose(), [pick]);

  const screenDistanceToSegment = (point: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2) => {
    const ab = b.clone().sub(a);
    const t = Math.min(1, Math.max(0, point.clone().sub(a).dot(ab) / Math.max(1e-9, ab.lengthSq())));
    return point.distanceTo(a.clone().add(ab.multiplyScalar(t)));
  };

  const resolveHit = (event: ThreeEvent<PointerEvent>) => {
    const triangle = event.faceIndex ?? -1;
    const face = triangle >= 0 ? pick.triangleFaces[triangle] : -1;
    if (face < 0) return null;
    const loop = faces[face];
    const cursor = new THREE.Vector2(event.nativeEvent.clientX, event.nativeEvent.clientY);
    let vertex = loop[0];
    let best = Infinity;
    for (const index of loop) {
      const distance = toScreen(worldOf(index)).distanceTo(cursor);
      if (distance < best) {
        best = distance;
        vertex = index;
      }
    }
    let edge: [number, number] = [loop[0], loop[1]];
    best = Infinity;
    loop.forEach((a, corner) => {
      const b = loop[(corner + 1) % loop.length];
      const distance = screenDistanceToSegment(cursor, toScreen(worldOf(a)), toScreen(worldOf(b)));
      if (distance < best) {
        best = distance;
        edge = a < b ? [a, b] : [b, a];
      }
    });
    return { face, vertex, edge };
  };

  const handlePickDown = (event: ThreeEvent<PointerEvent>) => {
    if (event.nativeEvent.button !== 0 || gizmoActive.current) return;
    if (settings.xray && modalRef.current?.kind !== 'loopcut') return; // X-ray picks in screen space
    event.stopPropagation();
    const hit = resolveHit(event);
    if (!hit) return;
    if (modalRef.current?.kind === 'loopcut') {
      const result = onCommitOp({ type: 'loopCut', edge: hit.edge, cuts: modalRef.current.loopCuts });
      if (result.ok) setModal(null);
      return;
    }
    applyPick(hit, event.nativeEvent.shiftKey, event.nativeEvent.altKey);
  };

  const applyPick = (hit: { face: number; vertex: number; edge: [number, number] }, additive: boolean, loop: boolean) => {
    const toggle = <T,>(list: T[], items: T[], same: (a: T, b: T) => boolean): T[] => {
      if (!additive) return items;
      const allIn = items.every((item) => list.some((entry) => same(entry, item)));
      return allIn ? list.filter((entry) => !items.some((item) => same(entry, item))) : [...list, ...items.filter((item) => !list.some((entry) => same(entry, item)))];
    };
    const sameEdge = (a: [number, number], b: [number, number]) => a[0] === b[0] && a[1] === b[1];
    if (mode === 'vertex') {
      const picked = loop ? [...new Set(selectEdgeLoop(mesh, hit.edge).flat())] : [hit.vertex];
      onSelectionChange({ ...selection, vertices: toggle(selection.vertices, picked, (a, b) => a === b) });
    } else if (mode === 'edge') {
      const picked = loop ? selectEdgeLoop(mesh, hit.edge) : [hit.edge];
      onSelectionChange({ ...selection, edges: toggle(selection.edges, picked, sameEdge) });
    } else {
      const picked = loop ? selectFaceLoop(mesh, hit.edge) : [hit.face];
      onSelectionChange({ ...selection, faces: toggle(selection.faces, picked.length ? picked : [hit.face], (a, b) => a === b) });
    }
  };

  // ---------------------------------------------------------------------------------------------
  // Screen-space queries: X-ray picking, box select and the knife all work on projected components.
  // ---------------------------------------------------------------------------------------------
  const pickRef = useRef<THREE.Mesh | null>(null);
  const occlusionRay = useMemo(() => new THREE.Raycaster(), []);
  /** True when nothing on the cage sits between the camera and this world point (always true in X-ray). */
  const isVisible = (world: THREE.Vector3) => {
    if (settings.xray || !pickRef.current) return true;
    const direction = world.clone().sub(camera.position);
    const distance = direction.length();
    occlusionRay.set(camera.position, direction.normalize());
    occlusionRay.far = distance;
    const hit = occlusionRay.intersectObject(pickRef.current, false)[0];
    return !hit || hit.distance >= distance - Math.max(1e-3, distance * 2e-3);
  };
  const faceCenterWorld = (face: number) => {
    const loop = faces[face];
    const center = new THREE.Vector3();
    loop.forEach((index) => center.add(new THREE.Vector3(...mesh.vertices[index])));
    return center.multiplyScalar(1 / loop.length).applyMatrix4(matrix);
  };
  const faceFacesCamera = (face: number) => {
    const normal = new THREE.Vector3(...polygonNormal(mesh.vertices, faces[face])).transformDirection(matrix);
    return normal.dot(camera.position.clone().sub(faceCenterWorld(face))) > 0;
  };

  /** Nearest component to a screen point, ignoring occlusion (X-ray click picking). */
  const screenPick = (clientX: number, clientY: number) => {
    const cursor = new THREE.Vector2(clientX, clientY);
    const projected = mesh.vertices.map((_, index) => toScreen(worldOf(index)));
    let vertex = -1;
    let vertexDistance = 14;
    projected.forEach((point, index) => {
      const distance = point.distanceTo(cursor);
      if (distance < vertexDistance) {
        vertexDistance = distance;
        vertex = index;
      }
    });
    let edge: [number, number] | null = null;
    let edgeDistance = 10;
    topology.edges.forEach(([a, b]) => {
      const distance = screenDistanceToSegment(cursor, projected[a], projected[b]);
      if (distance < edgeDistance) {
        edgeDistance = distance;
        edge = [a, b];
      }
    });
    let face = -1;
    let faceDistance = Infinity;
    faces.forEach((loop, index) => {
      // Point-in-polygon on the projected loop (even-odd), then prefer the face whose center is closest.
      let inside = false;
      for (let i = 0, j = loop.length - 1; i < loop.length; j = i, i += 1) {
        const pi = projected[loop[i]];
        const pj = projected[loop[j]];
        if ((pi.y > cursor.y) !== (pj.y > cursor.y) && cursor.x < ((pj.x - pi.x) * (cursor.y - pi.y)) / (pj.y - pi.y + 1e-9) + pi.x) inside = !inside;
      }
      if (!inside) return;
      const distance = toScreen(faceCenterWorld(index)).distanceTo(cursor);
      if (distance < faceDistance) {
        faceDistance = distance;
        face = index;
      }
    });
    if (face < 0 && vertex < 0 && !edge) return null;
    const fallbackFace = face >= 0 ? face : topology.vertexFaces[vertex >= 0 ? vertex : (edge as [number, number] | null)?.[0] ?? 0]?.[0] ?? 0;
    const loop = faces[fallbackFace];
    return {
      face: fallbackFace,
      vertex: vertex >= 0 ? vertex : loop[0],
      edge: edge ?? ((loop[0] < loop[1] ? [loop[0], loop[1]] : [loop[1], loop[0]]) as [number, number]),
      hitKind: mode === 'vertex' ? vertex >= 0 : mode === 'edge' ? !!edge : face >= 0,
    };
  };

  // X-ray click picking: a stationary left click on the canvas (orbit drags are ignored).
  useEffect(() => {
    if (!settings.xray) return;
    const element = gl.domElement;
    let down: { x: number; y: number } | null = null;
    const onDown = (event: PointerEvent) => {
      down = event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
    };
    const onUp = (event: PointerEvent) => {
      if (!down || event.button !== 0 || modalRef.current || gizmoActive.current) return;
      const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
      down = null;
      if (moved > 5) return;
      const hit = screenPick(event.clientX, event.clientY);
      if (hit?.hitKind) applyPick(hit, event.shiftKey, event.altKey);
      else if (!event.shiftKey) onSelectionChange(EMPTY_MESH_SELECTION);
    };
    element.addEventListener('pointerdown', onDown);
    element.addEventListener('pointerup', onUp);
    return () => {
      element.removeEventListener('pointerdown', onDown);
      element.removeEventListener('pointerup', onUp);
    };
  });

  // Drag tools: box select (B) and knife (K). They own the next left-drag; the rest of the canvas
  // (orbit controls) never sees it because the listeners run in the window capture phase.
  useEffect(() => {
    if (modal?.kind !== 'box' && modal?.kind !== 'knife') return;
    const kind = modal.kind;
    onModalChange(modalLabel(modal));
    const overlay = document.createElement('div');
    overlay.className = kind === 'box' ? 'model-forge-box-select' : 'model-forge-knife-line';
    overlay.style.display = 'none';
    document.body.appendChild(overlay);
    let start: { x: number; y: number; additive: boolean; subtract: boolean } | null = null;
    const draw = (x: number, y: number) => {
      if (!start) return;
      overlay.style.display = 'block';
      if (kind === 'box') {
        overlay.style.left = `${Math.min(start.x, x)}px`;
        overlay.style.top = `${Math.min(start.y, y)}px`;
        overlay.style.width = `${Math.abs(x - start.x)}px`;
        overlay.style.height = `${Math.abs(y - start.y)}px`;
      } else {
        const length = Math.hypot(x - start.x, y - start.y);
        overlay.style.left = `${start.x}px`;
        overlay.style.top = `${start.y}px`;
        overlay.style.width = `${length}px`;
        overlay.style.transform = `rotate(${Math.atan2(y - start.y, x - start.x)}rad)`;
      }
    };
    const cancel = () => setModal(null);
    const onDown = (event: PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.button !== 0) {
        cancel();
        return;
      }
      start = { x: event.clientX, y: event.clientY, additive: event.shiftKey, subtract: event.ctrlKey || event.metaKey };
    };
    const onMove = (event: PointerEvent) => {
      if (!start) return;
      event.stopPropagation();
      draw(event.clientX, event.clientY);
    };
    const onUp = (event: PointerEvent) => {
      if (!start) return;
      event.preventDefault();
      event.stopPropagation();
      const from = start;
      start = null;
      if (kind === 'box') finishBox(from, { x: event.clientX, y: event.clientY });
      else finishKnife(from, { x: event.clientX, y: event.clientY });
      setModal(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        cancel();
      }
    };
    const onContext = (event: MouseEvent) => event.preventDefault();
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('contextmenu', onContext, true);
    return () => {
      overlay.remove();
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('contextmenu', onContext, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal]);

  const finishBox = (from: { x: number; y: number; additive: boolean; subtract: boolean }, to: { x: number; y: number }) => {
    const minX = Math.min(from.x, to.x);
    const maxX = Math.max(from.x, to.x);
    const minY = Math.min(from.y, to.y);
    const maxY = Math.max(from.y, to.y);
    if (maxX - minX < 3 && maxY - minY < 3) return;
    const inside = (point: THREE.Vector2) => point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
    const visibleVertex = new Map<number, boolean>();
    const vertexIn = (index: number) => {
      if (!inside(toScreen(worldOf(index)))) return false;
      let visible = visibleVertex.get(index);
      if (visible === undefined) {
        visible = isVisible(worldOf(index));
        visibleVertex.set(index, visible);
      }
      return visible;
    };
    const combine = <T,>(current: T[], picked: T[], key: (item: T) => string): T[] => {
      if (from.subtract) {
        const remove = new Set(picked.map(key));
        return current.filter((item) => !remove.has(key(item)));
      }
      if (!from.additive) return picked;
      const seen = new Set(current.map(key));
      return [...current, ...picked.filter((item) => !seen.has(key(item)))];
    };
    if (mode === 'vertex') {
      const picked = mesh.vertices.map((_, index) => index).filter(vertexIn);
      onSelectionChange({ ...selection, vertices: combine(selection.vertices, picked, String) });
    } else if (mode === 'edge') {
      const picked = topology.edges.filter(([a, b]) => vertexIn(a) && vertexIn(b));
      onSelectionChange({ ...selection, edges: combine(selection.edges, picked, (edge) => `${edge[0]}:${edge[1]}`) });
    } else {
      const picked = faces.map((_, index) => index).filter((face) => {
        const center = faceCenterWorld(face);
        if (!inside(toScreen(center))) return false;
        if (settings.xray) return true;
        return faceFacesCamera(face) && isVisible(center);
      });
      onSelectionChange({ ...selection, faces: combine(selection.faces, picked, String) });
    }
  };

  const finishKnife = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    if (Math.hypot(to.x - from.x, to.y - from.y) < 4) return;
    // The cut plane contains the eye and both ends of the drawn line; build it in part-local space so
    // non-uniform part scale is handled (planes map to planes under affine transforms).
    const rayPoint = (x: number, y: number) => {
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(toNdc(x, y), camera);
      return raycaster.ray.at(Math.max(1, camera.position.distanceTo(pivotWorld.lengthSq() ? pivotWorld : new THREE.Vector3())), new THREE.Vector3());
    };
    const eye = camera.position.clone().applyMatrix4(inverse);
    const a = rayPoint(from.x, from.y).applyMatrix4(inverse);
    const b = rayPoint(to.x, to.y).applyMatrix4(inverse);
    const normal = a.clone().sub(eye).cross(b.clone().sub(eye)).normalize();
    if (normal.lengthSq() < 1e-12) return;
    const plane = { point: [eye.x, eye.y, eye.z] as Vector3Tuple, normal: [normal.x, normal.y, normal.z] as Vector3Tuple };
    // Only faces whose cut segment falls between the line's two ends on screen (and that are visible).
    const A = new THREE.Vector2(from.x, from.y);
    const AB = new THREE.Vector2(to.x - from.x, to.y - from.y);
    const lengthSq = AB.lengthSq();
    const side = (vertex: Vector3Tuple) => (vertex[0] - eye.x) * normal.x + (vertex[1] - eye.y) * normal.y + (vertex[2] - eye.z) * normal.z;
    const crossed = faces.map((_, index) => index).filter((face) => {
      if (!settings.xray && !faceFacesCamera(face)) return false;
      const loop = faces[face];
      const params: number[] = [];
      loop.forEach((va, corner) => {
        const vb = loop[(corner + 1) % loop.length];
        const da = side(mesh.vertices[va]);
        const db = side(mesh.vertices[vb]);
        if ((da > 0) === (db > 0)) return;
        const t = da / (da - db);
        const local = new THREE.Vector3(...mesh.vertices[va]).lerp(new THREE.Vector3(...mesh.vertices[vb]), t);
        const screen = toScreen(local.applyMatrix4(matrix));
        params.push(screen.clone().sub(A).dot(AB) / lengthSq);
      });
      if (params.length < 2) return false;
      return Math.max(...params) >= 0 && Math.min(...params) <= 1;
    });
    if (!crossed.length) return;
    onCommitOp({ type: 'knife', plane, faces: crossed });
  };

  const handlePickMove = (event: ThreeEvent<PointerEvent>) => {
    if (modalRef.current?.kind !== 'loopcut') return;
    const hit = resolveHit(event);
    if (hit && (!hoverEdge || hit.edge[0] !== hoverEdge[0] || hit.edge[1] !== hoverEdge[1])) setHoverEdge(hit.edge);
  };

  // ---------------------------------------------------------------------------------------------
  // Overlay geometry
  // ---------------------------------------------------------------------------------------------
  const shownMesh = preview && modal?.kind !== 'loopcut' ? preview.mesh : mesh;
  const shownFaces = useMemo(() => meshFaces(shownMesh), [shownMesh]);
  const shownTopology = useMemo(
    () => (shownMesh === mesh ? topology : buildTopology({ vertices: shownMesh.vertices, faces: shownFaces })),
    [shownMesh, shownFaces, mesh, topology],
  );
  const edgePositions = useMemo(
    () => new Float32Array(shownTopology.edges.flatMap(([a, b]) => [...shownMesh.vertices[a], ...shownMesh.vertices[b]])),
    [shownTopology, shownMesh],
  );
  const selectedEdgePositions = useMemo(() => {
    if (shownMesh !== mesh) return new Float32Array(0);
    const chosen = mode === 'edge'
      ? selection.edges
      : topology.edges.filter(([a, b]) => selectedVerts.includes(a) && selectedVerts.includes(b));
    return new Float32Array(chosen.flatMap(([a, b]) => [...mesh.vertices[a], ...mesh.vertices[b]]));
  }, [shownMesh, mesh, mode, selection, topology, selectedVerts]);
  const vertexPositions = useMemo(() => new Float32Array(shownMesh.vertices.flat()), [shownMesh]);
  const selectedVertexPositions = useMemo(
    () => new Float32Array(shownMesh === mesh ? selectedVerts.flatMap((index) => mesh.vertices[index]) : []),
    [shownMesh, mesh, selectedVerts],
  );
  const selectedFaceGeometry = useMemo(() => {
    if (shownMesh !== mesh || mode === 'edge') return null;
    const chosen = mode === 'face'
      ? selection.faces
      : faces.map((_, index) => index).filter((index) => faces[index].every((vertex) => selectedVerts.includes(vertex)));
    if (!chosen.length) return null;
    const { indices } = triangulateFaces(mesh.vertices, chosen.map((face) => faces[face]));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.vertices.flat(), 3));
    geometry.setIndex(indices);
    return geometry;
  }, [shownMesh, mesh, mode, selection, faces, selectedVerts]);
  useEffect(() => () => selectedFaceGeometry?.dispose(), [selectedFaceGeometry]);

  // The preview surface (modal transforms and op previews) — built directly so its GPU buffers can be
  // disposed per frame instead of filling the shared geometry cache with throwaway meshes.
  const previewSurface = useMemo(() => {
    const surfaceMesh = preview && modal?.kind !== 'loopcut' ? preview.mesh : settings.xray ? mesh : null;
    if (!surfaceMesh) return null;
    const evaluated = evaluateModifiers(surfaceMesh, part.modifiers);
    const arrays = buildRenderArrays(evaluated, { smoothAngle: partSmoothAngle(part, style), defaultSlot: part.colorSlot });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(arrays.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(arrays.normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(arrays.indices, 1));
    for (const group of arrays.groups) geometry.addGroup(group.start, group.count, group.slot);
    const maxSlot = Math.max(part.colorSlot, ...arrays.groups.map((group) => group.slot));
    // X-ray draws the surface see-through with its own (disposable) materials; the shared palette
    // materials must never be made transparent.
    const materials = Array.from({ length: maxSlot + 1 }, (_, slot) => {
      const color = palette[slot] ?? palette[part.colorSlot] ?? '#888888';
      return settings.xray
        ? new THREE.MeshStandardMaterial({ color, roughness: 0.6, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide })
        : getStyledMaterial(color, style, true);
    });
    return { geometry, materials, owned: settings.xray };
  }, [preview, modal, part, palette, style, settings.xray, mesh]);
  useEffect(() => () => {
    previewSurface?.geometry.dispose();
    if (previewSurface?.owned) previewSurface.materials.forEach((material) => material.dispose());
  }, [previewSurface]);

  // ---------------------------------------------------------------------------------------------
  // Gizmo (mouse alternative to G/R/S) — same pipeline, committed on release.
  // ---------------------------------------------------------------------------------------------
  const controlsRef = useRef<TransformControlsImpl | null>(null);
  const commitGizmo = () => {
    const target = (controlsRef.current as unknown as { object?: THREE.Object3D } | null)?.object;
    if (!target || !selectedVerts.length) return;
    const delta = new THREE.Matrix4().compose(target.position, target.quaternion, target.scale);
    const positions = positionsFor((world) => world.sub(pivotWorld).applyMatrix4(delta));
    if (positions.length) onCommitPositions(positions);
  };

  return (
    <>
      <group position={part.position} rotation={part.rotation} scale={part.scale}>
        {previewSurface && (
          <mesh geometry={previewSurface.geometry} material={previewSurface.materials} castShadow receiveShadow raycast={ignoreRaycast} />
        )}
        <mesh
          ref={pickRef}
          geometry={pick.geometry}
          onPointerDown={handlePickDown}
          onPointerMove={handlePickMove}
          onPointerOut={() => setHoverEdge(null)}
        >
          <meshBasicMaterial colorWrite={false} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
        {selectedFaceGeometry && (
          <mesh geometry={selectedFaceGeometry} raycast={ignoreRaycast} renderOrder={2}>
            <meshBasicMaterial color={ACCENT} transparent opacity={0.32} depthWrite={false} depthTest={!settings.xray} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} toneMapped={false} />
          </mesh>
        )}
        <lineSegments raycast={ignoreRaycast} renderOrder={3}>
          <bufferGeometry key={edgePositions.length}>
            <bufferAttribute attach="attributes-position" args={[edgePositions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color="#c9d6ee" transparent opacity={0.55} depthTest={!settings.xray} toneMapped={false} />
        </lineSegments>
        {selectedEdgePositions.length > 0 && (
          <lineSegments raycast={ignoreRaycast} renderOrder={4}>
            <bufferGeometry key={selectedEdgePositions.length}>
              <bufferAttribute attach="attributes-position" args={[selectedEdgePositions, 3]} />
            </bufferGeometry>
            <lineBasicMaterial color={ACCENT} depthTest={!settings.xray} toneMapped={false} />
          </lineSegments>
        )}
        {preview?.lines && (
          <lineSegments raycast={ignoreRaycast} renderOrder={5}>
            <bufferGeometry key={preview.lines.length}>
              <bufferAttribute attach="attributes-position" args={[preview.lines, 3]} />
            </bufferGeometry>
            <lineBasicMaterial color={PREVIEW} toneMapped={false} depthTest={false} />
          </lineSegments>
        )}
        {mode === 'vertex' && (
          <points raycast={ignoreRaycast} renderOrder={5}>
            <bufferGeometry key={vertexPositions.length}>
              <bufferAttribute attach="attributes-position" args={[vertexPositions, 3]} />
            </bufferGeometry>
            <pointsMaterial color="#eef3ff" size={6} sizeAttenuation={false} depthTest={!settings.xray} toneMapped={false} />
          </points>
        )}
        {selectedVertexPositions.length > 0 && (
          <points raycast={ignoreRaycast} renderOrder={6}>
            <bufferGeometry key={selectedVertexPositions.length}>
              <bufferAttribute attach="attributes-position" args={[selectedVertexPositions, 3]} />
            </bufferGeometry>
            <pointsMaterial color={ACCENT} size={mode === 'vertex' ? 9 : 5} sizeAttenuation={false} depthTest={!settings.xray} toneMapped={false} />
          </points>
        )}
      </group>
      {selectedVerts.length > 0 && !modal && (
        <TransformControls
          key={`mesh-gizmo-${mode}-${selectedVerts.length}-${selectedVerts.slice(0, 8).join('-')}`}
          ref={controlsRef}
          mode={gizmoMode}
          size={0.72}
          translationSnap={settings.snap ? 0.05 : null}
          rotationSnap={settings.snap ? Math.PI / 12 : null}
          scaleSnap={settings.snap ? 0.1 : null}
          position={[pivotWorld.x, pivotWorld.y, pivotWorld.z]}
          onMouseDown={() => onGizmoStart(commitGizmo)}
          onMouseUp={() => onGizmoEnd()}
        >
          <mesh>
            <sphereGeometry args={[0.04, 12, 10]} />
            <meshBasicMaterial color={ACCENT} transparent opacity={0.3} toneMapped={false} />
          </mesh>
        </TransformControls>
      )}
    </>
  );
}

/** Convert a selection to another component mode (Blender keeps "what's selected" when switching). */
export function convertSelection(mesh: ModelPartMesh, from: MeshComponentMode, to: MeshComponentMode, selection: MeshSelection): MeshSelection {
  if (from === to) return selection;
  const faces = meshFaces(mesh);
  const verts = new Set(selectionVertices(mesh, from, selection));
  const topology = buildTopology({ vertices: mesh.vertices, faces });
  if (to === 'vertex') return { ...EMPTY_MESH_SELECTION, vertices: [...verts] };
  if (to === 'edge') return { ...EMPTY_MESH_SELECTION, edges: topology.edges.filter(([a, b]) => verts.has(a) && verts.has(b)) };
  return { ...EMPTY_MESH_SELECTION, faces: faces.map((_, index) => index).filter((index) => faces[index].every((vertex) => verts.has(vertex))) };
}

/** Select everything in a mode. */
export function selectAllComponents(mesh: ModelPartMesh, mode: MeshComponentMode): MeshSelection {
  const faces = meshFaces(mesh);
  if (mode === 'vertex') return { ...EMPTY_MESH_SELECTION, vertices: mesh.vertices.map((_, index) => index) };
  if (mode === 'edge') return { ...EMPTY_MESH_SELECTION, edges: buildTopology({ vertices: mesh.vertices, faces }).edges };
  return { ...EMPTY_MESH_SELECTION, faces: faces.map((_, index) => index) };
}

/** A store op's resulting selection mapped into the current component mode. */
export function selectionFromResult(mesh: ModelPartMesh, mode: MeshComponentMode, result: ModelMeshOpResult): MeshSelection {
  if (result.faces?.length) return convertSelection(mesh, 'face', mode, { ...EMPTY_MESH_SELECTION, faces: result.faces });
  if (result.edges?.length) return convertSelection(mesh, 'edge', mode, { ...EMPTY_MESH_SELECTION, edges: result.edges });
  if (result.vertices?.length) return convertSelection(mesh, 'vertex', mode, { ...EMPTY_MESH_SELECTION, vertices: result.vertices });
  return EMPTY_MESH_SELECTION;
}
