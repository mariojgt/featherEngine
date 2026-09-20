import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { SceneEnvironmentSettings } from '../types';
import { useEditorStore } from '../store/editorStore';
import { SkyRadiance } from './skyRadiance';

export function SkyLighting({ environment }: { environment: SceneEnvironmentSettings }) {
  const {gl,scene}=useThree();
  const quality=useEditorStore(s=>s.renderSettings.quality);
  const cache=useRef<SkyRadiance|null>(null);
  useEffect(()=>{
    const instance=new SkyRadiance(gl,quality);cache.current=instance;
    const original={environment:scene.environment,intensity:scene.environmentIntensity,rotation:scene.environmentRotation.clone()};
    scene.environmentRotation.set(0,0,0);
    return ()=>{
      if(scene.environment===instance.filtered?.texture){scene.environment=original.environment;scene.environmentIntensity=original.intensity;scene.environmentRotation.copy(original.rotation);}
      instance.dispose();if(cache.current===instance)cache.current=null;
    };
  },[gl,scene,quality]);
  useFrame(({clock})=>{
    const state=useEditorStore.getState();
    const texture=cache.current?.update(environment,state.isPlaying?state.runtimeTime:clock.elapsedTime);
    if(texture){scene.environment=texture;scene.environmentIntensity=environment.environmentIntensity;}
  },-3);
  return null;
}
