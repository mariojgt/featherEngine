import { asSchema, tool } from 'ai';
import { z } from 'zod';
import { engineTools } from '../tools';

export type LocalToolGroup =
  | 'core'
  | 'scene'
  | 'terrain'
  | 'models'
  | 'materials'
  | 'physics'
  | 'animation'
  | 'gameplay'
  | 'cinematics'
  | 'prefabs'
  | 'packages'
  | 'ui'
  | 'blueprints';

type EngineToolName = keyof typeof engineTools;

const LOCAL_TOOL_SEARCH_LIMIT = 2;
const LOCAL_TOOL_RESULT_CHARS = 1200;

/** Every engine tool belongs to one deterministic capability group. */
export const LOCAL_TOOL_GROUPS: Record<LocalToolGroup, readonly EngineToolName[]> = {
  core: [
    'list_scene',
    'inspect_object',
    'list_scenes',
    'select_object',
    'undo',
    'redo',
  ],
  scene: [
    'create_scene',
    'switch_scene',
    'rename_scene',
    'create_object',
    'create_gameplay_object',
    'make_object_role',
    'add_simple_interaction',
    'set_object_parent',
    'update_transform',
    'update_renderer',
    'set_scene_audio',
    'set_streaming',
    'start_replay',
    'set_scene_environment',
    'apply_lighting_preset',
    'apply_render_preset',
    'set_light',
    'create_reflection_probe',
    'set_reflection_probe',
    'set_render_settings',
    'set_viewport_render_preview',
    'set_quality',
    'rename_object',
    'delete_object',
    'duplicate_object',
    'create_instanced_grid',
    'group_objects',
    'spawn_grid',
    'align_objects',
    'distribute_objects',
    'batch_transform',
    'create_folder',
    'move_to_folder',
    'set_playing',
    'set_play_paused',
    'step_play_frame',
    'capture_screenshot',
    'fire_event',
  ],
  terrain: [
    'create_terrain',
    'create_meadow',
    'create_water_volume',
    'update_water_volume',
    'update_terrain',
    'list_tree_specs',
    'create_tree_spec',
    'update_tree_spec',
    'create_tree',
    'chop_tree',
    'list_tree_presets',
    'apply_tree_preset',
    'plant_grove',
    'set_grass_look',
    'sculpt_terrain',
    'paint_terrain',
    'paint_foliage',
    'add_terrain_layer',
    'update_terrain_layer',
  ],
  models: [
    'list_model_specs',
    'create_model_spec',
    'add_model_part',
    'update_model_part',
    'remove_model_part',
    'paint_model_part',
    'set_model_palette',
    'edit_model_vertices',
    'convert_model_part_to_mesh',
    'extrude_model_faces',
    'subdivide_model_faces',
    'boolean_model_parts',
    'set_model_style',
    'place_model',
    'bake_model_asset',
    'set_model',
  ],
  materials: [
    'create_material',
    'apply_material_preset',
    'update_material',
    'set_object_material',
    'set_submesh_material',
    'delete_material',
    'add_material_node',
    'connect_material_nodes',
    'update_material_node',
    'delete_material_node',
  ],
  physics: [
    'add_joint',
    'update_joint',
    'remove_joint',
    'create_cloth',
    'update_cloth',
    'remove_cloth',
    'create_cable',
    'update_cable',
    'remove_cable',
    'set_physics',
    'apply_physics_preset',
    'set_fracture',
    'create_particle_system',
    'update_particle_system',
    'delete_particle_system',
    'attach_particle_system',
  ],
  animation: [
    'inspect_animator_controller',
    'set_animator',
    'create_animator_controller',
    'add_animator_parameter',
    'add_animator_state',
    'update_animator_state',
    'set_blendspace',
    'add_animator_transition',
    'set_anim_parameter',
    'set_ragdoll',
    'set_object_controller',
    'list_bones',
    'attach_to_bone',
    'set_attachment_offset',
    'add_skeleton_socket',
    'set_ragdoll_settings',
    'generate_ragdoll_bodies',
    'set_ragdoll_body',
    'remove_ragdoll_body',
    'attach_to_socket',
  ],
  gameplay: [
    'create_gameplay_kit',
    'set_inventory',
    'equip_slot',
    'set_character_controller',
    'create_character_pawn',
    'add_gameplay_kit',
    'create_third_person_template',
    'create_meadow_template',
    'create_cube_realm_template',
    'create_first_person_template',
    'create_film_mode_template',
    'create_physics_lab_template',
    'create_timeline_showcase_template',
    'create_spline_studio_template',
    'create_platformer_template',
    'create_driving_template',
    'create_sim_racing_template',
    'set_vehicle',
    'customize_vehicle',
  ],
  cinematics: [
    'inspect_cinematic',
    'set_cinematic_keyframe',
    'delete_cinematic_keyframe',
    'create_cinematic',
    'create_storyboard_cinematic',
    'polish_cinematic_look',
    'duplicate_cinematic_take',
    'add_cinematic_marker',
    'add_cinematic_action',
    'update_cinematic_action',
    'delete_cinematic_action',
    'delete_cinematic',
    'add_cinematic_shot',
    'add_cinematic_transition',
    'add_cinematic_library_shot',
    'set_cinematic_look',
    'animate_on_timeline',
    'play_cinematic',
  ],
  prefabs: [
    'create_prefab',
    'inspect_prefab',
    'instantiate_prefab',
    'open_prefab',
    'close_prefab',
    'rename_prefab',
    'delete_prefab',
    'apply_instance_to_prefab',
    'revert_instance_to_prefab',
  ],
  packages: [
    'export_prefab_package',
    'export_folder_package',
    'import_package',
    'browse_asset_store',
    'install_store_package',
    'list_plugins',
    'set_plugin_enabled',
    'export_project_package',
    'export_game',
    'export_production',
    'list_export_platforms',
  ],
  ui: [
    'create_ui_document',
    'set_ui_render_mode',
    'extract_ui_component',
    'create_ui_component',
    'insert_ui_component',
    'set_ui_component_param',
    'set_ui_css',
    'set_ui_element_css',
    'create_ui_template',
    'add_ui_element',
    'update_ui_element',
    'bind_ui_element',
    'attach_world_ui',
    'set_object_variable',
    'add_blueprint_variable',
    'update_blueprint_variable',
    'remove_blueprint_variable',
    'create_collectible_counter',
    'apply_ui_theme',
    'add_ui_preset',
    'move_ui_element',
    'duplicate_ui_element',
    'open_ui_logic',
    'delete_ui_document',
  ],
  blueprints: [
    'inspect_blueprint',
    'get_blueprint_script',
    'set_blueprint_script',
    'create_blueprint',
    'attach_behavior',
    'create_variable',
    'update_variable',
    'create_data_asset',
    'add_data_asset_column',
    'add_data_asset_row',
    'set_data_asset_cell',
    'add_node',
    'connect_nodes',
    'update_node',
    'auto_layout',
    'attach_blueprint',
    'open_object_script',
  ],
};

