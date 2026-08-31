import type { TransformersJSLanguageModel } from '@browser-ai/transformers-js';
import type { LanguageModel } from 'ai';
import { useLocalAIStore } from '../../store/localAIStore';
import type { LocalModelDefinition } from './localModelCatalog';
import { sanitizeLocalModelText } from './localTextSanitizer';

const FUNCTION_START = '<start_function_call>';
const FUNCTION_END = '<end_function_call>';
const ESCAPE = '<escape>';

let toolCallSequence = 0;
let preflightSequence = 0;

interface PromptPreflightWorker {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}

type ModelCallOptions = Parameters<TransformersJSLanguageModel['doStream']>[0];

export class LocalPromptBudgetError extends Error {
  constructor(readonly tokenCount: number, readonly tokenBudget: number) {
    super(
      `This local request expands to ${tokenCount.toLocaleString()} prompt tokens, above this GPU's safe ${tokenBudget.toLocaleString()}-token prefill limit. Shorten the request or start a new local turn.`,
    );
    this.name = 'LocalPromptBudgetError';
  }
}

const estimatePromptTokens = (options: ModelCallOptions) =>
  Math.ceil(JSON.stringify({ prompt: options.prompt, tools: options.tools }).length / 3);

async function countPromptTokens(
  worker: PromptPreflightWorker,
  options: ModelCallOptions,
): Promise<number> {
  preflightSequence += 1;
  const requestId = `feather-prefill-${preflightSequence}`;
  return new Promise<number>((resolve) => {
    let settled = false;
    const finish = (value: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      worker.removeEventListener('message', onMessage);
      resolve(value);
    };
    const onMessage = (event: MessageEvent) => {
      const data = event.data as {
        type?: string;
        requestId?: string;
        tokenCount?: number;
        error?: string;
      };
      if (data.type !== 'feather-token-count-result' || data.requestId !== requestId) return;
      finish(typeof data.tokenCount === 'number' ? data.tokenCount : estimatePromptTokens(options));
    };
    const timeout = setTimeout(() => finish(estimatePromptTokens(options)), 5000);
    worker.addEventListener('message', onMessage);
    try {
      worker.postMessage({
        type: 'feather-token-count',
        requestId,
        prompt: options.prompt,
        tools: options.tools,
        enableThinking: options.providerOptions?.['transformers-js']?.enableThinking === true,
      });
    } catch {
      finish(estimatePromptTokens(options));
    }
  });
}

async function enforcePromptBudget(worker: PromptPreflightWorker, options: ModelCallOptions) {
  const hardwareBudget = useLocalAIStore.getState().hardware.prefillTokenBudget ?? 512;
  const hasToolResults = options.prompt.some((message) => message.role === 'tool');
  // Later agent steps reuse the worker's KV prefix and only prefill the newly appended tool result.
  // Still cap their full transcript so a cache miss cannot recreate the original 23k-token failure.
  const tokenBudget = hasToolResults ? hardwareBudget * 4 : hardwareBudget;
  const tokenCount = await countPromptTokens(worker, options);
  if (tokenCount > tokenBudget) throw new LocalPromptBudgetError(tokenCount, tokenBudget);
}

export interface ParsedFunctionGemmaCall {
  toolName: string;
  input: Record<string, unknown>;
  text: string;
}

