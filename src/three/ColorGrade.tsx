import { forwardRef, useMemo } from 'react';
import { Color, Uniform } from 'three';
import { Effect } from 'postprocessing';
import type { CinematicGrade, CinematicLook } from '../types';

/** Fully-resolved grade parameters fed to the shader (preset + manual overrides, already merged). */
export interface GradeParams {
  exposure: number;
  contrast: number;
  saturation: number;
  temperature: number;
  tint: string;
  tintAmount: number;
  intensity: number;
}

/**
 * Preset → grade-param bundles. Selecting a preset in the panel writes these explicit values onto the
 * look (so the sliders reflect them); `resolveGrade` also falls back to them when a look only carries a
 * `grade` (e.g. set by the AI or a template). `custom`/`none` carry no preset values.
 */
export const GRADE_PRESETS: Record<CinematicGrade, Omit<GradeParams, 'intensity'>> = {
  none: { exposure: 0, contrast: 0, saturation: 0, temperature: 0, tint: '#ffffff', tintAmount: 0 },
  custom: { exposure: 0, contrast: 0, saturation: 0, temperature: 0, tint: '#ffffff', tintAmount: 0 },
  warm: { exposure: 0.04, contrast: 0.06, saturation: 0.12, temperature: 0.35, tint: '#ffb060', tintAmount: 0.1 },
  'teal-orange': { exposure: 0.02, contrast: 0.14, saturation: 0.3, temperature: 0.18, tint: '#ff8a3d', tintAmount: 0.08 },
  cool: { exposure: 0, contrast: 0.05, saturation: 0.08, temperature: -0.3, tint: '#7fb2ff', tintAmount: 0.1 },
  noir: { exposure: -0.02, contrast: 0.26, saturation: -1, temperature: 0, tint: '#ffffff', tintAmount: 0 },
  sepia: { exposure: 0.02, contrast: 0.06, saturation: -0.6, temperature: 0.3, tint: '#a07a3c', tintAmount: 0.4 },
};

/**
 * Resolve a look into the grade params the shader needs, or `null` when there's nothing to grade.
 * Starts from the preset, then overlays any explicitly-set manual fields on the look. Enabled when a
 * non-`none` preset is chosen OR any manual grade field is set.
 */
export function resolveGrade(look: CinematicLook | undefined): GradeParams | null {
  if (!look) return null;
  const base = GRADE_PRESETS[look.grade ?? 'none'] ?? GRADE_PRESETS.none;
  const params: GradeParams = {
    exposure: look.exposure ?? base.exposure,
    contrast: look.contrast ?? base.contrast,
    saturation: look.saturation ?? base.saturation,
    temperature: look.temperature ?? base.temperature,
    tint: look.tint ?? base.tint,
    tintAmount: look.tintAmount ?? base.tintAmount,
    intensity: look.gradeIntensity ?? 1,
  };
  const presetActive = Boolean(look.grade && look.grade !== 'none');
  const manualActive =
    look.exposure !== undefined ||
    look.contrast !== undefined ||
    look.saturation !== undefined ||
    look.temperature !== undefined ||
    (look.tint !== undefined && (look.tintAmount ?? 0) > 0);
  if ((!presetActive && !manualActive) || params.intensity <= 0.001) return null;
  return params;
}

const fragmentShader = /* glsl */ `
  uniform float exposure;
  uniform float contrast;
  uniform float saturation;
  uniform float temperature;
  uniform vec3 tintColor;
  uniform float tintAmount;
  uniform float intensity;

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec3 c = inputColor.rgb;

    // Exposure (stops).
    c *= pow(2.0, exposure);

    // Temperature: warm pushes red up / blue down, cool the reverse.
    c.r += temperature * 0.10;
    c.b -= temperature * 0.10;

    // Contrast around mid-grey.
    c = (c - 0.5) * (1.0 + contrast) + 0.5;

    // Saturation around luma.
    float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(luma), c, 1.0 + saturation);

    // Custom tint (multiply toward the tint colour).
    c = mix(c, c * tintColor, tintAmount);

    // Overall strength: blend graded result back toward the original.
    c = mix(inputColor.rgb, c, intensity);

    outputColor = vec4(clamp(c, 0.0, 1.0), inputColor.a);
  }
`;

/** A custom post-processing color-grade effect (exposure / contrast / saturation / temperature / tint). */
class ColorGradeEffect extends Effect {
  constructor() {
    super('ColorGradeEffect', fragmentShader, {
      uniforms: new Map<string, Uniform>([
        ['exposure', new Uniform(0)],
        ['contrast', new Uniform(0)],
        ['saturation', new Uniform(0)],
        ['temperature', new Uniform(0)],
        ['tintColor', new Uniform(new Color('#ffffff'))],
        ['tintAmount', new Uniform(0)],
        ['intensity', new Uniform(1)],
      ]),
    });
  }
}

/**
 * React wrapper for the color-grade effect, used as a child of <EffectComposer>. Updates uniforms in
 * place each render (the effect instance is created once) so changing the grade never rebuilds the
 * composer.
 */
export const ColorGrade = forwardRef<ColorGradeEffect, GradeParams>((params, ref) => {
  const effect = useMemo(() => new ColorGradeEffect(), []);
  const u = effect.uniforms;
  u.get('exposure')!.value = params.exposure;
  u.get('contrast')!.value = params.contrast;
  u.get('saturation')!.value = params.saturation;
  u.get('temperature')!.value = params.temperature;
  (u.get('tintColor')!.value as Color).set(params.tint || '#ffffff');
  u.get('tintAmount')!.value = params.tintAmount;
  u.get('intensity')!.value = params.intensity;
  return <primitive ref={ref} object={effect} dispose={null} />;
});
ColorGrade.displayName = 'ColorGrade';
