import { beforeEach, describe, expect, it } from 'vitest';
import { blankProject, migrateLoaded } from '../../project/serialize';
import { selectActiveObjects, useEditorStore } from '../../store/editorStore';
import { CREATOR_GAMEPLAY_KITS, CREATOR_GAMEPLAY_KIT_IDS } from '../gameplayKits';

describe('Creator gameplay kits', () => {
  beforeEach(() => useEditorStore.getState().loadProject(blankProject('Kit Test')));

  it('defines the supported one-click kits', () => {
    expect(CREATOR_GAMEPLAY_KITS.map((kit) => kit.id)).toEqual([...CREATOR_GAMEPLAY_KIT_IDS]);
  });

  it('builds a serializable collectible game from normal roles, logic, variables, and UI', () => {
    const result = useEditorStore.getState().createCreatorGameplayKit('collectible-game');
    expect(result).toMatchObject({ ok: true, kitId: 'collectible-game' });
    const objects = selectActiveObjects(useEditorStore.getState());
    expect(objects.filter((object) => object.creatorRoleId === 'player')).toHaveLength(1);
    expect(objects.filter((object) => object.creatorRoleId === 'collectible')).toHaveLength(5);
    const ground = objects.find((object) => object.name === 'Ground');
    expect(ground?.physics?.bodyType).toBe('fixed');
    expect(ground?.transform.rotation).toEqual([-Math.PI / 2, 0, 0]);
    expect(ground?.transform.scale).toEqual([30, 30, 1]);
    expect(useEditorStore.getState().variables.some((variable) => variable.name === 'Score')).toBe(true);
    expect(useEditorStore.getState().uiDocuments.some((document) => document.id === result.uiDocumentId)).toBe(true);

    const migrated = migrateLoaded(JSON.parse(JSON.stringify(useEditorStore.getState().exportProject())));
    expect(migrated.scenes.flatMap((scene) => scene.objects).filter((object) => object.creatorRoleId === 'collectible')).toHaveLength(5);
    expect(migrated.uiDocuments.some((document) => document.id === result.uiDocumentId)).toBe(true);
  });

  it('reuses the ground and player when another kit is added', () => {
    expect(useEditorStore.getState().createCreatorGameplayKit('third-person-starter').ok).toBe(true);
    expect(useEditorStore.getState().createCreatorGameplayKit('interaction-starter').ok).toBe(true);
    const objects = selectActiveObjects(useEditorStore.getState());
    expect(objects.filter((object) => object.name === 'Ground')).toHaveLength(1);
    expect(objects.filter((object) => object.creatorRoleId === 'player')).toHaveLength(1);
    expect(objects.filter((object) => object.creatorRoleId === 'door')).toHaveLength(1);
  });
});
