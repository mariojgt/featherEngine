# Keeping the AI Assistant in Sync

> **Rule of thumb:** every time you add a capability a user can perform in the editor,
> the AI chat assistant must learn to do it too. A feature isn't "done" until the
> assistant can use it. Treat this as part of the definition of done.

The assistant ([`AIChatWidget`](../src/components/AIChatWidget.tsx)) is **agentic**: the model
calls *tools* that mutate the editor's Zustand store, and changes apply live. For the model to
use a new feature it needs three things — **a way to do it** (a tool), **a way to describe it**
(the chip label), and **a way to know about it** (the system prompt + scene snapshot).

## The pieces

| File | Role |
|------|------|
| [`src/store/editorStore.ts`](../src/store/editorStore.ts) | The source of truth. AI-friendly actions take explicit params and **return ids**. |
| [`src/ai/tools.ts`](../src/ai/tools.ts) | `engineTools` — the toolset the model can call. Each tool = a `zod` schema + an `execute` that calls the store. |
| [`src/ai/systemPrompt.ts`](../src/ai/systemPrompt.ts) | `ENGINE_GUIDE` (what the engine is + how to use it) and `buildSceneSnapshot()` (the live project state injected every turn). |
| [`src/ai/useAIChat.ts`](../src/ai/useAIChat.ts) | `describeToolCall()` — the human-readable chip shown when a tool runs. |

## Checklist — adding a new capability to the AI

Work top to bottom; skip a step only if it genuinely doesn't apply.

1. **Store action** (`editorStore.ts`)
   Add (or reuse) an action that is *AI-friendly*: explicit parameters, no reliance on the
   current selection, and **return any id you create** (objects, blueprints, nodes). The agent
   needs that id to act on the thing next.
   _Example:_ `createObjectWithProps`, `addGraphNodeToBlueprint`, `connectGraphNodes`.

2. **Tool** (`tools.ts`)
   Add an entry to `engineTools`:
   ```ts
   my_action: tool({
     description: 'One clear sentence. Say WHEN to use it and any gotchas.',
     inputSchema: z.object({ id: z.string(), amount: z.number().optional() }),
     execute: async ({ id, amount }) => {
       if (!findObject(id)) return `No object with id ${id}.`;
       store().myAction(id, amount);
       return `Did the thing to ${id}.`; // short result the model reads back
     },
   }),
   ```
   - Validate inputs and **return a string** describing success/failure — the model uses it to decide its next step.
   - Reuse the `findObject` / `findBlueprint` guards so bad ids fail gracefully.

3. **Chip label** (`useAIChat.ts` → `describeToolCall`)
   Add a `case 'my_action':` returning a short human label (e.g. `'Applied force'`). This is what
   the user sees in the chat as the action runs.

4. **Teach the model** (`systemPrompt.ts`)
   - Add a line to `ENGINE_GUIDE` explaining the capability and *when* to use it. If it's a
     multi-step recipe (like "walk with WASD"), spell out the steps.
   - If the feature introduces **new state the model should be aware of**, add it to
     `buildSceneSnapshot()` so the assistant sees it every turn (keep it compact — it's sent on
     every message).

5. **Build & verify**
   ```bash
   npm run build      # tsc + vite must pass
   npm run dev        # then ask the assistant to use the new capability
   ```
   Confirm end-to-end in the running app, not just that it compiled.

## Special case: a new visual-scripting node type

Nodes touch a few extra places. When you add a node kind:

1. Add the `GraphNodeKind` (and any data fields) in [`src/types.ts`](../src/types.ts).
2. Wire its label/kind/description/runtime behavior in `editorStore.ts`
   (`nodeKindByLabel`, `categoryByKind`, `describeNode`, and the `tickRuntime` executor if it *does* something at runtime).
3. Add it to the palette `nodeGroups` in [`src/components/VisualScriptingPanel.tsx`](../src/components/VisualScriptingPanel.tsx).
4. Give it an icon in [`src/components/NodeForgeGraphNode.tsx`](../src/components/NodeForgeGraphNode.tsx) (`kindIcon`).
5. **AI:** add the label to `NODE_LABELS` + `NODE_CATEGORY` in `tools.ts`, and list it under the
   node types in `ENGINE_GUIDE` (`systemPrompt.ts`) with what params it takes.

## Special case: Cinematic timeline features

Film Mode is edited by both the UI and the assistant, so timeline features must stay mirrored:

- Add or reuse store actions for shot creation/editing (`addCinematicShot`, `updateCinematicAction`).
- Expose assistant tools for both creation and edits (`add_cinematic_shot`, `update_cinematic_action`).
- Add a chip label in `describeToolCall()` so users see what the assistant changed.
- Teach `COMPACT_ENGINE_GUIDE` the expected workflow: Cameras & Cuts is a shot list, shots are hard cuts by default, `blend > 0` means a smooth transition, and FOV is camera zoom.
- Include compact shot state in `buildSceneSnapshot()` (`cameraShots`) so the assistant can retime, rename, zoom, and blend existing shots by id.

## Principles

- **Mirror, don't fork.** Tools should call the *same* store actions the UI calls, so the AI and
  the user can never drift out of sync.
- **Ids over names.** Tools accept ids; the snapshot gives the model the ids. Don't make the model guess.
- **Small, composable tools** beat one mega-tool. The model chains them (create → set physics →
  attach → play). Add a high-level convenience tool only if the model proves unreliable at composing.
- **Every tool returns a sentence.** Success or a precise error — that text is the model's feedback loop.
- **Keep the snapshot lean.** It's sent on every turn; include what the model needs to act, not everything.
