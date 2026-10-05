import { EffectComposer, Bloom, Vignette, DepthOfField, N8AO, SMAA, SSR, ChromaticAberration } from '@react-three/postprocessing';
import { SMAAPreset, EffectComposer as Composer } from 'postprocessing';
import { Vector2 } from 'three';
import { memo, useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { useEditorStore, selectActiveSceneEnvironment } from '../store/editorStore';
import { ColorGrade, resolveGrade } from './ColorGrade';
import { MotionBlur } from './MotionBlurEffect';
import { Anamorphic } from './AnamorphicEffect';
import { LensDirt } from './LensDirtEffect';
import { VolumetricFog, resolveVolumetric } from './VolumetricFog';
import { qualityProfile } from './quality';
import { installReflectionCompatibility } from './reflectionCompatibility';

// The library's SSR factory keys its GPU effect on the props object identity. Cinematic camera
// updates re-render PostFx every tick; stable scalar props must not rebuild those targets each time.
const StableSSR = memo(SSR);

/**
 * Project post-processing pass, driven by `renderSettings` and the live cinematic. Bloom makes
 * emissive surfaces glow; the cinematic camera adds depth-of-field (rack focus) and a color grade.
 * Reads the runtime cinematic during Play and falls back to the editor scrub preview so grading/DoF
 * show while scrubbing. Mounted inside the Canvas in the player (always) and in the editor whenever
 * Render Look preview is enabled (the default), as well as during cinematic/fog previews. Renders
 * nothing when all FX are off.
 */
export function PostFx() {
  const gl = useThree((state) => state.gl);
  const ssrInstance = useRef<{ dispose(): void } | null>(null);
  const configureSSR = useCallback((effect: unknown) => {
    // R3F does not dispose primitive objects; release the old effect on quality changes/unmount.
    if (ssrInstance.current !== effect) ssrInstance.current?.dispose();
    ssrInstance.current = effect as typeof ssrInstance.current;
    installReflectionCompatibility(effect, gl);
  }, [gl]);
  const rs = useEditorStore((state) => state.renderSettings);
  const pose = useEditorStore((state) =>
    state.runtimeCinematicCamera ?? (state.cinematicViewportMode === 'camera' ? state.editorCinematicPreviewCamera : undefined),
  );
  const look = useEditorStore((state) => state.runtimeCinematicLook ?? state.editorCinematicPreviewLook ?? state.renderSettings.colorGrade);
  const environment = useEditorStore(selectActiveSceneEnvironment);
  const profile = qualityProfile(rs?.quality);
  const composer = useRef<Composer | null>(null);
  const samples = useRef(profile.msaa);
  samples.current = profile.msaa;
  const configureComposer = useCallback((next: Composer | null) => {
    if (composer.current !== next) composer.current?.dispose();
    composer.current = next;
    if (next) next.multisampling = samples.current;
  }, []);
  // The React wrapper recreates its composer when this prop changes, without releasing
  // the old buffers. The composer's own setter resizes its existing buffers safely.
  useLayoutEffect(() => {
    if (composer.current) composer.current.multisampling = profile.msaa;
  }, [profile.msaa]);
  // Reused offset vector — PostFx re-renders every frame during a cinematic (live pose), so allocating
  // a fresh Vector2 per render was steady churn. The effect reads the vector by reference.
  const chromaOffset = useMemo(() => new Vector2(), []);
  const children = [];
  // Ambient occlusion FIRST so the contact-shadow darkening it adds in crevices/corners is in the
  // color buffer before bloom samples luminance. N8AO is a high-quality, depth+normal SSAO; it's
  // gated to the High/Epic presets (half-resolution on High to keep it cheap, full-res on Epic).
  if (profile.ssao && rs?.ambientOcclusionEnabled !== false) {
    children.push(
      <N8AO
        key="ssao"
        aoRadius={Number.isFinite(rs?.ambientOcclusionRadius) ? Math.max(0.05, Math.min(10, rs.ambientOcclusionRadius!)) : 1}
        intensity={Number.isFinite(rs?.ambientOcclusionIntensity) ? Math.max(0, Math.min(5, rs.ambientOcclusionIntensity!)) : 2.2}
        distanceFalloff={1}
        quality={profile.msaa >= 4 ? 'high' : 'medium'}
        halfRes={profile.msaa < 4}
      />,
    );
  }
  // Screen-space reflections: glossy floors / wet streets reflect the scene. The heaviest effect
  // here, so Epic-only. Before bloom, so reflected neon/emissive still glows. Temporal resolve keeps
  // it from being noisy; maxRoughness limits it to fairly smooth surfaces (matte stays matte).
  if (profile.ssr && (!environment?.lux?.enabled || environment.lux.screenTraces !== false)) {
    children.push(
      <StableSSR
        key="ssr"
        ref={configureSSR}
        intensity={1}
        maxRoughness={0.4}
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
        mipmapBlur={profile.bloomMipmap && rs.bloomMipmap !== false}
      />,
    );
  }
  // Cinematic rack-focus: focus on a world point `focusDistance` units ahead of the camera along its
  // look direction; `aperture` is the bokeh strength. Both are splined/blended by the cinematic system.
  // The pass stays mounted for the WHOLE cinematic (any live pose), not just while aperture > 0:
  // adding/removing a pass rebuilds the EffectComposer (framebuffers + shader compile), which landed a
  // visible hitch on every shot transition that toggled DoF. bokehScale 0 renders neutrally instead.
  if (pose) {
    const focusDistance = pose.focusDistance && pose.focusDistance > 0 ? pose.focusDistance : 10;
    const [px, py, pz] = pose.position;
    const [lx, ly, lz] = pose.lookAt;
    const dx = lx - px;
    const dy = ly - py;
    const dz = lz - pz;
    const len = Math.hypot(dx, dy, dz) || 1;
    const target: [number, number, number] = [
      px + (dx / len) * focusDistance,
      py + (dy / len) * focusDistance,
      pz + (dz / len) * focusDistance,
    ];
    children.push(
      <DepthOfField key="dof" target={target} focalLength={0.02} bokehScale={pose.aperture ?? 0} />,
    );
  }
  // Anamorphic bloom streak: bright neon/speculars smear into a horizontal lens flare. After bloom so it
  // streaks already-bloomed highlights. Driven by the cinematic look (runtime or scrub preview).
  if (look?.anamorphic && look.anamorphic > 0.001) {
    children.push(<Anamorphic key="anamorphic" strength={look.anamorphic} />);
  }
  // Lens dirt: procedural grime that lights up where the frame is bright. After bloom/anamorphic so it
  // catches the bloomed highlights.
  if (look?.lensDirt && look.lensDirt > 0.001) {
    children.push(<LensDirt key="lensdirt" strength={look.lensDirt} />);
  }
  // Cinematic camera motion blur (shutter smear along camera moves). Only while a cinematic with a
  // motionBlur look is live (runtime or scrub preview) — never in normal gameplay.
  if (pose && look?.motionBlur && look.motionBlur > 0.001) {
    children.push(<MotionBlur key="motionblur" strength={look.motionBlur} />);
  }
  // Cinematic color grade (exposure / contrast / saturation / temperature / tint), rendered on the
  // cinematic camera. resolveGrade returns null when there's nothing to grade.
  const grade = resolveGrade(look);
  if (grade) {
    children.push(<ColorGrade key="grade" {...grade} />);
  }
  // Chromatic aberration: RGB fringing toward the frame edges (lens / sci-fi look). After the grade so
  // it fringes the final color. radialModulation keeps the center crisp and pushes the split to the edges.
  if (look?.chromaticAberration && look.chromaticAberration > 0.001) {
    const amt = Math.min(1, look.chromaticAberration) * 0.004;
    chromaOffset.set(amt, amt);
    children.push(
      <ChromaticAberration key="chroma" offset={chromaOffset} radialModulation modulationOffset={0.15} />,
    );
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
  // N8AO uses the resolved depth texture and does not support hardware MSAA. SMAA above provides
  // edge smoothing instead. Recreate the pass tree when the quality tier changes so depth-reading
  // passes never retain attachments from the previous compositor.
  return (
    <EffectComposer key={rs?.quality ?? 'High'} ref={configureComposer} multisampling={0}>
      {children}
    </EffectComposer>
  );
}
