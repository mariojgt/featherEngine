import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, CircleDot, Clapperboard, Eye, Pause, Play, Plus, RotateCcw, SkipBack, SkipForward, StepBack, StepForward, Trash2, Video } from 'lucide-react';
import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import { editorCameraPose } from '../three/EditorCamera';
import type { CinematicAction, CinematicActionType, CinematicCameraKeyframe, CinematicEase, CinematicTransformKeyframe, SceneObjectKind, Vector3Tuple } from '../types';

const easeOptions: { value: CinematicEase; label: string }[] = [
  { value: 'smooth', label: 'Smooth (ease in-out)' },
  { value: 'in', label: 'Ease in' },
  { value: 'out', label: 'Ease out' },
  { value: 'linear', label: 'Linear' },
];

const actionLabel: Record<CinematicActionType, string> = {
  camera: 'Camera',
  transform: 'Transform',
  visibility: 'Visibility',
  spawn: 'Spawn',
  animation: 'Animation',
  sound: 'Sound',
  event: 'Event',
  fade: 'Fade',
};

const timelineLane: Record<CinematicActionType, number> = {
  camera: 0,
  transform: 1,
  animation: 2,
  spawn: 3,
  visibility: 3,
  sound: 4,
  event: 4,
  fade: 5,
};

const laneLabels = ['Camera', 'Transform', 'Animation', 'Scene', 'Audio/Event', 'Fade'];
const actionTypes: CinematicActionType[] = ['camera', 'transform', 'visibility', 'spawn', 'animation', 'sound', 'event', 'fade'];
const spawnKinds: SceneObjectKind[] = ['empty', 'cube', 'sphere', 'capsule', 'plane', 'light', 'camera'];
const emptyVec: Vector3Tuple = [0, 0, 0];
const unitVec: Vector3Tuple = [1, 1, 1];

type VectorActionField =
  | 'fromPosition'
  | 'toPosition'
  | 'fromRotation'
  | 'toRotation'
  | 'fromScale'
  | 'toScale'
  | 'position'
  | 'rotation'
  | 'scale'
  | 'lookAt';

function actionTitle(action: CinematicAction) {
  return action.label || actionLabel[action.type];
}

function timelineStyle(action: CinematicAction, duration: number) {
  const safeDuration = Math.max(duration, 0.5);
  const start = Math.max(0, Math.min(100, (action.time / safeDuration) * 100));
  const length = Math.max(2.5, (((action.duration ?? 0.12) / safeDuration) * 100));
  return {
    left: `${start}%`,
    width: `${Math.min(100 - start, length)}%`,
    top: `${timelineLane[action.type] * 30 + 6}px`,
  };
}

function vectorValue(value: Vector3Tuple | undefined, fallback: Vector3Tuple): Vector3Tuple {
  return value ?? fallback;
}

function VectorEditor({
  label,
  value,
  fallback = emptyVec,
  onChange,
  step = 0.1,
}: {
  label: string;
  value?: Vector3Tuple;
  fallback?: Vector3Tuple;
  onChange: (value: Vector3Tuple) => void;
  step?: number;
}) {
  const tuple = vectorValue(value, fallback);
  const labels = ['X', 'Y', 'Z'];
  return (
    <label className="vector-field cinematic-vector-field">
      <span>{label}</span>
      <div>
        {tuple.map((component, index) => (
          <span className="axis-input" key={labels[index]}>
            <em>{labels[index]}</em>
            <input
              type="number"
              step={step}
              value={Number(component.toFixed(3))}
              onChange={(event) => {
                const next = [...tuple] as Vector3Tuple;
                next[index] = Number(event.target.value);
                onChange(next);
              }}
            />
          </span>
        ))}
      </div>
    </label>
  );
}

