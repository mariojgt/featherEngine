import { afterEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '../editorStore';
import { blankProject } from '../../project/serialize';

const state = () => useEditorStore.getState();
afterEach(() => state().setPlaying(false));

describe('FeatherScript vector math runtime', () => {
  it('evaluates computed components, normalizes vectors and applies a scalar from a value wire', () => {
    state().loadProject(blankProject('Vector math'));
    const id = state().createObjectWithProps('empty', { name: 'Vector probe' });
    const { blueprintId } = state().createBlueprintNamed('Vector probe');
    const result = state().applyBlueprintFeatherSource(blueprintId, `blueprint Vector_Probe
var yaw: number = 90
var magnitude: number = 5
var heading: vector3 = vec3(0, 0, 0)
var scaled: vector3 = vec3(0, 0, 0)
on start:
    self.heading = vec3(sin(self.yaw), 0, cos(self.yaw))
    self.scaled = vec_scale(normalize(vec3(3, 4, 0)), self.magnitude)`);
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    state().attachScript(id, blueprintId);
    state().setPlaying(true);
    state().tickRuntime(1 / 60);
    const live = state().runtimeObjectVariables[id];
    const heading = live.heading as number[];
    expect(heading[0]).toBeCloseTo(1);
    expect(heading[2]).toBeCloseTo(0);
    const scaled = live.scaled as number[];
    expect(scaled[0]).toBeCloseTo(3);
    expect(scaled[1]).toBeCloseTo(4);
    expect(scaled[2]).toBe(0);
  });
});
