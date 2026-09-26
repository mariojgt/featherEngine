# Verdant — A Woodland Study

A 48-second film rendered in Feather Engine at 1920 × 1080, 24 fps. Six editable
shots move from the forest floor through the grove and canopy. The scene uses
the new terrain surfaces, clustered trees, blade grass, ferns, mossy rocks,
deadwood and wind. Cool ground mist and warm, shadow-aware volumetric sunlight
give the grove depth. All visuals come from the engine.

The final landscape pass adds 36 rocks in nine asymmetric outcrops, fern and
shrub banks, painted clearings, and lighter foreground mist. Camera routes
check the solid branches as well as trunks, terrain and rock bounds. The scene
retains its two broadleaf tree forms. The complete project embeds 13 visual
assets and three audio assets; the visual-only download embeds the same 13
visual assets. See [scene accent credits](../src/terrain/models/verdant-credits.md).

## Watch and remix

On the startup screen, search the template library for **Verdant**, or open
**Store → Projects**, find **Verdant — A Woodland Study**, and create a
project from the template. You can also import `verdant.nfpack` as a project
package. Press **Play** to watch, **R** to restart the scene and film, and **Stop**
to return to editing. Use a new project when calling the template builder: it
replaces the starter objects and changes the active scene's lighting.

Open **Cinematic**, select **Verdant · A Woodland Study**, and choose a named
camera action to edit its position, target, field of view and timing. Each shot
has nine keyframes; positions follow the original terrain height. Recheck the
routes after changing the terrain seed, sculpting or moving trees.

| Time | Shot | Shows |
| --- | --- | --- |
| 0–8 s | Small beginnings | Ferns, blade grass and leaf litter |
| 8–16 s | Time in the bark | Tree trunk and branches |
| 16–25 s | Through the grove | Woodland distribution and understorey |
| 25–34 s | Into the light | Rising through the canopy |
| 34–43 s | A living landscape | Trees and rolling terrain |
| 43–48 s | Verdant | Closing vista, title and fade |

Select **01 · Woodland** in the scene to edit terrain and foliage. Change the
sun, wind, sky or fog in the scene environment. The fixed terrain seed is 1431.
Epic quality is the scene and capture default: the canopy shafts require its
full volumetric shadow sampling. Lower quality settings reduce that effect.
Five short lower-third titles identify the forest floor, natural trees, living
landscapes, volumetric light and editable world. Edit these text actions in the
same cinematic timeline; the opening and closing credits remain separate.

## Sound

The connected Dev MCP ElevenLabs tools generated an original score and woodland
ambience for this project. The main film plays **verdant-mix.wav** once at time
zero. It already combines both stems; playing the stems alongside it doubles
the sound. The non-autoplay **Music stem** and **Ambience stem** sequences let
you audition or replace them independently. The mix is 48 seconds, stereo
44.1 kHz, measured at −17 LUFS and −2.57 dBTP.

Audio prompts, hashes, mix settings and technical checks are in
[`public/templates/verdant/provenance.json`](../public/templates/verdant/provenance.json).
The title and credits are ordinary editable text actions.

## Share

The capture folder contains the MP4, full editable `.nfpack`, and a `game.json`
with all asset bytes embedded. The **verdant-visuals.nfpack** variant contains
the same landscape and camera sequence without generated audio; users can add
their own soundtrack. Use that variant when sharing the reusable visual scene
without granting access to the generated music stems.

Code follows the repository MIT license. The terrain scans and woodland models
are CC0; source credits are in
[`surfaces/README.md`](../src/terrain/surfaces/README.md) and
[`models/README.md`](../src/terrain/models/README.md).

The generated audio has separate, plan-dependent provider terms. This project
does not grant additional music redistribution rights. Check the generating
account's agreement before sharing audio stems, an audio-bearing template or a
commercial game. ElevenLabs distinguishes finished media use from music
libraries/repositories; the latter are restricted on self-service plans. See
[Eleven Music model terms](https://elevenlabs.io/eleven-music-model-specific-terms)
and [Music terms](https://elevenlabs.io/music-terms). The music-free visual
template avoids bundling those generated tracks.

## Render again

Requires Node, project dependencies, Chromium/Chrome and FFmpeg/ffprobe.
Start the development server, then capture from a second terminal:

```sh
npm run dev -- --port 17421
npm run cinematic:verdant:preview -- --url http://127.0.0.1:17421
npm run cinematic:verdant:render -- --url http://127.0.0.1:17421
```

Outputs go to `exports/cinematics/verdant/`. The renderer runs live simulation
with fixed time steps, waits for terrain and vegetation at cuts, and encodes
all 1,152 frames. It records resource metrics and browser errors, then uses
ffprobe to check resolution, frame count, duration and audio. Preview and final
render should use separate `--output` folders if both reports are being kept.
Regenerate the local Store catalog with `npm run build:store` after capture.
Create the music-free sharing archive from the completed full package with:

```sh
npx vite-node scripts/package-verdant-visuals.mts exports/cinematics/verdant
```

To render an edited, self-contained game bundle:

```sh
node scripts/render-cinematic.mjs --bundle /path/to/game.json --template my-woodland --url http://127.0.0.1:17421
```

Source: [`verdantTemplate.ts`](../src/project/verdantTemplate.ts) authors the
scene and score cues; [`verdantLayout.ts`](../src/project/verdantLayout.ts)
defines the landscape and cameras. The in-editor assistant also supports
`create_verdant_template`.
