import { useEffect, useRef } from 'react';
import { editorViewOrientation, type ViewPreset } from '../three/EditorCamera';

/**
 * Corner orientation cube + view presets (Unreal/Blender style). The CSS-3D cube mirrors the live
 * editor-camera orientation (read each frame from `editorViewOrientation`); clicking a face — or a
 * preset button — asks the camera to snap to that standard view via `onView`.
 */
const FACES: Array<{ view: ViewPreset; label: string; transform: string }> = [
  { view: 'front', label: 'FRONT', transform: 'translateZ(26px)' },
  { view: 'back', label: 'BACK', transform: 'rotateY(180deg) translateZ(26px)' },
  { view: 'right', label: 'RIGHT', transform: 'rotateY(90deg) translateZ(26px)' },
  { view: 'left', label: 'LEFT', transform: 'rotateY(-90deg) translateZ(26px)' },
  { view: 'top', label: 'TOP', transform: 'rotateX(90deg) translateZ(26px)' },
  { view: 'bottom', label: 'BOT', transform: 'rotateX(-90deg) translateZ(26px)' },
];

const PRESETS: Array<{ view: ViewPreset; label: string }> = [
  { view: 'persp', label: 'Persp' },
  { view: 'top', label: 'Top' },
  { view: 'front', label: 'Front' },
  { view: 'right', label: 'Side' },
];

export function ViewCube({ onView }: { onView: (view: ViewPreset) => void }) {
  const cubeRef = useRef<HTMLDivElement>(null);

  // Mirror the camera orientation every frame.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const cube = cubeRef.current;
      if (cube) {
        const { yaw, pitch } = editorViewOrientation;
        cube.style.transform = `rotateX(${-pitch}rad) rotateY(${-yaw}rad)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="view-cube">
      <div className="view-cube-scene">
        <div className="view-cube-cube" ref={cubeRef}>
          {FACES.map((face) => (
            <button
              key={face.view}
              className="view-cube-face"
              style={{ transform: face.transform }}
              title={`${face.label} view`}
              onClick={() => onView(face.view)}
              onMouseDown={(event) => event.stopPropagation()}
            >
              {face.label}
            </button>
          ))}
        </div>
      </div>
      <div className="view-cube-presets" onMouseDown={(event) => event.stopPropagation()}>
        {PRESETS.map((preset) => (
          <button key={preset.label} title={`${preset.label} view`} onClick={() => onView(preset.view)}>
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}
