// Original Parcel Panic music and effects. MIT; see ../LICENSE.
// Offline, deterministic synthesis using only Node's standard library.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RATE = 22050;
const TAU = 2 * Math.PI;
const output = new URL('../public/templates/parcel-panic/', import.meta.url);
const checkOnly = process.argv.includes('--check');
assert(process.argv.slice(2).every(arg => arg === '--check'), 'Usage: node scripts/generate-parcel-panic-audio.mjs [--check]');
const smooth = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
const hz = midi => 440 * 2 ** ((midi - 69) / 12);

function track(seconds, loop = false) {
  return { samples: new Float64Array(Math.round(seconds * RATE)), loop };
}

// Every voice has a smooth attack/release; wrapping sums the end of each
// voice into the start of the loop instead of truncating its decay.
function voice(target, start, duration, render) {
  const offset = Math.round(start * RATE);
  const frames = Math.round(duration * RATE);
  for (let i = 0; i < frames; i++) {
    let index = offset + i;
    const sample = render(i / RATE) * smooth(i / (RATE * .004))
      * smooth((frames - 1 - i) / (RATE * .03));
    if (target.loop) index %= target.samples.length;
    if (index >= 0 && index < target.samples.length) target.samples[index] += sample;
  }
}

function pluck(target, time, note, gain = .15, duration = .62, bright = 1) {
  const f = hz(note);
  voice(target, time, duration, t => gain * Math.exp(-t * 7)
    * (Math.sin(TAU * f * t) + .28 * bright * Math.sin(TAU * f * 2 * t)
      + .10 * bright * Math.sin(TAU * f * 3 * t)));
}

function bass(target, time, note) {
  const f = hz(note);
  voice(target, time, .43, t => .14 * Math.exp(-t * 6)
    * (Math.sin(TAU * f * t) + .18 * Math.sin(TAU * f * 2 * t)));
}

function chime(target, time, note, gain = .2, duration = .8) {
  const f = hz(note);
  voice(target, time, duration, t => gain * Math.exp(-t * 5)
    * (Math.sin(TAU * f * t) + .24 * Math.exp(-t * 5) * Math.sin(TAU * 3 * f * t)));
}

function noiseSource(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2147483648 - 1;
  };
}

function percussion(target, time, kind, seed) {
  const noise = noiseSource(seed);
  let low = 0;
  const duration = kind === 'kick' ? .22 : .09;
  voice(target, time, duration, t => {
    low = low * .7 + noise() * .3;
    if (kind === 'kick') return .13 * Math.exp(-t * 23)
      * Math.sin(TAU * (62 * t + 2 * (1 - Math.exp(-t * 35))));
    if (kind === 'wood') return .045 * Math.exp(-t * 48)
      * (Math.sin(TAU * 830 * t) + low * .5);
    return .028 * low * Math.exp(-t * 38);
  });
}

function echo(target, seconds, gain) {
  const dry = target.samples.slice();
  const delay = Math.round(seconds * RATE);
  for (let i = 0; i < dry.length; i++) {
    const index = i + delay;
    if (target.loop) target.samples[index % dry.length] += dry[i] * gain;
    else if (index < dry.length) target.samples[index] += dry[i] * gain;
  }
}

function theme() {
  const result = track(16, true); // Eight 4/4 bars at 120 BPM; exactly 352800 frames.
  const roots = [48, 53, 57, 55, 48, 53, 50, 55];
  const chords = [[60,64,67], [60,65,69], [60,64,69], [59,62,67],
    [60,64,67], [60,65,69], [62,65,69], [59,62,67]];
  // A newly composed, lightly syncopated C-major call and answer.
  const melodies = [[76,79,81,79,76,74], [77,81,84,81,79,77],
    [76,79,81,84,83,81], [79,74,76,79,77,74],
    [76,79,84,83,81,79], [77,81,84,86,84,81],
    [81,77,74,77,79,81], [79,77,74,71,74,79]];
  const rhythm = [0, .75, 1.25, 2, 2.75, 3.5];
  for (let bar = 0; bar < 8; bar++) {
    const time = bar * 2;
    for (let n = 0; n < 6; n++) pluck(result, time + rhythm[n] * .5,
      melodies[bar][n], n === 0 ? .14 : .115);
    for (let beat = 0; beat < 4; beat++) {
      bass(result, time + beat * .5, roots[bar] + (beat % 2 ? 7 : 0));
      percussion(result, time + beat * .5, beat % 2 ? 'wood' : 'kick', 800 + bar * 4 + beat);
      percussion(result, time + beat * .5 + .25, 'shaker', 1900 + bar * 4 + beat);
      pluck(result, time + beat * .5 + .25, chords[bar][beat % 3], .065, .38, .5);
    }
  }
  echo(result, .1875, .12);
  return result;
}

function pickup() {
  const result = track(.34);
  pluck(result, 0, 79, .24, .20);
  pluck(result, .075, 86, .20, .24);
  return result;
}

function throwSound() {
  const result = track(.30);
  const noise = noiseSource(0x50415243);
  let low = 0;
  voice(result, 0, .27, t => {
    low = low * .82 + noise() * .18;
    const envelope = Math.sin(Math.PI * t / .27) ** 2;
    return envelope * (.32 * low + .13 * Math.sin(TAU * (660 * t - 850 * t * t)));
  });
  return result;
}

