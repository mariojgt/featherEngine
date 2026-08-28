import type { StoreApi } from 'zustand';
import type { EditorState } from '../editorStore';
import type {
  TerrainBrushSettings,
  TerrainComponent,
  TerrainMaterialLayer,
  TerrainSculptOperation,
  Vector3Tuple,
} from '../../types';
import {
  applyTerrainFoliagePaint,
  applyTerrainPaint,
  applyTerrainSculpt,
  defaultStylizedGrass,
  terrainLocalPointFromWorld,
  withTerrainDefaults,
} from '../../terrain/terrain';
import { syncTerrainLayerColors } from './defaults';
import { makeId, stripUndefined } from './ids';
import { mapActiveSceneObjects, selectActiveObjects } from './storeHelpers';

type SetState = StoreApi<EditorState>['setState'];
type GetState = StoreApi<EditorState>['getState'];

export const applyUpdateTerrain = (set: SetState, id: string, patch: Partial<TerrainComponent>): void => {
  set((state) =>
    mapActiveSceneObjects(state, (objects) =>
      objects.map((object) => {
        if (object.id !== id) return object;
        const current = withTerrainDefaults(object.terrain);
        const terrain = withTerrainDefaults({
          ...current,
          ...stripUndefined(patch),
          foliage: {
            ...current.foliage,
            ...(patch.foliage ? stripUndefined(patch.foliage) : {}),
            // stylizedGrass is a nested block: merge it field-by-field so a caller tweaking one setting
            // (say gradientContrast) doesn't silently reset the other ~18 back to defaults.
            stylizedGrass: {
              ...(current.foliage.stylizedGrass ?? defaultStylizedGrass()),
              ...(patch.foliage?.stylizedGrass ? stripUndefined(patch.foliage.stylizedGrass) : {}),
            },
          },
        });
        const synced = syncTerrainLayerColors(terrain);
        return { ...object, terrain: { ...synced, editVersion: (current.editVersion ?? 0) + 1 } };
      }),
    ),
  );
};

export const applySetTerrainBrush = (set: SetState, patch: Partial<TerrainBrushSettings>): void => {
  set((state) => ({
    terrainBrush: {
      ...state.terrainBrush,
      ...stripUndefined(patch),
      radius: Math.min(256, Math.max(0.5, patch.radius ?? state.terrainBrush.radius)),
      strength: Math.min(64, Math.max(0, patch.strength ?? state.terrainBrush.strength)),
    },
  }));
};

export const applyApplyTerrainBrush = (set: SetState, get: GetState, objectId: string, worldPosition: Vector3Tuple): void => {
  const brush = get().terrainBrush;
  const object = selectActiveObjects(get()).find((item) => item.id === objectId);
  if (!object?.terrain || !brush.enabled) return;
  const terrain = withTerrainDefaults(object.terrain);
  const layerId = brush.targetLayerId && terrain.materialLayers.some((layer) => layer.id === brush.targetLayerId)
    ? brush.targetLayerId
    : terrain.materialLayers[0]?.id;
  if (brush.mode === 'foliage') {
    get().paintFoliageAt(objectId, worldPosition, {
      radius: brush.radius,
      density: brush.foliageDensity ?? 1,
      erase: brush.foliageErase ?? false,
    });
    return;
  }
  if (brush.mode === 'paint' && layerId) {
    get().paintTerrainAt(objectId, worldPosition, { layerId, radius: brush.radius });
    return;
  }
  get().sculptTerrainAt(objectId, worldPosition, {
    operation: brush.operation,
    radius: brush.radius,
    strength: brush.strength,
    flattenHeight: brush.flattenHeight,
  });
};

export const applySculptTerrainAt = (
  set: SetState,
  get: GetState,
  objectId: string,
  worldPosition: Vector3Tuple,
  options: { operation?: TerrainSculptOperation; radius?: number; strength?: number; flattenHeight?: number },
): void => {
  set((state) =>
    mapActiveSceneObjects(state, (objects) =>
      objects.map((object) => {
        if (object.id !== objectId || !object.terrain) return object;
        const terrain = withTerrainDefaults(object.terrain);
        const local = terrainLocalPointFromWorld(object, worldPosition);
        const sculpted = applyTerrainSculpt(terrain, local[0], local[2], {
          operation: options.operation ?? 'raise',
          radius: options.radius ?? get().terrainBrush.radius,
          strength: options.strength ?? get().terrainBrush.strength,
          flattenHeight: options.flattenHeight ?? get().terrainBrush.flattenHeight,
        });
        return { ...object, terrain: { ...sculpted, editVersion: (terrain.editVersion ?? 0) + 1 } };
      }),
    ),
  );
};

