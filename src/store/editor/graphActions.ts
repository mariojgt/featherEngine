import type { Connection, Edge, EdgeChange, NodeChange } from '@xyflow/react';
import { addEdge, applyEdgeChanges, applyNodeChanges, reconnectEdge } from '@xyflow/react';
import type { StoreApi } from 'zustand';
import type { EditorState } from '../editorStore';
import { invalidateFeatherSourceForGraph, invalidateFeatherSourceForGraphs } from '../editorStore';
import { canUseHostOnlyFeatures } from '../../collaboration/access';
import { compileFeatherScriptToGraph, type FeatherCompileResult } from '../../scripting/featherCompiler';
import { beginReplay, endReplay } from '../../runtime/replayRecorder';
import { toggleBreakpoint } from '../../runtime/execTrace';
import {
  defaultParticleConfig,
  particlePresets,
  type ParticlePresetId,
} from '../../runtime/particlePresets';
import {
  cloneGraphValue,
  coerceGraphValue,
  defaultValueForType,
  makeMaterialGraph,
  makeNodeData,
  mapGraphById,
  normalizeNodeData,
  seedNodeDataFromProject,
} from './graph';
import { layoutGraphNodes } from './graphRuntime';
import { sanitizeGraph } from './graphDiagnostics';
import { isGraphConnectionValid } from './wireTypes';
import { mapActiveSceneObjects, selectActiveObjects } from './storeHelpers';
import { applyRuntimeTick } from './tickRuntime';
import { makeId, stripUndefined } from './ids';
import { seedBlueprintInstanceVars } from './objectFactory';
import type {
  BlueprintVariable,
  DataAssetColumn,
  DataAssetRow,
  GraphNodeCategory,
  GraphValue,
  GraphValueType,
  MaterialDefinition,
  NodeForgeNode,
  NodeForgeNodeData,
  ParticleConfig,
  ProjectVariable,
  ScriptBlueprint,
  ProjectGraph,
} from '../../types';

type SetState = StoreApi<EditorState>['setState'];
type GetState = StoreApi<EditorState>['getState'];

export const applyAttachScript = (set: SetState, id: string, nextBlueprintId?: string): void => {
  set((state) => {
    const blueprint = state.blueprints.find((item) => item.id === (nextBlueprintId ?? state.activeBlueprintId));
    if (!blueprint) return state;
    return {
      ...mapActiveSceneObjects(state, (objects) =>
        objects.map((object) =>
          object.id === id
            ? {
                ...object,
                script: { blueprintId: blueprint.id, graphId: blueprint.graphId, enabled: true },
                variables: seedBlueprintInstanceVars(object.variables, blueprint),
              }
            : object,
        ),
      ),
      activeBlueprintId: blueprint.id,
    };
  });
};

export const applyAddBlueprintVariable = (
  set: SetState,
  get: GetState,
  blueprintId: string,
  opts: { name?: string; type?: GraphValueType; defaultValue?: GraphValue } = {},
): string | undefined => {
  const blueprint = get().blueprints.find((b) => b.id === blueprintId);
  if (!blueprint) return undefined;
  const type = opts.type ?? 'number';
  const id = makeId('bpvar');
  const existing = blueprint.variables ?? [];
  const variable: BlueprintVariable = {
    id,
    name: opts.name?.trim() || `Var ${existing.length + 1}`,
    type,
    defaultValue: opts.defaultValue !== undefined ? coerceGraphValue(opts.defaultValue, type) : defaultValueForType(type),
  };
  set((state) => ({
    blueprints: invalidateFeatherSourceForGraph(
      state.blueprints.map((b) => (b.id === blueprintId ? { ...b, variables: [...existing, variable] } : b)),
      blueprint.graphId,
    ),
    ...mapActiveSceneObjects(state, (objects) =>
      objects.map((object) =>
        object.script?.blueprintId === blueprintId && object.variables?.[variable.name] === undefined
          ? { ...object, variables: { ...(object.variables ?? {}), [variable.name]: cloneGraphValue(variable.defaultValue) } }
          : object,
      ),
    ),
    isDirty: true,
  }));
  return id;
};

export const applyUpdateBlueprintVariable = (
  set: SetState,
  blueprintId: string,
  variableId: string,
  patch: { name?: string; type?: GraphValueType; defaultValue?: GraphValue },
): void => {
  set((state) => {
    const blueprint = state.blueprints.find((b) => b.id === blueprintId);
    const current = blueprint?.variables?.find((v) => v.id === variableId);
    if (!blueprint || !current) return state;
    const type = patch.type ?? current.type;
    const nextName = patch.name?.trim() || current.name;
    const defaultValue =
      patch.defaultValue !== undefined ? coerceGraphValue(patch.defaultValue, type) : coerceGraphValue(current.defaultValue, type);
    const renamed = nextName !== current.name;
    return {
      blueprints: invalidateFeatherSourceForGraph(
        state.blueprints.map((b) =>
          b.id === blueprintId
            ? {
                ...b,
                variables: (b.variables ?? []).map((v) =>
                  v.id === variableId ? { ...v, name: nextName, type, defaultValue } : v,
                ),
              }
            : b,
        ),
        blueprint.graphId,
      ),
      ...(renamed
        ? mapActiveSceneObjects(state, (objects) =>
            objects.map((object) => {
              if (object.script?.blueprintId !== blueprintId || object.variables?.[current.name] === undefined) return object;
              const { [current.name]: held, ...rest } = object.variables;
              return { ...object, variables: { ...rest, [nextName]: held } };
            }),
          )
        : {}),
      isDirty: true,
    };
  });
};

export const applyRemoveBlueprintVariable = (set: SetState, blueprintId: string, variableId: string): void => {
  set((state) => {
    const blueprint = state.blueprints.find((b) => b.id === blueprintId);
    const removed = blueprint?.variables?.find((v) => v.id === variableId);
    if (!blueprint || !removed) return state;
    return {
      blueprints: invalidateFeatherSourceForGraph(
        state.blueprints.map((b) =>
          b.id === blueprintId ? { ...b, variables: (b.variables ?? []).filter((v) => v.id !== variableId) } : b,
        ),
        blueprint.graphId,
      ),
      isDirty: true,
    };
  });
};

export const applyDetachScript = (set: SetState, id: string): void => {
  set((state) =>
    mapActiveSceneObjects(state, (objects) =>
      objects.map((object) => (object.id === id ? { ...object, script: undefined } : object)),
    ),
  );
};

export const applySetActiveBlueprint = (set: SetState, activeBlueprintId: string): void => {
  set({ activeBlueprintId, selectedGraphNodeId: undefined });
};

export const applyCreateBlueprint = (set: SetState): void => {
  set((state) => {
    const nextIndex = state.blueprints.length + 1;
    const newGraphId = makeId('graph');
    const newBlueprintId = makeId('blueprint');
    const blueprint: ScriptBlueprint = {
      id: newBlueprintId,
      name: `Blueprint ${nextIndex}`,
      description: 'Reusable Blueprint asset.',
      graphId: newGraphId,
      color: '#3DDC97',
      createdAt: Date.now(),
    };
    const graph: ProjectGraph = {
      id: newGraphId,
      name: blueprint.name,
      nodes: [
        {
          id: makeId('node'),
          type: 'nodeforge',
          position: { x: 80, y: 80 },
          data: makeNodeData('Start', 'Events', { hasInput: false }),
        },
        {
          id: makeId('node'),
          type: 'nodeforge',
          position: { x: 280, y: 80 },
          data: makeNodeData('Update', 'Events'),
        },
      ],
      edges: [],
    };

    return {
      blueprints: [...state.blueprints, blueprint],
      graphs: [...state.graphs, graph],
      activeBlueprintId: newBlueprintId,
      selectedGraphNodeId: graph.nodes[0]?.id,
      isDirty: true,
    };
  });
};

