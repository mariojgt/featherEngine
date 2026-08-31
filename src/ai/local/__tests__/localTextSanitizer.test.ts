import { describe, expect, it } from 'vitest';
import { LocalModelTextSanitizer, sanitizeLocalModelText } from '../localTextSanitizer';

describe('Local model text sanitizer', () => {
  it('removes private reasoning blocks and standalone family tokens', () => {
    expect(
      sanitizeLocalModelText(
        '<|im_start|><think>private chain of thought</think>\n\nBuilt the room.<|im_end|>',
      ),
    ).toBe('Built the room.');
    expect(sanitizeLocalModelText('<thinking>hidden</thinking>Done')).toBe('Done');
    expect(sanitizeLocalModelText('<analysis>hidden</analysis>Done')).toBe('Done');
  });

  it('handles markers split across arbitrary streaming chunks without flashing them', () => {
    const sanitizer = new LocalModelTextSanitizer();
    expect(sanitizer.push('<thi')).toBe('');
    expect(sanitizer.push('nk>do not show')).toBe('');
    expect(sanitizer.push('</thi')).toBe('');
    expect(sanitizer.push('nk>\n\nCreated')).toBe('Created');
    expect(sanitizer.push(' a cube.<|im_')).toBe(' a cube.');
    expect(sanitizer.push('end|>')).toBe('');
    expect(sanitizer.finish()).toBe('');
  });

  it('suppresses raw tool/control fences but preserves ordinary angle-bracket text', () => {
    expect(sanitizeLocalModelText('<tool_call>{"name":"delete_object"}</tool_call>Ready')).toBe('Ready');
    expect(sanitizeLocalModelText('Use x < y and <button>OK</button>.')).toBe(
      'Use x < y and <button>OK</button>.',
    );
  });

  it('understands channel-style reasoning delimiters', () => {
    expect(
      sanitizeLocalModelText(
        '<|channel|>analysis<|message|>hidden<|channel|>final<|message|>Visible',
      ),
    ).toBe('Visible');
  });
});
