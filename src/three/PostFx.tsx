import { EffectComposer, Bloom, Vignette, DepthOfField } from '@react-three/postprocessing';
import { useEditorStore } from '../store/editorStore';
import { ColorGrade, resolveGrade } from './ColorGrade';

/**
 * Project post-processing pass, driven by `renderSettings` and the live cinematic. Bloom makes
 * emissive surfaces glow; the cinematic camera adds depth-of-field (rack focus) and a color grade.
 * Reads the runtime cinematic during Play and falls back to the editor scrub preview so grading/DoF
 * show while scrubbing. Mounted inside the Canvas in the player (always) and the editor viewport
 * (during Play or cinematic preview). Renders nothing when all FX are off.
 */
export function PostFx() {
  const rs = useEditorStore((state) => state.renderSettings);
  const pose = useEditorStore((state) => state.runtimeCinematicCamera ?? state.editorCinematicPreviewCamera);
  const look = useEditorStore((state) => state.runtimeCinematicLook ?? state.editorCinematicPreviewLook);
  const children = [];
  if (rs?.bloomEnabled) {
    children.push(
      <Bloom
        key="bloom"
        intensity={rs.bloomIntensity}
        luminanceThreshold={rs.bloomThreshold}
        luminanceSmoothing={rs.bloomRadius}
        mipmapBlur
      />,
    );
  }
  // Cinematic rack-focus: focus on a world point `focusDistance` units ahead of the camera along its
  // look direction; `aperture` is the bokeh strength. Both are splined/blended by the cinematic system.
  if (pose && pose.aperture && pose.aperture > 0.001 && pose.focusDistance && pose.focusDistance > 0) {
    const [px, py, pz] = pose.position;
    const [lx, ly, lz] = pose.lookAt;
    const dx = lx - px;
    const dy = ly - py;
    const dz = lz - pz;
    const len = Math.hypot(dx, dy, dz) || 1;
    const target: [number, number, number] = [
      px + (dx / len) * pose.focusDistance,
      py + (dy / len) * pose.focusDistance,
      pz + (dz / len) * pose.focusDistance,
    ];
    children.push(
      <DepthOfField key="dof" target={target} focalLength={0.02} bokehScale={pose.aperture} />,
    );
  }
  // Cinematic color grade (exposure / contrast / saturation / temperature / tint), rendered on the
  // cinematic camera. resolveGrade returns null when there's nothing to grade.
  const grade = resolveGrade(look);
  if (grade) {
    children.push(<ColorGrade key="grade" {...grade} />);
  }
  if (rs?.vignetteEnabled) {
    children.push(<Vignette key="vignette" offset={0.32} darkness={0.72} eskil={false} />);
  }
  if (!children.length) return null;
  return (
    <EffectComposer multisampling={4}>
      {children}
    </EffectComposer>
  );
}
