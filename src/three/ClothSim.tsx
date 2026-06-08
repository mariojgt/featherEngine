import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ClothComponent, ClothPinMode, SceneObject } from '../types';
import { useEditorStore, selectActiveObjects, selectActiveSceneEnvironment } from '../store/editorStore';
import { capsuleParams, colliderKindFor, halfScale, sphereRadius } from '../runtime/colliderShape';
import { useResolvedMaterial } from './resolveMaterial';
import { useAssetTexture } from './ModelAsset';

const clampRes = (r: number) => Math.min(Math.max(Math.round(r), 4), 32);

/** Per-grid topology that only changes when size/resolution/pinMode change (rebuilt, not per frame). */
interface ClothMesh {
  cols: number; // vertices per row
  rows: number;
  rest: Float32Array; // local-space rest positions (xyz per vertex)
  uv: Float32Array;
  index: Uint32Array;
  pinned: boolean[];
  constraints: { a: number; b: number; rest: number }[];
}

function pinnedFor(mode: ClothPinMode, x: number, y: number, cols: number, rows: number): boolean {
  const left = x === 0;
  const right = x === cols - 1;
  const top = y === 0; // row 0 = top edge of the sheet
  const bottom = y === rows - 1;
  switch (mode) {
    case 'top-edge':
      return top;
    case 'top-corners':
      return top && (left || right);
    case 'four-corners':
      return (top || bottom) && (left || right);
    case 'left-edge':
      return left;
    case 'none':
    default:
      return false;
  }
}

function buildClothMesh(cloth: ClothComponent): ClothMesh {
  const res = clampRes(cloth.resolution);
  const cols = res + 1;
  const rows = res + 1;
  const w = Math.max(cloth.width, 0.01);
  const h = Math.max(cloth.height, 0.01);
  const dx = w / res;
  const dy = h / res;
  const rest = new Float32Array(cols * rows * 3);
  const uv = new Float32Array(cols * rows * 2);
  const pinned: boolean[] = new Array(cols * rows).fill(false);
  // Sheet laid out in the local XY plane, centered, with the TOP at +Y so it hangs downward by gravity.
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      rest[i * 3] = -w / 2 + x * dx;
      rest[i * 3 + 1] = h / 2 - y * dy;
      rest[i * 3 + 2] = 0;
      uv[i * 2] = x / res;
      uv[i * 2 + 1] = 1 - y / res;
      pinned[i] = pinnedFor(cloth.pinMode, x, y, cols, rows);
    }
  }
  const index = new Uint32Array(res * res * 6);
  let t = 0;
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const a = y * cols + x;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      index[t++] = a; index[t++] = c; index[t++] = b;
      index[t++] = b; index[t++] = c; index[t++] = d;
    }
  }
  // Constraints: structural (right/down), shear (diagonals), bend (two apart) — bend keeps the sheet from
  // collapsing on itself and gives it body.
  const constraints: { a: number; b: number; rest: number }[] = [];
  const restLen = (i: number, j: number) =>
    Math.hypot(rest[i * 3] - rest[j * 3], rest[i * 3 + 1] - rest[j * 3 + 1], rest[i * 3 + 2] - rest[j * 3 + 2]);
  const add = (i: number, j: number) => constraints.push({ a: i, b: j, rest: restLen(i, j) });
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (x + 1 < cols) add(i, i + 1);
      if (y + 1 < rows) add(i, i + cols);
      if (x + 1 < cols && y + 1 < rows) add(i, i + cols + 1);
      if (x - 1 >= 0 && y + 1 < rows) add(i, i + cols - 1);
      if (x + 2 < cols) add(i, i + 2);
      if (y + 2 < rows) add(i, i + 2 * cols);
    }
  }
  return { cols, rows, rest, uv, index, pinned, constraints };
}

// --- Collision shapes gathered from the scene each frame -----------------------------------------
interface ClothCollider {
  type: 'sphere' | 'box' | 'capsule';
  inv: THREE.Matrix4; // world → collider-local
  mat: THREE.Matrix4; // collider-local → world
  radius: number;
  halfHeight: number; // capsule
  half: THREE.Vector3; // box half-extents (local)
}

const tmpMat = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();
const tmpScale = new THREE.Vector3(1, 1, 1);
const tmpV = new THREE.Vector3();
const tmpC = new THREE.Vector3();

