# Sproutwatch · Garden Defense

Choose **Tower Defense** in the project launcher, then press **Play → Let’s grow!**
You can also open **Asset Store**, search **Sproutwatch**, and choose **Use template → Create project**.
If the store was already open, click **Refresh catalog** first. The store package includes the default garden (seed `2718`).
Every new starter project generates a different seeded garden. Everything runs offline, in editor
Play and in an exported game; there are no downloaded art, font, or audio dependencies.

- Select Pea Sprout, Snowdrop, or Pumpkin Mortar, then click a numbered pad to buy it.
- Send each wave when ready. Stop ten waves before the garden’s 20 health runs out.
- Earn sun coins from defeated zombies and completed waves. Build, upgrade, and sell between waves.
- Click an existing defender to see its range, upgrade it (three levels), or sell for 70% of its investment.
- **1 / 2 / 3** select defenders. **Space** sends a wave. **P** pauses. The speed button switches 1× / 2×.
- The help, sound, fullscreen, pause, and replay controls are also available on screen.
- Leaving the browser during a wave pauses play; resume explicitly when ready.

Pea Sprouts deal rapid single-target damage, Snowdrops slow their targets, and Pumpkin Mortars damage
clusters. Place them near bends and combine slowing with splash damage. Runners arrive from wave two;
armored brutes join from wave three.

## Customization

The garden is ordinary editable Feather scenery with shared toon materials. Change colors, trees,
flowers, fencing, and the mushroom cottage in the hierarchy. Move, rotate, scale or reparent the entire
Game director to reposition the garden; the gameplay and camera follow it. The numbered pad previews and path geometry
correspond to the generated gameplay map; moving these previews does not change the route or pad positions.

Use Feather’s `create_tower_defense_template` AI tool with an optional integer `seed` to create a
reproducible layout in a fresh project. The default tool seed is `2718`; the launcher picks a new seed.
The saved game director carries the seed. Generate a new project to change maps so scenery and gameplay
remain aligned. Calling the builder again in the same garden safely returns the existing director.

Game rules and live UI use the built-in Sproutwatch runtime, rather than generated Blueprints or UI
documents. Developers can extend the independent simulation in `src/towerDefense/game.ts`, scenery in
`scenery.ts`, character meshes in `actors.tsx`, and the HUD in `TowerDefenseHUD.tsx` / `towerDefense.css`.
Runtime progress resets on replay or Stop/Play; saving a project saves its authored garden, not an active match.

Production exports declare the `sproutwatch-tower-defense` runtime capability so outdated players reject
the game clearly instead of opening an unplayable scene. The same world, camera and HUD run in both players.

Run focused checks with:

```sh
npx vitest run src/towerDefense/__tests__/game.test.ts src/project/__tests__/towerDefenseTemplate.test.ts src/store/__tests__/marketplaceInstall.test.ts
npm run build
# With the dev server running (override E2E_BASE_URL if using a different port):
node scripts/e2e/tower-defense.mjs
```

To refresh the bundled store package after changing the template, open `/?exportTemplate=tower-defense`
on the dev server, wait for the export to finish, then run `npm run build:store`.
