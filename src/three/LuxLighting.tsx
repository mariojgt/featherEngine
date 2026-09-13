import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { selectActiveSceneEnvironment, useEditorStore } from '../store/editorStore';
import { LuxCache } from './lux/cache';
import { luxBudget, resolveLux } from './lux/settings';
import { LuxRooms } from './lux/rooms';

export function LuxLighting() {
  const { gl, scene } = useThree();
  const sceneId = useEditorStore((state) => state.activeSceneId);
  const authored = useEditorStore((state) => selectActiveSceneEnvironment(state)?.lux);
  const quality = useEditorStore((state) => state.renderSettings.quality);
  const settings = resolveLux(authored);
  const budget = luxBudget(settings, quality);
  const cache = useRef<LuxCache | LuxRooms | null>(null);
  const helper = useRef<THREE.Group>(null);
  const resolution = budget?.resolution ?? 0;
  const roomKey = settings.mode === 'rooms' ? JSON.stringify(settings.rooms) : '';
  // Allocate in an effect so React StrictMode's setup→cleanup→setup creates fresh live GPU targets.
  useEffect(() => {
    if (!budget) return;
    const instance = settings.mode === 'rooms' ? new LuxRooms(gl, scene, sceneId, budget, settings.rooms) : new LuxCache(gl, scene, sceneId, budget);
    cache.current = instance;
    return () => { instance.dispose(); if (cache.current === instance) cache.current = null; };
    // Only allocation-affecting settings restart the cache; strengths remain live uniforms.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, scene, sceneId, resolution, budget?.interval, settings.refreshNonce, settings.mode, roomKey]);
  useFrame(({ camera, clock }, dt) => {
    cache.current?.update(camera, settings, clock.elapsedTime, dt);
    if (helper.current && cache.current) helper.current.position.copy(cache.current.uniforms.luxOrigin.value);
  });
  return settings.debug && budget ? (
    settings.mode === 'rooms' ? <group userData={{ luxExclude: true }}>{settings.rooms.map((room) => <group key={room.id}>
      <mesh position={room.center}><boxGeometry args={room.size} /><meshBasicMaterial color="#ffd580" wireframe transparent opacity={0.25} depthWrite={false} /></mesh>
      <mesh position={room.capturePosition ?? room.center}><sphereGeometry args={[0.15, 12, 8]} /><meshBasicMaterial color="#ffd580" /></mesh>
    </group>)}</group> : <group ref={helper} userData={{ luxExclude: true }}>
      <mesh><sphereGeometry args={[0.15, 12, 8]} /><meshBasicMaterial color="#ffd580" /></mesh>
      <mesh><sphereGeometry args={[settings.radius, 24, 12]} /><meshBasicMaterial color="#ffd580" wireframe transparent opacity={0.12} depthWrite={false} /></mesh>
    </group>
  ) : null;
}
