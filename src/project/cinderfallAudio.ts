import type { AssetItem } from '../types';

/** Original deterministic synthesis. Generated once by the builder and embedded in the package. */
export function cinderfallAudio(): Record<string, AssetItem> {
  const definitions: Record<string, number> = { shot: 0.16, reload: 1.25, mine: 0.3, hurt: 0.2, step: 0.09, success: 1.5, alert: 0.8, ambient: 6 };
  return Object.fromEntries(Object.entries(definitions).map(([name, duration]) => {
    const rate = 22050, count = Math.floor(rate * duration);
    const bytes = new Uint8Array(44 + count * 2), view = new DataView(bytes.buffer);
    const word = (offset: number, text: string) => [...text].forEach((ch, index) => view.setUint8(offset + index, ch.charCodeAt(0)));
    word(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); word(8, 'WAVE'); word(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    word(36, 'data'); view.setUint32(40, count * 2, true);
    let seed = 8041;
    for (let i = 0; i < count; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const noise = seed / 2147483648 - 1, t = i / rate;
      const sine = (frequency: number) => Math.sin(t * Math.PI * 2 * frequency);
      let sample = 0;
      if (name === 'shot') sample = (noise * 0.46 + Math.sin(2 * Math.PI * (180 * t - 330 * t * t)) * 0.48) * Math.exp(-t * 37);
      if (name === 'reload') sample = noise * (Math.exp(-Math.abs(t - 0.08) * 110) * 0.5 + Math.exp(-Math.abs(t - 0.85) * 95) * 0.65 + Math.exp(-Math.abs(t - 1.12) * 140) * 0.5);
      if (name === 'mine') sample = (sine(740) * 0.27 + sine(1109) * 0.17 + noise * 0.2) * Math.exp(-t * 16);
      if (name === 'hurt') sample = (sine(72) * 0.4 + noise * 0.25) * Math.exp(-t * 15);
      if (name === 'step') sample = noise * 0.32 * Math.exp(-t * 44);
      if (name === 'alert') sample = (sine(146) * 0.25 + sine(293) * 0.12) * Math.sin(Math.PI * t / duration) ** 2;
      if (name === 'success') { const note = [262, 330, 392, 524][Math.min(3, Math.floor(t * 3))]; sample = (sine(note) * 0.2 + sine(note * 2) * 0.08) * Math.sin(Math.PI * t / duration) ** 2; }
      if (name === 'ambient') sample = sine(44) * 0.07 + sine(66) * 0.04 + sine(88) * 0.025 + noise * 0.012;
      view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sample)) * 32767, true);
    }
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return [name, { id: `cinderfall-audio-${name}`, name: `Cinderfall · ${name}.wav`, type: 'audio', size: bytes.length, data: `data:audio/wav;base64,${btoa(binary)}`, createdAt: 0 } satisfies AssetItem];
  }));
}
