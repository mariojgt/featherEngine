import type { StoreApi } from 'zustand';
import type { EditorState, InstancedGridOptions } from '../editorStore';
import type {
  AttachmentComponent,
  CinematicAction,
  CinematicSequence,
  InventoryComponent,
  LightComponent,
  MeshRendererComponent,
  ParticleSystemComponent,
  ReflectionProbeComponent,
  SceneObject,
  SceneObjectKind,
  TransformComponent,
  Vector3Tuple,
} from '../../types';
import {
  defaultLight,
  defaultPhysics,
  defaultReflectionProbe,
  defaultRenderer,
  defaultTransform,
  titleCase,
  withPhysicsDefaults,
  type CreateObjectOptions,
} from './defaults';
import { makeId, stripUndefined } from './ids';
import {
  cloneObjectTree,
  collectDeletedObjectIds,
  collectSubtree,
  effectiveSelection,
  mapActiveSceneObjects,
  selectActiveObjects,
} from './storeHelpers';
import { makeAttachedWeapon, objectDefaults } from './objectFactory';
import { withTerrainDefaults } from '../../terrain/terrain';
import { withParticleDefaults, defaultParticleConfig, particlePresets, particleAssetConfig, type ParticlePresetId } from '../../runtime/particlePresets';
import { isInstanceable, customizedModelIds } from '../../three/modelInstancing';
import { worldTransformOf, worldToLocalUnderParent } from '../../utils/transformHierarchy';
import { setRagdoll } from '../../runtime/ragdollState';
import { buildCharacterPawn } from './characterPawn';
import { applyAddGameplayKit as applyAddGameplayKitInner } from './addGameplayKit';

type SetState = StoreApi<EditorState>['setState'];
type GetState = StoreApi<EditorState>['getState'];

const cameraLookAtFromRotation = (position: Vector3Tuple, rotation: Vector3Tuple): Vector3Tuple => {
  const pitch = rotation[0] ?? 0;
  const yaw = rotation[1] ?? 0;
  const cosPitch = Math.cos(pitch);
  return [
    position[0] + Math.sin(yaw) * cosPitch * 10,
    position[1] + Math.sin(pitch) * 10,
    position[2] + Math.cos(yaw) * cosPitch * 10,
  ];
};

/**
 * Keep authored cinematics export-safe when their scene objects are deleted. Camera beats are frozen at
 * their last authored/object framing; target constraints are baked to values. Object-driven non-camera
 * beats are removed because they cannot do meaningful work after their target is gone.
 */
const sanitizeCinematicsForDeletedObjects = (
  cinematics: CinematicSequence[] | undefined,
  objects: SceneObject[],
  deletedIds: ReadonlySet<string>,
): CinematicSequence[] | undefined => {
  if (!cinematics?.length || !deletedIds.size) return cinematics;
  const objectById = new Map(objects.map((object) => [object.id, object]));
  return cinematics.map((cinematic) => ({
    ...cinematic,
    actions: cinematic.actions.flatMap((action) => {
      if (action.objectId && deletedIds.has(action.objectId) && action.type !== 'camera') return [];

      const next: CinematicAction = { ...action };
      const boundObject = next.objectId ? objectById.get(next.objectId) : undefined;

      if (next.type === 'camera' && next.objectId && deletedIds.has(next.objectId)) {
        const position = next.position ?? next.toPosition ?? next.fromPosition ?? boundObject?.transform.position;
        if (position && !next.position && !next.toPosition && !next.fromPosition) next.position = [...position];
        if (!next.lookAt && !next.rotation && !next.toRotation && !next.fromRotation && boundObject && position) {
          next.lookAt = cameraLookAtFromRotation(position, boundObject.transform.rotation);
        }
        delete next.objectId;
      }

      if (next.lookAtObjectId && deletedIds.has(next.lookAtObjectId)) {
        const target = objectById.get(next.lookAtObjectId);
        if (!next.lookAt && target) next.lookAt = [...target.transform.position];
        delete next.lookAtObjectId;
      }

      if (next.followObjectId && deletedIds.has(next.followObjectId)) {
        const target = objectById.get(next.followObjectId);
        if (target) {
          const offset = next.followOffset ?? next.position ?? [0, 0, 0];
          if (!next.position && !next.toPosition && !next.fromPosition) {
            next.position = [
              target.transform.position[0] + offset[0],
              target.transform.position[1] + offset[1],
              target.transform.position[2] + offset[2],
            ];
          }
          if (!next.lookAt && !next.lookAtObjectId) next.lookAt = [...target.transform.position];
        }
        delete next.followObjectId;
      }

      if (next.focusObjectId && deletedIds.has(next.focusObjectId)) {
        const target = objectById.get(next.focusObjectId);
        const cameraPosition = next.position ?? next.toPosition ?? next.fromPosition ?? boundObject?.transform.position;
        if (target && cameraPosition && next.focusDistance === undefined) {
          next.focusDistance = Math.hypot(
            target.transform.position[0] - cameraPosition[0],
            target.transform.position[1] - cameraPosition[1],
            target.transform.position[2] - cameraPosition[2],
          );
        }
        delete next.focusObjectId;
      }

      return [next];
    }),
  }));
};

