import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { SceneEnvironmentSettings } from '../types';
import { useEditorStore } from '../store/editorStore';
import { SurfaceWeatherMaterials, surfaceWeatherUniforms } from './surfaceWeatherMaterials';
import { advanceSurfaceWater, type SurfaceWaterState } from './surfaceWeatherClock';

export function SurfaceWeather({ environment }: { environment:SceneEnvironmentSettings }){
  const {gl,scene}=useThree();
  const manager=useRef<SurfaceWeatherMaterials|null>(null);
  const water=useRef<SurfaceWaterState>({water:0});
  const uniforms=useRef(surfaceWeatherUniforms());
  const frame=useRef(0);
  useEffect(()=>{const instance=new SurfaceWeatherMaterials(uniforms.current,gl);manager.current=instance;instance.sync(scene);
    return()=>{instance.dispose();if(manager.current===instance)manager.current=null;};},[gl,scene]);
  useFrame(({clock})=>{
    const state=useEditorStore.getState(),time=state.isPlaying?state.runtimeTime:clock.elapsedTime;
    const accumulated=advanceSurfaceWater(water.current,time,environment.rainIntensity??0,environment.wetnessFromRain===true);
    const u=uniforms.current;u.featherWetness.value=Math.max(environment.surfaceWetness??0,accumulated);
    u.featherPuddles.value=environment.puddleCoverage??0;
    u.featherRain.value=state.renderSettings.quality==='Low'||state.renderSettings.quality==='Medium'?0:environment.rainIntensity??0;
    u.featherWeatherTime.value=time;
    if(frame.current++%15===0)manager.current?.sync(scene);
  },-4);
  return null;
}