const GROUP_INTENTS: Array<[LocalToolGroup, RegExp]> = [
  ['terrain', /\b(terrain|landscape|ground|meadow|grass|foliage|tree|forest|grove|water|ocean|river|lake|sculpt|paint)\b/i],
  ['models', /\b(model|mesh|geometry|vertex|vertices|face|extrude|subdivide|boolean|palette|glb|asset)\b/i],
  ['materials', /\b(material|shader|texture|surface|toon|metal|roughness|node material)\b/i],
  ['physics', /\b(physics|collision|collider|rigidbody|joint|cloth|cable|fracture|destruct|particle|vfx)\b/i],
  ['animation', /\b(animat|animator|skeleton|bone|socket|ragdoll|blend ?space|transition|idle|walk|run)\b/i],
  ['gameplay', /\b(game|playable|player|character|controller|pickup|inventory|weapon|vehicle|driving|racing|platformer|first.person|third.person|template)\b/i],
  ['cinematics', /\b(cinematic|film|camera shot|storyboard|timeline|keyframe|take|transition|replay)\b/i],
  ['prefabs', /\b(prefab|instance|reusable object)\b/i],
  ['packages', /\b(package|plugin|asset store|marketplace|import|export|build platform|publish)\b/i],
  ['ui', /\b(ui|hud|interface|screen|widget|button|label|health bar|score|ammo|css|menu|diegetic)\b/i],
  ['blueprints', /\b(blueprint|script|logic|node|variable|data asset|behavior|event graph)\b/i],
  ['scene', /\b(scene|object|cube|sphere|light|lighting|environment|transform|move|rotate|scale|folder|grid|render|screenshot|play mode)\b/i],
];

const GROUP_DEFAULT_TOOLS: Record<LocalToolGroup, readonly EngineToolName[]> = {
  core: ['list_scene', 'inspect_object'],
  scene: ['create_object', 'update_transform'],
  terrain: ['create_terrain', 'plant_grove'],
  models: ['create_model_spec', 'place_model'],
  materials: ['create_material', 'apply_material_preset'],
  physics: ['set_physics', 'apply_physics_preset'],
  animation: ['set_animator', 'create_animator_controller'],
  gameplay: ['create_gameplay_kit', 'create_character_pawn'],
  cinematics: ['create_cinematic', 'add_cinematic_shot'],
  prefabs: ['create_prefab', 'instantiate_prefab'],
  packages: ['browse_asset_store', 'export_game'],
  ui: ['create_ui_template', 'create_collectible_counter'],
  blueprints: ['create_blueprint', 'attach_behavior'],
};

