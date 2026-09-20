import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ParticleConfig, SceneObject } from '../types';
import { useEditorStore } from '../store/editorStore';
import { subscribeParticles } from '../runtime/particleBus';
import { resolveParticleConfig } from '../runtime/particlePresets';

/** Hard ceiling on GPU-simulated particles per emitter (analytic sim is cheap, but keep uploads sane). */
const GPU_MAX = 100000;

/** 1×1 white fallback so the sampler is always bound even when no sprite texture is assigned. */
const WHITE_TEXTURE = (() => {
  const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
})();

// Every particle's motion is computed in the vertex shader from a single uTime uniform: age loops via a
// per-particle phase offset, position is the analytic ballistic path (initial velocity + drag + gravity),
// and size/color/opacity interpolate over normalized age. The CPU only advances uTime — no per-particle
// work, no attribute re-uploads — so counts in the tens of thousands stay cheap.
const VERTEX_SHADER = /* glsl */ `
  attribute vec3 aSpawn;
  attribute vec3 aVel;
  attribute float aPhase;
  attribute float aRand;
  uniform float uTime;
  uniform float uLife;
  uniform float uGravity;
  uniform float uDrag;
  uniform float uStartSize;
  uniform float uEndSize;
  uniform vec3 uStartColor;
  uniform vec3 uEndColor;
  uniform float uStartOpacity;
  uniform float uEndOpacity;
  uniform float uProjScale;
  varying vec4 vColor;
  void main() {
    float t = fract(uTime / uLife + aPhase);      // normalized age in [0,1), staggered per particle
    float age = t * uLife;
    vec3 disp;
    if (uDrag > 0.001) {
      disp = aVel * (1.0 - exp(-uDrag * age)) / uDrag;   // exponential drag toward a terminal offset
    } else {
      disp = aVel * age;
    }
    disp.y -= 0.5 * uGravity * age * age;
    vec3 pos = aSpawn + disp;
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    float size = mix(uStartSize, uEndSize, t) * (0.7 + 0.6 * aRand);
    gl_PointSize = clamp(size * uProjScale / max(0.001, -mv.z), 0.0, 320.0);
    gl_Position = projectionMatrix * mv;
    vec3 col = mix(uStartColor, uEndColor, t);
    float alpha = mix(uStartOpacity, uEndOpacity, t);
    alpha *= smoothstep(0.0, 0.08, t) * smoothstep(1.0, 0.85, t); // soft birth/death for a seamless loop
    vColor = vec4(col, alpha);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  precision mediump float;
  varying vec4 vColor;
  uniform sampler2D uTexture;
  uniform float uHasTexture;
  void main() {
    vec4 c = vColor;
    if (uHasTexture > 0.5) {
      c *= texture2D(uTexture, gl_PointCoord);
    } else {
      float d = length(gl_PointCoord - vec2(0.5));
      c.a *= smoothstep(0.5, 0.35, d);
    }
    if (c.a < 0.01) discard;
    gl_FragColor = c;
  }
`;

const _v = new THREE.Vector3();
const _axis = new THREE.Vector3(0, 0, 1);
const _quat = new THREE.Quaternion();

function sampleConeDir(base: THREE.Vector3, angleDeg: number, out: THREE.Vector3) {
  if (angleDeg <= 0.001) return out.copy(base);
  const a = (angleDeg * Math.PI) / 180;
  const cosA = Math.cos(a);
  const z = cosA + (1 - cosA) * Math.random();
  const phi = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  out.set(r * Math.cos(phi), r * Math.sin(phi), z);
  _quat.setFromUnitVectors(_axis, base);
  return out.applyQuaternion(_quat);
}

/** Bakes the per-particle spawn positions + velocities once (mirrors the CPU emitter's shape sampling). */
function buildGeometry(cfg: ParticleConfig, count: number): THREE.BufferGeometry {
  const spawn = new Float32Array(count * 3);
  const vel = new Float32Array(count * 3);
  const phase = new Float32Array(count);
  const rand = new Float32Array(count);
  const base = new THREE.Vector3(cfg.direction[0], cfg.direction[1], cfg.direction[2]);
  if (base.lengthSq() < 1e-6) base.set(0, 1, 0);
  base.normalize();
  const dir = new THREE.Vector3();
  const r = cfg.shapeRadius;
  for (let i = 0; i < count; i++) {
    // Local spawn position by shape.
    switch (cfg.shape) {
      case 'sphere':
      case 'hemisphere': {
        const u = Math.random();
        const v = Math.random();
        const theta = u * Math.PI * 2;
        const phi = Math.acos(2 * v - 1);
        const rr = r * Math.cbrt(Math.random());
        let y = rr * Math.cos(phi);
        if (cfg.shape === 'hemisphere') y = Math.abs(y);
        _v.set(rr * Math.sin(phi) * Math.cos(theta), y, rr * Math.sin(phi) * Math.sin(theta));
        break;
      }
      case 'box':
        _v.set((Math.random() * 2 - 1) * r, (Math.random() * 2 - 1) * r * 0.08, (Math.random() * 2 - 1) * r);
        break;
      case 'disc':
      case 'cone': {
        const ang = Math.random() * Math.PI * 2;
        const rr = r * Math.sqrt(Math.random());
        _v.set(Math.cos(ang) * rr, 0, Math.sin(ang) * rr);
        break;
      }
      default:
        _v.set(0, 0, 0);
    }
    spawn[i * 3] = _v.x;
    spawn[i * 3 + 1] = _v.y;
    spawn[i * 3 + 2] = _v.z;
    if ((cfg.shape === 'sphere' || cfg.shape === 'hemisphere') && _v.lengthSq() > 1e-6) {
      dir.copy(_v).normalize();
    } else {
      sampleConeDir(base, cfg.coneAngle, dir);
    }
    const speed = cfg.speed * (1 + (Math.random() * 2 - 1) * cfg.speedJitter);
    vel[i * 3] = dir.x * speed;
    vel[i * 3 + 1] = dir.y * speed;
    vel[i * 3 + 2] = dir.z * speed;
    phase[i] = Math.random(); // stagger so the loop is a steady stream, not a pulse
    rand[i] = Math.random();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(spawn, 3)); // position unused by shader but required
  geometry.setAttribute('aSpawn', new THREE.BufferAttribute(spawn, 3));
  geometry.setAttribute('aVel', new THREE.BufferAttribute(vel, 3));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  geometry.setAttribute('aRand', new THREE.BufferAttribute(rand, 1));
  return geometry;
}

