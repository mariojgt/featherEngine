/// <reference lib="webworker" />

import { TransformersJSWorkerHandler } from '@browser-ai/transformers-js';
import { AutoTokenizer, env } from '@huggingface/transformers';
import { FEATHER_LOCAL_AI_CACHE } from './localCache';

interface FeatherTokenCountMessage {
  type: 'feather-token-count';
  requestId: string;
  prompt: Array<Record<string, unknown>>;
  tools?: Array<Record<string, unknown>>;
  enableThinking?: boolean;
}

let currentModelId: string | null = null;
let tokenizerPromise: ReturnType<typeof AutoTokenizer.from_pretrained> | null = null;

const normalizeArguments = (input: unknown) => {
  if (typeof input !== 'string') return input ?? {};
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
};

function convertPrompt(prompt: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return prompt.flatMap<Record<string, unknown>>((message) => {
    const role = message.role;
    if (role === 'system') return [{ role, content: String(message.content ?? '') }];
    const content = Array.isArray(message.content) ? message.content as Array<Record<string, unknown>> : [];
    if (role === 'user') {
      return [{
        role,
        content: content.filter((part) => part.type === 'text').map((part) => String(part.text ?? '')).join('\n'),
      }];
    }
    if (role === 'assistant') {
      const text = content.filter((part) => part.type === 'text').map((part) => String(part.text ?? '')).join('\n');
      const calls = content.filter((part) => part.type === 'tool-call').map((part) => ({
        id: part.toolCallId,
        type: 'function',
        function: { name: part.toolName, arguments: normalizeArguments(part.input) },
      }));
      return [{ role, content: text, ...(calls.length ? { tool_calls: calls } : {}) }];
    }
    if (role === 'tool') {
      return content.filter((part) => part.type === 'tool-result').map((part) => {
        const output = part.output as { type?: string; value?: unknown; reason?: unknown } | undefined;
        const result = output?.type?.startsWith('error')
          ? { error: true, message: output.value }
          : output?.type === 'execution-denied'
            ? { error: true, reason: output.reason }
            : output?.value;
        return {
          role,
          tool_call_id: part.toolCallId,
          name: part.toolName,
          content: typeof result === 'string' ? result : JSON.stringify(result),
        };
      });
    }
    return [];
  });
}

async function countTemplatedTokens(message: FeatherTokenCountMessage) {
  if (!currentModelId) throw new Error('Local model is not loaded.');
  tokenizerPromise ??= AutoTokenizer.from_pretrained(currentModelId);
  const tokenizer = await tokenizerPromise;
  const tools = message.tools?.map((definition) => ({
    type: 'function',
    function: {
      name: definition.name,
      description: definition.description ?? '',
      parameters: definition.inputSchema ?? definition.parameters ?? {},
    },
  }));
  const encoded = tokenizer.apply_chat_template(convertPrompt(message.prompt) as never, {
    add_generation_prompt: true,
    return_dict: true,
    ...(tools?.length ? { tools } : {}),
    ...(message.enableThinking ? { enable_thinking: true } : {}),
  }) as { input_ids: { data: ArrayLike<number> } };
  return encoded.input_ids.data.length;
}

const handlerPromise = (async () => {
  // Isolate model bytes from every other Cache Storage consumer on the origin so the user-facing
  // "Clear Local AI Cache" action cannot delete exported games, app assets, or service-worker data.
  if (typeof caches !== 'undefined') {
    try {
      env.customCache = await caches.open(FEATHER_LOCAL_AI_CACHE);
      env.useCustomCache = true;
      env.useBrowserCache = false;
    } catch {
      // Transformers.js gracefully falls back to its normal cache/network behavior.
    }
  }

  return new TransformersJSWorkerHandler();
})();

self.onmessage = (message: MessageEvent) => {
  const data = message.data as { type?: string; data?: { modelId?: string } } | FeatherTokenCountMessage;
  if (data.type === 'load') {
    const modelId = 'data' in data ? data.data?.modelId ?? null : null;
    if (modelId !== currentModelId) {
      currentModelId = modelId;
      tokenizerPromise = null;
    }
  }
  if (data.type === 'feather-token-count') {
    const countMessage = data as FeatherTokenCountMessage;
    void countTemplatedTokens(countMessage)
      .then((tokenCount) => self.postMessage({
        type: 'feather-token-count-result',
        requestId: countMessage.requestId,
        tokenCount,
      }))
      .catch((error) => self.postMessage({
        type: 'feather-token-count-result',
        requestId: countMessage.requestId,
        error: error instanceof Error ? error.message : 'Prompt tokenization failed.',
      }));
    return;
  }
  void handlerPromise
    .then((handler) => handler.onmessage(message))
    .catch((error) => {
      self.postMessage({
        status: 'error',
        data: error instanceof Error ? error.message : 'Local AI worker failed to start.',
      });
    });
};
