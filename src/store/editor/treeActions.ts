import type { StoreApi } from 'zustand';
import type { EditorState, PlantGroveOptions } from '../editorStore';
import type {
  ModelPart,
  ModelPartShape,
  ModelSpec,
  TerrainComponent,
  TreeArchetype,
  TreeComponent,
  TreeSpec,
  Vector3Tuple,
  SceneObject,
} from '../../types';
import { GRASS_PRESETS, defaultStylizedGrass, highestTerrainWorldHeight, type GrassPresetId } from '../../terrain/terrain';
import { chopTree } from '../../runtime/treeChop';
import { normalizeTreeSpec, treeRng, treeSpecFromArchetype } from '../../tree/treeSpec';
import { getStylizedPreset, stylizedTreeSpec } from '../../tree/stylizedPresets';
import { makeModelPart, modelSpecFromStarter, normalizeModelSpec } from '../../model/modelSpec';
import { cloneMesh, extrudeMeshFaces, subdivideMeshFaces, type MeshBooleanOp } from '../../model/modelMesh';
import { booleanMeshParts, dedupeGeometryToMesh } from '../../model/modelMeshCsg';
import { getPartRenderGeometry } from '../../model/modelGeometry';
import { defaultTransform } from './defaults';
import { makeId, stripUndefined } from './ids';
import { mapActiveSceneObjects, selectActiveObjects } from './storeHelpers';

type SetState = StoreApi<EditorState>['setState'];
type GetState = StoreApi<EditorState>['getState'];

/** Stable per-object tree seed derived from its id, so the same tree rebuilds identically on reload. */
const seedFromId = (id: string): number => {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) % 100000;
};

export const applyCreateTreeSpec = (set: SetState, archetype: TreeArchetype, name?: string): string => {
  const id = makeId('tree');
  set((state) => ({
    treeSpecs: [...state.treeSpecs, treeSpecFromArchetype(archetype, id, name)],
    activeTreeSpecId: id,
    isDirty: true,
  }));
  return id;
};

export const applyUpdateTreeSpec = (set: SetState, specId: string, patch: Partial<TreeSpec>): void => {
  set((state) => ({
    treeSpecs: state.treeSpecs.map((spec) =>
      spec.id === specId ? normalizeTreeSpec({ ...spec, ...patch, id: specId }) : spec,
    ),
    isDirty: true,
  }));
};

export const applyDuplicateTreeSpec = (set: SetState, specId: string): string => {
  const id = makeId('tree');
  set((state) => {
    const source = state.treeSpecs.find((spec) => spec.id === specId);
    if (!source) return state;
    return {
      treeSpecs: [...state.treeSpecs, { ...source, id, name: `${source.name} Copy` }],
      activeTreeSpecId: id,
      isDirty: true,
    };
  });
  return id;
};

export const applyDeleteTreeSpec = (set: SetState, specId: string): void => {
  set((state) => ({
    treeSpecs: state.treeSpecs.filter((spec) => spec.id !== specId),
    activeTreeSpecId:
      state.activeTreeSpecId === specId ? state.treeSpecs.find((s) => s.id !== specId)?.id ?? '' : state.activeTreeSpecId,
    // Objects keep their inline spec copy — dropping the library entry must never delete their tree.
    ...mapActiveSceneObjects(state, (objects) =>
      objects.map((object) =>
        object.tree?.specId === specId ? { ...object, tree: { ...object.tree, specId: undefined } } : object,
      ),
    ),
    isDirty: true,
  }));
};

export const applySetActiveTreeSpec = (set: SetState, specId: string): void => {
  set({ activeTreeSpecId: specId });
};