export const applyCreateObject = (set: SetState, kind: SceneObjectKind): void => {
  set((state) => {
    const defaults = objectDefaults[kind];
    const id = makeId('obj');
    const next: SceneObject = {
      id,
      name: kind === 'empty' ? 'Empty Object' : `${kind[0].toUpperCase()}${kind.slice(1)}`,
      kind,
      transform: defaultTransform([0, kind === 'plane' || kind === 'terrain' ? 0 : 2, 0]),
      ...defaults,
    } as SceneObject;

    return { ...mapActiveSceneObjects(state, (objects) => [...objects, next]), selectedObjectId: id };
  });
};

export const applyCreateObjectWithProps = (set: SetState, kind: SceneObjectKind, options: CreateObjectOptions = {}): string => {
  const id = makeId('obj');
  set((state) => {
    const defaults = objectDefaults[kind];
    const next: SceneObject = {
      id,
      name: options.name ?? (kind === 'empty' ? 'Empty Object' : titleCase(kind)),
      kind,
      transform: defaultTransform(options.position ?? [0, kind === 'plane' || kind === 'terrain' ? 0 : 2, 0]),
      ...defaults,
    } as SceneObject;

    if (options.color && next.renderer) {
      next.renderer = { ...next.renderer, color: options.color };
    }
    if (kind === 'terrain') {
      next.terrain = withTerrainDefaults({ ...next.terrain, ...options.terrain });
    }
    if (options.physics) {
      next.physics = withPhysicsDefaults({ ...(next.physics ?? defaultPhysics()), ...options.physics });
    }
    if (options.parentId && selectActiveObjects(state).some((object) => object.id === options.parentId)) {
      next.parentId = options.parentId;
    }

    return { ...mapActiveSceneObjects(state, (objects) => [...objects, next]), selectedObjectId: id };
  });
  return id;
};

export const applySpawnStressTest = (set: SetState, count: number): void => {
  set((state) => {
    const created: SceneObject[] = [];
    const side = Math.max(1, Math.ceil(Math.sqrt(count)));
    for (let i = 0; i < count; i += 1) {
      const gx = (i % side) - side / 2;
      const gz = Math.floor(i / side) - side / 2;
      created.push({
        id: makeId('stress'),
        name: `Stress ${i}`,
        kind: 'cube',
        transform: defaultTransform([gx * 1.2, 6 + (i % 6) * 1.3, gz * 1.2]),
        ...objectDefaults.cube,
        physics: withPhysicsDefaults({ ...defaultPhysics(), bodyType: 'dynamic', collider: 'box' }),
      } as SceneObject);
    }
    return mapActiveSceneObjects(state, (objects) => [...objects, ...created]);
  });
};

