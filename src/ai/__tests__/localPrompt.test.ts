import { describe, expect, it } from 'vitest';
import { buildLocalEngineGuide } from '../local/localPrompt';

describe('Local Feather agent prompt', () => {
  it('tells the agent to act with defaults and narrowly limits clarification', () => {
    const guide = buildLocalEngineGuide(
      ['core', 'scene'],
      'native',
      ['list_scene', 'create_object'],
      'Qwen',
    );
    expect(guide).toContain("Act, don't interview");
    expect(guide).toContain('call tools before replying');
    expect(guide).toContain('Ask one concise question only if');
    expect(guide).toContain('correct the input, and retry');
    expect(guide).toContain('never output reasoning/control tags');
    expect(guide).toContain('/no_think');
    expect(guide.length).toBeLessThan(1800);
  });

  it('retains FunctionGemma function-calling priming without Qwen controls', () => {
    const guide = buildLocalEngineGuide(['core'], 'functiongemma', ['list_scene'], 'Gemma');
    expect(guide.startsWith('You are a model that can do function calling')).toBe(true);
    expect(guide).not.toContain('/no_think');
  });
});