export const applyCreateBlueprintNamed = (
  set: SetState,
  name?: string,
  description?: string,
  folderId?: string,
): { blueprintId: string; graphId: string } => {
  const newGraphId = makeId('graph');
  const newBlueprintId = makeId('blueprint');
  set((state) => {
    const blueprint: ScriptBlueprint = {
      id: newBlueprintId,
      name: name ?? `Blueprint ${state.blueprints.length + 1}`,
      description: description ?? 'Reusable Blueprint asset.',
      graphId: newGraphId,
      color: '#3DDC97',
      folderId,
      createdAt: Date.now(),
    };
    const graph: ProjectGraph = {
      id: newGraphId,
      name: blueprint.name,
      nodes: [
        {
          id: makeId('node'),
          type: 'nodeforge',
          position: { x: 80, y: 80 },
          data: makeNodeData('Start', 'Events', { hasInput: false }),
        },
        {
          id: makeId('node'),
          type: 'nodeforge',
          position: { x: 280, y: 80 },
          data: makeNodeData('Update', 'Events'),
        },
      ],
      edges: [],
    };

    return {
      blueprints: [...state.blueprints, blueprint],
      graphs: [...state.graphs, graph],
      activeBlueprintId: newBlueprintId,
      selectedGraphNodeId: undefined,
      isDirty: true,
    };
  });
  return { blueprintId: newBlueprintId, graphId: newGraphId };
};

export const applyOpenObjectScript = (set: SetState, get: GetState, objectId: string): string | undefined => {
  const object = selectActiveObjects(get()).find((item) => item.id === objectId);
  if (!object) return undefined;
  if (object.script) {
    set({ activeBlueprintId: object.script.blueprintId, selectedObjectId: objectId, selectedGraphNodeId: undefined });
    return object.script.blueprintId;
  }
  const { blueprintId } = get().createBlueprintNamed(`${object.name} Script`, `Script for ${object.name}.`);
  get().attachScript(objectId, blueprintId);
  set({ selectedObjectId: objectId });
  return blueprintId;
};

export const applyCreateFolder = (set: SetState, name?: string, parentId?: string): string => {
  const id = makeId('folder');
  set((state) => ({
    folders: [...state.folders, { id, name: name ?? 'New Folder', parentId }],
    isDirty: true,
  }));
  return id;
};

export const applyRenameFolder = (set: SetState, id: string, name: string): void => {
  set((state) => ({
    folders: state.folders.map((folder) => (folder.id === id ? { ...folder, name } : folder)),
    isDirty: true,
  }));
};

export const applyDeleteFolder = (set: SetState, id: string): void => {
  set((state) => {
    const folder = state.folders.find((item) => item.id === id);
    if (!folder) return state;
    const parentId = folder.parentId;
    return {
      folders: state.folders
        .filter((item) => item.id !== id)
        .map((item) => (item.parentId === id ? { ...item, parentId } : item)),
      assets: state.assets.map((asset) => (asset.folderId === id ? { ...asset, folderId: parentId } : asset)),
      dataAssets: state.dataAssets.map((asset) => (asset.folderId === id ? { ...asset, folderId: parentId } : asset)),
      materials: state.materials.map((material) =>
        material.folderId === id ? { ...material, folderId: parentId } : material,
      ),
      blueprints: state.blueprints.map((blueprint) =>
        blueprint.folderId === id ? { ...blueprint, folderId: parentId } : blueprint,
      ),
      prefabs: state.prefabs.map((prefab) =>
        prefab.folderId === id ? { ...prefab, folderId: parentId } : prefab,
      ),
      isDirty: true,
    };
  });
};

export const applyMoveToFolder = (
  set: SetState,
  kind: 'asset' | 'blueprint' | 'dataAsset' | 'material' | 'particleSystem' | 'uiDocument' | 'prefab',
  id: string,
  folderId?: string,
): void => {
  set((state) =>
    kind === 'asset'
      ? {
          assets: state.assets.map((asset) => (asset.id === id ? { ...asset, folderId } : asset)),
          isDirty: true,
        }
      : kind === 'dataAsset'
        ? {
            dataAssets: state.dataAssets.map((asset) => (asset.id === id ? { ...asset, folderId } : asset)),
            isDirty: true,
          }
      : kind === 'material'
        ? {
            materials: state.materials.map((material) => (material.id === id ? { ...material, folderId } : material)),
            isDirty: true,
          }
      : kind === 'particleSystem'
        ? {
            particleSystems: state.particleSystems.map((system) => (system.id === id ? { ...system, folderId } : system)),
            isDirty: true,
          }
      : kind === 'uiDocument'
        ? {
            uiDocuments: state.uiDocuments.map((doc) => (doc.id === id ? { ...doc, folderId } : doc)),
            isDirty: true,
          }
      : kind === 'prefab'
        ? {
            prefabs: state.prefabs.map((prefab) => (prefab.id === id ? { ...prefab, folderId } : prefab)),
            isDirty: true,
          }
      : {
          blueprints: state.blueprints.map((blueprint) =>
            blueprint.id === id ? { ...blueprint, folderId } : blueprint,
          ),
          isDirty: true,
        },
  );
};

export const applyRenameBlueprint = (set: SetState, id: string, name: string): void => {
  set((state) => {
    const blueprint = state.blueprints.find((item) => item.id === id);
    if (!blueprint) return state;
    const affectedGraphIds = new Set([
      blueprint.graphId,
      ...state.graphs
        .filter((graph) => graph.nodes.some((node) => node.data.castBlueprintId === id))
        .map((graph) => graph.id),
    ]);
    return {
      blueprints: invalidateFeatherSourceForGraphs(
        state.blueprints.map((item) => (item.id === id ? { ...item, name } : item)),
        affectedGraphIds,
      ),
      graphs: state.graphs.map((graph) => (graph.id === blueprint.graphId ? { ...graph, name } : graph)),
      isDirty: true,
    };
  });
};

export const applyUpdateBlueprintFeatherSource = (set: SetState, id: string, source?: string): void => {
  set((state) => ({
    blueprints: state.blueprints.map((item) =>
      item.id === id
        ? {
            ...item,
            featherSource: source,
            ...(source === undefined ? { featherSourceLastSynced: undefined } : {}),
          }
        : item,
    ),
    isDirty: true,
  }));
};

export const applyUpdateBlueprintFeatherExternalLink = (
  set: SetState,
  id: string,
  link?: { path: string; lastSyncedHash?: string; lastSyncedVisualHash?: string },
): void => {
  set((state) =>
    canUseHostOnlyFeatures()
      ? {
          blueprints: state.blueprints.map((item) =>
            item.id === id
              ? {
                  ...item,
                  featherSourcePath: link?.path,
                  featherSourceLastSyncedHash: link?.lastSyncedHash,
                  featherSourceLastSyncedVisualHash: link?.lastSyncedVisualHash,
                }
              : item,
          ),
          isDirty: true,
        }
      : state,
  );
};

