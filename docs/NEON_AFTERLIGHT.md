# Neon Afterlight — District 09

A complete **70-second cyberpunk film**, rendered live in Feather Engine at Epic quality. The camera moves through a rain-soaked service street: cyan signs reflected in foreground water, a warm night market, rising steam, a passing searchlight drone, an electrical arc, cooling-water spray and a final crane shot through the tower canyon.

## Open the editable project

In **Asset Store**, search **Neon Afterlight**, choose **Use template**, then **Create project**. Press **Play** for the film; **R** restarts it. Stop restores the authored rain and drone position.

The updated template is **v1.1.0**. The standalone package is `.feather-cache/store/packages/projects/template-neon-afterlight.nfpack`. It embeds all **16 assets**: eleven GLB models (including five emissive signs), four PBR surface maps and an original stereo synth score with rain/steam/electrical sound design. The models embed their own facade/sign textures. No external asset downloads are needed after import.

Project packages now preserve their authored render settings, including Epic quality, bloom, ambient occlusion and color grading. Older packages retain the new project's defaults; adding an asset pack leaves the current project's render settings unchanged.

The AI tool `create_neon_afterlight_template` also builds the showcase in the active scene. Use a blank project for that route. The new local fog lighting requires the updated renderer in this checkout; importing a project package alone does not upgrade an older engine installation.

## Direct the film

All geometry, materials, lights, particle emitters and cameras remain editable. Open **Film Mode** for the shots, drone movement, VFX visibility, score and titles. Open **Afterlight · Rain and atmosphere direction** in Blueprints for the rain progression and replay. Scrubbing previews the camera; play from the beginning to evaluate event-driven weather.

| Time | Shot and feature |
| --- | --- |
| 0–8 s | Puddle-level approach: neon, wet asphalt, water reflections |
| 8–16 s | District reveal: layered towers, signs and distant haze |
| 16–23 s | Night market: amber practical lighting against the cyan street |
| 23–30 s | Steam vent: rising particles and colored mist |
| 30–37 s | Courier: animated drone and moving searchlight |
| 37–44 s | Service arc: live sparks and electrical light |
| 44–52 s | Beneath the crossing: water and reflected signage |
| 52–58 s | Cooling system: lit service exchanger, fine droplets and impact spray |
| 58–64 s | Vertical city: crane move through the tower canyon |
| 64–70 s | Final street view, credits and fade |

## Lighting and VFX

Nine rectangular lights support the emissive signs and overhead bounce. Point lights illuminate the pavement and the cyan/amber service lamps around the cooling assembly; two spotlights supply the drone beam and crossing inspection light. Emissive sign materials have real texture masks, so the lettering appears in the reflection system. Geometry is batched by material within each city module.

The street uses wet PBR materials and puddle normals. Three shallow water volumes supply planar reflections, rain ripples and gentle surface motion. Epic also enables screen-space reflections. Lux supplies local radiance/reflections. A bounded set of nearby lights contributes color to the volumetric mist. Narrow searchlight cones now use deterministic integration over the visible light volume, removing the coarse sampling speckles without blurring the scene. The cooling close-up has a visible return pipe and outlet, cyan/amber service lamps, a mechanical exchanger and finer droplets.

The refined renderer removes stretched screen-space misses and stale reflections at camera cuts. Epic water now uses a full-resolution HDR mirror refreshed every frame; rain-ring distortion is filtered and reduced so reflected signs remain legible. Wet walls retain more of their authored roughness. These fixes apply to existing projects when opened in the updated engine, including the original Neon Afterlight package.

**Scene Settings → Volumetric Fog → Local light scatter** controls that new engine feature (0–4, default 0 for older scenes). It supports point lights, spot cones and rectangular lights. Medium considers up to two lights, High four, Epic six; Low disables the fog pass. The list ranks nearby lights by influence and follows their world transforms, including a parented drone light. The same strength is available through `set_scene_environment` and the Set Environment Blueprint node.

The local fog approximation is **unshadowed**: walls do not block its scattered light, and rectangles are approximated as directional area-weighted sources. Existing sun shafts retain their shadow-map support. Screen-space reflections depend on the camera view and can show edge/cut artifacts; planar water handles a flat reflection plane. The cooling stream and steam are particle effects, not fluid simulation. See [Lighting, weather and reflections](CINEMATIC_LIGHTING.md) for the other controls and limits.

## Render and validate

Requires the project dependencies, Chrome/Chromium, `ffmpeg` and `ffprobe`.

```sh
npm run cinematic:neon:assets
FEATHER_CAPTURE=1 npm run dev -- --host 127.0.0.1 --port 17421
# In another terminal:
npm run cinematic:neon:preview
npm run cinematic:neon:render
```

The master is **1920 × 1080, 24 fps, 70 seconds, H.264/AAC**, with a 2.39:1 composition inside the 16:9 frame. It renders every frame from the live player at fixed simulation steps and mixes the synchronized stereo score. The output folder contains `neon-afterlight.mp4`, the editable `.nfpack`, embedded-asset `game.json`, soundtrack, review stills and a verified media report.

To render an edited export:

```sh
npm run cinematic:render -- --bundle path/to/game.json --template neon-afterlight --quality Epic --output exports/my-neon-film
```

Use `--preview --times 4,12,26,33.5,41,48,55,61` for selected stills. Rendering at High lowers the cost and retains the lights, local fog, wet materials and planar water, while disabling SSR. Offline render speed is not a real-time frame-rate benchmark. GPU results and particle initialization can differ between runs and devices.

With the dev server running:

```sh
node scripts/e2e/local-fog.mjs
node scripts/e2e/fog-beams.mjs
node scripts/e2e/neon-afterlight.mjs
node scripts/e2e/cinematic-reflections.mjs exports/cinematics/neon-afterlight/game.json
node scripts/e2e/reflection-quality.mjs
npm test
npm run build
```

The fog fixtures measure actual GPU color changes, verify neutral output when local scatter is disabled, compare thin beams against dense integration at Medium/High/Epic and check camera motion and foreground occlusion. The Asset Store test installs the real package, checks every embedded asset's hash, verifies all references and runs the rain/drone cues. Unit tests cover fog budgets, hidden parents, moving light transforms, package remapping, camera continuity and replay restoration.

## Original content and upload text

`scripts/generate-neon-afterlight-assets.mjs` builds the modular architecture, maintenance bridge, drone, utility vent, original sign typography and material maps. `scripts/generate-neon-afterlight-score.mjs` synthesizes the score and sound design without downloaded recordings. These assets are supplied under the repository's MIT license.

Suggested title: **Neon Afterlight | Cyberpunk Cinematic — Feather Engine**

Suggested description:

> A city after dark. Neon Afterlight is a 70-second film built and rendered in Feather Engine: rain-soaked streets, neon and water reflections, colored volumetric fog, steam, sparks and a moving searchlight drone.
>
> The complete editable project is included in Feather's Asset Store, with all models, materials, ten camera shots, weather direction and original synth music. Rendered at 1080p / 24 fps using Epic quality.

The template is retired from the public starter catalog. Its development-only export key remains supported for authoring and capture; this does not republish it to the store.