const TOOL_GROUP = new Map<EngineToolName, LocalToolGroup>(
  Object.entries(LOCAL_TOOL_GROUPS).flatMap(([group, names]) =>
    names.map((name) => [name, group as LocalToolGroup]),
  ),
);

const SEARCH_STOP_WORDS = new Set([
  'and', 'are', 'build', 'can', 'create', 'for', 'from', 'help', 'into', 'make', 'please',
  'set', 'that', 'the', 'this', 'tool', 'use', 'with', 'you', 'your',
]);

const normalizeSearchText = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Deterministic lexical index used both for prompt hints and the model's tiny discovery tool. */
export function rankLocalEngineTools(query: string): EngineToolName[] {
  const normalizedQuery = normalizeSearchText(query);
  const identifierQuery = query.toLowerCase();
  const queryTokens = [...new Set(normalizedQuery.split(' ')
    .map((token) => token.length > 4 && token.endsWith('s') ? token.slice(0, -1) : token)
    .filter((token) => token.length >= 3 && !SEARCH_STOP_WORDS.has(token)))];
  const selectedGroups = new Set<LocalToolGroup>(['core']);
  for (const [group, intent] of GROUP_INTENTS) {
    intent.lastIndex = 0;
    if (intent.test(query)) selectedGroups.add(group);
  }

  const defaults = new Map<EngineToolName, number>();
  for (const group of selectedGroups) {
    GROUP_DEFAULT_TOOLS[group].forEach((name, index) => defaults.set(name, 40 - index));
  }

  return (Object.keys(engineTools) as EngineToolName[])
    .map((name) => {
      const definition = engineTools[name] as { description?: string };
      const normalizedName = normalizeSearchText(name);
      const searchable = `${normalizedName} ${normalizeSearchText(definition.description ?? '')}`;
      const exactIdentifier = new RegExp(`(?:^|[^a-z0-9_])${name}(?:$|[^a-z0-9_])`).test(identifierQuery);
      const exactPhrase = normalizedQuery.includes(normalizedName);
      let score = exactIdentifier ? 20_000 : exactPhrase ? 10_000 : (defaults.get(name) ?? 0);
      for (const token of queryTokens) {
        if (normalizedName.split(' ').includes(token)) score += 120;
        else if (normalizedName.includes(token)) score += 60;
        if (searchable.includes(token)) score += 8;
      }
      if (selectedGroups.has(TOOL_GROUP.get(name) ?? 'core')) score += 4;
      return { name, score };
    })
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .map(({ name }) => name);
}

type JsonSchema = Record<string, unknown>;

function compactToolSchema(schema: unknown, depth = 0): unknown {
  if (!schema || typeof schema !== 'object' || depth > 4) return schema;
  const value = schema as JsonSchema;
  const compact: JsonSchema = {};
  if (typeof value.type === 'string') compact.type = value.type;
  if (Array.isArray(value.required) && value.required.length) compact.required = value.required;
  if (typeof value.description === 'string') compact.description = value.description.slice(0, 80);
  if (
    typeof value.default === 'string'
    || typeof value.default === 'number'
    || typeof value.default === 'boolean'
    || value.default === null
  ) compact.default = value.default;
  if (Array.isArray(value.enum)) {
    compact.enum = value.enum.length <= 16 ? value.enum : [...value.enum.slice(0, 16), `+${value.enum.length - 16} more`];
  }
  if (value.items) compact.items = compactToolSchema(value.items, depth + 1);
  if (value.properties && typeof value.properties === 'object') {
    compact.properties = Object.fromEntries(
      Object.entries(value.properties as JsonSchema).map(([name, property]) => [
        name,
        compactToolSchema(property, depth + 1),
      ]),
    );
  }
  for (const unionKey of ['anyOf', 'oneOf'] as const) {
    const union = value[unionKey];
    if (Array.isArray(union)) compact[unionKey] = union.slice(0, 8).map((item) => compactToolSchema(item, depth + 1));
  }
  return compact;
}

const boundedGatewayJson = (value: unknown, fallback: unknown): string => {
  const serialized = JSON.stringify(value);
  return serialized.length <= LOCAL_TOOL_RESULT_CHARS ? serialized : JSON.stringify(fallback);
};

type ExecutableEngineTool = {
  description?: string;
  inputSchema: unknown;
  execute?: (input: never, options: never) => unknown;
};