export const applySyncBlueprintFeatherSource = (set: SetState, get: GetState, id: string, source: string): FeatherCompileResult => {
  const state = get();
  const blueprint = state.blueprints.find((item) => item.id === id);
  const graph = state.graphs.find((item) => item.id === blueprint?.graphId);
  if (!blueprint || !graph) {
    return {
      ok: false,
      diagnostics: [{ severity: 'error', message: 'Blueprint graph not found.', line: 1, column: 1, length: 1 }],
    };
  }
  const result = compileFeatherScriptToGraph({ source, blueprint, graph, variables: state.variables, blueprints: state.blueprints, preserveSource: true });
  if (!result.ok || !result.graph || !result.blueprint) return result;
  set((current) => {
    let blueprints = current.blueprints.map((item) =>
      item.id === id ? { ...result.blueprint!, featherSourceLastSynced: source } : item,
    );
    if (result.blueprint!.name !== blueprint.name) {
      const dependentGraphIds = new Set(
        current.graphs
          .filter((item) => item.id !== graph.id)
          .filter((item) => item.nodes.some((node) => node.data.castBlueprintId === id))
          .map((item) => item.id),
      );
      blueprints = invalidateFeatherSourceForGraphs(blueprints, dependentGraphIds);
    }
    return {
      blueprints,
      graphs: current.graphs.map((item) => (item.id === graph.id ? result.graph! : item)),
      selectedGraphNodeId: undefined,
      isDirty: true,
    };
  });
  return result;
};

export const applyApplyBlueprintFeatherSource = (set: SetState, get: GetState, id: string, source: string): FeatherCompileResult => {
  const state = get();
  const blueprint = state.blueprints.find((item) => item.id === id);
  const graph = state.graphs.find((item) => item.id === blueprint?.graphId);
  if (!blueprint || !graph) {
    return {
      ok: false,
      diagnostics: [{ severity: 'error', message: 'Blueprint graph not found.', line: 1, column: 1, length: 1 }],
    };
  }
  const result = compileFeatherScriptToGraph({ source, blueprint, graph, variables: state.variables, blueprints: state.blueprints });
  if (!result.ok || !result.graph || !result.blueprint) return result;
  set((current) => {
    let blueprints = current.blueprints.map((item) =>
      item.id === id
        ? { ...result.blueprint!, featherSource: undefined, featherSourceLastSynced: undefined }
        : item,
    );
    if (result.blueprint!.name !== blueprint.name) {
      const dependentGraphIds = new Set(
        current.graphs
          .filter((item) => item.id !== graph.id)
          .filter((item) => item.nodes.some((node) => node.data.castBlueprintId === id))
          .map((item) => item.id),
      );
      blueprints = invalidateFeatherSourceForGraphs(blueprints, dependentGraphIds);
    }
    return {
      blueprints,
      graphs: current.graphs.map((item) => (item.id === graph.id ? result.graph! : item)),
      selectedGraphNodeId: undefined,
      isDirty: true,
    };
  });
  return result;
};

export const applyDeleteBlueprint = (set: SetState, id: string): void => {
  set((state) => {
    const blueprint = state.blueprints.find((item) => item.id === id);
    if (!blueprint) return state;
    const dependentGraphIds = new Set(
      state.graphs
        .filter((graph) => graph.id !== blueprint.graphId)
        .filter((graph) => graph.nodes.some((node) => node.data.castBlueprintId === id))
        .map((graph) => graph.id),
    );
    const remaining = invalidateFeatherSourceForGraphs(
      state.blueprints.filter((item) => item.id !== id),
      dependentGraphIds,
    );
    return {
      blueprints: remaining,
      graphs: state.graphs.filter((graph) => graph.id !== blueprint.graphId),
      activeBlueprintId: state.activeBlueprintId === id ? remaining[0]?.id ?? '' : state.activeBlueprintId,
      scenes: state.scenes.map((scene) => ({
        ...scene,
        objects: scene.objects.map((object) =>
          object.script?.blueprintId === id ? { ...object, script: undefined } : object,
        ),
      })),
      prefabs: state.prefabs.map((prefab) =>
        prefab.objects.some((object) => object.script?.blueprintId === id)
          ? {
              ...prefab,
              objects: prefab.objects.map((object) =>
                object.script?.blueprintId === id ? { ...object, script: undefined } : object,
              ),
            }
          : prefab,
      ),
      isDirty: true,
    };
  });
};

export const applyRenameAsset = (set: SetState, id: string, name: string): void => {
  set((state) => ({
    assets: state.assets.map((asset) => (asset.id === id ? { ...asset, name } : asset)),
    isDirty: true,
  }));
};

export const applyCreateVariable = (set: SetState, name?: string, type: GraphValueType = 'number', persistent = true): string => {
  const id = makeId('var');
  set((state) => ({
    variables: [
      ...state.variables,
      {
        id,
        name: name ?? `Variable ${state.variables.length + 1}`,
        type,
        defaultValue: defaultValueForType(type),
        persistent,
        createdAt: Date.now(),
      },
    ],
    isDirty: true,
  }));
  return id;
};

export const applyUpdateVariable = (
  set: SetState,
  id: string,
  patch: Partial<Pick<ProjectVariable, 'name' | 'type' | 'defaultValue' | 'persistent'>>,
): void => {
  set((state) => {
    const currentVariable = state.variables.find((variable) => variable.id === id);
    const nameChanged =
      patch.name !== undefined && currentVariable !== undefined && patch.name !== currentVariable.name;
    const affectedGraphIds = nameChanged
      ? new Set(
          state.graphs
            .filter((graph) => graph.nodes.some((node) => node.data.variableId === id))
            .map((graph) => graph.id),
        )
      : new Set<string>();
    return {
      blueprints: invalidateFeatherSourceForGraphs(state.blueprints, affectedGraphIds),
      variables: state.variables.map((variable) => {
        if (variable.id !== id) return variable;
        const type = patch.type ?? variable.type;
        const defaultValue =
          patch.defaultValue !== undefined
            ? coerceGraphValue(patch.defaultValue, type)
            : patch.type
              ? coerceGraphValue(variable.defaultValue, type)
              : variable.defaultValue;
        return {
          ...variable,
          ...patch,
          type,
          defaultValue,
        };
      }),
      runtimeVariableValues:
        patch.defaultValue !== undefined || patch.type
          ? Object.fromEntries(
              Object.entries(state.runtimeVariableValues).map(([variableId, value]) => [
                variableId,
                variableId === id
                  ? coerceGraphValue(
                      patch.defaultValue ?? value,
                      patch.type ?? state.variables.find((variable) => variable.id === id)?.type ?? 'number',
                    )
                  : value,
              ]),
            )
          : state.runtimeVariableValues,
      isDirty: true,
    };
  });
};