export const applyDeleteObject = (set: SetState, id: string): void => {
  set((state) => {
    const objects = selectActiveObjects(state);
    if (!objects.some((object) => object.id === id)) return state;
    const deletedIds = collectDeletedObjectIds(objects, [id]);
    const remaining = objects.filter((object) => !deletedIds.has(object.id));
    const selectedObjectId = remaining.some((object) => object.id === state.selectedObjectId)
      ? state.selectedObjectId
      : remaining[0]?.id ?? '';
    return {
      scenes: state.scenes.map((scene) =>
        scene.id === state.activeSceneId
          ? {
              ...scene,
              objects: remaining,
              cinematics: sanitizeCinematicsForDeletedObjects(scene.cinematics, objects, deletedIds),
            }
          : scene,
      ),
      selectedObjectId,
      selectedObjectIds: state.selectedObjectIds.filter((selectedId) => !deletedIds.has(selectedId)),
      isDirty: true,
    };
  });
};

export const applyDeleteSelectedObject = (set: SetState): void => {
  set((state) => {
    const ids = effectiveSelection(state);
    if (!ids.length) return state;
    const objects = selectActiveObjects(state);
    const deletedIds = collectDeletedObjectIds(objects, ids);
    const remaining = objects.filter((object) => !deletedIds.has(object.id));
    return {
      scenes: state.scenes.map((scene) =>
        scene.id === state.activeSceneId
          ? {
              ...scene,
              objects: remaining,
              cinematics: sanitizeCinematicsForDeletedObjects(scene.cinematics, objects, deletedIds),
            }
          : scene,
      ),
      selectedObjectId: remaining[0]?.id ?? '',
      selectedObjectIds: [],
      isDirty: true,
    };
  });
};

export const applyDuplicateSelectedObject = (set: SetState): void => {
  set((state) => {
    const ids = effectiveSelection(state);
    const objects = selectActiveObjects(state);
    const copies: SceneObject[] = [];
    const newIds: string[] = [];
    ids.forEach((srcId) => {
      const selected = objects.find((object) => object.id === srcId);
      if (!selected) return;
      const id = makeId('obj');
      copies.push({
        ...structuredClone(selected),
        id,
        name: `${selected.name} Copy`,
        transform: {
          ...selected.transform,
          position: [
            selected.transform.position[0] + 0.8,
            selected.transform.position[1],
            selected.transform.position[2] + 0.8,
          ],
        },
      });
      newIds.push(id);
    });
    if (!copies.length) return state;
    return {
      ...mapActiveSceneObjects(state, (current) => [...current, ...copies]),
      selectedObjectId: newIds[newIds.length - 1],
      selectedObjectIds: newIds.length > 1 ? newIds : [],
    };
  });
};

export const applyCopySelectedObjects = (set: SetState, get: GetState): void => {
  const state = get();
  const ids = effectiveSelection(state);
  if (!ids.length) return;
  const objects = selectActiveObjects(state);
  const selectedSet = new Set(ids);
  const isTopLevel = (object: SceneObject) => {
    let parentId = object.parentId;
    while (parentId) {
      if (selectedSet.has(parentId)) return false;
      parentId = objects.find((candidate) => candidate.id === parentId)?.parentId;
    }
    return true;
  };
  const clipboard: Array<{ rootId: string; objects: SceneObject[] }> = [];
  ids.forEach((id) => {
    const object = objects.find((candidate) => candidate.id === id);
    if (object && isTopLevel(object)) clipboard.push({ rootId: id, objects: collectSubtree(objects, id) });
  });
  set({ objectClipboard: clipboard.length ? clipboard : null });
};

export const applyPasteClipboard = (set: SetState): string[] => {
  const newIds: string[] = [];
  set((state) => {
    const clip = state.objectClipboard;
    if (!clip?.length) return state;
    const additions: SceneObject[] = [];
    clip.forEach((group) => {
      const { objects: clones, rootId: newRoot } = cloneObjectTree(group.objects, group.rootId);
      const placed = clones.map((object) =>
        object.id === newRoot
          ? {
              ...object,
              transform: {
                ...object.transform,
                position: [
                  object.transform.position[0] + 0.8,
                  object.transform.position[1],
                  object.transform.position[2] + 0.8,
                ] as Vector3Tuple,
              },
            }
          : object,
      );
      additions.push(...placed);
      newIds.push(newRoot);
    });
    if (!additions.length) return state;
    return {
      ...mapActiveSceneObjects(state, (current) => [...current, ...additions]),
      selectedObjectId: newIds[newIds.length - 1] ?? state.selectedObjectId,
      selectedObjectIds: newIds.length > 1 ? newIds : [],
    };
  });
  return newIds;
};