export interface ParsedLocalToolCall extends ParsedFunctionGemmaCall {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const parseJsonRecord = (value: unknown): Record<string, unknown> | null => {
  if (isRecord(value)) return value;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const normalizeEngineInput = (toolName: string, input: Record<string, unknown>) => {
  const aliased = parseJsonRecord(input.arguments)
    ?? parseJsonRecord(input.parameters)
    ?? parseJsonRecord(input.args)
    ?? input;
  const nested = toolName !== 'run_engine_tool' && parseJsonRecord(aliased.input);
  const normalized = { ...(nested ?? aliased) };
  if (toolName === 'create_object' && normalized.kind === 'box') normalized.kind = 'cube';
  return normalized;
};

/** Keep every family on Feather's two-function gateway, even if a tiny model calls an action directly. */
export function normalizeLocalToolCall(toolName: string, input: Record<string, unknown>) {
  if (toolName === 'search_engine_tools') return { toolName, input };
  if (toolName === 'run_engine_tool') {
    const engineName = typeof input.name === 'string' ? input.name : '';
    const engineInput = parseJsonRecord(input.input)
      ?? parseJsonRecord(input.arguments)
      ?? parseJsonRecord(input.parameters)
      ?? parseJsonRecord(input.args)
      ?? {};
    return {
      toolName,
      input: {
        name: engineName,
        input: normalizeEngineInput(engineName, engineInput),
      },
    };
  }
  return {
    toolName: 'run_engine_tool',
    input: {
      name: toolName,
      input: normalizeEngineInput(toolName, input),
    },
  };
}

function parsedJsonToolCall(value: unknown): { toolName: string; input: Record<string, unknown> } | null {
  const record = parseJsonRecord(value);
  if (!record) return null;
  const functionEnvelope = isRecord(record.function) ? record.function : null;
  const toolName = functionEnvelope?.name ?? record.name ?? record.toolName ?? record.tool;
  if (typeof toolName !== 'string' || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(toolName)) return null;
  const rawInput = functionEnvelope?.arguments
    ?? record.arguments
    ?? record.parameters
    ?? record.args
    ?? record.input
    ?? {};
  return { toolName, input: parseJsonRecord(rawInput) ?? {} };
}

/** Recovery for model-family outputs that look like calls but the provider emitted as plain text. */
export function parseLocalToolCall(text: string): ParsedLocalToolCall | null {
  const gemma = parseFunctionGemmaToolCall(text);
  if (gemma) return gemma;

  const patterns = [
    /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/i,
    /<\|tool_call_start\|>\s*([\s\S]*?)\s*<\|tool_call_end\|>/i,
    /```(?:tool_call|tool-call|json)\s*([\s\S]*?)```/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    const parsed = parsedJsonToolCall(match[1].trim());
    if (!parsed) continue;
    return {
      ...parsed,
      text: sanitizeLocalModelText(`${text.slice(0, match.index)}${text.slice(match.index + match[0].length)}`),
    };
  }

  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    const parsed = parsedJsonToolCall(trimmed);
    if (parsed) return { ...parsed, text: '' };
  }
  return null;
}

class FunctionGemmaValueParser {
  private index = 0;

  constructor(private readonly source: string) {}

  parseArguments(): Record<string, unknown> {
    const value = this.parseObject();
    this.skipWhitespace();
    if (this.index !== this.source.length) throw new Error('Unexpected content after function arguments.');
    return value;
  }

  private parseObject(): Record<string, unknown> {
    this.expect('{');
    const value: Record<string, unknown> = {};
    this.skipWhitespace();
    if (this.consume('}')) return value;

    while (this.index < this.source.length) {
      const key = this.parseKey();
      this.skipWhitespace();
      this.expect(':');
      value[key] = this.parseValue();
      this.skipWhitespace();
      if (this.consume('}')) return value;
      this.expect(',');
    }

    throw new Error('Unterminated function argument object.');
  }

  private parseArray(): unknown[] {
    this.expect('[');
    const value: unknown[] = [];
    this.skipWhitespace();
    if (this.consume(']')) return value;

    while (this.index < this.source.length) {
      value.push(this.parseValue());
      this.skipWhitespace();
      if (this.consume(']')) return value;
      this.expect(',');
    }

    throw new Error('Unterminated function argument array.');
  }

  private parseKey(): string {
    this.skipWhitespace();
    if (this.source.startsWith(ESCAPE, this.index)) return this.parseEscapedString();

    const start = this.index;
    while (this.index < this.source.length && this.source[this.index] !== ':') this.index += 1;
    const key = this.source.slice(start, this.index).trim();
    if (!key) throw new Error('Function argument key is missing.');
    return key;
  }

  private parseValue(): unknown {
    this.skipWhitespace();
    if (this.source.startsWith(ESCAPE, this.index)) return this.parseEscapedString();
    if (this.source[this.index] === '{') return this.parseObject();
    if (this.source[this.index] === '[') return this.parseArray();

    const start = this.index;
    while (
      this.index < this.source.length &&
      this.source[this.index] !== ',' &&
      this.source[this.index] !== '}' &&
      this.source[this.index] !== ']'
    ) {
      this.index += 1;
    }
    const token = this.source.slice(start, this.index).trim();
    if (token === 'true') return true;
    if (token === 'false') return false;
    if (token === 'null') return null;
    if (token && Number.isFinite(Number(token))) return Number(token);
    return token;
  }

  private parseEscapedString(): string {
    this.expect(ESCAPE);
    const end = this.source.indexOf(ESCAPE, this.index);
    if (end < 0) throw new Error('Unterminated escaped function argument.');
    const value = this.source.slice(this.index, end);
    this.index = end + ESCAPE.length;
    return value;
  }