function objectWorldMatrix(object: SceneObject): THREE.Matrix4 {
  const [px, py, pz] = object.transform.position;
  const [rx, ry, rz] = object.transform.rotation;
  tmpEuler.set(rx, ry, rz, 'XYZ');
  tmpQuat.setFromEuler(tmpEuler);
  return new THREE.Matrix4().compose(tmpV.set(px, py, pz), tmpQuat, tmpScale.set(1, 1, 1));
}

function gatherColliders(objects: SceneObject[], selfId: string, center: THREE.Vector3, range: number): ClothCollider[] {
  const out: ClothCollider[] = [];
  for (const object of objects) {
    if (object.id === selfId) continue;
    const physics = object.physics?.enabled && !object.physics.isTrigger;
    const character = object.character?.enabled;
    if (!physics && !character) continue;
    const [cx, cy, cz] = object.transform.position;
    if ((cx - center.x) ** 2 + (cy - center.y) ** 2 + (cz - center.z) ** 2 > range * range) continue;
    const mat = objectWorldMatrix(object);
    const inv = mat.clone().invert();
    if (character) {
      // Approximate the kinematic player capsule (feet-origin) — matches physicsWorld.characterCapsule loosely.
      const s = object.transform.scale;
      const radius = 0.34 * Math.max(Math.abs(s[0]), Math.abs(s[2]), 0.1);
      const halfHeight = 0.6 * Math.max(Math.abs(s[1]), 0.1);
      out.push({ type: 'capsule', inv, mat, radius, halfHeight, half: new THREE.Vector3() });
      continue;
    }
    const kind = colliderKindFor(object);
    if (kind === 'sphere') {
      out.push({ type: 'sphere', inv, mat, radius: sphereRadius(object), halfHeight: 0, half: new THREE.Vector3() });
    } else if (kind === 'capsule') {
      const { halfHeight, radius } = capsuleParams(object);
      out.push({ type: 'capsule', inv, mat, radius, halfHeight, half: new THREE.Vector3() });
    } else {
      // box / plane / mesh / convex → treat as an oriented box of its scaled bounds (cheap, good enough).
      const [sx, sy, sz] = halfScale(object);
      out.push({ type: 'box', inv, mat, radius: 0, halfHeight: 0, half: new THREE.Vector3(0.5 * sx, 0.5 * sy, 0.5 * sz) });
    }
  }
  return out;
}

/** Push a single world-space point out of a collider if it's inside it. Mutates `p`. */
function resolveCollision(p: THREE.Vector3, col: ClothCollider, margin: number) {
  const local = tmpC.copy(p).applyMatrix4(col.inv);
  if (col.type === 'sphere') {
    const r = col.radius + margin;
    const len = local.length();
    if (len < r && len > 1e-5) {
      local.multiplyScalar(r / len);
      p.copy(local).applyMatrix4(col.mat);
    }
  } else if (col.type === 'capsule') {
    const r = col.radius + margin;
    // Segment along local Y from -halfHeight..+halfHeight.
    const cy = Math.max(-col.halfHeight, Math.min(col.halfHeight, local.y));
    const dx = local.x;
    const dz = local.z;
    const dy = local.y - cy;
    const d = Math.hypot(dx, dy, dz);
    if (d < r && d > 1e-5) {
      const k = r / d;
      local.set(dx * k, cy + dy * k, dz * k);
      p.copy(local).applyMatrix4(col.mat);
    }
  } else {
    // Oriented box: if inside the half-extents, push out along the axis of least penetration.
    const hx = col.half.x + margin;
    const hy = col.half.y + margin;
    const hz = col.half.z + margin;
    if (Math.abs(local.x) < hx && Math.abs(local.y) < hy && Math.abs(local.z) < hz) {
      const px = hx - Math.abs(local.x);
      const py = hy - Math.abs(local.y);
      const pz = hz - Math.abs(local.z);
      if (px <= py && px <= pz) local.x = local.x < 0 ? -hx : hx;
      else if (py <= pz) local.y = local.y < 0 ? -hy : hy;
      else local.z = local.z < 0 ? -hz : hz;
      p.copy(local).applyMatrix4(col.mat);
    }
  }
}

