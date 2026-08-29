import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import {
  closeWorkspacePanel,
  ensureWorkspacePanel,
  focusWorkspacePanel,
  openWorkspacePanel,
} from '../components/workspacePanels';
import type { SceneObject, SceneObjectKind, TransformComponent, TreeArchetype, Vector3Tuple } from '../types';
import { TREE_ARCHETYPES } from '../tree/treeSpec';
import { STYLIZED_TREE_PRESETS, getStylizedPreset } from '../tree/stylizedPresets';
import { MODEL_STARTERS } from '../model/modelSpec';
import { modelSpecToGlbFile } from '../model/exportModelGlb';
import { FeatherEventBus } from './events';
import type { ExtensionRegistry } from './registry';
import {
  FEATHER_EXTENSION_API_VERSION,
  type FeatherDispose,
  type FeatherModelStarterInfo,
  type FeatherObjectCreateOptions,
  type FeatherPluginAPI,
} from './types';

type TrackDisposer = (disposer: FeatherDispose) => FeatherDispose;

const clone = <T,>(value: T): T => {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
};

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const validVector = (value: Vector3Tuple): boolean =>
  value.length === 3 && value.every((part) => Number.isFinite(part));

const OBJECT_KINDS: ReadonlySet<SceneObjectKind> = new Set([
  'empty',
  'cube',
  'sphere',
  'capsule',
  'plane',
  'terrain',
  'light',
  'camera',
]);

function requireOwnedId(pluginId: string, id: string, kind: string): void {
  if (!id.startsWith(`${pluginId}.`)) {
    throw new Error(`${kind} id "${id}" must start with the plugin namespace "${pluginId}."`);
  }
}

function requireEditableProject(): void {
  const project = useProjectStore.getState();
  if (!project.hasProject) throw new Error('No Feather project is open.');
  if (useEditorStore.getState().isPlaying) throw new Error('Project edits are disabled while Play mode is running.');
}

function findObject(id: string): SceneObject | undefined {
  return selectActiveObjects(useEditorStore.getState()).find((object) => object.id === id);
}

