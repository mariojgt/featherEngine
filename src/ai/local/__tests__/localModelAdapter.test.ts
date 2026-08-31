import type { TransformersJSLanguageModel } from '@browser-ai/transformers-js';
import { describe, expect, it, vi } from 'vitest';
import {
  adaptLocalLanguageModel,
  LocalPromptBudgetError,
  parseFunctionGemmaToolCall,
  stripFunctionGemmaControlTokens,
} from '../localModelAdapter';
import { getLocalModelDefinition } from '../localModelCatalog';
import { useLocalAIStore } from '../../../store/localAIStore';

describe('FunctionGemma tool adapter', () => {
  it('converts the Gemma function-call grammar into JSON-safe engine arguments', () => {
    const parsed = parseFunctionGemmaToolCall(
      'Planning <start_function_call>call:update_object{objectId:<escape>player-1<escape>,transform:{position:[1,2.5,-3]},visible:true}<end_function_call><end_of_turn>',
    );

    expect(parsed).toEqual({
      toolName: 'update_object',
      input: {
        objectId: 'player-1',
        transform: { position: [1, 2.5, -3] },
        visible: true,
      },
      text: 'Planning',
    });
  });

  it('supports escaped nested keys and values', () => {
    expect(
      parseFunctionGemmaToolCall(
        '<start_function_call>call:set_object_variable{key:<escape>display,name<escape>,value:{<escape>label<escape>:<escape>Ready: yes<escape>}}<end_function_call>',
      ),
    ).toMatchObject({
      toolName: 'set_object_variable',
      input: { key: 'display,name', value: { label: 'Ready: yes' } },
    });
  });

  it('leaves malformed calls as text instead of executing them', () => {
    expect(parseFunctionGemmaToolCall('<start_function_call>call:delete_object{bad<end_function_call>')).toBeNull();
    expect(stripFunctionGemmaControlTokens('Done<end_of_turn>')).toBe('Done');
  });

  it('turns a streamed FunctionGemma control block into an AI SDK tool call', async () => {
    const rawCall =
      '<start_function_call>call:create_object{name:<escape>Gemma Cube<escape>,kind:<escape>box<escape>}<end_function_call><end_of_turn>';
    const baseModel = {
      specificationVersion: 'v3',
      provider: 'transformers-js',
      modelId: 'onnx-community/functiongemma-270m-it-ONNX',
      supportedUrls: {},
      doGenerate: vi.fn(),
      doStream: vi.fn(async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] });
            controller.enqueue({ type: 'text-start', id: 'text-0' });
            controller.enqueue({ type: 'text-delta', id: 'text-0', delta: rawCall });
            controller.enqueue({ type: 'text-end', id: 'text-0' });
            controller.enqueue({
              type: 'finish',
              finishReason: { unified: 'stop', raw: 'stop' },
              usage: {
                inputTokens: { total: 10 },
                outputTokens: { total: 8 },
              },
            });
            controller.close();
          },
        }),
      })),
    } as unknown as TransformersJSLanguageModel;
    const adapted = adaptLocalLanguageModel(
      baseModel,
      getLocalModelDefinition('onnx-community/functiongemma-270m-it-ONNX'),
    ) as unknown as {
      doStream(options: object): Promise<{ stream: ReadableStream<Record<string, unknown>> }>;
    };

    const { stream } = await adapted.doStream({});
    const parts: Record<string, unknown>[] = [];
    const reader = stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
    }

    expect(parts).toContainEqual({
      type: 'tool-call',
      toolCallId: expect.stringMatching(/^local-tool-/),
      toolName: 'create_object',
      input: JSON.stringify({ name: 'Gemma Cube', kind: 'box' }),
    });
    expect(parts.at(-1)).toMatchObject({
      type: 'finish',
      finishReason: { unified: 'tool-calls', raw: 'tool-calls' },
    });
    expect(parts.some((part) => part.type === 'text-delta')).toBe(false);
  });
});