export const applyDeleteVariable = (set: SetState, id: string): void => {
  set((state) => {
    const affectedGraphIds = new Set(
      state.graphs
        .filter((graph) => graph.nodes.some((node) => node.data.variableId === id))
        .map((graph) => graph.id),
    );
    return {
      blueprints: invalidateFeatherSourceForGraphs(state.blueprints, affectedGraphIds),
      variables: state.variables.filter((variable) => variable.id !== id),
      runtimeVariableValues: Object.fromEntries(
        Object.entries(state.runtimeVariableValues).filter(([variableId]) => variableId !== id),
      ),
      graphs: state.graphs.map((graph) => ({
        ...graph,
        nodes: graph.nodes.map((node) =>
          node.data.variableId === id ? { ...node, data: { ...node.data, variableId: undefined } } : node,
        ),
      })),
      isDirty: true,
    };
  });
};

export const applyCreateDataAsset = (set: SetState, name?: string, folderId?: string): string => {
  const id = makeId('data');
  const columnId = makeId('col');
  const rowId = makeId('row');
  set((state) => ({
    dataAssets: [
      ...state.dataAssets,
      {
        id,
        name: name ?? `Data Asset ${state.dataAssets.length + 1}`,
        folderId,
        columns: [{ id: columnId, name: 'Value', type: 'string' }],
        rows: [{ id: rowId, key: 'row_1', values: { [columnId]: 'Text' } }],
        createdAt: Date.now(),
      },
    ],
    isDirty: true,
  }));
  return id;
};

export const applyRenameDataAsset = (set: SetState, id: string, name: string): void => {
  set((state) => ({
    dataAssets: state.dataAssets.map((table) => (table.id === id ? { ...table, name } : table)),
    isDirty: true,
  }));
};

export const applyDeleteDataAsset = (set: SetState, id: string): void => {
  set((state) => {
    const affectedGraphIds = new Set(
      state.graphs
        .filter((graph) => graph.nodes.some((node) => node.data.tableId === id))
        .map((graph) => graph.id),
    );
    return {
      blueprints: invalidateFeatherSourceForGraphs(state.blueprints, affectedGraphIds),
      dataAssets: state.dataAssets.filter((table) => table.id !== id),
      graphs: state.graphs.map((graph) => ({
        ...graph,
        nodes: graph.nodes.map((node) =>
          node.data.tableId === id
            ? { ...node, data: normalizeNodeData({ ...node.data, tableId: undefined, rowKey: undefined, columnId: undefined }) }
            : node,
        ),
      })),
      isDirty: true,
    };
  });
};

export const applyAddDataAssetColumn = (set: SetState, tableId: string, name?: string, type: GraphValueType = 'string'): string => {
  const id = makeId('col');
  set((state) => ({
    dataAssets: state.dataAssets.map((table) =>
      table.id === tableId
        ? {
            ...table,
            columns: [...table.columns, { id, name: name ?? `Column ${table.columns.length + 1}`, type }],
            rows: table.rows.map((row) => ({
              ...row,
              values: { ...row.values, [id]: defaultValueForType(type) },
            })),
          }
        : table,
    ),
    isDirty: true,
  }));
  return id;
};

export const applyUpdateDataAssetColumn = (
  set: SetState,
  tableId: string,
  columnId: string,
  patch: Partial<Pick<DataAssetColumn, 'name' | 'type'>>,
): void => {
  set((state) => ({
    dataAssets: state.dataAssets.map((table) => {
      if (table.id !== tableId) return table;
      const current = table.columns.find((column) => column.id === columnId);
      const nextType = patch.type ?? current?.type ?? 'string';
      return {
        ...table,
        columns: table.columns.map((column) =>
          column.id === columnId ? { ...column, ...patch, type: nextType } : column,
        ),
        rows: table.rows.map((row) => ({
          ...row,
          values:
            patch.type && current
              ? { ...row.values, [columnId]: coerceGraphValue(row.values[columnId], nextType) }
              : row.values,
        })),
      };
    }),
    isDirty: true,
  }));
};

export const applyDeleteDataAssetColumn = (set: SetState, tableId: string, columnId: string): void => {
  set((state) => {
    const affectedGraphIds = new Set(
      state.graphs
        .filter((graph) =>
          graph.nodes.some(
            (node) => node.data.tableId === tableId && node.data.columnId === columnId,
          ),
        )
        .map((graph) => graph.id),
    );
    return {
      blueprints: invalidateFeatherSourceForGraphs(state.blueprints, affectedGraphIds),
      dataAssets: state.dataAssets.map((table) =>
        table.id === tableId
          ? {
              ...table,
              columns: table.columns.filter((column) => column.id !== columnId),
              rows: table.rows.map((row) => {
                const { [columnId]: _deleted, ...values } = row.values;
                return { ...row, values };
              }),
            }
          : table,
      ),
      graphs: state.graphs.map((graph) => ({
        ...graph,
        nodes: graph.nodes.map((node) =>
          node.data.tableId === tableId && node.data.columnId === columnId
            ? { ...node, data: normalizeNodeData({ ...node.data, columnId: undefined }) }
            : node,
        ),
      })),
      isDirty: true,
    };
  });
};

export const applyAddDataAssetRow = (set: SetState, tableId: string, key?: string): string => {
  const id = makeId('row');
  set((state) => ({
    dataAssets: state.dataAssets.map((table) =>
      table.id === tableId
        ? {
            ...table,
            rows: [
              ...table.rows,
              {
                id,
                key: key ?? `row_${table.rows.length + 1}`,
                values: Object.fromEntries(
                  table.columns.map((column) => [column.id, defaultValueForType(column.type)]),
                ) as Record<string, GraphValue>,
              },
            ],
          }
        : table,
    ),
    isDirty: true,
  }));
  return id;
};

export const applyUpdateDataAssetRow = (
  set: SetState,
  tableId: string,
  rowId: string,
  patch: Partial<Pick<DataAssetRow, 'key'>>,
): void => {
  set((state) => ({
    dataAssets: state.dataAssets.map((table) =>
      table.id === tableId
        ? { ...table, rows: table.rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)) }
        : table,
    ),
    isDirty: true,
  }));
};

export const applyDeleteDataAssetRow = (set: SetState, tableId: string, rowId: string): void => {
  set((state) => ({
    dataAssets: state.dataAssets.map((table) =>
      table.id === tableId ? { ...table, rows: table.rows.filter((row) => row.id !== rowId) } : table,
    ),
    isDirty: true,
  }));
};

export const applySetDataAssetCell = (set: SetState, tableId: string, rowId: string, columnId: string, value: GraphValue): void => {
  set((state) => ({
    dataAssets: state.dataAssets.map((table) => {
      if (table.id !== tableId) return table;
      const column = table.columns.find((item) => item.id === columnId);
      if (!column) return table;
      return {
        ...table,
        rows: table.rows.map((row) =>
          row.id === rowId
            ? { ...row, values: { ...row.values, [columnId]: coerceGraphValue(value, column.type) } }
            : row,
        ),
      };
    }),
    isDirty: true,
  }));
};

