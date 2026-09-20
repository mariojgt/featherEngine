import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Original synthesized underscore: no samples, downloads or third-party music.
// Reproducible stereo PCM master, synchronized to the Last Light sequence.
const rate = 48000, duration = 70, frames = rate * duration;
const pcm = new Float32Array(frames * 2);
const chords = [[73.416, 110, 146.832, 174.614], [65.406, 98, 130.813, 164.814], [58.27, 87.307, 116.541, 146.832], [65.406, 98, 130.813, 164.814]];
let seed = 71, air = 0;
const tau = Math.PI * 2;
const smooth = x => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
for (let i = 0; i < frames; i++) {
  const t = i / rate;
  const section = Math.floor(t / 12);
  const blend = smooth((t % 12) / 3);
  const current = chords[section % chords.length], previous = chords[(section + 3) % chords.length];
  const fade = smooth(t / 4) * smooth((duration - t) / 4);
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  air = air * 0.992 + (seed / 4294967296 * 2 - 1) * 0.008;
  const charge = smooth((t - 39) / 9) * (1 - smooth((t - 48) / 1.2));
  const impact = t >= 48 ? Math.exp(-(t - 48) * 1.7) * Math.sin(tau * (42 * (t - 48) + 2.5 * (1 - Math.exp(-(t - 48) * 9)))) : 0;
  for (let channel = 0; channel < 2; channel++) {
    let value = 0;
    for (let n = 0; n < 4; n++) {
      const detune = 1 + (channel ? 0.0008 : -0.0008);
      const wave = f => Math.sin(tau * f * detune * t) + 0.18 * Math.sin(tau * f * 2 * t + channel * 0.5);
      value += (wave(previous[n]) * (1 - blend) + wave(current[n]) * blend) * 0.033;
    }
    const beat = Math.floor(t / 1.5), noteTime = t % 1.5;
    const bell = [293.665, 440, 523.251, 587.33, 349.228, 440, 261.626, 392][beat % 8];
    const bellEnvelope = Math.exp(-noteTime * 2.6) * smooth(noteTime / 0.015);
    value += (Math.sin(tau * bell * noteTime) + 0.2 * Math.sin(tau * bell * 2.01 * noteTime)) * bellEnvelope * 0.048 * (t > 9 ? 1 : 0.2);
    value += air * (0.32 + charge * 1.2) + impact * 0.22;
    value += Math.sin(tau * (220 * t + 0.08 * t * t)) * charge * 0.04;
    pcm[i * 2 + channel] = value * fade;
  }
}
let peak = 0;
for (const sample of pcm) peak = Math.max(peak, Math.abs(sample));
const out = Buffer.alloc(44 + pcm.length * 2);
out.write('RIFF', 0); out.writeUInt32LE(out.length - 8, 4); out.write('WAVEfmt ', 8);
out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(2, 22);
out.writeUInt32LE(rate, 24); out.writeUInt32LE(rate * 4, 28); out.writeUInt16LE(4, 32); out.writeUInt16LE(16, 34);
out.write('data', 36); out.writeUInt32LE(pcm.length * 2, 40);
for (let i = 0; i < pcm.length; i++) out.writeInt16LE(Math.round(pcm[i] / peak * 0.7 * 32767), 44 + i * 2);
const path = resolve('public/templates/last-light/last-light-score.wav');
mkdirSync(resolve(path, '..'), { recursive: true }); writeFileSync(path, out);
console.log(`Wrote ${path}: ${duration}s, 48 kHz stereo, peak -3.1 dBFS`);
