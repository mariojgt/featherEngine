import { EffectComposer, Bloom, Vignette, DepthOfField, N8AO, SMAA, SSR } from '@react-three/postprocessing';
import { SMAAPreset } from 'postprocessing';
import { useEditorStore, selectActiveSceneEnvironment } from '../store/editorStore';
import { ColorGrade, resolveGrade } from './ColorGrade';
import { VolumetricFog, resolveVolumetric } from './VolumetricFog';
import { qualityProfile } from './quality';

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
  const look = useEditorStore((state) => state.runtimeCinematicLook ?? state.editorCinematicPreviewLook ?? state.renderSettings.colorGrade);
  const environment = useEditorStore(selectActiveSceneEnvironment);
  const profile = qualityProfile(rs?.quality);
  const children = [];
  // Ambient occlusion FIRST so the contact-shadow darkening it adds in crevices/corners is in the
  // color buffer before bloom samples luminance. N8AO is a high-quality, depth+normal SSAO; it's
  // gated to the High/Epic presets (half-resolution on High to keep it cheap, full-res on Epic).
  if (profile.ssao) {
    children.push(
      <N8AO
        key="ssao"
        aoRadius={1.0}
        intensity={2.2}
        distanceFalloff={1}
        quality={profile.msaa >= 4 ? 'high' : 'medium'}
        halfRes={profile.msaa < 4}
      />,
    );
  }
  // Screen-space reflections: glossy floors / wet streets reflect the scene. The heaviest effect
  // here, so Epic-only. Before bloom, so reflected neon/emissive still glows. Temporal resolve keeps
  // it from being noisy; maxRoughness limits it to fairly smooth surfaces (matte stays matte).
  if (profile.ssr) {
    children.push(
      <SSR
        key="ssr"
        temporalResolve
        intensity={1}
        maxRoughness={0.4}
        ENABLE_BLUR
        blurMix={0.4}
        maxDepthDifference={10}
        rayStep={0.5}
      />,
    );
  }
  // Unreal-style raymarched volumetric fog: height-based mist, sun in-scattering (glow toward the sun)
  // and — on Epic — god-ray shafts from the sun shadow map. Before bloom so bright shafts/glow bloom.
  // Reads the active scene environment; sample count is tier-driven (off on Low). resolveVolumetric
  // returns null when it shouldn't render at all.
  const volumetric = resolveVolumetric(environment, profile);
  if (volumetric) {
    children.push(<VolumetricFog key="volumetric" {...volumetric} />);
  }
  if (rs?.bloomEnabled) {
    children.push(
      <Bloom
        key="bloom"
        intensity={rs.bloomIntensity}
        luminanceThreshold={rs.bloomThreshold}
        luminanceSmoothing={rs.bloomRadius}
        mipmapBlur={profile.bloomMipmap}
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
  // Edge anti-aliasing LAST, on the final resolved image. On Low/Medium (msaa: 0) this is the only AA
  // the scene gets; on High/Epic it cleans up the shader/specular aliasing multisampling can't touch.
  // Preset scales with the tier (Epic → ULTRA). Cheap relative to MSAA, so it's a near-free quality win.
  if (profile.smaa) {
    children.push(
      <SMAA key="smaa" preset={profile.msaa >= 4 ? SMAAPreset.ULTRA : profile.msaa >= 2 ? SMAAPreset.HIGH : SMAAPreset.MEDIUM} />,
    );
  }
  if (!children.length) return null;
  // MSAA on the composer's HDR target is one of the biggest Play-mode GPU costs (a multisampled float
  // framebuffer + per-frame resolve over the whole screen). 2x keeps edges clean enough while roughly
  // halving that bandwidth vs 4x — a meaningful win on integrated GPUs with little visible quality loss.
  return (
    <EffectComposer multisampling={profile.msaa}>
      {children}
    </EffectComposer>
  );
}
