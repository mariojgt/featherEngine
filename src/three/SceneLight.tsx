import { useMemo } from 'react';
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import type { LightComponent } from '../types';
import { useEditorStore } from '../store/editorStore';
import { resolveLight } from './lightSettings';

RectAreaLightUniformsLib.init();

/** One rendering contract for editor, Play and exported games. */
export function SceneLight({ light }: { light?: LightComponent }) {
  const quality = useEditorStore(s => s.renderSettings.quality);
  const l = resolveLight(light, quality);
  const target = useMemo(() => { const object = new THREE.Object3D(); object.position.set(0, 0, -1); return object; }, []);
  const shadow = {
    castShadow: l.castShadow, 'shadow-mapSize-width': l.shadowSize, 'shadow-mapSize-height': l.shadowSize,
    'shadow-bias': l.shadowBias, 'shadow-normalBias': l.shadowNormalBias,
    'shadow-camera-near': l.shadowNear, 'shadow-camera-far': l.shadowFar,
    onUpdate: (lamp: THREE.PointLight | THREE.SpotLight | THREE.DirectionalLight) => lamp.shadow.camera.updateProjectionMatrix(),
  };
  if (l.type === 'rect') return <rectAreaLight color={l.color} intensity={l.intensity} width={l.width} height={l.height} />;
  if (l.type === 'point') return <pointLight color={l.color} intensity={l.intensity} distance={l.distance} decay={l.decay} {...shadow} />;
  return <>
    {l.useRotation && <primitive object={target} />}
    {l.type === 'spot' ? <spotLight color={l.color} intensity={l.intensity} distance={l.distance} decay={l.decay}
      angle={l.angle} penumbra={l.penumbra} {...(l.useRotation ? {target} : {})} {...shadow} /> :
      <directionalLight color={l.color} intensity={l.intensity} {...(l.useRotation ? {target} : {})} {...shadow}
        shadow-camera-left={-l.shadowExtent} shadow-camera-right={l.shadowExtent} shadow-camera-top={l.shadowExtent} shadow-camera-bottom={-l.shadowExtent} />}
  </>;
}