export const applyCreateMaterial = (set: SetState, name?: string, description?: string, folderId?: string): string => {
  const id = makeId('material');
  const graphId = makeId('graph');
  set((state) => {
    const materialName = name ?? `Material ${state.materials.length + 1}`;
    return {
      materials: [
        ...state.materials,
        {
          id,
          name: materialName,
          description: description ?? 'Reusable material asset.',
          color: '#B4BCCC',
          metalness: 0.1,
          roughness: 0.65,
          emissiveColor: '#000000',
          emissiveIntensity: 0,
          graphId,
          folderId,
          createdAt: Date.now(),
        },
      ],
      graphs: [...state.graphs, makeMaterialGraph(graphId, materialName)],
      activeMaterialId: id,
      isDirty: true,
    };
  });
  return id;
};

export const applyRenameMaterial = (set: SetState, id: string, name: string): void => {
  set((state) => ({
    materials: state.materials.map((material) => (material.id === id ? { ...material, name } : material)),
    isDirty: true,
  }));
};

export const applyUpdateMaterial = (set: SetState, id: string, patch: Partial<MaterialDefinition>): void => {
  set((state) => ({
    materials: state.materials.map((material) => (material.id === id ? { ...material, ...patch } : material)),
    isDirty: true,
  }));
};

export const applyDeleteMaterial = (set: SetState, id: string): void => {
  set((state) => {
    const material = state.materials.find((item) => item.id === id);
    return {
      materials: state.materials.filter((item) => item.id !== id),
      graphs: material?.graphId ? state.graphs.filter((graph) => graph.id !== material.graphId) : state.graphs,
      activeMaterialId:
        state.activeMaterialId === id ? state.materials.find((m) => m.id !== id)?.id ?? '' : state.activeMaterialId,
      scenes: state.scenes.map((scene) => ({
        ...scene,
        objects: scene.objects.map((object) => {
          const renderer = object.renderer;
          if (!renderer) return object;
          const usesAsId = renderer.materialId === id;
          const usesInSlot = renderer.materialSlots?.includes(id);
          if (!usesAsId && !usesInSlot) return object;
          return {
            ...object,
            renderer: {
              ...renderer,
              materialId: usesAsId ? undefined : renderer.materialId,
              materialSlots: usesInSlot
                ? renderer.materialSlots!.map((slot) => (slot === id ? undefined : slot))
                : renderer.materialSlots,
            },
          };
        }),
      })),
      isDirty: true,
    };
  });
};

export const applySetActiveMaterial = (set: SetState, id: string): void => {
  set({ activeMaterialId: id });
};

export const applyCreateParticleSystem = (
  set: SetState,
  name?: string,
  preset?: ParticlePresetId,
  folderId?: string,
): string => {
  const id = makeId('psys');
  set((state) => {
    const systemName = name ?? `Particle System ${state.particleSystems.length + 1}`;
    const config: ParticleConfig = { ...defaultParticleConfig(), ...(preset ? particlePresets[preset] : {}) };
    return {
      particleSystems: [
        ...state.particleSystems,
        { id, name: systemName, description: 'Reusable particle system.', folderId, createdAt: Date.now(), ...config },
      ],
      activeParticleSystemId: id,
      isDirty: true,
    };
  });
  return id;
};

export const applyRenameParticleSystem = (set: SetState, id: string, name: string): void => {
  set((state) => ({
    particleSystems: state.particleSystems.map((system) => (system.id === id ? { ...system, name } : system)),
    isDirty: true,
  }));
};

export const applyUpdateParticleSystem = (set: SetState, id: string, patch: Partial<ParticleConfig>): void => {
  set((state) => ({
    particleSystems: state.particleSystems.map((system) => (system.id === id ? { ...system, ...stripUndefined(patch) } : system)),
    isDirty: true,
  }));
};

export const applyDeleteParticleSystem = (set: SetState, id: string): void => {
  set((state) => ({
    particleSystems: state.particleSystems.filter((item) => item.id !== id),
    activeParticleSystemId:
      state.activeParticleSystemId === id ? state.particleSystems.find((p) => p.id !== id)?.id ?? '' : state.activeParticleSystemId,
    scenes: state.scenes.map((scene) => ({
      ...scene,
      objects: scene.objects.map((object) => {
        if (object.particles?.systemId !== id) return object;
        const next = { ...object };
        delete next.particles;
        return next;
      }),
    })),
    isDirty: true,
  }));
};

export const applySetActiveParticleSystem = (set: SetState, id: string): void => {
  set({ activeParticleSystemId: id });
};

export const applyEnsureMaterialGraph = (set: SetState, get: GetState, materialId: string): void => {
  const state = get();
  const material = state.materials.find((item) => item.id === materialId);
  if (!material || (material.graphId && state.graphs.some((graph) => graph.id === material.graphId))) return;
  const graphId = material.graphId ?? makeId('graph');
  set((current) => ({
    materials: current.materials.map((item) => (item.id === materialId ? { ...item, graphId } : item)),
    graphs: [...current.graphs, makeMaterialGraph(graphId, material.name)],
    isDirty: true,
  }));
};

export const applyAddMaterialNode = (
  set: SetState,
  label: string,
  category: GraphNodeCategory,
  data?: Partial<NodeForgeNodeData>,
  position?: { x: number; y: number },
): string => {
  const nodeId = makeId('node');
  set((state) => {
    const material = state.materials.find((item) => item.id === state.activeMaterialId);
    if (!material?.graphId) return state;
    return {
      graphs: mapGraphById(state.graphs, material.graphId, (graph) => {
        const offset = graph.nodes.length * 38;
        const node: NodeForgeNode = {
          id: nodeId,
          type: 'nodeforge',
          position: position ?? { x: 80 + (offset % 320), y: 80 + Math.floor(offset / 320) * 112 },
          data: makeNodeData(label, category, data),
        };
        const edges = [...graph.edges];
        if (
          node.data.nodeKind === 'material.texture' &&
          !edges.some((edge) => edge.targetHandle === 'baseColor')
        ) {
          const output = graph.nodes.find((item) => item.data.nodeKind === 'material.output');
          if (output) {
            edges.push({
              id: makeId('edge'),
              source: nodeId,
              target: output.id,
              sourceHandle: 'value-out',
              targetHandle: 'baseColor',
              animated: false,
              type: 'smoothstep',
              style: { stroke: '#3DD0DC', strokeWidth: 2 },
            });
          }
        }
        return { ...graph, nodes: [...graph.nodes, node], edges };
      }),
      selectedGraphNodeId: nodeId,
      isDirty: true,
    };
  });
  return nodeId;
};

export const applyConnectMaterialNodes = (
  set: SetState,
  sourceId: string,
  targetId: string,
  sourceHandle?: string,
  targetHandle?: string,
): void => {
  set((state) => {
    const material = state.materials.find((item) => item.id === state.activeMaterialId);
    if (!material?.graphId) return state;
    return {
      graphs: mapGraphById(state.graphs, material.graphId, (graph) => ({
        ...graph,
        edges: addEdge(
          {
            id: makeId('edge'),
            source: sourceId,
            target: targetId,
            sourceHandle: sourceHandle ?? 'value-out',
            targetHandle,
            animated: false,
            type: 'smoothstep',
            style: { stroke: '#3DD0DC', strokeWidth: 2 },
          },
          graph.edges,
        ),
      })),
      isDirty: true,
    };
  });
};