export const applyGroupSelectedObjects = (set: SetState): void => {
  set((state) => {
    const ids = effectiveSelection(state);
    if (!ids.length) return state;
    const objects = selectActiveObjects(state);
    const selectedSet = new Set(ids);
    const topLevel = ids.filter((id) => {
      const object = objects.find((candidate) => candidate.id === id);
      if (!object) return false;
      let parentId = object.parentId;
      while (parentId) {
        if (selectedSet.has(parentId)) return false;
        parentId = objects.find((candidate) => candidate.id === parentId)?.parentId;
      }
      return true;
    });
    if (!topLevel.length) return state;
    const groupId = makeId('obj');
    const group = {
      id: groupId,
      name: 'Group',
      kind: 'empty',
      transform: defaultTransform([0, 0, 0]),
      ...objectDefaults.empty,
    } as SceneObject;
    const topSet = new Set(topLevel);
    const next = [
      ...objects.map((object) => (topSet.has(object.id) ? { ...object, parentId: groupId } : object)),
      group,
    ];
    return { ...mapActiveSceneObjects(state, () => next), selectedObjectId: groupId, selectedObjectIds: [] };
  });
};

export const applyUngroupObject = (set: SetState, id: string): void => {
  set((state) => {
    const objects = selectActiveObjects(state);
    const group = objects.find((object) => object.id === id);
    if (!group) return state;
    const childIds = objects.filter((object) => object.parentId === id).map((object) => object.id);
    if (!childIds.length) return state;
    const next = objects
      .map((object) => (object.parentId === id ? { ...object, parentId: group.parentId } : object))
      .filter((object) => object.id !== id);
    return {
      ...mapActiveSceneObjects(state, () => next),
      selectedObjectId: childIds[childIds.length - 1],
      selectedObjectIds: childIds.length > 1 ? childIds : [],
    };
  });
};

export const applyDuplicateObject = (set: SetState, id: string, options: { count?: number; offset?: Vector3Tuple } = {}): string[] => {
  const count = Math.max(1, Math.min(Math.round(options.count ?? 1), 200));
  const offset = options.offset ?? [0.8, 0, 0.8];
  const newRootIds: string[] = [];
  set((state) => {
    const objects = selectActiveObjects(state);
    const root = objects.find((object) => object.id === id);
    if (!root) return state;
    const subtree = collectSubtree(objects, id);
    const additions: SceneObject[] = [];
    for (let i = 1; i <= count; i += 1) {
      const { objects: clones, rootId } = cloneObjectTree(subtree, id);
      const placed = clones.map((object) => {
        if (object.id !== rootId) return object;
        return {
          ...object,
          name: `${root.name} Copy${count > 1 ? ` ${i}` : ''}`,
          transform: {
            ...object.transform,
            position: [
              root.transform.position[0] + offset[0] * i,
              root.transform.position[1] + offset[1] * i,
              root.transform.position[2] + offset[2] * i,
            ] as Vector3Tuple,
          },
        };
      });
      newRootIds.push(rootId);
      additions.push(...placed);
    }
    return {
      ...mapActiveSceneObjects(state, (current) => [...current, ...additions]),
      selectedObjectId: newRootIds[newRootIds.length - 1],
    };
  });
  return newRootIds;
};

