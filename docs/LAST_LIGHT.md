# Last Light — a 70-second Feather Engine film

Last Light is an editable cinematic project in a drowned mountain observatory. Its ten shots move from the valley and stone causeway to an awakening instrument, a live fracture, and the final departure. The sequence lasts **70 seconds at 24 fps**. The production master is **1920 × 1080, H.264/AAC**, with a 2.39:1 composition inside the 16:9 frame.

## Open and edit

Find **Last Light** in the Asset Store's project packages and install it into a blank project. The bundled archive is `public/store/packages/projects/template-last-light.nfpack`; it includes the original score. Press **Play** to see the complete film and **R** to replay. Film Mode contains ten named camera shots and eight markers. The **Last Light · Director** Blueprint owns the live fracture and slow-motion cues. Scrubbing previews authored camera/material tracks; event-driven destruction requires playback from the beginning.

The AI authoring tool `create_last_light_template` builds the same project. It adds objects to the active scene; use a blank project for the standalone set.

| Time | Shot |
| --- | --- |
| 0–9 s | The drowned valley — aerial approach |
| 9–17 s | A path through still water — low dolly |
| 17–24 s | Traces of the past — stone study |
| 24–32 s | The observatory — crane reveal |
| 32–39 s | One ember remains — close focus |
| 39–45 s | Awakening — monumental push |
| 45–48 s | Held breath — the last seal |
| 48–53 s | Release — live fracture at quarter-speed physics |
| 53–61 s | The light survives — orbit |
| 61–70 s | Last light — departure and closing credit |

## Reusable engine controls

- **Terrain → Mountain Ridges / Domain Warp:** blend the existing rolling noise into ridged mountains and deform its sampling domain. Rendering, sculpting, foliage and collision sample the same heightfield. Both controls default to zero for existing projects; they are also available through `update_terrain`.
- **Scene → Sun & Fog → Ambient fill:** control diffuse fill separately from environment reflections. Low values preserve the contrast of warm practical lights against cool shadows. Omitted values retain the old environment-dependent fill.
- **Sun shadow extent:** concentrate the sun shadow map over a smaller set for better detail. This controls coverage, not shadow-map resolution. The sun is moved back far enough to cover the configured set. Existing projects retain their previous shadow setup.
- **Destructible → Fragment spin:** seed-repeatable initial angular velocity, 0–20 rad/s, applied once when each fragment's rigid body is created. It works with both grid and Voronoi fracture, inherited linear motion, and the existing bounded debris lifetime. The default is zero.

These controls serialize with projects and are exposed to the AI assistant; ambient/shadow controls can also be set by a Set Environment Blueprint node.

## Generate the package and render the film

Prerequisites: project dependencies, Chrome/Chromium, and native `ffmpeg` plus `ffprobe` on PATH. `CHROME_PATH` can select a browser. No paid service or external music is required.

```sh
npm run cinematic:assets
FEATHER_CAPTURE=1 npm run dev -- --host 127.0.0.1 --port 17421
# In a second terminal:
npm run cinematic:preview
npm run cinematic:render
```

The renderer runs the real template builder, creates its `.nfpack`, exports a self-contained `game.json`, and steps the runtime at 120 Hz while sampling the image at 24 fps. Capture mode fixes the internal pixel ratio at 1, disables adaptive resolution and automatic wall-clock runtime ticks, and requests a composed frame only after stepping the simulation. Each output frame has a timestamp derived from its frame number; GPU hitches increase render time rather than changing the movie duration. Camera overlays are captured with the scene. Timeline sound assets are mixed at their authored start times into AAC. The script checks the finished movie's dimensions, frame count, duration, and audio stream with ffprobe.

Outputs are in `exports/cinematics/last-light/`:

- `last-light.mp4` — the movie for upload.
- `last-light.nfpack` — the editable package, including the score.
- `game.json` — portable scene/runtime bundle for Feather's production game exporter.
- `frame-*.png` — review frames.
- `render-report.json` — frame samples and ffprobe evidence.
- `audio-0.wav` — the original score master.

`--preview` captures one frame per shot. Other options include `--width`, `--height`, `--fps` (24/25/30/60), `--url`, `--output`, and `--template`. Use `FEATHER_CHROME_ANGLE=swiftshader` for a software-rendering fallback; it is much slower. The default uses Metal on macOS. Rendering should run without source edits or other work in the capture page.

To render an edited project, export a self-contained game.json and run `npm run cinematic:render -- --bundle path/to/game.json --output exports/my-film`. This loads the authored project instead of rebuilding the starter, and also writes a fresh portable package. The generic command supports built-in templates or embedded-asset game bundles with an autoplay cinematic in the launch scene. Its sound mix handles top-level sound cues with fixed start times; it does not record arbitrary gameplay-generated audio, audio spatialization or nested sound tracks. Last Light deliberately uses one synchronized original score and has no such dependencies. GPU cloth/lighting convergence can vary with hardware, so the production render is frame-timed, not a claim of bit-identical pixels across machines.

**Browser Film Mode exports remain preview recordings:** they capture camera/material previews with overlays, use wall-clock MediaRecorder timing, and omit event-driven physics/audio. Use the production command for this complete film.

## Audio and distribution

`scripts/generate-last-light-score.mjs` synthesizes the stereo score from oscillators and seeded noise: evolving pads, sparse bells, wind, a rising tone, and the impact at 48 seconds. There are no downloaded recordings or sampled commercial tracks. Procedural stone albedo and normal maps are generated by `scripts/generate-last-light-surfaces.mjs`. The generators, maps and score are distributed with this repository under its license.

Suggested YouTube title: **Last Light | A Feather Engine Cinematic Showcase**

Suggested description:

> A 70-second cinematic built in Feather Engine: mountain terrain, atmospheric lighting, water, cloth, and live physics destruction. The complete scene, ten-shot camera timeline, original score, and director Blueprint are editable in the included Last Light project package.
>
> Rendered in Feather's WebGL runtime at 1920 × 1080 and 24 fps, with an original synthesized score.
