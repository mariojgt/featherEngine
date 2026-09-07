import { afterEach, expect, it } from 'vitest';
import { useEditorStore, selectActiveObjects } from '../../store/editorStore';
import { createPlatformerTemplate } from '../../project/platformerTemplate';
import { blankProject } from '../../project/serialize';
import { buildGameBundle } from '../../project/exportGame';
import { parseTemplateLesson, TEMPLATE_LESSONS } from '../templateLessons';

afterEach(() => useEditorStore.getState().setPlaying(false));

it('starts, pauses, resumes and restores the complete course on restart', async () => {
  useEditorStore.getState().loadProject(blankProject('Menu test'));
  const player = await createPlatformerTemplate();
  const count = selectActiveObjects(useEditorStore.getState()).length;
  useEditorStore.getState().setPlaying(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const tick = () => useEditorStore.getState().tickRuntime(1 / 60);
  const fire = (event: string) => { useEditorStore.getState().fireCustomEvent(event); tick(); };
  const value = (name: string) => { const s = useEditorStore.getState(); return s.runtimeVariableValues[s.variables.find((item) => item.name === name)!.id]; };
  tick();
  expect(value('MenuOpen')).toBe(true);
  expect(useEditorStore.getState().runtimeTimeScale).toBe(0);
  fire('CloudstepResume');
  expect(value('GameStarted')).toBe(true);
  expect(value('MenuOpen')).toBe(false);
  expect(useEditorStore.getState().runtimeTimeScale).toBe(1);
  for (let i = 0; i < 60; i++) tick();
  useEditorStore.getState().setRuntimeKey('KeyP', true);
  for (let i = 0; i < 6; i++) tick();
  useEditorStore.getState().setRuntimeKey('KeyP', false); tick();
  expect(value('MenuOpen')).toBe(true);
  expect(useEditorStore.getState().runtimeTimeScale).toBe(0);
  // A tap entirely between frames is still delivered once, even while Time.scale is zero.
  useEditorStore.getState().setRuntimeKey('KeyP', true);
  useEditorStore.getState().setRuntimeKey('KeyP', false); tick();
  expect(value('MenuOpen')).toBe(false);
  useEditorStore.getState().setRuntimeKey('KeyP', true);
  useEditorStore.getState().setRuntimeKey('KeyP', false); tick();
  expect(value('MenuOpen')).toBe(true);
  const before = [...selectActiveObjects(useEditorStore.getState()).find((item) => item.id === player)!.transform.position];
  for (let i = 0; i < 30; i++) tick();
  expect(selectActiveObjects(useEditorStore.getState()).find((item) => item.id === player)!.transform.position).toEqual(before);
  useEditorStore.getState().setRuntimeVariableByName('Score', 70);
  useEditorStore.getState().setRuntimeVariableByName('LevelComplete', true);
  fire('CloudstepRestart');
  expect(value('Score')).toBe(0);
  expect(value('LevelComplete')).toBe(false);
  expect(useEditorStore.getState().runtimeTimeScale).toBe(1);
  expect(selectActiveObjects(useEditorStore.getState())).toHaveLength(count);
  useEditorStore.getState().setPlaying(false);
  const bundle = buildGameBundle(useEditorStore.getState().exportProject());
  expect(bundle.runtimeContract.requiredFeatures).toContain('keyboard-press-events');
  expect(bundle.project.blueprints.some((item) => item.name === 'Cloudstep Game Flow')).toBe(true);
});

it('accepts versioned lessons and rejects malformed remote metadata', () => {
  expect(parseTemplateLesson(TEMPLATE_LESSONS['template-platformer'])?.difficulty).toBe('Beginner');
  expect(parseTemplateLesson({ version: 2 })).toBeUndefined();
  expect(parseTemplateLesson({ ...TEMPLATE_LESSONS['template-platformer'], lessons: [false] })).toBeUndefined();
});
