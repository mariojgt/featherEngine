import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ParticleSystemComponent, SceneObject } from '../types';
import { useEditorStore } from '../store/editorStore';
import { subscribeParticles } from '../runtime/particleBus';
import { resolveParticleConfig } from '../runtime/particlePresets';

/** 1×1 white fallback so the sampler is always bound even when no sprite texture is assigned. */
const WHITE_TEXTURE = (() => {
  const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
})();

const VERTEX_SHADER = /* glsl */ `
  attribute vec4 aColor;
  attribute float aSize;
  varying vec4 vColor;
  uniform float uProjScale;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = min(aSize * uProjScale / max(0.001, -mv.z), 320.0);
    gl_Position = projectionMatrix * mv;
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

// Scratch objects reused every frame to avoid per-particle allocation.
const _pos = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _axis = new THREE.Vector3(0, 0, 1);
const _quat = new THREE.Quaternion();
const _parentMat = new THREE.Matrix4();
const _invParentMat = new THREE.Matrix4();
const _parentQuat = new THREE.Quaternion();
const _parentPos = new THREE.Vector3();
const _parentScale = new THREE.Vector3();
const _startColor = new THREE.Color();
const _endColor = new THREE.Color();
const _color = new THREE.Color();
const _baseDir = new THREE.Vector3();

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Samples a unit direction within `angleDeg` of `base` (base is normalized). */
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

interface Pool {
  px: Float32Array; py: Float32Array; pz: Float32Array;
  vx: Float32Array; vy: Float32Array; vz: Float32Array;
  age: Float32Array; life: Float32Array;
  geometry: THREE.BufferGeometry;
  posAttr: THREE.BufferAttribute;
  colorAttr: THREE.BufferAttribute;
  sizeAttr: THREE.BufferAttribute;
}

function makePool(n: number): Pool {
  const positions = new Float32Array(n * 3);
  const colors = new Float32Array(n * 4);
  const sizes = new Float32Array(n);
  const geometry = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  const colorAttr = new THREE.BufferAttribute(colors, 4);
  const sizeAttr = new THREE.BufferAttribute(sizes, 1);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  colorAttr.setUsage(THREE.DynamicDrawUsage);
  sizeAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', posAttr);
  geometry.setAttribute('aColor', colorAttr);
  geometry.setAttribute('aSize', sizeAttr);
  return {
    px: new Float32Array(n), py: new Float32Array(n), pz: new Float32Array(n),
    vx: new Float32Array(n), vy: new Float32Array(n), vz: new Float32Array(n),
    age: new Float32Array(n), life: new Float32Array(n),
    geometry, posAttr, colorAttr, sizeAttr,
  };
}

/**
 * Renders + simulates one authored particle emitter. Mounted inside the owning object's group, so it
 * inherits the object's transform; with `worldSpace` it counter-transforms so particles stay put in the
 * world as the emitter moves. Lives in both the editor viewport (live preview) and the game player.
 */
export function ParticleSystem({ object }: { object: SceneObject }) {
  const particleSystems = useEditorStore((state) => state.particleSystems);
  const config = resolveParticleConfig(object.particles, particleSystems);
  const configRef = useRef(config);
  configRef.current = config;

  const max = Math.max(1, Math.min(4000, Math.floor(config.maxParticles)));
  const pool = useMemo(() => makePool(max), [max]);
  useEffect(() => () => pool.geometry.dispose(), [pool]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTexture: { value: WHITE_TEXTURE },
          uHasTexture: { value: 0 },
          uProjScale: { value: 600 },
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

  // Resolve an optional sprite texture from the project assets (image asset → url/data).
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
  const emitAccum = useRef(0);
  const pendingBurst = useRef(0);
  const previewTimer = useRef(0);
  const emitting = useRef(config.enabled);
  const prevPlaying = useRef(false);
  const cursor = useRef(0);
  /** Live particles after the previous sim step — lets a dormant emitter skip its frame entirely. */
  const aliveRef = useRef(0);

  // Blueprint / runtime commands (Burst Particles, Set Particles Emitting).
  useEffect(() => {
    return subscribeParticles(object.id, (cmd) => {
      if (cmd.type === 'emit') emitting.current = cmd.on;
      else pendingBurst.current += Math.max(1, Math.floor((cmd.count ?? configRef.current.burst) || 12));
    });
  }, [object.id]);

  useFrame((state, rawDelta) => {
    const cfg = configRef.current;
    const pts = pointsRef.current;
    if (!pts) return;
    const delta = Math.min(rawDelta, 0.05); // clamp to avoid bursts of motion after a stall
    const playing = useEditorStore.getState().isPlaying;
    const n = max;

    // Reset emission state cleanly on each Play/Stop transition.
    if (playing !== prevPlaying.current) {
      prevPlaying.current = playing;
      emitting.current = cfg.enabled;
      emitAccum.current = 0;
      previewTimer.current = 0;
      if (playing) {
        for (let i = 0; i < n; i++) pool.life[i] = 0;
        if (cfg.enabled && cfg.burst > 0) pendingBurst.current += cfg.burst;
        aliveRef.current = 0;
      }
    }

    // IDLE EARLY-OUT (perf): a dormant emitter — nothing alive, nothing queued, not emitting — costs
    // NOTHING. Previously every emitter walked all maxParticles slots and re-uploaded three GPU
    // attributes every frame, even switched off (the sim template alone idles several 900-slot pools).
    // The last sim pass already zeroed the buffers, so the uploaded state is clean to leave as-is.
    if (playing && !emitting.current && pendingBurst.current <= 0 && aliveRef.current === 0) {
      if (lightRef.current) lightRef.current.intensity = 0;
      return;
    }

    // Parent (the object's group) world transform — needed for world-space simulation.
    const worldSpace = cfg.worldSpace;
    const parent = pts.parent;
    if (worldSpace && parent) {
      parent.updateWorldMatrix(true, false);
      _parentMat.copy(parent.matrixWorld);
      _invParentMat.copy(_parentMat).invert();
      _parentMat.decompose(_parentPos, _parentQuat, _parentScale);
    }

    _baseDir.set(cfg.direction[0], cfg.direction[1], cfg.direction[2]);
    if (_baseDir.lengthSq() < 1e-6) _baseDir.set(0, 1, 0);
    _baseDir.normalize();
    _startColor.set(cfg.startColor);
    _endColor.set(cfg.endColor);

    const spawnOne = () => {
      const slot = cursor.current;
      cursor.current = (cursor.current + 1) % n;
      const r = cfg.shapeRadius;
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
          _pos.set(rr * Math.sin(phi) * Math.cos(theta), y, rr * Math.sin(phi) * Math.sin(theta));
          break;
        }
        case 'box':
          _pos.set((Math.random() * 2 - 1) * r, (Math.random() * 2 - 1) * r * 0.08, (Math.random() * 2 - 1) * r);
          break;
        case 'disc': {
          const ang = Math.random() * Math.PI * 2;
          const rr = r * Math.sqrt(Math.random());
          _pos.set(Math.cos(ang) * rr, 0, Math.sin(ang) * rr);
          break;
        }
        case 'cone': {
          const ang = Math.random() * Math.PI * 2;
          const rr = r * Math.sqrt(Math.random());
          _pos.set(Math.cos(ang) * rr, 0, Math.sin(ang) * rr);
          break;
        }
        default:
          _pos.set(0, 0, 0);
      }
      // Emission direction: outward for sphere/hemisphere, cone spread around base otherwise.
      if ((cfg.shape === 'sphere' || cfg.shape === 'hemisphere') && _pos.lengthSq() > 1e-6) {
        _dir.copy(_pos).normalize();
      } else {
        sampleConeDir(_baseDir, cfg.coneAngle, _dir);
      }
      const speed = cfg.speed * (1 + (Math.random() * 2 - 1) * cfg.speedJitter);
      _dir.multiplyScalar(speed);

      if (worldSpace && parent) {
        _pos.applyMatrix4(_parentMat);
        _dir.applyQuaternion(_parentQuat);
      }
      pool.px[slot] = _pos.x; pool.py[slot] = _pos.y; pool.pz[slot] = _pos.z;
      pool.vx[slot] = _dir.x; pool.vy[slot] = _dir.y; pool.vz[slot] = _dir.z;
      pool.age[slot] = 0;
      pool.life[slot] = Math.max(0.05, cfg.lifetime * (1 + (Math.random() * 2 - 1) * cfg.lifetimeJitter));
    };

    // Decide how many to emit this frame.
    const active = playing ? emitting.current : cfg.enabled;
    if (active && cfg.looping && cfg.rate > 0) {
      emitAccum.current += cfg.rate * delta;
    }
    // Editor preview of one-shot (burst-only) emitters: replay periodically so the designer sees it.
    if (!playing && cfg.enabled && !cfg.looping && cfg.burst > 0) {
      previewTimer.current += delta;
      if (previewTimer.current > cfg.lifetime * 1.5 + 0.5) {
        previewTimer.current = 0;
        pendingBurst.current += cfg.burst;
      }
    }
    let toEmit = Math.floor(emitAccum.current);
    emitAccum.current -= toEmit;
    toEmit += pendingBurst.current;
    pendingBurst.current = 0;
    for (let i = 0; i < toEmit; i++) spawnOne();

    // Integrate + write render attributes.
    const positions = pool.posAttr.array as Float32Array;
    const colors = pool.colorAttr.array as Float32Array;
    const sizes = pool.sizeAttr.array as Float32Array;
    const dragFactor = Math.max(0, 1 - cfg.drag * delta);
    let alive = 0;
    // Track the touched slot range so the GPU upload below covers only changed slots, not the whole
    // pool — a couple dozen live particles in a 900-slot pool were re-uploading all 900 slots across
    // three attributes every frame.
    let dirtyMin = n;
    let dirtyMax = -1;
    for (let i = 0; i < n; i++) {
      if (pool.life[i] <= 0) {
        // A long-dead slot is already zeroed in the GPU buffer — leave it untouched (and un-uploaded).
        if (sizes[i] !== 0 || colors[i * 4 + 3] !== 0) {
          sizes[i] = 0;
          colors[i * 4 + 3] = 0;
          if (i < dirtyMin) dirtyMin = i;
          if (i > dirtyMax) dirtyMax = i;
        }
        continue;
      }
      pool.age[i] += delta;
      if (pool.age[i] >= pool.life[i]) {
        pool.life[i] = 0;
        sizes[i] = 0;
        colors[i * 4 + 3] = 0;
        if (i < dirtyMin) dirtyMin = i;
        if (i > dirtyMax) dirtyMax = i;
        continue;
      }
      alive++;
      if (i < dirtyMin) dirtyMin = i;
      if (i > dirtyMax) dirtyMax = i;
      pool.vy[i] -= cfg.gravity * delta;
      pool.vx[i] *= dragFactor; pool.vy[i] *= dragFactor; pool.vz[i] *= dragFactor;
      pool.px[i] += pool.vx[i] * delta;
      pool.py[i] += pool.vy[i] * delta;
      pool.pz[i] += pool.vz[i] * delta;
      const t = pool.age[i] / pool.life[i];
      _color.copy(_startColor).lerp(_endColor, t);
      const size = lerp(cfg.startSize, cfg.endSize, t);
      const alpha = lerp(cfg.startOpacity, cfg.endOpacity, t);
      // Render in local space: counter-transform world-space sims back under the (transformed) group.
      if (worldSpace && parent) {
        _pos.set(pool.px[i], pool.py[i], pool.pz[i]).applyMatrix4(_invParentMat);
        positions[i * 3] = _pos.x; positions[i * 3 + 1] = _pos.y; positions[i * 3 + 2] = _pos.z;
      } else {
        positions[i * 3] = pool.px[i]; positions[i * 3 + 1] = pool.py[i]; positions[i * 3 + 2] = pool.pz[i];
      }
      colors[i * 4] = _color.r; colors[i * 4 + 1] = _color.g; colors[i * 4 + 2] = _color.b; colors[i * 4 + 3] = alpha;
      sizes[i] = size;
    }
    aliveRef.current = alive;
    // Upload only the touched slot range (bufferSubData instead of a full re-upload); a frame that
    // touched nothing uploads nothing.
    if (dirtyMax >= dirtyMin) {
      const start = dirtyMin;
      const count = dirtyMax - dirtyMin + 1;
      pool.posAttr.clearUpdateRanges();
      pool.posAttr.addUpdateRange(start * 3, count * 3);
      pool.posAttr.needsUpdate = true;
      pool.colorAttr.clearUpdateRanges();
      pool.colorAttr.addUpdateRange(start * 4, count * 4);
      pool.colorAttr.needsUpdate = true;
      pool.sizeAttr.clearUpdateRanges();
      pool.sizeAttr.addUpdateRange(start, count);
      pool.sizeAttr.needsUpdate = true;
    }
    // No computeBoundingSphere — the points draw with frustumCulled={false}.

    // Project world size → screen pixels (matches PointsMaterial sizeAttenuation feel).
    const cam = state.camera as THREE.PerspectiveCamera;
    material.uniforms.uProjScale.value = cam.isPerspectiveCamera
      ? state.size.height / (2 * Math.tan((cam.fov * Math.PI) / 360))
      : state.size.height;

    if (lightRef.current) {
      lightRef.current.color.copy(_startColor);
      lightRef.current.intensity = cfg.light ? Math.min(8, (alive / n) * 10) : 0;
    }
  });

  return (
    <>
      {config.light && (
        <pointLight ref={lightRef} color={config.startColor} intensity={0} distance={config.shapeRadius * 5 + 5} decay={2} />
      )}
      <points ref={pointsRef} geometry={pool.geometry} material={material} frustumCulled={false} />
    </>
  );
}
