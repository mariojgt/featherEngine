import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, useGLTF } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import {
  CLASSES, ENEMIES, ITEMS, QUESTS,
  type ClassId, type Enemy, type EnemyKind, type GatherableDef, type Hero, type NpcDef, type PortalDef, type QuestId, type ZoneId,
  ZONES,
} from '../../examples/titan-mmo/server/world.mjs';
import { useRealm } from './session';

/** The one animated character mesh the whole realm reuses, driven by a named clip per actor state. */
export interface AvatarPose { name: string; loop: boolean; nonce: number }
/** Clip names that exist in UAL1.glb, each with graceful fallbacks for a swapped-in character. */
const CLIP_FALLBACKS: Record<string, string[]> = {
  Idle_Loop: ['Idle_Loop', 'Idle'],
  Idle_Talking_Loop: ['Idle_Talking_Loop', 'Idle_Loop', 'Idle'],
  Jog_Fwd_Loop: ['Jog_Fwd_Loop', 'Walk_Fwd_Loop', 'Sprint_Loop', 'Walk'],
  Sword_Attack: ['Sword_Attack', 'Sword_Attack_Standing'],
  Sword_Attack_Standing: ['Sword_Attack_Standing', 'Sword_Attack'],
  Spell_Simple_Shoot: ['Spell_Simple_Shoot', 'Spell_Double_Shoot_Loop', 'Sword_Attack_Standing'],
  Spell_Double_Shoot_Loop: ['Spell_Double_Shoot_Loop', 'Spell_Simple_Shoot', 'Sword_Attack'],
  Spell_Double_Enter: ['Spell_Double_Enter', 'Spell_Double_Shoot_Loop', 'Spell_Simple_Shoot'],
  Hit_Chest: ['Hit_Chest', 'Hit', 'Idle_Loop'],
  Drink: ['Drink', 'Interact', 'Idle_Loop'],
};
/** The basic attack, the ability clip, and how long that ability clip reads on screen. */
const BASIC_CLIP: Record<ClassId, string> = { warrior: 'Sword_Attack_Standing', ranger: 'Spell_Simple_Shoot', mage: 'Spell_Simple_Shoot' };
const ABILITY_CLIP: Record<ClassId, string> = { warrior: 'Sword_Attack', ranger: 'Spell_Double_Enter', mage: 'Spell_Double_Shoot_Loop' };
const ABILITY_LENGTH: Record<ClassId, number> = { warrior: 0.9, ranger: 0.8, mage: 0.8 };
export const IDLE_POSE: AvatarPose = { name: 'Idle_Loop', loop: true, nonce: 0 };
export const TALKING_POSE: AvatarPose = { name: 'Idle_Talking_Loop', loop: true, nonce: 0 };
const MOVE_EPSILON = 0.015;
const FOLLOW_LAG = 16;

function resolveClip(animations: readonly THREE.AnimationClip[], name: string) {
  for (const candidate of CLIP_FALLBACKS[name] ?? [name]) {
    const lower = candidate.toLowerCase();
    const found = animations.find(clip => clip.name.toLowerCase() === lower) ?? animations.find(clip => clip.name.toLowerCase().startsWith(lower));
    if (found) return found;
  }
  return animations[0];
}

export function Avatar({ url, pose, height = 1.8, override }: { url: string; pose: AvatarPose; height?: number; override?: THREE.Material }) {
  const model = useGLTF(url);
  const clone = useMemo(() => SkeletonUtils.clone(model.scene), [model.scene]);
  const mixer = useMemo(() => new THREE.AnimationMixer(clone), [clone]);
  const size = useMemo(() => { const box = new THREE.Box3().setFromObject(clone); return { scale: height / Math.max(0.1, box.max.y - box.min.y), minY: box.min.y }; }, [clone, height]);
  useEffect(() => {
    if (!override) return;
    clone.traverse(child => { if ((child as THREE.Mesh).isMesh) (child as THREE.Mesh).material = override; });
  }, [clone, override]);
  useEffect(() => {
    const clip = resolveClip(model.animations, pose.name);
    if (!clip) return;
    const action = mixer.clipAction(clip);
    action.reset();
    if (!pose.loop) { action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; }
    action.fadeIn(0.12).play();
    return () => { action.fadeOut(0.12); };
    // `nonce` restarts a one-shot when the same action fires twice in a row.
  }, [mixer, model.animations, pose.name, pose.loop, pose.nonce]);
  useEffect(() => () => { mixer.stopAllAction(); mixer.uncacheRoot(clone); }, [clone, mixer]);
  useFrame((_, dt) => mixer.update(Math.min(dt, 0.1)));
  return <group scale={size.scale}><primitive object={clone} position={[0, -size.minY, 0]} /></group>;
}

