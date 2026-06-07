import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { defaultWaterVolume } from '../store/editor/defaults';
import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import { qualityProfile } from './quality';
import { waterCapture, waterMeshRegistry } from './waterShared';

// Scratch vectors/matrices reused every frame (no per-frame allocation).
const reflectorPos = new THREE.Vector3();
const cameraPos = new THREE.Vector3();
const normal = new THREE.Vector3(0, 1, 0);
const view = new THREE.Vector3();
const target = new THREE.Vector3();
const lookAt = new THREE.Vector3();
const rotationMatrix = new THREE.Matrix4();
const biasMatrix = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);

/**
 * The single scene-capture pass that powers reflective/refractive water. Once per frame (before the main
 * render) it re-renders the scene — with all water hidden — into two targets:
 *  • a half-res PLANAR REFLECTION from a mirror camera across the dominant water surface (clipped to
 *    above-water geometry), and
 *  • a full-res SCENE COLOR + DEPTH from the main camera, used for refraction and depth-based shoreline
 *    foam / soft edges.
 * Results land in the shared `waterCapture` singleton; WaterSurface copies them into its uniforms.
 *
 * Gated to High/Epic quality (the extra renders are the cost of "real" water); on Low/Medium it does
 * nothing and the surface shader falls back to fresnel-sky reflection + UV-edge foam.
 */
export function WaterEnvCapture() {
  const { gl, scene, camera, size } = useThree();
  const quality = useEditorStore((state) => state.renderSettings?.quality);
  const enabled = useMemo(() => {
    const p = qualityProfile(quality);
    // Reuse the SSR/ssao "heavy effects" tiers: High & Epic. (qualityProfile exposes booleans, not a name.)
    return Boolean(p.ssao || p.ssr);
  }, [quality]);

  const dpr = Math.min(gl.getPixelRatio(), 2);
  const sceneW = Math.max(2, Math.floor(size.width * dpr));
  const sceneH = Math.max(2, Math.floor(size.height * dpr));

  const sceneFBO = useMemo(() => {
    const fbo = new THREE.WebGLRenderTarget(sceneW, sceneH, { depthBuffer: true });
    fbo.depthTexture = new THREE.DepthTexture(sceneW, sceneH);
    fbo.depthTexture.format = THREE.DepthFormat;
    fbo.depthTexture.type = THREE.UnsignedShortType;
    return fbo;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const reflectFBO = useMemo(() => new THREE.WebGLRenderTarget(2, 2), []);
  const virtualCamera = useMemo(() => new THREE.PerspectiveCamera(), []);

  useEffect(() => {
    sceneFBO.setSize(sceneW, sceneH);
    if (sceneFBO.depthTexture) {
      sceneFBO.depthTexture.image.width = sceneW;
      sceneFBO.depthTexture.image.height = sceneH;
    }
    reflectFBO.setSize(Math.max(2, Math.floor(sceneW / 2)), Math.max(2, Math.floor(sceneH / 2)));
  }, [sceneFBO, reflectFBO, sceneW, sceneH]);

  useEffect(
    () => () => {
      sceneFBO.dispose();
      reflectFBO.dispose();
    },
    [sceneFBO, reflectFBO],
  );

  useFrame(() => {
    if (!enabled) {
      waterCapture.hasReflection = false;
      waterCapture.hasRefraction = false;
      return;
    }
    // Find the dominant (largest-footprint) enabled water volume → its top face is the reflection plane.
    const objects = selectActiveObjects(useEditorStore.getState());
    let planeY = 0;
    let bestArea = -1;
    for (const object of objects) {
      if (!object.water?.enabled) continue;
      const sx = Math.abs(object.transform.scale[0]);
      const sz = Math.abs(object.transform.scale[2]);
      const area = sx * sz;
      if (area > bestArea) {
        bestArea = area;
        planeY = object.transform.position[1] + Math.abs(object.transform.scale[1]) * 0.5;
      }
    }
    if (bestArea < 0) {
      waterCapture.hasReflection = false;
      waterCapture.hasRefraction = false;
      return;
    }

    const persp = camera as THREE.PerspectiveCamera;
    waterCapture.resolution.set(sceneFBO.width, sceneFBO.height);
    waterCapture.cameraNear = persp.near ?? 0.1;
    waterCapture.cameraFar = persp.far ?? 1000;

    const prevTarget = gl.getRenderTarget();
    const prevShadowAuto = gl.shadowMap.autoUpdate;
    gl.shadowMap.autoUpdate = false;

    // Hide every water mesh so the captures don't include (or recurse into) the water itself.
    const hidden: THREE.Object3D[] = [];
    for (const mesh of waterMeshRegistry) {
      if (mesh.visible) {
        mesh.visible = false;
        hidden.push(mesh);
      }
    }

    // --- Scene color + depth (main camera) for refraction + shoreline depth ---
    gl.setRenderTarget(sceneFBO);
    gl.clear();
    gl.render(scene, camera);
    waterCapture.sceneColor = sceneFBO.texture;
    waterCapture.sceneDepth = sceneFBO.depthTexture;
    waterCapture.hasRefraction = true;

    // --- Planar reflection (mirror camera across y = planeY) ---
    reflectorPos.set(0, planeY, 0);
    cameraPos.setFromMatrixPosition(camera.matrixWorld);
    view.subVectors(reflectorPos, cameraPos);
    if (view.dot(normal) < 0) {
      // Camera is above the water — safe to build the mirrored view.
      view.reflect(normal).negate().add(reflectorPos);
      rotationMatrix.extractRotation(camera.matrixWorld);
      lookAt.set(0, 0, -1).applyMatrix4(rotationMatrix).add(cameraPos);
      target.subVectors(reflectorPos, lookAt).reflect(normal).negate().add(reflectorPos);
      virtualCamera.position.copy(view);
      virtualCamera.up.set(0, 1, 0).applyMatrix4(rotationMatrix).reflect(normal);
      virtualCamera.lookAt(target);
      virtualCamera.near = persp.near;
      virtualCamera.far = persp.far;
      virtualCamera.aspect = persp.aspect;
      virtualCamera.projectionMatrix.copy(persp.projectionMatrix);
      virtualCamera.updateMatrixWorld();

      waterCapture.reflectionMatrix
        .copy(biasMatrix)
        .multiply(virtualCamera.projectionMatrix)
        .multiply(virtualCamera.matrixWorldInverse);

      // Clip away everything below the surface so we don't reflect submerged geometry.
      const clip = [new THREE.Plane(new THREE.Vector3(0, 1, 0), -(planeY - 0.05))];
      const prevClip = gl.clippingPlanes;
      gl.clippingPlanes = clip;
      gl.setRenderTarget(reflectFBO);
      gl.clear();
      gl.render(scene, virtualCamera);
      gl.clippingPlanes = prevClip;

      waterCapture.reflection = reflectFBO.texture;
      waterCapture.hasReflection = true;
    } else {
      waterCapture.hasReflection = false;
    }

    // Restore state.
    gl.setRenderTarget(prevTarget);
    gl.shadowMap.autoUpdate = prevShadowAuto;
    for (const mesh of hidden) mesh.visible = true;
  });

  return null;
}
