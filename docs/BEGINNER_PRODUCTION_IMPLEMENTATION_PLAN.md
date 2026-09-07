**Feather Engine: beginner experience and production implementation plan**

Prepared 7 September 2026 against commit `053fac5`. This is a source-based implementation plan. Live usability sessions, performance measurements, and fresh build/test runs remain implementation tasks; this review does not certify a production release.

Implementation has now been carried through all six improvement areas. See [the delivery record](BEGINNER_DELIVERY.md) for the implemented scope, test evidence, and remaining release validation, and [the beginner quickstart](BEGINNER_QUICKSTART.md) to use it. The roadmap below retains its original broader targets and estimates.

The intended result is simple: a new creator can choose a starter, change its appearance, add a gameplay rule, test it, and export a complete small game. Use the existing Platformer as the first complete example, then apply the proven workflow to Third Person and the other templates.

Planning assumptions: beginner game creators are the primary audience; web is the first delivery target, followed by a desktop build on its supported host. Mobile gets a separate validation milestone. Effort estimates assume one developer familiar with this repository and available art/design support. They are planning ranges, to be revised after the baseline work.

**What already exists, and what needs attention**

| Area | Evidence in this checkout | Improvement to make |
| --- | --- | --- |
| Editor UI | [Workspace](../src/components/Workspace.tsx) already uses three main zones and opens specialist panels on demand. [Creator modes](../src/creator/editorModeStore.ts) already provide Build, Logic, and Play. | Finish the guided workflow, improve feedback and readability, and test smaller windows. Preserve the existing layout foundation. |
| Beginner programming | [Interactions](../src/creator/components/InteractionsSection.tsx) already provides When/Do rules; [simple interaction actions](../src/store/editor/simpleInteractionActions.ts) compile them into ordinary Blueprints. Basic Players are intentionally blocked because attaching a script changes their input behavior. | Make rules editable, keep cards consistent with graph changes, and support adding player behavior without accidentally losing movement. |
| Templates | [Quick starts](../src/creator/gameTemplates.ts), [gameplay kits](../src/creator/gameplayKits.ts), and [Platformer](../src/project/platformerTemplate.ts) already exist. Launcher recommendations currently prioritize Spline Studio. | Give beginners a clear recommended learning route and make each featured template a documented, validated small game. |
| Models | FBX conversion, material extraction, Model Forge, texture compression, instancing, and automatic LOD already exist. [AssetBrowser](../src/components/AssetBrowser.tsx) compresses GLBs before calling [inspectModel](../src/three/inspectModel.ts), which constructs a bare loader. | Reproduce compressed-model inspection behavior first; unify format support and provide a durable import report. Improve art consistency and replacement workflows. |
| Physics | [physicsWorld](../src/runtime/physicsWorld.ts) already has fixed stepping, interpolation, CCD, and character ground handling. [tickRuntime](../src/store/editor/tickRuntime.ts) includes coyote time and jump buffering. | Tune game feel through presets and measured regression scenes. The [worker](../src/runtime/physicsWorker.ts) is still a disabled scaffold and should remain a separate optimization project. |
| Production | [Export profiles](../src/project/exportProfiles.ts), [bundle verification](../src/project/verifyBundle.ts), [production export](../scripts/export-production.mjs), and [CI](../.github/workflows/ci.yml) already exist. | Improve the guided build experience and validate complete starter games across editor and exported player. Extend existing gates. |

Two source findings deserve early reproduction: compressed imports can reach inspection without the needed decoder configuration, and a failed simple-rule compilation can occur after related variables/physics have already been changed. Treat these as testable implementation hypotheses; the review did not reproduce them in a running editor.

**Delivery order**

| Milestone | Deliverable | Approximate effort | Depends on |
| --- | --- | --- | --- |
| A | Baseline and one starter's acceptance scenario | 1–2 developer days | — |
| B | Guided creation UI and starter instructions | 3–5 days | A |
| C | Reliable beginner rules and player behavior | 5–8 days | A; shared acceptance scenario from B |
| D | Model import reliability and a coherent starter art kit | 5–8 days, plus art work | A; import fixes before replacing assets |
| E | Physics presets and regression course | 4–7 days | A; agree model scale with D |
| F | Guided shipping and expanded release checks | 5–8 days | Baseline export in A; final validation after B–E |
| G | Beginner playtesting, repair, documentation, and release candidate | 3–5 days | B–F |

Allow roughly **6–9 developer weeks** for the first release scope, plus scheduling/review contingency and separately estimated art production. The first useful slice should take **8–12 developer days**: baseline, one guided starter, one polished rule recipe, an import fix if reproduced, and an exported web acceptance run. Full rule editing and every platform are later parts of the scope.

**A. Establish one measurable game-making journey**