function BundledBlade({ url }: { url: string }) {
  const model = useGLTF(url);
  const normalized = useMemo(() => {
    const clone = model.scene.clone(true); const box = new THREE.Box3().setFromObject(clone);
    const size = box.getSize(new THREE.Vector3()); const center = box.getCenter(new THREE.Vector3());
    const axis = size.x > size.y && size.x > size.z ? new THREE.Vector3(1, 0, 0) : size.z > size.y ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    return { clone, center: center.negate(), scale: 1.1 / Math.max(0.1, size.x, size.y, size.z), rotation: new THREE.Quaternion().setFromUnitVectors(axis, new THREE.Vector3(0, 1, 0)) };
  }, [model.scene]);
  return <group position={[0, 0.4, 0]} scale={normalized.scale} quaternion={normalized.rotation}><primitive object={normalized.clone} position={normalized.center} /></group>;
}

/** Each class carries its own silhouette: the bundled blade, a lit staff, or a short bow. */
function ClassWeapon({ hero, swordUrl }: { hero: Hero; swordUrl?: string }) {
  if (hero.class === 'mage') return <group>
    <mesh position={[0, 0.45, 0]}><cylinderGeometry args={[0.035, 0.045, 1.5, 6]} /><meshStandardMaterial color="#6d5236" roughness={0.85} /></mesh>
    <mesh position={[0, 1.24, 0]}><icosahedronGeometry args={[0.13, 0]} /><meshStandardMaterial color="#ffd7a1" emissive="#ff8b34" emissiveIntensity={2.4} /></mesh>
    <pointLight position={[0, 1.24, 0]} color="#ff9f52" intensity={2.2} distance={4} />
  </group>;
  if (hero.class === 'ranger') return <group rotation={[0, 0, 0.25]}>
    <mesh rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.42, 0.028, 6, 18, Math.PI * 1.25]} /><meshStandardMaterial color="#7e5f3c" roughness={0.8} /></mesh>
    <mesh position={[0, 0, 0]}><boxGeometry args={[0.012, 0.78, 0.012]} /><meshStandardMaterial color="#e8e2cd" /></mesh>
  </group>;
  return swordUrl
    ? <Suspense fallback={null}><BundledBlade url={swordUrl} /></Suspense>
    : <mesh position={[0, 0.3, 0]}><boxGeometry args={[0.07, 0.9, 0.06]} /><meshStandardMaterial color="#d7d8c4" metalness={0.65} roughness={0.3} /></mesh>;
}

export function HeroView({ hero, local, time, url, swordUrl, healAt }: { hero: Hero; local: boolean; time: number; url?: string; swordUrl?: string; healAt: number }) {
  const group = useRef<THREE.Group>(null);
  const blade = useRef<THREE.Group>(null);
  const last = useRef({ x: hero.x, z: hero.z });
  const target = useMemo(() => new THREE.Vector3(hero.x, 0.02, hero.z), []);
  const moving = Math.hypot(hero.x - last.current.x, hero.z - last.current.z) > MOVE_EPSILON;
  useEffect(() => { last.current = { x: hero.x, z: hero.z }; }, [hero.x, hero.z]);
  const cls = CLASSES[hero.class];
  const sinceHurt = time - hero.hurtAt;
  const sinceAbility = time - hero.abilityAt;
  const sinceAttack = time - hero.attackAt;
  const sinceHeal = time - healAt;
  const pose: AvatarPose =
    sinceHurt >= 0 && sinceHurt < 0.45 ? { name: 'Hit_Chest', loop: false, nonce: hero.hurtAt }
    : sinceAbility >= 0 && sinceAbility < ABILITY_LENGTH[hero.class] ? { name: ABILITY_CLIP[hero.class], loop: false, nonce: hero.abilityAt }
    : sinceAttack >= 0 && sinceAttack < 0.5 ? { name: BASIC_CLIP[hero.class], loop: false, nonce: hero.attackAt }
    : sinceHeal >= 0 && sinceHeal < 0.9 ? { name: 'Drink', loop: false, nonce: healAt }
    : { name: moving ? 'Jog_Fwd_Loop' : 'Idle_Loop', loop: true, nonce: 0 };
  useFrame((_, dt) => {
    if (!group.current) return;
    group.current.position.lerp(target.set(hero.x, 0.02, hero.z), 1 - Math.exp(-Math.min(dt, 0.1) * FOLLOW_LAG));
    group.current.rotation.y = hero.yaw;
    const live = useRealm.getState().snapshot?.time ?? time;
    if (blade.current) blade.current.rotation.x = live - hero.attackAt < 0.35 ? -1.5 + Math.sin((live - hero.attackAt) * 10) * 1.5 : -0.3;
  });
  const glow = hero.equipped.weapon === 'warden-blade' ? '#a9e3ff' : hero.equipped.weapon === 'ashen-greatblade' ? '#ff9a5b' : undefined;
  return <group ref={group} position={[hero.x, 0.02, hero.z]}>
    {url
      ? <Suspense fallback={<mesh position={[0, 0.9, 0]}><capsuleGeometry args={[0.28, 1, 5, 8]} /><meshStandardMaterial color={local ? '#dbbb68' : '#79bcbd'} /></mesh>}><Avatar url={url} pose={pose} /></Suspense>
      : <mesh position={[0, 0.9, 0]}><capsuleGeometry args={[0.28, 1, 5, 8]} /><meshStandardMaterial color={local ? '#dbbb68' : '#79bcbd'} /></mesh>}
    <group ref={blade} position={[0.38, 0.8, 0.15]}>
      <ClassWeapon hero={hero} swordUrl={swordUrl} />
      {glow && <pointLight color={glow} intensity={1.2} distance={2} />}
    </group>
    <Html position={[0, 2.25, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
      <div className={`titan-label${local ? ' titan-label-self' : ''}`}>{hero.name}<small>Level {hero.level} · {cls.name}</small></div>
    </Html>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]}><ringGeometry args={[0.38, 0.43, 28]} /><meshBasicMaterial color={local ? '#f6d57b' : '#7bd6d9'} transparent opacity={0.7} /></mesh>
  </group>;
}

