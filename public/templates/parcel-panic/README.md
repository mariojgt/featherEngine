# Parcel Panic audio

Original music and sound effects composed and synthesized for the Parcel Panic
starter. All files are mono, 22,050 Hz, signed 16-bit little-endian PCM WAV.

| File | Duration | Bytes | Sound |
| --- | ---: | ---: | --- |
| `parcel-panic-theme.wav` | 16.000 s | 705,644 | Cozy, upbeat plucked melody, bass, wood taps, soft kick and shaker |
| `pickup.wav` | 0.340 s | 15,038 | Two rising plucks |
| `throw.wav` | 0.300 s | 13,274 | Soft descending swoosh |
| `delivery.wav` | 0.950 s* | 41,940 | Rising major-chord chime |
| `finish.wav` | 2.100 s | 92,654 | Happy rising fanfare with a final major chord |

Total: **868,550 bytes** (about 848 KiB). *Delivery is 20,948 frames,
or 0.950022676 seconds, rounded to the nearest sample.

Public URL prefix: `/templates/parcel-panic/`. The theme is eight bars of 4/4
at 120 BPM in C major. Loop the entire 352,800-frame file without adding a gap.
Note decays and a gentle echo wrap into the beginning, preserving the musical
phrase across repetitions. There is no intro, outro, or full-track fade.
The other four assets are one-shots with silent endpoints.

## Generate and verify

From the repository root, using Node.js 20 or newer:

```sh
node scripts/generate-parcel-panic-audio.mjs
node scripts/generate-parcel-panic-audio.mjs --check
```

The generator uses only Node standard-library modules and needs no dependency
installation, network access, API key, audio provider, or external tool. Output
paths are resolved relative to the script, so invocation from another directory
also works. Generation overwrites only these five WAV files. `--check` is
read-only: it regenerates the expected bytes in memory and compares each file.

Both commands validate the RIFF header and sizes, PCM format, channels, sample
rate, bit depth, duration, signal levels, DC offset, and total size. They print
each file's SHA-256 digest. Synthesis is deterministic with fixed noise seeds;
no timestamps or random system input are embedded. Byte comparisons should use
the same Node runtime/platform because floating-point transcendental functions
can vary across runtimes.

Measured levels: theme peak −6.94 dBFS / RMS −24.07 dBFS; effects peak
−9.46 to −6.98 dBFS / RMS −20.00 dBFS. There are no clipped samples. These
are sample peak and RMS measurements, not a perceptual LUFS measurement.
The theme boundary sample step is 0.010895 full scale, below its maximum internal
step of 0.086121; the validator also checks boundary slope continuity. These
checks verify numerical continuity; in-engine playback and mixing are separate
integration checks.

## Provenance and license

The melody, arrangement, synthesis code, and rendered sounds were newly created
for this repository using mathematical oscillators, envelopes, and seeded noise.
No recordings, sample packs, third-party compositions, copyrighted source audio,
or generative audio services were used. The complete editable source is
[`scripts/generate-parcel-panic-audio.mjs`](../../../scripts/generate-parcel-panic-audio.mjs).

The generator and all five WAV assets are distributed under the repository's
[MIT License](../../../LICENSE), reproduced below. They may be reused, modified,
and redistributed, including in commercial games, under those terms. Retain the
copyright and permission notice when redistributing copies or substantial
portions; no separate audio-provider attribution or license is required.

MIT License

Copyright (c) 2026 Mario Tarosso

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
