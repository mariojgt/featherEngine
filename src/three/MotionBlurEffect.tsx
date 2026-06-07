import { forwardRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Matrix4, Uniform } from 'three';
import { Effect, EffectAttribute } from 'postprocessing';

/**
 * Camera motion blur (shutter smear) for cinematics. Reconstructs each pixel's world position from the
 * depth buffer (same trick as VolumetricFog), reprojects it through the PREVIOUS frame's view-projection
 * to get a per-pixel screen-space velocity, then averages a short trail of samples along that velocity.
 * This blurs along camera motion (pans / dollies / crane moves) — the dominant cinematic case — without
 * needing a full per-object velocity buffer. Object-only motion past a locked camera is not blurred.
 *
 * Hard cuts produce a huge reprojection delta; the shader detects that (`speed > 0.3`) and skips the
 * blur so a cut stays crisp. The blur length is clamped so even fast moves never smear the whole screen.
 */
const fragmentShader = /* glsl */ `
  uniform mat4 inverseProjection;
  uniform mat4 cameraMatrixWorld;
  uniform mat4 prevViewProjection;
  uniform float intensity;

  void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
    if (intensity <= 0.0) { outputColor = inputColor; return; }

    // World-space point under this pixel, reconstructed from the depth buffer.
    vec3 ndc = vec3(uv * 2.0 - 1.0, depth * 2.0 - 1.0);
    vec4 viewPos = inverseProjection * vec4(ndc, 1.0);
    viewPos /= viewPos.w;
    vec4 worldPos = cameraMatrixWorld * vec4(viewPos.xyz, 1.0);

    // Where that same point sat on screen last frame → screen-space velocity.
    vec4 prevClip = prevViewProjection * worldPos;
    vec2 prevUv = (prevClip.xy / prevClip.w) * 0.5 + 0.5;
    vec2 velocity = (uv - prevUv) * intensity;

    float speed = length(velocity);
    // Below a threshold there's nothing to blur; above a large one it's a hard cut → keep it crisp.
    if (speed < 0.0004 || speed > 0.3) { outputColor = inputColor; return; }
    // Clamp the smear so even a whip-pan never streaks across the whole frame.
    velocity = velocity / speed * min(speed, 0.06);

    vec4 acc = inputColor;
    for (int i = 1; i < 8; i++) {
      vec2 off = velocity * (float(i) / 8.0);
      acc += texture(inputBuffer, uv - off);
    }
    outputColor = acc / 8.0;
  }
`;

class MotionBlurEffectImpl extends Effect {
  constructor() {
    super('MotionBlurEffect', fragmentShader, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, Uniform>([
        ['inverseProjection', new Uniform(new Matrix4())],
        ['cameraMatrixWorld', new Uniform(new Matrix4())],
        ['prevViewProjection', new Uniform(new Matrix4())],
        ['intensity', new Uniform(0)],
      ]),
    });
  }
}

/**
 * React wrapper for the motion-blur effect (child of <EffectComposer>). The effect instance is created
 * once; camera matrices and the previous-frame view-projection are refreshed every frame. `strength` is
 * the look's `motionBlur` (0–1), scaled to a filmic shutter smear.
 */
export const MotionBlur = forwardRef<MotionBlurEffectImpl, { strength: number }>(({ strength }, ref) => {
  const effect = useMemo(() => new MotionBlurEffectImpl(), []);
  // Previous frame's view-projection, kept across frames so the shader can reproject (allocated once).
  const prevVP = useMemo(() => new Matrix4(), []);
  const curVP = useMemo(() => new Matrix4(), []);
  const hasPrev = useMemo(() => ({ value: false }), []);

  useFrame(({ camera }) => {
    const u = effect.uniforms;
    u.get('intensity')!.value = Math.max(0, strength) * 4.0;
    (u.get('inverseProjection')!.value as Matrix4).copy(camera.projectionMatrixInverse);
    (u.get('cameraMatrixWorld')!.value as Matrix4).copy(camera.matrixWorld);
    // Current view-projection = projection * inverse(world).
    curVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    // Feed last frame's VP for reprojection; first frame uses the current one (zero velocity).
    (u.get('prevViewProjection')!.value as Matrix4).copy(hasPrev.value ? prevVP : curVP);
    prevVP.copy(curVP);
    hasPrev.value = true;
  });

  return <primitive ref={ref} object={effect} dispose={null} />;
});
MotionBlur.displayName = 'MotionBlur';
