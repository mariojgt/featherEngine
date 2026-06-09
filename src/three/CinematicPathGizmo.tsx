import { Line, TransformControls } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { useEditorStore } from '../store/editorStore';
import type { CinematicCameraKeyframe, Vector3Tuple } from '../types';

/** A small camera frustum drawn at a keyframe so its orientation/framing is visible in 3D. */
function KeyframeFrustum({ position, lookAt, fov }: { position: Vector3Tuple; lookAt: Vector3Tuple; fov: number }) {
  const cam = useMemo(() => new THREE.PerspectiveCamera(fov, 1.6, 0.12, 1.4), []);
  const helper = useMemo(() => new THREE.CameraHelper(cam), [cam]);
  useEffect(() => {
    if (helper.material instanceof THREE.LineBasicMaterial) helper.material.color = new THREE.Color('#5b8cff');
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

/**
 * Unreal-Sequencer-style camera/object PATH + AIM editing in the 3D viewport. When a Film Mode
 * cinematic is active (and you're not looking through the cinematic camera), each keyframe track is
 * drawn as a spline with a clickable handle per keyframe. Selecting a CAMERA keyframe shows two
 * handles — a gold MOVE handle (where the camera is) and a cyan AIM handle (where it looks) — joined
 * by a line, plus a frustum showing the framing. Click a handle to put the move gizmo on it; drag to
 * reposition or re-aim. Object tracks get a single position handle.
 */
export function CinematicPathGizmo() {
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const recording = useEditorStore((state) => state.cinematicRecording);
  const previewCam = useEditorStore((state) => state.editorCinematicPreviewCamera);
  const selected = useEditorStore((state) => state.selectedCinematicKeyframe);
  const activeId = useEditorStore((state) => state.activeCinematicId);
  const scene = useEditorStore((state) => state.scenes.find((item) => item.id === state.activeSceneId));
  const selectKeyframe = useEditorStore((state) => state.selectCinematicKeyframe);
  const moveKeyframe = useEditorStore((state) => state.moveCinematicKeyframe);
  const aimKeyframe = useEditorStore((state) => state.aimCinematicKeyframe);
  const [posHandle, setPosHandle] = useState<THREE.Object3D | null>(null);
  const [aimHandle, setAimHandle] = useState<THREE.Object3D | null>(null);
  const [handleMode, setHandleMode] = useState<'position' | 'lookAt'>('position');

  // Reset to the move handle whenever a different keyframe is selected.
  useEffect(() => {
    setHandleMode('position');
  }, [selected?.actionId, selected?.index]);

  const cinematic = scene?.cinematics?.find((item) => item.id === activeId) ?? scene?.cinematics?.[0];
  const lookingThrough = !!previewCam && !recording && !selected;
  if (isPlaying || lookingThrough || !cinematic) return null;

  const tracks = cinematic.actions.filter(
    (action) => (action.type === 'camera' && action.keyframes?.length) || (action.type === 'transform' && action.transformKeyframes?.length),
  );
  // Static camera SHOTS (a framing with position/lookAt but no keyframes array) — the common shot-list case.
  // Drawn as a route line + a frustum per shot so the whole camera path is visible while editing, and each
  // shot is draggable via the same move/aim handles (index -1 addresses the shot's own position/lookAt).
  const staticShots = cinematic.actions
    .filter((action) => action.type === 'camera' && !action.keyframes?.length && action.position && action.lookAt)
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
        const isCam = action.type === 'camera';
        const frames = (isCam ? action.keyframes : action.transformKeyframes) ?? [];
        const points = frames.map((frame) => new THREE.Vector3(...frame.position));
        const color = isCam ? '#5b8cff' : '#3ddc97';
        const curve = points.length >= 2 ? new THREE.CatmullRomCurve3(points).getPoints(Math.max(24, points.length * 14)) : points;
        return (
          <group key={action.id}>
            {points.length >= 2 && <Line points={curve} color={color} lineWidth={2} />}
            {frames.map((frame, index) => {
              const isSel = selected?.actionId === action.id && selected.index === index;
              if (!isSel) {
                return (
                  <mesh
                    key={index}
                    position={frame.position}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      selectKeyframe(action.id, index);
                    }}
                  >
                    <sphereGeometry args={[0.1, 14, 14]} />
                    <meshBasicMaterial color={color} depthTest={false} />
                  </mesh>
                );
              }
              const camFrame = frame as CinematicCameraKeyframe;
              return (
                <group key={index}>
                  {/* Move handle (where the camera/object is). */}
                  <mesh
                    position={frame.position}
                    ref={setPosHandle}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      setHandleMode('position');
                    }}
                  >
                    <sphereGeometry args={[0.13, 18, 18]} />
                    <meshBasicMaterial color={!aimMode ? '#ffd166' : '#b9933f'} depthTest={false} />
                  </mesh>
                  {/* Aim handle (where a camera looks) + connecting line + framing frustum. */}
                  {isCam && camFrame.lookAt && (
                    <>
                      <mesh
                        position={camFrame.lookAt}
                        ref={setAimHandle}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          setHandleMode('lookAt');
                        }}
                      >
                        <sphereGeometry args={[0.12, 16, 16]} />
                        <meshBasicMaterial color={aimMode ? '#ffd166' : '#4ad6ff'} depthTest={false} />
                      </mesh>
                      <Line points={[frame.position, camFrame.lookAt]} color="#4ad6ff" lineWidth={1.5} />
                      <KeyframeFrustum position={frame.position} lookAt={camFrame.lookAt} fov={camFrame.fov} />
                    </>
                  )}
                </group>
              );
            })}
          </group>
        );
      })}

      {/* Static shot-list route: a line through the shots in time order + a frustum/handles per shot. */}
      {staticShots.length > 0 && (
        <group>
          {staticShots.length >= 2 && (
            <Line points={staticShots.map((shot) => new THREE.Vector3(...(shot.position as Vector3Tuple)))} color="#5b8cff" lineWidth={1.5} dashed dashSize={0.25} gapSize={0.18} />
          )}
          {staticShots.map((shot) => {
            const position = shot.position as Vector3Tuple;
            const lookAt = shot.lookAt as Vector3Tuple;
            const isSel = selected?.actionId === shot.id && selected.index === -1;
            return (
              <group key={shot.id}>
                <KeyframeFrustum position={position} lookAt={lookAt} fov={shot.fov ?? 50} />
                <Line points={[position, lookAt]} color="#4ad6ff" lineWidth={1} />
                {isSel ? (
                  <>
                    <mesh position={position} ref={setPosHandle} onPointerDown={(event) => { event.stopPropagation(); setHandleMode('position'); }}>
                      <sphereGeometry args={[0.13, 18, 18]} />
                      <meshBasicMaterial color={!aimMode ? '#ffd166' : '#b9933f'} depthTest={false} />
                    </mesh>
                    <mesh position={lookAt} ref={setAimHandle} onPointerDown={(event) => { event.stopPropagation(); setHandleMode('lookAt'); }}>
                      <sphereGeometry args={[0.12, 16, 16]} />
                      <meshBasicMaterial color={aimMode ? '#ffd166' : '#4ad6ff'} depthTest={false} />
                    </mesh>
                  </>
                ) : (
                  <mesh position={position} onPointerDown={(event) => { event.stopPropagation(); selectKeyframe(shot.id, -1); }}>
                    <sphereGeometry args={[0.1, 14, 14]} />
                    <meshBasicMaterial color="#5b8cff" depthTest={false} />
                  </mesh>
                )}
              </group>
            );
          })}
        </group>
      )}

      {selected && activeObject && (
        <TransformControls object={activeObject} mode="translate" size={0.7} onObjectChange={onGizmoChange} />
      )}
    </group>
  );
}