export const applyCreateInstancedGrid = (set: SetState, sourceId: string, options: InstancedGridOptions = {}): string[] => {
  const rows = Math.round(options.rows ?? 3);
  const columns = Math.round(options.columns ?? 3);
  const total = rows * columns;
  const spacingX = Number.isFinite(options.spacingX) ? Number(options.spacingX) : 2;
  const spacingZ = Number.isFinite(options.spacingZ) ? Number(options.spacingZ) : 2;
  if (rows < 1 || columns < 1 || total < 4 || total > 400) return [];

  let createdIds: string[] = [];
  set((state) => {
    const objects = selectActiveObjects(state);
    const source = objects.find((object) => object.id === sourceId);
    if (!source || !isInstanceable(source, customizedModelIds(state.materials))) return state;

    createdIds = [source.id];
    const additions: SceneObject[] = [];
    for (let index = 1; index < total; index += 1) {
      const row = Math.floor(index / columns);
      const column = index % columns;
      const clone = structuredClone(source) as SceneObject;
      clone.id = makeId('obj');
      clone.name = `${source.name} Instance ${index + 1}`;
      clone.parentId = undefined;
      clone.transform = {
        ...clone.transform,
        position: [
          source.transform.position[0] + column * spacingX,
          source.transform.position[1],
          source.transform.position[2] + row * spacingZ,
        ],
      };
      createdIds.push(clone.id);
      additions.push(clone);
    }

    return {
      ...mapActiveSceneObjects(state, (current) => [...current, ...additions]),
      selectedObjectId: source.id,
      selectedObjectIds: createdIds,
    };
  });
  return createdIds;
};

export const applySetObjectParent = (set: SetState, id: string, parentId?: string): void => {
  set((state) => {
    if (id === parentId) return state;
    const objects = selectActiveObjects(state);
    if (!objects.some((object) => object.id === id)) return state;
    if (parentId && !objects.some((object) => object.id === parentId)) return state;
    if (parentId && collectSubtree(objects, id).some((object) => object.id === parentId)) return state;
    const world = worldTransformOf(objects, id);
    const localTransform = worldToLocalUnderParent(objects, world, parentId || undefined);
    return mapActiveSceneObjects(state, (current) =>
      current.map((object) =>
        object.id === id ? { ...object, parentId: parentId || undefined, transform: localTransform } : object,
      ),
    );
  });
};

export const applyRenameObject = (set: SetState, id: string, name: string): void => {
  set((state) =>
    mapActiveSceneObjects(state, (objects) =>
      objects.map((object) => (object.id === id ? { ...object, name } : object)),
    ),
  );
};

export const applyUpdateTransform = (set: SetState, id: string, field: keyof TransformComponent, value: Vector3Tuple): void => {
  set((state) =>
    mapActiveSceneObjects(state, (objects) =>
      objects.map((object) =>
        object.id === id ? { ...object, transform: { ...object.transform, [field]: value } } : object,
      ),
    ),
  );
};

export const applyUpdateRenderer = (set: SetState, id: string, patch: Partial<MeshRendererComponent>): void => {
  set((state) =>
    mapActiveSceneObjects(state, (objects) =>
      objects.map((object) =>
        object.id === id && object.renderer ? { ...object, renderer: { ...object.renderer, ...patch } } : object,
      ),
    ),
  );
};

export const applySetObjectModel = (set: SetState, id: string, modelAssetId?: string): void => {
  set((state) =>
    mapActiveSceneObjects(state, (objects) =>
      objects.map((object) => {
        if (object.id !== id) return object;
        const renderer = object.renderer ?? defaultRenderer('cube');
        return {
          ...object,
          renderer: { ...renderer, modelAssetId: modelAssetId || undefined, materialSlots: undefined },
        };
      }),
    ),
  );
};

export const applySetObjectMaterialSlot = (set: SetState, objectId: string, slotIndex: number, materialId?: string): void => {
  set((state) =>
    mapActiveSceneObjects(state, (objects) =>
      objects.map((object) => {
        if (object.id !== objectId || !object.renderer) return object;
        const slots = [...(object.renderer.materialSlots ?? [])];
        while (slots.length <= slotIndex) slots.push(undefined);
        slots[slotIndex] = materialId || undefined;
        return { ...object, renderer: { ...object.renderer, materialSlots: slots } };
      }),
    ),
  );
};

export const applySetObjectMaterial = (set: SetState, objectId: string, materialId?: string): void => {
  set((state) =>
    mapActiveSceneObjects(state, (objects) =>
      objects.map((object) => {
        if (object.id !== objectId) return object;
        const renderer = object.renderer ?? defaultRenderer('cube');
        return { ...object, renderer: { ...renderer, materialId: materialId || undefined } };
      }),
    ),
  );
};

