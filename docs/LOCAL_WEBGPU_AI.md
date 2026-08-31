# Local WebGPU AI for Feather Engine — Implementation Plan

> **Goal:** let Feather Engine run an optional LLM directly on the user's device using WebGPU, while keeping the existing OpenAI, Anthropic, and Google providers available.
>
> The local model must remain a **real Feather Agent**: it should stream text, call the existing `engineTools`, execute multi-step editor actions, support cancellation, and work without an API key after the model has been downloaded.

## 1. Why this fits the current engine

Feather Engine already has most of the architecture required for local AI:

- `src/ai/providers.ts` resolves cloud providers into Vercel AI SDK `LanguageModel`s.
- `src/ai/useAIChat.ts` uses `streamText()` and the existing `engineTools` agent loop.
- `src/ai/tools.ts` is already the shared tool surface for the editor.
- `src/ai/systemPrompt.ts` already provides the compact engine guide and live scene/project context.
- `src/store/aiSettingsStore.ts` persists provider/model settings.
- `src/components/AIChatWidget.tsx` already has provider/model settings UI.
- `docs/AI_ASSISTANT.md` already establishes the rule that AI capabilities should mirror editor capabilities.

The local implementation should therefore **extend the provider layer**, not create a separate local chatbot.

## 2. Recommended technical direction

Use:

```bash
npm install @browser-ai/transformers-js @huggingface/transformers
```

The project already uses Vercel AI SDK 6 (`ai`), and the Transformers.js AI SDK provider supports the same `streamText()`, tool calling, streaming, Web Workers, cancellation, model availability checks, and download progress flow.

Recommended stack:

```text
Feather Agent UI
      |
      v
useAIChat.ts
      |
      v
Vercel AI SDK streamText()
      |
      +---------------------------+
      |                           |
      v                           v
Cloud providers              Local provider
OpenAI / Claude / Gemini     @browser-ai/transformers-js
                                  |
                                  v
                           Transformers.js
                                  |
                                  v
                           ONNX Runtime Web
                                  |
                                  v
                              WebGPU
                                  |
                                  v
                           User GPU / device
```

The most important rule is:

> **Do not fork the agent logic.** Local models and cloud models should receive the same `engineTools`, system guide, snapshot, chat history, stop signal, and tool-step loop whenever possible.

---

# 3. Phase 1 — Add a Local provider

## 3.1 Extend provider types

Refactor `src/ai/providers.ts` so provider ids include a local provider.

Suggested types:

```ts
export type RemoteProviderId = 'openai' | 'anthropic' | 'google';
export type ProviderId = RemoteProviderId | 'local';
```

Avoid forcing local-provider metadata into fields that only make sense for cloud providers, such as `keysUrl`.

Suggested provider metadata:

```ts
interface BaseProviderInfo {
  id: ProviderId;
  label: string;
}

interface RemoteProviderInfo extends BaseProviderInfo {
  kind: 'remote';
  keysUrl: string;
  models: string[];
}

interface LocalProviderInfo extends BaseProviderInfo {
  kind: 'local';
  models: string[];
}
```

Add:

```ts
local: {
  id: 'local',
  kind: 'local',
  label: 'Local AI (WebGPU)',
  models: [
    'onnx-community/Qwen3-0.6B-ONNX',
  ],
}
```

### Acceptance criteria

- `ProviderId` accepts `local`.
- Existing cloud-provider behavior is unchanged.
- Local provider does not require or display an API key.

---

# 4. Phase 2 — Create a local model catalog

Do not scatter Hugging Face ids throughout UI code.

Create:

```text
src/ai/local/
  localModelCatalog.ts
```

Suggested model definition:

```ts
export interface LocalModelDefinition {
  id: string;
  label: string;
  description: string;
  tier: 'fast' | 'balanced' | 'advanced';
  device: 'webgpu';
  dtype?: string;
  approximateDownloadMb?: number;
  toolCalling: boolean;
  vision?: boolean;
  recommended?: boolean;
  experimental?: boolean;
}
```

Start with a deliberately small catalog rather than allowing arbitrary Hugging Face models immediately.

## Recommended V1 models

### Fast / default

```text
onnx-community/Qwen3-0.6B-ONNX
```

Use this as the first default because the local agent depends heavily on tool calling and multi-step command planning.