/**
 * Local models see this two-tool gateway instead of 223 large schemas. `search_engine_tools`
 * discovers compact argument shapes; `run_engine_tool` validates and dispatches to the same engine
 * implementations used by cloud models. Every engine action remains reachable without making
 * Qwen allocate full-vocabulary logits for tens of thousands of schema tokens.
 */
export const LOCAL_ENGINE_GATEWAY_TOOLS = {
  search_engine_tools: tool({
    description: 'Find the best Feather engine actions and their compact input shapes. Call this before run_engine_tool when a name or input is unclear.',
    inputSchema: z.object({
      query: z.string().min(1).max(240).describe('What you need to inspect or change.'),
      limit: z.number().int().min(1).max(LOCAL_TOOL_SEARCH_LIMIT).optional(),
    }),
    execute: async ({ query, limit }) => {
      const matches = rankLocalEngineTools(query).slice(0, limit ?? LOCAL_TOOL_SEARCH_LIMIT);
      const definitions = await Promise.all(matches.map(async (name) => {
        const definition = engineTools[name] as ExecutableEngineTool;
        return {
          name,
          description: (definition.description ?? '').slice(0, 220),
          input: compactToolSchema(await asSchema(definition.inputSchema as never).jsonSchema),
        };
      }));
      return boundedGatewayJson(
        { ok: true, matches: definitions },
        {
          ok: true,
          truncated: true,
          matches: definitions.map(({ name, description, input }) => {
            const schema = input as JsonSchema;
            return {
              name,
              description: description.slice(0, 120),
              required: schema.required ?? [],
              fields: schema.properties && typeof schema.properties === 'object'
                ? Object.keys(schema.properties as JsonSchema)
                : [],
            };
          }),
        },
      );
    },
  }),
  run_engine_tool: tool({
    description: 'Run one Feather engine action by name. Use the exact input shape returned by search_engine_tools. The result is applied to the live project.',
    inputSchema: z.object({
      name: z.string().min(1).max(96).describe('Exact Feather engine action name.'),
      input: z.record(z.string(), z.unknown()).optional().describe('Arguments for that action.'),
    }),
    execute: async ({ name, input = {} }, options) => {
      if (!Object.prototype.hasOwnProperty.call(engineTools, name)) {
        return JSON.stringify({
          ok: false,
          name,
          error: 'unknown_action',
          message: `No engine action named "${name}".`,
          retry: 'search',
        });
      }
      const definition = engineTools[name as EngineToolName] as ExecutableEngineTool;
      if (!definition.execute) {
        return JSON.stringify({
          ok: false,
          name,
          error: 'not_executable',
          message: `Engine action "${name}" cannot be executed.`,
          retry: 'search',
        });
      }

      const schema = asSchema(definition.inputSchema as never);
      const validation = schema.validate ? await schema.validate(input) : { success: true as const, value: input };
      if (!validation.success) {
        return JSON.stringify({
          ok: false,
          name,
          error: 'invalid_input',
          message: validation.error.message.slice(0, 500),
          retry: 'search_then_run',
        });
      }

      try {
        const result = await definition.execute(validation.value as never, options as never);
        const resultText = typeof result === 'string' ? result : JSON.stringify(result);
        return boundedGatewayJson(
          { ok: true, name, result },
          {
            ok: true,
            name,
            truncated: true,
            result: resultText.slice(0, 900),
            next: 'inspect a narrower target if more detail is needed',
          },
        );
      } catch (error) {
        return JSON.stringify({
          ok: false,
          name,
          error: 'execution_failed',
          message: (error instanceof Error ? error.message : String(error)).slice(0, 500),
          retry: 'inspect_or_adjust_then_run',
        });
      }
    },
  }),
};

export interface LocalToolSelection {
  groups: LocalToolGroup[];
  suggestedTools: EngineToolName[];
  tools: typeof LOCAL_ENGINE_GATEWAY_TOOLS;
}

export function chooseLocalEngineTools(prompt: string): LocalToolSelection {
  const selected = new Set<LocalToolGroup>(['core']);
  for (const [group, intent] of GROUP_INTENTS) {
    if (intent.test(prompt)) selected.add(group);
  }

  // Ambiguous edit requests still need the common object and logic controls. Read-only questions
  // can stay on the tiny core inspection surface.
  if (selected.size === 1 && !/^\s*(what|which|where|how many|list|show|inspect|describe|explain|is|are)\b/i.test(prompt)) {
    selected.add('scene');
    selected.add('blueprints');
  }

  const suggestedTools = rankLocalEngineTools(prompt).slice(0, 4);
  for (const name of suggestedTools) selected.add(TOOL_GROUP.get(name) ?? 'core');

  return {
    groups: [...selected],
    suggestedTools,
    tools: LOCAL_ENGINE_GATEWAY_TOOLS,
  };
}