/** Build the capability object handed to one trusted in-process plugin. */
export function createFeatherPluginAPI(
  pluginId: string,
  registry: ExtensionRegistry,
  eventBus: FeatherEventBus,
  track: TrackDisposer,
): FeatherPluginAPI {
  const prefix = `[Feather plugin: ${pluginId}]`;

  const objects: FeatherPluginAPI['objects'] = {
    list: () => clone(selectActiveObjects(useEditorStore.getState())),
    get: (id) => {
      const object = findObject(id);
      return object ? clone(object) : undefined;
    },
    create: (options: FeatherObjectCreateOptions) => {
      requireEditableProject();
      if (!options || !OBJECT_KINDS.has(options.kind)) throw new Error(`Unsupported scene object kind: ${String(options?.kind)}`);
      if (options.name !== undefined && !options.name.trim()) throw new Error('Object names cannot be empty.');
      if (options.position && !validVector(options.position)) throw new Error('Object position must contain three finite numbers.');
      if (options.rotation && !validVector(options.rotation)) throw new Error('Object rotation must contain three finite numbers.');
      if (options.scale && !validVector(options.scale)) throw new Error('Object scale must contain three finite numbers.');
      const store = useEditorStore.getState();
      const id = store.createObjectWithProps(options.kind, {
        name: options.name?.trim(),
        position: options.position,
        color: options.color,
        parentId: options.parentId,
      });
      if (options.rotation) useEditorStore.getState().updateTransform(id, 'rotation', options.rotation);
      if (options.scale) useEditorStore.getState().updateTransform(id, 'scale', options.scale);
      return id;
    },
    rename: (id, name) => {
      requireEditableProject();
      if (!findObject(id)) return false;
      const trimmed = name.trim();
      if (!trimmed) throw new Error('Object names cannot be empty.');
      useEditorStore.getState().renameObject(id, trimmed);
      return true;
    },
    remove: (id) => {
      requireEditableProject();
      if (!findObject(id)) return false;
      useEditorStore.getState().deleteObject(id);
      return true;
    },
    select: (id) => {
      if (!findObject(id)) return false;
      useEditorStore.getState().selectObject(id);
      return true;
    },
    setTransform: (id: string, patch: Partial<TransformComponent>) => {
      requireEditableProject();
      if (!findObject(id)) return false;
      for (const field of ['position', 'rotation', 'scale'] as const) {
        const value = patch[field];
        if (!value) continue;
        if (!validVector(value)) throw new Error(`Object ${field} must contain three finite numbers.`);
        useEditorStore.getState().updateTransform(id, field, value);
      }
      return true;
    },
  };

  const requireArchetype = (archetype: TreeArchetype): void => {
    if (!TREE_ARCHETYPES[archetype]) throw new Error(`Unknown tree archetype: ${String(archetype)}`);
  };
  /**
   * The library entry a preset maps to — reused by name+archetype so repeated placements from one
   * preset share a single asset instead of filling the library with copies.
   */
  const resolvePresetSpecId = (presetId: string): string => {
    const preset = getStylizedPreset(presetId);
    if (!preset) throw new Error(`Unknown stylized tree preset: ${presetId}`);
    const existing = useEditorStore
      .getState()
      .treeSpecs.find((entry) => entry.name === preset.name && entry.archetype === preset.archetype);
    const id = existing?.id ?? useEditorStore.getState().createTreeSpecFromPreset(presetId);
    if (!id) throw new Error(`Unknown stylized tree preset: ${presetId}`);
    return id;
  };

  const trees: FeatherPluginAPI['trees'] = {
    library: () => clone(useEditorStore.getState().treeSpecs),
    presets: () => STYLIZED_TREE_PRESETS,
    addPreset: (presetId, name) => {
      requireEditableProject();
      const id = useEditorStore.getState().createTreeSpecFromPreset(presetId, name);
      if (!id) throw new Error(`Unknown stylized tree preset: ${presetId}`);
      return id;
    },
    addArchetype: (archetype, name) => {
      requireEditableProject();
      requireArchetype(archetype);
      return useEditorStore.getState().createTreeSpec(archetype, name);
    },
    updateSpec: (specId, patch) => {
      requireEditableProject();
      if (!useEditorStore.getState().treeSpecs.some((entry) => entry.id === specId)) return false;
      useEditorStore.getState().updateTreeSpec(specId, patch);
      return true;
    },
    place: (options = {}) => {
      requireEditableProject();
      if (options.position && !validVector(options.position)) {
        throw new Error('Tree position must contain three finite numbers.');
      }
      const store = useEditorStore.getState();
      const placement = { position: options.position, seed: options.seed, name: options.name };
      if (options.specId) {
        const id = store.createTreeFromSpec(options.specId, placement);
        if (!id) throw new Error(`No tree asset with id ${options.specId}.`);
        return id;
      }
      if (options.presetId) {
        const id = useEditorStore.getState().createTreeFromSpec(resolvePresetSpecId(options.presetId), placement);
        if (!id) throw new Error(`Unknown stylized tree preset: ${options.presetId}`);
        return id;
      }
      if (options.archetype) {
        requireArchetype(options.archetype);
        return store.createTree(options.archetype, placement);
      }
      throw new Error('trees.place needs one of specId, presetId or archetype.');
    },
    plantGrove: (options = {}) => {
      requireEditableProject();
      if (options.position && !validVector(options.position)) {
        throw new Error('Grove position must contain three finite numbers.');
      }
      const result = useEditorStore.getState().plantGrove(options);
      if (!result) throw new Error('Could not plant the grove — no matching tree asset, preset or archetype.');
      return result;
    },
  };

  const requireModelSpec = (specId: string) => {
    const spec = useEditorStore.getState().modelSpecs.find((entry) => entry.id === specId);
    if (!spec) throw new Error(`No prototype-model asset with id ${specId}.`);
    return spec;
  };
  const starterInfos: readonly FeatherModelStarterInfo[] = Object.freeze(
    MODEL_STARTERS.map(({ id, name, tagline }) => Object.freeze({ id, name, tagline })),
  );

  const models: FeatherPluginAPI['models'] = {
    library: () => clone(useEditorStore.getState().modelSpecs),
    starters: () => starterInfos,
    createFromStarter: (starterId, name) => {
      requireEditableProject();
      const id = useEditorStore.getState().createModelSpec(starterId, name);
      if (!id) throw new Error(`Unknown model starter kit: ${starterId}`);
      return id;
    },
    updateSpec: (specId, patch) => {
      requireEditableProject();
      if (!useEditorStore.getState().modelSpecs.some((entry) => entry.id === specId)) return false;
      useEditorStore.getState().updateModelSpec(specId, patch);
      return true;
    },
    duplicateSpec: (specId) => {
      requireEditableProject();
      requireModelSpec(specId);
      return useEditorStore.getState().duplicateModelSpec(specId);
    },
    deleteSpec: (specId) => {
      requireEditableProject();
      if (!useEditorStore.getState().modelSpecs.some((entry) => entry.id === specId)) return false;
      useEditorStore.getState().deleteModelSpec(specId);
      return true;
    },
    addPart: (specId, shape, init) => {
      requireEditableProject();
      requireModelSpec(specId);
      const partId = useEditorStore.getState().addModelPart(specId, shape, init);
      if (!partId) throw new Error(`No prototype-model asset with id ${specId}.`);
      return partId;
    },
    updatePart: (specId, partId, patch) => {
      requireEditableProject();
      return useEditorStore.getState().updateModelPart(specId, partId, patch);
    },
    removePart: (specId, partId) => {
      requireEditableProject();
      return useEditorStore.getState().removeModelPart(specId, partId);
    },
    duplicatePart: (specId, partId) => {
      requireEditableProject();
      const copyId = useEditorStore.getState().duplicateModelPart(specId, partId);
      if (!copyId) throw new Error(`No such model part (${specId} / ${partId}).`);
      return copyId;
    },
    paintPart: (specId, partId, colorSlot, faceGroup) => {
      requireEditableProject();
      return useEditorStore.getState().paintModelPart(specId, partId, colorSlot, faceGroup);
    },
    setPartCorners: (specId, partId, corners) => {
      requireEditableProject();
      return useEditorStore.getState().setModelPartCorners(specId, partId, corners);
    },
    convertPartToMesh: (specId, partId) => {
      requireEditableProject();
      return useEditorStore.getState().convertModelPartToMesh(specId, partId);
    },
    setPartMeshVertices: (specId, partId, updates) => {
      requireEditableProject();
      return useEditorStore.getState().setModelPartMeshVertices(specId, partId, updates);
    },
    extrudePartFaces: (specId, partId, faceIndices, delta) => {
      requireEditableProject();
      return useEditorStore.getState().extrudeModelPartFaces(specId, partId, faceIndices, delta);
    },
    subdividePartFaces: (specId, partId, faceIndices) => {
      requireEditableProject();
      return useEditorStore.getState().subdivideModelPartFaces(specId, partId, faceIndices);
    },
    booleanParts: (specId, partId, otherPartId, operation) => {
      requireEditableProject();
      return useEditorStore.getState().booleanModelParts(specId, partId, otherPartId, operation);
    },
    setPalette: (specId, palette) => {
      requireEditableProject();
      return useEditorStore.getState().setModelPalette(specId, palette);
    },
    place: (specId, options = {}) => {
      requireEditableProject();
      if (options.position && !validVector(options.position)) {
        throw new Error('Model position must contain three finite numbers.');
      }
      const id = useEditorStore.getState().createModelFromSpec(specId, options);
      if (!id) throw new Error(`No prototype-model asset with id ${specId}.`);
      return id;
    },
    bakeToAsset: async (specId) => {
      requireEditableProject();
      const spec = requireModelSpec(specId);
      const file = await modelSpecToGlbFile(spec);
      useEditorStore.getState().addAssets([file]);
      return { fileName: file.name };
    },
  };

  const commands: FeatherPluginAPI['commands'] = Object.freeze({
    register: (definition) => {
      requireOwnedId(pluginId, definition.id, 'Command');
      return track(registry.registerCommand(pluginId, definition));
    },
  });
  const panels: FeatherPluginAPI['panels'] = Object.freeze({
    register: (definition) => {
      requireOwnedId(pluginId, definition.id, 'Panel');
      const unregister = registry.registerPanel(pluginId, definition);
      return track(() => {
        closeWorkspacePanel(definition.id);
        unregister();
      });
    },
    open: (id) => {
      const panel = registry.getPanel(id);
      if (panel) return openWorkspacePanel(panel);
      // Not a plugin panel — try the editor's built-in workspace panels ('trees', 'terrain', …),
      // so a plugin can hand the user over to a full editor it just prepared.
      if (!ensureWorkspacePanel(id)) return false;
      focusWorkspacePanel(id);
      return true;
    },
  });
  const events: FeatherPluginAPI['events'] = Object.freeze({
    on: (event, handler) => track(eventBus.on(event, handler)),
  });
  const project: FeatherPluginAPI['project'] = Object.freeze({
    read: () => {
      const projectState = useProjectStore.getState();
      if (!projectState.hasProject) throw new Error('No Feather project is open.');
      return clone({
        ...useEditorStore.getState().exportProject(),
        name: projectState.projectName,
      });
    },
    transaction: <T,>(label: string, action: () => T): T => {
      requireEditableProject();
      if (!label.trim()) throw new Error('Project transaction labels cannot be empty.');
      try {
        const result = eventBus.batch(action);
        if (result && typeof (result as { then?: unknown }).then === 'function') {
          throw new Error('Project transactions must be synchronous.');
        }
        return result;
      } catch (error) {
        console.error(prefix, `Transaction "${label}" failed: ${errorMessage(error)}`);
        throw error;
      }
    },
  });
  const ui: FeatherPluginAPI['ui'] = Object.freeze({
    notify: (message, kind = 'success') => {
      useProjectStore.setState({ toast: { kind, message } });
    },
  });
  const log: FeatherPluginAPI['log'] = Object.freeze({
    info: (message, ...details) => console.info(prefix, message, ...details),
    warn: (message, ...details) => console.warn(prefix, message, ...details),
    error: (message, ...details) => console.error(prefix, message, ...details),
  });

  return Object.freeze({
    apiVersion: FEATHER_EXTENSION_API_VERSION,
    pluginId,
    commands,
    panels,
    events,
    project,
    objects: Object.freeze(objects),
    trees: Object.freeze(trees),
    models: Object.freeze(models),
    ui,
    log,
  });
}
