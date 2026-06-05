# Feather Engine
### Spec v3 — AI-Native, Browser-Based Visual Game Engine

> **Changelog**
> - **v3 (current):** Reconciled the spec with the shipped engine. Added the **AI Assistant** as a
>   first-class module + principle. Moved shipped systems out of the roadmap. Refreshed the node
>   catalog to match reality. Added a missing-node backlog, glossary, and non-goals.
> - v2: Original MVP spec (core editor, physics, basic visual scripting, export).

---

## Vision

Feather is a modern **browser-based, AI-native** game engine. Users build real games directly in the
browser — by hand *and* by describing what they want to an agentic AI — and export them as standalone
web or native projects.

Built with:

- Three.js + react-three-fiber (3D rendering)
- React + TypeScript + Vite
- @xyflow/react (visual scripting / blueprints)
- Rapier (`@dimforge/rapier3d-compat`, headless physics)
- Zustand (single-store state)
- Tauri (optional desktop shell + native export)
- The Claude API (the in-app agentic assistant)

The goal is a tool that *looks* like Unity/Unreal/Blender/Figma and *works* like a creative partner:
anything a user can do in the UI, the AI can do too.

---

# Core Principles

## 1. AI-native — the assistant is a first-class user
Every user-facing capability is also exposed to the agentic AI as a tool, and taught in its system
prompt. **A feature isn't "done" until the assistant can use it** (see Module 7 and
`docs/AI_ASSISTANT.md`). Mirror, don't fork: the AI calls the *same* store actions the UI does, so the
two can never drift.

## 2. Beautiful UI
Closer to Unity / Unreal / Blender / Figma / Framer than a developer dashboard.

### Design language
Dark theme, glassmorphism, subtle gradients, soft shadows, smooth animations.

```css
Background:      #0F1117
Panel:           #171A23
Panel Light:     #1D2230
Primary:         #5B8CFF
Success:         #3DDC97
Warning:         #F7B955
Danger:          #FF6B6B
Text:            #F3F4F6
Secondary Text:  #9CA3AF
```

Typography: Inter / Geist / SF Pro · Spacing: 8px system · Animation: smooth panel + node transitions.

## 3. Browser-first, no-code-required
A non-programmer must be able to build, Play, save, and ship a game without writing code. Desktop
(Tauri) is an enhancement, not a requirement.

---

# High-Level Architecture

```text
Editor (React + Zustand single store)
 ├ Viewport (r3f + gizmos)
 ├ Hierarchy
 ├ Inspector
 ├ Asset / Project Browser
 ├ Visual Scripting (Blueprints)
 ├ Material / Animator / UI / Particle / Film editors
 ├ AI Assistant (agentic chat)
 └ Exporter (web bundle + native)

Runtime (tickRuntime)
 ├ Scene objects + components
 ├ Renderer (WebGL + post-FX, instancing, LOD)
 ├ Physics (Rapier authority during Play)
 ├ Animator (state machines, blend spaces, ragdoll)
 ├ Audio
 └ Node execution (graph evaluator + cross-object effect buffers)
```

State lives in one Zustand store (`src/store/editorStore.ts`). A project has multiple `Scene`s; exactly
one is active. Object mutations go through `mapActiveSceneObjects`; the active scene's objects are read
via the `selectActiveObjects` selector.

---

# Main Layout

```text
+------------------------------------------------+
| Toolbar (Play · Save · Export · Quality)       |
+------------------------------------------------+
|Hierarchy|        Viewport          |Inspector  |
|         |                          |           |
+---------+--------------------------+-----------+
| Scripting / Film (docked tabs)     | Project   |
+------------------------------------+-----------+
```

Panels are dockable (dockview); editors (Material/Animator/UI/Particle/Film) share tab groups.

---

# Editor Modules

## Module 1 — Viewport ✅
Orbit/fly camera, grid, transform gizmos, box-select, multi-select, object drag/rotate/scale, camera
gizmo for follow cameras. Self-contained lighting (Lightformers / optional HDRI IBL) so it renders
offline and under the Tauri CSP.

## Module 2 — Hierarchy ✅
Tree view; create / rename / duplicate / delete / reparent; right-click create (empty, cube, sphere,
capsule, plane, light, camera); prefab instances; group/ungroup.

## Module 3 — Inspector ✅
Per selected object: Transform, Renderer (mesh/model/material/color/metalness/roughness/opacity/
texture), Physics (rigidbody/collider/mass/gravity/damping/layers/trigger), Character Controller,
Vehicle, Light, Animator, Attachment (bone socket), World UI widget, **Tags**, and Instance Variables.
Scene-level inspector for environment (sky/fog/sun), audio, and post-processing when nothing is selected.

## Module 4 — Asset / Project Browser ✅
`.glb .gltf .png .jpg .jpeg .mp3 .wav`. Drag-drop upload, preview, search, folders. Also hosts
Blueprints, Materials, Animator Controllers, Skeletons/Skeletal Meshes/Animations, Particle Systems,
Data Assets, UI Documents, Prefabs, Cinematics.