### Lightweight fallback / testing

```text
HuggingFaceTB/SmolLM2-360M-Instruct
```

Useful for testing the provider pipeline and very lightweight chat, but do not assume it will match Qwen for complex Feather tool use.

### Future balanced tier

Add a larger Qwen/Gemma-class model only after benchmarking it against Feather's real tool suite.

Do **not** choose models only by chatbot quality. Benchmark:

- correct tool selection;
- valid tool arguments;
- multi-step completion;
- scene inspection before mutation;
- ability to recover from tool errors;
- latency while the Three.js editor is rendering.

---

# 5. Phase 3 — Local model runtime and Web Worker

Create:

```text
src/ai/local/
  localAIWorker.ts
  localModelManager.ts
  localModelCatalog.ts
  localAI.types.ts
```

## 5.1 Worker

The LLM must not run on the editor's main UI thread.

Suggested worker:

```ts
import { TransformersJSWorkerHandler } from '@browser-ai/transformers-js';

const handler = new TransformersJSWorkerHandler();

self.onmessage = (message: MessageEvent) => {
  handler.onmessage(message);
};
```

The Vite worker should be constructed as a module worker.

```ts
new Worker(new URL('./localAIWorker.ts', import.meta.url), {
  type: 'module',
});
```

## 5.2 Model manager

Create a process-wide model/session manager instead of constructing a new worker/model on every user message.

Suggested responsibilities:

```ts
interface LocalModelManager {
  isWebGPUSupported(): boolean;
  getAvailability(modelId: string): Promise<'unavailable' | 'downloadable' | 'available'>;
  install(modelId: string, onProgress?: (progress: number) => void): Promise<void>;
  getLanguageModel(modelId: string): LanguageModel;
  dispose(modelId?: string): Promise<void>;
  getStorageEstimate(): Promise<StorageEstimate>;
}
```

Maintain one cached runtime instance per selected model.

Conceptually:

```text
LocalModelManager
    |
    +-- Qwen3 worker/session
    |
    +-- future model session
```

For V1, only keep **one loaded model in GPU memory at a time**. When the user switches local models, dispose the previous session before loading the next one.

This matters because Feather Engine is already using the GPU for Three.js rendering.

---

# 6. Phase 4 — Browser model installation and cache

A model should behave like an installed editor component from the user's point of view.

Expected UX:

```text
Local AI Models

Qwen3 0.6B
Fast local agent
~download size
[ Download ]

Downloading model...
██████████████------ 67%

Qwen3 0.6B
Installed
[ Use Model ] [ Remove ]
```

Transformers.js uses browser Cache Storage, so first use downloads the model and later sessions can reuse the cached files.

## Model states

Use explicit states:

```ts
type LocalModelState =
  | 'unsupported'
  | 'not-installed'
  | 'downloading'
  | 'installed'
  | 'loading'
  | 'ready'
  | 'error';
```

Track progress separately:

```ts
interface LocalModelRuntimeState {
  modelId: string;
  state: LocalModelState;
  progress: number;
  error?: string;
}
```

## Storage information

Use:

```ts
navigator.storage.estimate()
```

to show approximate total site storage usage/quota.

For V1, provide a **Clear Local AI Cache** action if reliable per-model deletion is not available without depending on internal cache-key formats.

Do not implement fragile deletion logic that assumes Hugging Face/Transformers.js cache URL internals will never change.

Future V2 can track downloaded resources and support reliable per-model removal.

---

# 7. Phase 5 — Integrate local models into `resolveModel()`

The best result is for `useAIChat.ts` to continue receiving an AI SDK `LanguageModel` regardless of where inference happens.

Target API:

```ts
const model = resolveModel({
  provider: settings.provider,
  apiKey,
  modelId: routedModelId,
});
```

Cloud path:

```text
resolveModel(openai) -> OpenAI LanguageModel
resolveModel(anthropic) -> Anthropic LanguageModel
resolveModel(google) -> Gemini LanguageModel
```

Local path:

```text
resolveModel(local) -> Transformers.js LanguageModel
```

Suggested local construction:

```ts
transformersJS(modelId, {
  device: 'webgpu',
  worker: localWorker,
});
```

The exact instance lifecycle should live in `localModelManager.ts`, not directly inside `providers.ts`.

---