  private skipWhitespace() {
    while (/\s/.test(this.source[this.index] ?? '')) this.index += 1;
  }

  private consume(token: string): boolean {
    this.skipWhitespace();
    if (!this.source.startsWith(token, this.index)) return false;
    this.index += token.length;
    return true;
  }

  private expect(token: string) {
    if (!this.consume(token)) throw new Error(`Expected "${token}" in function call.`);
  }
}

export function stripFunctionGemmaControlTokens(text: string): string {
  return sanitizeLocalModelText(text);
}

export function parseFunctionGemmaToolCall(text: string): ParsedFunctionGemmaCall | null {
  const start = text.indexOf(FUNCTION_START);
  if (start < 0) return null;
  const end = text.indexOf(FUNCTION_END, start + FUNCTION_START.length);
  if (end < 0) return null;

  const call = text.slice(start + FUNCTION_START.length, end).trim();
  if (!call.startsWith('call:')) return null;
  const argumentStart = call.indexOf('{', 5);
  if (argumentStart < 0) return null;
  const toolName = call.slice(5, argumentStart).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(toolName)) return null;

  try {
    return {
      toolName,
      input: new FunctionGemmaValueParser(call.slice(argumentStart)).parseArguments(),
      text: stripFunctionGemmaControlTokens(
        `${text.slice(0, start)}${text.slice(end + FUNCTION_END.length)}`,
      ),
    };
  } catch {
    return null;
  }
}

type StreamResult = Awaited<ReturnType<TransformersJSLanguageModel['doStream']>>;
type StreamPart = StreamResult['stream'] extends ReadableStream<infer Part> ? Part : never;
type FinishPart = Extract<StreamPart, { type: 'finish' }>;

function sanitizeGenerateResult<T extends Awaited<ReturnType<TransformersJSLanguageModel['doGenerate']>>>(
  result: T,
): T {
  const rawText = result.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
  const hasNativeToolCall = result.content.some((part) => part.type === 'tool-call');
  const recovered = hasNativeToolCall ? null : parseLocalToolCall(rawText);
  if (recovered) {
    const normalized = normalizeLocalToolCall(recovered.toolName, recovered.input);
    return {
      ...result,
      content: [
        ...(recovered.text ? [{ type: 'text' as const, text: recovered.text }] : []),
        {
          type: 'tool-call' as const,
          toolCallId: nextToolCallId(),
          toolName: normalized.toolName,
          input: JSON.stringify(normalized.input),
        },
      ],
      finishReason: { unified: 'tool-calls' as const, raw: 'tool-calls' },
    } as T;
  }
  return {
    ...result,
    content: result.content
      .filter((part) => part.type !== 'reasoning')
      .map((part) => {
        if (part.type === 'text') return { ...part, text: sanitizeLocalModelText(part.text) };
        if (part.type !== 'tool-call') return part;
        const normalized = normalizeLocalToolCall(part.toolName, parseJsonRecord(part.input) ?? {});
        return { ...part, toolName: normalized.toolName, input: JSON.stringify(normalized.input) };
      })
      .filter((part) => part.type !== 'text' || Boolean(part.text)) as typeof result.content,
  } as T;
}

