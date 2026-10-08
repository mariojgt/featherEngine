# Engine polish and cleanup

This pass traced editor, player, capture/demo, worker, script, test, and plugin entry points before removing code. Removing an unreachable source file helps maintenance; Vite usually already excludes it from the shipped runtime. Smoother play requires reducing work that actually happens during a frame.

## Applied

| Change | Reason |
| --- | --- |
| Remove `cubeRealmTemplate.ts`, `meadowTemplate.ts`, and the unused creator barrel | No consumers; both templates are explicitly retired from the store. |
| Remove unused racing builders, the old Model Forge face-action handler, and leftover runtime declarations/imports | These implementations have no callers; the current features use their active implementations. |
| Remove duplicate `event.update` switch cases | The later branches are unreachable and caused build warnings. |
| Poll selected-object coordinates at 4 Hz during Play | Motion previously reconciled the status bar every tick. Selection changes and edit-mode transforms remain immediate. |
| Reuse structural scene signatures for the same objects array and Play state | Several panels can request the same snapshot without repeatedly scanning the scene. New immutable arrays still trigger comparison. |
| Prune despawned render transforms and reject stale interpolation/replay entries | Long sessions no longer retain every effect/projectile that has disappeared. Normal frames retain the existing map-write path. |
| Release controller buttons and aliases on disconnect | Disconnecting a controller no longer leaves jump/fire keys held. Touch movement still works. |

Regression coverage checks status-bar commits, selection/edit updates, controller disconnect/reconnect, touch merging, transform cleanup, interpolation, and structural panel subscriptions. Existing gameplay, scripting, high-refresh physics, editor Play/Stop, and production builds provide broader validation.

## Completed follow-up

| Change | Result |
| --- | --- |
| Load the editor shell after a project opens; share lazy built-in panels between the dock and pop-outs | The launcher no longer loads the viewport, docking shell, AI chat, visual scripting, animation, film, terrain, material, or UI editors. |
| Defer the Model Forge panel while preserving synchronous plugin registration | Saved layouts and commands still resolve immediately; the modeler loads when opened. |
| Extract the shared Range Field component | Plugin settings no longer pull the entire Inspector into startup. Its original Inspector export remains available for compatibility. |
| Load MCP engine tools after a relay connection | A disconnected optional relay no longer forces the AI tools/provider bundle into startup. Registration, validation and reconnect behavior have regressions. |
| Queue assistant requests while the Agent loads | The launcher's “Create with AI” prompt reaches the Agent after its lazy mount; StrictMode/remounts do not resend it. |
| Extract `animatorPass.ts` from `tickRuntime.ts` | Animation still runs after physics and receives final poses, owner state, script writes, triggers and montage requests. Existing locomotion, layering, root-motion, view-model and gameplay regressions pass. |
| Remove `@react-three/rapier`; declare `esbuild` and `vite-node` directly | Physics continues to use direct Rapier. Both lockfiles were updated; existing locked dependency versions were retained. |
| Restore development export keys `cinematic` and `neon-afterlight` | Documented authoring/capture commands resolve their builders again. Both projects remain retired from the public catalog. Archive-export regressions cover the restored keys. |
| Move the unused long guide to [ENGINE_GUIDE.md](ENGINE_GUIDE.md) | The live compact prompt stays in `systemPrompt.ts`; contributor instructions now point to the correct runtime prompt and reference document. |
| Clear the remaining unused declarations and enable `noUnusedLocals` | Type checking and builds reject new unused bindings. `npm run check:unused` also checks file reachability and runs a fixture test for the audit. |
| Add production browser acceptance to CI | `npm run test:startup` verifies deferred launcher downloads, the AI handoff, viewport mount and loading Scripting on demand. |

The source audit follows editor/player/capture HTML entry points, tests, script imports and literal browser imports, Vite plugin globs, workers and the public SDK. It deliberately retains the documented physics-worker staging entry points. It does not establish that every exported symbol or public asset is unused; those still need consumer checks before deletion.

## Stability and rendering follow-up

| Change | Result |
| --- | --- |
| Keep keyboard input owned by text fields, editor controls and HUD buttons | Typing during Play no longer moves the player or fires gameplay actions. Accepted gameplay keys still release after focus moves into a control. |
| Release held DOM inputs on blur, hidden tabs and runtime teardown | Movement/fire do not stick after interruptions; unrelated touch/controller inputs remain intact. |
| Re-anchor the runtime clock on focus/visibility transitions | The first resumed frame establishes a new timestamp instead of advancing simulation with time spent away. Fixed-step capture retains ownership. |
| Round automatic mesh reduction targets to complete triangles and use the actual vertex stride | meshoptimizer no longer silently rejects common geometry. A 32 × 24 sphere drops from 1,472 triangles to 588 / 220 at its two distant levels (60.1% / 85.1% fewer). Actual scene traversal was verified in Chrome. |
| Preserve authored material groups and skip partial draw ranges when reducing geometry | Reduced meshes retain their material selection; authored triangle subsets remain intact. Generated levels remain cached, budgeted and disposed with their source. |
| Use world-space camera positions and mesh bounds for distance budgets | Nearby edges of large buildings keep their shadows; cameras attached to rigs keep nearby geometry at full detail. Distant casters still leave the shadow pass, and Stop restores authored flags. |
| Gate distance/aerial fog on the active volumetric pass | Low quality and zero/invalid volumetric density retain enabled distance fog. Higher quality avoids doubled haze. Editor sun shadows are requested for volumetric shafts only when the tier uses them. |
| Share the render-statistics probe between the editor and player | Play reports its own render work instead of retaining the editor's last counters. Canvas changes clear old render timings, and multi-pass/cumulative counters are counted correctly. |