function delivery() {
  const result = track(.95);
  [72, 76, 79, 84].forEach((note, i) => chime(result, i * .085, note, .19, .65));
  return result;
}

function finish() {
  const result = track(2.1);
  [72, 76, 79, 84, 83, 86, 84].forEach((note, i) => chime(result, i * .15, note, .18, .7));
  [60, 64, 67, 72].forEach(note => chime(result, 1.05, note, .10, .95));
  percussion(result, 0, 'kick', 15);
  percussion(result, .45, 'wood', 16);
  return result;
}

function encode(target, rmsTarget, peakLimit) {
  const samples = target.samples.slice();
  // Remove finite noise-window DC, retaining silent one-shot endpoints.
  const weights = samples.map((_, i) => target.loop ? 1
    : smooth(i / (RATE * .01)) * smooth((samples.length - 1 - i) / (RATE * .02)));
  const offset = samples.reduce((sum, value) => sum + value, 0)
    / weights.reduce((sum, value) => sum + value, 0);
  for (let i = 0; i < samples.length; i++) samples[i] -= offset * weights[i];
  let energy = 0, peak = 0;
  for (const value of samples) { energy += value * value; peak = Math.max(peak, Math.abs(value)); }
  const gain = Math.min(rmsTarget / Math.sqrt(energy / samples.length), peakLimit / peak);
  const wav = Buffer.alloc(44 + samples.length * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(RATE, 24); wav.writeUInt32LE(RATE * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    assert(Number.isFinite(samples[i]) && Math.abs(samples[i] * gain) < 1, 'Invalid/clipped synthesis');
    wav.writeInt16LE(Math.round(samples[i] * gain * 32767), 44 + i * 2);
  }
  return wav;
}

function validate(wav, name, duration, loop) {
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.readUInt32LE(4), wav.length - 8);
  assert.equal(wav.toString('ascii', 8, 16), 'WAVEfmt ');
  assert.equal(wav.readUInt32LE(16), 16);
  assert.equal(wav.readUInt16LE(20), 1); // Uncompressed PCM.
  assert.equal(wav.readUInt16LE(22), 1); // Mono.
  assert.equal(wav.readUInt32LE(24), RATE);
  assert.equal(wav.readUInt32LE(28), RATE * 2);
  assert.equal(wav.readUInt16LE(32), 2);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.toString('ascii', 36, 40), 'data');
  assert.equal(wav.readUInt32LE(40), wav.length - 44);
  const count = (wav.length - 44) / 2;
  assert.equal(count, Math.round(duration * RATE));
  const samples = Array.from({ length: count }, (_, i) => wav.readInt16LE(44 + i * 2) / 32768);
  let peak = 0, energy = 0, sum = 0, maxStep = 0;
  for (let i = 0; i < count; i++) {
    peak = Math.max(peak, Math.abs(samples[i])); energy += samples[i] ** 2; sum += samples[i];
    if (i) maxStep = Math.max(maxStep, Math.abs(samples[i] - samples[i - 1]));
  }
  const rms = Math.sqrt(energy / count);
  assert(peak < .61 && peak > .05, `${name}: peak outside intended headroom`);
  assert(rms > .025 && rms < .12, `${name}: unexpected RMS level`);
  assert(Math.abs(sum / count) < .001, `${name}: DC offset`);
  const seam = Math.abs(samples[0] - samples.at(-1));
  if (loop) {
    assert(duration >= 12 && duration <= 20);
    assert(seam < .015 && seam <= maxStep, 'Loop seam has an excessive sample step');
    const slopeChange = Math.abs((samples[1] - samples[0]) - (samples.at(-1) - samples.at(-2)));
    assert(slopeChange < .015, 'Loop seam has an excessive slope change');
  } else {
    assert.equal(samples[0], 0, `${name}: nonzero attack endpoint`);
    assert.equal(samples.at(-1), 0, `${name}: nonzero release endpoint`);
  }
  const db = value => (20 * Math.log10(value)).toFixed(2);
  return { file: name, seconds: count / RATE, bytes: wav.length, peakDBFS: db(peak),
    rmsDBFS: db(rms), ...(loop ? { seamStep: seam, maxInteriorStep: maxStep } : {}),
    sha256: createHash('sha256').update(wav).digest('hex') };
}

const assets = [
  ['parcel-panic-theme.wav', theme(), 16], ['pickup.wav', pickup(), .34],
  ['throw.wav', throwSound(), .30], ['delivery.wav', delivery(), .95],
  ['finish.wav', finish(), 2.1],
];
if (!checkOnly) mkdirSync(output, { recursive: true });
let total = 0;
for (const [name, target, duration] of assets) {
  const expected = encode(target, target.loop ? .065 : .10, target.loop ? .45 : .60);
  const path = new URL(name, output);
  if (!checkOnly) writeFileSync(path, expected);
  const actual = readFileSync(path);
  assert(actual.equals(expected), `${name}: file differs from deterministic synthesis`);
  console.log(JSON.stringify(validate(actual, name, duration, target.loop)));
  total += actual.length;
}
assert(total < 3_000_000, 'Audio exceeds the 3 MB budget');
console.log(`${checkOnly ? 'Checked' : 'Generated and checked'} ${assets.length} WAVs in ${fileURLToPath(output)} (${total} bytes total).`);