describe('Local prompt preflight', () => {
  const createWorker = (tokenCount: number) => {
    const listeners = new Set<(event: MessageEvent) => void>();
    return {
      addEventListener: (_type: 'message', listener: (event: MessageEvent) => void) => listeners.add(listener),
      removeEventListener: (_type: 'message', listener: (event: MessageEvent) => void) => listeners.delete(listener),
      postMessage: (message: unknown) => {
        const request = message as { type: string; requestId: string };
        if (request.type !== 'feather-token-count') return;
        queueMicrotask(() => {
          const event = new MessageEvent('message', {
            data: {
              type: 'feather-token-count-result',
              requestId: request.requestId,
              tokenCount,
            },
          });
          listeners.forEach((listener) => listener(event));
        });
      },
    };
  };

  const callOptions = {
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'Build a cube' }] }],
    tools: [],
  } as never;

  it('rejects an oversized first prefill before calling the ONNX model', async () => {
    useLocalAIStore.setState({
      hardware: { state: 'available', shaderF16: true, prefillTokenBudget: 512 },
    });
    const doStream = vi.fn();
    const baseModel = {
      specificationVersion: 'v3',
      provider: 'transformers-js',
      modelId: 'onnx-community/Qwen3-4B-ONNX',
      supportedUrls: {},
      doGenerate: vi.fn(),
      doStream,
    } as unknown as TransformersJSLanguageModel;
    const adapted = adaptLocalLanguageModel(
      baseModel,
      getLocalModelDefinition('onnx-community/Qwen3-4B-ONNX'),
      createWorker(23832),
    ) as unknown as { doStream(options: unknown): Promise<unknown> };

    await expect(adapted.doStream(callOptions)).rejects.toBeInstanceOf(LocalPromptBudgetError);
    expect(doStream).not.toHaveBeenCalled();
  });

  it('allows a request within the adapter-derived prefill tier', async () => {
    useLocalAIStore.setState({
      hardware: { state: 'available', shaderF16: true, prefillTokenBudget: 1024 },
    });
    const expected = { stream: new ReadableStream() };
    const doStream = vi.fn(async () => expected);
    const baseModel = {
      specificationVersion: 'v3',
      provider: 'transformers-js',
      modelId: 'onnx-community/Qwen3-4B-ONNX',
      supportedUrls: {},
      doGenerate: vi.fn(),
      doStream,
    } as unknown as TransformersJSLanguageModel;
    const adapted = adaptLocalLanguageModel(
      baseModel,
      getLocalModelDefinition('onnx-community/Qwen3-4B-ONNX'),
      createWorker(780),
    ) as unknown as { doStream(options: unknown): Promise<unknown> };

    const result = await adapted.doStream(callOptions) as { stream: ReadableStream };
    expect(result.stream).toBeInstanceOf(ReadableStream);
    expect(result.stream).not.toBe(expected.stream);
    expect(doStream).toHaveBeenCalledOnce();
  });
});

describe('Native local-model stream cleanup', () => {
  it('never forwards streamed Qwen reasoning/control tokens to the AI SDK chat loop', async () => {
    const baseModel = {
      specificationVersion: 'v3',
      provider: 'transformers-js',
      modelId: 'onnx-community/Qwen3-0.6B-ONNX',
      supportedUrls: {},
      doGenerate: vi.fn(),
      doStream: vi.fn(async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] });
            controller.enqueue({ type: 'text-start', id: 'text-0' });
            controller.enqueue({ type: 'text-delta', id: 'text-0', delta: '<thi' });
            controller.enqueue({ type: 'text-delta', id: 'text-0', delta: 'nk>private' });
            controller.enqueue({ type: 'text-delta', id: 'text-0', delta: '</think>\nDone' });
            controller.enqueue({ type: 'text-delta', id: 'text-0', delta: '.<|im_end|>' });
            controller.enqueue({ type: 'text-end', id: 'text-0' });
            controller.enqueue({
              type: 'finish',
              finishReason: { unified: 'stop', raw: 'stop' },
              usage: { inputTokens: { total: 20 }, outputTokens: { total: 5 } },
            });
            controller.close();
          },
        }),
      })),
    } as unknown as TransformersJSLanguageModel;
    const adapted = adaptLocalLanguageModel(
      baseModel,
      getLocalModelDefinition('onnx-community/Qwen3-0.6B-ONNX'),
    ) as unknown as {
      doStream(options: object): Promise<{ stream: ReadableStream<{ type: string; delta?: string }> }>;
    };

    const { stream } = await adapted.doStream({});
    const deltas: string[] = [];
    const reader = stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.type === 'text-delta' && value.delta) deltas.push(value.delta);
    }

    expect(deltas.join('')).toBe('Done.');
  });
});
