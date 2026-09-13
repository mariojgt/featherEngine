# Button actions and Blueprint guidance

Select a button in the UI designer. Under **When clicked**, choose an action, choose its level or screen if needed, and press **Apply action**. **Show logic** opens and selects the button's click event so you can extend its ordinary Blueprint nodes.

Available actions:

| Action | Behavior |
| --- | --- |
| Start game / load level | Loads the chosen level; closes this screen by default. Loading the current level resets it. |
| Restart current level | Resets the currently played level and resumes game time. |
| Open / close / toggle a screen | Changes a screen's visibility. Open and toggle can also close the button's own screen. |
| Pause and open a screen | Opens a screen and pauses game time. Add a Resume game button to that screen. |
| Resume game | Resumes game time and closes the button's screen. |
| Custom Blueprint event | Uses an event name that matches a running Blueprint's Custom Event. |
| No action | Disconnects this button from its click event. |

Level loads and restarts keep project variables such as score and unlocks. Use **Show logic** to reset specific variables before the Load Scene node when needed. Screen visibility resets to each document's **Visible on start** setting on a level load, with the selected **Close screen after loading** exception. Editor debugging pause is separate from game time.

The designer and UI Logic view explain missing listeners, click events without an outgoing execution connection, missing levels and missing UI targets. Use **Go to connection** or click a guidance/Problems entry to select the relevant button or node. The node inspector explains which target field needs fixing. Authored diagnostics pause during Play.

Changing an unchanged generated action replaces its branch as one undo step. Moving nodes does not prevent replacement. Editing node settings, adding/removing wires, or sharing the event with a duplicated button preserves that graph; applying another action creates a fresh handler for this button. Choosing the current generated event as a custom event keeps its graph. Disconnected custom branches remain available for reuse or manual deletion.

Generated UI logic runs once per level through a transient controller. An existing authored controller takes precedence, including one explicitly disabled. Stop restores authored scenes without retaining generated runtime objects. Project saves and game bundles preserve these actions. Imported menu copies receive independent generated click events and remapped targets; a level omitted from an asset package must be selected again after import.

The player contract feature `ui-button-actions` covers project UI logic, level restart behavior and closing a screen after a load. Older runtime packs reject games requiring this feature. Rebuild the player/runtime pack when updating an installed editor.

The in-editor assistant supports `set_ui_button_action`, `get_interaction_problems`, and `open_ui_logic` with `elementId`. The snapshot includes each button's current action and its document's logic scope. Hand-edited handlers appear as custom events.

Verification: store/runtime tests cover undo, replacement ownership, duplication, save/load, imports, level changes, restarts, pause/resume and Stop restoration. `node scripts/e2e/ui-button-actions.mjs` runs the real browser designer → logic → repair → game-button journey against `npm run dev`.

Native launch checks use a fresh, nonpersistent webview session. This keeps cached game data from previous checks out of the result. Native HTML and game manifests are served without caching; normal game sessions retain their saves. Failed checks include captured launch errors when available.

Acceptance limitation (macOS, 2026-09-13): the scratch game identifier `com.thedevrealm.buttonactionsbrowsercheck` repeatedly timed out before the native readiness signal, including after fresh webview storage. The same UI game under `com.thedevrealm.uibuttonacceptance2` and the standard native smoke fixture launched successfully. The cause of the identity-specific timeout remains unresolved; do not treat those passes as verification of every native launch profile. The production browser game passed real menu-button clicks.