export const applyPaintTerrainAt = (
  set: SetState,
  get: GetState,
  objectId: string,
  worldPosition: Vector3Tuple,
  options: { layerId: string; radius?: number },
): void => {
  set((state) =>
    mapActiveSceneObjects(state, (objects) =>
      objects.map((object) => {
        if (object.id !== objectId || !object.terrain) return object;
        const terrain = withTerrainDefaults(object.terrain);
        const local = terrainLocalPointFromWorld(object, worldPosition);
        const painted = applyTerrainPaint(terrain, local[0], local[2], {
          layerId: options.layerId,
          radius: options.radius ?? get().terrainBrush.radius,
        });
        return { ...object, terrain: { ...painted, editVersion: (terrain.editVersion ?? 0) + 1 } };
      }),
    ),
  );
};

export const applyPaintFoliageAt = (
  set: SetState,
  get: GetState,
  objectId: string,
  worldPosition: Vector3Tuple,
  options: { radius?: number; density?: number; erase?: boolean },
): void => {
  set((state) =>
    mapActiveSceneObjects(state, (objects) =>
      objects.map((object) => {
        if (object.id !== objectId || !object.terrain) return object;
        const terrain = withTerrainDefaults(object.terrain);
        const local = terrainLocalPointFromWorld(object, worldPosition);
        const painted = applyTerrainFoliagePaint(terrain, local[0], local[2], {
          radius: options.radius ?? get().terrainBrush.radius,
          density: options.density ?? 1,
          erase: options.erase ?? false,
        });
        return { ...object, terrain: { ...painted, editVersion: (terrain.editVersion ?? 0) + 1 } };
      }),
    ),
  );
};

export const applyUpdateTerrainMaterialLayer = (
  set: SetState,
  objectId: string,
  layerId: string,
  patch: Partial<TerrainMaterialLayer>,
): void => {
  set((state) =>
    mapActiveSceneObjects(state, (objects) =>
      objects.map((object) => {
        if (object.id !== objectId || !object.terrain) return object;
        const terrain = withTerrainDefaults(object.terrain);
        const materialLayers = terrain.materialLayers.map((layer) =>
          layer.id === layerId ? { ...layer, ...stripUndefined(patch), id: layer.id } : layer,
        );
        return { ...object, terrain: syncTerrainLayerColors(withTerrainDefaults({ ...terrain, materialLayers })) };
      }),
    ),
  );
};

export const applyAddTerrainMaterialLayer = (set: SetState, objectId: string): string | undefined => {
  const id = makeId('terrain-layer');
  set((state) =>
    mapActiveSceneObjects(state, (objects) =>
      objects.map((object) => {
        if (object.id !== objectId || !object.terrain) return object;
        const terrain = withTerrainDefaults(object.terrain);
        const materialLayers = [
          ...terrain.materialLayers,
          { id, name: `Layer ${terrain.materialLayers.length + 1}`, color: '#8aa36f' },
        ];
        return { ...object, terrain: syncTerrainLayerColors(withTerrainDefaults({ ...terrain, materialLayers })) };
      }),
    ),
  );
  return id;
};

export const applyRemoveTerrainMaterialLayer = (set: SetState, objectId: string, layerId: string): void => {
  set((state) =>
    mapActiveSceneObjects(state, (objects) =>
      objects.map((object) => {
        if (object.id !== objectId || !object.terrain) return object;
        const terrain = withTerrainDefaults(object.terrain);
        if (terrain.materialLayers.length <= 1) return object;
        const materialLayers = terrain.materialLayers.filter((layer) => layer.id !== layerId);
        const paintOverrides = Object.fromEntries(
          Object.entries(terrain.paintOverrides).filter(([, paintedLayerId]) => paintedLayerId !== layerId),
        );
        return { ...object, terrain: syncTerrainLayerColors(withTerrainDefaults({ ...terrain, materialLayers, paintOverrides })) };
      }),
    ),
  );
};

export const applyClearTerrainEdits = (set: SetState, objectId: string, edits: 'height' | 'paint' | 'all' = 'all'): void => {
  set((state) =>
    mapActiveSceneObjects(state, (objects) =>
      objects.map((object) => {
        if (object.id !== objectId || !object.terrain) return object;
        const terrain = withTerrainDefaults(object.terrain);
        return {
          ...object,
          terrain: withTerrainDefaults({
            ...terrain,
            heightOverrides: edits === 'paint' ? terrain.heightOverrides : {},
            paintOverrides: edits === 'height' ? terrain.paintOverrides : {},
          }),
        };
      }),
    ),
  );
};
