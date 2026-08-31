import type { TransformersJSLanguageModel } from '@browser-ai/transformers-js';
import type { LanguageModel } from 'ai';
import { useLocalAIStore } from '../../store/localAIStore';
import type { LocalModelDefinition } from './localModelCatalog';
import { LocalModelTextSanitizer, sanitizeLocalModelText } from './localTextSanitizer';

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
  return {
    ...result,
    content: result.content
      .filter((part) => part.type !== 'reasoning')
      .map((part) => part.type === 'text' ? { ...part, text: sanitizeLocalModelText(part.text) } : part)
      .filter((part) => part.type !== 'text' || Boolean(part.text)) as typeof result.content,
  } as T;
}

function sanitizeStreamResult(result: StreamResult): StreamResult {
  const stream = new ReadableStream<StreamPart>({
    async start(controller) {
      const reader = result.stream.getReader();
      let sanitizer = new LocalModelTextSanitizer();
      let activeTextId = 'text-0';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value.type === 'text-start') {
            activeTextId = value.id;
            controller.enqueue(value);
          } else if (value.type === 'text-delta') {
            activeTextId = value.id;
            const delta = sanitizer.push(value.delta);
            if (delta) controller.enqueue({ ...value, delta });
          } else if (value.type === 'text-end') {
            const delta = sanitizer.finish();
            if (delta) controller.enqueue({ type: 'text-delta', id: activeTextId, delta } as StreamPart);
            controller.enqueue(value);
            sanitizer = new LocalModelTextSanitizer();
          } else if (value.type === 'reasoning-start' || value.type === 'reasoning-delta' || value.type === 'reasoning-end') {
            // Private local-model reasoning is intentionally never rendered in Feather chat.
          } else {
            controller.enqueue(value);
          }
        }
        const tail = sanitizer.finish();
        if (tail) controller.enqueue({ type: 'text-delta', id: activeTextId, delta: tail } as StreamPart);
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

      if (!parsed) {
        return {
          ...result,
          content: result.content.map((part) =>
            part.type === 'text' ? { ...part, text: stripFunctionGemmaControlTokens(part.text) } : part,
          ),
        };
      }

      return {
        ...result,
        content: [
          ...(parsed.text ? [{ type: 'text' as const, text: parsed.text }] : []),
          {
            type: 'tool-call' as const,
            toolCallId: nextToolCallId(),
            toolName: parsed.toolName,
            input: JSON.stringify(parsed.input),
          },
        ],
        finishReason: { unified: 'tool-calls' as const, raw: 'tool-calls' },
      };
    },
    doStream: async (options: Parameters<TransformersJSLanguageModel['doStream']>[0]) => {
      const result = await guardedModel.doStream(options);
      const stream = new ReadableStream<StreamPart>({
        async start(controller) {
          const reader = result.stream.getReader();
          let rawText = '';
          let finish: FinishPart | undefined;
          let nativeToolCall = false;

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value.type === 'text-delta') {
                rawText += value.delta;
              } else if (value.type === 'text-start' || value.type === 'text-end') {
                // Buffer this small model so its family-specific control tokens never flash in chat.
              } else if (value.type === 'finish') {
                finish = value;
              } else {
                if (value.type === 'tool-call' || value.type === 'tool-input-start') nativeToolCall = true;
                controller.enqueue(value);
              }
            }

            const parsed = nativeToolCall ? null : parseFunctionGemmaToolCall(rawText);
            const text = sanitizeLocalModelText(parsed?.text ?? stripFunctionGemmaControlTokens(rawText));
            if (text) {
              controller.enqueue({ type: 'text-start', id: 'text-0' });
              controller.enqueue({ type: 'text-delta', id: 'text-0', delta: text });
              controller.enqueue({ type: 'text-end', id: 'text-0' });
            }
            if (parsed) {
              controller.enqueue({
                type: 'tool-call',
                toolCallId: nextToolCallId(),
                toolName: parsed.toolName,
                input: JSON.stringify(parsed.input),
              });
            }
            if (finish) {
              controller.enqueue(
                parsed
                  ? { ...finish, finishReason: { unified: 'tool-calls', raw: 'tool-calls' } }
                  : finish,
              );
            }
            controller.close();
          } catch (error) {
            controller.enqueue({ type: 'error', error });
            controller.close();
          } finally {
            reader.releaseLock();
          }
        },
      });

      return { ...result, stream };
    },
  };

  return adapted as LanguageModel;
}