# 8. Phase 6 — Preserve Feather's existing agent/tool loop

This is the most important functional requirement.

Today `useAIChat.ts` does roughly:

```ts
streamText({
  model,
  messages: history,
  tools: engineTools,
  stopWhen: stepCountIs(16),
  abortSignal,
});
```

Keep this shape for local models.

The local agent must be able to perform workflows such as:

```text
User:
"Create a small third-person scene with a floor, character and three pickups."

Local model
  -> inspect scene
  -> create floor
  -> create character
  -> configure controller
  -> create pickup 1
  -> create pickup 2
  -> create pickup 3
  -> configure UI
  -> answer user
```

The model must use the same `engineTools` as cloud AI and MCP.

Do not create local-only mutations such as:

```text
localAgentCreateObject()
```

Instead keep:

```text
engineTools.create_object
engineTools.update_transform
engineTools.set_character_controller
...
```

This preserves the "mirror, don't fork" principle already documented in `AI_ASSISTANT.md`.

---

# 9. Phase 7 — Local-friendly prompt and tool routing

Feather's tool surface is large. A tiny local model may perform worse if hundreds of tools and a very large prompt are sent on every generation step.

This should be treated as a first-class optimization project.

## 9.1 Replace `chooseActiveTools()` all-tools behavior

`useAIChat.ts` currently has a `chooseActiveTools()` helper but effectively makes the whole `engineTools` set available.

Introduce tool groups:

```text
scene
objects
terrain
models
animation
blueprints
ui
cinematics
audio
plugins
export
inspection
```

Then route a prompt to a smaller tool subset.

Example:

```text
"Add a health bar"
      |
      v
intent router
      |
      +-- inspection tools
      +-- UI tools
      +-- object-variable tools
```

Avoid asking a 0.6B model to choose between the entire engine API when only 10–30 tools are relevant.

## 9.2 Keep a safe minimum set

Always expose basic inspection/navigation tools needed for recovery.

Example:

```ts
const CORE_TOOLS = [
  'list_scene',
  'inspect_object',
  'list_scenes',
];
```

## 9.3 Local compact prompt

Do not initially send the full long-form engine documentation to local models.

Continue using `COMPACT_ENGINE_GUIDE`, but create optional capability-specific prompt sections based on active tool groups.

Target:

```text
base Feather rules
+ compact current scene snapshot
+ relevant capability guide
+ relevant tool schemas
+ recent conversation
```

This will probably improve local tool accuracy more than moving immediately from a 0.6B model to a much larger model.

---

# 10. Phase 8 — AI settings / Model Manager UI

Refactor the current `SettingsPanel` in `AIChatWidget.tsx`.

When a cloud provider is selected, preserve the existing UI:

```text
Provider: OpenAI
Model: ...
API key: ...
Smart routing: ...
```

When Local AI is selected:

```text
Provider
[ Local AI (WebGPU) ]

Device
WebGPU: Ready

Model
Qwen3 0.6B       Recommended
Fast local agent
Status: Installed
[ Use ] [ Remove ]

Storage
Local AI/site data: 620 MB
[ Clear Local AI Cache ]

Agent mode
[ Fast ] [ Balanced ] [ Advanced ]   (future)
```

## Chat header

Instead of:

```text
OpenAI · gpt-5
```

show:

```text
Local · Qwen3 0.6B · WebGPU
```

During first use:

```text
Downloading AI model · 43%
```

During GPU load:

```text
Loading local AI…
```

During generation:

```text
Working locally
```

---

# 11. Phase 9 — Update `aiSettingsStore`

Current settings assume all providers have API keys.

Refactor to make local state explicit.

Suggested additions:

```ts
interface AISettingsState {
  provider: ProviderId;
  apiKeys: Record<RemoteProviderId, string>;
  models: Record<ProviderId, string>;

  localAI: {
    preferredModel: string;
    autoDownload: boolean;
    allowCloudFallback: boolean;
  };
}
```

Do **not** persist runtime objects, Worker instances, model sessions, or progress in Zustand persistence.

Persist only user choices.

Runtime/download state should live in a separate non-persisted store or manager.

---

# 12. Phase 10 — Smart model routing

The current smart routing chooses a cheaper cloud model for simple read-only questions.

Extend it so local AI can participate.

Possible modes:

