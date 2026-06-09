import { forwardRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Uniform } from 'three';
import { Effect } from 'postprocessing';

/**
 * Anamorphic bloom streak for cinematics. Bright highlights (neon signs, lamps, speculars) smear into a
 * wide HORIZONTAL flare streak — the signature anamorphic-lens / neon-cinema look — tinted faintly blue
 * like a real anamorphic element. Runs as a self-contained screen-space pass: it luminance-thresholds the
 * input and convolves the bright residual along a horizontal kernel, then adds that streak back on top.
 *
 * It samples the already-composited buffer (placed after Bloom in the stack), so it streaks light that has
 * already bloomed — cheap, and it reinforces rather than fights the round bloom.
 */
const SAMPLES = 24; // taps to each side; kept constant (GLSL requires a static loop bound)
const fragmentShader = /* glsl */ `
  uniform float intensity;
  uniform float aspect;

  const float THRESHOLD = 0.55;

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    if (intensity <= 0.0) { outputColor = inputColor; return; }

    // Streak half-width in UV space (scaled by aspect so it reads as horizontal regardless of resolution).
    float reach = 0.16 / aspect;
    vec3 streak = vec3(0.0);
    float total = 0.0;
    for (int i = -${SAMPLES}; i <= ${SAMPLES}; i++) {
      float t = float(i) / float(${SAMPLES});
      float w = 1.0 - abs(t);          // triangular falloff toward the streak ends
      vec2 off = vec2(t * reach, 0.0);
      vec3 c = texture(inputBuffer, uv + off).rgb;
      float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
      streak += c * max(0.0, lum - THRESHOLD) * w;
      total += w;
    }
    streak /= total;
    // Faint blue-cyan anamorphic tint, gained by intensity.
    streak *= vec3(0.55, 0.75, 1.0) * (intensity * 6.0);
    outputColor = vec4(inputColor.rgb + streak, inputColor.a);
  }
`;

class AnamorphicEffectImpl extends Effect {
  constructor() {
    super('AnamorphicEffect', fragmentShader, {
      uniforms: new Map<string, Uniform>([
        ['intensity', new Uniform(0)],
        ['aspect', new Uniform(1)],
      ]),
    });
  }
}

/** React wrapper (child of <EffectComposer>). `strength` is the look's `anamorphic` (0–1). */
export const Anamorphic = forwardRef<AnamorphicEffectImpl, { strength: number }>(({ strength }, ref) => {
  const effect = useMemo(() => new AnamorphicEffectImpl(), []);
  useFrame(({ size }) => {
    effect.uniforms.get('intensity')!.value = Math.max(0, strength);
    effect.uniforms.get('aspect')!.value = size.height > 0 ? size.width / size.height : 1;
  });
  return <primitive ref={ref} object={effect} dispose={null} />;
});
Anamorphic.displayName = 'Anamorphic';
