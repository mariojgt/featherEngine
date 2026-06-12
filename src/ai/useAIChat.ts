import { useCallback, useRef, useState } from 'react';
import { type ModelMessage, stepCountIs, streamText } from 'ai';
import { FAST_MODELS, PROVIDERS, resolveModel } from './providers';
import { useAISettings } from '../store/aiSettingsStore';
import { COMPACT_ENGINE_GUIDE, buildSnapshotContext } from './systemPrompt';
import { engineTools } from './tools';

export interface ToolAction {
  id: string;
  label: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  actions: ToolAction[];
}

export type ChatStatus = 'idle' | 'streaming';

const newId = () => crypto.randomUUID();
const MAX_CONTEXT_MESSAGES = 6;
const MAX_HISTORY_CHARS = 1200;
type EngineToolName = keyof typeof engineTools;

const trimForModelHistory = (content: string) =>
  content.length > MAX_HISTORY_CHARS ? `${content.slice(0, MAX_HISTORY_CHARS)}... [trimmed]` : content;

const chooseActiveTools = (_prompt: string): EngineToolName[] => Object.keys(engineTools) as EngineToolName[];

// --- Smart model routing -------------------------------------------------------------------------
// Short, read-only questions ("what's in my scene?", "how many enemies are there?") don't need the
// big model — the provider's fast tier (Haiku / mini / flash, ~1/5th the price) answers them with
// the same tools. Anything that BUILDS or EDITS stays on the user's selected model. The heuristic
// is deliberately conservative: any build/edit verb forces the big model.
const BUILD_VERBS =
  /\b(make|create|build|add|spawn|place|set\s?up|setup|design|generate|write|script|wire|connect|animate|fix|change|update|move|rotate|scale|delete|remove|replace|attach|detach|import|export|tune|improve|implement|give|turn|paint|sculpt|play|start|stop|undo|redo|rename|duplicate|apply)\b/i;
const SIMPLE_OPENERS =
  /^(what|which|where|who|how many|how much|how does|is|are|does|do|did|can|could|should|why|when|list|show|tell|explain|describe|count)\b/i;

const isSimpleQuery = (text: string): boolean =>
  text.length <= 160 && SIMPLE_OPENERS.test(text) && !BUILD_VERBS.test(text);

