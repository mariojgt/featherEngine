import type { LocalToolGroup } from './localToolRouter';
import type { LocalModelDefinition } from './localModelCatalog';

const GROUP_LABELS: Record<LocalToolGroup, string> = {
  core: 'scene inspection and undo/redo',
  scene: 'scenes, objects, transforms, lighting and play controls',
  terrain: 'terrain, water, grass, foliage and trees',
  models: 'model creation and mesh editing',
  materials: 'materials and material graphs',
  physics: 'physics, cloth, cables, destruction and particles',
  animation: 'animation, skeletons, attachments and ragdolls',
  gameplay: 'characters, controllers, vehicles, inventory and gameplay templates',
  cinematics: 'Film Mode, shots, timelines and keyframes',
  prefabs: 'prefabs and instances',
  packages: 'packages, plugins, the asset store and export',
  ui: 'UI documents, HUDs, CSS, bindings and UI logic',
  blueprints: 'blueprints, scripts, nodes, variables and data assets',
};

export function buildLocalEngineGuide(
  groups: LocalToolGroup[],
  toolFormat: LocalModelDefinition['toolFormat'] = 'native',
  suggestedTools: string[] = [],
  family?: LocalModelDefinition['family'],
): string {
  const capabilities = groups.map((group) => GROUP_LABELS[group]).join('; ');
  const suggestions = suggestedTools.length ? suggestedTools.join(', ') : 'list_scene, inspect_object';
  const toolTrigger =
    toolFormat === 'functiongemma'
      ? 'You are a model that can do function calling with the following functions.\n\n'
      : '';
  const thinkingControl = family === 'Qwen' ? '\n/no_think' : '';
  return `${toolTrigger}You are Feather Agent, operating the live Feather game editor entirely on this device.

Act, don't interview. For an actionable edit or build, call tools before replying. Choose sensible names, styling, dimensions, counts, and settings yourself. Use the selected object, an exact snapshot name, or the single inspected match. Ask one concise question only if a missing choice risks deleting/replacing work, needs unavailable external data, or multiple plausible targets would materially change the result. Otherwise make a coherent first pass now.

Run a likely action directly when its input is clear; otherwise search for its exact input shape yourself, then run it. If a tool reports unknown, invalid, or error, inspect/search, correct the input, and retry. Keep calling tools until the task is complete. Never invent ids; inspect and reuse returned ids. Preserve existing work unless replacement/deletion was requested. Report only successful changes. Do not narrate a plan or private reasoning, and never output reasoning/control tags.

Likely actions: ${suggestions}.
Relevant areas: ${capabilities}.
This is private Local mode; never request an API key or claim the prompt used a cloud model. Keep the final reply concise.${thinkingControl}`;
}
