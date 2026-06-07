import * as THREE from 'three';

/**
 * Shared state between the water surfaces and the single WaterEnvCapture pass.
 *
 * - `waterMeshRegistry` holds every water-related mesh (surfaces + the underwater overlay) so the capture
 *   pass can hide them while it re-renders the scene into its reflection/refraction targets (otherwise the
 *   water would reflect/refract itself, or recurse).
 * - `waterCapture` is the latest captured textures + matrices. WaterSurface copies these into its material
 *   uniforms each frame. A one-frame staleness is fine (reflections lag imperceptibly).
 */
export const waterMeshRegistry = new Set<THREE.Object3D>();

export function registerWaterMesh(mesh: THREE.Object3D): () => void {
  waterMeshRegistry.add(mesh);
  return () => {
    waterMeshRegistry.delete(mesh);
  };
}

export const waterCapture = {
  /** Planar reflection of the scene (rendered from a mirror camera). */
  reflection: null as THREE.Texture | null,
  /** Bias * projection * view of the mirror camera, for projective sampling of `reflection`. */
  reflectionMatrix: new THREE.Matrix4(),
  /** Opaque scene color from the main camera (water hidden) — sampled, offset, for refraction. */
  sceneColor: null as THREE.Texture | null,
  /** Scene depth from the main camera — used for soft shoreline edges + intersection foam. */
  sceneDepth: null as THREE.Texture | null,
  /** Render-target pixel size, for screen-space (gl_FragCoord-based) sampling. */
  resolution: new THREE.Vector2(1, 1),
  cameraNear: 0.1,
  cameraFar: 1000,
  /** True only when the capture pass actually produced this frame's textures (else shaders fall back). */
  hasReflection: false,
  hasRefraction: false,
};
