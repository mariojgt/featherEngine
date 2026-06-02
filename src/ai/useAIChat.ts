import { useCallback, useRef, useState } from 'react';
import { type ModelMessage, stepCountIs, streamText } from 'ai';
import { PROVIDERS, resolveModel } from './providers';
import { useAISettings } from '../store/aiSettingsStore';
import { buildSystemPrompt } from './systemPrompt';
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

/** Human-friendly label for a tool call shown as a chip in the chat. */
function describeToolCall(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case 'list_scene':
      return 'Inspected scene';
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
    case 'set_object_parent':
      return input.parentId ? 'Nested object' : 'Detached object';
    case 'create_prefab':
      return 'Created prefab';
    case 'inspect_prefab':
      return 'Inspected prefab';
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
    case 'create_character_pawn':
      return 'Created character pawn';
    case 'add_gameplay_kit':
      return `Added ${String(input.kit ?? 'gameplay')} kit`;
    case 'create_third_person_template':
      return 'Built third-person template';
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
    case 'update_material':
      return 'Updated material';
    case 'set_object_material':
      return input.materialId ? 'Assigned material' : 'Detached material';
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
    case 'set_physics':
      return input.isTrigger ? 'Configured trigger' : 'Configured physics';
    case 'set_light':
      return `Configured ${String(input.type ?? '')} light`.replace('  ', ' ');
    case 'set_render_settings':
      return 'Updated post-processing';
    case 'rename_object':
      return `Renamed to "${String(input.name ?? '')}"`;
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
    case 'create_data_asset':
      return `Created Data Asset${input.name ? ` "${String(input.name)}"` : ''}`;
    case 'add_data_asset_column':
      return 'Added Data Asset column';
    case 'add_data_asset_row':
      return 'Added Data Asset row';
    case 'set_data_asset_cell':
      return 'Set Data Asset cell';
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
      return input.documentId ? 'Attached world UI' : 'Detached world UI';
    case 'set_object_variable':
      return `Set ${String(input.key ?? 'variable')}`;
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

    // History sent to the model is the prior conversation plus this user turn.
    const history: ModelMessage[] = [...messages, userMessage].map((message) => ({
      role: message.role,
      content: message.content,
    }));

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setStatus('streaming');

    const updateAssistant = (mutate: (message: ChatMessage) => ChatMessage) =>
      setMessages((prev) => prev.map((message) => (message.id === assistantId ? mutate(message) : message)));

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const model = resolveModel(settings.provider, apiKey, settings.activeModel());
      const result = streamText({
        model,
        system: buildSystemPrompt(),
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
