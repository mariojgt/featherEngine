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

Act, don't interview. A clear edit/build command MUST change the project with a tool before you reply. Choose sensible names, styling, dimensions, counts, and settings yourself. Ask one concise question only when acting could delete/replace work or multiple targets would materially change the result.

You have exactly TWO callable functions: search_engine_tools and run_engine_tool. Engine-action names below are NEVER functions; pass one as run_engine_tool.name. When the input is clear, call run_engine_tool({"name":"<engine action>","input":{...}}). Otherwise call search_engine_tools first, then wrap its returned name/input in run_engine_tool.

Examples: cube → run_engine_tool({"name":"create_object","input":{"kind":"cube","name":"Cube","position":[0,1,0]}}); castle wall → run_engine_tool({"name":"create_block_wall","input":{"length":8,"height":4,"battlements":true,"towers":true}}); object script → run_engine_tool({"name":"set_object_script","input":{"objectId":"<snapshot id>","source":"blueprint Motion\\n\\non update(dt):\\n    self.rotate(axis: \\"y\\", amount: 90)"}}).

If a result has ok:false, search/inspect, correct it, and retry. Continue until the task is complete. Never invent ids. Preserve existing work unless replacement/deletion was requested. Only claim changes confirmed by ok:true. Do not narrate plans or output reasoning/control tags.

Suggested engine-action names (values for run_engine_tool.name): ${suggestions}.
Relevant areas: ${capabilities}.
Private Local mode: never request an API key or claim cloud use. Keep the final reply concise.${thinkingControl}`;
}