export const applyDeleteMaterialNode = (set: SetState, nodeId: string): void => {
  set((state) => {
    const material = state.materials.find((item) => item.id === state.activeMaterialId);
    if (!material?.graphId) return state;
    return {
      graphs: mapGraphById(state.graphs, material.graphId, (graph) => ({
        ...graph,
        nodes: graph.nodes.filter((node) => node.id !== nodeId || node.data.nodeKind === 'material.output'),
        edges: graph.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
      })),
      selectedGraphNodeId: state.selectedGraphNodeId === nodeId ? undefined : state.selectedGraphNodeId,
      isDirty: true,
    };
  });
};

export const applyOnMaterialNodesChange = (set: SetState, changes: NodeChange<NodeForgeNode>[]): void => {
  set((state) => {
    const material = state.materials.find((item) => item.id === state.activeMaterialId);
    if (!material?.graphId) return state;
    const dirtied = changes.some((change) => change.type !== 'select' && change.type !== 'dimensions');
    return {
      graphs: mapGraphById(state.graphs, material.graphId, (graph) => ({
        ...graph,
        nodes: applyNodeChanges(changes, graph.nodes),
      })),
      ...(dirtied ? { isDirty: true } : {}),
    };
  });
};

export const applyOnMaterialEdgesChange = (set: SetState, changes: EdgeChange[]): void => {
  set((state) => {
    const material = state.materials.find((item) => item.id === state.activeMaterialId);
    if (!material?.graphId) return state;
    const dirtied = changes.some((change) => change.type !== 'select');
    return {
      graphs: mapGraphById(state.graphs, material.graphId, (graph) => ({
        ...graph,
        edges: applyEdgeChanges(changes, graph.edges),
      })),
      ...(dirtied ? { isDirty: true } : {}),
    };
  });
};

export const applyOnMaterialConnect = (set: SetState, connection: Connection): void => {
  set((state) => {
    const material = state.materials.find((item) => item.id === state.activeMaterialId);
    if (!material?.graphId) return state;
    return {
      graphs: mapGraphById(state.graphs, material.graphId, (graph) => ({
        ...graph,
        edges: addEdge(
          { ...connection, animated: false, type: 'smoothstep', style: { stroke: '#3DD0DC', strokeWidth: 2 } },
          graph.edges,
        ),
      })),
      isDirty: true,
    };
  });
};

export const applyAutoLayoutMaterialGraph = (set: SetState): void => {
  set((state) => {
    const material = state.materials.find((item) => item.id === state.activeMaterialId);
    if (!material?.graphId) return state;
    return {
      graphs: mapGraphById(state.graphs, material.graphId, (graph) => ({
        ...graph,
        nodes: layoutGraphNodes(graph.nodes, graph.edges),
      })),
      isDirty: true,
    };
  });
};

export const applyAddGraphNodeToBlueprint = (
  set: SetState,
  blueprintId: string,
  label: string,
  category: GraphNodeCategory,
  data?: Partial<NodeForgeNodeData>,
  position?: { x: number; y: number },
): string => {
  const nodeId = makeId('node');
  set((state) => {
    const blueprint = state.blueprints.find((item) => item.id === blueprintId);
    if (!blueprint) return state;
    return {
      blueprints: invalidateFeatherSourceForGraph(state.blueprints, blueprint.graphId),
      graphs: state.graphs.map((graph) => {
        if (graph.id !== blueprint.graphId) return graph;
        const offset = graph.nodes.length * 38;
        let nodeData = makeNodeData(label, category, seedNodeDataFromProject(label, data, state.variables, state.dataAssets));
        if (nodeData.nodeKind === 'action.timelineControl' && !nodeData.timelineRefId) {
          const timeline = graph.nodes.find(
            (candidate) => candidate.data.nodeKind === 'action.tweenProperty' && candidate.data.tweenCurve?.length,
          );
          if (timeline) nodeData = { ...nodeData, timelineRefId: timeline.data.timelineId || timeline.id };
        }
        const node: NodeForgeNode = {
          id: nodeId,
          type: 'nodeforge',
          position: position ?? { x: 80 + (offset % 560), y: 220 + Math.floor(offset / 560) * 112 },
          data: nodeData,
          ...(nodeData.nodeKind === 'comment.note' ? { width: 340, height: 200, zIndex: -1 } : {}),
        };
        return { ...graph, nodes: [...graph.nodes, node] };
      }),
      isDirty: true,
    };
  });
  return nodeId;
};

export const applyConnectGraphNodes = (
  set: SetState,
  blueprintId: string,
  sourceId: string,
  targetId: string,
  sourceHandle?: string,
  targetHandle?: string,
): void => {
  set((state) => {
    const blueprint = state.blueprints.find((item) => item.id === blueprintId);
    if (!blueprint) return state;
    const graph = state.graphs.find((item) => item.id === blueprint.graphId);
    const sourceNode = graph?.nodes.find((node) => node.id === sourceId);
    const targetNode = graph?.nodes.find((node) => node.id === targetId);
    if (!sourceNode || !targetNode || sourceId === targetId) return state;
    if (
      !isGraphConnectionValid(
        sourceNode.data.nodeKind,
        targetNode.data.nodeKind,
        sourceHandle,
        targetHandle,
        sourceNode.data.valueType,
        targetNode.data.valueType,
      )
    ) {
      return state;
    }
    const isValueEdge = Boolean(targetHandle && targetHandle !== 'exec-in');
    return {
      blueprints: invalidateFeatherSourceForGraph(state.blueprints, blueprint.graphId),
      graphs: state.graphs.map((graph) =>
        graph.id === blueprint.graphId
          ? {
              ...graph,
              edges: addEdge(
                {
                  id: makeId('edge'),
                  source: sourceId,
                  target: targetId,
                  sourceHandle,
                  targetHandle,
                  animated: false,
                  type: 'smoothstep',
                  style: isValueEdge ? { stroke: '#3DD0DC', strokeWidth: 2 } : undefined,
                },
                isValueEdge
                  ? graph.edges.filter(
                      (edge) => edge.target !== targetId || edge.targetHandle !== targetHandle,
                    )
                  : graph.edges,
              ),
            }
          : graph,
      ),
      isDirty: true,
    };
  });
};

export const applyDeleteGraphNode = (set: SetState, nodeId: string): void => {
  set((state) => {
    const blueprint = state.blueprints.find((item) => item.id === state.activeBlueprintId);
    if (!blueprint) return state;
    return {
      blueprints: invalidateFeatherSourceForGraph(state.blueprints, blueprint.graphId),
      graphs: state.graphs.map((graph) =>
        graph.id === blueprint.graphId
          ? {
              ...graph,
              nodes: graph.nodes.filter((node) => node.id !== nodeId),
              edges: graph.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
            }
          : graph,
      ),
      selectedGraphNodeId: state.selectedGraphNodeId === nodeId ? undefined : state.selectedGraphNodeId,
      isDirty: true,
    };
  });
};

export const applyDeleteGraphNodes = (set: SetState, nodeIds: string[]): void => {
  set((state) => {
    const blueprint = state.blueprints.find((item) => item.id === state.activeBlueprintId);
    if (!blueprint || nodeIds.length === 0) return state;
    const doomed = new Set(nodeIds);
    return {
      blueprints: invalidateFeatherSourceForGraph(state.blueprints, blueprint.graphId),
      graphs: state.graphs.map((graph) =>
        graph.id === blueprint.graphId
          ? {
              ...graph,
              nodes: graph.nodes.filter((node) => !doomed.has(node.id)),
              edges: graph.edges.filter((edge) => !doomed.has(edge.source) && !doomed.has(edge.target)),
            }
          : graph,
      ),
      selectedGraphNodeId:
        state.selectedGraphNodeId && doomed.has(state.selectedGraphNodeId) ? undefined : state.selectedGraphNodeId,
      isDirty: true,
    };
  });
};

