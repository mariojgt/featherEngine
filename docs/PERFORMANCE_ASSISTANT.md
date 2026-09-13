# Performance Assistant

Open **View → Performance Assistant**, or use its button in the F8 profiler.
Choose a 30, 60 or 120 fps target and select **Play and measure**. Play starts,
warms up for two seconds, then records ten seconds of fresh runtime frames.
Play stops and the report opens when the check finishes. Move through a representative
part of the scene while it records; repeat the same route and window size for comparisons.

The report includes average frame rate, the 95th-percentile frame duration, pacing
misses (with 10% tolerance for vsync jitter), stalls over 100 ms, simulation CPU time,
render submission CPU time, and peak draw calls, triangles and textures. Render
submission is not GPU timing, and texture counts are not GPU memory estimates.
Automatic quality steps are held during capture; dynamic resolution can still adapt.
A paused game, hidden tab, scene switch or changed render settings cancels the check.

Suggestions are candidates to test, not proven bottlenecks or guaranteed speed gains.
For example, a missed frame budget can suggest a lower quality preset or disabling
bloom. Each suggestion explains its visual tradeoff. **Preview change**, measure again,
then **Keep these settings** or **Restore previous settings**. Closing the panel restores
a pending preview. Restoration checks for intervening edits and does not overwrite them.
Restored/kept settings use the regular authored render-settings action and can be saved.
Reports stay in the current project session; they are not benchmark promises for other hardware.

The AI assistant exposes `performance_assistant` with `open`, `measure`, `status`,
`cancel`, `preview` (suggestion id), `keep` and `restore`. The snapshot includes the latest
report and pending preview. Only a single bounded recorder is active; ordinary runtime
frames have no capture allocation or React state update.