/**
 * GPU-simulated particle emitter — the high-count sibling of ParticleSystem. Selected when the emitter's
 * `gpu` flag is on. A continuous looping fountain simulated entirely in the vertex shader (see above), so
 * it scales to tens of thousands of particles cheaply. Local space only; ignores discrete bursts. Rebuilds
 * its baked geometry only when a config field that affects spawn positions/velocities changes.
 */
export function GPUParticleSystem({ object }: { object: SceneObject }) {
  const particleSystems = useEditorStore((state) => state.particleSystems);
  const config = resolveParticleConfig(object.particles, particleSystems);
  const configRef = useRef(config);
  configRef.current = config;

  const count = Math.max(1, Math.min(GPU_MAX, Math.floor(config.maxParticles)));
  // Rebuild the baked attributes only when a spawn-affecting field changes (not every color/size tweak).
  const geomKey = `${count}|${config.shape}|${config.shapeRadius}|${config.coneAngle}|${config.speed}|${config.speedJitter}|${config.direction.join(',')}`;
  const geometry = useMemo(() => buildGeometry(configRef.current, count), [geomKey, count]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uLife: { value: 1.2 },
          uGravity: { value: 0 },
          uDrag: { value: 0 },
          uStartSize: { value: 0.3 },
          uEndSize: { value: 0.05 },
          uStartColor: { value: new THREE.Color('#ffd27f') },
          uEndColor: { value: new THREE.Color('#ff5722') },
          uStartOpacity: { value: 1 },
          uEndOpacity: { value: 0 },
          uProjScale: { value: 600 },
          uTexture: { value: WHITE_TEXTURE },
          uHasTexture: { value: 0 },
        },
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        depthTest: true,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => {
    material.blending = config.blend === 'normal' ? THREE.NormalBlending : THREE.AdditiveBlending;
  }, [material, config.blend]);

  // Optional sprite texture (same resolution path as the CPU emitter).
  const textureId = config.textureAssetId;
  const textureUrl = useEditorStore((state) => {
    if (!textureId) return undefined;
    const asset = state.assets.find((a) => a.id === textureId);
    return asset?.url ?? asset?.data;
  });
  useEffect(() => {
    if (!textureUrl) {
      material.uniforms.uTexture.value = WHITE_TEXTURE;
      material.uniforms.uHasTexture.value = 0;
      return;
    }
    let cancelled = false;
    new THREE.TextureLoader().load(textureUrl, (tex) => {
      if (cancelled) {
        tex.dispose();
        return;
      }
      material.uniforms.uTexture.value = tex;
      material.uniforms.uHasTexture.value = 1;
    });
    return () => {
      cancelled = true;
    };
  }, [material, textureUrl]);

  const pointsRef = useRef<THREE.Points>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const emitting = useRef(config.enabled);
  const uTime = useRef(0);

  // Set Particles Emitting bus command freezes/resumes the fountain (Burst is ignored in GPU mode).
  useEffect(() => {
    return subscribeParticles(object.id, (cmd) => {
      if (cmd.type === 'emit') emitting.current = cmd.on;
    });
  }, [object.id]);

  useFrame((state, rawDelta) => {
    const cfg = configRef.current;
    const pts = pointsRef.current;
    if (!pts) return;
    const playing = useEditorStore.getState().isPlaying;
    const active = playing ? emitting.current : cfg.enabled;
    pts.visible = active;
    if (!active) {
      if (lightRef.current) lightRef.current.intensity = 0;
      return;
    }
    uTime.current = playing ? useEditorStore.getState().runtimeTime : uTime.current + Math.min(rawDelta, 0.05);
    const u = material.uniforms;
    u.uTime.value = uTime.current;
    u.uLife.value = Math.max(0.05, cfg.lifetime);
    u.uGravity.value = cfg.gravity;
    u.uDrag.value = Math.max(0, cfg.drag);
    u.uStartSize.value = cfg.startSize;
    u.uEndSize.value = cfg.endSize;
    (u.uStartColor.value as THREE.Color).set(cfg.startColor);
    (u.uEndColor.value as THREE.Color).set(cfg.endColor);
    u.uStartOpacity.value = cfg.startOpacity;
    u.uEndOpacity.value = cfg.endOpacity;
    const cam = state.camera as THREE.PerspectiveCamera;
    u.uProjScale.value = cam.isPerspectiveCamera
      ? state.size.height / (2 * Math.tan((cam.fov * Math.PI) / 360))
      : state.size.height;
    if (lightRef.current) {
      lightRef.current.color.set(cfg.startColor);
      lightRef.current.intensity = cfg.light ? 3 : 0;
    }
  });

  return (
    <>
      {config.light && (
        <pointLight ref={lightRef} color={config.startColor} intensity={0} distance={config.shapeRadius * 5 + 5} decay={2} />
      )}
      <points ref={pointsRef} geometry={geometry} material={material} frustumCulled={false} />
    </>
  );
}