The browser regression cycles Low/High three times, checks actual fog and mesh geometry, sends real keyboard events into the AI composer and game Canvas, releases movement on blur, and restarts Play. GPU lighting and reflection fixtures also passed with no shader errors. These fixes use existing controls and shared editor/player paths; they add no rendering setting or AI tool.

```sh
# With the dev server running on port 17428:
E2E_BASE_URL=http://127.0.0.1:17428 node scripts/e2e/runtime-rendering.mjs
E2E_BASE_URL=http://127.0.0.1:17428 node scripts/e2e/cinematic-lighting.mjs
E2E_BASE_URL=http://127.0.0.1:17428 node scripts/e2e/reflection-quality.mjs
```

## Measured startup

Three fresh Chrome profiles, the same production preview server and a 1280 × 800 window:

| Metric | Before follow-up | After follow-up | Reduction |
| --- | ---: | ---: | ---: |
| Minified editor entry | 9.29 MB | 4.50 MB | 51.6% |
| Launcher JavaScript transferred (gzip) | 2,976,787 bytes | 1,502,304 bytes | 49.5% |

The browser confirmed that heavy editor chunks were absent from launcher requests and arrived when the editor/panels opened. Opening a project still loads the features required by its visible panels. Rapier's embedded WASM and other engine data remain large early dependencies, so Vite still reports large chunks.

Local navigation timing was also captured, but the baseline ran alongside build/tests; it is not a controlled startup-speed comparison. Download size is the firm result above. No hardware FPS gain is claimed.

## Repeatable profiling

```sh
# Start a production preview separately, then measure cold launcher requests.
npm run preview -- --host 127.0.0.1 --port 17427 --strictPort
npm run measure:engine -- --mode startup --url http://127.0.0.1:17427 \
  --out exports/engine-performance/startup.json

# Against an already running dev server: measure Cloudstep Garden at Low quality,
# auto quality disabled, 1280 × 800, standing at the spawn; wait for rendering first.
npm run measure:engine -- --mode scene --url http://127.0.0.1:17428 \
  --out exports/engine-performance/scene.json
```

The corrected Cloudstep Garden capture recorded 72 Play frames, 520 peak draw calls, 460,502 peak triangles, 19 peak textures and no shadow-casting lights at Low quality. Simulation averaged 2.45 ms and renderer submission averaged 33.26 ms; headless SwiftShader p95 frame time was 400 ms. This is a renderer/measurement acceptance check, not a hardware speed comparison.

The earlier `scene-after.json` render-cost figures came from the editor Canvas because the Play renderer lacked a probe. Treat that report as superseded, and do not compare its draw/triangle/render-time figures against the corrected player capture. Headless SwiftShader timings are automation diagnostics, not hardware FPS evidence. For a performance decision, repeat the same route, window size and settings on the target hardware using View → Performance Assistant / F8.

Reports from this session are in ignored `exports/engine-performance/`: `startup-before.json`, `startup-after.json`, superseded `scene-after.json`, corrected `scene-rendering-after.json`, and `runtime-rendering/report.json`.

## Verification

- Full unit suite: 193 files passed, 1,404 tests passed and one existing test was skipped. The final material-group preservation adjustment was followed by seven passing mesh/distance regression tests.
- `npm run build`: TypeScript, standalone player and editor production builds passed.
- `npm run check:unused`: unused bindings, the source-audit fixture and source reachability passed.
- Browser checks: real graph selection, Play/Stop, production lazy loading/AI handoff and the full Model Forge polygon editing smoke passed. The rendering follow-up additionally passed real Play inputs, fog/mesh quality cycling, Canvas restart diagnostics, GPU lighting and GPU reflection checks.
- Reusable standalone player and runtime cache verification passed. The final portable export/browser smoke also passed (42 files, 11.5 MB), including WebGL, assets, physics, Blueprints, HUD, water/cloth/cables, cinematic overlays and migration.
- First-pass regressions still cover status-bar commits, controller disconnects, transform cleanup and stable structural subscriptions. The isolated selector improvement (about 57 ms → 0.3 ms for 10,000 repeated calls on 500 unchanged objects) remains a narrow CPU-work result, not an FPS claim.

Further runtime extraction should continue one pass at a time with ordering and gameplay tests. Measure actual target-hardware scenes before changing rendering or simulation budgets.
