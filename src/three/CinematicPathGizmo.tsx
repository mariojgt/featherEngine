import { Html, Line, TransformControls } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { cinematicTransformsAt, sampleCameraKeyframes, sampleTransformKeyframes } from '../store/editor/cinematics';
import { useEditorStore } from '../store/editorStore';
import type {
  CinematicAction,
  CinematicCameraKeyframe,
  CinematicSequence,
  SceneObject,
  Vector3Tuple,
} from '../types';
import { worldTransformOf } from '../utils/transformHierarchy';

/** A small camera frustum drawn at a key so its orientation and framing remain readable in 3D. */
function KeyframeFrustum({ position, lookAt, fov }: { position: Vector3Tuple; lookAt: Vector3Tuple; fov: number }) {
  const cam = useMemo(() => new THREE.PerspectiveCamera(fov, 1.6, 0.12, 0.9), []);
  const helper = useMemo(() => new THREE.CameraHelper(cam), [cam]);
  useEffect(() => {
    const materials = Array.isArray(helper.material) ? helper.material : [helper.material];
    materials.forEach((material) => {
      material.depthTest = false;
      material.transparent = true;
      material.opacity = 0.5;
      if (material instanceof THREE.LineBasicMaterial) material.color = new THREE.Color('#5b8cff');
    });
    helper.renderOrder = 20;
    return () => helper.dispose();
  }, [helper]);
  useFrame(() => {
    cam.fov = fov;
    cam.position.set(position[0], position[1], position[2]);
    cam.lookAt(lookAt[0], lookAt[1], lookAt[2]);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    helper.update();
  });
  return <primitive object={helper} />;
}

function PathKeyLabel({
  position,
  index,
  time,
  color,
  active,
}: {
  position: Vector3Tuple;
  index: number;
  time: number;
  color: string;
  active: boolean;
}) {
  return (
    <Html position={position} center zIndexRange={[40, 10]} style={{ pointerEvents: 'none' }}>
      <span className={`cinematic-path-key-label${active ? ' active' : ''}`} style={{ borderColor: color }}>
        <strong>K{index + 1}</strong>
        <i aria-hidden>·</i>
        <small>{time.toFixed(2)}s</small>
      </span>
    </Html>
  );
}

/** Return the exact runtime-sampled world position for one camera/object track at `time`. */
function sampledTrackPosition(
  action: CinematicAction,
  cinematic: CinematicSequence,
  objects: SceneObject[],
  sequences: CinematicSequence[],
  time: number,
): Vector3Tuple | undefined {
  if (action.type === 'camera' && action.keyframes?.length) {
    return sampleCameraKeyframes(action.keyframes, time, action.interpolation)?.position;
  }
  if (action.type !== 'transform' || !action.objectId || !action.transformKeyframes?.length) return undefined;
  const sampled = sampleTransformKeyframes(action.transformKeyframes, time, action.interpolation);
  if (!sampled) return undefined;

  // Transform keys are local to their parent. Pose every animated ancestor at the same playhead time,
  // substitute this track's exact sample, then resolve the actor into scene-root/world space.
  const overrides = cinematicTransformsAt(cinematic, objects, time, sequences);
  overrides[action.objectId] = sampled;
  const posedObjects = objects.map((object) => (overrides[object.id] ? { ...object, transform: overrides[object.id] } : object));
  return worldTransformOf(posedObjects, action.objectId).position;
}

function trackSampleTimes(action: CinematicAction): number[] {
  const frames = action.type === 'camera' ? action.keyframes : action.type === 'transform' ? action.transformKeyframes : undefined;
  if (!frames?.length) return [];
  const sorted = [...frames].sort((a, b) => a.time - b.time);
  if (sorted.length < 2 || action.interpolation === 'linear' || action.interpolation === 'hold') {
    return sorted.map((frame) => frame.time);
  }
  const times: number[] = [];
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const from = sorted[index].time;
    const to = sorted[index + 1].time;
    const steps = Math.max(8, Math.ceil((to - from) * 12));
    for (let step = index === 0 ? 0 : 1; step <= steps; step += 1) {
      times.push(from + ((to - from) * step) / steps);
    }
  }
  return times;
}

/**
 * Unreal-Sequencer-style motion trails. Edit Paths keeps the free editor camera active while the
 * cinematic scene is evaluated at the playhead, so camera and actor routes never disappear merely
 * because the user scrubbed. Blue = camera, green = actor, white = evaluated playhead position.
 */
