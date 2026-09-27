import { groundHeight } from '../../examples/titan-mmo/server/valley.mjs';
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CLASSES, type ClassId, type Effect } from '../../examples/titan-mmo/server/world.mjs';
import { useRealm } from './session';

/** Transient combat visuals. Every effect expires with the server's 1.2 s effect lifetime. */
const LIFETIME = 1.2;
/** One geometry per shape, shared by every effect instance — effects spawn and die constantly. */
const RING = new THREE.RingGeometry(0.86, 1, 40);
const BALL = new THREE.SphereGeometry(1, 10, 8);
const SHARD = new THREE.OctahedronGeometry(1, 0);
const COLUMN = new THREE.CylinderGeometry(1, 1, 1, 16, 1, true);
const SPARK = new THREE.BoxGeometry(0.06, 0.06, 0.5);
const SPOKES = [0, 1, 2, 3, 4].map(i => (i / 5) * Math.PI * 2);

const CLASS_COLOR: Record<ClassId, string> = { warrior: '#ffd79a', ranger: '#b7e6a1', mage: '#ff9f52' };
const classColor = (id?: ClassId) => (id ? CLASS_COLOR[id] : '#ffd79a');
/** 0 → 1 over `span` seconds, clamped. */
const progress = (age: number, span: number) => Math.max(0, Math.min(1, age / span));
const fade = (age: number, span: number) => Math.max(0, 1 - age / span);
/** Drive every child mesh's opacity from one place — cheaper than a material ref per spark. */
function setGroupOpacity(group: THREE.Group | null, opacity: number) {
  if (!group) return;
  for (const child of group.children) {
    const material = (child as THREE.Mesh).material;
    if (material && !Array.isArray(material)) (material as THREE.MeshBasicMaterial).opacity = opacity;
  }
}
/** Seconds since the effect was created, read live so visuals stay smooth between 20 Hz snapshots. */
const sinceEffect = (at: number) => (useRealm.getState().snapshot?.time ?? at) - at;

export function TitanEffects({ effects, zone = 'ember-meadow' }: { effects: readonly Effect[]; zone?: string }) {
  return <>{effects.map(effect => <group key={effect.id} position={[0, groundHeight(zone, effect.x, effect.z), 0]}><EffectView effect={effect} /></group>)}</>;
}

function EffectView({ effect }: { effect: Effect }) {
  switch (effect.kind) {
    case 'bolt': return <BoltEffect effect={effect} />;
    case 'strike': return <StrikeEffect effect={effect} color={classColor(effect.class)} />;
    case 'ability': return <RingEffect effect={effect} color={classColor(effect.class)} radius={effect.radius ?? CLASSES.warrior.ability.radius} span={0.55} />;
    case 'burst': return <RingEffect effect={effect} color="#ff5f43" radius={effect.radius ?? 5} span={0.5} flash />;
    case 'enemyhit': return <StrikeEffect effect={effect} color="#ff7a5e" />;
    case 'heal': return <RiseEffect effect={effect} color="#8fe6a6" />;
    case 'levelup': return <ColumnEffect effect={effect} />;
    case 'quest': return <SparkleEffect effect={effect} color="#ffd985" scale={1} />;
    case 'gather': return <SparkleEffect effect={effect} color="#ffe8ae" scale={0.55} />;
    case 'defeat': return <PuffEffect effect={effect} color="#c39ad2" scale={1} />;
    case 'bossdown': return <PuffEffect effect={effect} color="#ff9354" scale={2.6} />;
    case 'death': return <PuffEffect effect={effect} color="#9aa5a2" scale={1.6} />;
    default: return null;
  }
}

/** A shot travelling from the caster to the target, then fading out where it lands. */
function BoltEffect({ effect }: { effect: Effect }) {
  const bolt = useRef<THREE.Mesh>(null);
  const material = useRef<THREE.MeshBasicMaterial>(null);
  const travel = 0.24;
  const tx = effect.tx ?? effect.x; const tz = effect.tz ?? effect.z;
  useFrame(() => {
    const age = sinceEffect(effect.at);
    if (!bolt.current || !material.current) return;
    const t = progress(age, travel);
    bolt.current.position.set(effect.x + (tx - effect.x) * t, 1.05, effect.z + (tz - effect.z) * t);
    bolt.current.scale.setScalar(age < travel ? 0.17 : 0.17 + (age - travel) * 0.9);
    material.current.opacity = age < travel ? 1 : fade(age - travel, 0.2);
  });
  return <mesh ref={bolt} geometry={BALL} position={[effect.x, 1.05, effect.z]} scale={0.17}>
    <meshBasicMaterial ref={material} color={classColor(effect.class)} transparent toneMapped={false} />
  </mesh>;
}

/** A spark burst where a melee hit or an enemy blow landed. */
function StrikeEffect({ effect, color = '#ffe9b5' }: { effect: Effect; color?: string }) {
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    const age = sinceEffect(effect.at);
    if (!group.current) return;
    group.current.scale.setScalar(0.4 + progress(age, 0.3) * 1.5);
    setGroupOpacity(group.current, fade(age, 0.3));
  });
  return <group ref={group} position={[effect.tx ?? effect.x, 1, effect.tz ?? effect.z]} scale={0.4}>
    {SPOKES.map(angle => <mesh key={angle} geometry={SPARK} rotation={[0, angle, 0]} position={[Math.sin(angle) * 0.3, 0, Math.cos(angle) * 0.3]}>
      <meshBasicMaterial color={color} transparent toneMapped={false} depthWrite={false} />
    </mesh>)}
  </group>;
}

