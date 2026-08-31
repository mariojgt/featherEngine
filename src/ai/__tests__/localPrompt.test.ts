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
    expect(guide).toContain('MUST change the project with a tool before you reply');
    expect(guide).toContain('Ask one concise question only when');
    expect(guide).toContain('exactly TWO callable functions');
    expect(guide).toContain('NEVER functions; pass one as run_engine_tool.name');
    expect(guide).toContain('create_block_wall');
    expect(guide).toContain('set_object_script');
    expect(guide).toContain('correct it, and retry');
    expect(guide).toContain('Do not narrate plans or output reasoning/control tags');
    expect(guide).toContain('/no_think');
    expect(guide.length).toBeLessThan(2300);
  });

  it('retains FunctionGemma function-calling priming without Qwen controls', () => {
    const guide = buildLocalEngineGuide(['core'], 'functiongemma', ['list_scene'], 'Gemma');
    expect(guide.startsWith('You are a model that can do function calling')).toBe(true);
    expect(guide).not.toContain('/no_think');
  });
});
