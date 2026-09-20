import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, useGLTF } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import { SHARDS, WARDEN, type Hero } from '../../examples/titan-mmo/server/world.mjs';
import { useEditorStore } from '../store/editorStore';
import { useAssetUrl } from '../three/ModelAsset';
import { useTitanActive } from './TitanHUD';
import { useRealm } from './session';

function Avatar({ url, moving }: { url: string; moving: boolean }) {
  const model = useGLTF(url);
  const clone = useMemo(() => SkeletonUtils.clone(model.scene), [model.scene]);
  const mixer = useMemo(() => new THREE.AnimationMixer(clone), [clone]);
  const size = useMemo(() => { const box = new THREE.Box3().setFromObject(clone); return { scale: 1.8 / Math.max(.1, box.max.y - box.min.y), minY: box.min.y }; }, [clone]);
  useEffect(() => {
    const clip = model.animations.find(a => moving ? /^jog_fwd_loop/i.test(a.name) : /^idle_loop/i.test(a.name))
      ?? model.animations.find(a => moving ? /walk.*loop/i.test(a.name) : /idle/i.test(a.name)) ?? model.animations[0];
    if (!clip) return;
    const action = mixer.clipAction(clip); action.reset().fadeIn(.15).play();
    return () => { action.fadeOut(.15); };
  }, [mixer, model.animations, moving]);
  useEffect(() => () => { mixer.stopAllAction(); mixer.uncacheRoot(clone); }, [clone, mixer]);
  useFrame((_, dt) => mixer.update(Math.min(dt, .1)));
  return <group scale={size.scale}><primitive object={clone} position={[0, -size.minY, 0]} /></group>;
}
function BundledBlade({ url }: { url: string }) {
  const model = useGLTF(url);
  const normalized = useMemo(() => {
    const clone = model.scene.clone(true); const box = new THREE.Box3().setFromObject(clone);
    const size = box.getSize(new THREE.Vector3()); const center = box.getCenter(new THREE.Vector3());
    const axis = size.x > size.y && size.x > size.z ? new THREE.Vector3(1, 0, 0) : size.z > size.y ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    return { clone, center: center.negate(), scale: 1.1 / Math.max(.1, size.x, size.y, size.z), rotation: new THREE.Quaternion().setFromUnitVectors(axis, new THREE.Vector3(0, 1, 0)) };
  }, [model.scene]);
  return <group position={[0, .4, 0]} scale={normalized.scale} quaternion={normalized.rotation}><primitive object={normalized.clone} position={normalized.center} /></group>;
}
function HeroView({ hero, local, url, swordUrl }: { hero: Hero; local: boolean; url?: string; swordUrl?: string }) {
  const group = useRef<THREE.Group>(null);
  const blade = useRef<THREE.Group>(null);
  const last = useRef({ x: hero.x, z: hero.z });
  const moving = Math.hypot(hero.x - last.current.x, hero.z - last.current.z) > .015;
  useEffect(() => { last.current = { x: hero.x, z: hero.z }; }, [hero.x, hero.z]);
  useFrame((_, dt) => {
    if (!group.current) return;
    group.current.position.lerp(new THREE.Vector3(hero.x, .02, hero.z), 1 - Math.exp(-dt * 16));
    group.current.rotation.y = hero.yaw;
    const time = useRealm.getState().snapshot?.time ?? 0;
    if (blade.current) blade.current.rotation.x = time - hero.attackAt < .35 ? -1.5 + Math.sin((time - hero.attackAt) * 10) * 1.5 : -.3;
  });
  return <group ref={group} position={[hero.x, .02, hero.z]}>
    {url ? <Suspense fallback={<mesh position={[0, .9, 0]}><capsuleGeometry args={[.28, 1, 5, 8]} /><meshStandardMaterial color={local ? '#dbbb68' : '#79bcbd'} /></mesh>}><Avatar url={url} moving={moving} /></Suspense> : <mesh position={[0, .9, 0]}><capsuleGeometry args={[.28, 1, 5, 8]} /><meshStandardMaterial color={local ? '#dbbb68' : '#79bcbd'} /></mesh>}
    <group ref={blade} position={[.38, .8, .15]}>{swordUrl ? <Suspense fallback={null}><BundledBlade url={swordUrl} /></Suspense> : <mesh position={[0, .3, 0]}><boxGeometry args={[.07, .9, .06]} /><meshStandardMaterial color="#d7d8c4" metalness={.65} roughness={.3} /></mesh>}{hero.equipped === 'warden-blade' && <pointLight color="#a9e3ff" intensity={1.2} distance={2} />}</group>
    <Html position={[0, 2.25, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}><div className="titan-label">{hero.name}<small>{local ? 'You' : 'Adventurer'}</small></div></Html>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .015, 0]}><ringGeometry args={[.38, .43, 28]} /><meshBasicMaterial color={local ? '#f6d57b' : '#7bd6d9'} transparent opacity={.7} /></mesh>
  </group>;
}
export function TitanWorld() {
  const active = useTitanActive();
  return active ? <RealmActors /> : null;
}
function RealmActors() {
  const snapshot = useRealm(s => s.snapshot);
  const assetId = useEditorStore(s => s.assets.find(a => a.name === 'UAL1.glb')?.id);
  const url = useAssetUrl(assetId);
  const swordId = useEditorStore(s => s.assets.find(a => a.name === 'Sword.glb')?.id);
  const swordUrl = useAssetUrl(swordId);
  const hero = snapshot?.players.find(p => p.id === snapshot.selfId);
  const cameraTarget = useRef(new THREE.Vector3(0, 1, -5));
  const initial = useRef(true);
  useFrame(({ camera }, dt) => {
    const live = useRealm.getState().snapshot;
    const player = live?.players.find(p => p.id === live.selfId);
    const position = player ? new THREE.Vector3(player.x, 0, player.z) : new THREE.Vector3(-3, 0, 0);
    const goal = position.clone().add(new THREE.Vector3(0, 11, 14));
    if (initial.current) { camera.position.copy(goal); initial.current = false; }
    camera.position.lerp(goal, 1 - Math.exp(-Math.min(dt, .1) * 5));
    cameraTarget.current.lerp(position.add(new THREE.Vector3(0, .5, -2)), 1 - Math.exp(-Math.min(dt, .1) * 5));
    camera.lookAt(cameraTarget.current);
  });
  return <>
    <group position={[WARDEN.x, 0, WARDEN.z]}><mesh position={[0, .8, 0]} castShadow><capsuleGeometry args={[.3, 1, 6, 10]} /><meshStandardMaterial color="#7d9870" roughness={.8} /></mesh><mesh position={[0, 1.7, 0]}><sphereGeometry args={[.22, 12, 8]} /><meshStandardMaterial color="#e3b983" /></mesh><Html position={[0, 2.6, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}><div className="titan-label">✧ Warden Elara<small>{hero?.quest === 'complete' ? 'Meadow keeper' : 'E · Speak / turn in quest'}</small></div></Html></group>
    {SHARDS.filter(s => !hero?.gathered.includes(s.id)).map(shard => <group key={shard.id} position={[shard.x, .9, shard.z]}><mesh rotation={[0, Math.PI / 4, .2]} castShadow><octahedronGeometry args={[.5, 0]} /><meshStandardMaterial color="#ffe08b" emissive="#edae37" emissiveIntensity={1.2} metalness={.3} roughness={.25} /></mesh><pointLight color="#edc358" intensity={2} distance={3} /><Html position={[0, 1, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}><div className="titan-label">Sun shard<small>E · Gather</small></div></Html></group>)}
    {snapshot?.enemies.filter(e => e.health > 0).map(enemy => <group key={enemy.id} position={[enemy.x, .8, enemy.z]}><mesh castShadow><icosahedronGeometry args={[.55, 1]} /><meshStandardMaterial color="#bf76c6" emissive="#70376f" emissiveIntensity={snapshot.time - enemy.hitAt < .2 ? 3 : .3} roughness={.5} /></mesh><mesh rotation={[Math.PI / 2.8, .2, 0]}><torusGeometry args={[.65, .025, 6, 24]} /><meshStandardMaterial color="#efb4d6" emissive="#aa629c" emissiveIntensity={.7} /></mesh><Html position={[0, 1.1, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}><div className="titan-label">Wild wisp<div className="titan-enemy-health"><i style={{ width: `${enemy.health / 48 * 100}%` }} /></div></div></Html></group>)}
    {snapshot?.players.map(player => <HeroView key={player.id} hero={player} local={player.id === snapshot.selfId} url={url} swordUrl={swordUrl} />)}
  </>;
}