/** Human-friendly label for a tool call shown as a chip in the chat. */
function describeToolCall(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case 'list_scene':
      return 'Inspected scene';
    case 'inspect_object':
      return 'Inspected object';
    case 'inspect_blueprint':
      return 'Inspected blueprint';
    case 'inspect_animator_controller':
      return 'Inspected controller';
    case 'list_scenes':
      return 'Listed scenes';
    case 'create_scene':
      return `Created scene${input.name ? ` "${String(input.name)}"` : ''}`;
    case 'switch_scene':
      return 'Switched scene';
    case 'rename_scene':
      return `Renamed scene to "${String(input.name ?? '')}"`;
    case 'create_object':
      return `Created ${String(input.kind ?? 'object')}`;
    case 'create_terrain':
      return 'Created terrain';
    case 'update_terrain':
      return 'Updated terrain';
    case 'sculpt_terrain':
      return 'Sculpted terrain';
    case 'paint_terrain':
      return 'Painted terrain';
    case 'paint_foliage':
      return input.erase ? 'Erased foliage' : 'Painted foliage';
    case 'add_terrain_layer':
      return 'Added terrain layer';
    case 'update_terrain_layer':
      return 'Updated terrain layer';
    case 'set_object_parent':
      return input.parentId ? 'Nested object' : 'Detached object';
    case 'create_prefab':
      return 'Created prefab';
    case 'inspect_prefab':
      return 'Inspected prefab';
    case 'export_prefab_package':
      return 'Exported package';
    case 'export_folder_package':
      return 'Exported folder package';
    case 'import_package':
      return 'Imported package';
    case 'instantiate_prefab':
      return 'Added prefab to scene';
    case 'open_prefab':
      return 'Opened prefab editor';
    case 'close_prefab':
      return input.save === false ? 'Discarded prefab edits' : 'Saved prefab';
    case 'rename_prefab':
      return `Renamed prefab to "${String(input.name ?? '')}"`;
    case 'delete_prefab':
      return 'Deleted prefab';
    case 'apply_instance_to_prefab':
      return 'Applied changes to prefab';
    case 'revert_instance_to_prefab':
      return 'Reverted to prefab';
    case 'update_transform':
      return 'Moved object';
    case 'update_renderer':
      return input.textureAssetId ? 'Applied texture' : input.opacity !== undefined ? 'Set opacity' : 'Updated material';
    case 'set_scene_audio':
      return 'Set scene audio';
    case 'set_scene_environment':
      return 'Set scene environment';
    case 'apply_lighting_preset':
      return `Applied ${String(input.preset ?? 'lighting')} look`;
    case 'set_inventory':
      return 'Set inventory';
    case 'equip_slot':
      return 'Equipped weapon';
    case 'set_model':
      return input.assetId ? 'Assigned model' : 'Cleared model';
    case 'set_animator':
      return input.enabled === false ? 'Stopped animation' : 'Set animation';
    case 'create_animator_controller':
      return `Created controller${input.name ? ` "${String(input.name)}"` : ''}`;
    case 'add_animator_parameter':
      return `Added param "${String(input.name ?? '')}"`;
    case 'add_animator_state':
      return `Added state "${String(input.name ?? '')}"`;
    case 'update_animator_state':
      return 'Updated state';
    case 'add_animator_transition':
      return 'Added transition';
    case 'set_blendspace':
      return Array.isArray(input.samples) && input.samples.length ? 'Set blend space' : 'Cleared blend space';
    case 'set_object_controller':
      return input.controllerId ? 'Assigned controller' : 'Detached controller';
    case 'set_anim_parameter':
      return `Set ${String(input.paramName ?? 'param')}`;
    case 'set_ragdoll':
      return input.on === false ? 'Ragdoll off' : 'Ragdoll on';
    case 'set_ragdoll_settings':
      return 'Tuned ragdoll';
    case 'generate_ragdoll_bodies':
      return 'Generated ragdoll bodies';
    case 'set_ragdoll_body':
      return `Set body "${String(input.boneName ?? 'bone')}"`;
    case 'remove_ragdoll_body':
      return 'Removed ragdoll body';
    case 'set_character_controller':
      return input.enabled === false ? 'Removed character control' : 'Set character controller';
    case 'set_vehicle':
      return input.enabled === false ? 'Removed vehicle control' : 'Set vehicle controller';
    case 'customize_vehicle':
      return 'Customized vehicle';
    case 'create_driving_template':
      return 'Built driving template';
    case 'create_sim_racing_template':
      return 'Built sim racing template';
    case 'create_character_pawn':
      return 'Created character pawn';
    case 'add_gameplay_kit':
      return `Added ${String(input.kit ?? 'gameplay')} kit`;
    case 'create_third_person_template':
      return 'Built third-person template';
    case 'create_first_person_template':
      return 'Built FPS template';
    case 'create_film_mode_template':
      return 'Built "The Summit" cinematic template';
    case 'create_cinematic':
      return `Created cinematic${input.name ? ` "${String(input.name)}"` : ''}`;
    case 'add_cinematic_action':
      return 'Added cinematic action';
    case 'update_cinematic_action':
      return 'Updated cinematic action';
    case 'add_cinematic_shot':
      return 'Added camera shot';
    case 'add_cinematic_transition':
      return `Added ${typeof input.style === 'string' ? input.style : ''} transition`.replace('  ', ' ').trim();
    case 'add_cinematic_library_shot':
      return `Added ${typeof input.shotType === 'string' ? input.shotType : ''} shot`.replace('  ', ' ').trim();
    case 'set_cinematic_look':
      return 'Set film look';
    case 'animate_on_timeline':
      return 'Animated on timeline';
    case 'play_cinematic':
      return input.stop ? 'Stopped cinematic' : 'Played cinematic';
    case 'list_bones':
      return 'Listed bones';
    case 'attach_to_bone':
      return input.targetObjectId ? 'Attached to bone' : 'Detached';
    case 'set_attachment_offset':
      return 'Set attach offset';
    case 'add_skeleton_socket':
      return `Added socket "${String(input.name ?? '')}"`;
    case 'attach_to_socket':
      return input.socketName ? 'Attached to socket' : 'Detached';
    case 'create_material':
      return `Created material${input.name ? ` "${String(input.name)}"` : ''}`;
    case 'apply_material_preset':
      return `Applied ${String(input.preset ?? 'material')} preset`;
    case 'update_material':
      return 'Updated material';
    case 'set_object_material':
      return input.materialId ? 'Assigned material' : 'Detached material';
    case 'set_submesh_material':
      return input.materialId ? `Set slot ${String(input.slotIndex ?? 0)} material` : `Reset slot ${String(input.slotIndex ?? 0)} material`;
    case 'delete_material':
      return 'Deleted material';
    case 'add_material_node':
      return `Added ${String(input.type ?? 'material')} node`;
    case 'connect_material_nodes':
      return 'Wired material nodes';
    case 'update_material_node':
      return 'Tuned material node';
    case 'delete_material_node':
      return 'Removed material node';
    case 'create_particle_system':
      return `Created particle system${input.preset ? ` (${String(input.preset)})` : ''}`;
    case 'update_particle_system':
      return 'Tuned particle system';
    case 'delete_particle_system':
      return 'Deleted particle system';
    case 'attach_particle_system':
      return input.particleSystemId ? 'Attached particle system' : 'Detached particle system';
    case 'set_physics':
      return input.isTrigger ? 'Configured trigger' : 'Configured physics';
    case 'create_water_volume':
      return `Created ${String(input.style ?? 'ocean')} water`;
    case 'update_water_volume':
      return input.style ? `Set ${String(input.style)} water` : 'Tuned water';
    case 'add_joint':
      return `Added ${String(input.type ?? '')} joint`.replace('  ', ' ');
    case 'update_joint':
      return 'Tuned joint';
    case 'remove_joint':
      return 'Removed joint';
    case 'create_cloth':
      return 'Created cloth';
    case 'update_cloth':
      return 'Tuned cloth';
    case 'remove_cloth':
      return 'Removed cloth';
    case 'set_fracture':
      return input.enabled === false ? 'Removed destructible' : 'Made destructible';
    case 'set_light':
      return `Configured ${String(input.type ?? '')} light`.replace('  ', ' ');
    case 'set_render_settings':
      return input.compressTextures !== undefined
        ? `Texture compression ${input.compressTextures ? 'on' : 'off'}`
        : 'Updated post-processing';
    case 'rename_object':
      return `Renamed to "${String(input.name ?? '')}"`;
    case 'undo':
      return 'Undid edit';
    case 'redo':
      return 'Redid edit';
    case 'select_object':
      return 'Selected object';
    case 'delete_object':
      return 'Deleted object';
    case 'duplicate_object':
      return input.count && Number(input.count) > 1 ? `Duplicated ×${String(input.count)}` : 'Duplicated object';
    case 'group_objects':
      return `Grouped ${Array.isArray(input.ids) ? input.ids.length : ''} objects`.trim();
    case 'spawn_grid':
      return `Spawned ${String(input.rows ?? '')}×${String(input.cols ?? '')} grid`;
    case 'align_objects':
      return `Aligned on ${String(input.axis ?? '')}`;
    case 'distribute_objects':
      return `Distributed on ${String(input.axis ?? '')}`;
    case 'batch_transform':
      return 'Batch-transformed objects';
    case 'create_blueprint':
      return `Created blueprint${input.name ? ` "${String(input.name)}"` : ''}`;
    case 'create_folder':
      return `Created folder${input.name ? ` "${String(input.name)}"` : ''}`;
    case 'move_to_folder':
      return input.folderId ? 'Moved to folder' : 'Moved to root';
    case 'create_variable':
      return `Created variable${input.name ? ` "${String(input.name)}"` : ''}`;
    case 'update_variable':
      return 'Updated variable';
    case 'add_blueprint_variable':
      return `Added instance variable${input.name ? ` "${String(input.name)}"` : ''}`;
    case 'update_blueprint_variable':
      return 'Updated instance variable';
    case 'remove_blueprint_variable':
      return 'Removed instance variable';
    case 'create_data_asset':
      return `Created Data Asset${input.name ? ` "${String(input.name)}"` : ''}`;
    case 'add_data_asset_column':
      return 'Added Data Asset column';
    case 'add_data_asset_row':
      return 'Added Data Asset row';
    case 'set_data_asset_cell':
      return 'Set Data Asset cell';
    case 'set_quality':
      return `Set quality to ${String(input.level ?? '')}`.trim();
    case 'add_node':
      return `Added "${String(input.type ?? 'node')}" node`;
    case 'connect_nodes':
      return 'Wired nodes';
    case 'update_node':
      return 'Tuned node';
    case 'attach_blueprint':
      return 'Attached blueprint';
    case 'open_object_script':
      return 'Opened object script';
    case 'create_ui_document':
      return `Created UI${input.name ? ` "${String(input.name)}"` : ''}`;
    case 'create_ui_template':
      return `Created ${String(input.template ?? 'HUD')} UI`;
    case 'set_ui_render_mode':
      return input.renderMode === 'webgl' ? 'UI → WebGL renderer' : 'UI → DOM renderer';
    case 'add_ui_element':
      return `Added ${String(input.kind ?? 'UI')} element`;
    case 'add_ui_preset':
      return `Added ${String(input.preset ?? 'UI')} preset`;
    case 'move_ui_element':
      return 'Moved UI element';
    case 'duplicate_ui_element':
      return 'Duplicated UI element';
    case 'update_ui_element':
      return 'Updated UI element';
    case 'bind_ui_element':
      return input.expression ? 'Bound UI element' : 'Cleared UI binding';
    case 'attach_world_ui':
      return input.documentId ? (input.diegetic ? 'Attached diegetic screen' : 'Attached world UI') : 'Detached world UI';
    case 'set_object_variable':
      return `Set ${String(input.key ?? 'variable')}`;
    case 'create_collectible_counter':
      return `Created ${String(input.label ?? input.variableName ?? 'collectible')} pickup`;
    case 'open_ui_logic':
      return 'Opened UI logic';
    case 'delete_ui_document':
      return 'Deleted UI document';
    case 'set_playing':
      return input.playing ? 'Started Play' : 'Stopped Play';
    case 'fire_event':
      return `Fired "${String(input.eventName ?? '')}"`;
    case 'export_game':
      return 'Exported game';
    case 'export_production':
      return 'Staged production build';
    default:
      return toolName;
  }
}

