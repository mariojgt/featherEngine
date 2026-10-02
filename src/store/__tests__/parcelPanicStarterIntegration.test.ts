// @vitest-environment node
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { create } from 'zustand';
import { describe, expect, it, vi } from 'vitest';

// Exercise the real project lifecycle with isolated platform/editor dependencies. The core
// Parcel Panic builder is mocked here; its real gameplay is exercised by parcelPanicTemplate.test.ts.
const compiled = ts.transpileModule(readFileSync(new URL('../projectStore.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function starter(options: { cancel?: boolean; collaboration?: boolean; build?: () => Promise<string> } = {}) {
  const build = vi.fn(options.build ?? (async () => 'courier-player'));
  const moba = vi.fn(async () => 'moba-hero');
  const platformer = vi.fn(async () => 'platformer-player');
  const editor = { scenes: [{}], loadProject: vi.fn(() => { editor.scenes = [{}]; }) };
  const createProject = vi.fn(async (name: string, project: unknown) =>
    options.cancel ? null : { name, project, dir: 'web' });
  const modules: Record<string, unknown> = {
    zustand: { create },
    'zustand/middleware': { persist: (initializer: unknown) => initializer },
    '../platform': { getPlatform: async () => ({ createProject }), isDesktop: false },
    '../project/serialize': { blankProject: (name: string) => ({ name }) },
    './editorStore': { useEditorStore: { getState: () => editor } },
    './history': { clearHistory: vi.fn() },
    './autosave': { clearRecovery: vi.fn() },
    './editor/authoredState': { authoredProjectChanged: () => false },
    '../collaboration/access': { collaborationAccess: () => ({ active: options.collaboration ?? false }) },
    '../project/parcelPanicTemplate': { createParcelPanicTemplate: build },
    '../project/mobaTemplate': { createMobaTemplate: moba },
    '../project/platformerTemplate': { createPlatformerTemplate: platformer },
    '../project/exportGame': {}, '../project/verifyBundle': {}, '../project/package': {},
    '../project/packageArchive': {}, '../project/exportProfiles': {}, '../utils/contentHash': {},
  };
  const exports = {} as typeof import('../projectStore');
  runInNewContext(compiled, { exports, Error, require: (id: string) => {
    if (!(id in modules)) throw new Error(`Unexpected module ${id}`);
    return modules[id];
  } });
  return { store: exports.useProjectStore, build, platformer, moba, editor, createProject };
}

describe('Parcel Panic built-in project integration', () => {
  it('creates the named project and calls only the Parcel Panic builder without a catalog', async () => {
    const tool = starter();
    expect(await tool.store.getState().newProjectFromStarter('My Deliveries', 'parcel-panic')).toBe(true);
    expect(tool.createProject).toHaveBeenCalledWith('My Deliveries', { name: 'My Deliveries' });
    expect(tool.editor.loadProject).toHaveBeenCalledOnce();
    expect(tool.build).toHaveBeenCalledOnce();
    expect(tool.platformer).not.toHaveBeenCalled();
    expect(tool.store.getState()).toMatchObject({ hasProject: true, projectName: 'My Deliveries', busy: false, error: null });
  });

  it('creates a MOBA through its own offline builder', async () => {
    const tool = starter();
    expect(await tool.store.getState().newProjectFromStarter('My Lane', 'moba')).toBe(true);
    expect(tool.createProject).toHaveBeenCalledWith('My Lane', { name: 'My Lane' });
    expect(tool.moba).toHaveBeenCalledOnce();
    expect(tool.build).not.toHaveBeenCalled();
    expect(tool.platformer).not.toHaveBeenCalled();
  });

  it('keeps the Platformer creation route working', async () => {
    const tool = starter();
    expect(await tool.store.getState().newProjectFromStarter('Clouds', 'platformer')).toBe(true);
    expect(tool.platformer).toHaveBeenCalledOnce();
    expect(tool.build).not.toHaveBeenCalled();
  });

  it('does not build after project creation is cancelled', async () => {
    const tool = starter({ cancel: true });
    const previousScenes = tool.editor.scenes;
    expect(await tool.store.getState().newProjectFromStarter('Cancelled', 'parcel-panic')).toBe(false);
    expect(tool.build).not.toHaveBeenCalled();
    expect(tool.editor.scenes).toBe(previousScenes);
    expect(tool.store.getState().busy).toBe(false);
  });

  it('preserves the collaboration guard', async () => {
    const tool = starter({ collaboration: true });
    expect(await tool.store.getState().newProjectFromStarter('Blocked', 'parcel-panic')).toBe(false);
    expect(tool.createProject).not.toHaveBeenCalled();
    expect(tool.build).not.toHaveBeenCalled();
  });

  it('reports builder errors and releases the busy state', async () => {
    const tool = starter({ build: async () => { throw new Error('Builder failed'); } });
    expect(await tool.store.getState().newProjectFromStarter('Failure', 'parcel-panic')).toBe(false);
    expect(tool.store.getState()).toMatchObject({ busy: false, error: 'Builder failed', toast: { kind: 'error' } });
  });
});
