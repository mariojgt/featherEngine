import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '../../store/editorStore';
import {
  buildLocalContinuityContext,
  buildLocalSnapshotContext,
  LOCAL_CONTINUITY_CHAR_BUDGET,
  LOCAL_SNAPSHOT_CHAR_BUDGET,
  LOCAL_USER_CHAR_BUDGET,
  trimLocalUserMessage,
} from '../local/localContext';

describe('Local AI context envelope', () => {
  beforeEach(() => {
    useEditorStore.setState({ selectedObjectId: undefined, isPlaying: false });
  });

  it('hard-bounds the local user message while retaining its ending', () => {
    const input = `start-${'x'.repeat(1400)}-important ending`;
    const output = trimLocalUserMessage(input);
    expect(output.length).toBeLessThanOrEqual(LOCAL_USER_CHAR_BUDGET);
    expect(output).toContain('middle trimmed for local WebGPU');
    expect(output.endsWith('important ending')).toBe(true);
  });

  it('keeps the local project snapshot bounded and points the model to inspection tools', () => {
    const output = buildLocalSnapshotContext();
    expect(output.length).toBeLessThanOrEqual(LOCAL_SNAPSHOT_CHAR_BUDGET);
    expect(output).toContain('search_engine_tools');
    expect(output).toContain('activeScene');
  });

  it('keeps a tiny sanitized previous-turn summary for proactive follow-ups', () => {
    const output = buildLocalContinuityContext([
      { role: 'user', content: `Build a bright platformer ${'with clouds '.repeat(30)}` },
      { role: 'assistant', content: '<think>private reasoning</think>Created the first playable room.' },
    ]);
    expect(output).not.toBeNull();
    expect(output!.length).toBeLessThanOrEqual(LOCAL_CONTINUITY_CHAR_BUDGET);
    expect(output).toContain('Previous request:');
    expect(output).toContain('Previous result:');
    expect(output).toContain('Created the first playable room');
    expect(output).not.toContain('private reasoning');
    expect(output).not.toContain('<think>');
  });
});