/** Quest state as WoW reads it: ! to take, ? to hand in, grey while the work is unfinished. */
function npcMarker(npc: NpcDef, hero: Hero | undefined): { glyph: string; ready: boolean; hint: string } | null {
  if (npc.role === 'vendor') return { glyph: '◈', ready: true, hint: 'E · Shop' };
  const questId = npc.quest as QuestId | undefined;
  if (!questId || !hero) return null;
  const quest = QUESTS[questId];
  const entry = hero.quests[questId];
  if (!entry) return hero.level >= quest.level
    ? { glyph: '!', ready: true, hint: 'E · Speak' }
    : { glyph: '!', ready: false, hint: `Level ${quest.level}` };
  if (entry.state === 'complete') return null;
  const done = quest.objectives.every((objective, index) => entry.progress[index] >= objective.count);
  return { glyph: '?', ready: done, hint: done ? 'E · Turn in' : 'E · Speak' };
}

export function NpcView({ npc, hero, url }: { npc: NpcDef; hero: Hero | undefined; url?: string }) {
  const marker = npcMarker(npc, hero);
  return <group position={[npc.x, 0, npc.z]}>
    {url
      ? <Suspense fallback={<mesh position={[0, 0.8, 0]}><capsuleGeometry args={[0.3, 1, 6, 10]} /><meshStandardMaterial color="#7d9870" roughness={0.8} /></mesh>}>
          <Avatar url={url} pose={npc.role === 'vendor' ? IDLE_POSE : TALKING_POSE} />
        </Suspense>
      : <><mesh position={[0, 0.8, 0]}><capsuleGeometry args={[0.3, 1, 6, 10]} /><meshStandardMaterial color="#7d9870" roughness={0.8} /></mesh>
        <mesh position={[0, 1.7, 0]}><sphereGeometry args={[0.22, 12, 8]} /><meshStandardMaterial color="#e3b983" /></mesh></>}
    {marker && <Html position={[0, 2.85, 0]} center zIndexRange={[11, 0]} style={{ pointerEvents: 'none' }}>
      <div className={`titan-marker${marker.ready ? '' : ' titan-marker-dim'}`}>{marker.glyph}</div>
    </Html>}
    <Html position={[0, 2.3, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
      <div className="titan-label">{npc.name}<small>{npc.title}</small>{marker && <small className="titan-label-hint">{marker.hint}</small>}</div>
    </Html>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]}><ringGeometry args={[0.4, 0.45, 24]} /><meshBasicMaterial color="#cbe0b6" transparent opacity={0.45} /></mesh>
  </group>;
}