```text
AI Routing

Local First
  Simple commands/questions -> Qwen3 local
  Difficult task -> selected cloud model

Local Only
  Everything -> selected WebGPU model
  Never send prompts to cloud

Cloud Only
  Current behavior
```

Suggested V1 behavior:

### Local provider selected

Always remain local.

### Cloud provider selected + Local First enabled

```text
simple inspection/question
        -> local model

large build/edit request
        -> selected cloud model
```

Never silently send a request to cloud if the user explicitly selected **Local Only**.

Privacy must be obvious in the UI.

---

# 13. Phase 11 — Hardware capability detection

Add:

```text
src/ai/local/localHardware.ts
```

Check at minimum:

```ts
'navigator' in globalThis && 'gpu' in navigator
```

Then attempt:

```ts
const adapter = await navigator.gpu.requestAdapter();
```

Report states such as:

```text
WebGPU available
WebGPU unavailable
GPU adapter unavailable
Model load failed / insufficient resources
```

Do **not** pretend the browser can always report exact VRAM. Browser GPU information is intentionally limited and inconsistent.

Use conservative capability tiers based on supported APIs, adapter limits where useful, device memory hints where available, and eventually a tiny benchmark.

Recommended behavior:

```text
Unknown / low confidence -> recommend smallest model
Successful small-model benchmark -> unlock balanced suggestions
Larger model load fails -> return to previous model cleanly
```

---

# 14. Phase 12 — GPU coexistence with the game editor

Feather Engine uses Three.js/WebGL/WebGPU-related GPU resources for rendering, so local LLM inference must not make the editor unpleasant to use.

Add safeguards:

1. Only one local LLM loaded at once.
2. Run inference in a Web Worker.
3. Default to a small quantized model.
4. Dispose sessions when switching models.
5. Add an optional **Unload Local AI** button.
6. Avoid automatically loading a multi-GB model when Feather starts.
7. Load the model only when the user explicitly downloads/uses Local AI.
8. Measure editor frame time while inference is active.

Potential future optimization:

```text
User interacting heavily with viewport
      -> lower AI generation priority / pause optional work

Editor idle
      -> allow full local inference
```

Do not build this scheduler in V1 unless benchmarks prove it is necessary.

---

# 15. Phase 13 — Tauri support

Feather also runs through Tauri.

The current CSP already allows:

```text
worker-src 'self' blob:
connect-src ... https:
```

which is compatible with module workers and HTTPS model downloads in principle.

Still test WebGPU independently in:

- Chromium desktop browser;
- Windows Tauri WebView;
- macOS Tauri WebView;
- Linux Tauri/WebKit environment if supported by the release target.

Do not claim Local AI support for a platform until the packaged Tauri build passes a real model-load/inference smoke test.

If a platform lacks working WebGPU, show:

```text
Local AI is unavailable on this device.
Choose OpenAI, Anthropic, or Gemini instead.
```

No crash and no endless loading state.

---

# 16. Phase 14 — Model download UX

Never make a large model download feel accidental.

Before first download, show:

```text
Download Qwen3 0.6B for Local AI?

Runs on your device with WebGPU.
No API key is required.
The model will be stored in this browser/app cache.

Approximate download: ...

[ Cancel ] [ Download ]
```

During download:

- percentage;
- model name;
- Cancel where supported;
- clear error/retry state.

After download:

```text
✓ Ready for Local AI
```

Avoid saying the model is permanently installed. Browser/app cache can be removed by the OS or user.

---

# 17. Phase 15 — Tool approval / safety mode

A local model can make mistakes just like a cloud model.

Feather's tool system can make significant project changes, so add an optional execution policy.

Suggested modes:

```text
Agent Permissions

Automatic
  Execute allowed editor tools immediately.

Ask for destructive actions
  Create/update automatically.
  Confirm delete, package install, export, large scene reset, etc.

Review every action
  Ask before mutations.
```

This is especially useful while benchmarking smaller local models.

Mark destructive/high-impact tools with metadata instead of hardcoding tool names in UI code.

Future shape:

```ts
interface FeatherToolMetadata {
  category: ToolCategory;
  mutatesProject: boolean;
  risk: 'read' | 'write' | 'destructive' | 'external';
}
```

---

# 18. Phase 16 — Local AI benchmark suite

Do not select the default model from general chatbot benchmarks.

