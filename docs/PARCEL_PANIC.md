# Parcel Panic

A small, complete delivery game on sunny Postcard Island. Play Pip, a mint-green robot courier, and deliver five parcels to three neighbours. Walk a parcel into its matching basket or throw it for an air-mail bonus. Each village seed places houses, connected paths, garden props and a bounce pad in different safe plots. Push crates, roll mail drums, bounce rubber balls and dodge the spinning gate. Parcels have different weights and tumble when thrown; baskets and garden edges have physical colliders.

The landscape uses a postal plaza, covered sorting depot, individual house gardens, coastal groves and marked prop bays. Seed changes stay within these planned spaces.

Everything is editable: primitive-based art, eleven reusable prefabs, FeatherScript blueprints, UI documents and a nine-second, three-shot opening cinematic. Five original audio assets provide music and pickup, throw, delivery and completion effects. The project package embeds the audio for offline use.

## Start and play

1. In Feather's launcher, name your project and choose **Parcel Panic** in quick starts. This built-in starter works without the Asset Store catalog or an AI account.
2. Press **Play**. Watch the opening or press **Enter** / **Start delivering** to skip. Controls unlock when the cinematic ends.
3. Pick up a parcel at the depot. Match its ribbon colour and address dots to **01 Coral**, **02 Bluebell** or **03 Honey**. The HUD names your current destination.
4. Complete five deliveries to see your score and stars. **New village** generates a new route in the current mode; **Retry this village** preserves the current seed. The pause menu shows its village code. The first round is relaxed, with no deadline. Press **P** to try the **90-second rush**, or choose it after a round.
5. Press the editor's **Stop** before editing.

| Control | Action |
| --- | --- |
| WASD | Move |
| Space | Jump |
| Shift | Hurry |
| E | Pick up a nearby parcel |
| Q | Throw the carried parcel |
| R | Recall all undelivered parcels to the depot |
| P | Pause or resume |
| Enter | Skip the opening |

On-screen buttons also provide pickup, throw, recall and pause. Face a matching basket within nine units for a gentle throw assist. A delivery earns **100 points**, plus **50** if it arrives within 1.6 seconds of being thrown. Complete all five with 600 points for two stars or 700 for three. Missed parcels that fall off the island return to the depot; Pip also respawns after a fall. Recall keeps completed deliveries and your score.

The Asset Store includes the same complete editable project under **Parcel Panic** (`template-parcel-panic`). You only need one of these starting routes.

## Make it yours

Try these changes with Play stopped:

- Select a house roof or tree in the Hierarchy and change its material colour in Appearance. Materials are shared, so duplicate one first for a unique variation.
- Select **Pip · Robot Courier** and open **Courier · Movement and round flow**. Change the `walk_speed` script variable to tune movement.
- To reproduce a village code, set the default value of the `PPSeed` project variable, then press Play. The Village blueprints place the scenery at runtime.
- Pip has separate shoulders, elbows, hips, knees, head and antenna pivots. The Courier blueprint drives idle, walk, sprint, jump, landing, pickup, carry, throw and celebration poses from actual horizontal motion, with visible breathing and head glances while idle. Carrying poses plant the feet when stopped, and Pip stays animated during the opening. Its clock uses `on update(dt)` so animation timing stays consistent across frame rates.
- Inspect a parcel's **Parcel · Pick up, carry, throw and deliver** blueprint. `parcel_mass` changes weight and carrying speed; `throw_speed` controls unassisted throws; `destination` and `confetti` reference objects in the scene. Changing a ribbon colour alone does not change its destination.
- Open **Cinematic** and edit the three named camera shots in **Parcel Panic · A very special delivery**. Keep the final `PPBegin` event: it unlocks gameplay. Test both watching and skipping after edits.
- Open **Parcel Panic · HUD and menus** in the UI editor to change the prompts, layout or stylesheet.
- Reuse the robot, three houses, three parcel types, coastal grove tree, rolling drum, crate and rubber ball prefabs. Parcel prefabs reference this scene's delivery baskets; reconnect those references when using them in a different scene.

The five-parcel round goal, ninety-second limit and star thresholds live in the game-loop blueprint and UI bindings. Update both when changing the rules. Begin with visual edits before adding destinations or changing parcel counts.

## Save and share

Click **Save**. In the browser, keep the downloaded `.nforge` file and reopen it to continue editing. In the desktop editor, save into your project folder. Test a reopened project before sharing it.

For a playable game, choose **Export → Production**, select the launch scene and web target, and resolve any blocking checks. Desktop builds locally; browser export provides a bundle and a command to finish on your machine. See [Production Export](PRODUCTION_EXPORT.md). Serve the complete exported web folder over HTTP or upload it to a static host.

For an editable starter, export a project package. The staged Asset Store package is `.feather-cache/store/packages/projects/template-parcel-panic.nfpack`.

## Contributors

`createParcelPanicTemplate({ seed?: number }): Promise<string>` in `src/project/parcelPanicTemplate.ts` returns the player ID. `newProjectFromStarter(name, 'parcel-panic')` creates a fresh project and invokes it. The editor AI exposes `create_parcel_panic_template` with an optional seed through the same builder. Omit the seed for a random starting village. `parcelPanicVillage.ts` holds safe plot bounds and matching deterministic FeatherScript generation; objects are repositioned on reroll rather than accumulated. `PPSeed` and `PPVillage` are round variables; retry keeps both, while `PPNewVillage` advances them.

After changing the builder, regenerate the packaged scene:

1. Run `npm run dev` and open its URL with `?exportTemplate=parcel-panic`. This development route writes `.feather-cache/store/packages/projects/template-parcel-panic.nfpack`. Wait for `document.body.dataset.templateExport`; `templateExportError` reports failure.
2. Run `npm run build:store` to stage the catalog and thumbnail. After validation, publish with `npm run store:publish`; see [Hosted asset store](ASSET_STORE.md).
3. Run `npm test`, `npm run build`, and the Parcel Panic browser check: `E2E_BASE_URL=http://127.0.0.1:17420 node scripts/e2e/parcel-panic.mjs` (use your dev-server port).
4. The browser check samples the rendered courier joints during idle, walking without a parcel, and stopping, then exercises opening/skip, pickup and throw, five deliveries, pause, timed mode, same-seed retry, a new village, and package installation into a fresh project. Also review its screenshots and check stopped carrying in the exported game.

Audio is generated deterministically by `node scripts/generate-parcel-panic-audio.mjs`; add `--check` to verify the checked-in WAVs. See [audio provenance](../public/templates/parcel-panic/README.md).