export const applyCreateTree = (
  set: SetState,
  get: GetState,
  archetype: TreeArchetype,
  options: { position?: Vector3Tuple; seed?: number; name?: string } = {},
): string => {
  const id = makeId('obj');
  set((state) => {
    // Prefer the project's library entry for this archetype so the new tree is LINKED to the asset —
    // editing it in the Tree Builder then updates this tree along with every other instance.
    const libraryEntry = state.treeSpecs.find((entry) => entry.archetype === archetype);
    const spec = libraryEntry ?? treeSpecFromArchetype(archetype, `${archetype}-${id}`);
    // Trees grow FROM the ground, so they spawn at y=0 rather than the usual 2-unit drop-in height —
    // and on a heightmapped landscape y=0 is buried or floating, so snap to the terrain surface.
    const requested = options.position ?? [0, 0, 0];
    const groundY = highestTerrainWorldHeight(selectActiveObjects(state), requested[0], requested[2]);
    const next: SceneObject = {
      id,
      name: options.name ?? spec.name,
      kind: 'empty',
      transform: defaultTransform([requested[0], groundY ?? requested[1], requested[2]]),
      tree: { enabled: true, spec, specId: libraryEntry?.id, seed: options.seed ?? seedFromId(id) },
    } as SceneObject;
    return { ...mapActiveSceneObjects(state, (objects) => [...objects, next]), selectedObjectId: id };
  });
  return id;
};

export const applyUpdateTree = (set: SetState, id: string, patch: Partial<TreeComponent>): void => {
  set((state) =>
    mapActiveSceneObjects(state, (objects) =>
      objects.map((object) => {
        if (object.id !== id || !object.tree) return object;
        const merged = { ...object.tree, ...stripUndefined(patch) };
        return { ...object, tree: { ...merged, spec: normalizeTreeSpec(merged.spec) } };
      }),
    ),
  );
};

export const applyCreateTreeSpecFromPreset = (set: SetState, presetId: string, name?: string): string | null => {
  const preset = getStylizedPreset(presetId);
  if (!preset) return null;
  const id = makeId('tree');
  set((state) => ({
    treeSpecs: [...state.treeSpecs, stylizedTreeSpec(preset, id, name)],
    activeTreeSpecId: id,
    isDirty: true,
  }));
  return id;
};

export const applyCreateTreeFromSpec = (
  set: SetState,
  get: GetState,
  specId: string,
  options: { position?: Vector3Tuple; seed?: number; name?: string } = {},
): string | null => {
  const library = get().treeSpecs.find((entry) => entry.id === specId);
  if (!library) return null;
  const id = makeId('obj');
  set((state) => {
    const requested = options.position ?? [0, 0, 0];
    const groundY = highestTerrainWorldHeight(selectActiveObjects(state), requested[0], requested[2]);
    const next: SceneObject = {
      id,
      name: options.name ?? library.name,
      kind: 'empty',
      transform: defaultTransform([requested[0], groundY ?? requested[1], requested[2]]),
      tree: { enabled: true, spec: library, specId, seed: options.seed ?? seedFromId(id) },
    } as SceneObject;
    return { ...mapActiveSceneObjects(state, (objects) => [...objects, next]), selectedObjectId: id };
  });
  return id;
};

