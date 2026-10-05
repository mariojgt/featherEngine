# Blackthorn Keep — the storm on the moor

A complete **70-second dark fantasy cinematic** in Feather Engine. A grass-level approach reveals a Gothic castle; rain arrives, banners strain in the wind, lightning breaks a roadside ward, and warm gate fires lead into a final aerial view. The film uses live engine rendering and physics.

## Open the entire film from the Asset Store

Open **Asset Store**, search **Blackthorn Keep**, choose **Use template**, then **Create project**. The package opens a complete world with its scene, twelve embedded assets, ten-shot camera timeline, materials, original score/weather soundtrack, and the **Blackthorn · Weather and physics direction** Blueprint. It does not need separate model or music downloads.

Press **Play** to run the film and **R** to replay. Stop restores the authored environment and props. Film Mode contains the camera shots and named beat markers. Camera scrubbing previews the framing; start playback at the beginning to see event-driven weather and destruction.

The standalone archive is `.feather-cache/store/packages/projects/template-blackthorn.nfpack`. The AI tool `create_blackthorn_template` can also construct the film in the active scene; use a blank project for this route.

## What is editable

- **World:** two terrain actors, a painted road/foliage mask, tall grass, scattered boulders and dead trees, and shallow rain pools.
- **Castle:** separate spire towers, great hall, open gatehouse and curtain-wall modules. Each is a normal GLB asset with original masonry textures; move, scale, duplicate or replace the modules in the scene.
- **Lighting:** moon key, rectangular bounce lights, live sky reflection lighting, volumetric mist, local radiance/reflections, emissive windows, gate braziers and road fires.
- **Weather:** procedural cloud cover and movement, rain accumulation, wet road/puddle shading, water ripples, shared global wind, three authored lightning envelopes, and the visible strike geometry.
- **Physics:** four simulated cloth banners, wind-affected timber, a seeded 32-piece fracture, and six seconds of slow physics with the camera/music timeline kept on time.
- **Film:** ten named camera shots, title/credit overlays, fades, color grade, markers, weather cues and an original 70-second stereo score with synthesized wind, rain and thunder.

| Time | Shot |
| --- | --- |
| 0–8 s | The field holds its breath — grass-level drift |
| 8–16 s | Blackthorn Keep — rising reveal |
| 16–23 s | The rain arrives — wet road and fire |
| 23–30 s | Stormfront — fortress under the clouds |
| 30–37 s | House of thorns — cloth in the gust |
| 37–42 s | The ward — before the strike |
| 42–48 s | Thunder breaks the ward — live slow-motion physics |
| 48–56 s | A fire behind the gate — architecture and warm light |
| 56–64 s | The crown above the storm — aerial orbit |
| 64–70 s | Blackthorn Keep — the living world |

## Engine improvements included

The lighting revision adds reusable rectangular lights, shared editor/player light settings, rotation aiming, shadow-frustum controls, exposure in stops, adjustable ambient occlusion, live sky lighting and material wetness driven by rainfall. Blackthorn uses two rectangular bounce lights, live sky reflections and automatic wet surfaces. See [Lighting, weather and reflections](CINEMATIC_LIGHTING.md) for authoring controls, quality budgets and limits.

**Scene Settings → Wind & Weather** exposes `cloudCoverage` (0–1), `cloudSpeed` (0–5), `rainIntensity` (0–1) and `lightningFlash` (0–1). The same controls are available in `set_scene_environment` and the Set Environment Blueprint node. Clouds require the procedural sky. Rain is seeded, depth-tested and advected by global wind; the quality preset bounds its particle budget. Lightning illuminates geometry, sky and rainfall together. Author a brief envelope and return `lightningFlash` to zero after it.

Rain, clouds, foliage and GPU particles read the simulation clock during Play. Cloth uses fixed 60 Hz steps, retains fractional time, pauses with the game, and uses repeatable gusts. The offline exporter mounts the actual player without editor panels or cross-window project broadcasts. Runtime weather/environment changes are restored both on Stop and when restarting or leaving a scene.

Architectural GLBs can set scene-level glTF `extras.featherPreserveScale: true` to preserve authored metres in ordinary rendering, instancing and collision geometry. This avoids the legacy extreme-scale repair shrinking a correctly sized tower. The bundled castle modules carry this flag; unmarked legacy imports retain their previous behavior.

Sculpted terrain sampling now reuses normalized immutable data and cached override lookups. Grass generation also reuses its slope sample when choosing surface color. These changes reduce CPU work while preparing dense fields and painted landscapes.

## Rebuild and render

With project dependencies, Chrome/Chromium, `ffmpeg` and `ffprobe` installed:

```sh
npm run cinematic:blackthorn:assets
FEATHER_CAPTURE=1 npm run dev -- --host 127.0.0.1 --port 17421
# In another terminal:
npm run cinematic:blackthorn:preview
npm run cinematic:blackthorn:render
```

The production command writes `exports/cinematics/blackthorn/blackthorn.mp4`, the editable `.nfpack`, an embedded-asset `game.json`, audio and review frames, and a verified media report. The master is 1920 × 1080, 24 fps, H.264/AAC, 70 seconds, with a 2.39:1 composition inside the 16:9 frame. Render speed changes processing time; output timestamps follow frame numbers.

To render an edited film, export its embedded-asset `game.json` and use:

```sh
npm run cinematic:render -- --bundle path/to/game.json --template blackthorn --output exports/my-blackthorn-film
```

Add `--quality Epic` to enable screen-space reflections; the default master uses High. `--preview --times 12,19,33.5,45,60` captures selected review frames without encoding the full film.

The production sound mix handles top-level timeline sound cues. Arbitrary gameplay sounds, nested sound cues and spatial audio are not recorded by this command. Blackthorn uses one synchronized stereo master. Cloth catches up a bounded number of steps after a long interactive stall, and GPU lighting can vary with hardware. The capture workflow fixes simulation and frame timing; it does not promise identical pixels on every GPU. Film Mode's browser recording buttons remain silent preview recordings.

Validation: `npm test` covers the timeline, storm, fracture, replay, simulation clocks and architectural scale. `npm run build` checks the editor and exported player. With the dev server on port 17421, `node scripts/e2e/blackthorn.mjs` creates the project through its actual Asset Store card, verifies every embedded asset's hash, and exercises the imported storm/destruction Blueprint.

## Original assets and upload text

`scripts/generate-blackthorn-assets.mjs` builds the modular castle, dead trees, boulders, masonry maps and heraldic textile. `scripts/generate-blackthorn-score.mjs` synthesizes the music and weather sound design. All are included under this repository's MIT license, with no downloaded models, recordings or commercial music samples.

Suggested title: **Blackthorn Keep | Dark Fantasy Cinematic — Feather Engine**

Suggested description:

> A storm crosses the moor at Blackthorn Keep. Built and rendered in Feather Engine: a modular Gothic castle, wind-driven grass and cloth, animated storm clouds, rain, volumetric atmosphere, warm firelight, lightning and live physics destruction.
>
> The complete editable 70-second project is included in Feather's Asset Store as Blackthorn Keep, with all models, materials, camera shots, weather cues and an original score. Rendered at 1080p / 24 fps.