## Module 5 — Visual Scripting (Blueprints) ✅
@xyflow/react graphs attached to objects. See **Node Catalog** below. Supports typed value wires, exec
flow, multi-output nodes (For Loop), references/sentinels (`$self/$player/$trigger/$cast`), and Cast.

## Module 6 — Companion editors ✅
Material graph, Animator state-machine editor (blend spaces, transitions), UI document editor
(screen + world/diegetic), Particle System editor (live preview), Film Mode sequencer (camera
keyframes, beats, DoF).

## Module 7 — AI Assistant (agentic) ✅
The signature feature. An in-app chat (`src/components/AIChatWidget.tsx`, `src/ai/`) where the model
**calls tools that mutate the editor's store**; changes apply live.

- **Tools** (`src/ai/tools.ts`): each is a zod schema + an `execute` that calls a store action and
  returns a short result sentence (the model's feedback loop). AI-friendly actions take explicit params
  and **return the ids** they create.
- **Knowledge** (`src/ai/systemPrompt.ts`): `ENGINE_GUIDE` (what the engine is + how to use it) and a
  lean per-turn **scene snapshot** (live project state).
- **Sync rule:** adding a capability = store action → tool → chip label (`useAIChat.ts`) → guide/snapshot
  entry. Enforced as definition-of-done.
- **Prompt caching:** the tool set + guide prefix stay stable so the cached prefix cuts token cost.

---

# Components (ECS-style)

```text
Transform · MeshRenderer · Physics · Script(Graph) · Animator · Character · Vehicle
Attachment · ViewModel · UI · Terrain · Light · Inventory · Particles · Fracture · variables{}
```

`variables` is the per-instance bag (health, ammo, tags, gameplay state) read/written by scripts and
world UI (`self.<key>`).

---

# Physics ✅ (Rapier)
Dynamic / Fixed / Kinematic bodies; Box / Sphere / Capsule / Mesh (trimesh) / Convex colliders; sensors
(triggers); collision layers + masks; mass, gravity scale, linear/angular damping, friction. During
Play a real Rapier world is the authority; scripts feed motion/impulses in, the world steps, transforms
copy back. Contacts surface via `runtimeCollisions` (one-frame delayed) → `collisionEnter`.

---

# Node Catalog (current)

> Reflects the shipped node set. Handles: exec edges flow event → action; typed value edges use named
> target handles. Multi-output nodes (For Loop) and reference pins (Cast "As", Find Actor) are supported.

**Events:** Start · Update · Key Down · Key Up · Custom Event · Collision Enter · Trigger Enter ·
Trigger Exit · Interact · On Receive Damage

**Logic / flow:** Branch · Compare · AND · OR · NOT · Cast (to Blueprint) · Cooldown · Do Once · Delay
(latent) · For Loop

**Math:** Add · Subtract · Multiply · Divide · Modulo · Clamp · Lerp · Distance · Add/Subtract Vectors ·
Scale Vector · Normalize · Make Vector3

**Values:** Number · Random · String · Boolean · Vector3

**Variables:** Get/Set Variable (project/global) · Get/Set Object Var (per-instance) · New Variable

**Data:** Data Asset Lookup

**Transform / actors:** Translate · Rotate · Get/Set Position · Get/Set Rotation · Get/Set Scale ·
Look At · **Find Actor By Blueprint** · **Find Actor By Tag**

**Movement / character:** Get Move Input · Move · Move To (steering) · Jump · Is Grounded ·
Set Movement Mode · Set Ragdoll · Set Camera · Face Player

**AI perception:** Distance To Player · Direction To Player · Player Location · Has Line Of Sight

**Vehicle:** Get Drive Input · Drive · Enter/Exit Vehicle · Get Vehicle Speed

**Combat / spawn:** Spawn Object · Spawn Prefab · Spawn Projectile · Spawn Attached ·
Spawn Particle System · Burst Particles · Set Particles Emitting · Apply Damage · Fracture ·
Destroy Object · Set Visible

**Animator:** Set Anim Float/Bool/Trigger · Get Anim Param · Get Anim State · Play Animation

**Material (runtime):** Set/Get Material Color · Set/Get Material Property

**Audio / FX / UI / system:** Play Sound · Camera Shake · Play Cinematic · Set Quality ·
Show/Hide UI · Set UI Text · Print · Fire Event (self or **targeted** at another actor) ·
Load Scene · Save/Load/Clear Game

**Physics:** Apply Force

**Material graph (separate editor):** Output · Color · Scalar · Texture · Mix · Multiply (Material) ·
Add (Material) · Clamp (Material)

---

# Missing-node Backlog (planned, in priority order)

1. **Raycast** — user-facing line trace (out: hit bool / hit actor reference / hit point / distance).
   Highest leverage: ground checks, shooting logic, AI sensing, interaction probes. (LoS exists only
   internally today.)
2. **Apply Impulse / Set Velocity / Get Velocity** — precise physics control beyond `Apply Force`.
3. **Collision Exit** — the missing partner to Trigger Exit / Collision Enter.
4. **Timer** — repeating "every N seconds" (complements the one-shot Delay and the Cooldown gate).
5. **Enable / Disable Object** — a true enable/disable (physics + script), distinct from Set Visible.

---

# Runtime Loop

```text
each frame while Playing (tickRuntime):
  read input + queued cross-object signals (collisions, targeted events, delays)
  for each scripted object: run its graphs → collect motion + side effects (in target-keyed buffers)
  apply cross-object writes (transforms, object vars, animator, particles, spawns, destroys)
  character + vehicle passes
  step Rapier; copy body transforms back
  animator + audio + camera passes
  render
```

Cross-object effects (Set Object Var, Set Position on a target, Apply Damage, animator writes, targeted
Fire Event, …) are written into **target-keyed buffers** and applied in a post-pass — never by mutating
another object mid-iteration.

---

# Save / Export

**Save:** project format (scene + assets + graphs + materials + animators + UI + …), `.nforge`. On
desktop a real project folder; on web a downloadable file (`src/project/serialize.ts` splits/joins +
migrates legacy files).

**Export:**
- **Game bundle** (`game.json`) run by a separate player runtime (`npm run build:player`).
- **Export to Production:** native app per current OS (Tauri: `.dmg`/`.app`, `.msi`/`.exe`,
  `.AppImage`/`.deb`) **plus** a portable web folder. Web build deployable to Vercel / Netlify / GitHub
  Pages.

---

# Shipped Systems (beyond the original MVP) ✅

- **Animation:** Unreal-style skeletons, skeletal meshes, animation assets, animator controllers
  (state machine, 1D/2D blend spaces, transitions/conditions, exit time), ragdoll (PhAT-style
  per-bone), montages, sockets/attachments.
- **Materials:** reusable material assets + node-based material graph + per-object overrides.
- **Particles:** authored emitters + reusable particle-system assets.
- **Terrain:** procedural chunk-streamed surface, sculpt/paint, foliage.
- **Prefabs:** capture an object tree (with scripts/animator) and stamp instances.
- **UI:** screen HUDs + world/diegetic widgets, bindable elements, WebGL UI backend.
- **Cinematics:** Film Mode sequencer (keyframed camera, beats, depth of field).
- **Vehicles:** arcade car controller (drivetrain, steering, suspension feel, follow camera).
- **Characters:** third/first-person, strafe, swim/climb/fly, crouch/crawl/roll, melee, mouse-look.
- **Rendering:** quality presets (Low→Epic) driving DPR/shadows/post-FX (bloom, SSAO, SMAA, SSR),
  HDRI/IBL, GPU instancing, mesh LOD, KTX2 texture compression, procedural sky/fog.
- **Minimap/radar.** **Templates:** third-person (urban), FPS (cyberpunk), driving (NFS-lite), film
  (cyberpunk cinematic), top-down (twin-stick), card battler.
- **Packages:** `.nfpack` template/module export-import (additive import + id remap).

---

# Future Roadmap (genuinely not built yet)

- **Per-pixel shader graph** (today's material graph evaluates to constants, not GPU shaders).
- **AI behavior trees** (perception nodes exist; no BT/blackboard yet).
- **Navmesh + A\*** pathfinding (Move To is steering-based, not navmesh).
- **WebGPU renderer** (prototype on an unmerged branch; `main` is WebGL).
- **Multiplayer / netcode.**
- **Mobile export.**
- **Marketplace / store** (`.nfpack` foundation exists), **plugin system**, **cloud projects**.

---

# Glossary

- **Blueprint** = a reusable node graph ≈ a "class". An object "is of" a blueprint when its script
  points at it.
- **Instance variable** = per-object data (`variables{}`), e.g. per-enemy `health`. **Project variable**
  = one shared global value (score, settings).
- **Reference** = an object id flowing on a value pin (Cast's "As", Find Actor's output).
- **Sentinel target** = `$self` (owner), `$player` (camera-follow), `$trigger` (toucher), `$cast` (last
  successful Cast).
- **Tag** = a label in an object's `tags` instance variable (Inspector → Tags), found by Find Actor By
  Tag.

---

# Non-goals (for now)

- Not a general 3D DCC tool (no mesh modeling/sculpting of arbitrary geometry — terrain aside).
- Not a server/back-end framework (no built-in netcode/auth/DB).
- The material graph is not a per-pixel shader compiler (yet).

---

# Success Criteria

The engine is a real game engine (not a demo) when a user can, **by hand or by asking the AI**:

1. Create a scene and add 3D objects.
2. Add physics + a character controller.
3. Build gameplay with nodes (incl. find/cast/target other actors).
4. Press Play and iterate.
5. Save the project.
6. Export a standalone game (web or native).
7. Deploy it online.

**Bar for "AI-native":** a user describes a small game in plain English and the assistant assembles a
playable scene + scripts. The reference build target remains a **physics platformer** (movement,
jumping, collisions, collectible coins, win condition) — buildable with zero code.
