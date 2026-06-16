import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { CableComponent, SceneObject } from '../types';
import { useEditorStore, selectActiveObjects, selectActiveSceneEnvironment } from '../store/editorStore';
import { useResolvedMaterial } from './resolveMaterial';
import { useAssetTexture } from './ModelAsset';
import { blastsSince, latestBlastId } from '../runtime/explosionBus';
import { gatherColliders, resolveCollision, type ClothCollider } from './ClothSim';

const RADIAL = 8; // tube cross-section segments (octagonal — plenty round at cable thickness)
const clampSeg = (s: number) => Math.min(Math.max(Math.round(s), 2), 64);

/**
 * Cable topology: a 1D chain of particles with sequential distance constraints (the links) plus a
 * sparser set of bending constraints (i, i+2) for rigidity, mirroring the cloth solver one dimension
 * down. Particle 0 is the START (pinned to the object); the last particle is the END (pinned to the
 * attach object when one is set). `rest` is a straight line down -Y in local space — just an initial
 * shape; gravity + the end attachment take over immediately.
 */
interface CableTopology {
  particleCount: number;
  segLen: number;
  /** The cable length this topology's rest distances were built at — used to scale a runtime winch. */
  baseLength: number;
  rest: Float32Array;
  constraints: { a: number; b: number; rest: number }[];
  index: Uint16Array;
  uv: Float32Array;
}

function buildCableTopology(cable: CableComponent): CableTopology {
  const segments = clampSeg(cable.segments);
  const particleCount = segments + 1;
  const length = Math.max(cable.length, 0.05);
  const segLen = length / segments;
  const rest = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount; i++) rest[i * 3 + 1] = -i * segLen; // hang down -Y

  const constraints: { a: number; b: number; rest: number }[] = [];
  for (let i = 0; i < segments; i++) constraints.push({ a: i, b: i + 1, rest: segLen });
  // Bending constraints stiffen the rope so it doesn't fold flat; longer rest = softer hinge.
  for (let i = 0; i < segments - 1; i++) constraints.push({ a: i, b: i + 2, rest: segLen * 2 });

  // Tube mesh: (particleCount) rings × (RADIAL+1) verts. Index + UV are constant for the topology.
  const ring = RADIAL + 1;
  const index = new Uint16Array(segments * RADIAL * 6);
  const uv = new Float32Array(particleCount * ring * 2);
  let t = 0;
  for (let i = 0; i < particleCount; i++) {
    for (let j = 0; j <= RADIAL; j++) {
      const vi = i * ring + j;
      uv[vi * 2] = i / segments;
      uv[vi * 2 + 1] = j / RADIAL;
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < RADIAL; j++) {
      const a = i * ring + j;
      const b = a + ring;
      const c = a + 1;
      const d = b + 1;
      index[t++] = a; index[t++] = b; index[t++] = c;
      index[t++] = c; index[t++] = b; index[t++] = d;
    }
  }
  return { particleCount, segLen, baseLength: length, rest, constraints, index, uv };
}

// --- Tube surface generation (parallel-transport frame) ------------------------------------------
// We sweep a circle along the simulated points. A parallel-transport frame stays stable even where the
// cable is nearly straight (Frenet frames flip/NaN at zero curvature), so the tube never twists.
const _tan = new THREE.Vector3();
const _prevTan = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _binormal = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _proj = new THREE.Vector3();

function tangentAt(pos: Float32Array, count: number, i: number, out: THREE.Vector3) {
  const a = Math.max(0, i - 1);
  const b = Math.min(count - 1, i + 1);
  out.set(pos[b * 3] - pos[a * 3], pos[b * 3 + 1] - pos[a * 3 + 1], pos[b * 3 + 2] - pos[a * 3 + 2]);
  if (out.lengthSq() < 1e-12) out.set(0, 1, 0);
  out.normalize();
}