export const applyPlantGrove = (
  set: SetState,
  get: GetState,
  options: PlantGroveOptions = {},
): { groupId: string; treeIds: string[] } | null => {
  // Resolve (or create) the ONE library asset every tree links to — a grove is an instance field
  // of a single spec, so restyling that asset later restyles the whole grove at once.
  let specId = options.specId;
  if (specId && !get().treeSpecs.some((entry) => entry.id === specId)) return null;
  if (!specId && options.presetId) {
    const preset = getStylizedPreset(options.presetId);
    if (!preset) return null;
    // Reuse the entry a previous plant created, so planting twice never duplicates the library.
    const existing = get().treeSpecs.find(
      (entry) => entry.name === preset.name && entry.archetype === preset.archetype,
    );
    specId = existing?.id ?? get().createTreeSpecFromPreset(options.presetId) ?? undefined;
  }
  if (!specId && options.archetype) {
    const existing = get().treeSpecs.find((entry) => entry.archetype === options.archetype);
    specId = existing?.id ?? get().createTreeSpec(options.archetype);
  }
  const library = get().treeSpecs.find((entry) => entry.id === specId);
  if (!library) return null;

  const count = Math.min(80, Math.max(1, Math.trunc(options.count ?? 12)));
  const radius = Math.min(200, Math.max(1, options.radius ?? 12));
  const rng = treeRng(Math.trunc(options.seed ?? Math.random() * 0xfffffff));
  const center = options.position ?? [0, 0, 0];
  const groupId = makeId('obj');
  const treeIds: string[] = [];
  const GOLDEN_ANGLE = 2.399963229728653;
  set((state) => {
    const objects = selectActiveObjects(state);
    const parentY = highestTerrainWorldHeight(objects, center[0], center[2]) ?? center[1];
    const group: SceneObject = {
      id: groupId,
      name: options.name ?? `${library.name} Grove`,
      kind: 'empty',
      transform: defaultTransform([center[0], parentY, center[2]]),
    } as SceneObject;
    const children: SceneObject[] = [];
    for (let i = 0; i < count; i += 1) {
      // Sunflower disc: sqrt radius + golden angle covers the area evenly with no rows or rings;
      // the jitter on both terms breaks the spiral so it reads as natural growth, not a pattern.
      const r = radius * Math.sqrt((i + 0.55) / count) * (0.75 + rng() * 0.35);
      const a = i * GOLDEN_ANGLE + rng() * 0.7;
      const x = center[0] + Math.cos(a) * r;
      const z = center[2] + Math.sin(a) * r;
      // Each tree snaps to the ground under ITSELF; local y is relative to the (unrotated,
      // unit-scale) group, so a grove follows a hillside instead of floating off it.
      const ground = highestTerrainWorldHeight(objects, x, z);
      const scale = 0.8 + rng() * 0.45;
      const id = makeId('obj');
      treeIds.push(id);
      children.push({
        id,
        name: `${library.name} ${i + 1}`,
        kind: 'empty',
        parentId: groupId,
        transform: {
          position: [x - center[0], (ground ?? parentY) - parentY, z - center[2]],
          rotation: [0, rng() * Math.PI * 2, 0],
          scale: [scale, scale, scale],
        },
        tree: {
          enabled: true,
          spec: library,
          specId: library.id,
          seed: Math.trunc(rng() * 0xffffffff),
          tintJitter: rng(),
        },
      } as SceneObject);
    }
    return {
      ...mapActiveSceneObjects(state, (existing) => [...existing, group, ...children]),
      selectedObjectId: groupId,
    };
  });
  return { groupId, treeIds };
};

export const applyChopTreeAt = (
  set: SetState,
  get: GetState,
  objectId: string,
  worldPoint: Vector3Tuple,
  direction?: Vector3Tuple,
): string => {
  const object = selectActiveObjects(get()).find((item) => item.id === objectId);
  if (!object) return `No object with id ${objectId}.`;
  if (!object.tree?.enabled) return `Object ${objectId} is not a tree.`;
  const result = chopTree(object, worldPoint, direction ?? [1, 0, 0]);
  if (!result) return `That hit missed every break point on ${object.name}.`;
  if (!result.severed) {
    return `Hit ${object.name} — ${result.hitsLeft} more to sever.`;
  }
  const logs = result.logs ?? [];
  if (logs.length) set((state) => mapActiveSceneObjects(state, (objects) => [...objects, ...logs]));
  return `Felled ${object.name} at break point ${result.breakPointIndex}.`;
};

export const applyCreateModelSpec = (set: SetState, starterId = 'blank', name?: string): string | null => {
  const id = makeId('model');
  const spec = modelSpecFromStarter(starterId, id, name);
  if (!spec) return null;
  set((state) => ({ modelSpecs: [...state.modelSpecs, spec], activeModelSpecId: id, isDirty: true }));
  return id;
};

export const applyUpdateModelSpec = (set: SetState, specId: string, patch: Partial<ModelSpec>): void => {
  set((state) => ({
    modelSpecs: state.modelSpecs.map((spec) =>
      spec.id === specId ? normalizeModelSpec({ ...spec, ...stripUndefined(patch), id: specId }) : spec,
    ),
    isDirty: true,
  }));
};

export const applyDuplicateModelSpec = (set: SetState, specId: string): string => {
  const id = makeId('model');
  set((state) => {
    const source = state.modelSpecs.find((spec) => spec.id === specId);
    if (!source) return state;
    const copy = normalizeModelSpec({
      ...source,
      id,
      name: `${source.name} Copy`,
      parts: source.parts.map((part) => ({ ...part, id: makeId('part') })),
    });
    return { modelSpecs: [...state.modelSpecs, copy], activeModelSpecId: id, isDirty: true };
  });
  return id;
};