export const applySetObjectRagdoll = (set: SetState, objectId: string, on: boolean): void => {
  setRagdoll(objectId, on);
};

export const applySetInventory = (set: SetState, objectId: string, inventory: InventoryComponent | undefined): void => {
  set((state) =>
    mapActiveSceneObjects(state, (objects) =>
      objects.map((object) => (object.id === objectId ? { ...object, inventory } : object)),
    ),
  );
};

export const applyEquipInventorySlot = (set: SetState, get: GetState, objectId: string, index: number): void => {
  const player = selectActiveObjects(get()).find((o) => o.id === objectId);
  const inv = player?.inventory;
  if (!player || !inv || index < 0 || index >= inv.slots.length) return;
  const slot = inv.slots[index];
  const socketName = inv.socketName ?? 'RightHand';
  const boneName = inv.boneName ?? 'hand_r';
  const markerSlot = socketName || boneName;
  const scale = slot.attachScale ?? 1;
  const yaw = slot.attachYaw ?? 0;
  const offsetPosition = slot.attachPosition;
  const offsetRotation = slot.attachRotation ?? ([0, yaw, 0] as Vector3Tuple);
  const offsetScale = [scale, scale, scale] as Vector3Tuple;
  set((state) => {
    const scenes = state.scenes.map((scene) => {
      if (scene.id !== state.activeSceneId) return scene;
      let objects = scene.objects.filter(
        (o) =>
          !(o.variables?.__attachedWeapon && o.attachment?.targetObjectId === objectId && (o.attachment.socketName || o.attachment.boneName) === markerSlot),
      );
      if (slot.weaponAssetId) {
        objects = [...objects, makeAttachedWeapon(objectId, slot.weaponAssetId, boneName, socketName, offsetPosition, offsetRotation, offsetScale)];
      }
      objects = objects.map((o) => (o.id === objectId && o.inventory ? { ...o, inventory: { ...o.inventory, equipped: index } } : o));
      return { ...scene, objects };
    });
    const playing = state.isPlaying;
    return {
      scenes,
      runtimeMontageRequests:
        playing && slot.equipAnimId
          ? { ...state.runtimeMontageRequests, [objectId]: { animationId: slot.equipAnimId, speed: 1 } }
          : state.runtimeMontageRequests,
      runtimeSoundQueue: playing && inv.switchSoundId ? [...state.runtimeSoundQueue, { assetId: inv.switchSoundId }] : state.runtimeSoundQueue,
      isDirty: playing ? state.isDirty : true,
    };
  });
  if (get().isPlaying) {
    const controller = get().animatorControllers.find((c) => c.id === player.animator?.controllerId);
    const ranged = controller?.parameters.find((p) => p.name === 'RangedMode');
    if (ranged) get().setRuntimeAnimatorParam(objectId, ranged.id, Boolean(slot.ranged));
  }
};

export const applySetObjectLight = (set: SetState, objectId: string, patch: Partial<LightComponent>): void => {
  set((state) =>
    mapActiveSceneObjects(state, (objects) =>
      objects.map((object) =>
        object.id === objectId
          ? { ...object, kind: 'light', light: { ...defaultLight(), ...object.light, ...stripUndefined(patch) } }
          : object,
      ),
    ),
  );
};

export const applySetReflectionProbe = (set: SetState, objectId: string, patch: Partial<ReflectionProbeComponent>): void => {
  set((state) =>
    mapActiveSceneObjects(state, (objects) =>
      objects.map((object) =>
        object.id === objectId
          ? { ...object, reflectionProbe: { ...defaultReflectionProbe(), ...object.reflectionProbe, ...stripUndefined(patch) } }
          : object,
      ),
    ),
  );
};

export const applyCreateReflectionProbe = (set: SetState, position: Vector3Tuple = [0, 2, 0]): string => {
  const id = makeId('obj');
  const probe: SceneObject = {
    id,
    name: 'Reflection Probe',
    kind: 'empty',
    transform: defaultTransform(position),
    ...objectDefaults.empty,
    reflectionProbe: defaultReflectionProbe(),
  } as SceneObject;
  set((state) => ({
    ...mapActiveSceneObjects(state, (objects) => [...objects, probe]),
    selectedObjectId: id,
    selectedObjectIds: [],
  }));
  return id;
};

