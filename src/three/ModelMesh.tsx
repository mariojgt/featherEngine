import { useEffect, useMemo, useRef } from 'react';
import { TransformControls } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import type { TransformControls as TransformControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import type { MeshRendererComponent, ModelPart, ModelSpec, ModelStyle, SceneObject, Vector3Tuple } from '../types';
import { useResolvedMaterial } from './resolveMaterial';
import { useAssetTexture } from './ModelAsset';
import { useEditorStore } from '../store/editorStore';
import { useModelForgeSession } from '../store/modelForgeSessionStore';
import { useViewportPrefs } from '../store/viewportPrefsStore';
import { faceGroupForFaceIndex, getPartMaterials, getPartRenderEdges, getPartRenderGeometry } from '../model/modelGeometry';

/**
 * Renders one prototype model (Model Forge): a group of flat-shaded primitive parts.
 *
 * The spec is resolved from the project's model library LIVE — every placed instance subscribes to
 * its own library entry, so an edit in the Model Forge restyles the whole scene at once (the tree
 * system's "one asset, many instances" promise, without the inline-copy indirection). The inline
 * `model.spec` only exists as the keep-alive copy stamped in when the library entry was deleted.
 *
 * Geometry is shared per shape and materials shared per palette color (src/model/modelGeometry.ts),
 * so a street of kit-bashed props costs five geometries and a handful of materials. Parts raycast
 * normally — clicks bubble to SceneObjectView's group handler, which is what makes placed props
 * click-selectable in the editor for free. When the viewport Model Forge bar is in Build/Paint,
 * part clicks are intercepted here so users can kit-bash and paint faces without leaving the scene.
 * Build mode also attaches the usual Move/Rotate/Scale gizmo to the selected part (Spline-style).
 */

export interface ModelPartMeshProps {
  part: ModelPart;
  palette: readonly string[];
  /** The owning spec's finish (smooth/flat + bevel). Absent = the crisp flat look. */
  style?: ModelStyle;
  /** Render at identity transform (a gizmo group carries the real transform) while geometry and
   *  materials still derive from the part's TRUE dimensions (bevel radius, deformation). */
  neutralTransform?: boolean;
  /** Forge-preview hooks (paint/select/hover); scene rendering leaves them undefined. */
  onPartPointerDown?: (part: ModelPart, event: ThreeEvent<PointerEvent>) => void;
  onPartPointerOver?: (part: ModelPart, event: ThreeEvent<PointerEvent>) => void;
  onPartPointerOut?: (part: ModelPart) => void;
  /** Soft outline for the part currently selected in Build mode. */
  outlined?: boolean;
}

const ZERO: [number, number, number] = [0, 0, 0];
const ONE: [number, number, number] = [1, 1, 1];
const ignoreOutlineRaycast = () => null;

const round = (value: number, decimals = 4): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

export function ModelPartMesh({
  part,
  palette,
  style,
  neutralTransform,
  onPartPointerDown,
  onPartPointerOver,
  onPartPointerOut,
  outlined,
}: ModelPartMeshProps) {
  // Cached per (shape | dims+bevel); beveled boxes bake true-radius rounding back into unit space,
  // so mesh scale stays part.scale for every shape.
  const geometry = getPartRenderGeometry(part, style);
  const engineMaterial = usePartEngineMaterial(part.materialId);
  const materials = useMemo(() => getPartMaterials(part, palette, style, engineMaterial), [part, palette, style, engineMaterial]);
  return (
    <>
      <mesh
        geometry={geometry}
        material={materials}
        position={neutralTransform ? ZERO : part.position}
        rotation={neutralTransform ? ZERO : part.rotation}
        scale={neutralTransform ? ONE : part.scale}
        castShadow
        receiveShadow
        onPointerDown={onPartPointerDown ? (event) => onPartPointerDown(part, event) : undefined}
        onPointerOver={onPartPointerOver ? (event) => onPartPointerOver(part, event) : undefined}
        onPointerOut={onPartPointerOut ? () => onPartPointerOut(part) : undefined}
      />
      {outlined && (
        <lineSegments
          geometry={getPartRenderEdges(part, style)}
          position={neutralTransform ? ZERO : part.position}
          rotation={neutralTransform ? ZERO : part.rotation}
          scale={neutralTransform ? ONE : part.scale}
          raycast={ignoreOutlineRaycast}
        >
          <lineBasicMaterial color="#5b8cff" transparent opacity={0.95} toneMapped={false} />
        </lineSegments>
      )}
    </>
  );
}

/**
 * A project material (Material Editor asset) on a model part: PBR values plus its base-color and
 * normal maps, tiled through the mesh UVs. Textures are clones of the shared cached maps so turning on
 * RepeatWrapping here never changes how the same image samples on other objects.
 */
function usePartEngineMaterial(materialId: string | undefined): THREE.Material | undefined {
  const renderer = useMemo(() => (materialId ? ({ materialId } as MeshRendererComponent) : undefined), [materialId]);
  const resolved = useResolvedMaterial(renderer);
  const baseMap = useAssetTexture(materialId ? resolved.baseColorUrl : undefined, true);
  const normalMap = useAssetTexture(materialId ? resolved.normalUrl : undefined, true, 'data');
  const material = useMemo(() => {
    if (!materialId) return undefined;
    const tiled = (texture: THREE.Texture | undefined) => {
      if (!texture) return null;
      const copy = texture.clone();
      copy.wrapS = THREE.RepeatWrapping;
      copy.wrapT = THREE.RepeatWrapping;
      copy.needsUpdate = true;
      return copy;
    };
    return new THREE.MeshPhysicalMaterial({
      color: resolved.color,
      metalness: resolved.metalness,
      roughness: resolved.roughness,
      emissive: resolved.emissiveColor,
      emissiveIntensity: resolved.emissiveIntensity,
      map: tiled(baseMap),
      normalMap: tiled(normalMap),
      clearcoat: resolved.clearcoat,
      clearcoatRoughness: resolved.clearcoatRoughness,
      sheen: resolved.sheen,
      sheenColor: resolved.sheenColor,
      transmission: resolved.transmission,
      ior: resolved.ior,
      thickness: resolved.thickness,
      iridescence: resolved.iridescence,
      transparent: resolved.opacity < 1,
      opacity: resolved.opacity,
    });
  }, [materialId, resolved, baseMap, normalMap]);
  useEffect(() => () => {
    if (!material) return;
    material.map?.dispose();
    material.normalMap?.dispose();
    material.dispose();
  }, [material]);
  return material;
}

export function resolveModelSpec(object: SceneObject, librarySpec: ModelSpec | undefined): ModelSpec | null {
  if (!object.model?.enabled) return null;
  return librarySpec ?? object.model.spec ?? null;
}

export function ModelMesh({ object }: { object: SceneObject }) {
  const specId = object.model?.specId;
  const librarySpec = useEditorStore((state) =>
    specId ? state.modelSpecs.find((entry) => entry.id === specId) : undefined,
  );
  const selectedObjectId = useEditorStore((state) => state.selectedObjectId);
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const mode = useModelForgeSession((state) => state.mode);
  const colorSlot = useModelForgeSession((state) => state.colorSlot);
  const selectedPartId = useModelForgeSession((state) => state.partId);
  const setPartId = useModelForgeSession((state) => state.setPartId);
  const gizmoMode = useModelForgeSession((state) => state.gizmoMode);
  const setPartGizmoEngaged = useModelForgeSession((state) => state.setPartGizmoEngaged);
  const snapEnabled = useViewportPrefs((state) => state.snapEnabled);
  const snapStep = useViewportPrefs((state) => state.snapStep);
  const angleStepDeg = useViewportPrefs((state) => state.angleStepDeg);
  const scaleStep = useViewportPrefs((state) => state.scaleStep);
  const controlsRef = useRef<TransformControlsImpl | null>(null);
  const gizmoActive = useRef(false);
  const spec = resolveModelSpec(object, librarySpec);

  const editing =
    !isPlaying && selectedObjectId === object.id && (mode === 'build' || mode === 'paint') && Boolean(specId);

  // Start Build with a part selected so the gizmo is immediately useful (Spline: click → edit).
  // Also recover when switching to another prop whose parts don't include the previous partId.
  useEffect(() => {
    if (!editing || mode !== 'build' || !spec) return;
    if (selectedPartId && spec.parts.some((part) => part.id === selectedPartId)) return;
    if (spec.parts[0]) setPartId(spec.parts[0].id);
  }, [editing, mode, spec, selectedPartId, setPartId]);

  useEffect(() => {
    return () => {
      if (gizmoActive.current) {
        gizmoActive.current = false;
        useModelForgeSession.getState().setPartGizmoEngaged(false);
      }
    };
  }, []);

  if (!spec) return null;

  const onPartPointerDown = editing
    ? (part: ModelPart, event: ThreeEvent<PointerEvent>) => {
        if (event.nativeEvent.button !== 0 || event.nativeEvent.altKey) return;
        if (gizmoActive.current) return;
        event.stopPropagation();
        setPartId(part.id);
        if (mode === 'paint' && specId) {
          const faceIndex = event.faceIndex;
          const geometry = getPartRenderGeometry(part, spec.style);
          const faceGroup = faceIndex != null ? faceGroupForFaceIndex(geometry, faceIndex) : undefined;
          useEditorStore.getState().paintModelPart(specId, part.id, colorSlot, faceGroup);
        }
      }
    : undefined;

  // Commit ONCE on release — mid-drag store writes remount TransformControls and kill the drag
  // (same pattern as the Model Forge studio preview).
  const commitFromGizmo = () => {
    if (!specId || !selectedPartId) return;
    const target = (controlsRef.current as unknown as { object?: THREE.Object3D } | null)?.object;
    if (!target) return;
    const patch: Pick<ModelPart, 'position' | 'rotation' | 'scale'> = {
      position: [round(target.position.x), round(target.position.y), round(target.position.z)] as Vector3Tuple,
      rotation: [round(target.rotation.x), round(target.rotation.y), round(target.rotation.z)] as Vector3Tuple,
      scale: [
        round(Math.max(0.05, target.scale.x)),
        round(Math.max(0.05, target.scale.y)),
        round(Math.max(0.05, target.scale.z)),
      ] as Vector3Tuple,
    };
    useEditorStore.getState().updateModelPart(specId, selectedPartId, patch);
  };

  const handleGizmoDown = () => {
    gizmoActive.current = true;
    setPartGizmoEngaged(true);
  };
  const handleGizmoUp = () => {
    commitFromGizmo();
    setTimeout(() => {
      gizmoActive.current = false;
      setPartGizmoEngaged(false);
    }, 0);
  };

  return (
    <group>
      {spec.parts.map((part) =>
        editing && mode === 'build' && part.id === selectedPartId ? (
          <TransformControls
            key={part.id}
            ref={controlsRef}
            mode={gizmoMode}
            size={0.85}
            space="local"
            translationSnap={snapEnabled ? snapStep : null}
            rotationSnap={snapEnabled ? (angleStepDeg * Math.PI) / 180 : null}
            scaleSnap={snapEnabled ? scaleStep : null}
            position={part.position}
            rotation={part.rotation}
            scale={part.scale}
            onMouseDown={handleGizmoDown}
            onMouseUp={handleGizmoUp}
          >
            <group>
              <ModelPartMesh
                part={part}
                palette={spec.palette}
                style={spec.style}
                neutralTransform
                onPartPointerDown={onPartPointerDown}
                outlined
              />
            </group>
          </TransformControls>
        ) : (
          <ModelPartMesh
            key={part.id}
            part={part}
            palette={spec.palette}
            style={spec.style}
            onPartPointerDown={onPartPointerDown}
            outlined={editing && mode === 'build' && part.id === selectedPartId}
          />
        ),
      )}
    </group>
  );
}
