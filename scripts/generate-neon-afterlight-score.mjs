import { mkdirSync, writeFileSync } from 'node:fs';

// Original 70-second synth score: half-time bass, arpeggios, rain, steam and an electrical arc.
const rate = 48000, duration = 70, frames = rate * duration, tau = 2 * Math.PI, pcm = new Float32Array(frames * 2);
const smooth = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
const beat = 60 / 108, roots = [55, 65.406, 48.999, 58.27], intervals = [1, 1.5, 2, 2.3784, 3, 2, 1.5, 1.1892];
let seed = 9077, low = 0, rain = 0;
for (let i = 0; i < frames; i++) {
  const t = i / rate, fade = smooth(t / 2) * smooth((70 - t) / 3), root = roots[Math.floor(t / (beat * 16)) % 4];
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  const noise = seed / 4294967296 * 2 - 1; low = low * .994 + noise * .006; rain = rain * .63 + noise * .37;
  const kickAge = t % (beat * 2), snareAge = (t + beat) % (beat * 2), arpAge = t % (beat / 2);
  const pulse = smooth((t - 7) / 4) * (1 - smooth((t - 60) / 6));
  const kick = Math.sin(tau * (42 * kickAge + 4.5 * (1 - Math.exp(-kickAge * 22)))) * Math.exp(-kickAge * 11) * .16;
  const snare = (rain * .65 + Math.sin(tau * 170 * snareAge) * .22) * Math.exp(-snareAge * 25) * .10;
  for (let ch = 0; ch < 2; ch++) {
    const detune = ch ? 1.0011 : .9989;
    let value = (Math.sin(tau * root * t) + Math.sin(tau * root * .5 * t) * .45) * .036;
    for (const f of [root * 2, root * 2.3784, root * 3]) value += (Math.sin(tau * f * t * detune) + Math.sin(tau * f * 2 * t * detune) * .16) * .014;
    const note = root * 4 * intervals[Math.floor(t / (beat / 2)) % 8];
    value += Math.sin(tau * note * arpAge) * Math.exp(-arpAge * 9) * smooth(arpAge / .01) * .045 * pulse;
    value += (kick + snare) * pulse + rain * .019 + low * .14;
    for (const vent of [23, 29, 38]) { const age = t - vent; if (age > 0 && age < 4) value += rain * Math.exp(-age * .8) * smooth(age / .1) * .08; }
    const arc = t - 42; if (arc > 0 && arc < 3) value += (noise * .15 + Math.sin(tau * (55 * arc + 12 * Math.exp(-arc * 6))) * .12) * Math.exp(-arc * 3);
    const delay = Math.round((ch ? beat * .75 : beat * .5) * rate) * 2;
    pcm[i * 2 + ch] = (value + (i * 2 > delay ? pcm[i * 2 + ch - delay] * .24 : 0)) * fade;
  }
}
let peak = 0; for (const v of pcm) peak = Math.max(peak, Math.abs(v));
const wav = Buffer.alloc(44 + pcm.length * 2); wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(pcm.length * 2, 40);
for (let i = 0; i < pcm.length; i++) wav.writeInt16LE(Math.round(pcm[i] / peak * .78 * 32767), 44 + i * 2);
mkdirSync('public/templates/neon-afterlight', { recursive: true }); writeFileSync('public/templates/neon-afterlight/neon-afterlight-score.wav', wav);
console.log('Original Neon Afterlight stereo score: 70 seconds, 48 kHz.');
