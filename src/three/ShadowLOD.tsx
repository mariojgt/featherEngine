import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useEditorStore } from '../store/editorStore';
import { qualityProfile } from './quality';

const SHADOW_LOD_TMP = new THREE.Vector3();

/**
 * Distance-LOD for shadow CASTING. During Play, a mesh farther from the camera than the quality
 * preset's `shadowDistance` stops rendering into shadow maps — its shadow is imperceptible at range,
 * but it was still costing a draw in every shadow pass. Unlike the light shadow budget this toggles
 * **mesh** `castShadow`, which (unlike a light's) does NOT recompile shaders — it only includes/excludes
 * the mesh from the depth pass — so it's safe to flip as the camera moves. Authored intent is remembered
 * in userData (a mesh that never casts is left alone) and restored on Stop. Throttled to ~7.5 Hz: one
 * scene traversal every 8 frames, far cheaper than the shadow draws it removes. Never hides the object
 * itself, so there's no popping. No-op on Low (no shadows) or when shadowDistance is 0.
 *
 * Mounted in both the editor viewport and the player Canvas (shipped games benefit too).
 */
export function ShadowLOD() {
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const tick = useRef(0);
  const restored = useRef(true);
  useFrame(() => {
    const editorState = useEditorStore.getState();
    if (!editorState.isPlaying) {
      // Back in the editor: restore each mesh's authored shadow-casting once.
      if (!restored.current) {
        scene.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          if (mesh.isMesh && mesh.userData.nfWantsCastShadow !== undefined) mesh.castShadow = mesh.userData.nfWantsCastShadow;
        });
        restored.current = true;
      }
      return;
    }
    restored.current = false;
    const profile = qualityProfile(editorState.renderSettings.quality);
    if (!profile.shadows || profile.shadowDistance <= 0) return;
    tick.current = (tick.current + 1) % 8;
    if (tick.current !== 0) return;
    const maxDistSq = profile.shadowDistance * profile.shadowDistance;
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh & { isInstancedMesh?: boolean };
      if (!mesh.isMesh) return;
      // An instanced batch spans the whole scene; judging it by its single origin would wrongly cull
      // shadows for near instances. Leave instanced meshes always-casting (they're cheap once batched).
      if (mesh.isInstancedMesh) return;
      if (mesh.userData.nfWantsCastShadow === undefined) mesh.userData.nfWantsCastShadow = mesh.castShadow;
      if (!mesh.userData.nfWantsCastShadow) return; // never casts → nothing to budget
      const within = mesh.getWorldPosition(SHADOW_LOD_TMP).distanceToSquared(camera.position) <= maxDistSq;
      if (mesh.castShadow !== within) mesh.castShadow = within;
    });
  });
  return null;
}
