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
    case 'update_transform':
      return 'Moved object';
    case 'update_renderer':
      return input.textureAssetId ? 'Applied texture' : 'Updated material';
    case 'set_model':
      return input.assetId ? 'Assigned model' : 'Cleared model';
    case 'create_material':
      return `Created material${input.name ? ` "${String(input.name)}"` : ''}`;
    case 'update_material':
      return 'Updated material';
    case 'set_object_material':
      return input.materialId ? 'Assigned material' : 'Detached material';
    case 'delete_material':
      return 'Deleted material';
    case 'set_physics':
      return 'Configured physics';
    case 'rename_object':
      return `Renamed to "${String(input.name ?? '')}"`;
    case 'select_object':
      return 'Selected object';
    case 'delete_object':
      return 'Deleted object';
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
