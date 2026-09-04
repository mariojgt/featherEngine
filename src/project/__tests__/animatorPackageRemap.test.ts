import { describe, expect, it } from 'vitest';
import { buildPackage, collectProjectPackage, remapPackageForImport } from '../package';
import type { AnimationAsset, AnimatorController, AnimatorLayer, AssetItem, SceneObject } from '../../types';
import { blankProject } from '../serialize';

/**
 * Importing a package re-ids everything, so every internal reference has to be rewired. A miss here
 * is invisible when you export and shows up as a blend space with no clips, or a layer whose
 * conditions silently never fire, in someone else's project.
 */

const glb: AssetItem = { id: 'a-glb', name: 'rig.glb', type: 'model', size: 1, hash: 'h', createdAt: 0 };

const anim = (id: string, name: string): AnimationAsset => ({
  id,
  name,
  sourceAssetId: 'a-glb',
  clipName: name,
  skeletonId: 'sk-1',
  duration: 1,
  loop: true,
  createdAt: 0,
});

const upperLayer = (): AnimatorLayer => ({
  id: 'l-upper',
  name: 'Upper Body',
  maskRootBones: ['Spine'],
  weight: 1,
  weightParameterId: 'p-aim',
  states: [
    { id: 'ls-rest', name: 'Rest', animationId: 'an-idle', speed: 1, loop: true },
    {
      id: 'ls-aim',
      name: 'Aim',
      speed: 1,
      loop: true,
      blendParameterId: 'p-speed',
      blendSamples: [
        { animationId: 'an-idle', value: 0 },
        { animationId: 'an-run', value: 4 },
      ],
    },
  ],
  defaultStateId: 'ls-rest',
  transitions: [
    {
      id: 'lt-1',
      from: 'ls-rest',
      to: 'ls-aim',
      conditions: [{ parameterId: 'p-aim', op: '==', value: true }],
      duration: 0.2,
    },
  ],
});

const controller = (): AnimatorController => ({
  id: 'ctrl',
  name: 'Locomotion',
  parameters: [
    { id: 'p-speed', name: 'Speed', type: 'float', defaultValue: 0, source: 'speed' },
    { id: 'p-aim', name: 'IsAiming', type: 'bool', defaultValue: false, source: 'aiming' },
  ],
  states: [
    {
      id: 's-loco',
      name: 'Locomotion',
      speed: 1,
      loop: true,
      blendParameterId: 'p-speed',
      blendSamples: [
        { animationId: 'an-idle', value: 0 },
        { animationId: 'an-run', value: 4 },
      ],
    },
  ],
  defaultStateId: 's-loco',
  transitions: [],
  layers: [upperLayer()],
  createdAt: 0,
});

/** An object whose animator references the controller, so the closure pulls the controller in. */
const rigObject = (): SceneObject => ({
  id: 'o-rig',
  name: 'Rig',
  kind: 'cube',
  transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
  renderer: { enabled: true, mesh: 'cube', color: '#ffffff', metalness: 0, roughness: 1, modelAssetId: 'a-glb' },
  animator: { enabled: true, controllerId: 'ctrl', speed: 1, loop: true },
});

/** Export the controller as a project package and import it back, re-iding everything. */
const roundTripImport = (withLayers = true) => {
  const base = blankProject('Source');
  const project = {
    ...base,
    scenes: base.scenes.map((scene, index) => (index === 0 ? { ...scene, objects: [rigObject()] } : scene)),
    assets: [glb],
    animations: [anim('an-idle', 'Idle'), anim('an-run', 'Run')],
    animatorControllers: [withLayers ? controller() : { ...controller(), layers: undefined }],
  };
  const collected = collectProjectPackage(project);
  const shipped = project.assets.filter((entry) => collected.assetIds.includes(entry.id));
  const pkg = buildPackage('project', collected.content, shipped, {
    id: 'pkg-anim',
    name: 'Animator',
    version: '1.0.0',
  });
  const { content } = remapPackageForImport(JSON.parse(JSON.stringify(pkg)), [], []);
  const imported = content.animatorControllers[0];
  const animationIds = new Set(content.animations.map((a) => a.id));
  const paramIds = new Set(imported.parameters.map((p) => p.id));
  return { imported, animationIds, paramIds };
};

describe('animator controller package remapping', () => {
  it('re-ids the controller and its parameters', () => {
    const { imported } = roundTripImport();
    expect(imported.id).not.toBe('ctrl');
    expect(imported.parameters.map((p) => p.id)).not.toContain('p-speed');
  });

  // The bug: base blend samples were never remapped, so an imported blend space pointed at the
  // publisher's animation ids and came in with no clips at all.
  it('remaps blend-space sample animations on a base state', () => {
    const { imported, animationIds } = roundTripImport();
    const samples = imported.states[0].blendSamples!;
    expect(samples).toHaveLength(2);
    for (const sample of samples) {
      expect(sample.animationId).not.toBe('an-idle');
      expect(animationIds.has(sample.animationId)).toBe(true);
    }
  });

  it('remaps the blend axis parameter to the imported parameter', () => {
    const { imported, paramIds } = roundTripImport();
    expect(paramIds.has(imported.states[0].blendParameterId!)).toBe(true);
  });

  describe('layers', () => {
    it('survives the round trip with its mask and weight', () => {
      const { imported } = roundTripImport();
      const layer = imported.layers![0];
      expect(layer.name).toBe('Upper Body');
      expect(layer.maskRootBones).toEqual(['Spine']);
      expect(layer.weight).toBe(1);
    });

    it('re-ids the layer itself', () => {
      const { imported } = roundTripImport();
      expect(imported.layers![0].id).not.toBe('l-upper');
    });

    it('rewires the layer weight parameter', () => {
      const { imported, paramIds } = roundTripImport();
      expect(paramIds.has(imported.layers![0].weightParameterId!)).toBe(true);
    });

    it('rewires layer transitions to the LAYER states, not the base ones', () => {
      const { imported } = roundTripImport();
      const layer = imported.layers![0];
      const layerStateIds = new Set(layer.states.map((s) => s.id));
      const baseStateIds = new Set(imported.states.map((s) => s.id));
      const transition = layer.transitions[0];
      expect(layerStateIds.has(transition.from)).toBe(true);
      expect(layerStateIds.has(transition.to)).toBe(true);
      // Each machine gets its own state map; sharing one would let this resolve to a base state.
      expect(baseStateIds.has(transition.from)).toBe(false);
      expect(layerStateIds.has(layer.defaultStateId!)).toBe(true);
    });

    it('rewires layer transition conditions to the imported parameters', () => {
      const { imported, paramIds } = roundTripImport();
      const condition = imported.layers![0].transitions[0].conditions[0];
      expect(paramIds.has(condition.parameterId)).toBe(true);
    });

    it('remaps animations on layer states, including blend samples', () => {
      const { imported, animationIds } = roundTripImport();
      const [rest, aim] = imported.layers![0].states;
      expect(animationIds.has(rest.animationId!)).toBe(true);
      for (const sample of aim.blendSamples!) expect(animationIds.has(sample.animationId)).toBe(true);
    });
  });

  it('leaves a controller without layers untouched', () => {
    expect(roundTripImport(false).imported.layers).toBeUndefined();
  });
});
