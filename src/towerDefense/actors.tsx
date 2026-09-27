import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import * as THREE from 'three';
import type { createGame, EnemyKind, TowerKind } from './game';
import { useGarden } from './session';

export const DEFENDER_COLORS: Record<TowerKind, string> = { seed: '#78b954', frost: '#84d5e2', cannon: '#efae65' };
type Game = ReturnType<typeof createGame>;
const sphere = new THREE.SphereGeometry(1, 16, 12);
const box = new THREE.BoxGeometry(1, 1, 1);
const cylinder = new THREE.CylinderGeometry(1, 1, 1, 16);

export function ToyPart({ p = [0, 0, 0], s = [1, 1, 1], color, shape = 'sphere', r = [0, 0, 0] }: { p?: [number, number, number]; s?: [number, number, number]; color: string; shape?: 'sphere' | 'box' | 'cylinder'; r?: [number, number, number] }) {
  return <mesh position={p} scale={s} rotation={r} geometry={shape === 'sphere' ? sphere : shape === 'box' ? box : cylinder} castShadow receiveShadow><meshStandardMaterial color={color} roughness={0.76} /></mesh>;
}

export function Defender({ tower }: { tower: Game['towers'][number] }) {
  const head = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const color = DEFENDER_COLORS[tower.kind];
  useFrame(() => {
    const session = useGarden.getState();
    if (head.current) head.current.rotation.y = tower.targetAngle;
    if (body.current) body.current.scale.y = 1 + Math.sin(session.game.elapsed * 3 + tower.plotId) * 0.025;
  });
  return <group position={[tower.x, 0.25, tower.z]} scale={1 + (tower.level - 1) * 0.1}>
    <ToyPart p={[0, 0.12, 0]} s={[0.6, 0.22, 0.6]} color="#ac8467" shape="cylinder" />
    <ToyPart p={[0, 0.26, 0]} s={[0.63, 0.1, 0.63]} color="#e1b18a" shape="cylinder" />
    <group ref={body}>
      <ToyPart p={[0, 0.68, 0]} s={[0.16, 0.68, 0.16]} color="#4c8e68" shape="cylinder" />
      {[-1, 1].map(side => <ToyPart key={side} p={[side * 0.33, 0.48, 0]} s={[0.47, 0.13, 0.24]} r={[0, 0, side * 0.4]} color="#67a879" />)}
      <group ref={head} position={[0, 1.18, 0]}>
        <ToyPart s={[0.54, 0.49, 0.52]} color={color} />
        {tower.kind === 'seed' && <><ToyPart p={[0, -0.01, 0.52]} s={[0.25, 0.25, 0.36]} color="#87c660" /><ToyPart p={[0, -0.01, 0.8]} s={[0.16, 0.16, 0.04]} color="#365d3c" /><ToyPart p={[0, 0.54, -0.07]} s={[0.14, 0.32, 0.17]} r={[0.3, 0, -0.4]} color="#a5d674" /></>}
        {tower.kind === 'frost' && Array.from({ length: 6 }, (_, i) => <ToyPart key={i} p={[Math.sin(i * Math.PI / 3) * 0.5, Math.cos(i * Math.PI / 3) * 0.5, -0.1]} s={[0.26, 0.26, 0.14]} color="#ccf4ef" />)}
        {tower.kind === 'cannon' && <><ToyPart p={[0, 0.42, 0]} s={[0.1, 0.28, 0.1]} color="#628a58" shape="cylinder" /><ToyPart p={[0, 0.1, 0.5]} s={[0.32, 0.3, 0.32]} color="#d2854d" /><ToyPart p={[0, 0.1, 0.72]} s={[0.2, 0.19, 0.08]} color="#594c47" /></>}
        {[-1, 1].map(side => <group key={side}><ToyPart p={[side * 0.26, 0.12, 0.405]} s={[0.075, 0.105, 0.055]} color="#263c36" /><ToyPart p={[side * 0.28 - 0.012, 0.155, 0.451]} s={[0.022, 0.029, 0.018]} color="#fff5d7" /></group>)}
      </group>
    </group>
    {Array.from({ length: tower.level }, (_, i) => <ToyPart key={i} p={[-0.2 + i * 0.2, 0.18, 0.57]} s={[0.055, 0.055, 0.02]} color="#fff0a8" />)}
  </group>;
}

