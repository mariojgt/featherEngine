import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import type { ClothComponent, ClothPinMode, SceneObject } from '../types';
import { useEditorStore, selectActiveObjects, selectActiveSceneEnvironment } from '../store/editorStore';
import { capsuleParams, colliderKindFor, halfScale, sphereRadius } from '../runtime/colliderShape';
import { useResolvedMaterial } from './resolveMaterial';
import { useAssetTexture, useAssetUrl } from './ModelAsset';
import { DRACO_DECODER_PATH, extendGLTFLoader } from './gltfDecoders';

const clampRes = (r: number) => Math.min(Math.max(Math.round(r), 4), 32);

/**
 * Cloth topology — particles (the simulated points) + their distance constraints + a render geometry
 * (which may have MORE vertices than particles, since an imported mesh's duplicated seam/UV vertices are
 * welded to a single particle so the cloth doesn't split along seams). Shared by the grid and mesh sources.
 */
interface ClothTopology {
  /** Number of simulated particles. */
  particleCount: number;
  /** Local-space rest position per particle (xyz). */
  rest: Float32Array;
  /** Anchored particles (don't fall; follow the object transform). */
  pinned: boolean[];
  constraints: { a: number; b: number; rest: number }[];
  /** Render vertex count (>= particleCount for welded meshes). */
  renderCount: number;
  /** Maps each render vertex → its particle index. */
  vertexToParticle: Uint32Array;
  uv: Float32Array;
  index: Uint32Array;
}

