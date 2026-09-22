import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { ZONES, type ZoneDef } from '../../examples/titan-mmo/server/world.mjs';
import { useEditorStore } from '../store/editorStore';
import { CinematicCamera } from '../three/CinematicCamera';
import { useAssetUrl } from '../three/ModelAsset';
import { useTitanActive } from './TitanHUD';
import { EnemyView, GatherableView, HeroView, NpcView, WaystoneView } from './runtimeActors';
import { setTitanCameraYaw } from './runtimeCamera';
import { TitanEffects } from './runtimeEffects';
import { useRealm } from './session';

/** Third-person orbit limits, in metres and radians. */
const MIN_DISTANCE = 3.5;
const MAX_DISTANCE = 14;
const DEFAULT_DISTANCE = 8;
const MIN_PITCH = -0.1;
const MAX_PITCH = 1.15;
const EYE_HEIGHT = 1.35;
/** The login vista: a slow ring around the zone's sanctuary. */
const LOGIN_RADIUS = 11;
const LOGIN_HEIGHT = 6;
const LOGIN_EYE_HEIGHT = 2.2;

export function TitanWorld() {
  const active = useTitanActive();
  return active ? <RealmActors /> : null;
}

function RealmActors() {
  const snapshot = useRealm(s => s.snapshot);
  const cinematic = useEditorStore(s => Boolean(s.runtimeCinematic));
  const assetId = useEditorStore(s => s.assets.find(a => a.name === 'UAL1.glb')?.id);
  const url = useAssetUrl(assetId);
  const swordId = useEditorStore(s => s.assets.find(a => a.name === 'Sword.glb')?.id);
  const swordUrl = useAssetUrl(swordId);
  const zone: ZoneDef = ZONES[snapshot?.zone ?? 'ember-meadow'];
  const hero = snapshot?.players.find(p => p.id === snapshot.selfId);
  const heals = useMemo(() => snapshot?.effects.filter(effect => effect.kind === 'heal') ?? [], [snapshot?.effects]);
  return <>
    {/* An authored sweep owns the camera outright; ours resumes behind the hero when it ends. */}
    {cinematic ? <CinematicCamera /> : <RealmCamera zone={zone} />}
    {zone.npcs.map(npc => <NpcView key={npc.id} npc={npc} hero={hero} url={url} />)}
    {zone.gatherables.filter(node => !hero?.gathered.includes(node.id)).map(node => <GatherableView key={node.id} node={node} />)}
    {zone.portals.map(portal => <WaystoneView key={portal.id} portal={portal} hero={hero} />)}
    {snapshot?.enemies.filter(enemy => enemy.health > 0).map(enemy => <EnemyView key={enemy.id} enemy={enemy} time={snapshot.time} url={url} />)}
    {snapshot?.players.map(player => <HeroView key={player.id} hero={player} local={player.id === snapshot.selfId} time={snapshot.time}
      url={url} swordUrl={swordUrl} healAt={heals.find(effect => Math.hypot(effect.x - player.x, effect.z - player.z) < 1.5)?.at ?? -100} />)}
    {snapshot && <TitanEffects effects={snapshot.effects} />}
  </>;
}

/**
 * A WoW-style follow camera: right- (or middle-) drag orbits, the wheel zooms, and the rig trails the
 * hero with exponential lag. Before a character exists the same rig drifts slowly around the zone's
 * sanctuary so the login screen has a living backdrop.
 */
function RealmCamera({ zone }: { zone: ZoneDef }) {
  const gl = useThree(state => state.gl);
  const rig = useRef({ yaw: 0, pitch: 0.42, distance: DEFAULT_DISTANCE, idle: 0, dragging: -1, seeded: false });
  const focus = useRef(new THREE.Vector3(zone.sanctuary.x, EYE_HEIGHT, zone.sanctuary.z));
  const scratch = useMemo(() => new THREE.Vector3(), []);
  // Re-seed behind the hero whenever the zone changes; the old orbit belongs to another map.
  useEffect(() => {
    rig.current.seeded = false;
    focus.current.set(zone.sanctuary.x, EYE_HEIGHT, zone.sanctuary.z);
  }, [zone]);

  useEffect(() => {
    const el = gl.domElement;
    const state = rig.current;
    const onContextMenu = (event: MouseEvent) => event.preventDefault();
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 2 && event.button !== 1) return;
      event.preventDefault();
      state.dragging = event.pointerId;
      el.setPointerCapture?.(event.pointerId);
      el.style.cursor = 'grabbing';
    };
    const endDrag = (event: PointerEvent) => {
      if (state.dragging !== event.pointerId) return;
      state.dragging = -1;
      if (el.hasPointerCapture?.(event.pointerId)) el.releasePointerCapture(event.pointerId);
      el.style.cursor = '';
    };
    const onPointerMove = (event: PointerEvent) => {
      if (state.dragging !== event.pointerId) return;
      state.yaw -= (event.movementX ?? 0) * 0.005;
      state.pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, state.pitch + (event.movementY ?? 0) * 0.004));
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      state.distance = Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, state.distance + event.deltaY * 0.01));
    };
    el.addEventListener('contextmenu', onContextMenu);
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      state.dragging = -1;
      el.style.cursor = '';
      el.removeEventListener('contextmenu', onContextMenu);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', endDrag);
      el.removeEventListener('pointercancel', endDrag);
      el.removeEventListener('wheel', onWheel);
    };
  }, [gl]);

  useFrame(({ camera }, delta) => {
    const dt = Math.min(delta, 0.1);
    const state = rig.current;
    const live = useRealm.getState().snapshot;
    const player = live?.players.find(p => p.id === live.selfId);
    if (!player) {
      // Login vista: a slow orbit of the sanctuary on its own angle. The follow yaw is deliberately
      // left alone here — the HUD turns WASD with it, and a drifting vista must never steer a hero.
      state.seeded = false;
      state.idle += dt * 0.08;
      focus.current.set(zone.sanctuary.x, LOGIN_EYE_HEIGHT, zone.sanctuary.z);
      camera.position.set(focus.current.x + Math.sin(state.idle) * LOGIN_RADIUS, focus.current.y + LOGIN_HEIGHT, focus.current.z + Math.cos(state.idle) * LOGIN_RADIUS);
      camera.lookAt(focus.current);
      return;
    }
    if (!state.seeded) { state.yaw = player.yaw + Math.PI; state.seeded = true; focus.current.set(player.x, EYE_HEIGHT, player.z); }
    focus.current.lerp(scratch.set(player.x, EYE_HEIGHT, player.z), 1 - Math.exp(-dt * 10));
    const flat = Math.cos(state.pitch) * state.distance;
    camera.position.set(focus.current.x + Math.sin(state.yaw) * flat, focus.current.y + Math.sin(state.pitch) * state.distance, focus.current.z + Math.cos(state.yaw) * flat);
    camera.lookAt(scratch.set(focus.current.x, focus.current.y + 0.45, focus.current.z));
    setTitanCameraYaw(state.yaw);
  });
  return null;
}