export const applyDeleteModelSpec = (set: SetState, specId: string): void => {
  set((state) => {
    const source = state.modelSpecs.find((spec) => spec.id === specId);
    const stamp = (object: SceneObject): SceneObject =>
      object.model?.specId === specId
        ? { ...object, model: { ...object.model, specId: undefined, spec: object.model.spec ?? source } }
        : object;
    return {
      modelSpecs: state.modelSpecs.filter((spec) => spec.id !== specId),
      activeModelSpecId:
        state.activeModelSpecId === specId
          ? state.modelSpecs.find((spec) => spec.id !== specId)?.id ?? ''
          : state.activeModelSpecId,
      // Placed props in EVERY scene keep an inline copy — deleting the asset never deletes their geometry.
      scenes: state.scenes.map((scene) => ({ ...scene, objects: scene.objects.map(stamp) })),
      isDirty: true,
    };
  });
};

export const applySetActiveModelSpec = (set: SetState, specId: string): void => {
  set({ activeModelSpecId: specId });
};

export const applyAddModelPart = (
  set: SetState,
  get: GetState,
  specId: string,
  shape: ModelPartShape,
  init: Partial<Omit<ModelPart, 'id' | 'shape'>> = {},
): string | null => {
  const spec = get().modelSpecs.find((entry) => entry.id === specId);
  if (!spec) return null;
  const part = makeModelPart(shape, init);
  get().updateModelSpec(specId, { parts: [...spec.parts, part] });
  return part.id;
};

export const applyUpdateModelPart = (
  set: SetState,
  get: GetState,
  specId: string,
  partId: string,
  patch: Partial<Omit<ModelPart, 'id'>>,
): boolean => {
  const spec = get().modelSpecs.find((entry) => entry.id === specId);
  if (!spec || !spec.parts.some((part) => part.id === partId)) return false;
  get().updateModelSpec(specId, {
    parts: spec.parts.map((part) => (part.id === partId ? { ...part, ...stripUndefined(patch), id: partId } : part)),
  });
  return true;
};

export const applyRemoveModelPart = (set: SetState, get: GetState, specId: string, partId: string): boolean => {
  const spec = get().modelSpecs.find((entry) => entry.id === specId);
  if (!spec || !spec.parts.some((part) => part.id === partId)) return false;
  get().updateModelSpec(specId, { parts: spec.parts.filter((part) => part.id !== partId) });
  return true;
};

export const applyDuplicateModelPart = (set: SetState, get: GetState, specId: string, partId: string): string | null => {
  const spec = get().modelSpecs.find((entry) => entry.id === specId);
  const source = spec?.parts.find((part) => part.id === partId);
  if (!spec || !source) return null;
  const copy: ModelPart = {
    ...source,
    id: makeId('part'),
    name: `${source.name} Copy`,
    ...(source.faceColors ? { faceColors: { ...source.faceColors } } : {}),
  };
  get().updateModelSpec(specId, { parts: [...spec.parts, copy] });
  return copy.id;
};

export const applyPaintModelPart = (
  set: SetState,
  get: GetState,
  specId: string,
  partId: string,
  colorSlot: number,
  faceGroup?: number,
): boolean => {
  const spec = get().modelSpecs.find((entry) => entry.id === specId);
  const target = spec?.parts.find((part) => part.id === partId);
  if (!spec || !target) return false;
  const slot = Math.min(Math.max(Math.trunc(colorSlot), 0), spec.palette.length - 1);
  // Whole-part paint resets face overrides; painting one face keeps the rest as they were.
  const next: ModelPart =
    faceGroup === undefined
      ? { ...target, colorSlot: slot, faceColors: undefined }
      : { ...target, faceColors: { ...target.faceColors, [Math.trunc(faceGroup)]: slot } };
  get().updateModelSpec(specId, { parts: spec.parts.map((part) => (part.id === partId ? next : part)) });
  return true;
};

