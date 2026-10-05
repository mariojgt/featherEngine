# Cinderfall — Extraction FPS

Cinderfall is an original single-player sci-fi mining expedition: recover sixteen aetherite
units from an authored basalt cave, survive eight cavewardens, and return to the amber rig
before it departs. It has a complete brief → mining → extraction → results → replay loop.

The design uses faceted cave rock, teal mineral light and ochre industrial equipment. Its
art, creature design, interface and deterministic synthesized sound are original. It takes
broad inspiration from sci-fi mining games. It is one focused mission, with no co-op,
destructible terrain, inventory economy or procedural level-generation claim.

## Play

Use the Cinderfall project listing in the Asset Store, or create a fresh source-build project
with `newProjectFromStarter(name, 'cinderfall')`. Press Play and choose **Begin expedition**.
Click the viewport to capture the mouse; Escape releases it. Menus release it automatically.

| Input | Action |
| --- | --- |
| WASD / Shift | Move / sprint |
| Mouse / left button | Look / fire VX-24 |
| Space | Jump |
| R | Reload the 24-round magazine; refill takes 1.25 seconds |
| Hold E near a vein | Mine a unit every 0.35 seconds; each vein holds four units |
| Hold E at the rig after quota | Secure cargo and finish |
| F | Toggle headlamp |
| P | Pause and resume; the simulation clock freezes |
| Enter on brief/results | Begin / replay |

There are five veins, allowing a choice of route. The quota requires four. Some creatures
wake after six units, and the final pair wakes when the quota is reached. The rig allows
75 seconds for the return. Losing suit integrity or missing departure ends the expedition.

## Edit and reuse

The scene hierarchy groups basalt, survey equipment, veins and creatures separately. Seven
Model Forge definitions contain original editable rock meshes, crystals, the rifle, shell
and legs. Seven prefabs provide cargo cases, the extraction rig, a mineable vein, a creature
and a neutral rifle prop. The camera weapon remains a live-linked Model Forge asset.

Six ordinary Blueprints own presentation, player controls, mining, creature behaviour, gait
and expedition rules. Open Logic and switch between the graph and FeatherScript. Tune the
controller's walk speed, fire interval or reload duration; tune creature speed and alert
thresholds; change the global quota and departure time with their corresponding director
defaults. Keep the GUI descriptions and HUD limits in sync when changing those numbers.

The HUD, brief, pause and result pages are one editable DOM UI document with anchored
elements and live bindings. The player's `health` instance variable is authoritative;
Feather mirrors it into `Health` for the HUD. The rifle uses the project `CFAmmo` counter;
it deliberately avoids a second native `ammo` instance counter.

Camera view-model support for Model Forge assets was added with this template. Use a
Feather build containing that support. An older release may load the cave and logic while
omitting the camera weapon; this package does not update an installed engine's runtime.

## Source and verification

- `src/project/cinderfallTemplate.ts`: authored level, components and gameplay sources.
- `src/project/cinderfallArt.ts`: editable Model Forge definitions and original low-poly meshes.
- `src/project/cinderfallAudio.ts`: deterministic WAV synthesis embedded in the package.
- `src/creator/cinderfallUI.ts`: editable UI and its stylesheet.
- `scripts/e2e/cinderfall.mjs`: actual packaged-player interaction and export verification.

```sh
npm test -- src/project/__tests__/cinderfallTemplate.test.ts
npm run build
E2E_BASE_URL=http://127.0.0.1:17427 npm run test:cinderfall
```

The browser check exports the real builder, imports its `.nfpack`, tests character movement,
pause, headlamp, actual projectile hits, magazine depletion, delayed reload, mining, quota,
extraction, departure failure, restored enemies/veins after replay, and a verified game bundle.
Screenshots and `game.json` are saved under the ignored `.feather-cache/cinderfall-review/`.
Test positioning and shortened departure timing isolate mechanics; screenshots are not a
claim about performance on all devices or an untouched full-session recording.

For publishing and real package screenshots, follow [Hosted asset store](ASSET_STORE.md).
Always capture after the final export so screenshot provenance matches the archive bytes.