Choose the existing Platformer for the reference game. It already separates simple gameplay/collision roots from visible child geometry, which supports safe art replacement. Record what currently works before changing it.

- Define a ten-minute exercise: create Platformer → change the hero's appearance → change collectible score → add a door rule → play to the goal → save/reopen → export and run.
- Record completion time, confusing steps, failed imports, console errors, load time, frame-time percentiles, and bundle size. Use anonymized observations from consenting participants when testing with people.
- Establish reference hardware, browser versions, window sizes, and graphics quality. Proposed starting targets are 60 FPS at 1080p on the selected desktop device and a later 30 FPS mobile target; confirm feasibility with measurements.
- Set per-template download, texture-memory, draw-call, and physics budgets after measuring the starter. Show limits as target-profile settings with explanatory warnings.
- Add a small repeatable acceptance fixture and retain an untouched exported baseline for comparison.

Done when the current journey has a recorded outcome, a list of reproducible failures, an agreed performance budget, and a baseline artifact. Build/export checks begin here so later work has a working delivery path.

**B. Make the editor easier to understand**

Extend [Launcher](../src/components/Launcher.tsx), [Workspace](../src/components/Workspace.tsx), [InspectorPanel](../src/components/InspectorPanel.tsx), [ProblemsPanel](../src/components/ProblemsPanel.tsx), [editor preferences](../src/store/editorPrefsStore.ts), and the existing styles.

- Give the recommended beginner template a clear outcome, screenshot, difficulty, controls, and approximate lesson length. Keep AI-assisted creation available while making the template route complete without an account or API key.
- Add a dismissible, resumable “Your first game” checklist. Each step opens the relevant existing panel or selects the relevant object. Complete steps from actual project state where practical, rather than from clicks alone.
- Keep Make It, Gameplay, Appearance, and Interactions prominent. Explain units and provide reset-to-default controls for commonly tuned values. Keep advanced component controls accessible through the existing disclosure pattern.
- Make selection and Edit/Play state unmistakable. Clearly explain how Stop affects runtime changes and show saving/recovery status near the main controls.
- Give unavailable quick starts a visible reason and retry action. Provide at least one locally available beginner starter when the catalog cannot load, reusing the existing template/kit implementation.
- Standardize control spacing, focus styles, labels, and error presentation. Validate the launcher, inspector, graph editor, and export dialog at 1280×720 and 1440×900, including keyboard navigation and enlarged text.
- Add an object/node “Show me” action to diagnostics wherever a relevant ID is available. Preserve detailed technical messages behind a disclosure.

Done when a new creator can locate Play, add an object, change its appearance, find its logic, and recover from a missing dependency without coaching. In a first five-person beginner study, use four successful completions of the core exercise within ten minutes as the initial usability target; revise after observing the baseline.

**C. Make programming easy to start and safe to extend**

Keep one runtime representation. The learning progression is **rule cards → Blueprint graph → FeatherScript**, using the existing compiler and runtime throughout.

- Extend [simpleInteractions](../src/creator/simpleInteractions.ts) and its UI with a small recipe library: collectible with sound, timed door, checkpoint, moving platform, hazard, and win trigger. Each recipe states its requirements and exposes a few meaningful settings.
- Add target and asset pickers so beginners select named scene objects, sounds, animations, and prefabs. Explain missing references inline.
- Make rule creation transactional: validate and compile first, then commit all related changes as one undoable action. A failure must leave the previous graph, variables, components, and object metadata intact.
- Add edit, disable, duplicate, and delete for generated rules. Associate rule IDs with their generated graph portions. Preserve unrelated hand-authored logic.
- Define the ownership boundary: if a user changes a generated graph beyond what its card can represent, mark it as custom logic and offer “Open graph.” Do not silently regenerate it from stale card metadata. Support returning to cards only for recognized structures.
- Prototype an explicit input policy such as built-in, scripted, or combined. Preserve legacy project behavior through migration defaults; allow new beginner Players to retain built-in movement when adding an unrelated rule. Verify input is applied once per tick.
- Extend existing FeatherScript completion and diagnostics with short examples and plain-language fixes. Keep the last working program active when a draft fails to compile, and make that state visible.

Primary implementation seams: [simpleInteractionActions](../src/store/editor/simpleInteractionActions.ts), [InteractionsSection](../src/creator/components/InteractionsSection.tsx), [VisualScriptingPanel](../src/components/VisualScriptingPanel.tsx), [FeatherScript compiler](../src/scripting/featherCompiler.ts), and the character input branch in [tickRuntime](../src/store/editor/tickRuntime.ts).

Done when a beginner can add and change a rule, undo it, inspect its graph, save/reopen it, and get the same result in an export. A Player must still move after adding a sound or score rule. Regression tests must cover failed compilation, shared Blueprint isolation, graph/card divergence, and legacy scripted controllers.

