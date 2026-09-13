# Resonance

The built-in cinematic starter is a 32-second real-time film set in a kinetic reactor hall.
Install **Resonance** from the starter templates, then press **Play**. At the end, **Replay film**
starts a fresh simulation; **R** restarts from any point. **Stop** restores the authored scene.

The installation uses editable engine primitives. Four cloth banners share the scene wind.
A heavy ball strikes twelve separate Rapier dominoes. Three gyroscope rings frame a reactor shell
that fractures into 32 simulated pieces at the 24-second score hit. High quality enables the
intended Lux local lighting/reflections, atmosphere, shadows and restrained bloom. Automatic quality
adjustment can reduce these effects on slower devices; the physics demonstration still runs.

| Time | Shot / cue |
| --- | --- |
| 0–4 | Wind: a close view of the copper banner |
| 4–8 | Resonance: establishing dolly and title |
| 8–14 | Momentum: impulse at 8.15s, real domino collisions |
| 14–19 | Radiance: low crane and reactor light ignition |
| 19–24 | Charge: orbit, animated materials and score swell |
| 24–26 | Release: live fracture and quarter-speed physics |
| 26–29 | Afterglow: normal physics resumes; the crane pulls back |
| 29–32 | Final tableau and replay card |

Open **Cinematic** to edit the eight named shots and chapter markers. Scrubbing previews camera,
transform and material tracks; it does not reconstruct earlier physics. **Play from the start**
to see the complete collision and fracture sequence.

Select **05 · Director / open Blueprint to edit cues** and open its **Resonance · Physics & replay
cues** Blueprint. Its event rows launch the ball, fracture the shell, change simulation speed and
show the closing UI. The slow-motion section uses Set Time Scale = 0.25 plus a reciprocal cinematic
timeDilation = 4, then explicitly resets both to 1. This keeps the camera edit and music in real time.
The replay card holds the final frame at 31.7s using Set Time Scale = 0; input and UI remain active.

The rings are decorative transform tracks; the ball, dominoes and debris have no transform tracks.
Debris has a bounded lifetime. One fixed Lux capture updates on a budget, and the four local lights
do not allocate shadow maps. The sun supplies structural shadows.

The six bundled audio files are optional when building through the AI tool; the scene remains
playable if a file is unavailable. The shipped `.nfpack` includes all six. No external models,
cloud services or baked movie are required.

For maintainers: `src/project/filmModeTemplate.ts` builds the scene; `?exportTemplate=cinematic`
regenerates its packaged starter through the running development editor. Run
`node scripts/e2e/resonance.mjs` for High-quality shot captures and a real replay-button check, then
`npm run build:store` to refresh the catalog metadata. The focused template tests exercise Rapier,
package reference remapping, slow-motion timing, replay and clean Stop restoration.
