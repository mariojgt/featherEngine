import { describe, expect, it } from 'vitest';
import { selectActiveObjects, useEditorStore } from '../../store/editorStore';
import { useProjectStore } from '../../store/projectStore';
import { createCinderfallTemplate, CINDERFALL_CREATURES, CINDERFALL_VEINS } from '../cinderfallTemplate';
import { buildGameBundle } from '../exportGame';
import { verifyGameBundle } from '../verifyBundle';
import { graphToFeatherScript } from '../../scripting/featherScript';

describe('Cinderfall portable extraction game', () => {
  it('builds executable editable gameplay and an export with all original assets', async () => {
    useProjectStore.getState().useDemo();
    const player = await createCinderfallTemplate();
    const s = useEditorStore.getState(), objects = selectActiveObjects(s);
    expect(objects.find(object => object.id === player)?.character?.cameraMode).toBe('firstPerson');
    expect(objects.filter(object => object.variables?.tags === 'cf-vein')).toHaveLength(CINDERFALL_VEINS.length);
    expect(objects.filter(object => object.variables?.tags === 'cf-creature')).toHaveLength(CINDERFALL_CREATURES.length);
    expect(objects.find(object => object.viewModel?.ownerObjectId === player)?.model?.specId).toBeTruthy();
    for (const blueprint of s.blueprints.filter(blueprint => blueprint.name.startsWith('Cinderfall'))) {
      const graph = s.graphs.find(graph => graph.id === blueprint.graphId);
      expect(graph?.nodes.length, blueprint.name).toBeGreaterThan(0);
      expect(graphToFeatherScript({ blueprint, graph: graph!, variables: s.variables, blueprints: s.blueprints }), blueprint.name).toContain('on ');
    }
    const project = s.exportProject();
    const bundle = await buildGameBundle(project);
    expect(verifyGameBundle(bundle).errors).toEqual([]);
    expect(bundle.project.scenes.some(scene => scene.name.startsWith('Cinderfall'))).toBe(true);
    expect(project.assets.filter(asset => asset.name.startsWith('Cinderfall')).every(asset => asset.data?.startsWith('data:audio/wav;base64,'))).toBe(true);
    expect(project.modelSpecs?.filter(spec => spec.name.startsWith('Cinderfall')).length).toBeGreaterThanOrEqual(7);
    expect(s.prefabs.filter(prefab => prefab.name.startsWith('Cinderfall')).length).toBeGreaterThanOrEqual(6);
  });
});
