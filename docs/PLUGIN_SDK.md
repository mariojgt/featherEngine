# Feather Plugin SDK

Feather has two deliberately separate extension paths:

- **Assets and `.nfpack` packages** are portable project content: models, textures, audio, prefabs,
  materials, Blueprints, and their dependencies.
- **Plugins** are trusted TypeScript modules that add editor behavior: commands, dockable panels, and
  logic built on the public Feather API.

The Plugin SDK is additive. It does not replace Feather's stores, project format, asset importer, or
runtime. The current API version is `0.2.0`.

> [!IMPORTANT]
> This is an in-process developer SDK. Plugins are compiled into Feather and have the same trust
> level as engine code — there is no runtime code loader, signature check, permissions dialog, or
> sandbox. What DOES exist now is the store install path for compiled-in plugins: a plugin can ship
> in the **gallery** ([`src/extensions/availablePlugins.ts`](../src/extensions/availablePlugins.ts))
> instead of `bundledPlugins`, stay dormant, and be activated by installing its Asset Store package —
> a manifest-only `.nfpack` whose `meta.pluginId` names the module. The install persists (localStorage
> via `src/store/pluginStore.ts`) and re-activates on every boot; removing it from the store card
> deactivates it immediately. Since the package carries no code, everything that can run still
> shipped with the engine. `Arbor Forge`, `Model Forge`, and `Pixel Art Trees` are worked examples
> of the whole path; Pixel Art Trees also demonstrates how a plugin can author a compact engine
> recipe while the renderer remains a normal, collaboration-safe Feather subsystem.

## What works now

| Capability | API |
| --- | --- |
| Register searchable commands | `api.commands.register(...)` |
| Register and open dockable editor panels | `api.panels.register(...)`, `api.panels.open(...)` |
| Register AI-assistant tools (available in chat + MCP) | `api.tools.register(...)` |
| Read a detached project snapshot | `api.project.read()` |
| Group synchronous project edits | `api.project.transaction(...)` |
| List, create, rename, remove, select, and transform scene objects | `api.objects.*` |
| Read the tree library + stylized preset gallery; add/update assets; place trees; plant groves | `api.trees.*` |
| Read the prototype-model library + starter kits; edit parts/palettes; place props; bake GLB assets | `api.models.*` |
| Open built-in editor panels (`'trees'`, `'terrain'`, `'materials'`, …) as a fallback of | `api.panels.open(...)` |
| Observe stable project, scene, selection, model-library, and Play-mode events | `api.events.on(...)` |
| Show editor notifications and namespaced logs | `api.ui.notify(...)`, `api.log.*` |
| Clean up every registration on unload or failed activation | plugin lifecycle host |

The editor discovers registered commands in the command palette and registered panels under
**View → Extensions**. Saved Dockview layouts can resolve plugin panels because bundled plugins are
activated before React mounts.

## Minimal plugin

Create a TypeScript or TSX module under `src/extensions/`:

```tsx
import { defineFeatherPlugin } from './index';

const pluginId = 'com.example.world-tools';
const panelId = `${pluginId}.panel`;

export const worldToolsPlugin = defineFeatherPlugin({
  id: pluginId,
  name: 'World Tools',
  version: '1.0.0',
  apiVersion: '0.2.0',
  activate(api) {
    api.panels.register({
      id: panelId,
      title: 'World Tools',
      placement: { referencePanel: 'inspector', direction: 'within' },
      render: () => <button onClick={() => api.ui.notify('Hello from a plugin')}>Run tool</button>,
    });

    api.commands.register({
      id: `${pluginId}.open`,
      title: 'Open World Tools',
      group: 'Extensions',
      run: () => api.panels.open(panelId),
    });
  },
});
```

All command and panel ids must begin with `<plugin id>.`. The registry rejects collisions instead of
silently replacing another plugin's contribution.

Add the definition to `bundledPlugins` in
[`src/extensions/bundledPlugins.ts`](../src/extensions/bundledPlugins.ts), then rebuild Feather. The
included `Scene Tools SDK Example` plugin is a complete working reference: it contributes two
commands, a panel, and project mutations.

