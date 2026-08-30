import { beforeEach, describe, expect, it } from 'vitest';
import { BEHAVIOR_PRESETS } from '../../project/behaviors';
import { blankProject, migrateLoaded } from '../../project/serialize';
import { selectActiveObjects, useEditorStore } from '../../store/editorStore';
import { CREATOR_ROLES, CREATOR_ROLE_IDS } from '../roles';

const objectById = (id: string) =>
  selectActiveObjects(useEditorStore.getState()).find((object) => object.id === id);

describe('Creator roles', () => {
  beforeEach(() => {
    useEditorStore.getState().loadProject(blankProject('Creator Role Test'));
  });

  it('defines the initial role set in terms of real behavior presets with Creator metadata', () => {
    expect(CREATOR_ROLES.map((role) => role.id)).toEqual([...CREATOR_ROLE_IDS]);
    for (const role of CREATOR_ROLES) {
      if (!role.behaviorPresetId) {
        expect(role.character, role.id).toBeTruthy();
        continue;
      }
      const preset = BEHAVIOR_PRESETS.find((candidate) => candidate.id === role.behaviorPresetId);
      expect(preset, role.id).toBeTruthy();
      expect(preset?.category, role.id).toMatch(/^(movement|interaction|combat|world|gameplay)$/);
      expect(preset?.recommendedFor, role.id).toContain(role.id);
      for (const parameter of preset?.parameters ?? []) {
        expect(parameter.key, `${role.id} parameter key`).toBeTruthy();
        expect(parameter.label, `${role.id} parameter label`).toBeTruthy();
      }
    }
  });

  it('creates a playable character through the normal built-in controller and project format', () => {
    const result = useEditorStore.getState().createRoleObject('player', { position: [0, 0, 3] });
    expect(result).toMatchObject({ ok: true, roleId: 'player', created: true, changed: true });

    const player = objectById(result.objectId!)!;
    expect(player).toMatchObject({ creatorRoleId: 'player', kind: 'capsule' });
    expect(player.transform.position).toEqual([0, 0, 3]);
    expect(player.character).toMatchObject({ enabled: true, cameraFollow: true });
    expect(player.variables?.tags).toBe('player');
    expect(player.script).toBeUndefined();

    const migrated = migrateLoaded(JSON.parse(JSON.stringify(useEditorStore.getState().exportProject())));
    const saved = migrated.scenes.flatMap((scene) => scene.objects).find((object) => object.id === result.objectId)!;
    expect(saved.creatorRoleId).toBe('player');
    expect(saved.character).toMatchObject({ enabled: true, cameraFollow: true });
  });

  it('switches roles without leaving conflicting player control, physics, or managed tags active', () => {
    const door = useEditorStore.getState().createRoleObject('door');
    expect(useEditorStore.getState().makeObjectRole(door.objectId!, 'player').ok).toBe(true);
    expect(objectById(door.objectId!)).toMatchObject({ creatorRoleId: 'player' });
    expect(objectById(door.objectId!)?.script).toBeUndefined();
    expect(objectById(door.objectId!)?.character).toMatchObject({ enabled: true, cameraFollow: true });
    expect(objectById(door.objectId!)?.physics?.enabled).toBe(false);
    expect(String(objectById(door.objectId!)?.variables?.tags).split(',')).toContain('player');
    expect(String(objectById(door.objectId!)?.variables?.tags).split(',')).not.toContain('door');

    expect(useEditorStore.getState().makeObjectRole(door.objectId!, 'enemy').ok).toBe(true);
    expect(objectById(door.objectId!)?.character?.enabled).toBe(false);
    expect(objectById(door.objectId!)?.physics).toMatchObject({ enabled: true, bodyType: 'kinematic' });
    expect(String(objectById(door.objectId!)?.variables?.tags).split(',')).toContain('enemy');
    expect(String(objectById(door.objectId!)?.variables?.tags).split(',')).not.toContain('player');
  });

  it('makes an existing object collectible and is idempotent', () => {
    const store = useEditorStore.getState();
    const objectId = store.createObjectWithProps('sphere', { name: 'Coin' });

    const first = useEditorStore.getState().makeObjectRole(objectId, 'collectible');
    expect(first).toMatchObject({ ok: true, objectId, roleId: 'collectible', created: false, changed: true });
    const collectible = objectById(objectId)!;
    expect(collectible.creatorRoleId).toBe('collectible');
    expect(collectible.physics).toMatchObject({ enabled: true, bodyType: 'fixed', collider: 'sphere', isTrigger: true });
    expect(collectible.variables).toMatchObject({ value: 10, tags: 'collectible' });
    expect(collectible.script?.blueprintId).toBe(first.blueprintId);
    expect(useEditorStore.getState().variables.filter((variable) => variable.name === 'Score')).toHaveLength(1);

    const blueprintCount = useEditorStore.getState().blueprints.length;
    const graphCount = useEditorStore.getState().graphs.length;
    const second = useEditorStore.getState().makeObjectRole(objectId, 'collectible');
    expect(second).toMatchObject({ ok: true, blueprintId: first.blueprintId, created: false, changed: false });
    expect(useEditorStore.getState().blueprints).toHaveLength(blueprintCount);
    expect(useEditorStore.getState().graphs).toHaveLength(graphCount);
    expect(useEditorStore.getState().variables.filter((variable) => variable.name === 'Score')).toHaveLength(1);
  });

  it('creates doors with interaction prompt data and shared editable behavior logic', () => {
    const first = useEditorStore.getState().createRoleObject('door', { position: [2, 1, -3] });
    const second = useEditorStore.getState().createRoleObject('door', { name: 'Exit Door' });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.blueprintId).toBe(first.blueprintId);

    const door = objectById(first.objectId!)!;
    expect(door.transform.position).toEqual([2, 1, -3]);
    expect(door.physics).toMatchObject({ enabled: true, bodyType: 'fixed', isTrigger: false });
    expect(door.variables).toMatchObject({ interactable: true, interactPrompt: 'Open / Close' });
    expect((door.variables?.tags as string).split(',')).toEqual(expect.arrayContaining(['door', 'interactable']));
    const blueprint = useEditorStore.getState().blueprints.find((item) => item.id === first.blueprintId);
    const graph = useEditorStore.getState().graphs.find((item) => item.id === blueprint?.graphId);
    expect(blueprint?.name).toBe('Behavior Door');
    expect(graph?.nodes.length).toBeGreaterThan(1);
    expect(useEditorStore.getState().blueprints.filter((item) => item.name === 'Behavior Door')).toHaveLength(1);
  });

  it('uses one composed enemy blueprint with sensible physics and tunable instance variables', () => {
    const first = useEditorStore.getState().createRoleObject('enemy');
    const second = useEditorStore.getState().createRoleObject('enemy', { name: 'Goblin' });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.blueprintId).toBe(first.blueprintId);

    const enemy = objectById(first.objectId!)!;
    expect(enemy.creatorRoleId).toBe('enemy');
    expect(enemy.kind).toBe('capsule');
    expect(enemy.physics).toMatchObject({
      enabled: true,
      bodyType: 'kinematic',
      collider: 'capsule',
      isTrigger: false,
      gravityScale: 0,
      lockedRotation: [true, false, true],
    });
    expect(enemy.variables).toMatchObject({ health: 100, speed: 3, damage: 10, aggro_range: 14, tags: 'enemy' });
    expect(useEditorStore.getState().blueprints.filter((blueprint) => blueprint.name === 'Behavior Enemy')).toHaveLength(1);
  });

  it('composes hazards, destructibles, and moving platforms through normal components', () => {
    const hazardResult = useEditorStore.getState().createRoleObject('hazard');
    const destructibleResult = useEditorStore.getState().createRoleObject('destructible');
    const platformResult = useEditorStore.getState().createRoleObject('moving-platform');

    const hazard = objectById(hazardResult.objectId!)!;
    expect(hazard.physics).toMatchObject({ enabled: true, bodyType: 'fixed', isTrigger: true });
    expect(hazard.variables).toMatchObject({ damage: 15, tags: 'hazard' });

    const destructible = objectById(destructibleResult.objectId!)!;
    expect(destructible.physics).toMatchObject({ enabled: true, bodyType: 'dynamic', isTrigger: false });
    expect(destructible.variables).toMatchObject({ health: 100, tags: 'destructible' });
    expect(destructible.fracture).toMatchObject({ enabled: true, pattern: 'chunks', pieces: 3, impactThreshold: 6 });

    const platform = objectById(platformResult.objectId!)!;
    expect(platform.physics).toMatchObject({ enabled: true, bodyType: 'fixed', isTrigger: false });
    expect(platform.variables).toMatchObject({ speed: 2, distance: 5 });
  });

  it('persists role metadata and all composed systems through normal project export/load serialization', () => {
    const result = useEditorStore.getState().createRoleObject('collectible', { name: 'Golden Coin' });
    expect(result.ok).toBe(true);

    const exported = useEditorStore.getState().exportProject();
    const serialized = JSON.stringify(exported);
    expect(serialized).toContain('"creatorRoleId":"collectible"');
    const migrated = migrateLoaded(JSON.parse(serialized));
    const saved = migrated.scenes.flatMap((scene) => scene.objects).find((object) => object.id === result.objectId)!;
    expect(saved).toMatchObject({ creatorRoleId: 'collectible' });
    expect(saved.physics).toMatchObject({ enabled: true, isTrigger: true });
    expect(saved.variables).toMatchObject({ value: 10, tags: 'collectible' });
    expect(migrated.blueprints.some((blueprint) => blueprint.id === saved.script?.blueprintId)).toBe(true);
    expect(migrated.variables.some((variable) => variable.name === 'Score')).toBe(true);
  });

  it('reports invalid requests without mutating the project', () => {
    const before = JSON.stringify(useEditorStore.getState().exportProject());
    expect(useEditorStore.getState().createRoleObject('not-a-role')).toMatchObject({
      ok: false,
      error: 'unknown-role',
      created: false,
      changed: false,
    });
    expect(useEditorStore.getState().makeObjectRole('missing', 'door')).toMatchObject({
      ok: false,
      error: 'object-not-found',
      created: false,
      changed: false,
    });
    const after = JSON.stringify(useEditorStore.getState().exportProject());
    // savedAt is regenerated for each export; compare the authored payload without it.
    expect(JSON.parse(after)).toMatchObject({ ...JSON.parse(before), savedAt: expect.any(String) });
  });
});
