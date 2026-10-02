import { describe, expect, it } from 'vitest';
import { blankProject, joinProject, migrateLoaded, splitProject } from '../serialize';

describe('project format safety', () => {
  it.each(['99.0.0', '0.99.0', '0.8.99'])('rejects newer format %s before rewriting its version', (version) => {
    const project = { ...blankProject('Future project'), version };
    expect(() => migrateLoaded(project)).toThrow('Update Feather');
    expect(() => splitProject(project)).toThrow('Update Feather');
    const current = splitProject(blankProject('Current'));
    expect(() => joinProject({ ...current.manifest, version }, current.sceneFiles.map((file) => file.scene))).toThrow('Update Feather');
    expect(project.version).toBe(version);
  });

  it.each(['bad', '1.0', '01.0.0', '', 8, null])('rejects invalid format version %s', (version) => {
    expect(() => migrateLoaded({ ...blankProject('Broken'), version })).toThrow('invalid format version');
  });

  it('retains supported legacy data and supplies new collections', () => {
    const project = blankProject('Legacy');
    const { particleSystems: _particles, modelSpecs: _models, ...legacy } = project;
    const migrated = migrateLoaded({ ...legacy, version: '0.2.0' });
    expect(migrated.scenes).toEqual(project.scenes);
    expect(migrated.particleSystems).toEqual([]);
    expect(migrated.modelSpecs).toEqual([]);
  });

  it('rejects malformed scene and shared collections with an actionable message', () => {
    expect(() => migrateLoaded({ ...blankProject('Broken'), assets: {} })).toThrow('assets must be an array');
    expect(() => migrateLoaded({ ...blankProject('Broken'), scenes: [{ id: 'a', objects: null }] })).toThrow('invalid scene');
    const scene = blankProject('Broken').scenes[0];
    expect(() => migrateLoaded({ ...blankProject('Broken'), scenes: [scene, scene] })).toThrow('duplicate scene id');
  });
});
