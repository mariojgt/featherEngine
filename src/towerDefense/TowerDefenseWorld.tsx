import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Html } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import { towerStats } from './game';
import { Defender, DEFENDER_COLORS, Zombie, ZombieModel } from './actors';
import { gardenMatrix, gardenSeed } from './settings';
import { choosePlot, closeGardenAudio, openGarden, tickGarden, useGarden } from './session';

/** Mounted at the same camera-priority slot in the editor and exported player. */
export function TowerDefenseWorld() {
  const sceneId = useEditorStore(s => s.activeSceneId);
  return <GardenWorld key={sceneId} />;
}

function GardenWorld() {
  const seed = gardenSeed(selectActiveObjects(useEditorStore.getState()));
  const [rootMatrix] = useState(() => gardenMatrix(selectActiveObjects(useEditorStore.getState())));
  const [cameraTarget] = useState(() => new THREE.Vector3(0, -0.5, 0).applyMatrix4(rootMatrix));
  const [cameraUp] = useState(() => new THREE.Vector3(0, 1, 0).transformDirection(rootMatrix));
  const session = useGarden();
  const camera = useThree(s => s.camera);
  const size = useThree(s => s.size);
  useLayoutEffect(() => { openGarden(seed); return closeGardenAudio; }, [seed]);
  useEffect(() => {
    const p = camera.position.clone(), q = camera.quaternion.clone(), up = camera.up.clone();
    const perspective = camera as THREE.PerspectiveCamera;
    const fov = perspective.fov;
    return () => { camera.position.copy(p); camera.quaternion.copy(q); camera.up.copy(up); if (perspective.isPerspectiveCamera) { perspective.fov = fov; perspective.updateProjectionMatrix(); } };
  }, [camera]);
  useFrame((_, dt) => {
    const s = useEditorStore.getState();
    if (!s.isPlayPaused && !document.hidden) tickGarden(dt * s.runtimeTimeScale);
    const perspective = camera as THREE.PerspectiveCamera;
    const aspect = size.width / Math.max(size.height, 1);
    // Turn the long axis of the garden up the screen on phones, instead of shrinking a landscape
    // board into a tiny strip. Keep the entire route visible above the bottom build controls.
    const portrait = aspect < 0.9;
    const fit = portrait ? Math.max(1, 0.86 / aspect) : Math.max(1, 1.35 / aspect);
    camera.position.set((portrait ? 31 : 9) * fit, (portrait ? 33 : 31) * fit, (portrait ? 6 : 29) * fit).applyMatrix4(rootMatrix);
    camera.up.copy(cameraUp);
    camera.lookAt(cameraTarget);
    if (perspective.isPerspectiveCamera && perspective.fov !== 43) { perspective.fov = 43; perspective.updateProjectionMatrix(); }
  });
  const { game, selectedPlot, selectedKind, started, paused } = session;
  const selected = game.towers.find(t => t.plotId === selectedPlot);
  const rangePlot = game.map.plots.find(p => p.id === selectedPlot);
  const range = selected ? towerStats(selected.kind, selected.level).range : towerStats(selectedKind, 1).range;
  return <group matrix={rootMatrix} matrixAutoUpdate={false}>
    {game.map.plots.map(plot => {
      const tower = game.towers.find(t => t.plotId === plot.id);
      const isSelected = selectedPlot === plot.id;
      return <group key={plot.id} position={[plot.x, 0.26, plot.z]}>
        <mesh receiveShadow onClick={event => { event.stopPropagation(); choosePlot(plot.id); }}><cylinderGeometry args={[0.8, 0.88, 0.19, 32]} /><meshStandardMaterial color={isSelected ? '#ffd582' : '#e3d9ad'} roughness={0.9} /></mesh>
        <mesh position={[0, 0.105, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.64, 0.69, 32]} /><meshBasicMaterial color={isSelected ? '#fffbe3' : '#b8a67f'} /></mesh>
        {started && !paused && !['won', 'lost'].includes(game.phase) && <Html center position={[0, tower ? 2.25 : 0.22, 0]} zIndexRange={[25, 15]}><button className={`sw-pad ${tower ? 'sw-pad-built' : ''} ${isSelected ? 'sw-pad-selected' : ''}`} aria-label={`${tower ? 'Select defender on' : 'Build on'} pad ${plot.id}`} onClick={() => choosePlot(plot.id)}>{tower ? '↑' : '+'}<span>{plot.id}</span></button></Html>}
      </group>;
    })}
    {rangePlot && started && <mesh position={[rangePlot.x, 0.25, rangePlot.z]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[range - 0.035, range + 0.035, 80]} /><meshBasicMaterial color={DEFENDER_COLORS[selected?.kind ?? selectedKind]} transparent opacity={0.65} depthWrite={false} /></mesh>}
    {game.towers.map(tower => <Defender key={tower.plotId} tower={tower} />)}
    {game.enemies.map(enemy => <Zombie key={enemy.id} enemy={enemy} />)}
    {game.shots.map(shot => <Shot key={shot.id} shot={shot} />)}
    {game.effects.map(effect => <mesh key={effect.id} position={[effect.x, 0.45 + (0.6 - Math.min(effect.life, 0.6)), effect.z]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.2, 0.45, 12]} /><meshBasicMaterial color={effect.kind === 'leak' ? '#e47e82' : '#fff0ba'} transparent opacity={Math.min(1, effect.life * 2)} depthWrite={false} /></mesh>)}
    {!started && <group position={[game.map.path[0].x + 1, 0.25, game.map.path[0].z]} rotation={[0, 0.8, 0]}><ZombieModel kind="shambler" walking={false} /><group position={[-1, 0, 1.6]}><ZombieModel kind="runner" walking={false} /></group></group>}
    <Html center position={[game.map.path[0].x, 3, game.map.path[0].z]} zIndexRange={[10, 1]} style={{ pointerEvents: 'none' }}><span className="sw-world-label sw-entry">SLEEPY HOLLOW</span></Html>
    <Html center position={[game.map.path[game.map.path.length - 1].x, 4.5, game.map.path[game.map.path.length - 1].z]} zIndexRange={[10, 1]} style={{ pointerEvents: 'none' }}><span className="sw-world-label">GARDEN HQ ♥</span></Html>
  </group>;
}

function Shot({ shot }: { shot: ReturnType<typeof useGarden.getState>['game']['shots'][number] }) {
  const mesh = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const duration = shot.kind === 'cannon' ? 0.3 : 0.16;
    const t = Math.max(0, Math.min(1, 1 - shot.life / duration));
    if (mesh.current) mesh.current.position.set(THREE.MathUtils.lerp(shot.x, shot.tx, t), 1.35 - t * 0.45 + (shot.kind === 'cannon' ? Math.sin(t * Math.PI) * 2 : 0), THREE.MathUtils.lerp(shot.z, shot.tz, t));
  });
  return <mesh ref={mesh} position={[shot.x, 1.2, shot.z]}><sphereGeometry args={[shot.kind === 'cannon' ? 0.24 : 0.12, 8, 8]} /><meshBasicMaterial color={DEFENDER_COLORS[shot.kind]} /></mesh>;
}
