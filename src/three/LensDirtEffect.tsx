import { forwardRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Uniform } from 'three';
import { Effect } from 'postprocessing';

/**
 * Procedural lens dirt for cinematics. Real lenses have smudges/specks that LIGHT UP when a bright source
 * shines through them — that subtle "grime catching the bloom" is a big chunk of the expensive-camera look.
 * This generates the dirt pattern in-shader (no texture asset needed) and makes it glow in proportion to how
 * bright the frame is at each spot, so dirt only shows where neon/highlights hit it. Placed after Bloom so it
 * reacts to the bloomed brights; warm-tinted like real coated glass.
 */
const fragmentShader = /* glsl */ `
  uniform float intensity;
  uniform float aspect;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  // Static (screen-locked) grime: broad smudges + a sprinkle of fine specks.
  float dirtPattern(vec2 uv) {
    vec2 p = uv * vec2(aspect, 1.0);
    float smudge = smoothstep(0.5, 0.95, vnoise(p * 4.5)) * 0.7;
    smudge += smoothstep(0.6, 1.0, vnoise(p * 11.0 + 19.3)) * 0.3;
    float speck = smoothstep(0.92, 1.0, hash(floor(p * 130.0)));
    return clamp(smudge + speck, 0.0, 1.0);
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    if (intensity <= 0.0) { outputColor = inputColor; return; }
    float lum = dot(inputColor.rgb, vec3(0.2126, 0.7152, 0.0722));
    float glow = max(0.0, lum - 0.5); // only bright (bloomed) areas reveal the grime
    float dirt = dirtPattern(uv) * glow * intensity * 3.0;
    outputColor = vec4(inputColor.rgb + vec3(1.0, 0.94, 0.82) * dirt, inputColor.a);
  }
`;

class LensDirtEffectImpl extends Effect {
  constructor() {
    super('LensDirtEffect', fragmentShader, {
      uniforms: new Map<string, Uniform>([
        ['intensity', new Uniform(0)],
        ['aspect', new Uniform(1)],
      ]),
    });
  }
}

/** React wrapper (child of <EffectComposer>). `strength` is the look's `lensDirt` (0–1). */
export const LensDirt = forwardRef<LensDirtEffectImpl, { strength: number }>(({ strength }, ref) => {
  const effect = useMemo(() => new LensDirtEffectImpl(), []);
  useFrame(({ size }) => {
    effect.uniforms.get('intensity')!.value = Math.max(0, strength);
    effect.uniforms.get('aspect')!.value = size.height > 0 ? size.width / size.height : 1;
  });
  return <primitive ref={ref} object={effect} dispose={null} />;
});
LensDirt.displayName = 'LensDirt';
