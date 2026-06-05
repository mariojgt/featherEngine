import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useEditorStore } from '../store/editorStore';
import { qualityProfile } from './quality';
import { getLodGeometry, isLodCandidate, meshLodReady, setLodGenBudget } from './meshLodCache';

const LOD_CENTER = new THREE.Vector3();
const LOD_SCALE = new THREE.Vector3();
const LOD_TMP_POS = new THREE.Vector3();
const LOD_TMP_QUAT = new THREE.Quaternion();

/** New geometries simplified per throttled traversal — keeps the per-tick cost bounded. */
const GEN_PER_TICK = 2;

/**
 * Distance-LOD for mesh GEOMETRY. During Play, a mesh past the quality preset's `lodDistance` swaps to
 * an auto-simplified lower-triangle copy (and an even cheaper one past ~2.5×), cutting vertex/triangle
 * throughput for distant detail. The LOD copies share the original's vertex buffers (only the index
 * shrinks — see `meshLod.ts`), so the only GPU cost is a small index upload, generated once and cached.
 *
 * Same safe shape as {@link ShadowLOD}: Play-only, one throttled scene traversal every 8 frames, the
 * original geometry remembered in userData and restored on Stop. Distance uses each mesh's world-space
 * bounding sphere (so a large building doesn't pop while you stand beside its far origin). Skips
 * skinned, instanced, multi-material, sky/particle (`frustumCulled === false`), and small meshes.
 *
 * Mounted in both the editor viewport and the player Canvas (shipped games benefit too).
 */
export function MeshLOD() {
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const tick = useRef(0);
  const restored = useRef(true);

  useFrame(() => {
    const editorState = useEditorStore.getState();
    if (!editorState.isPlaying) {
      if (!restored.current) {
        scene.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          if (mesh.isMesh && mesh.userData.nfLod0) mesh.geometry = mesh.userData.nfLod0 as THREE.BufferGeometry;
        });
        restored.current = true;
      }
      return;
    }
    restored.current = false;

    const lodDistance = qualityProfile(editorState.renderSettings.quality).lodDistance;
    if (lodDistance <= 0 || !meshLodReady()) return;

    tick.current = (tick.current + 1) % 8;
    if (tick.current !== 0) return;

    setLodGenBudget(GEN_PER_TICK);
    const near = lodDistance;
    const far = lodDistance * 2.5;

    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh & { isInstancedMesh?: boolean; isSkinnedMesh?: boolean };
      if (!mesh.isMesh || mesh.isInstancedMesh || mesh.isSkinnedMesh) return;
      // Sky dome, particles and instanced batches all opt out of frustum culling — never LOD those.
      if (mesh.frustumCulled === false) return;

      // Remember the authored (level-0) geometry once, and only manage genuine LOD candidates.
      const original = (mesh.userData.nfLod0 as THREE.BufferGeometry | undefined) ?? mesh.geometry;
      if (mesh.userData.nfLod0 === undefined) {
        if (!isLodCandidate(original)) {
          mesh.userData.nfLod0 = null; // mark "not managed" so we don't re-test every tick
          return;
        }
        mesh.userData.nfLod0 = original;
      }
      if (!mesh.userData.nfLod0) return; // null ⇒ not a candidate

      // World-space nearest distance to the mesh's bounds (center distance minus its radius).
      if (!original.boundingSphere) original.computeBoundingSphere();
      const sphere = original.boundingSphere;
      if (!sphere) return;
      LOD_CENTER.copy(sphere.center).applyMatrix4(mesh.matrixWorld);
      mesh.matrixWorld.decompose(LOD_TMP_POS, LOD_TMP_QUAT, LOD_SCALE);
      const worldRadius = sphere.radius * Math.max(LOD_SCALE.x, LOD_SCALE.y, LOD_SCALE.z);
      const distance = LOD_CENTER.distanceTo(camera.position) - worldRadius;

      const level = distance < near ? 0 : distance < far ? 1 : 2;
      const target = getLodGeometry(original, level);
      if (target && mesh.geometry !== target) mesh.geometry = target;
    });
  });

  return null;
}