export function CinematicPathGizmo() {
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const viewportMode = useEditorStore((state) => state.cinematicViewportMode);
  const pathMode = useEditorStore((state) => state.cinematicPathMode);
  const preview = useEditorStore((state) => state.editorCinematicPreview);
  const selected = useEditorStore((state) => state.selectedCinematicKeyframe);
  const selectedObjectId = useEditorStore((state) => state.selectedObjectId);
  const activeId = useEditorStore((state) => state.activeCinematicId);
  const scene = useEditorStore((state) => state.scenes.find((item) => item.id === state.activeSceneId));
  const selectKeyframe = useEditorStore((state) => state.selectCinematicKeyframe);
  const selectObject = useEditorStore((state) => state.selectObject);
  const moveKeyframe = useEditorStore((state) => state.moveCinematicKeyframe);
  const aimKeyframe = useEditorStore((state) => state.aimCinematicKeyframe);
  const [posHandle, setPosHandle] = useState<THREE.Object3D | null>(null);
  const [aimHandle, setAimHandle] = useState<THREE.Object3D | null>(null);
  const [handleMode, setHandleMode] = useState<'position' | 'lookAt'>('position');

  useEffect(() => {
    setHandleMode('position');
  }, [selected?.actionId, selected?.index]);

  const cinematic = scene?.cinematics?.find((item) => item.id === activeId) ?? scene?.cinematics?.[0];
  if (isPlaying || viewportMode === 'camera' || pathMode === 'off' || !scene || !cinematic) return null;

  const allTracks = cinematic.actions.filter(
    (action) => (action.type === 'camera' && action.keyframes?.length) || (action.type === 'transform' && action.transformKeyframes?.length),
  );
  const showSelectedTrack = (action: CinematicAction) => {
    if (pathMode === 'all') return true;
    if (selected) return selected.actionId === action.id;
    if (selectedObjectId && action.type === 'transform') return action.objectId === selectedObjectId;
    return action.type === 'camera';
  };
  const tracks = allTracks.filter(showSelectedTrack);
  const staticShots = cinematic.actions
    .filter((action) => action.type === 'camera' && !action.keyframes?.length && action.position && action.lookAt)
    .filter((action) => pathMode === 'all' || !selected || selected.actionId === action.id)
    .sort((a, b) => a.time - b.time);
  if (!tracks.length && !staticShots.length) return null;

  const selectedAction = selected ? cinematic.actions.find((action) => action.id === selected.actionId) : undefined;
  const aimMode = selectedAction?.type === 'camera' && handleMode === 'lookAt';
  const activeObject = aimMode ? aimHandle : posHandle;

  const onGizmoChange = () => {
    if (!selected || !activeObject) return;
    const next: Vector3Tuple = [activeObject.position.x, activeObject.position.y, activeObject.position.z];
    if (aimMode) aimKeyframe(selected.actionId, selected.index, next);
    else moveKeyframe(selected.actionId, selected.index, next);
  };

  return (
    <group>
      {tracks.map((action) => {
        const isCamera = action.type === 'camera';
        const frames = (isCamera ? action.keyframes : action.transformKeyframes) ?? [];
        const color = isCamera ? '#5b8cff' : '#3ddc97';
        const trackIsSelected = selected?.actionId === action.id || (!selected && action.type === 'transform' && action.objectId === selectedObjectId);
        const opacity = selected && !trackIsSelected ? 0.3 : 0.92;
        const sampledPoints = trackSampleTimes(action)
          .map((time) => sampledTrackPosition(action, cinematic, scene.objects, scene.cinematics ?? [], time))
          .filter((position): position is Vector3Tuple => Boolean(position))
          .map((position) => new THREE.Vector3(...position));
        const playheadPosition = preview
          ? sampledTrackPosition(action, cinematic, scene.objects, scene.cinematics ?? [], preview.time)
          : undefined;
        return (
          <group key={action.id}>
            {sampledPoints.length >= 2 && (
              <Line
                points={sampledPoints}
                color={color}
                lineWidth={trackIsSelected ? 4 : 2.5}
                transparent
                opacity={opacity}
                depthTest={false}
                dashed={action.interpolation === 'hold'}
                dashSize={0.18}
                gapSize={0.14}
                renderOrder={18}
              />
            )}
            {frames.map((frame, index) => {
              const position = sampledTrackPosition(action, cinematic, scene.objects, scene.cinematics ?? [], frame.time) ?? frame.position;
              const isSelected = selected?.actionId === action.id && selected.index === index;
              const cameraFrame = frame as CinematicCameraKeyframe;
              return (
                <group key={index}>
                  <PathKeyLabel position={position} index={index} time={frame.time} color={color} active={isSelected} />
                  {isCamera && cameraFrame.lookAt && (
                    <>
                      <KeyframeFrustum position={position} lookAt={cameraFrame.lookAt} fov={cameraFrame.fov} />
                      <Line points={[position, cameraFrame.lookAt]} color="#4ad6ff" lineWidth={1} transparent opacity={isSelected ? 0.9 : 0.28} depthTest={false} renderOrder={17} />
                    </>
                  )}
                  {isSelected ? (
                    <>
                      <mesh
                        position={position}
                        ref={setPosHandle}
                        renderOrder={24}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          setHandleMode('position');
                        }}
                      >
                        <sphereGeometry args={[0.15, 18, 18]} />
                        <meshBasicMaterial color={!aimMode ? '#ffd166' : '#b9933f'} depthTest={false} />
                      </mesh>
                      {isCamera && cameraFrame.lookAt && (
                        <mesh
                          position={cameraFrame.lookAt}
                          ref={setAimHandle}
                          renderOrder={24}
                          onPointerDown={(event) => {
                            event.stopPropagation();
                            setHandleMode('lookAt');
                          }}
                        >
                          <sphereGeometry args={[0.13, 16, 16]} />
                          <meshBasicMaterial color={aimMode ? '#ffd166' : '#4ad6ff'} depthTest={false} />
                        </mesh>
                      )}
                    </>
                  ) : (
                    <mesh
                      position={position}
                      renderOrder={23}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        if (!isCamera && action.objectId) selectObject(action.objectId);
                        selectKeyframe(action.id, index);
                      }}
                    >
                      <sphereGeometry args={[0.11, 14, 14]} />
                      <meshBasicMaterial color={color} transparent opacity={opacity} depthTest={false} />
                    </mesh>
                  )}
                </group>
              );
            })}
            {playheadPosition && (
              <group position={playheadPosition}>
                <mesh renderOrder={25}>
                  <sphereGeometry args={[0.085, 16, 16]} />
                  <meshBasicMaterial color="#ffffff" depthTest={false} />
                </mesh>
                <Html center position={[0, 0.22, 0]} zIndexRange={[42, 12]} style={{ pointerEvents: 'none' }}>
                  <span className="cinematic-path-playhead-label">PLAYHEAD</span>
                </Html>
              </group>
            )}
          </group>
        );
      })}

      {/* Static camera cuts are deliberately NOT connected: a cut is not physical camera travel. */}
      {staticShots.map((shot, index) => {
        const position = shot.position as Vector3Tuple;
        const lookAt = shot.lookAt as Vector3Tuple;
        const isSelected = selected?.actionId === shot.id && selected.index === -1;
        return (
          <group key={shot.id}>
            <PathKeyLabel position={position} index={index} time={shot.time} color="#5b8cff" active={isSelected} />
            <KeyframeFrustum position={position} lookAt={lookAt} fov={shot.fov ?? 50} />
            <Line points={[position, lookAt]} color="#4ad6ff" lineWidth={1} transparent opacity={isSelected ? 0.9 : 0.3} depthTest={false} renderOrder={17} />
            {isSelected ? (
              <>
                <mesh position={position} ref={setPosHandle} renderOrder={24} onPointerDown={(event) => { event.stopPropagation(); setHandleMode('position'); }}>
                  <sphereGeometry args={[0.15, 18, 18]} />
                  <meshBasicMaterial color={!aimMode ? '#ffd166' : '#b9933f'} depthTest={false} />
                </mesh>
                <mesh position={lookAt} ref={setAimHandle} renderOrder={24} onPointerDown={(event) => { event.stopPropagation(); setHandleMode('lookAt'); }}>
                  <sphereGeometry args={[0.13, 16, 16]} />
                  <meshBasicMaterial color={aimMode ? '#ffd166' : '#4ad6ff'} depthTest={false} />
                </mesh>
              </>
            ) : (
              <mesh position={position} renderOrder={23} onPointerDown={(event) => { event.stopPropagation(); selectKeyframe(shot.id, -1); }}>
                <sphereGeometry args={[0.11, 14, 14]} />
                <meshBasicMaterial color="#5b8cff" depthTest={false} />
              </mesh>
            )}
          </group>
        );
      })}

      {selected && activeObject && (
        <TransformControls object={activeObject} mode="translate" size={0.75} onObjectChange={onGizmoChange} />
      )}
    </group>
  );
}
