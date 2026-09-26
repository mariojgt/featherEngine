# Verdant — A Woodland Study: audio

Original audio generated on 2026-09-25 using the connected Dev MCP tools
`mcp__devmcp__elevenlabs_music_compose` and
`mcp__devmcp__elevenlabs_sound_effect`.

| Asset | Decoded duration | Size | Format |
| --- | ---: | ---: | --- |
| `verdant-score.mp3` | 48.013061 s | 1,152,358 bytes | Stereo MP3, 44.1 kHz, 192 kbps |
| `woodland-ambience.mp3` | 24.000000 s | 577,454 bytes | Stereo MP3, 44.1 kHz, 192 kbps |
| `verdant-mix.wav` | 48.000000 s | 12,700,902 bytes | Stereo PCM WAV, 44.1 kHz, 24 bit |

Place **only `verdant-mix.wav`** on the cinematic timeline at 0 seconds,
with unity gain and looping disabled. It contains the score and two repetitions
of the forest ambience. Embed both MP3 stems separately for editing and reuse;
playing them alongside the mix would duplicate the audio.

The offline mix uses sample-counted 24-second ambience repeats, a gentle
0.6-second opening fade and 1.5-second closing fade. The ambience receives
+6 dB because its generated level is very quiet; it remains approximately
20 dB below the score overall. A constant -1.49 dB master gain preserves
dynamics. Final measured loudness is **-17.00 LUFS**, true peak **-2.57 dBTP**,
and loudness range **7.80 LU**. No limiter was needed.

These are generated audio assets and an FFmpeg offline audio mix. They are
not Feather Engine renders, a captured film, or recorded forest field audio.
The composition prompt requests felt piano, warm strings, organic plucks and
soft woodwinds with a woodland dawn arc; the ambience prompt requests broadleaf
breeze, leaf rustles and occasional distant birds. Full successful prompts,
tool responses, processing settings, SHA-256 hashes and technical measurements
are recorded in `provenance.json`.

Validation: all three files pass full FFmpeg decoding with errors treated as
fatal. ffprobe confirms stereo at 44.1 kHz; the WAV contains exactly 2,116,800
sample frames. Both MP3s are byte-identical copies of their generation outputs.
No application build was run or required.

Quality caveats: no human listening audition or in-engine playback review was
performed. Instrumentation, absence of speech/vocals and perceptual loop
transparency still need listening review. The score has an almost silent first
second and its decay begins around 42 seconds, earlier than the requested
44-second resolution. Its extra 13 ms of MP3 frame padding is trimmed in the
mix. The ambience was generated with looping enabled and decodes to exactly
24 seconds; reuse it with a codec-aware gapless decoder. Its measured raw
wrap discontinuity is approximately -53 dBFS at worst.

Licensing/redistribution information returned by the tools: **not supplied**.
The [provider's music terms](https://elevenlabs.io/eleven-music-model-specific-terms)
were reviewed, but the generating account's plan and redistribution entitlements
have not been verified. No CC0, public-domain, unrestricted-use or repository-license
coverage claim is made for this audio. The separate Verdant visual template
contains no generated audio and lets recipients supply their own soundtrack.