export const applyPasteGraphNodes = (
  set: SetState,
  blueprintId: string,
  nodes: NodeForgeNode[],
  edges: Edge[],
  offset: { x: number; y: number } = { x: 36, y: 36 },
): string[] => {
  const idMap = new Map(nodes.map((node) => [node.id, makeId('node')]));
  const timelineIdMap = new Map<string, string>();
  for (const node of nodes) {
    if (node.data.nodeKind === 'action.tweenProperty') {
      timelineIdMap.set(node.data.timelineId || node.id, makeId('timeline'));
    }
  }
  set((state) => {
    const blueprint = state.blueprints.find((item) => item.id === blueprintId);
    if (!blueprint) return state;
    return {
      blueprints: invalidateFeatherSourceForGraph(state.blueprints, blueprint.graphId),
      graphs: state.graphs.map((graph) => {
        if (graph.id !== blueprint.graphId) return graph;
        const pasted: NodeForgeNode[] = nodes.map((node) => {
          const data = structuredClone(node.data);
          if (data.nodeKind === 'action.tweenProperty') {
            data.timelineId = timelineIdMap.get(node.data.timelineId || node.id);
          } else if (data.nodeKind === 'action.timelineControl' && data.timelineRefId) {
            data.timelineRefId = timelineIdMap.get(data.timelineRefId) ?? data.timelineRefId;
          }
          return {
            ...node,
            id: idMap.get(node.id)!,
            position: { x: node.position.x + offset.x, y: node.position.y + offset.y },
            data,
            selected: true,
          };
        });
        const pastedEdges: Edge[] = edges
          .filter((edge) => idMap.has(edge.source) && idMap.has(edge.target))
          .map((edge) => ({
            ...edge,
            id: makeId('edge'),
            source: idMap.get(edge.source)!,
            target: idMap.get(edge.target)!,
          }));
        const next = {
          ...graph,
          nodes: [...graph.nodes.map((node) => (node.selected ? { ...node, selected: false } : node)), ...pasted],
          edges: [...graph.edges, ...pastedEdges],
        };
        return sanitizeGraph(next);
      }),
      isDirty: true,
    };
  });
  return nodes.map((node) => idMap.get(node.id)!);
};

export const applyAutoLayoutActiveGraph = (set: SetState): void => {
  set((state) => {
    const blueprint = state.blueprints.find((item) => item.id === state.activeBlueprintId);
    if (!blueprint) return state;
    return {
      graphs: state.graphs.map((graph) =>
        graph.id === blueprint.graphId
          ? { ...graph, nodes: layoutGraphNodes(graph.nodes, graph.edges) }
          : graph,
      ),
      isDirty: true,
    };
  });
};

export const applySelectGraphNode = (set: SetState, get: GetState, selectedGraphNodeId?: string): void => {
  if (get().selectedGraphNodeId !== selectedGraphNodeId) set({ selectedGraphNodeId });
};

export const applyUpdateGraphNodeData = (set: SetState, id: string, patch: Partial<NodeForgeNodeData>): void => {
  set((state) => {
    const owningGraph = state.graphs.find((graph) => graph.nodes.some((node) => node.id === id));
    return {
      graphs: state.graphs.map((graph) => {
        const existing = graph.nodes.find((node) => node.id === id);
        if (!existing) return graph;
        const nextNodes = graph.nodes.map((node) =>
          node.id === id ? { ...node, data: normalizeNodeData({ ...node.data, ...patch }) } : node,
        );
        let nextEdges = graph.edges;
        const becameTextured =
          existing.data.nodeKind === 'material.texture' &&
          typeof patch.assetId !== 'undefined' &&
          patch.assetId &&
          !graph.edges.some((edge) => edge.source === id) &&
          !graph.edges.some((edge) => edge.targetHandle === 'baseColor');
        if (becameTextured) {
          const output = graph.nodes.find((node) => node.data.nodeKind === 'material.output');
          if (output) {
            nextEdges = [
              ...graph.edges,
              {
                id: makeId('edge'),
                source: id,
                target: output.id,
                sourceHandle: 'value-out',
                targetHandle: 'baseColor',
                animated: false,
                type: 'smoothstep',
                style: { stroke: '#3DD0DC', strokeWidth: 2 },
              },
            ];
          }
        }
        return { ...graph, nodes: nextNodes, edges: nextEdges };
      }),
      ...(owningGraph
        ? { blueprints: invalidateFeatherSourceForGraph(state.blueprints, owningGraph.id) }
        : {}),
      isDirty: true,
    };
  });
};

export const applyFireCustomEvent = (set: SetState, eventName: string): void => {
  set((state) => ({
    runtimeEventQueue: [...state.runtimeEventQueue, eventName.trim() || 'CustomEvent'],
  }));
};

export const applySetPlayPaused = (set: SetState, value: boolean): void => {
  set((state) => {
    if (!state.isPlaying) return state;
    if (state.isPlayPaused === value) return state;
    return { isPlayPaused: value, ...(value ? {} : { playStepFrames: 0 }) };
  });
};

export const applyStepPlayFrame = (set: SetState): void => {
  set((state) => {
    if (!state.isPlaying) return state;
    return { isPlayPaused: true, playStepFrames: (state.playStepFrames ?? 0) + 1 };
  });
};

export const applySetRuntimeKey = (set: SetState, code: string, pressed: boolean): void => {
  set((state) => {
    const keysChanged = state.runtimeKeys[code] !== pressed;
    if (!pressed) return keysChanged ? { runtimeKeys: { ...state.runtimeKeys, [code]: false } } : state;
    return {
      ...(keysChanged ? { runtimeKeys: { ...state.runtimeKeys, [code]: true } } : {}),
      runtimeKeyPresses: { ...state.runtimeKeyPresses, [code]: (state.runtimeKeyPresses[code] ?? 0) + 1 },
    };
  });
};

export const applyClearRuntimeSounds = (set: SetState): void => {
  set((state) => (state.runtimeSoundQueue.length ? { runtimeSoundQueue: [] } : state));
};

export const applyClearRuntimeLog = (set: SetState): void => {
  set((state) => (state.runtimeLog.length ? { runtimeLog: [] } : state));
};

export const applyStartReplay = (set: SetState, get: GetState, seconds?: number): boolean => {
  const state = get();
  if (!state.isPlaying || state.replayPlayback) return false;
  const duration = beginReplay(state.runtimeTime, seconds);
  if (duration == null) return false;
  set({ replayPlayback: { t: 0, duration } });
  return true;
};

export const applySetReplayTime = (set: SetState, t: number): void => {
  set((state) =>
    state.replayPlayback
      ? { replayPlayback: { ...state.replayPlayback, t: Math.max(0, Math.min(t, state.replayPlayback.duration)) } }
      : state,
  );
};