export function ZombieModel({ kind, walking = true }: { kind: EnemyKind; walking?: boolean }) {
  const rig = useRef<THREE.Group>(null), left = useRef<THREE.Group>(null), right = useRef<THREE.Group>(null);
  const skin = kind === 'brute' ? '#98a7c6' : kind === 'runner' ? '#b3c46c' : '#a4c997';
  useFrame(() => {
    const t = useGarden.getState().game.elapsed * (kind === 'runner' ? 12 : 6);
    if (rig.current) { rig.current.position.y = Math.abs(Math.sin(t)) * (walking ? 0.06 : 0.015); rig.current.rotation.z = Math.sin(t) * 0.04; }
    if (left.current) left.current.rotation.x = Math.sin(t) * 0.45;
    if (right.current) right.current.rotation.x = -Math.sin(t) * 0.45;
  });
  return <group ref={rig} scale={kind === 'brute' ? 1.35 : kind === 'runner' ? 0.8 : 1}>
    <group ref={left} position={[-0.16, 0.48, 0]}><ToyPart p={[0, -0.21, 0]} s={[0.11, 0.28, 0.12]} color="#607374" /><ToyPart p={[0, -0.39, 0.08]} s={[0.15, 0.11, 0.21]} color="#384c50" /></group>
    <group ref={right} position={[0.16, 0.48, 0]}><ToyPart p={[0, -0.21, 0]} s={[0.11, 0.28, 0.12]} color="#607374" /><ToyPart p={[0, -0.39, 0.08]} s={[0.15, 0.11, 0.21]} color="#384c50" /></group>
    <ToyPart p={[0, 0.74, 0]} s={[0.31, 0.36, 0.22]} color={kind === 'runner' ? '#d48d78' : '#a995bc'} />
    <ToyPart p={[0, 0.8, 0.22]} s={[0.16, 0.13, 0.035]} color="#ded5b8" shape="box" r={[0, 0, 0.2]} />
    {[-1, 1].map(side => <group key={side}><ToyPart p={[side * 0.39, 0.8, 0.2]} s={[0.11, 0.12, 0.3]} color={skin} /><ToyPart p={[side * 0.39, 0.8, 0.47]} s={[0.13, 0.1, 0.13]} color={skin} /></group>)}
    <ToyPart p={[0, 1.28, 0.06]} s={[0.43, 0.41, 0.36]} color={skin} />
    {[-1, 1].map(side => <group key={side}><ToyPart p={[side * 0.185, 1.35, 0.365]} s={[0.15, side < 0 ? 0.16 : 0.13, 0.09]} color="#fff3d6" /><ToyPart p={[side * 0.18, 1.35, 0.439]} s={[0.052, 0.065, 0.036]} color="#30483e" /></group>)}
    <ToyPart p={[0.04, 1.11, 0.407]} s={[0.22, 0.065, 0.035]} color="#4d695b" r={[0, 0, -0.13]} />
    <ToyPart p={[-0.05, 1.115, 0.442]} s={[0.055, 0.07, 0.02]} color="#fff1cc" shape="box" />
    {kind === 'brute' ? <><ToyPart p={[0, 1.64, 0.02]} s={[0.43, 0.13, 0.38]} color="#c2bbc2" /><ToyPart p={[0, 1.68, 0.07]} s={[0.24, 0.15, 0.22]} color="#e2d5bc" /></> : <ToyPart p={[0.07, 1.68, 0]} s={[0.09, 0.16, 0.06]} color="#557a50" r={[0, 0, -0.4]} />}
  </group>;
}

export function Zombie({ enemy }: { enemy: Game['enemies'][number] }) {
  const group = useRef<THREE.Group>(null), bar = useRef<THREE.Mesh>(null);
  const last = useRef({ x: enemy.x, z: enemy.z });
  useFrame(() => {
    if (!group.current) return;
    const dx = enemy.x - last.current.x, dz = enemy.z - last.current.z;
    if (Math.abs(dx) + Math.abs(dz) > 0.0001) group.current.rotation.y = Math.atan2(dx, dz);
    last.current = { x: enemy.x, z: enemy.z };
    group.current.position.set(enemy.x, 0.25, enemy.z);
    if (bar.current) {
      bar.current.scale.x = 0.76 * Math.max(0.01, enemy.hp / enemy.maxHp);
      bar.current.position.x = bar.current.scale.x / 2;
    }
  });
  return <group ref={group} position={[enemy.x, 0.25, enemy.z]}>
    <ZombieModel kind={enemy.kind} />
    {enemy.hp < enemy.maxHp && <Billboard position={[0, enemy.kind === 'brute' ? 2.6 : 2.05, 0]}><mesh geometry={box} scale={[0.8, 0.09, 0.08]}><meshBasicMaterial color="#365749" /></mesh><group position={[-0.38, 0, 0.05]}><mesh ref={bar} geometry={box} position={[0.38, 0, 0]} scale={[0.76, 0.055, 0.02]}><meshBasicMaterial color={enemy.slowUntil > useGarden.getState().game.elapsed ? '#b5effa' : '#e8ed97'} /></mesh></group></Billboard>}
  </group>;
}
