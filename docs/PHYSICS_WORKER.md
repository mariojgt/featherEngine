# Off-thread physics worker — design & staging

**Goal:** move Rapier's solver (`world.step()`) off the main JS thread so it stops competing with scripts,
React reconciliation, and render submission for the one 16 ms frame budget — and so its allocations stop
causing main-thread GC hitches. This is item #2 of the "AAA ceiling" roadmap.

**Status:** Stage 1 landed (contract + skeleton + flag + this doc), flag default **OFF**, live physics
unchanged. Stages 2+ are the real work and require live (browser) QA — this repo's tests are jsdom and
cannot exercise a worker or WASM physics.

---

## The hard problem: synchronous spatial queries

Moving `world.step()` is trivial. The reason this was deferred is that the **script evaluator queries the
live world synchronously, mid-tick**, and uses the answer immediately:

- `query.raycast` → `phys.castRay(...)` ([editorStore.ts](../src/store/editorStore.ts) ~6525)
- `query.overlapSphere` → broadphase ball query (~6555)
- AI line-of-sight, character ground checks, etc.

A worker cannot answer a synchronous call from the main thread. Making the query *nodes* async would be a
breaking change to the entire visual-scripting model. So the worker cannot be the only source of truth for
queries.

### Resolution: a main-thread query world (read-only, one frame behind)

Keep a lightweight **collider-only** Rapier world on the main thread for queries. It has **no solver and no
dynamics** — every frame the worker sends back each body's post-step transform, and we set the
corresponding main-thread collider's pose from it. Raycasts/overlaps run against *that*.

This is correct for this engine because **it already tolerates one-frame-delayed physics info** — contacts
(`runtimeCollisions`) are explicitly surfaced one frame late, and `event.collisionEnter` fires off the
prior frame. Answering queries against last-frame collider poses is the same latency contract, not a new
source of error.

Cost: we mirror collider *creation/removal/shape* (not simulation) on the main thread. That's a real chunk
of [physicsWorld.ts](../src/runtime/physicsWorld.ts)'s body management, but only the cheap half (pose
sync + `QueryPipeline.update()` per frame), and it never runs the solver.

---

## Pipeline (how a frame flows once wired)

```
main thread (tickRuntime)                 worker thread
─────────────────────────                 ─────────────
run scripts (read query world, 1f behind)
collect frame inputs ───── postMessage ──▶ apply inputs to bodies
apply LAST frame's result                  world.step()
  to store + render buffer  ◀── postMessage ─ collisions + transforms + velocities
update main-thread query world
  from LAST frame's transforms
```

The pipeline is **1 frame deep**: the tick consumes the *previous* frame's result while the worker computes
the next. This adds one frame of latency to physics-driven motion (~16 ms), already smoothed by the
existing render interpolation (`publishRenderTransforms`). If that latency proves visible on fast bodies,
the fallback is to keep dynamic-vehicle chassis on the main thread (they already have a bespoke writeback).

## Transfer

Stage 1 protocol passes Maps/objects by structured clone (simple, correct). The optimization (a later
stage): per-body transforms become a **transferable `Float32Array`** (`[px,py,pz, rx,ry,rz]` per body) plus
a **stable id manifest** sent only when the body set changes. Double-buffer two Float32Arrays so the
transfer is zero-copy without losing the buffer on the sender. `SharedArrayBuffer` is a further step but
needs COOP/COEP cross-origin-isolation headers (affects asset loading + the Tauri shell) — defer it.

---

## Staging

- **Stage 1 — contract & scaffold (DONE).** `physicsProtocol.ts` (messages), `physicsWorker.ts` (skeleton:
  init handshake + seams), `physicsWorkerClient.ts` (lifecycle + correlation), `physicsWorkerFlag.ts`
  (default OFF). No tick changes; live physics untouched; build + tests green.
- **Stage 2 — extract the world core.** Refactor `physicsWorld.ts` so its world ownership + `frame()` is
  callable inside the worker (separate the Rapier logic from any main-thread-only glue). Worker `frame`
  returns a real `PhysicsFrameResult`. Validate numerically vs. the in-process world on a fixed input.
- **Stage 3 — main-thread query world.** Build the collider-only query world; route `query.raycast` /
  `query.overlapSphere` / LoS / ground checks through it. Confirm Raycast/Overlap nodes behave identically.
- **Stage 4 — wire the 1-frame pipeline** behind the flag; consume last frame's result; A/B vs. in-process
  via an F8 toggle (like GPU instancing). Live-QA: motion, contacts, triggers, vehicles, characters.
- **Stage 5 — transfer optimization** (Float32Array + id manifest + double-buffer). Measure main-thread
  time saved in a heavy-physics scene with F8.
- **Stage 6 — default the flag ON** once correctness + perf are confirmed in real scenes.

## Fallback guarantee

Every frame/query promise rejects on a worker `error`, and the caller falls back to the in-process world.
So the worker can be filled in incrementally without ever breaking the running engine — and the flag can be
flipped off instantly if a scene misbehaves.