## AI-assistant tools

A plugin can hand the in-editor assistant (and external agents over MCP) a tool without any engine
wiring: `api.tools.register(...)` merges it into `getActiveEngineTools()`, the same tool surface the
chat uses.

```ts
api.tools.register({
  id: 'build-from-image',            // bare tool-name; the engine namespaces it `pluginId.build-from-image`
  title: 'Build model from image',   // optional short chip label
  description:
    'Rebuild an object from a reference image as a model asset. Takes a name, a hex palette (1-16), and a kit-bash of primitive parts (shape, position/rotation/scale, color slot).',
  inputSchema: z.object({
    name: z.string(),
    palette: z.array(z.string()),
    parts: z.array(z.object({ shape: z.string(), scale: z.array(z.number()).length(3).optional() })),
  }),
  execute: async (input) => {
    // Run against the live editor (useEditorStore), build/bake, return a short string.
    return 'Built "Vase" and baked it to vase.glb in the Assets panel.';
  },
});
```

- `inputSchema` is a zod schema (same shape the built-in tools in `src/ai/tools.ts` use).
- `execute` returns a string (or small stringifiable object) — the model reads it to decide its next step.
- When the plugin is enabled, the tool appears to the assistant and to external agents with zero
  engine changes; disabling the plugin removes it.
- The on-device local AI (WebGPU) does not surface plugin tools — they assume a remote, vision-capable
  model. Enable the tool's verdict from `list_plugins` description so the model knows when it's live.

## Safe project edits

Plugins receive detached snapshots rather than the live Zustand stores. Mutation is explicit:

```ts
const platformId = api.project.transaction('Create platform', () =>
  api.objects.create({
    kind: 'cube',
    name: 'Platform',
    position: [0, 0.25, 0],
    scale: [6, 0.5, 6],
  }),
);

api.objects.select(platformId);
```

Transactions must be synchronous. They coalesce public events and work with Feather's existing undo
capture; they are not rollback-capable database transactions. Project mutations are rejected while
Play mode is running.

## Lifecycle

`activate` may return a cleanup function. Feather also tracks every command, panel, and event
subscription registered through that plugin's API. On deactivation, on activation failure, or during
future hot reload, the host runs plugin cleanup and removes all tracked contributions. Open plugin
panels are closed before their render functions are unregistered. Event handlers and panel rendering
are error-isolated, so one faulty plugin does not take down unrelated plugins or the editor workspace.

## Shipping a plugin through the Asset Store

1. Author the plugin under `src/extensions/` against the public API (see
   [`arborForge.tsx`](../src/extensions/arborForge.tsx) or
   [`pixelArtTrees/index.tsx`](../src/extensions/pixelArtTrees/index.tsx) — both use only `api.*`,
   never the raw stores).
2. Register it in [`availablePlugins.ts`](../src/extensions/availablePlugins.ts) (NOT
   `bundledPlugins.ts` — gallery plugins stay off until installed).
3. Add a `kind: 'plugin'` pack to `scripts/build-store-catalog.mts` whose `meta.pluginId` is the
   plugin's id, then run `npm run build:store`.

Installing the package activates the module and persists the choice; the store card flips to
**Remove**, which deactivates it (panels close, commands vanish) and forgets it. A catalog listing
whose `pluginId` is not in the running build renders as "Needs newer build" instead of a broken
install.

## Next layers

The registry is the stable seam for future work. The next useful increments are:

1. Expand capability services for assets, scenes, Blueprints, materials, importers, and build hooks.
2. Add a manifest and local-folder loader that resolves compatibility before activation.
3. Add development hot reload. (The installed-plugin manager exists: **Preferences → Plugins** lists
   gallery plugins with an on/off switch, always-on bundled plugins, and installs waiting on a newer
   build.)
4. Add permissions, signing, process isolation, and downloaded-code loading only after the API is mature.

New engine access should be added as a typed capability on `FeatherPluginAPI`, rather than exposing
the raw store. That keeps plugin code stable while Feather's internals continue to evolve.