function sanitizeStreamResult(result: StreamResult): StreamResult {
  const stream = new ReadableStream<StreamPart>({
    async start(controller) {
      const reader = result.stream.getReader();
      let rawText = '';
      let finish: FinishPart | undefined;
      const nativeCalls: Array<{ toolCallId: string; toolName: string; input: string }> = [];
      const partialCalls = new Map<string, { toolName: string; input: string }>();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value.type === 'text-delta') {
            rawText += value.delta;
          } else if (value.type === 'text-start' || value.type === 'text-end') {
            // Local output is intentionally buffered so reasoning/tool delimiters never flash in chat.
          } else if (value.type === 'reasoning-start' || value.type === 'reasoning-delta' || value.type === 'reasoning-end') {
            // Private local-model reasoning is intentionally never rendered in Feather chat.
          } else if (value.type === 'tool-input-start') {
            partialCalls.set(value.id, { toolName: value.toolName, input: '' });
          } else if (value.type === 'tool-input-delta') {
            const partial = partialCalls.get(value.id);
            if (partial) partial.input += value.delta;
          } else if (value.type === 'tool-input-end') {
            // A final tool-call normally follows. Keep this as a fallback for providers that omit it.
          } else if (value.type === 'tool-call') {
            nativeCalls.push(value);
            partialCalls.delete(value.toolCallId);
          } else if (value.type === 'finish') {
            finish = value;
          } else {
            controller.enqueue(value);
          }
        }

        for (const [toolCallId, partial] of partialCalls) {
          nativeCalls.push({ toolCallId, toolName: partial.toolName, input: partial.input || '{}' });
        }
        const recovered = nativeCalls.length ? null : parseLocalToolCall(rawText);
        const visibleText = sanitizeLocalModelText(recovered?.text ?? rawText);
        if (visibleText) {
          controller.enqueue({ type: 'text-start', id: 'text-0' });
          controller.enqueue({ type: 'text-delta', id: 'text-0', delta: visibleText });
          controller.enqueue({ type: 'text-end', id: 'text-0' });
        }

        const calls = recovered
          ? [{ toolCallId: nextToolCallId(), toolName: recovered.toolName, input: JSON.stringify(recovered.input) }]
          : nativeCalls;
        for (const call of calls) {
          const normalized = normalizeLocalToolCall(call.toolName, parseJsonRecord(call.input) ?? {});
          controller.enqueue({
            type: 'tool-call',
            toolCallId: call.toolCallId,
            toolName: normalized.toolName,
            input: JSON.stringify(normalized.input),
          });
        }
        if (finish) {
          controller.enqueue(
            calls.length
              ? { ...finish, finishReason: { unified: 'tool-calls', raw: 'tool-calls' } }
              : finish,
          );
        }
        controller.close();
      } catch (error) {
        controller.enqueue({ type: 'error', error } as StreamPart);
        controller.close();
      } finally {
        reader.releaseLock();
      }
    },
  });
  return { ...result, stream };
}

function nextToolCallId() {
  toolCallSequence += 1;
  return `local-tool-${toolCallSequence}`;
}

/** Adapts model-family control tokens without forking Feather's AI SDK agent loop. */
export function adaptLocalLanguageModel(
  model: TransformersJSLanguageModel,
  definition: LocalModelDefinition,
  worker?: PromptPreflightWorker,
): LanguageModel {
  const guardedModel = {
    specificationVersion: model.specificationVersion,
    provider: model.provider,
    modelId: model.modelId,
    supportedUrls: model.supportedUrls,
    doGenerate: async (options: Parameters<TransformersJSLanguageModel['doGenerate']>[0]) => {
      if (worker) await enforcePromptBudget(worker, options);
      return model.doGenerate(options);
    },
    doStream: async (options: Parameters<TransformersJSLanguageModel['doStream']>[0]) => {
      if (worker) await enforcePromptBudget(worker, options);
      return model.doStream(options);
    },
  };

  if (definition.toolFormat !== 'functiongemma') {
    return {
      ...guardedModel,
      doGenerate: async (options: Parameters<TransformersJSLanguageModel['doGenerate']>[0]) =>
        sanitizeGenerateResult(await guardedModel.doGenerate(options)),
      doStream: async (options: Parameters<TransformersJSLanguageModel['doStream']>[0]) =>
        sanitizeStreamResult(await guardedModel.doStream(options)),
    } as LanguageModel;
  }

  const adapted = {
    specificationVersion: model.specificationVersion,
    provider: model.provider,
    modelId: model.modelId,
    supportedUrls: model.supportedUrls,
    doGenerate: async (options: Parameters<TransformersJSLanguageModel['doGenerate']>[0]) => {
      const result = await guardedModel.doGenerate(options);
      const rawText = result.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('');
      const parsed = parseFunctionGemmaToolCall(rawText);

      if (!parsed) return sanitizeGenerateResult(result);

      const normalized = normalizeLocalToolCall(parsed.toolName, parsed.input);

      return {
        ...result,
        content: [
          ...(parsed.text ? [{ type: 'text' as const, text: parsed.text }] : []),
          {
            type: 'tool-call' as const,
            toolCallId: nextToolCallId(),
            toolName: normalized.toolName,
            input: JSON.stringify(normalized.input),
          },
        ],
        finishReason: { unified: 'tool-calls' as const, raw: 'tool-calls' },
      };
    },
    doStream: async (options: Parameters<TransformersJSLanguageModel['doStream']>[0]) => {
      return sanitizeStreamResult(await guardedModel.doStream(options));
    },
  };

  return adapted as LanguageModel;
}
