import { useEffect, useState } from 'react';
import { Aperture, Box, Gamepad2, Grid3X3, Plus, TreePine } from 'lucide-react';
import { useEditorStore } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import { CREATOR_ROLES } from '../creator/roles';
import { CREATOR_GAMEPLAY_KITS } from '../creator/gameplayKits';
import { MODEL_STARTERS, QUICK_MODEL_STARTER_IDS } from '../model/modelSpec';
import { ensureModelForgeEnabled } from '../extensions/openModelForge';
import { customizedModelIds, isInstanceable } from '../three/modelInstancing';
import { focusWorkspacePanel } from './workspacePanels';
import { EditorActionPicker, type EditorAction } from './EditorActionPicker';
import { objectIcons, objectTypeNames, roleIcons } from './editorIcons';
import type { SceneObjectKind, TreeArchetype, Vector3Tuple } from '../types';

export interface ObjectCreationContext { parentId?: string; position?: Vector3Tuple; category?: string; onCreated?: (id: string) => void; }
export function requestAddObject(context: ObjectCreationContext = {}) {
  window.dispatchEvent(new CustomEvent('nf:add-object', { detail: context }));
}

const trees: Array<[TreeArchetype, string]> = [['broadleaf', 'Broadleaf tree'], ['conifer', 'Conifer tree'], ['birch', 'Birch tree'], ['willow', 'Willow tree'], ['palm', 'Palm tree'], ['shrub', 'Bush'], ['snag', 'Dead tree']];

export function ObjectCreationMenu() {
  const [context, setContext] = useState<ObjectCreationContext | null>(null);
  const playing = useEditorStore((state) => state.isPlaying);
  const selectedId = useEditorStore((state) => state.selectedObjectId);
  useEffect(() => {
    const open = (event: Event) => { if (!useEditorStore.getState().isPlaying) setContext((event as CustomEvent<ObjectCreationContext>).detail ?? {}); };
    window.addEventListener('nf:add-object', open);
    return () => window.removeEventListener('nf:add-object', open);
  }, []);
  useEffect(() => { if (playing) setContext(null); }, [playing]);

  const state = useEditorStore.getState();
  const parent = context?.parentId ? state.activeScene()?.objects.find((object) => object.id === context.parentId) : undefined;
  const selected = state.selectedObject();
  const finish = (id?: string | null) => {
    if (!id) return;
    const store = useEditorStore.getState();
    if (parent) store.setObjectParent(id, parent.id);
    store.selectObject(id);
    context?.onCreated?.(id);
    focusWorkspacePanel('hierarchy');
    focusWorkspacePanel('inspector');
  };
  const actions: EditorAction[] = (['cube', 'sphere', 'capsule', 'plane', 'empty', 'light', 'camera', 'terrain'] as SceneObjectKind[]).map((kind) => ({
    id: kind, label: objectTypeNames[kind], category: 'Basic', icon: objectIcons[kind],
    description: { cube: 'A box-shaped mesh.', sphere: 'A round mesh.', capsule: 'A rounded cylinder.', plane: 'A flat surface.', empty: 'A transform for organizing child objects.', light: 'Illuminate your scene.', camera: 'A scene camera.', terrain: 'A sculptable landscape.' }[kind],
    run: () => finish(state.createObjectWithProps(kind, { position: context?.position ? [context.position[0], context.position[1] + (kind === 'empty' ? 0 : 1.5), context.position[2]] : undefined, parentId: parent?.id })),
  }));
  actions.push({ id: 'ground', label: 'Ground', description: 'A large flat surface with static collision.', category: 'Basic', icon: objectIcons.plane, run: () => { const id = state.createObjectWithProps('plane', { name: 'Ground', position: context?.position ?? [0, 0, 0], color: '#39414f', physics: { enabled: true, bodyType: 'fixed', collider: 'box' } }); state.updateTransform(id, 'scale', [60, 1, 60]); finish(id); } });
  actions.push(...CREATOR_ROLES.map((role): EditorAction => ({
    id: `role-${role.id}`, label: role.name, description: role.description, category: 'Gameplay', icon: roleIcons[role.id] ?? Gamepad2,
    run: () => { const result = state.createRoleObject(role.id, { position: context?.position, parentId: parent?.id }); if (result.ok) finish(result.objectId); else useProjectStore.setState({ toast: { kind: 'error', message: `Could not add ${role.name}.` } }); },
  })));
  actions.push(...trees.map(([archetype, label]): EditorAction => ({ id: `tree-${archetype}`, label, category: 'Nature', icon: TreePine, description: 'A configurable tree or shrub.', run: () => finish(state.createTree(archetype, { position: context?.position })) })));
  actions.push(...CREATOR_GAMEPLAY_KITS.map((kit): EditorAction => ({ id: `kit-${kit.id}`, label: kit.name, category: 'Scene starters', icon: Gamepad2, description: kit.description,
    disabledReason: parent || context?.position ? 'Add scene starters from the main Add object button.' : undefined,
    run: () => { const result = state.createCreatorGameplayKit(kit.id); useProjectStore.setState({ toast: result.ok ? { kind: 'success', message: `${kit.name} added.` } : { kind: 'error', message: `Could not add ${kit.name}.` } }); if (result.ok) finish(useEditorStore.getState().selectedObjectId); },
  })));
  actions.push(...MODEL_STARTERS.filter((starter) => QUICK_MODEL_STARTER_IDS.includes(starter.id)).map((starter): EditorAction => ({ id: `model-${starter.id}`, label: starter.name, description: starter.tagline, category: 'Prototype props', icon: Box,
    run: () => { if (!ensureModelForgeEnabled()) return; const specId = state.createModelSpec(starter.id); if (specId) finish(useEditorStore.getState().createModelFromSpec(specId, { position: context?.position })); },
  })));
  actions.push({ id: 'reflection-probe', label: 'Reflection probe', category: 'Advanced', description: 'Capture local reflections for nearby surfaces.', icon: Aperture, run: () => finish(state.createReflectionProbe(context?.position)) });
  actions.push({ id: 'model-grid', label: 'Repeated model grid', category: 'Advanced', description: 'Create a 3 × 3 grid sharing one model for efficient rendering.', icon: Grid3X3,
    disabledReason: parent || context?.position ? 'Create a grid from the main Add object button.' : !selected || !isInstanceable(selected, customizedModelIds(state.materials)) ? 'Select a static imported model at the scene root with its original materials.' : undefined,
    run: () => { const ids = state.createInstancedGrid(selectedId, { rows: 3, columns: 3 }); if (ids.length) finish(ids[0]); else useProjectStore.setState({ toast: { kind: 'error', message: 'This model cannot be repeated as an instanced grid.' } }); },
  });
  return <>
    <button type="button" className="file-menu-trigger add-trigger" aria-haspopup="dialog" aria-expanded={Boolean(context)} disabled={playing} title={playing ? 'Stop preview to add objects' : 'Create an object in the current scene'} onClick={() => setContext({})}><Plus size={15} aria-hidden /><span>Add object</span></button>
    {context && <EditorActionPicker title={parent ? 'Add child object' : 'Add object'} description={parent ? `Create an object inside ${parent.name}.` : context.position ? 'Create an object at the chosen viewport position.' : 'Create in the current scene. Import project files in Assets.'} searchLabel="Search objects…" actions={actions} initialCategory={context.category ?? "Basic"} onClose={() => setContext(null)} />}
  </>;
}
