# Feather Engine — working notes

Browser-only Vite + React + TypeScript 3D game-engine editor. State lives in a single
Zustand store ([src/store/editorStore.ts](src/store/editorStore.ts)). 3D via
react-three-fiber + rapier; visual scripting via @xyflow/react.

## Commands
- `npm run dev` — web dev server (vite, fixed port 1420)
- `npm run build` — type-check (`tsc -b`) + production web build; must pass before done
- `npm run tauri:dev` — run the desktop app (Tauri); `npm run tauri:build` — package `.app`/`.dmg`
- `cd src-tauri && cargo check` — compile-check the Rust shell + validate `tauri.conf.json`/capabilities

## Architecture notes
- **Projects & scenes:** a project has multiple `Scene`s; exactly one is active (`activeSceneId`).
  Read the active scene's objects with the exported `selectActiveObjects` selector — never an inline
  `state.scenes.find(...)`. Object mutators go through `mapActiveSceneObjects` (which also sets `isDirty`).
  `tickRuntime`/`setPlaying` must NOT set `isDirty`.
- **Platform/files:** `src/platform/` abstracts disk access (Tauri desktop vs web fallback);
  `src/project/serialize.ts` splits/joins the project folder and migrates legacy files.
  `src/store/projectStore.ts` owns new/open/save and the Launcher.
- **Desktop viewport:** the environment is self-contained (`Lightformer`s, no external HDRI) so it
  renders offline and under the Tauri CSP. Loading disk assets uses `convertFileSrc` (`asset://`).
- **Physics:** during Play a real Rapier rigid-body world ([src/runtime/physicsWorld.ts](src/runtime/physicsWorld.ts),
  headless `@dimforge/rapier3d-compat`) is the authority. `tickRuntime` runs scripts, then a post-pass
  feeds each physics-enabled object's scripted motion/impulses into its body, steps the world, and copies
  transforms back. Rendering is unchanged (meshes read `object.transform`). Scripted motion maps to bodies
  by `bodyType`: dynamic → per-axis velocity control + `applyImpulse`; kinematic → `setNextKinematic*`;
  fixed → teleport on explicit script moves. Contacts surface via `runtimeCollisions` (one-frame delayed)
  which fires `event.collisionEnter`. WASM inits on module import; `getActivePhysics()` is null until ready.

## ⚠️ AI assistant must stay in sync
This project ships an agentic AI chat assistant ([src/ai/](src/ai/),
[src/components/AIChatWidget.tsx](src/components/AIChatWidget.tsx)) that drives the editor by
calling tools.

**Whenever you add or change a user-facing capability, you must also update the assistant** so it
can use it. A feature isn't done until the AI chat is aware of it. Follow the checklist in
[docs/AI_ASSISTANT.md](docs/AI_ASSISTANT.md):
1. AI-friendly store action (explicit params, returns ids)
2. Tool in [src/ai/tools.ts](src/ai/tools.ts)
3. Chip label in `describeToolCall` ([src/ai/useAIChat.ts](src/ai/useAIChat.ts))
4. Update `ENGINE_GUIDE` and, if there's new state, `buildSceneSnapshot()` in
   [src/ai/systemPrompt.ts](src/ai/systemPrompt.ts)
5. `npm run build` and verify in the running app

New visual-scripting node types touch extra files — see the "new node type" section in
[docs/AI_ASSISTANT.md](docs/AI_ASSISTANT.md).
