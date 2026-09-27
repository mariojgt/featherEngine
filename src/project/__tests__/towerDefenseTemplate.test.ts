import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { selectActiveObjects, useEditorStore } from '../../store/editorStore';
import { createGame } from '../../towerDefense/game';
import { gardenController, gardenMatrix, gardenSeed } from '../../towerDefense/settings';
import { worldMatrixOf } from '../../utils/transformHierarchy';
import { buildSceneSnapshot } from '../../ai/systemPrompt';
import { choosePlot, openGarden, sendWave, tickGarden, toggleGardenPause, useGarden } from '../../towerDefense/session';
import { createTowerDefenseTemplate } from '../towerDefenseTemplate';
import { buildGameBundle, readGameBundle } from '../exportGame';
import { blankProject } from '../serialize';

beforeEach(() => { useEditorStore.getState().setPlaying(false); useEditorStore.getState().loadProject(blankProject('Garden test')); useGarden.setState({ muted: true }); });
afterEach(() => { useEditorStore.getState().setPlaying(false); useEditorStore.getState().loadProject(blankProject('Cleanup')); });

describe('Sproutwatch template integration', () => {
  it('keeps procedural actors aligned when the entire garden is moved, rotated, scaled or reparented', async () => {
    const id = await createTowerDefenseTemplate(42);
    const s = useEditorStore.getState();
    const parent = s.createObjectWithProps('empty', { position: [30, 2, -15] });
    s.setObjectParent(id, parent);
    s.updateTransform(id, 'position', [3, 1, 5]);
    s.updateTransform(id, 'rotation', [0, Math.PI / 3, 0]);
    s.updateTransform(id, 'scale', [1.5, 1.5, 1.5]);
    const objects = selectActiveObjects(useEditorStore.getState());
    const pad = objects.find(o => o.name === 'Defense pad 1')!;
    const nativePosition = new Vector3().setFromMatrixPosition(worldMatrixOf(new Map(objects.map(o => [o.id, o])), pad.id));
    const livePosition = new Vector3(...pad.transform.position).applyMatrix4(gardenMatrix(objects));
    expect(livePosition.distanceTo(nativePosition)).toBeLessThan(0.00001);
  });

  it('reports the authored garden and live match to the assistant', async () => {
    await createTowerDefenseTemplate(42);
    expect(buildSceneSnapshot().sproutwatch).toMatchObject({ seed: 42, phase: 'editing' });
    useEditorStore.getState().setPlaying(true);
    openGarden(42, true);
    choosePlot(useGarden.getState().game.map.plots[0].id);
    sendWave();
    expect(buildSceneSnapshot().sproutwatch).toMatchObject({ seed: 42, phase: 'wave', coins: 180, health: 20, wave: 1, defenders: 1 });
  });
  it('preserves user objects, creates editable scenery, and safely handles repeated requests', async () => {
    const authored = useEditorStore.getState().createObjectWithProps('cube', { name: 'Keep my work', position: [40, 0, 0] });
    const id = await createTowerDefenseTemplate(42);
    const objects = selectActiveObjects(useEditorStore.getState());
    expect(objects.some(o => o.id === authored)).toBe(true);
    expect(gardenController(objects)?.id).toBe(id);
    expect(gardenSeed(objects)).toBe(42);
    expect(objects.filter(o => o.name.startsWith('Route ')).length).toBeGreaterThan(20);
    expect(objects.filter(o => o.name.startsWith('Defense pad'))).toHaveLength(createGame(42).map.plots.length);
    expect(useEditorStore.getState().assets).toHaveLength(0);
    expect(await createTowerDefenseTemplate(73)).toBe(id);
    expect(selectActiveObjects(useEditorStore.getState())).toHaveLength(objects.length);
  });

  it('keeps the map seed, artwork and required runtime through a production bundle round trip', async () => {
    await createTowerDefenseTemplate(9876);
    const bundle = buildGameBundle(useEditorStore.getState().exportProject());
    expect(bundle.runtimeContract.requiredFeatures).toContain('sproutwatch-tower-defense');
    const { project } = readGameBundle(JSON.parse(JSON.stringify(bundle)));
    useEditorStore.getState().loadProject(project);
    const objects = selectActiveObjects(useEditorStore.getState());
    expect(gardenSeed(objects)).toBe(9876);
    expect(objects.some(o => o.name === 'Garden HQ · mushroom roof')).toBe(true);
    const materials = new Set(project.materials.map(m => m.id));
    expect(objects.filter(o => o.renderer?.materialId).every(o => materials.has(o.renderer!.materialId!))).toBe(true);
  });

  it('pauses simulation, enforces wave build rules, and resets transient progress on replay', () => {
    openGarden(12, true);
    const pad = useGarden.getState().game.map.plots[0].id;
    choosePlot(pad);
    expect(useGarden.getState().game.coins).toBe(180);
    sendWave();
    tickGarden(0.1);
    const time = useGarden.getState().game.elapsed;
    toggleGardenPause();
    tickGarden(0.1);
    expect(useGarden.getState().game.elapsed).toBe(time);
    toggleGardenPause();
    choosePlot(useGarden.getState().game.map.plots[1].id);
    expect(useGarden.getState().game.towers).toHaveLength(1);
    expect(useGarden.getState().notice).toContain('between waves');
    openGarden(12, true);
    expect(useGarden.getState()).toMatchObject({ started: true, paused: false, selectedPlot: null, speed: 1 });
    expect(useGarden.getState().game).toMatchObject({ coins: 260, lives: 20, wave: 0, towers: [], enemies: [] });
  });

  it('refuses invalid seeds and creation during play without altering the scene', async () => {
    const original = selectActiveObjects(useEditorStore.getState());
    await expect(createTowerDefenseTemplate(NaN)).rejects.toThrow('finite');
    expect(selectActiveObjects(useEditorStore.getState())).toBe(original);
    useEditorStore.getState().setPlaying(true);
    await expect(createTowerDefenseTemplate()).rejects.toThrow('Stop Play');
  });
});