Create Feather-specific tests under:

```text
src/ai/__tests__/local/
```

Also create a manual benchmark script/page if browser WebGPU cannot be reliably tested in CI.

## Benchmark prompts

### Read

```text
What objects are in my scene?
```

Expected:

```text
list_scene
```

### Simple mutation

```text
Create a cube at 0, 2, 0.
```

Expected:

```text
create_object
update_transform if necessary
```

### Multi-step

```text
Create a third-person character with a floor and three pickups.
```

Expected multi-tool chain.

### UI

```text
Create a health HUD in the top-left.
```

### Animation

```text
Inspect this character and configure an idle/walk animator.
```

### Recovery

Give the model a stale/nonexistent object id and confirm it reacts to tool failure instead of hallucinating success.

## Metrics

Capture:

```text
success rate
tool selection accuracy
schema/argument validity
number of tool steps
completion time
time to first token
tokens/second
model load time
browser memory/GPU failure rate
editor FPS impact
```

A smaller model should become the default if its actual Feather task success is close enough to larger models while using much less memory.

---

# 19. Phase 17 — Tests

## Unit tests

Add coverage for:

```text
local model catalog
provider selection
remote providers still resolve correctly
local provider does not require API key
WebGPU capability state
model-state transitions
model switch/dispose behavior
routing mode
local-only privacy behavior
```

## Mock the model boundary

Do not download a real 500MB+ model in normal Vitest runs.

Mock `LocalModelManager` / AI SDK model behavior for unit tests.

## Browser smoke test

Create a separate optional WebGPU smoke test that:

1. detects WebGPU;
2. loads the smallest supported test model;
3. generates a short response;
4. calls a harmless mock tool;
5. disposes the model.

Keep this outside ordinary fast CI unless the runner is explicitly WebGPU-capable.

---

# 20. Proposed file changes

## Existing files to modify

```text
package.json
src/ai/providers.ts
src/ai/useAIChat.ts
src/store/aiSettingsStore.ts
src/components/AIChatWidget.tsx
src/ai/systemPrompt.ts               optional local prompt optimization
src/ai/tools.ts                      optional tool metadata/categories
```

## New files

```text
src/ai/local/localAIWorker.ts
src/ai/local/localModelManager.ts
src/ai/local/localModelCatalog.ts
src/ai/local/localHardware.ts
src/ai/local/localAI.types.ts
src/store/localAIStore.ts            runtime/progress state only
src/ai/__tests__/local/
```

Potential later UI extraction:

```text
src/components/ai/AIProviderSettings.tsx
src/components/ai/LocalModelManager.tsx
src/components/ai/LocalModelCard.tsx
```

This extraction is recommended if `AIChatWidget.tsx` starts becoming too large.

---

# 21. Suggested implementation sequence

Implement in this order:

## Milestone A — prove local generation

1. Install dependencies.
2. Create `localAIWorker.ts`.
3. Create one hardcoded Qwen3 local model.
4. Run a plain text `streamText()` call.
5. Confirm streaming and cancellation.

**Done when:** Feather can answer `Hello` locally without an API key.

## Milestone B — prove Feather tool calling

1. Pass a small subset of `engineTools`.
2. Ask Qwen to inspect the scene.
3. Ask it to create a cube.
4. Verify multi-step tool calls.

**Done when:** a local model changes the live scene through the exact existing tool layer.

## Milestone C — provider integration

1. Add `local` to provider types/settings.
2. Route `useAIChat()` through the same provider resolution path.
3. Remove API-key requirement for local.
4. Preserve cloud-provider behavior.

**Done when:** switching the Provider dropdown changes between cloud and local AI without changing the Agent UI.

## Milestone D — model manager UI

1. Availability state.
2. Download button.
3. Progress bar.
4. Installed/ready state.
5. Cache/storage controls.
6. Unsupported-device state.

**Done when:** a non-technical user can set up Local AI without DevTools or terminal commands.

## Milestone E — optimize local agent reliability

1. Tool categories.
2. Prompt-based active-tool routing.
3. Smaller local prompt sections.
4. Benchmark Qwen against other candidate models.
5. Tune max steps/max tokens.

**Done when:** local AI can reliably perform representative Feather editing workflows.

## Milestone F — hybrid routing