function pinnedForGrid(mode: ClothPinMode, x: number, y: number, cols: number, rows: number): boolean {
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

function buildGridTopology(cloth: ClothComponent): ClothTopology {
  const res = clampRes(cloth.resolution);
  const cols = res + 1;
  const rows = res + 1;
  const w = Math.max(cloth.width, 0.01);
  const h = Math.max(cloth.height, 0.01);
  const dx = w / res;
  const dy = h / res;
  const count = cols * rows;
  const rest = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const pinned: boolean[] = new Array(count).fill(false);
  const vertexToParticle = new Uint32Array(count);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      rest[i * 3] = -w / 2 + x * dx;
      rest[i * 3 + 1] = h / 2 - y * dy; // TOP at +Y so it hangs down
      rest[i * 3 + 2] = 0;
      uv[i * 2] = x / res;
      uv[i * 2 + 1] = 1 - y / res;
      pinned[i] = pinnedForGrid(cloth.pinMode, x, y, cols, rows);
      vertexToParticle[i] = i; // grid: render vertex == particle
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
  return { particleCount: count, rest, pinned, constraints, renderCount: count, vertexToParticle, uv, index };
}

/**
 * Build cloth topology from an arbitrary imported MESH geometry (local space, already baked to the cloth
 * object's frame). Duplicated vertices at the same position are WELDED to one particle (so seams don't
 * tear apart), triangle edges become distance constraints, and particles are pinned by mapping the chosen
 * pinMode onto the mesh's local bounding box (top-edge → top of the mesh, left-edge → -X side, etc.) — so
 * importing a flag and choosing "left-edge" pins it to its pole.
 */
function buildMeshTopology(geometry: THREE.BufferGeometry, cloth: ClothComponent): ClothTopology | null {
  const posAttr = geometry.getAttribute('position');
  if (!posAttr) return null;
  const renderCount = posAttr.count;
  const srcUv = geometry.getAttribute('uv');
  const index = geometry.getIndex();
  const indices = index ? new Uint32Array(index.array as ArrayLike<number>) : new Uint32Array(renderCount).map((_, i) => i);

  // Weld vertices by quantized position so shared seam/UV duplicates become one particle.
  const WELD = 1e-4;
  const keyToParticle = new Map<string, number>();
  const vertexToParticle = new Uint32Array(renderCount);
  const restList: number[] = [];
  const quant = (v: number) => Math.round(v / WELD);
  for (let i = 0; i < renderCount; i++) {
    const x = posAttr.getX(i);
    const y = posAttr.getY(i);
    const z = posAttr.getZ(i);
    const key = `${quant(x)}:${quant(y)}:${quant(z)}`;
    let particle = keyToParticle.get(key);
    if (particle === undefined) {
      particle = restList.length / 3;
      keyToParticle.set(key, particle);
      restList.push(x, y, z);
    }
    vertexToParticle[i] = particle;
  }
  const particleCount = restList.length / 3;
  if (particleCount < 3) return null;
  const rest = new Float32Array(restList);

  // Unique edges from triangles → distance constraints.
  const seen = new Set<number>();
  const constraints: { a: number; b: number; rest: number }[] = [];
  const restLen = (i: number, j: number) =>
    Math.hypot(rest[i * 3] - rest[j * 3], rest[i * 3 + 1] - rest[j * 3 + 1], rest[i * 3 + 2] - rest[j * 3 + 2]);
  const addEdge = (va: number, vb: number) => {
    const a = vertexToParticle[va];
    const b = vertexToParticle[vb];
    if (a === b) return;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const id = lo * particleCount + hi;
    if (seen.has(id)) return;
    seen.add(id);
    constraints.push({ a: lo, b: hi, rest: restLen(lo, hi) });
  };
  for (let i = 0; i < indices.length; i += 3) {
    addEdge(indices[i], indices[i + 1]);
    addEdge(indices[i + 1], indices[i + 2]);
    addEdge(indices[i + 2], indices[i]);
  }

  // Pin particles by mapping pinMode onto the mesh's local bounding box.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let p = 0; p < particleCount; p++) {
    minX = Math.min(minX, rest[p * 3]); maxX = Math.max(maxX, rest[p * 3]);
    minY = Math.min(minY, rest[p * 3 + 1]); maxY = Math.max(maxY, rest[p * 3 + 1]);
  }
  const epsX = (maxX - minX) * 0.06 + 1e-4;
  const epsY = (maxY - minY) * 0.06 + 1e-4;
  const pinned: boolean[] = new Array(particleCount).fill(false);
  for (let p = 0; p < particleCount; p++) {
    const x = rest[p * 3];
    const y = rest[p * 3 + 1];
    const atTop = y >= maxY - epsY;
    const atBottom = y <= minY + epsY;
    const atLeft = x <= minX + epsX;
    const atRight = x >= maxX - epsX;
    switch (cloth.pinMode) {
      case 'top-edge': pinned[p] = atTop; break;
      case 'top-corners': pinned[p] = atTop && (atLeft || atRight); break;
      case 'four-corners': pinned[p] = (atTop || atBottom) && (atLeft || atRight); break;
      case 'left-edge': pinned[p] = atLeft; break;
      default: pinned[p] = false;
    }
  }

  const uv = srcUv ? new Float32Array(srcUv.array as ArrayLike<number>) : new Float32Array(renderCount * 2);
  return { particleCount, rest, pinned, constraints, renderCount, vertexToParticle, uv, index: indices };
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
 * The cloth sim + render core, driven by a pre-built topology (grid OR welded mesh). Runs a Verlet/PBD
 * sim each frame in WORLD space (mesh matrixWorld forced to identity, like RagdollRig drives bones) so
 * gravity/wind/collision are world-space; pinned particles track the object's group world matrix so a
 * cape follows its wearer. No store writes.
 */
function ClothBody({ object, topo, selected }: { object: SceneObject; topo: ClothTopology; selected: boolean }) {
  const cloth = object.cloth!;
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
  useEffect(() => {
    sim.current = {
      pos: new Float32Array(topo.particleCount * 3),
      prev: new Float32Array(topo.particleCount * 3),
      broken: new Array(topo.constraints.length).fill(false),
      seeded: false,
    };
  }, [topo]);

  const positionAttr = useMemo(() => new THREE.BufferAttribute(new Float32Array(topo.renderCount * 3), 3), [topo]);

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

    if (!s.seeded) {
      for (let i = 0; i < count; i++) {
        tmpV.set(topo.rest[i * 3], topo.rest[i * 3 + 1], topo.rest[i * 3 + 2]).applyMatrix4(groupWorld);
        s.pos[i * 3] = tmpV.x; s.pos[i * 3 + 1] = tmpV.y; s.pos[i * 3 + 2] = tmpV.z;
        s.prev[i * 3] = tmpV.x; s.prev[i * 3 + 1] = tmpV.y; s.prev[i * 3 + 2] = tmpV.z;
      }
      s.seeded = true;
    }

    const dt = Math.min(Math.max(rawDelta, 1 / 240), 1 / 30);
    const g = -9.81 * cloth.gravityScale * dt * dt;
    const damp = 1 - Math.min(Math.max(cloth.damping, 0), 0.95);
    const sceneWind = env?.wind ?? [0, 0, 0];
    const wx = cloth.wind[0] + sceneWind[0];
    const wy = cloth.wind[1] + sceneWind[1];
    const wz = cloth.wind[2] + sceneWind[2];
    const wob = Math.max(cloth.turbulence, env?.windTurbulence ?? 0) * 6;
    const windX = (wx + (Math.random() - 0.5) * wob) * dt * dt;
    const windY = (wy + (Math.random() - 0.5) * wob) * dt * dt;
    const windZ = (wz + (Math.random() - 0.5) * wob) * dt * dt;

    // Pin: anchor pinned particles to the object's CURRENT world transform.
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
      colliders = gatherColliders(selectActiveObjects(useEditorStore.getState()), object.id, c.clone(), Math.max(cloth.width, cloth.height) + 8);
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

    // Write particle positions to the render vertices (a welded mesh fans one particle out to several).
    const arr = positionAttr.array as Float32Array;
    for (let v = 0; v < topo.renderCount; v++) {
      const p = topo.vertexToParticle[v] * 3;
      arr[v * 3] = s.pos[p]; arr[v * 3 + 1] = s.pos[p + 1]; arr[v * 3 + 2] = s.pos[p + 2];
    }
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

/** Loads an imported model and turns its mesh into the cloth (welded particles + edge constraints). */
function ClothMeshSource({ object, url, selected }: { object: SceneObject; url: string; selected: boolean }) {
  const { scene } = useGLTF(url, DRACO_DECODER_PATH, true, extendGLTFLoader);
  const topo = useMemo(() => {
    // Merge the model's meshes into one local-space geometry (folding in each node's transform), then
    // weld + build constraints. First found geometry drives UVs.
    scene.updateWorldMatrix(true, true);
    let merged: THREE.BufferGeometry | null = null;
    scene.traverse((node) => {
      const m = node as THREE.Mesh;
      if (!m.isMesh || !m.geometry || merged) return;
      const g = m.geometry.clone();
      g.applyMatrix4(m.matrixWorld);
      merged = g;
    });
    if (!merged) return null;
    return buildMeshTopology(merged, object.cloth!);
    // Rebuild on pin/tear/shape-affecting changes.
  }, [scene, object.cloth?.pinMode]);
  if (!topo) return null;
  return <ClothBody object={object} topo={topo} selected={selected} />;
}

/** Grid cloth (the default rectangular sheet). */
function ClothGridSource({ object, selected }: { object: SceneObject; selected: boolean }) {
  const cloth = object.cloth!;
  const topo = useMemo(() => buildGridTopology(cloth), [cloth.resolution, cloth.width, cloth.height, cloth.pinMode]);
  return <ClothBody object={object} topo={topo} selected={selected} />;
}

/**
 * Cloth entry point. Renders the object as a deforming cloth sheet — either a procedural grid, or (when
 * sourceMode is 'mesh' with a model assigned) an imported mesh whose own shape is simulated as cloth,
 * e.g. import a flag model and pin its pole edge.
 */
export function ClothSim({ object, selected }: { object: SceneObject; selected: boolean }) {
  const cloth = object.cloth!;
  const meshUrl = useAssetUrl(cloth.meshAssetId);
  if (cloth.sourceMode === 'mesh' && cloth.meshAssetId && meshUrl) {
    return (
      <Suspense fallback={null}>
        <ClothMeshSource object={object} url={meshUrl} selected={selected} />
      </Suspense>
    );
  }
  return <ClothGridSource object={object} selected={selected} />;
}
