# Make and ship your first game

Start Feather with `npm ci` followed by `npm run dev`. Open the address printed by Vite. Choose **Platformer** in Quick starts to create Cloudstep Garden. This starter works offline after the editor has loaded and needs no AI account.

1. Follow **Your first game** above the workspace. Select a sun seed and change a color in **Appearance**. You can collapse the guide and resume later.
2. Select an ordinary prop. In **Interactions**, choose a recipe or a **When / Do** rule. Edit, disable, duplicate, or delete it from its card. Duplicates start disabled so they do not accidentally run twice.
3. Click **Play**, then **Let’s play**. Use WASD to move, Space to jump, Shift to dash, left click to bop, and P to pause/resume. Collect seeds and follow the course to Sunny. The pinwheel is a checkpoint. **Restart course** resets the run; **Play again** resets after a win. Editor **Stop** restores the authored scene.
4. Click **Save**. In a browser, keep the downloaded `.nforge` file: it includes imported asset bytes. Open that file to continue later. The desktop editor saves into the project folder.
5. Choose **Export → Production**, select a platform and launch scene, then check the project. Fix any blocking errors. Desktop builds show their logs and output folder. The browser downloads a build package and displays the command to finish it locally.

For the browser route, after downloading `game.json`, run this from the repository:

```bash
npm run export:production -- --bundle "/absolute/path/to/game.json" --targets web --name "My First Game" --zip
```

The output folder and zip are printed when the build finishes. Serve the web folder over HTTP with a static server, or upload its contents to your static host. Keep every file and subfolder together. Double-clicking `index.html` is not a hosting test. See [production export](PRODUCTION_EXPORT.md) for desktop/mobile prerequisites and signing.

## Replace a prop’s appearance

Import a GLB, or select a `.gltf` together with all its referenced `.bin` and image files. The import report lists dimensions, triangles, materials, clips, and warnings. Missing sidecars must be supplied; external network resources are not fetched during packing. Optimization retains a separate original model asset when it changes the bytes.

Select a gameplay object with a mesh and choose its imported model under **Appearance**. Feather creates a visual child and hides the original mesh. The root keeps its collision shape, position, movement, and logic. Resize the visual child to fit the collider; replacing art does not automatically redesign collision. **Restore original** reverses the replacement. Move any children you added under the visual child before restoring it.

For linked Model Forge props, edit the source model directly. Cloudstep includes a matching gift crate, sprout lantern, and garden gate. Model definitions travel in project/template packages and receive independent IDs on import. Animated rigs use the existing Skeleton/Animator workflow; simple appearance replacement refuses an active rig rather than guessing animation mappings.

## Tune movement and add logic

Select the Player and find **Movement feel** under **Gameplay**. Start with **Forgiving platformer** or **Grounded adventure**, then change the exposed values in small steps. The presets include acceleration, jump/gravity, coyote time, step height, slope limits, and ground snap. Surface presets provide starting friction and bounce values. Try the same jump or stair after each change.

Rules compile into ordinary Blueprints. A game-start sound or signal on a built-in Player keeps its movement controls. Put entry/exit sensor rules on a separate trigger object; a player needs its solid collider. A solid collision rule and an entry/exit sensor cannot share the same collider.

You can open a rule’s graph or FeatherScript as you learn. Once custom graph changes exceed what cards represent, those cards become protected. Continue editing in Logic or add another managed rule; the editor preserves your custom program. Compilation failures leave the last working graph and related project state intact.

For keyboard toggles, use `on key_pressed("KeyP"):` or choose **Once per press** on a Key Down node. This retains very short taps and runs once when held. Existing `on key_down(...)` handlers continue running every frame while held, which is useful for movement. Exported games declare the new keyboard capability so an older player cannot silently use the wrong behavior.

## Add one behavior as a contributor

1. Add the typed trigger/action or recipe in `src/creator/simpleInteractions.ts` or `interactionRecipes.ts`. Keep generated behavior in the existing FeatherScript compiler/runtime.
2. Validate all inputs and dependencies in `src/store/editor/simpleInteractionActions.ts` before publishing one store change. Preserve hand-authored base source and shared Blueprint ownership.
3. Expose the setting in the rule form, then mirror it in `src/ai/tools.ts`, activity labels, routing, and snapshots when needed.
4. Verify failure leaves state intact, undo restores the whole action, and the saved/reopened rule remains editable. Extend the existing tests with the behavior’s observable outcome.
5. For runtime changes, build the player and run the exported-game checks below.

```bash
npm test
npm run build
npm run build:player
npm run test:production
# Keep npm run dev running in another terminal:
npm run test:beginner
```

The beginner test uses installed Chrome/Chromium (`CHROME_PATH` can override discovery). It creates a starter with the catalog blocked, edits a real rule, bakes/imports a GLB, downloads and reopens the project, walks through export, and tests the player at both a root URL and a nested hosting path. It writes projects, reports, and screenshots to `exports/beginner-acceptance/`. Its separate acceptance game contains position/win probes and uses Low quality for software-rendered Chrome; `cloudstep-garden-web/` is the clean edited game.