/** An expanding ground ring — class abilities and the boss's ember burst. */
function RingEffect({ effect, color, radius, span, flash = false }: { effect: Effect; color: string; radius: number; span: number; flash?: boolean }) {
  const ring = useRef<THREE.Mesh>(null);
  const material = useRef<THREE.MeshBasicMaterial>(null);
  const glow = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(() => {
    const age = sinceEffect(effect.at);
    if (!ring.current || !material.current) return;
    const t = progress(age, span);
    ring.current.scale.setScalar(Math.max(0.05, radius * (0.25 + t * 0.75)));
    material.current.opacity = fade(age, span) * 0.95;
    if (glow.current) glow.current.opacity = fade(age, span * 0.45) * 0.4;
  });
  return <group position={[effect.x, 0.06, effect.z]}>
    <mesh ref={ring} geometry={RING} rotation={[-Math.PI / 2, 0, 0]} scale={radius * 0.25}>
      <meshBasicMaterial ref={material} color={color} transparent side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
    </mesh>
    {flash && <mesh geometry={BALL} scale={radius * 0.75} position={[0, 0.7, 0]}>
      <meshBasicMaterial ref={glow} color={color} transparent opacity={0.4} depthWrite={false} toneMapped={false} />
    </mesh>}
  </group>;
}

/** Motes drifting upward — the tonic heal. */
function RiseEffect({ effect, color }: { effect: Effect; color: string }) {
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    const age = sinceEffect(effect.at);
    if (!group.current) return;
    group.current.position.y = 0.2 + progress(age, LIFETIME) * 1.9;
    group.current.rotation.y = age * 1.6;
    setGroupOpacity(group.current, fade(age, LIFETIME));
  });
  return <group ref={group} position={[effect.x, 0.2, effect.z]}>
    {SPOKES.map((angle, index) => <mesh key={angle} geometry={BALL} scale={0.09} position={[Math.sin(angle) * (0.28 + (index % 3) * 0.12), index * 0.16, Math.cos(angle) * (0.28 + (index % 3) * 0.12)]}>
      <meshBasicMaterial color={color} transparent toneMapped={false} depthWrite={false} />
    </mesh>)}
  </group>;
}

/** A column of light for a level-up. */
function ColumnEffect({ effect }: { effect: Effect }) {
  const column = useRef<THREE.Mesh>(null);
  const material = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(() => {
    const age = sinceEffect(effect.at);
    if (!column.current || !material.current) return;
    const t = progress(age, LIFETIME); const height = 5 + t * 3;
    column.current.scale.set(1.1 - t * 0.5, height, 1.1 - t * 0.5);
    column.current.position.y = height / 2;
    material.current.opacity = fade(age, LIFETIME) * 0.7;
  });
  return <group position={[effect.x, 0, effect.z]}>
    <mesh ref={column} geometry={COLUMN} position={[0, 2.5, 0]} scale={[1.1, 5, 1.1]}>
      <meshBasicMaterial ref={material} color="#ffdc8d" transparent side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
    </mesh>
    <pointLight color="#ffd27a" intensity={4} distance={9} />
  </group>;
}

/** Turning shards — a quest beat or a gathered node. */
function SparkleEffect({ effect, color, scale }: { effect: Effect; color: string; scale: number }) {
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    const age = sinceEffect(effect.at);
    if (!group.current) return;
    group.current.rotation.y = age * 3.4;
    group.current.position.y = 0.8 + progress(age, LIFETIME) * 0.9;
    setGroupOpacity(group.current, fade(age, LIFETIME));
  });
  return <group ref={group} position={[effect.x, 0.8, effect.z]}>
    {SPOKES.map((angle, index) => <mesh key={angle} geometry={SHARD} scale={scale * (0.1 + (index % 2) * 0.05)} position={[Math.sin(angle) * scale * 0.5, (index % 3) * 0.2, Math.cos(angle) * scale * 0.5]}>
      <meshBasicMaterial color={color} transparent toneMapped={false} depthWrite={false} />
    </mesh>)}
  </group>;
}

/** A soft cloud that swells and fades — defeats and deaths. */
function PuffEffect({ effect, color, scale }: { effect: Effect; color: string; scale: number }) {
  const puff = useRef<THREE.Mesh>(null);
  const material = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(() => {
    const age = sinceEffect(effect.at);
    if (!puff.current || !material.current) return;
    const t = progress(age, LIFETIME);
    puff.current.scale.setScalar(scale * (0.35 + t * 0.9));
    puff.current.position.y = 0.8 + t * 0.7;
    material.current.opacity = fade(age, LIFETIME) * 0.55;
  });
  return <mesh ref={puff} geometry={BALL} position={[effect.x, 0.8, effect.z]} scale={scale * 0.35}>
    <meshBasicMaterial ref={material} color={color} transparent depthWrite={false} toneMapped={false} />
  </mesh>;
}