function arbitraryPerp(t: THREE.Vector3, out: THREE.Vector3) {
  const ax = Math.abs(t.x);
  const ay = Math.abs(t.y);
  const az = Math.abs(t.z);
  if (ax <= ay && ax <= az) out.set(1, 0, 0);
  else if (ay <= az) out.set(0, 1, 0);
  else out.set(0, 0, 1);
  const d = out.dot(t);
  out.set(out.x - d * t.x, out.y - d * t.y, out.z - d * t.z).normalize();
}

type CableStyle = 'cable' | 'rope' | 'chain' | 'wire';

/** Per-style geometry tweaks layered on the base round tube (a second mesh system would be overkill):
 *  rope = a helical braid twist; chain = a stronger twist + a bead/link pinch along the length;
 *  wire = a thinner round tube; cable = smooth. Use a matching material (metal for chain/wire). */
function styleParams(style: CableStyle) {
  switch (style) {
    case 'rope':
      return { twistPerSeg: 0.55, radiusScale: 1, bump: 0 };
    case 'chain':
      return { twistPerSeg: Math.PI / 2, radiusScale: 1, bump: 0.32 };
    case 'wire':
      return { twistPerSeg: 0, radiusScale: 0.42, bump: 0 };
    default:
      return { twistPerSeg: 0, radiusScale: 1, bump: 0 };
  }
}

function updateTube(pos: Float32Array, count: number, radius: number, style: CableStyle, outPos: Float32Array, outNorm: Float32Array) {
  const ring = RADIAL + 1;
  const { twistPerSeg, radiusScale, bump } = styleParams(style);
  const baseR = radius * radiusScale;
  tangentAt(pos, count, 0, _tan);
  arbitraryPerp(_tan, _normal);
  _prevTan.copy(_tan);
  for (let i = 0; i < count; i++) {
    tangentAt(pos, count, i, _tan);
    if (i > 0) {
      _axis.crossVectors(_prevTan, _tan);
      const sin = _axis.length();
      if (sin > 1e-6) {
        _axis.divideScalar(sin);
        const dot = Math.max(-1, Math.min(1, _prevTan.dot(_tan)));
        _normal.applyAxisAngle(_axis, Math.acos(dot));
      }
    }
    // Re-orthonormalize the carried normal against the current tangent.
    _proj.copy(_tan).multiplyScalar(_normal.dot(_tan));
    _normal.sub(_proj);
    if (_normal.lengthSq() < 1e-10) arbitraryPerp(_tan, _normal);
    else _normal.normalize();
    _binormal.crossVectors(_tan, _normal).normalize();
    // Bead/link pinch for chain (bumps between links), uniform otherwise.
    const r = bump > 0 ? baseR * (1 - bump + bump * Math.abs(Math.sin(i * 1.15))) : baseR;
    const twist = twistPerSeg * i;
    const cx = pos[i * 3];
    const cy = pos[i * 3 + 1];
    const cz = pos[i * 3 + 2];
    for (let j = 0; j <= RADIAL; j++) {
      const v = (j / RADIAL) * Math.PI * 2 + twist;
      const cv = Math.cos(v);
      const sv = Math.sin(v);
      const nx = cv * _normal.x + sv * _binormal.x;
      const ny = cv * _normal.y + sv * _binormal.y;
      const nz = cv * _normal.z + sv * _binormal.z;
      const k = (i * ring + j) * 3;
      outPos[k] = cx + r * nx;
      outPos[k + 1] = cy + r * ny;
      outPos[k + 2] = cz + r * nz;
      outNorm[k] = nx;
      outNorm[k + 1] = ny;
      outNorm[k + 2] = nz;
    }
    _prevTan.copy(_tan);
  }
}

const tmpV = new THREE.Vector3();

/**
 * The cable sim + tube render core. Runs a Verlet/PBD sim each frame in WORLD space (mesh matrixWorld
 * forced to identity, like the cloth sim) so gravity/wind/collision are world-space. The start tracks
 * the object's world position; the end tracks the attach object when one is set. No store writes.
 */