export const applySetModelPartCorners = (
  set: SetState,
  get: GetState,
  specId: string,
  partId: string,
  corners: Record<number, Vector3Tuple> | null,
): boolean => {
  const spec = get().modelSpecs.find((entry) => entry.id === specId);
  const target = spec?.parts.find((part) => part.id === partId);
  if (!spec || !target) return false;
  const next: ModelPart = { ...target };
  if (corners && Object.keys(corners).length) next.corners = corners;
  else delete next.corners;
  get().updateModelSpec(specId, { parts: spec.parts.map((part) => (part.id === partId ? next : part)) });
  return true;
};

const findSpecAndPart = (get: GetState, specId: string, partId: string): { spec: ModelSpec; target: ModelPart; index: number } | null => {
  const spec = get().modelSpecs.find((entry) => entry.id === specId);
  if (!spec) return null;
  const index = spec.parts.findIndex((part) => part.id === partId);
  if (index < 0) return null;
  return { spec, target: spec.parts[index], index };
};

const withUpdatedParts = (get: GetState, specId: string, partId: string, toParts: (parts: ModelPart[]) => ModelPart[]) => {
  const found = findSpecAndPart(get, specId, partId);
  if (!found || found.index < 0) return false;
  get().updateModelSpec(specId, {
    parts: toParts(found.spec.parts.map((part) => ({ ...part }))),
  });
  return true;
};

/** Bake a part's exact rendered geometry into a Mesh part. Box corner deformations and all shapes convert. */
export const applyConvertModelPartToMesh = (set: SetState, get: GetState, specId: string, partId: string): boolean => {
  const found = findSpecAndPart(get, specId, partId);
  if (!found || found.index < 0) return false;
  const target = found.target;
  const baked = dedupeGeometryToMesh(getPartRenderGeometry(target));
  return withUpdatedParts(get, specId, partId, (parts) => {
    const part = parts[found.index];
    parts[found.index] = {
      ...part,
      shape: 'mesh',
      mesh: baked,
    };
    delete parts[found.index].corners;
    return parts;
  });
};

/** Move specific mesh vertices (unit space). Keys are vertex indices; only mesh parts accept mutations. */
export const applySetModelPartMeshVertices = (
  set: SetState,
  get: GetState,
  specId: string,
  partId: string,
  updates: Array<[number, Vector3Tuple]>,
): boolean => {
  const found = findSpecAndPart(get, specId, partId);
  if (!found || found.index < 0 || found.target.shape !== 'mesh' || !found.target.mesh) return false;
  return withUpdatedParts(get, specId, partId, (parts) => {
    const part = parts[found.index];
    const vertices = part.mesh!.vertices.map((vertex) => [...vertex] as Vector3Tuple);
    for (const [index, position] of updates) {
      if (Number.isInteger(index) && index >= 0 && index < vertices.length) vertices[index] = position;
    }
    parts[found.index] = { ...part, mesh: { ...part.mesh!, vertices } };
    return parts;
  });
};

/** Extrude selected triangle faces of a Mesh part along their normals. */
export const applyExtrudeModelPartFaces = (
  set: SetState,
  get: GetState,
  specId: string,
  partId: string,
  faceIndices: number[],
  delta = 0.25,
): boolean => {
  const found = findSpecAndPart(get, specId, partId);
  if (!found || found.index < 0 || found.target.shape !== 'mesh' || !found.target.mesh) return false;
  return withUpdatedParts(get, specId, partId, (parts) => {
    const part = parts[found.index];
    parts[found.index] = { ...part, mesh: extrudeMeshFaces(part.mesh!, faceIndices, delta) };
    return parts;
  });
};

/** Midpoint-subdivide selected triangle faces of a Mesh part. */
export const applySubdivideModelPartFaces = (
  set: SetState,
  get: GetState,
  specId: string,
  partId: string,
  faceIndices: number[],
): boolean => {
  const found = findSpecAndPart(get, specId, partId);
  if (!found || found.index < 0 || found.target.shape !== 'mesh' || !found.target.mesh) return false;
  return withUpdatedParts(get, specId, partId, (parts) => {
    const part = parts[found.index];
    parts[found.index] = { ...part, mesh: subdivideMeshFaces(part.mesh!, faceIndices) };
    return parts;
  });
};

/**
 * CSG boolean of two parts; the result lands in the first part (converted to a meshed 'mesh' part), and
 * the other part is removed. The result is expressed in the first part's local frame via its transform.
 */