export function GatherableView({ node }: { node: GatherableDef }) {
  const spin = useRef<THREE.Group>(null);
  useFrame((_, dt) => { if (spin.current) spin.current.rotation.y += dt * 0.8; });
  const petal = node.item === 'moonpetal';
  return <group position={[node.x, petal ? 0.35 : 0.9, node.z]}>
    <group ref={spin}>
      {petal
        ? <>
          <mesh><sphereGeometry args={[0.12, 10, 8]} /><meshStandardMaterial color="#e9f3ff" emissive="#7fb6ff" emissiveIntensity={1.6} /></mesh>
          {[0, 1, 2, 3, 4].map(i => <mesh key={i} position={[Math.sin(i * 1.26) * 0.22, 0.02, Math.cos(i * 1.26) * 0.22]} rotation={[0.7, i * 1.26, 0]}>
            <sphereGeometry args={[0.13, 8, 6]} /><meshStandardMaterial color="#cfe4ff" emissive="#5f9de0" emissiveIntensity={0.9} roughness={0.5} />
          </mesh>)}
          <mesh position={[0, -0.24, 0]}><cylinderGeometry args={[0.02, 0.025, 0.5, 5]} /><meshStandardMaterial color="#5f7a54" /></mesh>
        </>
        : <mesh rotation={[0, Math.PI / 4, 0.2]} castShadow><octahedronGeometry args={[0.5, 0]} /><meshStandardMaterial color="#ffe08b" emissive="#edae37" emissiveIntensity={1.2} metalness={0.3} roughness={0.25} /></mesh>}
    </group>
    <pointLight color={petal ? '#8ec3ff' : '#edc358'} intensity={petal ? 1.4 : 2} distance={petal ? 2.4 : 3} />
    <Html position={[0, petal ? 0.9 : 1, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
      <div className="titan-label">{ITEMS[node.item].name}<small>E · Gather</small></div>
    </Html>
  </group>;
}

export function WaystoneView({ portal, hero }: { portal: PortalDef; hero: Hero | undefined }) {
  const ring = useRef<THREE.Mesh>(null);
  const target = ZONES[portal.to as ZoneId];
  const locked = !hero || hero.level < target.level;
  useFrame((_, dt) => { if (ring.current) ring.current.rotation.z += dt * (locked ? 0.2 : 0.7); });
  return <group position={[portal.x, 0, portal.z]}>
    <mesh position={[0, 1.4, 0]} castShadow><boxGeometry args={[1.1, 2.8, 0.5]} /><meshStandardMaterial color="#8b9187" roughness={0.9} /></mesh>
    <mesh position={[0, 0.12, 0]}><boxGeometry args={[1.7, 0.25, 1.2]} /><meshStandardMaterial color="#767d74" roughness={0.95} /></mesh>
    <mesh ref={ring} position={[0, 1.75, 0.31]}><torusGeometry args={[0.42, 0.06, 8, 26]} />
      <meshStandardMaterial color={locked ? '#7f8a86' : '#ffdf9d'} emissive={locked ? '#33403c' : '#e4a63f'} emissiveIntensity={locked ? 0.3 : 2.1} />
    </mesh>
    {!locked && <pointLight position={[0, 1.75, 0.6]} color="#f2c473" intensity={2.4} distance={5} />}
    <Html position={[0, 3.3, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
      <div className={`titan-label${locked ? ' titan-locked' : ''}`}>{portal.name}<small>{locked ? `Level ${target.level}` : `E · Travel to ${target.name}`}</small></div>
    </Html>
  </group>;
}

const ENEMY_TINT: Record<EnemyKind, { color: string; emissive: string }> = {
  wisp: { color: '#bf76c6', emissive: '#70376f' },
  'briar-wisp': { color: '#7fc07a', emissive: '#2f6b40' },
  'cinder-wisp': { color: '#e58a4c', emissive: '#8c3418' },
  boar: { color: '#8a6a4e', emissive: '#2c1d12' },
  boss: { color: '#3a3330', emissive: '#ff5a1e' },
};

export function EnemyView({ enemy, time, url }: { enemy: Enemy; time: number; url?: string }) {
  const group = useRef<THREE.Group>(null);
  const telegraph = useRef<THREE.Mesh>(null);
  const target = useMemo(() => new THREE.Vector3(enemy.x, 0, enemy.z), []);
  const kind = ENEMIES[enemy.kind];
  const tint = ENEMY_TINT[enemy.kind];
  const hit = time - enemy.hitAt < 0.2;
  useFrame((_, dt) => {
    if (!group.current) return;
    group.current.position.lerp(target.set(enemy.x, 0, enemy.z), 1 - Math.exp(-Math.min(dt, 0.1) * 12));
    group.current.rotation.y = enemy.yaw;
    if (!telegraph.current) return;
    const live = useRealm.getState().snapshot?.time ?? time;
    const burst = kind.burst;
    if (!burst || enemy.burstAt <= 0) { telegraph.current.visible = false; return; }
    telegraph.current.visible = true;
    const grown = Math.max(0, Math.min(1, 1 - (enemy.burstAt - live) / burst.telegraph));
    telegraph.current.scale.setScalar(Math.max(0.05, burst.radius * grown));
  });
  return <group ref={group} position={[enemy.x, 0, enemy.z]}>
    {enemy.boss
      ? <BossBody enemy={enemy} url={url} hit={hit} time={time} />
      : enemy.kind === 'boar' ? <BoarBody tint={tint} hit={hit} /> : <WispBody tint={tint} hit={hit} />}
    {kind.burst && <mesh ref={telegraph} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]} visible={false}>
      <ringGeometry args={[0.82, 1, 44]} /><meshBasicMaterial color="#ff4a32" transparent opacity={0.55} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>}
    <Html position={[0, enemy.boss ? 4.7 : enemy.kind === 'boar' ? 1.5 : 1.9, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
      <div className={`titan-label${enemy.boss ? ' titan-label-boss' : ''}`}>{enemy.name}
        <div className="titan-enemy-health"><i style={{ width: `${Math.max(0, (enemy.health / enemy.maxHealth) * 100)}%` }} /></div>
      </div>
    </Html>
  </group>;
}

function WispBody({ tint, hit }: { tint: { color: string; emissive: string }; hit: boolean }) {
  return <group position={[0, 0.8, 0]}>
    <mesh castShadow><icosahedronGeometry args={[0.55, 1]} /><meshStandardMaterial color={tint.color} emissive={tint.emissive} emissiveIntensity={hit ? 3 : 0.3} roughness={0.5} /></mesh>
    <mesh rotation={[Math.PI / 2.8, 0.2, 0]}><torusGeometry args={[0.65, 0.025, 6, 24]} /><meshStandardMaterial color={tint.color} emissive={tint.emissive} emissiveIntensity={0.7} /></mesh>
  </group>;
}

function BoarBody({ tint, hit }: { tint: { color: string; emissive: string }; hit: boolean }) {
  return <group position={[0, 0.5, 0]}>
    <mesh rotation={[Math.PI / 2, 0, 0]} castShadow><capsuleGeometry args={[0.42, 0.85, 5, 10]} /><meshStandardMaterial color={tint.color} emissive={tint.emissive} emissiveIntensity={hit ? 2.4 : 0.1} roughness={0.85} /></mesh>
    <mesh position={[0, -0.05, 0.78]} rotation={[Math.PI / 2, 0, 0]}><coneGeometry args={[0.24, 0.5, 8]} /><meshStandardMaterial color="#6f5340" roughness={0.9} /></mesh>
    {[-0.16, 0.16].map(x => <mesh key={x} position={[x, 0.02, 0.95]} rotation={[-0.9, 0, 0]}><coneGeometry args={[0.045, 0.28, 5]} /><meshStandardMaterial color="#e8e0cb" /></mesh>)}
    {[[-0.26, 0.4], [0.26, 0.4], [-0.26, -0.4], [0.26, -0.4]].map(([x, z]) => <mesh key={`${x},${z}`} position={[x, -0.4, z]}><cylinderGeometry args={[0.09, 0.08, 0.5, 6]} /><meshStandardMaterial color="#5f4632" /></mesh>)}
  </group>;
}

function BossBody({ enemy, url, hit, time }: { enemy: Enemy; url?: string; hit: boolean; time: number }) {
  const override = useMemo(() => new THREE.MeshStandardMaterial({ color: '#332c29', emissive: '#ff5a1e', emissiveIntensity: 0.55, roughness: 0.75, metalness: 0.15 }), []);
  useEffect(() => () => override.dispose(), [override]);
  useEffect(() => { override.emissiveIntensity = hit ? 2.4 : 0.55; }, [override, hit]);
  const attacking = time - enemy.attackAt < 0.9;
  const pose: AvatarPose = attacking ? { name: 'Sword_Attack', loop: false, nonce: enemy.attackAt } : IDLE_POSE;
  if (!url) return <mesh position={[0, 2, 0]} castShadow><capsuleGeometry args={[0.8, 2.4, 6, 12]} /><meshStandardMaterial color="#332c29" emissive="#ff5a1e" emissiveIntensity={hit ? 2.4 : 0.55} /></mesh>;
  return <Suspense fallback={<mesh position={[0, 2, 0]}><capsuleGeometry args={[0.8, 2.4, 6, 12]} /><meshStandardMaterial color="#332c29" /></mesh>}>
    <Avatar url={url} pose={pose} height={1.8 * 2.3} override={override} />
    <pointLight position={[0, 2.4, 0]} color="#ff6a2a" intensity={2.6} distance={7} />
  </Suspense>;
}