function CableBody({ object, topo, selected }: { object: SceneObject; topo: CableTopology; selected: boolean }) {
  const cable = object.cable!;
  const material = useResolvedMaterial(object.renderer);
  const baseTexture = useAssetTexture(material.baseColorUrl, true);
  const normalTexture = useAssetTexture(material.normalUrl, true);
  const env = useEditorStore(selectActiveSceneEnvironment);
  const meshRef = useRef<THREE.Mesh>(null);
  const geomRef = useRef<THREE.BufferGeometry>(null);

  const sim = useRef<{ pos: Float32Array; prev: Float32Array; broken: boolean[]; seeded: boolean }>({
    pos: new Float32Array(0),
    prev: new Float32Array(0),
    broken: [],
    seeded: false,
  });
  const lastBlastId = useRef(0);
  useEffect(() => {
    sim.current = {
      pos: new Float32Array(topo.particleCount * 3),
      prev: new Float32Array(topo.particleCount * 3),
      broken: new Array(topo.constraints.length).fill(false),
      seeded: false,
    };
  }, [topo]);

  const ringVerts = topo.particleCount * (RADIAL + 1);
  const positionAttr = useMemo(() => new THREE.BufferAttribute(new Float32Array(ringVerts * 3), 3), [ringVerts]);
  const normalAttr = useMemo(() => new THREE.BufferAttribute(new Float32Array(ringVerts * 3), 3), [ringVerts]);

  useFrame((_, rawDelta) => {
    const mesh = meshRef.current;
    const geom = geomRef.current;
    if (!mesh || !geom) return;
    const s = sim.current;
    const parent = mesh.parent;
    if (!parent) return;
    parent.updateWorldMatrix(true, false);
    const groupWorld = parent.matrixWorld;
    const count = topo.particleCount;
    const last = count - 1;

    // START world position = the cable object's world origin (+ a local start offset, e.g. a crane tip).
    const so = cable.startOffset ?? [0, 0, 0];
    tmpV.set(so[0], so[1], so[2]).applyMatrix4(groupWorld);
    const startX = tmpV.x;
    const startY = tmpV.y;
    const startZ = tmpV.z;

    const liveState = useEditorStore.getState();
    const objects = selectActiveObjects(liveState);
    // Runtime control: Cut Cable detaches the end (it falls); Set Cable Length winches the rest length.
    const cut = liveState.runtimeCutCables?.includes(object.id);
    const effectiveLength = liveState.runtimeCableLength?.[object.id] ?? cable.length;

    // END world position = the attach object's position (+ offset) when one is set, else free.
    let endPinned = false;
    let endX = startX;
    let endY = startY - effectiveLength;
    let endZ = startZ;
    // When following an existing physics joint, derive the end from that joint rather than endObjectId:
    // the far end is the body the joint links to (this object's joint, or whatever joint connects to us).
    let endId = cut ? undefined : cable.endObjectId;
    if (!cut && cable.followJoint) {
      const owner = objects.find((o) => o.id === object.id);
      if (owner?.joint?.enabled && owner.joint.connectedObjectId) endId = owner.joint.connectedObjectId;
      else {
        const jointed = objects.find((o) => o.joint?.enabled && o.joint.connectedObjectId === object.id);
        if (jointed) endId = jointed.id;
      }
    }
    if (endId) {
      const endObj = objects.find((o) => o.id === endId);
      if (endObj) {
        const off = cable.endOffset ?? [0, 0, 0];
        endPinned = true;
        endX = endObj.transform.position[0] + off[0];
        endY = endObj.transform.position[1] + off[1];
        endZ = endObj.transform.position[2] + off[2];
      }
    }

    if (!s.seeded) {
      // Seed a straight line from start to the (free or attached) end so it settles cleanly.
      for (let i = 0; i < count; i++) {
        const f = i / last;
        const x = startX + (endX - startX) * f;
        const y = startY + (endY - startY) * f;
        const z = startZ + (endZ - startZ) * f;
        s.pos[i * 3] = x; s.pos[i * 3 + 1] = y; s.pos[i * 3 + 2] = z;
        s.prev[i * 3] = x; s.prev[i * 3 + 1] = y; s.prev[i * 3 + 2] = z;
      }
      s.seeded = true;
    }

    const dt = Math.min(Math.max(rawDelta, 1 / 240), 1 / 30);
    const g = -9.81 * cable.gravityScale * dt * dt;
    const damp = 1 - Math.min(Math.max(cable.damping, 0), 0.95);
    const sceneWind = env?.wind ?? [0, 0, 0];
    const wob = Math.max(cable.turbulence, env?.windTurbulence ?? 0) * 6;
    const windX = (cable.wind[0] + sceneWind[0] + (Math.random() - 0.5) * wob) * dt * dt;
    const windY = (cable.wind[1] + sceneWind[1] + (Math.random() - 0.5) * wob) * dt * dt;
    const windZ = (cable.wind[2] + sceneWind[2] + (Math.random() - 0.5) * wob) * dt * dt;

    const isPinned = (i: number) => i === 0 || (endPinned && i === last);

    // Anchor the pinned ends to their current world positions.
    s.pos[0] = startX; s.pos[1] = startY; s.pos[2] = startZ;
    s.prev[0] = startX; s.prev[1] = startY; s.prev[2] = startZ;
    if (endPinned) {
      s.pos[last * 3] = endX; s.pos[last * 3 + 1] = endY; s.pos[last * 3 + 2] = endZ;
      s.prev[last * 3] = endX; s.prev[last * 3 + 1] = endY; s.prev[last * 3 + 2] = endZ;
    }

    // Verlet integrate free particles.
    for (let i = 0; i < count; i++) {
      if (isPinned(i)) continue;
      const k = i * 3;
      for (let a = 0; a < 3; a++) {
        const cur = s.pos[k + a];
        const vel = (cur - s.prev[k + a]) * damp;
        s.prev[k + a] = cur;
        s.pos[k + a] = cur + vel + (a === 0 ? windX : a === 1 ? g + windY : windZ);
      }
    }

    // Explosion blasts: shove free particles within range outward (a power line whips when a barrel pops).
    const blasts = blastsSince(lastBlastId.current);
    if (blasts.length) {
      for (const b of blasts) {
        for (let i = 0; i < count; i++) {
          if (isPinned(i)) continue;
          const k = i * 3;
          const dx = s.pos[k] - b.center[0];
          const dy = s.pos[k + 1] - b.center[1];
          const dz = s.pos[k + 2] - b.center[2];
          const d = Math.hypot(dx, dy, dz);
          if (d > b.radius) continue;
          const inv = d > 1e-3 ? 1 / d : 0;
          const push = b.strength * (1 - d / b.radius) * 0.02;
          s.pos[k] += dx * inv * push;
          s.pos[k + 1] += (d > 1e-3 ? dy * inv : 1) * push + push * 0.5;
          s.pos[k + 2] += dz * inv * push;
        }
      }
      lastBlastId.current = latestBlastId();
    }

    // Satisfy distance constraints (links + bending). A runtime winch scales every rest length.
    const tear = cable.tearFactor > 0 ? cable.tearFactor : Infinity;
    const lengthScale = Math.max(effectiveLength, 0.05) / topo.baseLength;
    const iterations = Math.min(Math.max(Math.round(cable.stiffness), 1), 16);
    for (let iter = 0; iter < iterations; iter++) {
      for (let c = 0; c < topo.constraints.length; c++) {
        if (s.broken[c]) continue;
        const con = topo.constraints[c];
        const a = con.a;
        const b = con.b;
        const rest = con.rest * lengthScale;
        const ka = a * 3;
        const kb = b * 3;
        const dx = s.pos[kb] - s.pos[ka];
        const dy = s.pos[kb + 1] - s.pos[ka + 1];
        const dz = s.pos[kb + 2] - s.pos[ka + 2];
        const d = Math.hypot(dx, dy, dz) || 1e-6;
        if (d > rest * tear) { s.broken[c] = true; continue; }
        const diff = (d - rest) / d;
        const pinA = isPinned(a);
        const pinB = isPinned(b);
        const wA = pinA ? 0 : pinB ? 1 : 0.5;
        const wB = pinB ? 0 : pinA ? 1 : 0.5;
        const ox = dx * diff;
        const oy = dy * diff;
        const oz = dz * diff;
        s.pos[ka] += ox * wA; s.pos[ka + 1] += oy * wA; s.pos[ka + 2] += oz * wA;
        s.pos[kb] -= ox * wB; s.pos[kb + 1] -= oy * wB; s.pos[kb + 2] -= oz * wB;
      }
    }

    // Collisions (floor + nearby bodies), reusing the cloth collision pass.
    let colliders: ClothCollider[] = [];
    if (cable.collideBodies) {
      tmpV.set((startX + endX) / 2, (startY + endY) / 2, (startZ + endZ) / 2);
      colliders = gatherColliders(objects, object.id, tmpV.clone(), cable.length + 6, cable.endObjectId);
    }
    for (let i = 0; i < count; i++) {
      if (isPinned(i)) continue;
      const k = i * 3;
      if (cable.collideFloor && s.pos[k + 1] < cable.floorY + cable.radius) s.pos[k + 1] = cable.floorY + cable.radius;
      if (colliders.length) {
        tmpV.set(s.pos[k], s.pos[k + 1], s.pos[k + 2]);
        for (const col of colliders) resolveCollision(tmpV, col, cable.radius);
        s.pos[k] = tmpV.x; s.pos[k + 1] = tmpV.y; s.pos[k + 2] = tmpV.z;
      }
    }

    // Sweep the tube surface along the simulated points.
    updateTube(s.pos, count, Math.max(cable.radius, 0.005), cable.style ?? 'cable', positionAttr.array as Float32Array, normalAttr.array as Float32Array);
    positionAttr.needsUpdate = true;
    normalAttr.needsUpdate = true;
    geom.computeBoundingSphere();
    mesh.matrixAutoUpdate = false;
    mesh.matrixWorldAutoUpdate = false;
    mesh.matrixWorld.identity();

    // Tension feedback: tint the cable toward red as the end-to-end stretch nears its break point (or
    // just goes taut). Skip while selected (the selection highlight owns the emissive then).
    if (cable.tensionColor && !selected) {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      const dist = Math.hypot(endX - startX, endY - startY, endZ - startZ);
      const ratio = dist / Math.max(effectiveLength, 0.05);
      const tear = cable.tearFactor > 0 ? cable.tearFactor : 1.05;
      const t = Math.max(0, Math.min(1, (ratio - 0.85) / Math.max(tear - 0.85, 0.05)));
      mat.emissive.setRGB(0.9 * t, 0.05 * t, 0.05 * t);
      mat.emissiveIntensity = 0.2 + 1.1 * t;
    }
  });

  return (
    <mesh ref={meshRef} castShadow receiveShadow frustumCulled={false}>
      <bufferGeometry ref={geomRef}>
        <primitive object={positionAttr} attach="attributes-position" />
        <primitive object={normalAttr} attach="attributes-normal" />
        <bufferAttribute attach="attributes-uv" args={[topo.uv, 2]} />
        <bufferAttribute attach="index" args={[topo.index, 1]} />
      </bufferGeometry>
      <meshStandardMaterial
        color={material.color}
        roughness={material.roughness}
        metalness={material.metalness}
        map={baseTexture ?? null}
        normalMap={normalTexture ?? null}
        emissive={selected ? '#ff4f9d' : material.emissiveColor}
        emissiveIntensity={selected ? 0.35 : material.emissiveIntensity}
        transparent={material.opacity < 1}
        opacity={material.opacity}
        depthWrite={material.opacity >= 1}
      />
    </mesh>
  );
}

/**
 * Cable entry point — renders the object as a deforming Verlet rope (a tube through the simulated
 * points) instead of its normal mesh. Mounted from {@link Primitive} via a pre-hooks early-return so
 * toggling the cable never changes that component's hook count (CableBody owns its own hooks).
 */
export function CableSim({ object, selected }: { object: SceneObject; selected: boolean }) {
  const cable = object.cable!;
  const topo = useMemo(() => buildCableTopology(cable), [cable.segments, cable.length]);
  return <CableBody object={object} topo={topo} selected={selected} />;
}