export const applyBooleanModelParts = (
  set: SetState,
  get: GetState,
  specId: string,
  partId: string,
  otherPartId: string,
  operation: 'union' | 'difference' | 'intersect',
): boolean => {
  if (operation !== 'union' && operation !== 'difference' && operation !== 'intersect') return false;
  const a = findSpecAndPart(get, specId, partId);
  const b = findSpecAndPart(get, specId, otherPartId);
  if (!a || !b || a.index < 0 || b.index < 0 || a.index === b.index) return false;
  const { target: aTarget } = a;
  const { target: bTarget } = b;
  const aMesh = aTarget.shape === 'mesh' ? (aTarget.mesh ?? null) : dedupeGeometryToMesh(getPartRenderGeometry(aTarget));
  const bMesh = bTarget.shape === 'mesh' ? (bTarget.mesh ?? null) : dedupeGeometryToMesh(getPartRenderGeometry(bTarget));
  if (!aMesh || !bMesh) return false;
  const op: MeshBooleanOp = operation === 'difference' ? 'difference' : operation === 'intersect' ? 'intersect' : 'union';
  const result = booleanMeshParts(aMesh, aTarget, bMesh, bTarget, op);
  if (!result || result.indices.length < 3) return false;
  return withUpdatedParts(get, specId, partId, (parts) => {
    const part = parts[a.index];
    parts[a.index] = { ...part, shape: 'mesh', mesh: result };
    delete parts[a.index].corners;
    if (b.index > a.index) parts.splice(b.index, 1);
    else parts.splice(b.index, 1);
    return parts;
  });
};

export const applySetModelPalette = (set: SetState, get: GetState, specId: string, palette: string[]): boolean => {
  const spec = get().modelSpecs.find((entry) => entry.id === specId);
  if (!spec) return false;
  const cleaned = palette.filter((color) => typeof color === 'string' && !!color.trim()).slice(0, 16);
  if (!cleaned.length) return false;
  get().updateModelSpec(specId, { palette: cleaned });
  return true;
};

export const applyCreateModelFromSpec = (
  set: SetState,
  get: GetState,
  specId: string,
  options: { position?: Vector3Tuple; name?: string } = {},
): string | null => {
  const library = get().modelSpecs.find((entry) => entry.id === specId);
  if (!library) return null;
  const id = makeId('obj');
  set((state) => {
    const requested = options.position ?? [0, 0, 0];
    const groundY = highestTerrainWorldHeight(selectActiveObjects(state), requested[0], requested[2]);
    const next: SceneObject = {
      id,
      name: options.name ?? library.name,
      kind: 'empty',
      transform: defaultTransform([requested[0], groundY ?? requested[1], requested[2]]),
      model: { enabled: true, specId },
    } as SceneObject;
    return { ...mapActiveSceneObjects(state, (objects) => [...objects, next]), selectedObjectId: id };
  });
  return id;
};

export const applyAttachModelSpec = (set: SetState, get: GetState, objectId: string, specId: string): boolean => {
  const library = get().modelSpecs.find((entry) => entry.id === specId);
  const object = selectActiveObjects(get()).find((item) => item.id === objectId);
  if (!library || !object) return false;
  set((state) => ({
    ...mapActiveSceneObjects(state, (objects) =>
      objects.map((item) =>
        item.id === objectId ? { ...item, model: { enabled: true, specId } } : item,
      ),
    ),
    activeModelSpecId: specId,
    isDirty: true,
  }));
  return true;
};

export const applyApplyGrassPreset = (set: SetState, get: GetState, id: string, presetId: GrassPresetId): string | null => {
  const preset = GRASS_PRESETS[presetId];
  if (!preset) return null;
  // updateTerrain merges foliage field-by-field, so these four are all that need naming — density,
  // scale, paint mask and the rest of the terrain's foliage setup are left exactly as authored.
  get().updateTerrain(id, {
    foliage: {
      grassSource: 'builtin',
      grassMesh: 'clump',
      grassColor: preset.grassColor,
      stylizedGrass: { ...defaultStylizedGrass(), ...preset.settings },
    } as TerrainComponent['foliage'],
  });
  return preset.label;
};