For contributors, extract only the touched responsibilities into focused modules. The Inspector is about 3,600 lines, Scripting 4,700, and tickRuntime 6,500 in this checkout. Separate rule editing and character input policy as they change, and add a short “add one behavior” contributor recipe using typed store actions. Keep refactoring scoped to the feature under implementation.

**D. Improve templates and 3D models together**

Introduce optional, versioned learning metadata alongside the existing template catalog: difficulty, learning objectives, controls, editable settings, required assets, attribution, recommended quality, and validation status. Derive listings and documentation from that shared metadata so template counts and descriptions stay current.

For the first featured template, audit and complete a small game loop: title/help screen, controllable character, objective, clear feedback, pause, checkpoint/restart, win/lose states, and relevant settings. Reuse existing HUD/input systems. Use descriptive scene groups and commented Blueprints. Add a short “change these three things” lesson. Apply the format to Third Person after the first template passes.

For the model pipeline:

- Create fixtures for textured GLB, KTX2 textures, Draco geometry, meshopt geometry, rigged animation, FBX with sidecar images, and glTF with external buffers. Establish exactly which formats each path supports.
- Resolve inspection/rendering decoder differences. A first patch may inspect an uncompressed original before optimization, but already-compressed incoming files still need a proper inspection path. Use shared loader configuration where compatible, or explicitly extract metadata without decoding textures. Account for KTX2 renderer support detection. Three.js documents separate configuration for [Draco, KTX2, and meshopt decoding](https://threejs.org/docs/pages/GLTFLoader.html).
- Replace console-only inspection failures and overlapping toasts with an import report showing textures found/missing, materials, skeleton, clips, dimensions, triangle count, and actionable failures. Keep a successfully imported mesh usable when optional metadata fails, while making the incomplete result visible.
- Add a preview with a scale reference and collider overlay. Offer character, static scenery, and dynamic prop presets using existing components. Keep original assets and record import options so optimization and reimport are reversible.
- Establish one visual style for the starter: consistent silhouettes, palette, texel density, material roughness, scale, lighting, and animation timing. Create or refine a small kit: hero, collectible, door, platform, hazard, and environmental props. Prefer readable silhouettes before increasing polygon counts.
- Keep visual children independent of gameplay roots. “Replace appearance” must preserve movement, colliders, scripts, sockets, and compatible animation mappings; flag incompatible rigs with a mapping preview.
- Retain existing LOD and instancing. Report which assets qualify, preview quality tradeoffs, and move expensive LOD preparation to import/build time only if profiling demonstrates a benefit. Budget skinned and multi-material meshes separately because automatic simplification has eligibility limits.
- Carry asset provenance/attribution into the exported credits where required. Produce actual approved 3D assets through the existing Model Forge or a DCC workflow; an image mockup alone is not the model deliverable.

Done when the fixture matrix either imports correctly or reports a clear supported limitation, an art replacement preserves gameplay, and the complete starter looks consistent in both editor Play and export. Record before/after images, load time, frame time, and bundle size on the reference device.

**E. Improve physics through game-feel presets and evidence**

Keep Rapier and the existing 60 Hz simulation foundation. Build on [physicsMaterials](../src/runtime/physicsMaterials.ts), [Physics Lab](../src/project/physicsLabTemplate.ts), and the existing [physics feature](../src/store/__tests__/physicsFeatures.test.ts) and [high-refresh motion](../src/store/__tests__/highRefreshMotion.test.ts) tests, which already exercise real Rapier.

- Expose tested player presets for a forgiving platformer and a grounded third-person character. Tune acceleration/deceleration, air control, jump height, coyote time, buffering, slopes, step height, and ground snap through existing settings where available.
- Expose friendly surface/prop presets such as grippy ground, ice, rubber, and heavy crate. Preview collider shape and explain friction/bounce in plain language.
- Extend the regression course with stairs, slopes, corners, moving elevators, translating and rotating platforms, stacked props, thin walls, fast projectiles, triggers, and restart/pause cases. Rapier's controller provides useful primitives, but genre-specific movement still needs tuning; its built-in character movement supports translation rather than rotation. [Rapier character-controller guidance](https://rapier.rs/docs/user_guides/javascript/character_controller/).
- Run numerical movement checks at simulated 30/60/120/144 Hz render cadences and hitch/pause sequences. Extend tests where coverage is missing. Test camera and interpolation visually in a real browser as well.
- Proposed fixture tolerances: travel distance and jump apex within 5% across cadences; no missed/duplicate enter events in the scripted course; no tunneling in the supported projectile-speed fixture; bounded platform drift. Set concrete scene dimensions and speed limits before using these as release gates.
- Measure physics time separately from scripts and rendering. Use appropriate simple collision proxies, sleep settings, collision layers, and selective CCD before increasing solver costs.

Done when the course passes in editor and exported player and the chosen preset feels consistent during playtesting. No claim of cross-platform bit-for-bit determinism is required.

Keep off-thread physics outside the first release scope. The current worker returns unimplemented errors for simulation/query requests. If profiling later justifies it, follow [the staged worker design](PHYSICS_WORKER.md), validate synchronous query semantics and latency, and demonstrate recovery through a wired fallback before enabling it by default.

**F. Make production builds understandable and verifiable**

Extend [BuildReportDialog](../src/components/BuildReportDialog.tsx) and the existing exporter with a guided sequence: **Choose platform → Check project → Build → Test output**.

- Provide a simple default build profile using project name and launch scene, with advanced settings available. Persist stable application identity and version fields through the existing profile system.
- Group issues by what the creator must do: missing content, invalid logic, exceeded target budgets, or missing platform tooling. Link content errors to their objects/assets and preserve technical details for troubleshooting.
- Display build progress, failure stage, output location, and retry. Keep built, staged for another host, and failed outcomes distinct. Add a way to open/serve the finished web output for local testing using the existing platform/export mechanisms.
- Extend the production smoke fixture with the guided starter's movement, rule, imported animated model, UI, sound, and save/restart scenarios. Test root and subpath hosting, decoder/resource loading, and runtime feature parity.
- Keep the existing CI build, unit tests, player build, and portable-export smoke checks. Add the relevant Creator workflow and model/physics browser checks. Preserve screenshots, logs, and build reports for failed acceptance runs.
- Include engine revision, profile/target, content inventory, and artifact checksums in release reports where missing. Validate release builds from clean installs and test the produced artifact, including local save behavior, on each supported target.
- Check desktop installers on their actual OS. Show whether signing/distribution requirements have been completed. Public macOS distribution requires the appropriate signing/notarization process; a local ad-hoc test build has a different release status. [Tauri macOS distribution guidance](https://v2.tauri.app/distribute/sign/macos/).
- Add mobile only after a device-tested slice: safe areas, touch controls, texture support, memory, pause/resume, performance, and signing. Maintain a clear per-platform support matrix.

Done when another person can run the exported starter on a clean target environment, complete its game loop, restart it, and identify the exact source/profile used to build it. Generating an installer or passing a compiler alone does not complete this milestone.

**Implementation rules that keep this manageable**

- Use the existing React/TypeScript, Zustand, Three.js, Rapier, and Tauri stack. Evaluate dependency upgrades separately from this feature scope and check APIs against installed versions; linked upstream documentation can describe newer releases.
- Give new persisted fields explicit defaults and migration coverage. Save/load, duplicate/prefab, undo/redo, and old-project compatibility are part of each data change.
- Route UI changes through typed store actions. Mirror new editor capabilities in AI tools, activity labels, prompts, and snapshots according to [the existing contributor checklist](AI_ASSISTANT.md). The guided beginner path must also work manually.
- Keep each change reviewable: reproduce → focused implementation → targeted behavior checks → documented acceptance. Run the full required project checks before integration; add browser/native verification when the changed behavior needs it.
- Use a feature flag for new controller semantics or experimental runtime work until migration and gameplay parity pass. Keep a known-good starter and export available throughout development.

**Suggested first pull requests**

| Order | Concrete change | Acceptance evidence |
| --- | --- | --- |
| 1 | Baseline the Platformer creation/play/export exercise and define budgets. | Recorded baseline, repeatable fixture, known failures. |
| 2 | Reproduce/fix compressed model inspection and surface import diagnostics. | Compressed rig/material fixture retains metadata or reports a specific limitation. |
| 3 | Make simple-rule addition atomic. | Failed compile leaves state unchanged; one undo restores the prior state. |
| 4 | Add the starter lesson and launcher recovery feedback. | Beginner reaches and edits the recommended game without an API key. |
| 5 | Add one polished collectible/door recipe with named pickers. | Rule behaves identically after save/reopen and export. |
| 6 | Add edit/delete ownership handling and explicit player input policy. | Custom graph edits survive; new rules preserve player movement; old projects retain behavior. |
| 7 | Apply the starter art kit and safe appearance replacement. | Approved visuals, intact colliders/animation/gameplay, measured budgets. |
| 8 | Add physics presets and expand the regression course. | Cadence, platform, trigger, and projectile acceptance results. |
| 9 | Simplify the build flow and add the complete starter to release checks. | Web artifact acceptance plus host desktop validation. |

The release candidate is ready when the beginner exercise succeeds, the reference game is visually coherent and within its measured budgets, model and physics fixtures pass, old projects still load, and the actual exported game completes the same playable loop.
