const HIDDEN_OPEN_MARKERS = [
  '<think>',
  '<thinking>',
  '<analysis>',
  '<reasoning>',
  '<tool_call>',
  '<function_call>',
  '<start_function_call>',
  '<|tool_call|>',
  '<|tool_call_start|>',
  '<|channel>',
  '<|channel|>analysis<|message|>',
  '<|channel>analysis<|message|>',
] as const;

const HIDDEN_CLOSE_MARKERS = [
  '</think>',
  '</thinking>',
  '</analysis>',
  '</reasoning>',
  '</tool_call>',
  '</function_call>',
  '<end_function_call>',
  '<|tool_call_end|>',
  '<channel|>',
  '<|channel|>final<|message|>',
  '<|channel>final<|message|>',
] as const;

const HIDDEN_MARKER_PAIRS = new Map<string, string>([
  ['<think>', '</think>'],
  ['<thinking>', '</thinking>'],
  ['<analysis>', '</analysis>'],
  ['<reasoning>', '</reasoning>'],
  ['<tool_call>', '</tool_call>'],
  ['<function_call>', '</function_call>'],
  ['<start_function_call>', '<end_function_call>'],
  ['<|tool_call|>', '<|tool_call_end|>'],
  ['<|tool_call_start|>', '<|tool_call_end|>'],
  ['<|channel>', '<channel|>'],
  ['<|channel|>analysis<|message|>', '<|channel|>final<|message|>'],
  ['<|channel>analysis<|message|>', '<|channel>final<|message|>'],
]);

const ALL_MARKERS = [...HIDDEN_OPEN_MARKERS, ...HIDDEN_CLOSE_MARKERS];
const MAX_MARKER_LENGTH = Math.max(...ALL_MARKERS.map((marker) => marker.length), 72);

const stripStandaloneControlTokens = (text: string): string =>
  text
    // Qwen/LFM/header tokens. Tool-call blocks are removed by the state machine before this pass.
    .replace(/<\|[^<>\r\n]{1,64}\|>/g, '')
    .replace(/<start_of_turn>(?:developer|system|user|model|assistant|tool)?\s*/gi, '')
    .replace(/<end_of_turn>/gi, '')
    .replace(/<\/?(?:bos|eos|pad)>/gi, '')
    .replace(/<\/?s>/g, '');

const findFirstMarker = (value: string, markers: readonly string[]) => {
  const lower = value.toLowerCase();
  let match: { index: number; marker: string } | null = null;
  for (const marker of markers) {
    const index = lower.indexOf(marker);
    if (index >= 0 && (!match || index < match.index)) match = { index, marker };
  }
  return match;
};

const possibleMarkerSuffixLength = (value: string): number => {
  const lower = value.toLowerCase();
  const start = Math.max(0, lower.length - MAX_MARKER_LENGTH);
  for (let index = start; index < lower.length; index += 1) {
    if (lower[index] !== '<') continue;
    const suffix = lower.slice(index);
    if (
      ALL_MARKERS.some((marker) => marker.startsWith(suffix))
      || (/^<\|[^<>]*$/.test(suffix) && !suffix.includes('|>'))
      || /^<\/?(?:start_of_turn|end_of_turn|bos|eos|pad|s)?$/i.test(suffix)
    ) {
      return lower.length - index;
    }
  }
  return 0;
};

/** Removes private reasoning and model-family control markers without flashing split tags. */
export class LocalModelTextSanitizer {
  private buffer = '';
  private hiddenClosers: string[] = [];
  private atVisibleStart = true;

  push(chunk: string): string {
    this.buffer += chunk;
    return this.drain(false);
  }

  finish(): string {
    return this.drain(true);
  }

  private drain(final: boolean): string {
    let output = '';
    while (this.buffer) {
      const match = findFirstMarker(this.buffer, ALL_MARKERS);
      if (match) {
        if (this.hiddenClosers.length === 0) output += this.visible(this.buffer.slice(0, match.index));
        const isOpen = HIDDEN_OPEN_MARKERS.includes(match.marker as typeof HIDDEN_OPEN_MARKERS[number]);
        const isClose = HIDDEN_CLOSE_MARKERS.includes(match.marker as typeof HIDDEN_CLOSE_MARKERS[number]);
        if (isOpen) {
          this.hiddenClosers.push(HIDDEN_MARKER_PAIRS.get(match.marker) ?? '');
        } else if (isClose && this.hiddenClosers.at(-1) === match.marker) {
          this.hiddenClosers.pop();
        }
        this.buffer = this.buffer.slice(match.index + match.marker.length);
        continue;
      }

      if (final) {
        if (this.hiddenClosers.length === 0) output += this.visible(this.buffer);
        this.buffer = '';
        break;
      }

      const suffixLength = possibleMarkerSuffixLength(this.buffer);
      const safeLength = this.buffer.length - suffixLength;
      if (safeLength <= 0) break;
      const safe = this.buffer.slice(0, safeLength);
      this.buffer = this.buffer.slice(safeLength);
      if (this.hiddenClosers.length === 0) output += this.visible(safe);
    }
    return output;
  }

  private visible(value: string): string {
    let clean = stripStandaloneControlTokens(value);
    if (this.atVisibleStart) clean = clean.replace(/^\s+/, '');
    if (clean) this.atVisibleStart = false;
    return clean;
  }
}

export function sanitizeLocalModelText(text: string): string {
  const sanitizer = new LocalModelTextSanitizer();
  return `${sanitizer.push(text)}${sanitizer.finish()}`.trim();
}