export function useAIChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus('idle');
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || status === 'streaming') return;

    const settings = useAISettings.getState();
    const apiKey = settings.activeKey();
    const providerLabel = PROVIDERS[settings.provider].label;

    if (!apiKey) {
      setError(`Add your ${providerLabel} API key in settings to start chatting.`);
      return;
    }
    setError(null);

    const userMessage: ChatMessage = { id: newId(), role: 'user', content: trimmed, actions: [] };
    const assistantId = newId();
    const assistantMessage: ChatMessage = { id: assistantId, role: 'assistant', content: '', actions: [] };

    // Cache-aware request layout (Anthropic prompt caching is a PREFIX match; tools render first,
    // then system, then messages — three breakpoints, stable → volatile):
    //  bp1 guide      — tools + engine guide are static, so every call reads them at ~10%.
    //  bp2 snapshot   — when the scene didn't change between turns (follow-up questions), the
    //                   snapshot prefix is byte-identical and reads from cache too.
    //  bp3 user msg   — the agentic loop below re-sends the whole prefix on every one of its up-to-16
    //                   tool steps; this breakpoint makes steps 2..16 read snapshot+history at ~10%
    //                   instead of paying full price each step.
    // OpenAI/Gemini ignore the markers and auto-cache the same stable prefix.
    const cachePoint = { anthropic: { cacheControl: { type: 'ephemeral' as const } } };
    const history: ModelMessage[] = [
      {
        role: 'system',
        content: COMPACT_ENGINE_GUIDE,
        providerOptions: cachePoint,
      },
      { role: 'system', content: buildSnapshotContext(), providerOptions: cachePoint },
      ...messages.slice(-MAX_CONTEXT_MESSAGES).map((message) => ({
        role: message.role,
        content: trimForModelHistory(message.content),
      })),
      { role: userMessage.role, content: userMessage.content, providerOptions: cachePoint },
    ];

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setStatus('streaming');

    const updateAssistant = (mutate: (message: ChatMessage) => ChatMessage) =>
      setMessages((prev) => prev.map((message) => (message.id === assistantId ? mutate(message) : message)));

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // Smart routing: short read-only questions go to the provider's fast tier (~1/5th the price).
      const routedModelId =
        settings.smartRouting && isSimpleQuery(trimmed) ? FAST_MODELS[settings.provider] : settings.activeModel();
      const model = resolveModel(settings.provider, apiKey, routedModelId);
      const result = streamText({
        model,
        messages: history,
        tools: engineTools,
        stopWhen: stepCountIs(16),
        abortSignal: controller.signal,
      });

      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') {
          updateAssistant((message) => ({ ...message, content: message.content + part.text }));
        } else if (part.type === 'tool-call') {
          const action: ToolAction = {
            id: part.toolCallId,
            label: describeToolCall(part.toolName, (part.input ?? {}) as Record<string, unknown>),
          };
          updateAssistant((message) => ({ ...message, actions: [...message.actions, action] }));
        } else if (part.type === 'error') {
          throw part.error;
        }
      }
    } catch (caught) {
      if (controller.signal.aborted) return;
      const detail = caught instanceof Error ? caught.message : 'Unknown error';
      setError(detail);
      updateAssistant((message) => ({
        ...message,
        content: message.content || '⚠️ Request failed. Check your API key, model and network, then try again.',
      }));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setStatus('idle');
    }
  }, [messages, status]);

  return { messages, status, error, sendMessage, clearMessages, stop };
}
