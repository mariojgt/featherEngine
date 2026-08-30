import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { UIElement } from '../../types';
import { subscribeParticles, type ParticleCommand } from '../../runtime/particleBus';
import { getActivePhysics, stopPhysics } from '../../runtime/physicsWorld';
import { scanBlueprintGraphProblems } from '../../store/editor/graphDiagnostics';
import { selectActiveObjects, useEditorStore } from '../../store/editorStore';
import { createPlatformerTemplate } from '../platformerTemplate';
import { blankProject } from '../serialize';

const flattenUI = (root: UIElement): UIElement[] => [root, ...root.children.flatMap(flattenUI)];

describe('Cloudstep Garden platformer template', () => {
  beforeEach(() => {
    useEditorStore.getState().setPlaying(false);
    useEditorStore.getState().loadProject(blankProject('Cloudstep Garden Test'));
  });

  afterEach(() => {
    useEditorStore.getState().setPlaying(false);
    useEditorStore.getState().loadProject(blankProject('Cloudstep Garden Cleanup'));
  });

  it('builds a polished, asset-free primitive course with complete gameplay and HUD bindings', async () => {
    const playerId = await createPlatformerTemplate();
    const state = useEditorStore.getState();
    const scene = state.activeScene();
    const objects = selectActiveObjects(state);

    expect(scene?.name).toBe('Cloudstep Garden');
    expect(state.renderSettings.renderPreset).toBe('vibrant-arcade');
    expect(scene?.environment).toMatchObject({
      skyMode: 'procedural',
      atmosphericFog: true,
      contactShadows: true,
      toneMapping: 'agx',
    });
    expect(state.assets).toHaveLength(0);
    expect(state.materials).toHaveLength(9);
    expect(
      objects.every((object) =>
        ['empty', 'cube', 'sphere', 'capsule', 'camera', 'light'].includes(object.kind),
      ),
    ).toBe(true);

    const materialIds = new Set(state.materials.map((material) => material.id));
    expect(
      objects
        .filter((object) => object.renderer?.materialId)
        .every((object) => materialIds.has(object.renderer!.materialId!)),
    ).toBe(true);

    const player = objects.find((object) => object.id === playerId);
    expect(player).toMatchObject({
      name: 'Pip — Player Controller',
      kind: 'empty',
      creatorRoleId: 'player',
    });
    expect(player?.character).toMatchObject({
      enabled: true,
      cameraFollow: true,
      autoInputWithScript: true,
      coyoteTime: 0.16,
      jumpBufferTime: 0.18,
      groundLevel: -20,
    });
    const pipPrefab = state.prefabs.find((prefab) => prefab.name === 'Pip — Playable Character');
    expect(state.prefabs).toHaveLength(1);
    expect(pipPrefab).toBeDefined();
    expect(player).toMatchObject({
      prefabSourceId: pipPrefab!.id,
      prefabObjectId: pipPrefab!.rootId,
    });
    const rig = objects.find((object) => object.parentId === playerId && object.name === 'Pip — Primitive Body Rig');
    expect(rig).toBeDefined();
    const headPivot = objects.find((object) => object.name === 'Pip — Head Pivot');
    const sproutPivot = objects.find((object) => object.name === 'Pip — Sprout Pivot');
    const leftShoulder = objects.find((object) => object.name === 'Pip — Left Shoulder Pivot');
    const rightShoulder = objects.find((object) => object.name === 'Pip — Right Shoulder Pivot');
    const leftHip = objects.find((object) => object.name === 'Pip — Left Hip Pivot');
    const rightHip = objects.find((object) => object.name === 'Pip — Right Hip Pivot');
    const scarfPivot = objects.find((object) => object.name === 'Pip — Scarf Flutter Pivot');
    expect([headPivot, leftShoulder, rightShoulder, leftHip, rightHip].every((object) => object?.parentId === rig?.id)).toBe(true);
    expect(sproutPivot?.parentId).toBe(headPivot?.id);
    for (const [partName, parent] of [
      ['Pip Left Arm', leftShoulder],
      ['Pip Left Hand', leftShoulder],
      ['Pip Right Arm', rightShoulder],
      ['Pip Right Hand', rightShoulder],
      ['Pip Left Leg', leftHip],
      ['Pip Left Shoe', leftHip],
      ['Pip Right Leg', rightHip],
      ['Pip Right Shoe', rightHip],
    ] as const) {
      expect(objects.find((object) => object.name === partName)?.parentId).toBe(parent?.id);
    }
    expect(objects.filter((object) => object.name.startsWith('Pip ')).length).toBeGreaterThanOrEqual(30);
    expect(scarfPivot?.parentId).toBe(rig?.id);
    expect(objects.find((object) => object.name === 'Pip Scarf Knot')?.parentId).toBe(scarfPivot?.id);
    const pipIds = new Set<string>([playerId]);
    let foundPipChild = true;
    while (foundPipChild) {
      foundPipChild = false;
      for (const object of objects) {
        if (object.parentId && pipIds.has(object.parentId) && !pipIds.has(object.id)) {
          pipIds.add(object.id);
          foundPipChild = true;
        }
      }
    }
    const pipInstanceObjects = objects.filter((object) => pipIds.has(object.id));
    expect(pipInstanceObjects.length).toBe(pipPrefab!.objects.length);
    expect(
      pipInstanceObjects.every(
        (object) =>
          object.prefabSourceId === pipPrefab!.id &&
          pipPrefab!.objects.some((definition) => definition.id === object.prefabObjectId),
      ),
    ).toBe(true);
    expect(pipPrefab!.objects.find((object) => object.id === pipPrefab!.rootId)?.script?.blueprintId).toBeTruthy();
    expect(pipPrefab!.objects.find((object) => object.name === 'Pip — Primitive Body Rig')?.script?.blueprintId).toBeTruthy();
    for (const rootName of ['Cloudstep Garden — World', '01 — Playable Course', '02 — Sky Scenery', '03 — Cartoon VFX']) {
      expect(objects.find((object) => object.name === rootName)?.transform.position).toEqual([0, 0, 0]);
    }

    const collectibles = objects.filter((object) => object.creatorRoleId === 'collectible');
    expect(collectibles).toHaveLength(10);
    expect(collectibles.every((object) => object.physics?.isTrigger && object.variables?.value === 10)).toBe(true);
    expect(collectibles.every((object) => typeof object.variables?.vfx_anchor === 'string')).toBe(true);
    expect(objects.filter((object) => object.name.includes('— Ray') && object.name.startsWith('Sun Seed'))).toHaveLength(40);
    expect(objects.filter((object) => object.particles)).toHaveLength(22);
    expect(objects.find((object) => object.name === 'Pip — Cream Cloud Puffs')?.particles).toMatchObject({
      enabled: false,
      looping: false,
      blend: 'normal',
    });
    expect(objects.find((object) => object.name === 'Pip — Coral Dash Streaks')?.particles).toMatchObject({
      enabled: false,
      looping: true,
      blend: 'additive',
      rate: 42,
    });
    expect(objects.find((object) => object.name === 'Pip — Mint Air Beads')?.particles).toMatchObject({
      enabled: false,
      looping: true,
      worldSpace: true,
    });
    expect(objects.find((object) => object.name === 'Pip — Gold Impact Flecks')?.particles).toMatchObject({
      enabled: false,
      looping: false,
      blend: 'additive',
    });
    expect(objects.find((object) => object.name === 'Garden Wind Motes')?.particles).toMatchObject({
      enabled: true,
      gpu: true,
      light: false,
      maxParticles: 96,
    });
    expect(objects.find((object) => object.name === 'Cloud Sea Mist')?.particles).toMatchObject({
      enabled: true,
      light: false,
      blend: 'normal',
    });
    const cloudRoots = objects.filter((object) => object.name.endsWith('Cloud Bank') || object.name === 'Upper West Cloud');
    expect(cloudRoots).toHaveLength(4);
    expect(cloudRoots.every((object) => object.script?.blueprintId)).toBe(true);
    expect(objects.find((object) => object.name === 'Welcome Arch Crown Jewel')?.transform.position[1]).toBeGreaterThan(7);
    expect(objects.filter((object) => object.creatorRoleId === 'moving-platform')).toHaveLength(1);
    expect(objects.filter((object) => object.creatorRoleId === 'enemy')).toHaveLength(2);
    expect(objects.filter((object) => object.creatorRoleId === 'enemy').every((object) => object.variables?.damage === 34)).toBe(true);
    expect(objects.filter((object) => object.creatorRoleId === 'enemy').every((object) => object.variables?.health === 70)).toBe(true);
    expect(objects.find((object) => object.name === 'Coral Bloom Bounce Pad')?.script?.blueprintId).toBeTruthy();
    for (const triggerName of ['Sky Garden Checkpoint Trigger', 'Cloud Sea Respawn Trigger', 'Course Clear Trigger']) {
      expect(objects.find((object) => object.name === triggerName)?.physics).toMatchObject({
        enabled: true,
        bodyType: 'fixed',
        isTrigger: true,
      });
    }

    expect(state.variables.map((variable) => [variable.name, variable.defaultValue])).toEqual(
      expect.arrayContaining([
        ['Score', 0],
        ['Checkpoint', 0],
        ['LevelComplete', false],
        ['PipHearts', 3],
        ['FallOut', false],
        ['PipBoost', false],
      ]),
    );
    expect(state.variables.find((variable) => variable.name === 'Score')?.persistent).toBe(true);

    const hud = state.uiDocuments.find((document) => document.name === 'Cloudstep HUD');
    expect(hud).toMatchObject({ surface: 'screen', renderMode: 'dom', visibleOnStart: true });
    expect(hud?.css).toContain('@media (max-width: 640px)');
    expect(hud?.css).toContain('prefers-reduced-motion');
    expect(hud?.css).toContain('cloudstep-confetti');
    const elements = flattenUI(hud!.root);
    expect(elements.find((element) => element.name === 'Sun Seed Total')?.bindings).toContainEqual({
      target: 'text',
      expression: "'☀  ' + (Score / 10) + ' / 10'",
    });
    expect(elements.find((element) => element.name === 'Course Clear Card')?.bindings).toContainEqual({
      target: 'visible',
      expression: 'LevelComplete',
    });
    expect(elements.find((element) => element.name === 'Pip Hearts')?.bindings).toContainEqual({
      target: 'text',
      expression: "'PIP  ♥  × ' + PipHearts",
    });
    expect(elements.find((element) => element.name === 'Pip Fall Out Card')?.bindings).toContainEqual({
      target: 'visible',
      expression: 'FallOut',
    });
    expect(elements.find((element) => element.name === 'Pip Dash Speed Lines')?.bindings).toContainEqual({
      target: 'visible',
      expression: 'PipBoost && LevelComplete == false && FallOut == false',
    });

    const playerGraph = state.graphs.find((graph) => graph.id === player?.script?.graphId)!;
    expect(playerGraph.nodes.some((node) => node.data.nodeKind === 'event.receiveDamage')).toBe(true);
    expect(playerGraph.nodes.some((node) => node.data.nodeKind === 'event.custom' && node.data.eventName === 'PipDefeat')).toBe(true);
    expect(
      playerGraph.nodes.filter(
        (node) =>
          node.data.nodeKind === 'action.tweenProperty' &&
          node.data.tweenProperty === 'rotation' &&
          node.data.tweenLoop,
      ),
    ).toHaveLength(7);
    const impactFx = objects.find((object) => object.name === 'Pip — Gold Impact Flecks')!;
    const definitionImpactFx = pipPrefab!.objects.find((object) => object.name === impactFx.name)!;
    expect(impactFx.prefabObjectId).toBe(definitionImpactFx.id);
    expect(
      playerGraph.nodes.filter(
        (node) =>
          node.data.nodeKind === 'action.burstParticles' && node.data.targetObjectId === definitionImpactFx.id,
      ).length,
    ).toBeGreaterThanOrEqual(5);

    for (const blueprint of state.blueprints) {
      const graph = state.graphs.find((candidate) => candidate.id === blueprint.graphId);
      expect(graph, `${blueprint.name} graph should exist`).toBeDefined();
      expect(scanBlueprintGraphProblems(blueprint, graph!, state.variables), blueprint.name).toEqual([]);
    }

    const packaged = state.buildProjectPackage();
    expect(packaged.assetIds).toHaveLength(0);
    expect(packaged.content.scenes).toHaveLength(1);
    expect(packaged.content.prefabs).toHaveLength(1);
    expect(packaged.content.uiDocuments.some((document) => document.name === 'Cloudstep HUD')).toBe(true);
    expect(packaged.content.variables.map((variable) => variable.name)).toEqual(
      expect.arrayContaining(['Score', 'Checkpoint', 'LevelComplete', 'PipHearts', 'FallOut', 'PipBoost']),
    );
    expect(packaged.content.scenes?.[0].objects.filter((object) => object.creatorRoleId === 'collectible')).toHaveLength(10);
  });

  it('scopes Pip animation and VFX targets to each placed prefab instance', async () => {
    const firstId = await createPlatformerTemplate();
    const state = useEditorStore.getState();
    const prefab = state.prefabs.find((item) => item.name === 'Pip — Playable Character')!;
    const secondId = state.instantiatePrefab(prefab.id, { position: [7, 2.4, -2] })!;
    state.updateCharacterController(secondId, { cameraFollow: false });

    const descendants = (rootId: string) => {
      const current = selectActiveObjects(useEditorStore.getState());
      const ids = new Set([rootId]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const object of current) {
          if (object.parentId && ids.has(object.parentId) && !ids.has(object.id)) {
            ids.add(object.id);
            changed = true;
          }
        }
      }
      return current.filter((object) => ids.has(object.id));
    };
    const firstHead = descendants(firstId).find((object) => object.name === 'Pip — Head Pivot')!;
    const secondHead = descendants(secondId).find((object) => object.name === 'Pip — Head Pivot')!;
    const definitionHead = prefab.objects.find((object) => object.name === 'Pip — Head Pivot')!;
    const graph = state.graphs.find(
      (candidate) => candidate.id === prefab.objects.find((object) => object.id === prefab.rootId)!.script!.graphId,
    )!;
    expect(graph.nodes.some((node) => node.data.targetObjectId === definitionHead.id)).toBe(true);

    state.setPlaying(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    useEditorStore.getState().tickRuntime(0);
    const targetIds = new Set(Object.values(useEditorStore.getState().runtimeTweens).map((session) => session.targetId));
    expect(targetIds.has(firstHead.id)).toBe(true);
    expect(targetIds.has(secondHead.id)).toBe(true);
    expect(targetIds.has(definitionHead.id)).toBe(false);
  });

  it('runs the moving cloud through the real Blueprint runtime and restores edit state on stop', async () => {
    await createPlatformerTemplate();
    const authoredMover = selectActiveObjects(useEditorStore.getState()).find(
      (object) => object.creatorRoleId === 'moving-platform',
    )!;
    const authoredPosition = [...authoredMover.transform.position];

    useEditorStore.getState().setPlaying(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    useEditorStore.getState().tickRuntime(0);
    useEditorStore.getState().tickRuntime(0.5);

    const liveMover = selectActiveObjects(useEditorStore.getState()).find((object) => object.id === authoredMover.id)!;
    expect(liveMover.transform.position[0]).not.toBe(authoredPosition[0]);
    const score = useEditorStore.getState().variables.find((variable) => variable.name === 'Score')!;
    expect(useEditorStore.getState().runtimeVariableValues[score.id]).toBe(0);

    useEditorStore.getState().setPlaying(false);
    const restoredMover = selectActiveObjects(useEditorStore.getState()).find((object) => object.id === authoredMover.id)!;
    expect(restoredMover.transform.position).toEqual(authoredPosition);
  });

  it('settles Pip onto the start-island turf without collecting a seed at rest', async () => {
    const playerId = await createPlatformerTemplate();
    useEditorStore.getState().setPlaying(true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    for (let frame = 0; frame < 300; frame += 1) useEditorStore.getState().tickRuntime(1 / 60);

    const live = selectActiveObjects(useEditorStore.getState()).find((object) => object.id === playerId)!;
    expect(live.transform.position[1]).toBeGreaterThanOrEqual(-0.05);
    expect(live.transform.position[1]).toBeLessThan(0.15);
    const score = useEditorStore.getState().variables.find((variable) => variable.name === 'Score')!;
    expect(useEditorStore.getState().runtimeVariableValues[score.id]).toBe(0);
  });

  it('holds the authored spawn pose while the asynchronous physics world is unavailable', async () => {
    const playerId = await createPlatformerTemplate();
    const authored = selectActiveObjects(useEditorStore.getState()).find((object) => object.id === playerId)!;
    useEditorStore.getState().setPlaying(true);
    stopPhysics();

    for (let frame = 0; frame < 180; frame += 1) useEditorStore.getState().tickRuntime(1 / 60);

    const held = selectActiveObjects(useEditorStore.getState()).find((object) => object.id === playerId)!;
    expect(held.transform.position).toEqual(authored.transform.position);
    expect(useEditorStore.getState().runtimeVelocities[playerId]).toEqual([0, 0, 0]);
  });

  it('holds a slow first frame until the character collider has been synced', async () => {
    const playerId = await createPlatformerTemplate();
    const authored = selectActiveObjects(useEditorStore.getState()).find((object) => object.id === playerId)!;
    useEditorStore.getState().setPlaying(true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(getActivePhysics()).toBeTruthy();
    expect(getActivePhysics()?.hasCharacter(playerId)).toBe(false);

    useEditorStore.getState().tickRuntime(1.5);

    const synced = selectActiveObjects(useEditorStore.getState()).find((object) => object.id === playerId)!;
    expect(synced.transform.position[0]).toBeCloseTo(authored.transform.position[0]);
    expect(synced.transform.position[1]).toBeCloseTo(authored.transform.position[1]);
    expect(synced.transform.position[2]).toBeCloseTo(authored.transform.position[2]);
    expect(getActivePhysics()?.hasCharacter(playerId)).toBe(true);
  });

  it('moves and jumps Pip through the tuned built-in controller input path', async () => {
    const playerId = await createPlatformerTemplate();
    useEditorStore.getState().setPlaying(true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    for (let frame = 0; frame < 120; frame += 1) useEditorStore.getState().tickRuntime(1 / 60);
    const start = selectActiveObjects(useEditorStore.getState()).find((object) => object.id === playerId)!;

    useEditorStore.getState().setRuntimeKey('KeyW', true);
    for (let frame = 0; frame < 30; frame += 1) useEditorStore.getState().tickRuntime(1 / 60);
    const leftShoulder = selectActiveObjects(useEditorStore.getState()).find(
      (object) => object.name === 'Pip — Left Shoulder Pivot',
    )!;
    const stride = Object.values(useEditorStore.getState().runtimeTweens).find(
      (session) => session.targetId === leftShoulder.id && session.property === 'rotation' && session.playing,
    );
    expect(stride).toBeDefined();
    expect(stride!.from[0]).toBeLessThan(0);
    expect(stride!.to[0]).toBeGreaterThan(0);
    useEditorStore.getState().setRuntimeKey('ShiftLeft', true);
    for (let frame = 0; frame < 3; frame += 1) useEditorStore.getState().tickRuntime(1 / 60);
    const boost = useEditorStore.getState().variables.find((variable) => variable.name === 'PipBoost')!;
    expect(useEditorStore.getState().runtimeVariableValues[boost.id]).toBe(true);
    useEditorStore.getState().setRuntimeKey('ShiftLeft', false);
    useEditorStore.getState().tickRuntime(1 / 60);
    expect(useEditorStore.getState().runtimeVariableValues[boost.id]).toBe(false);
    useEditorStore.getState().setRuntimeKey('KeyW', false);
    const moved = selectActiveObjects(useEditorStore.getState()).find((object) => object.id === playerId)!;
    expect(moved.transform.position[2]).toBeGreaterThan(start.transform.position[2] + 0.75);

    useEditorStore.getState().setRuntimeKey('Space', true);
    useEditorStore.getState().tickRuntime(1 / 60);
    useEditorStore.getState().setRuntimeKey('Space', false);
    for (let frame = 0; frame < 10; frame += 1) useEditorStore.getState().tickRuntime(1 / 60);
    const jumped = selectActiveObjects(useEditorStore.getState()).find((object) => object.id === playerId)!;
    expect(jumped.transform.position[1]).toBeGreaterThan(0.5);
  });

  it('guards heart damage, plays the fall-out beat, and respawns Pip through the real runtime', async () => {
    const playerId = await createPlatformerTemplate();
    const fallTrigger = selectActiveObjects(useEditorStore.getState()).find(
      (object) => object.name === 'Cloud Sea Respawn Trigger',
    )!;
    const hearts = useEditorStore.getState().variables.find((variable) => variable.name === 'PipHearts')!;
    const fallOut = useEditorStore.getState().variables.find((variable) => variable.name === 'FallOut')!;

    useEditorStore.getState().setPlaying(true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    useEditorStore.getState().tickRuntime(0);

    useEditorStore.setState({ runtimeDamageEvents: { [playerId]: 34 } });
    useEditorStore.getState().tickRuntime(1 / 60);
    expect(useEditorStore.getState().runtimeVariableValues[hearts.id]).toBe(2);

    // A second hit inside the short authored hurt window is ignored.
    useEditorStore.setState({ runtimeDamageEvents: { [playerId]: 34 } });
    useEditorStore.getState().tickRuntime(1 / 60);
    expect(useEditorStore.getState().runtimeVariableValues[hearts.id]).toBe(2);
    for (let frame = 0; frame < 24; frame += 1) useEditorStore.getState().tickRuntime(1 / 60);

    useEditorStore.setState({ runtimeTriggers: [{ objectId: fallTrigger.id, otherObjectId: playerId }] });
    useEditorStore.getState().tickRuntime(1 / 60);
    useEditorStore.getState().tickRuntime(1 / 60);
    expect(useEditorStore.getState().runtimeVariableValues[fallOut.id]).toBe(true);
    expect(useEditorStore.getState().runtimeVariableValues[hearts.id]).toBe(0);

    for (let frame = 0; frame < 60; frame += 1) useEditorStore.getState().tickRuntime(1 / 60);
    const respawned = selectActiveObjects(useEditorStore.getState()).find((object) => object.id === playerId)!;
    expect(useEditorStore.getState().runtimeVariableValues[fallOut.id]).toBe(false);
    expect(useEditorStore.getState().runtimeVariableValues[hearts.id]).toBe(3);
    expect(respawned.transform.position[2]).toBeLessThan(0);
    expect(respawned.transform.position[1]).toBeGreaterThan(0);
  });

  it('routes a Sun Seed pickup pop to its persistent sibling emitter before destroying the seed', async () => {
    const playerId = await createPlatformerTemplate();
    const seed = selectActiveObjects(useEditorStore.getState()).find((object) => object.name === 'Sun Seed 01')!;
    const fxId = seed.variables?.vfx_anchor as string;
    const commands: ParticleCommand[] = [];
    const unsubscribe = subscribeParticles(fxId, (command) => commands.push(command));

    try {
      useEditorStore.getState().setPlaying(true);
      await new Promise((resolve) => setTimeout(resolve, 100));
      useEditorStore.getState().tickRuntime(0);
      useEditorStore.setState({ runtimeTriggers: [{ objectId: seed.id, otherObjectId: playerId }] });
      useEditorStore.getState().tickRuntime(1 / 60);
      useEditorStore.getState().tickRuntime(1 / 60);

      expect(selectActiveObjects(useEditorStore.getState()).some((object) => object.id === seed.id)).toBe(false);
      const score = useEditorStore.getState().variables.find((variable) => variable.name === 'Score')!;
      expect(useEditorStore.getState().runtimeVariableValues[score.id]).toBe(10);
      expect(commands).toContainEqual({ type: 'emit', on: false });
      expect(commands).toContainEqual({ type: 'burst', count: 26 });
      expect(selectActiveObjects(useEditorStore.getState()).some((object) => object.id === fxId)).toBe(true);
      expect(selectActiveObjects(useEditorStore.getState()).find((object) => object.id === playerId)).toBeDefined();
    } finally {
      unsubscribe();
    }
  });
});