export function CinematicPanel() {
  const scene = useEditorStore((state) => state.scenes.find((item) => item.id === state.activeSceneId));
  const selectedObjectId = useEditorStore((state) => state.selectedObjectId);
  const objects = useEditorStore(selectActiveObjects);
  const animations = useEditorStore((state) => state.animations);
  const assets = useEditorStore((state) => state.assets);
  const activeCinematicId = useEditorStore((state) => state.activeCinematicId);
  const runtimeCinematic = useEditorStore((state) => state.runtimeCinematic);
  const editorPreview = useEditorStore((state) => state.editorCinematicPreview);
  const createCinematic = useEditorStore((state) => state.createCinematic);
  const updateCinematic = useEditorStore((state) => state.updateCinematic);
  const deleteCinematic = useEditorStore((state) => state.deleteCinematic);
  const setActiveCinematic = useEditorStore((state) => state.setActiveCinematic);
  const addCinematicAction = useEditorStore((state) => state.addCinematicAction);
  const updateCinematicAction = useEditorStore((state) => state.updateCinematicAction);
  const removeCinematicAction = useEditorStore((state) => state.removeCinematicAction);
  const previewCinematic = useEditorStore((state) => state.previewCinematic);
  const clearCinematicPreview = useEditorStore((state) => state.clearCinematicPreview);
  const playCinematic = useEditorStore((state) => state.playCinematic);
  const stopCinematic = useEditorStore((state) => state.stopCinematic);
  const addCinematicTransformKeyframe = useEditorStore((state) => state.addCinematicTransformKeyframe);
  const cinematicRecording = useEditorStore((state) => state.cinematicRecording);
  const setCinematicRecording = useEditorStore((state) => state.setCinematicRecording);
  const [selectedActionId, setSelectedActionId] = useState('');

  const cinematics = scene?.cinematics ?? [];
  const audioAssets = useMemo(() => assets.filter((asset) => asset.type === 'audio'), [assets]);
  const active = cinematics.find((cinematic) => cinematic.id === activeCinematicId) ?? cinematics[0];
  const selected = objects.find((object) => object.id === selectedObjectId);
  const selectedCamera = selected?.kind === 'camera' ? selected : objects.find((object) => object.kind === 'camera');
  const running = Boolean(runtimeCinematic && active && runtimeCinematic.sequenceId === active.id);
  const previewing = Boolean(editorPreview && active && editorPreview.sequenceId === active.id);
  const runtimeTime = running ? runtimeCinematic?.time ?? 0 : 0;
  const activeActionIds = active?.actions.map((action) => action.id).join('|') ?? '';
  const activeId = active?.id ?? '';
  const selectedAction = active?.actions.find((action) => action.id === selectedActionId);
  const timelineTime = running ? runtimeTime : previewing ? editorPreview?.time ?? 0 : selectedAction?.time ?? 0;
  const playhead = active ? Math.min(100, Math.max(0, (timelineTime / Math.max(active.duration, 0.5)) * 100)) : 0;

  useEffect(() => {
    setSelectedActionId((current) => {
      if (!active) return current ? '' : current;
      if (active.actions.some((action) => action.id === current)) return current;
      return active.actions[0]?.id ?? '';
    });
  }, [active, activeId, activeActionIds]);

  useEffect(() => {
    if (!active || !previewing || !editorPreview) return;
    previewCinematic(active.id, editorPreview.time);
  }, [active, activeId, activeActionIds, active?.duration, editorPreview?.time, previewCinematic, previewing]);

  useEffect(() => () => clearCinematicPreview(), [clearCinematicPreview]);

  const setPreviewTime = (time: number) => {
    if (!active || running) return;
    previewCinematic(active.id, Math.min(Math.max(time, 0), active.duration));
  };

  const frameStep = 1 / 24;
  const beatTime = active ? Math.min(Math.max(timelineTime, 0), active.duration) : 0;

  const addBeat = (action: Omit<CinematicAction, 'id'>) => {
    if (!active) return;
    const id = addCinematicAction(active.id, action);
    if (id) setSelectedActionId(id);
    if (id && !running) previewCinematic(active.id, action.time);
  };

  const updateSelectedAction = (patch: Partial<Omit<CinematicAction, 'id'>>) => {
    if (!active || !selectedAction) return;
    updateCinematicAction(active.id, selectedAction.id, patch);
  };

  const updateSelectedVector = (field: VectorActionField, value: Vector3Tuple) => {
    updateSelectedAction({ [field]: value } as Partial<Omit<CinematicAction, 'id'>>);
  };

  const cameraShotCount = active?.actions.filter((action) => action.type === 'camera').length ?? 0;

  // Snap a camera beat onto the exact framing the editor viewport currently shows.
  const captureViewportInto = (action: CinematicAction) => {
    if (!active || !editorCameraPose.valid) return;
    updateCinematicAction(active.id, action.id, {
      objectId: undefined,
      position: [...editorCameraPose.position],
      lookAt: [...editorCameraPose.lookAt],
      fov: Math.round(editorCameraPose.fov),
    });
  };

  // One-click "frame it, click, done": add a camera shot at the playhead from the live viewport.
  // The first shot is a hard cut; every shot after it glides in from the previous framing.
  const addViewportShot = () => {
    if (!active || !editorCameraPose.valid) return;
    addBeat({
      type: 'camera',
      time: beatTime,
      duration: Math.max(1.5, active.duration - beatTime),
      label: `Shot ${cameraShotCount + 1}`,
      position: [...editorCameraPose.position],
      lookAt: [...editorCameraPose.lookAt],
      fov: Math.round(editorCameraPose.fov),
      blend: cameraShotCount > 0 ? 1.2 : 0,
      ease: 'smooth',
    });
  };

  const addFadeBookends = () => {
    if (!active) return;
    addBeat({ type: 'fade', time: 0, duration: 1.2, label: 'Fade in', fadeFrom: 1, fadeTo: 0, fadeColor: '#000000' });
    addBeat({ type: 'fade', time: Math.max(0, active.duration - 1.2), duration: 1.2, label: 'Fade out', fadeFrom: 0, fadeTo: 1, fadeColor: '#000000' });
  };

  // Write a keyframe list back onto a camera beat, snapping the clip to span the keyframes so the
  // timeline and runtime picker treat it as the active track for its whole range.
  const applyKeyframes = (actionId: string, frames: CinematicCameraKeyframe[]) => {
    if (!active) return;
    const sorted = [...frames].sort((a, b) => a.time - b.time);
    const minTime = Math.min(0, ...sorted.map((frame) => frame.time));
    const maxTime = Math.max(0.5, ...sorted.map((frame) => frame.time));
    updateCinematicAction(active.id, actionId, { keyframes: sorted, time: minTime, duration: Math.max(0.5, maxTime - minTime) });
  };

  const viewportKeyframe = (time: number): CinematicCameraKeyframe => ({
    time: Number(Math.max(0, time).toFixed(3)),
    position: [...editorCameraPose.position],
    lookAt: [...editorCameraPose.lookAt],
    fov: Math.round(editorCameraPose.fov),
  });

  // The core "keyframe the camera" gesture: capture the live viewport framing at the playhead.
  // Appends to the selected camera track (or the first one), creating a track if none exists.
  // Re-keying within 0.06s of an existing keyframe replaces it, so you can refine a pose in place.
  const addCameraKeyframe = () => {
    if (!active || running || previewing || !editorCameraPose.valid) return;
    const frame = viewportKeyframe(beatTime);
    const target =
      selectedAction?.type === 'camera' ? selectedAction : active.actions.find((action) => action.type === 'camera' && action.keyframes?.length);
    if (!target) {
      const id = addCinematicAction(active.id, {
        type: 'camera',
        time: frame.time,
        duration: 0.5,
        label: 'Camera track',
        ease: 'smooth',
        keyframes: [frame],
      });
      if (id) {
        setSelectedActionId(id);
        applyKeyframes(id, [frame]);
        previewCinematic(active.id, frame.time);
      }
      return;
    }
    const existing = target.keyframes ?? [];
    const kept = existing.filter((keyframe) => Math.abs(keyframe.time - frame.time) > 0.06);
    applyKeyframes(target.id, [...kept, frame]);
    setSelectedActionId(target.id);
    previewCinematic(active.id, frame.time);
  };

  const recaptureKeyframe = (action: CinematicAction, index: number) => {
    if (!editorCameraPose.valid || !action.keyframes) return;
    const frames = action.keyframes.map((keyframe, i) =>
      i === index ? { ...keyframe, position: [...editorCameraPose.position], lookAt: [...editorCameraPose.lookAt], fov: Math.round(editorCameraPose.fov) } as CinematicCameraKeyframe : keyframe,
    );
    applyKeyframes(action.id, frames);
  };

  const removeKeyframe = (action: CinematicAction, index: number) => {
    if (!active || !action.keyframes) return;
    const frames = action.keyframes.filter((_, i) => i !== index);
    if (frames.length) applyKeyframes(action.id, frames);
    else updateCinematicAction(active.id, action.id, { keyframes: [] });
  };

  const setKeyframeTime = (action: CinematicAction, index: number, time: number) => {
    if (!action.keyframes) return;
    const frames = action.keyframes.map((keyframe, i) => (i === index ? { ...keyframe, time: Math.max(0, time) } : keyframe));
    applyKeyframes(action.id, frames);
  };

  // ----- Object transform keyframe tracks (the store action handles create/merge/clip-span) -----

  // Key the selected object at the playhead, creating its track if needed. This is also how an
  // object is "added to the sequence" — its first keyframe makes a track.
  const keyframeSelectedObject = () => {
    if (!active || !selected || running) return;
    const id = addCinematicTransformKeyframe(active.id, selected.id, beatTime);
    if (id) {
      setSelectedActionId(id);
      previewCinematic(active.id, beatTime);
    }
  };

  const applyTransformKeyframes = (actionId: string, frames: CinematicTransformKeyframe[]) => {
    if (!active) return;
    const sorted = [...frames].sort((a, b) => a.time - b.time);
    const minTime = Math.min(0, ...sorted.map((frame) => frame.time));
    const maxTime = Math.max(0.5, ...sorted.map((frame) => frame.time));
    updateCinematicAction(active.id, actionId, { transformKeyframes: sorted, time: minTime, duration: Math.max(0.5, maxTime - minTime) });
  };

  const removeTransformKeyframe = (action: CinematicAction, index: number) => {
    if (!active || !action.transformKeyframes) return;
    const frames = action.transformKeyframes.filter((_, i) => i !== index);
    if (frames.length) applyTransformKeyframes(action.id, frames);
    else updateCinematicAction(active.id, action.id, { transformKeyframes: [] });
  };

  const setTransformKeyframeTime = (action: CinematicAction, index: number, time: number) => {
    if (!action.transformKeyframes) return;
    const frames = action.transformKeyframes.map((keyframe, i) => (i === index ? { ...keyframe, time: Math.max(0, time) } : keyframe));
    applyTransformKeyframes(action.id, frames);
  };

  // ----- Direct timeline manipulation: drag a clip to retime it, drag a keyframe diamond to move it -----
  const tracksRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<null | { kind: 'clip' | 'ckf' | 'tkf'; actionId: string; index?: number; startX: number; startTime: number; moved: boolean }>(null);

  const timeFromPointer = (clientX: number) => {
    const el = tracksRef.current;
    const drag = dragRef.current;
    if (!el || !drag || !active) return 0;
    const width = el.getBoundingClientRect().width || 1;
    const deltaSeconds = ((clientX - drag.startX) / width) * Math.max(active.duration, 0.5);
    return Math.min(Math.max(drag.startTime + deltaSeconds, 0), active.duration);
  };

  const onTimelinePointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || !active || running) return;
    if (!drag.moved && Math.abs(event.clientX - drag.startX) < 3) return;
    drag.moved = true;
    const time = timeFromPointer(event.clientX);
    const target = active.actions.find((action) => action.id === drag.actionId);
    if (!target) return;
    if (drag.kind === 'clip') updateCinematicAction(active.id, drag.actionId, { time });
    else if (drag.kind === 'ckf' && drag.index != null) setKeyframeTime(target, drag.index, time);
    else if (drag.kind === 'tkf' && drag.index != null) setTransformKeyframeTime(target, drag.index, time);
    previewCinematic(active.id, time);
  };

  const onTimelinePointerUp = (action: CinematicAction) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag && !drag.moved && !running) previewCinematic(active!.id, action.time);
  };

  const beginClipDrag = (event: React.PointerEvent, action: CinematicAction) => {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = { kind: 'clip', actionId: action.id, startX: event.clientX, startTime: action.time, moved: false };
    setSelectedActionId(action.id);
  };

  const objectPicker = (label = 'Object') =>
    selectedAction ? (
      <label className="field-row">
        <span>{label}</span>
        <select value={selectedAction.objectId ?? ''} onChange={(event) => updateSelectedAction({ objectId: event.target.value || undefined })}>
          <option value="">None</option>
          {objects.map((object) => (
            <option key={object.id} value={object.id}>
              {object.name}
            </option>
          ))}
        </select>
      </label>
    ) : null;

  const renderKeyframeTrack = (action: CinematicAction) => {
    const frames = action.keyframes ?? [];
    return (
      <div className="cinematic-keyframes">
        <div className="cinematic-keyframes-head">
          <span>{frames.length} keyframe{frames.length === 1 ? '' : 's'}</span>
          <small>{frames.length < 2 ? 'Add another to animate' : 'Camera flies through them'}</small>
        </div>
        <button className="full-button primary" disabled={running || previewing || !editorCameraPose.valid} title="Capture the current viewport framing as a keyframe at the playhead" onClick={addCameraKeyframe}>
          <Camera size={14} aria-hidden />
          Add keyframe at playhead
        </button>
        {frames.length === 0 ? (
          <p className="field-hint">Scrub the playhead, frame the shot in the viewport, then add a keyframe. Repeat to build the camera move.</p>
        ) : (
          <div className="cinematic-keyframe-list">
            {frames.map((frame, index) => (
              <div className={`cinematic-keyframe-row${Math.abs(frame.time - beatTime) < 0.05 ? ' active' : ''}`} key={`${action.id}-kf-${index}`}>
                <span className="cinematic-keyframe-index">{index + 1}</span>
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={Number(frame.time.toFixed(2))}
                  title="Keyframe time (seconds)"
                  onChange={(event) => setKeyframeTime(action, index, Number(event.target.value))}
                />
                <button className="icon-button" title="Jump playhead to this keyframe" disabled={running} onClick={() => setPreviewTime(frame.time)}>
                  <Eye size={13} aria-hidden />
                </button>
                <button className="icon-button" title="Recapture this keyframe from the current viewport" disabled={!editorCameraPose.valid || running || previewing} onClick={() => recaptureKeyframe(action, index)}>
                  <Camera size={13} aria-hidden />
                </button>
                <button className="icon-button" title="Delete keyframe" onClick={() => removeKeyframe(action, index)}>
                  <Trash2 size={13} aria-hidden />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderTransformKeyframeTrack = (action: CinematicAction) => {
    const frames = action.transformKeyframes ?? [];
    const trackObject = objects.find((object) => object.id === action.objectId);
    const isTarget = Boolean(selected && action.objectId === selected.id);
    return (
      <div className="cinematic-keyframes">
        <div className="cinematic-keyframes-head">
          <span>{frames.length} keyframe{frames.length === 1 ? '' : 's'}</span>
          <small>{trackObject?.name ?? 'object'}</small>
        </div>
        <button
          className="full-button primary"
          disabled={running || !isTarget}
          title={isTarget ? 'Capture the selected object’s current transform as a keyframe at the playhead' : 'Select this track’s object in the viewport to key it'}
          onClick={() => action.objectId && addCinematicTransformKeyframe(active!.id, action.objectId, beatTime) && previewCinematic(active!.id, beatTime)}
        >
          <Camera size={14} aria-hidden />
          {isTarget ? 'Key object at playhead' : 'Select object to key'}
        </button>
        {frames.length === 0 ? (
          <p className="field-hint">Scrub the playhead, pose the object (drag its gizmo), then key it. Repeat to animate it.</p>
        ) : (
          <div className="cinematic-keyframe-list">
            {frames.map((frame, index) => (
              <div className={`cinematic-keyframe-row${Math.abs(frame.time - beatTime) < 0.05 ? ' active' : ''}`} key={`${action.id}-tkf-${index}`}>
                <span className="cinematic-keyframe-index">{index + 1}</span>
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={Number(frame.time.toFixed(2))}
                  title="Keyframe time (seconds)"
                  onChange={(event) => setTransformKeyframeTime(action, index, Number(event.target.value))}
                />
                <button className="icon-button" title="Jump playhead to this keyframe" disabled={running} onClick={() => setPreviewTime(frame.time)}>
                  <Eye size={13} aria-hidden />
                </button>
                <button
                  className="icon-button"
                  title="Recapture this keyframe from the object’s current transform"
                  disabled={!isTarget || running}
                  onClick={() => action.objectId && addCinematicTransformKeyframe(active!.id, action.objectId, frame.time)}
                >
                  <Camera size={13} aria-hidden />
                </button>
                <button className="icon-button" title="Delete keyframe" onClick={() => removeTransformKeyframe(action, index)}>
                  <Trash2 size={13} aria-hidden />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderSelectedActionFields = () => {
    if (!selectedAction) return null;
    if (selectedAction.type === 'camera') {
      const isTrack = Boolean(selectedAction.keyframes?.length);
      return (
        <>
          {isTrack ? (
            <>
              {renderKeyframeTrack(selectedAction)}
              <button className="full-button" title="Discard keyframes and edit this as a single static shot" onClick={() => updateSelectedAction({ keyframes: [] })}>
                Convert to single shot
              </button>
            </>
          ) : (
            <>
              {objectPicker('Camera object')}
              <button
                className="full-button"
                disabled={!selectedCamera}
                onClick={() => {
                  if (!selectedCamera) return;
                  updateSelectedAction({
                    objectId: selectedCamera.id,
                    label: selectedCamera.name,
                    position: selectedCamera.transform.position,
                    rotation: selectedCamera.transform.rotation,
                    lookAt: selectedAction.lookAt ?? [0, 1, 0],
                    fov: selectedAction.fov ?? 50,
                  });
                }}
              >
                <Eye size={14} aria-hidden />
                Use selected camera
              </button>
              <button
                className="full-button"
                disabled={!selected || selected.kind === 'camera'}
                onClick={() => {
                  if (!selected || selected.kind === 'camera') return;
                  updateSelectedAction({ lookAt: selected.transform.position });
                }}
              >
                Look at selected
              </button>
              <button className="full-button" disabled={!editorCameraPose.valid} title="Set this shot to the current editor viewport framing" onClick={() => captureViewportInto(selectedAction)}>
                <Camera size={14} aria-hidden />
                Capture viewport framing
              </button>
              <button
                className="full-button"
                disabled={!editorCameraPose.valid || running || previewing}
                title="Turn this shot into an animated camera track, seeding the first keyframe from the viewport"
                onClick={addCameraKeyframe}
              >
                Animate (start keyframe track)
              </button>
              <VectorEditor label="Position" value={selectedAction.position} fallback={selectedCamera?.transform.position ?? [4, 2.4, 4]} onChange={(value) => updateSelectedVector('position', value)} />
              <VectorEditor label="Look at" value={selectedAction.lookAt} fallback={[0, 1, 0]} onChange={(value) => updateSelectedVector('lookAt', value)} />
              <label className="field-row">
                <span>FOV</span>
                <input type="number" min={10} max={140} step={1} value={selectedAction.fov ?? 50} onChange={(event) => updateSelectedAction({ fov: Number(event.target.value) })} />
              </label>
              <label className="field-row">
                <span>Blend in</span>
                <input type="number" min={0} max={10} step={0.1} value={selectedAction.blend ?? 0} title="Seconds to glide from the previous shot (0 = hard cut)" onChange={(event) => updateSelectedAction({ blend: Number(event.target.value) })} />
              </label>
              <label className="field-row">
                <span>Easing</span>
                <select value={selectedAction.ease ?? 'smooth'} onChange={(event) => updateSelectedAction({ ease: event.target.value as CinematicEase })}>
                  {easeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
        </>
      );
    }

    if (selectedAction.type === 'transform') {
      const target = objects.find((object) => object.id === selectedAction.objectId) ?? selected;
      if (selectedAction.transformKeyframes?.length) {
        return (
          <>
            {objectPicker('Target')}
            {renderTransformKeyframeTrack(selectedAction)}
            <button className="full-button" title="Discard keyframes and edit this as a single from→to move" onClick={() => updateSelectedAction({ transformKeyframes: [] })}>
              Convert to single move
            </button>
          </>
        );
      }
      return (
        <>
          {objectPicker('Target')}
          <button
            className="full-button"
            disabled={!target || running}
            title="Turn this into an animated keyframe track for the object, keying its current pose at the playhead"
            onClick={() => {
              if (!target) return;
              const id = addCinematicTransformKeyframe(active!.id, target.id, beatTime);
              if (id) {
                setSelectedActionId(id);
                previewCinematic(active!.id, beatTime);
              }
            }}
          >
            Animate (start keyframe track)
          </button>
          <button
            className="full-button"
            disabled={!target}
            onClick={() => {
              if (!target) return;
              updateSelectedAction({
                objectId: target.id,
                label: `Move ${target.name}`,
                fromPosition: target.transform.position,
                fromRotation: target.transform.rotation,
                fromScale: target.transform.scale,
              });
            }}
          >
            Use current transform as start
          </button>
          <button
            className="full-button"
            disabled={!target}
            onClick={() => {
              if (!target) return;
              updateSelectedAction({
                objectId: target.id,
                label: selectedAction.label ?? `Move ${target.name}`,
                toPosition: target.transform.position,
                toRotation: target.transform.rotation,
                toScale: target.transform.scale,
              });
            }}
          >
            Use current transform as end
          </button>
          <VectorEditor label="From position" value={selectedAction.fromPosition} fallback={target?.transform.position ?? emptyVec} onChange={(value) => updateSelectedVector('fromPosition', value)} />
          <VectorEditor label="To position" value={selectedAction.toPosition} fallback={target?.transform.position ?? emptyVec} onChange={(value) => updateSelectedVector('toPosition', value)} />
          <VectorEditor label="From rotation" value={selectedAction.fromRotation} fallback={target?.transform.rotation ?? emptyVec} onChange={(value) => updateSelectedVector('fromRotation', value)} />
          <VectorEditor label="To rotation" value={selectedAction.toRotation} fallback={target?.transform.rotation ?? emptyVec} onChange={(value) => updateSelectedVector('toRotation', value)} />
          <VectorEditor label="From scale" value={selectedAction.fromScale} fallback={target?.transform.scale ?? unitVec} onChange={(value) => updateSelectedVector('fromScale', value)} />
          <VectorEditor label="To scale" value={selectedAction.toScale} fallback={target?.transform.scale ?? unitVec} onChange={(value) => updateSelectedVector('toScale', value)} />
          <label className="field-row">
            <span>Easing</span>
            <select value={selectedAction.ease ?? 'smooth'} onChange={(event) => updateSelectedAction({ ease: event.target.value as CinematicEase })}>
              {easeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </>
      );
    }

    if (selectedAction.type === 'visibility') {
      return (
        <>
          {objectPicker('Target')}
          <label className="field-row">
            <span>Visible</span>
            <input type="checkbox" checked={selectedAction.visible !== false} onChange={(event) => updateSelectedAction({ visible: event.target.checked })} />
          </label>
        </>
      );
    }

    if (selectedAction.type === 'spawn') {
      return (
        <>
          <label className="field-row">
            <span>Name</span>
            <input value={selectedAction.name ?? ''} onChange={(event) => updateSelectedAction({ name: event.target.value })} />
          </label>
          <label className="field-row">
            <span>Kind</span>
            <select value={selectedAction.spawnKind ?? 'cube'} onChange={(event) => updateSelectedAction({ spawnKind: event.target.value as SceneObjectKind })}>
              {spawnKinds.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
          </label>
          <VectorEditor label="Position" value={selectedAction.position} fallback={[0, 1, 0]} onChange={(value) => updateSelectedVector('position', value)} />
          <VectorEditor label="Scale" value={selectedAction.scale} fallback={unitVec} onChange={(value) => updateSelectedVector('scale', value)} />
        </>
      );
    }

    if (selectedAction.type === 'animation') {
      return (
        <>
          {objectPicker('Target')}
          <label className="field-row">
            <span>Animation</span>
            <select value={selectedAction.animationId ?? ''} onChange={(event) => updateSelectedAction({ animationId: event.target.value || undefined })}>
              <option value="">{animations.length ? 'Select animation...' : 'No animations'}</option>
              {animations.map((animation) => (
                <option key={animation.id} value={animation.id}>
                  {animation.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field-row">
            <span>Speed</span>
            <input type="number" min={0.05} max={5} step={0.05} value={selectedAction.animationSpeed ?? 1} onChange={(event) => updateSelectedAction({ animationSpeed: Number(event.target.value) })} />
          </label>
        </>
      );
    }

    if (selectedAction.type === 'sound') {
      return (
        <label className="field-row">
          <span>Sound</span>
          <select value={selectedAction.soundId ?? ''} onChange={(event) => updateSelectedAction({ soundId: event.target.value || undefined })}>
            <option value="">{audioAssets.length ? 'Select audio...' : 'No audio assets'}</option>
            {audioAssets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.name}
              </option>
            ))}
          </select>
        </label>
      );
    }

    if (selectedAction.type === 'event') {
      return (
        <label className="field-row">
          <span>Event</span>
          <input value={selectedAction.eventName ?? ''} onChange={(event) => updateSelectedAction({ eventName: event.target.value })} />
        </label>
      );
    }

    return (
      <>
        <label className="field-row">
          <span>Color</span>
          <input type="color" value={selectedAction.fadeColor ?? '#000000'} onChange={(event) => updateSelectedAction({ fadeColor: event.target.value })} />
        </label>
        <label className="field-row">
          <span>From</span>
          <input type="number" min={0} max={1} step={0.05} value={selectedAction.fadeFrom ?? 0} onChange={(event) => updateSelectedAction({ fadeFrom: Number(event.target.value) })} />
        </label>
        <label className="field-row">
          <span>To</span>
          <input type="number" min={0} max={1} step={0.05} value={selectedAction.fadeTo ?? 1} onChange={(event) => updateSelectedAction({ fadeTo: Number(event.target.value) })} />
        </label>
      </>
    );
  };

  return (
    <aside className="panel cinematic-panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Film Mode</span>
          <h2>Cinematics</h2>
        </div>
        <button className="icon-button" title="Create cinematic" onClick={() => createCinematic('Opening Shot', 8)}>
          <Plus size={15} aria-hidden />
        </button>
      </div>

      {!scene ? (
        <div className="empty-state compact">No active scene.</div>
      ) : cinematics.length === 0 ? (
        <div className="cinematic-empty">
          <Clapperboard size={28} aria-hidden />
          <p>Create a cinematic sequence for camera cuts, fades, animation beats, sounds, and temporary scene objects.</p>
          <button className="full-button" onClick={() => createCinematic('Opening Shot', 8)}>Create Film Mode sequence</button>
        </div>
      ) : (
        <>
          <section className="inspector-section">
            <h3>Sequences</h3>
            <div className="cinematic-list">
              {cinematics.map((cinematic) => (
                <button
                  key={cinematic.id}
                  className={cinematic.id === active?.id ? 'cinematic-list-item active' : 'cinematic-list-item'}
                  onClick={() => setActiveCinematic(cinematic.id)}
                >
                  <span>{cinematic.name}</span>
                  <small>{cinematic.duration.toFixed(1)}s</small>
                </button>
              ))}
            </div>
          </section>

          {active && (
            <>
              <section className="inspector-section">
                <h3>Timeline</h3>
                <label className="field-row">
                  <span>Name</span>
                  <input value={active.name} onChange={(event) => updateCinematic(active.id, { name: event.target.value })} />
                </label>
                <label className="field-row">
                  <span>Duration</span>
                  <input type="number" min={0.5} step={0.5} value={active.duration} onChange={(event) => updateCinematic(active.id, { duration: Number(event.target.value) })} />
                </label>
                <label className="field-row">
                  <span>Autoplay</span>
                  <input type="checkbox" checked={Boolean(active.autoplay)} onChange={(event) => updateCinematic(active.id, { autoplay: event.target.checked })} />
                </label>
                <button
                  className={`full-button cinematic-record${cinematicRecording ? ' armed' : ''}`}
                  disabled={running}
                  title="Record mode: move the viewport camera or drag an object to auto-key it at the playhead"
                  onClick={() => setCinematicRecording(!cinematicRecording)}
                >
                  <CircleDot size={14} aria-hidden />
                  {cinematicRecording ? 'Recording — move things to key them' : 'Record (auto-key on move)'}
                </button>
                <div className="cinematic-transport" aria-label="Cinematic preview controls">
                  <button
                    className={previewing ? 'active' : undefined}
                    title="Preview this cinematic in the editor viewport"
                    disabled={running}
                    onClick={() => (previewing ? clearCinematicPreview() : setPreviewTime(timelineTime))}
                  >
                    <Video size={14} aria-hidden />
                    <span>{previewing ? 'Previewing' : 'Preview'}</span>
                  </button>
                  <button title="Jump to start" disabled={running} onClick={() => setPreviewTime(0)}>
                    <SkipBack size={14} aria-hidden />
                  </button>
                  <button title="Step back one frame" disabled={running} onClick={() => setPreviewTime(beatTime - frameStep)}>
                    <StepBack size={14} aria-hidden />
                  </button>
                  <button title="Step forward one frame" disabled={running} onClick={() => setPreviewTime(beatTime + frameStep)}>
                    <StepForward size={14} aria-hidden />
                  </button>
                  <button title="Jump to end" disabled={running} onClick={() => setPreviewTime(active.duration)}>
                    <SkipForward size={14} aria-hidden />
                  </button>
                  <button title="Clear editor preview" disabled={!previewing || running} onClick={() => clearCinematicPreview()}>
                    <RotateCcw size={14} aria-hidden />
                  </button>
                  <output>{beatTime.toFixed(2)}s</output>
                </div>
                <label className="cinematic-scrubber">
                  <span>Scrub</span>
                  <input
                    type="range"
                    min={0}
                    max={active.duration}
                    step={0.01}
                    value={beatTime}
                    disabled={running}
                    onChange={(event) => setPreviewTime(Number(event.target.value))}
                  />
                </label>
                <div className="cinematic-actions-row">
                  <button className="full-button" onClick={() => (running ? stopCinematic() : playCinematic(active.id))}>
                    {running ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
                    {running ? 'Stop' : 'Play'}
                  </button>
                  <button className="full-button danger" onClick={() => deleteCinematic(active.id)}>
                    <Trash2 size={14} aria-hidden />
                    Delete
                  </button>
                </div>

                <div className="cinematic-timeline" aria-label="Cinematic timeline">
                  <div className="cinematic-time-ruler">
                    <span>{running || previewing ? `${beatTime.toFixed(1)}s` : '0s'}</span>
                    <span>{(active.duration / 2).toFixed(1)}s</span>
                    <span>{active.duration.toFixed(1)}s</span>
                  </div>
                  <div className="cinematic-tracks" ref={tracksRef} style={{ height: `${laneLabels.length * 30 + 8}px` }}>
                    {laneLabels.map((label, index) => (
                      <div className="cinematic-lane" key={label} style={{ top: `${index * 30}px` }}>
                        <span>{label}</span>
                      </div>
                    ))}
                    {(running || previewing) && <div className="cinematic-playhead" style={{ left: `${playhead}%` }} />}
                    {active.actions.map((action) => (
                      <button
                        key={action.id}
                        className={`cinematic-clip ${action.type}${action.id === selectedActionId ? ' active' : ''}`}
                        style={timelineStyle(action, active.duration)}
                        title={`${actionTitle(action)} - ${action.time.toFixed(2)}s (drag to retime)`}
                        onPointerDown={(event) => beginClipDrag(event, action)}
                        onPointerMove={onTimelinePointerMove}
                        onPointerUp={() => onTimelinePointerUp(action)}
                      >
                        {actionTitle(action)}
                      </button>
                    ))}
                    {/* Keyframe diamonds for the selected camera/object track — drag to retime each key. */}
                    {selectedAction?.type === 'camera' &&
                      selectedAction.keyframes?.map((frame, index) => (
                        <button
                          key={`ckf-${selectedAction.id}-${index}`}
                          className="cinematic-keyframe-pip"
                          style={{ left: `${Math.min(100, Math.max(0, (frame.time / Math.max(active.duration, 0.5)) * 100))}%`, top: `${timelineLane.camera * 30 + 14}px` }}
                          title={`Keyframe ${index + 1} @ ${frame.time.toFixed(2)}s (drag to move)`}
                          onPointerDown={(event) => {
                            event.stopPropagation();
                            event.currentTarget.setPointerCapture?.(event.pointerId);
                            dragRef.current = { kind: 'ckf', actionId: selectedAction.id, index, startX: event.clientX, startTime: frame.time, moved: false };
                          }}
                          onPointerMove={onTimelinePointerMove}
                          onPointerUp={() => onTimelinePointerUp(selectedAction)}
                        />
                      ))}
                    {selectedAction?.type === 'transform' &&
                      selectedAction.transformKeyframes?.map((frame, index) => (
                        <button
                          key={`tkf-${selectedAction.id}-${index}`}
                          className="cinematic-keyframe-pip"
                          style={{ left: `${Math.min(100, Math.max(0, (frame.time / Math.max(active.duration, 0.5)) * 100))}%`, top: `${timelineLane.transform * 30 + 14}px` }}
                          title={`Keyframe ${index + 1} @ ${frame.time.toFixed(2)}s (drag to move)`}
                          onPointerDown={(event) => {
                            event.stopPropagation();
                            event.currentTarget.setPointerCapture?.(event.pointerId);
                            dragRef.current = { kind: 'tkf', actionId: selectedAction.id, index, startX: event.clientX, startTime: frame.time, moved: false };
                          }}
                          onPointerMove={onTimelinePointerMove}
                          onPointerUp={() => onTimelinePointerUp(selectedAction)}
                        />
                      ))}
                  </div>
                </div>
              </section>

              <section className="inspector-section">
                <h3>Quick Beats</h3>
                <p className="field-hint">Scrub the playhead, frame the shot in the viewport, then keyframe it. The camera flies smoothly through every keyframe.</p>
                <div className="cinematic-quick-grid">
                  <button
                    className="full-button primary"
                    disabled={running || previewing || !editorCameraPose.valid}
                    title="Capture the current viewport framing as a camera keyframe at the playhead"
                    onClick={addCameraKeyframe}
                  >
                    <Camera size={14} aria-hidden />
                    Add camera keyframe
                  </button>
                  <button
                    className="full-button"
                    disabled={!selected || running}
                    title={selected ? `Key ${selected.name}’s transform at the playhead (adds it to the sequence as an animated track)` : 'Select an object in the viewport first'}
                    onClick={keyframeSelectedObject}
                  >
                    {selected ? `Key “${selected.name}”` : 'Key selected object'}
                  </button>
                  <button
                    className="full-button"
                    disabled={running || previewing || !editorCameraPose.valid}
                    title="Add a single static camera shot at the playhead (hard cut / blended)"
                    onClick={addViewportShot}
                  >
                    Capture static shot
                  </button>
                  <button
                    className="full-button"
                    disabled={!selectedCamera}
                    onClick={() => {
                      if (!selectedCamera) return;
                      addBeat({
                        type: 'camera',
                        time: beatTime,
                        duration: Math.max(0.5, active.duration - beatTime),
                        label: selectedCamera.name,
                        objectId: selectedCamera.id,
                        position: selectedCamera.transform.position,
                        rotation: selectedCamera.transform.rotation,
                        lookAt: [0, 1, 0],
                        fov: 50,
                        blend: cameraShotCount > 0 ? 1.2 : 0,
                        ease: 'smooth',
                      });
                    }}
                  >
                    <Eye size={14} aria-hidden />
                    Shot from camera
                  </button>
                  <button
                    className="full-button"
                    disabled={!selected}
                    onClick={() => {
                      if (!selected) return;
                      const p = selected.transform.position;
                      addBeat({
                        type: 'transform',
                        time: beatTime,
                        duration: 1.5,
                        label: `Move ${selected.name}`,
                        objectId: selected.id,
                        fromPosition: selected.transform.position,
                        toPosition: [p[0] + 1.5, p[1], p[2]],
                        fromRotation: selected.transform.rotation,
                        toRotation: selected.transform.rotation,
                        fromScale: selected.transform.scale,
                        toScale: selected.transform.scale,
                      });
                    }}
                  >
                    Move selected
                  </button>
                  <button
                    className="full-button"
                    disabled={!selected}
                    onClick={() => {
                      if (!selected) return;
                      addBeat({
                        type: 'visibility',
                        time: beatTime,
                        label: `Hide ${selected.name}`,
                        objectId: selected.id,
                        visible: false,
                      });
                    }}
                  >
                    Hide selected
                  </button>
                  <button
                    className="full-button"
                    onClick={() => addBeat({ type: 'spawn', time: beatTime, label: 'Spawn cube', spawnKind: 'cube', name: 'Cinematic Cube', position: [0, 1, 0], scale: unitVec })}
                  >
                    Spawn cube
                  </button>
                  <button
                    className="full-button"
                    onClick={() => addBeat({ type: 'event', time: beatTime, label: 'Custom event', eventName: 'cinematic_event' })}
                  >
                    Event
                  </button>
                  <button className="full-button" onClick={addFadeBookends}>
                    Fade in &amp; out
                  </button>
                </div>
              </section>

              {selectedAction && (
                <section className="inspector-section cinematic-action-editor">
                  <div className="cinematic-editor-heading">
                    <h3>Selected Beat</h3>
                    <span>{actionLabel[selectedAction.type]}</span>
                  </div>
                  <div className="cinematic-editor-tools">
                    <button className="full-button" disabled={running} onClick={() => setPreviewTime(selectedAction.time)}>
                      Preview beat
                    </button>
                    <button className="full-button" disabled={running || !previewing} onClick={() => updateSelectedAction({ time: beatTime })}>
                      Set time to preview
                    </button>
                  </div>
                  <label className="field-row">
                    <span>Label</span>
                    <input value={selectedAction.label ?? ''} placeholder={actionLabel[selectedAction.type]} onChange={(event) => updateSelectedAction({ label: event.target.value })} />
                  </label>
                  <label className="field-row">
                    <span>Type</span>
                    <select value={selectedAction.type} onChange={(event) => updateSelectedAction({ type: event.target.value as CinematicActionType })}>
                      {actionTypes.map((type) => (
                        <option key={type} value={type}>
                          {actionLabel[type]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field-row">
                    <span>Time</span>
                    <input type="number" min={0} max={active.duration} step={0.1} value={selectedAction.time} onChange={(event) => updateSelectedAction({ time: Number(event.target.value) })} />
                  </label>
                  <label className="field-row">
                    <span>Length</span>
                    <input type="number" min={0.01} step={0.1} value={selectedAction.duration ?? 0.1} onChange={(event) => updateSelectedAction({ duration: Number(event.target.value) })} />
                  </label>
                  {renderSelectedActionFields()}
                </section>
              )}

              <section className="inspector-section">
                <h3>Actions</h3>
                {active.actions.length === 0 ? (
                  <p className="field-hint">Add quick beats here, or ask the AI to build camera cuts, transforms, animation beats, temporary spawns, sounds, and events.</p>
                ) : (
                  <div className="cinematic-action-list">
                    {active.actions.map((action) => (
                      <div className={`cinematic-action-card${action.id === selectedActionId ? ' active' : ''}`} key={action.id}>
                        <button className="cinematic-action-summary" onClick={() => setSelectedActionId(action.id)}>
                          <strong>{actionTitle(action)}</strong>
                          <span>{action.time.toFixed(2)}s - {actionLabel[action.type]}</span>
                        </button>
                        <button className="icon-button" title="Remove action" onClick={() => removeCinematicAction(active.id, action.id)}>
                          <Trash2 size={13} aria-hidden />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </>
      )}
    </aside>
  );
}