/**
 * Renders a deforming cloth mesh and runs a Verlet/PBD sim each frame. The mesh draws in WORLD space
 * (its matrixWorld is forced to identity, like RagdollRig drives bones) so gravity/wind/collision are
 * all world-space; pinned particles instead track the object's group world matrix, so pinning to a
 * moving/parented object (a character) makes the cloth hang off it. General-purpose; mirrors the
 * decoupled-runtime pattern (no store writes).
 */
export function ClothSim({ object, selected }: { object: SceneObject; selected: boolean }) {
  const cloth = object.cloth!;
  // Full material from the object's renderer (assigned material / inline color), incl. textures + emissive,
  // so a cloth renders exactly like any other mesh — you can drop a fabric/flag material onto it.
  const material = useResolvedMaterial(object.renderer);
  const baseTexture = useAssetTexture(material.baseColorUrl, true);
  const normalTexture = useAssetTexture(material.normalUrl, true);
  // Global scene wind drives every cloth; the cloth's own wind adds on top (so one breeze moves them all).
  const env = useEditorStore(selectActiveSceneEnvironment);
  const meshRef = useRef<THREE.Mesh>(null);
  const geomRef = useRef<THREE.BufferGeometry>(null);

  const topo = useMemo(() => buildClothMesh(cloth), [cloth.resolution, cloth.width, cloth.height, cloth.pinMode]);

  // Live sim buffers (world-space) — recreated when topology changes.
  const sim = useRef<{ pos: Float32Array; prev: Float32Array; broken: boolean[]; seeded: boolean }>({
    pos: new Float32Array(0),
    prev: new Float32Array(0),
    broken: [],
    seeded: false,
  });

  useEffect(() => {
    const n = topo.cols * topo.rows * 3;
    sim.current = {
      pos: new Float32Array(n),
      prev: new Float32Array(n),
      broken: new Array(topo.constraints.length).fill(false),
      seeded: false,
    };
  }, [topo]);

  const positionAttr = useMemo(() => new THREE.BufferAttribute(new Float32Array(topo.cols * topo.rows * 3), 3), [topo]);

  useFrame((_, rawDelta) => {
    const mesh = meshRef.current;
    const geom = geomRef.current;
    if (!mesh || !geom) return;
    const s = sim.current;
    const parent = mesh.parent;
    if (!parent) return;
    parent.updateWorldMatrix(true, false);
    const groupWorld = parent.matrixWorld;

    // Seed world positions from rest-local transformed by the current group world matrix.
    if (!s.seeded) {
      for (let i = 0; i < topo.cols * topo.rows; i++) {
        tmpV.set(topo.rest[i * 3], topo.rest[i * 3 + 1], topo.rest[i * 3 + 2]).applyMatrix4(groupWorld);
        s.pos[i * 3] = tmpV.x; s.pos[i * 3 + 1] = tmpV.y; s.pos[i * 3 + 2] = tmpV.z;
        s.prev[i * 3] = tmpV.x; s.prev[i * 3 + 1] = tmpV.y; s.prev[i * 3 + 2] = tmpV.z;
      }
      s.seeded = true;
    }

    const dt = Math.min(Math.max(rawDelta, 1 / 240), 1 / 30);
    const g = -9.81 * cloth.gravityScale * dt * dt;
    const damp = 1 - Math.min(Math.max(cloth.damping, 0), 0.95);
    // Effective wind = scene wind + this cloth's own wind; turbulence is the stronger of the two.
    const sceneWind = env?.wind ?? [0, 0, 0];
    const wx = cloth.wind[0] + sceneWind[0];
    const wy = cloth.wind[1] + sceneWind[1];
    const wz = cloth.wind[2] + sceneWind[2];
    const wob = Math.max(cloth.turbulence, env?.windTurbulence ?? 0) * 6;
    const windX = (wx + (Math.random() - 0.5) * wob) * dt * dt;
    const windY = (wy + (Math.random() - 0.5) * wob) * dt * dt;
    const windZ = (wz + (Math.random() - 0.5) * wob) * dt * dt;
    const count = topo.cols * topo.rows;

    // Pin: anchor pinned particles to the object's CURRENT world transform (so capes follow the wearer).
    for (let i = 0; i < count; i++) {
      if (!topo.pinned[i]) continue;
      tmpV.set(topo.rest[i * 3], topo.rest[i * 3 + 1], topo.rest[i * 3 + 2]).applyMatrix4(groupWorld);
      s.pos[i * 3] = tmpV.x; s.pos[i * 3 + 1] = tmpV.y; s.pos[i * 3 + 2] = tmpV.z;
      s.prev[i * 3] = tmpV.x; s.prev[i * 3 + 1] = tmpV.y; s.prev[i * 3 + 2] = tmpV.z;
    }

    // Verlet integrate free particles.
    for (let i = 0; i < count; i++) {
      if (topo.pinned[i]) continue;
      const k = i * 3;
      for (let a = 0; a < 3; a++) {
        const cur = s.pos[k + a];
        const vel = (cur - s.prev[k + a]) * damp;
        s.prev[k + a] = cur;
        s.pos[k + a] = cur + vel + (a === 0 ? windX : a === 1 ? g + windY : windZ);
      }
    }

    // Satisfy distance constraints.
    const tear = cloth.tearFactor > 0 ? cloth.tearFactor : Infinity;
    const iterations = Math.min(Math.max(Math.round(cloth.stiffness), 1), 12);
    for (let iter = 0; iter < iterations; iter++) {
      for (let c = 0; c < topo.constraints.length; c++) {
        if (s.broken[c]) continue;
        const { a, b, rest } = topo.constraints[c];
        const ka = a * 3;
        const kb = b * 3;
        const dx = s.pos[kb] - s.pos[ka];
        const dy = s.pos[kb + 1] - s.pos[ka + 1];
        const dz = s.pos[kb + 2] - s.pos[ka + 2];
        const d = Math.hypot(dx, dy, dz) || 1e-6;
        if (d > rest * tear) { s.broken[c] = true; continue; }
        const diff = (d - rest) / d;
        const pinA = topo.pinned[a];
        const pinB = topo.pinned[b];
        const wA = pinA ? 0 : pinB ? 1 : 0.5;
        const wB = pinB ? 0 : pinA ? 1 : 0.5;
        const ox = dx * diff;
        const oy = dy * diff;
        const oz = dz * diff;
        s.pos[ka] += ox * wA; s.pos[ka + 1] += oy * wA; s.pos[ka + 2] += oz * wA;
        s.pos[kb] -= ox * wB; s.pos[kb + 1] -= oy * wB; s.pos[kb + 2] -= oz * wB;
      }
    }

    // Collisions.
    const floorY = cloth.floorY;
    let colliders: ClothCollider[] = [];
    if (cloth.collideBodies) {
      const c = tmpV.set(s.pos[0], s.pos[1], s.pos[2]);
      colliders = gatherColliders(selectActiveObjects(useEditorStore.getState()), object.id, c.clone(), Math.max(cloth.width, cloth.height) + 6);
    }
    for (let i = 0; i < count; i++) {
      if (topo.pinned[i]) continue;
      const k = i * 3;
      if (cloth.collideFloor && s.pos[k + 1] < floorY + 0.01) s.pos[k + 1] = floorY + 0.01;
      if (colliders.length) {
        tmpV.set(s.pos[k], s.pos[k + 1], s.pos[k + 2]);
        for (const col of colliders) resolveCollision(tmpV, col, 0.03);
        s.pos[k] = tmpV.x; s.pos[k + 1] = tmpV.y; s.pos[k + 2] = tmpV.z;
      }
    }

    // Write world positions into the geometry; force the mesh's world matrix to identity so the verts
    // render exactly where the sim put them (instead of being transformed again by the group).
    const arr = positionAttr.array as Float32Array;
    arr.set(s.pos);
    positionAttr.needsUpdate = true;
    geom.computeVertexNormals();
    geom.computeBoundingSphere();
    mesh.matrixAutoUpdate = false;
    mesh.matrixWorldAutoUpdate = false;
    mesh.matrixWorld.identity();
  });

  return (
    <mesh ref={meshRef} castShadow receiveShadow frustumCulled={false}>
      <bufferGeometry ref={geomRef}>
        <primitive object={positionAttr} attach="attributes-position" />
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
        side={THREE.DoubleSide}
        transparent={material.opacity < 1}
        opacity={material.opacity}
        depthWrite={material.opacity >= 1}
      />
    </mesh>
  );
}