export const applyRebakeReflectionProbe = (set: SetState, objectId: string): void => {
  set((state) =>
    mapActiveSceneObjects(state, (objects) =>
      objects.map((object) =>
        object.id === objectId && object.reflectionProbe
          ? { ...object, reflectionProbe: { ...object.reflectionProbe, bakeNonce: (object.reflectionProbe.bakeNonce ?? 0) + 1 } }
          : object,
      ),
    ),
  );
};

export const applyRemoveReflectionProbe = (set: SetState, objectId: string): void => {
  set((state) =>
    mapActiveSceneObjects(state, (objects) =>
      objects.map((object) => (object.id === objectId ? { ...object, reflectionProbe: undefined } : object)),
    ),
  );
};

export const applyAddParticles = (set: SetState, objectId: string, preset?: ParticlePresetId): void => {
  set((state) =>
    mapActiveSceneObjects(state, (objects) =>
      objects.map((object) =>
        object.id === objectId
          ? { ...object, particles: withParticleDefaults({ ...object.particles, ...(preset ? particlePresets[preset] : {}) }) }
          : object,
      ),
    ),
  );
};

export const applyUpdateParticles = (set: SetState, objectId: string, patch: Partial<ParticleSystemComponent>): void => {
  set((state) =>
    mapActiveSceneObjects(state, (objects) =>
      objects.map((object) =>
        object.id === objectId && object.particles
          ? { ...object, particles: { ...object.particles, ...stripUndefined(patch) } }
          : object,
      ),
    ),
  );
};

export const applyRemoveParticles = (set: SetState, objectId: string): void => {
  set((state) =>
    mapActiveSceneObjects(state, (objects) =>
      objects.map((object) => {
        if (object.id !== objectId) return object;
        const next = { ...object };
        delete next.particles;
        return next;
      }),
    ),
  );
};

export const applySetAttachment = (set: SetState, objectId: string, attachment?: AttachmentComponent): void => {
  set((state) =>
    mapActiveSceneObjects(state, (objects) =>
      objects.map((object) => {
        if (object.id !== objectId) return object;
        const next = { ...object };
        if (attachment) next.attachment = attachment;
        else delete next.attachment;
        return next;
      }),
    ),
  );
};

export const applyCreateCharacterPawn = (set: SetState, get: GetState, modelAssetId: string, name?: string): string | undefined => {
  const state = get();
  const result = buildCharacterPawn(state, modelAssetId, name);
  if (!result) return undefined;
  const { controller, blueprint, presetGraph, pawn } = result;
  set((draft) => ({
    animatorControllers: [...draft.animatorControllers, controller],
    activeAnimatorControllerId: controller.id,
    blueprints: [...draft.blueprints, blueprint],
    graphs: [...draft.graphs, presetGraph],
    activeBlueprintId: blueprint.id,
    ...mapActiveSceneObjects(draft, (objects) => [...objects, pawn]),
    selectedObjectId: pawn.id,
  }));
  return pawn.id;
};

export const applyAddGameplayKit = (set: SetState, objectId: string, kit: 'ranged' | 'health' | 'interactions' | 'emotes'): string | undefined => {
  let summary = '';
  set((draft) => {
    const result = applyAddGameplayKitInner(draft, objectId, kit);
    summary = result.summary;
    return result.next;
  });
  return summary || undefined;
};

export const applySetObjectParticleSystem = (set: SetState, objectId: string, systemId?: string): void => {
  set((state) =>
    mapActiveSceneObjects(state, (objects) =>
      objects.map((object) => {
        if (object.id !== objectId) return object;
        if (!systemId) {
          const next = { ...object };
          delete next.particles;
          return next;
        }
        const asset = state.particleSystems.find((p) => p.id === systemId);
        const config = asset ? particleAssetConfig(asset) : defaultParticleConfig();
        return { ...object, particles: { ...config, enabled: true, systemId } };
      }),
    ),
  );
};
