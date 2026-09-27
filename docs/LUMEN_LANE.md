# Lumen Lane — The Astral Rift

An original, offline **three-lane MOBA starter** for Feather. Choose one of five champions, command them with the mouse, and push with two allied AI heroes against three enemy heroes. The 86 × 86 battlefield contains stone lanes, a river, forest islands, two jungle camps, six towers and two crystal cores.

## Start

Choose **Lumen Lane** in the launcher, press **Play**, select a champion, and enter the Rift. The starter is included offline. The Asset Store also provides **Lumen Lane — Astral Rift MOBA** as a portable project package.

| Champion | Role | Play style |
| --- | --- | --- |
| Aegis | Tank | Heavy armor, hammer, close-range slam, self healing. |
| Briar | Jungler | Twin blades, high movement speed, rapid burst cleave. |
| Lyra | Mid / Mage | Ranged attacks and area spells centred on the cursor, up to 12 units away. |
| Kestrel | Ranged carry | Long-range attacks, focused volleys and an arrow storm. |
| Sera | Support | Ranged attacks and area abilities that heal living allies. |

The champion choice changes the articulated model, maximum health, movement speed, basic-attack damage/range/cadence, Q and R abilities. Choices are locked during a match. Pause or results let you return to champion selection.

## Controls and objectives

- **Right-click or left-click ground:** move there using the engine's obstacle-aware navigation.
- **Click an enemy:** chase and automatically attack it until it dies or another command replaces the order.
- **Click the minimap:** issue a long-distance move command. The camera follows your champion; mouse wheel changes its zoom.
- **Q:** champion ability. **E:** dash. **R:** ultimate. **B:** channel a three-second recall to base.
- **S:** stop. **Space:** attack the closest enemy in range. **P:** open/close shop. **Escape:** close shop or pause. **Enter:** start or replay.

Movement and damage interrupt recall. Your base heals you; falling heroes respawn after eight seconds. Break any enemy lane tower to expose the enemy core. Destroy it to win. Towers prefer minions in range, so push with your waves.

Two minions per side enter each lane every 18 seconds. Two banks reuse 24 minion slots; active units are never overwritten and the scene does not grow during a match. Top, mid and bottom units follow separate authored waypoint routes.

Every match starts with **500 gold**, displayed beside **Shop [P]** in the lower-left HUD at every window size. You earn **2 gold per second**, including while respawning. Player-contributed minion defeats reward 25 gold; hero takedowns and towers reward 150; jungle sentinels reward 100 and respawn after 30 seconds. Combat rewards appear beside your balance.

Press **P** or click **Shop** to browse the Astral Armory. Buy and sell while alive within five units of your base. You can carry four different items, one of each; selling returns 70% of the price. The match continues while shopping, and champion commands stop until you close it. Close the shop and use **B** to recall. Escape closes the shop first; press it again to pause.

| Item | Price | Effect |
| --- | ---: | --- |
| Ironfang Blade | 300 | +16 basic attack damage |
| Starglass Tome | 300 | +35 spell power |
| Warden Mail | 350 | +180 maximum health; blocks 6 damage per basic hit |
| Windrunner Boots | 250 | +1.2 movement speed |
| Quicksteel Bow | 400 | +25% basic attack rate |
| Dawnstone Charm | 350 | +80 maximum health; +20 spell power |

Spell power adds to Q/R damage and healing; armor affects basic attacks, including towers, and does not reduce spells. Attack speed divides attack cooldown by 1.25. Purchases recalculate from hero base stats, so selling removes the exact bonuses. Health items grant the added health on purchase; sales clamp current health to the new maximum. Items persist through death. Restart resets items, gold, cooldowns, actors and waves.

## Edit the template

Stop Play before editing. Everything is ordinary project content:

- `src/project/mobaTemplate.ts`: scene assembly, actors, tower placement and serialized settings.
- `src/project/mobaArt.ts`: map palette, editable Model Forge meshes and three lane routes. Static kit parts are combined by colour into bounded meshes to keep draw calls manageable; vertices are normalized before serialization.
- `src/project/mobaHeroes.ts`: five champion definitions and articulated equipment/armor models.
- `src/project/mobaItems.ts`: shared item definitions, prices, icons and stat bonuses.
- `src/project/mobaEconomy.ts`: purchase/sale rules and stat recalculation compiled into the hero script.
- `src/creator/mobaShopUI.ts`: editable shop, inventory and responsive gold HUD.
- `src/project/mobaLogic.ts`: readable FeatherScript compiled into the unit, player and match blueprints.
- `src/creator/mobaUI.ts`: editable hero-selection, HUD, pause and results UI documents, including original SVG portraits.
- `src/three/PointerCommands.tsx`: reusable opt-in pointer input/minimap bridge in the shared game view. It delivers positions and actor IDs to ordinary custom events; combat runs in the blueprints.

Tune unit overrides in the Inspector, edit the champion definitions or lane routes, change Model Forge palette colours, or edit **Lumen Lane · Heroes and match HUD** in the UI editor. Save, reopen and export using the normal project workflow. No external art downloads or online service are needed.

### Pointer bridge settings

A following character opts in through instance variables: `pointerMoveEvent`, `pointerAttackEvent`, `pointerAimVariable`, `pointerTargetTag`, `pointerPlayingVariable`, `pointerPausedVariable`, `pointerBlockedVariable`, `pointerCaptureEscape`, `pointerBounds`, `pointerMapSpan`, and `pointerMapPaths` (JSON waypoint lists). Events carry a `vector3` destination or a string actor ID. The bridge ignores menus, paused/dead gameplay, open shops, and other templates without those settings. The MOBA reserves Escape for its menus while a match is active; click the editor Stop button to leave Play. Runtime event payload keys are normalized to lowercase, matching the engine.

### Script contract

Public events: `LLHero1`…`LLHero5`, `LLStart`, `LLChooseAgain`, `LLMove`, `LLTarget`, `LLAttack`, `LLPulse`, `LLDash`, `LLUltimate`, `LLRecall`, `LLShopToggle`, `LLShopClose`, `LLBuy1`…`LLBuy6`, `LLSell1`…`LLSell6`, `LLPause`.

The `LL*` project variables drive the HUD and match state. Actor variables hold team, lane, waypoints, health, damage, cooldowns, champion rigs, orders and visual references. Damage is accumulated per victim in `incoming` to preserve simultaneous hits. Cores set `exposed` after any one of their three linked guardians falls. Inactive roots use zero scale so their descendants stay attached.

## Checks and packaging

```sh
npx vitest run src/project/__tests__/mobaTemplate.test.ts
npx tsc --noEmit --project tsconfig.app.json
FEATHER_E2E_ANGLE=metal E2E_BASE_URL=http://127.0.0.1:17423 node scripts/e2e/moba.mjs
npm run build:store
npm run build
```

The browser script exports a fresh `template-moba.nfpack` via `?exportTemplate=moba`, verifies real mouse/keyboard input and the follow camera, captures review images, imports the archive into a new project, and writes a portable game bundle. On non-macOS systems use the graphics backend appropriate to your browser instead of `metal`.