export const applyStopReplay = (set: SetState): void => {
  set((state) => {
    if (!state.replayPlayback) return state;
    endReplay();
    return { replayPlayback: null };
  });
};

export const applyTickRuntime = (set: SetState, get: GetState, delta: number): void => {
  set((state) => applyRuntimeTick(state, delta, set, get));
};

export const applyToggleGraphBreakpoint = (set: SetState, nodeId: string): void => {
  set((state) => {
    const on = toggleBreakpoint(nodeId);
    return {
      breakpointNodeIds: on
        ? [...state.breakpointNodeIds, nodeId]
        : state.breakpointNodeIds.filter((id) => id !== nodeId),
    };
  });
};

export const applyOnNodesChange = (set: SetState, changes: NodeChange<NodeForgeNode>[]): void => {
  set((state) => {
    const activeBlueprint = state.blueprints.find((item) => item.id === state.activeBlueprintId);
    if (!activeBlueprint) return state;
    const structuralChanges = changes.filter(
      (change) => change.type !== 'dimensions' || ('resizing' in change && change.resizing === true),
    );
    if (structuralChanges.length === 0) return state;
    const dirtied = changes.some(
      (change) => change.type !== 'select' && (change.type !== 'dimensions' || ('resizing' in change && change.resizing === true)),
    );
    const changesScript = changes.some(
      (change) => change.type === 'add' || change.type === 'remove' || change.type === 'replace',
    );
    return {
      ...(changesScript
        ? { blueprints: invalidateFeatherSourceForGraph(state.blueprints, activeBlueprint.graphId) }
        : {}),
      graphs: state.graphs.map((graph) =>
        graph.id === activeBlueprint.graphId ? { ...graph, nodes: applyNodeChanges(structuralChanges, graph.nodes) } : graph,
      ),
      ...(dirtied ? { isDirty: true } : {}),
    };
  });
};

export const applyOnEdgesChange = (set: SetState, changes: EdgeChange[]): void => {
  set((state) => {
    const activeBlueprint = state.blueprints.find((item) => item.id === state.activeBlueprintId);
    if (!activeBlueprint) return state;
    const dirtied = changes.some((change) => change.type !== 'select');
    return {
      ...(dirtied
        ? { blueprints: invalidateFeatherSourceForGraph(state.blueprints, activeBlueprint.graphId) }
        : {}),
      graphs: state.graphs.map((graph) =>
        graph.id === activeBlueprint.graphId ? { ...graph, edges: applyEdgeChanges(changes, graph.edges) } : graph,
      ),
      ...(dirtied ? { isDirty: true } : {}),
    };
  });
};

export const applyOnConnect = (set: SetState, connection: Connection): void => {
  set((state) => {
    const activeBlueprint = state.blueprints.find((item) => item.id === state.activeBlueprintId);
    if (!activeBlueprint) return state;
    const graph = state.graphs.find((item) => item.id === activeBlueprint.graphId);
    const sourceNode = graph?.nodes.find((node) => node.id === connection.source);
    const targetNode = graph?.nodes.find((node) => node.id === connection.target);
    if (!sourceNode || !targetNode || connection.source === connection.target) return state;
    if (
      !isGraphConnectionValid(
        sourceNode.data.nodeKind,
        targetNode.data.nodeKind,
        connection.sourceHandle,
        connection.targetHandle,
        sourceNode.data.valueType,
        targetNode.data.valueType,
      )
    ) {
      return state;
    }
    const isValueEdge = Boolean(connection.targetHandle && connection.targetHandle !== 'exec-in');
    return {
      blueprints: invalidateFeatherSourceForGraph(state.blueprints, activeBlueprint.graphId),
      graphs: state.graphs.map((graph) =>
        graph.id === activeBlueprint.graphId
          ? {
              ...graph,
              edges: addEdge(
                {
                  ...connection,
                  animated: false,
                  type: 'smoothstep',
                  style: isValueEdge ? { stroke: '#3DD0DC', strokeWidth: 2 } : undefined,
                },
                isValueEdge
                  ? graph.edges.filter(
                      (edge) => edge.target !== connection.target || edge.targetHandle !== connection.targetHandle,
                    )
                  : graph.edges,
              ),
            }
          : graph,
      ),
      isDirty: true,
    };
  });
};

export const applyOnReconnect = (set: SetState, oldEdge: Edge, connection: Connection): void => {
  set((state) => {
    const activeBlueprint = state.blueprints.find((item) => item.id === state.activeBlueprintId);
    if (!activeBlueprint) return state;
    const graph = state.graphs.find((item) => item.id === activeBlueprint.graphId);
    const sourceNode = graph?.nodes.find((node) => node.id === connection.source);
    const targetNode = graph?.nodes.find((node) => node.id === connection.target);
    if (!graph || !sourceNode || !targetNode || connection.source === connection.target) return state;
    if (
      !isGraphConnectionValid(
        sourceNode.data.nodeKind,
        targetNode.data.nodeKind,
        connection.sourceHandle,
        connection.targetHandle,
        sourceNode.data.valueType,
        targetNode.data.valueType,
      )
    ) {
      return state;
    }
    const isValueEdge = Boolean(connection.targetHandle && connection.targetHandle !== 'exec-in');
    return {
      blueprints: invalidateFeatherSourceForGraph(state.blueprints, activeBlueprint.graphId),
      graphs: state.graphs.map((candidate) => {
        if (candidate.id !== activeBlueprint.graphId) return candidate;
        const reconnectableEdges = isValueEdge
          ? candidate.edges.filter(
              (edge) =>
                edge.id === oldEdge.id ||
                edge.target !== connection.target ||
                edge.targetHandle !== connection.targetHandle,
            )
          : candidate.edges;
        return {
          ...candidate,
          edges: reconnectEdge(oldEdge, connection, reconnectableEdges, { shouldReplaceId: false }).map((edge) =>
            edge.id === oldEdge.id
              ? {
                  ...edge,
                  animated: false,
                  type: 'smoothstep',
                  style: isValueEdge ? { stroke: '#3DD0DC', strokeWidth: 2 } : undefined,
                }
              : edge,
          ),
        };
      }),
      isDirty: true,
    };
  });
};

export const applyAddGraphNode = (set: SetState, label: string, category: GraphNodeCategory): void => {
  set((state) => {
    const activeBlueprint = state.blueprints.find((item) => item.id === state.activeBlueprintId);
    if (!activeBlueprint) return state;
    let selectedGraphNodeId = state.selectedGraphNodeId;
    return {
      blueprints: invalidateFeatherSourceForGraph(state.blueprints, activeBlueprint.graphId),
      graphs: state.graphs.map((graph) => {
        if (graph.id !== activeBlueprint.graphId) return graph;
        const offset = graph.nodes.length * 38;
        const node: NodeForgeNode = {
          id: makeId('node'),
          type: 'nodeforge',
          position: { x: 80 + (offset % 560), y: 220 + Math.floor(offset / 560) * 112 },
          data: makeNodeData(label, category, seedNodeDataFromProject(label, undefined, state.variables, state.dataAssets)),
        };
        selectedGraphNodeId = node.id;
        return { ...graph, nodes: [...graph.nodes, node] };
      }),
      selectedGraphNodeId,
      isDirty: true,
    };
  });
};