1. Local Only.
2. Local First.
3. Cloud Only/current behavior.
4. Clear privacy indicators.

**Done when:** users control whether project prompts ever leave their device.

---

# 22. V1 scope — keep this intentionally small

Ship V1 with:

- one recommended local model;
- WebGPU only;
- one model loaded at a time;
- Web Worker inference;
- browser/app model caching;
- download progress;
- same Feather `engineTools` agent loop;
- local-provider UI;
- local model works without API key;
- cloud providers unchanged;
- clear unsupported-device fallback;
- basic Local AI cache clearing;
- tool subset optimization if required for Qwen reliability.

Do **not** block V1 on:

- dozens of models;
- automatic VRAM detection;
- per-model cache deletion if the provider does not expose it safely;
- vision models;
- Whisper;
- embeddings/RAG;
- GPU scheduling;
- automatic benchmark-based model selection;
- fully offline application packaging.

Those can follow after the core local Feather Agent is stable.

---

# 23. V2 opportunities

Once local text/tool calling is reliable, the same infrastructure can grow beyond an LLM.

```text
Feather Local AI Runtime
        |
        +-- LLM
        |    Qwen / Gemma / other WebGPU models
        |
        +-- Vision
        |    inspect screenshots / scene renders
        |
        +-- Speech
        |    Whisper transcription / voice commands
        |
        +-- Embeddings
             semantic asset, docs and project search
```

Possible workflows:

```text
"Look at my current game and improve the lighting"
    -> capture screenshot
    -> local vision model
    -> local/planning LLM
    -> Feather lighting tools
```

```text
"Find the script that handles player damage"
    -> local embeddings/search
    -> agent inspection tools
```

```text
voice command
    -> local Whisper
    -> Feather local agent
    -> engineTools
```

The model manager should therefore use generic concepts such as `LocalModelDefinition`, task/capability metadata, and shared cache/runtime status rather than being named specifically after Qwen.

---

# 24. Final target architecture

```text
                         Feather Agent
                              |
                              v
                        useAIChat.ts
                              |
                  +-----------+-----------+
                  |                       |
                  v                       v
            Prompt/context            engineTools
                  |                       |
                  +-----------+-----------+
                              |
                              v
                     Vercel AI SDK 6
                              |
          +-------------------+-------------------+
          |                   |                   |
          v                   v                   v
       OpenAI              Anthropic            Google
          |
          |         OR
          |
          +-------------------+
                              |
                              v
                      Local AI provider
                              |
                              v
                 @browser-ai/transformers-js
                              |
                              v
                         Web Worker
                              |
                              v
                       Transformers.js
                              |
                              v
                      ONNX Runtime Web
                              |
                              v
                           WebGPU
                              |
                              v
                         User's GPU
```

The user-facing result should feel simple:

```text
AI Provider

○ OpenAI
○ Anthropic
○ Gemini
● Local AI

Qwen3 0.6B
✓ Installed
✓ Runs on this device
✓ No API key

[ Use Local AI ]
```

while internally the local model remains capable of using the same Feather Engine tools as the cloud agents.

---

# Definition of done

Local WebGPU AI is considered ready for the first release when all of these are true:

- [ ] User can select `Local AI (WebGPU)` in the Agent settings.
- [ ] No API key is requested for local mode.
- [ ] Unsupported WebGPU devices receive a clear error/fallback UI.
- [ ] First model use shows download progress.
- [ ] Model data is reused from browser/app cache on later sessions.
- [ ] Inference runs through a Web Worker rather than blocking the editor UI thread.
- [ ] Generated text streams into the existing Agent panel.
- [ ] Stop/cancel works.
- [ ] Local AI receives the existing scene snapshot and compact engine guide.
- [ ] Local AI can call existing `engineTools`.
- [ ] At least one multi-step scene-building benchmark succeeds reliably.
- [ ] Switching back to OpenAI/Anthropic/Google still works.
- [ ] Only one local LLM is resident at once.
- [ ] Model-load failure can recover without reloading Feather Engine.
- [ ] Local Only mode never silently falls back to a cloud provider.
- [ ] `npm run build` passes.
- [ ] Existing AI/tool tests remain green.
- [ ] Browser WebGPU smoke test passes on at least one supported Chromium desktop environment.
- [ ] Packaged Tauri support is advertised only on platforms where a real inference smoke test passes.
